/**
 * The run's base moved: the one write that changes `task.base_commit` after
 * the freeze.
 *
 * Why it exists. A run measures what it changed from the commit it was frozen
 * on. Once the default branch is merged into the run's branch, that distance
 * holds everything the merge brought in as well, and every later review would
 * count it as the run's own work. Moving the base to the merged tip puts the
 * merged-in work behind the base again.
 *
 * The base rule. With `--to`, the target is the commit it names. Without it:
 * when HEAD is a merge (two or more parents) and the base is an ancestor of
 * HEAD's second parent, the merged tip, the target is that tip — a run frozen
 * at the branch point or earlier. Whether the run's work is committed,
 * uncommitted or both does not pick it: a diff from the merged tip to the
 * working tree holds both. When the base is on the branch side instead — the
 * run was frozen on a commit of the branch's own, the usual case — the merged
 * tip never descends from it, and the target is the merge commit itself, but
 * only while the merge's first parent is the base (or the base is the merge
 * already): the run committed nothing since, so only its uncommitted work is
 * measured, and nothing of its own goes behind the base. A run with commits
 * of its own since the base is refused, since moving to the merge would hide
 * them from the review. When HEAD is not a merge, the target is HEAD. The
 * result names the rule that chose: `merged tip: HEAD is a merge`, `merge
 * commit: the base is on the branch side`, `HEAD: not a merge` or `--to`.
 *
 * The refusals, in the order they are checked, each leaving the file exactly
 * as it was: `move-base-state-unreadable`, `move-base-no-repository` (no
 * repository, no git, or a status that cannot be read),
 * `move-base-merge-in-progress`, `move-base-no-base` (none recorded, or the
 * recorded commit is gone), `move-base-bad-ref`, `move-base-not-ancestor` (the
 * base does not lead to the target) and `move-base-not-in-head` (HEAD does not
 * hold the target), plus any refusal of the writer itself, passed through.
 * A target equal to the base writes nothing and returns `unchanged`.
 *
 * What it writes. One `writeState` call with an empty patch and the writer's
 * `moveBase` option — the target, the paths dirty now read by the freeze's
 * own rules (`dirtyPaths`) and the reason — so the writer builds the new
 * record from the one it replaces and no patch key can reach it. The
 * workflow block and its hash are untouched.
 *
 * Pure but for the one write: no stdio. Zero dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isPlainObject, parse } from './state-read.mjs';
import { projectRootOf, writeState } from './state.mjs';
import { commitOf, dirtyPaths, isAncestor, repoOf } from './git-tree.mjs';

/** The rule that chose the target, as the result names it. */
export const BASE_RULES = {
  merge: 'merged tip: HEAD is a merge',
  branch: 'merge commit: the base is on the branch side',
  head: 'HEAD: not a merge',
  to: '--to',
};

/**
 * Move the base of the run whose state file is `state`: to `to` when given,
 * else by the base rule. `reason` is recorded with the replaced base, or null.
 * Returns what `writeState` returns, with `move: {from, to, rule}` on success,
 * or `{ok: true, changed: [], unchanged: {base, rule}}` when the target is
 * already the base.
 */
