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

// ---------------------------------------------------------------------------
// closed values: on, input types, the workflow name, the version
// ---------------------------------------------------------------------------

test('an on: outside success, failure and always is refused with the value it probably meant', t => {
  const { code, report } = validate(definition(t, [...BASE, '    on: failures']));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.wrapup.on').message, /on is one of success, failure, always; "failures" is not — did you mean "failure"\?/);
});

for (const on of ['success', 'failure', 'always']) {
  test(`on: ${on} is accepted`, t => {
    const { code, report } = validate(definition(t, [...BASE, `    on: ${on}`]));
    assert.equal(code, 0, JSON.stringify(report.errors));
  });
}

test('an input type outside string, bool and path is refused where it is declared', t => {
  const lines = replacing('  topic: {type: string, required: true}',
    '  topic: {type: string, required: true}', '  embedded: {type: boolean, default: false}', '  docs: {type: path}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.equal(report.errors.length, 1, JSON.stringify(report.errors));
  assert.match(errorAt(report, 'inputs.embedded.type').message, /an input type is one of string, bool, path; "boolean" is not/);
});

test('an input declared as a bare word is refused rather than read as undeclared', t => {
  const lines = replacing('  topic: {type: string, required: true}', '  topic: string');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'inputs.topic').message, /an input is declared as a mapping/);
});

test('a workflow name outside the closed character set is refused', t => {
  const { code, report } = validate(definition(t, replacing('name: acme', 'name: Acme Onboarding')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'name').message, /the workflow name "Acme Onboarding" is outside the closed character set/);
});

test('a quoted version is refused, not degraded past every check', t => {
  const { code, report } = validate(definition(t, replacing('version: 1', 'version: "1"')));
  assert.equal(code, 1);
  assert.deepEqual(report.degraded, []);
  assert.match(errorAt(report, 'version').message, /version 1, written as the bare number; the string "1" is not a version/);
});

// ---------------------------------------------------------------------------
// references: unclosed, and inside an artifact path
// ---------------------------------------------------------------------------

test('a reference that opens with ${ and never closes is refused', t => {
  const lines = replacing('    with: {topic: "${inputs.topic}"}', '    with: {topic: "${inputs.topic"}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.intake.with.topic').message, /opens a reference with \$\{ and never closes it/);
});

test('a reference inside an artifact path is refused, since nothing substitutes one there', t => {
  const lines = replacing('      artifacts: {notes: analysis/notes.md}', '      artifacts: {notes: "analysis/${inputs.topic}.md"}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.intake.outputs.artifacts.notes').message, /an artifact path is written literally/);
});

test('an artifact declared as a number or a map is refused', t => {
  const lines = replacing('      artifacts: {notes: analysis/notes.md}', '      artifacts: {notes: 42, extra: {path: analysis/extra.md}}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  for (const key of ['notes', 'extra']) {
    assert.match(errorAt(report, `nodes.intake.outputs.artifacts.${key}`).message, /declared as a path relative to the task directory/);
  }
});

// ---------------------------------------------------------------------------
// a newer version degrades, and is still refused a cycle
// ---------------------------------------------------------------------------

test('a newer whole-number version degrades and exits 0 on an acyclic graph', t => {
  const { code, report } = validate(definition(t, [...replacing('version: 1', 'version: 2'), '    budget: {minutes: 30}']));
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.degraded, ['newer-format']);
  assert.deepEqual(report.warnings, ['newer-format']);
});

test('a newer version with a cycle in needs is refused: the degrade does not switch the cycle check off', t => {
  const lines = replacing('    needs: []', '    needs: [wrapup]').map(line => (line === 'version: 1' ? 'version: 2' : line));
  const file = definition(t, lines);
  const { code, report } = validate(file);
  assert.equal(code, 1);
  assert.deepEqual(report.degraded, ['newer-format']);
  assert.match(errorAt(report, 'nodes').message, /needs forms a cycle: /);
  const resolved = verb(['resolve', `--definition=${file}`]);
  assert.equal(resolved.code, 1);
  assert.equal(JSON.parse(resolved.stdout).graph_hash, null);
});

// ---------------------------------------------------------------------------
// profiles: declared by an overlay, selected from one, and all of them judged
// ---------------------------------------------------------------------------

test('a profiles: block in a definition is refused: profiles live in an overlay', t => {
  const { code, report } = validate(definition(t, [...BASE, 'profiles:', '  lean: {disable: [wrapup]}']));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'profiles').message, /profiles belong to an overlay/);
});

