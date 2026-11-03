import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// Prose that keeps a run from stopping for a path permission prompt or leaving
// tool output in the project: a built-in explore agent is told the project root
// and gets absolute paths, quick-design writes its record with the file tool and
// keeps scratch files in the system temp directory, and a browser step sends
// playwright-cli's own output to a scratch directory.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const read = rel => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');

test('every Explore prompt the codebase analyzer writes names the root and only absolute paths', () => {
  const text = read('skills/codebase-analyzer/SKILL.md');
  assert.match(text, /\*\*Paths in every Explore prompt are absolute\.\*\*/);
  assert.match(text, /the project root as an absolute path/);
  assert.match(text, /a standards file from `\.maister\/docs\/`[^\n]*\n?[^\n]*absolute path under that root, never relative/);
  assert.match(text, /Search, list and glob only under\s+`<project root>`/);
});

test('quick-design writes decision.md with the file tool and never names a literal /tmp path', () => {
  const text = read('skills/quick-design/SKILL.md');
  assert.match(text, /`decision\.md` under `\.maister\/tasks\/design\/<YYYY-MM-DD-name>\/` with the file tool/);
  assert.match(text, /never through a shell heredoc, a temp file or a copy/);
  assert.match(text, /`mktemp -d`/);
  assert.match(text, /"\$\{TMPDIR:-\/tmp\}"/);
  assert.doesNotMatch(text, /(^|[\s`(])\/tmp\//m, 'no literal /tmp/ path');
});

test('a browser step keeps playwright-cli output in a scratch directory', () => {
  const text = read('skills/orchestrator-framework/references/browser-tools.md');
  assert.match(text, /`PLAYWRIGHT_MCP_OUTPUT_DIR=<that directory>` on the `open` call/);
  assert.match(text, /make one directory with `mktemp -d`/);
  assert.match(text, /`\.playwright-cli\/`/);
  const studio = read('skills/mockup-studio/SKILL.md');
  assert.match(studio, /keep the browser tool's own output out of the project/);
});
