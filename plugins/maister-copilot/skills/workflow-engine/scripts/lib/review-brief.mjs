/**
 * The `review-brief` verb: what one verification cycle reviews, measured once
 * and handed to every reviewer.
 *
 * Why this module exists. Each reviewer used to work out the change on its
 * own — which files, against which commit, which test result — and spent a
 * share of its calls on it, differently every time. The brief is the facts
 * every reviewer would otherwise scan for, measured once in code and the same
 * for all of them. Judgement about where each reviewer looks hardest is not
 * here: the verification runner writes each reviewer a prompt for that, from
 * the run's documents, which the brief names by path and never reads.
 *
 * The contract. Orchestrator mode takes `--state` (the run's
 * `orchestrator-state.yml`); standalone mode takes `--task-path` (the task
 * directory) and `--base` (the commit the work starts from). In orchestrator
 * mode the base is the freeze's `task.base_commit`; a run frozen before that
 * key existed has none, and then `--base` is required — the verb never
 * guesses one. The verb writes `verification/review-brief-<N>.json` in the run
 * directory and prints its absolute path.
 *
 * The cycle. `--cycle` names it; without it a cycle whose brief exists but
 * whose findings were never merged (`findings-<N>.json` absent) is built again
 * under its number, so a restarted cycle keeps it, and otherwise the next
 * number is taken. `--recheck=tests-only|reviews` with `--fixed-issues` makes
 * a re-check cycle: the brief lists the issues being re-checked, from the
 * previous cycle's merged findings, and which reviewer owns each.
 * `--refresh` re-reads the cycle's test result into its existing brief and
 * touches nothing else: the test suite runs after the brief is built, with the
 * brief, and the reviews after it read its result.
 *
 * What it holds, all paths of run files relative to the run directory and all
 * paths of code relative to the repository's top:
 *
 *   base, snapshot      the base commit, and the working tree as a tree id
 *                       taken through a temporary index (`git-tree.mjs`)
 *   changed, diffstat   every path that differs, untracked files included,
 *                       with its status and line counts; `untracked` and
 *                       `dirty_at_freeze` mark what was never added and what
 *                       was already dirty when the run started, `generated`
 *                       and `data` what a reviewer skips unless a finding
 *                       turns on it (`marksOf`)
 *   fix                 from cycle 2 on, what changed since the previous
 *                       cycle's snapshot: `from`, `to` and its `files`;
 *                       `findings-merge` works out the hunks itself
 *   recheck             in a re-check cycle: its kind, the issues and the
 *                       reviewer owning each
 *   documents           the paths of the run's documents that exist — spec,
 *                       plan, work log, clarifications, the audit, the state
 *                       holding the recorded decisions — never their contents
 *   plan, tests         the plan's group counts; the test result, with
 *                       `failed_on_base` when the runner established how many
 *                       of its failures the base has too
 *   checks              the project's other checks the test-suite runner ran
 *                       (lint, format, typecheck, build), each {name, command,
 *                       status}, and `fails_on_base` on a failed one whose base
 *                       status the runner established; null until it has
 *                       written them
 *   profile             the project profile the reviewers key their checks to,
 *                       its fields and `source`: `config` — the copy the freeze
 *                       recorded, or standalone the `project:` key of the
 *                       project's config.yml — or `none`, when there is no
 *                       profile and each reviewer infers it from the project's
 *                       docs, reporting it as `inferred`
 *   contract            the reviewers' findings contract, by absolute path
 *
 * The project's `.maister/` is never part of the change. A part the verb cannot
 * fill is one warning, `review-brief-<part>: <why>`, and the brief is written
 * without it: a snapshot that fails or outruns its budget leaves out every
 * diff part, never stalls and never refuses.
 *
 * The refusals, each with nothing written: `review-brief-state-unreadable`,
 * `review-brief-task-unreadable`, `review-brief-not-a-repository`,
 * `review-brief-no-base`, `review-brief-bad-base`, `review-brief-no-previous`
 * (a re-check with no brief for the cycle before) and `review-brief-no-brief`
 * (`--refresh` with no brief for the cycle).
 *
 * Returns `{ok, file, cycle, errors, warnings}` and leaves printing to
 * `workflow.mjs`. `node:` builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isPlainObject, parse } from './state-read.mjs';
import { projectRootOf } from './state.mjs';
import { readPlan } from './plan-sync.mjs';
import { projectProfile } from './project-profile.mjs';
import { changedBetween, commitOf, generatedPaths, hasObject, ownDirOf, repoOf, shortstat, snapshot, untrackedPaths } from './git-tree.mjs';

/** The run's verification folder, where every file this verb writes lives. */
export const VERIFICATION = 'verification';

