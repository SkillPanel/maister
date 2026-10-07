/**
 * The plan companion's progress markers, set from the markdown plan.
 *
 * `implementation-plan.html` is the one HTML companion whose content changes
 * after it is written: the planner renders every task group and step with a
 * `todo` marker (`<section data-group="2" class="group todo">`,
 * `<li data-step="2.3" class="step todo">`) and the markers must follow the
 * checkboxes in `implementation-plan.md` as the executor ticks them. That used
 * to be a `sed -i ''` the model ran per group — BSD syntax that fails on GNU
 * sed, on Windows there is no sed at all, and the prose asked the model to
 * detect the platform on every wave. This module is the same edit as a
 * projection: read the plan, set every marker it names to what the plan says.
 *
 * **A projection, not a flip.** Each marker is *set* to the plan's state rather
 * than moved from `todo` to `done`, so a group the executor reverts (its
 * checkboxes cleared) reads as outstanding again, and running the sync twice is
 * the same as running it once. The file is written only when a byte changes.
 *
 * **Exact anchoring.** A marker is found by its full quoted attribute value, so
 * group `1` never matches `data-group="11"` and step `1.1` never matches
 * `data-step="1.10"`. Other classes beside the marker are kept as they are.
 *
 * **Never a blocker.** No companion, or a run whose `html_output` is off, is a
 * no-op that says so. A plan id with no marker in the companion is reported,
 * not refused — an older or partly generated companion is a warning for the
 * caller to log, never a reason to stop a wave. A group's own `N.0` checkbox
 * is the one exception: the companion marks the group with `data-group="N"`,
 * so an `N.0` with no step marker of its own is not missing.
 *
 * Refusal codes: `plan-unreadable`, `companion-unreadable`,
 * `companion-unwritable`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
// The group rule is the dashboard's: a `### Task Group N:` section is done when
// it holds a checkbox and none of them is the empty one.
import { CHECKBOX, GROUP_HEADING, SECTION_HEADING } from './dashboard.mjs';
import { isPlainObject, parse as parseState } from './state-read.mjs';

/** The companion's name beside the plan — the planner's fixed artifact name. */
const COMPANION = 'implementation-plan.html';

/** The state file one level above `implementation/`, when the plan belongs to a run. */
const STATE_FILE = 'orchestrator-state.yml';

/** A step checkbox with its `N.M` label: the mark and the label are both captured. */
const STEP = new RegExp(`${CHECKBOX.source}\\s*(\\d+\\.\\d+)\\b`, 'gm');

/** A group's own checkbox, `N.0`, which the planner writes above the group's steps. */
const GROUP_CHECKBOX = /^\d+\.0$/;

/**
 * Set every marker in the plan's companion to the plan's checkbox state.
 *
 * Returns `{ok, companion, skipped?, written, groups_done, groups_todo,
 * missing_groups, missing_steps, errors}`.
 */
export function syncPlan({ plan }) {
  let planText;
  try {
    planText = fs.readFileSync(plan, 'utf8').replace(/\r\n?/g, '\n');
  } catch (err) {
    return refuse('plan-unreadable', `${plan} cannot be read: ${err.message}`);
  }

  const companion = path.join(path.dirname(plan), COMPANION);
  if (htmlOutputOff(path.join(path.dirname(plan), '..', STATE_FILE))) {
    return noop(companion, 'html-output-off');
  }
  if (!fs.existsSync(companion)) return noop(companion, 'no-companion');

  let html;
  try {
    html = fs.readFileSync(companion, 'utf8');
  } catch (err) {
    return refuse('companion-unreadable', `${companion} cannot be read: ${err.message}`);
  }

  const { groups, steps } = readPlan(planText);
  let next = html;
  const missingGroups = [];
  const missingSteps = [];
  for (const [id, done] of groups) {
    const set = setMarker(next, 'group', id, done);
    if (set === null) missingGroups.push(id);
    else next = set;
  }
  for (const [id, done] of steps) {
    const set = setMarker(next, 'step', id, done);
    if (set !== null) next = set;
    else if (!GROUP_CHECKBOX.test(id)) missingSteps.push(id);
  }

  const written = next !== html;
  if (written) {
    const tmp = `${companion}.tmp`;
    try {
      fs.writeFileSync(tmp, next, 'utf8');
      fs.renameSync(tmp, companion);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      return refuse('companion-unwritable', `${companion} could not be written: ${err.message}`);
    }
  }

  return {
    ok: true,
    companion,
    written,
    groups_done: [...groups].filter(([, done]) => done).map(([id]) => id),
    groups_todo: [...groups].filter(([, done]) => !done).map(([id]) => id),
    missing_groups: missingGroups,
    missing_steps: missingSteps,
    errors: [],
  };
}

