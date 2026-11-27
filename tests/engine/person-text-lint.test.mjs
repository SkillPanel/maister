import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';
import { lintText } from '../person-text-lint.mjs';

// The person-text lint runs as `make validate` runs it: a child process, its
// findings on stdout. Each offence is planted in a scratch root of its own, so
// a test sees exactly the FAIL lines it provokes; the pure `lintText` is
// exercised directly for the quote forms and the cases that pass.

const LINT = path.join(ROOT, 'tests/person-text-lint.mjs');
const REASON = 'a person\'s text inside quotes; pass it as a block of its own, word for word, never in a quoted string';

function lint(...args) {
  return run(LINT, args, undefined, {}, ROOT);
}

/** A scratch root with clean plugin trees, plus `files` written into it. */
function plant(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-person-text-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    'plugins/maister/skills/s/references/r.md': '# R\n\n```\nAnalyze the code for the task below.\n\n--- task ---\n[description]\n--- end of task ---\n```\n',
    'dist/copilot/skills/s/SKILL.md': '# S\n\nPass the task description word for word.\n',
  };
  for (const [name, text] of Object.entries({ ...base, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);

test('person-text-lint: a clean scratch root passes', t => {
  const result = lint(`--root=${plant(t)}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('person-text-lint: a quoted task placeholder fails in either tree and exits 1', t => {
  const result = lint(`--root=${plant(t, {
    'plugins/maister/skills/codebase-analyzer/references/code-analysis.md': '```\nAnalyze the code related to: "[description]"\n```\n',
    'dist/copilot/commands/work.md': 'Start it with `args: "<workflow_name> \\"<description>\\""`.\n',
  })}`);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.deepEqual(failLines(result), [
    `FAIL: plugins/maister/skills/codebase-analyzer/references/code-analysis.md:2: [description]: ${REASON}`,
    `FAIL: dist/copilot/commands/work.md:1: <description>: ${REASON}`,
  ]);
});

test('person-text-lint: every quote form around a person-text placeholder is a finding', () => {
  const cases = [
    'Find files for: "[description]"',
    'Find files for: \\"[task description]\\"',
    "Find files for: '{task_description}'",
    'Find files for: “<the question>”',
    'Find files for: ‘${inputs.request}’',
    'Run `/maister:quick-design "<the question, else the task>"` next.',
    'Sketch "<the idea>" first.',
  ];
  for (const text of cases) {
    assert.equal(lintText(text).length, 1, text);
  }
});

test('person-text-lint: a block, an unquoted placeholder, a YAML field and non-person names pass', () => {
  const passing = [
    '--- task ---\n[description]\n--- end of task ---',
    'Analyze the code related to [description].',
    'description: "[Brief description]"',
    '  - reason: "[one line the user reads: what in the task points to this type]"  # shown',
    'argument-hint: "[task description]"',
    'args: "[task_path] [flags]"',
    'Open "<the task folder>" and "<task_id>".',
    '/maister:mockup-studio --turn "<note>" --task=<folder>',
    '- "[The screen the task names] and its [dialog] (Recommended)"',
    'Write `{"note": "<the note>"}` to the patch file.',
  ];
  for (const text of passing) {
    assert.deepEqual(lintText(text), [], text);
  }
});

test('person-text-lint: a workflow definition is not read', t => {
  const result = lint(`--root=${plant(t, {
    'plugins/maister/skills/workflow-engine/workflows/w.yml': 'with:\n  note: "the ${inputs.task_description}"\n  task_description: "${inputs.task_description}"\n',
  })}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test('person-text-lint: a named variant that does not exist is a usage error', t => {
  const result = lint(`--root=${plant(t)}`, '--variant=missing');
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /usage: node tests\/person-text-lint\.mjs/);
});

test('person-text-lint: the plugin source passes', () => {
  const result = lint(`--root=${ROOT}`, '--variant=plugins/maister');
  assert.equal(result.code, 0, result.stdout + result.stderr);
});
