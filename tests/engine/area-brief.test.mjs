import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENGINE, ENGINE_DIR, FIXTURES, freeze, freezePatch, maskRoot, run as runScript, scratch, scratchPlugin, verb, write,
} from '../helpers.mjs';
import {
  FIXED_LABELS, areaDetails, areaEntry, areaPicker, loadAreas,
} from '../../plugins/maister/skills/workflow-engine/scripts/lib/decision-areas.mjs';
import { areaBrief } from '../../plugins/maister/skills/workflow-engine/scripts/lib/area-brief.mjs';
import { PREVIEW_BUDGET } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';
import { HEADER_MAX } from '../../plugins/maister/skills/workflow-engine/scripts/lib/display.mjs';

// The decision areas a brainstorm writes beside its markdown, and the questions
// the engine renders from them. The contract pinned here: a file is judged
// whole and refused with one located fault, `<reason> at <dotted.path>`; a
// fresh file is one whose `source.sha256` still matches the markdown's bytes;
// and every rendered string is either the file's own text or one of the fixed
// labels the shape reference lists. Every area here is made up.
//
// The verb, `area-brief`, is pinned through the entry point the way a node
// runs it: its four refusals (exit 1, the code first on stderr), its usage
// errors (exit 2), the fallback warnings that end it at exit 0 with nothing to
// paste, where it finds the file in each built-in that declares one, and the
// goldens of its picker and write-up forms. `SNAPSHOT_AREAS=1` rewrites the
// goldens: `SNAPSHOT_AREAS=1 node --test tests/engine/area-brief.test.mjs`.

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

test('area-brief: the rich and driven headers clip a long area name to the header length, the plain one keeps it whole', () => {
  const all = areas();
  // Exactly the header length is kept whole.
  assert.equal([...all[1].area].length, HEADER_MAX);
  assert.equal(areaPicker(all[1], all, 'rich').header, 'Access model');
  assert.equal(areaEntry(all[1], all).header, 'Access model');
  const long = { ...all[0], area: 'Storage of shared calendars' };
  const rich = areaPicker(long, all, 'rich');
  assert.equal(rich.header, 'Storage of…');
  assert.ok([...rich.header].length <= HEADER_MAX);
  assert.equal(areaEntry(long, all).header, rich.header, 'the driven entry clips the same way');
  assert.equal(areaPicker(long, all, 'plain').header, 'Storage of shared calendars');
  // The question and the write-up carry the name whole in every form.
  assert.match(rich.question, /^Storage of shared calendars: /);
  assert.match(rich.more_details, /^\*\*Storage of shared calendars\*\*\n/);
});

