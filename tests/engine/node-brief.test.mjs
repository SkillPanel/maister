import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ENGINE, ENGINE_DIR, FIXTURES, ROOT, freeze, freezePatch, maskRoot, reach, readState, scratch, scratchPlugin, sharedPlugin, run, sibling, variantRoot, verb, walkTo, write } from '../helpers.mjs';

// The brief a step reads before it runs: the facts the engine derives for it —
// how it runs, its guard, its attempt, its inputs filled in, the files it
// writes, the questions it asks under this run's driver, the checkpoint it
// feeds, its brief: data and the convention rows that apply — then the step's
// own section of the guide. Its one write is the start of a ready step
// (`run-status.test.mjs`); nothing else is written. Lines that would
// say only the default are left out, and a row that may apply later is named
// on one line rather than printed whole.

const DEFINITIONS = path.join(FIXTURES, 'definitions');
const NODE_BRIEF = path.join(DEFINITIONS, 'node-brief.yml');
const NODE_BRIEF_OVERLAY = path.join(DEFINITIONS, 'node-brief.overlay.yml');
const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const SKILL = path.join(ENGINE_DIR, 'references/node-conventions.md');
const RULES = `rules: ${SKILL} § Node conventions`;
/** The line every brief opens with: the command that prints the engine skill whole. */
const engineSkill = (dir = ENGINE_DIR) => `engine skill: print it whole now with node ${path.join(dir, 'scripts', 'workflow.mjs')} reference --at=SKILL.md, unless it is in this context`;
const ENGINE_SKILL = engineSkill();
/** The line after it: the one-command form every call takes. */
const COMMANDS = 'commands: one per call, from the project root — no cd, chain or pipe; a patch as a here-string';
/** The line after that: plugin files are printed, and a patch file is never /dev/stdin. */
const FILES = 'plugin files: print them only with reference, never the file tool, sed or cat; a patch file is .state-patch.json beside the state file, never /dev/stdin';
/** The three lines every brief opens with. */
const OPENING = [ENGINE_SKILL, COMMANDS, FILES];
/** The asks line's tail, naming the section a node prints before its first question, by driver. */
const asksTail = section => ` — before the first, print reference --at="references/in-node-questions.md § ${section}"`;
const ASKS_TAIL = asksTail('In-node questions');
/** `text` as a regular expression matching it literally. */
const esc = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REFUSALS = ['node-brief-state-unreadable', 'node-brief-not-a-run', 'node-brief-unknown-node'];
const RUN_PATH = '.maister/tasks/development/2026-01-05-sample';

/** The brief's lines from its `## ` header on, past the lines a brief may open with. */
function fromHeader(stdout) {
  const lines = stdout.split('\n');
  return lines.slice(lines.findIndex(line => line.startsWith('## ')));
}

function nodeBrief(state, node, engine = null) {
  const args = ['node-brief', `--state=${state}`, `--node=${node}`];
  return engine ? run(engine, args) : verb(args);
}

/** The convention rows of the engine skill, by their first cell, read the way a reader of the table reads them. */
function conventions(skill = SKILL) {
  // A Windows checkout gives `.md` files CRLF.
  const lines = fs.readFileSync(skill, 'utf8').split(/\r?\n/);
  const start = lines.indexOf('# Node conventions');
  const rows = {};
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || line.startsWith('| Applies to')) continue;
    const cells = line.slice(1).replace(/\|\s*$/, '');
    const at = cells.indexOf('|');
    rows[cells.slice(0, at).trim()] = cells.slice(at + 1).trim();
  }
  return rows;
}

const row = key => `convention (${key}): ${conventions()[key]}`;
const LATER = 'convention (named by a revise, has a budget): see rules';
const COMPANION_WRITER = 'companion writer: maister:html-companion-writer, model haiku, effort high (source: shipped agents.html-companion-writer, tier light) — the call for each page owed above that is not on disk when the step\'s work is done, never on the session\'s model; its prompt carries the html line and that page\'s md_path line below, as printed';
const STYLE_GUIDE = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/references/html-report-style.md');

/** The closing patch skeleton a step's brief prints, its node entry and any summary keys beyond the four every step has. */
const SUMMARY_KEYS = '"headline": "<one sentence, at most 220 characters>", "summary": "<what was found and what it means>", "decisions": [{"decision": "<…>", "by": "operator|run|audit|default"}], "risks": [{"risk": "<…>", "tag": "open|tradeoff|followup|stop|resolved"}]';
const closing = (node, entry = '"status": "completed"', extra = '') => 'closing patch (fill each <…>; never re-send workflow): '
  + `{"nodes": {"${node}": {${entry}}}, "node_summaries": {"${node}": {${SUMMARY_KEYS}${extra}}}}`;

/** Every file under `dir`, by relative path, with its text: equal before and after means nothing was written. */
function snapshot(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    files[path.relative(dir, file)] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

function sampleRun(t, { overlays = [], options = { html_output: true } } = {}) {
  const sample = scratch(t);
  freeze(sample, { definition: NODE_BRIEF, overlays, orchestrator: { options } });
  return sample;
}

test('node-brief: a step of a fresh development run — the lines that always print, the empty and default ones omitted, the inputs filled in', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });

  const gap = nodeBrief(dev.state, 'gap-analysis');
  assert.equal(gap.code, 0, gap.stderr);
  assert.equal(gap.stderr, '');
  const [header, slice] = [gap.stdout.slice(0, gap.stdout.indexOf('\n\n')), gap.stdout.slice(gap.stdout.indexOf('\n\n') + 2)];
  assert.deepEqual(header.split('\n'), [
    ...OPENING,
    '## Node: gap-analysis — Gap analysis',
    'runs: agent:gap-analyzer — Task tool as maister:gap-analyzer, model omit, effort omit (source: shipped default)',
    'say: "Gap analysis is running. Nothing needed from you; I\'ll continue when it finishes."',
    'with:',
    `- analysis: ${RUN_PATH}/analysis/codebase-analysis.md`,
    `- clarifications: ${RUN_PATH}/analysis/clarifications.md`,
    `- design_index: ${RUN_PATH}/analysis/design-context/INDEX.md`,
    '- task_description: Add a page',
    'writes:',
    `- gap: ${RUN_PATH}/analysis/gap-analysis.md`,
    `- scope: ${RUN_PATH}/analysis/scope-clarifications.md`,
    'records: has_reproducible_defect (bool), mockups_needed (bool), risk_level (enum: high, medium, low)',
    `asks (in session): scope-decisions${ASKS_TAIL}`,
    'feeds: gap-approval — continues: continue-past-analysis; revise: revise-gap-analysis → gap-analysis',
    'budget: 2 attempts — a prose rule; nothing enforces it',
    row('`agent:` step'),
    row('every step'),
    row('asks'),
    row('feeds a checkpoint'),
    LATER,
    closing('gap-analysis', '"status": "completed", "values": {"has_reproducible_defect": true|false, "mockups_needed": true|false, "risk_level": "high|medium|low"}'),
    RULES,
  ]);
  assert.ok(slice.trim().length > 0 && !slice.startsWith('\n'), 'the section follows the one blank line');
  assert.doesNotMatch(header, /^when:/m, 'an unguarded step prints no when line');
  assert.doesNotMatch(header, /^attempt:/m, 'a first attempt nothing has run prints no attempt line');

  // A retry on its last budgeted attempt, with no revise behind it: the attempt
  // prints and the budget row prints whole; the revise row stays named, since
  // no recorded revise names the step.
  const before = fs.readFileSync(dev.state, 'utf8');
  const retried = before.replace(/(    gap-analysis: \{kind: [a-z]+, )status: pending/, '$1status: pending, attempt: 2');
  assert.notEqual(retried, before, 'the node line carries the attempt');
  fs.writeFileSync(dev.state, retried);
  const again = nodeBrief(dev.state, 'gap-analysis').stdout.split('\n');
  assert.ok(again.includes('attempt: 2 — pending'));
  assert.ok(again.includes(row('has a budget')), 'the last budgeted attempt prints the budget row');
  assert.ok(!again.includes(row('named by a revise')), 'a retry is no revise');
  assert.ok(again.includes('convention (named by a revise): see rules'));

  // A direct step that owes no companion, keeps its section, asks nothing and feeds no checkpoint, and declares only its explainer page: its header is its facts, the page with its writer, and the pointer.
  const finalization = nodeBrief(dev.state, 'finalization').stdout;
  const finalHeader = finalization.slice(0, finalization.indexOf('\n\n')).split('\n');
  assert.deepEqual(finalHeader.filter(line => !line.startsWith('- ')), [
    ...OPENING,
    '## Node: finalization — Finalization',
    'runs: direct:finalization — inline',
    'with:',
    'writes:',
    'explainer: verification/change-explainer.html',
    'explainer writer: maister:explainer-writer, model omit, effort omit (source: shipped default) — the call that writes the page, as the `writes an explainer` row says; its prompt carries the step\'s run-context and this check script as check_script',
    row('every step'),
    row('writes an explainer'),
    closing('finalization', undefined, ', "absent": {"explainer": "<reason, only when not written>"}'),
    RULES,
  ]);

  // A guarded step: its guard as written, and a value no node has recorded yet.
  const red = nodeBrief(dev.state, 'tdd-red');
  assert.equal(red.code, 0, red.stderr);
  assert.match(red.stdout, /^when: \$\{gap-analysis\.values\.has_reproducible_defect\} — now not yet decidable$/m);
  reach(dev, { nodes: { 'gap-analysis': { status: 'completed', values: { has_reproducible_defect: true, mockups_needed: false, risk_level: 'low' } } } });
  assert.match(nodeBrief(dev.state, 'tdd-red').stdout, /^when: .* — now true$/m);
  assert.match(nodeBrief(dev.state, 'ui-mockups').stdout, /^when: .* — now false$/m);

  // No picker marker reaches a built-in's slice; the sample's draft section shows the rich text kept.
  for (const id of ['intake', 'specification', 'verification-options']) {
    assert.doesNotMatch(nodeBrief(dev.state, id).stdout, /rich-picker|plain-picker/, id);
  }
});

test('node-brief: an agent step is told to paste the context output whole, never piped through a filter', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const lines = nodeBrief(dev.state, 'gap-analysis').stdout.split('\n');
  const agentRow = lines.find(line => line.startsWith('convention (`agent:` step): '));
  assert.ok(agentRow, lines.join('\n'));
  assert.match(agentRow, /`prior-context --node` pasted whole and unedited/);
  assert.match(agentRow, /never piped through `head`, `sed` or any filter/);
});

