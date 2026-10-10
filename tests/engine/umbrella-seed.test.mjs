import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';
import { buildSeed, renderSeed, SEED_LINE_CAP } from '../../plugins/maister/skills/umbrella/scripts/lib/seed.mjs';
import { PERMISSIONS } from '../../plugins/maister/skills/umbrella/scripts/lib/envelope.mjs';

// A dispatched worker suspends at a gate on a request it did not compose: the
// seed names gate-brief --request as the request's only source, its output
// written unchanged to the patch file, and then one gate-request call.

const ENVELOPE = {
  version: 1,
  dispatch_id: 'd-0001',
  provider: 'claude',
  autonomy: 'attended',
  target: { member: 'app', path: 'members/app' },
  chain: { node: 'build' },
  outbox: '.maister/umbrella/outbox/d-0001',
  workspace_root: '/work',
  statement: 'Add a tag filter to the list view',
  workflow: { uses: 'workflow:development' },
};

test('seed: a driven gate request comes from gate-brief --request alone, written unchanged, then one gate-request', () => {
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  const lines = prompt.split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);

  const brief = lines.findIndex(line => /workflow\.mjs gate-brief --state=.+ --node=.+ --request$/.test(line));
  const request = lines.findIndex(line => /workflow\.mjs gate-request --state=.+ --patch-file=/.test(line));
  assert.ok(brief > 0, 'the seed names the gate-brief --request command');
  assert.ok(request > brief, 'gate-request comes after the request is printed');
  assert.match(lines[brief - 1], /The only source of the request is the engine's gate-brief verb/);
  assert.match(lines[brief + 1], /Write what it prints, unchanged, .*`\.state-patch\.json`.*never composed or edited by you/);
  assert.match(lines[brief + 1], /Then make one call to the gate-request verb/);
  assert.equal(lines.filter(line => /gate-request --state=/.test(line)).length, 1, 'one gate-request call');
});

test('seed: the worker records its dispatch id in the driver block, beside the kind and the cwd', () => {
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  const lines = prompt.split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);
  const driver = lines.filter(line => line.includes('orchestrator.driver: {'));
  assert.equal(driver.length, 1, 'one driver instruction');
  assert.match(driver[0], /\{kind: dispatch, cwd: <[^>]+>, dispatch_id: d-0001\}/);
});

test('seed: an attended worker holding a push or a pull request reports it with needs: [permission], whether or not a pull request is required', () => {
  for (const pr_required of [true, false]) {
    const envelope = { ...ENVELOPE, closeout_contract: { pr_required } };
    const prompt = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
    const lines = prompt.split('\n');
    assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);
    const closeout = lines.slice(lines.indexOf('# closeout'), lines.indexOf('# siblings'));
    const held = closeout.filter(line => /a push or a pull request is held for approval/.test(line));
    assert.equal(held.length, 1, `pr_required ${pr_required}`);
    assert.match(held[0], /followup message .*`needs: \[permission\]` in its body beside that summary/);
    assert.match(held[0], /`DISPATCH-FOLLOWUP: `.* end the turn/);
  }
  const unattended = renderSeed(buildSeed({ ...ENVELOPE, autonomy: 'auto-high' }, { pluginRoot: path.join(ROOT, 'plugins/maister') }));
  assert.doesNotMatch(unattended, /needs: \[permission\]/, 'no tier but attended holds a command for approval');
});

// The close-out section per tier and per `pr_required`, rendered from the
// envelope's own permissions as each tier's preset gives them. A worker left
// with publication undone reports the held command in a structured followup at
// every tier that cannot publish on its own; how it ends the turn depends on
// whether an operator answers inside the dispatch.

function closeoutOf(autonomy, pr_required) {
  const envelope = {
    ...ENVELOPE, autonomy, permissions: PERMISSIONS[autonomy],
    ...(pr_required === undefined ? {} : { closeout_contract: { pr_required } }),
  };
  const lines = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP, `${autonomy} ${pr_required}: the seed is ${lines.length} lines`);
  return lines.slice(lines.indexOf('# closeout'), lines.indexOf('# siblings'));
}

