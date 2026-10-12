import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { ENGINE, freeze, readState, scratch, verb } from '../helpers.mjs';
import { readStdin } from '../../plugins/maister/skills/workflow-engine/scripts/lib/stdin.mjs';

// The engine reads a patch from stdin to its end, and never waits on it for
// ever: a terminal is never read, and a pipe that goes quiet without ending is
// refused after a short wait. A child blocked in a synchronous read of a pipe
// whose end never arrived once sat idle for hours under this suite; these
// tests hold the engine to the bound however the writer behaves.

const IDLE_MS = 300;
const PATCH = { node_summaries: { analysis: { summary: 'Read from stdin' } } };

/**
 * Run `write-state` with stdin a pipe this test holds open, writing `chunks`
 * and never ending it. Resolves with the exit code, the stderr and how long the
 * child took; a child still alive after `deadline` is killed and reported as
 * hung, so the test fails in seconds rather than waiting on it.
 */
function heldOpen(run, chunks, deadline = 5000) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [ENGINE, 'write-state', `--state=${run.state}`], {
      env: { ...process.env, MAISTER_STDIN_IDLE_MS: String(IDLE_MS) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.resume();
    for (const chunk of chunks) child.stdin.write(chunk);
    const timer = setTimeout(() => child.kill('SIGKILL'), deadline);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code, signal, stderr, elapsed: Date.now() - started });
    });
  });
}

test('a pipe that never ends is refused after the bound, never waited on', async t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = await heldOpen(run, []);
  assert.equal(result.signal, null, 'the child hung on stdin and was killed at the deadline');
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stderr, /^usage: the patch on stdin never ended \(0 bytes received/);
  assert.match(result.stderr, /<<< '<json>'/);
  assert.match(result.stderr, /--patch-file=<run>\/\.state-patch\.json/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
});

test('a patch whose end never arrives is refused, not applied', async t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const text = JSON.stringify(PATCH);
  const result = await heldOpen(run, [text]);
  assert.equal(result.signal, null, 'the child hung on stdin and was killed at the deadline');
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stderr, new RegExp(`never ended \\(${Buffer.byteLength(text)} bytes received`));
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');
});

test('a patch piped in lands, the same bytes as the patch file and the here-string', t => {
  const piped = scratch(t);
  freeze(piped);
  const result = verb(['write-state', `--state=${piped.state}`], PATCH);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readState(piped).node_summaries.analysis.summary, 'Read from stdin');

  const filed = scratch(t);
  freeze(filed);
  const file = path.join(filed.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(PATCH));
  assert.equal(verb(['write-state', `--state=${filed.state}`, `--patch-file=${file}`]).code, 0);
  assert.equal(stripClock(fs.readFileSync(filed.state, 'utf8')), stripClock(fs.readFileSync(piped.state, 'utf8')));

  const bash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
  if (!bash) return t.diagnostic('bash is not available: the here-string is not checked');
  const strung = scratch(t);
  freeze(strung);
  const here = spawnSync('bash', ['-c', `"$0" "$1" write-state "--state=$2" <<< '${JSON.stringify(PATCH)}'`, process.execPath, ENGINE, strung.state],
    { encoding: 'utf8', env: { ...process.env, MAISTER_STDIN_IDLE_MS: '5000' }, timeout: 30000 });
  assert.equal(here.status, 0, here.stderr);
  assert.equal(stripClock(fs.readFileSync(strung.state, 'utf8')), stripClock(fs.readFileSync(piped.state, 'utf8')));
});

test('an empty pipe that closes is refused as empty, as before', t => {
  const run = scratch(t);
  freeze(run);
  const result = verb(['write-state', `--state=${run.state}`], '');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: the patch on stdin is empty$/m);
});

test('a terminal on stdin is refused at once and never read', t => {
  const run = scratch(t);
  freeze(run);
  // `script` gives the child a pseudo-terminal; its argument order differs
  // between the BSD and util-linux builds, and Windows has neither. Its own
  // stdin is /dev/null, which it needs to start without a terminal of its own.
  const under = command => (process.platform === 'darwin' ? ['-q', '/dev/null', 'sh', '-c', command] : ['-qec', command, '/dev/null']);
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, killSignal: 'SIGKILL' };
  const probe = spawnSync('script', under('test -t 0'), options);
  if (probe.status !== 0) return t.skip('script cannot give the child a terminal here');
  const result = spawnSync('script', under(`"${process.execPath}" "${ENGINE}" write-state "--state=${run.state}"`), options);
  assert.equal(result.error, undefined, 'the child waited on the terminal');
  assert.match(result.stdout, /usage: the patch was not given: stdin is a terminal/);
});

test('readStdin never reads a terminal', async () => {
  const stream = new PassThrough();
  stream.isTTY = true;
  assert.deepEqual(await readStdin({ stream, idleMs: IDLE_MS }), { refused: 'tty', bytes: 0 });
  assert.equal(stream.listenerCount('data'), 0);
});

test('readStdin decodes a character split across chunks as one read would', async () => {
  const text = JSON.stringify({ summary: 'zażółć — ✓' });
  const bytes = Buffer.from(text, 'utf8');
  const stream = new PassThrough();
  const reading = readStdin({ stream, idleMs: IDLE_MS });
  for (let i = 0; i < bytes.length; i += 3) stream.write(bytes.subarray(i, i + 3));
  stream.end();
  assert.deepEqual(await reading, { text });
});

test('readStdin waits as long as bytes keep arriving', async () => {
  const stream = new PassThrough();
  const reading = readStdin({ stream, idleMs: IDLE_MS });
  for (const part of ['{"a":', '1', '}']) {
    await new Promise(resolve => setTimeout(resolve, IDLE_MS / 2));
    stream.write(part);
  }
  stream.end();
  assert.deepEqual(await reading, { text: '{"a":1}' });
});

/** The state without the writer's clock stamps, which differ between two writes. */
function stripClock(text) {
  return text.replace(/"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z"/g, '<clock>');
}
