import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The agents a workflow node delegates its artifact to return a structured
// result whose `headline:` the node's closing summary carries, under the same
// 220-character contract as a summary headline. The creator and the planner
// check their own coverage, and the two agents a migration run points at a
// path of its own take that path as an `output_path` input.

const AGENTS = path.join(ROOT, 'plugins/maister/agents');

const HEADLINED = [
  'gap-analyzer',
  'specification-creator',
  'spec-auditor',
  'implementation-planner',
  'user-docs-generator',
  'bottleneck-analyzer',
  'research-synthesizer',
  'solution-brainstormer',
  'solution-designer',
  'codebase-analysis-reporter',
];

const AGENT_LINE_LIMIT = 450;

function agent(name) {
  return fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
}

// The first fenced yaml block after the last heading that opens with Output or
// names a Structured Result: the result the agent hands back to its caller.
function structuredResult(text) {
  const lines = text.split('\n');
  let heading = -1;
  lines.forEach((line, i) => {
    if (/^#{2,4} (Output\b|.*Structured (Result|Output))/.test(line)) heading = i;
  });
  if (heading < 0) return null;
  const open = lines.findIndex((line, i) => i > heading && /^```yaml\s*$/.test(line));
  if (open < 0) return null;
  const close = lines.findIndex((line, i) => i > open && /^```\s*$/.test(line));
  return lines.slice(open + 1, close < 0 ? undefined : close).join('\n');
}

test('each artifact agent returns a headline under the 220-character contract', () => {
  for (const name of HEADLINED) {
    const block = structuredResult(agent(name));
    assert.ok(block, `${name} has a fenced structured result under its Output section`);
    const line = block.split('\n').find((l) => /^headline:/.test(l));
    assert.ok(line, `${name} returns headline:`);
    assert.match(line, /#.*\b220\b/, `${name} comments the headline's 220-character limit`);
  }
  const skill = fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/codebase-analyzer/SKILL.md'), 'utf8');
  assert.match(skill, /^headline:.*relayed/m, 'the codebase-analyzer skill relays the reporter headline');
});

test('the auditor, the docs generator and the bottleneck analyzer return a minimal result', () => {
  const owed = {
    'spec-auditor': ['status', 'headline', 'report_path', 'warnings', 'verdict'],
    'user-docs-generator': ['status', 'headline', 'report_path', 'warnings'],
    'bottleneck-analyzer': ['status', 'headline', 'report_path', 'warnings'],
  };
  for (const [name, fields] of Object.entries(owed)) {
    const block = structuredResult(agent(name));
    assert.ok(block, `${name} has a structured result`);
    for (const field of fields) {
      assert.match(block, new RegExp(`^${field}:`, 'm'), `${name} returns ${field}`);
    }
  }
});

test('the creator and the planner check their own requirement coverage', () => {
  const creator = agent('specification-creator');
  const coverage = creator.split(/^### Phase 4: Coverage/m)[1]?.split(/^##/m)[0] ?? '';
  assert.match(coverage, /story id/i, 'the creator covers every story id');
  assert.match(coverage, /numbered functional requirement/i, 'the creator covers every numbered FR');
  assert.match(coverage, /`warnings`/, 'the creator routes an uncovered one to warnings');

  const planner = agent('implementation-planner');
  const plannerCoverage = planner.split(/^### Phase [\d.]+: Requirement Coverage/m)[1]?.split(/^##/m)[0] ?? '';
  assert.match(plannerCoverage, /Core Requirement/, 'the planner covers every Core Requirement id');
  assert.match(plannerCoverage, /`warnings`/, 'the planner routes an uncovered one to warnings');
});

test('the gap analyzer and the docs generator take an output_path with today\'s default', () => {
  const defaults = {
    'gap-analyzer': 'analysis/gap-analysis.md',
    'user-docs-generator': 'documentation/user-guide.md',
  };
  for (const [name, file] of Object.entries(defaults)) {
    const row = agent(name).split('\n').find((l) => /^\|\s*`output_path`\s*\|/.test(l));
    assert.ok(row, `${name} has an output_path input row`);
    assert.ok(row.includes(file), `${name}'s output_path defaults to ${file}`);
  }
});

test('no headlined agent declares tools, and each stays within the agent length target', (t) => {
  for (const name of HEADLINED) {
    const text = agent(name);
    const front = text.split(/^---$/m)[1];
    assert.doesNotMatch(front, /^tools:/m, `${name} declares no tools:`);
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    if (lines > AGENT_LINE_LIMIT) t.diagnostic(`warning: ${name} is ${lines} lines, over ${AGENT_LINE_LIMIT}`);
  }
});
