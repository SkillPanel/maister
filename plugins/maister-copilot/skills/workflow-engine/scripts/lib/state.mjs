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
 * not: `workflow:` is emitted whole from the freeze patch, so it carries only
 * what that patch carried, and a later patch is refused unless identical to it.
 * It is the one region installed rather than edited, and `applyWorkflow` says why.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
// The reader lives beside the hooks because the hooks are its other caller. Any
// emitted plugin tree must therefore carry `hooks/gate-lib.mjs` at this path,
// whatever else a build does with the hook registrations.
import { scanState } from '../../../../hooks/gate-lib.mjs';
// E2 makes `gate_pending: null` the commit point of a decision, so this module
// is the one that learns a gate was answered. The index has to learn it here
// too: regenerating it only when the *next* gate is asked left every run's
// final gate reading `pending` forever. The renderer is a separate module
// because `gate.mjs` imports this one, and importing it back would be a cycle.
import { refreshIndex, REQUEST_SUFFIX } from './gate-index.mjs';
// The one state reader. This module carried a private `isPlainObject` until the
// reader was extracted; two copies of the same predicate is the drift that
// extraction removed.
import { isPlainObject, parse as parseState } from './state-read.mjs';
// The projection. It is imported here and not the other way round: `dashboard.mjs`
// is pure and knows nothing of this module, which is what keeps the edge acyclic
// and the renderer golden-file testable.
import * as dashboard from './dashboard.mjs';
// `readDefinition` and `locateWorkflow` are imported rather than re-derived for
// the reason `locateWorkflow` is exported at all: the prose resolved four homes
// while the code tested one, and a second copy of that resolution rule here would
// make a workspace eject invisible to the projection and decisive at run time.
import { KNOWN_VERSION, readDefinition } from './definition.mjs';
import { TARGET_NAME, foldDefinition, locateWorkflow, resolve as resolveGraph } from './graph.mjs';
import { displayOf } from './display.mjs';
// The write primitives are shared with the umbrella writer, so they live beside
// `hooks/` at the plugin root rather than in this skill's `scripts/lib/` — the
// same depth as the reader above, and `build.sh` copies both unmodified. The
// namespace form is deliberate: `canonical.stamp()` cannot be confused with the
// local `stamp()` a few hundred lines down, which fills a node's clock fields.
import * as canonical from '../../../../lib/canonical.mjs';
const { Refusal, flow } = canonical;

/**
 * This writer's own names for the two refusals the shared publish path can
 * raise. They are passed in rather than emitted by `canonical.mjs` so this
 * module keeps its closed twenty-four-code vocabulary, which the contract suite
 * reads back out of the refusals themselves.
 */
const COMMIT_CODES = { unwritable: 'state-unwritable', tempExists: 'state-temp-exists' };

/** The only temp name the allow-list knows. Not configurable, by contract. */
const TMP_NAME = 'orchestrator-state.yml.tmp';

/** Reported among `changed` when a decision closes the run's gate index. */
const GATE_INDEX = 'gates/index.yml';

/**
 * The projection's two file names, frozen for the same reason `TMP_NAME` is: the
 * allow-list that lets the engine keep writing while a gate is pending is a list
 * of names, not a glob (ADR-0012). Both dashboard files are engine-owned, and
 * `dashboard-data.js.tmp` exists only inside this module's publish.
 *
 * A temp left behind by a killed writer heals itself: the shared publish path
 * reclaims one older than `canonical.STALE_TEMP_MS`, or stamped in the future,
 * on the next write. Only a temp younger than that is refused — it may belong
 * to a projector still running — and that refusal is a one-write warning, not
 * a disabled projection. A more eager unlink would race exactly that writer.
 */
const DASHBOARD = 'dashboard-data.js';
const DASHBOARD_TMP = 'dashboard-data.js.tmp';

/**
 * The dashboard viewer and where it ships: the plugin's own copy, found from
 * this module's location so every install of the plugin — either variant —
 * copies the page it was built with.
 */
const VIEWER = 'dashboard.html';
const VIEWER_SOURCE = fileURLToPath(new URL('../../../orchestrator-framework/assets/dashboard.html', import.meta.url));

/**
 * The two refusals the shared publish path can raise while publishing the
 * projection — injected exactly as `COMMIT_CODES` is, and **never leaving this
 * module as refusals**.
 *
 * They are caught at the projection call site and turned into warning entries,
 * because the projection runs *after* the state rename: a refusal there could not
 * un-publish the state write and reporting one would turn a landed write into a
 * reported failure. So the writer's documented twenty-four-code vocabulary does not
 * grow and neither code is owed a recovery row.
 */
const DASHBOARD_CODES = { unwritable: 'dashboard-unwritable', tempExists: 'dashboard-temp-exists' };

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

/**
 * Fixed key order inside a one-line node entry. `attempt` and `reruns` are
 * written only where they mean something — a node a revise has reset, a gate
 * that offers a revise — so every other line keeps the bytes it always had.
 */
const NODE_KEYS = ['kind', 'status', 'attempt', 'started', 'completed', 'needs', 'reruns', 'on', 'values', 'dir',
  'provider', 'session'];

/**
 * The node fields only this writer fills: `attempt` counts the revisions a
 * node has been reset by, and `reruns` is the freeze's record of where each of
 * a gate's revise options sends the run. A patch that carries either has them
 * dropped and noted, like a clock field — a counter a caller could set is a
 * budget a caller could reset.
 */
const WRITER_FIELDS = ['attempt', 'reruns'];

/**
 * The statuses a node is never sent back to `pending` from by an ordinary
 * write. Every one of them records something that happened; `pending` records
 * that nothing has. Going `running` again is a re-drive and keeps its record in
 * the new clock; going `pending` is only ever a revise, which records why.
 */
const RECORDED_ENDS = new Set(['completed', 'failed', 'skipped', 'stopped']);

/** Fixed key order for the scalars beside `nodes:` in the workflow block. */
const WORKFLOW_KEYS = ['source', 'overlays', 'profile', 'graph_hash', 'grammar_version', 'name'];

/**
 * The status mirror, and it is a mapping rather than a copy: a node carries one
 * of eight statuses, a summary one of five. `suspended` is the only one absent
 * on purpose: it never occurs in terminal mode, so a mirror that cannot be
 * spelled is simply not written.
 *
 * `waiting` — a parent node whose child run is still going — mirrors to
 * `in_progress`, because that is what it is in the shorter phase vocabulary.
 * Left out, a `nodes` patch carrying `status: waiting` would write no summary
 * mirror at all: a node that changed state with nothing in the summary saying
 * so. It stamps neither end, for the reason the two sets below give.
 *
 * `stopped` used to occur only on nodes a stop option left unexecuted, which
 * carry no summary, and it was left out on those grounds. Sub-runs made that
 * false: a `workflow:` node that ran, waited and then saw its child stop is
 * recorded `stopped`, and the write that adopts the outcome carries a summary
 * for it. It mirrors to `skipped`, the one member of the shorter vocabulary
 * that says "did not produce its outcome, and not because anything broke" — a
 * stop is a legitimate outcome and `failed` would read as the `RUN-FAILED` the
 * engine deliberately does not print. A stopped unexecuted node still writes no
 * summary; nothing about that changes by giving the status a spelling here.
 */
const STATUS_MIRROR = {
  pending: 'pending',
  running: 'in_progress',
  waiting: 'in_progress',
  completed: 'completed',
  skipped: 'skipped',
  failed: 'failed',
  stopped: 'skipped',
};

/**
 * The statuses that make the writer stamp a node's clock fields.
 *
 * `waiting` is in neither set on purpose: `started` was stamped when the node
 * went `running`, and `completed` is stamped when the child run ends. A
 * `waiting` stamp would record the node as finished while it is still waiting.
 *
 * `ONGOING` is what a node can be while its `started` still describes the
 * attempt in progress. Going `running` from anything else is a new attempt —
 * a first start or a re-drive — and gets a new clock.
 */
const STARTS = new Set(['running']);
const ENDS = new Set(['completed', 'failed', 'skipped']);

/**
 * The eight statuses a node may be recorded with — the state contract's own
 * node-status enum, closed here for the reason the patch vocabulary is closed.
 * A status outside it was written to disk and projected as `pending`, so a node
 * recorded `done` or `in_progress` read, to every reader, as a node that had
 * never started — and nothing downstream of it could become ready.
 */
const NODE_STATUSES = ['pending', 'running', 'waiting', 'suspended', 'completed', 'skipped', 'failed', 'stopped'];
const ONGOING = new Set(['running', 'waiting', 'suspended']);

/**
 * The node fields only this writer's clock may fill. A caller has no clock of
 * its own — a driven session has nothing to read one with — so a value it sends
 * is a time it already held, and the one it holds is usually the run's
 * `created`: every node then reads as having run for as long as the whole run.
 */
const CLOCK_FIELDS = ['started', 'completed'];

/** Scalars that YAML would read as something other than a string. */
const RESERVED = /^(?:true|false|yes|no|on|off|null|~)$/i;
const NUMBERISH = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

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
 * The kind a task node may be recorded under besides its own scheme. Engine runs
 * have recorded every non-gate node as `task` since the first freeze, so the
 * spelling stays legal; a gate is always `gate`, and a `workflow:` node always
 * `workflow`, because those two are what `gate-brief` and `run-complete` read a
 * node's kind for.
 */
const TASK_KIND = 'task';

/** The warning the verbs resolve a definition of an unknown format under, as `workflow.mjs` spells it. */
const NEWER_FORMAT = 'newer-format';

/** The scheme of a node that starts a child run. */
const WORKFLOW_SCHEME = 'workflow:';

/**
 * The two values a `workflow:` node records about its child and declares
 * nowhere: the grammar reserves both names, because the node always carries
 * them itself.
 */
const RESERVED_VALUES = ['task_path', 'run_id'];

/**
 * The three keys of the pending-gate marker, and the two patterns its non-id
 * fields obey. Spelled as `gate.schema.json#/$defs/pending` and
 * `common.schema.json#/$defs/timestamp` spell them, because the value this
 * writer emits is the value the contract suite validates.
 *
 * `MIDNIGHT` is a separate test rather than a tighter pattern for the reason
 * A6 gives: a pattern that excluded it would also exclude the one legal
 * midnight, and the rule is "measured, not formatted", which is a claim about
 * where the value came from.
 */
