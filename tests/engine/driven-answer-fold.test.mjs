import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';

// A driven resume writes a gate's summary with editor tools, so what it holds is
// what the session spelled. The re-validation write that closes the gate's index
// row folds a person's answer the way a patch's is folded: `by: operator` and the
// label, each only where the session left it out. Nothing else on the gate moves,
// and a write that closes no row folds nothing.

const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const GATE = 'specification-approval';
const ASKED_LABEL = 'Continue to the audit, as the person read it';
const REVISE_LABEL = 'Revise the specification, as the person read it';
const PERSON = 'answered_by: dana, at: "2026-01-05T09:05:00Z", via: cockpit';

/** The optional-step run under a cockpit driver, its specification written, the gate the question now. */
function atGate(t) {
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  return run;
}

/** Suspend on the gate, then record the answer as step 4 has a session write it, each of `items` a flow-map line. */
function sessionFold(run, option, items) {
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  const request = path.join(gates, `${GATE}.request.yml`);
  const head = [
    'version: 1',
    `node: ${GATE}`,
    'kind: approval',
    'question: "Specification complete. Continue?"',
    'multiple: false',
    'options:',
    `  - {id: continue-to-audit, label: "${ASKED_LABEL}"}`,
    `  - {id: revise-specification, label: "${REVISE_LABEL}"}`,
    'asked_at: "2026-01-05T09:00:00Z"',
  ].join('\n');
  fs.writeFileSync(request, `${head}\nanswer: null\n`);
  refreshIndex(run.dir);
  write(run, {
    orchestrator: { gate_pending: { node: GATE, request: `gates/${GATE}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [GATE]: { status: 'suspended' } },
  });
  fs.writeFileSync(request, `${head}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n`);
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${GATE}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  const lines = items.map(item => `      - ${item}\n`).join('');
  fs.writeFileSync(run.state, `${text}  ${GATE}:\n    decisions:\n${lines}    status: completed\n`);
}

const decisionsOf = run => readState(run).node_summaries[GATE].decisions;
const withoutClock = text => text.replace(/^ {2}updated: .*$/m, '');

test('a hand-written answer that leaves out by and decision gains both from the re-validation, under the label the person read', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [`{option: continue-to-audit, ${PERSON}}`]);
  write(run, {});
  assert.deepEqual(decisionsOf(run), [{
    option: 'continue-to-audit',
    answered_by: 'dana',
    at: '2026-01-05T09:05:00Z',
    via: 'cockpit',
    decision: ASKED_LABEL,
    by: 'operator',
  }]);
});

test('an option the request does not list takes the definition\'s label', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-planning', [`{option: continue-to-planning, ${PERSON}}`]);
  write(run, {});
  const [answer] = decisionsOf(run);
  assert.equal(answer.by, 'operator');
  assert.equal(answer.decision, 'Continue to planning, skip the audit');
});

test('a by and a decision the session spelled are kept', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [`{option: continue-to-audit, decision: "In the session's own words", by: operator, ${PERSON}}`]);
  write(run, {});
  const [answer] = decisionsOf(run);
  assert.equal(answer.decision, 'In the session\'s own words');
  assert.equal(answer.by, 'operator');
});

test('a by alone gains the label, and a decision alone gains the by', t => {
  const byOnly = atGate(t);
  sessionFold(byOnly, 'continue-to-audit', [`{option: continue-to-audit, by: operator, ${PERSON}}`]);
  write(byOnly, {});
  assert.equal(decisionsOf(byOnly)[0].decision, ASKED_LABEL);

  const decisionOnly = atGate(t);
  sessionFold(decisionOnly, 'continue-to-audit', [`{option: continue-to-audit, decision: "Go on", ${PERSON}}`]);
  write(decisionOnly, {});
  assert.equal(decisionsOf(decisionOnly)[0].decision, 'Go on');
  assert.equal(decisionsOf(decisionOnly)[0].by, 'operator');
});

test('a second empty write changes nothing', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [`{option: continue-to-audit, ${PERSON}}`]);
  write(run, {});
  const once = fs.readFileSync(run.state, 'utf8');
  const again = verb(['write-state', `--state=${run.state}`], {});
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /node_summaries/);
  assert.equal(withoutClock(fs.readFileSync(run.state, 'utf8')), withoutClock(once));
});

test('a decision the run, an audit or a default settled, and a free-text note, stay as they are', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [
    '{option: stop-here, by: run}',
    '{option: stop-here, by: audit}',
    '{option: stop-here, by: default}',
    '{decision: "A note the run recorded", by: run}',
    'A note in plain words',
    `{option: continue-to-audit, ${PERSON}}`,
  ]);
  write(run, {});
  const decisions = decisionsOf(run);
  assert.deepEqual(decisions.slice(0, 5), [
    { option: 'stop-here', by: 'run' },
    { option: 'stop-here', by: 'audit' },
    { option: 'stop-here', by: 'default' },
    { decision: 'A note the run recorded', by: 'run' },
    'A note in plain words',
  ]);
  assert.equal(decisions[5].by, 'operator');
  assert.equal(decisions[5].decision, ASKED_LABEL);
});

test('a revise answer folded this way is completed by gate-revise, one decision with its attempt, credited and labelled', t => {
  const run = atGate(t);
  sessionFold(run, 'revise-specification', [`{option: revise-specification, ${PERSON}}`]);
  write(run, {});
  const [held] = decisionsOf(run);
  assert.equal(held.by, 'operator');
  assert.equal(held.decision, REVISE_LABEL);

  const revised = verb(['gate-revise', `--state=${run.state}`, `--node=${GATE}`, '--option=revise-specification'],
    { note: 'Tighten the scope.', answered_by: 'dana', at: '2026-01-05T09:05:00Z' });
  assert.equal(revised.code, 0, revised.stderr);
  const decisions = decisionsOf(run);
  assert.equal(decisions.length, 1, JSON.stringify(decisions));
  const [revise] = decisions;
  assert.equal(revise.option, 'revise-specification');
  assert.equal(revise.attempt, 1);
  assert.equal(revise.by, 'operator');
  assert.equal(revise.answered_by, 'dana');
  assert.equal(typeof revise.decision, 'string');
  assert.notEqual(revise.decision, '');
});

test('an earlier revise beside the new answer is folded once, and a later write of the summary does not repeat it', t => {
  const run = atGate(t);
  const earlier = `{option: revise-specification, ${PERSON}, attempt: 1, reruns: specification, note: "Tighten the scope."}`;
  sessionFold(run, 'continue-to-audit', [earlier, `{option: continue-to-audit, ${PERSON}}`]);
  write(run, {});
  const folded = decisionsOf(run);
  assert.deepEqual(folded.map(item => item.option), ['revise-specification', 'continue-to-audit']);
  assert.equal(folded[0].by, 'operator');
  assert.equal(folded[0].decision, REVISE_LABEL);

  // The same list sent again, as gate-revise and a closing write send it.
  write(run, { node_summaries: { [GATE]: { decisions: folded } } });
  assert.deepEqual(decisionsOf(run).map(item => item.option), ['revise-specification', 'continue-to-audit']);

  // The answer alone: the revise is history, and stays once.
  write(run, { node_summaries: { [GATE]: { decisions: [folded[1]] } } });
  assert.deepEqual(decisionsOf(run).map(item => item.option), ['revise-specification', 'continue-to-audit']);
});

test('an earlier revise folded here still matches the same revise re-sent bare, so it is held once', t => {
  const run = atGate(t);
  // The request does not list it, so the fold and the re-send both take the definition's label.
  const earlier = { option: 'stop-here', answered_by: 'dana', at: '2026-01-05T09:05:00Z', via: 'cockpit', attempt: 1, reruns: 'specification', note: 'Tighten the scope.' };
  sessionFold(run, 'continue-to-audit', [`{option: stop-here, ${PERSON}, attempt: 1, reruns: specification, note: "Tighten the scope."}`, `{option: continue-to-audit, ${PERSON}}`]);
  write(run, {});
  const [, answer] = decisionsOf(run);
  write(run, { node_summaries: { [GATE]: { decisions: [earlier, answer] } } });
  assert.deepEqual(decisionsOf(run).map(item => item.option), ['stop-here', 'continue-to-audit']);
});

test('an answer held without by, on a write that closes no row, is left alone', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [`{option: continue-to-audit, ${PERSON}}`]);
  // The row closed before the fold existed: the index already reads answered.
  refreshIndex(run.dir);
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: answered/);
  for (const patch of [{}, { nodes: { audit: { status: 'running' } } }]) {
    write(run, patch);
    const [answer] = decisionsOf(run);
    assert.equal(Object.hasOwn(answer, 'by'), false);
    assert.equal(Object.hasOwn(answer, 'decision'), false);
  }
});

test('a request whose options cannot be read costs the answer only the asked label, never the write', t => {
  const run = atGate(t);
  sessionFold(run, 'continue-to-audit', [`{option: continue-to-audit, ${PERSON}}`]);
  const file = path.join(run.dir, 'gates', `${GATE}.request.yml`);
  const text = fs.readFileSync(file, 'utf8').replace(/^options:\n(?: {2}- .*\n)+/m, 'options: none\n');
  fs.writeFileSync(file, text);
  write(run, {});
  const [answer] = decisionsOf(run);
  assert.equal(answer.by, 'operator');
  assert.equal(answer.decision, 'Continue to the specification audit');
});
