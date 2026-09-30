import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';
import { scalar } from '../../plugins/maister/lib/canonical.mjs';

// `gate-brief` renders what the operator reads at a gate — the closing node's
// summary, the node that will actually run next and the recommended option —
// from the state and the frozen graph, so that no gate depends on the model
// composing a summary it may keep to itself. The plain form is what the
// operator reads in session; `--json` is the picker built on it; `--oneline` is
// the driven form, which keeps the recommendation and the run line.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const MIGRATION = path.join(ENGINE_DIR, 'workflows/migration.yml');

const SUMMARY = {
  status: 'completed',
  summary: 'Two gaps found in the parser.',
  decisions: [{ decision: 'Patch the tokenizer', rationale: 'smallest change' }],
  risks: ['The fixture corpus is thin'],
  artifacts: [{ path: 'analysis/report.md', label: 'Report', html: null }],
};

function brief(run, node) {
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`]);
}

function oneline(run, node) {
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--oneline']);
}

/** The picker `--json` returns, parsed; the exit code beside it. */
function picker(run, node) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--json']);
  return { code: result.code, stderr: result.stderr, ...JSON.parse(result.stdout) };
}

/** The graph hash a run froze. */
function readGraphHash(run) {
  return fs.readFileSync(run.state, 'utf8').match(/graph_hash: "?(sha256:[0-9a-f]+)"?/)[1];
}

/** The option the picker recommends: always its first. */
function recommendedOf(run, node) {
  const { options } = picker(run, node);
  assert.equal(options.filter(option => option.recommended).length, 1);
  assert.equal(options[0].recommended, true);
  return options[0].id;
}

/** The line every driven brief ends with: where the run lives and where its dashboard is. */
function runLine(run, dashboard = path.join(run.dir, 'dashboard.html')) {
  return `Run: ${run.dir} · Dashboard: ${dashboard}`;
}

/** The picker shows a question of about 2,000 characters; the brief keeps inside this. */
const BUDGET = 1600;

/** Point the frozen run at a definition that no longer exists anywhere. */
function loseDefinition(run) {
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^  source: .*$/m, '  source: gone/nowhere.yml')
    .replace(/^  name: .*$/m, '  name: gone-workflow');
  fs.writeFileSync(run.state, text);
}

/**
 * Drop every node's recorded `needs`, the state a freeze leaves when it could
 * not prove the graph it was sent — the freeze otherwise fills them itself.
 */
function forgetNeeds(run) {
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace(/, needs: \[[^\]]*\]/g, ''));
}

/** A sample run paused at `approval`, its closing node's summary recorded. */
function atApproval(t, summary = SUMMARY) {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, ...(summary ? { node_summaries: { analysis: summary } } : {}) });
  return run;
}

/**
 * A development run paused at `verification-approval`: every node before the
 * gate ended, the verification-options values recorded as given, and the
 * verification summary in place.
 */
function atVerificationApproval(t, values) {
  const run = scratch(t);
  const graph = freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Fix the parser' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  if (values) nodes['verification-options'] = { status: 'completed', values };
  write(run, { nodes, node_summaries: { verification: { ...SUMMARY, summary: 'Verification passed with 2 warnings.' } } });
  return { run, graph };
}

const continueOf = (graph, id) => {
  const gate = graph.nodes.find(node => node.id === id);
  return Object.keys(gate.options).find(option => {
    const effect = gate.options[option];
    return (typeof effect === 'string' ? effect : effect.effect) === 'continue';
  });
};

test('gate-brief: renders the closing summary, its decisions and risks and the next node, with no recommendation and no paths', t => {
  const run = atApproval(t);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, [
    'Two gaps found in the parser.',
    'Decisions: Patch the tokenizer — smallest change',
    'Risks: The fixture corpus is thin',
    'Next: Implementation',
    '',
  ].join('\n'));
  assert.doesNotMatch(result.stdout, /Recommended|Run: |Dashboard|\//);
});

test('gate-brief --json: the question is the brief and the ask; the options are labelled, recommended first, each keeping its id', t => {
  const run = atApproval(t);
  const result = picker(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.ok, true);
  assert.equal(result.question, [
    'Two gaps found in the parser.',
    'Decisions: Patch the tokenizer — smallest change',
    'Risks: The fixture corpus is thin',
    'Next: Implementation',
    '',
    'Analysis complete. Continue to implementation?',
  ].join('\n'));
  // The sample titles its closing node "Scope analysis", which does not fit a
  // chip; the gate's own title "Approve the scope" is cut to fit.
  assert.equal(result.header, 'Approve the…');
  assert.deepEqual(result.options, [
    { id: 'continue', label: 'Continue', description: 'Next: Implementation', recommended: true },
    { id: 'stop-here', label: 'Stop here', description: 'End the run here; nothing further runs.', recommended: false },
  ]);
});

test('gate-brief --json: a stop recommendation moves the stop option first', t => {
  const run = atApproval(t, { ...SUMMARY, risks: ['recommend stop: nothing in the verdict is fixable'] });
  const { options } = picker(run, 'approval');
  assert.deepEqual(options.map(option => [option.id, option.recommended]), [['stop-here', true], ['continue', false]]);
});

test('gate-brief --json: a built-in gate reads its labels and header from the definition, and records by id', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: true });
  const result = picker(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.header, 'Verification');
  assert.deepEqual(result.options.map(option => [option.id, option.label]), [
    ['continue-past-verification', 'Continue'],
    ['stop-development', 'Stop here'],
  ]);
  assert.equal(result.options[0].description, 'Next: User documentation (skipping E2E verification)');
});

test('gate-brief --json: an overlay relabels an option and sets the header, and neither moves the frozen graph', t => {
  const overlay = developmentOverlay(t, [
    'display:',
    '  option_labels:',
    '    verification-approval:',
    '      continue-past-verification: "Ship it"',
    '  headers:',
    '    verification-approval: "Checks"',
  ]);
  const plain = atOverlaidVerificationApproval(t, [], { verification: VERIFIED });
  const run = atOverlaidVerificationApproval(t, [overlay], { verification: VERIFIED });
  assert.equal(readGraphHash(run), readGraphHash(plain));
  const result = picker(run, 'verification-approval');
  assert.equal(result.header, 'Checks');
  assert.deepEqual(result.options.map(option => [option.id, option.label]), [
    ['continue-past-verification', 'Ship it'],
    ['stop-development', 'Stop here'],
  ]);
});

test('gate-brief --json: a gate without labels shows its option ids in sentence case', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'bare.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Done?"',
    '    options: {continue-past-analysis: continue, stop-development: stop}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'bare.md'), '# Bare workflow — node prose\n\n## `analysis`\n\nWrite the report.\n');
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  const result = picker(run, 'approval');
  assert.equal(result.header, 'Analysis');
  assert.deepEqual(result.options.map(option => option.label), ['Continue past analysis', 'Stop development']);
});

test('gate-brief --json: a refusal is the same JSON with ok false, exit 1', t => {
  const result = picker(atApproval(t, null), 'approval');
  assert.equal(result.code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'gate-brief-no-summary');
});

test('gate-brief: --json and --oneline together are refused', t => {
  const run = atApproval(t);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--json', '--oneline']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--oneline or --json/);
});

test('gate-brief: writes nothing', t => {
  const run = atApproval(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const listing = fs.readdirSync(run.dir).sort();
  brief(run, 'approval');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(run.dir).sort(), listing);
});

test('gate-brief: a false guard skips its stretch, and the Next line names the node that actually runs', t => {
  const { run, graph } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: true });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: User documentation \(skipping E2E verification\)$/m);
  assert.equal(recommendedOf(run, 'verification-approval'), continueOf(graph, 'verification-approval'));
  assert.match(result.stdout, /^Verification passed with 2 warnings\.$/m);
  assert.match(oneline(run, 'verification-approval').stdout,
    / · Next: User documentation — skipped: E2E verification, Approve E2E verification · /, 'the driven form keeps its list');
});

test('gate-brief: with every optional stretch off, the Next line lands on finalization', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: false });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: Finalization \(skipping E2E verification and User documentation\)$/m);
});

test('gate-brief: an unguarded next node carries no skipped list', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: true, user_docs_enabled: true });
  assert.match(brief(run, 'verification-approval').stdout, /^Next: E2E verification$/m);
});

test('gate-brief: a risk that recommends stopping makes the stop option the recommended one', t => {
  const run = atApproval(t, { ...SUMMARY, risks: ['recommend stop: nothing in the verdict is fixable'] });
  assert.equal(recommendedOf(run, 'approval'), 'stop-here');
  assert.match(oneline(run, 'approval').stdout, / · Recommended: stop-here · /);
});

test('gate-brief: the last gate of a run names the end of the run', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'tail.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Done. Close the run?"',
    '    options: {close: continue, stop-here: stop}', '',
  ].join('\n'));
  // The prose companion a `direct:` node resolves against, shaped like the
  // sample fixture's: without it the definition does not resolve at all.
  fs.writeFileSync(path.join(run.root, 'tail.md'), '# Tail workflow — node prose\n\n## `analysis`\n\nWrite the report.\n');
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  assert.match(brief(run, 'approval').stdout, /^Next: end of run$/m);
});

for (const [label, setup, node, code] of [
  ['no summary recorded for the closing node', t => atApproval(t, null), 'approval', 'gate-brief-no-summary'],
  ['a node that is not a gate', t => atApproval(t), 'analysis', 'gate-brief-not-a-gate'],
  ['a node the graph does not have', t => atApproval(t), 'nowhere', 'gate-brief-unknown-node'],
  ['a guard value the completed node never recorded', t => atVerificationApproval(t, null).run, 'verification-approval', 'gate-brief-value-missing'],
]) {
  test(`refusal: ${label}`, t => {
    const run = setup(t);
    const result = brief(run, node);
    assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stdout}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(code));
  });
}

test('refusal: the missing value is named with the patch that records it', t => {
  const { run } = atVerificationApproval(t, null);
  const result = brief(run, 'verification-approval');
  assert.match(result.stderr, /verification-options\.values\.browser_tests_enabled/);
});

test('refusal: the value-missing patch re-sends the values already recorded beside the missing key', t => {
  const { run } = atVerificationApproval(t, { user_docs_enabled: true });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-brief-value-missing: /);
  assert.ok(result.stderr.includes('{"nodes":{"verification-options":{"values":{"user_docs_enabled":true,"browser_tests_enabled":<true|false>}}}}'), result.stderr);
});

test('gate-brief: a definition changed since the freeze degrades the Next line and still exits 0', t => {
  const run = atApproval(t);
  const text = fs.readFileSync(run.state, 'utf8').replace(/graph_hash: "?sha256:[0-9a-f]+"?/, 'graph_hash: "sha256:' + '0'.repeat(64) + '"');
  fs.writeFileSync(run.state, text);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Two gaps found in the parser\.$/m);
  assert.match(result.stdout, /^Next: unknown — the definition changed since the freeze$/m);
  assert.equal(recommendedOf(run, 'approval'), 'continue');
  assert.match(result.stderr, /^warning: gate-brief-graph-drift/m);
});

test('gate-brief: --oneline folds the brief onto one flow-safe line', t => {
  const run = atApproval(t, { ...SUMMARY, summary: 'Two gaps found\n  in the "parser".' });
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--oneline']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.endsWith('\n'));
  const line = result.stdout.slice(0, -1);
  assert.doesNotMatch(line, /[\r\n"]/);
  assert.ok(line.includes('Next: Implementation · Recommended: continue'), line);
  assert.equal(line, "Two gaps found in the 'parser'. · Decisions: Patch the tokenizer — smallest change"
    + ` · Risks: The fixture corpus is thin · Next: Implementation · Recommended: continue · ${runLine(run)}`);
  assert.doesNotThrow(() => scalar(line));
});

test('gate-brief: a summary recorded only in the context block\'s phase_summaries is found by its node', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    phase_summaries: { 'phase-1': { node: 'analysis', status: 'completed', summary: 'Scoped from the context block.' } },
  });
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Scoped from the context block\.$/m);
});

test('gate-brief: with no decisions and no risks the brief is the summary and Next', t => {
  const run = atApproval(t, { status: 'completed', summary: 'Nothing to decide.' });
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['Nothing to decide.', 'Next: Implementation', ''].join('\n'));
});

test('gate-brief: a skipped node\'s values read as false', t => {
  const run = scratch(t);
  const graph = freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Fix the parser' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-approval') break;
    nodes[node.id] = { status: node.id === 'verification-options' ? 'skipped' : 'completed' };
  }
  write(run, { nodes, node_summaries: { verification: { status: 'completed', summary: 'Verified.' } } });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: Finalization \(skipping E2E verification and User documentation\)$/m);
});

test('gate-brief: an input the run never recorded takes the definition\'s default', t => {
  const run = scratch(t, { type: 'migration' });
  const graph = freeze(run, { definition: MIGRATION, inputs: { task_description: 'Move the config loader' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  nodes.verification = { status: 'completed', values: { issues_to_resolve: false } };
  write(run, { nodes, node_summaries: { verification: { status: 'completed', summary: 'Compatible.' } } });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: Finalization \(skipping Issue resolution and Documentation\)$/m);
});

test('gate-brief: a negated guard is honoured, and a pending node outside the gate\'s downstream is never Next', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'negated.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1',
    'inputs:', '  quiet: {type: bool, required: false, default: false}',
    'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  aside: {uses: "direct:aside", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Analysis complete. Continue?"',
    '    options: {continue: continue, stop-here: stop}',
    '  report: {uses: "direct:report", needs: [approval], when: "!${inputs.quiet}"}',
    '  wrap-up: {uses: "direct:wrap-up", needs: [report]}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'negated.md'), ['# Negated workflow — node prose', '',
    ...['analysis', 'aside', 'report', 'wrap-up'].flatMap(id => [`## \`${id}\``, '', 'Do the step.', '']),
  ].join('\n'));

  for (const [inputs, expected] of [[null, /^Next: Report$/m], [{ quiet: true }, /^Next: Wrap Up \(skipping Report\)$/m]]) {
    const run_ = inputs ? scratch(t) : run;
    freeze(run_, { definition, inputs });
    write(run_, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
    const result = brief(run_, 'approval');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, expected);
  }
});

