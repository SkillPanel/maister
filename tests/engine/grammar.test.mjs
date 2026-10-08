import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, scratch, verb, write } from '../helpers.mjs';

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

/** BASE saying what it is for, as a workflow kept in a project's own home does. */
const DESCRIBED = ['name: acme', 'version: 1', 'description: "Walks a topic from intake to a wrap-up, with one approval between."', ...BASE.slice(2)];

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
  assert.match(error.message, /"descripton" is not a definition key; did you mean "description"\? The accepted keys are name, version, description, inputs, outputs, display, nodes/);
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

test('an artifact path with a .. segment is refused where it is declared, since it leaves the task directory', t => {
  for (const written of ['../notes.md', 'analysis/../../notes.md', 'analysis\\..\\notes.md']) {
    const lines = replacing('      artifacts: {notes: analysis/notes.md}', `      artifacts: {notes: '${written}'}`);
    const { code, report } = validate(definition(t, lines));
    assert.equal(code, 1, written);
    const error = errorAt(report, 'nodes.intake.outputs.artifacts.notes');
    assert.equal(error.node, 'intake');
    assert.match(error.message, /stays inside the run's task directory; ".*" carries a \.\. segment/);
  }
});

test('an artifact path whose name merely contains two dots is not a .. segment', t => {
  const lines = replacing('      artifacts: {notes: analysis/notes.md}', '      artifacts: {notes: analysis/notes..draft.md}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 0, JSON.stringify(report.errors));
});

test('an absolute artifact path is refused where it is declared, POSIX, drive letter and UNC alike', t => {
  const absolute = ['/tmp/notes.md', '\\analysis\\notes.md', 'C:\\notes.md', 'c:/notes.md', 'C:notes.md', '\\\\host\\share\\notes.md'];
  for (const written of absolute) {
    const lines = replacing('      artifacts: {notes: analysis/notes.md}', `      artifacts: {notes: '${written}'}`);
    const { code, report } = validate(definition(t, lines));
    assert.equal(code, 1, written);
    const error = errorAt(report, 'nodes.intake.outputs.artifacts.notes');
    assert.equal(error.node, 'intake');
    assert.ok(error.message.includes(`stays inside the run's task directory; "${written}" is absolute`), error.message);
  }
});

test('a relative artifact path is accepted, a colon in a later segment included', t => {
  for (const written of ['analysis/notes.md', 'analysis/a:b.md']) {
    const lines = replacing('      artifacts: {notes: analysis/notes.md}', `      artifacts: {notes: '${written}'}`);
    const { code, report } = validate(definition(t, lines));
    assert.equal(code, 0, `${written}: ${JSON.stringify(report.errors)}`);
  }
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
  const eject = definition(t, DESCRIBED, { dir: home });
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

// ---------------------------------------------------------------------------
// on: failure runs only when a need failed; on: always runs once every need ended
// ---------------------------------------------------------------------------

/**
 * A run frozen at its gate, with an audit behind it and three followers:
 * `finalize` (the default), `cleanup` (`on: always`) and `recover`
 * (`on: failure`), each needing the audit. `statuses` is what the nodes after
 * the gate have recorded when the brief is composed.
 */
function atGateWithFollowers(t, statuses) {
  const run = scratch(t);
  const file = path.join(run.root, 'acme.yml');
  fs.writeFileSync(file, [
    'name: acme', 'version: 1', 'nodes:',
    '  review: {uses: "direct:review", needs: []}',
    '  review-approval:', '    type: gate', '    needs: [review]', '    ask: "Reviewed. Audit it?"',
    '    options: {continue-on: continue, stop-here: stop}',
    '  audit: {uses: "direct:audit", needs: [review-approval]}',
    '  finalize: {uses: "direct:finalize", needs: [audit]}',
    '  cleanup: {uses: "direct:cleanup", needs: [audit], on: always}',
    '  recover: {uses: "direct:recover", needs: [audit], on: failure}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'acme.md'),
    ['review', 'audit', 'finalize', 'cleanup', 'recover'].map(id => `## \`${id}\`\n\nDo it.\n`).join('\n'));
  freeze(run, { definition: file });
  const nodes = { review: { status: 'completed' }, 'review-approval': { status: 'completed' } };
  for (const [id, status] of Object.entries(statuses)) nodes[id] = { status };
  write(run, { nodes, node_summaries: { review: { status: 'completed', summary: 'Reviewed.' } } });
  return run;
}

function nextAt(run) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=review-approval']);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.split('\n').find(line => line.startsWith('Next: '));
}

test('on: failure is skipped when every need completed, rather than running on the happy path', t => {
  const run = atGateWithFollowers(t, { audit: 'completed', finalize: 'completed', cleanup: 'completed' });
  assert.equal(nextAt(run), 'Next: end of run (skipping Recover)');
});

test('on: failure runs when a need failed', t => {
  const run = atGateWithFollowers(t, { audit: 'failed', cleanup: 'completed' });
  assert.equal(nextAt(run), 'Next: Recover');
});

test('on: always runs once its need has ended, even when it failed', t => {
  const run = atGateWithFollowers(t, { audit: 'failed' });
  assert.equal(nextAt(run), 'Next: Cleanup');
});

test('on: failure waits while its need has not ended, and is not skipped early', t => {
  const run = atGateWithFollowers(t, {});
  assert.equal(nextAt(run), 'Next: Audit');
});

// ---------------------------------------------------------------------------
// optional and gate-option values have left the grammar
// ---------------------------------------------------------------------------

test('optional is no longer a node key', t => {
  const { code, report } = validate(definition(t, [...BASE, '    optional: true']));
  assert.equal(code, 1);
  const { message } = errorAt(report, 'nodes.wrapup.optional');
  assert.match(message, /"optional" is not a node key: it was accepted without ever changing how a run behaves/);
  assert.doesNotMatch(message, /did you mean/);
});

test('optional is no longer tunable by an overlay', t => {
  const file = definition(t);
  const lay = overlay(file, ['extends: acme', 'tune:', '  wrapup: {optional: true}']);
  const { code, report } = validate(file, `--overlay=${lay}`);
  assert.equal(code, 1);
  assert.match(errorAt(report, 'tune.wrapup.optional').message, /only with, provider may be tuned; "optional" may not/);
});

test('a gate option carries its effect only: values is refused', t => {
  const lines = replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: {effect: continue, values: {deep: true}}', '      stop-here: stop');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.continue-on.values').message, /"values" is not an option key: an option emits no values/);
});

test('a gate declares no outputs, so no guard can read a value it would never record', t => {
  const lines = replacing('    ask: "Intake done. Continue?"', '    ask: "Intake done. Continue?"', '    outputs: {values: {deep: bool}}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.outputs').message, /a gate records only the option chosen and declares no outputs/);
});

// ---------------------------------------------------------------------------
// a gate option's two spellings are one option
// ---------------------------------------------------------------------------

test('a gate option written as a map hashes and draws exactly as its bare effect', t => {
  const bare = definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: continue', '      stop-here: stop'));
  const mapped = definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: {effect: continue}', '      stop-here: {effect: stop}'));

  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const [left, right] = [hashOf(bare), hashOf(mapped)];
  assert.equal(left.ok, true, JSON.stringify(left.errors));
  assert.equal(right.graph_hash, left.graph_hash);
  const gate = right.nodes.find(node => node.id === 'review-approval');
  assert.deepEqual({ ...gate.options }, { 'continue-on': 'continue', 'stop-here': 'stop' });

  const [drawnBare, drawnMapped] = [bare, mapped].map(file => verb(['diagram', `--definition=${file}`]));
  assert.equal(drawnMapped.code, 0, drawnMapped.stderr);
  assert.equal(drawnMapped.stdout, drawnBare.stdout);
  assert.match(drawnMapped.stdout, /continue-on: continue, stop-here: stop/);
  assert.doesNotMatch(drawnMapped.stdout, /#quot;|effect/);
});

// ---------------------------------------------------------------------------
// description: what the workflow is for, outside the hash
// ---------------------------------------------------------------------------


test('a description validates and leaves the graph hash where it was', t => {
  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const plain = hashOf(definition(t));
  const described = hashOf(definition(t, DESCRIBED));
  assert.equal(described.ok, true, JSON.stringify(described.errors));
  assert.deepEqual(described.warnings, []);
  assert.equal(described.graph_hash, plain.graph_hash);
});

test('a description is one paragraph of text on one line', t => {
  for (const written of ['description: {what: acme}', 'description: ""', 'description: "Two lines:\\nhere."', 'description: 42']) {
    const { code, report } = validate(definition(t, ['name: acme', 'version: 1', written, ...BASE.slice(2)]));
    assert.equal(code, 1, written);
    assert.match(errorAt(report, 'description').message, /description is one paragraph of plain text/, written);
  }
});

test('an overlay says nothing about what the workflow is for', t => {
  const file = definition(t);
  const lay = overlay(file, ['extends: acme', 'description: "A lighter acme."']);
  const { code, report } = validate(file, `--overlay=${lay}`);
  assert.equal(code, 1);
  assert.match(errorAt(report, 'description').message, /"description" is not an overlay key/);
});

/** A project's `.maister/workflows/` (or `generated/` under it) in a scratch root. */
function projectHome(t, sub = '') {
  const dir = path.join(workspace(t), '.maister', 'workflows', sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const undescribed = report => report.warnings.filter(warning => warning.startsWith('workflow-undescribed:'));

test('a project workflow that says nowhere what it is for is warned about, naming both places to say it', t => {
  const { code, report } = validate(definition(t, BASE, { dir: projectHome(t) }));
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(undescribed(report).length, 1);
  assert.match(undescribed(report)[0], /^workflow-undescribed:acme — the work command offers a project workflow by what it is for/);
  assert.match(undescribed(report)[0], /description:/);
  assert.match(undescribed(report)[0], /prose companion/);
});

test('a description, or a paragraph under the companion\'s title, is enough', t => {
  const described = validate(definition(t, DESCRIBED, { dir: projectHome(t) })).report;
  assert.deepEqual(undescribed(described), []);

  const file = definition(t, BASE, { dir: projectHome(t) });
  fs.writeFileSync(file.replace(/\.yml$/, '.md'), PROSE.replace('\n\n## `intake`', '\n\nWalks a topic from intake to a wrap-up.\n\n## `intake`'));
  assert.deepEqual(undescribed(validate(file).report), []);
});

test('only the definitions the work command lists are judged', t => {
  // Outside a project's workflow home: a draft, or a fixture.
  assert.deepEqual(undescribed(validate(definition(t)).report), []);
  // A generated chain belongs to the ticket it was planned for.
  assert.deepEqual(undescribed(validate(definition(t, BASE, { dir: projectHome(t, 'generated') })).report), []);
  // An eject of a built-in is reached through that workflow's own command.
  const eject = ['name: research', 'version: 1', 'nodes:', '  look:', '    uses: skill:quick-plan', '    needs: []'];
  assert.deepEqual(undescribed(validate(definition(t, eject, { dir: projectHome(t), name: 'research' })).report), []);
});

// ---------------------------------------------------------------------------
// an input declares its type, required, default and tracker_key, and nothing else
// ---------------------------------------------------------------------------

test('a misspelt input key is refused with the key it most probably meant', t => {
  const lines = replacing('  topic: {type: string, required: true}', '  topic: {type: string, requried: true}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'inputs.topic.requried').message,
    /"requried" is not an input key; did you mean "required"\? The accepted keys are type, required, default, tracker_key/);
});

// ---------------------------------------------------------------------------
// ask and options make a gate, and only a gate carries them
// ---------------------------------------------------------------------------

test('a task node carrying a gate\'s question or options is refused, key by key', t => {
  const lines = replacing('    uses: direct:wrapup', '    uses: direct:wrapup', '    ask: "Wrap up?"', '    options: {go: continue, halt: stop}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  for (const key of ['ask', 'options']) {
    const error = errorAt(report, `nodes.wrapup.${key}`);
    assert.equal(error.node, 'wrapup');
    assert.match(error.message, new RegExp(`${key} belongs to a gate, and this node runs direct:wrapup; add type: gate`));
  }
});

// ---------------------------------------------------------------------------
// a sub-run's required inputs: a default stands in, as it does at the freeze
// ---------------------------------------------------------------------------

test('a child input that is required but carries a default is not missing when the parent omits it', t => {
  const project = workspace(t);
  const home = path.join(project, '.maister', 'workflows');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'kid.yml'), [
    'name: kid', 'version: 1', 'description: "A child for the sub-run input check."',
    'inputs:',
    '  subject: {type: string, required: true}',
    '  depth: {type: string, required: true, default: standard}',
    'nodes:', '  look: {uses: "skill:quick-plan", needs: []}', '',
  ].join('\n'));
  const parent = passed => definition(t, [
    'name: parent', 'version: 1', 'nodes:',
    `  run-kid: {uses: "workflow:kid", needs: []${passed ? `, with: ${passed}` : ''}}`,
  ], { name: 'parent' });
  const warningsOf = file => {
    const result = verb(['validate', `--definition=${file}`], undefined, { CLAUDE_PROJECT_DIR: project });
    return JSON.parse(result.stdout).warnings.filter(warning => warning.startsWith('unresolved-subrun-input:'));
  };
  assert.deepEqual(warningsOf(parent('{subject: "the api"}')), []);
  assert.deepEqual(warningsOf(parent(null)), ['unresolved-subrun-input:run-kid:subject']);
});

test('an enum member that is not a string is refused as one', t => {
  const lines = replacing('      values: {deep: bool}', '      values: {depth: {enum: [shallow, 3]}}');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.intake.outputs.values.depth').message, /every enum member must be a non-empty string/);
});

// ---------------------------------------------------------------------------
// the revise effect: one bounded back-edge, carried on the option
// ---------------------------------------------------------------------------

/** BASE with a draft node before intake's gate, and the gate offering `revise` to `target`. */
function revising(target, extra = []) {
  return [
    ...BASE.slice(0, BASE.indexOf('  review-approval:')),
    ...extra,
    '  review-approval:',
    '    type: gate',
    '    needs: [intake]',
    '    ask: "Intake done. Continue?"',
    '    options:',
    '      continue-on: continue',
    `      send-back: {effect: revise, reruns: ${target}}`,
    '      stop-here: stop',
    '  wrapup:',
    '    uses: direct:wrapup',
    '    needs: [review-approval]',
  ];
}

test('a revise option naming a task node behind its gate is accepted', t => {
  const { code, report } = validate(definition(t, revising('intake')));
  assert.equal(code, 0, JSON.stringify(report.errors));
});

test('a revise option must name a node its gate waits on', t => {
  const { code, report } = validate(definition(t, revising('wrapup')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.send-back.reruns').message,
    /reruns names "wrapup", which this gate does not wait on/);
});

test('a revise option naming a node nobody declares is refused', t => {
  const { code, report } = validate(definition(t, revising('draft')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.send-back.reruns').message, /which no node declares/);
});

test('a revise option may not name a gate', t => {
  const lines = [
    ...BASE.slice(0, BASE.indexOf('  review-approval:')),
    '  first-approval:',
    '    type: gate',
    '    needs: [intake]',
    '    ask: "First?"',
    '    options: {go: continue, halt: stop}',
    '  review-approval:',
    '    type: gate',
    '    needs: [first-approval]',
    '    ask: "Again?"',
    '    options:',
    '      continue-on: continue',
    '      send-back: {effect: revise, reruns: first-approval}',
    '      stop-here: stop',
  ];
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.send-back.reruns').message, /names the gate "first-approval"/);
});

test('a revise option may not re-run a sub-run, nor a stretch that holds one', t => {
  const lines = revising('intake', ['  child:', '    uses: "workflow:kid"', '    needs: [intake]']);
  lines[lines.indexOf('  review-approval:') + 2] = '    needs: [child]';
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.send-back.reruns').message,
    /holds the sub-run "child", and a revise cannot re-run a sub-run/);
});

test('a revise option carries reruns, and no other effect does', t => {
  const bare = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: continue', '      send-back: revise', '      stop-here: stop')));
  assert.equal(bare.code, 1);
  assert.match(errorAt(bare.report, 'nodes.review-approval.options.send-back.reruns').message,
    /a revise option names the node it sends the run back to/);

  const stray = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: continue', '      stop-here: {effect: stop, reruns: intake}')));
  assert.equal(stray.code, 1);
  assert.match(errorAt(stray.report, 'nodes.review-approval.options.stop-here.reruns').message, /reruns belongs to a revise option/);
});

test('a gate option named more-details is refused: the picker reserves it for the full brief', t => {
  const { code, report } = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options: {continue-on: continue, more-details: stop}')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.more-details').message, /is reserved for the picker's request for the full brief/);
});

test('an unknown effect names all three', t => {
  const { code, report } = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: continue', '      jump: goto', '      stop-here: stop')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.jump').message, /an option effect is "continue", "stop" or "revise", never "goto"/);
});

test('several revise options are accepted; a second continue that sets nothing is refused', t => {
  const several = [...revising('intake')];
  several.splice(several.indexOf('      stop-here: stop'), 0, '      redo-intake: {effect: revise, reruns: intake}');
  assert.equal(validate(definition(t, several)).code, 0);

  const twice = [...revising('intake')];
  twice.splice(twice.indexOf('      stop-here: stop'), 0, '      also-on: continue');
  const { code, report } = validate(definition(t, twice));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options.also-on.sets').message,
    /this gate offers 2 continue options, and each must set the gate values that tell it from the others; "also-on" sets none/);
  assert.match(errorAt(report, 'nodes.review-approval.options.continue-on.sets').message, /"continue-on" sets none/);
});

