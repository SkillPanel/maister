import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, umbrella } from '../helpers.mjs';

const UMBRELLA_INPUT_FILE = '.umbrella-input.json';

// The umbrella verbs that take a structured document — envelope, ledger and
// outbox — read it from one fixed file as well as from stdin, for the reason
// the engine's patch file exists: a JSON heredoc is the command shape an agent
// host's shell-safety checks refuse. The file route has to land what stdin
// lands, read from nowhere else, leave the file behind exactly when the verb
// refused, and never place two concurrent callers on one path.

/**
 * A scratch workspace as `init` scaffolds it, with one member, a one-node chain
 * dispatching into it, and runs frozen from that chain on demand.
 */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'repos/alpha'), { recursive: true });
  const init = umbrella(['init', `--root=${root}`, '--members-root=repos']);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}', 'members:\n  alpha: {path: repos/alpha, kind: repo}'));
  const definition = path.join(root, '.maister/workflows/chain.yml');
  fs.writeFileSync(definition, 'name: chain\nversion: 1\nnodes:\n  build:\n    uses: workflow:plan\n    dir: alpha\n    provider: claude\n    needs: []\n');
  const umbrellaId = /^umbrella_id: (\S+)$/m.exec(fs.readFileSync(manifest, 'utf8'))[1];
  return {
    root,
    umbrellaId,
    ledger: path.join(root, '.maister/umbrella/ledger'),
    outbox: path.join(root, '.maister/umbrella/outbox'),
    run(name = '2026-01-05-chain') {
      const dir = path.join(root, '.maister/umbrella/runs', name);
      fs.mkdirSync(dir, { recursive: true });
      freeze({ state: path.join(dir, 'orchestrator-state.yml') }, { definition });
      return { dir, input: path.join(dir, 'dispatch', UMBRELLA_INPUT_FILE) };
    },
  };
}

/** Write a document to an input file, creating its directory as a file tool does. */
function put(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof document === 'string' ? document : JSON.stringify(document));
}

/** Text with the workspace root, the clock and the workspace id taken out. */
function neutral(text, ws) {
  return text.replaceAll(ws.root, '<root>').replaceAll(ws.umbrellaId, '<id>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<t>');
}

/** Every file under a directory, neutralised, the input file excepted. */
function snapshot(dir, ws) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name === UMBRELLA_INPUT_FILE) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file)] = neutral(fs.readFileSync(file, 'utf8'), ws);
  }
  return files;
}

/** One call made both ways — on stdin in `a`, through the input file in `b` — compared whole. */
function assertSame(piped, filed, a, b) {
  assert.equal(filed.code, piped.code, filed.stderr);
  assert.equal(neutral(filed.stdout, b), neutral(piped.stdout, a));
  assert.equal(neutral(filed.stderr, b), neutral(piped.stderr, a));
}

const outboxInput = (ws, id = 'd-0001') => path.join(ws.outbox, id, UMBRELLA_INPUT_FILE);
const outboxArgs = (ws, type = 'closeout', id = 'd-0001') => ['outbox', `--outbox=${ws.outbox}`, `--dispatch-id=${id}`, `--type=${type}`];
const closeout = { grade: 'success', summary: 'Built: $HOME, `ticks`, a | b & c; {braces} <angles>', commits: ['abc123'], prs: [] };

test('input file: an outbox message lands exactly what stdin lands, and the file is deleted', t => {
  const a = workspace(t);
  const b = workspace(t);
  const piped = umbrella(outboxArgs(a), closeout);
  put(outboxInput(b), closeout);
  const filed = umbrella([...outboxArgs(b), `--input-file=${outboxInput(b)}`]);
  assert.equal(filed.code, 0, filed.stderr);
  assertSame(piped, filed, a, b);
  assert.deepEqual(snapshot(b.outbox, b), snapshot(a.outbox, a));
  assert.equal(fs.existsSync(outboxInput(b)), false);
});

