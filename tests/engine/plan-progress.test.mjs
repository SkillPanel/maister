import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { deriveProgress } from '../../plugins/maister/skills/workflow-engine/scripts/lib/dashboard.mjs';
import { freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// `wave-start` and `group-done`: the implementation phase's bookkeeping, one
// call per moment. Each test runs the verbs as subprocesses against a scratch
// run frozen from the sample definition, whose `implementation` node is the
// executor, so the dashboard's progress is the one the verbs re-project.

const PLAN = `# Implementation Plan

### Task Group 1: Parser

- [ ] 1.1 Write the parser tests
- [ ] 1.2 Implement the parser

### Task Group 2: Writer

- [ ] 2.1 Write the writer tests
- [~] 2.2 SKIPPED: no fixture for the Windows path yet
- [ ] 2.3 Implement the writer

### Task Group 3: Documentation

- [ ] 3.1 Document the parser

### Acceptance Criteria

- [ ] Not a step: a section that closes Task Group 3
`;

const LOG = `# Work Log

## 2026-01-05T09:00:00Z - Implementation Started

**Total Steps**: 6
`;

const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z';

/** A run with the plan and the work log above; frozen unless `standalone`. */
function planned(t, { standalone = false } = {}) {
  const run = scratch(t);
  if (!standalone) freeze(run);
  const dir = path.join(run.dir, 'implementation');
  fs.mkdirSync(dir, { recursive: true });
  run.plan = path.join(dir, 'implementation-plan.md');
  run.log = path.join(dir, 'work-log.md');
  run.entry = path.join(dir, '.work-log-entry.md');
  fs.writeFileSync(run.plan, PLAN);
  fs.writeFileSync(run.log, LOG);
  return run;
}

function waveStart(run, wave, groups) {
  const result = verb(['wave-start', `--plan=${run.plan}`, `--wave=${wave}`, `--groups=${groups}`]);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

function groupDone(run, groups, entry) {
  fs.writeFileSync(run.entry, entry);
  const result = verb(['group-done', `--plan=${run.plan}`, `--groups=${groups}`, `--entry-file=${run.entry}`]);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

const read = file => fs.readFileSync(file, 'utf8');
const progress = run => readDashboard(run).phases.find(phase => phase.id === 'implementation').progress;

test('wave-start: logs the start heading from the clock and re-projects the groups as running', t => {
  const run = planned(t);
  const { code, report, stderr } = waveStart(run, 1, '1,2');
  assert.equal(code, 0, stderr);
  assert.deepEqual(report, { ok: true, wave: 1, groups: [1, 2], logged: true, reprojected: true, errors: [] });
  assert.match(read(run.log), new RegExp(`\\n\\n## ${STAMP} - Wave 1 Started: Groups 1, 2\\n$`));
  assert.equal(progress(run).running_wave, 1);
  assert.deepEqual(progress(run).groups.map(group => group.state), ['running', 'running', 'to_run']);
});

test('wave-start: a repeated call appends nothing; a wave of one says Group', t => {
  const run = planned(t);
  waveStart(run, 1, '3');
  const once = read(run.log);
  assert.match(once, /Wave 1 Started: Group 3\n$/);
  const again = waveStart(run, 1, '3');
  assert.equal(again.code, 0);
  assert.equal(again.report.logged, false);
  assert.equal(read(run.log), once);
});

test('wave-start: a group the plan marks done, or does not carry, is refused and nothing is written', t => {
  const run = planned(t);
  fs.writeFileSync(run.plan, PLAN.replace('- [ ] 3.1', '- [x] 3.1'));
  const done = waveStart(run, 1, '3');
  assert.equal(done.code, 1);
  assert.match(done.stderr, /^wave-start-group-done: /m);
  const unknown = waveStart(run, 1, '4');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /^wave-start-unknown-group: .*Group 4/m);
  assert.equal(read(run.log), LOG);
});

test('group-done: marks the group, logs its entry under its wave, syncs and re-projects in one call', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  const before = readState(run).orchestrator.updated;
  const { code, report, stderr } = groupDone(run, '1', '**Steps**: 1.1 through 1.2 completed\n**Tests**: 4 passed\n');
  assert.equal(code, 0, stderr);
  assert.deepEqual(report.groups, [{ group: 1, wave: 1, marked: 2, logged: true }]);
  assert.deepEqual(report.sync, { ok: true, skipped: 'no-companion' });
  assert.equal(report.reprojected, true);
  assert.match(read(run.plan), /- \[x\] 1\.1 Write the parser tests\n- \[x\] 1\.2/);
  assert.match(read(run.plan), /- \[ \] 2\.1/, 'another group is left as it was');
  assert.match(read(run.log), new RegExp(`\\n## ${STAMP} - Group 1 Complete \\(wave 1\\)\\n\\n\\*\\*Steps\\*\\*: 1\\.1 through 1\\.2 completed\\n\\*\\*Tests\\*\\*: 4 passed\\n$`));
  assert.equal(fs.existsSync(run.entry), false, 'the entry file is consumed once the entry is in the log');
  assert.deepEqual(progress(run).groups.map(group => group.state), ['done', 'to_run', 'to_run']);
  assert.equal(progress(run).current_wave, 1);
  assert.ok(readState(run).orchestrator.updated >= before, 'the re-projection is a state write');
});

test('group-done: a repeated call is idempotent — the plan and the log keep their bytes', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  groupDone(run, '1', 'Done.');
  const plan = read(run.plan);
  const log = read(run.log);
  const again = groupDone(run, '1', 'Done.');
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(again.report.groups, [{ group: 1, wave: 1, marked: 0, logged: false }]);
  assert.equal(read(run.plan), plan);
  assert.equal(read(run.log), log);
});

