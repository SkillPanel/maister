# Design-Resource Discovery

Before generating mockups, `mockup-studio` discovers the project's existing design language so mockups bind to it rather than inventing a generic look. This routine runs once per mockup-generation invocation (skip re-running on resume when `design_resources.ran` is already true in state).

**Output**: a terse artifact `<task_path>/analysis/design-context/design-resources.md` (opens with `## TL;DR`) and a `design_resources` block recorded in the caller's `orchestrator-state.yml`:

```yaml
design_resources:
  ran: true            # discovery executed (resume skips re-run)
  standards: []        # tier 1: [{path, topic}] resolved frontend/design/a11y standard files
  design_system: []    # tier 2: [{kind: token|theme|tailwind|css-var|component-lib|icon-lib, path, note}]
  skill_hints: []      # tier 3: [{kind: skill|agent|mcp-tool, name, why}]
  found_any: false     # false ⇒ generation proceeds unchanged (artifact still written, one line)
```

**Graceful default**: each tier independently no-ops. When all three are empty, set `found_any: false`, write a one-line artifact ("No project design resources detected — mockups generated from codebase patterns only"), and change nothing else.

---

## Run order

Run cheapest-and-orchestrator-only first, authoritative-and-delegable last. `mockup-studio` runs in the main agent context, so it can do all three (a subagent could not do tier 3).

### Tier 3 — Available design skills / agents / MCP tools (MAIN CONTEXT ONLY)

Scan the names + descriptions of the skills, subagents, and MCP tools visible in the current context for design/UI/UX signal. This is only possible from the main agent (a subagent cannot enumerate available skills/tools) — which is why mockup-studio is a skill, not a subagent.

**Keywords**: `design, ui, ux, mockup, wireframe, prototype, figma, sketch, zeplin, storybook, component, theme, token, tailwind, chakra, shadcn, mui, a11y, accessib, icon, css, style`.

For each match, record `{kind, name, why}`. Then, **best-effort and capability-aware**, optionally:
- **Consult** a matched design skill / design MCP for the palette, tokens, or style guidance before generating.
- **Read** a connected design MCP resource (e.g. a Figma file) when one is available.
- **Delegate** a screen to a matched component-builder skill *only* when the project's stack matches and the skill is present.

**Hard scope**: tier-3 consults are for *style/token guidance or throwaway mockup markup* — NEVER for writing production components. If a consult fails or nothing matches, fall straight through. Never block on tier 3.

### Tier 1 — Project standards

From the project's `.maister/docs/INDEX.md` (the orchestrator already loaded it at init), select standard files whose path or heading matches `standards/frontend/`, `standards/design/`, or the keywords `ui | ux | component | accessibility | a11y | responsive | css | theme | design-system`. Record resolved paths in `standards[]`.

These are **binding**: the generator (ASCII subagent or inline HTML) must read each file and honor its rules — color usage, spacing scale, component conventions, accessibility requirements.

### Tier 2 — Codebase design system

Discover the real, in-code design system. **Harvest from an existing `analysis/codebase-analysis.md` first** (development Phase 1 and product-design Phase 1 already ran codebase analysis) — use `rg --files` and `rg` only for the gaps. Look for:

| Kind | Signals (examples) |
|------|--------------------|
| `token` | `**/tokens*.{json,js,ts,css}`, `**/design-tokens*` |
| `theme` | `**/theme.{ts,js,json}`, `theme/` dirs, MUI/Chakra theme objects |
| `tailwind` | `tailwind.config.*`, `panda.config.*`, `uno.config.*` |
| `css-var` | CSS custom properties — search CSS files with `rg -- '--[a-z-]+:'` |
| `component-lib` | `.storybook/`, `components.json` (shadcn), `@chakra-ui`/`@mui`/`@mantine` imports, a local `components/ui/` library |
| `icon-lib` | `lucide`, `@heroicons`, `react-icons`, `@tabler/icons`, a local `icons/` dir |

Record each as `{kind, path, note}`. These are **binding**: generated mockups reuse the discovered tokens (echo the real CSS variables / class names), components (by their real names), and icon set — so the mockup resembles the actual app.

---

## How findings bind to each generator

- **HTML (inline, main context)**: mockup-studio generates HTML/CSS that echoes the discovered CSS custom properties / Tailwind classes / component names. Annotate reuse, e.g. `{"selector":".btn","note":"uses --color-primary from src/theme.ts"}`.
- **ASCII (subagent)**: mockup-studio passes the resolved standard paths, the design-system inventory, and skill hints in the `ascii-mockup-generator` prompt. The agent reads every standard and maps each mockup element to the real component/token by name.

In both cases the rule is the same: **reuse the existing visual language; annotate any deliberate deviation with a rationale.** Do not invent a design system when one exists.
