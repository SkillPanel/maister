import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { artifactOf, decisionOf, deriveProgress, issueOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/dashboard.mjs';
import { FIXTURES, freeze, readDashboard, scratch, write } from '../helpers.mjs';

// ---------------------------------------------------------------------------
// the projection, through write-state
// ---------------------------------------------------------------------------

test('every state write republishes dashboard-data.js beside the state', t => {
  const run = scratch(t);
  freeze(run);
  const data = readDashboard(run);
  assert.equal(data.task.title, 'Sample run');
  assert.equal(data.task.type, 'development');
  assert.equal(data.task.current_activity, null);
  assert.deepEqual(data.phases.map(phase => phase.id), ['analysis', 'approval', 'implementation', 'research']);
  assert.deepEqual(data.phases.map(phase => phase.icon_hint), ['analysis', 'spec', 'code', 'analysis']);
  assert.deepEqual(data.verification, { status: null, issues: [], fixes: [], reverify_count: 0 });
});

test('node statuses are mirrored onto the shorter phase vocabulary', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    nodes: {
      analysis: { status: 'completed' },
      approval: { status: 'skipped' },
      implementation: { status: 'running' },
      research: { status: 'waiting' },
    },
  });
  const phases = readDashboard(run).phases;
  assert.deepEqual(phases.map(phase => phase.status), ['completed', 'skipped', 'in_progress', 'in_progress']);
});

test('summary lists are normalized: artifacts to objects, gate answers to decisions, junk dropped', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    node_summaries: {
      analysis: {
        status: 'completed',
        summary: 'Scoped the change.',
        decisions: ['keep the parser', { option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }, 42],
        risks: ['the writer is untested on Windows'],
        artifacts: ['analysis/report.md', { path: 'analysis/notes.md', label: 'Notes', html: null }, 7],
      },
    },
  });
  const analysis = readDashboard(run).phases[0];
  assert.equal(analysis.summary, 'Scoped the change.');
  assert.deepEqual(analysis.decisions, [
    'keep the parser',
    { decision: 'continue', option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' },
  ]);
  assert.deepEqual(analysis.risks, ['the writer is untested on Windows']);
  assert.deepEqual(analysis.artifacts, [
    { path: 'analysis/report.md', label: null, html: null },
    { path: 'analysis/notes.md', label: 'Notes', html: null },
  ]);
});

test('an empty field on the node summary falls through to the phase summary, field by field', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    node_summaries: {
      analysis: { summary: 'Scoped on the node.', decisions: [], risks: ['node risk'], artifacts: [] },
    },
    phase_summaries: {
      analysis: {
        summary: 'Scoped on the phase.',
        decisions: ['keep the parser'],
        risks: ['phase risk'],
        artifacts: ['analysis/report.md'],
      },
    },
  });
  const analysis = readDashboard(run).phases.find(phase => phase.id === 'analysis');
  assert.equal(analysis.summary, 'Scoped on the node.');
  assert.deepEqual(analysis.decisions, ['keep the parser']);
  assert.deepEqual(analysis.risks, ['node risk'], 'a field filled on both sources is the node\'s alone');
  assert.deepEqual(analysis.artifacts, [{ path: 'analysis/report.md', label: null, html: null }]);
});

test('verification issues are normalized to objects; a bare count is dropped', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    verification_context: {
      last_status: 'passed_with_issues',
      issues_found: ['critical: the lock is never released', 'e2e minor: the focus ring', { severity: 'low', description: 'kept' }, 9],
      fixes_applied: ['released the lock'],
      reverify_count: 1,
    },
  });
  assert.deepEqual(readDashboard(run).verification, {
    status: 'passed_with_issues',
    issues: [
      { severity: 'critical', description: 'the lock is never released' },
      { severity: 'info', description: 'e2e minor: the focus ring' },
      { severity: 'low', description: 'kept' },
    ],
    fixes: ['released the lock'],
    reverify_count: 1,
  });
});