test('input file: kept when the outbox refuses the message, and nothing is published', t => {
  const ws = workspace(t);
  put(outboxInput(ws), { summary: 'no grade' });
  const refused = umbrella([...outboxArgs(ws), `--input-file=${outboxInput(ws)}`]);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /outbox-message-invalid/);
  assert.equal(fs.existsSync(outboxInput(ws)), true, 'a refused message stays for the caller to correct and re-send');
  assert.deepEqual(fs.readdirSync(path.dirname(outboxInput(ws))), [UMBRELLA_INPUT_FILE]);

  put(outboxInput(ws), closeout);
  assert.equal(umbrella([...outboxArgs(ws), `--input-file=${outboxInput(ws)}`]).code, 0, 'the corrected file, sent again, lands');
  assert.equal(fs.existsSync(outboxInput(ws)), false);
});

test('input file: kept when it is not JSON, empty or not an object — usage, nothing ran', t => {
  const ws = workspace(t);
  for (const [text, message] of [['{"grade": ', /is not JSON/], ['  \n', /is empty/], ['[1]', /must be a JSON object/]]) {
    put(outboxInput(ws), text);
    const result = umbrella([...outboxArgs(ws), `--input-file=${outboxInput(ws)}`]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^usage: the input in .*\.umbrella-input\.json /);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(outboxInput(ws)), true);
  }
});

test('input file: stdin is not read when the flag is given', t => {
  const ws = workspace(t);
  put(outboxInput(ws), closeout);
  const result = umbrella([...outboxArgs(ws), `--input-file=${outboxInput(ws)}`], 'not json at all');
  assert.equal(result.code, 0, result.stderr);
});

test('input file: read only from the dispatch directory it names — every other place is usage', t => {
  const ws = workspace(t);
  put(outboxInput(ws, 'd-0002'), closeout);
  put(path.join(ws.outbox, UMBRELLA_INPUT_FILE), closeout);
  put(path.join(ws.outbox, 'd-0001', 'input.json'), closeout);
  for (const [given, message] of [
    [path.join(ws.outbox, UMBRELLA_INPUT_FILE), /must be .*d-0001.*\.umbrella-input\.json, in the directory of the dispatch/],
    [outboxInput(ws, 'd-0002'), /must be .*d-0001/],
    [path.join(ws.outbox, 'd-0001', 'input.json'), /must be /],
    [`${ws.outbox}/d-0002/../d-0001/${UMBRELLA_INPUT_FILE}`, /parent directory/],
    [outboxInput(ws), /could not be read/],
  ]) {
    const result = umbrella([...outboxArgs(ws), `--input-file=${given}`]);
    assert.equal(result.code, 2, given);
    assert.match(result.stderr, /^usage: the input file /);
    assert.match(result.stderr, message);
  }
  const traversal = umbrella([...outboxArgs(ws, 'closeout', '../d-0002'), `--input-file=${outboxInput(ws, 'd-0002')}`]);
  assert.equal(traversal.code, 2);
  assert.match(traversal.stderr, /^usage: the dispatch id "\.\.\/d-0002" cannot name the dispatch directory/);
  assert.equal(fs.readdirSync(path.join(ws.outbox, 'd-0002')).length, 1, 'nothing was read from or published to another dispatch');
});

test('input file: a link at the name is refused and its target survives', t => {
  const ws = workspace(t);
  const target = outboxInput(ws, 'd-0002');
  put(target, closeout);
  fs.mkdirSync(path.dirname(outboxInput(ws)), { recursive: true });
  fs.symlinkSync(target, outboxInput(ws));
  const result = umbrella([...outboxArgs(ws), `--input-file=${outboxInput(ws)}`]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /is a symbolic link/);
  assert.equal(fs.existsSync(target), true, 'a link target is never deleted');
});

test('input file: ledger ops land exactly what stdin lands, anchored in the calling run', t => {
  const a = workspace(t);
  const b = workspace(t);
  const runA = a.run();
  const runB = b.run();
  const ops = [
    [['--op=create-entry'], { chain: { run_id: '2026-01-05-chain', node: 'build' }, provider: 'claude' }],
    [['--op=update-status', '--dispatch-id=d-0001'], { status: 'in_progress' }],
  ];
  for (const [args, document] of ops) {
    const piped = umbrella(['ledger', `--ledger=${a.ledger}`, '--actor=engine', ...args], document);
    put(runB.input, document);
    const filed = umbrella(['ledger', `--ledger=${b.ledger}`, '--actor=engine', ...args, `--run=${runB.dir}`, `--input-file=${runB.input}`]);
    assert.equal(filed.code, 0, filed.stderr);
    assertSame(piped, filed, a, b);
    assert.equal(fs.existsSync(runB.input), false);
  }
  assert.deepEqual(snapshot(b.ledger, b), snapshot(a.ledger, a));
  assert.equal(runA.dir === runB.dir, false);
});

