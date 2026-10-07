import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, lastLine, scratch, verb, write } from '../helpers.mjs';
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

test('gate-brief: renders the closing summary, its decisions and risks, the next node and the dashboard, with no recommendation', t => {
  const run = atApproval(t);
  const result = brief(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, [
    'Two gaps found in the parser.',
    'Decisions:',
    '- Patch the tokenizer',
    'Risks:',
    '- The fixture corpus is thin',
    'Next: Implementation',
    '',
  ].join('\n'));
  assert.doesNotMatch(result.stdout, /Recommended|Run: |Review: |Dashboard:|file:\/\//, 'the registered report is not on disk, so nothing is named to review, and the dashboard is never named');
});

test('gate-brief --json: the question is the one-line ask; the options are labelled, recommended first, each keeping its id', t => {
  const run = atApproval(t);
  const result = picker(run, 'approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.ok, true);
  // The ask named a destination; the question names where the run actually goes.
  assert.equal(result.question, 'Analysis complete. Ready to go on?');
  assert.doesNotMatch(result.question, /\n|Dashboard|file:\/\//, 'one line, and no path');
  // The sample titles its closing node "Scope analysis", which does not fit a
  // chip; the gate's own title "Approve the scope" is cut to fit.
  assert.equal(result.header, 'Approve the…');
  assert.deepEqual(result.options.map(({ preview: _preview, ...option }) => option), [
    // A bare "Continue" is completed with where the run goes, as the ask is.
    { id: 'continue', label: 'Continue to implementation (Recommended)', description: 'Runs implementation next.', recommended: true },
    { id: 'stop-here', label: 'Stop here', description: 'Ends the run here.', recommended: false },
    { id: 'more-details', label: 'More details', recommended: false, details: true, description: 'Shows the full brief, risks included, then asks this again. Nothing is recorded.' },
  ]);
  assert.equal(result.picker, 'rich', 'rich is the profile when none is named');
  assert.equal(result.details, 'option');
  assert.equal(result.brief, undefined, 'no brief is printed above the picker');
});

test('gate-brief --json: carries the full brief as more_details, every item whole and the risks grouped by tag', t => {
  const result = picker(atReview(t, { review: { decisions: ['Kept the glossary: new operators asked for it'] } }), 'review-approval');
  assert.equal(result.summaries, undefined, 'no material to compose a message from');
  const details = result.more_details;
  for (const text of ['Reviewed the draft.', 'Drafted the guide.', 'Kept the glossary: new operators asked for it', 'Wrote it for new operators']) {
    assert.ok(details.includes(text), `${text} in ${details}`);
  }
  assert.match(details, /\*\*Open\*\*\n- section 2 contradicts the summary\n- the intro repeats the title/);
});

test('gate-brief --json: the focused preview shows no risk, and a stop risk focuses Stop with its reason', t => {
  const run = atReview(t, {
    draft: { decisions: ['D1 first.', 'D2 second.', 'D3 third.', 'D4 fourth.'], risks: ['R1 first.', 'R2 second.'] },
    review: { risks: ['R3 third.', 'recommend stop: the guide documents a removed command'] },
  });
  const result = picker(run, 'review-approval');
  assert.equal(result.question.split('\n').length, 1);
  const [stop] = result.options;
  assert.equal(stop.recommended, true);
  assert.match(stop.preview, /^Why stop: the guide documents a removed command\n/);
  const glance = result.options.find(option => option.description.startsWith('Runs ')).preview;
  assert.doesNotMatch(glance, /R1|R2|R3|removed command/, 'no risk in the glance');
  assert.match(glance, /^Decided by the run \(\+1 more under More details\):$/m);
});

test('gate-brief --json: a refusal carries no material', t => {
  const result = picker(atApproval(t, null), 'approval');
  assert.equal(result.ok, false);
  assert.equal(result.more_details, undefined);
  assert.equal(result.question, undefined);
});

test('gate-brief --json: a stop recommendation moves the stop option first', t => {
  const run = atApproval(t, { ...SUMMARY, risks: ['recommend stop: nothing in the verdict is fixable'] });
  const { options } = picker(run, 'approval');
  assert.deepEqual(options.map(option => [option.id, option.recommended]), [['stop-here', true], ['continue', false], ['more-details', false]]);
});

test('gate-brief --json: a built-in gate reads its labels and header from the definition, and records by id', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: true });
  const result = picker(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.header, 'Verification');
  assert.deepEqual(result.options.map(option => [option.id, option.label]), [
    ['continue-past-verification', 'Accept the checks and continue (Recommended)'],
    ['stop-development', 'Stop here'],
    ['more-details', 'More details'],
  ]);
  assert.equal(result.options[0].description, 'Runs user documentation next.');
  assert.match(result.options[0].preview, /^Next: User documentation \(skipping Browser checks\)$/m);
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
    ['continue-past-verification', 'Ship it (Recommended)'],
    ['stop-development', 'Stop here'],
    ['more-details', 'More details'],
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
  assert.deepEqual(result.options.map(option => option.label), ['Continue past analysis (Recommended)', 'Stop development', 'More details']);
});

