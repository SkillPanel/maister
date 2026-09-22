# ADR-0023 — The prose twin is a reference; the orchestrator SKILL.md is a hand-off

**Status**: Accepted · **Date**: 2026-09-21 · **Sources**: `plugins/maister/skills/development/SKILL.md`; `plugins/maister/skills/research/SKILL.md`; `plugins/maister/skills/performance/SKILL.md`; `plugins/maister/skills/workflow-engine/SKILL.md` § "Probe the runtime", § "Decline the resume flags", § "Resume"; `plugins/maister/skills/umbrella/scripts/lib/envelope.mjs` (`driverCapability`); `docs/instruction-surface.md`; ADR-0013, ADR-0012, ADR-0017

## TL;DR
On the engine path — the default for three of the four definition-backed workflows — a session
loaded the whole orchestrator `SKILL.md` to read a hand-off of about 2.4 KB. The rest was the
prose twin, which that path never executes: 61,913 B for `development`, 35,448 B for `research`,
31,710 B for `performance`. **The twin's text moves unchanged into
`skills/<name>/references/<name>-twin.md`, and `SKILL.md` keeps only the branch, the gate rule and
the hand-off — at most 4,000 B.** The twin stays maintained and reachable exactly as ADR-0013
requires; only its address changes. The default path loads about 118 KB less across the three
workflows, and the opt-out path pays one extra read.

## ADR-0023: The prose twin is a reference; the orchestrator SKILL.md is a hand-off {#adr-0023}

### Status
Accepted. Nothing here changes a registered shape, a schema or a fixture. It changes where
already-written prose lives and what a session loads to reach it.

### Context
ADR-0014 gave `development` a workflow definition and ADR-0013 fixed the lifetime of the prose
copy beside it: kept, maintained and reachable until three blockers clear, then retired. What
neither record settled is what the orchestrator's `SKILL.md` should *contain* once the engine
became the default.

The answer in practice was: everything. The file kept both implementations — the branch that
chooses between them, and the full prose phases the branch usually does not select. A model
invoking `/maister:development` therefore read 61,913 B in order to act on about 2,400 B of it,
and the same happened in every dispatched worker that injected the orchestrator skill, because
the injection is of the file, not of the branch outcome. Measured across the three switched-over
workflows that is roughly 118 KB a session pays for text the run will not execute — the single
largest avoidable load in the plugin, and the bulk of the start-chain growth since 2.2.4.

The load is avoidable because the plugin already has the machinery to avoid it. A skill's
`references/` directory is read on demand: a session loads a reference only when the body tells it
to, which is precisely the shape of the opt-out branch. The twin was simply never moved there.

Two properties of the `SKILL.md` file itself constrain how far it can be emptied, and both were
established by reading the runtime rather than assumed:

- **Dispatchability is decided per `SKILL.md`.** `driverCapability()` in
  `skills/umbrella/scripts/lib/envelope.mjs` decides whether a node may be dispatched into a
  member repository by reading that file and looking for `driver_aware: true` in the frontmatter
  or the literal `orchestrator.driver.kind` in the body. It reads the file, never its references.
  An orchestrator whose gate rule moved into a reference would silently stop being a legal
  dispatch target.
- **The Step-0 gate block is a lockstep carrier.** `CLAUDE.md` names six carriers of the same
  byte-identical sentence — the six orchestrator Step-0 blocks, the framework patterns and itself.
  A hand-off that paraphrased it would break the lockstep and the grep-based checks around it.

These two facts point the same way: the gate block stays in `SKILL.md`, and it is also what keeps
the orchestrator dispatchable. One paragraph satisfies both.

### Decision Drivers
- What a session *loads* is the denominator, not what the plugin ships.
- The largest single avoidable load goes first.
- No contract shape, and no recorded decision, is reversed to get it.
- The twin's text is not rewritten, so parity with the definition is untouched.
- The orchestrator must stay dispatchable and must keep carrying the gate rule.

### Considered Options
1. Leave the twin in the orchestrator `SKILL.md`.
2. **Hand-off-only `SKILL.md`; the twin becomes a reference read only when the opt-out variable is set or Node is absent.** ← chosen
3. A separate prose-twin *skill* per workflow.
4. Retire the twin now.
5. Stop the load at its source, through seed and brief wording.

### Decision Outcome
Chosen option: **2**. It returns the whole avoidable load on the default path, moves no contract
shape, rewrites none of the twin's text, and keeps the twin maintained and reachable as ADR-0013
requires. The same pattern serves every definition-backed orchestrator that follows.

Option 1 keeps the cost for no benefit. Option 3 raises every session's *fixed* cost — a skill
contributes its description at session start whether or not it is invoked — to save a load that
only some sessions pay. Option 4 reverses ADR-0013 while all three of its blockers are open.
Option 5 rests on an unestablished cause and is kept as a probe after this lands, not as a
substitute for it.

### The file list, settled
The audit's exploration spoke of six orchestrators. The tree carries the opt-out branch in three,
and that is the list:

| Orchestrator | Ships `workflows/<name>.yml` | Has the opt-out branch | In this change |
|---|---|---|---|
| `development` | yes | yes | **yes** |
| `research` | yes | yes | **yes** |
| `performance` | yes | yes | **yes** |
| `migration` | yes | no — its `SKILL.md` opens at `## Initialization` and never hands over | no |
| `product-design` | no definition | no | no |

`migration` ships a definition but has not flipped over; ADR-0013's rollout status records that
shipping a definition and running it by default are separate events. Giving `migration` a hand-off
would flip it, which is a behaviour change and belongs to whichever change presents its parity
evidence. `product-design` has no definition and therefore no twin. Both take this shape the day
they switch over; nothing here blocks that.

