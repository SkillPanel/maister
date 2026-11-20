import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES } from '../helpers.mjs';
import { ceilingOf, effectiveCeiling, loadPolicy, narrowerLevel, questionFamilies, questionOutcome, triageFor } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';
import { checkSet, questionCheckpoint } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';
import { canAsk } from '../../plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs';
import { REVISION_CEILING } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';
import {
  HELD_APPROVAL,
  NO_CHOICE,
  approvalsOf,
  classSet,
  classesQuestions,
  declaredQuestionIds,
  heldApprovalOptions,
  inNodeQuestions,
  outstandingHeld,
  raiseTriage,
} from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';

// The pure core of in-node classing: the autonomy ceiling a run reads, the
// outcome rule over class, ceiling and driver, the raise-only merge of a
// carried triage, and the readers of held items and their approvals. Every
// policy here is made up.

const POLICIES = path.join(FIXTURES, 'policy');
const policyOf = name => loadPolicy({ path: path.join(POLICIES, name) });

/** The drivers, with whether a person can be asked under each. */
const DRIVERS = {
  terminal: { orchestrator: { driver: { kind: 'terminal' } } },
  'cockpit-sets': { orchestrator: { driver: { kind: 'cockpit', cwd: '/work', features: ['question-sets'] } } },
  dispatch: { orchestrator: { driver: { kind: 'dispatch', cwd: '/work' } } },
  'cockpit-bare': { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } },
};

/** The five classes, each as the question id that reads it in `questions.json`. */
const CLASS_IDS = {
  'decide-alone': 'quick-choice',
  record: 'noted-choice',
  consult: 'asked-choice',
  approve: 'signed-choice',
  'floor-approve': 'guarded-choice',
};

/**
 * R2, written out by hand: per class and autonomy ceiling, the outcome under
 * terminal, cockpit with question sets, dispatch and cockpit without them.
 */
const ASKABLE_OR_DEFAULT = ['ask', 'ask', 'default', 'default'];
const SETTLED = ['settle', 'settle', 'settle', 'settle'];
const ASKABLE_OR_HELD = ['ask', 'ask', 'hold', 'hold'];
const EXPECTED = {
  'decide-alone': { none: ASKABLE_OR_DEFAULT, approve: SETTLED, advice: SETTLED, decide: SETTLED },
  record: { none: ASKABLE_OR_DEFAULT, approve: ASKABLE_OR_DEFAULT, advice: SETTLED, decide: SETTLED },
  consult: { none: ASKABLE_OR_DEFAULT, approve: ASKABLE_OR_DEFAULT, advice: ASKABLE_OR_DEFAULT, decide: ASKABLE_OR_DEFAULT },
  approve: { none: ASKABLE_OR_HELD, approve: ASKABLE_OR_HELD, advice: ASKABLE_OR_HELD, decide: ASKABLE_OR_HELD },
  'floor-approve': { none: ASKABLE_OR_HELD, approve: ASKABLE_OR_HELD, advice: ASKABLE_OR_HELD, decide: ASKABLE_OR_HELD },
};

test('the outcome rule over every class, autonomy ceiling and driver matches R2', () => {
  const { policy } = policyOf('questions.json');
  let cases = 0;
  for (const [name, id] of Object.entries(CLASS_IDS)) {
    const triage = triageFor({ policy, workflow: 'in-node-questions', kind: 'question', id });
    if (name === 'floor-approve') {
      assert.equal(triage.class, 'approve');
      assert.equal(triage.raised_by, 'floor');
    } else {
      assert.equal(triage.class, name);
    }
    for (const level of ['none', 'approve', 'advice', 'decide']) {
      const ceiling = ceilingOf({ options: level === 'none' ? {} : { ceiling: level }, policy });
      const settles = ceiling === null ? null : ceiling.settles;
      Object.values(DRIVERS).forEach((doc, index) => {
        const result = questionOutcome({ triage, settles, canAsk: canAsk(doc) });
        const want = EXPECTED[name][level][index];
        const label = `${name} / ${level} / ${Object.keys(DRIVERS)[index]}`;
        assert.equal(result.outcome, want, label);
        if (want === 'hold') assert.deepEqual(result.triage, { ...triage, held: true }, label);
        else if (want === 'default' && name === 'consult') assert.deepEqual(result.triage, { ...triage, advice: 'not_obtained' }, label);
        else assert.deepEqual(result.triage, triage, label);
        cases += 1;
      });
    }
  }
  assert.equal(cases, 80);
  // An unclassed question keeps today's transport and gains no triage.
  for (const doc of Object.values(DRIVERS)) {
    assert.deepEqual(questionOutcome({ triage: null, settles: 'record', canAsk: canAsk(doc) }), { outcome: 'unclassed', triage: null });
  }
  // The rule never mutates the triage it is given.
  const triage = { version: 1, class: 'approve', family: 'signed-family' };
  questionOutcome({ triage, settles: null, canAsk: false });
  assert.equal('held' in triage, false);

  // canAsk: a missing or terminal driver, or a cockpit with question sets.
  assert.equal(canAsk({}), true);
  assert.equal(canAsk({ orchestrator: {} }), true);
  assert.equal(canAsk(DRIVERS.terminal), true);
  assert.equal(canAsk(DRIVERS['cockpit-sets']), true);
  assert.equal(canAsk(DRIVERS.dispatch), false);
  assert.equal(canAsk(DRIVERS['cockpit-bare']), false);
  assert.equal(canAsk({ orchestrator: { driver: { kind: 'pager', features: ['question-sets'] } } }), false);
  assert.equal(canAsk({ orchestrator: { driver: { kind: 'dispatch', features: ['question-sets'] } } }), false);
});

