import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT, freeze, git, gitScratch, readState, run, scratch, verb } from '../helpers.mjs';

// A development run refreshes the grounding pack at finalization when its
// change touched a source the pack records. The guard is code:
// `turn.mjs ground-status --state=<run state>` compares each recorded source as
// the run's base commit holds it with the working tree and prints `touched`.
// The rebuild, the commit and the close are the finalization node's prose,
// which no test can run; the last tests pin what that prose tells the session.

const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');
const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const PACK = '.maister/docs/design-context';

const lock = version => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/ui-kit': { version }, 'node_modules/other': { version: '9.9.9' } } });

const FILES = {
  'src/theme.css': ':root { --accent: #336; }\n',
  'src/app.mjs': 'export const a = 1;\n',
  'package-lock.json': lock('1.0.0'),
};

function put(project, file, text) {
  fs.mkdirSync(path.dirname(path.join(project.root, file)), { recursive: true });
  fs.writeFileSync(path.join(project.root, file), text);
}

/** Write the pack's files and seal it against the project as it is now. */
function seal(project) {
  const pack = path.join(project.root, PACK);
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n');
  fs.writeFileSync(path.join(pack, '.sources.json'), JSON.stringify({
    sources: [
      { path: 'src/theme.css', kind: 'theme' },
      { path: 'package-lock.json', kind: 'lockfile', package: 'ui-kit' },
    ],
    images: [],
  }));
  const sealed = ground(project, 'ground-seal');
  assert.equal(sealed.code, 0, sealed.stdout + sealed.stderr);
}

function ground(project, verbName, extra = []) {
  const result = run(TURN, [verbName, `--pack=${path.join(project.root, PACK)}`, `--root=${project.root}`, ...extra], undefined, {}, project.root);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // no JSON: asserted by the test
  }
  return { ...result, json };
}

const guard = project => ground(project, 'ground-status', [`--state=${project.state}`]);

/** A git project frozen as a development run, with a sealed pack when `withPack`. */
function started(t, { withPack = true, before = () => {} } = {}) {
  const project = gitScratch(t, FILES);
  if (withPack) seal(project);
  before(project);
  freeze(project);
  return project;
}

test('guard: with no pack the run sees missing, nothing touched, and nothing is written', t => {
  const project = started(t, { withPack: false });
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  const result = guard(project);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.status, 'missing');
  assert.deepEqual(result.json.touched, []);
  assert.equal(result.json.base, readState(project).task.base_commit.sha);
  assert.equal(fs.existsSync(path.join(project.root, PACK)), false);
});

test('guard: a change that leaves the recorded sources alone touches nothing', t => {
  const project = started(t);
  put(project, 'src/app.mjs', 'export const a = 2;\n');
  put(project, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/ui-kit': { version: '1.0.0' }, 'node_modules/other': { version: '10.0.0' } } }));
  put(project, 'src/theme.css', ':root { --accent: #336; }\r\n');
  const result = guard(project);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.status, 'fresh');
  assert.deepEqual(result.json.touched, []);
});

test('guard: a pack already stale when the run started is not touched by a run that leaves it alone', t => {
  const project = started(t, {
    before: p => {
      put(p, 'src/theme.css', ':root { --accent: #0a0; }\n');
      git(p.root, ['commit', '-qam', 'theme changed before the run']);
    },
  });
  put(project, 'src/app.mjs', 'export const a = 3;\n');
  const result = guard(project);
  assert.equal(result.json.status, 'stale');
  assert.deepEqual(result.json.changed, ['src/theme.css']);
  assert.deepEqual(result.json.touched, []);
});

test('guard: a recorded source the run changed is touched, committed or not', t => {
  const project = started(t);
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  assert.deepEqual(guard(project).json.touched, ['src/theme.css']);
  git(project.root, ['commit', '-qam', 'a commit during the run']);
  const committed = guard(project);
  assert.deepEqual(committed.json.touched, ['src/theme.css']);
  assert.equal(committed.json.status, 'stale');
});

test('guard: the recorded package\'s version change and a deleted source are touched', t => {
  const project = started(t);
  put(project, 'package-lock.json', lock('2.0.0'));
  fs.unlinkSync(path.join(project.root, 'src/theme.css'));
  assert.deepEqual(guard(project).json.touched.sort(), ['package-lock.json', 'src/theme.css']);
});

