import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, briefOf, freeze, scratch, verb, write } from '../helpers.mjs';

// A verb that briefs a moment of the run, or refuses one, names the reference
// section that governs it: `rules: <file> § <heading>`. The pointer is one
// spelling — a trailing paragraph on a text form's stdout, a `rules` key on a
// `--json` form, one stderr line after a refusal's message lines — appended
// after the renderer returns, so the brief it follows keeps its own budget.
// Closed documents a driver or a panel reads (`--checkpoint`, `--request`,
// `--oneline`) and usage errors carry none.

const REFERENCES = path.join(ENGINE_DIR, 'references');
const pointer = (file, heading) => `${path.join(REFERENCES, file)} § ${heading}`;

const GATE_BRIEF = pointer('gates.md', 'Before every gate — the gate brief');
const REVISING = pointer('gates.md', 'Revising at a gate');
const AREAS = pointer('in-node-questions.md', 'Decision areas from the brainstorm');
const FINDINGS = pointer('in-node-questions.md', 'Findings that need a decision');
const WRITE_REFUSED = pointer('writing-state.md', 'When a write is refused');
const COMPLETE_REFUSED = pointer('writing-state.md', 'When `run-complete` refuses');

const BUDGET = 1600;

/** The trailing paragraph a text form ends with. */
const trailing = rules => `\n\nrules: ${rules}\n`;

/** The stderr lines, without the empty one after the last newline. */
const linesOf = stderr => stderr.split('\n').filter(line => line !== '');

/**
 * A refusal's stderr in the order the pointer rule fixes: the code first, the
 * message lines, then exactly one `rules:` line naming `rules`, then only
 * `warning:` lines.
 */
function refusedWithPointer(result, code, rules, label = code) {
  assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.startsWith(`${code}: `), `${label}: ${result.stderr}`);
  const lines = linesOf(result.stderr);
  const at = lines.findIndex(line => line.startsWith('rules: '));
  assert.ok(at > 0, `${label}: no rules line after the message: ${result.stderr}`);
  assert.equal(lines[at], `rules: ${rules}`, label);
  assert.equal(lines.filter(line => line.startsWith('rules: ')).length, 1, label);
  for (const line of lines.slice(at + 1)) assert.match(line, /^warning: /, label);
  return lines;
}

// ---------------------------------------------------------------------------
// the runs
// ---------------------------------------------------------------------------

const SUMMARY = {
  status: 'completed',
  summary: 'Two gaps found in the parser.',
  decisions: [{ decision: 'Patch the tokenizer', rationale: 'smallest change' }],
  risks: ['The fixture corpus is thin'],
};

/** A sample run paused at `approval`, its closing node's summary recorded. */
function atApproval(t, summary = SUMMARY) {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { analysis: { status: 'completed' } }, node_summaries: { analysis: summary } });
  return run;
}

function gateBrief(run, ...flags) {
  return verb(['gate-brief', `--state=${run.state}`, ...flags]);
}

/** A research run at its convergence node, the brainstorm's decision areas in place unless `file` is false. */
function atConvergence(t, { file = true } = {}) {
  const run = scratch(t, { type: 'research', name: '2026-10-10-research-areas' });
  freeze(run, { definition: path.join(ENGINE_DIR, 'workflows/research.yml'), inputs: { question: 'Where do shared calendars live?' } });
  write(run, { nodes: { 'solution-generation': { status: 'completed' }, 'solution-convergence': { status: 'running' } } });
  if (file) {
    const doc = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'decision-areas/valid.json'), 'utf8'));
    doc.source.path = 'outputs/solution-exploration.md';
    fs.mkdirSync(path.join(run.dir, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(run.dir, 'outputs/decision-areas.json'), `${JSON.stringify(doc, null, 2)}\n`);
    fs.copyFileSync(path.join(FIXTURES, 'decision-areas/source.md'), path.join(run.dir, 'outputs/solution-exploration.md'));
  }
  return { ...run, patch: path.join(run.dir, '.state-patch.json') };
}

