import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, ROOT, run, variantRoot } from '../helpers.mjs';
import { PRINT_MAX } from '../../plugins/maister/skills/workflow-engine/scripts/lib/reference.mjs';

// `reference` prints a section of the plugin's own Markdown, so a session
// reads the plugin's rules through a command and never opens a file outside
// the project. A print is held under the cap a shell output keeps whole: a
// cut-off output lands in a file the session would have to read back.

const PLUGIN = path.join(ROOT, 'plugins/maister');

/** The verb with each of `ats`. */
const reference = (ats, engine = ENGINE) => run(engine, ['reference', ...ats.map(at => `--at=${at}`)]);

/** The text printed, after a clean exit. */
function printed(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

/** A refusal: exit 1, nothing on stdout, the code first on stderr. */
function refused(result, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, new RegExp(`^${code}: `));
  return result.stderr;
}

test('a section prints from its heading to the next at its level, picker passages as the reader sees them', () => {
  const text = printed(reference(['references/gates.md § Revising at a gate']));
  assert.match(text, /^== skills\/workflow-engine\/references\/gates\.md § Revising at a gate\n## Revising at a gate\n/);
  assert.doesNotMatch(text, /\n## (?!Revising at a gate)/, 'no later section');
  assert.doesNotMatch(text, /<!--\s*\/?rich-picker\s*-->|<!--\s*plain-picker/, 'no picker marker');
  assert.ok(text.length < PRINT_MAX);
});

test('a heading matches without its emphasis, backticks or case, exactly first and else as a prefix', () => {
  const italic = printed(reference(['references/writing-state.md § *When `run-complete` refuses*']));
  assert.match(italic, /^== skills\/workflow-engine\/references\/writing-state\.md § When `run-complete` refuses\n/);
  const prefix = printed(reference(['references/gates.md § driver-suspended mode']));
  assert.match(prefix, /§ Driver-suspended mode — the write order\n/);
  assert.match(prefix, /§ Driver-suspended mode — resume\n/);
});

test('the file\'s title prints its opening, up to the first ## heading', () => {
  const text = printed(reference(['references/in-node-questions.md § In-node questions']));
  assert.match(text, /^== skills\/workflow-engine\/references\/in-node-questions\.md § In-node questions\n# In-node questions\n/);
  assert.doesNotMatch(text, /\n## /, 'the opening only');
});

test('a row of a section\'s table prints by its first cell, with the section\'s heading and the table\'s header', () => {
  const text = printed(reference(['references/writing-state.md § When a write is refused § state-skip-before-answer']));
  const lines = text.trimEnd().split('\n');
  assert.equal(lines[0], '== skills/workflow-engine/references/writing-state.md § When a write is refused § state-skip-before-answer');
  assert.equal(lines[1], '## When a write is refused');
  assert.equal(lines.filter(line => line.startsWith('| `')).length, 1, 'one row');
  assert.match(text, /\| Refusal \| Response \|\n\|---\|---\|\n\| `state-skip-before-answer` \|/);
  const unknown = refused(reference(['references/writing-state.md § When a write is refused § no-such-code']), 'reference-unknown-section');
  assert.match(unknown, /state-node-regressed/, 'the rows are listed');
});

test('several --at print in order, and a path may open from the plugin root or with its placeholder', () => {
  const text = printed(reference([
    'skills/codebase-analyzer/references/file-discovery.md § Bug',
    '<plugin root>/skills/mockup-studio/references/visual-companion.md § Starting and stopping',
    `${path.join(ENGINE_DIR, 'references', 'node-summaries.md')} § What a risk is`,
  ]));
  const heads = text.split('\n').filter(line => line.startsWith('== '));
  assert.deepEqual(heads, [
    '== skills/codebase-analyzer/references/file-discovery.md § Bug',
    '== skills/mockup-studio/references/visual-companion.md § Starting and stopping',
    '== skills/workflow-engine/references/node-summaries.md § What a risk is',
  ]);
});

test('a print past the cap is refused with each file\'s headings and their sizes', () => {
  const stderr = refused(reference(['references/gates.md']), 'reference-too-long');
  assert.match(stderr, /past the 20000 a shell output holds whole/);
  assert.match(stderr, /skills\/workflow-engine\/references\/gates\.md:\n/);
  assert.match(stderr, /^ {2}## Revising at a gate \(\d+ characters\)$/m);
  // The section a write refusal points at is past the cap on its own: its rows are asked for one by one.
  refused(reference(['references/writing-state.md § When a write is refused']), 'reference-too-long');
  // Several sections that each fit can still pass it together.
  refused(reference(['references/gates.md § Before every gate', 'references/gates.md § Driver-suspended mode — resume']), 'reference-too-long');
});

test('only the plugin\'s own Markdown prints', () => {
  refused(reference(['../../../../package.json']), 'reference-outside-plugin');
  refused(reference([path.join(ROOT, 'README.md')]), 'reference-outside-plugin');
  refused(reference(['skills/workflow-engine/scripts/workflow.mjs']), 'reference-outside-plugin');
  refused(reference(['references/no-such-file.md']), 'reference-missing');
  const unknown = refused(reference(['references/gates.md § No such heading']), 'reference-unknown-section');
  assert.match(unknown, /^## Revising at a gate$/m, 'the headings are listed');
  const usage = run(ENGINE, ['reference']);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /reference needs --at/);
});

test('the engine skill prints whole under the cap, its frontmatter left out', () => {
  const text = printed(reference(['SKILL.md']));
  assert.ok(text.length < PRINT_MAX, `SKILL.md prints ${text.length} characters, under ${PRINT_MAX}`);
  assert.match(text, /^== skills\/workflow-engine\/SKILL\.md\n# /);
  assert.doesNotMatch(text.split('\n').slice(0, 3).join('\n'), /^---$/m, 'no frontmatter');
  assert.match(text, /## Before anything else/);
});

/**
 * Every pointer a brief, a hook or a skill step names, as its `--at`: each
 * prints under the cap. A pointer added later adds its row here.
 */
const POINTERS = [
  'SKILL.md',
  'references/node-conventions.md § Node conventions',
  'references/node-summaries.md § Who settled a decision',
  'references/node-summaries.md § What a risk is',
  'references/in-node-questions.md § In-node questions',
  'references/in-node-questions.md § When a question suspends',
  'references/in-node-questions.md § When nobody can be asked',
  'references/in-node-questions.md § Decision areas from the brainstorm',
  'references/in-node-questions.md § Findings that need a decision',
  'references/gates.md § Before every gate — the gate brief',
  'references/gates.md § Revising at a gate',
  'references/gates.md § The closing checkpoint `held-approval`',
  'references/gates.md § Ending a dispatched run',
  'references/writing-state.md § When a write is refused § state-node-regressed',
  'references/writing-state.md § When `run-complete` refuses',
  'references/writing-state.md § A missing or stale companion',
  'skills/orchestrator-framework/references/standards-compliance-checklist.md § Where the standards come from',
  'skills/orchestrator-framework/references/standards-compliance-checklist.md § Writing the checklist',
  'skills/orchestrator-framework/references/standards-compliance-checklist.md § When there are no standards',
  'skills/orchestrator-framework/references/standards-compliance-checklist.md § Verifying the checklist',
  ...['file-discovery', 'code-analysis', 'context-discovery'].flatMap(file => ['Bug', 'Enhancement', 'Feature'].map(type => `skills/codebase-analyzer/references/${file}.md § ${type}`)),
  'skills/codebase-analyzer/references/pattern-mining.md § Pattern Mining',
  'skills/codebase-analyzer/references/migration-target.md § Migration Target',
  'skills/codebase-analyzer/references/combined.md § Merging Principles',
  'skills/codebase-analyzer/references/combined.md § Example',
  'skills/mockup-studio/references/turn-contract.md § The input file',
  'skills/mockup-studio/references/turn-contract.md § The written scope',
  'skills/mockup-studio/references/turn-contract.md § Layout',
  'skills/mockup-studio/references/turn-contract.md § The files a turn writes',
  'skills/mockup-studio/references/turn-contract.md § Refusals § scope-empty',
  ...['The per-turn read', 'What the pack holds', 'What to harvest', 'Building afresh', 'Sealing'].map(section => `skills/mockup-studio/references/grounding-pack.md § ${section}`),
  ...['What the page is', 'The two scripts', 'How the stills are made'].map(section => `skills/mockup-studio/references/prototype-page.md § ${section}`),
  'skills/mockup-studio/references/visual-companion.md § Starting and stopping',
  'skills/mockup-studio/references/visual-companion.md § A viewer left behind',
  'skills/orchestrator-framework/references/browser-tools.md § Which tool',
  'skills/orchestrator-framework/references/browser-tools.md § When there is none',
  'skills/implementation-verifier/references/review-findings.md § The findings file',
  'agents/verification-runner.md § The fix pass',
  ...['Exploration Mode', 'Exploration Mode Options', 'Convergence Mode', 'Convergence Mode Options'].map(section => `skills/product-design/references/interaction-patterns.md § ${section}`),
  'skills/product-design/references/delivery-scope.md § The shape',
];

test('every pointer a brief, a hook or a skill step names prints under the cap, on both builds', () => {
  const variant = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const sizes = [];
  for (const at of POINTERS) {
    const source = printed(reference([at]));
    assert.ok(source.length < PRINT_MAX, `${at}: ${source.length} characters`);
    const built = printed(reference([at], variant));
    assert.ok(built.length < PRINT_MAX, `${at} (Copilot build): ${built.length} characters`);
    sizes.push([source.length, at]);
  }
  const [largest, at] = sizes.sort((a, b) => b[0] - a[0])[0];
  assert.ok(largest < PRINT_MAX, `the largest print, ${at}, is ${largest} characters`);
});

test('the hooks and the engine skill point at reference, never at the read tool', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(skill.includes('**Print what a `rules:` line names** before acting, with the `reference` verb'));
  assert.ok(skill.includes('adding ` § <the code>` after a refusal for that code\'s row'));
  assert.ok(skill.includes('Print `references/node-summaries.md` § *Who settled a decision* and § *What a risk is* now'));
  assert.doesNotMatch(skill, /Read `references\/node-summaries\.md` whole now/);
  for (const hook of ['post-compact-reminder.mjs', 'skill-invocation-reminder.mjs']) {
    const text = fs.readFileSync(path.join(PLUGIN, 'hooks', hook), 'utf8');
    assert.match(text, /reference --at=/, hook);
    assert.doesNotMatch(text, /next call is the read tool|read its files by absolute path/, hook);
  }
});

test('every --at a skill, an agent or a workflow guide spells in a reference call prints', () => {
  // A pointer that names no heading the file has is refused with reference-unknown-section at run time.
  const files = fs.readdirSync(PLUGIN, { recursive: true }).filter(file => String(file).endsWith('.md')).map(file => path.join(PLUGIN, String(file)));
  const spelled = new Set();
  for (const file of files) {
    for (const span of fs.readFileSync(file, 'utf8').match(/`[^`\n]*reference --at=[^`\n]*`/g) ?? []) {
      for (const [, quoted, bare] of span.matchAll(/--at=(?:"([^"]+)"|([^\s"`]+))/g)) {
        const at = quoted ?? bare;
        if (!/[<…$]/.test(at)) spelled.add(at);
      }
    }
  }
  assert.ok(spelled.size >= 8, [...spelled].join('\n'));
  for (const at of spelled) {
    const result = reference([at]);
    assert.equal(result.code, 0, `${at}: ${result.stderr}`);
  }
});
