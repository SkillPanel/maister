import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

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
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, form]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return form === '--json' ? JSON.parse(result.stdout) : result.stdout;
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
function replayRecorded(t, absent = null) {
  const run = scratch(t, { fixture: 'team-calendar-sharing', type: 'product-design', name: RUN_NAME });
  const recorded = parse(fs.readFileSync(path.join(run.dir, 'recorded-state.yml'), 'utf8'));
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { ...recorded.orchestrator.options.inputs } });
  const nodes = {};
  for (const [id, entry] of Object.entries(recorded.workflow.nodes)) {
    nodes[id] = { status: entry.status, ...(entry.values ? { values: { ...entry.values } } : {}) };
  }
  const summaries = JSON.parse(JSON.stringify(recorded.node_summaries));
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
 * persona exploration run or skipped as `personas` says.
 */
function atProblemApproval(t, { personas }) {
  const run = scratch(t, { type: 'product-design', name: RUN_NAME });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: TASK } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: personas, prototyping_enabled: true, complexity_level: 'standard' } } },
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
function atDirectionApproval(t, convergence) {
  const run = atProblemApproval(t, { personas: false });
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
  assert.equal(phase('review-handoff').icon_hint, 'done');
  assert.equal(phase('persona-exploration').status, 'skipped');
});

test('recorded run: resume-check reads it as an engine run of product-design', t => {
  const result = verb(['resume-check', `--state=${replayRecorded(t).state}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.workflow.name, 'product-design');
  assert.equal(report.status, 'completed');
});

// ---------------------------------------------------------------------------
// the gates that close a guarded node
// ---------------------------------------------------------------------------

test('problem-approval: with the personas skipped, the brief renders the problem statement', t => {
  const picker = brief(atProblemApproval(t, { personas: false }), 'problem-approval');
  assert.equal(picker.ok, true);
  assert.equal(picker.header, 'Problem');
  assert.match(picker.question, /^Teams cannot show availability to outside guests\./);
  assert.match(picker.question, /Next: Idea generation/);
  assert.deepEqual(picker.options.map(option => option.id), ['continue-to-idea-generation', 'revise-problem', 'stop-design']);
});

test('problem-approval: with the personas drafted, the brief renders both summaries', t => {
  const picker = brief(atProblemApproval(t, { personas: true }), 'problem-approval');
  assert.match(picker.question, /Problem exploration: Teams cannot show availability/);
  assert.match(picker.question, /User and persona exploration: Two personas/);
});

test('problem-approval: revise suggestions are generated from the stretch, never left to free text', t => {
  const picker = brief(atProblemApproval(t, { personas: false }), 'problem-approval');
  const revise = picker.options.find(option => option.id === 'revise-problem');
  assert.equal(revise.reruns, 'problem-exploration');
  assert.deepEqual(revise.suggestions.map(each => each.note), [
    'Resolve: assumes guests accept a link instead of a login',
    'Revisit the decision: External guests get no account',
  ]);
  assert.equal(revise.suggestions[0].recommended, true);
});

test('problem-approval: a revise re-runs the problem statement and the personas behind it', t => {
  const run = atProblemApproval(t, { personas: true });
  const result = revise(run, 'problem-approval', 'revise-problem', 'Guests need a login after all');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^revised: problem-approval reruns=problem-exploration revision=1\/3 reset=problem-exploration,persona-exploration,problem-approval$/m);
  const nodes = readState(run).workflow.nodes;
  for (const id of ['problem-exploration', 'persona-exploration', 'problem-approval']) assert.equal(nodes[id].status, 'pending', id);
  assert.equal(nodes['context-synthesis'].status, 'completed');
});

// ---------------------------------------------------------------------------
// the direction gate
// ---------------------------------------------------------------------------

test('direction-approval: exploring more alternatives re-runs the brainstorm and the convergence', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.', decisions: ['access model: signed link'] });
  const result = revise(run, 'direction-approval', 'explore-more-alternatives', 'None of these handles a shared mailbox');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reruns=idea-generation revision=1\/3 reset=idea-generation,idea-convergence,direction-approval$/m);
  assert.equal(readState(run).workflow.nodes['problem-approval'].status, 'completed', 'the earlier gate is not asked again');
});

test('direction-approval: refining the direction re-runs the convergence alone', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.', decisions: ['access model: signed link'] });
  const result = revise(run, 'direction-approval', 'refine-direction', 'Show event titles to guests');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reruns=idea-convergence revision=1\/3 reset=idea-convergence,direction-approval$/m);
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
    'Resolve: access model — take guest accounts instead of the recommended signed link',
    'Resolve: detail shown — take event titles instead of the recommended free and busy only',
  ]);
  const oneline = brief(run, 'direction-approval', '--oneline');
  assert.match(oneline, /revise: refine-direction reruns=idea-convergence revision=1\/3/);
  assert.match(oneline, /revise: explore-more-alternatives reruns=idea-generation revision=1\/3/);
  assert.match(oneline, /Recommended: continue-to-specification/);
});

// ---------------------------------------------------------------------------
// the specification gate
// ---------------------------------------------------------------------------

test('specification-approval: with no screens to draw, the brief renders the specification', t => {
  const run = atDirectionApproval(t, { summary: 'Link-based sharing.' });
  write(run, { nodes: { 'direction-approval': { status: 'completed' } } });
  write(run, {
    nodes: { 'feature-specification': { status: 'completed' } },
    node_summaries: { 'feature-specification': { summary: 'Five sections, from the sharing model to notifications.' } },
  });
  write(run, { nodes: { 'visual-prototyping': { status: 'skipped' } } });
  const picker = brief(run, 'specification-approval');
  assert.equal(picker.header, 'Spec');
  assert.match(picker.question, /^Five sections, from the sharing model to notifications\./);
  assert.match(picker.question, /Next: Review and handoff/);
  const result = revise(run, 'specification-approval', 'revise-specification', 'Add a revocation section');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /reset=feature-specification,visual-prototyping,specification-approval$/m);
});
