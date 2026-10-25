import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, ROOT, freeze, freezePatch, readState, run as runScript, scratch, verb, write } from '../helpers.mjs';

// A `direct:` step's declared delegates: `brief.<node>.delegates` names the
// agents a step run inline always dispatches. The brief names them on its
// `runs:` line and prints each beside the model and effort its call carries;
// the closing patch carries them under `delegated`; and a write that completes
// the step without listing every one is refused, nothing written. The shape is
// an error in a definition, and a declaration on a step that is not `direct:`
// warns, holding nobody.

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const FOUNDATION = 'research-foundation';
const DELEGATES = ['research-planner', 'information-gatherer', 'research-synthesizer'];

function researchRun(t) {
  const run = scratch(t, { type: 'research' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'Which store keeps notes safe?' } });
  return run;
}

function brief(run, node) {
  return verb(['node-brief', `--state=${run.state}`, `--node=${node}`]);
}

/** The foundation's closing write, its summary listing `delegated` when given. */
function closing(delegated) {
  const summary = { headline: 'A JSON file with atomic writes fits both constraints.', summary: 'One option meets both constraints.' };
  if (delegated !== undefined) summary.delegated = delegated;
  return {
    nodes: { [FOUNDATION]: { status: 'completed', values: { confidence_level: 'high', conclusions: 'json-file-store' } } },
    node_summaries: { [FOUNDATION]: summary },
  };
}

function complete(run, delegated) {
  return verb(['write-state', `--state=${run.state}`], closing(delegated));
}

test('the brief of a step with delegates names them on its runs line and prints each with its model and effort', t => {
  const run = researchRun(t);
  const result = brief(run, FOUNDATION);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[1], `runs: direct:${FOUNDATION} — inline, its delegates dispatched through the Task tool`);
  const at = lines.findIndex(line => line.startsWith('delegates: '));
  assert.ok(at > 0, result.stdout);
  assert.match(lines[at], /through the Task tool, on the model and effort beside it, whatever the size of the project or the task — never do its work in this session/);
  assert.match(lines[at], /refused without it$/);
  assert.deepEqual(lines.slice(at + 1, at + 1 + DELEGATES.length),
    DELEGATES.map(agent => `- maister:${agent}: model omit, effort omit (source: shipped default)`));
  const patch = lines.find(line => line.startsWith('closing patch'));
  assert.ok(patch.includes(`"delegated": [${DELEGATES.map(agent => `"${agent}"`).join(', ')}]`), patch);
});

test('the Copilot variant names each delegate under its own plugin', t => {
  const run = researchRun(t);
  const variant = path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs');
  const result = runScript(variant, ['node-brief', `--state=${run.state}`, `--node=${FOUNDATION}`]);
  assert.equal(result.code, 0, result.stderr);
  for (const agent of DELEGATES) assert.match(result.stdout, new RegExp(`^- maister-copilot:${agent}: model omit, effort omit `, 'm'));
});

test('a step without delegates prints neither line nor the key', t => {
  const run = researchRun(t);
  write(run, closing(DELEGATES));
  write(run, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { decisions: [{ option: 'continue-to-brainstorming' }] } } });
  write(run, { nodes: { 'findings-approval': { status: 'skipped' } } });
  const result = brief(run, 'solution-generation');
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^delegates: /m);
  assert.doesNotMatch(result.stdout, /"delegated"/);
});

test('completing a step without listing its delegates is refused and writes nothing', t => {
  const run = researchRun(t);
  const before = fs.readFileSync(run.state, 'utf8');
  for (const delegated of [undefined, [], ['research-planner', 'research-synthesizer']]) {
    const result = complete(run, delegated);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /state-delegates-unrecorded/);
    assert.match(result.stderr, /information-gatherer/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  }
});

