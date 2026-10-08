import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, ROOT, freeze, readDashboard, scratch, verb, write } from '../helpers.mjs';

// The implementation and verification phases run under a skill rather than under
// the engine, for hours and many waves. The dashboard stays live inside them
// because those skills send a state write at each interior moment — the empty
// patch that re-projects, or the verification cycle's own record — and the
// projection does the rest. Nothing here writes `dashboard-data.js`: every
// change the assertions see came out of `write-state`.

const SKILLS = path.join(ROOT, 'plugins/maister/skills');

/** The empty patch through the patch file, exactly as the executor sends it. */
function reproject(run) {
  fs.writeFileSync(path.join(run.dir, '.state-patch.json'), '{}');
  const result = verb(['write-state', `--state=${run.state}`, `--patch-file=${path.join(run.dir, '.state-patch.json')}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^dashboard-data\.js$/m, 'the re-projection publishes the dashboard');
  return readDashboard(run).phases.find(phase => phase.id === 'implementation');
}

/** The run's status file, as the display module reads it. */
function status(run) {
  return JSON.parse(fs.readFileSync(path.join(run.dir, 'display', 'status.json'), 'utf8'));
}

function plan(groups) {
  const sections = groups.map(([number, marks]) => [
    `### Task Group ${number}: Group ${number}`,
    '',
    ...marks.map((mark, index) => mark === '~'
      ? `- [~] ${number}.${index + 1} SKIPPED: no fixture for this platform`
      : `- [${mark}] ${number}.${index + 1} Step`),
    '',
  ].join('\n'));
  return ['# Implementation Plan', '', ...sections].join('\n');
}

test('the implementation phase progresses wave by wave through write-state alone', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { implementation: { status: 'running' } } });
  const dir = path.join(run.dir, 'implementation');
  fs.mkdirSync(dir);
  const planFile = path.join(dir, 'implementation-plan.md');
  const logFile = path.join(dir, 'work-log.md');
  const log = entries => fs.writeFileSync(logFile, ['# Work Log', '', ...entries].join('\n\n') + '\n');
  const parts = () => status(run).parts;
  const states = (...list) => list.map(state => ({ state }));

  // Entry: work log initialised, then the re-projection.
  fs.writeFileSync(planFile, plan([[1, [' ', ' ']], [2, [' ', ' ']], [3, [' ', ' ']]]));
  const entry = ['## 2026-01-05 10:00 - Implementation Started'];
  log(entry);
  let phase = reproject(run);
  assert.equal(phase.status, 'in_progress');
  assert.deepEqual(phase.progress, {
    groups_done: 0, groups_total: 3, current_wave: null, skipped: [], reverted: [],
    running_wave: null,
    groups: [{ group: 1, state: 'to_run' }, { group: 2, state: 'to_run' }, { group: 3, state: 'to_run' }],
  });
  assert.equal(parts().line, 'groups 0 of 3 done · 3 to run');

  // Wave 1 starts: its group runs until the wave resolves.
  const wave1 = [...entry, '## 2026-01-05 10:05 - Wave 1 Started: Groups 1'];
  log(wave1);
  phase = reproject(run);
  assert.equal(phase.progress.running_wave, 1);
  assert.deepEqual(parts(), {
    node: 'implementation', kind: 'groups', wave: 1,
    items: states('running', 'to_run', 'to_run'),
    line: 'groups 0 of 3 done · 1 running in wave 1 · 2 to run',
  });

  // Wave 1 resolves: a started wave whose groups all completed is no longer running.
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, [' ', ' ']], [3, [' ', ' ']]]));
  log([...wave1, '## 2026-01-05 10:30 - Group 1 Complete (wave 1)']);
  phase = reproject(run);
  assert.equal(phase.progress.groups_done, 1);
  assert.equal(phase.progress.current_wave, 1);
  assert.equal(phase.progress.running_wave, null);
  assert.equal(parts().line, 'groups 1 of 3 done · 2 to run');

  // Wave 2: group 2 lands with a skipped step, group 3 is reverted and stays open.
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, ['x', '~']], [3, [' ', ' ']]]));
  const wave2 = [
    ...wave1,
    '## 2026-01-05 10:30 - Group 1 Complete (wave 1)',
    '## 2026-01-05 10:35 - Wave 2 Started: Groups 2, 3',
    '## 2026-01-05 11:00 - Group 2 Complete (wave 2)',
    '## 2026-01-05 11:05 - Group 3 Reverted (wave 2): migration left the schema half-applied',
  ];
  log(wave2);
  phase = reproject(run);
  assert.deepEqual(phase.progress, {
    groups_done: 2,
    groups_total: 3,
    current_wave: 2,
    skipped: ['Group 2 — no fixture for this platform'],
    reverted: ['Group 3 — migration left the schema half-applied'],
    running_wave: null,
    groups: [{ group: 1, state: 'done' }, { group: 2, state: 'skipped' }, { group: 3, state: 'reverted' }],
  });
  assert.deepEqual(parts().items, states('done', 'skipped', 'reverted'));
  assert.equal(parts().line, 'groups 1 of 3 done · 1 reverted · 1 skipped');

  // Wave 3 retries the reverted group: running again, then done.
  log([...wave2, '## 2026-01-05 11:30 - Wave 3 Started: Groups 3']);
  reproject(run);
  assert.equal(parts().line, 'groups 1 of 3 done · 1 running in wave 3 · 1 skipped');
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, ['x', '~']], [3, ['x', 'x']]]));
  log([...wave2, '## 2026-01-05 11:30 - Wave 3 Started: Groups 3', '## 2026-01-05 12:00 - Group 3 Complete (wave 3)']);
  phase = reproject(run);
  phase = reproject(run);
  // The phase stays in progress at finalize — the caller completes it.
  assert.equal(phase.status, 'in_progress');
  assert.deepEqual(phase.progress, {
    groups_done: 3,
    groups_total: 3,
    current_wave: 3,
    skipped: ['Group 2 — no fixture for this platform'],
    reverted: ['Group 3 — migration left the schema half-applied'],
    running_wave: null,
    groups: [{ group: 1, state: 'done' }, { group: 2, state: 'skipped' }, { group: 3, state: 'done' }],
  });

  // Once the phase is no longer under way, the status carries no parts.
  write(run, { nodes: { implementation: { status: 'completed' } } });
  assert.equal(parts(), null);
});