test('a profile selected with no overlay is refused rather than recorded as applied', t => {
  const file = definition(t);
  const { code, report } = validate(file, '--profile=lean');
  assert.equal(code, 1);
  const error = errorAt(report, 'profiles.lean');
  assert.equal(error.file, file);
  assert.match(error.message, /selected with no overlay/);
  const resolved = verb(['resolve', `--definition=${file}`, '--profile=lean']);
  assert.equal(resolved.code, 1);
  assert.equal(JSON.parse(resolved.stdout).graph_hash, null);
});

test('a misspelt profile names the declared one it probably meant', t => {
  const file = definition(t);
  const lay = overlay(file, ['extends: acme', 'profiles:', '  lean: {disable: [wrapup]}', '  strict: {}']);
  const { code, report } = validate(file, `--overlay=${lay}`, '--profile=leen');
  assert.equal(code, 1);
  const error = errorAt(report, 'profiles.leen');
  assert.equal(error.file, lay);
  assert.match(error.message, /did you mean "lean"\? The declared profiles are lean, strict/);
});

test('a profile that breaks the graph fails validation even when it is not the one selected', t => {
  const file = definition(t, [...BASE, '    with: {notes: "${intake.artifacts.notes}"}']);
  const lay = overlay(file, ['extends: acme', 'profiles:', '  lean: {disable: [intake]}']);

  const unselected = validate(file, `--overlay=${lay}`);
  assert.equal(unselected.code, 1);
  const error = errorAt(unselected.report, 'nodes.wrapup.with.notes');
  assert.equal(error.file, file);
  assert.match(error.message, /^under profile "lean": "intake\.artifacts\.notes" names "intake", which no node declares/);

  const selected = validate(file, `--overlay=${lay}`, '--profile=lean');
  assert.equal(selected.code, 1);
  assert.match(errorAt(selected.report, 'nodes.wrapup.with.notes').message, /^"intake\.artifacts\.notes" names "intake"/);
});

test('with two overlays, a profile applies from the one that declares it and the other is untouched', t => {
  const file = definition(t);
  const first = overlay(file, ['extends: acme', 'profiles:', '  lean: {disable: [wrapup]}']);
  const second = path.join(path.dirname(file), 'extra.overlay.yml');
  fs.writeFileSync(second, 'extends: acme\nprofiles:\n  strict: {}\n');
  const result = verb(['resolve', `--definition=${file}`, `--overlay=${first}`, `--overlay=${second}`, '--profile=lean']);
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).nodes.map(node => node.id), ['intake', 'review-approval']);
});

// ---------------------------------------------------------------------------
// an eject or a generated chain hides an overlay of the same name
// ---------------------------------------------------------------------------

/** A project whose workflow home holds an `acme` eject and an `acme` overlay beside it. */
function ejectBesideOverlay(t) {
  const project = workspace(t);
  const home = path.join(project, '.maister', 'workflows');
  fs.mkdirSync(home, { recursive: true });
  const eject = definition(t, BASE, { dir: home });
  const lay = overlay(eject, ['extends: acme', 'disable: [wrapup]']);
  return { project, home, eject, overlay: lay };
}

test('a workflow: node naming an eject that hides an overlay warns that the overlay is ignored', t => {
  const { project, home } = ejectBesideOverlay(t);
  const caller = definition(t, [
    'name: caller', 'version: 1', 'nodes:',
    '  run-acme: {uses: "workflow:acme", needs: [], with: {topic: "onboarding"}}',
  ], { dir: home, name: 'caller' });
  const result = verb(['validate', `--definition=${caller}`], undefined, { CLAUDE_PROJECT_DIR: project });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0, JSON.stringify(report.errors));
  assert.ok(report.warnings.includes('overlay-ignored:acme:eject'), JSON.stringify(report.warnings));
  assert.equal(report.resolved.find(entry => entry.node === 'run-acme').from, 'eject');
});

test('validating the eject itself warns about the overlay beside it, unless it was passed in', t => {
  const { eject, overlay: lay } = ejectBesideOverlay(t);
  const alone = validate(eject);
  assert.equal(alone.code, 0, JSON.stringify(alone.report.errors));
  assert.deepEqual(alone.report.warnings, ['overlay-ignored:acme:eject']);

  const layered = validate(eject, `--overlay=${lay}`);
  assert.equal(layered.code, 0, JSON.stringify(layered.report.errors));
  assert.deepEqual(layered.report.warnings, []);
});
