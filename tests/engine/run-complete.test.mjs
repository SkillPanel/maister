import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, lastLine, readState, scratch, sibling, umbrella, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

function complete(run, extra = []) {
  return verb(['run-complete', `--state=${run.state}`, ...extra]);
}

/**
 * A sample run, frozen and closed by `patch`. The analysis report its first node
 * declares is on disk unless `report` is false, so a test about the marker
 * reads the marker alone.
 */
function ended(t, patch, { orchestrator = {}, fixture = null, report = true } = {}) {
  const run = scratch(t, { fixture });
  freeze(run, { orchestrator });
  if (report) put(run.dir, 'analysis/report.md');
  write(run, patch);
  return run;
}

/** Write an empty file at `relative` under `dir`, creating its directory. */
function put(dir, relative) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

/** The sample's every node recorded `completed`: a completed run that owes nothing. */
const SAMPLE_DONE = {
  analysis: { status: 'completed' },
  approval: { status: 'completed' },
  implementation: { status: 'completed' },
  research: { status: 'completed' },
};

test('completed: RUN-COMPLETE is the whole of stdout, exit 0', t => {
  const run = ended(t, { task: { status: 'completed' }, nodes: SAMPLE_DONE });
  const result = complete(run);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
  assert.equal(result.stderr, '');
});

test('failed: the marker names the first failed node in graph order, exit 1', t => {
  const run = ended(t, {
    task: { status: 'failed' },
    nodes: { analysis: { status: 'completed' }, implementation: { status: 'failed' }, research: { status: 'failed' } },
  });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: node implementation failed\n');
  assert.match(result.stderr, /task\.status failed/);
});

test('failed with no failed node still fails: the status decides the marker, never the nodes alone', t => {
  const run = ended(t, { task: { status: 'failed' }, nodes: { analysis: { status: 'completed' } } });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result.stdout), 'RUN-FAILED: task-failed');
});

test('stopped at a driven gate: the notice names the option label, RUN-COMPLETE stays last', t => {
  const run = ended(t, {
    task: { status: 'stopped' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'stopped' }, research: { status: 'stopped' } },
  }, { fixture: 'gate' });
  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.stopped.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  const result = complete(run);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'run stopped: approval - Stop here\nRUN-COMPLETE\n');
});

test('stopped at an in-session gate: the option comes from the gate\'s recorded decision', t => {
  const run = ended(t, {
    task: { status: 'stopped' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'stopped' } },
    node_summaries: { approval: { status: 'completed', decisions: [{ option: 'stop-here', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] } },
  });
  const result = complete(run);
  assert.equal(result.stdout, 'run stopped: approval - stop-here\nRUN-COMPLETE\n');
});

test('a run still in progress has recorded no ending: refused, exit 1', t => {
  const run = scratch(t);
  freeze(run);
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: run-not-ended\n');
  assert.match(result.stderr, /^run-not-ended\b/);
});

test('a missing state file is no run to close: refused, exit 1', t => {
  const run = scratch(t);
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: state-missing\n');
  assert.match(result.stderr, /does not exist/);
});

// ---------------------------------------------------------------------------
// a dispatched run owes its chain a close-out in the outbox
// ---------------------------------------------------------------------------

const DISPATCH = id => ({ driver: { kind: 'dispatch', cwd: `/work/${id}` } });

test('dispatch: completed but no --outbox given is closeout-unpublished', t => {
  const run = ended(t, { task: { status: 'completed' }, nodes: SAMPLE_DONE }, { orchestrator: DISPATCH('a') });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: closeout-unpublished\n');
  assert.match(result.stderr, /neither --outbox nor --dispatch-id was given/);
});

test('dispatch: an outbox holding no close-out is closeout-unpublished', t => {
  const run = ended(t, { task: { status: 'completed' }, nodes: SAMPLE_DONE }, { orchestrator: DISPATCH('b') });
  const outbox = path.join(run.root, 'outbox');
  const result = complete(run, [`--outbox=${outbox}`, '--dispatch-id=d-1']);
  assert.equal(result.stdout, 'RUN-FAILED: closeout-unpublished\n');
  assert.match(result.stderr, /no message at all/);
});

