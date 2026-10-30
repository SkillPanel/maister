import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, SAMPLE, freeze, run, scratch, scratchPlugin, verb } from '../helpers.mjs';
import { findEditionCollision } from '../../plugins/maister/lib/editions.mjs';

const PLUGIN = path.join(ROOT, 'plugins/maister');
const HOOK = path.join(PLUGIN, 'hooks/edition-check.mjs');

/**
 * The marketplace this checkout installs the plugin from, read rather than
 * spelled: the manifest carries a different name on each release line, and the
 * engine under test derives its own edition from exactly this file.
 */
const OWN = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')).name;
const MINE = `maister@${OWN}`;
const OTHER = 'maister@other-edition';

/**
 * Settings for one case: a scratch config dir holding the user scope, and the
 * project and local scopes written under `projectDir`. A value is written as
 * JSON, a string is written as-is (to make it malformed), and `DIR` puts a
 * directory where the file should be. Returns the env a child needs.
 */
const DIR = Symbol('directory');
function settings(t, projectDir, { user, project, local } = {}) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-settings-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  place(path.join(config, 'settings.json'), user);
  place(path.join(projectDir, '.claude', 'settings.json'), project);
  place(path.join(projectDir, '.claude', 'settings.local.json'), local);
  return { CLAUDE_CONFIG_DIR: config };
}

