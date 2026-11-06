import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, write } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// A first line from a person never folds: the session reports where the run stands
// in fixed words and writes nothing. A session follows the prose, so the words are
// pinned here; a stamped line's fold is the writer's, and that part is run. No test
// here can see a session follow them.

const GATES = fs.readFileSync(path.join(ENGINE_DIR, 'references/gates.md'), 'utf8');
const SKILL = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const GATE = 'specification-approval';

/** `text` with its line breaks folded, as a sentence reads across the wrapped prose. */
const flat = text => text.replace(/\s*\n\s*/g, ' ');

/** The section on a first line from a person, folded to one line. */
function section() {
  const start = GATES.indexOf('**A first line from a person.**');
  assert.ok(start > 0, 'gates.md carries the section');
  return flat(GATES.slice(start, GATES.indexOf('## Choosing a stop option')));
}

test('every refusal is given in fixed words saying what was recorded and what can be done', () => {
  const words = section();
  for (const sentence of [
    'This run is waiting on an answer, and nothing was recorded. Answer where the question was asked.',
    'This run is not waiting on an answer, and nothing was recorded. It is driven from where it was started: carry on there.',
    'No run here is waiting on an answer, and nothing was recorded. Say which run to carry on.',
    'Several runs are waiting on an answer, and nothing was recorded. Say which one to carry on.',
    'An answer from <answered_by> is recorded, and nothing more was written here. Go back to where the question was asked: it carries the run on, or gives you the line to send here.',
    'This run\'s record is part-way through, and nothing more was written here. Go back to where the question was asked: it carries the run on, or gives you the line to send here.',
  ]) assert.ok(words.includes(sentence), `missing: ${sentence}`);
});

test('the refusal that sends a person to answer is kept for when no answer is on disk', () => {
  const words = section();
  const send = 'Answer where the question was asked';
  assert.equal(words.split(send).length, 2, 'said once');
  assert.ok(words.indexOf('`answer_state` is `none`') < words.indexOf(send) && words.indexOf(send) < words.indexOf('`answer_state` is `unusable`'));
  for (const sentence of [
    'This run is waiting on an answer, and nothing was recorded. An answer is on disk but cannot be used: <each file\'s name and reason>. Take it up where the question was asked.',
    'This run is waiting on an answer, and nothing was recorded. Several answers are on disk and nothing says which one stands. Take it up where the question was asked.',
  ]) assert.ok(words.includes(sentence), `missing: ${sentence}`);
});

test('an answer on disk is reported and never folded on a person\'s words', () => {
  const words = section();
  for (const gone of [
    'carry on exactly as for a',
    'where the question was asked, then carry on',
    'the line\'s fields read from the disk',
    'fails the validation',
    'both kinds of session',
    'That `at` is the turn\'s stamp',
    'GATE-INVALID',
  ]) assert.ok(!words.includes(gone), `still there: ${gone}`);
  const revising = flat(GATES.slice(GATES.indexOf('## Revising at a gate')));
  assert.ok(!revising.includes('first line from a person'), 'a revise is folded on a stamped line alone');
});

test('a part-way record is reported ahead of any verdict, and never finished', () => {
  const words = section();
  const part = words.indexOf('**`gate` carries `part_recorded`,**');
  assert.ok(part > 0, 'the case is there');
  assert.ok(part < words.indexOf('**`answer_state` is `one`:**'), 'read before the verdict');
  assert.ok(part > words.indexOf('**No `gate`:**'));
  assert.ok(words.includes('Never finish it or repair it.'));
  assert.ok(words.includes('`answer-block` and `node-completed`'), 'the report\'s description names both');
  assert.ok(flat(SKILL).includes('`part_recorded` only when the run\'s record is part-way through'));
});

test('a session is sent to the verb first, and on a person\'s words records nothing at all', () => {
  const words = section();
  const prohibition = 'a session given a person\'s first line records nothing at all, not even an answer on disk, and never takes an answer from the person in the session';
  assert.ok(words.includes(prohibition));
  assert.ok(words.includes('An answer is folded only on a stamped line.'));
  assert.ok(!words.includes('a usable answer file and from nowhere else'));
  assert.ok(words.indexOf(prohibition) < words.indexOf('Try `resume-check` first'), 'the prohibition is read first');
  assert.ok(words.includes('`resume-check --state=<run directory>/orchestrator-state.yml`'));
  assert.ok(words.includes('`resume-check` with no flags'));
  assert.ok(words.includes('absolute path under the plugin root'));
  assert.ok(words.includes('never list `gates/`, guess an answer file\'s name or judge a file again'));
  const skill = flat(SKILL);
  assert.ok(skill.includes('A person\'s words get a report of where the run stands and write nothing.'));
  assert.ok(skill.includes('records nothing at all, not even an answer on disk, and never takes an answer from the person in the session: an answer is folded only on a stamped line'));
});

test('the skill can still be found by a session told to carry on, and promises only a report', () => {
  const description = /^description: (.*)$/m.exec(SKILL)[1];
  assert.ok(description.includes('carry on a driven run that is waiting on an answer'));
  assert.ok(description.includes('a report of where the run stands'));
  assert.ok(!description.includes('the way to carry on'));
});

