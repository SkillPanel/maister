# ADR-0031 — A Claude Code hooks module draws the run, display only

**Status**: Proposed · **Date**: 2026-10-07 · **Sources**: `plugins/maister/hooks/display.mjs`; `plugins/maister/hooks/hooks.json` (`modules`); `plugins/maister/types/index.d.ts`; `plugins/maister/skills/workflow-engine/scripts/lib/display-files.mjs` (`phaseOf`, `publishRun`, `publishNext`); `scripts/lib/checkpoint.mjs` (`panelOf`, `PANEL_ROWS`, `ROW_CHARS`); `scripts/lib/state.mjs` (`display`, `bannerLines`); `scripts/workflow.mjs` (`publishPanel`); `platforms/copilot-cli/build.sh`; `tests/engine/display-files.test.mjs`, `checkpoint.test.mjs`; `tests/mod/display.test.ts`; ADR-0007, ADR-0024, ADR-0030

## TL;DR
The context a user needs at the start of a run and at each checkpoint reached the screen only when
the orchestrating model chose to write it, and in measured runs it often did not. Claude Code's
hooks modules ("mods") can draw beside the session where the model cannot leave anything out:
- transcript lines;
- a status line;
- a panel above the question dialog.

This decision makes such a module the plugin's first runtime module, in the open edition. Its
scope is display only. The workflow engine writes small display files per run, and the module
reads them and draws them as they stand: it parses no command and computes nothing. Every other
surface keeps today's question, unchanged, as the floor.

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
  phase, the run's status, and `line`, the status line composed.
  - Phases are the frozen nodes, less gates and less the nodes recorded skipped.
  - The current phase is the first one under way. With none under way, it is the last one
    completed, or else the first.
  - It never names pending work after a completed phase, because only the gate brief's walk
    knows what a guard will skip.
- **`<run>/display/banner.json`**, from the freeze. It holds the banner's lines, without the relay
  line addressed to the model. The stdout banner is built from the same lines.
- **`<run>/display/next.json`**, from `gate-brief`, in every form. It holds the gate, the question
  the session asks verbatim (the rich picker's question) and a glance at the checkpoint.
  - The glance is a projection of the checkpoint (ADR-0030), `panelOf`. Its lines are the
    checkpoint and what it closes, the *Done* sentence, the decided and open counts, *Next* and
    *Review*.
  - Each line is fitted to its share of ten rows: the twelve-row limit less the panel's border.
  - Every state write removes the file, so a panel exists only between a brief and the answer.
- **`<project>/.maister/display/sessions/<session id>.json`**, from every state write. It names the
  run this session wrote last.
  - It is keyed by `CLAUDE_CODE_SESSION_ID`, which the module reads back as `$.session.id()`.
  - Its caller is the session, and a fixed file per project would be shared by two sessions
    driving two runs there. Without a session id, none is written.

Each display directory carries a `.gitignore` of `*`, so none of these files ever shows in a
project's `git status`. The files are the machine's and the session's, as ADR-0007 requires of
anything per-session.

**The module.** `hooks/display.mjs` is plain JavaScript with no build step. It has four hooks:
- `session.start` and a shell `tool.call` set the status line from `status.json`.
- The same shell hook logs the banner once, one line per call. It does so only when the latest
  write is the freeze, which it tells by `banner.frozen` equalling `status.updated`.
- An `AskUserQuestion` `tool.call` sets the panel when the question asked equals the one in
  `next.json`, and clears it once the question is answered.
- A `ui.render` hook on `AskUserQuestion` draws the panel's lines in a bordered box, with the
  dialog once beneath it.

The values a drawing reads (`panel`, and the banner already shown) live in `$.state`, declared in
the plugin's contract, which `claude plugin validate` holds the module to.

**Scope: display only, never gating.**
- No hook denies, rewrites or answers a call: each passes its call through.
- Each has a `.catch` that passes it through again when the hook fails. Where `next` was already
  called, this replays the settled result, so nothing runs twice.
- The module writes nothing and starts no process. `claude plugin validate` lists its calls:
  `$.fs.exists`, `$.fs.read`, `$.session.id`, `$.session.root`, `$.state`, `$.ui`.
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
- the row rule is measured, lives in one place (`checkpoint.mjs`), and is pinned by tests that do
  not trust the CLI's test kit, which does not enforce it;
- a breach costs only the panel, because Claude Code refuses an oversized tree and draws its own
  dialog.

The module is tested on 2.1.292. The earliest build it works on is not established here.

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
| Module variables instead of `$.state` | A reload loses them, and Claude Code documents `$.state` as where a drawing's values belong |
| Leave context to the model and the previews | Measured: the banner reached the screen only when retold, and a checkpoint's context only while one option was in focus |

### Consequences
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
  - the twelve-row and forty-character rule;
  - no hot reload while a dialog is open;
  - Desktop Code tab drawing, so far tested only through the CLI's test kit;
  - whether `CLAUDE_CODE_SESSION_ID` stays exported to the shell.
