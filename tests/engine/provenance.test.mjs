import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { FIXTURES, freeze, readState, scratch, verb, write } from '../helpers.mjs';
import { gateAnswer } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';

// A gate's answer is the last decision carrying an option, and every reader of
// that answer goes through one helper: an item recorded after the answer — a
// note the run made, a settlement — never stands in for it.

const OPTIONAL = path.join(FIXTURES, 'definitions/optional-step.yml');
const REVISE = path.join(FIXTURES, 'definitions/revise.yml');

/** A decision the run recorded on the gate after its answer, carrying no option. */
const LATER = { decision: 'Noted after the answer', by: 'run' };

test('the shared reader: the last decision with an option is the answer, whatever follows it', t => {
  const answer = { option: 'continue', answered_by: 'dana' };
  assert.equal(gateAnswer([{ option: 'stop-here' }, answer, LATER, 'a string decision']), answer);
  assert.equal(gateAnswer([LATER]), null);
  assert.equal(gateAnswer(undefined), null);

  // stampGateValues: the gate's values are read from the answer, not the item after it.
  const valued = scratch(t);
  freeze(valued, { definition: OPTIONAL });
  write(valued, { nodes: { specification: { status: 'completed' } } });
  write(valued, {
    nodes: { 'specification-approval': { status: 'completed' } },
    node_summaries: { 'specification-approval': { decisions: [{ option: 'continue-to-audit' }, LATER] } },
  });
  assert.deepEqual(readState(valued).workflow.nodes['specification-approval'].values, { audit_enabled: true });

  // gate-revise: the driven fold is recognised through the answer, and the
  // revise decision replaces that item, not the one after it.
  const revised = scratch(t);
  freeze(revised, { definition: REVISE, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  write(revised, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } } });
  write(revised, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' }, review: { status: 'completed' } } });
  write(revised, {
    nodes: { 'review-approval': { status: 'completed' } },
    node_summaries: { 'review-approval': { decisions: [{ option: 'send-back', answered_by: 'dana', at: '2026-01-05T10:00:00Z', via: 'cockpit' }, LATER] } },
  });
  const result = verb(['gate-revise', `--state=${revised.state}`, '--node=review-approval', '--option=send-back'], { note: 'Tighten the intro' });
  assert.equal(result.code, 0, result.stderr);
  const decisions = readState(revised).node_summaries['review-approval'].decisions;
  assert.deepEqual(decisions.map(item => [item.option ?? null, item.attempt ?? null]), [[null, null], ['send-back', 1]]);
  assert.equal(decisions[1].answered_by, 'dana', 'the folded answer\'s name is carried onto the revise decision');

  // run-complete: the stop line names the answer, not the note after it.
  const stopped = scratch(t);
  freeze(stopped);
  fs.mkdirSync(path.join(stopped.dir, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(stopped.dir, 'analysis/report.md'), '');
  write(stopped, {
    task: { status: 'stopped' },
    nodes: { analysis: { status: 'completed' }, approval: { status: 'completed' }, implementation: { status: 'stopped' }, research: { status: 'stopped' } },
    node_summaries: { approval: { status: 'completed', decisions: [{ option: 'stop-here', answered_by: 'dana', at: '2026-01-05T09:05:00Z' }, LATER] } },
  });
  const closed = verb(['run-complete', `--state=${stopped.state}`]);
  assert.equal(closed.stdout, 'run stopped: approval - stop-here\nRUN-COMPLETE\n');
});
