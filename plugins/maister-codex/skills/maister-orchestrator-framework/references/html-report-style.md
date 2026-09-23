# HTML Companion Report Style Guide

Shared conventions for agents that emit an HTML companion next to a markdown artifact (orchestrator-patterns.md § 9). Goal: every companion looks like part of one family, regardless of which agent or session produced it.

## Hard Rules

1. **Self-contained single file** — inline `<style>`, no external CSS/JS/fonts/CDNs. Images only via relative paths within the task directory (e.g., screenshots) or inline SVG.
2. **Same content as the markdown** — the companion restructures and visualizes; it never contains findings, decisions, or requirements absent from the md.
3. **Relative links only** — link to sibling artifacts relative to the file's own location (companions live next to their md).
4. **Never block the workflow** — if HTML generation fails, keep the md, note the miss in your output, continue.
5. **Open with the summary** — the TL;DR / Key Decisions / Risks block (§ 7) renders as the top section, before any detail.

## Standard Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[Artifact title] — [task name]</title>
<style>/* standard CSS block below */</style>
</head>
<body>
  <nav class="crumbs"> <!-- cross-report navigation, see below -->
  <header>  <!-- title, artifact type badge, generated date, link to .md twin -->
  <div class="tiles">  <!-- stat-tile row, see below -->
  <section class="tldr">      <!-- TL;DR + Key Decisions + Risks -->
  <nav class="toc">    <!-- anchor TOC, only when the report has >5 sections -->
  <main>    <!-- artifact-specific sections -->
</body>
</html>
```

## Cross-Report Navigation (required)

Every companion opens with a breadcrumb bar linking the task's report suite. Paths are fixed relative to the companion's own directory — emit links only for files that exist (or are standard for this workflow):

```html
<nav class="crumbs">
  <a href="../dashboard.html">← Dashboard</a>
  <a href="spec.html">Spec</a> <a href="implementation-plan.html">Plan</a>
  <a href="../verification/implementation-verification.html">Verification</a>
  <a href="[twin].md" target="_blank" rel="noopener" class="md">md twin ↗</a>
</nav>
```

Adjust the `../` prefixes to the companion's location (`implementation/` vs `verification/`). The suite is workflow-specific — for **research** companions (all in `outputs/`, siblings): `← Dashboard · Report · Exploration · Design · Decision Log · md twin ↗`. For **product-design** companions (in `analysis/` and `outputs/`): `← Dashboard · Problem · Personas · Design Decisions · Feature Spec · Product Brief · md twin ↗` (the orchestrator supplies the exact sibling set that exists). Link only reports that exist or are standard for the workflow. Mark the current report as plain text (no link). **All `.md` links open in a new tab** (`target="_blank" rel="noopener"`) — everywhere in the report, not just the breadcrumb. HTML-to-HTML navigation stays in-tab.

```css
.crumbs { display:flex; gap:14px; font-size:13px; margin-bottom:18px; flex-wrap:wrap; }
.crumbs a.md { margin-left:auto; color:var(--dim); }
.crumbs .here { font-weight:650; color:var(--text); }
```

## Stat-Tile Row (required)

Directly under the header, every companion shows 3-5 headline numbers as tiles:

```html
<div class="tiles">
  <div class="tile"><b>3</b><span>task groups</span></div>
  <div class="tile"><b>22</b><span>total steps</span></div>
  ...
