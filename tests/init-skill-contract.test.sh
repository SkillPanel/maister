#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
SKILLS=(
	"$ROOT/plugins/maister/skills/init/SKILL.md"
	"$ROOT/plugins/maister/overlays/cursor/assets/skills/maister-init/SKILL.md"
)

for skill in "${SKILLS[@]}"; do
	test -f "$skill"
	grep -F 'Advisor intent (resolve only — no writes yet)' "$skill" >/dev/null
	grep -F 'Cancel**, write nothing' "$skill" >/dev/null
	grep -F 'Repair partial initialization' "$skill" >/dev/null
	grep -F 'pre-run Git index' "$skill" >/dev/null
	grep -F 'bin/maister-init-runtime.mjs' "$skill" >/dev/null
	grep -F 'bin/init-advisor-gate.mjs' "$skill" >/dev/null
	grep -F "configured\`; report \`invoked\` only" "$skill" >/dev/null
	grep -F 'phase-exit: manual' "$skill" >/dev/null
	grep -F 'verify-matrix: manual' "$skill" >/dev/null
	if grep -F 'gate_policies: {}' "$skill" >/dev/null; then
		exit 1
	fi
	if grep -F 'Run standards discovery with --scope=full' "$skill" >/dev/null; then
		exit 1
	fi
done

printf 'init skill contract passed (%s skills)\n' "${#SKILLS[@]}"
