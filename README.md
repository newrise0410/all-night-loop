# all-night-loop

사람이 없어도 스스로 개발을 이어가는 **자율 개발 루프**를, 쓰는 LLM 코딩 도구가 무엇이든 설치한다.

한 바퀴 = **읽기 → 하나 만들기 → 확인 → 커밋 → 기록.** 그리고 세션이 끝난다(기억 소멸).
다음 바퀴는 기록만 읽고 이어간다. 이걸 밤새 반복한다.

```bash
npm i -g all-night-loop
# 레지스트리 없이: npm i -g github:newrise0410/all-night-loop

anloop install                 # 감지된 도구 전부에 스킬 설치
anloop spec "주제"              # 저장소를 조사해 지시서·백로그 작성
anloop loop --yolo             # 밤새 돌린다
```

## 상태는 전부 파일에 있다

다음 바퀴의 에이전트는 **기억이 전혀 없다.** 그래서 모든 상태가 파일로 남는다.
루프가 매 바퀴 읽는 순서는 **번호로 고정**돼 있다.

| # | 파일 | 역할 | 누가 쓰나 |
|---|---|---|---|
| 1 | `loop/design.md` | 무엇을 만드는가. 거의 안 고침 | **사람** (또는 `anloop spec`) |
| 2 | `loop/status.md` | 어디까지 했고 다음은 어디인가 | 루프 (매 바퀴 덮어씀) |
| 3 | `loop/inbox.md` | **사용자 지시·피드백** | **사람**이 쓰고 루프가 처리표시 |
| 4 | `loop/backlog.md` | 작업 목록 `[ ] [~] [x] [!] [?]` | 루프 |

루프가 다시 읽지 않는 보관 파일: `loop/journal.md`(바퀴별 로그) · `loop/done.md`(완료 백로그) ·
`loop/USAGE.jsonl`(사용량) · `loop/.state/`(실행 중 상태, git 자동 제외)

**운영 기록은 매 바퀴 입력에 그대로 들어간다.** 그래서 루프는 완료 항목을 `done.md` 로
옮기고 `status.md` 를 40줄 이하로 유지한다. 넘으면 하네스가 경고한다.

### inbox — 돌아가는 중에 지시하기

밤새 도는 루프에 생각날 때마다 한두 문장씩 넣어두면 다음 바퀴가 읽고 반영한다.

```markdown
## 대기

- 재시도 기본 횟수를 3에서 4로 늘려라. 테스트도 같이 고쳐라.
```

반영하면 루프가 `## 처리됨` 으로 옮기고 결과를 덧붙인다 — 직접 지우지 않아도 되고
같은 지시를 두 번 반영하지도 않는다.

```markdown
## 처리됨

- 재시도 기본 횟수를 3에서 4로 늘려라. 테스트도 같이 고쳐라.
  (2026-09-18 c1) `src/http.js` 의 `retries` 기본값을 4 로 바꾸고 테스트 1개 추가 — a739b76
```

**inbox 는 우선순위와 방향을 바꿀 수 있지만 `design.md` 의 금지 규칙은 뒤집지 못한다.**
그건 사람이 `design.md` 를 직접 고쳐야 한다 — 잠결에 적은 한 줄이 push 금지 같은
안전장치를 풀면 아침에 되돌릴 수 없다.

## 지시서 만들기

루프의 품질은 전부 `loop/design.md` 에서 결정된다. **루프는 지시서보다 똑똑해지지 않는다.**

```bash
anloop spec "결제 모듈에 재시도 로직 추가"              # 자동 — 주제만 준다
anloop spec "결제 모듈에 재시도 로직 추가" --interview   # 인터뷰 — 9개 문답
anloop init                                          # 빈 템플릿만 — 직접 쓴다
```

**자동 모드**는 에이전트가 저장소를 조사한다 — `package.json` 의 scripts, CI 설정, 린터 설정,
`git log` 의 커밋 관례를 읽고 **실제로 도는 검증 명령**을 찾아 넣는다.
없는 `npm run lint` 를 지어내지 않는 것이 핵심이다 — 존재하지 않는 명령은 루프가 "통과"로
오판하거나 매 바퀴 실패한다. 둘 다 밤을 날린다.

