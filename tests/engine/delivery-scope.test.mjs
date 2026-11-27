import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readState, scratch, scratchTree, verb, walkTo, write } from '../helpers.mjs';
import { scopeProblems } from '../../plugins/maister/skills/workflow-engine/scripts/lib/delivery-scope.mjs';

// The delivery scope check. Product design's brief writes the scope a delivery
// is planned from, in the shape its reference fixes: lists of entries, each
// carrying its name. A workspace run once wrote the lists as maps keyed by
// member name — the workspace manifest's shape — and nothing read the file
// before the person approved it. The engine now checks it when the step that
// declares it closes, and again when its gate is briefed, one line per problem.

const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');
const WORKSPACE_SCOPE = path.join(FIXTURES, 'delivery-scope/workspace.yml');
const MAP_FORM = path.join(FIXTURES, 'delivery-scope/map-form.yml');
const MANIFEST = path.join(FIXTURES, 'delivery-scope/umbrella.yml');
const SINGLE_SCOPE = path.join(FIXTURES, 'runs/team-calendar-sharing/outputs/delivery-scope.yml');
const SCOPE = 'outputs/delivery-scope.yml';

const MEMBERS_MAP = 'members is a map keyed by member name; write a list of {name, statement, depends_on}';
const OUT_MAP = 'out_of_scope is a map keyed by member name; write a list of {name, reason}';

/** A project holding `scope` as its scope file, and the workspace manifest when `workspace`; the problems the check finds. */
function problemsOf(t, scope, { workspace = false } = {}) {
  const files = { 'scope.yml': scope };
  if (workspace) files[path.join('.maister', 'umbrella.yml')] = fs.readFileSync(MANIFEST, 'utf8');
  const root = scratchTree(t, files);
  return scopeProblems({ file: path.join(root, 'scope.yml'), projectRoot: root });
}

/** The reference's example with `edit` applied to its text. */
function workspaceScope(edit = text => text) {
  return edit(fs.readFileSync(WORKSPACE_SCOPE, 'utf8'));
}

// ---------------------------------------------------------------------------
// the check, file by file
// ---------------------------------------------------------------------------

test('scope check: the reference example passes in a workspace that declares its three members', t => {
  assert.deepEqual(problemsOf(t, workspaceScope(), { workspace: true }), []);
});

test('scope check: a single-repository scope passes with no manifest', t => {
  assert.deepEqual(problemsOf(t, fs.readFileSync(SINGLE_SCOPE, 'utf8')), []);
});

test('scope check: the map form keyed by member name gets the two fixable lines and nothing else', t => {
  assert.deepEqual(problemsOf(t, fs.readFileSync(MAP_FORM, 'utf8'), { workspace: true }), [MEMBERS_MAP, OUT_MAP]);
});

test('scope check: a missing file and a file outside the YAML subset are each one line', t => {
  const root = scratchTree(t, { 'broken.yml': 'version: 1\nmembers: [\n' });
  assert.match(scopeProblems({ file: path.join(root, 'absent.yml'), projectRoot: root })[0], /^the file is missing; write it/);
  assert.match(scopeProblems({ file: path.join(root, 'broken.yml'), projectRoot: root })[0], /^the file is not in the YAML subset the engine reads/);
});

