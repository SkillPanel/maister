import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freezePatch, readState, scratch, verb, write } from '../helpers.mjs';

// The verification runner's contract in code. The runner ends every dispatch
// with one result, written through `runner-result`; the node reads its next
// step from `runner-step`: keep the loop inline, dispatch the runner (fresh,
// continuing from the cycle files, or with a decisions file), ask the decision
// the runner returned, or close on its verdict. A crash at any point is one
// more `runner-step`, which picks the same path from the files. Every finding
// here is made up.

const OVERLAY = path.join(FIXTURES, 'definitions/sample.overlay.yml');
const DEPTH_ENV = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
const NODE = 'review';
const qid = id => `${NODE}-findings-${id}`;
const answer = (id, label) => ({ decision: label, by: 'operator', question_id: qid(id), question: 'Q', answer: label });

/** A run of the sample with the verifier node `review` running, frozen on `host` under `env`. */
function verifying(t, { host = 'claude', env = {}, orchestrator = {} } = {}) {
  const run = scratch(t);
  const { patch } = freezePatch({ overlays: [OVERLAY], orchestrator });
  const frozen = verb(['write-state', `--state=${run.state}`, ...(host === null ? [] : [`--host=${host}`])], patch, env);
  assert.equal(frozen.code, 0, frozen.stderr);
  write(run, { nodes: { implementation: { status: 'completed' }, [NODE]: { status: 'running' } } });
  return { ...run, verification: path.join(run.dir, 'verification') };
}

const step = (run, extra = []) => verb(['runner-step', `--state=${run.state}`, `--node=${NODE}`, ...extra]);
const stepOf = (run, extra) => {
  const result = step(run, extra);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const record = (run, result) => verb(['runner-result', `--state=${run.state}`, `--node=${NODE}`], result);

/** What the runner writes at a cycle's entry. */
const cycleEntry = (run, cycle, { node = NODE, attempt = 1 } = {}) => write(run, {
  verification_context: { cycle, snapshot: `tree-${cycle}`, node, attempt, last_status: null, issues_found: [] },
});

/** A findings list as the runner writes it for a decision. */
function placeFindings(run, file = 'verification/verification-findings.json') {
  const findings = {
    findings: [
      {
        id: 'empty-upload', severity: 'critical', title: 'Server crashes on an empty upload',
        evidence: 'src/upload.ts:42 reads body.length of undefined',
        options: [{ label: 'Guard the empty body', description: 'Return 400 before reading the body' }],
        recommended: 0, reason: 'One guard closes the crash',
      },
      {
        id: 'public-route', severity: 'warning', title: 'The export route is public',
        evidence: 'src/routes.ts:8 has no auth guard',
        options: [{ label: 'Require a session', description: 'Callers without one get 401' }],
        recommended: null,
      },
    ],
  };
  const target = path.join(run.dir, ...file.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(findings, null, 2));
  return file;
}

const VERDICT = {
  result: 'verdict', verdict: 'passed_with_issues',
  report_path: 'verification/implementation-verification.md', findings_path: 'verification/findings.json',
  html_path: 'verification/implementation-verification.html', counts: { critical: 0, warning: 2, info: 1, fixed: 5 },
};
const needs = (cycle, kind = 'findings', findingsFile = 'verification/verification-findings.json') => ({
  result: 'needs_decision',
  report_path: 'verification/implementation-verification.md', findings_path: 'verification/findings.json',
  counts: { critical: 1, warning: 1, info: 0, fixed: 3 },
  decision: { kind, findings_file: findingsFile, resume_token: { cycle, snapshot: `tree-${cycle}` } },
});
const UNAVAILABLE = { result: 'unavailable', reason: 'No agent tool in this session: the runner cannot dispatch the reviews' };

// ---------------------------------------------------------------------------
// runner-result
// ---------------------------------------------------------------------------

for (const [label, result] of [['a verdict', VERDICT], ['a decision', needs(2)], ['unavailable', UNAVAILABLE]]) {
  test(`runner-result writes ${label}, stamped with the node, its attempt and the cycle`, t => {
    const run = verifying(t);
    cycleEntry(run, 2);
    if (result.result === 'needs_decision') placeFindings(run);
    const written = record(run, result);
    assert.equal(written.code, 0, written.stderr);
    const expected = { node: NODE, attempt: 1, cycle: 2, ...result };
    assert.deepEqual(JSON.parse(written.stdout), expected, 'the final message is the file as written');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.verification, 'runner-result.json'), 'utf8')), expected);
  });
}

