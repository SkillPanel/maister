import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

// The browser-tool lint runs as `make validate` runs it: a child process, its
// findings on stdout. Each offence is planted in a scratch root of its own, so
// a test sees exactly the one FAIL line it provokes.

const LINT = path.join(ROOT, 'tests/browser-tool-lint.mjs');

function lint(...args) {
  return run(LINT, args, undefined, {}, ROOT);
}

/** A scratch root with clean plugin trees, plus `files` written into it. */
function plant(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-browser-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = {
    'plugins/maister/.claude-plugin/plugin.json': '{\n  "name": "maister"\n}\n',
    'plugins/maister/agents/e2e-test-verifier.md': '---\nname: e2e-test-verifier\n---\n\nTake a screenshot.\n',
    'plugins/maister-copilot/agents/e2e-test-verifier.md': '---\nname: e2e-test-verifier\ntools: ["execute", "agent"]\n---\n',
  };
  for (const [name, text] of Object.entries({ ...base, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const failLines = result => result.stdout.split(/\r?\n/).filter(Boolean);

const OFFENCES = [
  ['a shipped .mcp.json', { 'plugins/maister/.mcp.json': '{"mcpServers": {}}\n' },
    "FAIL: plugins/maister/.mcp.json: the plugin ships an MCP server; a browser tool is the user's choice"],
  ['a generated .mcp.json', { 'plugins/maister-copilot/.mcp.json': '{"mcpServers": {}}\n' },
    "FAIL: plugins/maister-copilot/.mcp.json: the plugin ships an MCP server; a browser tool is the user's choice"],
  ['MCP servers in the manifest', { 'plugins/maister/.claude-plugin/plugin.json': '{\n  "name": "maister",\n  "mcpServers": {}\n}\n' },
    'FAIL: plugins/maister/.claude-plugin/plugin.json: the manifest declares MCP servers; the plugin ships none'],
  ['an output folder named', { 'plugins/maister/agents/e2e-test-verifier.md': '---\nname: e2e-test-verifier\n---\n\nCopy from .playwright-mcp/shot.png\n' },
    "FAIL: plugins/maister/agents/e2e-test-verifier.md:5: names `.playwright-mcp/`, one browser tool's output folder; take the path the tool reports"],
  ['plugin-scoped tool names', { 'plugins/maister/skills/s/SKILL.md': 'Call mcp__plugin_maister_playwright__browser_navigate.\n' },
    'FAIL: plugins/maister/skills/s/SKILL.md:1: names `mcp__plugin_maister_playwright__`, the tool names of a bundled browser server; name the capability instead'],
  ['a browser server in a Copilot allowlist', { 'plugins/maister-copilot/agents/e2e-test-verifier.md': '---\nname: e2e-test-verifier\ntools: ["execute", "agent", "playwright/*"]\n---\n' },
    'FAIL: plugins/maister-copilot/agents/e2e-test-verifier.md:3: the tool allowlist grants a browser server the plugin does not ship'],
];

test('browser-tool-lint: the repository passes with nothing printed', () => {
  const result = lint();
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('browser-tool-lint: a clean scratch root passes', t => {
  const result = lint(`--root=${plant(t)}`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
});

test('browser-tool-lint: each offence fails with exactly its own FAIL line and exits 1', async t => {
  for (const [offence, files, expected] of OFFENCES) {
    await t.test(offence, st => {
      const result = lint(`--root=${plant(st, files)}`);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(failLines(result), [expected]);
    });
  }
});

test('browser-tool-lint: a CRLF file is reported at the same line as an LF one', t => {
  const text = '---\r\nname: e2e-test-verifier\r\n---\r\n\r\nCopy from .playwright-mcp/shot.png\r\n';
  const result = lint(`--root=${plant(t, { 'plugins/maister/agents/e2e-test-verifier.md': text })}`);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(failLines(result)[0], /e2e-test-verifier\.md:5: names `\.playwright-mcp\/`/);
});

test('browser-tool-lint: an unknown argument is a usage error', () => {
  const result = lint('--file=x');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});
