import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, FIXTURES, freezePatch, readDashboard, readState, run as runEngine, scratch, variantRoot, verb, walkTo } from '../helpers.mjs';

/** One verb on the source engine, or on `engine` (the Copilot build's) when given. */
const call = (args, stdin, env = {}, engine = undefined) => runEngine(engine ?? ENGINE, args, stdin, env);

// `auto_continue` in the project's workflows block: at a gate the run froze in
// its workflow_config, node-brief records the gate's one plain continue
// `by: config`, prints the decision, the line to show and the next node, and
// asks nothing. A gate that grants, offers two continues or is unknown is
// dropped at the freeze with a warning and asked as usual; a gate its guard
// skips stays skipped; a gate whose brief recommends a revise or a stop, or
// whose step recorded a stop risk, is asked with the reason first. Only the
// engine records `by: config`, and only there.

const DEFINITION = path.join(FIXTURES, 'definitions', 'config-workflow.yml');
const CONFIG = 'workflows:\n  config-workflow:\n    auto_continue: [plan-approval]\n';

function frozen(t, { config = CONFIG, inputs = { publish: false }, orchestrator = {}, engine = undefined } = {}) {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  const file = path.join(run.root, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, config);
  const { patch } = freezePatch({ definition: DEFINITION, orchestrator: { ...orchestrator, options: { inputs, html_output: false } } });
  const result = call(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root }, engine);
  assert.equal(result.code, 0, result.stderr);
  return { run, result };
}

function send(run, patch, engine = undefined) {
  return call(['write-state', `--state=${run.state}`], patch, {}, engine);
}

/** Complete spec and plan, the plan's summary carrying `summary`. */
function planned(run, summary = {}) {
  walkTo(run, ['plan']);
  const written = send(run, { nodes: { plan: { status: 'completed' } }, node_summaries: { plan: { summary: 'Planned.', ...summary } } });
  assert.equal(written.code, 0, written.stderr);
}