test('gate-brief: a downstream node blocked on a pending parallel branch is waited on, not the end of the run', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'parallel.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  aside: {uses: "direct:aside", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Analysis complete. Continue?"',
    '    options: {continue: continue, stop-here: stop}',
    '  join: {uses: "direct:join", needs: [approval, aside]}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'parallel.md'), ['# Parallel workflow — node prose', '',
    ...['analysis', 'aside', 'join'].flatMap(id => [`## \`${id}\``, '', 'Do the step.', '']),
  ].join('\n'));
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: waiting on Aside$/m);
});

test('gate-brief: an unreadable definition with no frozen needs degrades to the nearest recorded summary', t => {
  const run = atApproval(t);
  loseDefinition(run);
  forgetNeeds(run);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Two gaps found in the parser\.$/m);
  assert.match(result.stdout, /^Next: unknown — /m);
  assert.match(oneline(run, 'approval').stdout, / · Recommended: the continue option · /);
  assert.deepEqual(picker(run, 'approval').options, [], 'without the definition the picker names no option it cannot know');
  assert.match(result.stderr, /^warning: gate-brief-graph-drift/m);
  assert.match(result.stderr, /^warning: gate-brief-needs-unknown: .*analysis/m);
});

test('refusal: an unreadable definition and no summary anywhere names no write', t => {
  const run = atApproval(t, null);
  loseDefinition(run);
  forgetNeeds(run);
  const result = brief(run, 'approval');
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^gate-brief-no-graph: /);
  assert.match(result.stderr, /no state write fixes this/);
  assert.doesNotMatch(result.stderr, /node_summaries/);
});

