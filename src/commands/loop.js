import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { cyclePrompt } from '../skill.js';
import { c, log, fail, readIfExists, findRoot } from '../util.js';

/**
 * 도구별 "프롬프트 하나를 비대화식으로 실행"하는 커맨드.
 * 각 CLI 의 플래그는 버전에 따라 달라진다 — 맞지 않으면 `--cmd` 로 직접 지정하면 된다.
 */
export const RUNNERS = {
  claude: ['claude', ['-p', '{prompt}', '--permission-mode', 'acceptEdits']],
  codex: ['codex', ['exec', '{prompt}']],
  gemini: ['gemini', ['-p', '{prompt}', '--yolo']],
  cursor: ['cursor-agent', ['-p', '{prompt}']],
  opencode: ['opencode', ['run', '{prompt}']],
  aider: ['aider', ['--message', '{prompt}', '--yes-always']],
};

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

function runOnce(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const tee = (stream, dest) =>
      stream.on('data', (b) => {
        out += b.toString();
        dest.write(b);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('error', (e) => resolve({ code: -1, out, error: e }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loop(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const loopDir = argv.loopDir || 'loop';
  const max = Number(argv.max ?? 50);
  const pause = Number(argv.sleep ?? 3);

  let cmd;
  let argTemplate;
  if (argv.cmd) {
    const parts = argv.cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map((s) => s.replace(/^["']|["']$/g, ''));
    cmd = parts[0];
    argTemplate = parts.slice(1);
    if (!argTemplate.some((a) => a.includes('{prompt}'))) argTemplate.push('{prompt}');
  } else {
    const agent = argv.agent || 'claude';
    const found = RUNNERS[agent];
    if (!found) fail(`모르는 에이전트: ${agent}\n사용 가능: ${Object.keys(RUNNERS).join(', ')}\n또는 --cmd "mycli -p {prompt}"`);
    [cmd, argTemplate] = found;
  }

  if (!readIfExists(path.join(root, loopDir, 'SPEC.md'))) {
    fail(`${loopDir}/SPEC.md 가 없다. 먼저 ${c.cyan('anl init')} 을 실행하고 지시서를 채워라.`);
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
      log(c.green(`\n루프 종료: ${sentinel}`));
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
