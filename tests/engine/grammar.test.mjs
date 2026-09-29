import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { verb } from '../helpers.mjs';

// A version 1 document is closed: everything the file in hand can decide is
// decided at validate time. Each case below starts from BASE — an intake node,
// a gate and a wrap-up node that validate clean — and changes one thing.

const BASE = [
  'name: acme',
  'version: 1',
  'inputs:',
  '  topic: {type: string, required: true}',
  'nodes:',
  '  intake:',
  '    uses: direct:intake',
  '    needs: []',
  '    with: {topic: "${inputs.topic}"}',
  '    outputs:',
  '      artifacts: {notes: analysis/notes.md}',
  '      values: {deep: bool}',
  '  review-approval:',
  '    type: gate',
  '    needs: [intake]',
  '    ask: "Intake done. Continue?"',
  '    options: {continue-on: continue, stop-here: stop}',
  '  wrapup:',
  '    uses: direct:wrapup',
  '    needs: [review-approval]',
];

const PROSE = '# Acme — node prose\n\n## `intake`\n\nRead the topic.\n\n## `wrapup`\n\nClose out.\n';

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-grammar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write a definition and its prose companion; returns the definition's path. */
function definition(t, lines = BASE, { dir = workspace(t), name = 'acme' } = {}) {
  const file = path.join(dir, `${name}.yml`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, `${name}.md`), PROSE);
  return file;
}

/** Write an overlay beside a definition; returns the overlay's path. */
function overlay(file, lines, name = 'acme') {
  const at = path.join(path.dirname(file), `${name}.overlay.yml`);
  fs.writeFileSync(at, `${lines.join('\n')}\n`);
  return at;
}

/** BASE with `line` replaced by `replacement` (a list, possibly empty). */
function replacing(line, ...replacement) {
  const at = BASE.indexOf(line);
  assert.ok(at >= 0, `BASE carries no line ${line}`);
  return [...BASE.slice(0, at), ...replacement, ...BASE.slice(at + 1)];
}

function validate(file, ...flags) {
  const result = verb(['validate', `--definition=${file}`, ...flags]);
  return { ...result, report: JSON.parse(result.stdout) };
}

function errorAt(report, dotted) {
  const found = report.errors.find(error => error.path === dotted);
  assert.ok(found, `no error at ${dotted}: ${JSON.stringify(report.errors)}`);
  return found;
}

test('the base shape validates clean', t => {
  const { code, report } = validate(definition(t));
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------------------
// unknown keys
// ---------------------------------------------------------------------------

test('an unknown top-level key is refused, located and listed against the accepted ones', t => {
  const { code, report } = validate(definition(t, ['descripton: "An onboarding flow"', ...BASE]));
  assert.equal(code, 1);
  const error = errorAt(report, 'descripton');
  assert.equal(error.node, null);
  assert.match(error.message, /"descripton" is not a definition key; the accepted keys are name, version, inputs, outputs, display, nodes/);
});

test('node: for nodes: is named, with the key it most probably meant', t => {
  const { code, report } = validate(definition(t, BASE.map(line => (line === 'nodes:' ? 'node:' : line))));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'node').message, /did you mean "nodes"\?/);
});

test('a misspelt when is refused rather than dropping the guard', t => {
  const file = definition(t, [...BASE, '    whne: "${intake.values.deep}"']);
  const { code, report } = validate(file);
  assert.equal(code, 1);
  const error = errorAt(report, 'nodes.wrapup.whne');
  assert.equal(error.node, 'wrapup');
  assert.match(error.message, /"whne" is not a node key; did you mean "when"\?/);
  // Nothing hashes a graph whose guard was lost.
  const resolved = JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  assert.equal(resolved.graph_hash, null);
});

test('need: for needs: is named rather than leaving a root node', t => {
  const lines = replacing('    needs: [review-approval]', '    need: [review-approval]');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.wrapup.need').message, /did you mean "needs"\?/);
});