test('node-brief: the exact brief of a step with brief: data, a renamed section and an owed page', t => {
  const sample = sampleRun(t);
  const result = nodeBrief(sample.state, 'draft');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const relative = path.relative(sample.root, sample.dir).split(path.sep).join('/');
  assert.equal(result.stdout, [
    ...OPENING,
    '## Node: draft — Drafting',
    'runs: direct:draft-notes — inline',
    'with:',
    '- audit_flag: null',
    '- deep: false',
    '- focus: (not recorded yet)',
    '- label: Focus: (not recorded yet)',
    `- sources: {"list":["plain",false],"notes":"${relative}/analysis/scope.md"}`,
    'missing: focus from scope — re-drive scope or record the value; never substitute one',
    'writes:',
    `- extras: ${relative}/drafts/extras.md — may be absent: Written only when the draft raises open questions.`,
    `- notes: ${relative}/drafts/notes.md — HTML page owed: notes.html beside it`,
    COMPANION_WRITER,
    `- html: ${STYLE_GUIDE}`,
    `- md_path: ${path.join(sample.dir, 'drafts/notes.md')}`,
    `asks (in session): tone${ASKS_TAIL}`,
    'feeds: approval — continues: continue-to-audit, continue-to-wrap-up; revise: revise-draft → draft',
    'budget: 2 attempts — a prose rule; nothing enforces it',
    row('`direct:` step'),
    row('every step'),
    row('asks'),
    row('feeds a checkpoint'),
    LATER,
    `see: ${path.join(DEFINITIONS, 'node-brief.md')} § Embedded mode`,
    closing('draft', undefined, ', "absent": {"extras": "<reason, only when not written>"}, "recommends": {"option": "continue-to-audit|continue-to-wrap-up", "reason": "<one line>"}'),
    RULES,
    '',
    '**Does.** Write the notes from the scope. As a child run, *Embedded mode* applies.',
    '',
    '### Checks',
    '',
    'Read the notes back before completing.',
    '',
    '**Asks.**',
    '',
    'Each tone\'s option carries a sample sentence as its preview.',
    '',
    '**With question sets** (`tone`): in this step\'s one request. Default: a plain tone.',
    '',
    '**Without question sets** (`tone`): a plain tone, as the step\'s assumption.',
    '',
    '```',
    '## `not-a-heading`',
    '```',
    '',
    '**Budget.** Re-draft from the scope on the second attempt.',
    '',
  ].join('\n'));

  // An input set recommends its option; a recorded value fills its reference, inside text too.
  write(sample, {
    orchestrator: { options: { inputs: { audit: 'yes' } } },
    nodes: { scope: { status: 'completed', values: { wants_audit: true, focus: 'narrow' } } },
  });
  const set = nodeBrief(sample.state, 'draft').stdout;
  assert.match(set, /^recommends: audit_flag = yes → continue-to-audit$/m);
  assert.doesNotMatch(nodeBrief(sampleRun(t).state, 'draft').stdout, /^recommends:/m, 'an unset input recommends nothing, and says nothing');
  assert.match(set, /^- focus: narrow$/m);
  assert.match(set, /^- label: Focus: narrow$/m);
  assert.doesNotMatch(set, /^missing:/m, 'a recorded value is missing no longer');
});

test('node-brief: every rule a step of a built-in can trigger reaches it — the four that must print whole wherever they apply', t => {
  const always = { agent: '`agent:` step', skill: '`skill:` step', workflow: '`workflow:` step' };
  const required = { research: { question: 'A question' }, 'mockup-studio': { note: 'Draw the settings page' } };
  for (const name of ['development', 'migration', 'mockup-studio', 'performance', 'product-design', 'research']) {
    const run = scratch(t, { type: name });
    const graph = freeze(run, { definition: path.join(ENGINE_DIR, 'workflows', `${name}.yml`), inputs: required[name] ?? { task_description: 'A task' }, orchestrator: { options: { html_output: true } } });
    for (const node of graph.nodes.filter(each => each.type !== 'gate')) {
      const text = nodeBrief(run.state, node.id).stdout;
      const header = text.slice(0, text.indexOf('\n\n')).split('\n');
      const has = key => header.includes(row(key));
      const where = `${name}/${node.id}`;
      const scheme = node.uses.slice(0, node.uses.indexOf(':'));
      if (always[scheme]) assert.ok(has(always[scheme]), `${where}: its scheme's row`);
      if (header.some(line => /^(writes|records):/.test(line))) assert.ok(has('every step'), `${where}: the artifact self-check`);
      if (header.some(line => line.startsWith('asks ('))) assert.ok(has('asks'), `${where}: the answer-recording rule`);
      if (header.some(line => line.startsWith('feeds: '))) assert.ok(has('feeds a checkpoint'), `${where}: the summary contract`);
      for (const key of ['named by a revise', 'has a budget']) {
        const named = header.some(line => /^convention \(.*\): see rules$/.test(line) && line.includes(key));
        assert.ok(!(has(key) && named), `${where}: ${key} printed and named both`);
      }
      assert.equal(header.at(-1), RULES, `${where}: the pointer closes the header`);
    }
  }
});

test('node-brief: a step run in the main session is told where its throwaway files go, never a fixed /tmp', t => {
  const run = scratch(t, { type: 'research' });
  freeze(run, { definition: path.join(ENGINE_DIR, 'workflows', 'research.yml'), inputs: { question: 'A question' } });
  const text = nodeBrief(run.state, 'research-foundation').stdout;
  const line = text.split('\n').find(each => each.startsWith('convention (every step): '));
  assert.ok(line, text);
  assert.match(line, /throwaway file .* goes in the directory `scratch-dir --for=<what it holds> --state=<state>` makes, inside the run and ignored by git; never the system temp directory or a literal `\/tmp` path/);
  assert.doesNotMatch(line, /mktemp|TMPDIR/);
});

test('node-brief: the asks line follows the driver — in session, in a question set, or the Without line nobody is asked', t => {
  const sample = sampleRun(t);
  write(sample, { orchestrator: { driver: { kind: 'cockpit', features: ['question-sets'] } } });
  assert.match(nodeBrief(sample.state, 'draft').stdout, new RegExp(`^asks \\(question sets\\): tone${esc(asksTail('When a question suspends'))}$`, 'm'));

  // Nobody can be asked: one line, pointing at the Without line the section carries, never a second copy of the default.
  write(sample, { orchestrator: { driver: { kind: 'dispatch' } } });
  const driven = nodeBrief(sample.state, 'draft').stdout;
  assert.match(driven, new RegExp(`^asks \\(nobody can be asked\\): tone — the Without line of each applies${esc(asksTail('When nobody can be asked'))}$`, 'm'));
  assert.doesNotMatch(driven, /not asked — default/);
  assert.match(driven, /^\*\*Without question sets\*\* \(`tone`\): a plain tone/m, 'the slice carries the default');

  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { driver: { kind: 'dispatch' } } });
  assert.match(nodeBrief(dev.state, 'specification').stdout,
    new RegExp(`^asks \\(nobody can be asked\\): technical-questions, user-story, specification-requirements — the Without line of each applies${esc(asksTail('When nobody can be asked'))}$`, 'm'));
});

test('node-brief: the revise row prints whole only while a recorded revise names the step', t => {
  const sample = sampleRun(t);
  write(sample, { nodes: { scope: { status: 'completed', values: { wants_audit: false, focus: 'narrow' } } } });
  write(sample, { nodes: { draft: { status: 'completed' } }, node_summaries: { draft: { summary: 'Drafted the notes.' } } });
  assert.ok(nodeBrief(sample.state, 'draft').stdout.split('\n').includes(LATER), 'before a revise, both rows are named');

  const revised = verb(['gate-revise', `--state=${sample.state}`, '--node=approval', '--option=revise-draft'], { note: 'Shorten the notes' });
  assert.equal(revised.code, 0, revised.stderr);
  const after = nodeBrief(sample.state, 'draft').stdout.split('\n');
  assert.ok(after.includes('attempt: 2 — pending'));
  for (const key of ['named by a revise', 'has a budget']) assert.ok(after.includes(row(key)), key);
  assert.ok(!after.some(line => /^convention \(.*\): see rules$/.test(line)), 'no row is left to name');
  // Another step of the run is not the one the revise names.
  assert.doesNotMatch(nodeBrief(sample.state, 'scope').stdout, /^convention \(named by a revise\): [^s]/m);
});

test('node-brief: every brief that prints stamps display/brief.json — a gate, a step not ready, a started one — each stamp after the last', t => {
  const sample = sampleRun(t);
  const file = path.join(sample.dir, 'display', 'brief.json');
  const seen = [];
  for (const [node, kind] of [['approval', 'gate'], ['audit', 'step'], ['approval', 'gate'], ['scope', 'step']]) {
    const result = nodeBrief(sample.state, node);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '', 'a stamp written is no warning');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual({ ...doc, printed: undefined }, { version: 1, node, title: doc.title, kind, printed: undefined });
    assert.equal(typeof doc.title, 'string');
    assert.match(doc.printed, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    seen.push(doc.printed);
  }
  for (let at = 1; at < seen.length; at += 1) assert.ok(seen[at] > seen[at - 1], `${seen[at]} after ${seen[at - 1]}`);
  // A refused brief leaves the stamp where it was.
  assert.equal(nodeBrief(sample.state, 'nope').code, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).printed, seen.at(-1));
});

test('node-brief: a gate points at gate-brief unless its section carries an exception', t => {
  const sample = sampleRun(t);
  const plain = nodeBrief(sample.state, 'approval');
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.stdout, [
    ...OPENING,
    '## Gate: approval — Approval',
    'closes: draft',
    'options: continue-to-audit (continue), continue-to-wrap-up (continue), revise-draft (revise → draft), stop-here (stop)',
    row('gate'),
    RULES,
    '',
    `ask it: gate-brief --state=${sample.state} --node=approval --json --picker=rich`,
    '',
  ].join('\n'));

  const excepted = nodeBrief(sample.state, 'audit-approval');
  assert.equal(excepted.code, 0, excepted.stderr);
  assert.equal(excepted.stdout, [
    ...OPENING,
    '## Gate: audit-approval — Audit approval',
    'when: ${approval.values.audit_enabled} — now not yet decidable',
    'closes: audit',
    'options: continue-to-wrap-up (continue), revise-draft (revise → draft), stop-here (stop)',
    row('gate'),
    RULES,
    '',
    `ask it: gate-brief --state=${sample.state} --node=audit-approval --json --picker=rich`,
    '',
    '**Exception.** Ask it even when the audit found nothing, so the operator sees the audit ran.',
    '',
  ].join('\n'));
});

