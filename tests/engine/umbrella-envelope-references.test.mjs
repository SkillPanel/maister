import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, freeze, umbrella } from '../helpers.mjs';
import { buildSeed, renderSeed } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';

// A chain node's `with:` may name what an earlier node produced —
// `${plan.artifacts.plan}` — and the freeze validates it. The envelope fills it
// in: a dispatching node's declared artifact is the member repository's path, so
// it is read in the worktree that dispatch worked in, once the dispatch has
// closed out and the file is there. A dispatching `workflow:` node's worker
// names its own task directory only when its run starts, so its artifact is
// read from the `{key, path}` list its close-out carries instead. The filled
// path becomes a read-only input under its `with` key, as a literal path does.
// A reference that cannot be filled is refused by name, never dropped.

const RUN_ID = '2026-01-05-chain';

/** A scaffolded workspace with members `alpha` and `beta`. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-references-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const member of ['alpha', 'beta']) fs.mkdirSync(path.join(root, 'repos', member), { recursive: true });
  const init = umbrella(['init', `--root=${root}`, '--members-root=repos']);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}',
    'members:\n  alpha: {path: repos/alpha, kind: repo}\n  beta: {path: repos/beta, kind: repo}'));
  return {
    root,
    run: path.join(root, '.maister/umbrella/runs', RUN_ID),
    ledger: path.join(root, '.maister/umbrella/ledger'),
    outbox: path.join(root, '.maister/umbrella/outbox'),
  };
}

/**
 * A chain whose `plan` node writes its plan in alpha and whose `change` node
 * reads it. By default `plan` is a plain dispatching node, a skill writing
 * `docs/plan.md` in the member; with `uses: 'workflow:plan'` it is a dispatched
 * workflow run whose declared path is relative to the child's task directory.
 */
function chain({ member = 'alpha', withLines = ['      plan: ${plan.artifacts.plan}'], head = [], uses = 'skill:development' } = {}) {
  const declared = uses.startsWith('workflow:') ? 'implementation/plan.md' : 'docs/plan.md';
  return [
    'name: chain', 'version: 1', ...head, 'nodes:',
    '  plan:', `    uses: ${uses}`, '    dir: alpha', '    provider: claude', '    needs: []',
    '    outputs:', '      artifacts:', `        plan: ${declared}`,
    '  change:', '    uses: workflow:plan', `    dir: ${member}`, '    provider: claude', '    needs: [plan]',
    '    with:', ...withLines,
  ].join('\n') + '\n';
}

function frozen(ws, text, options = {}) {
  const definition = path.join(ws.root, '.maister/workflows/chain.yml');
  fs.writeFileSync(definition, text);
  fs.mkdirSync(ws.run, { recursive: true });
  freeze({ state: path.join(ws.run, 'orchestrator-state.yml') }, { definition, ...options });
}

