import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT, verb } from '../helpers.mjs';

// Development's intake takes a design from four sources, one of them a
// quick-design task. That task holds no state and no manifest: only its
// `decision.md`, read by a person's words, says which option was chosen and
// whether the mockups stayed. So what binds the implementation is prose, and
// each rule of it is pinned here: what comes in, what never does, and that the
// two agents after the intake actually read the decision. The import changes
// no graph, which the last test holds against the pinned hash.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const AGENTS = path.join(ROOT, 'plugins/maister/agents');
const DEVELOPMENT_HASH = 'sha256:70d3e772419b0fc36af0a4971ec8eefef6319a37e3355abab4e3d5d69f5b660b';

/** A file's text with its line wrapping gone, so a sentence is matched wherever it breaks. */
function flat(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ');
}

/** The intake's section of the node prose, from its heading to the next one. */
function intake() {
  const text = fs.readFileSync(path.join(WORKFLOWS, 'development.md'), 'utf8').replace(/\r\n?/g, '\n');
  const start = text.indexOf('\n## `intake`\n');
  assert.notEqual(start, -1, 'development.md has a section for intake');
  const end = text.indexOf('\n## ', start + 1);
  return flat(text.slice(start, end === -1 ? undefined : end));
}

/** One numbered step of the intake, up to the next step's number. */
function step(section, number) {
  const start = section.indexOf(` ${number}. **`);
  assert.notEqual(start, -1, `the intake has a step ${number}`);
  const end = section.indexOf(` ${number + 1}. **`, start + 1);
  return section.slice(start, end === -1 ? undefined : end);
}

function agent(name) {
  return fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8').replace(/\r\n?/g, '\n');
}

test('the intake names four design sources, a quick-design task among them', () => {
  const section = intake();
  assert.match(step(section, 5), /Ingest design context from four sources/);
  assert.doesNotMatch(section, /three (design )?sources|of the three/);
  assert.match(step(section, 5), /quick-design task path, `\.maister\/tasks\/design\/<YYYY-MM-DD-name>\/`/);
  assert.match(section, /a product-design task directory, a quick-design task directory,/, 'the design-location table');
  assert.match(step(section, 8), /which of the four sources supplied it/);
  assert.match(step(section, 8), /quick-design task path/);
});

test('the decision comes in as the design context\'s decision.md, and the design input may name it', () => {
  const section = intake();
  assert.match(step(section, 5), /`decision\.md` as `analysis\/design-context\/decision\.md`/);
  // The input takes the task directory or the decision inside it.
  assert.match(section, /a quick-design task directory, or the `decision\.md` inside one, whose task directory is one level up/);
  assert.match(section, /resolves to neither kind of task/);
  assert.match(step(section, 8), /whether a brief or a decision came with them/);
});

test('only the chosen options\' flat pages are imported, never the version folders', () => {
  const fifth = step(intake(), 5);
  assert.match(fifth, /only the flat pages of the chosen options/);
  assert.match(fifth, /`mockups\/<slug>\.html`/);
  assert.match(fifth, /never `versions\/`, never `\.mockups\.json`/);
  assert.match(fifth, /Rejected options' pages are never imported/);
  // ASCII holds every option in one file: only the index keeps a rejected one from binding.
  assert.match(fifth, /`mockups\/ascii-mockups\.md`/);
  assert.match(fifth, /unindexed and not binding/);
  assert.match(step(intake(), 7), /only for the imported slugs/);
});

test('nothing is imported when the decision says the mockups were skipped, whatever the folder holds', () => {
  const section = intake();
  const fifth = step(section, 5);
  assert.match(fifth, /"Skip the mockups"/);
  assert.match(fifth, /"no" without "Show me mockups first"/);
  assert.match(fifth, /the line decides, not the folder/);
  // A decision alone has no screens: no index, and the reference names none.
  assert.match(step(section, 7), /no index when no page was imported/i);
  assert.match(step(section, 8), /the index path when there is an index/);
});

test('a chosen option\'s slug is read from its link anywhere in the decision', () => {
  const fifth = step(intake(), 5);
  assert.match(fifth, /\*\*Decision\*\* section/, 'the choice is read from the Decision section');
  assert.match(fifth, /the link `decision\.md` gives that option's screen, anywhere in the file/);
  // Without a link it falls back to quick-design's own naming.
  assert.match(fifth, /the option's name in kebab case, with the area added when two areas share an option name/);
  // A chosen option with no page is said, and a page the verb skips fails the node.
  assert.match(fifth, /chosen slug with no page on disk is said in one line/);
  assert.match(fifth, /a mockup the verb skips fails the node/);
});

test('both agents read the decision, and the import leaves development\'s graph hash alone', () => {
  const creator = flat(agent('specification-creator'));
  assert.match(creator, /`analysis\/design-context\/decision\.md` exists[^.]*design intent/);

  const planner = agent('implementation-planner');
  const inputLine = planner.split('\n').find((line) => line.startsWith('- `design_reference`:'));
  assert.match(inputLine, /design-context\/decision\.md/);
  assert.match(inputLine, /design-context\/brief\.md/);

  // The read of the decision stands outside the block that waits on the index,
  // and the coverage matrix still follows the index alone.
  const start = planner.indexOf('### Phase 1.5');
  const phase = planner.slice(start, planner.indexOf('\n### ', start + 1));
  const decisionRead = phase.indexOf('design-context/decision.md');
  const indexBlock = phase.indexOf('If `{task_path}/analysis/design-context/INDEX.md` exists:');
  assert.notEqual(decisionRead, -1, 'Phase 1.5 reads the decision');
  assert.notEqual(indexBlock, -1);
  assert.ok(decisionRead < indexBlock, 'the decision is read before the block that needs the index');
  assert.match(planner, /\*\*Skip this phase entirely\*\* if `analysis\/design-context\/INDEX\.md` does not exist/);

  const resolved = verb(['resolve', `--definition=${path.join(WORKFLOWS, 'development.yml')}`]);
  assert.equal(resolved.code, 0, resolved.stderr);
  assert.equal(JSON.parse(resolved.stdout).graph_hash, DEVELOPMENT_HASH);
});
