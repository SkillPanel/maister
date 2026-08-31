/**
 * The gate request writer.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. One verb —
 * `workflow.mjs gate-request` — and one job: suspend a run at one gate, whole.
 * It writes `gates/<node>.request.yml`, regenerates `gates/index.yml`, and sets
 * `orchestrator.gate_pending` and the node's `status: suspended` through the
 * state writer. Those three are one operation because they cannot be two.
 *
 * **Why the marker moved in here.** The enforcement hook reads a run as pending
 * as soon as an unanswered `gates/*.request.yml` sits beside its state — one
 * step earlier than a two-call sequence assumes. So a `write-state` issued
 * *after* the request file is a `Bash` call against a run that is already
 * pending, `mapTool` classes every `Bash` call `opaque`, and it is denied: the
 * request file lands, the marker the cockpit reads never does, and the run
 * wedges at a gate nothing recorded. Reversing the two calls fails the same way
 * from the other side — setting `gate_pending` first makes the run pending, and
 * then `gate-request` is the denied `Bash` call. Whichever write goes first
 * suspends the run, so both writes have to happen inside it. Nothing in the
 * hook changed to make this work; the sequence did.
 *
 * Why this is an engine verb rather than a caller's own file write. The
 * `gates/` tree is a contract shape (E2) read by the enforcement hook, and the
 * hook's allow-list is a list of names: the request file and its one frozen
 * temp twin are on it, nothing else is. A model spelling those files by hand
 * would be the same model-authored-contract-shape problem the state writer
 * exists to remove — a question written at the wrong indent is a gate the
 * cockpit cannot render and the hook reads as unanswered forever. And it can
 * run: at suspend time no gate is pending yet, so a script invocation is still
 * allowed.
 *
 * Why the verb owns three of the keys. `version`, `asked_at` and `answer` are
 * supplied here and refused from the caller, so a caller can neither
 * pre-answer its own gate nor stamp a time it did not measure. `answer: null`
 * at column 0 is the exact line the hook greps for to decide a request is
 * still open; it is not a formatting preference.
 *
 * Why the whole document is emitted rather than round-tripped. Same reason as
 * everywhere else in this plugin: a YAML package is absent in a consumer
 * checkout, and a generic dumper emits shapes the one-line readers throw on. A
 * value that cannot be spelled safely is refused, never escaped.
 */

import fs from 'node:fs';
import path from 'node:path';
// The reader lives beside the hooks because the hooks are its other caller.
// `unansweredRequests` is imported rather than approximated for the same reason
// the state writer imports `scanState`: the status this module writes into the
// index must be the status the hook derives, and a second implementation of
// "is this request still open" drifts on the first change to either.
import { scanState, unansweredRequests } from '../../../../hooks/gate-lib.mjs';
// The marker is written through the state writer rather than beside it: the
// one-line E2 form, the self-check and the whole-file rename are its rules, and
// a second speller of `gate_pending` is the drift this plugin exists to avoid.
import { writeState } from './state.mjs';
import * as canonical from '../../../../lib/canonical.mjs';
const { Refusal, flow, scalar } = canonical;

/** This verb's own names for the two refusals the shared publish path raises. */
const COMMIT_CODES = { unwritable: 'gate-unwritable', tempExists: 'gate-temp-exists' };

/** Spelled as `lib/state.mjs` and `lib/graph.mjs` spell it. */
const NODE_ID = /^[a-z][a-z0-9-]{1,40}$/;

/** E2: the three kinds, and the frozen suffix the hook scans for. */
const KINDS = ['gate', 'decision', 'convergence'];
const REQUEST_SUFFIX = '.request.yml';
const INDEX_FILE = 'index.yml';
const STATE_FILE = 'orchestrator-state.yml';

/** `gate-lib.mjs`'s open-request test, restated where the adopt path needs it. */
const UNANSWERED = /^answer:\s*null\s*$/m;

/** The keys a caller may send, and the three the verb supplies itself. */
const CALLER_KEYS = ['node', 'kind', 'question', 'context', 'options', 'multi_select', 'run_id'];
const OWNED_KEYS = ['version', 'asked_at', 'answer'];

