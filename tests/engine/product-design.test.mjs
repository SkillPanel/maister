import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { delegating, ENGINE_DIR, FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';
import { parseDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { loadAreas } from '../../plugins/maister/skills/workflow-engine/scripts/lib/decision-areas.mjs';
import { panelOf as panelOfCheckpoint } from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The product-design workflow on the engine. A synthetic run — an invented
// enhancement with a UI, whose specification is skipped and whose sketches and
// final screens are drawn — is replayed against the shipped definition, and
// short walks built here stand a fresh run at each of its three gates, for the
// guards that steer the route and the ways back each gate offers.

const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');
const RUN_NAME = '2026-10-02-team-calendar-sharing';
const TASK = 'Let team members share their calendar with guests outside the organisation';

function complete(run) {
  return verb(['run-complete', `--state=${run.state}`]);
}

function brief(run, node, form = '--json') {
  const flags = form.startsWith('--picker=') ? ['--json', form] : [form];
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, ...flags]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  if (form === '--oneline') return result.stdout;
  // The plain text form beside the picker: what each closing node reported,
  // section by section, which the picker itself no longer carries whole.
  const text = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`]).stdout;
  return { ...JSON.parse(result.stdout), brief: text };
}

function revise(run, node, option, note) {
  return verb(['gate-revise', `--state=${run.state}`, `--node=${node}`, `--option=${option}`], { note });
}

/**
 * The synthetic run the fixture records: frozen afresh against the shipped
 * definition, so the fixture does not stale when the definition's hash moves,
 * with the options it recorded, then the recorded outcomes, summaries and design
 * context replayed in one closing write. A gate's values are the writer's own,
 * recorded from the option its summary names, so they are not sent. `absent` is
 * laid over the recorded summaries by node id.
 */
function replayRecorded(t, absent = null, { inputs = {}, unrun = [] } = {}) {
  const run = scratch(t, { fixture: 'team-calendar-sharing', type: 'product-design', name: RUN_NAME });
  const recorded = parse(fs.readFileSync(path.join(run.dir, 'recorded-state.yml'), 'utf8'));
  const { inputs: recordedInputs, ...options } = recorded.orchestrator.options;
  freeze(run, { definition: PRODUCT_DESIGN, orchestrator: { options }, inputs: { ...recordedInputs, ...inputs } });
  const nodes = {};
  for (const [id, entry] of Object.entries(recorded.workflow.nodes)) {
    if (unrun.includes(id)) continue;
    const sent = entry.values && entry.kind !== 'gate' ? { values: { ...entry.values } } : {};
    nodes[id] = { status: entry.status, ...sent };
  }
  const summaries = JSON.parse(JSON.stringify(recorded.node_summaries));
  for (const id of unrun) delete summaries[id];
  if (absent !== null) {
    for (const [id, entries] of Object.entries(absent)) {
      if (entries === null) delete summaries[id].absent;
      else summaries[id].absent = entries;
    }
  }
  write(run, {
    task: { status: recorded.task.status },
    nodes,
    context: JSON.parse(JSON.stringify(recorded.design_context)),
    project_context: JSON.parse(JSON.stringify(recorded.project_context)),
    node_summaries: summaries,
  });
  return run;
}

/** A fresh run of the shipped definition, frozen with `inputs` beside the task, under `driver` when one is named. */
function freshRun(t, inputs = {}, driver = null) {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK, ...inputs }, orchestrator: driver ? { driver } : {} });
  return run;
}

/** One write of a walk, with the delegates a session that dispatched them would list. */
function walk(run, patch) {
  return write(run, delegating(patch, run));
}

/** A gate answered with `option`, as the session records an answer. */
function answer(run, gate, option) {
  return write(run, { nodes: { [gate]: { status: 'completed' } }, node_summaries: { [gate]: { decisions: [{ option }] } } });
}

/**
 * A fresh run walked to `problem-approval`: the intake recorded `draws`, and the
 * problem's summary is the default one with `problem` laid over it.
 */
function atProblemApproval(t, { draws = true, inputs = {}, problem = {}, driver = null } = {}) {
  const run = freshRun(t, inputs, driver);
  walk(run, {
    nodes: { intake: { status: 'completed', values: { draws } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.', absent: { research_context: 'no research task was named' } } },
  });
  walk(run, {
    nodes: { problem: { status: 'completed' } },
    node_summaries: {
      problem: {
        summary: 'Teams cannot show availability to outside guests.',
        decisions: ['External guests get no account'],
        risks: ['open: assumes guests accept a link instead of a login'],
        ...problem,
      },
    },
  });
  return run;
}

/**
 * A fresh run walked to `direction-approval`: `outcome` answered at the first gate,
 * the brainstorm recorded `visualAreas`, the sketches drawn when both bools allow
 * them, and the convergence closed with the summary `convergence`.
 */
function atDirectionApproval(t, {
  draws = true, inputs = {}, problem = {}, outcome = 'brief-with-screens', visualAreas = true, driver = null,
  convergence = { summary: 'Link-based sharing.', decisions: ['access model: signed link'] },
  alternatives = {}, sketches = {},
} = {}) {
  const run = atProblemApproval(t, { draws, inputs, problem, driver });
  answer(run, 'problem-approval', outcome);
  walk(run, {
    nodes: { alternatives: { status: 'completed', values: { visual_areas: visualAreas } } },
    node_summaries: { alternatives: { summary: 'Two decision areas, five alternatives.', ...alternatives } },
  });
  if (draws && visualAreas) {
    walk(run, {
      nodes: { sketches: { status: 'completed' } },
      node_summaries: { sketches: { summary: 'v001 of the sketches, one page per option.', ...sketches } },
    });
  }
  walk(run, { nodes: { convergence: { status: 'completed' } }, node_summaries: { convergence } });
  return run;
}

/**
 * A fresh run walked to `brief-approval`: the direction approved, the specification
 * written when the outcome or the input asks for it, the final screens drawn when
 * the intake said so, and the brief closed.
 */
function atBriefApproval(t, options = {}) {
  const { draws = true, inputs = {}, outcome = 'brief-with-screens' } = options;
  const run = atDirectionApproval(t, options);
  answer(run, 'direction-approval', 'approve-direction');
  if (outcome === 'brief-with-spec' || inputs.specification === true) {
    walk(run, {
      nodes: { specification: { status: 'completed' } },
      node_summaries: { specification: { summary: 'Three screens, from the share dialog to the guest calendar.' } },
    });
  }
  if (draws) {
    walk(run, {
      nodes: { screens: { status: 'completed' } },
      node_summaries: { screens: { summary: 'v002 — the share dialog and the guest calendar; open analysis/mockups/versions/v002/index.html.' } },
    });
  }
  walk(run, {
    nodes: { brief: { status: 'completed' } },
    node_summaries: { brief: { summary: 'The brief and the delivery scope, one member in scope.' } },
  });
  return run;
}

// ---------------------------------------------------------------------------
// the recorded run, closed
// ---------------------------------------------------------------------------

test('recorded run: with the absences its nodes sanction recorded, it ends on RUN-COMPLETE alone', t => {
  const result = complete(replayRecorded(t));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('recorded run: an unsanctioned research context reads as the one missing artifact', t => {
  const result = complete(replayRecorded(t, { intake: null }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: intake context/research-context\nRUN-COMPLETE\n');
});

test('recorded run: the skipped specification owes no page, while a drawn step still owes its own', t => {
  const run = replayRecorded(t);
  assert.equal(readState(run).workflow.nodes['problem-approval'].values.with_spec, false);
  assert.equal(readState(run).workflow.nodes.specification.status, 'skipped');
  for (const file of ['analysis/feature-spec.md', 'analysis/feature-spec.html']) {
    assert.equal(fs.existsSync(path.join(run.dir, file)), false, file);
  }
  assert.equal(complete(run).stdout, 'RUN-COMPLETE\n');
  fs.rmSync(path.join(run.dir, 'analysis/alternatives.html'));
  assert.equal(complete(run).stdout, 'missing-companion: alternatives analysis/alternatives.html\nRUN-COMPLETE\n');
});

test('recorded run: the dashboard projects a product-design run with its icons and no characteristics', t => {
  const data = readDashboard(replayRecorded(t));
  assert.equal(data.task.type, 'product-design');
  assert.deepEqual(data.characteristics, {});
  const phase = id => data.phases.find(entry => entry.id === id);
  assert.equal(phase('intake').icon_hint, 'analysis');
  assert.equal(phase('convergence').icon_hint, 'plan');
  assert.equal(phase('specification').icon_hint, 'spec');
  assert.equal(phase('screens').icon_hint, 'spec');
  assert.equal(phase('brief').icon_hint, 'docs');
  assert.equal(phase('completion').icon_hint, 'done');
  assert.equal(phase('specification').status, 'skipped');
  assert.equal(phase('sketches').status, 'completed');
});

test('recorded run: resume-check reads it as an engine run of product-design', t => {
  const result = verb(['resume-check', `--state=${replayRecorded(t).state}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.workflow.name, 'product-design');
  assert.equal(report.status, 'completed');
});

