import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const BUILT_INS = ['development', 'migration', 'mockup-studio', 'performance', 'product-design', 'research'];

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

/** The rows of the engine skill's `### Node conventions` table, as their text. */
function conventionRows() {
  const lines = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8').split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(lines.indexOf('### Node conventions') + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || line.startsWith('| Applies to')) continue;
    const cells = line.slice(1).replace(/\|\s*$/, '');
    rows.push(cells.slice(cells.indexOf('|') + 1).trim());
  }
  return rows;
}

for (const name of BUILT_INS) {
  test(`node-brief size: in one session, no convention row of ${name} is printed twice`, t => {
    const run = scratch(t, { type: name });
    const definition = path.join(WORKFLOWS, `${name}.yml`);
    const graph = freeze(run, {
      definition,
      inputs: requiredInputs(definition),
      orchestrator: { driver: { kind: 'terminal' }, options: { html_output: true } },
    });
    const rows = conventionRows();
    assert.ok(rows.length >= 9, 'the conventions table is read');
    const env = { CLAUDE_CODE_SESSION_ID: 'size-session' };
    const printed = new Map();
    let total = 0;
    let fixed = 0;
    // Twice over the graph: the second pass is every node briefed again in a
    // session that has seen all its rows, and prints none of them whole.
    for (const pass of [1, 2]) {
      for (const node of graph.nodes) {
        const result = verb(['node-brief', `--state=${run.state}`, `--node=${node.id}`], undefined, env);
        assert.equal(result.code, 0, `${node.id}: ${result.stderr}`);
        for (const text of rows) {
          if (!result.stdout.includes(text)) continue;
          assert.ok(pass === 1, `${node.id}: a row printed whole again on the second pass`);
          assert.ok(!printed.has(text), `${node.id}: a row printed whole again, first printed for ${printed.get(text)}`);
          printed.set(text, node.id);
        }
        total += Buffer.byteLength(result.stdout);
        fixed += result.stdout.split('\n').filter(line => line.startsWith('convention (') || line.startsWith('conventions in force (')).reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
      }
    }
    t.diagnostic(`${name}: ${total} bytes of briefs over two passes, ${fixed} of them convention lines`);
  });
}