test('group-done: keeps a skipped step skipped and marks only the open ones', t => {
  const run = planned(t);
  waveStart(run, 1, '2');
  const { report } = groupDone(run, '2', 'Done.');
  assert.equal(report.groups[0].marked, 2);
  assert.match(read(run.plan), /- \[x\] 2\.1 .*\n- \[~\] 2\.2 SKIPPED: .*\n- \[x\] 2\.3/);
  assert.deepEqual(progress(run).groups.map(group => group.state), ['to_run', 'skipped', 'to_run']);
});

test('group-done: a plan section that is not a group keeps its boxes', t => {
  const run = planned(t);
  waveStart(run, 1, '3');
  groupDone(run, '3', 'Done.');
  assert.match(read(run.plan), /- \[ \] Not a step/);
});

test('group-done: several groups of one wave, returned one at a time, leave the siblings running', t => {
  const run = planned(t);
  waveStart(run, 1, '1,3');
  const first = groupDone(run, '1', 'Group 1 notes.');
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(progress(run).groups.map(group => group.state), ['done', 'to_run', 'running']);
  assert.equal(progress(run).running_wave, 1);
  groupDone(run, '3', 'Group 3 notes.');
  assert.deepEqual(progress(run).groups.map(group => group.state), ['done', 'to_run', 'done']);
  assert.equal(progress(run).running_wave, null);
});

test('group-done: several groups of one wave in one call, each under its own heading', t => {
  const run = planned(t);
  waveStart(run, 2, '1,3');
  const { code, report, stderr } = groupDone(run, '3,1', '## Group 1\n**Tests**: 4 passed\n\n## Group 3\n**Tests**: 1 passed\n');
  assert.equal(code, 0, stderr);
  assert.deepEqual(report.groups.map(group => [group.group, group.wave, group.logged]), [[3, 2, true], [1, 2, true]]);
  const log = read(run.log);
  assert.match(log, /Group 3 Complete \(wave 2\)\n\n\*\*Tests\*\*: 1 passed\n/);
  assert.match(log, /Group 1 Complete \(wave 2\)\n\n\*\*Tests\*\*: 4 passed\n/);
  assert.equal(progress(run).groups_done, 2);
  assert.equal(progress(run).current_wave, 2);
});

