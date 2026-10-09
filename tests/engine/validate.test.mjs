import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, SAMPLE, freeze, readState, scratch, verb } from '../helpers.mjs';
import { parseDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

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

// ---------------------------------------------------------------------------
// development's design input
// ---------------------------------------------------------------------------

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');

test('development hands its design input to the intake, beside the research input', () => {
  const graph = JSON.parse(verb(['resolve', `--definition=${DEVELOPMENT}`]).stdout);
  const intake = graph.nodes.find(node => node.id === 'intake');
  assert.equal(intake.with.design, '${inputs.design}');
  assert.equal(intake.with.research, '${inputs.research}');
});

test('a chain step passes a product-design path to development as its design input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const chain = path.join(dir, 'delivery.yml');
  fs.writeFileSync(chain, [
    'name: delivery', 'version: 1', 'inputs:',
    '  task_description: {type: string, required: true}', '  design: {type: string, required: true}', 'nodes:',
    '  build:', '    uses: workflow:development', '    needs: []', '    with:',
    '      task_description: "${inputs.task_description}"', '      design: "${inputs.design}"', '',
  ].join('\n'));
  const report = JSON.parse(verb(['validate', `--definition=${chain}`]).stdout);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------------------
// development's architecture input
// ---------------------------------------------------------------------------

test('development declares an optional architecture input, a path beside the design input', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(DEVELOPMENT, 'utf8'), DEVELOPMENT);
  assert.deepEqual(errors, []);
  assert.deepEqual({ ...doc.inputs.architecture }, { type: 'string', required: false });
});

test('development hands the architecture to the intake, and the copied context to the specification and the plan', () => {
  const graph = JSON.parse(verb(['resolve', `--definition=${DEVELOPMENT}`]).stdout);
  const node = id => graph.nodes.find(entry => entry.id === id);
  assert.equal(node('intake').with.architecture, '${inputs.architecture}');
  assert.equal(node('intake').outputs.artifacts.architecture_context, 'analysis/architecture-context');
  // The intake carries no guard, so both readers may take its artifact whatever
  // the run skips.
  assert.equal(node('intake').when, undefined);
  for (const id of ['specification', 'planning']) {
    assert.equal(node(id).with.architecture, '${intake.artifacts.architecture_context}', id);
  }
});

test('a chain step passes a high-level design to development as its architecture input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const chain = path.join(dir, 'delivery.yml');
  fs.writeFileSync(chain, [
    'name: delivery', 'version: 1', 'inputs:',
    '  task_description: {type: string, required: true}', '  design: {type: string, required: true}',
    '  architecture: {type: string, required: true}', 'nodes:',
    '  build:', '    uses: workflow:development', '    needs: []', '    with:',
    '      task_description: "${inputs.task_description}"', '      design: "${inputs.design}"',
    '      architecture: "${inputs.architecture}"', '',
  ].join('\n'));
  const report = JSON.parse(verb(['validate', `--definition=${chain}`]).stdout);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('development freezes with the architecture input recorded, and without it as before', t => {
  const architecture = 'docs/architecture/high-level-design.md';
  const withIt = scratch(t, { name: '2026-01-05-with-architecture' });
  freeze(withIt, { definition: DEVELOPMENT, inputs: { task_description: 'Expose the billing API', architecture } });
  const recorded = readState(withIt);
  assert.equal(recorded.orchestrator.options.inputs.architecture, architecture);
  assert.equal(recorded.workflow.nodes.intake.status, 'pending');

  const without = scratch(t, { name: '2026-01-05-without-architecture' });
  freeze(without, { definition: DEVELOPMENT, inputs: { task_description: 'Expose the billing API' } });
  const plain = readState(without);
  assert.equal('architecture' in plain.orchestrator.options.inputs, false);
  assert.equal(plain.workflow.graph_hash, recorded.workflow.graph_hash);
});
