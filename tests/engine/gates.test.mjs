import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// The request-writing verb is not part of this edition, so a suspend is set up
// the way it lands on disk — the request file beside the state, then the
// pending marker and the suspended node through the state writer — and the
// answer is taken the way every driver takes it: the answer in the request file,
// then one write clearing the marker.

const MARKER = { node: 'approval', request: 'gates/approval.request.yml', since: '2026-01-05T09:00:00Z' };

function suspended(t) {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, { orchestrator: { gate_pending: MARKER }, nodes: { approval: { status: 'suspended' } } });
  return run;
}

function answer(run) {
  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.answered.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  return write(run, {
    orchestrator: { gate_pending: null },
    nodes: { approval: { status: 'completed' } },
    node_summaries: {
      approval: { status: 'completed', decisions: [{ option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] },
    },
  });
}

test('suspend: the marker and the suspended node land, and the card shows no answer yet', t => {
  const run = suspended(t);
  const state = readState(run);
  assert.deepEqual(state.orchestrator.gate_pending, MARKER);
  assert.equal(state.workflow.nodes.approval.status, 'suspended');
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^ {2}gate_pending: \{node: approval, request: gates\/approval\.request\.yml, since: "2026-01-05T09:00:00Z"\}$/m,
    'the marker is one flow line, the form the shared state reader reads');
  const card = readDashboard(run).phases.find(phase => phase.id === 'approval').gate;
  assert.deepEqual(card, { question: 'Analysis complete. Continue to implementation?', answer: null });
});

test('answer: clearing the marker completes the node and regenerates the gate index', t => {
  const run = suspended(t);
  const result = answer(run);
  assert.match(result.stdout, /^gates\/index\.yml$/m);

  const state = readState(run);
  assert.equal(state.orchestrator.gate_pending, null);
  assert.match(fs.readFileSync(run.state, 'utf8'), /^ {2}gate_pending: null$/m, 'the cleared marker is the literal null');
  assert.equal(state.workflow.nodes.approval.status, 'completed');

  const index = fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8');
  assert.equal(index, [
    'version: 1',
    'entries:',
    '  - {node: approval, request: gates/approval.request.yml, kind: approval, asked_at: "2026-01-05T09:00:00Z", status: answered}',
    '',
  ].join('\n'));

  const phase = readDashboard(run).phases.find(entry => entry.id === 'approval');
  assert.equal(phase.status, 'completed');
  assert.deepEqual(phase.gate, { question: 'Analysis complete. Continue to implementation?', answer: 'Continue to implementation' });
  assert.equal(phase.decisions[0].decision, 'Continue', 'the answer reads by its option label');
  assert.equal(phase.decisions[0].by, 'operator');
});

test('the index mirrors the request file, not the patch: cleared before the answer lands, it still reads pending', t => {
  const run = suspended(t);
  write(run, { orchestrator: { gate_pending: null } });
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: pending\}$/m);
});

test('the documented fold: an answer recorded by editor, then the empty patch, closes the index row', t => {
  const run = suspended(t);
  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.answered.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  const before = fs.readFileSync(run.state, 'utf8');
  const edited = before.replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null');
  assert.notEqual(edited, before);
  fs.writeFileSync(run.state, edited);

  const result = write(run, {});
  assert.match(result.stdout, /^gates\/index\.yml$/m);
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: answered\}$/m);

  const index = fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8');
  const again = write(run, {});
  assert.doesNotMatch(again.stdout, /gates\//, 'an index that already agrees is not reported');
  assert.equal(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), index);
});

test('a write while a gate is pending leaves the index as it is', t => {
  const run = suspended(t);
  const index = fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8');
  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.answered.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  const result = write(run, {});
  assert.doesNotMatch(result.stdout, /gates\//);
  assert.equal(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), index);
});

