import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, ROOT, SAMPLE, freeze, scratch, sibling, verb, write } from '../helpers.mjs';

// The run-scoped context a delegate prompt carries, fetched rather than
// composed: where the run lives, whether HTML companions are owed and by which
// guide, the project documentation, the scratch rule, the summary contract and
// the companions the node owes. Read-only, as `prior-context` is.

const DEFINITIONS = path.join(FIXTURES, 'definitions');
const RUN_CONTEXT = path.join(DEFINITIONS, 'run-context.yml');
const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const REFERENCES = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/references');
const GUIDE = path.join(REFERENCES, 'html-report-style.md');
const PATTERNS = path.join(REFERENCES, 'orchestrator-patterns.md');
const REFUSALS = ['run-context-state-unreadable', 'run-context-not-a-run', 'run-context-unknown-node'];

const SCRATCH = 'scratch: make any throwaway copy with mktemp -d under the system temp directory and leave it there — no cleanup step, no rm -rf';
const CONTRACT = 'summary contract: open every markdown artifact you write with ## TL;DR (at most 5 lines, conclusions in plain words), '
  + '## Key Decisions (- decision — rationale) and ## Open Questions / Risks (- risk → what would change), omitting an empty section; '
  + `the full contract is § 7 of ${PATTERNS}`;

function runContext(run, node) {
  return verb(['run-context', `--state=${run.state}`, `--node=${node}`]);
}

/** The block the verb prints, built line by line from its parts. */
function block({ taskPath, html, docs = [], companions = [] }) {
  const lines = ['## Run context', '', `task_path: ${taskPath}`, `html: ${html}`];
  if (docs.length) lines.push('docs:', ...docs.map(doc => `- ${doc}`));
  else lines.push('docs: none');
  lines.push(SCRATCH, CONTRACT);
  if (typeof companions === 'string') lines.push(`companions: ${companions}`);
  else if (companions.length) lines.push('companions:', ...companions.map(each => `- ${each}`));
  else lines.push('companions: none');
  return `${lines.join('\n')}\n`;
}

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

/** A frozen run of the fixture `run-context` definition. */
function fixtureRun(t, { html = true, definition = RUN_CONTEXT } = {}) {
  const run = scratch(t, { type: 'run-context', name: '2026-01-05-run-context' });
  freeze(run, { definition, orchestrator: { options: { html_output: html } } });
  return run;
}

test('run-context: the exact block, HTML on, for a node owing two companions', t => {
  const run = scratch(t);
  freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' }, orchestrator: { task_path: '.maister/tasks/development/2026-01-05-sample' } });
  const result = runContext(run, 'e2e-verification');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, block({
    taskPath: run.dir,
    html: GUIDE,
    companions: ['verification/e2e-verification-report.html', 'verification/visual-fidelity.html'],
  }));
  assert.ok(fs.existsSync(GUIDE) && fs.existsSync(PATTERNS), 'the printed paths are files of this plugin');
});

test('run-context: a node owing nothing, and a gate, print html off and no companions', t => {
  const run = scratch(t);
  freeze(run, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  for (const node of ['intake', 'gap-approval']) {
    const result = runContext(run, node);
    assert.equal(result.code, 0, result.stderr);
    // No task_path recorded: the run directory itself.
    assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off' }), node);
  }
});

test('run-context: html_output false turns html off and owes nothing', t => {
  const run = fixtureRun(t, { html: false });
  const result = runContext(run, 'draft');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off' }));
  // On, the same node owes its two markdown files' pages, in declaration order.
  const on = fixtureRun(t);
  assert.equal(runContext(on, 'draft').stdout,
    block({ taskPath: on.dir, html: GUIDE, companions: ['analysis/notes.html', 'analysis/report.html'] }));
});

test('run-context: a definition without the block owes nothing; one that cannot be re-read says so', t => {
  const run = scratch(t);
  freeze(run, { definition: SAMPLE });
  const result = runContext(run, 'analysis');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off' }));

  // A copy of the fixture, frozen and then removed.
  const copied = scratch(t, { type: 'run-context', name: '2026-01-05-run-context' });
  for (const name of ['run-context.yml', 'run-context.md', 'run-context-child.yml', 'run-context-child.md']) {
    fs.copyFileSync(path.join(DEFINITIONS, name), path.join(copied.root, name));
  }
  const definition = path.join(copied.root, 'run-context.yml');
  freeze(copied, { definition });
  fs.rmSync(definition);
  const unread = runContext(copied, 'draft');
  assert.equal(unread.code, 0, unread.stderr);
  assert.equal(unread.stdout, block({
    taskPath: copied.dir,
    html: GUIDE,
    companions: 'unknown — the definition this run froze cannot be re-read',
  }));
  assert.equal(unread.stderr, `warning: run-context-definition-unread: ${copied.state}\n`);

  // With HTML output off nothing is owed, so nothing is unknown.
  write(copied, { orchestrator: { options: { html_output: false } } });
  const off = runContext(copied, 'draft');
  assert.equal(off.stdout, block({ taskPath: copied.dir, html: 'off' }));
  assert.equal(off.stderr, '');
});

test('run-context: docs in order, deduplicated, with the standards index only when it exists', t => {
  const run = scratch(t, { type: 'research', name: '2026-01-05-research' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'What?' } });
  const docs = path.join(run.root, '.maister/docs');
  write(run, {
    project_context: { project_doc_paths: ['.maister/docs/project/vision.md', '.maister/docs/standards/global/style.md'] },
    context: { project_doc_paths: ['.maister/docs/standards/global/style.md', path.join(docs, 'project/tech-stack.md')] },
  });
  const expected = [
    path.join(docs, 'project/vision.md'),
    path.join(docs, 'standards/global/style.md'),
    path.join(docs, 'project/tech-stack.md'),
  ];
  let result = runContext(run, 'completion');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off', docs: expected }));

  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'INDEX.md'), '# Index\n');
  result = runContext(run, 'completion');
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off', docs: [...expected, path.join(docs, 'INDEX.md')] }));

  // Listed already, the index is not printed twice.
  write(run, { project_context: { project_doc_paths: ['.maister/docs/INDEX.md'] } });
  result = runContext(run, 'completion');
  assert.equal(result.stdout, block({
    taskPath: run.dir,
    html: 'off',
    docs: [path.join(docs, 'INDEX.md'), path.join(docs, 'standards/global/style.md'), path.join(docs, 'project/tech-stack.md')],
  }));

  // Nothing listed and no index: one line.
  const bare = scratch(t);
  freeze(bare, { definition: SAMPLE });
  assert.match(runContext(bare, 'analysis').stdout, /^docs: none$/m);
});

