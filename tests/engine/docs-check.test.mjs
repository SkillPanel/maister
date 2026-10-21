import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The documentation index check, run as a child process the way docs-operator,
// the completeness checker and the quick skills run it: a scratch
// `.maister/docs/` per test, the JSON report and the exit code asserted. It
// asks nothing of the documents' format, so the documents here are as odd as
// copied-in files get; only INDEX.md's entries and the file list matter.

const CHECK = path.join(ROOT, 'plugins/maister/skills/docs-manager/scripts/docs-check.mjs');
const BUNDLED = path.join(ROOT, 'plugins/maister/skills/docs-manager/docs');

/** A scratch project whose `.maister/docs/` holds `files` (path → content); removed when the test ends. */
function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-docs-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const docs = path.join(root, '.maister', 'docs');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(docs, rel)), { recursive: true });
    fs.writeFileSync(path.join(docs, rel), content);
  }
  return { root, docs };
}

/** Run the check from the project root, as callers do; the report parsed when there is one. */
function check(where, args = []) {
  const result = run(CHECK, args, undefined, {}, where.root);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: a usage or tooling error, asserted by the test
  }
  return { ...result, report };
}

const codes = list => list.map(each => each.code);

const INDEX = [
  '<!-- Maintained by maister: edit the source documents, not this file. -->',
  '# Documentation Index',
  '',
  '## Project documentation',
  '',
  '### Vision (`project/vision.md`)',
  'Why the product exists and who it serves. Open when a change needs the product direction.',
  '',
  '## Standards: global',
  '',
  '### Error Handling (`standards/global/error-handling.md`)',
  'Rules for raising and reporting errors. Read in full before: error types, user-facing messages, logging failures.',
  '',
].join('\n');

const DOCS = {
  'INDEX.md': INDEX,
  'project/vision.md': '# Vision\n\nWhy we build this.\n',
  'standards/global/error-handling.md': '## Error Handling\n\n### Typed errors\nUse typed errors.\n',
};

test('docs-check: an index that maps every document passes with nothing to report', t => {
  const result = check(project(t, DOCS));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.files, 2);
  assert.equal(result.report.entries, 2);
  assert.deepEqual(result.report.failures, []);
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: a document with no entry fails as unindexed', t => {
  const result = check(project(t, { ...DOCS, 'project/deploy.md': '# Deploy\n' }));
  assert.equal(result.code, 1);
  assert.equal(result.report.ok, false);
  assert.deepEqual(result.report.failures, [
    { code: 'unindexed-file', path: 'project/deploy.md', message: 'project/deploy.md has no entry in INDEX.md' },
  ]);
});

test('docs-check: an entry whose document is gone fails as dead', t => {
  const docs = { ...DOCS };
  delete docs['project/vision.md'];
  const result = check(project(t, docs));
  assert.equal(result.code, 1);
  assert.deepEqual(codes(result.report.failures), ['dead-entry']);
  assert.equal(result.report.failures[0].path, 'project/vision.md');
  assert.equal(result.report.failures[0].line, 6);
});

test('docs-check: a second entry for one document fails as a duplicate, naming the first', t => {
  const index = `${INDEX}\n### Vision again (\`./project/vision.md\`)\nThe same file under another title.\n`;
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 1);
  assert.deepEqual(codes(result.report.failures), ['duplicate-entry']);
  assert.match(result.report.failures[0].message, /the first is on line 6/);
});

test('docs-check: leftover conflict markers fail, one finding per marker line', t => {
  const index = INDEX.replace(
    '### Vision (`project/vision.md`)\nWhy the product exists and who it serves. Open when a change needs the product direction.',
    [
      '<<<<<<< HEAD',
      '### Vision (`project/vision.md`)',
      'Why the product exists. Open for product direction.',
      '=======',
      '### Vision (`project/vision.md`)',
      'Who the product serves. Open for product direction.',
      '>>>>>>> feature',
    ].join('\n'),
  );
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 1);
  const markers = result.report.failures.filter(each => each.code === 'conflict-marker');
  assert.deepEqual(markers.map(each => each.line), [6, 9, 12]);
  assert.ok(codes(result.report.failures).includes('duplicate-entry'));
});

test('docs-check: a line of equals signs outside a conflict is not a marker', t => {
  const index = `${INDEX}\nSetext heading\n=======\n`;
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 0, JSON.stringify(result.report));
});

test('docs-check: documents with no INDEX.md fail once, not once per file', t => {
  const docs = { ...DOCS };
  delete docs['INDEX.md'];
  const result = check(project(t, docs));
  assert.equal(result.code, 1);
  assert.deepEqual(codes(result.report.failures), ['index-missing']);
  assert.equal(result.report.index, null);
});

test('docs-check: an entry over its size guide warns and still passes', t => {
  const long = 'Rules for the storage layer and everything it touches, written out at length so the entry grows well past what a reader scanning the map needs to decide whether to open the file, which is exactly the habit the guide exists to stop before it spreads further.';
  const index = INDEX.replace('Why the product exists and who it serves. Open when a change needs the product direction.', long);
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 0);
  assert.deepEqual(codes(result.report.warnings), ['entry-over-guide']);
  assert.match(result.report.warnings[0].message, /guide is about 240/);
});

