import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { artifactOf, decisionOf, riskOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';

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

test('legacy reading: a bare-string artifact is a path with nothing else known', () => {
  assert.deepEqual(artifactOf('analysis/gap-analysis.md'), { path: 'analysis/gap-analysis.md', label: null, html: null, role: null });
});

// ---------------------------------------------------------------------------
// the checkpoint object
// ---------------------------------------------------------------------------

/**
 * The development run of the open audit's specification-gate mock-up: the
 * revised spec with its headline, three decisions the analysis made, nine
 * choices of the user's own (one against the recommendation), typed risks, and
 * the two documents on disk. The labels are an overlay's: the mock-up names the
 * destination in the continue label.
 */
function atSpecGate(t, extra = {}) {
  const run = scratch(t);
  const labels = overlay(t, 'development', [
    'display:',
    '  option_labels:',
    '    specification-approval:',
    '      continue-past-specification: "Continue to the specification audit"',
  ]);
  const choices = Array.from({ length: 8 }, (_, index) => ({
    decision: `Scope answer ${index + 1}`, by: 'operator', answered_by: 'marek', question_id: `scope-${index + 1}`,
    question: `Scope question ${index + 1}?`, answer: `Scope answer ${index + 1}`, recommended: `Scope answer ${index + 1}`, as_recommended: true,
  }));
  walkTo(t, run, DEVELOPMENT, 'specification-approval', [labels], { task_description: 'Tag the notes' }, {
    nodes: {
      'ui-mockups': { status: 'skipped' },
      'mockup-approval': { status: 'skipped' },
      specification: { status: 'completed', values: { spec_audit_enabled: true } },
    },
    node_summaries: {
      specification: {
        status: 'completed',
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
    'decisions', 'risks', 'recommended', 'options', 'grants', 'approves', 'run', 'truncated',
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
  assert.equal(checkpoint.recommended.option, 'continue-past-specification');
  assert.equal(checkpoint.recommended.reason, '2 open items; revise to settle them first');
});

test('checkpoint: options carry what choosing each does, revise and stop with their details', t => {
  const { options } = checkpointOf(atSpecGate(t), 'specification-approval');
  assert.deepEqual(options.map(option => [option.id, option.effect, option.recommended]), [
    ['continue-past-specification', 'continue', true],
    ['revise-specification', 'revise', false],
    ['stop-development', 'stop', false],
  ]);
  assert.equal(options[0].consequence, 'Runs the specification audit next.');
  assert.equal(options[1].consequence, 'Re-runs Specification with your note, then asks this again.');
  assert.deepEqual(options[1].reruns, [{ node: 'specification', title: 'Specification' }]);
  assert.deepEqual(options[1].revision, { n: 1, max: 10 });
  assert.deepEqual(options[1].suggestions, [
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
  assert.deepEqual(options[2].keeps, ['implementation/spec.md', 'analysis/requirements.md']);
  assert.equal(options[2].not_run.next, 'Specification audit');
  assert.ok(options[2].not_run.remaining > 1);
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

test('checkpoint: a step the run opted into names itself in the continue label and Next, never in the ask', t => {
  const run = scratch(t);
  walkTo(t, run, DEVELOPMENT, 'specification-approval', [], { task_description: 'Tag the notes' }, {
    nodes: {
      'ui-mockups': { status: 'skipped' },
      'mockup-approval': { status: 'skipped' },
      specification: { status: 'completed', values: { spec_audit_enabled: true } },
    },
    node_summaries: { specification: { status: 'completed', summary: 'The spec is written; the audit was asked for.' } },
  });
  const ask = 'Specification complete. Ready to go on?';
  const rich = pickerOf(run, 'specification-approval', 'rich');
  assert.equal(rich.question, ask);
  assert.equal(rich.options[0].label, 'Continue to the specification audit (Recommended)');
  assert.match(rich.options[0].preview, /^Next: Specification audit$/m);
  const plain = pickerOf(run, 'specification-approval', 'plain');
  assert.equal(plain.question.split('\n').at(-1), ask, 'the plain question still ends with the ask');
  assert.match(plain.question, /^Next: Specification audit$/m);
  assert.equal(plain.options[0].label, 'Continue to the specification audit (Recommended)');
  assert.equal(JSON.parse(gateBrief(run, 'specification-approval', '--request').stdout).question, ask);
  for (const question of [rich.question, plain.question.split('\n').at(-1)]) assert.doesNotMatch(question, /audit/i);
});

// ---------------------------------------------------------------------------
// the projections reproduce the designed layouts
// ---------------------------------------------------------------------------

const SPEC_GLANCE = [
  'Done: The revised spec makes null mean "not given" for tags and list, and keeps 11 requirements: tags with addTag/removeTag, the all-of filter, toCsv and both copy-leak fixes.',
  'Next: Specification audit',
  'Review: implementation/spec.md (HTML beside it), analysis/requirements.md',
  'Decided by the run:',
  '- Tags stay inside the store, one shared check for every entry point — analysis',
  '- toCsv is a separate function exported from the package — analysis',
  '- update() returns a copy and the notes Map leaves the store object — analysis',
  'You made 9 choices; 1 differs from the recommendation: CSV line endings, strict \\r\\n.',
];

/** The glance as the rich preview shows it: markdown, so the user's own choices stand apart from the last bullet. */
const SPEC_PREVIEW = [...SPEC_GLANCE.slice(0, -1), '', SPEC_GLANCE.at(-1)];

test('rich: the specification gate renders as designed — a one-line ask, the glance focused, no risk in it', t => {
  const rich = pickerOf(atSpecGate(t), 'specification-approval', 'rich');
  assert.equal(rich.header, 'Spec');
  assert.equal(rich.question, 'Specification complete. Ready to go on?');
  assert.deepEqual(rich.options.map(option => option.label), [
    'Continue to the specification audit (Recommended)', 'Revise the specification', 'Stop here', 'More details',
  ]);
  const [focused, revise, stop, more] = rich.options;
  assert.equal(focused.preview, SPEC_PREVIEW.join('\n'));
  assert.ok(focused.preview.length <= 900 && focused.preview.split('\n').length <= 9);
  assert.doesNotMatch(focused.preview, /null element|breaking changes|formula guard/, 'no risk at the glance');
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
  assert.match(stop.preview, /^Ends the run here\.\nKept: implementation\/spec\.md, analysis\/requirements\.md and the dashboard\.\nNot run: the specification audit and \d+ later phases\.\nStart a new run from these files to pick up later\.$/);
  assert.ok(stop.preview.split('\n').length <= 7);
  assert.match(more.preview, /\*\*Open\*\*\n- A null element inside the filter array still throws → Treat a null element/);
  assert.match(more.preview, /\*\*Trade-offs accepted\*\*\n- Two breaking changes ship under 1\.0\.0/);
  assert.ok(more.preview.length <= 2000);
});

test('plain: the specification gate renders as designed — the glance, then the ask last; titles carry consequences', t => {
  const plain = pickerOf(atSpecGate(t), 'specification-approval', 'plain');
  assert.equal(plain.header, 'Specification', 'a form property takes the step\'s own title, never the short chip');
  assert.equal(plain.question, [
    ...SPEC_GLANCE.map(line => line.replace('(HTML beside it)', '(HTML: spec.html)')),
    'Specification complete. Ready to go on?',
  ].join('\n'));
  assert.deepEqual(plain.options.map(option => option.label), [
    'Continue to the specification audit (Recommended)',
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
  assert.ok(glance.includes('- Ship every change together as one 2.0.0 release — analysis'));
  assert.equal(glance.at(-1), 'You made 10 choices, all as recommended.');
  assert.equal(glance.at(-2), '', 'the user\'s choices stand apart from the last decision');
  assert.doesNotMatch(rich.options[0].preview, /projection has not been run/);
  // The continue label names where the run goes: the design was declined.
  assert.equal(rich.options[0].label, 'Continue to the final summary (Recommended)');
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
  assert.equal(pickerOf(run, 'convergence-approval', 'rich').options[0].label, 'Continue to the high-level design (Recommended)');
});

test('glance: the heading names who settled what it lists — an audit, defaults, or the run beside them', t => {
  const headings = decisions => pickerOf(atSpecGate(t, { decisions }), 'specification-approval', 'rich').options[0].preview
    .split('\n').find(line => /^(Decided|Taken) by/.test(line));
  assert.equal(headings([{ decision: 'Null filter elements are rejected', by: 'audit' }]), 'Decided by the audit:');
  assert.equal(headings([{ decision: 'Run the audit', by: 'default' }]), 'Taken by default:');
  assert.equal(headings([{ decision: 'Patch the tokenizer', by: 'run' }, { decision: 'Null filter elements are rejected', by: 'audit' }]),
    'Decided by the run and the audit:');
  assert.equal(headings([{ decision: 'Patch the tokenizer', by: 'run' }, { decision: 'Run the audit', by: 'default' }]),
    'Decided by the run, or by default:');
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
  assert.deepEqual(request.options.map(option => option.id), ['continue-past-specification', 'revise-specification', 'stop-development']);
  assert.equal(request.options[0].recommended, true);
  assert.equal(request.options[0].description, 'Runs the specification audit next.');
  assert.equal(request.options[1].note, true);
  assert.ok(request.options[1].suggestions.length >= 2);
  for (const suggestion of request.options[1].suggestions) {
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
