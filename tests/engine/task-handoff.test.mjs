import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, variantRoot } from '../helpers.mjs';

// A person's task reaches every step exactly as typed only if each copy of it
// is made word for word: the workflow skill's hand-off to the engine, the
// engine's freeze, every prompt template that carries it and every command a
// run suggests with it. A test cannot watch a model make those copies; it can
// hold the wording that tells it how, in the source and in the Copilot build.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const WORKFLOWS = ['development', 'research', 'performance', 'migration', 'product-design'];
const HANDOFF = 'The description goes last, word for word as the person typed it, on the lines after a `task:` line: every line break, quote and backslash kept, never joined onto one line, reworded or put in quotes.';
const FREEZE = "`task.title` and `task.description`, the description copied whole from the person's own words, each line break a `\\n` in the JSON;";
const WORD_FOR_WORD = 'word for word';

const flat = text => text.replace(/\s+/g, ' ');
const read = (root, file) => flat(fs.readFileSync(path.join(root, file), 'utf8'));

/** The text of one `## `/`### ` section of a markdown file, its heading included. */
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex(line => line === heading);
  assert.ok(from >= 0, `the file has a heading ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const to = lines.findIndex((line, index) => index > from && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(from, to < 0 ? lines.length : to).join('\n');
}

for (const [tree, root] of [['source', () => PLUGIN], ['Copilot build', variantRoot]]) {
  test(`hand-off (${tree}): each workflow skill passes the task to the engine word for word, line breaks kept`, () => {
    for (const name of WORKFLOWS) {
      const text = read(root(), `skills/${name}/SKILL.md`);
      assert.equal(text.split(HANDOFF).length - 1, 1, `${name}'s hand-off carries the word-for-word sentence once`);
    }
  });

  test(`freeze (${tree}): the engine copies the description from the person's own words, each line break a \\n`, () => {
    const step = flat(section(fs.readFileSync(path.join(root(), 'skills/workflow-engine/SKILL.md'), 'utf8'), '### Step 4: Freeze the graph before executing anything'));
    assert.ok(step.includes(FREEZE), 'Step 4 names the description\'s source and how its line breaks go');
  });
}

test('hand-off: the run skill and the work router pass the description word for word, never quoted', () => {
  const run = fs.readFileSync(path.join(PLUGIN, 'skills/run/SKILL.md'), 'utf8');
  assert.ok(flat(run).includes('the task description, word for word as typed: every line break, quote and backslash kept, never put in quotes or escaped.'));
  assert.match(flat(run), /It may also come unquoted on the lines after the first, where it is the rest of the arguments; either way it is taken exactly as written/);
  const work = read(PLUGIN, 'commands/work.md');
  assert.ok(work.includes(`Either way the description goes ${WORD_FOR_WORD}, as the person typed it`));
  assert.ok(!work.includes('\\"<description>\\"'), 'the route to a project workflow no longer escapes the description inside quotes');
});

test('templates: every codebase-analyzer prompt carries the task between marker lines, never in quotes', () => {
  const dir = path.join(PLUGIN, 'skills/codebase-analyzer');
  const files = ['SKILL.md', ...fs.readdirSync(path.join(dir, 'references')).map(name => `references/${name}`)];
  let slots = 0;
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.trim() !== '[description]') {
        assert.ok(!line.includes('"[description]"'), `${file}:${index + 1} quotes the task`);
        return;
      }
      slots += 1;
      assert.equal(lines[index - 1].trim(), '--- task ---', `${file}:${index + 1} opens the task block`);
      assert.equal(lines[index + 1].trim(), '--- end of task ---', `${file}:${index + 1} closes the task block`);
      assert.match(lines[index - 2], /exactly as the person wrote it, between the marker lines:$/, `${file}:${index + 1} says the block is the task as written`);
    });
  }
  assert.equal(slots, 13, 'the twelve Explore templates and the reporter prompt each carry the block');
});

test('wrap-up: a suggested command repeats a person\'s text exactly, never quoted or escaped', () => {
  const close = flat(section(fs.readFileSync(path.join(PLUGIN, 'skills/workflow-engine/references/writing-state.md'), 'utf8'), '## Ending the run — the wrap-up'));
  assert.ok(close.includes("A command that repeats a person's text — the task, a question, a note — carries it exactly as they typed it, after the command and its flags: never inside quotes, never escaped, a text of several lines on the lines below the command;"));
});
