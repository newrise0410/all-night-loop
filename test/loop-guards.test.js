import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { cyclePrompt, loadSkill, bundle } from '../src/skill.js';
import { madeProgress, progressFingerprint, readResult, remainingTasks, designReadiness, readState, pendingInbox } from '../src/commands/loop.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const ENV = { ...process.env, NO_COLOR: '1' };

/** 실제 SPEC 이 채워진 저장소. 루프가 실행 가능한 최소 상태를 만든다. */
function repoWithSpec() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-g-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  execFileSync('node', [CLI, 'init'], { cwd: dir, env: ENV });
  fs.writeFileSync(path.join(dir, 'loop', 'design.md'), '# DESIGN\n## 1. 합격 기준\n- [ ] `npm test` 통과\n');
  fs.writeFileSync(path.join(dir, 'loop', 'backlog.md'), '# BACKLOG\n\n## 대기\n\n- [ ] T001 — 첫 작업\n- [ ] T002 — 둘째 작업\n');
  return dir;
}

/** SPEC 없이 빈 저장소만 필요할 때. */
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-g-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

function fakeAgent(dir, body) {
  const p = path.join(dir, 'agent.sh');
  fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

/**
 * 루프를 돌리고 (출력, 실행된 사이클 수) 를 돌려준다.
 * 경고·에러는 stderr 로 나가므로 **반드시 둘 다 모아야 한다** — 안 그러면 단언이 헛돈다.
 */
function runLoop(dir, agent, extra = []) {
  // {prompt} 를 넣지 않는다 → 프롬프트가 stdin 으로 간다 (claude/codex 의 실제 경로)
  const args = [CLI, 'loop', '--cmd', agent, '--sleep', '0', ...extra];
  const r = spawnSync('node', args, { cwd: dir, encoding: 'utf8', env: ENV });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return { out, cycles: (out.match(/──── cycle/g) || []).length, code: r.status };
}

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

// ── 재현 1: 기록 커밋으로 무진전 가드를 무력화하던 문제 ────────────────────

test('기록(loop/)만 커밋하면 진전으로 치지 않는다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  const agent = fakeAgent(dir, 'echo "- 사이클" >> loop/journal.md\ngit add loop/journal.md && git commit -qm "chore: loop log"');
  const { cycles, out } = runLoop(dir, agent, ['--max', '4']);
  assert.equal(cycles, 2, '기록 커밋만으로 루프가 계속 돌았다');
  assert.match(out, /진전이 없다/);
  rm(dir);
});

test('첫 커밋이 없는 저장소에서도 무진전을 센다', () => {
  const dir = repoWithSpec();
  const agent = fakeAgent(dir, 'echo "[fake] 아무것도 안 함"');
  const { cycles } = runLoop(dir, agent, ['--max', '4']);
  assert.equal(cycles, 2, 'HEAD 가 없으면 무진전을 못 세던 문제');
  rm(dir);
});

test('작업 산출물이 생기면 커밋 전이라도 진전으로 친다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  const agent = fakeAgent(dir, 'echo "x$RANDOM" >> src.txt');
  const { cycles } = runLoop(dir, agent, ['--max', '3']);
  assert.equal(cycles, 3, '산출물이 계속 바뀌는데 무진전으로 판정했다');
  rm(dir);
});

// ── 재현 2·3: 종료 신호 오판 ──────────────────────────────────────────

test('프롬프트를 되울려도 종료로 오판하지 않는다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  // stdin 으로 받은 프롬프트를 그대로 stderr 에 뱉는 에이전트
  const agent = fakeAgent(dir, 'cat >&2\necho "[fake] 아무것도 안 함"');
  const { out, cycles } = runLoop(dir, agent, ['--max', '4']);
  assert.ok(!/루프 종료: all_done/.test(out), '출력 되울림을 종료 신호로 읽었다');
  assert.equal(cycles, 2, '무진전으로 멈춰야 한다');
  rm(dir);
});

