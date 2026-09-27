import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, lastLine, scratch, umbrella, verb, write } from '../helpers.mjs';

function complete(run, extra = []) {
  return verb(['run-complete', `--state=${run.state}`, ...extra]);
}

function ended(t, patch, { orchestrator = {}, fixture = null } = {}) {
  const run = scratch(t, { fixture });
  freeze(run, { orchestrator });
  write(run, patch);
  return run;
}

test('completed: RUN-COMPLETE is the whole of stdout, exit 0', t => {
  const run = ended(t, { task: { status: 'completed' } });
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
  const run = ended(t, { task: { status: 'completed' } }, { orchestrator: DISPATCH('a') });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: closeout-unpublished\n');
  assert.match(result.stderr, /neither --outbox nor --dispatch-id was given/);
});

test('dispatch: an outbox holding no close-out is closeout-unpublished', t => {
  const run = ended(t, { task: { status: 'completed' } }, { orchestrator: DISPATCH('b') });
  const outbox = path.join(run.root, 'outbox');
  const result = complete(run, [`--outbox=${outbox}`, '--dispatch-id=d-1']);
  assert.equal(result.stdout, 'RUN-FAILED: closeout-unpublished\n');
  assert.match(result.stderr, /no message at all/);
});

test('dispatch: once the close-out is published the run completes', t => {
  const run = ended(t, { task: { status: 'completed' } }, { orchestrator: DISPATCH('c') });
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
