import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freezePatch, readState, scratch, verb, write } from '../helpers.mjs';

// The implementation runner's contract in code: the same two verbs as the
// verification runner's, under `--runner=implementation`. The runner ends
// every dispatch with one result — done, a decision, or unavailable — and the
// node reads its next step from `runner-step`. A crash at any point is one
// more `runner-step`, which picks the same path from the plan, the work log
// and the runner's files. Every group and question here is made up.

const DEPTH_ENV = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
const NODE = 'implementation';
const RUNNER = '--runner=implementation';

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

### Task Group 3: Command
**Dependencies:** 1
**Files to Modify:** src/command.js

- [ ] 3.1 Write the command tests
- [ ] 3.2 Implement the command

### Task Group 4: Docs
**Dependencies:** 2
**Files to Modify:** README.md

- [ ] 4.1 Document the writer
`;

/** A run of the sample with its executor node running, frozen on `host` under `env`. */
function implementing(t, { host = 'claude', env = {}, orchestrator = {} } = {}) {
  const run = scratch(t);
  const { patch } = freezePatch({ orchestrator });
  const frozen = verb(['write-state', `--state=${run.state}`, ...(host === null ? [] : [`--host=${host}`])], patch, env);
  assert.equal(frozen.code, 0, frozen.stderr);
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, [NODE]: { status: 'running' } } });
  const dir = path.join(run.dir, 'implementation');
  fs.mkdirSync(dir, { recursive: true });
  run.plan = path.join(dir, 'implementation-plan.md');
  run.log = path.join(dir, 'work-log.md');
  run.entry = path.join(dir, '.work-log-entry.md');
  run.impl = dir;
  fs.writeFileSync(run.plan, PLAN);
  return run;
}

const step = (run, extra = []) => verb(['runner-step', `--state=${run.state}`, `--node=${NODE}`, RUNNER, ...extra]);
const stepOf = (run, extra) => {
  const result = step(run, extra);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const record = (run, result) => verb(['runner-result', `--state=${run.state}`, `--node=${NODE}`, RUNNER], result);

/** What the runner does at its start, at a wave's start and at a group's return. */
const openLog = run => fs.writeFileSync(run.log, '# Work Log\n\n## 2026-01-05T09:00:00Z - Implementation Started\n\n**Total Steps**: 7\n');
const waveStart = (run, wave, groups) => {
  const result = verb(['wave-start', `--plan=${run.plan}`, `--wave=${wave}`, `--groups=${groups}`]);
  assert.equal(result.code, 0, result.stderr);
};
const groupDone = (run, groups) => {
  fs.writeFileSync(run.entry, groups.split(',').map(n => `## Group ${n}\n**Model**: sonnet (tier standard, planner: "plain code")\n**Tests**: 2 passed\n`).join('\n'));
  const result = verb(['group-done', `--plan=${run.plan}`, `--groups=${groups}`, `--entry-file=${run.entry}`]);
  assert.equal(result.code, 0, result.stderr);
};
const read = file => fs.readFileSync(file, 'utf8');

/** A group-failure question set as the runner writes it for a decision. */
function placeQuestions(run, name = 'decision-group-3.json') {
  const set = {
    questions: [{
      id: `${NODE}-group-3`, header: 'Group 3 failed',
      question: 'Group Command failed: the command test cannot find the parser export. What now?',
      why: 'Escalated once from standard to deep; the same import error came back.',
      allow_other: false,
      options: [
        { id: 'fix', label: 'Apply the suggested fix', description: 'Export parse from src/parser.js, then run the group again', recommended: true },
        { id: 'retry', label: 'Retry the group', description: 'Runs the group again with the failure in its prompt' },
        { id: 'undo', label: 'Undo this group\'s changes', description: 'Reverts what the group changed' },
        { id: 'stop', label: 'Stop', description: 'Stops here; the group\'s changes stay as they are' },
      ],
    }],
  };
  fs.writeFileSync(path.join(run.impl, name), JSON.stringify(set, null, 2));
  return `implementation/${name}`;
}
const answer = (label, extra = {}) => ({ decision: label, by: 'operator', question_id: `${NODE}-group-3`, question: 'Q', answer: label, ...extra });

