import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT, freezePatch, readState, scratch, verb } from '../helpers.mjs';

// `mockup_format` keeps two values, html and ascii. A written scope is chosen
// for one turn with the format `scope`, never as the project's default. The
// freeze reads the config for a workflow run and guards the value; quick
// design, which runs no freeze, guards it itself; the docs and config comments
// say the same.

const PLUGIN = path.join(ROOT, 'plugins/maister/skills');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ');
}

test('quick design reads mockup_format as html or ascii and takes any other value as html, with a note', () => {
  const quick = read(PLUGIN, 'quick-design/SKILL.md');
  assert.match(quick, /`mockup_format` takes `html` or `ascii`/);
  assert.match(quick, /any other value (is|counts as|was) (read as )?`html`/);
  assert.match(quick, /passes the replaced value to the turn's `notes`/);
});

test('the development and product-design intakes leave mockup_format to the freeze', () => {
  for (const name of ['development', 'product-design']) {
    const text = read(ENGINE_DIR, `workflows/${name}.md`);
    assert.doesNotMatch(text, /`mockup_format` takes `html` or `ascii`/, `${name} no longer guards the value itself`);
    assert.doesNotMatch(text, /names the replaced value in one line of its summary/, name);
  }
});

test('the freeze records a config mockup_format other than html or ascii as html, with one warning', t => {
  const run = scratch(t);
  fs.writeFileSync(path.join(run.root, '.maister', 'config.yml'), 'mockup_format: scope\n');
  const result = verb(['write-state', `--state=${run.state}`], freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readState(run).orchestrator.options.mockup_format, 'html');
  assert.equal(result.stderr.match(/^warning: mockup-format-replaced:scope$/gm)?.length, 1, result.stderr);
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
