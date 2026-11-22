import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR } from '../helpers.mjs';

// The dashboard's source chip says who settled a decision. A question a host
// answered while nobody was there carries its own chip, named by the host.

// A Windows checkout may give the page CRLF line ends; the slicing below looks for LF.
const html = fs.readFileSync(path.join(ENGINE_DIR, '../../skills/orchestrator-framework/assets/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');

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

test('approval mark: an approval by the operator reads "Approved by you", a named approver as their name', () => {
  const start = html.indexOf('function onBehalf(');
  const marks = html.indexOf('function triageMarks(');
  const stop = html.indexOf('\n}\n', marks) + 3;
  const context = vm.createContext({});
  const helpers = html.slice(html.indexOf('function esc('), html.indexOf('\n}\n', html.indexOf('function esc(')) + 3);
  const labels = html.slice(html.indexOf('const CLASS_WORDS'), html.indexOf('\n', html.indexOf('const CLASS_WORDS')) + 1);
  vm.runInContext(`${helpers}\n${labels}\n${html.slice(start, html.indexOf('\n}\n', start) + 3)}\n${html.slice(marks, stop)}\nthis.triageMarks = triageMarks;`, context);
  const held = { triage: { held: true } };
  assert.equal(context.triageMarks({ ...held, approved: { by: 'operator' } }), '<span class="src approved">Approved by you</span>');
  assert.equal(context.triageMarks({ ...held, approved: {} }), '<span class="src approved">Approved by you</span>');
  assert.equal(context.triageMarks({ ...held, approved: { by: 'lee' } }), '<span class="src approved">Approved by lee</span>');
});
