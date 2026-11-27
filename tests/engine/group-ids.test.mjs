import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { deriveProgress } from '../../plugins/maister/skills/workflow-engine/scripts/lib/dashboard.mjs';
import { FIXTURES, freeze, freezePatch, readDashboard, scratch, scratchTree, verb, write } from '../helpers.mjs';

// Task groups whose ids are not whole numbers — `2b.1`, `M.1` — read by every
// verb that reads a plan or a `--groups` value: wave-start, group-done,
// sync-plan, the dashboard's progress and the runner's back-test. A plan of
// whole numbers reads exactly as it did before ids were widened; the golden
// file holds what the digits-only readers produced for one.

const PLAN = `# Implementation Plan

### Task Group 2b.1: Parser
**Dependencies:** None

- [ ] 2b.1.0 Complete the parser layer
  - [ ] 2b.1.1 Write the parser tests
  - [ ] 2b.1.2 Implement the parser

### Task Group M.1: Migration
**Dependencies:** 2b.1

- [ ] M.1.1 Write the migration
- [~] M.1.2 SKIPPED: no legacy data to move

### Task Group 10: Documentation

- [ ] 10.1 Document the parser

### Acceptance Criteria

- [ ] Not a step: a section that closes Task Group 10
`;

const LOG = `# Work Log

## 2026-01-05T09:00:00Z - Implementation Started
`;

const COMPANION = `<html><body>
<section data-group="2b.1" class="group todo"><ul>
<li data-step="2b.1.1" class="step todo">a</li><li data-step="2b.1.2" class="step todo">b</li></ul></section>
<section data-group="M.1" class="group todo"><ul>
<li data-step="M.1.1" class="step todo">a</li><li data-step="M.1.2" class="step todo">b</li></ul></section>
<section data-group="10" class="group todo"><ul>
<li data-step="10.1" class="step todo">a</li></ul></section>
</body></html>
`;

const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z';
const read = file => fs.readFileSync(file, 'utf8');

/** A frozen run holding `plan`, the work log and the companion beside it. */
function planned(t, plan = PLAN) {
  const run = scratch(t);
  freeze(run);
  return placed(run, path.join(run.dir, 'implementation'), plan);
}

