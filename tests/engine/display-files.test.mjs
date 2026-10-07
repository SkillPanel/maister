import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FIXTURES, freeze, freezePatch, readState, scratch, sibling, verb, write } from '../helpers.mjs';

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
  assert.deepEqual(status.phase, { index: 1, total: 3, title: 'Scope analysis' });
  assert.equal(status.workflow, 'Development');
  assert.equal(status.task, 'Sample run');
  assert.equal(status.status, 'in_progress');
  assert.equal(status.line, 'Development · phase 1/3 · Scope analysis · Sample run');
  assert.equal(status.run_dir, run.dir);
  assert.equal(status.dashboard, pathToFileURL(path.join(run.dir, 'dashboard.html')).href);
  assert.equal(status.version, 1);
});

test('display: a later write moves the phase; the gate never counts, a skipped node leaves the total', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 3, title: 'Implementation' });

  write(run, { nodes: { approval: { status: 'completed' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 3, title: 'Implementation' });

  write(run, { nodes: { research: { status: 'skipped' } } });
  assert.deepEqual(display(run, 'status.json').phase, { index: 2, total: 2, title: 'Implementation' });

  write(run, { nodes: { implementation: { status: 'completed' } } });
  const done = display(run, 'status.json');
  assert.deepEqual(done.phase, { index: 2, total: 2, title: null });
  assert.equal(done.line, 'Development · phase 2/2 · Sample run');
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
  assert.equal(display(run, 'status.json').phase.title, 'Publish');

  const result = verb(['gate-revise', `--state=${run.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(display(run, 'status.json').phase.index, 1);
  assert.equal(display(run, 'status.json').phase.title, 'Draft');
});

test('display: a state write removes a gate panel the write has answered', t => {
  const run = scratch(t);
  freeze(run);
  const next = path.join(run.dir, 'display/next.json');
  fs.writeFileSync(next, '{"version":1}\n');
  write(run, { nodes: { approval: { status: 'completed' } } });
  assert.equal(fs.existsSync(next), false);
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
  const result = verb(['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'completed' } } }, { CLAUDE_CODE_SESSION_ID: 'session-a' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: \.maister\/display\/sessions\/session-a\.json was not written \(display-unwritable: /m);
  assert.equal(readState(run).workflow.nodes.analysis.status, 'completed');
  assert.equal(display(run, 'status.json').phase.index, 2, 'the run\'s own files are still written');
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
