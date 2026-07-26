import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { createObservationEventPayload, sanitizeObservationUpdate } from "../execution-event-payload.mjs";
import { appendObservationEvent } from "../execution-event-writer.mjs";
import { validateDispatchPlan } from "../dispatch-contract.mjs";

export const PI_NATIVE_ADAPTER_SCHEMA_VERSION = 1;
export const PI_DELEGATION_PROTOCOL_VERSION = 1;
export const PI_DELEGATION_DEFAULTS = Object.freeze({
  timeoutMs: 900_000,
  maxTurns: 8,
  hardToolBudget: 64,
  maxRequestBytes: 64 * 1024,
});

export const PI_DELEGATION_EVENTS = Object.freeze({
  request: "prompt-template:subagent:request",
  started: "prompt-template:subagent:started",
  update: "prompt-template:subagent:update",
  response: "prompt-template:subagent:response",
  cancel: "prompt-template:subagent:cancel",
});

const PUBLIC_EXPORTS = Object.freeze([
  "SUBAGENT_DELEGATION_PROTOCOL_VERSION",
  "SUBAGENT_DELEGATION_REQUEST_EVENT",
  "SUBAGENT_DELEGATION_STARTED_EVENT",
  "SUBAGENT_DELEGATION_UPDATE_EVENT",
  "SUBAGENT_DELEGATION_RESPONSE_EVENT",
  "SUBAGENT_DELEGATION_CANCEL_EVENT",
]);
const RESPONSE_STATUSES = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "turn_budget_exhausted",
  "tool_budget_exhausted",
  "acceptance_failed",
  "invalid_request",
  "unavailable_context",
]);
const UNAVAILABLE_STATUSES = new Set(["invalid_request", "unavailable_context"]);
const SAFE_DISPATCH_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

// ponytail: skill names use hyphens (maister-development); colon form was a dead path
export const PI_ORCHESTRATION_COMMANDS = Object.freeze([
  Object.freeze({ name: "maister-work", invocation: "/skill:maister-work", description: "Route a task to the appropriate Maister workflow" }),
  Object.freeze({ name: "maister-dev", invocation: "/skill:maister-development", description: "Shortcut for Maister development workflow" }),
  Object.freeze({ name: "maister-development", invocation: "/skill:maister-development", description: "Run the Maister development workflow" }),
  Object.freeze({ name: "maister-init", invocation: "/skill:maister-init", description: "Initialize Maister project documentation and standards" }),
  Object.freeze({ name: "maister-issue", invocation: "/skill:maister-issue", description: "Create a local Markdown issue under .maister/issues/" }),
  Object.freeze({ name: "maister-performance", invocation: "/skill:maister-performance", description: "Run the Maister performance workflow" }),
  Object.freeze({ name: "maister-migration", invocation: "/skill:maister-migration", description: "Run the Maister migration workflow" }),
  Object.freeze({ name: "maister-research", invocation: "/skill:maister-research", description: "Run the Maister research workflow" }),
  Object.freeze({ name: "maister-product-design", invocation: "/skill:maister-product-design", description: "Run the Maister product design workflow" }),
  Object.freeze({ name: "maister-bye", invocation: "/skill:maister-bye", description: "End a Maister session while preserving workflow state" }),
  Object.freeze({ name: "maister-resume", invocation: "/skill:maister-resume", description: "Resume a Maister workflow from saved state" }),
  Object.freeze({ name: "maister-status", invocation: "/skill:maister-status", description: "Report Maister workflow state and blockers" }),
  Object.freeze({ name: "maister-next", invocation: "/skill:maister-next", description: "Suggest the best next Maister action" }),
]);

export class PiNativeAdapterError extends Error {
  constructor(code, message, details = {}, { cause, retryable = false } = {}) {
    super(`[${code}] ${message}`, cause === undefined ? {} : { cause });
    this.name = "PiNativeAdapterError";
    this.code = code;
    this.kind = code;
    this.details = details;
    this.retryable = retryable;
  }
}

