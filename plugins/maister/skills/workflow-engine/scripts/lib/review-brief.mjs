/**
 * The `review-brief` verb: what one verification cycle reviews, measured once
 * and handed to every reviewer.
 *
 * Why this module exists. Each reviewer used to work out the change on its
 * own — which files, against which commit, what the spec asked for, which
 * standards applied — and spent a share of its calls on it, differently every
 * time. The brief is that work done once, in code, so every reviewer of a
 * cycle reads the same scope, and a re-check cycle can point the reviewers at
 * the fixes alone.
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
 *                       was already dirty when the run started
 *   diff_path           the whole patch, `verification/review-diff-<N>.patch`
 *   fix                 from cycle 2 on, what changed since the previous
 *                       cycle's snapshot: `verification/fix-diff-<N>.patch`,
 *                       its files and its new-side hunks — the fix diff
 *                       `findings-merge` scopes a re-check's new findings by
 *   recheck             in a re-check cycle: its kind, the issues and the
 *                       reviewer owning each
 *   spec, plan, tests   the spec's requirement numbers and story ids, parsed
 *                       softly; the plan's group counts; the test result
 *   standards           the standards INDEX entries matching the changed files
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
import { changedBetween, commitOf, hasObject, ownDirOf, parseHunks, patch, repoOf, shortstat, snapshot, untrackedPaths } from './git-tree.mjs';

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

const SPEC = 'implementation/spec.md';
const PLAN = 'implementation/implementation-plan.md';
const TEST_RESULTS = `${VERIFICATION}/test-suite-results.md`;
const INDEX = '.maister/docs/INDEX.md';

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
    diff_path: null,
    excluded: [`${ownDirOf(repo)}/**`],
    fix: null,
    recheck: null,
    spec: null,
    plan: null,
    tests: null,
    standards: [],
  };

  const taken = snapshot(repo, baseSha);
  if (!taken.ok) {
    warnings.push(`review-brief-snapshot: ${taken.error}; the brief is written without its diff parts (changed, diffstat, diff_path, fix)`);
  } else {
    brief.snapshot = taken.tree;
    diffParts(brief, repo, dir, number, dirty, warnings);
    fixParts(brief, repo, dir, number, previous, warnings);
  }
  if (recheck !== null) brief.recheck = recheckOf(dir, number, recheck, fixedIssues, warnings);
  brief.spec = specOf(runDir, warnings);
  brief.plan = planOf(runDir, warnings);
  brief.tests = testsOf(doc, dir, number, recheck, warnings, { refreshing: false });
  brief.standards = standardsOf(projectRoot, repo, brief.changed, warnings);

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
function projectRootOfTask(runDir) {
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

/** `changed`, `diffstat` and `diff_path`: base to snapshot. */
function diffParts(brief, repo, dir, number, dirty, warnings) {
  const changed = changedBetween(repo, brief.base, brief.snapshot);
  if (!changed.ok) {
    warnings.push(`review-brief-changed: ${changed.error}; the brief lists no changed files`);
  } else {
    const untracked = untrackedPaths(repo);
    if (!untracked.ok) warnings.push(`review-brief-untracked: ${untracked.error}; untracked files are listed but not marked`);
    brief.changed = changed.changed.map(entry => ({
      ...entry,
      ...(untracked.ok && untracked.paths.has(entry.path) ? { untracked: true } : {}),
      ...(dirty.has(entry.path) ? { dirty_at_freeze: true } : {}),
    }));
  }
  const stat = shortstat(repo, brief.base, brief.snapshot);
  if (stat.ok) brief.diffstat = stat.text;
  else warnings.push(`review-brief-diffstat: ${stat.error}`);
  const whole = patch(repo, brief.base, brief.snapshot);
  if (!whole.ok) {
    warnings.push(`review-brief-diff: ${whole.error}; no patch file is written`);
    return;
  }
  const name = `review-diff-${number}.patch`;
  writeText(path.join(dir, name), whole.text);
  brief.diff_path = `${VERIFICATION}/${name}`;
}

/** `fix`: the previous cycle's snapshot to this one, from cycle 2 on. */
function fixParts(brief, repo, dir, number, previous, warnings) {
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
  const fixed = patch(repo, from, brief.snapshot);
  if (!fixed.ok) {
    warnings.push(`review-brief-fix-diff: ${fixed.error}`);
    return;
  }
  const name = `fix-diff-${number}.patch`;
  writeText(path.join(dir, name), fixed.text);
  const { hunks, files } = parseHunks(fixed.text);
  brief.fix = { from, to: brief.snapshot, diff_path: `${VERIFICATION}/${name}`, files, hunks };
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

/** `spec`: the requirement numbers under Core Requirements, and every story id. */
function specOf(runDir, warnings) {
  const text = readText(path.join(runDir, SPEC));
  if (text === null) {
    warnings.push(`review-brief-spec: ${SPEC} is not in the run, so the brief carries no requirement or story ids`);
    return { path: SPEC, requirements: [], stories: [] };
  }
  const requirements = [];
  const section = sectionOf(text, /^##\s+Core Requirements\s*$/im);
  for (const match of section.matchAll(/^ {0,3}(\d+)[.)]\s/gm)) if (!requirements.includes(match[1])) requirements.push(match[1]);
  const stories = [...new Set([...text.matchAll(/\buser-story-[a-z0-9]+(?:-[a-z0-9]+)*/g)].map(match => match[0]))];
  if (!requirements.length && !stories.length) {
    warnings.push(`review-brief-spec: ${SPEC} has no numbered Core Requirements and no user-story ids, so the brief carries none`);
  }
  return { path: SPEC, requirements, stories };
}

/** The text from a `## ` heading to the next one, or '' when the heading is absent. */
function sectionOf(text, heading) {
  const start = heading.exec(text);
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const end = /^##\s/m.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
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
    const { status = null, passed = null, failed = null, errors = null, skipped = null, command = null } = found.tests;
    return { status, passed, failed, errors, skipped, command, ...files };
  }
  if (refreshing) warnings.push(`review-brief-tests: ${VERIFICATION}/${TEST_FINDINGS} holds no test result for cycle ${number}`);
  return { status: 'pending', ...files };
}