test('a key that only looks like a feature is refused, with no suggestion when none is close', t => {
  const { code, report } = validate(definition(t, [...BASE, '    retries: 3']));
  assert.equal(code, 1);
  const { message } = errorAt(report, 'nodes.wrapup.retries');
  assert.doesNotMatch(message, /did you mean/);
  assert.match(message, /the accepted keys are uses, needs, when/);
});

test('a reserved key still parses and warns instead of failing', t => {
  const { code, report } = validate(definition(t, [...BASE, '    loop: {max: 3}']));
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.warnings, ['reserved-key:loop']);
});

test('a gate option routes nowhere: goto is refused', t => {
  const lines = replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: continue', '      revise: {effect: stop, goto: intake}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.revise.goto').message, /is not an option key/);
});

test('an unknown display key is refused, in the definition and in an overlay', t => {
  const file = definition(t, [...BASE, 'display:', '  heroes: {findings: intake.artifacts.notes}']);
  const own = validate(file);
  assert.equal(own.code, 1);
  assert.match(errorAt(own.report, 'display.heroes').message, /the accepted keys are icons, titles/);

  const clean = definition(t);
  const lay = overlay(clean, ['extends: acme', 'display:', '  titels: {intake: "Intake"}']);
  const layered = validate(clean, `--overlay=${lay}`);
  assert.equal(layered.code, 1);
  const error = errorAt(layered.report, 'display.titels');
  assert.equal(error.file, lay);
  assert.match(error.message, /did you mean "titles"\?/);
});

test('a node output kind other than artifacts and values is refused', t => {
  const lines = replacing('      values: {deep: bool}', '      values: {deep: bool}', '      files: {extra: analysis/extra.md}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.intake.outputs.files').message, /is not an output kind/);
});

test('an unknown overlay operation, a nodes: block and an unknown profile key are refused', t => {
  const file = definition(t);
  const lay = overlay(file, [
    'extends: acme',
    'remove: [wrapup]',
    'nodes:',
    '  wrapup: {needs: [intake]}',
    'profiles:',
    '  lean: {disabel: [wrapup]}',
  ]);
  const { code, report } = validate(file, `--overlay=${lay}`);
  assert.equal(code, 1);
  for (const dotted of ['remove', 'nodes', 'profiles.lean.disabel']) assert.equal(errorAt(report, dotted).file, lay);
  assert.match(errorAt(report, 'profiles.lean.disabel').message, /did you mean "disable"\?/);
});

// ---------------------------------------------------------------------------
// before: an overlay's added node may carry it, a definition's own node may not
// ---------------------------------------------------------------------------

test('before is accepted on a node an overlay adds, in its body and in a profile', t => {
  const file = definition(t);
  const lay = overlay(file, [
    'extends: acme',
    'add:',
    '  audit: {uses: "agent:auditor", needs: [intake], before: [review-approval]}',
    'profiles:',
    '  strict:',
    '    add:',
    '      deep-audit: {uses: "agent:auditor", needs: [intake], before: [wrapup]}',
  ]);
  for (const flags of [[], ['--profile=strict']]) {
    const { code, report } = validate(file, `--overlay=${lay}`, ...flags);
    assert.equal(code, 0, JSON.stringify(report.errors));
  }
});

test('before on a definition\'s own node is refused', t => {
  const { code, report } = validate(definition(t, [...BASE, '    before: [intake]']));
  assert.equal(code, 1);
  const error = errorAt(report, 'nodes.wrapup.before');
  assert.equal(error.node, 'wrapup');
  assert.match(error.message, /before attaches a node an overlay adds/);
});

test('before on an added node must be a non-empty list of node ids', t => {
  const file = definition(t);
  const lay = overlay(file, ['extends: acme', 'add:', '  audit: {uses: "agent:auditor", needs: [intake], before: []}']);
  const { code, report } = validate(file, `--overlay=${lay}`);
  assert.equal(code, 1);
  assert.match(errorAt(report, 'add.audit.before').message, /before is a non-empty list of node ids/);
});
