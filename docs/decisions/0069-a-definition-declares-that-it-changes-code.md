# ADR-0069 — A definition declares that it changes code

**Status**: Accepted · **Date**: 2026-11-07 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs` (`DEFINITION_KEYS`, `OVERLAY_KEYS`, `PROFILE_KEYS`, `checkRaisedChangesCode`, `changesCodeOf`); `scripts/lib/locate.mjs`; `scripts/lib/interface-shapes.mjs` (`WORKFLOW_DECLARATIONS`); `references/grammar.md` § 3, § 12; `tools/interface.mjs`; `tests/engine/changes-code.test.mjs`, `interface-file.test.mjs`

## TL;DR
A reader could only infer whether a workflow changes code, from a push grant or a `dir:` node, and
`migration` and `performance` carry neither. A definition may now say `changes_code: true`. It is
optional and defaults to `false`; it sits outside the graph hash and no run reads it. An overlay or
a profile may raise it and never lower it. `interface.json` publishes it under
`workflow_declarations`.

## ADR-0069 {#adr-0069}

### Status
Accepted.

### Context
What a workflow does to the project's code is a fact a reader may need before anything runs. The
definition didn't state it, so a reader judged from other things it says: a grant that publishes
code, or a node that dispatches into a member repository. Neither is about changing code. A
workflow can implement a change, leave it in the working tree and grant nothing, and two of the
built-ins do exactly that.

### Decision
- **The field.** `changes_code`, a top-level boolean on a definition, optional, default `false`.
  Omitting it reads as `false`. Anything but true or false, an explicit null included, is refused
  at the field.
- **The built-ins.** `development`, `migration` and `performance` run the implementation plan
  executor and declare `true`. `research`, `product-design` and `mockup-studio` write documents
  and mockups, not the project's code, and leave the line out.
- **It is a statement.** The engine checks its shape, not its truth, and nothing a run does depends
  on it. `workflow-author check` reads the folded graph and flags a workflow that implements a
  change and doesn't say so.
- **Overlays only raise.** An overlay can add a step that changes code to a workflow that didn't,
  so it or a profile may write `true`. `false` is refused: disabling a node doesn't show that what
  is left changes no code. A workflow that no longer changes code is an eject. The folded value is
  the base's, raised by any applied overlay and by the selected profile; an overlay that is never
  applied raises nothing.
- **Where it is read.** `locate --name` prints the folded value, and each row of its listing the
  definition's own. The interface file carries `workflow_declarations.keys` (the shape) and
  `workflow_declarations.builtins.<name>.changes_code` (every built-in, the default filled in),
  read from each tree's definitions. The `workflows` name list stays as it was. The section is new,
  so the step is a minor one: 1.11 to 1.12 in the source tree, 1.12 to 1.13 in the Copilot variant.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Infer it from the nodes | The inference this replaces, one level down; a `direct:` step that edits code cannot be seen |
| `effects: [code]`, a closed list | A vocabulary and a table for one value; no second effect exists |
| An overlay may not speak to it | A built-in with code-changing work added would misreport itself, or need an eject just to state a fact |
| An overlay may set either value | The declaration could be switched off from the side of a workflow that still does the work |
| `workflows` as a map of name to declarations | A removal under the version rule, so a major step for every reader of the list |
| An engine warning for an implementing node with no declaration | A later step if misses show; the authoring check says it where a definition is being written |

### Consequences
- No graph hash moves, so no frozen run or chain drifts over the new lines.
- A project's existing definitions validate unchanged and read as `false` until their authors say
  otherwise.
- Changing a built-in's value later is a changed value, and so a major step of the interface file.
