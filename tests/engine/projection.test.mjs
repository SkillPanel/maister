import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { artifactOf, decisionOf, deriveProgress, issueOf, render } from '../../plugins/maister/skills/workflow-engine/scripts/lib/dashboard.mjs';
import { FIXTURES, freeze, readDashboard, readState, scratch, write } from '../helpers.mjs';

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

test('the type is read from a task path recorded with either separator', t => {
  for (const taskPath of ['.maister/tasks/research/2026-01-05-sample', '.maister\\tasks\\research\\2026-01-05-sample']) {
    const run = scratch(t);
    freeze(run, { orchestrator: { task_path: taskPath } });
    const data = readDashboard(run);
    assert.equal(data.task.type, 'research', taskPath);
    assert.equal(data.task.path, taskPath);
  }
});

test('a phase is named by its title, else by its id made readable; the id stays the id', t => {
  const run = scratch(t);
  freeze(run);
  const phases = readDashboard(run).phases;
  assert.deepEqual(phases.map(phase => phase.id), ['analysis', 'approval', 'implementation', 'research']);
  assert.deepEqual(phases.map(phase => phase.name), ['Scope analysis', 'Approve the scope', 'Implementation', 'Research']);
});

test('an overlay titles the node it adds and retitles the base; the run\'s profile has the last word', t => {
  const overlay = path.join(FIXTURES, 'definitions/sample.overlay.yml');
  for (const [profile, review] of [[null, 'Peer review'], ['quick', 'Quick review']]) {
    const run = scratch(t);
    freeze(run, { overlays: [overlay], profile });
    const names = Object.fromEntries(readDashboard(run).phases.map(phase => [phase.id, phase.name]));
    assert.equal(names.analysis, 'Impact analysis');
    assert.equal(names.review, review);
    assert.equal(names.implementation, 'Implementation');
  }
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
        decisions: ['keep the parser', { option: 'continue', answered_by: 'marek', at: '2026-01-05T09:05:00Z' }, 42],
        risks: ['the writer is untested on Windows'],
        artifacts: ['analysis/report.md', { path: 'analysis/notes.md', label: 'Notes', html: null }, 7],
      },
    },
  });
  const analysis = readDashboard(run).phases[0];
  assert.equal(analysis.summary, 'Scoped the change.');
  assert.deepEqual(analysis.decisions, [
    { decision: 'keep the parser', by: 'run' },
    { decision: 'Continue', by: 'operator', option: 'continue', answered_by: 'marek', at: '2026-01-05T09:05:00Z' },
  ]);
  assert.deepEqual(analysis.risks, [{ risk: 'the writer is untested on Windows', tag: 'open', change: null }]);
  assert.deepEqual(analysis.artifacts, [
    { path: 'analysis/report.md', label: null, html: null, role: null },
    { path: 'analysis/notes.md', label: 'Notes', html: null },
  ]);
});

test('what a node fixed without asking projects apart from its decisions, and only when it fixed something', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    node_summaries: {
      analysis: {
        status: 'completed',
        summary: 'Scoped the change.',
        fixes_applied: [{ finding: 'The parser dropped a trailing comma', change: 'Kept the comma' }, 'released the lock'],
        decisions: [{ decision: 'keep the parser', by: 'run' }],
      },
    },
  });
  const [analysis, next] = readDashboard(run).phases;
  assert.deepEqual(analysis.fixes, [
    { finding: 'The parser dropped a trailing comma', change: 'Kept the comma' },
    { finding: null, change: 'released the lock' },
  ]);
  assert.deepEqual(analysis.decisions, [{ decision: 'keep the parser', by: 'run' }]);
  assert.equal(Object.hasOwn(next, 'fixes'), false, 'a phase that fixed nothing carries no fixes key');
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
  assert.deepEqual(analysis.decisions, [{ decision: 'keep the parser', by: 'run' }]);
  assert.deepEqual(analysis.risks, [{ risk: 'node risk', tag: 'open', change: null }], 'a field filled on both sources is the node\'s alone');
  assert.deepEqual(analysis.artifacts, [{ path: 'analysis/report.md', label: null, html: null, role: null }]);
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
    running_wave: null,
    groups: [{ group: 1, state: 'done' }, { group: 2, state: 'skipped' }, { group: 11, state: 'to_run' }],
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

