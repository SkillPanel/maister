import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';
import { SOURCES } from '../../plugins/maister/skills/workflow-engine/scripts/lib/findings-merge.mjs';

// The reviewers' contract, the agents that follow it and the merge that reads
// their files name each findings file by one stem. A stem spelled two ways is
// a reviewer whose findings the merge never reads, so the three are held to
// one list here.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const CONTRACT = fs.readFileSync(path.join(PLUGIN, 'skills/implementation-verifier/references/review-findings.md'), 'utf8');
const agentText = agent => fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8');

// The panel, and the test-suite runner whose findings file carries the tests and the checks.
const REVIEWERS = {
  'spec-conformance-review': 'spec',
  'code-risk-review': 'code-risk',
  'simplicity-review': 'simplicity',
};
const AGENTS = { ...REVIEWERS, 'test-suite-runner': 'test-suite' };

test('review contract: every reviewer\'s stem is in the contract\'s table, in its agent and in the merge\'s source map', () => {
  for (const [agent, stem] of Object.entries(AGENTS)) {
    assert.match(CONTRACT, new RegExp(`\\| ${agent} \\| \`${stem}\` \\|`), `${agent} → ${stem} in the contract`);
    assert.ok(agentText(agent).includes(`verification/${stem}-findings.json`), `${agent} writes verification/${stem}-findings.json`);
    assert.ok(Object.hasOwn(SOURCES, stem), `the merge maps ${stem} to a source`);
  }
  assert.deepEqual(Object.keys(SOURCES).filter(stem => stem !== 'artifacts').sort(), Object.values(AGENTS).sort());
});

test('review contract: the five reviewers the panel replaced are gone, agents and commands alike', () => {
  for (const agent of ['implementation-completeness-checker', 'code-reviewer', 'code-quality-pragmatist', 'production-readiness-checker', 'reality-assessor']) {
    assert.ok(!fs.existsSync(path.join(PLUGIN, 'agents', `${agent}.md`)), `${agent} is removed`);
  }
  for (const command of ['reviews-code', 'reviews-pragmatic', 'reviews-production-readiness', 'reviews-reality-check']) {
    assert.ok(!fs.existsSync(path.join(PLUGIN, 'commands', `${command}.md`)), `${command} is removed`);
  }
  for (const [command, agent] of [['reviews-spec', 'spec-conformance-review'], ['reviews-code-risk', 'code-risk-review'], ['reviews-simplicity', 'simplicity-review']]) {
    const text = fs.readFileSync(path.join(PLUGIN, 'commands', `${command}.md`), 'utf8');
    assert.match(text, new RegExp(`subagent_type: "maister:${agent}"`), `${command} dispatches ${agent}`);
  }
});

