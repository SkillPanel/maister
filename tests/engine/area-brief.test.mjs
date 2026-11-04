import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENGINE, ENGINE_DIR, FIXTURES, briefOf, freeze, freezePatch, maskRoot, delegating, prerequisites, reach, readState, run as runScript, scratch, scratchPlugin, verb, write,
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

/** The pointer every form of the verb carries but a text-form fallback, appended after the renderer returns. */
const RULES = `${path.join(ENGINE_DIR, 'references/in-node-questions.md')} § Decision areas from the brainstorm`;

/**
 * A form's stdout without its pointer, which it must carry: the trailing
 * `rules:` paragraph of the write-up, or the `rules` key `--json` ends on. The
 * pointer holds an absolute path into the plugin, so the goldens are kept
 * without it.
 */
function withoutRules(stdout) {
  const key = `,\n  "rules": ${JSON.stringify(RULES)}\n}\n`;
  if (stdout.endsWith(key)) return `${stdout.slice(0, -key.length)}\n}\n`;
  assert.ok(stdout.endsWith(`\n\nrules: ${RULES}\n`), `no rules pointer at the end: ${stdout.slice(-200)}`);
  return briefOf(stdout);
}

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

/**
 * One fault per reason of the closed set: each a single change to a parsed
 * copy of `valid.json`, beside the `<reason> at <path>` it must be refused
 * with. `not-json` is the one fault that needs bytes, so it is a fixture.
 */
const FAULTS = [
  ['wrong-type at areas.0.alternatives.1.pros', doc => { doc.areas[0].alternatives[1].pros = 'No new service'; }],
  ['version at version', doc => { doc.version = 2; }],
  ['missing-key at areas.1.recommendation', doc => { delete doc.areas[1].recommendation; }],
  ['unknown-key at areas.1.alternatives.0.summary', doc => { doc.areas[1].alternatives[0].summary = 'A signed link.'; }],
  ['empty at areas.0.alternatives.0.cons', doc => { doc.areas[0].alternatives[0].cons = []; }],
  ['not-one-line at areas.2.question', doc => { doc.areas[2].question = 'Where does an owner\nshare a calendar from?'; }],
  ['bad-id at areas.1.id', doc => { doc.areas[1].id = 'Access'; }],
  ['duplicate at areas.2.depends_on.1', doc => { doc.areas[2].depends_on[1] = 'storage'; }],
  ['too-few at areas.1.alternatives', doc => { doc.areas[1].alternatives.length = 1; }],
  ['reserved-id at areas.2.alternatives.2.id', doc => { doc.areas[2].alternatives[2].id = 'more-details'; }],
  ['unknown-alternative at areas.0.recommendation.alternative', doc => { doc.areas[0].recommendation.alternative = 'same-database'; }],
  ['unknown-area at areas.2.depends_on.1', doc => { doc.areas[2].depends_on[1] = 'calendar'; }],
  ['depends-order at areas.0.depends_on.0', doc => { doc.areas[0].depends_on = ['access']; }],
  ['bad-path at source.path', doc => { doc.source.path = '../outputs/solution-exploration.md'; }],
  ['bad-digest at source.sha256', doc => { doc.source.sha256 = doc.source.sha256.toUpperCase(); }],
];

