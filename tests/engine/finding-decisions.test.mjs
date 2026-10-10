import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';
import { checkSet } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';
import { ACCEPT_OPTION, findingBrief } from '../../plugins/maister/skills/workflow-engine/scripts/lib/finding-brief.mjs';

// A reviewer's findings as the reviewing node's questions. The reviewer writes
// its findings as data — each with the fix it proposes, its alternatives and a
// recommendation — and `finding-brief` builds one question per finding, the
// accept-the-risk choice added, in severity order. A list the verb cannot use
// is a warning and nothing to paste; a wrong invocation is a refusal. Every
// finding here is made up.

const DEFINITION = path.join(FIXTURES, 'definitions/finding-review.yml');
const UNDECLARED = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const FINDINGS = 'verification/findings.json';

/** A run of `definition` frozen, with `node` running: the reviewing node, ready to ask. */
function reviewing(t, { definition = DEFINITION, node = 'review', status = 'running' } = {}) {
  const run = scratch(t);
  freeze(run, { definition });
  if (status !== null) write(run, { nodes: { [node]: { status } } });
  return { ...run, node, patch: path.join(run.dir, '.state-patch.json') };
}

/** A findings list in the shape a reviewer writes. */
function findingsList() {
  return {
    findings: [
      {
        id: 'slow-listing',
        severity: 'medium',
        title: 'Listing loads every row',
        evidence: 'src/list.ts:10 calls findAll() with no limit',
        options: [
          { label: 'Page the listing', description: 'Load fifty rows a page' },
          { label: 'Cap at a thousand', description: 'Stop at a thousand rows with a notice' },
        ],
        recommended: null,
      },
      {
        id: 'empty-upload',
        severity: 'critical',
        title: 'Server crashes on an empty upload',
        evidence: 'src/upload.ts:42 reads body.length of undefined',
        options: [{ label: 'Guard the empty body', description: 'Return 400 before reading the body' }],
        recommended: 0,
        reason: 'One guard closes the crash without changing valid uploads',
      },
      {
        id: 'log-noise',
        severity: 'info',
        title: 'Debug logging left on',
        evidence: 'src/log.ts:3 sets level to debug',
        options: [{ label: 'Set the level to info', description: 'Quiet logs in production' }],
        recommended: 'accept',
        reason: 'The noise costs nothing until the logs are shipped',
      },
      {
        id: 'missing-index',
        severity: 'critical',
        title: 'Lookup by email scans the table',
        evidence: 'migrations/004.sql adds users.email with no index',
        options: [{ label: 'Add the index', description: 'A unique index on users.email' }],
        recommended: 0,
        reason: 'Every login runs this lookup',
      },
    ],
  };
}

