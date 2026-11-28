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

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { FIXTURES, ROOT, SAMPLE, delegating, freeze, freezePatch, readState, run, scratch, variantRoot, write } from '../helpers.mjs';
import { refreshIndex } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-index.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

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

/** The line a due gate asked in session prints first in place of its `ask it:` line, its question below. */
const QUESTION_LINE = 'question: printed last, below — ask it with the question tool exactly as printed, never rebuilt';
const STOP_LINE = 'next: none — review-approval was answered with a stop: write the closing patch with task.status stopped'
  + ' and every node not yet run stopped, then run run-complete';

/** A run frozen from the review loop, standing at its gate: the draft, the review and the side note ended, the figures skipped. */
function atReviewGate(t, orchestrator = {}) {
  const runAt = scratch(t);
  freeze(runAt, { definition: REVISE, orchestrator });
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

// The rows that walk on and the rows that brief: a gate the project's config
// continues is recorded where the walk stands and the walk goes on past it; a
// continue the brief advises against, or whose write is refused, is briefed
// with the walk's outcome handed in, never attempted twice; a task step, a
// `dir:` step, a sub-run step and a gate on the path are briefed as
// `node-brief` briefs them, the start recorded only where the brief records it.

const WALK_CONFIG = `name: walk-config
version: 1
nodes:
  work:
    uses: direct:work
    needs: []
    outputs:
      values:
        deep: bool
  approve:
    type: gate
    needs: [work]
    ask: "Work done. Go on?"
    options:
      go-on: continue
      rework: {effect: revise, reruns: work}
      stop-here: stop
  audit:
    uses: direct:audit
    needs: [approve]
    when: "\${work.values.deep}"
  recover:
    uses: direct:recover
    needs: [audit]
    on: failure
  review:
    uses: direct:review
    needs: [recover]
display:
  titles:
    work: Work
    approve: Approve
    audit: Audit
    recover: Recover
    review: Review
`;

const WALK_DIR = `name: walk-dir
version: 1
nodes:
  work:
    uses: direct:work
    needs: []
  remote:
    uses: workflow:walk-dir
    dir: "members/one"
    needs: [work]
display:
  titles:
    work: Work
    remote: Remote
`;

const AUTO = 'workflows:\n  walk-config:\n    auto_continue: [approve]\n';
const DECIDED = "decided: approve — go-on, by the project's config (workflows.walk-config.auto_continue); nothing to ask, nothing to write";
const ANSWER_APPROVE = {
  nodes: { approve: { status: 'completed' } },
  node_summaries: { approve: { decisions: [{ option: 'go-on', answered_by: 'tester', at: '2026-01-05T09:40:00Z' }] } },
};
const workDone = (values, summary = {}) => ({
  nodes: { work: { status: 'completed', ...(values === null ? {} : { values }) } },
  node_summaries: { work: { summary: 'Worked.', ...summary } },
});

/** A frozen run of `definition` (named `name`) in a scratch project of its own, the project's `config` beside it, its first step started. */
function projectRun(t, { name, definition, ids, config = null, orchestrator = {} }) {
  const runAt = scratch(t, { type: name, name: '2026-01-05-walk' });
  const home = path.join(runAt.root, '.maister', 'workflows');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, `${name}.yml`), definition);
  fs.writeFileSync(path.join(home, `${name}.md`), `# ${name} — node prose\n\n${ids.map(id => `## \`${id}\`\n\nDo ${id}.\n`).join('\n')}`);
  if (config !== null) fs.writeFileSync(path.join(runAt.root, '.maister', 'config.yml'), config);
  freeze(runAt, { definition: path.join(home, `${name}.yml`), task: { title: 'Walk' }, orchestrator });
  write(runAt, { nodes: { work: { status: 'running' } } });
  return runAt;
}

const configRun = (t, options = {}) => projectRun(t, { name: 'walk-config', definition: WALK_CONFIG, ids: ['work', 'approve', 'audit', 'recover', 'review'], ...options });

/** The node-brief of one tree, printed. */
function briefOf(tree, runAt, node) {
  const brief = run(engineIn(tree), ['node-brief', `--state=${runAt.state}`, `--node=${node}`]);
  assert.equal(brief.code, 0, brief.stderr);
  return brief.stdout;
}

/** A write's print without the `next:` line it ends on, which must be `line`. */
function withoutNext(stdout, line) {
  const tail = `\n${line}\n`;
  assert.ok(stdout.endsWith(tail), stdout);
  return stdout.slice(0, -tail.length);
}

