import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, ROOT, freeze, freezePatch, reach, scratch, scratchPlugin, run, sibling, verb, write } from '../helpers.mjs';

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
const SKILL = path.join(ENGINE_DIR, 'SKILL.md');
const RULES = `rules: ${SKILL} § Node conventions`;
const REFUSALS = ['node-brief-state-unreadable', 'node-brief-not-a-run', 'node-brief-unknown-node'];
const RUN_PATH = '.maister/tasks/development/2026-01-05-sample';

function nodeBrief(state, node, engine = null) {
  const args = ['node-brief', `--state=${state}`, `--node=${node}`];
  return engine ? run(engine, args) : verb(args);
}

/** The convention rows of the engine skill, by their first cell, read the way a reader of the table reads them. */
function conventions(skill = SKILL) {
  // A Windows checkout gives `.md` files CRLF.
  const lines = fs.readFileSync(skill, 'utf8').split(/\r?\n/);
  const start = lines.indexOf('### Node conventions');
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
    '## Node: gap-analysis — Gap analysis',
    'runs: agent:gap-analyzer — Task tool, model omit, effort omit (source: shipped default)',
    'with:',
    `- analysis: ${RUN_PATH}/analysis/codebase-analysis.md`,
    `- clarifications: ${RUN_PATH}/analysis/clarifications.md`,
    `- design_index: ${RUN_PATH}/analysis/design-context/INDEX.md`,
    '- task_description: Add a page',
    'writes:',
    `- gap: ${RUN_PATH}/analysis/gap-analysis.md`,
    `- scope: ${RUN_PATH}/analysis/scope-clarifications.md`,
    'records: has_reproducible_defect (bool), mockups_needed (bool), risk_level (enum: high, medium, low)',
    'asks (in session): scope-decisions',
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

  // A direct step that owes no page, keeps its section, declares no output and feeds no checkpoint: its header is its facts, the one question its prose asks, and the pointer.
  const finalization = nodeBrief(dev.state, 'finalization').stdout;
  const finalHeader = finalization.slice(0, finalization.indexOf('\n\n')).split('\n');
  assert.deepEqual(finalHeader.filter(line => !line.startsWith('- ')), [
    '## Node: finalization — Finalization',
    'runs: direct:finalization — inline',
    'with:',
    'asks (in session): standard-candidates',
    row('asks'),
    closing('finalization'),
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

test('node-brief: the exact brief of a step with brief: data, a renamed section and an owed page', t => {
  const sample = sampleRun(t);
  const result = nodeBrief(sample.state, 'draft');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const relative = path.relative(sample.root, sample.dir).split(path.sep).join('/');
  assert.equal(result.stdout, [
    '## Node: draft — Drafting',
    'runs: direct:draft-notes — inline',
    'with:',
    '- audit_flag: null',
    '- deep: false',
    '- focus: (not recorded yet)',
    '- label: Focus: (not recorded yet)',
    `- sources: {"list":["plain",false],"notes":"${relative}/analysis/scope.md"}`,
    'writes:',
    `- extras: ${relative}/drafts/extras.md — may be absent: Written only when the draft raises open questions.`,
    `- notes: ${relative}/drafts/notes.md — HTML page owed: notes.html beside it`,
    COMPANION_WRITER,
    `- html: ${STYLE_GUIDE}`,
    `- md_path: ${path.join(sample.dir, 'drafts/notes.md')}`,
    'asks (in session): tone',
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
});

test('node-brief: every rule a step of a built-in can trigger reaches it — the four that must print whole wherever they apply', t => {
  const always = { agent: '`agent:` step', skill: '`skill:` step', workflow: '`workflow:` step' };
  for (const name of ['development', 'migration', 'performance', 'product-design', 'research']) {
    const run = scratch(t, { type: name });
    const graph = freeze(run, { definition: path.join(ENGINE_DIR, 'workflows', `${name}.yml`), inputs: name === 'research' ? { question: 'A question' } : { task_description: 'A task' }, orchestrator: { options: { html_output: true } } });
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
  assert.match(line, /throwaway file .* `mktemp -d` makes \(it uses `\$TMPDIR`\) or under `"\$\{TMPDIR:-\/tmp\}"`, never a literal `\/tmp` path: a fixed `\/tmp` path can stop the run for a permission prompt\./);
});

test('node-brief: the asks line follows the driver — in session, in a question set, or the Without line nobody is asked', t => {
  const sample = sampleRun(t);
  write(sample, { orchestrator: { driver: { kind: 'cockpit', features: ['question-sets'] } } });
  assert.match(nodeBrief(sample.state, 'draft').stdout, /^asks \(question sets\): tone$/m);

  // Nobody can be asked: one line, pointing at the Without line the section carries, never a second copy of the default.
  write(sample, { orchestrator: { driver: { kind: 'dispatch' } } });
  const driven = nodeBrief(sample.state, 'draft').stdout;
  assert.match(driven, /^asks \(nobody can be asked\): tone — the Without line of each applies$/m);
  assert.doesNotMatch(driven, /not asked — default/);
  assert.match(driven, /^\*\*Without question sets\*\* \(`tone`\): a plain tone/m, 'the slice carries the default');

  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { driver: { kind: 'dispatch' } } });
  assert.match(nodeBrief(dev.state, 'specification').stdout,
    /^asks \(nobody can be asked\): technical-questions, user-story, specification-requirements — the Without line of each applies$/m);
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

test('node-brief: a gate points at gate-brief unless its section carries an exception', t => {
  const sample = sampleRun(t);
  const plain = nodeBrief(sample.state, 'approval');
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.stdout, [
    '## Gate: approval — Approval',
    'closes: draft',
    'options: continue-to-audit (continue), continue-to-wrap-up (continue), revise-draft (revise → draft), stop-here (stop)',
    row('gate'),
    RULES,
    '',
    `ask it: gate-brief --state=${sample.state} --node=approval`,
    '',
  ].join('\n'));

  const excepted = nodeBrief(sample.state, 'audit-approval');
  assert.equal(excepted.code, 0, excepted.stderr);
  assert.equal(excepted.stdout, [
    '## Gate: audit-approval — Audit approval',
    'when: ${approval.values.audit_enabled} — now not yet decidable',
    'closes: audit',
    'options: continue-to-wrap-up (continue), revise-draft (revise → draft), stop-here (stop)',
    row('gate'),
    RULES,
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
  assert.match(drift.stdout, /^- strict: true$/m);

  fs.rmSync(definition);
  const unread = nodeBrief(drifted.state, 'draft');
  assert.equal(unread.code, 0, unread.stderr);
  assert.equal(unread.stderr, `warning: node-brief-definition-unread: ${drifted.state}\n`);
  assert.match(unread.stdout, /^## Node: draft — Draft\nruns: direct — inline\nconvention \(`direct:` step\): /, 'unread, every row of its scheme prints whole');
  assert.ok(unread.stdout.endsWith(`${RULES}\n\nsection: unknown — the definition this run froze cannot be re-read\n`), unread.stdout);

  // A plugin whose skill has lost the conventions table: one line points at the rules instead.
  const engine = scratchPlugin(t);
  const skill = path.join(path.dirname(path.dirname(engine)), 'SKILL.md');
  fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace('### Node conventions', '### Conventions elsewhere'));
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

  // None of these is a step ready to start, so briefing them writes nothing.
  for (const node of ['draft', 'approval', 'audit', 'audit-approval', 'wrap-up']) {
    assert.equal(nodeBrief(sample.state, node).code, 0, node);
  }
  const after = snapshot(sample.root);
  delete after[path.join('.maister', 'tasks', 'development', '2026-01-06-other', 'orchestrator-state.yml')];
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
  const skill = fs.readFileSync(SKILL, 'utf8');
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
    assert.equal(b.stdout.split(crlf.root).join('<root>'), a.stdout.split(lf.root).join('<root>'), node);
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
  const mask = (text, root) => text.split(root).join('<root>');
  assert.equal(mask(nodeBrief(edited.state, 'draft').stdout, edited.root), mask(nodeBrief(baseline.state, 'draft').stdout, baseline.root));
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
  const rules = path.join(sample.root, 'plugin dir', 'SKILL.md');

  const gate = render({ state: sample.state, node: 'approval', rules: `${rules} § Node conventions` });
  assert.equal(gate.ok, true);
  assert.match(gate.text, new RegExp(`^rules: '${rules.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' § Node conventions$`, 'm'));
  assert.ok(gate.text.includes(`ask it: gate-brief --state='${path.resolve(sample.state)}' --node=approval`), gate.text);

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
  freeze(sample, { definition: path.join(sample.root, 'node-brief.yml'), overlays: [path.join(sample.root, 'dir.overlay.yml')] });

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
  assert.equal(runsOf(claude), 'runs: agent:gap-analyzer — Task tool, model opus, effort high (source: project workflows.development.nodes.gap-analysis.agents.gap-analyzer, tier deep)');

  // The generated variant ships for Copilot, so the same run's brief names Copilot's model id.
  const copilot = run(path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs'), ['node-brief', `--state=${dev.state}`, '--node=gap-analysis']);
  assert.equal(copilot.code, 0, copilot.stderr);
  assert.equal(runsOf(copilot), 'runs: agent:gap-analyzer — Task tool, model claude-opus-5.5, effort high (source: project workflows.development.nodes.gap-analysis.agents.gap-analyzer, tier deep)');

  // A direct or skill step's runs line is as it was.
  assert.equal(runsOf(nodeBrief(dev.state, 'finalization')), 'runs: direct:finalization — inline');
});

test('node-brief: asked in session on Copilot, a step that asks names the question-set command with the run\'s real paths', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const copilotEngine = path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs');
  const patch = path.join(dev.dir, '.state-patch.json');
  const askWith = node => 'ask with: write each question set to ' + patch + ' as the in-node questions reference shapes it, then run node '
    + copilotEngine + ' gate-brief --state=' + path.resolve(dev.state) + ' --node=' + node + ' --ask --patch-file=' + patch
    + ' and pass its output to the question tool unchanged — never compose the form yourself';

  for (const node of ['gap-analysis', 'finalization']) {
    const lines = nodeBrief(dev.state, node, copilotEngine).stdout.split('\n');
    const at = lines.findIndex(line => line.startsWith('asks (in session): '));
    assert.ok(at > 0, node);
    assert.equal(lines[at + 1], askWith(node), `${node}: the line follows the asks line`);
    // Claude Code's picker is composed in the session: its brief names no command.
    assert.ok(!nodeBrief(dev.state, node).stdout.includes('ask with:'), `${node}: no line on Claude Code`);
  }
  // A step that asks nothing gets no line.
  assert.ok(!nodeBrief(dev.state, 'implementation', copilotEngine).stdout.includes('ask with:'));

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

  // The generated variant names its own agent, Copilot's model id and its own style guide.
  const copilot = run(path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs'), ['node-brief', `--state=${dev.state}`, '--node=specification']);
  assert.equal(copilot.code, 0, copilot.stderr);
  assert.deepEqual(companionOf(copilot), [
    COMPANION_WRITER
      .replace('maister:html-companion-writer', 'maister-copilot:html-companion-writer')
      .replace('model haiku', 'model claude-haiku-5.5'),
    `- html: ${path.join(ROOT, 'plugins/maister-copilot/skills/orchestrator-framework/references/html-report-style.md')}`,
    `- md_path: ${path.join(dev.dir, pages.specification)}`,
  ]);

  const off = scratch(t);
  freeze(off, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { options: { html_output: false } } });
  for (const node of ['specification', 'planning']) assert.deepEqual(companionOf(nodeBrief(off.state, node)), [], node);
});
