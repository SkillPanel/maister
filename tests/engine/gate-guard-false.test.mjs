// A gate its guard skips is never asked. `gate-brief`, in every form, and
// `gate-request` refuse `gate-guard-false` for a gate whose `when` reads false
// unless the skip-guard rule asks it (a guard on a step's value, the gate more
// than a pure confirmation) or a held choice does (a guard on a step's value
// while a choice waits for approval — held in `in-node-classing.test.mjs`).
// The message names the skip write; nothing is written. A gate with no guard,
// or a true one, is asked as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, FIXTURES, freeze, scratch, verb, write } from '../helpers.mjs';

const SKIP_GUARD = path.join(FIXTURES, 'definitions/skip-guard.yml');
const QUESTIONS = path.join(FIXTURES, 'definitions/in-node-questions.yml');
const GATE_MODULE = path.join(ENGINE_DIR, 'scripts/lib/gate.mjs');
const FORMS = [[], ['--json', '--picker=rich'], ['--checkpoint'], ['--request'], ['--oneline']];

function brief(run, node, form = []) {
  return verb(['gate-brief', `--state=${run.state}`, `--node=${node}`, ...form]);
}

function asked(result) {
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /gate-guard-false/);
}

function refused(result) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^gate-guard-false: /m);
  return result;
}

/** The skip-guard fixture with its review completed, `findings_to_review` as given. */
function reviewed(t, findings) {
  const run = scratch(t);
  freeze(run, { definition: SKIP_GUARD });
  write(run, {
    nodes: { review: { status: 'completed', values: { findings_to_review: findings } } },
    node_summaries: { review: { summary: 'Reviewed the work.' } },
  });
  return run;
}

test('a gate with no guard is asked in every form', t => {
  const run = reviewed(t, false);
  for (const form of FORMS) asked(brief(run, 'review-approval', form));
});

test('the skip-guard rule still asks a gate whose false guard reads a step\'s value and is more than a confirmation', t => {
  const run = reviewed(t, false);
  for (const form of FORMS) asked(brief(run, 'findings-approval', form));
});

test('a true guard is asked; the same pure confirmation with its guard false, nothing held, is refused with the skip write', t => {
  const confirming = reviewed(t, false);
  write(confirming, {
    nodes: { 'review-approval': { status: 'completed' }, 'findings-approval': { status: 'completed' } },
    node_summaries: { 'findings-approval': { decisions: [{ option: 'continue-without-design', by: 'operator' }] } },
  });
  asked(brief(confirming, 'confirmation', ['--request']));
  const run = reviewed(t, true);
  const before = fs.readFileSync(run.state, 'utf8');
  for (const form of FORMS) {
    const result = refused(brief(run, 'confirmation', form));
    assert.match(result.stderr, /its guard !\$\{review\.values\.findings_to_review\} reads false, and it is a pure confirmation and no choice is held for approval\. Nothing was written\./);
    assert.match(result.stderr, /\{"nodes":\{"confirmation":\{"status":"skipped"\}\}\}/);
  }
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
});

test('an input-only guard that reads false is refused, and the skip write names the pending stretch it closes', t => {
  const run = scratch(t);
  freeze(run, { definition: QUESTIONS });
  write(run, {
    nodes: {
      scoping: { status: 'completed', values: { wants_review: true, wants_notes: false } },
      'review-approval': { status: 'skipped' },
      'depth-approval': { status: 'skipped' },
      drafting: { status: 'completed' },
    },
    node_summaries: { drafting: { summary: 'Drafted.' } },
  });
  const result = refused(brief(run, 'notes-approval', ['--json', '--picker=rich']));
  assert.match(result.stderr, /Record it skipped with its stretch through write-state — \{"nodes":\{"notes-approval":\{"status":"skipped"\},"notes":\{"status":"skipped"\}\}\}/);
  // The patch named is one the writer takes, and the run goes on past it.
  write(run, { nodes: { 'notes-approval': { status: 'skipped' }, notes: { status: 'skipped' } } });
});

test('gate-request refuses a gate its guard skips before anything else, writing nothing and keeping the request', t => {
  const run = reviewed(t, true);
  const before = fs.readFileSync(run.state, 'utf8');
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify({ node: 'confirmation', kind: 'approve', question: 'Proceed?', options: [] }));
  const result = refused(verb(['gate-request', `--state=${run.state}`, `--patch-file=${patch}`]));
  assert.equal(result.stdout, '');
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates')), false, 'no request file');
  assert.ok(fs.existsSync(patch), 'the request is kept');
});

test('control: gate-request for a gate that is asked goes on to the edition check', { skip: fs.existsSync(GATE_MODULE) && 'this edition carries the gate module' }, t => {
  const run = reviewed(t, false);
  const patch = path.join(run.dir, '.state-patch.json');
  fs.writeFileSync(patch, JSON.stringify({ node: 'findings-approval', kind: 'approve', question: 'Proceed?', options: [] }));
  const result = verb(['gate-request', `--state=${run.state}`, `--patch-file=${patch}`]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^gate-request-unavailable: /);
});
