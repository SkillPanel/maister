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
 * kind (E1) and nothing about the dispatch that spawned the run — no id, no
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
 * `state.mjs` and `gate.mjs` already reach across the plugin for
 * `hooks/gate-lib.mjs`. A second copy of the convention here would answer
 * confidently and wrongly the first time the convention moved.
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
 */

import fs from 'node:fs';

import { scanState } from '../../../../hooks/gate-lib.mjs';
import { published } from '../../../umbrella/scripts/lib/outbox.mjs';
import { Refusal } from '../../../../lib/canonical.mjs';

/** C5's two closing markers, spelled here once. */
const COMPLETE = 'RUN-COMPLETE';
const UNPUBLISHED = 'RUN-FAILED: closeout-unpublished';

/** The type a close-out message carries in its filename (C4). */
const CLOSEOUT = 'closeout';

/**
 * Judge one run's ending.
 *
 * Returns rather than throws, like `writeState` and `gateRequest`: the entry
 * point prints the marker as the last line and maps `ok` onto the exit code.
 * Only a genuine internal fault escapes.
 */
export function runComplete({ state, outbox, dispatch_id: dispatchId }) {
  try {
    const kind = driverKindOf(state);
    if (kind !== 'dispatch') return { ok: true, marker: COMPLETE, errors: [] };

    if (!outbox || !dispatchId) {
      return refused('this run is driven by a dispatch, so its close-out is owed to the outbox its seed names, and neither --outbox nor --dispatch-id was given, so nothing can be checked. Publish the close-out with the umbrella runtime\'s outbox verb (--type=closeout, with the grade and summary the seed\'s close-out contract asks for), then run this verb again with the same --outbox root and --dispatch-id.');
    }

    const messages = published({ outbox, dispatch_id: dispatchId });
    if (messages.some(message => message.type === CLOSEOUT)) {
      return { ok: true, marker: COMPLETE, errors: [] };
    }

    const sent = messages.map(message => message.type);
    return refused(`the outbox for dispatch ${dispatchId} holds ${sent.length ? `${sent.join(', ')} and no close-out` : 'no message at all'}, so the dispatching chain has not learned this run is over and will wait forever. Publish the close-out with the umbrella runtime's outbox verb (--type=closeout, with the grade and summary the seed's close-out contract asks for), then run this verb again.`);
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, marker: UNPUBLISHED, errors: [{ code: err.code, message: err.message }] };
    }
    throw err;
  }
}

/** A run that cannot show its close-out, with the recovery in the message. */
function refused(message) {
  return { ok: false, marker: UNPUBLISHED, errors: [{ code: 'closeout-unpublished', message }] };
}

/**
 * The driver kind on disk, read through the same scanner the gate hook uses so
 * one parser answers for every reader of an E1 block. An absent block is a
 * terminal run by contract, and so is an absent file — a run with no state
 * never dispatched anything and owes no message.
 */
function driverKindOf(state) {
  let raw;
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Refusal('state-unreadable',
      `${state} cannot be read: ${err.message}, so the run's driver cannot be established and its ending cannot be judged.`);
  }
  return scanState(raw).driverKind;
}
