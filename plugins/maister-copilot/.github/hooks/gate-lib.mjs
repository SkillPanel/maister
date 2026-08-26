/**
 * Shared gate-hook library (contract H1 + E2).
 *
 * Zero dependencies, `node:` builtins only, Node >= 20: no `fs.glob`, no
 * package.json, no shebang reliance — the hooks are registered in the exec form
 * (`command: node`, script in `args`).
 *
 * The three hooks that import this file each run their whole body inside one
 * `try` and answer with the vocabulary of the provider that called them. What
 * lives here is everything both vocabularies share: reading the payload,
 * finding run state under the working directory, deciding whether a gate is
 * pending, and writing the per-provider response.
 */

import fs from 'node:fs';
import path from 'node:path';

export const HOOK_VERSION = 'contracts-v1';

/** The provider's fail-closed exit code (contract H1). */
const FAIL_CLOSED_EXIT = { claude: 2, copilot: 0, unknown: 2 };

/**
 * Tools that cannot change the tree. They are answered before any state is
 * read, which is what keeps a read cheap in a session with no gate anywhere.
 */
export const READ_ONLY = {
  claude: new Set([
    'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Agent',
    'Skill', 'AskUserQuestion', 'ExitPlanMode', 'ToolSearch', 'SendMessage', 'Monitor',
    'TaskStop', 'TaskOutput',
  ]),
  copilot: new Set([
    'view', 'glob', 'grep', 'fetch', 'web_fetch', 'web_search', 'report_intent',
    'ask_user', 'update_todo', 'list_dir', 'read_file',
  ]),
};

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

/** Read the JSON payload from stdin. A payload without `cwd` cannot be judged. */
export function readPayload() {
  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch (err) {
    throw new Error(`cannot read the hook payload from stdin: ${err.message}`);
  }
  if (text.trim() === '') throw new Error('the hook payload is empty');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`the hook payload is not JSON: ${err.message}`);
  }
  if (!isObject(payload)) throw new Error('the hook payload is not an object');
  if (typeof payload.cwd !== 'string' || payload.cwd === '') {
    throw new Error('the hook payload carries no cwd, so no run can be located');
  }
  return payload;
}

/**
 * Which vocabulary the payload speaks. Never keyed on the session id: a Copilot
 * subagent changes it, and both providers key their runs on the directory.
 */
export function detectProvider(payload) {
  if (!isObject(payload)) return 'unknown';
  if (typeof payload.tool_name === 'string' || typeof payload.hook_event_name === 'string') return 'claude';
  if (typeof payload.toolName === 'string' || typeof payload.sessionId === 'string') return 'copilot';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// state discovery
// ---------------------------------------------------------------------------

const STATE_FILE = 'orchestrator-state.yml';

/**
 * Every run directory under `cwd`, at the three depths the task-layout register
 * (A4) admits. Three `readdirSync` levels, no recursion and no glob: a
 * consumer tree is large and this runs before every mutating tool call.
 */
export function findStates(cwd) {
  const root = path.join(cwd, '.maister');
  if (!isDir(root)) return [];

  const runs = [];
  const seen = new Set();
  const tasks = path.join(root, 'tasks');
  for (const type of subdirs(tasks)) {
    for (const name of subdirs(path.join(tasks, type))) add(runs, seen, path.join(tasks, type, name));
  }
  const umbrella = path.join(root, 'umbrella', 'runs');
  for (const run of subdirs(umbrella)) {
    add(runs, seen, path.join(umbrella, run));
    for (const sub of subdirs(path.join(umbrella, run, 'runs'))) {
      add(runs, seen, path.join(umbrella, run, 'runs', sub));
    }
  }
  return runs;
}

/**
 * One run, once. A symlinked layout can reach the same state file by more than
 * one path, and judging it twice would name the same gate twice; the resolved
 * state file is the identity.
 */
function add(runs, seen, runDir) {
  const stateFile = path.join(runDir, STATE_FILE);
  if (!isFile(stateFile)) return;
  const key = resolvePath(stateFile);
  if (seen.has(key)) return;
  seen.add(key);
  runs.push({ runDir, stateFile });
}

/**
 * The child directories of `dir`, symlinked ones included — an umbrella whose
 * members are worktrees mounts its runs through links, and a run the walk
 * cannot see is a gate that does not hold. `statSync` follows the link where
 * `Dirent.isDirectory()` would not; a broken or looping link simply throws and
 * is skipped, and the walk is three fixed levels deep so a cycle cannot run
 * away.
 */
function subdirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter(e => e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name)))).map(e => e.name);
}

