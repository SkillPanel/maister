import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, freezePatch, scratch, verb } from '../helpers.mjs';

// `dispatch-model` prints the model and effort an agent call carries, one line
// per agent, resolved by one precedence order: the plan tier; every entry naming
// the agent, from the profile, the overlay, the project's node, workflow and
// agent scopes and the shipped agents; the defaults in the same order; and the
// host. `omit` leaves the field off the call.

function config(run, text) {
  const file = path.join(run.root, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function overlay(run, text) {
  const file = path.join(run.root, '.maister', 'workflows', 'development.overlay.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `extends: development\nversion: 1\n${text}`);
  return file;
}

/** Freeze the sample (workflow `development`, nodes analysis, approval, implementation, research). */
function freezeRun(run, options = {}) {
  const result = verb(['write-state', `--state=${run.state}`], freezePatch(options).patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
}

/** One `dispatch-model` call; `state` false runs it standalone from the project root. */
function dispatch(run, args, { state = true, host = 'claude' } = {}) {
  const flags = [...(state ? [`--state=${run.state}`] : []), ...(host ? [`--host=${host}`] : []), ...args];
  return verb(['dispatch-model', ...flags], undefined, { CLAUDE_PROJECT_DIR: run.root });
}

/** The line for one agent, asserting the call succeeded. */
function lineOf(run, agent, args = [], options = {}) {
  const result = dispatch(run, [`--agent=${agent}`, ...args], options);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.split('\n')[0];
}

// ---------------------------------------------------------------------------
// precedence, one level each
// ---------------------------------------------------------------------------

test('level 1: the plan tier wins for an agent whose entry is choose: by-plan-tier', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  default: { tier: deep }\n  agents:\n    task-group-implementer: { choose: by-plan-tier, unassessed: deep }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=light']),
    'task-group-implementer: model haiku, effort high — source: plan tier light within project agents.task-group-implementer');
});

test('--tier is ignored for an agent whose entry is no by-plan-tier policy, with one note naming them', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    spec-auditor: { model: sonnet }\n    task-group-implementer: { choose: by-plan-tier, ceiling: standard }\n');
  freezeRun(run);
  const result = dispatch(run, ['--agent=explore,task-group-implementer,spec-auditor,task-classifier', '--tier=deep'], { host: 'copilot' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'explore: model claude-haiku-5.5, effort high — source: shipped agents.Explore, tier light',
    'task-group-implementer: model claude-sonnet-5.5, effort omit — source: plan tier deep, clamped to standard within project agents.task-group-implementer',
    'spec-auditor: model omit, effort omit — source: shipped default',
    'task-classifier: model claude-haiku-5.5, effort high — source: shipped agents.task-classifier, tier light',
    '',
    'note: --tier=deep was ignored for explore, spec-auditor, task-classifier: a plan tier applies only to an agent whose entry is choose: by-plan-tier, so they resolve as without one',
    '',
  ].join('\n'));

  // One agent, on Claude Code: its pin answers and the note is singular.
  const one = dispatch(run, ['--agent=spec-auditor', '--tier=light']);
  assert.equal(one.stdout, 'spec-auditor: model sonnet, effort omit — source: project agents.spec-auditor\n\n'
    + 'note: --tier=light was ignored for spec-auditor: a plan tier applies only to an agent whose entry is choose: by-plan-tier, so it resolves as without one\n');
});

test('level 2: the selected profile wins over the overlay', t => {
  const run = scratch(t);
  const file = overlay(run, 'subagents:\n  agents:\n    gap-analyzer: { tier: standard }\nprofiles:\n  premium:\n    subagents: { agents: { gap-analyzer: { tier: deep } } }\n');
  freezeRun(run, { overlays: [file], profile: 'premium' });
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model opus, effort omit — source: profile agents.gap-analyzer, tier deep');
});

test('level 3: the overlay wins over the project\'s node scope', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  workflows:\n    development:\n      nodes:\n        analysis: { agents: { Explore: { tier: deep } } }\n');
  const file = overlay(run, 'subagents:\n  agents:\n    Explore: { tier: light }\n');
  freezeRun(run, { overlays: [file] });
  assert.equal(lineOf(run, 'Explore', ['--node=analysis']), 'Explore: model haiku, effort high — source: overlay agents.Explore, tier light');
});

