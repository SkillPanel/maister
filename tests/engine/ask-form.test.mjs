import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, delegating, write as writeState } from '../helpers.mjs';

// `gate-brief --ask` hands a labels-only question tool its call and nothing
// else: a session handed the call beside the parts it is built from rebuilt it
// from the parts, and the user saw bare option ids. Each test reads the whole
// stdout as the call, so a stray key or a second copy of the options fails it.

const write = (run, patch) => writeState(run, delegating(patch));

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const CALL_KEYS = ['message', 'requestedSchema'];

/** A development run waiting at the specification gate, its spec recommending the audit. */
function atSpecGate(t) {
  const run = scratch(t);
  const graph = freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Tag the notes' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'specification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, {
    nodes,
    node_summaries: {
      specification: {
        summary: 'The spec is written.',
        recommends: { option: 'continue-to-spec-audit', reason: 'Cheaper than finding the gaps later' },
        risks: [{ risk: 'Tags are assumed lowercase', tag: 'open', change: 'Fold tag case on input' }, { risk: 'No migration is assumed', tag: 'open', change: 'Backfill old notes' }],
      },
    },
  });
  return run;
}

/** A development run whose verification-options node is running, so it may ask its set. */
function asking(t) {
  const run = scratch(t);
  const graph = freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Tag the notes' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'verification-options') break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, { nodes });
  write(run, { nodes: { 'verification-options': { status: 'running' } } });
  return run;
}

const brief = (run, node, ...flags) => verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, ...flags]);

function callOf(result) {
  assert.equal(result.code, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(call), CALL_KEYS, 'the whole output is the call: a message and a form, nothing beside them');
  return call;
}

test('ask: a gate prints its call alone — the plain profile\'s form, every choice titled, the recommended one marked, More details last', t => {
  const run = atSpecGate(t);
  const call = callOf(brief(run, 'specification-approval', '--ask'));
  const json = JSON.parse(brief(run, 'specification-approval', '--json', '--picker=plain').stdout);
  assert.deepEqual(call, json.form, 'the same call the JSON form carries');
  // Control: the JSON form carries the parts beside the call, which --ask never prints.
  assert.ok(Object.hasOwn(json, 'options') && Object.hasOwn(json, 'question'));
  const decision = call.requestedSchema.properties.decision;
  assert.equal(decision.enum, undefined, 'never a bare list of ids');
  assert.deepEqual(decision.oneOf.map(choice => choice.const), ['continue-to-spec-audit', 'continue-to-planning', 'revise-specification', 'stop-development', 'more-details']);
  assert.ok(decision.oneOf.every(choice => typeof choice.title === 'string' && choice.title !== choice.const), 'every choice has a title of its own');
  assert.match(decision.oneOf[0].title, /\(Recommended\)$/);
  assert.equal(decision.default, 'continue-to-spec-audit');
  assert.equal(call.message.split('\n').at(-1), 'Approve specification?', 'the ask is the message\'s last line');
});

test('ask --note: a chosen revise\'s note question is a call of one property, the suggestions to pick from, none recommended', t => {
  const run = atSpecGate(t);
  const call = callOf(brief(run, 'specification-approval', '--ask', '--note=revise-specification'));
  assert.match(call.message, /^What should change\?/);
  const note = call.requestedSchema.properties.note;
  assert.equal(note.type, 'array');
  assert.deepEqual(note.items.anyOf.map(choice => choice.const), note.items.anyOf.map(choice => choice.title), 'each suggestion is its own note');
  assert.equal(note.items.anyOf.length, 2);
  assert.equal(note.default, undefined, 'no suggestion is chosen in advance');
  assert.deepEqual(call.requestedSchema.required, ['note']);
});

test('ask --note: an option that is not a revise is refused, naming the revises, exit 1', t => {
  const run = atSpecGate(t);
  const refused = brief(run, 'specification-approval', '--ask', '--note=stop-development');
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^gate-brief-note-not-revise: .*\(revise-specification\)/);
});

test('ask --details: the full brief as text, the same the JSON form carries as more_details', t => {
  const run = atSpecGate(t);
  const details = brief(run, 'specification-approval', '--ask', '--details');
  assert.equal(details.code, 0, details.stderr);
  const json = JSON.parse(brief(run, 'specification-approval', '--json', '--picker=plain').stdout);
  assert.equal(details.stdout.trimEnd(), json.more_details.trimEnd());
});

