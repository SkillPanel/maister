import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT, freeze, umbrella } from '../helpers.mjs';
import { buildSeed, renderSeed } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';

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
  assert.deepEqual(['plan', 'change', 'other'].map((node) => built[node].dispatch_id), ['d-0001', 'd-0002', 'd-0003'],
    'each node is its own dispatch, under its own id');
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

// A node that publishes asks its workflow to push the branch and open a pull
// request, and the gate approving the plan grants both — so the close-out owes
// one even at a tier that cannot open one on its own. A declared `false` still
// wins, and `validate` warns about that pair rather than refusing it.

/** The chain for one `development` node in `alpha` with the given `with:` lines. */
function publishChain(ws, withLines) {
  return chain(ws, [
    'name: chain', 'version: 1', 'nodes:',
    '  dev:', '    uses: workflow:development', '    dir: alpha', '    provider: claude', '    needs: []',
    '    with:', '      autonomy: auto-medium', ...withLines.map((line) => `      ${line}`),
  ].join('\n') + '\n');
}

/** Freeze the chain and build the envelope for `dev`, with optional overrides on stdin. */
function dispatch(ws, definition, overrides = {}) {
  const run = path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain');
  fs.mkdirSync(run, { recursive: true });
  freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });
  return umbrella(['envelope', `--run=${run}`, '--node=dev',
    `--ledger=${path.join(ws.root, '.maister/umbrella/ledger')}`, `--root=${ws.root}`], overrides);
}

function published(result) {
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

/** Name the workspace's git host in its manifest. */
function gitHost(ws, kind = 'github') {
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace(/^git_host:\n {2}kind: null$/m, `git_host:\n  kind: ${kind}`));
}

/** Make the member `alpha` a git checkout with one remote at `url`. */
function remote(ws, url) {
  const checkout = path.join(ws.root, 'repos', 'alpha');
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', url]]) {
    const run = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
}

test('envelope: a node that publishes owes a pull request, even at a tier that cannot open one alone', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  const { envelope } = published(dispatch(ws, publishChain(ws, ['publish: true'])));
  assert.equal(envelope.closeout_contract.pr_required, true);
});

test('envelope: control — the same node without publish derives no pull request from its tier', (t) => {
  const ws = workspace(t);
  const { envelope } = published(dispatch(ws, publishChain(ws, [])));
  assert.equal(envelope.closeout_contract.pr_required, false);
});

test('envelope: a declared false outranks publish, from the node and from the override', (t) => {
  const declared = workspace(t);
  const fromNode = published(dispatch(declared, publishChain(declared, ['publish: true', 'closeout_contract: {pr_required: false}'])));
  assert.equal(fromNode.envelope.closeout_contract.pr_required, false);

  const overridden = workspace(t);
  const fromOverride = published(dispatch(overridden, publishChain(overridden, ['publish: true']), { closeout_contract: { pr_required: false } }));
  assert.equal(fromOverride.envelope.closeout_contract.pr_required, false);
});

// Publishing needs a git host behind the member — the manifest's git_host.kind,
// or a remote of the member's own on a host — and a dispatch that has neither is
// refused before its entry is opened or its envelope published.

test('envelope: publish with no git host is refused dispatch-no-git-host, and nothing is written', (t) => {
  const ws = workspace(t);
  const result = dispatch(ws, publishChain(ws, ['publish: true']));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errors[0].code, 'dispatch-no-git-host');
  assert.match(report.errors[0].message, /git_host\.kind/);
  assert.match(report.errors[0].message, /remote/);
  assert.match(report.errors[0].message, /drop publish/);
  const run = path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain');
  assert.equal(fs.existsSync(path.join(run, 'dispatch/dev.envelope.yml')), false, 'no envelope is published');
  const entries = path.join(ws.root, '.maister/umbrella/ledger/entries');
  assert.deepEqual(fs.existsSync(entries) ? fs.readdirSync(entries) : [], [], 'no ledger entry is opened');
});

test('envelope: publish with git_host.kind set is dispatched', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  assert.equal(published(dispatch(ws, publishChain(ws, ['publish: true']))).envelope.closeout_contract.pr_required, true);
});

test('envelope: publish with no git_host but a member remote on a host is dispatched', (t) => {
  for (const url of ['git@github.com:acme/alpha.git', 'https://gitlab.example.com/acme/alpha.git']) {
    const ws = workspace(t);
    remote(ws, url);
    assert.equal(published(dispatch(ws, publishChain(ws, ['publish: true']))).envelope.closeout_contract.pr_required, true, url);
  }
});

