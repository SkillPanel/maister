import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, ENGINE_DIR, SAMPLE, freeze, freezePatch, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');

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
  const changed = result.stdout.trim().split('\n');
  assert.deepEqual(changed.slice(0, 2), ['orchestrator.completed_phases', 'orchestrator.failed_phases']);
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^orchestrator:\n  completed_phases: \[\]\n  failed_phases: \[\]\n/);
});

test('freeze: a sequence the patch supplies is not re-seeded', t => {
  const run = scratch(t);
  write(run, freezePatch({ task: { title: 'Seeded' }, orchestrator: { completed_phases: ['intake'] } }).patch);
  const state = readState(run);
  assert.deepEqual(state.orchestrator.completed_phases, ['intake']);
  assert.deepEqual(state.orchestrator.failed_phases, []);
});

// The startup banner: the freeze write prints it after the changed paths, once.

test('banner: the freeze prints the task, its directory, the dashboard and the first node after the changed paths', t => {
  const run = scratch(t);
  const resolved = JSON.parse(verb(['resolve', `--definition=${DEVELOPMENT}`]).stdout);
  const nodes = Object.fromEntries(resolved.nodes.map(node => [node.id, { kind: node.type === 'gate' ? 'gate' : node.uses.split(':')[0] }]));
  const result = verb(['write-state', `--state=${run.state}`], {
    task: { title: 'Fix the parser', status: 'in_progress' },
    workflow: { source: DEVELOPMENT, graph_hash: resolved.graph_hash, grammar_version: 1, name: 'development', nodes },
    orchestrator: { options: { inputs: { task_description: 'Fix the parser' } } },
  });
  assert.equal(result.code, 0, result.stderr);
  const [paths, banner] = result.stdout.split('\n\n');
  assert.match(paths, /^orchestrator\.completed_phases$/m, 'the changed paths come first, unchanged');
  assert.equal(banner, [
    'Maister run started',
    'Task: Fix the parser',
    `Directory: ${run.dir}`,
    `Dashboard: ${path.join(run.dir, 'dashboard.html')}`,
    'First node: intake',
    '',
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

test('viewer: the freeze copies dashboard.html into the run directory and reports it before the banner', t => {
  const run = scratch(t);
  const result = write(run, FROZEN());
  assert.equal(fs.readFileSync(path.join(run.dir, 'dashboard.html'), 'utf8'), fs.readFileSync(VIEWER, 'utf8'));
  const [paths, banner] = result.stdout.split('\n\n');
  assert.match(paths, /^dashboard\.html$/m);
  assert.match(banner, /^Maister run started$/m);
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
  assert.match(result.stdout, /^Maister run started$/m);
});

test('banner: a title spanning lines is folded onto the Task line', t => {
  const run = scratch(t);
  // The writer refuses a newline in a title it is sent, so only a file it
  // adopted can carry one: a literal block scalar, as a hand-written state has.
  fs.writeFileSync(run.state, 'task:\n  title: |\n    Fix the parser\n      and the lexer\n  status: in_progress\n');
  const result = verb(['write-state', `--state=${run.state}`], { workflow: freezePatch().patch.workflow });
  assert.equal(result.code, 0, result.stderr);
  const banner = result.stdout.split('\n\n')[1];
  assert.equal(banner.split('\n').length, 6, banner);
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
  assert.match(result.stdout, /^First node: analysis$/m);
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

test('an adopted prose-written state keeps its unknown blocks, options and comments', t => {
  const run = scratch(t, { fixture: 'adopted' });
  write(run, { nodes: { approval: { status: 'completed' } }, orchestrator: { options: { html_output: false } } });
  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^# Written by a prose orchestrator/);
  const state = readState(run);
  assert.deepEqual(state.project_context, { tech_stack: 'node', notes: 'kept through every write' });
  assert.equal(state.orchestrator.started_phase, 'analysis');
  assert.deepEqual(state.orchestrator.completed_phases, ['analysis']);
  assert.deepEqual(state.orchestrator.options, { html_output: false, mockup_format: 'html' });
  assert.equal(state.workflow.nodes.analysis.status, 'completed');
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

test('refusal: a workflow name no context block derives from', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ definition: DECLARED, inputs: { subject: 'acme-api' } });
  const result = refused(run, { ...patch, context: { risk_level: 'low' } });
  assert.match(result.stderr, /^state-context-block-unknown\b/);
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