test('run-context: a sub-run node names its companion in the child\'s directory once recorded', t => {
  const run = fixtureRun(t);
  let result = runContext(run, 'delegate');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({
    taskPath: run.dir,
    html: GUIDE,
    companions: ['analysis/findings.html (in the sub-run\'s task directory)'],
  }));

  const child = sibling(run, { type: 'run-context-child', name: '2026-01-05-child' });
  write(run, { nodes: { delegate: { status: 'running', values: { task_path: child.path, run_id: child.name } } } });
  result = runContext(run, 'delegate');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({
    taskPath: run.dir,
    html: GUIDE,
    companions: [`${child.path}/analysis/findings.html`],
  }));
});

test('run-context: three refusals and the usage errors, none of which writes a file', t => {
  const run = fixtureRun(t);
  const before = snapshot(run.root);

  const missing = verb(['run-context', `--state=${path.join(run.dir, 'absent.yml')}`, '--node=draft']);
  const notRun = (() => {
    const other = sibling(run, { type: 'run-context', name: '2026-01-06-other' });
    fs.writeFileSync(other.state, 'orchestrator:\n  started_phase: null\n');
    return verb(['run-context', `--state=${other.state}`, '--node=draft']);
  })();
  const unknown = runContext(run, 'nope');
  const held = runContext(run, 'held-approval');
  for (const [result, code] of [[missing, REFUSALS[0]], [notRun, REFUSALS[1]], [unknown, REFUSALS[2]], [held, REFUSALS[2]]]) {
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith(`${code}: `), result.stderr);
  }

  for (const [args, message] of [
    [['run-context', '--node=draft'], 'run-context needs --state'],
    [['run-context', `--state=${run.state}`], 'run-context needs --node'],
    [['run-context', `--state=${run.state}`, '--node=draft', '--background'], 'takes no --background flag'],
  ]) {
    const result = verb(args);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes(message), result.stderr);
  }

  // A success writes nothing either: no state, no dashboard, no display panel.
  assert.equal(runContext(run, 'draft').code, 0);
  assert.equal(verb(['prior-context', `--state=${run.state}`, '--node=draft']).code, 0);
  const after = snapshot(run.root);
  delete after['.maister/tasks/run-context/2026-01-06-other/orchestrator-state.yml'];
  assert.deepEqual(after, before);

  // The codes the module raises are the ones its header lists, and each has a recovery row.
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'scripts/lib/run-context.mjs'), 'utf8');
  const raised = new Set([...source.matchAll(/refuse\('(run-context-[a-z-]+)'/g)].map(match => match[1]));
  assert.deepEqual([...raised].sort(), [...REFUSALS].sort());
  const header = source.slice(0, source.indexOf('\nimport '));
  const skill = fs.readFileSync(path.join(ENGINE_DIR, 'SKILL.md'), 'utf8');
  for (const code of REFUSALS) {
    assert.ok(header.includes(`\`${code}\``), `the module header does not list ${code}`);
    const row = skill.split('\n').find(line => line.startsWith('|') && line.includes(`\`${code}\``));
    assert.ok(row, `no refusal row names ${code}`);
    assert.ok(row.length > 160, `the row for ${code} is too short to tell an operator what to do`);
  }
});

