# Held closing workflow — node prose

Every question asked inside a node names its default here.

## `outline`

Write `analysis/outline.md`.

## `outline-approval`

Confirm the outline.

## `choosing`

Choose how the work is finished and record `wants_audit`.

**With question sets** (`finish-style`): asked through the cockpit, in this
node's one request. Default: finish without an audit.

**Without question sets** (`finish-style`): finish without an audit;
`wants_audit` is recorded false.

## `audit`

Runs as a sub-run when an audit was chosen.

## `tidy`

Tidy what the work left behind.

**With question sets** (`tidy-scope`): asked through the cockpit. Default:
tidy only what this run touched.

**Without question sets** (`tidy-scope`): tidy only what this run touched,
recorded as the node's assumption.

## `closing`

Write `outputs/summary.md`, then write the closing patch.
