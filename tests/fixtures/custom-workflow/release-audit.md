# Release audit workflow — node prose

## `intake`

Write `intake/brief.md` and record `needs_security` and `risk_level`.

## `license-scan`

Check every dependency's licence against the allow-list.

## `dependency-scan`

List the dependencies with a known advisory.

## `security-scan`

Scan the release for secrets and unsafe defaults.

## `report`

Write `outputs/audit-summary.md` and the `outputs/evidence` directory.

## `rollback-notes`

Write down how to pull the release back, because the report failed.
