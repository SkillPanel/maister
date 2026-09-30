/**
 * A gate's revise option, carried out: the one write that sends a run back.
 *
 * Why a verb rather than a patch the model composes. A revise resets every node
 * between the option's `reruns` node and the gate, and which nodes those are is
 * a fact of the graph — the same kind of fact the gate brief's `Next:` line is,
 * and for the same reason the model is not asked to derive it by hand. The
 * budget is another: the engine counts revisions, so the engine refuses the one
 * too many. And the write must be whole — every node of the stretch pending, its
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
 * The refusals, each leaving the file exactly as it was: `revise-not-a-gate`,
 * `revise-option-unknown`, `revise-note-missing`, `revise-gate-not-current`,
 * `revise-budget-exhausted` and `revise-stretch-has-subrun`, plus `state-unreadable`
 * and any refusal of the writer itself, passed through.
 *
 * Pure but for the one write: no stdio. Returns what `writeState` returns, and
 * `revision` beside it on success. Zero dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import { parse, isPlainObject } from './state-read.mjs';
import { attemptOf, isContextBlock, writeState } from './state.mjs';
import { reviseStretch } from './graph.mjs';
import * as canonical from '../../../../lib/canonical.mjs';

/** How many times one gate may send the run back. The engine's own constant, not a grammar key. */
export const REVISION_BUDGET = 3;

/** Statuses a gate's needs may hold for the gate to be the run's current question. */
const SETTLED = new Set(['completed', 'skipped']);

/** Statuses of a gate still waiting for its answer, in the one turn it is asked. */
const ASKING = new Set(['pending', 'running']);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Send the run whose state file is `state` back from the gate `node` by its
 * revise option `option`. `input` is the patch file's document: `{note,
 * answered_by?, at?}` — `at` the answer's stamp when a driver carried one, the
 * writer's own clock otherwise.
 */
export function gateRevise({ state, node, option, input }) {
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

  const answer = isPlainObject(input) ? input : {};
  const note = typeof answer.note === 'string' ? answer.note.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  if (note === '') {
    return refuse('revise-note-missing',
      'the patch file carries no note. Nothing was written. Send {"note": "<what should change>"} — the suggestions the '
      + 'operator chose, and anything they typed — because the re-run node reads the note to know what to change');
  }
  if (answer.at !== undefined && (typeof answer.at !== 'string' || !TIMESTAMP.test(answer.at))) {
    return refuse('revise-note-missing',
      `at is ${JSON.stringify(answer.at)}, which is not a UTC timestamp. Nothing was written. Send the answer's own `
      + 'stamp as YYYY-MM-DDTHH:MM:SSZ, or leave at out and the writer stamps the decision itself');
  }

  const decisions = decisionsOf(doc, node);
  const latest = decisions.length ? decisions[decisions.length - 1] : null;
  // The driven fold records the answer as any answer is recorded — the gate
  // completed, the option on its summary — before the shell is open again; this
  // is the write that follows it. Recognised by the option with no attempt yet.
  const folded = gate.status === 'completed' && isPlainObject(latest) && latest.option === option
    && !Object.hasOwn(latest, 'attempt');
  const why = notCurrent(doc, recorded, entry, node, gate, folded);
  if (why) {
    return refuse('revise-gate-not-current',
      `the gate ${node} is not the question this run is asking: ${why}. Nothing was written. A revise answers the gate `
      + 'the run is at; ask that gate, or resume the run, and use its revise option there');
  }

  const attempt = attemptOf(gate);
  if (attempt > REVISION_BUDGET) {
    return refuse('revise-budget-exhausted',
      `the gate ${node} has been revised ${REVISION_BUDGET} times, which is its budget. Nothing was written. `
      + 'Ask the gate again with its continue and stop options only — the gate brief no longer offers the revise');
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

  const decision = {
    option,
    answered_by: typeof answer.answered_by === 'string' && answer.answered_by !== ''
      ? answer.answered_by : (folded && typeof latest.answered_by === 'string' ? latest.answered_by : 'operator'),
    at: answer.at ?? (folded && typeof latest.at === 'string' ? latest.at : canonical.stamp()),
    attempt,
    reruns,
    note,
  };
  const summary = summaryOf(doc, node);
  delete summary.status;
  summary.decisions = [...(folded ? decisions.slice(0, -1) : decisions), decision];

  const patch = {
    nodes: Object.fromEntries(stretch.map(id => [id, { status: 'pending' }])),
    node_summaries: { [node]: summary },
  };
  const phases = trimmedPhases(doc, stretch);
  if (phases) patch.orchestrator = { completed_phases: phases };

  const result = writeState({ state, patch, regress: new Set(stretch) });
  if (!result.ok) return result;
  return { ...result, revision: { gate: node, option, reruns, revision: attempt, budget: REVISION_BUDGET, reset: stretch } };
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

function refuse(code, message) {
  return { ok: false, changed: [], errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

/**
 * The revise a run is in the middle of, or null: the gate whose last decision
 * is one of its revise options, nothing answered at it since. `applied` says
 * whether the reset has happened — false only between a driven fold and the
 * `gate-revise` that follows it, the one moment the run must not walk on.
 * With several (a revise further on reset an earlier gate that had been
 * revised before), the latest by its stamp. Read-only, for `prior-context`
 * and `resume-check`.
 */
export function openRevision(doc) {
  const recorded = isPlainObject(doc.workflow) && isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  const open = [];
  for (const [gate, entry] of Object.entries(recorded)) {
    if (!isPlainObject(entry) || entry.kind !== 'gate' || !isPlainObject(entry.reruns)) continue;
    const decisions = decisionsOf(doc, gate);
    const latest = decisions.length ? decisions[decisions.length - 1] : null;
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
  if (!open.length) return null;
  const { at: _at, ...latest } = open.reduce((a, b) => (b.at > a.at ? b : a));
  return latest;
}
