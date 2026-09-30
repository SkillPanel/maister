import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, SAMPLE, verb } from '../helpers.mjs';

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

// ---------------------------------------------------------------------------
// add.<id>.before
// ---------------------------------------------------------------------------

const positionOf = (graph, id) => graph.nodes.findIndex(node => node.id === id);

test('before: makes the named nodes wait for an added phase, so it runs ahead of them whatever its id', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'add:',
    '  threat-model:',
    '    uses: skill:threat-modeler',
    '    needs: [specification-approval]',
    '    before: [planning]',
  ]);
  const { code, report } = run('resolve', DEVELOPMENT, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(needsOf(report, 'planning'), ['spec-audit-approval', 'threat-model']);
  assert.ok(positionOf(report, 'threat-model') < positionOf(report, 'planning'));
  assert.ok(positionOf(report, 'threat-model') < positionOf(report, 'implementation'));
});

test('an added gate named to sort last still holds the node it is placed before', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'add:',
    '  zz-architecture-signoff:',
    '    type: gate',
    '    needs: [planning-approval]',
    '    before: [implementation]',
    '    ask: "Does the plan match the architecture decisions?"',
    '    options: {signed-off: continue, needs-architect: stop}',
  ]);
  const { code, report } = run('resolve', DEVELOPMENT, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(needsOf(report, 'implementation'), ['planning-approval', 'zz-architecture-signoff']);
  assert.ok(positionOf(report, 'zz-architecture-signoff') < positionOf(report, 'implementation'));
});

test('an added verifier placed before the verification gate is a need of that gate', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'add:',
    '  security-verification:',
    '    uses: agent:security-verifier',
    '    needs: [verification]',
    '    before: [verification-approval]',
  ]);
  const { code, report } = run('resolve', DEVELOPMENT, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(needsOf(report, 'verification-approval'), ['security-verification', 'verification']);
});

test('before: is an edge, never a node key: the resolved graph hashes as an eject declaring the same edge', t => {
  const overlay = overlayFile(t, [
    'extends: sample.yml',
    'add:',
    '  check:',
    '    uses: skill:implementation-verifier',
    '    needs: [analysis]',
    '    before: [approval]',
  ]);
  const overlaid = run('resolve', SAMPLE, [overlay]).report;
  assert.equal(overlaid.ok, true, JSON.stringify(overlaid.errors));
  assert.ok(overlaid.nodes.every(node => !('before' in node)));

  const dir = path.dirname(overlay);
  const eject = path.join(dir, 'eject.yml');
  fs.copyFileSync(path.join(FIXTURES, 'definitions/sample.md'), path.join(dir, 'eject.md'));
  const text = fs.readFileSync(SAMPLE, 'utf8');
  fs.writeFileSync(eject, `${text.replace('    needs: [analysis]\n    ask:', '    needs: [analysis, check]\n    ask:')}
  check:
    uses: skill:implementation-verifier
    needs: [analysis]
`);
  const ejected = run('resolve', eject, []).report;
  assert.equal(ejected.ok, true, JSON.stringify(ejected.errors));
  assert.equal(overlaid.graph_hash, ejected.graph_hash);
});

test('a profile may place the node it adds with before:', t => {
  const overlay = overlayFile(t, [
    'extends: builtin:development',
    'profiles:',
    '  secure:',
    '    add:',
    '      security-verification:',
    '        uses: agent:security-verifier',
    '        needs: [verification]',
    '        before: [verification-approval]',
  ]);
  const result = verb(['resolve', `--definition=${DEVELOPMENT}`, `--overlay=${overlay}`, '--profile=secure']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(needsOf(JSON.parse(result.stdout), 'verification-approval'), ['security-verification', 'verification']);
});

/** An overlay over the sample adding `check` after `analysis`, placed before whatever `before` names. */
function sampleCheck(t, before, extra = []) {
  return overlayFile(t, [
    'extends: sample.yml',
    ...extra,
    'add:',
    '  check:',
    '    uses: skill:implementation-verifier',
    '    needs: [implementation]',
    `    before: ${before}`,
  ]);
}

test('before: naming a node nothing declares is refused where it is written', t => {
  const overlay = sampleCheck(t, '[nowhere]');
  const { code, report } = run('validate', SAMPLE, [overlay]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => [error.file, error.node, error.path]), [[overlay, 'check', 'add.check.before.0']]);
  assert.match(report.errors[0].message, /"nowhere", which no node declares/);
});

