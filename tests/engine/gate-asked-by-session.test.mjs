import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';
import { pendingMarker } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state.mjs';
import { hostSession } from '../../plugins/maister/skills/workflow-engine/scripts/lib/display-files.mjs';
import { scanState } from '../../plugins/maister/lib/state-scan.mjs';

// The pending marker of a driven gate names the session that suspended on it,
// in `asked_by_session`, so a reader can tell that session from a new one that
// comes to answer. The key is the caller's own word: written only on a cockpit
// or dispatch run whose host names its session, never null or empty, cleared
// with the marker, and never a write to the driver's own `session`.

const SESSION = '0f8e2c1a-5b7d-4c3e-9a10-2b4c6d8e0f12';
const SINCE = '2026-01-05T09:00:00Z';
const DRIVER_SESSION = { id: 'daemon-s-1', provider: 'claude' };
const GATE_MODULE = path.join(ENGINE_DIR, 'scripts/lib/gate.mjs');

/** A run frozen under `driver`, its analysis done and the approval's request file in place. */
function driven(t, driver) {
  const run = scratch(t, { fixture: 'gate' });
  freeze(run, driver ? { orchestrator: { driver } } : {});
  write(run, { nodes: { analysis: { status: 'completed' } } });
  return run;
}

/** Suspend `run` on the approval gate with `marker`, as the gate writer lands it. */
function suspend(run, marker) {
  const result = write(run, { orchestrator: { gate_pending: marker }, nodes: { approval: { status: 'suspended' } } });
  assert.equal(result.code, 0, result.stderr);
  return result;
}

const driverLine = text => text.split('\n').filter(line => /^ {2}driver:/.test(line));
const markerLines = text => text.split('\n').filter(line => line.includes('gate_pending') || line.includes('asked_by_session'));

test('hostSession: the host\'s id when it can name a file, else null', () => {
  assert.equal(hostSession({ CLAUDE_CODE_SESSION_ID: SESSION }), SESSION);
  assert.equal(hostSession({}), null);
  assert.equal(hostSession({ CLAUDE_CODE_SESSION_ID: '' }), null);
  assert.equal(hostSession({ CLAUDE_CODE_SESSION_ID: '../escape' }), null);
});

for (const kind of ['dispatch', 'cockpit']) {
  test(`${kind}: with the session named, the marker carries it on one line and the driver's session is untouched`, t => {
    const run = driven(t, { kind, cwd: '/work', session: DRIVER_SESSION });
    const before = fs.readFileSync(run.state, 'utf8');

    const marker = pendingMarker({ node: 'approval', since: SINCE, doc: readState(run), session: hostSession({ CLAUDE_CODE_SESSION_ID: SESSION }) });
    assert.deepEqual(marker, { node: 'approval', request: 'gates/approval.request.yml', since: SINCE, asked_by_session: SESSION });
    suspend(run, marker);

    const after = fs.readFileSync(run.state, 'utf8');
    assert.deepEqual(markerLines(after), [
      `  gate_pending: {node: approval, request: gates/approval.request.yml, since: "${SINCE}", asked_by_session: ${SESSION}}`,
    ], 'the marker, key included, is one line');
    assert.deepEqual(driverLine(after), driverLine(before), 'driver.session is byte-identical');
    assert.deepEqual(readState(run).orchestrator.gate_pending, marker);
    assert.deepEqual({ ...scanState(after).gatePending }, marker, 'the shared one-line reader reads it');
    assert.equal(scanState(after).driverSession, DRIVER_SESSION.id);
  });

  test(`${kind}: with no session named, or one that cannot name a file, the key is left out`, t => {
    const run = driven(t, { kind, cwd: '/work' });
    const doc = readState(run);
    for (const session of [hostSession({}), null, '', 'not a session']) {
      const marker = pendingMarker({ node: 'approval', since: SINCE, doc, session });
      assert.deepEqual(marker, { node: 'approval', request: 'gates/approval.request.yml', since: SINCE }, String(session));
    }
    suspend(run, pendingMarker({ node: 'approval', since: SINCE, doc, session: null }));
    assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /asked_by_session/);
  });
}

test('terminal and driverless runs: no key, and no gate request is written', t => {
  for (const driver of [{ kind: 'terminal' }, null]) {
    const run = driven(t, driver);
    const marker = pendingMarker({ node: 'approval', since: SINCE, doc: readState(run), session: SESSION });
    assert.ok(!Object.hasOwn(marker, 'asked_by_session'), JSON.stringify(driver));
  }
});

