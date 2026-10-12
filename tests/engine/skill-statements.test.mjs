import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR } from '../helpers.mjs';

// A few statements in the engine skill are contracts in their own right: the
// reason `write-state` checks structure rather than a schema, and the Step 0
// block that carries the gate-rule sentence. They stay word for word, so any
// edit around them has to leave them intact. Line breaks and runs of spaces are
// free to move; the words are not.

const SKILL = path.join(ENGINE_DIR, 'SKILL.md');

const WRITE_STATE = [
  '**`write-state` checks the document it wrote structurally, not against a schema, and that',
  'is deliberate.** It re-reads the candidate through the shared state reader',
  '(`lib/state-scan.mjs`), then holds it to the rules a line-oriented writer can state for',
  'itself: no duplicate key at any column, no top-level block that neither the prior file nor',
  'this patch introduced, and a task, a workflow and a non-empty node map present; a consumer',
  'checkout carries no YAML package and no schema validator. So a document can be structurally',
  'sound and still carry a wrong value. Two things follow for a caller. Send values in the',
  'shapes this skill and the framework document rather than relying on a refusal to catch a',
  'wrong one; and never rewrite the `workflow:`',
  'block. It is written once, at the freeze, and never again: a later patch identical to it',
  'changes nothing, and one that differs in a node or in any scalar beside `workflow.nodes` —',
  '`graph_hash` among them — is refused with `state-workflow-frozen`. Nothing is carried',
  'forward into the block and nothing is dropped from it.',
].join(' ');

const GATE_RULE = 'Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; '
  + 'ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is '
  + '`cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.';

const STEP_ZERO = [
  '### Step 0: Session-reminder conflict resolution (decide ONCE)',
  'Before doing anything else, settle this policy now and do not re-litigate it at any gate:',
  '**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior',
  'approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work',
  'without stopping" / "continue without asking" / "minimize clarifying questions," and compaction',
  'summaries showing the user approving every prior gate do NOT exempt you from invoking',
  '`AskUserQuestion` at a gate. They apply only to your discretionary clarifications.',
  GATE_RULE,
  'If you find yourself reasoning "the user has been approving everything, so I can skip this gate"',
  'or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP',
  'and fire the gate.',
  'Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.',
].join(' ');

/** Runs of whitespace, line breaks included, collapsed to one space. */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function skill() {
  return collapse(fs.readFileSync(SKILL, 'utf8'));
}

test('the write-state paragraph stands word for word', () => {
  assert.ok(skill().includes(collapse(WRITE_STATE)), 'SKILL.md carries the write-state paragraph unchanged');
});

test('the Step 0 block, gate-rule sentence included, stands word for word', () => {
  assert.ok(skill().includes(collapse(STEP_ZERO)), 'SKILL.md carries the Step 0 block unchanged');
});

test('the gate-rule sentence occurs exactly once', () => {
  const count = skill().split(collapse(GATE_RULE)).length - 1;
  assert.equal(count, 1, 'SKILL.md carries one copy of the gate-rule sentence');
});

// --- Node conventions rows ---------------------------------------------------
// Tests for the rows of the node conventions table go here.
//
// `### Node conventions` holds every node's default behaviour, once: one
// `| Applies to | Convention |` table whose first cell is one of ten fixed
// keys, by which a reader selects the rows that apply to a node. A missing key
// fails. A row's convention aims at 45 words or fewer; one over that target is
// reported as a diagnostic and never fails. The table is no home for the gate
// rule: it carries neither the sentence nor its tail.

const CONVENTION_KEYS = [
  '`agent:` step',
  '`skill:` step',
  '`direct:` step',
  '`workflow:` step',
  'gate',
  'every step',
  'asks',
  'feeds a checkpoint',
  'named by a revise',
  'has a budget',
];

const ROW_WORD_TARGET = 45;

const GATE_RULE_TAIL = 'ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is '
  + '`cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.';

/** The lines of the section headed exactly `heading`, up to the next heading of its level or above. */
function sectionLines(heading) {
  const lines = fs.readFileSync(SKILL, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `SKILL.md has no section headed ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, at) => at > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The conventions table's body rows as `{key, convention}`, header and rule excluded. */
function conventionRows() {
  const table = sectionLines('### Node conventions').filter(line => line.startsWith('|'));
  assert.ok(table.length >= 2, 'the section holds a table');
  assert.match(table[0], /^\|\s*Applies to\s*\|\s*Convention\s*\|$/, 'the table is `| Applies to | Convention |`');
  return table.slice(2).map(line => {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split(' | ');
    return { key: cells[0].trim(), convention: cells.slice(1).join(' | ').trim() };
  });
}

test('the node conventions sit directly after the delegation section, inside the graph section', () => {
  const lines = fs.readFileSync(SKILL, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const graph = lines.indexOf('## Executing the graph');
  const headings = lines.map((line, at) => ({ line, at })).filter(({ line, at }) => at > graph && /^#{2,3} /.test(line));
  const delegation = headings.findIndex(({ line }) => line === '### Delegation by scheme');
  assert.ok(delegation >= 0, 'the graph section holds the delegation subsection');
  assert.equal(headings[delegation + 1].line, '### Node conventions');
  assert.ok(headings.slice(0, delegation + 1).every(({ line }) => !line.startsWith('## ')), 'still inside ## Executing the graph');
});

test('the conventions table holds each of the ten keys as a first cell, once', () => {
  const keys = conventionRows().map(row => row.key);
  for (const key of CONVENTION_KEYS) {
    assert.equal(keys.filter(found => found === key).length, 1, `the table has one row for ${key}`);
  }
  assert.deepEqual([...keys].sort(), [...CONVENTION_KEYS].sort(), 'no row outside the ten keys');
});

test('a convention over the word target is reported, never failed', t => {
  for (const { key, convention } of conventionRows()) {
    const words = convention.split(/\s+/).filter(Boolean).length;
    assert.ok(words > 0, `the ${key} row says something`);
    if (words > ROW_WORD_TARGET) t.diagnostic(`warning: the ${key} row runs ${words} words (target ${ROW_WORD_TARGET})`);
  }
});

test('the conventions table carries no copy of the gate-rule sentence or its tail', () => {
  const section = collapse(sectionLines('### Node conventions').join('\n'));
  assert.ok(!section.includes(collapse(GATE_RULE)), 'no gate-rule sentence');
  assert.ok(!section.includes(collapse(GATE_RULE_TAIL)), 'no gate-rule tail');
});