test('input file: two runs driving one ledger never share an input path', t => {
  const ws = workspace(t);
  const first = ws.run('2026-01-05-first');
  const second = ws.run('2026-01-05-second');
  assert.notEqual(first.input, second.input);

  // Both callers write before either calls — the interleaving a shared path
  // would turn into one run's arguments landing on the other's entry.
  put(first.input, { chain: { run_id: '2026-01-05-first', node: 'build' } });
  put(second.input, { chain: { run_id: '2026-01-05-second', node: 'build' } });
  const created = [first, second].map(run => umbrella(['ledger', `--ledger=${ws.ledger}`, '--op=create-entry', '--actor=engine', `--run=${run.dir}`, `--input-file=${run.input}`]));
  for (const result of created) assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(created.map(result => JSON.parse(result.stdout).entry.chain.run_id), ['2026-01-05-first', '2026-01-05-second']);
  assert.equal(fs.existsSync(first.input) || fs.existsSync(second.input), false);

  // And a run cannot read its input from the ledger directory every run shares.
  put(path.join(ws.ledger, UMBRELLA_INPUT_FILE), { chain: {} });
  const shared = umbrella(['ledger', `--ledger=${ws.ledger}`, '--op=create-entry', '--actor=engine', `--run=${first.dir}`, `--input-file=${path.join(ws.ledger, UMBRELLA_INPUT_FILE)}`]);
  assert.equal(shared.code, 2);
  assert.match(shared.stderr, /must be .*2026-01-05-first\/dispatch\/\.umbrella-input\.json, in the calling run's dispatch directory/);
});

test('input file: the ledger takes --run and --input-file together or not at all', t => {
  const ws = workspace(t);
  const run = ws.run();
  put(run.input, {});
  const alone = umbrella(['ledger', `--ledger=${ws.ledger}`, '--op=create-entry', '--actor=engine', `--input-file=${run.input}`]);
  assert.equal(alone.code, 2);
  assert.match(alone.stderr, /^usage: ledger reads --input-file from the calling run's dispatch directory, so it needs --run/);
  const idle = umbrella(['ledger', `--ledger=${ws.ledger}`, '--op=create-entry', '--actor=engine', `--run=${run.dir}`], {});
  assert.equal(idle.code, 2);
  assert.match(idle.stderr, /^usage: ledger takes --run only to place --input-file/);
  assert.equal(fs.existsSync(run.input), true);
});

test('input file: an envelope lands exactly what stdin lands, and a refusal keeps the file', t => {
  const a = workspace(t);
  const b = workspace(t);
  const runA = a.run();
  const runB = b.run();
  const flags = (ws, run) => ['envelope', `--run=${run.dir}`, '--node=build', `--ledger=${ws.ledger}`, `--root=${ws.root}`];
  const overrides = { dispatch_id: 'd-0042', statement: 'Build it: $HOME, `ticks`, a | b & c; {braces}' };

  const piped = umbrella(flags(a, runA), overrides);
  put(runB.input, overrides);
  const filed = umbrella([...flags(b, runB), `--input-file=${runB.input}`]);
  assert.equal(filed.code, 0, filed.stdout + filed.stderr);
  assertSame(piped, filed, a, b);
  assert.deepEqual(snapshot(runB.dir, b), snapshot(runA.dir, a));
  assert.equal(fs.existsSync(runB.input), false);

  const other = b.run('2026-01-05-other');
  put(other.input, { permissions: { allow: ['write'] } });
  const refused = umbrella([...flags(b, other), `--input-file=${other.input}`]);
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /dispatch-permissions-override-unsupported/);
  assert.equal(fs.existsSync(other.input), true);

  put(other.input, '');
  assert.equal(umbrella([...flags(b, other), `--input-file=${other.input}`]).code, 0, 'an empty file is no overrides, as empty stdin is');
  assert.equal(fs.existsSync(other.input), false);
});
