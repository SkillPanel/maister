import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// A revise sends a run back from a gate. The fixture is a review loop: draft,
// an optional figures step, review, then `review-approval`, whose revise
// re-runs the draft; `side-note` waits on the draft but not on the gate, and
// `final-approval`, after publish, can send the run back past the first gate.

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');
const STRETCH = ['draft', 'figures', 'review', 'review-approval'];

/** A run whose first gate is the question now: everything before it has ended. */
function atGate(t, { figures = true } = {}) {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  complete(run, { figures });
  return run;
}

/** Complete the stretch before `review-approval`, as a run reaching it does. */
function complete(run, { figures = true } = {}) {
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: figures } } },
    node_summaries: {
      draft: { summary: 'Drafted the guide.', decisions: ['Wrote it for new operators'], risks: ['open: the intro repeats the title'] },
    },
  });
  write(run, { nodes: { figures: { status: figures ? 'completed' : 'skipped' }, 'side-note': { status: 'completed' } } });
  write(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed the draft.', risks: ['open: section 2 contradicts the summary'] } },
  });
}

function revise(run, { node = 'review-approval', option = 'send-back', note = 'Tighten the intro', ...rest } = {}) {
  return verb(['gate-revise', `--state=${run.state}`, `--node=${node}`, `--option=${option}`], { note, ...rest });
}

/** Refused, and the state file byte-for-byte what it was. */
function refused(run, result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`^${code}: `));
  return result;
}

function unchanged(run, before) {
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'a refusal leaves the file byte-identical');
}

// ---------------------------------------------------------------------------
// the reset
// ---------------------------------------------------------------------------

test('a revise resets exactly the stretch from its rerun node to the gate', t => {
  const run = atGate(t);
  const result = revise(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: review-approval reruns=draft revision=1\/3 reset=draft,figures,review,review-approval$/m);

  const nodes = readState(run).workflow.nodes;
  for (const id of STRETCH) assert.equal(nodes[id].status, 'pending', `${id} is reset`);
  assert.equal(nodes['side-note'].status, 'completed', 'a side branch off the rerun node is left alone');
  assert.equal(nodes.publish.status, 'pending');
  assert.equal(Object.hasOwn(nodes.publish, 'attempt'), false, 'nothing downstream of the gate is touched');
});

test('a reset node loses its clocks and values and counts its attempt', t => {
  const run = atGate(t);
  revise(run);
  const nodes = readState(run).workflow.nodes;
  for (const id of STRETCH) {
    assert.equal(nodes[id].attempt, 2, id);
    assert.equal(Object.hasOwn(nodes[id], 'started'), false, id);
    assert.equal(Object.hasOwn(nodes[id], 'completed'), false, id);
  }
  assert.equal(Object.hasOwn(nodes.draft, 'values'), false, 'the next attempt records its own values');
  assert.deepEqual(nodes.draft.needs, [], 'the edges survive');
  assert.deepEqual(nodes['review-approval'].reruns, { 'send-back': 'draft' }, 'the gate keeps its targets');
});

test('the decision lands on the gate with the note, the attempt and its target', t => {
  const run = atGate(t);
  revise(run, { note: 'Tighten the intro\nand fix section 2', answered_by: 'operator', at: '2026-01-05T09:30:00Z' });
  const summary = readState(run).node_summaries['review-approval'];
  assert.equal(summary.status, 'pending', 'the gate summary mirrors the reset');
  assert.deepEqual(summary.decisions, [{
    option: 'send-back', answered_by: 'operator', at: '2026-01-05T09:30:00Z', attempt: 1, reruns: 'draft',
    note: 'Tighten the intro and fix section 2',
  }]);
});

