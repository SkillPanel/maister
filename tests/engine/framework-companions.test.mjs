import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../helpers.mjs';

// The framework reference and the post-compaction hook are prose a model reads.
// These tests hold the parts of that prose the run-context and companion
// contracts depend on: § 9 says where companions are declared and how a delegate
// learns about them, § 3 pastes the run-context block, the hook points at the
// engine's state shape, and the gate-rule sentence keeps every copy.

const FRAMEWORK = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework');
const PATTERNS = path.join(FRAMEWORK, 'references/orchestrator-patterns.md');
const HOOK = path.join(ROOT, 'plugins/maister/hooks/post-compact-reminder.sh');

const TAIL = 'ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.';
const FULL = 'when `orchestrator.driver.kind` is absent or `terminal`; ' + TAIL;

function section(text, heading, next) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} is present`);
  const end = next ? text.indexOf(next, start) : text.length;
  assert.ok(end > start, `${next} follows ${heading}`);
  return text.slice(start, end);
}

test('§ 9 keeps its heading, drops the companion table and names the declaration and the delegate contract', () => {
  const text = fs.readFileSync(PATTERNS, 'utf8');
  const nine = section(text, '## 9. HTML Companion Reports', '## 10. ');
  assert.doesNotMatch(nine, /\| Artifact \(md\) \|/, 'the table header is gone');
  assert.doesNotMatch(nine, /\| `implementation\/spec\.md` \|/, 'the table rows are gone');
  assert.doesNotMatch(nine, /html_style_guide_path/, 'the retired input is not named');
  for (const term of ['`html_companions`', '`html:', '`companion:', '`companion-missing:', 'html-companion-writer']) {
    assert.ok(nine.includes(term), `§ 9 names ${term}`);
  }
  assert.match(nine, /not-requested/, '§ 9 says what an absent html: line means');
  const ten = section(text, '## 10. ', null);
  assert.match(ten, /`run-complete`/, '§ 10 names run-complete');
  assert.match(ten, /missing-companion:/, '§ 10 names the missing-companion line');
});

test('§ 3 template pastes the run-context block rather than hand-listed fields', () => {
  const text = fs.readFileSync(PATTERNS, 'utf8');
  const three = section(text, '## 3. Context Passing & Decisions', '## 4. ');
  const template = three.slice(three.indexOf('```'), three.indexOf('```', three.indexOf('```') + 3));
  assert.match(template, /run-context --state/, 'the template names run-context');
  assert.match(template, /prior-context --state[^\n]*--node/, 'the template names prior-context --node');
  assert.doesNotMatch(template, /ARTIFACT SUMMARY CONTRACT/, 'the summary contract comes from the block, not a hand-written section');
  assert.doesNotMatch(three, /§ \*Executing a node\*/, 'the stale citation is gone');
  assert.match(three, /\*Delegation by scheme\*/, 'the citation names Delegation by scheme');
});

test('the post-compact hook points at workflow.nodes and run-context and keeps the gate-rule tail', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister framework '));
  fs.mkdirSync(path.join(project, '.maister', 'tasks'), { recursive: true });
  const result = spawnSync('bash', [HOOK], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /`workflow\.nodes`/);
  assert.match(context, /`run-context`/);
  assert.doesNotMatch(context, /completed_phases/);
  assert.ok(context.endsWith(TAIL), 'the hook ends with the gate-rule tail clause');
  assert.ok(!fs.readFileSync(HOOK, 'utf8').includes('\r'), 'the hook stays LF');
});

test('the gate-rule sentence keeps fifteen full copies and seventeen tail copies', () => {
  const files = [path.join(ROOT, 'CLAUDE.md')];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(path.join(ROOT, 'plugins'));
  const carrying = needle => files.filter(file => fs.readFileSync(file, 'utf8').includes(needle));
  assert.equal(carrying(FULL).length, 15, carrying(FULL).join('\n'));
  assert.equal(carrying(TAIL).length, 17, carrying(TAIL).join('\n'));
});