test('ceilingOf reads the level, caps settling at record and reads an undefined level as settling nothing', () => {
  const { policy } = policyOf('questions.json');
  assert.deepEqual(ceilingOf({ options: { ceiling: 'approve' }, policy }), { level: 'approve', settles: 'decide-alone' });
  assert.deepEqual(ceilingOf({ options: { ceiling: 'advice' }, policy }), { level: 'advice', settles: 'record' });
  // `decide` names consult; the run settles at most record.
  assert.deepEqual(ceilingOf({ options: { ceiling: 'decide' }, policy }), { level: 'decide', settles: 'record' });
  // An unknown value reads as approve.
  assert.deepEqual(ceilingOf({ options: { ceiling: 'everything' }, policy }), { level: 'approve', settles: 'decide-alone' });
  // No ceiling at all, and nothing to fall back on.
  assert.equal(ceilingOf({ options: {}, policy }), null);
  assert.equal(ceilingOf({ options: undefined, policy }), null);
  assert.equal(ceilingOf({ options: { ceiling: '' }, policy }), null);
  assert.equal(ceilingOf({ options: { ceiling: 'advice' }, policy: { version: 1 } }).settles, null);

  const defaulted = policyOf('questions-default-ceiling.json').policy;
  assert.deepEqual(ceilingOf({ options: {}, policy: defaulted }), { level: 'advice', settles: 'record' });
  assert.deepEqual(ceilingOf({ options: { ceiling: 'approve' }, policy: defaulted }), { level: 'approve', settles: 'decide-alone' });

  const partial = policyOf('questions-partial-ceilings.json').policy;
  assert.deepEqual(ceilingOf({ options: { ceiling: 'advice' }, policy: partial }), { level: 'advice', settles: null });
});

test('effectiveCeiling and narrowerLevel order approve < advice < decide, an unknown value reading as approve', () => {
  assert.equal(narrowerLevel('approve', 'advice'), 'approve');
  assert.equal(narrowerLevel('decide', 'advice'), 'advice');
  assert.equal(narrowerLevel('decide', 'decide'), 'decide');
  assert.equal(narrowerLevel('everything', 'decide'), 'approve');
  assert.equal(narrowerLevel('advice', 7), 'approve');
  // An absent side bounds nothing.
  assert.equal(narrowerLevel(null, 'advice'), 'advice');
  assert.equal(narrowerLevel('decide', undefined), 'decide');
  assert.equal(narrowerLevel(null, null), null);

  const loaded = policyOf('questions-default-ceiling.json');
  const matching = { policy_hash: loaded.hash };
  assert.equal(effectiveCeiling({ orchestrator: { ...matching, options: { ceiling: 'decide' } }, policy: loaded.policy, policyHash: loaded.hash }), 'decide');
  assert.equal(effectiveCeiling({ orchestrator: { ...matching, options: { ceiling: 'odd' } }, policy: loaded.policy, policyHash: loaded.hash }), 'approve');
  assert.equal(effectiveCeiling({ orchestrator: matching, policy: loaded.policy, policyHash: loaded.hash }), 'advice');
  // The policy's default counts only when the run applied that policy.
  assert.equal(effectiveCeiling({ orchestrator: { policy_hash: 'sha256:other' }, policy: loaded.policy, policyHash: loaded.hash }), null);
  const plain = policyOf('questions.json');
  assert.equal(effectiveCeiling({ orchestrator: { policy_hash: plain.hash }, policy: plain.policy, policyHash: plain.hash }), null);
  assert.equal(effectiveCeiling({ orchestrator: undefined, policy: plain.policy, policyHash: plain.hash }), null);
});

test('raiseTriage keeps the higher class, unions the floor and ignores another version', () => {
  const computed = { version: 1, class: 'record', family: 'noted-family' };
  const lower = { version: 1, class: 'decide-alone', family: 'quick-family', floor: ['floor-b'] };
  const higher = { version: 1, class: 'approve', family: 'signed-family', floor: ['floor-b'], band: 'toss-up', held: true };
  const equal = { version: 1, class: 'record', family: 'other-family' };

  assert.deepEqual(raiseTriage(computed, lower), { version: 1, class: 'record', floor: ['floor-b'], family: 'noted-family' });
  // A carried winner brings its class and floor only: the family and every other key stay the computed ones.
  assert.deepEqual(raiseTriage(computed, higher), { version: 1, class: 'approve', floor: ['floor-b'], family: 'noted-family' });
  assert.deepEqual(raiseTriage(computed, equal), computed);
  assert.deepEqual(raiseTriage({ ...computed, floor: ['floor-a'] }, higher), { version: 1, class: 'approve', floor: ['floor-a', 'floor-b'], family: 'noted-family' });
  // The recorded keys keep their order: the floor sits after the class, the proposal after the family.
  const proposed = { version: 1, class: 'record', family: 'noted-family', proposed: 'quick-family', reader: { verdict: 'raise', reason: 'Why.' } };
  assert.deepEqual(Object.keys(raiseTriage(proposed, higher)), ['version', 'class', 'floor', 'family', 'proposed', 'reader']);
  // With no computed triage, a carried version-1 one keeps only its version, class and floor.
  assert.deepEqual(raiseTriage(null, higher), { version: 1, class: 'approve', floor: ['floor-b'] });
  assert.deepEqual(raiseTriage(null, equal), { version: 1, class: 'record' });
  assert.deepEqual(raiseTriage(computed, null), computed);
  assert.equal(raiseTriage(null, null), null);
  assert.deepEqual(raiseTriage(computed, { ...higher, version: 2 }), computed);
  assert.equal(raiseTriage(null, { ...higher, version: 2 }), null);
  // Neither side is changed.
  assert.deepEqual(computed, { version: 1, class: 'record', family: 'noted-family' });
  assert.deepEqual(higher, { version: 1, class: 'approve', family: 'signed-family', floor: ['floor-b'], band: 'toss-up', held: true });
});

