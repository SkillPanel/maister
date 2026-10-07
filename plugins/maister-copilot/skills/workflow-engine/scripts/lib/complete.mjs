/**
 * The close-out guard: the last thing a run does, and the reason a dispatched
 * one cannot finish in silence.
 *
 * THE DEFECT THIS MODULE EXISTS FOR. A dispatched worker ran every node, was
 * re-entered after its gate, committed, pushed, recorded its closing outcome
 * value — and published no close-out message. Its chain has no second path to
 * learn a dispatch is over: the outbox is the return channel, so the chain
 * waited forever while every local sign said success. The branch was pushed,
 * the worker's own state said `closed-out`, and its process had exited.
 *
 * The prose half of the fix names the publish step in the closing node of every
 * definition. This is the half that makes forgetting it a failure rather than a
 * silence: under `driver.kind: dispatch` a run reaches `RUN-COMPLETE` only once
 * its outbox holds a close-out, and otherwise ends on
 * `RUN-FAILED: closeout-unpublished`, which names the verb that was owed.
 *
 * WHY THE OUTBOX COORDINATES ARE FLAGS. The engine's state records the driver's
 * kind and nothing about the dispatch that spawned the run — no id, no
 * outbox root. Those two live in the worker's seed, which already hands them to
 * it, spelled exactly as they are spelled here, for the outbox verb it runs to
 * publish. So the guard asks for what the worker already holds instead of
 * widening a contract block the daemon also writes. A dispatch-driven run that
 * omits them is refused the same way a run that published nothing is refused:
 * the guard cannot prove the close-out landed, and an unprovable close-out is
 * the whole defect.
 *
 * WHY IT ASKS THE UMBRELLA RUNTIME. The on-disk shape of an outbox belongs to
 * `outbox.mjs`, which claims those names exclusively as its locking primitive.
 * This module never builds one: it calls that module's own reader, the way
 * `state.mjs` already reaches across the plugin for `lib/state-scan.mjs`. A
 * second copy of the convention here would answer confidently and wrongly the
 * first time the convention moved.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER. A close-out that degraded — the outbox
 * was unwritable and the verb handed back a `DISPATCH-RESULT:` line instead —
 * writes no file and would fail this check. It never reaches it: that line is
 * itself the turn's last line, so a degraded close-out ends the turn on the
 * marker it produced and never asks for this one. The two are alternatives, not
 * a sequence.
 *
 * A `cockpit` driver is not guarded and owes no message: it has no outbox,
 * because nothing dispatched it. Neither does a terminal run.
 *
 * WHICH MARKER, FROM THE RUN'S OWN STATUS. The marker is decided by
 * `task.status`, never by the driver alone: a run whose last node failed must
 * not end its transcript on the line every reader takes for success.
 *
 * - `completed` is `RUN-COMPLETE`.
 * - `failed` is `RUN-FAILED: <reason>`, the reason naming the first failed node
 *   in graph order. A `workflow:` node carries the reason the sub-run ending
 *   table pins, `sub-run <child-run-id> failed`, so that line comes from this
 *   verb rather than being typed.
 * - `stopped` is `RUN-COMPLETE` as well. The marker vocabulary has no stopped
 *   form and a stop is a legitimate outcome, never a `RUN-FAILED`; the outcome
 *   itself is on disk, which every tool reads before the marker. So that a
 *   person reading the terminal does not take the stop for a success, one plain
 *   `run stopped: <node> - <option>` line is printed immediately above it — the
 *   marker stays the last line, so nothing that matches markers moves.
 * - Anything else means the closing patch has not been written, and a missing
 *   state file means there is no run to close. Both are refusals: printing a
 *   verdict for a run that has not recorded one is the defect this reading
 *   closes.
 *
 * Under a dispatch driver the close-out check runs for every ending, a failed
 * one included — a failed dispatch still owes its chain a close-out graded
 * `failed`, or the chain waits on it forever.
 *
 * WHAT A COMPLETED RUN STILL OWES. `completed` is a claim about the graph, and
 * the status alone cannot back it: a node an overlay added as a dangling leaf,
 * a node left running, a recovery node the ready set had made ready — each
 * closed `RUN-COMPLETE` while it had never run. So a run that recorded
 * `completed` is refused `run-nodes-unfinished`, naming each node, while any
 * node has not finished and the ready set cannot rule it out. The judgement is
 * asked of `gate-brief.mjs`, where the guard evaluation and the ready-set
 * simulation live, so a pending node is owed exactly when a driver walking the
 * frozen graph would have run it: a false guard, or a need that ended failed or
 * stopped which the node's `on` does not accept, keeps it off the path and it is
 * not owed. Only `completed` is judged. A failed run's untouched nodes are its
 * failure, and a stop records every unexecuted node `stopped`. The check runs
 * before the close-out check, so a run with both defects finishes its work
 * before it publishes the close-out that says it is over.
 *
 * WHAT IS MISSING FROM DISK. Every ending the verb judges also reconciles what
 * the run declared against what is there: one `missing-artifact: <node> <path>`
 * line, above the marker and above a stop's notice, for each artifact a
 * completed node declared that does not exist. The declarations are the
 * resolved graph's, overlays included, so a node an overlay added is held to
 * its own; a `workflow:` node's resolve against its child's task directory, the
 * one its recorded `task_path` names, and print repository-root-relative. A
 * node carrying `dir:` is skipped — its work lands in another repository — and
 * so is an interpolated path, which names someone else's output.
 *
 * An artifact the node's own summary sanctions — its key under
 * `node_summaries.<node>.absent`, with a reason — prints nothing: the node
 * completed without it on purpose and said why, and a line for it would be a
 * false alarm the operator learns to ignore, taking the real ones with it.
 *
 * It is a warning, never a refusal, and the exit code does not move. Whether a
 * missing artifact is a defect is the node's own call, made before it recorded
 * `completed`: its prose may sanction the absence, and a node that forgot to
 * record the sanction is still right, so a refusal would stop runs that no
 * write could clear. At the close the only remedy left is re-driving a node that already
 * completed, which is the operator's decision, and the line is what lets them
 * make it. When the definition cannot be shown to be the one the run froze,
 * nothing is checked and a warning says so rather than guessing.
 *
 * The codes this module raises: `state-missing`, `state-unreadable`,
 * `run-not-ended`, `run-nodes-unfinished` and `closeout-unpublished`. The
 * failed ending's `run-failed` rides beside its marker and is not a refusal.
 */

