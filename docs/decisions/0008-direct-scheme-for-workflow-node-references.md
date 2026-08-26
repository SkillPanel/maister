# ADR-0008 — The `direct:` scheme for workflow node references

**Status**: Accepted · **Date**: 2026-08-26 · **Sources**: `compatibility-contracts.md` § B1; `plugins/maister/skills/orchestrator-framework/schemas/workflow-definition.schema.json`; `plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs`, `SKILL.md` § "Delegation by scheme"

## TL;DR
A node's `uses` value names a mechanism and a target. Three mechanisms delegate — a skill, an agent, a sub-run — and a fourth, `direct:`, means the engine executes the node itself from the definition's prose companion. The scheme list is closed and lives in the runner, not in the schema, so adding the fourth cost no register row. Omitting `uses` entirely for an engine-executed node was rejected because it would make "deliberately inline" and "the author forgot" indistinguishable. An unresolvable sub-run target warns rather than errors, because a static check cannot see a workspace's own definitions.

## ADR-0008: The `direct:` scheme for workflow node references {#adr-0008}

### Status
Accepted. The scheme list, its resolution rules and its one warning path are runner behaviour; the definition grammar they operate on is frozen as `B1`.

### Context
A workflow definition is a graph of nodes, and every executable node has to say what runs it. Two mechanisms were obvious from the start: a skill and an agent, each a named thing the runtime can invoke. A third, a sub-run of another definition, was in the grammar before anything executed it. But the largest category of work in the first real workflow is none of those — it is a stretch of orchestration the engine performs itself: asking the operator a question, evaluating a decision, writing a summary. That work has no skill and no agent behind it. It is prose, and the engine is its interpreter.

The question was how a definition names it, and what that naming costs in a repository where the shapes a definition can take are frozen.

### Decision Drivers
- The grammar is frozen; a change to a frozen shape is expensive and permanent
- A validator must be able to tell a deliberate authoring choice from an omission
- One shipped definition has to be correct under every generated variant, with no rewrite pass
- A static check must not fail a definition it is structurally unable to judge

### Considered Options
1. A fourth scheme, `direct:<name>`, resolved against the definition's prose companion ← chosen
2. Omit `uses` on an engine-executed node — absence means "the engine runs it"
3. A dedicated node `type` alongside the gate type, with the prose section named by a separate field
4. A one-node-per-step skill for every inline stretch, so that everything is `skill:`

### Decision Outcome
Chosen option: **a fourth scheme**. It costs no register row, because reference resolution is runner logic rather than a schema keyword: the `uses` field is a non-empty string with no scheme enum, so the set of recognised schemes is a constant in the resolver and widening it is a behaviour change in one module, not a grammar change. The scheme list stays closed — an unrecognised prefix is an error, not a pass-through — so the absence of an enum in the schema buys flexibility without buying permissiveness. Resolution is rooted at the plugin root: a skill resolves to a directory, an agent to a file, and a `direct:` name to a heading in the markdown companion sitting beside the definition. Target names are therefore **bare**, and the provider prefix is applied at invocation, which is what lets one shipped definition serve every generated variant unmodified. A prefix written into a definition is a defect, not a style choice, and the build's own prefix grep now scans workflow files so that it fails the build rather than a user's run.

**Omitting `uses` was rejected**, and this is the load-bearing rejection. Absence is not a statement. A node with no `uses` and no gate type would be read by the validator as an engine-executed node, and it would be read the same way when an author simply forgot the field — the two cases are byte-identical. That is a silent-failure class, and it would be a silent-failure class in every workflow anyone ever writes, not just this one: the definition validates, the run starts, and the node does nothing an operator can point at. Requiring an explicit `direct:` target converts the whole class into a validation error at authoring time, at the price of one word per node.

Options 3 and 4 were rejected for narrower reasons. A second node type would duplicate, in the grammar, a distinction the `uses` prefix already carries, and would then need its own prose-section field — two frozen additions where one runner constant suffices. Wrapping every inline stretch in its own skill would produce a large number of single-use skills whose only reader is one node of one definition, and would put the operator questions those stretches ask behind an extra indirection for no gain.

The sub-run scheme resolves differently on purpose. A `skill:` or `agent:` target that does not resolve is a run that will certainly fail, so it is an error. A sub-run target may be satisfied at run time by a definition that lives in the workspace rather than in the shipped set — an eject or an overlay the static check has no access to — so an unresolvable one is a **warning**. Two things make that the right severity rather than a loosening. First, nothing executes a sub-run node today: the engine stops the run with a clear message when it reaches one, so an unresolvable target cannot silently do the wrong thing. Second, a frozen valid fixture already carries such a node, and a check that errors on it would fail the repository's own examples — which is the point at which a validator stops being believed.

### Consequences

#### Good
- Every executable node states its mechanism explicitly, so "inline by design" and "field missing" are different documents and one of them fails validation
- A third scheme was added without touching a frozen shape, and a fourth could be added the same way
- Bare target names keep one definition correct across generated variants, and the build now proves it

#### Bad
- The prose companion is load-bearing: a `direct:` node whose section is renamed stops validating, and the coupling between a `.yml` file and its `.md` sibling is not visible from either one alone
- A warning-severity sub-run reference means a genuinely misspelled sub-run target reaches run time, where it surfaces as the run stopping rather than as a validation error
- Resolution reads the filesystem, so validating a definition requires the tree it names to be present — a definition cannot be checked in isolation