/** Fixed key order inside a one-line option entry, and inside an index entry. */
const OPTION_KEYS = ['id', 'label', 'effect', 'description', 'recommended', 'values'];
const ENTRY_KEYS = ['node', 'request', 'sub_run', 'kind', 'asked_at', 'status'];

/** E2's option effects. `null` means "the authored option said nothing". */
const EFFECTS = ['continue', 'stop'];

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Write the request for one gate node and regenerate the gate index.
 *
 * `state` is the run's `orchestrator-state.yml`; everything else is derived
 * from it — the run directory, the `gates/` directory beside it, and the frozen
 * graph the node id is checked against. Taking the state file rather than the
 * run directory is what makes the node check possible: a request for a node the
 * frozen graph does not carry is a question nothing will ever route an answer
 * back to.
 *
 * Returns `{ok, changed, errors}` in the state writer's shape, with `changed`
 * carrying task-root-relative paths. On a refusal `changed` is empty **and the
 * run is not suspended**: the request file this call published is removed and
 * the index regenerated without it, so the shell the caller needs in order to
 * retry is still there. That rollback is the one place this runtime undoes its
 * own write, and it is not a repair of someone else's state — it is this call
 * declining to leave half of itself behind.
 *
 * The refusal set is this verb's four plus whatever the state writer refuses,
 * reported verbatim with its own code. Both sets are closed and both are
 * documented in the same table; the union is what a caller of one verb that is
 * now two writes has to read.
 */
export function gateRequest({ state, request }) {
  const changed = [];
  let published = null;
  const gatesOf = dir => path.join(dir, 'gates');
  try {
    const doc = checkRequest(request);
    const runDir = path.dirname(path.resolve(state));
    const nodes = frozenNodes(state);
    if (!Object.hasOwn(nodes, doc.node)) {
      throw new Refusal('gate-request-invalid',
        `the frozen graph in ${state} carries no node ${doc.node}, so a request for it could never be answered`);
    }

    const gates = gatesOf(runDir);
    const target = path.join(gates, `${doc.node}${REQUEST_SUFFIX}`);
    const relative = `gates/${doc.node}${REQUEST_SUFFIX}`;

    // A request file already on disk is either a gate that was genuinely asked
    // — refuse, because overwriting it would discard an answer that may already
    // be in it — or this same call resumed after it was killed between the
    // publish and the marker. The two are told apart by the bytes: an
    // unanswered file that is what this call would have written, once its own
    // `asked_at` is adopted, is this call's own leftover. Adopting it is what
    // keeps a gate askable; without it the marker could never be set, and with
    // no marker there is no shell to clear the file with either.
    if (adopt(target, doc)) {
      // The file stands as it is; only what follows it still has to happen.
    } else {
      canonical.commit({ target, text: renderRequest(doc), tmp: `${target}.tmp`, codes: COMMIT_CODES });
      published = target;
      changed.push(relative);
    }

    // The request file is the fact, so it is published first and the index is
    // regenerated from what is on disk afterwards.
    const indexFile = path.join(gates, INDEX_FILE);
    canonical.commit({ target: indexFile, text: renderIndex(gates, runDir), tmp: `${indexFile}.tmp`, codes: COMMIT_CODES });
    changed.push(`gates/${INDEX_FILE}`);

    // The marker last, because it is what the cockpit polls: a run it reads as
    // suspended has a request file and an index row to render beside it.
    const marker = writeState({
      state,
      patch: {
        orchestrator: { gate_pending: { node: doc.node, request: relative, since: doc.asked_at } },
        nodes: { [doc.node]: { status: 'suspended' } },
      },
    });
    if (!marker.ok) {
      // Re-raised with the writer's own code and text. The message already
      // carries its code as a prefix — `Refusal` puts it there — so it is
      // stripped before it is put there a second time.
      const first = marker.errors[0] ?? { code: 'state-unwritable', message: 'the pending marker was refused' };
      const prefix = `${first.code}: `;
      throw new Refusal(first.code,
        first.message.startsWith(prefix) ? first.message.slice(prefix.length) : first.message);
    }
    changed.push(STATE_FILE);

    return { ok: true, changed, errors: [] };
  } catch (err) {
    if (published !== null) rollback(published, gatesOf(path.dirname(path.resolve(state))), path.dirname(path.resolve(state)));
    if (err instanceof Refusal) return { ok: false, changed: [], errors: [{ code: err.code, message: err.message }] };
    throw err;
  }
}

