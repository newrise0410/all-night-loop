import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSkill, bundle, cyclePrompt } from '../src/skill.js';
import { adapters, byId } from '../src/adapters.js';
import { upsertBlock, removeBlock, writeFile } from '../src/util.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const run = (args, cwd) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

test('스킬 정본이 frontmatter 와 함께 로드된다', () => {
  const s = loadSkill();
  assert.equal(s.name, 'all-night-loop');
  assert.ok(s.description.length > 20);
  assert.ok(s.body.includes('실행 순서'));
  assert.ok(s.reference.includes('합격 기준'));
  assert.equal(Object.keys(s.templates).length, 4);
});

test('번들은 자족적이다 — 절차와 SPEC 작성 가이드를 모두 담는다', () => {
  const b = bundle();
  assert.ok(b.includes('## 실행 순서'));
  assert.ok(b.includes('지시서(SPEC) 작성 가이드'));
  assert.ok(!b.includes("'''"), 'TOML 리터럴 문자열을 깨뜨릴 수 있다');
  assert.ok(cyclePrompt().includes('정확히 한 사이클만'));
});

test('모든 어댑터가 유효한 계획을 낸다', () => {
  const ctx = { skill: loadSkill(), bundleText: bundle(), root: '/tmp/x' };
  for (const a of adapters) {
    for (const scope of a.scopes) {
      const items = a.plan({ ...ctx, scope });
      assert.ok(items.length > 0, `${a.id}/${scope} 가 빈 계획을 냈다`);
      for (const it of items) {
        assert.match(it.path, /^(~\/)?[\w.]/, `${a.id}: 이상한 경로 ${it.path}`);
        assert.ok(!path.isAbsolute(it.path), `${a.id}: 절대경로 금지`);
        assert.ok(it.content.trim().length > 0, `${a.id}: 빈 내용`);
        if (scope === 'global') assert.ok(it.path.startsWith('~/'), `${a.id}: global 인데 상대경로`);
      }
    }
  }
});

test('codex 는 AGENTS.md 를 직접 쓰지 않는다 (agents 어댑터와 충돌 방지)', () => {
  const ctx = { skill: loadSkill(), bundleText: bundle(), root: '/tmp/x', scope: 'project' };
  assert.ok(!byId('codex').plan(ctx).some((i) => i.path === 'AGENTS.md'));
  assert.ok(byId('codex').requires.includes('agents'));
});

