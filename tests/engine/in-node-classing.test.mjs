import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, ROOT, freezePatch, readState, run as runScript, scratch, sharedPlugin, verb } from '../helpers.mjs';
import { skippedAgain } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';
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

// ---------------------------------------------------------------------------
// 4. refusals
// ---------------------------------------------------------------------------

test('a classing write is refused state-patch-invalid for a gate, a node not running, a bad set, bad reasons and no default', t => {
  const run = started(t, QUESTIONS.engine);
  const before = fs.readFileSync(run.state, 'utf8');
  const cases = [
    ['a gate', classing(QUESTIONS.engine, run, ['quick-choice'], { node: 'review-approval' }), /review-approval is a gate/],
    ['a node not running', classing(QUESTIONS.engine, run, ['quick-choice'], { node: 'drafting' }), /drafting is "pending"/],
    ['a set checkSet rejects', classing(QUESTIONS.engine, run, [], { questions: [] }), /"questions" must be a non-empty list/],
    ['an unknown reasons id', classing(QUESTIONS.engine, run, ['quick-choice'], { reasons: { 'no-such': { rationale: 'x' } } }), /"reasons" names "no-such"/],
    ['an unknown reasons key', classing(QUESTIONS.engine, run, ['quick-choice'], { reasons: { 'quick-choice': { why: 'x' } } }), /the key "why"/],
    ['a classed question with no default', classing(QUESTIONS.engine, run, [], { questions: [question('quick-choice', { recommended: false })] }), /needs a default/],
  ];
  for (const [what, result, message] of cases) {
    refused(result, 'state-patch-invalid');
    assert.match(result.stderr, message, what);
  }
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
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
    assert.equal(nothing.stdout, '');
  }
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
  node: 'scoping', question_id: 'signed-choice', question: 'Which signed-choice?', decision: 'signed-choice A',
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
  assert.equal(lines[2], '- Which signed-choice?: signed-choice A (approve)');
  assert.ok(lines.indexOf('Decisions:') > 2 && lines.indexOf('Risks:') > lines.indexOf('Decisions:'), plain.stdout);
  assert.ok(lines.includes('- quick-choice A (decide-alone)'), plain.stdout);
  assert.doesNotMatch(plain.stdout, /^- signed-choice A/m, 'a held choice is not listed again among the decisions');

  const oneline = gateBriefOf(run, 'review-approval', '--oneline');
  assert.equal(oneline.code, 0, oneline.stderr);
  assert.match(oneline.stdout, /^Scoped the work\. · Held: approve: signed-choice → signed-choice A · Risks: open: the layout may change · Decisions: run \(decide-alone\): quick-choice A — A is the safe pick\.; default \(consult\): asked-choice A · /);
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
  assert.match(plain.stdout, /^Skipped\.\nHeld for your approval:\n- Which signed-choice\?: signed-choice A \(approve\)\n/);

  const bare = gateBriefOf(reach(false), 'notes-approval', '--checkpoint');
  refused(bare, 'gate-brief-no-summary');
});

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

/**
 * A driven answer to `gate` as the cockpit leaves it: a request answered on
 * disk, a pending index row, and the answer the model folded into the state by
 * hand. The next write's index sync closes the row.
 */
function drivenAnswer(run, gate, option) {
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  const request = path.join(gates, `${gate}.request.yml`);
  const head = ['version: 1', `node: ${gate}`, 'kind: approval', 'question: "Continue?"', 'multiple: false', 'asked_at: "2026-01-05T09:00:00Z"'].join('\n');
  fs.writeFileSync(request, `${head}\nanswer: null\n`);
  refreshIndex(run.dir);
  ok(QUESTIONS.engine, run, {
    orchestrator: { gate_pending: { node: gate, request: `gates/${gate}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [gate]: { status: 'suspended' } },
  });
  fs.writeFileSync(request, `${head}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n  on_behalf_of: lee\n`);
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${gate}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  assert.match(text, /^node_summaries:\n(?: {2}.*\n|\s*\n)*$/m, 'node_summaries is the last block');
  fs.writeFileSync(run.state, `${text}  ${gate}:\n    decisions:\n      - {option: ${option}, answered_by: dana, at: "2026-01-05T09:05:00Z", via: cockpit}\n    status: completed\n`);
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