test('group-done: a group sent back and run again in a later wave is logged again under that wave', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  groupDone(run, '1', 'First attempt.');
  fs.writeFileSync(run.plan, read(run.plan).replace(/- \[x\] 1\./g, '- [ ] 1.'));
  fs.appendFileSync(run.log, '\n## 2026-01-05T10:00:00Z - Group 1 Reverted (wave 1): the parser broke the build\n');
  waveStart(run, 2, '1');
  const again = groupDone(run, '1', 'Second attempt.');
  assert.deepEqual(again.report.groups, [{ group: 1, wave: 2, marked: 2, logged: true }]);
  assert.match(read(run.log), /Group 1 Complete \(wave 2\)\n\nSecond attempt\.\n$/);
});

test('group-done: refusals write nothing — unknown group, no wave start, entry that does not match', t => {
  const run = planned(t);
  const noWave = groupDone(run, '1', 'Done.');
  assert.equal(noWave.code, 1);
  assert.match(noWave.stderr, /^group-done-no-wave: .*Group 1/m);
  assert.ok(fs.existsSync(run.entry), 'a refusal keeps the entry file');

  waveStart(run, 1, '1,3');
  const plan = read(run.plan);
  const log = read(run.log);
  const cases = [
    ['4', 'Done.', /^group-done-unknown-group: /m],
    ['1,3', 'One body for two groups.', /^group-done-entry-invalid: .*give each group its own part/m],
    ['1', '## Group 3\nWrong group.', /^group-done-entry-invalid: .*same groups/m],
    ['1', '## 2026-01-05T09:00:00Z - Group 1 Complete (wave 1)\nA heading of its own.', /^group-done-entry-invalid: .*heading/m],
    ['1', '   \n', /^group-done-entry-invalid: the entry is empty/m],
  ];
  for (const [groups, entry, pattern] of cases) {
    const result = groupDone(run, groups, entry);
    assert.equal(result.code, 1, entry);
    assert.match(result.stderr, pattern);
  }
  assert.equal(read(run.plan), plan);
  assert.equal(read(run.log), log);
});

test('group-done: the entry file is read from one place only', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  const elsewhere = path.join(run.dir, 'entry.md');
  fs.writeFileSync(elsewhere, 'Done.');
  const result = verb(['group-done', `--plan=${run.plan}`, '--groups=1', `--entry-file=${elsewhere}`]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /the entry file must be .*\.work-log-entry\.md/);
});

test('group-done: a log that cannot be written leaves the plan marked, says so, and the same call finishes it', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  const state = read(run.state);
  // The temp twin taken by a directory: the plan's write lands, the log's cannot.
  const blocker = `${run.log}.tmp`;
  fs.mkdirSync(blocker);
  const failed = groupDone(run, '1', 'Done.');
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /^group-done-log-unwritable: .*checkboxes for Group 1 are marked.*Run the same call again/m);
  assert.match(read(run.plan), /- \[x\] 1\.1/);
  assert.doesNotMatch(read(run.log), /Group 1 Complete/);
  assert.ok(fs.existsSync(run.entry), 'the entry file is kept for the re-run');
  assert.equal(read(run.state), state, 'a refused call writes no state');
  assert.equal(verb(['resume-check', `--state=${run.state}`]).code, 0, 'the run still resumes');

  fs.rmdirSync(blocker);
  const again = verb(['group-done', `--plan=${run.plan}`, '--groups=1', `--entry-file=${run.entry}`]);
  assert.equal(again.code, 0, again.stderr);
  assert.equal((read(run.log).match(/Group 1 Complete \(wave 1\)/g) ?? []).length, 1);
  assert.equal(progress(run).groups_done, 1);
});

