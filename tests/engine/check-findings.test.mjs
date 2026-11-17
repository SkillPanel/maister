import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The findings check standards discovery's scanners and session run on each
// scanner's YAML file, run as a child process the way they run it. It needs
// nothing but Node: no Python, no YAML package, no shell feature, so one test
// runs it with an empty PATH.

const CHECK = path.join(ROOT, 'plugins/maister/skills/standards-discover/scripts/check-findings.mjs');

/** A scratch directory removed when the test ends. */
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-check-findings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write `text` as a findings file and check it; the report parsed when there is one. */
function check(t, text, env = {}) {
  const dir = scratch(t);
  const file = path.join(dir, 'config findings.yml');
  if (text !== null) fs.writeFileSync(file, text);
  return checkFile(file, env);
}

function checkFile(file, env = {}) {
  const result = run(CHECK, [file], undefined, env);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: asserted by the test
  }
  return { ...result, report };
}

const VALID = [
  'github_available: false  # gh was not there',
  'findings:',
  '  - category: "global/naming"',
  '    standard_name: "Kebab-case file names"',
  '    description: "Name files in kebab-case: never camelCase"',
  '    confidence: 85',
  '    evidence:',
  '      - ".eslintrc.json:12: rule \\"filenames/match-regex\\""',
  "      - 'docs/style.md: \"files\" it''s stated'",
  '    source: "config"',
  '    examples: []',
  '  - category: testing',
  '    standard_name: Node test runner',
  '    description: Tests live under C:\\work\\tests and use node:test',
  '    confidence: 70',
  '    evidence: ["41 of 44 test files import node:test", "Examples: a.test.mjs"]',
  '    source: code-patterns',
  '    examples:',
  '      - "test(\'name\', () => {})"',
  '',
].join('\n');

test('a well-formed findings file passes, with its count', t => {
  const { code, report } = check(t, VALID);
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.findings, 2);
  assert.deepEqual(report.problems, []);
});

test('an empty findings list passes', t => {
  const { code, report } = check(t, 'findings: []\n');
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.findings, 0);
});

test('the check needs nothing on PATH: no Python, no shell, no package', t => {
  const empty = scratch(t);
  const { code, report } = check(t, VALID, { PATH: empty, Path: empty });
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.findings, 2);
});

test('a missing file fails as a source that did not run', t => {
  const { code, report } = check(t, null);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.match(report.problems[0].message, /no findings file/);
});

test('a file that does not parse fails, with a hint to quote the value', t => {
  const { code, report } = check(t, 'findings:\n  - category: |\n      global\n');
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.match(report.problems[0].message, /block scalar/);
  assert.match(report.problems[0].message, /quoted string/);
});

test('a file with no findings list fails', t => {
  const { code, report } = check(t, 'github_available: false\n');
  assert.equal(code, 1);
  assert.deepEqual(report.problems.map(p => p.path), ['findings']);
});

test('a finding missing a field, or with a bad confidence or evidence, fails at its path', t => {
  const text = [
    'findings:',
    '  - category: global',
    '    standard_name: One',
    '    confidence: 120',
    '    evidence: []',
    '    source: config',
    '  - category: global',
    '    standard_name: Two',
    '    description: Something',
    '    confidence: "high"',
    '    evidence: ["a"]',
    '    source: docs',
    '    examples: "none"',
    '',
  ].join('\n');
  const { code, report } = check(t, text);
  assert.equal(code, 1);
  assert.deepEqual(report.problems.map(p => p.path).sort(), [
    'findings.0.confidence',
    'findings.0.description',
    'findings.0.evidence',
    'findings.1.confidence',
    'findings.1.examples',
  ]);
});

test('no file named is a usage error', () => {
  const result = run(CHECK, []);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage/);
});
