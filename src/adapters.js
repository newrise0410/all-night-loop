import { TEMPLATES, PKG_VERSION } from './skill.js';

/**
 * 도구별 설치 어댑터.
 *
 * plan(ctx) 는 실제로 쓸 파일 목록을 돌려준다.
 *   { kind: 'file',  path, content }  — 전체 파일을 쓴다 (관리 대상)
 *   { kind: 'block', path, content }  — 남의 파일에 마킹된 블록만 끼워넣는다
 * path 는 project 스코프면 저장소 기준 상대경로, global 스코프면 `~/` 로 시작한다.
 */

const frontmatter = (obj) => [
  '---',
  ...Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === 'string' && /[:#]/.test(v) ? JSON.stringify(v) : v}`),
  '---',
].join('\n');

const runLine = '한 사이클만 수행하고 멈춘다. 이어서 다음 작업을 시작하지 않는다.';

// 한 줄짜리 설명 칸(Cursor/Windsurf 의 rule description)은 길면 잘린다.
// 원본 description 을 자르면 문장 중간에서 끊기므로 전용 요약을 쓴다.
const SHORT = {
  loop: '자율 개발 루프 한 사이클: 지시서를 읽고 작업 하나만 구현·검증·커밋한 뒤 인수인계를 기록하고 멈춘다.',
  spec: '주제를 받아 저장소를 조사하고 자율 루프용 지시서(loop/design.md)와 작업 목록(loop/backlog.md)을 작성한다.',
};
const shortOf = (skill) => SHORT[skill.id] || skill.description.slice(0, 160);

const MARKETPLACE_NAME = 'anloop';
const PLUGIN_NAME = 'all-night-loop';

/** AGENTS.md / 기타 지시 파일에 끼워넣는 짧은 포인터. 본문은 별도 파일에 둔다. */
function pointerBlock() {
  return [
    '## 자율 개발 루프 (all-night-loop)',
    '',
    '사용자가 "지시서 만들어줘" / "SPEC 써줘" / "/all-night-spec" 이라고 하면',
    '**`.agent/skills/all-night-spec.md`** 를 읽고 그 절차를 따른다.',
    '주제를 받아 `loop/design.md` 와 `loop/backlog.md` 를 쓴다. 구현은 시작하지 않는다.',
    '',
    '사용자가 "밤새 돌려줘" / "자율 루프" / "혼자 개발해줘" / "/all-night-loop" 이라고 하면',
    '**`.agent/skills/all-night-loop.md`** 를 읽고 그 절차를 따른다.',
    '핵심: `loop/design.md` 를 읽고 → `loop/backlog.md` 에서 작업 **하나만** 골라 →',
    '구현 → 검증 → **통과 즉시 커밋** → `loop/status.md`·`loop/journal.md` 에 인수인계 기록 → 종료.',
    runLine,
  ].join('\n');
}

const claudeFiles = (ctx, base) => {
  const { skill, bundleText } = ctx;
  return [
    {
      kind: 'file',
      path: `${base}/skills/${skill.name}/SKILL.md`,
      content: `${frontmatter({ name: skill.name, description: skill.description })}\n\n${skill.body}\n`,
    },
    {
      kind: 'file',
      path: `${base}/skills/${skill.name}/reference/spec-writing.md`,
      content: `${skill.reference}\n`,
    },
    // 템플릿은 이를 나르는 스킬(loop)에만 딸려 간다.
    ...(skill.templates
      ? TEMPLATES.map((t) => ({
          kind: 'file',
          path: `${base}/skills/${skill.name}/templates/${t}.md`,
          content: skill.templates[t],
        }))
      : []),
    {
      kind: 'file',
      path: `${base}/commands/${skill.name}.md`,
      content: `${frontmatter({ description: shortOf(skill) })}\n\n${bundleText}\n`,
    },
  ];
};

export const adapters = [
  {
    id: 'claude',
    label: 'Claude Code',
    detect: { project: ['.claude'], global: ['~/.claude'] },
    scopes: ['project', 'global'],
    plan: (ctx) => claudeFiles(ctx, ctx.scope === 'global' ? '~/.claude' : '.claude'),
  },
  {
    id: 'codex',
    label: 'OpenAI Codex CLI',
    detect: { project: ['.codex', 'AGENTS.md'], global: ['~/.codex'] },
    scopes: ['project', 'global'],
    // Codex 는 프로젝트 지시를 AGENTS.md 로 읽는다. 그 파일은 `agents` 어댑터가 단독으로 관리한다.
    // (왜: 두 어댑터가 같은 마킹 블록을 서로 덮어쓰면 마지막 실행 순서에 따라 내용이 달라진다.)
    requires: ['agents'],
    plan: (ctx) => [
      {
        kind: 'file',
        path: `${ctx.scope === 'global' ? '~/.codex' : '.codex'}/prompts/${ctx.skill.name}.md`,
        content: `${ctx.bundleText}\n`,
      },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    detect: { project: ['.cursor'], global: [] },
    scopes: ['project'],
    plan: (ctx) => [
      {
        kind: 'file',
        path: `.cursor/rules/${ctx.skill.name}.mdc`,
        content: `${frontmatter({
          description: shortOf(ctx.skill),
          globs: '',
          alwaysApply: false,
        })}\n\n${ctx.bundleText}\n`,
      },
      {
        kind: 'file',
        path: `.cursor/commands/${ctx.skill.name}.md`,
        content: `${ctx.bundleText}\n`,
      },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    detect: { project: ['.gemini'], global: ['~/.gemini'] },
    scopes: ['project', 'global'],
    plan: (ctx) => {
      const base = ctx.scope === 'global' ? '~/.gemini' : '.gemini';
      // TOML 리터럴 문자열(''')은 이스케이프가 없어 마크다운을 그대로 담을 수 있다.
      const body = ctx.bundleText.includes("'''") ? ctx.bundleText.replaceAll("'''", '``') : ctx.bundleText;
      return [
        {
          kind: 'file',
          path: `${base}/commands/${ctx.skill.name}.toml`,
          content: `# all-night-loop\ndescription = ${JSON.stringify('자율 개발 루프 한 사이클')}\nprompt = '''\n${body}\n'''\n`,
        },
      ];
    },
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    detect: { project: ['.github/copilot-instructions.md', '.github/prompts'], global: [] },
    scopes: ['project'],
    plan: (ctx) => [
      {
        kind: 'file',
        path: `.github/prompts/${ctx.skill.name}.prompt.md`,
        content: `${frontmatter({ mode: 'agent', description: shortOf(ctx.skill) })}\n\n${ctx.bundleText}\n`,
      },
    ],
  },
  {
    id: 'cline',
    label: 'Cline / Roo',
    detect: { project: ['.clinerules', '.roo'], global: [] },
    scopes: ['project'],
    plan: (ctx) => [
      { kind: 'file', path: `.clinerules/${ctx.skill.name}.md`, content: `${ctx.bundleText}\n` },
    ],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    detect: { project: ['.windsurf'], global: [] },
    scopes: ['project'],
    plan: (ctx) => [
      {
        kind: 'file',
        path: `.windsurf/rules/${ctx.skill.name}.md`,
        content: `${frontmatter({ trigger: 'model_decision', description: shortOf(ctx.skill) })}\n\n${ctx.bundleText}\n`,
      },
    ],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    detect: { project: ['.opencode'], global: ['~/.config/opencode'] },
    scopes: ['project', 'global'],
    plan: (ctx) => {
      const base = ctx.scope === 'global' ? '~/.config/opencode' : '.opencode';
      return [
        {
          kind: 'file',
          path: `${base}/command/${ctx.skill.name}.md`,
          content: `${frontmatter({ description: shortOf(ctx.skill) })}\n\n${ctx.bundleText}\n`,
        },
      ];
    },
  },
  {
    id: 'plugin',
    label: 'Claude Code 플러그인 마켓플레이스 (배포용)',
    detect: { project: ['.claude-plugin'], global: [] },
    scopes: ['project'],
    // 이건 "이 저장소를 마켓플레이스로 publish" 하기 위한 것이지, 남의 프로젝트에 설치할 것이 아니다.
    // 그래서 자동 감지와 --all 에서 빼고 이름을 직접 적었을 때만 생성한다.
    optIn: true,
    plan: (ctx) => {
      const root = `plugins/${PLUGIN_NAME}`;
      const perSkill = [
        {
          kind: 'file',
          path: `${root}/skills/${ctx.skill.name}/SKILL.md`,
          content: `${frontmatter({ name: ctx.skill.name, description: ctx.skill.description })}\n\n${ctx.skill.body}\n`,
        },
        {
          kind: 'file',
          path: `${root}/skills/${ctx.skill.name}/reference/spec-writing.md`,
          content: `${ctx.skill.reference}\n`,
        },
        ...(ctx.skill.templates
          ? TEMPLATES.map((t) => ({
              kind: 'file',
              path: `${root}/skills/${ctx.skill.name}/templates/${t}.md`,
              content: ctx.skill.templates[t],
            }))
          : []),
        {
          kind: 'file',
          path: `${root}/commands/${ctx.skill.name}.md`,
          content: `${frontmatter({ description: shortOf(ctx.skill) })}\n\n${ctx.bundleText}\n`,
        },
      ];
      // 마켓플레이스·매니페스트는 저장소당 하나다. 스킬마다 쓰면 서로 덮어쓴다.
      if (ctx.skill.id !== 'loop') return perSkill;
      return [
        {
          kind: 'file',
          path: '.claude-plugin/marketplace.json',
          content: JSON.stringify(
            {
              name: MARKETPLACE_NAME,
              owner: { name: 'newrise0410', url: 'https://github.com/newrise0410' },
              plugins: [
                {
                  name: PLUGIN_NAME,
                  source: `./plugins/${PLUGIN_NAME}`,
                  description: '지시서를 읽고 작업 하나만 구현·검증·커밋한 뒤 인수인계를 기록하는 자율 개발 루프',
                },
              ],
            },
            null,
            2,
          ) + '\n',
        },
        {
          kind: 'file',
          path: `${root}/.claude-plugin/plugin.json`,
          content: JSON.stringify(
            {
              name: PLUGIN_NAME,
              // version 을 올려야 사용자에게 업데이트가 나간다 — package.json 과 함께 움직이게 묶는다.
              version: PKG_VERSION,
              description: '자율 개발 루프 — 지시서 작성(all-night-spec)과 1사이클 실행(all-night-loop)',
              homepage: 'https://github.com/newrise0410/all-night-loop',
            },
            null,
            2,
          ) + '\n',
        },
        ...perSkill,
      ];
    },
  },
  {
    id: 'agents',
    label: 'AGENTS.md (표준 — 그 외 모든 에이전트)',
    detect: { project: ['AGENTS.md'], global: [] },
    scopes: ['project'],
    plan: (ctx) => [
      { kind: 'file', path: `.agent/skills/${ctx.skill.name}.md`, content: `${ctx.bundleText}\n` },
      // 블록은 두 스킬을 함께 안내하므로 한 번만 쓴다. 스킬마다 쓰면 서로 덮어쓴다.
      ...(ctx.skill.id === 'loop' ? [{ kind: 'block', path: 'AGENTS.md', content: pointerBlock() }] : []),
    ],
  },
];

export const byId = (id) => adapters.find((a) => a.id === id);
export const ids = adapters.map((a) => a.id);