// ---------------------------------------------------------------------------
// E2 — the frozen one-line form
// ---------------------------------------------------------------------------

/**
 * Read the parts of a state file the gate decision needs, line by line. No YAML
 * parser: the frozen E2 form puts `gate_pending` on exactly one line and every
 * `workflow.nodes` entry on one line, and anything else is a deny with a reason
 * that says so.
 *
 * Keys are found by structural position, not by column: `gate_pending` is
 * whatever direct child of `orchestrator:` carries that name, at whatever indent
 * the emitter chose, and `nodes:` likewise under `workflow:`. The one-line rule
 * is about the value, and a key that is present but not on one line — including
 * one buried below its block's own child level — is a deny, never a shrug.
 */
export function scanState(text) {
  const out = { gatePending: null, hasWorkflow: false, hasNodes: false, hasTask: false, nodes: {} };
  let section = null;
  // The column the current block's direct children sit at, set by the first of
  // them; and the same for the entries under `nodes:`.
  let childIndent = null;
  let inNodes = false;
  let nodeIndent = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (/^[A-Za-z_]/.test(line)) {
      section = line.split(':')[0];
      childIndent = null;
      inNodes = false;
      nodeIndent = null;
      if (section === 'workflow') out.hasWorkflow = true;
      if (section === 'task') out.hasTask = true;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (childIndent === null) childIndent = indent;
    const isChild = indent === childIndent;
    const key = /^([A-Za-z0-9_-]+):/.exec(line.trimStart());

    if (section === 'orchestrator') {
      if (key?.[1] !== 'gate_pending') continue;
      if (!isChild) {
        throw new Error('gate_pending must be on one line, as a direct child of orchestrator:');
      }
      out.gatePending = parsePending(line.slice(indent + 'gate_pending:'.length));
      continue;
    }

    if (section !== 'workflow') continue;
    if (isChild) {
      inNodes = key?.[1] === 'nodes';
      nodeIndent = null;
      if (inNodes) out.hasNodes = true;
      continue;
    }
    if (!inNodes) continue;
    if (nodeIndent === null) nodeIndent = indent;
    if (indent !== nodeIndent) {
      throw new Error('workflow.nodes entries must each be on one line: <id>: {…}');
    }
    const entry = /^([A-Za-z0-9_-]+):(.*)$/.exec(line.trimStart());
    if (!entry) throw new Error('workflow.nodes entries must each be on one line: <id>: {…}');
    out.nodes[entry[1]] = parseFlowMap(entry[2], `workflow.nodes.${entry[1]}`);
  }
  return out;
}

function parsePending(rest) {
  const value = stripComment(rest).trim();
  if (value === '') {
    throw new Error('gate_pending must be on one line: either null or a flow map {node: …, request: …, since: …}');
  }
  if (value === 'null' || value === '~') return null;
  return parseFlowMap(value, 'gate_pending');
}

function stripComment(text) {
  if (text.trimStart().startsWith('{')) return text;
  const at = text.indexOf(' #');
  return at < 0 ? text : text.slice(0, at);
}

function parseFlowMap(text, where) {
  const value = text.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) {
    throw new Error(`${where} must be on one line: a flow map {…}, not a block map`);
  }
  const map = {};
  for (const part of splitFlow(value.slice(1, -1), ',')) {
    if (part.trim() === '') continue;
    const pieces = splitFlow(part, ':');
    if (pieces.length < 2) throw new Error(`${where} must be on one line: "${part.trim()}" is not key: value`);
    map[unquote(pieces[0])] = unquote(pieces.slice(1).join(':'));
  }
  return map;
}

