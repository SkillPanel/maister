# In-node questions

The workflow engine's rules for a question a node asks inside itself. `area-brief` names
*Decision areas from the brainstorm*, and `finding-brief --patch-file` names *Findings that need a decision*.

A gate is not the only question a run asks. A node's prose may ask its own — a clarification,
an opt-in that decides whether a later stretch runs, a decision between approaches, or a loop
that offers a second pass — and those questions are in the node because the graph cannot say
them. They follow the same driver, and only the driver:

| The run's driver | An in-node question is |
|---|---|
| absent, or `kind: terminal` | asked in session, exactly as the node's *Asks* part describes it |
| `kind: cockpit` whose `features` list `question-sets`, in a run that is not dispatched | **suspended to the operator** as one question set (*When a question suspends*) |
| any other — a dispatched run (engine skill, *A dispatched run is told by its `dispatch_id`*), or a cockpit without that feature | **never asked**; the node takes the default its *Without question sets* line names, and records that it did |

`orchestrator.driver.features` is the driver's own list of what it carries, seeded by whatever
started the run (a sub-run's freeze copies its parent's); the engine only reads it. Without
`question-sets` in it the driver cannot carry a question set. Decide this once, when the run
starts, like the gate mode.

**Asked in session, a question offers answers, never their categories.** A question that
invites a correction or an addition offers the corrections and additions themselves: concrete
candidates generated from what the node found — its open gaps and its weakest inferences — each
one an answer that can be folded in as it stands, beside the option that changes nothing, with the
user's own words through Other folded in as typed. Never offer an option such as "add
something" whose only effect is a second question asking what kind of thing to add.

**A recommended set is offered as one single choice, never as empty checkboxes**, since a
multi-select cannot pre-tick anything. Offer the bundles instead, as one single-select — "Every
suggested item (Recommended) / Only the first / Choose individually" — the
recommended bundle first, and open a multi-select only behind "Choose individually". An empty
set the user may want is a bundle of its own ("No extra constraints"), never an unticked
recommendation.

**A question carries its own context, and never points at "above".** This is the floor, on
every tool. Whatever a question or a tab refers to travels in its own text: an assumption to
confirm is stated in its tab, an issue to decide carries its file, line and what is wrong in its
tab, an "Accept all N" question lists the N items, one line each, a draft to approve is named
with what it settles, a retry-or-skip question says what failed and why, and a decision area's
question names the area, why it matters and each alternative in a line. Each option's
description says what choosing it does or costs; where the tool shows no option descriptions,
that goes in the question, a line per option. Text printed before the picker may never reach
the screen, so nothing the user needs may depend on it.

**More details — one request, one rule.** Offer **More details** as the last option of every
question whose full context is longer than its question and descriptions hold: a gate (the
gate brief lists it), a decision area, a draft or section to approve, a page of fix-loop
decisions, assumptions to confirm. Its description: "Write out the full context, then ask this
again. Nothing is recorded." When the options already fill the tool's slots, end the question
with `Type "details" for the full context.` instead; a typed "details" is the same request.
Choosing it is **not an answer**: nothing is recorded, no state is written, and the question
stays open. Your next message is the full context, and the call after it is the same question,
with the same options, in the same turn:
1. **At a gate**: `more_details` from the picker output, as given, then the gate again
   (`references/gates.md` § *Terminal mode*).
2. **At a decision area**: `area-brief`'s `more_details`, as given (*Decision areas from the
   brainstorm*); composed by hand, every alternative with a short description, its pros and
   cons, then the recommendation and why; then the same area again.
3. **At any other question**: the full context of each item — an issue's file, line, what is
   wrong and what each option changes; an assumption and what it rests on; a draft or section
   in full; a failure's cause and what each way on would do — then the same question again.

> **ANTI-PATTERN**: Do NOT record More details, or treat it as a choice and move on. It asked
> for text, and the question is still unanswered.
>
> **ANTI-PATTERN**: Do NOT answer More details with headlines, a summary of the summary or a
> pointer to a report or the dashboard. What the user asked for is the text the screen did not
> show them.

