import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';
import { checkSet, questionRequest } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';
import { checkEvidence, repositoryOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/evidence.mjs';

// A question may name the files its recommendation rests on, `evidence`. The
// set carries the list as written; the brief checks it against the disk and
// emits each kept path repository-relative. A path it cannot keep is dropped
// with a warning and never keeps the question from being asked. Every path
// here is made up.

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };
const FINDING_REVIEW = path.join(FIXTURES, 'definitions/finding-review.yml');

function running(t) {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  return run;
}

/** A file under `base`, written so the check finds it. */
function onDisk(base, relative) {
  const file = path.join(base, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  return file;
}

function question(id, evidence) {
  return {
    id,
    question: `Which ${id}?`,
    options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }],
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function requested(run, set) {
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(set));
  return verb(['gate-brief', `--state=${run.state}`, '--node=analysis', '--request', `--patch-file=${file}`]);
}

const TASK = '.maister/tasks/development/2026-01-05-sample';

test('evidence: a run-relative and a repository-relative path are both kept, emitted repository-relative', t => {
  const run = running(t);
  onDisk(run.dir, 'analysis/findings.md');
  onDisk(run.root, 'docs/decisions/0001-storage.md');
  const result = requested(run, { questions: [question('storage', ['analysis/findings.md', 'docs/decisions/0001-storage.md', './analysis//findings.md'])] });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const request = JSON.parse(result.stdout);
  const expected = [`${TASK}/analysis/findings.md`, 'docs/decisions/0001-storage.md'];
  assert.deepEqual(request.questions[0].evidence, expected, 'normalised, each once, in the order given');
  assert.deepEqual(request.evidence, expected, 'the top level repeats the first question, as its question and options do');
  assert.deepEqual(request.context.checkpoint.questions[0].evidence, expected);
});

test('evidence: a missing path is dropped with a warning, and the question is still asked', t => {
  const run = running(t);
  onDisk(run.dir, 'spec.md');
  const result = requested(run, { questions: [question('storage', ['spec.md', 'analysis/absent.md'])] });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, 'warning: question-evidence-dropped:storage:analysis/absent.md:missing\n');
  assert.deepEqual(JSON.parse(result.stdout).questions[0].evidence, [`${TASK}/spec.md`]);
});

test('evidence: an absolute path and one leaving the repository are rejected; a list left empty is no key', t => {
  const run = running(t);
  const outside = path.join(path.dirname(run.root), 'secret.md');
  const result = requested(run, { questions: [question('storage', [outside, '../../../../../etc/passwd', '../../../../../', 7])] });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stderr.trimEnd().split('\n'), [
    `warning: question-evidence-dropped:storage:${outside}:absolute`,
    'warning: question-evidence-dropped:storage:../../../../../etc/passwd:outside-repository',
    'warning: question-evidence-dropped:storage:../../../../../:outside-repository',
    'warning: question-evidence-dropped:storage:7:not-a-path',
  ]);
  const request = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(request.questions[0], 'evidence'), false, 'absent reads as no evidence given');
  assert.equal(Object.hasOwn(request, 'evidence'), false);
});

test('evidence: a value that is not a list is dropped, never a refusal', t => {
  const run = running(t);
  const result = requested(run, { questions: [question('storage', 'spec.md')] });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, 'warning: question-evidence-dropped:storage:"spec.md":not-a-path\n');
});

test('evidence: an old-shape set is valid, and its request carries no evidence key', t => {
  const set = { questions: [question('storage'), question('access')] };
  const checked = checkSet(set);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal(Object.hasOwn(checked.set.questions[0], 'evidence'), false);
  const run = running(t);
  const result = requested(run, set);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const request = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(request), ['node', 'kind', 'question', 'context', 'options', 'multi_select', 'questions', 'round']);
  for (const each of request.questions) assert.deepEqual(Object.keys(each), ['id', 'question', 'options', 'multi_select']);
});

