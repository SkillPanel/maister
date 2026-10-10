/**
 * A gate's revise option, carried out: the one write that sends a run back.
 *
 * Why a verb rather than a patch the model composes. A revise resets every node
 * between the option's `reruns` node and the gate, and which nodes those are is
 * a fact of the graph — the same kind of fact the gate brief's `Next:` line is,
 * and for the same reason the model is not asked to derive it by hand. The
 * ceiling is another: the engine counts revisions, so the engine refuses the one
 * past it. And the write must be whole — every node of the stretch pending, its
 * clocks and values gone, each attempt counted and the operator's note recorded
 * on the gate — because a run caught halfway through a hand-built reset has a
 * stretch that is partly re-run and partly not, with nothing saying which.
 *
 * What it reads. The state file alone. The edges are the frozen node lines'
 * `needs`, and where each revise option sends the run is the gate line's
 * `reruns`, which the freeze recorded — so a revise works on a run whose
 * definition has changed since it started, which is when an operator most
 * wants one. The definition is never re-read.
 *
 * What it writes. One `write-state` transaction through the writer's own
 * reset: every node of the stretch `pending`, its `started`, `completed` and
 * `values` removed, its `attempt` one higher; the gate's decision — the option,
 * who answered and when, the attempt it was taken at, its target and the note —
 * appended to the gate's summary; and `orchestrator.completed_phases` without
 * the phases the stretch owned. The dashboard is re-projected by that write.
 * Nothing downstream of the gate is touched, and nothing beside the stretch.
 *
 * The reserved closing checkpoint `held-approval` is revised by its own rule
 * (`heldApprovalRevise`): it is no node of the frozen graph, so its stretch is
 * the owning node and everything downstream of it, and its revisions are
 * counted off its summary.
 *
 * The refusals, each leaving the file exactly as it was: `revise-not-a-gate`,
 * `revise-option-unknown`, `revise-note-missing`, `revise-gate-not-current`,
 * `revise-budget-exhausted` and `revise-stretch-has-subrun`, plus `state-unreadable`
 * and any refusal of the writer itself, passed through.
 *
 * Pure but for the one write: no stdio. Returns what `writeState` returns, and
 * `revision` beside it on success. Zero dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { answerVia, attemptOf, isContextBlock, operatorName, writeState } from './state.mjs';
import { downstreamOf, reviseStretch } from './graph.mjs';
import { atClose, heldApprovalBefore } from './gate-brief.mjs';
import {
  HELD_APPROVAL, REVISE_PREFIX, REVISION_CEILING, frozenIds, heldApprovalBlockers, heldApprovalCurrent, heldApprovalFolded, heldApprovalOptions, heldRevisions,
} from './question-triage.mjs';
import { gateAnswer, isPlaceholderName, provenanceOf, withPersonActor, withProvenance } from './items.mjs';
import * as canonical from '../../../../lib/canonical.mjs';

/** The revise safety limit every gate shares, kept in `question-triage.mjs`. */
export { REVISION_CEILING };

/** Statuses a gate's needs may hold for the gate to be the run's current question. */
const SETTLED = new Set(['completed', 'skipped']);

