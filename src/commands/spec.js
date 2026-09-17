import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { specPrompt, loadSkill, TEMPLATES } from '../skill.js';
import { resolveRunner, runOnce } from '../runner.js';
import { c, log, warn, fail, findRoot, readIfExists } from '../util.js';

/**
 * 인터뷰 질문. 지시서 5요소에서 곧바로 끌어낸 것이다 —
 * 질문 순서가 곧 SPEC 의 뼈대이고, 빈 답변은 에이전트가 저장소 조사로 채운다.
 */
export const QUESTIONS = [
  { key: 'goal', el: '목표', q: '이 작업이 "끝났다"고 말할 수 있는 상태는? (한두 문장)' },
  { key: 'stack', el: '1. 합격 기준', q: '언어·프레임워크는? (비우면 저장소에서 판단)' },
  { key: 'verify', el: '1. 합격 기준', q: '통과해야 할 검증 명령은? (예: npm test, pytest -q)' },
  { key: 'quality', el: '1. 합격 기준', q: '그 밖에 "이건 꼭 지켜야 한다" 싶은 품질 기준은?' },
  { key: 'read', el: '2. 참조 파일', q: '반드시 읽어야 할 파일·디렉터리는?' },
  { key: 'nogo', el: '2. 참조 파일', q: '절대 건드리면 안 되는 파일·영역은?' },
  { key: 'rules', el: '3. 규칙과 근거', q: '지켜야 할 규칙 / 하지 말아야 할 것은?' },
  { key: 'branch', el: '5. 커밋 규칙', q: '커밋은 어디에? (main 직접 / feature 브랜치 / push 허용 여부)' },
  { key: 'first', el: 'BACKLOG', q: '첫 작업으로 뭘 하면 좋을까? (비우면 알아서 쪼갠다)' },
];

/** 파이프·리다이렉트 입력: 한 줄에 한 답변. 답변 세트를 파일로 재사용할 수 있다. */
async function answersFromStdin() {
  const chunks = [];
  for await (const ch of stdin) chunks.push(ch);
  const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  return QUESTIONS.map((item, i) => ({ q: item.q, a: lines[i] ?? '' }));
}

async function interview(topic) {
  log(c.bold('\n지시서 인터뷰') + c.dim(` — 주제: ${topic}`));
  log(c.dim('모르면 그냥 Enter. 빈 답은 에이전트가 저장소를 조사해 채운다.'));

  // 비대화 입력에서는 readline 을 쓰지 않는다 — 파이프에서는 프롬프트 사이 흐름이 꼬인다.
  if (!stdin.isTTY) {
    log(c.dim('stdin 이 터미널이 아니다 — 한 줄에 한 답변씩 읽는다.\n'));
    const answers = await answersFromStdin();
    for (const [i, { a }] of answers.entries()) {
      log(`  ${c.dim(`${i + 1}.`)} ${QUESTIONS[i].q}\n     ${a ? a : c.dim('(비움)')}`);
    }
    return answers;
  }

  log('');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answers = [];
  let stopped = false;
  try {
    for (const [i, item] of QUESTIONS.entries()) {
      if (stopped) {
        answers.push({ q: item.q, a: '' });
        continue;
      }
      log(c.dim(`[${i + 1}/${QUESTIONS.length}] ${item.el}`));
      let a = '';
      try {
        a = (await rl.question(`${c.cyan('?')} ${item.q}\n  `)) ?? '';
      } catch {
        // Ctrl+D. 남은 질문은 빈 답으로 두고 계속 진행한다.
        // (왜: 여기서 죽으면 이미 답한 것까지 전부 버려진다.)
        stopped = true;
        log(c.dim('\n  입력이 끝났다 — 남은 질문은 비워 둔다.'));
      }
      answers.push({ q: item.q, a });
      if (!stopped) log('');
    }
  } finally {
    rl.close();
  }
  return answers;
}

