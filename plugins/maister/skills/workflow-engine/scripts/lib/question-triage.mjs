/**
 * In-node questions classed under the run's autonomy ceiling: which questions a
 * workflow's prose declares, whether the policy classes them, what each comes
 * to, and the held items a person must still approve.
 *
 * Why this module exists. When the run's policy classes in-node questions, the
 * state writer — and only the writer — settles, defaults or holds each
 * question a node sends it, and the brief, the run's close and the dashboard
 * then read what it recorded. Those readers must agree on what a writer-classed
 * item is, which held items are still outstanding and what approves one, so the
 * rules live here once. `question-set.mjs` keeps what a valid set is; this
 * module only reads a set it has checked.
 *
 * Exports:
 *
 * - `HELD_APPROVAL` — the reserved checkpoint id a run asks before it finishes
 *   while held items are outstanding. Never a node of the frozen graph.
 * - `frozenIds(nodes)` — a run's recorded node ids less that reserved one.
 * - `inNodeQuestions(text)` — every `{node, id}` a companion prose file names
 *   on its bold question-set lines.
 * - `declaredQuestionIds(definitionFile, node)` — the ids one node's prose
 *   declares, read from the companion `.md` beside the definition; `[]` with
 *   no companion.
 * - `classesQuestions(policy, workflow)` — whether the policy classes in-node
 *   questions for the workflow at all.
 * - `classSet({...})` — every question of a checked set classed: the items to
 *   record, the ids still to ask, and the faults that refuse the write.
 * - `raiseTriage(computed, carried)` — the raise-only merge of a triage the
 *   question already carried with the one computed for it.
 * - `isClassedItem(item)`, `isHeld(item)`, `isApproval(item)` — the item
 *   shapes this module owns.
 * - `approvalKey(node, item)` — the key a held item and its approval share.
 * - `outstandingHeld(doc)`, `approvalsOf(doc)` — the held items with no
 *   approval yet, and every approval, in frozen node order.
 * - `REVISION_CEILING`, `REVISE_PREFIX` — the revise safety limit every gate
 *   shares, and the prefix of a revise option at `HELD_APPROVAL`.
 * - `heldRevisions(doc)`, `heldApprovalOptions(doc)` — how many revises
 *   `HELD_APPROVAL` has recorded, and the options it offers, revises left out
 *   once the safety limit is spent.
 * - `heldApprovalLabel(option, title)` — the words one of those options is
 *   shown and recorded by.
 * - `heldApprovalBlockers(doc, owed)`, `heldApprovalCurrent(doc, owed)`,
 *   `heldApprovalFolded(doc)` — when `HELD_APPROVAL` is askable, when it is
 *   the run's current checkpoint, and when a driven answer to it has been
 *   folded into the state. `owed` is what the run still owes at its close
 *   (`atClose` in `gate-brief.mjs`), passed in so this module stays pure.
 *
 * Pure apart from the one companion read in `declaredQuestionIds`: no stdio,
 * no writes, and nothing raised — faults are returned as data.
 */

import fs from 'node:fs';

import { CLASSES, questionOutcome, triageFor } from './policy.mjs';
import { attemptNumber, oneLine } from './items.mjs';

/** The reserved closing checkpoint's id. */
export const HELD_APPROVAL = 'held-approval';

/**
 * The ids of the frozen graph's nodes in `nodes` — a run's `workflow.nodes` —
 * in their recorded order: every key but the reserved `HELD_APPROVAL` status
 * entry a driven run may carry. Every reader that walks the frozen graph
 * walks these.
 */
export function frozenIds(nodes) {
  return isMap(nodes) ? Object.keys(nodes).filter(id => id !== HELD_APPROVAL) : [];
}

/** The keys a question's `reasons` entry may carry. */
const REASON_KEYS = ['rationale', 'assumption', 'reversal'];

/** Between the labels of a multi-select default, as a decision reads it. */
const LABEL_JOIN = ', ';

/** The class whose settled items also keep the node's assumption and reversal. */
const RECORD_CLASS = 'record';

