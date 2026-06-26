.PHONY: build validate clean watch opencode opencode-build opencode-validate opencode-clean

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

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build

opencode-build:
	bash platforms/opencode/build.sh

opencode-validate:
	@test -d platforms/opencode/output || (echo "FAIL: Run make opencode-build first" && exit 1)
	@echo "Checking no AskUserQuestion in output..."
	@! grep -r 'AskUserQuestion' platforms/opencode/output/ 2>/dev/null || (echo "FAIL: AskUserQuestion found in output" && exit 1)
	@echo "Checking no TaskCreate or TaskUpdate in output..."
	@! grep -r 'TaskCreate\|TaskUpdate' platforms/opencode/output/ 2>/dev/null || (echo "FAIL: TaskCreate or TaskUpdate found in output" && exit 1)
	@echo "Checking no Skill(name= in output..."
	@! grep -r 'Skill(name=' platforms/opencode/output/ 2>/dev/null || (echo "FAIL: Skill(name= found in output" && exit 1)
	@echo "Checking no maister: prefix in output..."
	@! (grep -r 'maister:' platforms/opencode/output/ --include="*.md" --include="*.json" 2>/dev/null | grep -v '\[orchestrator-name\]' | grep -v 'skill: "maister-') || (echo "FAIL: maister: prefix found in output" && exit 1)
	@echo "Checking no CLAUDE.md references in output..."
	@! grep -ri 'CLAUDE\.md' platforms/opencode/output/ 2>/dev/null || (echo "FAIL: CLAUDE.md reference found in output" && exit 1)
	@echo "Checking agent-fragment.json is valid JSON..."
	@jq . platforms/opencode/output/agent-fragment.json > /dev/null || (echo "FAIL: agent-fragment.json is not valid JSON" && exit 1)
	@echo "Checking mcp-fragment.json is valid JSON..."
	@jq . platforms/opencode/output/mcp-fragment.json > /dev/null || (echo "FAIL: mcp-fragment.json is not valid JSON" && exit 1)
	@echo "Checking minimum 8 commands present..."
	@test $$(ls platforms/opencode/output/commands/ 2>/dev/null | wc -l) -ge 8 || (echo "FAIL: Minimum 8 commands not found" && exit 1)
	@echo "Checking minimum 20 agents present..."
	@test $$(ls platforms/opencode/output/agents/ 2>/dev/null | wc -l) -ge 20 || (echo "FAIL: Minimum 20 agents not found" && exit 1)
	@echo "Checking minimum 14 instruction files present..."
	@test $$(ls platforms/opencode/output/instructions/maister-*.md 2>/dev/null | wc -l) -ge 14 || (echo "FAIL: Minimum 14 instruction files not found" && exit 1)
	@echo "All checks passed"

opencode-clean:
	rm -rf platforms/opencode/output/

opencode: opencode-build opencode-validate