/** One cycle's brief, by number. */
export const BRIEF_FILE = /^review-brief-([1-9]\d*)\.json$/;

/** The merged findings of one cycle, by number: what marks a cycle finished. */
export const MERGED_FILE = cycle => `findings-${cycle}.json`;

/** The test-suite runner's findings file, which carries the cycle's test result. */
export const TEST_FINDINGS = 'test-suite-findings.json';

/** The two kinds of re-check: the tests alone, or the reviews that own the fixed issues. */
export const RECHECK_KINDS = ['tests-only', 'reviews'];

/** The reviewers' contract, relative to the plugin root. */
const CONTRACT = 'skills/implementation-verifier/references/review-findings.md';

const PLAN = 'implementation/implementation-plan.md';
const TEST_RESULTS = `${VERIFICATION}/test-suite-results.md`;

/**
 * The run documents a reviewer's prompt draws on, by the key the brief names
 * each, relative to the run directory. Only those present are listed.
 */
const DOCUMENTS = {
  spec: 'implementation/spec.md',
  plan: PLAN,
  work_log: 'implementation/work-log.md',
  requirements: 'analysis/requirements.md',
  clarifications: 'analysis/clarifications.md',
  scope_clarifications: 'analysis/scope-clarifications.md',
  technical_clarifications: 'analysis/technical-clarifications.md',
  gap_analysis: 'analysis/gap-analysis.md',
  target_state: 'analysis/target-state-plan.md',
  rollback_plan: 'analysis/rollback-plan.md',
  design_context: 'analysis/design-context/INDEX.md',
  spec_audit: `${VERIFICATION}/spec-audit.md`,
};

/**
 * Build, or with `refresh` update, the brief of one cycle.
 */
export function reviewBrief({ state = null, taskPath = null, base = null, cycle = null, recheck = null, fixedIssues = [], refresh = false, pluginRoot }) {
  const warnings = [];
  const run = runOf({ state, taskPath });
  if (!run.ok) return run;
  const { runDir, doc, projectRoot } = run;
  const dir = path.join(runDir, VERIFICATION);
  const existing = briefCycles(dir);
  const last = existing.length ? existing[existing.length - 1] : null;

  if (refresh) {
    const number = cycle ?? last;
    const file = number === null ? null : path.join(dir, `review-brief-${number}.json`);
    const brief = file === null ? null : readJson(file);
    if (!isPlainObject(brief)) {
      return refuse('review-brief-no-brief',
        `there is no review brief${number === null ? '' : ` for cycle ${number}`} in ${dir} to refresh. Nothing was written. Build the cycle's brief first (the same call without --refresh)`);
    }
    brief.tests = testsOf(doc, dir, number, brief.recheck?.kind ?? null, warnings, { refreshing: true });
    brief.checks = checksOf(dir, number);
    writeJson(file, brief);
    return { ok: true, file, cycle: number, errors: [], warnings };
  }

  const repo = repoOf(projectRoot);
  if (repo === null) {
    return refuse('review-brief-not-a-repository',
      `${projectRoot} is not inside a git repository (or git is not installed), so there is no change to measure. Nothing was written. Run verification from the project's checkout`);
  }
  const recorded = isPlainObject(doc?.task?.base_commit) ? doc.task.base_commit : null;
  let baseSha;
  let dirty = new Set();
  if (base !== null) {
    baseSha = commitOf(repo, base);
    if (baseSha === null) {
      return refuse('review-brief-bad-base', `--base=${base} names no commit of ${repo.top}. Nothing was written. Give the commit the work started from`);
    }
    if (recorded?.sha === baseSha) dirty = dirtyOf(recorded);
  } else if (typeof recorded?.sha === 'string') {
    baseSha = commitOf(repo, recorded.sha);
    if (baseSha === null) {
      return refuse('review-brief-bad-base',
        `the run's base commit ${recorded.sha} is no longer in ${repo.top} (history was rewritten since the freeze). Nothing was written. Run the verb again with --base naming the commit the work started from`);
    }
    dirty = dirtyOf(recorded);
  } else {
    return refuse('review-brief-no-base',
      `${doc === null ? 'a standalone brief' : 'this run'} has no base commit to measure from${doc === null ? '' : ' (it was frozen before task.base_commit was recorded)'}. Nothing was written. `
      + 'Run the verb again with --base=<commit the work started from>');
  }

  const number = cycle ?? nextCycle(dir, last);
  const previous = number > 1 ? readJson(path.join(dir, `review-brief-${number - 1}.json`)) : null;
  if (recheck !== null && !isPlainObject(previous)) {
    return refuse('review-brief-no-previous',
      `a re-check builds on the brief of cycle ${number - 1}, and ${dir} has none. Nothing was written. Build a full brief instead (drop --recheck and --fixed-issues), or name the right --cycle`);
  }

  fs.mkdirSync(dir, { recursive: true });
  const brief = {
    cycle: number,
    mode: recheck === null ? 'full' : 'recheck',
    base: baseSha,
    snapshot: null,
    previous_snapshot: isPlainObject(previous) && typeof previous.snapshot === 'string' ? previous.snapshot : null,
    contract: path.join(pluginRoot, CONTRACT),
    changed: null,
    diffstat: null,
    excluded: [`${ownDirOf(repo)}/**`],
    fix: null,
    recheck: null,
    documents: null,
    plan: null,
    tests: null,
    checks: null,
    profile: null,
  };

  const taken = snapshot(repo, baseSha);
  if (!taken.ok) {
    warnings.push(`review-brief-snapshot: ${taken.error}; the brief is written without its diff parts (changed, diffstat, fix)`);
  } else {
    brief.snapshot = taken.tree;
    diffParts(brief, repo, dirty, warnings);
    fixParts(brief, repo, number, previous, warnings);
  }
  if (recheck !== null) brief.recheck = recheckOf(dir, number, recheck, fixedIssues, warnings);
  brief.documents = documentsOf(runDir, state);
  brief.plan = planOf(runDir, warnings);
  brief.tests = testsOf(doc, dir, number, recheck, warnings, { refreshing: false });
  brief.checks = checksOf(dir, number);
  brief.profile = profileOf(doc, projectRoot, warnings);

  const file = path.join(dir, `review-brief-${number}.json`);
  writeJson(file, brief);
  return { ok: true, file, cycle: number, errors: [], warnings };
}

