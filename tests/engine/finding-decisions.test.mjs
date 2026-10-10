import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, freezePatch, readState, run as runScript, scratch, sharedPlugin, verb, write } from '../helpers.mjs';
import { checkSet } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';
import { ACCEPT_OPTION, findingBrief } from '../../plugins/maister/skills/workflow-engine/scripts/lib/finding-brief.mjs';
import { outstandingHeld } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-triage.mjs';

// A reviewer's findings as the reviewing node's questions. The reviewer writes
// its findings as data — each with the fix it proposes, its alternatives and a
// recommendation — and `finding-brief` builds one question per finding, the
// accept-the-risk choice added, in severity order. A list the verb cannot use
// is a warning and nothing to paste; a wrong invocation is a refusal. Every
// finding here is made up.

const DEFINITION = path.join(FIXTURES, 'definitions/finding-review.yml');
const UNDECLARED = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const FINDINGS = 'verification/findings.json';

/** A run of `definition` frozen, with `node` running: the reviewing node, ready to ask. */
function reviewing(t, { definition = DEFINITION, node = 'review', status = 'running', driver = null } = {}) {
  const run = scratch(t);
  freeze(run, { definition, orchestrator: driver ? { driver } : {} });
  if (status !== null) write(run, { nodes: { [node]: { status } } });
  return { ...run, node, patch: path.join(run.dir, '.state-patch.json') };
}

/** A findings list in the shape a reviewer writes. */
function findingsList() {
  return {
    findings: [
      {
        id: 'slow-listing',
        severity: 'medium',
        title: 'Listing loads every row',
        evidence: 'src/list.ts:10 calls findAll() with no limit',
        options: [
          { label: 'Page the listing', description: 'Load fifty rows a page' },
          { label: 'Cap at a thousand', description: 'Stop at a thousand rows with a notice' },
        ],
        recommended: null,
      },
      {
        id: 'empty-upload',
        severity: 'critical',
        title: 'Server crashes on an empty upload',
        evidence: 'src/upload.ts:42 reads body.length of undefined',
        options: [{ label: 'Guard the empty body', description: 'Return 400 before reading the body' }],
        recommended: 0,
        reason: 'One guard closes the crash without changing valid uploads',
      },
      {
        id: 'log-noise',
        severity: 'info',
        title: 'Debug logging left on',
        evidence: 'src/log.ts:3 sets level to debug',
        options: [{ label: 'Set the level to info', description: 'Quiet logs in production' }],
        recommended: 'accept',
        reason: 'The noise costs nothing until the logs are shipped',
      },
      {
        id: 'missing-index',
        severity: 'critical',
        title: 'Lookup by email scans the table',
        evidence: 'migrations/004.sql adds users.email with no index',
        options: [{ label: 'Add the index', description: 'A unique index on users.email' }],
        recommended: 0,
        reason: 'Every login runs this lookup',
      },
    ],
  };
}