/** Write a findings list into the run, as `value` or as raw text. */
function place(run, value, relative = FINDINGS) {
  const file = path.join(run.dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

/** `finding-brief` through the entry point. */
function brief(run, { node = run.node, file = FINDINGS, patch = false } = {}) {
  const args = ['finding-brief', `--state=${run.state}`, `--node=${node}`, `--findings-file=${file}`];
  if (patch) args.push(`--patch-file=${run.patch}`);
  return verb(args);
}

/** The set printed on stdout, after a clean exit. */
function printed(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

/** A fallback: exit 0, nothing on stdout, the one warning on stderr. */
function fellBack(result, warning) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `warning: ${warning}\n`);
}

/** A refusal: exit 1, nothing on stdout, the code first on stderr and the message's promise kept. */
function refused(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}: `));
  assert.match(result.stderr, /Nothing was written\./);
}

const byId = (set, id) => set.questions.find(question => question.id === id);
const recommendedOf = question => question.options.filter(option => option.recommended).map(option => option.id);

// ---------------------------------------------------------------------------
// 1. the set built from a findings list
// ---------------------------------------------------------------------------

test('finding-brief: one question per finding, most severe first, the reviewer\'s choices then accept-risk', t => {
  const run = reviewing(t);
  place(run, findingsList());
  const set = printed(brief(run));
  assert.deepEqual(set.questions.map(question => question.id), [
    'review-findings-empty-upload',
    'review-findings-missing-index',
    'review-findings-slow-listing',
    'review-findings-log-noise',
  ]);
  for (const question of set.questions) {
    assert.equal(question.multi_select, false);
    assert.equal(Object.hasOwn(question, 'allow_other'), false, 'allow_other left at its default');
    assert.equal(Object.hasOwn(question, 'triage'), false, 'the verb never classes');
    assert.equal(Object.hasOwn(question, 'default'), false, 'the request generates the default');
    assert.deepEqual(question.options.at(-1).id, ACCEPT_OPTION.id);
    assert.equal(question.options.at(-1).label, 'Accept the risk and list it');
  }

  const crash = byId(set, 'review-findings-empty-upload');
  assert.deepEqual(crash.options.map(option => option.id), ['option-1', 'accept-risk']);
  assert.equal(crash.question, 'Server crashes on an empty upload — how should it be settled?');
  assert.equal(crash.why, 'Critical: src/upload.ts:42 reads body.length of undefined');
  assert.deepEqual(crash.options[0], {
    id: 'option-1',
    label: 'Guard the empty body',
    description: 'Return 400 before reading the body. Recommended: One guard closes the crash without changing valid uploads',
    recommended: true,
  });
  assert.match(crash.details, /src\/upload\.ts:42 reads body\.length of undefined/);
  assert.match(crash.details, /Return 400 before reading the body/);
  assert.match(crash.details, /Leave it as it is; it is listed as a tradeoff at the next checkpoint/);
  assert.match(crash.details, /\*\*Why recommended\*\*: One guard closes the crash/);

  const listing = byId(set, 'review-findings-slow-listing');
  assert.deepEqual(listing.options.map(option => option.id), ['option-1', 'option-2', 'accept-risk']);
  assert.deepEqual(recommendedOf(listing), [], 'a null recommendation recommends nothing');
  assert.equal(listing.why, 'Medium: src/list.ts:10 calls findAll() with no limit');

  const noise = byId(set, 'review-findings-log-noise');
  assert.deepEqual(recommendedOf(noise), ['accept-risk']);
  assert.equal(noise.options.at(-1).description,
    'Leave it as it is; it is listed as a tradeoff at the next checkpoint. Recommended: The noise costs nothing until the logs are shipped');
  assert.equal(noise.why, 'Info: src/log.ts:3 sets level to debug');

  const checked = checkSet(set);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(byId(checked.set, 'review-findings-empty-upload').default, 'option-1');
  assert.equal(Object.hasOwn(byId(checked.set, 'review-findings-slow-listing'), 'default'), false);
  assert.equal(byId(checked.set, 'review-findings-log-noise').default, 'accept-risk');
  for (const question of checked.set.questions) assert.ok([...question.header].length <= 12, question.header);
});

test('finding-brief --patch-file writes the set there and prints the file', t => {
  const run = reviewing(t);
  place(run, findingsList());
  const result = brief(run, { patch: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${run.patch}\n`);
  const written = JSON.parse(fs.readFileSync(run.patch, 'utf8'));
  assert.deepEqual(Object.keys(written), ['questions']);
  assert.deepEqual(written, printed(brief(run)));
  assert.deepEqual(fs.readdirSync(run.dir).filter(name => name.endsWith('.tmp')), []);
});

test('finding-brief reads a findings list named by an absolute path inside the run', t => {
  const run = reviewing(t);
  const file = place(run, findingsList(), 'review/list.json');
  assert.equal(printed(brief(run, { file })).questions.length, 4);
});

// ---------------------------------------------------------------------------
// 2. refusals, fallbacks
// ---------------------------------------------------------------------------

test('finding-brief refuses an unreadable state, an unknown node, a gate, a node not running and an undeclared id', t => {
  const run = reviewing(t);
  place(run, findingsList());

  refused(verb(['finding-brief', `--state=${path.join(run.dir, 'absent.yml')}`, '--node=review', `--findings-file=${FINDINGS}`]),
    'finding-brief-state-unreadable');
  refused(brief(run, { node: 'nowhere' }), 'finding-brief-unknown-node');
  refused(brief(run, { node: 'review-approval' }), 'finding-brief-unknown-node');

  const idle = reviewing(t, { status: null });
  place(idle, findingsList());
  refused(brief(idle), 'finding-brief-not-running');

  const other = reviewing(t, { definition: UNDECLARED, node: 'scoping' });
  place(other, findingsList());
  const undeclared = brief(other);
  refused(undeclared, 'finding-brief-undeclared');
  assert.match(undeclared.stderr, /"scoping-findings"/);
  assert.match(undeclared.stderr, /in-node-questions\.md/);
  assert.equal(fs.existsSync(other.patch), false);
});

