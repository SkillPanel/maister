import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, ROOT, git, run } from '../helpers.mjs';

// A workflow run never writes standards and asks nothing about its standard
// candidates: finalization consolidates them, writes them to the run's
// candidates file, files them in the project's candidate store, copies the
// close lines the script prints and names standards-update once under Next.
// standards-update, run bare, takes a run's close it finds in the session to
// that run's candidates in the store, and in a fresh session finds the latest
// run with something left to apply. Pinned here: the three guides word that
// hand-over alike and ask nothing, every step that writes or takes a candidate
// points at the one reference, and the store script, run as a child process
// from a scratch project — real git included, for two branches merging.

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
    assert.ok(close.includes('the line naming the run\'s task directory'), `${workflow}: the close names the task directory standards-update reads`);
    assert.ok(consolidate.includes('`node ${CLAUDE_PLUGIN_ROOT}/skills/standards-update/scripts/candidates.mjs file --run=<task path>`'), `${workflow}: the run's file is filed in the store`);
    assert.ok(consolidate.includes('candidate store, `.maister/standard-candidates/`'), `${workflow}: the store is named`);
    assert.ok(consolidate.includes('committed with its standards: whichever commit carries the change carries the files it wrote'), `${workflow}: the store's files go with the change`);
    assert.ok(close.includes('`node ${CLAUDE_PLUGIN_ROOT}/skills/standards-update/scripts/candidates.mjs close --run=<task path>`'), `${workflow}: the close's lines come from the script`);
    assert.ok(close.includes('copy every line it prints into the close as printed'), `${workflow}: the lines are copied as printed`);
    assert.ok(close.includes('never retold, merged or left out'), `${workflow}: and never retold`);
    assert.ok(close.includes('run with no argument in this session or a fresh one'), `${workflow}: the command works in the same session too`);
    assert.ok(close.includes('never one per candidate; with no candidates there is no such line'), `${workflow}: once, and only with candidates`);
    assert.ok(close.includes('each lesson it attached to an earlier run\'s candidate'), `${workflow}: the close lists the attachments`);
    assert.ok(consolidate.includes('keeps at most five new lessons'), `${workflow}: the cap is asked for`);
    assert.ok(close.includes('how many new lessons were dropped over the cap of five'), `${workflow}: the close says the dropped count`);
    return [consolidate, close];
  });
  for (const each of steps.slice(1)) assert.deepEqual(each, steps[0], 'the three guides word the hand-over alike');
});