> **SELF-CHECK after More details is chosen**: does your message enumerate every item the
> question rests on, whole? Is your next call the same question with the same options? If not,
> STOP and write it first.

Under a driver More details is never taken: a question set carries each question's full
context in its own fields, `why` and the options' descriptions, and the cockpit shows it.

**Ask only what the run does not know.** A question whose answer earlier phases already
recorded — visual assets or browser checks for a change the analysis found has no user
interface — is not asked: say the answer in one line where the question would have been
("Browser verification: off — this change has no user interface") and record it as the node
records an answered one.

**A recommendation never drops or narrows what was asked for.** The task states what done means
— its description, its acceptance criteria or "done when" lines, the research question — and the
recommended option keeps every one of them. An option that narrows one may still be offered, its
description naming the criterion it gives up, but it is never the recommendation. Before
recommending, read what earlier steps left uncertain: the `open` risks in `prior-context` and
the open questions of any research the run imported. Where one of them says a criterion may be
read two ways, recommend the reading that keeps every criterion whole, and say so in the
question. The person may still choose the narrower reading; the run never makes it the default.

**One topic is one drafted story.** Requirement gathering never splits one behaviour into single
facts asked one by one. The questions that belong to one topic are drafted into one user story,
or journey, and asked as one question: the actor, the entry point, the action, the resulting
state change — what is stored and what is audited — and what is visible afterwards, each part
filled with the reading the run's evidence best supports. Its options are answers: accept the
story (the recommendation, its reason naming what the defaults rest on); accept it with the
corrections the run lists — its weakest defaults, each changed to the next-best reading; and a
concrete alternative story where one exists. More details is last while a slot is free, and the
person's own story goes through Other. Each story is one decision, asked under its own id — the
node's declared story id, then the topic as a short slug — and never folded into an accept-all.
A question stays on its own only when its answer changes no story: which existing component to
reuse, whether visual assets exist.
A story's question lists its parts, a line each, then each correction the corrections option
applies, a line each. Those lines and that option's label name the same corrections in the same
words: the label sums up exactly what the lines list, so neither names a correction the other
lacks, and the alternative story's label names that story, never a correction.

