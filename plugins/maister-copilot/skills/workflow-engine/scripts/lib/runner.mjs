/**
 * The `runner-result` and `runner-step` verbs: the two ends of a runner's
 * contract, in code, for the two loops a node may hand to a runner subagent —
 * verification's cycles and implementation's waves.
 *
 * Why this module exists. A node may hand its whole loop to one subagent, a
 * runner, when the run recorded `delegation.mode: nested` at the freeze: the
 * verification runner carries the cycles, the review panel, the fix passes and
 * the report; the implementation runner carries the waves, each group's
 * implementer, the group returns, the escalations and the closing entry. A
 * runner ends each dispatch with one result, and the node acts on it: it closes
 * on the loop's end, asks a person on a decision, falls back to its own loop
 * when the runner could not nest. Every continuation is a fresh dispatch from
 * the files the runner left, so a crash, a cleared session or a suspended
 * question take the one path an answered decision takes. Whether a result on
 * disk is current, and what the next dispatch carries, is worked out here
 * rather than by the model reading the files.
 *
 * `--runner` names the loop: `verification` (the default) or `implementation`.
 * Each keeps its files in its own folder of the run — `verification/` or
 * `implementation/` — and the two never read each other's.
 *
 * `runner-result --state --node [--runner] --patch-file` is the runner's. The
 * patch file holds the result object; the verb checks its shape, stamps the
 * node, the node's attempt and where the loop stands, and writes
 * `<folder>/runner-result.json` through a temp twin and a rename. It prints the
 * file as written, which the runner returns as its final message.
 *
 * The verification result, closed keys, stamped with the cycle
 * `verification_context.cycle` records:
 *
 *   result     verdict | needs_decision | unavailable
 *   verdict    passed | passed_with_issues | failed          a verdict only
 *   report_path, findings_path, html_path                    run-relative paths;
 *              report_path required with a verdict; html_path null unless a
 *              companion was written
 *   counts     {critical, warning, info, fixed}, whole numbers
 *   decision   {kind: findings | budget | no_progress, findings_file,
 *              resume_token: {cycle, snapshot}}           needs_decision only;
 *              findings_file is required for findings and may be null otherwise
 *   reason     one line; required when unavailable
 *
 * The implementation result, closed keys, stamped with the pass — one more than
 * the decisions files of this node's attempt, so no state key counts it:
 *
 *   result         done | needs_decision | unavailable
 *   work_log_path  run-relative; required when done
 *   summary        {groups_done, groups_total, models, test_suite,
 *                  docs_changed, standard_candidates, stopped}   done only;
 *                  models and test_suite one line, the two lists one line an
 *                  item, stopped one line or null
 *   decision       {kind: groups | budget, questions_file, wave}   needs_decision
 *                  only; questions_file a question set inside the run that
 *                  `question-set.mjs` accepts, every option with its id
 *   reason         one line; required when unavailable
 *
 * `runner-step --state --node [--runner] [--answered]` is the node's. It reads
 * the run and prints one JSON object naming what the node does next:
 *
 *   {next: inline, reason}            the run records no nested delegation
 *   {next: dispatch, resume}          dispatch the runner; resume is `fresh`,
 *                                     `auto` (continue from the files: no
 *                                     current result, an unusable one, or one
 *                                     the runner has moved past), or the
 *                                     answered decision — {cycle,
 *                                     decisions_file} or {pass, decisions_file}
 *   {next: ask, …, asking, classes_questions}
 *                                     a decision the node asks; asking is
 *                                     `session` or `suspend`, or `none` when
 *                                     only the run's policy can settle it.
 *                                     Verification adds cycle, kind,
 *                                     findings_file and stop_question;
 *                                     implementation pass, kind and
 *                                     questions_file
 *   {next: close, …}                  verification: verdict, report_path,
 *                                     findings_path, html_path, counts;
 *                                     implementation: work_log_path, summary
 *   {next: unavailable, reason}       the runner could not dispatch subagents
 *
 * Verification is `fresh` when no cycle is recorded in this node's attempt;
 * implementation when the run has no work log yet.
 *
 * A decision is answered into `<folder>/decisions-<cycle or pass>.json`, the
 * one file this verb writes: `{node, attempt, cycle | pass, kind, answers:
 * [{id, answer, by}], stop}` (`stop` verification's only). Each answer is the
 * option label the person (or the policy) chose, read off the node summary's
 * decisions in this attempt — verification's under `<node>-findings-<id>`,
 * implementation's under each question's own id — an answer recorded by its
 * option id (`option-2`, `accept-risk`, `retry`) read as that option's label,
 * or, when nothing answered it, null for a finding and the question's default
 * for an implementation question. `stop` is the stopping question's answer
 * (`more`, `continue` or `stop`, from `verification-fix-loop`), null when none
 * was put. When the file is written:
 *
 *   --answered    the node has recorded the answers it just took in session,
 *                 or the classing write's; the file is built from them
 *   suspended     under a driver that carries question sets a node asks once
 *                 per attempt, so answers folded into the attempt and no
 *                 decisions file of the attempt yet mean the one request came
 *                 back; a later decision in the attempt takes the defaults
 *   nobody        a run that cannot ask and whose policy classes nothing takes
 *                 the defaults at once: every finding left open and
 *                 `continue`, every implementation question its default
 *
 * The refusals, none of them fixed by a state write and each leaving nothing
 * written: `<verb>-state-unreadable`, `<verb>-unknown-node` (no node of the
 * run, or a gate), `<verb>-not-running`, and for `runner-result`
 * `runner-result-invalid` naming the first field that breaks the shape. A
 * result file `runner-step` cannot use is a `runner-result-unusable` warning,
 * and the runner is dispatched to continue from the files.
 *
 * Returns `{ok, …, errors, warnings}` and leaves printing to `workflow.mjs`.
 * `node:` builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isPlainObject, parse } from './state-read.mjs';
import { attemptOf } from './state.mjs';
import { questionSets, canAsk } from './driver.mjs';
import { VERIFICATION, readJson, writeJson } from './review-brief.mjs';
import { ACCEPT_OPTION } from './finding-brief.mjs';
import { checkSet } from './question-set.mjs';

/** The loops a runner carries, each in its own folder of the run. */
export const RUNNERS = ['verification', 'implementation'];
const IMPLEMENTATION = 'implementation';