function envelope(ws, node) {
  const result = umbrella(['envelope', `--run=${ws.run}`, `--node=${node}`, `--ledger=${ws.ledger}`, `--root=${ws.root}`]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

/** Publish a close-out for a dispatch through the outbox verb, as a worker does. */
function closeOut(ws, id, extra = {}) {
  const input = path.join(ws.outbox, id, '.umbrella-input.json');
  fs.mkdirSync(path.dirname(input), { recursive: true });
  fs.writeFileSync(input, JSON.stringify({ grade: 'success', summary: 'planned', prs: [], commits: [], ...extra }));
  const result = umbrella(['outbox', `--outbox=${ws.outbox}`, `--dispatch-id=${id}`, '--type=closeout', `--input-file=${input}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
}

/** Write the plan where alpha's dispatch worked: the run's worktree inside the member. */
function writePlan(ws) {
  const file = path.join(ws.root, 'repos/alpha/.worktrees', `${RUN_ID}-alpha`, 'docs/plan.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Plan\n');
}

/** Dispatch `plan`, close it out and write its artifact. */
function planned(ws) {
  const built = envelope(ws, 'plan');
  assert.equal(built.code, 0, JSON.stringify(built.report.errors));
  closeOut(ws, built.report.dispatch_id);
  writePlan(ws);
}

const PLAN_PATH = `repos/alpha/.worktrees/${RUN_ID}-alpha/docs/plan.md`;

test('references: a same-member artifact reference becomes a read-only input in the shared worktree', (t) => {
  const ws = workspace(t);
  frozen(ws, chain());
  planned(ws);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.envelope.inputs, [{ path: PLAN_PATH, role: 'plan' }]);
  assert.equal(report.envelope.workflow.with.plan, PLAN_PATH, 'the worker is handed the filled value, never the reference');
  assert.equal(report.envelope.target.worktree, `.worktrees/${RUN_ID}-alpha`, 'the referring node continues in the same tree');
});

test('references: a cross-member artifact reference reads the predecessor member\'s worktree', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ member: 'beta' }));
  planned(ws);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.envelope.target.member, 'beta');
  assert.deepEqual(report.envelope.inputs, [{ path: PLAN_PATH, role: 'plan' }]);
});

test('references: a predecessor never dispatched, or without a close-out, is refused dispatch-reference-unclosed', (t) => {
  const ws = workspace(t);
  frozen(ws, chain());

  const undispatched = envelope(ws, 'change');
  assert.equal(undispatched.code, 1);
  assert.equal(undispatched.report.errors[0].code, 'dispatch-reference-unclosed');
  assert.match(undispatched.report.errors[0].message, /no readable envelope for the node "plan"/);

  const dispatched = envelope(ws, 'plan');
  assert.equal(dispatched.code, 0, JSON.stringify(dispatched.report.errors));
  writePlan(ws);
  const unclosed = envelope(ws, 'change');
  assert.equal(unclosed.code, 1);
  assert.equal(unclosed.report.errors[0].code, 'dispatch-reference-unclosed');
  assert.match(unclosed.report.errors[0].message, /has published no close-out/);

  assert.equal(fs.existsSync(path.join(ws.run, 'dispatch/change.envelope.yml')), false, 'no envelope is published');
  const entries = fs.readdirSync(path.join(ws.ledger, 'entries')).filter((name) => name.endsWith('.yml'));
  assert.deepEqual(entries, ['d-0001.yml'], 'no ledger entry is opened for the refused node');
});

test('references: a close-out whose declared artifact is not on disk is refused dispatch-reference-missing', (t) => {
  const ws = workspace(t);
  frozen(ws, chain());
  const built = envelope(ws, 'plan');
  closeOut(ws, built.report.dispatch_id);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 1);
  assert.equal(report.errors[0].code, 'dispatch-reference-missing');
  assert.match(report.errors[0].message, new RegExp(`nothing is at ${PLAN_PATH.replace(/\./g, '\\.')}`));
});

test('references: literal paths and words beside a reference are unchanged; an embedded reference becomes text', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({
    withLines: [
      '      plan: ${plan.artifacts.plan}',
      '      context: runs/research/report.md',
      '      mode: careful',
      '      note: "Follow ${plan.artifacts.plan} closely"',
    ],
  }));
  planned(ws);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  // The resolved graph keeps `with` keys in canonical order, so inputs follow it.
  assert.deepEqual(report.envelope.inputs, [
    { path: 'runs/research/report.md', role: 'context' },
    { path: PLAN_PATH, role: 'plan' },
  ]);
  assert.deepEqual(report.envelope.workflow.with, {
    plan: PLAN_PATH,
    context: 'runs/research/report.md',
    mode: 'careful',
    note: `Follow ${PLAN_PATH} closely`,
  });
});

test('references: an input reference is filled from the run, then judged by the literal rule', (t) => {
  const ws = workspace(t);
  const head = ['inputs:', '  brief:', '    type: path', '    default: docs/default.md', '  level:', '    type: string'];
  frozen(ws, chain({ head, withLines: ['      brief: ${inputs.brief}', '      level: ${inputs.level}'] }), { inputs: { level: 'high' } });
  planned(ws);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.envelope.workflow.with, { brief: 'docs/default.md', level: 'high' });
  assert.deepEqual(report.envelope.inputs, [{ path: 'docs/default.md', role: 'brief' }]);
});

test('references: a value the run never recorded is refused dispatch-reference-unresolved', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ withLines: ['      ready: ${plan.values.ready}'] })
    .replace('        plan: docs/plan.md', '        plan: docs/plan.md\n      values:\n        ready: bool'));

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 1);
  assert.equal(report.errors[0].code, 'dispatch-reference-unresolved');
  assert.match(report.errors[0].message, /records no value "ready" for the node "plan"/);
});

test('references: the seed states the filled input under the workspace root with its role, not as an argument', (t) => {
  const ws = workspace(t);
  frozen(ws, chain());
  planned(ws);
  const { report } = envelope(ws, 'change');

  const lines = renderSeed(buildSeed(report.envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('Inputs from the dispatching run'));
  assert.ok(header >= 0, lines.join('\n'));
  assert.equal(lines[header + 1], `  ${path.resolve(ws.root)}/${PLAN_PATH} (plan)`);
  assert.equal(lines.some((line) => line.startsWith('Arguments:')), false, 'the promoted key is not repeated as an argument');
  assert.equal(lines.some((line) => line.includes('${')), false, 'no reference reaches the worker');
});

// A dispatched `workflow:` node: the worker's run mints its task directory in
// the member worktree, and its close-out lists where each artifact landed.

const TASK = '.maister/tasks/development/2026-01-05-plan';
const WORKTREE = `repos/alpha/.worktrees/${RUN_ID}-alpha`;
const REPORTED_PATH = `${WORKTREE}/${TASK}/implementation/plan.md`;

/** Write a file in alpha's run worktree, at a path relative to that worktree. */
function writeInWorktree(ws, relative) {
  const file = path.join(ws.root, WORKTREE, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Plan\n');
}

/** Dispatch the workflow node `plan` and close it out with the given artifacts list, or none. */
function dispatchedWorkflow(ws, artifacts) {
  const built = envelope(ws, 'plan');
  assert.equal(built.code, 0, JSON.stringify(built.report.errors));
  closeOut(ws, built.report.dispatch_id, artifacts === undefined ? {} : { artifacts });
  return built;
}

function refusedWith(ws, code, pattern) {
  const { code: exit, report } = envelope(ws, 'change');
  assert.equal(exit, 1, JSON.stringify(report));
  assert.equal(report.errors[0].code, code);
  if (pattern) assert.match(report.errors[0].message, pattern);
  assert.equal(fs.existsSync(path.join(ws.run, 'dispatch/change.envelope.yml')), false, 'no envelope is published');
}

test('references: a dispatched workflow node\'s artifact is read from the path its close-out lists, in the same member', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan' }));
  dispatchedWorkflow(ws, [{ key: 'plan', path: `${TASK}/implementation/plan.md` }]);
  writeInWorktree(ws, `${TASK}/implementation/plan.md`);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.envelope.inputs, [{ path: REPORTED_PATH, role: 'plan' }]);
  assert.equal(report.envelope.workflow.with.plan, REPORTED_PATH);
});

test('references: a dispatched workflow node\'s artifact is read in its own member by a node for another member', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan', member: 'beta' }));
  dispatchedWorkflow(ws, [{ key: 'plan', path: `${TASK}/implementation/plan.md` }]);
  writeInWorktree(ws, `${TASK}/implementation/plan.md`);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.envelope.target.member, 'beta');
  assert.deepEqual(report.envelope.inputs, [{ path: REPORTED_PATH, role: 'plan' }]);
});

test('references: the newest close-out of a dispatched workflow node is the one read', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan' }));
  const built = dispatchedWorkflow(ws, [{ key: 'plan', path: 'stale/plan.md' }]);
  closeOut(ws, built.report.dispatch_id, { artifacts: [{ key: 'plan', path: `${TASK}/implementation/plan.md` }] });
  writeInWorktree(ws, `${TASK}/implementation/plan.md`);

  const { code, report } = envelope(ws, 'change');
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.envelope.workflow.with.plan, REPORTED_PATH);
});

test('references: a dispatched workflow node with no close-out is refused dispatch-reference-unclosed', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan' }));
  refusedWith(ws, 'dispatch-reference-unclosed', /no readable envelope for the node "plan"/);
  const built = envelope(ws, 'plan');
  assert.equal(built.code, 0, JSON.stringify(built.report.errors));
  writeInWorktree(ws, `${TASK}/implementation/plan.md`);
  refusedWith(ws, 'dispatch-reference-unclosed', /has published no close-out/);
});

test('references: a close-out that does not list the key is refused dispatch-reference-missing, never guessed', (t) => {
  for (const artifacts of [undefined, [], [{ key: 'other', path: `${TASK}/other.md` }]]) {
    const ws = workspace(t);
    frozen(ws, chain({ uses: 'workflow:plan' }));
    dispatchedWorkflow(ws, artifacts);
    // The declared child-relative path is on disk at the worktree root, and is still not taken.
    writeInWorktree(ws, 'implementation/plan.md');
    refusedWith(ws, 'dispatch-reference-missing', /lists no artifact "plan" under artifacts/);
  }
});

test('references: a close-out listing an unsafe path is refused dispatch-reference-missing', (t) => {
  for (const unsafe of ['/etc/plan.md', 'C:/plan.md', '../outside/plan.md', `${TASK}/../../plan.md`, 'my plan.md', '${inputs.x}/plan.md']) {
    const ws = workspace(t);
    frozen(ws, chain({ uses: 'workflow:plan' }));
    dispatchedWorkflow(ws, [{ key: 'plan', path: unsafe }]);
    refusedWith(ws, 'dispatch-reference-missing', /is not a relative path inside its working directory/);
  }
});

test('references: a close-out listing a file that is not on disk is refused dispatch-reference-missing', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan' }));
  dispatchedWorkflow(ws, [{ key: 'plan', path: `${TASK}/implementation/plan.md` }]);
  refusedWith(ws, 'dispatch-reference-missing', new RegExp(`nothing is at ${REPORTED_PATH.replace(/\./g, '\\.')}`));
});

test('references: a dispatched workflow node\'s envelope asks for its declared keys, and its seed tells the worker to list them', (t) => {
  const ws = workspace(t);
  frozen(ws, chain({ uses: 'workflow:plan' }));
  const { report } = envelope(ws, 'plan');
  assert.deepEqual(report.envelope.closeout_contract.artifacts, ['plan']);

  const lines = renderSeed(buildSeed(report.envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split(/\r?\n/);
  const asked = lines.find((line) => line.startsWith('It also carries `artifacts`'));
  assert.ok(asked, lines.join('\n'));
  assert.match(asked, /one \{key, path\} entry for each of the keys plan that your run wrote/);
  assert.match(asked, /relative to your working directory/);
});

test('references: a plain dispatching node asks for no artifacts list, and its seed says nothing of one', (t) => {
  const ws = workspace(t);
  frozen(ws, chain());
  const { report } = envelope(ws, 'plan');
  assert.equal(Object.hasOwn(report.envelope.closeout_contract, 'artifacts'), false);
  const text = renderSeed(buildSeed(report.envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  assert.equal(text.includes('It also carries `artifacts`'), false);
});

test('outbox: a close-out without artifacts still lands; a malformed artifacts list is refused', (t) => {
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-artifacts-outbox-'));
  t.after(() => fs.rmSync(outbox, { recursive: true, force: true }));
  const send = (body) => umbrella(['outbox', `--outbox=${outbox}`, '--dispatch-id=d-0001', '--type=closeout'],
    { grade: 'success', summary: 'Done.', prs: [], commits: [], ...body });

  const bare = send({});
  assert.equal(bare.code, 0, bare.stdout + bare.stderr);
  const listed = send({ artifacts: [{ key: 'plan', path: `${TASK}/implementation/plan.md` }] });
  assert.equal(listed.code, 0, listed.stdout + listed.stderr);
  const written = fs.readFileSync(JSON.parse(listed.stdout).written, 'utf8');
  assert.match(written, /^artifacts: \[\{key: plan, path: \.maister\/tasks\/development\/2026-01-05-plan\/implementation\/plan\.md\}\]$/m);

  for (const artifacts of [['implementation/plan.md'], [{ key: 'plan' }], [{ key: '', path: 'a.md' }],
    [{ key: 'plan', path: 'a.md' }, { key: 'plan', path: 'b.md' }]]) {
    const refused = send({ artifacts });
    assert.equal(refused.code, 1, JSON.stringify(artifacts));
    assert.equal(JSON.parse(refused.stdout).errors[0].code, 'outbox-message-invalid');
  }
  assert.equal(fs.readdirSync(path.join(outbox, 'd-0001')).filter((name) => name.endsWith('.yml')).length, 2);
});