const PENDING_KEYS = ['node', 'request', 'since'];
const REQUEST_PATH = /^gates\/[a-z0-9-]+\.request\.yml$/;

/**
 * The two keys of the child's parent link, and the spelling its path obeys.
 *
 * `PARENT_RUN` is the bare flow charset minus everything that would make the
 * value something other than a relative path: it accepts no leading `/`, no
 * backslash and no `.`/`..` segment, so what it admits is both emittable
 * unquoted and joinable onto the repository root. The segment test is separate
 * because a pattern that excluded `..` would also exclude the dated directory
 * names that carry dots in the wild.
 */
const PARENT_KEYS = ['run', 'node'];
const PARENT_RUN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;

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
 *   gate_pending    One contract-shaped value (E2), validated whole before it
 *                   is emitted. Merged, a write clearing the marker would leave
 *                   the answered gate's `node` and `request` standing beside a
 *                   null nobody wrote — a marker the hook would still read as
 *                   pending.
 *   parent          A child run's `{run, node}` link back to its parent,
 *                   validated whole before it is emitted. Written once, at the
 *                   freeze, and never edited afterwards, so there is no second
 *                   writer to merge with and a replacing write is what the key
 *                   means.
 *   completed_phases, failed_phases
 *                   Sequences. There is no key to merge on; a caller that means
 *                   to append sends the whole list, the same rule
 *                   `related_tasks` follows at the top level. Both start as
 *                   empty lists the freeze writes (`seedSequences`).
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
 * The five context blocks the built-in workflows write (A1 layer 2). Any other
 * workflow's block is derived from its name (`contextBlockOf`), and the root
 * accepts exactly one, so which one a write means has to be derived rather
 * than assumed.
 */
const CONTEXT_BLOCKS = ['task_context', 'research_context', 'design_context', 'performance_context', 'migration_context'];

/** Every context block's name ends in this, built-in or derived. */
const CONTEXT_SUFFIX = '_context';

/**
 * The top-level keys the contract gives a meaning of its own. Two of them end
 * in the context suffix, so a workflow named `project` or `verification` would
 * derive a block that is already something else: its context writes would land
 * in the shared block every reader consults for a different purpose.
 */
const RESERVED_KEYS = new Set(['orchestrator', 'task', 'workflow', 'node_summaries', ...TOP_LEVEL_BLOCKS]);

/** Built-in workflow name to context block, from before the block was derived. */
const WORKFLOW_CONTEXT = {
  research: 'research_context',
  development: 'task_context',
  design: 'design_context',
  'product-design': 'design_context',
  performance: 'performance_context',
  migration: 'migration_context',
};

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Apply `patch` to the state file at `state`.
 *
 * Returns `{ok, changed, errors, warnings, ignored, undeclared}`. On a refusal `changed` is empty and
 * the file on disk is byte-for-byte what it was: every check that can refuse runs
 * before the rename, and the rename is the only thing that publishes a write.
 *
 * A write that installs `workflow:` into a file that carried none — the freeze —
 * also installs the dashboard viewer (see `installViewer`) and returns `banner`,
 * the startup lines `workflow.mjs` prints after the paths.
 *
 * `warnings` carries what went wrong *after* the write landed, which today is the
 * dashboard projection and nothing else. It is data rather than a stderr line
 * because no module under `scripts/lib/` performs stdio: every refusal already
 * travels to `workflow.mjs` as data and is printed there, and this is the same
 * journey for something that is not a refusal.
 *
 * The clock is read once, here, and handed to everything downstream. It used to be
 * read inside `apply`, which `writeState` never saw — so the projection would have
 * had to read a second one and a write could be stamped a second apart from the
 * file describing it.
 */
export function writeState({ state, patch, regress = null }) {
  const changed = [];
  const warnings = [];
  // The clock fields the patch carried and the writer dropped, as dotted
  // paths. Data rather than a stderr line, for the reason `warnings` is.
  const ignored = [];
  // The node values this write recorded that the definition does not declare
  // (`assertValues`), as dotted paths, on the same terms.
  const undeclared = [];
  try {
    checkPatch(patch);
    const doc = readDoc(state);
    const now = canonical.stamp();
    // The top-level keys the file already carries, plus the ones this write
    // means to introduce: anything else in the candidate came from a value,
    // and a value that reaches column 0 is an injection.
    const allowed = new Set(topLevelKeys(doc.text()));
    // Read before `apply`, which installs the block: the banner marks the
    // write that starts a run, and a later write re-sending `workflow:` into a
    // file that already carries one is not that write.
    const hadWorkflow = doc.has('workflow');
    for (const key of apply(doc, patch, changed, now, path.dirname(path.resolve(state)), ignored, undeclared, regress)) allowed.add(key);
    const text = doc.text();
    selfCheck(text, state, allowed);
    // Before the state commit, so a refusal out of the index leaves the state
    // file exactly as it was — `writeState`'s standing promise. The index is a
    // mirror of the request files, which already carry the answer by the time
    // this write is issued, so refreshing it early is never wrong: it is the
    // state file that is about to catch up, not the index. The projection below
    // sits on the other side of the commit, for the opposite reason.
    if (clearsPending(patch) && refreshIndex(path.dirname(path.resolve(state)))) {
      changed.push(GATE_INDEX);
    }
    commit(state, text);
    // After the commit, and the asymmetry against `refreshIndex` above is
    // deliberate: the index mirrors request files that are already on disk, so
    // publishing it early can never be wrong, while the dashboard is a projection
    // OF THIS WRITE — projected before the rename it would describe a state the
    // run might never have. A projection failure is a warning and never a refusal:
    // the state write already landed and un-publishing it is not on offer.
    project(state, text, now, changed, warnings);
    const freeze = Boolean(patch.workflow) && !hadWorkflow;
    if (freeze) installViewer(state, text, changed, warnings);
    const result = { ok: true, changed, errors: [], warnings, ignored, undeclared };
    if (freeze) result.banner = banner(state, text, patch.workflow);
    return result;
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, changed: [], errors: [{ code: err.code, message: err.message }], warnings };
    }
    throw err;
  }
}

/**
 * The startup banner the freeze write returns, five lines, each ending in a
 * newline.
 *
 * It is data for the same reason `warnings` is: no module under `scripts/lib/`
 * performs stdio. It exists so the operator learns where a run lives from a
 * channel that always renders — the freeze's own output — rather than from a
 * paragraph the orchestrating model may or may not compose. The dashboard line
 * reads the committed state, so an `html_output: false` the same patch carries
 * is already in force.
 */
function banner(state, text, workflow) {
  const runDir = path.dirname(path.resolve(state));
  const doc = parseState(text);
  const title = isPlainObject(doc.task) ? doc.task.title : undefined;
  // Folded onto one line: an adopted file can carry a block-scalar title, and
  // its line breaks would add lines to a banner that is five lines long.
  const folded = title === undefined || title === null ? '' : String(title).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const nodes = isPlainObject(workflow.nodes) ? Object.keys(workflow.nodes) : [];
  return [
    'Maister run started',
    `Task: ${folded !== '' ? folded : '(untitled)'}`,
    `Directory: ${runDir}`,
    `Dashboard: ${htmlOutput(doc) ? pathToFileURL(path.join(runDir, VIEWER)).href : 'none (html_output is false)'}`,
    `First node: ${nodes.length ? nodes[0] : '(none)'}`,
  ].map(line => `${line}\n`).join('');
}

/**
 * Does this write record a decision?
 *
 * The test is E2's own commit point, and nothing weaker: `gate_pending` present
 * in the patch and set to the literal null. A patch that sets it to a marker is
 * a gate being *asked*, and `gate.mjs` regenerates the index itself in that
 * call; a patch that does not mention it at all leaves whatever was pending
 * pending, and an index rewritten there would say the same thing it already
 * says.
 */
function clearsPending(patch) {
  const orchestrator = patch.orchestrator;
  if (!isPlainObject(orchestrator) || !Object.hasOwn(orchestrator, 'gate_pending')) return false;
  const value = orchestrator.gate_pending;
  return value === null || value === undefined;
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
// the dashboard projection
// ---------------------------------------------------------------------------

/**
 * Publish `dashboard-data.js` from the state this write just committed.
 *
 * The only impure part of the feature: `dashboard.mjs` derives the bytes and this
 * function reads the side inputs and writes the file, the same split
 * `diagram.mjs` and its caller already use.
 *
 * It **catches everything**. A `Refusal` out of the publish path and any other
 * `Error` both become one warning entry and a normal return, so no projection
 * fault ever reaches `writeState`'s outer `catch` — which would report a landed
 * state write as a refused one, the single worst outcome available here.
 *
 * The committed text is parsed rather than re-read. It is free, and a re-read
 * opens a window in which another writer could have moved the file: the
 * projection would then describe a state this invocation did not write.
 */
function project(state, text, now, changed, warnings) {
  try {
    const runDir = path.dirname(path.resolve(state));
    const doc = parseState(text);
    const target = path.join(runDir, DASHBOARD);

    if (!htmlOutput(doc)) {
      // Stat first, so `changed` reports a removal that happened rather than one
      // that was attempted: a caller reading `changed` is reading what this write
      // did to the directory. `dashboard.html` is never touched — it is the viewer,
      // not the data, and an operator who turns the option off is turning off the
      // regeneration, not deleting the page they may still open on the old data.
      let existed = false;
      try {
        existed = fs.statSync(target).isFile();
      } catch {
        existed = false;
      }
      fs.rmSync(target, { force: true });
      if (existed) changed.push(DASHBOARD);
      return;
    }

    const definition = definitionOf(doc, runDir);
    const view = {
      state: doc,
      display: displayOfRun(doc, runDir),
      gates: gateRequests(runDir),
      progress: progressOf(doc, definition, runDir),
    };
    canonical.commit({
      target,
      text: dashboard.render(view, { now }),
      tmp: path.join(runDir, DASHBOARD_TMP),
      codes: DASHBOARD_CODES,
    });
    changed.push(DASHBOARD);
  } catch (err) {
    const code = err instanceof Refusal ? err.code : DASHBOARD_CODES.unwritable;
    // `Refusal` prefixes its own message with its code, which is what makes the
    // code the first stderr token on the refusal path. Here the code is a field,
    // and `workflow.mjs` spells it itself — so the prefix is stripped rather than
    // printed twice inside one set of parentheses.
    const raw = err && err.message ? String(err.message) : String(err);
    const prefix = `${code}: `;
    warnings.push({ code, message: raw.startsWith(prefix) ? raw.slice(prefix.length) : raw });
  }
}

/**
 * Copy the dashboard viewer into the run directory, at the freeze only.
 *
 * `dashboard-data.js` is regenerated on every write, but it is only data; the
 * page that renders it is a static file the run directory needs once. The prose
 * path installs it at initialization, which the engine path never reaches, so
 * the freeze — the write that starts an engine run — installs it instead.
 *
 * Never over an existing file, a link included: an operator's own page or an
 * older viewer they still open stays as it is. Skipped when the run has turned
 * `html_output` off. A failure is a warning after a write that already landed,
 * the same terms as the projection, and never a refusal.
 */
function installViewer(state, text, changed, warnings) {
  if (!htmlOutput(parseState(text))) return;
  const target = path.join(path.dirname(path.resolve(state)), VIEWER);
  try {
    fs.copyFileSync(VIEWER_SOURCE, target, fs.constants.COPYFILE_EXCL);
    changed.push(VIEWER);
  } catch (err) {
    if (err && err.code === 'EEXIST') return;
    warnings.push({ file: VIEWER, code: 'viewer-uncopied', message: err && err.message ? String(err.message) : String(err) });
  }
}

/**
 * Whether this run wants the dashboard at all, defaulting to **true**.
 *
 * `html_output` is an operator option written by `intake` and merged by every
 * later option write, and a run that never set it gets the dashboard. Absence of
 * the key, of the `options` map or of the whole `orchestrator:` block all mean
 * the same thing, and only the literal `false` turns the projection off — an
 * explicit `null` is an unset option, which is how the other option keys spell
 * "not decided".
 *
 * Both on-disk forms are handled for free because `state-read.parse` reads a
 * one-line flow map and a block map alike. `Doc.scalar` handles neither and is
 * deliberately not used here.
 */
export function htmlOutput(doc) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : null;
  if (!orchestrator) return true;
  const options = isPlainObject(orchestrator.options) ? orchestrator.options : null;
  if (!options || !Object.hasOwn(options, 'html_output')) return true;
  return options.html_output !== false;
}