test('runner-result before any cycle stamps a null cycle', t => {
  const run = verifying(t);
  const written = record(run, UNAVAILABLE);
  assert.equal(written.code, 0, written.stderr);
  assert.equal(JSON.parse(written.stdout).cycle, null);
});

const INVALID = [
  ['an unknown key', { ...VERDICT, extra: 1 }, 'extra'],
  ['an unknown result', { ...VERDICT, result: 'done' }, 'result'],
  ['a verdict outside the three', { ...VERDICT, verdict: 'ok' }, 'verdict'],
  ['a verdict with no report', (({ report_path: _r, ...rest }) => rest)(VERDICT), 'report_path'],
  ['a report path leaving the run', { ...VERDICT, report_path: '../elsewhere.md' }, 'report_path'],
  ['an absolute html path', { ...VERDICT, html_path: '/tmp/x.html' }, 'html_path'],
  ['a count that is no whole number', { ...VERDICT, counts: { critical: 0, warning: 1.5, info: 0, fixed: 0 } }, 'counts.warning'],
  ['a count missing', { ...VERDICT, counts: { critical: 0, warning: 0, info: 0 } }, 'counts.fixed'],
  ['a verdict carrying a decision', { ...VERDICT, decision: needs(1).decision }, 'decision'],
  ['a decision with a verdict', { ...needs(1), verdict: 'passed' }, 'verdict'],
  ['a decision of an unknown kind', { ...needs(1), decision: { ...needs(1).decision, kind: 'other' } }, 'decision.kind'],
  ['a findings decision with no list', { ...needs(1), decision: { ...needs(1).decision, findings_file: null } }, 'decision.findings_file'],
  ['a resume token with no cycle', { ...needs(1), decision: { ...needs(1).decision, resume_token: { snapshot: 'x' } } }, 'decision.resume_token.cycle'],
  ['unavailable with no reason', { result: 'unavailable' }, 'reason'],
  ['a reason of two lines', { result: 'unavailable', reason: 'one\ntwo' }, 'reason'],
];

for (const [label, result, field] of INVALID) {
  test(`runner-result refuses ${label}, naming ${field}, and writes nothing`, t => {
    const run = verifying(t);
    const refused = record(run, result);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(`^runner-result-invalid: .* at ${field.replace(/\./g, '\\.')}\\. Nothing was written`));
    assert.equal(fs.existsSync(path.join(run.verification, 'runner-result.json')), false);
  });
}

test('a budget decision may carry no findings list', t => {
  const run = verifying(t);
  cycleEntry(run, 3);
  assert.equal(record(run, needs(3, 'budget', null)).code, 0);
});

test('runner-result and runner-step refuse a node that is not running, or no node, or a gate', t => {
  const run = verifying(t);
  for (const name of ['runner-result', 'runner-step']) {
    const pending = verb([name, `--state=${run.state}`, '--node=implementation'], name === 'runner-result' ? VERDICT : undefined);
    assert.equal(pending.code, 1);
    assert.match(pending.stderr, new RegExp(`^${name}-not-running: --node=implementation is "completed"`));
    const unknown = verb([name, `--state=${run.state}`, '--node=nowhere'], name === 'runner-result' ? VERDICT : undefined);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, new RegExp(`^${name}-unknown-node: `));
    const unreadable = verb([name, `--state=${path.join(run.dir, 'missing.yml')}`, `--node=${NODE}`], name === 'runner-result' ? VERDICT : undefined);
    assert.equal(unreadable.code, 1);
    assert.match(unreadable.stderr, new RegExp(`^${name}-state-unreadable: `));
  }
});

