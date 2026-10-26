import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { foldAnswer, requestQuestions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// The standard-candidates question at finalization is a multi-select, and a
// multi-select answer names at least one option. Choosing no candidate is a
// valid answer, so the question carries a fixed first option for it, worded the
// same in every guide that asks it. The question recommends: each well-supported
// candidate, or the none option when no candidate is. Pinned here: the wording
// in each guide, and a question-set request that carries the option, states
// every option's recommendation and takes the none option as the whole answer.

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
      { id: 'typed-errors', label: 'Typed errors', description: 'Seen in two task groups. Raise typed errors from the service layer.', recommended: true },
      { id: 'ids-in-logs', label: 'Ids in log lines', description: 'Every log line names the record it is about.', recommended: false },
    ],
  }],
};

/** The same set when no candidate is well supported: the none option is the recommendation. */
const NONE_RECOMMENDED = {
  questions: [{
    ...SET.questions[0],
    options: SET.questions[0].options.map(option => ({ ...option, recommended: option.id === NONE_ID })),
  }],
};

/** Freeze a cockpit development run at finalization and build its request for `set`. */
function requestFor(t, set) {
  const run = scratch(t);
  freeze(run, { definition: path.join(WORKFLOWS_DIR, 'development.yml'), inputs: { task_description: 'Add a settings page' }, orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { finalization: { status: 'running' } } });
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(set));
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=finalization', '--request', `--patch-file=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('each guide asking standard candidates offers the none option first, in the same words, and recommends', () => {
  const asked = [];
  for (const workflow of ASKERS) {
    const section = sectionOf(workflow, 'finalization');
    const asks = paragraph(section, '**Asks.**');
    const withSets = paragraph(section, '**With question sets** (`standard-candidates`)');
    assert.ok(asks.includes(`Its first option is fixed: *"${NONE_LABEL}"*.`), `${workflow}: the in-session question names the option first`);
    assert.ok(!/no option (is )?recommended/i.test(asks + withSets), `${workflow}: no path recommends nothing`);
    assert.ok(asks.includes('Each candidate the consolidation found well supported'), `${workflow}: well-supported candidates are recommended`);
    assert.ok(asks.includes('When none qualifies, *None now* is recommended'), `${workflow}: with none supported, the none option is`);
    assert.ok(withSets.includes(`*None now* first, under the id \`${NONE_ID}\`, and every option \`recommended\` true or false`), `${workflow}: the question set names the option, its id and every recommendation`);
    const paged = section.slice(section.indexOf('<!-- rich-picker -->'), section.indexOf('<!-- /rich-picker -->')).replace(/\s+/g, ' ');
    assert.ok(paged.includes('Each page recommends by the same rule'), `${workflow}: the paged form recommends per page`);
    assert.ok(withSets.includes('the candidates win'), `${workflow}: chosen with candidates, the candidates win`);
    asked.push([asks, withSets, paged]);
  }
  for (const each of asked.slice(1)) assert.deepEqual(each, asked[0], 'the three guides word the question alike');
});

test('a standard-candidates request carries the none option, and that option alone is a valid answer', t => {
  const request = requestFor(t, SET);

  const [carried] = request.questions;
  assert.equal(carried.id, 'standard-candidates');
  assert.equal(carried.multi_select, true);
  assert.deepEqual(carried.options.map(option => option.id), [NONE_ID, 'typed-errors', 'ids-in-logs'], 'the none option comes first');
  const [checkpointed] = request.context.checkpoint.questions;
  assert.equal(checkpointed.options[0].label, NONE_LABEL);
  assert.deepEqual(carried.options.map(option => option.recommended), [false, true, false], 'every option states its recommendation');
  assert.deepEqual(checkpointed.options.filter(option => option.recommended).map(option => option.label), ['Typed errors'], 'the well-supported candidate is recommended');

  const folded = foldAnswer(requestQuestions(request), { answers: { 'standard-candidates': [NONE_ID] }, answered_by: 'dana', via: 'cockpit' });
  assert.equal(folded.ok, true, JSON.stringify(folded.errors));
  assert.deepEqual(folded.decisions, [{
    decision: NONE_LABEL, by: 'operator', question_id: 'standard-candidates', question: SET.questions[0].question,
    answer: NONE_LABEL, recommended: 'Typed errors', as_recommended: false, answered_by: 'dana', via: 'cockpit',
  }]);

  const empty = foldAnswer(requestQuestions(request), { answers: { 'standard-candidates': [] } });
  assert.equal(empty.ok, false, 'an empty selection is not an answer, which is why the none option exists');
});