/**
 * The run's dashboard as a `file://` URL an operator can open from a terminal,
 * or null when the run has none: `html_output` is false, or the viewer is not in
 * the run directory. The link is shown once at the run's start (the freeze
 * banner), at a resume and at the end, never at every gate.
 */
export function dashboardUrl(doc, runDir) {
  if (!htmlOutput(doc)) return null;
  const viewer = path.join(runDir, VIEWER);
  return fs.existsSync(viewer) ? pathToFileURL(viewer).href : null;
}

/**
 * The workflow definition behind this run, or null.
 *
 * The order is the whole point. A single `locateWorkflow(workflow.source)` returns
 * null for most runs, because `locateWorkflow` passes its argument through
 * `bareWorkflowName` and therefore rejects a path — and a path is the commonest
 * `source` form, the one `workflow.mjs --definition <path>` records. The failure
 * would be silent: no definition, no `display`, no `icon_hint` on any phase, one
 * fallback glyph everywhere, and nothing anywhere saying so.
 *
 * So: the path first, then the name resolution for `builtin:<name>` and a bare
 * name, then the run's own `workflow.name` for the state files that record a bare
 * literal `builtin` as their source.
 *
 * The run's overlays and profile are folded in, read by the same `sourcesOf` the
 * display is: a node an overlay added declares its outputs and what it uses only
 * in the overlay, so a base-only read would register none of its artifacts and
 * hang no progress on it. An overlay that cannot be read leaves the base as it
 * is.
 *
 * Any failure at any step yields null, or the base alone, and never fails the
 * write.
 */
function definitionOf(doc, runDir) {
  const sources = sourcesOf(isPlainObject(doc.workflow) ? doc.workflow : {}, runDir);
  if (sources === null) return null;
  const base = sources.definition.doc ?? null;
  if (sources.overlays.some(overlay => overlay.doc === null || overlay.errors.length)) return base;
  try {
    return foldDefinition(sources);
  } catch {
    return base;
  }
}

/**
 * The icons and titles the run's phases are drawn with: the definition's
 * `display:` block merged with its overlays' and the selected profile's, the way
 * `display.mjs` merges them — so a node an overlay added carries the title the
 * overlay gave it. Cosmetic, so an overlay that cannot be read is left out
 * rather than costing every other title, and any failure yields the empty
 * display: every phase then shows its humanized id.
 */
function displayOfRun(doc, runDir) {
  try {
    const sources = sourcesOf(isPlainObject(doc.workflow) ? doc.workflow : {}, runDir);
    if (sources === null) return displayOf();
    return displayOf({ ...sources, overlays: sources.overlays.filter(overlay => overlay.doc) });
  } catch {
    return displayOf();
  }
}

/**
 * The definition a run froze and the overlays it recorded, each read as the
 * reader returns it (`{file, doc, errors}`), plus the profile: `{definition,
 * overlays, profile}`, or null when no definition is found. Overlay paths are
 * taken against the project root, as the freeze recorded them. Each caller
 * decides what an unreadable source costs it.
 */
function sourcesOf(workflow, runDir) {
  const file = definitionPathOf({ workflow }, runDir);
  if (file === null) return null;
  const root = projectRootOf(runDir);
  const overlays = Array.isArray(workflow.overlays) ? workflow.overlays : [];
  return {
    definition: readDefinition(file),
    overlays: overlays.map(overlay => readDefinition(path.resolve(root, String(overlay)))),
    profile: workflow.profile ?? null,
  };
}

/**
 * The file `definitionOf` reads, or null — the same lookup order, returned as a
 * path. Exported for `gate-brief`, which re-reads the definition a run froze and
 * must find it exactly where the projection does: two copies of this order would
 * let the brief and the dashboard read different files for one run.
 */
export function definitionPathOf(doc, runDir) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const root = projectRootOf(runDir);
  const source = typeof workflow.source === 'string' && workflow.source !== '' ? workflow.source : null;

  let file = null;
  if (source !== null) {
    // Against the run's project root, never the process cwd, for the reason
    // `projectRootOf` gives: a relative source read from wherever the writer
    // happened to start takes another project's definition, silently.
    const direct = path.resolve(root, source);
    if (isFile(direct)) file = direct;
    else file = located(source, root);
  }
  if (file === null && typeof workflow.name === 'string' && workflow.name !== '') {
    file = located(workflow.name, root);
  }
  return file;
}

/** The base definition `locateWorkflow` finds for a name, or null. */
function located(name, root) {
  const hit = locateWorkflow(name, root);
  return hit ? hit.base : null;
}

/**
 * The project root, derived from the run directory and from nothing else.
 *
 * `<root>/.maister/tasks/<type>/<date-name>` is four levels down, and the run
 * directory is the only thing this write knows for certain. `locateWorkflow`'s own
 * default root is `CLAUDE_PROJECT_DIR` or the process cwd, neither of which is a
 * property of the run being written — a dispatched worker started elsewhere would
 * resolve another project's workflows.
 */