/** Write a findings list into the run, as `value` or as raw text. */
function place(run, value, relative = FINDINGS) {
  const file = path.join(run.dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

/** `finding-brief` through the entry point. */
function brief(run, { node = run.node, file = FINDINGS, patch = false } = {}) {
  const args = ['finding-brief', `--state=${run.state}`, `--node=${node}`, `--findings-file=${file}`];
  if (patch) args.push(`--patch-file=${run.patch}`);
  return verb(args);
}

/** The set printed on stdout, after a clean exit. */
function printed(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

/** A fallback: exit 0, nothing on stdout, the one warning on stderr. */
function fellBack(result, warning) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `warning: ${warning}\n`);
}

/** A refusal: exit 1, nothing on stdout, the code first on stderr and the message's promise kept. */
function refused(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}: `));
  assert.match(result.stderr, /Nothing was written\./);
}

const byId = (set, id) => set.questions.find(question => question.id === id);
const recommendedOf = question => question.options.filter(option => option.recommended).map(option => option.id);

// ---------------------------------------------------------------------------
// 1. the set built from a findings list
// ---------------------------------------------------------------------------

test('finding-brief: one question per finding, most severe first, the reviewer\'s choices then accept-risk', t => {
  const run = reviewing(t);
  place(run, findingsList());
  const set = printed(brief(run));
  assert.deepEqual(set.questions.map(question => question.id), [
    'review-findings-empty-upload',
    'review-findings-missing-index',
    'review-findings-slow-listing',
    'review-findings-log-noise',
  ]);
  for (const question of set.questions) {
    assert.equal(question.multi_select, false);
    assert.equal(Object.hasOwn(question, 'allow_other'), false, 'allow_other left at its default');
    assert.equal(Object.hasOwn(question, 'triage'), false, 'the verb never classes');
    assert.equal(Object.hasOwn(question, 'default'), false, 'the request generates the default');
    assert.deepEqual(question.options.at(-1).id, ACCEPT_OPTION.id);
    assert.equal(question.options.at(-1).label, 'Accept the risk and list it');
  }

  const crash = byId(set, 'review-findings-empty-upload');
  assert.deepEqual(crash.options.map(option => option.id), ['option-1', 'accept-risk']);
  assert.equal(crash.header, 'Empty upload');
  assert.equal(crash.question, 'Server crashes on an empty upload — how should it be settled?');
  assert.equal(crash.why, 'Critical: src/upload.ts:42 reads body.length of undefined');
  assert.deepEqual(crash.options[0], {
    id: 'option-1',
    label: 'Guard the empty body',
    description: 'Return 400 before reading the body. Recommended: One guard closes the crash without changing valid uploads',
    recommended: true,
  });
  assert.match(crash.details, /src\/upload\.ts:42 reads body\.length of undefined/);
  assert.match(crash.details, /Return 400 before reading the body/);
  assert.match(crash.details, /Leave it as it is; it is listed as a tradeoff at the next checkpoint/);
  assert.match(crash.details, /\*\*Why recommended\*\*: One guard closes the crash/);

  const listing = byId(set, 'review-findings-slow-listing');
  assert.deepEqual(listing.options.map(option => option.id), ['option-1', 'option-2', 'accept-risk']);
  assert.deepEqual(recommendedOf(listing), [], 'a null recommendation recommends nothing');
  assert.equal(listing.why, 'Medium: src/list.ts:10 calls findAll() with no limit');

  const noise = byId(set, 'review-findings-log-noise');
  assert.deepEqual(recommendedOf(noise), ['accept-risk']);
  assert.equal(noise.options.at(-1).description,
    'Leave it as it is; it is listed as a tradeoff at the next checkpoint. Recommended: The noise costs nothing until the logs are shipped');
  assert.equal(noise.why, 'Info: src/log.ts:3 sets level to debug');

  const checked = checkSet(set);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(byId(checked.set, 'review-findings-empty-upload').default, 'option-1');
  assert.equal(Object.hasOwn(byId(checked.set, 'review-findings-slow-listing'), 'default'), false);
  assert.equal(byId(checked.set, 'review-findings-log-noise').default, 'accept-risk');
  for (const question of checked.set.questions) assert.ok([...question.header].length <= 12, question.header);
});

test('finding-brief --patch-file writes the set there and prints the file', t => {
  const run = reviewing(t);
  place(run, findingsList());
  const result = brief(run, { patch: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${run.patch}\n`);
  const written = JSON.parse(fs.readFileSync(run.patch, 'utf8'));
  assert.deepEqual(Object.keys(written), ['questions']);
  assert.deepEqual(written, printed(brief(run)));
  assert.deepEqual(fs.readdirSync(run.dir).filter(name => name.endsWith('.tmp')), []);
});

test('finding-brief reads a findings list named by an absolute path inside the run', t => {
  const run = reviewing(t);
  const file = place(run, findingsList(), 'review/list.json');
  assert.equal(printed(brief(run, { file })).questions.length, 4);
});

// ---------------------------------------------------------------------------
// 2. refusals, fallbacks
// ---------------------------------------------------------------------------

test('finding-brief refuses an unreadable state, an unknown node, a gate, a node not running and an undeclared id', t => {
  const run = reviewing(t);
  place(run, findingsList());

  refused(verb(['finding-brief', `--state=${path.join(run.dir, 'absent.yml')}`, '--node=review', `--findings-file=${FINDINGS}`]),
    'finding-brief-state-unreadable');
  refused(brief(run, { node: 'nowhere' }), 'finding-brief-unknown-node');
  refused(brief(run, { node: 'review-approval' }), 'finding-brief-unknown-node');

  const idle = reviewing(t, { status: null });
  place(idle, findingsList());
  refused(brief(idle), 'finding-brief-not-running');

  const other = reviewing(t, { definition: UNDECLARED, node: 'scoping' });
  place(other, findingsList());
  const undeclared = brief(other);
  refused(undeclared, 'finding-brief-undeclared');
  assert.match(undeclared.stderr, /"scoping-findings"/);
  assert.match(undeclared.stderr, /in-node-questions\.md/);
  assert.equal(fs.existsSync(other.patch), false);
});

