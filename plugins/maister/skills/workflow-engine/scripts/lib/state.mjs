/**
 * The state writer.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. A YAML package is a
 * development dependency of the repository's own tooling and is simply absent
 * in a consumer checkout, which is the first reason this is a line-oriented
 * editor rather than a document round-tripper. The second reason is the one
 * that actually matters: a generic dumper emits block maps, and the readers
 * that guard an operator's session require a frozen one-line form. A dumper
 * would produce valid YAML and a blocked session.
 *
 * So this module locates the four shapes it owns by structural position,
 * replaces or inserts only those regions, and passes every other line through
 * untouched. Unknown keys and comments outside those regions therefore survive
 * by construction rather than by parser fidelity. Inside one of them they do
 * not: `workflow:` is re-emitted whole from the patch, so a comment or an
 * unknown child that block carried is dropped by that write. It is the one
 * region installed rather than edited, and `applyWorkflow` says why.
 *
 * That preservation has one exception, and it is worth stating plainly because
 * it is the opposite of what "line-oriented" suggests. A file this engine
 * already wrote is canonical and every untouched line keeps its own bytes. A
 * file the engine *adopts* — one written by a prose orchestrator or edited by
 * hand — is normalized whole on the first write: the indent walk re-emits every
 * line at the canonical column, and whole-line comments inside the nodes region
 * are relocated above `nodes:`. Content survives; the bytes of an adopted file
 * do not. After that first write the file is canonical and the byte-level
 * guarantee holds for every write after it.
 *
 * Three properties are load-bearing, and each exists because breaking it blocks
 * an operator rather than merely looking wrong:
 *
 *   canonical indent   Two readers consult these files and they are not
 *                      equivalent. The hook's reader derives each block's child
 *                      column from that block's first child; the contract
 *                      suite's reader hardcodes two and four spaces. A file
 *                      written uniformly at another width is read correctly by
 *                      one and read as *empty* by the other, and an empty node
 *                      map beside a present `workflow:` key is exactly what the
 *                      pending predicate treats as a run awaiting an operator.
 *                      Column 0 / 2 / 4 / +2 is the only emission both read
 *                      identically.
 *
 *   never mixed        Emitting a canonical block into a file whose other
 *                      blocks sit at another column is the one thing the hook
 *                      actively rejects. Adoption therefore normalizes the
 *                      whole file or refuses; it never normalizes a part of it.
 *
 *   the oracle         Before renaming, the candidate text goes through the
 *                      hook's own reader, imported rather than approximated.
 *                      The reader has more throw paths than any short list
 *                      captures, and a hand-written copy of it drifts.
 *
 * One whole-file write per invocation, temp-then-rename, and the temp file is
 * named exactly `orchestrator-state.yml.tmp` because the allow-list that lets
 * the engine keep writing while a gate is pending is a list of names, not a
 * glob.
 */

import fs from 'node:fs';
import path from 'node:path';
// The reader lives beside the hooks because the hooks are its other caller. Any
// emitted plugin tree must therefore carry `hooks/gate-lib.mjs` at this path,
// whatever else a build does with the hook registrations.
import { scanState } from '../../../../hooks/gate-lib.mjs';

/** The only temp name the allow-list knows. Not configurable, by contract. */
const TMP_NAME = 'orchestrator-state.yml.tmp';

/**
 * The A1 core-optional top-level blocks the writer reaches by name.
 *
 * These are siblings of `orchestrator:` and of the run's per-workflow context
 * block, never children of either. The contract tolerates a file that nests
 * `project_context` under `task_context` — it reports that shape rather than
 * refusing it — but the writer never produces it: every key here is located and
 * emitted at column 0, so a nested twin an adopted file carries is left where
 * it is and the canonical sibling is written beside it.
 *
 * They are listed separately from the rest of the vocabulary because the suite
 * derives this list from the register and asserts the writer's vocabulary is
 * exactly it plus the four keys below that are not A1 top-level blocks at all.
 */
const TOP_LEVEL_BLOCKS = ['project_context', 'related_tasks', 'verification_context', 'external_research'];

/**
 * The closed patch vocabulary. An unknown key is an error, not a no-op.
 *
 * Four of these name no top-level block: `nodes` edits entries inside
 * `workflow.nodes`, `context` and `phase_summaries` are written into whichever
 * per-workflow context block the run resolves to, and `workflow` and
 * `node_summaries` are the two B1 blocks. Everything else is an A1 top-level
 * block spelled exactly as the contract spells it.
 */
const PATCH_KEYS = ['orchestrator', 'task', 'workflow', 'nodes', 'context', 'phase_summaries', 'node_summaries',
  ...TOP_LEVEL_BLOCKS];

/** Fixed key order inside a one-line node entry. */
const NODE_KEYS = ['kind', 'status', 'started', 'completed', 'needs', 'on', 'values', 'dir', 'provider', 'session'];

/** Fixed key order for the scalars beside `nodes:` in the workflow block. */
const WORKFLOW_KEYS = ['source', 'overlays', 'profile', 'graph_hash', 'grammar_version', 'name'];

/**
 * The status mirror, and it is a mapping rather than a copy: a node carries one
 * of seven statuses, a summary one of five. `suspended` never occurs in
 * terminal mode and `stopped` occurs only on unexecuted nodes, which carry no
 * summary — both are absent here on purpose, so a mirror that cannot be spelled
 * is simply not written.
 */
const STATUS_MIRROR = {
  pending: 'pending',
  running: 'in_progress',
  completed: 'completed',
  skipped: 'skipped',
  failed: 'failed',
};

/** The statuses that make the writer stamp a node's clock fields. */
const STARTS = new Set(['running']);
const ENDS = new Set(['completed', 'failed', 'skipped']);

/** Scalars that YAML would read as something other than a string. */
const RESERVED = /^(?:true|false|yes|no|on|off|null|~)$/i;
const NUMBERISH = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const BARE_FLOW = /^[A-Za-z0-9._/-]+$/;

/**
 * A node id, spelled exactly as `lib/graph.mjs` spells it.
 *
 * The two are kept character-for-character identical on purpose, and the suite
 * compares the two source lines. A writer looser than the graph is the more
 * dangerous half of a disagreement: this is the component that takes arbitrary
 * JSON on stdin, so every id the graph would never produce — `__proto__` among
 * them — reached the file through it.
 */