function delegationPackageCandidates() {
  const configuredPackage = process.env.PI_SUBAGENTS_PACKAGE_JSON;
  const configuredAgentRoot = typeof process.env.PI_CODING_AGENT_DIR === "string"
    && process.env.PI_CODING_AGENT_DIR.length > 0
    ? (path.isAbsolute(process.env.PI_CODING_AGENT_DIR)
      ? process.env.PI_CODING_AGENT_DIR
      : path.resolve(os.homedir(), process.env.PI_CODING_AGENT_DIR))
    : path.join(os.homedir(), ".pi", "agent");
  return [
    configuredPackage,
    path.join(configuredAgentRoot, "npm", "node_modules", "pi-subagents", "package.json"),
    path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "package.json"),
  ].filter((candidate, index, values) =>
    typeof candidate === "string"
    && candidate.length > 0
    && values.indexOf(candidate) === index,
  );
}

async function importPublicPiDelegation() {
  let nativeImportError;
  try {
    return await import("pi-subagents/delegation");
  } catch (error) {
    nativeImportError = error;
  }
  for (const packageJsonPath of delegationPackageCandidates()) {
    try {
      const packageStat = fs.lstatSync(packageJsonPath);
      if (!packageStat.isFile() || packageStat.isSymbolicLink()) continue;
      const requireFromPackage = createRequire(packageJsonPath);
      // Resolve the documented public export through the package's exports
      // map.  The host package ships TypeScript, so use its supported loader
      // rather than reaching into private source modules.
      const entry = requireFromPackage.resolve("pi-subagents/delegation");
      const jitiEntry = requireFromPackage.resolve("jiti");
      const { createJiti } = await import(pathToFileURL(jitiEntry).href);
      return await createJiti(packageJsonPath).import(entry);
    } catch {
      // Try the next host-resolved package candidate and retain the native
      // import failure if none of the candidates can be loaded.
    }
  }
  throw nativeImportError;
}

function fail(code, message, details = {}, options = {}) {
  throw new PiNativeAdapterError(code, message, details, options);
}

function common(status, nativeIdentity, { output = null, nativeObservations = {}, code = null, message = null, retryable = false } = {}) {
  return {
    status,
    observed_native_role_external_id: nativeIdentity,
    output,
    native_observations: nativeObservations,
    error: status === "succeeded" ? null : { code, message, retryable },
  };
}

function mapping(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("E_PI_SCHEMA", `${label} must be a mapping`);
  return value;
}

function exactDelegation(delegation) {
  mapping(delegation, "pi-subagents/delegation export");
  for (const name of PUBLIC_EXPORTS) {
    if (!Object.hasOwn(delegation, name)) fail("E_PI_EXPORT_MISSING", `public delegation export is missing: ${name}`, { export: name });
  }
  if (delegation.SUBAGENT_DELEGATION_PROTOCOL_VERSION !== PI_DELEGATION_PROTOCOL_VERSION) {
    fail("E_PI_PROTOCOL_MISMATCH", "public delegation protocol version is unsupported", {
      expected: PI_DELEGATION_PROTOCOL_VERSION,
      actual: delegation.SUBAGENT_DELEGATION_PROTOCOL_VERSION,
    });
  }
  const expected = {
    SUBAGENT_DELEGATION_REQUEST_EVENT: PI_DELEGATION_EVENTS.request,
    SUBAGENT_DELEGATION_STARTED_EVENT: PI_DELEGATION_EVENTS.started,
    SUBAGENT_DELEGATION_UPDATE_EVENT: PI_DELEGATION_EVENTS.update,
    SUBAGENT_DELEGATION_RESPONSE_EVENT: PI_DELEGATION_EVENTS.response,
    SUBAGENT_DELEGATION_CANCEL_EVENT: PI_DELEGATION_EVENTS.cancel,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (delegation[name] !== value) fail("E_PI_PROTOCOL_MISMATCH", `public delegation event constant is unsupported: ${name}`, { expected: value, actual: delegation[name] });
  }
  return Object.freeze({
    protocolVersion: delegation.SUBAGENT_DELEGATION_PROTOCOL_VERSION,
    events: Object.freeze({
      request: delegation.SUBAGENT_DELEGATION_REQUEST_EVENT,
      started: delegation.SUBAGENT_DELEGATION_STARTED_EVENT,
      update: delegation.SUBAGENT_DELEGATION_UPDATE_EVENT,
      response: delegation.SUBAGENT_DELEGATION_RESPONSE_EVENT,
      cancel: delegation.SUBAGENT_DELEGATION_CANCEL_EVENT,
    }),
  });
}

