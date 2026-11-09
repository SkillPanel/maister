---
name: maister:mockup-studio
description: Draws one new version of a set of UI mockups per call — a turn — under a folder it is given, as HTML pages with a gallery or as terminal ASCII, bound to the project's design language through its grounding pack. Never asks a question, under any driver; run it again with the same folder for the next version, and every earlier version stays. Reachable as the `mockup-studio` workflow, from a workflow node (development's and product-design's mockup steps) or another skill (quick-design's sketches), and from the terminal with `--turn` and `--ground`.
user-invocable: true
---

# Mockup Studio

One call is one **turn**: it takes a note and a version to build on, writes exactly one new
`versions/vNNN/` under `<task_path>/<output_subdir>/`, refreshes the flat latest view beside it,
and returns. It asks nothing — not which format, not whether the screens are right. Whoever wants
another round runs another turn; a caller's own gate is where a person approves or revises.

The bookkeeping is code. The model writes one input file per turn, `vNNN/.turn.json` (and, for a
prototype, `vNNN/prototype.html`); the scripts allocate the version, render the pages and the
gallery, write every manifest and index, and refresh the flat view. Every shape a script writes is
in `<plugin root>/skills/mockup-studio/references/turn-contract.md`.

The skill runs in the main agent: it dispatches the ASCII agent, and its look pass drives whatever
browser tool the session has. So does `finish`, which opens the gallery (step 6): no subagent runs
it, and the ASCII agent only writes its document.

---

## Which entry a call is

| The call carries | Entry | What happens |
|---|---|---|
| A node's `with:` values together with the `run-context` output | **Node mode** | One turn. It never hands off to the workflow engine and never reads flags, whatever the values hold. With no `task_path`, the turn writes under the task directory `run-context` names |
| The same named values from another skill, or from a running workflow node's own prose, with `task_path` set | **Inline call** (quick-design, product-design's convergence) | Handled as node mode with no `run-context` and no `record`, so no run record is written. It never hands off. `task_path` is required: without it, say so and write nothing |
| Flags or bare text, typed by a person | **Terminal entry** | *Terminal entries* below |

Only a call made of flags or bare text is a terminal entry.

---

## Turn inputs

Node mode takes these from the node's `with:` values and `run-context`; an inline call passes them
by name; a terminal entry builds them from its flags.

| Input | Meaning |
|---|---|
| `task_path` | The target root. Absent: the task directory `run-context` names. Required when there is no `run-context` |
| `output_subdir` | Relative to `task_path`. Default `analysis/mockups` |
| `note` | The person's words for this turn. On a caller's re-run, the revise note from `prior-context` |
| `against` | The `vNNN` to build on. Absent: the latest, or none on a first turn |
| `scope` | Comma-separated slugs to change or add; the rest carry over. Absent: decided from the note |
| `fidelity` | `sketch` (default) or `prototype` |
| `format` | `html` or `ascii`; *Format* below |
| `brief` | Context for the screens — never pasted ticket text |
| `grounding` | The pack directory, relative to the project root. Default `.maister/docs/design-context` |
| `emit_index_rows` | Default `false`. When true, `finish` writes the screen and component rows to `<task_path>/analysis/design-context/INDEX.md` |
| `record` | The path of a `turn-result.json` to write. Only the `mockup-studio` workflow's node passes it |

Any other key a caller passes — `gap`, `scope_clarifications`, `design_index`, `feature_spec`,
`design_context`, `work_context` — is read as context for the screens: what they must show and what
they settle. A key naming a folder that does not exist is skipped, and a folder of source material
is read, images and PDFs included, and never changed.
**`iteration` is retired.** A caller still passing it gets the note "`iteration` is retired and was
ignored: each call is one turn", and nothing else changes.

### Format and fidelity

The format is the first of: the `format` input (or `--format`); `mockup_format` in
`.maister/config.yml`; `html`.

