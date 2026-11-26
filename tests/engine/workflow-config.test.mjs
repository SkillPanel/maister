import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freezePatch, readState, scratch, verb, walkTo } from '../helpers.mjs';

// The `workflows:` block of a project's config.yml: per workflow, the HTML
// pages its steps write (`html_companions`, the last layer over the
// definition, its overlays and the profile) and the gates it continues
// without asking (`auto_continue`, in auto-continue.test.mjs). Judged against
// the folded graph at the freeze and recorded in
// orchestrator.options.workflow_config, so a resumed run keeps what it
// started with; `validate` (`--check`) reports each bad entry with its file
// and dotted key.

const DEFINITION = path.join(FIXTURES, 'definitions', 'config-workflow.yml');
const NOTE = "note: ignored the supplied orchestrator.options.workflow_config; the freeze records it from the workflows block of the project's config.yml, so no patch sets it\n";

function config(run, text) {
  const file = path.join(run.root, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function frozen(t, text = null, { inputs = { publish: false } } = {}) {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  if (text !== null) config(run, text);
  const { patch } = freezePatch({ definition: DEFINITION, orchestrator: { options: { inputs, html_output: true } } });
  const result = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
  return { run, result };
}

function put(dir, relative) {
  const file = path.join(dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Page\n');
}

const recorded = run => readState(run).orchestrator.options?.workflow_config;
const configWarnings = stderr => stderr.split('\n').filter(line => line.startsWith('warning: workflows-config:')).map(line => line.slice('warning: '.length));
const missing = stdout => stdout.split('\n').filter(line => line.startsWith('companion-missing: '));

/** Complete spec and plan with every markdown file on disk and no page beside it. */
function completePlan(run) {
  put(run.dir, 'implementation/spec.md');
  put(run.dir, 'implementation/spec.html');
  put(run.dir, 'implementation/implementation-plan.md');
  put(run.dir, 'implementation/notes.md');
  walkTo(run, ['plan']);
  return verb(['write-state', `--state=${run.state}`], { nodes: { plan: { status: 'completed' } } });
}

test('a project with no workflows block freezes exactly the keys it always did', t => {
  const { run, result } = frozen(t, 'html_output: true\n');
  assert.equal(result.stderr, '');
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /workflow_config/);
  assert.deepEqual(missing(completePlan(run).stdout), ['companion-missing: plan implementation/implementation-plan.html']);
});

test('the freeze records the entry for its workflow, and drops each bad entry with a warning naming file and key', t => {
  const { run, result } = frozen(t, [
    'html_output: true',
    'subagents:',
    '  workflows:',
    '    config-workflow: {}',
    'workflows:',
    '  config-workflow:',
    '    html_companions:',
    '      plan: []',
    '      ghost: [report]',
    '    auto_continue: [plan-approval, plan-approval-publish]',
    '  other-workflow:',
    '    auto_continue: [x]',
    '',
  ].join('\n'));
  assert.deepEqual(recorded(run), { html_companions: { plan: [] }, auto_continue: ['plan-approval'] });
  // Only its own workflow's entry is judged at the freeze; another name is `--check`'s to report.
  assert.deepEqual(configWarnings(result.stderr), [
    'workflows-config:.maister/config.yml:workflows.config-workflow.html_companions.ghost — config-workflow has no step ghost; the entry is ignored',
    "workflows-config:.maister/config.yml:workflows.config-workflow.auto_continue.1 — plan-approval-publish's continue grants push, pr-create; the project's config never grants a permission, so the gate is asked as usual",
  ]);
});

test('a step turned off owes no page: the write, run-context and run-complete all agree', t => {
  const { run } = frozen(t, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: []\n');
  assert.deepEqual(missing(completePlan(run).stdout), []);
  const context = verb(['run-context', `--state=${run.state}`, '--node=plan']);
  assert.equal(context.code, 0, context.stderr);
  assert.match(context.stdout, /^companions: none$/m);
  // The step it leaves alone still owes its page.
  const spec = verb(['run-context', `--state=${run.state}`, '--node=spec']);
  assert.match(spec.stdout, /implementation\/spec\.html/);
});

test("a step's list replaces the definition's whole", t => {
  const { run } = frozen(t, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: [notes]\n');
  assert.deepEqual(recorded(run), { html_companions: { plan: ['notes'] } });
  assert.deepEqual(missing(completePlan(run).stdout), ['companion-missing: plan implementation/notes.html']);
});

test('a list whose every key is unknown turns nothing off; only a list written empty does', t => {
  const { run, result } = frozen(t, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: [nope]\n');
  assert.equal(recorded(run), undefined);
  assert.deepEqual(configWarnings(result.stderr), [
    'workflows-config:.maister/config.yml:workflows.config-workflow.html_companions.plan.0 — plan declares no artifact nope; it is ignored',
  ]);
  assert.deepEqual(missing(completePlan(run).stdout), ['companion-missing: plan implementation/implementation-plan.html']);
});

test('a resumed run keeps the config it started with, whatever the file says now', t => {
  const { run } = frozen(t, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: []\n    auto_continue: [plan-approval]\n');
  config(run, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: [plan, notes]\n');
  const resumed = verb(['resume-check', `--state=${run.state}`], undefined, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.deepEqual(recorded(run), { html_companions: { plan: [] }, auto_continue: ['plan-approval'] });
  assert.deepEqual(missing(completePlan(run).stdout), []);
});

test('a patch never sets options.workflow_config, at the freeze or after it', t => {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  const { patch } = freezePatch({ definition: DEFINITION, orchestrator: { options: { inputs: { publish: false }, workflow_config: { auto_continue: ['plan-approval'] } } } });
  const frozenWrite = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(frozenWrite.code, 0, frozenWrite.stderr);
  assert.equal(frozenWrite.stderr, NOTE);
  assert.equal(recorded(run), undefined);
  const later = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { workflow_config: { auto_continue: ['plan-approval'] } } } });
  assert.equal(later.code, 0, later.stderr);
  assert.equal(later.stderr, NOTE);
  assert.equal(recorded(run), undefined);
});

test('a config.yml with CRLF line ends is read the same', t => {
  const { run } = frozen(t, 'html_output: true\r\nworkflows:\r\n  config-workflow:\r\n    html_companions:\r\n      plan: []\r\n');
  assert.deepEqual(recorded(run), { html_companions: { plan: [] } });
});

test('validate (--check) reports each bad entry with its file and dotted key, and starts nothing', t => {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  config(run, [
    'workflows:',
    '  config-workflow:',
    '    html_companions:',
    '      plan: [plan, plan]',
    '      ghost: []',
    '    auto_continue: [plan-approval-publish, nonesuch, route, build]',
    '    approve: yes',
    '  nonesuch-workflow:',
    '    auto_continue: [x]',
    '  development:',
    '    auto_continue: [planning-approval]',
    '',
  ].join('\n'));
  const result = verb(['validate', `--definition=${DEFINITION}`], undefined, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  const at = '.maister/config.yml';
  assert.deepEqual(report.warnings.filter(each => each.startsWith('workflows-config:')), [
    `workflows-config:${at}:workflows.nonesuch-workflow — no workflow named nonesuch-workflow; the entry is ignored`,
    `workflows-config:${at}:workflows.config-workflow.approve — not a key here, so it is ignored; the accepted keys are html_companions, explainers, auto_continue`,
    `workflows-config:${at}:workflows.config-workflow.html_companions.plan — a list of the step's artifact keys, none twice, is expected, not a list; the entry is ignored`,
    `workflows-config:${at}:workflows.config-workflow.html_companions.ghost — config-workflow has no step ghost; the entry is ignored`,
    `workflows-config:${at}:workflows.config-workflow.auto_continue.0 — plan-approval-publish's continue grants push, pr-create; the project's config never grants a permission, so the gate is asked as usual`,
    `workflows-config:${at}:workflows.config-workflow.auto_continue.1 — config-workflow has no gate nonesuch; the entry is ignored`,
    `workflows-config:${at}:workflows.config-workflow.auto_continue.2 — route has more than one continue, or a continue that sets a value; only a gate with one plain continue may be listed, so the gate is asked as usual`,
    `workflows-config:${at}:workflows.config-workflow.auto_continue.3 — build is a step, not a gate; only a gate may be listed, so the entry is ignored`,
  ]);
  assert.equal(fs.existsSync(run.state), false);
});

test('validate reports a workflows block that is not a mapping, or that the reader refuses', t => {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  config(run, 'workflows: [development]\n');
  const listed = JSON.parse(verb(['validate', `--definition=${DEFINITION}`], undefined, { CLAUDE_PROJECT_DIR: run.root }).stdout);
  assert.deepEqual(listed.warnings.filter(each => each.startsWith('workflows-config:')), [
    'workflows-config:.maister/config.yml:workflows — a mapping of workflow name to its settings is expected, not a list; it is ignored',
  ]);
  config(run, 'workflows:\n  config-workflow:\n    auto_continue: plan-approval\n');
  const scalar = JSON.parse(verb(['validate', `--definition=${DEFINITION}`], undefined, { CLAUDE_PROJECT_DIR: run.root }).stdout);
  assert.deepEqual(scalar.warnings.filter(each => each.startsWith('workflows-config:')), [
    'workflows-config:.maister/config.yml:workflows.config-workflow.auto_continue — a list of gate ids is expected, not "plan-approval"; it is ignored, and every gate is asked',
  ]);
});
