import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';
import { lintText } from '../plugin-path-lint.mjs';

// The plugin-path lint runs as `make validate` runs it: a child process, its
// findings on stdout. Each offence is planted in a scratch root of its own, so
// a test sees exactly the FAIL lines it provokes. The pure `lintText` is
// exercised directly for the span-reading cases.

const LINT = path.join(ROOT, 'tests/plugin-path-lint.mjs');
const SKILLS = new Set(['implementation-verifier', 'orchestrator-framework']);
const CONTRACT = 'implementation-verifier/references/review-findings.md';

function lint(...args) {
  return run(LINT, args, undefined, {}, ROOT);
}

/** A scratch root with two skill directories in the source tree, plus `files` written into it. */
function plant(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-plugin-path-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    [`plugins/maister/skills/${CONTRACT}`]: '# Contract\n',
    'plugins/maister/skills/orchestrator-framework/SKILL.md': '# Framework\n',
  };
  for (const [name, text] of Object.entries({ ...base, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);

test('plugin-path-lint: the repository passes', () => {
  const result = lint();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('plugin-path-lint: a bare plugin path in an agent or a workflow guide fails, with the absolute spelling to write', t => {
  const root = plant(t, {
    'plugins/maister/agents/a.md': `# A\n\nFollow the contract (\`${CONTRACT}\`).\n`,
    'plugins/maister/skills/workflow-engine/workflows/w.md': '## `step`\n\nRead `skills/orchestrator-framework/SKILL.md` first.\n',
  });
  const result = lint(`--root=${root}`);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.deepEqual(failLines(result), [
    `FAIL: plugins/maister/agents/a.md:3: \`${CONTRACT}\` names a plugin file relative to nothing a reader has; write \`<plugin root>/skills/${CONTRACT}\``,
    'FAIL: plugins/maister/skills/workflow-engine/workflows/w.md:3: `skills/orchestrator-framework/SKILL.md` names a plugin file relative to nothing a reader has; write `<plugin root>/skills/orchestrator-framework/SKILL.md`',
  ]);
});

test('plugin-path-lint: a skill file and its references are not read — a skill runs with its base directory', t => {
  const result = lint(`--root=${plant(t, {
    'plugins/maister/skills/orchestrator-framework/references/r.md': `See \`${CONTRACT}\`.\n`,
  })}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test('plugin-path-lint: the spans that pass', () => {
  const passing = [
    `\`<plugin root>/skills/${CONTRACT}\``,
    `\`<plugin_root>/skills/${CONTRACT}\``,
    `\`\${CLAUDE_PLUGIN_ROOT}/skills/${CONTRACT}\``,
    // A project path, a task-relative path and a skill the tree does not have.
    '`.maister/docs/standards/global/coding-style.md`',
    '`verification/test-suite-findings.json`',
    '`references/in-node-questions.md`',
    '`unknown-skill/references/x.md`',
    // A path that only mentions a skill inside a longer command.
    `\`node <plugin root>/skills/${CONTRACT}\``,
  ];
  for (const span of passing) assert.deepEqual(lintText(`Read ${span}.\n`, SKILLS), [], span);
  // A fenced block is an example, never read.
  assert.deepEqual(lintText(`\`\`\`\n\`${CONTRACT}\`\n\`\`\`\n`, SKILLS), []);
});

test('plugin-path-lint: a span wrapped across lines is matched whole and reported where it opens', () => {
  assert.deepEqual(lintText('First line,\nthen `orchestrator-framework/references/\nbrowser-tools.md` here.\n', SKILLS),
    [{ line: 2, span: 'orchestrator-framework/references/ browser-tools.md' }]);
});

test('plugin-path-lint: an unknown argument is a usage error', () => {
  const result = lint('--bogus');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^usage: node tests\/plugin-path-lint\.mjs/);
});
