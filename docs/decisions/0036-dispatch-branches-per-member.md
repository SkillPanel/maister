# ADR-0036 — Dispatch worktrees and branches are keyed by the run and the member

**Status**: Accepted · **Date**: 2026-10-09 · **Amends**: ADR-0018 (the node segment of the worktree path) · **Sources**: `plugins/maister/skills/umbrella/scripts/lib/envelope.mjs` (`worktreeOf`, `branchOf`); `plugins/maister/skills/umbrella/scripts/lib/manifest.mjs` (`checkBranchConvention`, `checkMemberWriters`); `plugins/maister/skills/umbrella/SKILL.md` § envelope, § validate

## TL;DR
A dispatch into a member works in `.worktrees/<run_id>-<member>`, and the scaffolded branch convention is `feature/{run_id}-{member}`. Every node a run dispatches into one member continues the same tree and branch, so a chain that plans and then changes one repository ends as one pull request, not two halves. Sharing is made safe at validation time: two nodes for one member that `needs` does not order are an error, and so is a branch convention naming `{node}` or `{dispatch_id}`. ADR-0018's refusal of an unresolvable run id stands.

## ADR-0036: Dispatch worktrees and branches are keyed by the run and the member {#adr-0036}

### Status
Accepted.

### Context
ADR-0018 named a dispatch's worktree for the run and the node, and the scaffolded branch convention followed the same pair. That was correct about runs and wrong about nodes. A chain routinely dispatches more than one node into one member — a plan, then the change it planned — and each node got its own tree and its own branch. Each worker opened its own pull request, so one piece of work in one repository arrived as two half-finished pull requests that a reviewer had to read together and merge in the right order.

The branch convention already accepted `{member}`; only the worktree path and the scaffolded default were per node.

### Decision Drivers
- One piece of work in one repository is one pull request
- Two runs still never share a checkout
- A checkout never has two writers at once
- A defect is reported when the chain is validated, not when a worker is already running

### Considered Options
1. Keep per-node trees and branches; stitch the pull requests together afterwards
2. Key both by the run and the member, and require `needs` to order a member's nodes ← chosen
3. Key both by the run and the member, and serialise a member's dispatches at runtime

### Decision Outcome
Chosen option: **the run and the member, with ordering judged by `validate`**.

Option 1 leaves the defect in place and moves it to whoever merges. Option 3 is the per-member serialisation ADR-0018 rejected, and the reason still holds: a wait imposed at dispatch time is invisible to a reader of the chain. Option 2 asks the chain to state the order its author already intends — a change needs its plan — and refuses a chain that does not. Two nodes for different members stay unordered and run at once.

**The convention is judged too.** With the tree shared, a convention naming `{node}` or `{dispatch_id}` would hand each node a different branch inside one tree. `validate` refuses it at `branch_convention`; `{run_id}` and `{member}` remain. An absent convention still leaves branch choice to the worker.

**Migration.** A manifest scaffolded before this change says `feature/{run_id}-{node}`. Nothing rewrites it: the manifest is the operator's file, and `validate` names the key with the fix — edit it to `feature/{run_id}-{member}`. The worktree path has no setting, so it moves with the plugin.

### Consequences

#### Good
- One pull request per run and member
- The ordering a chain relies on is written in the chain, where a reader sees it
- The worktree and the branch are named by the same pair again

#### Bad
- A chain with two unordered nodes for one member that validated before now fails until it is ordered
- An existing manifest fails `validate` until its convention is edited
- A later node inherits whatever the earlier node left in the tree, committed or not
