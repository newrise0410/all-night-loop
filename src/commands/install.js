import path from 'node:path';
import { adapters, byId, ids } from '../adapters.js';
import { loadSkills, bundle } from '../skill.js';
import fs from 'node:fs';
import { c, log, warn, fail, expand, writeFile, upsertBlock, findRoot, exists, isManaged, isOwnedPath, withMarker, readIfExists } from '../util.js';

const ICON = { create: c.green('+'), update: c.cyan('~'), same: c.dim('='), skipped: c.yellow('!') };

export function detectInstalled(root) {
  return adapters.filter((a) =>
    [...a.detect.project.map((p) => path.join(root, p)), ...a.detect.global].some((p) => exists(p)),
  );
}

/** requires 를 따라가며 대상 집합을 닫는다. */
function closure(list) {
  const out = [];
  const visit = (a) => {
    if (!a || out.includes(a)) return;
    out.push(a);
    (a.requires || []).forEach((r) => visit(byId(r)));
  };
  list.forEach(visit);
  return out;
}

export function install(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const scope = argv.global ? 'global' : 'project';
  const skills = loadSkills();

  let targets;
  if (argv.all) {
    targets = adapters.filter((a) => !a.optIn);
  } else if (argv._.length) {
    targets = argv._.map((id) => byId(id) || fail(`알 수 없는 대상: ${id}\n사용 가능: ${ids.join(', ')}`));
  } else {
    const found = detectInstalled(root).filter((a) => !a.optIn);
    targets = found.length ? found : [byId('agents'), byId('claude')];
    log(
      c.dim(
        found.length
          ? `감지된 도구에 설치: ${found.map((t) => t.id).join(', ')}`
          : '감지된 도구 없음 → 범용(agents) + claude 로 설치',
      ),
    );
  }

  targets = closure(targets).filter((a) => {
    if (a.scopes.includes(scope)) return true;
    warn(`${a.label}: ${scope} 스코프를 지원하지 않아 건너뜀`);
    return false;
  });

  if (!targets.length) fail('설치할 대상이 없다.');

  let wrote = 0;
  let blocked = 0;
  const plannedByAdapter = new Map();
  for (const a of targets) {
    log(`\n${c.bold(a.label)} ${c.dim(`(${a.id}, ${scope})`)}`);
    for (const skill of skills) {
      const planned = a.plan({ skill, bundleText: bundle(skill), root, scope });
      plannedByAdapter.set(`${a.id}:${skill.id}`, planned);
      for (const item of planned) {
        const abs = item.path.startsWith('~/') ? expand(item.path) : path.join(root, item.path);
        const owned = isOwnedPath(item.path);
        // 소유하지 않은 폴더의 파일에는 표식을 박아 다음 업데이트 때 우리 것임을 알아보게 한다.
        const content = owned ? item.content : withMarker(item.content, item.path);
        const res =
          item.kind === 'block'
            ? upsertBlock(abs, item.content, { dryRun: argv['dry-run'] })
            : writeFile(abs, content, { force: argv.force, dryRun: argv['dry-run'], owned });
        log(`  ${ICON[res] || ' '} ${item.path}${res === 'skipped' ? c.dim('  (직접 만든 파일 — --force 로 덮어쓰기)') : ''}`);
        if (res === 'create' || res === 'update') wrote++;
        if (res === 'skipped') blocked++;
      }
    }
  }

  const stale = findStale(root, [...plannedByAdapter.values()].flat(), scope);
  if (stale.length) {
    log('');
    if (argv.prune && !argv['dry-run']) {
      for (const f of stale) {
        if (f.renameTo) {
          // 대소문자만 다른 이름은 지우면 방금 쓴 내용까지 날아간다. 임시 이름을 거쳐 고쳐 준다.
          const tmp = `${f.abs}.anloop-tmp`;
          fs.renameSync(f.abs, tmp);
          fs.renameSync(tmp, path.join(path.dirname(f.abs), f.renameTo));
          log(`  ${c.green('→')} ${f.rel} → ${f.renameTo} ${c.dim('(대소문자 정정)')}`);
        } else {
          fs.rmSync(f.abs, { force: true });
          log(`  ${c.red('-')} ${f.rel} ${c.dim('(이전 버전 잔여물)')}`);
        }
      }
    } else {
      warn(`이전 버전이 남긴 파일 ${stale.length}개가 있다 — 에이전트가 옛 파일까지 읽는다.`);
      for (const f of stale) log(c.dim(`    ${f.rel}${f.renameTo ? ` → ${f.renameTo} (대소문자)` : ''}`));
      log(c.dim('  정리하려면: ') + c.cyan('anloop install --prune'));
    }
  }

  log('');
  if (argv['dry-run']) log(c.yellow('dry-run — 아무것도 쓰지 않았다.'));
  else log(c.green(`${wrote}개 파일 설치 완료.`) + (blocked ? c.yellow(` (${blocked}개 건너뜀)`) : ''));
  log(c.dim('다음: ') + 'anloop spec "주제"' + c.dim('  로 지시서를 만든다.'));
}

/**
 * 우리가 예전 버전에서 만들었지만 이제는 안 만드는 파일.
 *
 * 전부 우리 것인 디렉터리(스킬 폴더)에서만 찾는다. `.claude/commands/` 처럼 사용자의 다른
 * 파일이 섞이는 곳은 건드리지 않는다. 지우는 건 --prune 을 줬을 때만이다
 * — 되돌리기 어려운 조작을 사람이 시키지 않았는데 하지 않는다.
 */
function findStale(root, planned, scope) {
  if (scope !== 'project') return [];
  const keep = new Set(planned.map((i) => i.path));
  const dirs = new Set(
    planned
      .map((i) => i.path)
      .filter((p) => /(^|\/)(skills|templates)\//.test(p))
      .map((p) => p.slice(0, p.lastIndexOf('/'))),
  );
  const out = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    let names = [];
    try {
      names = fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    } catch {
      continue;
    }
    const keepLower = new Map([...keep].map((k) => [k.toLowerCase(), k]));
    for (const name of names) {
      const rel = `${dir}/${name}`;
      if (keep.has(rel)) continue;
      // macOS·Windows 에서는 BACKLOG.md 와 backlog.md 가 같은 파일이다. 내용은 이미 새 것으로
      // 덮였고 이름만 옛것이므로 지우면 안 되고 이름을 고쳐야 한다.
      const collides = keepLower.get(rel.toLowerCase());
      if (collides) {
        out.push({ rel, abs: path.join(abs, name), renameTo: collides.slice(collides.lastIndexOf('/') + 1) });
        continue;
      }
      // 우리가 통째로 소유한 폴더라면 계획에 없는 파일은 전부 이전 버전 잔여물이다.
      // 내용을 추측할 필요가 없다 — 표식 없는 짧은 템플릿을 놓치던 원인이었다.
      if (isOwnedPath(rel)) {
        out.push({ rel, abs: path.join(abs, name) });
        continue;
      }
      const text = readIfExists(path.join(abs, name));
      if (text !== null && isManaged(text)) out.push({ rel, abs: path.join(abs, name) });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