test('the candidate description lives in one reference that every other step points at', () => {
  const read = file => fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8').replace(/\s+/g, ' ');
  const reference = read(`skills/docs-manager/${REFERENCE}`);
  for (const heading of ['## What a candidate is', '## How one is written', '## Where one belongs', '## Offered, not recommended', '## Consolidation', "## The run's candidates file", '## The candidate store', '## Folding in earlier runs', '## Closing a candidate', '## The open queue', '## The close']) {
    assert.ok(reference.includes(heading), `the reference holds ${heading}`);
  }
  for (const field of ['`id`', '`label`', '`line`', '`destination`', '`evidence`', '`recommended`', '`already_held`', '`standard-candidates-applied.json`',
    '`version`', '`attached`', '`seen_in`', '`--json`', '`{id, evidence, line}`', '<id> [<action>; seen in <N>] <label>: <rule>',
    '`.maister/standard-candidates/`', '`*.json merge=union`', 'meant to be committed with the standards', '`{run, date, evidence}`', '`store`',
    'folding in again adds nothing', 'never under `standards/`',
    '`dropped`', '**Keep at most five new lessons.**', '`guards`', '`caught_by`', '`dismissed`', '`{reason, by, date}`', '**expired**', '`{queue, closed, problems}`']) {
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
  for (const each of ['**The hazard, not the feature.**', '**`where` names a second place.**', '**Not caught already.**', '**Not a helper trick or a process note.**', '[; caught by: <the check>]']) {
    assert.ok(reference.includes(each), `How one is written holds ${each}`);
  }
  for (const each of ["**The project's architecture note**", "**The project's contributor guide**", '`.maister/docs/project/architecture.md`', '`.maister/docs/project/contributing.md`', 'neither is ever suggested a standards file']) {
    assert.ok(reference.includes(each), `routing holds ${each}`);
  }
  assert.ok(read('agents/task-group-implementer.md').includes('a general hazard, stated as a rule, with this group\'s work only as its example'), 'the implementer asks for the hazard');
  assert.ok(read('agents/implementation-runner.md').includes('each a general hazard rather than this group\'s feature'), 'the implementer\'s prompt asks for the hazard');
  assert.ok(read('agents/verification-runner.md').includes('stated as the general hazard the fix guards against, never as the fix itself'), 'the fix loop asks for the hazard');
});

test('standards-update, given nothing, offers the latest run\'s candidates through the script and records each one applied', () => {
  const skill = fs.readFileSync(path.join(PLUGIN_DIR, 'skills/standards-update/SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(skill.includes('## Candidates from a Workflow Run'));
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs latest`'), 'the lookup runs the script');
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs applied --id=<id>` with its store id'), 'each applied candidate is recorded');
  assert.ok(skill.includes('one multi-select AskUserQuestion. The question names the run'), 'one multi-select naming the run');
  assert.ok(skill.includes('other runs hold candidates too'), 'the others are mentioned');
  assert.ok(skill.includes('When none is, the question says no candidate has been seen in two runs yet or guards security or data loss'), 'none qualifying is said');
  assert.ok(skill.includes('never taken as given'), 'the destination is still confirmed');
  assert.ok(skill.includes('`node <plugin root>/skills/standards-update/scripts/candidates.mjs dismiss --id=<id> … --reason=<reason> --by=<name>` once'), 'a candidate a person declines is dismissed');
  assert.ok(skill.includes('`.maister/standard-candidates/`'), 'the skill names the store');
  assert.ok(skill.includes('"Keep them open (Recommended)"'), 'keeping the rest open is the recommended answer');
  assert.ok(skill.includes('until it is dismissed or expires'), 'an unchosen candidate is offered again only until it closes');
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

// The candidate store script, run as a child process from a scratch project.

/** A scratch project with `.maister/tasks/`; removed when the test ends. */
function project(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-candidates-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, tasks: path.join(root, '.maister', 'tasks'), store: path.join(root, '.maister', 'standard-candidates') };
}

const candidate = (id, extra = {}) => ({
  id, label: `Label ${id}`, line: `- Rule ${id} — why: it broke; where: project; shown by: group 1`,
  action: 'new', destination: 'standards/global/conventions.md', evidence: 'group 1', ...extra,
});

/** A run directory holding `doc` as its candidates file, its modification time `seconds` after the epoch. */
function runWith(where, type, name, doc, seconds = 1_000_000) {
  const dir = path.join(where.tasks, type, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'standard-candidates.json');
  fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc));
  fs.utimesSync(file, seconds, seconds);
  return dir;
}

/** A run written to this version of the reference: version 3, filed in the store at once. */
function filedRun(where, type, name, doc) {
  const dir = runWith(where, type, name, { version: 3, candidates: [], ...doc });
  const filed = script(where, ['file', `--run=${dir}`]);
  assert.equal(filed.code, 0, filed.stderr);
  return { dir, ...filed.report };
}

/** The store id a run's candidate gets: its run's date, its label as a slug, and six hex digits of the run and its id. */
function storeId(run, localId, label) {
  const date = run.split('/')[1].slice(0, 10);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${date}-${slug}-${crypto.createHash('sha256').update(`${run}#${localId}`).digest('hex').slice(0, 6)}`;
}

/** The day the fixtures' runs are judged on, unless a test names another: inside every 2026-01 run's window. */
const TODAY = '--today=2026-01-10';
const DATED = ['latest', 'show', 'queue', 'dismiss', 'applied', 'close'];

function script(where, args) {
  const dated = DATED.includes(args[0]) && !args.some(arg => arg.startsWith('--today=')) ? [...args, TODAY] : args;
  const result = run(SCRIPT, dated, undefined, {}, where.root);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: text output or a usage error, asserted by the test
  }
  return { ...result, report };
}

const storeText = (where, id) => fs.readFileSync(path.join(where.store, `${id}.json`), 'utf8');
const record = (where, id) => JSON.parse(storeText(where, id));
/** Every file in the store with its text and time, for a test that nothing was written. */
const snapshotStore = where => (fs.existsSync(where.store) ? fs.readdirSync(where.store).sort().map(name => {
  const file = path.join(where.store, name);
  return [name, fs.readFileSync(file, 'utf8'), fs.statSync(file).mtimeMs];
}) : []);

/** A path or a file URL in a message, masked, so assertions hold on every system. */
const masked = text => text.replace(/file:\/\/\S+/g, '<url>').replace(/(?:[A-Za-z]:)?[\\/]\S+/g, '<path>');

test('file: a run\'s candidates go into the store one file each, written a key and a sighting a line, its first five only, and filing again writes nothing', t => {
  const where = project(t);
  const dir = runWith(where, 'development', '2026-01-05-first', {
    version: 3,
    candidates: [candidate('c1', { label: 'Token check before await', guards: 'security' }), candidate('c2'), candidate('c3'), { id: 'broken' }, candidate('c4'), candidate('c5'), candidate('c6'), candidate('c7')],
    already_held: [], consolidated: true,
  });
  const filed = script(where, ['file', `--run=${dir}`]);
  assert.equal(filed.code, 0, filed.stderr);
  const run = 'development/2026-01-05-first';
  const first = storeId(run, 'c1', 'Token check before await');
  assert.equal(first, `2026-01-05-token-check-before-await-${crypto.createHash('sha256').update(`${run}#c1`).digest('hex').slice(0, 6)}`);
  assert.deepEqual(filed.report.filed, [first, ...['c2', 'c3', 'c4', 'c5'].map(id => storeId(run, id, `Label ${id}`))], 'the first five filed, the broken entry skipped');
  assert.equal(filed.report.dropped, 2, 'over the cap of five, counted as dropped');
  assert.deepEqual(filed.report.problems.map(each => each.message), ['candidate 4 has no label, line, destination']);

  assert.equal(fs.readFileSync(path.join(where.store, '.gitattributes'), 'utf8'), '# Two branches that each add a sighting to one candidate keep both lines when merged.\n*.json merge=union\n');
  assert.deepEqual(fs.readdirSync(where.store).filter(name => name.endsWith('.json')).sort(), filed.report.filed.map(id => `${id}.json`).sort());
  assert.equal(storeText(where, first), [
    '{',
    `  "id": "${first}",`,
    '  "label": "Token check before await",',
    '  "line": "- Rule c1 — why: it broke; where: project; shown by: group 1",',
    '  "action": "new",',
    '  "extends": null,',
    '  "destination": "standards/global/conventions.md",',
    '  "guards": "security",',
    '  "caught_by": null,',
    '  "state": "open",',
    '  "closed": null,',
    '  "seen_in": [',
    '    {"run":"development/2026-01-05-first","date":"2026-01-05","evidence":"group 1"}',
    '  ]',
    '}',
    '',
  ].join('\n'));

  const runFile = JSON.parse(fs.readFileSync(path.join(dir, 'standard-candidates.json'), 'utf8'));
  assert.equal(runFile.version, 3);
  assert.deepEqual(runFile.candidates.map(each => [each.id, each.store]), filed.report.filed.map((id, index) => [`c${index + 1}`, id]), 'the run\'s file names each store id');
  assert.equal(runFile.dropped, 2);

  const before = [...snapshotStore(where), fs.readFileSync(path.join(dir, 'standard-candidates.json'), 'utf8')];
  const again = script(where, ['file', `--run=${dir}`]);
  assert.deepEqual({ ...again.report, problems: [] }, { ...filed.report, problems: [] }, 'filing again reports the same');
  assert.deepEqual([...snapshotStore(where), fs.readFileSync(path.join(dir, 'standard-candidates.json'), 'utf8')], before, 'and writes nothing');
});

test('file: an attachment adds the run to the candidate\'s seen_in once, on a line opening with its comma; one naming nothing is a problem', t => {
  const where = project(t);
  const { filed: [id] } = filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a', { label: 'Atomic writes' })] });
  const second = filedRun(where, 'performance', '2026-01-06-second', { attached: [{ id, evidence: 'fix 2', line: '- Same lesson, other words' }, { id: 'nothing-here', evidence: 'x' }] });
  assert.deepEqual(second.attached, [id]);
  assert.match(second.problems.map(each => each.message).join('\n'), /attachment nothing-here names no candidate in the store/);
  assert.ok(storeText(where, id).endsWith([
    '    {"run":"development/2026-01-05-first","date":"2026-01-05","evidence":"group 1"}',
    '  , {"run":"performance/2026-01-06-second","date":"2026-01-06","evidence":"fix 2"}',
    '  ]', '}', ''].join('\n')));
  script(where, ['file', `--run=${second.dir}`]);
  assert.equal(record(where, id).seen_in.length, 2, 'once');
  const refused = script(where, ['file', `--run=${path.join(where.tasks, 'development', '2026-01-07-none')}`]);
  assert.equal(refused.code, 1);
  assert.match(masked(refused.report.refused.join('\n')), /could not read the candidates/);
});

test('import: run folders from before the store are folded in once — candidates, applied, dismissed, attachments — and folding in again writes nothing', t => {
  const where = project(t);
  assert.equal(script(where, ['queue']).stdout, '');
  assert.equal(fs.existsSync(where.store), false, 'no earlier run, no store');

  const first = runWith(where, 'development', '2026-01-05-first', { candidates: [candidate('a'), candidate('b'), candidate('c')], consolidated: true });
  const applied = path.join(first, 'standard-candidates-applied.json');
  fs.writeFileSync(applied, JSON.stringify({ applied: ['b'], dismissed: { c: { reason: 'not here', by: 'Dana', date: '2026-01-07' } } }));
  fs.utimesSync(applied, 1_767_830_400, 1_767_830_400);
  runWith(where, 'development', '2026-01-06-second', { version: 2, candidates: [candidate('d')], attached: [{ run: 'development/2026-01-05-first', id: 'a', evidence: 'group 2' }, { run: 'development/2026-01-01-gone', id: 'x', evidence: 'group 1' }] });
  runWith(where, 'development', '2026-01-07-third', { version: 3, candidates: [candidate('e')] });

  const queued = script(where, ['queue', '--json']).report;
  const [a, b, c] = ['a', 'b', 'c'].map(id => storeId('development/2026-01-05-first', id, `Label ${id}`));
  const d = storeId('development/2026-01-06-second', 'd', 'Label d');
  assert.deepEqual(queued.queue.map(each => [each.id, each.seen_in]), [
    [a, ['development/2026-01-05-first', 'development/2026-01-06-second']], [d, ['development/2026-01-06-second']],
  ], 'a version 3 run is never folded in: it is filed');
  assert.deepEqual(queued.closed, { applied: 1, dismissed: 1, expired: 0 });
  assert.deepEqual([record(where, b).state, record(where, b).closed], ['applied', { date: '2026-01-08' }], 'applied on the day its file was written');
  assert.deepEqual([record(where, c).state, record(where, c).closed], ['dismissed', { reason: 'not here', by: 'Dana', date: '2026-01-07' }]);
  assert.match(queued.problems.map(each => each.message).join('\n'), /attachment development\/2026-01-01-gone#x names no candidate/);

  const before = snapshotStore(where);
  const again = script(where, ['import']);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual([again.report.imported, again.report.attached], [[], []]);
  script(where, ['latest']);
  script(where, ['queue']);
  assert.deepEqual(snapshotStore(where), before, 'nothing missing, nothing rewritten');
});

// Merging two branches: real git in a scratch repository.

/** A scratch project that is a git repository, its first commit holding `setup`'s run folders. */
function repo(t, setup) {
  const where = project(t);
  git(where.root, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  setup(where);
  git(where.root, ['add', '-A']);
  git(where.root, ['commit', '-q', '--allow-empty', '-m', 'base']);
  return where;
}

/** On a new branch from main: `work`, then commit everything. */
function branch(where, name, work) {
  git(where.root, ['checkout', '-q', '-b', name, 'main']);
  work();
  git(where.root, ['add', '-A']);
  git(where.root, ['commit', '-q', '-m', name]);
}

/** Merge branch `b` into branch `a`; the merge must be clean. */
function merge(where, a, b) {
  git(where.root, ['checkout', '-q', a]);
  git(where.root, ['merge', '-q', '--no-edit', b]);
  assert.equal(git(where.root, ['status', '--porcelain']), '', 'the merge is clean');
}

test('merge: two branches filing different candidates add different files and merge cleanly', t => {
  const where = repo(t, () => {});
  branch(where, 'one', () => filedRun(where, 'development', '2026-01-05-one', { candidates: [candidate('a', { label: 'Same words' })] }));
  branch(where, 'two', () => filedRun(where, 'development', '2026-01-05-two', { candidates: [candidate('a', { label: 'Same words' })] }));
  merge(where, 'one', 'two');
  const ids = script(where, ['queue', '--json']).report.queue.map(each => each.id);
  assert.equal(ids.length, 2, 'two files, though the label and the local id are the same');
  assert.notEqual(ids[0], ids[1]);
});

test('merge: two branches attaching to one candidate keep both sightings, still valid JSON', t => {
  const where = repo(t, where => filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a')] }));
  const id = storeId('development/2026-01-05-first', 'a', 'Label a');
  branch(where, 'one', () => filedRun(where, 'development', '2026-01-06-one', { attached: [{ id, evidence: 'group 1' }] }));
  branch(where, 'two', () => filedRun(where, 'performance', '2026-01-07-two', { attached: [{ id, evidence: 'fix 1' }] }));
  merge(where, 'one', 'two');
  assert.deepEqual(record(where, id).seen_in.map(each => each.run), ['development/2026-01-05-first', 'development/2026-01-06-one', 'performance/2026-01-07-two']);
  const queued = script(where, ['queue', '--json']).report;
  assert.deepEqual(queued.problems, []);
  assert.deepEqual([queued.queue[0].seen_in.length, queued.queue[0].reason], [3, 'seen in 3 runs']);
});

test('merge: two branches closing one candidate differently still parse, the last state wins, and the next write leaves one', t => {
  const where = repo(t, where => filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a'), candidate('b')] }));
  const [a, b] = ['a', 'b'].map(id => storeId('development/2026-01-05-first', id, `Label ${id}`));
  branch(where, 'one', () => script(where, ['dismiss', `--id=${a}`, '--reason=not here', '--by=Dana']));
  branch(where, 'two', () => script(where, ['applied', `--id=${a}`]));
  merge(where, 'one', 'two');
  assert.equal(storeText(where, a).match(/"state":/g).length, 2, 'union kept both sides\' lines');
  const queued = script(where, ['queue', '--json']).report;
  assert.deepEqual(queued.problems, []);
  assert.deepEqual(queued.closed, { applied: 1, dismissed: 0, expired: 0 }, 'the last state wins');
  script(where, ['dismiss', `--id=${b}`, '--reason=x', '--by=Dana']);
  script(where, ['applied', `--id=${a}`, '--today=2026-01-11']);
  assert.equal(storeText(where, a).match(/"state":/g).length, 2, 'a write that changes nothing leaves it as it is');
  filedRun(where, 'development', '2026-01-08-later', { attached: [{ id: a, evidence: 'group 1' }] });
  assert.equal(storeText(where, a).match(/"state":/g).length, 1, 'the next write of it leaves one state');
  assert.equal(record(where, a).state, 'applied');
});

test('merge: two branches filing the same run\'s sighting twice read as one sighting, and the next write leaves one line', t => {
  const where = repo(t, where => {
    filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a')] });
    // Written as `file` writes it back, so only the store differs between the branches' filings.
    const doc = { version: 3, candidates: [], attached: [{ id: storeId('development/2026-01-05-first', 'a', 'Label a'), evidence: 'group 1' }], dropped: 0 };
    runWith(where, 'development', '2026-01-06-again', `${JSON.stringify(doc, null, 2)}\n`);
  });
  const id = storeId('development/2026-01-05-first', 'a', 'Label a');
  const again = path.join(where.tasks, 'development', '2026-01-06-again');
  branch(where, 'one', () => script(where, ['file', `--run=${again}`]));
  branch(where, 'two', () => {
    const file = path.join(again, 'standard-candidates.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('group 1', 'group 2'));
    script(where, ['file', `--run=${again}`]);
  });
  merge(where, 'one', 'two');
  assert.equal((storeText(where, id).match(/2026-01-06-again/g) ?? []).length, 2, 'union kept both lines');
  assert.deepEqual(script(where, ['queue', '--json']).report.queue[0].seen_in, ['development/2026-01-05-first', 'development/2026-01-06-again'], 'one sighting a run');
  script(where, ['applied', `--id=${id}`]);
  assert.equal((storeText(where, id).match(/2026-01-06-again/g) ?? []).length, 1, 'the next write leaves one line');
});

test('a store file that does not parse is a problem named with its path, never a failure', t => {
  const where = project(t);
  filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a')] });
  fs.writeFileSync(path.join(where.store, 'broken.json'), '{\n<<<<<<< ours\n');
  fs.writeFileSync(path.join(where.store, 'empty.json'), '{"label": "x"}');
  const text = script(where, ['queue']);
  assert.equal(text.code, 0);
  assert.equal(text.stdout.split('\n').filter(Boolean).length, 1);
  assert.match(masked(text.stderr), /^candidates: <path> could not read the candidate/m);
  const json = script(where, ['queue', '--json']).report;
  assert.deepEqual(json.problems.map(each => path.basename(each.path)).sort(), ['broken.json', 'empty.json']);
  assert.equal(script(where, ['latest']).code, 0);
});

// Closing a candidate, and the reports.

test('applied and dismiss close candidates by their store ids: the record, the refusals, applying takes a dismissal back, --all', t => {
  const where = project(t);
  const first = filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a'), candidate('b'), candidate('c')] });
  const [a, b, c] = first.filed;
  const second = filedRun(where, 'development', '2026-01-06-second', { attached: [{ id: a, evidence: 'group 1' }] });

  const done = script(where, ['dismiss', `--id=${a}`, '--reason=not a rule here', '--by=Dana']);
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(done.report, { ok: true, dismissed: [a], left: 2 });
  assert.deepEqual([record(where, a).state, record(where, a).closed], ['dismissed', { reason: 'not a rule here', by: 'Dana', date: '2026-01-10' }]);
  const shown = script(where, ['show', `--run=${second.dir}`]).report;
  assert.deepEqual(shown.attached.map(each => [each.id, each.state, each.candidate]), [[a, 'dismissed', null]], 'its attachment is closed with it');
  assert.deepEqual(script(where, ['queue', '--json']).report.queue.map(each => each.id), [b, c].sort());

  const appliedOne = script(where, ['applied', `--id=${a}`, '--today=2026-01-11']);
  assert.deepEqual(appliedOne.report, { ok: true, applied: [a], left: 2 });
  assert.deepEqual([record(where, a).state, record(where, a).closed], ['applied', { date: '2026-01-11' }], 'applying a dismissed one takes the dismissal back');
  const before = storeText(where, a);
  script(where, ['applied', `--id=${a}`, '--today=2026-01-12']);
  assert.equal(storeText(where, a), before, 'recording twice records once');

  const refused = script(where, ['dismiss', `--id=${a}`, '--id=zzz', '--reason=x', '--by=Dana']);
  assert.equal(refused.code, 1);
  assert.deepEqual(refused.report.refused.sort(), [`${a} is already applied`, 'zzz is not a candidate in the store']);
  assert.equal(storeText(where, a), before, 'a refusal records nothing');
  assert.equal(script(where, ['applied', '--id=zzz']).code, 1);

  const all = script(where, ['dismiss', `--run=${first.dir}`, '--all', '--reason=settled in review', '--by=Dana']);
  assert.deepEqual(all.report, { ok: true, dismissed: [b, c].sort(), left: 0 }, '--all takes every candidate the run filed that is not applied');
  assert.deepEqual(script(where, ['queue', '--json']).report.closed, { applied: 1, dismissed: 2, expired: 0 });
});

test('expired: one run alone and more than 30 days past its sighting; a later sighting keeps an old candidate open; nothing written', t => {
  const where = project(t);
  const { filed: [lonely] } = filedRun(where, 'development', '2026-01-05-lonely', { candidates: [candidate('a')] });
  const { filed: [met] } = filedRun(where, 'development', '2026-01-06-met', { candidates: [candidate('b')] });
  filedRun(where, 'development', '2026-02-20-later', { attached: [{ id: met, evidence: 'group 1' }] });
  const before = snapshotStore(where);

  assert.deepEqual(script(where, ['queue', '--json', '--today=2026-02-04']).report.queue.map(each => each.id), [lonely, met], 'thirty days on, still open');
  const after = script(where, ['queue', '--json', '--today=2026-02-05']).report;
  assert.deepEqual(after.queue.map(each => each.id), [met], 'filed more than 30 days ago, seen again since: open');
  assert.deepEqual(after.closed, { applied: 0, dismissed: 0, expired: 1 });
  assert.equal(script(where, ['queue', '--json', '--today=2027-01-01']).report.queue.length, 1, 'seen in two runs, it never expires');
  assert.equal(script(where, ['show', `--run=${path.join(where.tasks, 'development', '2026-01-05-lonely')}`, '--today=2026-02-05']).report.candidates.length, 0, 'an expired candidate is not offered');
  assert.deepEqual(snapshotStore(where), before, 'expiry writes nothing');
});

test('queue: text and --json from the store, oldest run first; the shape of an entry; --skip leaves a run out', t => {
  const where = project(t);
  const second = filedRun(where, 'development', '2026-01-06-second', { candidates: [candidate('b', { action: 'extend', extends: 'standards/global/errors.md § Retries', label: 'Retry cap', caught_by: 'the lint rule' })] });
  const first = filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a', { label: 'Atomic writes' }), candidate('done')] });
  script(where, ['applied', `--id=${first.filed[1]}`]);
  const [a] = first.filed;
  const [b] = second.filed;
  const runFile = path.join(second.dir, 'standard-candidates.json');
  fs.writeFileSync(runFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(runFile, 'utf8')), attached: [{ id: a, evidence: 'group 1' }] }));
  script(where, ['file', `--run=${second.dir}`]);

  const text = script(where, ['queue']);
  assert.equal(text.code, 0, text.stderr);
  assert.deepEqual(text.stdout.split('\n').filter(Boolean), [
    `${a} [new; seen in 2] Atomic writes: Rule a`,
    `${b} [extend standards/global/errors.md § Retries; seen in 1] Retry cap: Rule b`,
  ]);

  const json = script(where, ['queue', '--json']).report;
  assert.deepEqual(Object.keys(json).sort(), ['closed', 'problems', 'queue']);
  assert.deepEqual(json.closed, { applied: 1, dismissed: 0, expired: 0 });
  assert.deepEqual(json.queue, [{
    run: 'development/2026-01-05-first', dir: first.dir, date: '2026-01-05', id: a, label: 'Atomic writes', rule: 'Rule a',
    action: 'new', extends: null, destination: 'standards/global/conventions.md',
    seen_in: ['development/2026-01-05-first', 'development/2026-01-06-second'],
    recommended: true, reason: 'seen in 2 runs', caught_by: null,
  }, {
    run: 'development/2026-01-06-second', dir: second.dir, date: '2026-01-06', id: b, label: 'Retry cap', rule: 'Rule b',
    action: 'extend', extends: 'standards/global/errors.md § Retries', destination: 'standards/global/conventions.md',
    seen_in: ['development/2026-01-06-second'], recommended: false, reason: null, caught_by: 'the lint rule',
  }]);

  const skipped = script(where, ['queue', '--json', `--skip=${second.dir}`]).report;
  assert.deepEqual(skipped.queue.map(each => [each.id, each.seen_in.length]), [[a, 1]], 'the skipped run\'s candidates and sightings are left out');
});

test('latest and show: the newest run with something to offer, an attached-only run, the named run, and a run the store does not know', t => {
  const where = project(t);
  const first = filedRun(where, 'development', '2026-01-05-first', { candidates: [candidate('a'), candidate('b', { guards: 'data-loss' })], already_held: [{ line: '- Held — why: x', held_by: 'standards/global/errors.md § Errors' }] });
  const [a, b] = first.filed;
  const second = filedRun(where, 'development', '2026-01-06-second', { attached: [{ id: a, evidence: 'group 1', line: '- Same, other words' }] });

  const before = script(where, ['latest']).report;
  assert.deepEqual(before.run, { dir: second.dir, type: 'development', name: '2026-01-06-second' }, 'a run with only an open attached candidate is still offered');
  assert.deepEqual(before.candidates, []);
  assert.deepEqual(before.attached.map(each => [each.run, each.id, each.evidence, each.line, each.state, each.candidate.dir]), [['development/2026-01-05-first', a, 'group 1', '- Same, other words', 'open', first.dir]]);
  assert.deepEqual(before.others, [{ dir: first.dir, count: 2 }]);

  const shown = script(where, ['show', `--run=${first.dir}`]).report;
  assert.deepEqual(shown.candidates.map(each => [each.id, each.recommended, each.reason, each.seen_in.length, each.evidence]), [
    [a, true, 'seen in 2 runs', 2, 'group 1'], [b, true, 'guards data loss', 1, 'group 1'],
  ].sort((x, y) => x[0].localeCompare(y[0])));
  assert.deepEqual(shown.already_held.map(each => each.held_by), ['standards/global/errors.md § Errors']);

  script(where, ['applied', `--id=${a}`]);
  assert.equal(script(where, ['latest']).report.run.dir, first.dir, 'with its attachment closed the later run gives way');
  script(where, ['applied', `--id=${b}`]);
  const done = script(where, ['show', `--run=${first.dir}`]).report;
  assert.equal(done.run.dir, first.dir, 'a fully applied run is still the run named');
  assert.deepEqual(done.candidates, []);
  assert.equal(script(where, ['latest']).report.run, null);

  const missing = script(where, ['show', `--run=${path.join(where.tasks, 'development', '2026-01-07-none')}`]);
  assert.equal(missing.code, 0, missing.stderr);
  assert.equal(missing.report.run, null);
  assert.equal(missing.report.problems.length, 1);
});

test('recommended: two runs or a guarded failure, never an extend alone, an earlier flag, one run\'s several groups, or with a caught_by', t => {
  const where = project(t);
  const { dir } = filedRun(where, 'development', '2026-01-05-run', {
    candidates: [
      candidate('extends', { action: 'extend', extends: 'standards/global/errors.md § Errors', evidence: 'groups 1, 2 and 3' }),
      candidate('flagged', { recommended: true, reason: 'its evidence in more than one place' }),
      candidate('data', { guards: 'data-loss' }),
      candidate('odd', { guards: 'style' }),
      candidate('caught', { guards: 'security', caught_by: 'the contrast test' }),
    ],
  });
  const shown = script(where, ['show', `--run=${dir}`]).report;
  assert.deepEqual(shown.candidates.map(each => [each.label, each.recommended, each.reason]), [
    ['Label data', true, 'guards data loss'], ['Label extends', false, null], ['Label flagged', false, null], ['Label odd', false, null], ['Label caught', false, null],
  ], 'the recommended first, those a check catches last');
});

test('close: the lines a run\'s close carries, in its file\'s order, and nothing for a run that filed nothing', t => {
  const where = project(t);
  const { filed: [earlier] } = filedRun(where, 'development', '2026-01-05-earlier', { candidates: [candidate('x', { label: 'Atomic writes' })] });
  const third = filedRun(where, 'development', '2026-01-08-third', {
    candidates: [
      candidate('c1', { label: 'Token check before await', guards: 'security', evidence: 'groups 2 and 3' }),
      candidate('c2', { label: 'Retry cap', action: 'extend', extends: 'standards/global/errors.md § Retries', destination: 'standards/global/errors.md', evidence: 'fix 1', caught_by: 'the retry test' }),
    ],
    attached: [{ id: earlier, evidence: 'fix 2' }],
    already_held: [{ line: '- Held rule — why: x', held_by: 'standards/global/errors.md § Errors' }],
    dropped: 2, consolidated: false,
  });
  const result = script(where, ['close', `--run=${third.dir}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\n').filter(Boolean), [
    `Standard candidates of development/2026-01-08-third (${third.dir}), filed in .maister/standard-candidates/:`,
    `- New, recommended (guards security): Token check before await → standards/global/conventions.md; evidence: groups 2 and 3 [${third.filed[0]}]`,
    `- Extend standards/global/errors.md § Retries, seen in 1 run, caught by the retry test: Retry cap → standards/global/errors.md; evidence: fix 1 [${third.filed[1]}]`,
    `- Seen again: Atomic writes, now seen in 2 runs, recommended (seen in 2 runs) [${earlier}]`,
    '- Already held: Held rule — held by standards/global/errors.md § Errors',
    '- Dropped over the cap of five: 2 new lessons',
    '- Not consolidated: the work log\'s lines as written',
  ]);
  script(where, ['dismiss', `--id=${third.filed[1]}`, '--reason=x', '--by=Dana']);
  assert.match(script(where, ['close', `--run=${third.dir}`]).stdout, /\[[^\]]+\] \(dismissed\)\n/, 'a closed candidate says so');
  const empty = filedRun(where, 'development', '2026-01-09-empty', {});
  assert.equal(script(where, ['close', `--run=${empty.dir}`]).stdout, '');
});

test('usage: a missing or misused flag is a usage error, exit 2', t => {
  const where = project(t);
  for (const args of [
    [], ['nonsense'], ['applied'], ['applied', '--run=x', '--id=a'], ['latest', '--id=a'], ['latest', '--json'], ['show'], ['file'], ['close'],
    ['queue', '--id=a'], ['queue', '--run=x'], ['import', '--today=2026-01-01'],
    ['dismiss', '--id=b', '--by=Dana'], ['dismiss', '--id=b', '--reason=x'], ['dismiss', '--reason=x', '--by=Dana'],
    ['dismiss', '--id=b', '--all', '--run=x', '--reason=x', '--by=Dana'], ['dismiss', '--all', '--reason=x', '--by=Dana'], ['dismiss', '--run=x', '--id=b', '--reason=x', '--by=Dana'],
    ['latest', '--today=2026-02-30'], ['queue', '--today=yesterday'],
  ]) {
    const usage = script(where, args);
    assert.equal(usage.code, 2, args.join(' '));
    assert.match(usage.stderr, /^usage:/m, args.join(' '));
  }
});
