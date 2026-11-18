import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, ROOT, freezePatch, scratch, verb, write } from '../helpers.mjs';

// Agents a runner sent and that have not reported, in code. On a host that
// runs a subagent's own agent calls in the background, a runner cannot block
// on its wave, and a host may make it hand back mid-wave. Every agent is
// recorded through `in-flight` before it acts, with the session that sent it;
// a runner that must end with agents still out ends `waiting`, never
// `unavailable`; and `runner-step` waits while a recorded agent of this
// session has not reported, so a resume never starts a second agent on the
// same work. Every group, review and agent id here is made up.

const SESSION = 'session-live';
const OTHER = 'session-gone';
const env = (session = SESSION) => ({ CLAUDE_CODE_SESSION_ID: session });

const IMPLEMENTATION = { node: 'implementation', runner: 'implementation' };
const VERIFICATION = { node: 'review', runner: 'verification' };

const PLAN = `# Implementation Plan

### Task Group 1: Parser
**Dependencies:** none
**Files to Modify:** src/parser.js

- [ ] 1.1 Write the parser tests
- [ ] 1.2 Implement the parser

### Task Group 2: Writer
**Dependencies:** none
**Files to Modify:** src/writer.js

- [ ] 2.1 Write the writer tests
- [ ] 2.2 Implement the writer
`;

/** A nested run with its implementation node running, a work log opened and wave 1 started. */
function implementing(t) {
  const run = scratch(t);
  const { patch } = freezePatch({});
  assert.equal(verb(['write-state', `--state=${run.state}`, '--host=claude'], patch).code, 0);
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'running' } } });
  run.impl = path.join(run.dir, 'implementation');
  fs.mkdirSync(run.impl, { recursive: true });
  run.plan = path.join(run.impl, 'implementation-plan.md');
  fs.writeFileSync(run.plan, PLAN);
  fs.writeFileSync(path.join(run.impl, 'work-log.md'), '# Work Log\n\n## 2026-01-05T09:00:00Z - Implementation Started\n');
  assert.equal(verb(['wave-start', `--plan=${run.plan}`, '--wave=1', '--groups=1,2']).code, 0);
  return { ...run, ...IMPLEMENTATION };
}

/** A nested run with the verifier node `review` running in cycle 1. */
function verifying(t) {
  const run = scratch(t);
  const { patch } = freezePatch({ overlays: [path.join(FIXTURES, 'definitions/sample.overlay.yml')] });
  assert.equal(verb(['write-state', `--state=${run.state}`, '--host=claude'], patch).code, 0);
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' }, review: { status: 'running' } } });
  write(run, { verification_context: { cycle: 1, snapshot: 'tree-1', node: 'review', attempt: 1, last_status: null, issues_found: [] } });
  return { ...run, ...VERIFICATION };
}

const inFlight = (run, flags, session = SESSION) =>
  verb(['in-flight', `--state=${run.state}`, `--node=${run.node}`, `--runner=${run.runner}`, ...flags], undefined, env(session));
