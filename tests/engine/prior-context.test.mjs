import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, FIXTURES, freeze, legacyMirror, scratch, verb, write } from '../helpers.mjs';

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
    context: { scope: 'api' },
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Prior-phase context/);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 1 node, 1 decision, 1 risk\./);
  assert.match(result.stdout, /^### scan$/m);
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

test('prior-context: a phase-summary mirror an older run carries is ignored', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    context: { risk_level: 'low' },
    node_summaries: { analysis: { summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } },
  });
  legacyMirror(run, [
    '    analysis:',
    '      node: analysis',
    '      summary: Scoped on the mirror.',
    '      decisions:',
    '        - only on the mirror',
  ]);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: \d+ nodes?, 1 decision, 0 risks\./);
  assert.match(result.stdout, /^- keep the parser$/m);
  assert.doesNotMatch(result.stdout, /only on the mirror|Scoped on the mirror|phase_summaries/);
});

test('prior-context: a decision on a node summary reaches later steps once the run has a context block', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } } });
  write(run, { context: { risk_level: 'low' } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: \d+ nodes?, 1 decision, 0 risks\./);
  assert.match(result.stdout, /^### analysis$/m);
  assert.match(result.stdout, /^Decisions \(1\):\n- keep the parser$/m);
  assert.doesNotMatch(result.stdout, /has recorded a summary yet/);
});

test('parity: every decision and risk of the beta.28 mirror reaches later steps', t => {
  const sample = path.join(FIXTURES, 'runs/free-delivery-threshold');
  const reference = JSON.parse(fs.readFileSync(path.join(sample, 'phase-summary-items.json'), 'utf8'));
  const run = scratch(t, { name: '2026-09-30-free-delivery-threshold-per-country' });
  fs.copyFileSync(path.join(sample, 'recorded-state.yml'), run.state);
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /phase_summaries/);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 26 nodes, 41 decisions, 31 risks\./);
  const printed = new Set(result.stdout.split(/\r?\n/));
  const matched = entries => entries.filter(entry =>
    printed.has(`- ${entry.line}`) || (entry.equivalent_line !== undefined && printed.has(`- ${entry.equivalent_line}`)));
  const missing = entries => entries.filter(entry => !matched([entry]).length).map(entry => entry.line);
  assert.deepEqual(missing(reference.decisions), [], 'every mirror decision is printed');
  assert.deepEqual(missing(reference.risks), [], 'every mirror risk is printed');
  const decisions = matched(reference.decisions).length;
  const risks = matched(reference.risks).length;
  t.diagnostic(`matched ${decisions} of ${reference.decisions.length} mirror decisions and ${risks} of ${reference.risks.length} mirror risks`);
});

test('prior-context: a node summary written by hand as a bare list is not read as decisions', t => {
  const run = scratch(t, { fixture: 'unproven' });
  write(run, { node_summaries: { analysis: { summary: 'Analysed.', decisions: ['keep the notes'], risks: [] } } });
  // The writer refuses a summary that is not a map, so only a hand edit can leave one.
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^node_summaries:\r?\n/m, 'node_summaries:\n  review:\n    - approve the scope\n');
  assert.match(text, /review:\n {4}- approve the scope/, 'the hand edit landed');
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
  assert.match(result.stderr, /^prior-context-absent: .*no node_summaries and no workflow block/);
});

test('prior-context --background: the same items, framed as background an end-user document stays consistent with', t => {
  const run = survey(t);
  write(run, {
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = verb(['prior-context', `--state=${run.state}`, '--background']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Background — what earlier phases decided$/m);
  assert.match(result.stdout, /1 node, 1 decision, 1 risk\. These are background for a document written for end users/);
  assert.match(result.stdout, /do not reproduce them/);
  assert.doesNotMatch(result.stdout, /binding|do not re-word/, 'nothing tells the writer to carry the items into its document');
  // Every item still arrives, so the writer can stay consistent with each one.
  assert.match(result.stdout, /^Decisions \(1\):\n- scan the api only$/m);
  assert.match(result.stdout, /^Risks \(1\):\n- rate limits$/m);
  assert.match(priorContext(run).stdout, /These are binding\./, 'without the flag the block is binding, as before');
});

test('prior-context: without --node the output is the prior-phase passage alone, byte for byte', t => {
  const run = survey(t);
  write(run, { node_summaries: { scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: [] } } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    '## Prior-phase context — decisions and risks carried forward',
    '',
    'Pasted from `node_summaries` in this run\'s `orchestrator-state.yml`: 1 node, 1 decision, 0 risks. '
      + 'These are binding. Every item below is one item in state — do not drop one, do not merge two, and do not re-word them.',
    '',
    '### scan',
    '',
    'Summary: Scanned the api.',
    '',
    'Decisions (1):',
    '- scan the api only',
    '',
    'Risks (0): none recorded.',
    '',
    'Status: pending',
    '',
    '',
  ].join('\n'));
});

test('prior-context --node: a node the run does not have is refused by the run block before anything prints', t => {
  const run = survey(t);
  const result = verb(['prior-context', `--state=${run.state}`, '--node=nope']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^run-context-unknown-node: /);
});
