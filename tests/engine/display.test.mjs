import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { displayOf, humanize, titleOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/display.mjs';
import { resolve } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { ENGINE_DIR, FIXTURES, SAMPLE, verb } from '../helpers.mjs';

const OVERLAY = path.join(FIXTURES, 'definitions/sample.overlay.yml');

const BUILTINS = fs.readdirSync(path.join(ENGINE_DIR, 'workflows'))
  .filter(name => name.endsWith('.yml'))
  .map(name => path.join(ENGINE_DIR, 'workflows', name));

/**
 * A scratch copy of the sample, its prose companion beside it, with the sample's
 * `titles:` block replaced by `titles` (raw YAML lines, indented four spaces).
 * Returns the definition's path; the directory is removed when the test ends.
 */
function sampleWithTitles(t, titles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-display-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(SAMPLE, 'utf8');
  const block = '  titles:\n    analysis: "Scope analysis"\n    approval: "Approve the scope"\n';
  assert.ok(text.includes(block), 'the sample carries the titles block this helper replaces');
  fs.writeFileSync(path.join(dir, 'sample.yml'), text.replace(block, `  titles:\n${titles.map(line => `    ${line}\n`).join('')}`));
  fs.copyFileSync(path.join(FIXTURES, 'definitions/sample.md'), path.join(dir, 'sample.md'));
  return path.join(dir, 'sample.yml');
}

function validate(args) {
  const result = verb(['validate', ...args]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

// ---------------------------------------------------------------------------
// the fallback and the merge
// ---------------------------------------------------------------------------

test('humanize: dashes become spaces and every word is capitalized', () => {
  assert.equal(humanize('gap-analysis'), 'Gap Analysis');
  assert.equal(humanize('e2e-approval'), 'E2e Approval');
  assert.equal(humanize('intake'), 'Intake');
});

test('titleOf: the title when there is one, else the humanized id', () => {
  const { titles } = displayOf({ definition: readDefinition(SAMPLE) });
  assert.equal(titleOf(titles, 'analysis'), 'Scope analysis');
  assert.equal(titleOf(titles, 'implementation'), 'Implementation');
  assert.equal(titleOf(null, 'user-docs'), 'User Docs');
});

test('displayOf: an overlay retitles a base node and titles the node it adds; a profile has the last word', () => {
  const definition = readDefinition(SAMPLE);
  const overlays = [readDefinition(OVERLAY)];
  const plain = displayOf({ definition, overlays });
  assert.equal(plain.titles.analysis, 'Impact analysis');
  assert.equal(plain.titles.approval, 'Approve the scope');
  assert.equal(plain.titles.review, 'Peer review');
  assert.equal(plain.icons.analysis, 'analysis');
  assert.equal(displayOf({ definition, overlays, profile: 'quick' }).titles.review, 'Quick review');
});

test('displayOf: a malformed title never reaches a reader', () => {
  const { titles } = displayOf({ definition: { display: { titles: { a: '', b: 'two\nlines', c: 7, d: 'Fine' } } } });
  assert.deepEqual({ ...titles }, { d: 'Fine' });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

for (const [label, line] of [
  ['an empty title', 'analysis: ""'],
  ['a whitespace-only title', 'analysis: "   "'],
  ['a title that is not a string', 'analysis: [Scope, analysis]'],
  ['a title on two lines', 'analysis: "Scope\\nanalysis"'],
]) {
  test(`validate rejects ${label} with a located error`, t => {
    const definition = sampleWithTitles(t, [line]);
    const { code, report } = validate([`--definition=${definition}`]);
    assert.equal(code, 1);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].path, 'display.titles.analysis');
    assert.equal(report.errors[0].node, 'analysis');
    assert.equal(report.errors[0].file, definition);
  });
}

test('validate rejects a titles block that is not a mapping', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-display-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const definition = path.join(dir, 'sample.yml');
  fs.writeFileSync(definition, fs.readFileSync(SAMPLE, 'utf8')
    .replace(/ {2}titles:\n(?: {4}.*\n)+/, '  titles: [Scope analysis]\n'));
  fs.copyFileSync(path.join(FIXTURES, 'definitions/sample.md'), path.join(dir, 'sample.md'));
  const { report } = validate([`--definition=${definition}`]);
  assert.deepEqual(report.errors.map(error => error.path), ['display.titles']);
});

test('a title for a node the graph does not declare warns and does not fail', t => {
  const definition = sampleWithTitles(t, ['analysis: "Scope analysis"', 'ghost: "Ghost"']);
  const { code, report } = validate([`--definition=${definition}`]);
  assert.equal(code, 0);
  assert.deepEqual(report.warnings, ['title-unknown-node:display.titles.ghost:ghost']);
});

test('the overlay fixture validates, with and without its profile', () => {
  assert.equal(validate([`--definition=${SAMPLE}`, `--overlay=${OVERLAY}`]).code, 0);
  assert.equal(validate([`--definition=${SAMPLE}`, `--overlay=${OVERLAY}`, '--profile=quick']).code, 0);
});

test('a bad title in an overlay is rejected naming the overlay, resolved and standalone', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-display-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const overlay = path.join(dir, 'bad.overlay.yml');
  fs.writeFileSync(overlay, [
    'extends: builtin:development',
    'profiles:',
    '  quick:',
    '    display:',
    '      titles:',
    '        analysis: ""',
    '',
  ].join('\n'));
  for (const args of [[`--definition=${SAMPLE}`, `--overlay=${overlay}`], [`--overlay=${overlay}`]]) {
    const { code, report } = validate(args);
    assert.equal(code, 1);
    assert.deepEqual(report.errors.map(error => [error.file, error.path]), [[overlay, 'profiles.quick.display.titles.analysis']]);
  }
});

// ---------------------------------------------------------------------------
// the hash
// ---------------------------------------------------------------------------

/** The definition as read, with its `display:` block removed. */
function withoutDisplay(read) {
  const { display: _display, ...doc } = read.doc;
  return { ...read, doc };
}

for (const file of BUILTINS) {
  const name = path.basename(file, '.yml');

  test(`built-in ${name} titles every node`, () => {
    const definition = readDefinition(file);
    const { titles } = displayOf({ definition });
    const untitled = Object.keys(definition.doc.nodes).filter(id => !Object.hasOwn(titles, id));
    assert.deepEqual(untitled, []);
  });

  test(`built-in ${name}: the display block leaves the graph hash where it was`, () => {
    const definition = readDefinition(file);
    const withDisplay = resolve({ definition });
    const bare = resolve({ definition: withoutDisplay(definition) });
    assert.equal(withDisplay.ok, true);
    assert.equal(withDisplay.graph_hash, bare.graph_hash);
  });
}

test('an overlay display block leaves the graph hash where it was', () => {
  const definition = readDefinition(SAMPLE);
  const overlay = readDefinition(OVERLAY);
  const bare = { ...overlay, doc: { ...overlay.doc, display: undefined, profiles: undefined } };
  assert.equal(
    resolve({ definition, overlays: [overlay] }).graph_hash,
    resolve({ definition: withoutDisplay(definition), overlays: [bare] }).graph_hash,
  );
});

// ---------------------------------------------------------------------------
// the diagram
// ---------------------------------------------------------------------------

test('diagram: a titled node leads its label with the title, then the id; an untitled one shows the id alone', () => {
  const result = verb(['diagram', `--definition=${SAMPLE}`, `--overlay=${OVERLAY}`, '--profile=quick']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^ {2}n_analysis\["Impact analysis<br\/>analysis<br\/>direct:analysis"\]$/m);
  assert.match(result.stdout, /^ {2}n_review\["Quick review<br\/>review<br\/>skill:implementation-verifier"\]$/m);
  assert.match(result.stdout, /^ {2}n_implementation\["implementation<br\/>skill:implementation-plan-executor"\]$/m);
});
