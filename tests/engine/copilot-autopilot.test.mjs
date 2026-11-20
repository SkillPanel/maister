import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, OPERATOR, ENGINE, freeze, freezePatch, reach, readState, run, scratch, variantRoot } from '../helpers.mjs';
import { outstandingHeld } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';

// Under Copilot CLI's autopilot the question tool answers "The user is not
// available to respond …" and the session then picks an option itself. The
// Copilot build's after-question hook leaves a note beside the run's state
// saying who answered the last question; the engine must not record a pick made
// after a "nobody there" note as a person's answer.

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');
const NOTE = '.ask.result.json';

/** The Copilot build's engine, which reads its host as `copilot`. */
const variantEngine = () => path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');

/** Leave the note the after-question hook writes: who answered the last question. */
function note(runDir, outcome, questions = ['decision']) {
  fs.writeFileSync(path.join(runDir, NOTE), `${JSON.stringify({ outcome, at: new Date().toISOString(), questions })}\n`);
}

/** A run of the review loop with its review done, the checkpoint next. */
function atCheckpoint(t) {
  const runDir = scratch(t);
  freeze(runDir, { definition: REVISE });
  reach(runDir, { nodes: { review: { status: 'completed' } } });
  return runDir;
}

const CONTINUE = { nodes: { 'review-approval': { status: 'completed' } }, node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft' }] } } };

test('autopilot (variant): a checkpoint answered after the question tool found nobody there is refused, and nothing is written', t => {
  const runDir = atCheckpoint(t);
  note(runDir.dir, 'host');
  const result = run(variantEngine(), ['write-state', `--state=${runDir.state}`], CONTINUE);
  assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /state-answer-needs-person/);
  assert.equal(readState(runDir).workflow.nodes['review-approval'].status, 'pending');
  assert.equal(fs.existsSync(path.join(runDir.dir, NOTE)), true, 'a refusal never clears the note');
});

test('autopilot (variant): an in-step answer made after the question tool found nobody there is the run\'s, by the host', t => {
  const runDir = scratch(t);
  freeze(runDir);
  note(runDir.dir, 'host', ['scope']);
  const result = run(variantEngine(), ['write-state', `--state=${runDir.state}`], {
    node_summaries: { analysis: { decisions: [{ decision: 'Narrow', by: 'operator', question_id: 'scope', question: 'Widen the scope?', answer: 'Narrow', answered_by: OPERATOR }] } },
  });
  assert.equal(result.code, 0, result.stderr);
  const [stored] = readState(runDir).node_summaries.analysis.decisions;
  assert.equal(stored.by, 'run');
  assert.deepEqual(stored.actor, { kind: 'host', id: 'copilot' });
  assert.equal(Object.hasOwn(stored, 'answered_by'), false, 'no person is named for a host answer');
});

test('autopilot: a person\'s answer in the Copilot build, and every answer in the Claude Code build, is recorded as today', t => {
  const person = atCheckpoint(t);
  note(person.dir, 'person');
  const answered = run(variantEngine(), ['write-state', `--state=${person.state}`], CONTINUE);
  assert.equal(answered.code, 0, answered.stderr);
  const [kept] = readState(person).node_summaries['review-approval'].decisions;
  assert.deepEqual([kept.by, kept.answered_by, kept.via, kept.actor], ['operator', OPERATOR, 'terminal', { kind: 'person', id: OPERATOR }]);

  const claude = atCheckpoint(t);
  note(claude.dir, 'host');
  const source = run(ENGINE, ['write-state', `--state=${claude.state}`], CONTINUE);
  assert.equal(source.code, 0, source.stderr);
  assert.equal(readState(claude).node_summaries['review-approval'].decisions[0].by, 'operator');
});

// ---------------------------------------------------------------------------
// the checkpoint guard: what counts as a person's answer, and what retires it
// ---------------------------------------------------------------------------