/** The `by` values the writer records a classed item under. */
const CLASSED_BY = new Set(['run', 'default']);

/** The prefix of a revise option at `HELD_APPROVAL`, followed by the owning node's id. */
export const REVISE_PREFIX = 'revise-';

/**
 * How many times one gate may send the run back: a safety ceiling against a
 * runaway loop, not a budget on the user. A revise a person chooses is their
 * call however often they make it, so the ceiling sits well past any revise
 * loop a person runs on purpose. The engine's own constant, not a grammar key;
 * kept in this leaf module so every reader imports it without a cycle.
 */
export const REVISION_CEILING = 10;

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isLine = value => typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value);

// ---------------------------------------------------------------------------
// Declared question ids
// ---------------------------------------------------------------------------

/** A node's heading in the prose: `## \`node-id\``. */
const NODE_HEADING = /^## `([a-z0-9-]+)`\s*$/;

/** A question-set line, its parenthesis optional: `**With question sets** (the studio's \`id\`):`. */
const QUESTION_LINE = /\*\*(With|Without) question sets\*\*(?:\s*\(([^)]*)\))?/;

/** The backticked id inside a question-set line's parenthesis, any qualifier before it. */
const QUESTION_ID = /`([a-z0-9-]+)`/;

/**
 * Every `{node, id}` a node-prose file names on its With/Without question-set
 * lines, in file order, each pair counted once. A line with no parenthesis — the
 * file's preamble, or a `With` line whose `Without` partner carries the id —
 * names no question.
 */