test('프로세스가 실패하면 완료 보고를 믿지 않는다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  // 종료코드 1 인데 완료 결과 파일을 쓰는 에이전트
  const agent = fakeAgent(
    dir,
    'mkdir -p loop/.state\nRUN=$(grep -o \'run_id `[^`]*`\' <<< "$(cat)" | head -1 | sed \'s/.*`\\(.*\\)`/\\1/\')\n' +
      'printf \'{"run_id":"%s","cycle":1,"status":"all_done"}\' "$RUN" > loop/.state/cycle.json\nexit 1',
  );
  const { out } = runLoop(dir, agent, ['--max', '3']);
  assert.ok(!/루프 종료: all_done/.test(out), '실패한 사이클의 완료 보고를 인정했다');
  assert.match(out, /비정상 종료/);
  rm(dir);
});

test('all_done 인데 BACKLOG 에 일이 남아 있으면 멈추지 않는다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  const agent = fakeAgent(
    dir,
    'P=$(cat)\nRUN=$(grep -o \'run_id `[^`]*`\' <<< "$P" | head -1 | sed \'s/.*`\\(.*\\)`/\\1/\')\n' +
      'CYC=$(grep -o \'cycle `[0-9]*`\' <<< "$P" | head -1 | grep -o \'[0-9]*\')\n' +
      'mkdir -p loop/.state\nprintf \'{"run_id":"%s","cycle":%s,"status":"all_done"}\' "$RUN" "$CYC" > loop/.state/cycle.json\n' +
      'echo "x$RANDOM" >> src.txt',
  );
  const { out, cycles } = runLoop(dir, agent, ['--max', '2']);
  assert.match(out, /backlog 에 남은 작업이 2개/);
  assert.ok(!/루프 종료: all_done/.test(out), '거짓 all_done 으로 멈췄다');
  assert.equal(cycles, 2, '거짓 all_done 때문에 조기 종료했다');
  rm(dir);
});

test('이번 사이클의 결과만 인정한다 (낡은 파일 무시)', () => {
  const dir = repoWithSpec();
  fs.mkdirSync(path.join(dir, 'loop', '.state'), { recursive: true });
  const stale = { run_id: 'OLDRUN', cycle: 1, status: 'all_done' };
  fs.writeFileSync(path.join(dir, 'loop/.state/cycle.json'), JSON.stringify(stale));
  assert.equal(readResult(dir, 'loop', 'NEWRUN', 1).reason, 'stale');
  assert.equal(readResult(dir, 'loop', 'OLDRUN', 2).reason, 'stale');
  assert.equal(readResult(dir, 'loop', 'OLDRUN', 1).status, 'all_done');
  fs.writeFileSync(path.join(dir, 'loop/.state/cycle.json'), '{ 깨진 json');
  assert.equal(readResult(dir, 'loop', 'OLDRUN', 1).reason, 'invalid-json');
  fs.writeFileSync(path.join(dir, 'loop/.state/cycle.json'), JSON.stringify({ run_id: 'R', cycle: 1, status: '완료' }));
  assert.equal(readResult(dir, 'loop', 'R', 1).reason, 'bad-status');
  rm(dir);
});

// ── 예산·중단 장치 ───────────────────────────────────────────────────

test('사이클 시간 제한이 걸리면 프로세스를 죽이고 실패로 센다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  const agent = fakeAgent(dir, 'sleep 30');
  const started = Date.now();
  const { out } = runLoop(dir, agent, ['--max', '3', '--timeout', '1']);
  const took = (Date.now() - started) / 1000;
  assert.ok(took < 20, `시간 제한이 안 걸렸다 (${took}초)`);
  assert.match(out, /시간 초과/);
  rm(dir);
});

// ── SPEC 준비 검사 ───────────────────────────────────────────────────

test('미완성 SPEC 으로는 루프가 시작되지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-s-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('node', [CLI, 'init'], { cwd: dir, env: ENV });
  assert.equal(designReadiness(dir, 'loop').ready, false);
  const agent = fakeAgent(dir, 'echo hi');
  const { out, cycles } = runLoop(dir, agent, ['--max', '2']);
  assert.equal(cycles, 0, '템플릿 SPEC 으로 루프가 돌았다');
  assert.match(out, /템플릿이다|자리표시자/);
  // --skip-spec-check 로는 강제 실행된다
  assert.ok(runLoop(dir, agent, ['--max', '1', '--skip-spec-check']).cycles >= 1);
  rm(dir);
});

