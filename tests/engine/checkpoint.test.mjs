import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { artifactOf, decisionOf, fixOf, fixText, riskOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';
import { panelOf as panelOfCheckpoint } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The checkpoint is the one structured object `gate-brief` builds at a gate;
// every surface — the two in-session pickers, the driven request, a cockpit
// card — is a projection of it. These tests pin its fields and their order,
// the legacy reading every state since the compatibility floor gets, and that
// each projection reproduces the gate layouts it was designed to.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');

function gateBrief(run, node, ...flags) {
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, ...flags]);
}

function checkpointOf(run, node) {
  const result = gateBrief(run, node, '--checkpoint');
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function pickerOf(run, node, profile) {
  const result = gateBrief(run, node, '--json', `--picker=${profile}`);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function overlay(t, name, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${name}.overlay.yml`);
  fs.writeFileSync(file, `${[`extends: builtin:${name}`, ...lines].join('\n')}\n`);
  return file;
}

function onDisk(run, relative) {
  const file = path.join(run.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# written\n');
}

/** Every node before `gate` completed, then `patch` on top. */
function walkTo(t, run, definition, gate, overlays, inputs, patch) {
  const graph = freeze(run, { definition, overlays, inputs });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === gate) break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, { nodes: { ...nodes, ...(patch.nodes ?? {}) }, node_summaries: patch.node_summaries ?? {} });
  return graph;
}

// ---------------------------------------------------------------------------
// the legacy reading
// ---------------------------------------------------------------------------

test('legacy reading: every stored decision shape reads as {decision, by}', () => {
  assert.deepEqual(decisionOf('Tags stay inside the store'), { decision: 'Tags stay inside the store', by: 'run' });
  assert.deepEqual(decisionOf('defaulted: audit-opt-in -> the recommended option, run the audit'),
    { decision: 'the recommended option, run the audit', by: 'default', question_id: 'audit-opt-in' });
  assert.deepEqual(decisionOf('asked: Which line endings? -> Strict CRLF (answered by marek at 2026-10-05T16:30:02Z)'), {
    decision: 'Strict CRLF', by: 'operator', question: 'Which line endings?', answer: 'Strict CRLF',
    answered_by: 'marek', at: '2026-10-05T16:30:02Z',
  });
  assert.deepEqual(decisionOf({ decision: 'Keep the limit', rationale: 'no load data' }),
    { decision: 'Keep the limit', rationale: 'no load data', by: 'run' });
  assert.deepEqual(decisionOf({ question: 'Filter semantics?', answer: 'All of' }),
    { question: 'Filter semantics?', answer: 'All of', decision: 'All of', by: 'operator', as_recommended: null });
  assert.deepEqual(decisionOf({ option: 'continue-past-analysis', answered_by: 'operator', at: 't' }),
    { option: 'continue-past-analysis', answered_by: 'operator', at: 't', decision: 'Continue past analysis', by: 'operator' });
  assert.equal(decisionOf({ decision: 'x', by: 'agent' }).by, 'run', 'a source no reader knows reads as the analysis');
});

test('legacy reading: every stored risk shape reads as {risk, tag, change}', () => {
  assert.deepEqual(riskOf('list(null) now throws → keep list(null) returning every note'),
    { risk: 'list(null) now throws', tag: 'open', change: 'keep list(null) returning every note' });
  assert.deepEqual(riskOf('open: a null element still throws -> treat it like a missing tag'),
    { risk: 'a null element still throws', tag: 'open', change: 'treat it like a missing tag' });
  assert.equal(riskOf('tradeoff: two breaking changes ship under 1.0.0').tag, 'tradeoff');
  assert.equal(riskOf('followup: fix the constructor keys in their own change').tag, 'followup');
  assert.equal(riskOf('left for later: the flaky timer test').tag, 'followup');
  assert.deepEqual(riskOf('recommend stop: the build is red'), { risk: 'the build is red', tag: 'stop', change: null });
  assert.equal(riskOf('resolved: the leak is fixed').tag, 'resolved');
  assert.equal(riskOf('The cache was stale (resolved in round 2)').tag, 'resolved');
  assert.deepEqual(riskOf({ risk: 'x', tag: 'followup' }), { risk: 'x', tag: 'followup', change: null });
});

test('legacy reading: a fix reads as {finding, change}, a string as the change alone', () => {
  assert.deepEqual(fixOf({ finding: 'The tag array was read twice.', change: 'add() reads it once' }),
    { finding: 'The tag array was read twice.', change: 'add() reads it once' });
  assert.deepEqual(fixOf('released the lock'), { finding: null, change: 'released the lock' });
  assert.deepEqual(fixOf({ change: 'Trimmed the tag once' }), { finding: null, change: 'Trimmed the tag once' });
  assert.equal(fixOf({ issue: 'x' }), null, 'a fix naming neither is no fix');
  assert.equal(fixOf('  '), null);
  assert.equal(fixText(fixOf({ finding: 'The tag array was read twice.', change: 'add() reads it once' })),
    'The tag array was read twice → add() reads it once');
  assert.equal(fixText(fixOf('released the lock')), 'released the lock');
});

test('legacy reading: a bare-string artifact is a path with nothing else known', () => {
  assert.deepEqual(artifactOf('analysis/gap-analysis.md'), { path: 'analysis/gap-analysis.md', label: null, html: null, role: null });
});

// ---------------------------------------------------------------------------
// the checkpoint object
// ---------------------------------------------------------------------------

/**
 * The development run of the open audit's specification-gate mock-up: the
 * revised spec with its headline, three decisions the analysis made, nine
 * choices of the user's own (one against the recommendation), typed risks, the
 * audit continue it recommends, and the two documents on disk. The gate decides
 * the audit: one continue runs it, the other goes to planning.
 */
const AUDIT_REASON = 'Cheaper than finding the same gaps during implementation';

function atSpecGate(t, extra = {}) {
  const run = scratch(t);
  const choices = Array.from({ length: 8 }, (_, index) => ({
    decision: `Scope answer ${index + 1}`, by: 'operator', answered_by: 'marek', question_id: `scope-${index + 1}`,
    question: `Scope question ${index + 1}?`, answer: `Scope answer ${index + 1}`, recommended: `Scope answer ${index + 1}`, as_recommended: true,
  }));
  walkTo(t, run, DEVELOPMENT, 'specification-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'ui-mockups': { status: 'skipped' },
      'mockup-approval': { status: 'skipped' },
    },
    node_summaries: {
      specification: {
        status: 'completed',
        recommends: { option: 'continue-to-spec-audit', reason: AUDIT_REASON },
        headline: 'The revised spec makes null mean "not given" for tags and list, and keeps 11 requirements: tags with addTag/removeTag, the all-of filter, toCsv and both copy-leak fixes.',
        summary: 'Revised as you asked: null now counts as a missing value. Everything else is unchanged.',
        decisions: [
          { decision: 'Tags stay inside the store, one shared check for every entry point', by: 'run' },
          { decision: 'toCsv is a separate function exported from the package', by: 'run' },
          { decision: 'update() returns a copy and the notes Map leaves the store object', by: 'run' },
          ...choices,
          {
            decision: 'CSV line endings, strict \\r\\n', by: 'operator', answered_by: 'marek', question_id: 'csv-line-endings',
            question: 'Which line endings should toCsv write?', answer: 'Strict \\r\\n', recommended: 'Platform default (\\n)', as_recommended: false,
          },
        ],
        risks: [
          { risk: 'A null element inside the filter array still throws', tag: 'open', change: 'Treat a null element in the filter like a missing tag' },
          { risk: 'addTag(id, null) throws', tag: 'open', change: 'Keep addTag(id, null) a no-op instead of throwing' },
          { risk: 'Two breaking changes ship under 1.0.0', tag: 'tradeoff' },
          { risk: 'No spreadsheet formula guard; the README warns', tag: 'tradeoff' },
        ],
        artifacts: [
          { path: 'analysis/requirements.md', label: 'Requirements', html: null, role: 'review' },
          { path: 'implementation/spec.md', label: 'Specification', html: 'implementation/spec.html', role: 'primary' },
        ],
        ...extra,
      },
    },
  });
  for (const file of ['analysis/requirements.md', 'implementation/spec.md', 'implementation/spec.html']) onDisk(run, file);
  return run;
}

test('checkpoint: its fields, in the contract\'s order', t => {
  const checkpoint = checkpointOf(atSpecGate(t), 'specification-approval');
  assert.deepEqual(Object.keys(checkpoint), [
    'version', 'kind', 'node', 'header', 'ask', 'headline', 'progress', 'next', 'review', 'closed',
    'fixes', 'decisions', 'risks', 'recommended', 'options', 'grants', 'approves', 'run', 'truncated',
  ]);
  assert.equal(checkpoint.version, 1);
  assert.equal(checkpoint.kind, 'gate');
  assert.equal(checkpoint.node, 'specification-approval');
  assert.equal(checkpoint.header, 'Spec');
  assert.equal(checkpoint.ask, 'Specification complete. Ready to go on?');
  assert.deepEqual(checkpoint.next, { node: 'spec-audit', title: 'Specification audit', end: false, skipped: [] });
  assert.deepEqual(checkpoint.review, [
    { path: 'implementation/spec.md', label: 'Specification', html: 'implementation/spec.html', role: 'primary' },
    { path: 'analysis/requirements.md', label: 'Requirements', html: null, role: 'review' },
  ], 'the primary document first, though it was registered second');
  assert.ok(checkpoint.progress.checkpoint >= 1 && checkpoint.progress.checkpoint <= checkpoint.progress.checkpoints_max);
  assert.deepEqual(checkpoint.grants, {});
  assert.deepEqual(checkpoint.approves, []);
  assert.deepEqual(checkpoint.fixes, [], 'nothing fixed at the specification');
  assert.equal(checkpoint.truncated, false);
  assert.match(checkpoint.run.dir, /2026-01-05-sample$/);
});

test('checkpoint: decisions grouped by who settled them, the user\'s own counted, risks grouped by tag', t => {
  const checkpoint = checkpointOf(atSpecGate(t), 'specification-approval');
  assert.deepEqual(checkpoint.decisions.run.map(each => each.decision), [
    'Tags stay inside the store, one shared check for every entry point',
    'toCsv is a separate function exported from the package',
    'update() returns a copy and the notes Map leaves the store object',
  ]);
  assert.ok(checkpoint.decisions.run.every(each => each.node === 'specification'));
  assert.equal(checkpoint.decisions.operator.count, 9);
  assert.deepEqual(checkpoint.decisions.operator.not_recommended, [{
    decision: 'CSV line endings, strict \\r\\n', question: 'Which line endings should toCsv write?', answer: 'Strict \\r\\n',
    recommended: 'Platform default (\\n)', answered_by: 'marek', node: 'specification',
  }]);
  assert.equal(checkpoint.risks.open.length, 2);
  assert.equal(checkpoint.risks.tradeoff.length, 2);
  assert.deepEqual(checkpoint.risks.stop, []);
  assert.equal(checkpoint.recommended.option, 'continue-to-spec-audit');
  assert.equal(checkpoint.recommended.reason, AUDIT_REASON, 'the reason the closing node gave for the continue it recommends');
});

test('checkpoint: options carry what choosing each does, revise and stop with their details', t => {
  const { options } = checkpointOf(atSpecGate(t), 'specification-approval');
  assert.deepEqual(options.map(option => [option.id, option.effect, option.recommended]), [
    ['continue-to-planning', 'continue', false],
    ['continue-to-spec-audit', 'continue', true],
    ['revise-specification', 'revise', false],
    ['stop-development', 'stop', false],
  ]);
  // Each continue is walked on its own answer: what it sets, and where it leads.
  assert.equal(options[0].consequence, 'Runs implementation planning next.');
  assert.deepEqual(options[0].sets, { spec_audit_enabled: false });
  assert.deepEqual(options[0].next, {
    node: 'planning', title: 'Implementation planning', end: false,
    skipped: [{ node: 'spec-audit', title: 'Specification audit', reason: null }],
  });
  assert.equal(options[1].consequence, `Runs specification audit next. ${AUDIT_REASON}.`);
  assert.equal(options[1].reason, AUDIT_REASON);
  assert.deepEqual(options[1].sets, { spec_audit_enabled: true });
  assert.deepEqual(options[1].next, { node: 'spec-audit', title: 'Specification audit', end: false, skipped: [] });
  const [, , revise, stop] = options;
  assert.equal(revise.consequence, 'Re-runs Specification with your note, then asks this again.');
  assert.deepEqual(revise.reruns, [{ node: 'specification', title: 'Specification' }]);
  assert.deepEqual(revise.revision, { n: 1, max: 10 });
  assert.deepEqual(revise.suggestions, [
    {
      label: 'A null element inside the filter array still throws',
      description: 'Treat a null element in the filter like a missing tag',
      note: 'A null element inside the filter array still throws — Treat a null element in the filter like a missing tag',
      recommended: false,
    },
    {
      label: 'addTag(id, null) throws',
      description: 'Keep addTag(id, null) a no-op instead of throwing',
      note: 'addTag(id, null) throws — Keep addTag(id, null) a no-op instead of throwing',
      recommended: false,
    },
  ], 'suggestions come from the open items only, each its risk then the change, none recommended');
  assert.deepEqual(stop.keeps, ['implementation/spec.md', 'analysis/requirements.md']);
  assert.equal(stop.not_run.next, 'Specification audit');
  assert.ok(stop.not_run.remaining > 1);
});

test('checkpoint: a stop risk, typed or written the old way, recommends stopping with its reason', t => {
  for (const stop of [{ risk: 'the spec contradicts itself on null', tag: 'stop' }, 'recommend stop: the spec contradicts itself on null']) {
    const run = atSpecGate(t, { risks: [stop] });
    const checkpoint = checkpointOf(run, 'specification-approval');
    assert.equal(checkpoint.recommended.option, 'stop-development');
    assert.equal(checkpoint.recommended.reason, 'the spec contradicts itself on null');
    assert.equal(checkpoint.ask, 'Specification complete. Ready to go on?', 'with stopping recommended the ask still reads as a question about the work');
    const rich = pickerOf(run, 'specification-approval', 'rich');
    assert.equal(rich.options[0].id, 'stop-development');
    assert.match(rich.options[0].preview, /^Why stop: the spec contradicts itself on null\nDone: /);
    const plain = pickerOf(run, 'specification-approval', 'plain');
    assert.equal(plain.options[0].label, 'Stop here — the spec contradicts itself on null (Recommended)');
  }
});

test('checkpoint: no headline falls back to the summary\'s first sentence', t => {
  const run = atSpecGate(t, { headline: undefined });
  const text = fs.readFileSync(run.state, 'utf8').replace(/^ {4}headline: .*\n/m, '');
  fs.writeFileSync(run.state, text);
  assert.equal(checkpointOf(run, 'specification-approval').headline, 'Revised as you asked: null now counts as a missing value.');
});

test('checkpoint: the last gate asks the same, and a skipped stretch lands on what actually runs', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'short.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Analysis complete. Continue to the design?"',
    '    options: {go-on: continue, halt: stop}',
    '  design: {uses: "direct:design", needs: [approval], when: "${inputs.design}"}',
    'inputs:', '  design: {type: bool, required: false, default: false}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'short.md'), '# Short — node prose\n\n## `analysis`\n\nA.\n\n## `design`\n\nD.\n');
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Answered.' } } });
  const checkpoint = checkpointOf(run, 'approval');
  assert.equal(checkpoint.ask, 'Analysis complete. Ready to go on?');
  assert.equal(checkpoint.next.end, true);
  assert.deepEqual(checkpoint.next.skipped.map(each => each.node), ['design']);
  assert.equal(checkpoint.options[0].consequence, 'Finishes the run.');
});

test('checkpoint: a step is named without an article, whatever its title\'s shape', t => {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'implementation-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'specification-approval': { status: 'completed', decisions: [{ option: 'continue-to-spec-audit' }] },
    },
    node_summaries: { implementation: { status: 'completed', summary: 'Every group is done.' } },
  });
  // "Choosing the checks" opens with a gerund: an article in front read "the choosing the checks".
  const rich = pickerOf(run, 'implementation-approval', 'rich');
  assert.equal(rich.options[0].label, 'Continue to choosing the checks (Recommended)');
  assert.equal(rich.options[0].description, 'Runs choosing the checks next.');
  assert.match(rich.options.find(option => option.id === 'stop-development').preview, /^Not run: choosing the checks and \d+ later phases\.$/m);
  assert.doesNotMatch(JSON.stringify(rich), /the choosing/);
});

/** The specification gate of a run whose closing node recommends `option`, for `reason`. */
function atSpecGateRecommending(t, option, reason) {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'specification-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'ui-mockups': { status: 'skipped' },
      'mockup-approval': { status: 'skipped' },
    },
    node_summaries: { specification: { status: 'completed', summary: 'The spec is written.', recommends: { option, reason } } },
  });
  return run;
}

test('checkpoint: the gate that decides the audit names it in each continue and its Next, never in the ask', t => {
  const run = atSpecGateRecommending(t, 'continue-to-spec-audit', 'Asked for when the run started');
  const ask = 'Specification complete. Ready to go on?';
  const rich = pickerOf(run, 'specification-approval', 'rich');
  assert.equal(rich.question, `${ask} Type "details" for the full brief.`, 'four options leave no slot for More details');
  assert.deepEqual(rich.options.map(option => option.id), ['continue-to-spec-audit', 'continue-to-planning', 'revise-specification', 'stop-development']);
  assert.equal(rich.options[0].label, 'Continue to the specification audit (Recommended)');
  assert.equal(rich.options[0].description, 'Runs specification audit next. Asked for when the run started.');
  assert.match(rich.options[0].preview, /^Next: Specification audit$/m);
  assert.equal(rich.options[1].label, 'Continue to planning, skip the audit');
  assert.match(rich.options[1].preview, /^Next: Implementation planning \(skipping Specification audit\)$/m);
  const plain = pickerOf(run, 'specification-approval', 'plain');
  assert.equal(plain.question.split('\n').at(-1), ask, 'the plain question still ends with the ask');
  assert.match(plain.question, /^Next \(continue to the specification audit\): Specification audit$/m);
  assert.match(plain.question, /^Next \(continue to planning, skip the audit\): Implementation planning \(skipping Specification audit\)$/m);
  assert.equal(plain.options[0].label, 'Continue to the specification audit — Asked for when the run started (Recommended)');
  assert.equal(JSON.parse(gateBrief(run, 'specification-approval', '--request').stdout).question, ask);
  for (const question of [ask, plain.question.split('\n').at(-1)]) assert.doesNotMatch(question, /audit/i);
});

test('checkpoint: with the audit declined, the specification gate recommends going on to planning', t => {
  const run = atSpecGateRecommending(t, 'continue-to-planning', 'Declined when the run started');
  const checkpoint = checkpointOf(run, 'specification-approval');
  assert.deepEqual(checkpoint.recommended, { option: 'continue-to-planning', reason: 'Declined when the run started' });
  assert.equal(checkpoint.next.node, 'planning', 'the top-level Next is the recommended continue\'s walk');
  const rich = pickerOf(run, 'specification-approval', 'rich');
  assert.equal(rich.options[0].label, 'Continue to planning, skip the audit (Recommended)');
  assert.match(rich.options[0].preview, /^Next: Implementation planning \(skipping Specification audit\)$/m);
  assert.equal(pickerOf(run, 'specification-approval', 'plain').options[0].label,
    'Continue to planning, skip the audit — Declined when the run started (Recommended)');
  const line = gateBrief(run, 'specification-approval', '--oneline').stdout;
  assert.match(line, /Next \(continue-to-planning\): Implementation planning/);
  assert.match(line, /Next \(continue-to-spec-audit\): Specification audit/);
  assert.match(line, /Recommended: continue-to-planning/);
});

// ---------------------------------------------------------------------------
// the projections reproduce the designed layouts
// ---------------------------------------------------------------------------

const SPEC_GLANCE = [
  'Done: The revised spec makes null mean "not given" for tags and list, and keeps 11 requirements: tags with addTag/removeTag, the all-of filter, toCsv and both copy-leak fixes.',
  'Next: Specification audit',
  'Review: implementation/spec.md (HTML beside it), analysis/requirements.md',
  'Open risks:',
  '- A null element inside the filter array still throws',
  '- addTag(id, null) throws',
  'Decided by the run:',
  '- Tags stay inside the store, one shared check for every entry point — specification',
  '- toCsv is a separate function exported from the package — specification',
  '- update() returns a copy and the notes Map leaves the store object — specification',
  'You made 9 choices; 1 differs from the recommendation: CSV line endings, strict \\r\\n.',
];

/**
 * The glance as the rich preview shows it: markdown, so a line after a bullet
 * stands apart from it, and within nine lines, so the open risks stay and the
 * decisions give way to a count.
 */
const SPEC_PREVIEW = [
  ...SPEC_GLANCE.slice(0, 6), '',
  'Decided by the run: 3 decisions, under More details.',
  SPEC_GLANCE.at(-1),
];

test('rich: the specification gate renders as designed — a one-line ask, the glance focused, open risks ahead of decisions', t => {
  const rich = pickerOf(atSpecGate(t), 'specification-approval', 'rich');
  assert.equal(rich.header, 'Spec');
  // Two continues, a revise and a stop fill the four slots, so More details is typed.
  assert.equal(rich.question, 'Specification complete. Ready to go on? Type "details" for the full brief.');
  assert.equal(rich.details, 'typed');
  assert.deepEqual(rich.options.map(option => option.label), [
    'Continue to the specification audit (Recommended)', 'Continue to planning, skip the audit', 'Revise the specification', 'Stop here',
  ]);
  const [focused, other, revise, stop] = rich.options;
  assert.match(other.preview, /^Next: Implementation planning \(skipping Specification audit\)$/m, 'each continue previews where it leads');
  assert.equal(focused.preview, SPEC_PREVIEW.join('\n'));
  assert.ok(focused.preview.length <= 900 && focused.preview.split('\n').length <= 9);
  assert.doesNotMatch(focused.preview, /breaking changes|formula guard|→/, 'no trade-off at the glance, and no risk\'s change');
  assert.equal(revise.preview, [
    'Re-runs: Specification, then asks this checkpoint again.',
    'Suggested notes:',
    '- A null element inside the filter array still throws — Treat a null element in the filter like a missing tag',
    '- addTag(id, null) throws — Keep addTag(id, null) a no-op instead of throwing',
  ].join('\n'));
  assert.deepEqual(revise.note_question, {
    header: 'Revise',
    question: 'What should change? Re-runs: Specification, then asks this checkpoint again.',
    multi_select: true,
    options: [
      { label: 'A null element inside the filter array still throws', description: 'Treat a null element in the filter like a missing tag' },
      { label: 'addTag(id, null) throws', description: 'Keep addTag(id, null) a no-op instead of throwing' },
    ],
  });
  assert.ok(revise.preview.split('\n').length <= 8);
  assert.match(stop.preview, /^Ends the run here\.\nKept: implementation\/spec\.md, analysis\/requirements\.md and the dashboard\.\nNot run: specification audit and \d+ later phases\.\nStart a new run from these files to pick up later\.$/);
  assert.ok(stop.preview.split('\n').length <= 7);
  assert.match(rich.more_details, /\*\*Open\*\*\n- A null element inside the filter array still throws → Treat a null element/);
  assert.match(rich.more_details, /\*\*Trade-offs accepted\*\*\n- Two breaking changes ship under 1\.0\.0/);
});

test('plain: the specification gate renders as designed — the glance, then the ask last; titles carry consequences', t => {
  const plain = pickerOf(atSpecGate(t), 'specification-approval', 'plain');
  assert.equal(plain.header, 'Specification', 'a form property takes the step\'s own title, never the short chip');
  // The glance gives each continue its own Next line, named by its label.
  const glance = SPEC_GLANCE.flatMap(line => line === 'Next: Specification audit' ? [
    'Next (continue to planning, skip the audit): Implementation planning (skipping Specification audit)',
    'Next (continue to the specification audit): Specification audit',
  ] : [line.replace('(HTML beside it)', '(HTML: spec.html)')]);
  assert.equal(plain.question, [...glance, 'Specification complete. Ready to go on?'].join('\n'));
  assert.deepEqual(plain.options.map(option => option.label), [
    `Continue to the specification audit — ${AUDIT_REASON} (Recommended)`,
    'Continue to planning, skip the audit',
    'Revise the specification — re-runs it with your note',
    'Stop here — keeps everything written so far',
    'More details',
  ]);
  assert.ok(plain.question.length <= 1000);
});

test('rich: the research convergence gate goes on to what runs, skipping the declined design', t => {
  const run = scratch(t);
  const titles = overlay(t, 'research', ['display:', '  titles:', '    completion: "Final summary"']);
  walkTo(t, run, RESEARCH, 'convergence-approval', [titles], { question: 'Can the store corrupt a note?' }, {
    nodes: { 'optional-phases-decision': { status: 'completed', values: { brainstorming_enabled: true, design_enabled: false } } },
    node_summaries: {
      'solution-convergence': {
        status: 'completed',
        headline: 'The nine decision areas add up to one 2.0.0 release that is projected to close every path that can corrupt a stored note.',
        summary: 'Converged on nine areas.',
        decisions: [
          { decision: 'Ship every change together as one 2.0.0 release', by: 'run' },
          ...Array.from({ length: 10 }, (_, index) => ({ decision: `Area ${index + 1}: the recommended alternative`, by: 'operator', as_recommended: true })),
        ],
        risks: [{ risk: 'The path-closure projection has not been run', tag: 'open' }],
      },
    },
  });
  const rich = pickerOf(run, 'convergence-approval', 'rich');
  assert.equal(rich.header, 'Solutions');
  assert.equal(rich.question, 'Brainstorming complete. Ready to go on?');
  const glance = rich.options[0].preview.split('\n');
  assert.equal(glance[0], 'Done: The nine decision areas add up to one 2.0.0 release that is projected to close every path that can corrupt a stored note.');
  assert.match(glance[1], /^Next: Final summary \(skipping .*High-level design.*\)$/);
  assert.ok(glance.includes('- Ship every change together as one 2.0.0 release — solution convergence'));
  assert.equal(glance.at(-1), 'You made 10 choices, all as recommended.');
  assert.equal(glance.at(-2), '', 'the user\'s choices stand apart from the last decision');
  assert.ok(glance.indexOf('- The path-closure projection has not been run') < glance.indexOf('- Ship every change together as one 2.0.0 release — solution convergence'),
    'the open risk comes ahead of the decision');
  // The continue label names where the run goes: the design was declined.
  assert.equal(rich.options[0].label, 'Continue to final summary (Recommended)');
  const plain = pickerOf(run, 'convergence-approval', 'plain');
  assert.equal(plain.options.find(option => option.id === 'revise-convergence').label,
    'Ask the decision areas again — re-runs solution convergence with your note');
});

test('rich: with the design taken, the research convergence continue label names the design', t => {
  const run = scratch(t);
  walkTo(t, run, RESEARCH, 'convergence-approval', [], { question: 'Can the store corrupt a note?' }, {
    nodes: { 'optional-phases-decision': { status: 'completed', values: { brainstorming_enabled: true, design_enabled: true } } },
    node_summaries: { 'solution-convergence': { status: 'completed', summary: 'Converged on nine areas.' } },
  });
  assert.equal(pickerOf(run, 'convergence-approval', 'rich').options[0].label, 'Continue to high-level design (Recommended)');
});

test('glance: open risks come ahead of the decisions, which give way first when the lines run short', t => {
  const decisions = Array.from({ length: 4 }, (_, index) => ({ decision: `Audit finding ${index + 1} holds for every entry point`, by: 'audit' }));
  const risks = [
    { risk: 'The type module setting may break the build script', tag: 'open', change: 'Check the build script under the module setting' },
    { risk: 'Test discovery depends on the file name only', tag: 'open', change: 'Name the discovery rule in the spec' },
    { risk: 'The README example was stale', tag: 'resolved' },
  ];
  const run = atSpecGate(t, { decisions, risks });
  const glance = pickerOf(run, 'specification-approval', 'rich').options[0].preview.split('\n');
  assert.ok(glance.length <= 9 && glance.join('\n').length <= 900, glance.join('\n'));
  const at = text => glance.indexOf(text);
  assert.ok(at('Open risks:') > -1, glance.join('\n'));
  assert.ok(at('- The type module setting may break the build script') > at('Open risks:'));
  assert.ok(at('- Test discovery depends on the file name only') > -1);
  const heading = glance.find(line => line.startsWith('Decided by the audit'));
  assert.ok(at(heading) > at('- Test discovery depends on the file name only'), 'the decisions come after the risks');
  assert.match(heading, /^Decided by the audit (\(\+\d+ more under More details\):|: 4 decisions, under More details\.)$/);
  assert.ok(!glance.some(line => /README example|→/.test(line)), 'neither a settled risk nor a risk\'s change at the glance');

  // The plain profile lists them in the same order, its lines not rationed.
  const question = pickerOf(run, 'specification-approval', 'plain').question.split('\n');
  const decided = question.findIndex(line => line.startsWith('Decided by the audit'));
  assert.ok(question.indexOf('- Test discovery depends on the file name only') > -1);
  assert.ok(question.indexOf('- Test discovery depends on the file name only') < decided);
  assert.ok(question.includes('- Audit finding 3 holds for every entry point — audit'));
});

test('glance: a stop risk leads the risks, and the risks past three are counted', t => {
  const risks = [
    ...Array.from({ length: 4 }, (_, index) => ({ risk: `Open risk ${index + 1}`, tag: 'open', change: `Settle risk ${index + 1}` })),
    { risk: 'The guide documents a removed command', tag: 'stop' },
  ];
  const glance = pickerOf(atSpecGate(t, { decisions: [], risks }), 'specification-approval', 'rich')
    .options.find(option => option.description?.startsWith('Runs ')).preview.split('\n');
  const from = glance.findIndex(line => line.startsWith('Open risks'));
  assert.deepEqual(glance.slice(from, from + 4), [
    'Open risks (+2 more under More details):',
    '- Recommends stopping: The guide documents a removed command',
    '- Open risk 1',
    '- Open risk 2',
  ]);
});

test('glance: the heading names who settled what it lists — an audit, defaults, or the run beside them', t => {
  // No risk beside them, so every decision has the room to be listed under its heading.
  const headings = decisions => pickerOf(atSpecGate(t, { decisions, risks: [] }), 'specification-approval', 'rich').options[0].preview
    .split('\n').find(line => /^(Decided|Taken) by/.test(line));
  assert.equal(headings([{ decision: 'Null filter elements are rejected', by: 'audit' }]), 'Decided by the audit:');
  assert.equal(headings([{ decision: 'Run the audit', by: 'default' }]), 'Taken by default:');
  assert.equal(headings([{ decision: 'Patch the tokenizer', by: 'run' }, { decision: 'Null filter elements are rejected', by: 'audit' }]),
    'Decided by the run and the audit:');
  assert.equal(headings([{ decision: 'Patch the tokenizer', by: 'run' }, { decision: 'Run the audit', by: 'default' }]),
    'Decided by the run, or by default:');
});

test('glance: each decision the run made names the step that settled it, never "analysis" for all', t => {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'verification-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'specification-approval': { status: 'completed', decisions: [{ option: 'continue-to-spec-audit' }] },
      'tdd-green': { status: 'skipped' },
      'verification-options': { status: 'completed', values: { user_docs_enabled: false } },
    },
    node_summaries: {
      'verification-options': {
        status: 'completed', summary: 'Completeness, tests and all four reviews.',
        decisions: [{ decision: 'Browser checks are off: the change has no screen', by: 'run' }],
      },
      verification: {
        status: 'completed', headline: 'Three fixes and one re-check: 35 of 35 tests pass.', summary: 'Verified.',
        decisions: [
          { decision: 'Fixed the tag methods crashing on a note stored without tags', by: 'run' },
          { decision: 'The repeated missing-note lookup is one helper', by: 'audit' },
        ],
      },
    },
  });
  const rich = pickerOf(run, 'verification-approval', 'rich');
  const glance = rich.options[0].preview.split('\n');
  assert.ok(glance.includes('Decided by the run and the audit:'), glance.join('\n'));
  assert.ok(glance.includes('- Fixed the tag methods crashing on a note stored without tags — verification'), glance.join('\n'));
  assert.ok(glance.includes('- Browser checks are off: the change has no screen — choosing the checks'), glance.join('\n'));
  assert.ok(glance.includes('- The repeated missing-note lookup is one helper — audit'), glance.join('\n'));
  assert.ok(rich.more_details.includes('- Fixed the tag methods crashing on a note stored without tags — verification'));
  assert.doesNotMatch(rich.options[0].preview + rich.more_details, /— analysis/);
});

test('glance: a plan decision names the planning step on every surface, never the analysis', t => {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'planning-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'specification-approval': { status: 'completed', decisions: [{ option: 'continue-to-planning' }] },
      'spec-audit': { status: 'skipped' },
      'spec-audit-approval': { status: 'skipped' },
    },
    node_summaries: {
      planning: {
        status: 'completed', headline: 'Three task groups, run one after another.', summary: 'Planned.',
        decisions: [{ decision: 'No parallel waves: every group edits the store module', by: 'run' }],
      },
    },
  });
  const line = '- No parallel waves: every group edits the store module — implementation planning';
  const rich = pickerOf(run, 'planning-approval', 'rich');
  assert.ok(rich.options[0].preview.split('\n').includes(line), rich.options[0].preview);
  assert.ok(pickerOf(run, 'planning-approval', 'plain').question.split('\n').includes(line));
  assert.ok(rich.more_details.includes(line));
  assert.doesNotMatch(rich.options[0].preview + rich.more_details, /— analysis/);
});

test('note question: what should change, with what re-runs and how often, the same words in both profiles', t => {
  const run = atSpecGate(t);
  const rich = pickerOf(run, 'specification-approval', 'rich').options.find(option => option.effect === undefined && option.note);
  const plain = pickerOf(run, 'specification-approval', 'plain').options.find(option => option.note);
  assert.equal(plain.note_question.question, rich.note_question.question);
  assert.equal(plain.note_question.header, 'Revise');
  assert.equal(plain.note_question.multi_select, true);
  // A title-only form carries each note whole, once.
  assert.deepEqual(plain.note_question.options, rich.suggestions.map(each => ({ label: each.note })));
  assert.ok(rich.note_question.options.every(each => !/Recommended/.test(each.label)), 'no suggestion is marked recommended');
});

// ---------------------------------------------------------------------------
// the driven request
// ---------------------------------------------------------------------------

test('request: the whole gate request, its summary the one-line form, its artifacts the review list, its checkpoint beside', t => {
  const run = atSpecGate(t);
  const result = gateBrief(run, 'specification-approval', '--request');
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(request), ['node', 'kind', 'question', 'context', 'options', 'multi_select']);
  for (const key of ['version', 'asked_at', 'answer']) assert.equal(Object.hasOwn(request, key), false, `${key} is the writer's`);
  assert.equal(request.kind, 'gate');
  assert.equal(request.question, 'Specification complete. Ready to go on?');
  assert.equal(request.context.summary, gateBrief(run, 'specification-approval', '--oneline').stdout.trimEnd());
  assert.deepEqual(request.context.artifacts, ['implementation/spec.md', 'analysis/requirements.md']);
  assert.deepEqual(request.context.checkpoint, checkpointOf(run, 'specification-approval'));
  assert.deepEqual(request.options.map(option => [option.id, option.effect]), [
    ['continue-to-spec-audit', 'continue'], ['continue-to-planning', 'continue'], ['revise-specification', 'revise'], ['stop-development', 'stop'],
  ]);
  assert.equal(request.options[0].recommended, true);
  assert.equal(request.options[0].description, `Runs specification audit next. ${AUDIT_REASON}.`);
  assert.ok(!request.options[1].recommended);
  assert.equal(request.options[2].note, true);
  assert.ok(request.options[2].suggestions.length >= 2);
  for (const suggestion of request.options[2].suggestions) {
    assert.deepEqual(Object.keys(suggestion), ['label', 'note', 'recommended'], 'a request suggestion carries the gate contract keys only');
  }
  assert.equal(request.multi_select, false);
});

test('oneline: each decision says who settled it and each risk what it is', t => {
  const line = gateBrief(atSpecGate(t), 'specification-approval', '--oneline').stdout;
  assert.match(line, /Decisions: run: Tags stay inside the store/);
  assert.match(line, /operator: CSV line endings, strict/);
  assert.match(line, /Risks: open: A null element inside the filter array still throws → Treat/);
  assert.match(line, /tradeoff: Two breaking changes ship under 1\.0\.0/);
});

test('checkpoint and request: read-only, and refused beside another form', t => {
  const run = atSpecGate(t);
  const before = fs.readFileSync(run.state, 'utf8');
  gateBrief(run, 'specification-approval', '--checkpoint');
  gateBrief(run, 'specification-approval', '--request');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  const both = gateBrief(run, 'specification-approval', '--checkpoint', '--json');
  assert.equal(both.code, 2);
  assert.match(both.stderr, /one form at most/);
});

// ---------------------------------------------------------------------------
// the panel above the question
// ---------------------------------------------------------------------------

/**
 * The rows a panel line costs and the rows a panel may fill, as Claude Code was
 * measured to count them: one row per line plus one per forty characters, twelve
 * in all around the question, two of them the panel's border.
 */
const rows = line => 1 + Math.floor(line.length / 40);
const PANEL_ROWS = 10;

function panelOf(run) {
  return JSON.parse(fs.readFileSync(path.join(run.dir, 'display/next.json'), 'utf8'));
}

function assertFits(glance) {
  assert.ok(glance.length > 0);
  for (const line of glance) {
    assert.equal(typeof line, 'string');
    assert.doesNotMatch(line, /[\r\n]/);
    assert.ok(line.trim() !== '');
  }
  const used = glance.reduce((sum, line) => sum + rows(line), 0);
  assert.ok(used <= PANEL_ROWS, `${used} rows: ${JSON.stringify(glance)}`);
}

test('panel: the brief writes the checkpoint at a glance, for the question it belongs to', t => {
  const run = atSpecGate(t);
  const rich = pickerOf(run, 'specification-approval', 'rich');
  const panel = panelOf(run);
  assert.deepEqual(Object.keys(panel), ['version', 'kind', 'node', 'header', 'question', 'glance', 'checkpoint', 'open_risks', 'parts', 'run_dir']);
  assert.equal(panel.version, 1);
  assert.equal(panel.kind, 'gate');
  assert.equal(panel.node, 'specification-approval');
  assert.equal(panel.header, rich.header);
  assert.equal(panel.question, rich.question, 'the question the session asks, verbatim');
  assert.match(panel.glance[0], /^Checkpoint \d+\/\d+ · Specification$/);
  assert.match(panel.glance[1], /^The revised spec makes null mean "not given"/);
  assert.equal(panel.glance[2], 'Decided: 3 · open risks: 2');
  assert.equal(panel.glance[3], 'Next: Specification audit');
  assert.match(panel.glance[4], /^Review: .*implementation\/spec\.md/);
  assertFits(panel.glance);
});

/** The rows a panel drawn from the labelled parts costs: a label, a space and the text, the files two spaces apart. */
function partsRows(parts) {
  return parts.reduce((sum, part) => {
    if (part.key === 'review') return sum + rows(`${part.label} ${part.files.map(file => file.label).join('  ')}${part.more ? `  +${part.more} more` : ''}`);
    if (part.key === 'counts') return sum + rows(`${part.label} ${part.text}${part.fixed ? ` · ${part.fixed} fixed` : ''} · ${part.risks}`);
    return sum + rows(`${part.label} ${part.text}`);
  }, 0);
}

test('panel: the parts carry each label apart from its text, and each review file as a file:// link', t => {
  const run = atSpecGate(t);
  assert.equal(gateBrief(run, 'specification-approval', '--json').code, 0);
  const panel = panelOf(run);
  const byKey = Object.fromEntries(panel.parts.map(part => [part.key, part]));
  assert.deepEqual(panel.parts.map(part => part.key), ['title', 'headline', 'counts', 'next', 'review']);
  assert.match(byKey.title.label, /^Checkpoint \d+ of \d+$/);
  assert.equal(byKey.title.text, 'Specification');
  assert.equal(`Checkpoint ${panel.checkpoint.index} of ${panel.checkpoint.total}`, byKey.title.label);
  assert.equal(byKey.headline.label, 'Done');
  assert.match(byKey.headline.text, /^The revised spec makes null mean "not given"/);
  assert.deepEqual(byKey.counts, { key: 'counts', label: 'Decided', text: '3', risks: '2 open risks', open: 2, fixed: 0 });
  assert.equal(panel.open_risks, 2);
  assert.deepEqual(byKey.next, { key: 'next', label: 'Next', text: 'Specification audit' });
  assert.equal(byKey.review.label, 'Review');
  const spec = byKey.review.files.find(file => file.path === 'implementation/spec.md');
  assert.ok(spec, JSON.stringify(byKey.review));
  assert.equal(spec.label, 'spec.md');
  assert.equal(spec.href, pathToFileURL(path.join(run.dir, 'implementation/spec.md')).href);
  assert.equal(panel.run_dir, run.dir);
  assert.ok(partsRows(panel.parts) <= PANEL_ROWS);
});

test('panel: the parts hold to the rows too, the review files that do not fit counted as more', () => {
  const long = (word, n) => Array.from({ length: n }, (_, index) => `${word}${index}`).join(' ');
  const checkpoint = {
    ask: 'Ready to go on?',
    header: 'Spec',
    headline: long('headline', 40),
    progress: { checkpoint: 2, checkpoints_max: 10 },
    closed: [{ title: 'Specification' }],
    next: { title: 'Specification audit' },
    review: Array.from({ length: 8 }, (_, index) => ({ path: `implementation/document-number-${index}.md` })),
    decisions: { run: [], audit: [], default: [], operator: { count: 0, not_recommended: [] } },
    risks: { open: [{ risk: 'one' }] },
    options: [{ id: 'continue', label: 'Continue', effect: 'continue', recommended: true, consequence: 'Goes on.' }],
  };
  const { parts } = panelOfCheckpoint(checkpoint);
  assert.ok(partsRows(parts) <= PANEL_ROWS, JSON.stringify(parts));
  const review = parts.find(part => part.key === 'review');
  assert.ok(review.files.length >= 1 && review.more > 0, JSON.stringify(review));
  assert.equal(review.files.length + review.more, 8);
  assert.ok(parts.find(part => part.key === 'headline').text.endsWith('…'));
  assert.deepEqual(parts.find(part => part.key === 'counts'), { key: 'counts', label: 'Decided', text: '0', risks: '1 open risk', open: 1, fixed: 0 });
});

test('panel: a step title is cut only when its rows truly run out', () => {
  const checkpoint = title => ({
    ask: 'Ready to go on?',
    header: 'Plan',
    headline: 'The plan has four groups.',
    progress: { checkpoint: 6, checkpoints_max: 10 },
    closed: [{ title }],
    next: { title: 'Implementation' },
    review: [],
    decisions: { run: [], audit: [], default: [], operator: { count: 0, not_recommended: [] } },
    risks: {},
    options: [{ id: 'continue', label: 'Continue', effect: 'continue', recommended: true, consequence: 'Goes on.' }],
  });
  const whole = panelOfCheckpoint(checkpoint('Implementation planning'));
  assert.deepEqual(whole.parts[0], { key: 'title', label: 'Checkpoint 6 of 10', text: 'Implementation planning' });
  assert.equal(whole.glance[0], 'Checkpoint 6/10 · Implementation planning');
  assert.ok(partsRows(whole.parts) <= PANEL_ROWS);
  const long = panelOfCheckpoint(checkpoint(`Implementation planning ${'and more '.repeat(10)}`));
  assert.ok(long.parts[0].text.endsWith('…'), long.parts[0].text);
  assert.ok(long.glance[0].endsWith('…'), long.glance[0]);
  assert.ok(partsRows(long.parts) <= PANEL_ROWS);
  assertFits(long.glance);
});

test('panel: every form writes the same panel', t => {
  const run = atSpecGate(t);
  const file = path.join(run.dir, 'display/next.json');
  const panels = [[], ['--oneline'], ['--json'], ['--json', '--picker=plain'], ['--checkpoint'], ['--request']].map(flags => {
    fs.rmSync(file, { force: true });
    const result = gateBrief(run, 'specification-approval', ...flags);
    assert.equal(result.code, 0, result.stderr);
    return panelOf(run);
  });
  for (const panel of panels.slice(1)) assert.deepEqual(panel, panels[0]);
});

test('panel: a gate whose every text runs long still fits the rows above the question', t => {
  const long = (word, n) => Array.from({ length: n }, (_, index) => `${word}${index}`).join(' ');
  const paths = Array.from({ length: 12 }, (_, index) => `implementation/a-rather-long-directory-name/document-number-${index}.md`);
  const run = atSpecGate(t, {
    headline: long('headline', 24).slice(0, 219),
    decisions: Array.from({ length: 50 }, (_, index) => ({ decision: long(`decision${index}-`, 30), by: 'run' })),
    risks: Array.from({ length: 30 }, (_, index) => ({ risk: long(`risk${index}-`, 20), tag: 'open' })),
    artifacts: paths.map(file => ({ path: file, label: long('label', 10), html: null, role: 'review' })),
  });
  for (const file of paths) onDisk(run, file);
  gateBrief(run, 'specification-approval', '--json');
  const { glance } = panelOf(run);
  assertFits(glance);
  assert.match(glance[0], /^Checkpoint /);
  assert.ok(glance.some(line => line.endsWith('…')), 'what does not fit is cut, and the cut is marked');
});

test('panel: a gate with no headline of its own fits too', t => {
  const run = atSpecGate(t, { headline: undefined });
  gateBrief(run, 'specification-approval');
  assertFits(panelOf(run).glance);
});

test('panel: one that cannot be written is a stderr warning; the brief prints as it would', t => {
  const run = atSpecGate(t);
  const expected = gateBrief(run, 'specification-approval', '--json').stdout;
  fs.rmSync(path.join(run.dir, 'display/next.json'));
  fs.mkdirSync(path.join(run.dir, 'display/next.json'));
  const result = gateBrief(run, 'specification-approval', '--json');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.deepEqual(JSON.parse(result.stdout).warnings, [], 'nothing for the asking model to relay');
  assert.match(result.stderr, /^warning: display\/next\.json was not written \(display-unwritable: .*\); the brief is unaffected$/m);
});

test('panel: the write that answers the gate removes it', t => {
  const run = atSpecGate(t);
  gateBrief(run, 'specification-approval', '--json');
  assert.ok(fs.existsSync(path.join(run.dir, 'display/next.json')));
  write(run, { nodes: { 'specification-approval': { status: 'completed' } } });
  assert.equal(fs.existsSync(path.join(run.dir, 'display/next.json')), false);
});

// ---------------------------------------------------------------------------
// what the run fixed: apart from what it decided
// ---------------------------------------------------------------------------

const FIXES = [
  { finding: 'add() read the caller\'s tag array twice', change: 'add() reads it once' },
  { finding: 'No test pinned the read-once check', change: 'Added one' },
];

/**
 * A development run paused at `verification-approval`, the verification node's
 * closing summary `verification` on top: what its fix loop applied in
 * `fixes_applied`, and what the reviews settled in `decisions`.
 */
function atVerificationGate(t, verification) {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'verification-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false } },
      'specification-approval': { status: 'completed', decisions: [{ option: 'continue-to-spec-audit' }] },
      'tdd-green': { status: 'skipped' },
      'verification-options': { status: 'completed', values: { user_docs_enabled: false } },
    },
    node_summaries: {
      verification: {
        status: 'completed', headline: 'Verification passes after two fixes.', summary: 'Verified: two issues found, both fixed.',
        ...verification,
      },
    },
  });
  return run;
}

