.PHONY: build diagram validate test eval tarball clean watch

build:
	bash platforms/copilot-cli/build.sh

# Regenerate every shipped workflow diagram. The suite byte-compares each one
# against its definition, so run this after editing a definition and commit both
# together. Definition-agnostic on purpose: a definition added to workflows/ is
# picked up here without an edit, the way the suite picks it up without one.
ENGINE = plugins/maister/skills/workflow-engine
diagram:
	@for definition in $(ENGINE)/workflows/*.yml; do \
	  node $(ENGINE)/scripts/workflow.mjs diagram \
	    --definition $$definition \
	    --out $${definition%.yml}.mmd || exit 1; \
	done

# Prerequisites: node (the contracts runner). Everything else here is grep.
validate:
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking no multi-select references..."
	@! grep -rE 'multi-select|multiselect|multiSelect' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: multi-select found in skills" && exit 1)
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/maister-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no maister: prefixes in copilot variant..."
	@! grep -r 'maister:' plugins/maister-copilot/ --include="*.md" --include="*.json" --include="*.mjs" --include="*.yml" 2>/dev/null || (echo "FAIL: maister: prefix found" && exit 1)
	@echo "Checking gate markers are not nested inside code spans..."
	@! grep -rnF '`→ **MANDATORY GATE** — fires ' plugins/maister/skills/ 2>/dev/null || (echo "FAIL: gate marker nested inside a code span" && exit 1)
	@! grep -nF '→ Pause' plugins/maister/skills/orchestrator-framework/references/orchestrator-creation-checklist.md 2>/dev/null || (echo "FAIL: superseded transition marker in the orchestrator checklist" && exit 1)
	@echo "Checking the plugin-root variable is renamed for this CLI's vocabulary..."
	@! grep -rn 'CLAUDE_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a Claude-only plugin-root variable survives in the emitted skills" && exit 1)
	@test $$(grep -rl 'MAISTER_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null | wc -l) -ge 5 || (echo "FAIL: the emitted skills name no plugin-root variable" && exit 1)
	@echo "Checking the generated schemas and the hook registrations..."
	@node scripts/verify-contracts.mjs --only=T01,T24
	@echo "Checking the hooks take no Python dependency..."
	@! grep -rn 'python3' plugins/maister/hooks/ plugins/maister-copilot/.github/hooks/ 2>/dev/null || (echo "FAIL: a hook reaches for python3" && exit 1)
	@echo "All checks passed"

test:
	node scripts/verify-contracts.mjs

# Local only, never CI: spawns authenticated provider CLIs and spends money.
# Pass flags through EVAL_ARGS, e.g. make eval EVAL_ARGS="--provider=both --scenario=all"
eval:
	node scripts/eval-gates.mjs $(EVAL_ARGS)

# Contract release archive. The tag names the staging dir and the artefacts:
# make tarball TAG=contracts-v1 -> dist/contracts-v1/, dist/contracts-v1.tar.gz(+.sha256)
TAG ?= contracts-dev
tarball:
	node scripts/build-tarball.mjs --tag=$(TAG)

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