test('a gate with no continue, or no stop, is refused at its options', t => {
  const { code, report } = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options: {stop-here: stop}')));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.review-approval.options').message,
    /at least one continue and at least one stop, and any number of revise; this one offers 0 and 1/);
});

test('a revise option is hashed whole: it moves the hash of the definition that adopts it and draws its target', t => {
  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const plain = hashOf(definition(t));
  const revised = hashOf(definition(t, revising('intake')));
  assert.equal(revised.ok, true, JSON.stringify(revised.errors));
  assert.notEqual(revised.graph_hash, plain.graph_hash);
  const gate = revised.nodes.find(node => node.id === 'review-approval');
  assert.deepEqual({ ...gate.options['send-back'] }, { effect: 'revise', reruns: 'intake' });

  const drawn = verb(['diagram', `--definition=${definition(t, revising('intake'))}`]);
  assert.equal(drawn.code, 0, drawn.stderr);
  assert.match(drawn.stdout, /send-back: revise → intake/);
});

// ---------------------------------------------------------------------------
// grants: what answering a continue option authorises beyond the run
// ---------------------------------------------------------------------------

/** BASE with the gate's options written out, `continue-on` carrying `continueOn`. */
function granting(continueOn, ...others) {
  return replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', `      continue-on: ${continueOn}`, ...(others.length ? others : ['      stop-here: stop']));
}