test('finding-brief without --findings-file is a usage error', t => {
  const run = reviewing(t);
  const result = verb(['finding-brief', `--state=${run.state}`, '--node=review']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: finding-brief needs --findings-file/);
});

test('finding-brief: a missing list, or one outside the run, warns missing and pastes nothing', t => {
  const run = reviewing(t);
  fellBack(brief(run), `finding-list-missing:${FINDINGS}`);
  fellBack(brief(run, { file: '../elsewhere.json' }), 'finding-list-missing:../elsewhere.json:outside-run');
  fellBack(brief(run, { patch: true }), `finding-list-missing:${FINDINGS}`);
  assert.equal(fs.existsSync(run.patch), false);
});

/** One change to a parsed copy of the list, beside the detail it must be refused with. */
const SHAPES = [
  ['(root)', () => []],
  ['extra', doc => { doc.extra = true; }],
  ['findings', doc => { doc.findings = []; }],
  ['findings[1].severity', doc => { doc.findings[1].severity = 'severe'; }],
  ['findings[0].id', doc => { doc.findings[0].id = 'Slow listing'; }],
  ['findings[2].id', doc => { doc.findings[2].id = 'empty-upload'; }],
  ['findings[0].title', doc => { doc.findings[0].title = 'Two\nlines'; }],
  ['findings[0].evidence', doc => { doc.findings[0].evidence = ''; }],
  ['findings[0].options', doc => { doc.findings[0].options = []; }],
  ['findings[0].options[1].label', doc => { doc.findings[0].options[1].label = 'Page the listing'; }],
  ['findings[0].options[0].label', doc => { doc.findings[0].options[0].label = 'Accept the risk and list it'; }],
  ['findings[0].options[1].note', doc => { doc.findings[0].options[1].note = 'x'; }],
  ['findings[1].recommended', doc => { doc.findings[1].recommended = 1; }],
  ['findings[1].reason', doc => { delete doc.findings[1].reason; }],
  ['findings[3].priority', doc => { doc.findings[3].priority = 1; }],
];

test('finding-brief: a list that is not JSON or breaks the shape warns invalid with its first problem', t => {
  const run = reviewing(t);
  place(run, '{"findings": [');
  fellBack(brief(run), `finding-list-invalid:${FINDINGS}:not-json`);
  for (const [detail, mutate] of SHAPES) {
    const doc = findingsList();
    const changed = mutate(doc) ?? doc;
    place(run, changed);
    fellBack(brief(run), `finding-list-invalid:${FINDINGS}:${detail}`);
  }
  // Two violations: the first one is named.
  const doc = findingsList();
  doc.findings[0].severity = 'severe';
  doc.findings[2].title = '';
  place(run, doc);
  fellBack(brief(run, { patch: true }), `finding-list-invalid:${FINDINGS}:findings[0].severity`);
  assert.equal(fs.existsSync(run.patch), false);
});

test('finding-brief: a patch file it cannot write warns unwritable and leaves no temp', t => {
  const run = reviewing(t);
  place(run, findingsList());
  // A patch path in a directory that does not exist: the entry point refuses
  // it as usage, so the module is called directly to reach the write.
  const patch = path.join(run.dir, 'absent', '.state-patch.json');
  const result = findingBrief({ state: run.state, node: 'review', findingsFile: FINDINGS, patchFile: patch });
  assert.deepEqual(result, { ok: true, fallback: true, errors: [], warnings: ['finding-list-unwritable:absent/.state-patch.json:ENOENT'] });

  // A live writer's temp, through the verb.
  const tmp = `${run.patch}.tmp`;
  fs.writeFileSync(tmp, 'another writer');
  fellBack(brief(run, { patch: true }), 'finding-list-unwritable:.state-patch.json:EEXIST');
  assert.equal(fs.readFileSync(tmp, 'utf8'), 'another writer');
  assert.equal(fs.existsSync(run.patch), false);
});
