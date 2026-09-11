---
name: mockup-studio
description: Generates UI mockups (rendered HTML/CSS via a browser visual companion, or terminal ASCII). Discovers and binds to the project's frontend/UI/UX resources (standards, design system, available design skills). Invoked standalone by users, or by the development and product-design orchestrators as their mockup-generation step.
user-invocable: true
---

# Mockup Studio

The single, reusable engine for generating UI mockups in the maister plugin. It runs in the **main agent context** (not a subagent), so it can start a local visual-companion server (Bash), open a browser (Playwright MCP), and run interactive `ask_user` refinement gates.

Two ways it runs:

- **Invoked by an orchestrator** (development Phase 4, product-design Phase 7) via the Skill tool, with explicit parameters (see Input Parameters). The orchestrator owns its own phase gate; mockup-studio does the generation.
- **Invoked standalone by a user** (`/maister-mockup-studio "<screen or feature>"`). It creates its own task directory and runs the full interactive flow.

Whatever the caller, the work is the same: discover the project's design language → render mockups in the chosen format → persist them → (optionally) index them for downstream binding.

---

## Core Principles

1. **One engine, two formats** — `html` (visual companion server + browser) is the default; `ascii` (delegated to the `ascii-mockup-generator` subagent) is the no-Node/no-browser path. HTML auto-falls back to ASCII when Node.js is unavailable.
2. **Bind to the real design language** — before generating, run design-resource discovery (`references/design-resource-discovery.md`). Discovered standards, tokens, and components are **binding inputs**, not suggestions.
3. **Consistency over creativity** — mockups should look like the existing application (reuse real components, tokens, icons), not a generic theme.
4. **Graceful degradation** — every step has a fallback; when nothing is discovered, generation proceeds exactly as it would without discovery.

---

## Input Parameters

