/**
 * The result `update-branch` leaves: one JSON file a caller reads in place of
 * the skill's closing prose.
 *
 * Why it exists. A caller that starts the skill in a session nobody watches —
 * a driver — needs to know, mechanically, what the call did: whether it merged,
 * which commit, how each conflict was resolved, what the checks said and where
 * the run's start commit went. Prose is for a person. The skill sends what only
 * the session knows (the outcome, the resolutions, why it stopped) and this
 * module adds every fact git or the run records, so the file cannot misstate
 * them: the branch, full shas, the merge commit, the start commit before and
 * after the move, the driver, and the checks as the test-suite runner wrote
 * them.
 *
 * The shape is declared in `interface-shapes.mjs` (`UPDATE_BRANCH_RESULT`) and
 * published in the plugin's interface file. The written document is checked
 * against that declaration before it lands, so what a reader diffs is what is
 * written.
 *
 * Where it goes: `--result` when given, else `<run>/update-branch.json` beside
 * the `--state` it names. A later call replaces the file whole.
 *
 * The refusals, each writing nothing: `update-branch-result-invalid` (the
 * draft breaks its shape or the rules between its fields),
 * `update-branch-result-state-unreadable`, `update-branch-result-no-repository`,
 * `update-branch-result-bad-commit` (`merged_tip` names no commit),
 * `update-branch-result-not-merged` (a merged outcome while HEAD is not the
 * merge of the merged tip, or a merge is still in progress; an up-to-date one
 * while HEAD lacks the tip), `update-branch-result-base-not-moved` (`moved`
 * claimed while the run records no earlier base) and
 * `update-branch-result-checks-unreadable`.
 *
 * Pure but for the one write: no stdio. Zero dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isPlainObject, parse } from './state-read.mjs';
import { projectRootOf } from './state.mjs';
import { commitOf, isAncestor, repoOf } from './git-tree.mjs';
import { stamp } from '../../../../lib/canonical.mjs';
import {
  UPDATE_BRANCH_BASE_STATUSES,
  UPDATE_BRANCH_CONFLICT,
  UPDATE_BRANCH_OUTCOMES,
  UPDATE_BRANCH_RESOLUTIONS,
  UPDATE_BRANCH_RESULT,
  UPDATE_BRANCH_RESULT_FILE,
  UPDATE_BRANCH_RESULT_VERSION,
  UPDATE_BRANCH_SKIPPED_RUN,
} from './interface-shapes.mjs';

/** The one input file a draft may be read from, beside the result it becomes. */
export const DRAFT_FILE = '.update-branch-draft.json';

const optional = (type, extra = {}) => ({ type, required: false, ...extra });

/** What the session sends: what only it knows. Everything else is derived. */
export const DRAFT = {
  outcome: { type: 'string', required: true, values: UPDATE_BRANCH_OUTCOMES },
  reason: optional('string|null'),
  merged_ref: optional('string|null'),
  merged_tip: optional('string|null'),
  adopted: optional('boolean'),
  base_status: optional('string', { values: UPDATE_BRANCH_BASE_STATUSES }),
  base_refusal: optional('string|null'),
  skipped_runs: optional('array', { items: { type: 'object', keys: UPDATE_BRANCH_SKIPPED_RUN } }),
  conflicts: optional('array', { items: { type: 'object', keys: UPDATE_BRANCH_CONFLICT } }),
  resolutions: optional('object|null', { keys: UPDATE_BRANCH_RESOLUTIONS }),
  checks_reason: optional('string|null'),
  notes: optional('array', { items: { type: 'string' } }),
};

const MERGED = new Set(['merged', 'merged-with-conflicts-resolved']);

/** Why the checks did not run, when the draft does not say, by outcome. */
const NOT_RUN = {
  'up-to-date': 'nothing was merged',
  refused: 'the call stopped before merging',
  stopped: 'the merge was not committed',
};

/** Where the result of a call goes: `result` when given, else beside `state`. */
export function targetOf({ state = null, result = null }) {
  if (result) return path.resolve(result);
  return path.join(path.dirname(path.resolve(state)), UPDATE_BRANCH_RESULT_FILE);
}

