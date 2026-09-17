import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { USAGE_SUPPORT, supportsUsage, appendUsage, readUsage, summarize } from '../src/usage.js';
import { resolveRunner, withUsage } from '../src/runner.js';
import { cyclePrompt } from '../src/skill.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'anl-u-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('claude JSON 출력에서 토큰을 카운터별로 분리해 읽는다', () => {
  const out =
    '어쩌다 섞인 로그\n' +
    JSON.stringify({
      total_cost_usd: 0.1896,
      num_turns: 12,
      duration_ms: 111000,
      result: '마지막 메시지',
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 18355,
        cache_read_input_tokens: 10010,
        output_tokens: 4,
      },
      modelUsage: { 'claude-opus-5[1m]': {} },
    });
  const u = USAGE_SUPPORT.claude.parse(out);
  // 세 카운터는 서로 포함 관계가 아니다 — 하나로 합치면 요금과도 컨텍스트와도 안 맞는다
  assert.equal(u.input_tokens, 2);
  assert.equal(u.cache_creation_tokens, 18355);
  assert.equal(u.cache_read_tokens, 10010);
  assert.equal(u.output_tokens, 4);
  assert.equal(u.cost_usd, 0.1896);
  assert.equal(u.turns, 12);
  assert.deepEqual(u.models, ['claude-opus-5[1m]']);
  assert.equal(u.text, '마지막 메시지');
});

test('파싱할 수 없는 출력은 조용히 null 을 준다', () => {
  assert.equal(USAGE_SUPPORT.claude.parse('JSON 이 아니다'), null);
  assert.equal(USAGE_SUPPORT.claude.parse('{ 깨진'), null);
  assert.equal(USAGE_SUPPORT.codex.parse('아무 이벤트 없음'), null);
});

test('codex JSONL 이벤트에서 사용량을 누적한다', () => {
  const out = [
    JSON.stringify({ type: 'x' }),
    JSON.stringify({ usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10 } }),
    JSON.stringify({ msg: { token_usage: { input_tokens: 5, output_tokens: 1 } } }),
    JSON.stringify({ last_agent_message: '끝' }),
  ].join('\n');
  const u = USAGE_SUPPORT.codex.parse(out);
  assert.equal(u.input_tokens, 105);
  assert.equal(u.cache_read_tokens, 50);
  assert.equal(u.output_tokens, 11);
  assert.equal(u.text, '끝');
});

test('계측 인자는 지원 에이전트에만, 예산은 남은 금액으로 전달된다', () => {
  const base = resolveRunner({ agent: 'claude' });
  assert.equal(withUsage(base).usage, USAGE_SUPPORT.claude.parse);
  assert.ok(withUsage(base).argTemplate.includes('--output-format'));

  const budgeted = withUsage(base, { budgetRemaining: 1.234 });
  const i = budgeted.argTemplate.indexOf('--max-budget-usd');
  assert.ok(i > -1);
  assert.equal(budgeted.argTemplate[i + 1], '1.23');

  // --cmd 로 지정한 CLI 는 출력 형식을 알 수 없다 — 건드리지 않는다
  const custom = withUsage(resolveRunner({ cmd: 'mycli' }));
  assert.equal(custom.usage, null);
  assert.deepEqual(custom.argTemplate, resolveRunner({ cmd: 'mycli' }).argTemplate);
  assert.equal(supportsUsage('aider'), false);
});

test('예산이 0 이하로 남아도 음수 인자를 넘기지 않는다', () => {
  const a = withUsage(resolveRunner({ agent: 'claude' }), { budgetRemaining: -5 }).argTemplate;
  assert.equal(Number(a[a.indexOf('--max-budget-usd') + 1]) > 0, true);
});

test('사용량 기록은 JSONL 로 쌓이고 집계된다', () => {
  const dir = tmp();
  appendUsage(dir, 'loop', { run_id: 'a', cycle: 1, status: 'done', cost_usd: 0.5, input_tokens: 10, cache_read_tokens: 100, output_tokens: 5, duration_s: 60, turns: 3 });
  appendUsage(dir, 'loop', { run_id: 'a', cycle: 2, status: 'blocked', cost_usd: 0.25, input_tokens: 4, cache_read_tokens: 40, output_tokens: 2, duration_s: 30, turns: 1 });
  const rows = readUsage(dir, 'loop');
  assert.equal(rows.length, 2);
  const t = summarize(rows);
  assert.equal(t.cycles, 2);
  assert.equal(t.cost_usd, 0.75);
  assert.equal(t.input_tokens, 14);
  assert.equal(t.cache_read_tokens, 140);
  assert.deepEqual(t.byStatus, { done: 1, blocked: 1 });
  rm(dir);
});

test('기록이 없으면 빈 배열, 깨진 줄은 건너뛴다', () => {
  const dir = tmp();
  assert.deepEqual(readUsage(dir, 'loop'), []);
  fs.mkdirSync(path.join(dir, 'loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'loop', 'USAGE.jsonl'), '{"run_id":"a","cycle":1}\n깨진 줄\n{ 또깨짐\n');
  assert.equal(readUsage(dir, 'loop').length, 1);
  rm(dir);
});

// ── 작업별 읽기 분리 (프롬프트 계약) ─────────────────────────────────

test('프롬프트는 작업을 고른 뒤에 참조를 읽으라고 지시한다', () => {
  const p = cyclePrompt(undefined, { loopDir: 'loop', runId: 'r', cycle: 1 });
  assert.ok(p.includes('이 단계에서 코드 파일을 읽지 마라'), '1단계 조기 읽기 금지가 빠졌다');
  assert.ok(p.includes('### 2-1.'), '작업 선택 후 읽기 단계가 빠졌다');
  assert.ok(p.indexOf('### 2-1.') > p.indexOf('### 2. 고르기'), '읽기 단계가 선택보다 앞에 있다');
  assert.ok(p.includes('참조:'), 'BACKLOG 항목의 참조 줄 규칙이 빠졌다');
});

test('프롬프트는 운영 기록 비대화를 막는 규칙을 담는다', () => {
  const p = cyclePrompt(undefined, { loopDir: 'loop', runId: 'r', cycle: 1 });
  assert.ok(p.includes('DONE.md'), '완료 백로그 보관 규칙이 빠졌다');
  assert.ok(/40줄/.test(p), 'HANDOFF 크기 제한이 빠졌다');
  assert.ok(p.includes('verify_attempts'), '검증 재시도 보고 규칙이 빠졌다');
});
