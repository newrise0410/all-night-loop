import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cyclePrompt, STATE_DIR, RESULT_FILE, FILES, LEGACY } from '../skill.js';
import { resolveRunner, withUsage, runOnce, buildArgs, checkWindowsLimits, warnIfMissing, looksPermissionBlocked } from '../runner.js';
import { appendUsage, summarize, supportsUsage, fmtTokens } from '../usage.js';
import { c, log, warn, fail, readIfExists, findRoot } from '../util.js';

const STATUSES = ['done', 'all_done', 'blocked', 'needs_spec'];
const STOP_STATUSES = new Set(['all_done', 'blocked', 'needs_spec']);

const legacyWarned = new Set();

/**
 * 상태 파일을 읽는다. 새 이름이 없고 옛 이름이 있으면 그걸 읽고 한 번 경고한다.
 * **자동으로 rename 하지 않는다** — 사람 없을 때 되돌리기 어려운 조작을 하지 않는다는
 * 이 프로젝트의 규칙을 하네스 자신도 지켜야 한다. 옮기는 건 `anloop migrate` 가 한다.
 */
export function readState(root, loopDir, name) {
  const fresh = readIfExists(path.join(root, loopDir, name));
  if (fresh !== null) return fresh;
  const old = Object.keys(LEGACY).find((k) => LEGACY[k] === name);
  if (!old) return null;
  const legacy = readIfExists(path.join(root, loopDir, old));
  if (legacy !== null && !legacyWarned.has(name)) {
    legacyWarned.add(name);
    warn(`${loopDir}/${old} 를 읽었다. 새 이름은 ${name} 이다 — ${c.cyan('anloop migrate')} 로 옮겨라.`);
  }
  return legacy;
}

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
 * 그래서 **운영 기록(loop/) 밖의 산출물**과 **backlog 의 작업 상태**를 따로 본다.
 */
export function progressFingerprint(root, loopDir) {
  const backlog = readState(root, loopDir, FILES.backlog) || '';
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
  return {
    ok: true,
    status: d.status,
    task: d.task,
    verified: d.verified,
    commit: d.commit,
    verify_attempts: Number.isFinite(Number(d.verify_attempts)) ? Number(d.verify_attempts) : null,
  };
}

/** backlog 에 남은 작업 수. all_done 이 사실인지 교차 검증한다. */
export function remainingTasks(root, loopDir) {
  const backlog = readState(root, loopDir, FILES.backlog);
  if (backlog === null) return null;
  return (backlog.match(/^\s*-\s*\[[ ~]\]/gm) || []).length;
}

/** design 이 실행 가능한 상태인가. 템플릿 그대로면 밤새 헛돈다. */
export function designReadiness(root, loopDir) {
  const f = `${loopDir}/${FILES.design}`;
  const design = readState(root, loopDir, FILES.design);
  if (design === null) return { ready: false, why: `${f} 가 없다` };
  if (design.includes('<검증 명령 1>') || design.includes('<검증 명령 — 직접 채울 것>')) {
    return { ready: false, why: `${f} 가 아직 템플릿이다 — 검증 명령이 비어 있다` };
  }
  const placeholders = (design.match(/<[^>\n]{2,80}>/g) || []).length;
  if (placeholders > 3) return { ready: false, why: `${f} 에 자리표시자가 ${placeholders}개 남아 있다` };
  return { ready: true, placeholders };
}

/**
 * inbox 의 `## 대기` 아래 항목 수. 사용자가 반영 여부를 볼 수 있게 매 바퀴 찍는다.
 * 섹션은 정규식 lookahead 대신 제목으로 쪼개 찾는다 — JS 에는 `\Z` 가 없어서
 * 파일 끝에서 끝나는 마지막 섹션을 놓친다.
 */
