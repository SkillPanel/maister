import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from '../helpers.mjs';

// The framework patterns file is a stub: the gate rule (§ 2, § 2.1, § 2.2) and
// the artifact summary contract (§ 7), with an index saying where every other
// section went. A pointer into a section it no longer holds sends a reader to
// nothing, so every pointer that names the framework is held to what the stub
// keeps, every place the index names is held to exist, and the stub is held to
// its four sections.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const ENGINE = path.join(PLUGIN, 'skills/workflow-engine');
const STUB_PATH = 'plugins/maister/skills/orchestrator-framework/references/orchestrator-patterns.md';
const STUB = path.join(ROOT, STUB_PATH);
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** The sections a pointer may name by number. */
const KEPT_NUMBERS = new Set(['2', '2.1', '2.2', '7']);

const FILE_FOR = 'orchestrator' + '-patterns.md';
const ANY_FILE = /`?[\w./<>-]+\.(?:md|mjs|yml|json)`?/g;

function stubText() {
  return fs.readFileSync(STUB, 'utf8').replace(/\r\n?/g, '\n');
}

/** The stub's `##` and `###` headings outside code fences, as written. */
function stubHeadings() {
  const out = [];
  let fence = null;
  for (const line of stubText().split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) out.push(heading[2]);
  }
  return out;
}

/** A heading's text without its leading section number. */
function bare(heading) {
  return heading.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
}

/** Every tracked text file but the stub and this test, with its lines. */
function trackedFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  return listed
    .filter(file => file !== STUB_PATH && file !== SELF)
    .filter(file => /\.(?:md|mjs|js|json|yml|yaml|sh|txt)$/.test(file))
    .filter(file => fs.existsSync(path.join(ROOT, file)))
    .map(file => ({ file, lines: fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/) }));
}

/** The section numbers a line names for the framework file, from the file's name up to the next file named. */
function numbersAfterName(line) {
  const out = [];
  let at = line.indexOf(FILE_FOR);
  while (at !== -1) {
    const rest = line.slice(at + FILE_FOR.length);
    ANY_FILE.lastIndex = 0;
    const next = ANY_FILE.exec(rest);
    const span = next ? rest.slice(0, next.index) : rest;
    for (const match of span.matchAll(/§ (\d+(?:\.\d+)*)/g)) out.push(match[1]);
    at = line.indexOf(FILE_FOR, at + FILE_FOR.length);
  }
  return out;
}

test('every pointer that names the framework names a section the stub keeps', () => {
  const kept = new Set(stubHeadings().map(bare));
  const dead = [];
  for (const { file, lines } of trackedFiles()) {
    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      for (const number of numbersAfterName(line)) {
        if (!KEPT_NUMBERS.has(number)) dead.push(`${where}: ${FILE_FOR} § ${number}`);
      }
      for (const match of line.matchAll(/framework § (\d+(?:\.\d+)*)/g)) {
        if (!KEPT_NUMBERS.has(match[1])) dead.push(`${where}: framework § ${match[1]}`);
      }
      for (const match of line.matchAll(/framework(?: §|'s) \*([^*]+)\*/g)) {
        if (!kept.has(bare(match[1]))) dead.push(`${where}: framework *${match[1]}*`);
      }
    });
  }
  assert.deepEqual(dead, [], 'pointers into a framework section the stub no longer holds');
});

/** The index's lines: from its bold title to the first heading after it. */
function indexLines() {
  const text = stubText();
  const start = text.indexOf('**Where the other sections went**');
  assert.notEqual(start, -1, 'the stub has its index');
  const end = text.indexOf('\n## ', start);
  return text.slice(start, end === -1 ? undefined : end).split('\n').filter(line => line.startsWith('- '));
}

/** The absolute path of a file the index names: the engine's unless it names another. */
function indexTarget(name) {
  if (name === 'SKILL.md') return path.join(ENGINE, 'SKILL.md');
  if (name.startsWith('agents/')) return path.join(PLUGIN, name);
  if (name.startsWith('references/')) return path.join(ENGINE, name);
  return path.join(PLUGIN, name);
}

test('every section the stub\'s index names exists in the file it names', () => {
  const lines = indexLines();
  assert.equal(lines.length, 8, 'the index has an entry for each of the eight sections that went');
  assert.ok(lines.find(line => line.startsWith('- **§ 10 ')).includes('`references/writing-state.md` § *Ending the run — the wrap-up* (missing files go under **Needs you**)'), 'the § 10 entry sends the Needs-you rule to the wrap-up');
  const missing = [];
  let checked = 0;
  for (const line of lines) {
    let current = null;
    const tokens = line.matchAll(/`([\w./-]+\.md)`|§ \*([^*]+)\*|§ (\d+(?:\.\d+)+)/g);
    for (const token of tokens) {
      if (token[1]) {
        current = indexTarget(token[1]);
        continue;
      }
      assert.ok(current, `a section is named before any file on: ${line}`);
      const text = fs.readFileSync(current, 'utf8').replace(/\r\n?/g, '\n');
      const headings = text.split('\n').filter(each => /^#{1,6} /.test(each)).map(each => each.replace(/^#{1,6} /, ''));
      const wanted = token[2] ?? token[3];
      const found = token[2]
        ? headings.some(heading => heading === wanted || bare(heading) === wanted)
        : headings.some(heading => heading.startsWith(`${wanted} `));
      if (!found) missing.push(`${path.relative(ROOT, current)} § ${wanted}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 15, `the index names its sections (${checked} checked)`);
  assert.deepEqual(missing, [], 'sections the index names that their file does not hold');
});

test('the stub holds only its title, the gate rule and the summary contract', () => {
  assert.deepEqual(stubHeadings(), [
    '2. Phase Gate Behavior',
    '2.1 Resolving session-reminder conflicts (decide ONCE, do not re-litigate at each gate)',
    '2.2 In-node questions under a non-terminal driver',
    '7. Artifact Summary Contract',
  ]);
  const titles = stubText().split('\n').filter(line => /^# /.test(line));
  assert.deepEqual(titles, ['# Orchestrator Patterns']);
});
