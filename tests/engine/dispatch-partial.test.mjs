import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, umbrella, verb, write } from '../helpers.mjs';

// A dispatched node — a workflow: node carrying dir: — whose close-out is
// graded partial stays waiting and asks one question: accept the work as
// done, dispatch the node again, or stop the run. Under a cockpit with
// question sets the waiting node builds the request itself, and each answer
// is folded as one operator decision before the write that records its
// status. The request-writing verb is not part of this edition, so the
// suspension is laid on disk the way it lands, as in in-step-questions.test.mjs.

const DEFINITION = path.join(FIXTURES, 'definitions/companion-check.yml');
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const QUESTION_ID = 'remote-dispatch-held';
const HELD = 'the push of branch api-filter, awaiting approval';

/** The held-dispatch question, as references/in-node-questions.md fixes its shape. */
function heldSet() {
  return {
    questions: [{
      id: QUESTION_ID,
      header: 'Dispatch held',
      question: `Remote closed out partial: its work is done, but ${HELD} is still held. How does the run go on?`,
      why: 'Worker summary: filter shipped on api-filter; push held for operator approval.',
      allow_other: false,
      options: [
        { id: 'accept', label: 'Accept the work as done', description: 'Records remote completed and the held item as an open risk; the run goes on.' },
        { id: 'redispatch', label: 'Dispatch the node again', description: 'Sends remote to its member repository as a new dispatch; nothing after it runs until that one closes out.' },
        { id: 'stop', label: 'Stop the run', description: 'Records remote stopped and ends the run here; the held item stays held.' },
      ],
    }],
  };
}

/** A run whose dispatched node `remote` is waiting on its dispatch, everything before it done. */
function waiting(t) {
  const run = scratch(t, { type: 'companion-check', name: '2026-01-05-dispatch-partial' });
  freeze(run, { definition: DEFINITION, orchestrator: { driver: COCKPIT, options: { inputs: { deep: false }, html_output: false } } });
  write(run, { nodes: { draft: { status: 'completed' }, review: { status: 'completed' }, 'deep-dive': { status: 'skipped' } } });
  write(run, { nodes: { audit: { status: 'completed', values: { task_path: '.maister/tasks/companion-check-child/2026-01-05-child', run_id: 'child' } } } });
  write(run, { nodes: { remote: { status: 'waiting' } } });
  return run;
}

function brief(run, node = 'remote') {
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(heldSet()));
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--request', `--patch-file=${file}`]);
}

/** The request file as the request writer lands it, answered with `option`. */
function answered(run, request, option) {
  const options = request.context.checkpoint.questions[0].options
    .map(each => `          - {id: ${each.id}, label: "${each.label}", description: "${each.description}"}`);
  const text = [
    'version: 1',
    'node: remote',
    'kind: question',
    `question: "${request.question}"`,
    'context:',
    '  checkpoint:',
    '    kind: question',
    '    node: remote',
    '    questions:',
    `      - id: ${QUESTION_ID}`,
    `        question: "${request.question}"`,
    '        multi_select: false',
    '        allow_other: false',
    '        options:',
    ...options,
    'asked_at: "2026-01-05T09:00:00Z"',
    'answer:',
    `  option: ${option}`,
    '  answers:',
    `    ${QUESTION_ID}: ${option}`,
    '  answered_by: dana',
    '  at: "2026-01-05T09:12:00Z"',
    '  via: cockpit',
    '',
  ].join('\n');
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'gates/remote.request.yml'), text);
  return { option, answers: { [QUESTION_ID]: option }, answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' };
}

/** Ask, answer with `option`, fold the answer: the run and its decision. */
function decided(t, option) {
  const run = waiting(t);
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  const answer = answered(run, JSON.parse(result.stdout), option);
  write(run, { node_summaries: { remote: { answer } } });
  const state = readState(run);
  assert.equal(state.workflow.nodes.remote.status, 'waiting', 'the fold never moves the node');
  const [decision] = state.node_summaries.remote.decisions;
  assert.equal(decision.by, 'operator');
  assert.equal(decision.question_id, QUESTION_ID);
  return { run, decision };
}

