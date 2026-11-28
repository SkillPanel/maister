// `write-state --next`: the closing write that, once it lands, walks the run
// past its off-path steps and prints the brief of the step it stops at, so
// one call does what a write, its skip writes and a `node-brief` did. Without
// the flag every byte and the exit code are as before. With it a refused
// write prints its refusal alone and walks nothing, a freeze adds nothing,
// and any failure after the landing prints one `warning:` line and the
// `next:` line the state on disk gives, at exit 0. The fallbacks are driven
// in-process through `lib/closing-walk.mjs`, with an injected writer, bound
// or brief. Where the run cannot go on from the write — its ending recorded,
// a revise not yet applied, a stop answered, a step under way, a definition
// drifted — the walk skips and briefs nothing. Every case runs on both trees,
// the source and the variant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FIXTURES, ROOT, SAMPLE, freeze, freezePatch, readState, run, scratch, variantRoot, write } from '../helpers.mjs';

const DEFINITION = `name: skip-walk
version: 1
nodes:
  work:
    uses: direct:work
    needs: []
    outputs:
      values:
        deep: bool
  recover:
    uses: direct:recover
    needs: [work]
    on: failure
  audit:
    uses: direct:audit
    needs: [recover]
    when: "\${work.values.deep}"
  review:
    uses: direct:review
    needs: [audit]
  tidy:
    uses: direct:tidy
    needs: [review]
    when: "\${work.values.deep}"
display:
  titles:
    work: Work
    recover: Recover
    audit: Audit
    review: Review
    tidy: Tidy
`;

const PROSE = ['work', 'recover', 'audit', 'review', 'tidy'].map(id => `## \`${id}\`\n\nDo ${id}.\n`).join('\n');
const GUARD = '${work.values.deep}';
const COMPLETE_WORK = { nodes: { work: { status: 'completed', values: { deep: false } } }, node_summaries: { work: { summary: 'Worked.' } } };
const REFUSED = { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } };

const TREES = [['source', () => path.join(ROOT, 'plugins', 'maister')], ['variant', () => variantRoot()]];

const engineIn = tree => path.join(tree, 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');
const writeRules = tree => path.join(tree, 'skills', 'workflow-engine', 'references', 'writing-state.md');

/** A frozen run of `skip-walk` in a scratch project of its own, its first step started unless `started` is false. */
function frozenRun(t, { started = true } = {}) {
  const runAt = scratch(t, { type: 'skip-walk', name: '2026-01-05-walk' });
  const home = path.join(runAt.root, '.maister', 'workflows');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'skip-walk.yml'), DEFINITION);
  fs.writeFileSync(path.join(home, 'skip-walk.md'), `# Skip walk — node prose\n\n${PROSE}`);
  freeze(runAt, { definition: path.join(home, 'skip-walk.yml'), task: { title: 'Skip walk' } });
  if (started) write(runAt, { nodes: { work: { status: 'running' } } });
  return runAt;
}

/** `write-state` of one tree, the patch on stdin. */
function writeState(tree, runAt, patch, flags = []) {
  return run(engineIn(tree), ['write-state', `--state=${runAt.state}`, ...flags], patch);
}

/** `write-state` of one tree, the patch in the run's patch file. */
function writeFromFile(tree, runAt, patch, flags = []) {
  const file = path.join(runAt.dir, '.state-patch.json');
  fs.writeFileSync(file, JSON.stringify(patch));
  return { file, result: run(engineIn(tree), ['write-state', `--state=${runAt.state}`, `--patch-file=${file}`, ...flags]) };
}

/** Each scratch root in `text` replaced by one placeholder, so two runs' prints compare. */
function rooted(text, runAt) {
  return text.split(runAt.root).join('<root>');
}

/** The closing walk of one tree, imported in this process. */
async function closingWalkOf(tree) {
  const lib = path.join(tree, 'skills', 'workflow-engine', 'scripts', 'lib');
  return (await import(pathToFileURL(path.join(lib, 'closing-walk.mjs')).href)).closingWalk;
}

