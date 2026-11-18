import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, freeze, git, gitScratch, readDashboard, readState, scratch, verb } from '../helpers.mjs';

// A run records where it starts, `task.base_commit`, at the freeze. When the
// default branch is merged into the run's branch, `move-base` moves that start
// past the merged-in work, so the next review measures the run's own change
// and not everything the merge brought along.

const FILES = {
  'src/app.mjs': 'export const a = 1;\n',
  'README.md': '# App\n',
};

function write(run, file, text) {
  fs.mkdirSync(path.dirname(path.join(run.root, file)), { recursive: true });
  fs.writeFileSync(path.join(run.root, file), text);
}

function brief(run, flags = []) {
  const result = verb(['review-brief', `--state=${run.state}`, ...flags]);
  const json = result.code === 0 ? JSON.parse(fs.readFileSync(result.stdout.trim(), 'utf8')) : null;
  return { ...result, json };
}

/**
 * A run frozen on a feature branch, two committed files of its own, and the
 * default branch moved on by three files and merged in with a merge commit.
 */
function mergedRun(t) {
  const run = gitScratch(t, FILES);
  git(run.root, ['checkout', '-q', '-b', 'feature']);
  freeze(run);
  write(run, 'src/feature.mjs', 'export const feature = 1;\n');
  write(run, 'src/app.mjs', 'export const a = 2;\n');
  git(run.root, ['add', 'src/feature.mjs', 'src/app.mjs']);
  git(run.root, ['commit', '-q', '-m', 'the run\'s work']);
  git(run.root, ['checkout', '-q', 'main']);
  for (const name of ['one', 'two', 'three']) write(run, `lib/${name}.mjs`, `export const ${name} = 1;\n`);
  git(run.root, ['add', 'lib']);
  git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
  const tip = git(run.root, ['rev-parse', 'HEAD']).trim();
  git(run.root, ['checkout', '-q', 'feature']);
  git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
  return { run, tip };
}

test('move-base: after the default branch is merged in, the review counts only the run\'s own files', t => {
  const { run } = mergedRun(t);
  const moved = verb(['move-base', `--state=${run.state}`, '--reason=merged main']);
  assert.equal(moved.code, 0, moved.stderr);
  const { code, stderr, json } = brief(run);
  assert.equal(code, 0, stderr);
  assert.deepEqual(json.changed.map(entry => entry.path), ['src/app.mjs', 'src/feature.mjs']);
});

test('move-base: with no move, a merged-in default branch is still measured as before', t => {
  const { run } = mergedRun(t);
  const { code, stderr, json } = brief(run);
  assert.equal(code, 0, stderr);
  assert.deepEqual(json.changed.map(entry => entry.path), ['lib/one.mjs', 'lib/three.mjs', 'lib/two.mjs', 'src/app.mjs', 'src/feature.mjs']);
  assert.ok(!Object.hasOwn(json, 'base_moved_from'));
});

/** HEAD's second parent, the merged tip, after a merge. */
function head(run, rev = 'HEAD') {
  return git(run.root, ['rev-parse', rev]).trim();
}

/**
 * A run frozen on a feature branch, the default branch moved on by three files
 * and merged in with a merge commit, with the run's own work in `src/` left as
 * `mode` says: all committed, all uncommitted, or one file of each. README.md
 * is edited before the freeze, so the record starts with one dirty path.
 */
function mergedWith(t, mode) {
  const run = gitScratch(t, FILES);
  git(run.root, ['checkout', '-q', '-b', 'feature']);
  write(run, 'README.md', '# App\n\nedited before the run\n');
  freeze(run);
  git(run.root, ['checkout', '-q', 'main']);
  for (const name of ['one', 'two', 'three']) write(run, `lib/${name}.mjs`, `export const ${name} = 1;\n`);
  git(run.root, ['add', 'lib']);
  git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
  const tip = head(run);
  git(run.root, ['checkout', '-q', 'feature']);
  write(run, 'src/feature.mjs', 'export const feature = 1;\n');
  write(run, 'src/app.mjs', 'export const a = 2;\n');
  const committed = { committed: ['src/feature.mjs', 'src/app.mjs'], uncommitted: [], mixed: ['src/feature.mjs'] }[mode];
  if (committed.length) {
    git(run.root, ['add', ...committed]);
    git(run.root, ['commit', '-q', '-m', 'the run\'s work']);
  }
  git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
  return { run, tip };
}

/** The `workflow:` block as the state file spells it, up to the next top-level key. */
function workflowBlock(run) {
  const text = fs.readFileSync(run.state, 'utf8');
  const match = /^workflow:\n(?:[ \t].*\n|\n)*/m.exec(text);
  assert.ok(match, 'the state file carries a workflow block');
  return match[0];
}