function place(file, value) {
  if (value === undefined) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (value === DIR) fs.mkdirSync(file);
  else fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

const enabled = ids => ({ enabledPlugins: Object.fromEntries(ids.map(([id, on]) => [id, on])) });

/** The freeze write of a fresh run under `env`. */
function freezeUnder(run, env) {
  const graph = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  const nodes = Object.fromEntries(graph.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
  return verb(['write-state', `--state=${run.state}`], {
    task: { title: 'Sample run', status: 'in_progress' },
    workflow: { source: SAMPLE, overlays: graph.overlays, profile: graph.profile, graph_hash: graph.graph_hash, grammar_version: 1, name: graph.name, nodes },
  }, env);
}

function assertRefused(result) {
  assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stderr}`);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^edition-collision: /);
  assert.ok(result.stderr.includes(MINE) && result.stderr.includes(OTHER), result.stderr);
  assert.ok(result.stderr.includes(`claude plugin disable ${OTHER} --scope local`), result.stderr);
}

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

test('editions: two enabled editions refuse the freeze and write nothing', t => {
  const run = scratch(t);
  const env = settings(t, run.root, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  assertRefused(freezeUnder(run, env));
  assert.equal(fs.existsSync(run.state), false, 'a refused start leaves no state file');
});

test('editions: a run frozen before the collision refuses its next write, byte for byte', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const env = settings(t, run.root, { user: enabled([[MINE, true], [OTHER, true]]) });
  const result = verb(['write-state', `--state=${run.state}`], {}, env);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^edition-collision: /);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
});

test('editions: a missing definition names the collision beside the missing file', t => {
  const run = scratch(t);
  const env = settings(t, run.root, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const missing = path.join(run.root, 'fix.yml');
  const result = verb(['resolve', `--definition=${missing}`], undefined, { ...env, CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 1);
  const [error] = JSON.parse(result.stdout).errors;
  assert.match(error.message, /ENOENT/);
  assert.ok(error.message.includes('editions of the maister plugin are enabled'), error.message);

  const alone = verb(['resolve', `--definition=${missing}`], undefined, { CLAUDE_PROJECT_DIR: run.root });
  assert.doesNotMatch(JSON.parse(alone.stdout).errors[0].message, /editions/, 'no collision, no cause appended');
});

test('editions: a single enabled edition starts a run', t => {
  const run = scratch(t);
  const env = settings(t, run.root, { user: enabled([[MINE, true]]) });
  const result = freezeUnder(run, env);
  assert.equal(result.code, 0, result.stderr);
});

test('editions: an inline copy beside installed editions is not a collision', t => {
  const run = scratch(t);
  // The running copy's own marketplace is not among the enabled editions: it
  // was loaded with --plugin-dir, which skips every installed copy.
  const beside = settings(t, run.root, { user: enabled([['maister@inline', true], [OTHER, true]]) });
  assert.equal(freezeUnder(run, beside).code, 0);

  const second = scratch(t);
  const two = settings(t, second.root, { user: enabled([['maister@edition-a', true], ['maister@edition-b', true]]) });
  const result = freezeUnder(second, two);
  assert.equal(result.code, 0, result.stderr);
});

test('editions: a directory-marketplace plugin dir with installed editions disabled locally starts', t => {
  // The engine runs from the directory the checkout's own directory-source
  // marketplace installs from, so its marketplace IS an enabled edition's; the
  // scratch local settings turn both installed editions off.
  const run = scratch(t);
  const env = settings(t, run.root, {
    user: enabled([[MINE, true], [OTHER, true]]),
    local: enabled([[MINE, false], [OTHER, false]]),
  });
  const result = freezeUnder(run, env);
  assert.equal(result.code, 0, result.stderr);
});

test('editions: an edition disabled at the local scope overrides the user scope', t => {
  const run = scratch(t);
  const env = settings(t, run.root, { user: enabled([[MINE, true], [OTHER, true]]), local: enabled([[OTHER, false]]) });
  const result = freezeUnder(run, env);
  assert.equal(result.code, 0, result.stderr);
});

test('editions: unreadable settings fail open', t => {
  const run = scratch(t);
  const malformed = settings(t, run.root, { user: enabled([[MINE, true], [OTHER, true]]), project: '{ not json' });
  assert.equal(freezeUnder(run, malformed).code, 0);

  const second = scratch(t);
  const directory = settings(t, second.root, { user: enabled([[MINE, true], [OTHER, true]]), local: DIR });
  const result = freezeUnder(second, directory);
  assert.equal(result.code, 0, result.stderr);
});

// ---------------------------------------------------------------------------
// the detector, imported
// ---------------------------------------------------------------------------

test('editions: managed settings win over every other scope', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const env = settings(t, project, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const managed = path.join(project, 'managed-settings.json');
  fs.writeFileSync(managed, JSON.stringify(enabled([[OTHER, false]])));
  assert.equal(findEditionCollision({ pluginRoot: PLUGIN, projectDir: project, env, managedFiles: [managed] }), null);

  const found = findEditionCollision({ pluginRoot: PLUGIN, projectDir: project, env, managedFiles: [] });
  assert.deepEqual(found.editions, [{ id: MINE, scope: 'user' }, { id: OTHER, scope: 'local' }]);
});

test('editions: a copy running from the plugin cache knows its marketplace from the path', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-cache-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'plugins/cache/cached-edition/maister/1.0.0');
  place(path.join(root, '.claude-plugin/plugin.json'), { name: 'maister' });
  const env = settings(t, base, { user: enabled([['maister@cached-edition', true], [OTHER, true]]) });
  const found = findEditionCollision({ pluginRoot: root, projectDir: base, env, managedFiles: [] });
  assert.deepEqual(found?.editions.map(edition => edition.id), ['maister@cached-edition', OTHER]);
});

test('editions: the Copilot variant is a no-op', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const copilot = path.join(ROOT, 'plugins/maister-copilot');
  const env = settings(t, project, { user: enabled([[`maister-copilot@${OWN}`, true], ['maister-copilot@other-edition', true]]) });
  assert.equal(findEditionCollision({ pluginRoot: copilot, projectDir: project, env, managedFiles: [] }), null);
});

// ---------------------------------------------------------------------------
// the session layer: what --settings was given, named in MAISTER_SESSION_SETTINGS
// ---------------------------------------------------------------------------

/**
 * The launcher's case: this edition on in user settings, the other at local
 * scope. Returns the project, its env and a detector bound to both.
 */
function launcherCase(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const env = settings(t, project, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const detect = (extra = {}, managedFiles = []) => findEditionCollision({ pluginRoot: PLUGIN, projectDir: project, env: { ...env, ...extra }, managedFiles });
  return { project, env, detect };
}

function sessionFile(project, value) {
  const file = path.join(project, 'session-settings.json');
  place(file, value);
  return file;
}

test('editions: a session layer turning this edition off clears the collision', t => {
  const { project, detect } = launcherCase(t);
  const file = sessionFile(project, enabled([[MINE, false]]));
  assert.equal(detect({ MAISTER_SESSION_SETTINGS: file }), null);
});

test('editions: without the session layer the same settings are a collision that says how to supply it', t => {
  const { detect } = launcherCase(t);
  const found = detect();
  assert.deepEqual(found?.editions, [{ id: MINE, scope: 'user' }, { id: OTHER, scope: 'local' }]);
  assert.ok(found.message.includes('MAISTER_SESSION_SETTINGS'), found.message);
});

test('editions: a session layer turning the other edition off clears the collision', t => {
  const { project, detect } = launcherCase(t);
  const file = sessionFile(project, enabled([[OTHER, false]]));
  assert.equal(detect({ MAISTER_SESSION_SETTINGS: file }), null);
});

test('editions: the session layer takes inline JSON, as --settings does', t => {
  const { detect } = launcherCase(t);
  assert.equal(detect({ MAISTER_SESSION_SETTINGS: `  ${JSON.stringify(enabled([[MINE, false]]))}` }), null);
});

test('editions: a session layer that cannot be read or understood counts as absent', t => {
  const { project, detect } = launcherCase(t);
  const cases = {
    missing: path.join(project, 'no-such-settings.json'),
    directory: sessionFile(project, DIR),
    malformedFile: sessionFile(path.join(project, 'bad'), '{ not json'),
    malformedInline: '{ not json',
    notAnObject: sessionFile(path.join(project, 'array'), '[1, 2]'),
    badShape: sessionFile(path.join(project, 'shape'), { enabledPlugins: ['maister'] }),
    empty: '',
  };
  for (const [label, value] of Object.entries(cases)) {
    const found = detect({ MAISTER_SESSION_SETTINGS: value });
    assert.deepEqual(found?.editions.map(edition => edition.id), [MINE, OTHER], label);
  }
});

test('editions: managed settings win over the session layer', t => {
  const { project, detect } = launcherCase(t);
  const file = sessionFile(project, enabled([[MINE, false]]));
  const managed = path.join(project, 'managed-settings.json');
  fs.writeFileSync(managed, JSON.stringify(enabled([[MINE, true]])));
  const found = detect({ MAISTER_SESSION_SETTINGS: file }, [managed]);
  assert.deepEqual(found?.editions, [{ id: MINE, scope: 'managed' }, { id: OTHER, scope: 'local' }]);
});

test('editions: the session layer wins over local settings and is named without a disable command', t => {
  const { project, detect } = launcherCase(t);
  // Local settings turn the other edition on; the session layer turns this one on over a local false.
  const file = sessionFile(project, enabled([[MINE, true]]));
  const local = path.join(project, '.claude', 'settings.local.json');
  fs.writeFileSync(local, JSON.stringify(enabled([[MINE, false], [OTHER, true]])));
  const found = detect({ MAISTER_SESSION_SETTINGS: file });
  assert.deepEqual(found?.editions, [{ id: MINE, scope: 'session' }, { id: OTHER, scope: 'local' }]);
  assert.ok(found.message.includes(`claude plugin disable ${OTHER} --scope local`), found.message);
  assert.doesNotMatch(found.message, /--scope session/);
  assert.match(found.message, /session settings/);
  assert.doesNotMatch(found.message, /If this session was started with/, 'the layer was supplied');
});

test('editions: the engine starts a run when the session layer turns an edition off', t => {
  const run = scratch(t);
  const env = settings(t, run.root, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const file = path.join(run.root, 'session-settings.json');
  place(file, enabled([[MINE, false]]));
  assertRefused(freezeUnder(run, env));
  const result = freezeUnder(run, { ...env, MAISTER_SESSION_SETTINGS: file });
  assert.equal(result.code, 0, result.stderr);
});

test('editions: the session-start hook reads the session layer', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const env = settings(t, project, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const inline = JSON.stringify(enabled([[OTHER, false]]));
  const result = run(HOOK, [], { hook_event_name: 'SessionStart', cwd: project }, { ...env, MAISTER_SESSION_SETTINGS: inline });
  assert.deepEqual([result.code, result.stdout], [0, '']);
});

// ---------------------------------------------------------------------------
// the session-start hook
// ---------------------------------------------------------------------------

test('editions: the session-start hook warns the operator and the model', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const env = settings(t, project, { user: enabled([[MINE, true]]), local: enabled([[OTHER, true]]) });
  const result = run(HOOK, [], { hook_event_name: 'SessionStart', source: 'startup', cwd: project }, env);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.systemMessage.includes(`claude plugin disable ${OTHER} --scope local`), output.systemMessage);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /do not start or resume any workflow/);
});

test('editions: the session-start hook is silent without a collision or a payload', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const single = settings(t, project, { user: enabled([[MINE, true]]) });
  const quiet = run(HOOK, [], { cwd: project }, single);
  assert.deepEqual([quiet.code, quiet.stdout], [0, '']);

  const garbage = run(HOOK, [], 'not json at all', single, project);
  assert.deepEqual([garbage.code, garbage.stdout], [0, '']);

  const unreadable = settings(t, project, { user: enabled([[MINE, true], [OTHER, true]]), project: '{ not json' });
  const failedOpen = run(HOOK, [], { cwd: project }, unreadable);
  assert.deepEqual([failedOpen.code, failedOpen.stdout], [0, '']);
});

test('editions: a verb whose module this edition does not include says so, naming no other edition', t => {
  const engine = scratchPlugin(t);
  const target = scratch(t);
  freeze(target);
  // Control: the verb runs while its module is there.
  assert.equal(run(engine, ['resume-check', `--state=${target.state}`]).code, 0);
  fs.rmSync(path.join(path.dirname(engine), 'lib/resume-check.mjs'));
  const result = run(engine, ['resume-check', `--state=${target.state}`]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /the module lib\/resume-check\.mjs is not included in this edition of the plugin, so the verb cannot run/);
  assert.doesNotMatch(result.stderr, /\bpro\b/i);
});