const NODE_ID = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * A key in a block-map position, at any depth.
 *
 * Block *values* are prose and are quoted onto one line, but a block *key* is
 * emitted raw as `${pad}${key}:` and there is no escape that survives the
 * line-oriented readers. An unguarded key carrying `: ` or a newline does not
 * produce a bad-looking file: it produces extra lines at the emitter's chosen
 * column, and a key like `design: draft` is an ordinary thing for a summary
 * writer to produce. The write would report success, the hook's reader would
 * still find the first `workflow:` block and allow, and the first consumer with
 * a real YAML parser would fail on a duplicate key — a blocked session reached
 * through the success path. So the key is validated, never rewritten.
 */
const BLOCK_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * The nested mappings under `orchestrator:` that merge key by key instead of
 * replacing whole, and the reason each one is on the list rather than an
 * accident of shape.
 *
 * All four are **open maps whose keys are written by different nodes at
 * different times**, which is the whole of the test. `options` is the one that
 * cost a live run: `intake` writes `html_output` and `mockup_format`,
 * `specification` writes `spec_audit_enabled`, `verification-options` writes
 * six more — and a replacing write meant an operator who had deliberately set
 * `html_output: false` silently got the dashboard and every companion report
 * back at the next option write, through the success path. `task_ids`,
 * `auto_fix_attempts` and `skipped_phases` are keyed by phase or node and are
 * filled in the same way, one entry per node as the run reaches it.
 *
 * Everything else under `orchestrator:` replaces, and deliberately:
 *
 *   driver          A closed contract shape (E1), written whole by the engine
 *                   at init and rewritten whole by the daemon. Merged, a write
 *                   demoting a run to `{kind: terminal}` would leave the
 *                   cockpit's `cwd` and `session` standing beside it — a
 *                   combination E1 does not describe and no writer meant.
 *   gate_pending    One contract-shaped value, and the writer already refuses
 *                   every spelling of it but the literal null.
 *   completed_phases, failed_phases
 *                   Sequences. There is no key to merge on; a caller that means
 *                   to append sends the whole list, the same rule
 *                   `related_tasks` follows at the top level.
 *   the scalars     `started_phase`, `created`, `updated`, `task_path`,
 *                   `next_phase`, `type` — one value each, so a write of one is
 *                   a replacement by definition.
 *
 * `task:` carries no open map at all (A1: `title`, `status`, `description`,
 * `tags[]`, `priority`, `key`), so nothing under it merges and the list stays
 * qualified by its section rather than by key alone.
 *
 * A future open map added to A1 must be added here too: the default is to
 * replace, so a mapping absent from this list is replaced silently.
 */
const MERGED_MAPS = new Set([
  'orchestrator.options',
  'orchestrator.task_ids',
  'orchestrator.auto_fix_attempts',
  'orchestrator.skipped_phases',
]);

/**
 * The five per-workflow context blocks (A1 layer 2). The root accepts exactly
 * one, so which one a write means has to be derived rather than assumed.
 */
const CONTEXT_BLOCKS = ['task_context', 'research_context', 'design_context', 'performance_context', 'migration_context'];

/** Workflow name to context block, where the two do not share a stem. */
const WORKFLOW_CONTEXT = {
  research: 'research_context',
  development: 'task_context',
  design: 'design_context',
  'product-design': 'design_context',
  performance: 'performance_context',
  migration: 'migration_context',
};

/**
 * A refusal: the input cannot be written safely. The dispatcher turns it into
 * exit 1, and by the time one is thrown nothing on disk has changed.
 */
class Refusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Apply `patch` to the state file at `state`.
 *
 * Returns `{ok, changed, errors}`. On a refusal `changed` is empty and the file
 * on disk is byte-for-byte what it was: every check that can refuse runs before
 * the rename, and the rename is the only thing that publishes a write.
 */
export function writeState({ state, patch }) {
  const changed = [];
  try {
    checkPatch(patch);
    const doc = readDoc(state);
    // The top-level keys the file already carries, plus the ones this write
    // means to introduce: anything else in the candidate came from a value,
    // and a value that reaches column 0 is an injection.
    const allowed = new Set(topLevelKeys(doc.text()));
    for (const key of apply(doc, patch, changed)) allowed.add(key);
    const text = doc.text();
    selfCheck(text, state, allowed);
    commit(state, text);
    return { ok: true, changed, errors: [] };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, changed: [], errors: [{ code: err.code, message: err.message }] };
    throw err;
  }
}

