import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DECLARED, ENGINE_DIR, FIXTURES, OPERATOR, SAMPLE, freeze, freezePatch, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const CLOSING_CHILD = path.join(FIXTURES, 'definitions/closing-child.yml');

/**
 * The unproven run under another workflow name: a state no freeze proves,
 * which is how a name no definition carries — and one no freeze would accept —
 * reaches the writer at all.
 */
function renamed(t, name) {
  const run = scratch(t, { fixture: 'unproven' });
  const text = fs.readFileSync(run.state, 'utf8');
  fs.writeFileSync(run.state, text.replace('  name: development\n', `  name: ${JSON.stringify(name)}\n`));
  return run;
}

/**
 * The state text without its write stamp: every landed write re-stamps
 * `orchestrator.updated`, so a comparison across two writes that must not move
 * anything else would fail whenever they straddle a second.
 */
const unstamped = text => text.replace(/^  updated: .*$/m, '');

/** Send a patch expected to be refused; return the result and assert nothing moved. */
function refused(run, patch) {
  const before = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'a refused write reports no changed paths');
  const after = fs.existsSync(run.state) ? fs.readFileSync(run.state, 'utf8') : null;
  assert.equal(after, before, 'a refused write leaves the state file byte-for-byte as it was');
  return result;
}

test('freeze: installs the task and the graph in one write, every node pending', t => {
  const run = scratch(t);
  const graph = freeze(run, { inputs: { ticket: 'ALPHA-42' }, task: { key: 'ALPHA-42' } });
  const state = readState(run);

  assert.equal(state.task.title, 'Sample run');
  assert.equal(state.task.key, 'ALPHA-42');
  assert.equal(state.workflow.name, 'development');
  assert.equal(state.workflow.graph_hash, graph.graph_hash, 'the hash is copied through exactly as resolve printed it');
  assert.equal(state.workflow.source, SAMPLE);
  assert.deepEqual(Object.keys(state.workflow.nodes), graph.nodes.map(node => node.id));
  for (const entry of Object.values(state.workflow.nodes)) assert.equal(entry.status, 'pending');
  assert.deepEqual(state.workflow.nodes.research, { kind: 'workflow', status: 'pending', needs: ['implementation'] });
  assert.deepEqual(state.orchestrator.options.inputs, { ticket: 'ALPHA-42' });
});

test('freeze: every node carries its needs from the resolved graph, though the patch sent none', t => {
  const run = scratch(t);
  const graph = freeze(run);
  const nodes = readState(run).workflow.nodes;
  for (const node of graph.nodes) assert.deepEqual(nodes[node.id].needs, node.needs, node.id);
  assert.deepEqual(nodes.analysis.needs, [], 'a root node records that it needs nothing');
});

test('freeze: a graph_hash the definition does not resolve to is refused, and nothing is written', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  patch.workflow.graph_hash = patch.workflow.graph_hash.replace(/.$/, last => (last === '0' ? '1' : '0'));
  const result = refused(run, patch);
  assert.match(result.stderr, /^state-freeze-unproven\b/);
  assert.match(result.stderr, /resolve/);
});

test('freeze: resolve names the tracker-key input the freeze reads task.key from', () => {
  const graph = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  assert.equal(graph.tracker_key, 'ticket');
});

test('freeze: seeds completed_phases and failed_phases as empty lists at the top of the block', t => {
  const run = scratch(t);
  const result = verb(['write-state', `--state=${run.state}`], freezePatch({ task: { title: 'Seeded' } }).patch);
  assert.equal(result.code, 0, result.stderr);
  const changed = result.stdout.split('\n\n')[1].trim().split('\n');
  assert.deepEqual(changed.slice(0, 2), ['orchestrator.completed_phases', 'orchestrator.failed_phases']);
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^orchestrator:\n  completed_phases: \[\]\n  failed_phases: \[\]\n/);
});

test('freeze: seeds started_phase as null, and a later write replaces it', t => {
  const run = scratch(t);
  freeze(run);
  assert.match(fs.readFileSync(run.state, 'utf8'), /^ {2}started_phase: null$/m);
  assert.equal(readState(run).orchestrator.started_phase, null);
  write(run, { orchestrator: { started_phase: 'analysis' } });
  assert.equal(readState(run).orchestrator.started_phase, 'analysis');
  const supplied = scratch(t);
  freeze(supplied, { orchestrator: { started_phase: 'intake' } });
  assert.equal(readState(supplied).orchestrator.started_phase, 'intake', 'a value the freeze patch supplies is kept');
});

