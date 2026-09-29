import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, verb } from '../helpers.mjs';

// What an overlay may do to a built-in graph, and what it is refused: the
// operations are read on the resolved graph, so each test validates or
// resolves the built-in with an overlay written to a scratch directory.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');

/** Write `lines` as an overlay file in a scratch directory removed when the test ends. */
function overlayFile(t, lines, name = 'development.overlay.yml') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function run(verbName, definition, overlays) {
  const result = verb([verbName, `--definition=${definition}`, ...overlays.map(overlay => `--overlay=${overlay}`)]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

const needsOf = (graph, id) => graph.nodes.find(node => node.id === id).needs;

// ---------------------------------------------------------------------------
// disable, then add under the same id
// ---------------------------------------------------------------------------

const READD_GATE = [
  'extends: builtin:development',
  'disable: [planning-approval]',
  'add:',
  '  planning-approval:',
  '    type: gate',
  '    needs: [planning]',
  '    ask: "Plan ready. Ship it?"',
  '    options:',
  '      go: continue',
  '      rework: stop',
];

test('an overlay that disables a gate and adds it back under its own id is refused, where the add is', t => {
  const overlay = overlayFile(t, READD_GATE);
  const { code, report } = run('validate', DEVELOPMENT, [overlay]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => [error.file, error.node, error.path]), [[overlay, 'planning-approval', 'add.planning-approval']]);
  assert.match(report.errors[0].message, /this overlay disables/);
  assert.match(report.errors[0].message, /tune/);
  assert.match(report.errors[0].message, /before:/);
});

test('resolve refuses the re-add too, so no detached gate is ever hashed', t => {
  const { code, report } = run('resolve', DEVELOPMENT, [overlayFile(t, READD_GATE)]);
  assert.equal(code, 1);
  assert.equal(report.graph_hash, null);
});

test('a node one overlay disabled cannot be added back by the next, and the refusal names the disabling file', t => {
  const disabling = overlayFile(t, ['extends: builtin:development', 'disable: [user-docs]'], 'trim.overlay.yml');
  const adding = overlayFile(t, [
    'extends: builtin:development',
    'add:',
    '  user-docs:',
    '    uses: agent:user-docs-generator',
    '    needs: [e2e-approval]',
  ], 'readd.overlay.yml');
  const { code, report } = run('validate', DEVELOPMENT, [disabling, adding]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => [error.file, error.path]), [[adding, 'add.user-docs']]);
  assert.ok(report.errors[0].message.includes(disabling), report.errors[0].message);
});

test('a profile cannot add back a node its own overlay body disabled', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'disable: [user-docs]',
    'profiles:',
    '  docs:',
    '    add:',
    '      user-docs:',
    '        uses: agent:user-docs-generator',
    '        needs: [e2e-approval]',
  ]);
  const result = verb(['validate', `--definition=${DEVELOPMENT}`, `--overlay=${overlay}`, '--profile=docs']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors.map(error => error.path), ['profiles.docs.add.user-docs']);
  assert.match(report.errors[0].message, /this overlay disables/);
});

// ---------------------------------------------------------------------------
// tune.with
// ---------------------------------------------------------------------------

const BASE_WITH = {
  task_description: '${inputs.task_description}',
  research_context: '${intake.artifacts.research_context}',
  design_index: '${intake.artifacts.design_index}',
};

const withOf = (graph, id) => ({ ...graph.nodes.find(node => node.id === id).with });

test('tune.with merges by key: the base inputs stay and the tuned key is added', t => {
  const overlay = overlayFile(t, ['extends: builtin:development', 'tune:', '  codebase-analysis:', '    with: {depth: deep}']);
  const { code, report } = run('resolve', DEVELOPMENT, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(withOf(report, 'codebase-analysis'), { ...BASE_WITH, depth: 'deep' });
});

test('tune.with replaces the value of a key the base declares, and null deletes one', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'tune:',
    '  codebase-analysis:',
    '    with: {design_index: null, task_description: "Harden the parser"}',
  ]);
  const { code, report } = run('resolve', DEVELOPMENT, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  const { design_index: _dropped, ...kept } = BASE_WITH;
  assert.deepEqual(withOf(report, 'codebase-analysis'), { ...kept, task_description: 'Harden the parser' });
});

test('a profile tunes with over what its overlay body already tuned, key by key', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'tune:',
    '  codebase-analysis:',
    '    with: {depth: deep}',
    'profiles:',
    '  quick:',
    '    tune:',
    '      codebase-analysis:',
    '        with: {depth: shallow, research_context: null}',
  ]);
  const result = verb(['resolve', `--definition=${DEVELOPMENT}`, `--overlay=${overlay}`, '--profile=quick']);
  assert.equal(result.code, 0, result.stdout);
  const { research_context: _dropped, ...kept } = BASE_WITH;
  assert.deepEqual(withOf(JSON.parse(result.stdout), 'codebase-analysis'), { ...kept, depth: 'shallow' });
});

test('a tuned with that is not a mapping is refused where it is written', t => {
  const overlay = overlayFile(t, ['extends: builtin:development', 'tune:', '  codebase-analysis:', '    with: deep']);
  for (const args of [[`--definition=${DEVELOPMENT}`, `--overlay=${overlay}`], [`--overlay=${overlay}`]]) {
    const result = verb(['validate', ...args]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout).errors.map(error => error.path), ['tune.codebase-analysis.with']);
  }
});
