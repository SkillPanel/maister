import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, delegating, freeze, scratch, verb, write } from '../helpers.mjs';
import {
  FOCUS_BUDGET, FOCUS_LINES, PREVIEW_BUDGET, detailsPreview, moreDetails, plainPicker, richPicker,
} from '../../plugins/maister/skills/workflow-engine/scripts/lib/checkpoint.mjs';

// The continue option's preview — the glance — shows what the closed step
// found (its summary, as *Found*) beside *Done*, and every risk, fix, held
// choice and decision whole: a long one gives way to a count instead of being
// cut mid-word. These tests pin that on a real product design's problem
// checkpoint, and on built checkpoints at the edges of the budgets. That gate
// closes the intake and the problem, and the intake leads: *Done* and *Found*
// are the scope proposal, the risks and decisions those of the whole stretch.

const PRODUCT_DESIGN = path.join(ENGINE_DIR, 'workflows/product-design.yml');

/** An intake as a product design records it: the recommended outcome as a long headline, the scope proposal as a full summary. */
const INTAKE = {
  headline: 'A design brief with screens fits this: one dialog for sharing a team calendar and one page for the guest who opens the link, built on the invite flow the product already has.',
  summary: 'Team calendars are shared per member, inside the organisation only, and guests have no identity of their own. The people affected are team leads who book outside partners and the guests they invite. An invite already carries a signed link that expires with the event. The sharing dialog and a guest page are drawn; the permission service changes behind them. Still to come: the problem and personas, then the choices for each decision area.',
  artifacts: [
    { path: 'analysis/scope.md', role: 'primary' },
    { path: 'analysis/explore/screens.md', role: 'evidence' },
  ],
};

/** A problem step as a product design records it: the recommended outcome, two open risks, five decisions. */
const PROBLEM = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'gates/problem.summary.json'), 'utf8'));

/** A product design run at its problem checkpoint, the intake closed with `intake` and the problem with `PROBLEM`. */
function atProblemGate(t, intake, problem = PROBLEM) {
  const run = scratch(t, { type: 'product-design', name: '2026-10-21-team-calendar-sharing' });
  freeze(run, { definition: PRODUCT_DESIGN, inputs: { task_description: 'Share team calendars with outside guests' } });
  fs.mkdirSync(path.join(run.dir, 'analysis/explore'), { recursive: true });
  for (const file of ['scope.md', 'explore/screens.md', 'problem-statement.md', 'personas.md']) fs.writeFileSync(path.join(run.dir, 'analysis', file), '# written\n');
  write(run, delegating({
    nodes: { intake: { status: 'completed', values: { draws: true } } },
    node_summaries: { intake },
  }, run));
  write(run, { nodes: { problem: { status: 'completed' } }, node_summaries: { problem } });
  return run;
}

function pickerOf(run, profile) {
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=problem-approval', '--json', `--picker=${profile}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

/** Every bullet of a glance, without its marker and the step that settled it. */
function bullets(lines) {
  return lines.filter(line => line.startsWith('- ')).map(line => line.slice(2).replace(/ — [a-z][a-z ]*$/, ''));
}

test('problem checkpoint: the glance shows the findings, both risks and three decisions whole', t => {
  const preview = pickerOf(atProblemGate(t, INTAKE), 'rich').options[0].preview;
  const { headline, summary } = INTAKE;
  const { risks, decisions } = PROBLEM;
  assert.equal(preview, [
    `Done: ${headline}`,
    `Found: ${summary}`,
    'Next: Brainstorm alternatives',
    'Review: analysis/scope.md, analysis/problem-statement.md, analysis/personas.md',
    'Open risks:',
    ...risks.map(risk => `- ${risk.risk}`),
    '',
    'Decided by the run (+2 more under More details):',
    ...decisions.slice(0, 3).map(each => `- ${each.decision} — problem and personas`),
  ].join('\n'));
  const lines = preview.split('\n');
  assert.ok(lines.length <= FOCUS_LINES && preview.length <= FOCUS_BUDGET, `${lines.length} lines, ${preview.length} characters`);
  assert.doesNotMatch(preview, /…/, 'nothing is cut');
});

test('problem checkpoint: the problem closes beside the intake that leads', t => {
  const run = atProblemGate(t, INTAKE);
  const result = verb(['gate-brief', `--state=${run.state}`, '--node=problem-approval', '--checkpoint']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).closed.map(({ node, headline }) => ({ node, headline })), [
    { node: 'intake', headline: INTAKE.headline },
    { node: 'problem', headline: PROBLEM.headline },
  ]);
});