test('recorded run: a missing delivery scope reads as the one missing artifact, on a single-repository run too', t => {
  const run = replayRecorded(t);
  fs.rmSync(path.join(run.dir, 'outputs/delivery-scope.yml'));
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'missing-artifact: brief outputs/delivery-scope.yml\nRUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// what a chain step may bind, and the delivery scope's shape
// ---------------------------------------------------------------------------

test('outputs: the brief, the delivery scope and the mockups are exposed under those names', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(JSON.stringify(doc.outputs)), {
    artifacts: {
      brief: 'brief.artifacts.brief',
      delivery_scope: 'brief.artifacts.delivery_scope',
      mockups: 'screens.artifacts.mockups',
    },
  });
});

/** A chain whose design step binds the named artifacts of product design and hands them on. */
function chainBinding(t, artifacts, inputs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const declared = Object.entries(artifacts).map(([key, at]) => `        ${key}: ${at}`);
  const handed = Object.keys(artifacts).map(key => `      ${key}: "\${design.artifacts.${key}}"`);
  fs.writeFileSync(path.join(dir, 'discovery.yml'), [
    'name: discovery', 'version: 1', 'inputs:', '  task_description: {type: string, required: true}', 'nodes:',
    '  design:', '    uses: workflow:product-design', '    needs: []', '    with:',
    '      task_description: "${inputs.task_description}"',
    ...Object.entries(inputs).map(([key, value]) => `      ${key}: ${value}`),
    '    outputs:', '      artifacts:', ...declared,
    '  delivery:', '    uses: direct:delivery', '    needs: [design]', '    with:', ...handed, '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'discovery.md'), '# Discovery\n\n## `delivery`\n\nPlans the delivery.\n');
  return verb(['validate', `--definition=${path.join(dir, 'discovery.yml')}`]);
}

test('outputs: a chain binds the brief and the delivery scope of a product-design step', t => {
  const result = chainBinding(t, { brief: 'outputs/product-brief.md', delivery_scope: 'outputs/delivery-scope.yml' });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('outputs: binding an artifact the workflow does not expose is named at validation', t => {
  const report = JSON.parse(chainBinding(t, { spec: 'analysis/feature-spec.md' }).stdout);
  assert.ok(report.warnings.includes('unresolved-subrun-output:design:spec'), report.warnings.join('\n'));
});

/** The documented rules of a delivery scope, checked over a parsed document. */
function assertDeliveryScope(scope) {
  assert.equal(scope.version, 1);
  assert.ok(Array.isArray(scope.members) && scope.members.length > 0);
  assert.ok(Array.isArray(scope.out_of_scope));
  const inScope = scope.members.map(member => member.name);
  const outOfScope = scope.out_of_scope.map(member => member.name);
  assert.equal(new Set([...inScope, ...outOfScope]).size, inScope.length + outOfScope.length);
  for (const member of scope.members) {
    assert.equal(typeof member.statement, 'string');
    assert.ok(Array.isArray(member.depends_on));
    for (const needed of member.depends_on) {
      assert.ok(inScope.includes(needed) && needed !== member.name, `${member.name} depends on ${needed}`);
    }
  }
  for (const member of scope.out_of_scope) assert.equal(typeof member.reason, 'string');
}

for (const [label, file] of [
  ['a single repository', 'runs/team-calendar-sharing/outputs/delivery-scope.yml'],
  ['a workspace', 'delivery-scope/workspace.yml'],
]) {
  test(`delivery scope: ${label} is written in the engine's YAML subset and keeps the documented rules`, () => {
    const at = path.join(FIXTURES, file);
    const { doc, errors } = parseDefinition(fs.readFileSync(at, 'utf8'), at);
    assert.deepEqual(errors, []);
    assertDeliveryScope(doc);
  });
}

// Every point the recorded run agreed — a decision a task step recorded, or a
// constraint of the problem — paired with the words that carry it in the
// scope. The decisions are read from the recorded summaries, so a point the
// fixture adds and the scope leaves out fails here.
const AGREED = {
  'reuse the existing invitation email for the share link': /existing invitation email/,
  'external guests get no account': /no guest accounts/,
  'access model: signed link': /signed link/,
  'detail shown: free and busy only': /free and busy only[^;]*;.*no event details shown/,
  'links expire after 30 days unless renewed': /expire after 30 days unless renewed/,
  'no guest accounts': /no guest accounts/,
  'revocable at any time': /revocable at any time/,
};

test('delivery scope: the recorded scope carries every point the run agreed, inclusions and exclusions alike', () => {
  const run = path.join(FIXTURES, 'runs/team-calendar-sharing');
  const recorded = parse(fs.readFileSync(path.join(run, 'recorded-state.yml'), 'utf8'));
  const tasks = Object.entries(recorded.node_summaries).filter(([id]) => recorded.workflow.nodes[id]?.kind !== 'gate' && recorded.node_summaries[id].status === 'completed');
  const agreed = new Set(tasks.flatMap(([, entry]) => [
    ...(entry.decisions ?? []).filter(decision => typeof decision === 'string' && !decision.endsWith(' recommended')),
    ...(entry.constraints ?? []),
  ]));
  assert.ok(agreed.size > 0);
  const at = path.join(run, 'outputs/delivery-scope.yml');
  const { doc } = parseDefinition(fs.readFileSync(at, 'utf8'), at);
  const statements = doc.members.map(member => member.statement).join(' ');
  for (const point of agreed) {
    assert.ok(Object.hasOwn(AGREED, point), `the agreed point "${point}" has no place in the scope`);
    assert.match(statements, AGREED[point], `the scope drops "${point}"`);
  }
});

// ---------------------------------------------------------------------------
// the definition, and the run as a sub-run
// ---------------------------------------------------------------------------

test('inputs: the outcome and the embedded flag are optional bools that default false, and no depth or visual switch is left', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual({ ...doc.inputs.specification }, { type: 'bool', required: false, default: false });
  assert.deepEqual({ ...doc.inputs.embedded }, { type: 'bool', required: false, default: false });
  assert.deepEqual(Object.keys(doc.inputs).sort(), ['embedded', 'research', 'specification', 'task_description']);
  assert.equal(doc.nodes.completion.when, '!${inputs.embedded}');
});

test('inputs: the shipped definition validates with no error, no warning and no impure skip guard', () => {
  const result = verb(['validate', `--definition=${PRODUCT_DESIGN}`]);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /skip-guard-not-pure/);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('decision areas: the alternatives declare the areas file, and the convergence is handed it and the sketch folder', () => {
  const result = verb(['resolve', `--definition=${PRODUCT_DESIGN}`]);
  assert.equal(result.code, 0, result.stderr);
  const nodes = Object.fromEntries(JSON.parse(result.stdout).nodes.map(node => [node.id, node]));
  assert.equal(nodes.alternatives.with.areas_output_path, 'analysis/decision-areas.json');
  assert.equal(nodes.alternatives.outputs.artifacts.decision_areas, 'analysis/decision-areas.json');
  assert.equal(nodes.convergence.with.decision_areas, '${alternatives.artifacts.decision_areas}');
  assert.equal(nodes.convergence.with.sketches, 'analysis/mockups');
  assert.ok(nodes.convergence.needs.includes('alternatives'), 'area-brief finds the file only through a direct need');

  // The recorded file is real: valid, marked, and fresh against the markdown it was stamped from.
  const taskDir = path.join(FIXTURES, 'runs/team-calendar-sharing');
  const file = path.join(taskDir, nodes.alternatives.outputs.artifacts.decision_areas);
  const loaded = loadAreas({ file, taskDir, sources: [nodes.alternatives.outputs.artifacts.alternatives] });
  assert.ok(loaded.areas, `the recorded areas file did not load: ${loaded.warning}`);
  assert.deepEqual(loaded.areas.map(area => [area.id, area.visual]), [['access-model', false], ['detail-shown', true]]);
});

// Each guard reads a node its own needs closure holds, and each revise stretch stays
// short and re-runnable. The closures are read off the definition; the stretches are
// what the walks below see the writer reset.
test('closures: every guarded read is behind its need, and each revise stretch is short and holds no sub-run', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  const closureOf = id => {
    const held = new Set();
    const visit = node => { for (const need of doc.nodes[node].needs) if (!held.has(need)) { held.add(need); visit(need); } };
    visit(id);
    return held;
  };
  const closures = {
    sketches: ['alternatives', 'intake'],
    specification: ['direction-approval', 'convergence', 'sketches', 'alternatives', 'problem-approval'],
    screens: ['intake'],
    'brief-approval': ['screens', 'specification'],
  };
  for (const [id, holds] of Object.entries(closures)) {
    for (const need of holds) assert.ok(closureOf(id).has(need), `${id}'s closure holds ${need}`);
  }

  const stretches = {
    'problem-approval': { 'correct-scope': ['intake', 'problem', 'problem-approval'], 'revise-problem': ['problem', 'problem-approval'] },
    'direction-approval': { 'revise-direction': ['convergence', 'direction-approval'] },
    'brief-approval': {
      'change-screens-and-brief': ['specification', 'screens', 'brief', 'brief-approval'],
      'change-brief': ['brief', 'brief-approval'],
    },
  };
  for (const [gate, options] of Object.entries(stretches)) {
    for (const [option, stretch] of Object.entries(options)) {
      assert.equal(doc.nodes[gate].options[option].reruns, stretch[0], option);
      assert.ok(stretch.length <= 10, option);
      assert.ok(closureOf(gate).has(stretch[0]), `${option}: the target waits behind the gate`);
      for (const id of stretch) assert.doesNotMatch(doc.nodes[id].uses ?? '', /^workflow:/, `${option}: ${id}`);
      // Every node of the stretch waits on the target and the gate waits on it, so nothing else belongs in it.
      for (const id of Object.keys(doc.nodes)) {
        const between = id === stretch[0] || id === gate || (closureOf(id).has(stretch[0]) && closureOf(gate).has(id));
        assert.equal(stretch.includes(id), between, `${option}: ${id}`);
      }
    }
  }
});

// A skipped node wrote nothing, so nothing it writes is interpolated into a node
// that still runs: a reader looks on disk, and only when the state records it completed.
test('guards: no node that may still run interpolates anything from a node a guard may skip', () => {
  const { doc } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  for (const [id, node] of Object.entries(doc.nodes)) {
    const refs = [...JSON.stringify(node.with ?? {}).matchAll(/\$\{([a-z0-9-]+)\./g)].map(match => match[1]);
    for (const ref of refs.filter(ref => ref !== 'inputs')) {
      const guard = doc.nodes[ref].when;
      assert.ok(!guard, `${id} interpolates ${ref}, which ${guard} may skip`);
    }
  }
});

test('outputs: a parent runs product design embedded and asks for the specification, binding the brief and the scope with no warning', t => {
  const result = chainBinding(t,
    { brief: 'outputs/product-brief.md', delivery_scope: 'outputs/delivery-scope.yml' },
    { embedded: 'true', specification: 'true' });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('embedded: the guard keeps completion off the path, so the child ends with the brief written', t => {
  const run = replayRecorded(t, null, { inputs: { embedded: true }, unrun: ['completion'] });
  assert.equal(readState(run).workflow.nodes.completion.status, 'pending');
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
});

test('embedded: a standalone run that never reached completion is refused as unfinished', t => {
  const result = complete(replayRecorded(t, null, { unrun: ['completion'] }));
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /completion/);
});

// ---------------------------------------------------------------------------
// the guards that steer the route
// ---------------------------------------------------------------------------

/** The status the run records for `node`. */
function statusOf(run, node) {
  return readState(run).workflow.nodes[node].status;
}

/** Completing `node` is refused and writes nothing, because `need` is still on the path the run takes. */
function assertHeldBy(run, node, need) {
  const before = fs.readFileSync(run.state, 'utf8');
  const refused = verb(['write-state', `--state=${run.state}`], { nodes: { [node]: { status: 'completed' } } });
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stderr, /state-node-needs-unmet/);
  assert.match(refused.stderr, new RegExp(`${need} is on the path`));
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
}

/** The run waiting right after `direction-approval` was answered, the next step not yet run. */
function pastDirection(t, options) {
  const run = atDirectionApproval(t, options);
  answer(run, 'direction-approval', 'approve-direction');
  return run;
}

test('guards: with_spec, the specification outcome runs the specification and the screens outcome records it skipped', t => {
  const withSpec = pastDirection(t, { outcome: 'brief-with-spec' });
  assert.equal(readState(withSpec).workflow.nodes['problem-approval'].values.with_spec, true);
  assertHeldBy(withSpec, 'screens', 'specification');
  const written = atBriefApproval(t, { outcome: 'brief-with-spec' });
  assert.equal(statusOf(written, 'specification'), 'completed');
  assert.equal(statusOf(written, 'screens'), 'completed');

  const withoutSpec = atBriefApproval(t, { outcome: 'brief-with-screens' });
  assert.equal(readState(withoutSpec).workflow.nodes['problem-approval'].values.with_spec, false);
  assert.equal(statusOf(withoutSpec, 'specification'), 'skipped');
  assert.equal(statusOf(withoutSpec, 'screens'), 'completed');
});

test('guards: the specification input runs the specification after the screens outcome, and the problem\'s brief recommends the other way on', t => {
  const inputs = { specification: true };
  const asked = pastDirection(t, { inputs, outcome: 'brief-with-screens' });
  assert.equal(readState(asked).workflow.nodes['problem-approval'].values.with_spec, false);
  assertHeldBy(asked, 'screens', 'specification');
  assert.equal(statusOf(atBriefApproval(t, { inputs, outcome: 'brief-with-screens' }), 'specification'), 'completed');

  const problemBrief = run => {
    const result = verb(['node-brief', `--state=${run.state}`, '--node=problem']);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split('\n');
  };
  assert.ok(problemBrief(freshRun(t, inputs)).includes('recommends: specification = true → brief-with-spec'));
  assert.ok(problemBrief(freshRun(t)).includes('recommends: specification = false — the section decides'));
});

test('guards: draws false skips the sketches and the screens, and the run completes with the brief and the scope and no mockups', t => {
  const run = atBriefApproval(t, { draws: false });
  assert.equal(statusOf(run, 'sketches'), 'skipped');
  assert.equal(statusOf(run, 'screens'), 'skipped');
  assert.equal(statusOf(run, 'brief'), 'completed');
  answer(run, 'brief-approval', 'approve-brief');
  walk(run, { task: { status: 'completed' }, nodes: { completion: { status: 'completed' } }, node_summaries: { completion: { summary: 'The brief is ready for the development workflow.' } } });

  // What the completed nodes declared, and the companions they owe; nothing the skipped nodes would have drawn.
  for (const file of [
    'analysis/scope.md', 'analysis/explore/project.md', 'analysis/problem-statement.md', 'analysis/personas.md',
    'analysis/alternatives.md', 'analysis/alternatives.html', 'analysis/decision-areas.json',
    'analysis/design-decisions.md', 'analysis/design-decisions.html',
    'outputs/product-brief.md', 'outputs/product-brief.html', 'outputs/delivery-scope.yml',
  ]) {
    const at = path.join(run.dir, file);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, 'written\n');
  }
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'RUN-COMPLETE\n');
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/mockups')), false);

  // The same run with the drawing on cannot reach the brief without its screens.
  assertHeldBy(pastDirection(t, { draws: true }), 'brief', 'screens');
});

test('guards: visual_areas false with draws true skips the sketches only', t => {
  const run = atBriefApproval(t, { draws: true, visualAreas: false });
  assert.equal(statusOf(run, 'sketches'), 'skipped');
  assert.equal(statusOf(run, 'screens'), 'completed');

  // Both bools true hold the convergence for the sketches.
  const drawn = atProblemApproval(t);
  answer(drawn, 'problem-approval', 'brief-with-screens');
  walk(drawn, { nodes: { alternatives: { status: 'completed', values: { visual_areas: true } } } });
  assertHeldBy(drawn, 'convergence', 'sketches');
});

test('brief-approval: with the screens skipped, the checkpoint marks them skipped and its panel is titled by the brief', t => {
  const run = atBriefApproval(t, { draws: false });
  const checkpoint = checkpointOf(run, 'brief-approval');
  const screens = checkpoint.closed.find(each => each.node === 'screens');
  assert.equal(screens.skipped, true);
  assert.equal(checkpoint.closed.find(each => each.node === 'brief').skipped, undefined);
  const panel = panelOfCheckpoint(checkpoint);
  assert.match(panel.glance[0], / · Product brief and delivery scope$/);
  assert.deepEqual(panel.parts[0], { key: 'title', label: `Checkpoint ${checkpoint.progress.checkpoint} of ${checkpoint.progress.checkpoints_max}`, text: 'Product brief and delivery scope' });

  // With the screens drawn, nothing is marked skipped.
  const drawn = checkpointOf(atBriefApproval(t, { draws: true }), 'brief-approval');
  assert.ok(drawn.closed.every(each => each.skipped === undefined), JSON.stringify(drawn.closed));
});

// The intake records `draws` afresh, so a corrected scope decides the drawing from
// then on, either way, whatever the first intake said.
test('guards: correct-scope records draws afresh, switching the sketches and the screens off or on', t => {
  const rescoped = (first, then) => {
    const run = atProblemApproval(t, { draws: first });
    const result = revise(run, 'problem-approval', 'correct-scope', first ? 'Nothing a person sees' : 'It has a screen after all');
    assert.equal(result.code, 0, result.stderr);
    walk(run, { nodes: { intake: { status: 'completed', values: { draws: then } } }, node_summaries: { intake: { summary: 'The scope, corrected.', absent: { research_context: 'no research task was named' } } } });
    walk(run, { nodes: { problem: { status: 'completed' } }, node_summaries: { problem: { summary: 'The problem, again.' } } });
    answer(run, 'problem-approval', 'brief-with-screens');
    walk(run, { nodes: { alternatives: { status: 'completed', values: { visual_areas: true } } }, node_summaries: { alternatives: { summary: 'Two decision areas.' } } });
    return run;
  };

  const off = rescoped(true, false);
  walk(off, { nodes: { convergence: { status: 'completed' } }, node_summaries: { convergence: { summary: 'Link-based sharing.' } } });
  assert.equal(statusOf(off, 'sketches'), 'skipped');
  answer(off, 'direction-approval', 'approve-direction');
  walk(off, { nodes: { brief: { status: 'completed' } }, node_summaries: { brief: { summary: 'The brief.' } } });
  assert.equal(statusOf(off, 'screens'), 'skipped');

  assertHeldBy(rescoped(false, true), 'convergence', 'sketches');
});

// ---------------------------------------------------------------------------
// the three gates
// ---------------------------------------------------------------------------

/** What `gate-brief` decides about a gate, before a picker shapes it. */
function checkpointOf(run, node) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/** A gate's options as `{id: label}`, so a comparison pins no order the spec does not state. */
function labelsOf(run, node) {
  return Object.fromEntries(checkpointOf(run, node).options.map(option => [option.id, option.label]));
}

const REVISED = (node, reruns, reset) => new RegExp(`^revised: ${node} reruns=${reruns} revision=1/10 reset=${reset.join(',')}$`, 'm');

test('problem-approval: five options with their labels and header, each continue\'s walk named, and the stop named in the rich question', t => {
  const run = atProblemApproval(t, { problem: { recommends: { option: 'brief-with-screens', reason: 'One screen, nothing to specify.' } } });
  assert.deepEqual(labelsOf(run, 'problem-approval'), {
    'brief-with-screens': 'A design brief',
    'brief-with-spec': 'A brief with a feature specification',
    'correct-scope': 'Correct the scope',
    'revise-problem': 'Revise the problem',
    'use-quick-design': 'Use quick-design instead',
  });

  // Both outcomes lead to the brainstorm; the specification comes after the direction.
  const rich = brief(run, 'problem-approval', '--picker=rich');
  assert.equal(rich.header, 'Scope');
  assert.match(rich.brief, /^Next \(a design brief\): Brainstorm alternatives$/m);
  assert.match(rich.brief, /^Next \(a brief with a feature specification\): Brainstorm alternatives$/m);
  assert.match(brief(run, 'problem-approval', '--oneline'), /Next \(brief-with-screens\): Brainstorm alternatives · Next \(brief-with-spec\): Brainstorm alternatives/);

  // The problem's own `recommends` marks its option, against the most-steps default.
  const marked = rich.options.filter(option => option.label.endsWith('(Recommended)')).map(option => option.id);
  assert.deepEqual(marked, ['brief-with-screens']);
  assert.equal(rich.options.find(option => option.id === 'brief-with-screens').label, 'A design brief (Recommended)');

  // Five are one more than the rich picker lists: the stop moves to the question.
  assert.deepEqual(rich.options.map(option => option.id).sort(), ['brief-with-screens', 'brief-with-spec', 'correct-scope', 'revise-problem']);
  assert.ok(rich.question.startsWith('The scope proposal, the problem and the personas are ready. Which outcome should this run produce?'), rich.question);
  assert.ok(rich.question.endsWith('Also offered, not listed: Use quick-design instead (use-quick-design); name one to choose it.'), rich.question);
});

test('problem-approval: a stop risk recommends quick-design, so the rich picker lists it and names "Revise the problem"; the plain picker lists all five', t => {
  const run = atProblemApproval(t, { problem: { risks: [{ risk: 'How the share card behaves: one bounded question', tag: 'stop' }] } });
  const rich = brief(run, 'problem-approval', '--picker=rich');
  assert.deepEqual(rich.options.map(option => option.id).sort(), ['brief-with-screens', 'brief-with-spec', 'correct-scope', 'use-quick-design']);
  assert.equal(rich.options.find(option => option.id === 'use-quick-design').label, 'Use quick-design instead (Recommended)');
  assert.ok(rich.question.endsWith('Also offered, not listed: Revise the problem (revise-problem); name one to choose it.'), rich.question);

  const plain = brief(run, 'problem-approval', '--picker=plain');
  const ids = plain.options.map(option => option.id);
  assert.equal(ids.at(-1), 'more-details');
  assert.deepEqual(ids.slice(0, -1).sort(), ['brief-with-screens', 'brief-with-spec', 'correct-scope', 'revise-problem', 'use-quick-design']);
  assert.doesNotMatch(plain.question, /Also offered/);
});

test('problem-approval: a stop ends the run, every unexecuted node stopped', t => {
  const run = atProblemApproval(t);
  const unexecuted = ['alternatives', 'sketches', 'convergence', 'direction-approval', 'specification', 'screens', 'brief', 'brief-approval', 'completion'];
  const stopped = write(run, {
    task: { status: 'stopped' },
    nodes: Object.fromEntries([['problem-approval', { status: 'completed' }], ...unexecuted.map(id => [id, { status: 'stopped' }])]),
    node_summaries: { 'problem-approval': { decisions: [{ option: 'use-quick-design' }] } },
  });
  assert.equal(stopped.code, 0, stopped.stderr);
  for (const id of unexecuted) assert.equal(statusOf(run, id), 'stopped', id);
  const close = complete(run);
  assert.equal(close.code, 0, close.stderr);
  assert.ok(close.stdout.endsWith('run stopped: problem-approval - use-quick-design\nRUN-COMPLETE\n'), close.stdout);
});

test('direction-approval and brief-approval: a stop ends the run, every unexecuted node stopped', t => {
  const close = (run, gate, unexecuted) => {
    const stopped = write(run, {
      task: { status: 'stopped' },
      nodes: Object.fromEntries([[gate, { status: 'completed' }], ...unexecuted.map(id => [id, { status: 'stopped' }])]),
      node_summaries: { [gate]: { decisions: [{ option: 'stop-design' }] } },
    });
    assert.equal(stopped.code, 0, stopped.stderr);
    for (const id of unexecuted) assert.equal(statusOf(run, id), 'stopped', id);
    const result = complete(run);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.endsWith(`run stopped: ${gate} - stop-design\nRUN-COMPLETE\n`), result.stdout);
  };
  close(atDirectionApproval(t), 'direction-approval', ['specification', 'screens', 'brief', 'brief-approval', 'completion']);
  close(atBriefApproval(t), 'brief-approval', ['completion']);
});

test('problem-approval: correct-scope re-runs the intake, the problem and the gate, and revise-problem the problem and the gate', t => {
  const scope = atProblemApproval(t);
  const corrected = revise(scope, 'problem-approval', 'correct-scope', 'Guests are outside the organisation only');
  assert.equal(corrected.code, 0, corrected.stderr);
  assert.match(corrected.stdout, REVISED('problem-approval', 'intake', ['intake', 'problem', 'problem-approval']));
  for (const id of ['intake', 'problem', 'problem-approval']) assert.equal(statusOf(scope, id), 'pending', id);

  const problem = atProblemApproval(t);
  const revised = revise(problem, 'problem-approval', 'revise-problem', 'Name the guest persona');
  assert.equal(revised.code, 0, revised.stderr);
  assert.match(revised.stdout, REVISED('problem-approval', 'problem', ['problem', 'problem-approval']));
  assert.equal(statusOf(problem, 'intake'), 'completed', 'the intake is not run again');
  assert.equal(statusOf(problem, 'problem'), 'pending');
});

test('direction-approval: its labels and header, the continue named from the walk, and revise-direction re-runs the convergence alone', t => {
  const run = atDirectionApproval(t);
  assert.equal(brief(run, 'direction-approval', '--picker=rich').header, 'Direction');
  assert.deepEqual(labelsOf(run, 'direction-approval'), {
    'approve-direction': 'Continue to final screens',
    'revise-direction': 'Revise the direction',
    'stop-design': 'Stop here',
  });
  // The same definition label, completed from where the outcome chosen earlier leads.
  assert.equal(labelsOf(atDirectionApproval(t, { outcome: 'brief-with-spec' }), 'direction-approval')['approve-direction'], 'Continue to feature specification');

  const result = revise(run, 'direction-approval', 'revise-direction', 'Show event titles to guests');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, REVISED('direction-approval', 'convergence', ['convergence', 'direction-approval']));
  assert.equal(statusOf(run, 'convergence'), 'pending');
  for (const id of ['problem-approval', 'alternatives', 'sketches']) assert.equal(statusOf(run, id), 'completed', `${id} is not run again`);
});

