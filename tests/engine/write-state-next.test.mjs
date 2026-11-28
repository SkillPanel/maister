// `write-state --next`: the closing write that, once it lands, walks the run
// past its off-path steps and prints the brief of the step it stops at, so
// one call does what a write, its skip writes and a `node-brief` did. Without
// the flag every byte and the exit code are as before. With it a refused
// write prints its refusal alone and walks nothing, a freeze adds nothing,
// and any failure after the landing prints one `warning:` line and the
// `next:` line the state on disk gives, at exit 0. The fallbacks are driven
// in-process through `lib/closing-walk.mjs`, with an injected writer, bound
// or brief. Every case runs on both trees, the source and the variant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, freeze, freezePatch, readState, run, scratch, variantRoot, write } from '../helpers.mjs';

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
    assert.deepEqual(readState(walked).workflow.nodes, readState(separate).workflow.nodes);
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
}
