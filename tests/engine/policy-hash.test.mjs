import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, freezePatch, readState, run as runScript, scratch, scratchPlugin, sibling, verb, write } from '../helpers.mjs';
import { policyHash } from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';

// `orchestrator.policy_hash`: the freeze records the hash of the autonomy
// policy it applied, the writer owns the key, and no later write touches it.

const DEFAULT_HASH = 'sha256:2430f1a2ad2982d0067885488a4c89e21ad1d7c83b115ba8f1b20acc88dfaea8';
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const NOTE = 'note: ignored the supplied orchestrator.policy_hash; the freeze records it from the policy it applied, so no patch sets it\n';

test('freezing with no policy file records the built-in default\'s hash', t => {
  const run = scratch(t);
  const result = write(run, freezePatch().patch);
  assert.equal(readState(run).orchestrator.policy_hash, DEFAULT_HASH);
  assert.ok(result.stdout.split('\n').includes('orchestrator.policy_hash'), 'the freeze lists the key among its changed paths');
  assert.doesNotMatch(result.stderr, /policy/);
});

test('a patch-supplied policy_hash is dropped into ignored, with its own note', t => {
  const run = scratch(t);
  const { patch } = freezePatch({ orchestrator: { policy_hash: 'sha256:supplied' } });
  const frozen = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(frozen.stderr, NOTE);
  assert.equal(readState(run).orchestrator.policy_hash, DEFAULT_HASH);

  const later = verb(['write-state', `--state=${run.state}`], { orchestrator: { policy_hash: 'sha256:later' } });
  assert.equal(later.code, 0, later.stderr);
  assert.equal(later.stderr, NOTE);
  assert.doesNotMatch(later.stdout, /policy_hash/);
  assert.equal(readState(run).orchestrator.policy_hash, DEFAULT_HASH);
});

test('no later write adds, changes or removes it', t => {
  const run = scratch(t);
  const { patch } = freezePatch();
  write(run, patch);
  const frozen = fs.readFileSync(run.state, 'utf8');
  const line = frozen.split('\n').find(each => each.startsWith('  policy_hash: '));
  assert.ok(line, 'the freeze wrote the line');

  // A re-sent identical workflow block, a scalar and a node write all keep the one line as it was.
  write(run, { workflow: patch.workflow, orchestrator: { started_phase: 'analysis' }, nodes: { analysis: { status: 'running' } } });
  const lines = fs.readFileSync(run.state, 'utf8').split('\n').filter(each => each.startsWith('  policy_hash: '));
  assert.deepEqual(lines, [line]);

  // A run frozen before the key existed stays without one, even when a write re-sends its block.
  fs.writeFileSync(run.state, frozen.replace(`${line}\n`, ''));
  write(run, { workflow: patch.workflow, nodes: { analysis: { status: 'running' } } });
  assert.equal(Object.hasOwn(readState(run).orchestrator, 'policy_hash'), false);
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /policy_hash/);
});

test('a sub-run\'s freeze seeds its own policy_hash', t => {
  const parent = scratch(t);
  freeze(parent);
  const child = sibling(parent, { type: 'research', name: '2026-01-05-open-questions' });
  freeze(child, {
    definition: RESEARCH,
    task: { title: 'Open questions' },
    inputs: { question: 'What is left open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  assert.equal(readState(child).orchestrator.policy_hash, DEFAULT_HASH);
  assert.equal(readState(parent).orchestrator.policy_hash, DEFAULT_HASH);
});

test('a refused policy file warns on the freeze, exits 0 and records the default\'s hash', t => {
  const engine = scratchPlugin(t, { policy: { version: 2 } });
  const file = path.join(path.dirname(path.dirname(engine)), 'policy/autonomy-policy.json');
  const run = scratch(t);
  const result = runScript(engine, ['write-state', `--state=${run.state}`], freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, `warning: policy-refused:${file}:version\n`);
  assert.equal(readState(run).orchestrator.policy_hash, DEFAULT_HASH);

  // A later write reads no policy and repeats no warning.
  const later = runScript(engine, ['write-state', `--state=${run.state}`], { nodes: { analysis: { status: 'running' } } });
  assert.equal(later.code, 0, later.stderr);
  assert.equal(later.stderr, '');
});

test('a policy file that loads is the one whose hash the freeze records', t => {
  const policy = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy/valid.json'), 'utf8'));
  const engine = scratchPlugin(t, { policy });
  const run = scratch(t);
  const result = runScript(engine, ['write-state', `--state=${run.state}`], freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(readState(run).orchestrator.policy_hash, policyHash(policy));
  assert.notEqual(policyHash(policy), DEFAULT_HASH);
});