test('completing a step that lists every delegate lands, under any plugin prefix', t => {
  for (const delegated of [DELEGATES, DELEGATES.map(agent => `maister:${agent}`), DELEGATES.map(agent => `maister-copilot:${agent}`)]) {
    const run = researchRun(t);
    const result = complete(run, delegated);
    assert.equal(result.code, 0, result.stderr);
    const state = readState(run);
    assert.equal(state.workflow.nodes[FOUNDATION].status, 'completed');
    assert.deepEqual(state.node_summaries[FOUNDATION].delegated, delegated);
  }
});

test('delegates recorded by an earlier milestone write count at completion', t => {
  const run = researchRun(t);
  write(run, { node_summaries: { [FOUNDATION]: { summary: 'Plan and findings written.', delegated: DELEGATES } } });
  const result = complete(run, undefined);
  assert.equal(result.code, 0, result.stderr);
});

test('a delegated entry that names no agent is refused', t => {
  const run = researchRun(t);
  for (const delegated of ['research-planner', [3], ['Research Planner']]) {
    const result = complete(run, delegated);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /state-summary-item-invalid/);
  }
});

/** A two-node definition with `block` as its brief entry for `step` and `review`, validated. */
function validateWith(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-delegates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const brief = Object.entries(entries).map(([node, value]) => `  ${node}:\n    delegates: ${value}\n`).join('');
  fs.writeFileSync(path.join(dir, 'pair.yml'), [
    'name: pair', 'version: 1', 'description: "Writes a note and has it reviewed."',
    `brief:\n${brief}`,
    'nodes:',
    '  step:', '    uses: direct:step', '    needs: []',
    '  review:', '    uses: agent:spec-auditor', '    needs: [step]', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'pair.md'), '# Pair\n\nWrites a note.\n\n## `step`\n\n**Does.** Writes the note.\n');
  const result = verb(['validate', `--definition=${path.join(dir, 'pair.yml')}`]);
  return JSON.parse(result.stdout);
}

test('validate: delegates is a list of agent names, each once', t => {
  assert.deepEqual(validateWith(t, { step: '[spec-auditor, maister:gap-analyzer]' }).errors, []);
  for (const bad of ['spec-auditor', '[]', '[spec-auditor, spec-auditor]', '["Spec Auditor"]']) {
    const report = validateWith(t, { step: bad });
    assert.equal(report.ok, false, bad);
    assert.ok(report.errors.some(error => JSON.stringify(error).includes('brief.step.delegates')), JSON.stringify(report.errors));
  }
});

test('validate: delegates on a step that is not direct warns', t => {
  const report = validateWith(t, { review: '[gap-analyzer]' });
  assert.equal(report.ok, true);
  assert.ok(report.warnings.includes('brief-delegates-not-direct:brief.review.delegates:review'), JSON.stringify(report.warnings));
});

test('validate: delegates per host maps a host to its own set', t => {
  for (const good of ['{claude: [Plan], copilot: ["maister:implementation-planner"]}', '{copilot: [gap-analyzer]}', '[Explore, spec-auditor]']) {
    assert.deepEqual(validateWith(t, { step: good }).errors, [], good);
  }
  for (const [bad, at] of [['{}', 'brief.step.delegates'], ['{claude: []}', 'brief.step.delegates.claude'],
    ['{gemini: [spec-auditor]}', 'brief.step.delegates.gemini'], ['{claude: [spec-auditor, spec-auditor]}', 'brief.step.delegates.claude[1]'],
    ['{claude: plan}', 'brief.step.delegates.claude'], ['[PLAN]', 'brief.step.delegates[0]']]) {
    const report = validateWith(t, { step: bad });
    assert.equal(report.ok, false, bad);
    assert.ok(report.errors.some(error => JSON.stringify(error).includes(`"${at}`)), `${bad}: ${JSON.stringify(report.errors)}`);
  }
});

test('validate: delegates per host on a step that is not direct warns', t => {
  const report = validateWith(t, { review: '{claude: [gap-analyzer]}' });
  assert.equal(report.ok, true);
  assert.ok(report.warnings.includes('brief-delegates-not-direct:brief.review.delegates:review'), JSON.stringify(report.warnings));
});

const PER_HOST = { claude: ['Plan'], copilot: ['maister:implementation-planner'] };

