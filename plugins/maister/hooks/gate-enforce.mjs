/**
 * Gate enforcement, both providers (contract H1, § T5).
 *
 * Registered on the mutating tools in `hooks.json` and on every tool through
 * the `--settings` template, this hook is the thing that makes a gate real: a
 * session that has asked the operator a question cannot keep working until the
 * answer is recorded.
 *
 * **Whose work it stops.** A pending gate binds the session that asked it and
 * the gated run's own task directory — nothing else. Concretely a call is
 * denied when the caller is the run's recorded driver, or when it writes inside
 * the run's directory; a call from another session, outside that directory, is
 * allowed even though it shares the working directory. Where the hook cannot
 * establish whose gate it is — a payload with no session id, or a run with no
 * `driver.session.id` — it falls back to binding every session under `cwd`, the
 * behaviour it had before the scope rule, and says so in the deny reason.
 *
 * What it never does: answer `allow`. An allow is silence and exit 0, so the
 * terminal user's own permission prompt still fires. And it never fails open —
 * everything it cannot decide denies, with the exit code that lets the calling
 * provider show the reason.
 */

import {
  bindingOf,
  detectProvider,
  emitDeny,
  failClosed,
  findStates,
  mapTool,
  pendingSet,
  readPayload,
  resolvePath,
  sessionIdOf,
  traceWriter,
  whitelist,
  withinRun,
} from './gate-lib.mjs';

import path from 'node:path';

/** How much of a target the deny reason quotes back — a command can be long. */
const TARGET_CAP = 200;

/**
 * The instruction the model reads instead of its tool result. Written as a way
 * out of the block, not as an error: the way out is to record the decision.
 */
/**
 * Why each bound run binds *this* call — the sentence that tells a session
 * whose gate it has walked into, and whether identity or a path put it there.
 */
const BOUND_BECAUSE = {
  driver: run => `this session is the driver of ${run} (orchestrator.driver.session.id matches the calling session)`,
  path: run => `this call writes inside ${run}, the gated run's own task directory`,
  'no-session': run => `the payload carries no session id, so ${run} binds every session under this working directory`,
  'no-driver': run => `${run} records no orchestrator.driver.session.id, so it binds every session under this working directory`,
};

function policyDenyReason(bound, tool, target, agentType) {
  const nodes = [...new Set(bound.flatMap(run => run.nodes))];
  const heading = nodes.length ? nodes.join(', ') : bound.map(run => path.basename(run.runDir)).join(', ');
  const node = nodes[0] ?? '<node>';
  const blocked = target ? `${tool} ${clip(target)}` : tool;
  const agent = agentType ? ` [agent: ${agentType}]` : '';
  const because = bound.map(run => BOUND_BECAUSE[run.why](path.basename(run.runDir))).join('; ');
  return (
    `GATE PENDING (${heading}): an operator decision is awaited. `
    + `Bound here because ${because}. `
    // All seven allow-listed names, spelled out: a reason that lists four of
    // them teaches the model that the other three are forbidden, and it then
    // routes around them instead of writing its own temp file or gate index.
    + `Only the pending run's orchestrator-state.yml, orchestrator-state.yml.tmp, gates/${node}.request.yml, `
    + `gates/${node}.request.yml.tmp, gates/index.yml, dashboard-data.js and `
    + 'dashboard.html may be written, with the editor tools. '
    + 'If you received a GATE-ANSWER prompt, record the decision in orchestrator-state.yml now and set '
    + 'gate_pending: null last; if the operator answered in-session (terminal mode), record it in '
    + `gates/${node}.request.yml answer: first, then do the same; otherwise print GATE-PENDING: ${node} `
    + `and end the turn. Do not retry with another tool. (blocked: ${blocked})${agent}`
  );
}

const clip = text => (text.length > TARGET_CAP ? `${text.slice(0, TARGET_CAP)}…` : text).replace(/\s+/g, ' ');

let provider = 'unknown';
let trace = traceWriter({ provider, event: 'PreToolUse' });

// There is no internal deadline, and there is nothing for one to interrupt:
// the whole body below is synchronous and ends in `process.exit`, so a timer
// could only fire after the decision was already made. The hook opens no
// socket, spawns nothing and waits on nothing — its only I/O is a bounded
// `readdirSync` over three fixed directory levels and a `readFileSync` per run
// state — and the provider's own timeout is the backstop for the filesystem
// itself hanging.
try {
  const payload = readPayload();
  provider = detectProvider(payload);
  const tooling = mapTool(provider, payload);
  const agentType = typeof payload.agent_type === 'string' && payload.agent_type ? payload.agent_type : null;
  trace = traceWriter({
    provider,
    event: payload.hook_event_name ?? 'preToolUse',
    tool: tooling.tool,
    tool_use_id: payload.tool_use_id ?? null,
  });

  if (provider === 'unknown') {
    failClosed(provider, 'the payload matches neither provider vocabulary, so no response shape is known', trace);
  }

  const allow = target => {
    trace({ decision: 'allow', exit: 0, target: target ?? null, reason: null });
    process.exit(0);
  };

  // Reads cannot change the tree, and answering them before any state is read
  // is what keeps a session with no gate anywhere at the cost of a node start.
  if (tooling.kind === 'read-only') allow(null);

  const runs = findStates(payload.cwd);
  if (runs.length === 0) allow(null);

  const pending = pendingSet(runs);
  if (pending.length === 0) allow(null);

  const targets = tooling.kind === 'paths' ? tooling.targets : [];
  const absolute = targets.map(target => resolvePath(path.resolve(payload.cwd, target)));
  const sessionId = sessionIdOf(payload);

  // Which of the pending runs is this call's business. A run binds the session
  // that asked its question, and it binds anything written inside its own task
  // directory; a call from another session, outside it, is not what the gate is
  // for. An opaque call — a shell, an MCP server — cannot be placed against a
  // directory at all, so identity is the only thing that can bind it.
  const bound = [];
  for (const run of pending) {
    const identity = bindingOf(run, sessionId);
    const inside = absolute.some(target => withinRun(run.runDir, target));
    if (identity || inside) bound.push({ ...run, why: identity ?? 'path' });
  }
  if (bound.length === 0) allow(targets.join(' ') || null);

  if (tooling.kind === 'paths') {
    const allowed = new Set();
    for (const run of bound) for (const file of whitelist(run.runDir, run.nodes)) allowed.add(file);
    // Every path of the call must be engine-owned: one foreign file in a
    // multi-file patch denies the whole patch.
    if (absolute.every(target => allowed.has(target))) allow(targets.join(' '));
  }

  const target = tooling.kind === 'paths' ? targets.join(' ') : tooling.target ?? '';
  const reason = policyDenyReason(bound, tooling.tool, target, agentType);
  emitDeny(provider, reason);
  trace({ decision: 'deny', exit: 0, target: target || null, reason });
  process.exit(0);
} catch (err) {
  failClosed(provider, err && err.message ? err.message : String(err), trace);
}