// The brainstorm writes its risks before any answer; the convergence writes its own
// after them. A risk an answer settled must not reach the direction gate from the brainstorm.
test('direction-approval: the brainstorm\'s open risks give way to the convergence that asked its areas, while the sketches\' still show', t => {
  const settled = 'The open count and empty-state wording is not its own decision area: it follows the filter';
  const run = atDirectionApproval(t, {
    alternatives: { risks: [{ risk: settled, tag: 'open', change: 'make it its own area' }, { risk: 'Colour alone never marks a level', tag: 'tradeoff' }] },
    convergence: {
      summary: 'A text badge on every row, and a dropdown filter on the tab row whose count and empty state name it.',
      decisions: [{ decision: 'filter control: dropdown on the tab row', by: 'operator', as_recommended: true }],
      risks: [{ risk: 'A capitalised level such as High is refused', tag: 'tradeoff' }],
    },
  });
  const checkpoint = checkpointOf(run, 'direction-approval');
  assert.deepEqual(checkpoint.risks.open, [], 'no open risk is carried from the brainstorm');
  assert.deepEqual(checkpoint.risks.tradeoff.map(each => each.risk), ['A capitalised level such as High is refused', 'Colour alone never marks a level']);
  const plain = verb(['gate-brief', `--state=${run.state}`, '--node=direction-approval']).stdout;
  assert.doesNotMatch(plain, /empty-state wording/);
  assert.doesNotMatch(plain, /Open risks/);

  // The sketches are behind the gate too, but asked no areas: their open risk stays.
  const drawn = atDirectionApproval(t, {
    alternatives: { risks: [{ risk: settled, tag: 'open' }] },
    sketches: { risks: [{ risk: 'grounding-unavailable: drawn from the codebase alone', tag: 'open' }] },
  });
  assert.deepEqual(checkpointOf(drawn, 'direction-approval').risks.open.map(each => each.risk), ['grounding-unavailable: drawn from the codebase alone']);
});

