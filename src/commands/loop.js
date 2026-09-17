import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cyclePrompt, STATE_DIR, RESULT_FILE } from '../skill.js';
import { resolveRunner, runOnce, buildArgs, checkWindowsLimits, warnIfMissing, looksPermissionBlocked } from '../runner.js';
import { c, log, warn, fail, readIfExists, findRoot } from '../util.js';

const STATUSES = ['done', 'all_done', 'blocked', 'needs_spec'];
const STOP_STATUSES = new Set(['all_done', 'blocked', 'needs_spec']);

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch {
    return null;
  }
}

/**
 * 사이클 시작 시점의 "진전 지문".
 *
 * 왜 커밋 해시만으로는 안 되는가: 스킬은 매 사이클 기록 커밋(`chore: loop log`)을 남긴다.
 * HEAD 만 보면 작업을 하나도 못 해도 매번 움직이므로 무진전 가드가 영원히 켜지지 않는다.
 * 그래서 **운영 기록(loop/) 밖의 산출물**과 **BACKLOG 의 작업 상태**를 따로 본다.
 */
export function progressFingerprint(root, loopDir) {
  const backlog = readIfExists(path.join(root, loopDir, 'BACKLOG.md')) || '';
  return {
    // 작업 상태 표시만 뽑는다. 문구가 다듬어져도 상태가 그대로면 진전이 아니다.
    taskStates: (backlog.match(/^\s*-\s*\[[ ~x!?]\]\s*(\S+)/gm) || []).join('|'),
    work: workState(root, loopDir),
  };
}