test('guard: a base git cannot read is refused as base-unknown, and nothing is written', t => {
  const project = started(t);
  const text = fs.readFileSync(project.state, 'utf8');
  const sha = readState(project).task.base_commit.sha;
  fs.writeFileSync(project.state, text.replace(sha, 'f'.repeat(40)));
  const before = fs.readFileSync(path.join(project.root, PACK, 'grounding.json'));
  const result = guard(project);
  assert.equal(result.code, 1);
  assert.equal(result.json.code, 'base-unknown');
  assert.match(result.json.message, /Nothing was written/);
  assert.deepEqual(fs.readFileSync(path.join(project.root, PACK, 'grounding.json')), before);
});

test('guard: a run that recorded no base commit (a project outside git) touches nothing', t => {
  const project = scratch(t);
  for (const [file, text] of Object.entries(FILES)) put(project, file, text);
  seal(project);
  freeze(project);
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  const result = guard(project);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.base, null);
  assert.deepEqual(result.json.touched, []);
});

test('guard: without --state the status is today\'s shape, with no base and no touched', t => {
  const project = started(t);
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  const result = ground(project, 'ground-status');
  assert.equal(result.code, 0);
  assert.equal(Object.hasOwn(result.json, 'touched'), false);
  assert.equal(Object.hasOwn(result.json, 'base'), false);
});

test('a failed re-ground leaves the stale pack as it was', t => {
  const project = started(t);
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  const grounding = path.join(project.root, PACK, 'grounding.json');
  const before = fs.readFileSync(grounding);
  fs.writeFileSync(path.join(project.root, PACK, '.sources.json'), JSON.stringify({
    sources: [{ path: 'src/gone.css', kind: 'theme' }], images: [],
  }));
  const sealed = ground(project, 'ground-seal');
  assert.equal(sealed.code, 1);
  assert.equal(sealed.json.code, 'source-missing');
  assert.deepEqual(fs.readFileSync(grounding), before);
  const after = guard(project);
  assert.equal(after.json.status, 'stale');
  assert.deepEqual(after.json.touched, ['src/theme.css']);
});

/** The finalization step as `node-brief` prints it to the session of a frozen development run. */
function finalizationBrief(t) {
  const project = gitScratch(t, FILES);
  freeze(project, { definition: DEVELOPMENT, inputs: { task_description: 'Restyle the header' } });
  const brief = verb(['node-brief', `--state=${project.state}`, '--node=finalization']);
  assert.equal(brief.code, 0, brief.stderr);
  const text = brief.stdout.replace(/\s+/g, ' ');
  const start = text.indexOf('5. **Refresh the grounding pack when the change touched it.**');
  assert.ok(start >= 0, 'finalization carries the refresh step');
  return { all: text, step: text.slice(start, text.indexOf('6. **Set the task status to completed**')) };
}

test('finalization: the step runs the guard on the run\'s state and asks nothing', t => {
  const { step } = finalizationBrief(t);
  assert.match(step, /turn\.mjs ground-status --pack=<project root>\/\.maister\/docs\/design-context --root=<project root> --state=<task path>\/orchestrator-state\.yml/);
  assert.match(step, /asks nothing, under any driver/);
});

test('finalization: with no pack or nothing touched the run is unchanged', t => {
  const { step } = finalizationBrief(t);
  assert.match(step, /\*\*No pack\*\* \(`missing`\), or \*\*`touched` empty\*\*: the step ends here, and nothing about the pack goes into the summary, the commit message or the close/);
});

test('finalization: the re-ground reuses --ground and draws no mockup', t => {
  const { step } = finalizationBrief(t);
  assert.match(step, /invoke `maister:mockup-studio` with the Skill tool and `--ground`/);
  assert.match(step, /draws no mockup and touches no task folder/);
  assert.match(step, /Refreshed the grounding pack \(digest `<first 8>`\): `<touched paths>` changed/);
});

