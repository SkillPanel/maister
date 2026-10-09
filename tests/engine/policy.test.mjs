import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES } from '../helpers.mjs';
import { DEFAULT_POLICY, loadPolicy, policyHash, triageFor } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';

// The autonomy policy module: the loader that falls back to the built-in
// `{"version": 1}`, the canonical hash a run records, and the raise-only
// triage reading. Every policy here is made up; floor ids are opaque strings.

const POLICIES = path.join(FIXTURES, 'policy');
const DEFAULT_HASH = 'sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8';
const fixture = name => path.join(POLICIES, name);
const valid = () => JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));

test('the built-in default hashes to its pinned value', () => {
  assert.equal(policyHash({ version: 1 }), DEFAULT_HASH);
  assert.equal(policyHash(DEFAULT_POLICY), DEFAULT_HASH);
});

test('the hash ignores key order at every depth and keeps array order', () => {
  const one = { version: 1, families: { b: { class: 'decide-alone', floor: ['floor-a', 'floor-b'] }, a: { class: 'record' } } };
  const two = { families: { a: { class: 'record' }, b: { floor: ['floor-a', 'floor-b'], class: 'decide-alone' } }, version: 1 };
  assert.equal(policyHash(one), policyHash(two));
  const reordered = { version: 1, families: { a: { class: 'record' }, b: { class: 'decide-alone', floor: ['floor-b', 'floor-a'] } } };
  assert.notEqual(policyHash(one), policyHash(reordered));
  assert.match(policyHash(one), /^sha256:[0-9a-f]{64}$/);
});

test('the hash covers the whole parsed file, unknown keys included', () => {
  const loaded = loadPolicy({ path: fixture('valid.json') });
  const parsed = valid();
  assert.equal(loaded.hash, policyHash(parsed));
  const { note, ...withoutNote } = parsed;
  assert.ok(note);
  assert.notEqual(policyHash(withoutNote), loaded.hash);
});

