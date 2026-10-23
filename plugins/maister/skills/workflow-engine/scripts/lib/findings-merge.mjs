/**
 * The `findings-merge` verb: one cycle's reviewer findings merged into the
 * run's one numbered list, in code.
 *
 * Why this module exists. Each reviewer writes its findings in one schema
 * (`verification/<reviewer>-findings.json`; the shape is the reviewers'
 * contract, `implementation-verifier/references/review-findings.md`). The
 * verifier used to merge their reports by reading them: the same defect came
 * back twice under two severities, and the numbers the fix loop and the user
 * speak in were kept stable by instruction alone. Here duplicates fold, ids
 * stay put across cycles, and a re-check's new findings are held to the fixes.
 *
 * The contract. `--state` (or `--task-path` standalone) names the run;
 * `--cycle` the cycle, by default the last one with a brief. The inputs are
 * every `*-findings.json` of the run's `verification/` whose `cycle` is this
 * one — `verification-findings.json`, a findings list of another kind, is
 * never one — the previous cycle's merged list (`findings-<N-1>.json`), and
 * this cycle's brief (`review-brief-<N>.json`) for its re-check and its fix:
 * the brief names the fix's two snapshots and its files, and the merge reads
 * the hunks between them from git itself (`fixOf`). Where git cannot answer —
 * no repository, or a snapshot no longer in it — the fix is matched by its
 * files alone, with one warning.
 * The output is `findings-<N>.json`, copied to `findings.json`, and on stdout
 * the counts and the `issues_found` projection the verifier records. Running
 * a cycle's merge again gives the same result, because it reads the cycle
 * before, never its own output.
 *
 * The rules:
 *
 *   duplicates    findings of two reviewers in one cycle fold when they share
 *                 a path, their line ranges overlap or lie within ten lines,
 *                 and their categories are of one family; with no path, when
 *                 the family and the title agree. The fold takes the highest
 *                 severity and marks `severity_disagreement` when the
 *                 reviewers graded it differently; it is fixable only when
 *                 every reviewer says so, and risky when any does.
 *   ids           a finding matching one of the previous cycle's keeps its id,
 *                 one to one; any other takes the next unused number.
 *   not reported  a previous finding a reviewer did not report again in a
 *                 full review stays open, marked `not_reported`: reviewers are
 *                 not deterministic, so silence is not a fix. It is resolved
 *                 only when a fix diff since its last cycle touches its
 *                 location, or a re-check answers it resolved. The test suite
 *                 is the one exception: a failure it no longer reports, in a
 *                 cycle where it ran, is resolved.
 *   outside       a finding its reviewer marks `outside_change` — a defect in
 *                 code the change did not touch, which the change exposes —
 *                 counts only when it is critical; any other goes to
 *                 `out_of_scope`, reported and never counted.
 *   on the base   a finding marked `fails_on_base` — a failing check or test
 *                 the base fails the same way — goes to `out_of_scope` at any
 *                 severity: it is listed, never counted and never fixed. The
 *                 mark holds only with evidence quoting the base; without it
 *                 the finding counts as the change's, with a warning.
 *   failures      the brief's `tests` and `checks` split into the failures
 *                 the change introduced and those the base has too
 *                 (`failuresOf`), which the verdict reads. A failure whose
 *                 base status nobody established is the change's, and a
 *                 check marked `fails_on_base` is the base's only when the
 *                 test suite's finding for it was set aside on that ground.
 *   re-check      a reviewer's answer per issue resolves it or keeps it open;
 *                 its new findings count only inside the fix diff, and the
 *                 rest go to `out_of_scope`, reported and never counted. A
 *                 new finding never takes the id of an issue re-checked in
 *                 the same cycle: those were answered apart. In a
 *                 tests-only re-check, an issue nobody answered is resolved by
 *                 a passing suite, or one whose every failure the base has
 *                 too; under a re-check of the reviews it stays
 *                 open, with a note saying its reviewer did not answer.
 *
 * A file or a finding it cannot use is a warning and is skipped; a severity
 * outside `critical|warning|info` is mapped (`high` → warning, `blocker` →
 * critical …) with a warning. The one refusal is `findings-merge-no-cycle`:
 * no brief and no findings file names a cycle, so there is nothing to merge;
 * `findings-merge-state-unreadable` and `findings-merge-task-unreadable` say
 * the run is not where the caller thinks. Nothing is written on a refusal.
 *
 * Returns `{ok, file, cycle, mode, counts, failures, issues_found, errors, warnings}`
 * and leaves printing to `workflow.mjs`. `node:` builtins and engine libs
 * only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isPlainObject, parse } from './state-read.mjs';
import { projectRootOf } from './state.mjs';
import { parseHunks, patch, repoOf } from './git-tree.mjs';
import { MERGED_FILE, VERIFICATION, briefCycles, projectRootOfTask, readJson, writeJson } from './review-brief.mjs';

/** The one severity scale, most severe first. */
export const SEVERITIES = ['critical', 'warning', 'info'];