import fs from 'node:fs';
import path from 'node:path';

import { scanState } from '../../../../lib/state-scan.mjs';
import { published } from '../../../umbrella/scripts/lib/outbox.mjs';
import { Refusal } from '../../../../lib/canonical.mjs';
import { gateCard } from './dashboard.mjs';
import { atClose } from './gate-brief.mjs';
import { REQUEST_SUFFIX } from './gate-index.mjs';
import { projectRootOf } from './state.mjs';
import { isPlainObject, parse } from './state-read.mjs';

/** The closing markers, spelled here once. */
const COMPLETE = 'RUN-COMPLETE';
const FAILED = 'RUN-FAILED';

/** The type a close-out message carries in its filename. */
const CLOSEOUT = 'closeout';

/** The statuses that end a run; any other one has not recorded its ending. */
const ENDINGS = new Set(['completed', 'failed', 'stopped']);

/**
 * Judge one run's ending.
 *
 * Returns rather than throws, like `writeState` and `gateRequest`: the entry
 * point prints the `missing` lines, then `notice` (when there is one), then the
 * marker as the last line, puts each of `warnings` on stderr, and maps `ok`
 * onto the exit code. `ok` is true exactly when the marker is `RUN-COMPLETE`.
 * A refusal carries neither list. Only a genuine internal fault escapes.
 */
export function runComplete({ state, outbox, dispatch_id: dispatchId }) {
  try {
    const { raw, doc } = readRun(state);
    const task = isPlainObject(doc.task) ? doc.task : {};
    const status = typeof task.status === 'string' ? task.status : null;
    if (!ENDINGS.has(status)) {
      throw new Refusal('run-not-ended',
        `${state} records task.status ${status === null ? 'as absent' : `"${status}"`}, so the run has not recorded how it ended and no marker can be printed for it. Write the closing patch first — the closing node's outcome with task.status completed or failed, or a stop option's task.status stopped with every unexecuted node — then run this verb again.`);
    }

    const runDir = path.dirname(path.resolve(state));
    const close = atClose({ doc, runDir });
    if (status === 'completed' && close.owed.length) {
      throw new Refusal('run-nodes-unfinished', unfinished(state, close));
    }

    if (scanState(raw).driverKind === 'dispatch') {
      const refusal = closeoutRefusal({ outbox, dispatchId });
      if (refusal) return refusal;
    }

    const nodes = nodesOf(doc);
    const reconciled = reconcile(nodes, close.graph, runDir, absencesOf(doc));
    if (status === 'failed') {
      const reason = failureOf(nodes);
      return {
        ok: false,
        marker: `${FAILED}: ${reason}`,
        errors: [{ code: 'run-failed', message: `the run recorded task.status failed (${reason}). This is its ending, not a refusal to retry: echo the marker as the turn's last line.` }],
        ...reconciled,
      };
    }
    const result = { ok: true, marker: COMPLETE, errors: [], ...reconciled };
    if (status === 'stopped') result.notice = `run stopped: ${stopOf(nodes, doc, runDir)}`;
    return result;
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, marker: `${FAILED}: ${err.code}`, errors: [{ code: err.code, message: err.message }] };
    }
    throw err;
  }
}

