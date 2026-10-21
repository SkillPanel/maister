import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SAMPLE, freezePatch, readState, scratch, verb } from '../helpers.mjs';

// The `subagents` block: read from the project's `.maister/config.yml`, an
// overlay and its selected profile at the freeze, judged, and recorded under
// `orchestrator.options.subagents`. A block with an error is refused whole and
// the shipped defaults apply; every finding is a warning, in `validate` as at
// the freeze, so none of them stops a run.

const SUBAGENTS_NOTE = "note: ignored the supplied orchestrator.options.subagents; the freeze records it from the project's config.yml, the overlays and the profile, so no patch sets it\n";

/** Write the project's config.yml under the run's root. */
function config(run, text) {
  const file = path.join(run.root, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Write an overlay of the sample definition into the scratch project; returns its path. */
function overlay(run, text, name = 'development.overlay.yml') {
  const file = path.join(run.root, '.maister', 'workflows', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `extends: development\nversion: 1\n${text}`);
  return file;
}

/** Freeze the sample into the run, with the project root as the engine's own. */
function freezeRun(run, options = {}) {
  const { patch } = freezePatch(options);
  const result = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
  return result;
}

/** `validate` of the sample with these overlays, from the project root. */
function validate(run, overlays = [], profile = null) {
  const args = ['validate', `--definition=${SAMPLE}`, ...overlays.map(file => `--overlay=${file}`)];
  if (profile) args.push(`--profile=${profile}`);
  const result = verb(args, undefined, { CLAUDE_PROJECT_DIR: run.root });
  return { ...result, report: JSON.parse(result.stdout) };
}

const subagentsOf = run => readState(run).orchestrator.options?.subagents;
const warningsOf = stderr => stderr.split('\n').filter(line => line.startsWith('warning: subagents-')).map(line => line.slice('warning: '.length));

test('a project with no subagents block freezes exactly the keys it always did', t => {
  const run = scratch(t);
  config(run, 'html_output: true\n');
  const result = freezeRun(run);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(fs.readFileSync(run.state, 'utf8'), /subagents/);
  assert.deepEqual(validate(run).report.warnings.filter(each => each.startsWith('subagents-')), []);
});

test('the freeze copies the project block into orchestrator.options.subagents, beside the rest of the file', t => {
  const run = scratch(t);
  config(run, [
    'html_output: true',
    'subagents:',
    '  tiers:',
    '    light: { claude: haiku, copilot: gpt-6-luna }',
    '  presets:',
    '    scout: { claude: haiku, copilot: gpt-6-luna, effort: low }',
    '  default: { tier: standard }',
    '  agents:',
    '    Explore: { preset: scout }',
    '    spec-auditor: { model: opus, effort: high }',
    '    task-group-implementer:',
    '      choose: by-plan-tier',
    '      allowed: [light, standard, deep]',
    '      unassessed: standard',
    '      ceiling: deep',
    '      budget: { deep: 3 }',
    '  workflows:',
    '    development:',
    '      nodes:',
    '        analysis: { agents: { Explore: { tier: standard } } }',
    'notes: |',
    '  a block scalar the engine reader refuses, outside the subagents key',
    '',
  ].join('\n'));
  const result = freezeRun(run);
  assert.deepEqual(warningsOf(result.stderr), []);
  assert.deepEqual(subagentsOf(run), {
    tiers: { light: { claude: 'haiku', copilot: 'gpt-6-luna' } },
    presets: { scout: { claude: 'haiku', copilot: 'gpt-6-luna', effort: 'low' } },
    default: { tier: 'standard' },
    agents: {
      Explore: { preset: 'scout' },
      'spec-auditor': { model: 'opus', effort: 'high' },
      'task-group-implementer': { choose: 'by-plan-tier', allowed: ['light', 'standard', 'deep'], unassessed: 'standard', ceiling: 'deep', budget: { deep: 3 } },
    },
    workflows: { development: { nodes: { analysis: { agents: { Explore: { tier: 'standard' } } } } } },
  });
});

test('an overlay and its selected profile carry subagents, kept apart from the project block', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents:\n    gap-analyzer: { tier: light }\n');
  const file = overlay(run, [
    'subagents:',
    '  agents:',
    '    gap-analyzer: { tier: standard }',
    'profiles:',
    '  premium:',
    '    subagents:',
    '      agents:',
    '        gap-analyzer: { tier: deep }',
    '',
  ].join('\n'));
  assert.deepEqual(validate(run, [file], 'premium').report.warnings, []);
  freezeRun(run, { overlays: [file], profile: 'premium' });
  assert.deepEqual(subagentsOf(run), {
    agents: { 'gap-analyzer': { tier: 'light' } },
    overlay: { agents: { 'gap-analyzer': { tier: 'standard' } } },
    profile: { agents: { 'gap-analyzer': { tier: 'deep' } } },
  });

  // Without the profile selected, only the overlay's block is recorded beside the project's.
  const plain = scratch(t);
  config(plain, 'subagents:\n  agents:\n    gap-analyzer: { tier: light }\n');
  const own = overlay(plain, 'subagents:\n  agents:\n    gap-analyzer: { tier: standard }\nprofiles:\n  premium:\n    subagents: { agents: { gap-analyzer: { tier: deep } } }\n');
  freezeRun(plain, { overlays: [own] });
  assert.equal(Object.hasOwn(subagentsOf(plain), 'profile'), false);
  assert.deepEqual(subagentsOf(plain).overlay, { agents: { 'gap-analyzer': { tier: 'standard' } } });
});

test('a patch never sets options.subagents, at the freeze or after it', t => {
  const run = scratch(t);
  const result = freezeRun(run, { orchestrator: { options: { subagents: { default: { tier: 'deep' } } } } });
  assert.equal(result.stderr, SUBAGENTS_NOTE);
  assert.equal(subagentsOf(run), undefined);

  const later = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { subagents: { default: { tier: 'deep' } }, html_output: false } } });
  assert.equal(later.code, 0, later.stderr);
  assert.equal(later.stderr, SUBAGENTS_NOTE);
  assert.equal(subagentsOf(run), undefined);
  assert.equal(readState(run).orchestrator.options.html_output, false);
});

