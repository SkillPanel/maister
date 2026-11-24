import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, ROOT, run } from '../helpers.mjs';

// A workflow run never writes standards and asks nothing about its standard
// candidates: finalization consolidates them, writes them to the run's
// candidates file, lists them in the close and names standards-update once
// under Next, naming its task directory. standards-update, run bare, takes a
// run's close it finds in the session to that run's candidates file, and in a
// fresh session finds the latest run whose candidates are not all applied. Pinned here: the
// three guides word that hand-over alike and ask nothing, every step that
// writes or takes a candidate points at the one reference, and the lookup
// script, run as a child process from a scratch project.

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');
const HANDERS = ['development', 'performance', 'migration'];
const PLUGIN_DIR = path.resolve(ENGINE_DIR, '..', '..');
const REFERENCE = 'references/standard-candidates.md';
const SCRIPT = path.join(ROOT, 'plugins/maister/skills/standards-update/scripts/candidates.mjs');

/** A node's section of a node-prose file: from its `## \`id\`` heading to the next heading. */
function sectionOf(workflow, node) {
  // In LF: a Windows checkout gives markdown CRLF.
  const text = fs.readFileSync(path.join(WORKFLOWS_DIR, `${workflow}.md`), 'utf8').replace(/\r\n?/g, '\n');
  const start = text.indexOf(`\n## \`${node}\`\n`);
  assert.notEqual(start, -1, `${workflow}.md has a section for ${node}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The paragraph that opens with `lead`, as one line of text. */
function paragraph(section, lead) {
  const found = section.split('\n\n').find(each => each.startsWith(lead));
  assert.ok(found, `a paragraph opens with ${lead}`);
  return found.replace(/\s+/g, ' ');
}

/** A numbered step of a section, as one line of text. */
function step(section, number) {
  const start = section.indexOf(`\n${number}. `);
  assert.notEqual(start, -1, `step ${number} is there`);
  const end = section.indexOf(`\n${number + 1}. `, start);
  return section.slice(start + 1, end === -1 ? undefined : end).replace(/\s+/g, ' ');
}

test('each guide consolidates, writes the candidates file and asks nothing about the candidates, worded alike', () => {
  const steps = HANDERS.map(workflow => {
    const section = sectionOf(workflow, 'finalization');
    const consolidate = step(section, 4);
    assert.ok(consolidate.includes('workflow.mjs dispatch-model --agent=maister:docs-operator'), `${workflow}: the call takes its dispatch-model values`);
    assert.ok(consolidate.includes('"Consolidate standard candidates.'), `${workflow}: the call names the docs-manager operation`);
    assert.ok(consolidate.includes('candidates.mjs queue --skip=<task path>`'), `${workflow}: the open queue is read first, this run left out`);
    assert.ok(consolidate.includes('Open queue: [the queue\'s lines as printed, or none]."'), `${workflow}: the queue goes into the prompt`);
    assert.ok(consolidate.includes('attaches a lesson the open queue already holds to that candidate'), `${workflow}: a repeat is attached, not offered`);
    assert.ok(consolidate.includes(`\`${REFERENCE}\``), `${workflow}: the step points at the reference`);
    assert.ok(consolidate.includes('`standard-candidates.json` in the task directory'), `${workflow}: the candidates are written to the one named file`);
    assert.ok(consolidate.includes('The run applies none of them and asks nothing about them'), `${workflow}: nothing is applied or asked`);
    for (const gone of ['standard-candidates`)', 'None now', 'none-now', '**Asks.** Only when step 4', '(suggested: <destination>)"`']) {
      assert.ok(!section.includes(gone), `${workflow}: no trace of the candidates question (${gone})`);
    }
    const close = paragraph(section, '**Standard candidates in the close**:');
    assert.ok(close.includes('with one line more: `/maister:standards-update`, run with no argument'), `${workflow}: Next names the bare command`);
    assert.ok(close.includes('the close names the run\'s task directory'), `${workflow}: the close names the task directory standards-update reads`);
    assert.ok(close.includes('run with no argument in this session or a fresh one'), `${workflow}: the command works in the same session too`);
    assert.ok(close.includes('never one per candidate; with no candidates there is no such line'), `${workflow}: once, and only with candidates`);
    assert.ok(close.includes('each lesson it attached to an earlier run\'s candidate'), `${workflow}: the close lists the attachments`);
    return [consolidate, close];
  });
  for (const each of steps.slice(1)) assert.deepEqual(each, steps[0], 'the three guides word the hand-over alike');
});