test('without an at the writer stamps the decision; without answered_by the operator answered', t => {
  const run = atGate(t);
  revise(run);
  const [decision] = readState(run).node_summaries['review-approval'].decisions;
  assert.equal(decision.answered_by, 'operator');
  assert.match(decision.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('the phases the stretch owned leave completed_phases; the others stay', t => {
  const run = atGate(t);
  write(run, {
    orchestrator: { completed_phases: ['drafting', 'review', 'side-note'] },
    phase_summaries: { drafting: { node: 'draft', summary: 'Drafted.' } },
  });
  revise(run);
  assert.deepEqual(readState(run).orchestrator.completed_phases, ['side-note']);
});

test('a skipped guarded node in the stretch is reset too, and its guard is read again', t => {
  const run = atGate(t, { figures: false });
  revise(run);
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes.figures.status, 'pending');
  assert.equal(nodes.figures.attempt, 2);

  // The draft re-runs and now asks for figures: the run owes them.
  write(run, { nodes: { draft: { status: 'completed', values: { needs_figures: true } } } });
  write(run, { task: { status: 'completed' } });
  const close = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(close.code, 1);
  assert.match(close.stderr, /^run-nodes-unfinished: .*\bfigures\b/m);
});

test('the reset stretch is owed: a run closed mid-revision is refused, the rerun node first among them', t => {
  const run = atGate(t);
  revise(run);
  write(run, { task: { status: 'completed' } });
  const close = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(close.code, 1);
  assert.match(close.stderr, /^run-nodes-unfinished: .*draft/m);
});

test('a gate further on resets the earlier gate inside its stretch, and that gate spends a revision too', t => {
  const run = atGate(t);
  write(run, { nodes: { 'review-approval': { status: 'completed' } } });
  write(run, { nodes: { publish: { status: 'completed' } }, node_summaries: { publish: { summary: 'Published.' } } });
  const result = revise(run, { node: 'final-approval', option: 'redo-draft' });
  assert.equal(result.code, 0, result.stderr);
  const nodes = readState(run).workflow.nodes;
  for (const id of [...STRETCH, 'side-note', 'publish', 'final-approval']) {
    assert.equal(nodes[id].status, 'pending', id);
    assert.equal(nodes[id].attempt, 2, id);
  }
});

test('a node an overlay placed inside the stretch is reset with it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-revise-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['revise.yml', 'revise.md']) fs.copyFileSync(path.join(FIXTURES, 'definitions', file), path.join(dir, file));
  const overlay = path.join(dir, 'revise.overlay.yml');
  fs.writeFileSync(overlay, [
    'extends: review-loop', 'version: 1', 'add:',
    '  fact-check: {uses: "direct:fact-check", needs: [draft], before: [review]}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'revise.overlay.md'), '# Overlay\n\n## `fact-check`\n\nCheck the facts.\n');

  const run = scratch(t);
  freeze(run, { definition: path.join(dir, 'revise.yml'), overlays: [overlay] });
  complete(run);
  write(run, { nodes: { 'fact-check': { status: 'completed' } } });
  assert.equal(revise(run).code, 0);
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes['fact-check'].status, 'pending');
  assert.equal(nodes['fact-check'].attempt, 2);
});

/** A node's line as the file spells it, so a quoted count is told apart from an integer. */
function nodeLine(run, id) {
  return fs.readFileSync(run.state, 'utf8').split('\n').find(line => line.startsWith(`    ${id}: {`)) ?? '';
}

test('a reset node written again keeps its attempt an integer', t => {
  const run = atGate(t);
  revise(run);
  write(run, { nodes: { draft: { status: 'running' } } });
  assert.match(nodeLine(run, 'draft'), /[{ ]attempt: 2,/);
  assert.equal(readState(run).workflow.nodes.draft.attempt, 2);
});

test('a second revise counts on from the first, and its attempt stays an integer too', t => {
  const run = atGate(t);
  revise(run);
  write(run, { nodes: { draft: { status: 'running' } } });
  complete(run);
  const result = revise(run, { note: 'Round 2' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /revision=2\/3/);
  write(run, { nodes: { draft: { status: 'running' } } });
  const nodes = readState(run).workflow.nodes;
  for (const id of STRETCH) {
    assert.match(nodeLine(run, id), /[{ ]attempt: 3,/, id);
    assert.equal(nodes[id].attempt, 3, id);
  }
});

test('an attempt a file already holds quoted is read as its number and written back bare', t => {
  const run = atGate(t);
  revise(run);
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace(/([{ ]attempt: )2,/g, '$1"2",'));
  assert.match(nodeLine(run, 'review-approval'), /[{ ]attempt: "2",/);

  write(run, { task: { status: 'in_progress' } });
  assert.equal(readDashboard(run).phases.find(phase => phase.id === 'review-approval').attempt, 2,
    'a line nothing rewrote still projects the number');
  write(run, { nodes: { draft: { status: 'running' } } });
  assert.match(nodeLine(run, 'draft'), /[{ ]attempt: 2,/, 'the node\'s next write re-emits it as an integer');

  complete(run);
  const result = revise(run, { note: 'Round 2' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /revision=2\/3/);
  for (const id of STRETCH) assert.match(nodeLine(run, id), /[{ ]attempt: 3,/, id);
});

test('the other counters a run records keep their type through the writes after a revise', t => {
  const run = atGate(t);
  write(run, { orchestrator: { auto_fix_attempts: { review: 2 } }, verification_context: { reverify_count: 1 } });
  revise(run);
  complete(run);
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft', answered_by: 'operator', at: '2026-01-05T11:00:00Z' }] } },
    orchestrator: { auto_fix_attempts: { draft: 1 } },
    verification_context: { fixes_applied: ['tightened the intro'] },
  });
  const state = readState(run);
  assert.deepEqual(state.orchestrator.auto_fix_attempts, { review: 2, draft: 1 });
  assert.equal(state.verification_context.reverify_count, 1);
  assert.equal(state.node_summaries['review-approval'].decisions[0].attempt, 1);
});

test('the dashboard carries the attempt and the revise decision', t => {
  const run = atGate(t);
  revise(run);
  const phases = readDashboard(run).phases;
  const gate = phases.find(phase => phase.id === 'review-approval');
  assert.equal(gate.attempt, 2);
  assert.equal(gate.decisions[0].decision, 'send-back');
  assert.equal(gate.decisions[0].note, 'Tighten the intro');
  assert.equal(Object.hasOwn(phases.find(phase => phase.id === 'publish'), 'attempt'), false, 'an untouched node carries no attempt');
});

// ---------------------------------------------------------------------------
// the driven fold, idempotence and the budget
// ---------------------------------------------------------------------------

test('after a driven fold the verb completes the recorded answer in place rather than adding a second', t => {
  const run = atGate(t);
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'send-back', answered_by: 'cockpit:ana', at: '2026-01-05T09:40:00Z' }] } },
  });
  const result = revise(run, { note: 'Fix section 2' });
  assert.equal(result.code, 0, result.stderr);
  const summary = readState(run).node_summaries['review-approval'];
  assert.deepEqual(summary.decisions, [{
    option: 'send-back', answered_by: 'cockpit:ana', at: '2026-01-05T09:40:00Z', attempt: 1, reruns: 'draft', note: 'Fix section 2',
  }]);
  assert.equal(readState(run).workflow.nodes.draft.status, 'pending');
});

test('a second call after the reset is refused, and the file is untouched', t => {
  const run = atGate(t);
  assert.equal(revise(run).code, 0);
  const before = fs.readFileSync(run.state, 'utf8');
  const again = refused(run, revise(run), 'revise-gate-not-current');
  assert.match(again.stderr, /it still waits on review/);
  unchanged(run, before);
});

test('three revisions per gate: the fourth is refused', t => {
  const run = atGate(t);
  for (let round = 1; round <= 3; round++) {
    const result = revise(run, { note: `Round ${round}` });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`revision=${round}/3`));
    complete(run);
  }
  assert.equal(readState(run).workflow.nodes['review-approval'].attempt, 4);
  const before = fs.readFileSync(run.state, 'utf8');
  refused(run, revise(run, { note: 'Round 4' }), 'revise-budget-exhausted');
  unchanged(run, before);

  // Every round's note is kept on the gate, in order, and an answer after them keeps them.
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft', answered_by: 'operator', at: '2026-01-05T11:00:00Z' }] } },
  });
  const notes = readState(run).node_summaries['review-approval'].decisions.map(decision => decision.note ?? decision.option);
  assert.deepEqual(notes, ['Round 1', 'Round 2', 'Round 3', 'publish-draft']);
});