/** 에이전트를 못 쓸 때의 폴백. 인터뷰 답변만이라도 SPEC 초안에 박아 넣는다. */
function draftFromAnswers(topic, answers, dir) {
  const get = (k) => {
    const idx = QUESTIONS.findIndex((x) => x.key === k);
    return (answers?.[idx]?.a || '').trim();
  };
  const orTodo = (v, hint) => (v ? v : `<${hint} — 직접 채울 것>`);
  const lines = [
    '# 지시서 (SPEC)',
    '',
    '> 인터뷰 답변으로 만든 **초안**이다. 에이전트가 저장소를 조사하지 않았으므로 직접 검토해야 한다.',
    '> 작성법: `anloop guide`',
    '',
    '## 0. 목표',
    '',
    orTodo(get('goal'), '목표'),
    '',
    `주제: ${topic}`,
    get('stack') ? `\n스택: ${get('stack')}` : null,
    '',
    '## 1. 합격 기준',
    '',
    ...(get('verify')
      ? get('verify').split(/\s*[,;]\s*|\s+그리고\s+/).filter(Boolean).map((v) => `- [ ] \`${v}\` 통과`)
      : ['- [ ] `<검증 명령 — 직접 채울 것>` 통과']),
    get('quality') ? `- [ ] ${get('quality')}` : null,
    '- [ ] 변경된 동작에 테스트가 있다',
    '- [ ] diff 200줄 이하 (넘으면 작업을 더 쪼갠다)',
    '- [ ] **다른 사람이 리뷰해도 통과시킬 수준인가?**',
    '',
    '## 2. 참조 파일',
    '',
    '**반드시 읽을 것**',
    ...(get('read') ? get('read').split(/\s*,\s*/).map((f) => `- \`${f}\``) : ['- <경로 — 직접 채울 것>']),
    '',
    '**수정 금지**',
    ...(get('nogo') ? get('nogo').split(/\s*,\s*/).map((f) => `- \`${f}\``) : ['- <없으면 "없음" 이라고 적을 것>']),
    '',
    '**읽지 말 것**',
    '- `node_modules/**`, `dist/**`',
    '',
    '## 3. 규칙 (+ 왜)',
    '',
    get('rules') ? `- ${get('rules')}\n  → **왜**: <이유를 직접 적을 것 — 이유 없는 규칙은 처음 보는 상황에서 깨진다>` : null,
    '- SPEC 에 없는 리팩터링을 하지 않는다',
    '  → **왜**: 감시자가 없을 때 번진 스코프는 아침에 되돌릴 수 없다. 제안은 BACKLOG 에만.',
    '- 되돌리기 어려운 조작(push / --force / reset --hard / 마이그레이션)을 하지 않는다',
    '  → **왜**: 사람이 깨어 있을 때만 해야 하는 일이다.',
    '',
    '## 4. 작업 순서',
    '',
    '1. **읽기** — SPEC / HANDOFF / BACKLOG / `git log` / 참조 파일',
    '2. **만들기** — BACKLOG 에서 작업 **하나만**',
    '3. **확인** — 위 검증 명령 실행 + 합격 기준 대조',
    '4. **커밋** — 통과 **즉시**',
    '5. **기록** — BACKLOG / HANDOFF / JOURNAL 갱신 후 커밋',
    '',
    '## 5. 커밋 규칙',
    '',
    '- 검증 통과 직후 즉시 커밋. 사이에 아무 작업도 끼우지 않는다.',
    '  → **왜**: 루프는 도중에 멈춘다. 커밋 안 된 노동은 0이다.',
    '- 커밋 1개 = 작업 1개.',
    `- 브랜치: ${orTodo(get('branch'), '브랜치·push 정책')}`,
    '',
    '## 6. 막혔을 때',
    '',
    '- 같은 작업 3회 검증 실패 → 커밋하지 말고 `[!]` 표시, HANDOFF 에 에러 원문 기록, 루프 정지',
    '- SPEC 으로 판단 불가 → 추측하지 말고 HANDOFF 에 질문을 적고 정지',
    '',
  ];
  const text = lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(path.join(dir, 'SPEC.md'), text.trimEnd() + '\n');

  const first = get('first');
  fs.writeFileSync(
    path.join(dir, 'BACKLOG.md'),
    [
      '# BACKLOG',
      '',
      '상태: `[ ]` 대기 · `[~]` 진행중 · `[x]` 완료 · `[!]` 막힘',
      '',
      '## 진행중',
      '',
      '## 대기',
      '',
      `- [ ] T001 — ${first || '<첫 작업을 한 사이클 크기로 직접 적을 것>'}`,
      '',
      '## 완료',
      '',
      '## 막힘',
      '',
    ].join('\n'),
  );
}