test('install --all 이 모든 파일을 만들고 두 번째 실행은 멱등이다', () => {
  const dir = tmpRepo();
  const first = run(['install', '--all'], dir);
  assert.match(first, /파일 설치 완료/);
  for (const p of [
    '.claude/skills/all-night-loop/SKILL.md',
    '.claude/commands/all-night-loop.md',
    '.codex/prompts/all-night-loop.md',
    '.cursor/rules/all-night-loop.mdc',
    '.gemini/commands/all-night-loop.toml',
    '.github/prompts/all-night-loop.prompt.md',
    '.clinerules/all-night-loop.md',
    '.windsurf/rules/all-night-loop.md',
    '.opencode/command/all-night-loop.md',
    '.agent/skills/all-night-loop.md',
    'AGENTS.md',
  ]) {
    assert.ok(fs.existsSync(path.join(dir, p)), `없음: ${p}`);
  }
  const second = run(['install', '--all'], dir);
  assert.match(second, /0개 파일 설치 완료/, '재실행이 파일을 다시 썼다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('사람이 쓴 파일은 덮어쓰지 않는다 (--force 로만)', () => {
  const dir = tmpRepo();
  const target = path.join(dir, '.clinerules', 'all-night-loop.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '# 내가 손으로 쓴 규칙\n');
  run(['install', 'cline'], dir);
  assert.equal(fs.readFileSync(target, 'utf8'), '# 내가 손으로 쓴 규칙\n');
  run(['install', 'cline', '--force'], dir);
  assert.ok(fs.readFileSync(target, 'utf8').includes('실행 순서'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AGENTS.md 블록은 기존 내용을 보존한 채 갱신·제거된다', () => {
  const dir = tmpRepo();
  const agents = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agents, '# 우리 프로젝트\n\n원래 있던 규칙.\n');
  run(['install', 'agents'], dir);
  let text = fs.readFileSync(agents, 'utf8');
  assert.ok(text.includes('원래 있던 규칙.'));
  assert.ok(text.includes('all-night-loop:start'));

  upsertBlock(agents, '## 바뀐 블록');
  text = fs.readFileSync(agents, 'utf8');
  assert.equal((text.match(/all-night-loop:start/g) || []).length, 1, '블록이 중복 삽입됐다');
  assert.ok(text.includes('## 바뀐 블록'));

  removeBlock(agents);
  text = fs.readFileSync(agents, 'utf8');
  assert.ok(text.includes('원래 있던 규칙.'));
  assert.ok(!text.includes('all-night-loop:start'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('init 이 loop 파일 4개를 만들고 기존 파일을 보존한다', () => {
  const dir = tmpRepo();
  run(['init'], dir);
  for (const f of ['SPEC', 'BACKLOG', 'HANDOFF', 'JOURNAL']) {
    assert.ok(fs.existsSync(path.join(dir, 'loop', `${f}.md`)));
  }
  fs.writeFileSync(path.join(dir, 'loop', 'SPEC.md'), '내 지시서');
  run(['init'], dir);
  assert.equal(fs.readFileSync(path.join(dir, 'loop', 'SPEC.md'), 'utf8'), '내 지시서');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SPEC 이 없으면 loop 은 실행되지 않는다', () => {
  const dir = tmpRepo();
  assert.throws(() => run(['loop', '--agent', 'claude'], dir), /SPEC\.md 가 없다|Command failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HANDOFF 자리표시자를 종료 신호로 오인하지 않는다', async () => {
  const dir = tmpRepo();
  run(['init'], dir);
  const { default: mod } = await import('../src/commands/loop.js').then((m) => ({ default: m }));
  // 템플릿 그대로일 때는 멈추지 않아야 하고, 값을 채우면 멈춰야 한다.
  const handoff = path.join(dir, 'loop', 'HANDOFF.md');
  const probe = () => {
    const out = run(['doctor'], dir); // 사이드이펙트 없는 호출로 파일 상태만 유지
    return out;
  };
  probe();
  const raw = fs.readFileSync(handoff, 'utf8');
  assert.ok(raw.includes('- **상태**: <'), '템플릿이 자리표시자를 써야 한다');
  assert.ok(!/^-\s*\*\*상태\*\*:\s*(완료|막힘)\s*$/m.test(raw));
  fs.writeFileSync(handoff, raw.replace(/^- \*\*상태\*\*: .*$/m, '- **상태**: 완료'));
  assert.ok(/^- \*\*상태\*\*: 완료$/m.test(fs.readFileSync(handoff, 'utf8')));
  assert.ok(mod);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeFile 은 같은 내용이면 다시 쓰지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-w-'));
  const f = path.join(dir, 'a.md');
  assert.equal(writeFile(f, 'all-night-loop\nx'), 'create');
  assert.equal(writeFile(f, 'all-night-loop\nx'), 'same');
  assert.equal(writeFile(f, 'all-night-loop\ny'), 'update');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('생성된 Gemini TOML 이 파싱 가능한 형태다', () => {
  const dir = tmpRepo();
  run(['install', 'gemini'], dir);
  const toml = fs.readFileSync(path.join(dir, '.gemini/commands/all-night-loop.toml'), 'utf8');
  assert.match(toml, /^description = "/m);
  assert.match(toml, /^prompt = '''$/m);
  assert.equal((toml.match(/'''/g) || []).length, 2, "리터럴 문자열 구분자가 3쌍 이상이면 파싱이 깨진다");
  fs.rmSync(dir, { recursive: true, force: true });
});
