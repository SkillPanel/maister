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

test('a reference in a checkpoint question is refused, naming the file, the node, the field and the fix', () => {
  const definition = path.join(FIXTURES, 'definitions/ask-reference.yml');
  const result = verb(['validate', `--definition=${definition}`]);
  assert.equal(result.code, 1, 'validate exits 1');
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  const error = report.errors.find(item => item.node === 'approval');
  assert.ok(error, `an error names the gate: ${result.stdout}`);
  assert.equal(path.resolve(error.file), definition, 'the error names the definition file');
  assert.equal(error.path, 'nodes.approval.ask', 'the error names the ask field');
  assert.ok(error.message.startsWith('ask is shown to the person as written'), error.message);
  assert.match(error.message, /with:/, 'the message names where a value goes instead');
  assert.ok(!report.errors.some(item => item.node === 'implementation'), 'a reference in with: is still accepted');
});

test('a reference in an overlay gate question is refused once, at the overlay file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-ask-overlay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(SAMPLE, path.join(dir, 'sample.yml'));
  const overlay = path.join(dir, 'ask.overlay.yml');
  fs.writeFileSync(overlay, [
    'extends: sample.yml',
    'add:',
    '  sign-off:',
    '    type: gate',
    '    needs: [implementation]',
    '    ask: "Ship ${inputs.x}?"',
    '    options:',
    '      continue: continue',
    '      stop-here: stop',
    '',
  ].join('\n'));
  const result = verb(['validate', `--definition=${path.join(dir, 'sample.yml')}`, `--overlay=${overlay}`]);
  assert.equal(result.code, 1, result.stdout);
  const errors = JSON.parse(result.stdout).errors.filter(item => item.node === 'sign-off');
  assert.equal(errors.length, 1, result.stdout);
  assert.equal(path.resolve(errors[0].file), overlay);
  assert.equal(errors[0].path, 'nodes.sign-off.ask');
  assert.ok(errors[0].message.startsWith('ask is shown to the person as written'), errors[0].message);
});

// ---------------------------------------------------------------------------
// --short: the freeze's two checks, answered in fewer keys
// ---------------------------------------------------------------------------

/** A copy of the sample definition declaring a newer format, beside its prose. */
function newerSample(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-short-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.yml');
  fs.writeFileSync(file, fs.readFileSync(SAMPLE, 'utf8').replace(/^version: 1$/m, 'version: 2'));
  fs.copyFileSync(SAMPLE.replace(/\.yml$/, '.md'), path.join(dir, 'sample.md'));
  return file;
}

test('resolve --short prints exactly the freeze\'s keys, without the nodes and the tracker key', () => {
  const full = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  const short = verb(['resolve', '--short', `--definition=${SAMPLE}`]);
  assert.equal(short.code, 0, short.stderr);
  const printed = JSON.parse(short.stdout);
  assert.deepEqual(Object.keys(printed), ['ok', 'errors', 'warnings', 'degraded', 'name', 'source', 'overlays', 'profile', 'graph_hash']);
  assert.ok(!('nodes' in printed) && !('tracker_key' in printed));
  for (const key of Object.keys(printed)) assert.deepEqual(printed[key], full[key], key);
});

test('validate --short prints exactly ok, errors and warnings; a newer format still shows in warnings', t => {
  const short = verb(['validate', '--short', `--definition=${SAMPLE}`]);
  assert.equal(short.code, 0, short.stderr);
  assert.deepEqual(Object.keys(JSON.parse(short.stdout)).sort(), ['errors', 'ok', 'warnings']);

  const newer = verb(['validate', '--short', `--definition=${newerSample(t)}`]);
  assert.equal(newer.code, 0, newer.stderr);
  const report = JSON.parse(newer.stdout);
  assert.deepEqual(Object.keys(report).sort(), ['errors', 'ok', 'warnings']);
  assert.deepEqual(report.warnings, ['newer-format']);
});

test('the short forms leave the defaults and the exit codes as they were', t => {
  const resolved = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  assert.ok(Array.isArray(resolved.nodes) && 'tracker_key' in resolved);
  const validated = JSON.parse(verb(['validate', `--definition=${SAMPLE}`]).stdout);
  for (const key of ['resolved', 'counts']) assert.ok(key in validated, key);
  const newer = JSON.parse(verb(['validate', `--definition=${newerSample(t)}`]).stdout);
  assert.deepEqual(newer.degraded, ['newer-format']);

  // A refusal keeps its exit code and prints its errors in full under --short.
  const broken = path.join(FIXTURES, 'definitions', 'broken.yml');
  const full = verb(['validate', `--definition=${broken}`]);
  const short = verb(['validate', '--short', `--definition=${broken}`]);
  assert.equal(full.code, 1);
  assert.equal(short.code, 1);
  assert.deepEqual(JSON.parse(short.stdout).errors, JSON.parse(full.stdout).errors);
  assert.equal(verb(['resolve', '--short', `--definition=${broken}`]).code, verb(['resolve', `--definition=${broken}`]).code);
});
