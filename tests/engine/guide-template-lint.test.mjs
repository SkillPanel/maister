import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, ROOT, run, scratch } from '../helpers.mjs';

// The guide template lint runs as `make validate` runs it: a child process from
// the repository root, its findings on stdout. Each committed sample is a
// definition plus its guide; a bad one breaks exactly one failing check, the
// over-target one only a word target, which warns and never fails.

const LINT = path.join(ROOT, 'tests/guide-template-lint.mjs');
const SAMPLES = path.join(FIXTURES, 'guide-template');
const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const BUILT_INS = ['development', 'migration', 'performance', 'product-design', 'research'];

function lint(...definitions) {
  return run(LINT, definitions.map(file => `--definition=${file}`), undefined, {}, ROOT);
}

function sample(name) {
  return path.join(SAMPLES, `${name}.yml`);
}

const lines = (text, prefix) => text.split('\n').filter(line => line.startsWith(prefix));

const guide = name => `tests/fixtures/guide-template/${name}.md`;

/** One bad sample per failing check, and the one line it fails with. */
const BAD = [
  ['check 1, headings', 'bad-headings', `FAIL: ${guide('bad-headings')}:49: ghost: no node of the graph has this section`],
  ['check 2, header', 'bad-header', `FAIL: ${guide('bad-header')}:6: header: only one paragraph may stand between the H1 and the first section`],
  ['check 3, parts', 'bad-parts', `FAIL: ${guide('bad-parts')}:42: draft: **Writes.** is out of order (Does, Asks, Writes, Summary, Re-run, Budget)`],
  ['check 5, gates', 'bad-gate', `FAIL: ${guide('bad-gate')}:46: approval: a gate section holds **Exception.** only, not **Does.**`],
  ['check 6, question sets', 'bad-question-sets', `FAIL: ${guide('bad-question-sets')}:25: scope: \`tone\` has a second **With question sets** line`],
  ['check 7, prose needed', 'bad-prose-needed', 'FAIL: tests/fixtures/guide-template/bad-prose-needed.yml:11: wrap-up: brief: carries budget but the guide has no section'],
  ['check 8, conventions not restated', 'bad-restated', `FAIL: ${guide('bad-restated')}:33: draft: restates a convention (Ask it from \`gate-brief --json\`)`],
];

test('guide-template-lint: the good sample passes with nothing printed', () => {
  const result = lint(sample('good'));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('guide-template-lint: each bad sample fails with exactly its own FAIL line and exits 1', async t => {
  for (const [check, name, expected] of BAD) {
    await t.test(check, () => {
      const result = lint(sample(name));
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(lines(result.stdout, 'FAIL: '), [expected]);
      assert.equal(result.stderr, '');
    });
  }
});

test('guide-template-lint: a part over its word target warns and still exits 0 (check 4)', () => {
  const result = lint(sample('over-target'));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(lines(result.stdout, 'FAIL: '), []);
  assert.deepEqual(lines(result.stdout, 'warning: '), [`warning: ${guide('over-target')}:33: draft: Does is 135 words (target 120)`]);
});

test('guide-template-lint: every failure is printed, never only the first, and its own errors exit 2', () => {
  const result = lint(...BAD.map(([, name]) => sample(name)));
  assert.equal(result.code, 1);
  assert.deepEqual(lines(result.stdout, 'FAIL: '), BAD.map(([, , expected]) => expected));

  const missing = lint(path.join(SAMPLES, 'no-such-sample.yml'));
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^guide-template-lint: /);

  const usage = run(LINT, ['--strict'], undefined, {}, ROOT);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /usage: /);
});

test('guide-template-lint: the five built-in guides follow the template', async t => {
  for (const name of BUILT_INS) {
    const definition = path.join(WORKFLOWS, `${name}.yml`);
    await t.test(name, () => {
      assert.match(fs.readFileSync(definition, 'utf8'), /^brief:/m, `${name}.yml carries no brief: block`);
      const result = lint(definition);
      assert.deepEqual(lines(result.stdout, 'FAIL: '), []);
      assert.equal(result.code, 0, result.stderr);
    });
  }
});

test('guide-template-lint: repository tooling — outside plugins/ and outside the make test glob', () => {
  assert.equal(path.dirname(LINT), path.join(ROOT, 'tests'));
  assert.ok(!LINT.endsWith('.test.mjs'));
  const makefile = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  assert.match(makefile, /node --test tests\/engine\/\*\.test\.mjs/);
});

test('guide-template-lint: make validate runs the lint after the display-text lint', () => {
  const makefile = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const target = makefile.slice(makefile.indexOf('\nvalidate:'));
  const display = target.indexOf('Checking every display title, option label and header');
  const step = target.indexOf('Checking every workflow guide follows the step template...');
  const command = target.indexOf('node tests/guide-template-lint.mjs');
  assert.ok(display > 0, 'the validate target has no display-text lint');
  assert.ok(step > display, 'the guide lint step does not follow the display-text lint');
  assert.ok(command > step, 'the validate target does not run node tests/guide-template-lint.mjs');
  assert.ok(command < target.indexOf('Checking commands are flat'), 'the lint runs later than directly after the display-text lint');
});

/** Copies of samples under a scratch directory, each through `convert`; returns the copy's definition paths by name. */
function copied(t, names, convert = text => text, { guides = true } = {}) {
  const dir = scratch(t).root;
  const out = {};
  for (const name of names) {
    for (const ext of guides ? ['yml', 'md'] : ['yml']) {
      fs.writeFileSync(path.join(dir, `${name}.${ext}`), convert(fs.readFileSync(path.join(SAMPLES, `${name}.${ext}`), 'utf8')));
    }
    out[name] = path.join(dir, `${name}.yml`);
  }
  return { dir, out };
}

test('guide-template-lint: CRLF samples pass and fail exactly as their LF copies, on the same lines', t => {
  const crlf = copied(t, ['good', 'bad-parts', 'over-target'], text => text.replace(/\n/g, '\r\n'));
  const lf = copied(t, ['good', 'bad-parts', 'over-target']);
  for (const name of ['good', 'bad-parts', 'over-target']) {
    const [a, b] = [lint(lf.out[name]), lint(crlf.out[name])];
    assert.equal(b.code, a.code, `${name}: ${b.stdout}${b.stderr}`);
    assert.equal(b.stdout.split(crlf.dir).join('<dir>'), a.stdout.split(lf.dir).join('<dir>'), name);
    assert.ok(!b.stdout.includes('\r'), name);
  }
  assert.equal(lint(crlf.out['bad-parts']).code, 1, 'a CRLF guide does not hide a failure');
});

test('guide-template-lint: a definition whose guide is missing is the script\'s own error, exit 2', t => {
  const { out } = copied(t, ['good'], undefined, { guides: false });
  const result = lint(out.good);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^guide-template-lint: /);
});