test('area-brief: an alternative\'s preview is clipped to the budget while the write-up and the driven entry keep it whole', () => {
  const all = areas();
  const long = structuredClone(all[0]);
  const description = 'A long account of the shared table and its joins. '.repeat(60).trim();
  long.alternatives.find(alternative => alternative.id === 'same-db').description = description;
  const picker = areaPicker(long, all, 'rich');
  const recommended = picker.options[0];
  assert.equal(recommended.id, 'same-db');
  assert.ok(recommended.preview.length <= PREVIEW_BUDGET, `${recommended.preview.length} over the budget`);
  assert.match(recommended.preview, /^\*\*Same database\*\*\n\nA long account/);
  assert.match(recommended.preview, /…$/, 'the clip is marked');
  assert.doesNotMatch(recommended.preview, /\*\*Why recommended\*\*/, 'what falls past the budget is cut, not moved');
  for (const option of picker.options) assert.ok(option.preview.length <= PREVIEW_BUDGET, option.id);
  assert.ok(picker.more_details.includes(description), 'the write-up is never clipped');
  assert.ok(areaEntry(long, all).details.includes(description), 'the driven details are never clipped');
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

// ---------------------------------------------------------------------------
// the verb: a run at its convergence node
// ---------------------------------------------------------------------------

const GOLDEN = path.join(AREAS, 'golden');

/** The two built-ins whose convergence asks decision areas, and where each declares the file. */
const WORKFLOWS = {
  research: {
    definition: path.join(ENGINE_DIR, 'workflows/research.yml'),
    inputs: { question: 'Where do shared calendars live?' },
    producer: 'solution-generation',
    node: 'solution-convergence',
    declared: 'outputs/decision-areas.json',
  },
  'product-design': {
    definition: path.join(ENGINE_DIR, 'workflows/product-design.yml'),
    inputs: { task_description: 'Share a calendar with guests.' },
    producer: 'idea-generation',
    node: 'idea-convergence',
    declared: 'analysis/decision-areas.json',
  },
};

/**
 * A run of `workflow` frozen and walked to its convergence node: the producer
 * `producer`, the convergence node `asking`, and — unless `file` is false —
 * the valid fixture at the declared path with its markdown at the task root.
 */
function atConvergence(t, { workflow = 'research', producer = 'completed', asking = 'running', file = true } = {}) {
  const spec = WORKFLOWS[workflow];
  const run = scratch(t, { type: workflow, name: `2026-10-10-${workflow}-areas` });
  freeze(run, { definition: spec.definition, inputs: spec.inputs });
  write(run, { nodes: { [spec.producer]: { status: producer }, [spec.node]: { status: asking } } });
  if (file) {
    fs.mkdirSync(path.join(run.dir, path.dirname(spec.declared)), { recursive: true });
    fs.copyFileSync(fixture('valid.json'), path.join(run.dir, spec.declared));
    fs.copyFileSync(fixture('source.md'), path.join(run.dir, 'source.md'));
  }
  return { ...run, ...spec };
}

/** `area-brief` against `run`, at its convergence node unless `node` names another. */
function brief(run, flags, { node = run.node } = {}) {
  return verb(['area-brief', `--state=${run.state}`, `--node=${node}`, ...flags]);
}

/** The run directory's files, each with its bytes: what a read-only verb must leave as it was. */
function snapshotOf(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      files[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// the refusal register: every code raised, documented and provoked
// ---------------------------------------------------------------------------

const REFUSALS = [
  'area-brief-state-unreadable',
  'area-brief-unknown-node',
  'area-brief-not-running',
  'area-brief-unknown-area',
];

test('area-brief: the refusal list is exactly the codes the verb raises, each with a recovery row in the engine skill', () => {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/area-brief.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(area-brief-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
  for (const code of REFUSALS) {
    assert.ok(source.split('*/')[0].includes(code), `the module header lists ${code}`);
    const row = skill.split('\n').find(line => line.startsWith('|') && line.includes(`\`${code}\``));
    assert.ok(row, `no refusal row names ${code}`);
    assert.ok(row.length > 160, `the row for ${code} is too short to tell an operator what to do`);
  }
});

test('provoked: each refusal exits 1 with its code first on stderr and nothing to paste', t => {
  const cases = [
    { code: 'area-brief-state-unreadable', setup: run => fs.unlinkSync(run.state) },
    { code: 'area-brief-unknown-node', node: 'nowhere' },
    { code: 'area-brief-unknown-node', node: 'convergence-approval' },
    { code: 'area-brief-not-running', asking: 'pending' },
    { code: 'area-brief-not-running', asking: 'completed' },
    { code: 'area-brief-unknown-area', area: 'nowhere' },
  ];
  for (const { code, setup, node, asking = 'running', area = 'storage' } of cases) {
    const run = atConvergence(t, { asking });
    setup?.(run);
    const label = `${code} (${node ?? asking})`;
    const plain = brief(run, [`--area=${area}`], { node });
    assert.equal(plain.code, 1, label);
    assert.equal(plain.stdout, '', label);
    assert.ok(plain.stderr.startsWith(`${code}: `), `${label}: ${plain.stderr}`);
    const json = brief(run, [`--area=${area}`, '--json'], { node });
    assert.equal(json.code, 1, label);
    const reported = JSON.parse(json.stdout);
    assert.equal(reported.ok, false, label);
    assert.equal(reported.errors[0].code, code, label);
    assert.ok(json.stderr.startsWith(`${code}: `), label);
  }
  // Area ids are judged only once the file passed: an unknown id against a
  // missing file is the fallback, never the refusal.
  const missing = atConvergence(t, { file: false });
  const fallback = brief(missing, ['--area=nowhere']);
  assert.equal(fallback.code, 0, fallback.stderr);
  assert.match(fallback.stderr, /^warning: decision-areas-missing:outputs\/decision-areas\.json$/m);
  // The refusal names the file's ids, in order, for the recovery.
  const run = atConvergence(t);
  assert.match(brief(run, ['--area=nowhere']).stderr, /storage, access, sharing-screen/);
});

test('usage: each wrong flag combination exits 2 with usage: on stderr', t => {
  const run = atConvergence(t);
  const patch = path.join(run.dir, '.state-patch.json');
  const elsewhere = path.join(run.root, '.state-patch.json');
  const cases = {
    'no --state': ['area-brief', `--node=${run.node}`, '--area=storage'],
    'no --node': ['area-brief', `--state=${run.state}`, '--area=storage'],
    '--picker without --json': ['--area=storage', '--picker=rich'],
    'an unknown --picker': ['--area=storage', '--json', '--picker=fancy'],
    '--json with --patch-file': ['--json', `--patch-file=${patch}`],
    'the picker form without --area': ['--json'],
    'the picker form with two --area': ['--json', '--area=storage', '--area=access'],
    'the write-up form without --area': [],
    'the write-up form with two --area': ['--area=storage', '--area=access'],
    'a patch file elsewhere': [`--patch-file=${elsewhere}`],
    'a patch file by another name': [`--patch-file=${path.join(run.dir, 'areas.json')}`],
    'a patch file through ..': [`--patch-file=${run.dir}${path.sep}outputs${path.sep}..${path.sep}.state-patch.json`],
  };
  for (const [label, flags] of Object.entries(cases)) {
    const result = flags[0] === 'area-brief' ? verb(flags) : brief(run, flags);
    assert.equal(result.code, 2, `${label}: ${result.stderr}`);
    assert.match(result.stderr, /^usage: /, label);
    assert.equal(result.stdout, '', label);
  }
  // Something already at the patch file's place must be a regular file.
  fs.mkdirSync(patch);
  assert.equal(brief(run, [`--patch-file=${patch}`]).code, 2, 'a directory');
  fs.rmdirSync(patch);
  fs.symlinkSync(path.join(run.dir, 'source.md'), patch);
  const linked = brief(run, [`--patch-file=${patch}`]);
  assert.equal(linked.code, 2, 'a link');
  assert.match(linked.stderr, /^usage: .*symbolic link/);
});

// ---------------------------------------------------------------------------
// the fallback: a warning, exit 0, nothing to paste
// ---------------------------------------------------------------------------

test('area-brief: a missing, invalid, stale or undeclared file warns once and the node composes the area itself', t => {
  const cases = [
    { warning: 'decision-areas-missing:outputs/decision-areas.json', options: { file: false } },
    {
      warning: 'decision-areas-invalid:outputs/decision-areas.json:not-json at (root)',
      setup: run => fs.writeFileSync(path.join(run.dir, run.declared), '{'),
    },
    {
      warning: 'decision-areas-stale:outputs/decision-areas.json:source.md',
      setup: run => fs.appendFileSync(path.join(run.dir, 'source.md'), '\nEdited after the stamp.\n'),
    },
    { warning: 'decision-areas-missing:outputs/decision-areas.json:producer-not-completed', options: { producer: 'running' } },
    // A node whose `with:` names no decision areas is not one that asks them.
    {
      warning: 'decision-areas-missing:not-declared',
      setup: run => write(run, { nodes: { 'research-foundation': { status: 'running' } } }),
      node: 'research-foundation',
    },
  ];
  for (const { warning, options = {}, setup, node } of cases) {
    const run = atConvergence(t, options);
    setup?.(run);
    const before = snapshotOf(run.dir);
    const json = brief(run, ['--area=storage', '--json'], { node });
    assert.equal(json.code, 0, `${warning}: ${json.stderr}`);
    assert.deepEqual(JSON.parse(json.stdout), { ok: true, fallback: true, errors: [], warnings: [warning] });
    assert.equal(json.stderr, `warning: ${warning}\n`);
    const writeUp = brief(run, ['--area=storage'], { node });
    assert.equal(writeUp.code, 0, warning);
    assert.equal(writeUp.stdout, '', warning);
    assert.equal(writeUp.stderr, `warning: ${warning}\n`);
    const set = brief(run, [`--patch-file=${path.join(run.dir, '.state-patch.json')}`], { node });
    assert.equal(set.code, 0, `${warning}: ${set.stderr}`);
    assert.equal(set.stdout, '', warning);
    assert.deepEqual(snapshotOf(run.dir), before, `${warning}: nothing was written`);
  }
});

test('area-brief: a declared file that exists but cannot be read warns unreadable with its error code, exit 0', t => {
  const run = atConvergence(t, { file: false });
  fs.mkdirSync(path.join(run.dir, run.declared), { recursive: true });
  const warning = `decision-areas-unreadable:${run.declared}:EISDIR`;
  const json = brief(run, ['--area=storage', '--json']);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, fallback: true, errors: [], warnings: [warning] });
  assert.equal(json.stderr, `warning: ${warning}\n`);
  const writeUp = brief(run, ['--area=storage']);
  assert.equal(writeUp.code, 0, writeUp.stderr);
  assert.equal(writeUp.stdout, '');
  const patch = path.join(run.dir, '.state-patch.json');
  const set = brief(run, [`--patch-file=${patch}`]);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(set.stderr, `warning: ${warning}\n`);
  assert.equal(fs.existsSync(patch), false);
});

// ---------------------------------------------------------------------------
// location: each built-in's declared path, through the convergence node's with:
// ---------------------------------------------------------------------------

test('area-brief: research and product design each find the file their brainstorm declares, and write nothing', t => {
  for (const workflow of Object.keys(WORKFLOWS)) {
    const run = atConvergence(t, { workflow });
    const before = snapshotOf(run.dir);
    const result = brief(run, ['--area=access', '--json', '--picker=rich']);
    assert.equal(result.code, 0, `${workflow}: ${result.stderr}`);
    assert.equal(result.stderr, '', workflow);
    const picker = JSON.parse(result.stdout);
    assert.equal(picker.ok, true, workflow);
    assert.equal(picker.question_id, 'convergence-decisions-access', workflow);
    assert.deepEqual(snapshotOf(run.dir), before, `${workflow}: no state, no display/next.json`);
    assert.ok(!Object.hasOwn(before, path.join('display', 'next.json')), `${workflow}: no panel`);
    // Only the declared path is read: the same file anywhere else is not found.
    fs.renameSync(path.join(run.dir, run.declared), path.join(run.dir, 'decision-areas.json'));
    const moved = brief(run, ['--area=access']);
    assert.equal(moved.stderr, `warning: decision-areas-missing:${run.declared}\n`, workflow);
  }
});

// ---------------------------------------------------------------------------
// the goldens: the picker in both profiles, an open area, the write-up
// ---------------------------------------------------------------------------

test('area-brief: the picker and write-up forms print the goldens, the write-up byte-identical to more_details', t => {
  const run = atConvergence(t);
  const goldens = {
    'picker.rich.json': ['--area=storage', '--json'],
    'picker.plain.json': ['--area=storage', '--json', '--picker=plain'],
    'picker.rich.open.json': ['--area=access', '--json', '--picker=rich'],
    'write-up.md': ['--area=sharing-screen'],
  };
  for (const [name, flags] of Object.entries(goldens)) {
    const result = brief(run, flags);
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    assert.equal(result.stderr, '', name);
    const printed = maskRoot(result.stdout, run.root);
    const file = path.join(GOLDEN, name);
    if (process.env.SNAPSHOT_AREAS === '1') {
      fs.mkdirSync(GOLDEN, { recursive: true });
      fs.writeFileSync(file, printed);
    }
    assert.equal(printed, fs.readFileSync(file, 'utf8'), `${name} moved; regenerate with SNAPSHOT_AREAS=1 and review it`);
  }
  const rich = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'picker.rich.json'), 'utf8'));
  assert.equal(rich.picker, 'rich', 'the profile defaults to rich under --json');
  assert.match(rich.question, /\nAlso considered — type one to choose it: Document store\.$/);
  const plain = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'picker.plain.json'), 'utf8'));
  assert.equal(plain.options.length, 5, 'the plain profile is not capped');
  const open = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'picker.rich.open.json'), 'utf8'));
  assert.ok(open.options.every(option => option.recommended === false));
  const screen = JSON.parse(brief(run, ['--area=sharing-screen', '--json']).stdout);
  assert.equal(fs.readFileSync(path.join(GOLDEN, 'write-up.md'), 'utf8'), `${screen.more_details}\n`);
});

