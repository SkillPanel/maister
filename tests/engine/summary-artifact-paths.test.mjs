import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { placedArtifacts, taskRelative } from '../../plugins/maister/skills/workflow-engine/scripts/lib/artifact-paths.mjs';
import { freeze, readDashboard, readState, scratch, verb, write } from '../helpers.mjs';

// A node summary's `artifacts` are linked from the dashboard, inside the task
// folder, so the writer keeps every path task-relative and every file once,
// and the projection reads a state written before that rule the same way.

const TASK = '.maister/tasks/development/2026-01-05-sample';

/** Put a file into the run directory, creating its folder. */
function place(run, relative) {
  const file = path.join(run.dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${relative}\n`);
}

/** Send a patch expected to be refused; assert the state did not move. */
function refused(run, patch) {
  const before = fs.readFileSync(run.state, 'utf8');
  const result = verb(['write-state', `--state=${run.state}`], patch);
  assert.equal(result.code, 1, `expected a refusal, got exit ${result.code}: ${result.stderr}`);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'a refused write leaves the state as it was');
  return result;
}

const analysisCard = run => readDashboard(run).phases.find(phase => phase.id === 'analysis');

test('placement: task-prefixed paths become task-relative; a task-relative one is the same string', () => {
  const where = { taskPath: TASK, root: '/work/repo', subruns: [] };
  assert.equal(taskRelative(`${TASK}/outputs/report.md`, where), 'outputs/report.md');
  assert.equal(taskRelative(`./${TASK}/outputs/report.md`, where), 'outputs/report.md');
  assert.equal(taskRelative(`${TASK.replace(/\//g, '\\')}\\outputs\\report.md`, where), 'outputs/report.md');
  assert.equal(taskRelative(`/work/repo/${TASK}/outputs/report.md`, where), 'outputs/report.md');
  const own = 'outputs/report.md';
  assert.equal(taskRelative(own, where), own);
  assert.equal(taskRelative('${analysis.artifacts.report}', where), '${analysis.artifacts.report}');
  assert.equal(taskRelative('src/app.js', where), 'src/app.js', 'a path not opening with .maister/ is the task folder\'s own');
  for (const outside of [TASK, '.', '../other/notes.md', '.maister/docs/INDEX.md', '/work/repo/src/app.js', '/elsewhere/x.md', '.maister/tasks/research/2026-01-05-other/report.md']) {
    assert.equal(taskRelative(outside, where), null, outside);
  }
});

test('placement: a recorded sub-run\'s folder is reached as ../../<type>/<run>', () => {
  const child = '.maister/tasks/research/2026-01-05-child';
  const where = { taskPath: TASK, root: '/work/repo', subruns: [child] };
  assert.equal(taskRelative(`${child}/outputs/report.md`, where), '../../research/2026-01-05-child/outputs/report.md');
  const spelled = '../../research/2026-01-05-child/outputs/report.md';
  assert.equal(taskRelative(spelled, where), spelled);
  assert.equal(taskRelative('../../research/2026-01-05-other/report.md', where), null);
});

test('placement: duplicates keep the entry with the companion, at the first one\'s position', () => {
  const where = { taskPath: TASK, root: null, subruns: [] };
  const withHtml = { path: 'outputs/report.md', label: null, html: 'outputs/report.html' };
  assert.deepEqual(placedArtifacts([`${TASK}/outputs/report.md`, 'planning/brief.md', withHtml], where),
    [withHtml, 'planning/brief.md']);
  assert.deepEqual(placedArtifacts([withHtml, 'outputs/report.md'], where), [withHtml]);
  assert.deepEqual(placedArtifacts(['a.md', { path: 'a.md', label: 'A', html: null }], where), ['a.md']);
});

test('write: repository-relative and absolute task-prefixed paths are stored task-relative', t => {
  const run = scratch(t);
  freeze(run);
  write(run, {
    node_summaries: {
      analysis: {
        summary: 'Scoped.',
        artifacts: [
          `${TASK}/analysis/report.md`,
          { path: path.join(run.dir, 'analysis/notes.md'), label: 'Notes', html: `${TASK}/analysis/notes.html` },
        ],
      },
    },
  });
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts, [
    'analysis/report.md',
    { path: 'analysis/notes.md', label: 'Notes', html: 'analysis/notes.html' },
  ]);
});

test('write: a path outside the task folder is refused, naming the entry', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: 'Scoped.' } } });
  const cases = [
    ['.maister/docs/INDEX.md', 'artifacts[0].path'],
    ['../../../../src/app.js', 'artifacts[0].path'],
    ['../../research/2026-01-05-other/report.md', 'artifacts[0].path'],
    [path.join(run.root, 'README.md'), 'artifacts[0].path'],
    [{ path: 'analysis/report.md', label: null, html: '../elsewhere.html' }, 'artifacts[0].html'],
  ];
  for (const [entry, at] of cases) {
    const result = refused(run, { node_summaries: { analysis: { summary: 'Scoped.', artifacts: [entry] } } });
    assert.match(result.stderr, /^state-summary-artifact-outside: /, JSON.stringify(entry));
    assert.ok(result.stderr.includes(`node_summaries.analysis.${at}`), result.stderr);
    assert.ok(result.stderr.includes('Nothing was written.'), result.stderr);
  }
});

