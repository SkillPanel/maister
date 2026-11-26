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

// The explainer writer is not a companion writer: it builds one page from
// several sources, so it returns an `explainer:` field rather than
// `companion:`, and it links that page from the suite once the page exists.
test('the explainer-writer takes the html row, returns each explainer status and runs the check from its plugin path', () => {
  const text = agent('explainer-writer');
  assert.match(text, /^\|\s*`html`\s*\|[^\n]*run-context[^\n]*\|[^\n]*`html: off`/m, 'it has the shared html input row');
  assert.match(text, /^\s*explainer:\s*"?written/m, 'it returns an explainer field in its structured result');
  for (const status of ['written', 'disabled', 'failed', 'not-requested']) {
    assert.match(text, new RegExp(`explainer: ${status}`), `it returns explainer: ${status}`);
  }
  const front = text.split(/^---$/m)[1];
  assert.doesNotMatch(front, /^tools:/m, 'it declares no tools:');
  assert.doesNotMatch(front, /^model:/m, 'it names no model:');
  assert.ok(text.includes('`<plugin root>/skills/orchestrator-framework/scripts/check-explainer.mjs`'), 'it names the check script under the plugin root');
  assert.match(text, /never search(ed)? for/, 'it never searches for the check script');
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/scripts/check-explainer.mjs')), 'the check script is where the agent says');
});

test('the explainer-writer adds its crumb to the suite pages after its page is written, and changes nothing else there', () => {
  const text = agent('explainer-writer');
  const workflow = text.split(/^## Workflow/m)[1]?.split(/^## /m)[0] ?? '';
  const write = workflow.search(/^\d+\. \*\*Write the page/m);
  const link = workflow.search(/^\d+\. \*\*Link the page from the suite/m);
  assert.ok(write >= 0, 'the workflow has a step that writes the page');
  assert.ok(link > write, 'the crumb step comes after the page is written');
  const step = workflow.slice(link).split(/^\d+\. \*\*/m)[1] ?? '';
  assert.ok(step.includes('`<a href="<file name>"><this page\'s label></a>`'), 'the step names the crumb link it inserts, labelled as the page is in the suite');
  assert.match(step, /`report_suite`/, 'the crumb goes into the report_suite pages');
  assert.match(step, /directly after the Dashboard link/, 'the crumb sits after the Dashboard link');
  assert.match(step, /first in the bar/, 'the crumb opens a bar with no Dashboard link');
  assert.match(step, /[Cc]hange nothing else/, 'nothing else on those pages changes');
});
