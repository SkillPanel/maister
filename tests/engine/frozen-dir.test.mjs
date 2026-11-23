import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freezePatch, readState, scratch, verb, write } from '../helpers.mjs';

// A node carrying `dir:` hands its work to another repository. The freeze
// records that `dir` on the node's entry, as the definition spells it, so the
// run's own state names the repository before the node is dispatched; a node
// without one records no `dir` at all. No later write changes it.

const DEFINITION = [
  'name: dir-run',
  'version: 1',
  'description: "Plans a change, hands one part to a member repository, and reviews it."',
  'inputs:',
  '  member: {type: string, required: true}',
  'nodes:',
  '  plan:',
  '    uses: direct:plan',
  '    needs: []',
  '  remote:',
  '    uses: skill:quick-plan',
  '    dir: "members/${inputs.member}"',
  '    needs: [plan]',
  '  review:',
  '    type: gate',
  '    needs: [remote]',
  '    ask: "Review the member\'s plan. Go on?"',
  '    options:',
  '      go-on: continue',
  '      send-back: {effect: revise, reruns: plan}',
  '      halt: stop',
  '  publish:',
  '    uses: direct:publish',
  '    needs: [review]',
  '',
].join('\n');

const PROSE = '# Dir run — node prose\n\n## `plan`\n\nPlan the change.\n\n## `publish`\n\nPublish the change.\n';

const DIR = 'members/${inputs.member}';
const NOTE = /^note: ignored the supplied workflow\.nodes\.remote\.dir; the freeze records a node's dir from its definition, so no patch changes it$/m;

/**
 * A scratch run and the freeze patch of the dir-run definition, not yet sent.
 * A `dir:` node makes the graph a chain, which starts only under a driver that
 * dispatches it, so the patch carries one.
 */
function prepared(t) {
  const run = scratch(t);
  const definition = path.join(run.root, 'dir-run.yml');
  fs.writeFileSync(definition, DEFINITION);
  fs.writeFileSync(path.join(run.root, 'dir-run.md'), PROSE);
  const { patch } = freezePatch({ definition, inputs: { member: 'api' }, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  return { run, patch };
}

/** A frozen run of the dir-run definition. */
function frozen(t) {
  const { run, patch } = prepared(t);
  write(run, patch);
  return run;
}

/** The raw line the state file carries for `id`. */
function lineOf(run, id) {
  return fs.readFileSync(run.state, 'utf8').split('\n').find(line => line.startsWith(`    ${id}: {`));
}

test('freeze: a node carrying dir: records it as the definition spells it', t => {
  const run = frozen(t);
  const nodes = readState(run).workflow.nodes;
  assert.deepEqual(nodes.remote, { kind: 'skill', status: 'pending', needs: ['plan'], dir: DIR });
});

test('freeze: a node without dir: records no dir key, its entry as it always was', t => {
  const run = frozen(t);
  const nodes = readState(run).workflow.nodes;
  assert.deepEqual(nodes.plan, { kind: 'direct', status: 'pending', needs: [] });
  assert.deepEqual(nodes.publish, { kind: 'direct', status: 'pending', needs: ['review'] });
  for (const id of ['plan', 'review', 'publish']) assert.doesNotMatch(lineOf(run, id), /\bdir\b/, id);
});

test('freeze: a dir the patch sends is replaced by the definition\'s, and dropped where the definition has none', t => {
  const { run, patch } = prepared(t);
  patch.workflow.nodes.remote.dir = 'elsewhere';
  patch.workflow.nodes.plan.dir = 'stray';
  write(run, patch);
  const nodes = readState(run).workflow.nodes;
  assert.equal(nodes.remote.dir, DIR);
  assert.equal(Object.hasOwn(nodes.plan, 'dir'), false);
});

test('freeze: re-sending the same freeze, without dir, is the same patch and is dropped with its note', t => {
  const { run, patch } = prepared(t);
  write(run, patch);
  const before = readState(run).workflow.nodes;
  const again = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stderr, /ignored the supplied workflow block, which matches the frozen one/);
  assert.deepEqual(readState(run).workflow.nodes, before);

  const moved = structuredClone(patch);
  moved.workflow.nodes.remote.dir = 'elsewhere';
  const refused = verb(['write-state', `--state=${run.state}`], moved);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /^state-workflow-frozen: .*would rewrite the recorded entry of remote/);
});

test('later writes keep the frozen dir; a patch that sends another is dropped and noted, one that repeats it is not', t => {
  const run = frozen(t);
  write(run, { nodes: { plan: { status: 'completed' } } });
  write(run, { nodes: { remote: { status: 'running' } } });
  assert.equal(readState(run).workflow.nodes.remote.dir, DIR);

  const moved = write(run, { nodes: { remote: { status: 'waiting', dir: 'members/web' } } });
  assert.match(moved.stderr, NOTE);
  assert.equal(readState(run).workflow.nodes.remote.dir, DIR);

  const repeated = write(run, { nodes: { remote: { status: 'completed', dir: DIR } } });
  assert.doesNotMatch(repeated.stderr, NOTE);
  const remote = readState(run).workflow.nodes.remote;
  assert.equal(remote.status, 'completed');
  assert.equal(remote.dir, DIR);
  assert.equal(Object.hasOwn(readState(run).workflow.nodes.plan, 'dir'), false, 'a node without dir gains none');
});

test('a revise resets the node and keeps its frozen dir', t => {
  const run = frozen(t);
  write(run, { nodes: { plan: { status: 'completed' } } });
  write(run, { nodes: { remote: { status: 'completed' } } });
  const revised = verb(['gate-revise', `--state=${run.state}`, '--node=review', '--option=send-back'], { note: 'Narrow the plan' });
  assert.equal(revised.code, 0, revised.stdout + revised.stderr);

  const { plan, remote } = readState(run).workflow.nodes;
  assert.equal(remote.status, 'pending');
  assert.equal(Number(remote.attempt), 2);
  assert.equal(remote.dir, DIR);
  assert.equal(Object.hasOwn(plan, 'dir'), false);
});