export function projectRootOf(runDir) {
  return path.resolve(runDir, '..', '..', '..', '..');
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every gate request beside this run, parsed, keyed by node id.
 *
 * The suffix is the one `gate-index.mjs` exports rather than a second spelling of
 * it, because that is exactly the part that must never drift. The index's own
 * `requestMeta` is deliberately not widened: it reads two keys as a convenience
 * for the index and widening it would make the index's scanner serve an unrelated
 * shape.
 *
 * A request file that cannot be read or parsed is skipped rather than failing the
 * projection: one unreadable gate card is a card that does not render, while a
 * throw here would cost the operator the whole dashboard.
 */
function gateRequests(runDir) {
  const gates = Object.create(null);
  const dir = path.join(runDir, 'gates');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return gates;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(REQUEST_SUFFIX)) continue;
    try {
      gates[name.slice(0, -REQUEST_SUFFIX.length)] = parseState(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
  }
  return gates;
}

/**
 * The executor phase's interior progress, keyed by its node id; `{}` when the run
 * has no plan and no work log on disk yet.
 *
 * The node id comes from the definition wherever it can be read, and only falls
 * back to the frozen ids when it cannot — a frozen list is the route that silently
 * excludes every definition whose executor node is named otherwise. The fallback
 * is narrowed against the run's own frozen node map, so a `progress` entry is
 * never attached to a node this run does not have.
 */
function progressOf(doc, definition, runDir) {
  const progress = Object.create(null);
  const plan = path.join(runDir, 'implementation', 'implementation-plan.md');
  const log = path.join(runDir, 'implementation', 'work-log.md');
  if (!isFile(plan) || !isFile(log)) return progress;

  let derived;
  try {
    derived = dashboard.deriveProgress(fs.readFileSync(plan, 'utf8'), fs.readFileSync(log, 'utf8'));
  } catch {
    return progress;
  }
  if (derived === null || derived === undefined) return progress;

  const node = dashboard.executorNodeOf(definition) ?? fallbackExecutor(doc);
  if (node !== null) progress[node] = derived;
  return progress;
}

/** The first frozen executor id the run's own node map declares, or null. */
function fallbackExecutor(doc) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  return dashboard.EXECUTOR_FALLBACK.find(id => Object.hasOwn(nodes, id)) ?? null;
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
 *
 * `now` is supplied by the caller rather than read here. The write and the
 * dashboard projection derived from it have to carry one timestamp: two
 * `canonical.stamp()` calls in one invocation can straddle a second boundary, and
 * a data file stamped a second before the state it describes is a data file whose
 * freshness cannot be reasoned about.
 */
function apply(doc, patch, changed, now, runDir, ignored, undeclared, regress = null) {
  const intended = new Set(['orchestrator']);
  // The run's frozen graph, proven, for the checks that need the definition;
  // resolved at most once per write, and only if one of them asks.
  const graphOf = frozenGraphOf(doc, runDir);

  // `updated` is this write's own stamp, set last below; a patch value for it
  // is dropped here, before it can land and before its spelling is judged.
  let orchestrator = patch.orchestrator;
  if (isPlainObject(orchestrator) && Object.hasOwn(orchestrator, 'updated')) {
    const { updated: _supplied, ...rest } = orchestrator;
    orchestrator = rest;
    ignored.push('orchestrator.updated');
  }

  // Before the patch's own `orchestrator` keys, so the seeded sequences open
  // the block and a freeze's `parent` still follows every key the patch sends.
  if (patch.workflow) seedSequences(doc, orchestrator, changed);
  if (orchestrator) applyScalars(doc, 'orchestrator', orchestrator, changed);
  if (patch.task) {
    applyScalars(doc, 'task', patch.task, changed);
    intended.add('task');
  }
  if (patch.workflow) {
    applyWorkflow(doc, patch.workflow, now, changed, runDir, ignored);
    intended.add('workflow');
  }
  if (patch.nodes) applyNodes(doc, patch.nodes, now, changed, ignored, graphOf, undeclared, regress);
  if (patch.context || patch.phase_summaries) {
    // Resolved once, after `workflow:` is in place, so a patch that installs
    // the block and writes its summaries in one invocation resolves from the
    // name it just wrote.
    const block = contextBlock(doc, patch);
    intended.add(block);
    seedSummaries(doc, block, changed);
    if (patch.context) applyContext(doc, block, patch.context, changed);
    if (patch.phase_summaries) applySummaries(doc, block, patch.phase_summaries, patch.nodes, 'phase', changed);
  }
  if (patch.node_summaries) {
    applySummaries(doc, null, patch.node_summaries, patch.nodes, 'node', changed, runDir, graphOf);
    intended.add('node_summaries');
  }
  if (patch.nodes) mirrorOntoRecorded(doc, patch.nodes, patch.node_summaries, changed);
  for (const key of TOP_LEVEL_BLOCKS) {
    if (!Object.hasOwn(patch, key)) continue;
    applyTopLevel(doc, key, patch[key], changed);
    intended.add(key);
  }

  // Every write moves the run's clock. Set last so it reflects the whole write
  // rather than the moment the first section was touched.
  doc.set(['orchestrator', 'updated'], [`  updated: ${flow(now, 'orchestrator.updated')}`]);
  if (!changed.includes('orchestrator.updated')) changed.push('orchestrator.updated');
  return intended;
}

/**
 * Which context block this write belongs in.
 *
 * The workflow's own name is the answer wherever it can be had — from the patch
 * installing the block, or from the `name:` already beside `workflow.nodes`. A
 * file that carries exactly one context block and no usable name is read as
 * belonging to that one. Anything else refuses: defaulting would write the
 * summaries into a block no reader of this run consults, which is a successful
 * write nothing can find.
 */
function contextBlock(doc, patch) {
  const raw = patch.workflow && 'name' in patch.workflow ? patch.workflow.name : doc.scalar(['workflow', 'name']);
  const present = topLevelKeys(doc.text()).filter(isContextBlock);
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const derived = contextBlockOf(String(raw).trim());
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
 * The context block a workflow name derives: `<name>_context`, the name's
 * dashes written as underscores.
 *
 * Every name a built-in run was ever recorded under keeps the block it had
 * before the rule was general. Two built-ins' blocks never shared their name's
 * stem — development's is `task_context`, product-design's `design_context` —
 * and a name whose stem already spelled one of the five (`task`, a
 * capitalised `Research`) was read as that block, so both stay ahead of the
 * general rule rather than being folded into it.
 *
 * Any other name is held to the grammar's own character set, because it is
 * about to become a top-level YAML key and a run is frozen under the name its
 * definition declares, which `validate` already held to that set. Only a name
 * whose block would be one the contract reserves is refused inside it.
 */
function contextBlockOf(written) {
  const name = written.toLowerCase();
  // `Object.hasOwn`, not bracket access: `workflow.mjs`'s rule, and this is
  // the site that made it load-bearing. `name: constructor` reached
  // `WORKFLOW_CONTEXT.constructor`, which is truthy, and
  // `function Object() { [native code] }:` was written as a top-level YAML key
  // by a file that then passed every self-check at exit 0. The name now derives
  // `constructor_context`, an ordinary key, by the general rule below.
  if (Object.hasOwn(WORKFLOW_CONTEXT, name)) return WORKFLOW_CONTEXT[name];
  const stem = `${name.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}${CONTEXT_SUFFIX}`;
  if (CONTEXT_BLOCKS.includes(stem)) return stem;
  if (!TARGET_NAME.test(written)) {
    throw new Refusal('state-context-block-unknown',
      `the workflow name "${written}" is outside the character set a workflow name is held to — lower-case letters, digits and dashes, `
      + 'starting with a letter — so no context block can be derived from it; record the name the run\'s definition declares');
  }
  if (RESERVED_KEYS.has(stem)) {
    throw new Refusal('state-context-block-unknown',
      `the workflow name "${written}" derives ${stem}, which the state file already uses for a block of its own, `
      + 'so its context would land where every reader expects something else; rename the workflow');
  }
  return stem;
}

/**
 * Whether a top-level state key is a run's context block: it ends in the
 * context suffix and is not one of the blocks the contract reserves. The
 * readers that look for a run's block by its suffix ask here, so they skip
 * `project_context` and `verification_context` exactly as the writer does.
 */
export function isContextBlock(key) {
  return key.endsWith(CONTEXT_SUFFIX) && !RESERVED_KEYS.has(key);
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
    if (key === 'gate_pending') assertPending(value);
    // Scoped to the section because `parent` names a block under
    // `orchestrator:` and nothing under `task:`, so a shape check that ignored
    // the section would judge a key it does not describe.
    if (section === 'orchestrator' && key === 'parent') assertParent(value);
    if (MERGED_MAPS.has(`${section}.${key}`) && isPlainObject(value)) {
      mergeMap(doc, section, key, value, changed);
      continue;
    }
    doc.set([section, key], [`  ${key}: ${flow(value, `${section}.${key}`)}`]);
    changed.push(`${section}.${key}`);
  }
}

/**
 * The pending-gate marker (E2), validated whole before anything is emitted.
 *
 * Two spellings are legal and there is no third: the literal `null`, and a
 * `{node, request, since}` map that goes onto one line. Everything else refuses
 * under the one code name this key has always used — the refusal vocabulary is
 * closed and does not grow because a value gained a second legal form.
 *
 * The strictness is not schema pedantry; each rule is a way a session gets
 * blocked by a write that reported success:
 *
 *   an extra or missing key    The marker is read by the enforcement hook on
 *                              every mutating tool call. A marker without
 *                              `node` is a pending run the hook cannot name a
 *                              gate for, and a nested value is the one shape
 *                              the one-line reader throws on.
 *
 *   a string, however spelled  This is the sharp edge. `flow()` passes a value
 *                              that is *already* a balanced flow collection
 *                              through verbatim, so a caller sending the marker
 *                              as text — with a trailing comment, or with an
 *                              embedded quote — would have those bytes land on
 *                              the line. `stripComment` in the reader does not
 *                              strip a comment from a line that opens with `{`,
 *                              so the parse throws and the hook fails closed.
 *                              Only a real object is accepted, so the emitter
 *                              spells the line and nothing else can.
 *
 *   `request` naming `node`    A writer-side rule the schema cannot express:
 *                              the hook's allow-list is built from the marker's
 *                              `node`, and a `request` naming another node
 *                              would leave the file the model must edit off the
 *                              list — a gate that can be neither answered nor
 *                              cleared.
 *
 *   a non-midnight `since`     A6. Midnight is the signature of a date that was
 *                              formatted rather than measured, and the suite
 *                              lints for it; the writer refuses it here so the
 *                              defect is caught at the write rather than at the
 *                              next contract run.
 */
function assertPending(value) {
  if (value === null) return;
  const refuse = detail => {
    throw new Refusal('state-gate-pending-form',
      `gate_pending is written as the literal null or as {node, request, since} on one line: ${detail}`);
  };
  if (!isPlainObject(value)) {
    return refuse(`this value is ${Array.isArray(value) ? 'a sequence' : typeof value}, and a marker sent as text would reach the file with its own bytes`);
  }
  const keys = Object.keys(value);
  const missing = PENDING_KEYS.filter(key => !keys.includes(key));
  if (missing.length) return refuse(`it is missing ${missing.join(', ')}`);
  const extra = keys.filter(key => !PENDING_KEYS.includes(key));
  if (extra.length) return refuse(`${extra.join(', ')} is not part of the marker`);

  if (typeof value.node !== 'string' || !NODE_ID.test(value.node)) {
    return refuse(`${JSON.stringify(String(value.node))} is not a usable node id`);
  }
  if (typeof value.request !== 'string' || !REQUEST_PATH.test(value.request)) {
    return refuse(`${JSON.stringify(String(value.request))} is not a task-root-relative gates/<node>.request.yml path`);
  }
  if (value.request !== `gates/${value.node}.request.yml`) {
    return refuse(`the request file ${value.request} names another node than ${value.node}, so the hook would not allow the file the answer has to be written into`);
  }
  if (typeof value.since !== 'string' || !TIMESTAMP.test(value.since) || MIDNIGHT.test(value.since)) {
    return refuse(`${JSON.stringify(String(value.since))} is not a measured UTC timestamp`);
  }
}

/**
 * The child run's link back to its parent, validated whole before it is
 * emitted, and for the same reason the pending-marker check exists: the writer
 * would otherwise accept any shape under this key, and the first reader to
 * discover a malformed parent link is the cockpit, one repository away from the
 * defect.
 *
 * `{run, node}` and nothing else — exactly the two keys, both strings, `node`
 * spelled as any other node id, `run` the parent's repository-root-relative
 * task directory. The key is written once, at the freeze, and never edited, so
 * there is no partial write to accommodate and no reason to accept one.
 *
 * Everything here refuses under the patch-invalid code this section has always
 * used. The vocabulary is closed and does not grow because a key gained a
 * shape — the same rule `gate_pending` follows, and the reason that one keeps
 * its own long-standing code rather than taking a new one.
 */
function assertParent(value) {
  const refuse = detail => {
    throw new Refusal('state-patch-invalid',
      `orchestrator.parent is written as {run, node} on one line: ${detail}`);
  };
  if (!isPlainObject(value)) {
    return refuse(`this value is ${value === null ? 'null' : Array.isArray(value) ? 'a sequence' : typeof value}, and a link sent as text would reach the file with its own bytes`);
  }
  const keys = Object.keys(value);
  const missing = PARENT_KEYS.filter(key => !keys.includes(key));
  if (missing.length) return refuse(`it is missing ${missing.join(', ')}`);
  const extra = keys.filter(key => !PARENT_KEYS.includes(key));
  if (extra.length) return refuse(`${extra.join(', ')} is not part of the link`);

  if (typeof value.node !== 'string' || !NODE_ID.test(value.node)) {
    return refuse(`${JSON.stringify(String(value.node))} is not a usable node id`);
  }
  if (typeof value.run !== 'string' || !PARENT_RUN.test(value.run)) {
    return refuse(`${JSON.stringify(String(value.run))} is not a relative task directory the one-line reader can carry unquoted`);
  }
  if (value.run.split('/').some(segment => segment === '.' || segment === '..')) {
    return refuse(`${JSON.stringify(value.run)} climbs out of the repository root, so it names no task directory`);
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
 * Install the whole `workflow:` block, once, at the freeze. `workflow:` and its
 * `nodes:` child are emitted together, always: a block present without its
 * nodes is read as a run awaiting an operator, which denies every write in the
 * session.
 *
 * This is the one region the writer does not edit in place. The whole block is
 * emitted from the patch, so comments inside it and children the patch does not
 * carry are never preserved — the module header's preservation guarantee covers
 * every other region, not this one. That is the behaviour the callers want (a
 * workflow block is installed once, from the resolved graph) and it is stated
 * here rather than left to be discovered.
 *
 * **After the freeze the block is refused rather than re-emitted**, unless the
 * patch is identical to it, which is a no-op. `graph_hash` is what makes the
 * frozen graph verifiable against the definition it came from, and the node
 * entries are the run's progress; a re-emission from a patch would replace
 * both with whatever the patch carried. **Before it, the block is proven**
 * against the definition it records (`provenNodes`), for the same reason: it
 * is written once, so what it gets wrong stays wrong for the whole run.
 *
 * Both key loops below emit `  ${key}:` raw, so both run the block-key guard
 * first. Without it a key carrying a newline did not produce a bad-looking
 * file: it produced further lines at the emitter's own column — a second
 * `nodes:` child no YAML parser accepts, and under it a node no graph declared,
 * recorded `completed` and read back by the ready set. Through the success path.
 */
function applyWorkflow(doc, workflow, now, changed, runDir, ignored) {
  if (!isPlainObject(workflow)) throw new Refusal('state-patch-invalid', 'the workflow patch must be an object');
  const nodes = workflow.nodes;
  if (!isPlainObject(nodes) || Object.keys(nodes).length === 0) {
    throw new Refusal('state-workflow-without-nodes',
      'a workflow block is written only together with a non-empty nodes child, at the freeze; '
      + 'a later node update goes under the top-level `nodes` key, never under `workflow`');
  }
  if (!doc.has('task')) {
    throw new Refusal('state-workflow-without-task',
      'a workflow block cannot be installed into a state file that has no task block');
  }
  // After the freeze the block is never rewritten. It is re-emitted whole from
  // the patch, so a re-sent block did damage in every direction: a node left
  // out was erased, a node re-typed as its bare kind went back to `pending` with
  // its values and clocks gone, and a node no graph declares joined the ready
  // set recorded however the patch said. A re-send identical to the file is
  // the one harmless case, and it is a no-op.
  if (doc.has('workflow')) {
    const differences = frozenDifferences(doc, workflow);
    if (differences.length) {
      throw new Refusal('state-workflow-frozen',
        `this workflow patch differs from the frozen block (${differences.join('; ')}); the freeze is written once — `
        + 'a later node update goes under the top-level `nodes` key, never under `workflow`');
    }
    return;
  }

  const entries = provenNodes(doc, workflow, runDir);
  const lines = ['workflow:'];
  for (const key of WORKFLOW_KEYS) {
    if (!Object.hasOwn(workflow, key)) continue;
    assertBlockKey(key);
    lines.push(`  ${key}: ${flow(workflow[key], `workflow.${key}`)}`);
  }
  for (const key of Object.keys(workflow)) {
    if (key === 'nodes' || WORKFLOW_KEYS.includes(key)) continue;
    assertBlockKey(key);
    lines.push(`  ${key}: ${flow(workflow[key], `workflow.${key}`)}`);
  }
  lines.push('  nodes:');
  for (const [id, entry] of Object.entries(entries)) {
    lines.push(nodeLine(id, stamp(id, entry, {}, now, ignored)));
    changed.push(`workflow.nodes.${id}`);
  }
  doc.set(['workflow'], lines);
  changed.push('workflow');
}

/**
 * The freeze's node entries, proven against the definition they claim and each
 * carrying its `needs` from the graph itself.
 *
 * The freeze is the one write a run cannot take back: every later write is
 * refused unless it matches the block, and every reader lays the run out from
 * it. It used to be accepted as sent. A hash that did not re-resolve left every
 * node without edges, a freeze that left out the overlays it was resolved with
 * did the same, and a name, a node set or a kind that disagreed with the graph
 * landed silently and misled every reader after it. So the patch is held to the
 * graph it records, in this order, and refused at the first disagreement:
 *
 *   proof      the recorded `source`, `overlays` and `profile` resolve to the
 *              recorded `graph_hash` (`provenGraph`);
 *   name       `workflow.name` is the definition's own, which the context
 *              block, the dashboard type and every other reader keyed by name
 *              follow;
 *   nodes      exactly the resolved node set, each under a kind the graph
 *              allows (`kindsOf`);
 *   inputs     every input the definition requires is in
 *              `orchestrator.options.inputs` as this write leaves it — the
 *              patch's `orchestrator` keys are applied before this block, so a
 *              freeze that carries its inputs beside it is read with them.
 *
 * A resolved `needs` then replaces whatever the patch carried for that node, so
 * a caller that copied only the kinds still freezes the edges, and a gate that
 * offers a revise records where each revise option sends the run (`rerunsOf`).
 */
function provenNodes(doc, workflow, runDir) {
  const nodes = workflow.nodes;
  const proof = provenGraph(workflow, runDir);
  if (!proof.graph) {
    throw new Refusal('state-freeze-unproven',
      `this freeze cannot be proven against its definition: ${proof.reason}. Nothing was written. `
      + 'Run resolve with the --definition, --overlay and --profile the run was started with, and send its '
      + 'source, overlays, profile, graph_hash and name exactly as resolve printed them');
  }
  const { graph, inputs } = proof;

  if (graph.name !== null && workflow.name !== graph.name) {
    throw new Refusal('state-freeze-name-mismatch',
      `this freeze records workflow.name as ${JSON.stringify(workflow.name ?? null)}, but the definition it resolves `
      + `is named ${JSON.stringify(graph.name)}. Nothing was written. Send workflow.name exactly as resolve printed `
      + 'name: the run\'s context block and every reader keyed by the name follow it');
  }

  const differences = nodeDifferences(nodes, graph.nodes);
  if (differences.length) {
    throw new Refusal('state-freeze-nodes-mismatch',
      `this freeze's nodes differ from the graph resolve printed (${differences.join('; ')}). Nothing was written. `
      + 'Send one entry per resolved node and no other, recording a gate as gate, a workflow: node as workflow '
      + 'and every other node as task');
  }
  for (const [id, entry] of Object.entries(nodes)) assertStatus(id, entry);

  const missing = missingInputs(doc, inputs);
  if (missing.length) {
    throw new Refusal('state-freeze-input-missing',
      `the definition requires the input${missing.length === 1 ? '' : 's'} ${missing.join(', ')}, and this freeze `
      + 'records no value for it under orchestrator.options.inputs. Nothing was written. Send the value the run was '
      + 'started with in the same freeze; a required input the invocation did not carry is the operator\'s to give, '
      + 'never one to invent');
  }

  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const filled = {};
  for (const [id, entry] of Object.entries(nodes)) {
    const { attempt: _attempt, reruns: _reruns, ...sent } = entry;
    filled[id] = { ...sent, needs: byId.get(id).needs };
    const reruns = rerunsOf(byId.get(id));
    if (reruns) filled[id].reruns = reruns;
  }
  return filled;
}

/**
 * A gate's revise options as `{option: node}`, or null when it offers none.
 * Recorded at the freeze so a revise needs nothing but the state: the options
 * are otherwise only in the definition, and a definition that changed since the
 * freeze is exactly the run an operator most wants to send back.
 */
function rerunsOf(node) {
  if (node?.type !== 'gate' || !isPlainObject(node.options)) return null;
  const reruns = {};
  for (const [option, value] of Object.entries(node.options)) {
    if (isPlainObject(value) && value.effect === 'revise' && typeof value.reruns === 'string') reruns[option] = value.reruns;
  }
  return Object.keys(reruns).length ? reruns : null;
}

/**
 * The graph a `workflow` block records, re-resolved from the provenance it
 * records and proven by its hash: `{graph, inputs}`, or `{reason}` saying why
 * it cannot be proven.
 *
 * The proof is the one `resolve` gives its caller: the recorded `source`,
 * `overlays` and `profile` resolve, from this run's project root, to exactly the
 * recorded `graph_hash` — exactly, in the spelling `resolve` prints, because
 * that is the spelling state records and a re-spelled hash is a run whose
 * identity no longer matches its graph. A definition declaring a format this
 * build does not know is resolved on its structure alone, the way the verbs
 * resolve it. `inputs` is the definition's own `inputs:` map, which the
 * resolved graph does not carry and which overlays pass through untouched.
 *
 * Never throws: a definition that cannot be read or resolved is a reason, and
 * what that costs is the caller's to decide. Exported so that a reader which
 * re-resolves a frozen run can prove it by this rule rather than a copy of it.
 */
export function provenGraph(workflow, runDir) {
  const recorded = typeof workflow.graph_hash === 'string' && workflow.graph_hash !== '' ? workflow.graph_hash : null;
  if (recorded === null) return { reason: 'it records no graph_hash' };
  try {
    const sources = sourcesOf(workflow, runDir);
    if (sources === null) {
      return { reason: `no definition is found at its source ${JSON.stringify(workflow.source ?? null)} or by its name ${JSON.stringify(workflow.name ?? null)}` };
    }
    const { definition, overlays, profile } = sources;
    const unreadable = [definition, ...overlays].find(source => source.doc === null || source.errors.length);
    if (unreadable) {
      return { reason: `${unreadable.file} cannot be read (${unreadable.errors[0]?.message ?? 'no document'})` };
    }
    const version = definition.doc.version;
    const degraded = version !== undefined && version !== null && version !== KNOWN_VERSION ? [NEWER_FORMAT] : [];
    const graph = resolveGraph({ definition, overlays, profile, degraded, project: projectRootOf(runDir) });
    if (!graph.ok) return { reason: `its definition does not resolve (${graph.errors[0]?.message ?? 'no graph'})` };
    if (graph.graph_hash !== recorded) {
      return { reason: `it resolves to ${graph.graph_hash}, not to the recorded ${recorded}` };
    }
    return { graph, inputs: isPlainObject(definition.doc.inputs) ? definition.doc.inputs : {} };
  } catch (err) {
    return { reason: `its definition cannot be resolved (${err && err.message ? err.message : err})` };
  }
}

/**
 * How a freeze's node entries differ from the resolved node list, one phrase
 * per difference; empty when they agree.
 */
function nodeDifferences(nodes, resolved) {
  const byId = new Map(resolved.map(node => [node.id, node]));
  const differences = [];
  const added = Object.keys(nodes).filter(id => !byId.has(id));
  if (added.length) differences.push(`adds ${added.join(', ')}, which the resolved graph does not carry`);
  const dropped = [...byId.keys()].filter(id => !Object.hasOwn(nodes, id));
  if (dropped.length) differences.push(`leaves out ${dropped.join(', ')}`);
  for (const [id, entry] of Object.entries(nodes)) {
    if (!byId.has(id)) continue;
    const allowed = kindsOf(byId.get(id));
    const kind = isPlainObject(entry) ? entry.kind : undefined;
    if (allowed.includes(kind)) continue;
    const recorded = kind === undefined || kind === null ? 'no kind' : JSON.stringify(kind);
    differences.push(`records ${id} as ${recorded} where the graph allows ${allowed.map(each => JSON.stringify(each)).join(' or ')}`);
  }
  return differences;
}

/**
 * The kinds a resolved node may be frozen under: `gate` for a gate, `workflow`
 * for a `workflow:` node, and `task` or the node's own scheme for the rest
 * (`TASK_KIND` says why both).
 */
function kindsOf(node) {
  if (node.type === 'gate') return ['gate'];
  const scheme = typeof node.uses === 'string' ? node.uses.slice(0, node.uses.indexOf(':')) : '';
  return scheme === 'workflow' ? ['workflow'] : [TASK_KIND, scheme];
}

/**
 * The inputs the definition requires — `required: true` and no `default` —
 * that the document as this write leaves it records no value for. A null is
 * no value.
 */
function missingInputs(doc, declared) {
  const required = Object.entries(declared)
    .filter(([, input]) => isPlainObject(input) && input.required === true && !Object.hasOwn(input, 'default'))
    .map(([name]) => name);
  if (!required.length) return [];
  let held = {};
  try {
    const orchestrator = parseState(doc.text()).orchestrator;
    const options = isPlainObject(orchestrator) && isPlainObject(orchestrator.options) ? orchestrator.options : {};
    held = isPlainObject(options.inputs) ? options.inputs : {};
  } catch {
    held = {};
  }
  return required.filter(name => !Object.hasOwn(held, name) || held[name] === null || held[name] === undefined);
}

/**
 * How a `workflow` patch differs from the block the file already carries, one
 * phrase per difference; empty when the patch says nothing the file does not.
 * A scalar the patch leaves out is carried forward, so only the ones it sends
 * are compared. A node entry is compared with its `pending` default and its
 * recorded `needs` filled in, because the freeze wrote it that way.
 */
function frozenDifferences(doc, workflow) {
  let frozen;
  try {
    frozen = parseState(doc.text()).workflow;
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  const held = isPlainObject(frozen) ? frozen : {};
  const recorded = isPlainObject(held.nodes) ? held.nodes : {};
  const differences = [];
  const scalars = Object.keys(workflow).filter(key => key !== 'nodes' && !sameValue(workflow[key], held[key]));
  if (scalars.length) differences.push(`changes ${scalars.join(', ')}`);
  const dropped = Object.keys(recorded).filter(id => !Object.hasOwn(workflow.nodes, id));
  if (dropped.length) differences.push(`would drop the frozen node(s) ${dropped.join(', ')}`);
  const added = Object.keys(workflow.nodes).filter(id => !Object.hasOwn(recorded, id));
  if (added.length) differences.push(`adds the node(s) ${added.join(', ')}, which the frozen graph does not carry`);
  // `needs` and `reruns` are carried forward like an omitted scalar: the freeze
  // filled them from the resolved graph, so a retry re-sending the same entries
  // without them is still the same patch.
  const rewritten = Object.keys(workflow.nodes).filter(id => Object.hasOwn(recorded, id)
    && !sameValue({ status: 'pending', needs: recorded[id]?.needs, reruns: recorded[id]?.reruns, ...workflow.nodes[id] },
      recorded[id]));
  if (rewritten.length) differences.push(`would rewrite the recorded entry of ${rewritten.join(', ')}`);
  return differences;
}

/**
 * Value equality between a patch value and one read back from the file. Key
 * order is not compared, and a null is the same as an absent key — the writer
 * emits neither.
 */
function sameValue(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => sameValue(a[key], b[key]));
  }
  return a === b;
}

/**
 * Update node entries in place. Only the entry lines named by the patch move;
 * every other entry keeps its own bytes, which is what makes the preservation
 * guarantee hold on a file the engine adopted rather than wrote.
 *
 * Each entry is held to the run before it moves: its node must be one the run
 * froze, its status one of `NODE_STATUSES`, and its values what the definition
 * declares (`assertValues`). The first two are read off the file and hold for
 * every run; the third needs the definition, so it holds only while the frozen
 * block still proves against it (`frozenGraphOf`).
 */
function applyNodes(doc, nodes, now, changed, ignored, graphOf, undeclared, regress = null) {
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
    // The frozen node map is the run's graph, so a node it does not carry is
    // one no reader will lay out correctly: it was written, joined the
    // dashboard's phases and satisfied nothing, because no node needs it.
    if (!Object.hasOwn(existing, id)) {
      throw new Refusal('state-node-unknown',
        `node ${id} is not in this run's frozen graph, which carries ${Object.keys(existing).join(', ')}. Nothing was `
        + 'written. Correct the node id; a run records progress only on the nodes it froze, and a node its definition '
        + 'gained since belongs to the next run');
    }
    assertStatus(id, patchEntry);
    if (Object.hasOwn(patchEntry, 'values')) {
      const node = resolvedNode(graphOf(), id);
      if (node) assertValues(id, patchEntry.values, node, undeclared);
    }
    // `NODE_ID` admits `constructor`, and the entry map is a bare object
    // literal, so an unguarded read here would merge `Object.prototype`'s
    // member in as the existing entry. Same rule as everywhere else.
    const before = Object.hasOwn(existing, id) ? existing[id] ?? {} : {};
    const resetting = regress !== null && regress.has(id);
    if (!resetting) assertForward(id, patchEntry, before);
    const supplied = { ...patchEntry };
    for (const field of WRITER_FIELDS) {
      if (!Object.hasOwn(supplied, field)) continue;
      delete supplied[field];
      ignored.push(`workflow.nodes.${id}.${field}`);
    }
    const merged = resetting ? reset(before) : stamp(id, supplied, before, now, ignored);
    doc.setNode(id, serializeNode(id, merged, supplied, now));
    changed.push(`workflow.nodes.${id}`);
  }
}

/**
 * A node that ended is not sent back to `pending` by an ordinary write. Its
 * statuses and clocks are the record of what the run did, and a patch that
 * rewound one used to land silently: the clocks survived beside a `pending`
 * status, and nothing said the node had ever run. The one sanctioned way back
 * is a gate's revise option, which resets the stretch in one write and records
 * why on the gate (`gate-revise`); a re-drive goes `running` and keeps its
 * record in the new clock.
 */
function assertForward(id, patchEntry, existing) {
  if (patchEntry.status !== 'pending') return;
  const before = existing.status === undefined || existing.status === null ? null : String(existing.status);
  if (!RECORDED_ENDS.has(before)) return;
  throw new Refusal('state-node-regressed',
    `node ${id} is recorded ${before}, and this write would send it back to pending. Nothing was written. A node that `
    + 'ended is not rewound by a write: to run it again, re-drive it (status running), or answer the gate after it '
    + 'with a revise option, which resets the stretch through gate-revise and records the reason');
}

/**
 * One node of a revise's stretch, reset: `pending`, its clocks and values gone
 * — the next attempt records its own — and its `attempt` one higher, counting
 * from the first attempt as 1. Nothing else on the line moves: the edges, the
 * gate's `reruns` and any field a newer build wrote survive as they were.
 */
function reset(existing) {
  const { started: _started, completed: _completed, values: _values, ...kept } = existing;
  return { ...kept, status: 'pending', attempt: attemptOf(existing) + 1 };
}

/**
 * A node's attempt, counting its first as 1. The hook's reader hands a scalar
 * back as text, so the recorded `2` arrives as `"2"`; anything that is not a
 * positive whole number is a node that was never reset.
 */
export function attemptOf(entry) {
  const value = Number(isPlainObject(entry) ? entry.attempt : undefined);
  return Number.isInteger(value) && value > 0 ? value : 1;
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
      nodeLine(id, stamp(id, patchEntry, {}, now, []));
    } catch {
      throw err;
    }
    throw new Refusal('state-entry-unserializable',
      `the entry already in the file for node ${id} cannot be re-serialised (${err.message}); the patch itself is fine, so the line has to be repaired before this node can be written`);
  }
}