test('node-brief: a section-less step runs from the conventions; an added step is sliced from its overlay\'s guide', t => {
  const sample = sampleRun(t, { overlays: [NODE_BRIEF_OVERLAY] });
  const wrap = nodeBrief(sample.state, 'wrap-up');
  assert.equal(wrap.code, 0, wrap.stderr);
  assert.ok(wrap.stdout.endsWith(`${RULES}\n\nsection: none — the conventions above apply\n`), wrap.stdout);

  const polish = nodeBrief(sample.state, 'polish');
  assert.equal(polish.code, 0, polish.stderr);
  assert.ok(polish.stdout.endsWith(`${RULES}\n\n**Does.** Polish the notes the draft wrote.\n`), polish.stdout);
  // The gate it was placed before now closes both.
  assert.match(nodeBrief(sample.state, 'approval').stdout, /^closes: draft, polish$/m);
  assert.match(polish.stdout, /^feeds: approval — continues: continue-to-audit, continue-to-wrap-up; revise: revise-draft → draft$/m);
});

// The ways on a drift warning names, whichever verb prints it.
const driftClause = run => ` — no verb re-freezes: put back ${readState(run).workflow.source} or start a new run; never revert a person's edit unasked`;

test('node-brief: graph drift and an unread definition warn and still print; unread conventions point at the rules', t => {
  // A copy of the fixture, frozen, then changed: the header follows the definition as it now reads.
  const drifted = scratch(t, { type: 'node-brief', name: '2026-01-05-drift' });
  for (const name of ['node-brief.yml', 'node-brief.md']) fs.copyFileSync(path.join(DEFINITIONS, name), path.join(drifted.root, name));
  const definition = path.join(drifted.root, 'node-brief.yml');
  freeze(drifted, { definition });
  fs.writeFileSync(definition, fs.readFileSync(definition, 'utf8').replace('notes: "${draft.artifacts.notes}"', 'notes: "${draft.artifacts.notes}"\n      strict: true'));
  const drift = nodeBrief(drifted.state, 'audit');
  assert.equal(drift.code, 0, drift.stderr);
  assert.match(drift.stderr, /^warning: node-brief-graph-drift: [^\n]+\n$/);
  assert.ok(drift.stderr.includes(driftClause(drifted) + '\n'), 'the warning ends with the no-re-freeze clause');
  assert.match(drift.stdout, /^- strict: true$/m);

  fs.rmSync(definition);
  const unread = nodeBrief(drifted.state, 'draft');
  assert.equal(unread.code, 0, unread.stderr);
  assert.equal(unread.stderr, `warning: node-brief-definition-unread: ${drifted.state}\n`);
  assert.match(unread.stdout, /^engine skill: .*\ncommands: .*\nplugin files: .*\n## Node: draft — Draft\nruns: direct — inline\nconvention \(`direct:` step\): /, 'unread, every row of its scheme prints whole');
  assert.ok(unread.stdout.endsWith(`${RULES}\n\nsection: unknown — the definition this run froze cannot be re-read\n`), unread.stdout);

  // A plugin whose skill has lost the conventions table: one line points at the rules instead.
  const engine = scratchPlugin(t);
  const skill = path.join(path.dirname(path.dirname(engine)), 'references/node-conventions.md');
  fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace('# Node conventions', '# Conventions elsewhere'));
  const sample = sampleRun(t);
  const blind = nodeBrief(sample.state, 'draft', engine);
  assert.equal(blind.code, 0, blind.stderr);
  assert.equal(blind.stderr, `warning: node-brief-conventions-unread: ${skill}\n`);
  assert.match(blind.stdout, /^convention: see rules$/m);
  assert.doesNotMatch(blind.stdout, /^convention \(/m);
});

test('node-brief: three refusals and the usage errors, none of which writes a file; the codes agree everywhere', t => {
  const sample = sampleRun(t);
  // gate-brief writes a panel under display/; the snapshot, display/ included, shows node-brief writes nothing.
  const before = snapshot(sample.root);

  const missing = verb(['node-brief', `--state=${path.join(sample.dir, 'absent.yml')}`, '--node=draft']);
  const other = sibling(sample, { type: 'development', name: '2026-01-06-other' });
  fs.writeFileSync(other.state, 'orchestrator:\n  started_phase: null\n');
  const notRun = nodeBrief(other.state, 'draft');
  const unknown = nodeBrief(sample.state, 'nope');
  const held = nodeBrief(sample.state, 'held-approval');
  for (const [result, code] of [[missing, REFUSALS[0]], [notRun, REFUSALS[1]], [unknown, REFUSALS[2]], [held, REFUSALS[2]]]) {
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith(`${code}: `), result.stderr);
  }

  for (const [args, message] of [
    [['node-brief', '--node=draft'], 'node-brief needs --state'],
    [['node-brief', `--state=${sample.state}`], 'node-brief needs --node'],
    [['node-brief', `--state=${sample.state}`, '--node=draft', '--json'], 'takes no --json flag'],
  ]) {
    const result = verb(args);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(message), result.stderr);
  }

  // A refusal writes nothing at all, the display's brief stamp included.
  const refused = snapshot(sample.root);
  delete refused[path.join('.maister', 'tasks', 'development', '2026-01-06-other', 'orchestrator-state.yml')];
  assert.deepEqual(refused, before);

  // None of these is a step ready to start, so briefing them writes nothing but the brief stamp.
  const stamp = path.join(path.relative(sample.root, sample.dir), 'display', 'brief.json');
  for (const node of ['draft', 'approval', 'audit', 'audit-approval', 'wrap-up']) {
    assert.equal(nodeBrief(sample.state, node).code, 0, node);
  }
  const after = snapshot(sample.root);
  delete after[path.join('.maister', 'tasks', 'development', '2026-01-06-other', 'orchestrator-state.yml')];
  assert.ok(Object.hasOwn(after, stamp), 'every brief that printed stamps display/brief.json');
  delete after[stamp];
  assert.deepEqual(after, before);
  // The one write a brief makes: the start of the step ready to run.
  assert.equal(nodeBrief(sample.state, 'scope').code, 0);
  assert.notDeepEqual(snapshot(sample.root), after, 'briefing the ready step records its start');
  assert.ok(Object.keys(before).some(file => file.includes(`${path.sep}display${path.sep}`)), 'the snapshot covers the run\'s display files');
  assert.ok(!fs.existsSync(path.join(sample.dir, 'display', 'next.json')), 'no gate panel is written');

  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/node-brief.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(node-brief-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
  const header = source.slice(0, source.indexOf('\nimport '));
  assert.doesNotMatch(header, /docs\//, 'the header cites no file under docs/');
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'references/verbs.md'), 'utf8');
  for (const code of [...REFUSALS, 'node-brief-graph-drift', 'node-brief-definition-unread', 'node-brief-conventions-unread', 'node-brief-start-unrecorded']) {
    assert.ok(header.includes(`\`${code}\``), `the module header does not list ${code}`);
  }
  for (const code of REFUSALS) {
    const tableRow = skill.split('\n').find(line => line.startsWith('|') && line.includes(`\`${code}\``));
    assert.ok(tableRow, `no refusal row names ${code}`);
    assert.ok(tableRow.length > 160, `the row for ${code} is too short to tell an operator what to do`);
  }
});

/** A scratch project holding copies of the node-brief sample, its guide passed through `guide`, and any extra files. */
function copiedSample(t, { guide = text => text, files = {} } = {}) {
  const sample = scratch(t);
  fs.copyFileSync(NODE_BRIEF, path.join(sample.root, 'node-brief.yml'));
  fs.writeFileSync(path.join(sample.root, 'node-brief.md'), guide(fs.readFileSync(path.join(DEFINITIONS, 'node-brief.md'), 'utf8')));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(sample.root, name), text);
  return sample;
}

test('node-brief: recommends compares the filled-in value as text, so a bool true finds "true"; an unmapped value leaves it to the section', t => {
  const overlay = 'extends: node-brief.yml\nbrief:\n  draft:\n    recommends:\n      deep:\n        "true": continue-to-audit\n';
  const sample = copiedSample(t, { files: { 'rec.overlay.yml': overlay } });
  freeze(sample, { definition: path.join(sample.root, 'node-brief.yml'), overlays: [path.join(sample.root, 'rec.overlay.yml')] });

  const unmapped = nodeBrief(sample.state, 'draft');
  assert.equal(unmapped.code, 0, unmapped.stderr);
  assert.match(unmapped.stdout, /^recommends: deep = false — the section decides$/m);
  assert.doesNotMatch(unmapped.stdout, /^recommends: audit_flag/m, 'the overlay\'s recommends replaces the base\'s');

  write(sample, { orchestrator: { options: { inputs: { deep: true } } } });
  const mapped = nodeBrief(sample.state, 'draft');
  assert.match(mapped.stdout, /^- deep: true$/m);
  assert.match(mapped.stdout, /^recommends: deep = true → continue-to-audit$/m);
});

test('node-brief: a brief: block that only a profile carries reaches the brief when that profile is frozen', t => {
  const overlay = 'extends: node-brief.yml\nprofiles:\n  lean:\n    brief:\n      draft:\n        budget: 5\n';
  const plain = copiedSample(t, { files: { 'lean.overlay.yml': overlay } });
  freeze(plain, { definition: path.join(plain.root, 'node-brief.yml'), overlays: [path.join(plain.root, 'lean.overlay.yml')] });
  assert.match(nodeBrief(plain.state, 'draft').stdout, /^budget: 2 attempts — a prose rule; nothing enforces it$/m);

  const lean = copiedSample(t, { files: { 'lean.overlay.yml': overlay } });
  freeze(lean, { definition: path.join(lean.root, 'node-brief.yml'), overlays: [path.join(lean.root, 'lean.overlay.yml')], profile: 'lean' });
  const result = nodeBrief(lean.state, 'draft');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^budget: 5 attempts — a prose rule; nothing enforces it$/m);
  assert.match(result.stdout, / — may be absent: Written only when the draft raises open questions\.$/m, 'the base\'s other brief: keys stay');
});

test('node-brief: a CRLF guide gives the same brief as its LF copy, see: line included, with no CR in it', t => {
  // Each copy is converted from whatever the checkout holds, CRLF on Windows included.
  const lf = copiedSample(t, { guide: text => text.replace(/\r\n/g, '\n') });
  const crlf = copiedSample(t, { guide: text => text.replace(/\r?\n/g, '\r\n') });
  for (const each of [lf, crlf]) freeze(each, { definition: path.join(each.root, 'node-brief.yml'), orchestrator: { options: { html_output: true } } });
  for (const node of ['scope', 'draft', 'audit-approval']) {
    const [a, b] = [nodeBrief(lf.state, node), nodeBrief(crlf.state, node)];
    assert.equal(b.code, 0, b.stderr);
    assert.ok(!b.stdout.includes('\r'), node);
    // The dashboard line names the root as a file URL too, which is not the path's own spelling on Windows.
    const mask = (text, root) => text.split(pathToFileURL(root).href).join('<root-url>').split(root).join('<root>');
    assert.equal(mask(b.stdout, crlf.root), mask(a.stdout, lf.root), node);
  }
  assert.match(nodeBrief(crlf.state, 'draft').stdout, /^see: .+ § Embedded mode$/m);
});

