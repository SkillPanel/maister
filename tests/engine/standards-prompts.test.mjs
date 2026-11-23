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

test('standards prompts: init\'s "Choose individually" offers "None of these" and takes an empty selection as an answer', () => {
  const init = read(INIT);
  const phase = slice(init, '"Choose individually": offers every group', 'Nothing is written in this phase.', 'init');
  assert.ok(phase.includes('The first question of the first page also offers "None of these", described as no group beyond global and testing'), 'the first page offers None of these');
  assert.ok(phase.includes('An empty selection is an answer: every question left blank, or "None of these", means no group beyond global and testing.'), 'an empty selection is global and testing only');
  assert.ok(phase.includes('never ask again in prose'), 'an empty selection is never asked again in prose');
  assert.ok(phase.includes('`const` `none` and `title` "None of these"'), 'the plain picker carries the option too');
});

test('standards prompts: init\'s update path asks the built-in review offer in a call of its own, after the survey\'s answer', () => {
  const init = read(INIT);
  const offer = slice(init, 'The built-in standards. When', 'Step 3 — Apply only what was chosen.', 'init');
  assert.ok(offer.includes('the offer is an AskUserQuestion call of its own, made after the survey\'s answer and its pages have come back'), 'the offer is its own call, after the answer');
  assert.ok(offer.includes('never a question in the survey\'s call or on one of its pages'), 'the offer is never merged into the survey');
});

test('standards prompts: init\'s summary names each recommended group that was not copied with its discover command', () => {
  const init = read(INIT);
  assert.ok(init.includes('Store the selection for Phase 5, and the groups the resolver recommended for Phase 7\'s summary.'), 'Phase 4 keeps the recommended set');
  const summary = slice(init, 'Standards not copied:', 'Project config:', 'init');
  assert.ok(summary.includes('each group Phase 4 recommended that was not copied'), 'the summary names each recommended group not copied');
  assert.ok(summary.includes('deselected, or not held by the referenced project'), 'the summary says why a group was not copied');
  assert.ok(summary.includes('one line each with the command that adds it later, `/maister:standards-discover --scope=<group>`'), 'each line carries the discover command');
  assert.ok(summary.includes('a group Phase 4 never recommended is not named'), 'a group never recommended is not named');
  assert.ok(summary.includes('the line is left out when every recommended group was copied'), 'the line is left out when every recommended group was copied');
});

// Every reader of the standards groups asks the resolver, never a list of
// its own: each site below names the resolver call. A reader added later
// adds its row here.
const RESOLVER = 'skills/docs-manager/scripts/standards.mjs groups';
const RESOLVER_READERS = [
  { rel: INIT, from: '## PHASE 4', to: '## PHASE 5', label: 'init Phase 4' },
  { rel: INIT, from: 'Step 1 — Survey', to: 'Step 2 — One decision', label: 'init update survey' },
  { rel: INIT, from: 'Step 1 — Survey', to: 'Step 2 — One decision', call: 'skills/docs-manager/scripts/standards.mjs built-in candidates', label: 'init update survey, built-in candidates' },
  { rel: 'skills/standards-discover/SKILL.md', label: 'standards-discover' },
  { rel: 'skills/standards-update/SKILL.md', from: '## Mode: Built-in Standards', to: '## Mode: Conversation', call: 'skills/docs-manager/scripts/standards.mjs built-in candidates', label: 'standards-update built-in mode' },
];

test('standards prompts: every reader of the standards groups runs the resolver', () => {
  for (const { rel, from, to, label, call = RESOLVER } of RESOLVER_READERS) {
    const text = from ? slice(read(rel), from, to, label) : read(rel);
    assert.ok(text.includes(call), `${label} names \`${call}\``);
  }
});

test('standards prompts: docs-manager Refresh removes the placeholder and keeps every other entry', () => {
  const refresh = slice(read(DOCS_MANAGER), '### 2. Refresh', '### 3.', 'docs-manager');
  assert.ok(refresh.includes('Keep everything else byte for byte'), 'Refresh keeps every other entry byte for byte');
  assert.ok(refresh.includes('is removed, with its heading when no entry sits under it'), 'the placeholder goes with its heading only when no entry sits under it');
});

test('standards prompts: docs-manager Initialize copies each selected folder by name, with no copy-all fallback', () => {
  const initialize = slice(read(DOCS_MANAGER), '### 1. Initialize', '### 2. Refresh', 'docs-manager');
  assert.ok(initialize.includes('by name'), 'Initialize copies by name');
  assert.ok(initialize.includes('docs/standards-groups.json'), 'Initialize names the group table');
  assert.doesNotMatch(initialize, /Copy ALL/, 'Initialize has no copy-all fallback');
  assert.doesNotMatch(initialize, /backward compatible/, 'Initialize has no backward-compatible clause');
});

