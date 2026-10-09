# ADR-0038 — Development publishes at its plan gate when asked to

**Status**: Accepted · **Date**: 2026-10-09 · **Builds on**: ADR-0033 (a continue option declares its grants) · **Sources**: `plugins/maister/skills/workflow-engine/workflows/development.yml` (`publish`, `planning-approval`, `planning-approval-publish`); `workflows/development.md` § `planning-approval-publish`, § `finalization`; `plugins/maister/skills/umbrella/scripts/lib/seed.mjs` (`closeoutLines`); `tests/engine/built-in-gates.test.mjs`, `umbrella-seed.test.mjs`

## TL;DR
Development gains a `publish` input, off by default. When it is on, the run asks
`planning-approval-publish` in place of `planning-approval`. That gate's continue grants `push`
and `pr-create`, so the plan approval also approves publication, and `finalization` pushes the
run's branch and opens one pull request, or updates the one already open from it. A run without
the input asks the plain gate as before. Separately, a dispatched worker whose tier forbids the
push, and that ends with commits unpushed, now says so in a followup carrying
`needs: [permission]` before it closes out.

## ADR-0038: Development publishes at its plan gate when asked to {#adr-0038}

### Status
Accepted. The definition's hash moves to
`sha256:6aa074833ba17c6362a258d415017ee443e8397efdc25ab88a750c413d21ed47`.

### Context
A workspace that dispatches one development run per repository expects each repository to end
as a pull request. Development's plan gate offered continue, revise and stop and granted nothing,
so a worker that may not push without a grant committed locally, closed out with no pull request,
and mentioned the push only in prose. A reader acting on structured needs saw nothing to offer.

### Decision
**Two forms of one gate.** `planning-approval` keeps its id and options and is guarded
`!${inputs.publish}`. `planning-approval-publish` asks the same approval, is guarded
`${inputs.publish}`, and has the same three options, with `grants: [push, pr-create]` on the
continue. The two stand in line: the publishing gate needs the plain one and `implementation`
needs the publishing one, so the chain stays linear and a gate's brief walks past the other form
to the implementation. A skipped gate satisfies a need and a stopped one does not, so either
gate's stop still ends the run. Both guards read an input, a choice made when the run started,
so the unasked form is skipped.

**Publication at the end.** Right after the plan the branch has no commits, so the grant is used
by `finalization`. It commits the run's change on its own branch, never pushes the default
branch, and publishes once per branch: `gh pr view` first, `gh pr create` only when no pull
request from the branch is open. The URL goes into the close-out's `prs`. Nothing is merged.

**Undone publication is structured.** At a tier with no operator relay that denies opening a pull
request, the seed tells a worker that ends with commits unpushed to write a followup. The
followup names each held command and carries `needs: [permission]`. The worker then publishes
its close-out in the same turn, because nothing answers a held command inside the dispatch at
that tier. An attended worker keeps its rule: the followup, then end the turn.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Grants on the one plan gate, always | Every terminal run would be asked to approve a push it never wanted, and a reader could not tell a run meant to publish from one that was not |
| A separate publish gate before finalization | A second question for a decision already made with the plan |
| Push as soon as there are commits | Two publish points to keep consistent; the close-out is where the PR URL is reported anyway |
| End the forbidden-tier turn on the followup, as attended does | No relay answers inside the dispatch at that tier, so the dispatch would never close out |

### Consequences
- The development hash moves once. Chains frozen against the old hash see it as drift.
- The startup banner counts every frozen gate, so a development run now reads "up to 11" checkpoints although it asks at most ten.
- A driver that ignores `checkpoint.grants` still shows the gate. The push is then refused, and the worker reports it with `needs: [permission]`.
