import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, lastLine, reach, readState, scratch, verb, write } from '../helpers.mjs';

// A node does not complete while a node it needs has not ended. The writer
// refuses the completing write when that need is still on the run's path, and
// records it skipped in the same write when its guard keeps it off; a start is
// never judged. `run-complete` refuses a record that reached the close another
// way. The development run here mirrors the defect that made the rule: its
// implementation completed while the publishing plan gate, guarded on an input
// that was false, was still pending, and the close took the run for finished.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const OFF_PATH_NOTE = /^note: recorded planning-approval-publish skipped: it is off the path this run took \(a false guard\), and implementation needs it ended to complete$/m;

const writeState = (run, patch) => verb(['write-state', `--state=${run.state}`], patch);
const complete = run => verb(['run-complete', `--state=${run.state}`]);

/** Refused `state-node-needs-unmet`, exit 1, the state byte for byte what it was. */
function assertRefused(run, result, before) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^state-node-needs-unmet: this write completes a node before a node it needs has ended: /);
  assert.match(result.stderr, /Nothing was written\./);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
}

/**
 * A development run walked to its plan: every step before the plan gates
 * ended, the guarded stretches recorded skipped by the writer as the walk
 * passes them, and `planning` completed. With `publish` the publishing gate is
 * the one on the path; without it, the plain one.
 */
function atPlan(t, { publish = false } = {}) {
  const run = scratch(t);
  freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page', ...(publish ? { publish: true } : {}) } });
  reach(run, { nodes: { 'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } } } });
  reach(run, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-planning' }] } },
  });
  reach(run, { nodes: { planning: { status: 'completed' } } });
  return run;
}

// ---------------------------------------------------------------------------
// a need on the path refuses the completion
// ---------------------------------------------------------------------------

test('completing a node whose need on the path is pending is refused, naming the need, and nothing is written', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  const before = fs.readFileSync(run.state, 'utf8');
  const result = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assertRefused(run, result, before);
  assert.match(result.stderr, /: implementation needs approval\. /);
  assert.match(result.stderr, /approval is on the path the run takes/);

  // Control: once the need has completed, the same completion lands.
  write(run, { nodes: { approval: { status: 'completed' } } });
  const after = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assert.equal(after.code, 0, after.stderr);
  assert.equal(readState(run).workflow.nodes.implementation.status, 'completed');
});

test('an unended node further upstream refuses too: the message names every node still to run', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assertRefused(run, result, before);
  assert.match(result.stderr, /: implementation needs approval\. Nothing was written\. analysis, approval are on the path the run takes/);
});

test('a need the same write completes counts as ended', t => {
  const run = scratch(t);
  freeze(run);
  const result = writeState(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  const nodes = readState(run).workflow.nodes;
  for (const id of ['analysis', 'approval', 'implementation']) assert.equal(nodes[id].status, 'completed', id);
});

test('starting a node whose need is pending is not judged', t => {
  const run = scratch(t);
  freeze(run);
  const result = writeState(run, { nodes: { implementation: { status: 'running' } } });
  assert.equal(result.code, 0, result.stderr);
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes.implementation.status, 'running');
  assert.equal(nodes.approval.status, 'pending', 'the start records nothing for the need');
});

test('a node completed by an earlier write is not judged again', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' } } });
  // Hand-edit the need back to pending: a later write re-sending the completion is no new completion.
  const text = fs.readFileSync(run.state, 'utf8');
  const edited = text.replace(/^(    approval: \{[^\n]*?)status: completed/m, '$1status: pending');
  assert.notEqual(edited, text);
  fs.writeFileSync(run.state, edited);
  const result = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
});

// ---------------------------------------------------------------------------
// a need off the path is recorded skipped by the completing write
// ---------------------------------------------------------------------------

test('development: implementation completing past the publishing plan gate, its guard false, records that gate skipped with a note', t => {
  const run = atPlan(t);
  write(run, { nodes: { 'planning-approval': { status: 'completed' } } });
  assert.equal(readState(run).workflow.nodes['planning-approval-publish'].status, 'pending');

  const result = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, OFF_PATH_NOTE);
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes.implementation.status, 'completed');
  assert.equal(nodes['planning-approval-publish'].status, 'skipped');
  assert.match(String(nodes['planning-approval-publish'].completed), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'stamped like any skip');
});

test('development: with publish on, the publishing gate is on the path and refuses the completion instead', t => {
  const run = atPlan(t, { publish: true });
  const before = fs.readFileSync(run.state, 'utf8');
  const result = writeState(run, { nodes: { implementation: { status: 'completed' } } });
  assertRefused(run, result, before);
  assert.match(result.stderr, /: implementation needs planning-approval-publish\. /);
  assert.match(result.stderr, /planning-approval-publish is on the path the run takes/);
  // The plain gate ahead of it is the one off the path now, and is named as such.
  assert.match(result.stderr, /planning-approval is off the path \(a false guard\) and will be recorded skipped by that write/);
  assert.doesNotMatch(result.stderr, /^note:/m);
});

// ---------------------------------------------------------------------------
// run-complete refuses a completed node recorded past an unended need
// ---------------------------------------------------------------------------

/** `run`'s state with node `id`'s line turned back to pending, its stamp dropped. */
function backToPending(run, id) {
  const text = fs.readFileSync(run.state, 'utf8');
  const line = new RegExp(`^(    ${id}: \\{[^\\n]*?)status: (?:completed|skipped)((?:, completed: "?[^,}"]+"?)?)`, 'm');
  const edited = text.replace(line, '$1status: pending');
  assert.notEqual(edited, text, `${id}'s line was edited`);
  fs.writeFileSync(run.state, edited);
}

test('run-complete refuses run-needs-unmet for a need still on the path, naming the pair and the node to run', t => {
  const run = scratch(t);
  freeze(run);
  fs.mkdirSync(path.join(run.dir, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'analysis/report.md'), '');
  write(run, { task: { status: 'completed' }, nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' }, research: { status: 'completed' } } });
  assert.equal(complete(run).stdout, 'RUN-COMPLETE\n', 'the control: the record as the writer left it closes');

  backToPending(run, 'approval');
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: run-needs-unmet\n');
  assert.match(result.stderr, /^run-needs-unmet: .*a completed node was recorded past a node it needs that never ended: implementation needs approval\. /);
  assert.match(result.stderr, /Resume the run and run approval, which the path still holds/);
  assert.doesNotMatch(result.stderr, /record skipped/, 'a node on the path is never offered the skip');
});

test('development: run-complete refuses run-needs-unmet for an off-path need left pending and gives the skipped patch, which closes the run', t => {
  const run = atPlan(t);
  write(run, { nodes: { 'planning-approval': { status: 'completed' } } });
  reach(run, { task: { status: 'completed' }, nodes: { finalization: { status: 'completed' } } });
  assert.equal(readState(run).workflow.nodes['planning-approval-publish'].status, 'skipped');

  backToPending(run, 'planning-approval-publish');
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: run-needs-unmet\n');
  assert.match(result.stderr, /: implementation needs planning-approval-publish\. /);
  const patch = { nodes: { 'planning-approval-publish': { status: 'skipped' } } };
  assert.ok(result.stderr.includes(`Record skipped planning-approval-publish, off the path the run took (a false guard): ${JSON.stringify(patch)}`), result.stderr);

  // Control: the patch the refusal gives closes the run.
  write(run, patch);
  const closed = complete(run);
  assert.equal(closed.code, 0, closed.stderr);
  assert.equal(lastLine(closed.stdout), 'RUN-COMPLETE', 'the declared files no step here wrote are listed above the marker, as any close lists them');
});
