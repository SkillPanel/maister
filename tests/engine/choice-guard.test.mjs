import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES, ROOT, freezePatch, readState, run as runScript, scratch, sharedPlugin } from '../helpers.mjs';
import { CHOICE_WORDS, choiceWorded, classSet, inNodeClarifications, raiseTriage } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';
import { QUESTION_TRIAGE, TRIAGE_CLASSES, TRIAGE_RAISED_BY } from '../../plugins/maister/skills/workflow-engine/scripts/lib/interface-shapes.mjs';
import { CLASSES, RAISED_BY } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';

// A clarification whose answer is a choice — "how should …", "which … should …",
// one whose options would change what the product does or who may do it — must
// reach a person at every ask level: it is never classed as a fact and settled
// by the run. Each test below is one path by which such a question could reach
// the record class the autonomy ceiling settles, and shows it is asked instead,
// with a fact-worded control that still settles where the path is the policy's
// own. The second half shows a question left to ask keeps the triage it was
// classed under, on the node's summary and on the answer a person gives it.
//
// The policy is the in-node fixture's, with `scope-choice` reading a consult
// family first and a record one lower, `review-wanted` and `drafting-tone`
// reading a record family first, and the record family as the unknown one.
// `scoping` declares two ids, so an id extending neither reads as the unknown
// family; `drafting` declares one, so every id it asks reads as that one.

const policyOf = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy', name), 'utf8'));
const base = policyOf('questions.json');
const rows = [
  { workflow: 'in-node-questions', id: 'scope-choice', kind: 'question', families: ['asked-family', 'noted-family'] },
  { workflow: 'in-node-questions', id: 'review-wanted', kind: 'question', families: ['noted-family'] },
  { workflow: 'in-node-questions', id: 'drafting-tone', kind: 'question', families: ['noted-family'] },
];
const GUARD_POLICY = { ...base, unknown_family: 'noted-family', table: [...base.table, ...rows] };
const GUARD = sharedPlugin({ policy: GUARD_POLICY });
// The same rows, and no unknown family: an unlisted id is classed by nothing.
const { unknown_family: _unknown, ...bare } = GUARD_POLICY;
const BARE = sharedPlugin({ policy: bare });

const DEFINITION = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const REVISE = path.join(FIXTURES, 'definitions/revise.yml');
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const LEVELS = ['approve', 'advice', 'decide'];

const CHOICE = 'How should a group row compute its average and level distribution?';
const FACT = 'Which existing setting is the Hidden mode?';
const AGREE = { verdict: 'agree', reason: 'No option changes what the product does.' };
const RAISE = { verdict: 'raise', reason: 'Option B changes who may see levels.' };

function send(engine, run, patch) {
  return runScript(engine, ['write-state', `--state=${run.state}`], patch);
}

