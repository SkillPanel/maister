# Node prose for the direct-without-section fixture

This companion exists so the fixture pins the stronger failure mode: the file
the engine looks for is there, and it still carries no section for the node.

It has one heading below, and that heading is prose *about* the node rather
than the node's own section. Accepting it would report an implementation that
is not there.

## Notes on `intake` failure modes

The heading above mentions the node id. It is not a section named for it, and
the validator does not treat it as one.