// ---------------------------------------------------------------------------
// the refusal register: every code raised, documented and provoked
// ---------------------------------------------------------------------------

const REFUSALS = [
  'revise-not-a-gate',
  'revise-option-unknown',
  'revise-note-missing',
  'revise-gate-not-current',
  'revise-budget-exhausted',
  'revise-stretch-has-subrun',
];

test('the refusal list is exactly the codes the verb raises', () => {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/revise.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(revise-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
});

test('every refusal has a recovery row in the engine skill', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
  for (const code of REFUSALS) {
    const row = skill.split('\n').find(line => line.startsWith('|') && line.includes(`\`${code}\``));
    assert.ok(row, `no refusal row names ${code}`);
    assert.ok(row.length > 160, `the row for ${code} is too short to tell an operator what to do`);
  }
});

test('provoked: a node that is not a gate, and an option that is not a revise', t => {
  const run = atGate(t);
  const before = fs.readFileSync(run.state, 'utf8');
  refused(run, revise(run, { node: 'review' }), 'revise-not-a-gate');
  refused(run, revise(run, { node: 'nowhere' }), 'revise-not-a-gate');
  const unknown = refused(run, revise(run, { option: 'publish-draft' }), 'revise-option-unknown');
  assert.match(unknown.stderr, /its revise options are send-back/);
  unchanged(run, before);
});

