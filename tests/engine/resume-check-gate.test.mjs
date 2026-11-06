import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE, FIXTURES, freeze, run as runScript, scratch, sibling, verb, write } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';

// What `resume-check` tells a session about a waiting gate, and how it finds the
// runs waiting with no state named. A session given no stamped line goes by this
// report, so which answer file can be used is judged here and pinned by running it.

const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const GATE = 'specification-approval';
const ASKED_AT = '2026-01-05T09:00:00Z';
const LATER = '2026-01-05T09:05:00Z';
const EARLIER = '2026-01-05T08:00:00Z';

/** Freeze `run` under a driver and suspend it on its gate, the request file in place. */
function suspended(run, { kind = 'cockpit', title } = {}) {
  freeze(run, { definition: OPTIONAL, orchestrator: { driver: { kind, cwd: '/work' } }, ...(title ? { task: { title } } : {}) });
  write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  fs.writeFileSync(path.join(gates, `${GATE}.request.yml`), [
    'version: 1',
    `node: ${GATE}`,
    'kind: approval',
    'question: "Specification complete. Continue?"',
    'multiple: false',
    'options:',
    '  - {id: continue-to-audit, label: "Continue to the audit"}',
    `asked_at: "${ASKED_AT}"`,
    'answer: null',
    '',
  ].join('\n'));
  refreshIndex(run.dir);
  write(run, {
    orchestrator: { gate_pending: { node: GATE, request: `gates/${GATE}.request.yml`, since: ASKED_AT } },
    nodes: { [GATE]: { status: 'suspended' } },
  });
  return run;
}

/** Write an answer file beside the request, as the driver does. */
function answerFile(run, actor, body, node = GATE) {
  const file = path.join(run.dir, 'gates', `${node}.answer.${actor}.yml`);
  fs.writeFileSync(file, body);
  return file;
}

/** An answer block by `actor`, at `at`, choosing `option`. */
const answered = (actor, at = LATER, option = 'continue-to-audit') =>
  `answer:\n  option: ${option}\n  answered_by: ${actor}\n  at: "${at}"\n  via: cockpit\n`;

function check(run, env) {
  const result = verb(['resume-check', `--state=${run.state}`], undefined, env);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

/** `resume-check` with no state, from `cwd`. */
function find(cwd, env) {
  const result = runScript(ENGINE, ['resume-check'], undefined, env, cwd);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

/** Every file under a directory with its bytes, so "nothing was written" is a comparison. */
function snapshot(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    files[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

/** The directory as a child running there names it: the temp folder may be a symlink. */
const real = (run, dir) => path.join(fs.realpathSync(run.root), path.relative(run.root, dir));

test('resume-check gate: a run with no gate pending reports none, and its driver', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'dispatch', cwd: '/work' } } });
  const report = check(run);
  assert.equal(report.driver_kind, 'dispatch');
  assert.ok(!Object.hasOwn(report, 'gate'));
  const plain = scratch(t, { name: '2026-01-06-plain' });
  freeze(plain);
  assert.equal(check(plain).driver_kind, null);
});

test('resume-check gate: pending with no answer file reads none, every earlier field kept', t => {
  const run = suspended(scratch(t), { title: 'Waiting run' });
  const report = check(run);
  assert.deepEqual(report.gate, {
    node: GATE,
    request: `gates/${GATE}.request.yml`,
    asked_at: ASKED_AT,
    answer_state: 'none',
    answer_files: [],
  });
  assert.equal(report.ok, true);
  assert.equal(report.driver_kind, 'cockpit');
  assert.equal(report.title, 'Waiting run');
  assert.equal(report.task_path, run.dir);
  assert.equal(report.root, run.root);
  assert.ok(Object.hasOwn(report, 'dashboard'));
  assert.equal(report.workflow.name.length > 0, true);
});

test('resume-check gate: one usable file reads one and names the file, its path and what it holds', t => {
  const run = suspended(scratch(t));
  const file = answerFile(run, 'dana', answered('dana'));
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'one');
  assert.deepEqual(gate.answer_files, [{
    file: `${GATE}.answer.dana.yml`,
    path: file,
    usable: true,
    option: 'continue-to-audit',
    answered_by: 'dana',
    at: LATER,
  }]);
});

test('resume-check gate: an answer stamped exactly when the question was asked is usable', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana', ASKED_AT));
  assert.equal(check(run).gate.answer_state, 'one');
});

test('resume-check gate: a file earlier than asked_at is not usable, and says so', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana', EARLIER));
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'unusable');
  const [only] = gate.answer_files;
  assert.equal(only.usable, false);
  assert.equal(only.reason, 'it is earlier than the question now being asked');
  assert.equal(only.at, EARLIER, 'what it holds is still reported');
  assert.equal(only.option, 'continue-to-audit');
});