test('freeze: stamps created from the write\'s clock, and a supplied value is kept', t => {
  const run = scratch(t);
  freeze(run);
  const state = readState(run);
  assert.match(state.orchestrator.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(state.orchestrator.created, state.orchestrator.updated, 'one clock for the whole write');
  write(run, { orchestrator: { started_phase: 'analysis' } });
  assert.equal(readState(run).orchestrator.created, state.orchestrator.created, 'a later write never re-stamps it');
  const supplied = scratch(t);
  freeze(supplied, { orchestrator: { created: '2026-01-05T09:00:00Z' } });
  assert.equal(readState(supplied).orchestrator.created, '2026-01-05T09:00:00Z', 'a value the freeze patch supplies is kept');
});

test('freeze: a sequence the patch supplies is not re-seeded', t => {
  const run = scratch(t);
  write(run, freezePatch({ task: { title: 'Seeded' }, orchestrator: { completed_phases: ['intake'] } }).patch);
  const state = readState(run);
  assert.deepEqual(state.orchestrator.completed_phases, ['intake']);
  assert.deepEqual(state.orchestrator.failed_phases, []);
});

// The startup banner: the freeze write prints it before the changed paths, once.

test('banner: the freeze prints the task, its directory, the dashboard and the first node first, then the changed paths', t => {
  const run = scratch(t);
  const resolved = JSON.parse(verb(['resolve', `--definition=${DEVELOPMENT}`]).stdout);
  const nodes = Object.fromEntries(resolved.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
  const result = verb(['write-state', `--state=${run.state}`], {
    task: { title: 'Fix the parser', status: 'in_progress' },
    workflow: { source: DEVELOPMENT, graph_hash: resolved.graph_hash, grammar_version: 1, name: 'development', nodes },
    orchestrator: { options: { inputs: { task_description: 'Fix the parser' } } },
  });
  assert.equal(result.code, 0, result.stderr);
  const [banner, paths] = result.stdout.split('\n\n');
  assert.match(paths, /^orchestrator\.completed_phases$/m, 'the changed paths follow the banner, unchanged');
  assert.equal(banner, [
    'Tell the user, in your own message before any other call: the workflow and the task, the checkpoints, the directory, the dashboard and the first phase below.',
    'Maister run started: Development',
    'Task: Fix the parser',
    'Checkpoints: up to 10 where you decide',
    `Directory: ${run.dir}`,
    `Dashboard: ${pathToFileURL(path.join(run.dir, 'dashboard.html')).href}`,
    'First phase: Intake',
  ].join('\n'));
});

test('banner: with html_output false the dashboard line says there is none', t => {
  const run = scratch(t);
  const result = verb(['write-state', `--state=${run.state}`],
    freezePatch({ task: { title: 'Quiet' }, orchestrator: { options: { html_output: false } } }).patch);
  assert.match(result.stdout, /^Dashboard: none \(html_output is false\)$/m);
});

test('banner: a later write that re-sends the workflow block prints no second banner', t => {
  const run = scratch(t);
  const graph = freeze(run);
  const nodes = Object.fromEntries(graph.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
  const result = write(run, { workflow: { name: 'development', nodes } });
  assert.doesNotMatch(result.stdout, /Maister run started/);
});

test('banner: a retried freeze, the identical patch sent again, is a no-op with no banner', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const graph = JSON.parse(verb(['resolve', `--definition=${SAMPLE}`]).stdout);
  const nodes = Object.fromEntries(graph.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
  const result = verb(['write-state', `--state=${run.state}`], {
    task: { title: 'Sample run', status: 'in_progress' },
    workflow: { source: SAMPLE, overlays: graph.overlays, profile: graph.profile, graph_hash: graph.graph_hash, grammar_version: 1, name: graph.name, nodes },
    orchestrator: {},
  });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Maister run started/);
  assert.doesNotMatch(result.stdout, /^workflow/m, 'no workflow path is reported');
  assert.equal(unstamped(fs.readFileSync(run.state, 'utf8')), unstamped(before));
});

// The freeze installs the dashboard viewer beside the data it projects, so an
// engine-driven run directory opens like any other.
const VIEWER = path.join(ENGINE_DIR, '..', 'orchestrator-framework', 'assets', 'dashboard.html');
const FROZEN = () => freezePatch({ task: { title: 'Viewer' } }).patch;

test('viewer: the freeze copies dashboard.html into the run directory and reports it after the banner', t => {
  const run = scratch(t);
  const result = write(run, FROZEN());
  assert.equal(fs.readFileSync(path.join(run.dir, 'dashboard.html'), 'utf8'), fs.readFileSync(VIEWER, 'utf8'));
  const [banner, paths] = result.stdout.split('\n\n');
  assert.match(paths, /^dashboard\.html$/m);
  assert.match(banner, /^Maister run started: /m);
});

test('viewer: the freeze never overwrites a dashboard.html already there', t => {
  const run = scratch(t);
  fs.writeFileSync(path.join(run.dir, 'dashboard.html'), '<!-- the operator\'s own -->\n');
  const result = write(run, FROZEN());
  assert.equal(fs.readFileSync(path.join(run.dir, 'dashboard.html'), 'utf8'), '<!-- the operator\'s own -->\n');
  assert.doesNotMatch(result.stdout, /^dashboard\.html$/m);
});

test('viewer: no copy when html_output is false', t => {
  const run = scratch(t);
  const result = write(run, { ...FROZEN(), orchestrator: { options: { html_output: false } } });
  assert.equal(fs.existsSync(path.join(run.dir, 'dashboard.html')), false);
  assert.doesNotMatch(result.stdout, /^dashboard\.html$/m);
});

test('viewer: a later write that is not the freeze copies nothing', t => {
  const run = scratch(t);
  write(run, FROZEN());
  fs.rmSync(path.join(run.dir, 'dashboard.html'));
  const result = write(run, { nodes: { analysis: { status: 'running' } } });
  assert.equal(fs.existsSync(path.join(run.dir, 'dashboard.html')), false);
  assert.doesNotMatch(result.stdout, /^dashboard\.html$/m);
});

test('viewer: a link already named dashboard.html is left alone, dangling or not, and the freeze lands', t => {
  const run = scratch(t);
  const link = path.join(run.dir, 'dashboard.html');
  fs.symlinkSync(path.join(run.dir, 'missing-dir', 'dashboard.html'), link);
  const result = verb(['write-state', `--state=${run.state}`], FROZEN());
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readState(run).workflow.name, 'development');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.existsSync(path.join(run.dir, 'missing-dir')), false, 'nothing was written through the link');
  assert.match(result.stdout, /^Maister run started: /m);
});

/** The folders directly under the run directory, sorted; `display/` is the writer's own. */
const foldersOf = run => fs.readdirSync(run.dir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== 'display').map(entry => entry.name).sort();

test('folders: the freeze creates the folder every declared artifact opens with, and no directory artifact', t => {
  const run = scratch(t);
  const result = write(run, freezePatch({ definition: DEVELOPMENT, inputs: { task_description: 'Tag the notes' } }).patch);
  assert.deepEqual(foldersOf(run), ['analysis', 'documentation', 'implementation', 'verification']);
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/design-context')), false, 'a directory artifact is the step\'s to write');
  assert.deepEqual(fs.readdirSync(path.join(run.dir, 'implementation')), [], 'a folder only, nothing in it');
  assert.doesNotMatch(result.stdout, /^(analysis|implementation)\/?$/m, 'folders are not reported as changed files');
});

test('folders: a project\'s own workflow gets the folders it declares; a sub-run\'s and a bare path\'s are left out', t => {
  const run = scratch(t, { type: 'audits', name: '2026-01-05-release-audit' });
  const home = path.join(run.root, '.maister/workflows');
  fs.cpSync(path.join(FIXTURES, 'custom-workflow'), home, { recursive: true });
  write(run, freezePatch({ definition: path.join(home, 'release-audit.yml'), inputs: { release: 'v2.4.0' } }).patch);
  // intake/brief.md, outputs/audit-summary.md and outputs/evidence; the sub-run's `findings` is the child's.
  assert.deepEqual(foldersOf(run), ['intake', 'outputs']);
  assert.equal(fs.existsSync(path.join(run.dir, 'outputs/evidence')), false);
});

test('folders: a first segment that is itself a declared artifact is not created', t => {
  const run = scratch(t);
  const definition = path.join(run.root, 'bundle.yml');
  fs.writeFileSync(definition, [
    'name: development', 'version: 1', 'nodes:',
    '  pack:', '    uses: "direct:pack"', '    needs: []', '    outputs: {artifacts: {bundle: bundle}}',
    '  note:', '    uses: "direct:note"', '    needs: [pack]', '    outputs: {artifacts: {readme: bundle/readme.md, notes: notes/today.md}}', '',
  ].join('\n'));
  fs.writeFileSync(path.join(run.root, 'bundle.md'), '# Bundle — node prose\n\n## `pack`\n\nP.\n\n## `note`\n\nN.\n');
  write(run, freezePatch({ definition }).patch);
  assert.deepEqual(foldersOf(run), ['notes'], 'bundle is the pack step\'s directory artifact');
});

test('folders: an existing folder keeps what it holds, and a later write creates none', t => {
  const run = scratch(t);
  fs.mkdirSync(path.join(run.dir, 'analysis'));
  fs.writeFileSync(path.join(run.dir, 'analysis/notes.md'), '# the operator\'s own\n');
  write(run, FROZEN());
  assert.equal(fs.readFileSync(path.join(run.dir, 'analysis/notes.md'), 'utf8'), '# the operator\'s own\n');
  fs.rmSync(path.join(run.dir, 'analysis'), { recursive: true });
  write(run, { nodes: { analysis: { status: 'running' } } });
  assert.deepEqual(foldersOf(run), [], 'the freeze alone creates folders');
});

test('banner: a title spanning lines is folded onto the Task line', t => {
  const run = scratch(t);
  // The writer refuses a newline in a title it is sent, so only a file written
  // by hand can carry one: a literal block scalar.
  fs.writeFileSync(run.state, 'task:\n  title: |\n    Fix the parser\n      and the lexer\n  status: in_progress\n');
  const result = verb(['write-state', `--state=${run.state}`], { workflow: freezePatch().patch.workflow });
  assert.equal(result.code, 0, result.stderr);
  const banner = result.stdout.split('\n\n')[0];
  assert.equal(banner.split('\n').length, 7, banner);
  assert.match(banner, /^Task: Fix the parser and the lexer$/m);
});

test('banner: the freeze records the task-items fallback as an empty map', t => {
  const run = scratch(t);
  freeze(run);
  assert.match(fs.readFileSync(run.state, 'utf8'), /^ {2}task_ids: \{\}$/m);
});

