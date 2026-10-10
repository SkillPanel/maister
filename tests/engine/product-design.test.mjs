import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, lastLine, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';
import { parseDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// The product-design workflow on the engine. A synthetic run — an invented
// enhancement with a UI and no personas — is replayed against the shipped
// definition, and partial runs built here stand at each gate whose shape is
// particular to this workflow: the unguarded gates that close a guarded node,
// the direction gate's two ways back, and the convergence a driven run leaves
// open for that gate to decide.

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
 * then the recorded outcomes, summaries and design context replayed in one
 * closing write. `absent` is laid over the recorded summaries by node id.
 */
function replayRecorded(t, absent = null, { inputs = {}, unrun = [] } = {}) {
  const run = scratch(t, { fixture: 'team-calendar-sharing', type: 'product-design', name: RUN_NAME });
  const recorded = parse(fs.readFileSync(path.join(run.dir, 'recorded-state.yml'), 'utf8'));
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { ...recorded.orchestrator.options.inputs, ...inputs } });
  const nodes = {};
  for (const [id, entry] of Object.entries(recorded.workflow.nodes)) {
    if (unrun.includes(id)) continue;
    nodes[id] = { status: entry.status, ...(entry.values ? { values: { ...entry.values } } : {}) };
  }
  const summaries = JSON.parse(JSON.stringify(recorded.node_summaries));
  for (const id of unrun) delete summaries[id];
  if (absent !== null) {
    for (const [id, entries] of Object.entries(absent)) {
      if (entries === null) delete summaries[id].absent;
      else summaries[id].absent = entries;
    }
  }
  const { phase_summaries: phases, ...context } = JSON.parse(JSON.stringify(recorded.design_context));
  write(run, {
    task: { status: recorded.task.status },
    nodes,
    context,
    phase_summaries: phases,
    node_summaries: summaries,
  });
  return run;
}

/**
 * A fresh run of the shipped definition walked to `problem-approval`, with the
 * persona exploration run or skipped as `personas` says, and the prototypes
 * enabled as `prototyping` says.
 */