/** The run directory, its state (null standalone) and the project root. */
function runOf({ state, taskPath }) {
  if (state !== null) {
    let doc;
    try {
      doc = parse(fs.readFileSync(state, 'utf8'));
    } catch (err) {
      return refuse('review-brief-state-unreadable',
        `${state} cannot be read as a state document: ${err.message}. Nothing was written. Point --state at the run's orchestrator-state.yml`);
    }
    const runDir = path.dirname(path.resolve(state));
    return { ok: true, runDir, doc, projectRoot: projectRootOf(runDir) };
  }
  const runDir = path.resolve(taskPath);
  let isDir = false;
  try {
    isDir = fs.statSync(runDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return refuse('review-brief-task-unreadable', `--task-path=${taskPath} is not a directory. Nothing was written. Point it at the task directory under review`);
  }
  return { ok: true, runDir, doc: null, projectRoot: projectRootOfTask(runDir) };
}

/** A task directory's project root: above `.maister/tasks/` when it sits there, else the working directory. */
export function projectRootOfTask(runDir) {
  const marker = `${path.sep}.maister${path.sep}tasks${path.sep}`;
  const at = runDir.lastIndexOf(marker);
  return at > 0 ? runDir.slice(0, at) : process.cwd();
}

/** The cycle numbers that have a brief, ascending. */
export function briefCycles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.map(name => BRIEF_FILE.exec(name)).filter(Boolean).map(match => Number(match[1])).sort((a, b) => a - b);
}

/** The cycle a call without `--cycle` builds: the last one again when it was never merged. */
function nextCycle(dir, last) {
  if (last === null) return 1;
  return fs.existsSync(path.join(dir, MERGED_FILE(last))) ? last + 1 : last;
}

function dirtyOf(recorded) {
  return new Set(Array.isArray(recorded.dirty) ? recorded.dirty.map(String) : []);
}

/** `changed` and `diffstat`: base to snapshot. */
function diffParts(brief, repo, dirty, warnings) {
  const changed = changedBetween(repo, brief.base, brief.snapshot);
  if (!changed.ok) {
    warnings.push(`review-brief-changed: ${changed.error}; the brief lists no changed files`);
  } else {
    const untracked = untrackedPaths(repo);
    if (!untracked.ok) warnings.push(`review-brief-untracked: ${untracked.error}; untracked files are listed but not marked`);
    const generated = generatedPaths(repo, changed.changed.map(entry => entry.path));
    if (!generated.ok) warnings.push(`review-brief-generated: ${generated.error}; generated files are marked by name alone`);
    brief.changed = changed.changed.map(entry => ({
      ...entry,
      ...(untracked.ok && untracked.paths.has(entry.path) ? { untracked: true } : {}),
      ...(dirty.has(entry.path) ? { dirty_at_freeze: true } : {}),
      ...marksOf(entry, generated.ok && generated.paths.has(entry.path)),
    }));
  }
  const stat = shortstat(repo, brief.base, brief.snapshot);
  if (stat.ok) brief.diffstat = stat.text;
  else warnings.push(`review-brief-diffstat: ${stat.error}`);
}

