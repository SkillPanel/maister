import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';
import { openerCommand } from '../../plugins/maister/lib/open-file.mjs';

// A published html turn opens its gallery for a person at the terminal. Every
// opener here is a fake run through the test seam, so no test starts a browser.

const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');
const SUBDIR = 'analysis/mockups';
const STATE = 'orchestrator-state.yml';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-mockup-open-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = path.join(root, '.maister', 'tasks', 'development', '2026-01-01-task');
  fs.mkdirSync(task, { recursive: true });
  return { root, task };
}

/** A fake opener that appends the path it was given to a log. */
function fakeOpener(t, where) {
  const script = path.join(where.root, 'opener.mjs');
  const log = path.join(where.root, 'opened.log');
  fs.writeFileSync(script, "import fs from 'node:fs';\nfs.appendFileSync(process.argv[2], `${JSON.stringify(process.argv.slice(3))}\\n`);\n");
  return {
    env: { MAISTER_NO_OPEN: '', MAISTER_OPENER: JSON.stringify([process.execPath, script, log]) },
    async opened({ expect }) {
      // The opener is detached, so its line is waited for; one that should not
      // appear gets the same chance to.
      const deadline = Date.now() + (expect ? 10000 : 750);
      while (Date.now() < deadline) {
        if (expect && fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('\n')) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    },
  };
}

function state(dir, driverLines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATE), `orchestrator:\n  started: "2026-01-01"\n${driverLines}`);
}

/** One whole turn under `env`; returns finish's child result. */
function wholeTurn(where, env, { format = 'html', finish = [], taskPath = where.task } = {}) {
  const verb = (name, args) => run(TURN, [name, `--task-path=${taskPath}`, ...args], undefined, env, where.root);
  const started = verb('begin', []);
  assert.equal(started.code, 0, started.stdout + started.stderr);
  const { version_dir: versionDir, version } = JSON.parse(started.stdout);
  const screens = format === 'ascii'
    ? [{ slug: 'board', title: 'Board', description: 'The board' }]
    : [{ title: 'Board', html: '<main>board</main>' }];
  if (format === 'ascii') fs.writeFileSync(path.join(versionDir, 'ascii-mockups.md'), '# Board\n');
  fs.writeFileSync(path.join(versionDir, '.turn.json'), JSON.stringify({
    note: 'a note', format, fidelity: 'sketch', grounding: { digest: null, stale: false }, screens,
  }));
  const finished = verb('finish', [`--version=${version}`, ...finish]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  return { finished, version };
}

const gallery = where => path.join(where.task, SUBDIR, 'versions', 'v001', 'index.html');

test('open-gallery: an html turn with no run opens the gallery once, by its absolute path', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  wholeTurn(where, opener.env);
  assert.deepEqual(await opener.opened({ expect: true }), [[gallery(where)]]);
});

test('open-gallery: a relative task path still opens the absolute gallery', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  wholeTurn(where, opener.env, { taskPath: path.relative(where.root, where.task) });
  const [[opened]] = await opener.opened({ expect: true });
  assert.ok(path.isAbsolute(opened), opened);
  assert.equal(fs.realpathSync(opened), fs.realpathSync(gallery(where)));
});

for (const [label, lines] of [
  ['a terminal driver', '  driver: {kind: terminal}\n'],
  ['a state with no driver block', ''],
]) {
  test(`open-gallery: a run under ${label} opens the gallery`, async t => {
    const where = project(t);
    const opener = fakeOpener(t, where);
    state(where.task, lines);
    wholeTurn(where, opener.env);
    assert.deepEqual(await opener.opened({ expect: true }), [[gallery(where)]]);
  });
}

for (const [label, lines] of [
  ['a cockpit driver', '  driver: {kind: cockpit, cwd: /work}\n'],
  ['a cockpit driver with a dispatch id', '  driver: {kind: cockpit, cwd: /work, dispatch_id: d-1}\n'],
  ['the legacy dispatch driver', '  driver: {kind: dispatch}\n'],
]) {
  test(`open-gallery: a run under ${label} opens nothing`, async t => {
    const where = project(t);
    const opener = fakeOpener(t, where);
    state(where.task, lines);
    wholeTurn(where, opener.env);
    assert.deepEqual(await opener.opened({ expect: false }), []);
  });
}