const DONE = {
  result: 'done', work_log_path: 'implementation/work-log.md',
  summary: {
    groups_done: 4, groups_total: 4, models: 'light 1, standard 3, escalations 1', test_suite: 'passed: 40 of 40',
    docs_changed: [], standard_candidates: ['Every command validates its input before reading a file'], stopped: null,
  },
};
const needs = (questionsFile = 'implementation/decision-group-3.json', kind = 'groups') => ({
  result: 'needs_decision', decision: { kind, questions_file: questionsFile, wave: 2 },
});
const UNAVAILABLE = { result: 'unavailable', reason: 'No agent tool in this session: the runner cannot dispatch the groups' };

// ---------------------------------------------------------------------------
// runner-result --runner=implementation
// ---------------------------------------------------------------------------

for (const [label, result] of [['done', DONE], ['a decision', needs()], ['unavailable', UNAVAILABLE]]) {
  test(`runner-result writes ${label} under implementation/, stamped with the node, its attempt and the pass`, t => {
    const run = implementing(t);
    if (result.result === 'needs_decision') placeQuestions(run);
    const written = record(run, result);
    assert.equal(written.code, 0, written.stderr);
    const expected = { node: NODE, attempt: 1, pass: 1, ...result };
    assert.deepEqual(JSON.parse(written.stdout), expected, 'the final message is the file as written');
    assert.deepEqual(JSON.parse(read(path.join(run.impl, 'runner-result.json'))), expected);
    assert.equal(fs.existsSync(path.join(run.dir, 'verification', 'runner-result.json')), false, 'the verification folder is not touched');
  });
}

const INVALID = [
  ['a verification verdict', { result: 'verdict', verdict: 'passed', report_path: 'verification/x.md' }, 'verdict'],
  ['an unknown result', { ...DONE, result: 'finished' }, 'result'],
  ['done with no work log', (({ work_log_path: _w, ...rest }) => rest)(DONE), 'work_log_path'],
  ['a work log leaving the run', { ...DONE, work_log_path: '../work-log.md' }, 'work_log_path'],
  ['done with no summary', (({ summary: _s, ...rest }) => rest)(DONE), 'summary'],
  ['a summary key nobody reads', { ...DONE, summary: { ...DONE.summary, duration: '1h' } }, 'summary.duration'],
  ['more groups done than planned', { ...DONE, summary: { ...DONE.summary, groups_done: 5 } }, 'summary.groups_done'],
  ['a tally of two lines', { ...DONE, summary: { ...DONE.summary, models: 'light 1\nstandard 3' } }, 'summary.models'],
  ['a candidate that is no line', { ...DONE, summary: { ...DONE.summary, standard_candidates: [3] } }, 'summary.standard_candidates'],
  ['a stop with no reason', { ...DONE, summary: { ...DONE.summary, stopped: '' } }, 'summary.stopped'],
  ['done carrying a decision', { ...DONE, decision: needs().decision }, 'decision'],
  ['a decision with a summary', { ...needs(), summary: DONE.summary }, 'summary'],
  ['a decision of an unknown kind', { ...needs(), decision: { ...needs().decision, kind: 'findings' } }, 'decision.kind'],
  ['a decision with no questions file', { ...needs('implementation/none.json') }, 'decision.questions_file'],
  ['a decision with no wave', { ...needs(), decision: { kind: 'groups', questions_file: 'implementation/decision-group-3.json' } }, 'decision.wave'],
  ['unavailable with no reason', { result: 'unavailable' }, 'reason'],
];

for (const [label, result, field] of INVALID) {
  test(`runner-result --runner=implementation refuses ${label}, naming ${field}, and writes nothing`, t => {
    const run = implementing(t);
    placeQuestions(run);
    const written = record(run, result);
    assert.equal(written.code, 1);
    assert.match(written.stderr, new RegExp(`^runner-result-invalid: .*implementation runner's result shape at ${field.replace(/\./g, '\\.')}\\. Nothing was written`));
    assert.equal(fs.existsSync(path.join(run.impl, 'runner-result.json')), false);
  });
}