function placed(run, dir, plan) {
  fs.mkdirSync(dir, { recursive: true });
  run.plan = path.join(dir, 'implementation-plan.md');
  run.log = path.join(dir, 'work-log.md');
  run.entry = path.join(dir, '.work-log-entry.md');
  run.html = path.join(dir, 'implementation-plan.html');
  fs.writeFileSync(run.plan, plan);
  fs.writeFileSync(run.log, LOG);
  fs.writeFileSync(run.html, COMPANION);
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

function syncPlan(run) {
  const result = verb(['sync-plan', `--plan=${run.plan}`]);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

const progress = run => readDashboard(run).phases.find(phase => phase.id === 'implementation').progress;
const states = run => progress(run).groups.map(({ group, state }) => [group, state]);

// ---------------------------------------------------------------------------
// a plan mixing 2b.1, M.1 and 10
// ---------------------------------------------------------------------------

test('a plan of 2b.1, M.1 and 10 goes through wave-start, group-done and sync-plan, in plan order', t => {
  const run = planned(t);
  assert.equal(waveStart(run, 0, '10').code, 2, 'a wave is still a whole number');

  const first = waveStart(run, 1, '2b.1,M.1');
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.report, { ok: true, wave: 1, groups: ['2b.1', 'M.1'], logged: true, reprojected: true, errors: [] });
  assert.match(read(run.log), new RegExp(`\\n## ${STAMP} - Wave 1 Started: Groups 2b\\.1, M\\.1\\n$`));
  assert.deepEqual(states(run), [['2b.1', 'running'], ['M.1', 'running'], [10, 'to_run']]);
  assert.equal(progress(run).running_wave, 1);
  assert.deepEqual(progress(run).skipped, ['Group M.1 — no legacy data to move']);
  assert.equal(waveStart(run, 1, 'M.1,2b.1').report.logged, false, 'the same wave and groups append nothing');

  const done = groupDone(run, '2b.1,M.1', '## Group 2b.1\nParser done.\n\n## Group M.1\nMigration done.\n');
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(done.report.groups, [
    { group: '2b.1', wave: 1, marked: 3, logged: true },
    { group: 'M.1', wave: 1, marked: 1, logged: true },
  ]);
  assert.deepEqual(done.report.sync, { ok: true, written: true, missing_groups: [] });
  assert.match(read(run.log), new RegExp(`## ${STAMP} - Group 2b\\.1 Complete \\(wave 1\\)\\n\\nParser done\\.\\n\\n## ${STAMP} - Group M\\.1 Complete \\(wave 1\\)\\n\\nMigration done\\.\\n$`));
  assert.match(read(run.plan), /- \[x\] 2b\.1\.0[^]*- \[x\] 2b\.1\.2[^]*- \[x\] M\.1\.1 Write the migration\n- \[~\] M\.1\.2 SKIPPED/);
  assert.deepEqual(states(run), [['2b.1', 'done'], ['M.1', 'skipped'], [10, 'to_run']]);
  assert.equal(progress(run).groups_done, 2);
  assert.equal(groupDone(run, 'M.1', 'Again.').report.groups[0].logged, false, 'an entry already logged under its wave is not appended again');

  assert.equal(waveStart(run, 2, '10').code, 0);
  assert.deepEqual(states(run), [['2b.1', 'done'], ['M.1', 'skipped'], [10, 'running']]);
  assert.equal(groupDone(run, '10', 'Docs done.').code, 0);
  assert.deepEqual(states(run), [['2b.1', 'done'], ['M.1', 'skipped'], [10, 'done']]);
  assert.equal(progress(run).groups_done, 3);

  const sync = syncPlan(run);
  assert.equal(sync.code, 0, sync.stderr);
  assert.deepEqual(sync.report.groups_done, ['2b.1', 'M.1', '10']);
  assert.deepEqual(sync.report.missing_steps, [], 'a 2b.1.0 group checkbox is the group marker, never a missing step');
  const html = read(run.html);
  for (const marker of ['data-group="2b.1" class="group done"', 'data-step="2b.1.2" class="step done"', 'data-group="M.1" class="group done"', 'data-step="M.1.2" class="step done"', 'data-step="10.1" class="step done"']) {
    assert.ok(html.includes(marker), marker);
  }
});

test('the dashboard reads a reverted 2b.1 and a running M.1 from the work log', () => {
  const log = `${LOG}
## 2026-01-05T10:00:00Z - Wave 1 Started: Groups 2b.1, M.1

## 2026-01-05T10:30:00Z - Group 2b.1 Reverted (wave 1): the parser broke the build

## 2026-01-05T10:40:00Z - Wave 2 Started: Group M.1
`;
  const derived = deriveProgress(PLAN, log);
  assert.deepEqual(derived.groups, [{ group: '2b.1', state: 'reverted' }, { group: 'M.1', state: 'running' }, { group: 10, state: 'to_run' }]);
  assert.deepEqual(derived.reverted, ['Group 2b.1 — the parser broke the build']);
  assert.equal(derived.current_wave, 1);
  assert.equal(derived.running_wave, 2);
});

// ---------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------

const DUPLICATES = [
  ['the same id twice', '### Task Group M.1: Migration', '### Task Group M.1: Rollback', /"M\.1" and "M\.1"/],
  ['ids that differ only in case', '### Task Group M.1: Migration', '### Task Group m.1: Rollback', /"M\.1" and "m\.1"/],
  ['ids that differ in a dot for a hyphen', '### Task Group 2b.1: Parser', '### Task Group 2b-1: Lexer', /"2b\.1" and "2b-1"/],
];

for (const [name, kept, added, named] of DUPLICATES) {
  test(`two headings naming one group — ${name} — are refused by every verb, and nothing is written`, t => {
    const plan = PLAN.replace('### Task Group 10: Documentation', `${added}\n\n- [ ] 9.1 Something\n\n### Task Group 10: Documentation`);
    assert.ok(plan.includes(kept));
    const run = planned(t, plan);
    const before = { plan: read(run.plan), log: read(run.log), html: read(run.html) };

    const started = waveStart(run, 1, '10');
    assert.equal(started.code, 1);
    assert.match(started.stderr, /^wave-start-duplicate-group: .*more than one "### Task Group <id>:" heading/m);
    assert.match(started.stderr, named);

    fs.appendFileSync(run.log, '\n## 2026-01-05T10:00:00Z - Wave 1 Started: Group 10\n');
    before.log = read(run.log);
    const done = groupDone(run, '10', 'Done.');
    assert.equal(done.code, 1);
    assert.match(done.stderr, /^group-done-duplicate-group: /m);
    assert.match(done.stderr, named);

    const sync = syncPlan(run);
    assert.equal(sync.code, 1);
    assert.match(sync.stderr, /^plan-duplicate-group: /m);
    assert.match(sync.stderr, named);

    assert.equal(deriveProgress(plan, ''), null, 'the dashboard shows no count rather than a merged one');
    assert.deepEqual({ plan: read(run.plan), log: read(run.log), html: read(run.html) }, before);
  });
}

test('a --groups value outside the grammar is a usage error that states the grammar', t => {
  const run = planned(t);
  for (const groups of ['', '2b.', '-a', 'M.1,,10', 'a_b', 'a/b', '.1']) {
    const result = waveStart(run, 1, groups);
    assert.equal(result.code, 2, groups);
    assert.match(result.stderr, /wave-start needs --groups, the group ids separated by commas, each id letters, digits, dots and hyphens, starting and ending with a letter or digit \(3, 2b\.1, M\.1\)/);
    assert.equal(groupDone(run, groups, 'Done.').code, 2, groups);
  }
  assert.equal(read(run.log), LOG);
});

test('an id the plan does not have is refused by its id, matched exactly as written', t => {
  const run = planned(t);
  for (const groups of ['M.2', 'm.1', '2B.1']) {
    const unknown = waveStart(run, 1, groups);
    assert.equal(unknown.code, 1, groups);
    assert.match(unknown.stderr, new RegExp(`^wave-start-unknown-group: .*no "### Task Group <id>:" section for Group ${groups.replace('.', '\\.')}\\. .*by the id its heading carries`, 'm'));
  }
  assert.equal(waveStart(run, 1, 'M.1').code, 0);
  assert.match(groupDone(run, 'M.2', 'Done.').stderr, /^group-done-unknown-group: .*Group M\.2/m);
  assert.equal(read(run.plan), PLAN);
});

// ---------------------------------------------------------------------------
// the runner's back-test
// ---------------------------------------------------------------------------

test('an implementer recorded as group-m-1 is back once the work log records Group M.1', t => {
  const run = scratch(t);
  const env = { CLAUDE_CODE_SESSION_ID: 'session-live' };
  assert.equal(verb(['write-state', `--state=${run.state}`, '--host=claude'], freezePatch({}).patch).code, 0);
  write(run, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'running' } } });
  placed(run, path.join(run.dir, 'implementation'), PLAN);
  assert.equal(waveStart(run, 1, '2b.1,M.1').code, 0);
  const common = [`--state=${run.state}`, '--node=implementation', '--runner=implementation'];
  const recorded = verb(['in-flight', ...common, '--record=group-2b-1:implementation/group-reports/group-2b-1.md,group-m-1:implementation/group-reports/group-m-1.md'], undefined, env);
  assert.equal(recorded.code, 0, recorded.stderr);
  const file = path.join(run.dir, 'implementation', 'in-flight.json');
  const doc = JSON.parse(read(file));
  for (const entry of Object.values(doc.agents)) entry.dispatched = '2026-01-05T09:00:01Z';
  fs.writeFileSync(file, JSON.stringify(doc));

  assert.equal(groupDone(run, 'M.1', 'Migration done.').code, 0);
  const step = verb(['runner-step', ...common], undefined, env);
  assert.equal(step.code, 0, step.stderr);
  assert.deepEqual(JSON.parse(step.stdout).pending.map(each => each.id), ['group-2b-1']);
});

