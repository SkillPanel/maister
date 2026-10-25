import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readState, scratch, sibling, verb, walkTo, write } from '../helpers.mjs';

// The two companion checks and the registration fix, on a custom definition:
// a node that completes owes the HTML companions its definition declares, the
// writer names each one it did not find, and the close names them again.

const DEFINITIONS = path.join(FIXTURES, 'definitions');
const CHECK = path.join(DEFINITIONS, 'companion-check.yml');
const CHECK_OVERLAY = path.join(DEFINITIONS, 'companion-check.overlay.yml');

/** A frozen companion-check run with every node pending; the guarded deep-dive is off. */
function frozen(t, { html = true, overlays = [] } = {}) {
  const run = scratch(t, { type: 'companion-check', name: '2026-01-05-companion-check' });
  freeze(run, { definition: CHECK, overlays, orchestrator: { options: { inputs: { deep: false }, html_output: html } } });
  return run;
}

/** Write a file at `relative` under `dir`, creating its directory. */
function put(dir, relative) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Page\n');
}

function writeState(run, patch) {
  return verb(['write-state', `--state=${run.state}`], patch);
}

/** The `companion-missing:` paragraph a write printed, as its lines; [] when there is none. */
function companionLines(stdout) {
  return stdout.split('\n').filter(line => line.startsWith('companion-missing: '));
}