export function moveBase({ state, to = null, reason = null }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('move-base-state-unreadable',
      `${state} cannot be read as a state document: ${err.message}. Nothing was written. `
      + 'Name the run\'s orchestrator-state.yml with --state');
  }
  if (!isPlainObject(doc)) {
    return refuse('move-base-state-unreadable',
      `${state} holds no state document. Nothing was written. Name the run's orchestrator-state.yml with --state`);
  }

  const root = projectRootOf(path.dirname(path.resolve(state)));
  const repo = repoOf(root);
  if (repo === null) {
    return refuse('move-base-no-repository',
      `the project at ${root} is not inside a git repository, or git is not installed. Nothing was written. `
      + 'A run outside git has no base to move');
  }

  const merging = commitOf(repo, 'MERGE_HEAD');
  if (merging !== null) {
    return refuse('move-base-merge-in-progress',
      `a merge is in progress (MERGE_HEAD is ${merging}). Nothing was written. `
      + 'Commit the merge first, then call move-base again');
  }

  const recorded = isPlainObject(doc.task) && isPlainObject(doc.task.base_commit) ? doc.task.base_commit : null;
  if (recorded === null || typeof recorded.sha !== 'string' || recorded.sha === '') {
    return refuse('move-base-no-base',
      'the run records no task.base_commit: it was frozen outside git, or before the key was recorded. '
      + 'Nothing was written. Give review-brief --base for this run instead');
  }
  const base = commitOf(repo, recorded.sha);
  if (base === null) {
    return refuse('move-base-no-base',
      `the run's base ${recorded.sha} is no longer in the repository. Nothing was written. `
      + 'Give review-brief --base for this run instead');
  }

  const chosen = targetOf(repo, to, base);
  if (chosen.refusal) return chosen.refusal;
  const { target, rule } = chosen;
  if (target === null) {
    return refuse('move-base-not-in-head',
      'HEAD names no commit, so there is nothing to move the base to. Nothing was written. '
      + 'Commit on the current branch, or name a commit it holds with --to');
  }

  const leads = isAncestor(repo, base, target);
  if (!leads.ok) return unreadable(leads.error);
  if (!leads.ancestor) {
    return refuse('move-base-not-ancestor',
      `the run's base ${base} is not an ancestor of ${target} (${rule}), so the review would lose part of the run's `
      + 'history. Nothing was written. Name a commit that descends from the base with --to');
  }
  const head = commitOf(repo, 'HEAD');
  const held = head === null ? { ok: true, ancestor: false } : isAncestor(repo, target, head);
  if (!held.ok) return unreadable(held.error);
  if (!held.ancestor) {
    return refuse('move-base-not-in-head',
      `${target} (${rule}) is not an ancestor of HEAD${head === null ? ', which names no commit' : ` ${head}`}. `
      + 'Nothing was written. Name a commit the current branch already holds with --to');
  }

  if (target === base) return { ok: true, changed: [], errors: [], warnings: [], unchanged: { base, rule } };

  const dirty = dirtyPaths(repo);
  if (!dirty.ok) return unreadable(dirty.error);
  const result = writeState({ state, patch: {}, moveBase: { sha: target, dirty: dirty.dirty, reason: reasonOf(reason) } });
  if (!result.ok) return result;
  return { ...result, move: { from: base, to: target, rule } };
}

/**
 * The target and the rule that chose it, or a refusal: `move-base-bad-ref`
 * for a `--to` naming no commit, `move-base-not-ancestor` for a run on the
 * branch side of a merge with commits of its own since its base.
 */
function targetOf(repo, to, base) {
  if (to !== null) {
    const target = commitOf(repo, to);
    if (target === null) {
      return { refusal: refuse('move-base-bad-ref',
        `--to=${to} names no commit. Nothing was written. Name a commit, a branch or a tag with --to, `
        + 'or leave it out for the base rule') };
    }
    return { target, rule: BASE_RULES.to };
  }
  const tip = commitOf(repo, 'HEAD^2');
  if (tip === null) return { target: commitOf(repo, 'HEAD'), rule: BASE_RULES.head };
  const merged = { target: tip, rule: BASE_RULES.merge };
  const behind = isAncestor(repo, base, tip);
  if (!behind.ok) return { refusal: unreadable(behind.error) };
  if (behind.ancestor) return merged;
  // The base is not behind the merged tip: on the branch side, or on neither.
  const head = commitOf(repo, 'HEAD');
  const first = commitOf(repo, 'HEAD^1');
  if (base === head || base === first) return { target: head, rule: BASE_RULES.branch };
  const own = first === null ? { ok: true, ancestor: false } : isAncestor(repo, base, first);
  if (!own.ok) return { refusal: unreadable(own.error) };
  // On neither side: the ancestry check refuses it against the merged tip.
  if (!own.ancestor) return merged;
  return { refusal: refuse('move-base-not-ancestor',
    `the run's base ${base} is on the branch side of the merge ${head}, and the run has commits of its own since it, `
    + `so moving the base to the merge would hide them from the review (${BASE_RULES.branch}). Nothing was written. `
    + 'The review keeps measuring from the old base; name a target with --to only when those commits are meant to go behind it') };
}

/**
 * `--reason` on one line, its double quotes written as single ones — the
 * one-line state reader takes neither a newline nor a double quote — or null
 * when it is missing or blank.
 */
function reasonOf(reason) {
  if (typeof reason !== 'string') return null;
  const line = reason.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return line === '' ? null : line;
}

/** A repository read that failed partway: the status or the ancestry. */
function unreadable(error) {
  return refuse('move-base-no-repository',
    `the repository cannot be read: ${error}. Nothing was written. Fix what git reports, then call move-base again`);
}

function refuse(code, message) {
  return { ok: false, changed: [], errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
