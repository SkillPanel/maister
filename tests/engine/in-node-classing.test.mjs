import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, ROOT, freezePatch, readDashboard, readState, run as runScript, scratch, sharedPlugin, sibling, umbrella, verb } from '../helpers.mjs';
import { atClose, heldApprovalBefore, skippedAgain } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';
import { checkpointOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/display-files.mjs';
import { provenGraph } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';
import { approvalsOf, outstandingHeld } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';

// The classing write: a running node sends its question set to `write-state`
// before asking, and the writer — only the writer — settles, defaults or holds
// each question under the run's autonomy ceiling, records what it decided and
// prints `ask:` with the ids still to ask. A cockpit request is then built
// from those ids alone. The writer's items survive later writes of the node's
// decisions, and a revise reset clears them.
//
// The policy fixture's rows name `quick-choice` (decide-alone), `noted-choice`
// (record), `asked-choice` (consult), `signed-choice` (approve) and
// `guarded-choice` (record raised to approve by a floor id). `scoping` declares
// two other ids, so each of these reads as itself and finds its own row; any
// id without a row reads as the policy's unknown family (consult).

const policyOf = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy', name), 'utf8'));
const QUESTIONS = sharedPlugin({ policy: policyOf('questions.json') });
const OTHER = sharedPlugin({ policy: policyOf('questions-default-ceiling.json') });

// The questions policy, with the optional-step gate's classified value added:
// one continue there sets a value the writer records as a settlement item.
const SETTLING = (() => {
  const policy = policyOf('questions.json');
  const classifying = policyOf('classifying.json');
  return { ...policy, families: { ...policy.families, ...classifying.families }, table: [...policy.table, ...classifying.table] };
})();
const WITH_SETTLEMENTS = sharedPlugin({ policy: SETTLING });

const DEFINITION = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const BARE_COCKPIT = { kind: 'cockpit', cwd: '/work' };
const DISPATCH = { kind: 'dispatch', cwd: '/work' };

const TRIAGE_NOTE = /^note: ignored the triage sent on node_summaries\.scoping\.decisions; /m;

/** One `write-state` through `engine` (the shipped engine when null); not asserted. */
function send(engine, run, patch) {
  const args = ['write-state', `--state=${run.state}`];
  return engine ? runScript(engine, args, patch) : verb(args, patch);
}

function ok(engine, run, patch) {
  const result = send(engine, run, patch);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

function refused(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`^${code}: `, 'm'));
  return result;
}

/** A run of `definition` frozen through `engine`, with `node` running. */
function started(t, engine, { ceiling = 'advice', driver = null, definition = DEFINITION, node = 'scoping' } = {}) {
  const run = scratch(t);
  const orchestrator = {};
  if (ceiling) orchestrator.options = { ceiling };
  if (driver) orchestrator.driver = driver;
  ok(engine, run, freezePatch({ definition, orchestrator }).patch);
  ok(engine, run, { nodes: { [node]: { status: 'running' } } });
  return run;
}

/** A question whose first option is recommended, unless `recommended` is false. */
function question(id, { recommended = true, triage } = {}) {
  return {
    id,
    question: `Which ${id}?`,
    options: [
      { id: 'a', label: 'Option A', description: 'A is the safe pick.', ...(recommended ? { recommended: true } : {}) },
      { id: 'b', label: 'Option B' },
    ],
    ...(triage ? { triage } : {}),
  };
}

/** The classing write for `node`: its set, and `reasons` when given. */
function classing(engine, run, ids, { node = 'scoping', reasons, questions } = {}) {
  const set = { questions: questions ?? ids.map(id => question(id)) };
  return send(engine, run, { node_summaries: { [node]: { question_set: set, ...(reasons ? { reasons } : {}) } } });
}

/** The `ask:` line, which follows the changed paths after a blank line. */
function askLine(stdout) {
  const [paths, tail] = stdout.split('\n\n');
  assert.ok(paths.split('\n').length > 0 && tail !== undefined, `no blank line before ask: in ${JSON.stringify(stdout)}`);
  assert.match(tail, /^ask: .+\n$/);
  return tail.trim();
}

const summaryOf = (run, node = 'scoping') => readState(run).node_summaries?.[node] ?? {};
const byId = (decisions, id) => decisions.find(item => item.question_id === id);

/** Brief a question set through `engine`, the set written to the patch file. */
function brief(engine, run, set, form = '--request', node = 'scoping') {
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(set));
  return runScript(engine, ['gate-brief', `--state=${run.state}`, `--node=${node}`, form, `--patch-file=${file}`]);
}

// ---------------------------------------------------------------------------
// 1. the terminal classing write
// ---------------------------------------------------------------------------

