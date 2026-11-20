/**
 * PostToolUse and PostToolUseFailure (ask_user): record who answered the question.
 *
 * Under autopilot the question tool does not ask anyone: it answers "The user
 * is not available to respond ..." and the session then picks an option on its
 * own. The workflow engine must not record that pick as a person's answer. After
 * each question this hook reads the tool's result and leaves one note in the
 * run's directory, `.ask.result.json`, saying who answered the last question:
 *   - `person`: the result text opens with `User responded:` (or the older
 *     `User selected:`), with the parsed `answers` when they can be told apart
 *     and `typed`, the properties the person answered in their own words;
 *   - `host`: the tool found nobody there to answer;
 *   - `none`: anything else — skipped, cancelled, accepted with no values, a
 *     failed call, a text it does not know.
 * The engine's state writer reads the note; this hook only writes it.
 *
 * It ties the call to a run in this order:
 *   - a run whose `.ask.used.json` or `.ask.json` asks the same questions with
 *     the same option ids, at any age (of several, the state written last);
 *   - otherwise the run that is fresh (state or `display/next.json` within
 *     FRESH_MS) and active (a checkpoint or question set waiting, or a node
 *     running);
 *   - whenever the first rule found no run, every active run whose note still
 *     says `person` as well, so an unused `person` note never outlives a
 *     question this hook saw;
 *   - otherwise nothing is written.
 * Every tied result replaces the earlier note, written to a temporary file and
 * renamed into place. Set-aside copies of a run are never tied.
 *
 * It acts for the main session only, prints nothing, never blocks and fails
 * open: input it cannot read, no run, or any error, and it writes nothing.
 * Registered for the Copilot variant only (`platforms/copilot-cli/hooks.json`).
 *
 * Registered in the exec form, zero dependencies, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

const HOOK_SHAPE = 'claude';

/** How long a run's state or checkpoint stays the question being asked. */
const FRESH_MS = 10 * 60 * 1000;
const RECORD = '.ask.json';
const USED = '.ask.used.json';
const NOTE = '.ask.result.json';
const STATE = 'orchestrator-state.yml';
const SET_ASIDE = /\.(moved|failed)-\d+$/;

/** The tool's arguments, as either host spells them. */
function argumentsOf(input) {
  const args = input?.tool_input ?? input?.toolArgs;
  if (typeof args === 'string') return JSON.parse(args);
  return args;
}

/** The options a property offers, as ids. */
function optionsOf(field) {
  return [
    ...(field?.oneOf || []).map(option => option?.const),
    ...(field?.enum || []),
    ...(field?.items?.enum || []),
    ...(field?.items?.anyOf || []).map(option => option?.const),
  ].filter(id => id !== undefined).map(String);
}

/** The ids that make a call the same question: each property's id and its option ids. */
function signature(call) {
  const properties = call?.requestedSchema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const ids = Object.keys(properties).sort().map(key => {
    const field = properties[key] || {};
    const options = [
      ...(field.oneOf || []).map(option => option?.const),
      ...(field.enum || []),
      ...(field.items?.enum || []),
      ...(field.items?.anyOf || []).map(option => option?.const),
    ].map(String).sort();
    return [key, options];
  });
  return JSON.stringify(ids);
}

/** The result's text and type, as either host spells them. */
function resultOf(input) {
  const result = input?.tool_result ?? input?.toolResult;
  const text = typeof result === 'string' ? result
    : result?.text_result_for_llm ?? result?.textResultForLlm;
  const type = result?.result_type ?? result?.resultType;
  return { text: typeof text === 'string' ? text : '', type: typeof type === 'string' ? type : null };
}

/** The person's value(s) from the text after the prefix: a string, a key → value map, or undefined. */
function answersOf(rest, keys) {
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return rest;
  const map = {};
  let current = null;
  for (const part of rest.split(', ')) {
    const key = keys.find(name => part.startsWith(`${name}=`));
    if (key !== undefined) {
      current = key;
      map[key] = part.slice(key.length + 1);
    } else if (current !== null) {
      map[current] += `, ${part}`;
    } else {
      return undefined;
    }
  }
  return map;
}