export function countInboxPending(text) {
  if (!text) return 0;
  const section = text
    .split(/^##\s+/m)
    .slice(1)
    .find((b) => /^대기\s*$/m.test(b.split('\n')[0]));
  if (!section) return 0;
  // 주석(<!-- 예시 -->)은 세지 않는다 — 템플릿을 지시로 오인하면 매 바퀴 헛일을 한다.
  const body = section.split('\n').slice(1).join('\n').replace(/<!--[\s\S]*?-->/g, '');
  return (body.match(/^\s*-\s+\S/gm) || []).length;
}

export const pendingInbox = (root, loopDir) => countInboxPending(readState(root, loopDir, FILES.inbox));

/**
 * 운영 기록이 커지면 매 사이클 입력이 같이 커진다.
 * status 는 "다음 바퀴가 즉시 출발할 수 있는 최소한"이어야 하고, 완료 백로그는 done.md 로 뺀다.
 */
function warnIfBloated(root, loopDir) {
  const limits = { [FILES.status]: 4000, [FILES.backlog]: 12000 };
  for (const [name, cap] of Object.entries(limits)) {
    const text = readState(root, loopDir, name);
    if (text && text.length > cap) {
      warn(
        `${loopDir}/${name} 가 ${text.length}자다 (권장 ${cap}자 이하). ` +
          (name === FILES.backlog
            ? `완료 항목을 ${loopDir}/${FILES.done} 로 옮겨라.`
            : '다음 바퀴 입력이 그만큼 커진다 — 핵심만 남겨라.'),
      );
    }
  }
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

  const budgetUsd = argv['budget-usd'] != null ? Number(argv['budget-usd']) : null;
  // 예산을 걸려면 측정해야 한다 — --budget-usd 는 --usage 를 함축한다.
  const wantUsage = Boolean(argv.usage) || budgetUsd != null;

  const baseRunner = resolveRunner(argv);
  if (wantUsage && !supportsUsage(baseRunner.agent)) {
    warn(
      baseRunner.agent
        ? `${baseRunner.agent} 는 사용량 보고를 지원하지 않는다. 시간만 기록한다.`
        : '--cmd 로 지정한 CLI 는 사용량 보고를 파싱할 수 없다. 시간만 기록한다.',
    );
  }
  const { cmd, useStdin } = baseRunner;

  if (!argv['skip-spec-check']) {
    const readiness = designReadiness(root, loopDir);
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
  log(
    c.dim(
      `  사이클 제한 ${cycleTimeout / 1000}초` +
        (totalBudgetMs ? ` · 전체 ${totalBudgetMs / 60000}분` : '') +
        (budgetUsd != null ? ` · 예산 $${budgetUsd}` : '') +
        (wantUsage ? ` · 사용량 기록 ${loopDir}/USAGE.jsonl` : ''),
    ),
  );

  if (argv['dry-run']) {
    const shown = withUsage(baseRunner, { budgetRemaining: budgetUsd });
    log(c.yellow('dry-run'), c.dim(`${cmd} ${shown.argTemplate.join(' ')}${useStdin ? '  < (프롬프트는 stdin)' : ''}`));
    return;
  }
  warnIfMissing(cmd);

  const startedAt = Date.now();
  let idleStreak = 0;
  let failStreak = 0;
  let spentUsd = 0;

  for (let i = 1; i <= max; i++) {
    if (totalBudgetMs && Date.now() - startedAt > totalBudgetMs) {
      log(c.yellow(`\n전체 시간 예산(${totalBudgetMs / 60000}분)을 넘겼다. 루프를 멈춘다.`));
      return;
    }

    if (budgetUsd != null && spentUsd >= budgetUsd) {
      log(c.yellow(`\n예산 $${budgetUsd} 를 모두 썼다 ($${spentUsd.toFixed(2)}). 루프를 멈춘다.`));
      return;
    }

    log(c.cyan(`\n──── cycle ${i}/${max} ${'─'.repeat(Math.max(0, 40 - String(i).length))}`));
    fs.rmSync(path.join(stateDir, RESULT_FILE), { force: true });
    warnIfBloated(root, loopDir);
    const inbox = pendingInbox(root, loopDir);
    if (inbox) log(c.dim(`  inbox 대기 ${inbox}건`));

    const runner = wantUsage
      ? withUsage(baseRunner, { budgetRemaining: budgetUsd == null ? null : budgetUsd - spentUsd })
      : { ...baseRunner, usage: null };
    const prompt = cyclePrompt(undefined, { loopDir, runId, cycle: i });
    checkWindowsLimits(runner, prompt);

    const before = progressFingerprint(root, loopDir);
    const cycleStart = Date.now();
    const { code, out, error, timedOut } = await runOnce(
      cmd,
      buildArgs(runner.argTemplate, prompt, useStdin),
      root,
      useStdin ? prompt : null,
      cycleTimeout,
      Boolean(runner.usage),
    );
    const took = Math.round((Date.now() - cycleStart) / 1000);

    if (error) fail(`${cmd} 실행 실패: ${error.message}\n설치돼 있는지 확인하거나 --cmd 로 직접 지정해라.`);

    const after = progressFingerprint(root, loopDir);
    const progress = madeProgress(before, after);
    const result = readResult(root, loopDir, runId, i);
    const u = runner.usage ? runner.usage(out) : null;

    // 계측 모드에서는 raw 출력을 흘리지 않았으므로 에이전트의 마지막 메시지를 여기서 보여준다.
    if (runner.usage && u && u.text) log(u.text.trim());

    if (wantUsage) {
      if (u && u.cost_usd) spentUsd += u.cost_usd;
      appendUsage(root, loopDir, {
        ts: new Date().toISOString(),
        run_id: runId,
        cycle: i,
        agent: baseRunner.agent || 'custom',
        task: result.ok ? result.task : null,
        status: result.ok ? result.status : `no-result(${result.reason})`,
        exit_code: code,
        timed_out: Boolean(timedOut),
        progressed: progress,
        duration_s: took,
        verify_attempts: result.ok ? result.verify_attempts : null,
        ...(u || {}),
        text: undefined,
      });
    }

    log(
      c.dim(
        `  ${took}초 · 종료코드 ${code}${timedOut ? ' (시간 초과)' : ''} · ` +
          `결과 ${result.ok ? result.status : `없음(${result.reason})`} · 진전 ${progress ? 'o' : 'x'}` +
          (u
            ? ` · $${(u.cost_usd ?? 0).toFixed(3)}${u.turns ? ` · ${u.turns}턴` : ''}` +
              ` · in ${fmtTokens(u.input_tokens)} / cache ${fmtTokens(u.cache_read_tokens)} / out ${fmtTokens(u.output_tokens)}`
            : ''),
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
          warn(`all_done 이라는데 backlog 에 남은 작업이 ${left}개다. 보고를 믿지 않고 계속한다.`);
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
        log(c.yellow(`\n2회 연속 진전이 없다. 루프를 멈춘다 — ${loopDir}/${FILES.status} 를 확인해라.`));
        if (!argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
        return;
      }
    }

    if (i < max && pause > 0) await sleep(pause * 1000);
  }
  log(c.yellow(`\n최대 사이클(${max})에 도달했다.`));
}

/** 누적 사용량을 사람이 읽을 형태로. `anloop usage` 가 쓴다. */
export function formatSummary(rows) {
  const t = summarize(rows);
  return [
    `사이클 ${t.cycles}회 · ${Math.round(t.duration_s / 60)}분 · $${t.cost_usd.toFixed(2)}${t.turns ? ` · ${t.turns}턴` : ''}`,
    `  입력 ${fmtTokens(t.input_tokens)} · 캐시생성 ${fmtTokens(t.cache_creation_tokens)} · ` +
      `캐시읽기 ${fmtTokens(t.cache_read_tokens)} · 출력 ${fmtTokens(t.output_tokens)}`,
    `  ${Object.entries(t.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ') || '기록 없음'}`,
  ].join('\n');
}