/** Each error, with the block that provokes it and the path it is reported at. */
const ERRORS = [
  ['a Claude Code alias in a Copilot cell', '  tiers:\n    light: { claude: haiku, copilot: haiku }\n', 'subagents.tiers.light.copilot', /is a Claude Code alias, which Copilot takes without a word and replaces/],
  ['an alias in a preset\'s Copilot cell', '  presets:\n    scout: { copilot: sonnet }\n', 'subagents.presets.scout.copilot', /is a Claude Code alias/],
  ['a full model id in a Claude Code cell', '  tiers:\n    deep: { claude: claude-opus-5-5 }\n', 'subagents.tiers.deep.claude', /is not a model a Claude Code call takes: write one of haiku, sonnet, opus, fable or inherit/],
  ['a full model id pinned for an agent', '  agents:\n    spec-auditor: { model: claude-opus-5-5 }\n', 'subagents.agents.spec-auditor.model', /is not a model a Claude Code call takes/],
  ['a rung the ladder does not carry', '  tiers:\n    huge: { claude: opus }\n', 'subagents.tiers.huge', /"huge" is not a tier/],
  ['an entry naming an unknown tier', '  agents:\n    gap-analyzer: { tier: medium }\n', 'subagents.agents.gap-analyzer.tier', /"medium" is not a tier/],
  ['an entry naming an unknown preset', '  agents:\n    gap-analyzer: { preset: scout }\n', 'subagents.agents.gap-analyzer.preset', /"scout" is not a preset: no presets are defined/],
  ['a bad effort', '  agents:\n    gap-analyzer: { tier: light, effort: extreme }\n', 'subagents.agents.gap-analyzer.effort', /"extreme" is not an effort: expected one of low, medium, high, xhigh, max/],
  ['allowed outside the ladder', '  agents:\n    task-group-implementer: { choose: by-plan-tier, allowed: [light, huge] }\n', 'subagents.agents.task-group-implementer.allowed', /allowed lists rungs of the ladder/],
  ['a ceiling outside the ladder', '  agents:\n    task-group-implementer: { choose: by-plan-tier, ceiling: top }\n', 'subagents.agents.task-group-implementer.ceiling', /"top" is not a tier/],
  ['a budget that is not a count', '  agents:\n    task-group-implementer: { choose: by-plan-tier, budget: { deep: many } }\n', 'subagents.agents.task-group-implementer.budget', /budget maps a rung of the ladder to a whole number/],
  ['an entry picking its model two ways', '  agents:\n    gap-analyzer: { tier: light, model: opus }\n', 'subagents.agents.gap-analyzer', /picks its model one way/],
  ['a block that is not a mapping', '  - light\n', 'subagents', /the subagents block is a mapping/],
];

