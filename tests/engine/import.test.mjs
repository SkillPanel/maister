import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES, freeze, scratch, sibling, verb } from '../helpers.mjs';

// `import` is the one way a node brings context into its run: each source
// copied byte for byte, a directory recursively, never by a shell copy. It
// writes the copies and no state.

function importing(run, flags) {
  const result = verb(['import', `--state=${run.state}`, ...flags]);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // a usage error prints nothing on stdout
  }
  return { ...result, report };
}

/** A frozen run with a few sources beside it under `<root>/sources/`. */
function project(t) {
  const run = scratch(t);
  freeze(run);
  const sources = path.join(run.root, 'sources');
  fs.mkdirSync(path.join(sources, 'pack', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(sources, 'report.md'), '# Report\n');
  fs.writeFileSync(path.join(sources, 'screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a, 0x1a, 0x00]));
  fs.writeFileSync(path.join(sources, 'pack', 'notes.md'), 'notes\n');
  fs.writeFileSync(path.join(sources, 'pack', 'nested', 'deep.txt'), 'deep\n');
  return run;
}

test('import: a text file, a binary file and a directory are copied byte for byte, and the state is untouched', t => {
  const run = project(t);
  const state = fs.readFileSync(run.state);
  const { code, stderr, report } = importing(run, [
    '--to=analysis/research-context', '--from=sources/report.md', '--from=sources/screen.png', '--from=sources/pack',
  ]);
  assert.equal(code, 0, stderr);
  assert.deepEqual(report, {
    ok: true,
    to: 'analysis/research-context',
    copied: [
      { from: 'sources/report.md', to: 'analysis/research-context/report.md', files: 1 },
      { from: 'sources/screen.png', to: 'analysis/research-context/screen.png', files: 1 },
      { from: 'sources/pack', to: 'analysis/research-context/pack', files: 2 },
    ],
    skipped: [],
  });
  const into = path.join(run.dir, 'analysis/research-context');
  assert.deepEqual(fs.readFileSync(path.join(into, 'screen.png')), fs.readFileSync(path.join(run.root, 'sources/screen.png')));
  assert.equal(fs.readFileSync(path.join(into, 'pack/nested/deep.txt'), 'utf8'), 'deep\n');
  assert.deepEqual(fs.readFileSync(run.state), state, 'the verb writes no state');
});

// A task directory the 2.x plugin wrote cannot be resumed, but it can be a
// context pack: `--context` names it, and the first node imports it whole —
// its state file and everything beside it, read as nothing more than files.
test('import: a 2.x task directory is copied whole as a context pack', t => {
  const run = scratch(t);
  freeze(run);
  const earlier = sibling(run, { type: 'development', name: '2025-12-01-earlier' });
  fs.cpSync(path.join(FIXTURES, 'runs', 'prose-2x'), earlier.dir, { recursive: true });
  fs.mkdirSync(path.join(earlier.dir, 'analysis'));
  fs.writeFileSync(path.join(earlier.dir, 'analysis', 'codebase-analysis.md'), '# Analysis\n');
  const { code, stderr, report } = importing(run, ['--to=analysis/work-context', `--from=${earlier.path}`]);
  assert.equal(code, 0, stderr);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.copied, [{ from: earlier.path, to: 'analysis/work-context/2025-12-01-earlier', files: 3 }]);
  const into = path.join(run.dir, 'analysis/work-context/2025-12-01-earlier');
  for (const file of ['orchestrator-state.yml', 'dashboard-data.js', 'analysis/codebase-analysis.md']) {
    assert.deepEqual(fs.readFileSync(path.join(into, file)), fs.readFileSync(path.join(earlier.dir, file)), file);
  }
});

test('import: an absolute source inside the project is taken as it is', t => {
  const run = project(t);
  const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${path.join(run.root, 'sources/report.md')}`]);
  assert.equal(code, 0);
  assert.equal(report.copied[0].to, 'analysis/work-context/report.md');
});

/** A secret outside the project, removed when the test ends. */
function outsider(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-outside-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret\n');
  return dir;
}

/** `link` made to point at `target`, or false where the runner may not make links (Windows). */
function linked(target, link) {
  try {
    fs.symlinkSync(target, link, fs.statSync(target).isDirectory() ? 'junction' : 'file');
    return true;
  } catch {
    return false;
  }
}

test('import: a source outside the project is skipped, the one inside beside it still copied, exit 1', t => {
  const run = project(t);
  const away = outsider(t);
  const climb = path.relative(run.root, path.join(away, 'secret.txt'));
  const { code, report } = importing(run, [
    '--to=analysis/work-context', `--from=${path.join(away, 'secret.txt')}`, `--from=${climb}`, '--from=sources/report.md',
  ]);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.copied.map(each => each.from), ['sources/report.md']);
  assert.deepEqual(report.skipped.map(each => each.code), ['import-source-outside', 'import-source-outside']);
  assert.match(report.skipped[0].message, /copy the file into the project first/);
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/work-context/secret.txt')), false);
});

test('import: a link inside the project that points out is skipped; one that points inside is followed', t => {
  const run = project(t);
  const away = outsider(t);
  if (!linked(path.join(away, 'secret.txt'), path.join(run.root, 'sources/out.txt'))) return;
  assert.ok(linked(path.join(run.root, 'sources/report.md'), path.join(run.root, 'sources/in.md')));
  const { code, report } = importing(run, ['--to=analysis/work-context', '--from=sources/out.txt', '--from=sources/in.md']);
  assert.equal(code, 1);
  assert.deepEqual(report.copied.map(each => each.from), ['sources/in.md']);
  assert.equal(report.skipped[0].code, 'import-source-outside');
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/work-context/out.txt')), false);
  assert.equal(fs.readFileSync(path.join(run.dir, 'analysis/work-context/in.md'), 'utf8'), '# Report\n');
});

test('import: a directory holding a link out, at any depth or through a link inside, is skipped whole', t => {
  const run = project(t);
  const away = outsider(t);
  if (!linked(away, path.join(run.root, 'sources/pack/nested/away'))) return;
  assert.ok(linked(path.join(run.root, 'sources/pack'), path.join(run.root, 'sources/via')));
  const { code, report } = importing(run, ['--to=analysis/work-context', '--from=sources/pack', '--from=sources/via']);
  assert.equal(code, 1);
  assert.deepEqual(report.copied, []);
  assert.deepEqual(report.skipped.map(each => each.code), ['import-source-outside', 'import-source-outside']);
  assert.match(report.skipped[0].message, /through the link/);
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/work-context')), false, 'nothing of either was copied');
});

test('import: a directory link inside the project is walked and copied, and a cycle of links ends the check', t => {
  const run = project(t);
  if (!linked(path.join(run.root, 'sources/pack/nested'), path.join(run.root, 'sources/pack/also'))) return;
  const { code, report } = importing(run, ['--to=analysis/work-context', '--from=sources/pack']);
  assert.equal(code, 0, JSON.stringify(report));
  assert.equal(fs.readFileSync(path.join(run.dir, 'analysis/work-context/pack/also/deep.txt'), 'utf8'), 'deep\n');
  assert.ok(linked(path.join(run.root, 'sources/pack'), path.join(run.root, 'sources/pack/nested/loop')));
  const cycle = importing(run, ['--to=analysis/loop-context', '--from=sources/pack']);
  assert.notEqual(cycle.report.skipped[0]?.code, 'import-source-outside', JSON.stringify(cycle.report));
});

test('import: --as lands the one source under the name given', t => {
  const run = project(t);
  const { code, report } = importing(run, ['--to=analysis/architecture-context', '--from=sources/report.md', '--as=high-level-design.md']);
  assert.equal(code, 0);
  assert.equal(report.copied[0].to, 'analysis/architecture-context/high-level-design.md');
  assert.ok(fs.existsSync(path.join(run.dir, 'analysis/architecture-context/high-level-design.md')));
});

test('import: --as with two sources, or holding a path, is a usage error and copies nothing', t => {
  const run = project(t);
  for (const flags of [
    ['--to=analysis/x', '--from=sources/report.md', '--from=sources/pack', '--as=one.md'],
    ['--to=analysis/x', '--from=sources/report.md', '--as=../one.md'],
  ]) {
    const { code, stderr } = importing(run, flags);
    assert.equal(code, 2);
    assert.match(stderr, /^usage: import takes --as/);
  }
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/x')), false);
});

test('import: a missing source is skipped and the others are still copied, exit 1', t => {
  const run = project(t);
  const { code, report } = importing(run, ['--to=analysis/research-context', '--from=sources/gone.md', '--from=sources/report.md']);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.copied.map(each => each.from), ['sources/report.md']);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].code, 'import-source-missing');
  assert.ok(fs.existsSync(path.join(run.dir, 'analysis/research-context/report.md')));
});

test('import: a source holding the destination, or inside it, is skipped as overlapping', t => {
  const run = project(t);
  fs.mkdirSync(path.join(run.dir, 'analysis/inner'), { recursive: true });
  fs.writeFileSync(path.join(run.dir, 'analysis/inner/x.md'), 'x\n');
  const holding = importing(run, ['--to=analysis/copy', '--from=.maister']);
  assert.equal(holding.code, 1);
  assert.equal(holding.report.skipped[0].code, 'import-source-overlaps');
  const inside = importing(run, ['--to=analysis/inner', `--from=${run.path}/analysis/inner/x.md`]);
  assert.equal(inside.report.skipped[0].code, 'import-source-overlaps');
  assert.equal(fs.readFileSync(path.join(run.dir, 'analysis/inner/x.md'), 'utf8'), 'x\n', 'nothing was replaced');
});

test('import: importing again replaces the earlier copy with the source as it is now', t => {
  const run = project(t);
  importing(run, ['--to=analysis/work-context', '--from=sources/pack']);
  fs.rmSync(path.join(run.root, 'sources/pack/notes.md'));
  fs.writeFileSync(path.join(run.root, 'sources/pack/new.md'), 'new\n');
  const { code, report } = importing(run, ['--to=analysis/work-context', '--from=sources/pack']);
  assert.equal(code, 0);
  assert.equal(report.copied[0].files, 2);
  const copy = path.join(run.dir, 'analysis/work-context/pack');
  assert.deepEqual(fs.readdirSync(copy).sort(), ['nested', 'new.md']);
});

test('import: a destination outside the run or reserved by the engine is refused, nothing copied', t => {
  const run = project(t);
  // A link needs a privilege on Windows that a test runner may not hold; the
  // case is dropped there rather than failed.
  let linked = true;
  try {
    fs.symlinkSync(path.join(run.root, 'sources'), path.join(run.dir, 'escape'), 'junction');
  } catch {
    linked = false;
  }
  const cases = [
    ['../elsewhere', 'import-destination-outside'],
    [path.join(run.root, 'abs'), 'import-destination-outside'],
    ...(linked ? [['escape/inside', 'import-destination-outside']] : []),
    ['.', 'import-destination-reserved'],
    ['gates/x', 'import-destination-reserved'],
    ['display', 'import-destination-reserved'],
  ];
  for (const [to, code] of cases) {
    const result = importing(run, [`--to=${to}`, '--from=sources/report.md']);
    assert.equal(result.code, 1, to);
    assert.equal(result.report.ok, false, to);
    assert.equal(result.report.code, code, to);
  }
  assert.equal(fs.existsSync(path.join(run.root, 'sources/inside')), false);
  assert.equal(fs.existsSync(path.join(run.dir, 'gates/x')), false);
});

test('import: a state that is not a frozen run, or cannot be read, is refused', t => {
  const run = scratch(t);
  fs.writeFileSync(run.state, 'task:\n  title: Loose\n');
  assert.equal(importing(run, ['--to=analysis/x', '--from=README.md']).report.code, 'import-not-a-run');
  fs.rmSync(run.state);
  assert.equal(importing(run, ['--to=analysis/x', '--from=README.md']).report.code, 'import-state-unreadable');
});

test('import: --state, --to and --from are required', t => {
  const run = project(t);
  for (const flags of [['--from=sources/report.md'], ['--to=analysis/x']]) {
    const { code, stderr } = importing(run, flags);
    assert.equal(code, 2);
    assert.match(stderr, /^usage: import needs/);
  }
});

// A run the cockpit starts in a member of a workspace lives in the member's
// worktree, while the inputs it is handed lie under the workspace root. Import
// admits that root beside the project — found from the workspace manifest that
// declares the run's checkout, never from a path the run gives.

/** A cockpit driver for a run working in `cwd`, a dispatched one when `dispatch` is given. */
function cockpit(cwd, dispatch = 'd-0001') {
  return { driver: { kind: 'cockpit', cwd, ...(dispatch === null ? {} : { dispatch_id: dispatch }) } };
}

/**
 * A scratch workspace declaring the member `api` at `projects/api`, its inputs
 * under the workspace root, and a sibling folder beside it. `member` is the
 * member checkout itself, or a directory elsewhere it links to with `linkedMember`.
 */
function workspace(t, { linkedMember = false, manifest = 'members:\n  api: {path: projects/api, kind: repo}\n' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-workspace-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const ws = path.join(base, 'ws');
  fs.mkdirSync(path.join(ws, '.maister'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.maister', 'umbrella.yml'), `version: 1\n${manifest}`);
  const work = path.join(ws, '.maister', 'work', 'guest-invites');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'context.md'), '# Context\n');
  const research = path.join(ws, '.maister', 'tasks', 'research', '2026-10-26-invites', 'outputs');
  fs.mkdirSync(research, { recursive: true });
  fs.writeFileSync(path.join(research, 'research-report.md'), '# Research\n');
  const pack = path.join(ws, '.maister', 'context', 'guest-invites');
  fs.mkdirSync(path.join(pack, 'mockups'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'brief.md'), 'brief\n');
  fs.writeFileSync(path.join(pack, 'mockups', 'screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  const sources = path.join(base, '.maister-cockpit-sources', 'guest-invites');
  fs.mkdirSync(sources, { recursive: true });
  fs.writeFileSync(path.join(sources, 'notes.md'), 'notes\n');
  fs.mkdirSync(path.join(ws, 'projects'));
  const member = path.join(ws, 'projects', 'api');
  let repo = member;
  if (linkedMember) {
    repo = path.join(base, 'repos', 'api');
    fs.mkdirSync(repo, { recursive: true });
    if (!linked(repo, member)) return null;
  } else {
    fs.mkdirSync(member);
  }
  return {
    ws, member, repo, sources,
    context: path.join(work, 'context.md'),
    research: path.join(research, 'research-report.md'),
    pack,
  };
}

/** A run frozen in `root` with `orchestrator`. */
function frozenIn(root, orchestrator = {}) {
  const run = sibling({ root }, { type: 'development', name: '2026-10-27-invites' });
  freeze(run, { orchestrator });
  return run;
}

/** The run frozen in the worktree `dev-api` of the workspace's member, driven as `driver` says. */
function memberRun(space, orchestrator = cockpit(path.join(space.member, '.worktrees', 'dev-api'))) {
  return frozenIn(path.join(space.member, '.worktrees', 'dev-api'), orchestrator);
}

test('import: a dispatched member run copies the workspace-root context pack and research report', t => {
  const space = workspace(t);
  const run = memberRun(space);
  const context = importing(run, ['--to=analysis/work-context', `--from=${space.context}`]);
  assert.equal(context.code, 0, JSON.stringify(context.report));
  assert.deepEqual(context.report.copied, [{ from: space.context, to: 'analysis/work-context/context.md', files: 1 }]);
  const research = importing(run, ['--to=analysis/research-context', `--from=${space.research}`]);
  assert.equal(research.code, 0, JSON.stringify(research.report));
  assert.equal(fs.readFileSync(path.join(run.dir, 'analysis/research-context/research-report.md'), 'utf8'), '# Research\n');
});

test('import: a member run the cockpit starts with no dispatch copies a workspace-root file and directory', t => {
  const space = workspace(t);
  const run = memberRun(space, cockpit(path.join(space.member, '.worktrees', 'dev-api'), null));
  const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${space.context}`, `--from=${space.pack}`]);
  assert.equal(code, 0, JSON.stringify(report));
  assert.deepEqual(report.copied.map(each => [each.to, each.files]), [
    ['analysis/work-context/context.md', 1],
    ['analysis/work-context/guest-invites', 2],
  ]);
  assert.deepEqual(
    fs.readFileSync(path.join(run.dir, 'analysis/work-context/guest-invites/mockups/screen.png')),
    fs.readFileSync(path.join(space.pack, 'mockups/screen.png')),
  );
});