/** The runner's result file, in its loop's folder of the run. */
export const RESULT_FILE = 'runner-result.json';

/** A decision's answers file for a cycle. */
export const DECISIONS_FILE = cycle => `decisions-${cycle}.json`;
const DECISIONS_NAME = /^decisions-([1-9]\d*)\.json$/;

export const RESULTS = ['verdict', 'needs_decision', 'unavailable'];
export const VERDICTS = ['passed', 'passed_with_issues', 'failed'];
export const DECISION_KINDS = ['findings', 'budget', 'no_progress'];
const COUNT_KEYS = ['critical', 'warning', 'info', 'fixed'];
const RESULT_KEYS = ['result', 'verdict', 'report_path', 'findings_path', 'html_path', 'counts', 'decision', 'reason'];
const DECISION_KEYS = ['kind', 'findings_file', 'resume_token'];
const TOKEN_KEYS = ['cycle', 'snapshot'];

export const IMPLEMENTATION_RESULTS = ['done', 'needs_decision', 'unavailable'];
export const IMPLEMENTATION_KINDS = ['groups', 'budget'];
const IMPLEMENTATION_KEYS = ['result', 'work_log_path', 'summary', 'decision', 'reason'];
const SUMMARY_KEYS = ['groups_done', 'groups_total', 'models', 'test_suite', 'docs_changed', 'standard_candidates', 'stopped'];
const IMPLEMENTATION_DECISION_KEYS = ['kind', 'questions_file', 'wave'];
/** Where the run's work log lives: its presence means the waves have begun. */
const WORK_LOG = `${IMPLEMENTATION}/work-log.md`;

/** The stopping question every verification loop declares, and how its answers read. */
export const STOP_QUESTION = 'verification-fix-loop';
const STOP_ANSWERS = [[/^one more/i, 'more'], [/^continue/i, 'continue'], [/^stop/i, 'stop']];