test('terminal: the writer settles what the ceiling allows, records it, and prints the rest under ask:', t => {
  const run = started(t, QUESTIONS.engine);
  const result = classing(QUESTIONS.engine, run, ['quick-choice', 'noted-choice', 'asked-choice', 'signed-choice'], {
    reasons: { 'noted-choice': { rationale: 'Matches the existing layout.', assumption: 'Nobody relies on B.', reversal: 'Switch to B and rerun scoping.' } },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(askLine(result.stdout), 'ask: asked-choice signed-choice');
  assert.match(result.stdout, /^node_summaries\.scoping$/m, 'the changed paths come first');

  const summary = summaryOf(run);
  assert.deepEqual(summary.asking, ['asked-choice', 'signed-choice']);
  assert.equal(Object.hasOwn(summary, 'question_set'), false, 'the set is consumed, never stored');
  assert.equal(Object.hasOwn(summary, 'reasons'), false);
  assert.deepEqual(summary.decisions, [
    {
      decision: 'Option A', by: 'run', question_id: 'quick-choice', question: 'Which quick-choice?',
      rationale: 'A is the safe pick.', triage: { version: 1, class: 'decide-alone', family: 'quick-family' },
    },
    {
      decision: 'Option A', by: 'run', question_id: 'noted-choice', question: 'Which noted-choice?',
      rationale: 'Matches the existing layout.', assumption: 'Nobody relies on B.', reversal: 'Switch to B and rerun scoping.',
      triage: { version: 1, class: 'record', family: 'noted-family' },
    },
  ]);

  // A delegate never reads the record-only keys.
  const context = verb(['prior-context', `--state=${run.state}`]);
  assert.equal(context.code, 0, context.stderr);
  assert.match(context.stdout, /question_id: noted-choice/);
  assert.doesNotMatch(context.stdout, /assumption|reversal|triage/);

  // A set the writer settles whole prints `ask: none` and stores an empty remainder.
  const settled = started(t, QUESTIONS.engine);
  const none = classing(QUESTIONS.engine, settled, ['quick-choice']);
  assert.equal(none.code, 0, none.stderr);
  assert.equal(askLine(none.stdout), 'ask: none');
  assert.deepEqual(summaryOf(settled).asking, []);
});

// ---------------------------------------------------------------------------
// 2. nobody can be asked
// ---------------------------------------------------------------------------

test('dispatch, and a cockpit without question sets: consult is defaulted unadvised and approve is held', t => {
  for (const driver of [DISPATCH, BARE_COCKPIT]) {
    const run = started(t, QUESTIONS.engine, { driver });
    const result = classing(QUESTIONS.engine, run, ['quick-choice', 'asked-choice', 'signed-choice', 'guarded-choice'], {
      reasons: { 'signed-choice': { rationale: 'The release notes want A.' } },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(askLine(result.stdout), 'ask: none', driver.kind);

    const { decisions, asking } = summaryOf(run);
    assert.deepEqual(asking, []);
    assert.equal(byId(decisions, 'quick-choice').by, 'run');
    assert.deepEqual(byId(decisions, 'asked-choice'), {
      decision: 'Option A', by: 'default', question_id: 'asked-choice', question: 'Which asked-choice?',
      triage: { version: 1, class: 'consult', family: 'asked-family', advice: 'not_obtained' },
    });
    assert.deepEqual(byId(decisions, 'signed-choice'), {
      decision: 'Option A', by: 'default', question_id: 'signed-choice', question: 'Which signed-choice?',
      rationale: 'The release notes want A.',
      triage: { version: 1, class: 'approve', family: 'signed-family', held: true },
    });
    const guarded = byId(decisions, 'guarded-choice');
    assert.equal(guarded.by, 'default');
    assert.equal(guarded.triage.class, 'approve', 'the floor raises record to approve');
    assert.deepEqual(guarded.triage.floor, ['floor-a']);
    assert.equal(guarded.triage.held, true);
  }
});

// ---------------------------------------------------------------------------
// 3. a carried triage, and a hash mismatch
// ---------------------------------------------------------------------------

test('a carried triage only raises; on a policy hash mismatch nothing is classed', t => {
  // Lower than the computed class: the computed one decides, and the question is settled.
  const lower = started(t, QUESTIONS.engine);
  const low = classing(QUESTIONS.engine, lower, [], {
    questions: [question('noted-choice', { triage: { version: 1, class: 'decide-alone', family: 'area-family' } })],
  });
  assert.equal(askLine(low.stdout), 'ask: none');
  assert.deepEqual(byId(summaryOf(lower).decisions, 'noted-choice').triage, { version: 1, class: 'record', family: 'noted-family' });

  // Higher: the carried class decides, so a record question carrying approve is never settled.
  const higher = started(t, QUESTIONS.engine);
  const high = classing(QUESTIONS.engine, higher, [], {
    questions: [question('noted-choice', { triage: { version: 1, class: 'approve', family: 'area-family' } })],
  });
  assert.equal(askLine(high.stdout), 'ask: noted-choice');
  assert.equal(summaryOf(higher).decisions, undefined);

  const held = started(t, QUESTIONS.engine, { driver: DISPATCH });
  classing(QUESTIONS.engine, held, [], {
    questions: [question('noted-choice', { triage: { version: 1, class: 'approve', family: 'area-family' } })],
  });
  assert.deepEqual(byId(summaryOf(held).decisions, 'noted-choice').triage, { version: 1, class: 'approve', family: 'area-family', held: true });

  // Frozen under one policy, classed under another: nothing is classed or recorded, and every id is asked.
  const drifted = started(t, QUESTIONS.engine);
  const result = classing(OTHER.engine, drifted, ['quick-choice', 'asked-choice']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(askLine(result.stdout), 'ask: quick-choice asked-choice');
  assert.match(result.stderr, /^warning: policy-hash-mismatch:scoping$/m);
  const summary = summaryOf(drifted);
  assert.equal(summary.decisions, undefined);
  assert.equal(Object.hasOwn(summary, 'asking'), false);
});

test('a hash mismatch removes the asking an earlier classing write stored, so the next request uses the set whole', t => {
  const run = started(t, QUESTIONS.engine, { driver: COCKPIT });
  assert.equal(askLine(classing(QUESTIONS.engine, run, ['asked-choice']).stdout), 'ask: asked-choice');
  assert.deepEqual(summaryOf(run).asking, ['asked-choice']);

  // The policy changed under the run: the second set is classed by nothing and asked whole.
  const result = classing(OTHER.engine, run, ['other-choice']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(askLine(result.stdout), 'ask: other-choice');
  assert.match(result.stderr, /^warning: policy-hash-mismatch:scoping$/m);
  assert.equal(Object.hasOwn(summaryOf(run), 'asking'), false);
  const request = brief(OTHER.engine, run, { questions: [question('other-choice')] });
  assert.equal(request.code, 0, request.stderr);
  assert.deepEqual(JSON.parse(request.stdout).context.checkpoint.questions.map(each => each.id), ['other-choice']);
});

// A neutral policy for briefed decision areas: both area questions read as a
// record family, which the advice ceiling settles. The triage an area brief
// stamps on a question rides in with the set.
const AREAS = sharedPlugin({
  policy: (() => {
    const policy = policyOf('questions.json');
    const row = id => ({ workflow: 'in-node-questions', id, kind: 'question', families: ['area-record-family'] });
    return {
      ...policy,
      families: { ...policy.families, 'area-record-family': { class: 'record', description: 'A made-up area family, settled and recorded.' } },
      table: [row('convergence-decisions-storage'), row('convergence-decisions-format')],
    };
  })(),
});

test('a briefed decision area keeps its carried triage through the classing write; a lower one is raised', t => {
  const stamped = { version: 1, class: 'consult', family: 'area-direction' };
  const area = (id, triage) => ({ ...question(id, { triage }), details: `The full write-up of ${id}.` });
  const set = {
    questions: [
      area('convergence-decisions-storage', stamped),
      area('convergence-decisions-format', { version: 1, class: 'decide-alone', family: 'area-direction' }),
    ],
  };

  // Nobody can be asked: the higher carried class decides and is recorded as carried, never lowered to record.
  const driven = started(t, AREAS.engine, { driver: DISPATCH });
  const written = send(AREAS.engine, driven, { node_summaries: { scoping: { question_set: set } } });
  assert.equal(written.code, 0, written.stderr);
  assert.equal(askLine(written.stdout), 'ask: none');
  const decisions = summaryOf(driven).decisions;
  assert.deepEqual(byId(decisions, 'convergence-decisions-storage'), {
    decision: 'Option A', by: 'default', question_id: 'convergence-decisions-storage', question: 'Which convergence-decisions-storage?',
    triage: { ...stamped, advice: 'not_obtained' },
  });
  // The lower carried class is raised to the computed one and settled by the run.
  assert.equal(byId(decisions, 'convergence-decisions-format').by, 'run');
  assert.deepEqual(byId(decisions, 'convergence-decisions-format').triage, { version: 1, class: 'record', family: 'area-record-family' });

  // Somebody can be asked: the carried area stays to ask, and the request's checkpoint keeps its triage and details.
  const asked = started(t, AREAS.engine, { driver: COCKPIT });
  assert.equal(askLine(send(AREAS.engine, asked, { node_summaries: { scoping: { question_set: set } } }).stdout), 'ask: convergence-decisions-storage');
  const result = brief(AREAS.engine, asked, set);
  assert.equal(result.code, 0, result.stderr);
  const [kept] = JSON.parse(result.stdout).context.checkpoint.questions;
  assert.equal(kept.id, 'convergence-decisions-storage');
  assert.deepEqual(kept.triage, stamped, 'the stamped triage is never stripped');
  assert.equal(kept.details, 'The full write-up of convergence-decisions-storage.');
});

// ---------------------------------------------------------------------------
// 4. refusals
// ---------------------------------------------------------------------------

test('a classing write is refused state-patch-invalid for a gate, a node not running, a bad set and bad reasons', t => {
  const run = started(t, QUESTIONS.engine);
  const before = fs.readFileSync(run.state, 'utf8');
  const cases = [
    ['a gate', classing(QUESTIONS.engine, run, ['quick-choice'], { node: 'review-approval' }), /review-approval is a gate/],
    ['a node not running', classing(QUESTIONS.engine, run, ['quick-choice'], { node: 'drafting' }), /drafting is "pending"/],
    ['a set checkSet rejects', classing(QUESTIONS.engine, run, [], { questions: [] }), /"questions" must be a non-empty list/],
    ['an unknown reasons id', classing(QUESTIONS.engine, run, ['quick-choice'], { reasons: { 'no-such': { rationale: 'x' } } }), /"reasons" names "no-such"/],
    ['an unknown reasons key', classing(QUESTIONS.engine, run, ['quick-choice'], { reasons: { 'quick-choice': { why: 'x' } } }), /the key "why"/],
  ];
  for (const [what, result, message] of cases) {
    refused(result, 'state-patch-invalid');
    assert.match(result.stderr, message, what);
  }
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
});

test('a classed question recommending nothing is never refused: it is asked where a person can be, and the rest of the set still settles', t => {
  const run = started(t, QUESTIONS.engine);
  const result = classing(QUESTIONS.engine, run, [], {
    questions: [question('quick-choice'), question('asked-choice', { recommended: false }), question('noted-choice', { recommended: false })],
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(askLine(result.stdout), 'ask: asked-choice noted-choice', 'nothing is invented for a settleable one either');
  const summary = summaryOf(run);
  assert.deepEqual(summary.decisions.map(item => [item.question_id, item.by]), [['quick-choice', 'run']]);
  assert.deepEqual(summary.asking, ['asked-choice', 'noted-choice']);
});

test('dispatch: an approval-class question recommending nothing is held with no choice taken; the others recommending nothing stay to the node', t => {
  const run = started(t, QUESTIONS.engine, { driver: DISPATCH });
  const result = classing(QUESTIONS.engine, run, [], {
    questions: ['quick-choice', 'asked-choice', 'signed-choice'].map(id => ({ ...labelled(id), options: labelled(id).options.map(({ recommended: _r, ...option }) => option) })),
    reasons: { 'signed-choice': { rationale: 'Either layout ships.' } },
  });
  assert.equal(result.code, 0, result.stderr);
  // Settle and default take a recommendation, and there is none: the node's own rule keeps them open.
  assert.equal(askLine(result.stdout), 'ask: quick-choice asked-choice');
  const held = byId(summaryOf(run).decisions, 'signed-choice');
  assert.deepEqual(held, {
    decision: 'No choice yet — needs your decision', by: 'default', question_id: 'signed-choice', question: 'Which signed-choice?',
    no_choice: true, rationale: 'Either layout ships.', triage: { version: 1, class: 'approve', family: 'signed-family', held: true },
  });
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['scoping', 'signed-choice', 1]]);
});

// ---------------------------------------------------------------------------
// 5. the cockpit request from the remainder
// ---------------------------------------------------------------------------

test('cockpit with question sets: the request carries only what the writer left to ask', t => {
  const carried = { version: 1, class: 'consult', family: 'area-family' };
  const set = {
    questions: [question('quick-choice'), question('asked-choice', { triage: carried }), question('signed-choice')],
  };
  const run = started(t, QUESTIONS.engine, { driver: COCKPIT });
  const written = send(QUESTIONS.engine, run, { node_summaries: { scoping: { question_set: set } } });
  assert.equal(askLine(written.stdout), 'ask: asked-choice signed-choice');

  const result = brief(QUESTIONS.engine, run, set);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.deepEqual(request.questions.map(each => each.id), ['asked-choice', 'signed-choice']);
  assert.deepEqual(request.context.checkpoint.questions.map(each => each.id), ['asked-choice', 'signed-choice']);
  assert.deepEqual(request.context.checkpoint.questions[0].triage, carried, 'the checkpoint keeps the set\'s triage');
  assert.equal(Object.hasOwn(request, 'triage'), false, 'the request\'s top level gains none');
  for (const each of request.questions) assert.deepEqual(Object.keys(each), ['id', 'question', 'options', 'multi_select']);

  // An id the writer left to ask that the file's set no longer carries.
  const missing = brief(QUESTIONS.engine, run, { questions: [question('asked-choice')] });
  refused(missing, 'gate-brief-questions-invalid');
  assert.match(missing.stderr, /signed-choice/);

  // Every question settled: nothing is to be asked.
  const settled = started(t, QUESTIONS.engine, { driver: COCKPIT });
  assert.equal(askLine(classing(QUESTIONS.engine, settled, ['quick-choice', 'noted-choice']).stdout), 'ask: none');
  for (const form of ['--request', '--checkpoint']) {
    const nothing = brief(QUESTIONS.engine, settled, { questions: [question('quick-choice'), question('noted-choice')] }, form);
    refused(nothing, 'gate-brief-nothing-to-ask');
    assert.match(nothing.stderr, /^gate-brief-nothing-to-ask: the writer settled every question scoping sent it, so nothing is left to ask\. Nothing was written and nothing is asked\. /m);
    assert.equal(nothing.stdout, '');
  }
});

/**
 * A child run of a parent frozen under `parentDriver` (ceiling advice), the
 * child frozen with a bare cockpit driver and no ceiling of its own, `scoping`
 * running: the sub-run a cockpit-started run creates for itself.
 */
function startedChild(t, engine, parentDriver) {
  const parent = started(t, engine, { driver: parentDriver });
  const child = sibling(parent, { type: 'research', name: '2026-01-05-child' });
  const orchestrator = { driver: BARE_COCKPIT, parent: { run: parent.path, node: 'scoping' } };
  ok(engine, child, freezePatch({ definition: DEFINITION, orchestrator }).patch);
  ok(engine, child, { nodes: { scoping: { status: 'running' } } });
  return child;
}

test('a sub-run of a cockpit with question sets asks its consult questions, never defaults them', t => {
  const child = startedChild(t, QUESTIONS.engine, COCKPIT);
  const set = { questions: [question('quick-choice'), question('asked-choice')] };
  const written = send(QUESTIONS.engine, child, { node_summaries: { scoping: { question_set: set } } });
  assert.equal(written.code, 0, written.stderr);
  assert.equal(askLine(written.stdout), 'ask: asked-choice');
  assert.deepEqual(summaryOf(child).asking, ['asked-choice']);
  assert.equal(byId(summaryOf(child).decisions ?? [], 'asked-choice'), undefined, 'nothing is defaulted');

  const result = brief(QUESTIONS.engine, child, set);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).questions.map(each => each.id), ['asked-choice']);

  // Control: a parent without the feature gives a child that cannot ask.
  const bare = startedChild(t, QUESTIONS.engine, BARE_COCKPIT);
  const defaulted = classing(QUESTIONS.engine, bare, ['asked-choice']);
  assert.equal(askLine(defaulted.stdout), 'ask: none');
  assert.equal(byId(summaryOf(bare).decisions, 'asked-choice').triage.advice, 'not_obtained');
});

// ---------------------------------------------------------------------------
// 6. survival across later writes
// ---------------------------------------------------------------------------

test('writer-classed items survive later writes and the answer fold; a sent item cannot replace one; sent triage is dropped', t => {
  const run = started(t, QUESTIONS.engine);
  classing(QUESTIONS.engine, run, ['quick-choice', 'noted-choice', 'asked-choice']);
  const classed = summaryOf(run).decisions;
  assert.equal(classed.length, 2);

  // A later write that leaves them out keeps them, ahead of what it sent.
  const answer = { decision: 'Option B', by: 'operator', question_id: 'asked-choice', question: 'Which asked-choice?' };
  const later = ok(QUESTIONS.engine, run, { node_summaries: { scoping: { decisions: [answer] } } });
  assert.equal(later.stderr, '');
  const kept = summaryOf(run).decisions;
  assert.deepEqual(kept.slice(0, 2), classed);
  assert.equal(kept[2].question_id, 'asked-choice');

  // A sent run item for a classed question is dropped with a note.
  const replacing = ok(QUESTIONS.engine, run, {
    node_summaries: { scoping: { decisions: [...kept, { decision: 'Option B', by: 'run', question_id: 'quick-choice', question: 'Which quick-choice?' }] } },
  });
  assert.match(replacing.stderr, /^note: ignored the run decision node_summaries\.scoping sent for quick-choice; /m);
  assert.deepEqual(summaryOf(run).decisions, kept);

  // A closing write re-sending the whole list, triage and all, prints nothing and changes nothing.
  const resent = ok(QUESTIONS.engine, run, { nodes: { scoping: { status: 'completed', values: { wants_review: false, wants_notes: false } } }, node_summaries: { scoping: { decisions: kept } } });
  assert.equal(resent.stderr, '');
  assert.deepEqual(summaryOf(run).decisions, kept);

  // Triage the model puts on its own decision is dropped with a note; the item stays.
  const own = { decision: 'Own call', by: 'run', rationale: 'Plain reasons.', triage: { version: 1, class: 'decide-alone' } };
  const dropped = ok(QUESTIONS.engine, run, { node_summaries: { scoping: { decisions: [...kept, own] } } });
  assert.match(dropped.stderr, TRIAGE_NOTE);
  const after = summaryOf(run).decisions;
  assert.deepEqual(after.slice(0, 3), kept);
  assert.deepEqual(after[3], { decision: 'Own call', by: 'run', rationale: 'Plain reasons.' });

  // A set's carried triage survives the answer fold.
  {
    const carried = { version: 1, class: 'record', family: 'area-family' };
    const run = started(t, QUESTIONS.engine, { driver: COCKPIT });
    const set = { questions: [question('quick-choice', { triage: carried }), question('asked-choice')] };
    assert.equal(askLine(send(QUESTIONS.engine, run, { node_summaries: { scoping: { question_set: set } } }).stdout), 'ask: asked-choice');
    const classed = summaryOf(run).decisions;
    assert.deepEqual(classed[0].triage, carried, 'the carried class decides when it is the higher');

    // The request as it lands on disk, answered.
    fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
    fs.writeFileSync(path.join(run.dir, 'gates/scoping.request.yml'), [
      'version: 1', 'node: scoping', 'kind: question', 'question: "Which asked-choice?"', 'questions:',
      '  - id: asked-choice', '    question: "Which asked-choice?"', '    multi_select: false', '    options:',
      '      - {id: a, label: "Option A", effect: continue, recommended: true}',
      '      - {id: b, label: "Option B", effect: continue}', '',
    ].join('\n'));
    const answer = { option: 'b', answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' };
    const fold = ok(QUESTIONS.engine, run, { node_summaries: { scoping: { answer, decisions: classed } } });
    assert.equal(fold.stderr, '');
    const decisions = summaryOf(run).decisions;
    assert.deepEqual(decisions[0], classed[0]);
    assert.equal(byId(decisions, 'asked-choice').by, 'operator');
    assert.equal(byId(decisions, 'asked-choice').decision, 'Option B');
  }
});

// ---------------------------------------------------------------------------
// 7. the revise reset
// ---------------------------------------------------------------------------

test('a revise reset clears the reset nodes\' writer-classed items and their remainder; operator answers stay', t => {
  const run = started(t, QUESTIONS.engine, { definition: REVISE, node: 'draft', driver: DISPATCH });
  classing(QUESTIONS.engine, run, ['layout-choice'], { node: 'draft' });
  const answer = { decision: 'Short intro', by: 'operator', question_id: 'intro-length', question: 'How long is the intro?' };
  ok(QUESTIONS.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } } },
    node_summaries: { draft: { summary: 'Drafted.', decisions: [answer] } },
  });
  const before = summaryOf(run, 'draft');
  assert.equal(before.decisions.length, 2);
  assert.deepEqual(before.asking, []);
  ok(QUESTIONS.engine, run, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  ok(QUESTIONS.engine, run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } });

  const revised = runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(revised.code, 0, revised.stderr);
  const after = summaryOf(run, 'draft');
  assert.equal(Object.hasOwn(after, 'asking'), false);
  assert.deepEqual(after.decisions, [before.decisions.find(item => item.by === 'operator')]);
  assert.equal(after.summary, 'Drafted.');
});

// ---------------------------------------------------------------------------
// 8. the minimal default
// ---------------------------------------------------------------------------

test('the built-in default: nothing is classed or recorded, and ask: lists every id', t => {
  const run = started(t, null, { ceiling: null });
  const result = classing(null, run, ['quick-choice', 'signed-choice']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(askLine(result.stdout), 'ask: quick-choice signed-choice');
  const words = /\btriage\b|\basking\b|classes_questions|\bheld\b|\bclass\b/;
  // The repository's own path may carry any of these words; the run's record may not.
  const stateText = target => fs.readFileSync(target.state, 'utf8').replaceAll(ROOT, '<repo>');
  assert.doesNotMatch(stateText(run), words);

  const driven = started(t, null, { ceiling: null, driver: COCKPIT });
  assert.equal(askLine(classing(null, driven, ['quick-choice', 'signed-choice']).stdout), 'ask: quick-choice signed-choice');
  const file = path.join(driven.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [question('quick-choice'), question('signed-choice')] }));
  const request = verb(['gate-brief', `--state=${driven.state}`, '--node=scoping', '--request', `--patch-file=${file}`]);
  assert.equal(request.code, 0, request.stderr);
  assert.deepEqual(JSON.parse(request.stdout).questions.map(each => each.id), ['quick-choice', 'signed-choice']);
  assert.doesNotMatch(request.stdout.replaceAll(ROOT, '<repo>'), words);
  assert.doesNotMatch(stateText(driven), words);
});

test('the built-in default: a hand-written held item forces no checkpoint, and run-complete passes', t => {
  const run = started(t, null, { ceiling: null });
  const held = { decision: 'Option A', by: 'default', question_id: 'signed-choice', triage: { version: 1, class: 'approve', family: 'area-family', held: true } };
  ok(null, run, {
    nodes: { scoping: { status: 'completed', values: { wants_review: false, wants_notes: false } } },
    node_summaries: { scoping: { summary: 'Scoped the work.', decisions: [held] } },
  });
  assert.equal(readState(run).orchestrator.classes_questions, undefined);
  assert.deepEqual(outstandingHeld(readState(run)), []);
  const skipped = ok(null, run, { nodes: { 'review-approval': { status: 'skipped' }, 'depth-approval': { status: 'skipped' } } });
  assert.doesNotMatch(skipped.stderr, /held-gate-skipped/);
  ok(null, run, {
    task: { status: 'completed' },
    nodes: { drafting: { status: 'completed' }, notes: { status: 'skipped' }, 'notes-approval': { status: 'skipped' }, finish: { status: 'completed' } },
  });
  const closing = verb(['run-complete', `--state=${run.state}`]);
  assert.match(closing.stdout, /^RUN-COMPLETE$/m, closing.stderr);
  assert.doesNotMatch(closing.stdout, /RUN-FAILED/);
  refused(verb(['gate-brief', `--state=${run.state}`, '--node=held-approval']), 'gate-brief-nothing-held');
});

