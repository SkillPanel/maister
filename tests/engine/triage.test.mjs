import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE, FIXTURES, OPERATOR, freezePatch, readState, run as runScript, scratch, scratchPlugin, sibling, verb } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// Triage under a classifying policy: the gate request carries the gate's class,
// the answer item records it, and each classified value the chosen continue
// sets is recorded as a settlement item after the answer. All of it is written
// only on the two writes that judge a gate — the write that records its answer,
// and the driven re-validation whose index sync closes the gate's row — and
// only when the run's recorded policy hash is the policy's own. The policy sits
// at the engine's own location, so each test runs a scratch copy of the plugin.

const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const POLICY = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy/classifying.json'), 'utf8'));
const GATE = 'specification-approval';
const COCKPIT = { kind: 'cockpit', cwd: '/work' };
const QUESTION_SET = path.join(FIXTURES, 'gates/question-set.request.yml');

const GATE_TRIAGE = { version: 1, class: 'record', family: 'checkpoint-family' };
const VALUE_TRIAGE = { version: 1, class: 'approve', floor: ['floor-a'], family: 'guarded-family', raised_by: 'floor' };
const MISMATCH = `warning: policy-hash-mismatch:${GATE}`;

/** A verb run against the scratch plugin copy, refused loudly. */
function ok(engine, args, stdin) {
  const result = runScript(engine, args, stdin);
  if (result.code !== 0) throw new Error(`${args[0]} exited ${result.code}: ${result.stdout}${result.stderr}`);
  return result;
}

/**
 * The optional-step run, frozen and its specification written, the first gate
 * the question now. `frozenBy` is the engine that freezes it, so the recorded
 * hash is that engine's policy's; `noHash` removes the line, as a run frozen
 * before the hash existed has none.
 */