test('review contract: the verification loop hands every prompt the brief and merges through the engine', () => {
  const loop = agentText('verification-runner');
  assert.match(loop, /review-brief --state=/);
  assert.match(loop, /--refresh/);
  assert.match(loop, /findings-merge --state=/);
  assert.match(loop, /\*\*Every reviewer prompt carries `review_brief: <the printed path>`\.\*\*/);
  assert.match(loop, /`findings-merge --state=<state>`\. It also records the cycle's `issues_found` in\s+`verification_context`/);
});

test('review contract: the hand-off asks runner-step before every move and dispatches the runner in the foreground', () => {
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills/implementation-verifier/SKILL.md'), 'utf8');
  assert.match(skill, /workflow\.mjs runner-step --state=/);
  assert.match(skill, /\*\*`run_in_background: false`, set explicitly on every host\.\*\*/);
  assert.match(skill, /subagent_type: maister:verification-runner/);
  assert.doesNotMatch(skill, /findings-merge --state=/, 'the loop is the runner\'s, not copied into the hand-off');
});

test('review contract: the runner sends all three reviews with the brief alone, and writes them no prompt', () => {
  const loop = agentText('verification-runner');
  for (const agent of Object.keys(REVIEWERS)) assert.ok(loop.includes(`\`maister:${agent}\``), `the runner dispatches ${agent}`);
  assert.match(loop, /Nobody writes the reviewers a prompt for the change/);
  assert.doesNotMatch(loop, /review-prompts\.md/, 'no prompts file');
  assert.doesNotMatch(loop, /_enabled\b/, 'no review is switched off by an option');
  assert.match(loop, /An `info` issue is listed in the report and never fixed, unless a person chooses its fix/);
});

test('review contract: reviewers review the range; nothing points them at a patch file, a matched standards list or a runner prompt', () => {
  assert.match(CONTRACT, /\*\*Review the range; read as your review needs\.\*\* The change under review is `base` to the\s+working tree/);
  assert.match(CONTRACT, /\*\*Nobody writes you a prompt for the change\.\*\*/);
  assert.match(CONTRACT, /"outside_change": true`; it counts toward the verdict only when it is `critical`/);
  assert.match(CONTRACT, /A deviation a recorded decision covers is\s+not a finding/);
  for (const agent of Object.keys(REVIEWERS)) {
    const text = agentText(agent);
    assert.doesNotMatch(text, /diff_path|brief's `standards`|the matching standards|Your prompt comes first/, `${agent} reads no patch file, matched standards or runner prompt`);
    assert.match(text, /Nobody writes you a prompt for this change/, `${agent} works from the documents`);
    assert.match(text, /outside_change/, `${agent} marks a defect outside the change`);
    assert.match(text, /## Re-check mode/, `${agent} supports re-check mode`);
    assert.match(text, /Without a brief/, `${agent} has a standalone path for its command`);
  }
});

test('review contract: code risk takes its standards from INDEX.md and the run\'s claims together, and owns CI and operational hygiene', () => {
  const risk = agentText('code-risk-review');
  assert.match(risk, /\*\*Standards, from two sources\.\*\*/);
  assert.match(risk, /one full read of\s+`\.maister\/docs\/INDEX\.md`/);
  assert.match(risk, /never decide by matching words in paths/);
  assert.match(risk, /A relevant standard the code follows is not a finding,\s+claimed or not/);
  assert.match(risk, /\*\*CI and build:\*\*/);
  assert.match(risk, /Checkout depth/);
  assert.match(risk, /\*\*Operational hygiene, as the profile needs it\.\*\*/);
  for (const agent of Object.keys(REVIEWERS)) assert.doesNotMatch(agentText(agent), /docs-check/, `${agent} runs no docs index check`);
});

test('review contract: spec conformance writes down the rules first, then stories, claims and docs the change made false', () => {
  const spec = agentText('spec-conformance-review');
  assert.match(spec, /\*\*Write down the rules, quoted\.\*\*/);
  assert.match(spec, /the rule its sibling operation has/);
  assert.match(spec, /\*\*Claims against evidence\.\*\*/);
  assert.match(spec, /\*\*Docs the change made false\.\*\*/);
  assert.match(spec, /follow its main path through the code from the user's action/);
});

// Spec conformance and simplicity ask about the change against its spec and
// its scale, so they read narrowly; code risk and the test-suite runner look at
// the environment the change runs in, so they read freely.
test('review contract: spec conformance and simplicity read narrowly; code risk and the test-suite runner read freely', () => {
  assert.match(CONTRACT, /\*\*The code risk review and the test-suite runner read freely:\*\*/);
  assert.match(CONTRACT, /\*\*The spec conformance review and the simplicity review read narrowly:\*\*/);
  assert.match(CONTRACT, /not the environment it runs in/);
  assert.match(agentText('code-risk-review'), /\*\*Review the range; read freely\.\*\*/);
  assert.match(agentText('simplicity-review'), /\*\*Review the range; read narrowly\.\*\*/);
  assert.match(agentText('spec-conformance-review'), /Not history, CI or unrelated modules/);
});

test('review contract: the test-suite runner runs the project\'s other checks and the brief carries them', () => {
  const runner = agentText('test-suite-runner');
  assert.match(runner, /\*\*The other checks\.\*\*/);
  assert.match(runner, /run the other checks anyway/);
  assert.match(runner, /Add the `checks` list/);
  assert.match(CONTRACT, /\*\*`checks`\*\*: the project's other checks/);
});