test('a continue option may declare the grants its answer gives', t => {
  const { code, report } = validate(definition(t, granting('{effect: continue, grants: [push, pr-create]}')));
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(validate(definition(t, granting('{effect: continue, grants: [pr-create]}'))).code, 0);
});

test('grants outside the closed set, repeated, empty or not a list are refused at the option', t => {
  const at = 'nodes.review-approval.options.continue-on.grants';
  const cases = [
    ['{effect: continue, grants: [pussh]}', /"pussh" is not a grant; did you mean "push"\? the grants are push, pr-create/],
    ['{effect: continue, grants: [merge]}', /"merge" is not a grant; the grants are push, pr-create/],
    ['{effect: continue, grants: [push, push]}', /grants names "push" twice/],
    ['{effect: continue, grants: []}', /grants is a list naming at least one of push, pr-create; an empty list is not/],
    ['{effect: continue, grants: push}', /grants is a list naming at least one of push, pr-create; "push" is not/],
  ];
  for (const [option, message] of cases) {
    const { code, report } = validate(definition(t, granting(option)));
    assert.equal(code, 1, option);
    assert.match(errorAt(report, at).message, message, option);
  }
});

test('grants belong to the continue option: a stop or a revise carrying them is refused', t => {
  const stop = validate(definition(t, granting('continue', '      stop-here: {effect: stop, grants: [push]}')));
  assert.equal(stop.code, 1);
  assert.match(errorAt(stop.report, 'nodes.review-approval.options.stop-here.grants').message,
    /grants belongs to the continue option; a stop option leads to no node that would act on what it grants/);

  const revise = validate(definition(t, granting('continue',
    '      send-back: {effect: revise, reruns: intake, grants: [push]}', '      stop-here: stop')));
  assert.equal(revise.code, 1);
  assert.match(errorAt(revise.report, 'nodes.review-approval.options.send-back.grants').message, /a revise option leads to no node/);
});