test('issueOf: the issue-id shapes verification writes carry their severity', () => {
  assert.deepEqual(issueOf('W3 no files allow-list in package.json (deferred by operator)'),
    { id: 'W3', severity: 'warning', description: 'no files allow-list in package.json (deferred by operator)' });
  assert.deepEqual(
    issueOf('W5 warning (fixable, pre-existing, accepted by operator): fromEnv walks inherited keys — src/env.js:8-13'),
    { id: 'W5', severity: 'warning', description: 'fromEnv walks inherited keys — src/env.js:8-13 (fixable, pre-existing, accepted by operator)' });
  assert.deepEqual(issueOf('I10 info: literal source flattens a Map target'),
    { id: 'I10', severity: 'info', description: 'literal source flattens a Map target' });
  assert.deepEqual(issueOf('C2 the lock is never released'),
    { id: 'C2', severity: 'critical', description: 'the lock is never released' });
  assert.deepEqual(issueOf('M1 a medium-looking id names no severity'),
    { id: 'M1', severity: 'info', description: 'a medium-looking id names no severity' });
  assert.deepEqual(issueOf('CHANGELOG.md not in tarball — operator call, left as-is'),
    { severity: 'info', description: 'CHANGELOG.md not in tarball — operator call, left as-is' });
});

test('artifactOf: a string is a path, an object passes, anything else is dropped', () => {
  assert.deepEqual(artifactOf('a/b.md'), { path: 'a/b.md', label: null, html: null, role: null });
  const object = { path: 'x.md', label: 'X' };
  assert.equal(artifactOf(object), object);
  for (const junk of [1, false, null, ['a/b.md']]) assert.equal(artifactOf(junk), null);
});

test('decisionOf: every shape a run wrote reads as {decision, by}; a gate answer by its label', () => {
  assert.deepEqual(decisionOf('plain'), { decision: 'plain', by: 'run' });
  assert.deepEqual(decisionOf({ decision: 'd', rationale: 'r' }), { decision: 'd', rationale: 'r', by: 'run' });
  assert.deepEqual(decisionOf({ question: 'q', answer: 'a' }),
    { question: 'q', answer: 'a', decision: 'a', by: 'operator', as_recommended: null });
  assert.deepEqual(decisionOf({ option: 'stop-here', answered_by: 'op', at: 't' }),
    { option: 'stop-here', answered_by: 'op', at: 't', decision: 'Stop here', by: 'operator' });
  assert.deepEqual(decisionOf({ option: 'stop-here' }, option => `Label of ${option}`),
    { option: 'stop-here', decision: 'Label of stop-here', by: 'operator' });
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
    running_wave: null,
    groups: [{ group: 4, state: 'reverted' }],
  });
});

test('deriveProgress: the last wave started runs until its groups finish or revert', () => {
  const plan = ['### Task Group 1: A', '', '- [x] 1.1 a', '', '### Task Group 2: B', '', '- [ ] 2.1 b', '',
    '### Task Group 3: C', '', '- [ ] 3.1 c', '', '### Task Group 4: D', '', '- [ ] 4.1 d', ''].join('\n');
  const start = '## 2026-01-05 10:00 - wave 2 started: Groups 1, 2 and 3\n';
  const progress = deriveProgress(plan, start);
  assert.equal(progress.running_wave, 2);
  assert.deepEqual(progress.groups.map(group => group.state), ['done', 'running', 'running', 'to_run']);

  const reverted = deriveProgress(plan, `${start}## 2026-01-05 10:40 - Group 3 Reverted (wave 2): tests hung\n`);
  assert.deepEqual(reverted.groups.map(group => group.state), ['done', 'running', 'reverted', 'to_run']);

  const older = deriveProgress(plan, `## … - Wave 1 Started: Group 4\n${start}`);
  assert.equal(older.groups[3].state, 'to_run', 'only the last wave started is running');
});