test('gate-brief --json: a refusal is the same JSON with ok false, exit 1', t => {
  const result = picker(atApproval(t, null), 'approval');
  assert.equal(result.code, 1);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'gate-brief-no-summary');
});

test('gate-brief: --json and --oneline together are refused', t => {
  const run = atApproval(t);
  for (const pair of [['--json', '--oneline'], ['--checkpoint', '--request'], ['--json', '--checkpoint']]) {
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', ...pair]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /one form at most/);
  }
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
  assert.match(result.stdout, /^Next: User documentation \(skipping Browser checks\)$/m);
  assert.equal(recommendedOf(run, 'verification-approval'), continueOf(graph, 'verification-approval'));
  assert.match(result.stdout, /^Verification passed with 2 warnings\.$/m);
  assert.match(oneline(run, 'verification-approval').stdout,
    / · Next: User documentation — skipped: Browser checks, Approve browser checks · /, 'the driven form keeps its list');
});

test('gate-brief: with every optional stretch off, the Next line lands on finalization', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: false, user_docs_enabled: false });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Next: Finalization \(skipping Browser checks and User documentation\)$/m);
});

test('gate-brief: an unguarded next node carries no skipped list', t => {
  const { run } = atVerificationApproval(t, { browser_tests_enabled: true, user_docs_enabled: true });
  assert.match(brief(run, 'verification-approval').stdout, /^Next: Browser checks$/m);
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
  // Each decision names who settled it and each risk what it is.
  assert.equal(line, "Two gaps found in the 'parser'. · Decisions: run: Patch the tokenizer — smallest change"
    + ` · Risks: open: The fixture corpus is thin · Next: Implementation · Recommended: continue · ${runLine(run)}`);
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
  assert.match(result.stdout, /^Next: Finalization \(skipping Browser checks and User documentation\)$/m);
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
  assert.match(result.stdout, /\(\+\d+ more in the run's state file\)/);
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
  assert.match(result.stdout, /^Decisions \(\+\d+ more in the dashboard\):\n- Decision 0 about the parser$/m);
  assert.match(result.stdout, /^Risks \(\+\d+ more in the dashboard\):\n- Risk 0: /m, 'a trimmed brief still shows its first risk');
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
    'Decisions (+2 more in the dashboard):',
    '- One',
    '- Two',
    '- Three',
    'Risks (+1 more in the dashboard):',
    '- recommend stop: Delta',
    '- Alpha',
    '- Beta',
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
  assert.match(text, /^Decisions:\n- document the currency\n- Keep the limit\n/m);
  assert.match(text, /^Risks:\n- open: the fixture corpus is thin\n- defaulted: kept the old limit$/m);
  assert.match(oneline(run, 'approval').stdout, /Decisions: run: document the currency/, 'every form reads the item the same way');
});

test('gate-brief: each item shows on a line of its own by its lead sentence, and the rest of it is left to the dashboard', t => {
  const run = atApproval(t, {
    status: 'completed',
    summary: 'Short.',
    decisions: [
      'Trips end on inactivity (1C). One rule fits a weekly shop and a top-up without asking which it is.',
      'Use a hosted backend, e.g. a managed one, for sync. Two developers cannot run a server.',
      { decision: 'Keep the limit', rationale: 'No load data says otherwise.' },
    ],
    risks: [
      'iPhone pocket shoppers may never get alerts. Web push on iOS needs the app on the home screen.',
      'A new list starts empty with "Nothing on the list yet." — nothing could remove the old items.',
      `open: ${Array(40).fill('word').join(' ')}`,
    ],
  });
  const text = brief(run, 'approval').stdout;
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 9), [
    'Short.',
    'Decisions:',
    '- Trips end on inactivity (1C).',
    '- Use a hosted backend, e.g. a managed one, for sync.',
    '- Keep the limit',
    'Risks:',
    '- iPhone pocket shoppers may never get alerts.',
    '- A new list starts empty with "Nothing on the list yet."',
    lines[8],
  ]);
  assert.match(lines[8], /^- open: (word )+word…$/, 'a sentence that never ends is cut at a word');
  assert.ok(lines[8].length <= '- '.length + 120, lines[8]);
  assert.doesNotMatch(text, /more in the dashboard/, 'a headline is never cut with a pointer of its own');
  assert.match(oneline(run, 'approval').stdout, /One rule fits a weekly shop/, 'the driven form keeps every item whole');
});

