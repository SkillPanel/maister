import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';
import {
  FOCUS_BUDGET, FOCUS_LINES, PREVIEW_BUDGET, plainPicker, richPicker,
} from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The continue option's preview — the glance — shows what the closed step
// found (its summary, as *Found*) beside *Done*, and every risk, fix, held
// choice and decision whole: a long one gives way to a count instead of being
// cut mid-word. These tests pin that on a real product design's context
// checkpoint, and on built checkpoints at the edges of the budgets.

const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');

/** A context synthesis as a product design records it: a long headline, a full summary, two open risks, five decisions. */
const CONTEXT_SYNTHESIS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'gates/context-synthesis.summary.json'), 'utf8'));

/** A product design run at its context checkpoint, the context synthesis closed with `summary`. */
function atContextGate(t, summary) {
  const run = scratch(t, { type: 'product-design', name: '2026-10-21-team-calendar-sharing' });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Share team calendars with outside guests' } });
  write(run, {
    nodes: { intake: { status: 'completed', values: { personas_enabled: false, prototyping_enabled: true, complexity_level: 'standard' } } },
    node_summaries: { intake: { summary: 'An enhancement with a UI.' } },
  });
  write(run, { nodes: { 'characteristics-approval': { status: 'completed' } } });
  fs.mkdirSync(path.join(run.dir, 'analysis'), { recursive: true });
  for (const file of ['design-context.md', 'codebase-analysis.md']) fs.writeFileSync(path.join(run.dir, 'analysis', file), '# written\n');
  write(run, { nodes: { 'context-synthesis': { status: 'completed' } }, node_summaries: { 'context-synthesis': summary } });
  return run;
}

function pickerOf(run, profile) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=context-approval', '--json', `--picker=${profile}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/** Every bullet of a glance, without its marker and the step that settled it. */
function bullets(lines) {
  return lines.filter(line => line.startsWith('- ')).map(line => line.slice(2).replace(/ — [a-z][a-z ]*$/, ''));
}

test('context checkpoint: the glance shows the findings, both risks and three decisions whole', t => {
  const preview = pickerOf(atContextGate(t, CONTEXT_SYNTHESIS), 'rich').options[0].preview;
  const { headline, summary, risks, decisions } = CONTEXT_SYNTHESIS;
  assert.equal(preview, [
    `Done: ${headline}`,
    `Found: ${summary}`,
    'Next: Problem exploration',
    'Review: analysis/design-context.md, analysis/codebase-analysis.md',
    'Open risks:',
    ...risks.map(risk => `- ${risk.risk}`),
    '',
    'Decided by the run (+2 more under More details):',
    ...decisions.slice(0, 3).map(each => `- ${each.decision} — context synthesis`),
  ].join('\n'));
  const lines = preview.split('\n');
  assert.ok(lines.length <= FOCUS_LINES && preview.length <= FOCUS_BUDGET, `${lines.length} lines, ${preview.length} characters`);
  assert.doesNotMatch(preview, /…/, 'nothing is cut');
});

test('context checkpoint: the plain question carries Found and the same whole items', t => {
  const question = pickerOf(atContextGate(t, CONTEXT_SYNTHESIS), 'plain').question.split('\n');
  assert.equal(question[1], `Found: ${CONTEXT_SYNTHESIS.summary}`);
  for (const risk of CONTEXT_SYNTHESIS.risks) assert.ok(question.includes(`- ${risk.risk}`), question.join('\n'));
  assert.doesNotMatch(question.join('\n'), /…/);
});

test('context checkpoint: no Found when Done was drawn from the summary', t => {
  const { headline, ...rest } = CONTEXT_SYNTHESIS;
  for (const profile of ['rich', 'plain']) {
    const picker = pickerOf(atContextGate(t, rest), profile);
    const glance = profile === 'rich' ? picker.options[0].preview : picker.question;
    assert.match(glance, /^Done: Sharing is per calendar and per member, enforced by the permission service on every read\.$/m);
    assert.doesNotMatch(glance, /^Found:/m, glance);
  }
});

// ---------------------------------------------------------------------------
// built checkpoints at the edges
// ---------------------------------------------------------------------------

const words = (stem, count) => `${Array.from({ length: count }, (_, index) => `${stem}${index}`).join(' ')}.`;

/** A gate checkpoint whose closed step has its own headline beside `summary`. */
function checkpointOf({ headline = 'The context is ready.', summary, risks = [], fixes = [], decisions = [], held = [] }) {
  return {
    kind: 'gate',
    node: 'context-approval',
    ask: 'Approve design context?',
    header: 'Context',
    headline,
    progress: { checkpoint: 2, checkpoints_max: 5 },
    next: { node: 'problem-exploration', title: 'Problem exploration', end: false, skipped: [] },
    review: [{ path: 'analysis/design-context.md', label: 'Design context', html: null, role: 'primary' }],
    closed: [{ node: 'context-synthesis', title: 'Context synthesis', headline, summary }],
    fixes,
    ...(held.length ? { held } : {}),
    decisions: { run: decisions.map(decision => ({ node: 'context-synthesis', decision })), audit: [], default: [], operator: { count: 0, not_recommended: [] } },
    risks: { open: risks.map(risk => ({ risk })) },
    options: [
      { id: 'continue', label: 'Continue', effect: 'continue', recommended: true, consequence: 'Goes on.' },
      { id: 'revise', label: 'Revise the context', effect: 'revise', recommended: false, consequence: 'Re-runs it.', reruns: [{ node: 'context-synthesis', title: 'Context synthesis' }], suggestions: [] },
      { id: 'stop', label: 'Stop', effect: 'stop', recommended: false, consequence: 'Ends the run here.' },
    ],
  };
}

