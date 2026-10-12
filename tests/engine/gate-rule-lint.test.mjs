import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The gate-rule sentence is copied, byte for byte, into several files, and
// `make validate` holds the copies at an exact count. That lint is the one
// enforcement; this test only holds the string it counts to the sentence the
// engine skill carries in Step 0.

const MAKEFILE = path.join(ROOT, 'Makefile');
const ENGINE_SKILL = path.join(ROOT, 'plugins/maister/skills/workflow-engine/SKILL.md');
const LINT_HEADING = 'Checking the gate-rule sentence is identical in every copy...';

/** The lint's recipe lines, as the shell receives them from make. */
function lintRecipe() {
  const lines = fs.readFileSync(MAKEFILE, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes(LINT_HEADING));
  assert.ok(start >= 0, 'the Makefile has the gate-rule lint step');
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('\t') || line.startsWith('\t@echo "Checking')) break;
    body.push(line);
  }
  assert.ok(body.length > 0, 'the lint step has recipe lines after its heading');
  // Undo make's quoting: the leading tab and @, and $$ for a literal $.
  return body.map((l) => l.replace(/^\t@?/, '').replace(/\$\$/g, '$')).join('\n');
}

function quoted(recipe, name) {
  const m = recipe.match(new RegExp(`\\b${name}='([^']*)'`));
  assert.ok(m, `the lint holds ${name} in single quotes`);
  return m[1];
}

function stepZeroSentence() {
  const text = fs.readFileSync(ENGINE_SKILL, 'utf8');
  const m = text.match(/Invoke `AskUserQuestion` (when `orchestrator\.driver\.kind` is absent[^\n]*?§ E2\.)/);
  assert.ok(m, 'the engine skill carries the gate-rule sentence in Step 0');
  return m[1];
}

test('the Makefile\'s full sentence is the engine skill\'s Step 0 sentence', () => {
  assert.equal(quoted(lintRecipe(), 'full'), stepZeroSentence(), 'the full string is the Step 0 sentence, byte for byte');
});
