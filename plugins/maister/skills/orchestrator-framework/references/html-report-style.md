# HTML Companion Report Style Guide

Shared conventions for agents that emit an HTML companion next to a markdown artifact. A delegate reaches this file through the `html:` line of the `run-context` block in its prompt; which artifacts owe a companion is declared in the workflow definition's `html_companions` (orchestrator-patterns.md § 9). Goal: every companion looks like part of one family, regardless of which agent or session produced it.

## Hard Rules

1. **Self-contained single file** — inline `<style>`, no external CSS/JS/fonts/CDNs. Images only via relative paths within the task directory (e.g., screenshots) or inline SVG.
2. **Same content as the markdown** — the companion restructures and visualizes; it never contains findings, decisions, or requirements absent from the md.
3. **An explainer never says what its sources do not** — every figure is one a source states, and every section links to the source section holding its evidence.
4. **Relative links only** — link to sibling artifacts relative to the file's own location (companions live next to their md).
5. **Never block the workflow** — if HTML generation fails, keep the md, note the miss in your output, continue.
6. **Open with the summary** — the TL;DR / Key Decisions / Risks block (§ 7) renders as the top section, before any detail.

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

Every companion opens with a breadcrumb bar linking the task's report suite. Paths are fixed relative to the companion's own directory — emit links only for files that exist (or are standard for this workflow, an explainer excepted, see the rule below):

```html
<nav class="crumbs">
  <a href="../dashboard.html">← Dashboard</a>
  <a href="spec.html">Spec</a> <a href="implementation-plan.html">Plan</a>
  <a href="../verification/implementation-verification.html">Verification</a>
  <a href="[twin].md" target="_blank" rel="noopener" class="md">md twin ↗</a>
</nav>
```

Adjust the `../` prefixes to the companion's location (`implementation/` vs `verification/`). The suite is workflow-specific — for **research** companions (all in `outputs/`, siblings): `← Dashboard · Explainer · Report · Exploration · Design · Decision Log · md twin ↗`. On the explainer itself, Explainer is plain text and the md link is the report's (`report md ↗`). For **product-design** companions (in `analysis/` and `outputs/`): `← Dashboard · Scope · Problem · Personas · Alternatives · Design Decisions · Feature Spec · Product Brief · md twin ↗` (the orchestrator supplies the exact sibling set that exists). Link only reports that exist or are standard for the workflow. Mark the current report as plain text (no link). **All `.md` links open in a new tab** (`target="_blank" rel="noopener"`) — everywhere in the report, not just the breadcrumb. HTML-to-HTML navigation stays in-tab.

**An explainer is linked only when its file is on disk** at the time the page is written. The allowance "or are standard for this workflow" never covers an explainer. A page written before its explainer omits the crumb; the explainer writer adds it once the explainer exists, directly after the Dashboard link, or first in the bar when it holds none, and changes nothing else on that page. That crumb is navigation, not content, so the page still says what its markdown says and rule 2 holds.

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