function ok(engine, run, patch) {
  const result = send(engine, run, patch);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

function started(t, engine, { ceiling = 'advice', driver = null, definition = DEFINITION, node = 'scoping' } = {}) {
  const run = scratch(t);
  const orchestrator = { options: { ceiling } };
  if (driver) orchestrator.driver = driver;
  ok(engine, run, freezePatch({ definition, orchestrator }).patch);
  ok(engine, run, { nodes: { [node]: { status: 'running' } } });
  return run;
}

function question(id, text, extra = {}) {
  return {
    id,
    question: text,
    options: [
      { id: 'a', label: 'Option A', description: 'The first reading.', recommended: true },
      { id: 'b', label: 'Option B', description: 'The second reading.' },
    ],
    ...extra,
  };
}

const summaryOf = (run, node = 'scoping') => readState(run).node_summaries?.[node] ?? {};
const byId = (decisions, id) => (decisions ?? []).find(item => item.question_id === id);

function askLine(stdout) {
  const tail = stdout.split('\n\n')[1];
  assert.ok(tail !== undefined, `no ask: line in ${JSON.stringify(stdout)}`);
  return tail.trim();
}

/** One question classed at `node`: what the writer printed and recorded for it. */
function classOne(t, engine, asked, { ceiling, node = 'scoping', driver = null, run } = {}) {
  const at = run ?? started(t, engine, { ceiling, node, driver });
  const result = ok(engine, at, { node_summaries: { [node]: { question_set: { questions: [asked] } } } });
  const summary = summaryOf(at, node);
  return { run: at, result, ask: askLine(result.stdout), item: byId(summary.decisions, asked.id), summary };
}

/** The question reaches a person: left to ask, settled by nobody. */
function reachesPerson(classed, id) {
  assert.equal(classed.ask, `ask: ${id}`, classed.result.stderr);
  assert.equal(classed.item, undefined, 'nothing settled or defaulted for it');
}

/** The question is settled by the run, as a fact. */
function settledByRun(classed, id) {
  assert.equal(classed.ask, 'ask: none', classed.result.stderr);
  assert.equal(classed.item?.by, 'run');
  assert.equal(classed.item.question_id, id);
}

// ---------------------------------------------------------------------------
// The wording test
// ---------------------------------------------------------------------------

test('choiceWorded reads the question text for the choice words, as whole words, in any case', () => {
  assert.deepEqual(CHOICE_WORDS, ['should', 'shall', 'ought', 'who may', 'who can']);
  for (const text of [CHOICE, 'Which supervisor SHOULD the grouping use?', 'Who may see levels?', 'Who  can edit it?', 'Shall we keep it?']) {
    assert.equal(choiceWorded({ question: text }), true, text);
  }
  for (const text of [FACT, 'Which file shoulders the config?', 'Whose tags are stored?', 'Which mayor is listed?']) {
    assert.equal(choiceWorded({ question: text }), false, text);
  }
  assert.equal(choiceWorded({}), false);
});

// ---------------------------------------------------------------------------
// Part 1: every path, at every ask level
// ---------------------------------------------------------------------------

test('path 1: a lower fact family the reader agreed to is refused for a choice-worded question', t => {
  for (const ceiling of LEVELS) {
    const asked = question('scope-choice', CHOICE, { family: 'noted-family', reader: AGREE });
    const classed = classOne(t, GUARD.engine, asked, { ceiling });
    reachesPerson(classed, 'scope-choice');
    assert.match(classed.result.stderr, /^note: node_summaries\.scoping: classed scope-choice under asked-family, not the proposed noted-family: the question is worded as a choice, which is never a fact$/m);
    assert.deepEqual(classed.summary.asked_triage['scope-choice'],
      { version: 1, class: 'consult', family: 'asked-family', proposed: 'noted-family', reader: AGREE });
  }
  // Control: worded as a fact, the agreed lowering stands and the run settles it at advice.
  settledByRun(classOne(t, GUARD.engine, question('scope-choice', FACT, { family: 'noted-family', reader: AGREE }), { ceiling: 'advice' }), 'scope-choice');
});

test('path 2: a lower fact family proposed with no reader keeps the first family, and the question is asked', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('scope-choice', FACT, { family: 'noted-family' }), { ceiling });
    reachesPerson(classed, 'scope-choice');
    assert.equal(classed.summary.asked_triage['scope-choice'].family, 'asked-family');
  }
});

test('path 3: a lower fact family the reader raised keeps the first family, and the question is asked', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('scope-choice', FACT, { family: 'noted-family', reader: RAISE }), { ceiling });
    reachesPerson(classed, 'scope-choice');
    assert.deepEqual(classed.summary.asked_triage['scope-choice'].reader, RAISE);
  }
});

test('path 4: the reader\'s raise with no lowering proposed lifts a fact-first row to consult, never ignored', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('review-wanted', FACT, { reader: RAISE }), { ceiling });
    reachesPerson(classed, 'review-wanted');
    assert.doesNotMatch(classed.result.stderr, /ignored the reader's verdict/);
    assert.deepEqual(classed.summary.asked_triage['review-wanted'],
      { version: 1, class: 'consult', family: 'noted-family', raised_by: 'reader', reader: RAISE });
  }
  // An agreement with nothing to lower changes nothing, and says so.
  const agreed = classOne(t, GUARD.engine, question('review-wanted', FACT, { reader: AGREE }), { ceiling: 'advice' });
  settledByRun(agreed, 'review-wanted');
  assert.match(agreed.result.stderr, /^note: node_summaries\.scoping: the reader's agreement on review-wanted changed nothing: /m);
  assert.deepEqual(agreed.item.triage.reader, AGREE);
});