/**
 * Build and write the result. `state` is the run's orchestrator-state.yml or
 * null, `result` the file to write or null (one of the two is given), `checks`
 * the test-suite runner's findings file or null, `draft` the session's
 * document, `cwd` the project root when there is no run.
 */
export function updateBranchResult({ state = null, result = null, checks = null, draft, cwd = process.cwd() }) {
  const errors = [];
  validate(draft, { type: 'object', keys: DRAFT }, 'the draft', errors);
  if (errors.length) return invalid(errors);
  ruleErrors(draft, state !== null, checks !== null, errors);
  if (errors.length) return invalid(errors);

  let doc = null;
  let root = path.resolve(cwd);
  if (state !== null) {
    try {
      doc = parse(fs.readFileSync(state, 'utf8'));
    } catch (err) {
      return refuse('update-branch-result-state-unreadable',
        `${state} cannot be read as a state document: ${err.message}. Nothing was written. `
        + 'Name the run\'s orchestrator-state.yml with --state');
    }
    if (!isPlainObject(doc)) {
      return refuse('update-branch-result-state-unreadable',
        `${state} holds no state document. Nothing was written. Name the run's orchestrator-state.yml with --state`);
    }
    root = projectRootOf(path.dirname(path.resolve(state)));
  }

  const repo = repoOf(root);
  if (repo === null) {
    return refuse('update-branch-result-no-repository',
      `the project at ${root} is not inside a git repository, or git is not installed. Nothing was written. `
      + 'Run the verb from the project root');
  }

  const facts = gitFacts(repo, draft);
  if (!facts.ok) return facts;
  const run = state === null ? { ok: true, run: null } : runOf(doc, root, state, draft);
  if (!run.ok) return run;
  const ran = checks === null ? { ok: true, checks: notRun(draft) } : checksOf(checks);
  if (!ran.ok) return ran;

  const document = {
    version: UPDATE_BRANCH_RESULT_VERSION,
    outcome: draft.outcome,
    reason: draft.reason ?? null,
    driver: driverKindOf(doc),
    branch: branchOf(repo),
    merged_ref: draft.merged_ref ?? null,
    merged_tip: facts.mergedTip,
    merge_commit: facts.mergeCommit,
    adopted: draft.adopted === true,
    run: run.run,
    skipped_runs: draft.skipped_runs ?? [],
    conflicts: draft.conflicts ?? [],
    resolutions: draft.resolutions ?? null,
    checks: ran.checks,
    notes: draft.notes ?? [],
    pushed: false,
    written_at: stamp(),
  };
  const own = [];
  validate(document, { type: 'object', keys: UPDATE_BRANCH_RESULT }, 'the result', own);
  if (own.length) throw new Error(`update-branch-result built a document outside its declared shape: ${own.join('; ')}`);

  const file = targetOf({ state, result });
  publish(file, document);
  return { ok: true, file, document, changed: [file], warnings: [] };
}

// ---------------------------------------------------------------------------
// the draft
// ---------------------------------------------------------------------------

/** Check `value` against a declaration, pushing one message per breach into `errors`. */
export function validate(value, decl, where, errors) {
  const types = decl.type.split('|');
  if (!types.some(type => isType(value, type))) {
    errors.push(`${where} must be ${decl.type.replaceAll('|', ' or ')}`);
    return;
  }
  if (value === null) return;
  if (decl.values && !decl.values.includes(value)) {
    errors.push(`${where} must be one of ${decl.values.join(', ')}, and was ${JSON.stringify(value)}`);
  }
  if (decl.keys && isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(decl.keys, key)) errors.push(`${where} has an unknown key ${key}`);
    }
    for (const [key, inner] of Object.entries(decl.keys)) {
      if (!Object.hasOwn(value, key)) {
        if (inner.required) errors.push(`${where} lacks ${key}`);
        continue;
      }
      validate(value[key], inner, `${where}.${key}`, errors);
    }
  }
  if (decl.items && Array.isArray(value)) value.forEach((item, i) => validate(item, decl.items, `${where}[${i}]`, errors));
}

function isType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'object') return isPlainObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

