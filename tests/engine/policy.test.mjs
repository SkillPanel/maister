import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES } from '../helpers.mjs';
import { DEFAULT_POLICY, familyChoice, loadPolicy, policyHash, questionFamilies, triageFor, triageUnder } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';

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
  // ... and, on a gate, only when it is at least as strict as the row's first: a gate is never
  // lowered, so a looser family the row lists is ignored, whatever reader verdict comes with it.
  const strictFirst = { ...policy, table: policy.table.map(row => (row.id === 'gate-row' ? { ...row, families: ['careful-family', 'example-family'] } : row)) };
  assert.deepEqual(triageFor({ policy: strictFirst, workflow: 'sample', kind: 'gate', id: 'gate-row', family: 'example-family' }),
    { version: 1, class: 'approve', family: 'careful-family' });
  assert.deepEqual(triageFor({ policy: strictFirst, workflow: 'sample', kind: 'gate', id: 'gate-row', family: 'example-family', reader: { verdict: 'agree', reason: 'No option changes the product.' } }),
    { version: 1, class: 'approve', family: 'careful-family' });

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

// The question rows below are built inline over the in-node fixture's families:
// quick (decide-alone), noted (record), asked (consult), signed (approve) and
// guarded (record with a floor id, so approve).
const questionPolicy = rows => {
  const base = JSON.parse(fs.readFileSync(fixture('questions.json'), 'utf8'));
  return { ...base, table: rows.map(([id, families, kind = 'question']) => ({ workflow: 'sample', id, kind, families })) };
};
const AGREE = { verdict: 'agree', reason: 'No option changes what the product does.' };
const RAISE = { verdict: 'raise', reason: 'One option changes who may publish.' };

test('a question is classed below its first family only with the reader\'s agreement', () => {
  const policy = questionPolicy([
    ['mixed-choice', ['noted-family', 'asked-family', 'quick-family']],
    ['floored-choice', ['guarded-family', 'quick-family']],
    ['short-choice', ['noted-family', 'asked-family']],
  ]);
  const ask = (id, extra = {}) => triageFor({ policy, workflow: 'sample', kind: 'question', id, declaredIds: [id], ...extra });
  const first = { version: 1, class: 'record', family: 'noted-family' };

  // Agreed: the lower family the row lists is applied.
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader: AGREE }), { version: 1, class: 'decide-alone', family: 'quick-family' });
  // Raised, or no verdict at all: the first family stands.
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader: RAISE }), first);
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family' }), first);
  // A floored first family is never lowered, agreed or not.
  assert.deepEqual(ask('floored-choice', { family: 'quick-family', reader: AGREE }),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' });
  // A family the row does not list is never applied.
  assert.deepEqual(ask('short-choice', { family: 'quick-family', reader: AGREE }), first);
  // No row: the unknown family, which a proposal never moves.
  assert.deepEqual(ask('no-such-choice', { family: 'quick-family', reader: AGREE }), { version: 1, class: 'consult', family: 'fallback-family' });
  // A question carrying a version-1 triage of its own keeps its first family; one of another version is ignored.
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader: AGREE, carried: { version: 1, class: 'record' } }), first);
  assert.equal(ask('mixed-choice', { family: 'quick-family', reader: AGREE, carried: { version: 2, class: 'record' } }).family, 'quick-family');

  // No proposal: exactly what it was before, a verdict or not.
  assert.deepEqual(ask('mixed-choice'), first);
  assert.deepEqual(ask('mixed-choice', { reader: AGREE }), first);

  // The floor, floor ids and the band still raise on top of a lowered family.
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader: AGREE, floorIds: ['floor-z'] }),
    { version: 1, class: 'approve', floor: ['floor-z'], family: 'quick-family', raised_by: 'floor' });
  assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader: AGREE, band: 'toss-up' }),
    { version: 1, class: 'approve', family: 'quick-family', band: 'toss-up', raised_by: 'band' });
});

