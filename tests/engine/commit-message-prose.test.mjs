import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT } from '../helpers.mjs';

// The commit message a run proposes is the project's, not the session's: it
// carries no attribution trailer unless the project's own instructions ask for
// one. The rule sits where each message is written.

const flat = text => text.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ');

test('development\'s finalization writes a commit message with no attribution trailer', () => {
  const text = flat(fs.readFileSync(path.join(ENGINE_DIR, 'workflows/development.md'), 'utf8'));
  const at = text.indexOf('**Write the commit message to `commit-message.txt` in the task directory**');
  assert.notEqual(at, -1, 'the step that writes the message is there');
  const step = text.slice(at, text.indexOf('8. **Publish', at));
  assert.ok(step.includes('The message carries no attribution trailer — no `Co-Authored-By`, no "Generated with" line — unless the project\'s own instructions ask for one.'), step);
});

test('quick-bugfix proposes a commit message with no attribution trailer', () => {
  const text = flat(fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/quick-bugfix/SKILL.md'), 'utf8'));
  assert.ok(text.includes('Propose a commit message, with no attribution trailer (no `Co-Authored-By`, no "Generated with" line) unless the project\'s own instructions ask for one'));
});
