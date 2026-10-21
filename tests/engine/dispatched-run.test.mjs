import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OPERATOR, freeze, readState, scratch, write } from '../helpers.mjs';
import { canAsk, isDispatchedRun, questionSets } from '../../plugins/maister/skills/workflow-engine/scripts/lib/driver.mjs';
import { answerVia } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state.mjs';

// A dispatched run is told apart by the dispatch it records, not by a kind of
// its own: the seed records a cockpit carrying the dispatch id, and a run that
// recorded the legacy `kind: dispatch` reads exactly as it did. Gates suspend
// and close-outs publish under both forms (in-node-classing, run-complete);
// here, the reading rule, question sets, the `via` stamp and the actor kinds.

const SETS = ['question-sets'];
const of = driver => ({ orchestrator: { driver } });

/** Each driver, whether it is a dispatched run, whether it carries question sets, and the `via` its answers say. */
const FORMS = [
  ['cockpit with a dispatch id', { kind: 'cockpit', cwd: '/work', dispatch_id: 'd-0001', features: SETS }, true, false, 'dispatch'],
  ['legacy dispatch with its id', { kind: 'dispatch', cwd: '/work', dispatch_id: 'd-0001' }, true, false, 'dispatch'],
  ['legacy dispatch without an id', { kind: 'dispatch', cwd: '/work', features: SETS }, true, false, 'dispatch'],
  ['cockpit driving directly', { kind: 'cockpit', cwd: '/work', features: SETS }, false, true, 'cockpit'],
  ['cockpit with an empty dispatch id', { kind: 'cockpit', cwd: '/work', dispatch_id: ' ', features: SETS }, false, true, 'cockpit'],
  ['terminal', { kind: 'terminal' }, false, false, 'terminal'],
  ['terminal recording a dispatch id', { kind: 'terminal', dispatch_id: 'd-0001' }, false, false, 'terminal'],
];

test('the reading rule: a cockpit carrying a dispatch id, or the legacy dispatch kind, is a dispatched run, never given question sets', () => {
  for (const [label, driver, dispatched, sets, via] of FORMS) {
    assert.equal(isDispatchedRun(of(driver)), dispatched, label);
    assert.equal(questionSets(of(driver)), sets, label);
    assert.equal(answerVia(of(driver)), via, label);
  }
  assert.equal(canAsk(of(FORMS[0][1])), false, 'a dispatched cockpit run cannot ask an in-node question');
  assert.equal(isDispatchedRun({}), false);
  assert.equal(answerVia({}), 'terminal');
});

test('write-state: an answer given in a dispatched run says via dispatch on either form; one under a cockpit driving directly says cockpit', t => {
  for (const [label, driver, , , via] of FORMS.slice(0, 4)) {
    const run = scratch(t);
    freeze(run, { orchestrator: { driver } });
    assert.deepEqual(readState(run).orchestrator.driver, driver, `${label}: the driver is kept as recorded`);
    // A relayed answer is a person's under any driver, so the writer stamps its name and via.
    write(run, { node_summaries: { analysis: { decisions: [{ decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes', on_behalf_of: 'dana' }] } } });
    const [stored] = readState(run).node_summaries.analysis.decisions;
    assert.deepEqual([stored.by, stored.answered_by, stored.via], ['operator', OPERATOR, via], label);
    assert.equal(Object.hasOwn(stored, 'actor'), false, `${label}: a driven answer gains no actor`);
  }
});

test('actor kinds: a coordinator answering on a person\'s behalf is recorded as sent, beside person and agent', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  const actor = { kind: 'coordinator', id: 'coordinator-1' };
  const result = write(run, {
    node_summaries: {
      analysis: {
        decisions: [{ decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes', answered_by: OPERATOR, via: 'cockpit', actor, on_behalf_of: 'dana' }],
      },
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /provenance-unusable/);
  const [stored] = readState(run).node_summaries.analysis.decisions;
  assert.equal(stored.by, 'operator');
  assert.deepEqual(stored.actor, actor);
  assert.equal(stored.on_behalf_of, 'dana');
});