// ---------------------------------------------------------------------------
// nodes an overlay added
// ---------------------------------------------------------------------------

/** An overlay over the sample, written to a scratch directory removed when the test ends. */
function sampleOverlay(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.overlay.yml');
  fs.writeFileSync(file, `${['extends: sample.yml', ...lines].join('\n')}\n`);
  return file;
}

test('a node an overlay added gets its declared artifact registered on completion, and its icon', t => {
  const overlay = sampleOverlay(t, [
    'display:',
    '  icons:',
    '    check: verify',
    'add:',
    '  check:',
    '    uses: skill:implementation-verifier',
    '    needs: [analysis]',
    '    before: [approval]',
    '    outputs:',
    '      artifacts:',
    '        report: check/report.md',
  ]);
  const run = scratch(t);
  freeze(run, { overlays: [overlay] });
  fs.mkdirSync(path.join(run.dir, 'check'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'check/report.md'), '# Check\n');
  write(run, { nodes: { analysis: { status: 'completed' }, check: { status: 'completed' } }, node_summaries: { check: { summary: 'Checked.' } } });
  const expected = [{ path: 'check/report.md', label: null, html: null }];
  assert.deepEqual(readState(run).node_summaries.check.artifacts, expected);
  const phase = readDashboard(run).phases.find(entry => entry.id === 'check');
  assert.equal(phase.icon_hint, 'verify');
  assert.deepEqual(phase.artifacts, expected);
});

test('an executor node an overlay added in place of the base\'s carries the plan progress', t => {
  const overlay = sampleOverlay(t, [
    'disable: [implementation]',
    'add:',
    '  build:',
    '    uses: skill:implementation-plan-executor',
    '    needs: [approval]',
    '    before: [research]',
  ]);
  const run = scratch(t, { fixture: 'plan' });
  freeze(run, { overlays: [overlay] });
  const phases = readDashboard(run).phases;
  assert.equal(phases.find(phase => phase.id === 'build').progress?.groups_total, 3);
  assert.ok(phases.every(phase => phase.id === 'build' || !Object.hasOwn(phase, 'progress')));
});

// ---------------------------------------------------------------------------
// a sanctioned absence reads "not produced", with its reason
// ---------------------------------------------------------------------------

test('a sanctioned absence projects as an additive phase field carrying the declared path and the reason', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { summary: 'Nothing to analyse.', absent: { report: 'the ticket names no code' } } },
  });
  const phases = readDashboard(run).phases;
  const analysis = phases.find(phase => phase.id === 'analysis');
  assert.deepEqual(analysis.absent, [{ artifact: 'report', path: 'analysis/report.md', reason: 'the ticket names no code' }]);
  assert.deepEqual(analysis.artifacts, [], 'an absence is never listed as an artifact');
  assert.ok(phases.every(phase => phase.id === 'analysis' || !Object.hasOwn(phase, 'absent')), 'a phase with no absence carries no key');
});

test('a sub-run node\'s absence names the path in its child\'s directory, as its artifacts are registered', t => {
  const run = scratch(t, { type: 'closing', name: '2026-01-05-closing' });
  freeze(run, { definition: path.join(FIXTURES, 'definitions/closing.yml') });
  const child = '.maister/tasks/closing-child/2026-01-05-child';
  write(run, {
    nodes: {
      intake: { status: 'completed', values: { needs_review: false } },
      review: { status: 'skipped' },
      'deep-dive': { status: 'skipped' },
      audit: { status: 'completed', values: { task_path: child, run_id: '2026-01-05-child' } },
    },
    node_summaries: { audit: { summary: 'The child skipped its scan.', absent: { findings: 'the child skipped the node that writes it' } } },
  });
  const audit = readDashboard(run).phases.find(phase => phase.id === 'audit');
  assert.deepEqual(audit.absent, [{
    artifact: 'findings',
    path: '../../closing-child/2026-01-05-child/analysis/findings.md',
    reason: 'the child skipped the node that writes it',
  }]);
});