test('ask: --note and --details take --ask, and not each other — exit 2', t => {
  const run = atSpecGate(t);
  for (const flags of [['--note=revise-specification'], ['--details'], ['--json', '--details'], ['--ask', '--note=revise-specification', '--details']]) {
    const result = brief(run, 'specification-approval', ...flags);
    assert.equal(result.code, 2, flags.join(' '));
    assert.match(result.stderr, /^usage:|gate-brief/m, flags.join(' '));
  }
});

/** The user-guide question as the node writes it: a single choice, the recommended one with its reason. */
const USER_GUIDE = {
  questions: [{
    id: 'user-docs',
    header: 'User guide',
    question: 'Write an end-user guide for this change?',
    why: 'Test suite: passed in implementation; runs again after any fix.',
    options: [
      { id: 'off', label: 'No guide', description: 'Recommended: the change adds no public surface.', recommended: true },
      { id: 'on', label: 'Write a guide', description: 'A usage guide with screenshots.' },
    ],
  }, {
    id: 'follow-ups',
    header: 'Follow-ups',
    question: 'Which follow-ups should the guide mention?',
    multi_select: true,
    options: [
      { id: 'migration-note', label: 'Migration note', description: 'How existing settings carry over.' },
      { id: 'null-vs-absent', label: 'Null is not absent', description: 'Reject an explicit null; a missing key takes the default. Suggested: global/validation.md. Seen in src/validate.js.' },
    ],
  }],
};

test('ask --patch-file: a question set in a terminal run is one call, each option\'s words carried where the tool shows them, and the file is gone', t => {
  const run = asking(t);
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(USER_GUIDE));
  const call = callOf(brief(run, 'verification-options', '--ask', `--patch-file=${file}`));
  assert.equal(fs.existsSync(file), false, 'the set has become the call');
  const { properties, required } = call.requestedSchema;
  assert.deepEqual(required, ['user-docs', 'follow-ups']);

  const guide = properties['user-docs'];
  assert.equal(guide.title, 'User guide');
  assert.deepEqual(guide.oneOf, [{ const: 'off', title: 'No guide (Recommended)' }, { const: 'on', title: 'Write a guide' }]);
  assert.equal(guide.default, 'off');
  for (const line of ['Write an end-user guide for this change?', 'Test suite: passed in implementation; runs again after any fix.',
    'No guide: The change adds no public surface.', 'Write a guide: A usage guide with screenshots.', 'Recommended: No guide.']) {
    assert.ok(guide.description.split('\n').includes(line), `the description carries "${line}"`);
  }

  // A multi-select's option descriptions carry where the tool shows them:
  // the user reads them, not bare ids, and nothing is recommended.
  const candidates = properties['follow-ups'];
  assert.equal(candidates.type, 'array');
  assert.deepEqual(candidates.items.anyOf.map(choice => choice.title), ['Migration note', 'Null is not absent']);
  assert.match(candidates.description, /^Null is not absent: Reject an explicit null; a missing key takes the default\. Suggested: global\/validation\.md\. Seen in src\/validate\.js\.$/m);
  assert.doesNotMatch(candidates.description, /Recommended/);
  assert.equal(candidates.default, undefined);
});

/** A one-question set whose options are as given, asked through the form. */
function formOf(t, options) {
  const run = asking(t);
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [{ id: 'bad-filter', header: 'Invalid filter', question: 'What does an invalid ?priority= return?', options }] }));
  return callOf(brief(run, 'verification-options', '--ask', `--patch-file=${file}`)).requestedSchema.properties['bad-filter'];
}

test('ask --patch-file: a label already marked (Recommended) and flagged recommended reads the mark once', t => {
  const form = formOf(t, [
    { id: 'reject', label: 'Return 400 (Recommended)', recommended: true },
    { id: 'ignore', label: 'Ignore it' },
  ]);
  assert.deepEqual(form.oneOf, [{ const: 'reject', title: 'Return 400 (Recommended)' }, { const: 'ignore', title: 'Ignore it' }]);
  assert.ok(form.description.split('\n').includes('Recommended: Return 400.'), form.description);
  assert.doesNotMatch(form.description, /\(Recommended\)/);
  assert.equal(form.default, 'reject');
});