/** Statuses of a gate still waiting for its answer, in the one turn it is asked. */
const ASKING = new Set(['pending', 'running']);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Send the run whose state file is `state` back from the gate `node` by its
 * revise option `option`. `input` is the patch file's document: `{note,
 * answered_by?, at?, via?}` — `at` the answer's stamp when a driver carried one,
 * the writer's own clock otherwise; `via` how the answer reached the run, when
 * the caller knows it — and any provenance the answer carried
 * (`PROVENANCE_KEYS`), recorded on the decision.
 */
export function gateRevise({ state, node, option, input }) {
  if (node === HELD_APPROVAL) return heldApprovalRevise({ state, option, input });
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }
  const recorded = isPlainObject(doc.workflow) && isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  const entry = id => (Object.hasOwn(recorded, id) && isPlainObject(recorded[id]) ? recorded[id] : {});

  const gate = entry(node);
  if (gate.kind !== 'gate') {
    return refuse('revise-not-a-gate',
      `--node=${node} names ${Object.hasOwn(recorded, node) ? `a node this run recorded as ${JSON.stringify(gate.kind ?? null)}` : 'no node of this run'}, `
      + 'not a gate. Nothing was written. Name the gate whose revise option the operator chose');
  }
  const targets = isPlainObject(gate.reruns) ? gate.reruns : {};
  if (!Object.hasOwn(targets, option) || typeof targets[option] !== 'string') {
    const offered = Object.keys(targets);
    return refuse('revise-option-unknown',
      `the gate ${node} has no revise option ${JSON.stringify(option)}; `
      + (offered.length ? `its revise options are ${offered.join(', ')}` : 'it offers no revise option')
      + '. Nothing was written. A continue or a stop is recorded as an ordinary answer, never through gate-revise');
  }
  const reruns = targets[option];

  const { answer, note, refusal } = noteOf(input);
  if (refusal) return refusal;

  const decisions = decisionsOf(doc, node);
  const latest = gateAnswer(decisions);
  // The driven fold records the answer as any answer is recorded — the gate
  // completed, the option on its summary — before the shell is open again; this
  // is the write that follows it. Recognised by the gate's answer naming the
  // option with no attempt yet.
  const folded = gate.status === 'completed' && isPlainObject(latest) && latest.option === option
    && !Object.hasOwn(latest, 'attempt');
  const why = notCurrent(doc, recorded, entry, node, gate, folded);
  if (why) {
    return refuse('revise-gate-not-current',
      `the gate ${node} is not the question this run is asking: ${why}. Nothing was written. A revise answers the gate `
      + 'the run is at; ask that gate, or resume the run, and use its revise option there');
  }

  const attempt = attemptOf(gate);
  if (attempt > REVISION_CEILING) {
    return refuse('revise-budget-exhausted',
      `the gate ${node} has been revised ${REVISION_CEILING} times, its safety ceiling: no revises are left at this checkpoint. `
      + 'Nothing was written. Ask the gate again with its continue and stop options only — the gate brief no longer offers the revise');
  }

  const ids = Object.keys(recorded);
  const needsOf = id => (Array.isArray(entry(id).needs) ? entry(id).needs.map(String) : []);
  const stretch = reviseStretch({ ids, needsOf, reruns, gate: node });
  const subrun = stretch.find(id => entry(id).kind === 'workflow');
  if (subrun) {
    return refuse('revise-stretch-has-subrun',
      `the stretch from ${reruns} to ${node} holds the sub-run ${subrun}, and a revise cannot re-run one: its child run `
      + 'is finished and would be adopted again. Nothing was written. Ask the gate again and continue or stop');
  }

  const decision = decisionOf({ doc, state, answer, folded, latest, option, attempt, reruns, note });
  const summary = summaryOf(doc, node);
  delete summary.status;
  // The revise decision takes the folded answer's place; anything recorded
  // after that answer stays.
  summary.decisions = [...(folded ? decisions.filter(item => item !== latest) : decisions), decision];

  const patch = {
    nodes: Object.fromEntries(stretch.map(id => [id, { status: 'pending' }])),
    node_summaries: { [node]: summary },
  };
  const phases = trimmedPhases(doc, stretch);
  if (phases) patch.orchestrator = { completed_phases: phases };

  const result = writeState({ state, patch, regress: new Set(stretch) });
  if (!result.ok) return result;
  return { ...result, revision: { gate: node, option, reruns, revision: attempt, ceiling: REVISION_CEILING, reset: stretch } };
}

/**
 * Why `gate` is not the run's current question, or null when it is. It is
 * current when everything it waits on has ended well and it has not been
 * answered — or it has, by the driven fold, with exactly this revise option,
 * which this write completes. A pending marker anywhere means the run is
 * waiting on a driver's answer, and the answer arrives through the resume.
 */
function notCurrent(doc, recorded, entry, node, gate, folded) {
  const pending = isPlainObject(doc.orchestrator) ? doc.orchestrator.gate_pending : null;
  if (isPlainObject(pending)) return `a driver's answer is still awaited at ${pending.node ?? 'a gate'}`;
  const unsettled = (Array.isArray(gate.needs) ? gate.needs.map(String) : [])
    .filter(need => !SETTLED.has(String(entry(need).status ?? 'pending')));
  if (unsettled.length) return `it still waits on ${unsettled.join(', ')}`;
  const status = String(gate.status ?? 'pending');
  if (ASKING.has(status) || folded) return null;
  return `it is recorded ${status}`;
}