test('node-brief: a plain-picker passage at the end of a section is dropped there and never reaches the next node\'s slice', t => {
  const baseline = copiedSample(t);
  const edited = copiedSample(t, {
    guide: text => text
      // Unclosed when the section ends: dropped through the end of `scope`.
      .replace('## `draft-notes`', '<!-- plain-picker\nThe question lists each focus.\n\n## `draft-notes`')
      // Closed as the section's last lines: dropped with the blank line before it.
      .replace('## `approval`', '<!-- plain-picker\nA plain list of tones.\n-->\n\n## `approval`'),
  });
  for (const each of [baseline, edited]) freeze(each, { definition: path.join(each.root, 'node-brief.yml') });

  const scope = nodeBrief(edited.state, 'scope');
  assert.equal(scope.code, 0, scope.stderr);
  assert.ok(scope.stdout.endsWith(`${RULES}\n\n**Does.** Settle what the note covers and record \`wants_audit\` and \`focus\`.\n`), scope.stdout);
  assert.equal(maskRoot(nodeBrief(edited.state, 'draft').stdout, edited.root), maskRoot(nodeBrief(baseline.state, 'draft').stdout, baseline.root));
  assert.doesNotMatch(nodeBrief(edited.state, 'draft').stdout, /plain-picker|each focus|plain list of tones/);
});

test('node-brief: a recommended option prints only when it is a continue of a gate the step feeds', t => {
  const overlay = 'extends: node-brief.yml\nbrief:\n  draft:\n    recommends:\n      audit_flag:\n        "yes": revise-draft\n        "no": continue-to-wrap-up\n';
  const sample = copiedSample(t, { files: { 'odd.overlay.yml': overlay } });
  freeze(sample, { definition: path.join(sample.root, 'node-brief.yml'), overlays: [path.join(sample.root, 'odd.overlay.yml')] });

  write(sample, { orchestrator: { options: { inputs: { audit: 'yes' } } } });
  assert.doesNotMatch(nodeBrief(sample.state, 'draft').stdout, /^recommends:/m, 'a revise option is no continue: nothing is printed for it');
  write(sample, { orchestrator: { options: { inputs: { audit: 'no' } } } });
  assert.match(nodeBrief(sample.state, 'draft').stdout, /^recommends: audit_flag = no → continue-to-wrap-up$/m);
});

test('node-brief: a node drift removed says so in its own words, apart from an unread definition', t => {
  const sample = copiedSample(t);
  const definition = path.join(sample.root, 'node-brief.yml');
  freeze(sample, { definition });
  const text = fs.readFileSync(definition, 'utf8');
  fs.writeFileSync(definition, text.slice(0, text.indexOf('\n  wrap-up:\n') + 1));

  const gone = nodeBrief(sample.state, 'wrap-up');
  assert.equal(gone.code, 0, gone.stderr);
  assert.match(gone.stderr, /^warning: node-brief-node-gone: wrap-up is not in the definition as it reads now; /m);
  assert.doesNotMatch(gone.stderr, /node-brief-definition-unread/);
  assert.ok(gone.stdout.endsWith('\n\nsection: unknown — the node is not in the definition as it reads now\n'), gone.stdout);

  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/node-brief.mjs'), 'utf8');
  assert.ok(source.slice(0, source.indexOf('\nimport ')).includes('`node-brief-node-gone`'), 'the module header lists the warning');
});

test('node-brief: a heading is hashes then a space, and a fenced heading names no shared section', t => {
  const sample = copiedSample(t, {
    guide: text => text
      .replace('record `wants_audit` and `focus`.', 'record `wants_audit` and `focus`.\n\n#tag stays text, so the section goes on.\n\nScope is done.')
      .replace('As a child run, *Embedded mode* applies.', 'As a child run, *Embedded mode* applies; *Fenced only* is an example.')
      .replace('```\n## `not-a-heading`\n```', '```\n## `not-a-heading`\n## Fenced only\n```'),
  });
  freeze(sample, { definition: path.join(sample.root, 'node-brief.yml') });

  const scope = nodeBrief(sample.state, 'scope');
  assert.equal(scope.code, 0, scope.stderr);
  assert.ok(scope.stdout.endsWith('#tag stays text, so the section goes on.\n\nScope is done.\n'), scope.stdout);

  const draft = nodeBrief(sample.state, 'draft').stdout;
  assert.match(draft, /^see: .+ § Embedded mode$/m);
  assert.doesNotMatch(draft, /§ Fenced only/, 'a heading inside a fence is no shared section');
});

