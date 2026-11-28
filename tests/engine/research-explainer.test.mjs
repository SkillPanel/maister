import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, freeze, readDashboard, scratch, variantRoot, write } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// Wiring of the research explainer: the style-guide contract and the prose
// points no other test reads. Later groups add their own tests below, using the
// read helpers here.

const PLUGIN = path.join(ROOT, 'plugins/maister');
// Line ends are normalised: a Windows checkout gives .md and .html files CRLF.
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8').replace(/\r\n/g, '\n');
const GUIDE = 'skills/orchestrator-framework/references/html-report-style.md';

/** The body of the `## <title>` section of a markdown text, up to the next `## `. */
function section(text, title) {
  const start = text.indexOf(`\n## ${title}\n`);
  assert.ok(start >= 0, `a "## ${title}" section exists`);
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 4);
  return end < 0 ? rest : rest.slice(0, end);
}

test('the style guide holds the explainer page and heading anchors sections', () => {
  const guide = read(GUIDE);
  const page = section(guide, 'Explainer page');
  assert.ok(page.includes('<a class="evidence"'));
  assert.match(page, /Stated numbers only/);
  assert.match(page, /told in words with no new figure/);
  assert.match(page, /no `<link>`/);
  assert.match(page, /No raw Mermaid/);
  assert.ok(page.includes('node <plugin root>/skills/orchestrator-framework/scripts/check-explainer.mjs'));
  assert.doesNotMatch(page, /research-foundation|solution-convergence|high-level-design/);
  const anchors = section(guide, 'Heading anchors (required)');
  assert.match(anchors, /GitHub-style slug/);
  assert.match(anchors, /`a--b`/);
});

test('hard rule 2 is unchanged and the explainer rule follows it', () => {
  const rules = section(read(GUIDE), 'Hard Rules');
  assert.ok(rules.includes(
    '2. **Same content as the markdown** — the companion restructures and visualizes; it never contains findings, decisions, or requirements absent from the md.\n'
    + '3. **An explainer never says what its sources do not** — every figure is one a source states, and every section links to the source section holding its evidence.\n'
    + '4. **Relative links only**'));
  assert.match(rules, /\n6\. \*\*Open with the summary\*\*/);
});

test('the navigation section links an explainer only when its file is on disk', () => {
  const nav = section(read(GUIDE), 'Cross-Report Navigation (required)');
  assert.match(nav, /An explainer is linked only when its file is on disk/);
  assert.match(nav, /never covers an explainer/);
  assert.ok(nav.includes('`← Dashboard · Explainer · Report · Exploration · Design · Decision Log · md twin ↗`'));
  assert.match(nav, /`report md ↗`/);
});

test('the two named writers and the framework table carry the new items', () => {
  const synth = read('agents/research-synthesizer.md');
  assert.match(synth, /Heading ids.*`##` and `###` heading.*GitHub-style slug/);
  assert.match(synth, /only when `outputs\/research-explainer\.html` is on disk as the page is written/);
  assert.match(read('agents/html-companion-writer.md'), /`##` and `###` heading of the md an element whose `id` is its GitHub-style slug/);
  assert.match(read('skills/orchestrator-framework/SKILL.md'), /\| `scripts\/check-explainer\.mjs` \|/);
});

// ---------------------------------------------------------------------------
// The research definition declares the page and changes nothing else.

const research = () => readDefinition(path.join(PLUGIN, 'skills/workflow-engine/workflows/research.yml')).doc;

test('research declares the explainer first on the foundation and in the workflow outputs', () => {
  const doc = research();
  const artifacts = doc.nodes['research-foundation'].outputs.artifacts;
  assert.deepEqual(Object.entries(artifacts)[0], ['explainer', 'outputs/research-explainer.html']);
  assert.equal(doc.outputs.artifacts.explainer, 'research-foundation.artifacts.explainer');
});

test('the foundation brief records the explainer absence in one fixed line', () => {
  const absent = research().brief['research-foundation'].absent;
  assert.equal(absent.explainer,
    'HTML output is off for this run, the project\'s config turns this explainer off, or the explainer writer failed twice; the step\'s summary says which.');
});