/** The gate's recorded decisions, in order. */
function decisionsOf(doc, node) {
  const summary = summaryOf(doc, node);
  return Array.isArray(summary.decisions) ? summary.decisions : [];
}

/** A copy of the gate's `node_summaries` entry, or an empty one. */
function summaryOf(doc, node) {
  const map = isPlainObject(doc.node_summaries) ? doc.node_summaries : {};
  return Object.hasOwn(map, node) && isPlainObject(map[node]) ? JSON.parse(JSON.stringify(map[node])) : {};
}

/**
 * `orchestrator.completed_phases` without the phases the stretch owned — a node
 * id of the stretch, or a context block's phase key whose entry names one —
 * or null when the list does not change, so an unchanged list is not rewritten.
 */
function trimmedPhases(doc, stretch) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  const listed = Array.isArray(orchestrator.completed_phases) ? orchestrator.completed_phases : [];
  if (!listed.length) return null;
  const owned = new Set(stretch);
  for (const key of Object.keys(doc)) {
    if (!isContextBlock(key) || !isPlainObject(doc[key]) || !isPlainObject(doc[key].phase_summaries)) continue;
    for (const [phase, value] of Object.entries(doc[key].phase_summaries)) {
      if (isPlainObject(value) && owned.has(value.node)) owned.add(phase);
    }
  }
  const kept = listed.filter(phase => !owned.has(phase));
  return kept.length === listed.length ? null : kept;
}

/**
 * The patch file's answer and its note, flattened to one line, or the
 * `revise-note-missing` refusal when the note is missing or `at` is no stamp.
 */
function noteOf(input) {
  const answer = isPlainObject(input) ? input : {};
  const note = typeof answer.note === 'string' ? answer.note.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  if (note === '') {
    return { refusal: refuse('revise-note-missing',
      'the patch file carries no note. Nothing was written. Send {"note": "<what should change>"} — the suggestions the '
      + 'operator chose, and anything they typed — because the re-run node reads the note to know what to change') };
  }
  if (answer.at !== undefined && (typeof answer.at !== 'string' || !TIMESTAMP.test(answer.at))) {
    return { refusal: refuse('revise-note-missing',
      `at is ${JSON.stringify(answer.at)}, which is not a UTC timestamp. Nothing was written. Send the answer's own `
      + 'stamp as YYYY-MM-DDTHH:MM:SSZ, or leave at out and the writer stamps the decision itself') };
  }
  return { answer, note };
}

/**
 * The revise decision recorded on the checkpoint. Who answered: the name the
 * answer carried, the one the driven fold recorded, or — an answer given in
 * session — the operator's own, stamped the way the writer stamps every answer
 * that arrives without one. How it reached the run: the via the caller sent or
 * the fold recorded, else, for an answer given in session, the writer's own
 * default — the driver's kind under a cockpit or a dispatch, `terminal`
 * otherwise. Provenance: each key the patch file carries, else the folded
 * answer's; `grants` is never copied. An answer given at this terminal is then
 * credited to the person who gave it, as the writer credits every one.
 */
function decisionOf({ doc, state, answer, folded, latest, option, attempt, reruns, note }) {
  const named = value => !isPlaceholderName(value);
  const carried = named(answer.answered_by) ? answer.answered_by
    : (folded && named(latest.answered_by) ? latest.answered_by : null);
  const sent = typeof answer.via === 'string' && answer.via.trim() !== '' ? answer.via.trim()
    : (folded && typeof latest.via === 'string' ? latest.via : null);
  const via = sent ?? (carried === null ? answerVia(doc) : null);
  const provenance = withProvenance(provenanceOf(answer), folded ? latest : null);
  return withPersonActor({
    option,
    answered_by: carried ?? operatorName(path.dirname(state)),
    ...(via === null ? {} : { via }),
    at: answer.at ?? (folded && typeof latest.at === 'string' ? latest.at : canonical.stamp()),
    attempt,
    reruns,
    note,
    ...provenance,
  });
}

