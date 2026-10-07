# ADR-0031 — A Claude Code hooks module draws the run, display only

**Status**: Proposed · **Date**: 2026-10-07 · **Sources**: `plugins/maister/hooks/display.mjs`; `plugins/maister/hooks/hooks.json` (`modules`); `plugins/maister/types/index.d.ts`; `plugins/maister/skills/workflow-engine/scripts/lib/display-files.mjs` (`phaseOf`, `checkpointOf`, `publishRun`, `publishNext`); `scripts/lib/checkpoint.mjs` (`panelOf`, `PANEL_ROWS`, `ROW_CHARS`); `scripts/lib/gate-brief.mjs` (`panelFor`); `scripts/lib/state.mjs` (`display`, `bannerOf`); `scripts/workflow.mjs` (`publishPanel`); `platforms/copilot-cli/build.sh`; `tests/engine/display-files.test.mjs`, `checkpoint.test.mjs`; `tests/mod/display.test.ts`; ADR-0007, ADR-0024, ADR-0030

## TL;DR
The context a user needs at the start of a run and at each checkpoint reached the screen only when
the orchestrating model chose to write it, and in measured runs it often did not. Claude Code's
hooks modules ("mods") can draw beside the session where the model cannot leave anything out:
- a card in the transcript where the run starts;
- a band above the prompt with where the run is;
- a panel above a gate's question dialog;
- the engine's own bookkeeping calls as one quiet line each.

This decision makes such a module the plugin's first runtime module, in the open edition. Its
scope is display only. The workflow engine writes small display files per run, and the module
reads them and draws them as they stand: it computes nothing beyond how long the run has been
going, and it never says how long anything will take. Every other surface keeps today's
question, unchanged, as the floor.

## ADR-0031: A Claude Code hooks module draws the run, display only {#adr-0031}

### Status
Proposed. It is on a branch for an attended trial, and nothing here is accepted until the trial
says so.
- The engine gains display files, written with no new verb.
- The plugin gains `hooks/display.mjs`, listed under `modules` in `hooks.json`, and the state
  contract it needs, `types/index.d.ts`, named in `plugin.json`.
- ADR-0030 is amended (see *Decision*).

### Context
Two things the user should always see depended on the model:
- **The start banner.** The freeze prints it first, with a relay line asking the model to tell the
  user. The terminal collapses tool output, so the banner was seen only when the model retold it.
- **A checkpoint's context.** At a gate the model writes at most one lead-in line, and the
  question's option preview carries the glance. The preview shows only while the continue option
  is in focus, and a model that leaves previews out loses it.

Claude Code 2.1.292 runs plugin hooks modules. A module hooks events, such as a tool call or the
question dialog's render site, and draws:
- `$.ui.log` writes a transcript line;
- `$.ui.status` writes one status line per plugin;
- a `ui.render` hook on `AskUserQuestion` can put elements above the dialog, as long as the dialog
  itself appears exactly once.

A spike proved all three in a real run, live. It also showed that a module which finds the run by
regex over the model's shell commands, and counts phases itself, is fragile. One quoting change
defeats it, and it counted gates as phases.

The measured limits of 2.1.292:
- The elements around the dialog are held to **twelve rows**, a text counting one row plus one
  per forty characters. A tree over that is refused whole, and the engine draws its own dialog.
- Markdown is refused there.
- One `$.ui.log` call draws one line: a line break inside it draws as U+FFFD.
- A module does not hot-reload while a dialog is open.
- Modules draw in the terminal and the Desktop Code tab only. In VS Code their hooks run and
  nothing is drawn; `-p` and the Agent SDK draw nothing.

### Decision
**The engine writes the display files; the module only reads and draws them.**

The engine writes four files, each as a projection on the dashboard's terms (ADR-0024). A failure
is a stderr warning naming the file, never a refusal; no exit code moves; and none of the files is
reported among a write's changed paths.
- **`<run>/display/status.json`**, from every state write. It holds the workflow, the task, the
  phase, the run's status, and `line`, the status line composed. Beside them:
  - `started`, the freeze stamp, carried from the banner file on later writes;
  - `checkpoint`, the next gate neither completed nor skipped, numbered among all the frozen
    gates as the gate brief numbers it;
  - `nodes`, every frozen node's title and status, and `saved`, the nodes this write changed
    against the status file it replaces;
  - `gate_open`, whether a gate is under way;
  - `artifacts`, the artifact paths the nodes declare, relative to the run's folder, a sub-run's
    left out until it has a folder of its own;
  - the task folder's and the dashboard's `file://` URLs.
  - Phases are the frozen nodes, less gates and less the nodes recorded skipped.
  - The current phase is the first one under way. With none under way, it is the last one
    completed, or else the first.
  - It never names pending work after a completed phase, because only the gate brief's walk
    knows what a guard will skip.