test('finding-brief without --findings-file is a usage error', t => {
  const run = reviewing(t);
  const result = verb(['finding-brief', `--state=${run.state}`, '--node=review']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: finding-brief needs --findings-file/);
});

test('finding-brief: a missing list, or one outside the run, warns missing and pastes nothing', t => {
  const run = reviewing(t);
  fellBack(brief(run), `finding-list-missing:${FINDINGS}`);
  fellBack(brief(run, { file: '../elsewhere.json' }), 'finding-list-missing:../elsewhere.json:outside-run');
  fellBack(brief(run, { patch: true }), `finding-list-missing:${FINDINGS}`);
  assert.equal(fs.existsSync(run.patch), false);
});

/** One change to a parsed copy of the list, beside the detail it must be refused with. */
const SHAPES = [
  ['(root)', () => []],
  ['extra', doc => { doc.extra = true; }],
  ['findings', doc => { doc.findings = []; }],
  ['findings[1].severity', doc => { doc.findings[1].severity = 'severe'; }],
  ['findings[0].id', doc => { doc.findings[0].id = 'Slow listing'; }],
  ['findings[2].id', doc => { doc.findings[2].id = 'empty-upload'; }],
  ['findings[0].title', doc => { doc.findings[0].title = 'Two\nlines'; }],
  ['findings[0].evidence', doc => { doc.findings[0].evidence = ''; }],
  ['findings[0].options', doc => { doc.findings[0].options = []; }],
  ['findings[0].options[1].label', doc => { doc.findings[0].options[1].label = 'Page the listing'; }],
  ['findings[0].options[0].label', doc => { doc.findings[0].options[0].label = 'Accept the risk and list it'; }],
  ['findings[0].options[1].note', doc => { doc.findings[0].options[1].note = 'x'; }],
  ['findings[1].recommended', doc => { doc.findings[1].recommended = 1; }],
  ['findings[1].reason', doc => { delete doc.findings[1].reason; }],
  ['findings[3].priority', doc => { doc.findings[3].priority = 1; }],
];

test('finding-brief: a list that is not JSON or breaks the shape warns invalid with its first problem', t => {
  const run = reviewing(t);
  place(run, '{"findings": [');
  fellBack(brief(run), `finding-list-invalid:${FINDINGS}:not-json`);
  for (const [detail, mutate] of SHAPES) {
    const doc = findingsList();
    const changed = mutate(doc) ?? doc;
    place(run, changed);
    fellBack(brief(run), `finding-list-invalid:${FINDINGS}:${detail}`);
  }
  // Two violations: the first one is named.
  const doc = findingsList();
  doc.findings[0].severity = 'severe';
  doc.findings[2].title = '';
  place(run, doc);
  fellBack(brief(run, { patch: true }), `finding-list-invalid:${FINDINGS}:findings[0].severity`);
  assert.equal(fs.existsSync(run.patch), false);
});

test('finding-brief: a patch file it cannot write warns unwritable and leaves no temp', t => {
  const run = reviewing(t);
  place(run, findingsList());
  // A patch path in a directory that does not exist: the entry point refuses
  // it as usage, so the module is called directly to reach the write.
  const patch = path.join(run.dir, 'absent', '.state-patch.json');
  const result = findingBrief({ state: run.state, node: 'review', findingsFile: FINDINGS, patchFile: patch });
  assert.deepEqual(result, { ok: true, fallback: true, errors: [], warnings: ['finding-list-unwritable:absent/.state-patch.json:ENOENT'] });

  // A live writer's temp, through the verb.
  const tmp = `${run.patch}.tmp`;
  fs.writeFileSync(tmp, 'another writer');
  fellBack(brief(run, { patch: true }), 'finding-list-unwritable:.state-patch.json:EEXIST');
  assert.equal(fs.readFileSync(tmp, 'utf8'), 'another writer');
  assert.equal(fs.existsSync(run.patch), false);
});

// ---------------------------------------------------------------------------
// 3. the fold under a cockpit, the class under a policy, and the continue
// ---------------------------------------------------------------------------