function checkPatch(patch) {
  if (!isPlainObject(patch)) throw new Refusal('state-patch-invalid', 'the patch must be a JSON object');
  const known = new Set(PATCH_KEYS);
  for (const key of Object.keys(patch)) {
    if (!known.has(key)) {
      throw new Refusal('state-patch-unknown-key',
        `the patch key "${key}" is not one of ${PATCH_KEYS.join(', ')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// applying the patch
// ---------------------------------------------------------------------------

/**
 * The order matters in one place only: `task:` is applied before `workflow:`,
 * because installing a workflow block into a file with no task block is
 * refused, and a patch that creates both in one invocation must be allowed to.
 *
 * Returns the top-level keys this write means to introduce, which is what lets
 * the self-check tell an intended block from an injected one.
 */
function apply(doc, patch, changed) {
  const now = timestamp();
  const intended = new Set(['orchestrator']);

  if (patch.orchestrator) applyScalars(doc, 'orchestrator', patch.orchestrator, changed);
  if (patch.task) {
    applyScalars(doc, 'task', patch.task, changed);
    intended.add('task');
  }
  if (patch.workflow) {
    applyWorkflow(doc, patch.workflow, now, changed);
    intended.add('workflow');
  }
  if (patch.nodes) applyNodes(doc, patch.nodes, now, changed);
  if (patch.context || patch.phase_summaries) {
    // Resolved once, after `workflow:` is in place, so a patch that installs
    // the block and writes its summaries in one invocation resolves from the
    // name it just wrote.
    const block = contextBlock(doc, patch);
    intended.add(block);
    if (patch.context) applyContext(doc, block, patch.context, changed);
    if (patch.phase_summaries) applySummaries(doc, block, patch.phase_summaries, patch.nodes, 'phase', changed);
  }
  if (patch.node_summaries) {
    applySummaries(doc, null, patch.node_summaries, patch.nodes, 'node', changed);
    intended.add('node_summaries');
  }
  for (const key of TOP_LEVEL_BLOCKS) {
    if (!(key in patch)) continue;
    applyTopLevel(doc, key, patch[key], changed);
    intended.add(key);
  }

  // Every write moves the run's clock. Set last so it reflects the whole write
  // rather than the moment the first section was touched.
  const updated = patch.orchestrator && 'updated' in patch.orchestrator ? patch.orchestrator.updated : now;
  doc.set(['orchestrator', 'updated'], [`  updated: ${flow(updated, 'orchestrator.updated')}`]);
  if (!changed.includes('orchestrator.updated')) changed.push('orchestrator.updated');
  return intended;
}

/**
 * Which of the five per-workflow context blocks this write belongs in.
 *
 * The workflow's own name is the answer wherever it can be had — from the patch
 * installing the block, or from the `name:` already beside `workflow.nodes`. A
 * file that carries exactly one of the five and no usable name is read as
 * belonging to that one. Anything else refuses: defaulting would write the
 * summaries into a block no reader of this run consults, which is a successful
 * write nothing can find.
 */
function contextBlock(doc, patch) {
  const raw = patch.workflow && 'name' in patch.workflow ? patch.workflow.name : doc.scalar(['workflow', 'name']);
  const present = CONTEXT_BLOCKS.filter(block => doc.has(block));
  let derived = null;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const name = String(raw).trim().toLowerCase();
    const stem = `${name.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_context`;
    derived = WORKFLOW_CONTEXT[name] ?? (CONTEXT_BLOCKS.includes(stem) ? stem : null);
    if (!derived) {
      throw new Refusal('state-context-block-unknown',
        `the workflow name "${raw}" names none of ${CONTEXT_BLOCKS.join(', ')}, so the context block cannot be derived`);
    }
    if (present.length && !present.includes(derived)) {
      throw new Refusal('state-context-block-unknown',
        `the workflow name "${raw}" derives ${derived} but the state file already carries ${present.join(', ')}, and the root accepts exactly one`);
    }
    return derived;
  }
  if (present.length === 1) return present[0];
  throw new Refusal('state-context-block-unknown',
    present.length
      ? `the state file carries ${present.join(' and ')} and no workflow name, so the context block is ambiguous`
      : 'the state file carries no workflow name and no context block, so the context block cannot be derived');
}

/**
 * The scalars under `orchestrator:` and `task:`, and the four open maps under
 * `orchestrator:` that merge instead (`MERGED_MAPS` says which and why).
 */
function applyScalars(doc, section, values, changed) {
  if (!isPlainObject(values)) throw new Refusal('state-patch-invalid', `the ${section} patch must be an object`);
  for (const [key, value] of Object.entries(values)) {
    // A scalar key is not a node id — `task_path` and `gate_pending` are the
    // shipped spellings — so it is judged by the block-key rule instead, which
    // is the rule that describes what can be emitted raw at column 2.
    if (!BLOCK_KEY.test(key)) {
      throw new Refusal('state-patch-invalid',
        `${JSON.stringify(String(key))} is not a usable key under ${section}:`);
    }
    // Terminal mode never writes the flow-map form of a pending gate, so the
    // only spelling this writer knows is the literal one.
    if (key === 'gate_pending' && value !== null) {
      throw new Refusal('state-gate-pending-form',
        'gate_pending is written only as the literal null; the flow-map form belongs to the driver-led modes');
    }
    if (MERGED_MAPS.has(`${section}.${key}`) && isPlainObject(value)) {
      mergeMap(doc, section, key, value, changed);
      continue;
    }
    doc.set([section, key], [`  ${key}: ${flow(value, `${section}.${key}`)}`]);
    changed.push(`${section}.${key}`);
  }
}

/**
 * One open map under `orchestrator:`, merged key by key.
 *
 * The form the file already uses is the form it keeps, because both are in the
 * wild and both are read: the engine and the fixtures write the one-line flow
 * map, while every state file a prose orchestrator wrote by hand carries a
 * block map — often with a trailing comment saying why an option was set. So a
 * block map is edited child by child, which leaves its other children and their
 * comments on their own bytes, and a flow map is re-emitted on its one line
 * with the keys it already carried kept **verbatim**. Keeping the existing
 * values as raw text rather than re-serialising them is what stops a quoted
 * scalar from being re-quoted, or a nested flow map from being flattened, by a
 * write that never named it.
 *
 * Two shapes are not maps and cannot be merged into: a value that is not a flow
 * map at all (`options: null` is the one that occurs) is replaced, since there
 * are no keys to keep. A value that opens as a flow map and then cannot be read
 * back refuses rather than being replaced — dropping keys the caller cannot see
 * is the defect this function exists to fix, and doing it on a parse failure
 * would be the same loss by another route.
 */
function mergeMap(doc, section, key, value, changed) {
  const where = `${section}.${key}`;
  const entries = Object.entries(value);
  // Guarded before anything is located, so a refusal costs no edit.
  for (const [name] of entries) assertBlockKey(name);

  const found = doc.locate([section, key]);
  if (found && found.inline === '') {
    // Already a block map. An empty patch has nothing to add to it, and
    // rewriting it into the flow form to say so would be a change nobody asked
    // for, so the no-op stays a no-op.
    for (const [name, item] of entries) {
      doc.set([section, key, name], block(name, item, 4));
      changed.push(`${where}.${name}`);
    }
    return;
  }

  const existing = found ? splitFlowMap(found.inline, where) : { entries: [], trailing: '' };
  const merged = new Map(existing ? existing.entries : []);
  for (const [name, item] of entries) merged.set(name, flow(item, `${where}.${name}`));
  const parts = [...merged].map(([name, raw]) => `${name}: ${raw}`);
  doc.set([section, key], [`  ${key}: {${parts.join(', ')}}${existing ? existing.trailing : ''}`]);
  if (!entries.length) changed.push(where);
  for (const [name] of entries) changed.push(`${where}.${name}`);
}

/**
 * The inverse of the flow-map emitter, and only that far: it returns each key
 * with its value as the **raw text the file carries**, never a parsed value.
 * Nothing here needs to know what a value means — the merge replaces the keys
 * the patch names and passes every other one through byte for byte.
 *
 * Returns null when the inline value is not a flow map, so the caller can
 * replace it. Refuses when it opens as one and does not read back: a key that
 * cannot be re-emitted raw is one this writer would have to drop, and dropping
 * keys is the defect, not the recovery.
 */
function splitFlowMap(inline, where) {
  if (!inline.startsWith('{')) return null;
  let depth = 0;
  let quoted = false;
  let end = -1;
  for (let i = 0; i < inline.length && end < 0; i++) {
    const ch = inline[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) end = i;
      else if (depth < 0) break;
    }
  }
  const unreadable = message => {
    throw new Refusal('state-unreadable',
      `${where} is written as "${inline}", which cannot be read back to be merged: ${message}. Repair the line before writing this key again.`);
  };
  if (quoted || end < 0) unreadable('the flow map does not close on its line');
  // Whatever follows the closing brace is a trailing comment and is kept; a
  // second value there is a line this writer did not produce and will not
  // guess at.
  const trailing = inline.slice(end + 1);
  if (trailing.trim() !== '' && !trailing.trimStart().startsWith('#')) {
    unreadable('it carries something other than a comment after the closing brace');
  }
  const entries = [];
  const body = inline.slice(1, end).trim();
  if (body !== '') {
    for (const part of splitTopLevel(body)) {
      const match = /^([A-Za-z0-9._-]+)\s*:\s*(\S[\s\S]*)$/.exec(part.trim());
      if (!match) unreadable(`the entry "${part.trim()}" is not a key and a value this writer can re-emit`);
      entries.push([match[1], match[2].trim()]);
    }
  }
  return { entries, trailing };
}

/** Split on the commas that separate a flow map's own entries, and no others. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Install or replace the whole `workflow:` block. `workflow:` and its `nodes:`
 * child are emitted together, always: a block present without its nodes is read
 * as a run awaiting an operator, which denies every write in the session.
 *
 * This is the one region the writer does not edit in place. The whole block is
 * re-emitted from the patch, so comments inside it and children the patch does
 * not carry are dropped rather than preserved — the module header's
 * preservation guarantee covers every other region, not this one. That is the
 * behaviour the callers want (a workflow block is installed once, from the
 * resolved graph) and it is stated here rather than left to be discovered.
 *
 * Both key loops below emit `  ${key}:` raw, so both run the block-key guard
 * first. Without it a key carrying a newline did not produce a bad-looking
 * file: it produced further lines at the emitter's own column — a second
 * `nodes:` child no YAML parser accepts, and under it a node no graph declared,
 * recorded `completed` and read back by the ready set. Through the success path.
 */
function applyWorkflow(doc, workflow, now, changed) {
  if (!isPlainObject(workflow)) throw new Refusal('state-patch-invalid', 'the workflow patch must be an object');
  const nodes = workflow.nodes;
  if (!isPlainObject(nodes) || Object.keys(nodes).length === 0) {
    throw new Refusal('state-workflow-without-nodes',
      'a workflow block is written only together with a non-empty nodes child');
  }
  if (!doc.has('task')) {
    throw new Refusal('state-workflow-without-task',
      'a workflow block cannot be installed into a state file that has no task block');
  }

  const lines = ['workflow:'];
  for (const key of WORKFLOW_KEYS) {
    if (!(key in workflow)) continue;
    assertBlockKey(key);
    lines.push(`  ${key}: ${flow(workflow[key], `workflow.${key}`)}`);
  }
  for (const key of Object.keys(workflow)) {
    if (key === 'nodes' || WORKFLOW_KEYS.includes(key)) continue;
    assertBlockKey(key);
    lines.push(`  ${key}: ${flow(workflow[key], `workflow.${key}`)}`);
  }
  lines.push('  nodes:');
  for (const [id, entry] of Object.entries(nodes)) {
    lines.push(nodeLine(id, stamp(entry, {}, now)));
    changed.push(`workflow.nodes.${id}`);
  }
  doc.set(['workflow'], lines);
  changed.push('workflow');
}

/**
 * Update node entries in place. Only the entry lines named by the patch move;
 * every other entry keeps its own bytes, which is what makes the preservation
 * guarantee hold on a file the engine adopted rather than wrote.
 */
function applyNodes(doc, nodes, now, changed) {
  if (!isPlainObject(nodes)) throw new Refusal('state-patch-invalid', 'the nodes patch must be an object');
  const region = doc.nodesRegion();
  if (!region) {
    throw new Refusal('state-workflow-without-nodes',
      'the state file carries no workflow.nodes block, so node entries cannot be updated');
  }
  // The existing entries are read with the hook's own reader rather than a
  // second parser written here: one reader, no drift. The reader has more throw
  // paths than a hand-edited file respects, and an uncaught throw here would
  // leave the dispatcher reporting exit 2 with no refusal code on stderr — a
  // caller told to read the first token would read `workflow:`.
  let existing;
  try {
    existing = scanState(doc.text()).nodes;
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }

  for (const [id, patchEntry] of Object.entries(nodes)) {
    if (!NODE_ID.test(id)) throw new Refusal('state-patch-invalid', `"${id}" is not a usable node id`);
    if (!isPlainObject(patchEntry)) {
      throw new Refusal('state-patch-invalid', `the patch for node ${id} must be an object`);
    }
    const merged = stamp(patchEntry, existing[id] ?? {}, now);
    doc.setNode(id, serializeNode(id, merged, patchEntry, now));
    changed.push(`workflow.nodes.${id}`);
  }
}

/**
 * One merged entry, with the two faults told apart.
 *
 * A value the reader accepted but the writer cannot re-emit — an embedded quote
 * survives the reader's outer-pair unquoter and comes back as an unwritable
 * string — is a property of the *file*, not of the patch. Reporting it as
 * `value-not-flow-safe` sends the caller down a recovery that records the node
 * failed and writes again, which hits the same entry and refuses again: a loop.
 * So the patch is serialised alone to see which side the fault is on.
 */
function serializeNode(id, merged, patchEntry, now) {
  try {
    return nodeLine(id, merged);
  } catch (err) {
    if (!(err instanceof Refusal) || err.code !== 'value-not-flow-safe') throw err;
    try {
      nodeLine(id, stamp(patchEntry, {}, now));
    } catch {
      throw err;
    }
    throw new Refusal('state-entry-unserializable',
      `the entry already in the file for node ${id} cannot be re-serialised (${err.message}); the patch itself is fine, so the line has to be repaired before this node can be written`);
  }
}

/**
 * The clock fields a status change owes, filled from the system clock and never
 * invented for a transition that did not happen. A full UTC date and time, so
 * `started` and `completed` are orderable against each other.
 */
function stamp(patchEntry, existing, now) {
  const merged = { ...existing, ...patchEntry };
  if (!merged.status) merged.status = 'pending';
  const status = String(merged.status);
  if (STARTS.has(status) && !merged.started) merged.started = now;
  if (ENDS.has(status) && !merged.completed) merged.completed = now;
  return merged;
}

/** One node entry, on exactly one line, in the frozen key order. */
function nodeLine(id, entry) {
  if (!NODE_ID.test(id)) throw new Refusal('state-patch-invalid', `"${id}" is not a usable node id`);
  const fields = [];
  const emit = key => {
    const value = entry[key];
    if (value === undefined || value === null) return;
    // The field name is emitted raw inside the flow map, exactly as a nested
    // flow-map key is, so it is judged by the same rule. Unguarded, a field
    // named `x}, forged: {` closes the entry and opens another one.
    assertFlowKey(key, `workflow.nodes.${id}`);
    fields.push(`${key}: ${flow(value, `workflow.nodes.${id}.${key}`)}`);
  };
  for (const key of NODE_KEYS) emit(key);
  // Anything the engine does not know about is kept rather than dropped: a
  // future field written by a newer build must survive an older one's write.
  for (const key of Object.keys(entry)) if (!NODE_KEYS.includes(key)) emit(key);
  return `    ${id}: {${fields.join(', ')}}`;
}

/**
 * One A1 core-optional top-level block.
 *
 * A mapping is merged key by key, so a write that records `fixes_applied` does
 * not drop a `reverify_count` the block already carried — the same rule the
 * per-workflow context block follows, and the reason the verifier can read one
 * key back after another node wrote the other. A sequence — `related_tasks` is
 * the only one the contract shapes that way — has no key to merge on, so it
 * replaces the block whole; a caller that means to append sends the whole list.
 *
 * Every child is emitted through `block`, which is the same emitter the context
 * keys and the summary maps use: canonical two-space steps, one line per
 * scalar, no block scalars, and the key guard on every level of the recursion.
 * Nothing here is consulted by the enforcement hook's reader, which looks only
 * at `task:`, `workflow:`, `workflow.nodes` and `orchestrator.gate_pending` —
 * but the reader still has to *parse past* these lines, so they are emitted at
 * column 0 with their children at column 2 like every other block, and the
 * pre-publish self-check runs the candidate through it either way.
 */
function applyTopLevel(doc, key, value, changed) {
  if (Array.isArray(value)) {
    doc.set([key], block(key, value, 0));
    changed.push(key);
    return;
  }
  if (!isPlainObject(value)) {
    throw new Refusal('state-patch-invalid',
      `the ${key} patch must be an object or an array`);
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    doc.set([key], block(key, value, 0));
    changed.push(key);
    return;
  }
  for (const [name, item] of entries) {
    doc.set([key, name], block(name, item, 2));
    changed.push(`${key}.${name}`);
  }
}

/** Free-form keys under the run's context block, beside `phase_summaries:`. */
function applyContext(doc, contextKey, context, changed) {
  if (!isPlainObject(context)) throw new Refusal('state-patch-invalid', 'the context patch must be an object');
  for (const [key, value] of Object.entries(context)) {
    doc.set([contextKey, key], block(key, value, 2));
    changed.push(`${contextKey}.${key}`);
  }
}

/**
 * The two summary maps. Both are block maps and both are outside every
 * flow-map rule: prose belongs here, and nowhere near a node entry.
 *
 * `status` on a summary is the five-member vocabulary, so a status arriving
 * alongside a node patch in the same invocation is *mapped* rather than copied.
 * A `phase_summaries` entry mirrors only when it names the node it belongs to,
 * because its key is a phase key and the two namespaces do not line up.
 */
function applySummaries(doc, contextKey, summaries, nodePatch, kind, changed) {
  if (!isPlainObject(summaries)) throw new Refusal('state-patch-invalid', `the ${kind} summaries must be an object`);
  for (const [key, value] of Object.entries(summaries)) {
    if (!isPlainObject(value)) throw new Refusal('state-patch-invalid', `the summary ${key} must be an object`);
    const entry = { ...value };
    if (!('status' in entry)) {
      const nodeId = kind === 'node' ? key : entry.node;
      const nodeStatus = nodeId && nodePatch ? nodePatch[nodeId]?.status : undefined;
      const mirrored = nodeStatus ? STATUS_MIRROR[String(nodeStatus)] : undefined;
      if (mirrored) entry.status = mirrored;
    }
    const at = kind === 'node' ? ['node_summaries', key] : [contextKey, 'phase_summaries', key];
    doc.set(at, block(key, entry, kind === 'node' ? 2 : 4));
    changed.push(at.join('.'));
  }
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/**
 * A value in a flow-map position.
 *
 * The refusal is the last line of defence behind the declared-output rule: the
 * reader's quote scanner toggles on every `"` with no escape awareness and its
 * unquoter strips only the outer pair, so one embedded quote corrupts the whole
 * line — and the corruption throws, which is a blocked session rather than a
 * bad-looking file.
 */
function flow(value, where) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Refusal('value-not-flow-safe', `${where} is not a finite number`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => flow(item, where)).join(', ')}]`;
  if (isPlainObject(value)) {
    const parts = Object.entries(value).map(([key, item]) => {
      assertFlowKey(key, where);
      return `${key}: ${flow(item, `${where}.${key}`)}`;
    });
    return `{${parts.join(', ')}}`;
  }

  const text = String(value);
  if (/["\n\r]/.test(text)) {
    throw new Refusal('value-not-flow-safe',
      `${where} carries a quote, a newline or a carriage return, which the one-line reader cannot parse`);
  }
  // A value already spelled as a balanced flow collection is passed through:
  // this is how a `needs` or a `values` read back out of an existing entry
  // keeps its own shape instead of being re-quoted into a scalar.
  if (isBalancedFlow(text)) return text;
  if (BARE_FLOW.test(text) && !RESERVED.test(text) && !NUMBERISH.test(text)) return text;
  return `"${text}"`;
}

/**
 * A key in a flow-map position — a nested map inside a value, and a field name
 * inside a node entry. Both are emitted raw between the braces, so both obey
 * the one rule. Reported as `value-not-flow-safe` because that is the code the
 * entry serializer already tells apart from a fault in the file.
 */
function assertFlowKey(key, where) {
  if (!BLOCK_KEY.test(key)) {
    throw new Refusal('value-not-flow-safe',
      `${where}.${JSON.stringify(String(key))} is not a usable flow-map key`);
  }
}

function isBalancedFlow(text) {
  if (!/^[[{]/.test(text)) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * A block-position value: `node_summaries`, `phase_summaries` and the free-form
 * context keys. Prose is welcome here, so a string that would confuse a reader
 * is quoted and escaped onto one line rather than refused — the double-quoted
 * form YAML and JSON share means no block scalar is ever emitted, which is also
 * what keeps the file re-indentable later.
 */
function block(key, value, indent) {
  assertBlockKey(key);
  const pad = ' '.repeat(indent);
  if (value === undefined || value === null || typeof value !== 'object') {
    return [`${pad}${key}: ${blockScalar(value)}`];
  }
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}${key}: []`];
    const lines = [`${pad}${key}:`];
    for (const item of value) lines.push(...blockItem(item, indent + 2));
    return lines;
  }
  const entries = Object.entries(value);
  if (!entries.length) return [`${pad}${key}: {}`];
  const lines = [`${pad}${key}:`];
  for (const [name, item] of entries) lines.push(...block(name, item, indent + 2));
  return lines;
}

