import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { FIXTURES, freeze, freezePatch, readState, scratch, sibling, verb, write } from '../helpers.mjs';
import { PANEL_ROWS, questionPanelOf, rowsOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The display files are what a screen beside the session draws — a status
// line, the start banner, a gate's panel — written by the engine so a reader
// draws them as they stand. Every state write publishes the status and the
// session's run pointer, the freeze the banner; each is a projection of a write
// that already landed, so a failure is a warning and never a refusal.

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

function display(run, name) {
  return JSON.parse(fs.readFileSync(path.join(run.dir, 'display', name), 'utf8'));
}

function pointer(run, session) {
  const file = path.join(run.root, '.maister/display/sessions', `${session}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** A write sent as a session sends it: the session's id in the environment. */
function writeAs(run, session, patch) {
  const result = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_CODE_SESSION_ID: session });
  assert.equal(result.code, 0, result.stderr);
  return result;
}

// ---------------------------------------------------------------------------
// the freeze: banner and status
// ---------------------------------------------------------------------------

test('display: the freeze writes the banner it prints, without the line addressed to the model', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 0, result.stderr);

  const banner = display(run, 'banner.json');
  const printed = result.stdout.split('\n');
  assert.match(printed[0], /^Tell the user/);
  assert.deepEqual(banner.lines, printed.slice(1, 1 + banner.lines.length));
  assert.equal(banner.lines[0], 'Maister run started: Development');
  assert.ok(banner.lines.every(line => !line.includes('\n')));
  assert.equal(banner.version, 1);
  assert.equal(banner.frozen, display(run, 'status.json').updated, 'the freeze is the write the status describes');
});

test('display: the status counts phases, not gates, and composes the line', t => {
  const run = scratch(t);
  freeze(run);
  const status = display(run, 'status.json');
  // analysis, approval (a gate), implementation, research: three phases.
  assert.deepEqual(status.phase, { index: 1, total: 3, title: 'Scope analysis', skipped: [] });
  assert.equal(status.workflow, 'Development');
  assert.equal(status.task, 'Sample run');
  assert.equal(status.status, 'in_progress');
  assert.equal(status.line, 'Development · phase 1/3 · Scope analysis · Sample run');
  assert.equal(status.run_dir, run.dir);
  assert.equal(status.run_url, pathToFileURL(run.dir).href);
  assert.equal(status.dashboard, pathToFileURL(path.join(run.dir, 'dashboard.html')).href);
  assert.equal(status.version, 1);
});

test('display: a later write moves the phase; the gate never counts, a skipped node keeps its place', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 1, total: 3, title: 'Scope analysis', skipped: [] });

  // Waiting at the checkpoint: the phase just finished, never the pending one a guard may yet skip.
  write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 1, total: 3, title: 'Scope analysis', skipped: [] });

  write(run, { nodes: { approval: { status: 'completed' }, implementation: { status: 'running' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 3, title: 'Implementation', skipped: [] });

  // A skip leaves the total as it was and names the place it left.
  write(run, { nodes: { research: { status: 'skipped' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 3, title: 'Implementation', skipped: [3] });

  write(run, { nodes: { implementation: { status: 'completed' } } });
  const done = display(run, 'status.json');
  assert.deepEqual(done.phase, { index: 2, total: 3, title: 'Implementation', skipped: [3] });
  assert.equal(done.line, 'Development · phase 2/3 · Implementation · Sample run');
});

test('display: a run whose first phase was skipped starts at the first one it runs', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'skipped' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 3, title: 'Implementation', skipped: [1] });
});

test('display: the banner file carries its facts as fields beside the lines', t => {
  const run = scratch(t);
  freeze(run);
  const banner = display(run, 'banner.json');
  assert.equal(banner.workflow, 'Development');
  assert.equal(banner.task, 'Sample run');
  assert.equal(banner.checkpoints, 1);
  assert.equal(banner.first_phase, 'Scope analysis');
  assert.equal(banner.run_dir, run.dir);
  assert.equal(banner.run_url, pathToFileURL(run.dir).href);
  assert.equal(banner.dashboard, pathToFileURL(path.join(run.dir, 'dashboard.html')).href);
});

test('display: the status keeps the freeze as the run\'s start through later writes', t => {
  const run = scratch(t);
  freeze(run);
  const frozen = display(run, 'banner.json').frozen;
  assert.equal(display(run, 'status.json').started, frozen);
  write(run, { nodes: { analysis: { status: 'running' } } });
  const later = display(run, 'status.json');
  assert.equal(later.started, frozen);
  assert.notEqual(later.updated, undefined);
});

test('display: without a banner file the start is the earliest node start the state records', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  fs.rmSync(path.join(run.dir, 'display/banner.json'));
  write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.equal(display(run, 'status.json').started, readState(run).workflow.nodes.analysis.started);
});

test('display: the status names the next checkpoint, numbered as the gate brief numbers it', t => {
  const run = scratch(t);
  freeze(run);
  assert.deepEqual(display(run, 'status.json').checkpoint, { index: 1, total: 1, title: 'Approve the scope' });
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' } } });
  assert.equal(display(run, 'status.json').checkpoint, null, 'no gate is left');
});

test('display: the status lists what this write changed, and whether a gate is under way', t => {
  const run = scratch(t);
  freeze(run);
  const frozen = display(run, 'status.json');
  assert.deepEqual(frozen.saved, [], 'the freeze has nothing to compare with');
  assert.deepEqual(frozen.nodes.analysis, { title: 'Scope analysis', status: 'pending' });
  assert.equal(frozen.gate_open, false);

  write(run, { nodes: { analysis: { status: 'running' } } });
  assert.deepEqual(display(run, 'status.json').saved, [{ node: 'analysis', title: 'Scope analysis', status: 'running' }]);

  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'running' } } });
  const atGate = display(run, 'status.json');
  assert.deepEqual(atGate.saved, [
    { node: 'analysis', title: 'Scope analysis', status: 'completed' },
    { node: 'approval', title: 'Approve the scope', status: 'running' },
  ]);
  assert.equal(atGate.gate_open, true);

  write(run, {});
  assert.deepEqual(display(run, 'status.json').saved, [], 'a write that changes no node saves none');
});

test('display: the status lists the artifact paths the nodes declare, a sub-run\'s only once it has a folder', t => {
  const run = scratch(t);
  freeze(run, { definition: path.join(FIXTURES, 'definitions/declared-outputs.yml'), inputs: { subject: 'the store' } });
  assert.deepEqual(display(run, 'status.json').artifacts, ['analysis/evidence', 'analysis/notes.md']);
});

test('display: an ended run says how it ended instead of a phase', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { task: { status: 'stopped' } });
  assert.equal(display(run, 'status.json').line, 'Development · stopped · Sample run');
  write(run, { task: { status: 'completed' } });
  assert.equal(display(run, 'status.json').line, 'Development · completed · Sample run');
});

test('display: a long task is cut in the status line and kept whole in the field', t => {
  const run = scratch(t);
  const title = `Add ${'a very long task title '.repeat(6).trim()}`;
  freeze(run, { task: { title } });
  const status = display(run, 'status.json');
  assert.equal(status.task, title);
  assert.ok(status.line.endsWith('…'));
  assert.ok(status.line.length < title.length + 40);
});

test('display: a revise republishes the status from the rerun node', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: true } } },
    node_summaries: { draft: { summary: 'Drafted the guide.' } },
  });
  write(run, { nodes: { figures: { status: 'completed' }, 'side-note': { status: 'completed' } } });
  write(run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed it.' } } });
  const before = display(run, 'status.json');
  fs.rmSync(path.join(run.dir, 'display/status.json'));

  const result = verb(['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(result.code, 0, result.stderr);
  const after = display(run, 'status.json');
  assert.equal(after.phase.total, before.phase.total, 'the revise is a write, and the status follows it');

  write(run, { nodes: { draft: { status: 'running' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 1, total: before.phase.total, title: 'Draft', skipped: [] });
});

test('display: a state write removes a gate panel the write has answered', t => {
  const run = scratch(t);
  freeze(run);
  const next = path.join(run.dir, 'display/next.json');
  fs.writeFileSync(next, '{"version":1}\n');
  write(run, { nodes: { approval: { status: 'completed' } } });
  assert.equal(fs.existsSync(next), false);
});

/** A running step under a driver that carries question sets, and its set's brief run with `questions`. */
function questionBriefOf(t, questions) {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work', features: ['question-sets'] } } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions }));
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=analysis', '--request', `--patch-file=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  return run;
}

const SET = [
  { id: 'tag-filter', header: 'Tag filter', question: 'Which notes does the tag filter keep?', options: [{ id: 'all', label: 'All of them', recommended: true }, { id: 'tagged', label: 'Only the tagged ones' }] },
  { id: 'tag-case', question: 'Does a tag match whatever its case?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
  { id: 'csv-extras', question: 'What else goes in the CSV?', multi_select: true, options: [{ id: 'timestamp', label: 'The timestamp' }, { id: 'operator', label: 'The operator' }] },
];

test('display: a question set writes a panel too — the step and its place, the first header and the count, no option or answer', t => {
  const run = questionBriefOf(t, SET);
  const next = display(run, 'next.json');
  const { phase } = display(run, 'status.json');
  assert.equal(next.version, 1);
  assert.equal(next.kind, 'question');
  assert.equal(next.node, 'analysis');
  assert.equal(next.question, 'Which notes does the tag filter keep?');
  assert.deepEqual(next.position, { index: phase.index, total: phase.total }, 'the place the status line gives the step');
  assert.deepEqual(next.glance, [`Phase ${phase.index} of ${phase.total} · ${phase.title}`, 'Tag filter · 3 questions']);
  assert.deepEqual(next.parts, [
    { key: 'title', label: `Phase ${phase.index} of ${phase.total}`, text: phase.title },
    { key: 'questions', label: 'Tag filter', text: '3 questions', count: 3 },
  ]);
  assert.doesNotMatch(JSON.stringify(next), /All of them|Only the tagged|options|answer/);

  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.' } } });
  assert.equal(fs.existsSync(path.join(run.dir, 'display/next.json')), false, 'the next state write removes it');
});

test('display: a question set\'s panel holds to the panel\'s rows, however long its texts', () => {
  const words = 'Long words that run on and on. '.repeat(12).trim();
  const checkpoint = { header: 'Scope', ask: words, questions: Array.from({ length: 12 }, (_, index) => ({ id: `q${index}`, header: 'Tag filter', question: words })) };
  const panel = questionPanelOf(checkpoint, { title: words, position: { index: 12, total: 14 } });
  assert.ok(panel.glance.reduce((rows, line) => rows + rowsOf(line), 0) <= PANEL_ROWS, panel.glance.join('\n'));
  assert.ok(panel.parts.reduce((rows, part) => rows + rowsOf(`${part.label} ${part.text}`), 0) <= PANEL_ROWS);
  assert.match(panel.glance[0], /^Phase 12 of 14 · Long words .*…$/);
  assert.deepEqual(panel.parts.at(-1), { key: 'questions', label: 'Tag filter', text: '12 questions', count: 12 });
});

test('display: the display files are not among the changed paths a write reports', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  const frozen = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_CODE_SESSION_ID: 'session-a' });
  const later = writeAs(run, 'session-a', { nodes: { analysis: { status: 'completed' } } });
  for (const result of [frozen, later]) assert.doesNotMatch(result.stdout, /display/);
});