test('finalization: the refreshed pack goes into the change\'s commit, or the close says to commit it', t => {
  const { step, all } = finalizationBrief(t);
  assert.match(step, /whichever commit carries the change carries the pack's files too — step 8's when it publishes/);
  assert.match(step, /the grounding pack was refreshed and `\.maister\/docs\/design-context\/` is to be committed with the change/);
  assert.match(all, /8\. \*\*Publish when the plan gate granted it\.\*\*.*the grounding pack step 5 refreshed included/);
});

test('finalization: a failed re-ground puts the pack back and is an open risk, never a failed run', t => {
  const { step } = finalizationBrief(t);
  assert.match(step, /copy the pack folder to a fresh `mktemp -d` directory/);
  assert.match(step, /put the copy back so the pack is as it was: replace the pack folder with the copy \(remove the folder, then copy the backup in its place\), so no file the build wrote, its start marker included, stays\. Record an `open` risk naming what failed/);
  assert.match(step, /A failed re-ground never fails the run/);
  assert.match(step, /\*\*A refusal\*\*: no re-ground; record one `open` risk/);
});

// Before finalization the pack is outside the change. Every delegate's prompt
// carries the run context, which names the pack when the project has one; the
// task-group implementer, whose prompt carries no run context, has the same
// rule in its own file.

