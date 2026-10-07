/**
 * The state reader: the parts of `orchestrator-state.yml` that live in the
 * frozen one-line form, and the gate request files beside it that are still
 * open.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. It sits at the plugin
 * root rather than in a skill because more than one reader shares it: the
 * engine's state writer uses it as the oracle a candidate file must pass, the
 * run-complete guard reads the driver's kind through it, and the gate index
 * derives each request's status from it.
 *
 * Code outside the engine imports these two exports by name from this path;
 * keep the names, the signatures and the path stable.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// the frozen one-line form
// ---------------------------------------------------------------------------

/**
 * Read the frozen one-line parts of a state file, line by line. No YAML parser:
 * the frozen one-line form puts `gate_pending` on exactly one line and every
 * `workflow.nodes` entry on one line, and anything else throws with a reason
 * that says so.
 *
 * Keys are found by structural position, not by column: `gate_pending` is
 * whatever direct child of `orchestrator:` carries that name, at whatever indent
 * the emitter chose, and `nodes:` likewise under `workflow:`. The one-line rule
 * is about the value, and a key that is present but not on one line — including
 * one buried below its block's own child level — throws, never a shrug.
 */
export function scanState(text) {
  // The node map is prototype-free. It is keyed by ids read out of a file this
  // reader does not own, and a plain object turns an entry named `__proto__` into
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
 * The driver's kind and session id out of the `driver:` line, both null when
 * the line does not yield them.
 *
 * Read leniently, and deliberately so. The one-line form is frozen for
 * `gate_pending` and for `workflow.nodes` entries and for nothing else, so a
 * `driver:` written as a block map is a valid state file — it yields nulls
 * rather than throwing. A kind that cannot be read is null, indistinguishable
 * from a run nobody is driving.
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
// open requests
// ---------------------------------------------------------------------------

const UNANSWERED = /^answer:\s*null\s*$/m;
const REQUEST_SUFFIX = '.request.yml';

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
