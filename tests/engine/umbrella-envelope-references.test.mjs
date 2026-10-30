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
// closed out and the file is there. The filled path becomes a read-only input
// under its `with` key, as a literal path does. A reference that cannot be
// filled is refused by name, never dropped.

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

/** A chain whose `plan` node writes `docs/plan.md` in alpha and whose `change` node reads it. */
function chain({ member = 'alpha', withLines = ['      plan: ${plan.artifacts.plan}'], head = [] } = {}) {
  return [
    'name: chain', 'version: 1', ...head, 'nodes:',
    '  plan:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
    '    outputs:', '      artifacts:', '        plan: docs/plan.md',
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
function closeOut(ws, id) {
  const input = path.join(ws.outbox, id, '.umbrella-input.json');
  fs.mkdirSync(path.dirname(input), { recursive: true });
  fs.writeFileSync(input, JSON.stringify({ grade: 'success', summary: 'planned', prs: [], commits: [] }));
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
