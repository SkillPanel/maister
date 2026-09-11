---
paths:
  - "plugins/maister/**"
---
# Plugin authoring conventions

Applies when editing skills, agents, commands, hooks, or references under `plugins/maister/`.

## Philosophy

**Trust Claude to reason.** Provide principles, patterns, and decision criteria — not prescriptive implementations. Explain WHAT to do, WHEN to do it, and WHY; leave HOW to the executing agent. Documentation is a map, not a manual.

## Rules

1. **No verbose pseudocode.** Show conceptual patterns and decision frameworks, never complete implementations.
2. **No prescriptive templates.** Guide thinking; don't dictate exact prompts or scripts.
3. **Single source of truth.** Orchestration logic lives in the skill's `SKILL.md`. Commands, agents, and other skills *reference* it — they never duplicate it.
4. **Commands are thin wrappers.** User-facing guidance in the command; everything else in the skill it invokes.
5. **References are conceptual.** Code examples ≤10 lines and only for: test patterns, config samples, API usage, decision pseudocode. No framework boilerplate, no production code.
6. **Prefer user-invocable skills** over non-invocable library skills for reusable components; orchestrators invoke them via the Skill tool.

## Length targets

| Artifact | Target |
|---|---|
| Skill description (frontmatter / summaries) | 5–15 lines |
| Command file | thin — invoke + usage notes |
| Agent file | 300–450 lines: mission, decision frameworks, workflow principles |
| Orchestrator phase reference | 600–800 lines (max 1,000) |
| Algorithm / pattern reference | 400–600 lines (max 800) |
| Strategy / decision reference | 300–500 lines (max 600) |
| All references in one skill | < 3,000 lines total |
| Individual standard (`###` section in a standards file) | 1–10 lines + optional snippet |

**Carve-out.** Rules 1, 2 and 5 and the length targets above describe *prose* references. They do not apply to:

- `hooks/*.mjs` and `hooks/*.sh` — executable code, written to be read as code.
- `skills/*/scripts/*.mjs` and `skills/*/server/*.mjs` — executable code shipped with a skill, written to be read as code. A skill's script directory holds the tooling its prose invokes; its server directory holds a local companion process.
- `lib/*.mjs` — executable code shared by more than one skill, written to be read as code. It sits at the plugin root because no single skill owns it.
- `skills/orchestrator-framework/schemas/*.json` — JSON Schema documents, generated-shaped by nature.
- `skills/orchestrator-framework/references/compatibility-contracts.md` — a **register**, not a guide: normative tables and frozen literals, max 600 lines, samples ≤ 10 lines each.

## Adding things

- **Skill**: `skills/<name>/SKILL.md` (uppercase) with `name` + `description` frontmatter — the description is what the Skill tool and users see. Optional `references/`, `assets/`. Orchestrators additionally follow `skills/orchestrator-framework/references/orchestrator-creation-checklist.md` and read `orchestrator-patterns.md` at init.
- **Command**: `commands/<name>.md`, flat (no subdirectories) and no colons in `name` — the Copilot build requires both. Invoke a skill; don't embed logic.
- **Agent**: `agents/<name>.md` with `name`, `description`, `tools` frontmatter. Read-only unless it must write. If it truly needs destructive Bash, add it to the `case` whitelist in `hooks/block-destructive-commands.sh` — default is *not* whitelisted.
- **Hook**: script alongside `hooks/hooks.json`, registered there with a `${CLAUDE_PLUGIN_ROOT}`-anchored path. Node hooks (`*.mjs`) use the exec form — `command: node` with the script path in `args` — so nothing depends on a shebang or an executable bit. Shell hooks (`*.sh`) are invoked as `bash "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh"` for the same reason. The Copilot variant does not inherit `hooks.json`: its hook configs are authored under `platforms/copilot-cli/hooks/` and emitted by the build.

## Adding a refusal to the umbrella runtime

A refusal is a closed set with four carriers, and the suite checks all four. Add one and you
meet them as a red suite unless you know them in advance, so here they are:

1. **A raise site in the source.** `throw new Refusal('<code>', '<message>')` somewhere under
   `skills/umbrella/scripts/lib/`. The suite sweeps those files for the codes they manufacture
   and holds that set equal to its own list, in both directions — so a code cannot escape the
   list by being added only to the code, and the list cannot name a code nothing raises.
2. **An entry in that list.** The runtime test's refusal list is the register; a new code goes
   in it.
3. **A recovery row in the shipped skill**, in the refusal table for its subsystem, with a
   minimum length — a recovery too short to tell an operator what to do is not a recovery. A
   code raised *after* its mutation has already been published owes more: its row must say the
   entry landed, so nobody re-issues the op and applies the change twice.
4. **A live provocation.** The runtime test must actually make the runtime raise it, through
   the real writers, and record that it did. A code that cannot be provoked portably is listed
   as platform-gated with the reason and reported as a note — never silently dropped.

**The fifth carrier is prose only, and no check reads it.** Each module header lists the codes
that module owns. One entry there is raised by the shared value emitter rather than by the
module, and is named in the list without ever being thrown or caught locally; the sibling case
is a dispatch refusal whose message is composed for an operator reading a validation report
rather than quoted as a code. Keep those lists true by hand — nothing will tell you.

The message is user-facing text, so it follows the prose rules above: say what happened, what
landed, and what to do, not which function raised it.

## Delegation (skills that orchestrate)

Skill tool for skills, Task tool for agents — never a skill via Task (`subagent_type` will fail). Skills that spawn subagents must run in the main agent. The companion-agent pattern (e.g. `docs-operator` preloading `docs-manager`) works only for skills that spawn **no** subagents. Canonical: `orchestrator-patterns.md` § 1.

## Copilot build compatibility

`platforms/copilot-cli/build.sh` transforms source into `plugins/maister-copilot/` and `make validate` enforces: flat commands, no colons in command names, no `multi-select`/`multiSelect` wording in skills, no `maister:` prefixes, no `CLAUDE.md` references in skills. Write source so the substitutions (`AskUserQuestion` → `ask_user`, multi-select → sequential single-select) still read correctly. Two further source rules follow from those greps: **no bare `maister:` YAML key in any `*.md`** (write the plugin name in prose instead), and **the E2 multi-choice flag key is spelled only in schemas and fixtures** — prose calls it "the multi-choice flag (see `gate.schema.json`)".

## Review checklist

- ✓ WHAT / WHEN / WHY, not step-by-step HOW
- ✓ Code examples ≤10 lines and conceptual
- ✓ Within length targets
- ✓ Nothing duplicated from a `SKILL.md` — referenced instead
- ✓ An experienced developer could implement from it
- ✓ Tool/framework agnostic where possible
