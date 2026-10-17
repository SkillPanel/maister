import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { freeze, scratch, verb } from '../helpers.mjs';

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

test('import: an absolute source is taken as it is', t => {
  const run = project(t);
  const { code, report } = importing(run, ['--to=analysis/work-context', `--from=${path.join(run.root, 'sources/report.md')}`]);
  assert.equal(code, 0);
  assert.equal(report.copied[0].to, 'analysis/work-context/report.md');
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