test('path 5: a fact-first row with no reader dispatched: a choice-worded question is lifted to consult', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('review-wanted', CHOICE), { ceiling });
    reachesPerson(classed, 'review-wanted');
    assert.deepEqual(classed.summary.asked_triage['review-wanted'],
      { version: 1, class: 'consult', family: 'noted-family', raised_by: 'wording' });
  }
  settledByRun(classOne(t, GUARD.engine, question('review-wanted', FACT), { ceiling: 'advice' }), 'review-wanted');
});

test('path 6: a fact family as the policy\'s unknown family: a choice-worded clarification is lifted to consult', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('clarify-grouping', CHOICE), { ceiling });
    reachesPerson(classed, 'clarify-grouping');
    assert.equal(classed.summary.asked_triage['clarify-grouping'].raised_by, 'wording');
  }
  settledByRun(classOne(t, GUARD.engine, question('clarify-grouping', FACT), { ceiling: 'decide' }), 'clarify-grouping');
});

test('path 7: an id read as the node\'s only declared one, a fact row of another kind: a choice is lifted to consult', t => {
  for (const ceiling of LEVELS) {
    const classed = classOne(t, GUARD.engine, question('clarify-supervisor', 'Which supervisor should the grouping use?'), { ceiling, node: 'drafting' });
    reachesPerson(classed, 'clarify-supervisor');
    assert.deepEqual(classed.summary.asked_triage['clarify-supervisor'],
      { version: 1, class: 'consult', family: 'noted-family', raised_by: 'wording' });
  }
  settledByRun(classOne(t, GUARD.engine, question('clarify-supervisor', FACT), { ceiling: 'advice', node: 'drafting' }), 'clarify-supervisor');
});

test('path 8: a carried fact triage on a question nothing classes is set aside: it is asked, never settled', t => {
  for (const ceiling of LEVELS) {
    const carried = question('clarify-grouping', FACT, { triage: { version: 1, class: 'record' } });
    const classed = classOne(t, BARE.engine, carried, { ceiling });
    reachesPerson(classed, 'clarify-grouping');
    assert.equal(Object.hasOwn(classed.summary, 'asked_triage'), false, 'unclassed: no triage to keep');
  }
  // A carried consult one still counts on its own: asked here, defaulted unadvised where nobody can be asked.
  const consult = question('clarify-grouping', FACT, { triage: { version: 1, class: 'consult' } });
  assert.deepEqual(classOne(t, BARE.engine, consult, { ceiling: 'advice' }).summary.asked_triage['clarify-grouping'], { version: 1, class: 'consult' });
  // A carried floor id still reads as the approval class.
  const floored = question('clarify-grouping', FACT, { triage: { version: 1, class: 'record', floor: ['floor-a'] } });
  assert.deepEqual(classOne(t, BARE.engine, floored, { ceiling: 'advice' }).summary.asked_triage['clarify-grouping'],
    { version: 1, class: 'approve', floor: ['floor-a'] });
});

test('path 9: a carried lower triage never lowers a choice: the wording\'s consult stands', t => {
  for (const ceiling of LEVELS) {
    const carried = question('review-wanted', CHOICE, { triage: { version: 1, class: 'decide-alone' } });
    reachesPerson(classOne(t, GUARD.engine, carried, { ceiling }), 'review-wanted');
  }
});