// ---------------------------------------------------------------------------
// a plan of whole numbers reads exactly as before
// ---------------------------------------------------------------------------

const WHOLE_PLAN = `# Implementation Plan

### Task Group 1: Parser
**Dependencies:** None

- [ ] 1.0 Complete the parser layer
  - [ ] 1.1 Write the parser tests
  - [ ] 1.2 Implement the parser

### Task Group 2: Writer
**Dependencies:** 1

- [ ] 2.0 Complete the writer layer
  - [ ] 2.1 Write the writer tests
  - [~] 2.2 SKIPPED: no fixture for the Windows path yet
  - [ ] 2.3 Implement the writer

### Task Group 10: Documentation

- [ ] 10.1 Document the parser
- [ ] 10.2 Document the writer

### Acceptance Criteria

- [ ] Not a step: a section that closes Task Group 10
`;
const WHOLE_LOG = `# Work Log

## 2026-01-05T09:00:00Z - Implementation Started

**Total Steps**: 8
`;
const WHOLE_HTML = `<html><body>
<section data-group="1" class="group todo"><ul>
<li data-step="1.1" class="step todo">a</li><li data-step="1.2" class="step todo">b</li></ul></section>
<section data-group="2" class="group todo card"><ul>
<li data-step="2.1" class="step todo">a</li><li data-step="2.2" class="todo step">b</li><li data-step="2.3" class="step todo">c</li></ul></section>
<section class="group todo" data-group="10"><ul>
<li data-step="10.1" class="step todo">a</li><li data-step="10.2" class="step todo">b</li></ul></section>
</body></html>
`;