test('a waiting dispatched node asks the held-dispatch question: three options, none recommended, no default', t => {
  const run = waiting(t);
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.equal(request.kind, 'question');
  assert.equal(request.node, 'remote');
  const [question] = request.context.checkpoint.questions;
  assert.equal(question.id, QUESTION_ID);
  assert.match(question.question, new RegExp(HELD));
  assert.deepEqual(question.options.map(option => option.id), ['accept', 'redispatch', 'stop']);
  assert.equal(question.options.some(option => option.recommended), false, 'no option is recommended');
  assert.equal(Object.hasOwn(question, 'default'), false, 'nothing continues on its own');
  assert.equal(question.allow_other, false);
});

test('a waiting workflow: node without dir: is a sub-run, and asks nothing inside itself', t => {
  const run = waiting(t);
  write(run, { nodes: { audit: { status: 'waiting' } } });
  const result = brief(run, 'audit');
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /^gate-brief-not-askable: /);
});

test('accept: the node is recorded completed, and what is held an open risk', t => {
  const { run, decision } = decided(t, 'accept');
  assert.equal(decision.decision, 'Accept the work as done');
  write(run, { nodes: { remote: { status: 'completed' } }, node_summaries: { remote: { risks: [{ risk: `Held after dispatch: ${HELD}`, tag: 'open' }] } } });
  const state = readState(run);
  assert.equal(state.workflow.nodes.remote.status, 'completed');
  assert.deepEqual(JSON.parse(JSON.stringify(state.node_summaries.remote.risks)), [{ risk: `Held after dispatch: ${HELD}`, tag: 'open' }]);
  assert.equal(state.node_summaries.remote.decisions.length, 1, 'the answer stays recorded');
});

test('redispatch: the node goes back to pending for the ready set to dispatch again', t => {
  const { run, decision } = decided(t, 'redispatch');
  assert.equal(decision.decision, 'Dispatch the node again');
  write(run, { nodes: { remote: { status: 'pending' } } });
  assert.equal(readState(run).workflow.nodes.remote.status, 'pending');
});

test('stop: the node and every unexecuted node are recorded stopped, and the run with them', t => {
  const { run, decision } = decided(t, 'stop');
  assert.equal(decision.decision, 'Stop the run');
  write(run, { task: { status: 'stopped' }, nodes: { remote: { status: 'stopped' }, 'wrap-up': { status: 'stopped' } } });
  const state = readState(run);
  assert.equal(state.task.status, 'stopped');
  assert.equal(state.workflow.nodes.remote.status, 'stopped');
  assert.equal(state.workflow.nodes['wrap-up'].status, 'stopped');
});

// A partial close-out asks only while the hold is live. When the dispatch's
// ledger entry records its pull request in closeout.prs, as {repo, number, url}, or its
// needs: [permission] follow-up is resolved, the node is completed with a
// by: run decision naming what resolved it, and nothing is asked. The ledger
// fields are read back through the umbrella's own query, as the run reads them.