/**
 * A node entry's status, when it carries one, is one of `NODE_STATUSES`. An
 * entry that carries none keeps the status it has, or `pending` at the freeze.
 */
function assertStatus(id, entry) {
  if (!Object.hasOwn(entry, 'status')) return;
  const status = entry.status;
  if (typeof status === 'string' && NODE_STATUSES.includes(status)) return;
  throw new Refusal('state-node-status-unknown',
    `node ${id} cannot be recorded with the status ${JSON.stringify(status)}: a node status is one of `
    + `${NODE_STATUSES.join(', ')}. Nothing was written. Map the node's outcome onto one of them and send the write again`);
}

/**
 * The run's frozen graph as one write sees it: a function returning the graph
 * the frozen `workflow:` block proves against (`provenGraph`), or null when it
 * proves against none — an adopted run that recorded no hash, a definition
 * edited since the freeze, one that can no longer be found. Resolved on the
 * first call and remembered, so a write resolves at most once and a write no
 * check needs the definition for resolves nothing.
 *
 * Null means the definition-backed checks do not run. That is deliberate: the
 * frozen graph is the run's contract, and a definition that no longer hashes
 * to it says nothing reliable about what the run declared.
 */
function frozenGraphOf(doc, runDir) {
  let graph;
  return () => {
    if (graph !== undefined) return graph;
    try {
      const workflow = parseState(doc.text()).workflow;
      graph = isPlainObject(workflow) ? provenGraph(workflow, runDir).graph ?? null : null;
    } catch {
      graph = null;
    }
    return graph;
  };
}