test('dispatch: once the close-out is published the run completes', t => {
  const run = ended(t, { task: { status: 'completed' }, nodes: SAMPLE_DONE }, { orchestrator: DISPATCH('c') });
  const outbox = path.join(run.root, 'outbox');
  const published = umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-1', '--type=closeout'], { grade: 'success', summary: 'done' });
  assert.equal(published.code, 0, published.stdout);
  const result = complete(run, [`--outbox=${outbox}`, '--dispatch-id=d-1']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('dispatch: a failed run is still checked for its close-out before its failure is reported', t => {
  const run = ended(t, { task: { status: 'failed' }, nodes: { analysis: { status: 'failed' } } }, { orchestrator: DISPATCH('d') });
  const outbox = path.join(run.root, 'outbox');
  assert.equal(complete(run, [`--outbox=${outbox}`, '--dispatch-id=d-1']).stdout, 'RUN-FAILED: closeout-unpublished\n');
  umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-1', '--type=closeout'], { grade: 'failed', summary: 'analysis failed' });
  assert.equal(complete(run, [`--outbox=${outbox}`, '--dispatch-id=d-1']).stdout, 'RUN-FAILED: node analysis failed\n');
});

// ---------------------------------------------------------------------------
// a completed run owes every node the ready set can still reach
// ---------------------------------------------------------------------------

const DEFINITIONS = path.join(FIXTURES, 'definitions');
const CLOSING = path.join(DEFINITIONS, 'closing.yml');
const CLOSING_OVERLAY = path.join(DEFINITIONS, 'closing.overlay.yml');
const CLOSING_CHILD = path.join(DEFINITIONS, 'closing-child.yml');
const RECOVERY = path.join(DEFINITIONS, 'recovery.yml');

/** A run of `definition`, frozen, with every node pending. */
function frozen(t, { definition = CLOSING, overlays = [], inputs = null, orchestrator = {} } = {}) {
  const run = scratch(t, { type: 'closing', name: '2026-01-05-closing' });
  freeze(run, { definition, overlays, inputs, orchestrator });
  return run;
}

/**
 * The closing run as a driver that never skipped a thing leaves it: every node
 * completed, the intake recording `needs_review`, with `overrides` laid over.
 */
function closingNodes(overrides = {}) {
  return {
    intake: { status: 'completed', values: { needs_review: true } },
    review: { status: 'completed' },
    'deep-dive': { status: 'completed' },
    audit: { status: 'completed' },
    report: { status: 'completed' },
    notify: { status: 'completed' },
    ...overrides,
  };
}

/** Close the run as `completed` with `nodes`, and judge it. */
function closeWith(run, nodes, status = 'completed') {
  write(run, { task: { status }, nodes });
  return complete(run);
}

/** The refusal's shape: its marker alone on stdout, its code first on stderr, exit 1. */
function assertUnfinished(result, named) {
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /^run-nodes-unfinished\b/);
  const listed = /not finished: (.*?)\. /.exec(result.stderr)?.[1] ?? '';
  assert.deepEqual(listed.split(', ').map(item => item.replace(/ \(.*$/, '')), named, result.stderr);
  // No owed node here is a gate the skip-guard rule asks, so the rule is not explained.
  assert.doesNotMatch(result.stderr, /asked whatever its guard reads/);
}

test('completed with every node ended: RUN-COMPLETE', t => {
  const run = frozen(t);
  const result = closeWith(run, closingNodes());
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

test('a node an overlay added and nobody ran is owed; running it lets the run close', t => {
  const run = frozen(t, { overlays: [CLOSING_OVERLAY] });
  const result = closeWith(run, closingNodes());
  assertUnfinished(result, ['security-review']);
  assert.match(result.stderr, /security-review \(pending\)/);
  assert.match(result.stderr, /record skipped for one whose guard is false/, 'the refusal names its recovery');

  write(run, { nodes: { 'security-review': { status: 'completed' } } });
  const again = complete(run);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(lastLine(again.stdout), 'RUN-COMPLETE');
});

test('an on: always node that never ran is owed', t => {
  const run = frozen(t);
  assertUnfinished(closeWith(run, closingNodes({ notify: { status: 'pending' } })), ['notify']);
});

test('a node that started and never ended is owed, whatever its needs', t => {
  const run = frozen(t);
  const result = closeWith(run, closingNodes({ report: { status: 'running' } }));
  assertUnfinished(result, ['report']);
  assert.match(result.stderr, /report \(running\)/);
});

test('a suspended gate is owed, and so is every node behind it', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { task: { status: 'completed' }, nodes: { analysis: { status: 'completed' }, approval: { status: 'suspended' } } });
  const result = complete(run);
  assertUnfinished(result, ['approval', 'implementation', 'research']);
  assert.match(result.stderr, /approval \(suspended\)/);
});

test('a node a false guard keeps off the path is not owed, even left pending', t => {
  const run = frozen(t);
  const result = closeWith(run, closingNodes({
    intake: { status: 'completed', values: { needs_review: false } },
    review: { status: 'pending' },
    'deep-dive': { status: 'pending' },
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

test('a skip satisfies what follows: the nodes behind a false guard are owed', t => {
  const run = frozen(t);
  const result = closeWith(run, {
    intake: { status: 'completed', values: { needs_review: false } },
  });
  assertUnfinished(result, ['audit', 'notify', 'report']);
});

test('a node whose guard is true is owed', t => {
  const run = frozen(t);
  assertUnfinished(closeWith(run, closingNodes({ review: { status: 'pending' } })), ['review']);
});

test('a guard on an input reads the inputs the run froze', t => {
  const run = frozen(t, { inputs: { deep: true } });
  assertUnfinished(closeWith(run, closingNodes({ 'deep-dive': { status: 'pending' } })), ['deep-dive']);
});

test('a guard that reads a value never recorded cannot rule its node out, and the refusal says so', t => {
  const run = frozen(t);
  const result = closeWith(run, closingNodes({ intake: { status: 'completed' }, review: { status: 'pending' } }));
  assertUnfinished(result, ['review']);
  assert.match(result.stderr, /its guard \$\{intake\.values\.needs_review\} reads a value that was never recorded/);
});

test('behind a failed need the default on: is off the path, and on: always is not', t => {
  const run = frozen(t);
  const failedAudit = closingNodes({ audit: { status: 'failed' }, report: { status: 'pending' }, notify: { status: 'pending' } });
  assertUnfinished(closeWith(run, failedAudit), ['notify']);

  write(run, { nodes: { notify: { status: 'completed' } } });
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

test('a definition changed since the freeze: no guard is evaluated, and recording the skip closes the run', t => {
  const run = scratch(t, { type: 'closing', name: '2026-01-05-drifted' });
  const copy = path.join(run.root, 'definitions');
  fs.mkdirSync(copy);
  for (const name of ['closing.yml', 'closing.md']) fs.copyFileSync(path.join(DEFINITIONS, name), path.join(copy, name));
  const definition = path.join(copy, 'closing.yml');
  freeze(run, { definition });
  fs.writeFileSync(definition, fs.readFileSync(definition, 'utf8').replace('"the intake"', '"the intake, revised"'));

  const result = closeWith(run, closingNodes({
    intake: { status: 'completed', values: { needs_review: false } },
    review: { status: 'pending' },
  }));
  assertUnfinished(result, ['review']);
  assert.match(result.stderr, /has changed since the freeze, so no guard was evaluated/);

  write(run, { nodes: { review: { status: 'skipped' } } });
  const again = complete(run);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, 'RUN-COMPLETE\n', 'no artifact is judged against a definition the run did not freeze');
  assert.match(again.stderr, /^warning: declared artifacts were not checked\b/);
});

test('only a completed run is judged: a stopped or failed one keeps its own ending', t => {
  const stopped = frozen(t);
  const stop = closeWith(stopped, closingNodes({ notify: { status: 'pending' } }), 'stopped');
  assert.equal(stop.code, 0, stop.stderr);
  assert.equal(lastLine(stop.stdout), 'RUN-COMPLETE');

  const failed = frozen(t);
  const fail = closeWith(failed, closingNodes({ audit: { status: 'failed' }, notify: { status: 'pending' } }), 'failed');
  assert.equal(fail.code, 1);
  assert.equal(lastLine(fail.stdout), 'RUN-FAILED: node audit failed');
});

test('dispatch: unfinished nodes are refused before the close-out is checked, published or not', t => {
  const run = frozen(t, { orchestrator: DISPATCH('e') });
  const outbox = path.join(run.root, 'outbox');
  const flags = [`--outbox=${outbox}`, '--dispatch-id=d-1'];
  assertUnfinished(closeWith(run, closingNodes({ notify: { status: 'pending' } })), ['notify']);
  assertUnfinished(complete(run, flags), ['notify']);

  umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-1', '--type=closeout'], { grade: 'success', summary: 'done' });
  assertUnfinished(complete(run, flags), ['notify']);
});

test('a state with no workflow block closes on its status alone', t => {
  const run = scratch(t);
  fs.writeFileSync(run.state, 'orchestrator:\n  completed_phases: [analysis]\n\ntask:\n  title: Prose run\n  status: completed\n');
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

// The ready-set rule skips an `on: failure` node whose needs all completed, so
// `recover` is off the path on the happy run and not owed.
test('an on: failure node whose needs all completed is off the path', t => {
  const run = frozen(t, { definition: RECOVERY });
  const result = closeWith(run, { work: { status: 'completed' }, finish: { status: 'completed' } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

// ---------------------------------------------------------------------------
// the same rule on both sides of a sub-run
// ---------------------------------------------------------------------------

/**
 * A closing parent whose `audit` node has started its child run: the child
 * frozen beside it with its parent link and `embedded` set, the parent node
 * `waiting` on it with the child's address recorded.
 */
function subRun(t) {
  const parent = frozen(t);
  write(parent, { nodes: {
    intake: { status: 'completed', values: { needs_review: false } },
    review: { status: 'skipped' },
    'deep-dive': { status: 'skipped' },
    audit: { status: 'running' },
  } });
  const child = sibling(parent, { type: 'closing-child', name: '2026-01-05-child' });
  freeze(child, {
    definition: CLOSING_CHILD,
    inputs: { subject: 'the intake', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'audit' } },
  });
  write(parent, { nodes: { audit: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return { parent, child };
}

test('child: the guard cascade keeps an unneeded fix and the wrap-up off the path', t => {
  const { child } = subRun(t);
  const result = closeWith(child, { scan: { status: 'completed', values: { blocking: false } } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

test('child: a blocking scan owes its fix, and only its fix', t => {
  const { child } = subRun(t);
  assertUnfinished(closeWith(child, { scan: { status: 'completed', values: { blocking: true } } }), ['fix']);
});

test('parent: completed while its sub-run node still waits is refused, naming what waits behind it', t => {
  const { parent } = subRun(t);
  const result = closeWith(parent, {});
  assertUnfinished(result, ['audit', 'notify', 'report']);
  assert.match(result.stderr, /audit \(waiting\)/);
});

// ---------------------------------------------------------------------------
// the artifacts a completed node declared and did not leave on disk
// ---------------------------------------------------------------------------

/** Every artifact the closing run's own nodes declare, on disk. */
function writeClosingArtifacts(run) {
  put(run.dir, 'analysis/intake.md');
  put(run.dir, 'outputs/summary.md');
  fs.mkdirSync(path.join(run.dir, 'outputs/evidence'), { recursive: true });
}

/** A child run directory beside `run` holding the findings the audit node exposes, and its address. */
function childWithFindings(run, { findings = true } = {}) {
  const child = sibling(run, { type: 'closing-child', name: '2026-01-05-child' });
  if (findings) put(child.dir, 'analysis/findings.md');
  return { task_path: child.path, run_id: child.name };
}

test('every declared artifact on disk, a directory among them: the marker alone', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
  assert.equal(result.stderr, '');
});

test('a declared artifact moved away after its node completed: one line above RUN-COMPLETE, exit 0', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  fs.rmSync(path.join(run.dir, 'analysis/intake.md'));
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: intake analysis/intake.md\nRUN-COMPLETE\n');
});

test('a closing node that never wrote its outputs: a line per declared path, the directory included', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/intake.md');
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: report outputs/evidence\nmissing-artifact: report outputs/summary.md\nRUN-COMPLETE\n');
});

test('a node that did not complete is not held to its artifacts', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/intake.md');
  const result = closeWith(run, {
    intake: { status: 'completed', values: { needs_review: false } },
    review: { status: 'skipped' },
    'deep-dive': { status: 'skipped' },
    audit: { status: 'failed' },
    notify: { status: 'completed' },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n', 'neither the failed audit nor the report it blocked is held to its artifacts');
});

test('a node an overlay added is held to the artifacts the overlay declared for it', t => {
  const run = frozen(t, { overlays: [CLOSING_OVERLAY] });
  writeClosingArtifacts(run);
  const result = closeWith(run, closingNodes({
    audit: { status: 'completed', values: childWithFindings(run) },
    'security-review': { status: 'completed' },
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: security-review verification/security.md\nRUN-COMPLETE\n');
});

test('stopped: the lines sit above the stop notice, and the marker stays last', t => {
  const run = ended(t, {
    task: { status: 'stopped' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'stopped' }, research: { status: 'stopped' } },
    node_summaries: { approval: { status: 'completed', decisions: [{ option: 'stop-here', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] } },
  }, { report: false });
  const result = complete(run);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'missing-artifact: analysis analysis/report.md\nrun stopped: approval - stop-here\nRUN-COMPLETE\n');
});

test('failed: the lines sit above the failure marker, and the exit stays the failure\'s', t => {
  const run = ended(t, {
    task: { status: 'failed' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'failed' } },
  }, { report: false });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'missing-artifact: analysis analysis/report.md\nRUN-FAILED: node implementation failed\n');
});

test('a refusal prints its marker alone, whatever is missing', t => {
  const run = frozen(t);
  const result = closeWith(run, closingNodes({ notify: { status: 'pending' } }));
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
});

test('parent: a sub-run node\'s artifact is looked for in its child\'s directory, never the parent\'s', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  const address = childWithFindings(run, { findings: false });
  put(run.dir, 'analysis/findings.md');
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: address } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `missing-artifact: audit ${address.task_path}/analysis/findings.md\nRUN-COMPLETE\n`);
});

test('parent: a sub-run node that recorded no child address has nowhere its artifact could be', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  put(run.dir, 'analysis/findings.md');
  const result = closeWith(run, closingNodes());
  assert.equal(result.stdout, 'missing-artifact: audit analysis/findings.md\nRUN-COMPLETE\n');
});

test('parent and child close in turn, each reconciling its own declarations', t => {
  const { parent, child } = subRun(t);
  put(child.dir, 'analysis/findings.md');
  const childResult = closeWith(child, { scan: { status: 'completed', values: { blocking: false } } });
  assert.equal(childResult.stdout, 'RUN-COMPLETE\n');

  writeClosingArtifacts(parent);
  fs.rmSync(path.join(parent.dir, 'outputs/summary.md'));
  const parentResult = closeWith(parent, {
    audit: { status: 'completed', values: { task_path: child.path, run_id: child.name } },
    report: { status: 'completed' },
    notify: { status: 'completed' },
  });
  assert.equal(parentResult.code, 0, parentResult.stderr);
  assert.equal(parentResult.stdout, 'missing-artifact: report outputs/summary.md\nRUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// an absence the node sanctioned on its own summary is not a gap
// ---------------------------------------------------------------------------

/** Write `summaries` onto the closing run's node summaries before it closes. */
function sanction(run, summaries) {
  write(run, { node_summaries: summaries });
}

test('a sanctioned absence prints nothing: the marker alone', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/intake.md');
  put(run.dir, 'outputs/summary.md');
  sanction(run, { report: { summary: 'written', absent: { evidence: 'nothing to collect for this subject' } } });
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('a sanctioned absence beside a real one: only the real one is printed', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/intake.md');
  sanction(run, { report: { summary: 'written', absent: { evidence: 'nothing to collect for this subject' } } });
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: report outputs/summary.md\nRUN-COMPLETE\n');
});

test('an absence sanctioned on another node does not excuse this one', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  fs.rmSync(path.join(run.dir, 'analysis/intake.md'));
  sanction(run, { report: { summary: 'written', absent: { summary: 'a different node\'s artifact' } } });
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.stdout, 'missing-artifact: intake analysis/intake.md\nRUN-COMPLETE\n');
});

test('parent: a sub-run node sanctions an artifact its child never wrote', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  const address = childWithFindings(run, { findings: false });
  sanction(run, { audit: { summary: 'the child skipped its scan', absent: { findings: 'the child skipped the node that writes it' } } });
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: address } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('a sanctioned artifact that was written after all is simply present', t => {
  const run = frozen(t);
  writeClosingArtifacts(run);
  sanction(run, { report: { summary: 'written', absent: { evidence: 'expected none' } } });
  const result = closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('a hand-edited absence with no reason sanctions nothing', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/intake.md');
  put(run.dir, 'outputs/summary.md');
  closeWith(run, closingNodes({ audit: { status: 'completed', values: childWithFindings(run) } }));
  fs.appendFileSync(run.state, 'node_summaries:\n  report:\n    absent:\n      evidence: ""\n');
  const result = complete(run);
  assert.equal(result.stdout, 'missing-artifact: report outputs/evidence\nRUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// a real development run, replayed against the shipped definition
// ---------------------------------------------------------------------------

/**
 * The attended development run the fixture was taken from: its state as it
 * recorded it, and its task directory with every file it wrote (emptied). The
 * run is frozen afresh against the shipped `development.yml`, so the fixture
 * does not stale when the definition's hash moves, and then replays the
 * recorded node outcomes and summaries in one closing write. `absent` is laid
 * over the recorded summaries by node id. A recorded node the shipped
 * definition no longer has is left out of the replay: the run recorded it,
 * the graph it is replayed against has no such node to write.
 *
 * The recorded run predates its two optional stretches being decided at a
 * gate: the audit and browser-check choices were values of `specification` and
 * `verification-options`, and the specification gate had one continue. Those
 * values are dropped from the task nodes, and the gate answer is replayed as
 * the continue that sets what the run recorded.
 */
const MOVED_VALUES = { specification: ['spec_audit_enabled'], 'verification-options': ['browser_tests_enabled'] };
const SPLIT_ANSWERS = { 'specification-approval': { 'continue-past-specification': 'continue-to-spec-audit' } };

function replayRecorded(t, absent = {}) {
  const run = scratch(t, { fixture: 'free-delivery-threshold', name: '2026-09-30-free-delivery-threshold-per-country' });
  const recorded = parse(fs.readFileSync(path.join(run.dir, 'recorded-state.yml'), 'utf8'));
  freeze(run, {
    definition: path.join(ENGINE_DIR, 'workflows/development.yml'),
    inputs: { ...recorded.orchestrator.options.inputs },
  });
  const shipped = new Set(Object.keys(readState(run).workflow.nodes));
  const nodes = {};
  for (const [id, entry] of Object.entries(recorded.workflow.nodes)) {
    if (!shipped.has(id)) continue;
    const values = entry.values ? { ...entry.values } : null;
    for (const key of MOVED_VALUES[id] ?? []) delete values?.[key];
    nodes[id] = { status: entry.status, ...(values ? { values } : {}) };
  }
  const summaries = {};
  for (const [id, summary] of Object.entries(recorded.node_summaries)) {
    if (!shipped.has(id)) continue;
    summaries[id] = JSON.parse(JSON.stringify(summary));
    if (Object.hasOwn(absent, id)) summaries[id].absent = absent[id];
    const answer = SPLIT_ANSWERS[id]?.[summaries[id].answer];
    if (answer) summaries[id].answer = answer;
  }
  write(run, { task: { status: recorded.task.status }, nodes, node_summaries: summaries });
  return run;
}

test('recorded run: as it closed, four conditional artifacts read as missing', t => {
  const result = complete(replayRecorded(t));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'missing-artifact: intake analysis/architecture-context',
    'missing-artifact: intake analysis/design-context/INDEX.md',
    'missing-artifact: intake analysis/research-context',
    'missing-artifact: planning implementation/visual-coverage.md',
    'RUN-COMPLETE',
    '',
  ].join('\n'));
});

test('recorded run: with the absences its nodes sanction recorded, it ends on RUN-COMPLETE alone', t => {
  const run = replayRecorded(t, {
    intake: {
      research_context: 'no research was passed in',
      design_index: 'no design context was passed in',
      architecture_context: 'no architecture was passed in',
    },
    planning: { visual_coverage: 'no design index exists, so there is nothing to cover' },
  });
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
  assert.equal(result.stderr, '');
});