/** The other vocabularies the reviewers' reports use, mapped onto the scale. */
const SEVERITY_ALIASES = {
  blocker: 'critical', error: 'critical',
  high: 'warning', medium: 'warning', concern: 'warning', major: 'warning',
  low: 'info', minor: 'info', 'nice-to-have': 'info',
};

/** Categories that describe one kind of defect, so two reviewers' findings of a family can be one. */
const FAMILIES = {
  delivery: 'delivery', docs: 'delivery', tests: 'delivery',
  correctness: 'code', security: 'code', resilience: 'code', performance: 'code',
  simplicity: 'simplicity',
  standards: 'standards',
};

/** Each reviewer's file stem, and the `source` today's `issues_found` names it by. */
export const SOURCES = {
  spec: 'spec_conformance',
  'code-risk': 'code_risk',
  simplicity: 'simplicity',
  'test-suite': 'test_suite',
  artifacts: 'artifacts',
};

/** The reviewer file name: `<stem>-findings.json`. */
const REVIEWER_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-findings\.json$/;

/** The stem of the finding-brief's list, a findings file of another schema. */
const NOT_A_REVIEWER = 'verification';

/** How far apart two findings' lines may lie and still be one defect. */
const NEAR_LINES = 10;

const TEST_SUITE = 'test-suite';

/** The reason a finding the base fails the same way is set aside under. */
const ON_BASE = 'fails on the base too';