// ── 프롬프트 다이어트 ────────────────────────────────────────────────

test('실행 프롬프트에 SPEC 작성 가이드가 들어가지 않는다', () => {
  const guide = loadSkill().reference;
  const marker = guide.split('\n').find((l) => l.includes('나쁜 예'));
  assert.ok(marker, '가이드 표식을 찾지 못했다');
  const prompt = cyclePrompt(undefined, { loopDir: 'loop', runId: 'r', cycle: 1 });
  assert.ok(!prompt.includes(marker), '실행 프롬프트에 작성 가이드가 붙었다');
  // 가이드(2.6천자)가 통째로 다시 들어오면 이 선을 넘는다. 재발 방지용 상한이다.
  assert.ok(prompt.length < 3000, `실행 프롬프트가 너무 크다: ${prompt.length}자`);
  assert.ok(loadSkill().reference.length > 2000, '이 상한이 의미를 가지려면 가이드가 그만큼 커야 한다');
  // spec 스킬에는 여전히 붙어야 한다
  assert.ok(bundle(loadSkill()).length < bundle({ ...loadSkill(), id: 'spec' }).length);
});

test('--loop-dir 이 프롬프트 본문까지 반영된다', () => {
  const p = cyclePrompt(undefined, { loopDir: 'ops', runId: 'r', cycle: 1 });
  assert.ok(p.includes('ops/design.md'));
  assert.ok(p.includes('ops/.state/cycle.json'));
  assert.ok(!/\bloop\//.test(p), '프롬프트에 loop/ 가 남아 있다');
});

test('추적되지 않은 파일의 내용 변경도 진전으로 본다', () => {
  const dir = repoWithSpec();
  fs.writeFileSync(path.join(dir, 'draft.txt'), 'a');
  const a = progressFingerprint(dir, 'loop');
  // 목록은 그대로고 내용만 늘어난다 — ls-files -o 만으로는 못 잡는다
  fs.writeFileSync(path.join(dir, 'draft.txt'), 'a'.repeat(500));
  assert.equal(madeProgress(a, progressFingerprint(dir, 'loop')), true);
  rm(dir);
});

test('진전 지문은 BACKLOG 상태와 산출물을 따로 본다', () => {
  const dir = repoWithSpec();
  const a = progressFingerprint(dir, 'loop');
  // 기록만 바꾼 경우
  fs.appendFileSync(path.join(dir, 'loop', 'JOURNAL.md'), '\n- 사이클\n');
  assert.equal(madeProgress(a, progressFingerprint(dir, 'loop')), false, '기록 변경을 진전으로 쳤다');
  // 작업 상태가 바뀐 경우
  fs.writeFileSync(path.join(dir, 'loop', 'backlog.md'), '# BACKLOG\n\n- [x] T001 — 첫 작업\n- [ ] T002 — 둘째 작업\n');
  assert.equal(madeProgress(a, progressFingerprint(dir, 'loop')), true);
  assert.equal(remainingTasks(dir, 'loop'), 1);
  rm(dir);
});

test('제안 [?] 은 남은 작업으로 세지 않는다', () => {
  const dir = repoWithSpec();
  fs.writeFileSync(
    path.join(dir, 'loop', 'backlog.md'),
    '# BACKLOG\n\n- [x] T001 — 끝남\n- [?] T900 — SPEC 밖 제안\n',
  );
  // [?] 만 남았으면 할 일이 없는 것이다 — 아니면 루프가 승인 안 된 제안을 실행한다
  assert.equal(remainingTasks(dir, 'loop'), 0);
  rm(dir);
});

// ── 파일 이름 이전 ────────────────────────────────────────────────────

test('옛 이름만 있으면 읽기 폴백하고 자동으로 옮기지는 않는다', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'loop', 'SPEC.md'), '# 옛 지시서\n- [ ] `npm test` 통과\n');
  fs.writeFileSync(path.join(dir, 'loop', 'BACKLOG.md'), '# BACKLOG\n- [ ] T001 — a\n');

  assert.match(readState(dir, 'loop', 'design.md'), /옛 지시서/);
  assert.equal(remainingTasks(dir, 'loop'), 1);
  assert.equal(designReadiness(dir, 'loop').ready, true);
  // 읽었다고 파일이 움직이면 안 된다 — 사람 없을 때 되돌리기 어려운 조작을 하지 않는다
  assert.ok(fs.existsSync(path.join(dir, 'loop', 'SPEC.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'loop', 'design.md')));
  rm(dir);
});

test('migrate 가 옛 이름을 새 이름으로 옮긴다', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'loop'), { recursive: true });
  for (const f of ['SPEC.md', 'BACKLOG.md', 'HANDOFF.md']) {
    fs.writeFileSync(path.join(dir, 'loop', f), `# ${f}\n`);
  }
  execFileSync('node', [CLI, 'migrate', '--dry-run'], { cwd: dir, encoding: 'utf8', env: ENV });
  assert.ok(fs.existsSync(path.join(dir, 'loop', 'SPEC.md')), 'dry-run 이 파일을 옮겼다');

  execFileSync('node', [CLI, 'migrate'], { cwd: dir, encoding: 'utf8', env: ENV });
  // macOS 는 대소문자를 구분하지 않으므로 existsSync 로는 BACKLOG.md/backlog.md 를 못 가른다.
  // 실제 디렉터리 엔트리를 봐야 한다.
  const entries = fs.readdirSync(path.join(dir, 'loop'));
  assert.deepEqual(entries.sort(), ['backlog.md', 'design.md', 'status.md']);
  rm(dir);
});