// ---- driven set
// ---------------------------------------------------------------------------
// the set form: every area as the convergence node's question set, written to
// the run's patch file for `gate-brief --request` to build the one request
// ---------------------------------------------------------------------------

const CLASSING = JSON.parse(fs.readFileSync(fixture('policy-classing.json'), 'utf8'));
const DRIVER = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const AREA_TRIAGE = { version: 1, class: 'consult', family: 'direction' };

/**
 * A research run under a cockpit that takes question sets, frozen by `frozenBy`
 * (so the recorded policy hash is that engine's policy's) and walked to its
 * convergence node, the valid fixture at the declared path. Every later verb
 * runs through `engine`.
 */
function drivenRun(t, { engine = ENGINE, frozenBy = engine } = {}) {
  const spec = WORKFLOWS.research;
  const run = scratch(t, { type: 'research', name: '2026-10-10-research-driven' });
  const { patch } = freezePatch({ definition: spec.definition, inputs: spec.inputs, orchestrator: { driver: DRIVER } });
  passed(frozenBy, ['write-state', `--state=${run.state}`], patch);
  passed(engine, ['write-state', `--state=${run.state}`], { nodes: { [spec.producer]: { status: 'completed' }, [spec.node]: { status: 'running' } } });
  fs.mkdirSync(path.join(run.dir, path.dirname(spec.declared)), { recursive: true });
  fs.copyFileSync(fixture('valid.json'), path.join(run.dir, spec.declared));
  fs.copyFileSync(fixture('source.md'), path.join(run.dir, 'source.md'));
  return { ...run, ...spec, engine, patch: path.join(run.dir, '.state-patch.json') };
}

