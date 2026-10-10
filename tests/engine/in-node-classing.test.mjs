import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, ROOT, freezePatch, readState, run as runScript, scratch, sharedPlugin, verb } from '../helpers.mjs';

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
