import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The mockup studio's prose promises that no lint sees: the turn never asks
// and carries no gate rule, the retired discovery routine and companion keys
// are gone from everything the plugin ships, and the ASCII agent writes one
// file it is given, never INDEX rows or the old `ascii/` folder.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const SKILL = path.join(PLUGIN, 'skills/mockup-studio/SKILL.md');
const AGENT = path.join(PLUGIN, 'agents/ascii-mockup-generator.md');

/** A sentence the Makefile holds as `NAME = …`, with make's `$$` read back as `$`. */
function makeSentence(name) {
  const makefile = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const line = makefile.split('\n').find(each => each.startsWith(`${name} = `));
  assert.ok(line, `the Makefile defines ${name}`);
  return line.slice(name.length + 3).replaceAll('$$', '$');
}

/** The gate-rule sentence and its tail, as the Makefile's gate-rule lint counts them. */
function gateRule() {
  const makefile = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const pick = key => {
    const match = new RegExp(`${key}='([^']+)'`).exec(makefile);
    assert.ok(match, `the gate-rule lint defines ${key}`);
    return match[1];
  };
  return { full: pick('full'), tail: pick('tail') };
}

/** Every file under a directory, recursively. */
function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test('the mockup-studio skill asks nothing and carries no gate rule', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  const { full, tail } = gateRule();
  assert.ok(!text.includes('AskUserQuestion'), 'SKILL.md names no question tool');
  assert.ok(!text.includes(full), 'SKILL.md carries no gate-rule sentence');
  assert.ok(!text.includes(tail), 'SKILL.md carries no gate-rule tail');
  assert.ok(!text.includes('orchestrator.driver.kind'), 'SKILL.md reads no driver kind');
  assert.match(text, /^name: maister:mockup-studio$/m, 'the frontmatter name stays');
});

test('nothing the plugin ships names the retired discovery routine or companion keys', () => {
  const retired = ['design-resource-discovery', 'visual_companion', 'refinement_iterations.prototypes'];
  const found = [];
  for (const file of filesUnder(PLUGIN)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of retired) {
      if (text.includes(name)) found.push(`${path.relative(ROOT, file)}: ${name}`);
    }
  }
  assert.deepEqual(found, []);
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'skills/mockup-studio/references/design-resource-discovery.md')));
});

test('the ASCII agent keeps its sentences and writes only its Output Target', () => {
  const text = fs.readFileSync(AGENT, 'utf8');
  for (const name of ['CONTAINMENT', 'SCRATCH', 'SEARCH']) {
    assert.ok(text.includes(makeSentence(name)), `the agent carries the ${name.toLowerCase()} sentence`);
  }
  assert.ok(text.includes('Output Target'), 'the agent names its Output Target');
  assert.ok(!text.includes('analysis/design-context/ascii/'), 'the agent writes no ascii/ folder');
  const frontmatter = text.split('---')[1];
  assert.ok(!/^tools:/m.test(frontmatter), 'the agent declares no tools');
  assert.ok(!/^model: inherit/m.test(frontmatter), 'the agent names no inherited model');
});