const USED = '.ask.result.used.json';
const NEEDS_PERSON = 'state-answer-needs-person';
const OPTIONAL_STEP = path.join(FIXTURES, 'definitions/optional-step.yml');
const HELD_CLOSING = path.join(FIXTURES, 'definitions/held-closing.yml');
const DISPATCH = { kind: 'dispatch', cwd: '/work' };
const APPROVE_TRIAGE = { version: 1, class: 'approve', family: 'area-family' };

/** A note with every field the hook may write, `fields` laid over a person's. */
function noteWith(runDir, fields) {
  fs.writeFileSync(path.join(runDir, NOTE), `${JSON.stringify({ outcome: 'person', at: new Date().toISOString(), questions: ['decision'], ...fields })}\n`);
}

const writeVia = (engine, runDir, patch) => run(engine, ['write-state', `--state=${runDir.state}`], patch);

/** Accepted through `engine`, or the test fails with the writer's own words. */
function wrote(engine, runDir, patch) {
  const result = writeVia(engine, runDir, patch);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** Refused for want of a person's answer: nothing written, the note where it was. */
function needsPerson(result, runDir, before, label) {
  assert.equal(result.code, 1, `${label}: expected a refusal, got exit ${result.code}: ${result.stdout}${result.stderr}`);
  assert.match(result.stderr, new RegExp(`^${NEEDS_PERSON}: `, 'm'), label);
  assert.equal(fs.readFileSync(runDir.state, 'utf8'), before, `${label}: a refusal leaves the state file byte-identical`);
  assert.equal(fs.existsSync(path.join(runDir.dir, NOTE)), true, `${label}: a refusal never retires the note`);
}

/** A checkpoint answer with `option` at the review loop's gate. */
const answering = option => ({ nodes: { 'review-approval': { status: 'completed' } }, node_summaries: { 'review-approval': { decisions: [{ option }] } } });

/**
 * A copy of the Copilot build carrying the questions policy, so a dispatched
 * run can hold a choice for approval; removed when the test ends.
 */
function variantWithPolicy(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-variant-policy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(variantRoot(), root, { recursive: true });
  const file = path.join(root, 'skills/workflow-engine/policy/autonomy-policy.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'policy/questions.json'), file);
  return path.join(root, 'skills/workflow-engine/scripts/workflow.mjs');
}

/**
 * `held-closing`, dispatched, with one choice held in `choosing` and the
 * closing node running, then handed to the terminal: the closing checkpoint is
 * the run's question.
 */
function heldAtClose(t, engine) {
  const runDir = scratch(t);
  wrote(engine, runDir, freezePatch({ definition: HELD_CLOSING, orchestrator: { options: { ceiling: 'advice' }, driver: DISPATCH } }).patch);
  wrote(engine, runDir, { nodes: { outline: { status: 'running' } } });
  wrote(engine, runDir, { nodes: { outline: { status: 'completed' } }, node_summaries: { outline: { summary: 'Outlined the work.' } } });
  wrote(engine, runDir, { nodes: { 'outline-approval': { status: 'completed' } }, node_summaries: { 'outline-approval': { decisions: [{ option: 'continue-past-outline' }] } } });
  wrote(engine, runDir, { nodes: { choosing: { status: 'running' } } });
  const options = [{ id: 'a', label: 'Choice A', recommended: true }, { id: 'b', label: 'Choice B' }];
  wrote(engine, runDir, { node_summaries: { choosing: { question_set: { questions: [{ id: 'choosing-choice', question: 'Which finish?', options, triage: APPROVE_TRIAGE }] } } } });
  wrote(engine, runDir, { nodes: { choosing: { status: 'completed', values: { wants_audit: false } }, audit: { status: 'skipped' } }, node_summaries: { choosing: { summary: 'Chose the finish.' } } });
  wrote(engine, runDir, { nodes: { tidy: { status: 'running' } } });
  wrote(engine, runDir, { nodes: { tidy: { status: 'completed' }, closing: { status: 'running' } }, node_summaries: { tidy: { summary: 'Tidied up.' } } });
  wrote(engine, runDir, { orchestrator: { driver: { kind: 'terminal' } } });
  assert.equal(outstandingHeld(readState(runDir)).length, 1, 'one choice is held for approval');
  return runDir;
}

test('autopilot (variant): every way past a checkpoint without a person\'s answer is refused, and a gate off the path is still skipped', t => {
  const cases = [
    ['the flat answer form', { nodes: { 'review-approval': { status: 'completed' } }, node_summaries: { 'review-approval': { answer: 'publish-draft' } } }, /this write records an answer at review-approval, but the question tool returned no person's answer/],
    ['the stop option', answering('abandon'), /records an answer at review-approval/],
    ['the gate completed with no answer', { nodes: { 'review-approval': { status: 'completed' } } }, /records an answer at review-approval/],
    ['the gate recorded skipped on the path', { nodes: { 'review-approval': { status: 'skipped' } } }, /records review-approval skipped while it is still on the run's path.*never skip a checkpoint the run has to ask/s],
  ];
  for (const [label, patch, wording] of cases) {
    const runDir = atCheckpoint(t);
    note(runDir.dir, 'host');
    const before = fs.readFileSync(runDir.state, 'utf8');
    const result = writeVia(variantEngine(), runDir, patch);
    needsPerson(result, runDir, before, label);
    assert.match(result.stderr, wording, label);
    assert.match(result.stderr, /A person must answer this checkpoint\. Nothing was written\./, label);
  }

  // The closing checkpoint's continue approves nothing, and the choice stays held.
  const engine = variantWithPolicy(t);
  const held = heldAtClose(t, engine);
  note(held.dir, 'host');
  const before = fs.readFileSync(held.state, 'utf8');
  const closing = writeVia(engine, held, { nodes: { 'held-approval': { status: 'completed' } }, node_summaries: { 'held-approval': { decisions: [{ option: 'continue' }] } } });
  needsPerson(closing, held, before, 'the held-approval continue');
  assert.match(closing.stderr, /records an answer at held-approval/);
  assert.equal(outstandingHeld(readState(held)).length, 1, 'the choice is still held');

  // A gate whose guard is false is off the path: its skip lands as today.
  const optional = scratch(t);
  freeze(optional, { definition: OPTIONAL_STEP });
  reach(optional, { nodes: { specification: { status: 'completed' } } });
  wrote(variantEngine(), optional, { nodes: { 'specification-approval': { status: 'completed' } }, node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-planning' }] } } });
  note(optional.dir, 'host');
  wrote(variantEngine(), optional, { nodes: { audit: { status: 'skipped' }, 'audit-approval': { status: 'skipped' } } });
  assert.equal(readState(optional).workflow.nodes['audit-approval'].status, 'skipped');
});

test('autopilot (variant): a person\'s note covers only the checkpoint answer it chose, unless the person typed their own', t => {
  const covered = atCheckpoint(t);
  noteWith(covered.dir, { answers: 'publish-draft' });
  wrote(variantEngine(), covered, answering('publish-draft'));
  assert.equal(readState(covered).node_summaries['review-approval'].decisions[0].by, 'operator');

  const cases = [
    ['another option than the one chosen', { answers: 'publish-draft' }, 'abandon'],
    ['a note from an in-step question', { questions: ['scope'] }, 'publish-draft'],
    ['a bound note', { bound: true }, 'publish-draft'],
    ['a note that nobody answered', { outcome: 'none' }, 'publish-draft'],
  ];
  for (const [label, fields, option] of cases) {
    const runDir = atCheckpoint(t);
    noteWith(runDir.dir, fields);
    const before = fs.readFileSync(runDir.state, 'utf8');
    needsPerson(writeVia(variantEngine(), runDir, answering(option)), runDir, before, label);
  }

  // The person's own words, mapped by the session onto an option, cover either.
  for (const option of ['publish-draft', 'abandon']) {
    const typed = atCheckpoint(t);
    noteWith(typed.dir, { answers: 'Ship it once the intro is shorter', typed: ['decision'] });
    wrote(variantEngine(), typed, answering(option));
    assert.equal(readState(typed).node_summaries['review-approval'].decisions[0].option, option);
  }
});

test('autopilot (variant): a person\'s note is used up by the write that relies on it and by the next printed question; a send-back without one is refused', t => {
  const used = atCheckpoint(t);
  noteWith(used.dir, { answers: 'publish-draft' });
  wrote(variantEngine(), used, answering('publish-draft'));
  assert.equal(fs.existsSync(path.join(used.dir, NOTE)), false, 'the write that used the note retires it');
  assert.equal(fs.existsSync(path.join(used.dir, USED)), true);
  wrote(variantEngine(), used, { nodes: { 'side-note': { status: 'completed' }, publish: { status: 'completed' } } });
  const before = fs.readFileSync(used.state, 'utf8');
  const next = writeVia(variantEngine(), used, { nodes: { 'final-approval': { status: 'completed' } }, node_summaries: { 'final-approval': { decisions: [{ option: 'close' }] } } });
  assert.equal(next.code, 1, next.stderr);
  assert.match(next.stderr, new RegExp(`^${NEEDS_PERSON}: `, 'm'), 'only a retired note is left: the next checkpoint needs its own answer');
  assert.equal(fs.readFileSync(used.state, 'utf8'), before);

  const printed = atCheckpoint(t);
  wrote(variantEngine(), printed, { node_summaries: { review: { summary: 'Reviewed the draft.' } } });
  noteWith(printed.dir, {});
  const brief = run(variantEngine(), ['gate-brief', `--state=${printed.state}`, '--node=review-approval', '--ask']);
  assert.equal(brief.code, 0, brief.stderr);
  assert.equal(fs.existsSync(path.join(printed.dir, NOTE)), false, 'printing the next question retires the note');
  assert.equal(fs.existsSync(path.join(printed.dir, USED)), true);
  assert.equal(fs.existsSync(path.join(printed.dir, '.ask.json')), true);

  const revised = atCheckpoint(t);
  note(revised.dir, 'host');
  const unrevised = fs.readFileSync(revised.state, 'utf8');
  const result = run(variantEngine(), ['gate-revise', `--state=${revised.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  needsPerson(result, revised, unrevised, 'gate-revise');
  assert.equal(readState(revised).workflow.nodes.draft.status, 'completed', 'no stretch is reset');
});

test('autopilot (variant): with no note of either kind, or under a cockpit, an answer is recorded as today', t => {
  const bare = atCheckpoint(t);
  wrote(variantEngine(), bare, answering('publish-draft'));
  const [kept] = readState(bare).node_summaries['review-approval'].decisions;
  assert.deepEqual([kept.by, kept.answered_by, kept.via, kept.actor], ['operator', OPERATOR, 'terminal', { kind: 'person', id: OPERATOR }]);

  const driven = () => {
    const runDir = scratch(t);
    freeze(runDir, { definition: REVISE, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
    reach(runDir, { nodes: { review: { status: 'completed' } } });
    return runDir;
  };
  const copilot = driven();
  note(copilot.dir, 'host');
  const viaVariant = writeVia(variantEngine(), copilot, answering('publish-draft'));
  const claude = driven();
  const viaSource = writeVia(ENGINE, claude, answering('publish-draft'));
  assert.equal(viaVariant.code, viaSource.code, viaVariant.stderr);
  assert.deepEqual(readState(copilot).node_summaries['review-approval'], readState(claude).node_summaries['review-approval']);
  assert.equal(fs.existsSync(path.join(copilot.dir, NOTE)), true, 'a driven run never reads or retires a note');
});

test('the recovery row: writing-state.md tells a session what to do when a write needs a person\'s answer', () => {
  const text = fs.readFileSync(path.join(ENGINE_DIR, 'references/writing-state.md'), 'utf8');
  const section = text.slice(text.indexOf('## When a write is refused'), text.indexOf('## When `run-complete` refuses'));
  const row = section.split('\n').find(line => line.startsWith(`| \`${NEEDS_PERSON}\` |`));
  assert.ok(row, 'the row is in the refusal table');
  assert.ok(row.length > 160, `the row says enough to recover: ${row.length} characters`);
});

// ---------------------------------------------------------------------------
// in-step answers nobody gave: credited to the host, unless the policy wants a person
// ---------------------------------------------------------------------------

const IN_NODE = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const HOST = { kind: 'host', id: 'copilot' };

/** The `analysis` step's answers as the run holds them. */
const stepAnswers = (runDir, node = 'analysis') => readState(runDir).node_summaries[node].decisions;

/** Is `item` the host's pick: by the run, the Copilot host acting, no person named? */
function isHostPick(item, label) {
  assert.equal(item.by, 'run', label);
  assert.deepEqual(item.actor, HOST, label);
  for (const key of ['answered_by', 'via', 'on_behalf_of']) assert.equal(Object.hasOwn(item, key), false, `${label}: no ${key}`);
}

test('autopilot (variant): an in-step pick nobody answered is the host\'s whatever it was sent with, and a re-sent answer keeps who gave it', t => {
  const sent = { decision: 'Narrow', by: 'operator', question_id: 'scope', question: 'Widen the scope?', answer: 'Narrow', recommended: 'Wide',
    answered_by: OPERATOR, via: 'terminal', actor: { kind: 'person', id: OPERATOR }, on_behalf_of: 'Someone Else' };
  for (const outcome of ['host', 'none']) {
    const runDir = scratch(t);
    freeze(runDir);
    note(runDir.dir, outcome, ['scope']);
    wrote(variantEngine(), runDir, { node_summaries: { analysis: { decisions: [sent] } } });
    const [stored] = stepAnswers(runDir);
    isHostPick(stored, `a ${outcome} note`);
    assert.deepEqual([stored.question_id, stored.question, stored.answer, stored.recommended, stored.as_recommended], ['scope', 'Widen the scope?', 'Narrow', 'Wide', false]);

    // The host's pick sent again in the person's shape, under a person's note, stays the host's.
    noteWith(runDir.dir, { questions: ['scope'] });
    wrote(variantEngine(), runDir, { node_summaries: { analysis: { decisions: [{ decision: 'Narrow', by: 'operator', question_id: 'scope', question: 'Widen the scope?', answer: 'Narrow' }] } } });
    const again = stepAnswers(runDir);
    assert.equal(again.length, 1, 'the re-sent pick replaces itself');
    isHostPick(again[0], `the host's pick re-sent after a ${outcome} note`);
  }

  // A person's answer from an earlier attempt, sent again under a host note, stays the person's.
  const earlier = scratch(t);
  freeze(earlier);
  const asked = { by: 'operator', question_id: 'scope', question: 'Widen the scope?' };
  wrote(variantEngine(), earlier, { node_summaries: { analysis: { decisions: [{ ...asked, decision: 'Narrow', answer: 'Narrow', attempt: 1 }, { ...asked, decision: 'Wide', answer: 'Wide', attempt: 2 }] } } });
  note(earlier.dir, 'host', ['scope']);
  wrote(variantEngine(), earlier, { node_summaries: { analysis: { decisions: [{ ...asked, decision: 'Narrow', answer: 'Narrow', attempt: 1 }] } } });
  const first = stepAnswers(earlier).find(item => Number(item.attempt) === 1);
  assert.deepEqual([first.by, first.answered_by, first.actor], ['operator', OPERATOR, { kind: 'person', id: OPERATOR }]);
  assert.equal(stepAnswers(earlier).find(item => Number(item.attempt) === 2).by, 'operator');
});

test('autopilot (variant): in a run that classes questions, an approval-class pick nobody answered is refused, and so is any after the policy changed', t => {
  const engine = variantWithPolicy(t);
  const runDir = scratch(t);
  wrote(engine, runDir, freezePatch({ definition: IN_NODE, orchestrator: { options: { ceiling: 'advice' } } }).patch);
  wrote(engine, runDir, { nodes: { scoping: { status: 'running' } } });
  assert.equal(readState(runDir).orchestrator.classes_questions, true);
  const pick = id => ({ node_summaries: { scoping: { decisions: [{ decision: 'Option A', by: 'operator', question_id: id, question: `Which ${id}?`, answer: 'Option A' }] } } });

  note(runDir.dir, 'host', ['signed-choice']);
  let before = fs.readFileSync(runDir.state, 'utf8');
  const signed = writeVia(engine, runDir, pick('signed-choice'));
  needsPerson(signed, runDir, before, 'an approval-class question');
  assert.match(signed.stderr, /this write records an answer to signed-choice, which the run's policy classes for approval, but the question tool returned no person's answer/);
  assert.match(signed.stderr, /A person must answer this question\. Nothing was written\. Stop here: name the question,/);

  // A question the policy does not class for approval is the host's.
  wrote(engine, runDir, pick('other-choice'));
  isHostPick(stepAnswers(runDir, 'scoping').find(item => item.question_id === 'other-choice'), 'an unclassed question');

  // Under another policy than the freeze's, the class cannot be read: only a person's answer lands.
  before = fs.readFileSync(runDir.state, 'utf8');
  const drifted = writeVia(variantEngine(), runDir, pick('quick-choice'));
  needsPerson(drifted, runDir, before, 'a policy hash mismatch');
  assert.match(drifted.stderr, /records an answer to quick-choice, which the run's policy classes for approval/);
  noteWith(runDir.dir, { questions: ['quick-choice'] });
  wrote(variantEngine(), runDir, pick('quick-choice'));
  assert.equal(stepAnswers(runDir, 'scoping').find(item => item.question_id === 'quick-choice').by, 'operator');
});

test('autopilot (variant): the host\'s picks are history, kept by a later write that leaves them out and re-sent with their round', t => {
  const runDir = scratch(t);
  freeze(runDir);
  note(runDir.dir, 'host', ['scope', 'depth']);
  const scope = { question_id: 'scope', question: 'Widen the scope?', answer: 'Narrow' };
  wrote(variantEngine(), runDir, { node_summaries: { analysis: { decisions: [{ ...scope, decision: 'Narrow', by: 'operator', round: 2 }] } } });
  wrote(variantEngine(), runDir, { node_summaries: { analysis: { decisions: [{ decision: 'Shallow', by: 'operator', question_id: 'depth', question: 'How deep?', answer: 'Shallow' }] } } });
  const kept = stepAnswers(runDir);
  assert.deepEqual(kept.map(item => item.question_id), ['scope', 'depth'], 'a later write keeps the host\'s earlier pick');
  for (const item of kept) isHostPick(item, item.question_id);

  // The host's pick re-sent as recorded but without its round keeps the round.
  wrote(variantEngine(), runDir, { node_summaries: { analysis: { decisions: [{ ...scope, decision: 'Narrow', by: 'run', actor: HOST }] } } });
  const scopes = stepAnswers(runDir).filter(item => item.question_id === 'scope');
  assert.equal(scopes.length, 1);
  assert.equal(Number(scopes[0].round), 2);
});

test('autopilot: the Claude Code build never reads a note, so an in-step answer sent under a host note stays the person\'s', t => {
  const runDir = scratch(t);
  freeze(runDir);
  note(runDir.dir, 'host', ['scope']);
  const sent = { decision: 'Narrow', by: 'operator', question_id: 'scope', question: 'Widen the scope?', answer: 'Narrow' };
  wrote(ENGINE, runDir, { node_summaries: { analysis: { decisions: [sent] } } });
  const [stored] = stepAnswers(runDir);
  assert.deepEqual([stored.by, stored.answered_by, stored.actor], ['operator', OPERATOR, { kind: 'person', id: OPERATOR }]);
  assert.equal(fs.existsSync(path.join(runDir.dir, NOTE)), true, 'the source build leaves the note alone');
});
