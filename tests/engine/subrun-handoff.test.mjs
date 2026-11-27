// The sub-run hand-off verb: one call adopts the child that ended (W4),
// records the skips a false guard leaves due, and starts the next child (W1,
// W2, W3) — each step the one write the walk gives it, so the state on disk is
// the state the separate writes leave. The fixture pair in
// `fixtures/subrun-handoff/` is copied into the project's own workflow home,
// where the `workflow:` targets resolve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, sibling, snapshot, verb, write } from '../helpers.mjs';

const AUTHORED = path.join(FIXTURES, 'subrun-handoff');
const CHILD_SOURCE = '.maister/workflows/handoff-child.yml';
const ANSWER = option => ({ option, answered_by: 'operator', at: '2026-01-05T09:05:00Z' });
const STAMP = /"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/g;
const COCKPIT = root => ({ kind: 'cockpit', cwd: root });

/**
 * A parent run of `handoff-parent` in a scratch project whose workflow home
 * holds the fixture pair, frozen with `driver`, its intake done; `first` is
 * the node due next.
 */
function parent(t, { driver = null } = {}) {
  const run = scratch(t, { type: 'handoff-parent', name: '2026-01-05-handoff' });
  fs.cpSync(AUTHORED, path.join(run.root, '.maister', 'workflows'), { recursive: true });
  freeze(run, {
    definition: path.join(run.root, '.maister', 'workflows', 'handoff-parent.yml'),
    task: { title: 'Hand-off', description: 'Probe the store twice.' },
    inputs: { topic: 'the store' },
    orchestrator: driver ? { driver: driver === 'cockpit' ? COCKPIT(run.root) : driver } : {},
  });
  write(run, { nodes: { intake: { status: 'completed' } }, node_summaries: { intake: { summary: 'Took the topic in.' } } });
  return run;
}

function handoff(run, node, ...extra) {
  return verb(['subrun-handoff', `--state=${run.state}`, `--node=${node}`, ...extra]);
}

/** The verb's closing line: the last non-empty line of its stdout. */
function closing(result) {
  const lines = result.stdout.split('\n').filter(line => line !== '');
  return lines[lines.length - 1];
}

function refusal(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.equal(report.ok, false);
  assert.equal(report.code, code, report.message);
  return report;
}

/** The child run a parent node recorded, as `sibling` addresses one. */
function childOf(run, node) {
  const { task_path: taskPath } = readState(run).workflow.nodes[node].values;
  const [, , type, name] = taskPath.split('/');
  return sibling(run, { type, name });
}

/**
 * Run the child to its end: the probe records `blocking`, writes its notes;
 * the guarded step is skipped unless blocking; the gate is answered `answer`;
 * the run closes `status`.
 */
