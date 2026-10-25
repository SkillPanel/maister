import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, ROOT, freeze, run, scratch, sibling, verb, delegating, write as writeState } from '../helpers.mjs';

// A built-in step that declares delegates completes only with them listed;
// every write here sends them as a session that dispatched them would.
const write = (run, patch) => writeState(run, delegating(patch));

// What a gate says of each choice is what a cockpit shows as written: the
// title names what is approved, a label where the run goes, the recommended
// option's reason argues for that option, and two continues that set different
// values never read alike. Under a parent run, the end of this run and a stop
// are named by what they do to the parent.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const RESEARCH = path.join(WORKFLOWS, 'research.yml');
const LINT = path.join(ROOT, 'tests/gate-title-lint.mjs');

/** A research run at its foundation gate, the foundation closed with `risks`. */
function atFoundation(t, { inputs = {}, orchestrator = {}, risks = [], recommends = null, at = null } = {}) {
  const child = at ?? scratch(t, { type: 'research', name: '2026-10-17-wording' });
  freeze(child, { definition: RESEARCH, inputs: { question: 'Which store keeps notes safe?', ...inputs }, orchestrator });
  write(child, {
    nodes: { 'research-foundation': { status: 'completed', values: { confidence_level: 'high', conclusions: 'store-is-safe' } } },
    node_summaries: { 'research-foundation': { summary: 'The store is safe under load.', risks, ...(recommends ? { recommends } : {}) } },
  });
  return child;
}

