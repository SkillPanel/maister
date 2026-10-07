# Changelog

Notable changes per release, newest first. Anything an operator has to *do* on upgrade day is
called out under **Upgrading** — read that section before you install a new version over a
workspace with work in flight.

## 3.0.0

Maister 3.0 runs every workflow on a workflow engine. Each of the five built-in workflows —
`development`, `research`, `performance`, `migration` and `product-design` — now ships as a workflow
definition: a graph of phases and gates that the engine freezes into the task's state when the run
starts, and then executes. A resumed run continues from the graph it froze, so neither an upgrade
nor an edited definition changes a run already in flight. This is a major version because two
things a 2.x user relies on change: Node.js is now required, and a task started on 2.x is not
resumed by 3.0. Read **Breaking changes** and **Upgrading** below before you install over a
workspace with work in flight.

### What's new

- **Engine-driven workflows.** A workflow's phases, gates and artifacts are declared in its
  definition rather than described in a long prose skill, and every change to a run's state goes
  through the engine. It refuses a change the frozen graph does not allow — an unknown phase, a
  status a phase cannot have, a gate answer that is not one of the gate's options — and a run cannot
  be recorded as complete while a phase it can still reach has not run.
- **Your own workflows.** A project can define a workflow in `.maister/workflows/<name>.yml`, with
  the prose for its steps in `<name>.md` beside it, and run it like a built-in with
  `/maister:run <name>` — the same dashboard, the same gates, the same resume.
  `/maister:run <name> --check` validates one without starting it, `/maister:run --list` shows what
  the project defines, and `/maister:work` offers one when your task matches what it is for. A
  built-in can be adjusted without copying it, through an overlay that disables, tunes or adds
  phases, or copied whole into the project as an eject. `/maister:workflow-author` writes them with
  you: `new` interviews you and writes the definition, `overlay` shows what a built-in lets an
  overlay change and writes one, and `check`, `nodes` and `preview` judge, list and draw. See
  [Extending maister](https://github.com/SkillPanel/maister/blob/master/docs/extending.md).
- **Child runs.** A phase can start another workflow as a run of its own — a research run inside a
  larger piece of work, say. The child gets its own task directory beside the parent's, with its own
  gates and dashboard; the parent waits for it, then reads back what the child declares, such as its
  report and conclusions.
- **A live dashboard.** A run's `dashboard.html` draws from data the engine republishes on every
  state change, so it is never behind the run, through implementation waves and verification cycles
  included. Phases are shown by readable titles.
- **Gates that can send a run back.** Approval gates that close a document offer **revise** beside
  continue and stop. It sends the run back to the phase that wrote the document, with a note you
  pick from suggested changes drawn from that phase's open risks and decisions, or type yourself.
  That phase and everything after it run again, and the gate asks once more. Revise as often as you
  need: the option says how often the gate has sent the run back so far, and a safety ceiling of
  ten per gate stops a runaway loop, after which the gate offers continue and stop alone.
- **Checkpoints you can read at a glance.** A gate asks one line: what finished, and whether
  it is ready to go on; the continue option names where the run goes. On Claude Code each option shows a preview beside it — the continue
  option's says what was done, what runs next, the files to review, who settled each decision
  (the analysis, an audit or a default) and how many of the choices were your own; revise and
  stop say what they would do. Risks are kept under **More details**, grouped as open, accepted
  trade-offs and follow-ups. On GitHub Copilot CLI the same content is in the question itself,
  with the ask as its last line.
- **Obvious fixes without a question.** When verification finds issues — in development and
  performance, and in migration's issue resolution — every fix that is clear and not risky is
  made without asking, and the run re-checks on its own, up to two times. Only then does it ask:
  about the issues that need your decision, one per issue, and whether to take another round,
  continue as is or stop. The next gate lists every fix made without asking.
- **Questions that carry their own context.** A question inside a phase says what it is about
  in its own text, and its recommended answer gives the reason. Questions that stand on their
  own come as pages of up to four; a design decision comes one area at a time, each with every
  alternative, its pros and cons and the recommendation, and is never accepted wholesale. A
  question the run can already answer from its own analysis is not asked: it says the answer in
  one line instead. Where the context is long, **More details** writes it out and asks again.
- **A record of who decided.** Every decision a run records says who settled it: the analysis,
  an audit, a default taken because nobody could be asked, or you. Your answers are kept in the
  task's state, with whether you took the recommendation, and the dashboard shows each decision
  with who settled it.
- **Product design on the engine.** `/maister:product-design` runs as a definition like the others,
  with five pauses: after the intake, the context, the problem and personas, the design direction,
  and the specification and prototypes. A run driven from outside the session never chooses a
  design direction itself: it lays out the alternatives with a recommendation for each decision, and
  the direction pause is where you choose.
- **Also new.** Umbrella workspaces span several repositories (`/maister:umbrella init`, `validate`
  and `prune`) and are driven as chains from the
  [maister cockpit](https://github.com/SkillPanel/maister-cockpit). On GitHub Copilot CLI, the
  plugin now names every command the way Copilot registers it, `/maister-copilot:<name>`.

### Removed

- **The prose orchestrators.** In 2.x each workflow was a long prose skill that the session
  followed phase by phase. In 3.0 the definition is the workflow, and each workflow's command hands
  the run to the engine. There is no second way to run a built-in workflow.
- **The prose switch.** The 2.3.0 betas could run a workflow's prose form instead, by setting
  `MAISTER_WORKFLOW_PROSE`. That form is gone, and the variable is no longer read.
- **Gates that asked nothing new.** Development no longer pauses to approve the passing test of a
  bug fix — its evidence reaches the verification checkpoint instead — and performance no longer
  pauses to approve the checks you just chose. Development's UI mockups have no review loop of
  their own any more: the mockup gate's revise sends them back.

### Breaking changes

- **Node.js 20 or newer is required, with no fallback.** In 2.x, Node was needed only for HTML
  mockups. In 3.0 every workflow runs on the engine, which needs it: without Node, a workflow
  command stops before it creates a task directory and says why.
- **A task started on 2.x is not resumed.** Its state has no frozen graph, so there is nothing for
  the engine to resume. Given a 2.x task directory, `/maister:work`, `/maister:run` and each
  workflow's own command say so and change nothing in it. Its artifacts stay readable in place, and
  it is still listed like any other task directory.
- **The prose switch is gone, and nothing replaces it.** Setting `MAISTER_WORKFLOW_PROSE` changes
  nothing. A run the engine cannot continue stops and says why; the way back to the 2.x behaviour is
  the 2.x line, task by task.
- **`--from=PHASE` and `--reset-attempts` are declined.** A resumed run recomputes what is ready
  from its frozen graph, so there is no phase to jump to and no attempt counter to reset. Both flags
  are declined by name rather than silently ignored, and the run continues without them. Re-entering
  a run at a phase of your choosing is planned for a later release; until then, a gate's revise is
  the way back inside a run.

### Upgrading

*Finish 2.x work on 2.x first.* 3.0 resumes only runs its own engine started. Take any task still
in flight to its end on 2.x before you upgrade, or plan to start it over on 3.0. Trying is safe: a
2.x task directory handed to 3.0 is refused with a message that says so, and nothing in it changes.

*Install Node.js 20 or newer* where you run Claude Code; `node --version` tells you which you have.

*Upgrade the plugin.* Automatic updates are off for this marketplace unless you turned them on. In
a session, open `/plugin`, select `maister` on the **Installed** tab and choose **Update now** — or,
from your shell:

```bash
claude plugin marketplace update maister-plugins
claude plugin update maister@maister-plugins
```

Then run `/reload-plugins`, or start a new session.

*Expect the engine's command to ask for permission.* Every state change is one write to a file in
the task directory and one engine command that applies it. Running with edits auto-accepted, as the
README recommends, covers the write; approve the command with *don't ask again*, or allow it in your
permission settings, and it stops asking.

*To stay on 2.x*, install the 2.x maintenance line instead. It receives fixes only — no new
features — for six months after 3.0.0 is released:

```bash
/plugin uninstall maister@maister-plugins
/plugin marketplace add SkillPanel/maister#release/2.x
/plugin install maister@maister-plugins-2x
```

On GitHub Copilot CLI, check out the `release/2.x` branch and load its `plugins/maister-copilot`
directory with `copilot --plugin-dir`.

*On GitHub Copilot CLI*, type every command as `/maister-copilot:<name>`, and export
`MAISTER_PLUGIN_ROOT` as the
[README's Installation section](https://github.com/SkillPanel/maister/blob/master/README.md#installation)
describes. On 2.x only HTML mockups needed it; on 3.0 the workflow engine does too.

## 2.3.0-beta.27

A `workflow:` node with no `dir:` now starts a **child run**: an ordinary task directory beside the
parent's, with its own frozen graph, its own gates and its own driver, linked back to the node that
started it. The parent waits while the child executes and adopts the child's outcome when it ends.
Alongside it, a workflow name is now resolved in all four homes — an eject, then a generated chain,
then an overlay, then the shipped built-in — at validate time as well as at run time, which closes a
case where a workspace validated one file and ran another.

### Upgrading

**Every built-in workflow definition's recorded identity moved in this release.** A workflow-level
`outputs:` block now enters the hash envelope, and it enters it unconditionally — a definition that
declares no interface at all is hashed as one that declares an empty one, which is not what the
previous version hashed. So the hash changed for every built-in, including definitions whose text is
byte-for-byte identical to the previous release: nothing in the file moved, the envelope the file is
hashed inside did. The resolution fix is not the cause — where a definition was found never entered
the hash, and still does not.

*What breaks:* a multi-repository workspace holding a **chain run that is still in flight** refuses
its first dispatch after the upgrade. The refusal is this, verbatim:

```
dispatch-graph-drifted: the workflow definition has changed since the run froze its graph (frozen <hash>, now <hash>) — dispatching would run work this run never planned
```

Both hashes are printed in full in the real message. It fires whether or not you touched the chain
definition yourself — nothing in your workspace changed; the engine moved underneath it.

*What to do:* either **finish the chain run on the previous version** and upgrade afterwards, or
**re-freeze the run against the current definition** — re-resolve the definition the run's
`workflow.source` names, read the resulting graph, satisfy yourself it still plans the work the run
has left, and write the fresh `graph_hash` onto the run's `workflow` block through the engine's
`write-state` verb. Re-freezing keeps every node the chain has already completed. Starting a new run
also clears the refusal and discards that progress, so it is the last resort, not the first. Do not
force past the refusal.

*What is unaffected:* an ordinary local run. Resuming one never re-resolves its definition and never
compares its frozen hash against a fresh one — it runs the graph it froze. Every in-flight local run
survives the upgrade untouched, and a workspace with no chain run open has nothing to do.

*Scripting the check:* `umbrella envelope` reads its overrides from stdin and will block if stdin is
a terminal, so run it with stdin closed (`< /dev/null`) when sweeping several runs.
