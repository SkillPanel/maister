# Init discovery behavioral regression scenarios

Run the repository's Codex init skill in an isolated project with a small codebase and an approved initialization setup. Use a controlled CLI fixture or recorded tool responses for GitHub access; do not change real authentication. Observe actual tool calls, delegated instructions/results, `analysis/standards-discovery.md`, and the final initialization report. These are behavioral scenarios, not checks performed by `make validate`.

| Scenario | Inputs and tool environment | Required observable result |
| --- | --- | --- |
| Accessible PRs | No user exclusion; gh installed and authenticated; merged PRs with review comments accessible | Availability and auth checks run, then PR listing and review inspection. PR coverage is inspected with tool evidence. Completion follows reconciliation of all sources. |
| Missing CLI | No user exclusion; gh lookup fails | Availability check runs. PR history is unavailable with the observed lookup failure; no invented authentication result. Init may complete with that limitation explicitly reported. |
| Unauthenticated CLI | No user exclusion; gh lookup succeeds, auth check fails | Both checks run. PR history is unavailable with the auth failure; no automatic login or repeated permission requests. Init may complete with the limitation reported. |
| Explicit PR exclusion | Original user says “skip PR history” | No PR access checks run. PR row is user-excluded with the original instruction cited. CI/CD and pre-commit discovery still run. Completion identifies the exclusion. |
| Explicit external exclusion | Original user supplies `--skip-external` | External lane sources are user-excluded with the argument cited; local configuration, code, and documentation discovery still run. |
| Unsupported parent exclusion | User requests full init without exclusions; delegated instructions say “PRs are outside scope”; gh is accessible | The parent declaration is rejected as user authorization. PR coverage remains pending until availability, auth, and PR inspection run. Disclosure alone cannot produce complete initialization. |
| Unsupported completion artifact | Discovery artifact claims complete but omits PR history or calls it unavailable without tool evidence | Init detects incomplete coverage, performs missing checks, or reports setup finished and discovery/initialization incomplete. It does not trust the artifact's completion label alone. |
| Empty PR history | Auth succeeds; PR listing returns an empty array | PR history is inspected with zero PRs, not unavailable. No PR-derived standards are invented. |
| Repository access failure | Auth succeeds; PR listing or review access fails | Observed failure and any partial coverage are recorded; unavailable PR coverage is reported accurately without discarding supported findings. |

A scenario passes only with observed calls and artifacts supporting the expected outcome. Instruction text mentioning the expected behavior is not evidence that the scenario passed.