test('banner: task ids the patch supplies are kept', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { task_ids: { analysis: '7' } } });
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /^ {2}task_ids: \{\}$/m);
});

test('banner: a freeze with no task title prints the untitled line', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  delete patch.task.title;
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Task: \(untitled\)$/m);
  assert.match(result.stdout, /^First phase: Scope analysis$/m);
});

test('banner: a later task_ids write merges into the seeded empty map', t => {
  const run = scratch(t);
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.task_ids, {});
  write(run, { orchestrator: { task_ids: { analysis: '7' } } });
  write(run, { orchestrator: { task_ids: { design: '8' } } });
  assert.deepEqual(readState(run).orchestrator.task_ids, { analysis: '7', design: '8' });
});

test('nodes: a status change stamps its clock field and leaves every other entry byte-identical', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  write(run, { nodes: { analysis: { status: 'running' } } });
  let state = readState(run);
  assert.match(state.workflow.nodes.analysis.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(state.workflow.nodes.analysis.completed, undefined);

  write(run, { nodes: { analysis: { status: 'completed' } } });
  state = readState(run);
  assert.equal(state.workflow.nodes.analysis.status, 'completed');
  assert.ok(state.workflow.nodes.analysis.completed >= state.workflow.nodes.analysis.started);

  const untouched = line => line.startsWith('    approval:') || line.startsWith('    research:');
  const after = fs.readFileSync(run.state, 'utf8');
  assert.deepEqual(after.split('\n').filter(untouched), before.split('\n').filter(untouched));
});

/** A UTC stamp in the writer's spelling, read from this process's clock. */
const clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const STALE = '2020-01-01T00:00:00Z';
const NOTE = /^note: ignored the supplied (.+); the writer stamps these from its own clock$/m;

/** Replace one line of the state file, the way a stale earlier write would have left it. */
function edit(run, from, to) {
  const text = fs.readFileSync(run.state, 'utf8');
  assert.ok(from.test(text), `no line matching ${from} to edit`);
  fs.writeFileSync(run.state, text.replace(from, to));
}

test('stamps: a started the patch supplies is ignored, the node gets the writer\'s clock, and the drop is noted', t => {
  const run = scratch(t);
  freeze(run);
  const before = clock();
  const result = write(run, { nodes: { analysis: { status: 'running', started: STALE } } });
  const { started } = readState(run).workflow.nodes.analysis;
  assert.match(started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.notEqual(started, STALE);
  assert.ok(started >= before, `${started} is earlier than the write`);
  assert.equal(result.stderr.match(NOTE)?.[1], 'workflow.nodes.analysis.started');
});

test('stamps: a completed supplied with the completion is ignored', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  const result = write(run, { nodes: { analysis: { status: 'completed', completed: STALE } } });
  const node = readState(run).workflow.nodes.analysis;
  assert.notEqual(node.completed, STALE);
  assert.ok(node.completed >= node.started);
  assert.equal(result.stderr.match(NOTE)?.[1], 'workflow.nodes.analysis.completed');
});

test('stamps: orchestrator.updated moves forward on every write, whatever the patch says', t => {
  const run = scratch(t);
  freeze(run);
  edit(run, /^  updated: .*$/m, `  updated: "${STALE}"`);
  const before = clock();
  const quiet = write(run, {});
  assert.ok(readState(run).orchestrator.updated >= before, 'an empty write re-stamps updated');
  assert.doesNotMatch(quiet.stderr, NOTE, 'a patch carrying no clock field is not noted');

  edit(run, /^  updated: .*$/m, `  updated: "${STALE}"`);
  const result = write(run, { orchestrator: { updated: STALE }, nodes: { analysis: { status: 'running' } } });
  assert.ok(readState(run).orchestrator.updated >= before, 'a supplied updated does not pin the clock');
  assert.equal(result.stderr.match(NOTE)?.[1], 'orchestrator.updated');
});

test('stamps: a running node written running again keeps its started', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  edit(run, /started: "?[^,"}]+"?/, `started: "${STALE}"`);
  write(run, { nodes: { analysis: { status: 'running', values: { note: 'still going' } } } });
  const node = readState(run).workflow.nodes.analysis;
  assert.equal(node.started, STALE, 'a rewrite that is not a transition keeps the recorded start');
  assert.deepEqual(node.values, { note: 'still going' });
});

test('stamps: a node re-driven after it failed starts a new clock and drops the old completion', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  write(run, { nodes: { analysis: { status: 'failed' } } });
  edit(run, /started: "?[^,"}]+"?/, `started: "${STALE}"`);
  const before = clock();
  write(run, { nodes: { analysis: { status: 'running' } } });
  const node = readState(run).workflow.nodes.analysis;
  assert.ok(node.started >= before, 'the re-drive is a new attempt');
  assert.equal(node.completed, undefined, 'a running node carries no completion');
});

test('orchestrator.options merges key by key: a later option write keeps html_output', t => {
  const run = scratch(t);
  freeze(run, { inputs: { ticket: 'ALPHA-1' } });
  write(run, { orchestrator: { options: { html_output: false } } });
  write(run, { orchestrator: { options: { spec_audit_enabled: true } } });
  const options = readState(run).orchestrator.options;
  assert.equal(options.html_output, false);
  assert.equal(options.spec_audit_enabled, true);
  assert.deepEqual(options.inputs, { ticket: 'ALPHA-1' });
});

test('phase_summaries: lands in the workflow\'s own context block and merges entry by entry', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    phase_summaries: { analysis: { node: 'analysis', status: 'completed', summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } },
  });
  write(run, {
    phase_summaries: { implementation: { node: 'implementation', status: 'in_progress', summary: 'Wave 1.' } },
    context: { risk_level: 'low' },
  });
  const state = readState(run);
  assert.deepEqual(Object.keys(state.task_context.phase_summaries), ['analysis', 'implementation']);
  assert.deepEqual(state.task_context.phase_summaries.analysis.decisions, ['keep the parser']);
  assert.equal(state.task_context.risk_level, 'low');
});

test('a context write on a fresh freeze seeds an empty phase_summaries map', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  assert.deepEqual(readState(run).task_context.phase_summaries, {});
});

test('a state no freeze proves keeps its unknown blocks, options and comments', t => {
  const run = scratch(t, { fixture: 'unproven' });
  write(run, { nodes: { approval: { status: 'completed' } }, orchestrator: { options: { html_output: false } } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^# A workflow block no freeze proves/);
  const state = readState(run);
  assert.deepEqual(state.project_context, { tech_stack: 'node', notes: 'kept through every write' });
  assert.equal(state.orchestrator.started_phase, 'analysis');
  assert.deepEqual(state.orchestrator.completed_phases, ['analysis']);
  assert.deepEqual(state.orchestrator.options, { html_output: false, mockup_format: 'html' });
  assert.equal(state.workflow.nodes.analysis.status, 'completed');
});

test('an open map written by hand as a block map is refused, never flattened or edited in place', t => {
  const run = scratch(t, { fixture: 'unproven' });
  const text = fs.readFileSync(run.state, 'utf8')
    .replace('  options: {html_output: true, mockup_format: html}\n', '  options:\n    html_output: true\n    mockup_format: html\n');
  fs.writeFileSync(run.state, text);
  const result = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { html_output: false } } });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^state-unreadable: orchestrator\.options is written as a block map/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), text, 'a refusal leaves the file byte-identical');
});

test('node_summaries: a summary written after its node ended mirrors the recorded status', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.' } } });
  write(run, { node_summaries: { analysis: { summary: 'Scoped, and confirmed.' } } });
  assert.deepEqual(readState(run).node_summaries.analysis, { summary: 'Scoped, and confirmed.', status: 'completed' });
});