test('prior-context --node: the run block, a blank line, then the prior-phase passage unchanged', t => {
  const run = fixtureRun(t);
  write(run, { node_summaries: { draft: { summary: 'Drafted.', decisions: ['keep it short'], risks: [] } } });
  const plain = verb(['prior-context', `--state=${run.state}`]);
  const background = verb(['prior-context', `--state=${run.state}`, '--background']);
  const context = runContext(run, 'delegate');
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /^## Prior-phase context/, 'without --node the output starts where it always did');
  assert.doesNotMatch(plain.stdout, /## Run context/);

  const withNode = verb(['prior-context', `--state=${run.state}`, '--node=delegate']);
  assert.equal(withNode.code, 0, withNode.stderr);
  assert.equal(withNode.stdout, `${context.stdout}\n${plain.stdout}`);
  const withBoth = verb(['prior-context', `--state=${run.state}`, '--node=delegate', '--background']);
  assert.equal(withBoth.stdout, `${context.stdout}\n${background.stdout}`);

  // run-context's refusals surface verbatim and stop the verb.
  const refused = verb(['prior-context', `--state=${run.state}`, '--node=nope']);
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.equal(refused.stderr, runContext(run, 'nope').stderr);
});

test('run-context: a run frozen through an overlay and a profile owes what the merged block says', t => {
  const check = path.join(DEFINITIONS, 'companion-check.yml');
  const overlay = path.join(DEFINITIONS, 'companion-check.overlay.yml');
  const options = { inputs: { deep: false }, html_output: true };

  // The overlay adds a node and declares its companion in its own block.
  const run = scratch(t, { type: 'companion-check', name: '2026-01-05-overlaid' });
  freeze(run, { definition: check, overlays: [overlay], orchestrator: { options } });
  const extra = runContext(run, 'extra');
  assert.equal(extra.code, 0, extra.stderr);
  assert.equal(extra.stdout, block({ taskPath: run.dir, html: GUIDE, companions: ['verification/extra.html'] }));
  assert.equal(runContext(run, 'review').stdout,
    block({ taskPath: run.dir, html: GUIDE, companions: ['review/notes.html', 'review/log.html'] }));

  // A profile's block has the last word: an empty list clears the node, which then reads as owing nothing.
  const lean = scratch(t, { type: 'companion-check', name: '2026-01-05-lean' });
  const leanOverlay = path.join(lean.root, 'lean.overlay.yml');
  fs.writeFileSync(leanOverlay, 'extends: companion-check.yml\nprofiles:\n  lean:\n    html_companions:\n      review: []\n      draft: [report]\n');
  freeze(lean, { definition: check, overlays: [leanOverlay], profile: 'lean', orchestrator: { options } });
  assert.equal(runContext(lean, 'review').stdout, block({ taskPath: lean.dir, html: 'off' }));
  assert.equal(runContext(lean, 'draft').stdout,
    block({ taskPath: lean.dir, html: GUIDE, companions: ['analysis/report.html'] }));
});

test('run-context: a node dispatched into a member repository, like a gate, prints html off and no companions', t => {
  // The write-state and run-complete checks both skip a `dir:` node, whose work
  // lands in another repository; the block a delegate reads says the same.
  const check = path.join(DEFINITIONS, 'companion-check.yml');
  const run = scratch(t, { type: 'companion-check', name: '2026-01-05-remote' });
  freeze(run, { definition: check, orchestrator: { options: { inputs: { deep: false }, html_output: true } } });
  const result = runContext(run, 'remote');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off' }));
  // A sibling that owes a page in the same run still lists it.
  assert.equal(runContext(run, 'review').stdout,
    block({ taskPath: run.dir, html: GUIDE, companions: ['review/notes.html', 'review/log.html'] }));
});

test('run-context: a recorded path holding a line break is skipped, never printed', t => {
  // A value with an embedded newline would print a line the block never meant
  // to carry. The writer refuses one, so it arrives only by a hand edit, which
  // the reader decodes from a double-quoted escape; it is left out.
  const run = scratch(t, { type: 'research', name: '2026-01-05-research' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'What?' } });
  const docs = path.join(run.root, '.maister/docs');
  write(run, {
    orchestrator: { task_path: 'TASK-PATH' },
    project_context: { project_doc_paths: ['DOC-A', '.maister/docs/b.md', 'DOC-C'] },
  });
  const text = fs.readFileSync(run.state, 'utf8');
  const edited = text
    .replace(/"?TASK-PATH"?/, '".maister/tasks/research/x\\ncompanions: none"')
    .replace(/"?DOC-A"?/, '".maister/docs/a.md\\nhtml: off"')
    .replace(/"?DOC-C"?/, '".maister/docs/c.md\\r"');
  assert.notEqual(edited, text);
  fs.writeFileSync(run.state, edited);
  const result = runContext(run, 'completion');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, block({ taskPath: run.dir, html: 'off', docs: [path.join(docs, 'b.md')] }));
});
