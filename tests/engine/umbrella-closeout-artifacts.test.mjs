import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// A close-out may list what a dispatched workflow run wrote, as {key, path}
// maps. The ledger records the list in the entry's closeout, empty when the
// close-out carries none, and holds it to the shape the outbox writer holds a
// close-out message's artifacts to: a malformed list is refused and the entry
// is left as it was.

const ARTIFACTS = [
  { key: 'plan', path: '.maister/tasks/development/2026-01-05-x/implementation/implementation-plan.md' },
  { key: 'spec', path: '.maister/tasks/development/2026-01-05-x/implementation/spec.md' },
];

const MALFORMED = [
  ['a map instead of a list', { key: 'plan', path: 'plan.md' }],
  ['a bare path string', ['plan.md']],
  ['a map with no key', [{ path: 'plan.md' }]],
  ['a map with no path', [{ key: 'plan' }]],
  ['an empty key', [{ key: '', path: 'plan.md' }]],
  ['a path that is not a string', [{ key: 'plan', path: 7 }]],
  ['a key that is not a string', [{ key: ['plan'], path: 'plan.md' }]],
  ['a key listed twice', [{ key: 'plan', path: 'a.md' }, { key: 'plan', path: 'b.md' }]],
];

function ledger(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const op = (name, args, id = 'd-0001') =>
    umbrella(['ledger', `--ledger=${root}`, `--op=${name}`, '--actor=daemon', ...(id ? [`--dispatch-id=${id}`] : [])], args);
  assert.equal(op('create-entry', { chain: { run_id: '2026-01-05-closeout-artifacts', node: 'remote' } }, null).code, 0);
  const entry = () => JSON.parse(op('query', {}).stdout).entry;
  const file = path.join(root, 'entries', 'd-0001.yml');
  return { op, entry, file };
}

const plain = list => list.map(item => ({ ...item }));

test('ledger: close-out records the artifacts as {key, path} maps, read back whole', t => {
  const { op, entry } = ledger(t);
  const closed = op('close-out', { grade: 'success', commits: ['abc123'], artifacts: ARTIFACTS, summary: 'Shipped.' });
  assert.equal(closed.code, 0, closed.stdout + closed.stderr);
  const read = entry();
  assert.equal(read.status, 'closed');
  assert.deepEqual(plain(read.closeout.artifacts), ARTIFACTS);
  assert.deepEqual([...read.closeout.commits], ['abc123']);
});

test('ledger: a close-out without artifacts records an empty list beside the empty prs', t => {
  const { op, entry } = ledger(t);
  const closed = op('close-out', { grade: 'partial', summary: 'Half done.' });
  assert.equal(closed.code, 0, closed.stdout + closed.stderr);
  const { closeout } = entry();
  assert.deepEqual([...closeout.artifacts], []);
  assert.deepEqual([...closeout.prs], []);
  assert.deepEqual([...closeout.commits], []);
  assert.equal(closeout.summary, 'Half done.');
});

for (const [name, artifacts] of MALFORMED) {
  test(`ledger: close-out with ${name} in artifacts is refused, and the entry is unchanged`, t => {
    const { op, file } = ledger(t);
    const before = fs.readFileSync(file, 'utf8');
    const refused = op('close-out', { grade: 'success', artifacts, summary: 'Shipped.' });
    assert.equal(refused.code, 1);
    assert.match(refused.stdout + refused.stderr, /ledger-args-invalid/);
    assert.match(refused.stdout + refused.stderr, /\{key, path\}/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}

test('outbox and ledger hold close-out artifacts to one shape', t => {
  for (const [, artifacts] of MALFORMED) {
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-outbox-'));
    t.after(() => fs.rmSync(outbox, { recursive: true, force: true }));
    const result = umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-0001', '--type=closeout'],
      { grade: 'success', summary: 'Shipped.', commits: [], prs: [], artifacts });
    assert.equal(result.code, 1, JSON.stringify(artifacts));
    assert.match(result.stdout, /outbox-message-invalid/);
  }
});