// ---------------------------------------------------------------------------
// 9. held choices on the brief, and the checkpoints they force
// ---------------------------------------------------------------------------

/** A question whose options carry the id in their labels, so no two questions' choices read alike. */
function labelled(id) {
  const each = question(id);
  each.options = each.options.map(option => ({ ...option, label: `${id} ${option.id.toUpperCase()}` }));
  return each;
}

/**
 * A dispatched run whose scoping settles quick-choice, defaults asked-choice
 * unadvised and holds signed-choice, then closes with `values`.
 */
function heldRun(t, { values = { wants_review: true, wants_notes: false }, hold = true, risks } = {}) {
  const run = started(t, QUESTIONS.engine, { driver: DISPATCH });
  const ids = ['quick-choice', 'asked-choice', ...(hold ? ['signed-choice'] : [])];
  const written = classing(QUESTIONS.engine, run, [], {
    questions: ids.map(labelled),
    ...(hold ? { reasons: { 'signed-choice': { rationale: 'The release notes want A.' } } } : {}),
  });
  assert.equal(written.code, 0, written.stderr);
  ok(QUESTIONS.engine, run, {
    nodes: { scoping: { status: 'completed', values } },
    node_summaries: { scoping: { summary: 'Scoped the work.', ...(risks ? { risks } : {}) } },
  });
  return run;
}

function gateBriefOf(run, node, ...flags) {
  return runScript(QUESTIONS.engine, ['gate-brief', `--state=${run.state}`, `--node=${node}`, ...flags]);
}

const HELD_ENTRY = {
  node: 'scoping', step: 'Scoping', question_id: 'signed-choice', question: 'Which signed-choice?', decision: 'signed-choice A',
  class: 'approve', rationale: 'The release notes want A.',
};

test('held: the next gate\'s checkpoint lists held choices after the fixes, classes the settlements, and counts no held choice as a default', t => {
  const run = heldRun(t);
  const result = gateBriefOf(run, 'review-approval', '--checkpoint');
  assert.equal(result.code, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  const keys = Object.keys(checkpoint);
  assert.equal(keys.indexOf('held'), keys.indexOf('fixes') + 1, keys.join(', '));
  assert.equal(keys.indexOf('decisions'), keys.indexOf('held') + 1);
  assert.deepEqual(checkpoint.held, [HELD_ENTRY]);
  assert.deepEqual(checkpoint.decisions.run, [
    { decision: 'quick-choice A', rationale: 'A is the safe pick.', class: 'decide-alone', question_id: 'quick-choice', node: 'scoping' },
  ]);
  assert.deepEqual(checkpoint.decisions.default, [{ decision: 'asked-choice A', class: 'consult', question_id: 'asked-choice', node: 'scoping' }]);

  // Nothing held: no `held` key at all.
  const none = JSON.parse(gateBriefOf(heldRun(t, { hold: false }), 'review-approval', '--checkpoint').stdout);
  assert.equal(Object.hasOwn(none, 'held'), false);
});

test('held: the plain and one-line briefs put the held choices first', t => {
  const run = heldRun(t, { risks: ['open: the layout may change'] });
  const plain = gateBriefOf(run, 'review-approval');
  assert.equal(plain.code, 0, plain.stderr);
  const lines = plain.stdout.split('\n');
  assert.equal(lines[0], 'Scoped the work.');
  assert.equal(lines[1], 'Held for your approval:');
  assert.equal(lines[2], '- Which signed-choice?: signed-choice A (approve) — scoping');
  assert.ok(lines.indexOf('Decisions:') > 2 && lines.indexOf('Risks:') > lines.indexOf('Decisions:'), plain.stdout);
  assert.ok(lines.includes('- quick-choice A (decide-alone)'), plain.stdout);
  assert.doesNotMatch(plain.stdout, /^- signed-choice A/m, 'a held choice is not listed again among the decisions');

  const oneline = gateBriefOf(run, 'review-approval', '--oneline');
  assert.equal(oneline.code, 0, oneline.stderr);
  assert.match(oneline.stdout, /^Scoped the work\. · Held: approve: signed-choice → signed-choice A — scoping · Risks: open: the layout may change · Decisions: run \(decide-alone\): quick-choice A — A is the safe pick\.; default \(consult\): asked-choice A · /);
});

test('held: run-complete owes a gate a task guard skipped while a choice is held, and offers no record-skipped recovery', t => {
  const run = heldRun(t, { values: { wants_review: false, wants_notes: false } });
  ok(QUESTIONS.engine, run, {
    task: { status: 'completed' },
    nodes: {
      'depth-approval': { status: 'skipped' },
      drafting: { status: 'completed' },
      notes: { status: 'skipped' },
      'notes-approval': { status: 'skipped' },
      finish: { status: 'completed' },
    },
  });
  const result = runScript(QUESTIONS.engine, ['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /not finished: review-approval \(pending; asked because held choices wait for approval\)\./);
  assert.doesNotMatch(result.stderr, /record skipped/);
  assert.doesNotMatch(result.stderr, /depth-approval/, 'a gate guarded by an input is never forced');
});

test('held: a revise names a task-guarded gate when the node holding the choice is outside the stretch', () => {
  const { graph } = freezePatch({ definition: DEFINITION });
  const recorded = {
    scoping: { kind: 'task', status: 'completed', values: { wants_review: false, wants_notes: false } },
    'review-approval': { kind: 'gate', status: 'skipped' },
    'depth-approval': { kind: 'gate', status: 'skipped' },
    drafting: { kind: 'task', status: 'completed' },
  };
  const guards = held => ({
    byId: new Map(graph.nodes.map(entry => [entry.id, entry])),
    recorded,
    status: new Map(Object.entries(recorded).map(([id, entry]) => [id, entry.status])),
    inputs: {},
    defaults: {},
    held,
  });
  const stretch = ['review-approval', 'depth-approval', 'drafting'];
  assert.equal(skippedAgain('review-approval', stretch, guards(false)), true, 'nothing held: its false guard skips it again');
  assert.equal(skippedAgain('review-approval', stretch, guards(true)), false, 'a held choice outside the stretch asks it');
  assert.equal(skippedAgain('depth-approval', stretch, guards(true)), true, 'a gate guarded by an input is never forced');
});

test('held: recording a task-guarded gate skipped while a choice is held warns held-gate-skipped and writes as sent', t => {
  const run = heldRun(t, { values: { wants_review: false, wants_notes: false } });
  const skipped = ok(QUESTIONS.engine, run, { nodes: { 'review-approval': { status: 'skipped' } } });
  assert.match(skipped.stderr, /^warning: held-gate-skipped:review-approval — .+/m);
  assert.equal(readState(run).workflow.nodes['review-approval'].status, 'skipped');

  const input = ok(QUESTIONS.engine, run, { nodes: { 'depth-approval': { status: 'skipped' } } });
  assert.doesNotMatch(input.stderr, /held-gate-skipped/);

  const free = heldRun(t, { values: { wants_review: false, wants_notes: false }, hold: false });
  const quiet = ok(QUESTIONS.engine, free, { nodes: { 'review-approval': { status: 'skipped' } } });
  assert.doesNotMatch(quiet.stderr, /held-gate-skipped/);
});

test('held: a forced gate whose work was skipped is briefed "Skipped." with the held list; without one it still wants a summary', t => {
  const reach = (hold) => {
    const run = started(t, QUESTIONS.engine, { driver: DISPATCH });
    ok(QUESTIONS.engine, run, {
      nodes: {
        scoping: { status: 'completed', values: { wants_review: false, wants_notes: false } },
        'review-approval': { status: 'skipped' },
        'depth-approval': { status: 'skipped' },
        drafting: { status: 'running' },
      },
    });
    // An approve triage the question carries holds it under a dispatch driver.
    const asked = { ...labelled('signed-choice'), ...(hold ? { triage: { version: 1, class: 'approve', family: 'area-family' } } : {}) };
    assert.equal(classing(QUESTIONS.engine, run, [], { node: 'drafting', questions: [asked] }).code, 0);
    ok(QUESTIONS.engine, run, {
      nodes: { drafting: { status: 'completed' }, notes: { status: 'skipped' } },
    });
    return run;
  };

  const run = reach(true);
  const result = gateBriefOf(run, 'notes-approval', '--checkpoint');
  assert.equal(result.code, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.headline, 'Skipped.');
  assert.deepEqual(checkpoint.held.map(each => [each.node, each.question_id]), [['drafting', 'signed-choice']]);
  const plain = gateBriefOf(run, 'notes-approval');
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /^Skipped\.\nHeld for your approval:\n- Which signed-choice\?: signed-choice A \(approve\) — drafting\n/);
  // The step holding it is named on every surface, though the gate closes another stretch.
  assert.deepEqual(checkpoint.held.map(each => each.step), ['Drafting']);
  assert.match(gateBriefOf(run, 'notes-approval', '--oneline').stdout, / · Held: approve: signed-choice → signed-choice A — drafting · /);
  const picked = JSON.parse(gateBriefOf(run, 'notes-approval', '--json', '--picker=rich').stdout);
  assert.match(picked.options[0].preview, /^- Which signed-choice\?: signed-choice A — drafting$/m);
  assert.match(picked.more_details, /^- Which signed-choice\?: signed-choice A \(approve\) — drafting$/m);
  const listed = JSON.parse(gateBriefOf(run, 'notes-approval', '--json', '--picker=plain').stdout);
  assert.match(listed.question, /^- Which signed-choice\?: signed-choice A — drafting$/m);

  const bare = gateBriefOf(reach(false), 'notes-approval', '--checkpoint');
  refused(bare, 'gate-brief-no-summary');
});

test('prior-context: the asking remainder is never printed; an unapproved held choice is marked awaiting approval', t => {
  const asked = started(t, QUESTIONS.engine);
  assert.equal(askLine(classing(QUESTIONS.engine, asked, ['quick-choice', 'asked-choice']).stdout), 'ask: asked-choice');
  const plain = runScript(QUESTIONS.engine, ['prior-context', `--state=${asked.state}`]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /^### scoping$/m);
  assert.doesNotMatch(plain.stdout, /asking|Asking/);
  assert.doesNotMatch(plain.stdout, /awaiting approval/);

  const run = heldRun(t);
  const text = runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]).stdout;
  assert.match(text, /^- decision: signed-choice A — by: default — question_id: signed-choice — .* \(held — awaiting approval\)$/m);
  assert.match(text, /^- decision: quick-choice A — by: run — .*[^)]$/m, 'a settled choice carries no note');
  assert.equal(text.match(/awaiting approval/g).length, 1);

  // Approved by a continue: the note goes.
  answerGate(run, 'review-approval', 'continue-past-review');
  assert.doesNotMatch(runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]).stdout, /awaiting approval/);
});

test('prior-context: a question held with no choice is marked so, and its no_choice mark is not printed', t => {
  const run = started(t, QUESTIONS.engine, { driver: DISPATCH });
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { questions: [{ ...unrecommended('signed-choice') }] }).stdout), 'ask: none');
  const text = runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]).stdout;
  assert.match(text, /^- decision: No choice yet — needs your decision — by: default — .* \(held — no choice yet\)$/m);
  assert.doesNotMatch(text, /no_choice/);
});

/** A question no option of which is recommended, its options labelled by its id. */
function unrecommended(id) {
  const each = labelled(id);
  return { ...each, options: each.options.map(({ recommended: _r, ...option }) => option) };
}

// ---------------------------------------------------------------------------
// 10. approvals: a continue at a checkpoint approves each held choice
// ---------------------------------------------------------------------------

const ANSWER_KEYS = ['answered_by', 'via', 'actor', 'on_behalf_of'];
const keyed = list => list.map(each => [each.node, each.question_id, each.attempt]);
const decisionsAt = (run, node) => readState(run).node_summaries?.[node]?.decisions ?? [];

/** The approval item a continue owes `held` (a held item on `node`), credited as `answer` is. */
function approvalFor(node, held, answer) {
  const { held: _held, ...triage } = held.triage;
  const item = { decision: `${held.question_id}: ${held.decision}`, by: 'operator', node, question_id: held.question_id, triage };
  if (held.attempt !== undefined) item.attempt = held.attempt;
  for (const key of ANSWER_KEYS) if (answer[key] !== undefined) item[key] = answer[key];
  return item;
}

/** A gate answered in a write of its own, as a terminal session records it. */
function answerGate(run, gate, option, extra = {}) {
  return ok(QUESTIONS.engine, run, {
    nodes: { [gate]: { status: 'completed' } },
    node_summaries: { [gate]: { decisions: [{ option, ...extra }] } },
  });
}

/** The request a driver writes for `gate`, unanswered, as its first line set. */
function requestHead(gate) {
  return ['version: 1', `node: ${gate}`, 'kind: approval', 'question: "Continue?"', 'multiple: false', 'asked_at: "2026-01-05T09:00:00Z"'].join('\n');
}

