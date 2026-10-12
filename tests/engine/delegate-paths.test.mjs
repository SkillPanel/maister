import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, ENGINE_DIR, verb } from '../helpers.mjs';

// A node run by an agent declares the files it owes, and the engine checks
// each one exists before it records the node completed. The agent writes to
// paths of its own, so a declared path the agent never names, and that it
// cannot be told, is a node that re-drives until its budget is spent.

const AGENTS = path.join(ROOT, 'plugins/maister/agents');
const BUILT_INS = ['development', 'research', 'product-design', 'performance', 'migration'];

// Declared artifacts the node itself writes, not its agent.
const NODE_WRITTEN = new Set(['development:gap-analysis:scope']);

function resolved(name) {
  const result = verb(['resolve', `--definition=${path.join(ENGINE_DIR, 'workflows', `${name}.yml`)}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('every artifact an agent node declares is one its agent writes or can be told to write', () => {
  const unreachable = [];
  for (const name of BUILT_INS) {
    for (const node of resolved(name).nodes) {
      if (!node.uses?.startsWith('agent:')) continue;
      const agent = node.uses.slice('agent:'.length);
      const text = fs.readFileSync(path.join(AGENTS, `${agent}.md`), 'utf8');
      const takesPath = /^\|\s*`output_path`\s*\|/m.test(text);
      for (const [key, file] of Object.entries(node.outputs?.artifacts ?? {})) {
        if (NODE_WRITTEN.has(`${name}:${node.id}:${key}`)) continue;
        if (!text.includes(file) && !takesPath) unreachable.push(`${name}:${node.id} ${file} (${agent})`);
      }
    }
  }
  assert.deepEqual(unreachable, [], 'declared artifacts no agent can write');
});