function atProblemApproval(t, { personas, prototyping = true }) {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: personas, prototyping_enabled: prototyping, complexity_level: 'standard' } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.', absent: { research_context: 'no research task was named' } } },
  });
  write(run, { nodes: { 'characteristics-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'context-synthesis': { status: 'completed' } },
    node_summaries: { 'context-synthesis': { summary: 'Calendars are private to the organisation today.' } },
  });
  write(run, { nodes: { 'context-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'problem-exploration': { status: 'completed' } },
    node_summaries: {
      'problem-exploration': {
        summary: 'Teams cannot show availability to outside guests.',
        decisions: ['External guests get no account'],
        risks: ['open: assumes guests accept a link instead of a login'],
      },
    },
  });
  write(run, personas
    ? {
      nodes: { 'persona-exploration': { status: 'completed' } },
      node_summaries: { 'persona-exploration': { summary: 'Two personas: the organiser and the outside guest.' } },
    }
    : { nodes: { 'persona-exploration': { status: 'skipped' } } });
  return run;
}

/** A fresh run walked to `direction-approval`, its convergence left as `convergence` says. */
function atDirectionApproval(t, convergence, { prototyping = true } = {}) {
  const run = atProblemApproval(t, { personas: false, prototyping });
  write(run, { nodes: { 'problem-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'idea-generation': { status: 'completed' } },
    node_summaries: { 'idea-generation': { summary: 'Two decision areas, five alternatives.' } },
  });
  write(run, { nodes: { 'idea-convergence': { status: 'completed' } }, node_summaries: { 'idea-convergence': convergence } });
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

test('recorded run: the skipped personas owe nothing, and the closing check does not look for them', t => {
  const run = replayRecorded(t);
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/personas.md')), false);
  assert.equal(readState(run).workflow.nodes['persona-exploration'].status, 'skipped');
  assert.equal(complete(run).stdout, 'RUN-COMPLETE\n');
});

test('recorded run: the dashboard projects a product-design run with its characteristics and icons', t => {
  const data = readDashboard(replayRecorded(t));
  assert.equal(data.task.type, 'product-design');
  assert.equal(data.characteristics.is_ui_focused, true);
  assert.equal(data.characteristics.is_greenfield, false);
  const phase = id => data.phases.find(entry => entry.id === id);
  assert.equal(phase('idea-convergence').icon_hint, 'plan');
  assert.equal(phase('visual-prototyping').icon_hint, 'spec');
  assert.equal(phase('review-handoff').icon_hint, 'docs');
  assert.equal(phase('completion').icon_hint, 'done');
  assert.equal(phase('persona-exploration').status, 'skipped');
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
  assert.equal(result.stdout, 'missing-artifact: review-handoff outputs/delivery-scope.yml\nRUN-COMPLETE\n');
});

// ---------------------------------------------------------------------------
// what a chain step may bind, and the delivery scope's shape
// ---------------------------------------------------------------------------

test('outputs: the brief, the delivery scope and the mockups are exposed under those names', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(JSON.stringify(doc.outputs)), {
    artifacts: {
      brief: 'review-handoff.artifacts.brief',
      delivery_scope: 'review-handoff.artifacts.delivery_scope',
      mockups: 'visual-prototyping.artifacts.mockups',
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

// ---------------------------------------------------------------------------
// the gates that close a guarded node
// ---------------------------------------------------------------------------

test('problem-approval: with the personas skipped, the brief renders the problem statement and names the personas skipped', t => {
  const picker = brief(atProblemApproval(t, { personas: false }), 'problem-approval');
  assert.equal(picker.ok, true);
  assert.equal(picker.header, 'Problem');
  assert.match(picker.brief, /^Problem exploration: Teams cannot show availability to outside guests\.\n\nUser and persona exploration: Skipped\.\n/);
  assert.match(picker.brief, /Next: Idea generation/);
  assert.deepEqual(picker.options.map(option => option.id), ['continue-to-idea-generation', 'revise-problem', 'stop-design', 'more-details']);
});

test('problem-approval: with the personas drafted, the brief renders both summaries', t => {
  const picker = brief(atProblemApproval(t, { personas: true }), 'problem-approval');
  assert.match(picker.brief, /Problem exploration: Teams cannot show availability/);
  assert.match(picker.brief, /User and persona exploration: Two personas/);
});

test('problem-approval: the revise names only the nodes that will run again', t => {
  const named = personas => brief(atProblemApproval(t, { personas }), 'problem-approval')
    .options.find(option => option.id === 'revise-problem').description;
  assert.equal(named(false), 'Re-runs Problem exploration with your note, then asks this again.',
    'personas skipped on a guard the re-run does not change are skipped again');
  assert.equal(named(true), 'Re-runs Problem exploration and User and persona exploration with your note, then asks this again.');
});

test('problem-approval: revise suggestions are generated from what the stretch left open', t => {
  const picker = brief(atProblemApproval(t, { personas: false }), 'problem-approval');
  const revise = picker.options.find(option => option.id === 'revise-problem');
  assert.deepEqual(revise.reruns.map(each => each.node), ['problem-exploration']);
  assert.deepEqual(revise.suggestions.map(each => each.note), [
    'Address this in the re-run: assumes guests accept a link instead of a login',
  ], 'the open assumption only: the decision beside it names no alternative');
  assert.ok(revise.suggestions.every(each => each.recommended === false), 'a suggestion is offered, never recommended');
});

test('problem-approval: a revise re-runs the problem statement and the personas behind it', t => {
  const run = atProblemApproval(t, { personas: true });
  const result = revise(run, 'problem-approval', 'revise-problem', 'Guests need a login after all');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: problem-approval reruns=problem-exploration revision=1\/10 reset=problem-exploration,persona-exploration,problem-approval$/m);
  const nodes = readState(run).workflow.nodes;
  for (const id of ['problem-exploration', 'persona-exploration', 'problem-approval']) assert.equal(nodes[id].status, 'pending', id);
  assert.equal(nodes['context-synthesis'].status, 'completed');
});

test('characteristics-approval: a correction re-runs the intake, which derives the guards afresh', t => {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: false, prototyping_enabled: true, complexity_level: 'standard' } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.' } },
  });
  const result = revise(run, 'characteristics-approval', 'revise-characteristics', 'This is a new product, not an enhancement');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: characteristics-approval reruns=intake revision=1\/10 reset=intake,characteristics-approval$/m);
});

test('context-approval: a correction re-runs the context synthesis alone', t => {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: false, prototyping_enabled: true, complexity_level: 'standard' } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.' } },
  });
  write(run, { nodes: { 'characteristics-approval': { status: 'completed' }, 'context-synthesis': { status: 'completed' } } });
  const result = revise(run, 'context-approval', 'revise-context', 'Guests already get invites by email');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: context-approval reruns=context-synthesis revision=1\/10 reset=context-synthesis,context-approval$/m);
  assert.equal(readState(run).workflow.nodes.intake.status, 'completed', 'the intake is not run again');
});