function blockItem(item, indent) {
  const pad = ' '.repeat(indent);
  if (item === undefined || item === null || typeof item !== 'object') return [`${pad}- ${blockScalar(item)}`];
  if (Array.isArray(item)) {
    if (!item.length) return [`${pad}- []`];
    const lines = [`${pad}-`];
    for (const nested of item) lines.push(...blockItem(nested, indent + 2));
    return lines;
  }
  const entries = Object.entries(item);
  if (!entries.length) return [`${pad}- {}`];
  const lines = [];
  // Guarded here as well as in `block`, so the recursion has no level at which
  // an unchecked key could reach an emitter.
  for (const [name] of entries) assertBlockKey(name);
  entries.forEach(([name, value], index) => {
    const sub = block(name, value, indent + 2);
    if (index === 0) sub[0] = `${pad}- ${sub[0].trimStart()}`;
    lines.push(...sub);
  });
  return lines;
}

/**
 * The guard. A key that cannot be emitted raw is refused rather than quoted:
 * the region locator finds a block by the literal prefix `<key>:`, so a quoted
 * key would be written and then never found again.
 */
function assertBlockKey(key) {
  if (!BLOCK_KEY.test(key)) {
    throw new Refusal('state-patch-invalid',
      // JSON-quoted so a key carrying a newline cannot spread the refusal over
      // several stderr lines, where the caller reads the first token as a code.
      `${JSON.stringify(String(key))} is not a usable block key; a block key is letters, digits, dot, dash and underscore only`);
  }
}

