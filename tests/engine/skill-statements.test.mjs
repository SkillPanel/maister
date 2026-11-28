import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, variantRoot } from '../helpers.mjs';
import { reference } from '../../plugins/maister/skills/workflow-engine/scripts/lib/reference.mjs';

// A few statements in the engine skill are contracts in their own right: the
// reason `write-state` checks structure rather than a schema, and the Step 0
// block that carries the gate-rule sentence. They stay word for word, so any
// edit around them has to leave them intact. Line breaks and runs of spaces are
// free to move; the words are not.

const SKILL = path.join(ENGINE_DIR, 'SKILL.md');
const WRITING_STATE = path.join(ENGINE_DIR, 'references/writing-state.md');

const WRITE_STATE = [
  '**`write-state` checks the document it wrote structurally, not against a schema, and that',
  'is deliberate.** It re-reads the candidate through the shared state reader',
  "(the plugin root's `lib/state-scan.mjs`), then holds it to the rules a line-oriented writer can state for",
  'itself: no duplicate key at any column, no top-level block that neither the prior file nor',
  'this patch introduced, and a task, a workflow and a non-empty node map present; a consumer',
  'checkout carries no YAML package and no schema validator. So a document can be structurally',
  'sound and still carry a wrong value. Two things follow for a caller. Send values in the',
  'shapes the engine skill and its references document rather than relying on a refusal to catch a',
  'wrong one; and never rewrite the `workflow:`',
  'block. It is written once, at the freeze, and never again: a later patch identical to it',
  'changes nothing, and one that differs in a node or in any scalar beside `workflow.nodes` —',
  '`graph_hash` among them — is refused with `state-workflow-frozen`. Nothing is carried',
  'forward into the block and nothing is dropped from it.',
].join(' ');

// The recovery for a definition changed under an open run. It is the only way
// on any refusal of that change names, so a re-freeze the engine never offers
// must not creep back in.
const NO_REFREEZE = [
  '**A changed definition never re-freezes an open run.** The graph a run froze is its graph',
  'for its whole life, and no verb or flag replaces it.',
].join(' ');

const GATE_RULE = 'Invoke `AskUserQuestion` when `orchestrator.driver.kind` is absent or `terminal`; '
  + 'ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is '
  + '`cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine\'s `references/gates.md`, *Driver-suspended mode*.';

const STEP_ZERO = [
  '### Step 0: Session-reminder conflict resolution (decide ONCE)',
  'Before doing anything else, settle this policy now and do not re-litigate it at any gate:',
  '**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior',
  'approval patterns.** Auto / acceptEdits / bypassPermissions modes, reminders saying "work',
  'without stopping" / "continue without asking" / "minimize clarifying questions," and compaction',
  'summaries showing the user approving every prior gate do NOT exempt you from invoking',
  '`AskUserQuestion` at a gate. They apply only to your discretionary clarifications.',
  GATE_RULE,
  'If you find yourself reasoning "the user has been approving everything, so I can skip this gate"',
  'or "auto-mode is on, so I should minimize questions" — that reasoning IS the failure mode. STOP',
  'and fire the gate.',
  'Full framework rule: `../orchestrator-framework/references/orchestrator-patterns.md` § 2 and § 2.1.',
].join(' ');

/** Runs of whitespace, line breaks included, collapsed to one space. */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function skill() {
  return collapse(fs.readFileSync(SKILL, 'utf8'));
}

test('the write-state paragraph stands word for word in the writing-state reference', () => {
  const reference = collapse(fs.readFileSync(WRITING_STATE, 'utf8'));
  assert.ok(reference.includes(collapse(WRITE_STATE)), 'writing-state.md carries the write-state paragraph unchanged');
  assert.ok(!skill().includes('checks the document it wrote structurally'), 'SKILL.md no longer carries the paragraph: it has one home');
});