test('a gate and a gate value ignore a reader verdict', () => {
  const policy = questionPolicy([['plain-gate', ['noted-family', 'quick-family'], 'gate']]);
  const gate = extra => triageFor({ policy, workflow: 'sample', kind: 'gate', id: 'plain-gate', ...extra });
  assert.deepEqual(gate({ family: 'quick-family', reader: AGREE }), { version: 1, class: 'record', family: 'noted-family' });
  assert.deepEqual(gate({ family: 'quick-family', reader: AGREE }), gate({ family: 'quick-family' }));
  // A stricter listed family is still taken on a gate, with no verdict needed.
  const stricter = questionPolicy([['plain-gate', ['noted-family', 'asked-family'], 'gate']]);
  assert.equal(triageFor({ policy: stricter, workflow: 'sample', kind: 'gate', id: 'plain-gate', family: 'asked-family' }).family, 'asked-family');
  // A value reads its gate row's values, a proposal and a verdict aside.
  const valued = { ...policy, table: policy.table.map(row => ({ ...row, values: { enabled: 'signed-family' } })) };
  assert.deepEqual(triageFor({ policy: valued, workflow: 'sample', kind: 'value', id: 'plain-gate', key: 'enabled', family: 'quick-family', reader: AGREE }),
    { version: 1, class: 'approve', family: 'signed-family' });
});

