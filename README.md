# all-night-loop

사람이 없어도 스스로 개발을 이어가는 **자율 개발 루프**를, 쓰는 LLM 코딩 도구가 무엇이든 설치한다.

한 사이클 = **지시서 읽기 → 작업 하나 → 검증 → 즉시 커밋 → 인수인계 기록 → 종료.**
이걸 밤새 반복한다.

```bash
npm i -g all-night-loop
# 또는 레지스트리 없이: npm i -g github:newrise0410/all-night-loop

anloop install                  # 감지된 도구 전부에 스킬 설치
anloop spec "주제" --interview   # 문답으로 지시서·백로그 작성
anloop loop                     # 밤새 돌린다
```

## 지시서 만들기

루프의 품질은 전부 `loop/SPEC.md` 에서 결정된다. **루프는 SPEC 보다 똑똑해지지 않는다.**
그래서 SPEC 을 세 가지 방법으로 만들 수 있다.

```bash
anloop spec "결제 모듈에 재시도 로직 추가"              # 자동 — 주제만 준다
anloop spec "결제 모듈에 재시도 로직 추가" --interview   # 인터뷰 — 9개 문답
anloop init                                          # 빈 템플릿만 — 직접 쓴다
```

**자동 모드**는 에이전트가 저장소를 조사한다 — `package.json` 의 scripts, CI 설정, 린터 설정,
`git log` 의 커밋 관례를 읽고 **실제로 도는 검증 명령**을 찾아 SPEC 에 박는다.
없는 `npm run lint` 를 지어내지 않는 것이 핵심이다 — 존재하지 않는 명령은 루프가 "통과"로
오판하거나 매 사이클 실패한다. 둘 다 밤을 날린다.

**인터뷰 모드**는 9개를 묻는다. 질문은 지시서 5요소에서 그대로 끌어냈다.

| # | 질문 | 5요소 |
|---|---|---|
| 1 | 이 작업이 "끝났다"고 말할 수 있는 상태는? | 목표 |
| 2 | 언어·프레임워크는? | 1. 합격 기준 |
| 3 | 통과해야 할 검증 명령은? | 1. 합격 기준 |
| 4 | 그 밖에 꼭 지켜야 할 품질 기준은? | 1. 합격 기준 |
| 5 | 반드시 읽어야 할 파일·디렉터리는? | 2. 참조 파일 |
| 6 | 절대 건드리면 안 되는 영역은? | 2. 참조 파일 |
| 7 | 지켜야 할 규칙 / 하지 말아야 할 것은? | 3. 규칙과 근거 |
| 8 | 커밋은 어디에? | 5. 커밋 규칙 |
| 9 | 첫 작업으로 뭘 하면 좋을까? | BACKLOG |

모르면 그냥 Enter — **빈 답은 에이전트가 저장소를 조사해 채운다.** 답변은 저장소 조사보다
우선하되, 답변과 저장소가 모순되면(예: `npm test` 라 했는데 scripts 에 없다) 답변을 따르되
그 불일치를 SPEC 에 적는다. 사람이 곧 만들 예정일 수 있어서다.

답변을 파일로 재사용할 수도 있다:

```bash
anloop spec "주제" --interview < answers.txt   # 한 줄에 한 답변
```

에이전트 CLI 를 못 쓰는 상황이면 인터뷰 답변만으로 SPEC 초안을 쓴다 — 저장소 조사가 빠진
초안이므로 검증 명령이 실제로 도는지는 직접 확인해야 한다.

이미 작성된 SPEC 은 덮어쓰지 않는다(`--force` 로만). 사람이 승인한 지시서이기 때문이다.

에이전트 안에서 직접 부를 수도 있다: `/all-night-spec 결제 재시도 로직 추가`

## 어디에 설치되나

**스킬 2개**(`all-night-loop` 한 사이클 실행, `all-night-spec` 지시서 작성)를 설치한다.
`anloop install` 은 저장소를 훑어 설치된 도구를 감지하고, 각 도구의 규약에 맞는 파일을 만든다.
대상을 직접 지정하려면 `anloop install claude cursor`, 전부 설치하려면 `--all`.