/**
 * Is the request file on disk this call's own leftover?
 *
 * True only when it is still unanswered and byte-identical to what this call
 * would write with the file's own `asked_at` — so the question, the options and
 * the kind all have to match. Anything else is a different gate, or one that
 * has been answered, and is refused. The adopted `asked_at` becomes the
 * marker's `since`, because that is when the operator was actually asked.
 */
function adopt(target, doc) {
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw new Refusal('gate-unwritable', `${target} exists but cannot be read: ${err.message}`);
  }
  const asked = /^asked_at:\s*"?([^"\r\n]*?)"?\s*$/m.exec(text);
  const twin = asked === null ? null : renderRequest({ ...doc, asked_at: asked[1] });
  if (!UNANSWERED.test(text) || twin === null || text !== twin) {
    throw new Refusal('gate-request-exists',
      `${target} already exists and is not the request this call would have written; a gate is asked once, and overwriting the file would discard an answer that may already be in it`);
  }
  doc.asked_at = asked[1];
  return true;
}

/**
 * Undo the request file this call published, and take the index back with it.
 *
 * Best-effort by design: it runs on a path that is already refusing, and a
 * second refusal raised out of the cleanup would replace the reason the caller
 * needs with one about the cleanup. What matters is that the run is not left
 * pending on a question nothing recorded — and removing the file is what
 * decides that, since the hook's rule is the file's existence.
 */
function rollback(target, gates, runDir) {
  try {
    fs.rmSync(target, { force: true });
  } catch {
    return;
  }
  try {
    const indexFile = path.join(gates, INDEX_FILE);
    canonical.commit({ target: indexFile, text: renderIndex(gates, runDir), tmp: `${indexFile}.tmp`, codes: COMMIT_CODES });
  } catch {
    // The index is a mirror and is regenerated whole by the next request.
  }
}

// ---------------------------------------------------------------------------
// the request document
// ---------------------------------------------------------------------------

/**
 * The caller's document, checked whole before anything is located on disk, so a
 * refusal costs no write. Returns the document the renderer emits — the
 * caller's keys plus the three this verb owns.
 */
function checkRequest(request) {
  if (!isPlainObject(request)) {
    throw new Refusal('gate-request-invalid', 'the request document must be a JSON object');
  }
  for (const key of OWNED_KEYS) {
    if (key in request) {
      throw new Refusal('gate-request-invalid',
        `${key} is supplied by the verb and refused from a caller: a caller that could send asked_at could stamp a time it did not measure, and one that could send answer could answer its own gate`);
    }
  }
  for (const key of Object.keys(request)) {
    if (!CALLER_KEYS.includes(key)) {
      throw new Refusal('gate-request-invalid', `the request key "${key}" is not one of ${CALLER_KEYS.join(', ')}`);
    }
  }

  if (typeof request.node !== 'string' || !NODE_ID.test(request.node)) {
    throw new Refusal('gate-request-invalid', `${JSON.stringify(String(request.node))} is not a usable node id`);
  }
  if (!KINDS.includes(request.kind)) {
    throw new Refusal('gate-request-invalid', `the kind must be one of ${KINDS.join(', ')}`);
  }
  if (typeof request.question !== 'string' || request.question.trim() === '') {
    throw new Refusal('gate-request-invalid', 'the question must be a non-empty string');
  }
  if (!Array.isArray(request.options) || request.options.length === 0) {
    throw new Refusal('gate-request-invalid', 'a request carries at least one option; a gate with no options is a question nothing can answer');
  }
  if ('multi_select' in request && typeof request.multi_select !== 'boolean') {
    throw new Refusal('gate-request-invalid', 'the flag that says whether more than one option may be picked is a boolean');
  }
  if ('run_id' in request && request.run_id !== null && typeof request.run_id !== 'string') {
    throw new Refusal('gate-request-invalid', 'run_id is a string or null');
  }

  return {
    version: 1,
    run_id: 'run_id' in request ? request.run_id : undefined,
    node: request.node,
    kind: request.kind,
    asked_at: canonical.stamp(),
    question: request.question,
    context: checkContext(request.context),
    options: request.options.map(checkOption),
    multi_select: request.multi_select ?? false,
  };
}