test('with no well-supported candidate, the request recommends the none option alone', t => {
  const request = requestFor(t, NONE_RECOMMENDED);
  const [carried] = request.questions;
  assert.deepEqual(carried.options.map(option => [option.id, option.recommended]), [[NONE_ID, true], ['typed-errors', false], ['ids-in-logs', false]]);
  const folded = foldAnswer(requestQuestions(request), { answers: { 'standard-candidates': [NONE_ID] }, answered_by: 'dana', via: 'cockpit' });
  assert.equal(folded.ok, true, JSON.stringify(folded.errors));
  assert.equal(folded.decisions[0].as_recommended, true);
});

// What a candidate is, how one is written and how finalization consolidates
// them is described once, in docs-manager's reference. Pinned here: each guide
// consolidates through docs-operator on its dispatch-model values before it
// offers anything, worded alike, and every step that writes or takes a
// candidate points at the one reference rather than restating it.

const PLUGIN_DIR = path.resolve(ENGINE_DIR, '..', '..');
const REFERENCE = 'references/standard-candidates.md';

/** A numbered step of a section, as one line of text. */
function step(section, number) {
  const start = section.indexOf(`\n${number}. `);
  assert.notEqual(start, -1, `step ${number} is there`);
  const end = section.indexOf(`\n${number + 1}. `, start);
  return section.slice(start + 1, end === -1 ? undefined : end).replace(/\s+/g, ' ');
}

test('each guide consolidates the candidates through docs-operator before offering them, worded alike', () => {
  const steps = ASKERS.map(workflow => {
    const consolidate = step(sectionOf(workflow, 'finalization'), 4);
    assert.ok(consolidate.includes('workflow.mjs dispatch-model --agent=maister:docs-operator'), `${workflow}: the call takes its dispatch-model values`);
    assert.ok(consolidate.includes('"Consolidate standard candidates.'), `${workflow}: the call names the docs-manager operation`);
    assert.ok(consolidate.includes(`\`${REFERENCE}\``), `${workflow}: the step points at the reference`);
    assert.ok(consolidate.includes('offered as written'), `${workflow}: a failed consolidation still offers the lines`);
    return consolidate;
  });
  for (const each of steps.slice(1)) assert.equal(each, steps[0], 'the three guides word the step alike');
});

test('the candidate description lives in one reference that every other step points at', () => {
  const read = file => fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8').replace(/\s+/g, ' ');
  const reference = read(`skills/docs-manager/${REFERENCE}`);
  for (const heading of ['## What a candidate is', '## How one is written', '## Where one belongs', '## Consolidation']) {
    assert.ok(reference.includes(heading), `the reference holds ${heading}`);
  }
  const pointers = {
    'agents/task-group-implementer.md': `skills/docs-manager/${REFERENCE}`,
    'agents/implementation-runner.md': `skills/docs-manager/${REFERENCE}`,
    'skills/standards-update/SKILL.md': `skills/docs-manager/${REFERENCE}`,
    'skills/docs-manager/SKILL.md': `\`${REFERENCE}\``,
    'skills/orchestrator-framework/references/orchestrator-patterns.md': `\`${REFERENCE}\``,
  };
  for (const [file, pointer] of Object.entries(pointers)) {
    assert.ok(read(file).includes(pointer), `${file} points at the reference`);
  }
});
