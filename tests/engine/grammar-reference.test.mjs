import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT } from '../helpers.mjs';

// The shipped grammar reference against the validator's own vocabularies.
// Each closed vocabulary in `references/grammar.md` is one table preceded by
// a `<!-- vocabulary: NAME -->` marker, and its first column is the key in
// backticks. The table must list exactly what the constant holds: every key
// the code accepts is documented, and nothing documented as valid is missing
// from the code.
//
// The constants are module-private, so they are read out of the source text
// rather than imported. A constant this test cannot find fails the test: a
// rename must not turn the check into a pass.

const REFERENCE = path.join(ENGINE_DIR, 'references/grammar.md');
const SOURCES = {
  graph: path.join(ENGINE_DIR, 'scripts/lib/graph.mjs'),
  display: path.join(ENGINE_DIR, 'scripts/lib/display.mjs'),
};

// Array constants, by the module that owns them.
const ARRAYS = {
  graph: [
    'DEFINITION_KEYS', 'NODE_KEYS', 'OVERLAY_KEYS', 'PROFILE_KEYS', 'DISPLAY_KEYS', 'OPTION_KEYS',
    'ADDED_NODE_KEYS', 'OUTPUT_KINDS', 'SCHEMES', 'TUNABLE', 'ON_VALUES', 'INPUT_TYPES', 'INPUT_KEYS',
    'RESERVED_PATHS', 'RESOLUTION_ORDER',
  ],
  display: ['ICON_HINTS'],
};

// Object constants whose keys are the vocabulary: keys the grammar retired.
const OBJECT_KEYS = { graph: ['RETIRED_NODE_KEYS', 'RETIRED_OPTION_KEYS'] };

function arrayConstant(source, name) {
  const match = new RegExp(`(?:export )?const ${name} = \\[([^\\]]*)\\];`).exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((each) => each[1]);
}

function objectKeys(source, name) {
  const match = new RegExp(`(?:export )?const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((each) => each[1]);
}

/** Every constant the reference is held to, `null` where the source does not carry it. */
function vocabularies() {
  const found = new Map();
  for (const [module, names] of Object.entries(ARRAYS)) {
    const source = fs.readFileSync(SOURCES[module], 'utf8');
    for (const name of names) found.set(name, arrayConstant(source, name));
  }
  for (const [module, names] of Object.entries(OBJECT_KEYS)) {
    const source = fs.readFileSync(SOURCES[module], 'utf8');
    for (const name of names) found.set(name, objectKeys(source, name));
  }
  return found;
}

/**
 * Each marker in the reference, with the first-column keys of the table that
 * follows it. A marker may name several constants; its table is their union.
 */
function markedTables(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  lines.forEach((line, index) => {
    const marker = /^<!-- vocabulary: ([A-Z_ ]+) -->$/.exec(line.trim());
    if (!marker) return;
    let at = index + 1;
    while (at < lines.length && lines[at].trim() === '') at++;
    const rows = [];
    while (at < lines.length && lines[at].trim().startsWith('|')) rows.push(lines[at++].trim());
    const keys = rows.slice(2).map((row) => {
      const cell = row.split('|')[1] ?? '';
      const key = /`([^`]+)`/.exec(cell);
      return key ? key[1] : null;
    });
    tables.push({ names: marker[1].trim().split(/\s+/), line: index + 1, rows: rows.length, keys });
  });
  return tables;
}

const REFERENCE_TEXT = fs.readFileSync(REFERENCE, 'utf8');
const CODE = vocabularies();
const TABLES = markedTables(REFERENCE_TEXT);

test('every vocabulary the test reads is found in the source', () => {
  for (const [name, values] of CODE) {
    assert.ok(values !== null,
      `${name} is not declared in the engine source; if it was renamed, rename it here and in the reference's marker`);
    assert.ok(values.length > 0, `${name} was found but read as empty`);
  }
});

test('every vocabulary has exactly one marked table, and every marker names one', () => {
  const marked = TABLES.flatMap((table) => table.names);
  for (const name of CODE.keys()) {
    assert.equal(marked.filter((each) => each === name).length, 1,
      `grammar.md must carry exactly one <!-- vocabulary: ${name} --> table`);
  }
  for (const name of marked) {
    assert.ok(CODE.has(name), `grammar.md marks a table as ${name}, which this test does not know`);
  }
});

test('each marked table is a table whose rows all name a key', () => {
  for (const table of TABLES) {
    const label = `the ${table.names.join(' + ')} table at grammar.md:${table.line}`;
    assert.ok(table.rows >= 3, `${label} has no rows`);
    assert.ok(table.keys.every((key) => key !== null), `${label} has a row with no key in backticks`);
  }
});

test('each marked table lists exactly the keys the code accepts', () => {
  for (const table of TABLES) {
    const code = new Set(table.names.flatMap((name) => CODE.get(name) ?? []));
    const documented = new Set(table.keys);
    const label = table.names.join(' + ');

    const undocumented = [...code].filter((key) => !documented.has(key));
    assert.deepEqual(undocumented, [], `${label} accepts keys grammar.md does not document`);

    const invented = [...documented].filter((key) => !code.has(key));
    assert.deepEqual(invented, [], `grammar.md documents ${label} keys the code does not accept`);

    assert.equal(table.keys.length, documented.size, `grammar.md lists a ${label} key twice`);
  }
});

test('the reference is linked from the engine skill and from the extending guide', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
  assert.ok(/\]\(references\/grammar\.md\)/.test(skill), 'the engine SKILL.md links references/grammar.md');
  const extending = fs.readFileSync(path.join(ROOT, 'docs/extending.md'), 'utf8');
  assert.ok(/\]\(\.\.\/plugins\/maister\/skills\/workflow-engine\/references\/grammar\.md\)/.test(extending),
    'docs/extending.md links the shipped grammar reference');
});
