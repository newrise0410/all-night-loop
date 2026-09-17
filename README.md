# all-night-loop

사람이 없어도 스스로 개발을 이어가는 **자율 개발 루프**를, 쓰는 LLM 코딩 도구가 무엇이든 설치한다.

한 사이클 = **지시서 읽기 → 작업 하나 → 검증 → 즉시 커밋 → 인수인계 기록 → 종료.**
이걸 밤새 반복한다.

```bash
npm i -g all-night-loop

anloop install        # 감지된 도구 전부에 스킬 설치
anloop init           # loop/SPEC.md 생성 → 직접 채운다
anloop loop           # 밤새 돌린다
```

## 어디에 설치되나

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
anloop loop                            # 기본: claude
anloop loop --agent codex --max 20
anloop loop --cmd "mycli chat {prompt}"   # 지원 목록에 없는 CLI
```

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

에이전트는 stdout 에 `[loop] ALL DONE` 같은 신호를 내고 `loop/HANDOFF.md` 의 `상태` 줄에도 같은 값을 적는다.
파일 쪽을 우선 신뢰한다 — stdout 은 유실될 수 있지만 파일은 남는다.

## 상태 파일

`anloop init` 이 만든다. **모든 상태는 기억이 아니라 파일에 있다** — 다음 사이클의 에이전트는 기억이 없다.

| 파일 | 역할 | 누가 쓰나 |
|---|---|---|
| `loop/SPEC.md` | 지시서. 무엇을/왜/어디까지 | **사람** |
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
anloop init                   loop/ 상태 파일 생성
anloop loop                   반복 실행 (--agent / --cmd / --max / --sleep)
anloop doctor                 도구·CLI·루프 상태 점검
anloop list                   설치 대상 및 실행기 목록
anloop prompt                 1사이클 프롬프트를 stdout 으로
anloop guide                  지시서 작성 5요소 가이드
anloop uninstall [targets...] 설치 파일·블록 제거 (loop/ 기록은 남긴다)
```

## 개발

```bash
npm test          # node:test, 의존성 0
```

정본 스킬은 `skill/` 하나다. 각 도구용 파일은 설치 시점에 어댑터(`src/adapters.js`)가 생성한다 —
도구를 추가하려면 어댑터 하나만 쓰면 된다.

MIT