**인터뷰 모드**의 9개 질문은 지시서 5요소에서 그대로 끌어냈다.

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
| 9 | 첫 작업으로 뭘 하면 좋을까? | backlog |

모르면 그냥 Enter — **빈 답은 에이전트가 저장소를 조사해 채운다.** 답변이 저장소 조사보다
우선하되, 둘이 모순되면(예: `npm test` 라 했는데 scripts 에 없다) 답변을 따르고 그 불일치를
지시서에 적는다. 사람이 곧 만들 예정일 수 있어서다.

답변을 파일로 재사용할 수도 있다: `anloop spec "주제" --interview < answers.txt` (한 줄에 한 답변).
에이전트 CLI 를 못 쓰면 인터뷰 답변만으로 초안을 쓴다 — 저장소 조사가 빠진 초안이므로
검증 명령이 실제로 도는지는 직접 확인해야 한다.

이미 작성된 지시서는 덮어쓰지 않는다(`--force` 로만). 사람이 승인한 문서이기 때문이다.
에이전트 안에서 직접 부를 수도 있다: `/all-night-spec 결제 재시도 로직 추가`

### 5요소

`anloop guide` 로 전체 가이드(나쁜 예/좋은 예 포함)를 출력한다.

| 요소 | 핵심 |
|---|---|
| **1. 합격 기준** | 실행 가능한 검증 명령 + `"다른 사람이 봐도 괜찮은가?"` 품질 관문 |
| **2. 참조 파일** | 읽을 것 / 수정 금지 / 읽지 말 것 을 범위까지 명시 |
| **3. 규칙과 근거** | 규칙 뒤에 **왜**를 붙인다 — 이유가 있어야 처음 보는 상황에서도 안 깨진다 |
| **4. 작업 순서** | 읽기 → 만들기 → 확인 → 커밋 → 기록 으로 고정 |
| **5. 커밋 순서** | 검증 통과 **즉시** 커밋 — 도중에 멈춰도 노동이 남는다 |

## 밤새 돌리기

```bash
anloop loop --yolo                        # 무인 실행 (아래 설명 참고)
anloop loop --agent codex --yolo --max 20
anloop loop --cmd "mycli chat {prompt}"   # 지원 목록에 없는 CLI
```

내장 실행기: `claude` `codex` `gemini` `cursor` `opencode` `aider`.
각 CLI 의 비대화 실행 플래그는 버전에 따라 달라지므로, 맞지 않으면 `--cmd` 로 지정하면 된다
(`anloop list` 로 현재 매핑 확인).

한 바퀴만 수동으로: `claude -p "$(anloop prompt)"`
Claude Code 안에서는 `/all-night-loop` (한 바퀴) 또는 `/loop /all-night-loop` (반복).

### `--yolo` 가 필요한 이유

기본 러너는 파일 편집만 허용하고 **셸을 막는다.** 그런데 이 루프의 핵심 절차는
`검증 명령 실행 → git commit` 이다. 셸이 막히면 에이전트는 코드를 고쳐 놓고도
검증도 커밋도 못 해서 매 바퀴 `blocked` 로 끝난다 — 아침에 워킹트리에 미커밋 변경만 남는다.

`--yolo` 는 에이전트의 승인 절차를 건너뛴다(`claude --dangerously-skip-permissions` 등).
**실제로 위험한 스위치이므로 기본값이 아니다.** 신뢰하는 저장소에서, 지시서의 금지 규칙
(push / `--force` / `reset --hard` 금지)을 믿고 쓰는 것이다.

권한 때문에 막힌 것으로 보이면 루프가 `--yolo` 를 쓰라고 알려준다 — 무관한 실패에는 알리지 않는다.

### 루프가 멈추는 조건

밤새 돌아가는 루프에서 제일 중요한 건 **언제 멈추냐**다.
그리고 멈춤 판정은 **에이전트의 말이 아니라 증거**로 한다.