export async function loadPublicPiDelegation(importer = () => import("pi-subagents/delegation")) {
  try {
    return exactDelegation(await importer());
  } catch (error) {
    if (error instanceof PiNativeAdapterError) throw error;
    fail("E_PI_DELEGATION_UNAVAILABLE", "public pi-subagents/delegation could not be loaded", {}, { cause: error });
  }
}

function eventBusFrom(options, nativePort) {
  const candidate = options.eventBus ?? nativePort?.eventBus ?? nativePort;
  if (!candidate || typeof candidate.on !== "function" || typeof candidate.emit !== "function") {
    fail("E_PI_EVENT_BUS_UNAVAILABLE", "Pi public event bus does not expose on and emit");
  }
  return candidate;
}

function subscribe(eventBus, channel, handler) {
  const remove = eventBus.on(channel, handler);
  if (typeof remove === "function") return remove;
  if (typeof eventBus.off === "function") return () => eventBus.off(channel, handler);
  if (typeof eventBus.removeListener === "function") return () => eventBus.removeListener(channel, handler);
  return () => {};
}

function requestTask(task) {
  if (typeof task?.bounded_task === "string") return task.bounded_task;
  if (typeof task?.task === "string") return task.task;
  if (typeof task?.prompt === "string") return task.prompt;
  if (task?.bounded_task && typeof task.bounded_task === "object") return structuredClone(task.bounded_task);
  return structuredClone(task ?? {});
}

function requestFromPlan(plan, task) {
  const timeoutMs = plan.policy.timeout_ms;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PI_DELEGATION_DEFAULTS.timeoutMs) {
    fail("E_PI_REQUEST_BOUNDS", "Pi delegation timeout exceeds the public v1 bound", {
      timeout_ms: timeoutMs,
      max_timeout_ms: PI_DELEGATION_DEFAULTS.timeoutMs,
    });
  }
  const cwd = task?.working_root ?? task?.cwd;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd.includes("\0")) {
    fail("E_PI_REQUEST_BOUNDS", "Pi delegation requires an absolute resolved task root", { cwd: cwd ?? null });
  }
  const request = {
    version: PI_DELEGATION_PROTOCOL_VERSION,
    requestId: plan.dispatch_id,
    agent: plan.native_role_external_id,
    task: requestTask(task),
    context: "fresh",
    cwd,
    timeoutMs,
    turnBudget: { maxTurns: PI_DELEGATION_DEFAULTS.maxTurns },
    toolBudget: { hard: PI_DELEGATION_DEFAULTS.hardToolBudget },
  };
  if (typeof plan.policy.model === "string") request.model = plan.policy.model;
  if (typeof task?.output_schema_id === "string") request.output = { schemaId: task.output_schema_id };
  if (task?.acceptance && typeof task.acceptance === "object" && !Array.isArray(task.acceptance)) request.acceptance = structuredClone(task.acceptance);
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > PI_DELEGATION_DEFAULTS.maxRequestBytes) {
    fail("E_PI_REQUEST_BOUNDS", "Pi delegation request exceeds the bounded request size", { max_bytes: PI_DELEGATION_DEFAULTS.maxRequestBytes });
  }
  return Object.freeze(request);
}