// A driver without question sets leaves the choice to this gate, and what it is handed is
// the request. The summary is the one the convergence's section has it write.
test('direction-approval: a convergence left open under a driver offers each area as a concrete switch', t => {
  const run = atDirectionApproval(t, {
    driver: { kind: 'cockpit', cwd: '/work' },
    convergence: {
      summary: 'Direction proposed, not chosen: two areas await your choice at this gate.',
      decisions: [
        { decision: 'access model: signed link recommended — adopted if you continue', by: 'run' },
        { decision: 'detail shown: free and busy only recommended — adopted if you continue', by: 'run' },
      ],
      risks: [
        { risk: 'access model: signed link is adopted if you continue', tag: 'open', change: 'take guest accounts instead' },
        { risk: 'detail shown: free and busy only is adopted if you continue', tag: 'open', change: 'take event titles instead' },
      ],
    },
  });
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=direction-approval', '--request']);
  assert.equal(result.code, 0, result.stderr);
  const request = JSON.parse(result.stdout);
  assert.equal(request.options[0].id, 'approve-direction', 'continuing — adopting the recommendations — is recommended');
  assert.equal(request.options[0].recommended, true);
  assert.deepEqual(request.options.find(option => option.id === 'revise-direction').suggestions.map(each => each.note), [
    'access model: signed link is adopted if you continue — take guest accounts instead',
    'detail shown: free and busy only is adopted if you continue — take event titles instead',
  ]);
  assert.deepEqual(request.context.checkpoint.decisions.run.map(each => each.decision), [
    'access model: signed link recommended — adopted if you continue',
    'detail shown: free and busy only recommended — adopted if you continue',
  ], 'the recommendations stay the run\'s until the gate is answered');
  const oneline = brief(run, 'direction-approval', '--oneline');
  assert.match(oneline, /revise: revise-direction reruns=convergence revision=1\/10/);
  assert.match(oneline, /Recommended: approve-direction/);
});

