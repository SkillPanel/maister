import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, scratch, verb } from '../helpers.mjs';

function planned(t) {
  const run = scratch(t, { fixture: 'plan' });
  run.plan = path.join(run.dir, 'implementation/implementation-plan.md');
  run.companion = path.join(run.dir, 'implementation/implementation-plan.html');
  return run;
}

function sync(run) {
  const result = verb(['sync-plan', `--plan=${run.plan}`]);
  return { ...result, report: JSON.parse(result.stdout) };
}

/** Every `data-<kind>="<id>" class="<kind> <mark>"` in the companion, as {id: mark}. */
function markers(run, kind) {
  const html = fs.readFileSync(run.companion, 'utf8');
  const pattern = new RegExp(`data-${kind}="([\\d.]+)" class="${kind} (todo|done)"`, 'g');
  return Object.fromEntries([...html.matchAll(pattern)].map(match => [match[1], match[2]]));
}

test('sets every marker to the plan\'s state, in both directions', t => {
  const run = planned(t);
  const { code, report } = sync(run);
  assert.equal(code, 0);
  assert.equal(report.written, true);
  assert.deepEqual(report.groups_done, ['1', '2']);
  assert.deepEqual(report.groups_todo, ['11']);
  assert.deepEqual(report.missing_groups, []);
  assert.deepEqual(report.missing_steps, []);

  // Group 11 was `done` in the companion and the plan says otherwise: a
  // projection sets it back, where a flip from todo to done never would.
  assert.deepEqual(markers(run, 'group'), { 1: 'done', 2: 'done', 11: 'todo' });
  assert.deepEqual(markers(run, 'step'), {
    '1.1': 'done', '1.2': 'done', '1.10': 'todo', '2.1': 'done', '2.2': 'done', '11.1': 'todo', '11.2': 'done',
  });
});

test('anchoring is exact: group 1 never touches group 11, step 1.1 never touches step 1.10', t => {
  const run = planned(t);
  sync(run);
  const html = fs.readFileSync(run.companion, 'utf8');
  assert.match(html, /data-step="1\.10" class="step todo">A step the plan has since renumbered/);
  assert.match(html, /data-group="11" class="group todo"/);
});

test('a marker whose class list carries other classes, in any order, is still set', t => {
  const run = planned(t);
  const html = fs.readFileSync(run.companion, 'utf8')
    .replace('data-group="1" class="group todo"', 'data-group="1" class="group todo card"')
    .replace('data-group="2" class="group todo"', 'class="card group todo" data-group="2"')
    .replace('data-step="1.1" class="step todo"', 'data-step="1.1" class="step todo row"');
  fs.writeFileSync(run.companion, html);
  const { report } = sync(run);
  assert.deepEqual(report.missing_groups, []);
  assert.deepEqual(report.missing_steps, []);
  const after = fs.readFileSync(run.companion, 'utf8');
  assert.match(after, /data-group="1" class="group done card"/);
  assert.match(after, /class="card group done" data-group="2"/);
  assert.match(after, /data-step="1\.1" class="step done row"/);
  assert.match(after, /data-group="11" class="group todo"/, 'group 11 is still set by its own id alone');
});

test('idempotent: a second sync writes nothing and changes no byte', t => {
  const run = planned(t);
  sync(run);
  const first = fs.readFileSync(run.companion, 'utf8');
  const again = sync(run);
  assert.equal(again.report.written, false);
  assert.equal(fs.readFileSync(run.companion, 'utf8'), first);
});

test('a reverted group reads as outstanding again', t => {
  const run = planned(t);
  sync(run);
  const plan = fs.readFileSync(run.plan, 'utf8').replace('- [x] 1.2 Implement the parser', '- [ ] 1.2 Implement the parser');
  fs.writeFileSync(run.plan, plan);
  const { report } = sync(run);
  assert.equal(report.written, true);
  assert.deepEqual(report.groups_todo, ['1', '11']);
  assert.equal(markers(run, 'group')[1], 'todo');
  assert.equal(markers(run, 'step')['1.2'], 'todo');
});

test('a plan group the companion has no marker for is reported, not refused', t => {
  const run = planned(t);
  fs.appendFileSync(run.plan, '\n### Task Group 3: Packaging\n\n- [x] 3.1 Package it\n');
  const { code, report } = sync(run);
  assert.equal(code, 0);
  assert.deepEqual(report.missing_groups, ['3']);
  assert.deepEqual(report.missing_steps, ['3.1']);
});

test('html_output: false in the run\'s state is a no-op that names its reason', t => {
  const run = planned(t);
  freeze(run, { orchestrator: { options: { html_output: false } } });
  const before = fs.readFileSync(run.companion, 'utf8');
  const { code, report } = sync(run);
  assert.equal(code, 0);
  assert.equal(report.skipped, 'html-output-off');
  assert.equal(report.written, false);
  assert.equal(fs.readFileSync(run.companion, 'utf8'), before);
});

test('no companion beside the plan is a no-op that names its reason', t => {
  const run = planned(t);
  fs.rmSync(run.companion);
  const { code, report } = sync(run);
  assert.equal(code, 0);
  assert.equal(report.skipped, 'no-companion');
  assert.equal(fs.existsSync(run.companion), false);
});

test('an unreadable plan is refused, exit 1', t => {
  const run = planned(t);
  run.plan = path.join(run.dir, 'implementation/no-such-plan.md');
  const result = verb(['sync-plan', `--plan=${run.plan}`]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).errors[0].code, 'plan-unreadable');
  assert.match(result.stderr, /^plan-unreadable: /);
});
