#!/usr/bin/env node
/**
 * The gate-title lint: no two gates of one workflow definition ask the same
 * question. The question a gate brief shows is generated (`gateAsk`): a gate
 * the definition titles asks its title, any other the lead of its own `ask:`.
 * Two gates that read alike leave the operator, and a cockpit that shows the
 * question as written, unable to tell which approval is open.
 *
 * Usage: `node tests/gate-title-lint.mjs [--definition=<yml> ...]`. With no
 * argument it checks the five built-in workflows.
 *
 * Output: one `FAIL: <file>: <gate> and <gate> both ask "<question>"` line per
 * pair. Exit 1 after printing every failure, 0 when there is none, and 2 on the
 * script's own error — an unreadable definition, a graph that does not resolve,
 * or a usage error.
 *
 * The closing title an untitled gate falls back to is its first need that is
 * not a gate, as the brief finds it for a fresh run; the lint needs no run.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies beyond the engine's own modules, `node:` builtins only.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDefinition } from '../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { resolve } from '../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { displayOf, titleOf } from '../plugins/maister/skills/workflow-engine/scripts/lib/display.mjs';
import { gateAsk } from '../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, 'plugins/maister/skills/workflow-engine/workflows');
const BUILT_INS = ['development', 'migration', 'performance', 'product-design', 'research'];

/** Every pair of gates in `file` that ask the same question, as FAIL lines. */
export function lintDefinition(file) {
  const definition = readDefinition(file);
  if (definition.doc === null || definition.errors.length) throw new Error(`${file} cannot be read as a definition`);
  const graph = resolve({ definition, overlays: [], profile: null, degraded: [] });
  if (!graph.ok) throw new Error(`${file} does not resolve: ${graph.errors.map(error => error.message ?? error).join('; ')}`);
  const { titles } = displayOf({ definition });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const asked = new Map();
  const failures = [];
  for (const node of graph.nodes) {
    if (node.type !== 'gate') continue;
    const closing = (node.needs ?? []).find(id => byId.get(id)?.type !== 'gate') ?? node.id;
    const question = gateAsk(node.ask, titleOf(titles, closing), Object.hasOwn(titles, node.id) ? titles[node.id] : null);
    if (asked.has(question)) {
      failures.push(`FAIL: ${path.relative(ROOT, file).split(path.sep).join('/')}: ${asked.get(question)} and ${node.id} both ask "${question}"`);
    } else asked.set(question, node.id);
  }
  return failures;
}

function main(argv) {
  const files = [];
  for (const arg of argv) {
    if (!arg.startsWith('--definition=')) {
      console.error(`usage: node tests/gate-title-lint.mjs [--definition=<yml> ...] (unknown argument ${arg})`);
      return 2;
    }
    files.push(path.resolve(arg.slice('--definition='.length)));
  }
  if (!files.length) files.push(...BUILT_INS.map(name => path.join(WORKFLOWS, `${name}.yml`)));
  const failures = [];
  try {
    for (const file of files) failures.push(...lintDefinition(file));
  } catch (err) {
    console.error(`gate-title-lint: ${err.message}`);
    return 2;
  }
  for (const line of failures) console.log(line);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