test('gate-brief: a summary cut lands after a stop inside closing quotes', t => {
  const summary = Array.from({ length: 150 }, (_, i) => `Step ${i} shows "Saved."`).join(' ');
  const run = atApproval(t, { ...LONG, summary, decisions: [], risks: [] });
  const first = brief(run, 'approval').stdout.split('\n')[0];
  assert.match(first, /"Saved\." … \(more in the dashboard\)$/, first);
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
  assert.match(result.stdout, /^Risks[^\n]*:\n- recommend stop: the build is red$/m, 'the reason for the recommendation is shown');
  const driven = oneline(run, 'approval').stdout;
  assert.ok(driven.length <= BUDGET);
  assert.match(driven, /Risks: stop: the build is red/);
});

test('gate-brief: with html_output false a trimmed brief points at the state file', t => {
  const run = atApproval(t, LONG);
  write(run, { orchestrator: { options: { html_output: false } } });
  const result = brief(run, 'approval');
  assert.doesNotMatch(result.stdout, /dashboard/);
  assert.match(result.stdout, /\(\+\d+ more in the run's state file\)/);
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
    'Risks:',
    '- recommend stop: critical — the rate limiter trusts X-Forwarded-For',
    '- open: 2 warnings in the parser tests',
    'Next: Finalization (skipping Browser checks and User documentation)',
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

test('gate-brief: under budget pressure every node the gate closes keeps its own share, in both forms', t => {
  const long = subject => Array.from({ length: 30 }, (_, i) => `${subject} finding ${i} is restated here at length.`).join(' ');
  const overlay = securityVerifier(t, { needs: 'verification', before: 'verification-approval' });
  const run = atOverlaidVerificationApproval(t, [overlay], {
    verification: { ...VERIFIED, summary: long('Verification') },
    'security-verification': { ...SECURITY, summary: `Gallery: http://localhost:3847 — the report. ${long('Security')}` },
  });
  const plain = brief(run, 'verification-approval').stdout;
  assert.ok(plain.length <= BUDGET, `brief is ${plain.length} characters`);
  assert.match(plain, /^Verification: Verification finding 0 is restated here at length\..* … \(more in the dashboard\)$/m);
  assert.match(plain, /^Security review: Gallery: http:\/\/localhost:3847 — the report\..* … \(more in the dashboard\)$/m,
    'the second section is cut, not dropped, and keeps its opening sentence');
  const driven = oneline(run, 'verification-approval').stdout;
  assert.ok(driven.length <= BUDGET, `brief is ${driven.length} characters`);
  assert.match(driven, /^Verification: Verification finding 0 .* Security review: Gallery: http:\/\/localhost:3847 /);
});

test('gate-brief: the stretch stops at the previous gate, so what an earlier gate reported is not repeated', t => {
  const run = atOverlaidVerificationApproval(t, [], {
    planning: { status: 'completed', summary: 'Three task groups planned.' },
    'verification-options': { status: 'completed', summary: 'Code review and the pragmatic review are on.' },
    verification: VERIFIED,
  });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Verification: Verification passed with 2 warnings\.\n\nChoosing the checks: Code review and the pragmatic review are on\.\n/);
  assert.doesNotMatch(result.stdout, /Three task groups/);
});

test('gate-brief: an item two closing nodes record is listed once, in every form', t => {
  const run = atOverlaidVerificationApproval(t, [], {
    verification: {
      ...VERIFIED,
      decisions: ['tag-semantics: The user chose AND semantics for filtering.'],
      risks: ['The public notes map can bypass tag isolation → copy on read', 'open: 2 warnings in the parser tests'],
    },
    'verification-options': {
      status: 'completed',
      summary: 'Code review and the pragmatic review are on.',
      decisions: ['The user chose  AND semantics for filtering', 'Browser checks are off'],
      risks: ['the public notes map can bypass tag isolation → copy on read.'],
    },
  });
  const once = (text, pattern) => assert.equal(text.match(new RegExp(pattern, 'gi'))?.length, 1, text);

  const plain = brief(run, 'verification-approval');
  assert.equal(plain.code, 0, plain.stderr);
  once(plain.stdout, 'AND semantics');
  once(plain.stdout, 'notes map can bypass');
  assert.match(plain.stdout, /^Decisions:\n- The user chose AND semantics for filtering\.\n- Browser checks are off\nRisks:/m);

  const checkpoint = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=verification-approval', '--checkpoint']).stdout);
  assert.deepEqual(checkpoint.decisions.run.map(each => each.decision), ['The user chose AND semantics for filtering.', 'Browser checks are off']);
  assert.deepEqual(checkpoint.risks.open.map(each => each.risk), ['The public notes map can bypass tag isolation', '2 warnings in the parser tests']);
  once(picker(run, 'verification-approval').more_details, 'AND semantics');
  const plainProfile = verb(['gate-brief', `--state=${run.state}`, '--node=verification-approval', '--json', '--picker=plain']);
  const question = JSON.parse(plainProfile.stdout).question;
  once(question, 'AND semantics');
  assert.doesNotMatch(question, /notes map can bypass/, 'no risk in the plain question either');

  const driven = oneline(run, 'verification-approval').stdout;
  once(driven, 'AND semantics');
  once(driven, 'notes map can bypass');
});

test('gate-brief: the count of items left out counts each repeated item once', t => {
  const risks = n => Array.from({ length: n }, (_, i) => `Risk number ${i + 1} stays open`);
  const run = atOverlaidVerificationApproval(t, [], {
    verification: { ...VERIFIED, risks: risks(4) },
    'verification-options': { status: 'completed', summary: 'Code review is on.', risks: risks(5) },
  });
  const result = brief(run, 'verification-approval');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Risks \(\+2 more in the dashboard\):$/m);
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
  assert.deepEqual(options.map(option => option.id), ['publish-draft', 'send-back', 'abandon', 'more-details']);
  assert.equal(options[0].description, 'Runs publish next.', 'the continue option still names what runs next');
  const revise = options[1];
  assert.equal(revise.label, 'Send back with notes');
  assert.equal(revise.description, 'Re-runs Draft, Figures and Review with your note, then asks this again.');
  assert.equal(revise.recommended, false, 'a revise is never recommended');
  assert.equal(revise.note, true);
  assert.deepEqual(revise.reruns.map(each => each.node), ['draft', 'figures', 'review']);
  assert.deepEqual(revise.revision, { n: 1, max: 10 });
  assert.match(revise.preview, /^Re-runs: Draft, Figures and Review, then asks this checkpoint again\.\nSuggested notes:\n- /);
  assert.equal(Object.hasOwn(options[0], 'note'), false, 'only a revise takes a note');
});

test('picker: the suggestions come from what the stretch found, nearest the gate first, none recommended', t => {
  const run = atReview(t);
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(suggestions, [
    { label: 'section 2 contradicts the summary', description: 'Address it in the re-run', note: 'Address this in the re-run: section 2 contradicts the summary', recommended: false },
    { label: 'the intro repeats the title', description: 'Address it in the re-run', note: 'Address this in the re-run: the intro repeats the title', recommended: false },
  ]);
});

test('picker: only open items become suggestions, never a decision, and one is asked for typed', t => {
  const run = atReview(t, { review: { risks: [{ risk: 'Two breaking changes ship under 1.0.0', tag: 'tradeoff' }, 'followup: rename the CLI flag', { risk: 'section 2 is thin', tag: 'open', change: 'expand section 2' }] }, draft: { risks: [] } });
  const revise = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  // The draft's decision names no alternative to change it to, so it is no suggestion.
  assert.deepEqual(revise.suggestions.map(each => each.note), ['section 2 is thin — expand section 2']);
  // A picker lists two options at the least: one suggestion is named in a typed question.
  assert.deepEqual(revise.note_question, {
    header: 'Revise',
    question: 'What should change? Re-runs: Draft, Figures and Review, then asks this checkpoint again. '
      + 'The run suggests: section 2 is thin — expand section 2. Type "yes" to send it, or type your own change.',
    multi_select: false,
    options: [],
  });
});

test('picker: a suggestion is labelled by its lead sentence in the writer\'s own casing', t => {
  const run = atReview(t, { review: { risks: ['open: iPhone shoppers may never get alerts. Web push needs the app installed.'] } });
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(suggestions[0], {
    label: 'iPhone shoppers may never get alerts.',
    description: 'Address it in the re-run',
    note: 'Address this in the re-run: iPhone shoppers may never get alerts. Web push needs the app installed.',
    recommended: false,
  });
});

test('picker: at most four suggestions, a long one whole in its label, its note and the preview', t => {
  const long = 'the onboarding chapter explains the dashboard before the operator has any run to look at at all';
  const run = atReview(t, { review: { risks: ['open: a', 'open: b', 'open: c', `open: ${long}`, 'open: e'] } });
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.equal(suggestions.length, 4);
  assert.equal(suggestions.filter(each => each.recommended).length, 0);
  const whole = suggestions[3];
  assert.equal(whole.label, long, 'a label is the lead sentence, never cut to a few words');
  assert.equal(whole.description, 'Address it in the re-run');
  assert.equal(whole.note, `Address this in the re-run: ${long}`);
  // The preview lists each note whole: only the preview's own budget cuts it.
  const { preview } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.ok(preview.includes(`- Address this in the re-run: ${long}`), preview);
});

test('picker: a stretch with nothing open offers no suggestion, and the note is typed', t => {
  const run = atReview(t, { review: { risks: [] }, draft: { risks: [] } });
  const revise = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(revise.suggestions, [], 'no filler: a generic edit or a decision to revisit names no change');
  assert.equal(revise.preview, 'Re-runs: Draft, Figures and Review, then asks this checkpoint again.\nNo suggested notes: you type what should change.');
  assert.deepEqual(revise.note_question, {
    header: 'Revise',
    question: 'What should change? Re-runs: Draft, Figures and Review, then asks this checkpoint again. Type the change.',
    multi_select: false,
    options: [],
  });
  const plain = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=review-approval', '--json', '--picker=plain']).stdout)
    .options.find(option => option.id === 'send-back');
  assert.deepEqual(plain.note_question, revise.note_question, 'the same typed question in both profiles');
  const request = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=review-approval', '--request']).stdout);
  assert.deepEqual(request.options.find(option => option.id === 'send-back').suggestions, []);
});

test('driven form: a revise section before Recommended, and the recommendation unchanged', t => {
  const run = atReview(t);
  const text = oneline(run, 'review-approval').stdout;
  assert.match(text, / · Next: Publish · revise: send-back reruns=draft revision=1\/10 · Recommended: publish-draft · Run: /);
});

test('a revised gate says how often it was revised, and at its ceiling of ten the option is gone', t => {
  const run = atReview(t);
  sendBack(run);
  rerun(run);
  const second = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.match(second.description, / Revised once so far at this checkpoint\.$/);
  assert.match(second.preview, /^Re-runs: .* Revised once so far here\.$/m);
  assert.equal(second.note_question.question,
    'What should change? Re-runs: Draft, Figures and Review, then asks this checkpoint again. Revised once so far here.');
  assert.doesNotMatch(second.description, / of \d/, 'a revise the user chooses is not counted against a budget');
  assert.match(oneline(run, 'review-approval').stdout, /revision=2\/10/);
  sendBack(run);
  rerun(run);
  assert.match(picker(run, 'review-approval').options.find(option => option.id === 'send-back').description,
    / Revised 2 times so far at this checkpoint\.$/);

  for (let round = 3; round <= 10; round++) {
    sendBack(run);
    rerun(run);
  }
  const spent = picker(run, 'review-approval');
  assert.deepEqual(spent.options.map(option => option.id), ['publish-draft', 'abandon', 'more-details']);
  assert.match(brief(run, 'review-approval').stdout, /^Next: Publish \(no revises are left at this checkpoint\)$/m);
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

// ---------------------------------------------------------------------------
// what to review, and the short question
// ---------------------------------------------------------------------------

/** A file the closing node wrote, put on disk under the run directory. */
function onDisk(run, relative, text = '# written\n') {
  const file = path.join(run.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The path the Review line names a run file by: from the project root. */
function fromRoot(run, relative) {
  return path.relative(run.root, path.join(run.dir, relative));
}

test('Review line: names the registered artifact and its companion from the project root, and never the dashboard', t => {
  const run = atApproval(t, { ...SUMMARY, artifacts: [{ path: 'analysis/report.md', label: 'Report', html: 'analysis/report.html' }] });
  onDisk(run, 'analysis/report.md');
  onDisk(run, 'analysis/report.html');
  const text = brief(run, 'approval').stdout;
  assert.equal(lastLine(text),
    `Review: ${fromRoot(run, 'analysis/report.md')} (HTML: report.html)`);
  assert.match(fromRoot(run, 'analysis/report.md'), /^\.maister\/tasks\/development\/2026-01-05-sample\/analysis\/report\.md$/);
  const checkpoint = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--checkpoint']).stdout);
  assert.deepEqual(checkpoint.review, [{ path: 'analysis/report.md', label: 'Report', html: 'analysis/report.html', role: null }],
    'the checkpoint names it inside the task folder');
  assert.match(picker(run, 'approval').options[0].preview, /^Review: analysis\/report\.md \(HTML beside it\)$/m);
});

test('Review line: a companion kept elsewhere is named by its path from the project root', t => {
  const run = atApproval(t, { ...SUMMARY, artifacts: [{ path: 'analysis/report.md', label: 'Report', html: 'html/report.html' }] });
  onDisk(run, 'analysis/report.md');
  onDisk(run, 'html/report.html');
  assert.match(brief(run, 'approval').stdout, new RegExp(`\\(HTML: ${fromRoot(run, 'html/report.html').replace(/\./g, '\\.')}\\)`));
});

test('Review line: a companion that is not on disk is not named, and neither is a registered file that is missing', t => {
  const run = atApproval(t, {
    ...SUMMARY,
    artifacts: [
      { path: 'analysis/report.md', label: 'Report', html: 'analysis/report.html' },
      { path: 'analysis/never-written.md', label: 'Gone', html: null },
    ],
  });
  onDisk(run, 'analysis/report.md');
  const text = brief(run, 'approval').stdout;
  assert.equal(lastLine(text), `Review: ${fromRoot(run, 'analysis/report.md')}`);
  assert.doesNotMatch(text, /HTML:|never-written/);
});

test('Review line: a node that registered nothing is read off its declared outputs, files only', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } } },
    node_summaries: { draft: { summary: 'Drafted the guide.' } },
  });
  write(run, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  write(run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed the draft.' } } });
  // Nothing is registered and the draft's declared file is not written yet: nothing to review.
  assert.doesNotMatch(brief(run, 'review-approval').stdout, /^Review: \.maister/m);
  // Once it is, the gate names it: the draft is part of what this gate closes.
  onDisk(run, 'outputs/draft.md');
  assert.equal(lastLine(brief(run, 'review-approval').stdout), `Review: ${fromRoot(run, 'outputs/draft.md')}`);
});

test('Review line: without a dashboard and with nothing on disk to review there is no line at all', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { options: { html_output: false } } });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  const text = brief(run, 'approval').stdout;
  assert.equal(lastLine(text), 'Next: Implementation');
  assert.doesNotMatch(text, /Review:|Dashboard/);
});