| 조건 | 판단 근거 |
|---|---|
| `all_done` | 이번 바퀴 결과 파일 + `backlog.md` 에 `[ ]`/`[~]` 가 실제로 0개 |
| `blocked` | 사람이 필요하다 |
| `needs_spec` | 지시서가 모호하거나 미완성이다 |
| 진전 없음 | 2회 연속 **작업 상태도 산출물도** 그대로 |
| 연속 실패 | 3회 연속 비정상 종료 또는 시간 초과 |
| `--timeout` | 한 바퀴가 제한을 넘으면 프로세스 트리째 정리 (기본 1800초) |
| `--max-time` | 전체 시간 예산 초과 시 다음 바퀴를 시작하지 않음 |
| `--budget-usd` | 누적 비용이 예산 초과 |
| `--max` | 최대 바퀴 도달 (기본 50) |

에이전트는 매 바퀴 `loop/.state/cycle.json` 에 결과를 쓴다.

```json
{ "run_id": "3d0e8b25", "cycle": 1, "task": "T005", "status": "done",
  "verified": "npm test -> 9 pass / 0 fail", "verify_attempts": 1, "commit": "bf0313e" }
```

**`run_id` 와 `cycle` 이 이번 바퀴와 다르면 무시한다.** 지난 바퀴의 낡은 상태를
종료 신호로 오인하지 않기 위해서다. 그리고:

- **프로세스가 실패하면 어떤 완료 보고도 믿지 않는다.** 종료코드 1 로 죽으면서 완료를
  보고하는 경우가 실제로 있었다.
- **`all_done` 인데 백로그에 일이 남아 있으면 멈추지 않는다.** 보고와 증거가 어긋나면 증거를 따른다.
- **stdout 은 판정에 쓰지 않는다.** 프롬프트 자체에 상태 값 예시가 들어 있어서, 에이전트가
  입력을 되울리기만 해도 종료로 오판했다.
- **기록 커밋(`chore: loop log`)은 진전이 아니다.** 루프가 매 바퀴 기록을 커밋하므로 HEAD 만
  보면 무진전 가드가 영원히 켜지지 않는다. 백로그의 작업 상태와 `loop/` 밖 산출물을 따로 본다.

## 사용량 계측

```bash
anloop loop --usage              # 바퀴별 토큰·비용을 loop/USAGE.jsonl 에 기록
anloop loop --budget-usd 5       # 비용 예산. --usage 를 함축한다
anloop usage                     # 집계 (--all 로 실행별 내역)
```

claude 와 codex 를 지원한다. `--cmd` 로 직접 지정한 CLI 는 출력 형식을 알 수 없어 시간만 기록한다.
`--usage` 를 켜면 출력이 JSON 한 덩어리라 **실시간 스트리밍 출력이 사라진다** — 지켜보실 거면 끄는 편이 낫다.

**토큰을 하나로 합치지 않는다.** `input` · `cache_creation` · `cache_read` 는 단가가 다른
**별개 카운터**이고 서로 포함 관계가 아니다. 합치면 요금과도 컨텍스트 크기와도 맞지 않는다.

실제 한 바퀴 측정 예:

```
#1 T006  done  89초  $0.777  검증 1회
   입력 18 · 캐시생성 42.0k · 캐시읽기 380.7k · 출력 6.4k · 10턴
```

**여기서 읽어야 할 것**: 비용을 지배하는 건 프롬프트가 아니라 **캐시 읽기 380.7k** 다.
한 바퀴 안에서 에이전트가 파일을 읽고 도구를 돌릴수록 컨텍스트가 커지고, 그게 매 턴
다시 청구된다. 실행 프롬프트는 2,590자(약 900토큰)뿐이라 이 앞에서 미미하다.
**그래서 "작업을 고른 뒤 필요한 것만 읽기"가 프롬프트 다이어트보다 효과가 크다.**

`--budget-usd` 는 두 겹으로 막는다 — 누적 비용이 예산을 넘으면 다음 바퀴를 시작하지 않고,
claude 에는 남은 금액을 `--max-budget-usd` 로 넘겨 한 바퀴가 예산을 통째로 태우는 것도 막는다.

## 어디에 설치되나

