import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// Every agent that writes an HTML companion takes the run context's `html:`
// line as an input row, and says what became of the companion in a structured
// `companion:` field the caller reads.

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

test('every companion writer has the run context html input row', () => {
  for (const name of WRITERS) {
    assert.match(agent(name), /^\|\s*`html`\s*\|[^\n]*run-context[^\n]*\|[^\n]*`html: off`/m, `${name} has the shared html input row`);
  }
});

test('every companion writer returns a companion field with each status', () => {
  for (const name of WRITERS) {
    const text = agent(name);
    assert.match(text, /^\s*companion:\s*"?written/m, `${name} returns a companion field in its structured result`);
    // The html-companion-writer is dispatched only to write a page, so a prompt
    // with no style guide path is not a page nobody asked for.
    const statuses = name === 'html-companion-writer' ? ['disabled', 'failed'] : ['not-requested', 'disabled', 'failed'];
    for (const status of statuses) {
      assert.match(text, new RegExp(`companion: ${status}`), `${name} returns companion: ${status}`);
    }
  }
});

test('the html-companion-writer reads the plugin\'s own style guide when the prompt names no path, and never searches for one', () => {
  const text = agent('html-companion-writer');
  assert.ok(text.includes('`<plugin root>/skills/orchestrator-framework/references/html-report-style.md`'), 'it names the guide under the plugin root');
  assert.match(text, /never search for it/);
  assert.doesNotMatch(text, /not-requested/, 'it never returns not-requested');
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/references/html-report-style.md')), 'the guide is where the agent says');
});

test('e2e-test-verifier returns its verdict and companions in a structured result', () => {
  const text = agent('e2e-test-verifier');
  for (const field of ['status', 'verdict', 'report_path', 'fidelity_path', 'counts', 'companion', 'html_paths', 'warnings']) {
    assert.match(text, new RegExp(`^\\s*${field}:`, 'm'), `structured result carries ${field}`);
  }
});

test('no companion writer declares a tools list', () => {
  for (const name of WRITERS) {
    const front = agent(name).split(/^---$/m)[1];
    assert.doesNotMatch(front, /^tools:/m, `${name} declares no tools:`);
  }
});