/** A driver suspending on `gate`: its request on disk, a pending index row, the pending marker and the gate suspended. */
function suspendAt(run, gate) {
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  fs.writeFileSync(path.join(gates, `${gate}.request.yml`), `${requestHead(gate)}\nanswer: null\n`);
  refreshIndex(run.dir);
  ok(QUESTIONS.engine, run, {
    orchestrator: { gate_pending: { node: gate, request: `gates/${gate}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [gate]: { status: 'suspended' } },
  });
}

/** The answer to a suspended `gate` arriving on disk, and the model folding it into the state by hand. */
function foldAt(run, gate, option) {
  fs.writeFileSync(path.join(run.dir, 'gates', `${gate}.request.yml`),
    `${requestHead(gate)}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n  on_behalf_of: lee\n`);
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${gate}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  assert.match(text, /^node_summaries:\n(?: {2}.*\n|\s*\n)*$/m, 'node_summaries is the last block');
  fs.writeFileSync(run.state, `${text}  ${gate}:\n    decisions:\n      - {option: ${option}, answered_by: dana, at: "2026-01-05T09:05:00Z", via: cockpit}\n    status: completed\n`);
}

/**
 * A driven answer to `gate` as the cockpit leaves it: a request answered on
 * disk, a pending index row, and the answer the model folded into the state by
 * hand. The next write's index sync closes the row.
 */
function drivenAnswer(run, gate, option) {
  suspendAt(run, gate);
  foldAt(run, gate, option);
}

/**
 * An answer a driver carried: `gate`'s request answered on disk with `option`,
 * and the answer recorded through write-state, as a model folds it.
 */
function carried(run, gate, option, extra = {}) {
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  fs.writeFileSync(path.join(gates, `${gate}.request.yml`),
    `${requestHead(gate)}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n`);
  return ok(QUESTIONS.engine, run, { node_summaries: { [gate]: { answer: option, ...extra } } });
}

test('approvals: a continue at a forced gate records one approval per held choice, right after the answer', t => {
  const run = heldRun(t);
  const held = byId(summaryOf(run).decisions, 'signed-choice');
  assert.equal(held.triage.held, true);
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['scoping', 'signed-choice', 1]]);

  answerGate(run, 'review-approval', 'continue-past-review', { on_behalf_of: 'lee' });
  const [answer, approval, ...rest] = decisionsAt(run, 'review-approval');
  assert.deepEqual(rest, []);
  assert.equal(answer.option, 'continue-past-review');
  assert.equal(answer.on_behalf_of, 'lee');
  assert.deepEqual(approval, approvalFor('scoping', held, answer));
  assert.deepEqual(Object.keys(approval).slice(0, 5), ['decision', 'by', 'node', 'question_id', 'triage']);
  assert.equal(approval.decision, 'signed-choice: signed-choice A');
  assert.equal(Object.hasOwn(approval.triage, 'held'), false);

  // The held item stays held, as history; nothing is outstanding.
  assert.deepEqual(byId(summaryOf(run).decisions, 'signed-choice'), held);
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['scoping', 'signed-choice', 1]]);

  // A closing write re-sending the answer leaves one approval, never two.
  answerGate(run, 'review-approval', 'continue-past-review', { on_behalf_of: 'lee' });
  assert.equal(decisionsAt(run, 'review-approval').length, 2);
});

test('approvals: re-sending an earlier gate\'s continue after a later hold approves nothing; held-approval and run-complete still owe it', t => {
  const run = heldRun(t, { hold: false });
  answerGate(run, 'review-approval', 'continue-past-review', { answered_by: 'tester' });
  assert.deepEqual(approvalsOf(readState(run)), []);
  ok(QUESTIONS.engine, run, { nodes: { 'depth-approval': { status: 'skipped' }, drafting: { status: 'running' } } });
  const asked = { ...labelled('signed-choice'), triage: { version: 1, class: 'approve', family: 'area-family' } };
  assert.equal(classing(QUESTIONS.engine, run, [], { node: 'drafting', questions: [asked] }).code, 0);
  ok(QUESTIONS.engine, run, { nodes: { drafting: { status: 'completed' } }, node_summaries: { drafting: { summary: 'Drafted.' } } });
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['drafting', 'signed-choice', 1]]);

  // The earlier gate's answer, re-sent: recorded once already, it approves nothing held since.
  const before = decisionsAt(run, 'review-approval');
  ok(QUESTIONS.engine, run, { node_summaries: { 'review-approval': { decisions: [{ option: 'continue-past-review' }] } } });
  assert.deepEqual(approvalsOf(readState(run)), []);
  assert.deepEqual(decisionsAt(run, 'review-approval').filter(item => item.node === 'drafting'), []);
  assert.equal(decisionsAt(run, 'review-approval').length, before.length);
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['drafting', 'signed-choice', 1]]);

  // So the run still owes a checkpoint for it, and run-complete refuses while it is unasked.
  ok(QUESTIONS.engine, run, { task: { status: 'completed' }, nodes: { notes: { status: 'skipped' }, finish: { status: 'completed' } } });
  const closing = runScript(QUESTIONS.engine, ['run-complete', `--state=${run.state}`]);
  assert.equal(closing.stdout, 'RUN-FAILED: run-nodes-unfinished\n', closing.stderr);
  assert.match(closing.stderr, /notes-approval \(pending; asked because held choices wait for approval\)/);
});

test('approvals: the driven fold that closes the gate\'s index row approves the same way, once', t => {
  const run = heldRun(t);
  const held = byId(summaryOf(run).decisions, 'signed-choice');
  drivenAnswer(run, 'review-approval', 'continue-past-review');
  const result = ok(QUESTIONS.engine, run, {});
  assert.match(result.stdout, /^gates\/index\.yml$/m);
  const [answer, approval, ...rest] = decisionsAt(run, 'review-approval');
  assert.deepEqual(rest, []);
  assert.equal(answer.on_behalf_of, 'lee', 'the request file\'s provenance is copied first');
  assert.deepEqual(approval, approvalFor('scoping', held, answer));
  assert.equal(approval.answered_by, 'dana');
  assert.equal(approval.via, 'cockpit');
  assert.equal(approval.on_behalf_of, 'lee');

  // A later empty write judges nothing and adds nothing.
  const again = ok(QUESTIONS.engine, run, {});
  assert.doesNotMatch(again.stdout, /node_summaries/);
  assert.equal(decisionsAt(run, 'review-approval').length, 2);
});

/** The review loop under dispatch with a choice held in `side-note`, which a send-back leaves alone. */
function heldBeside(t) {
  const run = started(t, QUESTIONS.engine, { definition: REVISE, node: 'draft', driver: DISPATCH });
  ok(QUESTIONS.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } }, figures: { status: 'skipped' }, 'side-note': { status: 'running' } },
    node_summaries: { draft: { summary: 'Drafted.' } },
  });
  const asked = { ...labelled('margin-choice'), triage: { version: 1, class: 'approve', family: 'area-family' } };
  assert.equal(classing(QUESTIONS.engine, run, [], { node: 'side-note', questions: [asked] }).code, 0);
  ok(QUESTIONS.engine, run, {
    nodes: { 'side-note': { status: 'completed' }, review: { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed.' } },
  });
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['side-note', 'margin-choice', 1]]);
  return run;
}

test('approvals: a stop or a revise approves nothing', t => {
  const stopped = heldBeside(t);
  answerGate(stopped, 'review-approval', 'abandon');
  assert.deepEqual(decisionsAt(stopped, 'review-approval').map(item => item.option ?? item.decision), ['abandon']);
  assert.deepEqual(approvalsOf(readState(stopped)), []);
  assert.equal(outstandingHeld(readState(stopped)).length, 1);

  const revised = heldBeside(t);
  const sent = runScript(QUESTIONS.engine, ['gate-revise', `--state=${revised.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual(approvalsOf(readState(revised)), []);
  assert.deepEqual(keyed(outstandingHeld(readState(revised))), [['side-note', 'margin-choice', 1]]);

  // The continue approves it.
  const continued = heldBeside(t);
  answerGate(continued, 'review-approval', 'publish-draft');
  assert.deepEqual(keyed(approvalsOf(readState(continued))), [['side-note', 'margin-choice', 1]]);
  assert.deepEqual(outstandingHeld(readState(continued)), []);
});

test('approvals: matched by attempt; a choice held again in a later attempt waits, and later writes keep every approval', t => {
  const run = started(t, QUESTIONS.engine, { definition: REVISE, node: 'draft', driver: DISPATCH });
  const asked = { ...labelled('layout-choice'), triage: { version: 1, class: 'approve', family: 'area-family' } };
  const reachReview = () => {
    assert.equal(classing(QUESTIONS.engine, run, [], { node: 'draft', questions: [asked] }).code, 0);
    ok(QUESTIONS.engine, run, {
      nodes: { draft: { status: 'completed', values: { needs_figures: false } }, figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } },
      node_summaries: { draft: { summary: 'Drafted.' }, review: { summary: 'Reviewed.' } },
    });
  };
  reachReview();
  answerGate(run, 'review-approval', 'publish-draft');
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['draft', 'layout-choice', 1]]);
  const first = decisionsAt(run, 'review-approval').filter(item => item.node === 'draft');

  // Send the draft back from the last gate: the draft runs again and holds the choice in attempt 2.
  ok(QUESTIONS.engine, run, { nodes: { publish: { status: 'completed' } }, node_summaries: { publish: { summary: 'Published.' } } });
  const sent = runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=final-approval', '--option=redo-draft'], { note: 'Redo it' });
  assert.equal(sent.code, 0, sent.stderr);
  ok(QUESTIONS.engine, run, { nodes: { draft: { status: 'running' } } });
  reachReview();
  const again = byId(summaryOf(run, 'draft').decisions, 'layout-choice');
  assert.equal(again.attempt, 2);
  assert.equal(again.triage.held, true);
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['draft', 'layout-choice', 2]], 'an approval for attempt 1 does not approve attempt 2');
  for (const item of first) assert.ok(decisionsAt(run, 'review-approval').some(each => JSON.stringify(each) === JSON.stringify(item)), 'the first approval stays');

  // The gate asked again approves attempt 2; the attempt 1 approval stays beside it.
  answerGate(run, 'review-approval', 'publish-draft');
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['draft', 'layout-choice', 1], ['draft', 'layout-choice', 2]]);
  const second = decisionsAt(run, 'review-approval').find(item => item.node === 'draft' && item.attempt === 2);
  assert.deepEqual(second, approvalFor('draft', again, decisionsAt(run, 'review-approval').findLast(item => typeof item.option === 'string')));
  assert.deepEqual(outstandingHeld(readState(run)), []);

  // A write that re-sends the gate's summary without its approvals keeps them all.
  ok(QUESTIONS.engine, run, { node_summaries: { 'review-approval': { summary: 'Approved.', decisions: [{ option: 'publish-draft' }] } } });
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['draft', 'layout-choice', 1], ['draft', 'layout-choice', 2]]);
  assert.equal(byId(summaryOf(run, 'draft').decisions, 'layout-choice').triage.held, true);
});

// ---------------------------------------------------------------------------
// 11. held-approval: the checkpoint a run raises before it closes with choices held
// ---------------------------------------------------------------------------

const HELD_CLOSING = path.join(FIXTURES, 'definitions/held-closing.yml');
const APPROVE_TRIAGE = { version: 1, class: 'approve', family: 'area-family' };
const HELD_APPROVAL_ID = 'held-approval';

/**
 * Hold one choice in the running `node`: a question carrying an approve triage,
 * which nobody can be asked under dispatch. `open` recommends nothing, so it is
 * held with no choice.
 */
function holdIn(run, node, { open = false } = {}) {
  const asked = open ? unrecommended(`${node}-choice`) : labelled(`${node}-choice`);
  const written = classing(QUESTIONS.engine, run, [], { node, questions: [{ ...asked, triage: APPROVE_TRIAGE }] });
  assert.equal(written.code, 0, written.stderr);
  assert.equal(askLine(written.stdout), 'ask: none');
}

/**
 * `held-closing` driven by `driver`, past its one frozen gate and up to `upTo`
 * running (`tidy` or `closing`), with a choice held in each of `owners`.
 * `choosing` records no audit, so the sub-run is skipped — unless `audit` is
 * `completed`, when the sub-run ran. `upTo: 'audit'` stops with `choosing`
 * completed and the sub-run ready to start; `open` holds `choosing`'s question
 * with no choice.
 */
function heldClosing(t, { owners = ['choosing'], driver = DISPATCH, upTo = 'closing', audit = 'skipped', open = false } = {}) {
  const run = started(t, QUESTIONS.engine, { definition: HELD_CLOSING, node: 'outline', driver });
  ok(QUESTIONS.engine, run, { nodes: { outline: { status: 'completed' } }, node_summaries: { outline: { summary: 'Outlined the work.' } } });
  answerGate(run, 'outline-approval', 'continue-past-outline');
  ok(QUESTIONS.engine, run, { nodes: { choosing: { status: 'running' } } });
  if (owners.includes('choosing')) holdIn(run, 'choosing', { open });
  const audited = audit !== 'skipped';
  ok(QUESTIONS.engine, run, {
    nodes: { choosing: { status: 'completed', values: { wants_audit: audited } }, ...(audited ? {} : { audit: { status: 'skipped' } }) },
    node_summaries: { choosing: { summary: audited ? 'Chose to finish with an audit.' : 'Chose to finish without an audit.' } },
  });
  if (upTo === 'audit') return run;
  if (audited) {
    ok(QUESTIONS.engine, run, { nodes: { audit: { status: 'running' } } });
    ok(QUESTIONS.engine, run, { nodes: { audit: { status: 'completed' } }, node_summaries: { audit: { summary: 'Audited the outline.' } } });
  }
  ok(QUESTIONS.engine, run, { nodes: { tidy: { status: 'running' } } });
  if (owners.includes('tidy')) holdIn(run, 'tidy');
  if (upTo === 'tidy') return run;
  ok(QUESTIONS.engine, run, {
    nodes: { tidy: { status: 'completed' }, closing: { status: 'running' } },
    node_summaries: { tidy: { summary: 'Tidied what the run touched.' } },
  });
  if (owners.includes('closing')) holdIn(run, 'closing');
  return run;
}

function heldBrief(run, ...flags) {
  return gateBriefOf(run, HELD_APPROVAL_ID, ...flags);
}

/** run-complete through the scratch engine, with any extra flags. */
function completeRun(run, ...flags) {
  return runScript(QUESTIONS.engine, ['run-complete', `--state=${run.state}`, ...flags]);
}

/** Publish a close-out for dispatch d-1 in the run's scratch outbox; returns the run-complete flags that find it. */
function publishCloseout(run, grade = 'success') {
  const outbox = path.join(run.root, 'outbox');
  const published = umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-1', '--type=closeout'], { grade, summary: 'closed' });
  assert.equal(published.code, 0, published.stderr);
  return [`--outbox=${outbox}`, '--dispatch-id=d-1'];
}

/** The closing patch: the closing node completed and the run with it. */
function closeRun(run) {
  ok(QUESTIONS.engine, run, {
    task: { status: 'completed' },
    nodes: { closing: { status: 'completed' } },
    node_summaries: { closing: { summary: 'Wrote the summary.' } },
  });
}

test('held-approval: with nothing held it is refused gate-brief-nothing-held, in every form', t => {
  const run = heldClosing(t, { owners: [] });
  for (const flags of [[], ['--oneline'], ['--checkpoint'], ['--request'], ['--json']]) {
    const result = heldBrief(run, ...flags);
    assert.equal(result.code, 1, `${flags.join(' ')}: ${result.stdout}`);
    assert.match(result.stderr, /^gate-brief-nothing-held: Nothing is held for approval\. Nothing was written\./m);
  }
});