test('brief-approval: change-screens-and-brief resets a skipped specification and skips it again, and re-runs a written one with the rest', t => {
  const stretch = ['specification', 'screens', 'brief', 'brief-approval'];
  const closeBehind = run => {
    walk(run, { nodes: { screens: { status: 'completed' } }, node_summaries: { screens: { summary: 'v003 of the final screens.' } } });
    walk(run, { nodes: { brief: { status: 'completed' } }, node_summaries: { brief: { summary: 'The brief, rewritten.' } } });
  };

  // Skipped: the stretch is reset whole, and the false guard skips it again on the way.
  const skipped = atBriefApproval(t);
  const screensOnly = brief(skipped, 'brief-approval', '--picker=rich').options.find(option => option.id === 'change-screens-and-brief');
  assert.match(screensOnly.description, /^Re-runs Final screens and Product brief and delivery scope with your note/);
  const reset = revise(skipped, 'brief-approval', 'change-screens-and-brief', 'Add the guest view');
  assert.equal(reset.code, 0, reset.stderr);
  assert.match(reset.stdout, REVISED('brief-approval', 'specification', stretch));
  for (const id of stretch) assert.equal(statusOf(skipped, id), 'pending', id);
  closeBehind(skipped);
  assert.equal(statusOf(skipped, 'specification'), 'skipped', 'its guard still reads false');
  assert.equal(statusOf(skipped, 'screens'), 'completed');
  assert.equal(statusOf(skipped, 'brief'), 'completed');

  // Written: the guard reads true, so the screens wait for the specification again.
  const written = atBriefApproval(t, { outcome: 'brief-with-spec' });
  const allThree = brief(written, 'brief-approval', '--picker=rich').options.find(option => option.id === 'change-screens-and-brief');
  assert.match(allThree.description, /^Re-runs Feature specification, Final screens and Product brief and delivery scope with your note/);
  const again = revise(written, 'brief-approval', 'change-screens-and-brief', 'Add the guest view');
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, REVISED('brief-approval', 'specification', stretch));
  assertHeldBy(written, 'screens', 'specification');
  walk(written, { nodes: { specification: { status: 'completed' } }, node_summaries: { specification: { summary: 'The guest view added.' } } });
  closeBehind(written);
  for (const id of ['specification', 'screens', 'brief']) assert.equal(statusOf(written, id), 'completed', id);
});