/** A ledger entry for `remote` closed out partial, with the given pull requests and follow-up; its queried entry. */
function ledgerEntry(t, { prs = [], followup = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const op = (name, args, id = 'd-0001') => {
    const result = umbrella(['ledger', `--ledger=${root}`, `--op=${name}`, '--actor=daemon', ...(id ? [`--dispatch-id=${id}`] : [])], args);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  op('create-entry', { chain: { run_id: '2026-01-05-dispatch-partial', node: 'remote' } }, null);
  if (followup) op('add-followup', { id: 'f-push', summary: HELD });
  op('close-out', { grade: 'partial', prs, summary: 'push held for operator approval' });
  if (followup === 'resolved') op('resolve-followup', { id: 'f-push', by: 'dana' });
  return op('query', {}).entry;
}

/** Whether the entry says the held item already happened: the rule the engine skill states. */
function resolvedBy(entry) {
  const pr = Array.isArray(entry.closeout?.prs) ? entry.closeout.prs[0] : undefined;
  if (pr) return `Held item resolved: pull request ${pr.url} recorded`;
  const done = (entry.followups ?? []).find(item => item.status === 'resolved');
  return done ? `Held item resolved: follow-up ${done.id} resolved by ${done.resolved_by}` : null;
}

const PR = { repo: 'acme/shop', number: 7, url: 'https://example.test/acme/shop/pull/7' };

for (const [name, shape, expected] of [
  ['its pull request recorded in closeout.prs', { prs: [PR] }, `Held item resolved: pull request ${PR.url} recorded`],
  ['its needs: [permission] follow-up resolved', { followup: 'resolved' }, 'Held item resolved: follow-up f-push resolved by dana'],
]) {
  test(`partial with ${name}: the node is completed by: run, and nothing is asked`, t => {
    const entry = ledgerEntry(t, shape);
    if (shape.prs) assert.deepEqual({ ...entry.closeout.prs[0] }, PR, 'the ledger records the pull request as {repo, number, url}');
    const decision = resolvedBy(entry);
    assert.equal(decision, expected, 'the ledger records the hold as resolved');
    const run = waiting(t);
    write(run, { nodes: { remote: { status: 'completed' } }, node_summaries: { remote: { decisions: [{ decision, by: 'run' }] } } });
    const state = readState(run);
    assert.equal(state.workflow.nodes.remote.status, 'completed');
    assert.deepEqual(JSON.parse(JSON.stringify(state.node_summaries.remote.decisions)), [{ decision, by: 'run' }]);
    assert.equal(fs.existsSync(path.join(run.dir, 'gates/remote.request.yml')), false, 'no question was asked');
  });
}

test('partial with the follow-up still open and no pull request: the question is asked, as before', t => {
  assert.equal(resolvedBy(ledgerEntry(t, { followup: 'open' })), null, 'nothing in the ledger resolves the hold');
  const { run, decision } = decided(t, 'accept');
  assert.equal(decision.by, 'operator');
  assert.equal(readState(run).workflow.nodes.remote.status, 'waiting');
});

test('the engine skill and the reference state when a partial close-out is not asked about', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8').split(/\r?\n/);
  const row = skill.find(line => line.startsWith('| `partial` |'));
  assert.match(row, /`closeout\.prs`/);
  assert.match(row, /`needs: \[permission\]` follow-up is `resolved`/);
  const text = skill.join(' ').replace(/\s+/g, ' ');
  assert.match(text, /\*\*A held item already resolved is not asked about\.\*\*/);
  assert.match(text, /Never `by: operator`: nobody answered/);
  const reference = fs.readFileSync(path.join(ENGINE_DIR, 'references/in-node-questions.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(reference, /It asks only while the hold is live: when the dispatch's ledger entry records its pull request in `closeout\.prs`, or its `needs: \[permission\]` follow-up is `resolved`/);
  assert.match(reference, /A pull request is recorded there as `\{repo, number, url\}`, and the decision names its `url`\./);
  assert.match(text, /`<url>` being the `url` of the pull request's `\{repo, number, url\}` entry/);
});

test('the engine skill maps every close-out grade, and the reference fixes the question\'s three options', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8').split(/\r?\n/);
  for (const grade of ['success', 'partial', 'failed']) {
    assert.ok(skill.some(line => line.startsWith(`| \`${grade}\` |`)), `the outcome table has a row for ${grade}`);
  }
  const reference = fs.readFileSync(path.join(ENGINE_DIR, 'references/in-node-questions.md'), 'utf8').split(/\r?\n/);
  for (const label of heldSet().questions[0].options.map(option => option.label)) {
    assert.ok(reference.some(line => line.includes(`"label": "${label}"`)), `the reference fixes the option ${label}`);
  }
});