const PERMISSIONS_SKIP = process.platform === 'win32' || process.getuid?.() === 0 ? 'permissions do not stop this user from writing' : false;

for (const [name, treeOf] of TREES) {
  test(`${name}: off-path steps give their skipped: lines in walk order, a guard before a failure, then the announcing next: line and the brief`, t => {
    const tree = treeOf();
    const walked = configRun(t);
    const separate = configRun(t);
    for (const runAt of [walked, separate]) write(runAt, workDone({ deep: false }));

    const result = writeState(tree, walked, ANSWER_APPROVE, ['--next']);
    assert.equal(result.code, 0, result.stderr);
    const report = writeState(tree, separate, ANSWER_APPROVE);
    for (const id of ['audit', 'recover']) assert.equal(writeState(tree, separate, { nodes: { [id]: { status: 'skipped' } } }).code, 0);
    const brief = briefOf(tree, separate, 'review');

    assert.equal(rooted(result.stdout, walked), rooted(withoutNext(report.stdout, 'next: audit (Audit) — run node-brief for it'), separate)
      + '\n'
      + `skipped: audit (Audit) — its guard ${GUARD} reads false\n`
      + 'skipped: recover (Recover) — it runs only on a failure, and nothing failed\n'
      + 'next: review (Review) — its brief follows\n'
      + '\n'
      + rooted(brief, separate));
    assert.equal(result.stderr, '');
    assert.deepEqual(statuses(walked), statuses(separate));
  });

  test(`${name}: a gate the config continues gives its decided: and say: lines without the inner next: line, and the walk goes on`, t => {
    const tree = treeOf();
    const walked = configRun(t, { config: AUTO });
    const separate = configRun(t, { config: AUTO });

    const result = writeState(tree, walked, workDone({ deep: false }), ['--next']);
    assert.equal(result.code, 0, result.stderr);
    const report = writeState(tree, separate, workDone({ deep: false }));
    const gate = briefOf(tree, separate, 'approve').trimEnd().split('\n');
    const [decided, say, inner] = gate.slice(-3);
    assert.equal(decided, DECIDED);
    assert.match(say, /^say: /);
    assert.equal(inner, 'next: audit (Audit) — run node-brief for it', 'node-brief alone keeps its inner next: line');
    for (const id of ['audit', 'recover']) assert.equal(writeState(tree, separate, { nodes: { [id]: { status: 'skipped' } } }).code, 0);
    const brief = briefOf(tree, separate, 'review');

    assert.equal(rooted(result.stdout, walked), rooted(withoutNext(report.stdout, 'next: approve (Approve) — run node-brief for it'), separate)
      + '\n'
      + `${decided}\n`
      + `${say}\n`
      + `skipped: audit (Audit) — its guard ${GUARD} reads false\n`
      + 'skipped: recover (Recover) — it runs only on a failure, and nothing failed\n'
      + 'next: review (Review) — its brief follows\n'
      + '\n'
      + rooted(brief, separate));
    assert.doesNotMatch(result.stdout, /next: audit/, 'the continue\'s inner next: line is not printed');
    assert.equal(result.stderr, '');
    assert.deepEqual(statuses(walked), statuses(separate));
    const decisions = readState(walked).node_summaries.approve.decisions;
    assert.equal(decisions.length, 1, 'continued once');
    assert.equal(decisions[0].by, 'config');
  });

  test(`${name}: a continue the brief advises against is briefed as a gate on the path, the say: line above its question, nothing written`, t => {
    const tree = treeOf();
    const advised = workDone({ deep: false }, { recommends: { option: 'rework', reason: 'The work misses a case.' } });
    const { withNext, without, walked, plain } = twinWrites(t, tree, t2 => configRun(t2, { config: AUTO }), advised);
    assert.equal(withNext.code, 0, withNext.stderr);
    const brief = rooted(briefOf(tree, plain, 'approve'), plain);
    assert.equal(withNext.stdout, `${withoutNext(without.stdout, 'next: approve (Approve) — run node-brief for it')}\nnext: approve (Approve) — its brief follows\n\n${brief}`);
    assert.ok(withNext.stdout.includes(`say: The project's config would continue, but work recommends revising; the gate is asked as usual.\n${QUESTION_LINE}\n`), withNext.stdout);
    assert.doesNotMatch(withNext.stdout, /^decided:/m);
    assert.equal(withNext.stderr, '');
    assert.equal(statusOf(walked, 'approve'), 'pending');
  });

  test(`${name}: in-process, a continue whose write is refused is attempted once, handed to the brief, warned once and asked`, { skip: PERMISSIONS_SKIP }, async t => {
    const closingWalk = await closingWalkOf(treeOf());

    const walkRefused = (runAt, brief = null) => {
      fs.chmodSync(runAt.state, 0o444);
      fs.chmodSync(runAt.dir, 0o555);
      try {
        return closingWalk({ state: runAt.state, ...(brief ? { brief } : {}) });
      } finally {
        fs.chmodSync(runAt.dir, 0o755);
        fs.chmodSync(runAt.state, 0o644);
      }
    };

    // The outcome the walk hands the brief.
    const handed = [];
    const seen = configRun(t, { config: AUTO });
    write(seen, workDone({ deep: false }));
    walkRefused(seen, (node, outcome) => {
      handed.push([node, outcome]);
      return { ok: true, text: 'brief\n', warnings: [] };
    });
    assert.deepEqual(handed, [['approve', { refused: 'state-unwritable' }]]);

    // The real brief prints the gate asked and the refusal's warning once.
    const runAt = configRun(t, { config: AUTO });
    write(runAt, workDone({ deep: false }));
    const result = walkRefused(runAt);
    assert.deepEqual(result.warnings.filter(line => line.includes('config-continue')),
      ['warning: node-brief-config-continue-refused: state-unwritable; the gate is asked as usual']);
    assert.deepEqual(result.lines, []);
    assert.deepEqual(result.next, { id: 'approve', title: 'Approve' });
    assert.ok(result.brief.split('\n').includes(QUESTION_LINE), result.brief);
    assert.doesNotMatch(result.brief, /^decided:/m);
    assert.equal(statusOf(runAt, 'approve'), 'pending');
    assert.equal(readState(runAt).node_summaries.approve, undefined);
  });

  test(`${name}: a task step on the path is briefed, its start recorded only when its guard reads true; an undecidable guard records none`, t => {
    const tree = treeOf();
    const STARTED = 'started: recorded running by this brief — the start needs no write of its own';

    const deep = twinWrites(t, tree, t2 => {
      const runAt = configRun(t2);
      write(runAt, workDone({ deep: true }));
      return runAt;
    }, ANSWER_APPROVE);
    assert.equal(deep.withNext.code, 0, deep.withNext.stderr);
    assert.equal(statusOf(deep.walked, 'audit'), 'running', 'its guard reads true: the brief recorded the start');
    const started = rooted(briefOf(tree, deep.plain, 'audit'), deep.plain);
    assert.equal(deep.withNext.stdout, `${withoutNext(deep.without.stdout, 'next: audit (Audit) — run node-brief for it')}\nnext: audit (Audit) — its brief follows\n\n${started}`);
    assert.ok(deep.withNext.stdout.split('\n').includes(STARTED));
    assert.deepEqual(statuses(deep.walked), statuses(deep.plain));

    const unknown = twinWrites(t, tree, t2 => {
      const runAt = configRun(t2);
      write(runAt, workDone(null));
      return runAt;
    }, ANSWER_APPROVE);
    assert.equal(unknown.withNext.code, 0, unknown.withNext.stderr);
    assert.equal(statusOf(unknown.walked, 'audit'), 'pending', 'a guard not yet decidable: no start');
    assert.ok(unknown.withNext.stdout.includes('\nnext: audit (Audit) — its brief follows\n\n'), unknown.withNext.stdout);
    assert.ok(!unknown.withNext.stdout.split('\n').some(line => line.startsWith('started: ') || line.startsWith('start: ')), unknown.withNext.stdout);
    assert.deepEqual(statuses(unknown.walked), statuses(unknown.plain));
  });

  test(`${name}: a dir: step is briefed with no start recorded`, t => {
    const tree = treeOf();
    const make = t2 => projectRun(t2, { name: 'walk-dir', definition: WALK_DIR, ids: ['work', 'remote'], orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
    const done = { nodes: { work: { status: 'completed' } }, node_summaries: { work: { summary: 'Worked.' } } };
    const { withNext, without, walked, plain } = twinWrites(t, tree, make, done);
    assert.equal(withNext.code, 0, withNext.stderr);
    const brief = rooted(briefOf(tree, plain, 'remote'), plain);
    assert.equal(withNext.stdout, `${withoutNext(without.stdout, 'next: remote (Remote) — run node-brief for it')}\nnext: remote (Remote) — its brief follows\n\n${brief}`);
    assert.match(withNext.stdout, /^runs: workflow:walk-dir — dispatched to members\/one$/m);
    assert.ok(!withNext.stdout.split('\n').some(line => line.startsWith('started: ') || line.startsWith('start: ')), withNext.stdout);
    assert.equal(statusOf(walked, 'remote'), 'pending');
  });

  test(`${name}: a sub-run step is briefed naming the hand-off call, with no start recorded`, t => {
    const tree = treeOf();
    const make = t2 => {
      const runAt = scratch(t2);
      freeze(runAt, { definition: SAMPLE });
      write(runAt, { nodes: { analysis: { status: 'completed' } } });
      write(runAt, { nodes: { approval: { status: 'completed' } } });
      write(runAt, { nodes: { implementation: { status: 'running' } } });
      return runAt;
    };
    const { withNext, without, walked, plain } = twinWrites(t, tree, make, { nodes: { implementation: { status: 'completed' } } });
    assert.equal(withNext.code, 0, withNext.stderr);
    const brief = rooted(briefOf(tree, plain, 'research'), plain);
    assert.equal(withNext.stdout, `${withoutNext(without.stdout, 'next: research (Research) — run node-brief for it')}\nnext: research (Research) — its brief follows\n\n${brief}`);
    assert.match(withNext.stdout, /^start: yours — run node .+ subrun-handoff --state=.+ --node=research$/m);
    assert.ok(!withNext.stdout.split('\n').includes('started: recorded running by this brief — the start needs no write of its own'));
    assert.equal(statusOf(walked, 'research'), 'pending');
  });

  test(`${name}: a gate on the path is briefed with its call — gate-request under a driver, its question printed last in a terminal run`, t => {
    const tree = treeOf();
    const terminal = twinWrites(t, tree, t2 => configRun(t2), workDone({ deep: false }));
    assert.equal(terminal.withNext.code, 0, terminal.withNext.stderr);
    const asked = rooted(briefOf(tree, terminal.plain, 'approve'), terminal.plain);
    assert.equal(terminal.withNext.stdout, `${withoutNext(terminal.without.stdout, 'next: approve (Approve) — run node-brief for it')}\nnext: approve (Approve) — its brief follows\n\n${asked}`);
    // The question in place of the ask it line: the three lines, then the question as the last block.
    const call = name === 'variant' ? '--ask' : '--json --picker=rich';
    const target = `--state=${rooted(terminal.walked.state, terminal.walked)} --node=approve`;
    const lines = terminal.withNext.stdout.split('\n');
    assert.ok(!lines.some(line => line.startsWith('ask it: ')), terminal.withNext.stdout);
    const at = lines.indexOf(QUESTION_LINE);
    assert.deepEqual(lines.slice(at, at + 4), [QUESTION_LINE, `ask again: gate-brief ${target} ${call}`, `details: gate-brief ${target} --details`, '']);
    const question = JSON.parse(terminal.withNext.stdout.slice(terminal.withNext.stdout.lastIndexOf('\n\n') + 2));
    assert.ok(name === 'variant' ? question.requestedSchema : question.options, 'the last block is the question the host\'s tool takes');
    if (name === 'variant') {
      const record = rooted(fs.readFileSync(path.join(terminal.walked.dir, '.ask.json'), 'utf8'), terminal.walked);
      assert.ok(terminal.withNext.stdout.endsWith(`\n\n${record}`), 'the record holds the printed bytes');
    }
    assert.equal(statusOf(terminal.walked, 'approve'), 'pending');

    const driven = twinWrites(t, tree, t2 => configRun(t2, { orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } }), workDone({ deep: false }));
    assert.equal(driven.withNext.code, 0, driven.withNext.stderr);
    const requested = rooted(briefOf(tree, driven.plain, 'approve'), driven.plain);
    assert.equal(driven.withNext.stdout, `${withoutNext(driven.without.stdout, 'next: approve (Approve) — run node-brief for it')}\nnext: approve (Approve) — its brief follows\n\n${requested}`);
    assert.ok(driven.withNext.stdout.split('\n').includes(`ask it: gate-request --state=${rooted(driven.walked.state, driven.walked)} --node=approve`), driven.withNext.stdout);
    assert.equal(fs.existsSync(path.join(driven.walked.dir, 'gates', 'approve.request.yml')), false, 'the brief writes no request');
  });
}

// The driven re-validation write: a driver's answer folded with editor tools,
// then `{}` sent with `--next`. After a continue the step due next is briefed;
// after a stop the stop line is read from disk; after a question set the node
// runs again and nothing more is printed. At `held-approval` the closing node
// is still running, so a continue, a stop and a revise not yet applied print
// what the write prints without the flag. A refused re-validation prints its
// refusal alone, which the session reports as the run failed.

const COCKPIT = { kind: 'cockpit', cwd: '/work' };
const DISPATCH = { kind: 'dispatch', cwd: '/work' };
const QUESTION_SET_REQUEST = path.join(FIXTURES, 'gates', 'question-set.request.yml');
const QUESTION_SET_ANSWER = path.join(FIXTURES, 'gates', 'question-set.answer.yml');
const HELD_CLOSING = path.join(FIXTURES, 'definitions', 'held-closing.yml');
const HELD = 'held-approval';
const POLICY = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'policy', 'questions.json'), 'utf8'));