test('with the definition gone the absence keeps its reason and carries no path', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-definition-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const definition = path.join(dir, 'sample.yml');
  for (const file of ['sample.yml', 'sample.md']) fs.copyFileSync(path.join(FIXTURES, 'definitions', file), path.join(dir, file));
  const run = scratch(t);
  freeze(run, { definition });
  for (const file of ['sample.yml', 'sample.md']) fs.rmSync(path.join(dir, file));
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { absent: { report: 'the ticket names no code' } } },
  });
  const analysis = readDashboard(run).phases.find(phase => phase.id === 'analysis');
  assert.deepEqual(analysis.absent, [{ artifact: 'report', path: null, reason: 'the ticket names no code' }]);
});

// ---------------------------------------------------------------------------
// held and approved choices, through the pure render
// ---------------------------------------------------------------------------

const NOW = '2026-01-05T09:00:00Z';

/** A held choice the run made on `analysis`, classed `approve`. */
const held = (extra = {}) => ({
  decision: 'q-scope: keep the parser', by: 'run', question_id: 'q-scope',
  triage: { class: 'approve', held: true }, ...extra,
});

/** The approval a checkpoint's continue records for it. */
const approval = (extra = {}) => ({
  decision: 'q-scope: keep the parser', by: 'operator', node: 'analysis', question_id: 'q-scope',
  triage: { class: 'approve' }, ...extra,
});

/** The projected decisions of each phase, keyed by node id. */
function decisionsByNode(summaries) {
  const state = {
    workflow: { nodes: { analysis: { status: 'completed' }, checkpoint: { status: 'completed' } } },
    node_summaries: summaries,
  };
  const text = render({ state }, { now: NOW });
  const data = JSON.parse(text.slice('window.MAISTER_DATA = '.length, -2));
  return { text, byNode: Object.fromEntries(data.phases.map(phase => [phase.id, phase.decisions])) };
}

test('a held choice an approval matches anywhere in the run is marked approved by its approver', () => {
  const { byNode } = decisionsByNode({
    analysis: { decisions: [held()] },
    checkpoint: { decisions: [{ option: 'continue', answered_by: 'marek' }, approval({ answered_by: 'marek' })] },
  });
  assert.deepEqual(byNode.analysis[0].approved, { by: 'marek' });
  assert.equal(Object.hasOwn(byNode.checkpoint[1], 'approved'), false, 'the approval item itself gains nothing');
});

test('an approval with no answered_by credits the operator', () => {
  const { byNode } = decisionsByNode({
    analysis: { decisions: [held({ attempt: 2 })] },
    checkpoint: { decisions: [approval({ attempt: 2 })] },
  });
  assert.deepEqual(byNode.analysis[0].approved, { by: 'operator' });
});

test('a held choice no approval matches gains nothing', () => {
  const { byNode } = decisionsByNode({
    analysis: { decisions: [held({ attempt: 2 }), held({ question_id: 'q-other', decision: 'q-other: x' })] },
    // Same question, another attempt; another node's same question.
    checkpoint: { decisions: [approval(), approval({ node: 'checkpoint', question_id: 'q-other' })] },
  });
  for (const decision of byNode.analysis) assert.equal(Object.hasOwn(decision, 'approved'), false);
  assert.equal(byNode.analysis[0].triage.held, true, 'the held mark stays as history');
});

test('with no classed choices the projection is unchanged: every decision is decisionOf of its entry', () => {
  const entries = ['keep the parser', { decision: 'd', by: 'run' }, { option: 'continue', answered_by: 'marek' }];
  const { text, byNode } = decisionsByNode({ analysis: { decisions: entries }, checkpoint: { decisions: [] } });
  assert.deepEqual(byNode.analysis, entries.map(entry => decisionOf(entry)).map(d =>
    d.option === 'continue' ? { ...d, decision: 'Continue' } : d));
  assert.equal(text.includes('"approved"'), false);
});
