import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_DIR = path.join(PKG_ROOT, 'skill');
export const TEMPLATE_DIR = path.join(SKILL_DIR, 'templates');
export const TEMPLATES = ['SPEC', 'BACKLOG', 'HANDOFF', 'JOURNAL'];

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

export function loadSkill() {
  if (cached) return cached;
  const raw = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const reference = fs.readFileSync(path.join(SKILL_DIR, 'reference', 'spec-writing.md'), 'utf8').trim();
  const templates = Object.fromEntries(
    TEMPLATES.map((t) => [t, fs.readFileSync(path.join(TEMPLATE_DIR, `${t}.md`), 'utf8')]),
  );
  cached = {
    name: meta.name || 'all-night-loop',
    description: meta.description || '',
    body,
    reference,
    templates,
  };
  return cached;
}

/**
 * 스킬 디렉터리 개념이 없는 도구(Cursor/Gemini/Copilot 등)를 위한 단일 파일 번들.
 * 참조 가이드를 부록으로 붙여 파일 하나로 자족하게 만든다.
 */
export function bundle(skill = loadSkill()) {
  return [
    `# ${skill.name}`,
    '',
    skill.body,
    '',
    '---',
    '',
    '# 부록 — 지시서(SPEC) 작성 가이드',
    '',
    '> `loop/SPEC.md` 가 비어 있거나 없을 때만 필요하다. 이미 채워져 있으면 읽지 않아도 된다.',
    '',
    stripH1(skill.reference),
  ].join('\n');
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