/** The suffix of a reviewing node's declared finding question id. */
const FINDINGS_SUFFIX = '-findings';

const isLine = value => typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value);
const isCount = value => Number.isInteger(value) && value >= 0;

// ---------------------------------------------------------------------------
// runner-result
// ---------------------------------------------------------------------------

/** Check, stamp and write the runner's result: `{ok, file, result}`. */
export function runnerResult({ state, node, document, runner = VERIFICATION }) {
  const run = runningNode(state, node, 'runner-result');
  if (!run.ok) return run;
  const implementation = runner === IMPLEMENTATION;
  const fault = (implementation ? implementationFault : resultFault)(document, run.runDir);
  if (fault !== null) {
    return refuse('runner-result-invalid',
      `the result in the patch file breaks the ${runner} runner's result shape at ${fault}. Nothing was written. `
      + 'Correct that field and send the whole result again');
  }
  const dir = path.join(run.runDir, runner);
  const where = implementation
    ? { pass: attemptDecisions(dir, node, run.attempt).length + 1 }
    : { cycle: run.cycle };
  const stamped = { node, attempt: run.attempt, ...where, ...document };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, RESULT_FILE);
  writeJson(file, stamped);
  return { ok: true, file: relative(run.runDir, file), result: stamped, errors: [], warnings: [] };
}

/** The first field of `doc` that breaks the result shape, or null. */
export function resultFault(doc, runDir) {
  if (!isPlainObject(doc)) return '(root)';
  const extra = Object.keys(doc).find(key => !RESULT_KEYS.includes(key));
  if (extra !== undefined) return extra;
  if (!RESULTS.includes(doc.result)) return 'result';
  for (const key of ['report_path', 'findings_path', 'html_path']) {
    if (Object.hasOwn(doc, key) && doc[key] !== null && !insideRun(doc[key], runDir)) return key;
  }
  if (Object.hasOwn(doc, 'counts')) {
    if (!isPlainObject(doc.counts)) return 'counts';
    const bad = Object.keys(doc.counts).find(key => !COUNT_KEYS.includes(key)) ?? COUNT_KEYS.find(key => !isCount(doc.counts[key]));
    if (bad !== undefined) return `counts.${bad}`;
  }
  if (Object.hasOwn(doc, 'reason') && !isLine(doc.reason)) return 'reason';
  if (doc.result === 'verdict') {
    if (!VERDICTS.includes(doc.verdict)) return 'verdict';
    if (typeof doc.report_path !== 'string') return 'report_path';
    if (Object.hasOwn(doc, 'decision')) return 'decision';
  } else if (Object.hasOwn(doc, 'verdict')) {
    return 'verdict';
  }
  if (doc.result === 'needs_decision') {
    const decision = doc.decision;
    if (!isPlainObject(decision)) return 'decision';
    const unknown = Object.keys(decision).find(key => !DECISION_KEYS.includes(key));
    if (unknown !== undefined) return `decision.${unknown}`;
    if (!DECISION_KINDS.includes(decision.kind)) return 'decision.kind';
    const file = decision.findings_file ?? null;
    if (file === null ? decision.kind === 'findings' : !insideRun(file, runDir)) return 'decision.findings_file';
    const token = decision.resume_token;
    if (!isPlainObject(token)) return 'decision.resume_token';
    const tokenKey = Object.keys(token).find(key => !TOKEN_KEYS.includes(key));
    if (tokenKey !== undefined) return `decision.resume_token.${tokenKey}`;
    if (!Number.isInteger(token.cycle) || token.cycle < 1) return 'decision.resume_token.cycle';
    if (Object.hasOwn(token, 'snapshot') && token.snapshot !== null && !isLine(token.snapshot)) return 'decision.resume_token.snapshot';
  } else if (Object.hasOwn(doc, 'decision')) {
    return 'decision';
  }
  if (doc.result === 'unavailable' && !isLine(doc.reason)) return 'reason';
  return null;
}