test('the candidate description lives in one reference that every other step points at', () => {
  const read = file => fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8').replace(/\s+/g, ' ');
  const reference = read(`skills/docs-manager/${REFERENCE}`);
  for (const heading of ['## What a candidate is', '## How one is written', '## Where one belongs', '## Consolidation', "## The run's candidates file", '## The open queue']) {
    assert.ok(reference.includes(heading), `the reference holds ${heading}`);
  }
  for (const field of ['`id`', '`label`', '`line`', '`destination`', '`evidence`', '`recommended`', '`already_held`', '`standard-candidates-applied.json`',
    '`version`', '`attached`', '`seen_in`', '`--json`', '`{run, id, evidence, line}`', '<run>#<id> [<action>; seen in <N>] <label>: <rule>']) {
    assert.ok(reference.includes(field), `the file shape names ${field}`);
  }
  const pointers = {
    'agents/task-group-implementer.md': `skills/docs-manager/${REFERENCE}`,
    'agents/implementation-runner.md': `skills/docs-manager/${REFERENCE}`,
    'skills/standards-update/SKILL.md': `skills/docs-manager/${REFERENCE}`,
    'skills/docs-manager/SKILL.md': `\`${REFERENCE}\``,
    'agents/verification-runner.md': `\`${REFERENCE}\``,
  };
  for (const [file, pointer] of Object.entries(pointers)) {
    assert.ok(read(file).includes(pointer), `${file} points at the reference`);
  }
});

test('standards-update, given nothing, offers the latest run\'s candidates through the script and records each one applied', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_DIR, 'skills/standards-update/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(skill.includes('## Candidates from a Workflow Run'));
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs latest`'), 'the lookup runs the script');
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs applied --run=<run dir> --id=<id>`'), 'each applied candidate is recorded');
  assert.ok(skill.includes('one multi-select AskUserQuestion. The question names the run'), 'one multi-select naming the run');
  assert.ok(skill.includes('other runs hold candidates too'), 'the others are mentioned');
  assert.ok(skill.includes('When none is, the question says no candidate has been seen in two runs yet or guards security or data loss'), 'none qualifying is said');
  assert.ok(skill.includes('never taken as given'), 'the destination is still confirmed');
});