export function findingsMerge({ state = null, taskPath = null, cycle = null }) {
  const warnings = [];
  const run = runDirOf({ state, taskPath });
  if (!run.ok) return run;
  const dir = path.join(run.runDir, VERIFICATION);
  const reviewerFiles = readReviewerFiles(dir, warnings);
  const briefs = briefCycles(dir);
  const number = cycle ?? (briefs.length ? briefs[briefs.length - 1] : maxCycle(reviewerFiles));
  if (number === null) {
    return refuse('findings-merge-no-cycle',
      `${dir} holds no review brief and no reviewer findings file, so there is no cycle to merge. Nothing was written. Build the cycle's brief and run the reviews first`);
  }
  const brief = readJson(path.join(dir, `review-brief-${number}.json`));
  const previous = readJson(path.join(dir, MERGED_FILE(number - 1)));
  const prior = isPlainObject(previous) && Array.isArray(previous.findings) ? previous.findings.filter(isPlainObject).map(clone) : [];
  const thisCycle = reviewerFiles.filter(file => file.doc.cycle === number);
  const fixes = fixReader(run, dir, warnings);
  const fix = fixes(number);
  const recheck = isPlainObject(brief?.recheck) ? brief.recheck : null;
  const mode = brief?.mode === 'recheck' ? 'recheck' : 'full';

  // The cycle's own findings: every full review's, and every re-check's new ones inside the fixes.
  const reported = [];
  const outOfScope = [];
  const answers = new Map();
  if (mode === 'recheck' && fix === null && thisCycle.some(file => file.doc.mode === 'recheck')) {
    warnings.push(`findings-merge-scope: cycle ${number}'s brief has no fix diff, so every new re-check finding is kept in scope`);
  }
  for (const { stem, doc } of thisCycle) {
    if (doc.mode === 'recheck') {
      for (const answer of Array.isArray(doc.results) ? doc.results : []) {
        if (!isPlainObject(answer) || !Number.isInteger(answer.id) || !['resolved', 'residual'].includes(answer.status)) {
          warnings.push(`findings-merge-answer-invalid: ${stem}-findings.json has an answer that is not {id, status: resolved|residual, evidence}`);
          continue;
        }
        answers.set(answer.id, [...(answers.get(answer.id) ?? []), { reviewer: stem, ...answer }]);
      }
      for (const raw of listOf(doc.new ?? doc.findings)) {
        const finding = findingOf(raw, stem, warnings);
        if (finding === null) continue;
        if (fix !== null && !insideFix(finding.location, fix)) outOfScope.push({ reviewer: stem, ...raw, severity: finding.severity, reason: 'outside the fix diff' });
        else if (setAside(finding)) outOfScope.push({ reviewer: stem, ...raw, severity: finding.severity, reason: setAside(finding) });
        else reported.push({ ...finding, recheck_new: true });
      }
      continue;
    }
    for (const raw of listOf(doc.findings)) {
      const finding = findingOf(raw, stem, warnings);
      if (finding === null) continue;
      if (setAside(finding)) outOfScope.push({ reviewer: stem, ...raw, severity: finding.severity, reason: setAside(finding) });
      else reported.push(finding);
    }
  }

  const merged = fold(reported);
  const next = { id: prior.reduce((max, finding) => Math.max(max, Number.isInteger(finding.id) ? finding.id : 0), 0) };
  const used = new Set();
  // A re-check's new finding is new by definition: its reviewer was handed
  // the issues being re-checked and answered them apart, so it never takes
  // one of their ids.
  const rechecked = new Set([...answers.keys(), ...listOf(recheck?.issues).map(issue => issue?.id)]);
  for (const { recheck_new: fresh, ...finding } of merged) {
    const match = prior.find(old => !used.has(old.id) && !(fresh && rechecked.has(old.id)) && same(finding, old));
    if (match) {
      used.add(match.id);
      Object.assign(match, finding, {
        id: match.id,
        first_cycle: match.first_cycle ?? number,
        last_cycle: number,
        status: 'open',
        fixed: false,
        history: [...listOf(match.history), ...(match.status === 'resolved' ? [{ cycle: number, status: 'reopened' }] : [])],
      });
      delete match.not_reported;
      delete match.note;
    } else {
      next.id += 1;
      prior.push({ id: next.id, ...finding, status: 'open', fixed: false, first_cycle: number, last_cycle: number, history: [] });
      used.add(next.id);
    }
  }

  // Previous findings this cycle did not report again.
  const ranFull = new Set(thisCycle.filter(file => file.doc.mode !== 'recheck').map(file => file.stem));
  const suiteRan = thisCycle.some(file => file.stem === TEST_SUITE && isPlainObject(file.doc.tests));
  for (const finding of prior) {
    if (used.has(finding.id) || finding.status === 'resolved') continue;
    const reviewers = listOf(finding.sources).map(source => source?.reviewer);
    if (!reviewers.some(reviewer => ranFull.has(reviewer))) continue;
    if (reviewers.includes(TEST_SUITE) && suiteRan && reviewers.every(reviewer => reviewer === TEST_SUITE)) {
      resolve(finding, number, `the test suite no longer reports it in cycle ${number}`);
    } else if (touchedSince(finding, fixes, number)) {
      resolve(finding, number, `not reported again in cycle ${number}, and a fix since cycle ${finding.last_cycle ?? '?'} touched its location`);
    } else {
      finding.not_reported = true;
      finding.history = [...listOf(finding.history), { cycle: number, status: 'not_reported' }];
    }
  }

  // The re-check: each answer, then the issues nobody answered.
  for (const [id, given] of answers) {
    const finding = prior.find(each => each.id === id);
    if (finding === undefined) {
      warnings.push(`findings-merge-answer-unknown: ${given.map(each => each.reviewer).join(', ')} answered issue ${id}, which no earlier cycle found`);
      continue;
    }
    const residual = given.find(each => each.status === 'residual');
    for (const each of given) finding.history = [...listOf(finding.history), { cycle: number, reviewer: each.reviewer, status: each.status, evidence: each.evidence ?? '' }];
    if (residual) {
      Object.assign(finding, { status: 'open', fixed: false, last_cycle: number });
      delete finding.not_reported;
    } else {
      resolve(finding, number, null);
    }
  }
  const failures = failuresOf(brief, outOfScope.filter(each => each.reviewer === TEST_SUITE && each.reason === ON_BASE));
  if (recheck !== null) {
    const suite = thisCycle.find(file => file.stem === TEST_SUITE)?.doc.tests?.status ?? brief?.tests?.status ?? null;
    const suitePassed = suite === 'passed' || (failures?.suite_ran === true && failures.introduced.tests === 0);
    for (const issue of listOf(recheck.issues)) {
      if (!Number.isInteger(issue?.id) || answers.has(issue.id)) continue;
      const finding = prior.find(each => each.id === issue.id);
      if (finding === undefined || finding.status === 'resolved') continue;
      if (recheck.kind === 'tests-only' && suitePassed) {
        resolve(finding, number, suite === 'passed' ? `the test suite passed in cycle ${number}` : `the test suite's only failures in cycle ${number} fail on the base too`);
      } else if (recheck.kind === 'tests-only') {
        finding.note = `the test suite did not pass in cycle ${number} (${suite ?? 'no result'}), so the fix is not confirmed`;
        finding.history = [...listOf(finding.history), { cycle: number, status: 'unconfirmed', evidence: finding.note }];
      } else {
        const owners = listOf(finding.sources).map(source => source?.reviewer).filter(Boolean);
        finding.note = `re-checked in cycle ${number}, and ${owners.join(', ') || 'no reviewer'} did not answer it`;
        finding.history = [...listOf(finding.history), { cycle: number, status: 'unanswered', evidence: finding.note }];
      }
    }
  }

  const findings = prior.sort(rank);
  const counts = countsOf(findings, outOfScope);
  const split = failures === null ? null : { introduced: failures.introduced, on_base: failures.on_base };
  const document = { cycle: number, mode, findings, out_of_scope: outOfScope, counts, failures: split };
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, MERGED_FILE(number)), document);
  const file = path.join(dir, 'findings.json');
  writeJson(file, document);
  return { ok: true, file, cycle: number, mode, counts, failures: split, issues_found: projection(findings), errors: [], warnings };
}