- **`<run>/display/banner.json`**, from the freeze. It holds the banner's lines, without the relay
  line addressed to the model, and the same facts as fields (the workflow, the task, the number
  of checkpoints, the first phase, the task folder and the dashboard as `file://` URLs). The
  stdout banner is built from the same lines.
- **`<run>/display/next.json`**, from `gate-brief`, in every form. It holds the gate, the question
  the session asks verbatim (the rich picker's question) and a glance at the checkpoint.
  - The glance is a projection of the checkpoint (ADR-0030), `panelOf`. Its lines are the
    checkpoint and what it closes, the *Done* sentence, the decided and open counts, *Next* and
    *Review*.
  - Each line is fitted to its share of ten rows: the twelve-row limit less the panel's border.
  - Beside the glance, `parts`: the same lines as a label and a text each, fitted to the same
    rows with the label counted, and the review files as names with their `file://` URLs, the
    ones that do not fit counted as `more`.
  - Every state write removes the file, so a panel exists only between a brief and the answer.
- **`<project>/.maister/display/sessions/<session id>.json`**, from every state write. It names the
  run this session wrote last.
  - It is keyed by `CLAUDE_CODE_SESSION_ID`, which the module reads back as `$.session.id()`.
  - Its caller is the session, and a fixed file per project would be shared by two sessions
    driving two runs there. Without a session id, none is written.

Each display directory carries a `.gitignore` of `*`, so none of these files ever shows in a
project's `git status`. The files are the machine's and the session's, as ADR-0007 requires of
anything per-session.

**The module.** `hooks/display.mjs` is plain JavaScript with no build step. It draws at four
render sites, and stands in for them where they are not drawn:
- **`ToolUse`, `ToolResult` and `ToolGroup`: the start card and the quiet lines.**
  - The freeze's row draws as a bordered, padded card: *<Workflow> run started* in the accent
    colour with the date and time dim, the task in bold, the checkpoints and the first phase dim,
    and links to the dashboard and the task folder.
  - A clean state write draws as `· maister · saved · <node> → <status>, …`, or as the checkpoint
    it opened. A clean gate brief draws as `· maister · checkpoint k of M · <title>`.
  - The patch file draws as one line until a write lands it, and as nothing after that.
  - A clean `Write` of an artifact the run declares, a file in its task folder, draws as
    `· maister · wrote <path>`, the path a link. A status file without `artifacts` takes any file
    in the folder but the engine's own.
  - A line draws dim, inset under the row's bullet as a tool result's line is.
  - A call whose line would say nothing, a write that changed no step, draws nothing; so does one
    whose line is the last quiet line again, such as the brief of a checkpoint its write already
    named.
  - Claude Code folds a run of calls into one count line, which no `ToolUse` hook sees. A folded
    run made only of these rows, the ones that draw nothing included, draws as those rows and no
    count line. One mixed with other calls draws as Claude Code draws it; only a start card is
    added under it, since nothing else shows the banner.
  - Where the session draws on no surface that shows a card, the banner's lines are logged once
    instead (`$.ui.log`).
- **`AbovePrompt`: the run band.**
  - Two rows. The first: the workflow in the accent colour, the task, and the dashboard and task
    folder links on the right. The second: the phases as dots (done green, the current amber, the
    rest dim), `phase n of N · <title>` with the title bold, then the next checkpoint and
    `running for N min`, dim.
  - It yields to a survey, keeps to one row when the band has only one, and is redrawn each
    minute.
  - Where the session draws on neither the terminal nor the desktop, the status line stands in
    (`$.ui.status`).
- **`AskUserQuestion`: the gate panel.**
  - It is set on the `AskUserQuestion` call when the question asked equals the one in
    `next.json`, and cleared once that question is answered.
  - The option preview under it already says what was done, what comes next and what was decided,
    so the panel is two lines: `Checkpoint k of M · <closing title> · <n> decided · <risks>`, the
    checkpoint in the accent colour, the title bold and the open risks amber when there are any;
    then the review files as links, which is what the panel alone gives.
  - `next.json` keeps every part; the module draws the title, the counts and the review files.
  - There is no Markdown. A brief without parts draws its plain glance.

**What collapses, and how that is decided.**
- A call collapses only when the engine's own files prove what it did. For a state write, the
  status file moved on during the call. For a gate brief, the panel file changed.
- The call must also be clean: no error, no refusal, nothing on stderr, and not interrupted.
- The command is matched against the engine's verb only as a guard against a compound command. It
  is never the source of what is drawn.
- The decision is made once, when the call returns, and kept under the call's id. A row that
  errors later, or one replayed from an earlier session, draws as Claude Code draws it.
- **Ctrl+o shows the same quiet line.** The `ToolUse` render site carries no flag for the expanded
  transcript, so a collapsed row stays collapsed there. The call's full result stays in the
  model's context and in the run's state.
- What the model reads of a call is never touched: the line is the row's drawing alone.

**Links.** The run's links are `file://` URLs, drawn as links look: underlined, in the link colour.
- The terminal draws them as OSC 8 spans. Around the dialog a link costs the rows of its URL, so
  the panel links as many review files as fit and names the rest; under a deep project path that
  may be none.
- The desktop sends no link whose scheme is not `https:`. There, a review file is its name in plain
  text, and the dashboard and folder links are left out.

**No predictions.** The band says how long the run has been going, which is a fact. Nothing the
module or the engine shows says how long anything will take. The workflow engine's prose tells the
model not to say it either.

The values a drawing reads live in `$.state`, declared in the plugin's contract, which
`claude plugin validate` holds the module to:
- the panel;
- the run's status;
- the band's clock;
- each redrawn row;
- the last quiet line drawn;
- the banner already logged.

**Colours.** The accent `#e2885d`, green `#79c08b`, amber `#e3bd59`, link `#7cc4e8`, dim `#8c909a`
and the border `#4a4f5a` are hex, which `Color` takes beside the theme keys. They are the designs'
own, and no theme key names the accent or the link colour.

**Scope: display only, never gating.**
- No hook denies, rewrites or answers a call: each passes its call through.
- Each has a `.catch` that passes it through again when the hook fails. Where `next` was already
  called, this replays the settled result, so nothing runs twice.
- The module writes nothing and starts no process. `claude plugin validate` lists its calls:
  `$.clock.every`, `$.clock.now`, `$.fs.exists`, `$.fs.read`, `$.session.id`,
  `$.session.root`, `$.session.surfaces`, `$.state`, `$.ui`.
- It never decides whether a gate is asked or how it is answered. Gate enforcement stays where
  ADR-0007's 2026-09-20 amendment puts it.

**Trust.**
- Mods aren't sandboxed: a module runs with the user's permissions, outside the Bash sandbox, so
  trust in it is trust in the plugin as a whole.
- The module loads only in a workspace the user trusts. Claude Code holds module loading until
  workspace trust is accepted.
- An organization can switch modules off by policy (`allowManagedModsOnly`, `disableAllHooks`).

**The early-access API.** Claude Code's declarations say this surface "may change between
releases without notice". So:
- the module depends on as little of it as it can;
- the row rule is measured, and the text is fitted to it in one place (`checkpoint.mjs`), pinned
  by tests that do not trust the CLI's test kit, which does not enforce it. Claude Code's own
  check (read from its validator in 2.1.293) also charges a link the rows of a space and its URL,
  which the engine cannot know when it fits a panel, so the module counts its tree by the same
  rule before drawing it (`panelBox`), links fewer review files when they would not fit, and falls
  back to the plain glance. The rule, in full: an inline element outside another costs a row; a
  string, one more per forty characters, and a row of its own outside an inline element; a link
  the rows of its URL; a border two; vertical padding and margins their size;
- a breach costs only the panel, because Claude Code refuses an oversized tree and draws its own
  dialog.

The module is tested on 2.1.292 and 2.1.293. The earliest build it works on is not established here.

**The floor.** Everywhere the module does not draw, the question carries its context exactly as
before: the rich picker's previews, More details and the one lead-in line. That covers VS Code,
`-p`, the SDK, modules switched off, an untrusted workspace, Copilot and Codex. The Copilot build
drops `hooks/`, the contract and the manifest's `types` entry, so that variant is unchanged apart
from the engine's display files.

**Open edition, not Pro.** The module fixes a gap every Claude Code user has: context at the
decision point. The display files it reads are open engine output anyway. Pro can add drawn extras
on the same files, such as a cockpit link or a driven-gate badge, without forking the module.

**ADR-0030 is amended.** Its operator decision 3 kept the checkpoint out of any display file "so
nothing can go stale between two asks", and its alternatives rejected "an engine-written display
file beside the run". This decision writes one, and answers both objections:
- **No new verb.** `gate-brief` writes the file.
- **It cannot go stale between two asks.** Every state write removes it, `gate-brief` rewrites it
  at every ask, and the module draws it only for the exact question it was written for.

The checkpoint itself still travels in the gate request as ADR-0030 says. The panel is one more of
its projections, not a second source.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Pro edition only | Withholds a correctness fix, context at the decision point, from the open edition. Pro's paywall is the cockpit, so this would be a second, odd one. The same engine output would look different by edition |
| Open status line and banner, Pro panel | Two code paths, and the most valuable part, the gate panel, is the one withheld |
| The module finds the run by reading the model's shell commands and builds what it draws (the spike) | A quoting change, a patch file elsewhere or a wrapper defeats it silently. It counted gates as phases and called a stopped run done |
| The module runs `gate-brief --checkpoint` itself at the question (the spike) | It needs the run, the node and the engine's path from the model's commands. It starts a process from a module that otherwise starts none |
| One fixed `.maister/` pointer to the active run | Two sessions driving two runs in one project would each draw the other's run |
| Collapse every shell call that names the engine's verb | A refusal or a warning would vanish into one quiet line, and a compound command would hide the rest of its output |
| Decide the collapse at render, from the row's output | A row is redrawn on resize and replayed on resume; deciding at the call, from the files the call changed, keeps one answer for the row's life |
| Module variables instead of `$.state` | A reload loses them, and Claude Code documents `$.state` as where a drawing's values belong |
| Leave context to the model and the previews | Measured: the banner reached the screen only when retold, and a checkpoint's context only while one option was in focus |

### Consequences
- **Good.** In the check on 2.1.293, a development run up to its specification gate:
  - the band followed every write: dots, phase, next checkpoint and elapsed minutes, then
    `stopped` when the run was stopped;
  - each state write drew as one quiet line, folded runs of calls included, and a write that
    opened a gate drew as its checkpoint;
  - the detailed transcript (ctrl+o) showed the same quiet lines;
  - the gate panel drew styled above the gate's question, after a first refusal that the URL
    count above now prevents; a non-gate question was left untouched;
  - a refused write drew as Claude Code draws it, and its patch line stayed.
- **Good.** Every run shows its banner, its phase and each checkpoint's glance in the terminal and
  the Desktop Code tab, whatever the model writes. In the attended check on 2.1.292:
  - the banner drew line by line;
  - the status line followed every write, with gates uncounted and the total shrinking as skips
    were recorded;
  - two gate panels drew above their dialogs with none refused;
  - a non-gate question was left untouched;
  - a resumed session drew its status line at start.
- **Good.** The status line, the banner and the glance are composed once, in the engine, and tested
  there. The module is small enough to read in one sitting.
- **Bad.** It is the plugin's first runtime module, on an early-access API. A Claude Code release
  can change:
  - the render site;
  - the row rule;
  - the hook semantics;
  - the declarations the contract is written against.

  Each is re-measured on every Claude Code release that touches modules. Until then the floor
  carries the run.
- **Bad.** Every state write and every brief writes a few more small files. Claude Code shows file
  changes made by a shell command in the transcript, so a brief's `next.json` appears there beside
  the state and dashboard changes it already shows.
- **Watch items.**
  - the twelve-row and forty-character rule, and a link's URL counted in it;
  - Claude Code folding runs of calls into one `ToolGroup` line, which no `ToolUse` hook sees;
  - no hot reload while a dialog is open;
  - Desktop Code tab drawing, so far tested only through the CLI's test kit;
  - whether `CLAUDE_CODE_SESSION_ID` stays exported to the shell.
