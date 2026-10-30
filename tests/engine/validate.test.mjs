import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, SAMPLE, freeze, readState, scratch, verb } from '../helpers.mjs';
import { parseDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { proseSection } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';

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
  assert.deepEqual({ ...doc.inputs.architecture }, { type: 'path', required: false });
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

// ---------------------------------------------------------------------------
// the section slicer
// ---------------------------------------------------------------------------

/** A definition beside a prose companion holding `prose`, in a scratch directory. */
function withCompanion(t, prose) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-slicer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const definition = path.join(dir, 'sliced.yml');
  fs.copyFileSync(SAMPLE, definition);
  fs.writeFileSync(path.join(dir, 'sliced.md'), prose);
  return definition;
}

const GUIDE = [
  '# Guide',
  '',
  '## `analysis`',
  '',
  'Read the scope.',
  '',
  '### Step 1',
  '',
  'Write the report.',
  '',
  '---',
  '',
  '## `approval`',
  '',
  'Ask it.',
  '',
].join('\n');

test('a section ends at the next heading of the same or a higher level, and an H3 stays inside', t => {
  const file = withCompanion(t, GUIDE);
  const section = proseSection(file, 'analysis');
  assert.equal(section.companion, file.replace(/\.yml$/, '.md'));
  assert.equal(section.heading, '## `analysis`');
  assert.equal(section.text, '\nRead the scope.\n\n### Step 1\n\nWrite the report.');
  const upper = withCompanion(t, '## `analysis`\nbody\n# Top\nafter\n');
  assert.equal(proseSection(upper, 'analysis').text, 'body');
});

test('a heading-looking line inside a fence neither starts nor ends a section', t => {
  const file = withCompanion(t, [
    '## `analysis`',
    'before',
    '```md',
    '## `approval`',
    '## `implementation`',
    '```',
    'after',
    '~~~',
    '# Top',
    '~~~',
    'end',
    '## `approval`',
    'gate',
  ].join('\n'));
  assert.equal(proseSection(file, 'analysis').text,
    'before\n```md\n## `approval`\n## `implementation`\n```\nafter\n~~~\n# Top\n~~~\nend');
  assert.equal(proseSection(file, 'implementation'), null);
  assert.equal(proseSection(file, 'approval').text, 'gate');
});

test('CRLF and LF input give the same slice', t => {
  const lf = withCompanion(t, GUIDE);
  const crlf = withCompanion(t, GUIDE.replace(/\n/g, '\r\n'));
  assert.deepEqual(
    { heading: proseSection(crlf, 'analysis').heading, text: proseSection(crlf, 'analysis').text },
    { heading: proseSection(lf, 'analysis').heading, text: proseSection(lf, 'analysis').text },
  );
  assert.ok(!proseSection(crlf, 'analysis').text.includes('\r'));
});

test('the heading line, trailing blank lines and trailing rules are dropped', t => {
  const file = withCompanion(t, '## analysis\nbody\n\n---\n\n---\n\n## approval\n');
  const section = proseSection(file, 'analysis');
  assert.equal(section.heading, '## analysis');
  assert.equal(section.text, 'body');
  assert.equal(proseSection(file, 'approval').text, '');
});

test('an absent section is null, and a direct: node resolves from its section when it slices, from the conventions when not', t => {
  const fenced = withCompanion(t, '# Guide\n\n```\n## `analysis`\n```\n');
  assert.equal(proseSection(fenced, 'analysis'), null);
  assert.equal(proseSection(fenced, 'nowhere'), null);
  assert.equal(proseSection(path.join(os.tmpdir(), 'no-such-definition.yml'), 'analysis'), null);
  const sectionless = JSON.parse(verb(['validate', `--definition=${fenced}`]).stdout);
  assert.deepEqual(sectionless.errors, []);
  assert.equal(sectionless.resolved.find(entry => entry.node === 'analysis').from, 'conventions');

  const present = withCompanion(t, GUIDE);
  assert.notEqual(proseSection(present, 'analysis'), null);
  const accepted = JSON.parse(verb(['validate', `--definition=${present}`]).stdout);
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.resolved.find(entry => entry.node === 'analysis').from, 'companion');
});