test('group-done: a refused re-projection is a warning in the output and in the log, never a refusal', t => {
  const run = planned(t);
  waveStart(run, 1, '1');
  fs.writeFileSync(`${run.state}.tmp`, 'held by another writer\n');
  const { code, report, stderr } = groupDone(run, '1', 'Done.');
  assert.equal(code, 0);
  assert.equal(report.reprojected, false);
  assert.match(stderr, /^warning: reprojection-refused: state-temp-exists after Group 1;/m);
  assert.match(read(run.log), /Dashboard re-projection failed after Group 1\.\n$/);
  fs.rmSync(`${run.state}.tmp`);
});

test('group-done and wave-start: a standalone plan has nothing to re-project', t => {
  const run = planned(t, { standalone: true });
  assert.equal(waveStart(run, 1, '1').report.reprojected, 'no-run');
  const { code, report } = groupDone(run, '1', 'Done.');
  assert.equal(code, 0);
  assert.equal(report.reprojected, 'no-run');
  assert.equal(fs.existsSync(run.state), false);
});

test('group-done: the companion is synced in the same call, and a missing marker is logged', t => {
  const run = planned(t);
  fs.writeFileSync(path.join(path.dirname(run.plan), 'implementation-plan.html'),
    '<section data-group="1" class="group todo"><li data-step="1.1" class="step todo"></li><li data-step="1.2" class="step todo"></li></section>\n');
  waveStart(run, 1, '1,2');
  const one = groupDone(run, '1', 'Done.');
  assert.deepEqual(one.report.sync, { ok: true, written: true, missing_groups: ['2', '3'] });
  assert.match(read(path.join(path.dirname(run.plan), 'implementation-plan.html')), /data-group="1" class="group done"/);
  assert.match(one.stderr, /^warning: plan-sync-missed: .*Group 2, 3/m);
  assert.doesNotMatch(read(run.log), /HTML plan sync missed markers for Group 1/);
  const two = groupDone(run, '2', 'Done.');
  assert.equal(two.code, 0);
  assert.match(read(run.log), /Group 2 Complete \(wave 1\)\n\nDone\.\n\nHTML plan sync missed markers for Group 2\.\n$/);
});

test('resume: the verbs leave the state a hand-kept log and an empty write leave', t => {
  // The same moments, kept two ways: by the verbs, and by hand — the plan
  // ticked, the headings typed, an empty write sent — as the executor did
  // before. Resume reads the state and derives progress from the plan and the
  // log, so the two must agree on all three, the clock fields aside.
  const verbs = planned(t);
  waveStart(verbs, 1, '1,3');
  groupDone(verbs, '1', 'Done.');

  const hand = planned(t);
  fs.appendFileSync(hand.log, '\n## 2026-01-05T09:10:00Z - Wave 1 Started: Groups 1, 3\n');
  write(hand, {});
  fs.writeFileSync(hand.plan, read(hand.plan).replace(/- \[ \] 1\./g, '- [x] 1.'));
  fs.appendFileSync(hand.log, '\n## 2026-01-05T09:20:00Z - Group 1 Complete (wave 1)\n\nDone.\n');
  write(hand, {});

  const unclocked = run => {
    const doc = readState(run);
    delete doc.orchestrator.updated;
    delete doc.orchestrator.created;
    for (const node of Object.values(doc.workflow.nodes)) {
      delete node.started;
      delete node.completed;
    }
    return doc;
  };
  assert.deepEqual(unclocked(verbs), unclocked(hand));
  const check = run => JSON.parse(verb(['resume-check', `--state=${run.state}`]).stdout);
  assert.deepEqual({ ...check(verbs), root: null, dashboard: null, task_path: null }, { ...check(hand), root: null, dashboard: null, task_path: null });
  assert.deepEqual(deriveProgress(read(verbs.plan), read(verbs.log)), deriveProgress(read(hand.plan), read(hand.log)));
  assert.deepEqual(progress(verbs), progress(hand));
});
