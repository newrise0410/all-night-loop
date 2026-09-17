import { spawn } from 'node:child_process';
import { fail } from './util.js';

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

/**
 * --yolo 용. 승인 프롬프트를 건너뛴다.
 *
 * 왜 따로 두는가: 기본 러너는 파일 편집만 허용하고 셸을 막는다. 그런데 이 루프의 핵심 절차는
 * "검증 명령 실행 → git commit" 이다 — 셸이 막히면 에이전트는 구현해 놓고도 검증·커밋을 못 해
 * 매 사이클 BLOCKED 로 끝난다. 무인 실행을 하려면 셸을 열어야 한다.
 * 다만 이건 실제로 위험한 스위치이므로 기본값으로 두지 않는다.
 */
export const YOLO_RUNNERS = {
  claude: ['claude', ['-p', '{prompt}', '--dangerously-skip-permissions']],
  codex: ['codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '{prompt}']],
  gemini: RUNNERS.gemini,
  cursor: ['cursor-agent', ['-p', '{prompt}', '--force']],
  opencode: RUNNERS.opencode,
  aider: RUNNERS.aider,
};

/** 에이전트가 권한 때문에 막힌 것으로 보이는가. 진단 메시지를 정확히 주기 위해서다. */
export function looksPermissionBlocked(out) {
  return /권한|permission|approval|not allowed|denied|승인|allowlist|거부/i.test(out);
}

/** `--cmd "mycli chat {prompt}"` 또는 `--agent claude` 를 실행 가능한 형태로 푼다. */
export function resolveRunner(argv) {
  if (argv.cmd) {
    const parts = argv.cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (!parts.length) fail('--cmd 가 비어 있다.');
    const argTemplate = parts.slice(1).map((s) => s.replace(/^["']|["']$/g, ''));
    // {prompt} 를 안 적었으면 마지막 인자로 붙인다 — 대부분의 CLI 가 그 형태다.
    if (!argTemplate.some((a) => a.includes('{prompt}'))) argTemplate.push('{prompt}');
    return { cmd: parts[0].replace(/^["']|["']$/g, ''), argTemplate };
  }
  const agent = argv.agent || 'claude';
  const found = (argv.yolo ? YOLO_RUNNERS : RUNNERS)[agent];
  if (!found) {
    fail(`모르는 에이전트: ${agent}\n사용 가능: ${Object.keys(RUNNERS).join(', ')}\n또는 --cmd "mycli -p {prompt}"`);
  }
  return { cmd: found[0], argTemplate: found[1] };
}

/** 에이전트를 한 번 돌린다. 출력은 그대로 흘려보내면서 종료 신호 탐지용으로 모은다. */
export function runOnce(cmd, args, cwd) {
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
