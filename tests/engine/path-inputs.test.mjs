import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, freezePatch, readState, scratch, verb, write } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// The inputs that name a task, a file or a document are declared `path`, so a
// reader of the definition can tell a path from free text. The engine records a
// path input as given: every form a caller passes today reaches the node that
// reads it unchanged, and an input's type sits outside the graph hash, so a run
// frozen while these inputs were declared `string` still proves its graph.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const DEVELOPMENT = path.join(WORKFLOWS, 'development.yml');
const PRODUCT_DESIGN = path.join(WORKFLOWS, 'product-design.yml');

const PATH_INPUTS = [
  { definition: DEVELOPMENT, name: 'research', base: { task_description: 'Add a page' } },
  { definition: DEVELOPMENT, name: 'design', base: { task_description: 'Add a page' } },
  { definition: DEVELOPMENT, name: 'architecture', base: { task_description: 'Add a page' } },
  { definition: PRODUCT_DESIGN, name: 'research', base: { task_description: 'Design a page' } },
];

/** The value each accepted form spells, for a run whose project root is `root`. */
function forms(root) {
  const task = '.maister/tasks/research/2026-01-02-prior';
  return {
    'a task directory': task,
    'a file inside a task directory': `${task}/outputs/research-report.md`,
    'a path relative to the project root': 'docs/architecture/high-level-design.md',
    'an absolute path inside the project': path.join(root, 'docs/architecture/high-level-design.md'),
  };
}

/** The header lines of a node's brief: its derived facts, before the prose. */
function header(state, node) {
  const result = verb(['node-brief', `--state=${state}`, `--node=${node}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.slice(0, result.stdout.indexOf('\n\n')).split('\n');
}

test('path inputs: development\'s research, design and architecture and product design\'s research are declared optional paths', () => {
  for (const { definition, name } of PATH_INPUTS) {
    const { doc } = readDefinition(definition);
    assert.deepEqual({ ...doc.inputs[name] }, { type: 'path', required: false }, `${path.basename(definition)} ${name}`);
  }
});

for (const { definition, name, base } of PATH_INPUTS) {
  test(`path inputs: ${path.basename(definition, '.yml')}'s ${name} reaches the intake as given, in every accepted form`, t => {
    const probe = scratch(t);
    for (const [form, value] of Object.entries(forms(probe.root))) {
      const run = scratch(t);
      const spelled = value.startsWith(probe.root) ? path.join(run.root, path.relative(probe.root, value)) : value;
      freeze(run, { definition, inputs: { ...base, [name]: spelled } });
      assert.equal(readState(run).orchestrator.options.inputs[name], spelled, form);
      const intake = header(run.state, 'intake');
      assert.ok(intake.includes(`- ${name}: ${spelled}`), `${form}\n${intake.join('\n')}`);
    }
  });
}

test('path inputs: a run frozen while the inputs were declared string still proves its graph and takes writes', t => {
  // The definition as it stood before: the shipped file with the four
  // declarations spelled `string`, beside its own prose companion.
  const before = scratch(t, { name: '2026-01-01-before' });
  const dir = path.join(before.root, 'definitions');
  fs.mkdirSync(dir, { recursive: true });
  for (const definition of [DEVELOPMENT, PRODUCT_DESIGN]) {
    const stem = path.basename(definition, '.yml');
    const text = fs.readFileSync(definition, 'utf8')
      .replace(/^(  (?:research|design|architecture): \{type: )path(, required: false\})$/gm, '$1string$2');
    assert.notEqual(text, fs.readFileSync(definition, 'utf8'), `${stem}: the earlier spelling differs`);
    fs.writeFileSync(path.join(dir, `${stem}.yml`), text);
    fs.copyFileSync(path.join(WORKFLOWS, `${stem}.md`), path.join(dir, `${stem}.md`));

    const old = verb(['resolve', `--definition=${path.join(dir, `${stem}.yml`)}`]);
    assert.equal(old.code, 0, old.stdout + old.stderr);
    const now = verb(['resolve', `--definition=${definition}`]);
    assert.equal(now.code, 0, now.stdout + now.stderr);
    assert.equal(JSON.parse(now.stdout).graph_hash, JSON.parse(old.stdout).graph_hash, `${stem}: an input's type moves no graph_hash`);

    // A run recorded against the shipped definition with the hash the earlier
    // spelling gave: the freeze proves it, a later write proves it again, and
    // resume-check lets it through.
    const run = scratch(t, { name: `2026-01-01-${stem}` });
    const { patch } = freezePatch({ definition, inputs: { task_description: 'Resume me', research: '.maister/tasks/research/2026-01-02-prior' } });
    patch.workflow.graph_hash = JSON.parse(old.stdout).graph_hash;
    write(run, patch);
    write(run, { nodes: { intake: { status: 'running' } } });
    assert.equal(readState(run).workflow.nodes.intake.status, 'running');
    const resumed = verb(['resume-check', `--state=${run.state}`]);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).ok, true);
    assert.ok(header(run.state, 'intake').includes('- research: .maister/tasks/research/2026-01-02-prior'));
  }
});