test('a carried triage raises the class but never records its own family or band', () => {
  const { policy } = policyOf('questions.json');
  const carried = { version: 1, class: 'approve', family: 'never-listed', band: 'clear' };
  const question = {
    id: 'noted-choice', question: 'Which?', default: 'a', triage: carried,
    options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }],
  };
  const classed = classSet({ questions: [question], policy, workflow: 'in-node-questions', declaredIds: [], settles: 'record', canAsk: false });
  assert.deepEqual(classed.faults, []);
  const [item] = classed.items;
  // The carried class raises: approve, held with nobody to ask.
  assert.equal(item.triage.class, 'approve');
  assert.equal(item.triage.held, true);
  // The family recorded is the one the policy gave the question, never the carried name.
  assert.equal(item.triage.family, 'noted-family');
  assert.equal(Object.hasOwn(item.triage, 'band'), false);
});

test('classesQuestions and classSet', () => {
  const { policy } = policyOf('questions.json');
  assert.equal(classesQuestions(policy, 'in-node-questions'), true);
  assert.equal(classesQuestions(policy, 'anything'), true, 'an unknown_family classes every question');
  const { unknown_family: _, ...rowsOnly } = policy;
  assert.equal(classesQuestions(rowsOnly, 'held-closing'), true);
  assert.equal(classesQuestions(rowsOnly, 'anything'), false);
  assert.equal(classesQuestions({ ...rowsOnly, table: [{ workflow: 'anything', id: 'a-gate', kind: 'gate', families: ['quick-family'] }] }, 'anything'), false);
  assert.equal(classesQuestions({ version: 1 }, 'in-node-questions'), false);

  // classSet: one item per settled, defaulted or held question; the rest still to ask.
  const option = (id, extra = {}) => ({ id, label: `Label ${id}`, description: `Why ${id}.`, ...extra });
  const question = id => ({ id, question: `Pick\n${id}?`, options: [option('a', { recommended: true }), option('b')], default: 'a' });
  const set = ['quick-choice', 'noted-choice', 'asked-choice', 'signed-choice', 'loose-choice'].map(question);
  set[4].triage = { version: 1, class: 'decide-alone', family: 'quick-family' };
  const reasons = { 'noted-choice': { rationale: 'Kept it small.', assumption: 'One user.', reversal: 'Swap the option.' } };
  const common = { questions: set, reasons, policy, workflow: 'in-node-questions', declaredIds: [], settles: 'record', attempt: 2 };
  const dispatched = classSet({ ...common, canAsk: false });
  assert.deepEqual(dispatched.faults, []);
  assert.deepEqual(dispatched.asking, []);
  assert.deepEqual(dispatched.items.map(each => [each.question_id, each.by, each.triage.class, each.triage.held ?? null, each.triage.advice ?? null]), [
    ['quick-choice', 'run', 'decide-alone', null, null],
    ['noted-choice', 'run', 'record', null, null],
    ['asked-choice', 'default', 'consult', null, 'not_obtained'],
    ['signed-choice', 'default', 'approve', true, null],
    // The unknown family reads consult; the carried decide-alone cannot lower it.
    ['loose-choice', 'default', 'consult', null, 'not_obtained'],
  ]);
  const noted = dispatched.items[1];
  assert.deepEqual(noted, { decision: 'Label a', by: 'run', question_id: 'noted-choice', question: 'Pick noted-choice?', rationale: 'Kept it small.', assumption: 'One user.', reversal: 'Swap the option.', triage: noted.triage, attempt: 2 });
  assert.equal(dispatched.items[0].rationale, 'Why a.');
  assert.equal('rationale' in dispatched.items[3], false);
  assert.deepEqual(classSet({ ...common, canAsk: true }).asking, ['asked-choice', 'signed-choice', 'loose-choice']);
  const refused = classSet({ ...common, canAsk: true, reasons: { stray: {}, 'quick-choice': { mood: 'x' } }, questions: [{ ...set[0], default: undefined }] });
  assert.equal(refused.items.length, 0);
  assert.equal(refused.faults.length, 2, 'a question with no default is no fault');

  // No default: a question that would settle, default or be asked is left to ask; one that would be held is held with no choice.
  const bare = set.map(each => ({ ...each, default: undefined }));
  const open = classSet({ ...common, questions: bare, canAsk: false });
  assert.deepEqual(open.faults, []);
  assert.deepEqual(open.asking, ['quick-choice', 'noted-choice', 'asked-choice', 'loose-choice']);
  assert.deepEqual(open.items.map(each => [each.question_id, each.decision, each.no_choice, each.triage.held]), [['signed-choice', NO_CHOICE, true, true]]);
  assert.deepEqual(classSet({ ...common, questions: bare, canAsk: true }).asking, bare.map(each => each.id));
});

