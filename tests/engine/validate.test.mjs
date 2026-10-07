import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, SAMPLE, verb } from '../helpers.mjs';

// Definition-agnostic, like `make diagram`: a built-in added to workflows/ is
// covered here without an edit.
const BUILTINS = fs.readdirSync(path.join(ENGINE_DIR, 'workflows'))
  .filter(name => name.endsWith('.yml'))
  .map(name => path.join(ENGINE_DIR, 'workflows', name));

test('at least one built-in definition ships', () => {
  assert.ok(BUILTINS.length > 0);
});

for (const definition of BUILTINS) {
  const name = path.basename(definition, '.yml');

  test(`built-in ${name} validates`, () => {
    const result = verb(['validate', `--definition=${definition}`]);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.errors, []);
    assert.equal(report.ok, true);
    assert.equal(result.code, 0);
  });

  test(`built-in ${name} resolves to a hashed graph named after itself`, () => {
    const result = verb(['resolve', `--definition=${definition}`]);
    assert.equal(result.code, 0);
    const graph = JSON.parse(result.stdout);
    assert.equal(graph.name, name);
    assert.match(graph.graph_hash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(graph.nodes.length > 0);
  });
}

test('resolve is deterministic: the same definition hashes the same twice', () => {
  const first = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  const second = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  assert.equal(first.graph_hash, second.graph_hash);
});

test('the sample fixture validates and resolves every target it names', () => {
  const result = verb(['validate', `--definition=${SAMPLE}`]);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.counts, { nodes: 4, gates: 1 });
  assert.deepEqual(report.resolved.map(entry => entry.node).sort(), ['analysis', 'implementation', 'research']);
});

test('a definition needing an undeclared node is rejected with a located error', () => {
  const result = verb(['validate', `--definition=${path.join(FIXTURES, 'definitions/broken.yml')}`]);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].node, 'review');
  assert.equal(report.errors[0].path, 'nodes.review.needs.0');
  assert.match(report.errors[0].message, /nonexistent/);
});

test('an unknown verb is a usage failure, exit 2', () => {
  const result = verb(['frobnicate']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: unknown verb "frobnicate"/);
});
