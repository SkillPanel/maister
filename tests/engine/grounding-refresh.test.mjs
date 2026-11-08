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
  assert.match(step, /put the copy back so the pack is as it was, and record an `open` risk naming what failed/);
  assert.match(step, /A failed re-ground never fails the run/);
  assert.match(step, /\*\*A refusal\*\*: no re-ground; record one `open` risk/);
});