test('evidence: checkSet carries the list as written; questionRequest emits it only when it holds a path', () => {
  const checked = checkSet({ questions: [question('storage', ['x.md']), question('access', [])] });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.set.questions[0].evidence, ['x.md']);
  const request = questionRequest({ node: 'n', ask: 'Ask', questions: checked.set.questions });
  assert.deepEqual(request.questions[0].evidence, ['x.md']);
  assert.equal(Object.hasOwn(request.questions[1], 'evidence'), false);
});

test('evidence: the repository is the directory holding .maister; a run outside one is its own', t => {
  const run = scratch(t);
  assert.equal(repositoryOf(run.dir), run.root);
  assert.equal(repositoryOf(path.join(run.root, 'loose')), path.join(run.root, 'loose'));
  const { paths, warnings } = checkEvidence(['../elsewhere.md'], { runDir: path.join(run.root, 'loose'), where: 'q' });
  assert.deepEqual(paths, []);
  assert.deepEqual(warnings, ['question-evidence-dropped:q:../elsewhere.md:outside-repository']);
});

test('cites: finding-brief carries each finding\'s cites typed, its evidence only the report it cites a section of, never the findings list', t => {
  const run = scratch(t);
  freeze(run, { definition: FINDING_REVIEW, orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { review: { status: 'running' } } });
  onDisk(run.root, 'src/orders/submit-service.ts');
  onDisk(run.root, 'src/orders/checks.ts');
  onDisk(run.dir, 'verification/implementation-verification.md');
  const LIST = 'verification/verification-findings.json';
  const finding = (id, recommended, cites) => ({
    id, severity: 'warning', title: `Finding ${id}`, evidence: 'submit-service.ts:158-197 skips the checks',
    ...(cites === undefined ? {} : { cites }),
    options: [{ label: 'Fix it', description: 'Change the line' }], recommended, ...(recommended === null ? {} : { reason: 'It is cheap' }),
  });
  const findings = [
    finding('submit-checks', 0, [
      { path: 'src/orders/submit-service.ts', lines: { start: 158, end: 197 } },
      { path: 'src/orders/checks.ts', lines: { start: 12, end: 12 } },
      { path: 'src/orders/checks.ts', lines: { start: 40, end: 40 } },
      { path: 'verification/implementation-verification.md', section: 'issue-3-submit-checks' },
      { path: 'src/orders/gone.ts', lines: { start: 9, end: 9 } },
      { path: LIST },
      { path: 'src/orders/checks.ts', lines: { start: 12, end: 12 } },
    ]),
    finding('code-only', 0, [{ path: 'src/orders/checks.ts' }]),
    finding('no-view', null, [{ path: 'verification/implementation-verification.md', section: 'issue-5' }]),
    finding('cites-nothing', 0),
  ];
  onDisk(run.dir, LIST);
  fs.writeFileSync(path.join(run.dir, LIST), JSON.stringify({ findings }));
  const result = verb(['finding-brief', `--state=${run.state}`, '--node=review', `--findings-file=${LIST}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stderr.trimEnd().split('\n'), [
    'warning: question-cite-dropped:review-findings-submit-checks:src/orders/gone.ts:missing',
    `warning: question-cite-dropped:review-findings-submit-checks:${TASK}/${LIST}:findings-list`,
  ]);
  const set = JSON.parse(result.stdout);
  const byId = id => set.questions.find(each => each.id === `review-findings-${id}`);
  const report = `${TASK}/verification/implementation-verification.md`;
  const submit = byId('submit-checks');
  assert.deepEqual(submit.cites, [
    { path: 'src/orders/submit-service.ts', lines: { start: 158, end: 197 } },
    { path: 'src/orders/checks.ts', lines: { start: 12, end: 12 } },
    { path: 'src/orders/checks.ts', lines: { start: 40, end: 40 } },
    { path: report, section: 'issue-3-submit-checks' },
  ], 'each kept cite once, its path repository-relative');
  assert.deepEqual(submit.evidence, [report], 'evidence is the report a cite names a section of, as a plain path');
  assert.deepEqual(byId('code-only').cites, [{ path: 'src/orders/checks.ts' }]);
  assert.equal(Object.hasOwn(byId('code-only'), 'evidence'), false, 'no report section cited, no evidence');
  assert.deepEqual(byId('no-view').evidence, [report], 'a finding with no recommendation still carries what it cites');
  for (const key of ['evidence', 'cites']) assert.equal(Object.hasOwn(byId('cites-nothing'), key), false, `a finding that cites nothing carries no ${key}`);
  for (const question of set.questions) {
    assert.ok(!(question.evidence ?? []).some(each => each.endsWith(LIST)), 'the findings list is never evidence');
    assert.ok(!(question.cites ?? []).some(each => each.path.endsWith(LIST)), 'the findings list is never cited');
    for (const each of question.evidence ?? []) assert.doesNotMatch(each, /[:#]/, 'evidence is plain paths');
  }

  // The request built from the set carries the cites through its own check,
  // the top level repeating the first question's, as evidence does.
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify(set));
  const request = verb(['gate-brief', `--state=${run.state}`, '--node=review', '--request', `--patch-file=${patch}`]);
  assert.equal(request.code, 0, request.stderr);
  assert.equal(request.stderr, '');
  const sent = JSON.parse(request.stdout);
  const asked = sent.questions.find(each => each.id === 'review-findings-submit-checks');
  assert.deepEqual(asked.cites, submit.cites);
  assert.deepEqual(asked.evidence, [report]);
  assert.deepEqual(sent.cites, sent.questions[0].cites);
  assert.deepEqual(sent.context.checkpoint.questions.find(each => each.id === 'review-findings-submit-checks').cites, submit.cites);
});

test('cites: gate-brief drops a cite that is not the shape or names nothing, with a warning, and asks the question', t => {
  const run = running(t);
  onDisk(run.root, 'src/a.ts');
  const outside = path.join(path.dirname(run.root), 'secret.md');
  const result = requested(run, { questions: [{ ...question('storage', undefined), cites: [
    { path: 'src/a.ts', lines: { start: 3, end: 9 }, section: 'top' },
    { path: 'src/a.ts', lines: { start: 9, end: 3 } },
    { path: 'src/a.ts', lines: { start: 0, end: 0 } },
    { path: 'src/a.ts', lines: { start: 2 } },
    { path: 'src/a.ts', section: '#top' },
    { path: 'src/a.ts', line: 3 },
    'src/a.ts:3',
    { path: 'src/b.ts' },
    { path: outside },
  ] }] });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stderr.trimEnd().split('\n'), [
    'warning: question-cite-dropped:storage:src/a.ts:not-a-cite',
    'warning: question-cite-dropped:storage:src/a.ts:not-a-cite',
    'warning: question-cite-dropped:storage:src/a.ts:not-a-cite',
    'warning: question-cite-dropped:storage:src/a.ts:not-a-cite',
    'warning: question-cite-dropped:storage:src/a.ts:not-a-cite',
    'warning: question-cite-dropped:storage:"src/a.ts:3":not-a-cite',
    'warning: question-cite-dropped:storage:src/b.ts:missing',
    `warning: question-cite-dropped:storage:${outside}:absolute`,
  ]);
  const request = JSON.parse(result.stdout);
  assert.deepEqual(request.questions[0].cites, [{ path: 'src/a.ts', lines: { start: 3, end: 9 }, section: 'top' }]);
  assert.equal(Object.hasOwn(request.questions[0], 'evidence'), false);

  const none = requested(run, { questions: [{ ...question('storage', undefined), cites: [{ path: 'src/b.ts' }] }] });
  assert.equal(Object.hasOwn(JSON.parse(none.stdout).questions[0], 'cites'), false, 'a list left empty is no key');
  assert.equal(checkSet({ questions: [{ ...question('storage'), cites: 'anything' }] }).ok, true, 'the set carries cites as written; the brief judges them');
});
