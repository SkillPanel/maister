import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DECLARED, ENGINE_DIR, FIXTURES, freeze, legacyMirror, scratch, verb, write } from '../helpers.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';
import { decisionOf } from '../../plugins/maister/skills/workflow-engine/scripts/lib/items.mjs';

/** A decision as the passage prints it: one line, its number in its node's list first. */
const decided = (node, index, text, by = 'run') => `- [${index}] ${text} — by: ${by}`;
/** The same line as a pattern, for an assertion that reads it among others. */
const decidedLine = (...args) => decided(...args).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Run `prior-context` against a run; the verb writes nothing, so only its output is asserted. */
function priorContext(run) {
  return verb(['prior-context', `--state=${run.state}`]);
}

/** Freeze the fixture workflow of its own name, `survey`, whose block is derived. */
function survey(t) {
  const run = scratch(t, { type: 'survey' });
  freeze(run, { definition: DECLARED, inputs: { subject: 'acme-api' } });
  return run;
}

test('prior-context: a workflow of its own name is rendered from its derived block', t => {
  const run = survey(t);
  write(run, {
    context: { scope: 'api' },
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Prior-phase context/);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 1 node, 1 decision, 1 risk\./);
  assert.match(result.stdout, /^### scan$/m);
  assert.match(result.stdout, new RegExp(`^Decisions \\(1\\):\n${decidedLine('scan', 0, 'scan the api only')}$`, 'm'));
  assert.match(result.stdout, /^Risks \(1\):\n- rate limits$/m);
});

test('prior-context: a run with no context block renders its node summaries', t => {
  const run = survey(t);
  write(run, {
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only', 'skip the docs site'], risks: [] },
    },
  });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 1 node, 2 decisions, 0 risks\./);
  assert.match(result.stdout, /^### scan$/m);
  assert.match(result.stdout, /^Summary: Scanned the api\.$/m);
  assert.match(result.stdout, new RegExp(`^Decisions \\(2\\):\n${decidedLine('scan', 0, 'scan the api only')}\n${decidedLine('scan', 1, 'skip the docs site')}$`, 'm'));
  assert.match(result.stdout, /^Risks \(0\): none recorded\.$/m);
});

