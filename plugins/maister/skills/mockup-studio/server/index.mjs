/**
 * The mockup companion: a read-only viewer over one mockup folder, started for
 * a turn's look pass and stopped when the turn ends.
 *
 *   node <path to this file> start --root=<task_path>/<subdir>
 *   node <path to this file> stop --root=<task_path>/<subdir>
 *
 * Exec form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 *
 * It renders nothing and writes nothing but its own pid file. The pages, the
 * galleries and every manifest are written by the turn's scripts before the
 * viewer opens them; the viewer only serves the files already under the root.
 *
 * `start` reuses a live server for the same root, or starts one in the
 * background and returns once it listens. Before binding, a `.companion.pid`
 * in the root is read: when it names a live process whose `/status` reports
 * this same root, that server's port is printed and nothing starts. Any other
 * pid file — a dead process, another root's server, an unreadable file — is
 * replaced. A new server binds `127.0.0.1` only, on the first free port of
 * 3847–3850, writes `<root>/.companion.pid` (`{pid, port, root}`) atomically,
 * and exits by itself after 15 minutes without a request.
 *
 * `stop` reads the pid file, ends the process only when its `/status` reports
 * this root, waits for it to exit and removes the file. A pid file naming
 * anything else is removed and no process is touched. With no pid file there
 * is nothing to stop, which is not an error.
 *
 * `serve` is the background half of `start` and is started by it, never by a
 * caller.
 *
 * Routes, GET and HEAD only: `/status` → `{status: "ok", root, port, pid}`;
 * `/` → a redirect to `versions/<latest>/index.html`, `latest` read from
 * `versions/index.json`; any other path → the file at that path under the
 * root. A path that leaves the root, holds a dot segment or names a dot-file
 * gets 404, and so does a directory. Any other method gets 405. A request
 * whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` gets 403, which
 * keeps a page on another site from reading the folder through the browser.
 *
 * Output: one JSON line on stdout.
 *   start → {ok: true, port, url, root}
 *   stop  → {ok: true, root, stopped: true, pid, port} or {ok: true, root, stopped: false}
 *
 * Exit codes: 0 success, the JSON result on stdout; 1 refusal, `{ok: false,
 * code, message}` on stdout and nothing started; 2 usage or an unexpected
 * error, a message on stderr.
 *
 * Refusals owned: `root-missing` (the root is not a directory), `ports-busy`
 * (3847–3850 are all taken), `folder-unwritable` (the pid file could not be
 * written; the server that could not record itself has already exited).
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { commit, Refusal } from '../../../lib/canonical.mjs';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const PORTS = [3847, 3848, 3849, 3850];
const HOST = '127.0.0.1';
const PID_FILE = '.companion.pid';
const IDLE_MS = 15 * 60 * 1000;
/** Read by this script only: a test sets it so the idle exit is not waited for. */
const IDLE_ENV = 'MAISTER_COMPANION_IDLE_MS';
const READY_MS = 10_000;
const STATUS_MS = 1500;
const STOP_MS = 5000;

const WRITE_CODES = { unwritable: 'mockup-unwritable', tempExists: 'mockup-temp-exists' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

class UsageError extends Error {}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (!['start', 'stop', 'serve'].includes(verb)) {
    throw new UsageError(verb === undefined ? 'a verb is required: start or stop' : `unknown verb "${verb}": use start or stop`);
  }
  const flags = {};
  for (const arg of rest) {
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (name !== 'root') throw new UsageError(`unknown flag --${name}`);
    if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
    const value = eq >= 0 ? arg.slice(eq + 1) : '';
    if (value === '') throw new UsageError(`the flag --${name} needs a value: --${name}=<dir>`);
    flags[name] = value;
  }
  if (!flags.root) throw new UsageError('--root=<dir> is required');
  return { verb, root: flags.root };
}

/** The root as one canonical absolute path, so `/status.root` compares byte for byte. */
function canonicalRoot(raw) {
  try {
    const real = fs.realpathSync(path.resolve(raw));
    if (fs.statSync(real).isDirectory()) return real;
  } catch {
    // falls through to the refusal
  }
  throw new Refusal('root-missing',
    `${raw} is not a directory, so there is nothing to serve. Nothing was started; run the turn's begin first, or pass the folder that holds versions/.`);
}

