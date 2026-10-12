import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// workflow-author's prose against the `html_companions` block (grammar § 3.2).
// The skill is prose an author's session follows, so what is checked is that
// each subcommand names the block where it has to: `new` asks for it and writes
// it, `overlay` routes a companion change to it, `nodes` and `preview` read the
// merged block from `locate --name` instead of the files, and `check` names the
// two checks the engine cannot make on its own.

const SKILL = path.join(ROOT, 'plugins/maister/skills/workflow-author/SKILL.md');
const text = fs.readFileSync(SKILL, 'utf8');

/** The body of one `## ` section, found by the start of its heading. */
function section(heading) {
  const start = text.indexOf(`\n## ${heading}`);
  assert.notEqual(start, -1, `no section headed "## ${heading}"`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('new asks which artifacts get an HTML page, after the artifacts question, and writes the block', () => {
  const body = section('`new <name>`');
  const artifacts = body.indexOf('**Artifacts and values**');
  assert.notEqual(artifacts, -1, 'the artifacts question is missing');
  const asked = body.search(/HTML page/);
  assert.ok(asked > artifacts, 'the HTML-page question must come after the artifacts question');
  const pair = body.slice(body.indexOf('**Write the pair.**'));
  assert.match(pair, /`html_companions`/, 'writing the pair must name the block');
  assert.match(body, /§ 3\.2/, 'the block is cited by its grammar section');
});

test('the overlay attach table routes a companion change to html_companions, [] dropping a node\'s', () => {
  const body = section('`overlay <builtin>`');
  const row = body.split('\n').find(line => line.startsWith('| A companion added or dropped'));
  assert.ok(row, 'no attach-table row for a companion added or dropped');
  assert.ok(row.includes('`html_companions: {<id>: [<key>…]}`'), row);
  assert.ok(row.includes('`[]` drops a node\'s'), row);
});

test('nodes and preview read html_companions from locate --name with the same overlays and profile', () => {
  const verbRow = text.split('\n').find(line => line.startsWith('| `locate --name=<name>`'));
  assert.ok(verbRow, 'the verb table has no locate row');
  assert.match(verbRow, /`html_companions`/, 'the locate row names the field');
  assert.match(text, /Overlays passed to a verb[^\n]*\n?[^\n]*`locate`/,
    'the overlay rule covers locate too');

  for (const heading of ['`nodes <builtin>`', '`preview <name>`']) {
    const body = section(heading);
    assert.match(body, /`html_companions`/, `${heading} names the block`);
    assert.match(body, /`locate --name/, `${heading} reads it from locate --name`);
    assert.match(body, /never from the files/i, `${heading} never reads the block by hand`);
  }
  assert.match(section('`preview <name>`'), /under the graph/i, 'preview shows the block under the graph');
});

test('check names both companion checks and the reconciling sentence is gone', () => {
  const body = section('`check [<name> | --all]`');
  assert.match(body, /html-companion-writer[^.]*before its completion write/s,
    'a direct: node hands the md to html-companion-writer before its completion write');
  assert.match(body, /`agent:`[^.]*\btake[^.]*`html:`[^.]*\breturn[^.]*`companion:`/s,
    'a project agent: owing a companion takes html: and returns companion:');
  assert.doesNotMatch(body, /\*\*Artifacts\*\* — one reminder/, 'the Artifacts reminder is replaced');
  assert.doesNotMatch(text, /also\s+reconciles/, 'the last-direct-node reconciling sentence is gone');
  assert.doesNotMatch(text, /the engine checks only the artifacts the definition declares/);
  assert.doesNotMatch(text, /The engine does neither on its own/);
});
