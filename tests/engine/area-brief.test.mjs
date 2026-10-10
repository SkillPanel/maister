import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES } from '../helpers.mjs';
import {
  FIXED_LABELS, areaDetails, areaEntry, areaPicker, loadAreas,
} from '../../plugins/maister/skills/workflow-engine/scripts/lib/decision-areas.mjs';
import { PREVIEW_BUDGET } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The decision areas a brainstorm writes beside its markdown, and the questions
// the engine renders from them. The contract pinned here: a file is judged
// whole and refused with one located fault, `<reason> at <dotted.path>`; a
// fresh file is one whose `source.sha256` still matches the markdown's bytes;
// and every rendered string is either the file's own text or one of the fixed
// labels the shape reference lists. Every area here is made up.

const AREAS = path.join(FIXTURES, 'decision-areas');
const REFERENCE = path.join(ENGINE_DIR, 'references/decision-areas.md');
const fixture = name => path.join(AREAS, name);

/** The valid fixture's areas, loaded the way the verb loads them. */
function areas() {
  const loaded = loadAreas({ file: fixture('valid.json'), taskDir: AREAS });
  assert.ok(loaded.areas, `valid.json did not load: ${loaded.warning}`);
  return loaded.areas;
}

/** A scratch task directory holding a copy of the valid fixture and its markdown. */
function scratchTask() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-areas-'));
  fs.copyFileSync(fixture('valid.json'), path.join(dir, 'decision-areas.json'));
  fs.copyFileSync(fixture('source.md'), path.join(dir, 'source.md'));
  return dir;
}

// ---------------------------------------------------------------------------
// the shape check
// ---------------------------------------------------------------------------

test('area-brief: the valid file passes and every invalid file gives its one located fault', () => {
  assert.equal(areas().length, 3);
  const cases = {
    'not-json.json': 'not-json at (root)',
    'wrong-type.json': 'wrong-type at areas.0.alternatives.1.pros',
    'version.json': 'version at version',
    'missing-key.json': 'missing-key at areas.1.recommendation',
    'unknown-key.json': 'unknown-key at areas.1.alternatives.0.summary',
    'empty.json': 'empty at areas.0.alternatives.0.cons',
    'not-one-line.json': 'not-one-line at areas.2.question',
    'bad-id.json': 'bad-id at areas.1.id',
    'duplicate.json': 'duplicate at areas.2.depends_on.1',
    'too-few.json': 'too-few at areas.1.alternatives',
    'reserved-id.json': 'reserved-id at areas.2.alternatives.2.id',
    'unknown-alternative.json': 'unknown-alternative at areas.0.recommendation.alternative',
    'unknown-area.json': 'unknown-area at areas.2.depends_on.1',
    'depends-order.json': 'depends-order at areas.0.depends_on.0',
    'bad-path.json': 'bad-path at source.path',
    'bad-digest.json': 'bad-digest at source.sha256',
  };
  const reasons = new Set(Object.values(cases).map(fault => fault.split(' at ')[0]));
  assert.equal(reasons.size, 16, 'one fixture per reason of the closed set');
  for (const [name, fault] of Object.entries(cases)) {
    const loaded = loadAreas({ file: fixture(name), taskDir: AREAS });
    assert.deepEqual(loaded, { warning: `decision-areas-invalid:${name}:${fault}` }, name);
  }
});

test('area-brief: a document that is not an object, or a list where an area belongs, is wrong-type', () => {
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  fs.writeFileSync(file, '[]');
  assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-invalid:decision-areas.json:wrong-type at (root)' });
  const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
  doc.areas[1] = [];
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-invalid:decision-areas.json:wrong-type at areas.1' });
});

// ---------------------------------------------------------------------------
// loading: missing, unreadable, stale
// ---------------------------------------------------------------------------

test('area-brief: a missing, stale or source-less file is a warning and no area is returned', () => {
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  assert.ok(loadAreas({ file, taskDir: dir }).areas, 'the scratch copy is fresh');

  const missing = loadAreas({ file: path.join(dir, 'outputs/decision-areas.json'), taskDir: dir });
  assert.deepEqual(missing, { warning: 'decision-areas-missing:outputs/decision-areas.json' });

  const unreadable = loadAreas({ file: dir, taskDir: path.dirname(dir) });
  assert.deepEqual(unreadable, { warning: `decision-areas-unreadable:${path.basename(dir)}:EISDIR` });

  fs.appendFileSync(path.join(dir, 'source.md'), '\nEdited after the stamp.\n');
  assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-stale:decision-areas.json:source.md' });

  fs.unlinkSync(path.join(dir, 'source.md'));
  assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-stale:decision-areas.json:source.md:source-unreadable' });
});

