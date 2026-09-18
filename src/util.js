import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ESC = String.fromCharCode(27);
const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
const wrap = (code) => (s) => (NO_COLOR ? s : `${ESC}[${code}m${s}${ESC}[0m`);
export const c = {
  dim: wrap('2'), bold: wrap('1'), red: wrap('31'),
  green: wrap('32'), yellow: wrap('33'), cyan: wrap('36'),
};

export const log = (...a) => console.log(...a);
export const warn = (...a) => console.error(c.yellow('warn'), ...a);
export const fail = (msg) => { console.error(c.red('error'), msg); process.exit(1); };

/** `~/foo` 를 절대경로로. (왜: 어댑터 경로 표를 사람이 읽기 좋게 유지하려고) */
export function expand(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export function exists(p) {
  try { fs.accessSync(expand(p)); return true; } catch { return false; }
}

export const MARK = 'all-night-loop';

/**
 * 우리가 생성한 파일인지. 사람이 손으로 쓴 파일을 덮어쓰지 않기 위한 방어.
 *
 * 전에는 'all-night-loop' 문자열 하나만 봤다. 그러면 all-night-spec 쪽 생성물처럼
 * 그 문자열이 없는 파일이 "사람이 만든 것"으로 오판돼 **업데이트가 조용히 건너뛰어진다**.
 * 두 스킬 이름을 모두 보고, 앞으로는 명시적 표식도 함께 본다.
 */
export function isManaged(text) {
  const head = text.slice(0, 4000);
  return head.includes(`${MARK}:generated`) || head.includes(MARK) || head.includes('all-night-spec');
}

/**
 * 우리가 통째로 소유한 경로인가.
 *
 * 스킬 폴더와 플러그인 폴더는 전부 우리가 만든 것이다 — 내용을 추측할 필요 없이 덮어써도 된다.
 * 내용 추측(isManaged)은 `.claude/commands/` 나 `AGENTS.md` 처럼 사용자의 다른 파일이
 * 섞이는 곳에만 쓴다. 추측에 기대면 표식 없는 짧은 템플릿이 "사람이 만든 것"으로 오판돼
 * 업데이트가 조용히 건너뛰어진다.
 */
/**
 * 공유 디렉터리(.claude/commands, .cursor/rules ...)에 쓰는 파일에 표식을 박는다.
 * frontmatter 가 있으면 그 뒤에 넣는다 — 맨 앞에 넣으면 frontmatter 가 깨진다.
 */
export function withMarker(content, p) {
  const tag = `${MARK}:generated`;
  if (content.includes(tag)) return content;
  if (p.endsWith('.toml')) return `# ${tag}\n${content}`;
  if (!p.endsWith('.md') && !p.endsWith('.mdc')) return content;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(content);
  const line = `<!-- ${tag} -->\n`;
  return fm ? content.slice(0, fm[0].length) + line + content.slice(fm[0].length) : line + content;
}

export function isOwnedPath(p) {
  return /(^|\/)skills\/[^/]+\//.test(p) || p.startsWith('plugins/') || p.includes('/skills/');
}

/** 내용이 같으면 쓰지 않는다 — mtime 을 흔들면 에디터가 불필요하게 다시 읽는다. */
export function writeFile(abs, content, { force = false, dryRun = false, owned = false } = {}) {
  const prev = readIfExists(abs);
  if (prev === content) return 'same';
  if (prev !== null && !force && !owned && !isManaged(prev)) return 'skipped';
  if (dryRun) return prev === null ? 'create' : 'update';
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return prev === null ? 'create' : 'update';
}

/** AGENTS.md 처럼 남의 파일에 블록만 끼워넣는다. 있으면 교체, 없으면 뒤에 추가. */
export function upsertBlock(abs, block, { dryRun = false } = {}) {
  const start = `<!-- ${MARK}:start -->`;
  const end = `<!-- ${MARK}:end -->`;
  const payload = `${start}\n${block.trim()}\n${end}`;
  const prev = readIfExists(abs);
  if (prev === null) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, payload + '\n');
    }
    return 'create';
  }
  const i = prev.indexOf(start);
  const j = prev.indexOf(end);
  let next;
  if (i !== -1 && j !== -1 && j > i) {
    next = prev.slice(0, i) + payload + prev.slice(j + end.length);
  } else {
    next = prev.replace(/\s*$/, '') + `\n\n${payload}\n`;
  }
  if (next === prev) return 'same';
  if (!dryRun) fs.writeFileSync(abs, next);
  return 'update';
}

export function removeBlock(abs, { dryRun = false } = {}) {
  const start = `<!-- ${MARK}:start -->`;
  const end = `<!-- ${MARK}:end -->`;
  const prev = readIfExists(abs);
  if (prev === null) return 'missing';
  const i = prev.indexOf(start);
  const j = prev.indexOf(end);
  if (i === -1 || j === -1) return 'missing';
  const next = (prev.slice(0, i) + prev.slice(j + end.length)).replace(/\n{3,}/g, '\n\n').trim();
  if (!dryRun) {
    if (next === '') fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, next + '\n');
  }
  return 'remove';
}

/** git 저장소 루트. 없으면 cwd. (왜: 하위 디렉터리에서 실행해도 같은 곳에 설치돼야 한다) */
export function findRoot(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}
