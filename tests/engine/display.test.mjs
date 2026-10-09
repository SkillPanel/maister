import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { HEADER_MAX, displayOf, headerOf, humanize, labelOf, sentence, titleOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/display.mjs';
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

test('humanize: dashes become spaces and the id reads in sentence case', () => {
  assert.equal(humanize('gap-analysis'), 'Gap analysis');
  assert.equal(humanize('intake'), 'Intake');
});

test('humanize: a known acronym reads in capitals wherever it stands', () => {
  assert.equal(humanize('deliver-notes-api'), 'Deliver notes API');
  assert.equal(humanize('e2e-approval'), 'E2E approval');
  assert.equal(humanize('ui-review'), 'UI review');
  assert.equal(humanize('export-csv-to-url'), 'Export CSV to URL');
  assert.equal(humanize('apis-review'), 'Apis review', 'a word that only starts like one is not an acronym');
});

test('titleOf: the title when there is one, else the humanized id', () => {
  const { titles } = displayOf({ definition: readDefinition(SAMPLE) });
  assert.equal(titleOf(titles, 'analysis'), 'Scope analysis');
  assert.equal(titleOf(titles, 'implementation'), 'Implementation');
  assert.equal(titleOf(null, 'user-docs'), 'User docs');
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

test('sentence: dashes become spaces and only the first word is capitalized', () => {
  assert.equal(sentence('continue-past-analysis'), 'Continue past analysis');
  assert.equal(sentence('stop'), 'Stop');
});

test('labelOf: the definition\'s label when there is one, else the id in sentence case', () => {
  const labels = displayOf({ definition: { display: { option_labels: { approval: { continue: 'Go on' } } } } }).option_labels;
  assert.equal(labelOf(labels, 'approval', 'continue'), 'Go on');
  assert.equal(labelOf(labels, 'approval', 'stop-here'), 'Stop here');
  assert.equal(labelOf(null, 'other', 'continue-to-planning'), 'Continue to planning');
});

test('displayOf: an overlay relabels one option and keeps the base label of the other; a profile has the last word', () => {
  const base = { display: { option_labels: { approval: { continue: 'Continue', 'stop-here': 'Stop here' } }, headers: { approval: 'Scope' } } };
  const overlay = { display: { option_labels: { approval: { continue: 'Go on' } } }, profiles: { quick: { display: { headers: { approval: 'Quick scope' } } } } };
  const plain = displayOf({ definition: base, overlays: [overlay] });
  assert.deepEqual({ ...plain.option_labels.approval }, { continue: 'Go on', 'stop-here': 'Stop here' });
  assert.equal(plain.headers.approval, 'Scope');
  assert.equal(displayOf({ definition: base, overlays: [overlay], profile: 'quick' }).headers.approval, 'Quick scope');
});

test('displayOf: a malformed label or an overlong header never reaches a reader', () => {
  const display = displayOf({ definition: { display: {
    option_labels: { a: { x: '', y: 'two\nlines', z: 'Fine' }, b: 'not a map' },
    headers: { a: 'Thirteen char', b: 'Twelve chars' },
  } } });
  assert.deepEqual({ ...display.option_labels.a }, { z: 'Fine' });
  assert.equal(Object.hasOwn(display.option_labels, 'b'), false);
  assert.deepEqual({ ...display.headers }, { b: 'Twelve chars' });
});

test('headerOf: the own header, else the closing node\'s title when it fits, else the gate\'s title cut to fit', () => {
  const titles = { analysis: 'Scope analysis', approval: 'Approve the scope', spec: 'Spec' };
  assert.equal(headerOf({ headers: { approval: 'Scope' }, titles }, 'approval', 'analysis'), 'Scope');
  assert.equal(headerOf({ headers: {}, titles }, 'approval', 'spec'), 'Spec');
  const cut = headerOf({ headers: {}, titles }, 'approval', 'analysis');
  assert.equal(cut, 'Approve the…');
  assert.ok([...cut].length <= HEADER_MAX);
  assert.equal(headerOf({ headers: {}, titles: {} }, 'gap-approval', null), 'Gap approval');
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

/**
 * A scratch copy of the sample with `lines` (raw YAML, indented two spaces)
 * appended to its `display:` block. Returns the definition's path.
 */
function sampleWithDisplay(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-display-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(SAMPLE, 'utf8');
  const block = '    approval: "Approve the scope"\n';
  assert.ok(text.includes(block));
  fs.writeFileSync(path.join(dir, 'sample.yml'), text.replace(block, `${block}${lines.map(line => `  ${line}\n`).join('')}`));
  fs.copyFileSync(path.join(FIXTURES, 'definitions/sample.md'), path.join(dir, 'sample.md'));
  return path.join(dir, 'sample.yml');
}

test('option labels and a header for a gate validate cleanly', t => {
  const definition = sampleWithDisplay(t, ['option_labels:', '  approval:', '    continue: "Continue to implementation"',
    '    stop-here: "Stop here"', 'headers:', '  approval: "Scope"']);
  const { code, report } = validate([`--definition=${definition}`]);
  assert.equal(code, 0, JSON.stringify(report));
  assert.deepEqual(report.warnings, []);
});

for (const [label, lines, where] of [
  ['an empty option label', ['option_labels:', '  approval:', '    continue: ""'], 'display.option_labels.approval.continue'],
  ['a gate entry that is not a mapping', ['option_labels:', '  approval: "Continue"'], 'display.option_labels.approval'],
  ['an option_labels block that is not a mapping', ['option_labels: [a]'], 'display.option_labels'],
  ['a header longer than the chip', ['headers:', '  approval: "Approve the scope"'], 'display.headers.approval'],
  ['a header on two lines', ['headers:', '  approval: "Sc\\nope"'], 'display.headers.approval'],
]) {
  test(`validate rejects ${label} with a located error`, t => {
    const { code, report } = validate([`--definition=${sampleWithDisplay(t, lines)}`]);
    assert.equal(code, 1);
    assert.deepEqual(report.errors.map(error => error.path), [where]);
  });
}

test('a label or a header for a node that is not a gate, or for an option the gate lacks, warns and does not fail', t => {
  const definition = sampleWithDisplay(t, ['option_labels:', '  analysis:', '    continue: "Go"', '  ghost:', '    continue: "Go"',
    '  approval:', '    rescan: "Scan again"', 'headers:', '  analysis: "Scope"', '  ghost: "Ghost"']);
  const { code, report } = validate([`--definition=${definition}`]);
  assert.equal(code, 0, JSON.stringify(report));
  assert.deepEqual(report.warnings.sort(), [
    'header-unknown-node:display.headers.analysis:analysis',
    'header-unknown-node:display.headers.ghost:ghost',
    'option-label-unknown-node:display.option_labels.analysis:analysis',
    'option-label-unknown-node:display.option_labels.ghost:ghost',
    'option-label-unknown-option:display.option_labels.approval.rescan:approval',
  ]);
});

test('no built-in continue label names a destination a guard can skip', () => {
  // "Continue to the specification audit" read while Next said the audit was
  // skipped. A label "Continue" alone is completed from the walk instead. A
  // continue that sets the gate values the guard after it reads decides the
  // destination itself, so its label may name where it leads — but only when
  // every guarded node after the gate reads this gate's values. A node guarded
  // by the negation of the gate's own guard never runs where the gate is asked,
  // so it is no destination of the gate's labels.
  const negation = when => (when.startsWith('!') ? when.slice(1) : `!${when}`);
  const offenders = [];
  for (const file of BUILTINS) {
    const { doc } = readDefinition(file);
    const nodes = doc.nodes ?? {};
    const labels = doc.display?.option_labels ?? {};
    for (const [gate, node] of Object.entries(nodes)) {
      if (node.type !== 'gate') continue;
      const after = Object.entries(nodes).filter(([, each]) => (each.needs ?? []).includes(gate));
      const exclusive = ([, each]) => typeof node.when === 'string' && !node.when.includes('||') && each.when === negation(node.when);
      const guarded = after.filter(([, each]) => typeof each.when === 'string').filter(entry => !exclusive(entry)).map(([id]) => id);
      for (const [option, effect] of Object.entries(node.options ?? {})) {
        const label = labels[gate]?.[option];
        if ((effect?.effect ?? effect) !== 'continue' || typeof label !== 'string' || !/^Continue to /.test(label)) continue;
        const decided = effect?.sets !== undefined && guarded.every(id => nodes[id].when.includes(`\${${gate}.values.`));
        if (guarded.length && !decided) offenders.push(`${path.basename(file)} ${gate}.${option} "${label}" (guarded: ${guarded.join(', ')})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
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

  test(`built-in ${name} labels every gate option and gives every gate a header`, () => {
    const definition = readDefinition(file);
    const { option_labels: labels, headers } = displayOf({ definition });
    const gates = Object.entries(definition.doc.nodes).filter(([, node]) => node.type === 'gate');
    assert.ok(gates.length > 0);
    for (const [id, node] of gates) {
      assert.ok(Object.hasOwn(headers, id), `${name}: ${id} has no header`);
      for (const option of Object.keys(node.options)) {
        assert.ok(labels[id] && Object.hasOwn(labels[id], option), `${name}: ${id}.${option} has no label`);
      }
    }
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
