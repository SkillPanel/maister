/**
 * The `runner-result` and `runner-step` verbs: the two ends of the
 * verification runner's contract, in code.
 *
 * Why this module exists. A verification node may hand its whole loop — the
 * cycles, the review panel, the fix passes and the report — to one subagent,
 * the verification runner, when the run recorded `delegation.mode: nested` at
 * the freeze. The runner ends each dispatch with one result, and the node acts
 * on it: it closes on a verdict, asks a person on a decision, falls back to its
 * own loop when the runner could not nest. Every continuation is a fresh
 * dispatch from the files the runner left, so a crash, a cleared session or a
 * suspended question take the one path an answered decision takes. Whether a
 * result on disk is current, and what the next dispatch carries, is worked out
 * here rather than by the model reading the files.
 *
 * `runner-result --state --node --patch-file` is the runner's. The patch file
 * holds the result object; the verb checks its shape, stamps the node, the
 * node's attempt and the cycle `verification_context.cycle` records, and writes
 * `verification/runner-result.json` through a temp twin and a rename. It
 * prints the file as written, which the runner returns as its final message.
 * The shape, closed keys:
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
 * `runner-step --state --node [--answered]` is the node's. It reads the run and
 * prints one JSON object naming what the node does next:
 *
 *   {next: inline, reason}            the run records no nested delegation
 *   {next: dispatch, resume}          dispatch the runner; resume is `fresh`
 *                                     (no cycle recorded in this node's attempt
 *                                     of this node), `auto` (continue from the
 *                                     cycle files: no current result, an
 *                                     unusable one, or one the runner has moved
 *                                     past), or {cycle, decisions_file}
 *   {next: ask, cycle, kind, findings_file, stop_question, asking,
 *    classes_questions}               a decision the node asks; asking is
 *                                     `session` or `suspend`, or `none` when
 *                                     only the run's policy can settle it
 *   {next: close, verdict, report_path, findings_path, html_path, counts}
 *   {next: unavailable, reason}       the runner could not dispatch subagents
 *
 * A decision is answered into `verification/decisions-<cycle>.json`, the one
 * file this verb writes: `{node, attempt, cycle, kind, answers: [{id, answer,
 * by}], stop}`. Each answer is the option label the person (or the policy)
 * chose for the finding, read off the node summary's decisions under
 * `<node>-findings-<id>` in this attempt — an answer recorded by its option
 * id (`option-2`, `accept-risk`) read as that option's label — or null when
 * nothing answered it;
 * `stop` is the stopping question's answer (`more`, `continue` or `stop`, from
 * `verification-fix-loop`), null when none was put. When the file is written:
 *
 *   --answered    the node has recorded the answers it just took in session,
 *                 or the classing write's; the file is built from them
 *   suspended     under a driver that carries question sets a node asks once
 *                 per attempt, so answers folded into the attempt and no
 *                 decisions file of the attempt yet mean the one request came
 *                 back; a later decision in the attempt takes the defaults
 *   nobody        a run that cannot ask and whose policy classes nothing takes
 *                 the defaults at once: every finding left open, `continue`
 *
 * The refusals, none of them fixed by a state write and each leaving nothing
 * written: `<verb>-state-unreadable`, `<verb>-unknown-node` (no node of the
 * run, or a gate), `<verb>-not-running`, and for `runner-result`
 * `runner-result-invalid` naming the first field that breaks the shape. A
 * result file `runner-step` cannot use is a `runner-result-unusable` warning,
 * and the runner is dispatched to continue from the cycle files.
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

/** The runner's result file, under the run's `verification/`. */
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
export function runnerResult({ state, node, document }) {
  const run = runningNode(state, node, 'runner-result');
  if (!run.ok) return run;
  const fault = resultFault(document, run.runDir);
  if (fault !== null) {
    return refuse('runner-result-invalid',
      `the result in the patch file breaks the runner's result shape at ${fault}. Nothing was written. `
      + 'Correct that field and send the whole result again');
  }
  const stamped = { node, attempt: run.attempt, cycle: run.cycle, ...document };
  const dir = path.join(run.runDir, VERIFICATION);
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

// ---------------------------------------------------------------------------
// runner-step
// ---------------------------------------------------------------------------

/** What the verification node does next: `{ok, step, file?}`. */
export function runnerStep({ state, node, answered = false }) {
  const run = runningNode(state, node, 'runner-step');
  if (!run.ok) return run;
  const warnings = [];
  const ok = (step, extra = {}) => ({ ok: true, step, ...extra, errors: [], warnings });
  const { doc, runDir, attempt } = run;
  const delegation = isPlainObject(doc.orchestrator?.options?.delegation) ? doc.orchestrator.options.delegation : null;
  if (delegation?.mode !== 'nested') return ok({ next: 'inline', reason: inlineReason(delegation) });

  const context = isPlainObject(doc.verification_context) ? doc.verification_context : {};
  const recorded = cycleIn(context);
  const own = context.node === node && Number(context.attempt) === attempt;
  const dir = path.join(runDir, VERIFICATION);
  const result = currentResult(dir, runDir, node, attempt, warnings);

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
  if (fs.existsSync(decisionsFile)) {
    return ok({ next: 'dispatch', resume: { cycle, decisions_file: relative(runDir, decisionsFile) } });
  }
  const { kind } = result.decision;
  const findingsFile = result.decision.findings_file ?? null;
  const stopQuestion = kind !== 'findings';
  const findings = findingsOf(findingsFile, runDir, warnings);
  const ids = findings.map(item => item.id);
  const write = ({ answers, stop }) => {
    writeJson(decisionsFile, { node, attempt, cycle, kind, answers, stop });
    return ok({ next: 'dispatch', resume: { cycle, decisions_file: relative(runDir, decisionsFile) } }, { file: relative(runDir, decisionsFile) });
  };
  const defaults = () => write({ answers: ids.map(id => ({ id, answer: null, by: 'default' })), stop: stopQuestion ? 'continue' : null });

  if (answered) return write(answersOf(doc, node, attempt, findings, stopQuestion, warnings));
  const ask = asking => ok({
    next: 'ask', cycle, kind, findings_file: findingsFile, stop_question: stopQuestion, asking,
    classes_questions: doc.orchestrator?.classes_questions === true,
  });
  if (questionSets(doc)) {
    // One request per attempt: a decisions file of the attempt means it was used.
    if (attemptDecisions(dir, node, attempt).length) return defaults();
    const answers = answersOf(doc, node, attempt, findings, stopQuestion, warnings);
    const back = answers.stopAnswered || answers.answers.some(item => item.answer !== null);
    return back ? write(answers) : ask('suspend');
  }
  if (canAsk(doc)) return ask('session');
  return doc.orchestrator?.classes_questions === true ? ask('none') : defaults();
}

/** Why a run keeps its loop in the main session, in one line. */
function inlineReason(delegation) {
  if (delegation === null) return 'the run recorded no delegation';
  if (isLine(delegation.reason)) return delegation.reason;
  return `delegation is ${delegation.mode ?? 'unset'} (${delegation.source ?? 'no source'})`;
}

/**
 * The result on disk when it is this node's, from this attempt and usable;
 * else null, with a warning for a file that is there but unusable.
 */
function currentResult(dir, runDir, node, attempt, warnings) {
  const file = path.join(dir, RESULT_FILE);
  if (!fs.existsSync(file)) return null;
  const doc = readJson(file);
  if (!isPlainObject(doc)) {
    warnings.push(`runner-result-unusable: ${relative(runDir, file)} is not JSON; the runner continues from the cycle files`);
    return null;
  }
  const { node: of, attempt: at, cycle, ...result } = doc;
  if (of !== node || at !== attempt) return null;
  const fault = resultFault(result, runDir);
  if (fault !== null) {
    warnings.push(`runner-result-unusable: ${relative(runDir, file)} breaks the result shape at ${fault}; the runner continues from the cycle files`);
    return null;
  }
  return { ...result, cycle: Number.isInteger(cycle) ? cycle : null };
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
  const summary = isPlainObject(doc.node_summaries?.[node]) ? doc.node_summaries[node] : {};
  const decisions = (Array.isArray(summary.decisions) ? summary.decisions : [])
    .filter(item => isPlainObject(item) && typeof item.question_id === 'string')
    .filter(item => !Object.hasOwn(item, 'attempt') || Number(item.attempt) === attempt);
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
      `--node=${node} ${entry === null ? 'names no node of this run' : 'is a gate'}. Nothing was written. Name the verification node that runs the loop`);
  }
  if ((entry.status ?? 'pending') !== 'running') {
    return refuse(`${verb}-not-running`,
      `--node=${node} is ${JSON.stringify(entry.status ?? 'pending')}, and only a running node hands its loop to the runner. Nothing was written. `
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