function finish(child, { blocking = false, answer = 'settle-findings', status = 'completed' } = {}) {
  fs.mkdirSync(path.join(child.dir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(child.dir, 'notes', 'probe-notes.md'), 'notes\n');
  write(child, { nodes: { probe: { status: 'running' } } });
  write(child, { nodes: { probe: { status: 'completed', values: { blocking } } }, node_summaries: { probe: { summary: 'Probed.' } } });
  if (status === 'stopped') {
    write(child, { task: { status: 'stopped' }, nodes: { deepen: { status: 'stopped' }, settle: { status: 'stopped' }, 'wrap-up': { status: 'stopped' } } });
    return;
  }
  if (status === 'failed') {
    write(child, { nodes: { deepen: { status: 'running' } } });
    write(child, { task: { status: 'failed' }, nodes: { deepen: { status: 'failed' } } });
    return;
  }
  write(child, { nodes: { deepen: { status: 'skipped' } } });
  write(child, { nodes: { settle: { status: 'completed' } }, node_summaries: { settle: { decisions: [ANSWER(answer)] } } });
  write(child, { task: { status: 'completed' }, nodes: { 'wrap-up': { status: 'skipped' } } });
}

/** A parent whose first child ran to `status`, waiting on its adoption. */
function waitingOnFirst(t, options = {}) {
  const run = parent(t, options);
  const started = handoff(run, 'first');
  assert.equal(started.code, 0, started.stdout + started.stderr);
  const child = childOf(run, 'first');
  return { run, child };
}

const masked = (text, root) => text.replace(STAMP, '"<ts>"').replaceAll(root, '<root>');

test('the first child starts in one call: W1, the freeze into the derived directory with its parent link, W3', t => {
  const run = parent(t);
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const child = childOf(run, 'first');
  assert.equal(child.path, '.maister/tasks/handoff-child/2026-01-05-handoff-first');
  assert.equal(closing(result), `started: first run=${child.name} — the sub-run is frozen and linked`);
  assert.doesNotMatch(result.stdout + result.stderr, /WAITING-SUBRUN|RUN-/);
  const entry = readState(run).workflow.nodes.first;
  assert.equal(entry.status, 'waiting');
  assert.deepEqual(entry.values, { task_path: child.path, run_id: child.name });
  const frozen = readState(child);
  assert.deepEqual(frozen.orchestrator.parent, { run: run.path, node: 'first' });
  assert.deepEqual(frozen.orchestrator.driver, { kind: 'terminal' });
  assert.deepEqual(frozen.orchestrator.options.inputs, { subject: 'the store', embedded: true });
  assert.equal(frozen.task.title, 'First probe');
  assert.equal(frozen.task.description, 'Probe the store twice.');
  assert.equal(frozen.task.status, 'in_progress', 'the writer records the status the freeze starts a run with');
  assert.equal(frozen.workflow.source, CHILD_SOURCE);
  assert.match(result.stdout, /A sub-run's banner: do not relay it/);
});

test('a child still running: nothing is written and the node still waits', t => {
  const { run, child } = waitingOnFirst(t);
  const before = snapshot(run.root);
  const result = handoff(run, 'first', '--at=2026-01-05T10:00:00Z');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `\nwaiting: first run=${child.name} — the sub-run has not ended; nothing was written\n`);
  assert.deepEqual(snapshot(run.root), before);
});

test('a cockpit child pending on a gate with no session yet is not done, whatever its status says', t => {
  const { run, child } = waitingOnFirst(t, { driver: 'cockpit' });
  const text = fs.readFileSync(child.state, 'utf8').replace(/^orchestrator:\n/m, 'orchestrator:\n  gate_pending: {node: settle}\n');
  const edited = text.replace(/^ {2}status: in_progress$/m, '  status: completed');
  assert.match(edited, /gate_pending: \{node: settle\}[\s\S]*status: completed|status: completed[\s\S]*gate_pending: \{node: settle\}/);
  fs.writeFileSync(child.state, edited);
  const before = snapshot(run.root);
  const result = handoff(run, 'first');
  assert.equal(closing(result), `waiting: first run=${child.name} — the sub-run has not ended; nothing was written`);
  assert.deepEqual(snapshot(run.root), before);
});

test('parity: one call leaves the state the separate W4, skip, W1, W2 and W3 writes leave', t => {
  const viaVerb = waitingOnFirst(t);
  const bySteps = waitingOnFirst(t);
  finish(viaVerb.child);
  finish(bySteps.child);

  const result = handoff(viaVerb.run, 'first');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const second = childOf(viaVerb.run, 'second');
  assert.equal(closing(result), `started: second run=${second.name} — the sub-run is frozen and linked`);

  // The separate writes, as the walks have a driver send them.
  const { run, child } = bySteps;
  write(run, {
    nodes: { first: { status: 'completed', values: { task_path: child.path, run_id: child.name, blocking: false, settled: true } } },
    node_summaries: { first: { summary: `Sub-run ${child.name} completed.`, absent: { extra: 'the sub-run skipped deepen, which writes it' } } },
  });
  write(run, { nodes: { remedy: { status: 'skipped' } } });
  write(run, { nodes: { confirm: { status: 'skipped' } } });
  write(run, { nodes: { second: { status: 'running' } } });
  const next = sibling(run, { type: 'handoff-child', name: '2026-01-05-handoff-second' });
  fs.mkdirSync(next.dir, { recursive: true });
  const resolved = JSON.parse(verb(['resolve', `--definition=${path.join(run.root, ...CHILD_SOURCE.split('/'))}`]).stdout);
  write(next, {
    task: { title: 'Second probe', description: 'Probe the store twice.' },
    workflow: { source: CHILD_SOURCE, overlays: [], profile: null, graph_hash: resolved.graph_hash, grammar_version: 1, name: 'handoff-child' },
    orchestrator: { options: { inputs: { subject: 'the store', embedded: true } }, driver: { kind: 'terminal' }, parent: { run: run.path, node: 'second' } },
  });
  write(run, { nodes: { second: { status: 'waiting', values: { task_path: next.path, run_id: next.name } } } });

  assert.equal(masked(fs.readFileSync(viaVerb.run.state, 'utf8'), viaVerb.run.root), masked(fs.readFileSync(run.state, 'utf8'), run.root));
  assert.equal(masked(fs.readFileSync(second.state, 'utf8'), viaVerb.run.root), masked(fs.readFileSync(next.state, 'utf8'), run.root));

  // The writes landed in the walk's order, each printing what it changed: the
  // adoption, the two skips, the start, the child's freeze, the link.
  const lines = result.stdout.split('\n');
  const order = [
    lines.indexOf('workflow.nodes.first'),
    lines.indexOf('workflow.nodes.remedy'),
    lines.indexOf('workflow.nodes.confirm'),
    lines.indexOf('workflow.nodes.second'),
    lines.indexOf('orchestrator.parent'),
    lines.lastIndexOf('workflow.nodes.second'),
  ];
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `${order} in\n${result.stdout}`);
});

