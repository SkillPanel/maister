import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, delegating, write as writeState } from '../helpers.mjs';

// A built-in step that declares delegates completes only with them listed;
// every write here sends them as a session that dispatched them would.
const write = (run, patch) => writeState(run, delegating(patch, run));

// Development and performance audit every specification before anyone approves
// it: the audit runs between the specification and the one specification
// approval, which nothing lets a run skip, and planning follows that approval.
// A revise reruns the specification and the audit behind it. A project that
// wants no audit disables it with an overlay, which leaves a valid graph. A run
// frozen on the graph before the move still resumes, with the drift warning
// every changed definition gives.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const BUILT_INS = ['development', 'performance'];
const STOP = { development: 'stop-development', performance: 'stop-performance' };

// The graph hashes each built-in froze before the audit moved ahead of the
// approval: a run frozen on one of them is an open run on the earlier graph.
const BEFORE = {
  development: 'sha256:04620850b3a9445c3dc9e8607c94bd7a613dce8a24aa507e55c36cc980d0b79e',
  performance: 'sha256:57a66b20b3ed01a3d22a0a2ddd1d6816356af682bc338f4a2a67db392f4b24e6',
};

function resolved(name, overlays = []) {
  const result = verb(['resolve', `--definition=${path.join(WORKFLOWS, `${name}.yml`)}`, ...overlays.map(each => `--overlay=${each}`)]);
  return { code: result.code, graph: JSON.parse(result.stdout) };
}

const nodeOf = (graph, id) => graph.nodes.find(node => node.id === id) ?? null;

