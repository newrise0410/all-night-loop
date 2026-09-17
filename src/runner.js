import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { c, fail, warn } from './util.js';

const WIN = process.platform === 'win32';

/** cmd.exe 의 명령줄 길이 한계. 프롬프트를 argv 로 넘기면 여기에 걸린다. */
const WIN_CMDLINE_LIMIT = 8000;

/**
 * 도구별 "프롬프트 하나를 비대화식으로 실행"하는 커맨드.
 *   [cmd, args, useStdin]
 *
 * useStdin 이면 args 에 {prompt} 를 넣지 않고 프롬프트를 stdin 으로 흘린다.
 * → 왜: Windows 에서 claude/codex 는 .cmd 셸 스크립트라 spawn 이 cmd.exe 를 거쳐야 한다.
 *   그런데 프롬프트에는 줄바꿈 256개, 따옴표 50개, cmd.exe 메타문자(& | < > ^ %) 73개가 있다 —
 *   이걸 명령줄 인자로 넘기면 셸이 해석해서 깨진다. 길이(6.8천자)도 8191자 한계에 가깝다.
 *   stdin 은 셸 해석도 길이 제한도 없다.
 *
 * 각 CLI 의 플래그는 버전에 따라 달라진다 — 맞지 않으면 `--cmd` 로 직접 지정하면 된다.
 */
export const RUNNERS = {
  claude: ['claude', ['-p', '--permission-mode', 'acceptEdits'], true],
  codex: ['codex', ['exec', '-'], true],
  gemini: ['gemini', ['-p', '{prompt}'], false],
  cursor: ['cursor-agent', ['-p', '{prompt}'], false],
  opencode: ['opencode', ['run', '{prompt}'], false],
  aider: ['aider', ['--message', '{prompt}', '--yes-always'], false],
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
  claude: ['claude', ['-p', '--dangerously-skip-permissions'], true],
  codex: ['codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '-'], true],
  gemini: ['gemini', ['-p', '{prompt}', '--yolo'], false],
  cursor: ['cursor-agent', ['-p', '{prompt}', '--force'], false],
  opencode: RUNNERS.opencode,
  aider: RUNNERS.aider,
};

/** 에이전트가 권한 때문에 막힌 것으로 보이는가. 진단 메시지를 정확히 주기 위해서다. */
export function looksPermissionBlocked(out) {
  return /권한|permission|approval|not allowed|denied|승인|allowlist|거부/i.test(out);
}

/** PATH 에서 실행 파일을 찾는다. Windows 에서는 PATHEXT(.cmd/.exe/...)까지 본다. */
export function which(cmd) {
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes(path.sep)) {
    return fs.existsSync(cmd) ? cmd : null;
  }
  const exts = WIN ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try {
        fs.accessSync(p, WIN ? fs.constants.F_OK : fs.constants.X_OK);
        return p;
      } catch {
        /* 다음 후보 */
      }
    }
  }
  return null;
}