test('node_summaries: a node ending after its summary was written updates the summary status', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'running' } } });
  write(run, { node_summaries: { analysis: { summary: 'Scoped.' } } });
  assert.equal(readState(run).node_summaries.analysis.status, 'in_progress');
  write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.deepEqual(readState(run).node_summaries.analysis, { summary: 'Scoped.', status: 'completed' });
});

test('node_summaries: a status the summary states itself is kept', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  write(run, { node_summaries: { analysis: { summary: 'Scoped.', status: 'failed' } } });
  assert.equal(readState(run).node_summaries.analysis.status, 'failed');
});

/** Put a file into the run directory, creating its folder. */
function place(run, relative) {
  const file = path.join(run.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${relative}\n`);
}

test('a completing summary registers the node\'s declared artifact and its companion', t => {
  const run = scratch(t);
  freeze(run);
  place(run, 'analysis/report.md');
  place(run, 'analysis/report.html');
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.' } } });
  const expected = [{ path: 'analysis/report.md', label: null, html: 'analysis/report.html' }];
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts, expected);
  assert.deepEqual(readDashboard(run).phases.find(phase => phase.id === 'analysis').artifacts, expected);
});

test('a registered report gains its companion; a running node and a missing file register nothing', t => {
  const run = scratch(t);
  freeze(run);
  place(run, 'analysis/report.md');
  write(run, { nodes: { analysis: { status: 'running' } }, node_summaries: { analysis: { summary: 'Working.' } } });
  assert.equal(Object.hasOwn(readState(run).node_summaries.analysis, 'artifacts'), false);
  place(run, 'analysis/report.html');
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { summary: 'Scoped.', artifacts: [{ path: 'analysis/report.md', label: 'Report', html: null }] } },
  });
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts,
    [{ path: 'analysis/report.md', label: 'Report', html: 'analysis/report.html' }]);

  const bare = scratch(t);
  freeze(bare);
  write(bare, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Nothing written.' } } });
  assert.equal(Object.hasOwn(readState(bare).node_summaries.analysis, 'artifacts'), false);
});

test('with html_output off the declared artifact is registered without a companion', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { options: { html_output: false } } });
  place(run, 'analysis/report.md');
  place(run, 'analysis/report.html');
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'Scoped.' } } });
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts,
    [{ path: 'analysis/report.md', label: null, html: null }]);
});

test('a completing summary registers a declared directory, and gives it no companion', t => {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: { subject: 'acme-api' } });
  place(run, 'analysis/evidence/replay.txt');
  place(run, 'analysis/notes.md');
  place(run, 'analysis/notes.html');
  write(run, {
    nodes: { scan: { status: 'completed', values: { blocking: false } } },
    node_summaries: { scan: { summary: 'Scanned.' } },
  });
  assert.deepEqual(readState(run).node_summaries.scan.artifacts, [
    { path: 'analysis/notes.md', label: null, html: 'analysis/notes.html' },
    { path: 'analysis/evidence', label: null, html: null },
  ]);
});

test('an empty patch is a sanctioned republish; empty stdin is a usage failure', t => {
  const run = scratch(t);
  freeze(run);
  assert.equal(verb(['write-state', `--state=${run.state}`], {}).code, 0);
  const empty = verb(['write-state', `--state=${run.state}`], '');
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /^usage: the patch on stdin is empty/);
});

test('refusal: phase_summaries nested under context', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { context: { phase_summaries: { analysis: { summary: 'x' } } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
  assert.match(result.stderr, /top-level phase_summaries/);
});

test('refusal: a patch key outside the closed vocabulary', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { nodez: { analysis: { status: 'running' } } });
  assert.match(result.stderr, /^state-patch-unknown-key\b/);
});

test('context: a workflow of its own name writes into <name>_context, with the node status the patch carried', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ definition: DECLARED, inputs: { subject: 'acme-api' } });
  write(run, { ...patch, context: { risk_level: 'low' } });
  write(run, {
    nodes: { scan: { status: 'running' } },
    phase_summaries: { scanning: { node: 'scan', summary: 'Scanning the api.', decisions: ['scan the api only'], risks: [] } },
  });
  const state = readState(run);
  assert.equal(state.workflow.name, 'survey');
  assert.equal(state.survey_context.risk_level, 'low');
  assert.deepEqual(Object.keys(state.survey_context.phase_summaries), ['scanning']);
  assert.deepEqual(state.survey_context.phase_summaries.scanning.decisions, ['scan the api only']);
  assert.equal(state.workflow.nodes.scan.status, 'running');
});

test('context: a dashed workflow name derives its block with the dashes as underscores', t => {
  const run = scratch(t, { type: 'closing-child' });
  freeze(run, { definition: CLOSING_CHILD, inputs: { subject: 'acme-api' } });
  write(run, { context: { scope: 'api' } });
  assert.deepEqual(readState(run).closing_child_context, { phase_summaries: {}, scope: 'api' });
});

test('context: every name a built-in run is recorded under keeps the block it always derived', t => {
  const expected = {
    development: 'task_context',
    'product-design': 'design_context',
    design: 'design_context',
    research: 'research_context',
    performance: 'performance_context',
    migration: 'migration_context',
    task: 'task_context',
  };
  for (const [name, block] of Object.entries(expected)) {
    const run = renamed(t, name);
    write(run, { context: { probe: name } });
    const state = readState(run);
    assert.equal(state[block]?.probe, name, `${name} derives ${block}`);
    assert.deepEqual(Object.keys(state).filter(key => key.endsWith('_context')), ['project_context', block], name);
  }
});

test('context: a workflow named like a prototype member derives an ordinary block', t => {
  const run = renamed(t, 'constructor');
  write(run, { context: { probe: 'x' } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^constructor_context:$/m);
  assert.doesNotMatch(text, /function Object/);
});

test('context: a file with one derived block and no workflow name writes into that block', t => {
  const run = renamed(t, 'survey');
  write(run, { context: { first: 'x' } });
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace(/^ {2}name: .*\n/m, ''));
  write(run, { context: { second: 'y' } });
  const state = readState(run);
  assert.equal(state.workflow.name, undefined);
  assert.deepEqual(state.survey_context, { phase_summaries: {}, first: 'x', second: 'y' });
});

test('refusal: a workflow name whose block the state file reserves', t => {
  for (const name of ['project', 'verification']) {
    const run = renamed(t, name);
    const result = refused(run, { context: { probe: 'x' } });
    assert.match(result.stderr, /^state-context-block-unknown\b/);
    assert.match(result.stderr, new RegExp(`derives ${name}_context\\b`));
    assert.match(result.stderr, /rename the workflow/);
  }
});

test('refusal: a workflow name outside the grammar\'s character set derives no block', t => {
  for (const name of ['Acme Tool', '__proto__', 'toString']) {
    const run = renamed(t, name);
    const result = refused(run, { phase_summaries: { scanning: { summary: 'x' } } });
    assert.match(result.stderr, /^state-context-block-unknown\b/);
    assert.match(result.stderr, /character set/);
  }
});

test('refusal: a workflow name whose block would be a second one', t => {
  const run = renamed(t, 'development');
  write(run, { context: { probe: 'x' } });
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace(/^ {2}name: .*$/m, '  name: survey'));
  const result = refused(run, { context: { probe: 'y' } });
  assert.match(result.stderr, /^state-context-block-unknown\b/);
  assert.match(result.stderr, /derives survey_context but the state file already carries task_context/);
});

test('refusal: a workflow block without a task block', t => {
  const run = scratch(t);
  const result = refused(run, { workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } } });
  assert.match(result.stderr, /^state-workflow-without-task\b/);
});

test('refusal: a node id the graph grammar would never produce', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { nodes: { __proto__x: { status: 'running' } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
});

test('refusal: a summary key that would spill onto its own lines', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { phase_summaries: { 'design: draft': { summary: 'x' } } });
  assert.match(result.stderr, /^state-patch-invalid\b/);
});

/** Every frozen node re-typed as its bare kind — the shape of a re-sent freeze. */
function retyped(graph) {
  return Object.fromEntries(graph.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
}

test('refusal: a workflow patch after the freeze that drops frozen nodes', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } } });
  const result = refused(run, { workflow: { name: 'development', nodes: { analysis: { kind: 'direct', status: 'completed' } } } });
  assert.match(result.stderr, /^state-workflow-frozen\b/);
  assert.match(result.stderr, /approval/, 'the message names the nodes the patch would drop');
  assert.match(result.stderr, /top-level `nodes` key/);
});

test('refusal: a workflow patch after the freeze that re-types every node would reset recorded progress', t => {
  const run = scratch(t);
  const graph = freeze(run);
  write(run, { nodes: { analysis: { status: 'completed', values: { x: true } } } });
  const result = refused(run, { workflow: { name: 'development', nodes: retyped(graph) } });
  assert.match(result.stderr, /^state-workflow-frozen\b/);
  assert.match(result.stderr, /analysis/, 'the message names the node whose record differs');
  assert.match(result.stderr, /top-level `nodes` key/);
  assert.equal(readState(run).workflow.nodes.analysis.status, 'completed');
});

test('refusal: a workflow patch after the freeze that adds a node no graph declares', t => {
  const run = scratch(t);
  const graph = freeze(run);
  const result = refused(run, { workflow: { name: 'development', nodes: { ...retyped(graph), ghost: { kind: 'direct', status: 'completed' } } } });
  assert.match(result.stderr, /^state-workflow-frozen\b/);
  assert.match(result.stderr, /ghost/);
});

test('refusal: a workflow patch after the freeze that changes a frozen scalar', t => {
  const run = scratch(t);
  const graph = freeze(run);
  const result = refused(run, { workflow: { name: 'development', graph_hash: 'sha256:0000', nodes: retyped(graph) } });
  assert.match(result.stderr, /^state-workflow-frozen\b/);
  assert.match(result.stderr, /graph_hash/);
});

test('write-state: an identical re-send of the frozen workflow block changes nothing', t => {
  const run = scratch(t);
  const graph = freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = write(run, { workflow: { name: 'development', graph_hash: graph.graph_hash, grammar_version: 1, nodes: retyped(graph) } });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^workflow/m, 'nothing under workflow is reported changed');
  assert.equal(unstamped(fs.readFileSync(run.state, 'utf8')), unstamped(before));
});

test('refusal: a workflow block without nodes says where node updates go', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { workflow: { name: 'development' } });
  assert.match(result.stderr, /^state-workflow-without-nodes\b/);
  assert.match(result.stderr, /top-level `nodes` key/);
});

// ---------------------------------------------------------------------------
// the record only moves forward, and a gate that can revise says where to
// ---------------------------------------------------------------------------

const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

test('freeze: a gate that offers a revise records where each revise option sends the run', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const nodes = readState(run).workflow.nodes;
  assert.deepEqual(nodes['review-approval'], { kind: 'gate', status: 'pending', needs: ['review'], reruns: { 'send-back': 'draft' } });
  assert.deepEqual(nodes['final-approval'].reruns, { 'redo-draft': 'draft' });
  assert.equal(Object.hasOwn(nodes.draft, 'reruns'), false, 'only a gate with a revise option carries reruns');
  assert.match(fs.readFileSync(run.state, 'utf8'),
    /^ {4}review-approval: \{kind: gate, status: pending, needs: \[review\], reruns: \{send-back: draft\}\}$/m);
});

test('write-state: an identical re-send of a freeze that recorded reruns changes nothing', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ definition: REVISE });
  write(run, patch);
  const before = unstamped(fs.readFileSync(run.state, 'utf8'));
  const again = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(unstamped(fs.readFileSync(run.state, 'utf8')), before);
});

test('refusal: an ordinary write never sends an ended node back to pending (state-node-regressed)', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  for (const ended of ['completed', 'failed', 'skipped', 'stopped']) {
    write(run, { nodes: { draft: { status: 'running' } } });
    write(run, { nodes: { draft: { status: ended } } });
    const before = fs.readFileSync(run.state, 'utf8');
    const result = verb(['write-state', `--state=${run.state}`], { nodes: { draft: { status: 'pending' } } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`^state-node-regressed: node draft is recorded ${ended}`));
    assert.match(result.stderr, /gate-revise/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'a refusal leaves the file byte-identical');
  }
  // A re-drive is not a regression: it goes running and gets a new clock.
  write(run, { nodes: { draft: { status: 'running' } } });
  assert.equal(readState(run).workflow.nodes.draft.status, 'running');
});

test('write-state: attempt and reruns are the writer\'s own, and a patch that sends them is ignored', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const result = verb(['write-state', `--state=${run.state}`],
    { nodes: { draft: { status: 'running', attempt: 9 }, 'review-approval': { reruns: { 'send-back': 'review' } } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /workflow\.nodes\.draft\.attempt/);
  assert.match(result.stderr, /workflow\.nodes\.review-approval\.reruns/);
  const nodes = readState(run).workflow.nodes;
  assert.equal(Object.hasOwn(nodes.draft, 'attempt'), false);
  assert.deepEqual(nodes['review-approval'].reruns, { 'send-back': 'draft' });
});

test('write-state: a later answer at a revised gate keeps the revise decisions before it', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const revise = { option: 'send-back', answered_by: 'marek', at: '2026-01-05T09:00:00Z', attempt: 1, reruns: 'draft', note: 'Tighten the intro' };
  write(run, { node_summaries: { 'review-approval': { decisions: [revise] } } });
  const answer = { option: 'publish-draft', answered_by: 'marek', at: '2026-01-05T10:00:00Z' };
  write(run, { nodes: { 'review-approval': { status: 'completed' } }, node_summaries: { 'review-approval': { decisions: [answer] } } });
  // Each answer gains the label it was chosen by and who chose it, on the way in.
  const folded = decision => ({ ...decision, decision: decision.option === 'send-back' ? 'Send back with notes' : 'Publish', by: 'operator' });
  assert.deepEqual(readState(run).node_summaries['review-approval'].decisions, [folded(revise), folded(answer)]);

  // Re-sending the whole list does not duplicate it.
  write(run, { node_summaries: { 'review-approval': { decisions: [revise, answer] } } });
  assert.deepEqual(readState(run).node_summaries['review-approval'].decisions, [folded(revise), folded(answer)]);
});

// ---------------------------------------------------------------------------
// a node summary merges field by field, and the user's answers are history
// ---------------------------------------------------------------------------

/** An in-node answer as a node records it. */
function answered(id, answer, asRecommended = true) {
  return { decision: answer, by: 'operator', answered_by: 'marek', via: 'terminal', question_id: id, question: `Which ${id}?`, answer, as_recommended: asRecommended };
}

test('write-state: a later write retagging one risk keeps the summary, the artifacts and every answer', t => {
  const run = scratch(t);
  freeze(run);
  const answers = [answered('scope', 'Tags only'), answered('ids', 'Keep ids'), answered('csv', 'Strict CRLF', false), answered('copy', 'Return copies')];
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: {
      analysis: {
        headline: 'The store returns live notes.',
        summary: 'Mapped the store.',
        decisions: [{ decision: 'Tags live in the store', by: 'run' }, ...answers],
        risks: [{ risk: 'update() returns the live note', tag: 'open', change: 'return a copy' }],
        artifacts: [{ path: 'analysis/report.md', label: 'Report', html: null, role: 'primary' }],
      },
    },
  });
  const before = readState(run).node_summaries.analysis;

  // A later node settles the risk and sends only that field, as the resolved-risk rule has it.
  const result = write(run, { node_summaries: { analysis: { risks: [{ risk: 'update() returns the live note', tag: 'resolved' }] } } });
  assert.equal(result.code, 0, result.stderr);
  const after = readState(run).node_summaries.analysis;
  assert.deepEqual(after.risks, [{ risk: 'update() returns the live note', tag: 'resolved' }], 'the field sent replaces that field whole');
  for (const field of ['headline', 'summary', 'decisions', 'artifacts', 'status']) {
    assert.deepEqual(after[field], before[field], `${field} is kept`);
  }
});

test('write-state: a write of a node\'s decisions keeps the answers it leaves out, and a re-asked question replaces its own', t => {
  const run = scratch(t);
  freeze(run);
  const first = [{ decision: 'Patch the tokenizer', by: 'run' }, answered('scope', 'Tags only'), answered('csv', 'Strict CRLF', false)];
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'First pass.', decisions: first } } });

  // The node runs again: it records what it settled this time and asks one question again.
  const again = [{ decision: 'Patch the lexer instead', by: 'run' }, answered('csv', 'LF')];
  write(run, { node_summaries: { analysis: { summary: 'Second pass.', decisions: again } } });
  assert.deepEqual(readState(run).node_summaries.analysis.decisions, [answered('scope', 'Tags only'), ...again],
    'the unasked answer is kept ahead of the new list; the re-asked one is replaced; the run\'s own decision is replaced');

  // Sending the whole list again duplicates nothing.
  write(run, { node_summaries: { analysis: { decisions: readState(run).node_summaries.analysis.decisions } } });
  assert.deepEqual(readState(run).node_summaries.analysis.decisions, [answered('scope', 'Tags only'), ...again]);
});

test('write-state: answers sharing one question_id are different answers when their questions differ', t => {
  const run = scratch(t);
  freeze(run);
  // One id on every question of a page, as a model may write it.
  const onPage = (question, answer) => ({ ...answered('clarifications', answer), question: `${question}?` });
  const first = [onPage('Which scope', 'Tags only'), onPage('Which ids', 'Keep ids'), onPage('Which line endings', 'Strict CRLF'), onPage('Which copies', 'Return copies')];
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'First pass.', decisions: first } } });

  // The node runs again and asks one of the four again.
  const again = [onPage('Which line endings', 'LF')];
  write(run, { node_summaries: { analysis: { summary: 'Second pass.', decisions: again } } });
  assert.deepEqual(readState(run).node_summaries.analysis.decisions, [first[0], first[1], first[3], ...again],
    'the three not asked again are kept; the re-asked one is replaced by its new answer');
});

test('write-state: an exact re-ask replaces its answer, with or without a question_id', t => {
  const run = scratch(t);
  freeze(run);
  const bare = (question, answer) => ({ decision: answer, by: 'operator', answered_by: 'marek', via: 'terminal', question, answer, as_recommended: true });
  const first = [answered('csv', 'Strict CRLF', false), bare('Which scope?', 'Tags only'), bare('Which ids?', 'Keep ids')];
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'First pass.', decisions: first } } });

  const again = [answered('csv', 'LF'), bare('Which scope?', 'Tags and notes')];
  write(run, { node_summaries: { analysis: { summary: 'Second pass.', decisions: again } } });
  assert.deepEqual(readState(run).node_summaries.analysis.decisions, [first[2], ...again],
    'the same id and question replaces; the same question text replaces an answer that has no id, whatever was answered');
});

test('write-state: a gate answer written flat on the summary is folded into its decisions', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const result = write(run, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { answer: 'publish-draft', answered_by: 'user', at: '2026-01-05T10:00:00Z' } },
  });
  assert.equal(result.code, 0, result.stderr);
  const summary = readState(run).node_summaries['review-approval'];
  assert.deepEqual(summary.decisions, [{
    option: 'publish-draft', answered_by: OPERATOR, via: 'terminal', at: '2026-01-05T10:00:00Z', decision: 'Publish', by: 'operator',
  }]);
  for (const field of ['answer', 'answered_by', 'at']) assert.equal(Object.hasOwn(summary, field), false, `no flat ${field} is left`);
});

test('write-state: a flat answer that is not one of the gate\'s options is refused like any other', t => {
  const run = scratch(t);
  freeze(run, { definition: REVISE });
  const result = refused(run, { node_summaries: { 'review-approval': { answer: 'ship-it' } } });
  assert.match(result.stderr, /state-gate-option-unknown/);
});

test('write-state: an answer naming nobody, or a placeholder, is stamped with the operator; a name is kept', t => {
  const run = scratch(t);
  freeze(run);
  const asked = (id, who) => ({ decision: 'Yes', by: 'operator', question_id: id, question: 'Proceed?', answer: 'Yes', ...(who === undefined ? {} : { answered_by: who }) });
  write(run, {
    node_summaries: { analysis: { decisions: [asked('a'), asked('b', 'user'), asked('c', 'Operator'), asked('d', 'you'), asked('e', '@marek'), { decision: 'Kept', by: 'run' }] } },
  });
  const stored = readState(run).node_summaries.analysis.decisions;
  assert.deepEqual(stored.slice(0, 4).map(item => [item.answered_by, item.via]), Array(4).fill([OPERATOR, 'terminal']));
  assert.equal(stored[4].answered_by, '@marek', 'a name the answer carries is kept');
  assert.equal(Object.hasOwn(stored[4], 'via'), false);
  assert.deepEqual(stored[5], { decision: 'Kept', by: 'run' }, 'a decision the run made names nobody');
});

test('write-state: under a cockpit or a dispatch driver an answer naming nobody is stamped with that driver; a via it carries is kept', t => {
  for (const kind of ['cockpit', 'dispatch']) {
    const run = scratch(t);
    freeze(run, { orchestrator: { driver: { kind, cwd: '/work' } } });
    const asked = (id, via) => ({ decision: 'Yes', by: 'operator', question_id: id, question: 'Proceed?', answer: 'Yes', ...(via === undefined ? {} : { via }) });
    write(run, { node_summaries: { analysis: { decisions: [asked('a'), asked('b', 'terminal')] } } });
    const stored = readState(run).node_summaries.analysis.decisions;
    assert.deepEqual(stored.map(item => [item.answered_by, item.via]), [[OPERATOR, kind], [OPERATOR, 'terminal']], kind);
  }
});

test('write-state: a gate answer under a cockpit or a dispatch driver is stamped with that driver', t => {
  for (const kind of ['cockpit', 'dispatch']) {
    const run = scratch(t);
    freeze(run, { definition: REVISE, orchestrator: { driver: { kind, cwd: '/work' } } });
    const result = write(run, {
      nodes: { 'review-approval': { status: 'completed' } },
      node_summaries: { 'review-approval': { decisions: [{ option: 'publish-draft' }] } },
    });
    assert.equal(result.code, 0, result.stderr);
    const [stored] = readState(run).node_summaries['review-approval'].decisions;
    assert.deepEqual([stored.answered_by, stored.via], [OPERATOR, kind], kind);
  }
});

test('write-state: under a terminal driver an answer naming nobody is stamped terminal', t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'terminal' } } });
  write(run, { node_summaries: { analysis: { decisions: [{ decision: 'Yes', by: 'operator', question_id: 'a', question: 'Proceed?', answer: 'Yes' }] } } });
  const [stored] = readState(run).node_summaries.analysis.decisions;
  assert.deepEqual([stored.answered_by, stored.via], [OPERATOR, 'terminal']);
});

// ---------------------------------------------------------------------------
// typed summary items: headline, decisions by source, risks by tag, roles, metrics
// ---------------------------------------------------------------------------

test('write-state: decision_areas is refused in any shape but one map per area, on a node or a phase summary', t => {
  const run = scratch(t);
  freeze(run);
  for (const patch of [
    { phase_summaries: { analysis: { node: 'analysis', decision_areas: ['gather', 'synthesize'] } } },
    { node_summaries: { analysis: { decision_areas: 'storage' } } },
    { node_summaries: { analysis: { decision_areas: [{ alternatives_count: 3 }] } } },
  ]) {
    const result = refused(run, patch);
    assert.match(result.stderr, /state-summary-item-invalid/);
  }
  const areas = [{ area: 'Storage', alternatives_count: 3, chosen_approach: 'Keep the Map private' }];
  assert.equal(write(run, { phase_summaries: { analysis: { node: 'analysis', decision_areas: areas } } }).code, 0);
});

test('write-state: a summary takes a headline, typed decisions and risks, artifact roles and metrics, and keeps them as sent', t => {
  const run = scratch(t);
  freeze(run);
  const summary = {
    status: 'completed',
    headline: 'Two gaps found; the tokenizer patch closes both.',
    summary: 'Two gaps found in the parser.',
    decisions: [
      'Patch the tokenizer',
      { decision: 'Strict CRLF', by: 'operator', answered_by: 'marek', at: '2026-10-05T16:30:02Z', via: 'terminal', question_id: 'csv-line-endings',
        question: 'Which line endings?', answer: 'Strict CRLF', recommended: 'LF', as_recommended: false },
      { decision: 'Run the audit', by: 'default', question_id: 'audit-opt-in' },
      { decision: 'Reject null elements', by: 'audit', rationale: 'audit finding, settled', triage: { mode: 'consult' } },
    ],
    risks: ['open: the corpus is thin', { risk: 'A null element still throws', tag: 'open', change: 'treat it like a missing tag' }, { risk: 'Ships under 1.0.0', tag: 'tradeoff' }],
    artifacts: [{ path: 'analysis/report.md', label: 'Report', html: null, role: 'primary' }],
    metrics: [{ label: 'Tests', value: 40, of: 40 }, { label: 'Coverage', value: '92', unit: '%' }],
    fixes_applied: [{ finding: 'The parser dropped a trailing comma', change: 'Kept the comma' }, { change: 'Trimmed the tag once' }, 'released the lock'],
  };
  const result = write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: summary } });
  assert.equal(result.code, 0, result.stderr);
  const stored = readState(run).node_summaries.analysis;
  assert.equal(stored.headline, summary.headline);
  assert.deepEqual(stored.decisions, summary.decisions, 'every item kept as sent, strings included');
  assert.deepEqual(stored.fixes_applied, summary.fixes_applied, 'a fix kept as sent, whichever of its two it names');
  assert.deepEqual(stored.risks, summary.risks);
  assert.deepEqual(stored.metrics, summary.metrics);
  assert.equal(stored.artifacts[0].role, 'primary');
});

for (const [label, entry, at] of [
  ['an unknown decision source', { summary: 'S.', decisions: [{ decision: 'x', by: 'agent' }] }, /decisions\[0\]\.by is "agent", which is not one of operator, run, audit, default/],
  ['an unknown risk tag', { summary: 'S.', risks: [{ risk: 'x', tag: 'blocker' }] }, /risks\[0\]\.tag is "blocker", which is not one of open, tradeoff, followup, stop, resolved/],
  ['a risk object with no tag', { summary: 'S.', risks: [{ risk: 'x' }] }, /risks\[0\]\.tag is null/],
  ['a headline over 220 characters', { summary: 'S.', headline: 'x'.repeat(221) }, /headline is "x+", which is not one non-empty sentence on one line, at most 220 characters/],
  ['an unknown artifact role', { summary: 'S.', artifacts: [{ path: 'a.md', role: 'draft' }] }, /artifacts\[0\]\.role is "draft", which is not one of primary, review, evidence, log/],
  ['a metric with no value', { summary: 'S.', metrics: [{ label: 'Tests' }] }, /metrics\[0\] is/],
  ['an as_recommended that is not a boolean', { summary: 'S.', decisions: [{ decision: 'x', by: 'operator', as_recommended: 'yes' }] }, /as_recommended is "yes"/],
  ['fixes that are not a list', { summary: 'S.', fixes_applied: 'released the lock' }, /fixes_applied is "released the lock", which is not a list of \{finding, change\}/],
  ['a fix naming neither what was wrong nor what changed', { summary: 'S.', fixes_applied: [{ finding: 'x', change: 'y' }, { issue: 'z' }] }, /fixes_applied\[1\] is \{"issue":"z"\}, which is not a \{finding, change\} map/],
]) {
  test(`refusal: state-summary-item-invalid — ${label}`, t => {
    const run = scratch(t);
    freeze(run);
    const result = refused(run, { node_summaries: { analysis: entry } });
    assert.match(result.stderr, /^state-summary-item-invalid: node_summaries\.analysis\./);
    assert.match(result.stderr, at);
    assert.match(result.stderr, /Nothing was written/);
  });
}

test('refusal: state-summary-item-invalid holds for a context block\'s phase summaries too', t => {
  const run = scratch(t);
  freeze(run);
  const result = refused(run, { phase_summaries: { analysis: { node: 'analysis', summary: 'S.', risks: [{ risk: 'x', tag: 'later' }] } } });
  assert.match(result.stderr, /^state-summary-item-invalid: [a-z_]+\.phase_summaries\.analysis\.risks\[0\]\.tag/);
});

test('write-state: a gate answer gains the label it was chosen by and who chose it; one sent typed is kept', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: { summary: 'S.' } } });
  write(run, { nodes: { approval: { status: 'completed' } }, node_summaries: { approval: { decisions: [{ option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] } } });
  const [answer] = readState(run).node_summaries.approval.decisions;
  assert.equal(answer.option, 'continue');
  assert.equal(answer.by, 'operator');
  assert.equal(typeof answer.decision, 'string');
  assert.notEqual(answer.decision, '');
});

// ---------------------------------------------------------------------------
// a gate's values: recorded by the writer from the answer
// ---------------------------------------------------------------------------

const OPTIONAL_STEP = path.join(FIXTURES, 'definitions/optional-step.yml');

/** A run of the optional-step fixture with its specification written, its first gate the question now. */
function atSpecificationApproval(t) {
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL_STEP });
  write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  return run;
}

test('freeze: a gate whose continues set values records each option\'s map, beside its reruns', t => {
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL_STEP });
  const gate = readState(run).workflow.nodes['specification-approval'];
  assert.deepEqual(gate.sets, { 'continue-to-audit': { audit_enabled: true }, 'continue-to-planning': { audit_enabled: false } });
  assert.deepEqual(gate.reruns, { 'revise-specification': 'specification' });
  assert.equal(readState(run).workflow.nodes['audit-approval'].sets, undefined, 'a gate whose continue sets nothing records no sets');
  assert.match(fs.readFileSync(run.state, 'utf8'), /specification-approval: \{kind: gate, status: pending, needs: \[specification\], reruns: \{[^}]*\}, sets: \{/);
});

test('write-state: an answer records the values the chosen continue sets on the gate', t => {
  for (const [option, value] of [['continue-to-audit', true], ['continue-to-planning', false]]) {
    const run = atSpecificationApproval(t);
    write(run, {
      nodes: { 'specification-approval': { status: 'completed' } },
      node_summaries: { 'specification-approval': { answer: option } },
    });
    assert.deepEqual(readState(run).workflow.nodes['specification-approval'].values, { audit_enabled: value }, option);
  }
});

test('write-state: the gate values land when the answer and the status arrive in two writes', t => {
  const run = atSpecificationApproval(t);
  write(run, { node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-planning' }] } } });
  assert.equal(readState(run).workflow.nodes['specification-approval'].values, undefined, 'a gate still pending holds none');
  write(run, { nodes: { 'specification-approval': { status: 'completed' } } });
  assert.deepEqual(readState(run).workflow.nodes['specification-approval'].values, { audit_enabled: false });
  // A later write to the gate keeps them.
  write(run, { nodes: { 'specification-approval': { status: 'completed' } } });
  assert.deepEqual(readState(run).workflow.nodes['specification-approval'].values, { audit_enabled: false });
});

test('refusal: state-gate-values-sent — a caller sending values on a gate', t => {
  const run = atSpecificationApproval(t);
  const result = refused(run, {
    nodes: { 'specification-approval': { status: 'completed', values: { audit_enabled: true } } },
    node_summaries: { 'specification-approval': { answer: 'continue-to-planning' } },
  });
  assert.match(result.stderr, /^state-gate-values-sent: this write sends values for the gate specification-approval, and a gate's values are the writer's own/);
});

test('write-state: a gate sent sets has them dropped and noted like any writer field', t => {
  const run = atSpecificationApproval(t);
  const result = verb(['write-state', `--state=${run.state}`],
    { nodes: { 'specification-approval': { status: 'running', sets: { 'continue-to-audit': { audit_enabled: false } } } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /workflow\.nodes\.specification-approval\.sets/);
  assert.deepEqual(readState(run).workflow.nodes['specification-approval'].sets['continue-to-audit'], { audit_enabled: true });
});

test('write-state: a skipped gate with sets records every value it could set false', t => {
  const run = atSpecificationApproval(t);
  write(run, { nodes: { 'specification-approval': { status: 'skipped' } } });
  assert.deepEqual(readState(run).workflow.nodes['specification-approval'].values, { audit_enabled: false });
});

test('gate-revise: a revise that resets an answered gate clears the values it recorded', t => {
  const run = atSpecificationApproval(t);
  write(run, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { answer: 'continue-to-audit' } },
  });
  write(run, { nodes: { audit: { status: 'completed' } }, node_summaries: { audit: { summary: 'Audited the specification.' } } });
  const result = verb(['gate-revise', `--state=${run.state}`, '--node=audit-approval', '--option=redo-specification'], { note: 'Narrow the scope' });
  assert.equal(result.code, 0, result.stderr);
  const gate = readState(run).workflow.nodes['specification-approval'];
  assert.equal(gate.status, 'pending');
  assert.equal(gate.values, undefined, 'the reset gate holds no values until it is answered again');
  assert.deepEqual(gate.sets['continue-to-planning'], { audit_enabled: false }, 'its sets survive the reset');
});

test('write-state: a closing node may recommend a continue of the gate that waits on it', t => {
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL_STEP });
  write(run, {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote it.', recommends: { option: 'continue-to-audit', reason: 'asked for when the run started' } } },
  });
  assert.deepEqual(readState(run).node_summaries.specification.recommends, { option: 'continue-to-audit', reason: 'asked for when the run started' });
});

test('refusal: state-summary-item-invalid — a recommends naming no continue of the gate that waits on the node, or with no reason', t => {
  const cases = [
    [{ option: 'stop-here', reason: 'nothing to audit' }, /recommends is "stop-here", which is not a continue option of the gate that waits on specification, which offers continue-to-audit, continue-to-planning/],
    [{ option: 'continue-on', reason: 'r' }, /which is not a continue option of the gate that waits on specification/],
    [{ option: 'continue-to-audit' }, /whose reason is one non-empty sentence on one line/],
    [{ option: 'continue-to-audit', reason: 'two\nlines' }, /whose reason is one non-empty sentence on one line/],
    ['continue-to-audit', /an \{option, reason\} map naming the continue option recommended and why/],
  ];
  for (const [recommends, pattern] of cases) {
    const run = scratch(t);
    freeze(run, { definition: OPTIONAL_STEP });
    const result = refused(run, { node_summaries: { specification: { summary: 'Wrote it.', recommends } } });
    assert.match(result.stderr, /^state-summary-item-invalid: node_summaries\.specification\.recommends is /);
    assert.match(result.stderr, pattern, JSON.stringify(recommends));
  }
  const run = scratch(t);
  freeze(run, { definition: OPTIONAL_STEP });
  const planning = refused(run, { node_summaries: { planning: { summary: 'Planned.', recommends: { option: 'continue-on', reason: 'r' } } } });
  assert.match(planning.stderr, /no gate waits on planning with a continue option to recommend/);
});

// ---------------------------------------------------------------------------
// task.status: in progress from the first step's start
// ---------------------------------------------------------------------------

/** A run frozen as the engine freezes one: no task status recorded. */
function freezeUnstarted(run, options = {}) {
  const { patch, graph } = freezePatch(options);
  delete patch.task.status;
  write(run, patch);
  return graph;
}

test('task status: the freeze records none, and the first write that starts a step records the run in progress', t => {
  const run = scratch(t);
  freezeUnstarted(run);
  assert.equal(readState(run).task.status, undefined, 'the freeze runs nothing');
  write(run, { context: { note: 'before any step' } });
  assert.equal(readState(run).task.status, undefined, 'a write that starts no step leaves it unset');
  const result = write(run, { nodes: { analysis: { status: 'running' } } });
  assert.equal(readState(run).task.status, 'in_progress');
  assert.match(result.stdout, /task\.status/, 'the write names what it changed');
});

test('task status: a recorded pending reads as not started, and a step written straight to its end also starts the run', t => {
  const run = scratch(t);
  freeze(run, { task: { status: 'pending' } });
  write(run, { nodes: { analysis: { status: 'completed' } } });
  assert.equal(readState(run).task.status, 'in_progress');
});

test('task status: a status the patch sends wins, and an ending is never overwritten by a later step write', t => {
  for (const ending of ['completed', 'failed', 'stopped']) {
    const run = scratch(t);
    freezeUnstarted(run);
    write(run, { task: { status: ending }, nodes: { analysis: { status: ending === 'stopped' ? 'stopped' : ending } } });
    assert.equal(readState(run).task.status, ending, `${ending}: the patch's own status wins`);
    write(run, { nodes: { approval: { status: 'skipped' } } });
    assert.equal(readState(run).task.status, ending, `${ending}: a later step write leaves the ending`);
  }
});

test('task status: a sub-run records itself in progress at its own first step, as a top-level run does', t => {
  const parent = scratch(t);
  freezeUnstarted(parent);
  write(parent, { nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'completed' }, research: { status: 'running' } } });
  const child = sibling(parent, { type: 'research', name: '2026-01-05-open-questions' });
  const graph = freezeUnstarted(child, {
    definition: path.join(ENGINE_DIR, 'workflows/research.yml'),
    task: { title: 'Open questions' },
    inputs: { question: 'What did the implementation leave open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  assert.equal(readState(child).task.status, undefined);
  write(child, { nodes: { [graph.nodes[0].id]: { status: 'running' } } });
  assert.equal(readState(child).task.status, 'in_progress');
  assert.equal(readState(parent).task.status, 'in_progress');
});
