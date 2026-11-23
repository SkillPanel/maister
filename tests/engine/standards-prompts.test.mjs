import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The prompts that name the standards index read it only when the session
// does not already hold it, and the implementer and quick-bugfix carry two
// guard lines at the steps where those failures happen. A prompt edited back
// to the old wording, or a new prompt that reads the index unconditionally,
// fails here.

const PLUGIN = path.join(ROOT, 'plugins/maister');

// Whitespace runs fold to one space and bold markers go, so a hard-wrapped or
// emphasised sentence still matches.
const fold = text => text.replace(/\*\*/g, '').replace(/\s+/g, ' ');
const read = rel => fold(fs.readFileSync(path.join(PLUGIN, rel), 'utf8'));

// The text from the first `from` marker to the next `to` marker after it.
function slice(text, from, to, label) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `${label}: "${from}" is present`);
  const end = text.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `${label}: "${to}" follows "${from}"`);
  return text.slice(start, end);
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const P = 'only if it is not already in your context';
const G1 = 'Fix the code, not the test. When a test or check fails, fix the code under test: weakening an assertion, skipping or deleting a test, silencing a check or special-casing the test\'s inputs is not a fix. If the test itself is wrong, say why and change it as its own named step.';
const G2 = 'Change only what the task needs. No renames, reformatting, refactors or improvements to neighbouring code, and no tests, docs or files the task did not call for.';
const A4S = 'The recorded paths never include `INDEX.md` itself or any file under `standards/`: those reach every delegate through the index.';

const IMPLEMENTER = 'agents/task-group-implementer.md';
const BUGFIX = 'skills/quick-bugfix/SKILL.md';
const INIT = 'skills/init/SKILL.md';
const DOCS_MANAGER = 'skills/docs-manager/SKILL.md';
const GUIDES = ['development', 'performance', 'migration', 'research'].map(n => `skills/workflow-engine/workflows/${n}.md`);

// The prompts that write or maintain the standards, not read them for a task.
const EXEMPT = [
  'skills/docs-manager/',
  'skills/standards-update/',
  'skills/standards-discover/',
  'skills/init/',
  'agents/docs-operator.md',
];

const READ_SITES = [
  IMPLEMENTER,
  'agents/code-risk-review.md',
  'skills/orchestrator-framework/references/standards-compliance-checklist.md',
  BUGFIX,
  'skills/quick-design/SKILL.md',
  'agents/task-classifier.md',
  'agents/research-planner.md',
  'agents/specification-creator.md',
  'agents/implementation-planner.md',
  'agents/ascii-mockup-generator.md',
  'skills/orchestrator-framework/SKILL.md',
];

test('standards prompts: no consumer prompt reads the standards index unconditionally', () => {
  const READ_INDEX = /\b(?:read|check|consult|reference|scan)\s+`?(?:\.maister\/docs\/)?INDEX\.md`?/gi;
  const files = markdownFiles(PLUGIN)
    .map(f => path.relative(PLUGIN, f).split(path.sep).join('/'))
    .filter(rel => !EXEMPT.some(e => rel === e || (e.endsWith('/') && rel.startsWith(e))));
  assert.ok(files.length > 20, 'the scan covers the plugin');
  for (const rel of files) {
    const text = read(rel);
    for (const m of text.matchAll(READ_INDEX)) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 1 + P.length);
      assert.equal(after, ` ${P}`, `${rel}: "${m[0]}" is not followed by "${P}"`);
    }
  }
  for (const rel of READ_SITES) {
    assert.ok(read(rel).includes(P), `${rel} carries "${P}"`);
  }
});

