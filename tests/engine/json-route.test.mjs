import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR } from '../helpers.mjs';

// The JSON route a caller is told to take for a state patch or a request. The
// here-string is shown first, and its command starts with the engine path
// itself, so an allow rule for the script admits it. A heredoc is never
// prescribed: an agent host's shell check refuses one whose body is a JSON
// object. And an apostrophe inside the single-quoted JSON is never written as
// the JSON escape `\u0027`, which a tool call decodes into a bare quote.

const SKILL = path.join(ENGINE_DIR, 'SKILL.md');
const GUIDES = ['development', 'research', 'performance', 'migration', 'product-design', 'mockup-studio']
  .map(name => path.join(ENGINE_DIR, 'workflows', `${name}.md`));
const REFERENCES = fs.readdirSync(path.join(ENGINE_DIR, 'references'))
  .filter(name => name.endsWith('.md'))
  .map(name => path.join(ENGINE_DIR, 'references', name));
const PROSE = [SKILL, ...REFERENCES, ...GUIDES];

const read = file => fs.readFileSync(file, 'utf8');
const relative = file => path.relative(ENGINE_DIR, file);

test('json route: the engine skill shows the here-string first, its command starting with the engine path', () => {
  const text = read(SKILL);
  const lines = text.split('\n');
  const hereString = verb => new RegExp(`^node [^|;&]*?/skills/workflow-engine/scripts/workflow\\.mjs ${verb} --state=\\S+ .*<<< '`);
  const first = lines.findIndex(line => hereString('write-state').test(line));
  assert.ok(first >= 0, 'a write-state line in the here-string form, starting with `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs`');
  for (const verb of ['gate-request', 'gate-revise']) {
    assert.ok(lines.some(line => hereString(verb).test(line)), `a ${verb} line in the same here-string form`);
  }
  const patchFile = lines.findIndex(line => /^node \S*workflow\.mjs write-state .*--patch-file=/.test(line));
  assert.ok(patchFile < 0 || first < patchFile, 'the here-string is shown before the patch-file form');
  assert.match(text, /'\\''/, "an apostrophe inside the JSON is written '\\''");
  for (const shell of ['PowerShell', 'cmd', 'Git Bash', 'zsh']) {
    assert.ok(text.includes(shell), `the shells are named: ${shell}`);
  }
  assert.ok(text.replace(/\s+/g, ' ').includes('no redirection other than the here-string, no heredoc'), 'the forbidden-forms list admits the here-string alone');
});

// Copilot's permission rules match one command, so a chained line is offered
// only a dismissal: every command a run issues stands alone on its line. The
// engine still reads a piped document, but the skill teaches the here-string
// alone: a command opening with `echo` no longer starts with the engine path.
test('json route: every other command is one per line, never chained, and no pipe route is taught', () => {
  const text = read(SKILL).replace(/\s+/g, ' ');
  assert.ok(text.includes('Every other command a run issues follows the same rule: one command per line, never several chained with `&&`, `;` or `|`'), 'the one-command rule is stated');
  assert.ok(!text.includes("A pipe (`echo '<json>' |` in front)"), 'the pipe route is no longer taught');
});

// The contract's own command is spelled with the plugin root it tells the
// session to write, never through the variable it forbids, and states no verb
// count for the verbs reference to contradict.
test('json route: the invocation contract spells the plugin root, counts no verbs and names what exit 2 covers', () => {
  const text = read(SKILL);
  assert.ok(!text.split('\n').some(line => line.startsWith('node ${CLAUDE_PLUGIN_ROOT}')), 'no command line opens with the variable');
  assert.ok(text.includes('`node <plugin root>/skills/workflow-engine/scripts/workflow.mjs <verb> [flags]`'), 'the command is spelled with the plugin root');
  assert.ok(!/\btwenty-\w+ verbs\b/.test(text), 'no verb count');
  assert.ok(text.replace(/\s+/g, ' ').includes('a malformed call (`usage:`) or a tooling fault (`workflow:`)'), 'exit 2 names both of its lines');
});

test('json route: the engine skill, its references and the five guides carry no heredoc instruction', () => {
  // `<<` that is not part of `<<<`, followed by a delimiter word: a heredoc.
  const heredoc = /(^|[^<])<<-?\s*['"]?[A-Za-z_]\w*/;
  for (const file of PROSE) {
    read(file).split('\n').forEach((line, index) => {
      assert.ok(!heredoc.test(line), `${relative(file)}:${index + 1} shows a heredoc: ${line.trim()}`);
    });
  }
});

test('json route: no prose prescribes the JSON escape for an apostrophe', () => {
  for (const file of PROSE) {
    read(file).split('\n').forEach((line, index) => {
      if (!line.includes('\\u0027')) return;
      assert.match(line, /\bnever\b/i, `${relative(file)}:${index + 1} names \\u0027 other than to forbid it: ${line.trim()}`);
    });
  }
});

test('json route: the apostrophe rule names the JSON escape it forbids', () => {
  const lines = read(SKILL).split('\n').filter(line => line.includes('Never the JSON escape'));
  assert.equal(lines.length, 1, 'SKILL.md carries the apostrophe rule once');
  assert.ok(lines[0].includes('`\\u0027`'), `the rule names the escape itself: ${lines[0].trim()}`);
});