test('node-brief: a path holding a space is quoted on the rules line and in the gate-brief call', async t => {
  const { nodeBrief: render } = await import('../../plugins/maister/skills/workflow-engine/scripts/lib/node-brief.mjs');
  const sample = scratch(t, { name: '2026-01-05-a sample' });
  freeze(sample, { definition: NODE_BRIEF });
  const rules = path.join(sample.root, 'plugin dir', 'references', 'node-conventions.md');

  const gate = render({ state: sample.state, node: 'approval', rules: `${rules} § Node conventions` });
  assert.equal(gate.ok, true);
  assert.match(gate.text, new RegExp(`^rules: '${rules.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' § Node conventions$`, 'm'));
  assert.ok(gate.text.split('\n').includes(`ask it: gate-brief --state='${path.resolve(sample.state)}' --node=approval --json --picker=rich`), gate.text);

  // A path without one stays bare, as the built-in pointer prints.
  assert.match(nodeBrief(scratchRun(t).state, 'draft').stdout, new RegExp(`^${RULES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

/** A frozen run of the node-brief sample in a path without a space. */
function scratchRun(t) {
  const sample = scratch(t);
  freeze(sample, { definition: NODE_BRIEF });
  return sample;
}

test('node-brief: a dispatched node prints its dir: filled in, as its with: values are', t => {
  const overlay = 'extends: node-brief.yml\nadd:\n  remote:\n    uses: workflow:node-brief\n    dir: "members/${scope.values.focus}"\n    needs: [scope]\n    before: [draft]\n';
  const sample = copiedSample(t, { files: { 'dir.overlay.yml': overlay } });
  // A dir: node makes the graph a chain, which starts only under a driver that dispatches it.
  freeze(sample, { definition: path.join(sample.root, 'node-brief.yml'), overlays: [path.join(sample.root, 'dir.overlay.yml')], orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });

  assert.match(nodeBrief(sample.state, 'remote').stdout, /^runs: workflow:node-brief — dispatched to members\/\(not recorded yet\)$/m);
  write(sample, { nodes: { scope: { status: 'completed', values: { wants_audit: false, focus: 'narrow' } } } });
  assert.match(nodeBrief(sample.state, 'remote').stdout, /^runs: workflow:node-brief — dispatched to members\/narrow$/m);
});

test('node-brief: an agent step\'s runs line carries the model and effort the run froze, for the host the plugin ships for', t => {
  const dev = scratch(t);
  const config = path.join(dev.root, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, [
    'subagents:',
    '  agents:',
    '    gap-analyzer: { tier: standard }',
    '  workflows:',
    '    development:',
    '      nodes:',
    '        gap-analysis: { agents: { gap-analyzer: { tier: deep, effort: high } } }',
    '',
  ].join('\n'));
  const { patch } = freezePatch({ definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const frozen = verb(['write-state', `--state=${dev.state}`], patch, { CLAUDE_PROJECT_DIR: dev.root });
  assert.equal(frozen.code, 0, frozen.stderr);

  const runsOf = result => result.stdout.split('\n').find(line => line.startsWith('runs:'));
  const claude = nodeBrief(dev.state, 'gap-analysis');
  assert.equal(claude.code, 0, claude.stderr);
  assert.equal(runsOf(claude), 'runs: agent:gap-analyzer — Task tool as maister:gap-analyzer, model opus, effort high (source: project workflows.development.nodes.gap-analysis.agents.gap-analyzer, tier deep)');

  // The Copilot build is made at test time, so the same run's brief names Copilot's model id.
  const copilot = run(path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs'), ['node-brief', `--state=${dev.state}`, '--node=gap-analysis']);
  assert.equal(copilot.code, 0, copilot.stderr);
  assert.equal(runsOf(copilot), 'runs: agent:gap-analyzer — Task tool as maister:gap-analyzer, model claude-opus-5.5, effort high (source: project workflows.development.nodes.gap-analysis.agents.gap-analyzer, tier deep)');

  // A direct or skill step's runs line is as it was.
  assert.equal(runsOf(nodeBrief(dev.state, 'finalization')), 'runs: direct:finalization — inline');
});

test('node-brief: asked in session on Copilot, a step that asks names the question-set command with the run\'s real paths', t => {
  // The run is frozen through the Copilot build, so its delegation records the Copilot host.
  const dev = scratch(t);
  const copilotEngine = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const frozen = run(copilotEngine, ['write-state', `--state=${dev.state}`], freezePatch({ definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } }).patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  // A run frozen on Claude Code, for the brief Claude Code prints.
  const claudeRun = scratch(t, { name: '2026-01-05-claude' });
  freeze(claudeRun, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const patch = path.join(dev.dir, '.state-patch.json');
  const askWith = node => 'ask with: write each question set to ' + patch + ' as the in-node questions reference shapes it, then run node '
    + copilotEngine + ' gate-brief --state=' + path.resolve(dev.state) + ' --node=' + node + ' --ask --patch-file=' + patch
    + ' and pass its output to the question tool unchanged — never compose the form yourself';

  for (const node of ['gap-analysis', 'verification-options']) {
    const lines = nodeBrief(dev.state, node, copilotEngine).stdout.split('\n');
    const at = lines.findIndex(line => line.startsWith('asks (in session): '));
    assert.ok(at > 0, node);
    assert.equal(lines[at + 1], askWith(node), `${node}: the line follows the asks line`);
    // Claude Code's picker is composed in the session: its brief names no command.
    assert.ok(!nodeBrief(claudeRun.state, node).stdout.includes('ask with:'), `${node}: no line on Claude Code`);
  }
  // A step that asks nothing gets no line.
  for (const node of ['implementation', 'finalization']) assert.ok(!nodeBrief(dev.state, node, copilotEngine).stdout.includes('ask with:'), node);

  // Nobody can be asked, or a cockpit asks the sets: no command to run in session.
  write(dev, { orchestrator: { driver: { kind: 'dispatch' } } });
  assert.ok(!nodeBrief(dev.state, 'gap-analysis', copilotEngine).stdout.includes('ask with:'));
  write(dev, { orchestrator: { driver: { kind: 'cockpit', features: ['question-sets'] } } });
  assert.ok(!nodeBrief(dev.state, 'gap-analysis', copilotEngine).stdout.includes('ask with:'));
});

test('node-brief: the closing patch skeleton names the exact keys, and no gate or child run gets one', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const lines = id => nodeBrief(dev.state, id).stdout.split('\n');
  const skeleton = lines('gap-analysis').find(line => line.startsWith('closing patch'));
  const json = JSON.parse(skeleton.slice(skeleton.indexOf('{')).replace(/true\|false/g, 'true'));
  assert.deepEqual(Object.keys(json), ['nodes', 'node_summaries'], 'nodes and summaries at the top level, never workflow');
  assert.deepEqual(Object.keys(json.nodes['gap-analysis']), ['status', 'values']);
  assert.deepEqual(Object.keys(json.node_summaries['gap-analysis']), ['headline', 'summary', 'decisions', 'risks']);
  assert.ok(!lines('gap-approval').some(line => line.startsWith('closing patch')), 'a gate is closed from gate-brief');
  const sample = scratch(t);
  freeze(sample);
  const child = nodeBrief(sample.state, 'research');
  assert.equal(child.code, 0, child.stderr);
  assert.doesNotMatch(child.stdout, /^closing patch/m, 'a child run\'s outcome is mapped, not written from a skeleton');
});

test('node-brief: the last step\'s closing patch carries task.status completed only when nothing else is owed', t => {
  const TASK = ', "task": {"status": "completed"}}';
  const patchOf = (run, node) => {
    const result = nodeBrief(run.state, node);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split('\n').find(line => line.startsWith('closing patch'));
  };
  // Every other node ended, the run owes no close-out and holds no choice: the patch closes the run.
  const last = sampleRun(t);
  reach(last, { nodes: { 'audit-approval': { status: 'completed' } } });
  assert.ok(patchOf(last, 'wrap-up').endsWith(`]}}${TASK}`), patchOf(last, 'wrap-up'));
  // A step with a node still to run after it, and a dispatched run, close nothing.
  const early = sampleRun(t);
  assert.ok(!patchOf(early, 'scope').includes('"task"'));
  const dispatched = sampleRun(t);
  reach(dispatched, { nodes: { 'audit-approval': { status: 'completed' } }, orchestrator: { driver: { kind: 'dispatch' } } });
  assert.ok(!patchOf(dispatched, 'wrap-up').includes('"task"'));
});

test('node-brief: a step that owes a page names the companion writer\'s call with its model and effort, and the lines its prompt carries; with pages off it names none', t => {
  // The call line and the lines under it: the style guide once, then each owed page's markdown.
  const companionOf = result => {
    const lines = result.stdout.split('\n');
    const at = lines.findIndex(line => line.startsWith('companion writer:'));
    if (at < 0) return [];
    const block = [lines[at]];
    for (const line of lines.slice(at + 1)) {
      if (!/^- (html|md_path): /.test(line)) break;
      block.push(line);
    }
    return block;
  };
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { options: { html_output: true } } });
  const pages = { specification: 'implementation/spec.md', planning: 'implementation/implementation-plan.md', verification: 'verification/implementation-verification.md' };
  for (const [node, md] of Object.entries(pages)) {
    const brief = nodeBrief(dev.state, node);
    assert.equal(brief.code, 0, brief.stderr);
    assert.deepEqual(companionOf(brief), [COMPANION_WRITER, `- html: ${STYLE_GUIDE}`, `- md_path: ${path.join(dev.dir, md)}`], node);
    // The line follows the writes it is for.
    const lines = brief.stdout.split('\n');
    const writes = lines.slice(lines.indexOf('writes:') + 1, lines.indexOf(COMPANION_WRITER));
    assert.ok(writes.length && writes.every(line => line.startsWith('- ')), node);
    assert.ok(writes.some(line => line.includes('HTML page owed:')), node);
    // The style guide is the one the run context hands a delegate of the same step.
    const context = verb(['run-context', `--state=${dev.state}`, `--node=${node}`]);
    assert.equal(context.code, 0, context.stderr);
    assert.ok(context.stdout.split('\n').includes(`html: ${STYLE_GUIDE}`), node);
  }
  // A step that owes no page, and a gate, print none.
  for (const node of ['gap-analysis', 'specification-approval']) assert.deepEqual(companionOf(nodeBrief(dev.state, node)), [], node);

  // The Copilot build keeps the agent's name, names Copilot's model id and its own style guide.
  const copilot = run(path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs'), ['node-brief', `--state=${dev.state}`, '--node=specification']);
  assert.equal(copilot.code, 0, copilot.stderr);
  assert.deepEqual(companionOf(copilot), [
    COMPANION_WRITER
      .replace('model haiku', 'model claude-haiku-5.5'),
    `- html: ${path.join(variantRoot(), 'skills/orchestrator-framework/references/html-report-style.md')}`,
    `- md_path: ${path.join(dev.dir, pages.specification)}`,
  ]);

  const off = scratch(t);
  freeze(off, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { options: { html_output: false } } });
  for (const node of ['specification', 'planning']) assert.deepEqual(companionOf(nodeBrief(off.state, node)), [], node);
});

test('node-brief: a session is shown each convention row whole once, and again after a resume or a compaction', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const as = session => node => verb(['node-brief', `--state=${dev.state}`, `--node=${node}`], undefined, session ? { CLAUDE_CODE_SESSION_ID: session } : {});
  const header = result => {
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.slice(0, result.stdout.indexOf('\n\n')).split('\n');
  };
  const STEP_ROWS = ['`agent:` step', 'every step', 'asks', 'feeds a checkpoint'];
  const whole = (lines, keys) => keys.every(key => lines.includes(row(key)));
  const named = (lines, keys) => lines.includes(`conventions in force (${keys.join(', ')}): printed whole by an earlier brief of this session; follow them as printed there, or print them from rules with reference`);
  const one = as('session-one');

  // The session's first brief prints every row whole; the next names them on one line.
  assert.ok(whole(header(one('gap-analysis')), STEP_ROWS), 'the first brief prints the rows whole');
  const second = header(one('gap-analysis'));
  assert.ok(named(second, STEP_ROWS), second.join('\n'));
  assert.ok(!second.some(line => line.startsWith('convention (`agent:` step): ')), 'no row printed twice in a session');
  assert.ok(second.includes(LATER), 'a row that applies only later stays named as before');
  assert.ok(second.includes(RULES), 'the rules pointer stays');

  // A row this session has not met yet is printed whole beside the ones it has.
  const gate = header(one('gap-approval'));
  assert.ok(gate.includes(row('gate')), 'the first gate prints its row whole');
  assert.ok(named(header(one('gap-approval')), ['gate']), 'the next gate names it');
  const planning = header(one('planning'));
  assert.ok(named(planning, ['`agent:` step', 'every step', 'feeds a checkpoint']), 'another node names the rows the session was shown');

  // Another session has seen nothing; with no session id every brief is whole.
  assert.ok(whole(header(as('session-two')('gap-analysis')), STEP_ROWS), 'another session gets the rows whole');
  for (let i = 0; i < 2; i += 1) assert.ok(whole(header(as(null)('gap-analysis')), STEP_ROWS), 'no session id: whole every time');

  // A resume clears what the session was shown.
  assert.ok(named(header(one('gap-analysis')), STEP_ROWS));
  const resumed = verb(['resume-check', `--state=${dev.state}`, '--no-open'], undefined, { CLAUDE_CODE_SESSION_ID: 'session-one' });
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.ok(whole(header(one('gap-analysis')), STEP_ROWS), 'the first brief after a resume prints the rows whole');
  assert.ok(named(header(one('gap-analysis')), STEP_ROWS));

  // So does a compaction: the post-compaction hook removes the session's marker.
  const marker = path.join(dev.root, '.maister/display/sessions/session-one.conventions');
  assert.ok(fs.existsSync(marker), 'the marker sits beside the session pointer');
  const compacted = run(path.join(ROOT, 'plugins/maister/hooks/post-compact-reminder.mjs'), [], { source: 'compact', session_id: 'session-one', cwd: dev.root });
  assert.equal(compacted.code, 0, compacted.stderr);
  assert.match(compacted.stdout, /Post-Compaction/, 'the reminder still prints');
  assert.ok(!fs.existsSync(marker), 'the hook removed the marker');
  assert.ok(whole(header(one('gap-analysis')), STEP_ROWS), 'the first brief after a compaction prints the rows whole');
  assert.ok(fs.existsSync(path.join(dev.root, '.maister/display/.gitignore')), 'the marker is ignored by git with the other display files');
});

// ---------------------------------------------------------------------------
// the lines that carry a rule the engine skill held
// ---------------------------------------------------------------------------

/** The plugin copy whose policy classes the in-node questions fixture, so a choice can be held. */
const CLASSING = sharedPlugin({ policy: JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy', 'questions.json'), 'utf8')) });
const IN_NODE = path.join(DEFINITIONS, 'in-node-questions.yml');

/** A run of the in-node questions fixture through the classing copy, `scoping` closed with one choice held. */
function heldRun(t, driver) {
  const engine = CLASSING.engine;
  const sample = scratch(t);
  const send = patch => {
    const result = run(engine, ['write-state', `--state=${sample.state}`], patch);
    assert.equal(result.code, 0, result.stderr);
  };
  send(freezePatch({ definition: IN_NODE, orchestrator: { options: { ceiling: 'advice' }, ...(driver ? { driver } : {}) } }).patch);
  send({ nodes: { scoping: { status: 'running' } } });
  const question = id => ({ id, question: `Which ${id}?`, options: [{ id: 'a', label: `${id} A`, description: 'A is the safe pick.', recommended: true }, { id: 'b', label: `${id} B` }] });
  send({ node_summaries: { scoping: { question_set: { questions: ['quick-choice', 'signed-choice'].map(question) } } } });
  send({ nodes: { scoping: { status: 'completed', values: { wants_review: true, wants_notes: false } } }, node_summaries: { scoping: { summary: 'Scoped the work.' } } });
  return { sample, engine, skill: path.dirname(path.dirname(engine)) };
}

test('node-brief: every brief, step and gate alike, opens on the engine skill to read now and the command form, and the variant names its own', t => {
  const sample = sampleRun(t, { overlays: [NODE_BRIEF_OVERLAY] });
  for (const node of ['scope', 'draft', 'polish', 'approval', 'audit-approval', 'wrap-up']) {
    const lines = nodeBrief(sample.state, node).stdout.split('\n');
    assert.deepEqual(lines.slice(0, 3), OPENING, `${node}: the brief opens on the three lines`);
    assert.equal(lines.filter(line => line.startsWith('engine skill: ')).length, 1, `${node}: one line`);
    assert.ok(lines.includes(RULES), `${node}: the rules line stays`);
  }
  assert.ok(fs.existsSync(path.join(ENGINE_DIR, 'scripts', 'workflow.mjs')), 'the line names a script that exists');
  assert.doesNotMatch(ENGINE_SKILL, /invoke|\bif\b|read tool/, 'the line says print now, never invoke the skill again or open it, and states no condition to judge');
  const printed = run(path.join(ENGINE_DIR, 'scripts', 'workflow.mjs'), ['reference', '--at=SKILL.md']);
  assert.equal(printed.code, 0, printed.stderr);
  assert.ok(printed.stdout.includes('## Before anything else'), 'the command prints the skill');
  assert.match(COMMANDS, /no cd, chain or pipe/);
  assert.match(COMMANDS, /here-string/);
  // After a compaction a session read plugin files with the file tool or sed and sent a patch as /dev/stdin.
  assert.match(FILES, /only with reference, never the file tool, sed or cat/);
  assert.match(FILES, /\.state-patch\.json beside the state file, never \/dev\/stdin/);
  assert.ok(FILES.length <= 160, `the line stays short: ${FILES.length} characters`);

  // The Copilot variant's brief names the variant's own skill, from its own location.
  const variant = path.join(variantRoot(), 'skills/workflow-engine');
  const copilot = nodeBrief(sample.state, 'approval', path.join(variant, 'scripts/workflow.mjs')).stdout.split('\n');
  assert.ok(copilot.includes(engineSkill(variant)), copilot.join('\n'));
  assert.ok(fs.existsSync(path.join(variant, 'SKILL.md')));
});

test('node-brief: start: yours prints for a ready step whose start the brief does not record, never for one not ready or dispatched', t => {
  // The start of a workflow: step, its child's freeze and the link are one subrun-handoff call.
  const START = (node, state) => `start: yours — run node ${ENGINE} subrun-handoff --state=${state} --node=${node}`;
  const STARTED = 'started: recorded running by this brief — the start needs no write of its own';
  const has = (text, prefix) => text.split('\n').some(line => line.startsWith(prefix));

  // A workflow: step: its start brackets its child's freeze, so a ready one is told the call that makes it.
  const child = scratch(t);
  freeze(child);
  assert.ok(!has(nodeBrief(child.state, 'research').stdout, 'start: '), 'needs unmet: no start line');
  reach(child, { nodes: { implementation: { status: 'completed' } } });
  const ready = fromHeader(nodeBrief(child.state, 'research').stdout);
  assert.equal(ready[2], START('research', path.resolve(child.state)));
  assert.ok(!ready.includes(STARTED), 'never beside started:');

  // A step whose start the brief records prints started:, never start: yours.
  const sample = sampleRun(t);
  const scope = fromHeader(nodeBrief(sample.state, 'scope').stdout);
  assert.equal(scope[2], STARTED);
  assert.ok(!scope.some(line => line.startsWith('start: yours')));

  // Needs settled and pending, but a false guard: nothing to start, nothing written.
  write(sample, { nodes: { scope: { status: 'completed', values: { wants_audit: false, focus: 'narrow' } } } });
  write(sample, { nodes: { draft: { status: 'completed' } }, node_summaries: { draft: { summary: 'Drafted the notes.' } } });
  write(sample, { nodes: { approval: { status: 'completed' } }, node_summaries: { approval: { decisions: [{ option: 'continue-to-wrap-up' }] } } });
  const audit = nodeBrief(sample.state, 'audit');
  assert.equal(audit.code, 0, audit.stderr);
  assert.match(audit.stdout, /^when: .* — now false$/m);
  assert.ok(!has(audit.stdout, 'start: ') && !has(audit.stdout, 'started: '), audit.stdout);

  // A dispatched node never gets one, its needs settled or not.
  const overlay = 'extends: node-brief.yml\nadd:\n  remote:\n    uses: workflow:node-brief\n    dir: "members/${scope.values.focus}"\n    needs: [scope]\n    before: [draft]\n';
  const remote = copiedSample(t, { files: { 'dir.overlay.yml': overlay } });
  freeze(remote, { definition: path.join(remote.root, 'node-brief.yml'), overlays: [path.join(remote.root, 'dir.overlay.yml')], orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(remote, { nodes: { scope: { status: 'completed', values: { wants_audit: false, focus: 'narrow' } } } });
  assert.ok(!has(nodeBrief(remote.state, 'remote').stdout, 'start: '));
});

test('node-brief: a start the writer refuses prints the refusal and its rules line, never start: yours to send the same write', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'permissions do not stop this user from writing' : false }, t => {
  const sample = sampleRun(t);
  fs.chmodSync(sample.state, 0o444);
  fs.chmodSync(sample.dir, 0o555);
  let result;
  try {
    result = nodeBrief(sample.state, 'scope');
  } finally {
    // Before the scratch folder's own clean-up, which runs first among the after hooks.
    fs.chmodSync(sample.dir, 0o755);
    fs.chmodSync(sample.state, 0o644);
  }
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /^warning: node-brief-start-unrecorded: state-unwritable$/m);
  const lines = fromHeader(result.stdout);
  assert.match(lines[2], /^start: refused — state-unwritable: .*orchestrator-state\.yml could not be written: /, lines.join('\n'));
  assert.equal(lines[3], `rules: ${path.join(ENGINE_DIR, 'references/writing-state.md')} § When a write is refused § state-unwritable`);
  assert.ok(!lines.some(line => line.startsWith('start: yours') || line.startsWith('started: ')), lines.join('\n'));
});

test('node-brief: a run\'s first brief repeats the start banner as a say: step, once, and no other brief does', t => {
  const SAY = 'say: the run\'s start, a visible message of its own before this node\'s work, unless your last message showed these lines — each copied as printed:';
  const sample = sampleRun(t);
  const banner = JSON.parse(fs.readFileSync(path.join(sample.dir, 'display', 'banner.json'), 'utf8')).lines;
  assert.equal(banner[0], 'Maister run started: Node brief');

  // Any other node of the fresh run: no banner.
  assert.doesNotMatch(nodeBrief(sample.state, 'draft').stdout, /^say: the run's start/m, 'only the first node repeats it');

  const first = nodeBrief(sample.state, 'scope');
  assert.equal(first.code, 0, first.stderr);
  const lines = first.stdout.split('\n');
  const at = lines.indexOf(SAY);
  assert.ok(at >= 0, first.stdout);
  assert.deepEqual(lines.slice(at + 1, at + 1 + banner.length), banner, 'the banner lines follow, exactly as the freeze printed them');
  assert.ok(at + banner.length < lines.findIndex(line => line.startsWith('## ')), 'before the node\'s header');

  // The brief recorded the start, so the next one is past the run's start.
  assert.doesNotMatch(nodeBrief(sample.state, 'scope').stdout, /^say: the run's start/m, 'printed once');
});

test('node-brief: a waiting node says it is not run again; an agent step and a step with delegates carry the line to say', t => {
  const child = scratch(t);
  freeze(child);
  reach(child, { nodes: { implementation: { status: 'completed' } } });
  const before = fs.readFileSync(child.state, 'utf8');
  const waiting = before.replace(/(    research: \{kind: [a-z]+, )status: pending/, '$1status: waiting');
  assert.notEqual(waiting, before, 'the node line carries the status');
  fs.writeFileSync(child.state, waiting);
  const lines = nodeBrief(child.state, 'research').stdout.split('\n');
  assert.ok(lines.includes('attempt: 1 — waiting'), lines.join('\n'));
  assert.equal(lines[lines.indexOf('attempt: 1 — waiting') + 1], 'waiting: its child run or dispatch has not ended — do not run it again');
  assert.ok(!lines.some(line => line.startsWith('start: ')), 'a waiting node is not ready');
  assert.ok(!lines.some(line => line.startsWith('say: ')), 'a child run is no delegate');

  // A step run inline, with no delegate, says nothing of the kind.
  // (The run's first brief carries the start banner's say: line, which is no delegate's.)
  assert.ok(!nodeBrief(scratchRun(t).state, 'scope').stdout.includes('\nsay: "'));
});

test('node-brief: a gate a held choice asks says how many wait, and the closing node of a dispatched or classing run names its close-out', t => {
  const dispatched = heldRun(t, { kind: 'dispatch', cwd: '/work' });
  const brief = node => run(dispatched.engine, ['node-brief', `--state=${dispatched.sample.state}`, `--node=${node}`]);
  const HELD = 'held: 1 choice waits for approval — asked whatever its guard reads; its continue approves it';
  const review = brief('review-approval');
  assert.equal(review.code, 0, review.stderr);
  assert.ok(review.stdout.split('\n').includes(HELD), review.stdout);
  // Under a driver that suspends, the gate is asked through its request.
  assert.ok(review.stdout.split('\n').includes(`ask it: gate-request --state=${dispatched.sample.state} --node=review-approval`), review.stdout);
  // A gate guarded only by an input is still skipped by its guard: no held line.
  assert.ok(!brief('depth-approval').stdout.includes('\nheld: '));

  const gates = path.join(dispatched.skill, 'references/gates.md');
  const closeOut = text => text.split('\n').filter(line => line.startsWith('close-out: '));
  assert.deepEqual(closeOut(brief('finish').stdout), [
    `close-out: gate-brief --node=held-approval first, then publish through the outbox verb before recording this step's outcome — rules: ${gates} § Ending a dispatched run`,
  ]);
  assert.deepEqual(closeOut(brief('drafting').stdout), [], 'only the closing node');
  const headings = fs.readFileSync(gates, 'utf8').split(/\r?\n/).filter(line => line.startsWith('## '));
  for (const heading of ['## Ending a dispatched run', '## The closing checkpoint `held-approval`']) assert.ok(headings.includes(heading), heading);

  // A classing run asked in session: held-approval first, and no outbox.
  const terminal = heldRun(t, null);
  const finish = run(terminal.engine, ['node-brief', `--state=${terminal.sample.state}`, '--node=finish']);
  assert.deepEqual(closeOut(finish.stdout), [
    `close-out: gate-brief --node=held-approval first, before recording this step's outcome — rules: ${path.join(terminal.skill, 'references/gates.md')} § The closing checkpoint \`held-approval\``,
  ]);

  // A dispatched run that classes nothing: the outbox alone; a terminal one that classes nothing: no line at all.
  const sample = sampleRun(t);
  assert.deepEqual(closeOut(nodeBrief(sample.state, 'wrap-up').stdout), []);
  assert.ok(!nodeBrief(sample.state, 'approval').stdout.includes('\nheld: '), 'nothing held, no held line');
  write(sample, { orchestrator: { driver: { kind: 'dispatch' } } });
  assert.deepEqual(closeOut(nodeBrief(sample.state, 'wrap-up').stdout), [
    `close-out: publish through the outbox verb before recording this step's outcome — rules: ${path.join(ENGINE_DIR, 'references/gates.md')} § Ending a dispatched run`,
  ]);
  assert.deepEqual(closeOut(nodeBrief(sample.state, 'draft').stdout), []);
});