/** The rules between the draft's fields, which no single key's type says. */
function ruleErrors(draft, hasRun, hasChecks, errors) {
  const { outcome } = draft;
  const conflicts = draft.conflicts ?? [];
  const blank = value => typeof value !== 'string' || value.trim() === '';
  if ((outcome === 'refused' || outcome === 'stopped') && blank(draft.reason)) {
    errors.push(`an outcome of ${outcome} needs a reason: one line saying why the call ended there`);
  }
  if (MERGED.has(outcome) || outcome === 'up-to-date') {
    if (blank(draft.merged_ref)) errors.push(`an outcome of ${outcome} needs merged_ref`);
    if (blank(draft.merged_tip)) errors.push(`an outcome of ${outcome} needs merged_tip`);
  }
  if (outcome === 'merged' && conflicts.length) {
    errors.push('an outcome of merged has no conflicts; a merge that had them is merged-with-conflicts-resolved');
  }
  if (outcome === 'merged-with-conflicts-resolved') {
    if (!conflicts.length) errors.push('an outcome of merged-with-conflicts-resolved needs its conflicts');
    if (conflicts.some(each => isPlainObject(each) && each.resolved !== true)) {
      errors.push('a committed merge has every conflict resolved; mark each resolved, or report the call stopped');
    }
    if (!isPlainObject(draft.resolutions)) errors.push('an outcome of merged-with-conflicts-resolved needs resolutions: who accepted them, and why');
  }
  if (!conflicts.length && isPlainObject(draft.resolutions)) errors.push('resolutions are recorded only when there were conflicts');
  const status = draft.base_status ?? 'none';
  if (!hasRun && status !== 'none') errors.push(`base_status ${status} needs --state, the run whose start commit it reports`);
  if (status === 'refused' && blank(draft.base_refusal)) errors.push('base_status refused needs base_refusal: the code move-base printed');
  if (status !== 'refused' && !blank(draft.base_refusal)) errors.push('base_refusal is recorded only with base_status refused');
  if (MERGED.has(outcome) && !hasChecks && blank(draft.checks_reason)) {
    errors.push('a merged outcome without --checks needs checks_reason: why the checks did not run');
  }
  if (hasChecks && !blank(draft.checks_reason)) errors.push('checks_reason is for checks that did not run; --checks says they ran');
}

// ---------------------------------------------------------------------------
// what git and the run record
// ---------------------------------------------------------------------------

/** The merged tip as a full sha, and the merge commit when the outcome is merged. */
function gitFacts(repo, draft) {
  let mergedTip = null;
  if (typeof draft.merged_tip === 'string' && draft.merged_tip.trim() !== '') {
    mergedTip = commitOf(repo, draft.merged_tip.trim());
    if (mergedTip === null) {
      return refuse('update-branch-result-bad-commit',
        `merged_tip ${draft.merged_tip} names no commit in the repository. Nothing was written. `
        + 'Send the merged tip the merge took');
    }
  }
  const head = commitOf(repo, 'HEAD');
  if (MERGED.has(draft.outcome)) {
    const merging = commitOf(repo, 'MERGE_HEAD');
    if (merging !== null) {
      return refuse('update-branch-result-not-merged',
        `a merge is still in progress (MERGE_HEAD is ${merging}), so no merge was committed. Nothing was written. `
        + 'Report the call stopped, or commit the merge first');
    }
    const second = commitOf(repo, 'HEAD^2');
    if (head === null || second !== mergedTip) {
      return refuse('update-branch-result-not-merged',
        `HEAD ${head ?? '(no commit)'} is not the merge of ${mergedTip}`
        + `${second ? ` (its second parent is ${second})` : ' (it is not a merge)'}. Nothing was written. `
        + 'Send the merged tip the merge took, or the outcome the call had');
    }
    return { ok: true, mergedTip, mergeCommit: head };
  }
  if (draft.outcome === 'up-to-date') {
    const held = head === null ? { ok: true, ancestor: false } : isAncestor(repo, mergedTip, head);
    if (!held.ok || !held.ancestor) {
      return refuse('update-branch-result-not-merged',
        `HEAD ${head ?? '(no commit)'} does not contain ${mergedTip}, so the branch is not up to date. `
        + 'Nothing was written. Send the outcome the call had');
    }
  }
  return { ok: true, mergedTip, mergeCommit: null };
}