const fixLines = fixes => fixes.map(fix => `- ${fix.finding} → ${fix.change}`);

test('fixes: the checkpoint carries what the run fixed apart from its decisions, each with the step that fixed it', t => {
  const run = atVerificationGate(t, {
    fixes_applied: FIXES,
    decisions: [{ decision: 'The repeated missing-note lookup is one helper', by: 'audit' }],
  });
  const checkpoint = checkpointOf(run, 'verification-approval');
  assert.deepEqual(checkpoint.fixes, FIXES.map(fix => ({ ...fix, node: 'verification' })));
  assert.deepEqual(checkpoint.decisions.run, [], 'a fix is never a decision the run made');
  assert.deepEqual(checkpoint.decisions.audit.map(each => each.decision), ['The repeated missing-note lookup is one helper']);
  assert.equal(checkpoint.version, 1, 'an additive field: the version stays');
});

test('fixes: every surface shows them as "Fixed by the run", never under the decisions', t => {
  const run = atVerificationGate(t, {
    fixes_applied: FIXES,
    decisions: [{ decision: 'The repeated missing-note lookup is one helper', by: 'audit' }],
  });

  // The rich preview: the count, then each fix, ahead of the decisions.
  const rich = pickerOf(run, 'verification-approval', 'rich');
  const glance = rich.options[0].preview.split('\n');
  const at = glance.indexOf('Fixed by the run: 2');
  assert.ok(at > -1, glance.join('\n'));
  assert.deepEqual(glance.slice(at + 1, at + 3), fixLines(FIXES));
  assert.ok(glance.indexOf('Decided by the audit:') > at + 2, glance.join('\n'));
  assert.ok(!glance.some(line => line.startsWith('Decided by the run')), glance.join('\n'));

  // More details: a block of their own, before the decisions.
  const details = rich.more_details;
  assert.ok(details.includes(['**Fixed by the run**', ...fixLines(FIXES)].join('\n')), details);
  assert.ok(details.indexOf('**Fixed by the run**') < details.indexOf('**Decided by the audit**'));

  // The plain profile's question carries the same lines.
  const question = pickerOf(run, 'verification-approval', 'plain').question.split('\n');
  const plainAt = question.indexOf('Fixed by the run: 2');
  assert.deepEqual(question.slice(plainAt + 1, plainAt + 3), fixLines(FIXES));

  // The text form, the one-line form and the request's summary.
  const text = gateBrief(run, 'verification-approval').stdout;
  assert.ok(text.includes(['Fixed by the run:', ...fixLines(FIXES)].join('\n')), text);
  const line = gateBrief(run, 'verification-approval', '--oneline').stdout;
  assert.ok(line.includes(`Fixed by the run: ${FIXES.map(fix => `${fix.finding} → ${fix.change}`).join('; ')}`), line);
  assert.doesNotMatch(line, /Decisions:[^·]*add\(\)/, 'no fix is listed as a decision');
  const request = JSON.parse(gateBrief(run, 'verification-approval', '--request').stdout);
  assert.equal(request.context.summary, line.trimEnd());
  assert.deepEqual(request.context.checkpoint.fixes, checkpointOf(run, 'verification-approval').fixes);

  // The panel counts them beside the decisions and the open risks.
  const panel = panelOf(run);
  assert.ok(panel.glance.includes('Decided: 1 · fixed: 2 · open risks: 0'), JSON.stringify(panel.glance));
  const counts = panel.parts.find(part => part.key === 'counts');
  assert.equal(counts.fixed, 2);
  assert.ok(partsRows(panel.parts) <= PANEL_ROWS);
  assertFits(panel.glance);
});