**스킬 2개**(`all-night-loop` 한 바퀴 실행, `all-night-spec` 지시서 작성)를 설치한다.
`anloop install` 은 저장소를 훑어 설치된 도구를 감지하고 각 도구의 규약에 맞는 파일을 만든다.
대상을 직접 지정하려면 `anloop install claude cursor`, 전부 설치하려면 `--all`.

| 대상 | 생성 파일 | 전역 설치 |
|---|---|---|
| `claude` | `.claude/skills/<스킬>/` + `.claude/commands/<스킬>.md` | `~/.claude/` |
| `codex` | `.codex/prompts/<스킬>.md` (+ `AGENTS.md`) | `~/.codex/prompts/` |
| `cursor` | `.cursor/rules/<스킬>.mdc` + `.cursor/commands/` | — |
| `gemini` | `.gemini/commands/<스킬>.toml` | `~/.gemini/commands/` |
| `copilot` | `.github/prompts/<스킬>.prompt.md` | — |
| `cline` | `.clinerules/<스킬>.md` | — |
| `windsurf` | `.windsurf/rules/<스킬>.md` | — |
| `opencode` | `.opencode/command/<스킬>.md` | `~/.config/opencode/` |
| `agents` | `AGENTS.md` 블록 + `.agent/skills/<스킬>.md` | — |