test('classSet takes a proposed family only when the row lists it, and a lower one only with the reader\'s agreement', () => {
  const base = policyOf('questions.json').policy;
  // `mixed-choice` reads record first; consult is stricter, decide-alone looser.
  const policy = {
    ...base,
    table: [...base.table, { workflow: 'in-node-questions', id: 'mixed-choice', kind: 'question', families: ['noted-family', 'asked-family', 'quick-family'] }],
  };
  const option = (id, extra = {}) => ({ id, label: `Label ${id}`, ...extra });
  const question = (id, family) => ({
    id, question: `Which ${id}?`, options: [option('a', { recommended: true }), option('b')], default: 'a',
    ...(family === undefined ? {} : { family }),
  });
  const common = { policy, workflow: 'in-node-questions', declaredIds: ['mixed-choice'], settles: 'record', canAsk: true };
  const one = family => classSet({ ...common, questions: [question('mixed-choice', family)] });
  const familyOf = result => result.items[0]?.triage.family ?? null;

  // A listed, stricter proposal is used: consult is asked, never settled.
  const stricter = one('asked-family');
  assert.deepEqual(stricter.asking, ['mixed-choice']);
  assert.deepEqual(stricter.notes, []);
  assert.equal(triageFor({ ...common, kind: 'question', id: 'mixed-choice', family: 'asked-family' }).family, 'asked-family');

  // An unlisted proposal falls back to the first family, with a note.
  const unlisted = one('signed-family');
  assert.equal(familyOf(unlisted), 'noted-family');
  assert.equal(unlisted.items[0].by, 'run');
  assert.equal(unlisted.notes.length, 1);
  assert.match(unlisted.notes[0], /^classed mixed-choice under noted-family, not the proposed signed-family: /);

  // A looser proposal the row lists is ignored too: a proposal only raises.
  const looser = one('quick-family');
  assert.equal(familyOf(looser), 'noted-family');
  assert.equal(looser.items[0].triage.class, 'record');
  assert.match(looser.notes[0], /^classed mixed-choice under noted-family, not the proposed quick-family: /);

  // No proposal: the first family, as before, and no note.
  const none = one(undefined);
  assert.equal(familyOf(none), 'noted-family');
  assert.deepEqual(none.notes, []);

  // Two questions under one declared id class differently by their proposals.
  const pair = classSet({ ...common, questions: [question('mixed-choice-scope', 'asked-family'), question('mixed-choice-tone')] });
  assert.deepEqual(pair.asking, ['mixed-choice-scope']);
  assert.deepEqual(pair.items.map(each => [each.question_id, each.by, each.triage.family, each.triage.class]), [
    ['mixed-choice-tone', 'run', 'noted-family', 'record'],
  ]);

  // The families a node may propose for the id, in row order: the first, the stricter ones, and the
  // lower ones marked, since a lower family needs the reader's agreement.
  assert.deepEqual(questionFamilies({ policy, workflow: 'in-node-questions', id: 'mixed-choice-scope', declaredIds: ['mixed-choice'] }), [
    { name: 'noted-family', description: 'Settled and recorded.' },
    { name: 'asked-family', description: 'Worth a second opinion.' },
    { name: 'quick-family', description: 'Settled alone.', lower: true },
  ]);
  assert.deepEqual(questionFamilies({ policy, workflow: 'in-node-questions', id: 'no-row' }), []);
});

/**
 * `questions.json` with two more rows: `mixed-choice` reads record first, lists consult as
 * stricter and decide-alone as lower; `guarded-mix` reads a floored family first, with a lower
 * one after it.
 */
function mixedPolicy() {
  const base = policyOf('questions.json').policy;
  return {
    ...base,
    table: [
      ...base.table,
      { workflow: 'in-node-questions', id: 'mixed-choice', kind: 'question', families: ['noted-family', 'asked-family', 'quick-family'] },
      { workflow: 'in-node-questions', id: 'guarded-mix', kind: 'question', families: ['guarded-family', 'quick-family'] },
    ],
  };
}

const DECLARED = ['mixed-choice', 'guarded-mix', 'loose-choice'];
const AGREE = { verdict: 'agree', reason: 'No answer changes what the product does.' };
const RAISE = { verdict: 'raise', reason: 'Changes who may publish.' };
const proposal = (id, family, reader, extra = {}) => ({
  id, question: `Which ${id}?`, options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }], default: 'a',
  ...(family === undefined ? {} : { family }),
  ...(reader === undefined ? {} : { reader }),
  ...extra,
});
const notTaken = (id, applied, proposed, reason) => `classed ${id} under ${applied}, not the proposed ${proposed}: ${reason}`;
const ignoredVerdict = id => `ignored the reader's verdict on ${id}: it counts only with a proposed family below the first the policy lists for the question`;

test('classSet lowers a listed family only with the reader\'s agreement, and notes every reason it did not', () => {
  const policy = mixedPolicy();
  const one = (question, extra = {}) => classSet({ policy, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: false, questions: [question], ...extra });
  const shape = result => result.items.map(item => [item.by, item.triage.family, item.triage.class, item.triage.proposed ?? null, item.triage.reader ?? null]);

  // A lower family with `agree` is taken: settled under its own class, the proposal and verdict recorded.
  const agreed = one(proposal('mixed-choice', 'quick-family', AGREE));
  assert.deepEqual(shape(agreed), [['run', 'quick-family', 'decide-alone', 'quick-family', AGREE]]);
  assert.deepEqual(agreed.notes, []);

  // `raise`: the first family stands, the verdict is recorded and the note quotes the reader's reason.
  const raised = one(proposal('mixed-choice', 'quick-family', RAISE));
  assert.deepEqual(shape(raised), [['run', 'noted-family', 'record', 'quick-family', RAISE]]);
  assert.deepEqual(raised.notes, [notTaken('mixed-choice', 'noted-family', 'quick-family', 'the reader raised it: "Changes who may publish."')]);

  // No verdict: the first family stands, and nothing of a reader is recorded.
  const silent = one(proposal('mixed-choice', 'quick-family'));
  assert.deepEqual(shape(silent), [['run', 'noted-family', 'record', 'quick-family', null]]);
  assert.deepEqual(silent.notes, [notTaken('mixed-choice', 'noted-family', 'quick-family', 'no verdict sent, and a lower family needs the reader\'s agreement')]);

  // A floored first family is never lowered, even with `agree`; the verdict came with a lowering, so it is recorded.
  const floored = one(proposal('guarded-mix', 'quick-family', AGREE));
  assert.deepEqual(shape(floored), [['default', 'guarded-family', 'approve', 'quick-family', AGREE]]);
  assert.equal(floored.items[0].triage.held, true);
  assert.deepEqual(floored.notes, [notTaken('guarded-mix', 'guarded-family', 'quick-family', 'the first family carries a floor')]);

  // A question with no row reads the unknown family, which a proposal never moves.
  const unknown = one(proposal('loose-choice', 'quick-family'));
  assert.deepEqual(shape(unknown), [['default', 'fallback-family', 'consult', 'quick-family', null]]);
  assert.deepEqual(unknown.notes, [notTaken('loose-choice', 'fallback-family', 'quick-family', 'no policy row for the question')]);
});

