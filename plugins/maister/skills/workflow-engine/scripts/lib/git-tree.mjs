/**
 * The engine's git reads: the commit a run starts from, and the trees a
 * verification cycle reviews.
 *
 * Why this module exists. Maister commits only when a run is finalized, so
 * what a run changed is the distance from the commit it was frozen on to the
 * working tree, untracked files included. Each verification reviewer used to
 * work that out with its own `git diff` and `git log`, differently every time.
 * The freeze now records the base (`task.base_commit`), and `review-brief`
 * measures from it once per cycle, here.
 *
 * What it never does. It never writes the user's index, never commits, never
 * stashes and never moves a ref. The working tree is captured as a tree id
 * through a temporary index of its own (`GIT_INDEX_FILE` pointed at a file in
 * the OS temp directory, removed afterwards): `read-tree` of the base, `add -A`
 * over the project, `write-tree`. The blobs and the tree land in the object
 * store as unreferenced objects, which is what lets a later cycle diff against
 * an earlier one with no commit to point at. `status` runs with
 * `GIT_OPTIONAL_LOCKS=0`, so it does not refresh the user's index either.
 *
 * Every call has a deadline. A fresh temporary index has no stat cache, so the
 * snapshot hashes every tracked file of the project: it gets a generous budget
 * (`SNAPSHOT_TIMEOUT_MS`, overridable through `MAISTER_SNAPSHOT_TIMEOUT_MS`)
 * and the other reads a short one. A call that fails or runs out of time comes
 * back as `{ok: false, error}`; nothing here throws, so a caller turns a
 * failure into a warning and never stalls.
 *
 * Paths are as git spells them: relative to the repository's top, with `/`.
 * The project's own `.maister/` is excluded from every read, wherever the
 * project root sits inside the repository.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The budget of one ordinary git read. */
const READ_TIMEOUT_MS = 30_000;

/** The budget of the whole snapshot: every tracked file is hashed through a cold index. */
export const SNAPSHOT_TIMEOUT_MS = Number(process.env.MAISTER_SNAPSHOT_TIMEOUT_MS) > 0
  ? Number(process.env.MAISTER_SNAPSHOT_TIMEOUT_MS)
  : 300_000;

/** Large enough for a patch of a big change; a larger one is a failed read, reported. */
const MAX_BUFFER = 512 * 1024 * 1024;

/** The most dirty paths a freeze records; a tree past it is named in a warning instead. */
export const DIRTY_MAX = 1000;

/** The project's own directory, never part of what a run changed. */
const OWN_DIR = '.maister';

/**
 * Run one git command. `{ok, stdout}` on exit 0, else `{ok: false, error,
 * timedOut}` with git's last stderr line or the reason it never ran.
 */