test('runner-result reads the patch file and deletes it once the result landed', t => {
  const run = verifying(t);
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify({ ...VERDICT, verdict: 'nope' }));
  assert.equal(verb(['runner-result', `--state=${run.state}`, `--node=${NODE}`, `--patch-file=${patch}`]).code, 1);
  assert.equal(fs.existsSync(patch), true, 'a refusal keeps the patch for correcting');
  fs.writeFileSync(patch, JSON.stringify(VERDICT));
  assert.equal(verb(['runner-result', `--state=${run.state}`, `--node=${NODE}`, `--patch-file=${patch}`]).code, 0);
  assert.equal(fs.existsSync(patch), false);
});

// ---------------------------------------------------------------------------
// runner-step
// ---------------------------------------------------------------------------

test('runner-step keeps the loop inline when the run is not nested, saying why', t => {
  const shallow = verifying(t, { env: { [DEPTH_ENV]: '1' } });
  assert.deepEqual(stepOf(shallow), { next: 'inline', reason: `delegation is inline (${DEPTH_ENV})` });
  const bare = verifying(t, { host: null });
  assert.deepEqual(stepOf(bare), { next: 'inline', reason: 'the run recorded no delegation' });
});

test('runner-step keeps the loop inline on Copilot, also for a run frozen nested there earlier', t => {
  const reason = 'Copilot runs every subagent level under a session of its own, so the runners do not nest on this host';
  const copilot = verifying(t, { host: 'copilot' });
  assert.deepEqual(stepOf(copilot), { next: 'inline', reason });

  // A record written before Copilot runs were frozen inline: nested at
  // Copilot's depth, by hand here because no patch can set it.
  for (const source of ['copilot default', 'cockpit driver: SDK nesting checked at 0.3.285 (copilot default)']) {
    const earlier = verifying(t);
    const text = fs.readFileSync(earlier.state, 'utf8');
    const stale = text.replace('delegation: {mode: nested, depth: 3, source: "claude default"}', `delegation: {mode: nested, depth: 4, source: "${source}"}`);
    assert.notEqual(stale, text);
    fs.writeFileSync(earlier.state, stale);
    assert.deepEqual(stepOf(earlier), { next: 'inline', reason });
  }
});

test('runner-step dispatches fresh with no cycle recorded, and continues from the files after one', t => {
  const run = verifying(t);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'fresh' });
  cycleEntry(run, 1);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' }, 'a cycle under way and no result: the crash path');
});

test('runner-step closes on a verdict of this attempt, and reports unavailable', t => {
  const run = verifying(t);
  cycleEntry(run, 2);
  assert.equal(record(run, VERDICT).code, 0);
  const { result: _r, ...rest } = VERDICT;
  assert.deepEqual(stepOf(run), { next: 'close', ...rest });

  const other = verifying(t);
  assert.equal(record(other, UNAVAILABLE).code, 0);
  assert.deepEqual(stepOf(other), { next: 'unavailable', reason: UNAVAILABLE.reason });
});

test('a result of another node or attempt is not acted on', t => {
  const run = verifying(t);
  cycleEntry(run, 1);
  assert.equal(record(run, VERDICT).code, 0);
  const file = path.join(run.verification, 'runner-result.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...doc, attempt: 0 }));
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
  fs.writeFileSync(file, JSON.stringify({ ...doc, node: 'other' }));
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
});

test('a result file that cannot be used is a warning, and the runner continues from the files', t => {
  const run = verifying(t);
  cycleEntry(run, 1);
  fs.mkdirSync(run.verification, { recursive: true });
  const file = path.join(run.verification, 'runner-result.json');
  fs.writeFileSync(file, '{not json');
  let result = step(run);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { next: 'dispatch', resume: 'auto' });
  assert.match(result.stderr, /^warning: runner-result-unusable: verification\/runner-result\.json is not JSON/);
  fs.writeFileSync(file, JSON.stringify({ node: NODE, attempt: 1, cycle: 1, result: 'verdict', verdict: 'maybe', report_path: 'r.md' }));
  result = step(run);
  assert.match(result.stderr, /breaks the result shape at verdict/);
});

