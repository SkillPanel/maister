# Engine verb tests

`make test` runs `node --test tests/engine/*.test.mjs` — Node 20 or newer, nothing installed.

Each test drives `plugins/maister/skills/workflow-engine/scripts/workflow.mjs` the way a workflow
driver does: one verb per child process, the patch or request as JSON on stdin, and assertions on
the exit code, stdout, stderr and the files left behind. Only the dashboard normalizers
(`issueOf`, `artifactOf`, `decisionOf`, `deriveProgress`) and the gate hook's command recogniser
(`engineInvocation`, in `gate-hook.test.mjs`) are imported directly.

- `helpers.mjs` — the scratch project (`<tmp>/.maister/tasks/<type>/<name>/`), the verb runner, the freeze.
- `fixtures/definitions/` — a small definition covering a direct node, a gate, the plan executor and a
  `workflow:` sub-run node, plus one the validator rejects, and one of its own name whose nodes declare
  typed values, a file and a directory artifact, a three-option gate and the artifacts of a sub-run.
- `fixtures/runs/` — run directories copied into a scratch project per test: a plan with its companion
  and work log, a pending gate request, a state file written by a prose orchestrator.
- `fixtures/gates/` — answered request documents a test copies over the pending one.

Committed fixtures are never written to. State that depends on a definition's graph hash is produced by
freezing at test time, so editing a built-in does not stale a fixture.