test('companions and delegates are unchanged and the later nodes declare no explainer', () => {
  const doc = research();
  assert.deepEqual(JSON.parse(JSON.stringify(doc.html_companions)), {
    'research-foundation': ['report'],
    'solution-generation': ['exploration'],
    'high-level-design': ['design', 'decision_log'],
  });
  const delegates = Object.fromEntries(Object.entries(doc.brief).map(([node, row]) => [node, row.delegates]));
  assert.deepEqual(JSON.parse(JSON.stringify(delegates)), {
    'research-foundation': ['research-planner', 'information-gatherer', 'research-synthesizer'],
    'high-level-design': ['solution-designer'],
  });
  for (const node of ['solution-convergence', 'high-level-design']) {
    assert.equal(doc.nodes[node].outputs?.artifacts?.explainer, undefined, node);
    assert.equal(doc.brief[node].absent?.explainer, undefined, node);
  }
});

// ---------------------------------------------------------------------------
// The research guide dispatches the writer at three points, checks the page
// itself and registers it first.

const RESEARCH_GUIDE = 'skills/workflow-engine/workflows/research.md';
const researchGuide = () => read(RESEARCH_GUIDE);
const CHECK_SCRIPT = '${CLAUDE_PLUGIN_ROOT}/skills/orchestrator-framework/scripts/check-explainer.mjs';
const WRITING_NODES = ['research-foundation', 'solution-convergence', 'high-level-design'];

