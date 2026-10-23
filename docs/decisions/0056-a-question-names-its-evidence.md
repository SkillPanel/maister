# ADR-0056 — A question names the evidence its recommendation rests on

**Status**: Accepted · **Date**: 2026-10-23 · **Builds on**: ADR-0030 (the checkpoint), ADR-0032 (the question set), ADR-0039 and ADR-0041 (sets rendered from a record) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/evidence.mjs`; `question-set.mjs`; `gate-brief.mjs` (`questionBrief`, `evidenceFiles`); `checkpoint.mjs` (`requestOf`); `area-brief.mjs`; `finding-brief.mjs`; `references/in-node-questions.md`, `references/gates.md`; `orchestrator-framework/references/orchestrator-patterns.md` § 2.2; `tests/engine/question-evidence.test.mjs`

## TL;DR
A gate request and every question of a question set may carry `evidence`: a list of paths to the
files the run's recommendation rests on. A driver deciding for an operator can then tell a
well-founded recommendation from a bare one, question by question. The key is optional and
additive; absent means no evidence given.

## ADR-0056 {#adr-0056}

### Status
Accepted. No definition changes and no graph hash moves: the key is filled by engine code and
node prose, neither of which the hash covers.

### Context
Evidence was recorded only on answers (ADR-0037's provenance). A question carried its
recommendation and the reason in an option's description, but nothing a reader could follow to
the spec section, the findings file or the decision record behind it. The question items of the
request were a closed shape, and a question set had no key for it.

### Decision
**The shape.** `evidence: [<path>, ...]`, optional:
- on a question-set entry, as the node writes it;
- on each question of a `kind: question` checkpoint and of the request's `questions`, the
  request's top level repeating the first question's, as it repeats its question and options;
- on a gate checkpoint and the gate request, beside `recommended`.

**One path rule.** A path is written relative to the task directory or to the repository. It is
looked up in the task directory first, and in the repository only when nothing is there. It is
emitted repository-relative with forward slashes, so a reader needs no rule. The repository is
the directory holding the run's `.maister/` folder.

**Checked, never refused.** The brief checks each path when it builds the request. A path that
is absolute, leaves the repository, is not text or names nothing on disk is dropped with a
`question-evidence-dropped:<question>:<path>:<reason>` warning. A question is never kept from
being asked because of its evidence. An empty list is left out.

**Who fills it.**
- A gate's evidence is the engine's: every file its closing nodes registered that is on disk,
  logs left out, at most ten.
- `finding-brief` names the findings list on each finding it recommends on, and `area-brief`
  names the brainstorm's markdown on each area with a recommendation.
- A node's own question names its evidence by one rule in the shared question guidance: a
  question with a recommendation names the artifact it rests on when one exists.

**In session nothing changes.** The picker, its options and its questions are as before. The
description may name the files.

### Consequences
- A request writer that holds the request's keys closed must register `evidence` at the top
  level and on each `questions` entry before it accepts a request carrying it. The checkpoint
  already carries unknown keys as given.
- Old shapes stay valid: a set or a gate with no evidence produces the request it always did.

### Considered Options
- **A prefix to tell run paths from repository paths** (`run:`/`repo:`). Rejected: every reader
  would need the rule, and writers would get it wrong. One lookup order on the writing side and
  one emitted form is simpler.
- **Refusing a request with a bad path.** Rejected: evidence explains a recommendation, and a
  question that cannot be asked costs far more than a dropped path.
- **Evidence on each option.** Rejected for now: the recommendation is per question, and so is
  what it rests on.
