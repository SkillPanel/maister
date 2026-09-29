import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { scalar } from '../../plugins/maister/lib/canonical.mjs';

// `gate-brief` renders what the operator reads at a gate — the closing node's
// summary, the node that will actually run next and the recommended option —
// from the state and the frozen graph, so that no gate depends on the model
// composing a summary it may keep to itself.

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

/** The line every brief ends with: where the run lives and where its dashboard is. */
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

test('gate-brief: renders the closing summary, its decisions and risks, the next node and the recommended option', t => {
  const run = atApproval(t);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, [
    'Two gaps found in the parser.',
    '',
    'Decisions:',
    '- Patch the tokenizer — smallest change',
    'Risks:',
    '- The fixture corpus is thin',
    '',
    'Next: Implementation',
    'Recommended: continue',
    runLine(run),
    '',
  ].join('\n'));
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
  assert.match(result.stdout, /^Next: User Docs — skipped: E2e Verification, E2e Approval$/m);
  assert.match(result.stdout, new RegExp(`^Recommended: ${continueOf(graph, 'verification-approval')}$`, 'm'));
  assert.match(result.stdout, /^Verification passed with 2 warnings\.$/m);
});

test('gate-brief: with every optional stretch off, the Next line lands on finalization', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: false });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: Finalization — skipped: E2e Verification, E2e Approval, User Docs, Docs Approval$/m);
});

test('gate-brief: an unguarded next node carries no skipped list', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: true, user_docs_enabled: true });
  assert.match(brief(run, 'verification-approval').stdout, /^Next: E2e Verification$/m);
});

test('gate-brief: a risk that recommends stopping makes the stop option the recommended one', t => {
  const run = atApproval(t, { ...SUMMARY, risks: ['recommend stop: nothing in the verdict is fixable'] });
  assert.match(brief(run, 'approval').stdout, /^Recommended: stop-here$/m);
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
  assert.match(result.stdout, /^Recommended: continue$/m);
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

test('gate-brief: with no decisions and no risks the brief is the summary, a blank line, Next and Recommended', t => {
  const run = atApproval(t, { status: 'completed', summary: 'Nothing to decide.' });
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['Nothing to decide.', '', 'Next: Implementation', 'Recommended: continue', runLine(run), ''].join('\n'));
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
  assert.match(result.stdout, /^Next: Finalization — skipped: E2e Verification, E2e Approval, User Docs, Docs Approval$/m);
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
  assert.match(result.stdout, /^Next: Finalization — skipped: Issue Resolution, Resolution Approval, Documentation$/m);
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

  for (const [inputs, expected] of [[null, /^Next: Report$/m], [{ quiet: true }, /^Next: Wrap Up — skipped: Report$/m]]) {
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
  assert.match(result.stdout, /^Recommended: the continue option$/m);
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

test('gate-brief: the last line names the run directory and its dashboard', t => {
  const run = atApproval(t);
  const lines = brief(run, 'approval').stdout.split('\n');
  assert.equal(lines.at(-2), runLine(run));
});

test('gate-brief: without the viewer in the run directory the last line names the run only', t => {
  const run = atApproval(t, LONG);
  fs.rmSync(path.join(run.dir, 'dashboard.html'), { force: true });
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines.at(-2), `Run: ${run.dir}`);
  assert.doesNotMatch(result.stdout, /Dashboard|see the dashboard/);
  assert.match(result.stdout, /\(\+\d+ more — see the run's state file\)/);
});

test('gate-brief: with html_output false the last line says there is no dashboard', t => {
  const run = atApproval(t);
  write(run, { orchestrator: { options: { html_output: false } } });
  const lines = brief(run, 'approval').stdout.split('\n');
  assert.equal(lines.at(-2), runLine(run, 'none (html_output is false)'));
});

/** A summary, decisions and risks far larger than a picker shows. */
const LONG = {
  status: 'completed',
  summary: Array.from({ length: 60 }, (_, i) => `Sentence ${i} restates a decision carried forward from an earlier node.`).join(' '),
  decisions: Array.from({ length: 12 }, (_, i) => ({ decision: `Decision ${i} about the parser`, rationale: 'x'.repeat(120) })),
  risks: Array.from({ length: 10 }, (_, i) => `Risk ${i}: ${'y'.repeat(150)}`),
};

test('gate-brief: a long brief is trimmed inside the budget, and Next, Recommended and the run line survive whole', t => {
  const run = atApproval(t, LONG);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  const lines = result.stdout.split('\n');
  assert.deepEqual(lines.slice(-4), ['Next: Implementation', 'Recommended: continue', runLine(run), '']);
  assert.match(result.stdout, /\(\+\d+ more — see the dashboard\)/);
  assert.match(result.stdout, /^Sentence 0 restates/);
  assert.match(result.stdout, /^Risks:$/m, 'a trimmed brief still shows its first risk');
  assert.match(result.stdout, /^- Risk 0: /m);
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

test('gate-brief: the characters a cut reports are exactly the ones it removed', t => {
  const run = atApproval(t, { ...LONG, decisions: [], risks: [] });
  const first = brief(run, 'approval').stdout.split('\n')[0];
  const match = first.match(/^(.*) … \(\+(\d+) more characters — see the dashboard\)$/);
  assert.ok(match, first);
  assert.equal(Number(match[2]), LONG.summary.length - match[1].length);
});

test('gate-brief: a stop recommendation keeps its risk in view however many risks are trimmed', t => {
  const risks = [...LONG.risks, ...LONG.risks, 'recommend stop: the build is red'];
  const run = atApproval(t, { ...LONG, risks });
  const result = brief(run, 'approval');
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  assert.match(result.stdout, /^Recommended: stop-here$/m);
  assert.match(result.stdout, /^- recommend stop: the build is red$/m, 'the reason for the recommendation is shown');
});

test('gate-brief: with html_output false a trimmed brief points at the state file', t => {
  const run = atApproval(t, LONG);
  write(run, { orchestrator: { options: { html_output: false } } });
  const result = brief(run, 'approval');
  assert.doesNotMatch(result.stdout, /see the dashboard/);
  assert.match(result.stdout, /\(\+\d+ more — see the run's state file\)/);
});

test('gate-brief: when the closing lines nearly fill the budget the brief still keeps inside it', t => {
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
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.length <= BUDGET, `brief is ${result.stdout.length} characters`);
  assert.deepEqual(result.stdout.split('\n').slice(-4), ['Next: Implementation', 'Recommended: continue', runLine(run), '']);
});
