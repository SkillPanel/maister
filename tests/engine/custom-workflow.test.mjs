import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, freezePatch, lastLine, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';

// A workflow no built-in is named after, driven end to end the way a user's own
// runs: authored into the project's `.maister/workflows/`, validated, resolved
// and drawn, frozen through the proven path, its nodes and its gate written and
// briefed, projected, its sub-run started and adopted, its run closed — and the
// same again under an overlay and a profile. The run lives under a task type of
// its own (`audits`), and nothing here names a built-in workflow.

const AUTHORED = path.join(FIXTURES, 'custom-workflow');
const RELEASE = { release: 'v2.4.0' };

/** The resolved order: the fan-out ties broken by id, the gate after all three. */
const ORDER = ['intake', 'dependency-scan', 'license-scan', 'security-scan', 'triage', 'deep-audit', 'report', 'rollback-notes'];

const ANSWER = option => ({ option, answered_by: 'operator', at: '2026-01-05T09:05:00Z' });

/**
 * A scratch project holding the authored workflows in its own
 * `.maister/workflows/` and one run directory under `.maister/tasks/audits/`.
 * `env` points a verb at that project, so a `workflow:` target is looked up in
 * the project's own workflow home.
 */
function project(t) {
  const run = scratch(t, { type: 'audits', name: '2026-01-05-release-audit' });
  const home = path.join(run.root, '.maister/workflows');
  fs.cpSync(AUTHORED, home, { recursive: true });
  return {
    ...run,
    home,
    definition: path.join(home, 'release-audit.yml'),
    child: path.join(home, 'audit-child.yml'),
    overlay: path.join(home, 'hardening.overlay.yml'),
    env: { CLAUDE_PROJECT_DIR: run.root },
  };
}

/** Run a definition verb inside the project; `validate` and `resolve` are parsed. */
function inProject(run, verbName, { overlaid = false, profile = null, extra = [] } = {}) {
  const args = [verbName, `--definition=${run.definition}`, ...(overlaid ? [`--overlay=${run.overlay}`] : [])];
  if (profile !== null) args.push(`--profile=${profile}`);
  const result = verb([...args, ...extra], undefined, run.env);
  return verbName === 'diagram' ? result : { ...result, report: JSON.parse(result.stdout) };
}

/** A project with its run frozen from the authored definition, every node pending. */
function frozen(t, { overlaid = false, profile = null } = {}) {
  const run = project(t);
  const graph = freeze(run, {
    definition: run.definition,
    overlays: overlaid ? [run.overlay] : [],
    profile,
    inputs: RELEASE,
    task: { title: 'Audit v2.4.0' },
  });
  return { run, graph };
}