test('prior-context: a freshly frozen run with nothing recorded says so and exits 0', t => {
  const run = survey(t);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries`.*: 0 nodes, 0 decisions, 0 risks\./);
  assert.match(result.stdout, /^No node has recorded a summary yet: this is the run's first artifact-writing node/m);
});

test('prior-context: a phase-summary mirror an older run carries is ignored', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    context: { risk_level: 'low' },
    node_summaries: { analysis: { summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } },
  });
  legacyMirror(run, [
    '    analysis:',
    '      node: analysis',
    '      summary: Scoped on the mirror.',
    '      decisions:',
    '        - only on the mirror',
  ]);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: \d+ nodes?, 1 decision, 0 risks\./);
  assert.ok(result.stdout.split('\n').includes(decided('analysis', 0, 'keep the parser')), result.stdout);
  assert.doesNotMatch(result.stdout, /only on the mirror|Scoped on the mirror|phase_summaries/);
  assert.deepEqual(result.stderr.split(/\r?\n/).filter(line => line !== ''), [
    'warning: legacy-mirror-ignored: task_context.phase_summaries holds 1 decision and 0 risks that no step reads; '
      + 'the phase-summary mirror is retired (see the Upgrading note in the changelog)',
  ]);
});

test('prior-context --node: a mirror holding items warns once on stderr, beside the run block and the passage', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    context: { risk_level: 'low' },
    node_summaries: { analysis: { summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } },
  });
  legacyMirror(run, [
    '    analysis:',
    '      decisions:',
    '        - only on the mirror',
    '      risks:',
    '        - a mirror risk',
  ]);
  const result = verb(['prior-context', `--state=${run.state}`, '--node=analysis']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Run context/);
  assert.match(result.stdout, /\n\n## Prior-phase context/);
  assert.ok(result.stdout.split('\n').includes(decided('analysis', 0, 'keep the parser')), result.stdout);
  assert.doesNotMatch(result.stdout, /only on the mirror|a mirror risk|phase_summaries/);
  assert.deepEqual(result.stderr.split(/\r?\n/).filter(line => line !== ''), [
    'warning: legacy-mirror-ignored: task_context.phase_summaries holds 1 decision and 1 risk that no step reads; '
      + 'the phase-summary mirror is retired (see the Upgrading note in the changelog)',
  ]);
});

test('prior-context: no mirror, or an empty one, prints no warning', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  const bare = priorContext(run);
  assert.equal(bare.code, 0, bare.stderr);
  assert.equal(bare.stderr, '');
  legacyMirror(run, []);
  const empty = priorContext(run);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stderr, '');
});

test('prior-context: a decision on a node summary reaches later steps once the run has a context block', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: 'Scoped.', decisions: ['keep the parser'], risks: [] } } });
  write(run, { context: { risk_level: 'low' } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: \d+ nodes?, 1 decision, 0 risks\./);
  assert.match(result.stdout, /^### analysis$/m);
  assert.match(result.stdout, new RegExp(`^Decisions \\(1\\):\n${decidedLine('analysis', 0, 'keep the parser')}$`, 'm'));
  assert.doesNotMatch(result.stdout, /has recorded a summary yet/);
});

test('parity: every decision and risk of the beta.28 mirror reaches later steps', t => {
  const sample = path.join(FIXTURES, 'runs/free-delivery-threshold');
  const reference = JSON.parse(fs.readFileSync(path.join(sample, 'phase-summary-items.json'), 'utf8'));
  const run = scratch(t, { name: '2026-09-30-free-delivery-threshold-per-country' });
  fs.copyFileSync(path.join(sample, 'recorded-state.yml'), run.state);
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /phase_summaries/);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Pasted from `node_summaries` in this run's `orchestrator-state\.yml`: 26 nodes, 41 decisions, 31 risks\./);
  assert.equal(reference.decisions.length, 35, 'the reference holds every mirror decision');
  assert.equal(reference.risks.length, 27, 'the reference holds every mirror risk');
  const lines = result.stdout.split(/\r?\n/);
  const printed = new Set(lines);
  // A decision is one line, its text and who settled it, then its record path;
  // the rest of the item is in that record.
  const onOneLine = text => lines.some(line => /^- \[\d+\] /.test(line) && line.replace(/^- \[\d+\] /, '').startsWith(`${text} — by: `));
  // The equivalent line is the state's own wording, `decision: <text> — rationale: …`.
  const equivalentText = line => line?.replace(/^decision: /, '').replace(/ — rationale: .*$/, '');
  const asDecision = entry => {
    const decision = decisionOf(entry.item);
    return (decision !== null && onOneLine(decision.decision))
      || (entry.equivalent_line !== undefined && onOneLine(equivalentText(entry.equivalent_line)));
  };
  const matched = entries => entries.filter(entry => asDecision(entry)
    || printed.has(`- ${entry.line}`) || (entry.equivalent_line !== undefined && printed.has(`- ${entry.equivalent_line}`)));
  const missing = entries => entries.filter(entry => !matched([entry]).length).map(entry => entry.line);
  assert.deepEqual(missing(reference.decisions), [], 'every mirror decision is printed');
  assert.deepEqual(missing(reference.risks), [], 'every mirror risk is printed');
  const decisions = matched(reference.decisions).length;
  const risks = matched(reference.risks).length;
  t.diagnostic(`matched ${decisions} of ${reference.decisions.length} mirror decisions and ${risks} of ${reference.risks.length} mirror risks`);
});

test('prior-context: every decision in state is one line, and its number and section are the path of its full record', t => {
  const sample = path.join(FIXTURES, 'runs/free-delivery-threshold');
  const run = scratch(t, { name: '2026-09-30-free-delivery-threshold-per-country' });
  fs.copyFileSync(path.join(sample, 'recorded-state.yml'), run.state);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  // Each numbered line, with the node whose section holds it.
  const records = [];
  let node = null;
  for (const line of result.stdout.split(/\r?\n/)) {
    const heading = /^### (\S+)$/.exec(line);
    if (heading) node = heading[1];
    const numbered = /^- \[(\d+)\] (.*)$/.exec(line);
    if (numbered) records.push({ node, index: Number(numbered[1]), text: numbered[2] });
  }
  const summaries = parse(fs.readFileSync(run.state, 'utf8')).node_summaries;
  const expected = Object.entries(summaries).flatMap(([key, entry]) => (entry.decisions ?? []).map((item, index) => ({ node: key, index, item })));
  assert.equal(expected.length, 41, 'the fixture holds 41 decisions');
  assert.equal(records.length, expected.length, 'one line per decision, none dropped and none merged');
  for (const { node: key, index, item } of expected) {
    const at = records.filter(record => record.node === key && record.index === index);
    assert.equal(at.length, 1, `${key}.decisions[${index}] is printed exactly once`);
    const decision = decisionOf(item);
    assert.ok(at[0].text.startsWith(`${decision.decision} — by: ${decision.by}`), at[0].text);
    assert.equal(at[0].text.split('\n').length, 1);
  }
  // The path is given once, against the state file, and every line's number
  // and section resolve to a record that is there.
  assert.ok(result.stdout.includes(`is \`node_summaries.<node>.decisions[n]\` in ${run.state}, \`<node>\` being the heading of its section`));
  for (const record of records) assert.ok(summaries[record.node].decisions[record.index] !== undefined, `${record.node} [${record.index}]`);
});

test('prior-context: a node summary written by hand as a bare list is not read as decisions', t => {
  const run = scratch(t, { fixture: 'unproven' });
  write(run, { node_summaries: { analysis: { summary: 'Analysed.', decisions: ['keep the notes'], risks: [] } } });
  // The writer refuses a summary that is not a map, so only a hand edit can leave one.
  const text = fs.readFileSync(run.state, 'utf8')
    .replace(/^node_summaries:\r?\n/m, 'node_summaries:\n  review:\n    - approve the scope\n');
  assert.match(text, /review:\n {4}- approve the scope/, 'the hand edit landed');
  fs.writeFileSync(run.state, text);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.split('\n').includes(decided('analysis', 0, 'keep the notes')), result.stdout);
  assert.doesNotMatch(result.stdout, /approve the scope/);
});

