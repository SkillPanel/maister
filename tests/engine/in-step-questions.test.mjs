import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';
import { scanState } from '../../plugins/maister/lib/state-scan.mjs';

// A question a node asks inside itself suspends to the operator only under a
// cockpit driver that lists `question-sets`. The node writes its set to the
// patch file, `gate-brief --request` builds the request from it, and once the
// answer is folded the writer records one operator decision per question from
// the answer block. The request-writing verb is not part of this edition, so
// the suspension is set up the way it lands on disk, as in gates.test.mjs.

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const REQUEST = path.join(FIXTURES, 'gates/question-set.request.yml');
const ANSWER = path.join(FIXTURES, 'gates/question-set.answer.yml');
const OTHER = path.join(FIXTURES, 'gates/question-set.other.answer.yml');
const MARKER = { node: 'analysis', request: 'gates/analysis.request.yml', since: '2026-01-05T09:00:00Z' };

const read = file => parse(fs.readFileSync(file, 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));

/** The set the asking node writes: the fixture's questions as a node states them, defaults left to the verb. */
function questionSet() {
  const questions = plain(read(REQUEST).context.checkpoint.questions).map(({ default: _default, ...question }) => question);
  return { questions };
}

function running(t, driver = COCKPIT) {
  const run = scratch(t);
  freeze(run, { orchestrator: driver ? { driver } : {} });
  write(run, { nodes: { analysis: { status: 'running' } } });
  return run;
}

function brief(run, set, form = '--request', node = 'analysis') {
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, typeof set === 'string' ? set : JSON.stringify(set));
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, form, `--patch-file=${file}`]);
}

function refused(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`^${code}: `));
  assert.equal(result.stdout, '');
  return result;
}

/**
 * Suspend on the fixture request, then fold the answer as the driver does: the
 * answer block into the request file, the node back to running and the marker
 * null with editor tools — here, text edits — then the empty patch.
 */
function folded(t, answerFile = ANSWER) {
  const run = running(t);
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.copyFileSync(REQUEST, path.join(run.dir, 'gates/analysis.request.yml'));
  write(run, { orchestrator: { gate_pending: MARKER }, nodes: { analysis: { status: 'suspended' } } });
  const block = fs.readFileSync(answerFile, 'utf8');
  const requestFile = path.join(run.dir, 'gates/analysis.request.yml');
  fs.writeFileSync(requestFile, fs.readFileSync(requestFile, 'utf8').replace(/^answer: null\n$/m, block));
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^( {4}analysis: \{.*?)status: suspended/m, '$1status: running')
    .replace(/^( {2}gate_pending: ).*$/m, '$1null');
  fs.writeFileSync(run.state, text);
  write(run, {});
  return { run, answer: plain(read(answerFile).answer) };
}

// ---------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------

test('request: a question set becomes one kind: question request, the committed fixture as it stands', t => {
  const run = running(t);
  const result = brief(run, questionSet());
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);

  assert.deepEqual(Object.keys(request), ['node', 'kind', 'question', 'context', 'options', 'multi_select', 'questions']);
  assert.equal(request.kind, 'question');
  assert.equal(request.question, request.questions[0].question, 'the top level repeats the first question');
  assert.deepEqual(request.options, request.questions[0].options);
  for (const question of request.questions) assert.deepEqual(Object.keys(question), ['id', 'question', 'options', 'multi_select']);

  const { checkpoint } = request.context;
  assert.equal(checkpoint.version, 1);
  assert.equal(checkpoint.kind, 'question');
  assert.equal(checkpoint.ask, 'Scope analysis: 3 questions to answer');
  assert.equal(checkpoint.headline, 'Answer all 3 to continue scope analysis.');
  assert.deepEqual(checkpoint.questions.map(question => question.default), ['all', undefined, ['timestamp', 'operator']],
    'the default is the recommendation, absent when nothing is recommended');
  assert.deepEqual(checkpoint.questions.map(question => question.allow_other), [true, false, true]);

  // The fixture a cockpit renders from is this output, with the fields the
  // request writer adds and the run's own directory set aside.
  const fixture = plain(read(REQUEST));
  for (const key of ['version', 'asked_at', 'answer']) delete fixture[key];
  delete fixture.context.checkpoint.run;
  delete checkpoint.run;
  assert.deepEqual(request, fixture);
});