test('import: a run in the member checkout itself is admitted as well as one in its worktree', t => {
  const space = workspace(t);
  const run = frozenIn(space.member, cockpit(space.member));
  assert.equal(importing(run, ['--to=analysis/work-context', `--from=${space.context}`]).code, 0);
});

test('import: a member linked in from elsewhere, its run reached by the real path, finds the workspace through the recorded cwd', t => {
  const space = workspace(t, { linkedMember: true });
  if (space === null) return;
  const logical = path.join(space.member, '.worktrees', 'dev-api');
  const run = frozenIn(path.join(space.repo, '.worktrees', 'dev-api'), cockpit(logical));
  const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${space.context}`]);
  assert.equal(code, 0, JSON.stringify(report));
});

test('import: a member run still skips a link out of the workspace, a directory holding one, and a path outside both', t => {
  const space = workspace(t);
  const run = memberRun(space);
  const away = outsider(t);
  if (!linked(path.join(away, 'secret.txt'), path.join(space.ws, '.maister', 'work', 'out.txt'))) return;
  assert.ok(linked(away, path.join(space.pack, 'mockups', 'away')));
  const { code, report } = importing(run, [
    '--to=analysis/work-context',
    `--from=${path.join(space.ws, '.maister', 'work', 'out.txt')}`,
    `--from=${space.pack}`,
    `--from=${path.join(away, 'secret.txt')}`,
    `--from=${space.context}`,
  ]);
  assert.equal(code, 1);
  assert.deepEqual(report.copied.map(each => each.from), [space.context]);
  assert.deepEqual(report.skipped.map(each => each.code), ['import-source-outside', 'import-source-outside', 'import-source-outside']);
  assert.match(report.skipped[0].message, /outside the project and its workspace/);
  assert.match(report.skipped[1].message, /through the link/);
  assert.equal(fs.existsSync(path.join(run.dir, 'analysis/work-context/guest-invites')), false, 'nothing of the directory was copied');
});

test('import: a sources folder beside the workspace is skipped, for a member run and a workspace-root run alike', t => {
  const space = workspace(t);
  for (const run of [memberRun(space), frozenIn(space.ws, cockpit(space.ws, null))]) {
    const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${space.sources}`]);
    assert.equal(code, 1, run.root);
    assert.equal(report.skipped[0].code, 'import-source-outside', run.root);
  }
});