function runDirOf({ state, taskPath }) {
  if (state !== null) {
    try {
      parse(fs.readFileSync(state, 'utf8'));
    } catch (err) {
      return refuse('findings-merge-state-unreadable',
        `${state} cannot be read as a state document: ${err.message}. Nothing was written. Point --state at the run's orchestrator-state.yml`);
    }
    const runDir = path.dirname(path.resolve(state));
    return { ok: true, runDir, projectRoot: projectRootOf(runDir) };
  }
  const runDir = path.resolve(taskPath);
  if (!fs.existsSync(path.join(runDir))) {
    return refuse('findings-merge-task-unreadable', `--task-path=${taskPath} is not a directory. Nothing was written. Point it at the task directory under review`);
  }
  return { ok: true, runDir, projectRoot: projectRootOfTask(runDir) };
}

/**
 * The fix of a cycle, `{from, to, files, hunks}` or null, read from its brief
 * with the hunks worked out from git once per cycle. `hunks` is null when git
 * cannot answer: the fix is then matched by its files alone, and one warning
 * says so.
 */
function fixReader(run, dir, warnings) {
  const known = new Map();
  let repo;
  let warned = false;
  return cycle => {
    if (known.has(cycle)) return known.get(cycle);
    const fix = readJson(path.join(dir, `review-brief-${cycle}.json`))?.fix;
    let found = null;
    if (isPlainObject(fix)) {
      if (repo === undefined) repo = repoOf(run.projectRoot);
      const diff = repo === null || typeof fix.from !== 'string' || typeof fix.to !== 'string'
        ? { ok: false, error: repo === null ? 'the project is not in a git repository' : 'the brief names no snapshots' }
        : patch(repo, fix.from, fix.to);
      if (!diff.ok && !warned) {
        warnings.push(`findings-merge-fix-hunks: ${diff.error}; the fix of cycle ${cycle} is matched by its files alone`);
        warned = true;
      }
      found = { files: listOf(fix.files), hunks: diff.ok ? parseHunks(diff.text).hunks : null };
    }
    known.set(cycle, found);
    return found;
  };
}

