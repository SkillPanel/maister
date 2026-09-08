# Node prose for the ticket-alpha-42-rollout chain

An inline node is executed by the engine from its own section in this file, so
a definition whose companion has no matching section has a node with no
implementation and the validator says so. One section per inline node, keyed by
the node id exactly as the definition spells it.

## `analyze`

Read the ticket's descriptor and the member it routes to, and record whether
the change is ready to be dispatched as the `ready` value output, so the guard
downstream reads a boolean the run produced rather than one a person had to
remember to set at start time. The notes go under the run's analysis directory.

## `close-out`

Summarize what the dispatched node changed and where its branch is, so the
chain ends with something a reviewer can read in one place. Say whether the
dispatch was skipped, and why, when the analysis found the change not ready.