/** `fix`: the previous cycle's snapshot to this one, from cycle 2 on; the merge works out its hunks. */
function fixParts(brief, repo, number, previous, warnings) {
  if (number < 2) return;
  if (!isPlainObject(previous)) {
    warnings.push(`review-brief-fix-diff: there is no brief for cycle ${number - 1}, so nothing tells what changed since it`);
    return;
  }
  const from = brief.previous_snapshot;
  if (from === null || !hasObject(repo, from)) {
    warnings.push(`review-brief-fix-diff: cycle ${number - 1}'s snapshot ${from === null ? 'was never taken' : `${from} is no longer in the repository`}, so nothing tells what changed since it`);
    return;
  }
  const fixed = changedBetween(repo, from, brief.snapshot);
  if (!fixed.ok) {
    warnings.push(`review-brief-fix-diff: ${fixed.error}`);
    return;
  }
  brief.fix = { from, to: brief.snapshot, files: fixed.changed.map(entry => entry.path) };
}

// ---------------------------------------------------------------------------
// generated and data
// ---------------------------------------------------------------------------

/** Files a tool writes, by name. */
const GENERATED_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock',
  'Pipfile.lock', 'uv.lock', 'Gemfile.lock', 'composer.lock', 'go.sum', 'mix.lock', 'pubspec.lock', 'packages.lock.json',
  'flake.lock', 'Podfile.lock',
]);
const GENERATED_SUFFIX = /\.(?:min\.(?:js|css)|map)$/i;
/** Folders that hold recorded data rather than code. */
const DATA_DIRS = new Set(['fixtures', 'fixture', 'testdata', '__snapshots__', 'cassettes']);
/** Extensions that are data whatever their size. */
const DATA_EXT = new Set(['csv', 'tsv', 'jsonl', 'ndjson', 'parquet', 'sqlite', 'sqlite3', 'db', 'snap']);
/**
 * Extensions a large file of may be data. Only these meet the line threshold:
 * a large file of source code or of markup the project builds stays unmarked,
 * so a reviewer never skips real code for its size.
 */
const BULK_EXT = new Set(['json', 'yaml', 'yml', 'xml', 'txt', 'log', ...DATA_EXT]);
/** Changed lines past which a file of a bulk extension reads as data. */
export const DATA_LINES = 5000;

/**
 * `generated` — a lock file or minified output by name, or a path the
 * repository marks `linguist-generated`; else `data` — under a fixtures,
 * testdata or snapshots folder, of a data extension, or of a bulk extension
 * past `DATA_LINES` changed lines.
 */
function marksOf(entry, attributed) {
  const segments = entry.path.split('/');
  const name = segments.pop();
  if (attributed || GENERATED_NAMES.has(name) || GENERATED_SUFFIX.test(name)) return { generated: true };
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (segments.some(segment => DATA_DIRS.has(segment)) || DATA_EXT.has(ext)) return { data: true };
  const lines = (entry.added ?? 0) + (entry.removed ?? 0);
  return BULK_EXT.has(ext) && lines > DATA_LINES ? { data: true } : {};
}

/** `recheck`: the issues being re-checked, from the previous cycle's merged findings, and who owns each. */
function recheckOf(dir, number, kind, ids, warnings) {
  const previous = readJson(path.join(dir, MERGED_FILE(number - 1))) ?? readJson(path.join(dir, 'findings.json'));
  const known = new Map();
  if (isPlainObject(previous) && Array.isArray(previous.findings)) {
    for (const finding of previous.findings) if (isPlainObject(finding)) known.set(finding.id, finding);
  } else {
    warnings.push(`review-brief-recheck: no merged findings from cycle ${number - 1}, so the issues are listed by id alone`);
  }
  const issues = [];
  const byReviewer = {};
  for (const id of ids) {
    const finding = known.get(id);
    if (finding === undefined) {
      if (known.size) warnings.push(`review-brief-recheck: issue ${id} is not among cycle ${number - 1}'s findings`);
      issues.push({ id });
      continue;
    }
    const sources = Array.isArray(finding.sources) ? finding.sources.map(source => source?.reviewer).filter(Boolean) : [];
    issues.push({ id, severity: finding.severity, title: finding.title, location: finding.location ?? null, sources });
    for (const reviewer of new Set(sources)) (byReviewer[reviewer] ||= []).push(id);
  }
  return { kind, issues, by_reviewer: byReviewer };
}