test('a family\'s strictness counts its own floor', () => {
  const policy = questionPolicy([
    ['floored-choice', ['guarded-family', 'asked-family']],
    ['open-choice', ['asked-family', 'guarded-family']],
  ]);
  const ask = (id, family) => triageFor({ policy, workflow: 'sample', kind: 'question', id, declaredIds: [id], family });
  // A floored first family reads as approve: consult with no floor is below it, so it is not taken.
  assert.deepEqual(ask('floored-choice', 'asked-family'),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' });
  // A floored family of lower bare class reads as approve, stricter than consult: taken with no verdict.
  assert.deepEqual(ask('open-choice', 'guarded-family'),
    { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' });
  // So a floored-first row offers no lower family; an unfloored one offers the floored family as stricter.
  assert.deepEqual(questionFamilies({ policy, workflow: 'sample', id: 'floored-choice', declaredIds: ['floored-choice'] }), [
    { name: 'guarded-family', description: 'Carries a floor id, so approved.' },
  ]);
  assert.deepEqual(questionFamilies({ policy, workflow: 'sample', id: 'open-choice', declaredIds: ['open-choice'] }), [
    { name: 'asked-family', description: 'Worth a second opinion.' },
    { name: 'guarded-family', description: 'Carries a floor id, so approved.' },
  ]);
});

test('the family rule names why a proposal was not taken', () => {
  const policy = questionPolicy([
    ['mixed-choice', ['noted-family', 'asked-family', 'quick-family']],
    ['floored-choice', ['guarded-family', 'quick-family']],
    ['plain-gate', ['noted-family', 'quick-family'], 'gate'],
  ]);
  const choose = (id, extra = {}) => familyChoice({ policy, workflow: 'sample', kind: 'question', id, declaredIds: [id], ...extra });

  assert.deepEqual(choose('mixed-choice'), { family: 'noted-family', reason: null, lower: false });
  assert.deepEqual(choose('mixed-choice', { proposed: 'asked-family' }), { family: 'asked-family', reason: null, lower: false });
  assert.deepEqual(choose('mixed-choice', { proposed: 'noted-family' }), { family: 'noted-family', reason: null, lower: false });
  assert.deepEqual(choose('mixed-choice', { proposed: 'quick-family', reader: AGREE }), { family: 'quick-family', reason: null, lower: true });
  assert.deepEqual(choose('no-such-choice', { proposed: 'quick-family', reader: AGREE }), { family: 'fallback-family', reason: 'no-row', lower: false });
  assert.deepEqual(choose('no-such-choice'), { family: 'fallback-family', reason: null, lower: false });
  // The reasons are checked in order: unlisted, floored-first, carries-triage, no-verdict, raised.
  assert.deepEqual(choose('mixed-choice', { proposed: 'signed-family', reader: AGREE }), { family: 'noted-family', reason: 'unlisted', lower: false });
  assert.deepEqual(choose('floored-choice', { proposed: 'signed-family' }), { family: 'guarded-family', reason: 'unlisted', lower: false });
  assert.deepEqual(choose('floored-choice', { proposed: 'quick-family', reader: AGREE, carried: { version: 1, class: 'record' } }),
    { family: 'guarded-family', reason: 'floored-first', lower: true });
  assert.deepEqual(choose('mixed-choice', { proposed: 'quick-family', reader: RAISE, carried: { version: 1, class: 'record' } }),
    { family: 'noted-family', reason: 'carries-triage', lower: true });
  assert.deepEqual(choose('mixed-choice', { proposed: 'quick-family' }), { family: 'noted-family', reason: 'no-verdict', lower: true });
  assert.deepEqual(choose('mixed-choice', { proposed: 'quick-family', reader: { verdict: 'maybe' } }), { family: 'noted-family', reason: 'no-verdict', lower: true });
  assert.deepEqual(choose('mixed-choice', { proposed: 'quick-family', reader: RAISE }), { family: 'noted-family', reason: 'raised', lower: true });
  // A gate is never lowered: the verdict is not read, so the lowering reads as one without a verdict.
  assert.deepEqual(familyChoice({ policy, workflow: 'sample', kind: 'gate', id: 'plain-gate', proposed: 'quick-family', reader: AGREE }),
    { family: 'noted-family', reason: 'no-verdict', lower: true });

  // The triage of a chosen family is the one `triageFor` writes for the same choice; no family classes nothing.
  const agreed = { proposed: 'quick-family', reader: AGREE };
  assert.deepEqual(triageUnder({ policy, family: choose('mixed-choice', agreed).family }),
    triageFor({ policy, workflow: 'sample', kind: 'question', id: 'mixed-choice', declaredIds: ['mixed-choice'], family: 'quick-family', reader: AGREE }));
  assert.equal(triageUnder({ policy, family: null }), null);
  assert.equal(triageUnder({ policy, family: 'no-such-family' }), null);

  // The brief's families: the first, the stricter, and the lower ones marked, only under an unfloored first.
  assert.deepEqual(questionFamilies({ policy, workflow: 'sample', id: 'mixed-choice', declaredIds: ['mixed-choice'] }), [
    { name: 'noted-family', description: 'Settled and recorded.' },
    { name: 'asked-family', description: 'Worth a second opinion.' },
    { name: 'quick-family', description: 'Settled alone.', lower: true },
  ]);
  assert.deepEqual(questionFamilies({ policy, workflow: 'sample', id: 'floored-choice', declaredIds: ['floored-choice'] }), [
    { name: 'guarded-family', description: 'Carries a floor id, so approved.' },
  ]);
  assert.deepEqual(questionFamilies({ policy, workflow: 'sample', id: 'no-such-choice', declaredIds: ['no-such-choice'] }), []);
});

test('a verdict that is not a well-formed agree reads as no verdict, and a per-area id lowers under its declared id', () => {
  const policy = questionPolicy([['mixed-choice', ['noted-family', 'quick-family']]]);
  const ask = (id, extra = {}) => triageFor({ policy, workflow: 'sample', kind: 'question', id, declaredIds: ['mixed-choice', 'other-choice'], ...extra });
  const first = { version: 1, class: 'record', family: 'noted-family' };

  // Only the exact word `agree` lowers: a string, an array, another case or a missing field do not.
  for (const reader of ['agree', ['agree'], { verdict: 'Agree' }, { reason: 'No option changes anything.' }, null]) {
    assert.deepEqual(ask('mixed-choice', { family: 'quick-family', reader }), first, JSON.stringify(reader));
  }
  // A per-area slug of the declared id lowers under that id's row, as the id itself does.
  assert.deepEqual(ask('mixed-choice-storage', { family: 'quick-family', reader: AGREE }), { version: 1, class: 'decide-alone', family: 'quick-family' });
  assert.deepEqual(ask('mixed-choice-storage', { family: 'quick-family' }), first);
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

test('a __proto__ key is kept in the hash, not dropped', () => {
  const text = '{"version":1,"__proto__":{"x":1}}';
  const parsed = JSON.parse(text);
  const expected = `sha256:${createHash('sha256').update('{"__proto__":{"x":1},"version":1}', 'utf8').digest('hex')}`;
  assert.equal(policyHash(parsed), expected);
  assert.notEqual(expected, DEFAULT_HASH);
  // An unknown root key: the file loads, and its hash still counts the key.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'));
  const file = path.join(dir, 'proto.json');
  fs.writeFileSync(file, text);
  const loaded = loadPolicy({ path: file });
  assert.deepEqual(loaded.warnings, []);
  assert.equal(loaded.source, file);
  assert.equal(loaded.hash, expected);
});
