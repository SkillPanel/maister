import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';
import { buildSeed, renderSeed, SEED_LINE_CAP } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';

// A dispatched worker suspends at a gate on a request it did not compose: the
// seed names gate-brief --request as the request's only source, its output
// written unchanged to the patch file, and then one gate-request call.

const ENVELOPE = {
  version: 1,
  dispatch_id: 'd-0001',
  provider: 'claude',
  autonomy: 'attended',
  target: { member: 'app', path: 'members/app' },
  chain: { node: 'build' },
  outbox: '.maister/umbrella/outbox/d-0001',
  workspace_root: '/work',
  statement: 'Add a tag filter to the list view',
  workflow: { uses: 'workflow:development' },
};

test('seed: a driven gate request comes from gate-brief --request alone, written unchanged, then one gate-request', () => {
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  const lines = prompt.split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);

  const brief = lines.findIndex(line => /workflow\.mjs gate-brief --state=.+ --node=.+ --request$/.test(line));
  const request = lines.findIndex(line => /workflow\.mjs gate-request --state=.+ --patch-file=/.test(line));
  assert.ok(brief > 0, 'the seed names the gate-brief --request command');
  assert.ok(request > brief, 'gate-request comes after the request is printed');
  assert.match(lines[brief - 1], /The only source of the request is the engine's gate-brief verb/);
  assert.match(lines[brief + 1], /Write what it prints, unchanged, .*`\.state-patch\.json`.*never composed or edited by you/);
  assert.match(lines[brief + 1], /Then make one call to the gate-request verb/);
  assert.equal(lines.filter(line => /gate-request --state=/.test(line)).length, 1, 'one gate-request call');
});

test('seed: the worker records its dispatch id in the driver block, beside the kind and the cwd', () => {
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  const lines = prompt.split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);
  const driver = lines.filter(line => line.includes('orchestrator.driver: {'));
  assert.equal(driver.length, 1, 'one driver instruction');
  assert.match(driver[0], /\{kind: dispatch, cwd: <[^>]+>, dispatch_id: d-0001\}/);
});
