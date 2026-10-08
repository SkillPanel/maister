import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, write } from '../helpers.mjs';

// The specification audit fixes the findings that have one obvious fix before
// its gate asks: each fix is recorded on the audit's node summary in
// `fixes_applied`, never as a decision, and only the findings left are open
// risks. The gate shows the fixes as fixed by the run, apart from what the
// audit decided, and its revise suggestions come from the open findings alone.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

const FIXES = [
  { finding: 'No test covers an unknown customer listed before a known one', change: 'Added the test case to the testing approach' },
  { finding: 'The spec says both "tags are optional" and "every note has a tag"', change: 'Kept "tags are optional", the side the requirements chose' },
];

const AUDIT = {
  status: 'completed',
  headline: 'The audit passes the spec after two fixes; one concern is left.',
  summary: 'Pass with concerns: three findings, two fixed by the run, one left.',
  decisions: [{ decision: 'The export stays CSV-only, as the codebase already writes it', by: 'audit' }],
  risks: [{ risk: 'Export size is unbounded', tag: 'open', change: 'cap the export at 10,000 rows' }],
  fixes_applied: FIXES,
  reaudit_count: 0,
};

/**
 * A run of `workflow` paused at `spec-audit-approval`: every node before the
 * gate ended — the specification gate having chosen the audit where it decides
 * it — and the audit's summary recorded as its fix pass leaves it.
 */
function atAuditApproval(t, workflow) {
  const run = scratch(t, { type: workflow });
  const graph = freeze(run, { definition: path.join(WORKFLOWS, `${workflow}.yml`), inputs: { task_description: 'Tag the notes' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'spec-audit-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  const continues = Object.keys(graph.nodes.find(node => node.id === 'specification-approval').options);
  if (continues.includes('continue-to-spec-audit')) nodes['specification-approval'].decisions = [{ option: 'continue-to-spec-audit' }];
  write(run, { nodes, node_summaries: { 'spec-audit': AUDIT } });
  return run;
}

for (const workflow of ['development', 'performance']) {
  test(`${workflow}: the audit gate lists the fixes as fixed by the run, apart from its decisions, and the open finding as open`, t => {
    const run = atAuditApproval(t, workflow);
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=spec-audit-approval', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const brief = JSON.parse(result.stdout);
    const [settled, open] = brief.more_details.split('**Open**');
    const fixed = FIXES.map(fix => `- ${fix.finding} → ${fix.change}`);
    assert.ok(settled.includes(['**Fixed by the run**', ...fixed].join('\n')), settled);
    assert.match(settled, /\*\*Decided by the audit\*\*\n- The export stays CSV-only, as the codebase already writes it — audit/);
    assert.doesNotMatch(settled, /Decided by the run/, 'no fix is a decision the run made');
    for (const fix of FIXES) assert.ok(!open.includes(fix.finding.slice(0, 40)), `the fix "${fix.finding}" is not open`);
    assert.match(open, /^- Export size is unbounded → cap the export at 10,000 rows$/m);
    // The recommended continue's preview is what the picker shows first.
    const preview = brief.options[0].preview;
    assert.match(preview, /Open risks:\n- Export size is unbounded/);
    // Nine lines hold the risk and the first fix; the audit's decision gives way to its count first.
    assert.ok(preview.includes(['Fixed by the run: 2 (+1 more under More details)', fixed[0]].join('\n')), preview);
    assert.match(preview, /^Decided by the audit: 1 decision, under More details\.$/m);
  });

  test(`${workflow}: the revise suggestions come from the open finding alone, never from a fix`, t => {
    const run = atAuditApproval(t, workflow);
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=spec-audit-approval', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const revise = JSON.parse(result.stdout).options.find(option => option.id === 'revise-specification');
    const notes = [...(revise.suggestions ?? []).map(each => each.note), revise.note_question?.question ?? ''].join('\n');
    assert.match(notes, /Export size is unbounded/);
    for (const fix of FIXES) assert.doesNotMatch(notes, new RegExp(fix.finding.slice(0, 20)));
  });

  test(`${workflow}: the audit's node summary keeps its fixes when a later write sends only its risks`, t => {
    const run = atAuditApproval(t, workflow);
    write(run, { node_summaries: { 'spec-audit': { risks: [{ risk: 'Export size is unbounded', tag: 'resolved' }] } } });
    const summary = readState(run).node_summaries['spec-audit'];
    assert.deepEqual(summary.fixes_applied, FIXES);
    assert.equal(summary.reaudit_count, 0);
    assert.equal(summary.risks[0].tag, 'resolved');
  });
}
