import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, scratch, scratchPlugin, run, sibling, verb, write } from '../helpers.mjs';

// The brief a step reads before it runs: the facts the engine derives for it —
// how it runs, its guard, its attempt, its inputs filled in, the files it
// writes, the questions it asks under this run's driver, the checkpoint it
// feeds, its brief: data and the convention rows that apply — then the step's
// own section of the guide. Read-only, as `run-context` is.

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
  const lines = fs.readFileSync(skill, 'utf8').split('\n');
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

test('node-brief: a step of a fresh development run — the lines that always print, the empty ones omitted, the inputs filled in', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });

  const gap = nodeBrief(dev.state, 'gap-analysis');
  assert.equal(gap.code, 0, gap.stderr);
  assert.equal(gap.stderr, '');
  const [header, slice] = [gap.stdout.slice(0, gap.stdout.indexOf('\n\n')), gap.stdout.slice(gap.stdout.indexOf('\n\n') + 2)];
  assert.deepEqual(header.split('\n'), [
    '## Node: gap-analysis — Gap analysis',
    'runs: agent:gap-analyzer — Task tool',
    'attempt: 1 — pending',
    'with:',
    `- analysis: ${RUN_PATH}/analysis/codebase-analysis.md`,
    `- clarifications: ${RUN_PATH}/analysis/clarifications.md`,
    `- design_index: ${RUN_PATH}/analysis/design-context/INDEX.md`,
    '- task_description: Add a page',
    'writes:',
    `- gap: ${RUN_PATH}/analysis/gap-analysis.md`,
    `- scope: ${RUN_PATH}/analysis/scope-clarifications.md`,
    'records: has_reproducible_defect (bool), mockups_needed (bool), risk_level (enum: high, medium, low)',
    'asks (in session):',
    '- scope-decisions: asked in session',
    'feeds: gap-approval — continues: continue-past-analysis; revise: revise-gap-analysis → gap-analysis',
    'summary keys: gap_analysis, scope_clarifications',
    'budget: 2 attempts — a prose rule; nothing enforces it',
    row('`agent:` step'),
    row('every step'),
    row('asks'),
    row('feeds a checkpoint'),
    row('named by a revise'),
    row('has a budget'),
    RULES,
  ]);
  assert.ok(slice.trim().length > 0 && !slice.startsWith('\n'), 'the section follows the one blank line');
  assert.doesNotMatch(header, /^when:/m, 'an unguarded step prints no when line');

  // A guarded step: its guard as written, and a value no node has recorded yet.
  const red = nodeBrief(dev.state, 'tdd-red');
  assert.equal(red.code, 0, red.stderr);
  assert.match(red.stdout, /^when: \$\{gap-analysis\.values\.has_reproducible_defect\} — now not yet decidable$/m);
  write(dev, { nodes: { 'gap-analysis': { status: 'completed', values: { has_reproducible_defect: true, mockups_needed: false, risk_level: 'low' } } } });
  assert.match(nodeBrief(dev.state, 'tdd-red').stdout, /^when: .* — now true$/m);
  assert.match(nodeBrief(dev.state, 'ui-mockups').stdout, /^when: .* — now false$/m);

  // The slice keeps the rich-picker text and drops the plain-picker passage and every marker.
  const spec = nodeBrief(dev.state, 'specification').stdout;
  assert.match(spec, /Each approach's own option carries its full description/);
  assert.doesNotMatch(spec, /rich-picker|plain-picker|The question carries each approach's line/);
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
    'attempt: 1 — pending',
    'with:',
    '- audit_flag: null',
    '- deep: false',
    '- focus: (not recorded yet)',
    '- label: Focus: (not recorded yet)',
    `- sources: {"list":["plain",false],"notes":"${relative}/analysis/scope.md"}`,
    'writes:',
    `- extras: ${relative}/drafts/extras.md — may be absent: Written only when the draft raises open questions.`,
    `- notes: ${relative}/drafts/notes.md — HTML page owed: ${relative}/drafts/notes.html`,
    'asks (in session):',
    '- tone: asked in session',
    'feeds: approval — continues: continue-to-audit, continue-to-wrap-up; revise: revise-draft → draft',
    'recommends: audit_flag unset — the section decides',
    'summary keys: drafting',
    'budget: 2 attempts — a prose rule; nothing enforces it',
    row('`direct:` step'),
    row('every step'),
    row('asks'),
    row('feeds a checkpoint'),
    row('named by a revise'),
    row('has a budget'),
    `see: ${path.join(DEFINITIONS, 'node-brief.md')} § Embedded mode`,
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
  assert.match(set, /^- focus: narrow$/m);
  assert.match(set, /^- label: Focus: narrow$/m);
});

test('node-brief: the asks line follows the driver — in session, in a question set, or the default nobody is asked', t => {
  const sample = sampleRun(t);
  write(sample, { orchestrator: { driver: { kind: 'cockpit', features: ['question-sets'] } } });
  assert.match(nodeBrief(sample.state, 'draft').stdout, /^asks \(question sets\):\n- tone: asked in this step's question set$/m);

  write(sample, { orchestrator: { driver: { kind: 'dispatch' } } });
  assert.match(nodeBrief(sample.state, 'draft').stdout, /^asks \(nobody can be asked\):\n- tone: not asked — default: A plain tone\.$/m);

  // A built-in's question prints the default its brief: names.
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { driver: { kind: 'dispatch' } } });
  assert.match(nodeBrief(dev.state, 'gap-analysis').stdout,
    /^asks \(nobody can be asked\):\n- scope-decisions: not asked — default: The analyzer's recommended option; .+$/m);
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
  assert.match(unread.stdout, /^## Node: draft — Draft\nruns: direct — inline\nattempt: 1 — pending\n/);
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

  for (const node of ['scope', 'draft', 'approval', 'audit', 'audit-approval', 'wrap-up']) {
    assert.equal(nodeBrief(sample.state, node).code, 0, node);
  }
  const after = snapshot(sample.root);
  delete after[path.join('.maister', 'tasks', 'development', '2026-01-06-other', 'orchestrator-state.yml')];
  assert.deepEqual(after, before);
  assert.ok(Object.keys(before).some(file => file.includes(`${path.sep}display${path.sep}`)), 'the snapshot covers the run\'s display files');
  assert.ok(!fs.existsSync(path.join(sample.dir, 'display', 'next.json')), 'no gate panel is written');

  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/node-brief.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(node-brief-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
  const header = source.slice(0, source.indexOf('\nimport '));
  assert.doesNotMatch(header, /docs\//, 'the header cites no file under docs/');
  const skill = fs.readFileSync(SKILL, 'utf8');
  for (const code of [...REFUSALS, 'node-brief-graph-drift', 'node-brief-definition-unread', 'node-brief-conventions-unread']) {
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
  assert.match(result.stdout, /^summary keys: drafting$/m, 'the base\'s other brief: keys stay');
});

test('node-brief: a CRLF guide gives the same brief as its LF copy, see: line included, with no CR in it', t => {
  const lf = copiedSample(t);
  const crlf = copiedSample(t, { guide: text => text.replace(/\n/g, '\r\n') });
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