test('provoked: a revise without a note, or with an at that is not a stamp', t => {
  const run = atGate(t);
  const before = fs.readFileSync(run.state, 'utf8');
  refused(run, revise(run, { note: '   ' }), 'revise-note-missing');
  refused(run, revise(run, { at: 'yesterday' }), 'revise-note-missing');
  unchanged(run, before);
});

test('provoked: a gate the run has not reached, one already answered, one a driver is still asked', t => {
  const early = scratch(t);
  freeze(early, { definition: REVISE });
  refused(early, revise(early), 'revise-gate-not-current');

  const answered = atGate(t);
  write(answered, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft', answered_by: 'operator', at: '2026-01-05T10:00:00Z' }] } },
  });
  assert.match(refused(answered, revise(answered), 'revise-gate-not-current').stderr, /it is recorded completed/);

  const asked = atGate(t);
  fs.mkdirSync(path.join(asked.dir, 'gates'), { recursive: true });
  fs.writeFileSync(path.join(asked.dir, 'gates/review-approval.request.yml'), 'version: 1\nnode: review-approval\nanswer: null\n');
  write(asked, {
    orchestrator: { gate_pending: { node: 'review-approval', request: 'gates/review-approval.request.yml', since: '2026-01-05T09:00:00Z' } },
    nodes: { 'review-approval': { status: 'suspended' } },
  });
  assert.match(refused(asked, revise(asked), 'revise-gate-not-current').stderr, /a driver's answer is still awaited/);
});

test('provoked: a stretch that holds a sub-run, however the node line came to say so', t => {
  const run = atGate(t);
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace('    figures: {kind: direct,', '    figures: {kind: workflow,'));
  const before = fs.readFileSync(run.state, 'utf8');
  refused(run, revise(run), 'revise-stretch-has-subrun');
  unchanged(run, before);
});

test('the verb reads its note from the run\'s own patch file and consumes it', t => {
  const run = atGate(t);
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ note: 'From the file' }));
  const result = verb(['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back', `--patch-file=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(file), false);
  assert.equal(readState(run).node_summaries['review-approval'].decisions[0].note, 'From the file');
});

// ---------------------------------------------------------------------------
// what the re-run reads, and what a resume finds
// ---------------------------------------------------------------------------

function priorContext(run) {
  const result = verb(['prior-context', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

function resumeCheck(run) {
  return JSON.parse(verb(['resume-check', `--state=${run.state}`]).stdout);
}

test('prior-context carries the latest revise note under its own heading while the stretch re-runs', t => {
  const run = atGate(t);
  assert.doesNotMatch(priorContext(run), /Revision requested/);
  revise(run, { note: 'Fix section 2; tighten the intro' });
  const text = priorContext(run);
  assert.match(text, /^## Revision requested — review-approval$/m);
  assert.match(text, /re-run `draft` \(revision 1 of 3\)/);
  assert.match(text, /^Note: Fix section 2; tighten the intro$/m);
  assert.match(text, /### draft/, 'the previous attempt\'s summaries are still carried forward');

  // Answered past, the note is history and the section goes.
  complete(run);
  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft', answered_by: 'operator', at: '2099-01-01T00:00:01Z' }] } },
  });
  assert.doesNotMatch(priorContext(run), /Revision requested/);
});

test('resume-check names an open revise and whether its reset has happened', t => {
  const run = atGate(t);
  assert.equal(Object.hasOwn(resumeCheck(run), 'revision'), false, 'a run nobody sent back carries no revision');

  write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'send-back', answered_by: 'cockpit:ana', at: '2026-01-05T09:40:00Z' }] } },
  });
  assert.deepEqual(resumeCheck(run).revision,
    { gate: 'review-approval', option: 'send-back', reruns: 'draft', revision: 1, applied: false });

  revise(run, { note: 'Fix section 2' });
  assert.deepEqual(resumeCheck(run).revision,
    { gate: 'review-approval', option: 'send-back', reruns: 'draft', revision: 1, applied: true });
});