test('problem checkpoint: the plain question carries Found and the same whole items', t => {
  const question = pickerOf(atProblemGate(t, INTAKE), 'plain').question.split('\n');
  assert.equal(question[1], `Found: ${INTAKE.summary}`);
  for (const risk of PROBLEM.risks) assert.ok(question.includes(`- ${risk.risk}`), question.join('\n'));
  assert.doesNotMatch(question.join('\n'), /…/);
});

test('problem checkpoint: no Found when Done was drawn from the summary', t => {
  const { headline, ...rest } = INTAKE;
  for (const profile of ['rich', 'plain']) {
    const picker = pickerOf(atProblemGate(t, rest), profile);
    const glance = profile === 'rich' ? picker.options[0].preview : picker.question;
    assert.match(glance, /^Done: Team calendars are shared per member, inside the organisation only, and guests have no identity of their own\.$/m);
    assert.doesNotMatch(glance, /^Found:/m, glance);
  }
});

// ---------------------------------------------------------------------------
// the stories the problem drafted, which going on confirms
// ---------------------------------------------------------------------------

const STORIES = [
  'user-story-share-calendar: a team lead shares a calendar with a guest from its settings',
  'user-story-open-link: a guest opens the link and sees free time, with no account',
  'user-story-revoke-share: a calendar owner ends a share, and the link stops working',
];