export function inNodeQuestions(text) {
  const found = [];
  const seen = new Set();
  let node = null;
  for (const line of text.split('\n')) {
    const heading = NODE_HEADING.exec(line);
    if (heading) {
      node = heading[1];
      continue;
    }
    const match = QUESTION_LINE.exec(line);
    if (!match || match[2] === undefined) continue;
    const id = QUESTION_ID.exec(match[2])?.[1];
    if (!id || node === null) continue;
    const key = `${node}\0${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ node, id });
  }
  return found;
}

/**
 * The question ids the prose companion beside `definitionFile` declares for
 * `node`, in file order. The companion is the definition's path with `.md` for
 * `.yml`/`.yaml`, the same file the engine reads a workflow's description
 * from. No companion — or no definition path — declares nothing, and every
 * question then reads as its own id.
 */
export function declaredQuestionIds(definitionFile, node) {
  if (typeof definitionFile !== 'string' || definitionFile === '') return [];
  let text;
  try {
    text = fs.readFileSync(definitionFile.replace(/\.ya?ml$/i, '.md'), 'utf8');
  } catch {
    return [];
  }
  return inNodeQuestions(text).filter(each => each.node === node).map(each => each.id);
}

// ---------------------------------------------------------------------------
// Classing
// ---------------------------------------------------------------------------

/**
 * Whether `policy` classes in-node questions for `workflow`: it names an
 * `unknown_family`, which every unlisted question reads as, or a `table` row
 * of `kind: question` for the workflow. The freeze records the answer.
 */
export function classesQuestions(policy, workflow) {
  if (!isMap(policy)) return false;
  if (typeof policy.unknown_family === 'string' && policy.unknown_family !== '') return true;
  return (Array.isArray(policy.table) ? policy.table : [])
    .some(row => isMap(row) && row.kind === 'question' && row.workflow === workflow);
}

/**
 * The raise-only merge of the triage computed for a question with one it
 * already carried: the higher class wins, a tie keeps the computed one, and
 * `floor` is the union of both. A carried triage of another version is
 * ignored; with no computed triage, a carried version-1 one stands. A carried
 * triage only ever raises, so it can hold or ask more, never settle more.
 * Neither side is changed.
 */
export function raiseTriage(computed, carried) {
  const own = isMap(computed) ? computed : null;
  const kept = isMap(carried) && carried.version === 1 ? carried : null;
  if (kept === null) return own === null ? null : { ...own };
  if (own === null) return { ...kept };
  const winner = CLASSES.indexOf(kept.class) > CLASSES.indexOf(own.class) ? kept : own;
  const floor = [...new Set([...floorOf(own), ...floorOf(kept)])];
  const merged = { ...winner };
  if (floor.length > 0) merged.floor = floor;
  return merged;
}

function floorOf(triage) {
  return Array.isArray(triage.floor) ? triage.floor.filter(each => typeof each === 'string' && each !== '') : [];
}

/**
 * Class every question of a set `checkSet` accepted. Takes the set's
 * `questions`, the node's `reasons` as sent, the applied `policy`, the run's
 * `workflow` name, the node's `declaredIds`, the autonomy ceiling's `settles`,
 * whether a person can be asked (`canAsk`) and the node's `attempt`.
 *
 * Returns `{items, asking, faults}`: the decision items to record, in set
 * order; the ids still to ask (asked or unclassed), in set order; and every
 * reason the write is refused — a `reasons` entry naming no question of the
 * set or carrying another key, or a classed question with no default. When
 * `faults` is non-empty nothing is to be recorded.
 *
 * The caller decides whether to class at all (the run records that its policy
 * classes questions, and the policy hash matches): this function always does.
 */
export function classSet({ questions, reasons, policy, workflow, declaredIds, settles, canAsk, attempt } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const faults = reasonFaults(reasons, new Set(list.map(question => question.id)));
  const sent = isMap(reasons) ? reasons : {};
  const items = [];
  const asking = [];
  const round = Number(attempt);
  for (const question of list) {
    const computed = triageFor({ policy, workflow, kind: 'question', id: question.id, declaredIds });
    const triage = raiseTriage(computed, question.triage);
    const { outcome, triage: recorded } = questionOutcome({ triage, settles, canAsk });
    if (triage !== null && defaultOf(question) === null) {
      faults.push(`question "${question.id}" is classed, so it needs a default: mark one option recommended or name its "default"`);
      continue;
    }
    if (outcome === 'ask' || outcome === 'unclassed') {
      asking.push(question.id);
      continue;
    }
    const chosen = defaultOf(question);
    const why = isMap(sent[question.id]) ? sent[question.id] : {};
    const item = {
      decision: chosen.map(option => option.label).join(LABEL_JOIN),
      by: outcome === 'settle' ? 'run' : 'default',
      question_id: question.id,
      question: oneLine(question.question),
    };
    if (outcome === 'settle') {
      const rationale = why.rationale ?? chosen[0].description;
      if (typeof rationale === 'string' && rationale !== '') item.rationale = oneLine(rationale);
      if (recorded.class === RECORD_CLASS) {
        if (typeof why.assumption === 'string') item.assumption = why.assumption;
        if (typeof why.reversal === 'string') item.reversal = why.reversal;
      }
    } else if (outcome === 'hold' && typeof why.rationale === 'string') {
      item.rationale = why.rationale;
    }
    item.triage = recorded;
    if (Number.isInteger(round) && round > 1) item.attempt = round;
    items.push(item);
  }
  return faults.length ? { items: [], asking: [], faults } : { items, asking, faults };
}

/** The options a question defaults to, in option order, or null when it names none. */
function defaultOf(question) {
  const named = Array.isArray(question.default) ? question.default : question.default === undefined ? [] : [question.default];
  const options = (Array.isArray(question.options) ? question.options : []).filter(option => named.includes(option.id));
  return options.length ? options : null;
}

/** Why the node's `reasons` cannot be taken: ids outside the set, other keys, values that are not one line. */
function reasonFaults(reasons, ids) {
  if (reasons === undefined || reasons === null) return [];
  if (!isMap(reasons)) return ['"reasons" must map a question id to {rationale?, assumption?, reversal?}'];
  const faults = [];
  for (const [id, entry] of Object.entries(reasons)) {
    if (!ids.has(id)) {
      faults.push(`"reasons" names "${id}", which is no question of the set`);
      continue;
    }
    if (!isMap(entry)) {
      faults.push(`"reasons.${id}" must be an object of ${REASON_KEYS.join(', ')}`);
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (!REASON_KEYS.includes(key)) faults.push(`"reasons.${id}": the key "${key}" is not one of ${REASON_KEYS.join(', ')}`);
      else if (!isLine(value)) faults.push(`"reasons.${id}.${key}" must be one line of text`);
    }
  }
  return faults;
}

// ---------------------------------------------------------------------------
// Held items and their approvals
// ---------------------------------------------------------------------------

/**
 * A decision the writer classed: recorded `by: run` or `by: default`, with a
 * `triage` and the `question_id` it answers.
 */
export function isClassedItem(item) {
  return isMap(item) && CLASSED_BY.has(item.by) && isMap(item.triage)
    && typeof item.question_id === 'string' && item.question_id !== '';
}

/** A held item: a classed item whose triage is `held`. */
export function isHeld(item) {
  return isClassedItem(item) && item.triage.held === true;
}

/**
 * An approval item: recorded `by: operator` at a checkpoint's continue, naming
 * the owning `node` and the `question_id` of the held item it approves.
 */
export function isApproval(item) {
  return isMap(item) && item.by === 'operator'
    && typeof item.node === 'string' && item.node !== ''
    && typeof item.question_id === 'string' && item.question_id !== '';
}

/**
 * The run's summaries in frozen node order: the frozen nodes first (the
 * reserved `HELD_APPROVAL` entry skipped), then any other summary — the
 * reserved one among them — in recorded order.
 */
function summariesInOrder(doc) {
  const summaries = isMap(doc?.node_summaries) ? doc.node_summaries : {};
  const frozen = frozenIds(doc?.workflow?.nodes);
  const order = [...frozen, ...Object.keys(summaries).filter(id => !frozen.includes(id))];
  return order
    .filter(id => isMap(summaries[id]) && Array.isArray(summaries[id].decisions))
    .map(id => [id, summaries[id].decisions]);
}

/**
 * The key a held item and its approval share: the owning `node`, the item's
 * question id and its attempt (1 when absent). Every reader that matches an
 * approval to a held item matches on this.
 */
export function approvalKey(node, item) {
  return JSON.stringify([node, item.question_id, attemptNumber(item) ?? 1]);
}

/**
 * Every approval item in the run, in frozen node order of the summary that
 * records it: `{node, question_id, attempt, item, on}` — `node` the owning
 * node it names, `on` the checkpoint whose summary holds it.
 */
export function approvalsOf(doc) {
  return summariesInOrder(doc).flatMap(([on, decisions]) => decisions.filter(isApproval)
    .map(item => ({ node: item.node, question_id: item.question_id, attempt: attemptNumber(item) ?? 1, item, on })));
}

/**
 * Every held item no approval matches, in frozen node order:
 * `{node, question_id, attempt, item}`. A held item is approved by an approval
 * item with the same node, question id and attempt (1 when absent), wherever
 * in the run it is recorded. Only a run whose freeze recorded
 * `orchestrator.classes_questions: true` holds anything: elsewhere a held
 * triage was written by hand, never by the writer, and nothing waits on it.
 */
export function outstandingHeld(doc) {
  if (doc?.orchestrator?.classes_questions !== true) return [];
  const approved = new Set(approvalsOf(doc).map(each => approvalKey(each.node, each.item)));
  return summariesInOrder(doc).flatMap(([node, decisions]) => decisions
    .filter(item => isHeld(item) && !approved.has(approvalKey(node, item)))
    .map(item => ({ node, question_id: item.question_id, attempt: attemptNumber(item) ?? 1, item })));
}

/**
 * How many revise answers `node_summaries.held-approval` records: every
 * decision naming a `revise-<node>` option, a folded one not yet applied
 * included.
 */
export function heldRevisions(doc) {
  const own = doc?.node_summaries?.[HELD_APPROVAL];
  const answers = isMap(own) && Array.isArray(own.decisions) ? own.decisions : [];
  return answers.filter(item => isMap(item) && typeof item.option === 'string' && item.option.startsWith(REVISE_PREFIX)).length;
}

/**
 * The options `HELD_APPROVAL` offers: `continue` (recommended), a
 * `revise-<node>` for each node owning an outstanding held item in frozen
 * order, then `stop`. `revision` is the revise items already recorded
 * (`heldRevisions`) plus one; past `REVISION_CEILING` the revises are `spent`
 * and only continue and stop are offered. Returns `{revision, spent, options,
 * revises}`, each option `{id, effect, reruns?, recommended?}`; `revises` is
 * every revise option the held items call for, spent or not.
 */
export function heldApprovalOptions(doc) {
  const revision = heldRevisions(doc) + 1;
  const spent = revision > REVISION_CEILING;
  const owners = [...new Set(outstandingHeld(doc).map(each => each.node))];
  const revises = owners.map(node => ({ id: `${REVISE_PREFIX}${node}`, effect: 'revise', reruns: node }));
  return {
    revision,
    spent,
    options: [
      { id: 'continue', effect: 'continue', recommended: true },
      ...(spent ? [] : revises),
      { id: 'stop', effect: 'stop' },
    ],
    revises,
  };
}

/** The words `HELD_APPROVAL`'s continue and stop are shown and recorded by. */
const HELD_LABELS = { continue: 'Approve and finish', stop: 'Stop' };

/**
 * The label of one of `HELD_APPROVAL`'s options: "Approve and finish", "Stop",
 * or "Revise <step>" for a `revise-<node>`, the step named by `title(node)`.
 * Any other option reads as its id.
 */
export function heldApprovalLabel(option, title = id => id) {
  if (Object.hasOwn(HELD_LABELS, option)) return HELD_LABELS[option];
  if (typeof option === 'string' && option.startsWith(REVISE_PREFIX)) return `Revise ${title(option.slice(REVISE_PREFIX.length))}`;
  return String(option);
}

/**
 * The owed nodes that keep `HELD_APPROVAL` from being asked, by id in the order
 * given: every entry of `owed` but a `running` node no frozen node needs — the
 * closing node, while it runs. Empty when it is askable.
 */
export function heldApprovalBlockers(doc, owed) {
  const nodes = isMap(doc?.workflow?.nodes) ? doc.workflow.nodes : {};
  const needed = new Set(Object.entries(nodes)
    .filter(([id, entry]) => id !== HELD_APPROVAL && isMap(entry) && Array.isArray(entry.needs))
    .flatMap(([, entry]) => entry.needs.map(String)));
  return (Array.isArray(owed) ? owed : [])
    .filter(each => !(each.status === 'running' && !needed.has(each.id)))
    .map(each => each.id);
}

/**
 * Whether `HELD_APPROVAL` is the run's current checkpoint: no other gate is
 * pending on a driver (`gate_pending` null, or naming it), it is askable
 * (`heldApprovalBlockers`), and held items are outstanding — so no continue
 * has approved them since they were recorded.
 */
export function heldApprovalCurrent(doc, owed) {
  const pending = doc?.orchestrator?.gate_pending;
  const free = pending === null || pending === undefined || (isMap(pending) && pending.node === HELD_APPROVAL);
  return free && heldApprovalBlockers(doc, owed).length === 0 && outstandingHeld(doc).length > 0;
}

/**
 * Whether a driven answer to `HELD_APPROVAL` has been folded into the state:
 * the latest decision under `node_summaries.held-approval` names an option and
 * carries no `attempt` — a revise the reset has applied carries one. Read off
 * the summary, never a node status.
 */
export function heldApprovalFolded(doc) {
  const own = doc?.node_summaries?.[HELD_APPROVAL];
  const answers = isMap(own) && Array.isArray(own.decisions) ? own.decisions.filter(item => isMap(item) && typeof item.option === 'string') : [];
  const latest = answers.at(-1);
  return latest !== undefined && !Object.hasOwn(latest, 'attempt');
}