/** The optional context block: a summary, a list of artifact paths, or neither. */
function checkContext(context) {
  if (context === undefined || context === null) return null;
  if (!isPlainObject(context)) throw new Refusal('gate-request-invalid', 'context is an object with summary and artifacts');
  for (const key of Object.keys(context)) {
    if (key !== 'summary' && key !== 'artifacts') {
      throw new Refusal('gate-request-invalid', `the context key "${key}" is not one of summary, artifacts`);
    }
  }
  const summary = context.summary ?? null;
  if (summary !== null && typeof summary !== 'string') {
    throw new Refusal('gate-request-invalid', 'context.summary is a string or null');
  }
  const artifacts = context.artifacts ?? [];
  if (!Array.isArray(artifacts) || artifacts.some(item => typeof item !== 'string' || item === '')) {
    throw new Refusal('gate-request-invalid', 'context.artifacts is a list of non-empty paths');
  }
  return { summary, artifacts };
}

/**
 * One option, with its ids checked for collision by the caller loop below.
 *
 * The uniqueness check is runner logic rather than schema logic — E2 says so
 * — and it lives here because a duplicate id is not a cosmetic fault: the
 * answer names an option by id, so two options sharing one make the recorded
 * answer ambiguous and the run unresumable.
 */
function checkOption(option, index, all) {
  if (!isPlainObject(option)) throw new Refusal('gate-request-invalid', `option ${index} must be an object`);
  for (const key of Object.keys(option)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new Refusal('gate-request-invalid', `the option key "${key}" is not one of ${OPTION_KEYS.join(', ')}`);
    }
  }
  if (typeof option.id !== 'string' || option.id.trim() === '') {
    throw new Refusal('gate-request-invalid', `option ${index} has no id`);
  }
  if (all.findIndex(other => isPlainObject(other) && other.id === option.id) !== index) {
    throw new Refusal('gate-request-invalid',
      `two options share the id ${option.id}, so a recorded answer naming it would be ambiguous`);
  }
  for (const key of ['label', 'description']) {
    if (option[key] !== undefined && option[key] !== null && typeof option[key] !== 'string') {
      throw new Refusal('gate-request-invalid', `option ${option.id}: ${key} is a string or null`);
    }
  }
  if (option.effect !== undefined && option.effect !== null && !EFFECTS.includes(option.effect)) {
    throw new Refusal('gate-request-invalid', `option ${option.id}: effect is one of ${EFFECTS.join(', ')} or null`);
  }
  if (option.recommended !== undefined && option.recommended !== null && typeof option.recommended !== 'boolean') {
    throw new Refusal('gate-request-invalid', `option ${option.id}: recommended is a boolean or null`);
  }
  if (option.values !== undefined && option.values !== null && !isPlainObject(option.values)) {
    throw new Refusal('gate-request-invalid', `option ${option.id}: values is a map or null`);
  }
  return option;
}

/**
 * The frozen graph's node ids, read through the hook's own reader.
 *
 * A state file the reader throws on is reported as an invalid invocation rather
 * than as a filesystem fault: the flag named a file this verb cannot act on,
 * and nothing has been attempted.
 */
function frozenNodes(state) {
  let text;
  try {
    text = fs.readFileSync(state, 'utf8');
  } catch (err) {
    throw new Refusal('gate-request-invalid', `the state file ${state} cannot be read: ${err.message}`);
  }
  let scanned;
  try {
    scanned = scanState(text);
  } catch (err) {
    throw new Refusal('gate-request-invalid', `the state file ${state} cannot be read back: ${err.message}`);
  }
  if (!scanned.hasWorkflow || !scanned.hasNodes) {
    throw new Refusal('gate-request-invalid',
      `the state file ${state} carries no frozen workflow.nodes block, so a node id cannot be checked against the graph`);
  }
  return scanned.nodes;
}

// ---------------------------------------------------------------------------
// emitting
// ---------------------------------------------------------------------------