test('ask --patch-file: a mark typed into a label alone recommends that option, and a doubled one is read once', t => {
  const form = formOf(t, [
    { id: 'ignore', label: 'Ignore it' },
    { id: 'reject', label: 'Return 400 (Recommended) (recommended)' },
  ]);
  assert.deepEqual(form.oneOf.map(choice => choice.title), ['Ignore it', 'Return 400 (Recommended)']);
  assert.equal(form.default, 'reject', 'the typed mark is the recommendation the form defaults to');
});

test('ask --patch-file: a typed mark on one option gives way to the flag on another, and is dropped', t => {
  const form = formOf(t, [
    { id: 'ignore', label: 'Ignore it (Recommended)' },
    { id: 'reject', label: 'Return 400', recommended: true },
  ]);
  assert.deepEqual(form.oneOf.map(choice => choice.title), ['Ignore it', 'Return 400 (Recommended)']);
  assert.equal(form.default, 'reject');
});

test('ask --patch-file: a recommendation written only as a description\'s "Recommended:" recommends that option, the reason kept', t => {
  const form = formOf(t, [
    { id: 'off', label: 'No user guide', description: 'Recommended: the change has no UI and the README documents it.' },
    { id: 'on', label: 'Write a user guide', description: 'A usage guide in the task directory.' },
  ]);
  assert.deepEqual(form.oneOf, [{ const: 'off', title: 'No user guide (Recommended)' }, { const: 'on', title: 'Write a user guide' }]);
  assert.equal(form.default, 'off');
  assert.ok(form.description.includes('The change has no UI and the README documents it.'), form.description);
  assert.doesNotMatch(form.description, /Recommended: the change/);
});

test('ask --patch-file: a description\'s "Recommended:" gives way to a flag or a typed mark, and never overrides a flag set to false', t => {
  const flagged = formOf(t, [
    { id: 'off', label: 'No user guide', description: 'Recommended: nothing to document.' },
    { id: 'on', label: 'Write a user guide', recommended: true },
  ]);
  assert.deepEqual(flagged.oneOf.map(choice => choice.title), ['No user guide', 'Write a user guide (Recommended)']);
  assert.equal(flagged.default, 'on');

  const typed = formOf(t, [
    { id: 'off', label: 'No user guide', description: 'Recommended: nothing to document.' },
    { id: 'on', label: 'Write a user guide (Recommended)' },
  ]);
  assert.deepEqual(typed.oneOf.map(choice => choice.title), ['No user guide', 'Write a user guide (Recommended)']);

  const refused = formOf(t, [
    { id: 'off', label: 'No user guide', description: 'Recommended: nothing to document.', recommended: false },
    { id: 'on', label: 'Write a user guide' },
  ]);
  assert.deepEqual(refused.oneOf.map(choice => choice.title), ['No user guide', 'Write a user guide']);
  assert.equal(refused.default, undefined);

  // A description that only mentions a recommendation further in is not read as one.
  const mention = formOf(t, [
    { id: 'off', label: 'No user guide', description: 'Skips the guide the review recommended.' },
    { id: 'on', label: 'Write a user guide' },
  ]);
  assert.deepEqual(mention.oneOf.map(choice => choice.title), ['No user guide', 'Write a user guide']);
});

test('ask --patch-file: a set that fails its check is refused and the file kept; a gate takes no set', t => {
  const run = asking(t);
  const file = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify({ questions: [{ id: 'one', question: 'Pick?', options: [{ id: 'a', label: 'A' }] }] }));
  const refused = brief(run, 'verification-options', '--ask', `--patch-file=${file}`);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^gate-brief-questions-invalid/);
  assert.equal(fs.existsSync(file), true, 'a refusal keeps the file for the caller to correct');
  // Control: the same set without --ask, in a terminal run, is still refused as unsupported by a driver.
  fs.writeFileSync(file, JSON.stringify(USER_GUIDE));
  const driven = brief(run, 'verification-options', '--request', `--patch-file=${file}`);
  assert.equal(driven.code, 1);
  assert.match(driven.stderr, /^gate-brief-questions-unsupported/);
});
