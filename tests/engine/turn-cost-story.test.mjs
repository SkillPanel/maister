// The engine-turn benchmark's story (`tests/benchmark/story/`): a parent workflow and the child
// it starts as a sub-run, authored the way a project authors its own workflows. Both must
// validate clean on every change, so a change to the definition grammar cannot break the story
// unnoticed; and the parent's guarded step and gate must stay off the path with the default
// input, so every measured run crosses a skipped step and a skipped gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, freeze, scratch, verb, write } from '../helpers.mjs';

const STORY = path.join(ROOT, 'tests/benchmark/story');

/** A scratch project holding the story in its own `.maister/workflows/`, and one run directory. */
function project(t) {
  const run = scratch(t, { type: 'benchmark', name: '2026-01-05-turn-cost' });
  const home = path.join(run.root, '.maister/workflows');
  fs.cpSync(STORY, home, { recursive: true });
  return {
    ...run,
    parent: path.join(home, 'turn-cost-story.yml'),
    child: path.join(home, 'turn-cost-probe.yml'),
    env: { CLAUDE_PROJECT_DIR: run.root },
  };
}

function validated(run, definition) {
  const result = verb(['validate', `--definition=${definition}`], undefined, run.env);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  return report;
}

test('the story\'s parent validates clean: eight nodes, two gates, the child found beside it', t => {
  const run = project(t);
  const report = validated(run, run.parent);
  assert.deepEqual(report.counts, { nodes: 8, gates: 2 });
  const probe = report.resolved.find(entry => entry.node === 'probe');
  assert.deepEqual([probe.target, probe.from, probe.at], ['workflow:turn-cost-probe', 'eject', run.child]);
  assert.equal(report.resolved.find(entry => entry.node === 'checks').from, 'plugin');
});

test('the story\'s child validates clean: three nodes, one gate', t => {
  const run = project(t);
  assert.deepEqual(validated(run, run.child).counts, { nodes: 3, gates: 1 });
});

test('the guarded step and gate read the extras input, which is false unless given', t => {
  const run = project(t);
  const result = verb(['resolve', `--definition=${run.parent}`], undefined, run.env);
  assert.equal(result.code, 0, result.stderr);
  const nodes = Object.fromEntries(JSON.parse(result.stdout).nodes.map(node => [node.id, node]));
  assert.equal(nodes.context.when, '${inputs.extras}');
  assert.equal(nodes['checks-approval'].when, '${inputs.extras}');
  assert.equal(nodes['checks-approval'].type, 'gate');
  assert.deepEqual(nodes.locate.needs, ['context']);
  assert.deepEqual(nodes.probe.needs, ['checks-approval']);
});

test('with the default input the guarded gate is never asked', t => {
  const run = project(t);
  freeze(run, { definition: run.parent, inputs: { topic: 'the parser' } });
  // The run up to the gate, `context` left pending: the writer records it skipped itself.
  write(run, {
    nodes: Object.fromEntries(['intake', 'locate', 'locate-approval', 'checks'].map(id => [id, { status: 'completed' }])),
    node_summaries: { locate: { delegated: ['Explore'] } },
  });
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=checks-approval'], undefined, run.env);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /^gate-guard-false: /m);
});