test('level 4: the project\'s node scope wins over its workflow scope', t => {
  const run = scratch(t);
  config(run, [
    'subagents:',
    '  workflows:',
    '    development:',
    '      agents: { Explore: { tier: light } }',
    '      nodes:',
    '        analysis: { agents: { Explore: { tier: standard, effort: high } } }',
    '',
  ].join('\n'));
  freezeRun(run);
  assert.equal(lineOf(run, 'Explore', ['--node=analysis']),
    'Explore: model sonnet, effort high — source: project workflows.development.nodes.analysis.agents.Explore, tier standard');
  // Another node of the run reads the workflow scope.
  assert.equal(lineOf(run, 'Explore', ['--node=implementation']),
    'Explore: model haiku, effort high — source: project workflows.development.agents.Explore, tier light');
});

test('level 5: the project\'s workflow scope wins over its agents', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    information-gatherer: { tier: deep }\n  workflows:\n    development:\n      agents: { information-gatherer: { tier: light } }\n    research:\n      agents: { information-gatherer: { tier: standard } }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'information-gatherer'),
    'information-gatherer: model haiku, effort high — source: project workflows.development.agents.information-gatherer, tier light');
});

test('level 6: the project\'s agents win over its default', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  default: { tier: standard }\n  agents:\n    spec-auditor: { model: opus, effort: high }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'spec-auditor'), 'spec-auditor: model opus, effort high — source: project agents.spec-auditor');
});

test('level 7: the shipped agents win over the project\'s default, which covers only the agents nobody names', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  default: { tier: standard }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'docs-operator'), 'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light');
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model sonnet, effort omit — source: project default, tier standard');
});

test('a project entry naming a clerical agent still wins over the shipped light pick', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  default: { tier: deep }\n  agents:\n    docs-operator: { tier: standard }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'docs-operator'), 'docs-operator: model sonnet, effort omit — source: project agents.docs-operator, tier standard');
  assert.equal(lineOf(run, 'task-classifier'), 'task-classifier: model haiku, effort high — source: shipped agents.task-classifier, tier light');
});

test('every entry naming the agent wins over every default, an overlay\'s default included', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    gap-analyzer: { tier: light }\n');
  freezeRun(run, { overlays: [overlay(run, 'subagents:\n  default: { tier: deep }\n')] });
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model haiku, effort high — source: project agents.gap-analyzer, tier light');
  assert.equal(lineOf(run, 'docs-operator'), 'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light');
  // An agent nobody names takes the most specific default: the overlay's over the project's.
  assert.equal(lineOf(run, 'spec-auditor'), 'spec-auditor: model opus, effort omit — source: overlay default, tier deep');
});

test('level 8: the shipped agents put the clerical agents on light', t => {
  const run = scratch(t);
  freezeRun(run);
  const result = dispatch(run, ['--agent=project-analyzer,docs-operator,task-classifier,test-suite-runner,html-companion-writer']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'project-analyzer: model haiku, effort high — source: shipped agents.project-analyzer, tier light',
    'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light',
    'task-classifier: model haiku, effort high — source: shipped agents.task-classifier, tier light',
    'test-suite-runner: model haiku, effort high — source: shipped agents.test-suite-runner, tier light',
    'html-companion-writer: model haiku, effort high — source: shipped agents.html-companion-writer, tier light',
    '',
  ].join('\n'));
});

test('with no config, Explore and the clerical agents run on Haiku at high effort, on either host', t => {
  const run = scratch(t);
  assert.equal(dispatch(run, ['--agent=Explore,docs-operator'], { state: false }).stdout,
    'Explore: model haiku, effort high — source: shipped agents.Explore, tier light\n'
    + 'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light\n');
  assert.equal(dispatch(run, ['--agent=explore,docs-operator'], { state: false, host: 'copilot' }).stdout,
    'explore: model claude-haiku-5.5, effort high — source: shipped agents.Explore, tier light\n'
    + 'docs-operator: model claude-haiku-5.5, effort high — source: shipped agents.docs-operator, tier light\n');
});