### What a hand-off contains
In order, and nothing else:

1. Frontmatter **verbatim** — the `description` is what a router reads.
2. Title and one-line purpose.
3. `## Entry Point` — the two-branch decision, the switch read as
   `node -p "process.env.MAISTER_WORKFLOW_PROSE ?? ''"`, the hand-over naming `builtin:<name>`
   with the task description, resume target and flags, the rule that `--from=PHASE` and
   `--reset-attempts` are handed over rather than dropped, and the rule that **a task directory
   carrying no `workflow:` block is always resumed by the twin**.
4. The opt-out sentence, citing `references/<name>-twin.md` in backticks and naming the Read
   tool — see the measurement below for why the tool is named rather than left to the session.
5. `### Step 0` — the gate block, byte-identical.

Rationale that asked a session to do nothing — why the variable names what it selects rather than
what it disables, why there is one switch and not one per workflow — is not in the hand-off. It is
here and in ADR-0013, which is the general rule this change follows: the "why" goes to the decision
records, where no session loads it.

### What the reference contains
Everything from `## Initialization` to end of file, **byte-identical** to what stood in `SKILL.md`,
under a short header that states what the file is and anchors its relative paths. The body still
spells `../orchestrator-framework/references/orchestrator-patterns.md`, which resolves from the
skill directory and not from `references/`; rewriting those four paths per file would break the
byte-identity the parity claim rests on, so the header resolves them in a sentence instead. None of
the three bodies spells the plugin-root variable, so the root-anchor sentence that a reference
spelling it would have to carry is not triggered here.

The gate block appears in both files. That is deliberate: both copies are byte-identical to the
other carriers, and a session on the opt-out path reads the hand-off first and the reference
second, so it meets the rule before it meets the phases.

### The measurement

| Skill | `SKILL.md` before | `SKILL.md` after | Reference | Returned per session |
|---|---:|---:|---:|---:|
| `development` | 61,913 B | 3,824 B | 59,765 B | 58,089 B |
| `research` | 35,448 B | 3,819 B | 33,221 B | 31,629 B |
| `performance` | 31,710 B | 3,894 B | 29,497 B | 27,816 B |
| **Total** | **129,071 B** | **11,537 B** | **122,483 B** | **117,534 B** |

The corpus is unchanged in size — the same prose, in a different file — which is the point: the
saving is in what a run loads, not in what the plugin ships. `docs/instruction-surface.md` records
the shift between its two rows.

### What a pro-edition pin bump must update
The compatibility contracts suite is a Pro Edition feature and does not live here, so this change
cannot update it. It is recorded here so the pin bump is not a discovery:

- **T31, T33, T60** — the twin parity rows. Where they name the orchestrator `SKILL.md` path as the
  twin's home, they repoint at `skills/<name>/references/<name>-twin.md`. They are `in-repo` rows
  that look for parity checklists in the open repository's task directories, so they are exercised
  only where that evidence is present (ADR-0013).
- **T64** — reference integrity in both directions. Three new `references/*.md` files exist and each
  is cited by a backtick token in its skill; three new citations exist and each resolves to a file
  on disk. Both directions are satisfied as written, with no suite edit — the row is named so the
  bump's reviewer can see it was considered.
- **T46** — the root-anchor sentence. **Not triggered.** It applies to any `.md` in a skill
  directory that spells the plugin-root variable, and none of the three moved bodies does. If a
  later twin does, its reference takes the anchor sentence with it.
- The dispatchability literal is unaffected: `orchestrator.driver.kind` remains in all three
  `SKILL.md` bodies, which is what `envelope.mjs` reads.

References are found non-recursively, so the twin sits directly in `references/` and never in a
subdirectory of it.

### The behaviour, measured
Three headless sessions against a throwaway project, the edited tree loaded for one session only,
turn-capped before any task directory was created:

| Switch | Skill | What the session did |
|---|---|---|
| unset | `development` | read the switch, took the engine branch, invoked `maister:workflow-engine` with `builtin:development`, the task description and an explicit "no resume target, no flags" — and never opened the twin |
| `1` | `development` | read the switch, opened `references/development-twin.md`, worked into it |
| `1` | `research` | read the switch, opened `references/research-twin.md` |

So the hand-off drives both branches, and the reference is reached unprompted. What the runs also
showed is the tool question above, which is why the opt-out sentence names the Read tool rather
than saying "read".

### Consequences

#### Good
- About 118 KB less loaded across the three workflows' default paths, and the same saving in every
  driver leg and dispatched worker that injects one of these skills.
- The twin's text is unchanged, so parity with the definition is untouched and the parity checklist
  keeps its meaning.
- Retirement under ADR-0013 becomes smaller and cleaner: delete one reference file per workflow and
  the opt-out branch that reaches it, rather than carve a twin out of a live orchestrator.
- The pattern is reusable — `migration` and `product-design` take it the day they switch over.
- Rationale has a home no session loads, which is what stops the body regrowing.

#### Bad
- The opt-out path pays one extra read before Phase 1.
- A relative path in the reference body resolves from one directory above the file it sits in, held
  together by a header sentence rather than by the path itself. A later edit that *rewrites* those
  paths must also drop the sentence, and must accept that it has ended byte-identity.
- The gate block now has three more carriers, all byte-identical but all needing the same lockstep
  edit.
- A pin bump in the pro repository is required for the rows listed above.
- The opt-out path's read has to be told which tool to use. The failure mode of progressive
  disclosure is a reference nobody reads, and the near miss of it is a reference read badly: in the
  smoke runs above, a session left to itself read a 58 KB twin through the shell and got a
  truncated result it then had to navigate back into. The branch therefore names the Read tool, and
  a later twin that grows past what one read returns will need paging guidance rather than a
  louder sentence.