// ---------------------------------------------------------------------------
// the session's run pointer
// ---------------------------------------------------------------------------

test('display: a write names its run in the pointer of the session that sent it', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  writeAs(run, 'session-a', patch);
  const own = pointer(run, 'session-a');
  assert.equal(own.run_dir, run.dir);
  assert.equal(own.version, 1);
  assert.equal(own.updated, display(run, 'status.json').updated);
});

test('display: two sessions driving two runs in one project never share a pointer', t => {
  const first = scratch(t);
  const second = sibling(first, { type: 'research', name: '2026-01-05-other' });
  writeAs(first, 'session-a', freezePatch().patch);
  writeAs(second, 'session-b', freezePatch().patch);
  assert.equal(pointer(first, 'session-a').run_dir, first.dir);
  assert.equal(pointer(first, 'session-b').run_dir, second.dir);

  // A session moves on to another run — a sub-run, say — and only its own pointer follows.
  writeAs(second, 'session-a', { nodes: { analysis: { status: 'completed' } } });
  assert.equal(pointer(first, 'session-a').run_dir, second.dir);
  assert.equal(pointer(first, 'session-b').run_dir, second.dir);
  writeAs(first, 'session-b', { nodes: { analysis: { status: 'completed' } } });
  assert.equal(pointer(first, 'session-b').run_dir, first.dir);
  assert.equal(pointer(first, 'session-a').run_dir, second.dir);
});