test('a questions file the engine cannot ask is refused as the decision\'s', t => {
  const run = implementing(t);
  fs.writeFileSync(path.join(run.impl, 'decision-bad.json'), JSON.stringify({ questions: [{ id: 'q', question: 'Q?', options: [{ label: 'One' }, { label: 'Two' }] }] }));
  const written = record(run, needs('implementation/decision-bad.json'));
  assert.equal(written.code, 1);
  assert.match(written.stderr, /at decision\.questions_file\./);
});

test('--runner takes only the two loops', t => {
  const run = implementing(t);
  for (const args of [['runner-step', `--state=${run.state}`, `--node=${NODE}`, '--runner=analysis'], ['runner-result', `--state=${run.state}`, `--node=${NODE}`, '--runner=Implementation']]) {
    const result = verb(args, DONE);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /--runner must be one of verification, implementation/);
  }
});

// ---------------------------------------------------------------------------
// runner-step --runner=implementation
// ---------------------------------------------------------------------------

test('runner-step keeps the waves inline when the run is not nested, saying why', t => {
  const run = implementing(t, { env: { [DEPTH_ENV]: '1' } });
  assert.deepEqual(stepOf(run), { next: 'inline', reason: 'delegation is inline (CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH)' });
});

test('runner-step dispatches fresh with no work log, and continues from the files once one exists', t => {
  const run = implementing(t);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'fresh' });
  openLog(run);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
});

test('runner-step closes on done with the summary, and reports unavailable', t => {
  const run = implementing(t);
  assert.equal(record(run, DONE).code, 0);
  assert.deepEqual(stepOf(run), { next: 'close', work_log_path: DONE.work_log_path, summary: DONE.summary });

  const other = implementing(t);
  assert.equal(record(other, UNAVAILABLE).code, 0);
  assert.deepEqual(stepOf(other), { next: 'unavailable', reason: UNAVAILABLE.reason });
});

test('the two runners never read each other\'s results', t => {
  const run = implementing(t);
  openLog(run);
  assert.equal(record(run, DONE).code, 0);
  const verification = JSON.parse(verb(['runner-step', `--state=${run.state}`, `--node=${NODE}`]).stdout);
  assert.deepEqual(verification, { next: 'dispatch', resume: 'fresh' }, 'verification sees no result of its own');
  assert.equal(stepOf(run).next, 'close');
});

test('a result of another attempt is not acted on, and an unusable one is a warning', t => {
  const run = implementing(t);
  openLog(run);
  assert.equal(record(run, DONE).code, 0);
  const file = path.join(run.impl, 'runner-result.json');
  const doc = JSON.parse(read(file));
  fs.writeFileSync(file, JSON.stringify({ ...doc, attempt: 2 }));
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  fs.writeFileSync(file, JSON.stringify({ ...doc, summary: null }));
  const result = step(run);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { next: 'dispatch', resume: 'auto' });
  assert.match(result.stderr, /^warning: runner-result-unusable: implementation\/runner-result\.json breaks the result shape at summary; the runner continues from the files/m);
});

test('in session a decision is asked, then the recorded answer becomes the decisions file', t => {
  const run = implementing(t);
  openLog(run);
  const questions = placeQuestions(run);
  assert.equal(record(run, needs(questions)).code, 0);
  assert.deepEqual(stepOf(run), { next: 'ask', pass: 1, kind: 'groups', questions_file: questions, asking: 'session', classes_questions: false });
  write(run, { node_summaries: { [NODE]: { decisions: [answer('Retry the group')] } } });
  const answered = step(run, ['--answered']);
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(JSON.parse(answered.stdout), { next: 'dispatch', resume: { pass: 1, decisions_file: 'implementation/decisions-1.json' } });
  assert.deepEqual(JSON.parse(read(path.join(run.impl, 'decisions-1.json'))), {
    node: NODE, attempt: 1, pass: 1, kind: 'groups', answers: [{ id: `${NODE}-group-3`, answer: 'Retry the group', by: 'operator' }],
  });
  // The next decision of the attempt is pass 2.
  assert.equal(record(run, needs(questions)).code, 0);
  assert.equal(JSON.parse(read(path.join(run.impl, 'runner-result.json'))).pass, 2);
});