/** Split a flow-map body on `sep`, honouring nesting and double quotes. */
function splitFlow(text, sep) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '{' || ch === '[')) depth++;
    else if (!quoted && (ch === '}' || ch === ']')) depth--;
    else if (!quoted && depth === 0 && ch === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(text) {
  const value = text.trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

// ---------------------------------------------------------------------------
// the pending predicate
// ---------------------------------------------------------------------------

const UNANSWERED = /^answer:\s*null\s*$/m;
const REQUEST_SUFFIX = '.request.yml';

/**
 * The runs awaiting an operator, by the three rules of § T5:
 *   (a) `gate_pending` is not null;
 *   (b) a `gates/*.request.yml` beside the state still reads `answer: null`;
 *   (c) a `workflow:` block exists but its `nodes:` or the `task:` block does not.
 *
 * Rule (c) fires only when `workflow:` is there, so a pre-v3 task directory —
 * which never carries one — can only be pending through (a) or (b).
 */
export function pendingSet(runs) {
  const pending = [];
  for (const run of runs) {
    let scanned;
    try {
      scanned = scanState(fs.readFileSync(run.stateFile, 'utf8'));
    } catch (err) {
      throw new Error(`${run.stateFile}: ${err.message}`);
    }
    const nodes = new Set();
    let awaited = false;

    if (scanned.gatePending) {
      awaited = true;
      if (scanned.gatePending.node) nodes.add(scanned.gatePending.node);
    }
    for (const node of unansweredRequests(run.runDir)) {
      awaited = true;
      nodes.add(node);
    }
    if (scanned.hasWorkflow && (!scanned.hasNodes || !scanned.hasTask)) awaited = true;

    if (awaited) pending.push({ ...run, nodes: [...nodes], scanned });
  }
  return pending;
}

/** The node ids of every request file beside the state that still reads `answer: null`. */
export function unansweredRequests(runDir) {
  const gates = path.join(runDir, 'gates');
  const nodes = [];
  let names;
  try {
    names = fs.readdirSync(gates);
  } catch {
    return nodes;
  }
  for (const name of names) {
    if (!name.endsWith(REQUEST_SUFFIX)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(gates, name), 'utf8');
    } catch (err) {
      throw new Error(`${path.join(gates, name)}: cannot be read: ${err.message}`);
    }
    if (UNANSWERED.test(text)) nodes.push(name.slice(0, -REQUEST_SUFFIX.length));
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// the allow-list
// ---------------------------------------------------------------------------

/**
 * The files the engine itself must still be able to write while `runDir` waits
 * on an operator: its state (and the temp file of the whole-file rename), the
 * request files of the nodes being asked about, the gate index, and the two
 * dashboard files. Compared by resolved path — there is no `*.tmp` glob.
 */
export function whitelist(runDir, nodes) {
  const allowed = [
    path.join(runDir, STATE_FILE),
    path.join(runDir, `${STATE_FILE}.tmp`),
    path.join(runDir, 'gates', 'index.yml'),
    path.join(runDir, 'dashboard-data.js'),
    path.join(runDir, 'dashboard.html'),
  ];
  for (const node of nodes) {
    allowed.push(path.join(runDir, 'gates', `${node}${REQUEST_SUFFIX}`));
    allowed.push(path.join(runDir, 'gates', `${node}${REQUEST_SUFFIX}.tmp`));
  }
  return new Set(allowed.map(resolvePath));
}

/**
 * `realpath`, extended to paths that do not exist yet: a new file resolves
 * through the deepest ancestor that does, so a symlinked task tree compares
 * equal either way.
 */
export function resolvePath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    if (parent === target) return target;
    return path.join(resolvePath(parent), path.basename(target));
  }
}

// ---------------------------------------------------------------------------
// tool mapping
// ---------------------------------------------------------------------------

/**
 * What a tool call is about to touch, in the caller's vocabulary.
 *
 *   kind 'read-only' — allowed without reading any state
 *   kind 'paths'     — allowed only if every path is on the allow-list
 *   kind 'opaque'    — nothing comparable to an allow-list, so denied while pending
 *
 * Everything the mapping does not recognise is 'opaque': models route around a
 * single-tool deny, so the rule is "deny what is not explicitly allowed".
 */
export function mapTool(provider, payload) {
  return provider === 'copilot' ? mapCopilotTool(payload) : mapClaudeTool(payload);
}

function mapClaudeTool(payload) {
  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (READ_ONLY.claude.has(tool)) return { tool, kind: 'read-only', targets: [] };

  const input = isObject(payload.tool_input) ? payload.tool_input : {};
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    return typeof input.file_path === 'string' && input.file_path
      ? { tool, kind: 'paths', targets: [input.file_path] }
      : { tool, kind: 'opaque', target: '' };
  }
  // A notebook is never engine-owned, the shell can redirect anywhere, and an
  // MCP server's writes are not knowable from the call.
  if (tool === 'NotebookEdit') return { tool, kind: 'opaque', target: str(input.notebook_path) };
  if (tool === 'Bash') return { tool, kind: 'opaque', target: str(input.command) };
  return { tool, kind: 'opaque', target: str(input.file_path) };
}