test('held-approval: refused gate-brief-not-askable while another node is owed; askable while only the running closing node is', t => {
  const early = heldClosing(t, { upTo: 'tidy' });
  const refusedEarly = heldBrief(early);
  refused(refusedEarly, 'gate-brief-not-askable');
  assert.match(refusedEarly.stderr, /\btidy\b/);
  assert.match(refusedEarly.stderr, /\bclosing\b/);

  const ready = heldClosing(t);
  const asked = heldBrief(ready);
  assert.equal(asked.code, 0, asked.stderr);
});

test('held-approval: every form carries the held list, the stretch, the end of the run and its own progress; the rich picker names the revises it cannot list', t => {
  const run = heldClosing(t, { owners: ['choosing', 'tidy', 'closing'] });
  const result = heldBrief(run, '--checkpoint');
  assert.equal(result.code, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.kind, 'gate');
  assert.equal(checkpoint.node, HELD_APPROVAL_ID);
  assert.equal(checkpoint.header, 'Held for approval');
  assert.equal(checkpoint.ask, 'Approve the choices held for you, and finish the run?');
  assert.deepEqual(checkpoint.held.map(each => [each.node, each.question_id, each.decision]), [
    ['choosing', 'choosing-choice', 'choosing-choice A'],
    ['tidy', 'tidy-choice', 'tidy-choice A'],
    ['closing', 'closing-choice', 'closing-choice A'],
  ]);
  assert.deepEqual(checkpoint.closed.map(each => each.node), ['choosing', 'audit', 'tidy']);
  assert.equal(checkpoint.next.node, null);
  assert.equal(checkpoint.next.end, true);
  assert.deepEqual(checkpoint.progress, { checkpoint: 2, checkpoints_max: 2, node: 6, nodes_total: 6 });
  assert.deepEqual(checkpoint.grants, {});
  assert.deepEqual(checkpoint.approves, []);
  assert.deepEqual(checkpoint.options.map(each => [each.id, each.effect]), [
    ['continue', 'continue'], ['revise-choosing', 'revise'], ['revise-tidy', 'revise'], ['revise-closing', 'revise'], ['stop', 'stop'],
  ]);
  assert.equal(checkpoint.recommended.option, 'continue');
  assert.equal(checkpoint.options[0].label, 'Approve and finish');
  assert.deepEqual(checkpoint.options[1].reruns.map(each => each.node), ['choosing', 'audit', 'tidy', 'closing'], 'a revise re-runs its node and everything whose needs reach it');
  assert.deepEqual(checkpoint.options[2].reruns.map(each => each.node), ['tidy', 'closing']);

  // Its progress is the same with its own status entry recorded.
  ok(QUESTIONS.engine, run, { nodes: { [HELD_APPROVAL_ID]: { status: 'pending' } } });
  assert.deepEqual(JSON.parse(heldBrief(run, '--checkpoint').stdout).progress, checkpoint.progress);

  const plain = heldBrief(run);
  assert.equal(plain.code, 0, plain.stderr);
  const lines = plain.stdout.split('\n');
  assert.ok(lines.indexOf('Held for your approval:') > 0, plain.stdout);
  assert.ok(lines.includes('- Which choosing-choice?: choosing-choice A (approve) — choosing'), plain.stdout);
  assert.deepEqual(checkpoint.held.map(each => each.step), ['Choosing', 'Tidy', 'Closing']);
  assert.match(plain.stdout, /^Next: end of run$/m);

  const oneline = heldBrief(run, '--oneline');
  assert.equal(oneline.code, 0, oneline.stderr);
  assert.match(oneline.stdout, / · Held: approve: choosing-choice → choosing-choice A — choosing; approve: tidy-choice → tidy-choice A — tidy; approve: closing-choice → closing-choice A — closing · /);
  assert.match(oneline.stdout, / · Next: end of run · .*Recommended: continue · Run: /);

  const request = JSON.parse(heldBrief(run, '--request').stdout);
  assert.equal(request.node, HELD_APPROVAL_ID);
  assert.equal(request.question, 'Approve the choices held for you, and finish the run?');
  assert.deepEqual(request.options.map(each => each.id), ['continue', 'revise-choosing', 'revise-tidy', 'revise-closing', 'stop']);
  assert.equal(request.context.checkpoint.held.length, 3);

  const rich = JSON.parse(heldBrief(run, '--json', '--picker=rich').stdout);
  assert.deepEqual(rich.options.map(each => each.id), ['continue', 'revise-tidy', 'revise-closing', 'stop'], 'continue, the revises nearest the end, and stop');
  assert.match(rich.question, /revise-choosing/);
  assert.ok([...rich.header].length <= 12, rich.header);

  const plainPicker = JSON.parse(heldBrief(run, '--json', '--picker=plain').stdout);
  assert.deepEqual(plainPicker.options.map(each => each.id), ['continue', 'revise-choosing', 'revise-tidy', 'revise-closing', 'stop', 'more-details']);
});

test('held-approval: past the safety limit it offers only continue and stop, and a revise answer is refused', t => {
  const run = heldClosing(t);
  const history = Array.from({ length: 10 }, (_, index) => ({ option: 'revise-choosing', note: `Try again ${index + 1}`, attempt: index + 1 }));
  ok(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { decisions: history } } });
  const checkpoint = JSON.parse(heldBrief(run, '--checkpoint').stdout);
  assert.deepEqual(checkpoint.options.map(each => each.id), ['continue', 'stop']);
  assert.match(heldBrief(run).stdout, /^Next: end of run \(no revises are left at this checkpoint\)$/m);
  assert.doesNotMatch(heldBrief(run, '--oneline').stdout, /revise:/);
  const answer = send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'revise-choosing' } } });
  refused(answer, 'state-gate-option-unknown');
  assert.match(answer.stderr, /it offers continue, stop/);
});

test('held-approval: the writer records its status alone, and every reader of the frozen graph reads past it', t => {
  const run = heldClosing(t);
  for (const status of ['pending', 'suspended', 'completed']) {
    ok(QUESTIONS.engine, run, { nodes: { [HELD_APPROVAL_ID]: { status } } });
    const entry = readState(run).workflow.nodes[HELD_APPROVAL_ID];
    assert.equal(entry.kind, 'gate');
    assert.equal(entry.status, status);
  }
  assert.match(fs.readFileSync(run.state, 'utf8'), /^ {4}closing: .*\n {4}held-approval: \{kind: gate, status: completed, completed: "[^"]+"\}$/m, 'recorded after the frozen nodes, stamped like a gate');

  for (const patch of [{ status: 'running' }, { status: 'pending', values: { x: true } }, { kind: 'task' }]) {
    const result = send(QUESTIONS.engine, run, { nodes: { [HELD_APPROVAL_ID]: patch } });
    refused(result, 'state-patch-invalid');
    assert.match(result.stderr, /pending, suspended or completed/);
  }
  refused(send(QUESTIONS.engine, run, { nodes: { 'held-approvals': { status: 'pending' } } }), 'state-node-unknown');

  // A run carrying the entry reads the same as one without it.
  const bare = heldClosing(t);
  const marked = heldClosing(t);
  ok(QUESTIONS.engine, marked, { nodes: { [HELD_APPROVAL_ID]: { status: 'pending' } } });
  const owedOf = each => atClose({ doc: readState(each), runDir: each.dir }).owed;
  assert.deepEqual(owedOf(marked), owedOf(bare));
  assert.deepEqual(checkpointOf(readState(marked), {}), checkpointOf(readState(bare), {}));
  assert.ok(provenGraph(readState(marked).workflow, marked.dir).graph, 'the graph still proves');
  const progressOf = each => JSON.parse(gateBriefOf(each, 'outline-approval', '--checkpoint').stdout).progress;
  assert.deepEqual(progressOf(marked), progressOf(bare));
  // The dashboard draws a card per frozen node, never one for the reserved entry.
  const cardsOf = each => readDashboard(each).phases.map(phase => phase.id);
  assert.equal(cardsOf(marked).includes(HELD_APPROVAL_ID), false);
  assert.deepEqual(cardsOf(marked), cardsOf(bare));
  // A re-sent freeze that lacks the entry drops nothing.
  const fresh = scratch(t);
  const { patch: frozen } = freezePatch({ definition: HELD_CLOSING, orchestrator: { options: { ceiling: 'advice' }, driver: DISPATCH } });
  ok(QUESTIONS.engine, fresh, frozen);
  ok(QUESTIONS.engine, fresh, { nodes: { [HELD_APPROVAL_ID]: { status: 'pending' } } });
  ok(QUESTIONS.engine, fresh, { workflow: frozen.workflow });
  for (const each of [bare, marked]) closeRun(each);
  assert.deepEqual(completeRun(marked).stdout, completeRun(bare).stdout);

  // A question set's progress, under a cockpit that carries sets.
  const asking = [];
  for (const entry of [false, true]) {
    const each = started(t, QUESTIONS.engine, { definition: HELD_CLOSING, node: 'outline', driver: COCKPIT });
    if (entry) ok(QUESTIONS.engine, each, { nodes: { [HELD_APPROVAL_ID]: { status: 'pending' } } });
    const result = brief(QUESTIONS.engine, each, { questions: [question('asked-choice')] }, '--checkpoint', 'outline');
    assert.equal(result.code, 0, result.stderr);
    asking.push(JSON.parse(result.stdout).progress);
  }
  assert.deepEqual(asking[1], asking[0]);
});

test('held-approval: its answer is folded, held to its options, stamped and judged — through write-state with no node entry, driven with one', t => {
  const run = heldClosing(t);
  const held = byId(summaryOf(run, 'choosing').decisions, 'choosing-choice');
  refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'revise-outline' } } }), 'state-gate-option-unknown');
  refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'more-details' } } }), 'state-gate-option-unknown');

  carried(run, HELD_APPROVAL_ID, 'continue', { on_behalf_of: 'lee' });
  assert.equal(Object.hasOwn(readState(run).workflow.nodes, HELD_APPROVAL_ID), false, 'an answer in session needs no node entry');
  const [answer, approval, ...rest] = decisionsAt(run, HELD_APPROVAL_ID);
  assert.deepEqual(rest, []);
  assert.equal(answer.option, 'continue');
  assert.equal(answer.decision, 'Approve and finish');
  assert.equal(answer.by, 'operator');
  assert.equal(typeof answer.answered_by, 'string');
  assert.equal(answer.via, 'dispatch');
  assert.equal(answer.on_behalf_of, 'lee');
  assert.deepEqual(approval, approvalFor('choosing', held, answer));
  assert.deepEqual(outstandingHeld(readState(run)), []);
  refused(heldBrief(run), 'gate-brief-nothing-held');

  // Driven: suspended through the status exception, answered on disk, judged by the write that closes its index row.
  const driven = heldClosing(t);
  drivenAnswer(driven, HELD_APPROVAL_ID, 'continue');
  ok(QUESTIONS.engine, driven, {});
  assert.equal(readState(driven).workflow.nodes[HELD_APPROVAL_ID].status, 'completed');
  const [given, approved, ...more] = decisionsAt(driven, HELD_APPROVAL_ID);
  assert.deepEqual(more, []);
  assert.equal(given.option, 'continue');
  assert.equal(approved.answered_by, 'dana');
  assert.equal(approved.on_behalf_of, 'lee');
  assert.deepEqual(outstandingHeld(readState(driven)), []);

  // A stop approves nothing.
  const stopped = heldClosing(t);
  ok(QUESTIONS.engine, stopped, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'stop' } } });
  assert.equal(outstandingHeld(readState(stopped)).length, 1);
});

test('held-approval: with a question held with no choice it offers no continue — its step\'s revise, recommended, asks for the choice', t => {
  const run = heldClosing(t, { owners: [] });
  const open = { ...unrecommended('closing-choice'), triage: APPROVE_TRIAGE };
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'closing', questions: [open] }).stdout), 'ask: none');
  const checkpoint = JSON.parse(heldBrief(run, '--checkpoint').stdout);
  assert.deepEqual(checkpoint.held.map(each => [each.node, each.decision, each.no_choice]), [['closing', 'No choice yet — needs your decision', true]]);
  assert.deepEqual(checkpoint.options.map(each => [each.id, each.recommended]), [['revise-closing', true], ['stop', false]]);
  assert.deepEqual(checkpoint.recommended, { option: 'revise-closing', reason: '"Which closing-choice?" has no choice yet: revise its step with the choice in your note' });
  assert.equal(checkpoint.options[0].suggestions[0].note, 'My choice for "Which closing-choice?" (closing-choice), to send as its recommended option when the step asks it again:');
  assert.match(heldBrief(run).stdout, /^- Which closing-choice\?: No choice yet — needs your decision \(approve\) — closing$/m);
  assert.match(heldBrief(run, '--oneline').stdout, / · Recommended: revise-closing · /);
  const request = JSON.parse(heldBrief(run, '--request').stdout);
  assert.deepEqual(request.options.map(each => each.id), ['revise-closing', 'stop']);
  assert.deepEqual(JSON.parse(heldBrief(run, '--json', '--picker=rich').stdout).options.map(each => each.id), ['revise-closing', 'stop', 'more-details']);
  assert.deepEqual(JSON.parse(heldBrief(run, '--json', '--picker=plain').stdout).options.map(each => each.id), ['revise-closing', 'stop', 'more-details']);
  // The writer holds the answer to the same options: a continue is refused, and nothing is approved.
  refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } }), 'state-gate-option-unknown');
  assert.equal(outstandingHeld(readState(run)).length, 1);
});

test('held-approval: with a question held with no choice and its revises spent, it offers stop alone, recommended', t => {
  const run = heldClosing(t, { owners: [] });
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'closing', questions: [{ ...unrecommended('closing-choice'), triage: APPROVE_TRIAGE }] }).stdout), 'ask: none');
  const spent = Array.from({ length: 10 }, (_, index) => ({ option: 'revise-closing', attempt: index + 1, note: 'again' }));
  ok(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { decisions: spent } } });
  const checkpoint = JSON.parse(heldBrief(run, '--checkpoint').stdout);
  assert.deepEqual(checkpoint.options.map(each => [each.id, each.recommended]), [['stop', true]]);
  assert.equal(checkpoint.recommended.option, 'stop');
  assert.deepEqual(JSON.parse(heldBrief(run, '--request').stdout).options.map(each => each.id), ['stop']);
  refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } }), 'state-gate-option-unknown');
  refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'revise-closing' } } }), 'state-gate-option-unknown');
});

