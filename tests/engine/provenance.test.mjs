import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, OPERATOR, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { gateAnswer } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// A gate's answer is the last decision carrying an option, and every reader of
// that answer goes through one helper: an item recorded after the answer — a
// note the run made, a settlement — never stands in for it.

const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

/** A decision the run recorded on the gate after its answer, carrying no option. */
const LATER = { decision: 'Noted after the answer', by: 'run' };

test('the shared reader: the last decision with an option is the answer, whatever follows it', t => {
  const answer = { option: 'continue', answered_by: 'dana' };
  assert.equal(gateAnswer([{ option: 'stop-here' }, answer, LATER, 'a string decision']), answer);
  assert.equal(gateAnswer([LATER]), null);
  assert.equal(gateAnswer(undefined), null);

  // stampGateValues: the gate's values are read from the answer, not the item after it.
  const valued = scratch(t);
  freeze(valued, { definition: OPTIONAL });
  write(valued, { nodes: { specification: { status: 'completed' } } });
  write(valued, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-audit' }, LATER] } },
  });
  assert.deepEqual(readState(valued).workflow.nodes['specification-approval'].values, { audit_enabled: true });

  // gate-revise: the driven fold is recognised through the answer, and the
  // revise decision replaces that item, not the one after it.
  const revised = scratch(t);
  freeze(revised, { definition: REVISE, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(revised, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } } });
  write(revised, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } } });
  write(revised, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'send-back', answered_by: 'dana', at: '2026-01-05T10:00:00Z', via: 'cockpit' }, LATER] } },
  });
  const result = verb(['gate-revise', `--state=${revised.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(result.code, 0, result.stderr);
  const decisions = readState(revised).node_summaries['review-approval'].decisions;
  assert.deepEqual(decisions.map(item => [item.option ?? null, item.attempt ?? null]), [[null, null], ['send-back', 1]]);
  assert.equal(decisions[1].answered_by, 'dana', 'the folded answer\'s name is carried onto the revise decision');

  // run-complete: the stop line names the answer, not the note after it.
  const stopped = scratch(t);
  freeze(stopped);
  fs.mkdirSync(path.join(stopped.dir, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(stopped.dir, 'analysis/report.md'), '');
  write(stopped, {
    task: { status: 'stopped' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'stopped' }, research: { status: 'stopped' } },
    node_summaries: { approval: { status: 'completed', decisions: [{ option: 'stop-here', answered_by: 'dana', at: '2026-01-05T09:05:00Z' }, LATER] } },
  });
  const closed = verb(['run-complete', `--state=${stopped.state}`]);
  assert.equal(closed.stdout, 'run stopped: approval - stop-here\nRUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// provenance: who answered, on whose behalf, under what, and on what evidence
// ---------------------------------------------------------------------------

/** The keys an answer's provenance is carried in; `grants` is never one of them. */
const PROVENANCE = ['actor', 'on_behalf_of', 'policy', 'evidence', 'override_of'];
const PERSON = { kind: 'person', id: OPERATOR };
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

const read = file => JSON.parse(JSON.stringify(parse(fs.readFileSync(file, 'utf8'))));
const pick = (item, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]]));

/** No decision anywhere in the run's state carries `grants`. */
function noGrants(run) {
  for (const [id, summary] of Object.entries(readState(run).node_summaries ?? {})) {
    for (const item of summary?.decisions ?? []) {
      assert.equal(Object.hasOwn(Object(item), 'grants'), false, `${id}: ${JSON.stringify(item)}`);
    }
  }
}

test('a terminal gate answer gains a person actor; one carrying its own name and no via gains none', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft' }] } },
  });
  const [stamped] = readState(run).node_summaries['review-approval'].decisions;
  assert.deepEqual([stamped.answered_by, stamped.via, stamped.actor], [OPERATOR, 'terminal', PERSON]);

  const named = scratch(t);
  freeze(named, { definition: REVISE });
  write(named, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft', answered_by: '@marek' }] } },
  });
  const [kept] = readState(named).node_summaries['review-approval'].decisions;
  assert.equal(kept.answered_by, '@marek');
  assert.equal(Object.hasOwn(kept, 'via'), false);
  assert.equal(Object.hasOwn(kept, 'actor'), false, 'no via, so no actor');
});

test('a terminal in-node answer gains the same actor; a run decision and an actor already carried are left alone', t => {
  const run = scratch(t);
  freeze(run);
  const own = { kind: 'agent', id: 'helper' };
  write(run, {
    node_summaries: {
      analysis: {
        decisions: [
          { decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes' },
          { decision: 'No', by: 'operator', question_id: 'b', question: 'Widen it?', answer: 'No', actor: own },
          { decision: 'Kept', by: 'run' },
          { decision: 'Taken', by: 'default', question_id: 'c' },
        ],
      },
    },
  });
  const stored = readState(run).node_summaries.analysis.decisions;
  assert.deepEqual(stored[0].actor, PERSON);
  assert.deepEqual(stored[1].actor, own);
  assert.deepEqual(stored[2], { decision: 'Kept', by: 'run' });
  assert.deepEqual(stored[3], { decision: 'Taken', by: 'default', question_id: 'c' });
});

test('gate-revise copies provenance from its patch file, else from the folded answer, and stamps the terminal actor', t => {
  const terminal = scratch(t);
  freeze(terminal, { definition: REVISE });
  write(terminal, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } } });
  write(terminal, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } } });
  const sent = verb(['gate-revise', `--state=${terminal.state}`, '--node=review-approval', '--option=send-back'],
    { note: 'Tighten the intro', on_behalf_of: 'lee', evidence: ['review.md'], grants: ['push'] });
  assert.equal(sent.code, 0, sent.stderr);
  const [revised] = readState(terminal).node_summaries['review-approval'].decisions;
  assert.deepEqual(pick(revised, [...PROVENANCE, 'grants']), { actor: PERSON, on_behalf_of: 'lee', evidence: ['review.md'] });

  const driven = scratch(t);
  freeze(driven, { definition: REVISE, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(driven, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } } });
  write(driven, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } } });
  const held = { policy: { name: 'sample-policy' }, override_of: 'publish-draft', on_behalf_of: 'lee' };
  write(driven, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'send-back', answered_by: 'dana', at: '2026-01-05T10:00:00Z', via: 'cockpit', ...held }] } },
  });
  const folded = verb(['gate-revise', `--state=${driven.state}`, '--node=review-approval', '--option=send-back'],
    { note: 'Tighten the intro', on_behalf_of: 'kim' });
  assert.equal(folded.code, 0, folded.stderr);
  const [carried] = readState(driven).node_summaries['review-approval'].decisions;
  assert.deepEqual(pick(carried, PROVENANCE), { ...held, on_behalf_of: 'kim' }, 'the patch file wins key by key; no actor for a driven answer');
});

test('a question-set fold copies the five provenance keys and never grants', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  const answerFile = path.join(FIXTURES, 'gates/question-set.provenance.answer.yml');
  const { answer } = read(answerFile);
  assert.deepEqual(answer.grants, ['push'], 'the answer file the driver wrote carries grants');
  const { grants: _grants, ...copied } = answer;
  // The request file holds the answer block whole, less grants, as the driver copies it.
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  const request = fs.readFileSync(path.join(FIXTURES, 'gates/question-set.request.yml'), 'utf8')
    .replace(/^answer: null\n$/m, fs.readFileSync(answerFile, 'utf8').replace(/^ {2}grants: .*\n/m, ''));
  fs.writeFileSync(path.join(run.dir, 'gates/analysis.request.yml'), request);
  assert.deepEqual(read(path.join(run.dir, 'gates/analysis.request.yml')).answer, copied);

  write(run, { node_summaries: { analysis: { answer } } });
  const decisions = readState(run).node_summaries.analysis.decisions;
  assert.equal(decisions.length, 3);
  for (const item of decisions) assert.deepEqual(pick(item, [...PROVENANCE, 'grants']), pick(answer, PROVENANCE));
  noGrants(run);
});

test('a driven gate answer gains the request file\'s provenance; grants reach neither the request nor a decision', t => {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, {
    orchestrator: { gate_pending: { node: 'approval', request: 'gates/approval.request.yml', since: '2026-01-05T09:00:00Z' } },
    nodes: { approval: { status: 'suspended' } },
  });
  const { answer } = read(path.join(FIXTURES, 'gates/approval.provenance.answer.yml'));
  const request = read(path.join(FIXTURES, 'gates/approval.provenance.yml'));
  const { grants: _grants, ...copied } = answer;
  assert.deepEqual(request.answer, copied, 'the request holds the answer file\'s block whole, less grants');

  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.provenance.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  write(run, {
    orchestrator: { gate_pending: null },
    nodes: { approval: { status: 'completed' } },
    node_summaries: { approval: { decisions: [{ option: 'continue', answered_by: 'dana', at: '2026-01-05T09:05:00Z', via: 'cockpit' }] } },
  });
  write(run, {});
  const [item] = readState(run).node_summaries.approval.decisions;
  assert.deepEqual(pick(item, [...PROVENANCE, 'grants']), pick(answer, ['on_behalf_of', 'policy', 'evidence', 'override_of']),
    'copied from the request file; the engine adds no actor to a driven answer');
  noGrants(run);
});

test('a re-sent in-node answer, sent without its attempt, keeps the held answer\'s provenance', t => {
  const run = scratch(t);
  freeze(run);
  const asked = { decision: 'Yes', by: 'operator', question_id: 'scope', question: 'Proceed?', answer: 'Yes', answered_by: 'dana', via: 'cockpit' };
  const provenance = { actor: { kind: 'agent', id: 'helper' }, on_behalf_of: 'dana', policy: { name: 'sample-policy' }, evidence: ['notes.md'], override_of: 'No' };
  write(run, {
    node_summaries: { analysis: { decisions: [{ ...asked, answer: 'No', decision: 'No', attempt: 1 }, { ...asked, attempt: 2, ...provenance }] } },
  });
  write(run, { node_summaries: { analysis: { decisions: [asked] } } });
  const stored = readState(run).node_summaries.analysis.decisions;
  assert.deepEqual(stored.map(item => [item.answer, item.attempt]), [['No', 1], ['Yes', 2]]);
  assert.deepEqual(pick(stored[1], PROVENANCE), provenance);
  assert.deepEqual(pick(stored[0], PROVENANCE), {}, 'the earlier attempt keeps only what it carried');
});

test('prior-context hides the five provenance keys, as it hides when and how an answer arrived', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    node_summaries: {
      analysis: {
        summary: 'Scoped the change.',
        decisions: [{ decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes', answered_by: 'dana', via: 'cockpit',
          actor: { kind: 'agent', id: 'helper' }, on_behalf_of: 'lee', policy: { name: 'sample-policy' }, evidence: ['notes.md'], override_of: 'No' }],
      },
    },
  });
  const result = verb(['prior-context', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Proceed\?/);
  for (const key of [...PROVENANCE, 'via']) assert.doesNotMatch(result.stdout, new RegExp(`\\b${key}\\b`), key);
  assert.doesNotMatch(result.stdout, /helper|sample-policy|notes\.md/);
});

test('a flat gate answer moves its provenance onto the decision; an actor it carries is kept', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const actor = { kind: 'agent', id: 'helper' };
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { answer: 'publish-draft', actor, on_behalf_of: 'lee', evidence: ['notes.md'], override_of: 'hold-draft' } },
  });
  const summary = readState(run).node_summaries['review-approval'];
  const [item] = summary.decisions;
  assert.equal(item.option, 'publish-draft');
  assert.deepEqual(pick(item, PROVENANCE), { actor, on_behalf_of: 'lee', evidence: ['notes.md'], override_of: 'hold-draft' });
  for (const key of PROVENANCE) assert.equal(Object.hasOwn(summary, key), false, `no flat ${key} is left`);
});

test('a flat gate answer drops a grants key written beside it', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { answer: 'publish-draft', grants: ['push'], on_behalf_of: 'lee' } },
  });
  const summary = readState(run).node_summaries['review-approval'];
  assert.equal(Object.hasOwn(summary, 'grants'), false, 'no summary-level grants is left');
  assert.equal(summary.decisions[0].option, 'publish-draft');
  assert.equal(summary.decisions[0].on_behalf_of, 'lee');
  noGrants(run);
});

/** The `gate` fixture run, driven, its approval gate suspended on a request file holding `request`. */
function drivenAt(t, request) {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, {
    orchestrator: { gate_pending: { node: 'approval', request: 'gates/approval.request.yml', since: '2026-01-05T09:00:00Z' } },
    nodes: { approval: { status: 'suspended' } },
  });
  fs.writeFileSync(path.join(run.dir, 'gates/approval.request.yml'), request);
  return run;
}

/** Record the approval gate's driven answer, as the closing write after the request was answered. */
function recordDriven(run, decision) {
  return write(run, {
    orchestrator: { gate_pending: null },
    nodes: { approval: { status: 'completed' } },
    node_summaries: { approval: { decisions: [{ option: 'continue', via: 'cockpit', ...decision }] } },
  });
}

const PROVENANCE_REQUEST = fs.readFileSync(path.join(FIXTURES, 'gates/approval.provenance.yml'), 'utf8');

test('a driven answer whose provenance holds an unusable map key is recorded without that key, with a warning naming the request file', t => {
  const run = drivenAt(t, PROVENANCE_REQUEST.replace(/^ {2}evidence: .*$/m, '  evidence: {"src/a b.md": "the report"}'));
  const recorded = recordDriven(run, { answered_by: 'dana', at: '2026-01-05T09:05:00Z' });
  assert.match(recorded.stderr, /^warning: provenance-unusable:approval:evidence — .*gates[\\/]approval\.request\.yml/m);
  const [item] = readState(run).node_summaries.approval.decisions;
  assert.deepEqual(pick(item, PROVENANCE), { on_behalf_of: 'lee', policy: { name: 'sample-policy', rule: 'review-first' }, override_of: 'stop-here' });
  // Every later write lands too: the copy pass skips the key again rather than
  // refusing, and says so only on the write that judged the gate.
  const again = write(run, {});
  assert.doesNotMatch(again.stderr, /provenance-unusable/);
  assert.equal(Object.hasOwn(readState(run).node_summaries.approval.decisions[0], 'evidence'), false);
});

test('a question-set answer whose provenance holds an unusable map key folds without that key, with a warning', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'gates/question-set.request.yml'), path.join(run.dir, 'gates/analysis.request.yml'));
  const { answer } = read(path.join(FIXTURES, 'gates/question-set.provenance.answer.yml'));
  const result = write(run, { node_summaries: { analysis: { answer: { ...answer, policy: { 'rule name': 'ask-first' } } } } });
  assert.match(result.stderr, /^warning: provenance-unusable:analysis:policy — .*gates[\\/]analysis\.request\.yml/m);
  const decisions = readState(run).node_summaries.analysis.decisions;
  assert.equal(decisions.length, 3);
  for (const item of decisions) assert.deepEqual(pick(item, PROVENANCE), pick(answer, ['actor', 'on_behalf_of', 'evidence', 'override_of']));
});

test('a stale request answer — same option, another answerer — copies nothing onto the gate\'s answer', t => {
  const run = drivenAt(t, PROVENANCE_REQUEST);
  recordDriven(run, { answered_by: 'kim', at: '2026-01-06T10:00:00Z' });
  write(run, {});
  const [item] = readState(run).node_summaries.approval.decisions;
  assert.deepEqual(pick(item, PROVENANCE), {});
});

test('a driven answer recorded at another stamp than the request block\'s still gains its provenance', t => {
  const run = drivenAt(t, PROVENANCE_REQUEST);
  recordDriven(run, { answered_by: 'dana', at: '2026-01-05T09:07:30Z' });
  write(run, {});
  const [item] = readState(run).node_summaries.approval.decisions;
  assert.equal(item.at, '2026-01-05T09:07:30Z');
  assert.deepEqual(pick(item, PROVENANCE), { on_behalf_of: 'lee', policy: { name: 'sample-policy', rule: 'review-first' }, evidence: ['analysis/report.md'], override_of: 'stop-here' });
});

test('a changed in-node answer does not inherit the held answer\'s provenance, and a terminal one gains its person actor', t => {
  const run = scratch(t);
  freeze(run);
  const held = { decision: 'Yes', by: 'operator', question_id: 'scope', question: 'Proceed?', answer: 'Yes', answered_by: 'dana', via: 'cockpit',
    actor: { kind: 'agent', id: 'helper' }, evidence: ['notes.md'], override_of: 'No' };
  write(run, { node_summaries: { analysis: { decisions: [held] } } });
  write(run, { node_summaries: { analysis: { decisions: [{ decision: 'No', by: 'operator', question_id: 'scope', question: 'Proceed?', answer: 'No' }] } } });
  const stored = readState(run).node_summaries.analysis.decisions;
  const current = stored.at(-1);
  assert.equal(current.answer, 'No');
  assert.deepEqual([current.answered_by, current.via], [OPERATOR, 'terminal']);
  assert.deepEqual(pick(current, PROVENANCE), { actor: PERSON });
});

test('the writer strips grants from any decision a patch sends', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: {
      'review-approval': { decisions: [{ option: 'publish-draft', grants: ['push'] }] },
      draft: { decisions: [{ decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes', grants: ['push'] }, { decision: 'Kept', by: 'run', grants: ['tag'] }] },
    },
  });
  noGrants(run);
  assert.equal(readState(run).node_summaries['review-approval'].decisions[0].option, 'publish-draft');
});

test('a flat answer whose decision was already sent merges its provenance onto that decision', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { answer: 'publish-draft', on_behalf_of: 'lee', evidence: ['notes.md'], decisions: [{ option: 'publish-draft', override_of: 'hold-draft' }] } },
  });
  const summary = readState(run).node_summaries['review-approval'];
  assert.equal(summary.decisions.length, 1);
  assert.deepEqual(pick(summary.decisions[0], PROVENANCE), { actor: PERSON, on_behalf_of: 'lee', evidence: ['notes.md'], override_of: 'hold-draft' });
  for (const key of PROVENANCE) assert.equal(Object.hasOwn(summary, key), false, `no flat ${key} is left`);
});
