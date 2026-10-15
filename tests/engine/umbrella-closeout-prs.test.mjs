import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// A close-out names each pull request as {repo, number, url}, in the outbox
// message a worker publishes and in the ledger entry the close-out lands in.
// A bare URL string, or a map missing one of the three, is refused by both
// writers, and nothing is written.

const PR = { repo: 'acme/shop', number: 7, url: 'https://example.test/acme/shop/pull/7' };

const MALFORMED = [
  ['a bare URL string', [PR.url]],
  ['a map with no url', [{ repo: PR.repo, number: PR.number }]],
  ['a map with no number', [{ repo: PR.repo, url: PR.url }]],
  ['a map with no repo', [{ number: PR.number, url: PR.url }]],
  ['a number spelled as a string', [{ ...PR, number: '7' }]],
];

function scratchDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function closeout(outbox, prs) {
  return umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-0001', '--type=closeout'],
    { grade: 'success', summary: 'Shipped.', commits: ['abc123'], prs });
}

function messages(outbox) {
  const dir = path.join(outbox, 'd-0001');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.yml')) : [];
}

test('outbox: a close-out naming its pull request as {repo, number, url}, or none, lands', t => {
  for (const prs of [[PR], []]) {
    const outbox = scratchDir(t, 'maister-outbox-');
    const result = closeout(outbox, prs);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(messages(outbox).length, 1);
  }
});

for (const [name, prs] of MALFORMED) {
  test(`outbox: a close-out whose prs holds ${name} is refused, and nothing is written`, t => {
    const outbox = scratchDir(t, 'maister-outbox-');
    const result = closeout(outbox, prs);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /outbox-message-invalid/);
    assert.match(result.stdout, /\{repo, number, url\}/);
    assert.deepEqual(messages(outbox), []);
  });
}

function ledger(t) {
  const root = scratchDir(t, 'maister-ledger-');
  const op = (name, args, id = 'd-0001') =>
    umbrella(['ledger', `--ledger=${root}`, `--op=${name}`, '--actor=daemon', ...(id ? [`--dispatch-id=${id}`] : [])], args);
  assert.equal(op('create-entry', { chain: { run_id: '2026-01-05-closeout-prs', node: 'remote' } }, null).code, 0);
  return op;
}

test('ledger: close-out records the pull request as {repo, number, url}, read back whole', t => {
  const op = ledger(t);
  const closed = op('close-out', { grade: 'success', prs: [PR], summary: 'Shipped.' });
  assert.equal(closed.code, 0, closed.stdout + closed.stderr);
  const entry = JSON.parse(op('query', {}).stdout).entry;
  assert.deepEqual(entry.closeout.prs.map(pr => ({ ...pr })), [PR]);
});

for (const [name, prs] of MALFORMED) {
  test(`ledger: close-out with ${name} in prs is refused, and the entry is not closed`, t => {
    const op = ledger(t);
    const refused = op('close-out', { grade: 'success', prs, summary: 'Shipped.' });
    assert.equal(refused.code, 1);
    assert.match(refused.stdout + refused.stderr, /ledger-args-invalid/);
    assert.match(refused.stdout + refused.stderr, /\{repo, number, url\}/);
    assert.equal(JSON.parse(op('query', {}).stdout).entry.status, 'dispatched');
    assert.equal(JSON.parse(op('query', {}).stdout).entry.closeout ?? null, null);
  });
}
