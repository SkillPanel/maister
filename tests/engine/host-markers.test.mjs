import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT, bashPath, scratchTree } from '../helpers.mjs';
import { guideRows, readerRows } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { reference } from '../../plugins/maister/skills/workflow-engine/scripts/lib/reference.mjs';

// A passage that holds for one host only is marked in the source, one marker to
// a line: Claude Code's text between `<!-- claude-code -->` and
// `<!-- /claude-code -->`, Copilot's inside a `<!-- copilot` … `-->` comment.
// The Copilot build drops the first and uncomments the second
// (`copilot-build.test.mjs`); the engine's own reader reads the source as
// Claude Code does; and `make validate` refuses a marker left open, written
// inline, or opened inside a passage of another kind — host or picker.

const CLAUDE = 'Claude Code sentinel: send both calls in the same message.';
const COPILOT = 'Copilot sentinel: send the dependent call after the first returns.';
const MARKED = [
  '## Calls',
  '',
  'Before the pair.',
  '<!-- claude-code -->',
  CLAUDE,
  '<!-- /claude-code -->',
  '<!-- copilot',
  COPILOT,
  '-->',
  'After the pair.',
  '',
].join('\n');

test('the reader keeps a claude-code passage\'s text without its markers and drops a copilot comment whole, in reference too', t => {
  const kept = readerRows(guideRows(MARKED)).map(row => row.text);
  assert.deepEqual(kept, ['## Calls', '', 'Before the pair.', CLAUDE, 'After the pair.', '']);

  // Inside a fence a marker is text, as a picker marker is.
  const fenced = ['```', '<!-- claude-code -->', '<!-- copilot', '-->', '```'].join('\n');
  assert.deepEqual(readerRows(guideRows(fenced)).map(row => row.text), fenced.split('\n'));

  // `reference` prints through the same reader, so a session reads the source as Claude Code does.
  const root = scratchTree(t, { 'skills/demo/SKILL.md': `# Demo\n\n${MARKED}` });
  const printed = reference({ ats: ['skills/demo/SKILL.md § Calls'], pluginRoot: root });
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));
  assert.ok(printed.text.includes(CLAUDE), printed.text);
  assert.doesNotMatch(printed.text, /<!--\s*\/?(?:claude-code|copilot)|Copilot sentinel/, printed.text);
});

const SOURCE_CHECK = 'Checking every host marker in the source is closed, on a line of its own and outside every passage of another kind...';

/** The Makefile step under `heading`, as the shell receives it from make. */
function makeStep(heading) {
  const lines = fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(line => line === `\t@echo "${heading}"`);
  assert.ok(start >= 0, `the Makefile has the step "${heading}"`);
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('\t') || lines[i].startsWith('\t@echo "Checking')) break;
    body.push(lines[i]);
  }
  assert.ok(body.length > 0, 'the step has recipe lines after its heading');
  // Undo make's quoting: the leading tab and @, and $$ for a literal $.
  return body.map(line => line.replace(/^\t@?/, '').replace(/\$\$/g, '$')).join('\n');
}

/** Run the Makefile's source check from a scratch root holding `files`, the way make runs it. */
function sourceCheck(t, files) {
  const root = scratchTree(t, { ...files, 'check.sh': `${makeStep(SOURCE_CHECK)}\n` });
  const result = spawnSync(bashPath(), ['check.sh'], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { code: result.status, out: result.stdout + result.stderr };
}

const SKILL = 'plugins/maister/skills/demo/SKILL.md';
const AGENT = 'plugins/maister/agents/demo.md';

test('the source check passes closed markers and refuses one left open or written inline, in skills and agents', t => {
  const picker = ['<!-- rich-picker -->', 'Rich text.', '<!-- /rich-picker -->', '<!-- plain-picker', 'Plain text.', '-->'].join('\n');
  const clean = sourceCheck(t, { [SKILL]: `# Demo\n\n${MARKED}\n${picker}\n`, [AGENT]: `# Agent\n\n${MARKED}` });
  assert.equal(clean.code, 0, clean.out);

  for (const [where, file] of [['skill', SKILL], ['agent', AGENT]]) {
    const opened = sourceCheck(t, { [file]: '# Demo\n\n<!-- claude-code -->\nNever closed.\n' });
    assert.equal(opened.code, 1, `${where}: ${opened.out}`);
    assert.match(opened.out, /^FAIL: .*demo.* has an unclosed, inline or nested host marker$/m);

    const comment = sourceCheck(t, { [file]: '# Demo\n\n<!-- copilot\nNever closed.\n' });
    assert.equal(comment.code, 1, `${where}: ${comment.out}`);

    const inline = sourceCheck(t, { [file]: '# Demo\n\nText <!-- claude-code --> inline.\n' });
    assert.equal(inline.code, 1, `${where}: ${inline.out}`);
  }
});

test('the source check refuses a host opener inside an open picker passage, and the reverse', t => {
  const cases = {
    'host inside rich': ['<!-- rich-picker -->', '<!-- claude-code -->', 'x', '<!-- /claude-code -->', '<!-- /rich-picker -->'],
    'host inside plain': ['<!-- plain-picker', '<!-- copilot', 'x', '-->'],
    'rich inside host': ['<!-- claude-code -->', '<!-- rich-picker -->', 'x', '<!-- /rich-picker -->', '<!-- /claude-code -->'],
    'plain inside copilot': ['<!-- copilot', '<!-- plain-picker', 'x', '-->'],
    'host inside host': ['<!-- claude-code -->', '<!-- copilot', 'x', '-->', '<!-- /claude-code -->'],
  };
  for (const [name, lines] of Object.entries(cases)) {
    const result = sourceCheck(t, { [SKILL]: `# Demo\n\n${lines.join('\n')}\n` });
    assert.equal(result.code, 1, `${name}: ${result.out}`);
    assert.match(result.out, /^FAIL: /m, name);
  }
});
