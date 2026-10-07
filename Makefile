.PHONY: build diagram validate test test-mod smoke clean watch

build:
	bash platforms/copilot-cli/build.sh

# Regenerate every shipped workflow diagram. `make validate` byte-compares each
# one against a fresh regeneration, so run this after editing a definition and
# commit both together. Definition-agnostic on purpose: a definition added to
# workflows/ is picked up here without an edit, the way validate picks it up
# without one.
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
	@echo "Checking the question picker is rendered plain in the variant..."
	@! grep -rnE 'rich-picker|plain-picker|--picker=rich' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a rich-picker passage or the rich gate-brief profile survives in the variant" && exit 1)
	@echo "Checking every rich-picker and plain-picker passage in the source is closed..."
	@for f in $$(grep -rlE 'rich-picker|plain-picker' plugins/maister/skills/ --include="*.md"); do \
	  awk -v f="$$f" '/^[[:space:]]*<!-- rich-picker -->[[:space:]]*$$/ { if (open) bad = 1; open = "rich"; next } \
	    /^[[:space:]]*<!-- \/rich-picker -->[[:space:]]*$$/ { if (open != "rich") bad = 1; open = ""; next } \
	    /^[[:space:]]*<!-- plain-picker[[:space:]]*$$/ { if (open) bad = 1; open = "plain"; next } \
	    open == "plain" && /^[[:space:]]*-->[[:space:]]*$$/ { open = ""; next } \
	    /rich-picker|plain-picker/ { bad = 1 } \
	    END { if (open || bad) { print "FAIL: " f " has an unclosed or inline picker marker"; exit 1 } }' "$$f" || exit 1; \
	done
	@echo "Checking every display title, option label and header reads as plain text in sentence case..."
	@awk 'FNR == 1 { d = 0 } \
	  /^display:[[:space:]]*$$/ { d = 1; next } \
	  d && /^[^[:space:]#]/ { d = 0 } \
	  !d { next } \
	  /^  [a-z_]+:[[:space:]]*$$/ { sec = $$1; sub(/:$$/, "", sec); next } \
	  sec != "titles" && sec != "option_labels" && sec != "headers" { next } \
	  /^[[:space:]]+[A-Za-z0-9_-]+:[[:space:]]+[^[:space:]]/ { \
	    v = $$0; sub(/^[[:space:]]+[A-Za-z0-9_-]+:[[:space:]]+/, "", v); sub(/[[:space:]]+#.*$$/, "", v); \
	    if (v ~ /^".*"$$/) v = substr(v, 2, length(v) - 2); \
	    why = ""; \
	    if (v ~ /[*`]/) why = "markdown, which a plain picker shows as typed"; \
	    else if (v ~ /[?:.]$$/) why = "trailing punctuation, which a form title doubles"; \
	    else if (v ~ /(^|[[:space:]])Spec([[:space:]]|$$)/ && sec != "headers") why = "an abbreviation; spell it out"; \
	    else { n = split(v, w, /[[:space:]]+/); for (i = 2; i <= n; i++) if (w[i] ~ /^[A-Z][a-z]/) why = "title case at \"" w[i] "\"; write sentence case"; } \
	    if (why != "") { print "FAIL: " FILENAME ": " sec ": \"" v "\" has " why; bad = 1 } \
	  } \
	  END { exit bad }' plugins/maister/skills/workflow-engine/workflows/*.yml
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find plugins/maister-copilot/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking every Copilot agent has a tool allowlist without the agent tool, and the no-re-entry sentence..."
	@for f in plugins/maister-copilot/agents/*.md; do \
	  t=$$(awk 'NR==1 && $$0=="---"{fm=1; next} fm && $$0=="---"{exit} fm && /^tools:/{print}' "$$f"); \
	  test -n "$$t" || { echo "FAIL: $$f has no tools: allowlist, so it can dispatch agents"; exit 1; }; \
	  ! echo "$$t" | grep -qE '"(agent|task|Task|custom-agent|\*)"' || { echo "FAIL: $$f grants a dispatch tool: $$t"; exit 1; }; \
	  grep -q '^\*\*You are a dispatched agent: do this task' "$$f" || { echo "FAIL: $$f lacks the no-re-entry sentence"; exit 1; }; \
	done
	@echo "Checking no CLAUDE.md references in skills..."
	@! grep -ri 'CLAUDE\.md' plugins/maister-copilot/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' plugins/maister-copilot/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no maister: prefixes in copilot variant..."
	@! grep -r 'maister:' plugins/maister-copilot/ --include="*.md" --include="*.json" --include="*.mjs" --include="*.yml" 2>/dev/null || (echo "FAIL: maister: prefix found" && exit 1)
	@echo "Checking no maister-<name> form survives (Copilot registers neither)..."
	@names=$$( { ls plugins/maister-copilot/commands plugins/maister-copilot/agents | sed -n 's/\.md$$//p'; ls plugins/maister-copilot/skills; } | sort -u | paste -sd'|' -); \
	! grep -rnE "maister-($$names)([^A-Za-z0-9_-]|$$)" plugins/maister-copilot/ --include="*.md" || (echo "FAIL: a maister-<name> reference survives; Copilot resolves /maister-copilot:<name>, a bare skill name or maister-copilot:<agent>" && exit 1)
	@echo "Checking every /maister-copilot:<name> names a command or skill..."
	@for n in $$(grep -rhoE '/maister-copilot:[A-Za-z0-9_-]+.?' plugins/maister-copilot/ --include="*.md" | grep -v ':$$' | sed -E 's#^/maister-copilot:([A-Za-z0-9_-]+).*#\1#' | sort -u); do \
	  test -f "plugins/maister-copilot/commands/$$n.md" || test -f "plugins/maister-copilot/skills/$$n/SKILL.md" || { echo "FAIL: /maister-copilot:$$n names no command or skill"; exit 1; }; \
	done
	@echo "Checking every maister-copilot:<agent> names an agent..."
	@for n in $$(grep -rhoE '(^|[^/A-Za-z0-9_-])maister-copilot:[A-Za-z0-9_-]+' plugins/maister-copilot/ --include="*.md" | sed -E 's#.*maister-copilot:##' | sort -u); do \
	  test -f "plugins/maister-copilot/agents/$$n.md" || { echo "FAIL: maister-copilot:$$n names no agent"; exit 1; }; \
	done
	@echo "Checking gate markers are not nested inside code spans..."
	@! grep -rnF '`→ **MANDATORY GATE** — fires ' plugins/maister/skills/ 2>/dev/null || (echo "FAIL: gate marker nested inside a code span" && exit 1)
	@! grep -nF '→ Pause' plugins/maister/skills/orchestrator-framework/references/orchestrator-creation-checklist.md 2>/dev/null || (echo "FAIL: superseded transition marker in the orchestrator checklist" && exit 1)
	@echo "Checking the plugin-root variable is renamed for this CLI's vocabulary..."
	@! grep -rn 'CLAUDE_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a Claude-only plugin-root variable survives in the emitted skills" && exit 1)
	@test "$$(grep -rl 'MAISTER_PLUGIN_ROOT' plugins/maister-copilot/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" = "$$(grep -rl 'CLAUDE_PLUGIN_ROOT' plugins/maister/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" || (echo "FAIL: the emitted skills' plugin-root variable count drifted from the source tree" && exit 1)
	@echo "Checking every hooks.json command path exists on disk..."
	@for rel in $$(grep -o 'hooks/[A-Za-z0-9_.-]*\.\(sh\|mjs\)' plugins/maister/hooks/hooks.json | sort -u); do test -f "plugins/maister/$$rel" || { echo "FAIL: hooks.json names plugins/maister/$$rel, which does not exist"; exit 1; }; done
	@for rel in $$(grep -o '"\./[A-Za-z0-9_.-]*\.mjs"' plugins/maister/hooks/hooks.json | tr -d '"' | sort -u); do test -f "plugins/maister/hooks/$$rel" || { echo "FAIL: hooks.json lists the module plugins/maister/hooks/$$rel, which does not exist"; exit 1; }; done
	@types=$$(sed -n 's/.*"types": *"\.\/\([^"]*\)".*/\1/p' plugins/maister/.claude-plugin/plugin.json); test -z "$$types" || test -f "plugins/maister/$$types" || { echo "FAIL: plugin.json names the contract plugins/maister/$$types, which does not exist"; exit 1; }
	@echo "Checking shipped files cite only shipped files, never this repository's docs/..."
	@# The list is read from docs/ itself, so a document added there is covered
	@# without an edit. A consumer project's own docs/ and .maister/docs/ are
	@# legitimate subjects of shipped prose and are not matched.
	@docs=$$(ls docs | sed -n 's/\.md$$//p' | paste -sd'|' -); \
	! grep -rnE "docs/(($$docs)\.md|decisions/([0-9]|README))" plugins/maister/ | grep -v '\.maister/docs/' \
	  || (echo "FAIL: a shipped file cites this repository's docs/, which a plugin install does not include" && exit 1)
	@echo "Checking every shipped workflow diagram matches a fresh regeneration..."
	@tmp=$$(mktemp); \
	for definition in $(ENGINE)/workflows/*.yml; do \
	  node $(ENGINE)/scripts/workflow.mjs diagram --definition $$definition > $$tmp \
	    || { rm -f $$tmp; echo "FAIL: the diagram renderer exited non-zero on $$definition — the diagram is not stale, the renderer is broken; running make diagram would fail the same way"; exit 1; }; \
	  diff -q $$tmp $${definition%.yml}.mmd >/dev/null || { rm -f $$tmp; echo "FAIL: $${definition%.yml}.mmd is stale — run make diagram"; exit 1; }; \
	done; \
	rm -f $$tmp
	@echo "Checking the plugin ships no JSON schema files..."
	@test "$$(find plugins/maister -path '*/schemas/*' -name '*.json' 2>/dev/null | wc -l | tr -d ' ')" -eq 0 || (echo "FAIL: a schema file is shipped under plugins/maister/" && exit 1)
	@echo "Checking the generated variant is byte-identical to a fresh build..."
	@# Compares the working tree against the index (not HEAD): a build that
	@# ran but was never `git add`ed is exactly the staleness this catches,
	@# without demanding the cut already be committed to run this check.
	@test -z "$$(git diff --stat -- plugins/maister-copilot/ 2>/dev/null)" || (echo "FAIL: plugins/maister-copilot/ differs from a fresh make build — run make build and git add the result" && git diff --stat -- plugins/maister-copilot/ && exit 1)
	@echo "Checking the hooks take no Python dependency..."
	@! grep -rn 'python3' plugins/maister/hooks/ 2>/dev/null || (echo "FAIL: a hook reaches for python3" && exit 1)
	@echo "All checks passed"

# The engine verb suite: every verb run as a driver runs it, against committed
# fixtures copied into a scratch directory per test. Prerequisites: node >= 20,
# nothing installed. The glob is expanded by the shell because Node 20's
# --test takes no glob of its own.
test:
	node --test tests/engine/*.test.mjs

# The engine verbs and the hooks run through a shell, from paths holding a
# space. CI runs the same script under pwsh, Windows PowerShell, cmd.exe and
# Git Bash on Windows.
smoke:
	node tests/shell-smoke.mjs --shell=bash

# The hooks module's checks, by the Claude Code CLI: `claude plugin validate`
# over the plugin, then the module's tests under tests/mod/, which `claude
# plugin test` runs against a scratch copy of the plugin's manifest, hooks and
# state contract, since tests never ship under plugins/. Skipped where the CLI
# is not installed, which is why `make test` does not depend on it.
test-mod:
	@command -v claude >/dev/null 2>&1 || { echo "skipped: the claude CLI is not on PATH"; exit 0; }; \
	claude plugin validate plugins/maister || exit 1; \
	tmp=$$(mktemp -d); \
	cp -R plugins/maister/.claude-plugin plugins/maister/hooks plugins/maister/types "$$tmp"/ \
	  && mkdir "$$tmp/tests" && cp tests/mod/*.test.ts "$$tmp/tests/" \
	  && claude plugin test "$$tmp"; status=$$?; \
	rm -r "$$tmp"; exit $$status

clean:
	rm -rf plugins/maister-copilot/

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
