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
