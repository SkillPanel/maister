import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, ROOT, run, variantRoot } from '../helpers.mjs';
import { PRINT_MAX, reference as printReference } from '../../plugins/maister/skills/workflow-engine/scripts/lib/reference.mjs';

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

test('each gate-request refusal has a row of its own in the write table, and a grouped row is found by any of its codes', () => {
  const table = 'references/writing-state.md § When a write is refused';
  for (const code of ['gate-request-invalid', 'gate-request-exists', 'gate-request-pending', 'gate-request-unavailable', 'gate-unwritable', 'gate-temp-exists']) {
    const text = printed(reference([`${table} § ${code}`]));
    assert.equal(text.split('\n')[0], `== skills/workflow-engine/${table} § ${code}`);
    assert.equal(text.split('\n').filter(line => line.startsWith('| `')).length, 1, `${code}: one row`);
    assert.match(text, new RegExp(`^\\| \`${code}\` \\| `, 'm'), code);
  }
  // A row whose first cell groups several codes prints for each of them, and only that row.
  for (const code of ['state-unwritable', 'state-candidate-unsound', 'state-inline-collection']) {
    const text = printed(reference([`${table} § ${code}`]));
    assert.equal(text.split('\n').filter(line => line.startsWith('| `')).length, 1, `${code}: one row`);
    assert.match(text, new RegExp(`^\\| [^|]*\`${code}\``, 'm'), code);
  }
  // The gate brief's paragraph points at the rows rather than repeating them.
  const gates = fs.readFileSync(path.join(ENGINE_DIR, 'references', 'gates.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(gates.includes('each have a row in `references/writing-state.md` § *When a write is refused*'));
  refused(reference([`${table} § gate-request-nonsense`]), 'reference-unknown-section');
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
  'references/writing-state.md § When a write is refused § gate-request-invalid',
  'references/verbs.md § Refusals § move-base-no-base',
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

/**
 * The pointers a main-session text names: each backticked `.md` path, and each
 * `--at=` value a reference call spells, with where it stands in the text.
 */
function pointersIn(text) {
  const found = [];
  for (const match of text.matchAll(/`((?:<plugin[ _]root>\/|\$\{CLAUDE_PLUGIN_ROOT\}\/|\$CLAUDE_PLUGIN_ROOT\/)?[\w./-]+\.md)`/g)) {
    found.push({ given: match[1], after: text.slice(match.index + match[0].length, match.index + match[0].length + 8), at: false });
  }
  for (const match of text.matchAll(/--at=(?:"([^"]+)"|'([^']+)'|([^\s"'`]+))/g)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (/[<…$]/.test(value)) continue;
    const [given, ...rest] = value.split('§');
    found.push({ given: given.trim(), named: rest.length > 0, at: true });
  }
  return found;
}

/** The plugin file a pointer in `from` names, resolved as a reader would: beside it, then the engine, the plugin root and `skills/`. */
function pointed(given, from) {
  const bare = given.replace(/^(?:<plugin[ _]root>|\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)\//, '');
  const candidates = [path.resolve(path.dirname(from), bare), path.join(ENGINE_DIR, bare), path.join(PLUGIN, bare), path.join(PLUGIN, 'skills', bare)];
  return candidates.find(file => {
    const relative = path.relative(PLUGIN, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(file) && fs.statSync(file).isFile();
  }) ?? null;
}

test('every pointer the main session reads to a file past the cap names a section', () => {
  // A session following a bare pointer to such a file prints it whole and is refused reference-too-long.
  // Agents' own reads are a subagent's, so agents/ is not scanned.
  const overCap = new Map();
  const isOver = file => {
    if (!overCap.has(file)) {
      const result = printReference({ ats: [file], pluginRoot: PLUGIN });
      overCap.set(file, !result.ok && result.errors[0].code === 'reference-too-long');
    }
    return overCap.get(file);
  };
  const shown = file => path.relative(PLUGIN, file).split(path.sep).join('/');
  const files = fs.readdirSync(PLUGIN, { recursive: true }).map(String)
    .filter(file => file.endsWith('.md') && !file.split(/[\\/]/).includes('agents'))
    .map(file => path.join(PLUGIN, file));
  const bare = [];
  let checked = 0;
  for (const file of files) {
    // A Step 0 block is held word for word across the workflow hand-offs: it names where the
    // defaults live rather than sending the session to read a file, and is left out here.
    const text = fs.readFileSync(file, 'utf8').replace(/^### Step 0\b[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m, '').replace(/\s+/g, ' ');
    for (const pointer of pointersIn(text)) {
      const target = pointed(pointer.given, file);
      if (target === null || !isOver(target)) continue;
      checked += 1;
      const named = pointer.at ? pointer.named : /^\s?(?:,\s?|\(\s?)?(?:§|\*)/.test(pointer.after);
      if (!named) bare.push(`${shown(file)}: ${pointer.at ? '--at=' : ''}${pointer.given} → ${shown(target)}`);
    }
  }
  assert.ok(checked >= 40, `${checked} pointers to files past the cap were found`);
  assert.deepEqual(bare, [], `pointers to a file past the cap that name no section:\n${bare.join('\n')}`);
});

test('the inline runner route prints each runner whole in the calls its skill spells, every one under the cap', () => {
  for (const [skill, runner] of [['implementation-verifier', 'verification-runner'], ['implementation-plan-executor', 'implementation-runner']]) {
    const file = `agents/${runner}.md`;
    // Past the cap whole: the refusal lists its headings, so a caller can ask for sections.
    const whole = refused(reference([file]), 'reference-too-long');
    assert.match(whole, new RegExp(`agents[\\\\/]${runner}\\.md:`));
    // The calls the inline bullet spells, in order.
    const text = fs.readFileSync(path.join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
    const bullet = text.slice(text.indexOf('- **`inline`**'), text.indexOf('\n- **`', text.indexOf('- **`inline`**') + 1));
    assert.doesNotMatch(bullet, /file-read tool —|by line range/, `${skill}: the bullet no longer reads the file`);
    const calls = [...bullet.matchAll(/`node <plugin root>\/skills\/workflow-engine\/scripts\/workflow\.mjs reference ([^`]+)`/g)]
      .map(match => [...match[1].matchAll(/--at="([^"]+)"/g)].map(at => at[1]));
    assert.ok(calls.length >= 2, `${skill}: ${calls.length} calls`);
    const asked = new Set();
    for (const ats of calls) {
      const out = printed(reference(ats));
      assert.ok(out.length < PRINT_MAX, `${skill}: a call prints ${out.length} characters`);
      for (const at of ats) {
        assert.ok(at.startsWith(`${file} § `), at);
        asked.add(at.slice(`${file} § `.length));
      }
    }
    // Every heading at the top two levels, by the runner's own file, is asked for once.
    const headings = fs.readFileSync(path.join(PLUGIN, file), 'utf8').split(/\r?\n/)
      .filter(line => /^#{1,2} /.test(line)).map(line => line.replace(/^#+ /, '').trim());
    assert.deepEqual([...asked].sort(), [...headings].sort(), `${skill}: the calls cover ${runner} whole`);
  }
});
