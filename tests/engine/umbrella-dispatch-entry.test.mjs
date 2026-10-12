import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, umbrella } from '../helpers.mjs';

// The envelope and the dispatch's ledger entry come from one document. On a
// ledger with no entry for the node — every new workspace's first dispatch —
// the envelope verb opens the entry itself, with the chain, target, provider
// and session the envelope carries, so a driver never has to write one by hand
// and the cockpit can bind the dispatch to its run. Each refusal on the way is
// provoked here beside the path that passes.

const CHAIN = [
  'name: chain', 'version: 1', 'nodes:',
  '  api:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
  '  web:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: [api]',
].join('\n') + '\n';

const RUN_ID = '2026-01-05-chain';

/** A scaffolded workspace with member `alpha`, a chain and one frozen run of it. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'repos/alpha'), { recursive: true });
  const init = umbrella(['init', `--root=${root}`, '--members-root=repos']);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}', 'members:\n  alpha: {path: repos/alpha, kind: repo}'));
  const definition = path.join(root, '.maister/workflows/chain.yml');
  fs.writeFileSync(definition, CHAIN);
  const run = path.join(root, '.maister/umbrella/runs', RUN_ID);
  fs.mkdirSync(run, { recursive: true });
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });
  return { root, run, ledger: path.join(root, '.maister/umbrella/ledger') };
}

function envelope(ws, node, overrides = {}) {
  const result = umbrella(['envelope', `--run=${ws.run}`, `--node=${node}`, `--ledger=${ws.ledger}`, `--root=${ws.root}`], overrides);
  return { code: result.code, report: JSON.parse(result.stdout), stderr: result.stderr };
}

function ledger(ws, op, args = {}, id = null) {
  const flags = ['ledger', `--ledger=${ws.ledger}`, `--op=${op}`, '--actor=engine', ...(id ? [`--dispatch-id=${id}`] : [])];
  const result = umbrella(flags, args);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

/** Every file of the ledger, by relative path, so "nothing was written" is one comparison. */
function snapshot(dir) {
  const files = {};
  const walk = (at) => {
    for (const name of fs.readdirSync(at)) {
      const full = path.join(at, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

const logLines = (ws) => fs.readFileSync(path.join(ws.ledger, 'ledger.log'), 'utf8').split('\n').filter(Boolean);
const published = (ws, node) => path.join(ws.run, 'dispatch', `${node}.envelope.yml`);

test('dispatch entry: the first dispatch on an empty ledger opens its entry with the envelope\'s four blocks', (t) => {
  const ws = workspace(t);
  const built = envelope(ws, 'api');
  assert.equal(built.code, 0, JSON.stringify(built.report) + built.stderr);
  assert.equal(built.report.dispatch_id, 'd-0001');
  assert.equal(built.report.entry, 'created');

  const queried = ledger(ws, 'query', {}, 'd-0001');
  assert.equal(queried.code, 0, JSON.stringify(queried.report));
  const { entry } = queried.report;
  for (const block of ['chain', 'target', 'provider', 'session']) {
    assert.deepEqual(entry[block], built.report.envelope[block], `the entry's ${block} is the envelope's`);
  }
  assert.equal(entry.chain.run_id, RUN_ID);
  assert.equal(entry.chain.node, 'api');
  assert.equal(entry.status, 'dispatched');

  assert.equal(logLines(ws).length, 1);
  assert.match(logLines(ws)[0], /^\S+ create-entry d-0001 engine$/);
  assert.match(fs.readFileSync(path.join(ws.ledger, 'index.yml'), 'utf8'), /d-0001/);
});

test('dispatch entry: two nodes of one run are two dispatches under two ids', (t) => {
  const ws = workspace(t);
  assert.equal(envelope(ws, 'api').report.dispatch_id, 'd-0001');
  assert.equal(envelope(ws, 'web').report.dispatch_id, 'd-0002');
  assert.equal(ledger(ws, 'query', {}, 'd-0002').report.entry.chain.node, 'web');
});

test('dispatch entry: building a node again reuses its entry, and a published envelope refuses before any write', (t) => {
  const ws = workspace(t);
  assert.equal(envelope(ws, 'api').code, 0);

  const before = snapshot(ws.ledger);
  const again = envelope(ws, 'api');
  assert.equal(again.code, 1);
  assert.equal(again.report.errors[0].code, 'dispatch-envelope-exists');
  assert.deepEqual(snapshot(ws.ledger), before, 'a refused envelope opened no second entry');

  fs.rmSync(published(ws, 'api'));
  const rebuilt = envelope(ws, 'api');
  assert.equal(rebuilt.code, 0, JSON.stringify(rebuilt.report));
  assert.equal(rebuilt.report.dispatch_id, 'd-0001');
  assert.equal(rebuilt.report.entry, 'existing');
  assert.deepEqual(snapshot(ws.ledger), before, 'the entry was reused, not written again');
});

test('dispatch entry: an envelope the runtime refuses opens no entry', (t) => {
  const ws = workspace(t);
  const before = snapshot(ws.ledger);
  const refused = envelope(ws, 'api', { permissions: { allow: ['write'] } });
  assert.equal(refused.code, 1);
  assert.equal(refused.report.errors[0].code, 'dispatch-permissions-override-unsupported');
  assert.deepEqual(snapshot(ws.ledger), before);
  assert.equal(fs.existsSync(published(ws, 'api')), false);
});

test('dispatch entry: a given dispatch id is opened when free, and refused dispatch-id-mismatch when it is another node\'s', (t) => {
  const ws = workspace(t);
  const given = envelope(ws, 'api', { dispatch_id: 'd-0042' });
  assert.equal(given.code, 0, JSON.stringify(given.report));
  assert.equal(given.report.entry, 'created');
  assert.equal(ledger(ws, 'query', {}, 'd-0042').report.entry.chain.node, 'api');

  const before = snapshot(ws.ledger);
  const mismatched = envelope(ws, 'web', { dispatch_id: 'd-0042' });
  assert.equal(mismatched.code, 1);
  assert.equal(mismatched.report.errors[0].code, 'dispatch-id-mismatch');
  assert.match(mismatched.report.errors[0].message, /belongs to node api/);
  assert.deepEqual(snapshot(ws.ledger), before);
  assert.equal(fs.existsSync(published(ws, 'web')), false);
});

test('dispatch entry: a ledger refusal is reported under its own code and no envelope is published', (t) => {
  const ws = workspace(t);
  // A held allocation lock, fresh enough not to be reclaimed as a leftover.
  fs.writeFileSync(path.join(ws.ledger, 'allocation.tmp'), '');
  const locked = envelope(ws, 'api');
  assert.equal(locked.code, 1);
  assert.equal(locked.report.errors[0].code, 'ledger-locked');
  assert.equal(fs.existsSync(published(ws, 'api')), false);
  assert.deepEqual(fs.readdirSync(path.join(ws.ledger, 'entries')), []);

  fs.rmSync(path.join(ws.ledger, 'allocation.tmp'));
  assert.equal(envelope(ws, 'api').code, 0, 'once the lock is gone, the same call goes through');
});

test('dispatch entry: create-entry needs a chain naming the run and node, and one entry per node', (t) => {
  const ws = workspace(t);
  const bare = ledger(ws, 'create-entry');
  assert.equal(bare.code, 1);
  assert.equal(bare.report.errors[0].code, 'ledger-args-invalid');
  assert.match(bare.report.errors[0].message, /args\.chain/);

  const half = ledger(ws, 'create-entry', { chain: { run_id: RUN_ID } });
  assert.equal(half.report.errors[0].code, 'ledger-args-invalid');
  assert.match(half.report.errors[0].message, /args\.chain\.node/);
  assert.deepEqual(fs.readdirSync(path.join(ws.ledger, 'entries')), [], 'neither refusal wrote an entry');

  assert.equal(envelope(ws, 'api').code, 0);
  const second = ledger(ws, 'create-entry', { chain: { run_id: RUN_ID, node: 'api' } });
  assert.equal(second.code, 1);
  assert.equal(second.report.errors[0].code, 'ledger-entry-exists');
  assert.match(second.report.errors[0].message, /--dispatch-id=d-0001/);
  assert.deepEqual(fs.readdirSync(path.join(ws.ledger, 'entries')), ['d-0001.yml']);
});

test('dispatch entry: an entry recorded without a chain still reads and updates, and is never reused', (t) => {
  const ws = workspace(t);
  fs.writeFileSync(path.join(ws.ledger, 'entries', 'd-0001.yml'), [
    'version: 1', 'dispatch_id: d-0001', 'status: dispatched', 'grade: null',
    'created: 2026-01-05T09:00:00Z', 'updated: 2026-01-05T09:00:00Z',
    'constraints: []', 'followups: []', 'closeout: null',
  ].join('\n') + '\n');
  fs.appendFileSync(path.join(ws.ledger, 'ledger.log'), '2026-01-05T09:00:00Z create-entry d-0001 engine\n');

  assert.equal(ledger(ws, 'query', {}, 'd-0001').code, 0);
  assert.equal(ledger(ws, 'update-status', { status: 'in_progress' }, 'd-0001').code, 0);

  const built = envelope(ws, 'api');
  assert.equal(built.code, 0, JSON.stringify(built.report));
  assert.equal(built.report.dispatch_id, 'd-0002');

  // A driver that opened the chainless entry and hands its id in keeps working.
  fs.rmSync(published(ws, 'api'));
  const legacy = envelope(ws, 'web', { dispatch_id: 'd-0001' });
  assert.equal(legacy.code, 0, JSON.stringify(legacy.report));
  assert.equal(legacy.report.entry, 'existing');
});

test('dispatch entry: a publish that fails after the entry landed says so, and running the verb again completes it', (t) => {
  const ws = workspace(t);
  // A file where the dispatch directory belongs: the envelope cannot be written.
  fs.writeFileSync(path.join(ws.run, 'dispatch'), '');
  const failed = envelope(ws, 'api');
  assert.equal(failed.code, 1);
  assert.equal(failed.report.errors[0].code, 'dispatch-unwritable');
  assert.equal(failed.report.entry_written, true);
  assert.equal(ledger(ws, 'query', {}, 'd-0001').code, 0, 'the entry landed');

  fs.rmSync(path.join(ws.run, 'dispatch'));
  const retried = envelope(ws, 'api');
  assert.equal(retried.code, 0, JSON.stringify(retried.report));
  assert.equal(retried.report.dispatch_id, 'd-0001');
  assert.equal(retried.report.entry, 'existing');
  assert.equal(logLines(ws).length, 1, 'one creation, not two');
});