function readPidFile(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, PID_FILE), 'utf8'));
    if (Number.isInteger(data?.pid) && Number.isInteger(data?.port)) return data;
  } catch {
    // missing or unreadable: no server is recorded
  }
  return null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** `/status` of whatever listens on `port`, or null. */
function status(port) {
  return new Promise(resolve => {
    const req = http.get({ host: HOST, port, path: '/status', agent: false, headers: { host: `${HOST}:${port}` }, timeout: STATUS_MS }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** The server a pid file names, when it is live and serves exactly this root. */
async function liveServer(root) {
  const recorded = readPidFile(root);
  if (!recorded || !alive(recorded.pid)) return null;
  const answer = await status(recorded.port);
  if (answer?.root !== root || answer?.pid !== recorded.pid) return null;
  return recorded;
}

function urlOf(port) {
  return `http://${HOST}:${port}/`;
}

async function start(rawRoot) {
  const root = canonicalRoot(rawRoot);
  const live = await liveServer(root);
  if (live) return { ok: true, port: live.port, url: urlOf(live.port), root };

  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [script, 'serve', `--root=${root}`], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });

  const outcome = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ timeout: true }), READY_MS);
    child.once('message', message => { clearTimeout(timer); resolve(message); });
    child.once('exit', code => { clearTimeout(timer); resolve({ exited: code }); });
    child.once('error', err => { clearTimeout(timer); resolve({ error: err.message }); });
  });

  if (outcome.ok) {
    child.disconnect();
    child.unref();
    return { ok: true, port: outcome.port, url: urlOf(outcome.port), root };
  }
  if (outcome.timeout) {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    throw new Error(`the companion did not report listening within ${READY_MS} ms and was ended`);
  }
  if (outcome.code) throw new Refusal(outcome.code, outcome.message);
  throw new Error(outcome.error ?? `the companion exited with code ${outcome.exited} before it listened`);
}

