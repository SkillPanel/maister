import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT, run } from '../helpers.mjs';
import { GROUNDING_KEYS, GROUNDING_SCHEMA_VERSION } from '../../plugins/maister/skills/mockup-studio/scripts/lib/shapes.mjs';
import { blobHash, contentHash } from '../../plugins/maister/skills/mockup-studio/scripts/lib/grounding.mjs';

// The grounding verbs, run as a child process the way the skill runs them:
// the builder writes `<pack>/.sources.json`, `turn.mjs ground-seal` hashes
// what it names and writes `grounding.json`, and `turn.mjs ground-status`
// reads the pack back against the project. Each test works in its own scratch
// project under the OS temp directory.

const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

/** A scratch project with a theme file, a lockfile, an image and a pack folder holding one file. */
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-mockup-grounding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pack = path.join(root, '.maister', 'docs', 'design-context');
  fs.mkdirSync(pack, { recursive: true });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'theme.css'), ':root { --accent: #336; }\n');
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(root, 'package-lock.json'), lock('1.0.0'));
  fs.writeFileSync(path.join(pack, 'tokens.md'), '# Tokens\n');
  return { root, pack, sourcesFile: path.join(pack, '.sources.json') };
}

const lock = version => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/ui-kit': { version }, 'node_modules/other': { version: '9.9.9' } } });

function writeSources(where, body) {
  fs.writeFileSync(where.sourcesFile, JSON.stringify(body ?? {
    sources: [
      { path: 'src/theme.css', kind: 'theme' },
      { path: 'package-lock.json', kind: 'lockfile', package: 'ui-kit' },
    ],
    images: [{ path: 'logo.png' }],
  }));
}

function ground(where, verb) {
  const result = run(TURN, [verb, `--pack=${where.pack}`, `--root=${where.root}`], undefined, {}, where.root);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // no JSON: asserted by the test
  }
  return { ...result, json };
}

function sealed(t) {
  const where = project(t);
  writeSources(where);
  const sealResult = ground(where, 'ground-seal');
  assert.equal(sealResult.code, 0, sealResult.stdout + sealResult.stderr);
  return where;
}

test('the blob hash is git\'s: the empty-blob vector, and git hash-object when git is present', t => {
  assert.equal(blobHash(Buffer.alloc(0)), EMPTY_BLOB);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) return t.skip('git is not on PATH');
  const bytes = 'héllo\nworld\n';
  const out = spawnSync('git', ['hash-object', '--stdin'], { input: bytes, encoding: 'utf8' });
  assert.equal(blobHash(Buffer.from(bytes, 'utf8')), out.stdout.trim());
});