test('the adoption records the guard skip, the gate the child\'s answer skipped and the artifact a skipped child step never wrote', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child);
  assert.equal(handoff(run, 'first').code, 0);
  const state = readState(run);
  assert.equal(state.workflow.nodes.remedy.status, 'skipped');
  assert.equal(state.workflow.nodes.confirm.status, 'skipped');
  assert.deepEqual(state.workflow.nodes.confirm.answered_in, { run: child.name, node: 'settle', option: 'settle-findings' });
  const summary = state.node_summaries.first;
  assert.deepEqual(summary.absent, { extra: 'the sub-run skipped deepen, which writes it' });
  // Spelled with `/` and relative to the parent's directory, on every platform.
  assert.ok(summary.artifacts.some(each => each.path === `../../handoff-child/${child.name}/notes/probe-notes.md`), JSON.stringify(summary.artifacts));
});

test('a gate the walk does not skip ends the hand-off at the writer\'s next: line: adopt only, no child started', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child, { answer: 'leave-open' });
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(closing(result), 'next: confirm (Confirm the probe) — run node-brief for it');
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes.first.status, 'completed');
  assert.equal(nodes.second.status, 'pending');
  assert.ok(!fs.existsSync(path.join(run.root, '.maister', 'tasks', 'handoff-child', '2026-01-05-handoff-second')));
});

test('re-run: the verb on a node already adopted continues the walk, and on the next pending node starts it', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child, { answer: 'leave-open' });
  handoff(run, 'first');
  write(run, { nodes: { confirm: { status: 'completed' } }, node_summaries: { confirm: { decisions: [ANSWER('continue-past-probe')] } } });
  // A crash between W4 and W1 leaves this: the adopted node, the next one pending.
  const again = handoff(run, 'first');
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(closing(again), /^started: second run=2026-01-05-handoff-second /);
  const repeat = handoff(run, 'second');
  assert.equal(closing(repeat), 'waiting: second run=2026-01-05-handoff-second — the sub-run has not ended; nothing was written');
});