/**
 * Each group's and each step's done-ness, in document order.
 *
 * A group section runs from its heading to the next `### ` heading, the same
 * boundary the dashboard's progress count uses. A step is done when its mark is
 * not the empty one — `[x]` and a justified `[~]` skip both settle it.
 */
function readPlan(text) {
  const boundaries = [...text.matchAll(SECTION_HEADING)].map(match => match.index);
  const groups = new Map();
  for (const heading of text.matchAll(GROUP_HEADING)) {
    const end = boundaries.find(index => index > heading.index) ?? text.length;
    const marks = [...text.slice(heading.index, end).matchAll(CHECKBOX)].map(match => match[1]);
    if (marks.length > 0) groups.set(heading[1], marks.every(mark => mark !== ' '));
  }
  const steps = new Map();
  for (const step of text.matchAll(STEP)) steps.set(step[2], step[1] !== ' ');
  return { groups, steps };
}

/**
 * The companion with one marker set, or `null` when the marker is not there.
 *
 * A marker is the tag that carries the id's attribute: its `class` list holds
 * `todo` or `done`, which is the one token set. The list may carry other
 * classes in any order, and the attribute may stand on either side of it — a
 * planner that styled its groups `class="group todo card"` left every group
 * unmatched while the steps synced. The id is escaped and closed by its quote,
 * which is what keeps `1` from matching `11`. Every occurrence is set, so a
 * companion that repeats a marker cannot be left half-synced.
 */
function setMarker(html, kind, id, done) {
  const attribute = kind === 'group' ? 'data-group' : 'data-step';
  const tag = new RegExp(`<[^<>]*\\s${attribute}="${id.replace(/\./g, '\\.')}"[^<>]*>`, 'g');
  let found = false;
  const updated = html.replace(tag, element => element.replace(/(\sclass=")([^"]*)(")/, (whole, open, list, close) => {
    const classes = list.split(/\s+/);
    const at = classes.findIndex(name => name === 'todo' || name === 'done');
    if (at === -1) return whole;
    found = true;
    classes[at] = done ? 'done' : 'todo';
    return `${open}${classes.join(' ')}${close}`;
  }));
  return found ? updated : null;
}

/**
 * Whether the run this plan belongs to has switched HTML companions off.
 *
 * Only an explicit `false` counts. No state file (a standalone executor run) or
 * one this reader cannot parse is not a reason to skip: the companion's own
 * presence is the other half of the gate, and a sync that silently stopped over
 * an unrelated parse problem is the stale companion this module exists to end.
 */
function htmlOutputOff(stateFile) {
  let doc;
  try {
    doc = parseState(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return false;
  }
  const options = isPlainObject(doc?.orchestrator) ? doc.orchestrator.options : null;
  return isPlainObject(options) && options.html_output === false;
}

function noop(companion, reason) {
  return {
    ok: true, companion, skipped: reason, written: false,
    groups_done: [], groups_todo: [], missing_groups: [], missing_steps: [], errors: [],
  };
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }] };
}
