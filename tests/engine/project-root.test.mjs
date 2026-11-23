// A run's project root comes from one rule (`lib/run-dirs.mjs`'s `runPlace`):
// the folder holding the `.maister/` the run sits in. The freeze's seeders,
// the misplaced-folder check and resume-check all take it, so a chain's own
// run under `.maister/umbrella/runs/<id>/runs/<child>/` reads the project's
// config.yml and profile and resumes from the root it froze by.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, freeze, freezePatch, readState, scratch, sibling, verb } from '../helpers.mjs';

const { runPlace, projectRootOf } = await import(pathToFileURL(path.join(ROOT, 'plugins/maister/lib/run-dirs.mjs')).href);

/** A fresh scratch folder, removed when the test ends. */
function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A run folder at `segments` under `root`, made, with its state path. */
function runAt(root, ...segments) {
  const dir = path.join(root, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir, state: path.join(dir, 'orchestrator-state.yml') };
}

const CONFIG = [
  'html_output: false',
  'mockup_format: ascii',
  'subagents:',
  '  agents:',
  '    spec-auditor: { model: sonnet }',
  'project:',
  '  kind: service',
  '  exposure: internal',
  '',
].join('\n');

function writeConfig(root, text) {
  fs.mkdirSync(path.join(root, '.maister'), { recursive: true });
  fs.writeFileSync(path.join(root, '.maister', 'config.yml'), text);
}

test('runPlace: every legal run folder resolves to the folder holding its .maister', t => {
  const root = tempRoot(t);
  const cases = [
    [['.maister', 'tasks', 'development', '2026-01-05-a'], 'task'],
    [['.maister', 'umbrella', 'runs', 'r-0001'], 'umbrella'],
    [['.maister', 'umbrella', 'runs', 'r-0001', 'runs', 'm-0001'], 'member'],
  ];
  for (const [segments, shape] of cases) {
    const dir = path.join(root, ...segments);
    assert.deepEqual(runPlace(dir), { root, shape, legal: true }, segments.join('/'));
    assert.equal(projectRootOf(dir), root);
  }
});

test('runPlace: a folder deeper under .maister has the same root and is not a top-level run folder', t => {
  const root = tempRoot(t);
  for (const segments of [
    ['.maister', 'tasks', 'development', '2026-01-05-a', '2026-01-05-a-research'],
    ['.maister', 'tasks', 'development'],
    ['.maister', 'umbrella', 'runs', 'r-0001', 'other', 'm-0001'],
    ['.maister', 'elsewhere', 'x'],
  ]) {
    assert.deepEqual(runPlace(path.join(root, ...segments)), { root, shape: 'inside', legal: false }, segments.join('/'));
  }
});

test('runPlace: a folder outside any .maister is four levels down, or found through its parent link', t => {
  const root = tempRoot(t);
  const dir = path.join(root, 'a', 'b', 'c', 'd');
  assert.deepEqual(runPlace(dir), { root, shape: null, legal: false });
  // A parent link names the parent relative to its root; the nearest ancestor holding it is the root.
  const parent = runAt(root, '.maister', 'tasks', 'development', '2026-01-05-p');
  fs.writeFileSync(parent.state, 'task: {}\n');
  const child = path.join(root, 'stray', 'child');
  assert.equal(projectRootOf(child, { run: '.maister/tasks/development/2026-01-05-p' }), root);
  assert.equal(projectRootOf(child), path.resolve(child, '..', '..', '..', '..'));
});

test('runPlace: a chain\'s own run under a workspace root belongs to the workspace, not to a checkout inside it', t => {
  const workspace = tempRoot(t);
  fs.mkdirSync(path.join(workspace, 'service', '.maister'), { recursive: true });
  const member = path.join(workspace, '.maister', 'umbrella', 'runs', 'r-0001', 'runs', 'm-0001');
  assert.deepEqual(runPlace(member), { root: workspace, shape: 'member', legal: true });
});

test('a chain\'s own run freezes with the project\'s config.yml, subagents and profile, and resume-check agrees on its root', t => {
  const project = scratch(t).root;
  writeConfig(project, CONFIG);
  const member = runAt(project, '.maister', 'umbrella', 'runs', 'r-0001', 'runs', 'm-0001');
  const frozen = verb(['write-state', `--state=${member.state}`], freezePatch().patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.doesNotMatch(frozen.stderr, /state-run-folder-misplaced/);

  const { orchestrator } = readState(member);
  assert.equal(orchestrator.options.html_output, false);
  assert.equal(orchestrator.options.mockup_format, 'ascii');
  assert.equal(orchestrator.options.subagents.agents['spec-auditor'].model, 'sonnet');
  assert.deepEqual(orchestrator.options.project, { kind: 'service', exposure: 'internal' });
  assert.equal(orchestrator.task_path, '.maister/umbrella/runs/r-0001/runs/m-0001');

  const resumed = verb(['resume-check', `--state=${member.state}`]);
  assert.equal(resumed.code, 0, resumed.stderr);
  const json = JSON.parse(resumed.stdout);
  assert.equal(json.root, project);
  assert.equal(path.relative(json.root, member.dir).split(path.sep).join('/'), orchestrator.task_path);
});

test('a chain\'s own run started at a workspace root reads the workspace\'s config.yml, not a checkout\'s inside it', t => {
  const workspace = scratch(t).root;
  writeConfig(workspace, 'html_output: false\nproject:\n  kind: service\n');
  writeConfig(path.join(workspace, 'checkout'), 'html_output: true\nproject:\n  kind: cli\n');
  const member = runAt(workspace, '.maister', 'umbrella', 'runs', 'r-0002', 'runs', 'm-0002');
  const frozen = verb(['write-state', `--state=${member.state}`], freezePatch().patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  const { options } = readState(member).orchestrator;
  assert.equal(options.html_output, false);
  assert.deepEqual(options.project, { kind: 'service' });
  assert.equal(JSON.parse(verb(['resume-check', `--state=${member.state}`]).stdout).root, workspace);
});

test('a top-level run and an umbrella run read their config.yml from four levels up, as before', t => {
  const run = scratch(t);
  writeConfig(run.root, CONFIG);
  freeze(run);
  assert.equal(readState(run).orchestrator.options.subagents.agents['spec-auditor'].model, 'sonnet');
  assert.deepEqual(readState(run).orchestrator.options.project, { kind: 'service', exposure: 'internal' });
  assert.equal(JSON.parse(verb(['resume-check', `--state=${run.state}`]).stdout).root, run.root);

  const umbrella = runAt(run.root, '.maister', 'umbrella', 'runs', 'r-0003');
  assert.equal(verb(['write-state', `--state=${umbrella.state}`], freezePatch().patch).code, 0);
  assert.equal(readState(umbrella).orchestrator.options.html_output, false);
  assert.equal(JSON.parse(verb(['resume-check', `--state=${umbrella.state}`]).stdout).root, run.root);
});

test('a sub-run child resumes from its parent\'s project root', t => {
  const parent = scratch(t);
  freeze(parent);
  const child = sibling(parent, { type: 'research', name: '2026-01-05-sample-research' });
  const { patch } = freezePatch({ orchestrator: { parent: { run: parent.path, node: 'research' } } });
  const frozen = verb(['write-state', `--state=${child.state}`], patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(JSON.parse(verb(['resume-check', `--state=${child.state}`]).stdout).root, parent.root);
});
