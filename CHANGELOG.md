# Changelog

Notable changes per release, newest first. Anything you have to *do* on upgrade day is called out
under **Upgrading**; read that section before you install a new version over a project with work
in flight.

## 3.0.0

Maister 3.0 runs every workflow on a workflow engine. Each of the six built-in workflows
(`development`, `research`, `performance`, `migration`, `product-design` and `mockup-studio`) is a
definition: a graph of steps and checkpoints that the engine copies into the run's state when the
run starts, then works through. The workflow, quick and standards commands keep their names, and
your project's `.maister/` directory needs no conversion. This is a major version because two
things a 2.x user relies on change: Node.js 20 is now required, and a task started on 2.x is not resumed by 3.0. Read
**Breaking changes** and **Upgrading** below, and the
[migration guide](https://github.com/SkillPanel/maister/blob/master/docs/upgrading-from-2x.md),
before you install over a project with work in flight.

### What's new

- **Six built-in workflows on one engine.** Every change to a run's state goes through the engine,
  which refuses what the graph does not allow: a step recorded as done before the checkpoint in
  front of it has an answer, an answer the checkpoint does not offer, a run closed while steps it
  can still reach have not run. A resumed run continues from the graph it copied at its start, so
  a plugin upgrade does not change the steps and checkpoints of a run already in flight.
- **The mockup studio.** `/maister:mockup-studio` draws one new version of a set of mockups each
  time you call it, never asks a question, and keeps every earlier version. `--turn "<note>"`
  draws the next version; `--ground` rebuilds the grounding pack. The grounding pack, in
  `.maister/docs/design-context/`, holds your product's colours, fonts, layout and copy, harvested
  from the codebase, so the screens look like your product. It is built on the first mockup.
  Development and product design draw their mockups through it. See
  [Mockups](https://github.com/SkillPanel/maister/blob/master/docs/mockups.md).
- **Your own workflows and overlays.** A project can define a workflow in
  `.maister/workflows/<name>.yml`, with the plain-language prose for its steps in `<name>.md`
  beside it, and run it like a built-in with `/maister:run <name>`: the same checkpoints,
  dashboard and resume. A step can be prose, one of your skills, one of your agents, or another
  workflow. An overlay adds, tunes or disables steps of a built-in without copying it.
  `/maister:run <name> --check` validates a workflow without starting it, `/maister:run --list`
  shows what the project defines, and `/maister:work` offers one when your task matches it.
  `/maister:workflow-author` interviews you and writes the files. See
  [Extending Maister](https://github.com/SkillPanel/maister/blob/master/docs/extending.md).
- **Checkpoints that can send a run back.** A checkpoint that closes a document offers **revise**
  beside continue and stop. It sends the run back to the step that wrote the document, with a
  note you pick from suggestions or type yourself. That step and everything after it run again,
  and the checkpoint asks once more. A safety ceiling of ten revisions per checkpoint stops a
  runaway loop; after it, the checkpoint offers continue and stop alone.
- **Checkpoints you can read at a glance.** A checkpoint asks one line, and the option to continue
  shows what was done, what runs next, the files to review, the risks still open and who settled
  each decision. On GitHub Copilot CLI the same content is in the question itself.
- **Obvious fixes without a question.** When verification finds issues, in development and
  performance and in migration's issue resolution, every fix that is clear and not risky is made
  without asking, and the run re-checks on its own, up to two times. Only then does it ask about
  what is left. The next checkpoint lists every fix made without asking.
- **A question per finding.** When the specification audit or verification leaves a finding that
  needs your decision, each is asked on its own: the reviewer's proposed change, the alternatives,
  "Accept the risk and list it", the recommended choice with its reason, and the evidence.
  Questions inside a step say what they are about in their own text. In research and product
  design, each design decision is asked one area at a time, with every alternative, its pros and
  cons and a recommendation.
- **Three reviews, sized to your project.** Verification runs your full test suite, your lint,
  type and build checks, and three reviews, each by its own agent: spec conformance, code risk
  and simplicity. They judge against a project profile, the `project` block `/maister:init` writes
  to `.maister/config.yml`, so a command-line tool is not asked for rate limiting. Each review
  also runs on its own: `/maister:reviews-spec`, `/maister:reviews-code-risk` and
  `/maister:reviews-simplicity`.
- **Subagent models per call.** The `subagents` block of `.maister/config.yml` sets the model and
  effort each kind of agent runs on, per workflow or step if you want. Every agent call carries
  the values that apply. By default the reviewers get a stronger model than the clerical agents.
  See [Configuration](https://github.com/SkillPanel/maister/blob/master/docs/configuration.md).
- **A live dashboard.** Each run's `dashboard.html` follows the run as it goes: its steps, the
  decisions made and who made them, and the risks still open.
- **Context packs.** `/maister:development`, `/maister:research` and `/maister:product-design`
  take `--context=PATH`: a file or a folder that the run copies into its task directory and reads
  as background at every step.
- **More ways into development.** `/maister:development` takes `--design=PATH`, a product-design
  or quick-design task whose chosen screens become binding references for the plan, the
  implementation and the browser checks; `--architecture=PATH`, a high-level design the
  specification and the plan work within; and `--publish`, which makes approving the plan also
  approve publishing: the run commits on a branch of its own, pushes it and opens a pull request.
  It never merges.
- **Quick design.** `/maister:quick-design` settles one small design question: the options, a
  recommendation, your decision and a one-page record, with a sketch per option when sketches
  help.
- **GitHub Copilot CLI.** The `maister-copilot` plugin runs the same six workflows on the same
  engine. Every command now carries the plugin's name: type `/maister-copilot:<name>`, not a bare
  `/development`. The plugin now ships hooks there too: a reminder at session start and the guard
  that stops subagents from running commands that throw work away. See
  [Maister on GitHub Copilot CLI](https://github.com/SkillPanel/maister/blob/master/docs/copilot.md).
- **Hooks on Node.js.** Every hook is a Node.js script with no dependencies. None needs bash or jq,
  so they run on Windows too.

### Removed

- **The prose orchestrators.** In 2.x each workflow was a long prose skill that the session
  followed phase by phase. In 3.0 the definition is the workflow, and each workflow's command hands
  the run to the engine. There is no second way to run a built-in workflow.
- **Four review commands.** `/maister:reviews-code` is replaced by `/maister:reviews-code-risk`,
  and `/maister:reviews-pragmatic` by `/maister:reviews-simplicity`.
  `/maister:reviews-reality-check` is gone: `/maister:reviews-spec` checks a change against its
  specification, and the run's claims against evidence. `/maister:reviews-production-readiness` is
  gone: `/maister:reviews-code-risk` covers resilience, security and operational hygiene for the
  way your project is deployed. `/maister:reviews-spec-audit` is unchanged.
- **Flags.** `--type` on development: the analysis finds out whether the task fixes a reproducible
  defect, and writes a failing test first if so. `--code-review` on development: the three reviews
  always run. `--no-visual` on product design: set `mockup_format: ascii` in `.maister/config.yml`
  for mockups drawn as text. `--scope` on `reviews-code` and `--target` on
  `reviews-production-readiness` went with their commands.
- **The bundled browser server.** The plugin no longer starts a Playwright MCP server. Browser
  checks, user documentation with screenshots and the mockup gallery use the browser tool your
  session has: `playwright-cli` first, then a Playwright MCP server you configured, Claude in
  Chrome or the Claude desktop app's built-in browser. Without one, those steps are offered
  without the browser.
- **Approvals that asked nothing new.** Development no longer stops to approve a bug fix's passing
  test; its evidence reaches the verification checkpoint instead. Performance no longer stops to
  approve the checks you just chose. Development's mockups have no review loop of their own: the
  mockup checkpoint's revise sends them back.

### Breaking changes

- **Node.js 20 or newer is required.** In 2.x, Node.js was needed only for HTML mockups. In 3.0
  every workflow runs on the engine, which needs it. Without it, a workflow command stops before it
  creates a task directory and says why.
- **A task started on 2.x is not resumed.** Given a 2.x task directory, `/maister:work`,
  `/maister:run` and each workflow's own command say so and change nothing in it. Its files stay
  readable in place. Development, research and product design can take it as background with
  `--context` in a new run.
- **`--from=PHASE` and `--reset-attempts` are declined.** A resumed run works out what is ready
  from its graph, so there is no phase to jump to and no attempt counter to reset. Both flags are
  declined by name and the run continues without them. To go back inside a run, choose revise at a
  checkpoint.

### Upgrading

The [migration guide](https://github.com/SkillPanel/maister/blob/master/docs/upgrading-from-2x.md)
has every step in detail.

1. **Finish 2.x work on 2.x first**, or plan to start it again on 3.0.
2. **Install Node.js 20 or newer** where you run Claude Code or Copilot CLI. `node --version` shows
   what you have.
3. **Update the plugin.** Automatic updates are off for this marketplace unless you turned them
   on. From your shell:

   ```bash
   claude plugin marketplace update maister-plugins
   claude plugin update maister@maister-plugins
   ```

   Then run `/reload-plugins` or start a new session. On Copilot CLI:
   `copilot plugin update maister-copilot@maister-plugins`.
4. **Expect one new permission prompt.** The engine records each step of a run with a command of
   its own. Approve it with "don't ask again", or allow it in your permission settings.
5. **Add a browser tool** if you use browser checks, user documentation with screenshots or the
   mockup gallery: `npm install -g @playwright/cli` for `playwright-cli`, a Playwright MCP server,
   Claude in Chrome or the Claude desktop app's built-in browser. On Copilot CLI, use
   `playwright-cli`.

**To stay on 2.x**, install the 2.x maintenance line. Only one Maister channel can be enabled at a
time, so uninstall the other first:

```bash
/plugin uninstall maister@maister-plugins
/plugin marketplace add SkillPanel/maister#release/2.x
/plugin install maister@maister-plugins-2x
```

On Copilot CLI:

```bash
copilot plugin uninstall maister-copilot@maister-plugins
copilot plugin marketplace add SkillPanel/maister#release/2.x
copilot plugin install maister-copilot@maister-plugins-2x
```

The 2.x line receives fixes only, with no new features, for six months, until <!-- RELEASE: fill in the 2.x end date (six months after the 3.0.0 release date) --> **[2.x end date]**.
