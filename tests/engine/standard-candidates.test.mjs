import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { foldAnswer, requestQuestions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// The standard-candidates question at finalization is a multi-select, and a
// multi-select answer names at least one option. Choosing no candidate is a
// valid answer, so the question carries a fixed first option for it, worded the
// same in every guide that asks it and recommended by none. Pinned here: the
// wording in each guide, and a question-set request that carries the option and
// takes it as the whole answer.

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');
const ASKERS = ['development', 'performance', 'migration'];
const NONE_LABEL = 'None now: list them as next steps';
const NONE_ID = 'none-now';
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

/** A node's section of a node-prose file: from its `## \`id\`` heading to the next heading. */
function sectionOf(workflow, node) {
  // In LF: a Windows checkout gives markdown CRLF.
  const text = fs.readFileSync(path.join(WORKFLOWS_DIR, `${workflow}.md`), 'utf8').replace(/\r\n?/g, '\n');
  const start = text.indexOf(`\n## \`${node}\`\n`);
  assert.notEqual(start, -1, `${workflow}.md has a section for ${node}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The paragraph that opens with `lead`, as one line of text. */
function paragraph(section, lead) {
  const found = section.split('\n\n').find(each => each.startsWith(lead));
  assert.ok(found, `a paragraph opens with ${lead}`);
  return found.replace(/\s+/g, ' ');
}

/** The set finalization writes for two candidates: the none option first, then each candidate. */
const SET = {
  questions: [{
    id: 'standard-candidates',
    question: 'Which conventions should become standards? Each chosen one is added through standards-update, which asks where it goes.',
    multi_select: true,
    options: [
      { id: NONE_ID, label: NONE_LABEL, description: 'Adds nothing now; every candidate is listed under Next as its standards-update command.' },
      { id: 'typed-errors', label: 'Typed errors', description: 'Raise typed errors from the service layer.' },
      { id: 'ids-in-logs', label: 'Ids in log lines', description: 'Every log line names the record it is about.' },
    ],
  }],
};

test('each guide asking standard candidates offers the none option first, in the same words, recommending nothing', () => {
  const asked = [];
  for (const workflow of ASKERS) {
    const section = sectionOf(workflow, 'finalization');
    const asks = paragraph(section, '**Asks.**');
    const withSets = paragraph(section, '**With question sets** (`standard-candidates`)');
    assert.ok(asks.includes(`Its first option is fixed: *"${NONE_LABEL}"*.`), `${workflow}: the in-session question names the option first`);
    assert.ok(asks.includes('No option is recommended.'), `${workflow}: the in-session question recommends nothing`);
    assert.ok(withSets.includes(`*None now* first, under the id \`${NONE_ID}\`, and no option recommended`), `${workflow}: the question set names the option and its id`);
    assert.ok(withSets.includes('the candidates win'), `${workflow}: chosen with candidates, the candidates win`);
    asked.push([asks, withSets]);
  }
  for (const each of asked.slice(1)) assert.deepEqual(each, asked[0], 'the three guides word the question alike');
});

test('a standard-candidates request carries the none option, and that option alone is a valid answer', t => {
  const run = scratch(t);
  freeze(run, { definition: path.join(WORKFLOWS_DIR, 'development.yml'), inputs: { task_description: 'Add a settings page' }, orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { finalization: { status: 'running' } } });
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(SET));
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=finalization', '--request', `--patch-file=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);

  const [carried] = request.questions;
  assert.equal(carried.id, 'standard-candidates');
  assert.equal(carried.multi_select, true);
  assert.deepEqual(carried.options.map(option => option.id), [NONE_ID, 'typed-errors', 'ids-in-logs'], 'the none option comes first');
  const [checkpointed] = request.context.checkpoint.questions;
  assert.equal(checkpointed.options[0].label, NONE_LABEL);
  assert.ok(checkpointed.options.every(option => !option.recommended), 'no option is recommended');
  assert.equal(checkpointed.default, undefined, 'nothing is chosen for a person who is not asked');

  const folded = foldAnswer(requestQuestions(request), { answers: { 'standard-candidates': [NONE_ID] }, answered_by: 'dana', via: 'cockpit' });
  assert.equal(folded.ok, true, JSON.stringify(folded.errors));
  assert.deepEqual(folded.decisions, [{
    decision: NONE_LABEL, by: 'operator', question_id: 'standard-candidates', question: SET.questions[0].question,
    answer: NONE_LABEL, recommended: null, as_recommended: null, answered_by: 'dana', via: 'cockpit',
  }]);

  const empty = foldAnswer(requestQuestions(request), { answers: { 'standard-candidates': [] } });
  assert.equal(empty.ok, false, 'an empty selection is not an answer, which is why the none option exists');
});