test('refusal: a drift warning is kept beside a no-summary refusal, the code first', t => {
  const run = atApproval(t, null);
  const text = fs.readFileSync(run.state, 'utf8').replace(/graph_hash: "?sha256:[0-9a-f]+"?/, 'graph_hash: "sha256:' + '0'.repeat(64) + '"');
  fs.writeFileSync(run.state, text);
  const result = brief(run, 'approval');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-brief-no-summary: /);
  assert.match(result.stderr, /^warning: gate-brief-graph-drift/m);
});

test('refusal: the no-summary patch names the node that closed, not a placeholder', t => {
  const result = brief(atApproval(t, null), 'approval');
  assert.ok(result.stderr.includes('{"node_summaries":{"analysis":{"summary":"…"}}}'), result.stderr);
  assert.doesNotMatch(result.stderr, /<id>/);
});

test('gate-brief --oneline: the last section names the run directory and its dashboard', t => {
  const run = atApproval(t);
  assert.ok(oneline(run, 'approval').stdout.endsWith(` · ${runLine(run)}\n`));
});

test('gate-brief: without the viewer in the run directory the driven form names the run only, and both forms point at the state file', t => {
  const run = atApproval(t, LONG);
  fs.rmSync(path.join(run.dir, 'dashboard.html'), { force: true });
  const driven = oneline(run, 'approval');
  assert.equal(driven.code, 0, driven.stderr);
  assert.ok(driven.stdout.endsWith(` · Run: ${run.dir}\n`), driven.stdout);
  assert.doesNotMatch(driven.stdout, /Dashboard|see the dashboard/);
  assert.match(driven.stdout, /\(\+\d+ more — see the run's state file\)/);
  const result = brief(run, 'approval');
  assert.doesNotMatch(result.stdout, /dashboard/);
  assert.match(result.stdout, /\(\+\d+ in the run's state file\)/);
});

test('gate-brief --oneline: with html_output false the last section says there is no dashboard', t => {
  const run = atApproval(t);
  write(run, { orchestrator: { options: { html_output: false } } });
  assert.ok(oneline(run, 'approval').stdout.endsWith(` · ${runLine(run, 'none (html_output is false)')}\n`));
});

/** A summary, decisions and risks far larger than a picker shows. */
const LONG = {
  status: 'completed',
  summary: Array.from({ length: 60 }, (_, i) => `Sentence ${i} restates a decision carried forward from an earlier node.`).join(' '),
  decisions: Array.from({ length: 12 }, (_, i) => ({ decision: `Decision ${i} about the parser`, rationale: 'x'.repeat(120) })),
  risks: Array.from({ length: 10 }, (_, i) => `Risk ${i}: ${'y'.repeat(150)}`),
};

test('gate-brief: a long brief is trimmed inside the budget, its lists capped at three, and Next survives whole', t => {
  const run = atApproval(t, LONG);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  const lines = result.stdout.split('\n');
  assert.deepEqual(lines.slice(-2), ['Next: Implementation', '']);
  assert.match(result.stdout, /^Sentence 0 restates/);
  assert.match(result.stdout, /^Decisions: Decision 0 about the parser — .*\(\+\d+ in the dashboard\)$/m);
  assert.match(result.stdout, /^Risks: Risk 0: .*\(\+\d+ in the dashboard\)$/m, 'a trimmed brief still shows its first risk');
});

test('gate-brief: a brief that fits still shows at most three decisions and three risks, pointing at the rest', t => {
  const run = atApproval(t, {
    status: 'completed',
    summary: 'Short.',
    decisions: ['One', 'Two', 'Three', 'Four', 'Five'],
    risks: ['Alpha', 'Beta', 'Gamma', 'recommend stop: Delta'],
  });
  assert.equal(brief(run, 'approval').stdout, [
    'Short.',
    'Decisions: One; Two; Three (+2 in the dashboard)',
    'Risks: recommend stop: Delta · Alpha · Beta (+1 in the dashboard)',
    'Next: Implementation',
    '',
  ].join('\n'));
});

test('gate-brief: a slug key leading a decision is dropped, and a prefix that carries meaning is kept', t => {
  const run = atApproval(t, {
    status: 'completed',
    summary: 'Short.',
    decisions: ['goods-currency-contract: document the currency', { id: 'rate_limit', decision: 'Keep the limit', rationale: 'no load data' }],
    risks: ['open: the fixture corpus is thin', 'defaulted: kept the old limit'],
  });
  const text = brief(run, 'approval').stdout;
  assert.match(text, /^Decisions: document the currency; Keep the limit — no load data$/m);
  assert.match(text, /^Risks: open: the fixture corpus is thin · defaulted: kept the old limit$/m);
  assert.match(oneline(run, 'approval').stdout, /goods-currency-contract: document the currency/, 'the driven form is unchanged');
});

test('gate-brief: a summary is cut at the end of a sentence and says the rest is in the dashboard', t => {
  const run = atApproval(t, { ...LONG, decisions: [], risks: [] });
  const first = brief(run, 'approval').stdout.split('\n')[0];
  const match = first.match(/^(.*) … \(more in the dashboard\)$/);
  assert.ok(match, first);
  assert.match(match[1], /node\.$/, 'the cut lands on a sentence end');
  assert.ok(LONG.summary.startsWith(match[1]));
});

test('gate-brief: --oneline keeps the same budget and never trims its tail', t => {
  const run = atApproval(t, LONG);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--oneline']);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  assert.ok(result.stdout.endsWith(` · Next: Implementation · Recommended: continue · ${runLine(run)}\n`), result.stdout);
  assert.doesNotMatch(result.stdout.slice(0, -1), /[\r\n"]/);
  assert.doesNotThrow(() => scalar(result.stdout.slice(0, -1)));
});

/** The run line's own length for a run directory of `length` characters. */
const runLineLength = length => 'Run: '.length + length + ' · Dashboard: '.length + length + '/dashboard.html'.length;

test('gate-brief: a summary cut inside an emoji never splits the pair', t => {
  for (const lead of ['', 'a']) {
    const run = atApproval(t, { ...LONG, summary: `${lead}${'\u{1F600}'.repeat(1200)}` });
    const result = brief(run, 'approval');
    assert.equal(result.code, 0, result.stderr);
    // A lone surrogate reaches stdout as U+FFFD.
    assert.doesNotMatch(result.stdout, /\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  }
});

test('gate-brief --oneline: the characters a cut reports are exactly the ones it removed', t => {
  const run = atApproval(t, { ...LONG, decisions: [], risks: [] });
  const first = oneline(run, 'approval').stdout.split(' · Next: ')[0];
  const match = first.match(/^(.*) … \(\+(\d+) more characters — see the dashboard\)$/);
  assert.ok(match, first);
  assert.equal(Number(match[2]), LONG.summary.length - match[1].length);
});

test('gate-brief: a stop recommendation keeps its risk in view however many risks are trimmed', t => {
  const risks = [...LONG.risks, ...LONG.risks, 'recommend stop: the build is red'];
  const run = atApproval(t, { ...LONG, risks });
  const result = brief(run, 'approval');
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  assert.equal(recommendedOf(run, 'approval'), 'stop-here');
  assert.match(result.stdout, /^Risks: recommend stop: the build is red/m, 'the reason for the recommendation is shown');
  const driven = oneline(run, 'approval').stdout;
  assert.ok(driven.length <= BUDGET);
  assert.match(driven, /Risks: recommend stop: the build is red/);
});

test('gate-brief: with html_output false a trimmed brief points at the state file', t => {
  const run = atApproval(t, LONG);
  write(run, { orchestrator: { options: { html_output: false } } });
  const result = brief(run, 'approval');
  assert.doesNotMatch(result.stdout, /dashboard/);
  assert.match(result.stdout, /\(\+\d+ in the run's state file\)/);
  assert.match(oneline(run, 'approval').stdout, /\(\+\d+ more — see the run's state file\)/);
});

test('gate-brief --oneline: when the closing lines nearly fill the budget the brief still keeps inside it', t => {
  // A run directory long enough that Next, Recommended and the run line leave
  // about twenty characters for everything else.
  const rootLength = path.join(os.tmpdir(), 'maister-engine-XXXXXX').length;
  const fixed = 'Next: Implementation\nRecommended: continue\n'.length + 1;
  const dirLength = Math.floor((BUDGET - 20 - fixed - runLineLength(0)) / 2);
  const nameLength = dirLength - rootLength - '/.maister/tasks/development/'.length;
  const segments = [];
  for (let left = nameLength; left > 0; left -= 201) segments.push('n'.repeat(Math.min(200, left)));
  const run = scratch(t, { name: segments.join('/').slice(0, nameLength) });
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: LONG } });
  const result = oneline(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  assert.ok(result.stdout.endsWith(`Next: Implementation · Recommended: continue · ${runLine(run)}\n`), result.stdout);
});

// ---------------------------------------------------------------------------
// the stretch a gate closes
// ---------------------------------------------------------------------------

/** An overlay over development, written to a scratch directory removed when the test ends. */
function developmentOverlay(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'development.overlay.yml');
  fs.writeFileSync(file, `${['extends: builtin:development', ...lines].join('\n')}\n`);
  return file;
}

/** A security verifier added after `needs`, placed before `before`, and titled by the overlay. */
function securityVerifier(t, { needs, before }) {
  return developmentOverlay(t, [
    'display:',
    '  titles:',
    '    security-verification: "Security review"',
    'add:',
    '  security-verification:',
    '    uses: agent:security-verifier',
    `    needs: [${needs}]`,
    `    before: [${before}]`,
  ]);
}

/**
 * A development run, over `overlays`, paused at `verification-approval`: every
 * node before the gate ended and `summaries` recorded.
 */
function atOverlaidVerificationApproval(t, overlays, summaries) {
  const run = scratch(t);
  const graph = freeze(run, { definition: DEVELOPMENT, overlays, inputs: { task_description: 'Fix the parser' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  nodes['verification-options'] = { status: 'completed', values: { browser_tests_enabled: false, user_docs_enabled: false } };
  write(run, { nodes, node_summaries: summaries });
  return run;
}

const VERIFIED = { status: 'completed', summary: 'Verification passed with 2 warnings.', risks: ['open: 2 warnings in the parser tests'] };
const SECURITY = {
  status: 'completed',
  summary: 'One critical finding in the rate limiter.',
  risks: ['recommend stop: critical — the rate limiter trusts X-Forwarded-For'],
};

test('gate-brief: a verifier placed before the gate is reported beside the node it closes, and its stop risk decides the recommendation', t => {
  const overlay = securityVerifier(t, { needs: 'verification', before: 'verification-approval' });
  const run = atOverlaidVerificationApproval(t, [overlay], { verification: VERIFIED, 'security-verification': SECURITY });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'Verification: Verification passed with 2 warnings.',
    '',
    'Security review: One critical finding in the rate limiter.',
    'Risks: recommend stop: critical — the rate limiter trusts X-Forwarded-For · open: 2 warnings in the parser tests',
    'Next: Finalization (skipping E2E verification and User documentation)',
    '',
  ].join('\n'));
  assert.equal(recommendedOf(run, 'verification-approval'), 'stop-development');
});

test('gate-brief: a node the closing node waits on is reported too, after it', t => {
  const overlay = securityVerifier(t, { needs: 'verification-options', before: 'verification' });
  const run = atOverlaidVerificationApproval(t, [overlay], { verification: VERIFIED, 'security-verification': SECURITY });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Verification: Verification passed with 2 warnings\.\n\nSecurity review: One critical finding in the rate limiter\.\n/);
  assert.equal(recommendedOf(run, 'verification-approval'), 'stop-development');
});

test('gate-brief: the stretch stops at the previous gate, so what an earlier gate reported is not repeated', t => {
  const run = atOverlaidVerificationApproval(t, [], {
    planning: { status: 'completed', summary: 'Three task groups planned.' },
    'verification-options': { status: 'completed', summary: 'Code review and the pragmatic review are on.' },
    verification: VERIFIED,
  });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Verification: Verification passed with 2 warnings\.\n\nVerification options: Code review and the pragmatic review are on\.\n/);
  assert.doesNotMatch(result.stdout, /Three task groups/);
});

test('refusal: a summary behind the closing node does not stand in for the closing node\'s own', t => {
  const run = atOverlaidVerificationApproval(t, [], {
    'verification-options': { status: 'completed', summary: 'Code review and the pragmatic review are on.' },
  });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes('{"node_summaries":{"verification":{"summary":"…"}}}'), result.stderr);
});

// ---------------------------------------------------------------------------
// a gate that can send the run back
// ---------------------------------------------------------------------------

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

/** The review loop, at its first gate: the draft, figures skipped, and the review recorded. */
function atReview(t, { draft = {}, review = {} } = {}) {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } } },
    node_summaries: { draft: { summary: 'Drafted the guide.', decisions: ['Wrote it for new operators'], risks: ['open: the intro repeats the title'], ...draft } },
  });
  write(run, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  write(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed the draft.', risks: ['open: section 2 contradicts the summary'], ...review } },
  });
  return run;
}

function sendBack(run, note = 'Tighten it') {
  const result = verb(['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'], { note });
  assert.equal(result.code, 0, result.stderr);
}

/** Bring the reset stretch back to the gate, as its re-run does. */
function rerun(run) {
  write(run, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } } });
  write(run, { nodes: { figures: { status: 'skipped' } } });
  write(run, { nodes: { review: { status: 'completed' } } });
}