/** The first field of an implementation result that breaks its shape, or null. */
export function implementationFault(doc, runDir) {
  if (!isPlainObject(doc)) return '(root)';
  const extra = Object.keys(doc).find(key => !IMPLEMENTATION_KEYS.includes(key));
  if (extra !== undefined) return extra;
  if (!IMPLEMENTATION_RESULTS.includes(doc.result)) return 'result';
  if (Object.hasOwn(doc, 'work_log_path') && doc.work_log_path !== null && !insideRun(doc.work_log_path, runDir)) return 'work_log_path';
  if (Object.hasOwn(doc, 'reason') && !isLine(doc.reason)) return 'reason';
  if (doc.result === 'done') {
    if (typeof doc.work_log_path !== 'string') return 'work_log_path';
    const fault = summaryFault(doc.summary);
    if (fault !== null) return fault;
  } else if (Object.hasOwn(doc, 'summary')) {
    return 'summary';
  }
  if (doc.result === 'needs_decision') {
    const decision = doc.decision;
    if (!isPlainObject(decision)) return 'decision';
    const unknown = Object.keys(decision).find(key => !IMPLEMENTATION_DECISION_KEYS.includes(key));
    if (unknown !== undefined) return `decision.${unknown}`;
    if (!IMPLEMENTATION_KINDS.includes(decision.kind)) return 'decision.kind';
    if (!insideRun(decision.questions_file, runDir) || questionsOf(decision.questions_file, runDir) === null) return 'decision.questions_file';
    if (!Number.isInteger(decision.wave) || decision.wave < 1) return 'decision.wave';
  } else if (Object.hasOwn(doc, 'decision')) {
    return 'decision';
  }
  if (doc.result === 'unavailable' && !isLine(doc.reason)) return 'reason';
  return null;
}

/** The first field of a `done` summary that breaks its shape, or null. */
function summaryFault(summary) {
  if (!isPlainObject(summary)) return 'summary';
  const at = key => `summary.${key}`;
  const extra = Object.keys(summary).find(key => !SUMMARY_KEYS.includes(key));
  if (extra !== undefined) return at(extra);
  for (const key of ['groups_done', 'groups_total']) if (!isCount(summary[key])) return at(key);
  if (summary.groups_done > summary.groups_total) return at('groups_done');
  for (const key of ['models', 'test_suite']) if (!isLine(summary[key])) return at(key);
  for (const key of ['docs_changed', 'standard_candidates']) {
    if (!Array.isArray(summary[key]) || !summary[key].every(isLine)) return at(key);
  }
  if (summary.stopped !== null && !isLine(summary.stopped)) return at('stopped');
  return null;
}

/** A decision's question set as the engine reads it, or null when it cannot be asked. */
function questionsOf(file, runDir) {
  const checked = checkSet(readJson(path.resolve(runDir, file)));
  return checked.ok ? checked.set.questions : null;
}

// ---------------------------------------------------------------------------
// runner-step
// ---------------------------------------------------------------------------

/** What the node running a loop does next: `{ok, step, file?}`. */
export function runnerStep({ state, node, answered = false, runner = VERIFICATION }) {
  const run = runningNode(state, node, 'runner-step');
  if (!run.ok) return run;
  const warnings = [];
  const ok = (step, extra = {}) => ({ ok: true, step, ...extra, errors: [], warnings });
  const delegation = isPlainObject(run.doc.orchestrator?.options?.delegation) ? run.doc.orchestrator.options.delegation : null;
  if (delegation?.mode !== 'nested') return ok({ next: 'inline', reason: inlineReason(delegation) });
  return (runner === IMPLEMENTATION ? implementationStep : verificationStep)({ run, node, answered, warnings, ok });
}

