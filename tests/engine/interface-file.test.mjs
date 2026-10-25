import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES, ROOT, freeze, run, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// The interface file each plugin tree carries is generated from its code
// (tools/interface.mjs) and is what a consumer diffs between two pins. These
// tests hold the gate-request builders to the keys it declares, keep the
// committed files fresh, and show that regeneration alone picks up a change.

const GENERATOR = path.join(ROOT, 'tools/interface.mjs');
const SOURCE = path.join(ROOT, 'plugins/maister');
const VARIANT = path.join(ROOT, 'plugins/maister-copilot');
const INTERFACE = JSON.parse(fs.readFileSync(path.join(SOURCE, 'interface.json'), 'utf8'));

/**
 * Every way `value` departs from `declaration`: a key it does not declare, a
 * required key missing, a type or a value it does not allow. A checkpoint is
 * checked against the declaration of its own kind.
 */
function departures(value, declaration, where = 'request') {
  const found = [];
  if (!typeAllowed(value, declaration.type)) return [`${where}: ${JSON.stringify(value)} is not ${declaration.type}`];
  if (declaration.values && !declaration.values.includes(value)) found.push(`${where}: ${JSON.stringify(value)} is not one of ${declaration.values.join(', ')}`);
  if (declaration.see === 'checkpoint') {
    const keys = INTERFACE.checkpoint.keys[value.kind];
    if (!keys) return [`${where}: the checkpoint kind ${JSON.stringify(value.kind)} is not declared`];
    return [...found, ...departures(value, { type: 'object', keys }, where)];
  }
  if (declaration.keys && isMap(value)) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(declaration.keys, key)) found.push(`${where}.${key}: not declared`);
      else found.push(...departures(value[key], declaration.keys[key], `${where}.${key}`));
    }
    for (const [key, spec] of Object.entries(declaration.keys)) {
      if (spec.required && !Object.hasOwn(value, key)) found.push(`${where}.${key}: required and missing`);
    }
  }
  if (declaration.items && Array.isArray(value)) {
    value.forEach((item, index) => found.push(...departures(item, declaration.items, `${where}[${index}]`)));
  }
  return found;
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function typeAllowed(value, type) {
  return type.split('|').some(each => ({
    string: typeof value === 'string',
    boolean: typeof value === 'boolean',
    integer: Number.isInteger(value),
    object: isMap(value),
    array: Array.isArray(value),
    null: value === null,
  })[each]);
}

const REQUEST = { type: 'object', keys: INTERFACE.gate_request.keys };

/** A run at a gate with a revise, whose closed node left an open risk with its change, so the revise carries a suggestion. */
function atRevisableGate(t) {
  const runDir = scratch(t);
  const definition = path.join(runDir.root, 'revisable.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  approval:', '    type: gate', '    needs: [analysis]', '    ask: "Direction ready?"',
    '    options:',
    '      continue-past-analysis: continue',
    '      refine: {effect: revise, reruns: analysis}',
    '      stop-development: stop', '',
  ].join('\n'));
  fs.writeFileSync(path.join(runDir.root, 'revisable.md'), '# Revisable workflow — node prose\n\n## `analysis`\n\nWrite the report.\n');
  freeze(runDir, { definition });
  write(runDir, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { summary: 'Two gaps found in the parser.', decisions: ['Patch the tokenizer'], risks: [{ risk: 'Section 2 is thin', tag: 'open', change: 'Expand section 2.' }] } },
  });
  return runDir;
}

/** A running node under a cockpit that carries question sets, and the set it asks, from the committed fixture. */
function askingNode(t) {
  const runDir = scratch(t);
  freeze(runDir, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work', features: ['question-sets'] } } });
  write(runDir, { nodes: { analysis: { status: 'running' } } });
  const fixture = parse(fs.readFileSync(path.join(FIXTURES, 'gates/question-set.request.yml'), 'utf8'));
  const questions = JSON.parse(JSON.stringify(fixture.context.checkpoint.questions)).map(({ default: _default, ...question }) => question);
  const file = path.join(runDir.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions }));
  return { runDir, file };
}

