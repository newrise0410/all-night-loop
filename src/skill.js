import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.join(PKG_ROOT, 'skill');
export const TEMPLATE_DIR = path.join(SKILL_DIR, 'templates');
export const TEMPLATES = ['SPEC', 'BACKLOG', 'HANDOFF', 'JOURNAL'];

/** 플러그인 매니페스트의 version 을 패키지 버전과 묶는다 — 따로 놀면 한쪽만 올라간다. */
export const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

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
/**
 * withGuide: SPEC 작성 가이드(2.6천자)를 붙일지.
 *
 * 왜 기본이 false 인가: 루프는 이미 작성된 SPEC 을 "읽고 실행"할 뿐 작성하지 않는다.
 * 가이드를 매 사이클 보내면 실행 프롬프트의 38%가 안 쓰는 내용이 된다 — 50사이클이면
 * 13만자를 반복 전송한다. "있어도 안 읽으면 된다"는 문장은 입력량을 줄이지 못한다.
 */
export function bundle(skill = loadSkill(), { withGuide = skill.id === 'spec' } = {}) {
  const head = [`# ${skill.name}`, '', skill.body];
  if (!withGuide) return head.join('\n');
  return [
    ...head,
    '',
    '---',
    '',
    '# 부록 — 지시서(SPEC) 작성 5요소 상세',
    '',
    '> 위 절차 3단계에서 쓸 기준이다.',
    '',
    stripH1(skill.reference),
  ].join('\n');
}

function stripH1(md) {
  return md.replace(/^#\s+.*\r?\n+/, '');
}

/** 스킬 본문의 `loop/` 경로를 실제 상태 디렉터리로 바꾼다. */
function retargetLoopDir(text, loopDir) {
  if (loopDir === 'loop') return text;
  return text
    .replace(/\bloop\/(SPEC|BACKLOG|HANDOFF|JOURNAL|DONE)\.md/g, `${loopDir}/$1.md`)
    .replace(/\bloop\/USAGE\.jsonl/g, `${loopDir}/USAGE.jsonl`)
    .replace(/`loop\/`/g, `\`${loopDir}/\``)
    .replace(/\bloop\/\.state\b/g, `${loopDir}/.state`);
}

export const STATE_DIR = '.state';
export const RESULT_FILE = 'cycle.json';

/**
 * 1사이클 실행 프롬프트.
 * runId/cycle 을 실어 보내는 이유: 에이전트가 쓴 결과가 **이번 사이클의 것인지** 확인해야
 * 지난 사이클의 낡은 상태를 종료 신호로 오인하지 않는다.
 */
export function cyclePrompt(skill = loadSkill(), { loopDir = 'loop', runId = null, cycle = null } = {}) {
  const head = [
    '아래 절차를 **정확히 한 사이클만** 수행하라. 작업 하나를 끝내고 커밋·기록한 뒤 멈춘다.',
    '여러 작업을 이어서 하지 마라.',
  ];
  if (runId && cycle) {
    head.push(
      '',
      '## 이번 사이클',
      '',
      `- run_id: \`${runId}\``,
      `- cycle: \`${cycle}\``,
      '',
      `마지막 단계에서 \`${loopDir}/${STATE_DIR}/${RESULT_FILE}\` 에 **이 값 그대로** 아래 JSON 을 써라.`,
      '바깥 하네스는 이 파일만 보고 루프를 계속할지 정한다. run_id/cycle 이 다르면 무시된다.',
      '',
      '```json',
      '{',
      `  "run_id": "${runId}",`,
      `  "cycle": ${cycle},`,
      '  "task": "T001",',
      '  "status": "done | all_done | blocked | needs_spec",',
      '  "verified": "실행한 검증 명령과 결과",',
      '  "verify_attempts": 1,',
      '  "commit": "작업 커밋 해시 (없으면 null)"',
      '}',
      '```',
      '',
      '- `done` — 작업 하나를 끝냈고 남은 작업이 있다',
      '- `all_done` — BACKLOG 에 `[ ]`/`[~]` 가 하나도 없다',
      '- `blocked` — 3회 실패 등으로 사람이 필요하다 (커밋하지 않았다)',
      '- `needs_spec` — 지시서가 모호해 판단 불가',
      '',
      '`verify_attempts` 는 검증 명령을 몇 번 돌렸는지다 (한 번에 통과했으면 1).',
      '**검증을 실제로 통과하지 않았다면 `done`/`all_done` 을 쓰지 마라.**',
    );
  }
  let body = bundle(skill, { withGuide: false });
  // 계약을 머리말에 실었으면 본문의 같은 설명은 지운다 — 같은 내용을 두 번 보낼 이유가 없다.
  if (runId && cycle) body = dropSection(body, '## 루프 종료 신호');
  return [...head, '', retargetLoopDir(body, loopDir)].join('\n');
}

/** 마크다운에서 한 섹션을 다음 같은 레벨 제목 직전까지 들어낸다. */
function dropSection(md, heading) {
  const start = md.indexOf(`\n${heading}`);
  if (start === -1) return md;
  const rest = md.slice(start + 1);
  const next = rest.indexOf('\n## ', heading.length);
  return next === -1 ? md.slice(0, start) : md.slice(0, start) + rest.slice(next);
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
