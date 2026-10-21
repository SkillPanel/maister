import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, freeze, legacyMirror, run as runScript, scratch, verb, write } from '../helpers.mjs';

/** Run `resume-check` against a run and parse the JSON it always prints. */
function resumeCheck(run) {
  const result = verb(['resume-check', `--state=${run.state}`]);
  return { ...result, json: result.stdout ? JSON.parse(result.stdout) : null };
}

/** Every file under a directory with its bytes, so "nothing was written" is a comparison. */
function snapshot(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    files[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

for (const type of ['development', 'performance', 'migrations']) {
  test(`resume-check: a 2.x ${type} directory is refused and left untouched`, t => {
    const run = scratch(t, { fixture: 'prose-2x', type });
    const before = snapshot(run.dir);
    const result = resumeCheck(run);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.code, 'written-by-2x');
    assert.deepEqual(snapshot(run.dir), before);
  });
}

test('resume-check: a 2.x research directory is refused the same way', t => {
  const run = scratch(t, { fixture: 'prose-2x-research', type: 'research' });
  const result = resumeCheck(run);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.json.code, 'written-by-2x');
});

test('resume-check: the refusal says 2.x, names both install lines, and guesses no version', t => {
  const run = scratch(t, { fixture: 'prose-2x' });
  const { message } = resumeCheck(run).json;
  assert.match(message, /started on the maister 2\.x plugin/);
  assert.match(message, /maister 3\.0 does not resume it/);
  assert.match(message, /Nothing in the directory was changed/);
  assert.match(message, /artifacts are still readable in place/);
  assert.ok(message.includes('`/plugin marketplace add SkillPanel/maister#release/2.x`'));
  assert.ok(message.includes('`/plugin install maister@maister-plugins-2x`'));
  assert.ok(message.includes('`--context=<this task directory>`'), 'names the context-pack route on 3.0');
  assert.doesNotMatch(message, /\b2\.\d+\.\d+\b/, 'no exact 2.x version: the state never recorded one');
});

test('resume-check: the Copilot variant gives the 2.x install line in Copilot CLI commands', t => {
  const run = scratch(t, { fixture: 'prose-2x' });
  const variantEngine = path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs');
  const result = runScript(variantEngine, ['resume-check', `--state=${run.state}`]);
  assert.equal(result.code, 1, result.stderr);
  const { code, message } = JSON.parse(result.stdout);
  assert.equal(code, 'written-by-2x');
  assert.match(message, /started on the maister 2\.x plugin/);
  assert.ok(message.includes('`copilot plugin marketplace add SkillPanel/maister#release/2.x`'));
  assert.ok(message.includes('`copilot plugin install maister-copilot@maister-plugins-2x`'));
  assert.ok(message.includes('`copilot plugin uninstall maister-copilot@maister-plugins`'));
  assert.doesNotMatch(message, /\/plugin /, 'no Claude Code slash command');
});

test('resume-check: a 2.x product-design directory is refused the same way and left untouched', t => {
  const run = scratch(t, { fixture: 'prose-2x-product-design', type: 'product-design' });
  const before = snapshot(run.dir);
  const result = resumeCheck(run);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.json.code, 'written-by-2x');
  assert.match(result.json.message, /started on the maister 2\.x plugin/);
  assert.doesNotMatch(result.json.message, /product-design/, 'one message for every workflow, naming none');
  assert.deepEqual(snapshot(run.dir), before);
});

test('resume-check: a run the engine froze resumes, with its name, overlays and profile', t => {
  const run = scratch(t);
  const graph = freeze(run, { task: { title: 'Frozen run' } });
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.workflow.name, graph.name);
  assert.deepEqual(result.json.workflow.overlays, []);
  assert.equal(result.json.workflow.profile, null);
  assert.equal(result.json.title, 'Frozen run');
  assert.equal(result.json.status, 'in_progress');
  assert.equal(result.json.task_path, run.dir);
  assert.equal(result.json.dashboard, pathToFileURL(path.join(run.dir, 'dashboard.html')).href);
});

test('resume-check: a run without a dashboard reports none, so a resume shows no link', t => {
  const run = scratch(t);
  freeze(run);
  fs.rmSync(path.join(run.dir, 'dashboard.html'));
  assert.equal(resumeCheck(run).json.dashboard, null, 'the viewer is missing');
  const off = scratch(t, { name: '2026-01-06-off' });
  freeze(off, { orchestrator: { options: { html_output: false } } });
  assert.equal(resumeCheck(off).json.dashboard, null, 'html_output is false');
});

