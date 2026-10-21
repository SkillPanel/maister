/**
 * The implementation phase's bookkeeping, one call per moment: a wave starts,
 * or groups the executor accepted come back.
 *
 * Why this module exists. Each group return used to cost the orchestrator two
 * to four turns: a clock read, the plan's checkboxes ticked by hand (runs wrote
 * their own marking scripts for it), a work-log entry whose heading the
 * dashboard parses, `sync-plan`, and an empty state write that only redrew the
 * dashboard and the status line. Every one of those turns re-read the whole
 * session. The steps are mechanical, so they are code: the heading contract and
 * the clock live here rather than in prose, and one call does the moment.
 *
 * What it decides, and what it does not. The orchestrator still judges a
 * group's report and decides whether to accept it; `groupDone` only records an
 * accepted one. The wave a group belongs to is read from the work log — the last
 * `Wave K Started:` heading naming it — so a group can never be logged under a
 * wave that did not dispatch it.
 *
 * The order, and why a partial failure repairs itself. `groupDone` marks the
 * plan, syncs the plan's HTML companion, appends the work-log entry, then
 * re-projects the run's displays. Each step is idempotent on its own: marking
 * sets marks rather than flipping them, the sync is a projection, an entry
 * already in the log after its wave's start is not appended again, and the
 * re-projection is the empty state write the executor used to send. So a call
 * that stops part-way leaves files the same call finishes when it is run again,
 * and the refusal says so. The plan and the log are each written whole through
 * a temp twin and a rename, so neither is ever left half-written.
 *
 * The re-projection is a warning at worst, never a refusal: the plan and the
 * log are the record, and the dashboard and the status line are drawn from
 * them by the next state write whichever one it is.
 *
 * Refusal codes (`group-done-…` and `wave-start-…`): `plan-unreadable`,
 * `plan-unwritable`, `log-unreadable`, `log-unwritable`, `unknown-group`;
 * `group-done-no-wave`, `group-done-entry-invalid`; `wave-start-group-done`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CHECKBOX, GROUP_HEADING, SECTION_HEADING, WAVE_START } from './dashboard.mjs';
import { syncPlan } from './plan-sync.mjs';
import { writeState } from './state.mjs';
import { stamp } from '../../../../lib/canonical.mjs';

/** The work log beside the plan: the executor's fixed artifact name. */
const WORK_LOG = 'work-log.md';

/** The state file one level above `implementation/`, when the plan belongs to a run. */
const STATE_FILE = 'orchestrator-state.yml';

/** A line opening one group's part of a multi-group entry: `## Group 3`. */
const OPENER = /^##\s+Group\s+(\d+)\s*$/;

/** A `#` or `##` heading, which an entry body may not carry: the log's own headings are this module's. */
const STRAY_HEADING = /^#{1,2}\s/;

/** An empty step checkbox, the one mark `groupDone` sets. */
const OPEN_BOX = /^([ \t]*-\s)\[ \]/gm;

/**
 * Record groups the orchestrator accepted: tick their steps, sync the
 * companion, log one entry per group under its wave, re-project.
 *
 * `groups` are group numbers as strings; `entry` is the entry file's text.
 * Returns `{ok, groups: [{group, wave, marked, logged}], sync, reprojected,
 * warnings, errors}`; `logged` is false for a group whose entry was already in
 * the log.
 */