/**
 * The revise at the reserved closing checkpoint `HELD_APPROVAL`, by its own
 * rule rather than a frozen gate's: the checkpoint is no node of the frozen
 * graph, so it has no `reruns`, `needs` or attempt to read.
 *
 * - Option: `revise-<node>`, for a node owning an outstanding held choice.
 * - Stretch: that node and every frozen node whose needs closure reaches it,
 *   in frozen order — the closing node among them — reset in one write. A
 *   recorded `held-approval` status goes back to `pending`, and a run already
 *   recorded `completed` back to `in_progress`.
 * - Revision: the revise items already on its summary, plus one, against
 *   `REVISION_CEILING`.
 * - Current: no other driver's answer awaited, nothing but the running closing
 *   node owed, and held choices outstanding — or the driven fold of exactly
 *   this option, which this write completes.
 *
 * The same refusals as a frozen gate's revise, each leaving the file as it was.
 */
function heldApprovalRevise({ state, option, input }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }
  const recorded = isPlainObject(doc.workflow) && isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  const entry = id => (Object.hasOwn(recorded, id) && isPlainObject(recorded[id]) ? recorded[id] : {});

  const offered = heldApprovalOptions(doc).revises.map(each => each.id);
  if (!offered.includes(option)) {
    return refuse('revise-option-unknown',
      `${HELD_APPROVAL} has no revise option ${JSON.stringify(option)}; `
      + (offered.length ? `its revise options are ${offered.join(', ')}, one per node holding a choice for approval` : 'it offers no revise option, because no choice is held for approval')
      + '. Nothing was written. A continue or a stop is recorded as an ordinary answer, never through gate-revise');
  }
  const reruns = option.slice(REVISE_PREFIX.length);

  const { answer, note, refusal } = noteOf(input);
  if (refusal) return refusal;

  const decisions = decisionsOf(doc, HELD_APPROVAL);
  const latest = gateAnswer(decisions);
  // The driven fold of this option: read off the summary, never a node status.
  const folded = heldApprovalFolded(doc) && latest.option === option;
  const pending = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.gate_pending) ? doc.orchestrator.gate_pending : null;
  const runDir = path.dirname(path.resolve(state));
  const { owed } = atClose({ doc, runDir });
  const before = heldApprovalBefore({ doc, runDir, owed });
  if (!heldApprovalCurrent(doc, owed, before)) {
    const why = pending !== null && pending.node !== HELD_APPROVAL
      ? `a driver's answer is still awaited at ${pending.node ?? 'a gate'}`
      : `it still waits on ${heldApprovalBlockers(doc, owed).join(', ')}`;
    return refuse('revise-gate-not-current',
      `${HELD_APPROVAL} is not the question this run is asking: ${why}. Nothing was written. A revise answers the `
      + 'checkpoint the run is at; ask it once the closing node is the only node left running, and use its revise option there');
  }

  // The folded answer is this revise itself, not one already spent.
  const revision = heldRevisions(doc) - (folded ? 1 : 0) + 1;
  if (revision > REVISION_CEILING) {
    return refuse('revise-budget-exhausted',
      `${HELD_APPROVAL} has been revised ${REVISION_CEILING} times, its safety ceiling: no revises are left at this checkpoint. `
      + 'Nothing was written. Ask it again with its continue and stop options only — the brief no longer offers the revise');
  }

  const ids = frozenIds(recorded);
  const nodes = ids.map(id => ({ id, needs: Array.isArray(entry(id).needs) ? entry(id).needs.map(String) : [] }));
  const reach = downstreamOf(nodes, reruns);
  const stretch = ids.filter(id => id === reruns || reach.has(id));
  const subrun = stretch.find(id => entry(id).kind === 'workflow');
  if (subrun) {
    return refuse('revise-stretch-has-subrun',
      `the stretch from ${reruns} to the end of the run holds the sub-run ${subrun}, and a revise cannot re-run one: its `
      + 'child run is finished and would be adopted again. Nothing was written. Ask the checkpoint again and continue or stop');
  }

  const decision = decisionOf({ doc, state, answer, folded, latest, option, attempt: revision, reruns, note });
  const summary = summaryOf(doc, HELD_APPROVAL);
  delete summary.status;
  summary.decisions = [...(folded ? decisions.filter(item => item !== latest) : decisions), decision];

  const resets = Object.hasOwn(recorded, HELD_APPROVAL) ? [...stretch, HELD_APPROVAL] : stretch;
  const patch = {
    nodes: Object.fromEntries(resets.map(id => [id, { status: 'pending' }])),
    node_summaries: { [HELD_APPROVAL]: summary },
  };
  if (isPlainObject(doc.task) && doc.task.status === 'completed') patch.task = { status: 'in_progress' };
  const phases = trimmedPhases(doc, stretch);
  if (phases) patch.orchestrator = { completed_phases: phases };
  if (pending !== null) patch.orchestrator = { ...patch.orchestrator, gate_pending: null };

  const result = writeState({ state, patch, regress: new Set(resets) });
  if (!result.ok) return result;
  return { ...result, revision: { gate: HELD_APPROVAL, option, reruns, revision, ceiling: REVISION_CEILING, reset: stretch } };
}