test('a migration-style hand-over: another node\'s cycle is continued, not restarted', t => {
  const run = verifying(t);
  cycleEntry(run, 1, { node: 'verification' });
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'auto' });
});

test('a new attempt of the same node starts a fresh cycle', t => {
  const run = verifying(t);
  cycleEntry(run, 2, { attempt: 0 });
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: 'fresh' });
});

test('in session a decision is asked, then the recorded answers become the decisions file', t => {
  const run = verifying(t);
  cycleEntry(run, 2);
  const findingsFile = placeFindings(run);
  assert.equal(record(run, needs(2)).code, 0);
  assert.deepEqual(stepOf(run), {
    next: 'ask', cycle: 2, kind: 'findings', findings_file: findingsFile, stop_question: false, asking: 'session', classes_questions: false,
  });

  write(run, {
    node_summaries: {
      [NODE]: {
        decisions: [{ decision: 'Guard the empty body', by: 'operator', question_id: qid('empty-upload'), question: 'Server crashes on an empty upload — how should it be settled?', answer: 'Guard the empty body' }],
      },
    },
  });
  const answered = step(run, ['--answered']);
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(JSON.parse(answered.stdout), { next: 'dispatch', resume: { cycle: 2, decisions_file: 'verification/decisions-2.json' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-2.json'), 'utf8')), {
    node: NODE, attempt: 1, cycle: 2, kind: 'findings',
    answers: [{ id: 'empty-upload', answer: 'Guard the empty body', by: 'operator' }, { id: 'public-route', answer: null, by: 'default' }],
    stop: null,
  });
  // Asked again before the runner moved on: the same decisions file, never a second question.
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { cycle: 2, decisions_file: 'verification/decisions-2.json' } });
});

test('an answer recorded by its option id is read as the option\'s label', t => {
  const run = verifying(t);
  cycleEntry(run, 1);
  placeFindings(run);
  assert.equal(record(run, needs(1)).code, 0);
  write(run, { node_summaries: { [NODE]: { decisions: [answer('empty-upload', 'option-1'), answer('public-route', 'accept-risk')] } } });
  stepOf(run, ['--answered']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-1.json'), 'utf8')).answers.map(item => item.answer),
    ['Guard the empty body', 'Accept the risk and list it']);
});

test('the stopping question is asked with the findings, and its label read as more, continue or stop', t => {
  for (const [label, stop] of [['One more round', 'more'], ['Continue as is', 'continue'], ['Stop here (Recommended): roll back', 'stop']]) {
    const run = verifying(t);
    cycleEntry(run, 3);
    placeFindings(run);
    assert.equal(record(run, needs(3, 'budget')).code, 0);
    assert.equal(stepOf(run).stop_question, true);
    write(run, { node_summaries: { [NODE]: { decisions: [{ decision: label, by: 'operator', question_id: 'verification-fix-loop', question: 'Two re-checks spent. What now?', answer: label }] } } });
    stepOf(run, ['--answered']);
    const decisions = JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-3.json'), 'utf8'));
    assert.equal(decisions.stop, stop, label);
    assert.equal(decisions.kind, 'budget');
  }
});

test('an answer from an earlier attempt is history, not this decision\'s answer', t => {
  const run = verifying(t);
  cycleEntry(run, 1);
  placeFindings(run);
  assert.equal(record(run, needs(1)).code, 0);
  const state = fs.readFileSync(run.state, 'utf8');
  write(run, { node_summaries: { [NODE]: { decisions: [{ decision: 'Guard the empty body', by: 'operator', question_id: qid('empty-upload'), question: 'Q', answer: 'Guard the empty body', attempt: 0 }] } } });
  assert.notEqual(fs.readFileSync(run.state, 'utf8'), state);
  stepOf(run, ['--answered']);
  const decisions = JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-1.json'), 'utf8'));
  assert.equal(decisions.answers[0].answer, null);
});