/** Put a file — or, with `dir`, a directory holding one — into a run directory. */
function place(run, relative, { dir = false } = {}) {
  const target = path.join(run.dir, relative);
  const file = dir ? path.join(target, 'entry.md') : target;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${relative}\n`);
}

/**
 * A frozen run paused at `triage`: the intake ended with its brief on disk and
 * no security review wanted, the two unguarded scans ended with a summary each,
 * the guarded scan was recorded skipped — and, under the overlay, the node it
 * added ended too, its inventory on disk.
 */
function atTriage(t, { overlaid = false, profile = null, risks = [] } = {}) {
  const { run, graph } = frozen(t, { overlaid, profile });
  place(run, 'intake/brief.md');
  const nodes = {
    intake: { status: 'completed', values: { needs_security: false, risk_level: 'low' } },
    'license-scan': { status: 'completed' },
    'dependency-scan': { status: 'completed' },
    'security-scan': { status: 'skipped' },
  };
  const summaries = {
    'license-scan': { summary: 'No copyleft licences.' },
    'dependency-scan': { summary: 'Two advisories, both patched upstream.', risks },
  };
  if (overlaid) {
    place(run, 'outputs/sbom.json');
    nodes.sbom = { status: 'completed' };
    summaries.sbom = { summary: 'Inventory of 212 packages.' };
  }
  write(run, { nodes, node_summaries: summaries });
  return { run, graph };
}

function brief(run, node = 'triage', extra = []) {
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, ...extra]);
}

function complete(run) {
  return verb(['run-complete', `--state=${run.state}`]);
}

/**
 * Past the gate and into the sub-run: the operator proceeds, `deep-audit`
 * starts a child of the authored child workflow in a task directory of its own
 * type, and waits on it — the child frozen with its parent link, the parent
 * recording the child's address.
 */
function startChild(run) {
  write(run, {
    nodes: { triage: { status: 'completed' }, 'deep-audit': { status: 'running' } },
    node_summaries: { triage: { decisions: [ANSWER('proceed')] } },
  });
  const child = sibling(run, { type: 'audit-checks', name: '2026-01-05-deep-audit' });
  freeze(child, {
    definition: run.child,
    task: { title: 'Deep audit of v2.4.0' },
    inputs: { subject: 'v2.4.0', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: run.path, node: 'deep-audit' } },
  });
  write(run, { nodes: { 'deep-audit': { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return child;
}

/** The child inspects, finds nothing blocking, and closes; the parent adopts it. */
function finishChild(run, child) {
  place(child, 'findings', { dir: true });
  write(child, {
    task: { status: 'completed' },
    nodes: { inspect: { status: 'completed', values: { blocking: false } } },
    node_summaries: { inspect: { summary: 'Nothing blocking.' } },
  });
  write(run, {
    nodes: { 'deep-audit': { status: 'completed', values: { task_path: child.path, run_id: child.name } } },
    node_summaries: { 'deep-audit': { summary: `Sub-run ${child.name} completed.` } },
  });
}

/** The report ends with both of its declared artifacts on disk, the summary's companion beside it. */
function writeReport(run) {
  place(run, 'outputs/audit-summary.md');
  place(run, 'outputs/audit-summary.html');
  place(run, 'outputs/evidence', { dir: true });
  write(run, { nodes: { report: { status: 'completed' } }, node_summaries: { report: { summary: 'Release cleared.' } } });
}

// ---------------------------------------------------------------------------
// the definition: validate, resolve, diagram
// ---------------------------------------------------------------------------

test('validate: the authored workflow is clean, and every target resolves in the project', t => {
  const run = project(t);
  const { code, report } = inProject(run, 'validate');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, [], 'no string-typed value, no unresolved target, no dangling node');
  assert.deepEqual(report.counts, { nodes: 8, gates: 1 });
  const companion = path.join(run.home, 'release-audit.md');
  assert.deepEqual(report.resolved.map(entry => [entry.node, entry.from, entry.at]), [
    ['intake', 'companion', companion],
    ['license-scan', 'companion', companion],
    ['dependency-scan', 'companion', companion],
    ['security-scan', 'companion', companion],
    ['deep-audit', 'eject', run.child],
    ['report', 'companion', companion],
    ['rollback-notes', 'companion', companion],
  ]);
});

test('validate: the child a sub-run starts validates on its own', t => {
  const run = project(t);
  const result = verb(['validate', `--definition=${run.child}`], undefined, run.env);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.counts, { nodes: 2, gates: 0 });
});

test('resolve: the graph is named after the workflow, ordered by its needs, and carries every key it declared', t => {
  const run = project(t);
  const { code, report } = inProject(run, 'resolve');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.name, 'release-audit');
  assert.equal(report.source, run.definition);
  assert.equal(report.tracker_key, 'release');
  assert.match(report.graph_hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(report.nodes.map(node => node.id), ORDER);

  const byId = Object.fromEntries(report.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.triage.needs, ['dependency-scan', 'license-scan', 'security-scan'], 'the gate joins the fan-out');
  assert.equal(byId.triage.type, 'gate');
  assert.equal(byId.triage.ask, 'Scans finished. Start the deep audit?');
  assert.deepEqual(Object.keys(byId.triage.options), ['abandon', 'proceed', 'rescan']);
  assert.equal(byId['security-scan'].when, '${intake.values.needs_security}');
  assert.equal(byId['rollback-notes'].on, 'failure');
  assert.equal(byId['deep-audit'].uses, 'workflow:audit-child');
  assert.deepEqual(byId['deep-audit'].with, { subject: '${inputs.release}' });
  assert.deepEqual(byId.report.outputs.artifacts, { evidence: 'outputs/evidence', summary: 'outputs/audit-summary.md' });
});

test('resolve: the hash is the graph\'s, the same twice and wherever the child happens to be found', t => {
  const run = project(t);
  const first = inProject(run, 'resolve').report;
  const second = inProject(run, 'resolve').report;
  assert.equal(second.graph_hash, first.graph_hash);

  // Outside the project the child is nowhere to be found: a warning, and the
  // same graph under the same hash.
  const elsewhere = JSON.parse(verb(['resolve', `--definition=${run.definition}`]).stdout);
  assert.deepEqual(elsewhere.warnings, ['unresolved-reference:deep-audit:workflow:audit-child']);
  assert.equal(elsewhere.graph_hash, first.graph_hash);
});

test('diagram: the custom graph is drawn under its name and hash, its gate, guard and recovery node marked', t => {
  const run = project(t);
  const { graph_hash: hash } = inProject(run, 'resolve').report;
  const result = inProject(run, 'diagram');
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[1], '%% workflow: release-audit');
  assert.equal(lines[2], `%% graph_hash: ${hash}`);
  assert.equal(lines[3], '', 'a graph drawn with no overlay and no profile names neither');
  assert.ok(lines.includes('flowchart TD'));
  assert.ok(lines.includes('  n_intake["Release intake<br/>intake<br/>direct:intake"]'), 'a titled node leads with its title');
  assert.ok(lines.includes('  n_deep_audit["deep-audit<br/>workflow:audit-child"]'), 'an untitled node shows its id alone');
  assert.ok(lines.includes('  n_security_scan{"security-scan<br/>direct:security-scan<br/>when: ${intake.values.needs_security}"}'));
  assert.ok(lines.includes('  n_rollback_notes["rollback-notes<br/>direct:rollback-notes<br/>on: failure"]'));
  assert.match(result.stdout, /^ {2}n_triage\{\{"Triage the scans<br\/>triage<br\/>gate<br\/>Scans finished\. Start the deep audit\?<br\/>/m);
  for (const scan of ['dependency_scan', 'license_scan', 'security_scan']) {
    assert.ok(lines.includes(`  n_intake --> n_${scan}`), `fan-out to ${scan}`);
    assert.ok(lines.includes(`  n_${scan} --> n_triage`), `join from ${scan}`);
  }
  assert.ok(lines.includes('  class n_triage gate'));
  assert.ok(lines.includes('  class n_security_scan conditional'));

  const out = path.join(run.root, 'diagrams/release-audit.mmd');
  const written = inProject(run, 'diagram', { extra: [`--out=${out}`] });
  assert.equal(written.code, 0, written.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), result.stdout, '--out writes the bytes stdout prints');
});

// ---------------------------------------------------------------------------
// the freeze
// ---------------------------------------------------------------------------

test('freeze: the proven freeze lands under the custom task type, every node pending with its resolved needs', t => {
  const run = project(t);
  const { patch, graph } = freezePatch({ definition: run.definition, inputs: RELEASE, task: { title: 'Audit v2.4.0' } });
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(run.dir, path.join(run.root, '.maister/tasks/audits/2026-01-05-release-audit'));

  const state = readState(run);
  assert.equal(state.workflow.name, 'release-audit');
  assert.equal(state.workflow.graph_hash, graph.graph_hash);
  assert.deepEqual(state.orchestrator.options.inputs, RELEASE);
  assert.deepEqual(Object.keys(state.workflow.nodes), ORDER);
  for (const node of graph.nodes) {
    assert.equal(state.workflow.nodes[node.id].status, 'pending', node.id);
    assert.deepEqual(state.workflow.nodes[node.id].needs, node.needs, node.id);
  }
  assert.equal(state.workflow.nodes.triage.kind, 'gate');
  assert.equal(state.workflow.nodes['deep-audit'].kind, 'workflow');

  const banner = result.stdout.split('\n\n')[1];
  assert.equal(banner, [
    'Maister run started',
    'Task: Audit v2.4.0',
    `Directory: ${run.dir}`,
    `Dashboard: ${path.join(run.dir, 'dashboard.html')}`,
    'First node: intake',
    '',
  ].join('\n'));
});

test('freeze: a source recorded relative to the project, the way a driver writes it, still proves', t => {
  const run = project(t);
  const { patch, graph } = freezePatch({ definition: run.definition, inputs: RELEASE });
  patch.workflow.source = '.maister/workflows/release-audit.yml';
  write(run, patch);
  const state = readState(run);
  assert.equal(state.workflow.source, '.maister/workflows/release-audit.yml');
  assert.deepEqual(state.workflow.nodes.triage.needs, graph.nodes.find(node => node.id === 'triage').needs);
});

// ---------------------------------------------------------------------------
// node writes and the gate
// ---------------------------------------------------------------------------

test('nodes: the declared values land, the branches run side by side, and a false guard records its scan skipped', t => {
  const { run } = frozen(t);
  write(run, { nodes: { intake: { status: 'completed', values: { needs_security: false, risk_level: 'medium' } } } });
  write(run, { nodes: { 'license-scan': { status: 'running' }, 'dependency-scan': { status: 'running' }, 'security-scan': { status: 'skipped' } } });
  const nodes = readState(run).workflow.nodes;
  assert.deepEqual(nodes.intake.values, { needs_security: false, risk_level: 'medium' });
  assert.equal(nodes['license-scan'].status, 'running');
  assert.equal(nodes['dependency-scan'].status, 'running');
  assert.equal(nodes['security-scan'].status, 'skipped');
});

test('nodes: a value outside the declared enum is refused, and nothing moves', t => {
  const { run } = frozen(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = verb(['write-state', `--state=${run.state}`], {
    nodes: { intake: { status: 'completed', values: { needs_security: false, risk_level: 'severe' } } },
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^state-value-invalid\b/);
  assert.match(result.stderr, /risk_level/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
});

test('gate-brief: the fan-out\'s summaries are pooled under their titles, then the next node and the continue option', t => {
  const { run } = atTriage(t);
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, [
    'Dependency scan: Two advisories, both patched upstream.',
    '',
    'Licence scan: No copyleft licences.',
    'Next: Deep Audit',
    '',
  ].join('\n'));
  const picker = JSON.parse(brief(run, 'triage', ['--json']).stdout);
  assert.equal(picker.options[0].id, 'proceed');
  assert.equal(picker.options[0].recommended, true);
});

test('gate-brief: a risk recommending a stop makes the gate\'s first stop option the recommended one', t => {
  const { run } = atTriage(t, { risks: ['recommend stop: one advisory has no fix'] });
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Risks: recommend stop: one advisory has no fix$/m);
  const picker = JSON.parse(brief(run, 'triage', ['--json']).stdout);
  assert.equal(picker.options[0].id, 'abandon', 'options are ordered by id, so abandon is the first stop option');
  assert.equal(picker.options[0].recommended, true);
});

test('gate-brief: --oneline folds the custom gate\'s brief onto one line', t => {
  const { run } = atTriage(t);
  const result = brief(run, 'triage', ['--oneline']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n').length, 2, 'one line and its newline');
  assert.match(result.stdout, /Licence scan: No copyleft licences\. · Next: Deep Audit · Recommended: proceed · Run: /);
});

test('gate-brief: writes nothing', t => {
  const { run } = atTriage(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const listing = fs.readdirSync(run.dir).sort();
  brief(run);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(run.dir).sort(), listing);
});

test('gate: an option the custom gate offers lands; one it does not offer is refused, naming the ones it does', t => {
  const { run } = atTriage(t);
  const before = fs.readFileSync(run.state, 'utf8');
  const refused = verb(['write-state', `--state=${run.state}`], {
    nodes: { triage: { status: 'completed' } },
    node_summaries: { triage: { decisions: [ANSWER('later')] } },
  });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^state-gate-option-unknown\b/);
  assert.match(refused.stderr, /abandon, proceed, rescan/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);

  write(run, { nodes: { triage: { status: 'completed' } }, node_summaries: { triage: { decisions: [ANSWER('rescan')] } } });
  assert.equal(readState(run).node_summaries.triage.decisions[0].option, 'rescan', 'the option written in map form is offered too');
});

// ---------------------------------------------------------------------------
// the dashboard projection
// ---------------------------------------------------------------------------

test('dashboard: every phase is named by its title or its humanized id, in frozen order, with the declared icons', t => {
  const { run } = frozen(t);
  const data = readDashboard(run);
  assert.equal(data.task.title, 'Audit v2.4.0');
  assert.deepEqual(data.phases.map(phase => phase.id), ORDER);
  assert.deepEqual(data.phases.map(phase => phase.name), [
    'Release intake', 'Dependency scan', 'Licence scan', 'Security Scan',
    'Triage the scans', 'Deep Audit', 'Audit report', 'Rollback Notes',
  ]);
  const icons = Object.fromEntries(data.phases.filter(phase => 'icon_hint' in phase).map(phase => [phase.id, phase.icon_hint]));
  assert.deepEqual(icons, { intake: 'analysis', report: 'docs' });
});

test('dashboard: the report\'s own artifacts — a file with its companion and a directory — are registered and shown', t => {
  const { run } = atTriage(t);
  finishChild(run, startChild(run));
  writeReport(run);
  const expected = [
    { path: 'outputs/audit-summary.md', label: null, html: 'outputs/audit-summary.html' },
    { path: 'outputs/evidence', label: null, html: null },
  ];
  assert.deepEqual(readState(run).node_summaries.report.artifacts, expected);
  const report = readDashboard(run).phases.find(phase => phase.id === 'report');
  assert.equal(report.status, 'completed');
  assert.equal(report.summary, 'Release cleared.');
  assert.deepEqual(report.artifacts, expected);
});

test('dashboard: the intake\'s declared brief is registered once its node completes with a summary', t => {
  const { run } = frozen(t);
  place(run, 'intake/brief.md');
  write(run, {
    nodes: { intake: { status: 'completed', values: { needs_security: true, risk_level: 'high' } } },
    node_summaries: { intake: { summary: 'Scoped the release.' } },
  });
  assert.deepEqual(readDashboard(run).phases[0].artifacts, [{ path: 'intake/brief.md', label: null, html: null }]);
});

test('dashboard: a recorded task path is projected as the run\'s path', t => {
  const { run } = frozen(t);
  write(run, { orchestrator: { task_path: run.path } });
  assert.equal(readDashboard(run).task.path, '.maister/tasks/audits/2026-01-05-release-audit');
});

// ---------------------------------------------------------------------------
// the sub-run to the custom child
// ---------------------------------------------------------------------------

test('sub-run: the custom child freezes beside its parent with the link, its inputs and its own name', t => {
  const { run } = atTriage(t);
  const child = startChild(run);
  const state = readState(child);
  assert.equal(child.dir, path.join(run.root, '.maister/tasks/audit-checks/2026-01-05-deep-audit'));
  assert.equal(state.workflow.name, 'audit-child');
  assert.deepEqual(state.orchestrator.parent, { run: run.path, node: 'deep-audit' });
  assert.deepEqual(state.orchestrator.options.inputs, { subject: 'v2.4.0', embedded: true });
  assert.deepEqual(Object.keys(state.workflow.nodes), ['inspect', 'remediate']);
  assert.equal(readState(run).workflow.nodes['deep-audit'].status, 'waiting');
});

test('sub-run: while the parent waits on its child it has not ended, so run-complete refuses it', t => {
  const { run } = atTriage(t);
  startChild(run);
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result.stdout), 'RUN-FAILED: run-not-ended');
});

test('sub-run: the child\'s guard keeps its remediation off the path, it closes, and the parent adopts its findings', t => {
  const { run } = atTriage(t);
  const child = startChild(run);
  finishChild(run, child);

  const closed = complete(child);
  assert.equal(closed.code, 0, closed.stderr);
  assert.equal(closed.stdout, 'RUN-COMPLETE\n', 'remediate stays pending behind a false guard and is not owed');

  const node = readState(run).workflow.nodes['deep-audit'];
  assert.equal(node.status, 'completed');
  const at = `../../audit-checks/${child.name}/findings`;
  assert.deepEqual(readState(run).node_summaries['deep-audit'].artifacts, [{ path: at, label: null, html: null }]);
  assert.ok(fs.existsSync(path.join(run.dir, at)), 'the registered path resolves from the parent');
});

test('sub-run: a failed child fails the parent, the sub-run named in the marker', t => {
  const { run } = atTriage(t);
  const child = startChild(run);
  write(child, { task: { status: 'failed' }, nodes: { inspect: { status: 'failed' } } });
  assert.equal(lastLine(complete(child).stdout), 'RUN-FAILED: node inspect failed');

  write(run, { task: { status: 'failed' }, nodes: { 'deep-audit': { status: 'failed' } } });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result.stdout), `RUN-FAILED: sub-run ${child.name} failed`);
});

// ---------------------------------------------------------------------------
// the close
// ---------------------------------------------------------------------------

test('run-complete: every node ended and every artifact on disk — the recovery node was never needed — RUN-COMPLETE', t => {
  const { run } = atTriage(t);
  finishChild(run, startChild(run));
  writeReport(run);
  write(run, { task: { status: 'completed' } });
  assert.equal(readState(run).workflow.nodes['rollback-notes'].status, 'pending');
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('run-complete: a run recorded completed with its report still pending is refused, naming the report', t => {
  const { run } = atTriage(t);
  finishChild(run, startChild(run));
  write(run, { task: { status: 'completed' } });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /^run-nodes-unfinished\b/);
  assert.match(result.stderr, /not finished: report \(pending\)\./);
});

test('run-complete: a report that never wrote its outputs is a line per declared path, the directory included', t => {
  const { run } = atTriage(t);
  finishChild(run, startChild(run));
  write(run, { task: { status: 'completed' }, nodes: { report: { status: 'completed' } } });
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'missing-artifact: report outputs/evidence',
    'missing-artifact: report outputs/audit-summary.md',
    'RUN-COMPLETE',
    '',
  ].join('\n'));
});

test('run-complete: a failed report owes its on: failure node until it runs', t => {
  const { run } = atTriage(t);
  finishChild(run, startChild(run));
  place(run, 'outputs/audit-summary.md');
  place(run, 'outputs/evidence', { dir: true });
  write(run, { task: { status: 'completed' }, nodes: { report: { status: 'failed' } } });
  const owed = complete(run);
  assert.equal(owed.code, 1);
  assert.match(owed.stderr, /not finished: rollback-notes \(pending\)\./);

  write(run, { nodes: { 'rollback-notes': { status: 'completed' } } });
  const recovered = complete(run);
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(recovered.stdout, 'RUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// an overlay with before:, tune.with and a profile
// ---------------------------------------------------------------------------

test('overlay: validates clean over the custom workflow, and on its own; the added node\'s prose is the overlay\'s', t => {
  const run = project(t);
  for (const profile of [null, 'quick']) {
    const { code, report } = inProject(run, 'validate', { overlaid: true, profile });
    assert.equal(code, 0, JSON.stringify(report.errors));
    assert.deepEqual(report.warnings, [], 'before: gives the added node a dependent, so it is not a dangling leaf');
    const sbom = report.resolved.find(entry => entry.node === 'sbom');
    assert.deepEqual([sbom.from, sbom.at], ['companion', path.join(run.home, 'hardening.overlay.md')]);
  }
  const standalone = verb(['validate', `--overlay=${run.overlay}`], undefined, run.env);
  assert.equal(standalone.code, 0, standalone.stdout);
});

test('overlay: before: puts the added node in front of the gate, and tune.with merges into the sub-run\'s inputs', t => {
  const run = project(t);
  const { code, report } = inProject(run, 'resolve', { overlaid: true });
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.overlays, [run.overlay]);
  assert.equal(report.profile, null);
  const byId = Object.fromEntries(report.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.sbom.needs, ['intake']);
  assert.deepEqual(byId.triage.needs, ['dependency-scan', 'license-scan', 'sbom', 'security-scan']);
  assert.deepEqual(byId['deep-audit'].with, { depth: 'thorough', subject: '${inputs.release}' });
  assert.ok(byId['rollback-notes'], 'the overlay body leaves the recovery node in place');
});

test('overlay: the profile tunes the same input again and drops the recovery node, and each variant hashes apart', t => {
  const run = project(t);
  const base = inProject(run, 'resolve').report;
  const overlaid = inProject(run, 'resolve', { overlaid: true }).report;
  const quick = inProject(run, 'resolve', { overlaid: true, profile: 'quick' }).report;
  assert.equal(quick.profile, 'quick');
  const byId = Object.fromEntries(quick.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId['deep-audit'].with, { depth: 'shallow', subject: '${inputs.release}' });
  assert.equal(byId['rollback-notes'], undefined);
  assert.deepEqual(quick.nodes.map(node => node.id),
    ['intake', 'dependency-scan', 'license-scan', 'sbom', 'security-scan', 'triage', 'deep-audit', 'report']);
  assert.equal(new Set([base.graph_hash, overlaid.graph_hash, quick.graph_hash]).size, 3);
});

test('overlay: the freeze records the overlay and the profile, and the node set is the folded one', t => {
  const { run, graph } = frozen(t, { overlaid: true, profile: 'quick' });
  const state = readState(run);
  assert.deepEqual(state.workflow.overlays, [run.overlay]);
  assert.equal(state.workflow.profile, 'quick');
  assert.equal(state.workflow.graph_hash, graph.graph_hash);
  assert.deepEqual(Object.keys(state.workflow.nodes), graph.nodes.map(node => node.id));
  assert.deepEqual(state.workflow.nodes.triage.needs, ['dependency-scan', 'license-scan', 'sbom', 'security-scan']);
});

test('overlay: the gate brief reports the added node beside the scans, under the profile\'s title', t => {
  const { run } = atTriage(t, { overlaid: true, profile: 'quick' });
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'Dependency scan: Two advisories, both patched upstream.',
    '',
    'Licence scan: No copyleft licences.',
    '',
    'Quick bill of materials: Inventory of 212 packages.',
    'Next: Deep Audit',
    '',
  ].join('\n'));
});

test('overlay: the dashboard titles the added node and registers the artifact the overlay declared for it', t => {
  for (const [profile, title] of [[null, 'Bill of materials'], ['quick', 'Quick bill of materials']]) {
    const { run } = frozen(t, { overlaid: true, profile });
    place(run, 'outputs/sbom.json');
    write(run, { nodes: { sbom: { status: 'completed' } }, node_summaries: { sbom: { summary: 'Inventory of 212 packages.' } } });
    const sbom = readDashboard(run).phases.find(phase => phase.id === 'sbom');
    assert.equal(sbom.name, title);
    assert.deepEqual(sbom.artifacts, [{ path: 'outputs/sbom.json', label: null, html: null }]);
  }
});

test('overlay: run-complete owes the added node while it is pending', t => {
  const { run } = frozen(t, { overlaid: true, profile: 'quick' });
  const nodes = Object.fromEntries(Object.keys(readState(run).workflow.nodes).map(id => [id, { status: 'completed' }]));
  nodes.intake.values = { needs_security: true, risk_level: 'high' };
  nodes.sbom = { status: 'pending' };
  write(run, { task: { status: 'completed' }, nodes });
  const result = complete(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /not finished: sbom \(pending\)\./);
});

test('overlay: the diagram draws the added node into the gate and leaves the disabled one out', t => {
  const run = project(t);
  const { graph_hash: hash } = inProject(run, 'resolve', { overlaid: true, profile: 'quick' }).report;
  const result = inProject(run, 'diagram', { overlaid: true, profile: 'quick' });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[2], `%% graph_hash: ${hash}`);
  assert.equal(lines[3], '%% overlays: hardening.overlay.yml');
  assert.equal(lines[4], '%% profile: quick');
  assert.ok(lines.includes('  n_sbom["Quick bill of materials<br/>sbom<br/>direct:sbom"]'));
  assert.ok(lines.includes('  n_intake --> n_sbom'));
  assert.ok(lines.includes('  n_sbom --> n_triage'));
  assert.ok(!result.stdout.includes('n_rollback_notes'));
});

// ---------------------------------------------------------------------------
// the context block
// ---------------------------------------------------------------------------

// A custom run's context block is derived from its name — `<name>_context`,
// dashes mapped as the built-ins' are — and `prior-context` finds it by that
// suffix, falling back to `node_summaries` when the run wrote none.

const INTAKE_SUMMARY = {
  node: 'intake',
  status: 'completed',
  summary: 'Scoped the release.',
  decisions: ['audit the lockfile, not the manifest'],
  risks: ['the inventory tool is new'],
};

test('context: a custom run keeps its context and phase summaries in a block named after the workflow', t => {
  const { run } = frozen(t);
  write(run, { context: { release_train: 'autumn' }, phase_summaries: { intake: INTAKE_SUMMARY } });
  const state = readState(run);
  assert.equal(state.release_audit_context.release_train, 'autumn');
  assert.deepEqual(state.release_audit_context.phase_summaries.intake.decisions, INTAKE_SUMMARY.decisions);
});

test('prior-context: a custom run\'s phase summaries render for the next delegate', t => {
  const { run } = frozen(t);
  write(run, { phase_summaries: { intake: INTAKE_SUMMARY } });
  const result = verb(['prior-context', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /release_audit_context\.phase_summaries/);
  assert.match(result.stdout, /^- audit the lockfile, not the manifest$/m);
  assert.match(result.stdout, /^- the inventory tool is new$/m);
});

test('prior-context: a custom run with no context block falls back to its node summaries', t => {
  const { run } = frozen(t);
  const { node: _node, ...summary } = INTAKE_SUMMARY;
  write(run, { nodes: { intake: { status: 'completed', values: { needs_security: false, risk_level: 'low' } } }, node_summaries: { intake: summary } });
  const result = verb(['prior-context', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /audit the lockfile, not the manifest/);
  assert.match(result.stdout, /the inventory tool is new/);
});

test('gate-brief: a summary a custom run recorded only in its context block is the brief', t => {
  const { run } = frozen(t);
  write(run, {
    nodes: {
      intake: { status: 'completed', values: { needs_security: false, risk_level: 'low' } },
      'license-scan': { status: 'completed' },
      'dependency-scan': { status: 'completed' },
      'security-scan': { status: 'skipped' },
    },
    phase_summaries: {
      'license-scan': { node: 'license-scan', status: 'completed', summary: 'No copyleft licences.' },
      'dependency-scan': { node: 'dependency-scan', status: 'completed', summary: 'Two advisories, both patched upstream.' },
    },
  });
  const result = brief(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Licence scan: No copyleft licences\.$/m);
});

// ---------------------------------------------------------------------------
// the task type
// ---------------------------------------------------------------------------

// A type outside the built-in list used to be coerced to `development`, and the
// viewer drew that workflow's hero cards for a run that produces none of them.
test('dashboard: a custom task type is projected as it is, not coerced', t => {
  const { run } = frozen(t);
  write(run, { orchestrator: { task_path: run.path } });
  assert.equal(readDashboard(run).task.type, 'audits');
});

test('dashboard: with no task path, the type is the workflow\'s own name', t => {
  const { run } = frozen(t);
  assert.equal(readState(run).orchestrator?.task_path ?? null, null, 'the freeze records no task path of its own');
  assert.equal(readDashboard(run).task.type, 'release-audit');
});