function refuse(code, message) {
  return { ok: false, changed: [], errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

/**
 * The revise a run is in the middle of, or null: the gate whose answer — its
 * last decision carrying an option — is one of its revise options, nothing answered at it since. `applied` says
 * whether the reset has happened — false only between a driven fold and the
 * `gate-revise` that follows it, the one moment the run must not walk on.
 * With several (a revise further on reset an earlier gate that had been
 * revised before), the latest by its stamp. The reserved closing checkpoint
 * `HELD_APPROVAL` counts too (`heldRevision`). Read-only, for `prior-context`
 * and `resume-check`.
 */
export function openRevision(doc) {
  const recorded = isPlainObject(doc.workflow) && isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  const open = [];
  for (const [gate, entry] of Object.entries(recorded)) {
    if (!isPlainObject(entry) || entry.kind !== 'gate' || !isPlainObject(entry.reruns)) continue;
    const latest = gateAnswer(decisionsOf(doc, gate));
    if (!isPlainObject(latest) || !Object.hasOwn(entry.reruns, latest.option)) continue;
    const applied = Object.hasOwn(latest, 'attempt');
    if (!applied && entry.status !== 'completed') continue;
    open.push({
      gate,
      option: latest.option,
      reruns: String(entry.reruns[latest.option]),
      revision: applied ? attemptOf(latest) : attemptOf(entry),
      applied,
      note: typeof latest.note === 'string' ? latest.note : null,
      at: typeof latest.at === 'string' ? latest.at : '',
    });
  }
  const held = heldRevision(doc);
  if (held) open.push(held);
  if (!open.length) return null;
  const { at: _at, ...latest } = open.reduce((a, b) => (b.at > a.at ? b : a));
  return latest;
}

/**
 * The revise open at `HELD_APPROVAL`, or null: its latest answer names a
 * `revise-<node>` option. Unapplied while that answer carries no `attempt` —
 * the driven fold, before `gate-revise` resets the stretch — and applied once
 * the reset has stamped one. Read off its summary alone; it has no `reruns`.
 */
function heldRevision(doc) {
  const decisions = decisionsOf(doc, HELD_APPROVAL);
  const latest = gateAnswer(decisions);
  if (!isPlainObject(latest) || !latest.option.startsWith(REVISE_PREFIX) || latest.option === REVISE_PREFIX) return null;
  const applied = Object.hasOwn(latest, 'attempt');
  return {
    gate: HELD_APPROVAL,
    option: latest.option,
    reruns: latest.option.slice(REVISE_PREFIX.length),
    // Unapplied, the latest answer is itself the one revise counted last.
    revision: applied ? attemptOf(latest) : heldRevisions(doc),
    applied,
    note: typeof latest.note === 'string' ? latest.note : null,
    at: typeof latest.at === 'string' ? latest.at : '',
  };
}