/** What `prior-context --node` prints for `node` of a frozen development run, whitespace collapsed. */
function delegateContext(t, node, { withPack = true } = {}) {
  const project = gitScratch(t, FILES);
  if (withPack) seal(project);
  freeze(project, { definition: DEVELOPMENT, inputs: { task_description: 'Make the header navy' } });
  const result = verb(['prior-context', `--state=${project.state}`, `--node=${node}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.replace(/\s+/g, ' ');
}

for (const node of ['gap-analysis', 'specification', 'planning', 'verification']) {
  test(`scope: the ${node} delegate is told the pack is rebuilt at finalization, never edited by the change`, t => {
    const text = delegateContext(t, node);
    assert.match(text, /grounding pack \(not this change's to edit\): \S+\.maister[\\/]docs[\\/]design-context — /);
    assert.match(text, /rebuilt only from the sources it records by the studio's --ground, which a development run runs once, at finalization, when its change touched one of them/);
    assert.match(text, /No gap, scope question, requirement, task group or edit names a file under it, and no step runs --ground: the change edits the product's own sources/);
    assert.match(text, /The task folder's analysis\/design-context\/ \(mockups and design intent\) is a different folder and is read as before/);
  });
}

test('scope: a project without a pack hears nothing about one', t => {
  assert.doesNotMatch(delegateContext(t, 'gap-analysis', { withPack: false }), /grounding pack/);
});

test('scope: the task-group implementer never edits the pack or runs --ground', () => {
  const file = path.join(ROOT, 'plugins/maister/agents/task-group-implementer.md');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  assert.match(text, /- ❌ Edit anything under `\.maister\/docs\/design-context\/` or run `--ground`, even when a step names it — the grounding pack is rebuilt from its sources at the run's finalization, so change the product's own sources only and say under Notes that the step was left to finalization/);
});

// The close repeats the refresh line rather than retelling it.

test('close: Done carries the summary\'s refresh line word for word, digest and paths included', t => {
  const { step, all } = finalizationBrief(t);
  assert.match(step, /the close's \*\*Done\*\* carries that same line copied as it is — the same words, the digest and the paths, never retold or renamed/);
  assert.match(all, /When step 5 refreshed the grounding pack, \*\*Done\*\* holds the summary's "Refreshed the grounding pack \(digest …\)" line copied word for word from the summary, not a retelling of it/);
});

// --ground builds the pack afresh; the seal refuses a pack patched in place.

const STUDIO = path.join(ROOT, 'plugins/maister/skills/mockup-studio');
const prose = file => fs.readFileSync(path.join(STUDIO, file), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

test('rebuild: --ground clears the generated files and writes each afresh, never patching the old pack', t => {
  const pack = prose('references/grounding-pack.md');
  assert.match(pack, /`--ground` always rebuilds it from scratch/);
  assert.match(pack, /Every build, a first one included, starts from an empty pack and writes every file new/);
  assert.match(pack, /`turn\.mjs ground-clear --pack=<pack>` deletes everything in the folder but `grounding\.json` — `tokens\.md`, `shell\.html`, `strings\/`, `reference\/`, a stale `\.sources\.json` — and records the build's start in the marker `<pack>\/\.build-started`/);
  assert.match(pack, /Never read the old pack, by any route — a backup copy, its git history, an earlier mockup — to diff or patch it/);
  assert.match(pack, /`ground-seal` refuses a pack sealed before that was not cleared for this build \(`pack-not-cleared`\)/);
  assert.match(pack, /one that holds a file older than the clear \(`pack-not-rebuilt`\)\. On success it removes the marker, which is therefore never committed/);
  const skill = prose('SKILL.md');
  assert.match(skill, /\| `\/maister:mockup-studio --ground` \| Rebuilds the grounding pack from scratch, whatever its status: it clears the pack's generated files, harvests every value again from the sources and writes each file new, never by editing the old pack's files/);
  const { step } = finalizationBrief(t);
  assert.match(step, /It builds every file afresh from the sources, never by editing the old pack's files, in a fresh agent that never saw the old pack: this session neither reads nor writes the pack's files itself, and passes on nothing it saw of them/);
});

// The rebuild runs in a fresh agent, so nothing the session saw of the old
// pack can reach the new one.

test('rebuild: --ground dispatches the builder agent with only the pack path, the project root and the plugin root', () => {
  const skill = prose('SKILL.md');
  assert.match(skill, /The build runs in a fresh agent: dispatch the `maister:grounding-pack-builder` agent with the Task tool, with the model and effort `node <plugin root>\/skills\/workflow-engine\/scripts\/workflow\.mjs dispatch-model --agent=maister:grounding-pack-builder --host=claude` prints/);
  assert.match(skill, /a prompt that carries only the absolute pack path \(`<project root>\/<grounding>`\), the project root and the plugin root — nothing this session saw of the old pack\. This session neither reads nor writes the pack's files itself/);
  const pack = prose('references/grounding-pack.md');
  assert.match(pack, /`--ground` always rebuilds it from scratch, whatever its status, in a fresh `grounding-pack-builder` agent/);
  assert.match(pack, /hands the build to the `grounding-pack-builder` agent, which never saw the old pack and is given only the pack path, the project root and the plugin root/);
});

test('rebuild: the builder agent clears first, never reads the old pack, and seals', () => {
  const text = fs.readFileSync(path.join(ROOT, 'plugins/maister/agents/grounding-pack-builder.md'), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  assert.match(text, /^--- name: grounding-pack-builder description: /);
  assert.doesNotMatch(text.slice(0, text.indexOf('# Grounding Pack Builder')), /\b(tools|model):/);
  assert.match(text, /\*\*Clear first, before reading anything in the pack\.\*\* Run `turn\.mjs ground-clear --pack=<pack>`/);
  assert.match(text, /\*\*Never read the old pack, by any route\.\*\* Its generated files are gone after step 1; do not look for them elsewhere — not in a backup copy, not through `git show`, `git diff` or `git log -p` of the pack folder/);
  assert.match(text, /\*\*Write `<pack>\/\.sources\.json`\*\*/);
  assert.match(text, /\*\*Seal\.\*\* Run `turn\.mjs ground-seal --pack=<pack> --root=<project root>`/);
  assert.match(text, /seal: \{ok, digest, sources, images\} # ground-seal's JSON as it printed/);
  assert.match(text, /never commit/);
});

const MARKER = '.build-started';
function clear(project) {
  const result = run(TURN, ['ground-clear', `--pack=${path.join(project.root, PACK)}`], undefined, {}, project.root);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // no JSON: asserted by the test
  }
  return { ...result, json };
}

/** Every file under `dir`, `/`-separated, with its bytes: a tree compared byte for byte. */
function tree(dir) {
  const found = {};
  const walk = (at, prefix) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(at, entry.name), rel);
      else found[rel] = fs.readFileSync(path.join(at, entry.name)).toString('base64');
    }
  };
  walk(dir, '');
  return found;
}

/** A sealed pack with a reference page, the theme changed since, and the seal's input written again. */
function resealable(t) {
  const project = started(t);
  const pack = path.join(project.root, PACK);
  fs.mkdirSync(path.join(pack, 'reference'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'reference', 'list.html'), '<p>list</p>\n');
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  return { project, pack };
}

function writeSources(pack) {
  fs.writeFileSync(path.join(pack, '.sources.json'), JSON.stringify({
    sources: [{ path: 'src/theme.css', kind: 'theme' }, { path: 'package-lock.json', kind: 'lockfile', package: 'ui-kit' }],
    images: [],
  }));
}

test('rebuild: a pack fresh from a clone, one file patched, is refused as pack-not-cleared, whatever its file times', t => {
  const origin = started(t);
  const pack = path.join(origin.root, PACK);
  assert.equal(clear(origin).code, 0);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n');
  fs.writeFileSync(path.join(pack, 'shell.html'), '<header>green</header>\n');
  writeSources(pack);
  assert.equal(ground(origin, 'ground-seal').code, 0);
  git(origin.root, ['add', '-f', '--', PACK]);
  git(origin.root, ['commit', '-q', '-m', 'pack']);
  const copy = scratch(t);
  const clone = path.join(copy.root, 'clone');
  git(copy.root, ['clone', '-q', origin.root, clone]);
  const project = { root: clone };
  const cloned = path.join(clone, PACK);
  fs.writeFileSync(path.join(cloned, 'shell.html'), '<header>navy</header>\n');
  put(project, 'src/theme.css', ':root { --accent: #1e3a5f; }\n');
  writeSources(cloned);
  const before = fs.readFileSync(path.join(cloned, 'grounding.json'));
  const result = ground(project, 'ground-seal');
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.json.code, 'pack-not-cleared');
  assert.match(result.json.message, /was sealed before and was not cleared for this build/);
  assert.match(result.json.message, /Nothing was written and the input file is kept; run ground-clear/);
  assert.deepEqual(fs.readFileSync(path.join(cloned, 'grounding.json')), before);
  assert.equal(fs.existsSync(path.join(cloned, '.sources.json')), true);
});

test('rebuild: a re-seal with no clear is refused as pack-not-cleared, even with every file rewritten', t => {
  const { project, pack } = resealable(t);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n--accent: #f00\n');
  fs.writeFileSync(path.join(pack, 'reference', 'list.html'), '<p>list, red</p>\n');
  writeSources(pack);
  const before = fs.readFileSync(path.join(pack, 'grounding.json'));
  const result = ground(project, 'ground-seal');
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.json.code, 'pack-not-cleared');
  assert.deepEqual(fs.readFileSync(path.join(pack, 'grounding.json')), before);
  assert.equal(guard(project).json.status, 'stale');
});

test('rebuild: clear, write every file and seal is fresh, and leaves no marker', t => {
  const { project, pack } = resealable(t);
  fs.writeFileSync(path.join(pack, '.sources.json'), '{"stale": true}\n');
  const cleared = clear(project);
  assert.equal(cleared.code, 0, cleared.stdout + cleared.stderr);
  assert.equal(cleared.json.ok, true);
  assert.deepEqual(fs.readdirSync(pack).sort(), [MARKER, 'grounding.json']);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n--accent: #f00\n');
  fs.mkdirSync(path.join(pack, 'reference'));
  fs.writeFileSync(path.join(pack, 'reference', 'list.html'), '<p>list, red</p>\n');
  writeSources(pack);
  const result = ground(project, 'ground-seal');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(pack, MARKER)), false);
  assert.equal(fs.existsSync(path.join(pack, '.sources.json')), false);
  assert.equal(guard(project).json.status, 'fresh');
});

test('rebuild: a cleared pack that no longer makes an old file seals fresh', t => {
  const { project, pack } = resealable(t);
  assert.equal(clear(project).code, 0);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n--accent: #f00\n');
  writeSources(pack);
  const result = ground(project, 'ground-seal');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(guard(project).json.status, 'fresh');
});

test('rebuild: a file older than the clear is refused as pack-not-rebuilt, and nothing is written', t => {
  const { project, pack } = resealable(t);
  assert.equal(clear(project).code, 0);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n--accent: #f00\n');
  fs.mkdirSync(path.join(pack, 'reference'));
  fs.writeFileSync(path.join(pack, 'reference', 'list.html'), '<p>list</p>\n');
  const ago = (Date.now() - 3600_000) / 1000;
  fs.utimesSync(path.join(pack, 'reference', 'list.html'), ago, ago);
  writeSources(pack);
  const before = fs.readFileSync(path.join(pack, 'grounding.json'));
  const result = ground(project, 'ground-seal');
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.json.code, 'pack-not-rebuilt');
  assert.match(result.json.message, /reference[\\/]list\.html is older than the pack's clear/);
  assert.doesNotMatch(result.json.message, /tokens\.md/);
  assert.match(result.json.message, /Nothing was written and the input file is kept/);
  assert.deepEqual(fs.readFileSync(path.join(pack, 'grounding.json')), before);
  assert.equal(fs.existsSync(path.join(pack, MARKER)), true, 'a refusal keeps the marker for the retry');
  fs.writeFileSync(path.join(pack, 'reference', 'list.html'), '<p>list, red</p>\n');
  assert.equal(ground(project, 'ground-seal').code, 0);
  assert.equal(fs.existsSync(path.join(pack, MARKER)), false);
});

test('rebuild: a first build seals with or without a clear, and a clear makes a missing pack folder', t => {
  const plain = gitScratch(t, FILES);
  seal(plain);
  assert.equal(ground(plain, 'ground-status').json.status, 'fresh');
  const first = gitScratch(t, FILES);
  const pack = path.join(first.root, PACK);
  assert.equal(fs.existsSync(pack), false);
  const cleared = clear(first);
  assert.equal(cleared.code, 0, cleared.stdout + cleared.stderr);
  assert.equal(cleared.json.cleared, 0);
  assert.deepEqual(fs.readdirSync(pack), [MARKER]);
  seal(first);
  assert.deepEqual(fs.readdirSync(pack).sort(), ['grounding.json', 'tokens.md']);
});

test('rebuild: the marker changes neither the digest nor the status, touched included', t => {
  const project = started(t);
  const pack = path.join(project.root, PACK);
  put(project, 'src/theme.css', ':root { --accent: #f00; }\n');
  const before = guard(project).json;
  fs.writeFileSync(path.join(pack, MARKER), '{"started": "2026-01-01T00:00:00Z"}\n');
  const after = guard(project).json;
  assert.deepEqual(after, before);
  assert.equal(after.status, 'stale');
  assert.deepEqual(after.touched, ['src/theme.css']);
});

test('rebuild: ground-clear refuses a folder that is not a pack and deletes nothing', t => {
  const project = gitScratch(t, FILES);
  const pack = path.join(project.root, PACK);
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, 'notes.md'), 'mine\n');
  const result = clear(project);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.json.code, 'not-a-pack');
  assert.match(result.json.message, /Nothing was deleted/);
  assert.deepEqual(fs.readdirSync(pack), ['notes.md']);
});

test('rebuild: a failed rebuild after the clear is put back byte for byte by replacing the folder with the copy', t => {
  const { project, pack } = resealable(t);
  const snapshot = tree(pack);
  const backup = path.join(scratch(t).root, 'design-context');
  fs.cpSync(pack, backup, { recursive: true });
  assert.equal(clear(project).code, 0);
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens, half written\n');
  fs.writeFileSync(path.join(pack, '.sources.json'), JSON.stringify({ sources: [{ path: 'src/gone.css', kind: 'theme' }], images: [] }));
  const failed = ground(project, 'ground-seal');
  assert.equal(failed.code, 1);
  assert.equal(failed.json.code, 'source-missing');
  fs.rmSync(pack, { recursive: true, force: true });
  fs.cpSync(backup, pack, { recursive: true });
  assert.deepEqual(tree(pack), snapshot);
  assert.equal(fs.existsSync(path.join(pack, MARKER)), false);
  assert.equal(guard(project).json.status, 'stale');
});

// The mockup turn names ground-status's flags exactly.

test('turn: the Ground step names ground-status with its exact flags and full script path', () => {
  assert.match(prose('SKILL.md'), /2\. \*\*Ground\.\*\* Run `node <plugin root>\/skills\/mockup-studio\/scripts\/turn\.mjs ground-status --pack=<project root>\/<grounding> --root=<project root>`/);
});