// The findings policy classes `review-findings` as an approval, the gate as a
// record and `deep_check` as a consult; it names no unknown family, so
// `notify_team`, which it leaves out, is classed as the gate is.
const FINDINGS_POLICY = sharedPlugin({ policy: JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy/findings.json'), 'utf8')) });

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const DISPATCH = { kind: 'dispatch', cwd: '/work' };
const ACCEPT_LABEL = 'Accept the risk and list it';
const qid = id => `review-findings-${id}`;

/** The findings list cut to the findings named, in its own order. */
function only(...ids) {
  const list = findingsList();
  return { findings: list.findings.filter(finding => ids.includes(finding.id)) };
}

/** One `write-state` through `engine`, refused loudly. */
function sent(engine, run, patch) {
  const result = runScript(engine, ['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** The `ask:` line that ends a classing write's stdout. */
const askOf = stdout => stdout.trimEnd().split('\n').at(-1);

/** A run of the finding-review fixture frozen through `engine` under `driver`, `review` running. */
function classedRun(t, engine, driver) {
  const run = scratch(t);
  const { patch } = freezePatch({ definition: DEFINITION, orchestrator: { options: { ceiling: 'advice' }, driver } });
  sent(engine, run, patch);
  sent(engine, run, { nodes: { review: { status: 'running' } } });
  return { ...run, node: 'review', patch: path.join(run.dir, '.state-patch.json') };
}

/** `review`'s set built by `finding-brief`, then sent in the classing write through `engine`. */
function classedFindings(engine, run, list = findingsList()) {
  place(run, list);
  const set = printed(brief(run));
  return { set, result: sent(engine, run, { node_summaries: { review: { question_set: set } } }) };
}

const summaryAt = (run, node) => readState(run).node_summaries?.[node] ?? {};

test('cockpit with question sets: the findings are asked in one request, and the fold records one operator decision per finding', t => {
  const run = reviewing(t, { driver: COCKPIT });
  assert.equal(readState(run).orchestrator.classes_questions, undefined, 'the default policy classes nothing, so no classing write is sent');
  place(run, only('slow-listing', 'empty-upload', 'missing-index'));
  assert.equal(brief(run, { patch: true }).code, 0);

  const built = verb(['gate-brief', `--state=${run.state}`, '--node=review', '--request', `--patch-file=${run.patch}`]);
  assert.equal(built.code, 0, built.stderr);
  const request = JSON.parse(built.stdout);
  assert.equal(request.kind, 'question');
  assert.deepEqual(request.questions.map(question => question.id), [qid('empty-upload'), qid('missing-index'), qid('slow-listing')]);

  // The driver writes the request and suspends; the answer lands in the request file.
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  const requestFile = path.join(gates, 'review.request.yml');
  const head = ['version: 1', ...Object.entries(request).map(([key, value]) => `${key}: ${JSON.stringify(value)}`), 'asked_at: "2026-01-05T09:00:00Z"'].join('\n');
  fs.writeFileSync(requestFile, `${head}\nanswer: null\n`);
  write(run, {
    orchestrator: { gate_pending: { node: 'review', request: 'gates/review.request.yml', since: '2026-01-05T09:00:00Z' } },
    nodes: { review: { status: 'suspended' } },
  });
  const answer = {
    option: 'option-1',
    answers: { [qid('empty-upload')]: 'option-1', [qid('missing-index')]: 'accept-risk', [qid('slow-listing')]: 'option-2' },
    answered_by: 'dana',
    at: '2026-01-05T09:12:00Z',
    via: 'cockpit',
  };
  fs.writeFileSync(requestFile, `${head}\nanswer: ${JSON.stringify(answer)}\n`);
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8')
    .replace(/^( {4}review: \{.*?)status: suspended/m, '$1status: running')
    .replace(/^( {2}gate_pending: ).*$/m, '$1null'));
  write(run, {});
  write(run, { node_summaries: { review: { answer } } });

  const state = readState(run);
  assert.equal(state.workflow.nodes.review.status, 'running', 'the fold never completes the node');
  const who = { answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' };
  assert.deepEqual(state.node_summaries.review.decisions, [
    {
      decision: 'Guard the empty body', by: 'operator', question_id: qid('empty-upload'),
      question: 'Server crashes on an empty upload — how should it be settled?', answer: 'Guard the empty body',
      recommended: 'Guard the empty body', as_recommended: true, ...who,
    },
    {
      decision: ACCEPT_LABEL, by: 'operator', question_id: qid('missing-index'),
      question: 'Lookup by email scans the table — how should it be settled?', answer: ACCEPT_LABEL,
      recommended: 'Add the index', as_recommended: false, ...who,
    },
    {
      decision: 'Cap at a thousand', by: 'operator', question_id: qid('slow-listing'),
      question: 'Listing loads every row — how should it be settled?', answer: 'Cap at a thousand',
      recommended: null, as_recommended: null, ...who,
    },
  ]);
});

test('classed under the findings policy: dispatch holds each finding on its recommendation, one with none held with no choice; a cockpit asks them all', t => {
  const engine = FINDINGS_POLICY.engine;
  const run = classedRun(t, engine, DISPATCH);
  assert.equal(readState(run).orchestrator.classes_questions, true);
  const { set, result } = classedFindings(engine, run);
  assert.equal(askOf(result.stdout), 'ask: none');

  const summary = summaryAt(run, 'review');
  assert.deepEqual(summary.asking, []);
  const held = { version: 1, class: 'approve', family: 'finding-family', held: true };
  const questionOf = id => set.questions.find(question => question.id === qid(id)).question;
  assert.deepEqual(summary.decisions, [
    { decision: 'Guard the empty body', by: 'default', question_id: qid('empty-upload'), question: questionOf('empty-upload'), triage: held },
    { decision: 'Add the index', by: 'default', question_id: qid('missing-index'), question: questionOf('missing-index'), triage: held },
    {
      decision: 'No choice yet — needs your decision', by: 'default', question_id: qid('slow-listing'), question: questionOf('slow-listing'),
      no_choice: true, triage: held,
    },
    { decision: ACCEPT_LABEL, by: 'default', question_id: qid('log-noise'), question: questionOf('log-noise'), triage: held },
  ]);

  // Under a cockpit carrying question sets, the same policy leaves every finding to ask.
  const asked = classedRun(t, engine, COCKPIT);
  const { result: written } = classedFindings(engine, asked);
  assert.equal(askOf(written.stdout), `ask: ${['empty-upload', 'missing-index', 'slow-listing', 'log-noise'].map(qid).join(' ')}`);
  assert.equal(summaryAt(asked, 'review').decisions, undefined);
});

test('a continue at the gate records its answer, each value it sets with its own class, then one approval per held finding', t => {
  const engine = FINDINGS_POLICY.engine;
  const run = classedRun(t, engine, DISPATCH);
  classedFindings(engine, run, only('empty-upload', 'missing-index', 'log-noise'));
  const held = summaryAt(run, 'review').decisions;
  assert.equal(held.length, 3);
  sent(engine, run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed the work.' } } });

  sent(engine, run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'continue-with-checks', answered_by: 'dana' }] } },
  });
  const [answer, ...rest] = summaryAt(run, 'review-approval').decisions;
  const gate = { version: 1, class: 'record', family: 'review-gate-family' };
  assert.equal(answer.option, 'continue-with-checks');
  assert.deepEqual(answer.triage, gate);
  const credit = Object.fromEntries(['answered_by', 'via', 'actor', 'on_behalf_of'].filter(key => answer[key] !== undefined).map(key => [key, answer[key]]));
  assert.equal(credit.answered_by, 'dana');
  const settlement = (key, triage) => ({ decision: `${key}: true`, by: 'operator', ref: key, node: 'review-approval', triage, ...credit });
  const approval = item => {
    const { held: _held, ...triage } = item.triage;
    return { decision: `${item.question_id}: ${item.decision}`, by: 'operator', node: 'review', question_id: item.question_id, triage, ...credit };
  };
  assert.deepEqual(rest, [
    settlement('deep_check', { version: 1, class: 'consult', family: 'deep-check-family' }),
    settlement('notify_team', gate),
    ...held.map(approval),
  ]);
  assert.deepEqual(rest.at(-1).decision, `${qid('log-noise')}: ${ACCEPT_LABEL}`);
  assert.deepEqual(outstandingHeld(readState(run)), []);

  // A finding held with no choice is never approved by a continue: it stays outstanding.
  const open = classedRun(t, engine, DISPATCH);
  classedFindings(engine, open, only('empty-upload', 'slow-listing'));
  sent(engine, open, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed the work.' } } });
  sent(engine, open, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'continue-quietly', answered_by: 'dana' }] } },
  });
  const approved = summaryAt(open, 'review-approval').decisions.filter(item => item.node === 'review').map(item => item.question_id);
  assert.deepEqual(approved, [qid('empty-upload')]);
  assert.deepEqual(outstandingHeld(readState(open)).map(item => item.question_id), [qid('slow-listing')]);
});
