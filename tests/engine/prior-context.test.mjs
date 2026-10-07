import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { DECLARED, freeze, scratch, verb, write } from '../helpers.mjs';

/** Run `prior-context` against a run; the verb writes nothing, so only its output is asserted. */
function priorContext(run) {
  return verb(['prior-context', `--state=${run.state}`]);
}

/** Freeze the fixture workflow of its own name, `survey`, whose block is derived. */
function survey(t) {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: { subject: 'acme-api' } });
  return run;
}

test('prior-context: a workflow of its own name is rendered from its derived block', t => {
  const run = survey(t);
  write(run, {
    phase_summaries: {
      scanning: { node: 'scan', summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Prior-phase context/);
  assert.match(result.stdout, /Pasted from `survey_context\.phase_summaries` in this run's `orchestrator-state\.yml`: 1 phase, 1 decision, 1 risk\./);
  assert.match(result.stdout, /^### scanning — node: scan$/m);
  assert.match(result.stdout, /^Decisions \(1\):\n- scan the api only$/m);
  assert.match(result.stdout, /^Risks \(1\):\n- rate limits$/m);
});

test('prior-context: a run with no context block renders its node summaries', t => {
  const run = survey(t);
  write(run, {
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only', 'skip the docs site'], risks: [] },
    },
  });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 1 node, 2 decisions, 0 risks\./);
  assert.match(result.stdout, /^### scan$/m);
  assert.match(result.stdout, /^Summary: Scanned the api\.$/m);
  assert.match(result.stdout, /^Decisions \(2\):\n- scan the api only\n- skip the docs site$/m);
  assert.match(result.stdout, /^Risks \(0\): none recorded\.$/m);
});

test('prior-context: a freshly frozen run with nothing recorded says so and exits 0', t => {
  const run = survey(t);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries`.*: 0 nodes, 0 decisions, 0 risks\./);
  assert.match(result.stdout, /^No node has recorded a summary yet: this is the run's first artifact-writing node/m);
});

test('prior-context: a built-in run is rendered from its own block, as it always was', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { phase_summaries: { analysis: { node: 'analysis', summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `task_context\.phase_summaries` in this run's `orchestrator-state\.yml`: 1 phase, 1 decision, 0 risks\./);
  assert.match(result.stdout, /^### analysis — node: analysis$/m);
});

test('prior-context: a shared block ending in _context is never taken for the run\'s own', t => {
  // The unproven run carries `project_context` above the block its first
  // context write installs, so file order alone would pick the wrong one.
  const run = scratch(t, { fixture: 'unproven' });
  write(run, { phase_summaries: { analysis: { summary: 'Analysed.', decisions: ['keep the notes'], risks: [] } } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.ok(text.indexOf('\nproject_context:') < text.indexOf('\ntask_context:'), 'the fixture no longer puts project_context first');
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `task_context\.phase_summaries`/);
  assert.match(result.stdout, /- keep the notes/);
});

test('prior-context: a phase summary written by hand as a bare list is not read as decisions', t => {
  const run = scratch(t, { fixture: 'unproven' });
  write(run, { phase_summaries: { analysis: { summary: 'Analysed.', decisions: ['keep the notes'], risks: [] } } });
  // The writer refuses a summary that is not a map, so only a hand edit can leave one.
  const text = fs.readFileSync(run.state, 'utf8')
    .replace('  phase_summaries:\n', '  phase_summaries:\n    review:\n      - approve the scope\n');
  assert.match(text, /review:\n {6}- approve the scope/, 'the hand edit landed');
  fs.writeFileSync(run.state, text);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /- keep the notes/);
  assert.doesNotMatch(result.stdout, /approve the scope/);
});

test('prior-context: a file that is no run at all is refused', t => {
  const run = scratch(t);
  fs.writeFileSync(run.state, 'orchestrator:\n  started_phase: null\n', 'utf8');
  const result = priorContext(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^prior-context-absent: .*no context block, no node_summaries and no workflow block/);
});

test('prior-context --background: the same items, framed as background an end-user document stays consistent with', t => {
  const run = survey(t);
  write(run, {
    phase_summaries: {
      scanning: { node: 'scan', summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = verb(['prior-context', `--state=${run.state}`, '--background']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Background — what earlier phases decided$/m);
  assert.match(result.stdout, /1 phase, 1 decision, 1 risk\. These are background for a document written for end users/);
  assert.match(result.stdout, /do not reproduce them/);
  assert.doesNotMatch(result.stdout, /binding|do not re-word/, 'nothing tells the writer to carry the items into its document');
  // Every item still arrives, so the writer can stay consistent with each one.
  assert.match(result.stdout, /^Decisions \(1\):\n- scan the api only$/m);
  assert.match(result.stdout, /^Risks \(1\):\n- rate limits$/m);
  assert.match(priorContext(run).stdout, /These are binding\./, 'without the flag the block is binding, as before');
});