// ---------------------------------------------------------------------------
// under a driver
// ---------------------------------------------------------------------------

const COCKPIT = { kind: 'cockpit', cwd: '/work', session: 's-1', features: ['question-sets'] };

test('under a cockpit with question sets the decision suspends, and the folded answers are used once', t => {
  const run = verifying(t, { orchestrator: { driver: COCKPIT } });
  cycleEntry(run, 1);
  placeFindings(run);
  assert.equal(record(run, needs(1)).code, 0);
  assert.equal(stepOf(run).asking, 'suspend');

  // The answer comes back to a fresh session: no --answered, the fold is on the summary.
  write(run, { node_summaries: { [NODE]: { decisions: [answer('empty-upload', 'Guard the empty body'), answer('public-route', 'Accept the risk and list it')] } } });
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { cycle: 1, decisions_file: 'verification/decisions-1.json' } });
  // Each answer keeps the credit the writer gave it (only the real fold credits the operator).
  const credit = id => readState(run).node_summaries[NODE].decisions.find(item => item.question_id === qid(id)).by;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-1.json'), 'utf8')).answers, [
    { id: 'empty-upload', answer: 'Guard the empty body', by: credit('empty-upload') },
    { id: 'public-route', answer: 'Accept the risk and list it', by: credit('public-route') },
  ]);

  // A later decision in the same attempt cannot ask again: the defaults, and the stop at continue.
  cycleEntry(run, 3);
  assert.equal(record(run, needs(3, 'budget')).code, 0);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { cycle: 3, decisions_file: 'verification/decisions-3.json' } });
  const later = JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-3.json'), 'utf8'));
  assert.equal(later.stop, 'continue');
  assert.ok(later.answers.every(item => item.answer === null && item.by === 'default'));
});

test('a dispatched run that classes nothing takes the defaults at once', t => {
  const run = verifying(t, { orchestrator: { driver: { ...COCKPIT, dispatch_id: 'd-1' } } });
  cycleEntry(run, 1);
  placeFindings(run);
  assert.equal(record(run, needs(1)).code, 0);
  assert.deepEqual(stepOf(run), { next: 'dispatch', resume: { cycle: 1, decisions_file: 'verification/decisions-1.json' } });
  const decisions = JSON.parse(fs.readFileSync(path.join(run.verification, 'decisions-1.json'), 'utf8'));
  assert.deepEqual(decisions.answers.map(item => [item.answer, item.by]), [[null, 'default'], [null, 'default']]);
});