/** A node of a resolved graph by id, or null. */
function resolvedNode(graph, id) {
  return graph ? graph.nodes.find(node => node.id === id) ?? null : null;
}

/**
 * A node's recorded values, held to the outputs its definition declares.
 *
 * A value whose key the node declares must be of the declared type: a `bool`
 * true or false; a `string` or an `id` a string; an `enum` one of its members.
 * A `string`, an `id` or an `enum` may also be null, which is what a skipped
 * node records for them. A wrong type is refused, because a reader acts on it
 * wrongly and says nothing: a guard reading `"false"` finds no bool and
 * refuses at the next gate as if the value were never recorded, and an enum
 * member no declaration lists reaches a reader written for the ones it does.
 *
 * A key the node does not declare is written, and noted in `undeclared`. No
 * reader consumes one — a guard and a `${…}` reference may name only a declared
 * output, and `validate` holds them to it — so refusing it would stop a run
 * over data nothing reads. The two values a `workflow:` node carries about its
 * child are reserved, not undeclared. A type this build does not know is not
 * judged.
 */
function assertValues(id, values, node, undeclared) {
  if (!isPlainObject(values)) return;
  const declared = isPlainObject(node.outputs?.values) ? node.outputs.values : {};
  const child = typeof node.uses === 'string' && node.uses.startsWith(WORKFLOW_SCHEME);
  for (const [key, value] of Object.entries(values)) {
    if (child && RESERVED_VALUES.includes(key)) continue;
    const at = `workflow.nodes.${id}.values.${key}`;
    if (!Object.hasOwn(declared, key)) {
      undeclared.push(at);
      continue;
    }
    const expected = typeMismatch(declared[key], value);
    if (expected === null) continue;
    throw new Refusal('state-value-invalid',
      `${at} is ${JSON.stringify(value)}, but ${id} declares ${key} as ${expected}. Nothing was written. `
      + `Send ${key} as ${expected}; a node's values are replaced whole, so send the node's whole values map again`);
  }
}