test('resume-check gate: a usable file beside an earlier round\'s reads one', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana', EARLIER));
  answerFile(run, 'lee', answered('lee'));
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'one');
  assert.deepEqual(gate.answer_files.map(each => [each.answered_by, each.usable]), [['dana', false], ['lee', true]]);
});

test('resume-check gate: several usable files read several, and none is chosen', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana'));
  answerFile(run, 'lee', answered('lee', '2026-01-05T09:06:00Z', 'stop-here'));
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'several');
  assert.deepEqual(gate.answer_files.map(each => each.usable), [true, true]);
});

for (const [label, at] of [['a date alone', '2026-01-05'], ['a local time', '2026-01-05T09:05:00+01:00'], ['words', 'just now']]) {
  test(`resume-check gate: a file whose at is ${label} is not usable`, t => {
    const run = suspended(scratch(t));
    answerFile(run, 'dana', answered('dana', at));
    const { gate } = check(run);
    assert.equal(gate.answer_state, 'unusable');
    assert.equal(gate.answer_files[0].reason, 'it does not say when it was answered, as a UTC time');
  });
}

test('resume-check gate: a file with no at is not usable', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', 'answer:\n  option: continue-to-audit\n  answered_by: dana\n');
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'unusable');
  assert.ok(!Object.hasOwn(gate.answer_files[0], 'at'));
});

test('resume-check gate: a question set\'s answers are usable and reported whole', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', [
    'answer:',
    '  answers:',
    '    scope: narrow',
    '    areas: [api, ui]',
    '    words: {other: "Keep it small"}',
    '  answered_by: dana',
    `  at: "${LATER}"`,
    '',
  ].join('\n'));
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'one');
  const [only] = gate.answer_files;
  assert.deepEqual(only.answers, { scope: 'narrow', areas: ['api', 'ui'], words: { other: 'Keep it small' } });
  assert.ok(!Object.hasOwn(only, 'option'));
});

test('resume-check gate: a malformed file is not usable and carries nothing', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', 'answer:\n  option: continue-to-audit\n: : :\n');
  const { gate } = check(run);
  assert.equal(gate.answer_state, 'unusable');
  assert.deepEqual(Object.keys(gate.answer_files[0]).sort(), ['file', 'path', 'reason', 'usable']);
  assert.equal(gate.answer_files[0].reason, 'it cannot be read');
});

for (const [label, body, reason] of [
  ['an answer cut off mid-line', 'answer: {option: continue-to-audit\n', 'it holds no answer'],
  ['a flat answer, not the block the writer uses', `option: continue-to-audit\nanswered_by: dana\nat: "${LATER}"\n`, 'it holds no answer'],
  ['no answered_by', `answer:\n  option: continue-to-audit\n  at: "${LATER}"\n`, 'it does not say who answered'],
  ['no option and no answers', `answer:\n  answered_by: dana\n  at: "${LATER}"\n`, 'it holds no choice'],
  ['an empty answers map', `answer:\n  answers: {}\n  answered_by: dana\n  at: "${LATER}"\n`, 'it holds no choice'],
]) {
  test(`resume-check gate: a file with ${label} is not usable`, t => {
    const run = suspended(scratch(t));
    answerFile(run, 'dana', body);
    const { gate } = check(run);
    assert.equal(gate.answer_state, 'unusable');
    assert.equal(gate.answer_files[0].reason, reason);
  });
}

test('resume-check gate: with the request gone nothing can be judged, and a file says why', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana'));
  fs.rmSync(path.join(run.dir, 'gates', `${GATE}.request.yml`));
  const { gate } = check(run);
  assert.equal(gate.asked_at, null);
  assert.equal(gate.answer_state, 'unusable');
  assert.equal(gate.answer_files[0].reason, 'the question it answers cannot be read');
});

test('resume-check gate: another node\'s answer file is no answer to this gate', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana'), 'specification');
  answerFile(run, 'lee', answered('lee'), `${GATE}-more`);
  assert.equal(check(run).gate.answer_state, 'none');
});

test('resume-check gate: the check writes nothing in the run, a session\'s pointer staying outside it', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana'));
  const before = snapshot(run.dir);
  check(run, { CLAUDE_CODE_SESSION_ID: 'session-new' });
  assert.deepEqual(snapshot(run.dir), before);
  assert.ok(fs.existsSync(path.join(run.root, '.maister/display/sessions/session-new.json')));
});

test('resume-check find: a project with no runs, or none waiting, finds none and exits 0', t => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-engine-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.deepEqual(find(empty), { ok: true, root: fs.realpathSync(empty), waiting: [] });

  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  assert.deepEqual(find(run.root).waiting, []);
});