test('an answer recorded by its option id is read as the label; an unanswered question takes its default', t => {
  const run = implementing(t);
  openLog(run);
  assert.equal(record(run, needs(placeQuestions(run))).code, 0);
  write(run, { node_summaries: { [NODE]: { decisions: [answer('undo')] } } });
  stepOf(run, ['--answered']);
  assert.equal(JSON.parse(read(path.join(run.impl, 'decisions-1.json'))).answers[0].answer, 'Undo this group\'s changes');

  const other = implementing(t);
  openLog(other);
  assert.equal(record(other, needs(placeQuestions(other))).code, 0);
  stepOf(other, ['--answered']);
  assert.deepEqual(JSON.parse(read(path.join(other.impl, 'decisions-1.json'))).answers,
    [{ id: `${NODE}-group-3`, answer: 'Apply the suggested fix', by: 'default' }]);
});

test('an answer from an earlier attempt is history, not this decision\'s answer', t => {
  const run = implementing(t);
  openLog(run);
  assert.equal(record(run, needs(placeQuestions(run))).code, 0);
  write(run, { node_summaries: { [NODE]: { decisions: [answer('Stop', { attempt: 0 })] } } });
  stepOf(run, ['--answered']);
  assert.equal(JSON.parse(read(path.join(run.impl, 'decisions-1.json'))).answers[0].by, 'default');
});

const COCKPIT = { driver: { kind: 'cockpit', features: ['question-sets'] } };

test('under a cockpit with question sets the decision suspends, and the folded answer is used once', t => {
  const run = implementing(t, { orchestrator: COCKPIT });
  openLog(run);
  const questions = placeQuestions(run);
  assert.equal(record(run, needs(questions)).code, 0);
  assert.equal(stepOf(run).asking, 'suspend');
  write(run, { node_summaries: { [NODE]: { decisions: [answer('Retry the group', { by: 'operator' })] } } });
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { pass: 1, decisions_file: 'implementation/decisions-1.json' } });
  // A later decision of the attempt takes the defaults: the one request is spent.
  assert.equal(record(run, needs(questions)).code, 0);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { pass: 2, decisions_file: 'implementation/decisions-2.json' } });
  assert.equal(JSON.parse(read(path.join(run.impl, 'decisions-2.json'))).answers[0].by, 'default');
});

test('a run nobody can ask takes the defaults at once, or the classing write when it classes', t => {
  const run = implementing(t, { orchestrator: { driver: { kind: 'dispatch' } } });
  openLog(run);
  assert.equal(record(run, needs(placeQuestions(run))).code, 0);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { pass: 1, decisions_file: 'implementation/decisions-1.json' } });
  assert.equal(JSON.parse(read(path.join(run.impl, 'decisions-1.json'))).answers[0].answer, 'Apply the suggested fix');

  // The freeze records whether the run's policy classes questions; no patch sets it.
  const classing = implementing(t, { orchestrator: { driver: { kind: 'dispatch' } } });
  fs.writeFileSync(classing.state, read(classing.state).replace(/^orchestrator:\n/m, 'orchestrator:\n  classes_questions: true\n'));
  openLog(classing);
  assert.equal(record(classing, needs(placeQuestions(classing))).code, 0);
  assert.equal(stepOf(classing).asking, 'none');
});

// ---------------------------------------------------------------------------
// the crash table: a kill at any point resumes into the same end
// ---------------------------------------------------------------------------

