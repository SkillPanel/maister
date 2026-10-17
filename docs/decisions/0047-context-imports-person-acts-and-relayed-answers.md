# ADR-0047 — Context comes in through `import`, only a person takes a person's act, and a relayed answer names its person

**Status**: Accepted · **Date**: 2026-10-17 · **Builds on**: ADR-0037 (provenance keys), ADR-0040 (in-node questions under the autonomy ceiling), ADR-0045 (the context pack) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/context-import.mjs`, `question-set.mjs`, `question-triage.mjs`, `state.mjs`, `dashboard.mjs`, `gate-brief.mjs`; `skills/workflow-engine/SKILL.md`; `references/in-node-questions.md`, `references/gates.md`, `references/writing-state.md`; `workflows/development.md`, `product-design.md`, `research.md`; `agents/e2e-test-verifier.md`, `agents/user-docs-generator.md`; `skills/umbrella/scripts/lib/ledger.mjs`; `tests/engine/import.test.mjs`, `in-node-classing.test.mjs`, `provenance.test.mjs`, `projection.test.mjs`, `umbrella-dispatch-entry.test.mjs`

## TL;DR
- **Imports.** A node brings context into its task directory with a new engine verb, `import`,
  and never with a shell copy. A driven session's permissions refuse a shell copy, and the file
  tools cannot carry a binary file. A source the verb skips becomes an `open` risk when it is
  supporting context. It fails the step only when the step cannot work without it, which today
  means the design mockups.
- **Person acts.** An option that says a person did something is marked `person_act`. Such an
  option is never recommended and never a default, and a question offering one is never settled
  by the run.
- **Relayed answers.** `on_behalf_of` on a decision names the person a relaying side says gave
  the answer. It is held to one line of text and to answers a person gave. The dashboard shows
  it.

## ADR-0047 {#adr-0047}

### Status
Accepted. No workflow definition changes, so no `graph_hash` moves. The node prose of
`development`, `product-design` and `research` changes. This amends ADR-0045 § Decision 2: a
context pack that cannot be read becomes an `open` risk instead of one line in the summary.

### Context
- **A refused copy failed the whole run.** A product-design run under a cockpit driver imported
  research with a shell `cp`. The session's permissions allowed the engine script and the file
  tools inside the task directory, and nothing else, so the copy was refused. Intake has one
  attempt, so the node failed and its parent run failed with it.
- **The same pattern was elsewhere.** "Copy X in" appeared in development's intake (research,
  design, architecture, context pack), in research's foundation, and in two agents that copied
  screenshots with `cp`.
- **The run then answered for a person.** After the refusal, the session asked an improvised
  question whose recommended option was "I have copied it; read the folder again". The question
  classed as `record`, so the run settled it `by: run` and recorded an act nobody performed.
- **Relayed answers lost their author.** A hub that relays a person's answer to this machine
  carried `on_behalf_of` already (ADR-0037). Nothing checked its shape or which decisions it sat
  on, and nothing showed it.

### Decision
1. **`import --state --to [--from…] [--as]`** copies each source into `<to>/<its name>`, or into
   `<to>/<as>` for the one source.
   - Copies are byte for byte. A directory is copied recursively, and a link is copied as what it
     points at. An earlier copy is replaced.
   - Every path it reports is relative to the run and spelled with `/`.
   - It refuses the whole call, copying nothing, for:
     - a destination outside the run, whether absolute, through `..` or through a link;
     - the run root, `gates/` or `display/`;
     - a state that is not a frozen run.
   - A source it cannot take is skipped and the rest are still copied. The reasons are
     `import-source-missing`, `import-source-overlaps` and `import-copy-failed`, and the verb
     exits 1.
   - It writes no state.
2. **Each import site names its failure rule.**
   - **Supporting context becomes an `open` risk and the step goes on**, citing the source path:
     research (development and product design), the architecture, and the context pack
     (development and research).
   - **The design context is binding.** A mockup that is not imported fails `intake`, because a
     run missing a screen builds the wrong one.
   - **The agents** that gather screenshots are handed an `import_command` by their node and use
     it in place of `cp`.
3. **`person_act`** is an optional boolean on a question-set option.
   - `checkSet` refuses a set that recommends such an option or names it as the default. That
     covers both the classing write and `gate-brief --request`.
   - `classSet` classes a question offering one as if the ceiling settled nothing. It is asked
     where somebody can be, and otherwise defaulted to an option the run can take.
   - The checkpoint and the request drop the key, so their readers see the shapes they always
     have.
4. **`on_behalf_of`** must be one line of text.
   - A decision that carries it while recorded `by: run`, `audit` or `default`, or shaped as the
     run's, is refused with `state-on-behalf-of-not-operator`.
   - Under a dispatch driver, an anonymous operator-shaped answer that carries it is not
     re-credited to the run.
   - The checkpoint's not-as-recommended answers carry it. The dashboard shows "<name> (via
     <operator>)" on the answer chip and on an approval.
   - The umbrella's `resolve-followup` takes an optional `args.on_behalf_of` and records it
     beside `resolved_by`.

### Considered options

| Option | Why not |
|---|---|
| Copy with the file tools: read each file, write it | No binary survives the round trip, and a folder costs one call per file. It would also be one more prose rule of the kind the incident ignored |
| Fail every step whose import is partial | Research and context packs are background. Failing the run over them repeats the incident under a new name |
| Detect a person's act from an option's label | It would need word lists that misfire on ordinary options ("Copy the existing layout"). A declared marker is checkable, and its limit is stated |
| Verify `on_behalf_of` against a user list | The engine has no user directory, and the relaying side owns that claim. The writer can only hold the field to where it stands |

### Consequences
- **Contract changes:**
  - a new verb and four refusal codes, plus three per-source codes;
  - an optional option key, `person_act`, accepted on question sets;
  - a new writer refusal, `state-on-behalf-of-not-operator`;
  - an optional `on_behalf_of` on the checkpoint's not-as-recommended answers, on a projected
    approval, and on a resolved ledger follow-up.
- **Nothing changes for an existing run or an existing answer** without the new keys, and an
  older run reads unchanged.
- **Limits on the person-act rule:**
  - An unmarked person-act option is not caught.
  - In a run whose policy classes no questions, a node records its own decisions, the writer
    sees no options, and the rule there is prose only.
