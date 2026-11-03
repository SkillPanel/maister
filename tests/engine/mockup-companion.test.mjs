import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT, run } from '../helpers.mjs';

// The mockup companion, run the way a turn runs it: `start --root=<dir>` as a
// child process that returns once the server listens, then plain HTTP against
// it, then `stop --root=<dir>`. The server has a fixed port range, 3847–3850;
// a box where those ports are taken skips these tests with the reason rather
// than failing them. Every test stops what it started, and kills any server a
// failed assertion left behind, so no child outlives the file.

const SERVER = path.join(ROOT, 'plugins/maister/skills/mockup-studio/server/index.mjs');
const PORTS = [3847, 3848, 3849, 3850];
const PID_FILE = '.companion.pid';

/** Whether one port can be bound on the loopback address right now. */
function portFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

const FREE = (await Promise.all(PORTS.map(portFree))).filter(Boolean).length;
const busy = need => (FREE >= need ? false : `needs ${need} free port(s) in 3847–3850, found ${FREE}`);

/** A scratch mockup folder with one published version; removed (servers stopped first) when the test ends. */
function folder(t, rel = path.join('analysis', 'mockups')) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maister companion '));
  const root = path.join(base, rel);
  fs.mkdirSync(path.join(root, 'versions', 'v001'), { recursive: true });
  fs.writeFileSync(path.join(root, 'versions', 'index.json'), JSON.stringify({
    latest: 'v001', versions: [{ version: 'v001', created: '2026-01-01T00:00:00Z', note: '', parent: null, changed: ['home'] }],
  }));
  fs.writeFileSync(path.join(root, 'versions', 'v001', 'index.html'), '<!doctype html><title>v001</title>');
  fs.writeFileSync(path.join(root, 'home.html'), '<!doctype html><title>home</title>');
  fs.writeFileSync(path.join(root, '.mockups.json'), '{}');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside the root');
  t.after(() => {
    for (const dir of started.splice(0)) stopHard(dir);
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root };
}

const started = [];

function start(root, env = {}) {
  started.push(root);
  const result = run(SERVER, ['start', `--root=${root}`], undefined, env);
  return { ...result, json: parse(result.stdout) };
}