</div>
```
```css
.tiles { display:flex; gap:10px; flex-wrap:wrap; margin:14px 0; }
.tile { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  padding:10px 16px; text-align:center; min-width:90px; }
.tile b { display:block; font-size:20px; letter-spacing:-.01em; }
.tile span { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); }
```

Per artifact: **spec** → requirements count, reuse vs new components, risk level; **plan** → groups, steps, expected tests, execution order; **verification** → verdict, issues by severity; **e2e** → scenarios passed/failed, verdict; **visual-fidelity** → match/deviation/drift counts; **research-report** → findings, sources, confidence level; **solution-exploration** → alternatives explored, recommended approach; **high-level-design** → components, decisions, architecture style; **decision-log** → ADR count by status.

## Anchor TOC (conditional)

When a report exceeds ~5 sections, add a compact anchor-link line under the TL;DR block: `Contents: <a href="#requirements">Requirements</a> · <a href="#stories">User Stories</a> · …`. Skip it for short reports.

## Standard CSS Block

Use this verbatim as the base (extend below it as needed):

```css
:root {
  --bg:#f6f7f9; --surface:#fff; --border:#e2e5ea; --text:#1a1d23; --dim:#6b7280;
  --accent:#4f46e5; --accent-soft:#eef2ff; --ok:#16a34a; --ok-soft:#ecfdf3;
  --warn:#d97706; --warn-soft:#fffbeb; --crit:#dc2626; --crit-soft:#fef2f2;
  --info:#2563eb; --info-soft:#eff6ff; --radius:10px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#111418; --surface:#1a1f26; --border:#2e3640; --text:#e6e9ee; --dim:#9aa4b2;
    --accent:#818cf8; --accent-soft:#26294a; --ok:#4ade80; --ok-soft:#11291a;
    --warn:#fbbf24; --warn-soft:#2e2410; --crit:#f87171; --crit-soft:#321616;
    --info:#60a5fa; --info-soft:#15233a; }
}
* { box-sizing:border-box; }
body { margin:0 auto; max-width:1100px; padding:24px 20px 64px; background:var(--bg);
  color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
h1 { font-size:22px; letter-spacing:-.01em; } h2 { font-size:16px; margin-top:28px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  padding:16px 18px; margin:14px 0; }
.badge { display:inline-block; font-size:11px; font-weight:600; text-transform:uppercase;
  letter-spacing:.04em; padding:2px 8px; border-radius:99px; background:var(--accent-soft); color:var(--accent); }
.sev { display:inline-block; font-size:10.5px; font-weight:700; text-transform:uppercase;
  padding:1.5px 7px; border-radius:99px; margin-right:6px; }
.sev.critical { background:var(--crit-soft); color:var(--crit); }
.sev.warning  { background:var(--warn-soft); color:var(--warn); }
.sev.info     { background:var(--info-soft); color:var(--info); }
.pass { color:var(--ok); font-weight:600; } .fail { color:var(--crit); font-weight:600; }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
th { font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;
  background:var(--accent-soft); padding:1px 5px; border-radius:4px; }
img.shot { max-width:100%; border:1px solid var(--border); border-radius:var(--radius); }
details > summary { cursor:pointer; font-weight:600; }
```

## Per-Artifact Guidance

**Visualize, don't transcribe.** The md already exists for reading top-to-bottom — the companion's job is structure at a glance.

| Companion | Lead with | Visual elements |
|-----------|-----------|-----------------|
| `spec.html` | TL;DR + scope in/out side-by-side | Requirements table (id, requirement, priority), user-story cards, visual-design references with mockup thumbnails when present, collapsed `<details>` for technical depth |
| `implementation-plan.html` | Group count, dependency overview | Task-group cards with dependency arrows (inline SVG or arrow glyphs), per-group checklists, files-to-modify as `<code>` chips, wave/parallelism hints |
| `implementation-verification.html` | Verdict banner (pass / pass-with-issues / fail) | Findings table sorted critical→info with `.sev` badges, per-check section status, fixes-applied list with ✓ |
| `e2e-verification-report.html` | Pass/fail scenario counts | Scenario cards with embedded screenshots (`img.shot`, relative paths), step status lists |
| `visual-fidelity.html` | Overall fidelity verdict | Side-by-side mockup vs rendered screenshot pairs, per-screen discrepancy notes |
| `research-report.html` | Confidence level, findings/sources counts | Findings table (title, category, confidence badge, sources), insight cards, SWOT grid, collapsed `<details>` for evidence/citations |
| `solution-exploration.html` | Alternatives count, recommended approach | Alternative cards side-by-side, trade-off comparison matrix as a table, recommended card highlighted (accent border), "why not others" collapsed |
| `high-level-design.html` | Architecture style, components/decisions counts | C4 diagrams as `<pre>` blocks (keep the ASCII — it's already a diagram), component table, decision summary linking ADR anchors in decision-log.html |
| `decision-log.html` | ADR count, statuses | One card per ADR with status badge (accepted/superseded), anchor ids (`#adr-001`) so other reports can deep-link |
| `product-brief.html` | Personas, key decisions, open risks | Layered brief: problem statement card, persona cards, design-decision table, mockup thumbnails linked relatively when present; the operator-facing deliverable, so make it skimmable top-to-bottom |
| `feature-spec.html` | Requirements, surfaces, out-of-scope | Requirements table, surface/flow cards, in-scope vs out-of-scope side-by-side, collapsed `<details>` for detail |
| `design-decisions.html` | Decisions, trade-offs accepted | Decision cards (selected approach highlighted), trade-off table, rejected-alternatives collapsed |
| `problem-statement.html` | Constraints, success criteria | Problem card, constraints list, success-criteria checklist |
| `personas.html` | Persona count | One card per persona (role, goals, pain points), user-journey steps |

## Progress-Sync Convention (implementation-plan.html only)

The plan companion is the one report whose content changes after generation (steps get checked off during execution). To keep it live without regeneration, the planner MUST render progress markers in this exact form — attribute first, class second:

```html
<section data-group="2" class="group todo"> ... </section>          <!-- one per task group -->
<li data-step="2.3" class="step todo">Write API endpoint</li>       <!-- one per step -->
```

with this CSS (include in the standard style block of the plan companion):

```css
.step.todo::before  { content:"☐ "; color:var(--dim); }
.step.done::before  { content:"☑ "; color:var(--ok); }
.step.done          { color:var(--dim); }
.group.todo .g-badge::after { content:"pending"; }
.group.done .g-badge::after { content:"✓ completed"; color:var(--ok); }
```

The glyph/badge comes from CSS, never from markup — so the executor marks progress with a single unambiguous replacement per item:
`data-step="2.3" class="step todo"` → `data-step="2.3" class="step done"` (same pattern for `data-group`). If a marker is not found (older file, failed generation), skip silently — companions never block.

## Tone & Size

- Same severity vocabulary everywhere: `critical` / `warning` / `info`.
- Prefer tables and badges over prose paragraphs; prefer `<details>` over scrolling walls.
- Keep total file size reasonable (<150KB excluding referenced images); no base64-embedded screenshots — reference them relatively.