/** Verification's next step, from `verification_context` and the cycle files. */
function verificationStep({ run, node, answered, warnings, ok }) {
  const { doc, runDir, attempt } = run;
  const context = isPlainObject(doc.verification_context) ? doc.verification_context : {};
  const recorded = cycleIn(context);
  const own = context.node === node && Number(context.attempt) === attempt;
  const dir = path.join(runDir, VERIFICATION);
  const result = currentResult({ dir, runDir, node, attempt, warnings, fault: resultFault, stamp: 'cycle' });

  // Nothing of this attempt to act on: start, or continue from the cycle files.
  const fresh = recorded === null || (context.node === node && !own);
  if (result === null || (recorded !== null && result.cycle !== null && result.cycle < recorded)) {
    return ok({ next: 'dispatch', resume: fresh ? 'fresh' : 'auto' });
  }
  if (result.result === 'unavailable') return ok({ next: 'unavailable', reason: result.reason });
  if (result.result === 'verdict') {
    const { verdict, report_path, findings_path = null, html_path = null, counts = null } = result;
    return ok({ next: 'close', verdict, report_path, findings_path, html_path, counts });
  }

  const cycle = result.decision.resume_token.cycle;
  const decisionsFile = path.join(dir, DECISIONS_FILE(cycle));
  const resume = { cycle, decisions_file: relative(runDir, decisionsFile) };
  if (fs.existsSync(decisionsFile)) return ok({ next: 'dispatch', resume });
  const { kind } = result.decision;
  const findingsFile = result.decision.findings_file ?? null;
  const stopQuestion = kind !== 'findings';
  const findings = findingsOf(findingsFile, runDir, warnings);
  const ids = findings.map(item => item.id);
  return decide({
    run, node, dir, answered,
    collect: () => {
      const { answers, stop, stopAnswered } = answersOf(doc, node, attempt, findings, stopQuestion, warnings);
      return { body: { answers, stop }, back: stopAnswered || answers.some(item => item.answer !== null) };
    },
    defaults: () => ({ answers: ids.map(id => ({ id, answer: null, by: 'default' })), stop: stopQuestion ? 'continue' : null }),
    write: body => {
      writeJson(decisionsFile, { node, attempt, cycle, kind, ...body });
      return ok({ next: 'dispatch', resume }, { file: resume.decisions_file });
    },
    ask: asking => ok({
      next: 'ask', cycle, kind, findings_file: findingsFile, stop_question: stopQuestion, asking,
      classes_questions: doc.orchestrator?.classes_questions === true,
    }),
  });
}

/** Implementation's next step, from its result, its decisions files and the work log. */
function implementationStep({ run, node, answered, warnings, ok }) {
  const { doc, runDir, attempt } = run;
  const dir = path.join(runDir, IMPLEMENTATION);
  const result = currentResult({ dir, runDir, node, attempt, warnings, fault: implementationFault, stamp: 'pass' });
  if (result === null) {
    return ok({ next: 'dispatch', resume: fs.existsSync(path.join(runDir, ...WORK_LOG.split('/'))) ? 'auto' : 'fresh' });
  }
  if (result.result === 'unavailable') return ok({ next: 'unavailable', reason: result.reason });
  if (result.result === 'done') return ok({ next: 'close', work_log_path: result.work_log_path, summary: result.summary });

  // A result whose pass was never stamped cannot name its decisions file.
  if (result.pass === null) return ok({ next: 'dispatch', resume: 'auto' });
  const { pass } = result;
  const decisionsFile = path.join(dir, DECISIONS_FILE(pass));
  const resume = { pass, decisions_file: relative(runDir, decisionsFile) };
  if (fs.existsSync(decisionsFile)) return ok({ next: 'dispatch', resume });
  const { kind, questions_file: questionsFile } = result.decision;
  const questions = questionsOf(questionsFile, runDir) ?? [];
  return decide({
    run, node, dir, answered,
    collect: () => {
      const answers = questionAnswers(doc, node, attempt, questions);
      return { body: { answers }, back: answers.some(item => item.by !== 'default') };
    },
    defaults: () => ({ answers: questions.map(question => ({ id: question.id, answer: defaultLabel(question), by: 'default' })) }),
    write: body => {
      writeJson(decisionsFile, { node, attempt, pass, kind, ...body });
      return ok({ next: 'dispatch', resume }, { file: resume.decisions_file });
    },
    ask: asking => ok({
      next: 'ask', pass, kind, questions_file: questionsFile, asking,
      classes_questions: doc.orchestrator?.classes_questions === true,
    }),
  });
}

/**
 * Who answers a decision, the same for every runner: the answers the node just
 * recorded; under a driver that carries question sets, the attempt's one
 * request (a later decision takes the defaults); in session, the person; where
 * nobody can be asked, the policy's classing write, else the defaults at once.
 */
