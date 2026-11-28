import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, ROOT, run, scratchTree, variantRoot } from '../helpers.mjs';
import { PRINT_MAX, reference as printReference, rowSuffix } from '../../plugins/maister/skills/workflow-engine/scripts/lib/reference.mjs';

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

/** The plugin-root forms a pointer may open with: the placeholder, and the variable in its source and Copilot build spellings. */
const ROOT_PREFIX = String.raw`<plugin[ _]root>\/|\$\{(?:CLAUDE|MAISTER)_PLUGIN_ROOT\}\/|\$(?:CLAUDE|MAISTER)_PLUGIN_ROOT\/`;

/**
 * The pointers a main-session text names: each backticked `.md` path, and each
 * `--at=` value a reference call spells, with where it stands in the text.
 */
function pointersIn(text) {
  const found = [];
  for (const match of text.matchAll(new RegExp(String.raw`\`((?:${ROOT_PREFIX})?[\w./-]+\.md)\``, 'g'))) {
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

/** The file a pointer in `from` names in the plugin tree at `root`, resolved as a reader would: beside it, then the engine, the plugin root and `skills/`. */
function pointed(given, from, root) {
  const bare = given.replace(new RegExp(`^(?:${ROOT_PREFIX})`), '');
  const candidates = [path.resolve(path.dirname(from), bare), path.join(root, 'skills/workflow-engine', bare), path.join(root, bare), path.join(root, 'skills', bare)];
  return candidates.find(file => {
    const relative = path.relative(root, file);
    return !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(file) && fs.statSync(file).isFile();
  }) ?? null;
}

/**
 * Every pointer the main session reads in the plugin tree at `root` to a file
 * past the cap there that names no section, each as `<from>: <pointer> → <file>`,
 * with how many pointers to files past the cap were checked. A file is measured
 * as that tree holds it, so the Copilot build, whose rewrites lengthen some
 * files, is judged on its own text. Agents' own reads are a subagent's, so
 * agents/ is not scanned.
 */
function barePastCap(root) {
  const overCap = new Map();
  const isOver = file => {
    if (!overCap.has(file)) {
      const result = printReference({ ats: [file], pluginRoot: root });
      overCap.set(file, !result.ok && result.errors[0].code === 'reference-too-long');
    }
    return overCap.get(file);
  };
  const shown = file => path.relative(root, file).split(path.sep).join('/');
  const files = fs.readdirSync(root, { recursive: true }).map(String)
    .filter(file => file.endsWith('.md') && !file.split(/[\\/]/).includes('agents'))
    .map(file => path.join(root, file));
  const bare = [];
  let checked = 0;
  for (const file of files) {
    // A Step 0 block is held word for word across the workflow hand-offs: it names where the
    // defaults live rather than sending the session to read a file, and is left out here.
    const text = fs.readFileSync(file, 'utf8').replace(/^### Step 0\b[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m, '').replace(/\s+/g, ' ');
    for (const pointer of pointersIn(text)) {
      const target = pointed(pointer.given, file, root);
      if (target === null || !isOver(target)) continue;
      checked += 1;
      const named = pointer.at ? pointer.named : /^\s?(?:,\s?|\(\s?)?(?:§|\*)/.test(pointer.after);
      if (!named) bare.push(`${shown(file)}: ${pointer.at ? '--at=' : ''}${pointer.given} → ${shown(target)}`);
    }
  }
  return { checked, bare };
}

test('every pointer the main session reads to a file past the cap names a section, on both builds', () => {
  // A session following a bare pointer to such a file prints it whole and is refused reference-too-long.
  for (const [tree, root] of [['source', PLUGIN], ['Copilot build', variantRoot()]]) {
    const { checked, bare } = barePastCap(root);
    assert.ok(checked >= 40, `${tree}: ${checked} pointers to files past the cap were found`);
    assert.deepEqual(bare, [], `${tree}: pointers to a file past the cap that name no section:\n${bare.join('\n')}`);
  }
});

/** A plugin file in a code span: opening with the plugin root, `../` or one of the plugin's folders, or the skill file itself. */
const PLUGIN_PATH = String.raw`(?:(?:${ROOT_PREFIX}|\.\.\/|references\/|assets\/|scripts\/|workflows\/|skills\/|agents\/)[^\`\s]*|SKILL\.md)`;

/** A read verb, then nothing but spaces, emphasis or "the" before a plugin file's code span. */
const READ_VERB = new RegExp(String.raw`\b(?:read|reads|view|views|open|opens|load|loads)\b(?:\*{1,2}|\s|\bthe\b)*\`${PLUGIN_PATH}\``, 'gi');

/** A code span that prints a plugin file through a shell reader instead of the reference verb. */
const SHELL_READ = new RegExp(String.raw`\`(?:cat|type|Get-Content|head|tail|less|more)\s[^\`]*?${PLUGIN_PATH}[^\`]*\``, 'g');

/**
 * Each place in `text` that sends the main session to a plugin file with the
 * read tool, or with a shell reader, rather than printing it with `reference`:
 * the plugin sits outside the project, and a host asks before such a read.
 */
function readPointers(text) {
  const folded = text.replace(/\s+/g, ' ');
  return [...folded.matchAll(READ_VERB), ...folded.matchAll(SHELL_READ)].map(match => match[0]);
}

/** The texts the main session follows in the plugin tree at `root`: each skill file, workflow guide, engine reference and command. */
function mainSessionTexts(root) {
  return fs.readdirSync(root, { recursive: true }).map(String).filter(file => {
    const parts = file.split(/[\\/]/);
    if (!file.endsWith('.md')) return false;
    if (parts.length === 3 && parts[0] === 'skills' && parts[2] === 'SKILL.md') return true;
    if (parts.length === 4 && parts[0] === 'skills' && parts[1] === 'workflow-engine') return parts[2] === 'workflows' || parts[2] === 'references';
    return parts.length === 2 && parts[0] === 'commands';
  }).map(file => path.join(root, file));
}

test('the read-pointer matcher finds a read of a plugin file and passes a print, a project file and a prose read', () => {
  const caught = [
    'Vision selected → Read `references/vision-templates.md`, select template by project type',
    '**Read** `references/aggregation-strategy.md` for confidence scoring methodology.',
    'The workflow engine\'s Step 1 reads `../workflow-engine/references/node-summaries.md`, the shape',
    'View the `<plugin root>/skills/init/references/roadmap-templates.md` file',
    'run `cat <plugin root>/skills/init/SKILL.md` first',
  ];
  for (const line of caught) assert.equal(readPointers(line).length, 1, line);
  const passed = [
    'Print it with `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs reference --at="skills/init/references/vision-templates.md"`, never the read tool.',
    '**Close for whoever reads the end**, as `references/writing-state.md` § *Ending the run*',
    'Never open the files with the read tool: they sit outside the project.',
    'Read `.maister/docs/INDEX.md` only if it is not already in your context.',
    'read each one that passes using the Read tool to collect findings',
  ];
  for (const line of passed) assert.deepEqual(readPointers(line), [], line);
});

test('no main-session text sends the session to a plugin file with the read tool, on both builds', () => {
  // The session prints a plugin file with `reference`; a read of it, outside the project, stops the run for a prompt.
  for (const [tree, root] of [['source', PLUGIN], ['Copilot build', variantRoot()]]) {
    const files = mainSessionTexts(root);
    assert.ok(files.length >= 30, `${tree}: ${files.length} main-session texts were found`);
    const found = files.flatMap(file => readPointers(fs.readFileSync(file, 'utf8'))
      .map(snippet => `${path.relative(root, file).split(path.sep).join('/')}: ${snippet}`));
    assert.deepEqual(found, [], `${tree}: texts that send the session to read a plugin file:\n${found.join('\n')}`);
  }
});

test('a file under the cap on the source tree and past it on the Copilot build fails its bare pointer there', t => {
  // Build step 5 rewrites CLAUDE.md to .github/copilot-instructions.md in skills, 22 characters
  // longer each time: a file just under the cap at the source grows past it in the build.
  // The synthetic build below applies the same two substitutions as that step.
  const build = fs.readFileSync(path.join(ROOT, 'platforms/copilot-cli/build.sh'), 'utf8');
  assert.ok(build.includes(String.raw`sedi -e 's#\.claude/CLAUDE\.md#AGENTS.md#g' -e 's/CLAUDE\.md/.github\/copilot-instructions.md/g'`), 'build step 5 is the rewrite copied here');
  const mention = 'Read the project\'s CLAUDE.md block first.\n';
  const body = `# Big\n\n## Part\n\n${mention.repeat(10)}`;
  const big = body + 'x'.repeat(PRINT_MAX - 100 - body.length) + '\n';
  const skill = '# Demo\n\nFollow `references/big.md` before the first step.\n';
  const copilot = text => text.replace(/\.claude\/CLAUDE\.md/g, 'AGENTS.md').replace(/CLAUDE\.md/g, '.github/copilot-instructions.md');
  const source = scratchTree(t, { 'skills/demo/SKILL.md': skill, 'skills/demo/references/big.md': big });
  const built = scratchTree(t, { 'skills/demo/SKILL.md': copilot(skill), 'skills/demo/references/big.md': copilot(big) });

  assert.ok(printReference({ ats: ['skills/demo/references/big.md'], pluginRoot: source }).ok, 'whole on the source tree');
  assert.deepEqual(barePastCap(source), { checked: 0, bare: [] });
  const refused = printReference({ ats: ['skills/demo/references/big.md'], pluginRoot: built });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].code, 'reference-too-long', 'past the cap on the Copilot build');
  assert.deepEqual(barePastCap(built), { checked: 1, bare: ['skills/demo/SKILL.md: references/big.md → skills/demo/references/big.md'] });
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

test('the four guide pointers to the decision areas and the candidates print through reference, on both trees', () => {
  // research.md names the decision areas' writer; development, performance and migration name the candidates' consolidation.
  const pointers = [
    [
      'references/decision-areas.md § Who writes it',
      /^== skills\/workflow-engine\/references\/decision-areas\.md § Who writes it\n## Who writes it\n/,
    ],
    [
      '<plugin root>/skills/docs-manager/references/standard-candidates.md § Consolidation',
      /^== skills\/docs-manager\/references\/standard-candidates\.md § Consolidation\n## Consolidation\n/,
    ],
  ];
  for (const engine of [ENGINE, path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs')]) {
    for (const [at, heading] of pointers) {
      assert.match(printed(reference([at], engine)), heading, at);
    }
  }
});

test('the guide sections this group edits print under the cap, on both trees', () => {
  const sections = [
    'skills/workflow-engine/workflows/research.md § research-foundation',
    'skills/workflow-engine/workflows/research.md § solution-convergence',
    'skills/workflow-engine/workflows/research.md § high-level-design',
    'skills/workflow-engine/workflows/product-design.md § intake',
    'skills/workflow-engine/workflows/development.md § finalization',
    'skills/workflow-engine/workflows/performance.md § finalization',
    'skills/workflow-engine/workflows/migration.md § finalization',
  ];
  for (const engine of [ENGINE, path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs')]) {
    for (const at of sections) {
      const text = printed(reference([at], engine));
      assert.ok(text.length <= PRINT_MAX, `${at}: ${text.length} characters`);
    }
  }
});

test('gates.md "What the reset leaves" names the summary the writer drops', () => {
  const text = printed(reference(['references/gates.md § Revising at a gate'])).replace(/\s+/g, ' ');
  assert.match(text, /What the reset leaves\./);
  assert.ok(text.includes('the writer drops its earlier summary and lists it as `node_summaries.<id>`'));
  assert.ok(text.includes("A gate's own summary stays"));
});

test('every refusal code the interface lists for the writer\'s verbs has a pointer that resolves, its row when the section has one', () => {
  const verbs = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'interface.json'), 'utf8')).engine.verbs;
  const entry = name => (Array.isArray(verbs) ? verbs.find(each => each.name === name) : verbs[name]);
  const file = path.join(ENGINE_DIR, 'references', 'writing-state.md');
  const heading = 'When a write is refused';
  const codes = new Set(['write-state', 'move-base', 'subrun-handoff'].flatMap(name => entry(name).refusals));
  assert.ok(codes.has('state-config-decision-invalid'));
  for (const code of codes) {
    const suffix = rowSuffix(file, heading, code);
    const result = reference([`${file} § ${heading}${suffix}`]);
    if (suffix === '') {
      // The section itself is past the cap and is read by row: its pointer resolves to the section, not to a missing heading.
      refused(result, 'reference-too-long');
    } else {
      assert.equal(suffix, ` § ${code}`);
      assert.match(printed(result), new RegExp(`^\\|[^|]*\`${code}\``, 'm'), code);
    }
  }
  assert.equal(rowSuffix(file, heading, 'state-config-decision-invalid'), ' § state-config-decision-invalid');
  assert.equal(rowSuffix(file, heading, 'move-base-no-base'), '');
  assert.equal(rowSuffix(file, heading, 'gate-brief-value-missing'), '');
});

test('the write table\'s opening count equals the writer\'s codes with a row', () => {
  const text = fs.readFileSync(path.join(ENGINE_DIR, 'references', 'writing-state.md'), 'utf8').replace(/\r\n?/g, '\n');
  const section = text.slice(text.indexOf('## When a write is refused'));
  const body = section.slice(0, section.indexOf('\n## ', 5));
  const named = new Set();
  for (const line of body.split('\n').filter(each => each.startsWith('| `'))) {
    for (const [, code] of line.split('|')[1].matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) named.add(code);
  }
  // Raised before the writer runs, or by gate-request alone: the opening sentence names them apart.
  const apart = ['edition-collision', 'gate-request-unavailable', 'gate-request-invalid', 'gate-request-exists', 'gate-request-pending'];
  for (const code of apart) assert.ok(named.has(code), code);
  const words = ['forty', 'forty-one', 'forty-two', 'forty-three', 'forty-four', 'forty-five', 'forty-six', 'forty-seven', 'forty-eight'];
  const written = /The writer has\s+([a-z-]+),/.exec(body);
  assert.ok(written, 'the opening count is spelled');
  assert.equal(words.indexOf(written[1]) + 40, named.size - apart.length, written[1]);
});
