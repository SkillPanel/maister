import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freezePatch, readState, run as runScript, scratch, sharedPlugin, sibling, verb } from '../helpers.mjs';

// The autonomy ceiling is fixed at the freeze: a later write may narrow it,
// never widen or remove it, and a child run's freeze copies its parent's.
// `orchestrator.classes_questions` is the freeze's own record that the policy
// classes in-node questions for the run's workflow.

const policyOf = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy', name), 'utf8'));
const QUESTIONS = sharedPlugin({ policy: policyOf('questions.json') });
const DEFAULT_CEILING = sharedPlugin({ policy: policyOf('questions-default-ceiling.json') });

const CEILING_NOTE = 'note: ignored the supplied orchestrator.options.ceiling; the autonomy ceiling may narrow after the freeze, never widen\n';
const FACT_NOTE = 'note: ignored the supplied orchestrator.classes_questions; the freeze records it from the policy it applied, so no patch sets it\n';

/** One `write-state` through `engine` (the shipped engine when null). */
function send(engine, run, patch) {
  const args = ['write-state', `--state=${run.state}`];
  const result = engine ? runScript(engine, args, patch) : verb(args, patch);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

function frozen(engine, run, orchestrator = {}) {
  return send(engine, run, freezePatch({ orchestrator }).patch);
}

const ceilingOf = run => readState(run).orchestrator.options?.ceiling;

test('the freeze records the patch\'s options.ceiling', t => {
  const run = scratch(t);
  const result = frozen(QUESTIONS.engine, run, { options: { ceiling: 'advice' } });
  assert.equal(ceilingOf(run), 'advice');
  assert.equal(result.stderr, '');
});

test('classes_questions is recorded only when the policy classes questions, and never taken from a patch', t => {
  const classed = scratch(t);
  frozen(QUESTIONS.engine, classed);
  assert.equal(readState(classed).orchestrator.classes_questions, true);

  // Under the built-in default neither key appears unless sent, and a sent fact is dropped.
  const plain = scratch(t);
  const result = frozen(null, plain, { classes_questions: true });
  assert.equal(result.stderr, FACT_NOTE);
  const orchestrator = readState(plain).orchestrator;
  assert.equal(Object.hasOwn(orchestrator, 'classes_questions'), false);
  assert.equal(Object.hasOwn(orchestrator.options ?? {}, 'ceiling'), false);
  assert.doesNotMatch(fs.readFileSync(plain.state, 'utf8'), /classes_questions|ceiling/);

  const later = send(QUESTIONS.engine, classed, { orchestrator: { classes_questions: false } });
  assert.equal(later.stderr, FACT_NOTE);
  assert.equal(readState(classed).orchestrator.classes_questions, true);
});

test('a later write may narrow the autonomy ceiling, never widen it', t => {
  const run = scratch(t);
  frozen(QUESTIONS.engine, run, { options: { ceiling: 'advice' } });

  const wider = send(QUESTIONS.engine, run, { orchestrator: { options: { ceiling: 'decide' } } });
  assert.equal(wider.stderr, CEILING_NOTE);
  assert.equal(ceilingOf(run), 'advice');

  const equal = send(QUESTIONS.engine, run, { orchestrator: { options: { ceiling: 'advice' } } });
  assert.equal(equal.stderr, '');
  const narrower = send(QUESTIONS.engine, run, { orchestrator: { options: { ceiling: 'approve' } } });
  assert.equal(narrower.stderr, '');
  assert.equal(ceilingOf(run), 'approve');

  const back = send(QUESTIONS.engine, run, { orchestrator: { options: { ceiling: 'advice' } } });
  assert.equal(back.stderr, CEILING_NOTE);
  assert.equal(ceilingOf(run), 'approve');
});

test('removing a recorded autonomy ceiling is widening, by every route', t => {
  const run = scratch(t);
  frozen(QUESTIONS.engine, run, { options: { ceiling: 'advice', note: 'kept' } });

  // A non-map options would replace the whole map: dropped, the rest of the patch applied.
  const replaced = send(QUESTIONS.engine, run, { orchestrator: { options: null, started_phase: 'scoping' } });
  assert.equal(replaced.stderr, CEILING_NOTE);
  assert.equal(readState(run).orchestrator.started_phase, 'scoping');
  assert.deepEqual(readState(run).orchestrator.options, { ceiling: 'advice', note: 'kept' });

  for (const value of [null, '', 3]) {
    const removed = send(QUESTIONS.engine, run, { orchestrator: { options: { ceiling: value, other: 'x' } } });
    assert.equal(removed.stderr, CEILING_NOTE, `ceiling sent as ${JSON.stringify(value)}`);
    assert.equal(ceilingOf(run), 'advice');
    assert.equal(readState(run).orchestrator.options.other, 'x', 'the rest of options still merges');
  }
});

test('with no recorded autonomy ceiling, a later one is compared with the policy\'s default_ceiling', t => {
  const run = scratch(t);
  frozen(DEFAULT_CEILING.engine, run);
  assert.equal(Object.hasOwn(readState(run).orchestrator.options ?? {}, 'ceiling'), false);

  const wider = send(DEFAULT_CEILING.engine, run, { orchestrator: { options: { ceiling: 'decide' } } });
  assert.equal(wider.stderr, CEILING_NOTE);
  assert.equal(ceilingOf(run), undefined);

  const narrower = send(DEFAULT_CEILING.engine, run, { orchestrator: { options: { ceiling: 'approve' } } });
  assert.equal(narrower.stderr, '');
  assert.equal(ceilingOf(run), 'approve');

  // With none in effect at all, any value is wider.
  const none = scratch(t);
  frozen(QUESTIONS.engine, none);
  const any = send(QUESTIONS.engine, none, { orchestrator: { options: { ceiling: 'approve' } } });
  assert.equal(any.stderr, CEILING_NOTE);
  assert.equal(ceilingOf(none), undefined);
});

test('a child run\'s freeze copies its parent\'s effective autonomy ceiling, clamped by its own', t => {
  const parent = scratch(t);
  frozen(QUESTIONS.engine, parent, { options: { ceiling: 'advice' } });
  const link = { run: parent.path, node: 'research' };
  const cases = [[undefined, 'advice'], ['decide', 'advice'], ['approve', 'approve']];
  for (const [own, expected] of cases) {
    const child = sibling(parent, { type: 'research', name: `2026-01-05-child-${own ?? 'none'}` });
    const options = own === undefined ? {} : { options: { ceiling: own } };
    const result = frozen(QUESTIONS.engine, child, { parent: link, ...options });
    assert.equal(result.stderr, '');
    assert.equal(ceilingOf(child), expected, `the child sent ${own}`);
  }

  // The parent recorded none: its matching policy's default_ceiling is what it carries.
  const defaulted = scratch(t);
  frozen(DEFAULT_CEILING.engine, defaulted);
  const child = sibling(defaulted, { type: 'research', name: '2026-01-05-child' });
  frozen(DEFAULT_CEILING.engine, child, { parent: { run: defaulted.path, node: 'research' } });
  assert.equal(ceilingOf(child), 'advice');
  const clamped = sibling(defaulted, { type: 'research', name: '2026-01-05-clamped' });
  frozen(DEFAULT_CEILING.engine, clamped, { parent: { run: defaulted.path, node: 'research' }, options: { ceiling: 'approve' } });
  assert.equal(ceilingOf(clamped), 'approve');
});

test('an unreadable parent copies nothing and warns', t => {
  const root = scratch(t);
  const child = sibling(root, { type: 'research', name: '2026-01-05-orphan' });
  const result = frozen(QUESTIONS.engine, child, { parent: { run: '.maister/tasks/development/2026-01-05-missing', node: 'research' } });
  assert.match(result.stderr, /^warning: autonomy-ceiling-parent-unread:\.maister\/tasks\/development\/2026-01-05-missing\n$/);
  assert.equal(ceilingOf(child), undefined);

  const own = sibling(root, { type: 'research', name: '2026-01-05-own' });
  frozen(QUESTIONS.engine, own, { parent: { run: '.maister/tasks/development/2026-01-05-missing', node: 'research' }, options: { ceiling: 'decide' } });
  assert.equal(ceilingOf(own), 'decide', 'the child\'s own value is recorded as sent');
});