/** `--cmd "mycli chat {prompt}"` 또는 `--agent claude` 를 실행 가능한 형태로 푼다. */
export function resolveRunner(argv) {
  if (argv.cmd) {
    const parts = argv.cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    if (!parts.length) fail('--cmd 가 비어 있다.');
    const argTemplate = parts.slice(1).map((s) => s.replace(/^["']|["']$/g, ''));
    const hasPlaceholder = argTemplate.some((a) => a.includes('{prompt}'));
    // --stdin 을 줬거나 {prompt} 를 안 적었으면 stdin 으로 넘긴다.
    // {prompt} 를 적지 않았으면 stdin 이 기본이다. argv 로 받고 싶으면 {prompt} 를 적으면 된다.
    const useStdin = Boolean(argv.stdin) || !hasPlaceholder;
    return { cmd: parts[0].replace(/^["']|["']$/g, ''), argTemplate, useStdin };
  }
  const agent = argv.agent || 'claude';
  const found = (argv.yolo ? YOLO_RUNNERS : RUNNERS)[agent];
  if (!found) {
    fail(`모르는 에이전트: ${agent}\n사용 가능: ${Object.keys(RUNNERS).join(', ')}\n또는 --cmd "mycli -p {prompt}"`);
  }
  return { cmd: found[0], argTemplate: found[1], useStdin: found[2] };
}

/** 프롬프트를 실제 인자 배열로 펼친다. stdin 방식이면 argv 는 그대로 둔다. */
export function buildArgs(argTemplate, prompt, useStdin) {
  return useStdin ? [...argTemplate] : argTemplate.map((a) => a.replaceAll('{prompt}', prompt));
}

/** Windows 에서 여러 줄 프롬프트를 argv 로 넘기면 조용히 깨진다. 미리 막는다. */
export function checkWindowsLimits({ cmd, useStdin }, prompt) {
  if (!WIN || useStdin) return;
  const multiline = prompt.includes('\n');
  const tooLong = prompt.length > WIN_CMDLINE_LIMIT;
  if (!multiline && !tooLong) return;
  fail(
    `Windows 에서는 ${cmd} 에 이 프롬프트를 명령줄 인자로 넘길 수 없다.\n` +
      (multiline ? `  프롬프트가 여러 줄이다(${(prompt.match(/\n/g) || []).length}줄). cmd.exe 가 해석해서 깨진다.\n` : '') +
      (tooLong ? `  프롬프트 ${prompt.length}자 > cmd.exe 한계 ${WIN_CMDLINE_LIMIT}자.\n` : '') +
      `\n  해결: stdin 을 쓰는 에이전트를 쓰거나 (${c.cyan('--agent claude')} / ${c.cyan('--agent codex')}),\n` +
      `        이 CLI 가 stdin 을 받는다면 ${c.cyan(`--cmd "${cmd} ..." --stdin`)} 으로 지정해라.`,
  );
}

/**
 * 에이전트를 한 번 돌린다. 출력은 그대로 흘려보내면서 종료 신호 탐지용으로 모은다.
 * input 이 있으면 stdin 으로 넣고 닫는다.
 */
export function runOnce(cmd, args, cwd, input = null, timeoutMs = 0) {
  return new Promise((resolve) => {
    // Windows 의 claude/codex 등은 .cmd 셸 스크립트라 shell 없이는 spawn 이 ENOENT 로 죽는다.
    const child = spawn(cmd, args, {
      cwd,
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: WIN,
      // 자식이 또 자식을 만든다(에이전트 → 셸 → 테스트 러너). 프로세스 그룹째 죽여야 정리된다.
      detached: !WIN,
    });
    let out = '';
    let timedOut = false;
    let timer = null;
    const done = (payload) => {
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
    }
    const tee = (stream, dest) =>
      stream.on('data', (b) => {
        out += b.toString();
        dest.write(b);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    if (input !== null && child.stdin) {
      child.stdin.on('error', () => {
        /* 에이전트가 stdin 을 먼저 닫아도 실행 자체는 계속된다 */
      });
      child.stdin.end(input);
    }
    child.on('error', (e) => done({ code: -1, out, error: e, timedOut }));
    child.on('close', (code) => done({ code: timedOut ? -2 : code, out, timedOut }));
  });
}

/**
 * 프로세스 트리를 정리한다.
 * 왜 자식만 죽이면 안 되는가: 에이전트는 셸·테스트 러너를 또 띄운다. 부모만 죽이면
 * 손자 프로세스가 남아 계속 토큰과 CPU 를 쓴다.
 */
function killTree(child) {
  try {
    if (WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* 이미 종료됨 */
        }
      }, 5000).unref();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 이미 종료됨 */
    }
  }
}

/** 실행 전에 명령이 존재하는지 확인해 준다 — ENOENT 스택보다 친절한 메시지를 주려고. */
export function warnIfMissing(cmd) {
  if (!which(cmd)) warn(`${cmd} 를 PATH 에서 찾지 못했다. 설치돼 있는지 확인하거나 --cmd 로 지정해라.`);
}
