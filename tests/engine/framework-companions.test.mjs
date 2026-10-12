import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../helpers.mjs';

// The post-compaction hook runs in a project with a task directory and prints
// its reminder as hook JSON.

const HOOK = path.join(ROOT, 'plugins/maister/hooks/post-compact-reminder.sh');

test('the post-compact hook exits 0 with hook JSON and stays LF', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister framework '));
  fs.mkdirSync(path.join(project, '.maister', 'tasks'), { recursive: true });
  const result = spawnSync('bash', [HOOK], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: project } });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.equal(typeof context, 'string');
  assert.ok(context.length > 0, 'the hook prints a reminder');
  assert.ok(!fs.readFileSync(HOOK, 'utf8').includes('\r'), 'the hook stays LF');
});
