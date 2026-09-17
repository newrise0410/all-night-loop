import path from 'node:path';
import { adapters, byId } from '../adapters.js';
import { loadSkill, loadSkills, getSkill, bundle, cyclePrompt } from '../skill.js';
import { c, log, fail, expand, exists, removeBlock, findRoot, readIfExists } from '../util.js';
import { RUNNERS } from '../runner.js';
import fs from 'node:fs';

/** 한글은 터미널에서 두 칸을 먹는다. 표가 어긋나지 않게 표시폭 기준으로 채운다. */
const width = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

export function doctor(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  log(c.bold('저장소'), c.dim(root));
  log('');
  log(c.bold('에이전트 감지'));
  for (const a of adapters) {
    const p = a.detect.project.map((x) => path.join(root, x)).find((x) => exists(x));
    const g = a.detect.global.find((x) => exists(x));
    const where = [p && c.green('project'), g && c.green('global')].filter(Boolean).join(' + ');
    log(`  ${where ? c.green('o') : c.dim('.')} ${pad(a.label, 40)} ${where || c.dim('없음')}`);
  }
  log('');
  log(c.bold('실행기(CLI) 감지'));
  for (const [id, [cmd]] of Object.entries(RUNNERS)) {
    const found = which(cmd);
    log(`  ${found ? c.green('o') : c.dim('.')} ${pad(id, 10)} ${found ? c.dim(found) : c.dim(`${cmd} 없음`)}`);
  }
  log('');
  log(c.bold('루프 상태'));
  const dir = path.join(root, argv.loopDir || 'loop');
  const spec = readIfExists(path.join(dir, 'SPEC.md'));
  if (!spec) {
    log(`  ${c.yellow('!')} loop/SPEC.md 없음 → ${c.cyan('anloop init')}`);
  } else if (spec.includes('<검증 명령 1>')) {
    log(`  ${c.yellow('!')} loop/SPEC.md 가 아직 템플릿이다 → 직접 채워야 루프가 돈다`);
  } else {
    log(`  ${c.green('o')} loop/SPEC.md 작성됨`);
  }
  const backlog = readIfExists(path.join(dir, 'BACKLOG.md'));
  if (backlog) {
    const n = (s) => (backlog.match(new RegExp(`^\\s*-? ?\\[${s}\\]`, 'gm')) || []).length;
    log(`  ${c.dim('BACKLOG')} 대기 ${n(' ')} · 진행 ${n('~')} · 완료 ${n('x')} · 막힘 ${n('!')}`);
  }
}

function which(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

export function list() {
  log(c.bold('설치되는 스킬'));
  for (const s of loadSkills()) log(`  ${c.cyan(pad(s.id, 10))} ${s.name}`);
  log('');
  log(c.bold('설치 가능한 대상'));
  for (const a of adapters) {
    log(`  ${c.cyan(pad(a.id, 10))} ${a.label} ${c.dim(`[${a.scopes.join(', ')}]`)}`);
  }
  log('');
  log(c.bold('loop 실행기'));
  for (const [id, [cmd, args]] of Object.entries(RUNNERS)) {
    log(`  ${c.cyan(pad(id, 10))} ${c.dim(`${cmd} ${args.join(' ')}`)}`);
  }
}

export function printPrompt(argv) {
  const skill = getSkill(argv._[0] || 'loop');
  if (!skill) return fail(`모르는 스킬: ${argv._[0]} (loop | spec)`);
  process.stdout.write(argv.bundle || skill.id === 'spec' ? bundle(skill) : cyclePrompt(skill));
  process.stdout.write('\n');
}

export function guide() {
  process.stdout.write(loadSkill().reference + '\n');
}

export function uninstall(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const scope = argv.global ? 'global' : 'project';
  const targets = argv._.length ? argv._.map(byId).filter(Boolean) : adapters;
  for (const a of targets) {
    if (!a.scopes.includes(scope)) continue;
    const items = loadSkills().flatMap((skill) => a.plan({ skill, bundleText: bundle(skill), scope, root }));
    for (const item of items) {
      const abs = item.path.startsWith('~/') ? expand(item.path) : path.join(root, item.path);
      if (item.kind === 'block') {
        const r = removeBlock(abs, { dryRun: argv['dry-run'] });
        if (r === 'remove') log(`  ${c.red('-')} ${item.path} ${c.dim('(블록)')}`);
      } else if (fs.existsSync(abs)) {
        if (!argv['dry-run']) fs.rmSync(abs, { force: true });
        log(`  ${c.red('-')} ${item.path}`);
      }
    }
  }
  log(c.dim('\nloop/ 의 SPEC·BACKLOG·HANDOFF·JOURNAL 은 남겨뒀다 — 작업 기록이라 직접 지워야 한다.'));
}
