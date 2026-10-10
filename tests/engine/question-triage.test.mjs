import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES } from '../helpers.mjs';
import { ceilingOf, effectiveCeiling, loadPolicy, narrowerLevel, questionOutcome, triageFor } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';
import { canAsk } from '../../plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs';
import { REVISION_CEILING } from '../../plugins/maister/skills/workflow-engine/scripts/lib/revise.mjs';
import {
  HELD_APPROVAL,
  approvalsOf,
  classSet,
  classesQuestions,
  declaredQuestionIds,
  heldApprovalOptions,
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
  const higher = { version: 1, class: 'approve', family: 'signed-family', floor: ['floor-b'] };
  const equal = { version: 1, class: 'record', family: 'other-family' };

  assert.deepEqual(raiseTriage(computed, lower), { ...computed, floor: ['floor-b'] });
  assert.deepEqual(raiseTriage(computed, higher), higher);
  assert.deepEqual(raiseTriage(computed, equal), computed);
  assert.deepEqual(raiseTriage({ ...computed, floor: ['floor-a'] }, higher), { ...higher, floor: ['floor-a', 'floor-b'] });
  assert.deepEqual(raiseTriage(null, higher), higher);
  assert.deepEqual(raiseTriage(computed, null), computed);
  assert.equal(raiseTriage(null, null), null);
  assert.deepEqual(raiseTriage(computed, { ...higher, version: 2 }), computed);
  assert.equal(raiseTriage(null, { ...higher, version: 2 }), null);
  // Neither side is changed.
  assert.deepEqual(computed, { version: 1, class: 'record', family: 'noted-family' });
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
  assert.equal(refused.faults.length, 3);
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

  // A run whose freeze recorded no classing holds nothing, whatever its items say.
  const { orchestrator: _fact, ...unclassed } = heldRun();
  assert.deepEqual(outstandingHeld(unclassed), []);
  assert.deepEqual(outstandingHeld({ ...heldRun(), orchestrator: { classes_questions: false } }), []);
});

test('heldApprovalOptions offers continue, a revise per owning node in frozen order, then stop; none past the safety limit', () => {
  const doc = heldRun();
  const offered = heldApprovalOptions(doc, { ceiling: REVISION_CEILING });
  assert.deepEqual(offered.options.map(each => [each.id, each.effect, each.reruns ?? null]), [
    ['continue', 'continue', null],
    ['revise-shape', 'revise', 'shape'],
    ['revise-polish', 'revise', 'polish'],
    ['stop', 'stop', null],
  ]);
  assert.equal(offered.options[0].recommended, true);
  assert.equal(offered.revision, 1);
  assert.equal(offered.spent, false);

  doc.node_summaries[HELD_APPROVAL] = { decisions: Array.from({ length: REVISION_CEILING }, () => ({ option: 'revise-shape', note: 'again' })) };
  const spent = heldApprovalOptions(doc, { ceiling: REVISION_CEILING });
  assert.equal(spent.revision, REVISION_CEILING + 1);
  assert.equal(spent.spent, true);
  assert.deepEqual(spent.options.map(each => each.id), ['continue', 'stop']);
});