function blockScalar(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  const text = String(value);
  const risky = text === '' || /[:#"'\n\r\t]/.test(text) || /^[-?,[\]{}&*!|>%@`]/.test(text)
    || text !== text.trim() || RESERVED.test(text) || NUMBERISH.test(text);
  return risky ? JSON.stringify(text) : text;
}

/** A full UTC date and time from the system clock. Never date-only. */
function timestamp() {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------

/**
 * Read the file into lines, stripping `\r` so a checkout that carried CRLF
 * through a Windows editor is handled explicitly rather than by accident, and
 * normalizing the indent when the file was not written by this engine.
 *
 * A file that does not exist yet is an empty document: the engine writes the
 * whole state at initialization, and that write goes through exactly the same
 * refusals and the same self-check as every later one.
 */
function readDoc(state) {
  let raw = '';
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Refusal('state-unreadable', `${state} cannot be read: ${err.message}`);
  }
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return new Doc(adopt(lines));
}

/**
 * The adoption ladder's third, fourth and fifth steps.
 *
 * A file this engine wrote is already canonical and comes back untouched, which
 * is the normal case and costs one walk. A file written by something else is
 * re-indented whole — leading whitespace and nothing else — and its comments
 * inside the nodes region are hoisted above `nodes:`, because the two readers
 * disagree about a comment there: one skips it at any indent, the other only at
 * column 0, where it then matches the entry pattern, fails the entry regex and
 * throws.
 *
 * A line the walk cannot re-indent safely makes the whole write refuse. A
 * partial normalization is exactly the mixed file this rule exists to prevent,
 * so guessing is not an alternative.
 */
function adopt(lines) {
  const walked = reindent(lines);
  const hoisted = hoistNodeComments(walked.lines);
  const same = hoisted.length === lines.length && hoisted.every((line, i) => line === lines[i]);
  if (same) return lines;
  if (walked.unsafe.length) {
    throw new Refusal('state-non-canonical',
      `the state file cannot be re-indented safely: ${walked.unsafe[0]}`);
  }
  return hoisted;
}

/**
 * The indent-depth walk. Each line's depth is its position in the stack of
 * enclosing indents, and it is re-emitted at two spaces per depth. Comments do
 * not open a level: one at column 0 stays there, and one inside a block follows
 * the block.
 */
function reindent(lines) {
  const out = [];
  const stack = [];
  const unsafe = [];
  for (const line of lines) {
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    if (/^[ ]*\t/.test(line)) unsafe.push('a tab-indented line');
    const body = line.trimStart();
    const indent = line.length - body.length;

    if (body.startsWith('#')) {
      out.push(indent === 0 ? body : `${'  '.repeat(Math.max(stack.length - 1, 0))}${body}`);
      continue;
    }

    let popped = false;
    while (stack.length && indent < stack[stack.length - 1]) {
      stack.pop();
      popped = true;
    }
    if (!stack.length) {
      if (indent !== 0) unsafe.push(`an indent of ${indent} with no block enclosing it`);
      stack.push(indent);
    } else if (indent > stack[stack.length - 1]) {
      if (popped) unsafe.push(`an inconsistent indent step at "${body.slice(0, 40)}"`);
      stack.push(indent);
    }

    const value = valueOf(body);
    if (value !== null && /^[|>][0-9+-]*$/.test(value)) unsafe.push('a block scalar');
    if (!balanced(body)) unsafe.push('a flow construct continued across lines');

    out.push(`${'  '.repeat(stack.length - 1)}${body}`);
  }
  return { lines: out, unsafe };
}

const KEY_LINE = /^(?:"[^"]*"|'[^']*'|[^:#]+?)\s*:(?:\s+(.*))?$/;

function valueOf(body) {
  const match = KEY_LINE.exec(body);
  if (!match) return null;
  return match[1] === undefined ? null : match[1].trim();
}

function balanced(body) {
  let depth = 0;
  let quoted = false;
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '{' || ch === '[')) depth++;
    else if (!quoted && (ch === '}' || ch === ']')) depth--;
  }
  return depth === 0 && !quoted;
}