const RULES = [
  ['an unknown version stops at the version line', text => text.replace('version: 1', 'version: 2'),
    ['version is 2; write the bare number 1, the only version this shape has']],
  ['a missing version', text => text.replace('version: 1\n', ''),
    ['version is missing; write version: 1']],
  ['a member without its statement', text => text.replace('    statement: "Add the share dialog and the guest calendar view"\n', ''),
    ['members[1] (web).statement is missing; write the work in that member, in one line']],
  ['a member without depends_on', text => text.replace('    depends_on: [api]\n', ''),
    ['members[1] (web).depends_on is missing; write depends_on: [] or the in-scope members whose work comes first']],
  ['an out-of-scope entry without its reason', text => text.replace('{name: mobile, reason: "Guests use the web view; the app is unchanged"}', '{name: mobile}'),
    ['out_of_scope[0] (mobile).reason is missing; write why it is left out, in one line']],
  ['a statement on two lines', text => text.replace('"Add the share dialog and the guest calendar view"', '"Add the share dialog\\nand the guest calendar view"'),
    ['members[1] (web).statement spans more than one line; write the work in that member, in one line, on one line']],
  ['a dependency on an out-of-scope member', text => text.replace('depends_on: [api]', 'depends_on: [mobile]'),
    ['members[1] (web).depends_on names mobile, which is out of scope; depend only on members in scope, or move mobile into members']],
  ['a dependency on an unknown member', text => text.replace('depends_on: [api]', 'depends_on: [desktop]'),
    ['members[1] (web).depends_on names desktop, which is not a member in scope; use a name from members, spelled exactly']],
  ['a member depending on itself', text => text.replace('depends_on: [api]', 'depends_on: [web]'),
    ['members[1] (web).depends_on names web itself; a member never waits on its own work']],
  ['a cycle', text => text.replace('    depends_on: []\n', '    depends_on: [web]\n'),
    ['depends_on goes round in a cycle, api → web → api; drop one of those dependencies so the work has an order']],
  ['a workspace member listed nowhere', text => text.replace(/out_of_scope:\n.*\n/, 'out_of_scope: []\n'),
    ['mobile is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason']],
  ['a member doubled across the lists', text => text.replace('{name: mobile,', '{name: web,'),
    ['web appears 2 times across members and out_of_scope; keep one entry, in scope or out of it',
      'mobile is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason']],
  ['a name the manifest does not declare', text => text.replace('{name: mobile,', '{name: mobile-app,'),
    ['mobile is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason',
      'mobile-app is not a member the workspace manifest declares; use the manifest\'s member names, spelled exactly']],
  ['an empty members list', text => text.replace(/members:\n(?: {2}.*\n)+/, 'members: []\n'),
    ['members is empty; write at least one entry {name, statement, depends_on}, the member the work lands in',
      'api is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason',
      'web is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason']],
];

for (const [label, edit, expected] of RULES) {
  test(`scope check: ${label} is refused with its line`, t => {
    const scope = workspaceScope(edit);
    assert.notEqual(scope, workspaceScope(), 'the edit applies');
    assert.deepEqual(problemsOf(t, scope, { workspace: true }), expected);
  });
}

test('scope check: with no manifest the membership rules hold nobody, and a key the shape does not name is not refused', t => {
  const scope = workspaceScope(text => `${text}notes: "kept by an earlier writer"\n`);
  assert.deepEqual(problemsOf(t, scope), []);
});

test('scope check: a manifest that does not read judges no membership', t => {
  const root = scratchTree(t, { 'scope.yml': workspaceScope(text => text.replace(/out_of_scope:\n.*\n/, 'out_of_scope: []\n')), [path.join('.maister', 'umbrella.yml')]: 'members: [\n' });
  assert.deepEqual(scopeProblems({ file: path.join(root, 'scope.yml'), projectRoot: root }), []);
});

// ---------------------------------------------------------------------------
// the closing write and the gate
// ---------------------------------------------------------------------------

/** A product-design run with every step before `brief` closed, in a workspace when `workspace`. */
function atBrief(t, { workspace = false } = {}) {
  const run = scratch(t, { type: 'product-design', name: '2026-11-27-guest-sharing' });
  if (workspace) {
    fs.mkdirSync(path.join(run.root, '.maister'), { recursive: true });
    fs.copyFileSync(MANIFEST, path.join(run.root, '.maister', 'umbrella.yml'));
  }
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Let members share their calendar with guests' } });
  walkTo(run, ['brief']);
  return run;
}

function writeScope(run, from) {
  fs.mkdirSync(path.join(run.dir, 'outputs'), { recursive: true });
  fs.copyFileSync(from, path.join(run.dir, SCOPE));
}

