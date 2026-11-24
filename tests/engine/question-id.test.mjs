import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, scratch, verb, write } from '../helpers.mjs';
import { QUESTION_ID_RULE, checkSet } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// A question id keeps a node id's shape: a lower-case letter first, then
// lower-case letters, digits and hyphens, 2 to 41 characters. The set is
// judged where it is first read, so a bad id is refused with the rule stated
// before any request is written, never learnt from a later refusal.

const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

function question(id) {
  return { id, question: 'Which one?', options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }] };
}

test('the set check refuses an id outside the rule, stating the rule and the id\'s length', () => {
  for (const id of ['a'.repeat(42), 'specification-requirements-no-audit-on-refusal', 'Storage', '1-storage', 'q', 'storage_scope']) {
    const checked = checkSet({ questions: [question(id)] });
    assert.equal(checked.ok, false, id);
    assert.ok(checked.errors.some(error => error.includes(`"${id}" is not a usable question id: ${QUESTION_ID_RULE}, and this one has ${id.length}`)), `${id}: ${checked.errors}`);
  }
  for (const id of ['a'.repeat(41), 'qa', 'storage-2']) assert.equal(checkSet({ questions: [question(id)] }).ok, true, id);
  assert.match(QUESTION_ID_RULE, /lower-case letter, then lower-case letters, digits and hyphens, 2 to 41 characters/);
});

test('gate-brief refuses a set with an id outside the rule before a request is built, and writes nothing', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [question('specification-requirements-no-audit-on-refusal')] }));
  const before = fs.readFileSync(run.state);
  for (const form of ['--request', '--ask']) {
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=analysis', form, `--patch-file=${file}`]);
    assert.equal(result.code, 1, `${form}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^gate-brief-questions-invalid: /, form);
    assert.ok(result.stderr.includes(QUESTION_ID_RULE), `${form}: ${result.stderr}`);
    assert.ok(fs.existsSync(file), `${form}: the set is kept`);
    assert.deepEqual(fs.readFileSync(run.state), before, `${form}: the state is unchanged`);
    assert.equal(fs.existsSync(path.join(run.dir, 'gates')) && fs.readdirSync(path.join(run.dir, 'gates')).some(name => name.startsWith('analysis')), false, `${form}: no request`);
  }
});