test('prior-context: a file that is no run at all is refused', t => {
  const run = scratch(t);
  fs.writeFileSync(run.state, 'orchestrator:\n  started_phase: null\n', 'utf8');
  const result = priorContext(run);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^prior-context-absent: .*no node_summaries and no workflow block/);
});

test('prior-context --background: the same items, framed as background an end-user document stays consistent with', t => {
  const run = survey(t);
  write(run, {
    node_summaries: {
      scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: ['rate limits'] },
    },
  });
  const result = verb(['prior-context', `--state=${run.state}`, '--background']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^## Background — what earlier phases decided$/m);
  assert.match(result.stdout, /1 node, 1 decision, 1 risk\. These are background for a document written for end users/);
  assert.match(result.stdout, /do not reproduce them/);
  assert.doesNotMatch(result.stdout, /binding|do not re-word/, 'nothing tells the writer to carry the items into its document');
  // Every item still arrives, so the writer can stay consistent with each one.
  assert.match(result.stdout, new RegExp(`^Decisions \\(1\\):\n${decidedLine('scan', 0, 'scan the api only')}$`, 'm'));
  assert.match(result.stdout, /^Risks \(1\):\n- rate limits$/m);
  assert.match(priorContext(run).stdout, /These are binding\./, 'without the flag the block is binding, as before');
});

test('prior-context: without --node the output is the prior-phase passage alone, byte for byte', t => {
  const run = survey(t);
  write(run, { node_summaries: { scan: { summary: 'Scanned the api.', decisions: ['scan the api only'], risks: [] } } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    '## Prior-phase context — decisions and risks carried forward',
    '',
    'Pasted from `node_summaries` in this run\'s `orchestrator-state.yml`: 1 node, 1 decision, 0 risks. '
      + 'These are binding. Every item below is one item in state — do not drop one, do not merge two, and do not re-word them. '
      + 'Each decision is one line: its number `[n]`, what was decided, who settled it (`by`) and its question `id` when it has one. '
      + `Its full record — the rationale, the question and the answer — is \`node_summaries.<node>.decisions[n]\` in ${run.state}, `
      + '`<node>` being the heading of its section; open it when you need the reasoning behind a decision.',
    '',
    '### scan',
    '',
    'Summary: Scanned the api.',
    '',
    'Decisions (1):',
    decided('scan', 0, 'scan the api only'),
    '',
    'Risks (0): none recorded.',
    '',
    'Status: pending',
    '',
    '',
  ].join('\n'));
});

test('prior-context --node: a node the run does not have is refused by the run block before anything prints', t => {
  const run = survey(t);
  const result = verb(['prior-context', `--state=${run.state}`, '--node=nope']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^run-context-unknown-node: /);
});

test('prior-context: a mirror whose entries hold no decision and no risk prints no warning', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { context: { risk_level: 'low' } });
  legacyMirror(run, [
    '    analysis:',
    '      summary: Scoped on the mirror.',
    '      decisions: []',
    '      risks: []',
  ]);
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('prior-context: a node recorded skipped with no summary is left out', t => {
  const run = scratch(t);
  freeze(run, { definition: path.join(FIXTURES, 'definitions/revise.yml') });
  write(run, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } }, node_summaries: { draft: { summary: 'Drafted the guide.' } } });
  write(run, { nodes: { figures: { status: 'skipped' } } });
  const result = priorContext(run);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^### draft$/m);
  assert.doesNotMatch(result.stdout, /figures/i);
  assert.match(result.stdout, /: 1 node, /);
});

test('prior-context --node: prints the short scratch line for a step whose helpers are all the plugin\'s own, and the whole line otherwise', t => {
  const research = scratch(t);
  freeze(research, { definition: path.join(ENGINE_DIR, 'workflows/research.yml'), inputs: { question: 'How does it work?' } });
  const short = verb(['prior-context', `--state=${research.state}`, '--node=research-foundation']);
  assert.equal(short.code, 0, short.stderr);
  const shortLine = short.stdout.split('\n').find(line => line.startsWith('scratch:'));
  assert.match(shortLine, /; your instructions carry the rest of the rule$/);
  assert.doesNotMatch(shortLine, /never the system temp directory/);

  const design = scratch(t);
  freeze(design, { definition: path.join(ENGINE_DIR, 'workflows/product-design.yml'), inputs: { task_description: 'A thing' } });
  const whole = verb(['prior-context', `--state=${design.state}`, '--node=intake']);
  assert.equal(whole.code, 0, whole.stderr);
  assert.match(whole.stdout.split('\n').find(line => line.startsWith('scratch:')), /never the system temp directory or a literal \/tmp path/);
});
