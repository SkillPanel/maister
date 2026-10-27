import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freezePatch, scratch, verb } from '../helpers.mjs';
import { openerCommand, optedOut } from '../../plugins/maister/skills/workflow-engine/scripts/lib/open-dashboard.mjs';

/**
 * A fake opener: a Node script that appends the path it was given to a log, run
 * through the engine's test seam in place of the platform opener, so no test
 * ever starts a browser. The opener is detached, so its line is waited for.
 */
function fakeOpener(t, run) {
  const dir = fs.mkdtempSync(path.join(path.dirname(run.dir), 'opener-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'opener.mjs');
  const log = path.join(dir, 'opened.log');
  fs.writeFileSync(script, "import fs from 'node:fs';\nfs.appendFileSync(process.argv[2], `${process.argv[3]}\\n`);\n");
  return {
    env: { MAISTER_NO_OPEN: '', MAISTER_DASHBOARD_OPENER: JSON.stringify([process.execPath, script, log]) },
    async opened({ expect }) {
      // A detached child writes when it gets to it: wait for a line that is
      // expected — the file can exist before its line is written — and give one
      // that is not the same chance to appear.
      const deadline = Date.now() + (expect ? 10000 : 750);
      while (Date.now() < deadline) {
        if (expect && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('\n')) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    },
  };
}

/** Freeze a run with `orchestrator` and `args` on the freeze call, under `env`. */
function freezeWith(run, env, { orchestrator = {}, args = [] } = {}) {
  const { patch } = freezePatch({ orchestrator });
  const result = verb(['write-state', `--state=${run.state}`, ...args], patch, env);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

const viewer = run => path.join(run.dir, 'dashboard.html');

const CHAIN_ONLY = path.join(FIXTURES, 'definitions/chain-only.yml');

test('open-dashboard: a chain-only workflow started from the terminal is refused at the freeze and opens nothing', async t => {
  for (const [label, orchestrator] of [['a terminal driver', { driver: { kind: 'terminal' } }], ['no driver', {}]]) {
    const run = scratch(t, { name: `2026-01-08-chain-only-${label.replace(/\W+/g, '-')}` });
    const opener = fakeOpener(t, run);
    const { patch } = freezePatch({ definition: CHAIN_ONLY, orchestrator });
    const result = verb(['write-state', `--state=${run.state}`], patch, opener.env);
    assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^state-freeze-chain-only: "chain-only" runs as a step of a chain/m, label);
    assert.ok(!fs.existsSync(run.state), `${label}: no state is written`);
    assert.ok(!fs.existsSync(viewer(run)), `${label}: no dashboard is installed`);
    assert.doesNotMatch(result.stdout, /Maister run started/, `${label}: no banner`);
    assert.deepEqual(await opener.opened({ expect: false }), [], `${label}: the opener is never run`);
  }
});

test('open-dashboard: a chain-only workflow a chain dispatches freezes, and its cockpit run opens nothing', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  const { patch } = freezePatch({ definition: CHAIN_ONLY, orchestrator: { driver: { kind: 'cockpit', cwd: '/work', dispatch_id: 'd-1' } } });
  const result = verb(['write-state', `--state=${run.state}`], patch, opener.env);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.existsSync(viewer(run)));
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: an accepted terminal start still opens the dashboard exactly once', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env, { orchestrator: { driver: { kind: 'terminal' } } });
  const retried = verb(['write-state', `--state=${run.state}`], freezePatch({ orchestrator: { driver: { kind: 'terminal' } } }).patch, opener.env);
  assert.equal(retried.code, 0, retried.stderr);
  assert.deepEqual(await opener.opened({ expect: true }), [viewer(run)]);
  assert.deepEqual(await opener.opened({ expect: false }), [viewer(run)], 'a retried freeze opens nothing more');
});

test('open-dashboard: the freeze of a terminal run opens the dashboard once, by its absolute path', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env, { orchestrator: { driver: { kind: 'terminal' } } });
  assert.deepEqual(await opener.opened({ expect: true }), [viewer(run)]);
  assert.ok(path.isAbsolute(viewer(run)));
});

test('open-dashboard: a run with no driver block opens it as a terminal run does', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env);
  assert.deepEqual(await opener.opened({ expect: true }), [viewer(run)]);
});

test('open-dashboard: a later write-state opens nothing', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env);
  assert.equal((await opener.opened({ expect: true })).length, 1);
  const later = verb(['write-state', `--state=${run.state}`], { task: { title: 'Renamed run' } }, opener.env);
  assert.equal(later.code, 0, later.stderr);
  assert.equal((await opener.opened({ expect: false })).length, 1);
});