/**
 * Every output of one pass over a whole-number plan, a standalone run (no
 * state beside it): each verb's exit code, stdout and stderr with the folder
 * masked, the dashboard's progress at each step, and the files at the end.
 */
function wholeNumberPass(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const plan = path.join(dir, 'implementation-plan.md');
  const log = path.join(dir, 'work-log.md');
  const entry = path.join(dir, '.work-log-entry.md');
  const html = path.join(dir, 'implementation-plan.html');
  fs.writeFileSync(plan, WHOLE_PLAN); fs.writeFileSync(log, WHOLE_LOG); fs.writeFileSync(html, WHOLE_HTML);
  const out = [];
  const local = text => text.split(JSON.stringify(dir).slice(1, -1)).join('<dir>').split(dir).join('<dir>').replace(/<dir>(?:\\\\|\\)/g, '<dir>/');
  const call = args => { const r = verb(args); out.push({ args: args.filter(a => !a.startsWith('--plan') && !a.startsWith('--entry')), code: r.code, stdout: local(r.stdout), stderr: local(r.stderr) }); };
  const progress = () => out.push({ progress: deriveProgress(fs.readFileSync(plan, 'utf8'), fs.readFileSync(log, 'utf8')) });
  const mask = text => text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, '<stamp>');
  progress();
  call(['wave-start', `--plan=${plan}`, '--wave=1', '--groups=1']);
  progress();
  fs.writeFileSync(entry, '**Steps**: 1.1 through 1.2 completed\n');
  call(['group-done', `--plan=${plan}`, '--groups=1', `--entry-file=${entry}`]);
  call(['wave-start', `--plan=${plan}`, '--wave=2', '--groups=2,10']);
  call(['wave-start', `--plan=${plan}`, '--wave=2', '--groups=10,2']);
  progress();
  fs.writeFileSync(entry, '## Group 2\nWriter done.\n## Group 10\nDocs done.\n');
  call(['group-done', `--plan=${plan}`, '--groups=2,10', `--entry-file=${entry}`]);
  fs.writeFileSync(entry, 'Again.\n');
  call(['group-done', `--plan=${plan}`, '--groups=1', `--entry-file=${entry}`]);
  call(['sync-plan', `--plan=${plan}`]);
  progress();
  fs.appendFileSync(log, '\n## 2026-01-05T12:00:00Z - Group 10 Reverted (wave 2): docs build broke\n\n## 2026-01-05T12:05:00Z - Wave 3 Started: Groups 10 and 99 (retry)\n');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [x] 10.1', '- [ ] 10.1'));
  progress();
  call(['sync-plan', `--plan=${plan}`]);
  out.push({ plan: fs.readFileSync(plan, 'utf8'), log: mask(fs.readFileSync(log, 'utf8')), html: fs.readFileSync(html, 'utf8') });
  return out;
}

test('a plan of whole numbers produces byte-identical output to the digits-only readers', t => {
  const root = scratchTree(t);
  const outputs = `${JSON.stringify(wholeNumberPass(path.join(root, 'implementation')), null, 2)}`;
  assert.equal(outputs, read(path.join(FIXTURES, 'group-ids', 'whole-number-outputs.json')));
});