// The guards' key phrases, folded the way the spec says (lowercase, no bold
// markers, no double quotes, no backticks, one space between words), must
// appear in the prompt steps and in the bundled standard that states the rule.
const foldPhrases = text => text.toLowerCase().replace(/\*\*|["\u201c\u201d`]/g, '').replace(/\s+/g, ' ');
const G1_PHRASES = [
  'fix the code, not the test',
  'fix the code under test',
  'weakening an assertion, skipping or deleting a test',
  'silencing a check',
  'special-casing the test\'s inputs is not a fix',
  'if the test itself is wrong, say why',
  'change it as its own named step',
];
const G2_PHRASES = [
  'change only what the task needs',
  'no renames, reformatting, refactors or improvements to neighbouring code',
  'no tests, docs or files the task did not call for',
];

function standardSection(rel, heading) {
  const raw = fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
  const start = raw.indexOf(heading);
  assert.notEqual(start, -1, `${rel}: "${heading}" is present`);
  const next = raw.indexOf('###', start + heading.length);
  return foldPhrases(raw.slice(start, next === -1 ? undefined : next));
}

test('standards prompts: each guard\'s key phrases appear in both prompt steps and in the bundled standard', () => {
  const impl = foldPhrases(fs.readFileSync(path.join(PLUGIN, IMPLEMENTER), 'utf8'));
  const fix = slice(foldPhrases(fs.readFileSync(path.join(PLUGIN, BUGFIX), 'utf8')), '### step 6', '### step 7', 'quick-bugfix');
  const g1 = [
    ['implementer Phase 4', slice(impl, '### phase 4', '### phase 5', 'implementer')],
    ['implementer Test Failures', slice(impl, '### test failures', '### implementation errors', 'implementer')],
    ['quick-bugfix Step 6', fix],
    ['test-writing.md', standardSection('skills/docs-manager/docs/standards/testing/test-writing.md', '### Fix the Code, Not the Test')],
  ];
  const g2 = [
    ['implementer Phase 5', slice(impl, '### phase 5', '## output format', 'implementer')],
    ['quick-bugfix Step 6', fix],
    ['minimal-implementation.md', standardSection('skills/docs-manager/docs/standards/global/minimal-implementation.md', '### Change Only What the Task Needs')],
  ];
  for (const [where, text] of g1) for (const phrase of G1_PHRASES) assert.ok(text.includes(phrase), `${where} carries "${phrase}"`);
  for (const [where, text] of g2) for (const phrase of G2_PHRASES) assert.ok(text.includes(phrase), `${where} carries "${phrase}"`);
});

test('standards prompts: docs-manager no longer resets to the baseline', () => {
  const dm = read(DOCS_MANAGER);
  assert.ok(!dm.includes('Use Plugin Documentation as Reference'), 'the reference operation is gone');
  assert.ok(!dm.includes('Reset everything to the baseline'), 'the reset choice is gone');
});

test('standards prompts: docs-manager Update applies built-in section edits and names the map as data', () => {
  const dm = read(DOCS_MANAGER);
  const update = slice(dm, '### 4. Update', '### 5.', 'docs-manager');
  for (const phrase of ['add, replace, remove or move', 'is deleted', 'title line']) {
    assert.ok(update.includes(phrase), `Update carries "${phrase}"`);
  }
  assert.ok(dm.includes('docs/standards-map.json'), 'docs-manager names the map');
});

test('standards prompts: standards-update built-in mode carries its options and its promises', () => {
  const su = read('skills/standards-update/SKILL.md');
  const mode = slice(su, '## Mode: Built-in Standards', '## Mode: Conversation', 'standards-update');
  for (const phrase of ['Apply all', '(Recommended)', 'Go through them', 'Keep ours', 'Take the new rule', 'Remove it', 'More details', 'never recommended', 'Phase 1 Step 4 is not asked', 'Nothing is recorded']) {
    assert.ok(mode.includes(phrase), `the built-in mode carries "${phrase}"`);
  }
  const hint = fs.readFileSync(path.join(PLUGIN, 'skills/standards-update/SKILL.md'), 'utf8').match(/^argument-hint:.*$/m);
  assert.ok(hint && hint[0].includes('--built-in'), 'the argument hint carries --built-in');
});

test('standards prompts: standards-update no longer copies the plugin baseline and points at the built-in mode', () => {
  const su = read('skills/standards-update/SKILL.md');
  assert.ok(!su.includes('Optionally show plugin baseline'), 'the baseline offer is gone');
  const creating = slice(su, '### If creating', '## PHASE 4', 'standards-update');
  assert.ok(creating.includes('--built-in`'), 'If creating points at the --built-in mode');
});

test('standards prompts: init counts the built-in changes, writes no standard and hands the review off through the Skill tool', () => {
  const init = read(INIT);
  for (const phrase of ['invoke the `standards-update` skill via the Skill tool with `--built-in', 'Nothing is written under `standards/`.', 'Init writes no standard.']) {
    assert.ok(init.includes(phrase), `init carries "${phrase}"`);
  }
  assert.ok(!init.includes('Standards are never touched'), 'the old never-touched rule is gone');
  assert.ok(slice(init, 'Step 2 — One decision', 'Step 3 — Apply only what was chosen', 'init').includes('Review them (Recommended)'), 'Step 2 offers the review');
});