/** The request a driver writes for `gate`, unanswered, as its first line set. */
function requestHead(gate) {
  return ['version: 1', `node: ${gate}`, 'kind: approval', 'question: "Continue?"', 'multiple: false', 'asked_at: "2026-01-05T09:00:00Z"'].join('\n');
}

/** A driver suspending on `gate` through `send`: its request on disk, a pending index row, the marker and the gate suspended. */
function suspendOn(runAt, gate, send = patch => write(runAt, patch)) {
  const gates = path.join(runAt.dir, 'gates');
  fs.mkdirSync(gates, { recursive: true });
  fs.writeFileSync(path.join(gates, `${gate}.request.yml`), `${requestHead(gate)}\nanswer: null\n`);
  refreshIndex(runAt.dir);
  send({
    orchestrator: { gate_pending: { node: gate, request: `gates/${gate}.request.yml`, since: '2026-01-05T09:00:00Z' } },
    nodes: { [gate]: { status: 'suspended' } },
  });
}

/** The answer to the suspended `gate` on disk, folded into the state with editor tools as step 4 writes it. */
function foldAnswer(runAt, gate, option) {
  fs.writeFileSync(path.join(runAt.dir, 'gates', `${gate}.request.yml`),
    `${requestHead(gate)}\nanswer:\n  option: ${option}\n  answered_by: dana\n  at: "2026-01-05T09:05:00Z"\n  via: cockpit\n`);
  const text = fs.readFileSync(runAt.state, 'utf8')
    .replace(/^ {2}gate_pending: .*$/m, '  gate_pending: null')
    .replace(new RegExp(`^( {4}${gate}: \\{kind: gate, status: )suspended`, 'm'), '$1completed');
  assert.match(text, /^node_summaries:\n(?: {2}.*\n|\s*\n)*$/m, 'node_summaries is the last block');
  fs.writeFileSync(runAt.state, `${text}  ${gate}:\n    decisions:\n      - {option: ${option}, answered_by: dana, at: "2026-01-05T09:05:00Z", via: cockpit}\n    status: completed\n`);
}