/**
 * The request file.
 *
 * Block form at the top level because that is the shape E2's fixtures carry and
 * the cockpit renders; one-line flow maps for the options, because that is the
 * shape the readers require. `answer: null` is emitted last and at column 0 —
 * the hook's open-request test is an anchored line match, so an indented or
 * re-ordered `answer` key is a request it reads as answered.
 */
function renderRequest(doc) {
  const lines = [];
  lines.push(`version: ${doc.version}`);
  if (doc.run_id !== undefined) lines.push(`run_id: ${scalar(doc.run_id, 'run_id')}`);
  lines.push(`node: ${scalar(doc.node, 'node')}`);
  lines.push(`kind: ${scalar(doc.kind, 'kind')}`);
  lines.push(`asked_at: ${scalar(doc.asked_at, 'asked_at')}`);
  lines.push(`question: ${scalar(doc.question, 'question')}`);
  if (doc.context && (doc.context.summary !== null || doc.context.artifacts.length)) {
    lines.push('context:');
    if (doc.context.summary !== null) lines.push(`  summary: ${scalar(doc.context.summary, 'context.summary')}`);
    if (doc.context.artifacts.length) {
      lines.push('  artifacts:');
      for (const artifact of doc.context.artifacts) {
        lines.push(`    - ${scalar(artifact, 'context.artifacts')}`);
      }
    }
  }
  lines.push('options:');
  for (const option of doc.options) {
    lines.push(`  - ${flow(ordered(option, OPTION_KEYS), `options.${option.id}`)}`);
  }
  lines.push(`multi_select: ${doc.multi_select}`);
  lines.push('answer: null');
  return `${lines.join('\n')}\n`;
}

/**
 * The gate index, regenerated whole from the request files on disk.
 *
 * Whole rather than appended for the property the contract wants from it: the
 * index is a mirror, so a run whose index was lost or half-written is repaired
 * by the next request rather than accumulating a second wrong answer. The
 * entries are ordered by file name so two regenerations of the same directory
 * produce the same bytes.
 */
function renderIndex(gates, runDir) {
  let names;
  try {
    names = fs.readdirSync(gates);
  } catch (err) {
    throw new Refusal('gate-unwritable', `${gates} cannot be listed, so the gate index cannot be regenerated: ${err.message}`);
  }
  let unanswered;
  try {
    unanswered = new Set(unansweredRequests(runDir));
  } catch (err) {
    throw new Refusal('gate-unwritable', `${gates} cannot be read back, so the gate index cannot be regenerated: ${err.message}`);
  }

  const lines = ['version: 1'];
  const entries = names
    .filter(name => name.endsWith(REQUEST_SUFFIX))
    .sort()
    .map(name => {
      const node = name.slice(0, -REQUEST_SUFFIX.length);
      const meta = requestMeta(path.join(gates, name));
      return ordered({
        node,
        request: `gates/${name}`,
        kind: meta.kind,
        asked_at: meta.asked_at,
        status: unanswered.has(node) ? 'pending' : 'answered',
      }, ENTRY_KEYS);
    });
  if (!entries.length) return `${lines.concat('entries: []').join('\n')}\n`;
  lines.push('entries:');
  for (const entry of entries) lines.push(`  - ${flow(entry, `entries.${entry.node}`)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * `kind` and `asked_at` out of an existing request file.
 *
 * Deliberately a two-key top-level scan and not a parser: everything that
 * decides anything — whether the request is open, which node it belongs to —
 * comes from the hook's reader and from the file name. These two are carried
 * into the index as a convenience for a reader that wants one place to look,
 * so a file that does not spell them is mirrored without them rather than
 * refusing a write about another node.
 */
function requestMeta(file) {
  const meta = { kind: undefined, asked_at: undefined };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Refusal('gate-unwritable', `${file} cannot be read, so the gate index cannot be regenerated: ${err.message}`);
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const found = /^(kind|asked_at):(.*)$/.exec(line);
    if (!found) continue;
    const value = found[2].trim().replace(/^"(.*)"$/, '$1');
    if (value !== '' && meta[found[1]] === undefined) meta[found[1]] = value;
  }
  return meta;
}

/** A value with its keys in the frozen order, and the absent ones left out. */
function ordered(value, keys) {
  const out = {};
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
