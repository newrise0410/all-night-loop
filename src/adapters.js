import { TEMPLATES } from './skill.js';

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
const SHORT = '자율 개발 루프 한 사이클: 지시서를 읽고 작업 하나만 구현·검증·커밋한 뒤 인수인계를 기록하고 멈춘다.';

/** AGENTS.md / 기타 지시 파일에 끼워넣는 짧은 포인터. 본문은 별도 파일에 둔다. */
function pointerBlock(skill, target = '.agent/skills/all-night-loop.md') {
  return [
    '## 자율 개발 루프 (all-night-loop)',
    '',
    `사용자가 "밤새 돌려줘" / "자율 루프" / "혼자 개발해줘" / "/all-night-loop" 이라고 하면`,
    `**\`${target}\` 을 읽고 그 절차를 따른다.**`,
    '',
    `핵심: 지시서 \`loop/SPEC.md\` 를 읽고 → \`loop/BACKLOG.md\` 에서 작업 **하나만** 골라 →`,
    `구현 → 검증 → **통과 즉시 커밋** → \`loop/HANDOFF.md\`·\`loop/JOURNAL.md\` 에 인수인계 기록 → 종료.`,
    `${runLine}`,
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
    ...TEMPLATES.map((t) => ({
      kind: 'file',
      path: `${base}/skills/${skill.name}/templates/${t}.md`,
      content: skill.templates[t],
    })),
    {
      kind: 'file',
      path: `${base}/commands/${skill.name}.md`,
      content: `${frontmatter({ description: '자율 개발 루프 한 사이클 (all-night-loop)' })}\n\n${bundleText}\n`,
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
          description: SHORT,
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
        content: `${frontmatter({ mode: 'agent', description: '자율 개발 루프 한 사이클 (all-night-loop)' })}\n\n${ctx.bundleText}\n`,
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
        content: `${frontmatter({ trigger: 'model_decision', description: SHORT })}\n\n${ctx.bundleText}\n`,
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
          content: `${frontmatter({ description: '자율 개발 루프 한 사이클 (all-night-loop)' })}\n\n${ctx.bundleText}\n`,
        },
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
      { kind: 'block', path: 'AGENTS.md', content: pointerBlock(ctx.skill) },
    ],
  },
];

export const byId = (id) => adapters.find((a) => a.id === id);
export const ids = adapters.map((a) => a.id);