/** The properties whose value is not among the options the call offered for them. */
function typedOf(answers, properties) {
  const typed = [];
  for (const [key, field] of Object.entries(properties)) {
    const options = optionsOf(field);
    if (options.length === 0) continue;
    const value = typeof answers === 'string' ? answers : answers?.[key];
    if (typeof value !== 'string') continue;
    const offered = options.includes(value) || (value !== '' && value.split(', ').every(piece => options.includes(piece)));
    if (!offered) typed.push(key);
  }
  return typed;
}

/** The note for this result. */
function noteOf(input, call) {
  const properties = call?.requestedSchema?.properties;
  const keys = properties && typeof properties === 'object' ? Object.keys(properties) : [];
  const note = { outcome: 'none', at: new Date().toISOString(), questions: keys };
  const { text, type } = resultOf(input);
  if (input?.hook_event_name === 'PostToolUseFailure' || (type !== null && type !== 'success') || input?.error) return note;
  if (/\bnot available to respond\b/i.test(text)) {
    note.outcome = 'host';
    return note;
  }
  const prefix = text.match(/^\s*user (responded|selected)\s*:\s*/i);
  if (!prefix) return note;
  note.outcome = 'person';
  const answers = answersOf(text.slice(prefix[0].length).trim(), keys);
  if (answers !== undefined) {
    note.answers = answers;
    const typed = typedOf(answers, properties);
    if (typed.length > 0) note.typed = typed;
  }
  return note;
}

const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return null; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** A run is active when a checkpoint or set waits, or a node runs. */
function isActive(dir) {
  if (mtime(path.join(dir, 'display', 'next.json')) !== null) return true;
  const nodes = readJson(path.join(dir, 'display', 'status.json'))?.nodes;
  const list = Array.isArray(nodes) ? nodes : nodes && typeof nodes === 'object' ? Object.values(nodes) : [];
  return list.some(node => node?.status === 'running');
}

/** Every run directory under the project's tasks, set-aside copies left out. */
function runsOf(root, now) {
  const tasks = path.join(root, '.maister', 'tasks');
  const runs = [];
  for (const type of fs.readdirSync(tasks, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const run of fs.readdirSync(path.join(tasks, type.name), { withFileTypes: true })) {
      if (!run.isDirectory() || SET_ASIDE.test(run.name)) continue;
      const dir = path.join(tasks, type.name, run.name);
      const state = mtime(path.join(dir, STATE)) ?? 0;
      const next = mtime(path.join(dir, 'display', 'next.json')) ?? 0;
      runs.push({ dir, state, fresh: now - Math.max(state, next) <= FRESH_MS && Math.max(state, next) > 0 });
    }
  }
  return runs.sort((a, b) => b.state - a.state);
}

/** The runs this question is tied to. */
function tiedRuns(root, call, now) {
  const runs = runsOf(root, now);
  const wanted = signature(call);
  if (wanted) {
    const matching = runs.filter(run => [USED, RECORD].some(name => {
      const printed = readJson(path.join(run.dir, name));
      return printed && signature(printed) === wanted;
    }));
    if (matching.length > 0) return [matching[0]];
  }
  const tied = [];
  const current = runs.find(run => run.fresh && isActive(run.dir));
  if (current) tied.push(current);
  for (const run of runs) {
    if (tied.includes(run)) continue;
    if (readJson(path.join(run.dir, NOTE))?.outcome === 'person' && isActive(run.dir)) tied.push(run);
  }
  return tied;
}

function writeNote(dir, note) {
  const target = path.join(dir, NOTE);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(note, null, 2)}\n`);
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* nothing to clean */ }
    throw error;
  }
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const agentType = typeof input?.agent_type === 'string' ? input.agent_type : '';
  if (agentType === '') {
    let call = null;
    try { call = argumentsOf(input); } catch { /* a call it cannot read is a free-form one */ }
    const root = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    const note = noteOf(input, call);
    for (const run of tiedRuns(root, call, Date.now())) {
      try { writeNote(run.dir, note); } catch { /* one run's failure leaves the others */ }
    }
  }
} catch {
  // Fail open: nothing is recorded.
}
process.exitCode = 0;