export function groupDone({ plan, groups, entry }) {
  const verb = 'group-done';
  const read = readBoth(verb, plan);
  if (!read.ok) return read;
  let { planText, logText } = read;

  const sections = sectionsOf(planText);
  const unknown = groups.filter(group => !sections.has(group));
  if (unknown.length) return unknownGroups(verb, plan, unknown);

  const waves = new Map();
  for (const group of groups) {
    const started = lastStartNaming(logText, group);
    if (started === null) {
      return refuse(`${verb}-no-wave`, `no "Wave K Started:" heading in ${logOf(plan)} names Group ${group}, so its wave is unknown. `
        + 'Nothing was written. Run wave-start for the wave that dispatched it, then this call again.');
    }
    waves.set(group, started);
  }

  const bodies = entryBodies(entry, groups);
  if (!bodies.ok) return refuse(`${verb}-entry-invalid`, `${bodies.message} Nothing was written. Correct the entry file and run the call again.`);

  // The plan first: a checkbox is the record the dashboard counts, and marking
  // twice is marking once.
  const counts = new Map();
  let marked = planText;
  for (const group of groups) {
    const { start, end } = sectionsOf(marked).get(group);
    const section = marked.slice(start, end);
    counts.set(group, [...section.matchAll(OPEN_BOX)].length);
    marked = marked.slice(0, start) + section.replace(OPEN_BOX, '$1[x]') + marked.slice(end);
  }
  if (marked !== planText) {
    const written = replaceFile(plan, marked);
    if (!written.ok) {
      return refuse(`${verb}-plan-unwritable`, `${plan} could not be written (${written.message}). Nothing was written. `
        + 'Make the plan writable and run the call again.');
    }
    planText = marked;
  }

  const warnings = [];
  const sync = syncCompanion(plan, warnings);

  // Then the log: one entry per group not already logged under its wave.
  let appended = logText.replace(/\s*$/, '\n');
  const outcome = [];
  for (const group of groups) {
    const { wave } = waves.get(group);
    const logged = !alreadyLogged(logText, group, waves.get(group));
    if (logged) {
      const missed = sync.missing_groups?.includes(group) ? `\n\nHTML plan sync missed markers for Group ${group}.` : '';
      appended += `\n## ${stamp()} - Group ${group} Complete (wave ${wave})\n\n${bodies.of.get(group)}${missed}\n`;
    }
    outcome.push({ group: Number(group), wave, marked: counts.get(group), logged });
  }
  if (outcome.some(each => each.logged)) {
    const written = replaceFile(logOf(plan), appended);
    if (!written.ok) {
      return refuse(`${verb}-log-unwritable`, `${logOf(plan)} could not be written (${written.message}). `
        + `The plan's checkboxes for Group ${groups.join(', ')} are marked; the work-log entry was not written. `
        + 'Run the same call again: the marks are kept as they are and the entry is appended once.');
    }
  }

  const reprojected = reproject(plan, warnings, `Group ${groups.join(', ')}`);
  return { ok: true, groups: outcome, sync: syncSummary(sync), reprojected, warnings, errors: [] };
}

/**
 * Record a wave's start: one `Wave K Started:` heading naming its groups, then
 * re-project, so the groups read as running before the fan-out.
 *
 * A repeated call — the log's last start is this wave with these groups —
 * appends nothing. Returns `{ok, wave, groups, logged, reprojected, warnings,
 * errors}`.
 */
