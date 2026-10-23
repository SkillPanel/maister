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
  assert.deepEqual(Object.keys(request), ['node', 'kind', 'question', 'context', 'options', 'multi_select', 'questions']);
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

test('evidence: finding-brief names the findings list on each finding it recommends on', t => {
  const run = scratch(t);
  freeze(run, { definition: FINDING_REVIEW });
  write(run, { nodes: { review: { status: 'running' } } });
  const finding = (id, recommended) => ({
    id, severity: 'medium', title: `Finding ${id}`, evidence: 'src/a.ts:1',
    options: [{ label: 'Fix it', description: 'Change the line' }], recommended, ...(recommended === null ? {} : { reason: 'It is cheap' }),
  });
  onDisk(run.dir, 'verification/findings.json');
  fs.writeFileSync(path.join(run.dir, 'verification/findings.json'), JSON.stringify({ findings: [finding('one', 0), finding('two', null)] }));
  const result = verb(['finding-brief', `--state=${run.state}`, '--node=review', '--findings-file=verification/findings.json']);
  assert.equal(result.code, 0, result.stderr);
  const set = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('}') + 1));
  const byId = id => set.questions.find(each => each.id === `review-findings-${id}`);
  assert.deepEqual(byId('one').evidence, ['verification/findings.json']);
  assert.equal(Object.hasOwn(byId('two'), 'evidence'), false, 'no recommendation, no evidence');
});