test('brief-approval: its labels and header, the review naming the brief and the mockups folder, and change-brief re-runs the brief alone', t => {
  const run = atBriefApproval(t);
  for (const file of ['outputs/product-brief.md', 'analysis/mockups/index.html']) {
    fs.mkdirSync(path.dirname(path.join(run.dir, file)), { recursive: true });
    fs.writeFileSync(path.join(run.dir, file), 'written\n');
  }
  assert.deepEqual(labelsOf(run, 'brief-approval'), {
    'approve-brief': 'Approve the brief',
    'change-screens-and-brief': 'Change the screens and brief',
    'change-brief': 'Change the brief only',
    'stop-design': 'Stop here',
  });
  const rich = brief(run, 'brief-approval', '--picker=rich');
  assert.equal(rich.header, 'Brief');
  const review = rich.brief.split('\n').find(line => line.startsWith('Review:'));
  assert.ok(review, rich.brief);
  assert.match(review, /outputs\/product-brief\.md/);
  assert.match(review, /analysis\/mockups\//);

  const result = revise(run, 'brief-approval', 'change-brief', 'Tighten the scope section');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, REVISED('brief-approval', 'brief', ['brief', 'brief-approval']));
  assert.equal(statusOf(run, 'brief'), 'pending');
  assert.equal(statusOf(run, 'screens'), 'completed', 'the screens are not drawn again');
});