test('standards prompts: the implementer and quick-bugfix carry both guard lines at the steps where the failures happen', () => {
  const impl = read(IMPLEMENTER);
  assert.ok(slice(impl, '### Phase 4', '### Phase 5', 'implementer').includes(G1), 'implementer Phase 4 carries G1');
  assert.ok(slice(impl, '### Test Failures', '### Implementation Errors', 'implementer').includes(G1), 'implementer Test Failures carries G1');
  assert.ok(slice(impl, '### Phase 5', '## Output Format', 'implementer').includes(G2), 'implementer Phase 5 carries G2');

  const fix = slice(read(BUGFIX), '### Step 6', '### Step 7', 'quick-bugfix');
  assert.ok(fix.includes(G1), 'quick-bugfix Step 6 carries G1');
  assert.ok(fix.includes(G2), 'quick-bugfix Step 6 carries G2');
});

test('standards prompts: init and docs-manager write no placeholder section, and a refresh drops an old one', () => {
  assert.doesNotMatch(read(INIT), /placeholder/i, 'init writes no placeholder');

  const dm = read(DOCS_MANAGER);
  const initialize = slice(dm, '### 1. Initialize', '### 2. Refresh', 'docs-manager');
  assert.doesNotMatch(initialize, /placeholder\s+section|Not\s+initialized/i, 'Initialize writes no placeholder section');

  const refresh = slice(dm, '### 2. Refresh', '### 3.', 'docs-manager');
  assert.match(refresh, /the\s+placeholder\s+an\s+earlier\s+Initialize\s+wrote\s+for\s+a\s+skipped\s+category/);
  assert.ok(refresh.includes('Not initialized'), 'Refresh names "Not initialized"');
});

test('standards prompts: init gives the docs operator the bundled standards path, and every intake keeps standards out of the doc paths', () => {
  const init = read(INIT);
  assert.ok(init.includes('`[standards path]` is `<plugin root>/skills/docs-manager/docs/standards/`'), 'init defines [standards path]');
  assert.ok(init.includes('Standards source path: [standards path].'), 'init passes the standards source path');
  assert.doesNotMatch(init, /instead of built-in defaults/);

  for (const rel of GUIDES) {
    assert.ok(read(rel).includes(A4S), `${rel} carries the intake exclusion sentence`);
  }
  const intake = slice(read(GUIDES[0]), '## `intake`', '## `codebase-analysis`', 'development.md');
  assert.ok(intake.includes(A4S), 'development.md carries it inside intake');
});

test('standards prompts: the plan template and its checklist name standards files per group, never a folder', () => {
  const planner = read('agents/implementation-planner.md');
  assert.ok(planner.includes('`.maister/docs/standards/[area]/[file].md` ([topic])'), 'the per-group template names a file');
  assert.match(planner, /files, never a folder; "none matched" when no entry does/, 'the template line says files, never a folder');
  assert.match(planner, /Standards Compliance names files for every group, never a folder/, 'the checklist says files, never a folder');
});

test('standards prompts: init\'s summary names each deselected recommended category with its discover command', () => {
  const init = read(INIT);
  assert.match(init, /Store the selection for Phase 5, and the categories the defaults recommended for Phase 7's summary\./, 'Phase 4 keeps the recommended set');
  const summary = slice(init, 'Standards not copied:', 'Project config:', 'init');
  assert.ok(summary.includes('each category Phase 4 recommended that the person deselected, one line each with the command that adds it later, `/maister:standards-discover --scope=<category>`'), 'the summary names each deselected category with its command');
  assert.ok(summary.includes('a category Phase 4 never recommended is not named'), 'a category never recommended is not named');
  assert.ok(summary.includes('the line is left out when every recommended category was kept'), 'the line is left out when nothing was deselected');
});

test('standards prompts: docs-manager Refresh removes the placeholder and keeps every other entry', () => {
  const refresh = slice(read(DOCS_MANAGER), '### 2. Refresh', '### 3.', 'docs-manager');
  assert.ok(refresh.includes('Keep everything else byte for byte'), 'Refresh keeps every other entry byte for byte');
  assert.ok(refresh.includes('is removed, with its heading when no entry sits under it'), 'the placeholder goes with its heading only when no entry sits under it');
});