/** A dispatched run's close-out, checked in its outbox; null when it landed. */
function closeoutRefusal({ outbox, dispatchId }) {
  if (!outbox || !dispatchId) {
    return refused('this run is driven by a dispatch, so its close-out is owed to the outbox its seed names, and neither --outbox nor --dispatch-id was given, so nothing can be checked. Publish the close-out with the umbrella runtime\'s outbox verb (--type=closeout, with the grade and summary the seed\'s close-out contract asks for), then run this verb again with the same --outbox root and --dispatch-id.');
  }

  const messages = published({ outbox, dispatch_id: dispatchId });
  if (messages.some(message => message.type === CLOSEOUT)) return null;

  const sent = messages.map(message => message.type);
  return refused(`the outbox for dispatch ${dispatchId} holds ${sent.length ? `${sent.join(', ')} and no close-out` : 'no message at all'}, so the dispatching chain has not learned this run is over and will wait forever. Publish the close-out with the umbrella runtime's outbox verb (--type=closeout, with the grade and summary the seed's close-out contract asks for), then run this verb again.`);
}

/**
 * The unfinished-nodes refusal: every owed node by id and recorded status, why
 * a guard could not rule one out when that is the reason, and the recovery —
 * the work that was missed, never a status written over it.
 */
function unfinished(state, { owed, drift }) {
  const named = owed.map(({ id, status, guard }) => (guard
    ? `${id} (${status}; its guard ${guard} reads a value that was never recorded)`
    : `${id} (${status})`));
  const one = owed.length === 1;
  const count = one ? 'a node has' : `${owed.length} nodes have`;
  const rule = drift
    ? 'The definition this run froze cannot be re-read, or has changed since the freeze, so no guard was evaluated: every pending node whose needs are met counts.'
    : `A pending node counts unless the graph keeps it off the path the run took — a false guard, or a need that ended failed or stopped which the node's on: does not accept — and nothing keeps ${one ? 'this one' : 'these'} off it.`;
  return `${state} records task.status completed, but ${count} not finished: ${named.join(', ')}. ${rule} `
    + `Resume the run and run ${one ? 'it' : 'each of them'}, or record skipped for one whose guard is false; then write the closing patch again and run this verb again. `
    + `A run that cannot finish ${one ? 'it' : 'them'} ends failed, or stopped with every unexecuted node, instead. Never record a node completed that did not run.`;
}

/** A run that cannot show its close-out, with the recovery in the message. */
function refused(message) {
  return { ok: false, marker: `${FAILED}: closeout-unpublished`, errors: [{ code: 'closeout-unpublished', message }] };
}

/**
 * The state file, raw and parsed. The raw text goes to the shared scanner, so
 * one parser answers for every reader of the `driver:` block; the parsed
 * document goes through the reader every other state consumer shares.
 */
function readRun(state) {
  let raw;
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Refusal('state-missing',
        `${state} does not exist, so there is no run here to close and nothing to judge. Check the --state path names the run's own orchestrator-state.yml; a run that never wrote its state has not reached its ending.`);
    }
    throw new Refusal('state-unreadable',
      `${state} cannot be read: ${err.message}, so the run's ending cannot be judged.`);
  }
  try {
    return { raw, doc: parse(raw) };
  } catch (err) {
    throw new Refusal('state-unreadable',
      `${state} cannot be parsed: ${err.message}, so the run's ending cannot be judged. Nothing was changed; repair the file through the state writer's recovery, then run this verb again.`);
  }
}

/** The frozen node entries, in graph order. */
function nodesOf(doc) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  return Object.entries(nodes).filter(([, entry]) => isPlainObject(entry));
}

/**
 * `{missing, warnings}`: one `missing-artifact: <node> <path>` line per artifact
 * a completed node declared that is not on disk and whose summary does not
 * sanction its absence, in graph order, or — when the
 * run's graph cannot be shown to be the frozen one — no lines and one warning
 * saying nothing was checked. A run with no frozen nodes has nothing to check.
 */
