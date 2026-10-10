import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb } from '../helpers.mjs';

// An edition with no gate module cannot suspend a driven run. `gate-request`
// says so by name, writes nothing and keeps the request, so every run reaching
// it stops the same way rather than asking in session or taking a default.

const GATE_MODULE = path.join(ENGINE_DIR, 'scripts/lib/gate.mjs');

test('gate-request: without the gate module it refuses by name, writing nothing and keeping the request', { skip: fs.existsSync(GATE_MODULE) && 'this edition carries the gate module' }, t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify({ node: 'approval', kind: 'approve', question: 'Proceed?', options: [] }));

  const result = verb(['gate-request', `--state=${run.state}`, `--patch-file=${patch}`]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^gate-request-unavailable: /);
  assert.match(result.stderr, /Stop with RUN-FAILED: gate-request-unavailable; never ask in session and never take a default answer\.$/m);
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'the state is untouched');
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false, 'no request file');
  assert.ok(fs.existsSync(patch), 'the request is kept');
});