/** Move every whole-line comment out of the nodes region, above `nodes:`. */
function hoistNodeComments(lines) {
  const out = [];
  const hoisted = [];
  let nodesAt = -1;
  let section = null;
  let inNodes = false;

  for (const line of lines) {
    const body = line.trimStart();
    if (/^[A-Za-z_]/.test(line)) {
      section = line.split(':')[0];
      inNodes = false;
    } else if (section === 'workflow' && /^ {2}[^\s#]/.test(line)) {
      inNodes = line.startsWith('  nodes:');
      if (inNodes) nodesAt = out.length;
    } else if (inNodes && body.startsWith('#')) {
      hoisted.push(`  ${body}`);
      continue;
    }
    out.push(line);
  }

  if (!hoisted.length) return out;
  out.splice(nodesAt, 0, ...hoisted);
  return out;
}

/**
 * The line-oriented editor. Every mutation replaces or inserts one contiguous
 * region and leaves every other line exactly as it found it.
 */
class Doc {
  constructor(lines) {
    this.lines = lines;
  }

  text() {
    return `${this.lines.join('\n')}\n`;
  }

  has(key) {
    return this.locate([key]) !== null;
  }

  /** The inline scalar at a dotted key, unquoted, or null. */
  scalar(keys) {
    const found = this.locate(keys);
    if (!found || found.inline === '') return null;
    const value = found.inline;
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      return value.slice(1, -1);
    }
    return value;
  }

  /**
   * The region a dotted key occupies: its header line and everything indented
   * below it, ending at the next line at or above its own column.
   */
  locate(keys) {
    let start = 0;
    let end = this.lines.length;
    let indent = 0;
    let found = null;
    for (const key of keys) {
      found = this.find(start, end, indent, key);
      if (!found) return null;
      start = found.start + 1;
      end = found.end;
      indent += 2;
    }
    return found;
  }

  find(start, end, indent, key) {
    const prefix = `${' '.repeat(indent)}${key}:`;
    for (let i = start; i < end; i++) {
      const line = this.lines[i];
      if (line !== prefix && !line.startsWith(`${prefix} `)) continue;
      let stop = i + 1;
      while (stop < end) {
        const next = this.lines[stop];
        if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break;
        stop++;
      }
      // Trailing blank lines belong to whatever comes next, not to this region.
      while (stop > i + 1 && this.lines[stop - 1].trim() === '') stop--;
      return { start: i, end: stop, inline: line.slice(prefix.length).trim() };
    }
    return null;
  }

  /**
   * Replace the region a dotted key occupies with `lines`, creating every
   * missing container along the way.
   */
  set(keys, lines) {
    let start = 0;
    let end = this.lines.length;
    let indent = 0;
    for (let depth = 0; depth < keys.length; depth++) {
      const key = keys[depth];
      const last = depth === keys.length - 1;
      let found = this.find(start, end, indent, key);

      if (last) {
        if (found) this.splice(found.start, found.end, lines);
        else this.insert(start, end, indent, lines);
        return;
      }

      if (!found) {
        this.insert(start, end, indent, [`${' '.repeat(indent)}${key}:`]);
        found = this.find(start, this.lines.length, indent, key);
      } else if (found.inline !== '') {
        // A container written inline — `node_summaries: {}` is the shape the
        // template ships — has to become a block map before anything can be
        // put inside it. Anything other than an empty collection would lose
        // content, so it refuses instead.
        if (found.inline !== '{}' && found.inline !== '[]') {
          throw new Refusal('state-inline-collection',
            `${keys.slice(0, depth + 1).join('.')} is written inline as "${found.inline}" and cannot be extended`);
        }
        this.lines[found.start] = `${' '.repeat(indent)}${key}:`;
      }
      start = found.start + 1;
      end = found.end;
      indent += 2;
      // The region grew or shrank under us; re-derive its end.
      const again = this.find(found.start, this.lines.length, indent - 2, key);
      end = again ? again.end : end;
    }
  }

  splice(start, end, lines) {
    this.lines.splice(start, end - start, ...lines);
  }

  /** Append inside a region, before the blank lines that separate it. */
  insert(start, end, indent, lines) {
    let at = Math.max(start, Math.min(end, this.lines.length));
    while (at > start && this.lines[at - 1].trim() === '') at--;
    if (indent === 0 && at > 0 && this.lines[at - 1].trim() !== '') this.lines.splice(at++, 0, '');
    this.lines.splice(at, 0, ...lines);
  }

  /** The half-open line range of the `workflow.nodes` entries, or null. */
  nodesRegion() {
    const found = this.locate(['workflow', 'nodes']);
    if (!found) return null;
    return { header: found.start, start: found.start + 1, end: found.end };
  }

  /** Replace one node entry line, or append it to the end of the region. */
  setNode(id, line) {
    const region = this.nodesRegion();
    const prefix = `    ${id}:`;
    for (let i = region.start; i < region.end; i++) {
      const current = this.lines[i];
      if (current === prefix || current.startsWith(`${prefix} `) || current.startsWith(`${prefix}  `)) {
        this.lines[i] = line;
        return;
      }
    }
    this.lines.splice(region.end, 0, line);
  }
}