function requestAt(args) {
  const result = verb(['gate-brief', ...args, '--request']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// the builders emit only what the file declares
// ---------------------------------------------------------------------------

test('a gate request, its options, suggestions, context and checkpoint carry only declared keys, every required one present', t => {
  const runDir = atRevisableGate(t);
  const request = requestAt([`--state=${runDir.state}`, '--node=approval']);
  const refine = request.options.find(option => option.id === 'refine');
  assert.ok(refine.suggestions.length > 0, 'the revise carries a suggestion, so the suggestion level is exercised');
  assert.equal(request.context.checkpoint.kind, 'gate');
  assert.deepEqual(departures(request, REQUEST), []);

  const again = requestAt([`--state=${runDir.state}`, '--node=approval', '--reask=refine']);
  assert.deepEqual(departures(again, REQUEST), [], 'a re-asked request has the same shape');
});

test('a question-set request and each of its questions carry only declared keys', t => {
  const { runDir, file } = askingNode(t);
  const request = requestAt([`--state=${runDir.state}`, '--node=analysis', `--patch-file=${file}`]);
  assert.equal(request.kind, 'question');
  assert.ok(request.questions.length > 1, 'the set level is exercised');
  assert.deepEqual(departures(request, REQUEST), []);
});

test('control: a key the file does not declare, at the top or in an option, is caught, and so is a missing required key', t => {
  const runDir = atRevisableGate(t);
  const request = requestAt([`--state=${runDir.state}`, '--node=approval']);
  const undeclared = structuredClone(request);
  undeclared.unlisted = true;
  undeclared.options[0].colour = 'red';
  assert.deepEqual(departures(undeclared, REQUEST).sort(), ['request.options[0].colour: not declared', 'request.unlisted: not declared']);
  const missing = structuredClone(request);
  delete missing.question;
  assert.deepEqual(departures(missing, REQUEST), ['request.question: required and missing']);
  const retyped = structuredClone(request);
  retyped.multi_select = 'no';
  assert.deepEqual(departures(retyped, REQUEST), ['request.multi_select: "no" is not boolean']);
});

// ---------------------------------------------------------------------------
// the committed files are fresh
// ---------------------------------------------------------------------------

test('each committed interface file is what a fresh generation from its tree writes', () => {
  for (const root of [SOURCE, VARIANT]) {
    const result = run(GENERATOR, ['--root', root, '--check']);
    assert.equal(result.code, 0, result.stderr);
  }
});

test('the variant\'s file differs from the source\'s only where the host does: its hooks and the tool names it calls', () => {
  const variant = JSON.parse(fs.readFileSync(path.join(VARIANT, 'interface.json'), 'utf8'));
  const differing = Object.keys(INTERFACE).filter(key => JSON.stringify(INTERFACE[key]) !== JSON.stringify(variant[key]));
  assert.deepEqual(differing, ['hooks', 'mcp']);
});

// ---------------------------------------------------------------------------
// regeneration picks up a change, and versions it
// ---------------------------------------------------------------------------

/** A scratch copy of the plugin tree, the committed interface file in it. */
function treeCopy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-interface-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'maister');
  fs.cpSync(SOURCE, root, { recursive: true });
  return root;
}