// ---------------------------------------------------------------------------
// the direction gate
// ---------------------------------------------------------------------------

test('direction-approval: exploring more alternatives re-runs the brainstorm and the convergence', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.', decisions: ['access model: signed link'] });
  const result = revise(run, 'direction-approval', 'explore-more-alternatives', 'None of these handles a shared mailbox');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reruns=idea-generation revision=1\/10 reset=idea-generation,idea-convergence,direction-approval$/m);
  assert.equal(readState(run).workflow.nodes['problem-approval'].status, 'completed', 'the earlier gate is not asked again');
});

test('direction-approval: refining the direction re-runs the convergence alone', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.', decisions: ['access model: signed link'] });
  const result = revise(run, 'direction-approval', 'refine-direction', 'Show event titles to guests');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reruns=idea-convergence revision=1\/10 reset=idea-convergence,direction-approval$/m);
});

test('direction-approval: a convergence left open under a driver offers each area as a concrete switch', t => {
  const run = atDirectionApproval(t, {
    summary: 'Direction proposed, not chosen: two areas await your choice at this gate.',
    decisions: [
      'access model: signed link recommended — adopted if you continue',
      'detail shown: free and busy only recommended — adopted if you continue',
    ],
    risks: [
      'open: access model — take guest accounts instead of the recommended signed link',
      'open: detail shown — take event titles instead of the recommended free and busy only',
    ],
  });
  const picker = brief(run, 'direction-approval');
  assert.equal(picker.options[0].id, 'continue-to-specification', 'continuing — adopting the recommendations — is recommended');
  const refine = picker.options.find(option => option.id === 'refine-direction');
  assert.deepEqual(refine.suggestions.slice(0, 2).map(each => each.note), [
    'Address this in the re-run: access model — take guest accounts instead of the recommended signed link',
    'Address this in the re-run: detail shown — take event titles instead of the recommended free and busy only',
  ]);
  const oneline = brief(run, 'direction-approval', '--oneline');
  assert.match(oneline, /revise: refine-direction reruns=idea-convergence revision=1\/10/);
  assert.match(oneline, /revise: explore-more-alternatives reruns=idea-generation revision=1\/10/);
  assert.match(oneline, /Recommended: continue-to-specification/);
});

test('direction-approval: its four options fill Claude Code\'s slots, so the question asks for "details" to be typed', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.', decisions: ['access model: signed link'] });
  const rich = brief(run, 'direction-approval');
  assert.deepEqual(rich.options.map(option => option.id),
    ['continue-to-specification', 'explore-more-alternatives', 'refine-direction', 'stop-design']);
  assert.equal(rich.details, 'typed');
  assert.match(rich.question, / Type "details" for the full brief\.$/);
  const plain = brief(run, 'direction-approval', '--picker=plain');
  assert.equal(plain.details, 'option');
  assert.equal(plain.options.at(-1).id, 'more-details');
});

// ---------------------------------------------------------------------------
// the specification gate
// ---------------------------------------------------------------------------

test('specification-approval: with no screens to draw, the brief renders the specification and names the prototypes skipped', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.' }, { prototyping: false });
  write(run, { nodes: { 'direction-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'feature-specification': { status: 'completed' } },
    node_summaries: { 'feature-specification': { summary: 'Five sections, from the sharing model to notifications.' } },
  });
  write(run, { nodes: { 'visual-prototyping': { status: 'skipped' } } });
  const picker = brief(run, 'specification-approval');
  assert.equal(picker.header, 'Spec');
  assert.match(picker.brief, /^Feature specification: Five sections, from the sharing model to notifications\.\n\nVisual prototyping: Skipped\.\n/);
  assert.match(picker.brief, /Next: Product brief and delivery scope/);
  assert.equal(picker.options.find(option => option.id === 'revise-specification').description,
    'Re-runs Feature specification with your note, then asks this again.');
  const result = revise(run, 'specification-approval', 'revise-specification', 'Add a revocation section');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reset=feature-specification,visual-prototyping,specification-approval$/m);
});