test('the executor phase carries progress derived from the plan and the work log', t => {
  const run = scratch(t, { fixture: 'plan' });
  freeze(run);
  const phases = readDashboard(run).phases;
  const implementation = phases.find(phase => phase.id === 'implementation');
  assert.deepEqual(implementation.progress, {
    groups_done: 2,
    groups_total: 3,
    current_wave: 2,
    skipped: ['Group 2 — no fixture for the Windows path yet'],
    reverted: [],
  });
  for (const phase of phases.filter(phase => phase.id !== 'implementation')) {
    assert.equal(Object.hasOwn(phase, 'progress'), false, `${phase.id} carries no progress key`);
  }
});

test('html_output: false writes no dashboard file, and removes one a previous write left', t => {
  const run = scratch(t);
  freeze(run);
  const file = path.join(run.dir, 'dashboard-data.js');
  assert.ok(fs.existsSync(file));
  const off = write(run, { orchestrator: { options: { html_output: false } } });
  assert.equal(fs.existsSync(file), false);
  assert.match(off.stdout, /^dashboard-data\.js$/m, 'the removal is reported among the changed paths');
  write(run, { nodes: { analysis: { status: 'running' } } });
  assert.equal(fs.existsSync(file), false);
});

test('html_output: false from the freeze on never publishes a dashboard', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { options: { html_output: false } } });
  assert.equal(readDashboard(run), null);
});

// ---------------------------------------------------------------------------
// the normalizers the projection is built from
// ---------------------------------------------------------------------------

test('issueOf: a severity prefix is read only when it names a severity', () => {
  assert.deepEqual(issueOf('HIGH: slow query'), { severity: 'high', description: 'slow query' });
  assert.deepEqual(issueOf('note: not a severity'), { severity: 'info', description: 'note: not a severity' });
  assert.deepEqual(issueOf('no prefix at all'), { severity: 'info', description: 'no prefix at all' });
  const object = { severity: 'odd', description: 'passes through' };
  assert.equal(issueOf(object), object);
  for (const junk of [9, true, null, ['a']]) assert.equal(issueOf(junk), null);
});

test('artifactOf: a string is a path, an object passes, anything else is dropped', () => {
  assert.deepEqual(artifactOf('a/b.md'), { path: 'a/b.md', label: null, html: null });
  const object = { path: 'x.md', label: 'X' };
  assert.equal(artifactOf(object), object);
  for (const junk of [1, false, null, ['a/b.md']]) assert.equal(artifactOf(junk), null);
});

test('decisionOf: the three frozen shapes pass; a gate answer gains its decision', () => {
  assert.equal(decisionOf('plain'), 'plain');
  const written = { decision: 'd', rationale: 'r' };
  assert.equal(decisionOf(written), written);
  const clarification = { question: 'q', answer: 'a' };
  assert.equal(decisionOf(clarification), clarification);
  assert.deepEqual(decisionOf({ option: 'stop-here', answered_by: 'op', at: 't' }),
    { decision: 'stop-here', option: 'stop-here', answered_by: 'op', at: 't' });
  for (const junk of [{ note: 'n' }, 3, null]) assert.equal(decisionOf(junk), null);
});

test('deriveProgress: counts groups, not the sections that close them', () => {
  const plan = fs.readFileSync(path.join(FIXTURES, 'runs/plan/implementation/implementation-plan.md'), 'utf8');
  const progress = deriveProgress(plan, '');
  assert.equal(progress.groups_total, 3);
  assert.equal(progress.groups_done, 2);
  assert.equal(progress.current_wave, null, 'an empty log has no wave, and that is not doubt');
});

test('deriveProgress: plan-side doubt yields null rather than a guess', () => {
  assert.equal(deriveProgress('# no groups here\n', ''), null);
  assert.equal(deriveProgress('### Task Group 1: Empty\n\nprose only\n', ''), null);
});

test('deriveProgress: a reverted group is labelled with its reason', () => {
  const plan = '### Task Group 4: Schema\n\n- [ ] 4.1 migrate\n';
  const log = '## 2026-01-05 15:10 - Group 4 Reverted (wave 3): migration left the schema half-applied\n';
  assert.deepEqual(deriveProgress(plan, log), {
    groups_done: 0,
    groups_total: 1,
    current_wave: 3,
    skipped: [],
    reverted: ['Group 4 — migration left the schema half-applied'],
  });
});