const statusOf = (runAt, id) => readState(runAt).workflow.nodes[id].status ?? 'pending';

/** Each node's status, by id: two runs written a second apart differ in their clock fields only. */
const statuses = runAt => Object.fromEntries(Object.entries(readState(runAt).workflow.nodes).map(([id, entry]) => [id, entry.status ?? 'pending']));

const REVISE = path.join(FIXTURES, 'definitions', 'revise.yml');
const CLOSING_LINE = 'next: none — write the closing patch with task.status, then run run-complete';
const STOP_LINE = 'next: none — review-approval was answered with a stop: write the closing patch with task.status stopped'
  + ' and every node not yet run stopped, then run run-complete';

/** A run frozen from the review loop, standing at its gate: the draft, the review and the side note ended, the figures skipped. */
function atReviewGate(t) {
  const runAt = scratch(t);
  freeze(runAt, { definition: REVISE });
  write(runAt, { nodes: { draft: { status: 'completed', values: { needs_figures: false } } }, node_summaries: { draft: { summary: 'Drafted.' } } });
  write(runAt, { nodes: { figures: { status: 'skipped' }, 'side-note': { status: 'completed' } } });
  write(runAt, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } });
  return runAt;
}

/** The review gate recorded completed with `option` as its answer. */
const reviewAnswered = option => ({
  nodes: { 'review-approval': { status: 'completed' } },
  node_summaries: { 'review-approval': { decisions: [{ option, answered_by: 'tester', at: '2026-01-05T09:40:00Z' }] } },
});

/**
 * `patch` sent through one tree's `write-state` to two runs `make` builds
 * alike, with `--next` to the first and without it to the second: both prints
 * with their roots masked, and both runs.
 */
function twinWrites(t, tree, make, patch) {
  const walked = make(t);
  const plain = make(t);
  const masked = (result, runAt) => ({ code: result.code, stdout: rooted(result.stdout, runAt), stderr: rooted(result.stderr, runAt) });
  return {
    walked,
    plain,
    withNext: masked(writeState(tree, walked, typeof patch === 'function' ? patch(walked) : patch, ['--next']), walked),
    without: masked(writeState(tree, plain, typeof patch === 'function' ? patch(plain) : patch), plain),
  };
}

/** The pending nodes of a run, each sent `skipped`, as a stop's closing patch sends them. */
function restSkipped(runAt) {
  const nodes = readState(runAt).workflow.nodes;
  return Object.fromEntries(Object.keys(nodes).filter(id => (nodes[id].status ?? 'pending') === 'pending').map(id => [id, { status: 'skipped' }]));
}