test('grants outside a gate option are refused by the node key set', t => {
  const lines = [...BASE];
  lines.splice(lines.indexOf('    uses: direct:wrapup'), 0, '    grants: [push]');
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.wrapup.grants').message, /"grants" is not a node key/);
});

test('grants are part of the graph identity, and the order they are written in is not', t => {
  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const plain = hashOf(definition(t));
  const both = hashOf(definition(t, granting('{effect: continue, grants: [push, pr-create]}')));
  const reversed = hashOf(definition(t, granting('{effect: continue, grants: [pr-create, push]}')));
  const pushOnly = hashOf(definition(t, granting('{effect: continue, grants: [push]}')));
  assert.equal(both.ok, true, JSON.stringify(both.errors));
  assert.notEqual(both.graph_hash, plain.graph_hash, 'adopting a grant moves the hash');
  assert.notEqual(pushOnly.graph_hash, both.graph_hash, 'what is granted moves the hash');
  assert.equal(reversed.graph_hash, both.graph_hash, 'the written order does not');
  assert.equal(hashOf(definition(t, granting('{effect: continue}'))).graph_hash, plain.graph_hash,
    'the long spelling without grants is still the bare effect');
  const gate = reversed.nodes.find(node => node.id === 'review-approval');
  assert.deepEqual(JSON.parse(JSON.stringify(gate.options['continue-on'])), { effect: 'continue', grants: ['push', 'pr-create'] });

  const drawn = verb(['diagram', `--definition=${definition(t, granting('{effect: continue, grants: [push]}'))}`]);
  assert.equal(drawn.code, 0, drawn.stderr);
  assert.match(drawn.stdout, /continue-on: continue/);
});