test('before: naming a node this overlay disables is refused, and says so', t => {
  const { code, report } = run('validate', SAMPLE, [sampleCheck(t, '[research]', ['disable: [research]'])]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => error.path), ['add.check.before.0']);
  assert.match(report.errors[0].message, /"research", which this overlay disables/);
});

test('before: naming the added node itself is refused', t => {
  const { code, report } = run('validate', SAMPLE, [sampleCheck(t, '[check]')]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => error.path), ['add.check.before.0']);
});

test('before: that would close a cycle is refused at the entry, naming the path it would close', t => {
  const { code, report } = run('validate', SAMPLE, [sampleCheck(t, '[research, approval]')]);
  assert.equal(code, 1);
  assert.deepEqual(report.errors.map(error => error.path), ['add.check.before.1']);
  assert.match(report.errors[0].message, /check -> implementation -> approval/);
});

test('before: must be a sequence of node ids, resolved and standalone', t => {
  const overlay = sampleCheck(t, 'approval');
  for (const args of [[`--definition=${SAMPLE}`, `--overlay=${overlay}`], [`--overlay=${overlay}`]]) {
    const result = verb(['validate', ...args]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout).errors.map(error => error.path), ['add.check.before']);
  }
});

// ---------------------------------------------------------------------------
// an added node nothing waits for
// ---------------------------------------------------------------------------

const leafWarnings = report => report.warnings.filter(warning => warning.startsWith('added-node-no-dependents:'));

test('an added node nothing needs is warned about, naming where it will run and pointing at before:', () => {
  const { code, report } = run('validate', SAMPLE, [path.join(FIXTURES, 'definitions/sample.overlay.yml')]);
  assert.equal(code, 0);
  assert.deepEqual(leafWarnings(report), [
    'added-node-no-dependents:add.review:review — nothing needs it, so it runs at position 5 of 5 in the frozen order, '
    + 'after research; list the nodes that should wait for it under before:',
  ]);
});

test('the dangling-node warning names the profile path a profile added the node at', t => {
  const overlay = overlayFile(t, [
    'extends: sample.yml',
    'profiles:',
    '  checked:',
    '    add:',
    '      check:',
    '        uses: skill:implementation-verifier',
    '        needs: [analysis]',
  ]);
  const result = verb(['validate', `--definition=${SAMPLE}`, `--overlay=${overlay}`, '--profile=checked']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(leafWarnings(JSON.parse(result.stdout)).map(warning => warning.split(' — ')[0]),
    ['added-node-no-dependents:profiles.checked.add.check:check']);
});

test('an added node placed with before:, or needed by another added node, is not warned about', t => {
  const overlay = overlayFile(t, [
    'extends: sample.yml',
    'add:',
    '  check:',
    '    uses: skill:implementation-verifier',
    '    needs: [analysis]',
    '  recheck:',
    '    uses: skill:implementation-verifier',
    '    needs: [check]',
    '    before: [approval]',
  ]);
  const { code, report } = run('validate', SAMPLE, [overlay]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(leafWarnings(report), []);
});

// ---------------------------------------------------------------------------
// an overlay with nothing to lay itself over
// ---------------------------------------------------------------------------

test('an overlay judged on its own is refused when the workflow it names exists nowhere, naming that base', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-overlay-base-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const home = path.join(project, '.maister/workflows');
  fs.mkdirSync(home, { recursive: true });
  const overlay = path.join(home, 'acme.overlay.yml');
  fs.writeFileSync(overlay, 'extends: acme\ndisable: [review]\n');
  const env = { CLAUDE_PROJECT_DIR: project };

  const refused = verb(['validate', `--overlay=${overlay}`], undefined, env);
  assert.equal(refused.code, 1, refused.stdout);
  const [error] = JSON.parse(refused.stdout).errors;
  assert.deepEqual([error.file, error.path], [overlay, 'extends']);
  assert.match(error.message, /extends "acme", but no workflow of that name exists/);
  assert.match(error.message, /\.maister\/workflows\/acme\.yml/);

  // The same overlay once the project defines the workflow it extends.
  fs.writeFileSync(path.join(home, 'acme.yml'), 'name: acme\nversion: 1\nnodes:\n  review:\n    uses: skill:quick-plan\n    needs: []\n');
  const passed = verb(['validate', `--overlay=${overlay}`], undefined, env);
  assert.equal(passed.code, 0, passed.stdout);
});

test('a base named by path is not looked for when the overlay is judged on its own', t => {
  const overlay = overlayFile(t, ['extends: nowhere/absent.yml', 'disable: [review]'], 'absent.overlay.yml');
  const result = verb(['validate', `--overlay=${overlay}`]);
  assert.equal(result.code, 0, result.stdout);
});
