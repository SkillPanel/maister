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

const AGENTS = {
  'implementation-completeness-checker': 'completeness',
  'test-suite-runner': 'test-suite',
  'code-reviewer': 'code-review',
  'code-quality-pragmatist': 'pragmatic',
  'production-readiness-checker': 'production-readiness',
  'reality-assessor': 'reality',
};

test('review contract: every reviewer\'s stem is in the contract\'s table, in its agent and in the merge\'s source map', () => {
  for (const [agent, stem] of Object.entries(AGENTS)) {
    assert.match(CONTRACT, new RegExp(`\\| ${agent} \\| \`${stem}\` \\|`), `${agent} → ${stem} in the contract`);
    const text = fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8');
    assert.ok(text.includes(`verification/${stem}-findings.json`), `${agent} writes verification/${stem}-findings.json`);
    assert.ok(text.includes('## Review Brief, Findings File and Re-check'), `${agent} carries the shared section`);
    assert.ok(Object.hasOwn(SOURCES, stem), `the merge maps ${stem} to a source`);
  }
  assert.deepEqual(Object.keys(SOURCES).filter(stem => stem !== 'artifacts').sort(), Object.values(AGENTS).sort());
});

test('review contract: the verification loop hands every prompt the brief and merges through the engine', () => {
  const loop = fs.readFileSync(path.join(PLUGIN, 'agents/verification-runner.md'), 'utf8');
  assert.match(loop, /review-brief --state=/);
  assert.match(loop, /--refresh/);
  assert.match(loop, /findings-merge --state=/);
  assert.match(loop, /\*\*Every reviewer prompt carries `review_brief: <the printed path>`\.\*\*/);
  assert.match(loop, /`issues_found` exactly as the last `findings-merge` printed it/);
});

test('review contract: the hand-off asks runner-step before every move and dispatches the runner in the foreground', () => {
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills/implementation-verifier/SKILL.md'), 'utf8');
  assert.match(skill, /workflow\.mjs runner-step --state=/);
  assert.match(skill, /\*\*`run_in_background: false`, set explicitly on every host\.\*\*/);
  assert.match(skill, /subagent_type: maister:verification-runner/);
  assert.doesNotMatch(skill, /findings-merge --state=/, 'the loop is the runner\'s, not copied into the hand-off');
});

test('review contract: reviewers read freely and review the range; nothing points them at a patch file or a matched standards list', () => {
  assert.match(CONTRACT, /\*\*Read freely; review the range\.\*\* The change under review is `base` to the working tree/);
  assert.match(CONTRACT, /\*\*Your prompt comes first\.\*\*/);
  assert.match(CONTRACT, /"outside_change": true`; it counts toward the verdict only when it is `critical`/);
  assert.match(CONTRACT, /A deviation a recorded decision covers is not a finding/);
  assert.doesNotMatch(CONTRACT, /never work out the scope with `git diff`/);
  for (const agent of Object.keys(AGENTS)) {
    const text = fs.readFileSync(path.join(PLUGIN, 'agents', `${agent}.md`), 'utf8');
    assert.doesNotMatch(text, /diff_path|brief's `standards`|the matching standards/, `${agent} no longer reads a patch file or matched standards`);
    assert.match(text, /\*\*Your prompt first, then the brief\.\*\*/, `${agent} reads its prompt first`);
    assert.match(text, /`outside_change`/, `${agent} marks a defect outside the change`);
  }
});

test('review contract: the runner writes each reviewer a targeted prompt once and re-uses it', () => {
  const loop = fs.readFileSync(path.join(PLUGIN, 'agents/verification-runner.md'), 'utf8');
  assert.match(loop, /`verification\/review-prompts\.md`/);
  for (const part of ['where to look hardest', 'what must hold', 'environment facts', 'what it owns', 'what is decided']) {
    assert.ok(loop.includes(`**${part}**`), `the prompt guidance names ${part}`);
  }
  assert.match(loop, /never where to stop/);
  assert.match(loop, /Standards Compliance sections and the work\s+log's Standards Applied/);
});

test('review contract: standards are judged, claimed ones by the code reviewer, missed ones over INDEX.md by the completeness checker', () => {
  const completeness = fs.readFileSync(path.join(PLUGIN, 'agents/implementation-completeness-checker.md'), 'utf8');
  assert.match(completeness, /\*\*The missed-standards check\*\* — read `\.maister\/docs\/INDEX\.md` once per cycle/);
  assert.match(completeness, /Never decide it by matching words in paths/);
  assert.match(completeness, /\*\*Without INDEX\.md, or with one you cannot read\*\*, skip the check/);
  const reviewer = fs.readFileSync(path.join(PLUGIN, 'agents/code-reviewer.md'), 'utf8');
  assert.match(reviewer, /Check the standards the run claimed against the code/);
  const production = fs.readFileSync(path.join(PLUGIN, 'agents/production-readiness-checker.md'), 'utf8');
  assert.match(production, /### Phase 8: CI and Build/);
  assert.match(production, /\*\*Checkout depth\*\*/);
});
