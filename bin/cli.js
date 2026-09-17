#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../src/commands/install.js';
import { init } from '../src/commands/init.js';
import { loop } from '../src/commands/loop.js';
import { spec } from '../src/commands/spec.js';
import { doctor, list, printPrompt, guide, uninstall, usage } from '../src/commands/misc.js';
import { c, log, fail } from '../src/util.js';

const BOOL = new Set(['all', 'global', 'force', 'dry-run', 'bundle', 'interview', 'yolo', 'stdin', 'skip-spec-check', 'usage', 'all', 'help', 'version']);

/** 의존성 없는 최소 파서. --k=v, --k v, --flag, -h 를 지원한다. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) out[key] = a.slice(eq + 1);
      else if (BOOL.has(key)) out[key] = true;
      else if (argv[i + 1] && !argv[i + 1].startsWith('-')) out[key] = argv[++i];
      else out[key] = true;
    } else if (a === '-h') out.help = true;
    else if (a === '-v') out.version = true;
    else out._.push(a);
  }
  if (out['loop-dir']) out.loopDir = out['loop-dir'];
  return out;
}

const HELP = `
${c.bold('all-night-loop')} — 사람 없이 돌아가는 자율 개발 루프를 모든 LLM 코딩 도구에 설치한다

${c.bold('사용법')}
  anloop <command> [options]

${c.bold('명령')}
  ${c.cyan('install')} [targets...]   스킬을 도구에 설치한다 (대상 생략 시 자동 감지)
  ${c.cyan('spec')} <주제>            주제로 지시서·백로그를 작성한다 (--interview 로 문답)
  ${c.cyan('init')}                   loop/{SPEC,BACKLOG,HANDOFF,JOURNAL}.md 빈 템플릿 생성
  ${c.cyan('loop')}                   에이전트를 반복 실행해 밤새 돌린다
  ${c.cyan('usage')}                  사이클별 사용량·비용 집계 (--all 로 실행별 내역)
  ${c.cyan('doctor')}                 감지된 도구·CLI·루프 상태 점검
  ${c.cyan('list')}                   설치 가능한 대상과 실행기 목록
  ${c.cyan('prompt')} [loop|spec]     프롬프트를 stdout 으로 (임의 CLI 에 파이프)
  ${c.cyan('guide')}                  지시서(SPEC) 작성 5요소 가이드 출력
  ${c.cyan('uninstall')} [targets...] 설치한 파일·블록 제거

${c.bold('옵션')}
  --all              모든 대상에 설치
  --global           프로젝트가 아니라 사용자 홈에 설치 (claude/codex/gemini/opencode)
  --dir <path>       대상 저장소 (기본: git 루트)
  --loop-dir <name>  루프 상태 디렉터리 (기본: loop)
  --force            사람이 만든 파일도 덮어쓴다
  --dry-run          무엇을 할지만 보여준다

${c.bold('spec 옵션')}
  --interview        9개 문답으로 상세 지시서를 만든다 (터미널 전용)
  --force            이미 작성된 SPEC 을 덮어쓴다

${c.bold('loop / spec 공통 옵션')}
  --agent <id>       claude | codex | gemini | cursor | opencode | aider  (기본: claude)
  --cmd "<c> {prompt}"  임의 CLI 로 실행
  --yolo             에이전트의 승인 절차를 건너뛴다 (무인 실행에 필요, 신뢰하는 저장소에서만)
  --stdin            --cmd 로 지정한 CLI 에 프롬프트를 stdin 으로 넘긴다 (Windows 에서 특히 중요)
  --max <n>          최대 사이클 (기본: 50)
  --sleep <sec>      사이클 간 대기 (기본: 3)
  --timeout <sec>    사이클 하나의 시간 제한 (기본: 1800). 넘으면 프로세스 트리째 정리한다
  --max-time <min>   전체 실행 시간 예산. 넘으면 다음 사이클을 시작하지 않는다
  --skip-spec-check  SPEC 완성도 검사를 건너뛴다
  --usage            사이클별 토큰·비용을 loop/USAGE.jsonl 에 기록 (claude/codex)
  --budget-usd <n>   전체 비용 예산. 넘으면 다음 사이클을 시작하지 않는다 (--usage 를 함축)

${c.bold('예시')}
  npm i -g all-night-loop
  anloop install --all              ${c.dim('# 이 저장소의 모든 도구에 설치')}
  anloop install claude --global    ${c.dim('# 모든 프로젝트에서 쓰도록 전역 설치')}
  anloop spec "결제 재시도 로직 추가"        ${c.dim('# 주제만 주면 알아서 지시서 작성')}
  anloop spec "..." --interview     ${c.dim('# 문답으로 상세 지시서 작성')}
  anloop loop --agent codex --max 20
  claude -p "$(anloop prompt)"      ${c.dim('# 한 사이클만 수동 실행')}
`;

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const cmd = argv._.shift();

  if (argv.version) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    return log(pkg.version);
  }
  if (!cmd || argv.help) return log(HELP);

  switch (cmd) {
    case 'install': return install(argv);
    case 'spec': return spec(argv);
    case 'init': return init(argv);
    case 'loop': return loop(argv);
    case 'usage': return usage(argv);
    case 'doctor': return doctor(argv);
    case 'list': return list(argv);
    case 'prompt': return printPrompt(argv);
    case 'guide': return guide(argv);
    case 'uninstall': return uninstall(argv);
    default: return fail(`알 수 없는 명령: ${cmd}\n${'anloop --help'} 를 봐라.`);
  }
}

main().catch((e) => fail(e.stack || e.message));