test('path 10: frozen under one policy, classed under another: nothing is classed, and the question is asked', t => {
  for (const ceiling of LEVELS) {
    const run = started(t, GUARD.engine, { ceiling });
    const result = send(BARE.engine, run, { node_summaries: { scoping: { question_set: { questions: [question('review-wanted', CHOICE)] } } } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(askLine(result.stdout), 'ask: review-wanted');
    assert.match(result.stderr, /^warning: policy-hash-mismatch:scoping$/m);
    assert.equal(summaryOf(run).decisions, undefined);
  }
});

test('path 11: the run answering a question the writer left to ask is dropped with a note; a person\'s answer is kept', t => {
  for (const ceiling of LEVELS) {
    const { run } = classOne(t, GUARD.engine, question('review-wanted', CHOICE), { ceiling });
    const own = { decision: 'Option A', by: 'run', question_id: 'review-wanted', question: CHOICE };
    const dropped = ok(GUARD.engine, run, { node_summaries: { scoping: { decisions: [own] } } });
    assert.match(dropped.stderr, /^note: ignored the run decision node_summaries\.scoping sent for review-wanted; the writer left that question to ask, so a person answers it$/m);
    assert.equal(byId(summaryOf(run).decisions, 'review-wanted'), undefined);

    const answer = { decision: 'Option B', by: 'operator', question_id: 'review-wanted', question: CHOICE, answer: 'Option B', recommended: 'Option A' };
    ok(GUARD.engine, run, { node_summaries: { scoping: { decisions: [answer] } } });
    assert.equal(byId(summaryOf(run).decisions, 'review-wanted').by, 'operator');
  }
});

// ---------------------------------------------------------------------------
// Part 2: a question left to ask keeps what it was classed under
// ---------------------------------------------------------------------------

const ASKED_TRIAGE = { version: 1, class: 'consult', family: 'asked-family', proposed: 'noted-family', reader: AGREE };

test('asked in session: the summary keeps the triage, and the person\'s answer carries it; a re-send keeps it silently', t => {
  const { run, summary } = classOne(t, GUARD.engine, question('scope-choice', CHOICE, { family: 'noted-family', reader: AGREE }), { ceiling: 'advice' });
  assert.deepEqual(summary.asking, ['scope-choice']);
  assert.deepEqual(summary.asked_triage, { 'scope-choice': ASKED_TRIAGE });

  const answer = { decision: 'Option B', by: 'operator', question_id: 'scope-choice', question: CHOICE, answer: 'Option B', recommended: 'Option A' };
  const answered = ok(GUARD.engine, run, { node_summaries: { scoping: { decisions: [answer] } } });
  assert.equal(answered.stderr, '');
  const recorded = byId(summaryOf(run).decisions, 'scope-choice');
  assert.equal(recorded.by, 'operator');
  assert.deepEqual(recorded.triage, ASKED_TRIAGE, 'what was proposed, what the reader said and what was applied');

  // The closing write re-sends the answer as recorded, triage and all: nothing is noted and nothing changes.
  const held = summaryOf(run).decisions;
  const resent = ok(GUARD.engine, run, { node_summaries: { scoping: { summary: 'Scoped.', decisions: held } } });
  assert.equal(resent.stderr, '');
  assert.deepEqual(summaryOf(run).decisions, held);

  // A patch never sets the writer's keys.
  const sent = ok(GUARD.engine, run, { node_summaries: { scoping: { asked_triage: { 'scope-choice': { version: 1, class: 'record' } } } } });
  assert.match(sent.stderr, /^note: ignored the supplied node_summaries\.scoping\.asked_triage; the writer records it from the question set it classed, so no patch sets it$/m);
  assert.deepEqual(summaryOf(run).asked_triage, { 'scope-choice': ASKED_TRIAGE });
});

test('a follow-up round adds its ids to the triage an earlier round left', t => {
  const { run } = classOne(t, GUARD.engine, question('scope-choice', CHOICE), { ceiling: 'advice' });
  classOne(t, GUARD.engine, question('review-wanted', CHOICE), { run });
  assert.deepEqual(Object.keys(summaryOf(run).asked_triage), ['scope-choice', 'review-wanted']);
  assert.deepEqual(summaryOf(run).asking, ['review-wanted']);
});

test('driven: the folded answer to a lowered question still asked carries the triage it was classed under', t => {
  const { run } = classOne(t, GUARD.engine, question('scope-choice', CHOICE, { family: 'noted-family', reader: AGREE }), { ceiling: 'advice', driver: COCKPIT });
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'gates/scoping.request.yml'), [
    'version: 1', 'node: scoping', 'kind: question', `question: "${CHOICE}"`, 'questions:',
    '  - id: scope-choice', `    question: "${CHOICE}"`, '    multi_select: false', '    options:',
    '      - {id: a, label: "Option A", effect: continue, recommended: true}',
    '      - {id: b, label: "Option B", effect: continue}', '',
  ].join('\n'));
  const answer = { option: 'b', answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' };
  const fold = ok(GUARD.engine, run, { node_summaries: { scoping: { answer } } });
  assert.equal(fold.stderr, '');
  const recorded = byId(summaryOf(run).decisions, 'scope-choice');
  assert.equal(recorded.by, 'operator');
  assert.equal(recorded.decision, 'Option B');
  assert.deepEqual(recorded.triage, ASKED_TRIAGE);
});

test('a revise reset clears the triage kept for the questions left to ask, with the remainder', t => {
  const run = started(t, GUARD.engine, { definition: REVISE, node: 'draft' });
  classOne(t, GUARD.engine, question('layout-choice', CHOICE), { run, node: 'draft' });
  assert.deepEqual(Object.keys(summaryOf(run, 'draft').asked_triage), ['layout-choice']);
  const answer = { decision: 'Option B', by: 'operator', question_id: 'layout-choice', question: CHOICE };
  ok(GUARD.engine, run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } } },
    node_summaries: { draft: { summary: 'Drafted.', decisions: [answer] } },
  });
  assert.equal(byId(summaryOf(run, 'draft').decisions, 'layout-choice').triage.raised_by, 'wording');
  ok(GUARD.engine, run, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  ok(GUARD.engine, run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } });

  const revised = runScript(GUARD.engine, ['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(revised.code, 0, revised.stderr);
  const after = summaryOf(run, 'draft');
  assert.equal(Object.hasOwn(after, 'asking'), false);
  assert.equal(Object.hasOwn(after, 'asked_triage'), false);
  assert.equal(byId(after.decisions, 'layout-choice').by, 'operator', 'the person\'s answer stays as history, its triage with it');
});