test('classSet ignores a verdict sent with no lowering proposal, with a note after the proposal\'s own', () => {
  const policy = mixedPolicy();
  const one = question => classSet({ policy, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: false, questions: [question] });

  // An equal proposal with a verdict: taken, the verdict ignored and not recorded.
  const equal = one(proposal('mixed-choice', 'noted-family', AGREE));
  assert.deepEqual(equal.items[0].triage, { version: 1, class: 'record', family: 'noted-family', proposed: 'noted-family' });
  assert.deepEqual(equal.notes, [ignoredVerdict('mixed-choice')]);

  // A stricter proposal with a verdict: taken as without one.
  const stricter = one(proposal('mixed-choice', 'asked-family', RAISE));
  assert.deepEqual(stricter.items[0].triage, { version: 1, class: 'consult', family: 'asked-family', proposed: 'asked-family', advice: 'not_obtained' });
  assert.deepEqual(stricter.notes, [ignoredVerdict('mixed-choice')]);

  // A verdict with no proposal at all: classed as today, one note, no new key.
  const bare = one(proposal('mixed-choice', undefined, AGREE));
  assert.deepEqual(bare.items[0].triage, { version: 1, class: 'record', family: 'noted-family' });
  assert.deepEqual(bare.notes, [ignoredVerdict('mixed-choice')]);

  // An unlisted proposal and one on a question with no row: the proposal's note, then the verdict's.
  const unlisted = one(proposal('mixed-choice', 'signed-family', AGREE));
  assert.deepEqual(unlisted.items[0].triage, { version: 1, class: 'record', family: 'noted-family', proposed: 'signed-family' });
  assert.deepEqual(unlisted.notes, [notTaken('mixed-choice', 'noted-family', 'signed-family', 'not listed for the question'), ignoredVerdict('mixed-choice')]);
  const rowless = one(proposal('loose-choice', 'quick-family', AGREE));
  assert.equal(Object.hasOwn(rowless.items[0].triage, 'reader'), false);
  assert.deepEqual(rowless.notes, [notTaken('loose-choice', 'fallback-family', 'quick-family', 'no policy row for the question'), ignoredVerdict('loose-choice')]);
});

test('classSet never lowers a question that carries a triage, and still takes a stricter proposal on one', () => {
  const policy = mixedPolicy();
  const one = question => classSet({ policy, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: false, questions: [question] });
  const carried = { version: 1, class: 'record', family: 'noted-family' };

  const lowered = one(proposal('mixed-choice', 'quick-family', AGREE, { triage: carried }));
  assert.deepEqual(lowered.items[0].triage, { version: 1, class: 'record', family: 'noted-family', proposed: 'quick-family', reader: AGREE });
  assert.deepEqual(lowered.notes, [notTaken('mixed-choice', 'noted-family', 'quick-family', 'the question carries a triage')]);

  const stricter = one(proposal('mixed-choice', 'asked-family', undefined, { triage: carried }));
  assert.deepEqual(stricter.items[0].triage, { version: 1, class: 'consult', family: 'asked-family', proposed: 'asked-family', advice: 'not_obtained' });
  assert.deepEqual(stricter.notes, []);

  // A carried triage of another version is ignored, so it does not stop the lowering.
  const other = one(proposal('mixed-choice', 'quick-family', AGREE, { triage: { ...carried, version: 2 } }));
  assert.equal(other.items[0].triage.family, 'quick-family');
  assert.deepEqual(other.notes, []);
});

test('the classed triage records its keys in order, the proposal and verdict after the policy\'s', () => {
  const policy = mixedPolicy();
  const one = (question, extra = {}) => classSet({ policy, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: false, questions: [question], ...extra });

  // A floored first family, lowered and raised: version, class, floor, family, raised_by, proposed, reader, held.
  const held = one(proposal('guarded-mix', 'quick-family', RAISE));
  assert.deepEqual(Object.entries(held.items[0].triage), [
    ['version', 1], ['class', 'approve'], ['floor', ['floor-a']], ['family', 'guarded-family'], ['raised_by', 'floor'],
    ['proposed', 'quick-family'], ['reader', RAISE], ['held', true],
  ]);
  // A carried floor keeps its place after the class, ahead of the proposal.
  const carried = one(proposal('mixed-choice', 'quick-family', AGREE, { triage: { version: 1, class: 'consult', floor: ['floor-b'] } }));
  assert.deepEqual(Object.keys(carried.items[0].triage), ['version', 'class', 'floor', 'family', 'proposed', 'reader', 'advice']);
  assert.equal(carried.items[0].triage.class, 'consult');
  assert.equal(carried.items[0].triage.family, 'noted-family');
});