test('the reviews the verifier dispatched reach the status as parts', t => {
  // The overlay adds the verifier under its own id, `review`: the node is found by what it runs.
  const run = scratch(t);
  freeze(run, { overlays: [path.join(FIXTURES, 'definitions/sample.overlay.yml')] });
  write(run, { nodes: { review: { status: 'running' } } });
  assert.equal(status(run).parts, null, 'no reviews recorded yet, no parts');

  const chosen = ['completeness', 'code review', 'pragmatic', 'reality check', 'production readiness'];
  write(run, { verification_context: { reviews: { chosen, done: [] } } });
  assert.equal(status(run).parts.line, 'reviews 0 of 5 done · 5 running: completeness, code review, pragmatic, reality check, production readiness');

  write(run, { verification_context: { reviews: { chosen, done: ['completeness', 'code review'] } } });
  assert.deepEqual(status(run).parts, {
    node: 'review',
    kind: 'reviews',
    wave: null,
    items: [
      { name: 'completeness', state: 'done' },
      { name: 'code review', state: 'done' },
      { name: 'pragmatic', state: 'running' },
      { name: 'reality check', state: 'running' },
      { name: 'production readiness', state: 'running' },
    ],
    line: 'reviews 2 of 5 done · 3 running: pragmatic, reality check, production readiness',
  });

  write(run, { verification_context: { reviews: { chosen, done: chosen } } });
  assert.equal(status(run).parts.line, 'reviews 5 of 5 done');
});

test('each verification cycle reaches the dashboard through its verification_context write', t => {
  const run = scratch(t);
  freeze(run);
  const clear = { verification_context: { last_status: null, issues_found: [] } };
  const lock = { id: 'C1', severity: 'critical', source: 'code_review', description: 'the lock is never released', fixable: true, fixed: false };
  const focus = { id: 'W1', severity: 'warning', source: 'pragmatic', description: 'the focus ring is hidden', fixable: false, fixed: false };

  // Cycle 1: entry clears, the cycle records its verdict.
  write(run, clear);
  assert.deepEqual(readDashboard(run).verification, { status: null, issues: [], fixes: [], reverify_count: 0 });
  write(run, { verification_context: { last_status: 'failed', issues_found: [lock, focus] } });
  assert.deepEqual(readDashboard(run).verification, { status: 'failed', issues: [lock, focus], fixes: [], reverify_count: 0 });

  // The caller's fix loop records the fix and the re-run.
  write(run, { verification_context: { fixes_applied: ['released the lock'], reverify_count: 1 } });

  // Cycle 2: the entry clear drops the old verdict and keeps the fix record.
  write(run, clear);
  assert.deepEqual(readDashboard(run).verification, { status: null, issues: [], fixes: ['released the lock'], reverify_count: 1 });
  const fixed = { ...lock, fixed: true };
  write(run, { verification_context: { last_status: 'passed_with_issues', issues_found: [fixed, focus] } });
  assert.deepEqual(readDashboard(run).verification, {
    status: 'passed_with_issues',
    issues: [fixed, focus],
    fixes: ['released the lock'],
    reverify_count: 1,
  });
});

test('neither phase-interior skill writes dashboard-data.js by hand', () => {
  const handWrite = /\b(?:rewrite|regenerate)s?\s+`dashboard-data\.js`|`dashboard-data\.js` rewritten/i;
  for (const skill of ['implementation-plan-executor', 'implementation-verifier']) {
    const text = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, handWrite, `${skill} instructs a hand write of the dashboard`);
    assert.match(text, /write-state/, `${skill} names the engine route`);
  }
  const patterns = fs.readFileSync(path.join(SKILLS, 'orchestrator-framework/references/orchestrator-patterns.md'), 'utf8');
  const dashboard = patterns.slice(patterns.indexOf('## 8. Operator Dashboard'), patterns.indexOf('## 9. HTML Companion Reports'));
  assert.match(dashboard, /the projection is the file's only writer/, 'the framework names the projection as the only writer');
  const rows = dashboard.split('\n').filter(line => /^\| \d+ \|/.test(line));
  assert.deepEqual(rows, [], 'no table assigns a dashboard rewrite moment to anyone');
});
