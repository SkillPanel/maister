// The bounded skip walk `gate-brief.mjs` shares with every caller that walks
// a run past its off-path steps, the sub-run hand-off among them: at each turn
// it asks `dueNext` for the step due, and records one that is off the path
// with one status-only skip write through the writer it was handed, then
// reads the state again. It stops at the first
// step that must run, at the closing patch, when nothing is due, at its bound
// or at a refused write — and it never throws. Called in-process, on both
// trees, with the state writer (or a stand-in) as its writer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, freeze, readState, scratch, variantRoot, write } from '../helpers.mjs';

const DEFINITION = `name: skip-walk
version: 1
nodes:
  work:
    uses: direct:work
    needs: []
    outputs:
      values:
        deep: bool
  recover:
    uses: direct:recover
    needs: [work]
    on: failure
  audit:
    uses: direct:audit
    needs: [recover]
    when: "\${work.values.deep}"
  review:
    uses: direct:review
    needs: [audit]
  tidy:
    uses: direct:tidy
    needs: [review]
    when: "\${work.values.deep}"
display:
  titles:
    work: Work
    recover: Recover
    audit: Audit
    review: Review
    tidy: Tidy
`;

const PROSE = ['work', 'recover', 'audit', 'review', 'tidy'].map(id => `## \`${id}\`\n\nDo ${id}.\n`).join('\n');
const GUARD = '${work.values.deep}';

const TREES = [['source', () => path.join(ROOT, 'plugins', 'maister')], ['variant', () => variantRoot()]];

/** The engine modules of one tree, imported in this process. */
async function engineOf(tree) {
  const lib = path.join(tree, 'skills', 'workflow-engine', 'scripts', 'lib');
  const load = name => import(pathToFileURL(path.join(lib, name)).href);
  const [gate, state, read] = await Promise.all([load('gate-brief.mjs'), load('state.mjs'), load('state-read.mjs')]);
  return { gate, state, read };
}

/** A run of `skip-walk`, frozen, with `work` ended as `status` and `deep` recorded. */
function frozenRun(t, { status = 'completed', deep = false } = {}) {
  const run = scratch(t, { type: 'skip-walk', name: '2026-01-05-walk' });
  const home = path.join(run.root, '.maister', 'workflows');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'skip-walk.yml'), DEFINITION);
  fs.writeFileSync(path.join(home, 'skip-walk.md'), `# Skip walk — node prose\n\n${PROSE}`);
  freeze(run, { definition: path.join(home, 'skip-walk.yml'), task: { title: 'Skip walk' } });
  if (status === 'failed') {
    write(run, { nodes: { work: { status: 'running' } } });
    write(run, { nodes: { work: { status: 'failed' } } });
  } else {
    write(run, { nodes: { work: { status: 'completed', values: { deep } } }, node_summaries: { work: { summary: 'Worked.' } } });
  }
  return run;
}

/** The walk's arguments over `run`: the state writer, each patch kept in `writes`, and a re-read from disk. */
function walkOver(engine, run, { bound = 10, writer = null } = {}) {
  const writes = [];
  const doc = engine.read.parse(fs.readFileSync(run.state, 'utf8'));
  const write = writer ?? ((patch, id) => {
    writes.push({ id, patch: JSON.parse(JSON.stringify(patch)) });
    return engine.state.writeState({ state: run.state, patch });
  });
  const reread = () => engine.read.parse(fs.readFileSync(run.state, 'utf8'));
  return { args: { doc, runDir: run.dir, writer: write, reread, bound }, writes };
}

const statusOf = (run, id) => readState(run).workflow.nodes[id].status ?? 'pending';

