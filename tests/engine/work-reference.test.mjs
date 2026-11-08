import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { resolve } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';

// The context pack: an optional `context` path input on development, research
// and product design, copied in by the first node as a declared artifact it may leave
// unwritten, and recorded in the run's context block as `work_reference`.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');
const DEV_RUN = '.maister/tasks/development/2026-01-05-sample';
const RESEARCH_RUN = '.maister/tasks/research/2026-01-05-pack';
const DESIGN_RUN = '.maister/tasks/product-design/2026-01-05-pack';
const ABSENT = 'may be absent: No context pack was named, or it could not be read.';

function header(state, node) {
  const result = verb(['node-brief', `--state=${state}`, `--node=${node}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.slice(0, result.stdout.indexOf('\n\n')).split('\n');
}

test('work reference: development, research and product design declare `context` as an optional path input', () => {
  for (const file of [DEVELOPMENT, RESEARCH, PRODUCT_DESIGN]) {
    const { doc } = readDefinition(file);
    assert.deepEqual({ ...doc.inputs.context }, { type: 'path', required: false }, path.basename(file));
  }
});

test('work reference: development\'s intake takes the input and declares the copied pack, which codebase analysis receives', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page', context: 'docs/pack' } });

  const intake = header(dev.state, 'intake');
  assert.ok(intake.includes('- context: docs/pack'), intake.join('\n'));
  assert.ok(intake.includes(`- work_context: ${DEV_RUN}/analysis/work-context — ${ABSENT}`), intake.join('\n'));

  const analysis = header(dev.state, 'codebase-analysis');
  assert.ok(analysis.includes(`- work_context: ${DEV_RUN}/analysis/work-context`), analysis.join('\n'));
});

test('work reference: an absent input reaches the intake as null, and the pack stays a sanctioned absence', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page' } });
  const intake = header(dev.state, 'intake');
  assert.ok(intake.includes('- context: null'), intake.join('\n'));
  assert.ok(intake.includes(`- work_context: ${DEV_RUN}/analysis/work-context — ${ABSENT}`), intake.join('\n'));
});

test('work reference: research\'s foundation takes the input and declares the copied pack', t => {
  const run = scratch(t, { type: 'research', name: '2026-01-05-pack' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'Which cache fits?', context: 'docs/pack.md' } });
  const foundation = header(run.state, 'research-foundation');
  assert.ok(foundation.includes('- context: docs/pack.md'), foundation.join('\n'));
  assert.ok(foundation.includes(`- work_context: ${RESEARCH_RUN}/analysis/work-context — ${ABSENT}`), foundation.join('\n'));
});

test('work reference: the writer records it in development\'s task_context beside research_reference', t => {
  const dev = scratch(t);
  freeze(dev, { definition: DEVELOPMENT, inputs: { task_description: 'Add a page', context: 'docs/pack' } });
  write(dev, {
    context: {
      research_reference: { path: 'analysis/research-context', research_question: 'Why?', research_type: 'technical', confidence_level: 'high' },
      work_reference: { path: 'docs/pack' },
    },
  });
  const state = readState(dev);
  assert.deepEqual(state.task_context.work_reference, { path: 'docs/pack' });
  assert.equal(state.task_context.research_reference.path, 'analysis/research-context');
});

test('work reference: a research run records it in its own block, research_context', t => {
  const run = scratch(t, { type: 'research', name: '2026-01-05-pack' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'Which cache fits?', context: 'docs/pack.md' } });
  write(run, { context: { work_reference: { path: 'docs/pack.md' } } });
  const state = readState(run);
  assert.deepEqual(state.research_context.work_reference, { path: 'docs/pack.md' });
  assert.equal(state.task_context, undefined, 'the root carries exactly one context block');
});

// Product design: the steps that frame the problem and decide the design read
// the pack, and so does what they delegate to. The gates close documents, the
// brief assembles what the run settled and the completion only hands over.
const READERS = ['problem', 'alternatives', 'sketches', 'convergence', 'specification', 'screens'];
const NOT_READERS = ['problem-approval', 'direction-approval', 'brief', 'brief-approval', 'completion'];

function designRun(t, inputs = {}) {
  const run = scratch(t, { type: 'product-design', name: '2026-01-05-pack' });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Design a page', ...inputs } });
  return run;
}

/** One node's section of the guide, from its heading to the next rule. */
function guideSection(node) {
  const guide = fs.readFileSync(path.join(ENGINE_DIR, 'workflows/product-design.md'), 'utf8');
  const start = guide.indexOf(`\n## \`${node}\`\n`);
  assert.notEqual(start, -1, node);
  const end = guide.indexOf('\n---\n', start);
  return guide.slice(start, end === -1 ? undefined : end);
}

test('work reference: product design\'s intake takes the input and declares the copied pack', t => {
  const run = designRun(t, { context: 'docs/pack' });
  const intake = header(run.state, 'intake');
  assert.ok(intake.includes('- context: docs/pack'), intake.join('\n'));
  assert.ok(intake.includes(`- work_context: ${DESIGN_RUN}/analysis/work-context — ${ABSENT}`), intake.join('\n'));
});

test('work reference: every product design step that frames or decides receives the copied pack', t => {
  const run = designRun(t, { context: 'docs/pack' });
  for (const node of READERS) {
    const lines = header(run.state, node);
    assert.ok(lines.includes(`- work_context: ${DESIGN_RUN}/analysis/work-context`), `${node}\n${lines.join('\n')}`);
  }
});

test('work reference: product design\'s gates, brief and completion are not handed the pack', () => {
  const { doc } = readDefinition(PRODUCT_DESIGN);
  for (const node of NOT_READERS) {
    assert.equal(Object.hasOwn(doc.nodes[node].with ?? {}, 'work_context'), false, node);
  }
});

test('work reference: without the input product design\'s intake reads null and the pack stays a sanctioned absence', t => {
  const run = designRun(t);
  const intake = header(run.state, 'intake');
  assert.ok(intake.includes('- context: null'), intake.join('\n'));
  assert.ok(intake.includes(`- work_context: ${DESIGN_RUN}/analysis/work-context — ${ABSENT}`), intake.join('\n'));
});

test('work reference: the context pack is the only thing that moved product design\'s graph', () => {
  const definition = readDefinition(PRODUCT_DESIGN);
  const { doc } = definition;
  delete doc.inputs.context;
  delete doc.nodes.intake.with.context;
  delete doc.nodes.intake.outputs.artifacts.work_context;
  delete doc.brief.intake.absent.work_context;
  for (const node of READERS) delete doc.nodes[node].with.work_context;
  const result = resolve({ definition });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.graph_hash, 'sha256:dcd41a6601fe2810194304cf2182a34cab7cacaa27b4c2c86b2b06afda75ee5b');
});

test('work reference: a product design run records it in its own block, design_context', t => {
  const run = designRun(t, { context: 'docs/pack' });
  write(run, { context: { work_reference: { path: 'docs/pack' } } });
  const state = readState(run);
  assert.deepEqual(state.design_context.work_reference, { path: 'docs/pack' });
  assert.equal(state.task_context, undefined, 'the root carries exactly one context block');
});

test('work reference: product design\'s guide makes every reader conditional on the folder, and the ingest conditional on the input', () => {
  assert.match(guideSection('intake'), /when the context input names one/);
  for (const node of READERS) {
    assert.match(guideSection(node), /`work_context`[^.]*(?:when|exists)|[Ww]hen the `work_context`/, node);
  }
});

test('work reference: product design\'s guide says how a non-text file is read and that the pack is never changed', () => {
  const intake = guideSection('intake');
  assert.match(intake, /images and PDFs opened with the session's own file tool/);
  assert.match(intake, /cannot open is an `open` risk naming it/);
  assert.match(intake, /no step changes anything under that folder/);
  for (const node of ['problem', 'convergence', 'specification']) {
    assert.match(guideSection(node), /nothing in it is changed/, node);
  }
});
