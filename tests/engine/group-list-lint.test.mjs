import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The group-list lint runs as `make validate` runs it: a child process, its
// findings on stdout. Each fixture is copied into a scratch root's `docs/`,
// since the lint reads only `plugins/maister/` and `docs/`.

const LINT = path.join(ROOT, 'tests/group-list-lint.mjs');
const FIXTURES = path.join(ROOT, 'tests/fixtures/group-list');

const lint = (...args) => run(LINT, args, undefined, {}, ROOT);

function plant(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-group-list-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const fixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);

test('group-list-lint: the repository passes', () => {
  const result = lint();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('group-list-lint: a comma list, a bullet list, a fenced folder tree and a table each fail at their block', t => {
  const expected = { 'bad-comma.md': 3, 'bad-bullets.md': 5, 'bad-tree.md': 3, 'bad-table.md': 3 };
  for (const [name, line] of Object.entries(expected)) {
    const root = plant(t, { 'docs/page.md': fixture(name) });
    const result = lint(`--root=${root}`);
    assert.equal(result.code, 1, `${name}: ${result.stdout}${result.stderr}`);
    const lines = failLines(result);
    assert.equal(lines.length, 1, `${name}: ${result.stdout}`);
    assert.match(lines[0], new RegExp(`^FAIL: docs/page\\.md:${line}: `), name);
  }
});

test('group-list-lint: the nine listed, three of the four, and the four with data beside them pass', t => {
  for (const name of ['good-nine.md', 'good-three.md', 'good-with-data.md']) {
    const root = plant(t, { 'plugins/maister/skills/x/SKILL.md': fixture(name) });
    const result = lint(`--root=${root}`);
    assert.equal(result.code, 0, `${name}: ${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, '');
  }
});

test('group-list-lint: the group table is JSON and is never read', t => {
  const root = plant(t, {
    'plugins/maister/skills/docs-manager/docs/standards-groups.json': '{"groups": ["global", "frontend", "backend", "testing"]}\n',
    'docs/page.md': fixture('good-nine.md'),
  });
  const result = lint(`--root=${root}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('group-list-lint: an unknown flag is a usage error', () => {
  const result = lint('--nope');
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /^usage: node tests\/group-list-lint\.mjs/m);
  assert.equal(result.stdout, '');
});