test('a crash between W1 and W3: the running node goes on from its child\'s directory, and a child frozen already is adopted, not frozen twice', t => {
  const run = parent(t);
  write(run, { nodes: { first: { status: 'running' } } });
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(closing(result), /^started: first run=2026-01-05-handoff-first /);

  // W2 landed, W3 did not: `subrun-path` reports `adopt`, and the freeze is skipped.
  const crashed = parent(t);
  write(crashed, { nodes: { first: { status: 'running' } } });
  const child = sibling(crashed, { type: 'handoff-child', name: '2026-01-05-handoff-first' });
  fs.mkdirSync(child.dir, { recursive: true });
  const resolved = JSON.parse(verb(['resolve', `--definition=${path.join(crashed.root, ...CHILD_SOURCE.split('/'))}`]).stdout);
  write(child, {
    task: { title: 'First probe' },
    workflow: { source: CHILD_SOURCE, overlays: [], profile: null, graph_hash: resolved.graph_hash, grammar_version: 1, name: 'handoff-child' },
    orchestrator: { options: { inputs: { subject: 'the store', embedded: true } }, driver: { kind: 'terminal' }, parent: { run: crashed.path, node: 'first' } },
  });
  const frozen = fs.readFileSync(child.state, 'utf8');
  const adopted = handoff(crashed, 'first');
  assert.equal(adopted.code, 0, adopted.stdout + adopted.stderr);
  assert.equal(fs.readFileSync(child.state, 'utf8'), frozen, 'the child was not frozen again');
  assert.equal(readState(crashed).workflow.nodes.first.status, 'waiting');
  assert.deepEqual(fs.readdirSync(path.join(crashed.root, '.maister', 'tasks', 'handoff-child')), ['2026-01-05-handoff-first']);
});

test('a stopped child: one stop patch, the stopped: line, and run-complete closes without RUN-FAILED', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child, { status: 'stopped' });
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(closing(result), `stopped: first run=${child.name} — the sub-run stopped and the stop patch is written: run run-complete`);
  const state = readState(run);
  assert.equal(state.task.status, 'stopped');
  for (const id of ['first', 'remedy', 'confirm', 'second', 'wrap']) assert.equal(state.workflow.nodes[id].status, 'stopped', id);
  assert.equal(state.node_summaries.first.status, 'skipped');
  const complete = verb(['run-complete', `--state=${run.state}`]);
  assert.doesNotMatch(complete.stdout, /RUN-FAILED/);
});

test('a failed child: the node fails, and with no node taking the failure the close prints the pinned reason', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child, { status: 'failed' });
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stderr);
  assert.match(closing(result), /^next: none — /);
  assert.equal(readState(run).workflow.nodes.first.status, 'failed');
  write(run, { task: { status: 'failed' } });
  const complete = verb(['run-complete', `--state=${run.state}`]);
  assert.match(complete.stdout, new RegExp(`RUN-FAILED: sub-run ${child.name} failed`));
});

test('a failed child whose node an `on: always` step follows: the next: line names that step', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child);
  handoff(run, 'first');
  const second = childOf(run, 'second');
  finish(second, { status: 'failed' });
  const result = handoff(run, 'second');
  assert.equal(closing(result), 'next: wrap (Wrap) — run node-brief for it');
});

test('a child whose definition changed after its freeze: subrun-graph-drifted, nothing written', t => {
  const { run, child } = waitingOnFirst(t);
  finish(child);
  const file = path.join(run.root, '.maister', 'workflows', 'handoff-child.yml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Probe finished. Settle its findings?', 'Probe done. Settle?'));
  const before = snapshot(run.root);
  const report = refusal(handoff(run, 'first'), 'subrun-graph-drifted');
  assert.match(report.message, /resolves to .*not to the recorded/);
  assert.deepEqual(snapshot(run.root), before);
});

test('a child directory gone, or holding another node\'s run: subrun-state-missing and subrun-child-foreign, nothing written', t => {
  const { run, child } = waitingOnFirst(t);
  fs.rmSync(child.dir, { recursive: true, force: true });
  const before = snapshot(run.root);
  refusal(handoff(run, 'first'), 'subrun-state-missing');
  assert.deepEqual(snapshot(run.root), before);

  const foreign = waitingOnFirst(t);
  const text = fs.readFileSync(foreign.child.state, 'utf8').replace(/node: first\}/, 'node: second}');
  fs.writeFileSync(foreign.child.state, text);
  refusal(handoff(foreign.run, 'first'), 'subrun-child-foreign');
});