function mapCopilotTool(payload) {
  const tool = typeof payload.toolName === 'string' ? payload.toolName : '';
  if (READ_ONLY.copilot.has(tool)) return { tool, kind: 'read-only', targets: [] };

  // Every tool but this one sends its arguments as a JSON string; this one
  // sends the patch text itself, and one call may touch several files.
  const raw = typeof payload.toolArgs === 'string' ? payload.toolArgs : '';
  if (tool === 'apply_patch') {
    const patch = parsePatch(raw);
    if (patch.deletes.length) return { tool, kind: 'opaque', target: patch.deletes[0] };
    if (patch.targets.length === 0) return { tool, kind: 'opaque', target: '' };
    return { tool, kind: 'paths', targets: patch.targets };
  }

  const args = parseArgs(raw);
  if (tool === 'create' || tool === 'edit') {
    const target = args.path ?? args.file_path ?? args.filePath;
    return typeof target === 'string' && target
      ? { tool, kind: 'paths', targets: [target] }
      : { tool, kind: 'opaque', target: '' };
  }
  if (tool === 'bash' || tool === 'powershell') return { tool, kind: 'opaque', target: str(args.command) };
  return { tool, kind: 'opaque', target: str(args.path) };
}

/** A non-object parse result is treated as no arguments at all. */
function parseArgs(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The file lines of a patch. A delete is never allowed while a gate is pending. */
export function parsePatch(text) {
  const targets = [];
  const deletes = [];
  const heads = [
    ['*** Add File: ', targets],
    ['*** Update File: ', targets],
    ['*** Move to: ', targets],
    ['*** Delete File: ', deletes],
  ];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    for (const [head, into] of heads) {
      if (line.startsWith(head)) {
        const target = line.slice(head.length).trim();
        if (target) into.push(target);
        break;
      }
    }
  }
  return { targets, deletes };
}

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

/**
 * Deny a tool call. Always exit 0: a policy deny is a decision, not a failure,
 * and both providers read the decision off stdout.
 *
 * An allow is never `permissionDecision: allow` — that would answer the
 * terminal user's own permission prompt on their behalf. An allow is silence.
 */
export function emitDeny(provider, reason) {
  write(1, JSON.stringify(denyBody(provider, reason)));
}

function denyBody(provider, reason) {
  const flat = { permissionDecision: 'deny', permissionDecisionReason: reason };
  const nested = {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  };
  if (provider === 'copilot') return flat;
  // Claude's shape, and the shape an unknown provider gets: a payload that
  // matches neither vocabulary is only ever answered by the fail-closed path,
  // and that path is the one Claude reads at exit 2.
  return nested;
}

/**
 * Block a stop. One shape on both providers, so it takes no provider —
 * advisory on Copilot, which cannot enforce a stop.
 */
export function emitBlock(reason) {
  write(1, JSON.stringify({ decision: 'block', reason }));
}

const FAIL_CLOSED_TAIL =
  'The run\'s orchestrator-state.yml must keep gate_pending on one line (null or a flow map) and workflow.nodes '
  + 'entries on one line each. Fix the file with the editor tools or stop and report RUN-FAILED: state-unparseable. '
  + 'Do not retry with another tool.';

export function failClosedReason(cause) {
  return `GATE HOOK FAIL-CLOSED: ${cause}. ${FAIL_CLOSED_TAIL}`;
}

/**
 * Deny because the hook could not decide — an internal error or an unparseable
 * state file. Claude exits 2, which is what makes stderr visible
 * to the model; Copilot exits 0, because a non-zero exit there discards both
 * stdout and stderr and the deny would be lost with them.
 */
export function failClosed(provider, cause, trace) {
  const reason = failClosedReason(cause);
  emitDeny(provider, reason);
  const exit = FAIL_CLOSED_EXIT[provider] ?? 2;
  if (exit !== 0) write(2, `${reason}\n`);
  if (trace) trace({ decision: 'deny', exit, reason });
  process.exit(exit);
}

/** Synchronous, so nothing is lost when the process exits straight after. */
export function write(fd, text) {
  try {
    fs.writeSync(fd, text);
  } catch {
    // A closed pipe is not worth failing a tool call over.
  }
}

// ---------------------------------------------------------------------------
// trace
// ---------------------------------------------------------------------------

/**
 * One JSON line per decision when `MAISTER_GATE_TRACE` names a file; off
 * otherwise. In chain mode the hook is registered twice and fires twice per
 * call, so readers de-duplicate on `tool_use_id` before timing anything.
 */
export function traceWriter(base) {
  const file = process.env.MAISTER_GATE_TRACE;
  const started = Date.now();
  return entry => {
    if (!file) return;
    try {
      fs.appendFileSync(file, `${JSON.stringify({ at: stamp(), ...base, ...entry, ms: Date.now() - started })}\n`);
    } catch {
      // Tracing never changes a decision.
    }
  };
}

export function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