/** loop/ 를 뺀 작업 산출물의 상태. 커밋했든 안 했든 "뭔가 만들었나"를 본다. */
function workState(root, loopDir) {
  const tracked = git(root, ['ls-files', '-s']); // 추적 파일은 blob 해시가 붙어 내용까지 반영된다
  const dirty = git(root, ['diff', '--stat']);
  const untracked = git(root, ['ls-files', '-o', '--exclude-standard']);
  if (tracked === null) return null;
  const keep = (text) =>
    (text || '')
      .split('\n')
      .filter((l) => l && !l.includes(`${loopDir}/`))
      .sort();
  // ls-files -o 는 파일명만 준다 — 기존 미추적 파일에 내용을 덧붙여도 목록이 그대로다.
  // 크기와 mtime 을 붙여야 "계속 고쳐 쓰는 중"을 진전으로 인식한다.
  const untrackedStamped = keep(untracked).map((f) => {
    try {
      const st = fs.statSync(path.join(root, f));
      return `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      return f;
    }
  });
  return crypto
    .createHash('sha1')
    .update([keep(tracked).join('\n'), keep(dirty).join('\n'), untrackedStamped.join('\n')].join('\n--\n'))
    .digest('hex');
}

export const madeProgress = (before, after) =>
  before.taskStates !== after.taskStates || before.work !== after.work;

/** 이번 사이클에 에이전트가 쓴 구조화된 결과. run_id/cycle 이 맞아야 인정한다. */
export function readResult(root, loopDir, runId, cycle) {
  const raw = readIfExists(path.join(root, loopDir, STATE_DIR, RESULT_FILE));
  if (!raw) return { ok: false, reason: 'missing' };
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  // 지난 사이클의 낡은 파일을 이번 결과로 오인하면 잘못 멈추거나 잘못 계속한다.
  if (d.run_id !== runId || Number(d.cycle) !== cycle) return { ok: false, reason: 'stale' };
  if (!STATUSES.includes(d.status)) return { ok: false, reason: 'bad-status' };
  return { ok: true, status: d.status, task: d.task, verified: d.verified, commit: d.commit };
}

/** BACKLOG 에 남은 작업 수. all_done 이 사실인지 교차 검증한다. */
export function remainingTasks(root, loopDir) {
  const backlog = readIfExists(path.join(root, loopDir, 'BACKLOG.md'));
  if (backlog === null) return null;
  return (backlog.match(/^\s*-\s*\[[ ~]\]/gm) || []).length;
}

/** SPEC 이 실행 가능한 상태인가. 템플릿 그대로면 밤새 헛돈다. */
export function specReadiness(root, loopDir) {
  const spec = readIfExists(path.join(root, loopDir, 'SPEC.md'));
  if (spec === null) return { ready: false, why: `${loopDir}/SPEC.md 가 없다` };
  if (spec.includes('<검증 명령 1>') || spec.includes('<검증 명령 — 직접 채울 것>')) {
    return { ready: false, why: `${loopDir}/SPEC.md 가 아직 템플릿이다 — 검증 명령이 비어 있다` };
  }
  const placeholders = (spec.match(/<[^>\n]{2,80}>/g) || []).length;
  if (placeholders > 3) {
    return { ready: false, why: `${loopDir}/SPEC.md 에 자리표시자가 ${placeholders}개 남아 있다` };
  }
  return { ready: true, placeholders };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hintYolo() {
  log('');
  log(c.yellow('에이전트가 권한 때문에 막힌 것으로 보인다.'));
  log(c.dim('  기본 러너는 파일 편집만 허용하고 셸을 막는다. 그러면 검증 명령도 git commit 도 못 돌린다.'));
  log(c.dim('  무인 실행하려면: ') + c.cyan('anloop loop --yolo'));
  log(c.dim('  --yolo 는 에이전트의 승인 절차를 건너뛴다. 신뢰하는 저장소에서만 써라.'));
}

export async function loop(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const loopDir = argv.loopDir || 'loop';
  const max = Number(argv.max ?? 50);
  const pause = Number(argv.sleep ?? 3);
  const cycleTimeout = Number(argv.timeout ?? 1800) * 1000;
  const totalBudgetMs = argv['max-time'] ? Number(argv['max-time']) * 60_000 : null;

  const runner = resolveRunner(argv);
  const { cmd, argTemplate, useStdin } = runner;

  if (!argv['skip-spec-check']) {
    const readiness = specReadiness(root, loopDir);
    if (!readiness.ready) {
      fail(
        `${readiness.why}.\n` +
          `  ${c.cyan('anloop spec "주제"')}              주제만 주고 지시서를 만든다\n` +
          `  ${c.cyan('anloop spec "주제" --interview')}  인터뷰로 상세 지시서를 만든다\n` +
          `  ${c.cyan('anloop init')}                     빈 템플릿만 만든다\n` +
          `  검사를 건너뛰려면 ${c.cyan('--skip-spec-check')}`,
      );
    }
  }

  const runId = crypto.randomUUID().slice(0, 8);
  const stateDir = path.join(root, loopDir, STATE_DIR);
  fs.mkdirSync(stateDir, { recursive: true });
  // 자기 자신까지 무시시킨다 — 실행 중 상태가 커밋에 섞이면 안 된다.
  fs.writeFileSync(path.join(stateDir, '.gitignore'), '*\n');

  log(c.bold('all-night-loop') + c.dim(` — ${cmd} · run ${runId} · 최대 ${max} 사이클 · ${root}`));
  log(c.dim(`  사이클 제한 ${cycleTimeout / 1000}초${totalBudgetMs ? ` · 전체 ${totalBudgetMs / 60000}분` : ''}`));

  if (argv['dry-run']) {
    log(c.yellow('dry-run'), c.dim(`${cmd} ${argTemplate.join(' ')}${useStdin ? '  < (프롬프트는 stdin)' : ''}`));
    return;
  }
  warnIfMissing(cmd);

  const startedAt = Date.now();
  let idleStreak = 0;
  let failStreak = 0;

  for (let i = 1; i <= max; i++) {
    if (totalBudgetMs && Date.now() - startedAt > totalBudgetMs) {
      log(c.yellow(`\n전체 시간 예산(${totalBudgetMs / 60000}분)을 넘겼다. 루프를 멈춘다.`));
      return;
    }

    log(c.cyan(`\n──── cycle ${i}/${max} ${'─'.repeat(Math.max(0, 40 - String(i).length))}`));
    fs.rmSync(path.join(stateDir, RESULT_FILE), { force: true });

    const prompt = cyclePrompt(undefined, { loopDir, runId, cycle: i });
    checkWindowsLimits(runner, prompt);

    const before = progressFingerprint(root, loopDir);
    const cycleStart = Date.now();
    const { code, out, error, timedOut } = await runOnce(
      cmd,
      buildArgs(argTemplate, prompt, useStdin),
      root,
      useStdin ? prompt : null,
      cycleTimeout,
    );
    const took = Math.round((Date.now() - cycleStart) / 1000);

    if (error) fail(`${cmd} 실행 실패: ${error.message}\n설치돼 있는지 확인하거나 --cmd 로 직접 지정해라.`);

    const after = progressFingerprint(root, loopDir);
    const progress = madeProgress(before, after);
    const result = readResult(root, loopDir, runId, i);

    log(
      c.dim(
        `  ${took}초 · 종료코드 ${code}${timedOut ? ' (시간 초과)' : ''} · ` +
          `결과 ${result.ok ? result.status : `없음(${result.reason})`} · 진전 ${progress ? 'o' : 'x'}`,
      ),
    );

    // 1) 프로세스가 실패했으면 어떤 완료 보고도 믿지 않는다.
    //    (왜: 종료코드 1 로 죽으면서 출력에 ALL DONE 을 남기는 경우가 실제로 있었다.)
    if (code !== 0 || timedOut) {
      failStreak++;
      log(c.yellow(`  에이전트 비정상 종료 (연속 ${failStreak}회)`));
      if (failStreak >= 3) {
        log(c.red('\n에이전트가 3회 연속 실패했다. 루프를 멈춘다.'));
        if (!argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
        return;
      }
    } else {
      failStreak = 0;

      // 2) 이번 사이클에 쓰인 구조화된 결과만 종료 근거로 인정한다. stdout 은 보지 않는다.
      if (result.ok && STOP_STATUSES.has(result.status)) {
        const left = remainingTasks(root, loopDir);
        if (result.status === 'all_done' && left) {
          warn(`all_done 이라는데 BACKLOG 에 남은 작업이 ${left}개다. 보고를 믿지 않고 계속한다.`);
        } else {
          log(result.status === 'all_done' ? c.green(`\n루프 종료: ${result.status}`) : c.yellow(`\n루프 종료: ${result.status}`));
          if (result.status === 'blocked' && !argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
          return;
        }
      }
      if (!result.ok && result.reason !== 'missing') {
        warn(`${loopDir}/${STATE_DIR}/${RESULT_FILE} 를 신뢰할 수 없다 (${result.reason}). 증거로 판단한다.`);
      }
    }

    // 3) 진전 판정 — 기록 커밋은 진전으로 치지 않는다.
    if (progress) {
      idleStreak = 0;
    } else {
      idleStreak++;
      log(c.yellow(`  진전 없음 — 작업 상태도 산출물도 그대로 (연속 ${idleStreak}회)`));
      if (idleStreak >= 2) {
        log(c.yellow(`\n2회 연속 진전이 없다. 루프를 멈춘다 — ${loopDir}/HANDOFF.md 를 확인해라.`));
        if (!argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
        return;
      }
    }

    if (i < max && pause > 0) await sleep(pause * 1000);
  }
  log(c.yellow(`\n최대 사이클(${max})에 도달했다.`));
}
