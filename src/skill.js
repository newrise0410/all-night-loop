import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.join(PKG_ROOT, 'skill');
export const TEMPLATE_DIR = path.join(SKILL_DIR, 'templates');
export const TEMPLATES = ['SPEC', 'BACKLOG', 'HANDOFF', 'JOURNAL'];

/** 정본 스킬 파일. id 는 CLI·문서에서 쓰는 짧은 이름이다. */
const SOURCES = [
  { id: 'loop', file: 'loop.md', withTemplates: true },
  { id: 'spec', file: 'spec.md', withTemplates: false },
];

/**
 * 아주 작은 YAML frontmatter 파서. name/description 두 개의 스칼라만 읽는다.
 * (왜: 전역 설치되는 CLI 에 의존성을 들이면 설치 실패 확률만 올라간다. 의존성 0을 유지한다.)
 */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: raw.slice(m[0].length).trim() };
}

let cached = null;

export function loadSkills() {
  if (cached) return cached;
  const reference = fs.readFileSync(path.join(SKILL_DIR, 'reference', 'spec-writing.md'), 'utf8').trim();
  const templates = Object.fromEntries(
    TEMPLATES.map((t) => [t, fs.readFileSync(path.join(TEMPLATE_DIR, `${t}.md`), 'utf8')]),
  );
  cached = SOURCES.map((s) => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(SKILL_DIR, s.file), 'utf8'));
    return {
      id: s.id,
      name: meta.name,
      description: meta.description || '',
      body,
      reference,
      // 템플릿 파일은 루프 스킬에만 딸려 간다 — spec 스킬은 그 템플릿을 채우는 쪽이지 나르는 쪽이 아니다.
      templates: s.withTemplates ? templates : null,
    };
  });
  return cached;
}

export const getSkill = (id) => loadSkills().find((s) => s.id === id);

/** 하위 호환 및 단수 호출 지점용. */
export const loadSkill = () => getSkill('loop');

/**
 * 스킬 디렉터리 개념이 없는 도구(Cursor/Gemini/Copilot 등)를 위한 단일 파일 번들.
 * 참조 가이드를 부록으로 붙여 파일 하나로 자족하게 만든다.
 */
export function bundle(skill = loadSkill()) {
  const appendix =
    skill.id === 'spec'
      ? ['# 부록 — 지시서(SPEC) 작성 5요소 상세', '', '> 위 절차 3단계에서 쓸 기준이다.', '']
      : [
          '# 부록 — 지시서(SPEC) 작성 가이드',
          '',
          '> `loop/SPEC.md` 가 비어 있거나 없을 때만 필요하다. 이미 채워져 있으면 읽지 않아도 된다.',
          '',
        ];
  return [`# ${skill.name}`, '', skill.body, '', '---', '', ...appendix, stripH1(skill.reference)].join('\n');
}

function stripH1(md) {
  return md.replace(/^#\s+.*\r?\n+/, '');
}

/** 어느 도구에서든 붙여넣어 쓸 수 있는 1사이클 실행 프롬프트. */
export function cyclePrompt(skill = loadSkill()) {
  return [
    '아래 절차를 **정확히 한 사이클만** 수행하라. 작업 하나를 끝내고 커밋·기록한 뒤 멈춘다.',
    '여러 작업을 이어서 하지 마라.',
    '',
    bundle(skill),
  ].join('\n');
}

/**
 * 주제(와 선택적 인터뷰 답변)로 SPEC·BACKLOG 를 쓰게 하는 프롬프트.
 * 주제를 절차보다 먼저 놓는다 — 긴 절차 뒤에 묻히면 모델이 주제를 흘린다.
 */
export function specPrompt(topic, answers = null) {
  const skill = getSkill('spec');
  const head = [
    `아래 주제로 자율 개발 루프용 지시서를 작성하라. 구현은 시작하지 마라.`,
    '',
    `## 주제`,
    '',
    topic.trim(),
  ];
  if (answers && answers.length) {
    head.push(
      '',
      '## 인터뷰 답변',
      '',
      '사람이 직접 답한 내용이다. 저장소 조사보다 우선한다. 빈 항목만 조사로 채워라.',
      '',
      ...answers.map(({ q, a }) => `- **${q}**\n  ${a.trim() ? a.trim() : '(답변 없음 — 저장소에서 판단하라)'}`),
    );
  }
  head.push('', '---', '', bundle(skill));
  return head.join('\n');
}