for (const [name, treeOf] of TREES) {
  test(`${name}: off-path nodes are skipped in order, one status-only write each, and the walk stops due at the first step that must run`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    const { args, writes } = walkOver(engine, run);
    const result = engine.gate.skipWalk(args);
    assert.deepEqual(result.skipped, [
      { id: 'recover', title: 'Recover', reason: 'failure', guard: null },
      { id: 'audit', title: 'Audit', reason: 'guard', guard: GUARD },
    ]);
    assert.deepEqual(result.stop, { kind: 'due', id: 'review', title: 'Review' });
    assert.deepEqual(writes, [
      { id: 'recover', patch: { nodes: { recover: { status: 'skipped' } } } },
      { id: 'audit', patch: { nodes: { audit: { status: 'skipped' } } } },
    ]);
    assert.equal(statusOf(run, 'recover'), 'skipped');
    assert.equal(statusOf(run, 'audit'), 'skipped');
    assert.equal(statusOf(run, 'review'), 'pending', 'the step due is never written');
    assert.equal(result.doc.workflow.nodes.audit.status, 'skipped', 'the doc returned is the state read after the last write');
  });

  test(`${name}: only the closing patch left stops closing, after the last skip`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    engine.gate.skipWalk(walkOver(engine, run).args);
    write(run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } });
    const result = engine.gate.skipWalk(walkOver(engine, run).args);
    assert.deepEqual(result.skipped, [{ id: 'tidy', title: 'Tidy', reason: 'guard', guard: GUARD }]);
    assert.deepEqual(result.stop, { kind: 'closing' });
    assert.equal(statusOf(run, 'tidy'), 'skipped');
  });

  test(`${name}: a step started and not ended leaves nothing due: settled, nothing written`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    engine.gate.skipWalk(walkOver(engine, run).args);
    write(run, { nodes: { review: { status: 'running' } } });
    const before = fs.readFileSync(run.state, 'utf8');
    const { args, writes } = walkOver(engine, run);
    const result = engine.gate.skipWalk(args);
    assert.deepEqual(result, { skipped: [], stop: { kind: 'settled' }, doc: args.doc });
    assert.deepEqual(writes, []);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  });

  test(`${name}: the bound reached stops bound with the skips made so far, and never throws`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    const one = engine.gate.skipWalk(walkOver(engine, run, { bound: 1 }).args);
    assert.deepEqual(one.skipped.map(each => each.id), ['recover']);
    assert.deepEqual(one.stop, { kind: 'bound', bound: 1 });
    assert.equal(statusOf(run, 'audit'), 'pending');

    const before = fs.readFileSync(run.state, 'utf8');
    const { args, writes } = walkOver(engine, run, { bound: 0 });
    assert.deepEqual(engine.gate.skipWalk(args), { skipped: [], stop: { kind: 'bound', bound: 0 }, doc: args.doc });
    assert.deepEqual(writes, []);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  });

  test(`${name}: a refused skip write stops refused with the node and the writer's code; a writer or re-read that throws never escapes`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    const before = fs.readFileSync(run.state, 'utf8');
    const refusal = { ok: false, errors: [{ code: 'state-held-elsewhere', message: 'state-held-elsewhere: held' }] };
    const refused = engine.gate.skipWalk(walkOver(engine, run, { writer: () => refusal }).args);
    assert.deepEqual(refused.skipped, []);
    assert.deepEqual(refused.stop, { kind: 'refused', id: 'recover', title: 'Recover', code: 'state-held-elsewhere', result: refusal });
    assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'nothing was written');

    const coded = engine.gate.skipWalk(walkOver(engine, run, { writer: () => ({ ok: false, code: 'state-unwritable' }) }).args);
    assert.equal(coded.stop.code, 'state-unwritable', 'a writer may name its code at the top level');

    const fault = new Error('disk gone');
    const thrown = engine.gate.skipWalk(walkOver(engine, run, { writer: () => { throw fault; } }).args);
    assert.equal(thrown.stop.kind, 'refused');
    assert.equal(thrown.stop.id, 'recover');
    assert.equal(thrown.stop.code, null);
    assert.equal(thrown.stop.error, fault);

    const { args } = walkOver(engine, run);
    const unread = engine.gate.skipWalk({ ...args, reread: () => { throw fault; } });
    assert.deepEqual(unread.skipped.map(each => each.id), ['recover'], 'the skip landed before the read failed');
    assert.equal(unread.stop.kind, 'refused');
    assert.equal(unread.stop.id, null);
    assert.equal(unread.stop.error, fault);
  });

  test(`${name}: offPath keeps its boolean, and offPathReason names the false guard or the failure rule`, async t => {
    const engine = await engineOf(treeOf());
    const run = frozenRun(t);
    const read = () => ({ doc: engine.read.parse(fs.readFileSync(run.state, 'utf8')), runDir: run.dir });
    assert.equal(engine.gate.offPathReason({ ...read(), id: 'recover' }), 'failure');
    assert.equal(engine.gate.offPath({ ...read(), id: 'recover' }), true);
    write(run, { nodes: { recover: { status: 'skipped' } } });
    assert.equal(engine.gate.offPathReason({ ...read(), id: 'audit' }), GUARD);
    assert.equal(engine.gate.offPath({ ...read(), id: 'audit' }), true);

    const deep = frozenRun(t, { deep: true });
    write(deep, { nodes: { recover: { status: 'skipped' } } });
    const deepRead = { doc: engine.read.parse(fs.readFileSync(deep.state, 'utf8')), runDir: deep.dir };
    assert.equal(engine.gate.offPathReason({ ...deepRead, id: 'audit' }), null, 'a guard reading true keeps the step on the path');
    assert.equal(engine.gate.offPath({ ...deepRead, id: 'audit' }), false);

    const failed = frozenRun(t, { status: 'failed' });
    const failedRead = { doc: engine.read.parse(fs.readFileSync(failed.state, 'utf8')), runDir: failed.dir };
    assert.equal(engine.gate.offPathReason({ ...failedRead, id: 'recover' }), null, 'a failure takes the recovery step onto the path');
    assert.equal(engine.gate.offPath({ ...failedRead, id: 'recover' }), false);
  });
}