test('area-brief: the valid file passes and every invalid file gives its one located fault', () => {
  assert.equal(areas().length, 3);
  const reasons = new Set(['not-json', ...FAULTS.map(([fault]) => fault.split(' at ')[0])]);
  assert.equal(reasons.size, 16, 'one fault per reason of the closed set');
  assert.deepEqual(loadAreas({ file: fixture('not-json.json'), taskDir: AREAS }),
    { warning: 'decision-areas-invalid:not-json.json:not-json at (root)' });
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  for (const [fault, mutate] of FAULTS) {
    const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
    mutate(doc);
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: `decision-areas-invalid:decision-areas.json:${fault}` }, fault);
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

test('area-brief: an area may carry a visual bool, true or false, and loads', () => {
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  for (const visual of [true, false]) {
    const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
    doc.areas[0].visual = visual;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    assert.ok(loadAreas({ file, taskDir: dir }).areas, `visual: ${visual} did not load`);
  }
});

test('area-brief: a non-bool visual is refused wrong-type at areas.<n>.visual', () => {
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  for (const visual of ['yes', 1, null]) {
    const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
    doc.areas[1].visual = visual;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-invalid:decision-areas.json:wrong-type at areas.1.visual' }, String(visual));
  }
});

test('area-brief: investigate-first is a reserved alternative id, refused reserved-id', () => {
  const dir = scratchTask();
  const file = path.join(dir, 'decision-areas.json');
  const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
  doc.areas[2].alternatives[2].id = 'investigate-first';
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  assert.deepEqual(loadAreas({ file, taskDir: dir }), { warning: 'decision-areas-invalid:decision-areas.json:reserved-id at areas.2.alternatives.2.id' });
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
        assert.match(rest, /^[\s*\-.,…]*$/, `${area.id} ${profile}: ${JSON.stringify(rest)} is the module's own wording`);
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
    markdown: 'outputs/solution-exploration.md',
  },
  'product-design': {
    definition: path.join(ENGINE_DIR, 'workflows/product-design.yml'),
    inputs: { task_description: 'Share a calendar with guests.' },
    producer: 'alternatives',
    node: 'convergence',
    declared: 'analysis/decision-areas.json',
    markdown: 'analysis/alternatives.md',
  },
};

/**
 * The valid fixture's areas at `run`'s declared path, stamped from the
 * markdown the brainstorm declares beside them: `source.md`'s bytes, copied
 * to that path, which the file's `source.path` names.
 */
function placeAreas(run, spec) {
  const doc = JSON.parse(fs.readFileSync(fixture('valid.json'), 'utf8'));
  doc.source.path = spec.markdown;
  for (const relative of [spec.declared, spec.markdown]) fs.mkdirSync(path.join(run.dir, path.dirname(relative)), { recursive: true });
  fs.writeFileSync(path.join(run.dir, spec.declared), `${JSON.stringify(doc, null, 2)}\n`);
  fs.copyFileSync(fixture('source.md'), path.join(run.dir, spec.markdown));
}

/**
 * A run of `workflow` frozen and walked to its convergence node: the producer
 * `producer`, the convergence node `asking`, and — unless `file` is false —
 * the valid fixture's areas at the declared path, stamped from the declared markdown.
 */
function atConvergence(t, { workflow = 'research', producer = 'completed', asking = 'running', file = true } = {}) {
  const spec = WORKFLOWS[workflow];
  const run = scratch(t, { type: workflow, name: `2026-10-10-${workflow}-areas` });
  freeze(run, { definition: spec.definition, inputs: spec.inputs });
  reach(run, { nodes: { [spec.producer]: { status: producer }, [spec.node]: { status: asking } } });
  if (file) placeAreas(run, spec);
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

test('area-brief: the refusal list is exactly the codes the verb raises, each with a recovery row in the in-node questions reference', () => {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/area-brief.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(area-brief-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'references/in-node-questions.md'), 'utf8');
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
  fs.symlinkSync(path.join(run.dir, run.markdown), patch);
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
      warning: 'decision-areas-stale:outputs/decision-areas.json:outputs/solution-exploration.md',
      setup: run => fs.appendFileSync(path.join(run.dir, run.markdown), '\nEdited after the stamp.\n'),
    },
    // Fresh against the markdown it names, but that is not the one the
    // brainstorm declares: read as stale, never briefed.
    {
      warning: 'decision-areas-stale:outputs/decision-areas.json:source.md:source-not-declared',
      setup: run => {
        const file = path.join(run.dir, run.declared);
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        doc.source.path = 'source.md';
        fs.writeFileSync(file, JSON.stringify(doc));
        fs.copyFileSync(fixture('source.md'), path.join(run.dir, 'source.md'));
      },
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
    assert.deepEqual(JSON.parse(json.stdout), { ok: true, fallback: true, errors: [], warnings: [warning], rules: RULES });
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
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, fallback: true, errors: [], warnings: [warning], rules: RULES });
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
    const printed = maskRoot(withoutRules(result.stdout), run.root);
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

test('area-brief --ask: the call alone, built from the plain picker — every alternative titled, the recommendation marked, More details last', t => {
  const run = atConvergence(t);
  const asked = brief(run, ['--area=storage', '--ask']);
  assert.equal(asked.code, 0, asked.stderr);
  const call = JSON.parse(asked.stdout);
  assert.deepEqual(Object.keys(call), ['message', 'requestedSchema'], 'the whole output is the call');
  const plain = JSON.parse(brief(run, ['--area=storage', '--json', '--picker=plain']).stdout);
  assert.equal(call.message, plain.question);
  const decision = call.requestedSchema.properties.decision;
  assert.equal(decision.title, plain.header);
  assert.deepEqual(decision.oneOf, plain.options.map(option => ({ const: option.id, title: option.label })));
  assert.equal(decision.oneOf.at(-1).const, 'more-details');
  assert.equal(decision.default, plain.options.find(option => option.recommended).id);
  const details = brief(run, ['--area=storage', '--ask', '--details']);
  assert.equal(details.stdout.trimEnd(), plain.more_details.trimEnd());
  // Control: --ask takes no --json, and --details needs --ask.
  assert.equal(brief(run, ['--area=storage', '--ask', '--json']).code, 2);
  assert.equal(brief(run, ['--area=storage', '--details']).code, 2);
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
function drivenRun(t, { engine = ENGINE, frozenBy = engine, spec = WORKFLOWS.research } = {}) {
  const type = path.basename(spec.definition, '.yml');
  const run = scratch(t, { type, name: `2026-10-10-${type}-driven` });
  const { patch } = freezePatch({ definition: spec.definition, inputs: spec.inputs, orchestrator: { driver: DRIVER } });
  passed(frozenBy, ['write-state', `--state=${run.state}`], patch);
  const ahead = Object.fromEntries(prerequisites(run, [spec.producer]).map(id => [id, { status: 'completed' }]));
  passed(engine, ['write-state', `--state=${run.state}`], delegating({ nodes: ahead }, run));
  passed(engine, ['write-state', `--state=${run.state}`], { nodes: { [spec.producer]: { status: 'completed' }, [spec.node]: { status: 'running' } } });
  placeAreas(run, spec);
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
  assert.equal(briefOf(result.stdout), `${run.patch}\n`, 'the file prints its own path as one line');
  const text = maskRoot(fs.readFileSync(run.patch, 'utf8'), run.root);
  const file = path.join(GOLDEN, 'set.json');
  if (process.env.SNAPSHOT_AREAS === '1') fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, 'utf8'), 'set.json moved; regenerate with SNAPSHOT_AREAS=1 and review it');

  const set = written(run);
  assert.deepEqual(Object.keys(set), ['questions'], 'no ask and no headline: the request generates them');
  const all = areas();
  assert.deepEqual(set.questions.map(question => question.id), all.map(area => `convergence-decisions-${area.id}`));
  for (const [i, question] of set.questions.entries()) {
    const { evidence, ...entry } = question;
    assert.deepEqual(entry, areaEntry(all[i], all), all[i].id);
    const recommends = question.options.some(option => option.recommended);
    assert.deepEqual(evidence, recommends ? ['outputs/solution-exploration.md'] : undefined,
      'an area with a recommendation names the brainstorm it was argued in; one without names nothing');
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

test('area-brief --patch-file whose write fails warns unwritable, writes nothing and leaves the place untouched', t => {
  const run = drivenRun(t);
  // A non-empty directory where the patch file goes: the entry point refuses
  // it as usage, so the module is called directly to reach the rename.
  const patch = path.join(run.dir, '.state-patch.json');
  fs.mkdirSync(patch);
  fs.writeFileSync(path.join(patch, 'keep'), 'kept');
  const result = areaBrief({ state: run.state, node: run.node, form: 'set', patchFile: patch });
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^decision-areas-unwritable:\.state-patch\.json:E[A-Z]+$/);
  assert.equal(Object.hasOwn(result, 'file'), false, 'nothing to print');
  assert.deepEqual(fs.readdirSync(run.dir).filter(name => name.endsWith('.tmp')), [], 'no temp file left behind');
  assert.deepEqual(fs.readdirSync(patch), ['keep']);
  assert.equal(fs.readFileSync(path.join(patch, 'keep'), 'utf8'), 'kept');
});

test('area-brief --patch-file meeting a live writer\'s temp warns unwritable through the verb, exit 0, and leaves that temp alone', t => {
  const run = drivenRun(t);
  const tmp = `${run.patch}.tmp`;
  fs.writeFileSync(tmp, 'another writer');
  const result = setOf(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'warning: decision-areas-unwritable:.state-patch.json:EEXIST\n');
  assert.equal(fs.readFileSync(tmp, 'utf8'), 'another writer');
  assert.equal(fs.existsSync(run.patch), false);
});

test('area-brief --patch-file never writes through a link planted at its temp path', t => {
  const run = drivenRun(t);
  const target = path.join(run.root, 'elsewhere.txt');
  fs.writeFileSync(target, 'untouched');
  const tmp = `${run.patch}.tmp`;
  fs.symlinkSync(target, tmp);
  // A link as young as a live writer's temp is left where it is.
  const held = setOf(run);
  assert.equal(held.code, 0, held.stderr);
  assert.equal(held.stderr, 'warning: decision-areas-unwritable:.state-patch.json:EEXIST\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.equal(fs.existsSync(run.patch), false);
  // One old enough to be a leftover is removed, never opened: the link goes, its target stays.
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(target, old, old);
  const reclaimed = setOf(run);
  assert.equal(reclaimed.code, 0, reclaimed.stderr);
  assert.equal(reclaimed.stderr, '');
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
  assert.equal(written(run).questions.length, 3);
  assert.equal(fs.existsSync(tmp), false);
});

// ---------------------------------------------------------------------------
// the sketches opt-in: a node whose `with:` names a mockup folder carries each
// area's sketch lines and "Investigate first". The shipped research definition
// does not name one, so these freeze a scratch copy of it that does.
// ---------------------------------------------------------------------------

const MOCKUPS = 'analysis/mockups';
const INVESTIGATE = 'Investigate first: answer in your own words starting with “Check” and what to look at; it is checked from the code or the docs, then this is asked again.';

/** A scratch copy of research's definition, its prose beside it, whose convergence node's `with:` names `sketches`. */
function optInDefinition(t, sketches = MOCKUPS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'area-brief-opt-in-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { definition } = WORKFLOWS.research;
  const text = fs.readFileSync(definition, 'utf8');
  const edited = text.replace(/^ {6}decision_areas: "\$\{solution-generation\.artifacts\.decision_areas\}"\n/m,
    line => `${line}      sketches: ${JSON.stringify(sketches)}\n`);
  assert.notEqual(edited, text, 'the copy names sketches');
  const file = path.join(dir, 'research.yml');
  fs.writeFileSync(file, edited);
  fs.copyFileSync(definition.replace(/\.yml$/, '.md'), path.join(dir, 'research.md'));
  return file;
}

/** The run's areas file rewritten with `visual` areas marked and `edit` applied: a stamped copy, never the fixture. */
function markAreas(run, visual, edit) {
  const file = path.join(run.dir, run.declared);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const area of doc.areas) if (visual.includes(area.id)) area.visual = true;
  edit?.(doc);
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}

/** A research run at its convergence node, frozen from the opt-in copy, with `visual` areas marked. */
function sketchRun(t, { sketches = MOCKUPS, visual = ['storage'], edit } = {}) {
  const spec = { ...WORKFLOWS.research, definition: optInDefinition(t, sketches) };
  const run = { ...scratch(t, { type: 'research', name: '2026-10-10-research-sketches' }), ...spec };
  freeze(run, { definition: spec.definition, inputs: spec.inputs });
  reach(run, { nodes: { [spec.producer]: { status: 'completed' }, [spec.node]: { status: 'running' } } });
  placeAreas(run, spec);
  markAreas(run, visual, edit);
  return run;
}

/** Where a file of the mockup folder opens from: the repository-relative path the lines must print. */
function shownPath(run, name) {
  return path.relative(run.root, path.join(run.dir, MOCKUPS, name)).split(path.sep).join('/');
}

/** The pages named, in the mockup folder, as `<area id>-<alternative id>.html`. */
function drawPages(run, ...slugs) {
  const dir = path.join(run.dir, MOCKUPS);
  fs.mkdirSync(dir, { recursive: true });
  for (const slug of slugs) fs.writeFileSync(path.join(dir, `${slug}.html`), '<!doctype html>\n');
}

/** `versions/index.json` naming `latest`, with the version's gallery page unless `page` is false. */
function drawGallery(run, { latest = 'v002', page = true } = {}) {
  const dir = path.join(run.dir, MOCKUPS, 'versions');
  fs.mkdirSync(path.join(dir, latest), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ latest, versions: [] }));
  if (page) fs.writeFileSync(path.join(dir, latest, 'index.html'), '<!doctype html>\n');
}