**`agents` 가 범용 폴백이다.** [AGENTS.md](https://agents.md) 를 읽는 에이전트라면 표에 없어도 동작한다.
`AGENTS.md` 는 통째로 덮어쓰지 않고 마킹된 블록만 삽입/갱신하므로 기존 내용이 보존된다.

```bash
anloop install --all              # 이 저장소의 모든 도구
anloop install claude --global    # 모든 프로젝트에서 쓰도록 전역 설치
anloop install --dry-run          # 뭘 할지만 확인
anloop doctor                     # 감지된 도구·CLI·루프 상태 점검
```

사람이 직접 만든 파일은 덮어쓰지 않는다(`--force` 로만). 같은 내용이면 다시 쓰지 않아 재실행이 멱등이다.
스킬 폴더처럼 **통째로 우리 것인 곳은 내용을 따지지 않고 갱신하고**, 공유 폴더에 쓰는 파일에는
`<!-- all-night-loop:generated -->` 표식을 박아 다음 업데이트 때 알아본다.

### Claude Code 플러그인으로 설치 (자동 업데이트)

Claude Code 만 쓴다면 플러그인이 제일 편하다. **`npm i -g` 를 다시 칠 필요 없이 갱신된다.**

```
/plugin marketplace add newrise0410/all-night-loop
/plugin install all-night-loop@anloop
```

이후 업데이트는 `/plugin marketplace update`. 새 버전은 `plugin.json` 의 `version` 이
올라갈 때 나간다 — 이 저장소는 그 값을 `package.json` 버전과 묶어 두어 따로 놀지 않는다.

**다만 플러그인은 스킬과 슬래시 명령만 준다.** `anloop loop` 같은 CLI 는 셸 프로그램이라
플러그인으로 배포할 수 없다.

| | 플러그인 | npm CLI |
|---|---|---|
| Claude Code 스킬·명령 | o | o |
| 자동 업데이트 | o | `npm i -g` 재실행 |
| `anloop loop` 무인 반복 | x | o |
| Codex·Cursor·Gemini 등 | x | o |

### 이미 설치한 것을 업데이트하기

```bash
npm i -g github:newrise0410/all-night-loop    # CLI 갱신
anloop install --prune                         # 각 저장소에서 (전역이면 --global 추가)
anloop migrate                                 # loop/ 가 옛 이름이면
```

`--prune` 은 **이전 버전이 만들었지만 이제는 안 만드는 파일**을 지운다. 스킬 폴더처럼
우리가 통째로 소유한 곳에서만 지우고, `.claude/commands/` 처럼 사용자의 다른 파일이
섞이는 곳은 건드리지 않는다. 안 주면 목록만 보여주고 지우지 않는다.

Claude Code 는 **새 세션부터** 갱신된 스킬을 읽는다.

### 예전 이름에서 옮기기

`SPEC/BACKLOG/HANDOFF/JOURNAL/DONE` 을 쓰던 저장소는 옛 이름 그대로도 **읽힌다**(경고 1회).
옮기려면 `anloop migrate` (`--dry-run` 으로 먼저 확인 가능).

루프가 자동으로 옮기지는 않는다. 사람 없을 때 되돌리기 어려운 조작을 하지 않는다는
이 프로젝트의 규칙을 하네스 자신도 지킨다.

## Windows

`anloop install` · `anloop init` 은 그대로 동작한다. `anloop loop` · `anloop spec` 은 에이전트를
실행해야 해서 주의할 점이 있다.

- Windows 의 `claude` · `codex` 는 `.cmd` 셸 스크립트라 `cmd.exe` 를 거쳐 실행된다.
  프롬프트는 여러 줄이고 따옴표·메타문자를 담고 있어서 명령줄 인자로 넘기면 셸이 해석해 깨진다.
  그래서 **이 둘은 프롬프트를 stdin 으로 넘긴다.**
- `gemini` · `cursor` · `opencode` · `aider` 는 아직 argv 방식이다. Windows 에서 이들을 쓰면
  실행 전에 막고 이유를 알려준다 — 조용히 잘린 프롬프트로 도는 것보다 낫다.
- 직접 지정한 CLI 가 stdin 을 받는다면: `anloop loop --cmd "mycli chat" --stdin`

`anloop doctor` 의 CLI 감지는 `PATHEXT` 를 따라 `.cmd`/`.exe` 까지 찾는다.
`anloop migrate` 와 `--prune` 은 대소문자를 구분하지 않는 파일시스템(macOS·Windows)에서
`BACKLOG.md` → `backlog.md` 같은 이름 변경을 임시 이름을 거쳐 처리한다.

## 설계 원칙

- **작업 하나 = 커밋 하나 = 한 바퀴.** 세션은 언제든 끊긴다. 단위가 작아야 끊겨도 남는다.
- **검증 통과 즉시 커밋.** 커밋 전에 죽으면 그 노동은 0이다.
- **지시서 밖은 실행하지 않고 `[?]` 제안만 한다.** 감시자가 없을 때 번진 스코프는 되돌릴 수 없다.
- **되돌리기 어려운 조작 금지.** push / `--force` / `reset --hard` / 히스토리 재작성은 사람이 깨어 있을 때만.
  하네스 자신도 지킨다 — 파일 이름을 자동으로 바꾸지 않는 것도 같은 이유다.
- **3회 실패하면 멈춘다.** 실패를 무한 반복하는 루프는 토큰을 태우고 상태를 더 망가뜨린다.
- **판정은 말이 아니라 증거로.** 에이전트의 보고와 파일 증거가 어긋나면 증거를 따른다.

## 명령 요약

```
anloop install [targets...]   스킬 설치 (--all / --global / --prune / --force / --dry-run / --dir)
anloop spec <주제>            지시서·백로그 작성 (--interview / --force)
anloop init                   loop/{design,backlog,status,inbox,journal}.md 빈 템플릿 생성
anloop migrate                옛 파일 이름을 새 이름으로 옮긴다 (--dry-run)
anloop loop                   반복 실행 (--agent / --cmd / --stdin / --yolo / --max / --sleep
                              / --timeout / --max-time / --usage / --budget-usd / --skip-spec-check)
anloop usage                  바퀴별 사용량·비용 집계 (--all)
anloop doctor                 도구·CLI·루프 상태 점검
anloop list                   설치 대상 및 실행기 목록
anloop prompt [loop|spec]     프롬프트를 stdout 으로
anloop guide                  지시서 작성 5요소 가이드
anloop uninstall [targets...] 설치 파일·블록 제거 (loop/ 기록은 남긴다)

anloop install plugin         이 저장소를 Claude Code 마켓플레이스로 만든다 (배포자용,
                              --all 에 포함되지 않는다)
```

모든 명령에 `--loop-dir <이름>` 을 줄 수 있다 (기본 `loop`). 프롬프트 본문의 경로까지 함께 바뀐다.

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