test('move-base: committed, uncommitted and mixed run work each move the base to the merged tip', async t => {
  for (const mode of ['committed', 'uncommitted', 'mixed']) {
    await t.test(mode, s => {
      const { run, tip } = mergedWith(s, mode);
      const old = readState(run).task.base_commit.sha;
      const moved = verb(['move-base', `--state=${run.state}`]);
      assert.equal(moved.code, 0, moved.stderr);
      assert.equal(tip, head(run, 'HEAD^2'));
      const record = readState(run).task.base_commit;
      assert.equal(record.sha, tip);
      // README.md was dirty before the run and still is; the run's own edits are not marked.
      assert.deepEqual(record.dirty, ['README.md']);
      assert.match(moved.stdout, /^task\.base_commit$/m);
      assert.ok(moved.stdout.endsWith(`\nmoved: ${old} → ${tip} (merged tip: HEAD is a merge)\n`), moved.stdout);
    });
  }
});

test('move-base: a HEAD that is not a merge moves the base to HEAD, and --to names the target itself', t => {
  const run = gitScratch(t, FILES);
  git(run.root, ['checkout', '-q', '-b', 'feature']);
  freeze(run);
  const old = head(run);
  git(run.root, ['checkout', '-q', 'main']);
  write(run, 'lib/one.mjs', 'export const one = 1;\n');
  git(run.root, ['add', 'lib']);
  git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
  git(run.root, ['checkout', '-q', 'feature']);
  git(run.root, ['merge', '-q', '--ff-only', 'main']);
  write(run, 'src/app.mjs', 'export const a = 2;\n');
  const moved = verb(['move-base', `--state=${run.state}`]);
  assert.equal(moved.code, 0, moved.stderr);
  assert.equal(readState(run).task.base_commit.sha, head(run));
  assert.ok(moved.stdout.endsWith(`\nmoved: ${old} → ${head(run)} (HEAD: not a merge)\n`), moved.stdout);

  const { run: other, tip } = mergedRun(t);
  const was = readState(other).task.base_commit.sha;
  const named = verb(['move-base', `--state=${other.state}`, '--to=main']);
  assert.equal(named.code, 0, named.stderr);
  assert.equal(readState(other).task.base_commit.sha, tip);
  assert.ok(named.stdout.endsWith(`\nmoved: ${was} → ${tip} (--to)\n`), named.stdout);
});

