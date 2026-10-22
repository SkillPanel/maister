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

test('review contract: the verifier hands every prompt the brief and merges through the engine', () => {
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills/implementation-verifier/SKILL.md'), 'utf8');
  assert.match(skill, /review-brief --state=/);
  assert.match(skill, /--refresh/);
  assert.match(skill, /findings-merge --state=/);
  assert.match(skill, /\*\*Every Task prompt of Steps 3a and 3b carries `review_brief: <the printed path>`\.\*\*/);
  assert.match(skill, /`issues_found` the last `findings-merge` printed, copied unchanged/);
});