test('node-brief: the ask it line is the whole call — the rich profile on Claude Code, the question tool\'s arguments on Copilot, the request under a driver', t => {
  const sample = sampleRun(t);
  const askIt = (text) => text.split('\n').find(line => line.startsWith('ask it: '));
  assert.equal(askIt(nodeBrief(sample.state, 'approval').stdout), `ask it: gate-brief --state=${sample.state} --node=approval --json --picker=rich`);
  const variant = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  assert.equal(askIt(nodeBrief(sample.state, 'approval', variant).stdout), `ask it: gate-brief --state=${sample.state} --node=approval --ask`);
  for (const driver of [{ kind: 'cockpit', features: ['question-sets'] }, { kind: 'dispatch' }]) {
    write(sample, { orchestrator: { driver } });
    for (const engine of [null, variant]) {
      assert.equal(askIt(nodeBrief(sample.state, 'approval', engine).stdout), `ask it: gate-request --state=${sample.state} --node=approval`, driver.kind);
    }
  }
});

// A gate its guard skips asks nothing: the brief names the skip write in place of
// the `ask it:` line, on both builds and under every driver, and a gate whose
// guard is true keeps its call word for word.

function skipGuardRun(t, findings) {
  const guarded = scratch(t);
  freeze(guarded, { definition: path.join(DEFINITIONS, 'skip-guard.yml') });
  write(guarded, {
    nodes: { review: { status: 'completed', values: { findings_to_review: findings } } },
    node_summaries: { review: { summary: 'Reviewed the work.' } },
  });
  return guarded;
}