const CLOSE_BRIEF = { nodes: { brief: { status: 'completed' } }, node_summaries: { brief: { summary: 'The brief and the delivery scope.' } } };

function gateBrief(run) {
  return verb(['gate-brief', `--state=${run.state}`, '--node=brief-approval', '--json', '--picker=rich']);
}

test('closing write: the map form is refused with its fixable lines, nothing lands, and the approval is not offered', t => {
  const run = atBrief(t, { workspace: true });
  writeScope(run, MAP_FORM);
  const before = fs.readFileSync(run.state, 'utf8');
  const result = verb(['write-state', `--state=${run.state}`], CLOSE_BRIEF);
  assert.equal(result.code, 1, result.stdout);
  const lines = result.stderr.split('\n');
  assert.ok(lines.includes(`delivery-scope-invalid: ${MEMBERS_MAP}`), result.stderr);
  assert.ok(lines.includes(`delivery-scope-invalid: ${OUT_MAP}`), result.stderr);
  assert.match(result.stderr, /delivery-scope-invalid: brief cannot complete while outputs\/delivery-scope\.yml breaks/);
  assert.match(result.stderr, /^rules: /m);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'the state is byte for byte what it was');
  assert.notEqual(readState(run).workflow.nodes.brief.status, 'completed');
  const asked = gateBrief(run);
  assert.notEqual(asked.code, 0, 'the approval cannot be briefed while the brief is open');
  assert.doesNotMatch(asked.stdout, /approve-brief/);
});

test('closing write: once the file holds the shape, the same write closes the brief and the gate is asked', t => {
  const run = atBrief(t, { workspace: true });
  writeScope(run, MAP_FORM);
  assert.equal(verb(['write-state', `--state=${run.state}`], CLOSE_BRIEF).code, 1);
  writeScope(run, WORKSPACE_SCOPE);
  write(run, CLOSE_BRIEF);
  assert.equal(readState(run).workflow.nodes.brief.status, 'completed');
  const asked = gateBrief(run);
  assert.equal(asked.code, 0, asked.stderr);
  assert.ok(JSON.parse(asked.stdout).options.some(option => option.id === 'approve-brief'), asked.stdout);
});

test('closing write: a workspace run refuses a scope that leaves a manifest member out', t => {
  const run = atBrief(t, { workspace: true });
  writeScope(run, SINGLE_SCOPE);
  const result = verb(['write-state', `--state=${run.state}`], CLOSE_BRIEF);
  assert.equal(result.code, 1);
  for (const name of ['api', 'web', 'mobile']) {
    assert.ok(result.stderr.includes(`delivery-scope-invalid: ${name} is a workspace member listed nowhere`), result.stderr);
  }
});

test('closing write: a brief closed with no scope on disk is refused', t => {
  const run = atBrief(t);
  const result = verb(['write-state', `--state=${run.state}`], CLOSE_BRIEF);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^delivery-scope-invalid: the file is missing/);
});

test('gate brief: a scope rewritten off its shape after the close is refused, nothing written and nothing asked', t => {
  const run = atBrief(t);
  writeScope(run, SINGLE_SCOPE);
  write(run, CLOSE_BRIEF);
  writeScope(run, MAP_FORM);
  const before = fs.readFileSync(run.state, 'utf8');
  for (const flags of [['--json', '--picker=rich'], ['--ask'], ['--oneline'], []]) {
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=brief-approval', ...flags]);
    assert.notEqual(result.code, 0, flags.join(' '));
    assert.match(result.stdout + result.stderr, new RegExp(`delivery-scope-invalid: ${MEMBERS_MAP.replace(/[{}]/g, '\\$&')}`), flags.join(' '));
    assert.match(result.stdout + result.stderr, /--node=brief-approval cannot be asked while outputs\/delivery-scope\.yml, which brief wrote/);
  }
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
});