// ---------------------------------------------------------------------------
// the pickers
// ---------------------------------------------------------------------------

test('area-brief: the rich picker offers the recommended first, then rank order, three at most, More details last', () => {
  const all = areas();
  const storage = all[0];
  const picker = areaPicker(storage, all, 'rich');
  assert.equal(picker.ok, true);
  assert.equal(picker.picker, 'rich');
  assert.equal(picker.question_id, 'convergence-decisions-storage');
  assert.equal(picker.header, 'Storage');
  assert.equal(picker.details, 'option');
  assert.deepEqual(picker.errors, []);
  assert.deepEqual(picker.warnings, []);
  assert.deepEqual(picker.options.map(option => option.id), ['same-db', 'hosted-api', 'own-service', 'more-details']);
  const [recommended, second] = picker.options;
  assert.equal(recommended.label, 'Same database (Recommended)');
  assert.equal(recommended.description, 'Reuses the `calendars` schema with no new service');
  assert.equal(recommended.recommended, true);
  assert.match(recommended.preview, /\*\*Why recommended\*\*: Reuses the `calendars` schema with no new service$/);
  assert.match(recommended.preview, /\*\*Pros\*\*\n- No new service\n- One backup/);
  assert.equal(second.label, 'Hosted calendar API');
  assert.equal(second.description, 'Pro: Sharing built in · Con: A vendor holds the data');
  assert.equal(second.recommended, false);
  const more = picker.options.at(-1);
  assert.deepEqual(Object.keys(more), ['id', 'label', 'description', 'recommended', 'details', 'preview']);
  assert.equal(more.description, 'Shows every alternative in full, then asks this again. Nothing is recorded.');
  assert.equal(more.preview, picker.more_details, 'a write-up within the budget is previewed whole');
  for (const option of picker.options) assert.ok(option.preview.length <= PREVIEW_BUDGET, option.id);
  assert.equal(picker.question, [
    'Storage: Where do shared calendars live?',
    'Why it matters: It fixes what a later migration costs.',
    'Hosted calendar API — Pro: Sharing built in · Con: A vendor holds the data',
    'Same database — Pro: No new service · Con: Couples the schemas',
    'Own service — Pro: Scales alone · Con: One more deploy',
    'Document store — Pro: One read per calendar · Con: A second database',
    'Also considered — type one to choose it: Document store.',
  ].join('\n'));
});