test('held-approval: a continue no driver carried is refused state-held-approval-not-askable, and the choices stay held until run-complete refuses', t => {
  const run = heldClosing(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const refusal = refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } }), 'state-held-approval-not-askable');
  assert.match(refusal.stderr, /this run's dispatch driver asks a checkpoint through its request, which was never written/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
  assert.equal(outstandingHeld(readState(run)).length, 1);
  // A request answered with something else carries no continue either.
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'gates', `${HELD_APPROVAL_ID}.request.yml`), `${requestHead(HELD_APPROVAL_ID)}\nanswer:\n  option: stop\n`);
  assert.match(refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } }), 'state-held-approval-not-askable').stderr, /which carries no continue/);
  // Where the driver cannot carry it, the run closes and run-complete refuses: never a choice nobody approved.
  closeRun(run);
  assert.equal(completeRun(run, ...publishCloseout(run, 'failed')).stdout, 'RUN-FAILED: run-held-unapproved\n');
});

test('held-approval: a continue while another node is owed is refused state-held-approval-not-askable, even when a request carried it', t => {
  const run = heldClosing(t, { upTo: 'tidy' });
  const before = fs.readFileSync(run.state, 'utf8');
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'gates', `${HELD_APPROVAL_ID}.request.yml`), `${requestHead(HELD_APPROVAL_ID)}\nanswer:\n  option: continue\n`);
  const refusal = refused(send(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } }), 'state-held-approval-not-askable');
  assert.match(refusal.stderr, /which is not asked while tidy, closing are still owed/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
});

test('control: a run taken over in the terminal approves at held-approval in session, with no request', t => {
  const run = heldClosing(t);
  ok(QUESTIONS.engine, run, { orchestrator: { driver: { kind: 'terminal' } } });
  ok(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { answer: 'continue' } } });
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.equal(decisionsAt(run, HELD_APPROVAL_ID)[0].via, 'terminal');
});

test('held-approval: a second continue, after another choice is held, approves it too', t => {
  const run = heldClosing(t, { owners: ['closing'] });
  carried(run, HELD_APPROVAL_ID, 'continue');
  assert.deepEqual(outstandingHeld(readState(run)), []);
  const again = { ...labelled('second-choice'), triage: APPROVE_TRIAGE };
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'closing', questions: [again] }).stdout), 'ask: none');
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['closing', 'second-choice', 1]]);
  carried(run, HELD_APPROVAL_ID, 'continue');
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['closing', 'closing-choice', 1], ['closing', 'second-choice', 1]]);
  closeRun(run);
  assert.match(completeRun(run, ...publishCloseout(run)).stdout, /RUN-COMPLETE\n$/);
});

test('held-approval: its continue says what it approves, as its label does', t => {
  const run = heldClosing(t, { owners: ['choosing', 'closing'] });
  const go = JSON.parse(heldBrief(run, '--checkpoint').stdout).options.find(option => option.id === 'continue');
  assert.equal(go.consequence, 'Approves 2 held choices, then finishes the run.');
  const rich = JSON.parse(heldBrief(run, '--json', '--picker=rich').stdout).options[0];
  assert.equal(rich.label, 'Approve and finish — approves 2 held choices (Recommended)');
  assert.equal(rich.description, go.consequence);
});

test('held-approval: run-complete refuses run-held-unapproved after the unfinished nodes and before the close-out', t => {
  // Unfinished nodes are judged first.
  const early = heldClosing(t, { upTo: 'tidy' });
  ok(QUESTIONS.engine, early, { task: { status: 'completed' } });
  assert.equal(completeRun(early).stdout, 'RUN-FAILED: run-nodes-unfinished\n');

  const run = heldClosing(t, { owners: ['choosing', 'tidy'] });
  closeRun(run);
  const bare = completeRun(run);
  assert.equal(bare.code, 1);
  assert.equal(bare.stdout, 'RUN-FAILED: run-held-unapproved\n', 'judged before the close-out check');
  assert.match(bare.stderr, /choosing: Which choosing-choice\? → choosing-choice A/);
  assert.match(bare.stderr, /tidy: Which tidy-choice\? → tidy-choice A/);
  const flags = publishCloseout(run);
  assert.equal(completeRun(run, ...flags).stdout, 'RUN-FAILED: run-held-unapproved\n', 'a close-out published too early never completes the run');

  // A continue approves them, and the published close-out completes the run.
  carried(run, HELD_APPROVAL_ID, 'continue');
  assert.match(completeRun(run, ...flags).stdout, /(?:^|\n)RUN-COMPLETE\n$/);

  // A stopped run is not judged.
  const halted = heldClosing(t);
  ok(QUESTIONS.engine, halted, { task: { status: 'stopped' }, nodes: { closing: { status: 'stopped' } } });
  assert.doesNotMatch(completeRun(halted, ...publishCloseout(halted)).stdout, /run-held-unapproved/);
});

test('held-approval: the fallback\'s closing patch ends RUN-FAILED: run-held-unapproved; a terminal run resumed after a dispatch hold is briefed in session', t => {
  const run = heldClosing(t);
  const flags = publishCloseout(run, 'failed');
  closeRun(run);
  const result = completeRun(run, ...flags);
  assert.equal(result.stdout, 'RUN-FAILED: run-held-unapproved\n');
  assert.doesNotMatch(result.stdout, /failed-node|node \S+ failed/);

  const resumed = heldClosing(t);
  ok(QUESTIONS.engine, resumed, { orchestrator: { driver: { kind: 'terminal' } } });
  const picker = heldBrief(resumed, '--json', '--picker=rich');
  assert.equal(picker.code, 0, picker.stderr);
  const shaped = JSON.parse(picker.stdout);
  assert.equal(shaped.question, 'Approve the choices held for you, and finish the run?');
  assert.deepEqual(shaped.options.map(each => each.id), ['continue', 'revise-choosing', 'stop', 'more-details']);
});

// ---------------------------------------------------------------------------
// 12. held-approval: its revise, the open revision it leaves, and a driven resume
// ---------------------------------------------------------------------------

/** `gate-revise` at held-approval through the scratch engine, the note on stdin. */
function heldRevise(run, option, note = 'Tidy only what the run touched') {
  return runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, `--node=${HELD_APPROVAL_ID}`, `--option=${option}`], { note });
}

function heldRevised(run, option, note) {
  const result = heldRevise(run, option, note);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** A held-approval refusal that left the state file byte for byte as it was. */
function heldRefused(run, option, code) {
  const before = fs.readFileSync(run.state, 'utf8');
  const result = refused(heldRevise(run, option), code);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, `${code} wrote nothing`);
  return result;
}

const statusesOf = run => Object.fromEntries(Object.entries(readState(run).workflow.nodes).map(([id, entry]) => [id, entry.status]));

function priorContextOf(run) {
  const result = runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

const resumeCheckOf = run => JSON.parse(runScript(QUESTIONS.engine, ['resume-check', `--state=${run.state}`]).stdout);

test('held-approval revise: resets the owning node and everything whose needs reach it, closing node included, in one write', t => {
  const run = heldClosing(t, { owners: ['tidy'] });
  closeRun(run);
  ok(QUESTIONS.engine, run, { nodes: { [HELD_APPROVAL_ID]: { status: 'completed' } } });
  assert.equal(readState(run).task.status, 'completed');

  const result = heldRevised(run, 'revise-tidy');
  assert.match(result.stdout, /^revised: held-approval reruns=tidy revision=1\/10 reset=tidy,closing$/m);
  const state = readState(run);
  assert.deepEqual(statusesOf(run), {
    outline: 'completed', 'outline-approval': 'completed', choosing: 'completed', audit: 'skipped',
    tidy: 'pending', closing: 'pending', [HELD_APPROVAL_ID]: 'pending',
  });
  assert.equal(state.workflow.nodes.tidy.attempt, 2);
  assert.equal(state.workflow.nodes.closing.attempt, 2);
  assert.deepEqual(state.workflow.nodes[HELD_APPROVAL_ID], { kind: 'gate', status: 'pending' }, 'its clocks are gone with the reset');
  assert.equal(state.task.status, 'in_progress', 'a run already recorded completed goes back to in progress');
  const [decision, ...rest] = decisionsAt(run, HELD_APPROVAL_ID);
  assert.deepEqual(rest, []);
  assert.equal(decision.option, 'revise-tidy');
  assert.equal(decision.reruns, 'tidy');
  assert.equal(decision.attempt, 1);
  assert.equal(decision.note, 'Tidy only what the run touched');
  assert.equal(decision.via, 'dispatch');
  // The reset cleared the writer-classed choice it re-runs, so nothing is held now.
  assert.deepEqual(outstandingHeld(state), []);
});

test('held-approval revise: the revision count is its revise items plus one, refused revise-budget-exhausted past the safety limit', t => {
  const run = heldClosing(t, { owners: ['tidy'] });
  const history = Array.from({ length: 9 }, (_, index) => ({ option: 'revise-tidy', note: `Try again ${index + 1}`, attempt: index + 1 }));
  ok(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { decisions: history } } });
  const tenth = heldClosing(t, { owners: ['tidy'] });
  ok(QUESTIONS.engine, tenth, { node_summaries: { [HELD_APPROVAL_ID]: { decisions: history } } });
  assert.match(heldRevised(tenth, 'revise-tidy').stdout, /revision=10\/10/);
  assert.equal(decisionsAt(tenth, HELD_APPROVAL_ID).at(-1).attempt, 10);

  ok(QUESTIONS.engine, run, { node_summaries: { [HELD_APPROVAL_ID]: { decisions: [{ option: 'revise-tidy', note: 'Try again 10', attempt: 10 }] } } });
  const result = heldRefused(run, 'revise-tidy', 'revise-budget-exhausted');
  assert.match(result.stderr, /held-approval has been revised 10 times/);
});

test('held-approval revise: refused revise-gate-not-current while it is not the question, and revise-option-unknown for a node holding nothing', t => {
  const early = heldClosing(t, { owners: ['choosing'], upTo: 'tidy' });
  const result = heldRefused(early, 'revise-choosing', 'revise-gate-not-current');
  assert.match(result.stderr, /\bclosing\b/);

  const pending = heldClosing(t, { owners: ['tidy'] });
  suspendAt(pending, 'outline-approval');
  assert.match(heldRefused(pending, 'revise-tidy', 'revise-gate-not-current').stderr, /outline-approval/);

  const answered = heldClosing(t, { owners: ['tidy'] });
  carried(answered, HELD_APPROVAL_ID, 'continue');
  heldRefused(answered, 'revise-tidy', 'revise-option-unknown');

  const run = heldClosing(t, { owners: ['tidy'] });
  const unknown = heldRefused(run, 'revise-choosing', 'revise-option-unknown');
  assert.match(unknown.stderr, /revise-tidy/);
  heldRefused(run, 'continue', 'revise-option-unknown');
});

test('held-approval revise: a stretch holding a sub-run that ran is refused revise-stretch-has-subrun; one skipped is reset', t => {
  const run = heldClosing(t, { owners: ['choosing'], audit: 'completed' });
  const result = heldRefused(run, 'revise-choosing', 'revise-stretch-has-subrun');
  assert.match(result.stderr, /\baudit\b/);

  // Control: a skipped sub-run has no child to adopt again, so the revise resets it with the rest.
  const skipped = heldClosing(t, { owners: ['choosing'] });
  assert.match(heldRevised(skipped, 'revise-choosing').stdout, /^revised: held-approval reruns=choosing revision=1\/10 reset=choosing,audit,tidy,closing$/m);
});