/**
 * Why a finding is held aside, or null when it counts: one the base fails the
 * same way, at any severity, or one outside the change unless it is critical.
 */
function setAside(finding) {
  if (finding.fails_on_base === true) return ON_BASE;
  if (finding.outside_change === true && finding.severity !== 'critical') return 'outside the change';
  return null;
}

/**
 * The cycle's failing tests and checks, as its brief carries them, split into
 * `introduced` — the change's, which fail the verdict — and `on_base`, which
 * the base fails the same way and which are only listed: `{introduced:
 * {checks, tests}, on_base: {checks, tests}}`, checks by name and tests as a
 * count of failures and errors. A check is the base's only when it says
 * `fails_on_base: true` and one of the test suite's findings set aside on
 * that ground — so with its evidence — is its own (`ownsCheck`); any other
 * failed check, and a failed test beyond `failed_on_base`, is the change's.
 * Null when the brief has no test result and no checks; `suite_ran` is for
 * the merge alone.
 */
function failuresOf(brief, setAsideOnBase) {
  const tests = isPlainObject(brief?.tests) ? brief.tests : null;
  const checks = Array.isArray(brief?.checks) ? brief.checks.filter(isPlainObject) : null;
  const ran = tests !== null && typeof tests.status === 'string' && !['pending', 'skipped'].includes(tests.status);
  if (!ran && checks === null) return null;
  const tally = value => (Number.isInteger(value) && value > 0 ? value : 0);
  const total = ran ? tally(tests.failed) + tally(tests.errors) : 0;
  const onBase = Math.min(total, ran ? tally(tests.failed_on_base) : 0);
  const failing = listOf(checks).filter(check => check.status === 'failed');
  const base = check => check.fails_on_base === true && setAsideOnBase.some(finding => ownsCheck(finding, check));
  return {
    introduced: { checks: failing.filter(check => !base(check)).map(check => check.name), tests: total - onBase },
    on_base: { checks: failing.filter(base).map(check => check.name), tests: onBase },
    suite_ran: ran,
  };
}

/**
 * Whether a finding is the one filed for a check, as simply as the data
 * allows: its title names the check as a word or quotes its command, or its
 * location is a path the command names exactly. No looser match, because a
 * wrong one would pass a new failure as the base's.
 */
function ownsCheck(finding, check) {
  const title = typeof finding.title === 'string' ? finding.title.toLowerCase() : '';
  const name = check.name.toLowerCase();
  const word = new RegExp(`(^|[^a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`);
  if (word.test(title)) return true;
  if (typeof check.command !== 'string' || check.command.trim() === '') return false;
  if (title.includes(check.command.trim().toLowerCase())) return true;
  const where = isPlainObject(finding.location) && typeof finding.location.path === 'string' ? finding.location.path : null;
  return where !== null && check.command.split(/\s+/).includes(where);
}