/** A fresh run of `name` with every node before `gate` completed. */
function atGate(t, name, gate, { overlays = [] } = {}) {
  const run = scratch(t, { type: name, name: `2026-11-26-${name}` });
  const graph = freeze(run, { definition: path.join(WORKFLOWS, `${name}.yml`), overlays, inputs: { task_description: 'Tag the notes' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === gate) break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, { nodes });
  return { run, graph };
}

/** An overlay of `name` disabling the audit, written where a project keeps its workflows. */
function disablingOverlay(root, name) {
  const file = path.join(root, '.maister', 'workflows', `${name}.overlay.yml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `extends: builtin:${name}\ndisable: [spec-audit]\n`);
  return file;
}

for (const name of BUILT_INS) {
  test(`${name}: the audit always runs, before the one specification approval, and planning follows that approval`, () => {
    const { code, graph } = resolved(name);
    assert.equal(code, 0, JSON.stringify(graph.errors));
    const audit = nodeOf(graph, 'spec-audit');
    assert.equal(audit.when, undefined, 'the audit carries no guard');
    assert.deepEqual(audit.needs, ['specification']);
    const approval = nodeOf(graph, 'specification-approval');
    assert.deepEqual(approval.needs, ['spec-audit']);
    assert.deepEqual(Object.keys(approval.options), ['continue-to-planning', 'revise-specification', STOP[name]]);
    assert.equal(approval.options['continue-to-planning'], 'continue', 'one plain continue, setting no value');
    assert.equal(nodeOf(graph, 'spec-audit-approval'), null, 'the audit has no approval of its own');
    assert.deepEqual(nodeOf(graph, 'planning').needs, ['specification-approval']);
    assert.equal(Object.hasOwn(nodeOf(graph, 'planning').with ?? {}, 'audit'), false, 'planning reads the audit from disk, never through with:');
    assert.equal(Object.hasOwn(graph.inputs ?? {}, 'audit'), false, 'no input turns the audit on or off');
  });

  test(`${name}: revising the specification at its approval reruns the specification and the audit`, t => {
    const { run } = atGate(t, name, 'specification-approval');
    const result = verb(['gate-revise', `--state=${run.state}`, '--node=specification-approval', '--option=revise-specification'], { note: 'Match tags exactly' });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^revised: specification-approval reruns=specification revision=1\/10 reset=specification,spec-audit,specification-approval$/m);
    const nodes = readState(run).workflow.nodes;
    for (const id of ['specification', 'spec-audit', 'specification-approval']) assert.equal(nodes[id].status, 'pending', id);
  });

  test(`${name}: an overlay that disables the audit leaves a valid graph that freezes and asks the approval`, t => {
    const root = scratch(t, { type: name }).root;
    const overlay = disablingOverlay(root, name);
    const { code, graph } = resolved(name, [overlay]);
    assert.equal(code, 0, JSON.stringify(graph.errors));
    assert.deepEqual(graph.errors, []);
    assert.equal(nodeOf(graph, 'spec-audit'), null);
    assert.deepEqual(nodeOf(graph, 'specification-approval').needs, ['specification']);
    const checked = verb(['validate', `--definition=${path.join(WORKFLOWS, `${name}.yml`)}`, `--overlay=${overlay}`]);
    assert.equal(checked.code, 0, checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout).errors, []);

    const { run } = atGate(t, name, 'specification-approval', { overlays: [overlay] });
    write(run, { node_summaries: { specification: { status: 'completed', headline: 'The spec adds tag filtering, with 6 requirements.', summary: 'Tag filtering on list().' } } });
    const brief = verb(['gate-brief', `--state=${run.state}`, '--node=specification-approval', '--json']);
    assert.equal(brief.code, 0, brief.stderr);
    const parsed = JSON.parse(brief.stdout);
    assert.match(parsed.more_details, /^Done: The spec adds tag filtering, with 6 requirements\.$/m);
    assert.match(parsed.more_details, /^Next: Implementation planning$/m);
  });

  test(`${name}: a run frozen on the graph before the move still resumes, and its briefs name the drift`, t => {
    const { run } = atGate(t, name, 'specification-approval');
    write(run, { node_summaries: { 'spec-audit': { status: 'completed', headline: 'The audit passes the spec.', summary: 'Pass.' } } });
    const text = fs.readFileSync(run.state, 'utf8');
    fs.writeFileSync(run.state, text.replace(/graph_hash: [^\n,}]+/, `graph_hash: ${BEFORE[name]}`));
    const env = { CLAUDE_PROJECT_DIR: run.root };
    const resumed = verb(['resume-check', `--state=${run.state}`, '--no-open'], undefined, env);
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).ok, true);
    const nodeBrief = verb(['node-brief', `--state=${run.state}`, '--node=planning'], undefined, env);
    assert.equal(nodeBrief.code, 0, nodeBrief.stderr);
    assert.match(nodeBrief.stderr, /node-brief-graph-drift/);
    const gateBrief = verb(['gate-brief', `--state=${run.state}`, '--node=specification-approval', '--json'], undefined, env);
    assert.equal(gateBrief.code, 0, gateBrief.stderr);
    assert.match(gateBrief.stdout + gateBrief.stderr, /gate-brief-graph-drift/);
  });
}

/**
 * The run's frozen chain rewritten to the earlier graph's around the audit:
 * the specification approval before the audit, the audit's own approval after
 * it, planning after that, and the earlier hash. Everything up to the audit has
 * ended, as in a run paused at the audit's approval when the plugin moved on.
 */
function pausedAtOldAuditGate(t, name) {
  const { run } = atGate(t, name, 'planning');
  const reruns = 'reruns: {revise-specification: specification}';
  const lines = [
    `    specification-approval: {kind: gate, status: completed, needs: [specification], ${reruns}}`,
    '    spec-audit: {kind: agent, status: completed, needs: [specification-approval]}',
    `    spec-audit-approval: {kind: gate, status: pending, needs: [spec-audit], ${reruns}}`,
    '    planning: {kind: agent, status: pending, needs: [spec-audit-approval]}',
  ];
  const text = fs.readFileSync(run.state, 'utf8').split('\n');
  const at = id => text.findIndex(each => each.startsWith(`    ${id}: {`));
  const first = at('spec-audit');
  assert.equal(at('specification-approval'), first + 1);
  assert.equal(at('planning'), first + 2);
  text.splice(first, 3, ...lines);
  fs.writeFileSync(run.state, text.join('\n').replace(/graph_hash: [^\n,}]+/, `graph_hash: ${BEFORE[name]}`));
  write(run, { node_summaries: { 'spec-audit': { status: 'completed', headline: 'The audit passes the spec after one fix.', summary: 'Pass, one fix.' } } });
  return run;
}

for (const name of BUILT_INS) {
  test(`${name}: a run paused at the audit's own approval on the earlier graph still briefs it, with the drift and its ways on named`, t => {
    const run = pausedAtOldAuditGate(t, name);
    const env = { CLAUDE_PROJECT_DIR: run.root };
    const resumed = verb(['resume-check', `--state=${run.state}`, '--no-open'], undefined, env);
    assert.equal(resumed.code, 0, resumed.stderr);
    const brief = verb(['gate-brief', `--state=${run.state}`, '--node=spec-audit-approval', '--json'], undefined, env);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stderr, /gate-brief-graph-drift/);
    const parsed = JSON.parse(brief.stdout);
    assert.match(parsed.more_details, /^Done: The audit passes the spec after one fix\.$/m);
    // The definition no longer carries the gate, so its options are unknown: the
    // warning names the two ways on — put the frozen definition back, or start
    // a new run — and the run keeps the graph it froze.
    assert.deepEqual(parsed.options, []);
    assert.match(brief.stderr, /put back .*development\.yml|put back .*performance\.yml/);
    assert.match(brief.stderr, /start a new run/);
  });
}