test('node-brief: a gate its guard skips prints the skip line, never an ask it line, on both builds', t => {
  const guarded = skipGuardRun(t, true);
  const variant = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const skipLine = 'skip it: its guard !${review.values.findings_to_review} reads false, so it is not asked — record it skipped through write-state --next: {"nodes":{"confirmation":{"status":"skipped"}}}';
  for (const engine of [null, variant]) {
    const lines = nodeBrief(guarded.state, 'confirmation', engine).stdout.split('\n');
    assert.ok(lines.includes(skipLine), lines.join('\n'));
    assert.ok(!lines.some(line => line.startsWith('ask it: ')), 'no ask it line');
  }
  assert.equal(fs.existsSync(path.join(guarded.dir, '.ask.json')), false);
});

test('node-brief: a driven gate whose guard is true keeps its gate-request line', t => {
  const guarded = skipGuardRun(t, false);
  for (const driver of [{ kind: 'cockpit', features: ['question-sets'] }, { kind: 'dispatch' }]) {
    write(guarded, { orchestrator: { driver } });
    const lines = nodeBrief(guarded.state, 'confirmation').stdout.split('\n');
    assert.ok(lines.includes(`ask it: gate-request --state=${guarded.state} --node=confirmation`), driver.kind);
    assert.ok(!lines.some(line => line.startsWith('skip it: ')), driver.kind);
  }
});

// The config continue as a function of its own, which the closing walk runs
// once per gate: `{lines}` (the decided: and say: lines only) when it recorded
// the continue, `{say}` when the gate's brief advises against it, `{refused}`
// when its write was refused and `{}` when the config does not continue the
// gate. node-brief alone still attempts it and prints the inner next: line.

const CONFIG_WORKFLOW = path.join(DEFINITIONS, 'config-workflow.yml');
const CONTINUES = 'workflows:\n  config-workflow:\n    auto_continue: [plan-approval]\n';
const CONTINUE_TREES = [['source', () => path.join(ROOT, 'plugins', 'maister')], ['variant', () => variantRoot()]];

/** A run of the config workflow, the project's `config` beside it, its plan completed with `summary` in its summary. */
function plannedRun(t, { config = CONTINUES, summary = {} } = {}) {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  fs.mkdirSync(path.join(run.root, '.maister'), { recursive: true });
  fs.writeFileSync(path.join(run.root, '.maister', 'config.yml'), config);
  freeze(run, { definition: CONFIG_WORKFLOW, orchestrator: { options: { inputs: { publish: false }, html_output: false } } });
  walkTo(run, ['plan']);
  write(run, { nodes: { plan: { status: 'completed' } }, node_summaries: { plan: { summary: 'Planned.', ...summary } } });
  return run;
}

/** The config continue one tree exports. */
async function configContinueOf(tree) {
  return (await import(pathToFileURL(path.join(tree, 'skills', 'workflow-engine', 'scripts', 'lib', 'node-brief.mjs')).href)).configContinue;
}

const CONFIG_DECIDED = "decided: plan-approval — continue-to-build, by the project's config (workflows.config-workflow.auto_continue); nothing to ask, nothing to write";
const CONFIG_SAY = "say: Implementation plan approved by the project's config";

for (const [name, treeOf] of CONTINUE_TREES) {
  test(`node-brief (${name}): the exported configContinue returns {lines}, {say} or {}, and node-brief alone keeps the inner next: line`, async t => {
    const configContinue = await configContinueOf(treeOf());
    const engine = path.join(treeOf(), 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');

    const continued = plannedRun(t);
    assert.deepEqual(configContinue({ state: continued.state, node: 'plan-approval' }), { lines: [CONFIG_DECIDED, CONFIG_SAY] });
    assert.equal(readState(continued).workflow.nodes['plan-approval'].status, 'completed');
    assert.equal(readState(continued).node_summaries['plan-approval'].decisions[0].by, 'config');

    const advised = plannedRun(t, { summary: { recommends: { option: 'revise-plan', reason: 'The plan misses the migration.' } } });
    assert.deepEqual(configContinue({ state: advised.state, node: 'plan-approval' }),
      { say: "say: The project's config would continue, but plan recommends revising; the gate is asked as usual." });
    assert.equal(readState(advised).workflow.nodes['plan-approval'].status, 'pending');

    const unlisted = plannedRun(t, { config: 'html_output: false\n' });
    assert.deepEqual(configContinue({ state: unlisted.state, node: 'plan-approval' }), {});
    assert.deepEqual(configContinue({ state: unlisted.state, node: 'plan' }), {}, 'a step is never continued');
    assert.equal(readState(unlisted).workflow.nodes['plan-approval'].status, 'pending');

    // node-brief, with nothing handed in, attempts the continue itself and prints the node due next.
    const briefed = plannedRun(t);
    const result = nodeBrief(briefed.state, 'plan-approval', engine);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.endsWith(`\n${CONFIG_DECIDED}\n${CONFIG_SAY}\nnext: plan-approval-publish (Approve implementation plan and publish) — run node-brief for it\n`), result.stdout);
    assert.equal(result.stderr, '');
  });

  test(`node-brief (${name}): the exported configContinue returns {refused} when its write is refused, and node-brief warns once and asks`, { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'permissions do not stop this user from writing' : false }, async t => {
    const configContinue = await configContinueOf(treeOf());
    const engine = path.join(treeOf(), 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');
    const readOnly = (run, action) => {
      fs.chmodSync(run.state, 0o444);
      fs.chmodSync(run.dir, 0o555);
      try {
        return action();
      } finally {
        fs.chmodSync(run.dir, 0o755);
        fs.chmodSync(run.state, 0o644);
      }
    };
    const refused = plannedRun(t);
    assert.deepEqual(readOnly(refused, () => configContinue({ state: refused.state, node: 'plan-approval' })), { refused: 'state-unwritable' });

    const briefed = plannedRun(t);
    const result = readOnly(briefed, () => nodeBrief(briefed.state, 'plan-approval', engine));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.stderr.split('\n').filter(line => line.includes('config-continue')),
      ['warning: node-brief-config-continue-refused: state-unwritable; the gate is asked as usual']);
    // The gate is due, so it is asked from the question its brief prints last.
    assert.match(result.stdout, /^question: printed last, below/m);
    assert.equal(readState(briefed).workflow.nodes['plan-approval'].status, 'pending');
  });
}

// A due gate asked in session prints its question last: the `question:`,
// `ask again:` and `details:` lines stand where `ask it:` stood, any exception
// text follows them, then a blank line and the question — the `rich` profile's
// JSON without `more_details` on Claude Code, the `gate-brief --ask` call on
// Copilot, which is also written to `.ask.json` with the note before it retired.
// The panel is published on both. A gate not yet due, a driven gate and a gate
// under drift keep the `ask it:` line; a question that cannot be built keeps it
// too, with one warning.