test('a lowered question is still asked when an option needs a person, and a mixed set keeps its order', () => {
  const policy = mixedPolicy();
  const run = (questions, extra = {}) => classSet({ policy, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: true, questions, ...extra });
  const option = (id, extra = {}) => ({ id, label: `Label ${id}`, ...extra });

  // Lowered to decide-alone, but one option only a person can take: the run settles nothing, the question is asked.
  const act = proposal('mixed-choice', 'quick-family', AGREE, { options: [option('a', { recommended: true, person_act: true }), option('b')] });
  assert.deepEqual(run([act]), { items: [], asking: ['mixed-choice'], faults: [], notes: [] });

  // A per-area slug of the declared id lowers under that row, and the item keeps the slug.
  const area = run([proposal('mixed-choice-storage', 'quick-family', AGREE)]);
  assert.deepEqual(area.items.map(item => [item.question_id, item.triage.family, item.triage.proposed]), [['mixed-choice-storage', 'quick-family', 'quick-family']]);

  // Items, asking and notes follow set order, each question deciding for itself.
  const set = run([
    proposal('guarded-mix', 'quick-family', AGREE),
    proposal('mixed-choice', 'quick-family', RAISE),
    proposal('mixed-choice-other', 'quick-family', AGREE),
    proposal('loose-choice', 'asked-family'),
  ], { canAsk: false });
  assert.deepEqual(set.items.map(item => [item.question_id, item.triage.family]),
    [['guarded-mix', 'guarded-family'], ['mixed-choice', 'noted-family'], ['mixed-choice-other', 'quick-family'], ['loose-choice', 'fallback-family']]);
  assert.deepEqual(set.notes, [
    notTaken('guarded-mix', 'guarded-family', 'quick-family', 'the first family carries a floor'),
    notTaken('mixed-choice', 'noted-family', 'quick-family', 'the reader raised it: "Changes who may publish."'),
    notTaken('loose-choice', 'fallback-family', 'asked-family', 'no policy row for the question'),
  ]);
});

test('a question lowered from approve to consult with nobody to ask takes its default with advice not obtained', () => {
  const base = policyOf('questions.json').policy;
  const policy = { ...base, table: [...base.table, { workflow: 'in-node-questions', id: 'mixed-choice', kind: 'question', families: ['signed-family', 'asked-family'] }] };
  const classed = classSet({ policy, workflow: 'in-node-questions', declaredIds: ['mixed-choice'], settles: 'record', canAsk: false, questions: [proposal('mixed-choice', 'asked-family', AGREE)] });
  assert.deepEqual(classed.asking, []);
  assert.deepEqual(classed.notes, []);
  const [item] = classed.items;
  assert.equal(item.by, 'default');
  assert.deepEqual(item.triage, { version: 1, class: 'consult', family: 'asked-family', proposed: 'asked-family', reader: AGREE, advice: 'not_obtained' });
  assert.equal(Object.hasOwn(item.triage, 'held'), false);
});

test('a question the policy leaves unclassified ignores its family and verdict without a note', () => {
  const { unknown_family: _, ...rowsOnly } = mixedPolicy();
  const classed = classSet({ policy: rowsOnly, workflow: 'in-node-questions', declaredIds: DECLARED, settles: 'record', canAsk: false, questions: [proposal('loose-choice', 'quick-family', AGREE)] });
  assert.deepEqual(classed, { items: [], asking: ['loose-choice'], faults: [], notes: [] });
  // No policy at all, as a write that classes nothing sends it.
  const none = classSet({ policy: null, workflow: 'in-node-questions', declaredIds: [], settles: null, canAsk: true, questions: [proposal('mixed-choice', 'quick-family', RAISE)] });
  assert.deepEqual(none, { items: [], asking: ['mixed-choice'], faults: [], notes: [] });
});