// ---------------------------------------------------------------------------
// sets: a continue option that sets a gate value a later guard reads
// ---------------------------------------------------------------------------

/** BASE with two continues setting `audit`, an audit node guarded on it, and `extra` options after them. */
function setting({ on = '{effect: continue, sets: {audit: true}}', past = '{effect: continue, sets: {audit: false}}', extra = ['      stop-here: stop'], guard = '"${review-approval.values.audit}"' } = {}) {
  return [
    ...replacing('    options: {continue-on: continue, stop-here: stop}',
      '    options:', `      continue-on: ${on}`, `      continue-past: ${past}`, ...extra),
    '  audit:',
    '    uses: direct:wrapup',
    '    needs: [review-approval]',
    ...(guard === null ? [] : [`    when: ${guard}`]),
  ];
}

test('a gate may offer several continues when each sets its own combination of the same values', t => {
  const { code, report } = validate(definition(t, setting()));
  assert.equal(code, 0, JSON.stringify(report.errors));
  const one = validate(definition(t, replacing('    options: {continue-on: continue, stop-here: stop}',
    '    options:', '      continue-on: {effect: continue, sets: {audit: true}}', '      stop-here: stop')));
  assert.equal(one.code, 0, 'a single continue may carry sets');
});

test('a guard and a reference may read a value a gate continue sets; any other gate value is refused', t => {
  assert.equal(validate(definition(t, setting({ guard: '"!${review-approval.values.audit}"' }))).code, 0);
  const referenced = setting();
  referenced.push('    with: {audit: "${review-approval.values.audit}"}');
  assert.equal(validate(definition(t, referenced)).code, 0);

  const { code, report } = validate(definition(t, setting({ guard: '"${review-approval.values.deep}"' })));
  assert.equal(code, 1);
  assert.match(errorAt(report, 'nodes.audit.when').message,
    /when needs a declared bool output or a value a gate's continue sets; "review-approval.values.deep" is not one/);
  const stray = setting({ guard: null });
  stray.push('    with: {deep: "${review-approval.values.deep}"}');
  assert.match(errorAt(validate(definition(t, stray)).report, 'nodes.audit.with.deep').message,
    /names an output "review-approval" does not declare/);
});

test('sets is refused off a continue, empty, non-boolean or with a key outside the guard pattern', t => {
  const at = 'nodes.review-approval.options';
  const stop = validate(definition(t, setting({ extra: ['      stop-here: {effect: stop, sets: {audit: false}}'] })));
  assert.match(errorAt(stop.report, `${at}.stop-here.sets`).message, /sets belongs to a continue option; a stop option leaves no gate value/);
  const revise = validate(definition(t, setting({ extra: ['      send-back: {effect: revise, reruns: intake, sets: {audit: true}}', '      stop-here: stop'] })));
  assert.match(errorAt(revise.report, `${at}.send-back.sets`).message, /a revise option leaves no gate value/);
  for (const [written, pattern, where] of [
    ['{effect: continue, sets: {}}', /sets is a map of gate value to true or false, naming at least one; an empty map is not/, 'continue-on.sets'],
    ['{effect: continue, sets: [audit]}', /sets is a map of gate value to true or false/, 'continue-on.sets'],
    ['{effect: continue, sets: {audit: yes}}', /a gate value is true or false; "yes" is not/, 'continue-on.sets.audit'],
    ['{effect: continue, sets: {Audit-x: true}}', /the gate value "Audit-x" is outside the closed character set/, 'continue-on.sets.Audit-x'],
  ]) {
    const { code, report } = validate(definition(t, setting({ on: written, guard: null })));
    assert.equal(code, 1, written);
    assert.match(errorAt(report, `${at}.${where}`).message, pattern, written);
  }
});

test('several continues name the same values and never the same combination', t => {
  const at = 'nodes.review-approval.options.continue-past.sets';
  const mismatched = validate(definition(t, setting({ past: '{effect: continue, sets: {other: false}}', guard: null })));
  assert.equal(mismatched.code, 1);
  assert.match(errorAt(mismatched.report, at).message,
    /every continue of a gate sets the same values; "continue-past" sets other and "continue-on" sets audit/);
  const same = validate(definition(t, setting({ past: '{effect: continue, sets: {audit: true}}' })));
  assert.equal(same.code, 1);
  assert.match(errorAt(same.report, at).message,
    /"continue-past" sets the same values as "continue-on", so the two answers would be one route/);
});

test('sets is part of the graph identity, and the order its keys are written in is not', t => {
  const hashOf = file => JSON.parse(verb(['resolve', `--definition=${file}`]).stdout);
  const both = ['{effect: continue, sets: {audit: true, docs: false}}', '{effect: continue, sets: {audit: false, docs: false}}'];
  const first = hashOf(definition(t, setting({ on: both[0], past: both[1] })));
  const reordered = hashOf(definition(t, setting({ on: '{effect: continue, sets: {docs: false, audit: true}}', past: both[1] })));
  const flipped = hashOf(definition(t, setting({ on: '{effect: continue, sets: {audit: true, docs: true}}', past: both[1] })));
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(reordered.graph_hash, first.graph_hash, 'the written key order does not move the hash');
  assert.notEqual(flipped.graph_hash, first.graph_hash, 'what is set moves the hash');
  const gate = first.nodes.find(node => node.id === 'review-approval');
  assert.deepEqual(JSON.parse(JSON.stringify(gate.options['continue-on'])), { effect: 'continue', sets: { audit: true, docs: false } });
});

test('a workflow may expose a value a gate continue sets', t => {
  const lines = ['name: acme', 'version: 1', 'outputs:', '  values: {audited: review-approval.values.audit}', ...setting().slice(2)];
  const { code, report } = validate(definition(t, lines));
  assert.equal(code, 0, JSON.stringify(report.errors));
});
