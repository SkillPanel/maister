import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, umbrella } from '../helpers.mjs';

// A dispatch works in one worktree and on one branch per run and member, so a
// later node for a member continues the branch an earlier node started and its
// pull request is updated rather than duplicated. Sharing is safe only while
// the member's nodes are ordered, and only while the branch convention names no
// value that differs between them — `validate` refuses both, and each refusal
// is checked beside a control that passes.

const PLANNED = [
  'name: chain', 'version: 1', 'nodes:',
  '  plan:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
  '  change:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: [plan]',
  '  other:', '    uses: workflow:plan', '    dir: beta', '    provider: claude', '    needs: []',
].join('\n') + '\n';

/** A scaffolded workspace with members `alpha` and `beta`. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const member of ['alpha', 'beta']) fs.mkdirSync(path.join(root, 'repos', member), { recursive: true });
  const init = umbrella(['init', `--root=${root}`, '--members-root=repos']);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}',
    'members:\n  alpha: {path: repos/alpha, kind: repo}\n  beta: {path: repos/beta, kind: repo}'));
  return { root, manifest };
}

/** Write a chain into the workspace and return its path. */
function chain(ws, text, name = 'chain') {
  const file = path.join(ws.root, '.maister/workflows', `${name}.yml`);
  fs.writeFileSync(file, text);
  return file;
}

/** Replace the manifest's branch convention line; `null` writes the key as null. */
function convention(ws, value) {
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace(/^branch_convention: .*$/m, `branch_convention: ${value === null ? 'null' : `"${value}"`}`));
}

function validate(ws, ...definitions) {
  const result = umbrella(['validate', `--root=${ws.root}`, ...definitions.map((file) => `--definition=${file}`)]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

test('envelope: two ordered nodes for one member share its worktree and branch; another member gets its own', (t) => {
  const ws = workspace(t);
  const definition = chain(ws, PLANNED);
  const run = path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain');
  fs.mkdirSync(run, { recursive: true });
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });

  const built = {};
  for (const node of ['plan', 'change', 'other']) {
    const result = umbrella(['envelope', `--run=${run}`, `--node=${node}`,
      `--ledger=${path.join(ws.root, '.maister/umbrella/ledger')}`, `--root=${ws.root}`], {});
    assert.equal(result.code, 0, result.stdout + result.stderr);
    built[node] = JSON.parse(result.stdout).envelope;
  }

  assert.equal(built.plan.target.worktree, '.worktrees/2026-01-05-chain-alpha');
  assert.equal(built.plan.branch, 'feature/2026-01-05-chain-alpha');
  assert.equal(built.change.target.worktree, built.plan.target.worktree, 'the later node continues in the same tree');
  assert.equal(built.change.branch, built.plan.branch, 'the later node continues on the same branch');

  assert.equal(built.other.target.worktree, '.worktrees/2026-01-05-chain-beta');
  assert.equal(built.other.branch, 'feature/2026-01-05-chain-beta');
});

test('validate: two nodes for one member that needs does not order are refused, naming both', (t) => {
  const ws = workspace(t);
  const unordered = chain(ws, PLANNED.replace('    needs: [plan]', '    needs: []'));
  const { code, report } = validate(ws, unordered);
  assert.equal(code, 1);
  const found = report.errors.filter((error) => error.path === 'nodes.plan.dir');
  assert.equal(found.length, 1, JSON.stringify(report.errors));
  assert.match(found[0].message, /"change" and "plan" both dispatch into the member "alpha"/);
  assert.match(found[0].message, /add one to the other's needs/);
});

test('validate: control — direct, transitive and cross-member orderings pass', (t) => {
  const ws = workspace(t);
  const direct = chain(ws, PLANNED, 'direct');
  const transitive = chain(ws, PLANNED
    .replace('    needs: [plan]', '    needs: [review]')
    .replace('  other:', '  review:\n    uses: workflow:plan\n    needs: [plan]\n  other:'), 'transitive');
  const { code, report } = validate(ws, direct, transitive);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
});

test('validate: a branch convention naming {node} or {dispatch_id} is refused at branch_convention', (t) => {
  const ws = workspace(t);
  for (const [value, token] of [['feature/{run_id}-{node}', /names \{node\}/], ['work/{dispatch_id}', /names \{dispatch_id\}/]]) {
    convention(ws, value);
    const { code, report } = validate(ws);
    assert.equal(code, 1, value);
    const found = report.errors.filter((error) => error.path === 'branch_convention');
    assert.equal(found.length, 1, JSON.stringify(report.errors));
    assert.match(found[0].message, token);
    assert.match(found[0].message, /edit the manifest's branch_convention/);
  }
});

test('validate: control — the scaffolded convention names the member and passes, as does no convention', (t) => {
  const ws = workspace(t);
  assert.match(fs.readFileSync(ws.manifest, 'utf8'), /^branch_convention: "?feature\/\{run_id\}-\{member\}"?$/m);
  const scaffolded = validate(ws);
  assert.equal(scaffolded.code, 0, JSON.stringify(scaffolded.report.errors));
  assert.deepEqual(scaffolded.report.errors, []);
  assert.deepEqual(scaffolded.report.warnings, []);

  convention(ws, null);
  const absent = validate(ws);
  assert.equal(absent.code, 0, JSON.stringify(absent.report.errors));
});

// A statement is an author's text, and an author may quote a button's label in
// it. The chain spelled it legally, so `validate` passes it — and the envelope
// has to publish it, quotes and all, or the operator learns at dispatch that a
// valid chain cannot run. The seed reads it back unchanged.

test('envelope: a statement carrying quotes that validate passes is published and read back by the seed unchanged', (t) => {
  const ws = workspace(t);
  const statement = `[UI] Rename the "Save" button to 'Keep'`;
  const definition = chain(ws, [
    'name: chain', 'version: 1', 'nodes:',
    '  plan:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
    '    with:', `      statement: '${statement.replace(/'/g, "''")}'`,
  ].join('\n') + '\n');
  assert.equal(validate(ws, definition).code, 0);
  const run = path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain');
  fs.mkdirSync(run, { recursive: true });
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });

  const result = umbrella(['envelope', `--run=${run}`, '--node=plan',
    `--ledger=${path.join(ws.root, '.maister/umbrella/ledger')}`, `--root=${ws.root}`], {});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const published = JSON.parse(result.stdout).path;

  const seeded = umbrella(['seed', `--envelope=${published}`]);
  assert.equal(seeded.code, 0, seeded.stdout + seeded.stderr);
  const { descriptor, prompt } = JSON.parse(seeded.stdout);
  assert.ok(prompt.split('\n').includes(`The work: ${statement}`), prompt);
  assert.equal(descriptor.dispatch_id, 'd-0001');
});