test('display: no session id, or one that cannot name a file, writes no pointer and warns of nothing', t => {
  const run = scratch(t);
  const plain = verb(['write-state', `--state=${run.state}`], freezePatch().patch);
  assert.equal(plain.stderr, '');
  const escaping = verb(['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'completed' } } }, { CLAUDE_CODE_SESSION_ID: '../escape' });
  assert.equal(escaping.code, 0, escaping.stderr);
  assert.equal(escaping.stderr, '');
  assert.equal(fs.existsSync(path.join(run.root, '.maister/display')), false);
  assert.equal(fs.existsSync(path.join(run.root, '.maister/escape.json')), false);
});

// ---------------------------------------------------------------------------
// a display file that cannot be written
// ---------------------------------------------------------------------------

test('display: a status file that cannot be written is a warning; the state write lands', t => {
  const run = scratch(t);
  freeze(run);
  fs.rmSync(path.join(run.dir, 'display/status.json'));
  fs.mkdirSync(path.join(run.dir, 'display/status.json'));
  const result = verb(['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: display\/status\.json was not written \(display-unwritable: .*\); the state write is unaffected$/m);
  assert.match(result.stdout, /^workflow\.nodes\.analysis$/m);
  assert.equal(readState(run).workflow.nodes.analysis.status, 'completed');
});

test('display: a pointer that cannot be written is a warning naming it; the state write lands', t => {
  const run = scratch(t);
  freeze(run);
  fs.mkdirSync(path.join(run.root, '.maister/display'), { recursive: true });
  fs.writeFileSync(path.join(run.root, '.maister/display/sessions'), 'not a directory');
  fs.rmSync(path.join(run.dir, 'display/status.json'));
  const result = verb(['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'completed' } } }, { CLAUDE_CODE_SESSION_ID: 'session-a' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: \.maister\/display\/sessions\/session-a\.json was not written \(display-unwritable: /m);
  assert.equal(readState(run).workflow.nodes.analysis.status, 'completed');
  assert.ok(fs.existsSync(path.join(run.dir, 'display/status.json')), 'the run\'s own files are still written');
});

test('display: a panel that cannot be removed is a warning; the state write lands', t => {
  const run = scratch(t);
  freeze(run);
  fs.mkdirSync(path.join(run.dir, 'display/next.json'));
  const result = verb(['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: display\/next\.json was not written \(display-unwritable: .*could not be removed/m);
  assert.equal(readState(run).workflow.nodes.analysis.status, 'completed');
});

// ---------------------------------------------------------------------------
// out of the project's history
// ---------------------------------------------------------------------------

test('display: no display file shows in the project\'s git status', t => {
  const run = scratch(t);
  execFileSync('git', ['init', '-q'], { cwd: run.root });
  writeAs(run, 'session-a', freezePatch().patch);
  writeAs(run, 'session-a', { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped it.' } } });
  assert.equal(verb(['gate-brief', `--state=${run.state}`, '--node=approval']).code, 0);
  assert.ok(fs.existsSync(path.join(run.dir, 'display/next.json')));
  assert.equal(fs.readFileSync(path.join(run.dir, 'display/.gitignore'), 'utf8'), '*\n');
  assert.equal(fs.readFileSync(path.join(run.root, '.maister/display/.gitignore'), 'utf8'), '*\n');
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: run.root, encoding: 'utf8' });
  assert.doesNotMatch(status, /display/);
  assert.match(status, /orchestrator-state\.yml/, 'the run itself still shows');
});

test('display: a .gitignore already in a display directory is left as it is', t => {
  const run = scratch(t);
  fs.mkdirSync(path.join(run.dir, 'display'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'display/.gitignore'), 'status.json\n');
  freeze(run);
  assert.equal(fs.readFileSync(path.join(run.dir, 'display/.gitignore'), 'utf8'), 'status.json\n');
});