function decide({ run, node, dir, answered, collect, defaults, write, ask }) {
  const { doc, attempt } = run;
  if (answered) return write(collect().body);
  if (questionSets(doc)) {
    if (attemptDecisions(dir, node, attempt).length) return write(defaults());
    const collected = collect();
    return collected.back ? write(collected.body) : ask('suspend');
  }
  if (canAsk(doc)) return ask('session');
  return doc.orchestrator?.classes_questions === true ? ask('none') : write(defaults());
}

/** Why a run keeps its loop in the main session, in one line. */
function inlineReason(delegation) {
  if (delegation === null) return 'the run recorded no delegation';
  if (isLine(delegation.reason)) return delegation.reason;
  return `delegation is ${delegation.mode ?? 'unset'} (${delegation.source ?? 'no source'})`;
}

/**
 * The result on disk when it is this node's, from this attempt and usable;
 * else null, with a warning for a file that is there but unusable. `stamp`
 * names where the loop stood when it was written: `cycle` or `pass`.
 */
function currentResult({ dir, runDir, node, attempt, warnings, fault, stamp }) {
  const file = path.join(dir, RESULT_FILE);
  if (!fs.existsSync(file)) return null;
  const doc = readJson(file);
  if (!isPlainObject(doc)) {
    warnings.push(`runner-result-unusable: ${relative(runDir, file)} is not JSON; the runner continues from the files`);
    return null;
  }
  const { node: of, attempt: at, [stamp]: where, ...result } = doc;
  if (of !== node || at !== attempt) return null;
  const broken = fault(result, runDir);
  if (broken !== null) {
    warnings.push(`runner-result-unusable: ${relative(runDir, file)} breaks the result shape at ${broken}; the runner continues from the files`);
    return null;
  }
  return { ...result, [stamp]: Number.isInteger(where) ? where : null };
}

/** The decision's findings, in its list's order; empty when there is none. */
function findingsOf(file, runDir, warnings) {
  if (file === null) return [];
  const doc = readJson(path.resolve(runDir, file));
  if (!isPlainObject(doc) || !Array.isArray(doc.findings)) {
    warnings.push(`runner-findings-unreadable: ${file} holds no findings list; its answers are not recorded`);
    return [];
  }
  return doc.findings.filter(item => isPlainObject(item) && typeof item.id === 'string');
}

/**
 * An answer as the option's label. A question set names its options
 * `option-1..n` and `accept-risk`, and an answer recorded by that id is read
 * as the label it stands for, so the runner always gets the words.
 */
function labelFor(finding, answer) {
  if (answer === ACCEPT_OPTION.id) return ACCEPT_OPTION.label;
  const match = /^option-([1-9]\d*)$/.exec(answer);
  const options = Array.isArray(finding?.options) ? finding.options : [];
  const option = match ? options[Number(match[1]) - 1] : null;
  return isPlainObject(option) && typeof option.label === 'string' ? option.label : answer;
}

/** The attempt's answers to the decision's questions, from the node summary. */
function answersOf(doc, node, attempt, findings, stopQuestion, warnings) {
  const decisions = attemptAnswers(doc, node, attempt);
  const latest = id => decisions.filter(item => item.question_id === id).at(-1) ?? null;
  const answers = findings.map(finding => {
    const item = latest(`${node}${FINDINGS_SUFFIX}-${finding.id}`);
    const label = item === null ? null : labelOf(item);
    const answer = label === null ? null : labelFor(finding, label);
    return { id: finding.id, answer, by: answer === null ? 'default' : item.by ?? 'operator' };
  });
  let stop = null;
  let stopAnswered = false;
  if (stopQuestion) {
    const item = latest(STOP_QUESTION);
    const label = item === null ? null : labelOf(item);
    stopAnswered = label !== null;
    stop = label === null ? 'continue' : stopOf(label, warnings);
  }
  return { answers, stop, stopAnswered };
}

/**
 * The attempt's answers to an implementation decision's questions, from the
 * node summary under each question's own id; a question nobody answered takes
 * its default.
 */