test('a sub-run after a step holding a question with no choice does not start: held-approval is raised before it, and its revise resets the sub-run not yet run', t => {
  const run = heldClosing(t, { owners: ['choosing'], audit: 'completed', upTo: 'audit', open: true });
  assert.equal(heldApprovalBefore({ doc: readState(run), runDir: run.dir }), 'audit');
  const before = fs.readFileSync(run.state, 'utf8');
  const start = refused(send(QUESTIONS.engine, run, { nodes: { audit: { status: 'running' } } }), 'state-subrun-held-open');
  assert.match(start.stderr, /the sub-run audit follows choosing, where "Which choosing-choice\?" has no choice yet/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');

  const checkpoint = JSON.parse(heldBrief(run, '--checkpoint').stdout);
  assert.equal(checkpoint.ask, 'Held questions need your choice before audit. Revise the step that holds them, with your choice in the note?');
  assert.deepEqual(checkpoint.options.map(each => each.id), ['revise-choosing', 'stop']);
  const revised = heldRevised(run, 'revise-choosing', 'My choice for "Which choosing-choice?" (choosing-choice): choosing-choice B');
  assert.match(revised.stdout, /reset=choosing,audit,tidy,closing$/m);
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.equal(statusesOf(run).audit, 'pending');
});

test('control: a sub-run after a step holding a provisional choice, or after a step holding nothing, starts as before', t => {
  const provisional = heldClosing(t, { owners: ['choosing'], audit: 'completed', upTo: 'audit' });
  assert.equal(heldApprovalBefore({ doc: readState(provisional), runDir: provisional.dir }), null);
  ok(QUESTIONS.engine, provisional, { nodes: { audit: { status: 'running' } } });
  const nothing = heldClosing(t, { owners: [], audit: 'completed', upTo: 'audit' });
  ok(QUESTIONS.engine, nothing, { nodes: { audit: { status: 'running' } } });
});

test('held-approval revise: a folded driven revise is open and unapplied until gate-revise stamps it; prior-context then prints the note', t => {
  const run = heldClosing(t, { owners: ['tidy'] });
  drivenAnswer(run, HELD_APPROVAL_ID, 'revise-tidy');
  assert.deepEqual(resumeCheckOf(run).revision, { gate: HELD_APPROVAL_ID, option: 'revise-tidy', reruns: 'tidy', revision: 1, applied: false });
  assert.doesNotMatch(priorContextOf(run), /Revision requested/, 'no note before the reset');

  heldRevised(run, 'revise-tidy', 'Keep the generated files');
  const [decision, ...rest] = decisionsAt(run, HELD_APPROVAL_ID);
  assert.deepEqual(rest, [], 'the revise decision takes the folded answer\'s place');
  assert.equal(decision.answered_by, 'dana');
  assert.equal(decision.at, '2026-01-05T09:05:00Z');
  assert.deepEqual(resumeCheckOf(run).revision, { gate: HELD_APPROVAL_ID, option: 'revise-tidy', reruns: 'tidy', revision: 1, applied: true });
  const text = priorContextOf(run);
  assert.match(text, /^## Revision requested — held-approval$/m);
  assert.match(text, /re-run `tidy` \(revision 1 at that checkpoint\)/);
  assert.match(text, /^Note: Keep the generated files$/m);
});

test('held-approval: a driven run suspends on it, resumes at the close-out after a continue, and runs gate-revise after a revise', t => {
  const run = heldClosing(t, { owners: ['tidy'] });
  suspendAt(run, HELD_APPROVAL_ID);
  let state = readState(run);
  assert.equal(state.workflow.nodes[HELD_APPROVAL_ID].status, 'suspended');
  assert.equal(state.orchestrator.gate_pending.node, HELD_APPROVAL_ID);
  assert.equal(state.workflow.nodes.closing.status, 'running', 'the closing node stays running across the suspend');

  foldAt(run, HELD_APPROVAL_ID, 'continue');
  ok(QUESTIONS.engine, run, {});
  assert.deepEqual(outstandingHeld(readState(run)), [], 'the continue approved the held choice');
  assert.equal(resumeCheckOf(run).revision, undefined);
  const flags = publishCloseout(run);
  closeRun(run);
  const done = completeRun(run, ...flags);
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /(?:^|\n)RUN-COMPLETE\n$/);

  const sent = heldClosing(t, { owners: ['tidy'] });
  drivenAnswer(sent, HELD_APPROVAL_ID, 'revise-tidy');
  assert.equal(resumeCheckOf(sent).revision.applied, false);
  heldRevised(sent, 'revise-tidy');
  state = readState(sent);
  assert.equal(state.orchestrator.gate_pending ?? null, null);
  assert.equal(state.workflow.nodes.tidy.status, 'pending');
  assert.equal(state.workflow.nodes.closing.status, 'pending');
  assert.equal(state.workflow.nodes[HELD_APPROVAL_ID].status, 'pending');
  assert.equal(resumeCheckOf(sent).revision.applied, true);
});

// ---------------------------------------------------------------------------
// 13. end to end
// ---------------------------------------------------------------------------

/** The dashboard's decisions on `node`'s phase, as the projection published them. */
const dashboardDecisions = (run, node) => readDashboard(run).phases.find(phase => phase.id === node).decisions;

test('end to end under dispatch: held, briefed first at the forced gate, approved by a continue, marked approved on the dashboard', t => {
  // scoping holds signed-choice and sets wants_review false, so review-approval
  // runs only because a choice is held.
  const run = heldRun(t, { values: { wants_review: false, wants_notes: false } });
  const before = byId(dashboardDecisions(run, 'scoping'), 'signed-choice');
  assert.equal(before.triage.held, true);
  assert.equal(Object.hasOwn(before, 'approved'), false);

  const brief = gateBriefOf(run, 'review-approval', '--checkpoint');
  assert.equal(brief.code, 0, brief.stderr);
  const checkpoint = JSON.parse(brief.stdout);
  assert.deepEqual(checkpoint.held, [HELD_ENTRY]);
  const plain = gateBriefOf(run, 'review-approval');
  assert.equal(plain.stdout.split('\n')[1], 'Held for your approval:');

  drivenAnswer(run, 'review-approval', 'continue-past-review');
  ok(QUESTIONS.engine, run, {});
  assert.deepEqual(outstandingHeld(readState(run)), []);
  const after = byId(dashboardDecisions(run, 'scoping'), 'signed-choice');
  assert.deepEqual(after.approved, { by: 'dana' });
  assert.equal(after.triage.held, true, 'the held mark stays as history');
  for (const other of dashboardDecisions(run, 'scoping').filter(each => each.question_id !== 'signed-choice')) {
    assert.equal(Object.hasOwn(other, 'approved'), false, other.question_id);
  }
});

test('end to end under dispatch: a question held with no choice is settled by a revise carrying the choice, then approved — never by a continue', t => {
  // The review loop: draft holds the question, and review-approval's send-back re-runs draft.
  const run = started(t, QUESTIONS.engine, { definition: REVISE, node: 'draft', driver: DISPATCH });
  const open = { ...unrecommended('layout-choice'), triage: APPROVE_TRIAGE };
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'draft', questions: [open] }).stdout), 'ask: none');
  ok(QUESTIONS.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } }, figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } },
    node_summaries: { draft: { summary: 'Drafted.' }, review: { summary: 'Reviewed.' } },
  });
  assert.equal(byId(dashboardDecisions(run, 'draft'), 'layout-choice').no_choice, true);

  // The checkpoint whose revise re-runs draft lists it, and recommends that revise with a note asking for the choice.
  const checkpoint = JSON.parse(gateBriefOf(run, 'review-approval', '--checkpoint').stdout);
  assert.equal(checkpoint.held[0].no_choice, true);
  assert.deepEqual(checkpoint.recommended, { option: 'send-back', reason: '"Which layout-choice?" has no choice yet: revise with the choice in your note' });
  const sendBack = checkpoint.options.find(option => option.id === 'send-back');
  assert.equal(sendBack.recommended, true);
  assert.equal(sendBack.suggestions[0].note, 'My choice for "Which layout-choice?" (layout-choice), to send as its recommended option when the step asks it again:');
  const publish = checkpoint.options.find(option => option.id === 'publish-draft');
  assert.match(publish.consequence, / Leaves 1 held question with no choice yet held until a revise of its step supplies one\.$/);

  // A continue there approves nothing it was not given a choice for.
  answerGate(run, 'review-approval', 'publish-draft');
  assert.deepEqual(approvalsOf(readState(run)), []);
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['draft', 'layout-choice', 1]]);
  assert.equal(Object.hasOwn(byId(dashboardDecisions(run, 'draft'), 'layout-choice'), 'approved'), false);

  // final-approval's redo-draft reaches draft too: it is asked, recommending that revise.
  ok(QUESTIONS.engine, run, { nodes: { publish: { status: 'completed' } }, node_summaries: { publish: { summary: 'Published.' } } });
  assert.equal(JSON.parse(gateBriefOf(run, 'final-approval', '--checkpoint').stdout).recommended.option, 'redo-draft');
  const sent = runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=final-approval', '--option=redo-draft'],
    { note: 'My choice for "Which layout-choice?" (layout-choice): layout-choice B' });
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual(outstandingHeld(readState(run)), [], 'the reset cleared the question held with no choice');

  // The re-run reads the note, and sends the question with that choice recommended: held with it, provisionally.
  ok(QUESTIONS.engine, run, { nodes: { draft: { status: 'running' } } });
  assert.match(runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]).stdout, /^Note: My choice for "Which layout-choice\?" \(layout-choice\): layout-choice B$/m);
  const chosen = { ...unrecommended('layout-choice'), triage: APPROVE_TRIAGE };
  chosen.options = chosen.options.map(option => (option.id === 'b' ? { ...option, recommended: true } : option));
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'draft', questions: [chosen] }).stdout), 'ask: none');
  const provisional = byId(summaryOf(run, 'draft').decisions, 'layout-choice');
  assert.equal(provisional.decision, 'layout-choice B');
  assert.equal(Object.hasOwn(provisional, 'no_choice'), false);
  assert.equal(provisional.attempt, 2);

  // The next checkpoint approves it with its continue, as any held choice.
  ok(QUESTIONS.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } }, figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } },
    node_summaries: { draft: { summary: 'Drafted again.' }, review: { summary: 'Reviewed again.' } },
  });
  answerGate(run, 'review-approval', 'publish-draft');
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.deepEqual(byId(dashboardDecisions(run, 'draft'), 'layout-choice').approved, { by: readState(run).node_summaries['review-approval'].decisions.findLast(item => item.option).answered_by });
  ok(QUESTIONS.engine, run, { nodes: { publish: { status: 'completed' } }, node_summaries: { publish: { summary: 'Published again.' } } });
  answerGate(run, 'final-approval', 'close');
  ok(QUESTIONS.engine, run, { task: { status: 'completed' } });
  refused(gateBriefOf(run, HELD_APPROVAL_ID), 'gate-brief-nothing-held');
  assert.match(completeRun(run, ...publishCloseout(run)).stdout, /RUN-COMPLETE\n$/);
});

/**
 * The review loop under dispatch, with a question held with no choice in each
 * of `owners`: `review` sits in review-approval's send-back stretch, while
 * `side-note` sits behind final-approval only. Stops at review-approval.
 * `chosen` holds each with its recommended choice instead.
 */
function reviewLoopHolding(t, owners, { chosen = false } = {}) {
  const run = started(t, QUESTIONS.engine, { definition: REVISE, node: 'draft', driver: DISPATCH });
  const hold = node => {
    if (!owners.includes(node)) return;
    const set = [{ ...(chosen ? labelled(`${node}-choice`) : unrecommended(`${node}-choice`)), triage: APPROVE_TRIAGE }];
    assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node, questions: set }).stdout), 'ask: none');
  };
  ok(QUESTIONS.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } }, figures: { status: 'skipped' }, review: { status: 'running' }, 'side-note': { status: 'running' } },
    node_summaries: { draft: { summary: 'Drafted.' } },
  });
  hold('review');
  hold('side-note');
  ok(QUESTIONS.engine, run, {
    nodes: { review: { status: 'completed' }, 'side-note': { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed.' }, 'side-note': { summary: 'Noted.' } },
  });
  return run;
}

test('a checkpoint whose revise reaches only some steps holding a question with no choice settles those, and the rest wait for one that reaches them', t => {
  const run = reviewLoopHolding(t, ['review', 'side-note']);
  // review-approval's send-back re-runs review, not side-note: it is asked, not preceded by held-approval.
  assert.equal(heldApprovalBefore({ doc: readState(run), runDir: run.dir }), null);
  refused(heldBrief(run), 'gate-brief-not-askable');
  const checkpoint = JSON.parse(gateBriefOf(run, 'review-approval', '--checkpoint').stdout);
  assert.deepEqual(checkpoint.recommended, { option: 'send-back', reason: '"Which review-choice?" has no choice yet: revise with the choice in your note' });
  const sendBack = checkpoint.options.find(option => option.id === 'send-back');
  const asking = sendBack.suggestions.filter(each => each.note.startsWith('My choice for'));
  assert.deepEqual(asking.map(each => each.label), ['Choose: Which review-choice?'], 'only the question its revise re-runs');
  assert.deepEqual(checkpoint.held.filter(each => each.no_choice).map(each => each.question_id), ['review-choice', 'side-note-choice']);

  // The revise carries the choice; side-note's question still waits, for final-approval, which reaches it.
  const sent = runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'],
    { note: 'My choice for "Which review-choice?" (review-choice): review-choice B' });
  assert.equal(sent.code, 0, sent.stderr);
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['side-note', 'side-note-choice', 1]]);
});

test('a revise names the held choice it rejects; one whose step it does not re-run is left out', t => {
  const run = reviewLoopHolding(t, ['review', 'side-note'], { chosen: true });
  const checkpoint = JSON.parse(gateBriefOf(run, 'review-approval', '--checkpoint').stdout);
  const sendBack = checkpoint.options.find(option => option.id === 'send-back');
  assert.match(sendBack.consequence, / Rejects the held choice for "Which review-choice\?", which the step makes again\.$/);
  assert.doesNotMatch(sendBack.consequence, /side-note-choice/, 'side note is outside the stretch');
  assert.equal(checkpoint.recommended.option, 'publish-draft', 'a revise is never recommended for a choice taken');
  const request = JSON.parse(gateBriefOf(run, 'review-approval', '--request').stdout);
  assert.match(JSON.stringify(request.options.find(option => option.id === 'send-back')), /Rejects the held choice for/);

  // Control: with nothing held in its stretch, the revise says what it always said.
  const plain = reviewLoopHolding(t, ['side-note'], { chosen: true });
  const control = JSON.parse(gateBriefOf(plain, 'review-approval', '--checkpoint').stdout).options.find(option => option.id === 'send-back');
  assert.match(control.consequence, /^Re-runs .* with your note, then asks this again\.$/);
});

test('control: a checkpoint whose revises reach none of the steps holding a question with no choice is still preceded by held-approval', t => {
  const run = reviewLoopHolding(t, ['side-note']);
  const blocked = gateBriefOf(run, 'review-approval', '--checkpoint');
  refused(blocked, 'gate-brief-not-askable');
  assert.match(blocked.stderr, /offers no revise that re-runs side note\. Nothing was written\. Ask --node=held-approval first/);
  assert.equal(heldApprovalBefore({ doc: readState(run), runDir: run.dir }), 'review-approval');
});

test('two checkpoints ready at once: each settles the question with no choice, by its own revise or the one it offers for the step', t => {
  const run = started(t, QUESTIONS.engine, { definition: path.join(FIXTURES, 'definitions/two-checkpoints.yml'), node: 'choosing', driver: DISPATCH });
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { node: 'choosing', questions: [{ ...unrecommended('pick-choice'), triage: APPROVE_TRIAGE }] }).stdout), 'ask: none');
  ok(QUESTIONS.engine, run, { nodes: { choosing: { status: 'completed' } }, node_summaries: { choosing: { summary: 'Chose.' } } });

  // A reached checkpoint can settle it, so held-approval is not raised.
  assert.equal(heldApprovalBefore({ doc: readState(run), runDir: run.dir }), null);
  refused(heldBrief(run), 'gate-brief-not-askable');
  // plain-approval has no revise of its own: it offers one for the step holding the question, and recommends it.
  const plain = JSON.parse(gateBriefOf(run, 'plain-approval', '--checkpoint').stdout);
  assert.equal(plain.recommended.option, 'revise-choosing');
  assert.deepEqual(plain.options.map(each => each.id), ['go-on', 'revise-choosing', 'halt']);
  // redo-approval's own revise already re-runs it, so it offers no second one.
  const redo = JSON.parse(gateBriefOf(run, 'redo-approval', '--checkpoint').stdout);
  assert.equal(redo.recommended.option, 'redo-choosing');
  assert.deepEqual(redo.options.map(each => each.id), ['keep', 'redo-choosing', 'quit']);
});

test('held-approval raised before a checkpoint asks by that checkpoint, not by the end of the run', t => {
  // side note holds the question; review-approval is not behind it, so it cannot send it back.
  const run = reviewLoopHolding(t, ['side-note']);
  const ask = 'Held questions need your choice before review approval. Revise the step that holds them, with your choice in the note?';
  assert.equal(JSON.parse(heldBrief(run, '--checkpoint').stdout).ask, ask);
  assert.equal(JSON.parse(heldBrief(run, '--request').stdout).question, ask);
  assert.doesNotMatch(ask, /finish the run/);
});

