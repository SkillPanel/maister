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

The compatibility contracts register is a Pro Edition feature and does not live in this
repository.

## Adding things

- **Skill**: `skills/<name>/SKILL.md` (uppercase) with `name` + `description` frontmatter — the description is what the Skill tool and users see. Optional `references/`, `assets/`. A workflow is not a skill of its own: it is a definition under `skills/workflow-engine/workflows/` with a thin hand-off skill, built to `skills/orchestrator-framework/references/orchestrator-creation-checklist.md`.
- **Command**: `commands/<name>.md`, flat (no subdirectories) and no colons in `name` — the Copilot build requires both. Invoke a skill; don't embed logic.
- **Agent**: `agents/<name>.md` with `name`, `description`, `tools` frontmatter. Read-only unless it must write. If it truly needs destructive Bash, add it to the `case` whitelist in `hooks/block-destructive-commands.sh` — default is *not* whitelisted.
- **Hook**: script alongside `hooks/hooks.json`, registered there with a `${CLAUDE_PLUGIN_ROOT}`-anchored path. Node hooks (`*.mjs`) use the exec form — `command: node` with the script path in `args` — so nothing depends on a shebang or an executable bit. Shell hooks (`*.sh`) are invoked as `bash "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh"` for the same reason. The Copilot variant does not inherit `hooks.json`.

## Adding a refusal to the umbrella runtime

A refusal is a closed set with three carriers. Nothing here checks them against each other, so
keep them in step by hand:

1. **A raise site in the source.** `throw new Refusal('<code>', '<message>')` somewhere under
   `skills/umbrella/scripts/lib/`.
2. **A recovery row in the shipped skill**, in the refusal table for its subsystem, with a
   minimum length — a recovery too short to tell an operator what to do is not a recovery. A
   code raised *after* its mutation has already been published owes more: its row must say the
   entry landed, so nobody re-issues the op and applies the change twice.
3. **A live provocation.** A test under `tests/` makes the runtime raise it, through the real
   writers. A code that cannot be provoked portably is noted as platform-gated with the reason —
   never silently dropped.

**A fourth carrier is prose only.** Each module header lists the codes
that module owns. One entry there is raised by the shared value emitter rather than by the
module, and is named in the list without ever being thrown or caught locally; the sibling case
is a dispatch refusal whose message is composed for an operator reading a validation report
rather than quoted as a code. Keep those lists true by hand — nothing will tell you.

The message is user-facing text, so it follows the prose rules above: say what happened, what
landed, and what to do, not which function raised it.

## Delegation (skills that orchestrate)

Skill tool for skills, Task tool for agents — never a skill via Task (`subagent_type` will fail). Skills that spawn subagents must run in the main agent. The companion-agent pattern (e.g. `docs-operator` preloading `docs-manager`) works only for skills that spawn **no** subagents. Canonical: `orchestrator-patterns.md` § 1.

## Copilot build compatibility

`platforms/copilot-cli/build.sh` transforms source into `plugins/maister-copilot/` and `make validate` enforces: flat commands, no colons in command names, no picker marker or rich profile left in skills, no `maister:` prefixes, no leftover `maister-<name>` form, every `/maister-copilot:<name>` naming a command or skill and every `maister-copilot:<name>` naming an agent, no `CLAUDE.md` references in skills. The build turns `/maister:<name>` into `/maister-copilot:<name>`, `maister:<agent>` into `maister-copilot:<agent>`, and any other `maister:<skill>` into the bare skill name — so write `/maister:` only where a user types it and `maister:<skill>` only where the Skill tool takes it. The build also gives each agent a Copilot tool allowlist and a no-re-entry sentence, so **source agents declare no `tools:`** — the build refuses one that does. Write source so the substitutions (`AskUserQuestion` → `ask_user`) still read correctly. One further source rule follows from those greps: **no bare `maister:` YAML key in any `*.md`** (write the plugin name in prose instead). Prose calls the gate request's multi-choice key "the multi-choice flag" rather than spelling it. **Picker passages are marked, one marker to a line**: a passage that holds only for Claude Code's picker (option previews, fields the tool takes by name) sits between `<!-- rich-picker -->` and `<!-- /rich-picker -->`, and its replacement for Copilot's message-and-form picker (no previews; a page is a form of several properties, a multi-select an array property) inside a `<!-- plain-picker` … `-->` comment; the build drops the first, uncomments the second and turns `--picker=rich` into `--picker=plain`, so name a profile in prose as "the `rich` profile", never by its flag.

## Review checklist

- ✓ WHAT / WHEN / WHY, not step-by-step HOW
- ✓ Code examples ≤10 lines and conceptual
- ✓ Within length targets
- ✓ Nothing duplicated from a `SKILL.md` — referenced instead
- ✓ An experienced developer could implement from it
- ✓ Tool/framework agnostic where possible
