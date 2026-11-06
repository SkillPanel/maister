import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, run, verb } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// `changes_code` says whether a workflow changes the project's code. It is a
// declaration for a reader: the validator judges its shape, an overlay may only
// raise it, `locate` reports it over the layers a run folds, and no graph hash
// moves for it. The interface file's copy is held in interface-file.test.mjs.

const BASE = [
  'name: acme',
  'version: 1',
  'nodes:',
  '  intake:',
  '    uses: direct:intake',
  '    needs: []',
];

const PROSE = '# Acme\n\nWalks a topic.\n\n## `intake`\n\nRead the topic.\n';

const declaring = line => ['name: acme', 'version: 1', line, ...BASE.slice(2)];

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-changes-code-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function definition(t, lines = BASE) {
  const file = path.join(workspace(t), 'acme.yml');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.writeFileSync(file.replace(/\.yml$/, '.md'), PROSE);
  return file;
}

function overlay(file, lines) {
  const at = path.join(path.dirname(file), 'acme.overlay.yml');
  fs.writeFileSync(at, `${['extends: acme', ...lines].join('\n')}\n`);
  return at;
}

function judged(...args) {
  const result = verb(['validate', ...args]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

function errorAt(report, dotted) {
  const found = report.errors.find(error => error.path === dotted);
  assert.ok(found, `no error at ${dotted}: ${JSON.stringify(report.errors)}`);
  return found;
}

// ---------------------------------------------------------------------------
// the definition
// ---------------------------------------------------------------------------

test('a definition may say true or false, and neither moves the graph hash', t => {
  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const plain = hashOf(definition(t));
  for (const written of ['changes_code: true', 'changes_code: false']) {
    const marked = hashOf(definition(t, declaring(written)));
    assert.equal(marked.ok, true, `${written}: ${JSON.stringify(marked.errors)}`);
    assert.equal(marked.graph_hash, plain.graph_hash, written);
  }
});

test('a definition saying anything but true or false is refused at the field, a null included', t => {
  for (const written of ['changes_code: "yes"', 'changes_code: 1', 'changes_code: null', 'changes_code: [code]']) {
    const { code, report } = judged(`--definition=${definition(t, declaring(written))}`);
    assert.equal(code, 1, written);
    assert.match(errorAt(report, 'changes_code').message, /changes_code is true or false/, written);
  }
});

// ---------------------------------------------------------------------------
// an overlay and a profile raise it and never lower it
// ---------------------------------------------------------------------------

test('an overlay and a profile may raise it', t => {
  const file = definition(t);
  const lay = overlay(file, ['changes_code: true', 'profiles:', '  heavy:', '    changes_code: true']);
  const { code, report } = judged(`--definition=${file}`, `--overlay=${lay}`);
  assert.equal(code, 0, JSON.stringify(report.errors));
});

test('an overlay may not lower it, and neither may a profile that is not selected', t => {
  const file = definition(t, declaring('changes_code: true'));
  const top = judged(`--definition=${file}`, `--overlay=${overlay(file, ['changes_code: false'])}`);
  assert.equal(top.code, 1);
  assert.match(errorAt(top.report, 'changes_code').message, /never to false.*eject/);

  const inProfile = judged(`--definition=${file}`, `--overlay=${overlay(file, ['profiles:', '  lean:', '    changes_code: false'])}`);
  assert.equal(inProfile.code, 1);
  assert.match(errorAt(inProfile.report, 'profiles.lean.changes_code').message, /never to false/);
});

test('an overlay saying anything else is refused, and an overlay judged on its own is held to the same', t => {
  const file = definition(t);
  for (const written of ['changes_code: "yes"', 'changes_code: null']) {
    const { code, report } = judged(`--definition=${file}`, `--overlay=${overlay(file, [written])}`);
    assert.equal(code, 1, written);
    assert.match(errorAt(report, 'changes_code').message, /changes_code is true here/, written);
  }
  const alone = path.join(workspace(t), 'research.overlay.yml');
  fs.writeFileSync(alone, 'extends: builtin:research\nchanges_code: false\n');
  const { code, report } = judged(`--overlay=${alone}`);
  assert.equal(code, 1);
  assert.match(errorAt(report, 'changes_code').message, /never to false/);
});

// ---------------------------------------------------------------------------
// the built-ins
// ---------------------------------------------------------------------------

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

test('the built-ins that implement a change declare it, and the others say nothing', () => {
  const stems = fs.readdirSync(WORKFLOWS).filter(name => name.endsWith('.yml')).map(name => name.slice(0, -4)).sort();
  const written = Object.fromEntries(stems.map(name => [name, readDefinition(path.join(WORKFLOWS, `${name}.yml`)).doc.changes_code]));
  assert.deepEqual(written, {
    development: true,
    migration: true,
    'mockup-studio': undefined,
    performance: true,
    'product-design': undefined,
    research: undefined,
  });
  for (const name of stems) {
    const { code, report } = judged(`--definition=${path.join(WORKFLOWS, `${name}.yml`)}`);
    assert.equal(code, 0, `${name}: ${JSON.stringify(report.errors)}`);
  }
});

// ---------------------------------------------------------------------------
// locate reports it over the layers a run folds
// ---------------------------------------------------------------------------

function project(t, files = {}) {
  const root = workspace(t);
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

function located(root, ...args) {
  const result = run(ENGINE, ['locate', ...args], undefined, { CLAUDE_PROJECT_DIR: root }, root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

const home = name => `.maister/workflows/${name}`;

test('locate reports a built-in\'s own word, true and false', t => {
  const root = project(t);
  for (const [name, expected] of [['development', true], ['migration', true], ['performance', true], ['research', false], ['product-design', false], ['mockup-studio', false]]) {
    assert.equal(located(root, `--name=${name}`).changes_code, expected, name);
  }
});

test('locate reports what an overlay raises, and what a profile raises only when it is selected', t => {
  const raised = project(t, { [home('research.overlay.yml')]: 'extends: builtin:research\nchanges_code: true\n' });
  assert.equal(located(raised, '--name=research').changes_code, true);

  const profiled = project(t, { [home('research.overlay.yml')]: 'extends: builtin:research\nprofiles:\n  build:\n    changes_code: true\n  read:\n    display: {}\n' });
  assert.equal(located(profiled, '--name=research').changes_code, false);
  assert.equal(located(profiled, '--name=research', '--profile=read').changes_code, false);
  assert.equal(located(profiled, '--name=research', '--profile=build').changes_code, true);

  const extra = project(t, { 'extra.yml': 'extends: builtin:research\nchanges_code: true\n' });
  assert.equal(located(extra, '--name=research', '--overlay=extra.yml').changes_code, true);
});

test('an overlay beside an eject is never applied, so it raises nothing', t => {
  const eject = ['name: research', ...BASE.slice(1)].join('\n');
  const root = project(t, {
    [home('research.yml')]: `${eject}\n`,
    [home('research.md')]: PROSE,
    [home('research.overlay.yml')]: 'extends: builtin:research\nchanges_code: true\n',
  });
  const report = located(root, '--name=research');
  assert.equal(report.from, 'eject');
  assert.equal(report.ignored, home('research.overlay.yml'));
  assert.equal(report.changes_code, false);
});

test('a project\'s own workflow can set it, and the listing carries it beside the rest', t => {
  const own = (name, extra = []) => [`name: ${name}`, 'version: 1', ...extra, ...BASE.slice(2)].join('\n');
  const root = project(t, {
    [home('builder.yml')]: `${own('builder', ['changes_code: true'])}\n`,
    [home('builder.md')]: PROSE,
    [home('reader.yml')]: `${own('reader')}\n`,
    [home('reader.md')]: PROSE,
  });
  assert.equal(located(root, '--name=builder').changes_code, true);
  assert.equal(located(root, '--name=reader').changes_code, false);
  const rows = Object.fromEntries(located(root).workflows.map(row => [row.name, row.changes_code]));
  assert.deepEqual(rows, { builder: true, reader: false });
});
