# Engine verb tests

`make test` runs `node --test tests/engine/*.test.mjs` — Node 20 or newer, nothing installed.

Each test drives `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` the way a workflow
driver does: one verb per child process, the patch or request as JSON on stdin, and assertions on
the exit code, stdout, stderr and the files left behind. Only the dashboard normalizers
(`issueOf`, `artifactOf`, `decisionOf`, `deriveProgress`) and the gate hook's command recogniser
(`engineInvocation`, in `gate-hook.test.mjs`) are imported directly.

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
  and work log, a pending gate request, a state file written by a prose orchestrator, and two task directories
  written by 2.x (`prose-2x/`, `prose-2x-research/`) that `resume-check` refuses.
- `fixtures/gates/` — answered request documents a test copies over the pending one.

Committed fixtures are never written to. State that depends on a definition's graph hash is produced by
freezing at test time, so editing a built-in does not stale a fixture.