test('request: --checkpoint prints the same checkpoint, and the set may name its own ask, headline and triage', t => {
  const run = running(t);
  const set = { ask: 'Two choices the analysis left open', headline: 'Answer both to continue.', questions: questionSet().questions.slice(0, 2) };
  set.questions[0].triage = { mode: 'consult' };
  const result = brief(run, set, '--checkpoint');
  assert.equal(result.code, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.ask, set.ask);
  assert.equal(checkpoint.headline, set.headline);
  assert.deepEqual(checkpoint.questions[0].triage, { mode: 'consult' }, 'triage is reserved and passed through');
  assert.deepEqual(checkpoint.progress, { node: 1, nodes_total: 4 });
});

test('request: each question it carries is one line with no double quote, the checkpoint keeping the node\'s text', t => {
  const run = running(t);
  const set = questionSet();
  set.questions[0].question = 'Which notes does "tag filter" keep?\nAll of them, or only the tagged ones?';
  set.questions[1].question = 'Does "Work" match "work"?';
  const result = brief(run, set);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  // A driver writes each question as a flow scalar, which refuses a line break and a double quote.
  for (const question of [request.question, ...request.questions.map(each => each.question)]) assert.doesNotMatch(question, /[\r\n"]/);
  assert.equal(request.question, "Which notes does 'tag filter' keep? All of them, or only the tagged ones?");
  assert.equal(request.context.checkpoint.questions[0].question, set.questions[0].question);
});

test('request: a gate request carries the multi-choice flag under its contract name', t => {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.' } } });
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--request']);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.equal(request.multi_select, false);
  assert.equal(Object.hasOwn(request, 'multiple'), false);
});

// ---------------------------------------------------------------------------
// what the verb refuses
// ---------------------------------------------------------------------------

test('provoked: gate-brief-questions-invalid names the question and the field', t => {
  const run = running(t);
  const base = questionSet().questions;
  const cases = [
    [{ questions: [] }, /non-empty list/],
    [{ questions: [base[0], { ...base[1], id: base[0].id }] }, /used twice/],
    [{ questions: [{ ...base[0], options: base[0].options.map(option => ({ ...option, recommended: true })) }] }, /recommend one at most/],
    [{ questions: [{ ...base[1], options: [{ id: 'exact' }, base[1].options[1]] }] }, /"label" must be one line/],
    [{ questions: [{ ...base[0], hint: 'x' }] }, /the key "hint"/],
    [{ questions: [{ ...base[0], default: 'none' }] }, /"default" must name one option/],
    [{ questions: [{ ...base[1], options: [{ ...base[1].options[0], id: 'other' }, base[1].options[1]] }] },
      /the id "other" is reserved for an answer in the operator's own words/],
  ];
  for (const [set, reason] of cases) assert.match(refused(brief(run, set), 'gate-brief-questions-invalid').stderr, reason);
});

test('provoked: gate-brief-questions-unsupported without a cockpit that lists question-sets', t => {
  for (const driver of [null, { kind: 'terminal' }, { kind: 'cockpit', cwd: '/work' }, { kind: 'dispatch', cwd: '/work', features: ['question-sets'] }]) {
    const run = running(t, driver);
    assert.match(refused(brief(run, questionSet()), 'gate-brief-questions-unsupported').stderr, /by: default/);
  }
});

test('provoked: gate-brief-not-askable for a node not running, and for a gate', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  refused(brief(run, questionSet()), 'gate-brief-not-askable');
  write(run, { nodes: { analysis: { status: 'completed' } } });
  refused(brief(run, questionSet()), 'gate-brief-not-askable');
  assert.match(refused(brief(run, questionSet(), '--request', 'approval'), 'gate-brief-not-askable').stderr, /is a gate/);
});

test('usage: a question set renders as the checkpoint or the request only', t => {
  const run = running(t);
  for (const form of ['--json', '--oneline']) {
    const result = brief(run, questionSet(), form);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--patch-file only with --request or --checkpoint/);
  }
  assert.equal(brief(run, '{not json', '--request').code, 2);
});

test('usage: a question set asked again takes --patch-file alone, never --reask', t => {
  const run = running(t);
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(questionSet()));
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=analysis', '--request', `--patch-file=${file}`, '--reask=revise-analysis']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--reask or --patch-file, not both/);
  assert.equal(result.stdout, '');
});

