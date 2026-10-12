import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// Every agent that writes an HTML companion takes the run context's `html:`
// line as its one input for it, and says what became of the companion in a
// structured `companion:` field. An absent line is never read as "off": the
// agent writes the markdown, returns `not-requested` and warns, so the caller
// can re-delegate with the run context instead of losing the companion quietly.

const AGENTS = path.join(ROOT, 'plugins/maister/agents');

const WRITERS = [
  'research-synthesizer',
  'solution-designer',
  'solution-brainstormer',
  'specification-creator',
  'implementation-planner',
  'html-companion-writer',
  'e2e-test-verifier',
];

function agent(name) {
  return fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
}

test('every companion writer takes the run context html row and no style guide path', () => {
  for (const name of WRITERS) {
    const text = agent(name);
    assert.match(text, /^\|\s*`html`\s*\|[^\n]*run-context[^\n]*\|[^\n]*`html: off`/m, `${name} has the shared html input row`);
    assert.doesNotMatch(text, /html_style_guide_path/, `${name} no longer names html_style_guide_path`);
  }
});

test('every companion writer states the three non-written outcomes and returns companion', () => {
  for (const name of WRITERS) {
    const text = agent(name);
    for (const status of ['not-requested', 'disabled', 'failed']) {
      assert.match(text, new RegExp(`companion: ${status}`), `${name} states companion: ${status}`);
    }
    assert.match(text, /^\s*companion:\s*"?written/m, `${name} returns a companion field in its structured result`);
    assert.match(text, /never read the absence as off/, `${name} never treats a missing html line as off`);
  }
});

test('e2e-test-verifier returns its verdict and companions in a structured result', () => {
  const text = agent('e2e-test-verifier');
  for (const field of ['status', 'verdict', 'report_path', 'fidelity_path', 'counts', 'companion', 'html_paths', 'warnings']) {
    assert.match(text, new RegExp(`^\\s*${field}:`, 'm'), `structured result carries ${field}`);
  }
  assert.match(text, /e2e-verification-report\.html` \(when its md exists\)/);
  assert.doesNotMatch(text, /e2e-verification-report\.html` \(always\)/);
});

test('no companion writer declares a tools list', () => {
  for (const name of WRITERS) {
    const front = agent(name).split(/^---$/m)[1];
    assert.doesNotMatch(front, /^tools:/m, `${name} declares no tools:`);
  }
});
