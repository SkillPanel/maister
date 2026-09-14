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

export const HOOK_VERSION = 'contracts-v2';

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
    if (LEGACY_TYPE_DIRS.has(type)) continue;
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
 * The five legacy type dirs of § 2. They are **inventory-only regardless of
 * what their state files contain**, so a run is never read out of one and a
 * gate can never be pending in one. Skipping them here rather than in
 * `pendingSet` keeps the stop nudge on the same rule for free.
 *
 * They are not merely old: the pre-v3 orchestrators wrote a top-level
 * `workflow:` key of their own — a scalar name, or a `{name, version, mode}`
 * block — which is the same key the pending predicate's rule (c) keys on. A
 * repository carrying a few years of them would otherwise have every one of
 * them read as a run awaiting an operator.
 */
const LEGACY_TYPE_DIRS = new Set(['bug-fixes', 'enhancements', 'new-features', 'refactoring', 'mockups']);

/**
 * A top-level `orchestrator:` key: the floor marker of § 2. Tested against the
 * raw text rather than against a scan, because a below-floor document must not
 * even be scanned — its `workflow:` block is a pre-v3 shape and scanning it can
 * throw, which would fail the session closed on a document that is an inventory
 * row rather than a run.
 */
const ORCHESTRATOR_BLOCK = /^orchestrator:/m;

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
  // The node map is prototype-free. It is keyed by ids read out of a file the
  // hook does not own, and a plain object turns an entry named `__proto__` into
  // a prototype swap: the node vanishes from `Object.keys` — the map every
  // caller counts — while the write that put it there reported success.
  const out = {
    gatePending: null, driverSession: null, driverKind: null,
    hasWorkflow: false, hasNodes: false, hasTask: false, nodes: Object.create(null),
  };
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
      if (key?.[1] === 'driver' && isChild) {
        const driver = readDriver(line.slice(indent + 'driver:'.length));
        out.driverSession = driver.session;
        out.driverKind = driver.kind;
        continue;
      }
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

/**
 * The driver's kind and session id out of the E1 `driver:` line, both null when
 * the line does not yield them.
 *
 * Read leniently, and deliberately so. The one-line form is frozen for
 * `gate_pending` and for `workflow.nodes` entries and for nothing else, so a
 * `driver:` written as a block map is a valid state file — it must cost the
 * scoping and the kind, never fail the session closed. An id that cannot be
 * read is null, and null is the wide fallback for scope: the run then binds
 * every session under the working directory, exactly as it did before the scope
 * rule existed. A kind that cannot be read is null too, and there null is the
 * *narrow* fallback — the stop nudge stays silent on it, the same way it stays
 * silent on `terminal` — because an unreadable kind is indistinguishable from a
 * run nobody is driving, and blocking a stop on a guess traps the session.
 */