function reconcile(nodes, graph, runDir, absences) {
  if (!nodes.length) return { missing: [], warnings: [] };
  if (graph === null) {
    return {
      missing: [],
      warnings: ['declared artifacts were not checked: the definition this run froze cannot be re-read, or has changed since the freeze'],
    };
  }

  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const root = projectRootOf(runDir);
  const missing = [];
  for (const [id, entry] of nodes) {
    const node = byId.get(id);
    if (entry.status !== 'completed' || !node || !isPlainObject(node.outputs?.artifacts)) continue;
    if (typeof node.dir === 'string' && node.dir !== '') continue;
    const child = typeof node.uses === 'string' && node.uses.startsWith('workflow:');
    const taskPath = isPlainObject(entry.values) && typeof entry.values.task_path === 'string' && entry.values.task_path !== ''
      ? entry.values.task_path
      : null;
    const sanctioned = absences(id);
    for (const [key, declared] of Object.entries(node.outputs.artifacts)) {
      if (typeof declared !== 'string' || declared === '' || declared.includes('${')) continue;
      if (sanctioned.has(key)) continue;
      // A child's artifact is the child's to write; without its address it is
      // nowhere this run can look, so it is missing rather than looked for here.
      if (child && taskPath === null) {
        missing.push(missingLine(id, declared));
        continue;
      }
      const shown = child ? path.posix.join(taskPath, declared) : declared;
      if (!fs.existsSync(path.resolve(child ? root : runDir, shown))) missing.push(missingLine(id, shown));
    }
  }
  return { missing, warnings: [] };
}

/**
 * The artifact keys a node's summary sanctions as not produced, as a function of
 * the node id. Only a key with a reason counts: the writer refuses any other, and
 * a hand-edited entry that gives none has not sanctioned anything.
 */
function absencesOf(doc) {
  const summaries = isPlainObject(doc.node_summaries) ? doc.node_summaries : {};
  return id => {
    const summary = Object.hasOwn(summaries, id) && isPlainObject(summaries[id]) ? summaries[id] : {};
    const absent = isPlainObject(summary.absent) ? summary.absent : {};
    return new Set(Object.keys(absent).filter(key => typeof absent[key] === 'string' && absent[key].trim() !== ''));
  };
}

/** The line one absent artifact prints: node id first, then the path. */
function missingLine(node, file) {
  return `missing-artifact: ${node} ${file}`;
}

/** The failed run's reason: the first failed node, or the task when none is. */
function failureOf(nodes) {
  const hit = nodes.find(([, entry]) => entry.status === 'failed');
  if (!hit) return 'task-failed';
  const [id, entry] = hit;
  const runId = isPlainObject(entry.values) ? entry.values.run_id : undefined;
  return entry.kind === 'workflow' && typeof runId === 'string' && runId !== ''
    ? `sub-run ${runId} failed`
    : `node ${id} failed`;
}

/**
 * `<node> - <option>` for the notice line: what stopped the run, read from
 * state and never reconstructed.
 *
 * A stopped node that carries a summary ran and adopted its child's stop — the
 * unexecuted nodes a stop records carry none — so that node is the cause.
 * Otherwise the stop came from a gate, and the gate is the completed one
 * answered last. Its option is the request file's answer, as a label, when a
 * driven run left one; a gate asked in session records it among its summary's
 * decisions instead. An option that cannot be found is said to be missing
 * rather than guessed.
 */
function stopOf(nodes, doc, runDir) {
  const summaries = isPlainObject(doc.node_summaries) ? doc.node_summaries : {};
  const adopted = nodes.find(([id, entry]) => entry.status === 'stopped' && Object.hasOwn(summaries, id));
  if (adopted) {
    const [id, entry] = adopted;
    const runId = isPlainObject(entry.values) ? entry.values.run_id : undefined;
    return `${id} - sub-run ${typeof runId === 'string' && runId !== '' ? runId : '(run id not recorded)'} stopped`;
  }

  const answered = nodes.filter(([, entry]) => entry.status === 'completed');
  const gates = answered.filter(([, entry]) => entry.kind === 'gate');
  const pool = gates.length ? gates : answered;
  let last = null;
  for (const candidate of pool) {
    const stamp = String(candidate[1].completed ?? '');
    if (last === null || stamp >= String(last[1].completed ?? '')) last = candidate;
  }
  if (last === null) return 'no answered gate recorded - option not recorded';
  const [id] = last;
  return `${id} - ${requestAnswer(runDir, id) ?? summaryAnswer(summaries[id]) ?? 'option not recorded'}`;
}

/** The chosen option's label from `gates/<node>.request.yml`, or null. */
function requestAnswer(runDir, node) {
  try {
    const card = gateCard(parse(fs.readFileSync(path.join(runDir, 'gates', `${node}${REQUEST_SUFFIX}`), 'utf8')));
    return card?.answer ?? null;
  } catch {
    return null;
  }
}

/** The last answer an in-session gate recorded on its summary, or null. */
function summaryAnswer(summary) {
  if (!isPlainObject(summary)) return null;
  const decisions = Array.isArray(summary.decisions) ? summary.decisions : [];
  for (const decision of [...decisions].reverse()) {
    if (!isPlainObject(decision)) continue;
    for (const key of ['answer', 'option', 'decision']) {
      if (typeof decision[key] === 'string' && decision[key] !== '') return decision[key];
    }
  }
  for (const key of ['answer', 'option']) {
    if (typeof summary[key] === 'string' && summary[key] !== '') return summary[key];
  }
  return null;
}