test('a task node without a question set is still not a gate, and the message names the set', t => {
  const run = running(t);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=analysis', '--request']);
  assert.match(refused(result, 'gate-brief-not-a-gate').stderr, /question set, sent with --patch-file/);
});

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

test('fold: the answer block becomes one operator decision per question, and the node keeps running', t => {
  const { run, answer } = folded(t);
  let state = readState(run);
  assert.equal(state.orchestrator.gate_pending, null);
  assert.equal(state.workflow.nodes.analysis.status, 'running');

  write(run, { node_summaries: { analysis: { answer } } });
  state = readState(run);
  assert.equal(state.workflow.nodes.analysis.status, 'running', 'the fold never completes the node');
  const summary = state.node_summaries.analysis;
  assert.equal(Object.hasOwn(summary, 'answer'), false, 'the block is folded away, not stored');
  assert.deepEqual(plain(summary.decisions), [
    { decision: 'Match all requested tags', by: 'operator', question_id: 'tag-filter',
      question: "For list({tags: ['work','urgent']}), match all requested tags or any?", answer: 'Match all requested tags',
      recommended: 'Match all requested tags', as_recommended: true, answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' },
    { decision: 'Ignore case', by: 'operator', question_id: 'tag-case', question: 'Should tag matching ignore letter case?',
      answer: 'Ignore case', recommended: null, as_recommended: null, answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' },
    { decision: 'Timestamp, Emoji', by: 'operator', question_id: 'csv-extras', question: 'Which extra columns should the CSV export carry?',
      answer: 'Timestamp, Emoji', recommended: 'Timestamp, Operator', as_recommended: false, answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' },
  ]);
});

test('fold: an answer in the operator\'s own words, and a multi-select in another order, read as given', t => {
  const { run, answer } = folded(t, OTHER);
  assert.equal(answer.option, 'other', 'a first question answered in own words sends option: other');
  write(run, { node_summaries: { analysis: { answer } } });
  const [filter, , extras] = plain(readState(run).node_summaries.analysis.decisions);
  assert.equal(filter.decision, 'Match all by default, any when the caller passes mode: any');
  assert.equal(filter.as_recommended, false);
  assert.equal(extras.answer, 'Operator, Timestamp');
  assert.equal(extras.as_recommended, true, 'the recommended set, in any order, is as recommended');
});

test('fold: the node\'s closing write keeps the answers, and the next gate counts them as the operator\'s', t => {
  const { run, answer } = folded(t);
  write(run, { node_summaries: { analysis: { answer } } });
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { summary: 'Scoped against the three answers.', decisions: [{ decision: 'Filters live in the store', by: 'run' }] } },
  });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.deepEqual(decisions.map(item => item.question_id ?? item.decision), ['tag-filter', 'tag-case', 'csv-extras', 'Filters live in the store']);

  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  const { operator } = JSON.parse(result.stdout).decisions;
  assert.equal(operator.count, 3);
  assert.deepEqual(operator.not_recommended.map(item => item.question), ['Which extra columns should the CSV export carry?']);
});

