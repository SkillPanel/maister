import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, delegating, freeze, maskRoot, run as runScript, scratch, scratchPlugin, sibling, verb, write as writeState } from '../helpers.mjs';

// `gate-request --node` builds the driven request itself, as `gate-brief
// --request` prints it, and writes it in the same call, so the request never
// passes through the session. Pinned here: what lands on disk — the request
// file, the gate index, the state with its marker, the panel — is what the
// two-call form lands, byte for byte, for a gate, a gate asked again for a
// revise's note and a node's question set; a refused brief writes nothing.
//
// The request writer is not part of this edition. Where the plugin carries none,
// a stand-in takes its place in a scratch copy: it writes the document it is
// handed as JSON and sets the marker through the state writer, so equal files
// mean the writer was handed the same document. Where the plugin carries its
// own, that one runs and the clock it stamps is masked.

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');
const DISPATCH = { kind: 'dispatch', cwd: '/work' };
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const SINCE = '2026-01-05T09:00:00Z';

const STAND_IN = `import fs from 'node:fs';
import path from 'node:path';
import { writeState, pendingMarker } from './state.mjs';
import { parse } from './state-read.mjs';

export function gateRequest({ state, request }) {
  const gates = path.join(path.dirname(path.resolve(state)), 'gates');
  fs.mkdirSync(gates, { recursive: true });
  fs.writeFileSync(path.join(gates, request.node + '.request.yml'), JSON.stringify(request, null, 2) + '\\n');
  fs.writeFileSync(path.join(gates, 'index.yml'), 'gates: [' + request.node + ']\\n');
  const doc = parse(fs.readFileSync(state, 'utf8'));
  const marker = writeState({ state, patch: {
    orchestrator: { gate_pending: pendingMarker({ node: request.node, since: '${SINCE}', doc, session: null }) },
    nodes: { [request.node]: { status: 'suspended' } },
  } });
  if (!marker.ok) return { ok: false, changed: [], errors: marker.errors };
  return { ok: true, changed: ['gates/' + request.node + '.request.yml', 'gates/index.yml', 'orchestrator-state.yml'], errors: [] };
}
`;

/** A scratch plugin whose engine can suspend: its own request writer, else the stand-in. */
function suspendingEngine(t) {
  const engine = scratchPlugin(t);
  const module = path.join(path.dirname(engine), 'lib/gate.mjs');
  if (!fs.existsSync(module)) fs.writeFileSync(module, STAND_IN);
  return engine;
}

const write = (run, patch) => writeState(run, delegating(patch));

/** A run of the revise fixture at its review gate, under `driver`. */
function atReview(t, driver = DISPATCH) {
  const run = scratch(t);
  freeze(run, { definition: REVISE, orchestrator: { driver } });
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: false } } },
    node_summaries: { draft: { summary: 'Drafted the guide.', decisions: ['Wrote it for new operators'], risks: ['open: the intro repeats the title'] } },
  });
  write(run, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  write(run, {
    nodes: { review: { status: 'completed' } },
    node_summaries: { review: { summary: 'Reviewed the draft.', risks: ['open: section 2 contradicts the summary'] } },
  });
  return run;
}

/** A run of the sample definition whose analysis node is running, under a cockpit that carries question sets. */
function asking(t) {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  return run;
}

const QUESTIONS = {
  questions: [{
    id: 'scope', question: 'Which modules does the change cover?', options: [
      { id: 'all', label: 'Every module (Recommended)', description: 'One pass over the whole tree.' },
      { id: 'core', label: 'The core only', description: 'Leaves the plugins for later.' },
    ],
  }, {
    id: 'order', question: 'Which goes first?', options: [
      { id: 'reader', label: 'The reader', description: 'Readers stay compatible first.' },
      { id: 'writer', label: 'The writer', description: 'Nothing reads the new field yet.' },
    ],
  }],
};

const patchOf = run => path.join(run.dir, '.state-patch.json');

/** The two-call form: the printed request written to the patch file as it stands, then the document form. */
function twoCalls(engine, run, args, set) {
  if (set) fs.writeFileSync(patchOf(run), JSON.stringify(set));
  const printed = runScript(engine, ['gate-brief', `--state=${run.state}`, ...args, '--request', ...(set ? [`--patch-file=${patchOf(run)}`] : [])]);
  assert.equal(printed.code, 0, printed.stderr);
  fs.writeFileSync(patchOf(run), printed.stdout);
  return runScript(engine, ['gate-request', `--state=${run.state}`, `--patch-file=${patchOf(run)}`]);
}

/** The one-call form. */
function oneCall(engine, run, args, set) {
  if (set) fs.writeFileSync(patchOf(run), JSON.stringify(set));
  return runScript(engine, ['gate-request', `--state=${run.state}`, ...args, ...(set ? [`--patch-file=${patchOf(run)}`] : [])]);
}

/**
 * A second project holding a copy of `run`, so both forms start from the same
 * bytes. `origin` is the root the copied files name, masked beside its own.
 */
