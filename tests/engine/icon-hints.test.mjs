import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT } from '../helpers.mjs';

// A phase's icon is the definition's display.icons entry and nothing else:
// the dashboard projection reads no icon a node writes. Prose telling a node
// to write one asks for a write nothing reads, and a checklist requiring that
// prose asks every new workflow to repeat it.

const GUIDES = ['development', 'research', 'product-design', 'performance', 'migration'];
const CHECKLIST = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/references/orchestrator-creation-checklist.md');

test('no workflow guide tells a node to write an icon hint', () => {
  for (const name of GUIDES) {
    const text = fs.readFileSync(path.join(ENGINE_DIR, 'workflows', `${name}.md`), 'utf8');
    assert.doesNotMatch(text, /^## Icon hints$/m, `${name}.md carries no icon-hint section`);
    assert.doesNotMatch(text, /writes the `icon_hint`/, `${name}.md tells no node to write an icon hint`);
  }
});

test('the creation checklist does not require an icon-hint section', () => {
  assert.doesNotMatch(fs.readFileSync(CHECKLIST, 'utf8'), /Icon hints/);
});
