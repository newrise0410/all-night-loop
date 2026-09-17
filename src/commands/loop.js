import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { cyclePrompt } from '../skill.js';
import { resolveRunner, runOnce, looksPermissionBlocked } from '../runner.js';
import { c, log, fail, readIfExists, findRoot } from '../util.js';

const STOP_WORDS = ['ALL DONE', 'BLOCKED', 'NEEDS SPEC'];

function headHash(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** HANDOFF 의 상태 필드. stdout 보다 신뢰할 수 있다 — 파일은 유실되지 않는다. */
function handoffState(root, loopDir) {
  const text = readIfExists(path.join(root, loopDir, 'HANDOFF.md'));
  if (!text) return null;
  const m = /^-?\s*\*\*상태\*\*\s*:\s*(.+)$/m.exec(text);
  if (!m) return null;
  const v = m[1].replace(/[`*]/g, '').trim();
  // 아직 안 채워진 자리표시자("<진행중 | 완료 | ...>")를 종료 신호로 오인하면
  // 루프가 첫 사이클에 멈춘다. 선택지 나열이나 꺾쇠가 있으면 값으로 치지 않는다.
  if (!v || v.includes('|') || v.includes('<')) return null;
  if (/^(완료|ALL DONE)$/i.test(v)) return 'ALL DONE';
  if (/^(막힘|BLOCKED)$/i.test(v)) return 'BLOCKED';
  if (/^(SPEC ?필요|NEEDS SPEC)$/i.test(v)) return 'NEEDS SPEC';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 권한 때문에 막혔을 때만 띄운다 — 무관한 실패에 위험한 플래그를 권하지 않기 위해서다. */
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

  const { cmd, argTemplate } = resolveRunner(argv);

  if (!readIfExists(path.join(root, loopDir, 'SPEC.md'))) {
    fail(
      `${loopDir}/SPEC.md 가 없다.\n` +
        `  ${c.cyan('anloop spec "주제"')}              주제만 주고 지시서를 만든다\n` +
        `  ${c.cyan('anloop spec "주제" --interview')}  인터뷰로 상세 지시서를 만든다\n` +
        `  ${c.cyan('anloop init')}                     빈 템플릿만 만든다`,
    );
  }

  const prompt = cyclePrompt();
  const args = argTemplate.map((a) => a.replaceAll('{prompt}', prompt));

  log(c.bold(`all-night-loop`) + c.dim(` — ${cmd} · 최대 ${max} 사이클 · ${root}`));
  if (argv['dry-run']) {
    log(c.yellow('dry-run'), c.dim(`${cmd} ${argTemplate.join(' ')}`));
    return;
  }

  let lastHash = headHash(root);
  let idleStreak = 0;
  let failStreak = 0;

  for (let i = 1; i <= max; i++) {
    log(c.cyan(`\n──── cycle ${i}/${max} ${'─'.repeat(Math.max(0, 40 - String(i).length))}`));
    const { code, out, error } = await runOnce(cmd, args, root);

    if (error) fail(`${cmd} 실행 실패: ${error.message}\n설치돼 있는지 확인하거나 --cmd 로 직접 지정해라.`);

    // 1) 에이전트가 명시적으로 종료 신호를 냈나
    const sentinel = STOP_WORDS.find((w) => out.includes(`[loop] ${w}`)) || handoffState(root, loopDir);
    if (sentinel) {
      log(sentinel === 'ALL DONE' ? c.green(`\n루프 종료: ${sentinel}`) : c.yellow(`\n루프 종료: ${sentinel}`));
      if (sentinel === 'BLOCKED' && !argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
      return;
    }

    // 2) 프로세스가 실패했나 — 연속 3회면 중단 (왜: 같은 실패를 밤새 반복하면 토큰만 탄다)
    if (code !== 0) {
      failStreak++;
      log(c.yellow(`  에이전트 종료코드 ${code} (연속 ${failStreak}회)`));
      if (failStreak >= 3) fail('에이전트가 3회 연속 실패했다. 루프를 멈춘다.');
    } else {
      failStreak = 0;
    }

    // 3) 커밋이 생겼나 — 2회 연속 제자리면 진전이 없는 것이다
    const hash = headHash(root);
    if (hash && hash === lastHash) {
      idleStreak++;
      log(c.yellow(`  새 커밋 없음 (연속 ${idleStreak}회)`));
      if (idleStreak >= 2) {
        log(c.yellow('\n2회 연속 진전이 없다. 루프를 멈춘다 — loop/HANDOFF.md 를 확인해라.'));
        if (!argv.yolo && !argv.cmd && looksPermissionBlocked(out)) hintYolo();
        return;
      }
    } else {
      idleStreak = 0;
      lastHash = hash;
      log(c.dim(`  HEAD → ${hash?.slice(0, 8)}`));
    }

    if (i < max && pause > 0) await sleep(pause * 1000);
  }
  log(c.yellow(`\n최대 사이클(${max})에 도달했다.`));
}
