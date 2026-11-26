import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, delegating, freeze, readState, scratch, verb, walkTo, write as writeState } from '../helpers.mjs';
import { foldAnswer, requestQuestions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/question-set.mjs';

// The specification step asks only real choices. Every story and assumption is
// written down; one is asked only when a different answer would change what
// gets built, and the specification approval shows what nobody confirmed. The
// stories nobody confirmed travel on the step's summary as `stories`, which
// every surface of the checkpoint lists under "Stories to confirm"; a story the
// run judged a fact is asked nothing and recorded as no decision. Nothing the
// engine checks counts the story or assumption questions, so a run that asks
// none of them completes like any other.

const write = (run, patch) => writeState(run, delegating(patch, run));

const WORKFLOWS_DIR = path.join(ENGINE_DIR, 'workflows');
const DEVELOPMENT = path.join(WORKFLOWS_DIR, 'development.yml');
const AGENTS_DIR = path.join(ENGINE_DIR, '..', '..', 'agents');
const COCKPIT = { kind: 'cockpit', cwd: '/work', features: ['question-sets'] };

const STORIES = [
  'user-story-tag-note: a note owner adds a tag from the note header, and the tag shows on the note at once',
  'user-story-filter-by-tag: a reader picks a tag in the list, and only notes carrying it stay listed',
  'user-story-remove-tag: a note owner removes a tag from the note header, and the note leaves that filter',
];

/** A file's text in LF: a Windows checkout gives markdown CRLF. */
const textOf = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

/** A node's section of a node-prose file: from its `## \`id\`` heading to the next heading. */
function sectionOf(workflow, node) {
  const text = textOf(path.join(WORKFLOWS_DIR, `${workflow}.md`));
  const start = text.indexOf(`\n## \`${node}\`\n`);
  assert.notEqual(start, -1, `${workflow}.md has a section for ${node}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** One paragraph of prose on one line, so a phrase wrapped across lines still matches. */
const flat = text => text.replace(/\s+/g, ' ');

function put(run, relative, body = '# placeholder\n') {
  const file = path.join(run.dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** A development run whose specification step is running, the analysis having found no defect and no UI. */
function atSpecification(t, orchestrator = {}) {
  const run = scratch(t);
  freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Tag the notes' }, orchestrator });
  walkTo(run, ['gap-analysis'], { except: ['gap-analysis'] });
  write(run, { nodes: { 'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } } } });
  walkTo(run, ['specification'], { except: ['specification'] });
  write(run, { nodes: { specification: { status: 'running' } } });
  return run;
}

/** The requirements and the specification a closing write finds on disk, each story marked as it was settled. */
function putSpecification(run, confirmed = []) {
  const mark = story => (confirmed.some(id => story.startsWith(`${id}:`)) ? 'confirmed by the person' : 'drafted, not confirmed');
  const stories = STORIES.map(story => `- \`${story.split(':')[0]}\` (${mark(story)}): ${story.split(': ')[1]}`).join('\n');
  const assumptions = '- Tags are stored lowercase (a stated assumption rather than settled fact)';
  put(run, 'analysis/requirements.md', `# Requirements\n\n## User stories\n\n${stories}\n\n## Assumptions\n\n${assumptions}\n`);
  put(run, 'implementation/spec.md', `# Specification: Tag the notes\n\n## User Stories\n\n${stories}\n\n## Assumptions\n\n${assumptions}\n`);
  put(run, 'implementation/spec.html', '<!doctype html><title>Specification</title>\n');
}

/**
 * The specification step's closing write: `stories` nobody confirmed, the
 * assumption an open risk, Part A's file sanctioned absent as one obvious
 * approach leaves it.
 */
function closeSpecification(run, { stories = STORIES, decisions = [] } = {}) {
  return write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: {
      specification: {
        headline: 'The spec adds tags to notes and a tag filter to the list, with 6 requirements and no breaking change.',
        summary: 'Specification: Tag the notes. In scope: tagging and filtering; out of scope: tag renaming.',
        stories,
        decisions,
        absent: {
          technical_clarifications: 'One obvious approach, so Part A asked nothing.',
          explainer: 'HTML output is off for this run.',
        },
        risks: [{ risk: 'Tags are stored lowercase', tag: 'open', change: 'Keep the case the owner typed' }],
        recommends: { option: 'continue-to-planning', reason: 'A small change with one open assumption the checkpoint shows' },
        artifacts: [{ path: 'implementation/spec.md', html: 'implementation/spec.html', role: 'primary' }],
      },
    },
  });
}

const brief = (run, ...flags) => {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=specification-approval', ...flags]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
};

/** Every surface of the specification checkpoint, by name. */
function surfacesOf(run) {
  return {
    full: brief(run),
    rich: JSON.parse(brief(run, '--json', '--picker=rich')).options[0].preview,
    plain: JSON.parse(brief(run, '--json', '--picker=plain')).question,
    oneline: brief(run, '--oneline'),
  };
}