test('a cockpit without question sets cannot ask either', t => {
  const run = verifying(t, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work', session: 's-1' } } });
  cycleEntry(run, 1);
  placeFindings(run);
  assert.equal(record(run, needs(1)).code, 0);
  assert.equal(stepOf(run).next, 'dispatch');
});

// ---------------------------------------------------------------------------
// the crash table: a kill at any point resumes into the same end
// ---------------------------------------------------------------------------

/**
 * Each crash point leaves the files as they stand there; one `runner-step`
 * names the next move, and following the contract from there reaches the
 * verdict the uninterrupted run reached.
 */
const CRASHES = [
  ['before the first dispatch', () => {}, { next: 'dispatch', resume: 'fresh' }],
  ['mid-cycle, the runner killed', run => cycleEntry(run, 1), { next: 'dispatch', resume: 'auto' }],
  ['after the decision was returned, before it was asked', run => {
    cycleEntry(run, 1); placeFindings(run); assert.equal(record(run, needs(1)).code, 0);
  }, { next: 'ask' }],
  ['after the answers were recorded, before the decisions file', run => {
    cycleEntry(run, 1); placeFindings(run); assert.equal(record(run, needs(1)).code, 0);
    write(run, { node_summaries: { [NODE]: { decisions: [{ decision: 'Guard the empty body', by: 'operator', question_id: qid('empty-upload'), question: 'Q', answer: 'Guard the empty body' }] } } });
  }, { next: 'ask' }],
  ['after the decisions file, before the re-dispatch', run => {
    cycleEntry(run, 1); placeFindings(run); assert.equal(record(run, needs(1)).code, 0);
    write(run, { node_summaries: { [NODE]: { decisions: [{ decision: 'Guard the empty body', by: 'operator', question_id: qid('empty-upload'), question: 'Q', answer: 'Guard the empty body' }] } } });
    stepOf(run, ['--answered']);
  }, { next: 'dispatch', resume: { cycle: 1, decisions_file: 'verification/decisions-1.json' } }],
  ['after the re-dispatched runner started its next cycle', run => {
    cycleEntry(run, 1); placeFindings(run); assert.equal(record(run, needs(1)).code, 0);
    stepOf(run, ['--answered']);
    cycleEntry(run, 2);
  }, { next: 'dispatch', resume: 'auto' }],
  ['after the verdict, before the node closed', run => {
    cycleEntry(run, 2); assert.equal(record(run, VERDICT).code, 0);
  }, { next: 'close' }],
];

for (const [label, arrange, expected] of CRASHES) {
  test(`a crash ${label} resumes through runner-step`, t => {
    const run = verifying(t);
    arrange(run);
    const next = stepOf(run);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(next[key], value, `${label}: ${key}`);
    // Following the contract from here reaches the same end: the runner, once
    // dispatched, records its cycle and its verdict, and the node closes.
    if (next.next === 'ask') stepOf(run, ['--answered']);
    cycleEntry(run, 3);
    assert.equal(record(run, VERDICT).code, 0);
    assert.equal(stepOf(run).next, 'close');
    assert.equal(readState(run).workflow.nodes[NODE].status, 'running', 'only the node closes itself');
  });
}

// ---------------------------------------------------------------------------
// the delegation may narrow after the freeze, never widen
// ---------------------------------------------------------------------------

test('a nested run narrows to inline with a reason; the depth and the source stay', t => {
  const run = verifying(t);
  const reason = 'The runner had no agent tool in this session';
  const narrowed = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { delegation: { mode: 'inline', reason } } } });
  assert.equal(narrowed.code, 0, narrowed.stderr);
  assert.equal(narrowed.stderr, '');
  assert.deepEqual(readState(run).orchestrator.options.delegation, { mode: 'inline', depth: 3, source: 'claude default', reason });
  assert.deepEqual(stepOf(run), { next: 'inline', reason });
});

const NOTE = 'note: ignored the supplied orchestrator.options.delegation; the freeze records it from the host it names, so no patch sets it — after the freeze a nested run may only narrow it, as {mode: inline, reason}\n';

for (const [label, delegation, env] of [
  ['a widening to nested', { mode: 'nested', reason: 'try it' }, { [DEPTH_ENV]: '1' }],
  ['a narrowing with no reason', { mode: 'inline' }, {}],
  ['a narrowing that also sets the depth', { mode: 'inline', reason: 'r', depth: 1 }, {}],
  ['a narrowing whose reason is two lines', { mode: 'inline', reason: 'a\nb' }, {}],
]) {
  test(`write-state drops ${label}, with the note`, t => {
    const run = verifying(t, { env });
    const before = readState(run).orchestrator.options.delegation;
    const result = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { delegation } } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, NOTE);
    assert.deepEqual(readState(run).orchestrator.options.delegation, before);
  });
}

test('the status line names the narrowed mode while the verifier runs', t => {
  const run = verifying(t);
  write(run, { orchestrator: { options: { delegation: { mode: 'inline', reason: 'No agent tool' } } } });
  const status = JSON.parse(fs.readFileSync(path.join(run.dir, 'display', 'status.json'), 'utf8'));
  assert.match(status.line, / · inline · /);
});