test('terminal: gate-request in this edition writes no request and no marker', { skip: fs.existsSync(GATE_MODULE) && 'this edition carries the gate module' }, t => {
  const run = scratch(t);
  freeze(run, { orchestrator: { driver: { kind: 'terminal' } } });
  const before = fs.readFileSync(run.state, 'utf8');
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify({ node: 'approval', kind: 'approve', question: 'Proceed?', options: [] }));
  const result = verb(['gate-request', `--state=${run.state}`, `--patch-file=${patch}`], undefined, { CLAUDE_CODE_SESSION_ID: SESSION });
  assert.equal(result.code, 1);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false);
});

for (const [label, value] of [['null', null], ['empty', ''], ['not a session id', 'two words'], ['a number', 7]]) {
  test(`refusal: asked_by_session ${label}`, t => {
    const run = driven(t, { kind: 'cockpit', cwd: '/work' });
    const before = fs.readFileSync(run.state, 'utf8');
    const result = verb(['write-state', `--state=${run.state}`], {
      orchestrator: { gate_pending: { node: 'approval', request: 'gates/approval.request.yml', since: SINCE, asked_by_session: value } },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^state-gate-pending-form\b/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  });
}

test('the answer fold clears the whole marker, key included', t => {
  const run = driven(t, { kind: 'cockpit', cwd: '/work', session: DRIVER_SESSION });
  suspend(run, { node: 'approval', request: 'gates/approval.request.yml', since: SINCE, asked_by_session: SESSION });
  const driverBefore = driverLine(fs.readFileSync(run.state, 'utf8'));

  fs.copyFileSync(path.join(FIXTURES, 'gates/approval.answered.yml'), path.join(run.dir, 'gates/approval.request.yml'));
  const result = write(run, {
    orchestrator: { gate_pending: null },
    nodes: { approval: { status: 'completed' } },
    node_summaries: { approval: { status: 'completed', decisions: [{ option: 'continue', answered_by: 'operator', at: '2026-01-05T09:05:00Z' }] } },
  });
  assert.match(result.stdout, /^gates\/index\.yml$/m);

  const text = fs.readFileSync(run.state, 'utf8');
  assert.match(text, /^ {2}gate_pending: null$/m);
  assert.doesNotMatch(text, /asked_by_session/);
  assert.equal(readState(run).orchestrator.gate_pending, null);
  assert.deepEqual(driverLine(text), driverBefore, 'clearing the marker leaves the driver alone');
  assert.match(fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'), /status: answered\}$/m);
});

/** What each reader makes of the run at its current marker. */
function readings(run) {
  const check = verb(['resume-check', `--state=${run.state}`]);
  assert.equal(check.code, 0, check.stderr);
  const report = JSON.parse(check.stdout);
  return {
    resume: { gate: report.gate, driver_kind: report.driver_kind, ok: report.ok },
    phases: readDashboard(run).phases,
    index: fs.readFileSync(path.join(run.dir, 'gates/index.yml'), 'utf8'),
    nodes: scanState(fs.readFileSync(run.state, 'utf8')).nodes,
  };
}

test('resume-check, the dashboard, the gate index and the node scan read a marker with the key as one without it', t => {
  const run = driven(t, { kind: 'dispatch', cwd: '/work' });
  const plain = { node: 'approval', request: 'gates/approval.request.yml', since: SINCE };
  suspend(run, plain);
  const without = readings(run);
  suspend(run, { ...plain, asked_by_session: SESSION });
  const withKey = readings(run);
  assert.deepEqual(JSON.parse(JSON.stringify(withKey)), JSON.parse(JSON.stringify(without)));
  assert.equal(withKey.resume.gate.node, 'approval');
});

test('sub-run: a cockpit child pending with the key but no driver session still reads as having no session', t => {
  // A re-driven parent keys "a child pending with no session" on the child's
  // driver session. The marker's key is a separate value, so it never fills
  // that in: the child still reads as pending with no session.
  const child = driven(t, { kind: 'cockpit', cwd: '/work' });
  const before = driverLine(fs.readFileSync(child.state, 'utf8'));
  suspend(child, pendingMarker({ node: 'approval', since: SINCE, doc: readState(child), session: SESSION }));
  const text = fs.readFileSync(child.state, 'utf8');
  const scanned = scanState(text);
  assert.equal(scanned.gatePending.asked_by_session, SESSION);
  assert.equal(scanned.driverSession, null, 'no driver session was written');
  assert.equal(scanned.driverKind, 'cockpit');
  assert.deepEqual(driverLine(text), before);
  assert.equal(readState(child).orchestrator.driver.session, undefined);
});