// ---------------------------------------------------------------------------
// the intake's delegate, and the flags beside the inputs
// ---------------------------------------------------------------------------

test('delegates: completing the intake without Explore listed is refused and writes nothing', t => {
  const closing = delegated => ({
    nodes: { intake: { status: 'completed', values: { draws: true } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.', absent: { research_context: 'no research task was named' }, ...delegated } },
  });
  const run = freshRun(t);
  const before = fs.readFileSync(run.state, 'utf8');
  for (const delegated of [{}, { delegated: [] }, { delegated: ['general-purpose'] }]) {
    const refused = verb(['write-state', `--state=${run.state}`], closing(delegated));
    assert.equal(refused.code, 1, refused.stdout);
    assert.match(refused.stderr, /state-delegates-unrecorded/);
    assert.match(refused.stderr, /Explore/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  }
  const landed = verb(['write-state', `--state=${run.state}`], closing({ delegated: ['Explore'] }));
  assert.equal(landed.code, 0, landed.stderr);
  assert.equal(statusOf(run, 'intake'), 'completed');
});

test('parity: every flag the skill maps names a declared input, and every input an operator sets has a flag', () => {
  const skill = fs.readFileSync(path.join(ENGINE_DIR, '../product-design/SKILL.md'), 'utf8');
  const bullets = skill.split(/^- /m).filter(bullet => bullet.includes('input of the definition'));
  assert.equal(bullets.length, 1, 'the flags bullet');
  const mapped = new Map([...bullets[0].matchAll(/`--([a-z-]+)(?:=[A-Z]+)?` is `([a-z_]+)`/g)].map(match => [match[1], match[2]]));
  assert.ok(mapped.size > 0, 'the flags bullet maps no flag');
  assert.deepEqual([...bullets[0].matchAll(/--([a-z-]+)/g)].map(match => match[1]), [...mapped.keys()], 'a flag the bullet names and does not map');

  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  for (const [flag, input] of mapped) assert.ok(Object.hasOwn(doc.inputs, input), `--${flag} names ${input}, which is not an input`);
  const flagged = new Set(mapped.values());
  for (const input of Object.keys(doc.inputs)) {
    if (['task_description', 'embedded', 'specification'].includes(input)) continue;
    assert.ok(flagged.has(input), `the input ${input} has no flag`);
  }
});