function areaBrief(run, ...flags) {
  return verb(['area-brief', `--state=${run.state}`, '--node=solution-convergence', ...flags]);
}

/** A finding-review run with its reviewing node running and one finding on file. */
function reviewing(t) {
  const run = scratch(t);
  freeze(run, { definition: path.join(FIXTURES, 'definitions/finding-review.yml') });
  write(run, { nodes: { review: { status: 'running' } } });
  const file = path.join(run.dir, 'verification/findings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    findings: [{
      id: 'empty-upload',
      severity: 'critical',
      title: 'Server crashes on an empty upload',
      evidence: 'src/upload.ts:42 reads body.length of undefined',
      options: [{ label: 'Guard the empty body', description: 'Return 400 before reading the body' }],
      recommended: 0,
      reason: 'One guard closes the crash without changing valid uploads',
    }],
  }, null, 2));
  return { ...run, patch: path.join(run.dir, '.state-patch.json') };
}

function findingBrief(run, { node = 'review', patch = false } = {}) {
  const args = ['finding-brief', `--state=${run.state}`, `--node=${node}`, '--findings-file=verification/findings.json'];
  if (patch) args.push(`--patch-file=${run.patch}`);
  return verb(args);
}

/** A revise-fixture run whose first gate, `review-approval`, is the question now. */
function atReviewGate(t) {
  const run = scratch(t);
  freeze(run, { definition: path.join(FIXTURES, 'definitions/revise.yml') });
  write(run, {
    nodes: { draft: { status: 'completed', values: { needs_figures: true } } },
    node_summaries: { draft: { summary: 'Drafted the guide.' } },
  });
  write(run, { nodes: { figures: { status: 'completed' }, 'side-note': { status: 'completed' } } });
  write(run, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed the draft.' } } });
  return run;
}

function gateRevise(run, option, note = 'Tighten the intro') {
  return verb(['gate-revise', `--state=${run.state}`, '--node=review-approval', `--option=${option}`], { note });
}

// ---------------------------------------------------------------------------
// the forms that carry it, and the ones that do not
// ---------------------------------------------------------------------------

test('gate-brief: the text ends on the gate-brief pointer, --json carries it as a key, the driven forms carry none', t => {
  const run = atApproval(t);
  const text = gateBrief(run, '--node=approval');
  assert.equal(text.code, 0, text.stderr);
  assert.ok(text.stdout.endsWith(trailing(GATE_BRIEF)), text.stdout);
  assert.ok(!briefOf(text.stdout).includes('rules:'), 'the pointer is printed once, after the brief');
  const json = gateBrief(run, '--node=approval', '--json');
  assert.equal(json.code, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).rules, GATE_BRIEF);
  for (const form of ['--checkpoint', '--request', '--oneline']) {
    const result = gateBrief(run, '--node=approval', form);
    assert.equal(result.code, 0, `${form}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /rules/, form);
    assert.doesNotMatch(result.stderr, /rules:/, form);
  }
  const usage = gateBrief(run, '--node=approval', '--json', '--oneline');
  assert.equal(usage.code, 2);
  assert.doesNotMatch(usage.stderr, /rules:/, 'a usage error carries no pointer');
});

test('area-brief: the write-up and the set path end on the areas pointer, --json carries it on ok, fallback and refusal', t => {
  const run = atConvergence(t);
  const writeUp = areaBrief(run, '--area=storage');
  assert.equal(writeUp.code, 0, writeUp.stderr);
  assert.ok(writeUp.stdout.endsWith(trailing(AREAS)), writeUp.stdout);
  const set = areaBrief(run, `--patch-file=${run.patch}`);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(set.stdout, `${run.patch}${trailing(AREAS)}`);
  assert.doesNotMatch(fs.readFileSync(run.patch, 'utf8'), /rules/, 'the set the file carries is unchanged');
  const picker = areaBrief(run, '--area=storage', '--json');
  assert.equal(picker.code, 0, picker.stderr);
  assert.equal(JSON.parse(picker.stdout).rules, AREAS);
  const refusal = areaBrief(run, '--area=nowhere', '--json');
  assert.equal(refusal.code, 1);
  assert.equal(JSON.parse(refusal.stdout).rules, AREAS);

  const missing = atConvergence(t, { file: false });
  const fallback = areaBrief(missing, '--area=storage', '--json');
  assert.equal(fallback.code, 0, fallback.stderr);
  assert.equal(JSON.parse(fallback.stdout).rules, AREAS);
  const nothing = areaBrief(missing, '--area=storage');
  assert.equal(nothing.code, 0, nothing.stderr);
  assert.equal(nothing.stdout, '', 'a text-form fallback has nothing to paste and no pointer');
  assert.doesNotMatch(nothing.stderr, /rules:/);
});

test('finding-brief: the bare set is valid JSON with no pointer; the patch-file form ends on the findings pointer and the file holds the set alone', t => {
  const run = reviewing(t);
  const printed = findingBrief(run);
  assert.equal(printed.code, 0, printed.stderr);
  assert.doesNotMatch(printed.stdout, /rules:/, 'no pointer on the bare set');
  const bare = JSON.parse(printed.stdout);
  assert.equal(bare.questions.length, 1);
  const filed = findingBrief(run, { patch: true });
  assert.equal(filed.code, 0, filed.stderr);
  assert.equal(filed.stdout, `${run.patch}${trailing(FINDINGS)}`);
  const set = fs.readFileSync(run.patch, 'utf8');
  assert.doesNotMatch(set, /rules/);
  assert.deepEqual(JSON.parse(set), bare, 'the file holds the set stdout printed');
});

test('gate-revise: a revise ends on the revising pointer after its revised line; a refusal names it on stderr', t => {
  const run = atReviewGate(t);
  const refusal = gateRevise(run, 'nowhere');
  refusedWithPointer(refusal, 'revise-option-unknown', REVISING);
  const revised = gateRevise(run, 'send-back');
  assert.equal(revised.code, 0, revised.stderr);
  assert.match(revised.stdout, new RegExp(`\\nrevised: review-approval [^\\n]*${trailing(REVISING).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
});

test('write-state and run-complete: a refusal keeps its code first, then its message, then the writing-state pointer', t => {
  const run = scratch(t);
  freeze(run);
  const written = verb(['write-state', `--state=${run.state}`], { nodes: { ghost: { status: 'completed' } } });
  refusedWithPointer(written, 'state-node-unknown', WRITE_REFUSED);

  const unended = verb(['run-complete', `--state=${run.state}`]);
  refusedWithPointer(unended, 'run-not-ended', COMPLETE_REFUSED);
  assert.doesNotMatch(unended.stdout, /rules/, 'the marker stays the last stdout line');

  // A failed run's ending is not a refusal to recover from, so it names nothing.
  const failed = scratch(t);
  freeze(failed);
  write(failed, { task: { status: 'failed', failure_reason: 'the build is red' } });
  const ending = verb(['run-complete', `--state=${failed.state}`]);
  assert.equal(ending.code, 1, ending.stderr);
  assert.doesNotMatch(ending.stderr, /rules:/);

  const usage = verb(['write-state']);
  assert.equal(usage.code, 2);
  assert.doesNotMatch(usage.stderr, /rules:/);
});

test('the brief verbs: each text-form refusal names on stderr the pointer its --json refusal carries as a key', t => {
  const run = atApproval(t);
  const gateText = gateBrief(run, '--node=nowhere');
  const gateCode = gateText.stderr.split(':')[0];
  assert.match(gateCode, /^gate-brief-/);
  refusedWithPointer(gateText, gateCode, GATE_BRIEF);
  const gateJson = gateBrief(run, '--node=nowhere', '--json');
  assert.equal(gateJson.code, 1);
  assert.equal(JSON.parse(gateJson.stdout).rules, GATE_BRIEF);
  for (const form of ['--checkpoint', '--request', '--oneline']) {
    const driven = gateBrief(run, '--node=nowhere', form);
    assert.equal(driven.code, 1, form);
    assert.doesNotMatch(driven.stderr, /rules:/, `${form} is read by a driver and carries no pointer`);
  }

  const areas = atConvergence(t);
  refusedWithPointer(areaBrief(areas, '--area=nowhere'), 'area-brief-unknown-area', AREAS);
  assert.equal(JSON.parse(areaBrief(areas, '--area=nowhere', '--json').stdout).rules, AREAS);
  refusedWithPointer(areaBrief(areas, `--patch-file=${areas.patch}`, '--area=nowhere'), 'area-brief-unknown-area', AREAS, 'the set form');

  const findings = reviewing(t);
  const refused = findingBrief(findings, { node: 'nowhere' });
  const findingCode = refused.stderr.split(':')[0];
  assert.match(findingCode, /^finding-brief-/);
  refusedWithPointer(refused, findingCode, FINDINGS);
});

test('gate-brief: the brief before the pointer keeps within the budget at a gate filled to it', t => {
  const run = atApproval(t, {
    status: 'completed',
    summary: Array.from({ length: 60 }, (_, i) => `Sentence ${i} restates a decision carried forward from an earlier node.`).join(' '),
    decisions: Array.from({ length: 12 }, (_, i) => ({ decision: `Decision ${i} about the parser`, rationale: 'x'.repeat(120) })),
    risks: Array.from({ length: 10 }, (_, i) => `Risk ${i}: ${'y'.repeat(150)}`),
  });
  const result = gateBrief(run, '--node=approval');
  assert.equal(result.code, 0, result.stderr);
  const brief = briefOf(result.stdout);
  assert.ok(brief.length <= BUDGET, `brief is ${brief.length} characters`);
  assert.ok(brief.length > BUDGET - 200, 'the gate is filled to the budget');
  assert.equal(result.stdout, `${brief.slice(0, -1)}${trailing(GATE_BRIEF)}`, 'the pointer comes after the brief, outside its budget');
});

// ---------------------------------------------------------------------------
// every pointer lands
// ---------------------------------------------------------------------------

test('every pointer names a reference that exists and a heading of that reference, spelled exactly', () => {
  for (const rules of [GATE_BRIEF, REVISING, AREAS, FINDINGS, WRITE_REFUSED, COMPLETE_REFUSED]) {
    const [file, heading] = rules.split(' § ');
    assert.ok(fs.existsSync(file), `${path.relative(ENGINE_DIR, file)} exists`);
    const headings = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split('\n')
      .filter(line => /^#{1,6} /.test(line))
      .map(line => line.replace(/^#{1,6} /, '').trim());
    assert.ok(headings.includes(heading), `${path.basename(file)} has the heading "${heading}"`);
  }
});

test('the frozen-workflow refusal and an unfinished close each name the writing-state pointer too', t => {
  const run = scratch(t);
  freeze(run);
  const frozen = verb(['write-state', `--state=${run.state}`],
    { workflow: { name: 'development', nodes: { analysis: { kind: 'direct' } } } });
  refusedWithPointer(frozen, 'state-workflow-frozen', WRITE_REFUSED);

  write(run, { task: { status: 'completed' } });
  const unfinished = verb(['run-complete', `--state=${run.state}`]);
  refusedWithPointer(unfinished, 'run-nodes-unfinished', COMPLETE_REFUSED);
  assert.equal(unfinished.stdout, 'RUN-FAILED: run-nodes-unfinished\n', 'the marker stays the only stdout line');
});
