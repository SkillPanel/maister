import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR } from '../helpers.mjs';

// The dashboard's source chip says who settled a decision. A question a host
// answered while nobody was there carries its own chip, named by the host.

const html = fs.readFileSync(path.join(ENGINE_DIR, '../../skills/orchestrator-framework/assets/dashboard.html'), 'utf8');

/** The chip helpers lifted from the page's script, run in a bare context. */
function chips() {
  const from = html.indexOf('function esc(');
  const labels = html.indexOf('const SOURCE_LABEL');
  const end = html.indexOf('function sourceChip(');
  const stop = html.indexOf('\n}\n', end) + 3;
  assert.ok(from >= 0 && labels > from && end > labels, 'the chip helpers are in the page');
  const context = vm.createContext({});
  vm.runInContext(`${html.slice(from, html.indexOf('\n}\n', from) + 3)}\n${html.slice(labels, stop)}\nthis.sourceChip = sourceChip;`, context);
  return context.sourceChip;
}

test('source chip: a host answer reads "Copilot" in a host chip, an unknown host reads as its id, and an operator answer is unchanged', () => {
  const chip = chips();
  const host = { by: 'run', actor: { kind: 'host', id: 'copilot' }, question_id: 'q', question: 'Which?', answer: 'A' };
  assert.equal(chip(host), '<span class="src host">Copilot</span>');
  assert.equal(chip({ ...host, actor: { kind: 'host', id: 'other-host' } }), '<span class="src host">other-host</span>');
  assert.equal(chip({ by: 'operator', answered_by: 'lee' }), '<span class="src operator">lee</span>');
  assert.equal(chip({ by: 'operator' }), '<span class="src operator">You</span>');
  assert.equal(chip({ by: 'run' }), '<span class="src run">Analysis</span>');
  assert.equal(chip({ by: 'run', actor: { kind: 'person', id: 'lee' } }), '<span class="src run">Analysis</span>');
});

test('source chip: the page styles .src.host', () => {
  assert.match(html, /\.src\.host\s*\{[^}]*var\(--/);
});
