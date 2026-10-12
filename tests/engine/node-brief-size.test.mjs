import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// How long each step's brief is: every node of every built-in, frozen in a
// scratch project under the terminal driver with HTML pages on, run through
// `node-brief`. The size targets are guidance — a step's brief below 500 words,
// an `agent:` or `skill:` step's below 300 — so a node at or over its target is
// reported as a warning beside the table and never fails the test. What fails
// is structure: a node whose brief does not exit 0 or prints nothing.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const BUILT_INS = ['development', 'migration', 'performance', 'product-design', 'research'];
const TARGET = 500;
const DELEGATED_TARGET = 300;

const words = text => text.split(/\s+/).filter(Boolean).length;

/** The brief's target for a resolved node: lower for a step that hands its work to an agent or a skill. */
function targetOf(node) {
  return typeof node.uses === 'string' && /^(agent|skill):/.test(node.uses) ? DELEGATED_TARGET : TARGET;
}

/** A value for each input the definition requires, so the freeze is one a run could make. */
function requiredInputs(file) {
  const inputs = {};
  for (const [key, spec] of Object.entries(readDefinition(file).doc?.inputs ?? {})) {
    if (spec?.required !== true) continue;
    inputs[key] = spec.type === 'bool' ? false : 'A sample task for measuring the briefs';
  }
  return inputs;
}

for (const name of BUILT_INS) {
  test(`node-brief size: every node of ${name} has a brief, measured against its target`, t => {
    const run = scratch(t, { type: name });
    const definition = path.join(WORKFLOWS, `${name}.yml`);
    const graph = freeze(run, {
      definition,
      inputs: requiredInputs(definition),
      orchestrator: { driver: { kind: 'terminal' }, options: { html_output: true } },
    });

    const rows = [];
    for (const node of graph.nodes) {
      const result = verb(['node-brief', `--state=${run.state}`, `--node=${node.id}`]);
      assert.equal(result.code, 0, `${node.id}: ${result.stderr}`);
      assert.ok(result.stdout.trim() !== '', `${node.id}: the brief is empty`);
      const kind = node.type === 'gate' ? 'gate' : node.uses.slice(0, node.uses.indexOf(':'));
      rows.push({ id: node.id, kind, words: words(result.stdout), target: targetOf(node) });
    }

    const width = Math.max(...rows.map(row => row.id.length));
    t.diagnostic(`${name}: node-brief words per node`);
    for (const row of rows) {
      t.diagnostic(`  ${row.id.padEnd(width)}  ${row.kind.padEnd(8)}  ${String(row.words).padStart(5)}  (target < ${row.target})`);
    }
    for (const row of rows.filter(row => row.words >= row.target)) {
      t.diagnostic(`warning: ${name}: ${row.id}: brief is ${row.words} words (target < ${row.target})`);
    }
  });
}