test('the light rung\'s high effort yields to an entry\'s own effort and to a project cell that sets one', t => {
  const own = scratch(t);
  config(own, 'subagents:\n  agents:\n    docs-operator: { tier: light, effort: low }\n    Explore: { tier: light, effort: inherit }\n');
  assert.equal(lineOf(own, 'docs-operator', [], { state: false }), 'docs-operator: model haiku, effort low — source: project agents.docs-operator, tier light');
  assert.equal(lineOf(own, 'Explore', [], { state: false }), 'Explore: model haiku, effort omit — source: project agents.Explore, tier light');

  // A project cell is laid over the shipped one: without an effort the high effort stays.
  const remapped = scratch(t);
  config(remapped, 'subagents:\n  tiers:\n    light: { claude: sonnet, copilot: gpt-6-luna }\n');
  assert.equal(lineOf(remapped, 'docs-operator', [], { state: false }), 'docs-operator: model sonnet, effort high — source: shipped agents.docs-operator, tier light');
  assert.equal(lineOf(remapped, 'docs-operator', [], { state: false, host: 'copilot' }), 'docs-operator: model gpt-6-luna, effort high — source: shipped agents.docs-operator, tier light');

  // A cell with its own effort uses it, and inherit sends none.
  const medium = scratch(t);
  config(medium, 'subagents:\n  tiers:\n    light: { effort: medium }\n');
  assert.equal(lineOf(medium, 'Explore', [], { state: false }), 'Explore: model haiku, effort medium — source: shipped agents.Explore, tier light');
  const off = scratch(t);
  config(off, 'subagents:\n  tiers:\n    light: { effort: inherit }\n');
  assert.equal(lineOf(off, 'Explore', [], { state: false }), 'Explore: model haiku, effort omit — source: shipped agents.Explore, tier light');
});

test('with no config the implementer runs on the planner\'s tier, unassessed on standard, with three deep groups before asking', t => {
  const run = scratch(t);
  freezeRun(run);
  const within = 'within shipped agents.task-group-implementer';
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=light']), `task-group-implementer: model haiku, effort high — source: plan tier light ${within}`);
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=standard']), `task-group-implementer: model sonnet, effort omit — source: plan tier standard ${within}`);
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=deep']), `task-group-implementer: model opus, effort omit — source: plan tier deep ${within}`);
  assert.equal(lineOf(run, 'task-group-implementer'),
    'task-group-implementer: model sonnet, effort omit — source: shipped agents.task-group-implementer, unassessed: standard');
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=deep'], { host: 'copilot' }),
    `task-group-implementer: model claude-opus-5.5, effort omit — source: plan tier deep ${within}`);

  const log = path.join(run.dir, 'implementation', 'work-log.md');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const group = n => `## 2026-01-05 10:0${n} - Group ${n} Complete (wave ${n})\n**Model**: opus (tier deep, planner: "a schema change")\n`;
  fs.writeFileSync(log, group(1) + group(2));
  assert.equal(dispatch(run, ['--agent=task-group-implementer', '--tier=deep']).stdout.split('\n').slice(1).join('\n'),
    '\nnote: task-group-implementer budget: 2 of 3 groups on deep used in this run\n');
  fs.appendFileSync(log, group(3));
  assert.equal(dispatch(run, ['--agent=task-group-implementer', '--tier=deep']).stdout.split('\n').slice(1).join('\n'),
    '\nnote: task-group-implementer budget: 3 of 3 groups on deep used in this run — ask before dispatching another group on deep\n');
});

test('the subagents block init writes holds exactly the built-in values', t => {
  const skill = fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/init/SKILL.md'), 'utf8');
  const block = [...skill.matchAll(/```yaml\n([\s\S]*?)```/g)].map(match => match[1]).find(text => /^subagents:/m.test(text));
  assert.ok(block, 'init carries a subagents block');
  const written = scratch(t);
  config(written, block);
  const bare = scratch(t);
  const agents = '--agent=Explore,project-analyzer,docs-operator,task-classifier,test-suite-runner,html-companion-writer,task-group-implementer,gap-analyzer';
  const values = result => result.stdout.replace(/ — source: [^\n]*/g, '');
  for (const host of ['claude', 'copilot']) {
    for (const tier of [[], ['--tier=light'], ['--tier=standard'], ['--tier=deep']]) {
      const own = dispatch(written, [agents, ...tier], { state: false, host });
      assert.equal(own.stderr, '', 'the written block draws no warning');
      assert.equal(values(own), values(dispatch(bare, [agents, ...tier], { state: false, host })), `${host} ${tier.join(' ')}`);
    }
  }
});

test('level 9: the shipped default inherits, so the call carries no model and no effort', t => {
  const run = scratch(t);
  freezeRun(run);
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model omit, effort omit — source: shipped default');
});

