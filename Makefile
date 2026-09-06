.PHONY: build validate validate-codex clean watch

build:
	bash platforms/copilot-cli/build.sh

validate:
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking no multi-select references..."
	@! grep -ri 'multi.select\|multiSelect' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: multi-select found in skills" && exit 1)
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/maister-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no maister: prefixes in copilot variant..."
	@! grep -r 'maister:' plugins/maister-copilot/ --include="*.md" 2>/dev/null || (echo "FAIL: maister: prefix found" && exit 1)
	@echo "All checks passed"
	@$(MAKE) validate-codex

validate-codex:
	@echo "Checking codex plugin manifest parses..."
	@node -e "JSON.parse(require('fs').readFileSync('plugins/maister-codex/.codex-plugin/plugin.json','utf8'))" || (echo "FAIL: invalid plugin.json" && exit 1)
	@echo "Checking codex hooks config parses..."
	@node -e "JSON.parse(require('fs').readFileSync('plugins/maister-codex/hooks/hooks.json','utf8'))" || (echo "FAIL: invalid hooks.json" && exit 1)
	@echo "Checking codex hook scripts..."
	@for f in plugins/maister-codex/hooks/*.mjs; do node --check "$$f" || exit 1; done
	@echo "Checking no Claude-only artifacts in codex skills..."
	@! grep -rE 'AskUserQuestion|TaskCreate|TaskUpdate|SlashCommand|Skill tool|Task tool|CLAUDE_PLUGIN_ROOT|CLAUDE\.md|/maister:' plugins/maister-codex/skills/ 2>/dev/null || (echo "FAIL: Claude-only artifact found in codex skills" && exit 1)
	@echo "Checking codex SKILL.md names match directories..."
	@for d in plugins/maister-codex/skills/*/; do n=$$(basename $$d); grep -q "^name: $$n$$" "$$d/SKILL.md" || { echo "FAIL: $$d frontmatter name != $$n"; exit 1; }; done
	@echo "Checking codex agent template names match filenames..."
	@for f in plugins/maister-codex/skills/maister-init/assets/agents/*.toml; do b=$$(basename $$f .toml); grep -q "^name = \"$$b\"$$" "$$f" || { echo "FAIL: $$f name != $$b"; exit 1; }; done
	@echo "Checking codex-native marketplace manifest parses..."
	@node -e "const m=JSON.parse(require('fs').readFileSync('.agents/plugins/marketplace.json','utf8')); if(!m.plugins.some(p=>p.name==='maister-codex')) throw new Error('maister-codex missing')" || (echo "FAIL: invalid .agents/plugins/marketplace.json" && exit 1)
	@node scripts/sync-codex-hooks.mjs
	@python3 scripts/validate-codex.py
	@python3 -B -m unittest discover -s tests -p 'test_*.py'
	@node --test tests/*.test.mjs
	@echo "Codex checks passed"

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
