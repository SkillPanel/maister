# Project guidance

## Maister workflow

- Read `.maister/docs/INDEX.md` before planning or changing code, then read the standards relevant to the affected area.
- Use `$maister-codex:maister-quick-dev` for clear, small changes and `$maister-codex:maister-development` for features, multi-file work, or unclear requirements.
- Run the narrowest relevant checks during implementation and the project’s required checks before completion.
- At a required user decision gate, prefer `request_user_input` when available; otherwise ask the equivalent concise question in the final response and pause.
- Preserve unrelated changes. Never reset, discard, or roll back work without explicit user approval.

## Code review

- Review behavior, security, regressions, tests, and standards compliance before style-only preferences.
- Keep generated files generated; change their source instead.
