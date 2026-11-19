import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The marketplace lint runs as `make validate` runs it: a child process, its
// findings on stdout. Each condition is planted alone in a scratch root, so a
// test sees exactly the one FAIL line it provokes.

const LINT = path.join(ROOT, 'tests/marketplace-lint.mjs');
const CLAUDE = '.claude-plugin/marketplace.json';
const COPILOT = '.github/plugin/marketplace.json';
const MANIFEST = 'plugins/maister/.claude-plugin/plugin.json';

function lint(...args) {
  return run(LINT, args, undefined, {}, ROOT);
}

/** The three files for a channel; `edit` changes the parsed objects before they are written. */
function files({ name = 'maister-plugins-beta', ref = 'dist/beta', edit } = {}) {
  const version = '3.0.0-beta.1';
  const docs = {
    [CLAUDE]: {
      name,
      version,
      plugins: [{ name: 'maister', source: './plugins/maister' }],
    },
    [COPILOT]: {
      name,
      metadata: { version },
      plugins: [{
        name: 'maister',
        version,
        source: { source: 'github', repo: 'SkillPanel/maister', ref, path: 'copilot' },
      }],
    },
    [MANIFEST]: { name: 'maister', version },
  };
  if (edit) edit(docs);
  return Object.fromEntries(Object.entries(docs).map(([file, doc]) => [file, `${JSON.stringify(doc, null, 2)}\n`]));
}

/** A scratch root holding `written`; a null value leaves the file out. */
function plant(t, written) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-marketplace-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(written)) {
    if (text === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);
const edited = edit => files({ edit });

const MISSING = "missing; every host's marketplace file and the plugin manifest are required";

const OFFENCES = [
  ['a missing Claude file', { ...files(), [CLAUDE]: null }, `FAIL: ${CLAUDE}: ${MISSING}`],
  ['a missing Copilot file', { ...files(), [COPILOT]: null }, `FAIL: ${COPILOT}: ${MISSING}`],
  ['a missing manifest', { ...files(), [MANIFEST]: null }, `FAIL: ${MANIFEST}: ${MISSING}`],
  ['invalid JSON in the Copilot file', { ...files(), [COPILOT]: '{ nope' }, `FAIL: ${COPILOT}: not valid JSON`],
  ['a manifest with no version', edited(d => { delete d[MANIFEST].version; }),
    `FAIL: ${MANIFEST}: the plugin manifest names no version`],
  ['two different marketplace names', edited(d => { d[COPILOT].name = 'maister-plugins'; }),
    `FAIL: ${COPILOT}: names the marketplace "maister-plugins", the Claude Code file "maister-plugins-beta"; both name the same marketplace`],
  ['a marketplace name that is neither', edited(d => { d[CLAUDE].name = 'other'; d[COPILOT].name = 'other'; }),
    `FAIL: ${CLAUDE}: the marketplace "other" is neither maister-plugins nor maister-plugins-beta`],
  ['a Claude top-level version that differs', edited(d => { d[CLAUDE].version = '3.0.0'; }),
    `FAIL: ${CLAUDE}: version is "3.0.0", the plugin's version is "3.0.0-beta.1"`],
  ['a Claude entry version that differs', edited(d => { d[CLAUDE].plugins[0].version = '3.0.0'; }),
    `FAIL: ${CLAUDE}: plugins[maister].version is "3.0.0", the plugin's version is "3.0.0-beta.1"`],
  ['a Copilot metadata version that differs', edited(d => { d[COPILOT].metadata.version = '3.0.0'; }),
    `FAIL: ${COPILOT}: metadata.version is "3.0.0", the plugin's version is "3.0.0-beta.1"`],
  ['a Copilot entry version that differs', edited(d => { d[COPILOT].plugins[0].version = '3.0.0'; }),
    `FAIL: ${COPILOT}: plugins[maister].version is "3.0.0", the plugin's version is "3.0.0-beta.1"`],
  ['an extra Claude entry', edited(d => { d[CLAUDE].plugins.push({ name: 'maister-copilot', source: './x' }); }),
    `FAIL: ${CLAUDE}: lists "maister-copilot"; a marketplace file lists only maister`],
  ['no Copilot entry', edited(d => { d[COPILOT].plugins = []; }),
    `FAIL: ${COPILOT}: lists no maister entry`],
  ['a Claude source that is not the source tree', edited(d => { d[CLAUDE].plugins[0].source = './plugins/other'; }),
    `FAIL: ${CLAUDE}: maister's source is "./plugins/other"; the Claude Code file lists ./plugins/maister, the source tree`],
  ['a Copilot source that is a path', edited(d => { d[COPILOT].plugins[0].source = './plugins/maister'; }),
    `FAIL: ${COPILOT}: maister's source is "./plugins/maister", a path in this repository; the Copilot build is listed from its dist branch`],
  ['a Copilot source that is not github', edited(d => { d[COPILOT].plugins[0].source.repo = 'Other/maister'; }),
    `FAIL: ${COPILOT}: maister's source is not github SkillPanel/maister`],
  ['a Copilot ref that is neither channel', edited(d => { d[COPILOT].plugins[0].source.ref = 'main'; }),
    `FAIL: ${COPILOT}: maister's ref is "main"; it is dist/beta or dist/stable`],
  ['a Copilot path that is not copilot', edited(d => { d[COPILOT].plugins[0].source.path = 'x'; }),
    `FAIL: ${COPILOT}: maister's path is "x"; the Copilot build sits in copilot/`],
  ['the beta marketplace listing the stable build', edited(d => { d[COPILOT].plugins[0].source.ref = 'dist/stable'; }),
    `FAIL: ${COPILOT}: the marketplace maister-plugins-beta lists the build from dist/stable; that channel reads dist/beta`],
  ['the stable marketplace listing the beta build', files({
    name: 'maister-plugins',
    edit: d => { d[COPILOT].plugins[0].source.ref = 'dist/beta'; },
  }), `FAIL: ${COPILOT}: the marketplace maister-plugins lists the build from dist/beta; that channel reads dist/stable`],
];

test('marketplace-lint: the repository passes with nothing printed', () => {
  const result = lint();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('marketplace-lint: a clean scratch root passes on each channel', t => {
  for (const written of [files(), files({ name: 'maister-plugins', ref: 'dist/stable' })]) {
    const result = lint(`--root=${plant(t, written)}`);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('marketplace-lint: each condition fails with exactly its own FAIL line and exits 1', async t => {
  for (const [offence, written, expected] of OFFENCES) {
    await t.test(offence, st => {
      const result = lint(`--root=${plant(st, written)}`);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(failLines(result), [expected]);
    });
  }
});

test('marketplace-lint: an unknown argument is a usage error', () => {
  const result = lint('--file=x');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});

test('marketplace-lint: make validate runs it under its own heading', () => {
  const heading = "Checking every marketplace file names the same marketplace and version, and no other host's build...";
  const lines = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(line => line === `\t@echo "${heading}"`);
  assert.ok(start >= 0, 'the Makefile has the marketplace lint step');
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('\t') || lines[i].startsWith('\t@echo "Checking')) break;
    body.push(lines[i]);
  }
  assert.deepEqual(body, ['\t@node tests/marketplace-lint.mjs']);
});