function atGate(t, { engine, frozenBy = engine, driver = null, noHash = false }) {
  const run = scratch(t);
  const { patch } = freezePatch({ definition: OPTIONAL, orchestrator: driver ? { driver } : {} });
  ok(frozenBy, ['write-state', `--state=${run.state}`], patch);
  if (noHash) fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').replace(/^ {2}policy_hash: .*\n/m, ''));
  ok(engine, ['write-state', `--state=${run.state}`], {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  return run;
}

function decisionsOf(run, id = GATE) {
  return readState(run).node_summaries[id].decisions;
}

function answer(engine, run, option, extra = {}) {
  return ok(engine, ['write-state', `--state=${run.state}`], {
    nodes: { [GATE]: { status: 'completed' } },
    node_summaries: { [GATE]: { decisions: [{ option, ...extra }] } },
  });
}

/**
 * The driven suspension and fold, laid down the way they land on disk: the
 * request file and the index row `pending`, the marker set, then the driver's
 * answer in the request file and the fold with editor tools — the marker null,
 * the gate completed, its answer on the summary — and no write-state yet.
 */
function drivenFold(engine, run, option, after = []) {
  const gates = path.join(run.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  const request = path.join(gates, `${GATE}.request.yml`);
  const head = [
    'version: 1',
    `node: ${GATE}`,
    'kind: approval',
    'question: "Specification complete. Continue?"',
    'multiple: false',
    'asked_at: "2026-01-05T09:00:00Z"',
  ].join('\n');
  fs.writeFileSync(request, `${head}\nanswer: null\n`);
  refreshIndex(run.dir);
  ok(engine, ['write-state', `--state=${run.state}`], {
    orchestrator: { gate_pending: { node: GATE, request: `gates/${GATE}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [GATE]: { status: 'suspended' } },
  });
  assert.match(fs.readFileSync(path.join(gates, 'index.yml'), 'utf8'), /status: pending/);

  fs.writeFileSync(request, `${head}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n  on_behalf_of: lee\n`);
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${GATE}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  fs.writeFileSync(run.state, `${text}  ${GATE}:\n    decisions:\n      - {option: ${option}, answered_by: dana, at: "2026-01-05T09:05:00Z", via: cockpit}\n${after.map(line => `      - ${line}\n`).join('')}    status: completed\n`);
}

test('gate-brief --request ends a gate request with its triage; a question request carries none', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine, driver: { ...COCKPIT, features: ['question-sets'] } });
  const request = JSON.parse(ok(engine, ['gate-brief', `--state=${run.state}`, `--node=${GATE}`, '--request']).stdout);
  assert.equal(Object.keys(request).at(-1), 'triage');
  assert.deepEqual(request.triage, GATE_TRIAGE);

  // An in-node question set is briefed with no triage in this change.
  const asking = scratch(t);
  const file = path.join(asking.dir, '.state-patch.json');
  const questions = JSON.parse(JSON.stringify(parse(fs.readFileSync(QUESTION_SET, 'utf8')).context.checkpoint.questions))
    .map(({ default: _default, ...question }) => question);
  fs.writeFileSync(file, JSON.stringify({ questions }));
  ok(engine, ['write-state', `--state=${asking.state}`], freezePatch({ definition: OPTIONAL, orchestrator: { driver: { ...COCKPIT, features: ['question-sets'] } } }).patch);
  ok(engine, ['write-state', `--state=${asking.state}`], { nodes: { specification: { status: 'running' } } });
  const asked = JSON.parse(ok(engine, ['gate-brief', `--state=${asking.state}`, '--node=specification', '--request', `--patch-file=${file}`]).stdout);
  assert.equal(asked.kind, 'question');
  assert.equal(Object.hasOwn(asked, 'triage'), false);
});

test('the answer write gives the answer item its triage; a triage already on the item is carried as written', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine });
  const result = answer(engine, run, 'continue-to-audit');
  assert.doesNotMatch(result.stderr, /policy/);
  const [item] = decisionsOf(run);
  assert.equal(item.option, 'continue-to-audit');
  assert.deepEqual(item.triage, GATE_TRIAGE);

  const sent = { version: 1, class: 'consult', family: 'caller-family' };
  const carried = atGate(t, { engine });
  answer(engine, carried, 'continue-to-planning', { triage: sent });
  assert.deepEqual(decisionsOf(carried)[0].triage, sent);
});

test('one settlement item per classified value the continue sets, after the answer, replaced by a later answer', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine });
  answer(engine, run, 'continue-to-audit', { on_behalf_of: 'lee' });
  const [answered, settled, ...rest] = decisionsOf(run);
  assert.deepEqual(rest, []);
  assert.equal(answered.option, 'continue-to-audit');
  assert.deepEqual(settled, {
    decision: 'audit_enabled: true',
    by: 'operator',
    ref: 'audit_enabled',
    node: GATE,
    triage: VALUE_TRIAGE,
    answered_by: OPERATOR,
    via: 'terminal',
    actor: { kind: 'person', id: OPERATOR },
    on_behalf_of: 'lee',
  });
  assert.deepEqual(Object.keys(settled).slice(0, 7), ['decision', 'by', 'ref', 'node', 'triage', 'answered_by', 'via']);

  // A later answer replaces the settlement with its own; never two.
  answer(engine, run, 'continue-to-planning');
  const later = decisionsOf(run);
  assert.deepEqual(later.map(item => item.option ?? item.decision), ['continue-to-planning', 'audit_enabled: false']);
  assert.deepEqual(readState(run).workflow.nodes[GATE].values, { audit_enabled: false });

  // A stop sets nothing, so it leaves no settlement behind.
  answer(engine, run, 'stop-here');
  assert.deepEqual(decisionsOf(run).map(item => item.option ?? item.decision), ['stop-here']);
});

test('the checkpoint\'s approves lists each classified key once, in option order; [] under the default', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine });
  const checkpoint = JSON.parse(ok(engine, ['gate-brief', `--state=${run.state}`, `--node=${GATE}`, '--checkpoint']).stdout);
  assert.deepEqual(checkpoint.approves, [{ node: GATE, ref: 'audit_enabled', class: 'approve', floor: ['floor-a'] }]);

  const defaulted = atGate(t, { engine: ENGINE });
  const unclassed = JSON.parse(verb(['gate-brief', `--state=${defaulted.state}`, `--node=${GATE}`, '--checkpoint']).stdout);
  assert.deepEqual(unclassed.approves, []);
});

test('a driven answer\'s re-validation — the empty patch that closes its index row — writes the triage and the settlements', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine, driver: COCKPIT });
  drivenFold(engine, run, 'continue-to-audit');
  const result = ok(engine, ['write-state', `--state=${run.state}`], {});
  assert.match(result.stdout, /^gates\/index\.yml$/m);
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: answered/);
  const [answered, settled, ...rest] = decisionsOf(run);
  assert.deepEqual(rest, []);
  assert.deepEqual(answered.triage, GATE_TRIAGE);
  assert.equal(answered.on_behalf_of, 'lee', 'the request file\'s provenance is copied first');
  assert.deepEqual(settled, {
    decision: 'audit_enabled: true',
    by: 'operator',
    ref: 'audit_enabled',
    node: GATE,
    triage: VALUE_TRIAGE,
    answered_by: 'dana',
    via: 'cockpit',
    on_behalf_of: 'lee',
  });
});

test('a hash mismatch, or a run with no hash, writes nothing and warns on the judging writes and the request', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  for (const setup of [{ frozenBy: ENGINE }, { noHash: true }]) {
    // The terminal answer write.
    const run = atGate(t, { engine, ...setup });
    const request = ok(engine, ['gate-brief', `--state=${run.state}`, `--node=${GATE}`, '--request']);
    assert.equal(Object.hasOwn(JSON.parse(request.stdout), 'triage'), false);
    assert.equal(request.stderr.split('\n').filter(line => line === MISMATCH).length, 1, request.stderr);
    const checkpoint = JSON.parse(ok(engine, ['gate-brief', `--state=${run.state}`, `--node=${GATE}`, '--checkpoint']).stdout);
    assert.deepEqual(checkpoint.approves, []);

    const written = answer(engine, run, 'continue-to-audit');
    assert.equal(written.stderr, `${MISMATCH}\n`);
    assert.deepEqual(decisionsOf(run).map(item => Object.hasOwn(item, 'triage')), [false]);

    // The driven re-validation.
    const driven = atGate(t, { engine, driver: COCKPIT, ...setup });
    drivenFold(engine, driven, 'continue-to-audit');
    const revalidated = ok(engine, ['write-state', `--state=${driven.state}`], {});
    assert.equal(revalidated.stderr, `${MISMATCH}\n`);
    assert.deepEqual(decisionsOf(driven).map(item => Object.hasOwn(item, 'triage')), [false]);
  }
});

test('a plain patch, and a second empty patch, after a judging write write nothing more and warn nothing', t => {
  const engine = scratchPlugin(t, { policy: POLICY });

  // Matched: the settlement is written once and never again.
  const run = atGate(t, { engine, driver: COCKPIT });
  drivenFold(engine, run, 'continue-to-audit');
  ok(engine, ['write-state', `--state=${run.state}`], {});
  const once = fs.readFileSync(run.state, 'utf8');
  const plain = ok(engine, ['write-state', `--state=${run.state}`], { nodes: { audit: { status: 'running' } } });
  const empty = ok(engine, ['write-state', `--state=${run.state}`], {});
  for (const result of [plain, empty]) {
    assert.doesNotMatch(result.stdout, /node_summaries/);
    assert.equal(result.stderr, '');
  }
  assert.equal(decisionsOf(run).length, 2);
  assert.equal(fs.readFileSync(run.state, 'utf8').split('\n').filter(line => line.includes('audit_enabled: true') && line.includes('triage')).length,
    once.split('\n').filter(line => line.includes('audit_enabled: true') && line.includes('triage')).length);

  // Mismatched: the warning is the judging write's alone.
  const stale = atGate(t, { engine, frozenBy: ENGINE, driver: COCKPIT });
  drivenFold(engine, stale, 'continue-to-audit');
  assert.equal(ok(engine, ['write-state', `--state=${stale.state}`], {}).stderr, `${MISMATCH}\n`);
  for (const patch of [{ nodes: { audit: { status: 'running' } } }, {}]) {
    const result = ok(engine, ['write-state', `--state=${stale.state}`], patch);
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(decisionsOf(stale).map(item => Object.hasOwn(item, 'triage')), [false]);
});

test('with a settlement item present, the gate\'s values, gate-revise and run-complete still read the answer', t => {
  const engine = scratchPlugin(t, { policy: POLICY });

  // The values come from the answer, the item before the settlement.
  const run = atGate(t, { engine });
  answer(engine, run, 'continue-to-planning');
  assert.equal(decisionsOf(run).length, 2);
  assert.deepEqual(readState(run).workflow.nodes[GATE].values, { audit_enabled: false });

  // run-complete reads the guard the answer settled: the audit and its gate
  // were passed by it, and nothing is owed.
  ok(engine, ['write-state', `--state=${run.state}`], {
    task: { status: 'completed' },
    nodes: { audit: { status: 'skipped' }, 'audit-approval': { status: 'skipped' }, planning: { status: 'completed' } },
  });
  const closed = runScript(engine, ['run-complete', `--state=${run.state}`]);
  assert.equal(closed.code, 0, closed.stderr);
  assert.equal(closed.stdout, 'RUN-COMPLETE\n');

  // A driven fold holding a settlement after its answer is recognised through
  // the answer: the revise takes that answer's place, and its own judging
  // write leaves no settlement a revise does not set.
  const driven = atGate(t, { engine, driver: COCKPIT });
  drivenFold(engine, driven, 'revise-specification',
    [`{decision: "audit_enabled: true", by: operator, ref: audit_enabled, node: ${GATE}, triage: {version: 1, class: approve, family: guarded-family}}`]);
  assert.equal(decisionsOf(driven).length, 2);
  const revised = runScript(engine, ['gate-revise', `--state=${driven.state}`, `--node=${GATE}`, '--option=revise-specification'],
    { note: 'Tighten the scope' });
  assert.equal(revised.code, 0, revised.stderr);
  const decisions = decisionsOf(driven);
  assert.deepEqual(decisions.map(item => [item.option ?? item.decision, Number(item.attempt ?? 0)]), [['revise-specification', 1]]);
  assert.deepEqual(decisions[0].triage, GATE_TRIAGE);
});

test('a refused policy file warns on the gate request, which carries no triage and no mismatch', t => {
  const engine = scratchPlugin(t, { policy: { version: 2 } });
  const file = path.join(path.dirname(path.dirname(engine)), 'policy/autonomy-policy.json');
  const run = atGate(t, { engine, driver: COCKPIT });
  const result = ok(engine, ['gate-brief', `--state=${run.state}`, `--node=${GATE}`, '--request']);
  assert.equal(Object.hasOwn(JSON.parse(result.stdout), 'triage'), false);
  assert.equal(result.stderr, `warning: policy-refused:${file}:version\n`);
});

test('a gate answer written flat on the summary judges the gate: triage, settlement and provenance', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine });
  ok(engine, ['write-state', `--state=${run.state}`], {
    nodes: { [GATE]: { status: 'completed' } },
    node_summaries: { [GATE]: { answer: 'continue-to-audit', on_behalf_of: 'lee' } },
  });
  const [answered, settled, ...rest] = decisionsOf(run);
  assert.deepEqual(rest, []);
  assert.equal(answered.option, 'continue-to-audit');
  assert.deepEqual(answered.triage, GATE_TRIAGE);
  assert.equal(answered.on_behalf_of, 'lee');
  assert.equal(settled.decision, 'audit_enabled: true');
  assert.deepEqual(settled.triage, VALUE_TRIAGE);
  assert.equal(settled.on_behalf_of, 'lee');
});

test('an answer and the closing write that re-sends it leave one answer and one settlement, both judged', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const run = atGate(t, { engine });
  const sent = { option: 'continue-to-audit', on_behalf_of: 'lee' };
  // The answer first, then the closing write re-sending it with the status, then once more.
  for (const nodes of [{}, { [GATE]: { status: 'completed' } }, { [GATE]: { status: 'completed' } }]) {
    ok(engine, ['write-state', `--state=${run.state}`], { nodes, node_summaries: { [GATE]: { decisions: [sent] } } });
    const decisions = decisionsOf(run);
    assert.deepEqual(decisions.map(item => item.option ?? item.decision), ['continue-to-audit', 'audit_enabled: true']);
    assert.deepEqual(decisions[0].triage, GATE_TRIAGE);
    assert.deepEqual(decisions[1].triage, VALUE_TRIAGE);
    assert.equal(decisions[1].on_behalf_of, 'lee');
  }
});

test('a sub-run is judged under its own workflow name against its own recorded hash', t => {
  const engine = scratchPlugin(t, { policy: POLICY });
  const parent = scratch(t);
  ok(engine, ['write-state', `--state=${parent.state}`], freezePatch().patch);
  const child = sibling(parent, { type: 'development', name: '2026-01-05-child' });
  ok(engine, ['write-state', `--state=${child.state}`], freezePatch({
    definition: OPTIONAL,
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'analysis' } },
  }).patch);
  const recorded = readState(child).orchestrator.policy_hash;
  assert.equal(recorded, readState(parent).orchestrator.policy_hash);
  assert.notEqual(recorded, 'sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8');
  ok(engine, ['write-state', `--state=${child.state}`], {
    nodes: { specification: { status: 'completed' } },
    node_summaries: { specification: { summary: 'Wrote the specification.' } },
  });
  const result = answer(engine, child, 'continue-to-audit');
  assert.equal(result.stderr, '');
  const [answered, settled] = decisionsOf(child);
  assert.deepEqual(answered.triage, GATE_TRIAGE);
  assert.deepEqual(settled.triage, VALUE_TRIAGE);
});