const STORAGE_PAGES = ['storage-same-db', 'storage-hosted-api', 'storage-own-service', 'storage-document-store'];

function pickerOf(run, area, profile = 'rich') {
  const result = brief(run, [`--area=${area}`, '--json', `--picker=${profile}`]);
  assert.equal(result.code, 0, result.stderr);
  return { picker: JSON.parse(result.stdout), stderr: result.stderr };
}

test('sketches: a visual area names each alternative\'s page in picker order, and the gallery, on every surface', t => {
  const run = sketchRun(t);
  drawPages(run, ...STORAGE_PAGES);
  drawGallery(run);
  const all = areas();
  const added = [
    `Sketches: Same database — ${shownPath(run, 'storage-same-db.html')}`
      + ` · Hosted calendar API — ${shownPath(run, 'storage-hosted-api.html')}`
      + ` · Own service — ${shownPath(run, 'storage-own-service.html')}`
      + ` · Document store — ${shownPath(run, 'storage-document-store.html')}`,
    `Gallery: ${shownPath(run, 'versions/v002/index.html')}`,
    INVESTIGATE,
  ];
  assert.ok(!added[0].includes(run.root), 'the paths are repository-relative');

  // Rich: after the alternatives and "Also considered"; the options as they were, three and More details.
  const plainForm = areaPicker(all[0], all, 'plain');
  const richForm = areaPicker(all[0], all, 'rich');
  const { picker: rich, stderr } = pickerOf(run, 'storage');
  assert.equal(stderr, '');
  assert.deepEqual(rich.warnings, []);
  assert.equal(rich.question, [richForm.question, ...added].join('\n'));
  assert.deepEqual(rich.options.map(option => option.id), richForm.options.map(option => option.id));
  assert.deepEqual(rich.options.slice(0, -1), richForm.options.slice(0, -1));

  // Plain: before the recommendation, which stays last.
  const { picker: plain } = pickerOf(run, 'storage', 'plain');
  const opening = plainForm.question.split('\n');
  const last = opening.pop();
  assert.equal(plain.question, [...opening, ...added, last].join('\n'));
  assert.match(last, /^Recommended: /);

  // The write-up closes with the same lines, in both profiles and from the verb.
  const closing = added.join('\n');
  assert.equal(rich.more_details, `${areaDetails(all[0], all)}\n\n${closing}`);
  assert.equal(plain.more_details, rich.more_details);
  assert.equal(rich.options.at(-1).preview.endsWith(closing), true, 'the More details preview is the write-up');
  const writeUp = brief(run, ['--area=storage']);
  assert.equal(writeUp.code, 0, writeUp.stderr);
  assert.equal(briefOf(writeUp.stdout), `${rich.more_details}\n`);
  const details = brief(run, ['--area=storage', '--ask', '--details']);
  assert.equal(details.stdout.trimEnd(), rich.more_details);
});