A prototype is HTML: `fidelity: prototype` with the `ascii` format runs as `sketch`, and the notes
say so. A prototype also needs Node, which the export runs on.

**No browser tool is not degradation.** HTML is still written. The notes then carry the no-browser
line from `<plugin root>/skills/orchestrator-framework/references/browser-tools.md` (*When there is
none*), with the step named as "the mockup look pass", and the hint that the turn opens
`versions/vNNN/index.html` in the default browser for a person at the terminal, and otherwise to
open it by hand or to run again with `--format ascii`.

---

## The turn

The steps say what each one does; the references say how.

1. **Resolve** the target root `<task_path>/<output_subdir>`, the format and the fidelity, and
   capture the clock once (`date -u +"%Y-%m-%dT%H:%M:%SZ"`). Check that Node 20 or newer runs; when
   it does not, the turn takes *The no-Node path* below instead of steps 2–6.
2. **Ground.** Run
   `node <plugin root>/skills/mockup-studio/scripts/turn.mjs ground-status --pack=<project root>/<grounding> --root=<project root>`,
   `<grounding>` the input above; the verb takes no other flag here.
   - `missing`: build the pack, as `references/grounding-pack.md` says, and use it. The note is
     "Built the grounding pack at `<path>`; commit it so later turns and machines reuse it."
     Every entry builds it — node mode, an inline call, a terminal turn — whatever the project
     or the turn looks like: a project with little or no UI yet, a sketch, a small scope or a
     throwaway comparison is no reason to skip the build. The pack then holds what the codebase
     offers, however little.
   - `stale`: use it as it is, record it stale, and add the note "The grounding pack is stale
     (<reasons>); run /maister:mockup-studio --ground to refresh it." A turn never rebuilds an
     existing pack.
   - `fresh` (also with `schema-newer` alone): use it.
   - Building was tried and failed, or `grounding-malformed`: draw from the codebase alone, with
     the degraded code `grounding-unavailable` and a null digest; for a malformed pack, the note
     says to run `--ground`. A turn that did not try to build a missing pack never records
     `grounding-unavailable`.

   Then read the pack and the standards by *The per-turn read* in `references/grounding-pack.md`,
   and add one note line naming what the screens were bound to.
3. **Begin.** `turn.mjs begin --task-path=<task_path> --subdir=<output_subdir>`, with
   `--against=<against>` when one was given. It prints the new `version`, its `version_dir`, the
   `against` it resolved, that version's `screens`, and `shell_browser`: the shell browser tool on
   this machine, found by the probes of `browser-tools.md`, or null. A refusal from `begin` is not degradation:
   no version is written, and the turn ends with the refusal's message — in node mode the node
   fails with it.
