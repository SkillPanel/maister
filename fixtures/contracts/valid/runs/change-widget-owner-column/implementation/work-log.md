# Work log  -  owner column in the widget list response

## What changed

| File | Change |
|---|---|
| `src/widgets/list-query.js` | the list projection selects `owner_id` and `owner_name` from the existing denormalized columns |
| `src/widgets/serializer.js` | the list serializer emits an `owner` object when the rollout flag is on, and omits the key entirely when it is off |

No migration: both columns already exist on the table, written by the owner-assignment
path that shipped earlier. This change only reads them.

## Why the projection rather than a join

The list endpoint is paginated and returns up to 200 rows. Joining the owner record per
row is the per-row join the project's API response-shape standard names as the thing not
to do, and the denormalized columns exist precisely so it is not needed.

## Why the existing flag

The endpoint's response shape is already gated by `widgets.list.v2`. A second switch for
one column would be a second thing to retire later, and a reader of the endpoint would
have two flags to reason about instead of one.

## The test

`test/widgets/serializer.test.js` gains one case with two assertions: with the flag on the
payload carries `owner`, with it off the key is absent  -  not null, absent, which is what
the response-shape standard requires of an ungated field.

Command: `npm test`.

## Left alone

The single-widget endpoint also has an owner, and it is not gated by this flag. It was not
touched: widening the change to cover it would have taken the run past the statement.