/** The review loop under a cockpit driver, its gate suspended and answered `option` on disk. */
const drivenReview = option => t => {
  const runAt = atReviewGate(t, { driver: COCKPIT });
  suspendOn(runAt, 'review-approval');
  foldAnswer(runAt, 'review-approval', option);
  return runAt;
};

/** Plugin copies of one tree with the in-node policy written in, so a choice can be held; one per tree, removed when the file ends. */
const policyCopies = new Map();
after(() => {
  for (const root of policyCopies.values()) fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

function withPolicy(tree) {
  if (!policyCopies.has(tree)) {
    const copy = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-policy-'))), 'maister');
    fs.cpSync(tree, copy, { recursive: true });
    const file = path.join(copy, 'skills', 'workflow-engine', 'policy', 'autonomy-policy.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(POLICY, null, 2)}\n`);
    policyCopies.set(tree, copy);
  }
  return policyCopies.get(tree);
}

/** A question whose approval the run cannot settle under dispatch: held for `held-approval`. */
const TIDY_CHOICE = {
  id: 'tidy-choice',
  question: 'Which tidy-choice?',
  options: [{ id: 'a', label: 'tidy-choice A', description: 'A is the safe pick.', recommended: true }, { id: 'b', label: 'tidy-choice B' }],
  triage: { version: 1, class: 'approve', family: 'area-family' },
};

/**
 * `held-closing` dispatched through `tree` (a policy copy), a choice held in
 * `tidy`, the closing node running and `held-approval` suspended, then
 * answered `option` on disk.
 */
const heldAnswered = (tree, option) => t => {
  const runAt = scratch(t);
  const send = patch => {
    const result = writeState(tree, runAt, patch);
    assert.equal(result.code, 0, result.stderr);
    return result;
  };
  send(freezePatch({ definition: HELD_CLOSING, orchestrator: { options: { ceiling: 'advice' }, driver: DISPATCH } }).patch);
  send({ nodes: { outline: { status: 'running' } } });
  send({ nodes: { outline: { status: 'completed' } }, node_summaries: { outline: { summary: 'Outlined the work.' } } });
  send({ nodes: { 'outline-approval': { status: 'completed' } }, node_summaries: { 'outline-approval': { decisions: [{ option: 'continue-past-outline' }] } } });
  send({ nodes: { choosing: { status: 'running' } } });
  send({
    nodes: { choosing: { status: 'completed', values: { wants_audit: false } }, audit: { status: 'skipped' } },
    node_summaries: { choosing: { summary: 'Chose to finish without an audit.' } },
  });
  send({ nodes: { tidy: { status: 'running' } } });
  assert.match(send({ node_summaries: { tidy: { question_set: { questions: [TIDY_CHOICE] } } } }).stdout, /\nask: none\n$/, 'the choice is held');
  send({ nodes: { tidy: { status: 'completed' }, closing: { status: 'running' } }, node_summaries: { tidy: { summary: 'Tidied what the run touched.' } } });
  suspendOn(runAt, HELD, send);
  foldAnswer(runAt, HELD, option);
  return runAt;
};

for (const [name, treeOf] of TREES) {
  test(`${name}: driven, the re-validation write with --next after a continue briefs the step due next; a refused one prints its refusal alone`, t => {
    const tree = treeOf();
    const { withNext, without, walked, plain } = twinWrites(t, tree, drivenReview('publish-draft'), {});
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.doesNotMatch(without.stdout, /next:/, 'the re-validation ends no node, so the write alone names no step');
    const brief = rooted(briefOf(tree, plain, 'publish'), plain);
    assert.equal(withNext.stdout, `${without.stdout}\nnext: publish (Publish) — its brief follows\n\n${brief}`);
    assert.equal(withNext.stderr, '');
    assert.equal(statusOf(walked, 'publish'), 'running', 'the brief recorded the start');
    assert.deepEqual(statuses(walked), statuses(plain));

    // A fold the editor tools left unreadable: the writer refuses the re-validation, the run fails with its code.
    const broken = drivenReview('publish-draft')(t);
    fs.writeFileSync(broken.state, fs.readFileSync(broken.state, 'utf8').replace(/^ {2}gate_pending: null$/m, '  gate_pending: review-approval'));
    const before = fs.readFileSync(broken.state, 'utf8');
    const alone = writeFromFile(tree, broken, {}).result;
    const { file, result } = writeFromFile(tree, broken, {}, ['--next']);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, alone.stderr, 'the refusal and its pointer, nothing walked');
    assert.match(result.stderr, /^state-[a-z-]+: /, 'the code the session reports as RUN-FAILED: <code>');
    assert.ok(fs.existsSync(file));
    assert.equal(fs.readFileSync(broken.state, 'utf8'), before);
  });

  test(`${name}: driven, the re-validation write with --next after a stop answer prints the stop line read from disk`, t => {
    const tree = treeOf();
    const { withNext, without, walked } = twinWrites(t, tree, drivenReview('abandon'), {});
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.doesNotMatch(without.stdout, /next:/);
    assert.deepEqual(withNext, { ...without, stdout: `${without.stdout}\n${STOP_LINE}\n` });
    assert.equal(statusOf(walked, 'publish'), 'pending', 'the step after the stop is neither skipped nor briefed');
  });

  test(`${name}: driven, the re-validation write with --next after a question set leaves the node running and prints nothing more`, t => {
    const make = t2 => {
      const runAt = scratch(t2);
      freeze(runAt, { orchestrator: { driver: { ...COCKPIT, features: ['question-sets'] } } });
      write(runAt, { nodes: { analysis: { status: 'running' } } });
      const request = path.join(runAt.dir, 'gates', 'analysis.request.yml');
      fs.mkdirSync(path.dirname(request), { recursive: true });
      fs.copyFileSync(QUESTION_SET_REQUEST, request);
      write(runAt, { orchestrator: { gate_pending: { node: 'analysis', request: 'gates/analysis.request.yml', since: '2026-01-05T09:00:00Z' } }, nodes: { analysis: { status: 'suspended' } } });
      fs.writeFileSync(request, fs.readFileSync(request, 'utf8').replace(/^answer: null\n$/m, fs.readFileSync(QUESTION_SET_ANSWER, 'utf8')));
      fs.writeFileSync(runAt.state, fs.readFileSync(runAt.state, 'utf8')
        .replace(/^( {4}analysis: \{.*?)status: suspended/m, '$1status: running')
        .replace(/^( {2}gate_pending: ).*$/m, '$1null'));
      return runAt;
    };
    const { withNext, without, walked, plain } = twinWrites(t, treeOf(), make, {});
    assert.equal(withNext.code, 0, withNext.stderr);
    assert.deepEqual(withNext, without);
    assert.equal(statusOf(walked, 'analysis'), 'running');
    assert.deepEqual(statuses(walked), statuses(plain));
  });

  for (const [option, what] of [['revise-tidy', 'a revise not yet applied'], ['continue', 'a continue'], ['stop', 'a stop']]) {
    test(`${name}: driven, at held-approval the re-validation write with --next after ${what} prints nothing more: the closing node still runs`, t => {
      const tree = withPolicy(treeOf());
      const { withNext, without, walked, plain } = twinWrites(t, tree, heldAnswered(tree, option), {});
      assert.equal(withNext.code, 0, withNext.stderr);
      assert.deepEqual(withNext, without);
      assert.doesNotMatch(withNext.stdout, /^next: /m);
      assert.equal(statusOf(walked, 'closing'), 'running');
      assert.equal(statusOf(walked, HELD), 'completed');
      assert.deepEqual(statuses(walked), statuses(plain));
    });
  }
}

// Parity: each built-in workflow walked boundary by boundary, every step ended
// by one flagged write in one run and by the separate calls in its twin — the
// write, a skip write per off-path step, the brief of the step it stops at.
// The two states are equal but for their clocks, and every combined print
// fits both limits a print is held to.

const WORKFLOWS = path.join(ROOT, 'plugins', 'maister', 'skills', 'workflow-engine', 'workflows');
const BUILT_INS = ['development', 'migration', 'mockup-studio', 'performance', 'product-design', 'research'];
const PRINT_CHARS = 20_000;
const PRINT_BYTES = 20_480;
const SINGLE_SCOPE = path.join(FIXTURES, 'runs', 'team-calendar-sharing', 'outputs', 'delivery-scope.yml');
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A value for each input the definition requires, so the freeze is one a run could make. */
function requiredInputs(file) {
  const inputs = {};
  for (const [key, spec] of Object.entries(readDefinition(file).doc?.inputs ?? {})) {
    if (spec?.required === true) inputs[key] = spec.type === 'bool' ? false : 'A sample task';
  }
  return inputs;
}

/** The run's state with every clock dropped and its scratch root masked. */
function unclocked(runAt) {
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([, each]) => !(typeof each === 'string' && CLOCK.test(each))).map(([key, each]) => [key, strip(each)]));
    }
    return typeof value === 'string' ? value.split(runAt.root).join('<root>') : value;
  };
  return strip(readState(runAt));
}

