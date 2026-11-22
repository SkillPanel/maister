import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR } from '../helpers.mjs';
import { CLASS_WORDS, classWords } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';
import { CLASSES } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';
import { moreDetails, plainPicker } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// A question's class is printed for a person in words, never as the policy's
// id: the checkpoint, the gate brief and the dashboard read one table.

const WORDS = {
  'decide-alone': 'the run decides it alone',
  record: 'recorded for you',
  consult: 'needs advice',
  approve: 'needs your approval',
};

// A Windows checkout may give the page CRLF line ends; the slicing below looks for LF.
const html = fs.readFileSync(path.join(ENGINE_DIR, '../../skills/orchestrator-framework/assets/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');

/** The page's class table and its chip helper, lifted from the page's script and run in a bare context. */
function page() {
  const escFrom = html.indexOf('function esc(');
  const words = html.indexOf('const CLASS_WORDS');
  const onBehalf = html.indexOf('function onBehalf(');
  const marks = html.indexOf('function triageMarks(');
  assert.ok(escFrom >= 0 && words >= 0 && onBehalf >= 0 && marks >= 0, 'the class table and the chip helper are in the page');
  const block = from => html.slice(from, html.indexOf('\n}\n', from) + 3);
  const context = vm.createContext({});
  vm.runInContext(`${block(escFrom)}\n${html.slice(words, html.indexOf('\n', words) + 1)}\n${block(onBehalf)}\n${block(marks)}\nthis.CLASS_WORDS = CLASS_WORDS; this.triageMarks = triageMarks;`, context);
  return context;
}

/** A gate checkpoint whose run settled one decision of each class and holds one approval. */
function classedCheckpoint() {
  return {
    kind: 'gate',
    node: 'scope-approval',
    ask: 'Scope ready. Go on?',
    header: 'Scope',
    headline: 'Scoped the work.',
    progress: { checkpoint: 1, checkpoints_max: 3 },
    next: { node: 'build', title: 'Build', end: false, skipped: [] },
    review: [],
    closed: [{ node: 'scoping', title: 'Scoping', summary: 'Scoped.' }],
    fixes: [],
    held: [{ node: 'scoping', question_id: 'signed', question: 'Which sign-off?', decision: 'Sign-off A', class: 'approve', rationale: 'A is safe.' }],
    decisions: {
      run: [
        { node: 'scoping', decision: 'Quick A', class: 'decide-alone', rationale: 'Routine.' },
        { node: 'scoping', decision: 'Noted A', class: 'record', rationale: 'A fact.' },
      ],
      audit: [],
      default: [{ node: 'scoping', decision: 'Asked A', class: 'consult' }],
      operator: { count: 0, not_recommended: [] },
    },
    risks: {},
    options: [{ id: 'continue', label: 'Continue', effect: 'continue', recommended: true, consequence: 'Goes on.' }],
  };
}

test('class words: one reader word for every policy class, and an unknown id reads as itself', () => {
  assert.deepEqual(Object.keys(CLASS_WORDS), CLASSES);
  assert.deepEqual(CLASS_WORDS, WORDS);
  for (const id of CLASSES) assert.equal(classWords(id), WORDS[id]);
  assert.equal(classWords('unknown'), 'unknown');
});

test('class words: the dashboard reads the same table, and its chip shows the words', () => {
  const { CLASS_WORDS: pageWords, triageMarks } = page();
  assert.deepEqual({ ...pageWords }, CLASS_WORDS);
  assert.equal(triageMarks({ triage: { class: 'approve', held: true } }), '<span class="src held">Held</span><span class="src cls">needs your approval</span>');
  assert.equal(triageMarks({ triage: { class: 'consult' } }), '<span class="src cls">needs advice</span>');
  assert.equal(triageMarks({ triage: { class: 'other' } }), '<span class="src cls">other</span>');
});

test('class words: the checkpoint glance and More details print the words, never an id', () => {
  const checkpoint = classedCheckpoint();
  const glance = plainPicker(checkpoint).question;
  const details = moreDetails(checkpoint);
  for (const text of [glance, details]) {
    for (const id of CLASSES) assert.doesNotMatch(text, new RegExp(`\\(${id}\\)`), text);
  }
  assert.match(glance, /^- Quick A \(the run decides it alone\): Routine\. — scoping$/m);
  assert.match(glance, /^- Asked A \(needs advice\) — default$/m);
  assert.match(details, /- Which sign-off\?: Sign-off A \(needs your approval\) — A is safe\./);
  assert.match(details, /- Quick A \(the run decides it alone\) — Routine\./);
  assert.match(details, /- Noted A \(recorded for you\) — A fact\./);
  assert.match(details, /- Asked A \(needs advice\) — default/);
});