// ---------------------------------------------------------------------------
// the self-check and the rename
// ---------------------------------------------------------------------------

/**
 * Run the candidate text through the hook's own reader before anything is
 * published, and assert the three flags and the non-empty node map on top.
 *
 * The last of those is the one that is easy to mistake for decoration. A
 * present `workflow:` key beside a node map the reader sees as empty satisfies
 * the pending predicate, so the run is classified as awaiting an operator and
 * every write outside the allow-list is denied. A silently empty node map is
 * not a bad read; it is a blocked session.
 */
function selfCheck(text, state, allowed) {
  let scanned;
  try {
    scanned = scanState(text);
  } catch (err) {
    throw new Refusal('state-unreadable', `the candidate ${state} would not read back: ${err.message}`);
  }
  structureCheck(text, allowed);
  if (!scanned.hasTask) throw new Refusal('state-incomplete', 'the candidate carries no task block');
  if (!scanned.hasWorkflow) throw new Refusal('state-incomplete', 'the candidate carries no workflow block');
  if (!scanned.hasNodes) throw new Refusal('state-incomplete', 'the candidate carries no workflow.nodes block');
  if (Object.keys(scanned.nodes).length === 0) {
    throw new Refusal('state-incomplete', 'the candidate reads back with an empty node map, which denies the session');
  }
}