const recorded = (run, items, session) => {
  const result = inFlight(run, [`--record=${items}`], session);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const stepOf = (run, session = SESSION) => {
  const result = verb(['runner-step', `--state=${run.state}`, `--node=${run.node}`, `--runner=${run.runner}`], undefined, env(session));
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const result = (run, doc, session = SESSION) =>
  verb(['runner-result', `--state=${run.state}`, `--node=${run.node}`, `--runner=${run.runner}`], doc, env(session));
const report = (run, rel, text = 'Group report: SUCCESS\n') => {
  const file = path.join(run.dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const flightFile = run => JSON.parse(fs.readFileSync(path.join(run.dir, run.runner, 'in-flight.json'), 'utf8'));

const GROUPS = 'group-1:implementation/group-reports/group-1.md,group-2:implementation/group-reports/group-2.md';
const REVIEWS = 'review-code-risk:verification/code-risk-review.md,review-simplicity:verification/simplicity-review.md';

// ---------------------------------------------------------------------------
// in-flight: the record
// ---------------------------------------------------------------------------

test('in-flight --record stamps each agent with the node, its attempt and the session, and clears a stale report', t => {
  const run = implementing(t);
  report(run, 'implementation/group-reports/group-1.md', 'an earlier dispatch\'s report');
  const printed = recorded(run, GROUPS);
  assert.deepEqual(Object.keys(printed.agents), ['group-1', 'group-2']);
  const file = flightFile(run);
  assert.equal(file.node, 'implementation');
  assert.equal(file.attempt, 1);
  assert.equal(file.agents['group-1'].session, SESSION);
  assert.equal(file.agents['group-1'].output, 'implementation/group-reports/group-1.md');
  assert.equal(file.agents['group-1'].agent, null);
  assert.match(file.agents['group-1'].dispatched, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!fs.existsSync(path.join(run.impl, 'group-reports', 'group-1.md')), 'a report on disk always answers the latest dispatch');
});

test('in-flight --agents attaches the host\'s agent ids and resets nothing', t => {
  const run = implementing(t);
  recorded(run, GROUPS);
  report(run, 'implementation/group-reports/group-1.md');
  const attached = inFlight(run, ['--agents=group-1:a1b2c3,group-2:d4e5f6']);
  assert.equal(attached.code, 0, attached.stderr);
  const file = flightFile(run);
  assert.equal(file.agents['group-1'].agent, 'a1b2c3');
  assert.equal(file.agents['group-2'].agent, 'd4e5f6');
  assert.ok(fs.existsSync(path.join(run.impl, 'group-reports', 'group-1.md')), '--agents clears no report');
});

test('in-flight --record keeps the other agents of the attempt, and a new attempt starts the file afresh', t => {
  const run = implementing(t);
  recorded(run, GROUPS);
  recorded(run, 'group-1:implementation/group-reports/group-1.md');
  assert.deepEqual(Object.keys(flightFile(run).agents).sort(), ['group-1', 'group-2']);
  const file = flightFile(run);
  file.attempt = 0;
  fs.writeFileSync(path.join(run.impl, 'in-flight.json'), JSON.stringify(file));
  recorded(run, 'group-2:implementation/group-reports/group-2.md');
  assert.deepEqual(Object.keys(flightFile(run).agents), ['group-2']);
});

test('the verification runner\'s records carry the cycle they were sent in', t => {
  const run = verifying(t);
  recorded(run, REVIEWS);
  assert.equal(flightFile(run).agents['review-code-risk'].cycle, 1);
});

const INVALID = [
  ['no --record, --agents or --ended', [], 'in-flight-invalid'],
  ['an id that is not a slug', ['--record=Group 1:implementation/group-reports/group-1.md'], 'in-flight-invalid'],
  ['an output outside the runner\'s folder', ['--record=group-1:analysis/notes.md'], 'in-flight-invalid'],
  ['an output that is one of the loop\'s own files', ['--record=group-1:implementation/runner-result.json'], 'in-flight-invalid'],
  ['an output that climbs out of the run', ['--record=group-1:implementation/../../x.md'], 'in-flight-invalid'],
  ['an agent id for an agent never recorded', ['--agents=group-9:a1b2c3'], 'in-flight-invalid'],
  ['--ended for an agent never recorded', ['--ended=group-9'], 'in-flight-invalid'],
];

for (const [label, flags, code] of INVALID) {
  test(`in-flight refuses ${label} with ${code}, and writes nothing`, t => {
    const run = implementing(t);
    const refused = inFlight(run, flags);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(`^${code}: `));
    assert.ok(!fs.existsSync(path.join(run.impl, 'in-flight.json')));
  });
}

test('in-flight refuses an unreadable state, an unknown node and a node that is not running', t => {
  const run = implementing(t);
  const unreadable = verb(['in-flight', `--state=${path.join(run.dir, 'none.yml')}`, '--node=implementation', '--runner=implementation', `--record=${GROUPS}`]);
  assert.match(unreadable.stderr, /^in-flight-state-unreadable: /);
  const unknown = verb(['in-flight', `--state=${run.state}`, '--node=nowhere', '--runner=implementation', `--record=${GROUPS}`]);
  assert.match(unknown.stderr, /^in-flight-unknown-node: /);
  write(run, { nodes: { implementation: { status: 'completed' } } });
  const stopped = inFlight(run, [`--record=${GROUPS}`]);
  assert.match(stopped.stderr, /^in-flight-not-running: /);
});

// ---------------------------------------------------------------------------
// the waiting result and runner-step's wait
// ---------------------------------------------------------------------------

for (const make of [implementing, verifying]) {
  const label = make === implementing ? 'implementation' : 'verification';
  const items = make === implementing ? GROUPS : REVIEWS;
  const first = make === implementing ? 'group-1' : 'review-code-risk';
  const second = make === implementing ? 'group-2' : 'review-simplicity';
  const firstOutput = make === implementing ? 'implementation/group-reports/group-1.md' : 'verification/code-risk-review.md';
  const secondOutput = make === implementing ? 'implementation/group-reports/group-2.md' : 'verification/simplicity-review.md';

  test(`${label}: a runner forced to hand back ends waiting, and the node waits for the agents still out`, t => {
    const run = make(t);
    recorded(run, items);
    inFlight(run, [`--agents=${first}:a1b2c3`]);
    report(run, firstOutput);
    const written = result(run, { result: 'waiting', pending: [second] });
    assert.equal(written.code, 0, written.stderr);
    assert.deepEqual(stepOf(run), { next: 'wait', pending: [{ id: second, agent: null, output: secondOutput }] });

    // The agent reports: the runner goes back in to adopt it, never narrowed to inline.
    report(run, secondOutput);
    assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  });

  test(`${label}: unavailable is refused while an agent of this session is still out`, t => {
    const run = make(t);
    recorded(run, items);
    const refused = result(run, { result: 'unavailable', reason: 'made to hand back mid-wave' });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^runner-result-invalid: .*result.*waiting/s);
    assert.ok(!fs.existsSync(path.join(run.dir, run.runner, 'runner-result.json')));

    // From another session, the agents went with it: unavailable is the runner's to say.
    assert.equal(result(run, { result: 'unavailable', reason: 'No agent tool in this session' }, OTHER).code, 0);
  });

  test(`${label}: a runner that died without a result does not get a second agent on live work`, t => {
    const run = make(t);
    recorded(run, items);
    assert.equal(stepOf(run).next, 'wait', 'no result, two agents out: wait');
    report(run, firstOutput);
    assert.deepEqual(stepOf(run).pending.map(each => each.id), [second]);
  });

  test(`${label}: records of another session are not waited for`, t => {
    const run = make(t);
    recorded(run, items, OTHER);
    assert.equal(stepOf(run).next, 'dispatch');
  });

  test(`${label}: an agent that ended without its report is released with --ended`, t => {
    const run = make(t);
    recorded(run, items);
    report(run, firstOutput);
    assert.equal(result(run, { result: 'waiting', pending: [second] }).code, 0);
    assert.equal(stepOf(run).next, 'wait');
    const ended = inFlight(run, [`--ended=${second}`]);
    assert.equal(ended.code, 0, ended.stderr);
    assert.equal(flightFile(run).agents[second].ended, true);
    assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  });

  test(`${label}: a waiting result names only agents recorded in this attempt`, t => {
    const run = make(t);
    recorded(run, items);
    for (const pending of [[], ['nobody'], 'group-1']) {
      const refused = result(run, { result: 'waiting', pending });
      assert.equal(refused.code, 1, JSON.stringify(pending));
      assert.match(refused.stderr, /^runner-result-invalid: .*pending/s);
    }
  });
}

test('a forced hand-back mid-wave ends with every group done once, the run never narrowed to inline', t => {
  const run = implementing(t);
  recorded(run, GROUPS);
  // Group 1 reports and is recorded; the host makes the runner hand back with group 2 out.
  report(run, 'implementation/group-reports/group-1.md');
  const entry = path.join(run.impl, '.work-log-entry.md');
  const done = groups => {
    fs.writeFileSync(entry, groups.split(',').map(n => `## Group ${n}\n**Model**: sonnet (tier standard, planner: "plain code")\n`).join('\n'));
    assert.equal(verb(['group-done', `--plan=${run.plan}`, `--groups=${groups}`, `--entry-file=${entry}`]).code, 0);
  };
  done('1');
  assert.equal(result(run, { result: 'waiting', pending: ['group-2'] }).code, 0);
  assert.equal(stepOf(run).next, 'wait');

  // Group 2's implementer, still running, reports; the runner goes back in and adopts it.
  report(run, 'implementation/group-reports/group-2.md');
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  done('2');
  const closing = {
    result: 'done', work_log_path: 'implementation/work-log.md',
    summary: { groups_done: 2, groups_total: 2, models: 'standard 2', test_suite: 'passed: 4 of 4', docs_changed: [], standard_candidates: [], stopped: null },
  };
  assert.equal(result(run, closing).code, 0);
  assert.equal(stepOf(run).next, 'close');
  const log = fs.readFileSync(path.join(run.impl, 'work-log.md'), 'utf8');
  for (const group of [1, 2]) assert.equal(log.match(new RegExp(`Group ${group} Complete`, 'g'))?.length, 1);
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /mode: inline/);
});

test('a host that names no session waits for nothing, as before', t => {
  const run = implementing(t);
  recorded(run, GROUPS, '');
  assert.equal(flightFile(run).agents['group-1'].session, null);
  assert.equal(stepOf(run).next, 'dispatch');
});

// ---------------------------------------------------------------------------
// re-check cycles: an earlier cycle's report is never lost or waited on
// ---------------------------------------------------------------------------

const nextCycle = (run, cycle) => write(run, { verification_context: { cycle, snapshot: `tree-${cycle}`, last_status: null, issues_found: [] } });
const onDisk = (run, rel) => fs.existsSync(path.join(run.dir, ...rel.split('/')));
const readRun = (run, rel) => fs.readFileSync(path.join(run.dir, ...rel.split('/')), 'utf8');

test('a re-check recorded at the full report\'s path keeps the cycle-1 report, and ends on dispatch once the runner marks it ended', t => {
  const run = verifying(t);
  // Cycle 1: the full review, under an id an earlier runner derived from the report's file name.
  recorded(run, 'review-code-risk-review:verification/code-risk-review.md');
  report(run, 'verification/code-risk-review.md', '# Code risk review, cycle 1\n');

  // Cycle 2: the re-check, recorded at the full report's path under another id.
  nextCycle(run, 2);
  recorded(run, 'review-code-risk:verification/code-risk-review.md');
  assert.equal(readRun(run, 'verification/code-risk-review.md'), '# Code risk review, cycle 1\n', 'the earlier cycle\'s report stays as it is');

  // The reviewer writes the re-check under the contract's name, never the recorded one.
  report(run, 'verification/code-risk-review-recheck-2.md', '# Code risk re-check, cycle 2\n');
  const waiting = stepOf(run);
  assert.equal(waiting.next, 'wait');
  assert.deepEqual(waiting.pending.map(each => each.id), ['review-code-risk'], 'the cycle-1 record is never waited on');

  // The runner sees the recorded output missing and marks the agent ended at once.
  assert.equal(inFlight(run, ['--ended=review-code-risk']).code, 0);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  assert.equal(readRun(run, 'verification/code-risk-review.md'), '# Code risk review, cycle 1\n');
});

test('a re-check recorded at its own name is answered by that file, and the cycle-1 report is kept', t => {
  const run = verifying(t);
  recorded(run, 'review-code-risk:verification/code-risk-review.md');
  report(run, 'verification/code-risk-review.md', '# Code risk review, cycle 1\n');
  nextCycle(run, 2);
  recorded(run, 'review-code-risk:verification/code-risk-review-recheck-2.md');
  assert.equal(stepOf(run).next, 'wait');
  report(run, 'verification/code-risk-review-recheck-2.md', '# Code risk re-check, cycle 2\n');
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  assert.ok(onDisk(run, 'verification/code-risk-review.md'));
});

test('an earlier cycle\'s records are never waited on, whatever their output', t => {
  const run = verifying(t);
  recorded(run, REVIEWS);
  nextCycle(run, 2);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  assert.equal(result(run, { result: 'unavailable', reason: 'No agent tool in this session' }).code, 0,
    'nothing of this cycle is out, so unavailable is the runner\'s to say');
});

test('the suite re-recorded in a later cycle keeps the earlier results and waits until the file is written again', t => {
  const run = verifying(t);
  recorded(run, 'suite:verification/test-suite-results.md');
  report(run, 'verification/test-suite-results.md', 'Cycle 1: 4 passed\n');
  nextCycle(run, 2);
  recorded(run, 'suite:verification/test-suite-results.md');
  assert.equal(readRun(run, 'verification/test-suite-results.md'), 'Cycle 1: 4 passed\n', 'an earlier cycle\'s file is never deleted');
  assert.ok(flightFile(run).agents.suite.kept, 'the record keeps the earlier file\'s fingerprint');
  assert.deepEqual(stepOf(run).pending.map(each => each.id), ['suite'], 'the earlier results do not answer this cycle\'s dispatch');

  // Recorded again in the same cycle, the untouched earlier file is still kept.
  recorded(run, 'suite:verification/test-suite-results.md');
  assert.ok(onDisk(run, 'verification/test-suite-results.md'));
  assert.equal(stepOf(run).next, 'wait');

  report(run, 'verification/test-suite-results.md', 'Cycle 2: 5 passed, 1 failed\n');
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
});

test('in-flight --record clears the same cycle\'s stale output', t => {
  const run = verifying(t);
  recorded(run, REVIEWS);
  report(run, 'verification/code-risk-review.md', 'a review this cycle sent earlier');
  recorded(run, 'review-code-risk:verification/code-risk-review.md');
  assert.ok(!onDisk(run, 'verification/code-risk-review.md'));
  assert.equal(flightFile(run).agents['review-code-risk'].kept, undefined);
});

test('the implementation runner shares the record and is unaffected: no cycle, a re-sent group\'s report cleared, waited on in any cycle', t => {
  const run = implementing(t);
  write(run, { verification_context: { cycle: 3, node: 'review', attempt: 1 } });
  recorded(run, GROUPS);
  assert.equal(flightFile(run).agents['group-1'].cycle, undefined);
  report(run, 'implementation/group-reports/group-1.md', 'the first try');
  recorded(run, 'group-1:implementation/group-reports/group-1.md');
  assert.ok(!onDisk(run, 'implementation/group-reports/group-1.md'), 'a retried group\'s report answers the latest dispatch');
  assert.deepEqual(stepOf(run).pending.map(each => each.id), ['group-1', 'group-2']);
});

// ---------------------------------------------------------------------------
// the prose: the executor waits, the runners record and end waiting
// ---------------------------------------------------------------------------

const PLUGIN = path.join(ROOT, 'plugins/maister');
const read = rel => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');

for (const [runner, handOff] of [
  ['agents/implementation-runner.md', 'skills/implementation-plan-executor/SKILL.md'],
  ['agents/verification-runner.md', 'skills/implementation-verifier/SKILL.md'],
]) {
  test(`${runner} records its agents before they act and ends waiting, never unavailable, with agents out`, () => {
    const text = read(runner);
    assert.match(text, /`in-flight --state=<state> --node=<node>[^`]*--record=/);
    assert.match(text, /\*\*`waiting`\*\*/);
    assert.match(text, /never `unavailable`/);
  });

  test(`${handOff} waits for the agents still out and never narrows on a wait`, () => {
    const text = read(handOff);
    assert.match(text, /- \*\*`wait`\*\* — /);
    assert.match(text, /--ended=/);
    assert.match(text, /never a loop with agents still out/);
  });
}

test('the verification runner records a re-check at its own name, under one fixed id', () => {
  const text = read('agents/verification-runner.md');
  assert.match(text, /--record=review-<stem>:verification\/<stem>-review\.md/);
  assert.match(text, /`verification\/<stem>-review-recheck-<cycle>\.md`/);
  assert.doesNotMatch(text, /review-<stem>:verification\/<stem>\.md/);
});

test('the implementer writes its report to the path its prompt names', () => {
  assert.match(read('agents/task-group-implementer.md'), /`report_path`/);
});
