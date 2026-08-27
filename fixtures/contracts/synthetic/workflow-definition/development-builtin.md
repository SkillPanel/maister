# Node prose for the development-builtin fixture

A `direct:` node is executed by the engine from its own section in the prose
companion beside the definition, so a definition whose companion has no such
section has a node with no implementation and the validator says so.

This companion exists to make the golden copy resolvable on its own. It carries
one section per `direct:` node and nothing else: the real prose ships beside the
built-in, and duplicating it here would be a second copy to keep in step.

## `intake`

Executed from the shipped companion.

## `tdd-red`

Executed from the shipped companion.

## `specification`

Executed from the shipped companion.

## `tdd-green`

Executed from the shipped companion.

## `verification-options`

Executed from the shipped companion.

## `finalization`

Executed from the shipped companion.