function questionAnswers(doc, node, attempt, questions) {
  const decisions = attemptAnswers(doc, node, attempt);
  return questions.map(question => {
    const item = decisions.filter(entry => entry.question_id === question.id).at(-1) ?? null;
    const label = item === null ? null : labelOf(item);
    if (label === null) return { id: question.id, answer: defaultLabel(question), by: 'default' };
    return { id: question.id, answer: optionLabel(question, label), by: item.by ?? 'operator' };
  });
}

/** A question's default as its option's label, or null when it names none. */
function defaultLabel(question) {
  if (!Object.hasOwn(question, 'default')) return null;
  const ids = Array.isArray(question.default) ? question.default : [question.default];
  return ids.map(id => optionLabel(question, id)).join(', ');
}

/** An answer recorded by an option's id, read as that option's label. */
function optionLabel(question, answer) {
  const option = question.options.find(each => each.id === answer);
  return option === undefined ? answer : option.label;
}

/** The node summary's decisions of this attempt that name their question. */
function attemptAnswers(doc, node, attempt) {
  const summary = isPlainObject(doc.node_summaries?.[node]) ? doc.node_summaries[node] : {};
  return (Array.isArray(summary.decisions) ? summary.decisions : [])
    .filter(item => isPlainObject(item) && typeof item.question_id === 'string')
    .filter(item => !Object.hasOwn(item, 'attempt') || Number(item.attempt) === attempt);
}

/** The label a decision records as its answer. */
function labelOf(item) {
  const value = item.answer ?? item.decision ?? null;
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : null;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The stopping question's answer as `more`, `continue` or `stop`. */
function stopOf(label, warnings) {
  const hit = STOP_ANSWERS.find(([pattern]) => pattern.test(label.trim()));
  if (hit) return hit[1];
  warnings.push(`runner-stop-unread: the stopping answer "${label}" names no round, continue or stop; read as continue`);
  return 'continue';
}

/** The decisions files written for this node's attempt. */
function attemptDecisions(dir, node, attempt) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter(name => DECISIONS_NAME.test(name)).filter(name => {
    const doc = readJson(path.join(dir, name));
    return isPlainObject(doc) && doc.node === node && doc.attempt === attempt;
  });
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

/** The state, the node and its attempt, or the refusal of `verb`. */
function runningNode(state, node, verb) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse(`${verb}-state-unreadable`,
      `${state} cannot be read as a state document: ${err.message}. Nothing was written. Point --state at the run's orchestrator-state.yml`);
  }
  const nodes = isPlainObject(doc.workflow?.nodes) ? doc.workflow.nodes : {};
  const entry = Object.hasOwn(nodes, node) && isPlainObject(nodes[node]) ? nodes[node] : null;
  if (entry === null || entry.kind === 'gate') {
    return refuse(`${verb}-unknown-node`,
      `--node=${node} ${entry === null ? 'names no node of this run' : 'is a gate'}. Nothing was written. Name the node that runs the loop`);
  }
  if ((entry.status ?? 'pending') !== 'running') {
    return refuse(`${verb}-not-running`,
      `--node=${node} is ${JSON.stringify(entry.status ?? 'pending')}, and only a running node hands its loop to a runner. Nothing was written. `
      + 'Start the node through write-state first, or name the one that is running');
  }
  const context = isPlainObject(doc.verification_context) ? doc.verification_context : {};
  return { ok: true, doc, runDir: path.dirname(path.resolve(state)), attempt: attemptOf(entry), cycle: cycleIn(context) };
}

/** `verification_context.cycle` as a whole number, or null. */
function cycleIn(context) {
  const value = Number(context.cycle);
  return context.cycle !== undefined && context.cycle !== null && Number.isInteger(value) && value > 0 ? value : null;
}

/** Whether `given` is a path that resolves inside the run directory. */
function insideRun(given, runDir) {
  if (typeof given !== 'string' || given.trim() === '' || path.isAbsolute(given)) return false;
  const rel = path.relative(runDir, path.resolve(runDir, given));
  return rel !== '' && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
}

function relative(runDir, file) {
  return path.relative(runDir, file).split(path.sep).join('/');
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