function checkpointOf(child, node = 'foundation-approval') {
  const result = verb(['gate-brief', `--state=${child.state}`, `--node=${node}`, '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function pickerOf(child, node = 'foundation-approval') {
  const result = verb(['gate-brief', `--state=${child.state}`, `--node=${node}`, '--json', '--picker=rich']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const OPEN = ['open: the retention period is unsettled', 'open: the backup cadence is unsettled', 'open: the export format is unsettled'];

test('gate wording: the research foundation gate, as it reads now', t => {
  const child = atFoundation(t, { risks: OPEN });
  const checkpoint = checkpointOf(child);
  assert.equal(checkpoint.ask, 'Approve the research foundation?', 'was "Research complete. Ready to go on?"');
  assert.deepEqual(checkpoint.recommended, {
    option: 'continue-to-brainstorming',
    reason: 'none of the 3 open items blocks solution brainstorming',
  }, 'was "3 open items; revise to settle them first" beside a recommended continue');
  assert.deepEqual(pickerOf(child).options.map(option => [option.id, option.label, option.description]), [
    ['continue-to-brainstorming', 'Continue to brainstorming (Recommended)',
      'Runs solution brainstorming next; high-level design is decided at a later checkpoint.'],
    ['continue-to-design', 'Continue to the design, skip brainstorming',
      'Skips solution brainstorming and solution convergence; runs high-level design next.'],
    ['finish-with-research', 'Continue to final summary',
      'Skips solution brainstorming, solution convergence and high-level design; runs final summary next.'],
    ['revise-research', 'Revise the research', 'Re-runs Research foundation with your note, then asks this again.'],
  ]);
  assert.ok(checkpoint.options.some(option => option.id === 'stop-research' && option.effect === 'stop'), 'the stop is offered, named in the question on this picker');
});

test('gate wording: the two research gates that close the foundation ask different questions', t => {
  const child = atFoundation(t, { inputs: { findings_only: true } });
  write(child, { nodes: { 'foundation-approval': { status: 'skipped' } } });
  assert.equal(checkpointOf(child, 'findings-approval').ask, 'Approve the research findings?');
});

test('gate wording: a recommended continue never carries a reason to revise', t => {
  for (const risks of [[], OPEN.slice(0, 1), OPEN]) {
    for (const recommends of [null, { option: 'continue-to-design', reason: 'The design was asked for' }]) {
      const checkpoint = checkpointOf(atFoundation(t, { risks, recommends }));
      const chosen = checkpoint.options.find(option => option.recommended);
      assert.equal(chosen.effect, 'continue');
      assert.doesNotMatch(checkpoint.recommended.reason, /revise/i, JSON.stringify(checkpoint.recommended));
    }
  }
});

/** Every continue of `node` that sets values, as `[id, consequence]`. */
function setting(checkpoint) {
  return checkpoint.options.filter(option => option.effect === 'continue' && option.sets).map(option => [option.id, option.consequence]);
}

test('gate wording: continues that set different values never print the same consequence', t => {
  const assertDistinct = (checkpoint, where) => {
    const lines = setting(checkpoint);
    assert.ok(lines.length >= 2, `${where}: ${JSON.stringify(lines)}`);
    assert.equal(new Set(lines.map(([, line]) => line)).size, lines.length, `${where}: ${JSON.stringify(lines)}`);
  };
  assertDistinct(checkpointOf(atFoundation(t)), 'research foundation-approval');
  assertDistinct(checkpointOf(atFoundation(t, { inputs: { embedded: true } })), 'research foundation-approval, embedded');

  const converging = atFoundation(t);
  write(converging, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'continue-to-brainstorming' } } });
  write(converging, {
    nodes: { 'solution-generation': { status: 'completed' }, 'solution-convergence': { status: 'completed', values: { selected_approach: 'append-only-log' } } },
    node_summaries: { 'solution-convergence': { summary: 'Converged on an append-only log.' } },
  });
  assertDistinct(checkpointOf(converging, 'convergence-approval'), 'research convergence-approval');

  for (const [gate, values] of [
    ['specification-approval', { 'gap-analysis': { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } }],
    ['verification-approval', { 'gap-analysis': { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low', ui_heavy: true } }],
  ]) {
    const dev = scratch(t, { type: 'development', name: `2026-10-17-${gate}` });
    const graph = freeze(dev, { definition: path.join(WORKFLOWS, 'development.yml'), inputs: { task_description: 'Add a settings page' } });
    const nodes = {};
    for (const node of graph.nodes) {
      if (node.id === gate) break;
      nodes[node.id] = { status: 'completed' };
    }
    for (const [id, recorded] of Object.entries(values)) nodes[id].values = recorded;
    write(dev, { nodes });
    const closing = graph.nodes.find(node => node.id === gate).needs[0];
    write(dev, { node_summaries: { [closing]: { summary: 'Done.' } } });
    const result = verb(['gate-brief', `--state=${dev.state}`, `--node=${gate}`, '--checkpoint']);
    if (result.code !== 0) continue;
    assertDistinct(JSON.parse(result.stdout), `development ${gate}`);
  }
});

/** A parent run whose `workflow:` node started the research child; `after` adds a node after it. */
function parentOf(t, { after = false } = {}) {
  const parent = scratch(t, { type: 'development', name: '2026-10-17-parent' });
  const definition = path.join(parent.root, 'parent.yml');
  fs.writeFileSync(definition, [
    'name: delivery',
    'version: 1',
    'display:',
    '  titles:',
    '    ship: "Release notes"',
    'nodes:',
    '  analysis:',
    '    uses: direct:analysis',
    '    needs: []',
    '  research:',
    '    uses: workflow:research',
    '    needs: [analysis]',
    '    with:',
    '      question: "Which store keeps notes safe?"',
    ...(after ? ['  ship:', '    uses: direct:ship', '    needs: [research]'] : []),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(parent.root, 'parent.md'), '# Delivery\n\n## `analysis`\n\nAnalyse.\n\n## `ship`\n\nShip.\n');
  freeze(parent, { definition });
  write(parent, { nodes: { analysis: { status: 'completed' }, research: { status: 'running' } } });
  const child = sibling(parent, { type: 'research', name: '2026-10-17-parent-research' });
  atFoundation(t, {
    at: child,
    inputs: { embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  write(parent, { nodes: { research: { status: 'waiting', values: { task_path: child.path, run_id: child.name } } } });
  return child;
}

test('gate wording: under a parent, the end of the research names the parent\'s next step', t => {
  const child = parentOf(t, { after: true });
  const finish = pickerOf(child).options.find(option => option.id === 'finish-with-research');
  assert.equal(finish.label, 'Continue to release notes');
  assert.equal(finish.description,
    'Skips solution brainstorming, solution convergence and high-level design; ends this research run; delivery continues to release notes.');
});

test('gate wording: under a parent that ends with the research, the end finishes the parent', t => {
  const child = parentOf(t);
  const finish = pickerOf(child).options.find(option => option.id === 'finish-with-research');
  assert.equal(finish.label, 'Finish delivery');
});

test('gate wording: under a parent, a stop names the parent it also stops', t => {
  const child = parentOf(t, { after: true });
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'continue-to-brainstorming' } } });
  write(child, {
    nodes: { 'solution-generation': { status: 'completed' }, 'solution-convergence': { status: 'completed', values: { selected_approach: 'append-only-log' } } },
    node_summaries: { 'solution-convergence': { summary: 'Converged on an append-only log.' } },
  });
  const stop = checkpointOf(child, 'convergence-approval').options.find(option => option.effect === 'stop');
  assert.equal(stop.label, 'Stop delivery here (nothing further runs)');
  assert.equal(stop.consequence, 'Stops this run and delivery; nothing further runs.');
});

test('gate wording: standalone, a stop stays "Stop here"', t => {
  const child = atFoundation(t);
  write(child, { nodes: { 'foundation-approval': { status: 'completed' } }, node_summaries: { 'foundation-approval': { answer: 'continue-to-brainstorming' } } });
  write(child, {
    nodes: { 'solution-generation': { status: 'completed' }, 'solution-convergence': { status: 'completed', values: { selected_approach: 'append-only-log' } } },
    node_summaries: { 'solution-convergence': { summary: 'Converged on an append-only log.' } },
  });
  const stop = checkpointOf(child, 'convergence-approval').options.find(option => option.effect === 'stop');
  assert.equal(stop.label, 'Stop here');
  assert.equal(stop.consequence, 'Ends the run here.');
});

test('gate-title lint: the built-ins pass; two gates asking alike fail', t => {
  const passed = run(LINT, [], undefined, {}, ROOT);
  assert.equal(passed.code, 0, passed.stdout + passed.stderr);
  const dir = scratch(t).root;
  const file = path.join(dir, 'twin-gates.yml');
  fs.writeFileSync(file, [
    'name: twins',
    'version: 1',
    'nodes:',
    '  draft:',
    '    uses: direct:draft',
    '    needs: []',
    '  first:',
    '    type: gate',
    '    needs: [draft]',
    '    ask: "Draft complete. Continue?"',
    '    options: {continue: continue, stop: stop}',
    '  second:',
    '    type: gate',
    '    needs: [first]',
    '    ask: "Draft complete. Continue?"',
    '    options: {continue: continue, stop: stop}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'twin-gates.md'), '# Twins\n\n## `draft`\n\nDraft.\n');
  const failed = run(LINT, [`--definition=${file}`], undefined, {}, ROOT);
  assert.equal(failed.code, 1, failed.stdout + failed.stderr);
  assert.match(failed.stdout, /^FAIL: .*twin-gates\.yml: first and second both ask "Draft complete\. Ready to go on\?"$/m);
});
