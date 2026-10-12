import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../helpers.mjs';

// The gate-rule sentence is copied, byte for byte, into the hand-offs, the
// engine's Step 0, the framework patterns, the two reminder hooks and
// CLAUDE.md. `make validate` holds the copies at an exact count, so a copy that
// drifts, is lost or is added unannounced fails the build. These tests hold the
// lint to the sentence the engine skill carries, run its recipe lines, and hold
// the decision record that explains it.

const MAKEFILE = path.join(ROOT, 'Makefile');
const ENGINE_SKILL = path.join(ROOT, 'plugins/maister/skills/workflow-engine/SKILL.md');
const DECISIONS = path.join(ROOT, 'docs/decisions');
const ADR = path.join(DECISIONS, '0043-run-context-and-declared-companions.md');
const INDEX = path.join(DECISIONS, 'README.md');

// The copies as they stand. A copy added on purpose is added here, in the
// Makefile's count and in CLAUDE.md's list of copies, together.
const SHARED = [
  'CLAUDE.md',
  'plugins/maister-copilot/skills/development/SKILL.md',
  'plugins/maister-copilot/skills/migration/SKILL.md',
  'plugins/maister-copilot/skills/orchestrator-framework/references/orchestrator-patterns.md',
  'plugins/maister-copilot/skills/performance/SKILL.md',
  'plugins/maister-copilot/skills/product-design/SKILL.md',
  'plugins/maister-copilot/skills/research/SKILL.md',
  'plugins/maister-copilot/skills/workflow-engine/SKILL.md',
  'plugins/maister/skills/development/SKILL.md',
  'plugins/maister/skills/migration/SKILL.md',
  'plugins/maister/skills/orchestrator-framework/references/orchestrator-patterns.md',
  'plugins/maister/skills/performance/SKILL.md',
  'plugins/maister/skills/product-design/SKILL.md',
  'plugins/maister/skills/research/SKILL.md',
  'plugins/maister/skills/workflow-engine/SKILL.md',
];
const FULL_FILES = [...SHARED].sort();
const TAIL_FILES = [
  ...SHARED,
  'plugins/maister/hooks/post-compact-reminder.sh',
  'plugins/maister/hooks/skill-invocation-reminder.sh',
].sort();

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

function filesCarrying(needle) {
  const found = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs)) walk(path.join(rel, entry));
    } else if (fs.readFileSync(abs, 'utf8').includes(needle)) {
      found.push(rel.split(path.sep).join('/'));
    }
  };
  walk('CLAUDE.md');
  walk('plugins');
  return found.sort();
}

test('the Makefile holds the full sentence and its tail, equal to the engine skill\'s Step 0 sentence', () => {
  const recipe = lintRecipe();
  const full = quoted(recipe, 'full');
  const tail = quoted(recipe, 'tail');
  const sentence = stepZeroSentence();
  assert.equal(full, sentence, 'the full string is the Step 0 sentence, byte for byte');
  assert.equal(tail, sentence.slice(sentence.indexOf('ask at every gate;')), 'the tail starts at "ask at every gate;"');
  assert.match(recipe, /grep -rlF -- "\$full" CLAUDE\.md plugins\//, 'the full sentence is counted over CLAUDE.md and plugins/');
  assert.match(recipe, /grep -rlF -- "\$tail" CLAUDE\.md plugins\//, 'the tail is counted over CLAUDE.md and plugins/');
  assert.match(recipe, /\bwant_full=15;/, 'exactly 15 copies of the full sentence');
  assert.match(recipe, /\bwant_tail=17;/, 'exactly 17 copies of the tail');
});

test('exactly 15 files carry the full sentence and 17 the tail, and the recipe passes there and fails at a wrong count', () => {
  const recipe = lintRecipe();
  assert.deepEqual(filesCarrying(quoted(recipe, 'full')), FULL_FILES);
  assert.deepEqual(filesCarrying(quoted(recipe, 'tail')), TAIL_FILES);

  const pass = spawnSync('sh', ['-c', recipe], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(pass.status, 0, `the lint passes: ${pass.stdout}${pass.stderr}`);
  assert.match(pass.stdout, /15 .*17/, 'the passing lint prints both counts');

  const wrong = spawnSync('sh', ['-c', recipe.replace('want_full=15;', 'want_full=16;')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(wrong.status, 1, 'a wrong expected count fails');
  assert.match(wrong.stdout, /FAIL: .*15.*16 expected.*17/s, 'the failure prints both counts');
  assert.ok(wrong.stdout.includes('plugins/maister/hooks/skill-invocation-reminder.sh'), 'the failure lists the files found');
});

test('ADR-0043 exists with its status, context, eight decisions, options and consequences', () => {
  const text = fs.readFileSync(ADR, 'utf8');
  assert.match(text, /^# ADR-0043 — Run context and HTML companions are fetched, declared and checked\n/);
  assert.match(text, /\*\*Status\*\*: Accepted/);
  for (const adr of ['ADR-0012', 'ADR-0029', 'ADR-0030']) assert.ok(text.includes(adr), `builds on ${adr}`);
  assert.ok(text.includes('No definition\'s graph hash moves'), 'the status says no hash moves');
  for (const heading of ['## TL;DR', '### Status', '### Context', '### Decision', '### Considered options', '### Consequences']) {
    assert.ok(text.includes(`\n${heading}\n`), `has ${heading}`);
  }
  const decision = text.slice(text.indexOf('\n### Decision\n'), text.indexOf('\n### Considered options\n'));
  const items = decision.match(/^\d+\. /gm) ?? [];
  assert.equal(items.length, 8, 'the decision has eight numbered items');
  for (const term of ['run-context', 'prior-context --node', 'html_companions', 'companion-missing:', 'missing-companion:',
    'html: <path>', 'companion:', 'rules:', "'\\''", '--patch-file', 'heredoc']) {
    assert.ok(decision.includes(term), `the decision names ${term}`);
  }
});

test('the index has the ADR-0043 row, ADR-0012\'s row records the amendment, and the TL;DR counts the rows', () => {
  const text = fs.readFileSync(INDEX, 'utf8');
  assert.ok(text.includes('| [ADR-0043](0043-run-context-and-declared-companions.md) | Run context and HTML companions are fetched, declared and checked | Accepted |'));
  const row12 = text.split('\n').find((l) => l.startsWith('| [ADR-0012]'));
  assert.ok(row12, 'ADR-0012 has a row');
  assert.match(row12, /ADR-0043/, 'ADR-0012\'s row names the amendment');
  assert.match(row12, /here-string/, 'ADR-0012\'s row says what was amended');
  const rows = text.split('\n').filter((l) => /^\| \[ADR-\d{4}\]/.test(l)).length;
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const tens = { 3: 'Thirty', 4: 'Forty', 5: 'Fifty' };
  const spelt = `${tens[Math.floor(rows / 10)]}${rows % 10 ? '-' + words[rows % 10] : ''}`;
  const tldr = text.slice(text.indexOf('## TL;DR'), text.indexOf('## Key Decisions'));
  assert.ok(tldr.includes(`${spelt} decisions`), `the TL;DR counts ${rows} decisions as "${spelt}"`);
});
