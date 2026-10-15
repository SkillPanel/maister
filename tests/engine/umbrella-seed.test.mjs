import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

// The seed forbids hand-writing the suspend side only: a resumed worker folds
// the answer into its own run as the engine's gate reference says, and a seed
// that forbade touching the gate files would forbid that fold too.
test('seed: a gate suspends through gate-request alone, and the answer is folded as the gate reference says', () => {
  const pluginRoot = path.join(ROOT, 'plugins/maister');
  const prompt = renderSeed(buildSeed(ENVELOPE, { pluginRoot }));
  assert.doesNotMatch(prompt, /never by writing the gate files yourself/);
  const line = prompt.split('\n').find(l => l.includes('At every gate'));
  assert.ok(line, 'the seed carries the gate instruction');
  assert.match(line, /suspend the run through the gate-request verb alone, never by hand-writing the request file, the gate index or the pending marker/);
  assert.match(line, /on resume, apply the operator's answer exactly as the driver-suspended resume in \S+ says/);
  // Joined with `/` after the root, as the seed names the engine script too.
  const reference = `${pluginRoot}/skills/workflow-engine/references/gates.md`;
  assert.ok(line.includes(reference), 'the gate reference is named by its absolute path');
  assert.ok(existsSync(reference), 'the named gate reference exists');
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
    const held = closeout.filter(line => /a push or a pull request the work expects is held for approval/.test(line));
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
    assert.equal(closeout.filter(line => /a push or a pull request the work expects is held for approval/.test(line)).length, 1);
    assert.deepEqual(unpublished(closeout), [], 'an attended worker is relayed, not told to close out');
  }
});

// An approval covers one push of the branch and its pull request, for one turn
// of the same session. The relayed worker finishes first, asks once, waits by
// ending the turn, asks again the same way when a later push is refused, and
// closes out `partial` only when told to.

test('seed: an attended worker finishes everything else first, then posts exactly one followup and ends the turn', () => {
  for (const pr_required of [true, false]) {
    const held = closeoutOf('attended', pr_required).filter(line => /held for approval/.test(line));
    assert.equal(held.length, 1, `pr_required ${pr_required}`);
    assert.match(held[0], /finish everything else this node owes first\. Then write exactly one followup message/);
    assert.match(held[0], /`git push` of your branch, and `gh pr create` when a pull request is owed/);
    assert.match(held[0], /`needs: \[permission\]`.*`DISPATCH-FOLLOWUP: `.*end the turn/);
  }
});

test('seed: an attended worker runs the approved push itself, and treats a later refusal as the first hold', () => {
  for (const pr_required of [true, false]) {
    const grant = closeoutOf('attended', pr_required).filter(line => /approve one push of your branch and its pull request/.test(line));
    assert.equal(grant.length, 1, `pr_required ${pr_required}`);
    assert.match(grant[0], /resumes this session for one turn, in which you run the held push and pull request yourself and then close out `success`/);
    assert.match(grant[0], /If a later push or pull request is refused again .* treat it exactly like the first hold: one followup with `needs: \[permission\]`, then end the turn/);
    assert.match(grant[0], /Never improvise around a refusal and never wait inside a turn\./);
  }
});

test('seed: an attended worker closes out partial only on dismissal or stop', () => {
  for (const pr_required of [true, false]) {
    const partial = closeoutOf('attended', pr_required).filter(line => /`partial`/.test(line));
    assert.equal(partial.length, 1, `pr_required ${pr_required}`);
    assert.match(partial[0], /only when the followup is dismissed or a note tells you to stop/);
    assert.match(partial[0], /Never close out `partial` on your own while the followup is unanswered\./);
  }
});