// ── inbox ────────────────────────────────────────────────────────────

test('inbox 대기 건수는 주석 예시를 세지 않는다', () => {
  const dir = tmpRepo();
  execFileSync('node', [CLI, 'init'], { cwd: dir, env: ENV });
  // 템플릿은 예시가 전부 주석이다 — 이걸 지시로 세면 매 바퀴 헛일을 한다
  assert.equal(pendingInbox(dir, 'loop'), 0);

  fs.writeFileSync(
    path.join(dir, 'loop', 'inbox.md'),
    '# INBOX\n\n## 대기\n\n- 백오프를 늘려라\n- T003 은 미뤄라\n\n## 처리됨\n\n- (c1) 지난 것 — abc1234\n',
  );
  assert.equal(pendingInbox(dir, 'loop'), 2, '처리됨 항목까지 셌다');
  rm(dir);
});

test('inbox 대기가 있으면 사이클 로그에 찍힌다', () => {
  const dir = repoWithSpec();
  execSync('git add -A && git commit -qm init', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'loop', 'inbox.md'), '# INBOX\n\n## 대기\n\n- 백오프를 늘려라\n');
  const agent = fakeAgent(dir, 'echo "[fake] 아무것도 안 함"');
  const { out } = runLoop(dir, agent, ['--max', '1']);
  assert.match(out, /inbox 대기 1건/);
  rm(dir);
});

// ── 프롬프트 4요소 ───────────────────────────────────────────────────

test('프롬프트가 원구상 4요소 골격을 지킨다', () => {
  const p = cyclePrompt(undefined, { loopDir: 'loop', runId: 'r', cycle: 1 });
  assert.ok(/이걸 다른 사람이 봤을 때도 퀄리티가 떨어지지 않는가/.test(p), '합격 기준 한 문장이 없다');
  // 읽을 문서가 번호로 고정돼야 한다
  for (const [i, f] of [[1, 'design.md'], [2, 'status.md'], [3, 'inbox.md'], [4, 'backlog.md']]) {
    assert.ok(new RegExp(`${i}\\. \`loop/${f}\``).test(p), `읽기 순서 ${i}번(${f})이 없다`);
  }
  assert.ok(p.includes('읽기 → 하나 만들기 → 확인 → 커밋 → 기록'), '한 바퀴 순서가 없다');
  assert.ok(/이러면 이렇게 된다/.test(p), '규칙에 근거가 붙는다는 표시가 없다');
});