test('stories that are all facts: nothing is asked, the spec marks them drafted, and the checkpoint lists each to confirm', t => {
  const run = atSpecification(t);
  putSpecification(run);
  closeSpecification(run);

  const summary = readState(run).node_summaries.specification;
  assert.deepEqual(summary.stories, STORIES);
  assert.equal((summary.decisions ?? []).some(item => String(item.question_id ?? '').startsWith('user-story')), false, 'a story never asked records no decision');
  for (const file of ['analysis/requirements.md', 'implementation/spec.md']) {
    const text = textOf(path.join(run.dir, ...file.split('/')));
    assert.equal(text.match(/drafted, not confirmed/g)?.length, STORIES.length, `${file} marks every story drafted`);
    assert.match(text, /a stated assumption rather than settled fact/, `${file} marks the assumption`);
  }

  const surfaces = surfacesOf(run);
  for (const name of ['full', 'rich', 'plain']) {
    const lines = surfaces[name].split('\n');
    assert.ok(lines.some(line => /^(\*\*)?Stories to confirm(\*\*|:)?/.test(line)), `${name}: the heading\n${surfaces[name]}`);
    for (const story of STORIES) assert.ok(lines.includes(`- ${story}`), `${name}: ${story}\n${surfaces[name]}`);
  }
  assert.match(surfaces.oneline, /Stories to confirm: /);

  const checkpoint = JSON.parse(brief(run, '--checkpoint'));
  assert.equal(checkpoint.decisions.operator.count, 0, 'nobody was asked anything');
  assert.equal(checkpoint.risks.open.length, 1, 'the assumption is the one open risk');
  assert.ok(checkpoint.risks.open.every(risk => !/user-story/.test(JSON.stringify(risk))), 'no story is a risk');
});

test('a story with a real fork is still asked, alone, and only the unconfirmed stories are left to confirm', t => {
  const run = atSpecification(t, { driver: COCKPIT });
  const fork = {
    id: 'user-story-remove-tag',
    header: 'Remove a tag',
    question: [
      'As a note owner, I open the note header and remove a tag.',
      'The tag leaves the note; a tag no note carries any more is deleted.',
      'Afterwards the note no longer shows under that tag\'s filter.',
    ].join('\n'),
    why: 'Settles whether a tag no note carries is kept for reuse or deleted.',
    options: [
      { id: 'accept', label: 'Accept the story', description: 'Deletes an unused tag, as the label list already does.', recommended: true },
      { id: 'alternative', label: 'Keep unused tags', description: 'An unused tag stays in the tag list for reuse.' },
    ],
  };
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [fork] }));
  const sent = verb(['gate-brief', `--state=${run.state}`, '--node=specification', '--request', `--patch-file=${file}`]);
  assert.equal(sent.code, 0, sent.stderr);
  const request = JSON.parse(sent.stdout);
  assert.deepEqual(request.questions.map(question => question.id), [fork.id], 'the fork alone: no fact story, no assumptions tab');

  const folded = foldAnswer(requestQuestions(request), { answers: { [fork.id]: 'alternative' }, answered_by: 'dana', via: 'cockpit' });
  assert.equal(folded.ok, true, JSON.stringify(folded.errors));
  putSpecification(run, [fork.id]);
  const unconfirmed = STORIES.filter(story => !story.startsWith(`${fork.id}:`));
  closeSpecification(run, { stories: unconfirmed, decisions: folded.decisions });

  const summary = readState(run).node_summaries.specification;
  assert.deepEqual(summary.stories, unconfirmed);
  const answered = summary.decisions.filter(item => item.question_id?.startsWith('user-story'));
  assert.deepEqual(answered.map(item => [item.question_id, item.by, item.answer]), [[fork.id, 'operator', 'Keep unused tags']]);
  assert.equal(summary.decisions.some(item => item.question_id === 'specification-requirements'), false, 'no assumption was asked');

  const checkpoint = JSON.parse(brief(run, '--checkpoint'));
  const listed = checkpoint.closed.flatMap(each => each.stories ?? []);
  assert.deepEqual(listed, unconfirmed, 'the confirmed story is not listed to confirm');
});

test('a run that asks no story and no assumption passes every completeness check, through run-complete', t => {
  const run = atSpecification(t);
  putSpecification(run);
  closeSpecification(run);

  write(run, { nodes: { 'specification-approval': { status: 'completed', decisions: [{ option: 'continue-to-planning' }] } } });
  const graph = readState(run).workflow.nodes;
  const last = Object.keys(graph).at(-1);
  walkTo(run, [last], { except: [last] });
  write(run, { nodes: { [last]: { status: 'completed' } } });
  write(run, { task: { status: 'completed' } });

  const closed = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(closed.code, 0, closed.stderr);
  assert.match(closed.stdout, /RUN-COMPLETE\n$/);
  assert.doesNotMatch(closed.stdout, /^missing-(artifact|companion): specification /m, 'the specification step owes nothing');
});

test('the specification prose asks only choices, marks what nobody confirmed, and drops the assumptions always asked', () => {
  const development = flat(sectionOf('development', 'specification'));
  assert.doesNotMatch(development, /Two are always among them/);
  assert.match(development, /only when it is a choice by the fact-or-choice test \(engine `references\/in-node-questions\.md`, \*A fact is what no answer would change\*\)/);
  assert.match(development, /With none open, the tab is not asked\./);
  assert.match(development, /drafted, not confirmed/);
  assert.match(development, /a stated assumption rather than settled fact/);
  assert.match(development, /goes in `stories`/);
  assert.match(development, /this test never lowers a class/);

  const migration = flat(sectionOf('migration', 'specification'));
  assert.match(migration, /ask only those that are choices by the fact-or-choice test/);
  assert.match(migration, /With none open, nothing is asked\./);
  assert.match(migration, /a stated assumption rather than settled fact/);

  const creator = flat(textOf(path.join(AGENTS_DIR, 'specification-creator.md')));
  assert.match(creator, /confirmed by the person, or drafted, not confirmed/);
  assert.match(creator, /## Assumptions/);
  assert.match(creator, /confirmed by the person, or a stated assumption rather than settled fact/);
});