/** What a declared value type admits, spelled for a message, when `value` is not it; null when it is. */
function typeMismatch(type, value) {
  if (type === 'bool') return typeof value === 'boolean' ? null : 'bool, true or false';
  if (type === 'string' || type === 'id') {
    return value === null || typeof value === 'string' ? null : `${type}, a string, or null for a skipped node`;
  }
  if (isPlainObject(type) && Array.isArray(type.enum)) {
    return value === null || type.enum.includes(value) ? null : `one of ${type.enum.join(', ')}, or null for a skipped node`;
  }
  return null;
}

/**
 * A gate's recorded answer, held to the options the gate offers. Only a
 * decision that carries an `option` is an answer; a string or a decision in
 * another shape is prose and is not judged. An option the gate does not offer
 * was written before, and the reader that later looked for the chosen option
 * found none of the gate's own.
 */
function assertOptions(id, decisions, gate) {
  if (!Array.isArray(decisions)) return;
  const offered = isPlainObject(gate.options) ? Object.keys(gate.options) : [];
  for (const decision of decisions) {
    if (!isPlainObject(decision) || !Object.hasOwn(decision, 'option')) continue;
    if (offered.includes(decision.option)) continue;
    throw new Refusal('state-gate-option-unknown',
      `node_summaries.${id} records the option ${JSON.stringify(decision.option)}, which the gate ${id} does not offer; `
      + `it offers ${offered.join(', ')}. Nothing was written. Record the id of the option the operator chose, `
      + 'exactly as the gate spells it and never its label, and send the write again');
  }
}

/**
 * The clock fields a status change owes, filled from the system clock and never
 * invented for a transition that did not happen. A full UTC date and time, so
 * `started` and `completed` are orderable against each other.
 *
 * Only a transition stamps. A rewrite that leaves the node where it was keeps
 * the stamp it already has — a `running` node written `running` again has not
 * restarted — and a patch's own `started` or `completed` is dropped and
 * recorded in `ignored`, whatever it says. A node going `running` again after
 * it ended is a new attempt: it gets a new `started`, and the old attempt's
 * `completed` goes, because a running node that reads as finished is the wrong
 * duration in every reader.
 */