test('specification-approval: a long specification never trims the prototypes and their gallery out of the brief', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.' });
  write(run, { nodes: { 'direction-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'feature-specification': { status: 'completed' } },
    node_summaries: {
      'feature-specification': {
        summary: Array.from({ length: 40 }, (_, i) => `Section ${i} specifies one more part of sharing with guests.`).join(' '),
        decisions: Array.from({ length: 6 }, (_, i) => `Decision ${i} settles one scope question. Its rationale runs on at length.`),
        risks: Array.from({ length: 6 }, (_, i) => `open: question ${i} still needs an answer. The section says which.`),
      },
    },
  });
  write(run, {
    nodes: { 'visual-prototyping': { status: 'completed' } },
    node_summaries: {
      'visual-prototyping': {
        summary: `Gallery: http://localhost:3847 — open a screen from the grid. ${Array.from({ length: 20 }, (_, i) => `Screen ${i} shows the guest view.`).join(' ')}`,
      },
    },
  });
  const picker = brief(run, 'specification-approval');
  assert.match(picker.brief, /^Feature specification: Section 0 specifies/);
  assert.match(picker.brief, /^Visual prototyping: Gallery: http:\/\/localhost:3847 — open a screen from the grid\./m);
  assert.match(picker.brief, /^Decisions \(\+3 more in the dashboard\):\n- Decision 0 settles one scope question\.$/m);
  assert.match(picker.brief, /Next: Product brief and delivery scope/);
});