test('write: a file listed twice is kept once, with its companion; a completion adds no second copy', t => {
  const run = scratch(t);
  freeze(run);
  place(run, 'analysis/report.md');
  place(run, 'analysis/report.html');
  write(run, {
    nodes: { analysis: { status: 'completed' } },
    node_summaries: {
      analysis: {
        summary: 'Scoped.',
        artifacts: [`${TASK}/analysis/report.md`, { path: 'analysis/report.md', label: null, html: 'analysis/report.html' }],
      },
    },
  });
  const expected = [{ path: 'analysis/report.md', label: null, html: 'analysis/report.html' }];
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts, expected);
  assert.deepEqual(analysisCard(run).artifacts, expected);
});

test('write: a recorded sub-run\'s artifact is accepted as the writer spells it', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { nodes: { research: { status: 'running', values: { task_path: '.maister/tasks/research/2026-01-05-child' } } } });
  write(run, { node_summaries: { research: { summary: 'Asked.', artifacts: ['.maister/tasks/research/2026-01-05-child/outputs/research-report.md'] } } });
  assert.deepEqual(readState(run).node_summaries.research.artifacts, ['../../research/2026-01-05-child/outputs/research-report.md']);
});

test('write: ordinary task-relative entries come back byte for byte', t => {
  const run = scratch(t);
  freeze(run);
  const artifacts = ['analysis/report.md', { path: 'analysis/notes.md', label: 'Notes', html: null, role: 'evidence' }, 7];
  write(run, { node_summaries: { analysis: { summary: 'Scoped.', artifacts } } });
  const before = fs.readFileSync(run.state, 'utf8');
  write(run, { node_summaries: { analysis: { summary: 'Scoped.', artifacts } } });
  const block = text => text.slice(text.indexOf('\nnode_summaries:'));
  assert.equal(block(fs.readFileSync(run.state, 'utf8')), block(before));
  assert.deepEqual(readState(run).node_summaries.analysis.artifacts, artifacts);
});

test('an existing state with repository-relative entries projects only working links and still resumes', t => {
  const run = scratch(t);
  freeze(run);
  write(run, { node_summaries: { analysis: { summary: 'Scoped.' } } });
  // The shape a run wrote before the rule: the orchestrator's repository-relative
  // strings first, the writer's own task-relative entry after, laid in by hand.
  const broken = [
    `      - ${TASK}/outputs/research-report.md`,
    `      - ${TASK}/analysis/synthesis.md`,
    `      - ${TASK}/planning/research-brief.md`,
    '      - .maister/tasks/research/2026-01-05-other/outputs/report.md',
    '      - path: outputs/research-report.md',
    '        label: null',
    '        html: outputs/research-report.html',
  ];
  const text = fs.readFileSync(run.state, 'utf8');
  const anchor = '    summary: Scoped.\n';
  assert.ok(text.includes(anchor), 'the summary line this test extends is where it expects');
  fs.writeFileSync(run.state, text.replace(anchor, `${anchor}    artifacts:\n${broken.join('\n')}\n`));
  assert.equal(readState(run).node_summaries.analysis.artifacts.length, 5);

  write(run, {});
  assert.deepEqual(analysisCard(run).artifacts, [
    { path: 'outputs/research-report.md', label: null, html: 'outputs/research-report.html' },
    { path: 'analysis/synthesis.md', label: null, html: null, role: null },
    { path: 'planning/research-brief.md', label: null, html: null, role: null },
  ]);
  const resumed = verb(['resume-check', `--state=${run.state}`]);
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).ok, true);
});
