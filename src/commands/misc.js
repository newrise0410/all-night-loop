import path from 'node:path';
import { adapters, byId } from '../adapters.js';
import { loadSkill, loadSkills, getSkill, bundle, cyclePrompt, FILES, LEGACY } from '../skill.js';
import { c, log, warn, fail, expand, exists, removeBlock, findRoot, readIfExists } from '../util.js';
import { RUNNERS, which } from '../runner.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readUsage, usagePath } from '../usage.js';
import { formatSummary, countInboxPending } from './loop.js';

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
  const design = readIfExists(path.join(dir, FILES.design));
  if (!design) {
    const old = readIfExists(path.join(dir, 'SPEC.md'));
    if (old) log(`  ${c.yellow('!')} 옛 이름 SPEC.md 가 있다 → ${c.cyan('anloop migrate')}`);
    else log(`  ${c.yellow('!')} ${FILES.design} 없음 → ${c.cyan('anloop spec "주제"')}`);
  } else if (design.includes('<검증 명령 1>')) {
    log(`  ${c.yellow('!')} ${FILES.design} 가 아직 템플릿이다 → 직접 채워야 루프가 돈다`);
  } else {
    log(`  ${c.green('o')} ${FILES.design} 작성됨`);
  }
  const inbox = readIfExists(path.join(dir, FILES.inbox));
  if (inbox) log(`  ${c.dim('inbox')} 대기 ${countInboxPending(inbox)}건`);
  const backlog = readIfExists(path.join(dir, FILES.backlog)) || readIfExists(path.join(dir, 'BACKLOG.md'));
  if (backlog) {
    const n = (s) => (backlog.match(new RegExp(`^\\s*-? ?\\[${s}\\]`, 'gm')) || []).length;
    log(`  ${c.dim('BACKLOG')} 대기 ${n(' ')} · 진행 ${n('~')} · 완료 ${n('x')} · 막힘 ${n('!')}`);
  }
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
  for (const [id, [cmd, args, useStdin]] of Object.entries(RUNNERS)) {
    log(`  ${c.cyan(pad(id, 10))} ${c.dim(`${cmd} ${args.join(' ')}${useStdin ? '  < stdin' : ''}`)}`);
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

export function usage(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const loopDir = argv.loopDir || 'loop';
  const rows = readUsage(root, loopDir);
  if (!rows.length) {
    log(c.yellow(`${loopDir}/USAGE.jsonl 에 기록이 없다.`));
    log(c.dim('  기록하려면: ') + c.cyan('anloop loop --usage') + c.dim('  (--budget-usd 를 주면 자동으로 켜진다)'));
    return;
  }
  const runs = [...new Set(rows.map((r) => r.run_id))];
  log(c.bold('전체') + c.dim(` — ${runs.length}개 실행 · ${usagePath(root, loopDir)}`));
  log(formatSummary(rows));

  if (argv.all || runs.length === 1) {
    for (const id of runs) {
      const mine = rows.filter((r) => r.run_id === id);
      log('');
      log(c.bold(`run ${id}`) + c.dim(` — ${mine[0].ts?.slice(0, 16).replace('T', ' ')}`));
      log(formatSummary(mine));
      for (const r of mine) {
        const cost = r.cost_usd != null ? `$${Number(r.cost_usd).toFixed(3)}` : '—';
        log(
          c.dim(
            `    #${r.cycle} ${pad(r.task || '-', 8)} ${pad(r.status || '-', 14)} ` +
              `${pad(`${r.duration_s ?? '-'}초`, 7)} ${pad(cost, 8)}` +
              (r.verify_attempts ? ` 검증 ${r.verify_attempts}회` : ''),
          ),
        );
      }
    }
  } else {
    log(c.dim('\n  실행별 내역: ') + c.cyan('anloop usage --all'));
  }
}

/**
 * 옛 이름(SPEC/BACKLOG/HANDOFF/JOURNAL/DONE)을 새 이름으로 옮긴다.
 * 루프는 이걸 자동으로 하지 않는다 — 사람이 직접 실행할 때만 파일이 움직인다.
 */
export function migrate(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const loopDir = argv.loopDir || 'loop';
  const dir = path.join(root, loopDir);

  const moves = Object.entries(LEGACY)
    .map(([old, next]) => ({ old, next, from: path.join(dir, old), to: path.join(dir, next) }))
    .filter((m) => fs.existsSync(m.from));

  if (!moves.length) return log(c.green(`${loopDir}/ 에 옮길 옛 이름 파일이 없다.`));

  for (const m of moves) {
    // macOS·Windows 는 파일명 대소문자를 구분하지 않는다. BACKLOG.md → backlog.md 같은
    // 대소문자만 다른 이름은 existsSync 가 "이미 있다"고 답하므로 따로 구분해야 한다.
    const caseOnly = m.old.toLowerCase() === m.next.toLowerCase();
    if (!caseOnly && fs.existsSync(m.to)) {
      warn(`${loopDir}/${m.next} 가 이미 있다 — ${m.old} 는 그대로 둔다. 직접 합쳐라.`);
      continue;
    }
    if (argv['dry-run']) {
      log(`  ${c.cyan('~')} ${loopDir}/${m.old} → ${m.next}`);
      continue;
    }
    // git 이 이름 변경을 추적하도록 git mv 를 먼저 시도한다. 대소문자만 바뀔 때는 -f 가 필요하다.
    const args = caseOnly ? ['mv', '-f', m.old, m.next] : ['mv', m.old, m.next];
    const tracked = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (tracked.status !== 0) {
      // 추적되지 않은 파일이거나 git 이 없을 때. 대소문자만 바뀌면 임시 이름을 거쳐야 한다.
      if (caseOnly) {
        const tmp = path.join(dir, `${m.next}.anloop-tmp`);
        fs.renameSync(m.from, tmp);
        fs.renameSync(tmp, m.to);
      } else {
        fs.renameSync(m.from, m.to);
      }
    }
    log(`  ${c.green('→')} ${loopDir}/${m.old} → ${m.next}`);
  }
  if (argv['dry-run']) return log(c.yellow('\ndry-run — 아무것도 옮기지 않았다.'));
  log(c.dim('\n커밋은 직접 해라. 옮긴 것 말고 다른 변경이 섞여 있을 수 있다.'));
}