test('sketches: two visual areas offering one alternative id each name their own page', t => {
  const run = sketchRun(t, {
    visual: ['storage', 'access'],
    edit: doc => { doc.areas[1].alternatives[0].id = 'same-db'; doc.areas[1].alternatives[0].title = 'Shared link'; },
  });
  drawPages(run, 'storage-same-db', 'access-same-db');
  const storage = pickerOf(run, 'storage').picker.question.split('\n');
  const access = pickerOf(run, 'access').picker.question.split('\n');
  assert.ok(storage.includes(`Sketches: Same database — ${shownPath(run, 'storage-same-db.html')}`), storage.join('\n'));
  assert.ok(access.includes(`Sketches: Shared link — ${shownPath(run, 'access-same-db.html')}`), access.join('\n'));
});

test('sketches: an area not marked visual gains Investigate first only, whatever the folder holds', t => {
  const run = sketchRun(t, { visual: ['storage'] });
  drawPages(run, 'access-signed-link', ...STORAGE_PAGES);
  drawGallery(run);
  const all = areas();
  const { picker, stderr } = pickerOf(run, 'access');
  assert.equal(stderr, '', 'a non-visual area has no page to miss');
  assert.equal(picker.question, `${areaPicker(all[1], all, 'rich').question}\n${INVESTIGATE}`);
  assert.equal(picker.more_details, `${areaDetails(all[1], all)}\n\n${INVESTIGATE}`);
});