test('picker: continue, then revise, then stop, and the revise says what it re-runs and which revision it is', t => {
  const run = atReview(t);
  const { options } = picker(run, 'review-approval');
  assert.deepEqual(options.map(option => option.id), ['publish-draft', 'send-back', 'abandon']);
  assert.equal(options[0].description, 'Next: Publish', 'the continue option still names what runs next');
  const revise = options[1];
  assert.equal(revise.label, 'Send back with notes');
  assert.equal(revise.description, 'Re-run Draft, Figures and Review with your note, then ask again (revision 1 of 3).');
  assert.equal(revise.recommended, false, 'a revise is never recommended');
  assert.equal(revise.note, true);
  assert.equal(revise.reruns, 'draft');
  assert.equal(revise.revision, 1);
  assert.equal(Object.hasOwn(options[0], 'note'), false, 'only a revise takes a note');
});

test('picker: the suggestions come from what the stretch found, nearest the gate first, the first recommended', t => {
  const run = atReview(t);
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(suggestions, [
    { label: 'Section 2 contradicts the summary', note: 'Resolve: section 2 contradicts the summary', recommended: true },
    { label: 'The intro repeats the title', note: 'Resolve: the intro repeats the title', recommended: false },
    { label: 'Revisit: Wrote it for new operators', note: 'Revisit the decision: Wrote it for new operators', recommended: false },
  ]);
});