test('resume-check find: one run found carries the whole gate, so no second call is needed', t => {
  const run = suspended(scratch(t), { title: 'Waiting run' });
  const not = sibling(run, { type: 'development', name: '2026-01-06-not-waiting' });
  freeze(not);
  answerFile(run, 'dana', answered('dana'));
  const report = find(run.root);
  assert.equal(report.root, fs.realpathSync(run.root));
  assert.equal(report.waiting.length, 1);
  const [only] = report.waiting;
  assert.equal(only.task_path, real(run, run.dir));
  assert.equal(only.state, real(run, run.state));
  assert.equal(only.title, 'Waiting run');
  assert.equal(only.status, 'in_progress');
  assert.equal(only.driver_kind, 'cockpit');
  assert.equal(only.gate.node, GATE);
  assert.equal(only.gate.answer_state, 'one');
  assert.equal(only.gate.answer_files[0].path, path.join(real(run, run.dir), 'gates', `${GATE}.answer.dana.yml`));
  assert.ok(!Object.hasOwn(report, 'unreadable'));
});

test('resume-check find: several runs are all listed, under either root and any type', t => {
  const first = suspended(scratch(t));
  const second = suspended(sibling(first, { type: 'research', name: '2026-01-06-second' }));
  const dir = path.join(first.root, '.maister/umbrella/runs/r-0001');
  fs.mkdirSync(dir, { recursive: true });
  const umbrella = suspended({ root: first.root, dir, state: path.join(dir, 'orchestrator-state.yml') }, { kind: 'dispatch' });
  const { waiting } = find(first.root);
  assert.deepEqual(waiting.map(each => each.task_path).sort(), [first, second, umbrella].map(run => real(first, run.dir)).sort());
});

test('resume-check find: a set-aside copy of a waiting run is left out', t => {
  const run = suspended(scratch(t));
  for (const suffix of ['moved-42', 'failed-2']) fs.cpSync(run.dir, `${run.dir}.${suffix}`, { recursive: true });
  assert.deepEqual(find(run.root).waiting.map(each => each.task_path), [real(run, run.dir)]);
});

test('resume-check find: a 2.x directory is passed over unparsed, with no complaint', t => {
  const run = scratch(t, { fixture: 'prose-2x' });
  const report = find(run.root);
  assert.deepEqual(report.waiting, []);
  assert.ok(!Object.hasOwn(report, 'unreadable'));
});

test('resume-check find: a folder with no state is not a run', t => {
  const run = suspended(scratch(t));
  fs.mkdirSync(path.join(run.root, '.maister/tasks/development/2026-01-06-empty'), { recursive: true });
  const report = find(run.root);
  assert.equal(report.waiting.length, 1);
  assert.ok(!Object.hasOwn(report, 'unreadable'));
});

test('resume-check find: a state it cannot read is named, not taken as not waiting', t => {
  const run = scratch(t);
  fs.mkdirSync(run.dir, { recursive: true });
  fs.writeFileSync(run.state, 'workflow:\n  name: a\n: : :\n');
  const report = find(run.root);
  assert.deepEqual(report.waiting, []);
  assert.equal(report.unreadable.length, 1);
  assert.equal(report.unreadable[0].task_path, real(run, run.dir));
  assert.match(report.unreadable[0].message, /cannot be read/);
});

test('resume-check find: writes nothing anywhere, the session pointer included, and ignores --no-open', t => {
  const run = suspended(scratch(t));
  answerFile(run, 'dana', answered('dana'));
  const before = snapshot(run.root);
  const env = { CLAUDE_CODE_SESSION_ID: 'session-new' };
  const plain = find(run.root, env);
  const flagged = runScript(ENGINE, ['resume-check', '--no-open'], undefined, env, run.root);
  assert.equal(flagged.code, 0, flagged.stderr);
  assert.deepEqual(JSON.parse(flagged.stdout), plain);
  assert.deepEqual(snapshot(run.root), before);
  assert.equal(fs.existsSync(path.join(run.root, '.maister/display')), false);
});

test('resume-check find: starts no dashboard opener, where naming the same run does', async t => {
  // A terminal driver is the one whose named check opens its page.
  const run = suspended(scratch(t), { kind: 'terminal' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-opener-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'opener.mjs');
  const log = path.join(dir, 'opened.log');
  fs.writeFileSync(script, "import fs from 'node:fs';\nfs.appendFileSync(process.argv[2], `${process.argv[3]}\\n`);\n");
  const env = { MAISTER_NO_OPEN: '', MAISTER_OPENER: JSON.stringify([process.execPath, script, log]) };

  assert.equal(find(run.root, env).waiting.length, 1);
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(fs.existsSync(log), false, 'finding runs opens nothing');

  check(run, env);
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(log) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(fs.existsSync(log), true, 'the control: naming the run opens its page');
});

test('resume-check find: an unknown flag is still a usage error', () => {
  assert.equal(verb(['resume-check', '--node=y']).code, 2);
});
