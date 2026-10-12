import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freeze, scratch, verb, write } from '../helpers.mjs';

// A research run with the HTML output on reached RUN-COMPLETE without the
// research report's HTML companion, and nothing in the engine said so. These
// tests replay that run: the report's markdown is on disk, its companion is not.

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const FOUNDATION = ['planning/research-brief.md', 'planning/research-plan.md', 'planning/sources.md', 'analysis/synthesis.md', 'outputs/research-report.md'];

function put(dir, relative) {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Report\n');
}

/** A research run whose foundation wrote every markdown artifact and no HTML companion. */
function foundationWritten(t, { html = true } = {}) {
  const run = scratch(t, { type: 'research', name: '2026-10-11-companion-incident' });
  freeze(run, { definition: RESEARCH, inputs: { question: 'Which store keeps notes safe?' }, orchestrator: { options: { html_output: html } } });
  for (const file of FOUNDATION) put(run.dir, file);
  fs.mkdirSync(path.join(run.dir, 'analysis/findings'), { recursive: true });
  return run;
}

const FOUNDATION_DONE = {
  nodes: { 'research-foundation': { status: 'completed', values: { confidence_level: 'high', conclusions: 'store-is-safe' } } },
  node_summaries: { 'research-foundation': { summary: 'The store is safe under load.' } },
};

test('write-state names the companion a completing node owes and did not write', t => {
  const run = foundationWritten(t);
  const result = verb(['write-state', `--state=${run.state}`], FOUNDATION_DONE);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\n\ncompanion-missing: research-foundation outputs\/research-report\.html\n/);
});

test('run-complete names the missing companion of a completed run', t => {
  const run = foundationWritten(t);
  write(run, FOUNDATION_DONE);
  write(run, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'finish-with-research' } } });
  write(run, { nodes: { completion: { status: 'completed' } }, task: { status: 'completed' } });
  const result = verb(['run-complete', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^missing-companion: research-foundation outputs\/research-report\.html$/m);
  assert.match(result.stdout, /RUN-COMPLETE\n$/);
});

test('with the HTML output off, neither check owes a companion', t => {
  const run = foundationWritten(t, { html: false });
  const result = verb(['write-state', `--state=${run.state}`], FOUNDATION_DONE);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /companion-missing/);
});