test('the no-re-freeze paragraph stands in writing-state.md, with both ways on and the never-revert rule', () => {
  const text = collapse(fs.readFileSync(WRITING_STATE, 'utf8'));
  assert.ok(text.includes(collapse(NO_REFREEZE)), 'writing-state.md says a changed definition never re-freezes an open run');
  assert.ok(!skill().includes(collapse(NO_REFREEZE)), 'SKILL.md no longer carries the paragraph: it has one home');
  const start = text.indexOf(collapse(NO_REFREEZE));
  const paragraph = text.slice(start, start + 800);
  for (const phrase of ['Put back the definition the run froze', 'start a new run from the changed definition',
    'Never revert a person\'s own edit unasked', '`dispatch-graph-drifted`', '`subrun-graph-drifted`', '`state-workflow-frozen`']) {
    assert.ok(paragraph.includes(phrase), `the paragraph names: ${phrase}`);
  }
});

test('the Step 0 block, gate-rule sentence included, stands word for word', () => {
  assert.ok(skill().includes(collapse(STEP_ZERO)), 'SKILL.md carries the Step 0 block unchanged');
});

test('the gate-rule sentence occurs exactly once', () => {
  const count = skill().split(collapse(GATE_RULE)).length - 1;
  assert.equal(count, 1, 'SKILL.md carries one copy of the gate-rule sentence');
});

// --- Node conventions rows ---------------------------------------------------
// Tests for the rows of the node conventions table go here.
//
// `references/node-conventions.md` under `# Node conventions` holds every node's default behaviour, once: one
// `| Applies to | Convention |` table whose first cell is one of eleven fixed
// keys, by which a reader selects the rows that apply to a node. A missing key
// fails. The table is no home for the gate rule: it carries neither the
// sentence nor its tail.

const CONVENTIONS_FILE = path.join(ENGINE_DIR, 'references/node-conventions.md');

const CONVENTION_KEYS = [
  '`agent:` step',
  '`skill:` step',
  '`direct:` step',
  '`workflow:` step',
  'gate',
  'every step',
  'asks',
  'feeds a checkpoint',
  'writes an explainer',
  'named by a revise',
  'has a budget',
];

const GATE_RULE_TAIL = 'ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is '
  + '`cockpit` or `dispatch`, suspend with one `gate-request` call — see the workflow engine\'s `references/gates.md`, *Driver-suspended mode*.';