test('move-base: each refusal exits 1 with its code first, writes nothing and says so', async t => {
  const cases = [
    ['move-base-state-unreadable', s => {
      const { run } = mergedRun(s);
      fs.writeFileSync(run.state, 'task: [unclosed\n  : :\n');
      return { run, flags: [] };
    }],
    ['move-base-no-repository', s => {
      const run = scratch(s);
      freeze(run);
      return { run, flags: [] };
    }],
    ['move-base-merge-in-progress', s => {
      const run = gitScratch(s, FILES);
      git(run.root, ['checkout', '-q', '-b', 'feature']);
      freeze(run);
      git(run.root, ['checkout', '-q', 'main']);
      write(run, 'lib/one.mjs', 'export const one = 1;\n');
      git(run.root, ['add', 'lib']);
      git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
      git(run.root, ['checkout', '-q', 'feature']);
      git(run.root, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
      return { run, flags: [] };
    }],
    ['move-base-no-base', s => {
      const { run } = mergedRun(s);
      const text = fs.readFileSync(run.state, 'utf8');
      fs.writeFileSync(run.state, text.replace(/^ {2}base_commit: .*\n/m, ''));
      return { run, flags: [] };
    }],
    ['move-base-no-base', s => {
      const { run } = mergedRun(s);
      const text = fs.readFileSync(run.state, 'utf8');
      fs.writeFileSync(run.state, text.replace(/(base_commit: \{sha: )[0-9a-f]+/, `$1${'f'.repeat(40)}`));
      return { run, flags: [] };
    }],
    ['move-base-bad-ref', s => ({ run: mergedRun(s).run, flags: ['--to=no-such-ref'] })],
    ['move-base-not-ancestor', s => {
      // Frozen after a commit of the branch's own: the merged tip does not descend from it.
      const run = gitScratch(s, FILES);
      git(run.root, ['checkout', '-q', '-b', 'feature']);
      write(run, 'src/early.mjs', 'export const early = 1;\n');
      git(run.root, ['add', 'src']);
      git(run.root, ['commit', '-q', '-m', 'before the run']);
      freeze(run);
      git(run.root, ['checkout', '-q', 'main']);
      write(run, 'lib/one.mjs', 'export const one = 1;\n');
      git(run.root, ['add', 'lib']);
      git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
      git(run.root, ['checkout', '-q', 'feature']);
      git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
      return { run, flags: [] };
    }],
    ['move-base-not-in-head', s => {
      const { run } = mergedRun(s);
      const base = readState(run).task.base_commit.sha;
      const side = git(run.root, ['commit-tree', `${base}^{tree}`, '-p', base, '-m', 'a commit no branch holds']).trim();
      return { run, flags: [`--to=${side}`] };
    }],
  ];
  for (const [code, setup] of cases) {
    await t.test(code, s => {
      const { run, flags } = setup(s);
      const before = fs.readFileSync(run.state);
      const result = verb(['move-base', `--state=${run.state}`, ...flags]);
      assert.equal(result.code, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.startsWith(`${code}:`), result.stderr);
      assert.match(result.stderr, /Nothing was written\./);
      assert.match(result.stderr, /^rules: .*writing-state\.md § When a write is refused$/m);
      assert.deepEqual(fs.readFileSync(run.state), before);
    });
  }
  await t.test('missing --state', () => {
    const result = verb(['move-base']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^usage: move-base needs --state/);
  });
});

test('move-base: two moves keep both earlier bases in previous, oldest first', t => {
  const { run, tip } = mergedRun(t);
  const first = readState(run).task.base_commit.sha;
  assert.equal(verb(['move-base', `--state=${run.state}`, '--reason=merged "main"\ninto feature']).code, 0);
  git(run.root, ['checkout', '-q', 'main']);
  write(run, 'lib/four.mjs', 'export const four = 1;\n');
  git(run.root, ['add', 'lib']);
  git(run.root, ['commit', '-q', '-m', 'the default branch moves on again']);
  const second = head(run);
  git(run.root, ['checkout', '-q', 'feature']);
  git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge main again', 'main']);
  const moved = verb(['move-base', `--state=${run.state}`]);
  assert.equal(moved.code, 0, moved.stderr);
  const record = readState(run).task.base_commit;
  assert.deepEqual(Object.keys(record), ['sha', 'dirty', 'previous']);
  assert.equal(record.sha, second);
  assert.deepEqual(record.previous.map(entry => Object.keys(entry)), [['sha', 'dirty', 'at', 'reason'], ['sha', 'dirty', 'at', 'reason']]);
  assert.deepEqual(record.previous.map(({ sha, dirty, reason }) => ({ sha, dirty, reason })), [
    { sha: first, dirty: [], reason: 'merged \'main\' into feature' },
    { sha: tip, dirty: [], reason: null },
  ]);
  for (const entry of record.previous) assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('move-base: a patch still cannot set the base after a move, and the workflow block is untouched', t => {
  const { run, tip } = mergedRun(t);
  const block = workflowBlock(run);
  const hash = readState(run).workflow.graph_hash;
  assert.equal(verb(['move-base', `--state=${run.state}`]).code, 0);
  assert.equal(workflowBlock(run), block);
  assert.equal(readState(run).workflow.graph_hash, hash);
  const recorded = readState(run).task.base_commit;
  const result = verb(['write-state', `--state=${run.state}`], { task: { base_commit: { sha: 'deadbeef', dirty: [] } } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /note: ignored the supplied task\.base_commit/);
  assert.deepEqual(readState(run).task.base_commit, recorded);
  assert.equal(recorded.sha, tip);
});

test('move-base: a target equal to the current base writes nothing and says unchanged', t => {
  const { run, tip } = mergedRun(t);
  assert.equal(verb(['move-base', `--state=${run.state}`]).code, 0);
  const before = fs.readFileSync(run.state);
  const again = verb(['move-base', `--state=${run.state}`]);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout, `unchanged: ${tip} (merged tip: HEAD is a merge)\n`);
  assert.deepEqual(fs.readFileSync(run.state), before);
});

// ---------------------------------------------------------------------------
// gaps a review of the first tests found
// ---------------------------------------------------------------------------

test('move-base: a path dirty before the run that the run then commits loses its mark, one left dirty keeps it', t => {
  const run = gitScratch(t, FILES);
  git(run.root, ['checkout', '-q', '-b', 'feature']);
  write(run, 'README.md', '# App\n\nedited before the run\n');
  write(run, 'src/app.mjs', 'export const a = 9;\n');
  freeze(run);
  assert.deepEqual(readState(run).task.base_commit.dirty, ['README.md', 'src/app.mjs']);
  git(run.root, ['checkout', '-q', 'main']);
  write(run, 'lib/one.mjs', 'export const one = 1;\n');
  git(run.root, ['add', 'lib']);
  git(run.root, ['commit', '-q', '-m', 'the default branch moves on']);
  git(run.root, ['checkout', '-q', 'feature']);
  git(run.root, ['add', 'README.md']);
  git(run.root, ['commit', '-q', '-m', 'the run commits the pre-run edit']);
  git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
  const moved = verb(['move-base', `--state=${run.state}`]);
  assert.equal(moved.code, 0, moved.stderr);
  const record = readState(run).task.base_commit;
  assert.deepEqual(record.dirty, ['src/app.mjs']);
  assert.deepEqual(record.previous[0].dirty, ['README.md', 'src/app.mjs']);
});

test('move-base: --to naming a commit before the base is refused as not an ancestor, writing nothing', t => {
  const run = gitScratch(t, FILES);
  write(run, 'src/early.mjs', 'export const early = 1;\n');
  git(run.root, ['add', 'src']);
  git(run.root, ['commit', '-q', '-m', 'before the run']);
  git(run.root, ['checkout', '-q', '-b', 'feature']);
  freeze(run);
  const before = fs.readFileSync(run.state);
  const result = verb(['move-base', `--state=${run.state}`, `--to=${head(run, 'HEAD~1')}`]);
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.startsWith('move-base-not-ancestor:'), result.stderr);
  assert.deepEqual(fs.readFileSync(run.state), before);
});

test('move-base: two editions enabled refuse with edition-collision before the state is even read', t => {
  const { run } = mergedRun(t);
  fs.writeFileSync(run.state, 'task: [unclosed\n  : :\n');
  const before = fs.readFileSync(run.state);
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')).name;
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-settings-'));
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { [`maister@${own}`]: true, 'maister@other-edition': true } }));
  const result = verb(['move-base', `--state=${run.state}`], undefined, { CLAUDE_CONFIG_DIR: config });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^edition-collision: /);
  assert.deepEqual(fs.readFileSync(run.state), before);
});