**Independent items go in pages; decision areas go one at a time.**
A picker call holds up to four questions, one tab each. Items that stand on their own — the fix
loop's per-issue decisions, confirmations of the run's own assumptions, drafted stories that do
not depend on one another — are asked four to a page, further pages following in the same
turn. A later page opens by saying, in one line, how many questions are left ("Two more scope
questions"), so the user knows the end is near.
The question tool takes a message and a form, and the engine builds the call: never compose a
form by hand, except a free-text property a node's own section names beside a set. Write the questions as a question set — `{ask?, headline?, questions: [...]}`,
each question with the fields *When a question suspends* lists, every option with its `id`,
its `label` and its `description` — to `<run>/.state-patch.json`, then run `gate-brief
--state=<state> --node=<the asking node> --ask --patch-file=<run>/.state-patch.json`. Its whole
output is the call's arguments: pass it unchanged. It holds every question of the set as one
form, a property per question keyed by the question's id, and it carries what the tool would
otherwise hide: each option's description, the question's `why` and the recommendation ride in
the property's description, and the recommended option's title reads `(Recommended)`. The
answer names each question by its id and each choice by its option id; record it as above,
with the chosen option's label as the answer. The patch file is deleted once the call is
printed. Write the set as plain text, because the form shows markdown as typed: no `**` and no
backticks. A header is a short noun phrase in sentence case, with nothing after its last word
— the form adds a colon of its own — and every word spelled out: "Specification", never
"Spec". A decision area is asked from `area-brief --ask` (*Decision areas from the brainstorm*).
For assumption confirmations alone, "Accept all N as stated (Recommended)" may come
first — its question listing the N assumptions, one line each — going through the items only
when the user asks to. **Decision areas are never paged and never offered as accept-all**:
research's solution convergence, product design's convergence and direction areas, and any step
whose choices shape what comes next are asked one area per call, each with its full context,
because a later area can depend on an earlier answer. `area-brief` renders each area from the
brainstorm's file (*Decision areas from the brainstorm*); an area composed by hand names the
area, why it matters, each alternative in a line with its key pro and con, and the
recommendation with its reason, and offers More details while a slot is free. An area with more
alternatives than the options hold offers the recommended one and its strongest rivals and
names the rest in the question, for the user to type.
In a decision area, the message's last line before the ask is the recommendation:
"Recommended: <alternative> — <reason>."

## An option only a person can take

Some answers say that a person did something outside the run: copied a file in, uploaded,
approved, fixed, installed, signed in. Only that person can give such an answer. When the run
takes it, it records an act that nobody performed.

- **Mark it.** Such an option carries `person_act: true` in the question set. The engine cannot
  tell such an option from its label, so the node declares it. Without the marker the option
  reads as an ordinary one.
- **Never recommend it, and never default to it.** A set that recommends a `person_act` option,
  or names one as its `default`, is refused, both by `write-state`'s classing write and by
  `gate-brief --request`. Recommend an option the run can take, or none.
- **The run never settles it.** A question offering a `person_act` option needs a person,
  whatever its class: the classing writer never records it `by: run`. Where somebody can be
  asked, it is asked. Where nobody can be asked, it takes its default `by: default`, and that
  default is always an option the run can take. When no such option lets the step go on, the
  step fails, and its summary names what a person must do.
- **Never invent one to recover.** A step that failed at something the engine does for it does
  not ask a person to do it by hand. An import is the main case: a source `import` skipped is
  handled as the step's import rule says.

A node that records its own `by: run` decisions, in a run whose policy classes no questions,
holds itself to the same rule. The writer sees no options there, so nothing checks it.

## Decision areas from the brainstorm

A convergence node asks its decision areas from `area-brief`, which finds the file the brainstorm
wrote through the node's `with: decision_areas` and renders each area from it. The file's shape,
its check and the few labels the verb adds are in `references/decision-areas.md`. The area ids,
and the order they are asked in, are the file's.

**In session, one area per call**, in the file's order, each from its picker, with the plugin
root written as its absolute path rather than the variable (the invocation contract in this
skill's `SKILL.md` says why):

```
node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs area-brief --state=<run>/orchestrator-state.yml --node=<the convergence node> --area=<area id> --ask
```

Its whole output is the question tool's arguments: pass it unchanged, never rebuilt, and
record the answer under `convergence-decisions-<area id>`. On More details, run the same
command with `--details` added, print its output as given, then ask the same area again with
the same arguments; nothing is recorded.
The plain profile offers every alternative as a label; the question carries each alternative's
line and ends with the recommendation and its reason.

**Under a driver with question sets**, every area goes in the node's one request. Run the verb
with `--patch-file=<run>/.state-patch.json` in place of `--area` and `--json` — after a revise,
`--area` repeated names the areas the note reopens — and it writes the question set to the patch
file and prints its path. Then run `gate-brief --request
--patch-file=<run>/.state-patch.json` for the node, read the patch file once with the file
tool, write the printed request over it byte for byte, every question's `details` included,
and suspend with `gate-request` (*When a question suspends*). A `policy-hash-mismatch` warning
means no area carries `triage`; the request still goes.

**When the file cannot be used**, the verb prints one warning on stderr, exits `0` and gives
nothing to ask from — under `--json`, `{ok: true, fallback: true}`; under `--ask`, no output;
with `--patch-file`, no file:

| Warning | The file |
|---|---|
| `decision-areas-missing:<path>` | was not written; `:not-declared` when the node names none, `:producer-not-completed` when its brainstorm did not complete |
| `decision-areas-unreadable:<path>:<code>` | exists but cannot be read |
| `decision-areas-invalid:<path>:<fault>` | failed the check, its first fault as `<reason> at <path>` |
| `decision-areas-stale:<path>:<source>[:<detail>]` | no longer matches the markdown it was written from; `:source-unreadable` when that markdown cannot be read, `:source-not-declared` when it is not the markdown the brainstorm declares |
| `decision-areas-unwritable:<patch path>:<code>` | was read, but the question set could not be written to the patch file; nothing was written. `EEXIST` means another write holds the patch file's temp, or a crash left one; it is reclaimed after a minute, so running the set form again after a minute is fine. `EACCES` or `EPERM` means the run directory refuses writes, so neither the composed set nor the request can be written either: stop and report the run directory as unwritable rather than composing into it |

Each means the same: compose every area from the brainstorm's markdown, as the node prose
describes, with the question ids it names, and say in the node summary which warning made it do
so. Apart from the `decision-areas-unwritable` cases above, do not run the verb again for the
next area, and never edit the file to make it pass — it is the brainstorm's.

Its refusals name no state write and leave nothing written:

| Refusal | Response |
|---|---|
| `area-brief-state-unreadable` | `--state` cannot be read or parsed as a state document. Nothing was written. Point `--state` at the run's `orchestrator-state.yml` — the run directory this node belongs to — and run the verb again. |
| `area-brief-unknown-node` | `--node` names no node of the run, or names a gate, which is asked from its own brief. Nothing was written. Name the convergence node that is asking its decision areas and run the verb again; no state write fixes this. |
| `area-brief-not-running` | The node's status is not `running`, and only a running node asks. Nothing was written. Name the node that is asking, or start it first through `write-state`, then run the verb again. |
| `area-brief-unknown-area` | An `--area` id is not in the file; it is judged only once the file passed its checks. Nothing was written. Take the area ids, in order, from the file named in the node's `with:` — the message lists them — and run the verb again. |

## Findings that need a decision

A review step — the specification audit, the verification fix loop — asks each finding that
needs a person as its own question, after the fixes it makes without asking. The node writes the
findings to a JSON file in the run (its reviewer returns them in this shape) and builds the set
with `finding-brief`:

```
{"findings": [{"id": "empty-upload", "severity": "critical",
  "title": "Server crashes on an empty upload",
  "evidence": "src/upload.ts:42 reads body.length of undefined",
  "options": [{"label": "Guard the empty body", "description": "Return 400 before reading it"}],
  "recommended": 0, "reason": "One guard closes the crash"}]}
```

`id` is kebab-case and unique; `severity` one of critical, high, medium, low, warning, info;
`options` one to three, the reviewer's proposed change first, then the alternatives it names;
`recommended` an option's index, `"accept"`, or null; `reason` required with a recommendation.
Unknown keys are refused. The verb composes each finding as the question
`<node>-findings-<id>`, most severe first, its options ending with **"Accept the risk and list
it"**. The node's prose declares `<node>-findings`, so a policy classes every finding through
that one id.

From there the set is any other in-node set: the classing write when the run classes questions,
then the asking — paged in session, one request under a cockpit with question sets — and the fold,
one decision per finding. What each answer does is the node's: a chosen change is applied, an
accepted risk is a `tradeoff` risk, a finding nobody could be asked about stays an `open` risk
unless the policy settled, defaulted or held it, and a held choice goes on provisionally until a
continue approves it.

A file the verb cannot use is a fallback, never a refusal — compose the same questions from the
reviewer's findings and say which warning made you: `finding-list-missing:<path>` (no file, or
`:outside-run`), `finding-list-invalid:<path>:<where>` (not JSON, or the first field that breaks the
shape), `finding-list-unwritable:<patch path>:<code>` (the set could not be written; `EEXIST` clears
after a minute). Its refusals leave nothing written:

| Refusal | Response |
|---|---|
| `finding-brief-state-unreadable` | `--state` cannot be read or parsed as a state document. Nothing was written. Point `--state` at the run's `orchestrator-state.yml` and run the verb again. |
| `finding-brief-unknown-node` | `--node` names no node of the run, or names a gate. Nothing was written. Name the reviewing node that is asking its findings and run the verb again; no state write fixes this. |
| `finding-brief-not-running` | The node's status is not `running`, and only a running node asks. Nothing was written. Name the node that is asking, or start it first through `write-state`, then run the verb again. |
| `finding-brief-undeclared` | The node's prose declares no `<node>-findings` question id, so no policy could class its findings. Nothing was written. Ask the findings as the node's prose says without the verb, or add the declaration to a workflow you own, then run it again. |

## A dispatch closed out partial

A dispatched node — a `workflow:` node carrying `dir:` — waits while its worker runs in the
member repository. When the dispatch's close-out is graded `partial`, the work was done but
something is still held, and the node asks one question while still `waiting` (engine
§ *Recording an outcome*). It asks only while the hold is live: when the dispatch's ledger entry
records its pull request in `closeout.prs`, or its `needs: [permission]` follow-up is
`resolved`, the node is recorded `completed` with a `by: run` decision naming what resolved it,
and nothing below is asked. A pull request is recorded there as `{repo, number, url}`, and the
decision names its `url`. Its shape is fixed; only the `<…>` parts are filled, from the
close-out — `<what is held>` from its summary or its held-command report, and `why` from its
summary in one line:

```
{"questions": [{"id": "<node>-dispatch-held", "header": "Dispatch held",
  "question": "<Node title> closed out partial: its work is done, but <what is held> is still held. How does the run go on?",
  "why": "<the close-out's summary, in one line>",
  "allow_other": false,
  "options": [
    {"id": "accept", "label": "Accept the work as done", "description": "Records <node> completed and the held item as an open risk; the run goes on."},
    {"id": "redispatch", "label": "Dispatch the node again", "description": "Sends <node> to its member repository as a new dispatch; nothing after it runs until that one closes out."},
    {"id": "stop", "label": "Stop the run", "description": "Records <node> stopped and ends the run here; the held item stays held."}]}]}
```

No option is recommended and the set names no default, so nothing continues on its own. More
details is never offered: the question carries what is held in its own text. It is never sent
through the classing write, so no policy settles it.

- **In session** it is asked with the question tool, the same question and the same three
  options.
- **Under a cockpit whose `features` list `question-sets`** the waiting node writes the set to
  the patch file, runs `gate-brief --request --patch-file=<the patch file> --node=<node>` — which
  briefs a `waiting` node only when it carries `dir:` — and suspends with `gate-request` exactly
  as *When a question suspends* says. The answer is folded as any set's.
- **Under any other driver** nobody can be asked, and the run stops (*When nobody can be asked*).

After the fold, one `write-state` records what the answer decided:

| Answer | The write |
|---|---|
| `accept` | the node `completed`; its summary's `risks` gains `{risk: "Held after dispatch: <what is held>", tag: open}` |
| `redispatch` | the node `pending`; the ready set dispatches it again through the umbrella runtime's `envelope` verb, as a new dispatch |
| `stop` | `task.status: stopped`, the node and every unexecuted node `stopped`, then `run-complete` |

## When a question suspends

Under a driver that carries question sets, a node asks what it would have asked in session —
the clarifications, the opt-ins, the decisions, the bundles — and suspends on them instead of
taking their defaults. Four rules hold:

- **One request per node attempt, carrying every question.** At its first asking point the node
  gathers every question it can form there into one set, one entry per question, and suspends
  once. A node cannot ask a second time in the same attempt, so a question that only exists
  after an answer or a pass — a follow-up, another refinement round, a retry after a spent
  budget, the fix loop's stopping point — takes its named default below.
- **Write before asking.** Whatever the node needs after the answer — its analysis, its draft,
  the candidates each option stands for — is on disk before it suspends: the answer may come
  back to a fresh session, which continues from the files.
- **No cap.** A set holds as many questions as the node has. The four-to-a-page limit belongs to
  the terminal picker, which pages a long set in one turn; it is never written into a request.
- **Each question carries its own context**, by the floor above: `question` the question itself,
  `why` what makes it matter, each option's `description` what choosing it does or costs, and
  `recommended` on the recommended option, its reason in its description. `header` is a short
  sentence-case title. `details`, optional, is the question's full write-up as markdown, shown
  on demand beside it; `area-brief` writes it for each decision area. The multi-choice flag and `allow_other` (the operator's own words, on
  unless said) are per question. `default` is what a non-answer would take, the recommendation when
  absent. `triage` is carried as written; for a decision area the engine writes it when a
  matching policy classes the area.
- **A recommendation names its evidence.** A question with a recommended option whose reason
  rests on an artifact lists it in `evidence`: paths relative to the task directory, or to the
  repository when no such file is in the task directory — `["analysis/findings.md",
  "src/storage/schema.sql"]`. The request carries each path repository-relative. A path
  that is absolute, leaves the repository or is not on disk is dropped with a
  `question-evidence-dropped` warning, never refused; with none left the key is left out, which
  reads as no evidence given. `area-brief` and `finding-brief` fill it themselves.

How it runs: the node writes `{ask?, headline?, questions: [...]}` to the patch file, runs
`gate-brief --request --patch-file=<the patch file>` for itself, and suspends exactly as a gate
does (`references/gates.md` § *Driver-suspended mode — the write order*). The answer is folded as *A question set
answered* says, and the node carries on `running` with the answers recorded on its summary.
A node a gate's revise re-ran asks again in its new attempt (`references/gates.md` § *Revising
at a gate*); the writer keeps the earlier answers on the summary as history, each stamped with
its `attempt` — the `question_id` is the question across attempts.
Anywhere else — no feature, a dispatched run, or a set the verb refuses as unsupported — nothing is
asked and the default is taken. Asking in session anyway is never right: nobody is there.

