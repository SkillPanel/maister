import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// How long each step's brief is: every node of every built-in, frozen in a
// scratch project under the terminal driver with HTML pages on, run through
// `node-brief`. The word count per node is printed as a diagnostic table, for a
// reader comparing one change with the next; no count is a target, and none is
// a finding. What fails is structure: a node whose brief does not exit 0 or
// prints nothing.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const BUILT_INS = ['development', 'migration', 'performance', 'product-design', 'research'];

const words = text => text.split(/\s+/).filter(Boolean).length;

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
  test(`node-brief size: every node of ${name} has a brief, its words printed`, t => {
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
      rows.push({ id: node.id, kind, words: words(result.stdout) });
    }

    const width = Math.max(...rows.map(row => row.id.length));
    t.diagnostic(`${name}: node-brief words per node`);
    for (const row of rows) {
      t.diagnostic(`  ${row.id.padEnd(width)}  ${row.kind.padEnd(8)}  ${String(row.words).padStart(5)}`);
    }
  });
}