test('level 10: the host decides whenever an entry inherits, and on Copilot a Claude Code pin falls through', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    gap-analyzer: { model: inherit, effort: low }\n    spec-auditor: { model: opus, effort: high }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model omit, effort low — source: project agents.gap-analyzer');
  assert.equal(lineOf(run, 'spec-auditor', [], { host: 'copilot' }), 'spec-auditor: model omit, effort omit — source: shipped default');
});

// ---------------------------------------------------------------------------
// hosts, presets and names
// ---------------------------------------------------------------------------

test('--host picks the cell: Copilot gets model ids, from the ladder and from a preset', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  presets:\n    scout: { claude: haiku, copilot: gpt-6-luna, effort: low }\n  agents:\n    Explore: { preset: scout }\n    gap-analyzer: { tier: standard }\n');
  freezeRun(run);
  const claude = dispatch(run, ['--agent=Explore,gap-analyzer']);
  assert.equal(claude.stdout, 'Explore: model haiku, effort low — source: project agents.Explore, preset scout\n'
    + 'gap-analyzer: model sonnet, effort omit — source: project agents.gap-analyzer, tier standard\n');
  const copilot = dispatch(run, ['--agent=explore,gap-analyzer'], { host: 'copilot' });
  assert.equal(copilot.stdout, 'explore: model gpt-6-luna, effort low — source: project agents.Explore, preset scout\n'
    + 'gap-analyzer: model claude-sonnet-5.5, effort omit — source: project agents.gap-analyzer, tier standard\n');
});

test('a built-in agent type matches whatever its case, and a plugin prefix is read past', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    explore: { tier: light }\n    general-Purpose: { tier: deep }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'Explore'), 'Explore: model haiku, effort high — source: project agents.explore, tier light');
  assert.equal(lineOf(run, 'GENERAL-PURPOSE'), 'GENERAL-PURPOSE: model opus, effort omit — source: project agents.general-Purpose, tier deep');
  assert.equal(lineOf(run, 'maister:task-classifier'), 'maister:task-classifier: model haiku, effort high — source: shipped agents.task-classifier, tier light');
  // A name that is no built-in matches only as spelled.
  assert.equal(lineOf(run, 'Task-Classifier'), 'Task-Classifier: model omit, effort omit — source: shipped default');
});

test('a project remaps a rung cell by cell', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  tiers:\n    standard: { claude: fable, effort: medium }\n  default: { tier: standard }\n');
  freezeRun(run);
  assert.equal(lineOf(run, 'gap-analyzer'), 'gap-analyzer: model fable, effort medium — source: project default, tier standard');
  assert.equal(lineOf(run, 'gap-analyzer', [], { host: 'copilot' }), 'gap-analyzer: model claude-sonnet-5.5, effort medium — source: project default, tier standard');
});

// ---------------------------------------------------------------------------
// the plan tier: clamp and budget
// ---------------------------------------------------------------------------

const POLICY = [
  'subagents:',
  '  agents:',
  '    task-group-implementer:',
  '      choose: by-plan-tier',
  '      allowed: [standard, deep]',
  '      unassessed: standard',
  '      ceiling: standard',
  '      budget: { standard: 2 }',
  '',
].join('\n');

test('the plan tier is clamped to the cheapest allowed rung at or above it, never past the ceiling', t => {
  const run = scratch(t);
  config(run, POLICY);
  freezeRun(run);
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=light']),
    'task-group-implementer: model sonnet, effort omit — source: plan tier light, clamped to standard within project agents.task-group-implementer');
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=deep']),
    'task-group-implementer: model sonnet, effort omit — source: plan tier deep, clamped to standard within project agents.task-group-implementer');
  assert.equal(lineOf(run, 'task-group-implementer', ['--tier=standard']),
    'task-group-implementer: model sonnet, effort omit — source: plan tier standard within project agents.task-group-implementer');
  // No plan tier: the group is unassessed.
  assert.equal(lineOf(run, 'task-group-implementer'),
    'task-group-implementer: model sonnet, effort omit — source: project agents.task-group-implementer, unassessed: standard');
});