// ---------------------------------------------------------------------------
// standards
// ---------------------------------------------------------------------------

const TEST_DIR = /^(?:tests?|__tests__|specs?|e2e)$/;
const TEST_NAME = /(?:\.|_)(?:test|spec)\.[^.]+$|^test_/;
const FRONTEND_EXT = new Set(['css', 'scss', 'sass', 'less', 'html', 'vue', 'svelte', 'jsx', 'tsx', 'astro']);
const FRONTEND_DIR = new Set(['components', 'ui', 'pages', 'views', 'styles', 'frontend', 'client', 'web']);
const BACKEND_EXT = new Set(['py', 'rb', 'go', 'java', 'kt', 'php', 'cs', 'rs', 'sql', 'ex', 'exs', 'scala']);
const BACKEND_DIR = new Set(['api', 'server', 'backend', 'routes', 'controllers', 'models', 'migrations', 'db', 'services', 'handlers']);
/** Words an entry spells that say nothing about which files it governs. */
const STOP = new Set(['read', 'full', 'before', 'when', 'what', 'where', 'with', 'from', 'into', 'that', 'this', 'their', 'every', 'everywhere', 'code', 'file', 'files', 'how', 'and', 'the', 'new', 'are', 'for', 'which']);

/** A word's comparable form: lower case, a plural `s` dropped. */
function stem(word) {
  const lower = word.toLowerCase();
  return lower.length > 4 && lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

function wordsOf(text) {
  return String(text).split(/[^A-Za-z0-9]+/).filter(word => word.length >= 4 && !STOP.has(word.toLowerCase())).map(stem);
}

/** What a changed path offers the matcher: its folder names, its name's words, its extension. */
function pathFacts(file) {
  const segments = file.split('/');
  const name = segments.pop();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const dirs = segments.map(segment => segment.toLowerCase());
  const words = new Set([...dirs.flatMap(wordsOf), ...wordsOf(name.replace(/\.[^.]+$/, ''))]);
  return {
    file,
    words,
    test: dirs.some(dir => TEST_DIR.test(dir)) || TEST_NAME.test(name),
    frontend: FRONTEND_EXT.has(ext) || dirs.some(dir => FRONTEND_DIR.has(dir)),
    backend: BACKEND_EXT.has(ext) || dirs.some(dir => BACKEND_DIR.has(dir)),
  };
}

/** The INDEX's entries: a heading ending in `` (`path`) ``, and the lines under it. */
function indexEntries(text) {
  const entries = [];
  let current = null;
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^ {0,3}#{2,6}\s+(.*?)\s*$/.exec(line);
    if (heading) {
      const target = /^(.*?)\s*\(\s*`([^`]+)`\s*\)$/.exec(heading[1]);
      current = target ? { title: target[1], path: target[2], body: [] } : null;
      if (current) entries.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return entries;
}

/**
 * `standards`: the INDEX's standards entries matching the change — every
 * global one, a testing one when tests changed, a frontend or backend one when
 * such a file changed, and any whose path, title or "Read in full before:"
 * words name a folder or a file of the change. Each says why.
 */
function standardsOf(projectRoot, repo, changed, warnings) {
  const text = readText(path.join(projectRoot, INDEX));
  if (text === null) {
    warnings.push(`review-brief-standards: ${INDEX} is not in the project, so the brief names no standards`);
    return [];
  }
  const facts = (changed ?? []).map(entry => pathFacts(entry.path));
  const matched = [];
  for (const entry of indexEntries(text)) {
    if (!entry.path.startsWith('standards/')) continue;
    const area = entry.path.split('/')[1] ?? '';
    const why = whyMatches(entry, area, facts);
    if (why !== null) matched.push({ path: `.maister/docs/${entry.path}`, title: entry.title, why });
  }
  if (repo !== null && changed === null) warnings.push('review-brief-standards: no changed files are known, so only the global standards are named');
  return matched;
}

function whyMatches(entry, area, facts) {
  if (area === 'global') return 'applies to every change';
  const first = predicate => facts.find(predicate)?.file;
  if (/^(?:tests?|testing)$/.test(area)) {
    const hit = first(fact => fact.test);
    if (hit) return `tests changed (${hit})`;
  }
  if (area === 'frontend') {
    const hit = first(fact => fact.frontend);
    if (hit) return `a frontend file changed (${hit})`;
  }
  if (area === 'backend') {
    const hit = first(fact => fact.backend);
    if (hit) return `a backend file changed (${hit})`;
  }
  const before = entry.body.join(' ').split(/read in full before:/i)[1] ?? '';
  const words = new Set([...wordsOf(entry.path.replace(/\.md$/, '')), ...wordsOf(entry.title), ...wordsOf(before)]);
  for (const fact of facts) {
    const word = [...fact.words].find(each => words.has(each));
    if (word) return `${fact.file} matches "${word}"`;
  }
  return null;
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
