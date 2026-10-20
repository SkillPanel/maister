import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { FIXTURES, ROOT, run } from '../helpers.mjs';
import { lintText } from '../frontmatter-lint.mjs';

// The frontmatter lint runs as `make validate` runs it: a child process from
// the repository root, its findings on stdout. Each committed sample breaks
// exactly one rule; the good one uses every form the subset allows.

const LINT = path.join(ROOT, 'tests/frontmatter-lint.mjs');
const SAMPLES = path.join(FIXTURES, 'frontmatter');

function lint(...files) {
  return run(LINT, files.map(file => `--file=${file}`), undefined, {}, ROOT);
}

const sample = name => path.join(SAMPLES, `${name}.md`);
const shown = name => `tests/fixtures/frontmatter/${name}.md`;

/** One bad sample per rule, and the one line it fails with. */
const BAD = [
  ['a plain scalar holding ": "', 'bad-colon', `FAIL: ${shown('bad-colon')}:3: a plain scalar holding \`: \`, which YAML reads as a mapping; quote the value`],
  ['a plain scalar holding " #"', 'bad-hash', `FAIL: ${shown('bad-hash')}:3: a plain scalar holding \` #\`, which YAML reads as the start of a comment; quote the value`],
  ['a tab in indentation', 'bad-tab', `FAIL: ${shown('bad-tab')}:4: a tab in indentation`],
  ['an unclosed quote', 'bad-quote', `FAIL: ${shown('bad-quote')}:3: an unclosed double quote`],
  ['a duplicate key', 'bad-duplicate', `FAIL: ${shown('bad-duplicate')}:4: the key \`description\` is given twice (first on line 3)`],
  ['a reserved first character', 'bad-reserved', `FAIL: ${shown('bad-reserved')}:3: a plain scalar opening with \`\`\`, which YAML reserves; quote the value`],
  ['an unclosed flow collection', 'bad-flow', `FAIL: ${shown('bad-flow')}:3: an unclosed flow collection`],
  ['a frontmatter never closed', 'bad-unclosed', `FAIL: ${shown('bad-unclosed')}:1: the frontmatter is opened but never closed`],
];

test('frontmatter-lint: the good sample passes with nothing printed', () => {
  const result = lint(sample('good'));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('frontmatter-lint: each bad sample fails with exactly its own FAIL line and exits 1', async t => {
  for (const [rule, name, expected] of BAD) {
    await t.test(rule, () => {
      const result = lint(sample(name));
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(result.stdout.split(/\r?\n/).filter(Boolean), [expected]);
    });
  }
});

test('frontmatter-lint: the shipped trees pass', () => {
  const result = lint();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('frontmatter-lint: a CRLF file is read line by line like an LF one', () => {
  const crlf = '---\r\nname: sample\r\ndescription: Runs: everything\r\n---\r\n';
  assert.deepEqual(lintText(crlf).map(finding => finding.line), [3]);
  assert.deepEqual(lintText(crlf.replace('Runs: everything', '"Runs: everything"')), []);
});

test('frontmatter-lint: a file without frontmatter has nothing to check', () => {
  assert.deepEqual(lintText('# A heading: with a colon\n'), []);
});

test('frontmatter-lint: an unknown argument is a usage error', () => {
  const result = run(LINT, ['--definition=x'], undefined, {}, ROOT);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});
