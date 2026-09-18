<!-- all-night-loop:start -->
## 자율 개발 루프 (all-night-loop)

사용자가 "지시서 만들어줘" / "SPEC 써줘" / "/all-night-spec" 이라고 하면
**`.agent/skills/all-night-spec.md`** 를 읽고 그 절차를 따른다.
주제를 받아 `loop/design.md` 와 `loop/backlog.md` 를 쓴다. 구현은 시작하지 않는다.

사용자가 "밤새 돌려줘" / "자율 루프" / "혼자 개발해줘" / "/all-night-loop" 이라고 하면
**`.agent/skills/all-night-loop.md`** 를 읽고 그 절차를 따른다.
핵심: `loop/design.md` 를 읽고 → `loop/backlog.md` 에서 작업 **하나만** 골라 →
구현 → 검증 → **통과 즉시 커밋** → `loop/status.md`·`loop/journal.md` 에 인수인계 기록 → 종료.
한 사이클만 수행하고 멈춘다. 이어서 다음 작업을 시작하지 않는다.
<!-- all-night-loop:end -->