test('fixes: when the lines run short the decisions give way to their count before the fixes do', t => {
  const decisions = [{ decision: 'The repeated missing-note lookup is one helper', by: 'audit' }];
  const risks = [{ risk: 'Export size is unbounded', tag: 'open', change: 'Cap the export' }];
  const glance = pickerOf(atVerificationGate(t, { fixes_applied: FIXES, decisions, risks }), 'verification-approval', 'rich')
    .options[0].preview.split('\n');
  assert.ok(glance.length <= 9, glance.join('\n'));
  const at = glance.indexOf('Fixed by the run: 2 (+1 more under More details)');
  assert.equal(glance[at + 1], fixLines(FIXES)[0], glance.join('\n'));
  assert.ok(glance.includes('Decided by the audit: 1 decision, under More details.'), glance.join('\n'));
  assert.ok(glance.includes('- Export size is unbounded'), glance.join('\n'));
});

test('fixes: past three the glance counts the rest under More details, which lists every one', t => {
  const many = Array.from({ length: 5 }, (_, index) => ({ finding: `Issue ${index + 1} was open`, change: `Fixed issue ${index + 1}` }));
  const rich = pickerOf(atVerificationGate(t, { fixes_applied: many }), 'verification-approval', 'rich');
  const glance = rich.options[0].preview.split('\n');
  const at = glance.indexOf('Fixed by the run: 5 (+2 more under More details)');
  assert.ok(at > -1, glance.join('\n'));
  assert.deepEqual(glance.slice(at + 1, at + 4), fixLines(many.slice(0, 3)));
  assert.ok(rich.more_details.includes(['**Fixed by the run**', ...fixLines(many)].join('\n')), rich.more_details);
});