test('docs-check: a standards entry has the larger guide', t => {
  const topics = 'Rules for raising, propagating and reporting errors across the service and its workers. Read in full before: error types, user-facing messages, logging failures, retries and backoff, timeouts, validation errors, wrapping causes, background job failures.';
  const index = INDEX.replace('Rules for raising and reporting errors. Read in full before: error types, user-facing messages, logging failures.', topics);
  assert.ok([...topics].length > 240 && [...topics].length <= 300);
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 0);
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: a date, a ticket reference and a count each warn', t => {
  const index = INDEX.replace(
    'Why the product exists and who it serves. Open when a change needs the product direction.',
    'Product direction, amended 2026-10-02 after #612; lists 14 goals.',
  );
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 0);
  assert.deepEqual(codes(result.report.warnings), ['entry-date', 'entry-ticket-ref', 'entry-count']);
  assert.match(result.report.warnings[0].message, /2026-10-02/);
  assert.match(result.report.warnings[1].message, /#612/);
  assert.match(result.report.warnings[2].message, /14 goals/);
});

test('docs-check: a month-and-year date and a count with an adjective warn too', t => {
  const index = INDEX.replace(
    'Why the product exists and who it serves. Open when a change needs the product direction.',
    'Product direction as of March 2026, across 12 REST endpoints.',
  );
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.deepEqual(codes(result.report.warnings), ['entry-date', 'entry-count']);
});

test('docs-check: numbers that count nothing, and code spans, do not warn', t => {
  const index = INDEX.replace(
    'Why the product exists and who it serves. Open when a change needs the product direction.',
    'Targets Node 20 or later and HTTP/2; `retries: 3 attempts` is configured in code. Open for runtime choices.',
  );
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: a standards file past its size or rule guide warns, suggesting a split', t => {
  const rules = Array.from({ length: 16 }, (_, at) => `### Rule ${at + 1}\nDo the thing.\n`).join('\n');
  const result = check(project(t, { ...DOCS, 'standards/global/error-handling.md': `## Error Handling\n\n${rules}` }));
  assert.equal(result.code, 0);
  assert.deepEqual(codes(result.report.warnings), ['standards-file-over-guide']);
  assert.match(result.report.warnings[0].message, /16 rules/);
  assert.match(result.report.warnings[0].message, /split it/);

  const big = check(project(t, { ...DOCS, 'standards/global/error-handling.md': `## Error Handling\n\n### One rule\n${'x'.repeat(13 * 1024)}\n` }));
  assert.deepEqual(codes(big.report.warnings), ['standards-file-over-guide']);
});

test('docs-check: rule headings inside a code fence are not counted', t => {
  const fenced = Array.from({ length: 20 }, () => '### not a rule').join('\n');
  const result = check(project(t, { ...DOCS, 'standards/global/error-handling.md': `## Error Handling\n\n### One rule\n\`\`\`md\n${fenced}\n\`\`\`\n` }));
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: a document with no heading at all is indexed by its path', t => {
  const index = `${INDEX}\n## Other documents\n\n### notes (\`notes.md\`)\nLoose working notes. Open when picking up unfinished work.\n`;
  const result = check(project(t, { ...DOCS, 'INDEX.md': index, 'notes.md': 'just some text, no heading\n' }));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: an imported file with odd formatting is indexed like any other', t => {
  const imported = '﻿---\r\ntitle: Imported\r\n---\r\nRunbook\r\n=======\r\n\r\n<div>html</div>\r\n';
  const index = [
    `${INDEX}`,
    '## Other documents',
    '',
    '### Runbook (`ops/Runbook Copy.MD`)',
    'How to recover the service. Open when something is down.',
    '',
  ].join('\r\n');
  const result = check(project(t, { ...DOCS, 'INDEX.md': `﻿${index}`, 'ops/Runbook Copy.MD': imported }));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.report.files, 3);
  assert.deepEqual(result.report.warnings, []);
});

test('docs-check: the older index shape — four-hash entries, full paths, closing hashes — is read as it is', t => {
  const index = [
    '# Documentation Index',
    '',
    '## Technical Standards',
    '',
    '### Global Standards',
    '',
    'Located in `.maister/docs/standards/global/`',
    '',
    '#### Error Handling (`.maister/docs/standards/global/error-handling.md`) ##',
    'Errors.',
    '',
    '---',
    '',
    '## Project Documentation',
    '',
    '### Vision (`project/vision.md`)',
    'Vision.',
    '',
    '```markdown',
    '### Example (`project/missing.md`)',
    '```',
  ].join('\n');
  const result = check(project(t, { ...DOCS, 'INDEX.md': index }));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.report.entries, 2);
});

test('docs-check: hidden directories and the index itself are not documents', t => {
  const result = check(project(t, { ...DOCS, '.drafts/wip.md': '# WIP\n', 'notes.txt': 'not markdown' }));
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.report.files, 2);
});

test('docs-check: a project with no documentation directory is skipped, not failed', t => {
  const where = project(t);
  const result = check(where);
  assert.equal(result.code, 0);
  assert.equal(result.report.skipped, 'no documentation directory');
});

test('docs-check: --docs names the directory; a usage error exits 2 with no report', t => {
  const where = project(t, DOCS);
  const elsewhere = check({ root: os.tmpdir() }, [`--docs=${where.docs}`]);
  assert.equal(elsewhere.code, 0, elsewhere.stderr);
  assert.equal(elsewhere.report.docs, where.docs);

  const unknown = check(where, ['--root=.']);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.report, null);
  assert.match(unknown.stderr, /unknown flag --root/);

  const bare = check(where, ['--docs']);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /needs a value/);
});

test('docs-check: the plugin\'s bundled documentation passes clean', () => {
  const result = run(CHECK, [`--docs=${BUNDLED}`]);
  assert.equal(result.code, 0, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.warnings, []);
});
