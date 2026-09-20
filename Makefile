.PHONY: build diagram validate clean watch

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

# Prerequisites: none beyond bash, find and grep. The compatibility contracts
# runner is a Pro Edition feature and does not live in this repository.
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
	@test "$$(grep -rl 'MAISTER_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" = "$$(grep -rl 'CLAUDE_PLUGIN_ROOT' plugins/maister/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" || (echo "FAIL: the emitted skills' plugin-root variable count drifted from the source tree" && exit 1)
	@echo "Checking every hooks.json command path exists on disk..."
	@for rel in $$(grep -o 'hooks/[A-Za-z0-9_.-]*\.\(sh\|mjs\)' plugins/maister/hooks/hooks.json | sort -u); do test -f "plugins/maister/$$rel" || (echo "FAIL: hooks.json names plugins/maister/$$rel, which does not exist" && exit 1); done
	@echo "Checking the open tree ships zero schemas (schema validation is now Pro-only)..."
	@test "$$(find plugins/maister -path '*/schemas/*' -name '*.json' 2>/dev/null | wc -l | tr -d ' ')" -eq 0 || (echo "FAIL: a schema file is still shipped in the open tree" && exit 1)
	@echo "Checking the generated variant is byte-identical to a fresh build..."
	@# Compares the working tree against the index (not HEAD): a build that
	@# ran but was never `git add`ed is exactly the staleness this catches,
	@# without demanding the cut already be committed to run this check.
	@test -z "$$(git diff --stat -- plugins/maister-copilot/ 2>/dev/null)" || (echo "FAIL: plugins/maister-copilot/ differs from a fresh make build — run make build and git add the result" && git diff --stat -- plugins/maister-copilot/ && exit 1)
	@echo "Checking the hooks take no Python dependency..."
	@# plugins/maister-copilot/.github/hooks/ is a Pro Edition feature (docs/decisions/0007)
	@# and the free build no longer emits it, so it dropped out of this grep.
	@! grep -rn 'python3' plugins/maister/hooks/ 2>/dev/null || (echo "FAIL: a hook reaches for python3" && exit 1)
	@echo "All checks passed"

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
