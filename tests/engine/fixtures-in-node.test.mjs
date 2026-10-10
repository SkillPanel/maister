// The fixtures the in-node classing tests build on: two definitions with their
// node prose, and the shared scratch plugin a suite of cases runs against. These
// cases prove the fixtures are what those suites assume — each definition
// validates clean and freezes, the prose names its question sets in the form the
// node-prose parser counts, and `sharedPlugin` gives one copy per policy for a
// whole file and removes it after the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { FIXTURES, ROOT, freeze, readState, scratch, verb } from '../helpers.mjs';

const IN_NODE = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const HELD_CLOSING = path.join(FIXTURES, 'definitions/held-closing.yml');

// The node-prose question-set form: a `## \`node\`` heading, then
// `**With question sets** (\`id\`)` and `**Without question sets** (\`id\`)`
// lines under it. The same patterns the shipped parser reads.
const NODE_HEADING = /^## `([a-z0-9-]+)`\s*$/;
const QUESTION_LINE = /\*\*(With|Without) question sets\*\*(?:\s*\(([^)]*)\))?/;
const QUESTION_ID = /`([a-z0-9-]+)`/;

/** Each node's question-set ids, with the side (With/Without) each was named on. */
function questionSets(text) {
  const found = {};
  let node = null;
  for (const line of text.split('\n')) {
    const heading = NODE_HEADING.exec(line);
    if (heading) {
      node = heading[1];
      continue;
    }
    const match = QUESTION_LINE.exec(line);
    if (!match || match[2] === undefined || node === null) continue;
    const id = QUESTION_ID.exec(match[2])?.[1];
    if (!id) continue;
    const entry = (found[node] ??= {});
    (entry[id] ??= []).push(match[1]);
  }
  return found;
}

test('both definitions validate clean and freeze with every node pending', t => {
  for (const definition of [IN_NODE, HELD_CLOSING]) {
    const name = path.basename(definition, '.yml');
    const result = verb(['validate', `--definition=${definition}`]);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.errors, [], name);
    // The sub-run's target is the `closing-child` fixture, which the engine
    // looks for among the project's workflows and so names as unresolved.
    const expected = definition === HELD_CLOSING ? ['unresolved-reference:audit:workflow:closing-child'] : [];
    assert.deepEqual(report.warnings, expected, name);
    assert.equal(result.code, 0, name);

    const run = scratch(t, { name: `2026-10-10-${name}` });
    const graph = freeze(run, { definition });
    const state = readState(run);
    assert.equal(state.workflow.name, name);
    assert.deepEqual(Object.keys(state.workflow.nodes), graph.nodes.map(node => node.id));
    for (const entry of Object.values(state.workflow.nodes)) assert.equal(entry.status, 'pending');
  }

  // The shapes the classing suites lean on.
  const inNode = JSON.parse(verb(['resolve', `--definition=${IN_NODE}`]).stdout);
  const byId = Object.fromEntries(inNode.nodes.map(node => [node.id, node]));
  assert.equal(byId['review-approval'].when, '${scoping.values.wants_review}');
  assert.equal(byId['depth-approval'].when, '${inputs.thorough}');
  assert.deepEqual(byId['notes-approval'].needs, ['notes']);
  assert.equal(byId.notes.when, '${scoping.values.wants_notes}');

  const held = JSON.parse(verb(['resolve', `--definition=${HELD_CLOSING}`]).stdout);
  const heldById = Object.fromEntries(held.nodes.map(node => [node.id, node]));
  assert.equal(heldById.audit.uses, 'workflow:closing-child');
  const gates = held.nodes.filter(node => node.type === 'gate').map(node => node.id);
  assert.deepEqual(gates, ['outline-approval']);
  const order = held.nodes.map(node => node.id);
  assert.ok(order.indexOf('choosing') > order.indexOf('outline-approval'));
});

test('the companions name bold question-set ids per node, in the form the parser counts', () => {
  const inNode = questionSets(fs.readFileSync(path.join(FIXTURES, 'definitions/in-node-questions.md'), 'utf8'));
  assert.deepEqual(inNode, {
    scoping: { 'scope-choice': ['With', 'Without'], 'review-wanted': ['With', 'Without'] },
    drafting: { 'drafting-tone': ['With', 'Without'] },
  });

  const held = questionSets(fs.readFileSync(path.join(FIXTURES, 'definitions/held-closing.md'), 'utf8'));
  assert.deepEqual(held, {
    choosing: { 'finish-style': ['With', 'Without'] },
    tidy: { 'tidy-scope': ['With', 'Without'] },
  });

  // Every node named in the prose is a node of its definition.
  for (const [definition, sets] of [[IN_NODE, inNode], [HELD_CLOSING, held]]) {
    const ids = JSON.parse(verb(['resolve', `--definition=${definition}`]).stdout).nodes.map(node => node.id);
    for (const node of Object.keys(sets)) assert.ok(ids.includes(node), `${node} in ${definition}`);
  }
});

test('sharedPlugin gives one copy per policy for the whole file and removes it after the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-shared-'));
  try {
    const helpers = pathToFileURL(path.join(ROOT, 'tests/helpers.mjs')).href;
    const child = path.join(dir, 'shared.test.mjs');
    fs.writeFileSync(child, `
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { sharedPlugin } from ${JSON.stringify(helpers)};

const first = sharedPlugin({ policy: { version: 1, marker: 'a' } });
const again = sharedPlugin({ policy: { version: 1, marker: 'a' } });
const other = sharedPlugin({ policy: { version: 1, marker: 'b' } });
const none = sharedPlugin();

const policyOf = engine => path.join(path.dirname(path.dirname(engine)), 'policy/autonomy-policy.json');

test('one', () => {
  console.log('PATHS ' + JSON.stringify({ first: first.engine, again: again.engine, other: other.engine, none: none.engine }));
  console.log('POLICY ' + JSON.parse(fs.readFileSync(policyOf(first.engine), 'utf8')).marker);
  console.log('EXISTS ' + [first, other, none].every(each => fs.existsSync(each.engine)));
});

test('two', () => {
  console.log('SECOND ' + first.engine);
});
`);
    // A child run of its own: the parent runner's context would turn its report
    // into the runner protocol instead of the TAP read below.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', child], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const line = prefix => result.stdout.split('\n').map(each => each.replace(/^#\s*/, ''))
      .find(each => each.startsWith(prefix))?.slice(prefix.length);
    const paths = JSON.parse(line('PATHS '));
    assert.equal(paths.first, paths.again, 'the same policy shares one copy');
    assert.notEqual(paths.first, paths.other, 'another policy gets its own copy');
    assert.notEqual(paths.first, paths.none);
    assert.equal(line('SECOND '), paths.first, 'the copy lives for the whole file');
    assert.equal(line('POLICY '), 'a');
    assert.equal(line('EXISTS '), 'true');
    for (const engine of [paths.first, paths.other, paths.none]) {
      assert.ok(engine.endsWith(path.join('skills', 'workflow-engine', 'scripts', 'workflow.mjs')));
      assert.equal(fs.existsSync(engine), false, `${engine} removed after the file`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