test('sketches: a missing page drops that alternative alone; no page at all warns once and the area still renders', t => {
  const run = sketchRun(t);
  drawPages(run, 'storage-hosted-api', 'storage-document-store');
  const partial = pickerOf(run, 'storage');
  assert.equal(partial.stderr, '', 'one page missing names the others, with no warning');
  assert.ok(partial.picker.question.split('\n').includes(
    `Sketches: Hosted calendar API — ${shownPath(run, 'storage-hosted-api.html')} · Document store — ${shownPath(run, 'storage-document-store.html')}`));

  // The folder absent, then present with nothing of this area's.
  const warning = `area-sketches-missing:${MOCKUPS}:storage`;
  const all = areas();
  for (const setup of [() => {}, other => { drawPages(other, 'access-signed-link'); drawGallery(other); }]) {
    const empty = sketchRun(t);
    setup(empty);
    const { picker, stderr } = pickerOf(empty, 'storage');
    assert.equal(stderr, `warning: ${warning}\n`);
    assert.deepEqual(picker.warnings, [warning]);
    assert.equal(picker.fallback, undefined, 'the question is still rendered from the file, never a fallback');
    assert.equal(picker.question, `${areaPicker(all[0], all, 'rich').question}\n${INVESTIGATE}`, 'no sketch line');
    const writeUp = brief(empty, ['--area=storage']);
    assert.equal(writeUp.stderr, `warning: ${warning}\n`);
    assert.ok(briefOf(writeUp.stdout).trimEnd().endsWith(INVESTIGATE));
    const ask = brief(empty, ['--area=storage', '--ask']);
    assert.equal(ask.stderr, `warning: ${warning}\n`);
    assert.equal(JSON.parse(ask.stdout).message.includes(INVESTIGATE), true);
  }

  // A gallery whose page is not on disk, or an index that cannot be read, names no gallery and warns nothing.
  const noPage = sketchRun(t);
  drawPages(noPage, 'storage-same-db');
  drawGallery(noPage, { page: false });
  assert.doesNotMatch(pickerOf(noPage, 'storage').picker.question, /Gallery:/);
  const badIndex = sketchRun(t);
  drawPages(badIndex, 'storage-same-db');
  fs.mkdirSync(path.join(badIndex.dir, MOCKUPS, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(badIndex.dir, MOCKUPS, 'versions/index.json'), '{');
  const unread = pickerOf(badIndex, 'storage');
  assert.doesNotMatch(unread.picker.question, /Gallery:/);
  assert.equal(unread.stderr, '');
});

test('sketches: a value that is no literal task-relative path warns invalid, with no sketch lines and Investigate first still shown', t => {
  const invalid = ['../mockups', '/abs/mockups', 'analysis/../mockups', 'analysis\\mockups', '${solution-generation.artifacts.exploration}'];
  for (const sketches of invalid) {
    const run = sketchRun(t, { sketches });
    drawPages(run, ...STORAGE_PAGES);
    drawGallery(run);
    const warning = `area-sketches-invalid:${sketches}`;
    const { picker, stderr } = pickerOf(run, 'storage');
    assert.equal(stderr, `warning: ${warning}\n`, sketches);
    assert.deepEqual(picker.warnings, [warning], sketches);
    assert.doesNotMatch(picker.question, /Sketches:|Gallery:/, sketches);
    assert.ok(picker.question.endsWith(INVESTIGATE), sketches);
    assert.ok(picker.more_details.endsWith(INVESTIGATE), sketches);
    const plain = pickerOf(run, 'storage', 'plain').picker;
    assert.ok(plain.options.some(option => option.id === 'investigate-first'), sketches);
    assert.equal(brief(run, ['--area=storage']).stderr, `warning: ${warning}\n`, sketches);
    const patch = path.join(run.dir, '.state-patch.json');
    assert.equal(brief(run, [`--patch-file=${patch}`]).stderr, `warning: ${warning}\n`, `${sketches}: once for the whole set`);
    for (const question of JSON.parse(fs.readFileSync(patch, 'utf8')).questions) {
      assert.ok(question.why.endsWith(`\n${INVESTIGATE}`), `${sketches}: ${question.id}`);
      assert.doesNotMatch(question.why, /Sketches:|Gallery:/, `${sketches}: ${question.id}`);
    }
  }
});

test('sketches: an ASCII folder names each alternative by the flat document\'s anchor, and has no gallery', t => {
  const run = sketchRun(t);
  const dir = path.join(run.dir, MOCKUPS);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ascii-mockups.md'), [
    '# Mockups', '', '<a id="storage-own-service"></a>', '### Own service', '',
    '<a id="storage-same-db"></a>', '### Same database', '', 'storage-hosted-api is named here, with no anchor of its own.',
  ].join('\n'));
  const { picker, stderr } = pickerOf(run, 'storage');
  assert.equal(stderr, '');
  const flat = shownPath(run, 'ascii-mockups.md');
  assert.ok(picker.question.split('\n').includes(
    `Sketches: Same database — ${flat}#storage-same-db · Own service — ${flat}#storage-own-service`), picker.question);
  assert.doesNotMatch(picker.question, /Gallery:/);

  const none = sketchRun(t);
  fs.mkdirSync(path.join(none.dir, MOCKUPS), { recursive: true });
  fs.writeFileSync(path.join(none.dir, MOCKUPS, 'ascii-mockups.md'), '<a id="access-signed-link"></a>\n');
  assert.equal(pickerOf(none, 'storage').stderr, `warning: area-sketches-missing:${MOCKUPS}:storage\n`);
});

