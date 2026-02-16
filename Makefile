.PHONY: build validate clean watch

build:
	bash platforms/copilot-cli/build.sh

validate:
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' plugins/ai-sdlc-copilot/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking no multi-select references..."
	@! grep -ri 'multi.select\|multiSelect' plugins/ai-sdlc-copilot/skills/ 2>/dev/null || (echo "FAIL: multi-select found in skills" && exit 1)
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/ai-sdlc-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/ai-sdlc-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no ai-sdlc: subagent prefixes..."
	@! grep -r 'ai-sdlc:' plugins/ai-sdlc-copilot/ --include="*.md" 2>/dev/null || (echo "FAIL: ai-sdlc: prefix found" && exit 1)
	@echo "All checks passed"

clean:
	rm -rf plugins/ai-sdlc-copilot/

watch:
	fswatch -o plugins/ai-sdlc/ | xargs -n1 -I{} make build
