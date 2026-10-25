import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freezePatch, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// The delegation record: whether the run's subagents can dispatch subagents of
// their own, written by the freeze under `orchestrator.options.delegation` from
// the host its `--host` names — Claude Code's depth from the environment or 3,
// Copilot's 4, where the runners never nest — under a cockpit or dispatch
// driver too, its source naming the SDK check. No patch sets it; after the
// freeze a nested run may narrow it.
// The status line and the verifier's dashboard card show its mode.

const OVERLAY = path.join(FIXTURES, 'definitions/sample.overlay.yml');
const DEPTH_ENV = 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH';
const COPILOT_REASON = 'Copilot runs every subagent level under a session of its own, so the runners do not nest on this host';
const NOTE = 'note: ignored the supplied orchestrator.options.delegation; the freeze records it from the host it names, so no patch sets it — after the freeze a nested run may only narrow it, as {mode: inline, reason}\n';

/** Freeze the sample (with the verifier overlay) naming `host`, under `env`. */
function freezeWith(run, { host = null, env = {}, orchestrator = {} } = {}) {
  const { patch } = freezePatch({ overlays: [OVERLAY], orchestrator });
  const args = ['write-state', `--state=${run.state}`, ...(host === null ? [] : [`--host=${host}`])];
  return verb(args, patch, env);
}

const delegationOf = run => readState(run).orchestrator.options?.delegation;
const statusOf = run => JSON.parse(fs.readFileSync(path.join(run.dir, 'display', 'status.json'), 'utf8'));

/** Each host and environment, and the record the freeze writes for it. */
const CASES = [
  ['Claude Code with no depth set', 'claude', {}, { mode: 'nested', depth: 3, source: 'claude default' }],
  ['Claude Code at depth 1', 'claude', { [DEPTH_ENV]: '1' }, { mode: 'inline', depth: 1, source: DEPTH_ENV }],
  ['Claude Code at depth 0', 'claude', { [DEPTH_ENV]: '0' }, { mode: 'inline', depth: 0, source: DEPTH_ENV }],
  ['Claude Code at depth 2', 'claude', { [DEPTH_ENV]: '2' }, { mode: 'nested', depth: 2, source: DEPTH_ENV }],
  ['Claude Code at depth 5', 'claude', { [DEPTH_ENV]: '5' }, { mode: 'nested', depth: 5, source: DEPTH_ENV }],
  ['Claude Code with a depth that is no whole number', 'claude', { [DEPTH_ENV]: 'deep' }, { mode: 'nested', depth: 3, source: 'claude default' }],
  ['Copilot, where the runners never nest', 'copilot', {}, { mode: 'inline', depth: 4, source: 'copilot default', reason: COPILOT_REASON }],
  ['Copilot, which does not read Claude Code\'s variable', 'copilot', { [DEPTH_ENV]: '5' }, { mode: 'inline', depth: 4, source: 'copilot default', reason: COPILOT_REASON }],
];

