import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, freeze, umbrella } from '../helpers.mjs';
import { pathLike } from '../../plugins/maister/skills/umbrella/scripts/lib/envelope.mjs';
import { buildSeed, renderSeed } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';

// One rule decides what a path is, for the envelope that promotes `with:`
// values to read-only inputs and for the seed that anchors those inputs at the
// workspace root: a whitespace-free string holding a `/` and no `${…}`. A bare
// filename is an argument — `./context.md` is how a root-level file is handed
// over. Both modules are run over the same table, so they cannot drift apart.

const CASES = [
  { value: 'runs/x/report.md', path: true },
  { value: './context.md', path: true },
  { value: 'context.md', path: false },
  { value: '.env', path: false },
  { value: 'attended', path: false },
  { value: '${a.b}/c', path: false },
  { value: 'a b/c', path: false },
  { value: '/abs/x', path: false },
];

const ROOT_DIR = '/work';

test('path-like: the shared predicate holds the table', () => {
  for (const { value, path: expected } of CASES) assert.equal(pathLike(value), expected, value);
  for (const value of [42, true, null, undefined, {}]) assert.equal(pathLike(value), false, String(value));
});

test('path-like: the envelope promotes exactly the path-like with: values to inputs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-path-like-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'repos', 'alpha'), { recursive: true });
  assert.equal(umbrella(['init', `--root=${root}`, '--members-root=repos']).code, 0);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}', 'members:\n  alpha: {path: repos/alpha, kind: repo}'));
  // `${a.b}/c` names a node the chain does not have, so it is judged by the predicate alone above.
  const carried = CASES.filter(({ value }) => !value.includes('${'));
  const definition = path.join(root, '.maister/workflows/chain.yml');
  fs.writeFileSync(definition, [
    'name: chain', 'version: 1', 'nodes:',
    '  dev:', '    uses: workflow:development', '    dir: alpha', '    provider: claude', '    needs: []',
    '    with:', ...carried.map(({ value }, at) => `      k${at}: ${JSON.stringify(value)}`),
  ].join('\n') + '\n');
  const run = path.join(root, '.maister/umbrella/runs/2026-01-05-chain');
  fs.mkdirSync(run, { recursive: true });
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });
  const result = umbrella(['envelope', `--run=${run}`, '--node=dev', `--ledger=${path.join(root, '.maister/umbrella/ledger')}`, `--root=${root}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const inputs = JSON.parse(result.stdout).envelope.inputs.map((input) => input.path);
  assert.deepEqual(inputs, carried.filter((each) => each.path).map(({ value }) => value));
});

test('path-like: the seed anchors exactly the path-like inputs under the workspace root', () => {
  const envelope = {
    version: 1, dispatch_id: 'd-0001', provider: 'claude', autonomy: 'attended',
    target: { member: 'app', path: 'members/app' }, chain: { node: 'build' },
    outbox: '.maister/umbrella/outbox/d-0001', workspace_root: ROOT_DIR,
    workflow: { uses: 'workflow:development' },
    inputs: CASES.map(({ value }, at) => ({ path: value, role: `k${at}` })),
  };
  const lines = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('Inputs from the dispatching run'));
  const stated = lines.slice(header + 1, header + 1 + CASES.length);
  CASES.forEach(({ value, path: expected }, at) => {
    // Joined with `/`, as the seed joins every path it states.
    const want = expected ? `${ROOT_DIR}/${value}` : value;
    assert.equal(stated[at], `  ${want} (k${at})`, value);
  });
});