test('move-base: a cycle-1 brief taken after the move carries no base_moved_from and the moved base', t => {
  const { run, tip } = mergedRun(t);
  assert.equal(verb(['move-base', `--state=${run.state}`]).code, 0);
  const { code, stderr, json } = brief(run);
  assert.equal(code, 0, stderr);
  assert.equal(json.cycle, 1);
  assert.equal(json.base, tip);
  assert.ok(!Object.hasOwn(json, 'base_moved_from'));
});

test('move-base: the merge of a full brief after a move keeps an earlier finding open as not reported, with no fix hunks', t => {
  const { run } = mergedRun(t);
  const dir = path.join(run.dir, 'verification');
  fs.mkdirSync(dir, { recursive: true });
  const reviewer = (cycle, findings) => fs.writeFileSync(path.join(dir, 'code-risk-findings.json'), JSON.stringify({ reviewer: 'code-risk', cycle, mode: 'full', findings }));
  assert.equal(brief(run).code, 0);
  reviewer(1, [{ id: 'cr-1', severity: 'warning', category: 'correctness', location: { path: 'src/feature.mjs', line: 1 }, title: 'Feature has no guard', evidence: 'no guard', fixable: true, risky: false, suggestion: 'add one' }]);
  assert.equal(verb(['findings-merge', `--state=${run.state}`]).code, 0);
  assert.equal(verb(['move-base', `--state=${run.state}`]).code, 0);
  const second = brief(run);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.json.mode, 'full');
  assert.equal(second.json.fix, null);
  reviewer(2, []);
  const merged = verb(['findings-merge', `--state=${run.state}`]);
  assert.equal(merged.code, 0, merged.stderr);
  assert.doesNotMatch(merged.stderr, /findings-merge-fix-hunks/);
  const [kept] = JSON.parse(merged.stdout).issues_found;
  assert.equal(kept.fixed, false);
  const state = readState(run);
  assert.equal(state.verification_context.issues_found.length, 1);
});

test('move-base: the dashboard projection is republished by the move and still reads the run\'s title', t => {
  const { run } = mergedRun(t);
  const before = readDashboard(run);
  const stamp = fs.statSync(path.join(run.dir, 'dashboard-data.js')).mtimeMs;
  assert.equal(verb(['move-base', `--state=${run.state}`]).code, 0);
  const after = readDashboard(run);
  assert.equal(after.task.title, before.task.title);
  assert.equal(after.task.path, before.task.path);
  assert.ok(fs.statSync(path.join(run.dir, 'dashboard-data.js')).mtimeMs >= stamp);
});
