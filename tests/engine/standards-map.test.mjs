import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The standards map: every rule the 2.2.x starter shipped, with what became of
// it, and every rule the bundled tree added. The tests pin its shape and check
// it against the 2.2.x fixture and the bundled standards.

const DOCS = path.join(ROOT, 'plugins/maister/skills/docs-manager/docs');
const MAP = JSON.parse(fs.readFileSync(path.join(DOCS, 'standards-map.json'), 'utf8'));
const TABLE = JSON.parse(fs.readFileSync(path.join(DOCS, 'standards-groups.json'), 'utf8'));
const BUNDLED = path.join(DOCS, 'standards');
const FIXTURE = path.join(ROOT, 'tests/fixtures/standards-2.2');

const slug = (h) =>
  h.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-').replace(/-+/g, '-');

/** The `###` sections of a file: heading and trimmed text; fences hide headings. */
function sections(text) {
  const out = [];
  let cur = null;
  let fence = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      if (line.startsWith(fence)) fence = null;
    } else if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3);
    } else if (/^(# |## |### )/.test(line)) {
      cur = null;
      if (line.startsWith('### ')) {
        cur = { heading: line.slice(4).replace(/\s+/g, ' ').trim(), lines: [line] };
        out.push(cur);
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').replace(/^\n+|\n+$/g, '') }));
}

const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const key = (h) => `${h.path}#${h.heading}`;

/** The bundled `###` rules in the group table's order, then file order, then section order. */
function bundledRules() {
  const out = [];
  for (const g of TABLE.groups) {
    for (const f of g.files) {
      for (const s of sections(read(BUNDLED, `${g.id}/${f}`))) out.push({ path: `${g.id}/${f}`, heading: s.heading });
    }
  }
  return out;
}

test('map shape: keys, counts, ids, fates and the order of the new rules', () => {
  assert.deepEqual(Object.keys(MAP), ['format', 'rules', 'new']);
  assert.equal(MAP.format, 1);
  assert.equal(MAP.rules.length, 113);
  assert.equal(MAP.new.length, 11);
  const ids = new Set();
  for (const r of MAP.rules) {
    assert.deepEqual(Object.keys(r), ['id', 'path', 'heading', 'shipped', 'fate', 'home'], r.id);
    assert.equal(r.id, `${r.path.replace(/\.md$/, '')}#${slug(r.heading)}`);
    assert(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert(['remove', 'rewrite', 'merge'].includes(r.fate), r.id);
    assert.equal(r.home === null, r.fate === 'remove', r.id);
    if (r.home) assert.deepEqual(Object.keys(r.home), ['path', 'heading'], r.id);
  }
  for (const n of MAP.new) assert.deepEqual(Object.keys(n), ['path', 'heading']);
  const order = bundledRules().map(key);
  const positions = MAP.new.map((n) => order.indexOf(key(n)));
  assert(positions.every((p) => p >= 0), 'a new rule is not in the bundled tree');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('map against the 2.2.x fixture and the bundled tree', () => {
  const fixtureKeys = new Set();
  let count = 0;
  for (const g of fs.readdirSync(FIXTURE)) {
    for (const f of fs.readdirSync(path.join(FIXTURE, g))) {
      for (const s of sections(read(FIXTURE, `${g}/${f}`))) {
        count += 1;
        fixtureKeys.add(`${g}/${f}#${s.heading}`);
      }
    }
  }
  assert.equal(count, 113);
  const ruleKeys = new Set(MAP.rules.map(key));
  for (const k of fixtureKeys) assert(ruleKeys.has(k), `not in the map: ${k}`);
  for (const r of MAP.rules) {
    assert(r.shipped.startsWith(`### ${r.heading}\n`), r.id);
    const s = sections(read(FIXTURE, r.path)).find((x) => x.heading === r.heading);
    assert(s, `not in the fixture: ${r.id}`);
    assert.equal(r.shipped, s.text, r.id);
  }

  const bundled = bundledRules();
  assert.equal(bundled.length, 58);
  const bundledKeys = new Set(bundled.map(key));
  const homes = new Map();
  for (const r of MAP.rules) {
    if (!r.home) continue;
    assert(bundledKeys.has(key(r.home)), `no such bundled rule: ${key(r.home)}`);
    homes.set(key(r.home), [...(homes.get(key(r.home)) ?? []), r]);
  }
  assert.equal(homes.size, 47);
  const newKeys = new Set(MAP.new.map(key));
  for (const k of newKeys) assert(!homes.has(k), `a new rule is a home: ${k}`);
  for (const b of bundled) assert.notEqual(homes.has(key(b)), newKeys.has(key(b)), key(b));
  for (const [k, rs] of homes) {
    if (rs.some((r) => r.fate === 'rewrite')) assert.equal(rs.length, 1, `rewrite home shared: ${k}`);
    else assert(rs.length >= 2, `merge home held by one rule: ${k}`);
  }
});