function parseBoundedCommandArguments(args) {
  let serialized;
  if (typeof args === "string") {
    serialized = args;
    if (Buffer.byteLength(serialized, "utf8") > PI_DELEGATION_DEFAULTS.maxRequestBytes) {
      fail("E_PI_REQUEST_BOUNDS", "maister-delegate command input exceeds the bounded request size", {
        max_bytes: PI_DELEGATION_DEFAULTS.maxRequestBytes,
      });
    }
    try {
      return JSON.parse(serialized);
    } catch (error) {
      fail("E_PI_REQUEST_SCHEMA", "maister-delegate command input is not valid JSON", {}, { cause: error });
    }
  }
  try {
    serialized = JSON.stringify(args);
  } catch (error) {
    fail("E_PI_REQUEST_SCHEMA", "maister-delegate command input is not JSON-serializable", {}, { cause: error });
  }
  if (Buffer.byteLength(serialized ?? "", "utf8") > PI_DELEGATION_DEFAULTS.maxRequestBytes) {
    fail("E_PI_REQUEST_BOUNDS", "maister-delegate command input exceeds the bounded request size", {
      max_bytes: PI_DELEGATION_DEFAULTS.maxRequestBytes,
    });
  }
  return args;
}

function requestIdentity(event, request) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) fail("E_PI_MALFORMED_EVENT", "Pi delegation event must be a mapping");
  const requestId = event.requestId ?? event.request_id;
  if (requestId !== request.requestId) fail("E_PI_REQUEST_MISMATCH", "Pi delegation event request ID does not match dispatch ID", { expected: request.requestId, actual: requestId ?? null });
  const agent = event.agent ?? event.observedAgent ?? event.observed_agent ?? null;
  if (agent !== null && agent !== request.agent) fail("E_PI_IDENTITY_MISMATCH", "Pi delegation event agent does not match the frozen role", { expected: request.agent, actual: agent });
  return agent;
}

function responseValue(event) {
  const status = event.status ?? event.result?.status ?? event.outcome?.status;
  if (typeof status !== "string" || !RESPONSE_STATUSES.has(status)) fail("E_PI_MALFORMED_RESPONSE", "Pi delegation response has no supported terminal status", { status: status ?? null });
  const output = event.output ?? event.result?.data ?? event.result?.output ?? event.data ?? null;
  const error = event.error ?? event.result?.error ?? null;
  return { status, output, error };
}

function terminalResult(status, observedAgent, response, nativeObservations = {}) {
  const unavailable = UNAVAILABLE_STATUSES.has(status);
  const failed = !unavailable && status !== "completed";
  if (status === "completed") return common("succeeded", observedAgent, { output: response.output, nativeObservations });
  return common(unavailable ? "unavailable" : "failed", observedAgent, {
    output: response.output,
    nativeObservations,
    code: typeof response.error?.code === "string" ? response.error.code : `E_PI_${status.toUpperCase()}`,
    message: typeof response.error?.message === "string" ? response.error.message : `Pi delegation ended with status ${status}`,
    retryable: failed && status === "interrupted",
  });
}

function eventError(error, fallbackCode = "E_PI_NATIVE_FAILURE") {
  return {
    code: typeof error?.code === "string" ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    retryable: Boolean(error?.retryable),
  };
}

function commandMessageSender(pi, context) {
  if (typeof context.sendUserMessage === "function") return context.sendUserMessage.bind(context);
  if (typeof pi.sendUserMessage === "function") return pi.sendUserMessage.bind(pi);
  return null;
}

function commandDeliveryOptions(context) {
  if (typeof context.isIdle === "function" && !context.isIdle()) return { deliverAs: "followUp" };
  return undefined;
}

function appendEvent({ eventPort, plan, task, eventType, status, payload = {}, observedAgent = null, clock }) {
  if (!eventPort || typeof eventPort.append !== "function") fail("E_PI_DURABLE_WRITE", "Pi adapter has no durable observation writer");
  const event = createObservationEventPayload({ plan, task, eventType, status, payload, observedAgent, clock });
  return eventPort.append({ taskPath: task.task_path ?? task.taskPath, dispatchId: plan.dispatch_id, event });
}

function adapterInput(options) {
  const nativePort = options.nativePort ?? {};
  return {
    nativePort,
    eventPort: options.eventPort ?? { append: appendObservationEvent },
    clock: options.clock ?? (() => new Date().toISOString()),
    eventBus: options.eventBus ?? nativePort.eventBus,
    delegation: options.delegation ?? nativePort.delegation,
    importer: options.importer ?? nativePort.importer,
  };
}

