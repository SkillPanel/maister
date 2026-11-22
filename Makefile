.PHONY: build diagram reference validate test test-mod smoke clean watch

# No target opens a browser: the engine opens a run's dashboard at the freeze and
# at a resume check unless this is set, and every recipe's engine call inherits it.
export MAISTER_NO_OPEN = 1

# Where the Copilot CLI build goes. Ignored by git, rebuilt by `build` and by
# `validate`; it may be any folder, absolute or relative
# (`make validate VARIANT=/some/scratch/folder`).
VARIANT ?= dist/copilot

# The interface file first: build.sh copies the source tree into $(VARIANT),
# then regenerates the variant's own from what it built.
build:
	@out="$$(node tools/interface.mjs --root plugins/maister)" && test -n "$$out" || { echo "build: plugins/maister/interface.json was not written; the interface generator did not run" >&2; exit 1; }; echo "$$out"
	bash platforms/copilot-cli/build.sh --out "$(VARIANT)"

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

# Regenerate docs/workflow-reference.md, the generated page that lists each
# built-in's inputs, steps, checkpoints and declared outputs. `make validate`
# byte-compares it against a fresh generation, so run this after editing a
# definition and commit both together, as with `make diagram`.
reference:
	@node tools/workflow-reference.mjs

# The containment sentence every source agent carries, as validate checks it.
# It holds no apostrophe, so the recipe can single-quote it.
CONTAINMENT = **You are a dispatched agent: do the work of this task yourself.** Never start another workflow, a command or an orchestrator skill — not a `reviews-*` command, which would dispatch you again, and not `work`, `development` or any other workflow — even when its description matches your task. Load only a skill your own instructions name.
# The scratch-file sentence, the same way: no apostrophe, and each $ doubled for make.
SCRATCH = **Scratch files go in the system temp directory.** Read the output of a command as it prints rather than redirecting it to a file. When a file is unavoidable — a long log, an export, a copy — make its directory with `mktemp -d` (it uses `$$TMPDIR`) or put it under `"$${TMPDIR:-/tmp}"`, never at a literal `/tmp` path, which can stop the run for a permission prompt, and delete it when done.
# The search-scope sentence, the same way: no apostrophe and no $.
SEARCH = **Search only inside the project.** Never search, list or glob outside the project and the paths your prompt names, for anything — not a parent directory, the home directory, a plugin cache or the settings of another tool. Read a plugin file at the absolute path your prompt gives, or at its place under the plugin root your instructions name; when it is not there, say so in your result instead of looking for a copy elsewhere: a copy may belong to another version, and the search can stop the run for a permission prompt.

