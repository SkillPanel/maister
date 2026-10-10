import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';
import { DEFAULT_POLICY, loadPolicy, triageFor } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';
import { foldAnswer, requestQuestions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// Requirement gathering asks the questions of one topic as one drafted story.
// Each story is an ordinary question of the node's set, under its own id: the
// node's declared story id `user-story`, then the topic as a slug. Three
// things hold that together, and each is pinned here: the node prose that asks
// stories declares the id on its question-set lines; a story's own id reads as
// that declared id, so one policy row classes every story while the built-in
// default classes none; and a story travels as one question of the request and
// comes back as one decision under its own id, the story whole beside it.

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');

/** The node that gathers requirements in each workflow, and another question it asks. */
const ASKERS = [
  { workflow: 'development', node: 'specification', sibling: 'specification-requirements' },
  { workflow: 'product-design', node: 'problem-exploration', sibling: 'problem-questions' },
];

const STORY_ID = 'user-story';
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

/** A node's section of a node-prose file: from its `## \`id\`` heading to the next heading. */
function sectionOf(workflow, node) {
  const text = fs.readFileSync(path.join(WORKFLOWS_DIR, `${workflow}.md`), 'utf8');
  const start = text.indexOf(`\n## \`${node}\`\n`);
  assert.notEqual(start, -1, `${workflow}.md has a section for ${node}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The ids a section names on its question-set lines, by `With` and `Without`. */
function declaredIn(section) {
  const ids = { With: new Set(), Without: new Set() };
  for (const match of section.matchAll(/\*\*(With|Without) question sets\*\* \(`([a-z0-9-]+)`\)/g)) ids[match[1]].add(match[2]);
  return ids;
}

/** A policy of this test's own, loaded the way a run loads one, so its shape is judged. */
function policyFor(t, { workflow, sibling }) {
  const run = scratch(t);
  const file = path.join(run.dir, 'story-policy.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    families: {
      'story-family': { class: 'consult', description: 'A drafted story for a person to confirm.' },
      'requirement-family': { class: 'record', description: 'A requirement stated for a person to confirm.' },
    },
    table: [
      { workflow, id: STORY_ID, kind: 'question', families: ['story-family'] },
      { workflow, id: sibling, kind: 'question', families: ['requirement-family'] },
    ],
  }));
  const loaded = loadPolicy({ path: file });
  assert.deepEqual(loaded.warnings, [], 'the test policy is applied, not refused');
  return loaded.policy;
}

/** One story as a node states it: the draft as the question, then its three answers. */
const STORY = {
  id: 'user-story-remove-member',
  header: 'Remove a member',
  question: [
    'As a notebook owner, I open a member\'s row in the sharing panel and choose Remove.',
    'The membership is marked removed, kept for the audit log, and "member removed by <owner>" is recorded.',
    'Afterwards the member no longer sees the notebook, and it leaves their sharing suggestions.',
  ].join('\n'),
  why: 'Settles who may remove a member, where they do it, what is kept and audited, and what the member sees afterwards.',
  options: [
    { id: 'accept', label: 'Accept the story', description: 'Follows the owner-only rule the sharing panel already applies.', recommended: true },
    { id: 'accept-with-corrections', label: 'Accept with 2 corrections', description: 'Editors may remove members too; a removed member keeps read access to notes they wrote.' },
    { id: 'alternative', label: 'Suspend instead', description: 'The member is suspended and can be restored by the owner; nothing is removed.' },
  ],
};

test('each node that gathers requirements declares the story id on its With and Without lines', () => {
  for (const { workflow, node } of ASKERS) {
    const ids = declaredIn(sectionOf(workflow, node));
    assert.ok(ids.With.has(STORY_ID), `${workflow}/${node} names ${STORY_ID} on a With line`);
    assert.ok(ids.Without.has(STORY_ID), `${workflow}/${node} names the default ${STORY_ID} takes`);
  }
});

test('a story\'s own id reads as the declared story id; the built-in default classes none', t => {
  for (const asker of ASKERS) {
    const { workflow, node, sibling } = asker;
    const declaredIds = [...declaredIn(sectionOf(workflow, node)).With];
    const policy = policyFor(t, asker);
    const read = (id, under = policy) => triageFor({ policy: under, workflow, kind: 'question', id, declaredIds });

    assert.deepEqual(read('user-story-remove-member'), { version: 1, class: 'consult', family: 'story-family' }, `${workflow}: a story reads as its row`);
    assert.deepEqual(read(STORY_ID), { version: 1, class: 'consult', family: 'story-family' });
    assert.deepEqual(read(sibling), { version: 1, class: 'record', family: 'requirement-family' }, `${workflow}: the story row takes nothing from ${sibling}`);
    assert.equal(read('user-story-remove-member', DEFAULT_POLICY), null, 'unclassified under the built-in default, so nothing changes');
  }
});

test('a story is one question of the request, and its answer one decision under the story\'s id', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: COCKPIT } });
  write(run, { nodes: { analysis: { status: 'running' } } });
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [STORY] }));
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=analysis', '--request', `--patch-file=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);

  assert.deepEqual(request.questions.map(question => question.id), [STORY.id]);
  assert.deepEqual(request.questions[0].options.map(option => option.id), ['accept', 'accept-with-corrections', 'alternative']);
  const [asked] = request.context.checkpoint.questions;
  assert.equal(asked.question, STORY.question, 'the checkpoint keeps the story whole, line breaks included');
  assert.equal(asked.why, STORY.why);
  assert.equal(asked.default, 'accept', 'unanswered, the story is taken as drafted');

  const folded = foldAnswer(requestQuestions(request), { answers: { [STORY.id]: 'accept-with-corrections' }, answered_by: 'dana', via: 'cockpit' });
  assert.equal(folded.ok, true, JSON.stringify(folded.errors));
  assert.deepEqual(folded.decisions, [{
    decision: 'Accept with 2 corrections', by: 'operator', question_id: STORY.id, question: STORY.question,
    answer: 'Accept with 2 corrections', recommended: 'Accept the story', as_recommended: false, answered_by: 'dana', via: 'cockpit',
  }]);
});