/**
 * The structural assertion the oracle cannot make.
 *
 * The hook's reader answers one question — is this run awaiting an operator —
 * and it answers it from the *first* `workflow:` block it meets. A write that
 * appends a second one therefore reads back clean and still breaks every
 * consumer with a real YAML parser, which rejects a duplicate key outright.
 * There is no YAML reader available here to ask (the package is a development
 * dependency of the repository, absent in a consumer checkout), so the check is
 * structural instead: a candidate carries each top-level key once, and carries
 * no top-level key that neither the file nor this write put there. Both
 * failures mean a value escaped its position, which is corruption whatever the
 * value was.
 */
function structureCheck(text, allowed) {
  const seen = new Set();
  for (const key of topLevelKeys(text)) {
    if (seen.has(key)) {
      throw new Refusal('state-candidate-unsound',
        `the candidate carries the top-level key "${key}" twice, which no YAML reader accepts`);
    }
    seen.add(key);
    if (allowed && !allowed.has(key)) {
      throw new Refusal('state-candidate-unsound',
        `the candidate carries the top-level key "${key}", which neither the existing file nor this patch introduced`);
    }
  }
  siblingCheck(text);
}

/**
 * The same assertion, at every column rather than only at column 0.
 *
 * Column 0 was where the first injection landed and it is not where the class
 * lives: a key emitted raw at column 2 can open a second `nodes:` child under
 * `workflow:`, and that file reads back clean through both line readers — one
 * takes the first `nodes:` it meets — while carrying a node no graph ever
 * declared. The duplicate is the signature, whatever the column: a mapping
 * whose sibling keys repeat is rejected by every real parser, so a candidate
 * that shows one is corrupt however it got that way.
 *
 * A sequence item opens a mapping of its own, which is why `- ` resets the
 * scope at the item's column instead of merging every item's keys together.
 */
function siblingCheck(text) {
  const stack = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const body = line.trimStart();
    if (body === '' || body.startsWith('#')) continue;

    let column = line.length - body.length;
    let rest = body;
    if (rest === '-' || rest.startsWith('- ')) {
      const itemColumn = column + 2;
      while (stack.length && stack[stack.length - 1].column >= itemColumn) stack.pop();
      stack.push({ column: itemColumn, keys: new Set() });
      rest = rest.slice(1).trimStart();
      column = itemColumn;
      if (rest === '') continue;
    } else {
      while (stack.length && stack[stack.length - 1].column > column) stack.pop();
    }

    const match = /^("[^"]*"|'[^']*'|[^:#\s][^:#]*?)\s*:(?:\s|$)/.exec(rest);
    if (!match) continue;
    if (!stack.length || stack[stack.length - 1].column < column) stack.push({ column, keys: new Set() });
    const scope = stack[stack.length - 1];
    const key = match[1];
    if (scope.keys.has(key)) {
      throw new Refusal('state-candidate-unsound',
        `the candidate carries the key "${key}" twice at column ${column}, which no YAML reader accepts`);
    }
    scope.keys.add(key);
  }
}

/** The keys at column 0, in file order, duplicates included. */
function topLevelKeys(text) {
  const keys = [];
  for (const raw of text.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(raw.replace(/\r$/, ''));
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** One whole-file write, temp-then-rename, under the one allow-listed name. */
function commit(state, text) {
  const target = path.resolve(state);
  const tmp = path.join(path.dirname(target), TMP_NAME);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Exclusive, with a stale leftover reclaimed rather than refused forever —
  // see `openTemp`, which carries the reasoning and the age rule.
  let fd;
  try {
    fd = openTemp(tmp);
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new Refusal('state-unwritable', `${state} could not be written: ${err.message}`);
  }

  try {
    fs.writeFileSync(fd, text, 'utf8');
    // The rename is atomic against a concurrent reader; without this it is not
    // atomic against a crash, which is the case the docstring claims.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is being abandoned either way.
      }
    }
    // Only the temp this call created is removed — never one another writer holds.
    fs.rmSync(tmp, { force: true });
    throw new Refusal('state-unwritable', `${state} could not be written: ${err.message}`);
  }
}

/**
 * How old a temp file has to be before it is a crashed writer's leftover
 * rather than a live writer's working file. A write is a whole-file
 * `writeFileSync`, one `fsync` and a rename — milliseconds — so a minute is
 * three orders of magnitude past any writer that is still running.
 */
const STALE_TEMP_MS = 60_000;

/**
 * The exclusive open, with the recovery that makes it survivable.
 *
 * Exclusivity is what stops two writers publishing one set of bytes under two
 * sets of reported changes, and the temp name is frozen by contract, so it has
 * to come from the open rather than from a unique name. Left alone, that turns
 * a process killed between the open and the rename into a permanent refusal —
 * and the moment a long turn is most likely to be cut is a gate answer, which
 * is exactly when the operator has no tool that can delete the leftover: the
 * enforcement hook denies Bash, and an editor tool can write the allow-listed
 * temp name but not remove it, and rewriting it does not clear EEXIST.
 *
 * So the recovery is in-band. A temp younger than a minute belongs to a live
 * writer and is never touched; an older one is a leftover and is reclaimed.
 * That is safe because publishing is one rename of a whole, fsynced file:
 * nothing reads the temp, and no write is ever partially applied from it.
 */
function openTemp(tmp) {
  try {
    return fs.openSync(tmp, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let age;
    try {
      age = Date.now() - fs.statSync(tmp).mtimeMs;
    } catch {
      // It vanished between the open and the stat: the writer that held it
      // finished. Take the retry, and let a second EEXIST refuse normally.
      age = 0;
    }
    if (age < STALE_TEMP_MS) {
      throw new Refusal('state-temp-exists',
        `${tmp} already exists and is less than a minute old, so another writer holds it — a write takes milliseconds. Nothing was written; run the same write again in a minute, and if the temp is still there it is a crashed writer's leftover and this write reclaims it.`);
    }
    fs.rmSync(tmp, { force: true });
    try {
      return fs.openSync(tmp, 'wx');
    } catch (retry) {
      if (retry.code !== 'EEXIST') throw retry;
      throw new Refusal('state-temp-exists',
        `${tmp} was reclaimed as stale and immediately taken by another writer. Nothing was written; run the same write again.`);
    }
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
