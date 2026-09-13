# Node prose for the fix-builtin fixture

A `direct:` node is executed by the engine from its own section in the prose
companion beside the definition, so a definition whose companion has no such
section has a node with no implementation and the validator says so.

This companion exists to make the golden copy resolvable on its own. It carries
one section per `direct:` node and nothing else: the real prose ships beside the
built-in, and duplicating it here would be a second copy to keep in step.

## `standards-discovery`

Executed from the shipped companion.

## `reproduce`

Executed from the shipped companion.

## `fix`

Executed from the shipped companion.

## `verify`

Executed from the shipped companion.

## `close-out`

Executed from the shipped companion.
