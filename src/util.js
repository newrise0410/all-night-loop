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

/** 우리가 생성한 파일인지. 사람이 손으로 쓴 파일을 덮어쓰지 않기 위한 방어. */
export function isManaged(text) {
  return text.slice(0, 2000).includes(MARK);
}

/** 내용이 같으면 쓰지 않는다 — mtime 을 흔들면 에디터가 불필요하게 다시 읽는다. */
export function writeFile(abs, content, { force = false, dryRun = false } = {}) {
  const prev = readIfExists(abs);
  if (prev === content) return 'same';
  if (prev !== null && !force && !isManaged(prev)) return 'skipped';
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