/** The run block: its folder, what happened to its base, and the move when there was one. */
function runOf(doc, root, state, draft) {
  const taskPath = path.relative(root, path.dirname(path.resolve(state))).split(path.sep).join('/');
  const status = draft.base_status ?? 'none';
  let startCommit = null;
  if (status === 'moved') {
    const base = isPlainObject(doc.task) && isPlainObject(doc.task.base_commit) ? doc.task.base_commit : null;
    const previous = Array.isArray(base?.previous) ? base.previous.filter(isPlainObject) : [];
    const last = previous.at(-1);
    if (!base || typeof base.sha !== 'string' || typeof last?.sha !== 'string') {
      return refuse('update-branch-result-base-not-moved',
        `${state} records no earlier start commit, so its base did not move. Nothing was written. `
        + 'Send the base_status move-base reported');
    }
    startCommit = { from: last.sha, to: base.sha };
  }
  return {
    ok: true,
    run: { task_path: taskPath, base_status: status, start_commit: startCommit, refusal: status === 'refused' ? draft.base_refusal : null },
  };
}

/** The driver kind the run records, `terminal` when it records none or there is no run. */
function driverKindOf(doc) {
  const kind = doc?.orchestrator?.driver?.kind;
  return typeof kind === 'string' && kind !== '' ? kind : 'terminal';
}

/** The current branch's short name, or null on a detached HEAD. */
function branchOf(repo) {
  const found = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repo.top,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return found.status === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : null;
}

/** The checks block when no runner file was given. */
function notRun(draft) {
  const reason = typeof draft.checks_reason === 'string' && draft.checks_reason.trim() !== ''
    ? draft.checks_reason
    : NOT_RUN[draft.outcome] ?? 'the checks did not run';
  return { status: 'not-run', reason, tests: null, checks: [] };
}

const CHECK_STATUSES = ['passed', 'failed'];

/** The test suite's result and the other checks, as the test-suite runner wrote them. */
function checksOf(file) {
  let found;
  try {
    found = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return refuse('update-branch-result-checks-unreadable',
      `${file} cannot be read as the test-suite runner's findings: ${err.message}. Nothing was written. `
      + 'Name the runner\'s test-suite-findings.json with --checks, before its scratch directory is deleted');
  }
  if (!isPlainObject(found)) {
    return refuse('update-branch-result-checks-unreadable',
      `${file} holds no findings document. Nothing was written. Name the runner's test-suite-findings.json with --checks`);
  }
  const count = value => (Number.isInteger(value) ? value : null);
  const textOrNull = value => (typeof value === 'string' ? value : null);
  let tests = null;
  if (isPlainObject(found.tests)) {
    const { status, passed, failed, errors, skipped, command, failed_on_base: onBase } = found.tests;
    tests = {
      status: textOrNull(status),
      passed: count(passed),
      failed: count(failed),
      errors: count(errors),
      skipped: count(skipped),
      command: textOrNull(command),
      ...(Number.isInteger(onBase) && onBase >= 0 ? { failed_on_base: onBase } : {}),
    };
  }
  const checks = (Array.isArray(found.checks) ? found.checks : [])
    .filter(check => isPlainObject(check) && typeof check.name === 'string' && check.name !== '' && CHECK_STATUSES.includes(check.status))
    .map(({ name, command, status, fails_on_base: onBase }) => ({
      name,
      command: textOrNull(command),
      status,
      ...(status === 'failed' && typeof onBase === 'boolean' ? { fails_on_base: onBase } : {}),
    }));
  return { ok: true, checks: { status: 'ran', reason: null, tests, checks } };
}

// ---------------------------------------------------------------------------
// the write
// ---------------------------------------------------------------------------

/** Write the document whole: a temp file beside it, fsynced, renamed over it. */
function publish(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function invalid(errors) {
  return refuse('update-branch-result-invalid',
    `${errors.join('; ')}. Nothing was written. Correct the draft and send it again`);
}

function refuse(code, message) {
  return { ok: false, changed: [], errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