/** A one-step definition whose direct step declares `delegates`, frozen under `host` (null: no --host). */
function perHostRun(t, delegates, host) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-delegates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'plan.yml'), [
    'name: plan', 'version: 1', 'description: "Plans a change."',
    `brief:\n  step:\n    delegates: ${JSON.stringify(delegates)}`,
    'nodes:', '  step:', '    uses: direct:step', '    needs: []', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Plan\n\nPlans a change.\n\n## `step`\n\n**Does.** Writes the plan.\n');
  const run = scratch(t);
  const { patch } = freezePatch({ definition: path.join(dir, 'plan.yml') });
  const result = verb(['write-state', `--state=${run.state}`, ...(host ? [`--host=${host}`] : [])], patch);
  assert.equal(result.code, 0, result.stderr);
  return run;
}

function completeStep(run, delegated) {
  const summary = { headline: 'The plan is written.', summary: 'One plan.' };
  if (delegated !== undefined) summary.delegated = delegated;
  return verb(['write-state', `--state=${run.state}`], { nodes: { step: { status: 'completed' } }, node_summaries: { step: summary } });
}

test('a per-host set: the brief and the closing patch name the run host\'s set', t => {
  for (const [host, line, listed] of [
    [null, '- Plan: ', '"Plan"'],
    ['claude', '- Plan: ', '"Plan"'],
    ['copilot', '- maister:implementation-planner: ', '"maister:implementation-planner"'],
  ]) {
    const run = perHostRun(t, PER_HOST, host);
    const result = brief(run, 'step');
    assert.equal(result.code, 0, result.stderr);
    const lines = result.stdout.split('\n');
    assert.equal(lines[1], 'runs: direct:step — inline, its delegates dispatched through the Task tool', String(host));
    const at = lines.findIndex(each => each.startsWith('delegates: '));
    assert.ok(lines[at + 1].startsWith(line), `${host}: ${lines[at + 1]}`);
    assert.ok(!lines[at + 2].startsWith('- '), `${host}: one delegate only`);
    assert.ok(lines.find(each => each.startsWith('closing patch')).includes(`"delegated": [${listed}]`), String(host));
  }
});

test('a per-host set holds each host to its own set, and the other host\'s set is refused', t => {
  for (const [host, own, other] of [['claude', ['Plan'], ['maister-copilot:implementation-planner']], ['copilot', ['maister-copilot:implementation-planner'], ['Plan']]]) {
    const run = perHostRun(t, PER_HOST, host);
    const before = fs.readFileSync(run.state, 'utf8');
    const refused = completeStep(run, other);
    assert.equal(refused.code, 1, refused.stdout);
    assert.match(refused.stderr, /state-delegates-unrecorded/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
    const landed = completeStep(run, own);
    assert.equal(landed.code, 0, landed.stderr);
    assert.equal(readState(run).workflow.nodes.step.status, 'completed');
  }
});

test('a host the per-host map leaves out declares nothing there', t => {
  const run = perHostRun(t, { copilot: ['gap-analyzer'] }, 'claude');
  const result = brief(run, 'step');
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^delegates: /m);
  assert.doesNotMatch(result.stdout, /"delegated"/);
  assert.doesNotMatch(result.stdout, /its delegates dispatched/);
  const landed = completeStep(run, undefined);
  assert.equal(landed.code, 0, landed.stderr);
  const held = completeStep(perHostRun(t, { copilot: ['gap-analyzer'] }, 'copilot'), undefined);
  assert.equal(held.code, 1, held.stdout);
  assert.match(held.stderr, /state-delegates-unrecorded/);
});

test('the Copilot variant names a per-host delegate under its own plugin', t => {
  const run = perHostRun(t, PER_HOST, 'copilot');
  const variant = path.join(ROOT, 'plugins/maister-copilot/skills/workflow-engine/scripts/workflow.mjs');
  const result = runScript(variant, ['node-brief', `--state=${run.state}`, '--node=step']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^- maister-copilot:implementation-planner: /m);
});