When an orchestrator invokes this skill, it passes these. Standalone invocation derives them from the user's prompt + config (see Standalone Mode).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_path` | Yes | Caller's task directory. Mockups, the discovery artifact, and (when requested) INDEX rows are written under it. |
| `output_subdir` | No | Where rendered mockups land, relative to `task_path`. Default `analysis/mockups` (product-design). Development passes `analysis/design-context/mockups`. |
| `format` | No | `html` (default) or `ascii`. Orchestrators pass `orchestrator.options.mockup_format`. Auto-falls back to `ascii` when Node.js is unavailable. |
| `iteration` | No | `single` (generate once, return — caller's phase gate handles approve/revise) or `full` (multi-round interactive refinement loop). Default `full`. |
| `emit_index_rows` | No | When `true`, append stable-ID rows to `<task_path>/analysis/design-context/INDEX.md` so downstream phases can attach `Visual References`. Default `false`. Development passes `true`. |
| `context` | No | Grounding summary (spec/gap-analysis/design-decisions excerpts, screen list, `design_reference` path) so generated screens are specific and feature-relevant — not generic placeholders. |

**Returns** (report back to the caller):
```yaml
mockup_files: []        # paths of written mockups (.html files, or the ascii-mockups.md)
index_rows: []          # stable-ID rows appended to design-context/INDEX.md (empty if emit_index_rows false)
format_used: html|ascii # the format actually used (may differ from requested if Node was unavailable)
notes: ""               # fallback notes, e.g. "html requested, fell back to ascii (Node unavailable)"
```

---

## Execution Workflow

### Step 1 — Resolve inputs & set up

- If invoked standalone with no `task_path`, run **Standalone Mode** setup first (below).
- Ensure `<task_path>/<output_subdir>/` exists.
- Capture the clock once with `date -u +"%Y-%m-%dT%H:%M:%SZ"` (Bash) for any timestamps written this turn.

### Step 2 — Design-resource discovery (binding)

**Read `references/design-resource-discovery.md` NOW** and run the 3-tier routine. Write `<task_path>/analysis/design-context/design-resources.md` (with a `## TL;DR`) and record the `design_resources` block (the routine specifies the schema). When nothing is found, write the one-line "none detected" artifact and continue unchanged.

The discovered standards (read them), design-system tokens/components (reuse by exact name), and skill hints (best-effort consult) are **binding** for whichever generator runs next.

### Step 3 — Format routing

Determine the effective format:
```
node_ok = `node --version` succeeds
if format == "html" AND node_ok   → HTML path (Step 4a)
else                              → ASCII path (Step 4b)
if format == "html" AND NOT node_ok → record in notes: "html requested, fell back to ascii (Node unavailable)"
```

### Step 4a — HTML path (visual companion)

Read `references/visual-companion.md` for the full protocol. Then:

1. **Stale-server check**: `curl -s http://localhost:3847/status` (try 3847–3850). If it responds with a different `taskPath`, `POST /shutdown` it. If it matches the current task, reuse it.
2. **Start the server** (Bash):
   `node ${MAISTER_PLUGIN_ROOT}/skills/mockup-studio/server/index.mjs --task-path=${task_path} --output-subdir=${output_subdir} &`
   The plugin root is this plugin's own directory — the one holding `.claude-plugin/plugin.json` — and the variable naming it is set in the session environment. Use it as written rather than substituting a path of your own.
   Wait ~1s, verify `curl -s http://localhost:${port}/status` returns ok (try 3847–3850).
3. **Open browser** (best-effort, non-blocking): Playwright MCP `browser_navigate` to `http://localhost:${port}` → fallback `open`/`xdg-open` → fallback log the URL.
4. **Generate user-facing wireframes** — one screen per relevant view implied by `context`. Title each screen specifically (e.g. "Add New Allergy Form", not "Dashboard"). Bind to discovered tokens/components/CSS variables by their real names. Add `data-screen="slug"` to clickable elements for click-through navigation, and `annotations` for component-reuse / integration / interaction hints (NOT requirements). Generate USER-FACING UI only — never architecture/data-flow/ER diagrams.
5. **POST each screen**: `POST http://localhost:${port}/update` with `{type, title, html, css, annotations}`. Each POST auto-saves `<output_subdir>/{slug}.html`.

### Step 4b — ASCII path

**INVOKE** the `maister-ascii-mockup-generator` subagent (Task tool). Pass: `task_path`, `output_subdir` target, the `context` grounding, the feature type, AND the discovered design resources (resolved standard file paths, design-system inventory, skill hints) so the agent binds to them. The agent writes ASCII to `analysis/design-context/ascii/ui-mockups.md` (or `<output_subdir>/ascii-mockups.md` for standalone/product-design) and can append INDEX rows itself.

### Step 5 — Refinement loop

- `iteration: single` — generate once and return. The calling orchestrator's phase gate offers approve/revise; on revise it re-invokes this skill.
- `iteration: full` — enter an interactive loop:
  `ask_user` with options like: "Approve all screens and continue", "Change the layout of [screen]", "Change the content of [screen]", "Change the interactions", "Add another screen", "Let me explain my thinking". On revision, regenerate the specific screen (re-POST updates it in place on disk and in the gallery for HTML; re-run the agent for ASCII). Track iterations and apply a soft cap (~5) — past it, recommend converging.

### Step 6 — Persist & index

- HTML mockups are saved on each POST. ASCII is saved by the subagent.
- When `emit_index_rows` is true, append one row per screen/component to `<task_path>/analysis/design-context/INDEX.md` (create if missing), using the stable-ID format below. Source points at the per-screen `.html` (HTML) or the ASCII file anchor:

```markdown
| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:add-allergy-form | screen | analysis/design-context/mockups/add-allergy-form.html | Add New Allergy form modal |
| component:severity-badge | component | analysis/design-context/mockups/add-allergy-form.html | Allergy severity pill (reuses Badge) |
```

### Step 7 — Teardown & return

- **Do NOT shut the server down when `iteration: single` (orchestrator mode).** In that mode the caller's *review gate fires after this skill returns* — the operator reviews the gallery at that gate, so the companion MUST stay running until the caller leaves the design stage. Shutting down here strands the reviewer with a dead `localhost` (the gallery survives on disk, but the live browsable gallery — the whole point — is gone). Leave it running and tell the caller the gallery URL; the orchestrator tears it down when it advances past the design/mockup phase (or on a "revise" it re-invokes this skill, which reuses the still-running server).
- Only shut the server down when this skill genuinely owns the *entire* lifecycle end-to-end: **standalone `iteration: full`** after the user has approved and the interactive loop is complete. Then `curl -s -X POST http://localhost:${port}/shutdown`.
- On restart the server auto-restores previously-saved screens from the on-disk manifest (`<output_subdir>/.mockups.json`), so a companion that was stopped can be brought back with the full gallery intact by re-running the same start command — no re-POST needed.
- Return the result block (Step "Returns" above) to the caller, including the live gallery URL so the caller can surface it at its review gate.

---

## Standalone Mode

When a user runs `/maister-mockup-studio "<screen or feature>"` (no `task_path` from an orchestrator):

1. Capture the clock; create `.maister/tasks/mockups/YYYY-MM-DD-<short-name>/` with an `analysis/` subdir.
2. Defaults: `output_subdir = analysis/mockups`, `iteration = full`, `emit_index_rows = false`, `format` from `.maister/config.yml` `mockup_format` (default `html`).
3. Build `context` from the user's prompt (and any referenced files/standards).
4. Run Steps 1–7. At the end, report the gallery URL and saved file paths.

This gives users an ad-hoc mockup session without running a full development or product-design workflow.

---

## Graceful Degradation

| Scenario | Detection | Fallback |
|---|---|---|
| Node.js unavailable | `node --version` fails | ASCII via `ascii-mockup-generator`; note it in `notes` |
| All ports 3847–3850 in use | server start fails on every port | ASCII fallback |
| Browser won't open | Playwright + `open` both fail | Log the URL; continue (server still saves to disk) |
| No design resources found | discovery `found_any: false` | Generate from codebase patterns only — unchanged behavior |

Never block the caller because a mockup enhancement failed. The mockup files on disk are the deliverable; live preview is additive.

---

## Local References

| File | When to Read | Purpose |
|------|-------------|---------|
| `references/design-resource-discovery.md` | Step 2 (before generating) | The 3-tier discovery routine, `design_resources` schema, binding rules |
| `references/visual-companion.md` | Step 4a (HTML path) | Server protocol, lifecycle, communication, graceful degradation |