test('standards-update scans back far enough to reach a run\'s close and takes that run\'s candidates from its file', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_DIR, 'skills/standards-update/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(!/15-20 messages/.test(skill), 'the old fixed window is gone');
  assert.ok(skill.includes('about the last 50 messages, or back to the most recent workflow run\'s close when that is further'), 'the scan is widened to the close');
  assert.ok(skill.includes('the count is guidance, not a limit'), 'the count stays guidance');
  assert.ok(skill.includes('**A workflow run\'s close in the scan** — a close that lists the run\'s standard candidates and names its task directory'), 'a close is detected in the scan');
  assert.ok(skill.includes('Take them through § Candidates from a Workflow Run with that task directory'), 'the close routes to the run\'s candidates');
  assert.ok(skill.includes('offered beside them in the same flow'), 'other conventions are offered beside them, not instead');
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs show --run=<task dir>`'), 'the close\'s run is read through the script');
  assert.ok(skill.includes('in a fresh session, `node <plugin root>/skills/standards-update/scripts/candidates.mjs latest`'), 'a fresh session keeps the latest lookup');
  assert.ok(skill.includes('If no argument and the conversation holds none'), 'the fallback is for an empty conversation only');
});

// The lookup script.

/** A scratch project with `.maister/tasks/`; removed when the test ends. */
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-candidates-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, tasks: path.join(root, '.maister', 'tasks') };
}

const candidate = (id, extra = {}) => ({
  id, label: `Label ${id}`, line: `- Rule ${id} — why: it broke; where: project; shown by: group 1`,
  action: 'new', destination: 'standards/global/conventions.md', evidence: 'group 1', ...extra,
});

/** A run directory holding `doc` as its candidates file, its modification time `seconds` after the epoch. */
function runWith(where, type, name, doc, seconds) {
  const dir = path.join(where.tasks, type, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'standard-candidates.json');
  fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc));
  fs.utimesSync(file, seconds, seconds);
  return dir;
}

function script(where, args) {
  const result = run(SCRIPT, args, undefined, {}, where.root);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: a usage error, asserted by the test
  }
  return { ...result, report };
}

test('latest: no tasks directory and no candidates file both answer with no run', t => {
  const where = project(t);
  const none = script(where, ['latest']);
  assert.equal(none.code, 0, none.stderr);
  assert.deepEqual(none.report, { run: null, candidates: [], already_held: [], attached: [], others: [], problems: [] });
  fs.mkdirSync(path.join(where.tasks, 'development', '2026-01-05-plain'), { recursive: true });
  assert.equal(script(where, ['latest']).report.run, null);
});

test('latest: the newest run wins, the others are counted, and a broken file is a problem, not a failure', t => {
  const where = project(t);
  runWith(where, 'development', '2026-01-05-older', { candidates: [candidate('a'), candidate('b')] }, 1_000_000);
  const newest = runWith(where, 'performance', '2026-01-06-newer', {
    candidates: [candidate('c', { recommended: true, reason: 'seen in two groups' }), { id: 'broken' }],
    already_held: [{ line: '- Held rule', held_by: 'standards/global/errors.md § Errors' }],
    consolidated: true,
  }, 2_000_000);
  runWith(where, 'migration', '2026-01-07-unreadable', '{not json', 3_000_000);

  const result = script(where, ['latest']);
  assert.equal(result.code, 0, result.stderr);
  const { report } = result;
  assert.deepEqual(report.run, { dir: newest, type: 'performance', name: '2026-01-06-newer' });
  assert.deepEqual(report.candidates.map(each => [each.id, each.recommended]), [['c', false]], 'the entry without its fields is not offered, and an earlier file\'s flag is not taken');
  assert.equal(report.candidates[0].reason, null);
  assert.deepEqual(report.already_held.map(each => each.held_by), ['standards/global/errors.md § Errors']);
  assert.deepEqual(report.others.map(each => [path.basename(each.dir), each.count]), [['2026-01-05-older', 2]]);
  assert.deepEqual(report.problems.map(each => path.basename(path.dirname(each.path))).sort(), ['2026-01-06-newer', '2026-01-07-unreadable']);
});

test('applied: an applied candidate is not offered again, a fully applied run gives way, and the candidates file is left alone', t => {
  const where = project(t);
  const older = runWith(where, 'development', '2026-01-05-older', { candidates: [candidate('a')] }, 1_000_000);
  const newer = runWith(where, 'development', '2026-01-06-newer', { candidates: [candidate('b'), candidate('c')] }, 2_000_000);
  const before = fs.readFileSync(path.join(newer, 'standard-candidates.json'), 'utf8');

  const first = script(where, ['applied', `--run=${newer}`, '--id=b']);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.report, { ok: true, applied: ['b'], left: 1 });
  assert.deepEqual(script(where, ['latest']).report.candidates.map(each => each.id), ['c']);

  const again = script(where, ['applied', `--run=${newer}`, '--id=b', '--id=c']);
  assert.deepEqual(again.report, { ok: true, applied: ['b', 'c'], left: 0 }, 'recording twice records once');
  const after = script(where, ['latest']).report;
  assert.equal(after.run.dir, older, 'with nothing left, the newer run gives way to the older one');
  assert.deepEqual(after.others, []);
  assert.equal(fs.readFileSync(path.join(newer, 'standard-candidates.json'), 'utf8'), before, 'the candidates file is never rewritten');
  assert.equal(fs.statSync(path.join(newer, 'standard-candidates.json')).mtimeMs, 2_000_000_000, 'its time stays the run\'s');
});

test('show: the named run, not the newest, less its applied candidates, with the others counted', t => {
  const where = project(t);
  const named = runWith(where, 'development', '2026-01-05-named', {
    candidates: [candidate('a'), candidate('b', { guards: 'security' })],
    already_held: [{ line: '- Held', held_by: 'standards/global/errors.md § Errors' }],
  }, 1_000_000);
  const newer = runWith(where, 'performance', '2026-01-06-newer', { candidates: [candidate('c')] }, 2_000_000);

  const first = script(where, ['show', `--run=${named}`]);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.report.run, { dir: named, type: 'development', name: '2026-01-05-named' });
  assert.deepEqual(first.report.candidates.map(each => [each.id, each.recommended, each.reason]), [['b', true, 'guards security'], ['a', false, null]], 'the recommended come first');
  assert.deepEqual(first.report.already_held.map(each => each.held_by), ['standards/global/errors.md § Errors']);
  assert.deepEqual(first.report.others, [{ dir: newer, count: 1 }], 'the named run is not among the others');

  script(where, ['applied', `--run=${named}`, '--id=a']);
  assert.deepEqual(script(where, ['show', `--run=${named}`]).report.candidates.map(each => each.id), ['b'], 'an applied candidate is dropped');
  script(where, ['applied', `--run=${named}`, '--id=b']);
  const done = script(where, ['show', `--run=${named}`]).report;
  assert.equal(done.run.dir, named, 'a fully applied run is still the run named');
  assert.deepEqual(done.candidates, []);

  const missing = script(where, ['show', `--run=${path.join(where.tasks, 'development', '2026-01-07-none')}`]);
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(missing.report.run, null);
  assert.equal(missing.report.problems.length, 1, 'the unreadable file is named');
  assert.deepEqual(missing.report.others.map(each => path.basename(each.dir)), ['2026-01-06-newer']);
});

test('applied: an id the run does not hold is refused and nothing is recorded; a malformed call is a usage error', t => {
  const where = project(t);
  const dir = runWith(where, 'development', '2026-01-05-run', { candidates: [candidate('a')] }, 1_000_000);
  const refused = script(where, ['applied', `--run=${dir}`, '--id=a', '--id=zzz']);
  assert.equal(refused.code, 1);
  assert.equal(refused.report.ok, false);
  assert.match(refused.report.refused.join('\n'), /zzz is not a candidate of this run/);
  assert.equal(fs.existsSync(path.join(dir, 'standard-candidates-applied.json')), false);

  for (const args of [[], ['nonsense'], ['applied', `--run=${dir}`], ['latest', '--id=a'], ['latest', '--bogus=1'], ['show'], ['show', `--run=${dir}`, '--id=a']]) {
    const usage = script(where, args);
    assert.equal(usage.code, 2, args.join(' '));
    assert.match(usage.stderr, /^usage:/m, args.join(' '));
  }
});

// The open queue across runs: attachments, seen_in, and the queue verb.

/** A path or a file URL in a message, masked, so assertions hold on every system. */
const masked = text => text.replace(/file:\/\/\S+/g, '<url>').replace(/(?:[A-Za-z]:)?[\\/]\S+/g, '<path>');

test('seen_in: a later run attaching to a candidate adds itself, once, and an attachment is never offered on its own', t => {
  const where = project(t);
  const first = runWith(where, 'development', '2026-01-05-first', { version: 2, candidates: [candidate('a'), candidate('b')] }, 1_000_000);
  runWith(where, 'performance', '2026-01-06-second', {
    version: 2, candidates: [],
    attached: [{ run: 'development/2026-01-05-first', id: 'a', evidence: 'group 2', line: '- Same lesson, other words' }],
  }, 2_000_000);
  runWith(where, 'development', '2026-01-07-third', {
    version: 2, candidates: [candidate('c')],
    attached: [{ run: 'development/2026-01-05-first', id: 'a', evidence: 'group 1' }, { run: 'development/2026-01-05-first', id: 'a', evidence: 'fix 3' }, { run: 'development/2026-01-01-gone', id: 'x', evidence: 'group 1' }, { id: 'no-run' }],
  }, 3_000_000);

  const shown = script(where, ['show', `--run=${first}`]).report;
  assert.deepEqual(shown.candidates.map(each => [each.id, each.run, each.seen_in]), [
    ['a', 'development/2026-01-05-first', ['development/2026-01-05-first', 'performance/2026-01-06-second', 'development/2026-01-07-third']],
    ['b', 'development/2026-01-05-first', ['development/2026-01-05-first']],
  ]);
  assert.deepEqual(shown.candidates.map(each => [each.recommended, each.reason]), [[true, 'seen in 3 runs'], [false, null]], 'two runs or more recommend it');
  assert.deepEqual(shown.problems.map(each => each.message).sort(), ['attachment 4 has no run', 'attachment development/2026-01-01-gone#x names no candidate']);

  const third = script(where, ['latest']).report;
  assert.equal(third.run.name, '2026-01-07-third');
  assert.deepEqual(third.candidates.map(each => each.id), ['c'], 'the attachments are not candidates of the run');
  assert.deepEqual(third.attached.map(each => [each.run, each.id, each.state, each.candidate?.id ?? null]), [
    ['development/2026-01-05-first', 'a', 'open', 'a'], ['development/2026-01-05-first', 'a', 'open', 'a'], ['development/2026-01-01-gone', 'x', 'unknown', null],
  ]);
  assert.equal(third.attached[0].candidate.dir, first, 'the attached candidate names its own run\'s directory, for applied');
});

test('applied closes the attachments that name the candidate, and latest falls to a run whose only offer is an attached candidate', t => {
  const where = project(t);
  const first = runWith(where, 'development', '2026-01-05-first', { candidates: [candidate('a'), candidate('b')] }, 1_000_000);
  const second = runWith(where, 'development', '2026-01-06-second', { version: 2, candidates: [], attached: [{ run: 'development/2026-01-05-first', id: 'a', evidence: 'group 1' }] }, 2_000_000);

  const before = script(where, ['latest']).report;
  assert.equal(before.run.dir, second, 'a run with only an open attached candidate is still offered');
  assert.deepEqual(before.candidates, []);
  assert.deepEqual(before.others, [{ dir: first, count: 2 }]);

  script(where, ['applied', `--run=${first}`, '--id=a']);
  const shown = script(where, ['show', `--run=${second}`]).report;
  assert.deepEqual(shown.attached.map(each => [each.state, each.candidate]), [['applied', null]], 'applying it closed the attachment');
  assert.equal(script(where, ['latest']).report.run.dir, first, 'with its attachment closed the later run gives way');
});

test('queue: every open candidate across runs, oldest first, one line each, its rule only; --skip leaves a run out', t => {
  const where = project(t);
  runWith(where, 'development', '2026-01-06-second', {
    version: 2,
    candidates: [candidate('b', { action: 'extend', extends: 'standards/global/errors.md § Retries', label: 'Retry cap' })],
    attached: [{ run: 'development/2026-01-05-first', id: 'a', evidence: 'group 1' }],
  }, 1_000_000);
  const first = runWith(where, 'development', '2026-01-05-first', { candidates: [candidate('a', { label: 'Atomic writes' }), candidate('done')] }, 2_000_000);
  runWith(where, 'migration', '2026-01-07-broken', '{not json', 3_000_000);
  script(where, ['applied', `--run=${first}`, '--id=done']);

  const text = script(where, ['queue']);
  assert.equal(text.code, 0, text.stderr);
  assert.deepEqual(text.stdout.split('\n').filter(Boolean), [
    'development/2026-01-05-first#a [new; seen in 2] Atomic writes: Rule a',
    'development/2026-01-06-second#b [extend standards/global/errors.md § Retries; seen in 1] Retry cap: Rule b',
  ]);
  assert.match(masked(text.stderr), /^candidates: <path> could not read the candidates/m, 'a broken file is named on stderr');

  const json = script(where, ['queue', '--json']);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(Object.keys(json.report).sort(), ['problems', 'queue']);
  assert.deepEqual(json.report.queue[0], {
    run: 'development/2026-01-05-first', dir: first, date: '2026-01-05', id: 'a', label: 'Atomic writes', rule: 'Rule a',
    action: 'new', extends: null, destination: 'standards/global/conventions.md',
    seen_in: ['development/2026-01-05-first', 'development/2026-01-06-second'],
    recommended: true, reason: 'seen in 2 runs',
  });
  assert.equal(json.report.queue[1].extends, 'standards/global/errors.md § Retries');

  const skipped = script(where, ['queue', '--json', `--skip=${first}`]).report;
  assert.deepEqual(skipped.queue.map(each => each.id), ['b'], 'the skipped run is left out');
  assert.ok(!skipped.problems.some(each => /names no candidate/.test(each.message)), 'an attachment to the skipped run is no problem');
});

test('queue: no tasks folder prints nothing; an undated run is dated by its file; a misused flag is a usage error', t => {
  const where = project(t);
  const empty = script(where, ['queue']);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stdout, '');
  assert.deepEqual(script(where, ['queue', '--json']).report, { queue: [], problems: [] });

  runWith(where, 'development', 'undated-run', { candidates: [candidate('a')] }, 1_000_000);
  assert.equal(script(where, ['queue', '--json']).report.queue[0].date, '1970-01-12');
  for (const args of [['queue', '--id=a'], ['queue', '--run=x'], ['latest', '--json'], ['show', '--run=x', '--skip=y']]) {
    const usage = script(where, args);
    assert.equal(usage.code, 2, args.join(' '));
    assert.match(usage.stderr, /^usage:/m, args.join(' '));
  }
});

test('recommended: two runs or a guarded failure, never an extend alone, an earlier flag, or one run\'s several groups', t => {
  const where = project(t);
  const dir = runWith(where, 'development', '2026-01-05-run', {
    version: 2,
    candidates: [
      candidate('extends', { action: 'extend', extends: 'standards/global/errors.md § Errors', evidence: 'groups 1, 2 and 3' }),
      candidate('flagged', { recommended: true, reason: 'its evidence in more than one place' }),
      candidate('data', { guards: 'data-loss' }),
      candidate('odd', { guards: 'style' }),
    ],
  }, 1_000_000);
  const shown = script(where, ['show', `--run=${dir}`]).report;
  assert.deepEqual(shown.candidates.map(each => [each.id, each.recommended, each.reason]), [
    ['data', true, 'guards data loss'], ['extends', false, null], ['flagged', false, null], ['odd', false, null],
  ]);
});
