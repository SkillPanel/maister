import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, scratch, verb } from '../helpers.mjs';

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
  assert.doesNotMatch(message, /\b2\.\d+\.\d+\b/, 'no exact 2.x version: the state never recorded one');
});

test('resume-check: a product-design directory is sent to its own command, not refused as 2.x', t => {
  const run = scratch(t, { fixture: 'prose-2x', type: 'product-design' });
  const result = resumeCheck(run);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.json.code, 'prose-orchestrator');
  assert.match(result.json.message, /\/maister:product-design /);
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
