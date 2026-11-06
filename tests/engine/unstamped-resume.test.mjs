import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, write } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// A first line from a person: the session folds a recorded answer as a stamped
// line would, or refuses in fixed words. A session follows the prose, so the
// words are pinned here; the fold is the writer's, and that part is run.

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
    'This run is waiting on an answer, and nothing was recorded. Answer where the question was asked, then carry on.',
    'This run is not waiting on an answer, and nothing was recorded. It is driven from where it was started: carry on there.',
    'No run here is waiting on an answer, and nothing was recorded. Say which run to carry on.',
    'Several runs are waiting on an answer, and nothing was recorded. Say which one to carry on.',
  ]) assert.ok(words.includes(sentence), `missing: ${sentence}`);
});

test('the refusal that sends a person to answer is kept for when no answer is on disk', () => {
  const words = section();
  const send = 'Answer where the question was asked';
  assert.equal(words.split(send).length, 2, 'said once');
  assert.ok(words.indexOf('`answer_state` is `none`') < words.indexOf(send) && words.indexOf(send) < words.indexOf('`answer_state` is `unusable`'));
  for (const sentence of [
    'This run is waiting on an answer, and nothing was recorded. An answer is on disk but cannot be used: <each file\'s name and reason>. It is driven from where it was started: take it up there.',
    'This run is waiting on an answer, and nothing was recorded. Several answers are on disk and nothing says which one stands. It is driven from where it was started: take it up there.',
  ]) assert.ok(words.includes(sentence), `missing: ${sentence}`);
  assert.ok(words.includes('the `unusable` words with that reason, then `GATE-INVALID: <reason>`'), 'an answer the request does not offer');
});

test('a session is sent to the verb first, and no answer comes from the session itself', () => {
  const words = section();
  assert.ok(words.includes('never take an answer from the person in the session, and never record one yourself'));
  assert.ok(words.includes('An answer comes from a stamped line or a usable answer file and from nowhere else'));
  assert.ok(words.indexOf('never take an answer') < words.indexOf('Try `resume-check` first'), 'the prohibition is read first');
  assert.ok(words.includes('`resume-check --state=<run directory>/orchestrator-state.yml`'));
  assert.ok(words.includes('`resume-check` with no flags'));
  assert.ok(words.includes('absolute path under the plugin root'));
  assert.ok(words.includes('never list `gates/`, guess an answer file\'s name or judge a file again'));
  assert.ok(flat(SKILL).includes('never takes an answer from the person in the session and never records one itself'));
});

test('a denied call has one truthful outcome, the read as much as a write, and no sentence promises the shell', () => {
  const words = flat(GATES);
  assert.ok(!words.includes('A write denied on this path'));
  const start = words.indexOf('**A call denied on this path.**');
  assert.ok(start > 0, 'gates.md carries the paragraph');
  const paragraph = words.slice(start, words.indexOf('**A question set answered.**'));
  assert.ok(paragraph.includes('may deny `resume-check` there as well'));
  assert.ok(paragraph.includes('or denies that `resume-check`, nothing was recorded'));
  assert.ok(paragraph.includes('tell the person so and what the denial says to do, and try no other way'));
  assert.ok(paragraph.includes('What the denial names wins over the fixed words in this section'));
  assert.ok(!words.includes('shell calls cannot run'), 'true on a host that allows the read and on one that denies it');
  assert.equal(words.split('a host may deny the engine\'s shell calls').length, 3);
});

test('the stamp stays the contract: a stamped shape with no at= still fails, and only the answer file stands in for it', () => {
  const words = flat(GATES);
  assert.ok(words.includes('A line in one of the five shapes with no `at=` is below the contract'));
  assert.ok(words.includes('`RUN-FAILED: prompt-line-unstamped`, write nothing'));
  const person = section();
  assert.ok(person.includes('`at` as a UTC stamp'), 'an answer file with no valid at is not usable');
  assert.ok(person.includes('not earlier than the request\'s `asked_at`'), 'a file from an earlier round answers nothing');
  assert.ok(person.includes('never gets one from a clock'));
  assert.ok(person.includes('`GATE-INVALID: <reason>` as the last line'), 'the marker is read off the last line');
});

test('every route to a resume is sent to the first-line rule', () => {
  assert.ok(flat(SKILL).includes('takes its first line through `references/gates.md` § *Driver-suspended mode — resume*'));
  assert.ok(GATES.includes('## Driver-suspended mode — resume'));
});

test('a fold from the answer file alone records the file\'s own at, answerer and option', t => {
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

  // Everything the session has: the answer file the driver wrote, and no line.
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
  assert.equal(decision.at, answer.at, 'the time is the answer file\'s, never a clock\'s');
  assert.equal(decision.answered_by, 'dana');
  assert.equal(decision.option, 'continue-to-audit');
  assert.equal(decision.by, 'operator');
});
