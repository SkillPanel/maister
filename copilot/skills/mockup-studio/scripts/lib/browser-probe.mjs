/**
 * The shell browser tool the look pass can use, found by the two probes
 * `browser-tools.md` names: `"playwright-cli"` when an executable of that name
 * is on `PATH`, else `"npx playwright cli"` when `npx --no-install playwright
 * cli --help` exits 0, else null. A probe that fails reads as null and never
 * refuses.
 *
 * The npx probe runs at most once per process, and from the system's temp
 * folder, never the caller's: on Windows a folder cannot be removed while a
 * live process has it as its working directory. On a timeout nothing it started
 * outlives it: on Windows npx is a `.cmd` run by `cmd.exe`, and killing the
 * shell alone leaves npx running, so the whole tree goes with `taskkill /T`;
 * elsewhere the probe leads a process group of its own, and the group is killed.
 *
 * Opting out: `MAISTER_NO_NPX_PROBE` set to anything but empty or `0` skips the
 * npx probe, which then reads as null; the `PATH` scan still runs. The test
 * suite sets it, so no child of its starts npx.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. No stdio.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The environment variable that turns the npx probe off. */
export const NO_NPX_PROBE_ENV = 'MAISTER_NO_NPX_PROBE';

/** How long the npx probe may run before it and everything it started are killed. */
export const PROBE_TIMEOUT_MS = 15_000;

/** Whether the environment turns the npx probe off. */
export function npxProbeOptedOut(env = process.env) {
  const value = env[NO_NPX_PROBE_ENV];
  return typeof value === 'string' && value !== '' && value !== '0';
}

/** Whether `name` is an executable on `PATH`: a scan of its folders, no shell spawned. */
export function onPath(name, env = process.env, platform = process.platform) {
  const windows = platform === 'win32';
  const key = Object.keys(env).find(each => each.toUpperCase() === 'PATH');
  const dirs = String((key && env[key]) ?? '').split(path.delimiter).filter(Boolean);
  const exts = windows ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, `${name}${ext}`);
      try {
        if (!fs.statSync(file).isFile()) continue;
        if (!windows) fs.accessSync(file, fs.constants.X_OK);
        return true;
      } catch {
        // not here, or not executable
      }
    }
  }
  return false;
}

/** The npx probe's arguments. */
const NPX_ARGS = ['--no-install', 'playwright', 'cli', '--help'];

/**
 * The npx probe's command line on `platform`: `{command, args, options}` for
 * `spawn`. A shell only on Windows, where npx is a `.cmd`, given the whole line
 * as one string; a process group of its own elsewhere, so a timeout can kill
 * the group.
 */
export function npxProbeCommand(platform = process.platform, env = process.env) {
  const windows = platform === 'win32';
  return {
    command: windows ? ['npx', ...NPX_ARGS].join(' ') : 'npx',
    args: windows ? [] : NPX_ARGS,
    options: { cwd: os.tmpdir(), env, stdio: 'ignore', windowsHide: true, shell: windows, detached: !windows },
  };
}

/** Kill `child` and every process it started. Best effort: a tree already gone is no fault. */
export function killTree(child, platform = process.platform) {
  try {
    if (platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { cwd: os.tmpdir(), stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // already exited
  }
}

/** Run the npx probe once. Resolves to whether it exited 0 within `timeout`; never rejects. */
export function runNpxProbe({ env = process.env, platform = process.platform, timeout = PROBE_TIMEOUT_MS } = {}) {
  const line = npxProbeCommand(platform, env);
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(line.command, line.args, line.options);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      killTree(child, platform);
      child.unref();
      resolve(false);
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

let found;

/**
 * The shell browser tool, probed once per process: every later call resolves to
 * the first call's answer. `probe` is a seam for tests, run in place of the npx
 * probe.
 */
export function shellBrowser({ env = process.env, platform = process.platform, probe = runNpxProbe } = {}) {
  found ??= (async () => {
    if (onPath('playwright-cli', env, platform)) return 'playwright-cli';
    if (npxProbeOptedOut(env)) return null;
    try {
      return (await probe({ env, platform })) ? 'npx playwright cli' : null;
    } catch {
      return null;
    }
  })();
  return found;
}