test('fixes: when the lines run short they outlast the decisions and give way to a count before the open risks do', t => {
  const many = Array.from({ length: 5 }, (_, index) => ({ finding: `Issue ${index + 1} was open`, change: `Fixed issue ${index + 1}` }));
  const risks = Array.from({ length: 3 }, (_, index) => ({ risk: `Open issue ${index + 1}`, tag: 'open', change: `Settle issue ${index + 1}` }));
  const decisions = Array.from({ length: 4 }, (_, index) => ({ decision: `Review finding ${index + 1} holds`, by: 'audit' }));
  const glance = pickerOf(atVerificationGate(t, { fixes_applied: many, risks, decisions }), 'verification-approval', 'rich')
    .options[0].preview.split('\n');
  assert.ok(glance.length <= 9 && glance.join('\n').length <= 900, glance.join('\n'));
  assert.ok(glance.includes('Fixed by the run: 5, under More details.'), glance.join('\n'));
  assert.ok(glance.includes('Decided by the audit: 4 decisions, under More details.'), glance.join('\n'));
  for (const risk of risks) assert.ok(glance.includes(`- ${risk.risk}`), `${risk.risk} stays in view: ${glance.join('\n')}`);
});

test('fixes: one a fix loop logged as a string is shown as the change it names', t => {
  const run = atVerificationGate(t, { fixes_applied: ['released the lock'] });
  const glance = pickerOf(run, 'verification-approval', 'rich').options[0].preview.split('\n');
  const at = glance.indexOf('Fixed by the run: 1');
  assert.equal(glance[at + 1], '- released the lock', glance.join('\n'));
});