test('Review line: it is never trimmed, and the brief still keeps inside the budget', t => {
  const run = atApproval(t, { ...LONG, artifacts: [{ path: 'analysis/report.md', label: 'Report', html: null }] });
  onDisk(run, 'analysis/report.md');
  const text = brief(run, 'approval').stdout;
  assert.ok(text.length <= BUDGET, `brief is ${text.length} characters`);
  assert.equal(lastLine(text), `Review: ${fromRoot(run, 'analysis/report.md')}`);
});

/** A two-node run of a definition whose gate asks `ask`. */
function askingRun(t, ask) {
  const run = scratch(t);
  const definition = path.join(run.root, 'asking.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', `    ask: ${JSON.stringify(ask)}`,
    '    options: {go-on: continue, halt: stop}',
    '  design: {uses: "direct:design", needs: [approval], when: "${inputs.design}"}',
    '  wrap-up: {uses: "direct:wrap-up", needs: [design]}',
    'inputs:', '  design: {type: bool, required: false, default: false}',
    'display:', '  titles: {analysis: Research foundation, design: High-level design, wrap-up: Completion}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'asking.md'),
    '# Asking — node prose\n\n## `analysis`\n\nA.\n\n## `design`\n\nD.\n\n## `wrap-up`\n\nW.\n');
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Answered.' } } });
  return run;
}