/** The write that ends `node`: a gate answered with its continue, a step completed with a value for each it declares. */
function ending(node, runAt) {
  if (node.type === 'gate') {
    const [option] = Object.entries(node.options).find(([, effect]) => (typeof effect === 'string' ? effect : effect.effect) === 'continue');
    return { nodes: { [node.id]: { status: 'completed' } }, node_summaries: { [node.id]: { decisions: [{ option, answered_by: 'tester', at: '2026-01-05T09:40:00Z' }] } } };
  }
  const values = Object.fromEntries(Object.entries(node.outputs?.values ?? {}).map(([key, type]) => [key, type === 'bool' ? false : type?.enum ? type.enum[0] : 'x']));
  const scope = node.outputs?.artifacts?.delivery_scope;
  if (typeof scope === 'string') {
    fs.mkdirSync(path.dirname(path.join(runAt.dir, scope)), { recursive: true });
    fs.copyFileSync(SINGLE_SCOPE, path.join(runAt.dir, scope));
  }
  return delegating({
    nodes: { [node.id]: { status: 'completed', ...(Object.keys(values).length ? { values } : {}) } },
    node_summaries: { [node.id]: { summary: 'Done.' } },
  }, runAt);
}

/** The gate rules of one tree, imported in this process. */
async function gateRulesOf(tree) {
  return import(pathToFileURL(path.join(tree, 'skills', 'workflow-engine', 'scripts', 'lib', 'gate-brief.mjs')).href);
}