test('end to end under dispatch: a checkpoint with no revise of its own offers one for the step holding a question with no choice, carrying the choice', t => {
  // review-approval offers continue and stop of its own; it is behind scoping, so it offers revise-scoping too.
  const run = started(t, QUESTIONS.engine, { driver: DISPATCH });
  const open = { ...unrecommended('signed-choice') };
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { questions: [labelled('quick-choice'), open] }).stdout), 'ask: none');
  ok(QUESTIONS.engine, run, {
    nodes: { scoping: { status: 'completed', values: { wants_review: false, wants_notes: false } } },
    node_summaries: { scoping: { summary: 'Scoped the work.' } },
  });
  assert.equal(heldApprovalBefore({ doc: readState(run), runDir: run.dir }), null);
  const checkpoint = JSON.parse(gateBriefOf(run, 'review-approval', '--checkpoint').stdout);
  assert.deepEqual(checkpoint.options.map(each => each.id), ['continue-past-review', 'revise-scoping', 'stop-at-review']);
  const revise = checkpoint.options.find(each => each.id === 'revise-scoping');
  assert.equal(revise.label, 'Revise scoping');
  assert.equal(revise.recommended, true);
  assert.equal(checkpoint.recommended.option, 'revise-scoping');
  const revised = runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=revise-scoping'],
    { note: 'My choice for "Which signed-choice?" (signed-choice): signed-choice B' });
  assert.equal(revised.code, 0, revised.stderr);
  assert.match(revised.stdout, /^revised: review-approval reruns=scoping revision=1\/10 reset=scoping,review-approval$/m);
  const decision = decisionsAt(run, 'review-approval').at(-1);
  assert.equal(decision.option, 'revise-scoping');
  assert.equal(decision.reruns, 'scoping');
  assert.equal(decision.decision, 'Revise scoping');
  assert.deepEqual(outstandingHeld(readState(run)), []);

  // The re-run holds the choice it was given; review-approval is asked again, and its continue approves it.
  ok(QUESTIONS.engine, run, { nodes: { scoping: { status: 'running' } } });
  const chosen = { ...unrecommended('signed-choice') };
  chosen.options = chosen.options.map(option => (option.id === 'b' ? { ...option, recommended: true } : option));
  assert.equal(askLine(classing(QUESTIONS.engine, run, [], { questions: [labelled('quick-choice'), chosen] }).stdout), 'ask: none');
  ok(QUESTIONS.engine, run, {
    nodes: { scoping: { status: 'completed', values: { wants_review: false, wants_notes: false } } },
    node_summaries: { scoping: { summary: 'Scoped again.' } },
  });
  const listed = JSON.parse(gateBriefOf(run, 'review-approval', '--checkpoint').stdout);
  assert.deepEqual(listed.held.map(each => [each.decision, each.no_choice ?? null]), [['signed-choice B', null]]);
  assert.equal(listed.recommended.option, 'continue-past-review', 'a revise for a choice taken is never recommended');
  answerGate(run, 'review-approval', 'continue-past-review');
  assert.deepEqual(outstandingHeld(readState(run)), []);
  ok(QUESTIONS.engine, run, {
    task: { status: 'completed' },
    nodes: { 'depth-approval': { status: 'skipped' }, drafting: { status: 'completed' }, notes: { status: 'skipped' }, 'notes-approval': { status: 'skipped' }, finish: { status: 'completed' } },
  });
  assert.match(completeRun(run, ...publishCloseout(run)).stdout, /RUN-COMPLETE\n$/);
});

test('one continue records the answer, the settlement of the value it sets, then the approval of the held choice', t => {
  const engine = WITH_SETTLEMENTS.engine;
  const run = started(t, engine, { definition: path.join(FIXTURES, 'definitions/optional-step.yml'), node: 'specification', driver: DISPATCH });
  const asked = { ...labelled('layout-choice'), triage: { version: 1, class: 'approve', family: 'area-family' } };
  assert.equal(classing(engine, run, [], { node: 'specification', questions: [asked] }).code, 0);
  ok(engine, run, { nodes: { specification: { status: 'completed' } }, node_summaries: { specification: { summary: 'Wrote it.' } } });
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['specification', 'layout-choice', 1]]);

  ok(engine, run, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-audit', answered_by: 'dana' }] } },
  });
  const [answer, settlement, approval, ...rest] = decisionsAt(run, 'specification-approval');
  assert.deepEqual(rest, []);
  assert.equal(answer.option, 'continue-to-audit');
  assert.equal(settlement.ref, 'audit_enabled');
  assert.equal(settlement.decision, 'audit_enabled: true');
  assert.equal(approval.question_id, 'layout-choice');
  assert.equal(approval.node, 'specification');
  assert.equal(approval.answered_by, 'dana');
  assert.deepEqual(outstandingHeld(readState(run)), []);

  // A closing write re-sending the answer keeps one of each, in that order.
  ok(engine, run, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-audit', answered_by: 'dana' }] } },
  });
  assert.deepEqual(decisionsAt(run, 'specification-approval').map(item => item.option ?? item.ref ?? item.question_id),
    ['continue-to-audit', 'audit_enabled', 'layout-choice']);
});

test('the built-in default: a gate\'s checkpoint and request after a classing write carry no held list, class or triage', t => {
  const words = /\btriage\b|\basking\b|classes_questions|\bheld\b|\bclass\b|Held/;
  for (const driver of [COCKPIT, DISPATCH]) {
    const run = started(t, null, { ceiling: null, driver });
    assert.equal(classing(null, run, ['quick-choice', 'signed-choice']).code, 0);
    ok(null, run, {
      nodes: { scoping: { status: 'completed', values: { wants_review: true, wants_notes: false } } },
      node_summaries: { scoping: { summary: 'Scoped the work.', decisions: [{ decision: 'quick-choice A', by: 'run', question_id: 'quick-choice' }] } },
    });
    for (const form of [['--checkpoint'], ['--request'], [], ['--oneline']]) {
      const result = verb(['gate-brief', `--state=${run.state}`, '--node=review-approval', ...form]);
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout.replaceAll(ROOT, '<repo>'), words, `${driver.kind} ${form.join(' ') || 'plain'}`);
    }
    assert.doesNotMatch(fs.readFileSync(run.state, 'utf8').replaceAll(ROOT, '<repo>'), words);
    // Nothing is ever held, so the closing checkpoint has nothing to ask.
    refused(verb(['gate-brief', `--state=${run.state}`, '--node=held-approval']), 'gate-brief-nothing-held');
  }
});

// ---------------------------------------------------------------------------
// 13. a revise for a held choice at an ordinary checkpoint
// ---------------------------------------------------------------------------

const HELD_REVISE = path.join(FIXTURES, 'definitions/held-revise.yml');

/**
 * `held-revise` under dispatch, its three steps run in turn with a choice held
 * in each of `owners`, stopped at `check`, the checkpoint behind them all.
 */
function heldBeforeCheck(t, owners) {
  const run = started(t, QUESTIONS.engine, { definition: HELD_REVISE, node: 'first', driver: DISPATCH });
  for (const [index, node] of ['first', 'second', 'third'].entries()) {
    if (index) ok(QUESTIONS.engine, run, { nodes: { [node]: { status: 'running' } } });
    if (owners.includes(node)) holdIn(run, node);
    ok(QUESTIONS.engine, run, { nodes: { [node]: { status: 'completed' } }, node_summaries: { [node]: { summary: `Made the ${node} choice.` } } });
  }
  return run;
}

function checkRevise(run, option, note) {
  return runScript(QUESTIONS.engine, ['gate-revise', `--state=${run.state}`, '--node=check', `--option=${option}`], { note });
}

test('held revise: a checkpoint with no revise of its own offers one per step holding a choice, never recommended', t => {
  const run = heldBeforeCheck(t, ['first', 'second']);
  const checkpoint = JSON.parse(gateBriefOf(run, 'check', '--checkpoint').stdout);
  assert.deepEqual(checkpoint.options.map(each => [each.id, each.effect]), [['go-on', 'continue'], ['revise-first', 'revise'], ['revise-second', 'revise'], ['halt', 'stop']]);
  assert.equal(checkpoint.recommended.option, 'go-on');
  const second = checkpoint.options.find(each => each.id === 'revise-second');
  assert.equal(second.label, 'Revise second');
  assert.match(second.consequence, /^Re-runs Second and Third with your note, then asks this again\. Rejects the held choice for "Which second-choice\?", which the step makes again\.$/);
  assert.deepEqual(second.revision, { n: 1, max: 10 });

  // The request carries them as revise options needing a note; the one-line brief lists them.
  const request = JSON.parse(gateBriefOf(run, 'check', '--request').stdout);
  const offered = request.options.find(each => each.id === 'revise-second');
  assert.equal(offered.effect, 'revise');
  assert.equal(offered.note, true);
  assert.match(gateBriefOf(run, 'check', '--oneline').stdout, / · revise: revise-second reruns=second revision=1\/10 · /);
  // The rich picker lists them in its four slots, More details then typed.
  const rich = JSON.parse(gateBriefOf(run, 'check', '--json', '--picker=rich').stdout);
  assert.deepEqual(rich.options.map(each => each.id), ['go-on', 'revise-first', 'revise-second', 'halt']);
  assert.equal(rich.details, 'typed');

  // Control: with nothing held, the gate offers its own options alone.
  const plain = heldBeforeCheck(t, []);
  assert.deepEqual(JSON.parse(gateBriefOf(plain, 'check', '--checkpoint').stdout).options.map(each => each.id), ['go-on', 'halt']);
  refused(checkRevise(plain, 'revise-first', 'Use B'), 'revise-option-unknown');
});

test('held revise: sending one step back rejects its choice without approving the rest, in session', t => {
  const run = heldBeforeCheck(t, ['first', 'second']);
  const revised = checkRevise(run, 'revise-second', 'Take second-choice B instead');
  assert.equal(revised.code, 0, revised.stderr);
  assert.match(revised.stdout, /^revised: check reruns=second revision=1\/10 reset=second,third,check$/m);
  const decision = decisionsAt(run, 'check').at(-1);
  assert.deepEqual([decision.option, decision.reruns, decision.attempt, decision.note, decision.decision],
    ['revise-second', 'second', 1, 'Take second-choice B instead', 'Revise second']);
  // first's choice is still held and unapproved; second's left with its reset.
  assert.deepEqual(keyed(outstandingHeld(readState(run))), [['first', 'first-choice', 1]]);
  assert.deepEqual(approvalsOf(readState(run)), []);
  assert.deepEqual(resumeCheckOf(run).revision, { gate: 'check', option: 'revise-second', reruns: 'second', revision: 1, applied: true });
  assert.match(runScript(QUESTIONS.engine, ['prior-context', `--state=${run.state}`]).stdout, /^Note: Take second-choice B instead$/m);

  // The step re-runs and holds its new choice; the checkpoint's continue then approves both.
  ok(QUESTIONS.engine, run, { nodes: { second: { status: 'running' } } });
  holdIn(run, 'second');
  ok(QUESTIONS.engine, run, { nodes: { second: { status: 'completed' } }, node_summaries: { second: { summary: 'Chose again.' } } });
  ok(QUESTIONS.engine, run, { nodes: { third: { status: 'running' } } });
  ok(QUESTIONS.engine, run, { nodes: { third: { status: 'completed' } }, node_summaries: { third: { summary: 'Made the third choice again.' } } });
  answerGate(run, 'check', 'go-on');
  assert.deepEqual(outstandingHeld(readState(run)), []);
  assert.deepEqual(keyed(approvalsOf(readState(run))), [['first', 'first-choice', 1], ['second', 'second-choice', 2]]);
});

test('held revise: driven, the folded answer is open and unapplied until gate-revise applies it', t => {
  const run = heldBeforeCheck(t, ['first', 'second']);
  drivenAnswer(run, 'check', 'revise-first');
  assert.deepEqual(resumeCheckOf(run).revision, { gate: 'check', option: 'revise-first', reruns: 'first', revision: 1, applied: false });
  // The fold is accepted by the writer as an answer the gate offered.
  ok(QUESTIONS.engine, run, {});
  const revised = checkRevise(run, 'revise-first', 'Take first-choice B');
  assert.equal(revised.code, 0, revised.stderr);
  assert.match(revised.stdout, /reset=first,second,third,check$/m);
  assert.equal(resumeCheckOf(run).revision.applied, true);
  assert.deepEqual(outstandingHeld(readState(run)), [], 'every step holding a choice re-runs');
});

test('held revise: the writer accepts the answer while the gate offers it, and refuses it once nothing is held', t => {
  const run = heldBeforeCheck(t, ['first']);
  const before = fs.readFileSync(run.state, 'utf8');
  refused(send(QUESTIONS.engine, run, { node_summaries: { check: { answer: 'revise-second' } } }), 'state-gate-option-unknown');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  ok(QUESTIONS.engine, run, { nodes: { check: { status: 'completed' } }, node_summaries: { check: { answer: 'revise-first' } } });
  assert.equal(decisionsAt(run, 'check').at(-1).decision, 'Revise first');

  const none = heldBeforeCheck(t, []);
  refused(send(QUESTIONS.engine, none, { node_summaries: { check: { answer: 'revise-first' } } }), 'state-gate-option-unknown');
});

test('held revise: with more than the rich picker holds, it lists the revises nearest the end and names the rest', t => {
  const run = heldBeforeCheck(t, ['first', 'second', 'third']);
  const rich = JSON.parse(gateBriefOf(run, 'check', '--json', '--picker=rich').stdout);
  assert.deepEqual(rich.options.map(each => each.id), ['go-on', 'revise-second', 'revise-third', 'halt']);
  assert.match(rich.question, /Also offered, not listed: Revise first \(revise-first\); name one to choose it\./);
  const plain = JSON.parse(gateBriefOf(run, 'check', '--json', '--picker=plain').stdout);
  assert.ok(plain.options.some(each => each.id === 'revise-first'), 'the plain picker lists every one');
});

test('held revise: none is offered once the checkpoint has spent its revisions', t => {
  const run = heldBeforeCheck(t, ['first']);
  const text = fs.readFileSync(run.state, 'utf8').replace(/^( {4}check: \{kind: gate, status: pending)/m, '$1, attempt: 11');
  fs.writeFileSync(run.state, text);
  const checkpoint = JSON.parse(gateBriefOf(run, 'check', '--checkpoint').stdout);
  assert.deepEqual(checkpoint.options.map(each => each.id), ['go-on', 'halt']);
  refused(checkRevise(run, 'revise-first', 'Use B'), 'revise-option-unknown');
});