function brief(run, node, engine = undefined) {
  const result = call(['node-brief', `--state=${run.state}`, `--node=${node}`], undefined, {}, engine);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

const LINE = "Implementation plan approved by the project's config";

test("a listed gate is recorded by: config with the line as its headline, and the brief asks nothing", t => {
  const { run } = frozen(t);
  planned(run);
  const out = brief(run, 'plan-approval');
  assert.doesNotMatch(out, /^ask it:/m);
  assert.ok(out.includes([
    "decided: plan-approval — continue-to-build, by the project's config (workflows.config-workflow.auto_continue); nothing to ask, nothing to write",
    `say: ${LINE}`,
    // The publishing twin is due next: its own brief takes the usual skip.
    'next: plan-approval-publish (Approve implementation plan and publish) — run node-brief for it',
  ].join('\n')), out);
  const state = readState(run);
  assert.equal(state.workflow.nodes['plan-approval'].status, 'completed');
  const summary = state.node_summaries['plan-approval'];
  assert.equal(summary.headline, LINE);
  assert.equal(summary.decisions.length, 1);
  assert.equal(summary.decisions[0].option, 'continue-to-build');
  assert.equal(summary.decisions[0].by, 'config');
  // No person answered: none is named, and no channel is stamped.
  assert.equal(Object.hasOwn(summary.decisions[0], 'answered_by'), false);
  assert.equal(Object.hasOwn(summary.decisions[0], 'actor'), false);
});

test('the dashboard shows the line on the gate phase and the decision by config', t => {
  const { run } = frozen(t);
  fs.writeFileSync(path.join(run.root, '.maister', 'config.yml'), `html_output: true\n${CONFIG}`);
  planned(run);
  brief(run, 'plan-approval');
  // html_output was frozen false for the other tests; this one projects on a later write.
  send(run, { orchestrator: { options: { html_output: true } } });
  const phase = readDashboard(run).phases.find(each => each.id === 'plan-approval');
  assert.equal(phase.headline, LINE);
  assert.equal(phase.decisions[0].by, 'config');
});

test('a gate whose step recommends revising is asked, the reason first', t => {
  const { run } = frozen(t);
  planned(run, { recommends: { option: 'revise-plan', reason: 'The plan misses the migration.' } });
  const out = brief(run, 'plan-approval');
  assert.ok(out.includes("say: The project's config would continue, but plan recommends revising; the gate is asked as usual.\nask it: gate-brief"), out);
  assert.equal(readState(run).workflow.nodes['plan-approval'].status, 'pending');
});

test('a gate whose step recorded a stop risk is asked, the reason first', t => {
  const { run } = frozen(t);
  planned(run, { risks: [{ risk: 'The plan deletes production data.', tag: 'stop' }] });
  const out = brief(run, 'plan-approval');
  assert.ok(out.includes("say: The project's config would continue, but plan recorded a risk that recommends stopping; the gate is asked as usual.\nask it: gate-brief"), out);
  assert.equal(readState(run).workflow.nodes['plan-approval'].status, 'pending');
});

test('a gate whose continue grants is dropped at the freeze and asked as usual', t => {
  const { run, result } = frozen(t, { config: 'workflows:\n  config-workflow:\n    auto_continue: [plan-approval, plan-approval-publish]\n', inputs: { publish: true } });
  assert.match(result.stderr, /warning: workflows-config:\.maister\/config\.yml:workflows\.config-workflow\.auto_continue\.1 — plan-approval-publish's continue grants push, pr-create/);
  assert.deepEqual(readState(run).orchestrator.options.workflow_config, { auto_continue: ['plan-approval'] });
  planned(run);
  // The plain gate's guard reads false under publish: it keeps today's skip, and the brief says to record it.
  const plain = brief(run, 'plan-approval');
  assert.match(plain, /^skip it: its guard .* reads false, so it is not asked — record it skipped through write-state: \{"nodes":\{"plan-approval":\{"status":"skipped"\}\}\}$/m);
  assert.doesNotMatch(plain, /^ask it:/m);
  const skipped = verb(['gate-brief', `--state=${run.state}`, '--node=plan-approval', '--json', '--picker=rich']);
  assert.equal(skipped.code, 1);
  assert.match(skipped.stdout + skipped.stderr, /gate-guard-false/);
  send(run, { nodes: { 'plan-approval': { status: 'skipped' } } });
  const publish = brief(run, 'plan-approval-publish');
  assert.match(publish, /^ask it: gate-brief /m);
  assert.doesNotMatch(publish, /^decided:/m);
});

test('an unknown gate and a gate with two continues are reported at the freeze; nothing is continued', t => {
  const { run, result } = frozen(t, { config: 'workflows:\n  config-workflow:\n    auto_continue: [nonesuch, route]\n' });
  const warnings = result.stderr.split('\n').filter(line => line.startsWith('warning: workflows-config:'));
  assert.deepEqual(warnings, [
    'warning: workflows-config:.maister/config.yml:workflows.config-workflow.auto_continue.0 — config-workflow has no gate nonesuch; the entry is ignored',
    'warning: workflows-config:.maister/config.yml:workflows.config-workflow.auto_continue.1 — route has more than one continue, or a continue that sets a value; only a gate with one plain continue may be listed, so the gate is asked as usual',
  ]);
  assert.equal(readState(run).orchestrator.options.workflow_config, undefined);
  planned(run);
  assert.match(brief(run, 'plan-approval'), /^ask it: gate-brief /m);
});

test('a gate not yet due is never continued', t => {
  const { run } = frozen(t);
  // The plan has not run: the brief prints the gate, continues nothing.
  const out = brief(run, 'plan-approval');
  assert.doesNotMatch(out, /^decided:/m);
  assert.equal(readState(run).workflow.nodes['plan-approval'].status, 'pending');
});

test('a resumed run keeps the auto_continue it started with', t => {
  const { run } = frozen(t, { config: 'workflows:\n  config-workflow:\n    auto_continue: []\n' });
  fs.writeFileSync(path.join(run.root, '.maister', 'config.yml'), CONFIG);
  const resumed = verb(['resume-check', `--state=${run.state}`], undefined, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(resumed.code, 0, resumed.stderr);
  planned(run);
  assert.match(brief(run, 'plan-approval'), /^ask it: gate-brief /m);
});

test('a driven run continues the same way, recorded the same way, and writes no gate request', t => {
  const { run } = frozen(t, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  planned(run);
  const out = brief(run, 'plan-approval');
  assert.doesNotMatch(out, /^ask it: gate-request/m);
  assert.match(out, /^decided: plan-approval — continue-to-build/m);
  assert.equal(readState(run).node_summaries['plan-approval'].decisions[0].by, 'config');
  assert.equal(fs.existsSync(path.join(run.dir, 'gates', 'plan-approval.request.yml')), false);
});

test('only the engine records by: config, and only at a gate the run froze', t => {
  const { run } = frozen(t, { config: 'workflows:\n  config-workflow:\n    auto_continue: [plan-approval]\n' });
  planned(run);
  const onStep = send(run, { node_summaries: { plan: { decisions: [{ decision: 'Split the plan', by: 'config' }] } } });
  assert.equal(onStep.code, 1);
  assert.match(onStep.stdout + onStep.stderr, /state-config-decision-invalid[\s\S]*plan is not a gate/);
  const otherOption = send(run, {
    nodes: { 'plan-approval': { status: 'completed' } },
    node_summaries: { 'plan-approval': { decisions: [{ option: 'stop-here', by: 'config' }] } },
  });
  assert.equal(otherOption.code, 1);
  assert.match(otherOption.stdout + otherOption.stderr, /state-config-decision-invalid[\s\S]*not plan-approval's plain continue, continue-to-build/);

  const { run: unlisted } = frozen(t, { config: 'html_output: false\n' });
  planned(unlisted);
  const refused = send(unlisted, {
    nodes: { 'plan-approval': { status: 'completed' } },
    node_summaries: { 'plan-approval': { decisions: [{ option: 'continue-to-build', by: 'config' }] } },
  });
  assert.equal(refused.code, 1);
  assert.match(refused.stdout + refused.stderr, /state-config-decision-invalid[\s\S]*froze no auto_continue for plan-approval/);
});

test('on the Copilot build, a gate continued by config needs no person', t => {
  const engine = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const { run } = frozen(t, { engine });
  walkTo(run, ['plan']);
  assert.equal(send(run, { nodes: { plan: { status: 'completed' } }, node_summaries: { plan: { summary: 'Planned.' } } }, engine).code, 0);
  // The last question found nobody there: the person check is armed, and still passes a config continue.
  fs.writeFileSync(path.join(run.dir, '.ask.result.json'), `${JSON.stringify({ outcome: 'host', at: new Date().toISOString(), questions: ['decision'] })}\n`);
  const out = brief(run, 'plan-approval', engine);
  assert.match(out, /^decided: plan-approval/m, out);
  assert.equal(readState(run).workflow.nodes['plan-approval'].status, 'completed');
});

// A gate the config continued is never asked again, and its decision is never
// replaced: gate-brief and gate-request refuse it in every form, and the writer
// refuses an answer or a status change over it. Nothing is written either way.

/** The run's state as bytes, to prove a refusal wrote nothing. */
const bytes = run => fs.readFileSync(run.state, 'utf8');

const ASK_FORMS = [[], ['--json', '--picker=rich'], ['--ask'], ['--ask', '--details'], ['--checkpoint'], ['--request'], ['--oneline']];

test('every gate-brief form refuses a gate the config continued, names the line and the next node, and writes nothing', t => {
  const { run } = frozen(t);
  planned(run);
  brief(run, 'plan-approval');
  const before = bytes(run);
  for (const form of ASK_FORMS) {
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=plan-approval', ...form]);
    const label = form.join(' ') || 'plain';
    assert.equal(result.code, 1, label);
    assert.match(result.stderr, /^gate-brief-already-answered: --node=plan-approval was continued by the project's config \(workflows\.config-workflow\.auto_continue\)/, label);
    assert.ok(result.stderr.includes(LINE), label);
    assert.ok(result.stderr.includes('next: plan-approval-publish (Approve implementation plan and publish) — run node-brief for it'), label);
    assert.doesNotMatch(result.stdout, /"options"|decision/, label);
  }
  assert.equal(bytes(run), before);
  assert.equal(fs.existsSync(path.join(run.dir, '.ask.json')), false, 'no question call is kept');
});

test('gate-request refuses a gate the config continued, built from the node or sent whole, and writes no request', t => {
  const { run } = frozen(t, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  planned(run);
  brief(run, 'plan-approval');
  const before = bytes(run);
  const built = verb(['gate-request', `--state=${run.state}`, '--node=plan-approval']);
  assert.equal(built.code, 1);
  assert.match(built.stderr, /^gate-brief-already-answered: --node=plan-approval was continued by the project's config/);
  const sent = verb(['gate-request', `--state=${run.state}`], { node: 'plan-approval', question: 'Approve?' });
  assert.equal(sent.code, 1);
  assert.match(sent.stderr, /^gate-brief-already-answered: --node=plan-approval was continued by the project's config/);
  assert.equal(bytes(run), before);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates', 'plan-approval.request.yml')), false);
});

test('a gate a person answered is refused as already answered', t => {
  const { run } = frozen(t, { config: 'html_output: false\n' });
  planned(run);
  const answered = send(run, {
    nodes: { 'plan-approval': { status: 'completed' } },
    node_summaries: { 'plan-approval': { decisions: [{ option: 'continue-to-build' }] } },
  });
  assert.equal(answered.code, 0, answered.stderr);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=plan-approval', '--ask']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-brief-already-answered: --node=plan-approval is already answered \(continue-to-build\); a gate is asked once per attempt/);
  assert.ok(result.stderr.includes('next: plan-approval-publish'));
});

test('the writer refuses an answer or a status change over a decision the config recorded, and writes nothing', t => {
  const { run } = frozen(t);
  planned(run);
  brief(run, 'plan-approval');
  const before = bytes(run);
  for (const patch of [
    // The write a session sends after asking the gate by mistake.
    { nodes: { 'plan-approval': { status: 'completed' } }, node_summaries: { 'plan-approval': { decisions: [{ option: 'continue-to-build' }] } } },
    { node_summaries: { 'plan-approval': { answer: 'continue-to-build' } } },
    { nodes: { 'plan-approval': { status: 'skipped' } } },
  ]) {
    const result = send(run, patch);
    assert.equal(result.code, 1, JSON.stringify(patch));
    assert.match(result.stderr, /^state-gate-config-continued: plan-approval was continued by the project's config \(workflows\.config-workflow\.auto_continue\)/, JSON.stringify(patch));
  }
  assert.equal(bytes(run), before);
  // Completed again, with nothing else, is no answer: it lands.
  assert.equal(send(run, { nodes: { 'plan-approval': { status: 'completed' } } }).code, 0);
  assert.equal(readState(run).node_summaries['plan-approval'].decisions.at(-1).by, 'config');
});

test('a revise cannot re-open a gate the config continued', t => {
  const { run } = frozen(t);
  planned(run);
  brief(run, 'plan-approval');
  const before = bytes(run);
  const result = verb(['gate-revise', `--state=${run.state}`, '--node=plan-approval', '--option=revise-plan'], { note: 'Add the migration.' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^revise-gate-not-current: .*it is recorded completed/);
  assert.equal(bytes(run), before);
});

test('on the Copilot build, a person\'s answer still does not replace the config\'s decision', t => {
  const engine = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const { run } = frozen(t, { engine });
  walkTo(run, ['plan']);
  assert.equal(send(run, { nodes: { plan: { status: 'completed' } }, node_summaries: { plan: { summary: 'Planned.' } } }, engine).code, 0);
  assert.match(brief(run, 'plan-approval', engine), /^decided: plan-approval/m);
  const asked = call(['gate-brief', `--state=${run.state}`, '--node=plan-approval', '--ask'], undefined, {}, engine);
  assert.equal(asked.code, 1);
  assert.match(asked.stderr, /^gate-brief-already-answered:/);
  fs.writeFileSync(path.join(run.dir, '.ask.result.json'), `${JSON.stringify({ outcome: 'person', at: new Date().toISOString(), questions: ['decision'] })}\n`);
  const before = bytes(run);
  const written = send(run, { nodes: { 'plan-approval': { status: 'completed' } }, node_summaries: { 'plan-approval': { decisions: [{ option: 'continue-to-build' }] } } }, engine);
  assert.equal(written.code, 1);
  assert.match(written.stderr, /^state-gate-config-continued:/);
  assert.equal(bytes(run), before);
});
