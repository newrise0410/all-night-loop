import path from 'node:path';
import { adapters, byId, ids } from '../adapters.js';
import { loadSkills, bundle } from '../skill.js';
import { c, log, warn, fail, expand, writeFile, upsertBlock, findRoot, exists } from '../util.js';

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
  for (const a of targets) {
    log(`\n${c.bold(a.label)} ${c.dim(`(${a.id}, ${scope})`)}`);
    for (const skill of skills) {
      for (const item of a.plan({ skill, bundleText: bundle(skill), root, scope })) {
        const abs = item.path.startsWith('~/') ? expand(item.path) : path.join(root, item.path);
        const res =
          item.kind === 'block'
            ? upsertBlock(abs, item.content, { dryRun: argv['dry-run'] })
            : writeFile(abs, item.content, { force: argv.force, dryRun: argv['dry-run'] });
        log(`  ${ICON[res] || ' '} ${item.path}${res === 'skipped' ? c.dim('  (직접 만든 파일 — --force 로 덮어쓰기)') : ''}`);
        if (res === 'create' || res === 'update') wrote++;
        if (res === 'skipped') blocked++;
      }
    }
  }

  log('');
  if (argv['dry-run']) log(c.yellow('dry-run — 아무것도 쓰지 않았다.'));
  else log(c.green(`${wrote}개 파일 설치 완료.`) + (blocked ? c.yellow(` (${blocked}개 건너뜀)`) : ''));
  log(c.dim('다음: ') + 'anloop spec "주제"' + c.dim('  로 지시서를 만든다.'));
}
