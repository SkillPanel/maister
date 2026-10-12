# ADR-0043 — Run context and HTML companions are fetched, declared and checked

**Status**: Accepted · **Date**: 2026-10-12 · **Builds on**: ADR-0012 (completion registers declared artifacts and companions; amends its patch route), ADR-0029 (`absent`, the sanctioned absence a check skips), ADR-0030 (the closed checkpoint and request shapes a pointer stays out of) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/run-context.mjs` (the `run-context` block, shared by `prior-context --node`); `scripts/lib/companions.mjs` (`companionsOf`, `owedCompanions`); `scripts/lib/state.mjs` (`companionsOfRun`, the registration fix, `companion-missing:`); `scripts/lib/complete.mjs` (`missing-companion:`); `scripts/lib/locate.mjs` (`html_companions` on `locate --name`); `scripts/workflow.mjs` (the `rules:` pointer); `references/grammar.md` § 3.2; `tests/engine/run-context.test.mjs`, `html-companions.test.mjs`, `companion-check.test.mjs`, `companion-incident.test.mjs`, `delegate-contract.test.mjs`, `rules-pointer.test.mjs`, `json-route.test.mjs`, `gate-rule-lint.test.mjs`

## TL;DR
A delegate's run-scoped context was assembled from memory, every hand-written prompt carried the
companion obligation, and a missing `html_style_guide_path` was read as "off". A run with HTML
output on could close without its report's companion and nothing said so. Now a read-only verb
prints the run context to paste, a definition declares which artifacts owe a companion, and two
lines — one at the completion write, one at the run's close — name a companion that is missing.

## ADR-0043: Run context and HTML companions are fetched, declared and checked {#adr-0043}

### Status
Accepted. No definition's graph hash moves; the five built-in diagrams are byte-identical.
- `html_companions` sits outside the hashed envelope, like `display`, and outside `resolve`.
- The five built-ins declare the thirteen companions the framework's table used to list.
- Briefs, `gate-revise` and the refusals of the state-writing verbs gain one `rules:` pointer;
  the checkpoint and the request documents are unchanged.

### Context
- The obligations a delegate owes the run — the task path, the project docs, the scratch rule,
  the summary contract, the HTML companion — lived in hand-written prompts, so each one was
  assembled from memory and a forgotten field was silently absent.
- A delegate read the absence of the style-guide path as the switch that turns its companion
  off, so a prompt that left it out produced no companion and no warning.
- The engine's checks were keyed only on declared artifacts. A companion was something node
  prose asked for, and `run-complete` could not know one was owed.
- A run with HTML output on closed without the research report's companion, and nothing in the
  run said so.

### Decision
1. **A verb prints the run context.** `run-context --state --node` prints one `## Run context`
   block: `task_path:`, `html:`, `docs:`, the scratch rule, the summary contract and the
   node's owed `companions:`. Every path but a companion's is absolute. It is read-only, and it
   refuses a state with no `workflow` block and a node the run does not have.
   `prior-context --node` prints the same block first, then the prior context, so an artifact
   writer fetches both in one call. Every delegate prompt opens with the block, pasted unedited.
2. **A definition declares its companions.** A top-level `html_companions:` maps a node id to the
   list of its artifact keys whose markdown owes an HTML companion; the writer follows from the
   node's scheme. An overlay and its profile carry the same key: a later list replaces an
   earlier one per node, `[]` clears it, and a node an overlay or the profile disables is dropped
   without a warning. A malformed block is an error; an unknown node, an undeclared artifact key
   or a path that is not `.md` is a warning. A definition without the block owes nothing. Authors
   read the merged block through `locate --name`, which returns `html_companions` beside
   `dispatches`, so workflow-author never merges files by hand.
3. **Two lines name a missing companion.** When HTML output is on, `write-state` prints
   `companion-missing: <node> <path>` after a write that newly completes a node whose owed
   companion is not on disk, and `run-complete` prints `missing-companion: <node> <path>` beside
   `missing-artifact:`. Both skip a `dir:` node, a sanctioned `absent` key, and a markdown that was
   never written; both are warnings that move neither exit code nor `ok`. A completion write
   with no summary in its patch re-registers an existing summary, so a companion written before
   it is linked; it never creates a summary. The recovery is html-companion-writer once, then,
   only when the node already has a summary, `{"node_summaries":{"<node>":{}}}` to register it —
   never a re-run of the node.
4. **The delegate contract.** A companion writer takes `html: <path> | off` from the pasted block
   and returns `companion: written | disabled | failed | not-requested`. A path means write the
   companion following that guide; `off` means write only the markdown; no `html:` line at all
   is `not-requested` with a warning, never read as off. A failed companion never fails the
   markdown. An agent with two companions returns one aggregate status and `html_paths`.
5. **`rules:` pointers.** A verb names the reference file and the section that governs the moment
   — for a refusal, the section holding its recovery — in one spelling,
   `rules: <absolute path> § <heading>` (a `"rules"` key in JSON). `gate-brief`, `area-brief`, `finding-brief` and
   `gate-revise` carry it, and so does every refusal of those verbs, `write-state` and
   `run-complete`. It is appended after the renderer, outside the gate brief's character budget,
   and never added to `--checkpoint`, `--request`, `--oneline`, a question set or a request
   file, whose shapes are closed.
6. **The JSON route.** A patch is sent by here-string first,
   `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs write-state --state=<run>/orchestrator-state.yml <<< '<json>'`,
   with an apostrophe in the JSON written `'\''`. The same holds for `gate-request` and
   `gate-revise`. Never a heredoc. `--patch-file` stays for PowerShell and cmd, and as the
   fallback anywhere; this amends ADR-0012's patch route, which had made the file the only form.
7. **A lint holds the gate-rule copies.** `make validate` counts the files under `CLAUDE.md` and
   `plugins/` carrying the gate-rule sentence and its tail, and fails unless exactly 15 carry
   the full sentence and 17 the tail, printing both counts and the files found. An exact count,
   not a floor: a floor would let an extra copy hide a lost one. A copy added on purpose updates
   the Makefile's numbers together with CLAUDE.md's list of copies.
8. **The engine skill splits.** The core `SKILL.md` keeps a must-know header and what every run
   needs; gates, in-node questions and writing state move to three references the `rules:`
   pointers name. Three statements stay in the core byte for byte, because a downstream suite
   greps the core for them: the paragraph on `write-state`'s structural self-check, the
   sentences inside it saying the `workflow:` block is written once and a differing patch is
   refused, and the Step 0 gate-rule sentence.

### Considered options

| Option | Why not |
|---|---|
| Name the block `companions:` | Clashes with the prose companion beside a definition (grammar § 11) |
| Map an artifact to its writer | Artifact keys are not unique across nodes; the node is the unit that owes |
| Every `.md` a node declares owes a companion | Noisy: most markdown is working material nobody reads as a page |
| Keep the framework's companion table as a fallback | Keeps the prose obligation alive beside the declaration it replaces |
| Report a missing companion as a stderr `warning:` | The model must act on it, and the display module's quiet line needs an empty stderr |
| A per-node `companions:` key | Inside the node, it would move every definition's graph hash |
| A `rules` field in the checkpoint or the request | Both shapes are closed (ADR-0030) |

### Consequences
- A custom workflow that asked for companions in its node prose must now declare them in
  `html_companions`, or nothing checks them.
- A recorded run whose owed companion is missing now prints `missing-companion:` at its close.
- Agents take `html` from the run context instead of `html_style_guide_path`, and return
  `companion:`.
- A copy of the gate-rule sentence added on purpose fails `make validate` until the count and
  CLAUDE.md's list are updated with it.