function passed(engine, args, stdin) {
  const result = runScript(engine, args, stdin);
  if (result.code !== 0) throw new Error(`${args[0]} exited ${result.code}: ${result.stdout}${result.stderr}`);
  return result;
}

/** The set form against `run`, through its engine. */
function setOf(run, flags = []) {
  return runScript(run.engine, ['area-brief', `--state=${run.state}`, `--node=${run.node}`, `--patch-file=${run.patch}`, ...flags]);
}

function written(run) {
  return JSON.parse(fs.readFileSync(run.patch, 'utf8'));
}

test('area-brief --patch-file writes every area as a question set and prints the file, the set.json golden', t => {
  const run = drivenRun(t);
  const result = setOf(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${run.patch}\n`, 'the file prints its own path as one line');
  const text = maskRoot(fs.readFileSync(run.patch, 'utf8'), run.root);
  const file = path.join(GOLDEN, 'set.json');
  if (process.env.SNAPSHOT_AREAS === '1') fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, 'utf8'), 'set.json moved; regenerate with SNAPSHOT_AREAS=1 and review it');

  const set = written(run);
  assert.deepEqual(Object.keys(set), ['questions'], 'no ask and no headline: the request generates them');
  const all = areas();
  assert.deepEqual(set.questions.map(question => question.id), all.map(area => `convergence-decisions-${area.id}`));
  for (const [i, question] of set.questions.entries()) {
    assert.deepEqual(question, areaEntry(all[i], all), all[i].id);
    assert.equal(Object.hasOwn(question, 'default'), false, 'the request fills the default from the recommendation');
    assert.equal(Object.hasOwn(question, 'triage'), false, 'the built-in default classes nothing');
    assert.equal(question.options.length, all[i].alternatives.length, 'every alternative, no More details');
  }
  const screen = set.questions.find(question => question.id === 'convergence-decisions-sharing-screen');
  assert.equal(`${screen.details}\n`, fs.readFileSync(path.join(GOLDEN, 'write-up.md'), 'utf8'));
  assert.match(screen.why, / Depends on: /);
  assert.equal(screen.options[0].recommended, true);
});

test('area-brief --patch-file with repeated --area writes only those areas, replacing the earlier file whole', t => {
  const run = drivenRun(t);
  fs.writeFileSync(run.patch, JSON.stringify({ ask: 'An earlier set', questions: [{ id: 'stale' }] }));
  const result = setOf(run, ['--area=sharing-screen', '--area=storage']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(Object.keys(written(run)), ['questions']);
  assert.deepEqual(written(run).questions.map(question => question.id),
    ['convergence-decisions-storage', 'convergence-decisions-sharing-screen'], 'in file order');
  assert.deepEqual(fs.readdirSync(run.dir).filter(name => name.endsWith('.tmp')), [], 'no temp file left behind');
});

test('area-brief --patch-file feeds gate-brief --request: details and triage on the checkpoint questions only', t => {
  const run = drivenRun(t, { engine: scratchPlugin(t, { policy: CLASSING }) });
  const set = setOf(run);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(set.stderr, '', 'the hashes match: no warning');
  const asked = passed(run.engine, ['gate-brief', `--state=${run.state}`, `--node=${run.node}`, '--request', `--patch-file=${run.patch}`]);
  const request = JSON.parse(asked.stdout);
  assert.equal(request.kind, 'question');
  assert.equal(Object.hasOwn(request, 'triage'), false, 'the top-level request carries no triage');
  const all = areas();
  const { questions } = request.context.checkpoint;
  assert.equal(questions.length, all.length);
  for (const [i, question] of questions.entries()) {
    assert.equal(question.details, areaDetails(all[i], all), `${all[i].id}: the write-up, byte for byte`);
    assert.deepEqual(question.triage, AREA_TRIAGE, all[i].id);
  }
  assert.deepEqual(questions.map(question => question.default), [all[0].recommendation.alternative, undefined, all[2].recommendation.alternative],
    'the default is the recommendation, absent for the area left open');
  for (const question of request.questions) {
    assert.equal(Object.hasOwn(question, 'details'), false);
    assert.equal(Object.hasOwn(question, 'triage'), false);
  }

  // Under the built-in default nothing is classed.
  const plain = drivenRun(t);
  setOf(plain);
  const unclassed = JSON.parse(passed(ENGINE, ['gate-brief', `--state=${plain.state}`, `--node=${plain.node}`, '--request', `--patch-file=${plain.patch}`]).stdout);
  assert.ok(unclassed.context.checkpoint.questions.every(question => question.details && !Object.hasOwn(question, 'triage')));
});

test('area-brief --patch-file classes nothing under a policy swapped in after the freeze, and relays a refused one', t => {
  const swapped = drivenRun(t, { engine: scratchPlugin(t, { policy: CLASSING }), frozenBy: ENGINE });
  const result = setOf(swapped);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, `warning: policy-hash-mismatch:${swapped.node}\n`, 'one warning, not one per area');
  assert.ok(written(swapped).questions.every(question => !Object.hasOwn(question, 'triage')));

  const engine = scratchPlugin(t, { policy: { version: 2 } });
  const refused = drivenRun(t, { engine });
  const relayed = setOf(refused);
  assert.equal(relayed.code, 0, relayed.stderr);
  const file = path.join(path.dirname(path.dirname(engine)), 'policy/autonomy-policy.json');
  assert.equal(relayed.stderr, `warning: policy-refused:${file}:version\n`);
  assert.ok(written(refused).questions.every(question => !Object.hasOwn(question, 'triage')));
});

test('area-brief --patch-file on a fallback writes no patch file and prints nothing', t => {
  const run = drivenRun(t);
  fs.rmSync(path.join(run.dir, run.declared));
  const result = setOf(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `warning: decision-areas-missing:${run.declared}\n`);
  assert.equal(fs.existsSync(run.patch), false);
});

test('area-brief --patch-file whose write fails leaves no temp file and the place untouched', t => {
  const run = drivenRun(t);
  // A non-empty directory where the patch file goes: the entry point refuses
  // it as usage, so the module is called directly to reach the rename.
  const patch = path.join(run.dir, '.state-patch.json');
  fs.mkdirSync(patch);
  fs.writeFileSync(path.join(patch, 'keep'), 'kept');
  assert.throws(() => areaBrief({ state: run.state, node: run.node, form: 'set', patchFile: patch }));
  assert.deepEqual(fs.readdirSync(run.dir).filter(name => name.endsWith('.tmp')), [], 'no temp file left behind');
  assert.deepEqual(fs.readdirSync(patch), ['keep']);
  assert.equal(fs.readFileSync(path.join(patch, 'keep'), 'utf8'), 'kept');
});