/** The paragraph of `text` that opens with the bold run-in `**<label>.**`. */
function part(text, label) {
  const start = text.indexOf(`\n**${label}.**`);
  assert.ok(start >= 0, `a **${label}.** part exists`);
  const rest = text.slice(start + 1);
  const end = rest.search(/\n\s*\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

const PRODUCT_GUIDE = 'skills/workflow-engine/workflows/product-design.md';

test('each writing step runs the check and registers the page first; only the two later steps look up the writer model', () => {
  const guide = researchGuide();
  for (const node of WRITING_NODES) {
    const body = section(guide, `\`${node}\``);
    assert.ok(body.includes('`maister:explainer-writer`'), `${node}: names the writer`);
    if (node === 'research-foundation') {
      // The brief prints the writer's model and effort on its `explainer writer:` line, so the foundation makes no lookup.
      assert.ok(!body.includes('dispatch-model'), `${node}: no dispatch-model call`);
    } else {
      assert.ok(body.replace(/\s+/g, ' ').includes(
        `workflow.mjs dispatch-model --agent=maister:explainer-writer --host=claude --state=<task path>/orchestrator-state.yml --node=${node}`),
      `${node}: the writer's dispatch-model call names this node`);
    }
    assert.ok(body.includes(CHECK_SCRIPT), `${node}: names the check script`);
    const writes = part(body, 'Writes');
    assert.equal(/outputs\/[a-z-]+\.(html|md)/.exec(writes)?.[0], 'outputs/research-explainer.html',
      `${node}: the Writes part registers the explainer first`);
  }
});

test('no guide claims the explainer writer is outside the brief\'s declared delegates', () => {
  const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter(file => file.endsWith('.md'));
  assert.ok(files.length > 0, 'the plugin holds Markdown files');
  for (const file of files) {
    assert.doesNotMatch(read(file), /not one of the brief's declared delegates/, file);
  }
});

test('the product-design intake copies the Explore model and effort the brief prints, with no lookup call', () => {
  const intake = section(read(PRODUCT_GUIDE), '`intake`');
  assert.ok(!intake.includes('dispatch-model'), 'the intake names no dispatch-model call');
  assert.ok(intake.includes('`Explore`'), 'the intake still fans out Explore agents');
});

test('the foundation has five steps and the design four parts, the new ones in place', () => {
  const guide = researchGuide();
  const foundation = section(guide, '`research-foundation`');
  assert.match(foundation, /\*\*Does\.\*\* Five steps in order/);
  assert.match(foundation, /the explainer \(5\)/);
  assert.ok(foundation.includes('\n### Step 5 — explain (delegate)\n'));
  assert.ok(foundation.indexOf('### Step 4') < foundation.indexOf('### Step 5'));
  assert.ok(foundation.indexOf('### Step 5') < foundation.indexOf('\n**Asks.**'));
  const design = section(guide, '`high-level-design`');
  assert.match(design, /\*\*Does\.\*\* Four parts\./);
  const partC = design.indexOf('\n### Part C');
  const partD = design.indexOf('\n### Part D — explainer (delegate)\n');
  assert.ok(partC >= 0 && partD > partC, 'Part D follows Part C');
  assert.ok(partD < design.indexOf('\n**Asks.**'), 'Part D sits before Asks');
});

test('completion lists the explainer first, and embedded mode names the output and the parent\'s absence rule', () => {
  const guide = researchGuide();
  const completion = section(guide, '`completion`').replace(/\s+/g, ' ');
  assert.ok(completion.includes('1. Inventory the outputs: the explainer when it was written, then the research report always, plus the solution exploration, the high-level design and the decision log when the stretches that produce them ran.'));
  const files = completion.slice(completion.indexOf('Files'));
  assert.ok(files.indexOf('explainer') >= 0 && files.indexOf('explainer') < files.indexOf('report'),
    'Files lists the explainer before the report');
  const embedded = section(guide, 'Embedded mode').replace(/\s+/g, ' ');
  assert.ok(embedded.includes('`explainer`') && embedded.includes('`report`'));
  assert.ok(embedded.includes('`absent: {explainer: …}`'));
  assert.ok(embedded.includes('`missing-artifact`'));
  assert.match(embedded, /own `brief:`/);
});

test('convergence and the design pass their decisions as a file from a scratch-dir directory inside the run', () => {
  const guide = researchGuide();
  for (const node of ['solution-convergence', 'high-level-design']) {
    const body = section(guide, `\`${node}\``).replace(/\s+/g, ' ');
    assert.ok(body.includes('scratch-dir --for=decisions'), `${node}: makes the directory with scratch-dir`);
    assert.ok(!body.includes('mktemp'), `${node}: never the system temp directory`);
    assert.match(body, /`stage: (convergence|design)`/, `${node}: names its stage`);
    assert.match(body, /`sources`[^`]*(`[^`]*`[^`]*){0,6}the decisions file/, `${node}: the decisions file is one of the writer's sources`);
    assert.match(body, /`--source` for the decisions file/, `${node}: its own check reads the decisions file`);
    assert.match(body, /not registered|do not register|never registered/, `${node}: the decisions file is not an artifact`);
    assert.ok(body.includes('plus the `run-context --node=research-foundation` output'),
      `${node}: the writer gets the foundation's run context`);
  }
});

// ---------------------------------------------------------------------------
// The dashboard's hero row leads the research workflow with the explainer and
// keeps the other entries, in order, and every other workflow's map as it was.

const DASHBOARD = 'skills/orchestrator-framework/assets/dashboard.html';

/** The entry lines of one workflow's `HERO_MAP` array, trimmed, as the viewer's source writes them. */
function heroLines(html, workflow) {
  const start = html.indexOf('const HERO_MAP = {');
  assert.ok(start >= 0, 'the viewer declares HERO_MAP');
  const block = html.slice(start, html.indexOf('\n};', start));
  const m = new RegExp(`\\n  "?${workflow}"?: \\[\\n([\\s\\S]*?)\\n  \\]`).exec(block);
  assert.ok(m, `${workflow} has a hero array`);
  return m[1].split('\n').map((line) => line.trim().replace(/,$/, ''));
}

test('the research hero row leads with the explainer, labelled Explainer', () => {
  const lines = heroLines(read(DASHBOARD), 'research');
  assert.equal(lines[0], '{ match: "outputs/research-explainer.html", label: "Explainer" }');
});

test('the other research hero entries keep their order and every other workflow keeps its map', () => {
  const html = read(DASHBOARD);
  assert.deepEqual(heroLines(html, 'research').slice(1), [
    '{ match: "outputs/research-report.md", label: "Research Report" }',
    '{ match: "outputs/solution-exploration.md", label: "Solution Exploration" }',
    '{ match: "outputs/high-level-design.md", label: "High-Level Design" }',
    '{ match: "outputs/decision-log.md", label: "Decision Log" }',
  ]);
  const verification = '{ match: "verification/implementation-verification.md", label: "Verification", verdictFallback: true }';
  const spec = '{ match: "implementation/spec.md", label: "Specification" }';
  const plan = '{ match: "implementation/implementation-plan.md", label: "Implementation Plan" }';
  // Development, performance and product design lead with their own explainers
  // (explainers.test.mjs); migration has none.
  assert.deepEqual(heroLines(html, 'development'), [
    '{ match: "verification/change-explainer.html", label: "Explainer" }',
    spec,
    '{ match: "implementation/spec-explainer.html", label: "Spec Explainer" }',
    plan,
    verification,
  ]);
  assert.deepEqual(heroLines(html, 'performance'), ['{ match: "verification/performance-explainer.html", label: "Explainer" }', spec, plan, verification]);
  assert.deepEqual(heroLines(html, 'migration'), [spec, plan, verification]);
  assert.deepEqual(heroLines(html, 'product-design'), [
    '{ match: "outputs/product-explainer.html", label: "Explainer" }',
    '{ match: "outputs/product-brief.md", label: "Product Brief" }',
    '{ match: "analysis/feature-spec.md", label: "Feature Spec" }',
    '{ match: "analysis/design-decisions.md", label: "Design Decisions" }',
  ]);
});

// The user docs and the generated interface name the explainer.

const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('the generated interface lists the explainer writer among its agents', () => {
  const iface = JSON.parse(readRoot('plugins/maister/interface.json'));
  assert.ok(iface.agents.includes('explainer-writer'));
});

test('the research section of the workflow docs names the explainer before the report', () => {
  const research = section(readRoot('docs/workflows.md'), 'Research');
  const explainer = research.indexOf('outputs/research-explainer.html');
  const report = research.indexOf('outputs/research-report.md');
  assert.ok(explainer >= 0, 'the research section names outputs/research-explainer.html');
  assert.ok(report >= 0, 'the research section names outputs/research-report.md');
  assert.ok(explainer < report);
});

// ---------------------------------------------------------------------------
// gap-analysis additions
// ---------------------------------------------------------------------------

test('the Copilot variant\'s explainer writer carries a tool allowlist without the agent tool', () => {
  const text = fs.readFileSync(path.join(variantRoot(), 'agents/explainer-writer.md'), 'utf8');
  const tools = /^tools:\s*(\[.*\])\s*$/m.exec(text);
  assert.ok(tools, 'the variant agent has a tools line');
  const list = JSON.parse(tools[1]);
  assert.ok(list.length > 0);
  assert.ok(!list.some(each => /^(agent|task)$/i.test(each)), `no agent tool in ${tools[1]}`);
});

test('the new shipped files carry no task context, time prediction or paid-edition name', () => {
  const files = [
    'agents/explainer-writer.md',
    'skills/orchestrator-framework/scripts/check-explainer.mjs',
    GUIDE,
    RESEARCH_GUIDE,
    'skills/workflow-engine/workflows/research.yml',
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(text, /\bpro (edition|plugin)\b/i, `${rel}: paid edition`);
    assert.doesNotMatch(text, /\b(usually|typically|takes about|roughly)\s+\d+\s*(-|–|to)?\s*\d*\s*(seconds?|minutes?|min|hours?)\b/i, `${rel}: time prediction`);
    assert.doesNotMatch(text, /\.maister\/tasks\/development\/2026-11-19|implementation-plan\.md|\bGroup \d+\b|\bwork-log\b/, `${rel}: task context`);
  }
});

test('a research explainer absence projects with the declared path the dashboard viewer matches', t => {
  const run = scratch(t, { type: 'research', name: '2026-01-05-sample' });
  freeze(run, { definition: path.join(PLUGIN, 'skills/workflow-engine/workflows/research.yml'), inputs: { question: 'Why are nightly builds slow?' } });
  write(run, {
    nodes: { 'research-foundation': { status: 'completed' } },
    node_summaries: { 'research-foundation': { summary: 'Done.', delegated: ['research-planner', 'information-gatherer', 'research-synthesizer'], absent: { explainer: 'HTML output is off for this run' } } },
  });
  const phase = readDashboard(run).phases.find(each => each.id === 'research-foundation');
  assert.deepEqual(phase.absent, [{ artifact: 'explainer', path: 'outputs/research-explainer.html', reason: 'HTML output is off for this run' }]);

  // The viewer's own matcher, taken from the shipped page, finds it by the hero entry's suffix.
  const html = read('skills/orchestrator-framework/assets/dashboard.html');
  const fn = /function findAbsence\(phases, suffix\) \{[\s\S]*?\n\}\n/.exec(html);
  assert.ok(fn, 'findAbsence is in the page');
  const findAbsence = new Function(`${fn[0]}; return findAbsence;`)();
  const hero = /\{ match: "(outputs\/research-explainer\.html)", label: "Explainer" \}/.exec(html);
  assert.ok(hero, 'the research hero entry exists');
  assert.equal(findAbsence([phase], hero[1])?.reason, 'HTML output is off for this run');
});
