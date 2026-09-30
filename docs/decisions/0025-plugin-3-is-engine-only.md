# ADR-0025 — Plugin 3.0 is engine-only

**Status**: Accepted · **Date**: 2026-09-27 · **Sources**: `plugins/maister/skills/{development,research,performance}/SKILL.md` § "Entry Point"; `plugins/maister/skills/{development,research,performance}/references/<name>-twin.md`; `plugins/maister/skills/workflow-engine/SKILL.md` § "Probe the runtime", § "Resolve the workflow by name", § "Decline the resume flags", § "When a write is refused", § "Resume"; `plugins/maister/skills/workflow-engine/scripts/lib/state.mjs` (`selfCheck`); `plugins/maister/skills/orchestrator-framework/references/orchestrator-patterns.md` §§ 4, 5, 8; `plugins/maister/commands/work.md`; `plugins/maister/skills/migration/SKILL.md`; `plugins/maister/skills/product-design/SKILL.md`; `docs/workflows.md`, `docs/commands.md`; ADR-0006, ADR-0012, ADR-0013, ADR-0015, ADR-0016, ADR-0023

## TL;DR
The next release of the open plugin is **3.0.0, a major version**. The workflow engine becomes the
only way `development`, `research` and `performance` run; their prose twins, the
`MAISTER_WORKFLOW_PROSE` switch and every branch that reaches a twin are deleted; Node.js 20 becomes
a hard prerequisite of those workflows; and a task directory whose state carries no `workflow:`
block is **refused on resume** with a message that sends the operator to the 2.x line, never adopted
and never written to. This is the retirement ADR-0013 promised, taken as one release of its own. The
breaking changes and the removal list below are read from the tree. Five choices were the
operator's and took the recommended option each: `migration` switches to the engine before 3.0;
`product-design` stays a standalone prose orchestrator in 3.0 with a definition scheduled for a 3.x
minor; mid-workflow re-entry is not in 3.0 and is designed for 3.1 as its own decision; the 2.x line
is `release/2.x`, cut from 2.2.5, receives defect fixes for six months after 3.0.0 and installs from
its own marketplace, `maister-plugins-2x`.

## ADR-0025: Plugin 3.0 is engine-only {#adr-0025}

### Status
Accepted. The five sections that were the operator's choice were decided on 2026-09-27; each keeps
its options table, and the decided row is marked. Nothing here changes a registered shape. It
removes one implementation of three workflows and the paths that reach it.

### Context
ADR-0013 kept the prose twin of each definition-backed workflow as the rollout escape hatch and
fixed its end: retire it once the engine is proven, which turns the script runtime from soft- to
hard-required — a breaking change needing a release of its own. ADR-0023 then moved each twin out of
its orchestrator `SKILL.md` into `references/<name>-twin.md`, leaving a hand-off that reads the
switch and either invokes the engine or reads the twin. Retirement was framed there as deleting one
reference per workflow and the branch that reaches it.

ADR-0013 named three blockers. This record answers each rather than waiting for it to clear:

- **Directories with no frozen graph.** They stay resumable — on 2.x. 3.0 refuses them (below), so
  they no longer hold the twin in place.
- **Installs with no script runtime.** 3.0 requires Node 20 and says so; an install that cannot run
  it stays on 2.x.
- **Workflows not yet switched over.** `migration` ships a definition but its skill never hands over;
  `product-design` has no definition. Both are open below. Neither is a twin — each is its only
  implementation — so the twin removal does not wait on them; what waits on them is how much of the
  framework's prose-path text can go with it.

### Decision Drivers
- A second implementation nobody runs by default drifts silently; ADR-0013's arithmetic has not
  changed.
- A hard requirement and a refused resume are breaking changes, so they ship in a major version with
  a maintained line behind it.
- Every breaking change is listed from the code, not from the direction.
- An operator upgrading mid-task meets the refusal first; it must say what to do in one reading and
  touch nothing.