test('with no proposal and no carried triage, classSet classes exactly as before the second reader', () => {
  // The expected output was captured from the classing code before the reader existed, for this same set.
  const { unknown_family: _, ...rows } = policyOf('questions.json').policy;
  const policy = { ...rows, table: [...rows.table, { workflow: 'in-node-questions', id: 'mixed-choice', kind: 'question', families: ['noted-family', 'asked-family', 'quick-family'] }] };
  const option = (id, extra = {}) => ({ id, label: `Label ${id}`, description: `Why ${id}.`, ...extra });
  const question = (id, extra = {}) => ({ id, question: `Pick ${id}?`, options: [option('a', { recommended: true }), option('b')], default: 'a', ...extra });
  const questions = [
    question('quick-choice'),
    question('noted-choice'),
    question('asked-choice'),
    question('signed-choice'),
    question('guarded-choice'),
    question('loose-choice'),
    question('mixed-choice-scope'),
    question('mixed-choice-tone', { default: undefined }),
    question('mixed-choice-act', { options: [option('a', { recommended: true, person_act: true }), option('b')] }),
  ];
  const reasons = { 'noted-choice': { rationale: 'Kept it small.', assumption: 'One user.', reversal: 'Swap the option.' } };
  const common = {
    questions, reasons, policy, workflow: 'in-node-questions', settles: 'record', attempt: 2,
    declaredIds: ['quick-choice', 'noted-choice', 'asked-choice', 'signed-choice', 'guarded-choice', 'loose-choice', 'mixed-choice'],
  };
  const item = (id, by, triage, extra = {}) => ({ decision: 'Label a', by, question_id: id, question: `Pick ${id}?`, ...extra, triage, attempt: 2 });
  const settled = (id, triage, rationale = 'Why a.') => item(id, 'run', triage, { rationale });
  const quick = settled('quick-choice', { version: 1, class: 'decide-alone', family: 'quick-family' });
  const noted = item('noted-choice', 'run', { version: 1, class: 'record', family: 'noted-family' }, { rationale: 'Kept it small.', assumption: 'One user.', reversal: 'Swap the option.' });
  const scope = settled('mixed-choice-scope', { version: 1, class: 'record', family: 'noted-family' });

  // Key order counts too: the state file records the item as it is built.
  const same = (actual, expected) => {
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  };
  same(classSet({ ...common, canAsk: false }), {
    items: [
      quick,
      noted,
      item('asked-choice', 'default', { version: 1, class: 'consult', family: 'asked-family', advice: 'not_obtained' }),
      item('signed-choice', 'default', { version: 1, class: 'approve', family: 'signed-family', held: true }),
      item('guarded-choice', 'default', { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor', held: true }),
      scope,
      item('mixed-choice-act', 'default', { version: 1, class: 'record', family: 'noted-family' }),
    ],
    asking: ['loose-choice', 'mixed-choice-tone'],
    faults: [],
    notes: [],
  });
  same(classSet({ ...common, canAsk: true }), {
    items: [quick, noted, scope],
    asking: ['asked-choice', 'signed-choice', 'guarded-choice', 'loose-choice', 'mixed-choice-tone', 'mixed-choice-act'],
    faults: [],
    notes: [],
  });
});

test('checkSet accepts a proposed family name and carries it; the checkpoint leaves it out', () => {
  const question = family => ({ id: 'pick', question: 'Which?', options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }], family });
  const checked = checkSet({ questions: [question('asked-family')] });
  assert.equal(checked.ok, true);
  assert.equal(checked.set.questions[0].family, 'asked-family');
  for (const bad of ['Fact Family', 3, '']) {
    const refused = checkSet({ questions: [question(bad)] });
    assert.equal(refused.ok, false, JSON.stringify(bad));
    assert.match(refused.errors[0], /^question "pick": "family" must be a family name/);
    assert.doesNotMatch(refused.errors[0], /policy lists for this question/);
  }
  const checkpoint = questionCheckpoint({ set: checked.set, node: 'scoping', title: 'Scoping', header: 'Scoping', progress: {}, run: {} });
  assert.equal(Object.hasOwn(checkpoint.questions[0], 'family'), false);
});

test('checkSet accepts a reader verdict and carries it; the checkpoint leaves it out with the family', () => {
  const question = reader => ({
    id: 'pick', question: 'Which?', family: 'asked-family', reader,
    options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }],
  });
  for (const verdict of ['agree', 'raise']) {
    const checked = checkSet({ questions: [question({ verdict, reason: 'Changes what the product does.' })] });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(checked.set.questions[0].reader, { verdict, reason: 'Changes what the product does.' });
    const checkpoint = questionCheckpoint({ set: checked.set, node: 'scoping', title: 'Scoping', header: 'Scoping', progress: {}, run: {} });
    assert.equal(Object.hasOwn(checkpoint.questions[0], 'reader'), false);
    assert.equal(Object.hasOwn(checkpoint.questions[0], 'family'), false);
  }
});

test('checkSet refuses each malformed reader, naming the question and "reader"', () => {
  const question = reader => ({
    id: 'pick', question: 'Which?', reader,
    options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }],
  });
  const malformed = [
    'agree',
    null,
    ['agree', 'Reason.'],
    { verdict: 'agree', reason: 'Reason.', extra: true },
    { verdict: 'agree' },
    { reason: 'Reason.' },
    { verdict: 'maybe', reason: 'Reason.' },
    { verdict: 'agree', reason: '' },
    { verdict: 'agree', reason: 'First line.\nSecond line.' },
  ];
  for (const bad of malformed) {
    const refused = checkSet({ questions: [question(bad)] });
    assert.equal(refused.ok, false, JSON.stringify(bad));
    assert.equal(refused.errors.length, 1, JSON.stringify(refused.errors));
    assert.match(refused.errors[0], /^question "pick": "reader" /, JSON.stringify(bad));
  }
});

