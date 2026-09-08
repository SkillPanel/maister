# Plan - ticket-alpha-42-rollout

## The task, as given

Take the triaged ticket ALPHA-42, confirm from its descriptor that the change is
ready to be made in repo-alpha, get the dispatch approved, apply it there, and
close out with a summary a reviewer can read.

## The nodes

| Node | What it does | Why it exists |
|---|---|---|
| `analyze` | An inline node that reads the ticket's descriptor and records `ready` as a `bool` value output. | The dispatch downstream has to be decided by work the chain did, not by a flag the person starting the run had to remember. |
| `dispatch-approval` | A gate: one `continue`, one `stop`. | Nothing reaches a member repository before a person has read the analysis. |
| `apply` | Dispatches `skill:development` into `repo-alpha`, guarded, with its own `provider:`. | The change is the work; it is named explicitly because the ticket routes to one known member. |
| `close-out` | An inline node summarizing what the dispatched node changed. | A reviewer reads one place, whether or not the dispatch ran. |

The dispatching node carries `provider: claude` explicitly: a member with no
`default_provider` and a node with no `provider:` is a chain that validates
perfectly and refuses at dispatch.

## The guards

One guard, on one node.

| Guard | Where its boolean comes from |
|---|---|
| `apply` - `${analyze.values.ready}` | `analyze`, which declares `ready: bool` and sits inside `apply`'s needs closure through `dispatch-approval`. |

The guarded stretch is one node long, so no guard is repeated. `close-out`
needs `apply` and runs whether `apply` completed or was skipped, because a
skipped node satisfies everything downstream.

## Refusals considered and rejected

- **A chain reused across tickets, taking the ticket key as an input.** This
  chain is generated for one ticket and carries that ticket's text, which is why
  it lives in the generated home and is deleted once its run closes. A reusable
  chain would need to carry nothing ticket-derived and would live at the top of
  the workflow directory instead.
- **One dispatch node per member, each behind its own guard.** The ticket
  routes to exactly one member, known when this chain was generated, so a
  single explicit node is the whole shape; the guarded-per-member form is what
  a chain that does not know its target at generation time has to take.
- **A top-level `inputs:` map.** Nothing here is supplied by the run at start
  time; every boolean the chain reads is produced by a node inside the run.