test('the budget counts the groups the work log records on the rung, and says when to ask', t => {
  const run = scratch(t);
  config(run, POLICY);
  freezeRun(run);
  const log = path.join(run.dir, 'implementation', 'work-log.md');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, '## 2026-01-05 10:00 - Group 1 Complete (wave 1)\n**Model**: sonnet (tier standard, planner: "one layer")\n'
    + '## 2026-01-05 10:05 - Group 2 Complete (wave 1)\n**Model**: haiku (tier light, planner: "copy a pattern")\n');
  const under = dispatch(run, ['--agent=task-group-implementer', '--tier=standard']);
  assert.equal(under.stdout.split('\n').slice(1).join('\n'), '\nnote: task-group-implementer budget: 1 of 2 groups on standard used in this run\n');

  fs.appendFileSync(log, '## 2026-01-05 10:10 - Group 3 Complete (wave 2)\n- **Model**: sonnet (tier standard, planner: "new behaviour")\n');
  const reached = dispatch(run, ['--agent=task-group-implementer', '--tier=light']);
  assert.equal(reached.stdout.split('\n').slice(1).join('\n'),
    '\nnote: task-group-implementer budget: 2 of 2 groups on standard used in this run — ask before dispatching another group on standard\n');

  // A rung the policy does not budget prints no note.
  const unbudgeted = scratch(t);
  config(unbudgeted, POLICY.replace('budget: { standard: 2 }', 'budget: { deep: 1 }'));
  freezeRun(unbudgeted);
  assert.equal(dispatch(unbudgeted, ['--agent=task-group-implementer', '--tier=standard']).stdout,
    'task-group-implementer: model sonnet, effort omit — source: plan tier standard within project agents.task-group-implementer\n');
});

test('the budget counts the entries group-done writes, in the executor\'s own spelling', t => {
  const run = scratch(t);
  config(run, POLICY.replace('allowed: [standard, deep]', 'allowed: [light, standard, deep]')
    .replace('ceiling: standard', 'ceiling: deep').replace('budget: { standard: 2 }', 'budget: { deep: 1 }'));
  freezeRun(run);
  const dir = path.join(run.dir, 'implementation');
  fs.mkdirSync(dir, { recursive: true });
  const plan = path.join(dir, 'implementation-plan.md');
  const entry = path.join(dir, '.work-log-entry.md');
  fs.writeFileSync(plan, '# Implementation Plan\n\n### Task Group 1: Schema\n\n- [ ] 1.1 Migrate\n\n'
    + '### Task Group 2: Export\n\n- [ ] 2.1 Add the column\n');
  fs.writeFileSync(path.join(dir, 'work-log.md'), '# Work Log\n');
  const engine = (args, env) => verb(args, undefined, { CLAUDE_PROJECT_DIR: run.root, ...env });

  assert.equal(engine(['wave-start', `--plan=${plan}`, '--wave=1', '--groups=1,2']).code, 0);
  // Group 1 escalated from standard to deep; group 2 ran on light. The Escalated line and the
  // closing Models tally name rungs too, and neither may count as a group.
  fs.writeFileSync(entry, '## Group 1\n**Model**: opus (tier deep, planner: "a schema change")\n'
    + '**Escalated**: standard (sonnet) → deep (opus) after: the migration test kept failing\n**Steps**: 1.1 completed\n'
    + '## Group 2\n**Model**: haiku (tier light, planner: "copies the existing export")\n**Steps**: 2.1 completed\n');
  const done = engine(['group-done', `--plan=${plan}`, '--groups=1,2', `--entry-file=${entry}`]);
  assert.equal(done.code, 0, done.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'work-log.md'), 'utf8'), /Group 1 Complete \(wave 1\)\n\n\*\*Model\*\*: opus \(tier deep/);
  fs.appendFileSync(path.join(dir, 'work-log.md'), '\n## 2026-01-05T11:00:00Z - Implementation Complete\n\n**Models**: light 1, deep 1, escalations 1\n');

  const deep = dispatch(run, ['--agent=task-group-implementer', '--tier=deep']);
  assert.equal(deep.code, 0, deep.stderr);
  assert.equal(deep.stdout, 'task-group-implementer: model opus, effort omit — source: plan tier deep within project agents.task-group-implementer\n\n'
    + 'note: task-group-implementer budget: 1 of 1 groups on deep used in this run — ask before dispatching another group on deep\n');
});

// ---------------------------------------------------------------------------
// the two modes
// ---------------------------------------------------------------------------