export function createPiNativeAdapter(options = {}) {
  const input = adapterInput(options);
  const active = new Map();
  let delegationPromise;
  const getDelegation = async () => {
    delegationPromise ??= input.delegation
      ? Promise.resolve(input.delegation).then(exactDelegation)
      : loadPublicPiDelegation(input.importer ?? importPublicPiDelegation);
    return delegationPromise;
  };

  async function inspect({ plan = null } = {}) {
    try {
      const delegation = await getDelegation();
      eventBusFrom(input, input.nativePort);
      if (typeof input.nativePort.inspect === "function") {
        const value = await input.nativePort.inspect({
          schema_version: PI_NATIVE_ADAPTER_SCHEMA_VERSION,
          adapter_id: "pi.native",
          native_role_external_id: plan?.native_role_external_id ?? null,
        });
        if (value?.available === false) return { ...value, delegation, exact_launch: false, observable_identity: false };
      }
      return {
        schema_version: PI_NATIVE_ADAPTER_SCHEMA_VERSION,
        exact_launch: true,
        observable_identity: true,
        protocol_version: delegation.protocolVersion,
        host_version: input.nativePort.hostVersion ?? "0.80.10",
      };
    } catch (error) {
      return { schema_version: PI_NATIVE_ADAPTER_SCHEMA_VERSION, exact_launch: false, observable_identity: false, error: eventError(error, "E_PI_DELEGATION_UNAVAILABLE") };
    }
  }

  async function cancel(dispatchId, status = "cancelled") {
    const pending = active.get(dispatchId);
    if (!pending || pending.finished) return false;
    if (!pending.cancelRequested) {
      pending.cancelRequested = true;
      try {
        appendEvent({ ...input, plan: pending.plan, task: pending.task, eventType: "cancel_requested", status: "cancel_requested", payload: { reason: status }, clock: input.clock });
      } catch (error) {
        pending.finish(common("failed", null, { code: "E_PI_DURABLE_WRITE", message: error.message, nativeObservations: { phase: "cancel_requested" } }));
        return false;
      }
    }
    try { pending.eventBus.emit(pending.delegation.events.cancel, { version: 1, requestId: dispatchId }); } catch { /* best effort by contract */ }
    if (status === "timed_out" || status === "process_lost") {
      pending.finish(await pending.finishTerminal(status, null, { reason: status === "timed_out" ? "timeout" : "cancel_timeout" }, status === "process_lost" ? "process_lost" : "terminal"));
    }
    return true;
  }

  async function run({ plan: candidatePlan, task = {} } = {}) {
    const plan = validateDispatchPlan(candidatePlan);
    if (plan.target !== "pi" || plan.adapter_id !== "pi.native" || plan.native_role_external_id !== plan.requested_logical_role_id) {
      throw new TypeError("pi.native adapter received a mismatched dispatch plan");
    }
    if (!SAFE_DISPATCH_ID.test(plan.dispatch_id)) throw new TypeError("Pi dispatch ID is not path-safe");
    if (active.has(plan.dispatch_id)) return common("failed", null, { code: "E_PI_DUPLICATE_REQUEST", message: "Pi dispatch ID is already active" });
    let delegation;
    let eventBus;
    let request;
    try {
      delegation = await getDelegation();
      eventBus = eventBusFrom(input, input.nativePort);
      request = requestFromPlan(plan, task);
    } catch (error) {
      return common(error.code === "E_PI_REQUEST_BOUNDS" ? "failed" : "unavailable", null, eventError(error, "E_PI_DELEGATION_UNAVAILABLE"));
    }
    const capability = await inspect({ plan });
    if (capability.exact_launch !== true || capability.observable_identity !== true) {
      return common("unavailable", null, { code: capability.error?.code ?? "E_PI_NATIVE_UNAVAILABLE", message: capability.error?.message ?? "Pi native delegation is unavailable" });
    }
    let before;
    try {
      before = appendEvent({ ...input, plan, task, eventType: "dispatch_requested", status: "requested", payload: { request: { ...request, task: "[BOUNDED]" } }, clock: input.clock });
    } catch (error) {
      return common("failed", null, { code: "E_PI_DURABLE_WRITE", message: error.message, nativeObservations: { phase: "dispatch_requested" } });
    }
    if (before?.status === "reused" && before.complete) return common("failed", null, { code: "E_PI_DUPLICATE_REQUEST", message: "Pi dispatch ID already has a terminal stream" });

    const pending = {
      plan,
      task,
      request,
      delegation,
      eventBus,
      finished: false,
      started: false,
      cancelRequested: false,
      unsubs: [],
      timer: null,
      resolve: null,
      finish: null,
      finishTerminal: null,
    };
    active.set(plan.dispatch_id, pending);
    const result = await new Promise((resolve) => {
      pending.resolve = resolve;
      const cleanup = () => {
        if (pending.timer) clearTimeout(pending.timer);
        for (const unsubscribe of pending.unsubs.splice(0)) unsubscribe();
        active.delete(plan.dispatch_id);
      };
      const finish = (value) => {
        if (pending.finished) return;
        pending.finished = true;
        cleanup();
        resolve(value);
      };
      pending.finish = finish;
      pending.finishTerminal = async (status, observedAgent, payload, eventType = "terminal", response = { status, output: null }) => {
        try {
          appendEvent({ ...input, plan, task, eventType, status, observedAgent, payload, clock: input.clock });
          return terminalResult(status, observedAgent, response, { request_id: plan.dispatch_id });
        } catch (error) {
          return common("failed", observedAgent, { code: "E_PI_DURABLE_WRITE", message: error.message, nativeObservations: { phase: eventType } });
        }
      };
      const failWith = async (error, { status = "failed", eventType = "failure", observedAgent = null } = {}) => {
        const typed = eventError(error);
        const terminal = await pending.finishTerminal(status, observedAgent, { error: typed }, eventType, { status, output: null, error: typed });
        finish(terminal);
      };
      const handleStarted = (event) => {
        try {
          const observedAgent = requestIdentity(event, request);
          if (pending.started) return;
          appendEvent({ ...input, plan, task, eventType: "started", status: "started", observedAgent, payload: { started: true }, clock: input.clock });
          pending.started = true;
        } catch (error) { void failWith(error, { status: "identity_mismatch", eventType: "failure" }); }
      };
      const handleUpdate = (event) => {
        try {
          const observedAgent = requestIdentity(event, request);
          if (!pending.started) fail("E_PI_EVENT_SEQUENCE", "Pi update arrived before started");
          appendEvent({ ...input, plan, task, eventType: "update", status: "update", observedAgent, payload: sanitizeObservationUpdate(event.update ?? event, { roots: { home: task.home, agentRoot: task.agent_root, sessionRoot: task.session_root } }), clock: input.clock });
        } catch (error) { void failWith(error, { status: error.code === "E_PI_IDENTITY_MISMATCH" ? "identity_mismatch" : "failed", eventType: "failure" }); }
      };
      const handleResponse = (event) => {
        try {
          const observedAgent = requestIdentity(event, request);
          if (!observedAgent) fail("E_PI_IDENTITY_MISMATCH", "Pi response did not include an exact agent identity");
          const response = responseValue(event);
          if (!pending.started && !(pending.cancelRequested && response.status === "cancelled")) {
            fail("E_PI_EVENT_SEQUENCE", "Pi response arrived before started");
          }
          appendEvent({ ...input, plan, task, eventType: "response_observed", status: response.status, observedAgent, payload: { response: response.output, error: response.error }, clock: input.clock });
          const terminal = awaitTerminal(response.status, observedAgent, response);
          void terminal;
        } catch (error) { void failWith(error, { status: error.code === "E_PI_IDENTITY_MISMATCH" || error.code === "E_PI_REQUEST_MISMATCH" ? "identity_mismatch" : "failed", eventType: "failure" }); }
      };
      const awaitTerminal = (status, observedAgent, response) => {
        const eventType = status === "process_lost" ? "process_lost" : "terminal";
        return pending.finishTerminal(status, observedAgent, { response: response.output, error: response.error }, eventType, response).then(finish);
      };
      const handleProcessLoss = () => {
        if (pending.finished) return;
        void failWith(new PiNativeAdapterError("E_PI_PROCESS_LOST", "Pi process ended before a terminal response"), { status: "process_lost", eventType: "process_lost" });
      };
      try {
        pending.unsubs.push(subscribe(eventBus, delegation.events.started, handleStarted));
        pending.unsubs.push(subscribe(eventBus, delegation.events.update, handleUpdate));
        pending.unsubs.push(subscribe(eventBus, delegation.events.response, handleResponse));
        if (typeof input.nativePort.onProcessLoss === "function") pending.unsubs.push(input.nativePort.onProcessLoss(handleProcessLoss) ?? (() => {}));
        pending.timer = setTimeout(() => { void cancel(plan.dispatch_id, pending.cancelRequested ? "process_lost" : "timed_out"); }, request.timeoutMs);
        eventBus.emit(delegation.events.request, request);
      } catch (error) {
        void failWith(error, { status: "failed", eventType: "failure" });
      }
    });
    return result;
  }

  run.inspect = inspect;
  run.cancel = cancel;
  run.shutdown = async () => {
    for (const dispatchId of [...active.keys()]) {
      const pending = active.get(dispatchId);
      if (pending && !pending.finished) {
        try {
          const terminal = await pending.finishTerminal("process_lost", null, { reason: "session_shutdown" }, "process_lost");
          pending.finish(terminal);
        } catch { pending.finish(common("failed", null, { code: "E_PI_PROCESS_LOST", message: "Pi session shutdown interrupted dispatch" })); }
      }
    }
  };
  return run;
}

