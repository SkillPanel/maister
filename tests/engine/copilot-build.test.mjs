import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT, bashPath, variantRoot } from '../helpers.mjs';

// The Copilot CLI build, run the way make and CI run it: bash with the
// script's path, its findings on stderr. The build's output and its refusals
// are checked here; a refusal that stops the build before the output folder
// is touched is run against the real script, since it deletes and writes
// nothing. A refusal that needs a changed source tree runs in a scratch root
// holding copies of the build, the interface generator and the plugin, so the
// guards are never exercised against this repository.

const BUILD_TIMEOUT_MS = 300_000;
const USAGE = 'usage: build.sh [--out DIR] [--baseline FILE] [--require-baseline]';

/** A path with forward slashes, the form Git Bash takes on Windows too. */
const slash = file => file.split(path.sep).join('/');

/** Run `<root>/platforms/copilot-cli/build.sh` with `args`. */
function build(args, root = ROOT) {
  const script = slash(path.join(root, 'platforms/copilot-cli/build.sh'));
  const result = spawnSync(bashPath(), [script, ...args], { encoding: 'utf8', timeout: BUILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A fresh folder under the OS temp directory, removed when the test ends. */
function tempDir(t, prefix = 'maister-build-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function* markdown(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(file);
    else if (entry.name.endsWith('.md')) yield file;
  }
}

/** Every file under `dir`, relative to it, sorted. */
function listing(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the build is named maister, says it is for GitHub Copilot CLI and switches the host marker', () => {
  const variant = variantRoot();
  const manifest = read(variant, '.claude-plugin/plugin.json');
  assert.equal(JSON.parse(manifest).name, 'maister');
  assert.match(JSON.parse(manifest).description, /GitHub Copilot CLI/);
  assert.doesNotMatch(manifest, /"types":/);
  assert.match(read(variant, 'lib/host.mjs'), /^export const SHIPPED_HOST = 'copilot';$/m);
  assert.match(read(ROOT, 'plugins/maister/lib/host.mjs'), /^export const SHIPPED_HOST = 'claude';$/m);
});

test('the Copilot build points the instructions import at the project root from .github/', () => {
  const rel = 'skills/docs-manager/references/claude-md-template.md';
  const template = fs.readFileSync(path.join(variantRoot(), rel), 'utf8');
  assert.match(template, /Read\s+@\.\.\/\.maister\/docs\/INDEX\.md/);
  const source = fs.readFileSync(path.join(ROOT, 'plugins/maister', rel), 'utf8');
  assert.match(source, /Read\s+@\.maister\/docs\/INDEX\.md/);
  const skill = fs.readFileSync(path.join(variantRoot(), 'skills/docs-manager/SKILL.md'), 'utf8');
  const valid = skill.split('\n').find(l => l.includes('valid file reference format'));
  assert.ok(valid && valid.includes('@../.maister/docs/INDEX.md'), 'the valid format names the .github/-relative import');
  const wrong = skill.split('\n').find(l => l.includes('incorrect formats'));
  assert.ok(wrong && /(^|[^`.\/])@\.maister\/docs\/INDEX\.md/.test(wrong), 'the old import is listed among the incorrect formats');
});

test('the prefix rewrite keeps the commands and agents, strips the bare skill and leaves no placeholder', () => {
  const variant = variantRoot();
  assert.match(read(variant, 'skills/quick-dev/SKILL.md'), /\/maister:init/);
  assert.match(read(variant, 'skills/init/SKILL.md'), /maister:docs-operator/);
  const research = read(variant, 'skills/research/SKILL.md');
  assert.match(research, /Invoke the `workflow-engine` skill/);
  assert.doesNotMatch(research, /maister:workflow-engine/);
  const holding = [...markdown(variant)].filter(file => fs.readFileSync(file, 'utf8').includes('@@MAISTER_NS@@'));
  assert.deepEqual(holding, []);
});

test('the 2.x line of the build names the 2.x Copilot build', () => {
  const engine = read(variantRoot(), 'skills/workflow-engine/SKILL.md');
  assert.match(engine, /copilot plugin install maister-copilot@maister-plugins-2x/);
  assert.doesNotMatch(engine, /copilot plugin install maister@maister-plugins-2x/);
});

test('a missing or unusable baseline and an unknown argument are refused before anything is written', t => {
  const dir = tempDir(t);
  const out = path.join(dir, 'copilot');

  const required = build(['--out', slash(out), '--require-baseline']);
  assert.equal(required.code, 1, required.stderr);
  assert.match(required.stderr, /^build: no interface baseline; refusing to version the interface file from 1\.0 \(give --baseline FILE\)$/m);
  assert.equal(fs.existsSync(out), false);

  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, '');
  const emptyRun = build([`--out=${slash(out)}`, `--baseline=${slash(empty)}`]);
  assert.equal(emptyRun.code, 1, emptyRun.stderr);
  assert.match(emptyRun.stderr, /^build: .*empty\.json is not an interface file; refusing to version against it$/m);
  assert.equal(fs.existsSync(out), false);

  const missing = build(['--out', slash(out), '--baseline', slash(path.join(dir, 'missing.json'))]);
  assert.equal(missing.code, 1, missing.stderr);
  assert.match(missing.stderr, /^build: .*missing\.json is not an interface file; refusing to version against it$/m);
  assert.equal(fs.existsSync(out), false);

  const unknown = build(['--out', slash(out), '--outt', 'x']);
  assert.equal(unknown.code, 2, unknown.stderr);
  assert.match(unknown.stderr, new RegExp(`^${USAGE.replace(/[[\]().]/g, '\\$&')}$`, 'm'));
  assert.equal(fs.existsSync(out), false);
});

test('a baseline the build versions against keeps its version when nothing changed', t => {
  const dir = tempDir(t);
  const baseline = JSON.parse(read(variantRoot(), 'interface.json'));
  baseline.interface_version = '7.3';
  const file = path.join(dir, 'baseline.json');
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  const out = path.join(dir, 'copilot');
  const result = build(['--out', slash(out), '--baseline', slash(file), '--require-baseline']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(read(out, 'interface.json')).interface_version, '7.3');
});

/** A scratch root holding copies of the build, the interface generator and the plugin. */
function scratchRoot(t) {
  const root = tempDir(t, 'maister-build-root-');
  fs.cpSync(path.join(ROOT, 'platforms/copilot-cli'), path.join(root, 'platforms/copilot-cli'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools/interface.mjs'), path.join(root, 'tools/interface.mjs'));
  fs.cpSync(path.join(ROOT, 'plugins/maister'), path.join(root, 'plugins/maister'), { recursive: true });
  return root;
}

test('a host marker spelled otherwise stops the build', t => {
  const root = scratchRoot(t);
  const host = path.join(root, 'plugins/maister/lib/host.mjs');
  fs.writeFileSync(host, read(root, 'plugins/maister/lib/host.mjs').replace("SHIPPED_HOST = 'claude';", 'SHIPPED_HOST = "claude";'));
  const out = path.join(tempDir(t), 'copilot');
  const result = build(['--out', slash(out)], root);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^build: .*lib\/host\.mjs names no SHIPPED_HOST line; the engine would take this build for Claude Code's$/m);
});

test('a manifest named otherwise stops the build, and an output folder holding the source is refused', t => {
  const root = scratchRoot(t);
  const manifest = path.join(root, 'plugins/maister/.claude-plugin/plugin.json');
  const original = fs.readFileSync(manifest, 'utf8');
  fs.writeFileSync(manifest, original.replace('"name": "maister"', '"name": "maister-copilot"'));
  const renamed = build(['--out', slash(path.join(tempDir(t), 'copilot'))], root);
  assert.equal(renamed.code, 1, renamed.stderr);
  assert.match(renamed.stderr, /^build: the variant manifest is named 'maister-copilot', not 'maister'; Copilot would register its commands under another prefix$/m);

  fs.writeFileSync(manifest, original);
  const before = listing(root);
  const holding = build(['--out', slash(root)], root);
  assert.equal(holding.code, 2, holding.stderr);
  assert.match(holding.stderr, /^build: /m);
  assert.deepEqual(listing(root), before);
});

test('an output folder that is not a build is refused and left in place', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me\n');
  const result = build(['--out', slash(dir)]);
  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stderr, /^build: /m);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'keep me\n');
});

test('a CRLF markdown file in the source comes out with LF endings and its prefixes rewritten', t => {
  const root = scratchRoot(t);
  const skill = path.join(root, 'plugins/maister/skills/quick-dev/SKILL.md');
  fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/\r?\n/g, '\r\n'));
  const out = path.join(tempDir(t), 'copilot');
  const result = build(['--out', slash(out)], root);
  assert.equal(result.code, 0, result.stderr);
  const built = read(out, 'skills/quick-dev/SKILL.md');
  assert.equal(built.includes('\r'), false);
  assert.match(built, /\/maister:init/);
});

test('a relative output folder whose parent does not exist is created under the current directory', t => {
  const cwd = tempDir(t);
  const script = slash(path.join(ROOT, 'platforms/copilot-cli/build.sh'));
  const result = spawnSync(bashPath(), [script, '--out', 'new/parent/copilot'], { cwd, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(read(path.join(cwd, 'new/parent/copilot'), '.claude-plugin/plugin.json')).name, 'maister');
});

/** Each entry of the frontmatter `skills:` list of the agent file at `file`. */
function preloads(file) {
  const front = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n---\n')[0];
  const list = /^skills:\n((?:[ \t]+-[^\n]*\n?)*)/m.exec(front);
  return list ? list[1].split('\n').map(line => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
}

test('an agent\'s skill preload names the skill as Copilot registers it, and each names a skill of the build', () => {
  const variant = variantRoot();
  assert.deepEqual(preloads(path.join(ROOT, 'plugins/maister/agents/docs-operator.md')), ['docs-manager']);
  assert.deepEqual(preloads(path.join(variant, 'agents/docs-operator.md')), ['maister:docs-manager']);
  for (const name of fs.readdirSync(path.join(variant, 'agents')).filter(file => file.endsWith('.md'))) {
    for (const entry of preloads(path.join(variant, 'agents', name))) {
      assert.match(entry, /^maister:[A-Za-z0-9_-]+$/, `${name} preloads ${entry}`);
      assert.ok(fs.existsSync(path.join(variant, 'skills', entry.slice('maister:'.length), 'SKILL.md')), `${name} preloads ${entry}, which the build holds no skill for`);
    }
  }
});

test('an agent preloading a skill the build does not hold stops the build', t => {
  const root = scratchRoot(t);
  const agent = path.join(root, 'plugins/maister/agents/docs-operator.md');
  fs.writeFileSync(agent, read(root, 'plugins/maister/agents/docs-operator.md').replace('  - docs-manager', '  - no-such-skill'));
  const out = path.join(tempDir(t), 'copilot');
  const result = build(['--out', slash(out)], root);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^build: .*agents\/docs-operator\.md preloads the skill no-such-skill, which the build does not hold$/m);
});

test('the Copilot build\'s docs-manager reads the import path from the instructions file\'s folder', () => {
  const phrase = 'reading the path from the folder the instructions file sits in';
  const squash = text => text.replace(/\s+/g, ' ');
  assert.ok(squash(read(ROOT, 'plugins/maister/skills/docs-manager/SKILL.md')).includes(phrase), 'the source existence check names the instructions file\'s folder');
  assert.ok(squash(read(variantRoot(), 'skills/docs-manager/SKILL.md')).includes(phrase), 'the variant existence check names the instructions file\'s folder');
});

test('the directory rule never has a run folder made before its freeze: the freeze creates it', () => {
  const variant = variantRoot();
  for (const file of ['skills/workflow-engine/SKILL.md', 'agents/implementation-runner.md']) {
    const text = fs.readFileSync(path.join(variant, file), 'utf8');
    assert.match(text, /\*\*Create a file's directory before the file\.\*\*/, file);
    assert.ok(text.includes('A run\'s own folder is never one: the freeze creates it.'), file);
    assert.doesNotMatch(text, /a new task or sub-run directory/, file);
  }
});