test('standalone, the verb reads config.yml from the project root, with no workflow or node scope', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    code-reviewer: { tier: deep, effort: high }\n  workflows:\n    development:\n      agents: { code-reviewer: { tier: light } }\n');
  const result = dispatch(run, ['--agent=code-reviewer'], { state: false });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'code-reviewer: model opus, effort high — source: project agents.code-reviewer, tier deep\n');
  assert.equal(result.stderr, '');
});

test('standalone, a refused block falls back to the shipped defaults with a warning', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  default: { tier: huge }\n');
  const result = dispatch(run, ['--agent=task-classifier,code-reviewer'], { state: false });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'task-classifier: model haiku, effort high — source: shipped agents.task-classifier, tier light\n'
    + 'code-reviewer: model omit, effort omit — source: shipped default\n');
  assert.match(result.stderr, /^warning: subagents-error:\.maister\/config\.yml:subagents\.default\.tier — .*; the whole subagents block is refused and the shipped defaults apply\n$/);
});

test('with no config at all the verb answers from the shipped defaults, standalone and in a run', t => {
  const run = scratch(t);
  assert.equal(lineOf(run, 'docs-operator', [], { state: false }), 'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light');
  freezeRun(run);
  const result = dispatch(run, ['--agent=docs-operator']);
  assert.equal(result.stdout, 'docs-operator: model haiku, effort high — source: shipped agents.docs-operator, tier light\n');
});

test('a config.yml changed since the freeze adds one note, and the run keeps what it froze', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    gap-analyzer: { tier: light }\n');
  freezeRun(run);
  assert.equal(dispatch(run, ['--agent=gap-analyzer']).stdout, 'gap-analyzer: model haiku, effort high — source: project agents.gap-analyzer, tier light\n');

  config(run, 'html_output: false\nsubagents:\n  agents:\n    gap-analyzer: { tier: deep }\n');
  const changed = dispatch(run, ['--agent=gap-analyzer,code-reviewer']);
  assert.equal(changed.stdout, 'gap-analyzer: model haiku, effort high — source: project agents.gap-analyzer, tier light\n'
    + 'code-reviewer: model omit, effort omit — source: shipped default\n'
    + '\n'
    + "note: .maister/config.yml's subagents block changed since this run started; this run keeps the settings it froze, and the edits apply to the next run\n");

  // Removing the block is a change too; a run frozen with none notes a block added later.
  fs.rmSync(path.join(run.root, '.maister', 'config.yml'));
  assert.match(dispatch(run, ['--agent=gap-analyzer']).stdout, /subagents block changed since this run started/);
  const bare = scratch(t);
  freezeRun(bare);
  assert.doesNotMatch(dispatch(bare, ['--agent=gap-analyzer']).stdout, /note:/);
  config(bare, 'subagents:\n  default: { tier: light }\n');
  assert.match(dispatch(bare, ['--agent=gap-analyzer']).stdout, /subagents block changed since this run started/);
});

// ---------------------------------------------------------------------------
// usage and refusals
// ---------------------------------------------------------------------------

test('usage errors exit 2 and print nothing', t => {
  const run = scratch(t);
  freezeRun(run);
  for (const [args, host, message] of [
    [['--agent=x'], null, /dispatch-model needs --host=claude or --host=copilot/],
    [['--agent=x'], 'codex', /--host is claude or copilot, not "codex"/],
    [[], 'claude', /dispatch-model needs --agent/],
    [['--agent=x', '--tier=huge'], 'claude', /--tier is light, standard or deep, not "huge"/],
  ]) {
    const result = dispatch(run, args, { host });
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
  }
  const standalone = dispatch(run, ['--agent=x', '--node=analysis'], { state: false });
  assert.equal(standalone.code, 2);
  assert.match(standalone.stderr, /dispatch-model takes --node only with --state/);
});

test('a node the run does not carry and a state that is no run are refused', t => {
  const run = scratch(t);
  freezeRun(run);
  const unknown = dispatch(run, ['--agent=Explore', '--node=nowhere']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /^dispatch-model-unknown-node: nowhere is not a node of this run/);

  const bare = scratch(t);
  fs.writeFileSync(bare.state, 'task:\n  title: x\n');
  const notRun = dispatch(bare, ['--agent=Explore']);
  assert.equal(notRun.code, 1);
  assert.match(notRun.stderr, /^dispatch-model-not-a-run:/);
});