export function waveStart({ plan, wave, groups }) {
  const verb = 'wave-start';
  const read = readBoth(verb, plan);
  if (!read.ok) return read;
  const { planText, logText } = read;

  const sections = sectionsOf(planText);
  const unknown = groups.filter(group => !sections.has(group));
  if (unknown.length) return unknownGroups(verb, plan, unknown);
  const done = groups.filter(group => sections.get(group).done);
  if (done.length) {
    return refuse(`${verb}-group-done`, `the plan already marks Group ${done.join(', ')} done, so a wave cannot start it. Nothing was written. `
      + 'Start only the groups still to run; a group sent back runs again once its checkboxes are cleared.');
  }

  const last = [...logText.matchAll(WAVE_START)].at(-1);
  const same = last !== undefined && Number(last[1]) === wave
    && sameSet(numbersIn(last[2]), groups);
  if (!same) {
    const label = groups.length === 1 ? `Group ${groups[0]}` : `Groups ${groups.join(', ')}`;
    const written = replaceFile(logOf(plan), `${logText.replace(/\s*$/, '\n')}\n## ${stamp()} - Wave ${wave} Started: ${label}\n`);
    if (!written.ok) {
      return refuse(`${verb}-log-unwritable`, `${logOf(plan)} could not be written (${written.message}). Nothing was written. `
        + 'Make the work log writable and run the call again.');
    }
  }

  const warnings = [];
  const reprojected = reproject(plan, warnings, `wave ${wave} start`);
  return { ok: true, wave, groups: groups.map(Number), logged: !same, reprojected, warnings, errors: [] };
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

function logOf(plan) {
  return path.join(path.dirname(plan), WORK_LOG);
}

function readBoth(verb, plan) {
  let planText;
  try {
    planText = fs.readFileSync(plan, 'utf8');
  } catch (err) {
    return refuse(`${verb}-plan-unreadable`, `${plan} cannot be read (${err.message}). Nothing was written. `
      + 'Point --plan at the run\'s implementation/implementation-plan.md.');
  }
  let logText;
  try {
    logText = fs.readFileSync(logOf(plan), 'utf8');
  } catch (err) {
    return refuse(`${verb}-log-unreadable`, `${logOf(plan)} cannot be read (${err.message}). Nothing was written. `
      + 'Write the work log\'s opening entry first, beside the plan, then run the call again.');
  }
  return { ok: true, planText, logText };
}

/**
 * Each `### Task Group N:` section by its number: where it starts and ends, the
 * dashboard's boundary, and whether it is done — a checkbox in it and none empty.
 */
function sectionsOf(text) {
  const boundaries = [...text.matchAll(SECTION_HEADING)].map(match => match.index);
  const sections = new Map();
  for (const heading of text.matchAll(GROUP_HEADING)) {
    const end = boundaries.find(index => index > heading.index) ?? text.length;
    const marks = [...text.slice(heading.index, end).matchAll(CHECKBOX)].map(match => match[1]);
    sections.set(String(Number(heading[1])), {
      start: heading.index, end, done: marks.length > 0 && marks.every(mark => mark !== ' '),
    });
  }
  return sections;
}

/** The last `Wave K Started:` heading naming `group`, as `{wave, index}`, or null. */
function lastStartNaming(log, group) {
  const starts = [...log.matchAll(WAVE_START)].filter(match => numbersIn(match[2]).includes(group));
  const last = starts.at(-1);
  return last === undefined ? null : { wave: Number(last[1]), index: last.index };
}

/** Whether a `Group N Complete (wave K)` heading follows the wave's start. */
function alreadyLogged(log, group, { wave, index }) {
  const heading = new RegExp(`^##\\s.*\\bGroup ${group} Complete \\(wave\\s*${wave}\\b`, 'gim');
  return [...log.matchAll(heading)].some(match => match.index > index);
}

function numbersIn(text) {
  return (text.match(/\d+/g) ?? []).map(number => String(Number(number)));
}

function sameSet(a, b) {
  return a.length === b.length && a.every(item => b.includes(item));
}

/**
 * The entry file split into one body per group. One group may send its body
 * bare or under a `## Group N` opener; several send one opener each, naming
 * exactly the groups of the call. A body carries no `#` or `##` heading of its
 * own: those are the log's, and a stray one would read as a heading the
 * dashboard parses.
 */
function entryBodies(entry, groups) {
  const lines = String(entry ?? '').replace(/\r\n?/g, '\n').split('\n');
  const parts = [];
  let current = { group: null, lines: [] };
  for (const line of lines) {
    const opener = line.match(OPENER);
    if (opener) {
      parts.push(current);
      current = { group: String(Number(opener[1])), lines: [] };
      continue;
    }
    if (STRAY_HEADING.test(line)) {
      return { ok: false, message: `the entry carries the heading "${line.trim()}"; the verb writes each heading itself, so the entry holds only the body, with "## Group N" opening each group's part when there are several.` };
    }
    current.lines.push(line);
  }
  parts.push(current);
  const text = part => part.lines.join('\n').trim();
  const [lead, ...opened] = parts;
  if (opened.length === 0) {
    if (groups.length !== 1) return { ok: false, message: `the call names Group ${groups.join(', ')} and the entry opens no part with "## Group N"; give each group its own part.` };
    if (text(lead) === '') return { ok: false, message: 'the entry is empty.' };
    return { ok: true, of: new Map([[groups[0], text(lead)]]) };
  }
  if (text(lead) !== '') return { ok: false, message: 'the entry has text before its first "## Group N" line.' };
  const named = opened.map(part => part.group);
  if (new Set(named).size !== named.length || !sameSet(named, groups)) {
    return { ok: false, message: `the entry's parts name Group ${named.join(', ')} and the call names Group ${groups.join(', ')}; they must be the same groups, each once.` };
  }
  const empty = opened.filter(part => text(part) === '').map(part => part.group);
  if (empty.length) return { ok: false, message: `the part for Group ${empty.join(', ')} is empty.` };
  return { ok: true, of: new Map(opened.map(part => [part.group, text(part)])) };
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

function replaceFile(file, text) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // a temp twin that is not a file is left for the operator; the refusal names the file
    }
    return { ok: false, message: err.message };
  }
}