4. **Draw the screens** into the version folder.
   - Carry `against`'s screens forward unless the note or `scope` changes them: send only the
     screens that change or are new. Remove a screen only by listing its slug in `drop`.
   - A changed screen keeps its slug from `against`; a new one may leave its slug out and gets one
     from its title. Slugs are lowercase words joined by single hyphens; `index` and `prototype`
     are reserved.
   - **sketch:** write `vNNN/.turn.json` with the file tool: the note, format and fidelity,
     `against` exactly as `begin` printed it, `scope`, the grounding digest and staleness, the
     screens, `drop`, any degraded codes and the notes. Its keys are in `references/turn-contract.md`.
   - **prototype:** write `vNNN/prototype.html` by `references/prototype-page.md`, then run
     `frames.mjs export --version-dir=<version_dir>`. On success, `.turn.json` carries no screens.
     On a refusal, map it (`render-touches-dom` to the degraded code of that name, every other code
     to `render-failed`), write sketch screens drawn from the same scenes into `.turn.json`, set
     `fidelity: sketch`, delete any `.frames.json` left in the folder, and keep `prototype.html`.
   - **ascii:** dispatch the `maister:ascii-mockup-generator` agent with the Task tool, with the
     model and effort `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:ascii-mockup-generator --host=claude`
     prints just before (inside a workflow run add `--state=<run's orchestrator-state.yml>
     --node=<the node under way>`). Its `Output Target` is the absolute
     `<version_dir>/ascii-mockups.md`; pass `against`'s `ascii-mockups.md` when `against` is an
     ASCII version, the note, the scope, the context and what the pack bound. Write `.turn.json`
     from what it returns: each screen marked changed, with its slug, title and description, and
     every slug it left out in `drop`.
   - Screens are **user-facing**: one per view the note and context imply, each titled for what it
     shows ("Add allergy form", never "Dashboard"), clickable elements carrying
     `data-screen="<slug>"`, annotations for component reuse and interaction hints — never
     requirements, and never architecture, data-flow or entity diagrams. The pack's tokens are
     used by their real names, and each screen's html carries the pack's shell around its content:
     the renderer adds only the viewer's own title bar, screen tabs and container, never the
     app's header or page width. With no pack, pick a plain visual
     direction that fits the product: no cream or off-white background, italic accent words in
     headings, numbered "01/02/03" labels, monospace labels or pill buttons unless the context asks.
   - A screen the note asked for that could not be drawn adds the degraded code `incomplete`, and
     the notes name it.
5. **Look and fix** — one pass, HTML only, and only when the session has a browser tool. A
   `shell_browser` that `begin` printed is one, used through the shell, whatever the session's
   tool list shows; when it is null, the session's own browser tools decide. Without Node, run the
   two probes of `browser-tools.md` by hand first:
   - run `turn.mjs finish --preview` with the same flags as step 6, minus `--index` and `--record`;
   - look at `versions/vNNN/index.html` and each changed `versions/vNNN/<slug>.html`, opened by
     path under the per-turn viewer (`references/visual-companion.md`) when the tool is
     `shell_browser`, which refuses `file://`, so start the viewer before its first call; another
     tool opens them by `file://` when it allows it, and otherwise under the viewer too. Never the
     viewer's `/`, which still leads to the previous latest while this version is only a preview;
   - fix what looks wrong in `.turn.json`, then preview once more at most. A fix keeps the app's
     frame (its header, navigation and page width); a frame a screen drew twice loses only its
     inner copy;
   - keep the browser tool's own output out of the project, as
     `<plugin root>/skills/orchestrator-framework/references/browser-tools.md` says for the tool
     in use (*Which tool*).

   The notes record what was looked at and what was fixed, or "no browser tool: pages not looked
   at" — only when `shell_browser` is null and the session has no browser tool of its own.
6. **Finish.** `turn.mjs finish --task-path=<task_path> --subdir=<output_subdir> --version=<vNNN>`,
   with `--index=analysis/design-context/INDEX.md` when `emit_index_rows` is true and
   `--record=<record>` when `record` is set. It publishes the version, refreshes the flat view,
   writes the rows and the record, and prints the turn result with a `values` block. A refusal is
   recovered by its row in `references/turn-contract.md` and `finish` run again — except a
   `folder-unwritable` that says the version is already published, which is never finished twice.

   Publishing an `html` version also opens its gallery once, as a file in the person's default
   browser, when a person is at the terminal: no run at all, or a run with no driver or a terminal
   one. Never under a cockpit or dispatch driver. The script reads that and does this, so no step
   here or in a caller opens it again (`references/turn-contract.md`). Opening is best effort: a
   failed open changes nothing and is not degradation, and the close still names the path.
7. **Stop the viewer** if step 5 started one, and return.

### What a turn returns

The object `finish` prints, minus `ok` and `values`: `version`, `against`, `screens` and `changed`
(slug lists), `notes`, `degraded` when there is any, `format`, `fidelity`, `gallery` (the version's
`index.html` relative to `task_path`, null for ASCII), `task_path` and `output_subdir`. A caller
puts these facts in its own summary. In node mode with `record` set, the `values` block goes to the
node unchanged for its completing write.