/** The lines of the section headed exactly `heading`, up to the next heading of its level or above. */
function sectionLines(heading, file = SKILL) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `SKILL.md has no section headed ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, at) => at > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The conventions table's body rows as `{key, convention}`, header and rule excluded. */
function conventionRows() {
  const table = sectionLines('# Node conventions', CONVENTIONS_FILE).filter(line => line.startsWith('|'));
  assert.ok(table.length >= 2, 'the section holds a table');
  assert.match(table[0], /^\|\s*Applies to\s*\|\s*Convention\s*\|$/, 'the table is `| Applies to | Convention |`');
  return table.slice(2).map(line => {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split(' | ');
    return { key: cells[0].trim(), convention: cells.slice(1).join(' | ').trim() };
  });
}

test('the node conventions sit directly after the delegation section, inside the graph section', () => {
  const lines = fs.readFileSync(SKILL, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const graph = lines.indexOf('## Executing the graph');
  const headings = lines.map((line, at) => ({ line, at })).filter(({ line, at }) => at > graph && /^#{2,3} /.test(line));
  const delegation = headings.findIndex(({ line }) => line === '### Delegation by scheme');
  assert.ok(delegation >= 0, 'the graph section holds the delegation subsection');
  assert.equal(headings[delegation + 1].line, '### Node conventions');
  assert.ok(headings.slice(0, delegation + 1).every(({ line }) => !line.startsWith('## ')), 'still inside ## Executing the graph');
});

test('the skill\'s conventions section points at the reference that holds the table', () => {
  const section = sectionLines('### Node conventions');
  assert.ok(!section.some(line => line.startsWith('|')), 'the skill no longer carries the table');
  assert.ok(section.join('\n').includes('`references/node-conventions.md`'), 'the section names the reference');
});

test('the conventions table holds each of the ten keys as a first cell, once', () => {
  const keys = conventionRows().map(row => row.key);
  for (const key of CONVENTION_KEYS) {
    assert.equal(keys.filter(found => found === key).length, 1, `the table has one row for ${key}`);
  }
  assert.deepEqual([...keys].sort(), [...CONVENTION_KEYS].sort(), 'no row outside the eleven keys');
});

test('every convention row says something', () => {
  for (const { key, convention } of conventionRows()) assert.ok(convention.trim() !== '', `the ${key} row says something`);
});

test('the conventions table carries no copy of the gate-rule sentence or its tail', () => {
  const section = collapse(sectionLines('# Node conventions', CONVENTIONS_FILE).join('\n'));
  assert.ok(!section.includes(collapse(GATE_RULE)), 'no gate-rule sentence');
  assert.ok(!section.includes(collapse(GATE_RULE_TAIL)), 'no gate-rule tail');
});

test('the asks row records each in-session answer as an operator decision on the step\'s own summary', () => {
  const asks = conventionRows().find(row => row.key === 'asks');
  assert.ok(asks, 'the table has an asks row');
  assert.match(asks.convention, /`by: operator`/, 'the asks row names `by: operator`');
  assert.match(asks.convention, /`question_id`/, 'the asks row names `question_id`');
  assert.match(asks.convention, /`as_recommended`/, 'the asks row names `as_recommended`');
  assert.match(asks.convention, /`node_summaries`/, 'the asks row records on the step\'s `node_summaries` entry');
  assert.match(asks.convention, /summary|`node_summaries`/, 'recording lands on the step\'s own summary');
  const section = sectionLines('# Node conventions', CONVENTIONS_FILE).filter(line => line.includes('`ask:`'));
  assert.equal(section.length, 1, 'only the asks row mentions `ask:`');
  assert.ok(section[0].startsWith('| asks |'), 'the line mentioning `ask:` is the asks row');
});

// --- Instructions that must match what the engine does -----------------------

/** A `###` section of SKILL.md, from its heading to the next heading of any level up to three, collapsed. */
function section(heading) {
  const raw = fs.readFileSync(SKILL, 'utf8');
  const start = raw.indexOf(`\n### ${heading}`);
  assert.ok(start >= 0, `SKILL.md has a section ### ${heading}`);
  const rest = raw.slice(start + 1);
  const next = rest.slice(4).search(/\n#{1,3} /);
  return collapse(next < 0 ? rest : rest.slice(0, next + 4));
}

test('Step 4 says the freeze creates the run directory, and never tells the session to', () => {
  const step = section('Step 4');
  assert.ok(step.includes('the freeze creates it'), 'Step 4 says the freeze creates the task directory');
  assert.ok(!step.includes('Create it once'), 'Step 4 no longer tells the session to create it');
});

test('Step 5 points a phase jump at the step\'s checkpoint, never at the 2.x line', () => {
  const step = section('Step 5');
  assert.ok(!/finish(ed)? on the 2\.x line/.test(step), 'Step 5 no longer sends a run to the 2.x line');
  assert.ok(step.includes('revise'), 'Step 5 names the revise at the step\'s checkpoint');
});

test('interpolation says nowhere that an ask: is substituted — neither the grammar\'s § 9 nor anywhere in the skill', () => {
  const raw = fs.readFileSync(path.join(ENGINE_DIR, 'references/grammar.md'), 'utf8').replace(/\r\n?/g, '\n');
  const start = raw.indexOf('\n## 9. Interpolation');
  assert.ok(start >= 0, 'grammar.md has § 9');
  const end = raw.indexOf('\n## ', start + 1);
  const grammar = collapse(raw.slice(start, end < 0 ? undefined : end));
  assert.ok(grammar.includes('A gate\'s `ask` is shown as written'), 'grammar § 9 says a gate\'s ask is shown as written');
  assert.ok(!grammar.includes('substitutes the ones in its `ask:`'), 'no claim in grammar § 9 that ask: is interpolated');
  assert.ok(!skill().includes('substitutes the ones in its `ask:`'), 'no claim anywhere in SKILL.md that ask: is interpolated');
});

test('the gate rule is loaded first: a gate is asked from the call its brief prints, never by hand, and the skill spells no picker passage', () => {
  const before = collapse(sectionLines('## Before anything else').join('\n'));
  assert.ok(before.includes('run an `ask it:` line\'s call alone, then ask what it prints'), 'Before anything else names the brief\'s ask it line');
  assert.ok(before.includes('never write a gate question by hand'), 'Before anything else keeps the never-by-hand rule');
  const raw = fs.readFileSync(SKILL, 'utf8');
  assert.doesNotMatch(raw, /rich-picker|plain-picker/, 'no picker marker is left in the skill (host markers are allowed)');
  for (const heading of ['### Gates and in-node questions', '### Interpolating', '### Ending a dispatched run', '## Sub-runs']) {
    assert.ok(!raw.split(/\r?\n/).some(line => line.startsWith(heading)), `the skill no longer carries ${heading}: its brief lines print it`);
  }
});

// --- The compaction head -----------------------------------------------------
// After a compaction Claude Code re-attaches a skill this long cut to 20,000
// characters, its truncation marker included: 19,902 characters of text. A
// short loader header comes first, then 19,745 characters of the skill's body
// after its frontmatter, which is not counted. The rules a run needs mid-run
// therefore come first, and the last of them ends under 19,500 characters of
// that body, about 245 characters short of the cut. Lengths are the string
// length of the file read as UTF-8 (UTF-16 code units), never bytes.

const HEAD = [
  '## Before anything else',
  '## Initialization',
  '## Speaking to the user',
  '## The invocation contract',
  '## Operator visibility',
  '### The ready set',
];
const HEAD_LIMIT = 19_500;

/** SKILL.md's body: everything after the frontmatter's closing `---` line, the blank lines after it skipped. */
function body() {
  const raw = fs.readFileSync(SKILL, 'utf8');
  const close = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  assert.ok(close, 'SKILL.md opens with a frontmatter block');
  return raw.slice(close[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
}

test('the rules a run needs mid-run come first, in order, and end inside what a compaction keeps', () => {
  const text = body();
  const starts = HEAD.map(heading => {
    const match = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'm').exec(text);
    assert.ok(match, `SKILL.md has a heading ${heading}`);
    return match.index;
  });
  for (let at = 1; at < starts.length; at += 1) {
    assert.ok(starts[at] > starts[at - 1], `${HEAD[at]} comes after ${HEAD[at - 1]}`);
  }
  const last = starts.at(-1);
  // The section ends where the next heading of level one to three begins.
  const next = /\n#{1,3} /.exec(text.slice(last));
  const end = next ? last + next.index + 1 : text.length;
  assert.ok(end > last + HEAD.at(-1).length, 'the last head section has a body');
  assert.ok(end < HEAD_LIMIT, `the head ends at body character ${end}, at or past ${HEAD_LIMIT}`);
});

// --- Resume, the conventions sentence and the skip rule -----------------------

test('Resume names the step and section calls, with the limit on file reads', () => {
  const text = skill();
  assert.ok(text.includes('Brief what `step_call` names, print what `section_call` names; never read the state file or a reference page with the file tool to find the step or the section; the driven answer reads (`gates.md` step 1) are unchanged.'));
  assert.ok(text.includes('prints the two *Driver-suspended mode* sections in one call'));
  assert.ok(!text.includes('Read the reference with the read tool, never through a shell'), 'the old read-tool sentence is gone');
});

test('the brief-printing sentence for a rules: page is gone from the skill', () => {
  const text = skill();
  assert.ok(!text.includes('print it the first time in a session'));
  assert.ok(!text.includes('again after a compaction, which drops what was read'));
});

test('The ready set says an engine-recorded skip needs no summary and a judged one keeps it', () => {
  const lines = sectionLines('### The ready set').join(' ');
  assert.match(collapse(lines), /A skip the engine records needs no summary; a skip you judge keeps one\./);
  const state = collapse(fs.readFileSync(WRITING_STATE, 'utf8'));
  assert.ok(state.includes('A skip the engine records needs no summary, and a skip the session judges keeps one.'));
});

test('Starting a run batches its first calls and skips the checks a hand-over already made', () => {
  const text = collapse(skill());
  assert.ok(text.includes('`validate --short --definition=<path> [--overlay=<path>…] [--profile=<name>]` and `resolve --short` with the same flags in one message'));
  assert.ok(text.includes('in one `reference` call with one `--at` each'));
  assert.ok(text.includes('references/gates.md` § *Before every gate — the gate brief*'));
  assert.ok(text.includes('A run `/maister:run` hands over with the located definition, overlays, profile and a passed validation gets no second `locate` or `validate`.'));
  // The hand-over carries each of those values.
  const handOver = collapse(fs.readFileSync(path.join(ENGINE_DIR, '..', 'run', 'SKILL.md'), 'utf8'));
  for (const value of ['the located `definition` path, and that `validate` passed on it', 'the overlays, located ones first', 'the profile, when one was given']) {
    assert.ok(handOver.includes(value), value);
  }
});

// --- Calls in one message, said per host ---------------------------------------
const P1 = 'A file write and the command that reads it may share a message — the patch file and its closing write above all — and so may calls that only read';
const P3 = '— unless a patch file a refused write left is still on disk: then write the corrected file and run the write in two messages.';
const P2 = 'Calls where one needs the other\'s result never share a message; calls that only read may.';

/** The text outside every `<!-- … -->` comment, collapsed. */
function outsideComments(raw) {
  return collapse(raw.replace(/<!--[\s\S]*?-->/g, ''));
}

test('the source skill says in Claude Code\'s passage that calls may share a message, with the guard, and P2 only inside a comment', () => {
  const raw = fs.readFileSync(SKILL, 'utf8').replace(/\r\n?/g, '\n');
  assert.match(raw, /^<!-- claude-code -->\n[^\n]*\n<!-- \/claude-code -->\n<!-- copilot\n[^\n]*\n-->$/m, 'one marked pair');
  assert.ok(collapse(raw).includes(`${P1} ${P3}`), 'P1 with P3 appended');
  assert.ok(!outsideComments(raw).includes(P2), 'P2 is only in the copilot comment');
  assert.ok(collapse(raw).includes(P2), 'P2 sits in the copilot comment');
});

test('the variant skill reads P2 and no P1 or P3 text, and stays within the Copilot budget', () => {
  const root = variantRoot();
  const raw = fs.readFileSync(path.join(root, 'skills/workflow-engine/SKILL.md'), 'utf8');
  assert.ok(collapse(raw).includes(P2), 'P2 in the variant');
  assert.ok(!raw.includes('may share a message'), 'no P1 text in the variant');
  assert.ok(!raw.includes('two messages'), 'no P3 text in the variant');
  assert.doesNotMatch(raw, /<!--\s*\/?(?:claude-code|copilot)/);
  const printed = reference({ ats: ['SKILL.md'], pluginRoot: path.join(root, 'skills/workflow-engine') });
  const length = printed.ok ? printed.text.length : raw.length;
  assert.ok(length <= 19906, `the variant engine skill prints ${length} characters`);
});

// --- The closing write walks on: the loop bullets -----------------------------

test('Before anything else tells the session to close with --next and to call node-brief in four cases only', () => {
  const before = collapse(sectionLines('## Before anything else').join('\n'));
  assert.ok(before.includes('Close a step, record a skip (one you judged, or one a brief\'s `now false` or `skip it:` line gives), or record a gate\'s answer with `--next`. What follows the `next:` line is the next step\'s brief: act on it and never ask for it again.'));
  for (const phrase of ['only after a run\'s first write', 'after a plain `run node-brief for it` line', 'after `resume-check` (its `step_call`)', 'after `gate-revise`']) {
    assert.ok(before.includes(phrase), phrase);
  }
});

// --- The question folded into the brief: the gate bullets ---------------------

const ENGINE_TREES = () => [['source', ENGINE_DIR], ['Copilot build', path.join(variantRoot(), 'skills/workflow-engine')]];

/** The printed text of one reference section, whitespace collapsed, in one tree. */
function printedSection(root, at) {
  const out = reference({ ats: [at], pluginRoot: root });
  assert.ok(out.ok, `${at} prints`);
  return { text: collapse(out.text), length: out.text.length };
}

test('both trees\' engine skill say to pass a printed question as printed, run ask again only to ask again, and details when asked for more', () => {
  for (const [tree, root] of ENGINE_TREES()) {
    const before = collapse(printedSection(root, 'SKILL.md').text);
    assert.ok(before.includes('Pass a printed `question:` as printed.'), `${tree}: pass the printed question as printed`);
    assert.ok(before.includes('Run `ask again:` only to ask again'), `${tree}: ask again only to ask again`);
    assert.ok(before.includes('`details:` when the person asks for more'), `${tree}: details when the person asks for more`);
  }
});

test('the ask again line points at gates.md Terminal mode for the no-second-question rule, in both trees', () => {
  for (const [tree, root] of ENGINE_TREES()) {
    const text = printedSection(root, 'SKILL.md').text;
    assert.ok(text.includes('only to ask again (`references/gates.md` § *Terminal mode*)'), `${tree}: the pointer`);
  }
});

test('gates.md Terminal mode holds the no-second-question rule, with the Copilot cases only on the Copilot build', () => {
  const at = 'references/gates.md § Terminal mode';
  for (const [tree, root] of ENGINE_TREES()) {
    const text = printedSection(root, at).text;
    assert.ok(text.includes('After a brief that printed a question, make no other call that prints one'), `${tree}: the rule`);
    assert.ok(text.includes('`ask it:` line instead of the question'), `${tree}: the ask it case`);
  }
  const copilot = printedSection(ENGINE_TREES()[1][1], at).text;
  assert.ok(copilot.includes('overwrites `.ask.json` and retires the answer note'), 'the reason');
  assert.ok(copilot.includes('only after the details print, after a revise\'s note (`--ask --note`), and when the brief printed an `ask it:` line'), 'the three cases');
  assert.doesNotMatch(copilot, /--picker=rich/, 'no rich profile in the variant');
});

test('on the source More details is the details call, and a typed details too; the Copilot build runs ask again after the details print', () => {
  const at = 'references/gates.md § Terminal mode';
  const [[, source], [, copilot]] = ENGINE_TREES();
  const src = printedSection(source, at).text;
  assert.ok(src.includes('More details is the `details:` call'), 'source: More details');
  assert.ok(src.includes('A typed "details" is the same request.'), 'source: typed details');
  assert.ok(!src.includes('Its preview already shows the full brief'), 'source: the preview no longer stands for the brief');
  const cop = printedSection(copilot, at).text;
  assert.ok(cop.includes('More details is the `details:` call'), 'copilot: More details');
  assert.ok(cop.includes('then run `ask again:` and ask what it prints'), 'copilot: ask again after details');
});

test('the gate-brief forms describe --details standing alone, and node-brief\'s row names question, ask again and details', () => {
  for (const [tree, root] of ENGINE_TREES()) {
    const forms = printedSection(root, 'references/gates.md § The `gate-brief` forms').text;
    assert.ok(forms.includes('`--details` stands alone: it prints `more_details` as plain text, writes no `.ask.json` and retires no note'), `${tree}: standalone details`);
    const verbs = collapse(fs.readFileSync(path.join(root, 'references/verbs.md'), 'utf8'));
    assert.ok(verbs.includes('a `question:` line, an `ask again:` call and a `details:` call'), `${tree}: the node-brief row`);
  }
});

test('every section the fold changed stays within the print budget in both trees, and the Copilot engine skill within 19,906', () => {
  const sections = [
    'SKILL.md',
    'references/gates.md § Terminal mode',
    'references/gates.md § Before every gate',
    'references/gates.md § The `gate-brief` forms',
    'references/verbs.md § The verbs every run calls',
  ];
  for (const [tree, root] of ENGINE_TREES()) {
    for (const at of sections) {
      const { length } = printedSection(root, at);
      assert.ok(length <= 20_000, `${tree}: ${at} prints ${length}`);
    }
  }
  assert.ok(printedSection(ENGINE_TREES()[1][1], 'SKILL.md').length <= 19906, 'the Copilot engine skill');
});
