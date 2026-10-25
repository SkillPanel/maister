import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, delegating, write as writeState } from '../helpers.mjs';
import { SUBJECT_KINDS, subjectOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-subject.mjs';

// A built-in step that declares delegates completes only with them listed;
// every write here sends them as a session that dispatched them would.
const write = (run, patch) => writeState(run, delegating(patch));

// A gate's checkpoint names the one output it asks the operator to approve,
// `subject: {path, kind}`, read off the declared output keys of the nodes the
// gate closes — never off a file name. Absent when nothing is found.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');

function onDisk(run, relative) {
  const file = path.join(run.dir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# written\n');
}

/** Every node before `gate` completed, `closing` with a summary, the stretch's skipped nodes as given. */
function walkTo(run, definition, gate, closing, nodes = {}) {
  const graph = freeze(run, { definition, inputs: { task_description: 'Tag the notes' } });
  const completed = {};
  for (const node of graph.nodes) {
    if (node.id === gate) break;
    completed[node.id] = { status: 'completed' };
  }
  write(run, { nodes: { ...completed, ...nodes }, node_summaries: { [closing]: { summary: 'Done.' } } });
  return graph;
}

function gateBrief(run, node, form) {
  const result = verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, form]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const SKIP_MOCKUPS = { 'ui-mockups': { status: 'skipped' }, 'mockup-approval': { status: 'skipped' } };

test('subject: the specification gate names the specification, and the request carries it in its checkpoint only', t => {
  const run = scratch(t);
  walkTo(run, DEVELOPMENT, 'specification-approval', 'specification', SKIP_MOCKUPS);
  onDisk(run, 'implementation/spec.md');
  const checkpoint = gateBrief(run, 'specification-approval', '--checkpoint');
  assert.deepEqual(checkpoint.subject, { path: 'implementation/spec.md', kind: 'specification' });
  assert.ok(checkpoint.review.some(each => each.path === checkpoint.subject.path), 'the subject is one of the files up for review');
  const request = gateBrief(run, 'specification-approval', '--request');
  assert.deepEqual(request.context.checkpoint.subject, checkpoint.subject);
  assert.equal(Object.hasOwn(request, 'subject'), false, 'the request\'s own keys are unchanged');
});

test('subject: a gate whose stretch declares no subject key carries no subject', t => {
  const run = scratch(t);
  walkTo(run, DEVELOPMENT, 'gap-approval', 'gap-analysis', {
    'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } },
  });
  onDisk(run, 'analysis/gap-analysis.md');
  assert.equal(Object.hasOwn(gateBrief(run, 'gap-approval', '--checkpoint'), 'subject'), false);
});

test('subject: a declared subject that is not on disk is no subject', t => {
  const run = scratch(t);
  walkTo(run, DEVELOPMENT, 'specification-approval', 'specification', SKIP_MOCKUPS);
  assert.equal(Object.hasOwn(gateBrief(run, 'specification-approval', '--checkpoint'), 'subject'), false);
});

test('subject: the delivery scope comes before the brief it is approved with', t => {
  const run = scratch(t);
  const graph = freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Share calendars' } });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  onDisk(run, 'outputs/product-brief.md');
  assert.deepEqual(subjectOf({ ids: ['review-handoff'], byId, runDir: run.dir }), { path: 'outputs/product-brief.md', kind: 'brief' },
    'without the scope on disk, the brief');
  onDisk(run, 'outputs/delivery-scope.yml');
  assert.deepEqual(subjectOf({ ids: ['review-handoff'], byId, runDir: run.dir }), { path: 'outputs/delivery-scope.yml', kind: 'delivery-scope' });
});

test('subject: a specification comes before the prototypes beside it; a folder of screens reads as a folder', t => {
  const run = scratch(t);
  const graph = freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Share calendars' } });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const ids = ['feature-specification', 'visual-prototyping'];
  fs.mkdirSync(path.join(run.dir, 'analysis/mockups'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'analysis/mockups/.mockups.json'), '{}');
  assert.equal(subjectOf({ ids, byId, runDir: run.dir }), null, 'a folder holding only a hidden file names nothing');
  onDisk(run, 'analysis/mockups/share-dialog.html');
  assert.deepEqual(subjectOf({ ids, byId, runDir: run.dir }), { path: 'analysis/mockups/', kind: 'mockups' });
  onDisk(run, 'analysis/feature-spec.md');
  assert.deepEqual(subjectOf({ ids, byId, runDir: run.dir }), { path: 'analysis/feature-spec.md', kind: 'specification' });
});

test('subject: an interpolated or escaping declared path is passed over', t => {
  const run = scratch(t);
  onDisk(run, 'spec.md');
  const byId = new Map([
    ['a', { id: 'a', outputs: { artifacts: { spec: '${inputs.spec}', plan: '../../outside.md' } } }],
    ['b', { id: 'b', outputs: { artifacts: { plan: 'spec.md' } } }],
  ]);
  fs.writeFileSync(path.join(run.dir, '../../outside.md'), 'x\n');
  t.after(() => fs.rmSync(path.join(run.dir, '../../outside.md'), { force: true }));
  assert.deepEqual(subjectOf({ ids: ['a', 'b'], byId, runDir: run.dir }), { path: 'spec.md', kind: 'plan' });
});

test('subject: the kinds are a closed list, in precedence order', () => {
  assert.deepEqual(SUBJECT_KINDS.map(each => each.kind), ['delivery-scope', 'brief', 'specification', 'plan', 'mockups']);
});