test('area-brief: the plain picker offers every alternative by label, ends on the recommendation and drops backticks', () => {
  const all = areas();
  const picker = areaPicker(all[0], all, 'plain');
  assert.equal(picker.picker, 'plain');
  assert.deepEqual(picker.options, [
    { id: 'same-db', label: 'Same database (Recommended)', recommended: true },
    { id: 'hosted-api', label: 'Hosted calendar API', recommended: false },
    { id: 'own-service', label: 'Own service', recommended: false },
    { id: 'document-store', label: 'Document store', recommended: false },
    { id: 'more-details', label: 'More details', recommended: false, details: true },
  ]);
  assert.equal(picker.question.split('\n').at(-1), 'Recommended: Same database — Reuses the calendars schema with no new service.');
  assert.doesNotMatch(picker.question, /Also considered/);
  assert.doesNotMatch(JSON.stringify({ ...picker, more_details: '' }), /`/);
  assert.match(picker.more_details, /`calendar_shares`/, 'the write-up keeps its markdown');
  // A reason that already closes with a stop gains no second one.
  const screen = areaPicker(all[2], all, 'plain');
  assert.equal(screen.question.split('\n').at(-1), 'Recommended: Inline toggle — One click from the calendar itself.');
  assert.match(screen.question, /\nDepends on: Storage, Access model\.\n/);
});

test('area-brief: an area left open offers the first three in rank order, none marked, and states no recommendation', () => {
  const all = areas();
  const access = all[1];
  for (const profile of ['rich', 'plain']) {
    const picker = areaPicker(access, all, profile);
    assert.deepEqual(picker.options.map(option => option.id), ['signed-link', 'guest-account', 'more-details'], profile);
    assert.ok(picker.options.every(option => option.recommended === false), profile);
    assert.doesNotMatch(picker.question, /Recommended/, profile);
    assert.doesNotMatch(picker.more_details, /Recommended/, profile);
  }
  assert.ok(areaEntry(access, all).options.every(option => !('recommended' in option)));
  // Over the cap, an open area keeps the rank order and names the rest.
  const open = { ...all[0], recommendation: null };
  const rich = areaPicker(open, all, 'rich');
  assert.deepEqual(rich.options.map(option => option.id), ['hosted-api', 'same-db', 'own-service', 'more-details']);
  assert.ok(rich.options.every(option => option.recommended === false && !/Recommended/.test(option.label)));
  assert.equal(rich.question.split('\n').at(-1), 'Also considered — type one to choose it: Document store.');
});

// ---------------------------------------------------------------------------
// the write-up and the driven entry
// ---------------------------------------------------------------------------

test('area-brief: the write-up is never clipped and is the same text in the picker and the driven entry', () => {
  const all = areas();
  const screen = all[2];
  const details = areaDetails(screen, all);
  assert.equal(details, [
    '**Sharing screen**',
    'Where does an owner share a calendar from?',
    'Why it matters: It sets how many steps sharing takes.',
    'Depends on: Storage, Access model.',
    '',
    '**Inline toggle** (Recommended)',
    'A share toggle on the calendar header.',
    '',
    'Pros:',
    '- One click',
    '',
    'Cons:',
    '- Little room for options',
    '',
    '**Share dialog**',
    'A dialog listing who can see the calendar.',
    '',
    'Pros:',
    '- Room for every option',
    '',
    'Cons:',
    '- Two clicks',
    '',
    '**Settings page**',
    'Sharing lives with the calendar\'s settings.',
    '',
    'Pros:',
    '- Nothing new on the main screen',
    '',
    'Cons:',
    '- Hard to find',
    '',
    'Recommended: Inline toggle — One click from the calendar itself.',
  ].join('\n'));
  for (const profile of ['rich', 'plain']) assert.equal(areaPicker(screen, all, profile).more_details, details, profile);
  const entry = areaEntry(screen, all);
  assert.equal(entry.details, details);
  assert.deepEqual(entry, {
    id: 'convergence-decisions-sharing-screen',
    header: 'Sharing scr…',
    question: 'Sharing screen: Where does an owner share a calendar from?',
    why: 'It sets how many steps sharing takes. Depends on: Storage, Access model.',
    options: [
      { id: 'inline-toggle', label: 'Inline toggle', description: 'One click from the calendar itself.', recommended: true },
      { id: 'dialog', label: 'Share dialog', description: 'Pro: Room for every option · Con: Two clicks' },
      { id: 'settings-page', label: 'Settings page', description: 'Pro: Nothing new on screen · Con: Hard to find' },
    ],
    details,
  });

  // A write-up longer than the preview budget is still returned whole; only
  // the More details preview is cut, closed with the line that says how to see the rest.
  const long = structuredClone(screen);
  long.alternatives[0].description = 'A long description of the toggle. '.repeat(120).trim();
  const whole = areaDetails(long, all);
  assert.ok(whole.length > PREVIEW_BUDGET);
  const rich = areaPicker(long, all, 'rich');
  assert.equal(rich.more_details, whole);
  const preview = rich.options.at(-1).preview;
  assert.ok(preview.length <= PREVIEW_BUDGET);
  assert.match(preview, /…\n\nChoose this to see the rest\.$/);
});

// ---------------------------------------------------------------------------
// adds nothing
// ---------------------------------------------------------------------------

test('area-brief: every fixed label the module adds is listed in the shape reference', () => {
  const reference = fs.readFileSync(REFERENCE, 'utf8');
  assert.ok(FIXED_LABELS.length >= 16);
  for (const label of FIXED_LABELS) assert.ok(reference.includes(label), `the reference lists ${JSON.stringify(label)}`);
  // Strip every fixed label and every string of the file from the rendered
  // text: nothing of the module's own wording may remain.
  const all = areas();
  const words = new Set();
  const collect = value => {
    if (typeof value === 'string') { words.add(value); words.add(value.replace(/`/g, '')); }
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(all);
  const pieces = [...words, ...FIXED_LABELS].sort((a, b) => b.length - a.length);
  for (const area of all) {
    for (const profile of ['rich', 'plain']) {
      const picker = areaPicker(area, all, profile);
      assert.ok(area.area.startsWith(picker.header.replace(/…$/, '')), `${area.id} ${profile}: the header is the area name, clipped`);
      const shown = [picker.question, picker.more_details, ...picker.options.flatMap(option => [option.label, option.description ?? '', option.preview ?? ''])];
      for (const text of shown) {
        let rest = text;
        for (const piece of pieces) rest = rest.split(piece).join('');
        assert.match(rest, /^[\s*\-:.,…]*$/, `${area.id} ${profile}: ${JSON.stringify(rest)} is the module's own wording`);
      }
    }
  }
});