### Degradation

A turn that cannot do everything records why on the version and still finishes it; it never
waits. The codes are a closed set:

| Code | When | What the version holds |
|---|---|---|
| `no-node` | Node is unavailable, which happens only outside an engine run | `ascii-mockups.md`, with a hand-written manifest and index entry |
| `render-touches-dom` | `frames.mjs` refused a DOM access | sketch pages from the same scenes; `prototype.html` kept; `fidelity: sketch` |
| `render-failed` | any other `frames.mjs` refusal | as above |
| `grounding-unavailable` | no usable pack, and building one was tried and failed | pages drawn from the codebase alone; a null grounding digest |
| `incomplete` | not every screen the note asked for could be drawn | the screens that were drawn |

### The no-Node path

Reachable only from a terminal inline turn or an inline call: an engine run always has Node. The
turn writes ASCII by hand, in the shapes `references/turn-contract.md` spells:

- the version is one above the highest number among the `versions/` folders and the
  `versions/index.json` entries; create its folder;
- dispatch the ASCII agent to `versions/vNNN/ascii-mockups.md`, as in step 4;
- write `vNNN/manifest.json` and append the `index.json` entry, setting `latest`;
- copy `ascii-mockups.md` to the flat `<output_subdir>/ascii-mockups.md`;
- add the degraded code `no-node` and the note "Node is unavailable: the version's bookkeeping was
  written by hand and no script checked it".

---

## Terminal entries