test('question: the ask names the finished work, never the frozen destination a guard skips', t => {
  const run = askingRun(t, 'Research foundation complete (initialized, planned, gathered, synthesized). Continue to high-level design?');
  const result = picker(run, 'approval');
  assert.match(result.options[0].preview, /^Next: Completion \(skipping High-level design\)$/m);
  assert.equal(result.question, 'Research foundation complete. Ready to go on?');
});

test('question: an ask that is only a destination becomes the closing phase, complete', t => {
  assert.equal(picker(askingRun(t, 'Continue to implementation planning?'), 'approval').question, 'Research foundation complete. Ready to go on?');
});

test('question: an ask that does not ask to continue is kept as written; one that does asks whether the work is ready', t => {
  assert.equal(picker(askingRun(t, 'Scans finished. Start the deep audit?'), 'approval').question, 'Scans finished. Start the deep audit?');
  assert.equal(picker(askingRun(t, 'Gap analysis complete. Continue?'), 'approval').question, 'Gap analysis complete. Ready to go on?');
});

test('picker: a risk written with the change it needs offers the risk, then that change', t => {
  const run = atReview(t, { review: { risks: ['open: list(null) now throws, where it used to return every note → Keep list(null) returning every note'] } });
  const { suggestions } = picker(run, 'review-approval').options.find(option => option.id === 'send-back');
  assert.deepEqual(suggestions[0], {
    label: 'list(null) now throws, where it used to return every note',
    description: 'Keep list(null) returning every note',
    note: 'list(null) now throws, where it used to return every note — Keep list(null) returning every note',
    recommended: false,
  });
});