for (const [label, body, at, message] of ERRORS) {
  test(`refused whole, the shipped defaults applying: ${label}`, t => {
    const run = scratch(t);
    config(run, `subagents:\n${body}`);
    const expected = new RegExp(`^subagents-error:\\.maister/config\\.yml:${at.replace(/\./g, '\\.')} — .*; the whole subagents block is refused and the shipped defaults apply$`);

    const report = validate(run).report;
    assert.equal(report.ok, true, 'a refused block never stops a run');
    const found = report.warnings.filter(each => each.startsWith('subagents-error:'));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], expected);
    assert.match(found[0], message);

    const result = freezeRun(run);
    assert.deepEqual(warningsOf(result.stderr).filter(each => each.startsWith('subagents-error:')), found);
    assert.equal(subagentsOf(run), undefined, 'nothing is frozen, so the shipped defaults apply');
  });
}

test('tiers in an overlay or a profile refuse the block', t => {
  const run = scratch(t);
  const file = overlay(run, 'subagents:\n  tiers:\n    light: { claude: sonnet }\nprofiles:\n  quick:\n    subagents: { tiers: { deep: { claude: sonnet } } }\n');
  const warnings = validate(run, [file]).report.warnings.filter(each => each.startsWith('subagents-error:'));
  assert.deepEqual(warnings.map(each => each.split(' — ')[0]), [
    'subagents-error:.maister/workflows/development.overlay.yml:subagents.tiers',
    'subagents-error:.maister/workflows/development.overlay.yml:profiles.quick.subagents.tiers',
  ]);
  freezeRun(run, { overlays: [file] });
  assert.equal(subagentsOf(run), undefined);
});

test('a block the reader cannot parse is refused whole', t => {
  const run = scratch(t);
  config(run, 'subagents:\n  agents: &anchor\n    gap-analyzer: { tier: light }\n');
  const warnings = validate(run).report.warnings;
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^subagents-error:\.maister\/config\.yml:.* the whole subagents block is refused and the shipped defaults apply$/);
  const result = freezeRun(run);
  assert.deepEqual(warningsOf(result.stderr), warnings);
  assert.equal(subagentsOf(run), undefined);
});

test('an unknown agent, a premium Copilot model and an unknown key warn, and the block still freezes', t => {
  const run = scratch(t);
  config(run, [
    'subagents:',
    '  tiers:',
    '    deep: { claude: opus, copilot: claude-opus-5.5 }',
    '  agents:',
    '    no-such-agent: { tier: light }',
    '    explore: { tier: light, colour: red }',
    '    general-purpose: { tier: standard }',
    '    Plan: { tier: standard }',
    '  shade: dark',
    '',
  ].join('\n'));
  const warnings = validate(run).report.warnings;
  assert.deepEqual(warnings.map(each => each.split(' — ')[0]), [
    'subagents-premium-model:.maister/config.yml:subagents.tiers.deep.copilot',
    'subagents-unknown-agent:.maister/config.yml:subagents.agents.no-such-agent',
    'subagents-unknown-key:.maister/config.yml:subagents.agents.explore.colour',
    'subagents-unknown-key:.maister/config.yml:subagents.shade',
  ]);
  assert.match(warnings[0], /claude-opus-5\.5 costs 15× per request on Copilot; add premium: true/);

  const result = freezeRun(run);
  assert.deepEqual(warningsOf(result.stderr), warnings);
  const frozen = subagentsOf(run);
  assert.deepEqual(frozen.agents.explore, { tier: 'light' }, 'an unknown key is dropped from the copy');
  assert.equal(Object.hasOwn(frozen, 'shade'), false);

  // `premium: true` beside the cell confirms the cost.
  const confirmed = scratch(t);
  config(confirmed, 'subagents:\n  tiers:\n    deep: { claude: opus, copilot: claude-opus-5.5, premium: true }\n');
  assert.deepEqual(validate(confirmed).report.warnings, []);
});

test('an agent the project provides is known', t => {
  const run = scratch(t);
  fs.mkdirSync(path.join(run.root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(run.root, '.claude', 'agents', 'house-reviewer.md'), '---\nname: house-reviewer\ndescription: reviews\n---\n');
  config(run, 'subagents:\n  agents:\n    house-reviewer: { tier: deep }\n');
  assert.deepEqual(validate(run).report.warnings, []);
});