Per artifact: **spec** → requirements count, reuse vs new components, risk level; **plan** → groups, steps, expected tests, execution order; **verification** → verdict, issues by severity; **e2e** → scenarios passed/failed, verdict; **visual-fidelity** → match/deviation/drift counts; **research-report** → findings, sources, confidence level; **explainer** → stated numbers only; **solution-exploration** → alternatives explored, recommended approach; **high-level-design** → components, decisions, architecture style; **decision-log** → ADR count by status.

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
| `visual-fidelity.html` | Overall fidelity verdict | Per screen, the mockup's screenshot beside the implementation's (two `<img>` at the same width, captioned; an ASCII mockup in `<pre>`, an uncaptured one linked), per-screen discrepancy notes; never an embedded HTML mockup (`<iframe>`, `<object>`, `<embed>`) |
| `research-report.html` | Confidence level, findings/sources counts | Findings table (title, category, confidence badge, sources), insight cards, SWOT grid, collapsed `<details>` for evidence/citations |
| `research-explainer.html` | The answer sentence and its biggest stated number | Headline tiles, a mechanism diagram, charts with values as text, an incident timeline, an options matrix against the same cases, decision cards with worked cases, and an evidence link per section |
| `solution-exploration.html` | Alternatives count, recommended approach | Alternative cards side-by-side, trade-off comparison matrix as a table, recommended card highlighted (accent border), "why not others" collapsed |
| `high-level-design.html` | Architecture style, components/decisions counts | C4 diagrams as `<pre>` blocks (keep the ASCII — it's already a diagram), component table, decision summary linking ADR anchors in decision-log.html |
| `decision-log.html` | ADR count, statuses | One card per ADR with status badge (accepted/superseded), anchor ids (`#adr-001`) so other reports can deep-link |
| `product-brief.html` | Personas, key decisions, open risks | Layered brief: problem statement card, persona cards, design-decision table, mockup thumbnails linked relatively when present; the operator-facing deliverable, so make it skimmable top-to-bottom |
| `feature-spec.html` | Requirements, surfaces, out-of-scope | Requirements table, surface/flow cards, in-scope vs out-of-scope side-by-side, collapsed `<details>` for detail |
| `design-decisions.html` | Decisions, trade-offs accepted | Decision cards (selected approach highlighted), trade-off table, rejected-alternatives collapsed |
| `problem-statement.html` | Constraints, success criteria | Problem card, constraints list, success-criteria checklist |
| `personas.html` | Persona count | One card per persona (role, goals, pain points), user-journey steps |

## Explainer page

One designed page built from several finished documents, with no markdown twin. It is named `<subject>-explainer.html` and sits beside the artifact it explains. An explainer keeps hard rules 1, 4 and 5 and its own rule 3. Rule 2 (same content as the markdown) and the summary-first rule 6 do not apply to it: its answer header replaces the TL;DR, and it has no `tldr` section.

**Order.** The answer comes first: a `<header>` with an `<h1>` answer sentence, the biggest stated number, and 3-5 headline tiles of stated numbers. Then, each only when its material exists:

1. a diagram for a mechanism, as inline SVG with labels as text nodes, or ASCII in `<pre>`;
2. charts for numbers, as HTML bars or SVG drawn to scale, each value written as text beside its mark;
3. a to-scale timeline for an incident, times as text;
4. the options side by side as columns against the same real cases as rows, with the recommended or chosen column marked;
5. the decisions with worked cases, or the recommendations with worked cases when nothing was decided. Each decision is a card with its badge, a worked case a source states and its own evidence link.

**Evidence links.** Every block is a `<section>` that opens with an `<h2>` and holds at least one `<a class="evidence" href="<page>#<heading id>">`. The answer header holds one as well. The href is a relative path to a page of the suite, with the id of the heading that holds the evidence.

**Numbers.** Stated numbers only: no computed share, sum, difference or rounding. Tiles, axis ticks and the `title`, `aria-label` and `alt` values follow the same rule. A worked case is a case a source states, with that source's figures. When no source states one, the case is told in words with no new figure.

**Self-contained.** Inline `<style>` built on the standard CSS tokens, dark mode included. No external fonts, CSS or JS, and no `<link>`. No raw Mermaid (`class="mermaid"` or a mermaid fence). Images only by relative path.

**The check.** The page passes the check command before it is handed back: `node <plugin root>/skills/orchestrator-framework/scripts/check-explainer.mjs --page=<page> --source=<source>`, one `--source` per source file or folder. Exit 0 means no finding, exit 1 lists findings to correct or remove, exit 2 means the check could not run.

## Heading anchors (required)

Every companion gives each `##` and `###` heading of its markdown an element whose `id` is that heading's GitHub-style slug, so an explainer can link to the section that holds its evidence. This holds even where the section is restructured into cards or tables. To slug a heading:

1. Remove inline code marks and `*`.
2. Replace a link by its text, and keep `_`.
3. Lowercase.
4. Delete every character that is not a Unicode letter, mark, number, `_`, `-` or space.
5. Turn each space into `-`, so "A — B" becomes `a--b`.
6. Suffix a repeat with `-1`, `-2` and so on.

The decision log's `#adr-NNN` ids stay, and the slug id goes on the card's heading.

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

The glyph/badge comes from CSS, never from markup — so progress is one unambiguous class per item:
`data-step="2.3" class="step todo"` ↔ `data-step="2.3" class="step done"` (same pattern for `data-group`). Other classes may sit beside the marker in the same list; only `todo`/`done` is set. The workflow engine's `sync-plan` verb sets each marker from the markdown plan's checkboxes; the executor runs it after every wave. A marker it cannot find (older file, failed generation) is reported for the work log, never a blocker — companions never block.

## Tone & Size

- Same severity vocabulary everywhere: `critical` / `warning` / `info`.
- Prefer tables and badges over prose paragraphs; prefer `<details>` over scrolling walls.
- Keep total file size reasonable (<150KB excluding referenced images); no base64-embedded screenshots — reference them relatively.