test('picker: a revise names an earlier revise of the same document chosen at another gate', t => {
  const run = atReview(t);
  sendBack(run);
  rerun(run);
  write(run, { nodes: { 'review-approval': { status: 'completed' } } });
  write(run, { nodes: { publish: { status: 'completed' } }, node_summaries: { publish: { summary: 'Published.' } } });
  const redo = picker(run, 'final-approval').options.find(option => option.id === 'redo-draft');
  assert.match(redo.description, / Draft was already revised once at Review Approval\.$/);
  const send = picker(atReview(t), 'review-approval').options.find(option => option.id === 'send-back');
  assert.doesNotMatch(send.description, /already revised/, 'nothing is named when no other gate revised it');
});

// ---------------------------------------------------------------------------
// picker profiles: what each asking tool takes
// ---------------------------------------------------------------------------

/** The picker `--json --picker=<profile>` returns, parsed; the exit code beside it. */
function profiled(run, node, profile) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--json', `--picker=${profile}`]);
  return { code: result.code, stderr: result.stderr, ...(result.stdout ? JSON.parse(result.stdout) : {}) };
}

/** A run paused at a gate whose own options fill four slots: continue, two revises and a stop. */
function atFullGate(t) {
  const run = scratch(t);
  const definition = path.join(run.root, 'full.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Direction ready?"',
    '    options:',
    '      continue-past-analysis: continue',
    '      refine: {effect: revise, reruns: analysis}',
    '      rethink: {effect: revise, reruns: analysis}',
    '      stop-development: stop', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'full.md'), '# Full workflow — node prose\n\n## `analysis`\n\nWrite the report.\n');
  freeze(run, { definition });
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: SUMMARY } });
  return run;
}