/** `sync-plan` over the whole plan; a failure is a warning, never a refusal. */
function syncCompanion(plan, warnings) {
  let sync;
  try {
    sync = syncPlan({ plan });
  } catch (err) {
    sync = { ok: false, errors: [{ message: err.message }] };
  }
  if (!sync.ok) {
    warnings.push(`plan-sync-failed: ${(sync.errors ?? []).map(error => error.message).join('; ')}; run sync-plan once the companion can be written`);
  } else if (sync.missing_groups.length) {
    warnings.push(`plan-sync-missed: the plan companion has no marker for Group ${sync.missing_groups.join(', ')}`);
  }
  return sync;
}

function syncSummary(sync) {
  if (!sync.ok) return { ok: false };
  return sync.skipped
    ? { ok: true, skipped: sync.skipped }
    : { ok: true, written: sync.written, missing_groups: sync.missing_groups };
}

/**
 * The run's displays re-projected through the state writer — the empty write
 * the executor used to send, so `dashboard-data.js`, the status line and
 * `orchestrator.updated` move exactly as they did. `"no-run"` for a plan with
 * no state file beside its folder, a standalone executor run; false, with a
 * warning, when the writer refused or its projection did not publish.
 */
function reproject(plan, warnings, after) {
  const state = path.join(path.dirname(plan), '..', STATE_FILE);
  if (!fs.existsSync(state)) return 'no-run';
  let result;
  try {
    result = writeState({ state, patch: {} });
  } catch (err) {
    result = { ok: false, errors: [{ code: 'state-unwritable', message: err.message }] };
  }
  if (!result.ok) {
    warnings.push(`reprojection-refused: ${result.errors.map(error => error.code).join(', ')} after ${after}; `
      + 'the plan and the work log are written, and the next state write draws the dashboard from them');
    // A visible miss in the log too, best effort: the warning line is the record.
    try {
      fs.appendFileSync(logOf(plan), `\nDashboard re-projection failed after ${after}.\n`);
    } catch {
      // the stderr warning stands alone
    }
    return false;
  }
  for (const warning of result.warnings ?? []) {
    warnings.push(`reprojection-incomplete: ${warning.file ?? 'dashboard-data.js'} was not written (${warning.code}: ${warning.message})`);
  }
  return true;
}

function unknownGroups(verb, plan, groups) {
  return refuse(`${verb}-unknown-group`, `${plan} has no "### Task Group N:" section for Group ${groups.join(', ')}. Nothing was written. `
    + 'Name the groups exactly as the plan numbers them.');
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