## When nobody can be asked

**Every in-node question names its default**, once, in the *Without question sets* line of its
node's *Asks* part — taken under a driver without question sets, or for a question a node
reaches after it has already asked. The families and what each
takes:

| The question | What is taken when it cannot be asked |
|---|---|
| A clarification | nothing is asked; the analysis or the delegate's own answers stand, and the node writes its artifact and sets its flag as a run with nothing to ask already does |
| An opt-in | the recommended option |
| A decision between alternatives | the recommended one; when nothing is recommended, the decision stays open and is recorded as an `open` risk in the node's summary, which the next gate's More details shows |
| A set offered as bundles | the recommended bundle |
| A drafted story | the story as drafted, kept in the requirements as drafted rather than confirmed |
| A loop offering another pass | the accept-as-is exit — the pass the loop would have added is not taken, and the following gate is the operator's route back |
| A finding that needs a decision (a review step's finding questions) | nothing is asked; each finding stays open as an `open` risk for the gate, unless the policy classes it |
| The automatic fix loop's stopping point | "Continue as is" — the open issues become `open` risks for the gate |
| An exhausted recovery budget | the node is recorded `failed`, per engine § *Recording an outcome* |
| A dispatch closed out partial (*A dispatch closed out partial*) | "Stop the run" — the node, every unexecuted node and the run are recorded `stopped`, and the summary carries what is held as an `open` risk; the work is never accepted and never dispatched again unasked |

`(Recommended)` appears once per question, on the recommended option, whose description (or,
without descriptions, the question) gives the reason; behind "Choose individually", no option
carries it.

**What is recorded.** One entry per defaulted question on that node's summary `decisions`
list:

```
{decision: "User guide off", by: default, question_id: user-docs}
```

`question_id` is the id the node's *Without question sets* line names, and `decision` is the
default this run actually took. A node that had nothing to ask records nothing. An answered question is recorded the same
way, `by: operator` (`references/gates.md` § *Before every gate*). `by: operator` is for an
answer a person gave and nothing else: a question the run settles without asking anybody —
under any permission mode, and under a driver that asks nobody — is `{decision, by: run,
rationale}`, never written in the answer shape. Under a `cockpit` or `dispatch` driver the
writer credits an operator-shaped item with no name, `via` or `actor` to the run, unless it is an
answer the writer folded from a recorded answer block or one it already holds, sent again. An answer's
`actor.kind` names who acted — `person`, or `coordinator` for the cockpit's coordinator answering
on a person's behalf (`references/gates.md` § *Provenance*). The older string form,
`defaulted: <id> -> <taken>`, is still read as `by: default`.

**A run started under a driver has its inputs** (`orchestrator.options.inputs`, engine Step 4):
if one is missing, print `RUN-FAILED: <code>` and stop — never invent one. **Defaulting never
waives** an unresolved critical issue or a decision the node owes
(`orchestrator-patterns.md` § 2.2, *Two things this never defaults past*): the remainder
becomes `open` risks for the next gate, and a node is never marked complete with an unasked,
unrecorded decision outstanding.

## When the policy classes a question

**The fact.** When the freeze recorded `orchestrator.classes_questions: true` (engine Step 4),
the autonomy policy the run applies classes in-node questions too, and one step comes first.
Without it — always under the built-in default — skip this subsection.

**The classing write.** At its asking point, before it asks anything or suspends, the node sends
the set it would ask to the writer, in one `write-state` patch on its own summary:
`node_summaries.<node>.question_set` — the same `{ask?, headline?, questions}` object the cockpit
form takes — and, optionally, `node_summaries.<node>.reasons`, `{<question id>: {rationale?,
assumption?, reversal?}}`, each one line. The writer consumes both and stores neither as sent. It
classes each question under the policy and the run's autonomy ceiling, records the outcome on the
node's `decisions`, stores the ids still to ask as the node's `asking`, and prints them last:

```
node_summaries.scoping

ask: scope-choice
```

**The four outcomes.** A question the policy does not class is left to ask, with no triage; a
classed one takes one of four outcomes, by its class, the autonomy ceiling and whether anybody can
be asked:

| Outcome | When | The writer records | The node |
|---|---|---|---|
| settled | the class is within what the autonomy ceiling settles — never a consult or approval class; any driver | `by: run`, with the rationale and the triage | takes it; never asks it |
| asked | above the autonomy ceiling, and somebody can be asked | nothing; the id is printed under `ask:` | asks it, as the sections above say |
| defaulted | above it, nobody can be asked; a consult-class one is marked advice not obtained | `by: default`, with the triage | takes it |
| held | an approval-class question nobody can be asked | `by: default`, its triage `held: true`; with nothing recommended, no choice: `decision: "No choice yet — needs your decision"`, `no_choice: true` | goes on provisionally with it, or without one |

Under a terminal driver ask in session only the ids printed under `ask:`; under a cockpit with
question sets the request carries only those (*When a question suspends*); under any other
driver they are the unclassed ones and the ones that recommend nothing, and each takes its named
default, recorded as *When nobody can be asked* says. `ask: none` means nothing is left to ask:
ask nothing, suspend on nothing, and carry on.

**A relayed answer** to a question set lands as one `by: operator` decision per question. When
the answer block carries `on_behalf_of`, every one of those decisions carries it too
(`references/gates.md`, *On whose behalf*).

**A question offering an option only a person can take** is never settled: the writer classes
it as if the ceiling settled nothing (*An option only a person can take*).

**A question that recommends nothing.** The writer never picks an option for a classed question
with no recommended option and no `default`. Where it would be settled, defaulted or asked, its
id is printed under `ask:`: it is asked where somebody can be, and elsewhere the decision stays
open and is recorded as an `open` risk. Where it would be held, it is held with no choice taken,
and only a revise of its step settles it, the person naming their choice in the note: the
re-run step sends the question again with that option as its recommended option (or its
`default`), and the classing write holds it for a later continue to approve.

**What the set carries.** The question ids it sends are the ids the node's question-set lines
in its prose declare; another id reads as itself and may fall to the policy's unknown family. A
question with no options — open text — cannot travel in a set: leave it out of the classing write
and ask it, or take its default, exactly as the sections above say.

**A held choice is provisional.** It may shape the steps after it, but nothing irreversible is
done on its strength — nothing pushed, published, sent or deleted — before a person approves it.
It forces the next checkpoint that runs, whose continue approves it; a person who disagrees
sends its step back with a revise and a note (`references/gates.md` § *Revising at a gate*,
*For a held choice*). When no checkpoint follows, the closing node asks `held-approval` before
it closes (`references/gates.md` § *The closing checkpoint `held-approval`*). Say this when you
present the checkpoint in session: continuing approves what is listed as held.

**What a node never does here.** It never composes a triage, never sends `asking` or
`classes_questions`, and never sends its own `by: run` or `by: default` item for a question the
writer classed: the writer drops each with a note and keeps its own. It never asks a question the
writer settled, defaulted or held, and never treats a held choice as approved. A later write may
re-send the writer's items unchanged or leave them out; they stay either way. A revise's reset
clears them, so the node's next attempt sends its set again and is classed afresh.