test('a node completed through nodes: alone names the companion it owes and did not write', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/data.json');
  const result = writeState(run, { nodes: { draft: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  // The JSON artifact owes nothing: a companion is written for markdown only.
  assert.match(result.stdout, /\n\ncompanion-missing: draft analysis\/report\.html\n$/);
  assert.deepEqual(companionLines(result.stdout), ['companion-missing: draft analysis/report.html']);
});

test('silent when the companion exists, the markdown does not, the key is sanctioned, the node skipped, or completed before', t => {
  const run = frozen(t);
  // The companion is on disk beside its markdown.
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/report.html');
  let result = writeState(run, { nodes: { draft: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), []);

  // The notes were never written, and the log is sanctioned absent with a reason.
  put(run.dir, 'review/log.md');
  result = writeState(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed.', absent: { log: 'nothing to log this time' } } },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), []);

  // A skipped node never completed, so it owes nothing.
  put(run.dir, 'analysis/deep.md');
  result = writeState(run, { nodes: { 'deep-dive': { status: 'skipped' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), []);

  // A node completed by an earlier write is not judged again by a later one.
  const late = frozen(t);
  put(late.dir, 'analysis/report.md');
  assert.equal(companionLines(writeState(late, { nodes: { draft: { status: 'completed' } } }).stdout).length, 1);
  result = writeState(late, { nodes: { review: { status: 'running' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), []);
});

test('an overlay-added node owes the companion its overlay declares', t => {
  const run = frozen(t, { overlays: [CHECK_OVERLAY] });
  put(run.dir, 'verification/extra.md');
  put(run.dir, 'review/notes.md');
  put(run.dir, 'review/notes.html');
  walkTo(run, ['review']);
  const result = writeState(run, { nodes: { review: { status: 'completed' }, extra: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), ['companion-missing: extra verification/extra.html']);
});

test('a sub-run node is held to the companion in its child\'s directory, joined through task_path', t => {
  const run = frozen(t);
  const child = sibling(run, { type: 'companion-check-child', name: '2026-01-05-child' });
  put(child.dir, 'analysis/findings.md');
  // A file of the same name in the parent's directory is not the child's.
  put(run.dir, 'analysis/findings.html');
  walkTo(run, ['audit']);
  const result = writeState(run, { nodes: { audit: { status: 'completed', values: { task_path: child.path, run_id: child.name } } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(companionLines(result.stdout), [`companion-missing: audit ${child.path}/analysis/findings.html`]);

  // Without the child's address there is nowhere to look, and nothing is printed.
  const bare = frozen(t);
  put(bare.dir, 'analysis/findings.md');
  walkTo(bare, ['audit']);
  const silent = writeState(bare, { nodes: { audit: { status: 'completed' } } });
  assert.equal(silent.code, 0, silent.stderr);
  assert.deepEqual(companionLines(silent.stdout), []);
});

test('registration fix: a summary written before the node completed gains the companion; none is created', t => {
  const run = frozen(t);
  write(run, { nodes: { draft: { status: 'running' } }, node_summaries: { draft: { summary: 'Drafted.' } } });
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/report.html');
  const result = writeState(run, { nodes: { draft: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.split('\n').includes('node_summaries.draft'), result.stdout);
  const summary = readState(run).node_summaries.draft;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.summary, 'Drafted.');
  assert.deepEqual(summary.artifacts, [{ path: 'analysis/report.md', label: null, html: 'analysis/report.html' }]);

  // A node with no summary gets none created by its completion.
  put(run.dir, 'review/notes.md');
  put(run.dir, 'review/notes.html');
  const review = writeState(run, { nodes: { review: { status: 'completed' } } });
  assert.equal(review.code, 0, review.stderr);
  assert.equal(Object.hasOwn(readState(run).node_summaries, 'review'), false);
});

test('recovery: the companion written, an empty summary re-sent registers it and prints no line', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/report.md');
  const first = writeState(run, { nodes: { draft: { status: 'completed' } }, node_summaries: { draft: { summary: 'Drafted.' } } });
  assert.deepEqual(companionLines(first.stdout), ['companion-missing: draft analysis/report.html']);
  assert.equal(readState(run).node_summaries.draft.artifacts[0].html, null);

  put(run.dir, 'analysis/report.html');
  const resent = writeState(run, { node_summaries: { draft: {} } });
  assert.equal(resent.code, 0, resent.stderr);
  assert.deepEqual(companionLines(resent.stdout), []);
  assert.equal(readState(run).node_summaries.draft.artifacts[0].html, 'analysis/report.html');
});

test('run-complete: every missing-artifact line, then every missing-companion line, then the stop notice, the marker last', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/data.json');
  write(run, {
    task: { status: 'stopped' },
    nodes: {
      draft: { status: 'completed' },
      review: { status: 'completed' },
      'deep-dive': { status: 'stopped' },
      audit: { status: 'stopped' },
      remote: { status: 'stopped' },
      'wrap-up': { status: 'stopped' },
    },
  });
  const result = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  // The artifact lines in the resolved graph's own order, which sorts a node's keys.
  assert.deepEqual(lines.slice(0, 3), [
    'missing-artifact: review review/log.md',
    'missing-artifact: review review/notes.md',
    'missing-companion: draft analysis/report.html',
  ]);
  assert.match(lines[3], /^run stopped: /);
  assert.deepEqual(lines.slice(4), ['RUN-COMPLETE', '']);

  // A failed ending keeps its own exit code, the lines above its marker.
  const failed = frozen(t);
  put(failed.dir, 'analysis/report.md');
  put(failed.dir, 'analysis/data.json');
  write(failed, { task: { status: 'failed' }, nodes: { draft: { status: 'completed' }, review: { status: 'failed' } } });
  const failure = verb(['run-complete', `--state=${failed.state}`]);
  assert.equal(failure.code, 1);
  assert.equal(failure.stdout, 'missing-companion: draft analysis/report.html\nRUN-FAILED: node review failed\n');
});

/** Close a companion-check run as completed, every artifact on disk and every companion but `without`. */
function closeCompleted(t, { html = true, without = [] } = {}) {
  const run = frozen(t, { html });
  const child = sibling(run, { type: 'companion-check-child', name: '2026-01-05-child' });
  for (const file of ['analysis/report.md', 'analysis/data.json', 'review/notes.md', 'review/log.md']) put(run.dir, file);
  for (const file of ['analysis/report.html', 'review/notes.html', 'review/log.html']) {
    if (!without.includes(file)) put(run.dir, file);
  }
  put(child.dir, 'analysis/findings.md');
  put(child.dir, 'analysis/findings.html');
  // The dispatched node's work lands in a member repository: its markdown is
  // here, its companion is not, and neither check looks.
  put(child.dir, 'analysis/remote.md');
  const address = { task_path: child.path, run_id: child.name };
  const written = writeState(run, {
    task: { status: 'completed' },
    nodes: {
      draft: { status: 'completed' },
      review: { status: 'completed' },
      'deep-dive': { status: 'skipped' },
      audit: { status: 'completed', values: address },
      remote: { status: 'completed', values: address },
      'wrap-up': { status: 'completed' },
    },
  });
  assert.equal(written.code, 0, written.stderr);
  return { run, written, closed: verb(['run-complete', `--state=${run.state}`]) };
}

test('run-complete: silent with the HTML output off, and a dir: node is never held to a companion', t => {
  const off = closeCompleted(t, { html: false, without: ['analysis/report.html', 'review/notes.html', 'review/log.html'] });
  assert.deepEqual(companionLines(off.written.stdout), []);
  assert.equal(off.closed.code, 0, off.closed.stderr);
  assert.equal(off.closed.stdout, 'RUN-COMPLETE\n');

  const on = closeCompleted(t);
  assert.deepEqual(companionLines(on.written.stdout), []);
  assert.equal(on.closed.code, 0, on.closed.stderr);
  assert.equal(on.closed.stdout, 'RUN-COMPLETE\n');
  assert.equal(on.closed.stderr, '');
});

test('recovery without a summary: the companion is registered by the summary write still owed', t => {
  const run = frozen(t);
  put(run.dir, 'review/notes.md');
  put(run.dir, 'review/log.md');
  walkTo(run, ['review']);
  const first = writeState(run, { nodes: { review: { status: 'completed' } } });
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(companionLines(first.stdout),
    ['companion-missing: review review/notes.html', 'companion-missing: review review/log.html']);
  assert.equal(Object.hasOwn(readState(run).node_summaries ?? {}, 'review'), false, 'no summary is invented');

  put(run.dir, 'review/notes.html');
  put(run.dir, 'review/log.html');
  const owed = writeState(run, { node_summaries: { review: { summary: 'Reviewed.' } } });
  assert.equal(owed.code, 0, owed.stderr);
  assert.deepEqual(companionLines(owed.stdout), []);
  const artifacts = readState(run).node_summaries.review.artifacts;
  assert.deepEqual(artifacts.map(artifact => artifact.html), ['review/notes.html', 'review/log.html']);
});

/** The `companion-stale:` lines a write printed; [] when there is none. */
function staleLines(stdout) {
  return stdout.split('\n').filter(line => line.startsWith('companion-stale: '));
}

/** Date the file at `relative` under `dir` `seconds` from now, its access and modification times both. */
function age(dir, relative, seconds) {
  const when = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(path.join(dir, relative), when, when);
}

test('a page older than its markdown is named by the next write that completes a node, whichever node owns it', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/report.html');
  let result = writeState(run, { nodes: { draft: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(staleLines(result.stdout), []);

  // A later step edits the draft's markdown and registers nothing of it.
  age(run.dir, 'analysis/report.html', -60);
  put(run.dir, 'review/notes.md');
  put(run.dir, 'review/notes.html');
  // A write that completes nothing says nothing.
  result = writeState(run, { nodes: { review: { status: 'running' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(staleLines(result.stdout), []);
  // The review completing is the first write that judges the run's pages.
  result = writeState(run, { nodes: { review: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /\n\ncompanion-stale: draft analysis\/report\.html\n$/);
  assert.deepEqual(staleLines(result.stdout), ['companion-stale: draft analysis/report.html']);

  // Regenerated, the page is newer again and nothing is named.
  age(run.dir, 'analysis/report.html', 60);
  walkTo(run, ['deep-dive']);
  put(run.dir, 'analysis/deep.md');
  put(run.dir, 'analysis/deep.html');
  result = writeState(run, { nodes: { 'deep-dive': { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(staleLines(result.stdout), []);
});

test('a stale page shares the paragraph of a missing one; html_output off names neither', t => {
  const run = frozen(t);
  put(run.dir, 'analysis/report.md');
  put(run.dir, 'analysis/report.html');
  writeState(run, { nodes: { draft: { status: 'completed' } } });
  age(run.dir, 'analysis/report.html', -60);
  put(run.dir, 'review/notes.md');
  const result = writeState(run, { nodes: { review: { status: 'completed' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\n\ncompanion-missing: review review\/notes\.html\ncompanion-stale: draft analysis\/report\.html\n$/);

  const off = frozen(t, { html: false });
  put(off.dir, 'analysis/report.md');
  put(off.dir, 'analysis/report.html');
  age(off.dir, 'analysis/report.html', -60);
  const silent = writeState(off, { nodes: { draft: { status: 'completed' } } });
  assert.equal(silent.code, 0, silent.stderr);
  assert.deepEqual(staleLines(silent.stdout), []);
});