test('a denied call has one truthful outcome, the read as much as a write, and no sentence promises the shell', () => {
  const words = flat(GATES);
  assert.ok(!words.includes('A write denied on this path'));
  const start = words.indexOf('**A call denied on this path.**');
  assert.ok(start > 0, 'gates.md carries the paragraph');
  const paragraph = words.slice(start, words.indexOf('**A question set answered.**'));
  assert.ok(paragraph.includes('may deny `resume-check` there as well'));
  assert.ok(paragraph.includes('denies the first write while you record an answer, or denies that `resume-check`, nothing was recorded'));
  assert.ok(paragraph.includes('When it denies a later write, the record is part-way through.'), 'a denial after the first write recorded something');
  assert.ok(paragraph.includes('tell the person which and what the denial says to do, and try no other way'));
  assert.ok(paragraph.includes('What the denial names wins over the fixed words in this section'));
  assert.ok(!words.includes('shell calls cannot run'), 'true on a host that allows the read and on one that denies it');
  assert.equal(words.split('a host may deny the engine\'s shell calls').length, 3);
});

test('the stamp stays the contract: a stamped shape with no at= still fails, and an answer file stands in for nothing', () => {
  const words = flat(GATES);
  assert.ok(words.includes('A line in one of the five shapes with no `at=` is below the contract'));
  assert.ok(words.includes('`RUN-FAILED: prompt-line-unstamped`, write nothing'));
  const person = section();
  assert.ok(person.includes('`at` as a UTC stamp'), 'an answer file with no valid at is not usable');
  assert.ok(person.includes('not earlier than the request\'s `asked_at`'), 'a file from an earlier round answers nothing');
  assert.ok(person.includes('never gets one from a clock'));
});

test('the words send a person to a place they can find, and no longer to "there"', () => {
  assert.ok(!section().includes('take it up there'));
  assert.ok(section().includes('add no other step, and no line of your own to send, except what a denial names'));
});

test('a stamped line that differs from what is written is refused, after the already-answered check', () => {
  const words = flat(GATES);
  const refusal = 'Still set, and the line\'s option differs from an `answer` block already in the request or from the answer file the fold copies → print `GATE-INVALID: <reason>`, naming both, write nothing, stay suspended.';
  assert.ok(words.includes(refusal));
  assert.ok(words.indexOf('print `GATE-ALREADY-ANSWERED`') < words.indexOf(refusal), 'an answered gate still reads as answered');
  assert.ok(words.indexOf(refusal) < words.indexOf('4. Otherwise record,'), 'refused before anything is written');
  const set = words.slice(words.indexOf('**A question set answered.**'), words.indexOf('**`held-approval` answered.**'));
  assert.ok(set.includes('A line that differs from what is written is refused the same way.'));
});

test('a session is told to read the reference with the read tool before it reaches the reference', () => {
  assert.ok(flat(SKILL).includes('Read the reference with the read tool, never through a shell: a host may deny shell calls on a waiting run.'));
});

test('every route to a resume is sent to the first-line rule', () => {
  assert.ok(flat(SKILL).includes('takes its first line through `references/gates.md` § *Driver-suspended mode — resume*'));
  assert.ok(GATES.includes('## Driver-suspended mode — resume'));
});

test('a stamped fold records the line\'s at, answerer and option', t => {
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  const request = path.join(gates, `${GATE}.request.yml`);
  const head = [
    'version: 1',
    `node: ${GATE}`,
    'kind: approval',
    'question: "Specification complete. Continue?"',
    'multiple: false',
    'options:',
    '  - {id: continue-to-audit, label: "Continue to the audit"}',
    'asked_at: "2026-01-05T09:00:00Z"',
  ].join('\n');
  fs.writeFileSync(request, `${head}\nanswer: null\n`);
  refreshIndex(run.dir);
  write(run, {
    orchestrator: { gate_pending: { node: GATE, request: `gates/${GATE}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [GATE]: { status: 'suspended' } },
  });

  // The line's fields, as a GATE-ANSWER carries them, and the file the driver wrote beside the request.
  const answerFile = path.join(gates, `${GATE}.answer.dana.yml`);
  fs.writeFileSync(answerFile, 'answer:\n  option: continue-to-audit\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n');
  const { answer } = parse(fs.readFileSync(answerFile, 'utf8'));

  // Step 4 by editor tools, then the re-validation.
  const block = Object.entries(answer).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}\n`).join('');
  fs.writeFileSync(request, `${head}\nanswer:\n${block}`);
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${GATE}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  const item = `{option: ${answer.option}, answered_by: ${answer.answered_by}, at: "${answer.at}", via: ${answer.via}}`;
  fs.writeFileSync(run.state, `${text}  ${GATE}:\n    decisions:\n      - ${item}\n    status: completed\n`);
  write(run, {});

  const state = readState(run);
  assert.equal(state.orchestrator.gate_pending, null);
  const [decision] = state.node_summaries[GATE].decisions;
  assert.equal(decision.at, answer.at, 'the time is the turn\'s stamp, never a clock\'s');
  assert.equal(decision.answered_by, 'dana');
  assert.equal(decision.option, 'continue-to-audit');
  assert.equal(decision.by, 'operator');
});