test('open-gallery: a state that cannot be read opens nothing, and the turn succeeds', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  fs.mkdirSync(path.join(where.task, STATE));
  wholeTurn(where, opener.env);
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-gallery: an ascii turn opens nothing', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  wholeTurn(where, opener.env, { format: 'ascii' });
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-gallery: a preview opens nothing, and the finish that follows opens once', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  const { finished, version } = wholeTurn(where, opener.env, { finish: ['--preview'] });
  assert.equal(JSON.parse(finished.stdout).preview, true);
  assert.deepEqual(await opener.opened({ expect: false }), []);

  const published = run(TURN, ['finish', `--task-path=${where.task}`, `--version=${version}`], undefined, opener.env, where.root);
  assert.equal(published.code, 0, published.stdout + published.stderr);
  assert.deepEqual(await opener.opened({ expect: true }), [[gallery(where)]]);
});

test('open-gallery: a refused second finish opens nothing more', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  const { version } = wholeTurn(where, opener.env);
  await opener.opened({ expect: true });
  const again = run(TURN, ['finish', `--task-path=${where.task}`, `--version=${version}`], undefined, opener.env, where.root);
  assert.equal(again.code, 1);
  assert.equal(JSON.parse(again.stdout).code, 'version-published');
  assert.equal((await opener.opened({ expect: false })).length, 1);
});

test('open-gallery: MAISTER_NO_OPEN opens nothing', async t => {
  const where = project(t);
  const opener = fakeOpener(t, where);
  wholeTurn(where, { ...opener.env, MAISTER_NO_OPEN: '1' });
  assert.deepEqual(await opener.opened({ expect: false }), []);
});

test('open-gallery: the run beside --record decides, not an earlier run in the task path', async t => {
  const driven = project(t);
  const shut = fakeOpener(t, driven);
  state(driven.task, '  driver: {kind: terminal}\n');
  const drivenRun = path.join(driven.root, 'run');
  state(drivenRun, '  driver: {kind: cockpit, cwd: /work}\n');
  wholeTurn(driven, shut.env, { finish: [`--record=${path.join(drivenRun, 'turn-result.json')}`] });
  assert.deepEqual(await shut.opened({ expect: false }), []);

  const watched = project(t);
  const open = fakeOpener(t, watched);
  state(watched.task, '  driver: {kind: cockpit, cwd: /work}\n');
  const watchedRun = path.join(watched.root, 'run');
  state(watchedRun, '  driver: {kind: terminal}\n');
  wholeTurn(watched, open.env, { finish: [`--record=${path.join(watchedRun, 'turn-result.json')}`] });
  assert.deepEqual(await open.opened({ expect: true }), [[gallery(watched)]]);
});

test('open-gallery: a failing opener leaves the result and exit code as they were', t => {
  const quiet = project(t);
  const baseline = wholeTurn(quiet, { MAISTER_NO_OPEN: '1' }).finished;
  const shape = result => {
    const { task_path: _taskPath, ...rest } = JSON.parse(result.stdout);
    return rest;
  };

  for (const opener of [
    [path.join(quiet.root, 'no-such-opener')],
    [process.execPath, '-e', 'process.exit(3)'],
    'not json',
  ]) {
    const where = project(t);
    const env = { MAISTER_NO_OPEN: '', MAISTER_OPENER: typeof opener === 'string' ? opener : JSON.stringify(opener) };
    const { finished } = wholeTurn(where, env);
    assert.equal(finished.code, baseline.code);
    assert.equal(finished.stderr, baseline.stderr);
    assert.deepEqual(shape(finished), shape(baseline));
  }
});

test('open-gallery: Windows opens through cmd with start\'s empty title', () => {
  const file = 'C:\\My Task\\analysis\\mockups\\versions\\v001\\index.html';
  assert.deepEqual(openerCommand(file, 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '""', `"${file}"`],
    options: { windowsVerbatimArguments: true },
  });
});