/** Every reviewer findings file in the folder that parses, `{stem, doc}`. */
function readReviewerFiles(dir, warnings) {
  let names = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    const match = REVIEWER_FILE.exec(name);
    if (!match || match[1] === NOT_A_REVIEWER) continue;
    const doc = readJson(path.join(dir, name));
    if (!isPlainObject(doc) || !Number.isInteger(doc.cycle)) {
      warnings.push(`findings-merge-file-invalid: ${VERIFICATION}/${name} is not a findings file with a cycle number, and is skipped`);
      continue;
    }
    if (typeof doc.reviewer === 'string' && doc.reviewer !== match[1]) {
      warnings.push(`findings-merge-reviewer-mismatch: ${VERIFICATION}/${name} says reviewer "${doc.reviewer}"; it is read as ${match[1]}`);
    }
    files.push({ stem: match[1], doc });
  }
  return files;
}

function maxCycle(files) {
  return files.length ? Math.max(...files.map(file => file.doc.cycle)) : null;
}

/** A reviewer's finding checked and normalized, or null (with a warning) when it cannot be used. */
function findingOf(raw, stem, warnings) {
  if (!isPlainObject(raw) || typeof raw.title !== 'string' || raw.title.trim() === '') {
    warnings.push(`findings-merge-finding-invalid: a finding of ${stem} has no title, and is skipped`);
    return null;
  }
  let severity = typeof raw.severity === 'string' ? raw.severity.toLowerCase() : '';
  if (!SEVERITIES.includes(severity)) {
    const mapped = SEVERITY_ALIASES[severity] ?? 'warning';
    warnings.push(`findings-merge-severity: ${stem}'s "${raw.title}" says ${JSON.stringify(raw.severity ?? null)}; read as ${mapped}`);
    severity = mapped;
  }
  const where = isPlainObject(raw.location) ? raw.location : {};
  const location = typeof where.path === 'string' && where.path !== ''
    ? {
      path: where.path,
      ...(Number.isInteger(where.line) ? { line: where.line } : {}),
      ...(Number.isInteger(where.end_line) ? { end_line: where.end_line } : {}),
    }
    : null;
  return {
    severity,
    category: typeof raw.category === 'string' && raw.category !== '' ? raw.category : 'correctness',
    location,
    title: raw.title.trim(),
    evidence: typeof raw.evidence === 'string' && raw.evidence !== '' ? [`${stem}: ${raw.evidence}`] : [],
    fixable: raw.fixable === true,
    risky: raw.risky === true,
    suggestion: typeof raw.suggestion === 'string' ? raw.suggestion : '',
    refs: Array.isArray(raw.refs) ? raw.refs.map(String) : [],
    sources: [{ reviewer: stem, id: raw.id ?? null }],
    ...(raw.outside_change === true ? { outside_change: true } : {}),
    ...(onBase(raw, stem, warnings) ? { fails_on_base: true } : {}),
  };
}

/**
 * Whether a finding's `fails_on_base` holds: only with evidence, the base's
 * output quoted. A bare claim would let a new failure pass as the base's, so
 * it is dropped with a warning and the finding counts as the change's.
 */
function onBase(raw, stem, warnings) {
  if (raw.fails_on_base !== true) return false;
  if (typeof raw.evidence === 'string' && raw.evidence.trim() !== '') return true;
  warnings.push(`findings-merge-base-evidence: ${stem}'s "${raw.title.trim()}" says it fails on the base too but quotes no evidence; it counts as the change's`);
  return false;
}

/** One cycle's findings folded across reviewers, most severe first. */
function fold(findings) {
  const clusters = [];
  for (const finding of [...findings].sort(rank)) {
    const reviewer = finding.sources[0].reviewer;
    const home = clusters.find(cluster => same(finding, cluster) && !cluster.sources.some(source => source.reviewer === reviewer));
    if (home === undefined) {
      clusters.push({ ...finding, severities: new Set([finding.severity]) });
      continue;
    }
    if (home.outside_change && !finding.outside_change) delete home.outside_change;
    home.severities.add(finding.severity);
    home.evidence.push(...finding.evidence);
    home.sources.push(...finding.sources);
    home.refs = [...new Set([...home.refs, ...finding.refs])];
    home.fixable = home.fixable && finding.fixable;
    home.recheck_new = home.recheck_new || finding.recheck_new;
    home.risky = home.risky || finding.risky;
    if (!home.suggestion) home.suggestion = finding.suggestion;
  }
  return clusters.map(({ severities, ...cluster }) => (severities.size > 1 ? { ...cluster, severity_disagreement: true } : cluster));
}