| Typed | What runs |
|---|---|
| `/maister:mockup-studio --turn "<note>"`, no target | Hands off to the workflow engine: invoke the `maister:workflow-engine` skill with the Skill tool, naming the workflow `builtin:mockup-studio`, with `note` and the flags below as its inputs (`--subdir` is `output_subdir`). The run gets its own task folder under `.maister/tasks/mockup-studio/`, and its node runs this skill in node mode. Relay the engine's start banner |
| `--turn "<note>" --task=<dir>`, `<dir>` a `mockup-studio` record folder (under `.maister/tasks/mockup-studio/`) | **A recorded turn N+1**: hands off to the workflow engine as the first row does, with `task_path` set to `<dir>`, `output_subdir` to `--subdir` or `analysis/mockups`, the new `note`, and `against` set to `--against` when given, else to `latest` in `<dir>/<output_subdir>/versions/index.json` (left out when there is no index yet). The run writes its own record folder, state values and `turn-result.json`, exactly as a driver's turn N+1 (*Turn N+1, and the record folder*) |
| `--turn "<note>" --task=<dir>`, `<dir>` any other workflow's task directory (development, product-design, quick-design's `design/`) | An inline turn on `<dir>/<--subdir, or analysis/mockups>/`, whether or not a version exists there (none means `v001`). No run state, no dashboard, no `turn-result.json`, no INDEX rows: the turn belongs to that workflow's own record |
| `--turn "<note>"` from inside a task directory whose `<subdir>/versions/index.json` exists | The same as `--task=<that directory>`: a recorded turn N+1 for a `mockup-studio` record folder, an inline turn for any other |
| `/maister:mockup-studio "<text>"` | Read as `--turn "<text>"` |
| `/maister:mockup-studio --ground` | Rebuilds the grounding pack from scratch, whatever its status: it clears the pack's generated files, harvests every value again from the sources and writes each file new, never by editing the old pack's files (`references/grounding-pack.md` § *Building afresh*), and touches no task folder. It closes with the digest, what was recorded, and the commit note. A workflow step that runs it (development's finalization) takes that close as its result and handles the commit itself |

The flags are `--format`, `--fidelity`, `--scope`, `--against`, `--subdir` and `--task`. Any other
flag is named as not taken, in one line, and the turn runs without it. A call with no note and no
`--ground` draws nothing: say a note is needed and show the command.

**The closing message** of a terminal turn names the version, the changed screens, the notes and
the path to `versions/vNNN/index.html` (for ASCII, `ascii-mockups.md`). It ends with the exact next
command, `/maister:mockup-studio --turn "<note>" --task=<folder>`, with `<folder>` the task folder
relative to the project root and `--subdir=<output_subdir>` added when it is not
`analysis/mockups` — because a bare second `--turn` from the project root starts a new run at
`v001`. When `<folder>` is a `mockup-studio` record folder, that command records the next turn
as a run of its own. A workflow run ends the same way, from its node's prose.

### Folder rules

- A first terminal turn's folder is the engine's `.maister/tasks/mockup-studio/<YYYY-MM-DD-slug>/`,
  the slug from the note.
- The legacy `.maister/tasks/mockups/` is a folder run readers skip. Nothing new is written there.
- The skill writes nothing outside the target folder, the INDEX file (`emit_index_rows`), the
  grounding pack (when a turn builds it, or `--ground`) and, in node mode with `record` set,
  `turn-result.json` in the run folder. A browser tool's snapshots and logs from the look pass go
  to a scratch directory, never the project.

### Turn N+1, and the record folder

- A `mockup-studio` run's record folder is `.maister/tasks/mockup-studio/<YYYY-MM-DD-slug>/`. It
  always holds `orchestrator-state.yml` and `turn-result.json`.
- With `task_path` given, the turn writes under `<task_path>/<output_subdir>/` only, which is not
  the record folder. With `task_path` absent, the target is `<record folder>/<output_subdir>/`.
- **Turn N+1** is a fresh `mockup-studio` run with the same `task_path` and `output_subdir`, the new
  `note`, and `against` set to the previous run's `values.version`, or to `latest` in
  `versions/index.json`. There is no reopen verb.
- **One record folder per turn.** Turn N+1's run gets a record folder of its own, holding its
  `orchestrator-state.yml` and `turn-result.json` and no versions; its `task_path` names the
  folder the versions live in — turn 1's record folder, when turn 1 had no `task_path`. Its
  closing command names that same folder, so every later turn stays on one version list.
- One folder therefore holds one version list however many runs wrote it, and each run's
  `values.version` and `values.against` bind that run to its version without reading the index.
  A reader lists every turn on a folder from the record folders under
  `.maister/tasks/mockup-studio/`: those whose recorded `task_path` input is that folder, plus the
  folder itself when it is a record folder with no `task_path`, ordered by `values.version`.

---

## Running the scripts

The scripts are `<plugin root>/skills/mockup-studio/scripts/turn.mjs` (`begin`, `finish`,
`ground-status`, `ground-seal`), `<plugin root>/skills/mockup-studio/scripts/frames.mjs` (`export`)
and `<plugin root>/skills/mockup-studio/server/index.mjs` (`start`, `stop`). The plugin root is
this plugin's own directory — the one holding `.claude-plugin/plugin.json`, two levels above the
base directory the loader shows for this skill. Run each script by that absolute path, never
through an environment variable a host may leave unset; a path holding a space goes in single
quotes.

Each prints one JSON object. Exit 0 is success; exit 1 is a refusal, `{ok: false, code, message}`,
whose message says what happened, what landed and what to do; exit 2 is a usage error. The scripts
return codes only: every sentence a person reads in the notes is written by this skill.

---

## Local references

| File | When to read | Purpose |
|---|---|---|
| `references/turn-contract.md` | Steps 3–6, the no-Node path, any refusal | The folder layout, `.turn.json`, every file's keys, one refusal table with recoveries |
| `references/grounding-pack.md` | Step 2, `--ground` | What the pack holds, how it is built and sealed, the per-turn read |
| `references/prototype-page.md` | Step 4, prototype fidelity | The prototype page contract and how its scenes become screens |
| `references/visual-companion.md` | Step 5, when `file://` is not available | The per-turn read-only viewer: start, stop, reuse |