async function stop(rawRoot) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(rawRoot));
  } catch {
    return { ok: true, root: path.resolve(rawRoot), stopped: false };
  }
  const recorded = readPidFile(root);
  const pidPath = path.join(root, PID_FILE);
  const live = await liveServer(root);
  if (!live) {
    // A pid file that names no server of this root is stale: drop it, end nothing.
    fs.rmSync(pidPath, { force: true });
    return { ok: true, root, stopped: false };
  }
  try {
    process.kill(live.pid, 'SIGTERM');
  } catch {
    // it exited between the check and the signal
  }
  const end = Date.now() + STOP_MS;
  while (alive(live.pid) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
  if (alive(live.pid)) {
    try {
      process.kill(live.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  if (readPidFile(root)?.pid === recorded.pid) fs.rmSync(pidPath, { force: true });
  return { ok: true, root, stopped: true, pid: live.pid, port: live.port };
}

/** The request path as root-relative segments, or null when it must not be served. */
function segmentsOf(rawUrl) {
  const pathname = rawUrl.split(/[?#]/, 1)[0];
  if (!pathname.startsWith('/')) return null;
  const segments = [];
  for (const raw of pathname.split('/').slice(1)) {
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '') continue;
    if (segment.startsWith('.') || /[/\\\0]/.test(segment) || segment.includes(':')) return null;
    segments.push(segment);
  }
  return segments;
}

function latestGallery(root) {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(root, 'versions', 'index.json'), 'utf8'));
    if (typeof index?.latest === 'string' && /^v\d{3,}$/.test(index.latest)) return `/versions/${index.latest}/index.html`;
  } catch {
    // no published version yet
  }
  return null;
}

/** The file a request names, proved to sit under the root after links are followed. */
function fileUnder(root, segments) {
  if (segments.length === 0) return null;
  const candidate = path.join(root, ...segments);
  try {
    const real = fs.realpathSync(candidate);
    if (!real.startsWith(root + path.sep)) return null;
    if (path.relative(root, real).split(path.sep).some(part => part.startsWith('.'))) return null;
    const stat = fs.statSync(real);
    return stat.isFile() ? { file: real, size: stat.size } : null;
  } catch {
    return null;
  }
}

function send(req, res, code, body, headers = {}) {
  const payload = Buffer.from(body);
  res.writeHead(code, {
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function serve(rawRoot) {
  const root = canonicalRoot(rawRoot);
  const idleMs = Number.parseInt(process.env[IDLE_ENV] ?? '', 10) > 0 ? Number.parseInt(process.env[IDLE_ENV], 10) : IDLE_MS;
  const report = message => {
    if (process.connected) process.send(message, () => process.disconnect());
  };
  let port = null;
  let idle = null;

  const shutdown = () => {
    if (readPidFile(root)?.pid === process.pid) fs.rmSync(path.join(root, PID_FILE), { force: true });
    process.exit(0);
  };
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(shutdown, idleMs);
  };

  const server = http.createServer((req, res) => {
    touch();
    const host = String(req.headers.host ?? '').toLowerCase();
    if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
      send(req, res, 403, 'forbidden: this viewer answers only to 127.0.0.1 or localhost on its own port\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, 'method not allowed: the viewer is read-only\n', { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      return;
    }
    const segments = segmentsOf(req.url ?? '');
    if (segments === null) {
      send(req, res, 404, 'not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const joined = segments.join('/');
    if (joined === 'status') {
      send(req, res, 200, JSON.stringify({ status: 'ok', root, port, pid: process.pid }), { 'Content-Type': 'application/json; charset=utf-8' });
      return;
    }
    if (joined === '') {
      const target = latestGallery(root);
      if (target) send(req, res, 302, '', { Location: target });
      else send(req, res, 404, 'no published version yet: versions/index.json names no latest\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const found = fileUnder(root, segments);
    if (!found) {
      send(req, res, 404, 'not found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': found.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
  });

  const listen = at => new Promise((resolve, reject) => {
    const onError = err => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(at, HOST);
  });

  (async () => {
    for (const at of PORTS) {
      try {
        await listen(at);
        port = at;
        break;
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (port === null) {
      report({ ok: false, code: 'ports-busy',
        message: `ports ${PORTS[0]}–${PORTS[PORTS.length - 1]} are all in use, so no viewer started. Nothing was written; open the pages by path instead, or stop a companion left running by another turn with stop --root=<its folder>.` });
      process.exitCode = EXIT.REFUSED;
      return;
    }
    try {
      commit({
        target: path.join(root, PID_FILE),
        tmp: path.join(root, `${PID_FILE}.tmp`),
        text: `${JSON.stringify({ pid: process.pid, port, root })}\n`,
        codes: WRITE_CODES,
      });
    } catch (err) {
      server.close();
      report({ ok: false, code: 'folder-unwritable',
        message: `the viewer listened but could not record itself in ${path.join(root, PID_FILE)} (${err.message}), so it was ended. Nothing was left running; make the folder writable and run start again.` });
      process.exitCode = EXIT.REFUSED;
      return;
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    touch();
    report({ ok: true, port });
  })().catch(err => {
    report({ ok: false, error: err.message });
    process.exit(EXIT.INTERNAL);
  });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`usage: node index.mjs start|stop --root=<dir> — ${err.message}\n`);
      process.exit(EXIT.INTERNAL);
    }
    throw err;
  }
  try {
    if (args.verb === 'serve') {
      serve(args.root);
      return;
    }
    const result = args.verb === 'start' ? await start(args.root) : await stop(args.root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(EXIT.OK);
  } catch (err) {
    if (err instanceof Refusal) {
      const message = err.message.slice(err.code.length + 2);
      process.stdout.write(`${JSON.stringify({ ok: false, code: err.code, message })}\n`);
      process.exit(EXIT.REFUSED);
    }
    process.stderr.write(`the companion could not run: ${err.message}\n`);
    process.exit(EXIT.INTERNAL);
  }
}

main();