function edit(file, from, to) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${path.basename(file)} holds ${from}`);
  fs.writeFileSync(file, text.replace(from, to));
}

const engineFile = (root, relative) => path.join(root, 'skills/workflow-engine/scripts', relative);
const generated = root => JSON.parse(fs.readFileSync(path.join(root, 'interface.json'), 'utf8'));

test('regeneration alone picks up a verb\'s new flag and a new state key, and steps the minor version', t => {
  const root = treeCopy(t);
  edit(engineFile(root, 'workflow.mjs'), "'runner-step': { module: 'runner.mjs', flags: ['state', 'node', 'runner', 'answered'] },",
    "'runner-step': { module: 'runner.mjs', flags: ['state', 'node', 'runner', 'answered', 'binding'] },");
  edit(engineFile(root, 'lib/state.mjs'), "'provider', 'session'];", "'provider', 'session', 'binding'];");
  assert.equal(run(GENERATOR, ['--root', root, '--check']).code, 1, 'the committed file is now stale');
  const result = run(GENERATOR, ['--root', root]);
  assert.equal(result.code, 0, result.stderr);
  const description = generated(root);
  assert.ok(description.engine.verbs['runner-step'].flags.includes('binding'));
  assert.ok(description.state.node_keys.includes('binding'));
  const [major, minor] = INTERFACE.interface_version.split('.').map(Number);
  assert.equal(description.interface_version, `${major}.${minor + 1}`);
  assert.equal(run(GENERATOR, ['--root', root]).stdout.trim().split(' ').pop(), `${major}.${minor + 1}`, 'regenerating again keeps the version');
});

test('a removed verb steps the major version; a removed state key is refused until the state schema version moves', t => {
  const root = treeCopy(t);
  edit(engineFile(root, 'workflow.mjs'), "  'sync-plan': { module: 'plan-sync.mjs', flags: ['plan'] },\n", '');
  edit(engineFile(root, 'workflow.mjs'), "  'sync-plan': runSyncPlan,\n", '');
  assert.equal(run(GENERATOR, ['--root', root]).code, 0);
  const [major] = INTERFACE.interface_version.split('.').map(Number);
  assert.equal(generated(root).interface_version, `${major + 1}.0`);

  edit(engineFile(root, 'lib/state.mjs'), "'provider', 'session'];", "'provider'];");
  const refused = run(GENERATOR, ['--root', root]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /state shape changed \(state\.node_keys\[session\]\).*raise it in lib\/state\.mjs/);
  edit(engineFile(root, 'lib/state.mjs'), 'export const STATE_SCHEMA_VERSION = 1;', 'export const STATE_SCHEMA_VERSION = 2;');
  assert.equal(run(GENERATOR, ['--root', root]).code, 0);
  assert.equal(generated(root).state.schema_version, 2);
});

// ---------------------------------------------------------------------------
// run through a symlinked path
// ---------------------------------------------------------------------------

/**
 * The repository reached through a symlink in a scratch directory, the way a
 * checkout under macOS /tmp (a link to /private/tmp) is reached. Node resolves
 * the link in a script's own URL but not in the path it was started by.
 */
function linkedRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-linked-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'repo');
  fs.symlinkSync(ROOT, link, 'junction');
  return { dir, link };
}

test('started through a symlinked path, the generator writes the file, and --check still finds a stale one', t => {
  const { link } = linkedRepo(t);
  const linked = path.join(link, 'tools/interface.mjs');

  const root = treeCopy(t);
  fs.rmSync(path.join(root, 'interface.json'));
  const written = run(linked, ['--root', root]);
  assert.equal(written.code, 0, written.stderr);
  assert.ok(fs.existsSync(path.join(root, 'interface.json')), 'the file is written');
  const direct = treeCopy(t);
  fs.rmSync(path.join(direct, 'interface.json'));
  assert.equal(run(GENERATOR, ['--root', direct]).code, 0);
  assert.deepEqual(generated(root), generated(direct), 'the same file as a run started directly');

  const stale = treeCopy(t);
  edit(engineFile(stale, 'lib/state.mjs'), "'provider', 'session'];", "'provider', 'session', 'binding'];");
  assert.equal(run(linked, ['--root', stale, '--check']).code, 1, 'the stale file is caught');
});

test('started through a symlinked path, each lint reports what it reports when started directly', t => {
  const { dir, link } = linkedRepo(t);
  fs.writeFileSync(path.join(dir, 'bad.md'), '---\nname: bad: value\n---\n');
  fs.mkdirSync(path.join(dir, 'plugins/maister'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins/maister/.mcp.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'twin.yml'), [
    'name: twin', 'version: 1', 'nodes:',
    '  analysis: {uses: "direct:analysis", needs: []}',
    '  first: {type: gate, needs: [analysis], ask: "Ready?", options: {go: continue, halt: stop}}',
    '  second: {type: gate, needs: [first], ask: "Ready?", options: {go: continue, halt: stop}}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'twin.md'), '# Twin workflow — node prose\n\n## `analysis`\n\nWrite the report.\n');
  const lints = {
    'frontmatter-lint.mjs': [`--file=${path.join(dir, 'bad.md')}`],
    'browser-tool-lint.mjs': [`--root=${dir}`],
    'gate-title-lint.mjs': [`--definition=${path.join(dir, 'twin.yml')}`],
  };
  for (const [name, args] of Object.entries(lints)) {
    const direct = run(path.join(ROOT, 'tests', name), args);
    const linked = run(path.join(link, 'tests', name), args);
    assert.equal(direct.code, 1, `${name}: ${direct.stderr}`);
    assert.match(direct.stdout, /^FAIL: /, `${name} reports the finding`);
    assert.equal(linked.code, direct.code, `${name}: ${linked.stderr}`);
    assert.equal(linked.stdout, direct.stdout, name);
  }
});

// ---------------------------------------------------------------------------
// the refusals, by the verb that raises them
// ---------------------------------------------------------------------------

test('each refusal is listed under the verb that raises it, and not under one that only reads through it', () => {
  const refusals = verbName => INTERFACE.engine.verbs[verbName].refusals;
  for (const [verbName, code] of [
    ['write-state', 'state-non-canonical'], ['write-state', 'edition-collision'], ['gate-revise', 'revise-note-missing'],
    ['gate-brief', 'gate-brief-no-summary'], ['gate-request', 'gate-request-unavailable'], ['gate-request', 'gate-guard-false'],
    ['run-complete', 'closeout-unpublished'], ['runner-step', 'runner-step-not-running'], ['import', 'import-not-a-run'],
  ]) assert.ok(refusals(verbName).includes(code), `${verbName} raises ${code}`);
  assert.ok(!refusals('write-state').includes('gate-brief-no-summary'), 'the writer reads a gate\'s labels through gate-brief but never reports its refusal');
  assert.ok(!refusals('write-state').includes('dashboard-unwritable'), 'a projection the writer fails to publish is a warning, never a refusal');
  assert.ok(!refusals('gate-brief').includes('closeout-unpublished'));
});

test('every code the engine\'s shipped recovery tables name is raised by some verb in the file', () => {
  const raised = new Set(Object.values(INTERFACE.engine.verbs).flatMap(each => each.refusals));
  const dir = path.join(SOURCE, 'skills/workflow-engine');
  const files = [path.join(dir, 'SKILL.md'), ...fs.readdirSync(path.join(dir, 'references')).map(name => path.join(dir, 'references', name))];
  const missing = [];
  for (const file of files) {
    let inTable = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\| Refusal \|/.test(line)) { inTable = true; continue; }
      if (inTable && !line.startsWith('|')) inTable = false;
      if (!inTable) continue;
      for (const [, code] of (line.split('|')[1] ?? '').matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) {
        if (!raised.has(code)) missing.push(`${code} (${path.relative(dir, file)})`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