test('resume-check: a missing state file is unreadable, not 2.x', t => {
  const run = scratch(t);
  const result = resumeCheck(run);
  assert.equal(result.code, 1);
  assert.equal(result.json.code, 'state-unreadable');
});

test('resume-check: --state is required and no other flag is taken', () => {
  assert.equal(verb(['resume-check']).code, 2);
  assert.equal(verb(['resume-check', '--state=x', '--node=y']).code, 2);
});

test('resume-check: a phase-summary mirror an older run carries is announced once, and changes nothing else', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  legacyMirror(run, [
    '    analysis:',
    '      decisions:',
    '        - only on the mirror',
    '        - also on the mirror',
    '      risks:',
    '        - a mirrored risk',
    '    specification:',
    '      decisions: not a list',
    '    gap: not a map',
  ]);
  const before = snapshot(run.dir);
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.ok(!Object.hasOwn(result.json, 'warnings'), 'the JSON keeps its shape');
  assert.deepEqual(result.stderr.split(/\r?\n/).filter(line => line !== ''), [
    'warning: legacy-mirror-ignored: task_context.phase_summaries holds 2 decisions and 1 risk that no step reads; '
      + 'the phase-summary mirror is retired (see the Upgrading note in the changelog)',
  ]);
  assert.deepEqual(snapshot(run.dir), before);
});

test('resume-check: no mirror, or an empty one, prints no warning', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  assert.equal(resumeCheck(run).stderr, '');
  legacyMirror(run, []);
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('resume-check: a mirror whose entries hold no decision and no risk prints no warning', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  legacyMirror(run, [
    '    analysis:',
    '      summary: Scoped on the mirror.',
    '      decisions: []',
    '      risks: []',
    '    specification:',
    '      summary: Specified.',
  ]);
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
});

/** A run directory under the umbrella root of a fresh scratch checkout, removed when the test ends. */
function umbrellaRun(t, id = 'r-0001') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.maister', 'umbrella', 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, state: path.join(dir, 'orchestrator-state.yml') };
}

/** A driver recorded on a machine the run has since left: its cwd names no directory here. */
const MOVED_DRIVER = { driver: { kind: 'dispatch', cwd: path.join(os.tmpdir(), 'maister-gone', 'old-machine', 'checkout') } };

test('resume-check: root is the checkout four levels above the state file', t => {
  const run = scratch(t);
  freeze(run);
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.root, run.root);
});

test('resume-check: a moved run resolves to its real checkout, not to the cwd its driver recorded', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: MOVED_DRIVER });
  assert.ok(!fs.existsSync(MOVED_DRIVER.driver.cwd), 'the recorded cwd names no directory');
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.root, run.root);
  assert.equal(result.json.task_path, run.dir);
});

test('resume-check: a moved umbrella-root run resolves to its workspace, not to the recorded cwd', t => {
  const run = umbrellaRun(t);
  freeze(run, { orchestrator: MOVED_DRIVER });
  const result = resumeCheck(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.root, run.root);
  assert.equal(result.json.task_path, run.dir);
});

for (const suffix of ['moved-1739000000', 'failed-2']) {
  test(`resume-check: a .${suffix.split('-')[0]}-<digits> copy beside a run is refused and left untouched`, t => {
    const run = scratch(t);
    freeze(run);
    const copy = `${run.dir}.${suffix}`;
    fs.cpSync(run.dir, copy, { recursive: true });
    const before = snapshot(copy);
    const result = resumeCheck({ state: path.join(copy, 'orchestrator-state.yml') });
    assert.equal(result.code, 1, result.stdout);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.code, 'run-set-aside');
    assert.match(result.json.message, /not a run/);
    assert.deepEqual(snapshot(copy), before);
    assert.equal(resumeCheck(run).json.ok, true, 'the run itself still resumes');
  });
}

test('resume-check: a set-aside copy of an umbrella-root run is refused too', t => {
  const run = umbrellaRun(t, 'r-0001.moved-42');
  freeze(run);
  assert.equal(resumeCheck(run).json.code, 'run-set-aside');
});

test('resume-check: a suffix that is not digits does not set a run aside', t => {
  const run = scratch(t, { name: '2026-01-05-sample.moved-later' });
  freeze(run);
  assert.equal(resumeCheck(run).json.ok, true);
});