test('picker: at most four suggestions, a long one cut at a word in its label only', t => {
  const long = 'the onboarding chapter explains the dashboard before the operator has any run to look at at all';
  const run = atReview(t, { review: { risks: ['open: a', 'open: b', 'open: c', `open: ${long}`, 'open: e'] } });
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.equal(suggestions.length, 4);
  assert.equal(suggestions.filter(each => each.recommended).length, 1);
  const cut = suggestions[3];
  assert.ok(cut.label.length <= 60 && cut.label.endsWith('…'), cut.label);
  assert.equal(cut.note, `Resolve: ${long}`);
});

test('picker: a stretch that found nothing still offers two concrete edits, never an empty question', t => {
  const run = atReview(t, { draft: { decisions: [], risks: [] }, review: { risks: [] } });
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(suggestions.map(each => each.note), [
    'Make Draft more specific where it is vague',
    'Cut Draft down to what the next step needs',
  ]);
  assert.equal(suggestions[0].recommended, true);
});

test('driven form: a revise section before Recommended, and the recommendation unchanged', t => {
  const run = atReview(t);
  const text = oneline(run, 'review-approval').stdout;
  assert.match(text, / · Next: Publish · revise: send-back reruns=draft revision=1\/3 · Recommended: publish-draft · Run: /);
});

test('a revised gate counts its revision, and once three are spent the option is gone', t => {
  const run = atReview(t);
  sendBack(run);
  rerun(run);
  const second = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.match(second.description, /\(revision 2 of 3\)\.$/);
  assert.match(oneline(run, 'review-approval').stdout, /revision=2\/3/);

  sendBack(run);
  rerun(run);
  sendBack(run);
  rerun(run);
  const spent = picker(run, 'review-approval');
  assert.deepEqual(spent.options.map(option => option.id), ['publish-draft', 'abandon']);
  assert.match(brief(run, 'review-approval').stdout, /^Next: Publish \(revision budget spent\)$/m);
  assert.doesNotMatch(oneline(run, 'review-approval').stdout, /revise:/);
});

test('a gate without a revise option renders exactly as before', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  const text = brief(run, 'approval').stdout;
  assert.doesNotMatch(text, /revision/);
  assert.doesNotMatch(oneline(run, 'approval').stdout, /revise:/);
  assert.equal(picker(run, 'approval').options.some(option => Object.hasOwn(option, 'suggestions')), false);
});
