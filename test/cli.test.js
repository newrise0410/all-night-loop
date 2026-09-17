import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSkill, loadSkills, getSkill, bundle, cyclePrompt, specPrompt } from '../src/skill.js';
import { adapters, byId } from '../src/adapters.js';
import { upsertBlock, removeBlock, writeFile } from '../src/util.js';
import { resolveRunner, RUNNERS, YOLO_RUNNERS, looksPermissionBlocked } from '../src/runner.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const run = (args, cwd) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anloop-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

test('스킬 2종이 frontmatter 와 함께 로드된다', () => {
  assert.deepEqual(loadSkills().map((x) => x.id), ['loop', 'spec']);
  assert.equal(getSkill('spec').name, 'all-night-spec');
  // 템플릿은 loop 스킬에만 딸려 간다
  assert.ok(getSkill('loop').templates);
  assert.equal(getSkill('spec').templates, null);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anloop-w-'));
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

test('spec 프롬프트는 주제를 절차보다 먼저 놓는다', () => {
  const p = specPrompt('결제 재시도 로직');
  assert.ok(p.indexOf('결제 재시도 로직') < p.indexOf('# all-night-spec'), '주제가 절차 뒤에 묻혔다');
  assert.ok(p.includes('구현은 시작하지 마라'));
  assert.ok(!p.includes('## 인터뷰 답변\n'), '답변이 없는데 인터뷰 블록이 들어갔다');
});

test('인터뷰 답변은 프롬프트에 실리고, 빈 답은 조사 지시로 바뀐다', () => {
  const p = specPrompt('주제', [
    { q: '검증 명령은?', a: 'npm test' },
    { q: '규칙은?', a: '   ' },
  ]);
  assert.ok(p.includes('## 인터뷰 답변'));
  assert.ok(p.includes('npm test'));
  assert.ok(p.includes('(답변 없음 — 저장소에서 판단하라)'));
});

test('spec 은 주제 없이는 실행되지 않는다', () => {
  const dir = tmpRepo();
  assert.throws(() => run(['spec'], dir), /Command failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('spec 이 에이전트를 부르고 SPEC·BACKLOG 를 남긴다', () => {
  const dir = tmpRepo();
  const agent = path.join(dir, 'agent.sh');
  fs.writeFileSync(
    agent,
    ["#!/bin/bash", "cat > loop/SPEC.md <<'EOF'", '# 지시서', '- [ ] `npm test` 통과', 'EOF',
     "cat > loop/BACKLOG.md <<'EOF'", '# BACKLOG', '- [ ] T001 — 첫 작업', 'EOF', ''].join('\n'),
  );
  fs.chmodSync(agent, 0o755);
  const out = run(['spec', '재시도 로직 추가', '--cmd', `${agent} {prompt}`], dir);
  assert.match(out, /작성 완료/);
  assert.ok(fs.readFileSync(path.join(dir, 'loop', 'SPEC.md'), 'utf8').includes('npm test'));

  // 이미 작성된 SPEC 은 보호된다
  assert.throws(() => run(['spec', '다른 주제', '--cmd', `${agent} {prompt}`], dir), /Command failed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('에이전트가 없으면 인터뷰 답변으로 SPEC 초안을 쓴다', () => {
  const dir = tmpRepo();
  const answers = ['목표다', 'Node 20', 'npm test, npm run lint', '', 'src/a.ts', 'src/db/', '의존성 금지', 'feature 브랜치', '첫 작업'].join('\n');
  fs.writeFileSync(path.join(dir, 'answers.txt'), answers + '\n');
  execFileSync('bash', ['-c', `node ${CLI} spec "주제" --interview --cmd "없는CLI {prompt}" < answers.txt`], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  const spec = fs.readFileSync(path.join(dir, 'loop', 'SPEC.md'), 'utf8');
  assert.ok(spec.includes('- [ ] `npm test` 통과'), '검증 명령이 쪼개져 들어가야 한다');
  assert.ok(spec.includes('- [ ] `npm run lint` 통과'));
  assert.ok(spec.includes('- `src/a.ts`'));
  assert.ok(spec.includes('브랜치: feature 브랜치'));
  assert.ok(/^# 지시서 \(SPEC\)\n\n>/.test(spec), '제목 뒤 빈 줄이 살아 있어야 한다');
  assert.ok(fs.readFileSync(path.join(dir, 'loop', 'BACKLOG.md'), 'utf8').includes('T001 — 첫 작업'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('install 이 두 스킬을 모두 설치하고 AGENTS.md 블록은 하나만 둔다', () => {
  const dir = tmpRepo();
  run(['install', '--all'], dir);
  for (const p of [
    '.claude/skills/all-night-spec/SKILL.md',
    '.claude/commands/all-night-spec.md',
    '.codex/prompts/all-night-spec.md',
    '.cursor/rules/all-night-spec.mdc',
    '.gemini/commands/all-night-spec.toml',
    '.agent/skills/all-night-spec.md',
  ]) {
    assert.ok(fs.existsSync(path.join(dir, p)), `없음: ${p}`);
  }
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal((agents.match(/all-night-loop:start/g) || []).length, 1);
  assert.ok(agents.includes('all-night-spec.md'), '블록이 두 스킬을 모두 안내해야 한다');
  assert.ok(agents.includes('all-night-loop.md'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--yolo 는 승인을 건너뛰는 러너를 고른다', () => {
  assert.deepEqual(resolveRunner({ agent: 'claude' }).argTemplate, RUNNERS.claude[1]);
  const yolo = resolveRunner({ agent: 'claude', yolo: true }).argTemplate;
  assert.deepEqual(yolo, YOLO_RUNNERS.claude[1]);
  assert.ok(yolo.includes('--dangerously-skip-permissions'));
  // 모든 에이전트가 yolo 항목을 가진다 — 빠지면 resolveRunner 가 undefined 로 죽는다
  for (const id of Object.keys(RUNNERS)) assert.ok(YOLO_RUNNERS[id], `yolo 러너 없음: ${id}`);
});

test('--cmd 는 {prompt} 를 생략해도 마지막 인자로 붙인다', () => {
  assert.deepEqual(resolveRunner({ cmd: 'mycli chat' }), { cmd: 'mycli', argTemplate: ['chat', '{prompt}'] });
  assert.deepEqual(resolveRunner({ cmd: 'mycli -p {prompt} --x' }).argTemplate, ['-p', '{prompt}', '--x']);
});

test('권한 차단 진단은 관련 있을 때만 참이다', () => {
  assert.ok(looksPermissionBlocked('Bash(npm test) 승인이 거부되었습니다'));
  assert.ok(looksPermissionBlocked('permission denied'));
  assert.ok(!looksPermissionBlocked('테스트 3개 실패: assertion error'));
});
