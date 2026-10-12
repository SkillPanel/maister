import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The author skill writes a custom workflow's companion and checks it, so what
// it says about the companion has to match what the engine does with one: a
// section only for a step that needs prose, the step's data in `brief:`, and a
// heading the engine finds a section by. Line breaks and runs of spaces are
// free to move; the statements are not.

const SKILL = path.join(ROOT, 'plugins/maister/skills/workflow-author/SKILL.md');
const EXTENDING = path.join(ROOT, 'docs/extending.md');

const flat = text => text.replace(/\s+/g, ' ');

/** The text under the `## ` heading that starts with `title`, up to the next `## `. */
function part(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## ${title}`));
  assert.ok(start >= 0, `no "## ${title}" heading`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return flat(lines.slice(start + 1, end < 0 ? undefined : end).join('\n'));
}

const skill = fs.readFileSync(SKILL, 'utf8');

test('new writes a section only for a step that needs prose, writes brief:, and names node-brief', () => {
  const body = part(skill, '`new <name>`');
  assert.match(body, /a section only for a `direct:` step that asks a question, keeps a budget or has a summary hint/);
  assert.doesNotMatch(body, /one `## <id>` section per `direct:` node/, 'the old one-section-per-node rule is gone');
  assert.match(body, /`brief:`/);
  for (const key of ['questions', 'budget', 'summary_keys', 'absent', 'recommends']) {
    assert.match(body, new RegExp(`\`${key}\``), `brief: key ${key} is named`);
  }
  assert.match(body, /\*\*Does\.\*\*.*\*\*Asks\.\*\*.*\*\*Writes\.\*\*.*\*\*Summary\.\*\*.*\*\*Re-run\.\*\*.*\*\*Budget\.\*\*/,
    'the template parts in their order');
  assert.match(body, /from: conventions/);
  const next = body.slice(body.indexOf('End with the next steps'));
  assert.match(next, /`node-brief`/, 'the next-steps line names node-brief');
  assert.match(body, /`## Embedded mode` section only where the workflow behaves differently as a child/,
    'Embedded mode is conditional');
});

test('check lists the three prose findings and words the orphan rule as sectionNameOf does', () => {
  const body = part(skill, '`check');
  assert.match(body, /merged `brief:` has `questions`, `budget` or `recommends` but no section/);
  assert.match(body, /a `questions` id with no question-set line in its section/);
  assert.match(body, /a question-set line whose id has no `questions` entry/);
  assert.match(body, /not the name some node finds its section by: the name after `direct:` for a `direct:` node, the node id otherwise \(a disabled node still counts\)/);
  assert.match(body, /fix: rename the heading to the node id, or delete the section/i);
  assert.match(body, /`<file> · <node> — <problem>`/);
});

test('overlay writes its companion whenever it adds a direct: step, and routes brief data to brief:', () => {
  const body = part(skill, '`overlay <builtin>`');
  assert.match(body, /`<builtin>\.overlay\.md` whenever the overlay adds a `direct:` step/);
  assert.match(body, /\| A step's summary keys, budget or recommendation changed \| `brief:`/);
});

test('the skill cites no docs/ page, and extending.md agrees with the engine on the section-less step', () => {
  assert.doesNotMatch(skill, /docs\//, 'the shipped skill cites no repository docs');
  const docs = fs.readFileSync(EXTENDING, 'utf8');
  const text = flat(docs);
  assert.doesNotMatch(text, /no section is a validation error/);
  assert.match(text, /`conventions`/);
  assert.match(text, /`node-brief`/);
  assert.match(text, /`brief:`/);
  assert.match(text, /orphan-prose-section/);
  assert.doesNotMatch(docs, /node \$CLAUDE_PLUGIN_ROOT|node "\$\{?CLAUDE_PLUGIN_ROOT/, 'no script path for a user to run');
  assert.match(docs, /\]\(\.\.\/plugins\/maister\/skills\/workflow-engine\/references\/grammar\.md\)/);
});