test('specification-approval: the prototypes are offered for review beside the specification, by their folder', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.' });
  write(run, { nodes: { 'direction-approval': { status: 'completed' } } });
  const onDisk = (relative, text) => {
    fs.mkdirSync(path.dirname(path.join(run.dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(run.dir, relative), text);
  };
  onDisk('analysis/feature-spec.md', '# Feature specification\n');
  write(run, {
    nodes: { 'feature-specification': { status: 'completed' } },
    node_summaries: { 'feature-specification': { summary: 'Five sections.', artifacts: [{ path: 'analysis/feature-spec.md', label: 'Feature spec', role: 'primary' }] } },
  });
  // The studio drew its screens and the node registered none of them by name.
  for (const screen of ['share-dialog', 'guest-calendar']) onDisk(`analysis/mockups/${screen}.html`, '<p>screen</p>\n');
  write(run, { nodes: { 'visual-prototyping': { status: 'completed' } }, node_summaries: { 'visual-prototyping': { summary: 'Two screens.' } } });
  const checkpoint = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=specification-approval', '--checkpoint']).stdout);
  assert.deepEqual(checkpoint.review.map(each => [each.path, each.label]),
    [['analysis/feature-spec.md', 'Feature spec'], ['analysis/mockups/', '2 files']]);
});

// ---------------------------------------------------------------------------
// as a sub-run, and at the simple depth
// ---------------------------------------------------------------------------

const DEPTH_SKIPS = ['characteristics-approval', 'context-approval', 'idea-generation', 'idea-convergence', 'direction-approval'];

test('inputs: the depth and the embedded flag are optional bools that default to the full, standalone run', () => {
  const { doc, errors } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual({ ...doc.inputs.simple }, { type: 'bool', required: false, default: false });
  assert.deepEqual({ ...doc.inputs.embedded }, { type: 'bool', required: false, default: false });
  assert.equal(doc.nodes.completion.when, '!${inputs.embedded}');
  // The full depth guards nothing itself: the intake reads it and records the design complex.
  assert.deepEqual({ ...doc.inputs.full }, { type: 'bool', required: false, default: false });
  assert.equal(doc.nodes.intake.with.full, '${inputs.full}');
  for (const [id, node] of Object.entries(doc.nodes)) assert.doesNotMatch(node.when ?? '', /inputs\.full/, id);
  for (const id of DEPTH_SKIPS) assert.equal(doc.nodes[id].when, '!${inputs.simple}', id);
});

test('inputs: the shipped definition validates with no warning', () => {
  const result = verb(['validate', `--definition=${PRODUCT_DESIGN}`]);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('decision areas: the idea generation declares the areas file and the convergence is handed it', () => {
  const result = verb(['resolve', `--definition=${PRODUCT_DESIGN}`]);
  assert.equal(result.code, 0, result.stderr);
  const nodes = Object.fromEntries(JSON.parse(result.stdout).nodes.map(node => [node.id, node]));
  const generation = nodes['idea-generation'];
  assert.equal(generation.with.areas_output_path, 'analysis/decision-areas.json');
  assert.equal(generation.outputs.artifacts.decision_areas, 'analysis/decision-areas.json');
  assert.equal(nodes['idea-convergence'].with.decision_areas, '${idea-generation.artifacts.decision_areas}');
  assert.equal(nodes['idea-convergence'].when, generation.when);
});

// A node may read a guarded node only when it carries the very same guard, so
// the two always run or are skipped together.
test('guards: no node that may still run interpolates anything from a node a guard may skip', () => {
  const { doc } = parseDefinition(fs.readFileSync(PRODUCT_DESIGN, 'utf8'), PRODUCT_DESIGN);
  for (const [id, node] of Object.entries(doc.nodes)) {
    const refs = [...JSON.stringify(node.with ?? {}).matchAll(/\$\{([a-z0-9-]+)\./g)].map(match => match[1]);
    for (const ref of refs.filter(ref => ref !== 'inputs')) {
      const guard = doc.nodes[ref].when;
      assert.ok(!guard || guard === node.when, `${id} interpolates ${ref}, which ${guard} may skip`);
    }
  }
});

test('outputs: a parent runs product design embedded and at the simple depth, binding the brief and the scope with no warning', t => {
  const result = chainBinding(t,
    { brief: 'outputs/product-brief.md', delivery_scope: 'outputs/delivery-scope.yml' },
    { embedded: 'true', simple: 'true' });
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('outputs: a parent asks product design for the full design, binding the brief and the scope with no warning', t => {
  const result = chainBinding(t,
    { brief: 'outputs/product-brief.md', delivery_scope: 'outputs/delivery-scope.yml' },
    { embedded: 'true', full: 'true' });
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

/**
 * A run walked along the simple path only: the nodes the depth skips, the
 * personas and the prototypes are left pending, for the guards to keep off
 * the path.
 */
function simplePath(t, simple) {
  const run = scratch(t, { fixture: 'team-calendar-sharing', type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK, simple } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: false, prototyping_enabled: false, complexity_level: 'simple' } } },
    node_summaries: { intake: { summary: 'A simple enhancement.', absent: { research_context: 'no research task was named' } } },
  });
  for (const id of ['context-synthesis', 'problem-exploration', 'problem-approval', 'feature-specification',
    'specification-approval', 'review-handoff', 'completion']) {
    write(run, { nodes: { [id]: { status: 'completed' } } });
  }
  write(run, { task: { status: 'completed' } });
  return run;
}

test('simple: the depth keeps the skipped gates and the idea stretch off the path', t => {
  const run = simplePath(t, true);
  const nodes = readState(run).workflow.nodes;
  for (const id of [...DEPTH_SKIPS, 'persona-exploration', 'visual-prototyping']) assert.equal(nodes[id].status, 'pending', id);
  const result = complete(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastLine(result.stdout), 'RUN-COMPLETE');
});

test('simple: the same walk at full depth leaves the characteristics gate owed', t => {
  const result = complete(simplePath(t, false));
  assert.equal(result.stdout, 'RUN-FAILED: run-nodes-unfinished\n');
  assert.match(result.stderr, /characteristics-approval/);
});

test('simple: the problem gate goes straight to the specification and names what the depth skips', t => {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK, simple: true } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: false, prototyping_enabled: false, complexity_level: 'simple' } } },
    node_summaries: { intake: { summary: 'A simple enhancement.', absent: { research_context: 'no research task was named' } } },
  });
  write(run, { nodes: { 'characteristics-approval': { status: 'skipped' } } });
  write(run, { nodes: { 'context-synthesis': { status: 'completed' } }, node_summaries: { 'context-synthesis': { summary: 'Calendars are private today.' } } });
  write(run, { nodes: { 'context-approval': { status: 'skipped' } } });
  write(run, { nodes: { 'problem-exploration': { status: 'completed' } }, node_summaries: { 'problem-exploration': { summary: 'Guests cannot see availability.' } } });
  write(run, { nodes: { 'persona-exploration': { status: 'skipped' } } });
  const picker = brief(run, 'problem-approval');
  assert.match(picker.brief, /^Next: Feature specification \(skipping Idea generation and Idea convergence\)$/m);
});
