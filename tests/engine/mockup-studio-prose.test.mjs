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

test('a turn on a mockup-studio record folder is a recorded run; only other workflows\' folders run inline', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  const rows = text.split('\n').filter(line => line.startsWith('| `--turn "<note>" --task=<dir>`'));
  assert.equal(rows.length, 2, 'the --task entry is split by the folder it names');
  const recorded = rows.find(row => row.includes('.maister/tasks/mockup-studio/'));
  assert.ok(recorded, 'one row names the mockup-studio record folders');
  assert.match(recorded, /hands off to the workflow engine/);
  assert.match(recorded, /`task_path` set to `<dir>`/);
  assert.match(recorded, /`latest` in `<dir>\/<output_subdir>\/versions\/index\.json`/);
  const inline = rows.find(row => row !== recorded);
  assert.match(inline, /any other workflow's task directory/);
  assert.match(inline, /An inline turn/);
  assert.match(text, /\*\*One record folder per turn\.\*\*/);

  const commands = fs.readFileSync(path.join(ROOT, 'docs/commands.md'), 'utf8');
  assert.ok(!commands.includes('| `--task=<dir>` | Run the turn inline on `<dir>/<subdir>/`, writing no run record |'),
    'the command docs no longer say every --task turn is inline');
  assert.match(commands, /On a mockup studio folder \(under `\.maister\/tasks\/mockup-studio\/`\) the turn is a new recorded run/);
});

test('a missing grounding pack is always built; grounding-unavailable needs a failed build', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /Every entry builds it — node mode, an inline call, a terminal turn —/);
  assert.match(text, /a project with little or no UI yet, a sketch, a small scope or a\s+throwaway comparison is no reason to skip the build/);
  assert.match(text, /\| `grounding-unavailable` \| no usable pack, and building one was tried and failed \|/);
  assert.match(text, /A turn that did not try to build a missing pack never records\s+`grounding-unavailable`/);
  const quick = fs.readFileSync(path.join(PLUGIN, 'skills/quick-design/SKILL.md'), 'utf8');
  assert.match(quick, /the turn builds one and uses it, however small the sketch and\s+however little UI the project has/);
  assert.match(quick, /`grounding-unavailable` is only for a build that was tried and\s+failed/);
});

test('the skill names the written scope format, its guarded config read and its skipped grounding', () => {
  const text = fs.readFileSync(SKILL, 'utf8');
  assert.match(text, /`html`, `ascii` or `scope`/, 'the format input names scope');
  assert.match(text, /`mockup_format` takes html or ascii; `<value>` was\s+read as html/);
  assert.match(text, /the written scope used no\s+grounding pack/);
  assert.match(text, /`against_scope`/);
  assert.ok(!text.includes('AskUserQuestion'), 'still names no question tool');
});

test('the turn contract refuses a written scope by its own rows and keeps the grammar to itself', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'skills/mockup-studio/references/turn-contract.md'), 'utf8');
  assert.match(text, /^\| `scope-marks-invalid` \| `finish` \|/m);
  assert.match(text, /^\| `scope-empty` \| `finish` \|/m);
  const row = text.split('\n').find(line => line.startsWith('| `index-malformed`'));
  assert.ok(row.trimEnd().endsWith('Only an html version needs `.mockups.json` |'), 'the index-malformed row ends on the html rule');
  assert.match(text, /^## The written scope/m, 'the grammar section lives here');
  const skill = fs.readFileSync(SKILL, 'utf8');
  assert.ok(!skill.includes('Stripping rule'), 'SKILL.md does not restate the grammar');
});

test('the visual companion names the three start-page targets', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'skills/mockup-studio/references/visual-companion.md'), 'utf8');
  assert.match(text, /versions\/<latest>\/ascii-mockups\.md/);
  assert.match(text, /versions\/<latest>\/scope\.md` when it has no `index\.html`/);
  assert.match(text, /and otherwise to `versions\/<latest>\/index\.html`/);
});

test('a close names the grounding pack uncommitted only after git status lists a path under it', () => {
  const read = file => fs.readFileSync(path.join(PLUGIN, file), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  const check = /only when `git status --porcelain -- <grounding>`/;
  assert.match(read('skills/mockup-studio/SKILL.md'), check);
  assert.match(read('skills/mockup-studio/SKILL.md'), /never repeated without that check/);
  assert.match(read('skills/workflow-engine/workflows/mockup-studio.md'), check);
  assert.match(read('skills/mockup-studio/references/grounding-pack.md'), /only while `git status --porcelain -- <grounding>` still lists a path under the pack/);
});