test('provoked: state-question-answer-invalid leaves the state file byte-identical', t => {
  const { run, answer } = folded(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const cases = [
    [{ ...answer, answers: { ...answer.answers, 'tag-case': 'loose' } }, /its options are exact, folded/],
    [{ ...answer, answers: { ...answer.answers, 'tag-filter': ['all'] } }, /single choice and was answered with a list/],
    [{ ...answer, option: undefined, answers: { 'tag-case': 'exact', 'csv-extras': ['emoji'] } }, /"tag-filter" has no answer/],
    [{ ...answer, answers: { ...answer.answers, 'tag-case': { other: 'sometimes' } } }, /does not take an answer in the operator's own words/],
    [{ ...answer, answers: { ...answer.answers, colour: 'teal' } }, /"colour", which is not a question/],
  ];
  for (const [given, reason] of cases) {
    const result = verb(['write-state', `--state=${run.state}`], { node_summaries: { analysis: { answer: given } } });
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /^state-question-answer-invalid: /);
    assert.match(result.stderr, reason);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  }
  fs.rmSync(path.join(run.dir, 'gates/analysis.request.yml'));
  const missing = verb(['write-state', `--state=${run.state}`], { node_summaries: { analysis: { answer } } });
  assert.match(missing.stderr, /^state-question-answer-invalid: .*does not exist/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
});

// ---------------------------------------------------------------------------
// a set asked again after a revise
// ---------------------------------------------------------------------------

/**
 * Attempt 1 answered and folded, then the node sent back the way `gate-revise`
 * leaves it — `attempt: 2`, running — and the same set asked again and
 * answered with `answerFile`, its block folded in place of the first.
 */
function reasked(t, answerFile = OTHER) {
  const { run, answer: first } = folded(t);
  write(run, { node_summaries: { analysis: { answer: first } } });
  const text = fs.readFileSync(run.state, 'utf8').replace(/^( {4}analysis: \{.*?status: running)/m, '$1, attempt: 2');
  fs.writeFileSync(run.state, text);
  fs.writeFileSync(path.join(run.dir, 'gates/analysis.request.yml'),
    fs.readFileSync(REQUEST, 'utf8').replace(/^answer: null\n$/m, fs.readFileSync(answerFile, 'utf8')));
  return { run, first, answer: plain(read(answerFile).answer) };
}

const QUESTIONS = ['tag-filter', 'tag-case', 'csv-extras'];

test('re-asked: both attempts\' answers stay, the first stamped attempt 1 ahead of the second\'s', t => {
  const { run, answer } = reasked(t);
  assert.equal(Number(readState(run).workflow.nodes.analysis.attempt), 2);
  write(run, { node_summaries: { analysis: { answer } } });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.deepEqual(decisions.map(item => [item.question_id, Number(item.attempt)]),
    [...QUESTIONS.map(id => [id, 1]), ...QUESTIONS.map(id => [id, 2])]);
  assert.deepEqual(decisions.slice(0, 3).map(item => item.answer), ['Match all requested tags', 'Ignore case', 'Timestamp, Emoji']);
  assert.deepEqual(decisions.slice(3).map(item => item.answer),
    ['Match all by default, any when the caller passes mode: any', 'Exact match', 'Operator, Timestamp']);
  assert.deepEqual(decisions.map(item => item.at), [...Array(3).fill('2026-01-05T09:12:00Z'), ...Array(3).fill('2026-01-05T09:14:00Z')]);

  write(run, { node_summaries: { analysis: { answer } } });
  assert.deepEqual(plain(readState(run).node_summaries.analysis.decisions), decisions, 'folding the same answer again changes nothing');
});

test('re-asked: the closing write keeps both attempts, and the gate counts the current one only', t => {
  const { run, answer } = reasked(t);
  write(run, { node_summaries: { analysis: { answer } } });
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { summary: 'Scoped against the second answers.', decisions: [{ decision: 'Filters live in the store', by: 'run' }] } },
  });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.deepEqual(decisions.map(item => item.question_id ?? item.decision),
    [...QUESTIONS, ...QUESTIONS, 'Filters live in the store']);
  assert.deepEqual(decisions.slice(0, 6).map(item => Number(item.attempt)), [1, 1, 1, 2, 2, 2]);

  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  const { operator } = JSON.parse(result.stdout).decisions;
  assert.equal(operator.count, 3, 'an earlier attempt\'s answers are history, not choices');
  assert.deepEqual(operator.not_recommended.map(item => item.answer),
    ['Match all by default, any when the caller passes mode: any'], 'the current answers are the ones weighed');
});