test('every key a classed triage carries is declared in the interface\'s question triage', () => {
  const policy = GUARD_POLICY;
  // As the set check leaves them: the recommended option named as the default.
  const questions = [
    question('scope-choice', CHOICE, { family: 'noted-family', reader: AGREE }),
    question('review-wanted', FACT, { reader: RAISE }),
    question('drafting-tone', FACT, { triage: { version: 1, class: 'approve', floor: ['floor-a'] } }),
    question('clarify-grouping', FACT),
  ].map(each => ({ ...each, default: 'a' }));
  const triages = [];
  for (const [settles, canAsk] of [['record', true], ['record', false], [null, false]]) {
    const classed = classSet({ questions, policy, workflow: 'in-node-questions', declaredIds: ['scope-choice', 'review-wanted'], settles, canAsk, attempt: 1 });
    triages.push(...classed.items.map(item => item.triage), ...Object.values(classed.askedTriage));
  }
  const seen = new Set(triages.flatMap(triage => Object.keys(triage)));
  for (const key of seen) assert.ok(Object.hasOwn(QUESTION_TRIAGE, key), `${key} is not declared`);
  for (const triage of triages) {
    if (triage.raised_by !== undefined) assert.ok(QUESTION_TRIAGE.raised_by.values.includes(triage.raised_by));
    assert.ok(QUESTION_TRIAGE.class.values.includes(triage.class));
  }
  for (const key of ['reader', 'proposed', 'raised_by', 'advice', 'held', 'floor']) assert.ok(seen.has(key), `${key} never produced`);
  // The policy's own names are the declared ones.
  assert.deepEqual(Object.values(RAISED_BY), TRIAGE_RAISED_BY);
  assert.deepEqual(CLASSES, TRIAGE_CLASSES);
});