test('seal writes grounding.json with the declared keys and deletes the input', t => {
  const where = project(t);
  writeSources(where);
  const result = ground(where, 'ground-seal');
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.sources, 2);
  assert.equal(result.json.images, 1);
  assert.equal(fs.existsSync(where.sourcesFile), false);
  const written = JSON.parse(fs.readFileSync(path.join(where.pack, 'grounding.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), Object.keys(GROUNDING_KEYS).sort());
  assert.equal(written.schema_version, GROUNDING_SCHEMA_VERSION);
  assert.equal(written.digest, result.json.digest);
  const entry = written.sources.find(each => each.kind === 'lockfile');
  assert.equal(entry.package, 'ui-kit');
  assert.equal(entry.version, '1.0.0');
  assert.equal(entry.hash, blobHash(Buffer.from('ui-kit@1.0.0', 'utf8')));
  assert.deepEqual(fs.readdirSync(where.pack).filter(name => name.endsWith('.tmp')), []);
});

test('status is fresh after seal, and missing with no pack', t => {
  const where = project(t);
  const none = ground(where, 'ground-status');
  assert.equal(none.code, 0);
  assert.equal(none.json.status, 'missing');
  const done = sealed(t);
  const written = JSON.parse(fs.readFileSync(path.join(done.pack, 'grounding.json'), 'utf8'));
  const status = ground(done, 'ground-status');
  assert.equal(status.code, 0);
  assert.equal(status.json.status, 'fresh');
  assert.equal(status.json.digest, written.digest);
  assert.equal(status.json.schema_version, 1);
  assert.equal(status.json.plugin_schema_version, GROUNDING_SCHEMA_VERSION);
  assert.deepEqual([status.json.reasons, status.json.changed, status.json.gone], [[], [], []]);
});

test('a text source rewritten with CRLF line endings, and a pack file likewise, leave the pack fresh with the same digest', t => {
  const where = sealed(t);
  const written = JSON.parse(fs.readFileSync(path.join(where.pack, 'grounding.json'), 'utf8'));
  const theme = path.join(where.root, 'src', 'theme.css');
  fs.writeFileSync(theme, fs.readFileSync(theme, 'utf8').replace(/\n/g, '\r\n'));
  const tokens = path.join(where.pack, 'tokens.md');
  fs.writeFileSync(tokens, fs.readFileSync(tokens, 'utf8').replace(/\n/g, '\r\n'));
  const status = ground(where, 'ground-status').json;
  assert.equal(status.status, 'fresh');
  assert.deepEqual([status.reasons, status.changed, status.gone], [[], [], []]);
  assert.equal(status.digest, written.digest);
  assert.equal(contentHash(Buffer.from('a\r\nb\r\n', 'utf8')), blobHash(Buffer.from('a\nb\n', 'utf8')));
});

test('a binary source (a NUL byte) is hashed as it is, so a CRLF change in it makes the pack stale', t => {
  const where = project(t);
  const blob = path.join(where.root, 'src', 'font.bin');
  fs.writeFileSync(blob, Buffer.from([0, 10, 65, 10]));
  writeSources(where, { sources: [{ path: 'src/font.bin', kind: 'theme' }], images: [] });
  assert.equal(ground(where, 'ground-seal').code, 0);
  const written = JSON.parse(fs.readFileSync(path.join(where.pack, 'grounding.json'), 'utf8'));
  assert.equal(written.sources[0].hash, blobHash(Buffer.from([0, 10, 65, 10])));
  fs.writeFileSync(blob, Buffer.from([0, 13, 10, 65, 13, 10]));
  const status = ground(where, 'ground-status').json;
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.changed, ['src/font.bin']);
});

test('status is stale for a changed source, a gone source and an older schema; a newer schema is reported and the pack still used', t => {
  const where = sealed(t);
  const theme = path.join(where.root, 'src', 'theme.css');
  fs.writeFileSync(theme, ':root { --accent: #633; }\n');
  let status = ground(where, 'ground-status').json;
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.reasons, ['source-changed']);
  assert.deepEqual(status.changed, ['src/theme.css']);

  fs.rmSync(theme);
  status = ground(where, 'ground-status').json;
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.reasons, ['source-gone']);
  assert.deepEqual(status.gone, ['src/theme.css']);

  const fresh = sealed(t);
  const file = path.join(fresh.pack, 'grounding.json');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...document, schema_version: 0 }));
  status = ground(fresh, 'ground-status').json;
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.reasons, ['schema-older']);

  fs.writeFileSync(file, JSON.stringify({ ...document, schema_version: GROUNDING_SCHEMA_VERSION + 1 }));
  status = ground(fresh, 'ground-status').json;
  assert.equal(status.status, 'fresh');
  assert.deepEqual(status.reasons, ['schema-newer']);
});

test('a changed image leaves the pack fresh, and a version change of the recorded package makes it stale', t => {
  const where = sealed(t);
  fs.writeFileSync(path.join(where.root, 'logo.png'), Buffer.from([9, 9, 9]));
  assert.equal(ground(where, 'ground-status').json.status, 'fresh');

  fs.writeFileSync(path.join(where.root, 'package-lock.json'), lock('1.0.0').replace('9.9.9', '8.8.8'));
  assert.equal(ground(where, 'ground-status').json.status, 'fresh', 'another package moving does not matter');

  fs.writeFileSync(path.join(where.root, 'package-lock.json'), lock('1.1.0'));
  const status = ground(where, 'ground-status').json;
  assert.equal(status.status, 'stale');
  assert.deepEqual(status.changed, ['package-lock.json']);
});

test('ground-status refuses a malformed grounding.json, and ground-seal refuses a missing source', t => {
  const where = sealed(t);
  fs.writeFileSync(path.join(where.pack, 'grounding.json'), '{"schema_version": 1');
  let result = ground(where, 'ground-status');
  assert.equal(result.code, 1);
  assert.equal(result.json.code, 'grounding-malformed');
  fs.writeFileSync(path.join(where.pack, 'grounding.json'), '{"schema_version": 1}');
  assert.equal(ground(where, 'ground-status').json.code, 'grounding-malformed');

  const bare = project(t);
  writeSources(bare, { sources: [{ path: 'src/nope.css', kind: 'theme' }], images: [] });
  result = ground(bare, 'ground-seal');
  assert.equal(result.code, 1);
  assert.equal(result.json.code, 'source-missing');
  assert.equal(fs.existsSync(bare.sourcesFile), true, 'the input is kept on a refusal');
  assert.equal(fs.existsSync(path.join(bare.pack, 'grounding.json')), false);

  fs.rmSync(bare.sourcesFile);
  assert.equal(ground(bare, 'ground-seal').json.code, 'sources-file-missing');
  fs.writeFileSync(bare.sourcesFile, '{"sources": 3}');
  assert.equal(ground(bare, 'ground-seal').json.code, 'sources-file-malformed');
});