/** `documents`: the run's documents that exist, by path, and in a run the state holding its decisions. */
function documentsOf(runDir, state) {
  const found = {};
  for (const [key, file] of Object.entries(DOCUMENTS)) if (fs.existsSync(path.join(runDir, file))) found[key] = file;
  if (state !== null) found.state = path.basename(state);
  return found;
}

/** `plan`: how many task groups, and how many have every step settled. */
function planOf(runDir, warnings) {
  const text = readText(path.join(runDir, PLAN));
  if (text === null) {
    warnings.push(`review-brief-plan: ${PLAN} is not in the run, so the brief carries no group counts`);
    return null;
  }
  const { groups } = readPlan(text);
  return { path: PLAN, groups: groups.size, done: [...groups.values()].filter(Boolean).length };
}

/**
 * `tests`: skipped when the run's options skip the suite (except in a
 * tests-only re-check, which always runs it), the cycle's result once the
 * test-suite runner has written it, else pending.
 */
function testsOf(doc, dir, number, recheck, warnings, { refreshing }) {
  const files = { results: TEST_RESULTS, findings: `${VERIFICATION}/${TEST_FINDINGS}` };
  if (doc?.orchestrator?.options?.skip_test_suite === true && recheck !== 'tests-only') {
    return { status: 'skipped', reason: 'the full suite passed during implementation' };
  }
  const found = readJson(path.join(dir, TEST_FINDINGS));
  if (isPlainObject(found) && found.cycle === number && isPlainObject(found.tests)) {
    const { status = null, passed = null, failed = null, errors = null, skipped = null, command = null, failed_on_base: onBase } = found.tests;
    const failedOnBase = Number.isInteger(onBase) && onBase >= 0 ? { failed_on_base: onBase } : {};
    return { status, passed, failed, errors, skipped, command, ...failedOnBase, ...files };
  }
  if (refreshing) warnings.push(`review-brief-tests: ${VERIFICATION}/${TEST_FINDINGS} holds no test result for cycle ${number}`);
  return { status: 'pending', ...files };
}

/** The statuses a check may report. */
const CHECK_STATUSES = ['passed', 'failed'];

/**
 * `checks`: the project's other checks the test-suite runner ran beside the
 * suite — lint, format, typecheck, build — as it wrote them for this cycle.
 * The suite itself may be skipped while these still run, so they are read on
 * their own. An entry without a name or a known status is left out; no
 * checks written for the cycle is `null`, never an empty pass. A failed
 * check keeps `fails_on_base` when the runner set it to a boolean: `true`
 * when the base fails the same way, so the failure is not the change's.
 */
function checksOf(dir, number) {
  const found = readJson(path.join(dir, TEST_FINDINGS));
  if (!isPlainObject(found) || found.cycle !== number || !Array.isArray(found.checks)) return null;
  return found.checks
    .filter(check => isPlainObject(check) && typeof check.name === 'string' && check.name !== '' && CHECK_STATUSES.includes(check.status))
    .map(({ name, command = null, status, fails_on_base: onBase }) => ({
      name,
      command: typeof command === 'string' ? command : null,
      status,
      ...(status === 'failed' && typeof onBase === 'boolean' ? { fails_on_base: onBase } : {}),
    }));
}

/**
 * `profile`: in a run, the copy the freeze recorded and nothing else, so every
 * cycle of the run reads the same profile; standalone, the project's
 * `config.yml`, a bad value a warning and the field left out. No fields is
 * `{source: none}`.
 */
function profileOf(doc, projectRoot, warnings) {
  if (doc !== null) {
    const frozen = doc.orchestrator?.options?.project;
    return isPlainObject(frozen) && Object.keys(frozen).length ? { ...frozen, source: 'config' } : { source: 'none' };
  }
  const read = projectProfile(projectRoot);
  for (const warning of read.warnings) warnings.push(`review-brief-profile: ${warning.replace(/^project-profile: /, '')}`);
  return read.profile === null ? { source: 'none' } : { ...read.profile, source: 'config' };
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

export function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Write through a temp twin and a rename, so a reader never sees half a file. */
export function writeText(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
