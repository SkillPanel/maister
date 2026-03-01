# Orchestrator Creation Checklist

Use when creating NEW orchestrators or auditing existing ones. Not loaded during normal orchestrator execution.

---

## Required Elements

Before considering an orchestrator complete, verify ALL items:

- [ ] **Step 0: Load Framework** — Initialization reads `orchestrator-patterns.md`
- [ ] **State file creation** — Explicit step to CREATE `orchestrator-state.yml`
- [ ] **Phase structure** — Each phase has: Purpose, Execute, Output, State, Transition (`→ Pause` / `→ AUTO-CONTINUE` / `→ Conditional`)
- [ ] **Delegation enforcement** — Each delegated phase has: ANTI-PATTERN block, INVOKE NOW block, SELF-CHECK
- [ ] **POST-CONTINUATION blocks** — After Skill tool phases, explicit instructions to read state, update completed_phases, and continue
- [ ] **Context passing** — All subagent prompts include ACCUMULATED CONTEXT section with state summaries and prior phase summaries
- [ ] **Context extraction** — Each phase's State Update extracts findings to `phase_summaries`
- [ ] **Decision gates** — Phases receiving `decisions_needed` present to user (interactive) or log (YOLO)
- [ ] **Interactive mode** — `AskUserQuestion` at every `→ Pause` transition
- [ ] **Standards discovery** — `.maister/docs/INDEX.md` referenced in spec, plan, implement, verify phases
- [ ] **TaskCreate initialization** — Tasks created for all phases at workflow start with `addBlockedBy` dependencies
- [ ] **Auto-recovery table** — Max attempts per phase with recovery strategies
- [ ] **Domain context schema** — Includes `phase_summaries` structure

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong |
|---|---|
| Skipping Step 0 (not loading framework) | Causes AUTO-CONTINUE failures and delegation errors |
| Defining phases without transitions | Ambiguous when to pause vs continue |
| Implicit user prompts without AskUserQuestion | User loses control |
| Inline STOP reminders at END of phases | Easily missed; use `→ Pause` transitions instead |
| Vague subagent calls ("invoke X") | Must show explicit Skill/Task tool parameters |
| Inline execution in YOLO mode | Must delegate even when running continuously |
| File paths only in subagent prompts | Include state summaries and prior phase summaries |
| Stopping at AUTO-CONTINUE transitions | Brief summary is fine, but must proceed immediately |
| Missing standards references | INDEX.md must be referenced in relevant phases |
| Auto-accepting subagent decisions | User must consent; YOLO mode must log decisions |

---

## Reference

- **`orchestrator-patterns.md`** — Execution rules, schemas, and patterns
- **Existing orchestrators** — Use as implementation examples (development, performance, migration, research)
