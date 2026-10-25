import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';
import { lintText } from '../dispatch-command-lint.mjs';

// The dispatch-command lint runs as `make validate` runs it: a child process,
// its findings on stdout. Each offence is planted in a scratch root of its own,
// so a test sees exactly the FAIL lines it provokes. The pure `lintText` is
// exercised directly for the span-reading cases.

const LINT = path.join(ROOT, 'tests/dispatch-command-lint.mjs');
const REASON = 'invokes `dispatch-model` without the script; write `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs dispatch-model …`';
const RUNNABLE = 'node ${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister:docs-operator --host=claude';

function lint(...args) {
  return run(LINT, args, undefined, {}, ROOT);
}

/** A scratch root with clean plugin trees, plus `files` written into it. */
function plant(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-dispatch-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    'plugins/maister/skills/s/SKILL.md': `# S\n\nSend it with the model and effort \`${RUNNABLE}\` prints.\n`,
    'plugins/maister-copilot/skills/s/SKILL.md': `# S\n\n\`dispatch-model\` resolves the model.\n`,
  };
  for (const [name, text] of Object.entries({ ...base, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);

test('dispatch-command-lint: a clean scratch root passes', t => {
  const result = lint(`--root=${plant(t)}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('dispatch-command-lint: a bare invocation fails in either tree and exits 1', t => {
  const result = lint(`--root=${plant(t, {
    'plugins/maister/agents/a.md': '---\nname: a\n---\n\nRun `dispatch-model --agent=maister:a --host=claude` first.\n',
    'plugins/maister-copilot/commands/c.md': 'Run `dispatch-model --agent=maister-copilot:a` first.\n',
  })}`);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.deepEqual(failLines(result), [
    `FAIL: plugins/maister/agents/a.md:5: ${REASON}`,
    `FAIL: plugins/maister-copilot/commands/c.md:1: ${REASON}`,
  ]);
});

test('dispatch-command-lint: a non-markdown file is not read', t => {
  const result = lint(`--root=${plant(t, { 'plugins/maister/hooks/h.mjs': '// `dispatch-model --agent=x`\n' })}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test('dispatch-command-lint: an unknown argument is a usage error', () => {
  const result = lint('--file=x');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});

test('lintText: the runnable form passes, on one line or wrapped', () => {
  assert.deepEqual(lintText(`Run \`${RUNNABLE}\`.\n`), []);
  assert.deepEqual(lintText('Run `node <plugin_root>/skills/workflow-engine/scripts/workflow.mjs\n  dispatch-model --agent=a --host=claude --state=<state> --node=<node>` once.\n'), []);
  assert.deepEqual(lintText('Its values are what `node\n  <plugin_root>/skills/workflow-engine/scripts/workflow.mjs dispatch-model\n  --agent=a` prints.\n'), []);
});

test('lintText: a bare mention of the verb with no flag passes', () => {
  assert.deepEqual(lintText('`dispatch-model` prints what an agent resolves to; run `dispatch-model` for it with `--tier=high`.\n'), []);
});

test('lintText: a bare invocation fails, reported at the line its span opens on', () => {
  assert.deepEqual(lintText('Intro.\n\nRun `dispatch-model --agent=a` now.\n').map(f => f.line), [3]);
});

test('lintText: a bare invocation wrapped across a line break fails at its first line', () => {
  const text = '# T\n\nGive it the model and effort `dispatch-model\n  --agent=maister:docs-operator` prints.\n';
  const findings = lintText(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].span, 'dispatch-model --agent=maister:docs-operator');
});

test('lintText: a CRLF file is reported at the same line as an LF one', () => {
  assert.deepEqual(lintText('Intro.\r\n\r\nRun `dispatch-model\r\n --agent=a` now.\r\n').map(f => f.line), [3]);
});

test('lintText: a span never runs past a paragraph, and fenced blocks are skipped', () => {
  assert.deepEqual(lintText('An open ` tick.\n\nThen dispatch-model --agent=a` in prose.\n'), []);
  assert.deepEqual(lintText('```\nworkflow `dispatch-model --agent=a`\n```\n'), []);
});

test('lintText: a double-backtick span is read whole', () => {
  assert.deepEqual(lintText('Run ``dispatch-model --agent=a` ``.\n').map(f => f.line), [1]);
});