function git(cwd, args, { env = {}, timeout = READ_TIMEOUT_MS } = {}) {
  const childEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env };
  // An index inherited from a caller's environment would be read, or written,
  // in place of the one each call means; only the snapshot names one.
  if (!Object.hasOwn(env, 'GIT_INDEX_FILE')) delete childEnv.GIT_INDEX_FILE;
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    return { ok: false, timedOut, error: timedOut ? `git ${args[0]} did not finish within ${timeout} ms` : `git ${args[0]} could not run: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const last = String(result.stderr ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
    return { ok: false, timedOut: false, error: `git ${args[0]} exited ${result.status ?? result.signal}${last ? `: ${last}` : ''}` };
  }
  return { ok: true, stdout: result.stdout };
}

/**
 * The repository holding the project root: its top, and the project root's
 * place inside it as a `/`-ended prefix (`''` when they are one). Null when
 * the project is not in a git repository, or git is not installed.
 */
export function repoOf(projectRoot) {
  let root;
  try {
    root = fs.realpathSync.native(projectRoot);
  } catch {
    return null;
  }
  const found = git(root, ['rev-parse', '--show-toplevel']);
  if (!found.ok) return null;
  let top = found.stdout.trim();
  try {
    top = fs.realpathSync.native(top);
  } catch {
    return null;
  }
  const relative = path.relative(top, root);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const prefix = relative === '' ? '' : `${relative.split(path.sep).join('/')}/`;
  return { top, prefix };
}

/** The project's own directory, as a repository-relative path. */
export function ownDirOf(repo) {
  return `${repo.prefix}${OWN_DIR}`;
}

/** The pathspec every read takes: the whole repository but the project's own directory. */
function scope(repo) {
  return ['--', '.', `:(top,exclude)${ownDirOf(repo)}`];
}

/** The commit `rev` names, or null when it names none. */
export function commitOf(repo, rev) {
  const found = git(repo.top, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return found.ok ? found.stdout.trim() : null;
}

/** Whether a tree (or any object) is still in the object store. */
export function hasObject(repo, id) {
  return typeof id === 'string' && /^[0-9a-f]{7,64}$/.test(id) && git(repo.top, ['cat-file', '-e', `${id}^{tree}`]).ok;
}

/**
 * What a freeze records: HEAD, and the paths already dirty then — modified,
 * staged or untracked, the project's own directory left out. Null when the
 * project is not in a repository (nothing to record and nothing to say);
 * `{warning}` when it is but HEAD has no commit; `{sha, dirty, warning?}`
 * otherwise, the warning naming a status that could not be read or a dirty
 * list cut at `DIRTY_MAX`.
 */
export function baseAtFreeze(projectRoot) {
  const repo = repoOf(projectRoot);
  if (repo === null) return null;
  const sha = commitOf(repo, 'HEAD');
  if (sha === null) {
    return { warning: 'base-commit-unrecorded: the repository has no commit yet, so the run records no base; review-brief will need --base' };
  }
  const status = git(repo.top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', ...scope(repo)]);
  if (!status.ok) {
    return { sha, dirty: [], warning: `base-dirty-unread: ${status.error}; the base is recorded with no dirty paths` };
  }
  const dirty = [...new Set(statusPaths(status.stdout))].sort();
  if (dirty.length > DIRTY_MAX) {
    return { sha, dirty: dirty.slice(0, DIRTY_MAX), warning: `base-dirty-cut: ${dirty.length} paths were dirty at the freeze; the first ${DIRTY_MAX} are recorded` };
  }
  return { sha, dirty };
}

/** The paths of `status --porcelain=v1 -z`: `XY path`, and a rename's or copy's source after it. */
function statusPaths(text) {
  const tokens = text.split('\0');
  const paths = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length < 4) continue;
    paths.push(token.slice(3));
    if (/[RC]/.test(token.slice(0, 2))) {
      if (tokens[i + 1]) paths.push(tokens[i + 1]);
      i++;
    }
  }
  return paths;
}

/**
 * The working tree as a tree id, through a temporary index seeded from
 * `base`. `{ok: true, tree}`, or `{ok: false, error}` for a step that failed
 * or a budget that ran out; the temporary index is removed either way.
 */
export function snapshot(repo, base, { timeout = SNAPSHOT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout;
  const left = () => Math.max(1, deadline - Date.now());
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-snapshot-'));
    const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
    const seeded = git(repo.top, ['read-tree', base], { env, timeout: left() });
    if (!seeded.ok) return seeded;
    const added = git(repo.top, ['add', '-A', ...scope(repo)], { env, timeout: left() });
    if (!added.ok) return added;
    const written = git(repo.top, ['write-tree'], { env, timeout: left() });
    if (!written.ok) return written;
    return { ok: true, tree: written.stdout.trim() };
  } catch (err) {
    return { ok: false, timedOut: false, error: `the temporary index could not be prepared: ${err.message}` };
  } finally {
    if (dir !== null) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The files that differ between two trees, one entry per path in path order:
 * `{path, status, added, removed}` — `status` git's letter (A, M, D, T), the
 * counts null and `binary: true` for a binary file. Renames are not detected,
 * so a moved file reads as one deleted and one added.
 */
export function changedBetween(repo, from, to) {
  const names = git(repo.top, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', from, to, ...scope(repo)]);
  if (!names.ok) return names;
  const counts = git(repo.top, ['diff-tree', '-r', '--no-renames', '--numstat', '-z', from, to, ...scope(repo)]);
  if (!counts.ok) return counts;
  const byPath = new Map();
  const tokens = names.stdout.split('\0');
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (tokens[i] === '') break;
    byPath.set(tokens[i + 1], { path: tokens[i + 1], status: tokens[i].charAt(0), added: null, removed: null });
  }
  for (const record of counts.stdout.split('\0')) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(record);
    if (!match || !byPath.has(match[3])) continue;
    const entry = byPath.get(match[3]);
    if (match[1] === '-') entry.binary = true;
    else Object.assign(entry, { added: Number(match[1]), removed: Number(match[2]) });
  }
  return { ok: true, changed: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/** `N files changed, I insertions(+), D deletions(-)` between two trees. */
export function shortstat(repo, from, to) {
  const found = git(repo.top, ['diff-tree', '-r', '--no-renames', '--shortstat', from, to, ...scope(repo)]);
  if (!found.ok) return found;
  return { ok: true, text: found.stdout.trim() || '0 files changed' };
}

/** The patch between two trees, as `git diff` prints it. */
export function patch(repo, from, to) {
  const found = git(repo.top, ['diff-tree', '-r', '-p', '--no-renames', '--no-color', from, to, ...scope(repo)]);
  if (!found.ok) return found;
  return { ok: true, text: found.stdout };
}

/** The untracked, not-ignored paths of the working tree, read from the user's index without writing it. */
export function untrackedPaths(repo) {
  const found = git(repo.top, ['ls-files', '--others', '--exclude-standard', '-z', ...scope(repo)]);
  if (!found.ok) return found;
  return { ok: true, paths: new Set(found.stdout.split('\0').filter(Boolean)) };
}

/**
 * The new-side line ranges a patch touches, `[{path, start, end}]`, and the
 * paths it touches at all. A hunk's range includes its context lines, so a
 * finding a line or two beside a change still reads as inside it; a pure
 * deletion is the one line it sits before. A deleted file has no new side and
 * is named in `files` only.
 */
export function parseHunks(text) {
  const hunks = [];
  const files = new Set();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      const old = pathOfHeader(line.slice(4), 'a/');
      if (old !== null) files.add(old);
      continue;
    }
    if (line.startsWith('+++ ')) {
      current = pathOfHeader(line.slice(4), 'b/');
      if (current !== null) files.add(current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current !== null) {
      const start = Number(hunk[1]);
      const length = hunk[2] === undefined ? 1 : Number(hunk[2]);
      hunks.push({ path: current, start: Math.max(1, start), end: Math.max(1, start + Math.max(length, 1) - 1) });
    }
  }
  return { hunks, files: [...files].sort() };
}

/** A `---`/`+++` header's path without its prefix; null for `/dev/null`. */
function pathOfHeader(raw, prefix) {
  let value = raw.replace(/\t.*$/, '');
  if (value === '/dev/null') return null;
  if (value.startsWith('"') && value.endsWith('"')) value = unquote(value.slice(1, -1));
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Git's C-style quoting undone: `\\`, `\"`, `\t`, `\n` and octal bytes. */
function unquote(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = text[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(text.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(({ t: 9, n: 10, r: 13, '"': 34, '\\': 92 })[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