test('an ordinary write with no gates directory creates none and reports no index', t => {
  const run = scratch(t);
  freeze(run);
  const result = write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.doesNotMatch(result.stdout, /gates\//);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false);
});

test('terminal mode: an in-session answer writes no gate files at all', t => {
  const run = scratch(t);
  freeze(run);
  const result = write(run, { orchestrator: { gate_pending: null }, nodes: { approval: { status: 'completed' } } });
  assert.doesNotMatch(result.stdout, /gates\//);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false);
});

for (const [label, marker] of [
  ['a marker missing since', { node: 'approval', request: 'gates/approval.request.yml' }],
  ['a marker with an extra key', { ...MARKER, answer: 'continue' }],
  ['a request file named for another node', { ...MARKER, request: 'gates/other.request.yml' }],
  ['a since that is not a measured UTC time', { ...MARKER, since: '2026-01-05 09:00' }],
  ['a marker sent as text', 'approval'],
]) {
  test(`refusal: ${label}`, t => {
    const run = scratch(t, { fixture: 'gate' });
    freeze(run);
    const before = fs.readFileSync(run.state, 'utf8');
    const result = verb(['write-state', `--state=${run.state}`], { orchestrator: { gate_pending: marker } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^state-gate-pending-form\b/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  });
}

// ---------------------------------------------------------------------------
// a driven answer's gate values: recorded by the empty re-publish
// ---------------------------------------------------------------------------

// A driven answer is folded with editor tools and re-published with the empty
// patch, which names no gate. The writer still records the values the chosen
// continue sets, and a guard past the next gate reads them.

const DEFERRED = [
  'name: deferred', 'version: 1', 'nodes:',
  '  draft: {uses: "direct:draft", needs: []}',
  '  first-approval:', '    type: gate', '    needs: [draft]', '    ask: "Drafted. Continue?"',
  '    options:', '      with-docs: {effect: continue, sets: {docs: true}}', '      without-docs: {effect: continue, sets: {docs: false}}', '      halt: stop',
  '  build: {uses: "direct:build", needs: [first-approval]}',
  '  build-approval:', '    type: gate', '    needs: [build]', '    ask: "Built. Continue?"', '    options: {go-on: continue, halt: stop}',
  '  docs: {uses: "direct:docs", needs: [build-approval], when: "${first-approval.values.docs}"}', '',
].join('\n');

const FIRST_MARKER = { node: 'first-approval', request: 'gates/first-approval.request.yml', since: '2026-01-05T09:00:00Z' };
const ANSWERED_AT = '2026-01-05T09:05:00Z';

/** The state text without its write stamp, which every landed write moves. */
const unstamped = text => text.replace(/^ {2}updated: .*$/m, '');

/** `text` with `pattern` replaced, failing loudly when the pattern is not there. */
function edited(text, pattern, replacement) {
  assert.match(text, pattern);
  return text.replace(pattern, replacement);
}

/** A run of the deferred-step definition with its draft written, its first gate the question now. */
function atFirstApproval(t, driver = null) {
  const run = scratch(t);
  const definition = path.join(run.root, 'deferred.yml');
  fs.writeFileSync(definition, DEFERRED);
  fs.writeFileSync(path.join(run.root, 'deferred.md'), '# Deferred step\n\n## `draft`\n\nDraft.\n\n## `build`\n\nBuild.\n\n## `docs`\n\nDocs.\n');
  freeze(run, { definition, orchestrator: driver ? { driver } : {} });
  write(run, { nodes: { draft: { status: 'completed' } }, node_summaries: { draft: { summary: 'Drafted.' } } });
  return run;
}

/**
 * Suspend on the first gate under a cockpit driver and fold `option` the way a
 * driven resume does: the answer block, then the summary and the status, then
 * the marker null last, all by editor, and then the empty patch.
 */
function drivenAnswer(t, option) {
  const run = atFirstApproval(t, { kind: 'cockpit', cwd: '/work' });
  const request = path.join(run.dir, FIRST_MARKER.request);
  fs.mkdirSync(path.dirname(request), { recursive: true });
  fs.writeFileSync(request, [
    'version: 1', 'node: first-approval', 'kind: approval', 'question: "Drafted. Continue?"', 'options:',
    '  - {id: with-docs, label: "With docs", effect: continue}',
    '  - {id: without-docs, label: "Without docs", effect: continue}',
    '  - {id: halt, label: "Halt", effect: stop}',
    'multiple: false', `asked_at: "${FIRST_MARKER.since}"`, 'answer: null', '',
  ].join('\n'));
  write(run, { orchestrator: { gate_pending: FIRST_MARKER }, nodes: { 'first-approval': { status: 'suspended' } } });

  fs.writeFileSync(request, edited(fs.readFileSync(request, 'utf8'), /^answer: null$/m,
    `answer: {option: ${option}, answered_by: operator, at: "${ANSWERED_AT}"}`));
  let text = fs.readFileSync(run.state, 'utf8');
  text = edited(text, /^( +first-approval: \{kind: gate, status: )suspended\b/m, '$1completed');
  text = edited(text, /^node_summaries:\n/m, [
    'node_summaries:', '  first-approval:', '    status: completed', '    decisions:',
    `      - option: ${option}`, '        answered_by: operator', `        at: "${ANSWERED_AT}"`, '',
  ].join('\n'));
  text = edited(text, /^ {2}gate_pending: .*$/m, '  gate_pending: null');
  fs.writeFileSync(run.state, text);
  return { run, result: write(run, {}) };
}

/** Complete the build and walk the second gate's checkpoint, whose next reads the first gate's guard. */
function nextAfterBuild(run) {
  write(run, { nodes: { build: { status: 'completed' } }, node_summaries: { build: { summary: 'Built.' } } });
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=build-approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout).next;
}

for (const [option, docs, node, skipped] of [['with-docs', true, 'docs', []], ['without-docs', false, null, ['docs']]]) {
  test(`driven: the empty re-publish records the values ${option} sets, and the guard past the next gate reads them`, t => {
    const { run, result } = drivenAnswer(t, option);
    assert.match(result.stdout, /^workflow\.nodes\.first-approval$/m);
    const gate = readState(run).workflow.nodes['first-approval'];
    assert.equal(gate.status, 'completed');
    assert.deepEqual(gate.values, { docs });
    assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /node: first-approval, .*status: answered\}$/m);

    const next = nextAfterBuild(run);
    assert.equal(next.node, node);
    assert.deepEqual(next.skipped.map(each => each.node), skipped);
  });
}

test('driven: a write after the re-publish leaves the recorded values as they are', t => {
  const { run } = drivenAnswer(t, 'without-docs');
  const before = fs.readFileSync(run.state, 'utf8');
  const again = write(run, {});
  assert.doesNotMatch(again.stdout, /^workflow\.nodes\./m);
  assert.equal(unstamped(fs.readFileSync(run.state, 'utf8')), unstamped(before));
});

test('driven: values edited to disagree with the answer are recorded again from it on the next write', t => {
  const { run } = drivenAnswer(t, 'with-docs');
  fs.writeFileSync(run.state, edited(fs.readFileSync(run.state, 'utf8'), /values: \{docs: true\}/, 'values: {docs: false}'));
  const result = write(run, {});
  assert.match(result.stdout, /^workflow\.nodes\.first-approval$/m);
  assert.deepEqual(readState(run).workflow.nodes['first-approval'].values, { docs: true });
});

test('terminal: an answer written in session records its values in that write, and an empty write after it moves nothing', t => {
  const run = atFirstApproval(t);
  const answered = write(run, {
    nodes: { 'first-approval': { status: 'completed' } },
    node_summaries: { 'first-approval': { decisions: [{ option: 'with-docs' }] } },
  });
  assert.match(answered.stdout, /^workflow\.nodes\.first-approval$/m);
  const state = readState(run);
  assert.deepEqual(state.workflow.nodes['first-approval'].values, { docs: true });
  assert.equal(state.node_summaries['first-approval'].decisions[0].via, 'terminal');

  const before = fs.readFileSync(run.state, 'utf8');
  const again = write(run, {});
  assert.doesNotMatch(again.stdout, /^workflow\.nodes\./m);
  assert.equal(unstamped(fs.readFileSync(run.state, 'utf8')), unstamped(before));
  assert.equal(nextAfterBuild(run).node, 'docs');
});