/** Whether two findings describe one defect: one family, and one place or one title. */
function same(a, b) {
  if (familyOf(a.category) !== familyOf(b.category)) return false;
  const pa = a.location?.path ?? null;
  const pb = b.location?.path ?? null;
  if (pa === null && pb === null) return titleKey(a.title) === titleKey(b.title);
  if (pa !== pb) return false;
  if (!Number.isInteger(a.location.line) || !Number.isInteger(b.location.line)) return titleKey(a.title) === titleKey(b.title);
  const [aStart, aEnd] = rangeOf(a.location);
  const [bStart, bEnd] = rangeOf(b.location);
  return Math.max(aStart, bStart) - Math.min(aEnd, bEnd) <= NEAR_LINES;
}

function familyOf(category) {
  return FAMILIES[category] ?? category;
}

function titleKey(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function rangeOf(location) {
  const start = location.line;
  const end = Number.isInteger(location.end_line) && location.end_line >= start ? location.end_line : start;
  return [start, end];
}

/** Whether a location lies inside a fix diff: its path changed, and its lines meet a hunk when it names lines and the hunks are known. */
function insideFix(location, fix) {
  if (location === null || !listOf(fix.files).includes(location.path)) return false;
  if (!Number.isInteger(location.line) || fix.hunks === null) return true;
  const [start, end] = rangeOf(location);
  return listOf(fix.hunks).some(hunk => hunk?.path === location.path && hunk.start <= end && hunk.end >= start);
}

/** Whether any fix diff after the finding's last cycle, up to this one, touched its location. */
function touchedSince(finding, fixes, number) {
  if (finding.location === null || finding.location === undefined) return false;
  const from = Number.isInteger(finding.last_cycle) ? finding.last_cycle : number - 1;
  for (let cycle = from + 1; cycle <= number; cycle++) {
    const fix = fixes(cycle);
    if (fix !== null && insideFix(finding.location, fix)) return true;
  }
  return false;
}

function resolve(finding, number, evidence) {
  Object.assign(finding, { status: 'resolved', fixed: true });
  delete finding.not_reported;
  delete finding.note;
  if (evidence !== null) finding.history = [...listOf(finding.history), { cycle: number, status: 'resolved', evidence }];
}

/** Open before resolved, then critical, warning, info, then path, line and id. */
function rank(a, b) {
  return (a.status === 'resolved') - (b.status === 'resolved')
    || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    || String(a.location?.path ?? '￿').localeCompare(String(b.location?.path ?? '￿'))
    || (a.location?.line ?? 0) - (b.location?.line ?? 0)
    || (a.id ?? 0) - (b.id ?? 0)
    || String(a.title).localeCompare(String(b.title));
}

function countsOf(findings, outOfScope) {
  const open = findings.filter(finding => finding.status !== 'resolved');
  return {
    critical: open.filter(finding => finding.severity === 'critical').length,
    warning: open.filter(finding => finding.severity === 'warning').length,
    info: open.filter(finding => finding.severity === 'info').length,
    fixed: findings.filter(finding => finding.fixed === true).length,
    not_reported: open.filter(finding => finding.not_reported === true).length,
    out_of_scope: outOfScope.length,
  };
}

/** `issues_found` as the state contract shapes it (`orchestrator-patterns.md` § 4), in id order. */
function projection(findings) {
  return [...findings].sort((a, b) => a.id - b.id).map(finding => {
    const reviewer = listOf(finding.sources)[0]?.reviewer ?? 'unknown';
    return {
      id: finding.id,
      severity: finding.severity,
      source: SOURCES[reviewer] ?? reviewer.replace(/-/g, '_'),
      description: finding.title,
      fixable: finding.fixable === true,
      risky: finding.risky === true,
      fixed: finding.fixed === true,
    };
  });
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