test('import: a workspace-root run copies a context directory under the workspace', t => {
  const space = workspace(t);
  const run = frozenIn(space.ws, cockpit(space.ws, null));
  const { code, report } = importing(run, ['--to=analysis/work-context', '--from=.maister/context/guest-invites']);
  assert.equal(code, 0, JSON.stringify(report));
  assert.deepEqual(report.copied, [{ from: '.maister/context/guest-invites', to: 'analysis/work-context/guest-invites', files: 2 }]);
});

test('import: a terminal run in a workspace member is judged against its project alone', t => {
  const space = workspace(t);
  const run = memberRun(space, {});
  const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${space.context}`]);
  assert.equal(code, 1);
  assert.equal(report.skipped[0].code, 'import-source-outside');
  assert.match(report.skipped[0].message, /reaches outside the project \(/);
});

test('import: no argument, recorded cwd or manifest a run controls widens the area', t => {
  const space = workspace(t);
  const run = memberRun(space);
  const flag = importing(run, ['--to=analysis/work-context', `--from=${space.context}`, '--workspace-root=/']);
  assert.equal(flag.code, 2);
  assert.match(flag.stderr, /takes no --workspace-root flag/);

  // A recorded cwd naming another workspace is not this run's project, so it is not searched.
  const other = workspace(t);
  const elsewhere = memberRun(other, cockpit(path.join(space.member, '.worktrees', 'dev-api')));
  fs.rmSync(path.join(other.ws, '.maister', 'umbrella.yml'));
  const crafted = importing(elsewhere, ['--to=analysis/work-context', `--from=${space.context}`]);
  assert.equal(crafted.report.skipped[0]?.code, 'import-source-outside', JSON.stringify(crafted.report));

  // A manifest that does not declare the checkout, or declares it by a path climbing out, admits nothing.
  for (const manifest of [
    'members:\n  web: {path: projects/web}\n',
    'members:\n  api: {path: ../ws/projects/api}\n',
  ]) {
    const declared = workspace(t, { manifest });
    const result = importing(memberRun(declared), ['--to=analysis/work-context', `--from=${declared.context}`]);
    assert.equal(result.report.skipped[0]?.code, 'import-source-outside', manifest);
  }
});