test('sketches: the plain picker offers investigate-first before More details and --ask gains the optional check property; rich takes no slot', t => {
  const run = sketchRun(t);
  drawPages(run, 'storage-same-db');
  const { picker: plain } = pickerOf(run, 'storage', 'plain');
  assert.deepEqual(plain.options.map(option => option.id),
    ['same-db', 'hosted-api', 'own-service', 'document-store', 'investigate-first', 'more-details']);
  assert.deepEqual(plain.options.at(-2), { id: 'investigate-first', label: 'Investigate first', recommended: false });

  const asked = brief(run, ['--area=storage', '--ask']);
  assert.equal(asked.code, 0, asked.stderr);
  const call = JSON.parse(asked.stdout);
  assert.deepEqual(Object.keys(call), ['message', 'requestedSchema']);
  assert.equal(call.message, plain.question);
  const { properties, required } = call.requestedSchema;
  assert.deepEqual(Object.keys(properties), ['decision', 'check']);
  assert.deepEqual(properties.check, { type: 'string', title: 'What to check' });
  assert.deepEqual(required, ['decision'], 'the choice alone is required');
  assert.deepEqual(properties.decision.oneOf.at(-2), { const: 'investigate-first', title: 'Investigate first' });
  assert.equal(properties.decision.default, 'same-db');

  const { picker: rich } = pickerOf(run, 'storage');
  assert.deepEqual(rich.options.map(option => option.id), ['same-db', 'hosted-api', 'own-service', 'more-details']);

  // Without the key the call is what it was: one property, no check, no option.
  const before = atConvergence(t);
  const form = JSON.parse(brief(before, ['--area=storage', '--ask']).stdout);
  assert.deepEqual(Object.keys(form.requestedSchema.properties), ['decision']);
  assert.ok(!form.requestedSchema.properties.decision.oneOf.some(option => option.const === 'investigate-first'));
  assert.doesNotMatch(form.message, /Investigate first/);
});

