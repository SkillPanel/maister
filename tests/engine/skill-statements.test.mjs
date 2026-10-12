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