/** Every form of checkpoint 1: what each surface reads, by name. */
function formsOf(run) {
  const text = (...flags) => {
    const result = verb(['gate-brief', `--state=${run.state}`, '--node=problem-approval', ...flags]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  };
  return {
    preview: pickerOf(run, 'rich').options[0].preview,
    question: pickerOf(run, 'plain').question,
    full: text(),
    details: detailsPreview(moreDetails(JSON.parse(text('--checkpoint')))),
    oneline: text('--oneline'),
  };
}

test('problem checkpoint: each drafted story shows on a line of its own in the preview, the question and both full briefs, and on the driven line', t => {
  const forms = formsOf(atProblemGate(t, INTAKE, { ...PROBLEM, stories: STORIES }));
  for (const name of ['preview', 'question', 'full', 'details']) {
    const lines = forms[name].split('\n');
    assert.ok(lines.some(line => /^(\*\*)?Stories to confirm(\*\*|:)?$/.test(line)), `${name}: the heading\n${forms[name]}`);
    for (const story of STORIES) assert.ok(lines.includes(`- ${story}`), `${name}: ${story}\n${forms[name]}`);
  }
  for (const story of STORIES) assert.ok(forms.oneline.includes(story), forms.oneline);
  assert.ok(forms.oneline.includes('Stories to confirm: '), forms.oneline);
});

test('problem checkpoint: the stories sit ahead of the risks and count as neither a risk nor a decision', t => {
  const run = atProblemGate(t, INTAKE, { ...PROBLEM, stories: STORIES });
  const lines = pickerOf(run, 'rich').options[0].preview.split('\n');
  assert.ok(lines.indexOf('Stories to confirm:') < lines.indexOf('Open risks:'), lines.join('\n'));
  const checkpoint = JSON.parse(verb(['gate-brief', `--state=${run.state}`, '--node=problem-approval', '--checkpoint']).stdout);
  assert.equal(checkpoint.risks.open.length, PROBLEM.risks.length);
  assert.equal(checkpoint.decisions.run.length, PROBLEM.decisions.length);
});

test('problem checkpoint: long summaries are cut before any story is, in both full briefs', t => {
  const long = stem => Array.from({ length: 40 }, (_, index) => `${stem} finding ${index} holds for every calendar the team shares with a guest.`).join(' ');
  const run = atProblemGate(t, { ...INTAKE, summary: long('Scope') }, { ...PROBLEM, summary: long('Problem'), stories: STORIES });
  const { full, details, preview } = formsOf(run);
  assert.match(full, /more in /, 'the plain brief did trim');
  assert.match(details, /Choose this to see the rest\.$/, 'the preview of More details did cut');
  for (const form of [full, details, preview]) for (const story of STORIES) assert.ok(form.split('\n').includes(`- ${story}`), form);
});

test('problem checkpoint: only stories past the preview\'s limit give way, whole, to a count and never to none', () => {
  const stories = Array.from({ length: 16 }, (_, index) => `user-story-${index}: ${words(`story${index}-`, 20)}`);
  const closed = { node: 'problem', title: 'Problem and personas', headline: 'The problem is ready.', summary: 'A summary.', stories };
  const preview = richPicker({ ...checkpointOf({ summary: 'A summary.', risks: [words('risk-', 20)] }), closed: [closed] }).options[0].preview;
  assert.match(preview, /^Stories to confirm \(\+\d+ more under More details\):$/m);
  assert.ok(bullets(preview.split('\n')).includes(stories[0]), preview);
  assert.ok(preview.length <= PREVIEW_BUDGET, `${preview.length}`);
  for (const line of preview.split('\n').filter(each => each.startsWith('- user-story'))) assert.ok(stories.includes(line.slice(2)), `cut: ${line}`);
});

test('a checkpoint with no stories names none', t => {
  const forms = formsOf(atProblemGate(t, INTAKE));
  for (const form of Object.values(forms)) assert.doesNotMatch(form, /Stories to confirm/);
});

test('the writer refuses a story that is not one line of text, and writes nothing', t => {
  const run = atProblemGate(t, INTAKE);
  for (const stories of ['one story', ['two\nlines'], [''], [{ story: 'a map' }]]) {
    const before = fs.readFileSync(run.state, 'utf8');
    const result = verb(['write-state', `--state=${run.state}`], JSON.stringify({ node_summaries: { problem: { stories } } }));
    assert.notEqual(result.code, 0, JSON.stringify(stories));
    assert.match(result.stderr + result.stdout, /state-summary-item-invalid/);
    assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  }
});

// ---------------------------------------------------------------------------
// built checkpoints at the edges
// ---------------------------------------------------------------------------

const words = (stem, count) => `${Array.from({ length: count }, (_, index) => `${stem}${index}`).join(' ')}.`;

/** A gate checkpoint whose closed step has its own headline beside `summary`. */
function checkpointOf({ headline = 'The problem is ready.', summary, risks = [], fixes = [], decisions = [], held = [] }) {
  return {
    kind: 'gate',
    node: 'problem-approval',
    ask: 'Which outcome should this run produce?',
    header: 'Scope',
    headline,
    progress: { checkpoint: 2, checkpoints_max: 5 },
    next: { node: 'alternatives', title: 'Brainstorm alternatives', end: false, skipped: [] },
    review: [{ path: 'analysis/problem-statement.md', label: 'Problem statement', html: null, role: 'primary' }],
    closed: [{ node: 'problem', title: 'Problem and personas', headline, summary }],
    fixes,
    ...(held.length ? { held } : {}),
    decisions: { run: decisions.map(decision => ({ node: 'problem', decision })), audit: [], default: [], operator: { count: 0, not_recommended: [] } },
    risks: { open: risks.map(risk => ({ risk })) },
    options: [
      { id: 'continue', label: 'Continue', effect: 'continue', recommended: true, consequence: 'Goes on.' },
      { id: 'revise', label: 'Revise the problem', effect: 'revise', recommended: false, consequence: 'Re-runs it.', reruns: [{ node: 'problem', title: 'Problem and personas' }], suggestions: [] },
      { id: 'stop', label: 'Stop', effect: 'stop', recommended: false, consequence: 'Ends the run here.' },
    ],
  };
}

test('glance: no risk, fix, held choice or decision is cut mid-word at any length; the rest give way to a count', () => {
  for (const size of [5, 15, 30, 60, 120]) {
    const risks = Array.from({ length: 3 }, (_, index) => words(`risk${index}-`, size));
    const decisions = Array.from({ length: 5 }, (_, index) => words(`decision${index}-`, size));
    const fixes = Array.from({ length: 3 }, (_, index) => ({ finding: words(`finding${index}-`, size), change: 'changed' }));
    const held = [{ node: 'problem', question_id: 'scope', question: words('question-', 12), decision: words('choice-', 12) }];
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
  assert.equal(lines[2], 'Next: Brainstorm alternatives');
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
  assert.ok(lines.includes('Next: Brainstorm alternatives'));
  assert.equal(lines[0], `Done: ${words('headline-', 20)}`, 'Done stays whole while Found alone can give way');
  // The plain question has no preview to fit, so it carries the summary whole.
  assert.ok(plainPicker(checkpoint).question.includes(`Found: ${summary}`));
});