function copyOf(t, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(run.root, root, { recursive: true });
  return { ...sibling({ root }, { type: 'development', name: path.basename(run.dir) }), origin: run.root };
}

/** Every file of the run directory, its roots masked and every clock set aside. */
function landed(run) {
  const files = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const text = maskRoot(fs.readFileSync(file, 'utf8'), run.root);
        files[path.relative(run.dir, file).split(path.sep).join('/')] = (run.origin ? maskRoot(text, run.origin) : text)
          .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<clock>');
      }
    }
  };
  walk(run.dir);
  return files;
}

function sameLanding(t, setUp, args, set) {
  const engine = suspendingEngine(t);
  const before = setUp(t);
  const after = copyOf(t, before);
  const two = twoCalls(engine, before, args, set);
  const one = oneCall(engine, after, args, set);
  assert.equal(two.code, 0, two.stderr);
  assert.equal(one.code, 0, one.stderr);
  assert.equal(one.stdout, two.stdout, 'the same files written, in the same order');
  assert.equal(one.stderr, two.stderr);
  const node = args[0].slice('--node='.length);
  const files = landed(after);
  assert.ok(files[`gates/${node}.request.yml`], 'the request file is written');
  assert.match(files['orchestrator-state.yml'], new RegExp(`gate_pending: \\{node: ${node}, `), 'the marker is set');
  assert.equal(fs.existsSync(patchOf(after)), false, 'the patch file is consumed');
  assert.deepEqual(files, landed(before), 'every file of the run, byte for byte');
}

test('gate-request --node: a gate lands exactly as the two-call form lands it', t => {
  sameLanding(t, t => atReview(t), ['--node=review-approval']);
});

test('gate-request --node --reask: the request asked again for a revise\'s note lands as the two-call form lands it', t => {
  sameLanding(t, t => atReview(t), ['--node=review-approval', '--reask=send-back']);
});

test('gate-request --node --patch-file: a node\'s question set lands as the two-call form lands it', t => {
  sameLanding(t, asking, ['--node=analysis'], QUESTIONS);
});

test('gate-request --node: a refused brief is reported as gate-brief reports it and writes nothing', t => {
  const engine = suspendingEngine(t);
  const run = scratch(t);
  freeze(run, { definition: REVISE, orchestrator: { driver: DISPATCH } });
  const before = landed(run);
  const result = runScript(engine, ['gate-request', `--state=${run.state}`, '--node=review-approval']);
  const brief = runScript(engine, ['gate-brief', `--state=${run.state}`, '--node=review-approval', '--request']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, brief.stderr, 'the brief\'s own refusal, as gate-brief prints it');
  assert.match(result.stderr, /^gate-brief-/);
  assert.deepEqual(landed(run), before, 'nothing is written');
});

test('gate-request --node --patch-file: a refused set is kept for the same call', t => {
  const engine = suspendingEngine(t);
  const run = asking(t);
  fs.writeFileSync(patchOf(run), JSON.stringify({ questions: [] }));
  const result = runScript(engine, ['gate-request', `--state=${run.state}`, '--node=analysis', `--patch-file=${patchOf(run)}`]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-brief-questions-invalid: /);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false, 'no request file');
  assert.equal(fs.readFileSync(patchOf(run), 'utf8'), JSON.stringify({ questions: [] }), 'the set is kept');
});

test('gate-request --node --patch-file: a set carrying round is refused, saying the engine sets it, and nothing is written', t => {
  const engine = suspendingEngine(t);
  const run = asking(t);
  fs.writeFileSync(patchOf(run), JSON.stringify({ ...QUESTIONS, round: 1 }));
  const result = runScript(engine, ['gate-request', `--state=${run.state}`, '--node=analysis', `--patch-file=${patchOf(run)}`]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-brief-questions-invalid: .*the key "round" is not one of ask, headline, questions: the engine sets a request's round itself/);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false, 'no request file');
});

test('gate-request: --reask needs --node, and takes no question set', t => {
  const run = atReview(t);
  const alone = runScript(suspendingEngine(t), ['gate-request', `--state=${run.state}`, '--reask=send-back'], '{}');
  assert.equal(alone.code, 2);
  assert.match(alone.stderr, /--reask only with --node/);
  fs.writeFileSync(patchOf(run), JSON.stringify(QUESTIONS));
  const both = runScript(suspendingEngine(t), ['gate-request', `--state=${run.state}`, '--node=review-approval', '--reask=send-back', `--patch-file=${patchOf(run)}`]);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--reask or --patch-file, not both/);
});

test('gate-request --node: without the gate module it refuses by name once the brief renders, writing no request', { skip: fs.existsSync(path.join(ENGINE_DIR, 'scripts/lib/gate.mjs')) && 'this edition carries the gate module' }, t => {
  const run = atReview(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = verb(['gate-request', `--state=${run.state}`, '--node=review-approval']);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^gate-request-unavailable: /m);
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'the state is untouched');
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false, 'no request file');
});
