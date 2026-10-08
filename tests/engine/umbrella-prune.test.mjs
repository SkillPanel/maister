import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// A generated chain is four files: the definition, its prose, its plan and the
// outcome marker the planner writes when it finishes. Prune removes every one
// of them that exists, and the marker is never mistaken for a chain of its own.

const GENERATED = ['.maister', 'workflows', 'generated'];
const FOUR = ['c-one.yml', 'c-one.md', 'c-one.plan.md', 'c-one.outcome.yml'];

/** A workspace holding chain `c-one` with `files`, named by one completed run. */
function workspace(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-prune-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, ...GENERATED);
  fs.mkdirSync(home, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(home, file), 'x: 1\n');
  const run = path.join(root, '.maister', 'umbrella', 'runs', 'r1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'orchestrator-state.yml'),
    `workflow:\n  source: ${path.join(...GENERATED, 'c-one.yml')}\ntask:\n  status: completed\n`);
  return { root, home };
}

function prune(root, ...flags) {
  const result = umbrella(['prune', `--root=${root}`, ...flags]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

const listed = (report) => report.pruned.flatMap((chain) => chain.files.map((file) => path.basename(file))).sort();

test('prune: a chain whose planner finished loses all four files, and a dry run lists all four', (t) => {
  const { root, home } = workspace(t, FOUR);

  const dry = prune(root, '--dry-run');
  assert.equal(dry.code, 0);
  assert.deepEqual(listed(dry.report), [...FOUR].sort());
  assert.deepEqual(fs.readdirSync(home).sort(), [...FOUR].sort(), 'a dry run deletes nothing');

  const real = prune(root);
  assert.equal(real.code, 0);
  assert.deepEqual(real.report.pruned.map((chain) => chain.name), ['c-one']);
  assert.deepEqual(listed(real.report), [...FOUR].sort());
  assert.deepEqual(fs.readdirSync(home), [], 'no outcome marker is left behind');
});

test('prune: a chain with no outcome marker loses the three files it has, without error', (t) => {
  const three = FOUR.filter((file) => !file.endsWith('.outcome.yml'));
  const { root, home } = workspace(t, three);

  const { code, report } = prune(root);
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(listed(report), [...three].sort());
  assert.deepEqual(fs.readdirSync(home), []);
});

test('prune: an outcome marker is never a chain of its own', (t) => {
  const { root, home } = workspace(t, FOUR);

  const { code, report } = prune(root, '--name=c-one.outcome');
  assert.notEqual(code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'umbrella-chain-missing');
  assert.match(report.errors[0].message, /the generated chains are c-one\./);
  assert.deepEqual(fs.readdirSync(home).sort(), [...FOUR].sort(), 'nothing was deleted');
});