const unpublished = closeout => closeout.filter(line => /commits on your branch that are not pushed/.test(line));

test('seed: an attended worker ends the turn on the held-command followup, pull request required or not', () => {
  for (const pr_required of [true, false]) {
    const closeout = closeoutOf('attended', pr_required);
    assert.equal(closeout.filter(line => /a push or a pull request is held for approval/.test(line)).length, 1);
    assert.deepEqual(unpublished(closeout), [], 'an attended worker is relayed, not told to close out');
  }
});

test('seed: a worker whose tier forbids the push reports it with needs: [permission], then closes out in the same turn', () => {
  for (const autonomy of ['auto-medium', 'auto-low']) {
    const closeout = closeoutOf(autonomy, false);
    assert.ok(closeout.some(line => /No pull request is required - your tier denies opening one/.test(line)), autonomy);
    const line = unpublished(closeout);
    assert.equal(line.length, 1, autonomy);
    assert.match(line[0], /`git push` of your branch, and `gh pr create` when a pull request is owed/);
    assert.match(line[0], /followup message .*`needs: \[permission\]` in its body beside that summary/);
    assert.match(line[0], /publish the closeout in the same turn, `prs` empty/);
    assert.ok(closeout.every(text => !/held for approval/.test(text)), `${autonomy} has no operator relay`);
  }
});

test('seed: the top tier publishes on its own, so it is never told to hold a command', () => {
  const required = closeoutOf('auto-high', true);
  assert.ok(required.some(line => /A pull request is required before close-out; open it/.test(line)));
  const declined = closeoutOf('auto-high', false);
  assert.ok(declined.some(line => /Do not open one anyway/.test(line)));
  for (const closeout of [required, declined]) {
    assert.ok(closeout.every(line => !/needs: \[permission\]/.test(line)), closeout.join('\n'));
  }
});

// An envelope carrying the autonomy ceiling tells the worker to record it in
// its freeze patch, beside the driver; the value never renders as an argument,
// and the seed stays within its cap with the line added.

test('seed: the ceiling line is present with a ceiling, absent without, never an argument, and within the cap', () => {
  const pluginRoot = path.join(ROOT, 'plugins/maister');
  const recordLine = /^Record `orchestrator\.options\.ceiling: (\w+)` in your freeze patch, beside the driver: it is the autonomy ceiling your dispatch carries; the run may lower it later, never raise it\.$/;

  const without = renderSeed(buildSeed(ENVELOPE, { pluginRoot })).split('\n');
  assert.equal(without.filter(line => recordLine.test(line)).length, 0);

  const withCeiling = {
    ...ENVELOPE, ceiling: 'advice',
    workflow: { uses: 'workflow:development', with: { ceiling: 'advice', autonomy: 'attended' } },
  };
  const lines = renderSeed(buildSeed(withCeiling, { pluginRoot })).split('\n');
  const found = lines.filter(line => recordLine.test(line));
  assert.equal(found.length, 1);
  assert.equal(found[0].match(recordLine)[1], 'advice');
  const driver = lines.findIndex(line => line.includes('orchestrator.driver: {'));
  assert.ok(lines.indexOf(found[0]) > driver, 'the line follows the driver line');
  assert.ok(lines.every(line => !/^\s*ceiling = /.test(line)), 'no ceiling argument line');

  const unknown = renderSeed(buildSeed({ ...ENVELOPE, ceiling: 'everything' }, { pluginRoot })).split('\n');
  assert.equal(unknown.find(line => recordLine.test(line)).match(recordLine)[1], 'approve');

  // The worst case the other tests pin, with the ceiling line added.
  for (const autonomy of Object.keys(PERMISSIONS)) {
    for (const pr_required of [true, false]) {
      const worst = renderSeed(buildSeed({
        ...withCeiling, autonomy, permissions: PERMISSIONS[autonomy], closeout_contract: { pr_required },
        inputs: [{ path: 'research/report.md', role: 'research' }],
      }, { pluginRoot, siblings: 3 })).split('\n');
      assert.ok(worst.length <= SEED_LINE_CAP, `${autonomy} ${pr_required}: the seed is ${worst.length} lines`);
    }
  }
});