export function createPiExtensionBridge({ pi, eventPort, clock, delegation, taskPath = null } = {}) {
  if (!pi || typeof pi.registerCommand !== "function" || typeof pi.on !== "function") throw new TypeError("Pi ExtensionAPI is missing the public command or lifecycle surface");
  const eventBus = pi.events ?? pi.eventBus;
  if (!eventBus || typeof eventBus.on !== "function" || typeof eventBus.emit !== "function") throw new TypeError("Pi ExtensionAPI is missing the public EventBus");
  const adapter = createPiNativeAdapter({ eventBus, delegation, eventPort, clock });
  pi.registerCommand("maister-delegate", {
    description: "Run one Maister public delegation request",
    handler: async (args, context = {}) => {
      const value = parseBoundedCommandArguments(args);
      mapping(value, "maister-delegate arguments");
      if (!value.plan || !value.task) fail("E_PI_REQUEST_SCHEMA", "maister-delegate requires plan and task");
      if (!context.sessionManager || typeof context.sessionManager.getSessionId !== "function") {
        fail("E_PI_CONTEXT_UNAVAILABLE", "Pi ExtensionContext does not expose sessionManager.getSessionId");
      }
      const sessionId = context.sessionManager.getSessionId();
      if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.includes("\0")) {
        fail("E_PI_CONTEXT_UNAVAILABLE", "Pi ExtensionContext did not provide a valid session ID");
      }
      return adapter({
        plan: value.plan,
        task: {
          ...value.task,
          task_path: value.task.task_path ?? taskPath ?? context.taskPath,
          working_root: value.task.working_root ?? context.cwd,
          session_id: value.task.session_id ?? sessionId,
        },
      });
    },
  });
  for (const command of PI_ORCHESTRATION_COMMANDS) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, context = {}) => {
        const sendUserMessage = commandMessageSender(pi, context);
        if (!sendUserMessage) fail("E_PI_CONTEXT_UNAVAILABLE", "Pi ExtensionContext does not expose sendUserMessage");
        const message = `${command.invocation}${typeof args === "string" && args.length > 0 ? ` ${args}` : ""}`;
        const options = commandDeliveryOptions(context);
        return options ? sendUserMessage(message, options) : sendUserMessage(message);
      },
    });
  }
  const removeShutdown = pi.on("session_shutdown", () => adapter.shutdown());
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (typeof removeShutdown === "function") removeShutdown();
    await adapter.shutdown();
  };
  return Object.freeze({ adapter, dispose });
}