test('envelope: a member remote on a local path is no git host, so publish is refused', (t) => {
  const ws = workspace(t);
  remote(ws, path.join(ws.root, 'bare.git'));
  const result = dispatch(ws, publishChain(ws, ['publish: true']));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).errors[0].code, 'dispatch-no-git-host');
});

test('envelope: control — no publish and no git host is dispatched as before', (t) => {
  const ws = workspace(t);
  assert.equal(published(dispatch(ws, publishChain(ws, []))).envelope.closeout_contract.pr_required, false);
});

test('validate: publish beside a declared pr_required false is a named warning, not a refusal', (t) => {
  const ws = workspace(t);
  const { code, report } = validate(ws, publishChain(ws, ['publish: true', 'closeout_contract: {pr_required: false}']));
  assert.equal(code, 0, JSON.stringify(report));
  const warned = report.warnings.filter((entry) => entry.code === 'publish-pr-declined');
  assert.equal(warned.length, 1, JSON.stringify(report.warnings));
  assert.equal(warned[0].path, 'nodes.dev.with.closeout_contract.pr_required');
});

test('validate: control — publish alone, or a declared false alone, warns nothing about the pair', (t) => {
  const ws = workspace(t);
  const alone = validate(ws, publishChain(ws, ['publish: true']));
  const declined = validate(ws, publishChain(ws, ['closeout_contract: {pr_required: false}']));
  for (const { code, report } of [alone, declined]) {
    assert.equal(code, 0, JSON.stringify(report));
    assert.equal(report.warnings.filter((entry) => entry.code === 'publish-pr-declined').length, 0);
  }
});

// A git host that takes no pull request is declared in the manifest —
// `git_host.pull_requests: false`, or on one member's entry — and never probed.
// On such a member no pull request is owed at any tier, `publish: true`
// included; the envelope records why and the seed tells the worker to push and
// close out without one. A host that takes one is dispatched exactly as before.

/** Declare `pull_requests: false` on the workspace's git host. */
function noPullRequests(ws) {
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace(/^( {2}org: null)$/m, '$1\n  pull_requests: false'));
}

function closeoutSection(envelope) {
  const lines = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split('\n');
  return lines.slice(lines.indexOf('# closeout'), lines.indexOf('# siblings'));
}

test('envelope: a host declared to take no pull request owes none, publish and the attended relay notwithstanding', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  noPullRequests(ws);
  const { envelope } = published(dispatch(ws, publishChain(ws, ['publish: true']).replace('autonomy: auto-medium', 'autonomy: attended')));
  assert.deepEqual(envelope.closeout_contract, { pr_required: false, host_takes_pr: false, grade: ['success', 'partial', 'failed'] });
  const closeout = closeoutSection(envelope);
  assert.match(closeout[1], /^No pull request can be opened - the workspace declares that this member's git host takes none\. Do not run `gh pr view` or `gh pr create`/);
  assert.match(closeout[1], /close out with `prs` empty/);
  assert.equal(closeout.filter((line) => /pull request is required/.test(line)).length, 0);
});

test('envelope: a member declared to take no pull request wins over a hosted workspace', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace('alpha: {path: repos/alpha, kind: repo}', 'alpha: {path: repos/alpha, kind: repo, pull_requests: false}'));
  const { envelope } = published(dispatch(ws, publishChain(ws, ['publish: true'])));
  assert.equal(envelope.closeout_contract.pr_required, false);
  assert.equal(envelope.closeout_contract.host_takes_pr, false);
});

test('envelope: a declared pull request on a host that takes none is refused dispatch-closeout-impossible', (t) => {
  const ws = workspace(t);
  noPullRequests(ws);
  const result = dispatch(ws, publishChain(ws, ['closeout_contract: {pr_required: true}']).replace('autonomy: auto-medium', 'autonomy: auto-high'));
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.errors[0].code, 'dispatch-closeout-impossible');
  assert.match(report.errors[0].message, /pull_requests: false/);
});