function readDriver(rest) {
  const out = { kind: null, session: null };
  try {
    const driver = parseFlowMap(rest, 'driver');
    if (typeof driver.kind === 'string' && driver.kind !== '') out.kind = driver.kind;
    const session = driver.session;
    if (typeof session !== 'string' || !session.trimStart().startsWith('{')) return out;
    const id = parseFlowMap(session, 'driver.session').id;
    if (typeof id === 'string' && id !== '') out.session = id;
    return out;
  } catch {
    return out;
  }
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
  // Prototype-free for the same reason the node map is: the keys come out of
  // the file, and `{__proto__: …}` is a flow map anything may write.
  const map = Object.create(null);
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
 * All three are qualified by the compatibility floor: **below the floor there is
 * no gate** (§ 2, § E2, § H1). A state file carrying no `orchestrator:` block is
 * an inventory row rather than a run, so it is skipped before it is scanned and
 * none of the three rules is reached — not even (b), an unanswered request file
 * lying beside it.
 *
 * That qualification is the whole of what keeps rule (c) honest. Its original
 * note read "a pre-v3 task directory never carries a `workflow:` key", and that
 * is simply false: the pre-v3 orchestrators wrote one as their own header, as a
 * scalar (`workflow: research-orchestrator`) or as a `{name, version, mode}`
 * block. Neither carries `nodes:`, so every such directory satisfied (c) — and
 * because a gate no request file describes can never be answered, one legacy
 * directory left in a repository denied every write in it, permanently. The
 * floor check is what distinguishes "a v3 run whose state was truncated", which
 * must fail closed, from "a document written before any of this existed", which
 * must not gate at all.
 */
export function pendingSet(runs) {
  const pending = [];
  for (const run of runs) {
    let text;
    try {
      text = fs.readFileSync(run.stateFile, 'utf8');
    } catch (err) {
      throw new Error(`${run.stateFile}: ${err.message}`);
    }
    if (!ORCHESTRATOR_BLOCK.test(text)) continue;
    let scanned;
    try {
      scanned = scanState(text);
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

    if (awaited) pending.push({ ...run, nodes: [...nodes], driverSession: scanned.driverSession, scanned });
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
// scope — which sessions one pending gate binds
// ---------------------------------------------------------------------------

/**
 * The calling session's id, in either vocabulary: `session_id` on Claude,
 * `sessionId` on Copilot (§ H1). Null when the payload carries neither, which
 * is the wide fallback rather than an error.
 *
 * Claude's subagents share the parent's `session_id` and are told apart by
 * `agent_id`/`agent_type` instead, so a blocked driver cannot step around its
 * own gate by spawning one. Copilot's subagents are issued a fresh `sessionId`,
 * so there a subagent reads as another session — it is still denied inside the
 * gated run's directory by the path rule, and the residual is recorded in
 * ADR-0007.
 */
export function sessionIdOf(payload) {
  if (!isObject(payload)) return null;
  const id = typeof payload.session_id === 'string' && payload.session_id !== ''
    ? payload.session_id
    : typeof payload.sessionId === 'string' ? payload.sessionId : '';
  return id === '' ? null : id;
}

/**
 * Whether `target` lies inside `runDir`. Both sides are resolved first, so a
 * run reached through a symlinked task tree compares equal either way.
 */
export function withinRun(runDir, target) {
  const root = resolvePath(runDir);
  const file = resolvePath(target);
  return file === root || file.startsWith(root + path.sep);
}

/**
 * Why a pending run binds the calling session, or null when identity alone does
 * not bind it:
 *
 *   'driver'     — the caller is the session the run recorded as its driver
 *   'no-session' — the payload carries no session id
 *   'no-driver'  — the run records no `orchestrator.driver.session.id`
 *
 * The last two are the fail-closed fallback. Unable to establish *whose* gate
 * this is, the hook keeps the behaviour it had before the scope rule and binds
 * every session under the working directory; the deny reason says which of the
 * two it was, because both are fixable at the writer rather than at the hook.
 */
export function bindingOf(run, sessionId) {
  if (!sessionId) return 'no-session';
  if (!run.driverSession) return 'no-driver';
  return run.driverSession === sessionId ? 'driver' : null;
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

// ---------------------------------------------------------------------------
// the plugin's own invocations
// ---------------------------------------------------------------------------

/**
 * The two scripts this plugin asks a session to run through a shell, and the
 * verbs each one owns — the same closed lists `workflow.mjs` and `umbrella.mjs`
 * declare for themselves. A verb outside them is not this plugin's call, and a
 * script at any other path is not this plugin's script however it is spelled.
 *
 * The path is the boundary, never the name: `workflow.mjs` is an ordinary file
 * name that anything may use, so recognition ends at a resolved path inside a
 * directory carrying this plugin's own manifest.
 */
const ENGINE_ENTRIES = new Map([
  [
    'skills/workflow-engine/scripts/workflow.mjs',
    new Set(['validate', 'resolve', 'diagram', 'write-state', 'gate-request', 'run-complete']),
  ],
  [
    'skills/umbrella/scripts/umbrella.mjs',
    new Set(['init', 'validate', 'prune', 'envelope', 'seed', 'ledger', 'outbox']),
  ],
]);

/** The manifest that says a directory is a plugin root rather than a copy of one. */
const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');

/** The shell tools, in both vocabularies. Only these carry a command to read. */
const SHELL_TOOLS = new Set(['Bash', 'bash', 'powershell']);

/**
 * Shell metacharacters that put anything at all beside the invocation being
 * judged. `|` is absent on purpose: the documented way to hand a patch to the
 * state writer is `echo '{}' | node …`, and a pipeline is checked stage by
 * stage below instead.
 */
const COMMAND_POISON = /[;&`<>]|\$\(|\|\|/;

/** The only producers a recognised pipeline may carry on its left-hand side. */
const STDIN_PRODUCERS = new Set(['echo', 'printf']);

/** Both spellings of the plugin-root variable, in both `$VAR` and `${VAR}` forms. */
const ROOT_VARIABLE = /\$\{?(CLAUDE_PLUGIN_ROOT|MAISTER_PLUGIN_ROOT)\}?/g;

/**
 * Whether a tool call is this plugin invoking one of its own runtimes.
 *
 * The engine writes every state change through a script, so on a terminal
 * session each write is a shell call the operator is asked to approve — three
 * or more per node. Recognising the call is what lets the hook answer for it;
 * see `emitAllow` for why that answer is the one exception to an allow being
 * silence.
 *
 * Returns `{root, script, verb}` or `null`. Everything it cannot recognise
 * returns `null` and is left to the caller's own permission flow untouched:
 * this function never denies anything and never widens what a pending gate
 * allows.
 */
export function engineInvocation(tooling) {
  if (!tooling || tooling.kind !== 'opaque' || !SHELL_TOOLS.has(tooling.tool)) return null;
  const command = typeof tooling.target === 'string' ? tooling.target.trim() : '';
  if (!command || COMMAND_POISON.test(command)) return null;

  // At most two stages, and a producer on the left: a pipeline that reaches
  // any further is a command doing more than handing a patch to the writer.
  const stages = command.split('|').map(stage => stage.trim());
  if (stages.length > 2 || stages.some(stage => stage === '')) return null;
  if (stages.length === 2) {
    const producer = tokenize(stages[0]);
    if (!producer.length || !STDIN_PRODUCERS.has(producer[0]) || producer.some(hasSubstitution)) return null;
  }

  const tokens = tokenize(stages[stages.length - 1]);
  if (tokens.length < 3 || tokens[0] !== 'node') return null;

  const script = expandRoot(tokens[1]);
  if (!script || hasSubstitution(script) || !path.isAbsolute(script)) return null;
  const resolved = resolvePath(script);

  for (const [entry, verbs] of ENGINE_ENTRIES) {
    const suffix = path.sep + entry.split('/').join(path.sep);
    if (!resolved.endsWith(suffix)) continue;
    const root = resolved.slice(0, -suffix.length);
    if (!isPluginRoot(root) || !matchesDeclaredRoot(root)) return null;
    const verb = tokens.slice(2).find(token => !token.startsWith('-'));
    return verb && verbs.has(verb) ? { root, script: entry, verb } : null;
  }
  return null;
}

/**
 * Split a command into argv, honouring one level of quoting. A token whose
 * quotes do not close is returned as written, which then fails the checks
 * above rather than being silently repaired.
 */
function tokenize(text) {
  const tokens = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/** Any shell expansion the hook would have to evaluate to know the real path. */
const hasSubstitution = token => token.includes('$');

/**
 * Substitute the plugin-root variable from the environment. Two spellings, one
 * value — the host's and the one the Copilot variant's install notes ask the
 * operator to export — read exactly as the runtimes themselves read them.
 */
function expandRoot(token) {
  return token.replace(ROOT_VARIABLE, (whole, name) => process.env[name] ?? whole);
}

/** A directory is a plugin root when it carries a plugin manifest. */
function isPluginRoot(root) {
  try {
    return fs.statSync(path.join(root, PLUGIN_MANIFEST)).isFile();
  } catch {
    return false;
  }
}

/**
 * Where the environment declares a plugin root, the script has to be inside
 * *that* one. It is the tighter half of the check and the only half available
 * on Copilot, where this hook runs from the consumer's own repository and has
 * no location of its own to derive a root from. With neither variable set —
 * a session that loaded the plugin without exporting one — the manifest check
 * above stands alone.
 */
function matchesDeclaredRoot(root) {
  const declared = process.env.CLAUDE_PLUGIN_ROOT || process.env.MAISTER_PLUGIN_ROOT;
  return declared ? resolvePath(declared) === root : true;
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
 * An allow is silence, with one exception: this plugin's own runtimes, which
 * `emitAllow` answers for. Nothing else is ever answered `allow` — that would
 * decide the terminal user's own permission prompt on their behalf.
 */
export function emitDeny(provider, reason) {
  write(1, JSON.stringify(denyBody(provider, reason)));
}

/**
 * Allow a call this plugin is making to itself (see `engineInvocation`).
 *
 * The invariant everywhere else is that an allow is silence, so that a user's
 * own permission rules still decide. The exception exists because the engine's
 * writer *is* the plugin: every state change is a shell call through it, so on
 * a terminal session an operator is asked to approve their own workflow three
 * or more times per node, for a call the hook has already verified by path.
 * Answering it is the only way that prompt goes away without handing state
 * writing back to the editor tools, which is the corruption the writer exists
 * to prevent.
 */
export function emitAllow(provider, reason) {
  write(1, JSON.stringify(allowBody(provider, reason)));
}

/** Why a recognised invocation was allowed, in the shape the deny reasons take. */
export function engineReason(engine) {
  return (
    `ENGINE ALLOW: ${engine.verb} of the plugin's own ${engine.script}, `
    + `verified at ${engine.root}. This plugin writes every state change through that script, `
    + 'so the call is its own and is not put to the operator.'
  );
}

function allowBody(provider, reason) {
  const flat = { permissionDecision: 'allow', permissionDecisionReason: reason };
  if (provider === 'copilot') return flat;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', ...flat } };
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
