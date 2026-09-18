import fs from 'node:fs';
import path from 'node:path';
import { loadSkill, TEMPLATES, FILES } from '../skill.js';
import { c, log, findRoot } from '../util.js';

export function init(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const dir = path.join(root, argv.loopDir || 'loop');
  const skill = loadSkill();

  fs.mkdirSync(dir, { recursive: true });
  for (const t of TEMPLATES) {
    const abs = path.join(dir, `${t}.md`);
    if (fs.existsSync(abs) && !argv.force) {
      log(`  ${c.dim('=')} ${path.relative(root, abs)} ${c.dim('(이미 있음)')}`);
      continue;
    }
    fs.writeFileSync(abs, skill.templates[t]);
    log(`  ${c.green('+')} ${path.relative(root, abs)}`);
  }

  log('');
  log(c.bold('다음 할 일'));
  log(`  1. ${c.cyan(`${path.basename(dir)}/${FILES.design}`)} 를 채운다 ${c.dim('— 루프의 품질은 전부 여기서 결정된다')}`);
  log(`     작성법: ${c.dim('anloop guide')} ${c.dim('(지시서 5요소)')}`);
  log(`  2. ${c.cyan(`${path.basename(dir)}/${FILES.backlog}`)} 에 작업을 한 바퀴 크기로 쪼개 적는다`);
  log(`  3. ${c.cyan('anloop loop --agent claude')} ${c.dim('로 밤새 돌린다')}`);
}