test('glance: no risk, fix, held choice or decision is cut mid-word at any length; the rest give way to a count', () => {
  for (const size of [5, 15, 30, 60, 120]) {
    const risks = Array.from({ length: 3 }, (_, index) => words(`risk${index}-`, size));
    const decisions = Array.from({ length: 5 }, (_, index) => words(`decision${index}-`, size));
    const fixes = Array.from({ length: 3 }, (_, index) => ({ finding: words(`finding${index}-`, size), change: 'changed' }));
    const held = [{ node: 'context-synthesis', question_id: 'scope', question: words('question-', 12), decision: words('choice-', 12) }];
    const checkpoint = checkpointOf({ summary: words('summary-', 40), risks, fixes, decisions, held });
    for (const lines of [richPicker(checkpoint).options[0].preview.split('\n'), plainPicker(checkpoint).question.split('\n')]) {
      const whole = new Set([...risks, ...decisions, ...fixes.map(fix => `${fix.finding.replace(/\.$/, '')} → ${fix.change}`), `${held[0].question}: ${held[0].decision}`]);
      for (const item of bullets(lines)) assert.ok(whole.has(item), `cut at ${size} words: ${item}`);
      assert.doesNotMatch(lines.join('\n'), /…/, `nothing cut at ${size} words`);
      const shown = bullets(lines).filter(item => item.startsWith('decision')).length;
      if (shown < 3) assert.match(lines.join('\n'), shown ? new RegExp(`\\(\\+${5 - shown} more under More details\\)`) : /: 5 decisions, under More details\./);
    }
  }
});

test('glance: Done, Found and Next are never cut, the risks giving way instead', () => {
  const headline = words('headline-', 20);
  const summary = words('summary-', 60);
  const checkpoint = checkpointOf({ headline, summary, risks: Array.from({ length: 3 }, (_, index) => words(`risk${index}-`, 30)), decisions: Array.from({ length: 5 }, (_, index) => words(`decision${index}-`, 30)) });
  const lines = richPicker(checkpoint).options[0].preview.split('\n');
  assert.equal(lines[0], `Done: ${headline}`);
  assert.equal(lines[1], `Found: ${summary}`);
  assert.equal(lines[2], 'Next: Problem exploration');
  assert.ok(lines.join('\n').length <= FOCUS_BUDGET, lines.join('\n'));
});

test('glance: every preview stays within the preview budget with a long summary, three long risks and five decisions', () => {
  const checkpoint = checkpointOf({
    headline: words('headline-', 20),
    summary: words('summary-', 45),
    risks: Array.from({ length: 3 }, (_, index) => words(`risk${index}-`, 25)),
    decisions: Array.from({ length: 5 }, (_, index) => words(`decision${index}-`, 15)),
  });
  for (const option of richPicker(checkpoint).options) assert.ok(option.preview.length <= PREVIEW_BUDGET, `${option.id}: ${option.preview.length}`);
});

test('glance: a summary too long for any preview is cut at a sentence end, pointing to More details; Next stays', () => {
  const sentence = index => `Finding number ${index} holds for every calendar the team shares with a guest.`;
  let summary = '';
  for (let index = 1; summary.length < 1800; index++) summary += `${summary ? ' ' : ''}${sentence(index)}`;
  summary = summary.slice(0, 1800);
  assert.equal(summary.length, 1800);
  const checkpoint = checkpointOf({ headline: words('headline-', 20), summary, risks: [words('risk-', 20)], decisions: [words('decision-', 10)] });
  const preview = richPicker(checkpoint).options[0].preview;
  assert.ok(preview.length <= PREVIEW_BUDGET, `${preview.length} characters`);
  const lines = preview.split('\n');
  const found = lines.find(line => line.startsWith('Found: '));
  assert.match(found, /guest\. \(The rest is under More details\.\)$/, found);
  assert.ok(summary.startsWith(found.slice('Found: '.length, -' (The rest is under More details.)'.length)));
  assert.ok(lines.includes('Next: Problem exploration'));
  assert.equal(lines[0], `Done: ${words('headline-', 20)}`, 'Done stays whole while Found alone can give way');
  // The plain question has no preview to fit, so it carries the summary whole.
  assert.ok(plainPicker(checkpoint).question.includes(`Found: ${summary}`));
});
