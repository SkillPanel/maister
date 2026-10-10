# Engine verb tests

`make test` runs `node --test tests/engine/*.test.mjs` — Node 20 or newer, nothing installed.

Each test drives `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` the way a workflow
driver does: one verb per child process, the patch or request as JSON on stdin (`patch-file.test.mjs`
holds the patch-file route to the same results), and assertions on
the exit code, stdout, stderr and the files left behind. `umbrella-input-file.test.mjs` does the same
for the umbrella runtime's `envelope`, `ledger` and `outbox` through `--input-file`, in a workspace it
scaffolds with `init`. Only the dashboard normalizers
(`issueOf`, `artifactOf`, `decisionOf`, `deriveProgress`) are imported directly.

- `helpers.mjs` — the scratch project (`<tmp>/.maister/tasks/<type>/<name>/`), the verb runner, the freeze.
- `fixtures/definitions/` — a small definition covering a direct node, a gate, the plan executor and a
  `workflow:` sub-run node, plus one the validator rejects. `closing.yml`, its sub-run child
  `closing-child.yml` and `closing.overlay.yml` carry the guards, `on:` edges and declared artifacts
  the `run-complete` checks judge. `recovery.yml` holds an `on: failure` node on the happy path.
  `declared-outputs.yml` is a workflow of its own name whose nodes declare typed values, a file and
  a directory artifact, a three-option gate and the artifacts of a sub-run.
- `fixtures/custom-workflow/` — a workflow no built-in is named after, as a user authors it into their
  project's `.maister/workflows/`: `release-audit.yml` (a fan-out, a guard, a gate of its own, a sub-run,
  a file and a directory artifact, an `on: failure` node), its child `audit-child.yml`, and
  `hardening.overlay.yml` (an added node placed with `before:`, `tune.with` and a profile).
  `custom-workflow.test.mjs` copies them into a scratch project and drives them through every verb.
- `resolution.test.mjs` builds its project, config dir and home directory at test time, so no
  `.claude/` or `.github/` tree is committed and the operator's own `~/.claude` and `~/.copilot` are
  never read.
- `fixtures/runs/` — run directories copied into a scratch project per test: a plan with its companion
  and work log, a pending gate request, a state whose workflow block no freeze proves (`unproven/`), and three task directories
  written by 2.x (`prose-2x/`, `prose-2x-research/`, `prose-2x-product-design/`) that `resume-check` refuses, and
  `free-delivery-threshold/`, a real development run: its state as it recorded it (the definition
  source made repository-relative) as `recorded-state.yml`, beside every file it wrote, emptied.
  `run-complete.test.mjs` freezes the shipped `development.yml` afresh and replays the recorded
  outcomes and summaries onto it, with and without the absences its nodes sanction.
  `team-calendar-sharing/` is a synthetic product-design run of the same shape — an invented
  enhancement with a UI, so its personas are skipped and its screens drawn — which
  `product-design.test.mjs` replays onto the shipped `product-design.yml` beside partial runs it
  walks to each of that workflow's gates. Its `outputs/delivery-scope.yml` is kept whole: it is the
  single-repository scope, read beside `fixtures/delivery-scope/workspace.yml`, a workspace's.
- `fixtures/gates/` — answered request documents a test copies over the pending one. `question-set.request.yml`
  is a `kind: question` request as `gate-brief --request` builds it from a three-question set (a
  single choice, one with nothing recommended, a multi-select), with the fields the request writer
  adds; `question-set.answer.yml` and `question-set.other.answer.yml` are answer files for it — an
  id, a list, and an answer in the operator's own words, whose first question answered that way
  sends `option: other`. `in-step-questions.test.mjs` asserts the
  request against the verb's output and folds both answers, so a cockpit can render from them.
- `fixtures/decision-areas/` — decision areas as the solution brainstormer writes them, read by
  `area-brief.test.mjs`. `valid.json` is stamped with the SHA-256 of `source.md` beside it, and holds
  an area with more than three alternatives, one with no recommendation, and areas that depend on
  earlier ones. Every other `<reason>.json` is refused for that one reason, the file named after it
  (`not-json.json`, `unknown-key.json`, `depends-order.json`, …), sixteen in all. `golden/` pins what
  `area-brief` renders from `valid.json`: the picker in the `rich` profile (`picker.rich.json`, and
  `picker.rich.open.json` for the area left open), the labels-only picker (`picker.plain.json`), the
  full write-up (`write-up.md`) and the question set a cockpit is sent (`set.json`), each with the
  scratch path masked. `SNAPSHOT_AREAS=1 node --test tests/engine/area-brief.test.mjs` rewrites the
  goldens after a reviewed change to what an area question says.

Committed fixtures are never written to. State that depends on a definition's graph hash is produced by
freezing at test time, so editing a built-in does not stale a fixture.

## The shell smoke

`make smoke` runs `node tests/shell-smoke.mjs --shell=bash`. Where the suite spawns `node` with an
argv array, the smoke hands every engine call to a shell as one command line in the invocation
contract's form, from a plugin copy and a project whose paths both hold a space: `locate`,
`validate`, `resolve`, the freeze, two node writes, `gate-brief --json`, the dashboard projection and
`resume-check`. It then starts each hook from its `hooks.json` entry, as the host does, with sample
input. `--shell` takes `bash`, `zsh`, `pwsh`, `powershell` or `cmd`; cmd.exe lines quote with `"`,
every other shell's with `'`. CI runs it under bash on Ubuntu, and under pwsh, Windows PowerShell,
cmd.exe and Git Bash on Windows, where the paths are written with `\`.