// ---------------------------------------------------------------------------
// A clarification settles as a fact only with the reader's agreement
// ---------------------------------------------------------------------------

// The in-node fixture with its prose marking `review-wanted` a clarification;
// `drafting-tone`, a routine fact question, stays unmarked. Both read a record
// family first, so the run would settle either at advice.
let MARKED = null;
before(() => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-clarification-')));
  MARKED = path.join(dir, 'in-node-questions.yml');
  fs.copyFileSync(DEFINITION, MARKED);
  const prose = fs.readFileSync(DEFINITION.replace(/\.yml$/, '.md'), 'utf8')
    .replace('**With question sets** (`review-wanted`)', '**With question sets** (clarification, `review-wanted`)');
  fs.writeFileSync(MARKED.replace(/\.yml$/, '.md'), prose);
});
after(() => {
  if (MARKED) fs.rmSync(path.dirname(MARKED), { recursive: true, force: true });
});

const DISPATCH = { kind: 'dispatch', cwd: '/work' };
const markedRun = (t, extra = {}) => started(t, GUARD.engine, { definition: MARKED, ...extra });

test('the clarification mark is the word ahead of the id on a question-set line, read from either line', () => {
  const prose = [
    '## `asking`', '',
    '**With question sets** (clarification, `first-id`): asked.', '',
    '**Without question sets** (`first-id`): none.', '',
    '**With question sets** (`second-id`): asked.', '',
    '**Without question sets** (a clarification, `second-id`): none.', '',
    '**With question sets** (`clarifications`): the id alone marks nothing.', '',
  ].join('\n');
  assert.deepEqual(inNodeClarifications(prose), [{ node: 'asking', id: 'first-id' }, { node: 'asking', id: 'second-id' }]);
  const builtIns = Object.fromEntries(['development', 'migration', 'performance', 'research', 'product-design'].map(name => [name,
    inNodeClarifications(fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/workflow-engine/workflows', `${name}.md`), 'utf8')).map(each => each.id)]));
  assert.deepEqual(builtIns, {
    development: ['clarifications'],
    migration: ['clarifications'],
    performance: ['clarifications'],
    research: ['question-clarification', 'design-constraints'],
    'product-design': ['scope-questions'],
  });
});

test('a clarification the run would settle with no reader verdict is asked; with agree it settles; a raise asks it', t => {
  for (const ceiling of ['advice', 'decide']) {
    const silent = classOne(t, GUARD.engine, question('review-wanted', FACT), { run: markedRun(t, { ceiling }) });
    reachesPerson(silent, 'review-wanted');
    assert.match(silent.result.stderr, /^note: node_summaries\.scoping: did not settle review-wanted: a clarification is settled as a fact only with the reader's agreement, and no verdict was sent$/m);
    assert.deepEqual(silent.summary.asked_triage['review-wanted'], { version: 1, class: 'record', family: 'noted-family' });

    const agreed = classOne(t, GUARD.engine, question('review-wanted', FACT, { reader: AGREE }), { run: markedRun(t, { ceiling }) });
    settledByRun(agreed, 'review-wanted');
    assert.doesNotMatch(agreed.result.stderr, /changed nothing/, 'a clarification\'s agreement is what lets it settle');
    assert.deepEqual(agreed.item.triage, { version: 1, class: 'record', family: 'noted-family', reader: AGREE });

    reachesPerson(classOne(t, GUARD.engine, question('review-wanted', FACT, { reader: RAISE }), { run: markedRun(t, { ceiling }) }), 'review-wanted');
  }
  // A per-area slug of the marked id is a clarification too.
  reachesPerson(classOne(t, GUARD.engine, question('review-wanted-storage', FACT), { run: markedRun(t) }), 'review-wanted-storage');
});

test('a routine fact question its prose does not mark settles as before, reader or none', t => {
  const run = markedRun(t, { node: 'drafting' });
  settledByRun(classOne(t, GUARD.engine, question('drafting-tone', FACT), { run, node: 'drafting' }), 'drafting-tone');
  // The same id unmarked, in the fixture as shipped.
  settledByRun(classOne(t, GUARD.engine, question('review-wanted', FACT), { ceiling: 'advice' }), 'review-wanted');
});

test('nobody to ask: a clarification with no verdict takes its default by default, never by the run', t => {
  const classed = classOne(t, GUARD.engine, question('review-wanted', FACT), { run: markedRun(t, { driver: DISPATCH }) });
  assert.equal(classed.item.by, 'default');
  assert.equal(classed.item.decision, 'Option A');
  const agreed = classOne(t, GUARD.engine, question('review-wanted', FACT, { reader: AGREE }), { run: markedRun(t, { driver: DISPATCH }) });
  assert.equal(agreed.item.by, 'run');
});

test('a clarification read under a routine decide-alone family needs the agreement too; an unmarked one does not', () => {
  const policy = { ...GUARD_POLICY, table: [...GUARD_POLICY.table, { workflow: 'in-node-questions', id: 'quick-clarify', kind: 'question', families: ['quick-family'] }] };
  const one = (asked, clarificationIds) => classSet({
    questions: [{ ...asked, default: 'a' }], policy, workflow: 'in-node-questions', declaredIds: ['quick-clarify', 'other'],
    clarificationIds, settles: 'decide-alone', canAsk: true, attempt: 1,
  });
  assert.deepEqual(one(question('quick-clarify', FACT), ['quick-clarify']).asking, ['quick-clarify']);
  assert.equal(one(question('quick-clarify', FACT, { reader: AGREE }), ['quick-clarify']).items[0].by, 'run');
  assert.equal(one(question('quick-clarify', FACT), []).items[0].by, 'run');
});

test('the brief tells the node to dispatch the reader for each clarification the run could settle', t => {
  const brief = run => runScript(GUARD.engine, ['node-brief', `--state=${run.state}`, '--node=scoping']);
  const line = /^reader \(review-wanted\): a clarification is settled as a fact only with the verdict of maister:question-reader, model haiku, effort high \(source: shipped agents\.question-reader, tier light\) — dispatch it for each question of the set the run may settle, copy its verdict on as reader, and send none you could not get: the question is then asked$/m;
  for (const ceiling of ['advice', 'decide']) {
    const result = brief(markedRun(t, { ceiling }));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, line);
    assert.doesNotMatch(result.stdout, /^reader \(scope-choice\)/m, 'an unmarked id prints no reader line');
  }
  // At approve the run settles no fact family, so there is nothing to dispatch for.
  assert.doesNotMatch(brief(markedRun(t, { ceiling: 'approve' })).stdout, /^reader \(/m);
  // Unmarked prose prints none either.
  assert.doesNotMatch(brief(started(t, GUARD.engine)).stdout, /^reader \(/m);
});

test('a carried floor id merged onto a computed triage raises its class to approve, as a floor does elsewhere', t => {
  assert.deepEqual(raiseTriage({ version: 1, class: 'record', family: 'noted-family' }, { version: 1, class: 'record', floor: ['floor-a'] }),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'noted-family', raised_by: 'floor' });
  // Through the writer: a fact question carrying a floor id is never settled; asked here, held where nobody can be asked.
  const floored = { triage: { version: 1, class: 'record', floor: ['floor-a'] } };
  const asked = classOne(t, GUARD.engine, question('drafting-tone', FACT, floored), { ceiling: 'advice', node: 'drafting' });
  reachesPerson(asked, 'drafting-tone');
  assert.deepEqual(asked.summary.asked_triage['drafting-tone'], { version: 1, class: 'approve', floor: ['floor-a'], family: 'noted-family', raised_by: 'floor' });
  const held = classOne(t, GUARD.engine, question('drafting-tone', FACT, floored), { ceiling: 'decide', node: 'drafting', driver: DISPATCH });
  assert.equal(held.item.by, 'default');
  assert.equal(held.item.triage.held, true);
});