function stop(root) {
  const result = run(SERVER, ['stop', `--root=${root}`]);
  return { ...result, json: parse(result.stdout) };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readPid(root) {
  return parse(fs.readFileSync(path.join(root, PID_FILE), 'utf8'));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The cleanup path: the verb first, then a kill of whatever the pid file still names. */
function stopHard(root) {
  let pid = null;
  try {
    pid = readPid(root)?.pid ?? null;
  } catch {
    // no pid file left
  }
  run(SERVER, ['stop', `--root=${root}`]);
  if (pid && alive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

/** One raw request: the path is sent byte for byte, the Host header as given. */
function request(port, { method = 'GET', target = '/', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, agent: false, path: target, headers: { host } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('start prints {ok, port, url, root}, binds 127.0.0.1 only, and /status names the root', { skip: busy(1) }, async t => {
  const { root } = folder(t);
  const out = start(root);
  assert.equal(out.code, 0, out.stderr);
  const real = fs.realpathSync(root);
  assert.deepEqual(Object.keys(out.json).sort(), ['ok', 'port', 'root', 'url']);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.root, real);
  assert.ok(PORTS.includes(out.json.port));
  assert.equal(out.json.url, `http://127.0.0.1:${out.json.port}/`);

  const pidFile = readPid(root);
  assert.equal(pidFile.port, out.json.port);
  assert.equal(pidFile.root, real);
  assert.ok(alive(pidFile.pid));
  assert.deepEqual(fs.readdirSync(root).filter(name => name.includes('.tmp')), []);

  const status = await request(out.json.port, { target: '/status' });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { status: 'ok', root: real, port: out.json.port, pid: pidFile.pid });

  // Reachable on loopback under either name; not on any other local address.
  assert.equal((await request(out.json.port, { target: '/status', host: `localhost:${out.json.port}` })).status, 200);
  const external = Object.values(os.networkInterfaces()).flat()
    .find(each => each && each.family === 'IPv4' && !each.internal)?.address;
  if (external) {
    const reached = await new Promise(resolve => {
      const socket = net.connect({ host: external, port: out.json.port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    assert.equal(reached, false, `the server answered on ${external}`);
  }
});

test('a request whose Host is not the loopback address and port gets 403', { skip: busy(1) }, async t => {
  const { root } = folder(t);
  const { json } = start(root);
  for (const host of ['evil.example', `evil.example:${json.port}`, `127.0.0.1:${json.port + 100}`, `10.0.0.1:${json.port}`]) {
    const res = await request(json.port, { target: '/status', host });
    assert.equal(res.status, 403, host);
  }
});

test('traversal, dot segments and dot-files get 404; / redirects to the latest gallery', { skip: busy(1) }, async t => {
  const { root } = folder(t);
  const { json } = start(root);
  for (const target of [
    '/../secret.txt',
    '/versions/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/versions/%2E%2E/%2E%2E/secret.txt',
    '/..%2fsecret.txt',
    '/..%5csecret.txt',
    '/versions/./v001/index.html',
    '/.companion.pid',
    '/.mockups.json',
    '/versions/.lock',
    '/missing.html',
    '/versions',
  ]) {
    const res = await request(json.port, { target });
    assert.equal(res.status, 404, target);
    assert.doesNotMatch(res.body, /outside the root/, target);
  }

  const page = await request(json.port, { target: '/home.html' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /<title>home<\/title>/);
  const head = await request(json.port, { method: 'HEAD', target: '/versions/v001/index.html' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');

  const redirect = await request(json.port, { target: '/' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, '/versions/v001/index.html');
});

test('any method other than GET and HEAD gets 405, and nothing is written', { skip: busy(1) }, async t => {
  const { root } = folder(t);
  const { json } = start(root);
  const before = fs.readdirSync(root).sort();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const target of ['/', '/update', '/home.html', '/shutdown']) {
      const res = await request(json.port, { method, target });
      assert.equal(res.status, 405, `${method} ${target}`);
      assert.match(res.headers.allow, /GET/);
    }
  }
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  assert.ok(alive(readPid(root).pid), 'POST /shutdown must not stop the server');
});

test('stop ends the process and removes the pid file; an idle server exits on its own', { skip: busy(1) }, async t => {
  const { root } = folder(t);
  const { json } = start(root);
  const { pid } = readPid(root);

  const stopped = stop(root);
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.deepEqual(stopped.json, { ok: true, root: fs.realpathSync(root), stopped: true, pid, port: json.port });
  assert.ok(await until(() => !alive(pid)), 'the server process is still running');
  assert.equal(fs.existsSync(path.join(root, PID_FILE)), false);

  // Stopping again finds nothing to stop, and says so without failing.
  const again = stop(root);
  assert.equal(again.code, 0);
  assert.equal(again.json.stopped, false);

  // The idle seam: the same exit, on the server's own timer.
  start(root, { MAISTER_COMPANION_IDLE_MS: '300' });
  const idle = readPid(root).pid;
  assert.ok(await until(() => !alive(idle)), 'the idle server did not exit');
  assert.ok(await until(() => !fs.existsSync(path.join(root, PID_FILE))), 'the idle server left its pid file');
});

test('a live same-root server is reused, a stale pid file is replaced, a different subdir never reuses', { skip: busy(2) }, async t => {
  const { base, root } = folder(t);

  // Reuse: the second start prints the first server's port and starts nothing.
  const first = start(root);
  const firstPid = readPid(root).pid;
  const reused = start(root);
  assert.equal(reused.code, 0, reused.stderr);
  assert.deepEqual(reused.json, first.json);
  assert.equal(readPid(root).pid, firstPid);

  // A different subdir of the same task, holding a copy of that pid file: the
  // pid is live, but its /status names another root, so a new server starts.
  const other = path.join(base, 'analysis', 'design-context', 'mockups');
  fs.mkdirSync(other, { recursive: true });
  fs.copyFileSync(path.join(root, PID_FILE), path.join(other, PID_FILE));
  const second = start(other);
  assert.equal(second.code, 0, second.stderr);
  assert.notEqual(second.json.port, first.json.port);
  assert.equal(second.json.root, fs.realpathSync(other));
  assert.notEqual(readPid(other).pid, firstPid);
  assert.ok(alive(firstPid), 'starting another root must not end the first server');
  assert.equal(readPid(root).pid, firstPid);

  // Stale: a pid file naming a process that has exited is replaced.
  stop(other);
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(path.join(other, PID_FILE), JSON.stringify({ pid: gone, port: first.json.port, root: fs.realpathSync(other) }));
  const fresh = start(other);
  assert.equal(fresh.code, 0, fresh.stderr);
  const freshPid = readPid(other).pid;
  assert.notEqual(freshPid, gone);
  assert.ok(alive(freshPid));
  const status = JSON.parse((await request(fresh.json.port, { target: '/status' })).body);
  assert.equal(status.pid, freshPid);
  assert.equal(status.root, fs.realpathSync(other));
});

test('start refuses a missing root and busy ports, and a malformed flag is a usage error', async () => {
  const missing = path.join(os.tmpdir(), `maister-companion-missing-${process.pid}`);
  const refused = run(SERVER, ['start', `--root=${missing}`]);
  assert.equal(refused.code, 1);
  assert.equal(parse(refused.stdout).code, 'root-missing');
  assert.equal(fs.existsSync(missing), false);

  // Every port taken: refused, nothing left running, no pid file.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-companion-busy-'));
  const holders = [];
  try {
    for (const port of PORTS) {
      const holder = net.createServer();
      holder.once('error', () => {});
      holder.listen(port, '127.0.0.1');
      holders.push(holder);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    const crowded = run(SERVER, ['start', `--root=${base}`]);
    assert.equal(crowded.code, 1, crowded.stderr);
    assert.equal(parse(crowded.stdout).code, 'ports-busy');
    assert.equal(fs.existsSync(path.join(base, PID_FILE)), false);
  } finally {
    for (const holder of holders) holder.close();
    fs.rmSync(base, { recursive: true, force: true });
  }

  assert.equal(run(SERVER, ['start']).code, 2);
  assert.equal(run(SERVER, ['start', '--root']).code, 2);
  assert.equal(run(SERVER, ['start', '--root=x', '--port=1']).code, 2);
  assert.equal(run(SERVER, ['serve-forever', '--root=x']).code, 2);
});