test('a valid policy loads with no warnings, unknown keys ignored and floor ids opaque', () => {
  const file = fixture('valid.json');
  const loaded = loadPolicy({ path: file });
  assert.deepEqual(loaded.warnings, []);
  assert.equal(loaded.source, file);
  assert.deepEqual(loaded.policy, valid());
  assert.notEqual(loaded.hash, DEFAULT_HASH);
  // Floor ids are taken as written: any non-empty string, checked against no list.
  const odd = {
    version: 1,
    floor: { 'any opaque id': { description: 'Opaque.' }, x: { description: 'Opaque.' } },
    families: { 'example-family': { class: 'decide-alone', floor: ['any opaque id', 'not in the floor map'], description: 'Opaque ids.' } },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'));
  const oddFile = path.join(dir, 'odd.json');
  fs.writeFileSync(oddFile, JSON.stringify(odd));
  assert.deepEqual(loadPolicy({ path: oddFile }).warnings, []);
});

test('a refused file falls back to the default, warns with its reason and records the default hash', () => {
  const cases = {
    'version-2.json': 'version',
    'malformed.json': 'not-json',
    'root-not-object.json': 'wrong-type at (root)',
    'missing-key.json': 'missing-key at families.example-family.class',
    'wrong-type.json': 'wrong-type at table',
    'too-short.json': 'too-short at floor.floor-a.description',
    'not-in-enum.json': 'not-in-enum at families.example-family.class',
    'bad-pattern.json': 'bad-pattern at table.0.workflow',
    'row-id.json': 'bad-pattern at table.0.id',
    'band-name.json': 'not-in-enum at bands.certain',
    'settles-approve.json': 'not-in-enum at ceilings.approve.settles',
    'delegates-type.json': 'wrong-type at ceilings.advice.delegates',
    'duplicate.json': 'duplicate at table.0.families.1',
    'too-few.json': 'too-few at table.0.families',
    'values-on-question.json': 'values-on-question at table.0.values',
    'unknown-family-undefined.json': 'unknown-family-undefined at unknown_family',
    'family-undefined.json': 'family-undefined at table.0.families.0',
    'value-family-undefined.json': 'family-undefined at table.0.values.enabled',
    'duplicate-row.json': 'duplicate-row at table.1',
    'ceiling-undefined.json': 'ceiling-undefined at default_ceiling',
  };
  for (const [name, reason] of Object.entries(cases)) {
    const file = fixture(name);
    const loaded = loadPolicy({ path: file });
    assert.deepEqual(loaded.warnings, [`policy-refused:${file}:${reason}`], name);
    assert.deepEqual(loaded.policy, { version: 1 }, name);
    assert.equal(loaded.hash, DEFAULT_HASH, name);
    assert.equal(loaded.source, 'built-in', name);
  }
  // A path that exists but cannot be read as a file.
  const loaded = loadPolicy({ path: POLICIES });
  assert.deepEqual(loaded.warnings, [`policy-refused:${POLICIES}:unreadable`]);
  assert.equal(loaded.hash, DEFAULT_HASH);
});

test('no file gives the built-in default silently', () => {
  const missing = path.join(os.tmpdir(), 'no-such-dir-for-policy', 'autonomy-policy.json');
  assert.deepEqual(loadPolicy({ path: missing }), { policy: { version: 1 }, hash: DEFAULT_HASH, source: 'built-in', warnings: [] });
  // The committed tree ships no file at the documented location.
  assert.equal(fs.existsSync(path.join(ENGINE_DIR, 'policy/autonomy-policy.json')), false);
  assert.deepEqual(loadPolicy(), { policy: { version: 1 }, hash: DEFAULT_HASH, source: 'built-in', warnings: [] });
  assert.deepEqual(loadPolicy({}).warnings, []);
});

test('triage only raises: floor, band once, unbounded by max, proposed family, unknown family, gate values', () => {
  const policy = valid();
  const at = extra => triageFor({ policy, workflow: 'sample', kind: 'gate', id: 'gate-row', ...extra });

  // The family's class is the start; nothing raised, nothing else written.
  assert.deepEqual(at({}), { version: 1, class: 'decide-alone', family: 'example-family' });

  // A floor id from the family gives approve, raised by the floor.
  assert.deepEqual(triageFor({ policy, workflow: 'sample', kind: 'gate', id: 'floored-gate' }),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' });

  // A found floor id gives approve too, and `max: record` does not bound it.
  assert.deepEqual(at({ floorIds: ['floor-z'] }),
    { version: 1, class: 'approve', floor: ['floor-z'], family: 'example-family', raised_by: 'floor' });

  // A band's without_evidence is applied once: clear → leaning, not on to toss-up.
  assert.deepEqual(at({ band: 'clear' }),
    { version: 1, class: 'consult', family: 'example-family', band: 'leaning', raised_by: 'band' });
  // With evidence the band is read as given; a band with no at_least raises nothing.
  assert.deepEqual(at({ band: 'clear', evidence: ['a test run'] }),
    { version: 1, class: 'decide-alone', family: 'example-family', band: 'clear' });
  // A band above the family's max still raises.
  assert.deepEqual(at({ band: 'toss-up' }),
    { version: 1, class: 'approve', family: 'example-family', band: 'toss-up', raised_by: 'band' });
  // The floor sets approve first, so a band reaching approve too leaves raised_by at floor.
  assert.equal(at({ band: 'toss-up', floorIds: ['floor-a'] }).raised_by, 'floor');

  // A proposed family counts only when the row lists it.
  assert.deepEqual(at({ family: 'careful-family' }), { version: 1, class: 'approve', family: 'careful-family' });
  assert.deepEqual(at({ family: 'guarded-family' }), { version: 1, class: 'decide-alone', family: 'example-family' });

  // No row: unknown_family when set, unclassified when not.
  assert.deepEqual(triageFor({ policy, workflow: 'sample', kind: 'gate', id: 'no-row' }),
    { version: 1, class: 'consult', family: 'fallback-family' });
  const { unknown_family, ...bare } = policy;
  assert.ok(unknown_family);
  assert.equal(triageFor({ policy: bare, workflow: 'sample', kind: 'gate', id: 'no-row' }), null);
  assert.equal(triageFor({ policy, workflow: 'other', kind: 'question', id: 'area-choice', declaredIds: ['area-choice'] }).family, 'fallback-family');

  // A gate value reads the row's values[key]; an unlisted key reads like a missing row.
  assert.deepEqual(triageFor({ policy, workflow: 'sample', kind: 'value', id: 'gate-row', key: 'enabled' }),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' });
  assert.deepEqual(triageFor({ policy, workflow: 'sample', kind: 'value', id: 'gate-row', key: 'other_key' }),
    { version: 1, class: 'consult', family: 'fallback-family' });
  assert.equal(triageFor({ policy: bare, workflow: 'sample', kind: 'value', id: 'gate-row', key: 'other_key' }), null);

  // The built-in default classifies nothing.
  assert.equal(triageFor({ policy: { version: 1 }, workflow: 'sample', kind: 'gate', id: 'gate-row' }), null);
  // Never advice or held.
  for (const triage of [at({}), at({ band: 'clear' }), at({ floorIds: ['floor-a'] })]) {
    assert.equal('advice' in triage, false);
    assert.equal('held' in triage, false);
  }
});

test('a question id the node does not declare resolves to the declared id it belongs to', () => {
  const policy = valid();
  const { unknown_family, ...bare } = policy;
  const ask = (id, declaredIds) => triageFor({ policy: bare, workflow: 'sample', kind: 'question', id, declaredIds });
  const expected = { version: 1, class: 'decide-alone', family: 'example-family' };
  assert.deepEqual(ask('area-choice', ['area-choice', 'other-question']), expected);
  // A per-area slug of a declared id.
  assert.deepEqual(ask('area-choice-storage', ['other-question', 'area-choice']), expected);
  // A node declaring one id: any undeclared slug it asks is that id.
  assert.deepEqual(ask('storage', ['area-choice']), expected);
  // Several declared ids and no prefix match: no row.
  assert.equal(ask('storage', ['area-choice', 'other-question']), null);
  // A gate row never answers for a question.
  assert.equal(ask('gate-row', ['gate-row']), null);
});