function stamp(id, patchEntry, existing, now, ignored) {
  const supplied = { ...patchEntry };
  for (const field of CLOCK_FIELDS) {
    if (!Object.hasOwn(supplied, field)) continue;
    delete supplied[field];
    ignored.push(`workflow.nodes.${id}.${field}`);
  }
  const before = existing.status === undefined || existing.status === null ? null : String(existing.status);
  const merged = { ...existing, ...supplied };
  if (!merged.status) merged.status = 'pending';
  const status = String(merged.status);
  if (STARTS.has(status) && !ONGOING.has(before)) {
    merged.started = now;
    delete merged.completed;
  } else if (STARTS.has(status) && !merged.started) {
    merged.started = now;
  }
  if (ENDS.has(status) && !(ENDS.has(before) && merged.completed)) merged.completed = now;
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

/**
 * The empty `phase_summaries` map, written the first time a run's context block
 * is touched and never again.
 *
 * Every built-in definition's intake prose already required it, and three
 * attended runs of the same definition seeded scalars only — the map was
 * inserted several nodes later by whichever node first wrote a summary. A rule
 * stated in the definition, in the framework patterns and in the former prose twin,
 * and missed three times out of three, is not a rule prose is carrying; so the
 * writer carries it. The map is what a reader of a half-finished run consults
 * to learn that nothing has been decided yet, and its absence reads instead as
 * a run that never had the key.
 *
 * Seeded for every context block, because every context block carries the map
 * in practice: the frozen migration run fixtures both have one, and
 * `migration.md` requires it at intake in the same words `performance.md`
 * does. No shape changes — the key was already part of A1 and an empty object
 * is the value the definitions ask for.
 *
 * It is reported among `changed` only when it was actually written, so a caller
 * cannot read the echo as "the map was re-created" on every later write.
 */
function seedSummaries(doc, contextKey, changed) {
  if (doc.locate([contextKey, 'phase_summaries'])) return;
  doc.set([contextKey, 'phase_summaries'], block('phase_summaries', {}, 2));
  changed.push(`${contextKey}.phase_summaries`);
}

/**
 * `orchestrator.completed_phases` and `orchestrator.failed_phases`, written as
 * empty lists by the write that installs the `workflow:` block.
 *
 * The state contract requires both on every run, and the freeze patch the
 * prose describes never carried them, so every engine-frozen run was invalid
 * from its first write. The reason the writer carries the rule rather than the
 * prose is the one `seedSummaries` gives. A value the file already holds, or
 * one the patch supplies, is left alone: a later write of either is still the
 * whole-list replacement `applyScalars` makes it.
 *
 * `task_ids` is seeded beside them as an empty map. The engine path creates no
 * task items — the state file and the dashboard are the run's tracker — and
 * the empty map is how the contract records that. It is a merged map, so a
 * later write of an entry lands inside it.
 */
function seedSequences(doc, orchestrator, changed) {
  const seeds = [['completed_phases', '[]'], ['failed_phases', '[]'], ['task_ids', '{}']];
  for (const [key, empty] of seeds) {
    if (isPlainObject(orchestrator) && Object.hasOwn(orchestrator, key)) continue;
    if (doc.locate(['orchestrator', key])) continue;
    doc.set(['orchestrator', key], [`  ${key}: ${empty}`]);
    changed.push(`orchestrator.${key}`);
  }
}

/**
 * Free-form keys under the run's context block, beside `phase_summaries:`.
 *
 * Each one replaces, which is right for a free-form key and wrong for the one
 * map beside them: `phase_summaries` sent here would be written whole over
 * every entry earlier phases merged in, and `prior-context` would hand the next
 * delegate only the latest. The top-level `phase_summaries` key is the one
 * shape, so the nested one is refused before anything is set.
 */
function applyContext(doc, contextKey, context, changed) {
  if (!isPlainObject(context)) throw new Refusal('state-patch-invalid', 'the context patch must be an object');
  if (Object.hasOwn(context, 'phase_summaries')) {
    throw new Refusal('state-patch-invalid',
      'phase_summaries is not a context key; send it as the top-level phase_summaries patch key, which merges entry by entry instead of replacing the map');
  }
  for (const [key, value] of Object.entries(context)) {
    doc.set([contextKey, key], block(key, value, 2));
    changed.push(`${contextKey}.${key}`);
  }
}

/**
 * The two summary maps. Both are block maps and both are outside every
 * flow-map rule: prose belongs here, and nowhere near a node entry.
 *
 * `status` on a summary is the five-member vocabulary, so a node status is
 * *mapped* rather than copied. The status mirrored is the node's as it stands
 * once this write's `nodes` patch has landed — the patch's own when it names the
 * node, the one already on disk otherwise — so a summary re-sent in a later call
 * than the one that ended its node still carries the outcome. It used to mirror
 * from the patch alone, and a closing write split across two calls left a
 * summary with no status at all. A `phase_summaries` entry mirrors only when it
 * names the node it belongs to, because its key is a phase key and the two
 * namespaces do not line up.
 *
 * A gate's `node_summaries` entry is where its answer is recorded, so its
 * decisions are held to the options the gate offers (`assertOptions`) while the
 * frozen block proves against the definition.
 */
function applySummaries(doc, contextKey, summaries, nodePatch, kind, changed, runDir = null, graphOf = null) {
  if (!isPlainObject(summaries)) throw new Refusal('state-patch-invalid', `the ${kind} summaries must be an object`);
  let recorded = null;
  let run = null;
  for (const [key, value] of Object.entries(summaries)) {
    if (!isPlainObject(value)) throw new Refusal('state-patch-invalid', `the summary ${key} must be an object`);
    const entry = { ...value };
    if (kind === 'node' && graphOf !== null && Object.hasOwn(entry, 'decisions')) {
      const gate = resolvedNode(graphOf(), key);
      if (gate?.type === 'gate') assertOptions(key, entry.decisions, gate);
    }
    if (kind === 'node' && Array.isArray(entry.decisions)) {
      recorded ??= recordedNodes(doc);
      if (Object.hasOwn(recorded, key) && recorded[key]?.kind === 'gate') {
        entry.decisions = [...earlierRevisions(doc, key, entry.decisions), ...entry.decisions];
      }
    }
    if (!('status' in entry)) {
      const nodeId = kind === 'node' ? key : entry.node;
      // Both reads are own-property reads for the reason `contextBlock` gives:
      // a summary keyed `constructor` reached the patch's prototype, and a
      // status of `constructor` reached `Object.prototype.constructor`.
      let nodeStatus = nodeId && isPlainObject(nodePatch) && Object.hasOwn(nodePatch, nodeId)
        ? nodePatch[nodeId]?.status
        : undefined;
      if (nodeStatus === undefined && typeof nodeId === 'string') {
        recorded ??= recordedNodes(doc);
        nodeStatus = Object.hasOwn(recorded, nodeId) ? recorded[nodeId]?.status : undefined;
      }
      const mirrored = mirrorOf(nodeStatus);
      if (mirrored) entry.status = mirrored;
    }
    if (kind === 'node' && entry.status === 'completed' && runDir !== null) {
      run ??= runOf(doc, runDir);
      registerArtifacts(entry, key, run);
    }
    const at = kind === 'node' ? ['node_summaries', key] : [contextKey, 'phase_summaries', key];
    doc.set(at, block(key, entry, kind === 'node' ? 2 : 4));
    changed.push(at.join('.'));
  }
}

/**
 * The revise decisions a gate already recorded that this write's `decisions`
 * leaves out, in the order they were recorded. A gate's decisions are its
 * history across attempts, and an answer is written the way it always was — the
 * one decision taken now — so without this a later answer replaced the note
 * that sent the run back, and nothing said the gate had ever been revised. A
 * revise decision is the one that carries an `attempt`; any other is replaced
 * as before.
 */
function earlierRevisions(doc, gate, decisions) {
  let summaries;
  try {
    summaries = parseState(doc.text()).node_summaries;
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  const held = isPlainObject(summaries) && Object.hasOwn(summaries, gate) && isPlainObject(summaries[gate])
    ? summaries[gate].decisions : null;
  if (!Array.isArray(held)) return [];
  return held.filter(decision => isPlainObject(decision) && Object.hasOwn(decision, 'attempt')
    && !decisions.some(sent => sameValue(sent, decision)));
}

/**
 * What a completing summary is checked against: the run directory and the
 * project root it sits in, the definition's declared outputs, the node entries
 * as this write leaves them and the `html_output` option. A definition that
 * cannot be resolved yields no declared outputs and never fails the write, for
 * the reason `definitionOf` gives.
 */
function runOf(doc, runDir) {
  let state = {};
  try {
    state = parseState(doc.text());
  } catch {
    state = {};
  }
  let definition = null;
  try {
    definition = definitionOf(state, runDir);
  } catch {
    definition = null;
  }
  const workflow = isPlainObject(state.workflow) ? state.workflow : {};
  return {
    runDir,
    root: projectRootOf(runDir),
    definition,
    nodes: isPlainObject(workflow.nodes) ? workflow.nodes : {},
    html: htmlOutput(state),
  };
}

/**
 * A completing node summary carries the artifacts its node declared and the
 * companions beside them, whether or not the closing write listed them.
 *
 * The declared outputs are the definition's own promise of what the node
 * writes, and the dashboard and finalization's inventory both read the node
 * summary for them — a closing write that forgot the list left the report
 * unlinked although it sat on disk. Two additions, both bounded to what
 * exists:
 *
 * - every declared literal path that exists, as a file or as a directory, and
 *   that the summary does not already name, is appended as
 *   `{path, label: null, html}`, spelled relative to the run directory
 *   (`registeredPath`);
 * - every registered `.md` file with no `html` gains the sibling `.html` when
 *   that file exists and the run's `html_output` is not off. A directory has
 *   no companion.
 *
 * Nothing is removed and nothing the summary states is overwritten. An
 * interpolated path (`${...}`) is someone else's output, so it is not claimed.
 * A declared directory used to be skipped as though it were missing, because
 * only a file counted as present.
 */
function registerArtifacts(entry, nodeId, run) {
  const nodes = isPlainObject(run.definition?.nodes) ? run.definition.nodes : {};
  const node = Object.hasOwn(nodes, nodeId) && isPlainObject(nodes[nodeId]) ? nodes[nodeId] : {};
  const declared = isPlainObject(node.outputs?.artifacts) ? Object.values(node.outputs.artifacts) : [];
  const artifacts = Array.isArray(entry.artifacts) ? [...entry.artifacts] : [];
  const pathOf = item => (typeof item === 'string' ? item : isPlainObject(item) ? item.path : undefined);
  const named = new Set(artifacts.map(pathOf));
  const literal = relative => typeof relative === 'string' && relative !== '' && !path.isAbsolute(relative)
    && !relative.includes('${');
  const exists = relative => literal(relative)
    && (isFile(path.join(run.runDir, relative)) || isDirectory(path.join(run.runDir, relative)));
  const companion = relative => {
    if (!run.html || !literal(relative) || !relative.endsWith('.md')) return null;
    if (isDirectory(path.join(run.runDir, relative))) return null;
    const html = `${relative.slice(0, -'.md'.length)}.html`;
    return isFile(path.join(run.runDir, html)) ? html : null;
  };
  const registered = registeredPath(node, nodeId, run);

  let touched = false;
  for (const declaredPath of declared) {
    const relative = registered(declaredPath);
    if (relative === null || named.has(relative) || !exists(relative)) continue;
    artifacts.push({ path: relative, label: null, html: companion(relative) });
    named.add(relative);
    touched = true;
  }
  for (let i = 0; i < artifacts.length; i++) {
    const item = artifacts[i];
    if (isPlainObject(item) && item.html !== null && item.html !== undefined) continue;
    const html = companion(pathOf(item));
    if (html === null) continue;
    artifacts[i] = typeof item === 'string' ? { path: item, label: null, html } : { ...item, html };
    touched = true;
  }
  if (touched) entry.artifacts = artifacts;
}

/**
 * How a node's declared artifact paths are spelled in its summary: relative to
 * the run directory, which is what the dashboard links them against. Returns a
 * function from a declared path to that spelling, or to null when the path is
 * not this run's to claim.
 *
 * For every scheme but `workflow:` a declared path is already that spelling. A
 * `workflow:` node's declared paths are the child's, written into the child's
 * own task directory, so each is joined onto the `values.task_path` the node
 * recorded and spelled back relative to this run — `../../<type>/<run>/<path>`,
 * the one spelling that both resolves on disk and links from the parent's
 * dashboard. Joined onto this run's directory instead, they claimed whatever
 * file of that name the parent happened to hold. A `workflow:` node with no
 * usable `task_path` — none recorded yet, or one that leaves the project —
 * registers nothing, because there is no child directory to look in.
 */
function registeredPath(node, nodeId, run) {
  if (typeof node.uses !== 'string' || !node.uses.startsWith(WORKFLOW_SCHEME)) return declared => declared;
  const recorded = Object.hasOwn(run.nodes, nodeId) && isPlainObject(run.nodes[nodeId]) ? run.nodes[nodeId] : {};
  const taskPath = isPlainObject(recorded.values) ? recorded.values.task_path : undefined;
  if (typeof taskPath !== 'string' || taskPath === '' || path.isAbsolute(taskPath)) return () => null;
  const child = path.resolve(run.root, taskPath);
  if (!child.startsWith(`${run.root}${path.sep}`)) return () => null;
  return declared => {
    if (typeof declared !== 'string' || declared === '' || path.isAbsolute(declared) || declared.includes('${')) return null;
    return path.relative(run.runDir, path.resolve(child, declared)).split(path.sep).join('/');
  };
}

/**
 * The other half of the same rule: a node whose status changes after its
 * summary was written carries the new status onto that summary. Only a
 * `node_summaries` entry already on disk and not written by this patch is
 * touched — one this patch wrote was mirrored as it was written — and only its
 * `status` line, so the prose beside it stays byte-identical.
 */
function mirrorOntoRecorded(doc, nodePatch, summaryPatch, changed) {
  for (const [id, patchEntry] of Object.entries(nodePatch)) {
    if (isPlainObject(summaryPatch) && Object.hasOwn(summaryPatch, id)) continue;
    const mirrored = mirrorOf(patchEntry?.status);
    if (!mirrored || !doc.locate(['node_summaries', id])) continue;
    doc.set(['node_summaries', id, 'status'], [`    status: ${mirrored}`]);
    changed.push(`node_summaries.${id}.status`);
  }
}

/** A node status in the summary vocabulary, or undefined when it has none. */
function mirrorOf(nodeStatus) {
  const statusKey = nodeStatus === undefined || nodeStatus === null ? '' : String(nodeStatus);
  return Object.hasOwn(STATUS_MIRROR, statusKey) ? STATUS_MIRROR[statusKey] : undefined;
}

/** The node entries as they stand in the document, through the hook's own reader. */
function recordedNodes(doc) {
  try {
    return scanState(doc.text()).nodes ?? {};
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/**
 * A field name in a node entry, emitted raw between the braces.
 *
 * `canonical.flow` guards the keys of a nested map inside a value; this guards
 * the entry's own field names, which the node serializer emits itself and which
 * therefore never pass through the emitter's key check. Same rule, same code:
 * `value-not-flow-safe` is what the entry serializer already tells apart from a
 * fault in the file.
 */
function assertFlowKey(key, where) {
  if (!BLOCK_KEY.test(key)) {
    throw new Refusal('value-not-flow-safe',
      `${where}.${JSON.stringify(String(key))} is not a usable flow-map key`);
  }
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

/**
 * One whole-file write, temp-then-rename, under the one allow-listed name.
 *
 * The publish path itself is `canonical.commit`; what stays here is the pair of
 * facts only this writer knows — the frozen temp name and this module's own
 * refusal codes.
 */
function commit(state, text) {
  const tmp = path.join(path.dirname(path.resolve(state)), TMP_NAME);
  canonical.commit({ target: state, text, tmp, codes: COMMIT_CODES });
}