test('envelope: control — a host that takes one keeps the close-out contract it had, with no new key', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  const text = fs.readFileSync(ws.manifest, 'utf8');
  fs.writeFileSync(ws.manifest, text.replace(/^( {2}org: null)$/m, '$1\n  pull_requests: true'));
  const { envelope } = published(dispatch(ws, publishChain(ws, ['publish: true'])));
  assert.deepEqual(envelope.closeout_contract, { pr_required: true, grade: ['success', 'partial', 'failed'] });
  assert.equal(closeoutSection(envelope)[1], 'A pull request is required before close-out; open it and put its URL in the closeout message.');
});

test('validate: a pull_requests that is not a boolean is an error at its path, on the host and on a member', (t) => {
  const ws = workspace(t);
  const text = fs.readFileSync(ws.manifest, 'utf8')
    .replace(/^( {2}org: null)$/m, '$1\n  pull_requests: no-thanks')
    .replace('beta: {path: repos/beta, kind: repo}', 'beta: {path: repos/beta, kind: repo, pull_requests: 0}');
  fs.writeFileSync(ws.manifest, text);
  const { code, report } = validate(ws);
  assert.equal(code, 1);
  const paths = report.errors.map((error) => error.path);
  assert.ok(paths.includes('git_host.pull_requests'), JSON.stringify(report.errors));
  assert.ok(paths.includes('members.beta.pull_requests'), JSON.stringify(report.errors));
});


// The other dispatches of an outcome travel in the envelope only when the
// caller lists them. Listed, each is written and read back into the seed as a
// read-only reference; absent, the envelope carries no key; malformed, the
// dispatch is refused and nothing is published.

const SIBLINGS = [
  { member: 'beta', branch: 'feature/2026-01-05-chain-beta', worktree: '.worktrees/2026-01-05-chain-beta' },
  { member: 'gamma', branch: 'feature/2026-01-05-chain-gamma', worktree: '.worktrees/2026-01-05-chain-gamma' },
];

test('envelope: listed siblings are written with their member path and named by the seed as read-only references', (t) => {
  const ws = workspace(t);
  const report = published(dispatch(ws, publishChain(ws, []), { siblings: SIBLINGS }));
  // A declared member gains its manifest path; one the manifest does not declare is written as sent.
  assert.deepEqual(report.envelope.siblings, [{ ...SIBLINGS[0], path: 'repos/beta' }, SIBLINGS[1]]);
  assert.match(fs.readFileSync(report.path, 'utf8'), /^siblings: \[\{member: beta, path: repos\/beta, branch: feature\/2026-01-05-chain-beta, worktree: \.worktrees\/2026-01-05-chain-beta\}, \{member: gamma, branch: feature\/2026-01-05-chain-gamma, worktree: \.worktrees\/2026-01-05-chain-gamma\}\]$/m);

  const seeded = umbrella(['seed', `--envelope=${report.path}`]);
  assert.equal(seeded.code, 0, seeded.stdout + seeded.stderr);
  const lines = JSON.parse(seeded.stdout).prompt.split(/\r?\n/);
  const section = lines.slice(lines.indexOf('# siblings'));
  assert.ok(section.some((line) => /for reading only - never edit, commit or run anything that writes there/.test(line)), section.join('\n'));
  const anchored = `${report.envelope.workspace_root}/repos/beta/.worktrees/2026-01-05-chain-beta`;
  assert.ok(section.includes(`- beta: worktree ${anchored}, branch feature/2026-01-05-chain-beta`), section.join('\n'));
  assert.ok(section.includes('- gamma: worktree .worktrees/2026-01-05-chain-gamma, branch feature/2026-01-05-chain-gamma'), section.join('\n'));
});

test('envelope: control — no siblings listed writes no key, and an empty list is the same', (t) => {
  for (const overrides of [{}, { siblings: [] }]) {
    const ws = workspace(t);
    const report = published(dispatch(ws, publishChain(ws, []), overrides));
    assert.equal(Object.hasOwn(report.envelope, 'siblings'), false);
    assert.doesNotMatch(fs.readFileSync(report.path, 'utf8'), /siblings/);
  }
});

test('envelope: a malformed siblings list is refused dispatch-siblings-invalid and nothing is published', (t) => {
  for (const siblings of ['beta', [{ member: 'beta', branch: 'feature/x' }], [{ member: '', branch: 'b', worktree: 'w' }]]) {
    const ws = workspace(t);
    const result = dispatch(ws, publishChain(ws, []), { siblings });
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).errors[0].code, 'dispatch-siblings-invalid');
    assert.equal(fs.existsSync(path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain/dispatch/dev.envelope.yml')), false);
  }
});