test('seed: the auto tiers keep closing out in the same turn, their lines unchanged', () => {
  const forbidden = 'Your tier denies `git push` and `gh pr create` unless a gate\'s answer granted them. If you end with commits on your branch that are not pushed - because the tier forbids the push, or a push or a pull request was refused - write a followup message naming each held command (`git push` of your branch, and `gh pr create` when a pull request is owed) and what is left to do, with `needs: [permission]` in its body beside that summary. Then publish the closeout in the same turn, `prs` empty and its summary saying the branch is unpublished.';
  const tail = ['Grade the run success, partial or failed.', 'The closeout message carries the grade, a summary of what changed, and what a reviewer must check.', ''];
  assert.deepEqual(closeoutOf('auto-medium', true), [
    '# closeout', 'A pull request is required before close-out; open it and put its URL in the closeout message.', forbidden, ...tail,
  ]);
  for (const autonomy of ['auto-medium', 'auto-low']) {
    assert.deepEqual(closeoutOf(autonomy, false), [
      '# closeout', 'No pull request is required - your tier denies opening one. Say in the closeout what a reviewer has to open and merge.', forbidden, ...tail,
    ], autonomy);
  }
  for (const autonomy of ['auto-low', 'auto-medium', 'auto-high']) {
    for (const pr_required of [true, false]) {
      const closeout = closeoutOf(autonomy, pr_required).join('\n');
      assert.doesNotMatch(closeout, /exactly one followup|approve one push|Never close out `partial`/, `${autonomy} ${pr_required}`);
    }
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

// A node that publishes owes a pull request at a tier that cannot open one
// alone: the publishing gate's answer grants the push and the pull request. The
// worker is told one is owed, and how to report it if the grant never came.

test('seed: a pull request owed at a tier that denies it is required, with the held-command report beside it', () => {
  const closeout = closeoutOf('auto-medium', true);
  assert.ok(closeout.some(line => /A pull request is required before close-out; open it/.test(line)), closeout.join('\n'));
  const line = unpublished(closeout);
  assert.equal(line.length, 1);
  assert.match(line[0], /unless a gate's answer granted them/);
  assert.match(line[0], /`gh pr create` when a pull request is owed/);
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

// A dispatching run names its read-only inputs relative to the workspace root,
// and the worker's cwd is a member checkout. Under a root, a relative input is
// stated anchored there; an absolute one and a value that is not a path are
// stated as given. Without a root the inputs render exactly as they always did.

const INPUTS = [
  { path: '.maister/work/d-0001/context.md', role: 'context' },
  { path: 'research/report.md', role: 'research' },
  { path: '/abs/spec.md', role: 'spec' },
  { path: 'attended', role: 'mode' },
  { path: 42, role: 'count' },
  { path: true, role: 'flag' },
];

function seedLines(envelope) {
  const lines = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split(/\r?\n/);
  assert.ok(lines.length <= SEED_LINE_CAP, `the seed is ${lines.length} lines`);
  return lines;
}

function inputBlockOf(lines) {
  const header = lines.findIndex(line => line.startsWith('Inputs from the dispatching run'));
  assert.ok(header > lines.indexOf('# task'), 'the inputs are stated under # task');
  return lines.slice(header, header + 1 + INPUTS.length);
}

test('seed: under a workspace root a relative input is anchored there, an absolute one and a value are stated as given', () => {
  const root = ENVELOPE.workspace_root;
  const [header, ...inputs] = inputBlockOf(seedLines({ ...ENVELOPE, inputs: INPUTS }));
  assert.match(header, /read-only, each relative path anchored at the workspace root/);
  assert.doesNotMatch(header, /spelled as that run named them/);
  assert.equal(inputs[0], `  ${root}/.maister/work/d-0001/context.md (context)`);
  assert.equal(inputs[1], `  ${root}/research/report.md (research - required reading: read it in full before any work starts)`);
  assert.equal(inputs[2], '  /abs/spec.md (spec)', 'an absolute input is kept');
  assert.deepEqual(inputs.slice(3), ['  attended (mode)', '  42 (count)', '  true (flag)'], 'a value is not a path');
});

test('seed: an anchored input drops its ./ segments, and a clean one is unchanged', () => {
  const root = ENVELOPE.workspace_root;
  const dotted = [
    { path: './context.md', role: 'context' },
    { path: 'notes/./plan.md', role: 'plan' },
    { path: 'research/report.md', role: 'brief' },
  ];
  const lines = seedLines({ ...ENVELOPE, inputs: dotted });
  const header = lines.findIndex(line => line.startsWith('Inputs from the dispatching run'));
  assert.deepEqual(lines.slice(header + 1, header + 1 + dotted.length), [
    `  ${root}/context.md (context)`,
    `  ${root}/notes/plan.md (plan)`,
    `  ${root}/research/report.md (brief)`,
  ]);
});

test('seed: control — without a workspace root the inputs render as the run named them', () => {
  const { workspace_root, ...unrooted } = ENVELOPE;
  assert.deepEqual(inputBlockOf(seedLines({ ...unrooted, inputs: INPUTS })), [
    'Inputs from the dispatching run, read-only and spelled as that run named them rather than anchored here. Read each where it is, never copying it into your checkout; if you need its content in your own tree, write your own file from what you read. If one does not resolve, send a blocked message rather than guessing:',
    '  .maister/work/d-0001/context.md (context)',
    '  research/report.md (research - required reading: read it in full before any work starts)',
    '  /abs/spec.md (spec)',
    '  attended (mode)',
    '  42 (count)',
    '  true (flag)',
  ]);
});

// A read-only grant refuses a copy out of another run's outputs, so the inputs
// header says to read each in place; a worker that needs the content in its own
// tree writes its own file. Said on the header line, so the cap does not move.
test('seed: the inputs are read in place, never copied into the checkout, rooted or not', () => {
  const { workspace_root, ...unrooted } = ENVELOPE;
  for (const envelope of [ENVELOPE, unrooted]) {
    const [header] = inputBlockOf(seedLines({ ...envelope, inputs: INPUTS }));
    assert.match(header, /Read each where it is, never copying it into your checkout; if you need its content in your own tree, write your own file from what you read\./);
  }
});

// A permission rule matches one command, so a chained line is offered only a
// dismissal. The tier line says so at every tier, on the same line.
test('seed: the tier line says one command per line, never chained, with the engine JSON route excepted', () => {
  for (const autonomy of Object.keys(PERMISSIONS)) {
    const lines = seedLines({ ...ENVELOPE, autonomy, permissions: PERMISSIONS[autonomy] });
    const tier = lines.filter(line => line.startsWith('Autonomy tier '));
    assert.equal(tier.length, 1, autonomy);
    assert.match(tier[0], /Run one command per line, never several chained with `&&`, `;` or `\|`: a permission rule matches a single command/);
    assert.match(tier[0], /The one exception is the JSON a workflow-engine verb takes, sent as that skill documents\./);
  }
});

test('seed: the identity section no longer names the read-only inputs as an exception', () => {
  const { workspace_root, ...unrooted } = ENVELOPE;
  for (const envelope of [ENVELOPE, unrooted]) {
    const lines = seedLines({ ...envelope, inputs: INPUTS });
    const identity = lines.slice(lines.indexOf('# identity'), lines.indexOf('# task'));
    const work = identity.find(line => line.startsWith('Work in '));
    assert.ok(work, 'the identity section says where to work');
    assert.doesNotMatch(work, /exception|read-only inputs/, work);
  }
  const rooted = seedLines({ ...ENVELOPE, inputs: INPUTS }).find(line => line.startsWith('Work in '));
  assert.equal(rooted, `Work in ${ENVELOPE.workspace_root}/members/app. Every path below is absolute; write nothing outside that directory except the outbox input file and through the outbox verb, both named below.`);
});

// A seed lists the outcome's other dispatches only when its envelope does; with
// none it renders exactly the section it always did, and a malformed list is
// refused rather than rendered.

function siblingsOf(envelope) {
  const lines = renderSeed(buildSeed(envelope, { pluginRoot: path.join(ROOT, 'plugins/maister') })).split('\n');
  assert.ok(lines.length <= SEED_LINE_CAP);
  return lines.slice(lines.indexOf('# siblings'));
}

// A sibling's worktree is relative to its member, as the target's is: the
// envelope carries the member's path, and the seed joins the two under the root.
test('seed: listed siblings are named read-only, each worktree relative to its member', () => {
  const root = ENVELOPE.workspace_root;
  const section = siblingsOf({ ...ENVELOPE, siblings: [
    { member: 'api', path: 'members/api', branch: 'feature/run-api', worktree: '.worktrees/run-api' },
    { member: 'web', path: 'members/web', branch: 'feature/run-web', worktree: '/elsewhere/web' },
    { member: 'docs', branch: 'feature/run-docs', worktree: '.worktrees/run-docs' },
  ] });
  assert.ok(section.includes(`- api: worktree ${root}/members/api/.worktrees/run-api, branch feature/run-api`), section.join('\n'));
  assert.ok(section.includes('- web: worktree /elsewhere/web, branch feature/run-web'), 'an absolute path is kept');
  assert.ok(section.includes('- docs: worktree .worktrees/run-docs, branch feature/run-docs'), 'a member the manifest does not declare is stated as given');
  assert.ok(section.some(line => /for reading only - never edit/.test(line)));
  assert.ok(section.some(line => /never read or write another dispatch's outbox/.test(line)));
});

test('seed: the target line is unchanged by listed siblings', () => {
  const root = ENVELOPE.workspace_root;
  const pluginRoot = path.join(ROOT, 'plugins/maister');
  const envelope = { ...ENVELOPE, target: { ...ENVELOPE.target, worktree: '.worktrees/run-app' } };
  const memberLine = (doc) => renderSeed(buildSeed(doc, { pluginRoot })).split('\n').find(line => line.startsWith('Member '));
  const expected = `Member app, checked out at ${root}/members/app, worktree ${root}/members/app/.worktrees/run-app.`;
  assert.equal(memberLine(envelope), expected);
  assert.equal(memberLine({ ...envelope, siblings: [
    { member: 'api', path: 'members/api', branch: 'feature/run-api', worktree: '.worktrees/run-api' },
  ] }), expected);
});

test('seed: control — no siblings listed renders the section unchanged', () => {
  assert.deepEqual(siblingsOf(ENVELOPE), [
    '# siblings',
    'You may be running alongside other workers. Coordinate only through the outbox.',
    "Never edit a sibling's repository, and never read or write another dispatch's outbox.",
  ]);
  assert.deepEqual(siblingsOf({ ...ENVELOPE, siblings: [] }), siblingsOf(ENVELOPE));
});

test('seed: a malformed siblings list is refused seed-envelope-invalid', () => {
  assert.throws(() => buildSeed({ ...ENVELOPE, siblings: [{ member: 'api' }] }, { pluginRoot: path.join(ROOT, 'plugins/maister') }),
    error => error.code === 'seed-envelope-invalid' && /siblings entry 0 has no branch/.test(error.message));
});