test('picker rich: the continue option previews the checkpoint at a glance, no risk in it; More details previews the rest', t => {
  const long = 'The fixture corpus is thin. It covers two of the five dialects, so a regression in the others would pass unseen.';
  const run = atApproval(t, { ...SUMMARY, risks: [long] });
  const result = profiled(run, 'approval', 'rich');
  assert.equal(result.code, 0, result.stderr);
  const [recommended, stop, more] = result.options;
  assert.equal(recommended.recommended, true);
  assert.equal(recommended.preview, [
    'Done: Two gaps found in the parser.',
    'Next: Implementation',
    'Decided by the run:',
    '- Patch the tokenizer — scope analysis',
  ].join('\n'));
  assert.match(stop.preview, /^Ends the run here\.\nKept: the dashboard\.\n/);
  assert.match(stop.preview, /Start a new run from these files to pick up later\.$/);
  assert.ok(more.preview.includes(`- ${long}`), 'More details has the risk whole');
  assert.match(more.preview, /\*\*Open\*\*/);
  assert.ok(!/Dashboard:|file:\/\//.test(recommended.preview + result.question), 'neither names the dashboard: it is already open');
  assert.equal(result.question.split('\n').length, 1, 'the question is the one-line ask');
});

test('picker rich: the glance keeps within nine lines and 900 characters, More details within 2,000, and Next survives', t => {
  const sentence = 'The parser drops a trailing token when the line ends in a comment. ';
  const shapes = [
    { summary: sentence.repeat(120).trim(), risks: Array.from({ length: 40 }, (_, index) => `Risk ${index}: ${sentence.repeat(3).trim()}`) },
    { summary: 'Short.', decisions: Array.from({ length: 30 }, (_, index) => `Decision ${index}: ${sentence.repeat(4).trim()}`) },
    { summary: sentence.repeat(40).trim(), headline: sentence.repeat(3).trim(), decisions: [sentence.repeat(10).trim()], risks: [sentence.repeat(10).trim()] },
  ];
  for (const shape of shapes) {
    const { options } = profiled(atApproval(t, { ...SUMMARY, ...shape }), 'approval', 'rich');
    const glance = options[0].preview;
    assert.ok(glance.length <= 900 && glance.split('\n').length <= 9, `glance is ${glance.length} characters:\n${glance}`);
    assert.match(glance, /^Next: Implementation$/m);
    const details = options.at(-1).preview;
    assert.ok(details.length <= 2000, `More details preview is ${details.length} characters`);
  }
});

test('picker plain: the question carries the glance then the ask, and each title carries what it does', t => {
  const run = atApproval(t);
  const result = profiled(run, 'approval', 'plain');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.picker, 'plain');
  assert.equal(result.question, [
    'Done: Two gaps found in the parser.',
    'Next: Implementation',
    'Decided by the run:',
    '- Patch the tokenizer — scope analysis',
    'Analysis complete. Ready to go on?',
  ].join('\n'));
  assert.deepEqual(result.options, [
    { id: 'continue', label: 'Continue to implementation (Recommended)', recommended: true },
    { id: 'stop-here', label: 'Stop here — keeps everything written so far', recommended: false },
    { id: 'more-details', label: 'More details', recommended: false, details: true },
  ]);
});