for (const [label, driver] of [
  ['a cockpit', { kind: 'cockpit', cwd: '/work', session: 's-1' }],
  ['a dispatch', { kind: 'dispatch', cwd: '/work' }],
]) {
  test(`open-dashboard: the freeze of ${label} run opens nothing`, async t => {
    const run = scratch(t);
    const opener = fakeOpener(t, run);
    freezeWith(run, opener.env, { orchestrator: { driver } });
    assert.ok(fs.existsSync(viewer(run)), 'the viewer is still installed');
    assert.deepEqual(await opener.opened({ expect: false }), []);
  });
}

test('open-dashboard: a run with html_output off opens nothing', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env, { orchestrator: { options: { html_output: false } } });
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: --no-open on the freeze opens nothing', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, opener.env, { args: ['--no-open'] });
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: MAISTER_NO_OPEN opens nothing', async t => {
  const run = scratch(t);
  const opener = fakeOpener(t, run);
  freezeWith(run, { ...opener.env, MAISTER_NO_OPEN: '1' });
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: an opener that cannot start prints the path, and the freeze still succeeds', t => {
  const run = scratch(t);
  const missing = path.join(path.dirname(run.dir), 'no-such-opener');
  const result = freezeWith(run, { MAISTER_NO_OPEN: '', MAISTER_DASHBOARD_OPENER: JSON.stringify([missing]) });
  const lines = result.stderr.split('\n').filter(line => line.includes('did not open'));
  assert.equal(lines.length, 1, result.stderr);
  assert.match(lines[0], /^warning: the dashboard did not open \(/);
  assert.ok(lines[0].includes(viewer(run)), lines[0]);
  assert.match(result.stdout, /^Maister run started/m, 'the banner is printed as before');
});

test('open-dashboard: resume-check opens the dashboard of the run it accepts', async t => {
  const run = scratch(t);
  freezeWith(run, {});
  const opener = fakeOpener(t, run);
  const result = verb(['resume-check', `--state=${run.state}`], undefined, opener.env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.deepEqual(await opener.opened({ expect: true }), [viewer(run)]);
});

test('open-dashboard: resume-check --no-open, a cockpit run and a missing page open nothing', async t => {
  const plain = scratch(t);
  freezeWith(plain, {});
  const driven = scratch(t, { name: '2026-01-06-driven' });
  freezeWith(driven, {}, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work', session: 's-1' } } });
  const gone = scratch(t, { name: '2026-01-07-gone' });
  freezeWith(gone, {});
  fs.rmSync(viewer(gone));
  const opener = fakeOpener(t, plain);
  for (const [run, args] of [[plain, ['--no-open']], [driven, []], [gone, []]]) {
    const result = verb(['resume-check', `--state=${run.state}`, ...args], undefined, opener.env);
    assert.equal(result.code, 0, result.stderr);
  }
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: a refused resume-check opens nothing', async t => {
  const run = scratch(t, { fixture: 'prose-2x' });
  const opener = fakeOpener(t, run);
  const result = verb(['resume-check', `--state=${run.state}`], undefined, opener.env);
  assert.equal(result.code, 1);
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-dashboard: each platform opens the plain absolute path', () => {
  const file = '/runs/My Task/dashboard.html';
  assert.deepEqual(openerCommand(file, 'darwin'), { command: 'open', args: [file], options: {} });
  assert.deepEqual(openerCommand(file, 'linux'), { command: 'xdg-open', args: [file], options: {} });
  assert.deepEqual(openerCommand(file, 'freebsd'), { command: 'xdg-open', args: [file], options: {} });
  const windows = 'C:\\runs\\My Task\\dashboard.html';
  assert.deepEqual(openerCommand(windows, 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '""', `"${windows}"`],
    options: { windowsVerbatimArguments: true },
  });
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.ok(!openerCommand(file, platform).args.some(arg => arg.includes('file:')), platform);
  }
});

test('open-dashboard: the environment opts out with any value but empty or 0', () => {
  assert.equal(optedOut({}), false);
  assert.equal(optedOut({ MAISTER_NO_OPEN: '' }), false);
  assert.equal(optedOut({ MAISTER_NO_OPEN: '0' }), false);
  assert.equal(optedOut({ MAISTER_NO_OPEN: '1' }), true);
  assert.equal(optedOut({ MAISTER_NO_OPEN: 'yes' }), true);
});
