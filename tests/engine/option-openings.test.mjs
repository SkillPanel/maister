import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, scratch, verb, write } from '../helpers.mjs';
import { checkSet, sharedOpenings } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// Each option of a question opens with what sets it apart. Two options whose
// labels share their first three words read as one option to someone scanning
// the list, so the set is asked as written with an `option-openings-shared`
// warning, never refused. Every question here is made up.

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

function running(t) {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  return run;
}

function question(id, labels) {
  return { id, question: `How should ${id} go?`, options: labels.map((label, index) => ({ id: `o${index + 1}`, label })) };
}

function warningsOf(...questions) {
  const checked = checkSet({ questions });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return sharedOpenings(checked.set.questions);
}

function brief(run, set, form) {
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(set));
  return verb(['gate-brief', `--state=${run.state}`, '--node=analysis', form, `--patch-file=${file}`]);
}

const ALIKE = question('sessions', ['Keep their own sessions, and look again later', 'Keep their own sessions and merge them now']);
const APART = question('sessions', ['Keep their own sessions, and look again later', 'Run them inside the step\'s session']);

test('option openings: two labels sharing their first three words give one warning naming both', () => {
  assert.deepEqual(warningsOf(ALIKE), [
    'option-openings-shared:sessions:"Keep their own sessions, and look again later" and "Keep their own sessions and merge them now" open with "keep their own"; lead each option with what sets it apart',
  ]);
});

test('option openings: case, punctuation and a typed (Recommended) do not hide a shared opening', () => {
  const warnings = warningsOf(question('fix', ['Apply the fix (Recommended)', 'apply, the FIX later', 'Leave it']));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^option-openings-shared:fix:"Apply the fix" and "apply, the FIX later" open with "apply the fix";/);
});

test('option openings: options that part by the third word, short labels and separate questions pass', () => {
  assert.deepEqual(warningsOf(APART), []);
  assert.deepEqual(warningsOf(question('next', ['Continue to planning', 'Continue to the specification audit'])), []);
  assert.deepEqual(warningsOf(question('stop', ['Stop here', 'Stop here'])), [], 'a label under three words is never compared');
  assert.deepEqual(warningsOf(
    question('first', ['Keep the plan as written', 'Drop the plan']),
    question('second', ['Keep the plan and add tests', 'Rewrite the plan']),
  ), [], 'openings are compared within one question only');
});

test('option openings: a set with alike options is still requested, with the warning on stderr', t => {
  const run = running(t);
  const result = brief(run, { questions: [ALIKE] }, '--request');
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.deepEqual(request.questions[0].options.map(option => option.label), ALIKE.options.map(option => option.label));
  assert.match(result.stderr, /^warning: option-openings-shared:sessions:"Keep their own sessions, and look again later" and "Keep their own sessions and merge them now" open with "keep their own";/);
});

test('option openings: a set whose options open apart warns nothing', t => {
  const run = running(t);
  const result = brief(run, { questions: [APART] }, '--request');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('option openings: the in-session ask form warns the same and still prints the call', t => {
  const run = running(t);
  const result = brief(run, { questions: [ALIKE] }, '--ask');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Keep their own sessions and merge them now/);
  assert.match(result.stderr, /^warning: option-openings-shared:sessions:/);
});