| 대상 | 생성 파일 | 전역 설치 |
|---|---|---|
| `claude` | `.claude/skills/all-night-loop/` + `.claude/commands/all-night-loop.md` | `~/.claude/` |
| `codex` | `.codex/prompts/all-night-loop.md` (+ `AGENTS.md`) | `~/.codex/prompts/` |
| `cursor` | `.cursor/rules/all-night-loop.mdc` + `.cursor/commands/` | — |
| `gemini` | `.gemini/commands/all-night-loop.toml` | `~/.gemini/commands/` |
| `copilot` | `.github/prompts/all-night-loop.prompt.md` | — |
| `cline` | `.clinerules/all-night-loop.md` | — |
| `windsurf` | `.windsurf/rules/all-night-loop.md` | — |
| `opencode` | `.opencode/command/all-night-loop.md` | `~/.config/opencode/` |
| `agents` | `AGENTS.md` 블록 + `.agent/skills/all-night-loop.md` | — |

**`agents` 가 범용 폴백이다.** [AGENTS.md](https://agents.md) 를 읽는 에이전트라면 표에 없어도 동작한다.
`AGENTS.md` 는 통째로 덮어쓰지 않고 마킹된 블록만 삽입/갱신하므로 기존 내용이 보존된다.

```bash
anloop install --all              # 이 저장소의 모든 도구
anloop install claude --global    # 모든 프로젝트에서 쓰도록 전역 설치
anloop install --dry-run          # 뭘 할지만 확인
anloop doctor                     # 감지된 도구·CLI·루프 상태 점검
```

사람이 직접 만든 파일은 덮어쓰지 않는다(`--force` 로만). 같은 내용이면 다시 쓰지 않아 재실행이 멱등이다.

## 밤새 돌리기

```bash
anloop loop --yolo                     # 무인 실행 (아래 설명 참고)
anloop loop --agent codex --yolo --max 20
anloop loop --cmd "mycli chat {prompt}"   # 지원 목록에 없는 CLI
```

### `--yolo` 가 필요한 이유

기본 러너는 파일 편집만 허용하고 **셸을 막는다.** 그런데 이 루프의 핵심 절차는
`검증 명령 실행 → git commit` 이다. 셸이 막히면 에이전트는 코드를 고쳐 놓고도
검증도 커밋도 못 해서 매 사이클 `BLOCKED` 로 끝난다 — 아침에 워킹트리에 미커밋 변경만 남는다.

`--yolo` 는 에이전트의 승인 절차를 건너뛴다(`claude --dangerously-skip-permissions` 등).
**실제로 위험한 스위치이므로 기본값이 아니다.** 신뢰하는 저장소에서, SPEC 의 금지 규칙
(push / `--force` / `reset --hard` 금지)을 믿고 쓰는 것이다.

권한 때문에 막힌 것으로 보이면 루프가 `--yolo` 를 쓰라고 알려준다 — 무관한 실패에는 알리지 않는다.

내장 실행기: `claude` `codex` `gemini` `cursor` `opencode` `aider`.
각 CLI의 비대화 실행 플래그는 버전에 따라 달라지므로, 맞지 않으면 `--cmd` 로 직접 지정하면 된다
(`anloop list` 로 현재 매핑 확인).

한 사이클만 수동으로 돌려보려면 프롬프트를 직접 파이프한다:

```bash
claude -p "$(anloop prompt)"
codex exec "$(anloop prompt)"
```

Claude Code 안에서는 `/all-night-loop` (1사이클) 또는 `/loop /all-night-loop` (반복).

### 루프가 멈추는 조건

밤새 돌아가는 루프에서 제일 중요한 건 **언제 멈추냐**다.

| 조건 | 판단 근거 |
|---|---|
| `ALL DONE` | BACKLOG 에 남은 작업이 없다 |
| `BLOCKED` | 막힌 항목만 남았다 — 사람이 필요하다 |
| `NEEDS SPEC` | 지시서가 모호해 판단 불가 |
| 진전 없음 | 2회 연속 새 커밋이 없다 |
| 연속 실패 | 에이전트가 3회 연속 비정상 종료 |
| `--max` | 최대 사이클 도달 (기본 50) |

실제로 돌려본 예 — 빈 저장소에 `anloop spec` 으로 지시서를 만들고 `anloop loop --yolo --max 3` 을
돌리면 3사이클 동안 작업 3개가 각각 기능 커밋 + 기록 커밋으로 쌓인다.

에이전트는 stdout 에 `[loop] ALL DONE` 같은 신호를 내고 `loop/HANDOFF.md` 의 `상태` 줄에도 같은 값을 적는다.
파일 쪽을 우선 신뢰한다 — stdout 은 유실될 수 있지만 파일은 남는다.

## Windows

`anloop install` · `anloop init` 은 그대로 동작한다. `anloop loop` · `anloop spec` 은 에이전트를
실행해야 해서 주의할 점이 있다.

- `claude` · `codex` 는 Windows 에서 `.cmd` 셸 스크립트라 `cmd.exe` 를 거쳐 실행된다.
  프롬프트에는 줄바꿈 256개와 `& | < > ^ %` 같은 cmd.exe 메타문자가 들어 있어서,
  명령줄 인자로 넘기면 셸이 해석해 깨진다. 그래서 **이 둘은 프롬프트를 stdin 으로 넘긴다.**
- `gemini` · `cursor` · `opencode` · `aider` 는 아직 argv 방식이다. Windows 에서 이들을 쓰면
  실행 전에 막고 이유를 알려준다 — 조용히 잘린 프롬프트로 도는 것보다 낫다.
- 직접 지정한 CLI 가 stdin 을 받는다면: `anloop loop --cmd "mycli chat" --stdin`

`anloop doctor` 의 CLI 감지는 `PATHEXT` 를 따라 `.cmd`/`.exe` 까지 찾는다.

## 상태 파일

`anloop spec` 또는 `anloop init` 이 만든다. **모든 상태는 기억이 아니라 파일에 있다** — 다음 사이클의 에이전트는 기억이 없다.

| 파일 | 역할 | 누가 쓰나 |
|---|---|---|
| `loop/SPEC.md` | 지시서. 무엇을/왜/어디까지 | **사람** (또는 `anloop spec`) |
| `loop/BACKLOG.md` | 작업 목록 `[ ] [~] [x] [!]` | 루프 |
| `loop/HANDOFF.md` | 다음 세션 인수인계 (매번 덮어씀) | 루프 |
| `loop/JOURNAL.md` | 사이클별 로그 (append-only) | 루프 |

## 지시서 작성 5요소

루프의 품질은 전부 SPEC 에서 결정된다. **루프는 SPEC 보다 똑똑해지지 않는다.**
`anloop guide` 로 전체 가이드(나쁜 예/좋은 예 포함)를 출력한다.

| 요소 | 핵심 |
|---|---|
| **1. 합격 기준** | 실행 가능한 검증 명령 + `"다른 사람이 봐도 괜찮은가?"` 품질 관문 |
| **2. 참조 파일** | 읽을 것 / 수정 금지 / 읽지 말 것 을 범위까지 명시 |
| **3. 규칙과 근거** | 규칙 뒤에 **왜**를 붙인다 — 이유가 있어야 처음 보는 상황에서도 안 깨진다 |
| **4. 작업 순서** | 읽기 → 만들기 → 확인 → 커밋 → 기록 으로 고정 |
| **5. 커밋 순서** | 검증 통과 **즉시** 커밋 — 도중에 멈춰도 노동이 남는다 |

## 설계 원칙

- **작업 하나 = 커밋 하나 = 사이클 하나.** 세션은 언제든 끊긴다. 단위가 작아야 끊겨도 남는다.
- **검증 통과 즉시 커밋.** 커밋 전에 죽으면 그 노동은 0이다.
- **SPEC 밖은 실행하지 않고 제안만 한다.** 감시자가 없을 때 번진 스코프는 아침에 되돌릴 수 없다.
- **되돌리기 어려운 조작 금지.** push / `--force` / `reset --hard` / 히스토리 재작성은 사람이 깨어 있을 때만.
- **3회 실패하면 멈춘다.** 실패를 무한 반복하는 루프는 토큰을 태우고 상태를 더 망가뜨린다.

## 명령 요약

```
anloop install [targets...]   스킬 설치 (--all / --global / --dry-run / --force / --dir)
anloop spec <주제>            지시서·백로그 작성 (--interview / --force)
anloop init                   loop/ 빈 템플릿 생성
anloop loop                   반복 실행 (--agent / --cmd / --max / --sleep)
anloop doctor                 도구·CLI·루프 상태 점검
anloop list                   설치 대상 및 실행기 목록
anloop prompt [loop|spec]     프롬프트를 stdout 으로
anloop guide                  지시서 작성 5요소 가이드
anloop uninstall [targets...] 설치 파일·블록 제거 (loop/ 기록은 남긴다)
```

## 개발

```bash
git clone https://github.com/newrise0410/all-night-loop
cd all-night-loop
npm link          # 이 저장소를 전역 CLI 로 연결 (수정 즉시 반영)
npm test          # node:test, 의존성 0
```

정본 스킬은 `skill/loop.md`·`skill/spec.md` 두 개다. 각 도구용 파일은 설치 시점에
어댑터(`src/adapters.js`)가 생성한다 — 도구를 추가하려면 어댑터 하나만 쓰면 된다.

MIT
