import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT } from '../helpers.mjs';

// `mockup_format` keeps two values, html and ascii. A written scope is chosen
// for one turn with the format `scope`, never as the project's default, so each
// caller that reads the config guards the value, and the docs and config
// comments say the same.

const PLUGIN = path.join(ROOT, 'plugins/maister/skills');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ');
}

test('the callers read mockup_format as html or ascii and take any other value as html, with a note', () => {
  const development = read(ENGINE_DIR, 'workflows/development.md');
  const design = read(ENGINE_DIR, 'workflows/product-design.md');
  const quick = read(PLUGIN, 'quick-design/SKILL.md');
  for (const [name, text] of [['development', development], ['product design', design], ['quick design', quick]]) {
    assert.match(text, /`mockup_format` takes `html` or `ascii`/, `${name} names the two values`);
    assert.match(text, /any other value (is|counts as|was) (read as )?`html`/, `${name} reads any other value as html`);
  }
  assert.match(development, /names the replaced value in one line of its summary/);
  assert.match(design, /names the replaced value in one line of its summary/);
  assert.match(quick, /passes the replaced value to the turn's `notes`/);
});

test('the user docs list the scope format for a turn and keep the config to html or ascii', () => {
  const commands = read(ROOT, 'docs/commands.md');
  const configuration = read(ROOT, 'docs/configuration.md');
  assert.ok(commands.includes('`--format=<html\\|ascii\\|scope>`'));
  const row = configuration.split('| `mockup_format` |')[1].split(' | ').slice(0, 3).join(' | ');
  assert.match(row, /`html` or `ascii`/);
  assert.match(row, /written scope/);
  assert.match(row, /per turn/);
});

test('the state writer\'s configuration and init keep html and ascii as the only config values', () => {
  const state = read(ENGINE_DIR, 'references/writing-state.md');
  const init = read(PLUGIN, 'init/SKILL.md');
  assert.match(state, /Takes only these two values: a written scope is chosen per turn, never here/);
  assert.match(state, /`mockup_format` \| `html` \|/);
  assert.match(init, /mockup_format: html/);
  assert.match(init, /`format: scope`/);
  assert.doesNotMatch(state, /mockup_format: html \| ascii \| scope/);
});