for (const [name, treeOf] of TREES) {
  test(`${name}: without --next, stdout, stderr and the exit code are what they were over a start, a refusal, a completion and an empty write`, t => {
    const tree = treeOf();
    const runAt = frozenRun(t, { started: false });
    assert.deepEqual(writeState(tree, runAt, { nodes: { work: { status: 'running' } } }), {
      code: 0,
      stdout: 'workflow.nodes.work\norchestrator.started_phase\norchestrator.updated\ndashboard-data.js\n',
      stderr: '',
    });
    const refused = writeState(tree, runAt, REFUSED);
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, '');
    assert.equal(refused.stderr, 'state-node-needs-unmet: this write completes a node before a node it needs has ended: review needs audit.'
      + ' Nothing was written. work, audit are on the path the run takes, so run or ask them first, then send this write again.'
      + ' recover is off the path (a false guard) and will be recorded skipped by that write. Never record a node completed or'
      + ' skipped to get past this: the record says which steps ran\n'
      + `rules: ${writeRules(tree)} § When a write is refused § state-node-needs-unmet\n`);
    assert.deepEqual(writeState(tree, runAt, COMPLETE_WORK), {
      code: 0,
      stdout: 'workflow.nodes.work\nnode_summaries.work\norchestrator.completed_phases\norchestrator.updated\ndashboard-data.js\n'
        + '\nnext: recover (Recover) — run node-brief for it\n',
      stderr: '',
    });
    assert.deepEqual(writeState(tree, runAt, {}), { code: 0, stdout: 'orchestrator.updated\ndashboard-data.js\n', stderr: '' });
  });

  test(`${name}: a refused write with --next exits 1, prints its refusal alone, keeps the patch file and walks nothing`, t => {
    const tree = treeOf();
    const runAt = frozenRun(t);
    const before = fs.readFileSync(runAt.state, 'utf8');
    const plain = writeFromFile(tree, runAt, REFUSED).result;
    const { file, result } = writeFromFile(tree, runAt, REFUSED, ['--next']);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, plain.stderr, 'the refusal and its pointer, nothing else');
    assert.match(result.stderr, /\nrules: .* § When a write is refused § state-node-needs-unmet\n$/);
    assert.ok(fs.existsSync(file), 'the patch file is kept for correcting');
    assert.equal(fs.readFileSync(runAt.state, 'utf8'), before, 'the state is byte for byte as it was');
  });

  test(`${name}: a freeze patch with --next prints what the freeze prints without it`, t => {
    const tree = treeOf();
    const runs = [scratch(t, { type: 'skip-walk', name: '2026-01-05-walk' }), scratch(t, { type: 'skip-walk', name: '2026-01-05-walk' })];
    const prints = runs.map((runAt, index) => {
      const home = path.join(runAt.root, '.maister', 'workflows');
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, 'skip-walk.yml'), DEFINITION);
      fs.writeFileSync(path.join(home, 'skip-walk.md'), `# Skip walk — node prose\n\n${PROSE}`);
      const { patch } = freezePatch({ definition: path.join(home, 'skip-walk.yml'), task: { title: 'Skip walk' } });
      const result = writeState(tree, runAt, patch, index === 0 ? ['--no-open', '--next'] : ['--no-open']);
      return { code: result.code, stdout: rooted(result.stdout, runAt), stderr: rooted(result.stderr, runAt) };
    });
    assert.equal(prints[0].code, 0);
    assert.deepEqual(prints[0], prints[1]);
    assert.deepEqual(readState(runs[0]).workflow.nodes, readState(runs[1]).workflow.nodes, 'nothing walked after the freeze');
  });

  test(`${name}: with --next, today's report, a blank line, the skips and the announcing next: line, a blank line, then the brief node-brief prints`, t => {
    const tree = treeOf();
    const walked = frozenRun(t);
    const separate = frozenRun(t);

    const result = writeState(tree, walked, COMPLETE_WORK, ['--next']);
    assert.equal(result.code, 0);

    // The same moves as separate calls, in a run of their own.
    const report = writeState(tree, separate, COMPLETE_WORK);
    const nextLine = '\nnext: recover (Recover) — run node-brief for it\n';
    assert.ok(report.stdout.endsWith(nextLine));
    for (const id of ['recover', 'audit']) assert.equal(writeState(tree, separate, { nodes: { [id]: { status: 'skipped' } } }).code, 0);
    const brief = run(engineIn(tree), ['node-brief', `--state=${separate.state}`, '--node=review']);
    assert.equal(brief.code, 0, brief.stderr);

    assert.equal(rooted(result.stdout, walked), rooted(report.stdout.slice(0, -nextLine.length), separate)
      + '\n'
      + 'skipped: recover (Recover) — it runs only on a failure, and nothing failed\n'
      + `skipped: audit (Audit) — its guard ${GUARD} reads false\n`
      + 'next: review (Review) — its brief follows\n'
      + '\n'
      + rooted(brief.stdout, separate));
    assert.doesNotMatch(result.stdout, /next: recover/, 'the line the write alone prints is not printed');
    assert.equal(result.stderr, '');

    for (const id of ['recover', 'audit']) assert.equal(statusOf(walked, id), 'skipped');
    assert.equal(statusOf(walked, 'review'), 'running', 'the brief recorded the start, as node-brief does');
    const published = JSON.parse(fs.readFileSync(path.join(walked.dir, 'display', 'brief.json'), 'utf8'));
    assert.equal(published.node, 'review');
    assert.deepEqual(statuses(walked), statuses(separate));
  });

  test(`${name}: in-process, a refused skip write gives the next-skip-refused warning and today's line`, async t => {
    const closingWalk = await closingWalkOf(treeOf());
    const runAt = frozenRun(t);
    write(runAt, COMPLETE_WORK);
    const before = fs.readFileSync(runAt.state, 'utf8');
    const writer = () => ({ ok: false, errors: [{ code: 'state-held-elsewhere', message: 'state-held-elsewhere: held' }] });
    const result = closingWalk({ state: runAt.state, writer });
    assert.deepEqual(result.warnings, ['warning: next-skip-refused: recover was not recorded skipped (state-held-elsewhere); nothing after it was walked or briefed']);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.next, { id: 'recover', title: 'Recover' }, 'the line node-brief is named for, from the state on disk');
    assert.equal(result.brief, null);
    assert.equal(fs.readFileSync(runAt.state, 'utf8'), before);
  });

  test(`${name}: in-process, the bound reached gives the next-walk-unsettled warning after the skips made, and today's line`, async t => {
    const closingWalk = await closingWalkOf(treeOf());
    const runAt = frozenRun(t);
    write(runAt, COMPLETE_WORK);
    const result = closingWalk({ state: runAt.state, bound: 1 });
    assert.deepEqual(result.warnings, ['warning: next-walk-unsettled: the walk did not settle within 1 steps; nothing after the writes above was walked or briefed']);
    assert.deepEqual(result.lines, ['skipped: recover (Recover) — it runs only on a failure, and nothing failed']);
    assert.deepEqual(result.next, { id: 'audit', title: 'Audit' });
    assert.equal(result.brief, null);
    assert.equal(statusOf(runAt, 'audit'), 'pending', 'nothing past the bound was written');
  });

  test(`${name}: in-process, a brief that refuses or throws gives the next-brief-failed warning and today's line`, async t => {
    const closingWalk = await closingWalkOf(treeOf());
    const refusedRun = frozenRun(t);
    write(refusedRun, COMPLETE_WORK);
    const refusing = () => ({ ok: false, text: '', errors: [{ code: 'node-brief-not-a-run', message: 'node-brief-not-a-run: no run' }], warnings: [] });
    const refused = closingWalk({ state: refusedRun.state, brief: refusing });
    assert.deepEqual(refused.warnings, ['warning: next-brief-failed: the brief of review could not be printed (node-brief-not-a-run)']);
    assert.deepEqual(refused.lines, [
      'skipped: recover (Recover) — it runs only on a failure, and nothing failed',
      `skipped: audit (Audit) — its guard ${GUARD} reads false`,
    ]);
    assert.deepEqual(refused.next, { id: 'review', title: 'Review' });
    assert.equal(refused.brief, null);

    const thrownRun = frozenRun(t);
    write(thrownRun, COMPLETE_WORK);
    const thrown = closingWalk({ state: thrownRun.state, brief: () => { throw new Error('disk gone'); } });
    assert.deepEqual(thrown.warnings, ['warning: next-brief-failed: the brief of review could not be printed (disk gone)']);
    assert.deepEqual(thrown.next, { id: 'review', title: 'Review' });
    assert.equal(thrown.brief, null);
  });

  test(`${name}: with the task's ending recorded, --next prints what the closing patch prints without it, though a stop answer is on disk`, t => {
    const tree = treeOf();
    const stopped = t2 => {
      const runAt = atReviewGate(t2);
      write(runAt, reviewAnswered('abandon'));
      return runAt;
    };
    const { withNext, without, walked, plain } = twinWrites(t, tree, stopped, runAt => ({ task: { status: 'stopped' }, nodes: restSkipped(runAt) }));
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.deepEqual(withNext, without);
    assert.doesNotMatch(withNext.stdout, /next:/, 'the stop line the gate earned was printed by the write that answered it');
    assert.deepEqual(statuses(walked), statuses(plain));
  });

  test(`${name}: at a revise not yet applied, --next prints what the write prints without it and skips or briefs nothing`, t => {
    const tree = treeOf();
    const { withNext, without, walked, plain } = twinWrites(t, tree, atReviewGate, reviewAnswered('send-back'));
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.deepEqual(withNext, without);
    assert.ok(withNext.stdout.endsWith('\nnext: publish (Publish) — run node-brief for it\n'), withNext.stdout);
    assert.equal(statusOf(walked, 'publish'), 'pending', 'no brief recorded a start');
    assert.equal(fs.existsSync(path.join(walked.dir, 'display', 'brief.json')), false, 'no brief was published');
    assert.deepEqual(statuses(walked), statuses(plain));
  });

  test(`${name}: a stop answer read from disk prints the stop line after a later write that ends no node`, t => {
    const tree = treeOf();
    const stopped = t2 => {
      const runAt = atReviewGate(t2);
      write(runAt, reviewAnswered('abandon'));
      return runAt;
    };
    const { withNext, without, walked } = twinWrites(t, tree, stopped, {});
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.deepEqual(without, { code: 0, stdout: 'orchestrator.updated\ndashboard-data.js\n', stderr: '' });
    assert.deepEqual(withNext, { code: 0, stdout: `orchestrator.updated\ndashboard-data.js\n\n${STOP_LINE}\n`, stderr: '' });
    assert.equal(statusOf(walked, 'publish'), 'pending', 'the step after the stop is neither skipped nor briefed');
  });

  test(`${name}: a gate pending, a step running beside the one due, or a sub-run waited on: --next prints what the write prints without it`, t => {
    const tree = treeOf();

    const pending = twinWrites(t, tree, t2 => {
      const runAt = atReviewGate(t2);
      fs.mkdirSync(path.join(runAt.dir, 'gates'), { recursive: true });
      fs.writeFileSync(path.join(runAt.dir, 'gates', 'review-approval.request.yml'), 'version: 1\nnode: review-approval\nanswer: null\n');
      return runAt;
    }, {
      orchestrator: { gate_pending: { node: 'review-approval', request: 'gates/review-approval.request.yml', since: '2026-01-05T09:00:00Z' } },
      nodes: { 'review-approval': { status: 'suspended' } },
    });
    assert.equal(pending.withNext.code, 0, pending.withNext.stderr);
    assert.deepEqual(pending.withNext, pending.without, 'a gate pending');
    assert.deepEqual(statuses(pending.walked), statuses(pending.plain));

    const running = twinWrites(t, tree, t2 => {
      const runAt = scratch(t2);
      freeze(runAt, { definition: REVISE });
      write(runAt, { nodes: { draft: { status: 'running' } } });
      return runAt;
    }, {
      nodes: { draft: { status: 'completed', values: { needs_figures: false } }, 'side-note': { status: 'running' } },
      node_summaries: { draft: { summary: 'Drafted.' } },
    });
    assert.equal(running.withNext.code, 0, running.withNext.stderr);
    assert.deepEqual(running.withNext, running.without, 'a step running');
    assert.ok(running.withNext.stdout.endsWith('\nnext: figures (Figures) — run node-brief for it\n'), 'the line the write that ended a node prints');
    assert.equal(statusOf(running.walked, 'figures'), 'pending', 'its false guard is left for later');

    const waiting = twinWrites(t, tree, t2 => {
      const runAt = scratch(t2);
      freeze(runAt, { definition: SAMPLE });
      write(runAt, { nodes: { analysis: { status: 'completed' } } });
      write(runAt, { nodes: { approval: { status: 'completed' } } });
      return runAt;
    }, { nodes: { implementation: { status: 'completed' }, research: { status: 'waiting' } } });
    assert.equal(waiting.withNext.code, 0, waiting.withNext.stderr);
    assert.deepEqual(waiting.withNext, waiting.without, 'a sub-run waited on');
    assert.doesNotMatch(waiting.withNext.stdout, /next:/);
  });

  test(`${name}: under a drifted definition, --next skips nothing and prints today's line where the write alone prints none`, t => {
    const tree = treeOf();
    const drifted = t2 => {
      const runAt = frozenRun(t2);
      write(runAt, COMPLETE_WORK);
      const definition = path.join(runAt.root, '.maister', 'workflows', 'skip-walk.yml');
      fs.writeFileSync(definition, fs.readFileSync(definition, 'utf8').replace('needs: [audit]', 'needs: [audit, recover]'));
      return runAt;
    };
    const { withNext, without, walked } = twinWrites(t, tree, drifted, {});
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.equal(without.stdout, 'orchestrator.updated\ndashboard-data.js\n');
    assert.deepEqual(withNext, { ...without, stdout: `${without.stdout}\nnext: recover (Recover) — run node-brief for it\n` });
    assert.equal(statusOf(walked, 'recover'), 'pending', 'nothing skipped under drift');
  });

  test(`${name}: with only the closing patch left, --next prints the closing line after the skips`, t => {
    const tree = treeOf();
    const atReview = t2 => {
      const runAt = frozenRun(t2);
      write(runAt, COMPLETE_WORK);
      write(runAt, { nodes: { recover: { status: 'skipped' }, audit: { status: 'skipped' } } });
      write(runAt, { nodes: { review: { status: 'running' } } });
      return runAt;
    };
    const { withNext, without, walked } = twinWrites(t, tree, atReview, { nodes: { review: { status: 'completed' } }, node_summaries: { review: { summary: 'Reviewed.' } } });
    assert.equal(withNext.code, 0, withNext.stderr);
    const todays = '\nnext: tidy (Tidy) — run node-brief for it\n';
    assert.ok(without.stdout.endsWith(todays));
    assert.deepEqual(withNext, {
      ...without,
      stdout: `${without.stdout.slice(0, -todays.length)}\nskipped: tidy (Tidy) — its guard ${GUARD} reads false\n${CLOSING_LINE}\n`,
    });
    assert.equal(statusOf(walked, 'tidy'), 'skipped');
  });

  test(`${name}: a failed write walks like any other: it briefs an on-failure step, and with nothing left prints the closing line`, t => {
    const tree = treeOf();
    const walked = frozenRun(t);
    const separate = frozenRun(t);

    const failed = writeState(tree, walked, { nodes: { work: { status: 'failed' } } }, ['--next']);
    assert.equal(failed.code, 0, failed.stderr);
    const report = writeState(tree, separate, { nodes: { work: { status: 'failed' } } });
    assert.doesNotMatch(report.stdout, /next:/, 'the write alone prints no next line for a failure');
    const brief = run(engineIn(tree), ['node-brief', `--state=${separate.state}`, '--node=recover']);
    assert.equal(brief.code, 0, brief.stderr);
    assert.equal(rooted(failed.stdout, walked), `${rooted(report.stdout, separate)}\nnext: recover (Recover) — its brief follows\n\n${rooted(brief.stdout, separate)}`);
    assert.equal(statusOf(walked, 'recover'), 'running');

    const last = writeState(tree, walked, { nodes: { recover: { status: 'failed' } } }, ['--next']);
    assert.equal(last.code, 0, last.stderr);
    const lastReport = writeState(tree, separate, { nodes: { recover: { status: 'failed' } } });
    assert.doesNotMatch(lastReport.stdout, /next:/);
    assert.equal(rooted(last.stdout, walked), `${rooted(lastReport.stdout, separate)}\n${CLOSING_LINE}\n`);
    assert.equal(last.stderr, lastReport.stderr);
  });
}