export async function spec(argv) {
  const root = argv.dir ? path.resolve(argv.dir) : findRoot();
  const loopDir = argv.loopDir || 'loop';
  const dir = path.join(root, loopDir);
  const topic = argv._.join(' ').trim();

  if (!topic) fail('주제가 없다.\n  anloop spec "결제 모듈에 재시도 로직 추가"\n  anloop spec "..." --interview');

  // SPEC 이 이미 채워져 있으면 덮어쓰지 않는다 — 사람이 승인한 지시서다.
  const existing = readIfExists(path.join(dir, 'SPEC.md'));
  if (existing && !existing.includes('<검증 명령 1>') && !argv.force) {
    fail(`${loopDir}/SPEC.md 가 이미 작성돼 있다. 덮어쓰려면 --force.`);
  }

  fs.mkdirSync(dir, { recursive: true });
  const skill = loadSkill();
  for (const t of TEMPLATES) {
    const abs = path.join(dir, `${t}.md`);
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, skill.templates[t]);
  }

  const answers = argv.interview ? await interview(topic) : null;
  const prompt = specPrompt(topic, answers);

  if (argv['dry-run']) {
    log(c.yellow('dry-run — 아래 프롬프트를 에이전트에 넘긴다:\n'));
    log(prompt.slice(0, 1200) + c.dim(`\n... (총 ${prompt.length}자)`));
    return;
  }

  const { cmd, argTemplate } = resolveRunner(argv);
  log(c.bold('\n지시서 작성') + c.dim(` — ${cmd} · ${loopDir}/SPEC.md`));

  const { code, error } = await runOnce(cmd, argTemplate.map((a) => a.replaceAll('{prompt}', prompt)), root);

  if (error || code !== 0) {
    warn(error ? `${cmd} 실행 실패: ${error.message}` : `${cmd} 가 종료코드 ${code} 로 끝났다.`);
    if (answers) {
      draftFromAnswers(topic, answers, dir);
      log(c.yellow(`\n인터뷰 답변만으로 ${loopDir}/SPEC.md 초안을 썼다.`));
      log(c.dim('저장소 조사가 빠진 초안이다 — 검증 명령이 실제로 도는지 직접 확인해라.'));
      return;
    }
    fail('지시서를 만들지 못했다. --cmd 로 에이전트를 직접 지정하거나 --interview 로 다시 시도해라.');
  }

  const written = readIfExists(path.join(dir, 'SPEC.md')) || '';
  const left = (written.match(/<[^>\n]{2,60}>/g) || []).length;
  log('');
  if (!written || written.includes('<검증 명령 1>')) {
    warn(`${loopDir}/SPEC.md 가 갱신되지 않았다. 에이전트 출력을 확인해라.`);
  } else {
    log(c.green(`${loopDir}/SPEC.md · ${loopDir}/BACKLOG.md 작성 완료.`));
    if (left) log(c.yellow(`자리표시자 ${left}개가 남아 있다 — 직접 확인해라.`));
    log(c.dim('다음: ') + `${loopDir}/SPEC.md 를 검토한 뒤 ` + c.cyan('anloop loop'));
  }
}
