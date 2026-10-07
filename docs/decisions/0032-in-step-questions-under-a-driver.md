# ADR-0032 — In-step questions suspend as one question set under a driver that can carry it

**Status**: Accepted · **Date**: 2026-10-07 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs` (`questionSets`); `scripts/lib/question-set.mjs` (`checkSet`, `questionCheckpoint`, `questionRequest`, `foldAnswer`); `scripts/lib/gate-brief.mjs` (`questionBrief`); `scripts/lib/state.mjs` (`foldQuestionAnswer`); `SKILL.md` *In-node questions*, *Driver-suspended mode — resume*, *When a write is refused*; `orchestrator-framework/references/orchestrator-patterns.md` § 2.2; the five workflow node-prose files; `tests/engine/in-step-questions.test.mjs`; `tests/fixtures/gates/question-set.*.yml`; ADR-0030

## TL;DR
A question a node asks inside itself used to reach nobody under a driver: the node took the default
its prose names, about 38 such questions across the five built-in workflows. Under a cockpit driver
that lists the feature `question-sets`, the node now gathers every question it has into one
`kind: question` request and suspends once. The answers come back as one `by: operator` decision per
question. Every other driver keeps the defaults.

## ADR-0032: In-step questions suspend as one question set {#adr-0032}

### Status
Accepted. No grammar change and no built-in hash change: the per-question wording lives in the
node prose, which the graph hash does not cover.
- `gate-brief` takes `--patch-file` with `--checkpoint` or `--request` for a running node, and gains
  three refusals: `gate-brief-questions-unsupported`, `gate-brief-not-askable` and
  `gate-brief-questions-invalid`.
- The state writer folds a task node's `answer` block, and gains one refusal,
  `state-question-answer-invalid`.
- The driven request names its multi-choice flag `multi_select`, the name the request writer
  checks, for gates as well as question sets.

### Context
The engine said why it defaulted: a request was gate-shaped, and no request kind carried a question
asked inside a node. A run under a driver therefore had two honest outcomes: take the stated
default, or fail. The cost was invisible. A cockpit-driven development run settled its scope
decisions, its technical questions and its verification choices on recommendations nobody saw.

A probe run against a real cockpit showed the suspension itself already works. The pending marker,
the enforcement while pending, the answer file and the resume all treat a task node like a gate. It
also showed four constraints:
- one pointer per run and one request per node, so a node can ask only once per attempt;
- a respawned driver loses the conversation, so whatever the step needs after the answer must be on
  disk before it suspends;
- the terminal picker's four-question limit is a terminal limit, not a cockpit one;
- a single-question reader still needs a top-level question and options.

### Decision
**Who can carry a set.** `orchestrator.driver.features` is the driver's list of what it carries. It
is seeded by whatever starts the run and only read by the engine. A set is carried only when
`kind: cockpit` and the list holds `question-sets`. An absent or unknown list means no. A dispatch
worker keeps the defaults even with the value, because it has no form to show a set on.

**One request per node attempt.** At its first asking point, the node writes
`{ask?, headline?, questions[]}` to the patch file. `gate-brief --request` validates it and prints the
request. A question that only exists after an answer, such as a follow-up, another round, a retry
or the fix loop's stopping point, takes its named default, because the node cannot ask twice in one
attempt. There is no cap.

**The request.**
- `kind: question`.
- The top-level `question` and `options` repeat the first question, for a reader that knows one
  question per request.
- `questions[]` carries `{id, question, options, multi_select}` per question.
- `context.checkpoint` carries the ADR-0030 envelope with the questions in place of the options. Each
  question carries `id`, `header`, `question`, `why`, `multi_select`, `allow_other`,
  `options[{id, label, description, recommended}]`, `default` (the recommendation unless stated) and
  a reserved, unread `triage`.
- `context.summary` is the one-line form.

**The fold.**
1. The answer block goes into the request file.
2. The node returns to `running`, never to `completed`.
3. `gate_pending: null` is written last.
4. The empty-patch re-validation runs.
5. The answer block, copied whole from the answer file, is sent as the node summary's `answer`.

The writer reads the questions from the node's own request file. It records one decision per
question, `{decision, by: operator, question_id, question, answer, recommended, as_recommended,
answered_by, at, via}`. That is ADR-0030's operator item, and it needs no separate question log. The
model composes none of it. `answer.answers` maps each id to an option id, a list for a multi-select,
or `{other: "<text>"}`. The first question falls back to `answer.option`, so the `GATE-ANSWER` line
is unchanged.

**Product design's convergence suspends too.** Its decision areas were left to the direction gate
under a driver: the gate's revise suggestions switched an area by re-running the node. Under question
sets, every area is one question in the node's one request, each carrying why it matters, which
other area it depends on, and each alternative's pros and cons. A conflicting pair of answers becomes
an `open` risk for the direction gate. The one-area-per-call rule exists so that the operator sees
each area's full context, and a cockpit form shows it per question. What is given up is a later
area's recommendation adapting to an earlier answer within the same call. Without question sets, the
decision-sheet path is unchanged.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Carry the set on `kind: decision`, with no new kind | It works today, but every reader labels it a decision, a cockpit cannot tell a question set from a choice the run already made, and the contract describes neither |
| One question per request | Each further question costs a suspension and a resume, and a node cannot ask twice in one attempt |
| Suspend under `dispatch` as well | A worker has no form to show a set on; its run would wait on a question nobody can answer |
| Let the model write the operator decisions itself after the fold | It retyped questions and recommendations by hand; the writer reading the request file records what was asked, in the words it was asked in |

### Consequences
- A cockpit-driven run asks the operator what a terminal run asks, at one suspension per node that
  has questions. Each costs one resume turn.
- Node prose names two outcomes per question: asked through the cockpit, or its default without
  question sets. The mechanism lives once, in the engine.
- The request writer and the contracts need the `question` kind, `questions[]`, `answer.answers` and
  the driver's `features` list before a cockpit can drive this end to end. Until then, a driver
  without the feature sees no change.
- A node re-run by a gate's revise asks again in its new attempt, which the request writer has to
  allow for a node whose earlier request was answered.

### Amendment 2026-10-07 — a re-asked set keeps the earlier answers
When a gate's revise re-runs a node, the node asks its set again in the new attempt, and the operator answers again. The fold used to replace each earlier answer to the same question. The answer file has one fixed name, so the first answers then survived nowhere in the task directory, and no surface could show what was first answered. The engine now keeps them in the run's state, the way a gate keeps its earlier revisions:

- At attempt `n ≥ 2`, the operator's earlier answers to a re-asked question stay on the node's summary, each stamped `attempt: <the attempt it was given in>`, ahead of the new answers, which carry `attempt: n`. A first attempt stamps nothing, so its records are the same as before. Re-folding the same answer within one attempt still replaces it.
- The attempt is the node's own recorded `attempt`, which the engine writes when a revise resets the node. A request may carry an `attempt` key, but that key only copies this value, and a request written without it is still valid.
- An answer is history when it carries an `attempt` and the same node holds an answer to that question from a later one. The rule reads the decision list alone, so an answer a later attempt did not ask again stays current. The node's closing write keeps the history. A closing write that re-sends the current answers replaces only those, and they keep their attempt.
- The gate brief neither lists nor counts the history: the operator's choices are the answers in effect. The dashboard projection marks it `earlier`, and the viewer shows it as earlier answers. A cockpit reads the attempts from the decisions and keeps no store of its own.
