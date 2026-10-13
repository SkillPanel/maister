import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';

// The context pack: an optional `context` path input on development and
// research, copied in by the first node as a declared artifact it may leave
// unwritten, and recorded in the run's context block as `work_reference`.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const DEV_RUN = '.maister/tasks/development/2026-01-05-sample';
const RESEARCH_RUN = '.maister/tasks/research/2026-01-05-pack';
const ABSENT = 'may be absent: No context pack was named, or it could not be read.';

function header(state, node) {
  const result = verb(['node-brief', `--state=${state}`, `--node=${node}`]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.slice(0, result.stdout.indexOf('\n\n')).split('\n');
}

test('work reference: development and research declare `context` as an optional path input', () => {
  for (const file of [DEVELOPMENT, RESEARCH]) {
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