test('a node that is no sub-run, or one not in the run: the subrun-path codes', t => {
  const run = parent(t);
  refusal(handoff(run, 'remedy'), 'subrun-path-not-a-subrun');
  refusal(handoff(run, 'nowhere'), 'subrun-path-unknown-node');
});

test('checks 4 and 5 on the next child, after W1: a required input missing, an unknown one, an output the child does not expose', t => {
  const cases = [
    ['subrun-input-missing', text => text.replace('    with:\n      subject: "${inputs.topic}"\n\n  wrap:', '\n  wrap:')],
    ['subrun-input-unknown', text => text.replace('      subject: "${inputs.topic}"\n\n  wrap:', '      subject: "${inputs.topic}"\n      depth: deep\n\n  wrap:')],
    ['subrun-output-unmatched', text => text.replace('      subject: "${inputs.topic}"\n\n  wrap:', '      subject: "${inputs.topic}"\n    outputs:\n      values:\n        verdict: bool\n\n  wrap:')],
  ];
  for (const [code, edit] of cases) {
    const run = scratch(t, { type: 'handoff-parent', name: '2026-01-05-handoff' });
    const home = path.join(run.root, '.maister', 'workflows');
    fs.cpSync(AUTHORED, home, { recursive: true });
    const file = path.join(home, 'handoff-parent.yml');
    const edited = edit(fs.readFileSync(file, 'utf8'));
    assert.notEqual(edited, fs.readFileSync(file, 'utf8'), code);
    fs.writeFileSync(file, edited);
    freeze(run, { definition: file, task: { title: 'Hand-off' }, inputs: { topic: 'the store' } });
    write(run, { nodes: { intake: { status: 'completed' } }, node_summaries: { intake: { summary: 'Took the topic in.' } } });
    handoff(run, 'first');
    finish(childOf(run, 'first'));
    const report = refusal(handoff(run, 'first'), code);
    assert.match(report.message, /Landed before this refusal: W4 adopting first, skip remedy, skip confirm, W1 starting second\./);
    assert.equal(readState(run).workflow.nodes.second.status, 'running', `${code}: W1 landed and nothing after it`);
  }
});

test('walk two: a cockpit parent freezes its child with its driver kind and the project root, no session, features or dispatch id', t => {
  const run = parent(t, { driver: 'cockpit' });
  const result = handoff(run, 'first');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /WAITING-SUBRUN/);
  const driver = readState(childOf(run, 'first')).orchestrator.driver;
  assert.equal(driver.kind, 'cockpit');
  assert.equal(driver.cwd, run.root);
  for (const key of ['session', 'dispatch_id']) assert.equal(driver[key], undefined, key);
});

test('a malformed --at is a usage error, and nothing runs', t => {
  const run = parent(t);
  const before = snapshot(run.root);
  const result = handoff(run, 'first', '--at=yesterday');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: workflow\.mjs subrun-handoff /m);
  assert.deepEqual(snapshot(run.root), before);
});

test('every code the verb raises is in its module header and has a verbs.md row; no script prints the waiting marker', () => {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts', 'lib', 'subrun-handoff.mjs'), 'utf8');
  const header = source.slice(0, source.indexOf('*/'));
  const verbs = fs.readFileSync(path.join(ENGINE_DIR, 'references', 'verbs.md'), 'utf8');
  const codes = ['subrun-state-missing', 'subrun-child-foreign', 'subrun-graph-drifted', 'subrun-input-missing', 'subrun-input-unknown', 'subrun-output-unmatched'];
  for (const code of codes) {
    assert.ok(header.includes(`\`${code}\``), `${code} in the module header`);
    assert.ok(verbs.split('\n').some(line => line.startsWith(`| \`${code}\` |`) && line.length > 160), `${code} has a verbs.md row`);
  }
  assert.ok(verbs.includes('| `subrun-handoff` |'));
  const scripts = path.join(ENGINE_DIR, 'scripts');
  for (const file of [path.join(scripts, 'workflow.mjs'), ...fs.readdirSync(path.join(scripts, 'lib')).map(name => path.join(scripts, 'lib', name))]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /WAITING-SUBRUN/, file);
  }
});
