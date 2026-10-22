import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, verb } from '../helpers.mjs';
import { buildSeed, renderSeed } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';
import { resolveFromState } from '../../plugins/maister/skills/umbrella/scripts/lib/envelope.mjs';

// The umbrella runtime reads the plugin tree it ships in, whatever a
// plugin-root variable says: a variable exported for one host reaches the other
// host's shell, and a stale one names an install that is not running. A seed
// names this install's scripts, and a dispatch re-resolves a built-in from this
// install's definitions. Only a caller's explicit `pluginRoot` pins another.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const VARIABLES = ['CLAUDE_PLUGIN_ROOT', 'MAISTER_PLUGIN_ROOT'];

const ENVELOPE = {
  version: 1,
  dispatch_id: 'd-0001',
  provider: 'claude',
  autonomy: 'attended',
  target: { member: 'app', path: 'members/app' },
  chain: { node: 'build' },
  outbox: '.maister/umbrella/outbox/d-0001',
  workspace_root: '/work',
  statement: 'Add a tag filter to the list view',
  workflow: { uses: 'workflow:development' },
};

/**
 * A decoy plugin tree whose `research` built-in is a different graph, with
 * both plugin-root variables pointing at it for the length of the test.
 */
function decoy(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-decoy-')));
  const workflows = path.join(root, 'skills/workflow-engine/workflows');
  fs.mkdirSync(workflows, { recursive: true });
  fs.writeFileSync(path.join(workflows, 'research.yml'),
    ['name: research', 'version: 1', 'nodes:', '  only:', '    uses: agent:code-risk-review', '    needs: []', ''].join('\n'));
  const saved = Object.fromEntries(VARIABLES.map(name => [name, process.env[name]]));
  for (const name of VARIABLES) process.env[name] = root;
  t.after(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('plugin root: a seed built with no root names this install\'s scripts, not the one a variable names', t => {
  const other = decoy(t);
  const prompt = renderSeed(buildSeed(ENVELOPE));
  const commands = prompt.split(/\r?\n/).filter(line => /^\s*node /.test(line));
  assert.ok(commands.length >= 3, `the seed names the outbox and gate commands:\n${prompt}`);
  for (const line of commands) {
    assert.ok(line.trimStart().startsWith(`node ${PLUGIN}/skills/`), line);
  }
  assert.ok(!prompt.includes(other), 'the decoy tree is never named');
});

test('plugin root: a root the caller passes still pins the seed', t => {
  decoy(t);
  const pinned = path.join(os.tmpdir(), 'pinned-install');
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot: pinned }));
  assert.ok(prompt.includes(`node ${pinned}/skills/umbrella/scripts/umbrella.mjs outbox`), prompt);
});

test('plugin root: a dispatch re-resolves a built-in from this install, not the one a variable names', t => {
  decoy(t);
  const expected = JSON.parse(verb(['resolve', `--definition=${path.join(PLUGIN, 'skills/workflow-engine/workflows/research.yml')}`]).stdout).graph_hash;
  assert.match(expected, /^sha256:/);
  const run = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-run-')));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  const resolved = resolveFromState({ state: { workflow: { source: 'builtin:research' } }, run });
  assert.equal(resolved.graph_hash, expected);
  assert.ok(resolved.nodes.length > 1, 'the real research graph, not the one-node decoy');
});