test('sketches: the set form ends each why with the lines and writes allow_other, and gate-brief --request takes it', t => {
  const spec = { ...WORKFLOWS.research, definition: optInDefinition(t) };
  const run = drivenRun(t, { spec });
  markAreas(run, ['storage', 'sharing-screen']);
  drawPages(run, 'storage-same-db', 'storage-own-service');
  drawGallery(run);
  const set = setOf(run);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(set.stderr, `warning: area-sketches-missing:${MOCKUPS}:sharing-screen\n`, 'one warning, for the visual area with no page');

  const all = areas();
  const storageLines = [
    `Sketches: Same database — ${shownPath(run, 'storage-same-db.html')} · Own service — ${shownPath(run, 'storage-own-service.html')}`,
    `Gallery: ${shownPath(run, 'versions/v002/index.html')}`,
    INVESTIGATE,
  ];
  const expected = {
    storage: storageLines,
    access: [INVESTIGATE],
    'sharing-screen': [INVESTIGATE],
  };
  const { questions } = written(run);
  for (const [i, question] of questions.entries()) {
    const area = all[i];
    const entry = areaEntry(area, all);
    const lines = expected[area.id];
    assert.equal(question.why, [entry.why, ...lines].join('\n'), area.id);
    assert.equal(question.allow_other, true, area.id);
    assert.deepEqual(question.options, entry.options, `${area.id}: the options as they were`);
    assert.equal(question.details, `${entry.details}\n\n${lines.join('\n')}`, area.id);
  }

  const asked = passed(run.engine, ['gate-brief', `--state=${run.state}`, `--node=${run.node}`, '--request', `--patch-file=${run.patch}`]);
  const request = JSON.parse(asked.stdout);
  assert.equal(request.kind, 'question');
  const checkpoint = request.context.checkpoint.questions;
  assert.equal(checkpoint.length, all.length);
  for (const [i, question] of checkpoint.entries()) {
    const lines = expected[all[i].id];
    assert.ok(question.why.endsWith(lines.join('\n')), all[i].id);
    assert.equal(question.allow_other, true, all[i].id);
    assert.ok(question.details.endsWith(lines.join('\n')), all[i].id);
  }
});

