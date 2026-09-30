import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, freeze, readDashboard, scratch, verb, write } from '../helpers.mjs';

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

  // Entry: work log initialised, then the re-projection.
  fs.writeFileSync(planFile, plan([[1, [' ', ' ']], [2, [' ', ' ']], [3, [' ', ' ']]]));
  log(['## 2026-01-05 10:00 - Implementation Started']);
  let phase = reproject(run);
  assert.equal(phase.status, 'in_progress');
  assert.deepEqual(phase.progress, { groups_done: 0, groups_total: 3, current_wave: null, skipped: [], reverted: [] });

  // Wave 1.
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, [' ', ' ']], [3, [' ', ' ']]]));
  log(['## 2026-01-05 10:00 - Implementation Started', '## 2026-01-05 10:30 - Group 1 Complete (wave 1)']);
  phase = reproject(run);
  assert.deepEqual(phase.progress, { groups_done: 1, groups_total: 3, current_wave: 1, skipped: [], reverted: [] });

  // Wave 2: group 2 lands with a skipped step, group 3 is reverted and stays open.
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, ['x', '~']], [3, [' ', ' ']]]));
  const wave2 = [
    '## 2026-01-05 10:00 - Implementation Started',
    '## 2026-01-05 10:30 - Group 1 Complete (wave 1)',
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
  });

  // Wave 3, then finalize: the phase stays in progress — the caller completes it.
  fs.writeFileSync(planFile, plan([[1, ['x', 'x']], [2, ['x', '~']], [3, ['x', 'x']]]));
  log([...wave2, '## 2026-01-05 12:00 - Group 3 Complete (wave 3)']);
  phase = reproject(run);
  phase = reproject(run);
  assert.equal(phase.status, 'in_progress');
  assert.deepEqual(phase.progress, {
    groups_done: 3,
    groups_total: 3,
    current_wave: 3,
    skipped: ['Group 2 — no fixture for this platform'],
    reverted: ['Group 3 — migration left the schema half-applied'],
  });
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
  const rows = patterns.split('\n').filter(line => /^\| \d+ \|/.test(line));
  assert.ok(rows.length > 0, 'the rewrite-moments table is still found');
  for (const row of rows) {
    assert.doesNotMatch(row, /implementation-plan-executor|implementation-verifier/, `a moment is still owned by a skill: ${row}`);
  }
});