test('re-asked: a closing write that re-sends the current answers replaces only them, keeping their attempt', t => {
  const { run, answer } = reasked(t);
  write(run, { node_summaries: { analysis: { answer } } });
  const held = plain(readState(run).node_summaries.analysis.decisions);
  const resent = held.slice(3).map(({ attempt: _attempt, ...item }) => item);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.', decisions: resent } } });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.deepEqual(decisions.map(item => [item.question_id, Number(item.attempt)]),
    [...QUESTIONS.map(id => [id, 1]), ...QUESTIONS.map(id => [id, 2])]);
});

test('re-asked: a question reworded in the new attempt keeps the earlier answer as history, matched by its id', t => {
  const { run, answer } = reasked(t);
  const requestFile = path.join(run.dir, 'gates/analysis.request.yml');
  fs.writeFileSync(requestFile, fs.readFileSync(requestFile, 'utf8')
    .replaceAll('Should tag matching ignore letter case?', 'Should a tag match regardless of letter case?'));
  write(run, { node_summaries: { analysis: { answer } } });
  const held = plain(readState(run).node_summaries.analysis.decisions);
  const caseAnswers = held.filter(item => item.question_id === 'tag-case');
  assert.deepEqual(caseAnswers.map(item => [item.question, Number(item.attempt)]),
    [['Should tag matching ignore letter case?', 1], ['Should a tag match regardless of letter case?', 2]]);

  const resent = held.slice(3).map(({ attempt: _attempt, ...item }) => item);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.', decisions: resent } } });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.deepEqual(decisions, held, 'the current answers re-sent replace themselves; the earlier attempt stays history');
  assert.deepEqual(readDashboard(run).phases.find(each => each.id === 'analysis').decisions.map(item => item.earlier === true),
    [true, true, true, false, false, false]);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).decisions.operator.count, 3, 'the reworded question is counted once, as answered now');
});

test('re-asked: the dashboard marks the earlier attempt\'s answers as history', t => {
  const { run, answer } = reasked(t);
  write(run, { node_summaries: { analysis: { answer } } });
  const phase = readDashboard(run).phases.find(each => each.id === 'analysis');
  assert.deepEqual(phase.decisions.map(item => item.earlier === true), [true, true, true, false, false, false]);
});

test('re-asked: a first attempt alone stamps nothing', t => {
  const { run, answer } = folded(t);
  write(run, { node_summaries: { analysis: { answer } } });
  const decisions = plain(readState(run).node_summaries.analysis.decisions);
  assert.equal(decisions.some(item => Object.hasOwn(item, 'attempt')), false);
  assert.equal(readDashboard(run).phases.find(each => each.id === 'analysis').decisions.some(item => item.earlier), false);
});

// ---------------------------------------------------------------------------
// without question sets, nothing changes
// ---------------------------------------------------------------------------

test('default path: without the feature a question is recorded by: default, exactly as before', t => {
  const run = running(t, { kind: 'cockpit', cwd: '/work' });
  write(run, { node_summaries: { analysis: { decisions: [{ decision: 'Match all requested tags', by: 'default', question_id: 'tag-filter' }] } } });
  assert.deepEqual(plain(readState(run).node_summaries.analysis.decisions), [{ decision: 'Match all requested tags', by: 'default', question_id: 'tag-filter' }]);
});

test('the shared state reader still reads the driver line when it lists features', t => {
  const run = running(t, { kind: 'dispatch', cwd: '/work', features: ['question-sets'], session: { id: 's-1', provider: 'claude' } });
  const scanned = scanState(fs.readFileSync(run.state, 'utf8'));
  assert.equal(scanned.driverKind, 'dispatch');
  assert.equal(scanned.driverSession, 's-1');
});