test('sketches: the opt-in renders add only the fixed labels and the paths read from disk', t => {
  const run = sketchRun(t, { visual: ['storage', 'sharing-screen'] });
  drawPages(run, ...STORAGE_PAGES);
  drawGallery(run);
  const all = areas();
  const words = new Set();
  const collect = value => {
    if (typeof value === 'string') { words.add(value); words.add(value.replace(/`/g, '')); }
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(all);
  const paths = [
    ...STORAGE_PAGES.map(slug => shownPath(run, `${slug}.html`)),
    shownPath(run, 'versions/v002/index.html'),
  ];
  const pieces = [...words, ...FIXED_LABELS, ...paths].sort((a, b) => b.length - a.length);
  const bare = text => {
    let rest = text;
    for (const piece of pieces) rest = rest.split(piece).join('');
    return rest;
  };
  for (const area of all) {
    for (const profile of ['rich', 'plain']) {
      const { picker } = pickerOf(run, area.id, profile);
      const shown = [picker.question, picker.more_details, ...picker.options.flatMap(option => [option.label, option.description ?? '', option.preview ?? ''])];
      for (const text of shown) assert.match(bare(text), /^[\s*\-.,…]*$/, `${area.id} ${profile}: ${JSON.stringify(bare(text))} is the module's own wording`);
    }
  }
  const driven = drivenRun(t, { spec: { ...WORKFLOWS.research, definition: optInDefinition(t) } });
  markAreas(driven, ['storage']);
  setOf(driven);
  for (const question of written(driven).questions) {
    for (const text of [question.why, question.details]) assert.match(bare(text), /^[\s*\-.,…]*$/, `${question.id}: ${JSON.stringify(bare(text))}`);
  }
});

test('sketches: the shipped product design\'s convergence names the folder it draws into, and warns when nothing was drawn', t => {
  const run = atConvergence(t, { workflow: 'product-design' });
  markAreas(run, ['storage']);
  const missing = pickerOf(run, 'storage');
  assert.equal(missing.stderr, `warning: area-sketches-missing:${MOCKUPS}:storage\n`, 'what a run that drew nothing relays');
  assert.ok(missing.picker.question.endsWith(INVESTIGATE));

  drawPages(run, 'storage-same-db');
  drawGallery(run);
  const { picker, stderr } = pickerOf(run, 'storage');
  assert.equal(stderr, '');
  assert.equal(picker.question, [
    areaPicker(areas()[0], areas(), 'rich').question,
    `Sketches: Same database — ${shownPath(run, 'storage-same-db.html')}`,
    `Gallery: ${shownPath(run, 'versions/v002/index.html')}`,
    INVESTIGATE,
  ].join('\n'));
});

/**
 * `request` answered as a driver does: the request file as the writer lands it,
 * then the answer block folded from the summary, as the resumed node sends it.
 */
function answerRequest(run, request, answers) {
  fs.mkdirSync(path.join(run.dir, 'gates'), { recursive: true });
  const lines = Object.entries({ ...request, answer: null }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  fs.writeFileSync(path.join(run.dir, `gates/${run.node}.request.yml`), `${lines.join('\n')}\n`);
  passed(run.engine, ['write-state', `--state=${run.state}`], {
    node_summaries: { [run.node]: { answer: { answers, answered_by: 'dana', at: '2026-01-05T09:12:00Z', via: 'cockpit' } } },
  });
}

test('sketches: under a driver a "Check" answer is held under its area\'s id, the follow-up round supersedes it, and one still checking when the rounds are spent is counted as given', t => {
  const run = drivenRun(t, { spec: WORKFLOWS['product-design'] });
  markAreas(run, ['storage']);
  drawPages(run, 'storage-same-db');
  // The route as a run records it, for the direction gate this closes on.
  passed(run.engine, ['write-state', `--state=${run.state}`], {
    nodes: {
      intake: { status: 'completed', values: { draws: true } },
      'problem-approval': { status: 'completed' },
      alternatives: { status: 'completed', values: { visual_areas: true } },
      sketches: { status: 'completed' },
    },
    node_summaries: { 'problem-approval': { decisions: [{ option: 'brief-with-screens' }] } },
  });
  const requestOf = flags => {
    const set = setOf(run, flags);
    assert.equal(set.code, 0, set.stderr);
    return JSON.parse(passed(run.engine, ['gate-brief', `--state=${run.state}`, `--node=${run.node}`, '--request', `--patch-file=${run.patch}`]).stdout);
  };
  const answersBy = id => readState(run).node_summaries[run.node].decisions.filter(item => item.question_id === id);
  const storage = 'convergence-decisions-storage';
  const access = 'convergence-decisions-access';
  const screen = 'convergence-decisions-sharing-screen';

  const first = requestOf([]);
  assert.equal(first.round, 1);
  const questions = first.context.checkpoint.questions;
  assert.deepEqual(questions.map(question => question.id), [storage, access, screen]);
  assert.ok(questions.every(question => question.allow_other === true));
  const worded = { [storage]: 'Check the calendars table first', [access]: 'Check how long a link lives' };
  answerRequest(run, first, { [storage]: { other: worded[storage] }, [access]: { other: worded[access] }, [screen]: 'settings-page' });
  for (const id of [storage, access]) {
    const [check, ...rest] = answersBy(id);
    assert.deepEqual(rest, [], id);
    assert.equal(check.answer, worded[id], 'recorded as given');
    assert.equal(check.by, 'operator');
    assert.notEqual(check.as_recommended, true);
    assert.equal(Object.hasOwn(check, 'round'), false, 'the first round stamps none');
  }

  // Asked again in one follow-up round, the same ids in the same words, so the fold replaces each.
  const second = requestOf(['--area=storage', '--area=access']);
  assert.equal(second.round, 2);
  const again = second.context.checkpoint.questions;
  assert.deepEqual(again.map(question => question.id), [storage, access]);
  assert.deepEqual(again.map(question => question.question), questions.slice(0, 2).map(question => question.question));
  answerRequest(run, second, { [storage]: 'hosted-api', [access]: { other: 'Check who may revoke a link' } });
  const [chosen, ...stale] = answersBy(storage);
  assert.deepEqual(stale, [], 'the investigation is superseded, its finding left to the area\'s record');
  assert.equal(chosen.answer, 'Hosted calendar API');
  assert.equal(chosen.round, 2);
  assert.deepEqual(answersBy(screen).map(item => item.answer), ['Settings page'], 'an area not asked again keeps its answer');

  // Still checking: the last round, then nothing more is asked and the last answer stands.
  const third = requestOf(['--area=access']);
  assert.equal(third.round, 3);
  answerRequest(run, third, { [access]: { other: 'Check the audit log' } });
  const spent = passed(run.engine, ['area-brief', `--state=${run.state}`, `--node=${run.node}`, `--patch-file=${run.patch}`, '--area=access']);
  assert.equal(spent.stderr, '');
  const refused = runScript(run.engine, ['gate-brief', `--state=${run.state}`, `--node=${run.node}`, '--request', `--patch-file=${run.patch}`]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^gate-brief-rounds-spent: /);

  passed(run.engine, ['write-state', `--state=${run.state}`], {
    nodes: { [run.node]: { status: 'completed' } },
    node_summaries: { [run.node]: {
      summary: 'Two areas chosen; one left open on its last check.',
      risks: [{ risk: 'access: undecided after three checks', tag: 'open', change: 'choose the signed link' }],
      decision_areas: [{ area: 'access', recommended: 'signed-link' }],
    } },
  });
  assert.deepEqual(answersBy(access).map(item => [item.answer, item.round]), [['Check the audit log', 3]]);
  const gate = JSON.parse(passed(run.engine, ['gate-brief', `--state=${run.state}`, '--node=direction-approval', '--checkpoint']).stdout);
  assert.equal(gate.decisions.operator.count, 3, 'one answer per area, the last check among them');
});

test('sketches: a run whose convergence names none keeps every form byte-identical to the renderers without the opt-in', t => {
  const run = atConvergence(t);
  markAreas(run, ['storage']);
  drawPages(run, ...STORAGE_PAGES);
  drawGallery(run);
  const all = areas();
  const { picker, stderr } = pickerOf(run, 'storage');
  assert.equal(stderr, '', 'a visual mark with no opt-in warns nothing');
  assert.equal(picker.question, areaPicker(all[0], all, 'rich').question);
  assert.equal(picker.more_details, areaDetails(all[0], all));
  const plain = pickerOf(run, 'storage', 'plain').picker;
  assert.deepEqual(plain.options, areaPicker(all[0], all, 'plain').options);
  assert.equal(Object.hasOwn(areaEntry(all[0], all), 'allow_other'), false);
});