### Considered Options
1. Keep the twins in 3.0 as an unmaintained fallback
2. Retire the twins in a 2.x minor release
3. **Retire the twins in 3.0.0, refuse 2.x directories on resume, keep a 2.x line maintained** ← chosen

### Decision Outcome
Chosen option: **3**. Option 1 is ADR-0013's rejected "best-effort" option under a new name: a
fallback that looks supported and silently differs, discovered by exactly the operator who cannot
use the alternative. Option 2 breaks installs without Node and every in-flight prose run inside a
version range whose number promises that nothing breaks. Option 3 puts the break where semver says
it goes and leaves 2.x users a line that still runs their work.

### Breaking changes
Each row is a behaviour a 2.x user has today and 3.0 removes or changes. Decided.

| # | 2.x behaviour | 3.0 behaviour | Where it lives today |
|---|---|---|---|
| 1 | `development`, `research`, `performance` run without Node: the hand-off selects the twin when there is "no script runtime to read" the switch with, and the engine's runtime probe hands a `node-unavailable` run to the twin | Node 20 is required. Without it the hand-off stops before any task directory exists and names the requirement and the 2.x line | `skills/<name>/SKILL.md` § "Entry Point"; `workflow-engine/SKILL.md` § "Probe the runtime" |
| 2 | `MAISTER_WORKFLOW_PROSE` set to any non-empty value runs the prose phases of every definition-backed workflow | The variable is no longer read; setting it changes nothing | the three hand-offs; `workflow-engine/SKILL.md` § "Resolve the workflow by name" (the reading rule); `commands/work.md`; `docs/workflows.md`, `docs/commands.md` |
| 3 | A task directory whose state has no `workflow:` block is resumed by the twin, whatever the switch says | Refused on resume — see [What the refusal says](#the-resume-refusal) | the three hand-offs; `workflow-engine/SKILL.md` § "Resume" |
| 4 | An engine run that the state writer refuses as not ownable (`state-non-canonical`, `state-unreadable`, `state-unwritable`, `state-incomplete`, `state-candidate-unsound`) or whose writer does not run (exit 2) is handed to the prose orchestrator; so is a run refused after a gate answered through an editor tool | The run stops with its `RUN-FAILED:` code and the writer's message. There is no second interpreter to hand it to; the operator repairs the directory or starts a new task | `workflow-engine/SKILL.md` § "When a write is refused", § "Driver-suspended mode — resume" |
| 5 | An operator who hits an engine defect sets one variable and gets the previous behaviour back | No in-version escape hatch. The escape is the 2.x line, per workflow run, not per session | ADR-0013 (the rollout rationale) |
| 6 | `--from=PHASE` on `development`, `performance` and `migration`, and `--reset-attempts` on `development` and `migration`, are honoured by prose phases; `research`'s twin re-enters by artifact presence | Declined by name with no route in the plugin; the decline names the 2.x line for a run that needs a phase jump and says re-entry is planned for the engine — see [Mid-workflow re-entry](#mid-workflow-re-entry) | `workflow-engine/SKILL.md` § "Decline the resume flags"; `commands/work.md`; ADR-0016 |
| 7 | The dashboard of a prose `development`, `research` or `performance` run is rewritten by the orchestrator at seven moments | Always projected by the state writer (ADR-0024). No behaviour loss; listed because a 2.x directory's dashboard is no longer refreshed by 3.0 at all | `orchestrator-patterns.md` § 8 |

Rows 1–5 and 7 follow from the twin's removal. Row 6 follows from the re-entry decision below. Rows
1–4 and 6 apply to `migration` as well, since it switches to the engine before 3.0.

### The removal list
By path, decided. The criterion: delete what only the twins or the switch use; keep anything an
engine definition, an engine node's prose, `migration`, `product-design` or another surviving skill
still names. The whole plugin tree was swept for callers of every agent, reference, asset and
command; the Copilot variant is regenerated, never edited.

**Deleted**

- `plugins/maister/skills/development/references/development-twin.md`
- `plugins/maister/skills/research/references/research-twin.md`
- `plugins/maister/skills/performance/references/performance-twin.md`

**Cut from surviving files**

| File | What goes |
|---|---|
| `skills/{development,research,performance}/SKILL.md` | § "Entry Point": the "exists twice" paragraph, the switch read and the twin branch, "or no script runtime" (replaced by the Node stop of breaking change 1), the "no `workflow:` block is always resumed by the twin" rule (replaced by the refusal), the sentence pointing at the twin for the phase flag, and the line naming `references/<name>-twin.md` on the prose path. The gate block (Step 0) stays byte-identical — it is a lockstep carrier and what `driverCapability()` reads to keep the skill dispatchable (ADR-0023) |
| `skills/workflow-engine/SKILL.md` | Step 2's twin hand-over (the no-twin half becomes the only half); the switch-reading paragraphs under Step 3; Step 5's route clause and its "describe that route as the twin behaves" paragraph (what replaces them depends on the re-entry decision); the four "hand the run to the prose orchestrator" responses in § "When a write is refused" and § "Driver-suspended mode — resume"; § "Resume"'s "not engine-resumable … hand it to the prose twin" paragraph (replaced by the refusal) and its "The prose twin is transitional" paragraph; "exactly as on the prose one" under § "Operator visibility" |
| `skills/migration/SKILL.md` | Everything after the hand-off, once the switch is proven: it becomes a hand-off shaped like the other three (Node check, refusal, `builtin:migration`, gate block), with no twin and no switch. Its `--from=PHASE`, `--reset-attempts` and auto-recovery table go with the prose |
| `skills/workflow-engine/workflows/{development,performance,migration}.md`, `migration.yml` | The instructions that keep gate wording verbatim "from the workflow's prose form, because equality against that form" is checked. The forms they point at are deleted, so the node prose becomes the wording of record |
| `skills/workflow-engine/workflows/research.md` | Nothing is cut, but it gains the exact agent ids and reference paths it now names only by description — see "Kept" below |
| `commands/work.md` | The prose-path explanation, the `MAISTER_WORKFLOW_PROSE=1 … --from=verify` example and the resume-signature text naming the prose phases as a fallback. The `migration` resume row and its `--reset-attempts` example go with migration's prose; the `product-design` row stays |
| `skills/product-design/SKILL.md` | The pointer to `development-twin.md` § "Design-Informed Development" and the twin's phase names beside it; the pointer moves to the design-context intake in `workflow-engine/workflows/development.md` |
| `skills/orchestrator-framework/references/orchestrator-patterns.md` | § 4's pointer to "each orchestrator's SKILL.md Domain Context section" for the development, research and performance context blocks — the only full description of those blocks is in the twins, so the pointer moves to the state writer's context-block map. The prose-path sections (dashboard moments 1–7, task-item tracking, `task_ids`, `auto_fix_attempts`, the phase-table resume logic) **stay for `product-design`**, the one prose orchestrator 3.0 keeps. They are reworded to name it instead of "the prose path", and removed when its definition lands |
| `skills/orchestrator-framework/SKILL.md`, `references/orchestrator-creation-checklist.md` | `development`, `performance` and `research` stop being cited as implementation examples of a prose orchestrator |
| agent "Invoked by … Phase N" lines | `gap-analyzer`, `solution-brainstormer`, `solution-designer`, `implementation-planner`, `specification-creator`, `production-readiness-checker`, and `codebase-analyzer/SKILL.md` cite twin phase numbers; they re-point at node ids |
| `workflow-engine/scripts/lib/prior-context.mjs`, `state.mjs`, `dashboard.mjs` | Comments that name "the prose twins". Comments about "the prose orchestrator" stay while `product-design` is one — the state writer's adoption of a prose-written file is theirs too |
| `CLAUDE.md` | The "where documented" row that sends development phases and design-context propagation to `development-twin.md` re-points at `workflows/development.md` |
| `docs/workflows.md`, `docs/commands.md`, `docs/extending.md`, `docs/instruction-surface.md` | Every "exists twice", switch, "prose only" flag and resume-phase list, and the twin paths. The operator documentation is rewritten true for 3.0; `docs/instruction-surface.md` records the removal as a row, as it recorded the move |
| `README.md` | The Node line states the requirement without qualification, and gains the 2.x install path the line below settles |

**Kept, and why**

- **Every agent.** No agent loses its last caller. Three research agents — `research-planner`,
  `research-synthesizer`, `information-gatherer` — and three research references —
  `research-methodologies.md`, `brainstorming-techniques.md`, `design-techniques.md` — are named by
  exact id or path only in `research-twin.md`; the engine's `workflows/research.md` uses each of
  them by description ("invoke the research planner", "read the research-methodologies reference").
  They stay, and that node prose gains the exact ids and paths in the same change, before the twin
  goes, so nothing is left for a session to guess.
- The prose-path framework text named above, for `product-design`.
- `state.mjs`'s `selfCheck` refusal of a candidate with no `workflow:` block. It is what makes a 2.x
  directory unadoptable, and the refusal below relies on it rather than working around it.
- `hooks/gate-lib.mjs`'s legacy-directory rules. They concern directories below the compatibility
  floor, not twins.

**Records**: ADR-0013 and ADR-0023 are closed by amendment, not deleted — their history is why the
twin existed and why it lived where it did. ADR-0016 names the twin as the sanctioned route for the
two flags it declines; it is amended to say that route is gone in 3.0 and re-entry is redesigned
separately.

**The pro edition follows.** The contracts suite is not in this repository, so this change cannot
update it; recorded so the pin bump is not a discovery, as ADR-0023 did: the twin parity rows (T31,
T33, T60) retire with the twins, and the row reading the migration parity checklist is updated when
migration switches; T64 must see three references and their citations disappear
together; the dispatchability literal is untouched because the gate block stays in each `SKILL.md`.

### `migration` {#migration}

**Status: decided by the operator, 2026-09-27.**

Facts. `skills/workflow-engine/workflows/migration.yml` exists and resolves. `migration/SKILL.md`
opens at `## Initialization` and never hands over, so every migration run is prose. ADR-0023 left it
there on purpose: giving it a hand-off flips its default, which is a behaviour change that belongs
to the change presenting its parity evidence. It is not a twin — its prose is its only implementation
— so the twin removal does not delete it. But while it stays prose, it keeps writing state by
text-editing YAML, the one write path the engine exists to remove (ADR-0012), and it keeps the
framework's prose-path sections alive.

| Option | Pros | Cons |
|---|---|---|
| **A. Switch to the engine before 3.0: hand-off shaped like the other three, parity walked against real runs** ← recommended, **decided** | 3.0 is engine-only for every workflow that has a definition; its state is written by the script; the definition already exists | Needs parity runs before 3.0 and a pro parity-row update; `--from=PHASE` on migration then falls under the re-entry decision |
| B. Keep `migration` as a standalone prose orchestrator in 3.0 | No work before 3.0 | 3.0 ships a workflow whose state the model edits as text; the framework keeps its prose-path text; a definition ships that nothing runs |
| C. Remove `migration` from 3.0; route migrations to `development` | Smallest surface | Drops a documented workflow and its artifacts; ADR-0015 records why development cannot stand in for it |

**Decision: A.** The definition is written, and the remaining work is the evidence ADR-0013
already requires of every switch. If the parity runs fail and cannot be fixed inside the 3.0 window,
B is the fallback, stated in the release notes as a known exception — not C.

### `product-design` {#product-design}

**Status: decided by the operator, 2026-09-27.**

Facts. `product-design` has no definition. Its skill is a 54 KB prose orchestrator with iterative,
operator-driven loops; ADR-0014 settled that loops of that kind are node prose, so a definition is
expressible, but none is written. It is not a twin and not removed by this record. One tempting
middle route does not exist today: `state.mjs` `selfCheck` refuses any candidate state without a
`workflow:` block (`state-incomplete`), so a prose orchestrator cannot borrow the engine's writer
without a definition to freeze.

| Option | Pros | Cons |
|---|---|---|
| A. Author a definition and hand-off before 3.0 | 3.0 is engine-only without exception; script-written state; the prose-path framework text can go once `migration` also switches | The largest unwritten item in the release: a definition, node prose and parity runs for the most interactive workflow |
| B. Keep it a standalone prose orchestrator indefinitely, documented as outside the engine | No work; the skill works today | 3.0's "engine-only" carries a permanent exception; text-edited state stays; the framework keeps its prose-path sections for good |
| **C. Keep it standalone in 3.0, stated as the one exception in the release notes, with a definition scheduled for a 3.x minor** ← recommended, **decided** | 3.0 is not held on the largest item; the exception is time-bounded and visible; adding a definition later is not breaking | Two execution models in 3.0; the text-edit state defect stays for this one workflow until the definition lands |
| D. Remove `product-design` | Engine-only without exception at no cost | Removes a workflow that users run and that `development` ingests the output of |

**Decision: C.** Nothing in 3.0's breaking changes depends on `product-design` switching — it
never had a twin — so holding the release on it buys nothing a 3.x minor cannot deliver without a
break.

### Mid-workflow re-entry {#mid-workflow-re-entry}

**Status: decided by the operator, 2026-09-27.**

Facts. `--from=PHASE` (re-enter a run at a named phase) is honoured today only by the development
and performance twins; `--reset-attempts` (clear a phase's accumulated fix attempts) only by the
development twin; the research twin has no phase flag and re-enters by artifact presence. On the
engine path both flags are declined by name: `workflow-engine/SKILL.md` Step 5 and § "Resume" say
which fact makes each inert — `needs` is acyclic so there is no edge back, and attempt budgets are
node prose so no counter lives in state — and **name the twin as the only route that still serves
them**. ADR-0016 recorded that as the decision. Deleting the twins removes that route, so 3.0 users
of those three workflows lose mid-workflow re-entry entirely unless something replaces it.
`migration` loses its own `--from=PHASE` and `--reset-attempts` when it switches; `product-design` keeps its `--from=PHASE` while it stays prose.

| Option | Pros | Cons |
|---|---|---|
| A. Accept the loss in 3.0: the flags are declined with no route named, and the loss is a listed breaking change | No engine work; one fewer moving part | A real capability disappears; an operator whose run went wrong late has only resume-from-frozen-state or a new task |
| B. Give the engine an equivalent before 3.0: re-enter at a node, and reset a node's attempts, through a `write-state` patch that resets node statuses from the named node forward | The capability survives the break; expressed on the state writer, so it stays script-written | Reverses ADR-0016, which rejected mid-graph entry as an engine feature; new design and tests on the 3.0 critical path; node prose must learn to re-run over its own artifacts |
| **C. Ship 3.0 without it (as A), and design the engine equivalent for 3.1 as a new decision amending ADR-0016** ← recommended, **decided** | 3.0 is not held on new engine design; the loss is announced as temporary; the design gets its own record instead of being rushed | 3.0.x users are without re-entry until 3.1; the 3.0 message must not promise a date it cannot keep |

**Decision: C.** Re-entry is a new engine capability, not a port — ADR-0016 records why the
graph cannot express it as it stands — so it should not be designed under a release deadline. Until
then the decline message names the 2.x line for a run that genuinely needs a phase jump, and says
re-entry is planned for the engine.

### The 2.x maintenance line {#the-2x-line}

**Status: decided by the operator, 2026-09-27.**

Facts. `master` is at 2.2.4 (`maister-plugins`); `beta` is at 2.2.5-beta.3 (`maister-plugins-beta`)
and carries 2.x fixes not yet released; the 3.0 development line is at 2.3.0-beta.N. A remote
branch named `v2` already exists, pointing at a 2.0.0-beta.1 commit that `master` contains. The
README installs stable from the default branch and beta from `SkillPanel/maister#beta` under its
own marketplace name. State records no plugin version, so 2.x and 3.0 directories are told apart by
shape, not by a stamp. Known 2.x defects still open: prose orchestrators corrupt
`orchestrator-state.yml` by editing it as text (duplicate keys, drifted indentation); the
implementation verifier dispatches its review subagents before the test suite although the skill
says tests first; and two public reports against the development orchestrator — verification phases
skipped when the plan's last task group is named "Finalization", and optional-phase defaults
silently not applied.

**Branch name**

| Option | Pros | Cons |
|---|---|---|
| **`release/2.x`** ← recommended, **decided** | Unambiguous; room for `release/3.x` later | Slash in a marketplace ref (`#release/2.x`) — works, but longer to type |
| `v2` | Short | Collides with the stale `v2` branch, which would have to be force-moved or deleted first |
| `2.x` | Short, no collision | Reads like a tag; no namespace for later lines |

**Cut point**

| Option | Pros | Cons |
|---|---|---|
| **Release 2.2.5 from `beta` first, then branch from the `v2.2.5` tag** ← recommended, **decided** | 2.x users get the fixes already on `beta`; the line starts from a release | One more 2.x release before 3.0 |
| Branch from `v2.2.4` | Starts from what stable users run today | The fixes on `beta` must be re-applied to the line by hand |

**What it receives, and for how long**

| Option | Pros | Cons |
|---|---|---|
| **Defect fixes only — no features, no new workflows — for six months after 3.0.0, extended only by a recorded decision** ← recommended, **decided** | Bounded cost; a date users can plan against; the defects listed above are in scope | Six months may be short for a user blocked on Node |
| Security and data-loss fixes only, same window | Cheapest | The listed defects are neither, so 2.x users keep them |
| Defect fixes until 3.1.0, whenever that is | Ties the line to capability recovery (see re-entry) | No date users can plan against |

**Install path**

| Option | Pros | Cons |
|---|---|---|
| **Own marketplace name `maister-plugins-2x` from `SkillPanel/maister#release/2.x`** — the beta channel's precedent ← recommended, **decided** | Which line a user registered is visible in `/plugin list`; stable's name can move to 3.0 without ambiguity | Staying on 2.x is uninstall-and-install, not a re-point |
| Keep `maister-plugins` on the 2.x branch | Plugin id unchanged for the user | Two registrations of one marketplace name point at different majors; support questions cannot tell which a user has |

**Decided**: branch `release/2.x`, cut from the `v2.2.5` tag after 2.2.5 is released from `beta`;
defect fixes only for six months after 3.0.0, extended only by a recorded decision; installed from
its own marketplace:

```
/plugin marketplace add SkillPanel/maister#release/2.x
/plugin uninstall maister@maister-plugins
/plugin install maister@maister-plugins-2x
```

The README and the 3.0 release notes carry these lines, the window, and "finish in-flight 2.x tasks
on 2.x"; the refusal below names the same lines. The three 2.x defects and the two public reports
above are defects, so they are in the line's scope. 3.0 does not carry the text-edit defect for its
engine workflows, because their only state writer is the script; `product-design` keeps it until its
definition lands.

### The resume refusal {#the-resume-refusal}

Decided. **Detection**: a resume target whose `orchestrator-state.yml` has no `workflow:` block, for
a workflow that 3.0 runs on the engine — `development`, `research`, `performance` and `migration`. Nothing else is needed and nothing more is available: state
carries no writer-version field, so the refusal says "2.x" from the shape and cannot name the exact
version that wrote the directory. A directory written by a 2.3.0 beta of the engine carries a
`workflow:` block and resumes normally. A `product-design` directory is resumed by its own prose
orchestrator, as in 2.x.

**Where**: the orchestrator hand-off, before it invokes the engine — so no engine step runs — and
the engine's § "Resume" states the same rule for a run that reaches it by another route.

**What it does**: reads the state file and nothing else; writes nothing into the directory, the
dashboard included; creates no task directory; exits the command. Starting a new task afterwards
is an ordinary first run.

**What it says** — one message, no stack trace:

> This task was started by maister 2.x — its `orchestrator-state.yml` has no `workflow:` block — and
> maister 3.0 does not resume it. Nothing in the directory was changed.
> To finish it, install the 2.x line and resume it there:
> `/plugin marketplace add SkillPanel/maister#release/2.x`, then
> `/plugin uninstall maister@maister-plugins` and `/plugin install maister@maister-plugins-2x`.
> To start the work over on 3.0, run the command again without a task path.

**The compatibility floor.** ADR-0006's floor still describes what may be **read**: a directory
written by 2.2.3 or newer is listed, parsed and rendered as before, and one below the floor is an
inventory row. 3.0 changes neither half of that. What narrows is resume in the open plugin: it now
requires a `workflow:` block, so a 2.x prose directory at or above the floor is renderable but not
resumable here. The register that governs what the cockpit reads lives in the pro edition since
ADR-0006's 2026-09-20 amendment and needs no change for this.

### Consequences

#### Good
- One implementation of each engine workflow; a behaviour question has one answer and one file.
- About 124 KB of prose and the switch that selected it leave the tree; the hand-offs shrink to the
  Node check, the refusal and the gate block.
- Every state write in the three workflows goes through the script, so the text-edit corruption
  class cannot occur in them.
- The break is announced once, in a major version, with a line behind it.

#### Bad
- Installs without Node cannot run 3.0's engine workflows at all.
- In-flight 2.x prose runs cannot be continued on 3.0; the operator finishes them on 2.x or starts
  over.
- An engine defect has no in-version escape hatch; the answer is a fix release or the 2.x line.
- 3.0 is engine-only with one stated exception, `product-design`, which keeps the framework's
  prose-path text and the text-edit state writes alive until its definition lands.
- Mid-workflow re-entry is gone for the engine workflows from 3.0.0 until its redesign ships.
- A 2.x line is a second branch to fix and release for the length of its window.
- The refusal can say "2.x" but not the exact version, because 2.x state never recorded one.

### Operator decisions, 2026-09-27
Each took the recommended option.

1. `migration`: switch to the engine before 3.0.
2. `product-design`: standalone prose orchestrator in 3.0, the one stated exception; a definition in a
   3.x minor.
3. Mid-workflow re-entry: not in 3.0; an engine equivalent is designed for 3.1 as its own decision
   amending ADR-0016.
4. 2.x branch and cut point: `release/2.x`, cut from 2.2.5 released off `beta`.
5. 2.x scope, window and install path: defect fixes only, six months after 3.0.0, marketplace
   `maister-plugins-2x`.

### Amendment 2026-09-30 — implemented
The removal list above is carried out, with one addition: `migration` switched to the engine
after this record was written and took a twin of its own, `skills/migration/references/migration-twin.md`,
which is deleted with the other three. The resume refusal lives in a read-only engine verb,
`resume-check`, rather than in each hand-off: `/maister:work <dir>`, `/maister:run <dir>` and each
workflow's own command all reach the engine's § "Resume", whose first action is that verb, and
`/maister:run` already needed a state read for the frozen workflow's name, which the verb now
supplies. The message is kept in one place and tested. It names the two install lines of the
README's "Staying on 2.x" section and, for another channel already installed, the uninstall line.
A `product-design` directory, which has no `workflow:` block either, is sent to its own command
rather than refused. The pro edition follows at its next pin: the twin parity rows and every row
that reads a twin or the switch retire, and the new verb joins the gate library's list of the
engine's verbs.