test('declaredQuestionIds reads one node\'s ids from the companion, and none without one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-ids-'));
  try {
    const definition = path.join(dir, 'asks.yml');
    fs.writeFileSync(definition, 'name: asks\n');
    assert.deepEqual(declaredQuestionIds(definition, 'shape'), [], 'no companion names nothing');
    fs.writeFileSync(path.join(dir, 'asks.md'), [
      '# Asks',
      '',
      '**With question sets** the node asks as one set.',
      '',
      '## `shape`',
      '',
      '**With question sets** (`layout-choice`): one question.',
      '**Without question sets** (`layout-choice`): the default.',
      '**With question sets** (the node\'s `tone-choice`): another.',
      '',
      '## `polish`',
      '',
      '**Without question sets** (`finish-choice`): the default.',
      '',
    ].join('\n'));
    assert.deepEqual(declaredQuestionIds(definition, 'shape'), ['layout-choice', 'tone-choice']);
    assert.deepEqual(declaredQuestionIds(definition, 'polish'), ['finish-choice']);
    assert.deepEqual(declaredQuestionIds(definition, 'absent'), []);
    assert.deepEqual(declaredQuestionIds(null, 'shape'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inNodeQuestions reads a CRLF companion as it reads the LF one', () => {
  const workflows = path.join(ENGINE_DIR, 'workflows');
  for (const name of fs.readdirSync(workflows).filter(file => file.endsWith('.md'))) {
    const lf = fs.readFileSync(path.join(workflows, name), 'utf8').replace(/\r\n?/g, '\n');
    const found = inNodeQuestions(lf);
    if (name.startsWith('development')) assert.ok(found.length > 0, `${name}: the parser found no question`);
    assert.deepEqual(inNodeQuestions(lf.replace(/\n/g, '\r\n')), found, name);
  }
});

test('inNodeQuestions skips fenced rows: a fenced question line or node heading is an example, not a declaration', () => {
  const text = [
    '## `scope`',
    '',
    '**With question sets** (`tone`): in this step\'s one request.',
    '',
    '```',
    '**With question sets** (`fenced-id`): an example.',
    '## `fenced-node`',
    '**Without question sets** (`other-id`): an example.',
    '```',
    '',
    '**Without question sets** (`tone`): a plain tone.',
    '',
  ].join('\n');
  const expected = [{ node: 'scope', id: 'tone' }];
  assert.deepEqual(inNodeQuestions(text), expected);
  assert.deepEqual(inNodeQuestions(text.replace(/\n/g, '\r\n')), expected);
});

/** A run with held items on two nodes, one approved, in a frozen order unlike the summaries'. */
function heldRun() {
  const held = (id, extra = {}) => ({ decision: 'B', by: 'default', question_id: id, question: `Pick ${id}?`, triage: { version: 1, class: 'approve', family: 'signed-family', held: true }, ...extra });
  return {
    orchestrator: { classes_questions: true },
    workflow: { nodes: { shape: { kind: 'task' }, review: { kind: 'gate' }, polish: { kind: 'task' }, [HELD_APPROVAL]: { kind: 'gate', status: 'pending' } } },
    node_summaries: {
      polish: { decisions: [held('finish-choice'), { decision: 'A', by: 'run', question_id: 'quick-choice', triage: { version: 1, class: 'decide-alone' } }] },
      shape: { decisions: [held('layout-choice', { attempt: 2 }), held('tone-choice'), { decision: 'Kept', by: 'operator' }] },
      review: {
        decisions: [
          { option: 'continue', answered_by: 'tester' },
          // Approves `layout-choice` at attempt 1 only: the held one is attempt 2.
          { decision: 'layout-choice: B', by: 'operator', node: 'shape', question_id: 'layout-choice', triage: { version: 1, class: 'approve' }, answered_by: 'tester' },
          { decision: 'tone-choice: B', by: 'operator', node: 'shape', question_id: 'tone-choice', triage: { version: 1, class: 'approve' }, answered_by: 'tester' },
        ],
      },
    },
  };
}

test('outstandingHeld and approvalsOf match on node, question id and attempt, in frozen node order', () => {
  const doc = heldRun();
  assert.deepEqual(approvalsOf(doc).map(each => [each.node, each.question_id, each.attempt]), [['shape', 'layout-choice', 1], ['shape', 'tone-choice', 1]]);
  assert.deepEqual(outstandingHeld(doc).map(each => [each.node, each.question_id, each.attempt]), [['shape', 'layout-choice', 2], ['polish', 'finish-choice', 1]]);

  // An approval at the held item's own attempt clears it; one recorded under held-approval counts too.
  doc.node_summaries[HELD_APPROVAL] = {
    decisions: [
      { option: 'continue' },
      { decision: 'layout-choice: B', by: 'operator', node: 'shape', question_id: 'layout-choice', attempt: '2' },
    ],
  };
  assert.deepEqual(outstandingHeld(doc).map(each => [each.node, each.question_id]), [['polish', 'finish-choice']]);
  assert.deepEqual(outstandingHeld({}), []);
  assert.deepEqual(approvalsOf({}), []);

  // A run whose freeze recorded no classing holds nothing, whatever its items say, and approves nothing.
  const { orchestrator: _fact, ...unclassed } = heldRun();
  assert.deepEqual(outstandingHeld(unclassed), []);
  assert.deepEqual(approvalsOf(unclassed), []);
  assert.deepEqual(outstandingHeld({ ...heldRun(), orchestrator: { classes_questions: false } }), []);
});

test('heldApprovalOptions offers continue, a revise per owning node in frozen order, then stop; none past the safety limit', () => {
  const doc = heldRun();
  const offered = heldApprovalOptions(doc);
  assert.deepEqual(offered.options.map(each => [each.id, each.effect, each.reruns ?? null]), [
    ['continue', 'continue', null],
    ['revise-shape', 'revise', 'shape'],
    ['revise-polish', 'revise', 'polish'],
    ['stop', 'stop', null],
  ]);
  assert.equal(offered.options[0].recommended, true);
  assert.equal(offered.revision, 1);
  assert.equal(offered.spent, false);

  // A held question with no choice yet: no continue, its step's revise recommended.
  const open = heldRun();
  open.node_summaries.polish.decisions[0] = { ...open.node_summaries.polish.decisions[0], decision: NO_CHOICE, no_choice: true };
  const settling = heldApprovalOptions(open);
  assert.equal(settling.recommended, 'revise-polish');
  assert.deepEqual(settling.options.map(each => [each.id, each.recommended ?? false]), [['revise-shape', false], ['revise-polish', true], ['stop', false]]);
  open.node_summaries[HELD_APPROVAL] = { decisions: Array.from({ length: REVISION_CEILING }, () => ({ option: 'revise-shape', note: 'again' })) };
  assert.deepEqual(heldApprovalOptions(open).options.map(each => [each.id, each.recommended ?? false]), [['stop', true]]);

  doc.node_summaries[HELD_APPROVAL] = { decisions: Array.from({ length: REVISION_CEILING }, () => ({ option: 'revise-shape', note: 'again' })) };
  const spent = heldApprovalOptions(doc);
  assert.equal(spent.revision, REVISION_CEILING + 1);
  assert.equal(spent.spent, true);
  assert.deepEqual(spent.options.map(each => each.id), ['continue', 'stop']);
});
