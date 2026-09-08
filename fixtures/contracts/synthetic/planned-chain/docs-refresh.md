# Node prose for the docs-refresh chain

An inline node is executed by the engine from its own section in this file, so
a definition whose companion has no matching section has a node with no
implementation and the validator says so. One section per inline node, keyed by
the node id exactly as the definition spells it.

## `survey`

Read the two members and decide what the change touches. Record whether the
documentation site is affected as the `docs_affected` value output, so the
guard downstream reads a boolean the run produced rather than one a person had
to remember to set at start time.

## `close-out`

Summarize what each dispatched node changed, and where its branch is, so the
chain ends with something a reviewer can read in one place.