/** The separate calls after `patch`: the write, a skip write per off-path step, then the brief of the step due; returns its id, or null. */
function separately(tree, rules, runAt, patch) {
  const report = writeState(tree, runAt, patch);
  assert.equal(report.code, 0, report.stderr);
  for (;;) {
    const doc = parse(fs.readFileSync(runAt.state, 'utf8'));
    const due = rules.dueNext({ doc, runDir: runAt.dir });
    if (due === null || due.id === null) return null;
    if (rules.offPathReason({ doc, runDir: runAt.dir, id: due.id }) !== null) {
      assert.equal(writeState(tree, runAt, { nodes: { [due.id]: { status: 'skipped' } } }).code, 0);
      continue;
    }
    briefOf(tree, runAt, due.id);
    return due.id;
  }
}

for (const [name, treeOf] of TREES) {
  test(`${name}: each built-in walked through its boundaries, one flagged call leaves the state the separate calls leave, every print within both limits`, async t => {
    const tree = treeOf();
    const rules = await gateRulesOf(tree);
    let largest = { chars: 0, bytes: 0, at: '' };
    for (const workflow of BUILT_INS) {
      const definition = path.join(WORKFLOWS, `${workflow}.yml`);
      const options = { definition, inputs: requiredInputs(definition), orchestrator: { driver: { kind: 'terminal' } } };
      const walked = scratch(t, { type: workflow });
      const separate = scratch(t, { type: workflow });
      const graph = freeze(walked, options);
      freeze(separate, options);
      const byId = new Map(graph.nodes.map(node => [node.id, node]));
      const first = graph.nodes[0].id;
      for (const runAt of [walked, separate]) briefOf(tree, runAt, first);

      let current = first;
      for (let turn = 0; current !== null; turn++) {
        assert.ok(turn <= graph.nodes.length, `${workflow}: the walk did not reach the closing patch`);
        const node = byId.get(current);
        const result = writeState(tree, walked, ending(node, walked), ['--next']);
        assert.equal(result.code, 0, `${workflow} ${current}: ${result.stderr}`);
        assert.equal(result.stderr, '', `${workflow} ${current}`);
        const chars = result.stdout.length;
        const bytes = Buffer.byteLength(result.stdout);
        assert.ok(chars <= PRINT_CHARS && bytes <= PRINT_BYTES, `${workflow} ${current}: ${chars} characters, ${bytes} bytes`);
        if (bytes > largest.bytes) largest = { chars, bytes, at: `${workflow}, ending ${current}` };

        const briefed = separately(tree, rules, separate, ending(node, separate));
        const announced = result.stdout.match(/^next: (\S+) \(.*\) — its brief follows$/m)?.[1] ?? null;
        assert.equal(announced, briefed, `${workflow} ${current}: the step briefed`);
        if (announced === null) assert.ok(result.stdout.endsWith(`\n${CLOSING_LINE}\n`), `${workflow} ${current}: ${result.stdout}`);
        assert.deepEqual(unclocked(walked), unclocked(separate), `${workflow}: the state after ending ${current}`);
        current = announced;
      }
    }
    t.diagnostic(`largest combined print: ${largest.chars} characters, ${largest.bytes} bytes (${largest.at})`);
  });
}

for (const [name, treeOf] of TREES) {
  test(`${name}: a landed write from the patch file with --next consumes that file, in the run's folder under its own name`, t => {
    const tree = treeOf();
    const runAt = frozenRun(t);
    const { file, result } = writeFromFile(tree, runAt, COMPLETE_WORK, ['--next']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(file, path.join(runAt.dir, '.state-patch.json'));
    assert.equal(fs.existsSync(file), false, 'the patch file is consumed once the write landed');
    assert.ok(result.stdout.includes('\nnext: review (Review) — its brief follows\n'), result.stdout);
    assert.equal(statusOf(runAt, 'work'), 'completed');
  });
}