/** The runner's first wave as it records it: G1 and G2 start, then return. */
const firstWave = run => {
  openLog(run);
  waveStart(run, 1, '1,2');
  groupDone(run, '1,2');
};
/** The second wave starts; G3 fails twice and G4 returns; the decision goes back. */
const decisionInWave2 = run => {
  firstWave(run);
  waveStart(run, 2, '3,4');
  groupDone(run, '4');
  assert.equal(record(run, needs(placeQuestions(run))).code, 0);
};
const answered = run => {
  decisionInWave2(run);
  write(run, { node_summaries: { [NODE]: { decisions: [answer('Retry the group')] } } });
};

/**
 * Each crash point leaves the files as they stand there; one `runner-step`
 * names the next move, and following the contract from there — the runner
 * recording what is left through the same idempotent verbs — reaches the end
 * the uninterrupted run reached: every group done once, one result `done`.
 */
const CRASHES = [
  ['before the first dispatch', () => {}, { next: 'dispatch', resume: 'fresh' }],
  ['mid-wave, the runner killed after wave-start', run => { openLog(run); waveStart(run, 1, '1,2'); }, { next: 'dispatch', resume: 'auto' }],
  ['after a group returned, before its group-done', run => { openLog(run); waveStart(run, 1, '1,2'); groupDone(run, '1'); }, { next: 'dispatch', resume: 'auto' }],
  ['after the decision was returned, before it was asked', decisionInWave2, { next: 'ask' }],
  ['after the answer was recorded, before the decisions file', answered, { next: 'ask' }],
  ['after the decisions file, before the re-dispatch', run => { answered(run); stepOf(run, ['--answered']); },
    { next: 'dispatch', resume: { pass: 1, decisions_file: 'implementation/decisions-1.json' } }],
  ['after the re-dispatched runner retried the group, before its result', run => {
    answered(run); stepOf(run, ['--answered']); groupDone(run, '3');
  }, { next: 'dispatch', resume: { pass: 1, decisions_file: 'implementation/decisions-1.json' } }],
  ['after the last wave, before the node closed', run => {
    firstWave(run); waveStart(run, 2, '3,4'); groupDone(run, '3,4'); assert.equal(record(run, DONE).code, 0);
  }, { next: 'close' }],
];

for (const [label, arrange, expected] of CRASHES) {
  test(`a crash ${label} resumes through runner-step`, t => {
    const run = implementing(t);
    arrange(run);
    const next = stepOf(run);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(next[key], value, `${label}: ${key}`);
    // Following the contract from here: an open decision is answered, the
    // runner records whatever is left — a repeated verb writes nothing twice —
    // and ends with done; the node closes on it.
    if (next.next === 'ask') stepOf(run, ['--answered']);
    if (next.next !== 'close') {
      if (!fs.existsSync(run.log)) openLog(run);
      for (const [wave, groups] of [[1, [1, 2]], [2, [3, 4]]]) {
        const open = groups.filter(group => new RegExp(`- \\[ \\] ${group}\\.`).test(read(run.plan)));
        if (!open.length) continue;
        waveStart(run, wave, open.join(','));
        groupDone(run, open.join(','));
      }
      assert.equal(record(run, DONE).code, 0);
    }
    assert.equal(stepOf(run).next, 'close');
    const log = read(run.log);
    for (const group of [1, 2, 3, 4]) {
      assert.equal(log.match(new RegExp(`Group ${group} Complete`, 'g'))?.length, 1, `${label}: group ${group} logged once`);
    }
    assert.doesNotMatch(read(run.plan), /- \[ \]/, `${label}: every step ticked`);
    assert.equal(readState(run).workflow.nodes[NODE].status, 'running', 'only the node closes itself');
  });
}

// ---------------------------------------------------------------------------
// the delegation mode is shown while the executor runs
// ---------------------------------------------------------------------------

test('the status line names the delegation mode while the executor runs', t => {
  const run = implementing(t);
  write(run, { orchestrator: { options: { delegation: { mode: 'inline', reason: 'No agent tool' } } } });
  const status = JSON.parse(read(path.join(run.dir, 'display', 'status.json')));
  assert.match(status.line, / · inline · /);
});
