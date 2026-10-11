import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, readState, scratch, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';
import { readState as umbrellaState } from '../../plugins/maister/skills/umbrella/scripts/lib/envelope.mjs';

// Prose in a block position — a summary, a decision's text — is written as a
// JSON string whenever it carries a quote, a colon, a `#` or a control
// character, so an inner quote reaches the file as `\"`. Every reader of those
// positions has to find the real closing quote: one that stops at the escaped
// quote cuts the value at the next ` #` or comma, and the writer, which reads
// held summaries back to re-emit them, then stores the cut value.

const TRICKY = [
  'Keep the 5" limit # for now',
  'A path ending in a backslash\\',
  'An escaped backslash before a quote \\\\" # still one value',
  '{not a flow map',
  '[not a list',
  "It's the reviewer's call # noted",
  'Quote then comma", x: y',
  'Three "quotes" and one more " # here',
];

const CONTROLS = ['Two "quoted" words', 'A plain value'];

function decisionsOf(values) {
  return values.map(value => ({ decision: value, answer: value, question: value, recommended: value, by: 'run' }));
}

test('a summary and its decisions read back exactly, whatever quotes they carry', t => {
  const run = scratch(t);
  freeze(run);
  const values = [...TRICKY, ...CONTROLS];
  values.forEach((value, index) => {
    const node = index % 2 === 0 ? 'analysis' : 'approval';
    write(run, { node_summaries: { [node]: { summary: value, decisions: decisionsOf([value]) } } });
    const summary = readState(run).node_summaries[node];
    assert.equal(summary.summary, value, `summary ${JSON.stringify(value)}`);
    assert.deepEqual(summary.decisions, decisionsOf([value]), `decision ${JSON.stringify(value)}`);
  });
});

test('the controls keep the bytes the writer has always written', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: CONTROLS[0] }, approval: { summary: CONTROLS[1] } } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^ {4}summary: "Two \\"quoted\\" words"$/m);
  assert.match(text, /^ {4}summary: A plain value$/m);
});

test('a later write to the node leaves a held summary and its decisions as written', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: TRICKY[0], decisions: decisionsOf(TRICKY) } } });
  const before = fs.readFileSync(run.state, 'utf8');
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, { node_summaries: { analysis: { headline: 'Scoped.' } } });
  const after = readState(run).node_summaries.analysis;
  assert.equal(after.summary, TRICKY[0]);
  assert.deepEqual(after.decisions, decisionsOf(TRICKY));
  const line = before.split('\n').find(each => each.trimStart().startsWith('summary:'));
  assert.ok(fs.readFileSync(run.state, 'utf8').includes(line), 'the summary line is re-emitted byte for byte');
});

test('a flow-mapped decision reads each quoted value back exactly', () => {
  for (const value of [...TRICKY, ...CONTROLS]) {
    const doc = parse(`items:\n- {decision: ${JSON.stringify(value)}, rationale: ${JSON.stringify(value)}, by: run}\n`);
    assert.deepEqual({ ...doc.items[0] }, { decision: value, rationale: value, by: 'run' }, JSON.stringify(value));
  }
});

/** A seeded generator, so a failing value is the same value on every run. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ALPHABET = ['"', '"', "'", '\\', '\\', '#', ' ', ' #', ':', ',', '{', '}', '[', ']', 'a', 'b', 'Z', '7', '\t', '\n', '\b', 'é', '😀'];

function randomValues(count, seed) {
  const next = generator(seed);
  const values = [];
  for (let n = 0; n < count; n++) {
    const length = 1 + Math.floor(next() * 24);
    let text = '';
    for (let i = 0; i < length; i++) text += ALPHABET[Math.floor(next() * ALPHABET.length)];
    values.push(text);
  }
  return values;
}

test('20,000 random quote-heavy values read back exactly as a block value and in a flow map', () => {
  for (const value of randomValues(20000, 7)) {
    const spelled = JSON.stringify(value);
    const doc = parse(`summary: ${spelled}\nitems:\n- {decision: ${spelled}, by: run}\n`);
    assert.equal(doc.summary, value, spelled);
    assert.equal(doc.items[0].decision, value, spelled);
  }
});

test('random values sent as decisions through write-state read back exactly', t => {
  const run = scratch(t);
  freeze(run);
  const values = randomValues(300, 11).map(value => value.replace(/^\s+|\s+$/g, '') || 'x');
  write(run, { node_summaries: { analysis: { summary: values[0], decisions: decisionsOf(values) } } });
  const summary = readState(run).node_summaries.analysis;
  assert.equal(summary.summary, values[0]);
  assert.deepEqual(summary.decisions, decisionsOf(values));
});

test('a file at a foreign indent holding an escaped quote is adopted, not refused', t => {
  const run = scratch(t, { fixture: 'unproven' });
  const wide = fs.readFileSync(run.state, 'utf8').replace(/^( +)/gm, spaces => spaces + spaces)
    + `node_summaries:\n    analysis:\n        summary: ${JSON.stringify(TRICKY[0])}\n`;
  fs.writeFileSync(run.state, wide);
  write(run, { nodes: { approval: { status: 'completed' } } });
  assert.equal(readState(run).node_summaries.analysis.summary, TRICKY[0]);
});

test('a summary carrying a control character reads back through the umbrella reader', t => {
  const run = scratch(t);
  freeze(run);
  const values = ['Bell\u0007 and backspace\b and form feed\f', 'Astral 😀 beside \u0001', CONTROLS[0], CONTROLS[1]];
  write(run, { node_summaries: Object.fromEntries([['analysis', { summary: values[0] }], ['approval', { summary: values[1] }]]) });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /\\u0007/, 'the writer spells the control character as a JSON escape');
  let read = umbrellaState(run.dir);
  assert.equal(read.node_summaries.analysis.summary, values[0]);
  assert.equal(read.node_summaries.approval.summary, values[1]);
  write(run, { node_summaries: { analysis: { summary: values[2] }, approval: { summary: values[3] } } });
  read = umbrellaState(run.dir);
  assert.equal(read.node_summaries.analysis.summary, values[2]);
  assert.equal(read.node_summaries.approval.summary, values[3]);
});

test('the umbrella reader decodes a surrogate pair spelled as two escapes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quoted-values-'));
  try {
    fs.writeFileSync(path.join(dir, 'orchestrator-state.yml'), 'summary: "a \\ud83d\\ude00 b \\u00e9"\n');
    assert.equal(umbrellaState(dir).summary, 'a 😀 b é');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