const FOLD_TREES = [['source', 'claude', () => path.join(ROOT, 'plugins', 'maister')], ['variant', 'copilot', () => variantRoot()]];
const engineOf = tree => path.join(tree, 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');
const QUESTION_LINE = 'question: printed last, below — ask it with the question tool exactly as printed, never rebuilt';
const UNBUILT = 'warning: node-brief-question-unbuilt: gate-brief-value-missing: the question could not be built; ask it with the ask it line';

/** The three lines a folded gate prints in place of its `ask it:` line. */
function foldedLines(state, node, host) {
  const target = `--state=${state} --node=${node}`;
  return [QUESTION_LINE, `ask again: gate-brief ${target} ${host === 'copilot' ? '--ask' : '--json --picker=rich'}`, `details: gate-brief ${target} --details`];
}

/** The brief's last block: everything after its last blank line. */
const lastBlock = text => text.slice(text.lastIndexOf('\n\n') + 2);

/** The question a host's tool takes, as the gate-brief verb prints it for the folded brief to match. */
function verbQuestion(engine, state, node, host) {
  if (host === 'copilot') {
    const asked = run(engine, ['gate-brief', `--state=${state}`, `--node=${node}`, '--ask']);
    assert.equal(asked.code, 0, asked.stderr);
    return asked.stdout;
  }
  const json = run(engine, ['gate-brief', `--state=${state}`, `--node=${node}`, '--json', '--picker=rich']);
  assert.equal(json.code, 0, json.stderr);
  const { more_details: _details, ...question } = JSON.parse(json.stdout);
  return `${JSON.stringify(question, null, 2)}\n`;
}

for (const [name, host, treeOf] of FOLD_TREES) {
  test(`node-brief (${name}): a due gate asked in session prints the three lines, then its question as the last block, and publishes the panel`, t => {
    const engine = engineOf(treeOf());
    const due = skipGuardRun(t, false);
    const panel = path.join(due.dir, 'display', 'next.json');
    assert.equal(fs.existsSync(panel), false);
    if (host === 'copilot') fs.writeFileSync(path.join(due.dir, '.ask.result.json'), '{"answered_by":"person"}\n');

    const brief = nodeBrief(due.state, 'review-approval', engine);
    assert.equal(brief.code, 0, brief.stderr);
    assert.equal(brief.stderr, '');
    const lines = brief.stdout.split('\n');
    assert.ok(!lines.some(line => line.startsWith('ask it: ')), 'no ask it line');
    const rules = lines.findIndex(line => line.startsWith('rules: '));
    assert.deepEqual(lines.slice(rules + 1, rules + 5), ['', ...foldedLines(due.state, 'review-approval', host)]);
    const block = lastBlock(brief.stdout);
    assert.equal(brief.stdout, `${lines.slice(0, rules + 5).join('\n')}\n\n${block}`, 'the question follows the three lines after one blank line');
    assert.equal(JSON.parse(fs.readFileSync(panel, 'utf8')).node, 'review-approval', 'the panel is published');

    if (host === 'copilot') {
      assert.equal(fs.readFileSync(path.join(due.dir, '.ask.json'), 'utf8'), block, 'the record holds the printed bytes');
      assert.equal(fs.existsSync(path.join(due.dir, '.ask.result.json')), false, 'the note is retired');
      assert.equal(fs.existsSync(path.join(due.dir, '.ask.result.used.json')), true);
    } else {
      assert.equal(fs.existsSync(path.join(due.dir, '.ask.json')), false, 'Claude Code keeps no record');
      assert.ok(!('more_details' in JSON.parse(block)), 'no more_details');
      assert.ok(JSON.parse(block).options.find(option => option.id === 'more-details').preview, 'More details keeps its preview');
    }
    assert.equal(block, verbQuestion(engine, due.state, 'review-approval', host), 'the block is what gate-brief prints');
  });

  test(`node-brief (${name}): an exception's text sits between the three lines and the question`, t => {
    const engine = engineOf(treeOf());
    const sample = scratch(t, { type: 'node-brief', name: '2026-01-05-exception' });
    freeze(sample, { definition: NODE_BRIEF, orchestrator: { options: { html_output: false } } });
    write(sample, { nodes: { scope: { status: 'completed', values: { wants_audit: true, focus: 'narrow' } } } });
    write(sample, { nodes: { draft: { status: 'completed' } }, node_summaries: { draft: { summary: 'Drafted.' } } });
    write(sample, { nodes: { approval: { status: 'completed' } }, node_summaries: { approval: { decisions: [{ option: 'continue-to-audit', by: 'operator' }] } } });
    write(sample, { nodes: { audit: { status: 'completed' } }, node_summaries: { audit: { summary: 'Audited.', delegated: ['spec-auditor'] } } });
    const brief = nodeBrief(sample.state, 'audit-approval', engine);
    assert.equal(brief.code, 0, brief.stderr);
    const block = lastBlock(brief.stdout);
    assert.ok(brief.stdout.endsWith([
      ...foldedLines(sample.state, 'audit-approval', host),
      '',
      '**Exception.** Ask it even when the audit found nothing, so the operator sees the audit ran.',
      '',
      block,
    ].join('\n')), brief.stdout);
    assert.equal(block, verbQuestion(engine, sample.state, 'audit-approval', host));
  });

  test(`node-brief (${name}): a second brief of the same due gate prints the question again${host === 'copilot' ? ', writing a fresh record and retiring the note' : ''}`, t => {
    const engine = engineOf(treeOf());
    const due = skipGuardRun(t, false);
    const first = nodeBrief(due.state, 'review-approval', engine);
    assert.equal(first.code, 0, first.stderr);
    const record = path.join(due.dir, '.ask.json');
    if (host === 'copilot') {
      // The hand-over used the record up, and the person's answer left its note.
      fs.renameSync(record, path.join(due.dir, '.ask.used.json'));
      fs.writeFileSync(path.join(due.dir, '.ask.result.json'), '{"answered_by":"person"}\n');
    }
    const second = nodeBrief(due.state, 'review-approval', engine);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(fromHeader(second.stdout).join('\n'), fromHeader(first.stdout).join('\n'));
    assert.ok(second.stdout.split('\n').includes(QUESTION_LINE));
    if (host === 'copilot') {
      assert.equal(fs.readFileSync(record, 'utf8'), lastBlock(second.stdout), 'a fresh record');
      assert.equal(fs.existsSync(path.join(due.dir, '.ask.result.json')), false, 'the note is retired again');
    }
  });

  test(`node-brief (${name}): a gate not yet due, a driven gate and a gate under drift keep the ask it line word for word, and write no question`, t => {
    const engine = engineOf(treeOf());
    const call = host === 'copilot' ? '--ask' : '--json --picker=rich';
    /** The brief's lines after its `rules:` line: today's are a blank, the call, and the end. */
    const tail = text => {
      const lines = text.split('\n');
      return lines.slice(lines.findIndex(line => line.startsWith('rules: ')) + 1);
    };

    // Not yet due: the gate before it is still pending.
    const early = skipGuardRun(t, false);
    const notDue = nodeBrief(early.state, 'findings-approval', engine);
    assert.equal(notDue.code, 0, notDue.stderr);
    assert.deepEqual(tail(notDue.stdout), ['', `ask it: gate-brief --state=${early.state} --node=findings-approval ${call}`, '']);

    // Driven: the request, as before.
    const driven = skipGuardRun(t, false);
    write(driven, { orchestrator: { driver: { kind: 'dispatch' } } });
    const requested = nodeBrief(driven.state, 'review-approval', engine);
    assert.equal(requested.code, 0, requested.stderr);
    assert.deepEqual(tail(requested.stdout), ['', `ask it: gate-request --state=${driven.state} --node=review-approval`, '']);

    // Drift: the definition changed after the freeze.
    const drifted = scratch(t, { type: 'skip-guard', name: '2026-01-05-drift' });
    for (const file of ['skip-guard.yml', 'skip-guard.md']) fs.copyFileSync(path.join(DEFINITIONS, file), path.join(drifted.root, file));
    const definition = path.join(drifted.root, 'skip-guard.yml');
    freeze(drifted, { definition });
    write(drifted, { nodes: { review: { status: 'completed', values: { findings_to_review: false } } }, node_summaries: { review: { summary: 'Reviewed the work.' } } });
    fs.writeFileSync(definition, fs.readFileSync(definition, 'utf8').replace('ask: "Review complete. Continue?"', 'ask: "Review complete. Go on?"'));
    const moved = nodeBrief(drifted.state, 'review-approval', engine);
    assert.equal(moved.code, 0, moved.stderr);
    assert.match(moved.stderr, /^warning: node-brief-graph-drift: /m);
    assert.deepEqual(tail(moved.stdout), ['', `ask it: gate-brief --state=${drifted.state} --node=review-approval ${call}`, '']);

    for (const each of [early, driven, drifted]) {
      assert.equal(fs.existsSync(path.join(each.dir, '.ask.json')), false, 'no question record');
      assert.equal(fs.existsSync(path.join(each.dir, 'display', 'next.json')), false, 'no panel');
    }
  });

  test(`node-brief (${name}): a due gate whose question cannot be built keeps its ask it line and warns once`, t => {
    const engine = engineOf(treeOf());
    const unread = scratch(t);
    freeze(unread, { definition: path.join(DEFINITIONS, 'skip-guard.yml') });
    // The review records no value, so the next gate's guard cannot be read.
    write(unread, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed the work.' } } });
    write(unread, { nodes: { 'review-approval': { status: 'completed' } }, node_summaries: { 'review-approval': { decisions: [{ option: 'continue-on', by: 'operator' }] } } });
    const brief = nodeBrief(unread.state, 'findings-approval', engine);
    assert.equal(brief.code, 0, brief.stderr);
    assert.equal(brief.stderr, `${UNBUILT}\n`);
    assert.ok(brief.stdout.endsWith(`\n\nask it: gate-brief --state=${unread.state} --node=findings-approval ${host === 'copilot' ? '--ask' : '--json --picker=rich'}\n`), brief.stdout);
    assert.ok(!brief.stdout.split('\n').includes(QUESTION_LINE));
    assert.equal(fs.existsSync(path.join(unread.dir, '.ask.json')), false);
    assert.equal(fs.existsSync(path.join(unread.dir, 'display', 'next.json')), false);
  });

  test(`node-brief (${name}): one constant switches each host back — the exported foldedAsk gives the ask it line word for word where the host's entry is false`, async t => {
    const lib = await import(pathToFileURL(path.join(treeOf(), 'skills', 'workflow-engine', 'scripts', 'lib', 'node-brief.mjs')).href);
    assert.deepEqual(lib.FOLDED_QUESTION, { claude: true, copilot: true });
    const early = skipGuardRun(t, false);
    // Today's line, as a gate that is not yet due prints it.
    const askIt = nodeBrief(early.state, 'findings-approval', engineOf(treeOf())).stdout.split('\n').find(line => line.startsWith('ask it: '));
    const args = { host, state: early.state, node: 'findings-approval', askIt, question: '{\n  "q": 1\n}\n' };
    assert.deepEqual(lib.foldedAsk({ ...args, folded: { ...lib.FOLDED_QUESTION, [host]: false } }), { lines: [askIt], block: null });
    assert.deepEqual(lib.foldedAsk({ ...args, question: null }), { lines: [askIt], block: null }, 'no question built');
    assert.deepEqual(lib.foldedAsk(args), { lines: foldedLines(early.state, 'findings-approval', host), block: '{\n  "q": 1\n}' });
  });
}

for (const [name, host, treeOf] of FOLD_TREES) {
  test(`node-brief (${name}): a gate in a run whose ending is recorded keeps the ask it line, and writes no question or panel`, t => {
    const engine = engineOf(treeOf());
    const ended = skipGuardRun(t, false);
    write(ended, { task: { status: 'stopped' } });
    const brief = nodeBrief(ended.state, 'review-approval', engine);
    assert.equal(brief.code, 0, brief.stderr);
    const lines = brief.stdout.split('\n');
    const call = host === 'copilot' ? '--ask' : '--json --picker=rich';
    assert.ok(lines.includes(`ask it: gate-brief --state=${ended.state} --node=review-approval ${call}`), brief.stdout);
    assert.ok(!lines.includes(QUESTION_LINE));
    assert.equal(fs.existsSync(path.join(ended.dir, '.ask.json')), false, 'no question record');
    assert.equal(fs.existsSync(path.join(ended.dir, 'display', 'next.json')), false, 'no panel');
  });
}

test('node-brief: the state writer takes the answer note\'s name from the question-record module, which holds the three file names', () => {
  const lib = path.join(ROOT, 'plugins', 'maister', 'skills', 'workflow-engine', 'scripts', 'lib');
  const record = fs.readFileSync(path.join(lib, 'ask-record.mjs'), 'utf8');
  for (const name of ['.ask.json', '.ask.result.json', '.ask.result.used.json']) assert.ok(record.includes(`'${name}'`), `${name} is named in the module`);
  const state = fs.readFileSync(path.join(lib, 'state.mjs'), 'utf8');
  assert.match(state, /import \{[^}]*\bASK_RESULT\b[^}]*\} from '\.\/ask-record\.mjs'/);
  assert.ok(!state.includes('.ask.result.json'), 'the writer holds no copy of the name');
});
