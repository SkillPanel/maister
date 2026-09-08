# Plan — docs-refresh

## The task, as given

Survey what the change touches across the workspace, get it approved, then build
the API change in repo-alpha and refresh the documentation site if — and only if
— the survey found the documentation is affected.

## The nodes

| Node | What it does | Why it exists |
|---|---|---|
| `survey` | An inline node that reads both members and records `docs_affected` as a `bool` value output. | The branch downstream has to be decided by work the chain did, not by a flag the person starting the run had to remember. |
| `survey-approval` | A gate: one `continue`, one `stop`. | Nothing reaches a member repository before a person has read the survey. |
| `build-api` | Dispatches `skill:development` into `repo-alpha`, with its own `provider:`. | The API change is the work; it is named explicitly rather than fanned out, because the member set is known here. |
| `update-docs` | Dispatches `skill:development` into `docs-site`, guarded. | The documentation site is touched only when the survey said it is affected. |
| `close-out` | An inline node summarizing what each dispatched node changed. | A reviewer reads one place rather than two branches. |

Both dispatching nodes carry `provider: claude` explicitly: a member with no
`default_provider` and a node with no `provider:` is a chain that validates
perfectly and refuses at dispatch.

## The guards

One guard, on one node.

| Guard | Where its boolean comes from |
|---|---|
| `update-docs` — `${survey.values.docs_affected}` | `survey`, which declares `docs_affected: bool` and sits inside `update-docs`'s needs closure through `survey-approval` and `build-api`. |

The guarded stretch is one node long, so no guard is repeated. Had `update-docs`
been followed by a second documentation node or a closing gate, each of those
would have to carry the same guard: a skipped node satisfies everything
downstream, so a stretch does not inherit its first node's condition.

## Refusals considered and rejected

- **One node over "every member that has documentation".** The grammar has no
  fan-out construct, so this was authored as an explicit node per known target
  instead — here a single one, `update-docs`. That is why the member set has to
  be known at plan time.
- **A `when:` reading two conditions.** A guard is exactly one reference,
  optionally negated; there is no expression language. The conjunction would
  have to move upstream into a node that computes it and declares it as a single
  `bool`. It was not needed: one condition decides one node.
- **Carrying the survey's findings to the dispatched workers through
  `with: {notes: "${survey.artifacts.notes}"}`.** A `with:` value containing
  `${` is dropped before it reaches a worker, so the value would have arrived as
  nothing at all while every signal before the run said the chain was correct.
- **A top-level `inputs:` map.** Nothing here is supplied by the run at start
  time; every boolean the chain reads is produced by a node inside the run.