// A dispatch that continues a branch an earlier one delivered names the worktree
// that already holds it, beside the branch: git refuses a second worktree on a
// branch one holds. The override is held to the derived worktree's shape, and
// marks the close-out contract so the seed updates the open pull request rather
// than opening another.

const CONTINUED = { branch: 'feature/2026-01-01-chain-alpha', worktree: '.worktrees/2026-01-01-chain-alpha' };
const UPDATE_LINE = 'You continue a branch an earlier dispatch delivered. If it already has an open pull request, update that pull request by pushing to the branch, put its URL in the closeout message, and never run `gh pr create` again.';

/** Every file under a directory, relative to it, sorted. */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).filter((each) => fs.statSync(path.join(dir, each)).isFile()).sort();
}

test('envelope: a worktree override is used with the branch override, marks the close-out, and the seed updates the open pull request', (t) => {
  const ws = workspace(t);
  gitHost(ws);
  const report = published(dispatch(ws, publishChain(ws, ['publish: true']), CONTINUED));
  assert.equal(report.envelope.target.worktree, CONTINUED.worktree);
  assert.equal(report.envelope.branch, CONTINUED.branch);
  assert.deepEqual(report.envelope.closeout_contract, { pr_required: true, continues_branch: true, grade: ['success', 'partial', 'failed'] });
  const text = fs.readFileSync(report.path, 'utf8');
  assert.match(text, /^target: \{member: alpha, path: repos\/alpha, worktree: \.worktrees\/2026-01-01-chain-alpha\}$/m);
  assert.match(text, /^closeout_contract: \{pr_required: true, continues_branch: true, /m);
  assert.equal(closeoutSection(report.envelope).filter((line) => line === UPDATE_LINE).length, 1);
});

test('envelope: a worktree override is used even where the workspace opts out of worktrees', (t) => {
  for (const [overrides, expected] of [[{}, null], [CONTINUED, CONTINUED.worktree]]) {
    const ws = workspace(t);
    fs.writeFileSync(ws.manifest, fs.readFileSync(ws.manifest, 'utf8').replace(/^ {2}worktree: true$/m, '  worktree: false'));
    assert.equal(published(dispatch(ws, publishChain(ws, []), overrides)).envelope.target.worktree, expected);
  }
});

test('envelope: control — no worktree override derives the run and member worktree, with no new key or seed line', (t) => {
  for (const overrides of [{}, { worktree: null }, { branch: CONTINUED.branch }]) {
    const ws = workspace(t);
    gitHost(ws);
    const report = published(dispatch(ws, publishChain(ws, ['publish: true']), overrides));
    assert.equal(report.envelope.target.worktree, '.worktrees/2026-01-05-chain-alpha');
    assert.deepEqual(report.envelope.closeout_contract, { pr_required: true, grade: ['success', 'partial', 'failed'] });
    assert.doesNotMatch(fs.readFileSync(report.path, 'utf8'), /continues_branch/);
    assert.equal(closeoutSection(report.envelope).includes(UPDATE_LINE), false);
  }
});

test('envelope: a worktree override not shaped .worktrees/<name> is refused dispatch-worktree-invalid, and nothing is written', (t) => {
  const refused = [
    '/abs/.worktrees/x', '../x', '.worktrees/../x', '.worktrees/a/b', '.worktrees/a..b', 'worktrees/x',
    '.worktrees/', '.worktrees/-x', '.worktrees/.x', '.worktrees/a b', '.worktrees\\x', 'x', '', 42, true, ['.worktrees/x'],
  ];
  for (const worktree of refused) {
    const ws = workspace(t);
    const ledger = path.join(ws.root, '.maister/umbrella/ledger');
    const before = filesUnder(ledger);
    const result = dispatch(ws, publishChain(ws, []), { branch: CONTINUED.branch, worktree });
    assert.equal(result.code, 1, `${JSON.stringify(worktree)}: ${result.stdout}${result.stderr}`);
    const error = JSON.parse(result.stdout).errors[0];
    assert.equal(error.code, 'dispatch-worktree-invalid', JSON.stringify(worktree));
    assert.match(error.message, /Nothing was written\.$/);
    assert.equal(fs.existsSync(path.join(ws.root, '.maister/umbrella/runs/2026-01-05-chain/dispatch/dev.envelope.yml')), false);
    assert.deepEqual(filesUnder(ledger), before, `${JSON.stringify(worktree)} opened a ledger entry`);
  }
});