// The autonomy ceiling travels in the envelope: `with.ceiling`, then the
// member's, then the manifest defaults', then the dispatching run's own — and
// whatever resolves is clamped to the dispatching run's ceiling, never wider.
// A dispatching run with no ceiling dispatches none.

/**
 * Build one envelope for the node `plan` in `alpha`. `withCeiling`, `member` and
 * `defaults` place a ceiling at that level of the chain; `dispatcher` is the
 * dispatching run's recorded `orchestrator.options.ceiling`.
 */
function ceilingEnvelope(t, { withCeiling, member, defaults, dispatcher } = {}) {
  const ws = workspace(t);
  const text = fs.readFileSync(ws.manifest, 'utf8');
  let manifest = text;
  if (member !== undefined) manifest = manifest.replace('alpha: {path: repos/alpha, kind: repo}', `alpha: {path: repos/alpha, kind: repo, ceiling: ${member}}`);
  if (defaults !== undefined) manifest = manifest.replace('  autonomy: attended\n', `  autonomy: attended\n  ceiling: ${defaults}\n`);
  fs.writeFileSync(ws.manifest, manifest);
  const definition = chain(ws, [
    'name: chain', 'version: 1', 'nodes:',
    '  plan:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
    ...(withCeiling === undefined ? [] : ['    with:', `      ceiling: ${withCeiling}`]),
  ].join('\n') + '\n');
  const run = path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain');
  fs.mkdirSync(run, { recursive: true });
  const orchestrator = dispatcher === undefined ? {} : { options: { ceiling: dispatcher } };
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition, orchestrator });
  const result = umbrella(['envelope', `--run=${run}`, '--node=plan',
    `--ledger=${path.join(ws.root, '.maister/umbrella/ledger')}`, `--root=${ws.root}`], {});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  return { envelope: report.envelope, text: fs.readFileSync(report.path, 'utf8') };
}

test('envelope: the ceiling resolves with, then member, then defaults, then the dispatching run', (t) => {
  const all = { withCeiling: 'approve', member: 'advice', defaults: 'decide', dispatcher: 'decide' };
  assert.equal(ceilingEnvelope(t, all).envelope.ceiling, 'approve');
  assert.equal(ceilingEnvelope(t, { ...all, withCeiling: undefined }).envelope.ceiling, 'advice');
  assert.equal(ceilingEnvelope(t, { ...all, withCeiling: undefined, member: undefined, defaults: 'advice' }).envelope.ceiling, 'advice');
  const fromRun = ceilingEnvelope(t, { dispatcher: 'advice' });
  assert.equal(fromRun.envelope.ceiling, 'advice');
  assert.match(fromRun.text, /^autonomy: attended\nceiling: advice\npermissions:$/m, 'the line follows autonomy');
});

test('envelope: a with.ceiling of decide under an advice dispatcher is clamped to advice', (t) => {
  assert.equal(ceilingEnvelope(t, { withCeiling: 'decide', dispatcher: 'advice' }).envelope.ceiling, 'advice');
  assert.equal(ceilingEnvelope(t, { member: 'decide', dispatcher: 'approve' }).envelope.ceiling, 'approve');
});

test('envelope: a dispatching run with no ceiling dispatches none, even when with.ceiling names one', (t) => {
  const { envelope, text } = ceilingEnvelope(t, { withCeiling: 'approve', member: 'advice' });
  assert.equal(Object.hasOwn(envelope, 'ceiling'), false, JSON.stringify(envelope));
  assert.doesNotMatch(text, /^ceiling:/m);
});

test('envelope: nothing resolving writes no ceiling line, the envelope unchanged', (t) => {
  const { envelope, text } = ceilingEnvelope(t);
  assert.equal(Object.hasOwn(envelope, 'ceiling'), false);
  assert.doesNotMatch(text, /ceiling/);
  assert.match(text, /^autonomy: attended\npermissions:$/m);
});

test('envelope: an unknown ceiling value reads as approve, with no refusal', (t) => {
  assert.equal(ceilingEnvelope(t, { withCeiling: 'everything', dispatcher: 'decide' }).envelope.ceiling, 'approve');
  assert.equal(ceilingEnvelope(t, { dispatcher: 'whatever' }).envelope.ceiling, 'approve');
});
