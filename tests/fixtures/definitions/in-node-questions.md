# In-node questions workflow — node prose

Every question asked inside a node names its default here.

## `scoping`

Settle what the work covers and record `wants_review` and `wants_notes`.

**With question sets** (`scope-choice`): asked through the cockpit, in this
node's one request. Default: the narrower scope.

**Without question sets** (`scope-choice`): the narrower scope, recorded as
the node's assumption.

**With question sets** (`review-wanted`): asked in the same request. Default:
no review.

**Without question sets** (`review-wanted`): no review; `wants_review` is
recorded false.

## `review-approval`

Confirm the scoping before drafting.

## `depth-approval`

Confirm the thorough pass.

## `drafting`

Write `outputs/draft.md`.

**With question sets** (`drafting-tone`): asked through the cockpit. Default:
a plain tone.

**Without question sets** (`drafting-tone`): a plain tone, recorded as the
node's assumption.

## `notes`

Write `outputs/notes.md`.

## `notes-approval`

Confirm the notes.

## `finish`

Say the run is over.
