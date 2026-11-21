import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { ROOT, run } from '../helpers.mjs';

// The look pass's shell browser probe: `turn.mjs begin` reports `shell_browser`,
// and its npx probe must never hold the project folder, nor leave anything
// running when it times out, and runs once per process. The suite turns the npx
// probe off (`MAISTER_NO_NPX_PROBE`); the tests that want it lay '' over that.

const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');
const PROBE = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/lib/browser-probe.mjs');
const windows = process.platform === 'win32';

/** A fresh copy of the probe module, so its once-per-process answer starts empty. */
let copies = 0;
const freshProbe = () => import(`${pathToFileURL(PROBE).href}?copy=${copies += 1}`);

/** PATH replaced whole, under every spelling the parent carries. */
const pathEnv = dir => Object.fromEntries([...Object.keys(process.env).filter(key => key.toUpperCase() === 'PATH'), 'PATH'].map(key => [key, dir]));

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

/** A fake npx on its own folder that writes its working directory to `log` and exits 0. */
function fakeNpx(t, log) {
  const bin = scratch(t, 'maister-fake-npx-');
  if (windows) {
    fs.writeFileSync(path.join(bin, 'npx.cmd'), `@cd > "${log}"\r\n@exit /b 0\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\npwd -P > "${log}"\nexit 0\n`, { mode: 0o755 });
  }
  return bin;
}

function begin(t, env) {
  const root = scratch(t, 'maister-probe-project-');
  const task = path.join(root, '.maister', 'tasks', 'development', '2026-01-01-task');
  fs.mkdirSync(task, { recursive: true });
  const result = run(TURN, ['begin', `--task-path=${task}`], undefined, env, root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return { root, started: JSON.parse(result.stdout) };
}

test('browser probe: begin runs the npx probe from the temp folder, never the project', t => {
  const log = path.join(scratch(t, 'maister-probe-log-'), 'cwd.txt');
  const bin = fakeNpx(t, log);
  const { root, started } = begin(t, { ...pathEnv(bin), MAISTER_NO_NPX_PROBE: '' });
  assert.equal(started.shell_browser, 'npx playwright cli');
  const ran = fs.realpathSync(fs.readFileSync(log, 'utf8').trim());
  assert.equal(ran, fs.realpathSync(os.tmpdir()));
  assert.ok(!ran.startsWith(fs.realpathSync(root)), `the probe ran inside the project: ${ran}`);
});

test('browser probe: MAISTER_NO_NPX_PROBE starts no npx, and begin reports null', t => {
  const log = path.join(scratch(t, 'maister-probe-log-'), 'cwd.txt');
  const bin = fakeNpx(t, log);
  const { started } = begin(t, { ...pathEnv(bin), MAISTER_NO_NPX_PROBE: '1' });
  assert.equal(started.shell_browser, null);
  assert.equal(fs.existsSync(log), false, 'npx ran although the probe was turned off');
});

test('browser probe: the npx probe runs once per process', async () => {
  const { shellBrowser } = await freshProbe();
  let calls = 0;
  const probe = async () => { calls += 1; return true; };
  const env = { PATH: '' };
  assert.equal(await shellBrowser({ env, probe }), 'npx playwright cli');
  assert.equal(await shellBrowser({ env, probe }), 'npx playwright cli');
  assert.equal(calls, 1);
});

test('browser probe: the opt-out skips only the npx probe, and a tool on PATH still answers', async t => {
  const off = { MAISTER_NO_NPX_PROBE: '1' };
  const never = async () => assert.fail('the npx probe ran under the opt-out');
  assert.equal(await (await freshProbe()).shellBrowser({ env: { ...off, PATH: '' }, probe: never }), null);

  const bin = scratch(t, 'maister-fake-browser-');
  fs.writeFileSync(path.join(bin, windows ? 'playwright-cli.cmd' : 'playwright-cli'), windows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(await (await freshProbe()).shellBrowser({ env: { ...off, PATH: bin }, probe: never }), 'playwright-cli');

  const { npxProbeOptedOut } = await freshProbe();
  assert.equal(npxProbeOptedOut({}), false);
  assert.equal(npxProbeOptedOut({ MAISTER_NO_NPX_PROBE: '' }), false);
  assert.equal(npxProbeOptedOut({ MAISTER_NO_NPX_PROBE: '0' }), false);
  assert.equal(npxProbeOptedOut({ MAISTER_NO_NPX_PROBE: 'yes' }), true);
});

test('browser probe: the command runs from the temp folder, through a shell only on Windows', async () => {
  const { npxProbeCommand } = await freshProbe();
  for (const platform of ['win32', 'darwin', 'linux']) {
    const line = npxProbeCommand(platform, {});
    assert.equal([line.command, ...line.args].join(' '), 'npx --no-install playwright cli --help');
    assert.equal(line.options.cwd, os.tmpdir());
    assert.equal(line.options.shell, platform === 'win32');
    assert.equal(line.options.detached, platform !== 'win32');
  }
});

test('browser probe: a timed-out probe leaves nothing it started running', { skip: windows && 'the tree kill is taskkill on Windows, exercised by CI only' }, async t => {
  const dir = scratch(t, 'maister-probe-hang-');
  const pidFile = path.join(dir, 'grandchild.pid');
  fs.writeFileSync(path.join(dir, 'npx'), `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nwait\n`, { mode: 0o755 });
  const { runNpxProbe } = await freshProbe();
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
  const started = Date.now();
  assert.equal(await runNpxProbe({ env, timeout: 500 }), false);
  assert.ok(Date.now() - started < 5000, 'the probe waited past its timeout');
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let waited = 0; alive() && waited < 3000; waited += 50) await new Promise(done => setTimeout(done, 50));
  const survived = alive();
  if (survived) process.kill(pid, 'SIGKILL');
  assert.equal(survived, false, `the probe's own child ${pid} outlived the timeout`);
});