# Prerequisites: bash, find, grep and node (the diagram check and the guide
# template lint). The compatibility contracts runner is a Pro Edition feature
# and does not live in this repository.
validate:
	@echo "Building the Copilot CLI variant into $(VARIANT)..."
	@bash platforms/copilot-cli/build.sh --out "$(VARIANT)"
	@test -f "$(VARIANT)/.claude-plugin/plugin.json" || { echo "FAIL: $(VARIANT) holds no build; every variant check below would pass with nothing checked"; exit 1; }
	@echo "Checking no colons in command names..."
	@! grep -r '^name:.*:' "$(VARIANT)"/commands/ 2>/dev/null || (echo "FAIL: colons in command names" && exit 1)
	@echo "Checking the question picker is rendered plain in the variant..."
	@! grep -rnE 'rich-picker|plain-picker|--picker=rich' "$(VARIANT)"/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a rich-picker passage or the rich gate-brief profile survives in the variant" && exit 1)
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
	@echo "Checking every workflow guide follows the step template..."
	@# Structure only: each FAIL line is a finding, and any one fails.
	@node tests/guide-template-lint.mjs
	@echo "Checking every skill, agent and command frontmatter is valid YAML..."
	@node tests/frontmatter-lint.mjs --variant="$(VARIANT)"
	@echo "Checking no two gates of one workflow ask the same question..."
	@node tests/gate-title-lint.mjs
	@echo "Checking the plugin ships no browser tool and names none..."
	@node tests/browser-tool-lint.mjs --variant="$(VARIANT)"
	@echo "Checking every dispatch-model invocation names the workflow script..."
	@node tests/dispatch-command-lint.mjs --variant="$(VARIANT)"
	@echo "Checking every agent and workflow guide names a plugin file under the plugin root..."
	@node tests/plugin-path-lint.mjs --variant="$(VARIANT)"
	@echo "Checking commands are flat (no subdirectories)..."
	@test $$(find "$(VARIANT)"/commands -mindepth 2 -name "*.md" 2>/dev/null | wc -l) -eq 0 || (echo "FAIL: nested command directories found" && exit 1)
	@echo "Checking every source agent carries the containment sentence..."
	@# One sentence, byte for byte, on a line of its own in every agent: a
	@# dispatched agent never starts a workflow, a command or an orchestrator
	@# skill. The Copilot build carries the copies the build leaves in place.
	@sentence='$(CONTAINMENT)'; \
	for f in plugins/maister/agents/*.md "$(VARIANT)"/agents/*.md; do \
	  grep -qxF -- "$$sentence" "$$f" || { echo "FAIL: $$f lacks the containment sentence, so nothing keeps it from starting a workflow, a command or an orchestrator skill"; exit 1; }; \
	done
	@echo "Checking every source agent carries the scratch-file sentence..."
	@# An agent's own file is all it reads before it runs a command, so the
	@# rule that keeps its throwaway files off a literal /tmp path lives there.
	@sentence='$(SCRATCH)'; \
	for f in plugins/maister/agents/*.md "$(VARIANT)"/agents/*.md; do \
	  grep -qxF -- "$$sentence" "$$f" || { echo "FAIL: $$f lacks the scratch-file sentence, so nothing keeps its throwaway files off a literal /tmp path"; exit 1; }; \
	done
	@echo "Checking every source agent carries the search-scope sentence..."
	@# The same reason: a file the agent was not handed is reported, never
	@# hunted for across the home directory or another copy of the plugin.
	@sentence='$(SEARCH)'; \
	for f in plugins/maister/agents/*.md "$(VARIANT)"/agents/*.md; do \
	  grep -qxF -- "$$sentence" "$$f" || { echo "FAIL: $$f lacks the search-scope sentence, so nothing keeps it from searching outside the project"; exit 1; }; \
	done
	@echo "Checking every Copilot agent has a tool allowlist without the agent tool..."
	@# Copilot runs each subagent level under a session of its own, so no agent
	@# there dispatches one: the runners run inline and every agent is a leaf.
	@for f in "$(VARIANT)"/agents/*.md; do \
	  t=$$(awk 'NR==1 && $$0=="---"{fm=1; next} fm && $$0=="---"{exit} fm && /^tools:/{print}' "$$f"); \
	  test -n "$$t" || { echo "FAIL: $$f has no tools: allowlist"; exit 1; }; \
	  ! echo "$$t" | grep -qF '"agent"' || { echo "FAIL: $$f grants the agent tool, so a subagent could dispatch one under a session of its own: $$t"; exit 1; }; \
	  ! echo "$$t" | grep -qF '"*"' || { echo "FAIL: $$f grants every tool by wildcard: $$t"; exit 1; }; \
	done
	@echo "Checking the research agents name the GitHub server's web search..."
	@for n in information-gatherer research-planner; do \
	  awk 'NR==1 && $$0=="---"{fm=1; next} fm && $$0=="---"{exit} fm && /^tools:/{print}' "$(VARIANT)/agents/$$n.md" | grep -qF '"github-mcp-server/web_search"' \
	    || { echo "FAIL: maister:$$n does not name github-mcp-server/web_search, so it gets no web search where the account allows it"; exit 1; }; \
	done
	@! grep -rnE 'WebSearch|WebFetch' "$(VARIANT)"/ --include="*.md" || (echo "FAIL: a Claude Code web tool name survives in the variant" && exit 1)
	@echo "Checking every Copilot agent runs on a model Copilot knows..."
	@! grep -nE '^models?:(.*[[,[:space:]])?(inherit|haiku|sonnet|opus|fast|default)([],[:space:]]|$$)' "$(VARIANT)"/agents/*.md || (echo "FAIL: a Claude Code model alias survives in a variant agent; Copilot runs it on a model of its own choosing" && exit 1)
	@echo "Checking no source agent pins model: inherit..."
	@! grep -nE '^model:[[:space:]]*inherit[[:space:]]*$$' plugins/maister/agents/*.md || (echo "FAIL: a source agent says model: inherit, which outranks the user's subagent model and adds nothing a call without a model does not" && exit 1)
	@echo "Checking the variant asks the engine for Copilot's models..."
	@! grep -rn --include='*.md' -- '--host=claude' "$(VARIANT)"/ || (echo "FAIL: --host=claude survives in the variant; dispatch-model would answer with Claude Code aliases, which Copilot silently swaps" && exit 1)
	@echo "Checking every Copilot agent and skill says to create a file's directory first..."
	@for f in "$(VARIANT)"/agents/*.md "$(VARIANT)"/skills/*/SKILL.md; do \
	  grep -q "^\*\*Create a file's directory before the file\.\*\* On this host" "$$f" || { echo "FAIL: $$f lacks the create-the-directory-first sentence; Copilot's create tool makes no missing directory"; exit 1; }; \
	done
	@echo "Checking every Copilot dispatch names the task tool's fields: agent_type, and a name..."
	@! grep -rn 'subagent_type' "$(VARIANT)"/ --include="*.md" || (echo "FAIL: subagent_type survives in the variant; Copilot's task tool takes agent_type" && exit 1)
	@for f in "$(VARIANT)"/skills/*/SKILL.md $$(grep -lE 'agent_type|Task tool' "$(VARIANT)"/commands/*.md); do \
	  grep -q "^\*\*Dispatch every agent this names, with every field the task tool requires\.\*\* On this host" "$$f" || { echo "FAIL: $$f lacks the task-tool sentence; Copilot refuses a task call without name"; exit 1; }; \
	done
	@awk '/^[[:space:]]*agent_type: "/ { held = FILENAME ":" FNR; next } held { if ($$0 !~ /^[[:space:]]*name: "/) { print "FAIL: " held ": a call block names no name, which Copilot'"'"'s task tool requires"; bad = 1 } held = "" } END { exit bad }' $$(find "$(VARIANT)" -name "*.md")
	@echo "Checking the variant names no Claude Code plan-mode tool, and quick-plan and quick-bugfix plan without one..."
	@! grep -rnE 'EnterPlanMode|ExitPlanMode' "$(VARIANT)"/ 2>/dev/null || (echo "FAIL: a Claude Code plan-mode tool survives in the variant; Copilot has none" && exit 1)
	@grep -q '^2\. \*\*Plan without editing\*\*.*ask for approval with `ask_user`' "$(VARIANT)"/skills/quick-plan/SKILL.md || (echo "FAIL: the variant's quick-plan lacks its plan-without-editing step" && exit 1)
	@grep -q '^\*\*Draft the fix plan without creating, editing or deleting any project file.*ask for approval with `ask_user`' "$(VARIANT)"/skills/quick-bugfix/SKILL.md || (echo "FAIL: the variant's quick-bugfix lacks its plan-without-editing step" && exit 1)
	@echo "Checking no CLAUDE.md references in skills..."
	@# Prose only, as the build's rewrite is: a script may read a project's
	@# CLAUDE.md by name (run-context checks whether it imports the index).
	@! grep -ri --include='*.md' 'CLAUDE\.md' "$(VARIANT)"/skills/ 2>/dev/null || (echo "FAIL: CLAUDE.md references found in skills" && exit 1)
	@echo "Checking the variant names no Explore agent type (Copilot's is explore)..."
	@! grep -rnE "(subagent_type|agent_type)[[:space:]]*[=:][[:space:]]*[^[:alnum:][:space:]]?Explore" "$(VARIANT)"/ --include="*.md" 2>/dev/null || (echo "FAIL: an Explore agent type survives in the variant; Copilot refuses it as unknown" && exit 1)
	@echo "Checking the variant gives no Claude Code plugin command..."
	@! grep -rnE '/plugin (install|uninstall|marketplace)' "$(VARIANT)"/skills "$(VARIANT)"/agents "$(VARIANT)"/commands --include="*.md" 2>/dev/null || (echo "FAIL: a Claude Code /plugin command survives in the variant; Copilot installs with copilot plugin" && exit 1)
	@echo "Checking no rewritten instructions path sits under a directory..."
	@! grep -rnE '[A-Za-z0-9_.-]/\.github/copilot-instructions\.md' "$(VARIANT)"/ 2>/dev/null || (echo "FAIL: a CLAUDE.md path under a directory was rewritten into a path that does not exist" && exit 1)
	@echo "Checking the variant's hooks: every script hooks.json names exists, in Copilot's output shape..."
	@for rel in $$(grep -o 'hooks/[A-Za-z0-9_.-]*\.\(sh\|mjs\)' "$(VARIANT)"/hooks/hooks.json | sort -u); do test -f "$(VARIANT)/$$rel" || { echo "FAIL: the variant's hooks.json names $(VARIANT)/$$rel, which does not exist"; exit 1; }; done
	@! grep -q '"modules"' "$(VARIANT)"/hooks/hooks.json || (echo "FAIL: the variant's hooks.json lists a Claude Code hooks module" && exit 1)
	@for f in "$(VARIANT)"/hooks/*.mjs; do grep -q "^const HOOK_SHAPE = 'copilot';$$" "$$f" || { echo "FAIL: $$f emits Claude Code's output shape, which Copilot drops"; exit 1; }; done
	@echo "Checking no maister- prefix in copilot command names..."
	@! grep -r '^name: maister-' "$(VARIANT)"/commands/ 2>/dev/null || (echo "FAIL: maister- prefix in command names" && exit 1)
	@echo "Checking no prose maister: in the source, which the Copilot build would strip..."
	@# The build turns a maister:<skill> into the bare skill name, so a
	@# maister: followed by a space or a line end reads with the name gone.
	@! grep -rnE 'maister:([[:space:]]|$$)' plugins/maister/ --include="*.md" 2>/dev/null || (echo "FAIL: a maister: before a space or a line end loses the name in the Copilot build; write the name without the colon" && exit 1)
	@echo "Checking the variant names no maister-copilot outside the 2.x install line..."
	@! grep -rnI 'maister-copilot' "$(VARIANT)" | grep -v 'maister-copilot@maister-plugins-2x' || (echo "FAIL: the old plugin name survives in the variant; Copilot registers it as maister" && exit 1)
	@echo "Checking no maister-<name> form survives (Copilot registers neither)..."
	@names=$$( { ls "$(VARIANT)/commands" "$(VARIANT)/agents" | sed -n 's/\.md$$//p'; ls "$(VARIANT)/skills"; } | sort -u | paste -sd'|' -); \
	! grep -rnE "maister-($$names)([^A-Za-z0-9_-]|$$)" "$(VARIANT)" --include="*.md" || (echo "FAIL: a maister-<name> reference survives; Copilot resolves /maister:<name>, a bare skill name or maister:<agent>" && exit 1)
	@echo "Checking every /maister:<name> names a command or skill..."
	@for n in $$(grep -rhoE '/maister:[A-Za-z0-9_-]+.?' "$(VARIANT)" --include="*.md" | grep -v ':$$' | sed -E 's#^/maister:([A-Za-z0-9_-]+).*#\1#' | sort -u); do \
	  test -f "$(VARIANT)/commands/$$n.md" || test -f "$(VARIANT)/skills/$$n/SKILL.md" || { echo "FAIL: /maister:$$n names no command or skill"; exit 1; }; \
	done
	@echo "Checking every other maister:<name> names an agent (a bare skill name has no prefix)..."
	@for n in $$(grep -rhoE '(^|[^/A-Za-z0-9_-])maister:[A-Za-z0-9_-]+' "$(VARIANT)" --include="*.md" --include="*.json" --include="*.mjs" --include="*.yml" | sed -E 's#.*maister:##' | sort -u); do \
	  test -f "$(VARIANT)/agents/$$n.md" || { echo "FAIL: maister:$$n names no agent; the build leaves a skill bare"; exit 1; }; \
	done
	@echo "Checking gate markers are not nested inside code spans..."
	@! grep -rnF '`→ **MANDATORY GATE** — fires ' plugins/maister/skills/ 2>/dev/null || (echo "FAIL: gate marker nested inside a code span" && exit 1)
	@! grep -nF '→ Pause' plugins/maister/skills/orchestrator-framework/references/orchestrator-creation-checklist.md 2>/dev/null || (echo "FAIL: superseded transition marker in the orchestrator checklist" && exit 1)
	@echo "Checking the undecided sentence is identical in every copy..."
	@node tests/undecided-sentence-lint.mjs
	@echo "Checking the gate-rule sentence is identical in every copy..."
	@# An exact count, not a floor: a floor would let an extra copy hide a lost
	@# one. A copy added on purpose updates these numbers together with
	@# CLAUDE.md's list of copies (The gate rule). The Copilot build lands
	@# outside plugins/, so none of its copies is counted.
	@full='when `orchestrator.driver.kind` is absent or `terminal`; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine'\''s `references/gates.md`, *Driver-suspended mode*.'; \
	tail='ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine'\''s `references/gates.md`, *Driver-suspended mode*.'; \
	want_full=8; want_tail=10; \
	nf=$$(grep -rlF -- "$$full" CLAUDE.md plugins/ | wc -l | tr -d ' '); \
	nt=$$(grep -rlF -- "$$tail" CLAUDE.md plugins/ | wc -l | tr -d ' '); \
	if test "$$nf" -eq "$$want_full" && test "$$nt" -eq "$$want_tail"; then \
	  echo "  the full sentence in $$nf files, its tail in $$nt"; \
	else \
	  echo "FAIL: the gate-rule sentence is in $$nf files ($$want_full expected) and its tail in $$nt ($$want_tail expected); a copy drifted, was lost or was added"; \
	  echo "Files with the full sentence:"; grep -rlF -- "$$full" CLAUDE.md plugins/ | sort; \
	  echo "Files with the tail:"; grep -rlF -- "$$tail" CLAUDE.md plugins/ | sort; \
	  exit 1; \
	fi
	@echo "Checking the plugin-root variable is renamed for this CLI's vocabulary..."
	@! grep -rn 'CLAUDE_PLUGIN_ROOT' "$(VARIANT)"/skills/ --include="*.md" 2>/dev/null || (echo "FAIL: a Claude-only plugin-root variable survives in the emitted skills" && exit 1)
	@test "$$(grep -rl 'MAISTER_PLUGIN_ROOT' "$(VARIANT)"/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" = "$$(grep -rl 'CLAUDE_PLUGIN_ROOT' plugins/maister/skills/ --include="*.md" 2>/dev/null | wc -l | tr -d ' ')" || (echo "FAIL: the emitted skills' plugin-root variable count drifted from the source tree" && exit 1)
	@echo "Checking every hooks.json command path exists on disk..."
	@for rel in $$(grep -o 'hooks/[A-Za-z0-9_.-]*\.\(sh\|mjs\)' plugins/maister/hooks/hooks.json | sort -u); do test -f "plugins/maister/$$rel" || { echo "FAIL: hooks.json names plugins/maister/$$rel, which does not exist"; exit 1; }; done
	@for rel in $$(grep -o '"\./[A-Za-z0-9_.-]*\.mjs"' plugins/maister/hooks/hooks.json | tr -d '"' | sort -u); do test -f "plugins/maister/hooks/$$rel" || { echo "FAIL: hooks.json lists the module plugins/maister/hooks/$$rel, which does not exist"; exit 1; }; done
	@types=$$(sed -n 's/.*"types": *"\.\/\([^"]*\)".*/\1/p' plugins/maister/.claude-plugin/plugin.json); test -z "$$types" || test -f "plugins/maister/$$types" || { echo "FAIL: plugin.json names the contract plugins/maister/$$types, which does not exist"; exit 1; }
	@echo "Checking every marketplace file names the same marketplace and version, and no other host's build..."
	@node tests/marketplace-lint.mjs
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
	@echo "Checking the workflow reference matches a fresh generation..."
	@node tools/workflow-reference.mjs --check
	@echo "Checking the plugin ships no JSON schema files..."
	@test "$$(find plugins/maister -path '*/schemas/*' -name '*.json' 2>/dev/null | wc -l | tr -d ' ')" -eq 0 || (echo "FAIL: a schema file is shipped under plugins/maister/" && exit 1)
	@echo "Checking the interface file matches a fresh generation from its tree..."
	@node tools/interface.mjs --root plugins/maister --check
	@echo "Checking the hooks take no Python dependency..."
	@! grep -rn 'python3' plugins/maister/hooks/ 2>/dev/null || (echo "FAIL: a hook reaches for python3" && exit 1)
	@echo "Checking no hook needs bash or jq..."
	@test -z "$$(find plugins/maister/hooks "$(VARIANT)/hooks" -name '*.sh' 2>/dev/null)" || (echo "FAIL: a shell hook is shipped; hooks are Node, run in the exec form" && exit 1)
	@! grep -nE '"(command|exec)": *"(bash|sh)\b|"bash":|"powershell":' plugins/maister/hooks/hooks.json platforms/copilot-cli/hooks.json "$(VARIANT)/hooks/hooks.json" || (echo "FAIL: a hooks.json entry runs a hook through a shell" && exit 1)
	@! grep -n 'child_process' plugins/maister/hooks/*.mjs "$(VARIANT)"/hooks/*.mjs || (echo "FAIL: a hook starts a process, which may need a shell or jq" && exit 1)
	@echo "All checks passed"

# The engine verb suite: every verb run as a driver runs it, against committed
# fixtures copied into a scratch directory per test. Prerequisites: bash and
# node >= 20, nothing installed. The Copilot CLI build the tests read is made
# once into a scratch folder and handed to every test file through
# MAISTER_TEST_VARIANT. The glob is expanded by the shell because Node 20's
# --test takes no glob of its own.
test:
	@dir=$$(mktemp -d); \
	bash platforms/copilot-cli/build.sh --out "$$dir/copilot" >/dev/null \
	  && MAISTER_TEST_VARIANT="$$dir/copilot" node --test tests/engine/*.test.mjs; status=$$?; \
	rm -r "$$dir"; exit $$status

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
	rm -rf "$(VARIANT)"

watch:
	fswatch -o plugins/maister/ | xargs -n1 -I{} make build
