import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ENGINE_DIR, freeze, readState, scratch, verb, delegating, write as writeState } from '../helpers.mjs';

// A built-in step that declares delegates completes only with them listed;
// every write here sends them as a session that dispatched them would.
const write = (run, patch) => writeState(run, delegating(patch));

// The specification audit runs on every run, between the specification and
// its one approval, and fixes the findings that have one obvious fix before
// that approval asks: each fix is recorded on the audit's node summary in
// `fixes_applied`, never as a decision, and only the findings left are open
// risks. The approval shows the audit and the specification together — the
// fixes as fixed by the run, apart from what the audit decided, the findings
// still open, the specification's own open assumptions and the stories nobody
// confirmed — and its revise suggestions come from the open items alone.

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

const SPECIFICATION = {
  status: 'completed',
  headline: 'The spec adds tag filtering to the notes list, with 6 requirements.',
  summary: 'Tag filtering on list(), scoped to the notes list.',
  risks: [{ risk: 'Tags are matched case-insensitively', tag: 'open', change: 'match tags exactly' }],
  stories: ['user-story-filter: a reader filters the notes list by one tag'],
};

/**
 * A run of `workflow` paused at `specification-approval`: every node before the
 * gate ended, the specification's summary and the audit's recorded as its fix
 * pass leaves it.
 */
function atSpecApproval(t, workflow) {
  const run = scratch(t, { type: workflow });
  const graph = freeze(run, { definition: path.join(WORKFLOWS, `${workflow}.yml`), inputs: { task_description: 'Tag the notes' } });
  const nodes = {};
  for (const node of graph.nodes) {
    if (node.id === 'specification-approval') break;
    nodes[node.id] = { status: 'completed' };
  }
  write(run, { nodes, node_summaries: { specification: SPECIFICATION, 'spec-audit': AUDIT } });
  return run;
}

const specBrief = run => {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=specification-approval', '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

for (const workflow of ['development', 'performance']) {
  test(`${workflow}: the specification approval shows the audit's fixes apart from its decisions, its open finding and the spec's own open items`, t => {
    const brief = specBrief(atSpecApproval(t, workflow));
    // One approval, closing both steps: the audit leads and the specification follows it.
    assert.match(brief.more_details, /\*\*Specification audit\*\*\n[^\n]+\n\n?\*\*Specification\*\*\n/);
    assert.match(brief.more_details, /^Next: Implementation planning$/m);
    const [settled, open] = brief.more_details.split('**Open**');
    const fixed = FIXES.map(fix => `- ${fix.finding} → ${fix.change}`);
    assert.ok(settled.includes(['**Fixed by the run**', ...fixed].join('\n')), settled);
    assert.match(settled, /\*\*Decided by the audit\*\*\n- The export stays CSV-only, as the codebase already writes it — audit/);
    assert.doesNotMatch(settled, /Decided by the run/, 'no fix is a decision the run made');
    for (const fix of FIXES) assert.ok(!open.includes(fix.finding.slice(0, 40)), `the fix "${fix.finding}" is not open`);
    assert.match(open, /^- Export size is unbounded → cap the export at 10,000 rows$/m);
    assert.match(open, /^- Tags are matched case-insensitively → match tags exactly$/m, 'the specification\'s open assumption is open too');
    assert.match(brief.more_details, /user-story-filter: a reader filters the notes list by one tag/);
    // The recommended continue's preview is what the picker shows first.
    const preview = brief.options[0].preview;
    assert.equal(brief.options[0].id, 'continue-to-planning');
    assert.match(preview, /Open risks:\n- Export size is unbounded/);
    assert.match(preview, /Tags are matched case-insensitively/);
    assert.ok(preview.includes(['Fixed by the run: 2', ...fixed].join('\n')), preview);
    assert.match(preview, /^Decided by the audit:\n- The export stays CSV-only, as the codebase already writes it — audit$/m);
    assert.match(preview, /user-story-filter/);
  });

  test(`${workflow}: the revise suggestions come from the open items alone, never from a fix`, t => {
    const revise = specBrief(atSpecApproval(t, workflow)).options.find(option => option.id === 'revise-specification');
    const notes = [...(revise.suggestions ?? []).map(each => each.note), revise.note_question?.question ?? ''].join('\n');
    assert.match(notes, /Export size is unbounded/);
    for (const fix of FIXES) assert.doesNotMatch(notes, new RegExp(fix.finding.slice(0, 20)));
  });

  test(`${workflow}: the audit's node summary keeps its fixes when a later write sends only its risks`, t => {
    const run = atSpecApproval(t, workflow);
    write(run, { node_summaries: { 'spec-audit': { risks: [{ risk: 'Export size is unbounded', tag: 'resolved' }] } } });
    const summary = readState(run).node_summaries['spec-audit'];
    assert.deepEqual(summary.fixes_applied, FIXES);
    assert.equal(summary.reaudit_count, 0);
    assert.equal(summary.risks[0].tag, 'resolved');
  });
}
