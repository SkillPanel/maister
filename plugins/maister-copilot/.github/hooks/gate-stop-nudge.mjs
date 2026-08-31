/**
 * Stop nudge, both providers (contract H1, § T5).
 *
 * The failure this catches: a session reaches a gate node, decides the question
 * is rhetorical, and ends its turn without ever writing the request file — so
 * the operator is never asked and the chain stalls with nothing on disk to
 * explain it. The nudge refuses that stop once and says what is missing.
 *
 * A stop is never failed closed. Blocking a stop on a problem the model cannot
 * fix would trap the session, so every read or parse problem here allows the
 * stop and leaves a note on stderr.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  detectProvider,
  emitBlock,
  findStates,
  readPayload,
  scanState,
  traceWriter,
  write,
} from './gate-lib.mjs';

const REQUEST_DIR = 'gates';

function blockReason(node) {
  return (
    `gate node '${node}' is running but ${REQUEST_DIR}/${node}.request.yml does not exist: `
    + 'suspend the run with one gate-request call (it writes the request file, the gate index and '
    + 'gate_pending together — there is no second state write), rewrite dashboard-data.js, '
    + `print GATE-PENDING: ${node}, then stop.`
  );
}

let provider = 'unknown';
let trace = traceWriter({ provider, event: 'Stop' });

try {
  const payload = readPayload();
  provider = detectProvider(payload);
  trace = traceWriter({
    provider,
    event: payload.hook_event_name ?? 'agentStop',
    tool: null,
    tool_use_id: null,
  });

  // The provider sets this on the stop it makes after a block. Honouring it is
  // what keeps the nudge from looping against a model that cannot satisfy it;
  // both harnesses additionally cap consecutive blocks, and this hook
  // deliberately keeps no count of its own.
  if (payload.stop_hook_active === true) {
    trace({ decision: 'allow', exit: 0, reason: 'stop_hook_active' });
    process.exit(0);
  }

  for (const run of findStates(payload.cwd)) {
    const scanned = scanState(fs.readFileSync(run.stateFile, 'utf8'));
    if (!scanned.hasWorkflow) continue;
    for (const [node, entry] of Object.entries(scanned.nodes)) {
      if (entry.kind !== 'gate' || entry.status !== 'running') continue;
      if (fs.existsSync(path.join(run.runDir, REQUEST_DIR, `${node}.request.yml`))) continue;
      const reason = blockReason(node);
      emitBlock(reason);
      trace({ decision: 'block', exit: 0, target: run.runDir, reason });
      process.exit(0);
    }
  }
  trace({ decision: 'allow', exit: 0, reason: null });
  process.exit(0);
} catch (err) {
  // Allowed, always: the alternative is a session that cannot end its turn.
  write(2, `gate stop nudge: ${err && err.message ? err.message : String(err)} — allowing the stop\n`);
  trace({ decision: 'allow', exit: 0, reason: 'nudge could not read the run state' });
  process.exit(0);
}