for (const [label, host, env, expected] of CASES) {
  test(`the freeze records the delegation: ${label}`, t => {
    const run = scratch(t);
    const result = freezeWith(run, { host, env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(delegationOf(run), expected);
  });
}

/** Each driver, and the source it names: nesting was checked under the SDK a driven session runs on. */
const DRIVERS = [
  ['a cockpit', { kind: 'cockpit', cwd: '/work', session: 's-1' }, 'cockpit driver: SDK nesting checked at 0.3.285'],
  ['a cockpit running a dispatch', { kind: 'cockpit', cwd: '/work', session: 's-1', dispatch_id: 'd-1' }, 'cockpit driver: SDK nesting checked at 0.3.285'],
  ['a legacy dispatch driver', { kind: 'dispatch', cwd: '/work', session: 's-1' }, 'dispatch driver: SDK nesting checked at 0.3.285'],
];

for (const [label, driver, source] of DRIVERS) {
  test(`a driven run records nested at Claude Code's depth, and inline on Copilot: ${label}`, t => {
    const run = scratch(t);
    const result = freezeWith(run, { host: 'claude', orchestrator: { driver } });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(delegationOf(run), { mode: 'nested', depth: 3, source: `${source} (claude default)` });

    // Without --host too: a driven freeze reads as Claude Code.
    const bare = scratch(t);
    assert.equal(freezeWith(bare, { orchestrator: { driver } }).code, 0);
    assert.deepEqual(delegationOf(bare), { mode: 'nested', depth: 3, source: `${source} (claude default)` });

    // On Copilot the depth is the host's, and the runners still never nest.
    const copilot = scratch(t);
    assert.equal(freezeWith(copilot, { host: 'copilot', orchestrator: { driver } }).code, 0);
    assert.deepEqual(delegationOf(copilot), { mode: 'inline', depth: 4, source: `${source} (copilot default)`, reason: COPILOT_REASON });

    // A depth of 1 in the session's environment still keeps the loop inline.
    const shallow = scratch(t);
    assert.equal(freezeWith(shallow, { host: 'claude', env: { [DEPTH_ENV]: '1' }, orchestrator: { driver } }).code, 0);
    assert.deepEqual(delegationOf(shallow), { mode: 'inline', depth: 1, source: `${source} (${DEPTH_ENV})` });
  });
}

test('a terminal freeze naming no host records nothing, as it always did', t => {
  const run = scratch(t);
  const result = freezeWith(run, { orchestrator: { driver: { kind: 'terminal' } } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /delegation/);
});

test('--host names claude or copilot, or the write is refused before anything is read', t => {
  const run = scratch(t);
  const result = freezeWith(run, { host: 'codex' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--host is claude or copilot, not "codex"/);
  assert.equal(fs.existsSync(run.state), false);
});

test('a patch never sets options.delegation, at the freeze or after it', t => {
  const run = scratch(t);
  const sent = { options: { delegation: { mode: 'nested', depth: 9, source: 'patch' }, html_output: true } };
  const frozen = freezeWith(run, { host: 'claude', env: { [DEPTH_ENV]: '1' }, orchestrator: sent });
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(frozen.stderr, NOTE);
  assert.deepEqual(delegationOf(run), { mode: 'inline', depth: 1, source: DEPTH_ENV });
  assert.equal(readState(run).orchestrator.options.html_output, true);

  const later = verb(['write-state', `--state=${run.state}`, '--host=copilot'], { orchestrator: sent });
  assert.equal(later.code, 0, later.stderr);
  assert.equal(later.stderr, NOTE);
  assert.deepEqual(delegationOf(run), { mode: 'inline', depth: 1, source: DEPTH_ENV }, 'a later --host changes nothing either');
});

test('orchestrator.options stays one flow-map line, the delegation map nested in it', t => {
  const run = scratch(t);
  assert.equal(freezeWith(run, { host: 'claude', orchestrator: { options: { html_output: true } } }).code, 0);
  write(run, { orchestrator: { options: { mockup_format: 'html' } } });
  const lines = fs.readFileSync(run.state, 'utf8').split('\n').filter(line => /^ {2}options:/.test(line));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}options: \{.*delegation: \{mode: nested, depth: 3, source: "claude default"\}.*\}$/);
  assert.match(lines[0], /html_output: true/);
  assert.match(lines[0], /mockup_format: html/);
});

test('the status line names the mode while the executor or the verifier runs, and not before or after', t => {
  const run = scratch(t);
  assert.equal(freezeWith(run, { host: 'claude' }).code, 0);
  write(run, { nodes: { analysis: { status: 'running' } } });
  assert.doesNotMatch(statusOf(run).line, /nested/);

  write(run, { nodes: { analysis: { status: 'completed' }, implementation: { status: 'running' } } });
  assert.match(statusOf(run).line, / · Implementation · nested · /);

  write(run, { nodes: { implementation: { status: 'completed' }, review: { status: 'running' } } });
  const status = statusOf(run);
  assert.equal(status.line, `${status.workflow} · phase ${status.phase.index}/${status.phase.total} · Peer review · nested · Sample run`);

  write(run, { nodes: { review: { status: 'completed' } }, task: { status: 'completed' } });
  assert.equal(statusOf(run).line, 'Development · completed · Sample run');

  // A run that recorded no delegation shows no word.
  const plain = scratch(t);
  assert.equal(freezeWith(plain).code, 0);
  write(plain, { nodes: { review: { status: 'running' } } });
  assert.doesNotMatch(statusOf(plain).line, /nested|inline/);
});

test('the executor\'s and the verifier\'s dashboard cards carry the mode, and no other card does', t => {
  const run = scratch(t);
  assert.equal(freezeWith(run, { host: 'claude', env: { [DEPTH_ENV]: '1' } }).code, 0);
  const phases = readDashboard(run).phases;
  assert.deepEqual(phases.filter(phase => Object.hasOwn(phase, 'delegation')).map(phase => [phase.id, phase.delegation]), [['implementation', 'inline'], ['review', 'inline']]);

  const plain = scratch(t);
  assert.equal(freezeWith(plain).code, 0);
  assert.equal(readDashboard(plain).phases.some(phase => Object.hasOwn(phase, 'delegation')), false);
});