test('picker profiles: every option keeps its id and order in both, so an answer records the same either way', t => {
  for (const run of [atApproval(t), atReview(t), atFullGate(t)]) {
    const node = fs.readFileSync(run.state, 'utf8').includes('review-approval') ? 'review-approval' : 'approval';
    const ids = profile => profiled(run, node, profile).options.map(option => option.id).filter(id => id !== 'more-details');
    assert.deepEqual(ids('rich'), ids('plain'));
    assert.deepEqual(ids('rich'), picker(run, node).options.map(option => option.id).filter(id => id !== 'more-details'));
  }
  const rich = profiled(atReview(t), 'review-approval', 'rich').options.find(option => option.id === 'send-back');
  assert.match(rich.preview, /^Re-runs: Draft, Figures and Review, then asks this checkpoint again\.\nSuggested notes:\n- /);
  const revise = profiled(atReview(t), 'review-approval', 'plain').options.find(option => option.id === 'send-back');
  assert.equal(revise.note, true, 'a revise keeps what its note is asked from');
  assert.ok(revise.suggestions.length >= 2);
});

test('picker slots: a gate whose own options fill the four slots asks for "details" to be typed instead', t => {
  const run = atFullGate(t);
  const rich = profiled(run, 'approval', 'rich');
  assert.deepEqual(rich.options.map(option => option.id), ['continue-past-analysis', 'refine', 'rethink', 'stop-development']);
  assert.equal(rich.details, 'typed');
  assert.ok(rich.question.endsWith(' Type "details" for the full brief.'), rich.question);
  assert.equal(rich.question.split('\n').length, 1);
  const plain = profiled(run, 'approval', 'plain');
  assert.equal(plain.details, 'option', 'a tool that takes any number of choices always has the slot');
  assert.equal(plain.options.at(-1).id, 'more-details');
  assert.doesNotMatch(plain.question, /Type "details"/);
});

test('picker: More details is last and never recommended, in both profiles', t => {
  const run = atApproval(t, { ...SUMMARY, risks: ['recommend stop: nothing in the verdict is fixable'] });
  for (const profile of ['rich', 'plain']) {
    const { options } = profiled(run, 'approval', profile);
    assert.equal(options[0].id, 'stop-here');
    assert.equal(options.at(-1).id, 'more-details');
    assert.equal(options.filter(option => option.recommended).length, 1);
  }
});

test('picker: --picker is refused without --json, and an unknown profile is refused', t => {
  const run = atApproval(t);
  const alone = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--picker=rich']);
  assert.equal(alone.code, 2);
  assert.match(alone.stderr, /--picker only with --json/);
  const driven = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--oneline', '--picker=plain']);
  assert.equal(driven.code, 2);
  const unknown = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--json', '--picker=fancy']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /rich or plain/);
});

test('picker: the driven form offers no More details', t => {
  const run = atApproval(t);
  assert.doesNotMatch(oneline(run, 'approval').stdout, /more-details|More details/);
});
