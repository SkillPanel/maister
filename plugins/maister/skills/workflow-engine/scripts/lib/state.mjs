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
 * file somebody edited by hand — a gate answered with editor tools, or a
 * repair — is normalized whole on the first write: the indent walk re-emits
 * every line at the canonical column, and whole-line comments inside the nodes
 * region are relocated above `nodes:`. Content survives; the bytes of a
 * hand-edited file do not. After that first write the file is canonical and
 * the byte-level guarantee holds for every write after it.
 *
 * Three properties are load-bearing, and each exists because breaking it blocks
 * an operator rather than merely looking wrong:
 *
 *   canonical indent   Two readers consult these files and they are not
 *                      equivalent. The shared reader derives each block's
 *                      child column from that block's first child; a
 *                      fixed-width reader assumes two and four spaces. A file
 *                      written uniformly at another width is read correctly by
 *                      one and read as *empty* by the other, and an empty node
 *                      map beside a present `workflow:` key is exactly what the
 *                      pending predicate treats as a run awaiting an operator.
 *                      Column 0 / 2 / 4 / +2 is the only emission both read
 *                      identically.
 *
 *   never mixed        Emitting a canonical block into a file whose other
 *                      blocks sit at another column is the one thing the
 *                      shared reader actively rejects. Adoption therefore normalizes the
 *                      whole file or refuses; it never normalizes a part of it.
 *
 *   the oracle         Before renaming, the candidate text goes through the
 *                      shared reader, imported rather than approximated.
 *                      The reader has more throw paths than any short list
 *                      captures, and a hand-written copy of it drifts.
 *
 * One whole-file write per invocation, temp-then-rename, and the temp file is
 * named exactly `orchestrator-state.yml.tmp` because a fixed name is what a
 * permission rule or hook can match (ADR-0012).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The shared reader lives in the plugin root's `lib/`, because more than one
// skill reads state through it.
import { scanState, unansweredRequests } from '../../../../lib/state-scan.mjs';
// `gate_pending: null` is the commit point of a decision, so this module is the
// one that learns a gate was answered. The index has to learn it here too:
// regenerating it only when the *next* gate is asked left every run's final
// gate reading `pending` forever. The renderer is a separate module so the gate
// writer can import it without a cycle.
import { syncIndex, INDEX_FILE, REQUEST_SUFFIX } from './gate-index.mjs';
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
import { MORE_DETAILS_ID, TARGET_NAME, foldDefinition, locateWorkflow, resolve as resolveGraph } from './graph.mjs';
import { displayOf, humanize, labelOf, titleOf } from './display.mjs';
import { ARTIFACT_ROLES, DECISION_BY, HEADLINE_MAX, RISK_TAGS, PROVENANCE_KEYS, attemptNumber, decisionOf, fixOf, gateAnswer, isEarlierAnswer, oneLine, withPersonActor, withProvenance } from './items.mjs';
import { foldAnswer, requestQuestions } from './question-set.mjs';
import { loadPolicy, triageFor } from './policy.mjs';
// The display files, a projection of this write on the dashboard's terms. Like
// `dashboard.mjs` it knows nothing of this module, which keeps the edge acyclic.
import { DISPLAY_DIR, publishRun } from './display-files.mjs';
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
 * module keeps its closed twenty-five-code vocabulary.
 */
const COMMIT_CODES = { unwritable: 'state-unwritable', tempExists: 'state-temp-exists' };

/** The one temp name this writer uses. Not configurable. */
const TMP_NAME = 'orchestrator-state.yml.tmp';

/** Reported among `changed` when a decision closes the run's gate index. */
const GATE_INDEX = 'gates/index.yml';

/**
 * The projection's two file names, frozen for the same reason `TMP_NAME` is
 * (ADR-0012). Both dashboard files are engine-owned, and
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
 * reported failure. So the writer's documented twenty-five-code vocabulary does not
 * grow and neither code is owed a recovery row.
 */
const DASHBOARD_CODES = { unwritable: 'dashboard-unwritable', tempExists: 'dashboard-temp-exists' };

/**
 * The core-optional top-level blocks the writer reaches by name.
 *
 * These are siblings of `orchestrator:` and of the run's per-workflow context
 * block, never children of either. The contract tolerates a file that nests
 * `project_context` under `task_context` — it reports that shape rather than
 * refusing it — but the writer never produces it: every key here is located and
 * emitted at column 0, so a nested twin a hand-edited file carries is left
 * where it is and the canonical sibling is written beside it.
 *
 * They are listed separately from the rest of the vocabulary because the
 * writer's vocabulary is exactly this list plus the four keys below that are
 * not top-level blocks at all.
 */
const TOP_LEVEL_BLOCKS = ['project_context', 'related_tasks', 'verification_context', 'external_research'];

/**
 * The closed patch vocabulary. An unknown key is an error, not a no-op.
 *
 * Four of these name no top-level block: `nodes` edits entries inside
 * `workflow.nodes`, `context` and `phase_summaries` are written into whichever
 * per-workflow context block the run resolves to, and `workflow` and
 * `node_summaries` are the two engine blocks. Everything else is a core
 * top-level block spelled exactly as the state contract spells it.
 */
const PATCH_KEYS = ['orchestrator', 'task', 'workflow', 'nodes', 'context', 'phase_summaries', 'node_summaries',
  ...TOP_LEVEL_BLOCKS];

/**
 * Fixed key order inside a one-line node entry. `attempt`, `reruns` and `sets`
 * are written only where they mean something — a node a revise has reset, a
 * gate that offers a revise, a gate whose continue options set its values — so
 * every other line keeps the bytes it always had.
 */
const NODE_KEYS = ['kind', 'status', 'attempt', 'started', 'completed', 'needs', 'reruns', 'sets', 'on', 'values', 'dir',
  'provider', 'session'];

/**
 * The node fields only this writer fills: `attempt` counts the revisions a
 * node has been reset by, `reruns` is the freeze's record of where each of a
 * gate's revise options sends the run, and `sets` its record of the values
 * each of a gate's continue options sets. A patch that carries any of them has
 * it dropped and noted, like a clock field — a counter a caller could set is a
 * budget a caller could reset, and a value map a caller could set is an answer
 * the operator never gave.
 */
const WRITER_FIELDS = ['attempt', 'reruns', 'sets'];

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
 * The two are kept character-for-character identical on purpose. A writer
 * looser than the graph is the more dangerous half of a disagreement: this is
 * the component that takes arbitrary JSON on stdin, so every id the graph would
 * never produce — `__proto__` among them — reached the file through it.
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
 * fields obey.
 *
 * `MIDNIGHT` is a separate test rather than a tighter pattern: a pattern that
 * excluded it would also exclude the one legal midnight, and the rule is
 * "measured, not formatted", which is a claim about where the value came from.
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
 * writer to produce. The write would report success, the shared reader would
 * still find the first `workflow:` block and accept it, and the first consumer
 * with a real YAML parser would fail on a duplicate key — a blocked session reached
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
 * `gap-analysis` writes the `e2e_enabled` seed, `verification-options` writes
 * six more — and a replacing write meant an operator who had deliberately set
 * `html_output: false` silently got the dashboard and every companion report
 * back at the next option write, through the success path. `task_ids`,
 * `auto_fix_attempts` and `skipped_phases` are keyed by phase or node and are
 * filled in the same way, one entry per node as the run reaches it.
 *
 * Everything else under `orchestrator:` replaces, and deliberately:
 *
 *   driver          A closed contract shape, written whole by the engine at
 *                   init and rewritten whole by the daemon. Merged, a write
 *                   demoting a run to `{kind: terminal}` would leave the
 *                   cockpit's `cwd` and `session` standing beside it — a
 *                   combination the state contract does not describe and no
 *                   writer meant.
 *   gate_pending    One contract-shaped value, validated whole before it is
 *                   emitted. Merged, a write clearing the marker would leave
 *                   the answered gate's `node` and `request` standing beside a
 *                   null nobody wrote — a marker every reader would still read
 *                   as pending.
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
 * `task:` carries no open map at all (`title`, `status`, `description`,
 * `tags[]`, `priority`, `key`), so nothing under it merges and the list stays
 * qualified by its section rather than by key alone.
 *
 * A future open map added to the state contract must be added here too: the
 * default is to replace, so a mapping absent from this list is replaced
 * silently.
 */
const MERGED_MAPS = new Set([
  'orchestrator.options',
  'orchestrator.task_ids',
  'orchestrator.auto_fix_attempts',
  'orchestrator.skipped_phases',
]);

/**
 * The five context blocks the built-in workflows write. Any other workflow's
 * block is derived from its name (`contextBlockOf`), and the root accepts
 * exactly one, so which one a write means has to be derived rather than
 * assumed.
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
 * Returns `{ok, changed, errors, warnings, ignored, undeclared, policyWarnings}`. On a refusal `changed` is empty and
 * the file on disk is byte-for-byte what it was: every check that can refuse runs
 * before the rename, and the rename is the only thing that publishes a write.
 *
 * A write that installs `workflow:` into a file that carried none — the freeze —
 * also installs the dashboard viewer (see `installViewer`) and returns `banner`,
 * the startup lines `workflow.mjs` prints after the paths.
 *
 * `warnings` carries what went wrong *after* the write landed: the dashboard
 * projection, the viewer and the display files. It is data rather than a stderr line
 * because no module under `scripts/lib/` performs stdio: every refusal already
 * travels to `workflow.mjs` as data and is printed there, and this is the same
 * journey for something that is not a refusal.
 *
 * `policyWarnings` is kept apart from `warnings`: those name a file this write
 * did not publish, while these are code strings (`policy-refused:…`) about the
 * autonomy policy the write read, each printed as its own `warning:` line.
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
  // What the autonomy policy loader reported, as code strings; see above.
  const policyWarnings = [];
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
    for (const key of apply(doc, patch, changed, now, path.dirname(path.resolve(state)), ignored, undeclared, regress, policyWarnings)) allowed.add(key);
    const text = doc.text();
    selfCheck(text, state, allowed);
    // Before the state commit, so a refusal out of the index leaves the state
    // file exactly as it was — `writeState`'s standing promise. The index is a
    // mirror of the request files, which already carry the answer by the time
    // this write is issued, so refreshing it early is never wrong: it is the
    // state file that is about to catch up, not the index. The projection below
    // sits on the other side of the commit, for the opposite reason.
    if (settled(text) && syncIndex(path.dirname(path.resolve(state)))) {
      changed.push(GATE_INDEX);
    }
    commit(state, text);
    // After the commit, and the asymmetry against `syncIndex` above is
    // deliberate: the index mirrors request files that are already on disk, so
    // publishing it early can never be wrong, while the dashboard is a projection
    // OF THIS WRITE — projected before the rename it would describe a state the
    // run might never have. A projection failure is a warning and never a refusal:
    // the state write already landed and un-publishing it is not on offer.
    project(state, text, now, changed, warnings);
    const freeze = Boolean(patch.workflow) && !hadWorkflow;
    if (freeze) createFolders(state, text, warnings);
    if (freeze) installViewer(state, text, changed, warnings);
    const banner = freeze ? bannerOf(state, text, patch.workflow) : null;
    // After the viewer, so the status file's dashboard link sees the page the
    // freeze just installed; on the projection's terms, a warning at worst.
    warnings.push(...display(state, text, now, banner));
    const result = { ok: true, changed, errors: [], warnings, ignored, undeclared, policyWarnings };
    if (freeze) result.banner = [BANNER_RELAY, ...banner.lines].map(line => `${line}\n`).join('');
    return result;
  } catch (err) {
    if (err instanceof Refusal) {
      return { ok: false, changed: [], errors: [{ code: err.code, message: err.message }], warnings };
    }
    throw err;
  }
}

/**
 * The startup banner: its lines — the workflow and the task, how many checkpoints
 * the user will be asked at, where the run lives and its dashboard, and the
 * first phase by its title. The freeze returns them under a first line telling
 * the orchestrating model to tell the user what they say, each line ending in
 * a newline, and the run's `display/banner.json` holds them without that line.
 *
 * It is data for the same reason `warnings` is: no module under `scripts/lib/`
 * performs stdio. It exists so the user learns where a run lives from a
 * channel that always renders — the freeze's own output — rather than from a
 * paragraph the orchestrating model may or may not compose. Runs showed the
 * output itself is not enough: it landed in a collapsed tool result after the
 * changed paths, and the model moved straight on. So the writer prints it first,
 * opening on the instruction to tell the user, and the changed paths follow.
 * The model composes its own message from it: the terminal collapses tool
 * output to a count, so nothing here is seen until the model writes it.
 * The dashboard line reads the committed state, so an `html_output: false` the
 * same patch carries is already in force. Beside the lines, the same facts as
 * fields — the counts as numbers, the directory and dashboard as `file://`
 * URLs — for the display file, whose reader draws them its own way.
 */
function bannerOf(state, text, workflow) {
  const runDir = path.dirname(path.resolve(state));
  const doc = parseState(text);
  const title = isPlainObject(doc.task) ? doc.task.title : undefined;
  // Folded onto one line: a hand-written file can carry a block-scalar title,
  // and its line breaks would add lines to a banner of fixed lines.
  const folded = title === undefined || title === null ? '' : String(title).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const lines = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const nodes = Object.keys(lines);
  const gates = nodes.filter(id => isPlainObject(lines[id]) && lines[id].kind === 'gate').length;
  const { titles } = displayOfRun(doc, runDir);
  const name = typeof workflow.name === 'string' && workflow.name !== '' ? humanize(workflow.name) : 'Workflow';
  const checkpoints = gates > 1 ? `up to ${gates}` : gates === 1 ? 'one' : 'none';
  const dashboard = htmlOutput(doc) ? pathToFileURL(path.join(runDir, VIEWER)).href : null;
  const first = nodes.length ? titleOf(titles, nodes[0]) : null;
  return {
    lines: [
      `Maister run started: ${name}`,
      `Task: ${folded !== '' ? folded : '(untitled)'}`,
      `Checkpoints: ${checkpoints}${gates ? ' where you decide' : ''}`,
      `Directory: ${runDir}`,
      `Dashboard: ${dashboard ?? 'none (html_output is false)'}`,
      `First phase: ${first ?? '(none)'}`,
    ],
    workflow: name,
    task: folded !== '' ? folded : null,
    checkpoints: gates,
    first_phase: first,
    run_dir: runDir,
    run_url: pathToFileURL(runDir).href,
    dashboard,
  };
}

/** The banner's first line, read by the orchestrating model rather than shown. */
export const BANNER_RELAY = 'Tell the user, in your own message before any other call: the workflow and the task, the checkpoints, the directory, the dashboard and the first phase below.';

/**
 * Does the state this write produces have no gate pending?
 *
 * The test is the resulting state, not the patch. A driver's answer is folded
 * with editor tools, `gate_pending: null` written last, and then re-validated
 * through this writer with the empty patch — a patch that never mentions the
 * marker, on the one write that closes the gate's row. While a marker is set
 * the gate writer owns the index and regenerates it in its own call, so a
 * write then leaves it alone; with none set, the index is synced and reported
 * only when its bytes change.
 */
function settled(text) {
  const orchestrator = parseState(text).orchestrator;
  if (!isPlainObject(orchestrator)) return true;
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
      declared: declaredOf(doc, definition, runDir),
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
 * Publish the run's display files from the state this write just committed —
 * the status, the banner at the freeze, the session's pointer — on the
 * projection's terms: every failure is a warning, and nothing here reaches
 * `writeState`'s outer `catch`. The files and why each exists are
 * `display-files.mjs`'s to say.
 */
function display(state, text, now, banner) {
  try {
    const runDir = path.dirname(path.resolve(state));
    const doc = parseState(text);
    const definition = definitionOf(doc, runDir);
    return publishRun({
      runDir,
      root: projectRootOf(runDir),
      doc,
      now,
      titles: displayOfRun(doc, runDir).titles,
      dashboard: dashboardUrl(doc, runDir),
      artifacts: artifactsOf(doc, runDir),
      progress: progressOf(doc, definition, runDir),
      verifier: dashboard.verifierNodeOf(definition),
      banner,
    });
  } catch (err) {
    return [{ file: DISPLAY_DIR, code: 'display-unwritable', message: err && err.message ? String(err.message) : String(err) }];
  }
}

/**
 * Every artifact path the run's nodes declare, relative to the run directory,
 * sorted and each once — for a reader that tells a run's own outputs from the
 * other files written into its folder. A path outside the run directory (a
 * sub-run's) is left out; so is every path when the definition cannot be read.
 */
function artifactsOf(doc, runDir) {
  const paths = new Set();
  for (const declared of Object.values(declaredOf(doc, definitionOf(doc, runDir), runDir))) {
    for (const spelled of Object.values(declared)) {
      if (typeof spelled === 'string' && spelled !== '' && !spelled.startsWith('..')) paths.add(spelled);
    }
  }
  return [...paths].sort();
}

/**
 * Create the folders the run's declared artifacts open with, at the freeze
 * only — `analysis/`, `implementation/`, or whatever a project's own workflow
 * names — so a node or an agent writing a declared artifact finds its folder
 * there. Prose saying the folders existed was read literally: an agent whose
 * tools create no parent folder stopped on one nobody had made, and an
 * instruction to make them is one a model can skip, where the freeze cannot be.
 *
 * The first segment only, and never one that is itself a declared artifact:
 * a deeper folder can be a directory artifact (`analysis/design-context`)
 * whose absence is how the run tells a step that wrote nothing. A sub-run's
 * artifacts belong to its own run, which makes its own. An existing folder is
 * left as it is. Folders are not files, so `changed` does not list them; a
 * failure is a warning after a write that already landed, on the viewer's
 * terms, and never a refusal.
 */
function createFolders(state, text, warnings) {
  const runDir = path.dirname(path.resolve(state));
  const declared = artifactsOf(parseState(text), runDir);
  const folders = new Set(declared.filter(each => each.includes('/')).map(each => each.split('/')[0]));
  for (const folder of folders) {
    if (folder === '' || folder === '.' || declared.includes(folder)) continue;
    try {
      fs.mkdirSync(path.join(runDir, folder), { recursive: true });
    } catch (err) {
      warnings.push({ file: `${folder}/`, code: 'folder-uncreated', message: err && err.message ? String(err.message) : String(err) });
    }
  }
}

/**
 * Copy the dashboard viewer into the run directory, at the freeze only.
 *
 * `dashboard-data.js` is regenerated on every write, but it is only data; the
 * page that renders it is a static file the run directory needs once, so the
 * freeze — the write that starts a run — installs it.
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

/**
 * Each node's declared artifact paths, keyed by node id and then by artifact
 * key, spelled the way the node's summary registers them (`registeredPath`), so
 * a sanctioned absence on the dashboard names the path its hero card and its
 * phase would have linked. Empty when the definition cannot be read: the
 * projection then shows the reason without a path rather than guessing one.
 */
function declaredOf(doc, definition, runDir) {
  const declared = {};
  const nodes = isPlainObject(definition?.nodes) ? definition.nodes : {};
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const run = { runDir, root: projectRootOf(runDir), nodes: isPlainObject(workflow.nodes) ? workflow.nodes : {} };
  for (const [id, node] of Object.entries(nodes)) {
    if (!isPlainObject(node) || !isPlainObject(node.outputs?.artifacts)) continue;
    const registered = registeredPath(node, id, run);
    const paths = {};
    for (const [key, declaredPath] of Object.entries(node.outputs.artifacts)) {
      const spelled = typeof declaredPath === 'string' && !declaredPath.includes('${') ? registered(declaredPath) : null;
      if (spelled !== null) paths[key] = spelled;
    }
    declared[id] = paths;
  }
  return declared;
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
function apply(doc, patch, changed, now, runDir, ignored, undeclared, regress = null, policyWarnings = []) {
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
  // `policy_hash` is the freeze's own record of the policy it applied, so a
  // patch value for it is dropped the same way, on every write.
  if (isPlainObject(orchestrator) && Object.hasOwn(orchestrator, 'policy_hash')) {
    const { policy_hash: _supplied, ...rest } = orchestrator;
    orchestrator = rest;
    ignored.push('orchestrator.policy_hash');
  }

  // Before the patch's own `orchestrator` keys, so the seeded sequences open
  // the block and a freeze's `parent` still follows every key the patch sends.
  if (patch.workflow) {
    seedSequences(doc, orchestrator, changed);
    seedCreated(doc, orchestrator, now, changed);
    if (!doc.has('workflow')) seedPolicyHash(doc, changed, policyWarnings);
  }
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
  if (patch.nodes && markStarted(doc, patch, changed)) intended.add('task');
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
  if (runDir !== null) copyDrivenProvenance(doc, runDir, changed);
  stampGateValues(doc, patch, changed);
  judgeGates(doc, patch, changed, runDir, policyWarnings);
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
 * `task.status: in_progress`, written by the first write that moves a node off
 * `pending`: the moment the run starts executing. The freeze sets the run up and
 * runs nothing, so it writes no status, and nothing else ever wrote this one —
 * a run read as starting from its first step to its last. Every kind of run
 * records its nodes through this writer, so a sub-run and a chain run get it
 * the same way a top-level run does. A status already recorded other than
 * `pending` is left alone — the endings a closing patch writes above all — and
 * so is a write that sends `task.status` itself. Whether it wrote.
 */
function markStarted(doc, patch, changed) {
  if (isPlainObject(patch.task) && Object.hasOwn(patch.task, 'status')) return false;
  const moved = Object.values(patch.nodes).some(entry => isPlainObject(entry)
    && typeof entry.status === 'string' && entry.status !== 'pending');
  if (!moved) return false;
  const status = parseState(doc.text()).task?.status;
  if (typeof status === 'string' && status !== '' && status !== 'pending') return false;
  doc.set(['task', 'status'], [`  status: ${flow(STARTED, 'task.status')}`]);
  changed.push('task.status');
  return true;
}

/** The status a running run records. */
const STARTED = 'in_progress';

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
 * The pending-gate marker, validated whole before anything is emitted.
 *
 * Two spellings are legal and there is no third: the literal `null`, and a
 * `{node, request, since}` map that goes onto one line. Everything else refuses
 * under the one code name this key has always used — the refusal vocabulary is
 * closed and does not grow because a value gained a second legal form.
 *
 * The strictness is not pedantry; each rule is a way a session gets blocked
 * by a write that reported success:
 *
 *   an extra or missing key    A marker without `node` is a pending run no
 *                              reader can name a gate for, and a nested value
 *                              is the one shape the one-line reader throws on.
 *
 *   a string, however spelled  This is the sharp edge. `flow()` passes a value
 *                              that is *already* a balanced flow collection
 *                              through verbatim, so a caller sending the marker
 *                              as text — with a trailing comment, or with an
 *                              embedded quote — would have those bytes land on
 *                              the line. `stripComment` in the reader does not
 *                              strip a comment from a line that opens with `{`,
 *                              so the parse throws.
 *                              Only a real object is accepted, so the emitter
 *                              spells the line and nothing else can.
 *
 *   `request` naming `node`    A writer-side rule: a `request` naming another
 *                              node would leave the answer no file to be
 *                              written into — a gate that can be neither
 *                              answered nor cleared.
 *
 *   a non-midnight `since`     Midnight is the signature of a date that was
 *                              formatted rather than measured, so the writer
 *                              refuses it here.
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
    return refuse(`the request file ${value.request} names another node than ${value.node}, so the answer would have no request file to be written into`);
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
 * The map is the one-line flow map this writer emits, re-emitted on its one
 * line with the keys it already carried kept **verbatim**. Keeping the existing
 * values as raw text rather than re-serialising them is what stops a quoted
 * scalar from being re-quoted, or a nested flow map from being flattened, by a
 * write that never named it.
 *
 * Three shapes cannot be merged into. A value that is not a map at all
 * (`options: null` is the one that occurs) is replaced, since there are no keys
 * to keep. A block map — one key per line — is a shape this writer never
 * produces, so it was written by hand; it refuses rather than being flattened
 * or edited child by child, because a writer that accepted it would be keeping
 * a second state layout alive for files nothing writes any more. And a value
 * that opens as a flow map and then cannot be read back refuses rather than
 * being replaced — dropping keys the caller cannot see is the defect this
 * function exists to fix, and doing it on a parse failure would be the same
 * loss by another route.
 */
function mergeMap(doc, section, key, value, changed) {
  const where = `${section}.${key}`;
  const entries = Object.entries(value);
  // Guarded before anything is located, so a refusal costs no edit.
  for (const [name] of entries) assertBlockKey(name);

  const found = doc.locate([section, key]);
  if (found && found.inline === '') {
    throw new Refusal('state-unreadable',
      `${where} is written as a block map, one key per line, which this writer never produces: the file was edited by hand. `
      + `Nothing was written. Repair it to one line, ${key}: {<key>: <value>, …}, before writing this key again`);
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
 * nodes is read as a run awaiting an operator.
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
    const { attempt: _attempt, reruns: _reruns, sets: _sets, ...sent } = entry;
    filled[id] = { ...sent, needs: byId.get(id).needs };
    const reruns = rerunsOf(byId.get(id));
    if (reruns) filled[id].reruns = reruns;
    const sets = setsOf(byId.get(id));
    if (sets) filled[id].sets = sets;
  }
  return filled;
}

/**
 * A gate's continue options that set its values, as `{option: {key: bool}}`,
 * or null when none does. Recorded at the freeze for the reason `rerunsOf`
 * gives: the writer stamps the chosen option's values on the gate from the
 * state alone, never re-resolving the definition.
 */
function setsOf(node) {
  if (node?.type !== 'gate' || !isPlainObject(node.options)) return null;
  const sets = {};
  for (const [option, value] of Object.entries(node.options)) {
    if (isPlainObject(value) && value.effect === 'continue' && isPlainObject(value.sets)) sets[option] = { ...value.sets };
  }
  return Object.keys(sets).length ? sets : null;
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
  // `needs`, `reruns` and `sets` are carried forward like an omitted scalar: the
  // freeze filled them from the resolved graph, so a retry re-sending the same
  // entries without them is still the same patch.
  const rewritten = Object.keys(workflow.nodes).filter(id => Object.hasOwn(recorded, id)
    && !sameValue({
      status: 'pending', needs: recorded[id]?.needs, reruns: recorded[id]?.reruns, sets: recorded[id]?.sets, ...workflow.nodes[id],
    }, recorded[id]));
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
 * guarantee hold on a file somebody edited by hand as well as one the engine
 * wrote.
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
  // The existing entries are read with the shared reader rather than a
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
    if (Object.hasOwn(patchEntry, 'values') && existing[id]?.kind === 'gate') {
      throw new Refusal('state-gate-values-sent',
        `this write sends values for the gate ${id}, and a gate's values are the writer's own: they are recorded from `
        + 'the option the operator chose, as that option sets them. Nothing was written. Drop values from the gate\'s '
        + `entry and record the answer as any gate answer is recorded — the gate completed, the chosen option under `
        + `node_summaries.${id} — and the writer records the values beside it`);
    }
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
 * gate's `reruns` and `sets` and any field a newer build wrote survive as they
 * were. A gate's values go with the rest: its next answer records its own.
 */
function reset(existing) {
  const { started: _started, completed: _completed, values: _values, ...kept } = existing;
  return { ...kept, status: 'pending', attempt: attemptOf(existing) + 1 };
}

/**
 * A node's attempt, counting its first as 1. The shared reader hands a scalar
 * back as text, so the recorded `2` arrives as `"2"` — and a file an earlier
 * build wrote may hold it quoted, until the node's next write re-emits it
 * through this; anything that is not a positive whole number is a node that
 * was never reset.
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
 * proves against none — a frozen block that recorded no hash, a definition
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
    if (decision.option === MORE_DETAILS_ID) {
      throw new Refusal('state-gate-option-unknown',
        `node_summaries.${id} records "${MORE_DETAILS_ID}", which is not an answer: it asks for the full brief. Nothing was written. `
        + `Write the full brief out as your message, ask the gate ${id} again in the same turn, and record the option the operator then chooses`);
    }
    throw new Refusal('state-gate-option-unknown',
      `node_summaries.${id} records the option ${JSON.stringify(decision.option)}, which the gate ${id} does not offer; `
      + `it offers ${offered.join(', ')}. Nothing was written. Record the id of the option the operator chose, `
      + 'exactly as the gate spells it and never its label, and send the write again');
  }
}

/**
 * A node's sanctioned absences, held to what they claim. `absent` maps a
 * declared artifact key to the reason the node completed without it, and
 * `run-complete` and the dashboard take it at its word, so an entry that names
 * nothing the node declares, or gives no reason, would silence a real gap or
 * explain nothing. The shape is judged on every write; the keys only while the
 * frozen block proves against the definition (`graph` is null otherwise), the
 * rule every definition-backed check here follows.
 */
function assertAbsent(id, absent, graph) {
  const at = `node_summaries.${id}.absent`;
  if (!isPlainObject(absent)) {
    throw new Refusal('state-absent-invalid',
      `${at} is ${JSON.stringify(absent)}, but it must be a map from a declared artifact key to the reason the node `
      + 'completed without that artifact. Nothing was written. Send it as {<artifact-key>: "<reason>"}, or leave it '
      + 'out when every declared artifact was produced');
  }
  const node = resolvedNode(graph, id);
  const declared = node === null ? null : isPlainObject(node.outputs?.artifacts) ? Object.keys(node.outputs.artifacts) : [];
  for (const [key, reason] of Object.entries(absent)) {
    if (declared !== null && !declared.includes(key)) {
      throw new Refusal('state-absent-invalid',
        `${at} names ${JSON.stringify(key)}, which ${id} does not declare as an artifact; it declares `
        + `${declared.length ? declared.join(', ') : 'none'}. Nothing was written. Name the artifact by its declared `
        + 'key, never by its path, and send the write again');
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Refusal('state-absent-invalid',
        `${at}.${key} is ${JSON.stringify(reason)}, but a sanctioned absence carries its reason as text. Nothing was `
        + 'written. Say in a few words why the node completed without this artifact, and send the write again');
    }
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
    let value = entry[key];
    if (value === undefined || value === null) return;
    // `attempt` is this writer's own counter, so it is emitted as the integer
    // it means rather than as whatever the file handed back. The shared reader
    // returns every scalar on a node line as text, and the emitter rightly
    // quotes text that looks like a number: a reset node's `2`, written again,
    // came back `"2"` — the count held and the type on disk did not.
    if (key === 'attempt') value = attemptOf(entry);
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
 * One core-optional top-level block.
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
 * Nothing here is consulted by the shared reader, which looks only
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
 * stated in the definition and in the framework patterns, and missed three
 * times out of three, is not a rule prose is carrying; so the writer carries
 * it. The map is what a reader of a half-finished run consults to learn that
 * nothing has been decided yet, and its absence reads instead as a run that
 * never had the key.
 *
 * Seeded for every context block, because every context block carries the map
 * in practice: `migration.md` requires it at intake in the same words
 * `performance.md` does. No shape changes — the key was already part of the
 * state contract and an empty object is the value the definitions ask for.
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
 *
 * `started_phase` is seeded as null for the same reason as the lists: the
 * contract requires the key on every run, a reader that finds it missing
 * cannot tell a run that has not started a phase from a state written by hand,
 * and nothing in the freeze patch carries it. A child run's freeze is a freeze
 * like any other, so it is seeded the same way. The first write that names a
 * phase replaces the null, as any scalar write does.
 */
function seedSequences(doc, orchestrator, changed) {
  const seeds = [['completed_phases', '[]'], ['failed_phases', '[]'], ['task_ids', '{}'], ['started_phase', 'null']];
  for (const [key, empty] of seeds) {
    if (isPlainObject(orchestrator) && Object.hasOwn(orchestrator, key)) continue;
    if (doc.locate(['orchestrator', key])) continue;
    doc.set(['orchestrator', key], [`  ${key}: ${empty}`]);
    changed.push(`orchestrator.${key}`);
  }
}

/**
 * `orchestrator.created`, stamped from this write's clock by the write that
 * installs the `workflow:` block.
 *
 * The state contract requires it on every run, and a driver drives only a run
 * that carries it: one without it is listed as found on disk and never picked
 * up. The freeze patch was trusted to carry it, and a child run's freeze — sent
 * by a session that has no clock to read — landed without it, so the parent
 * waited on a child nothing would ever run. The writer has the clock, so the
 * writer carries the rule, for a child's freeze as for any other. A value the
 * patch supplies, or one the file already holds, is kept; the stamp is the
 * write's own `now`, so a fresh run's `created` and first `updated` agree.
 */
function seedCreated(doc, orchestrator, now, changed) {
  if (isPlainObject(orchestrator) && Object.hasOwn(orchestrator, 'created')) return;
  if (doc.locate(['orchestrator', 'created'])) return;
  doc.set(['orchestrator', 'created'], [`  created: ${flow(now, 'orchestrator.created')}`]);
  changed.push('orchestrator.created');
}

/**
 * `orchestrator.policy_hash`, the hash of the autonomy policy the freeze
 * applied: the file at the engine's policy location when it loads, else the
 * built-in default's.
 *
 * Only the freeze writes it — the write that installs `workflow:` into a file
 * with none — so a run keeps the hash of the policy it started under and no
 * later write adds, changes or removes it. A run frozen before the key existed
 * stays without one. A patch value is never taken (`apply` drops it), and a
 * refused policy file is a warning on this write, never a refusal: the run
 * proceeds under the default and records the default's hash.
 */
function seedPolicyHash(doc, changed, policyWarnings) {
  const { hash, warnings } = loadPolicy();
  policyWarnings.push(...warnings);
  doc.set(['orchestrator', 'policy_hash'], [`  policy_hash: ${flow(hash, 'orchestrator.policy_hash')}`]);
  changed.push('orchestrator.policy_hash');
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
 * frozen block proves against the definition. A node summary's `absent` map —
 * the declared artifacts the node sanctioned not producing — is held to the
 * node's declared keys the same way, and to a reason on every write
 * (`assertAbsent`).
 *
 * A `node_summaries` entry merges field by field: a field the write sends
 * replaces that field whole, and a field it leaves out keeps its value. The
 * entry used to be written whole, so a later node retagging one earlier risk
 * `resolved` — sending only `risks` — erased the summary, the artifacts and
 * every answer the user had given in that node. `status` is the exception: it
 * is the node's outcome, mirrored afresh on every write that does not state
 * one. The user's answers are history on top of that (`earlierAnswers`).
 */
function applySummaries(doc, contextKey, summaries, nodePatch, kind, changed, runDir = null, graphOf = null) {
  if (!isPlainObject(summaries)) throw new Refusal('state-patch-invalid', `the ${kind} summaries must be an object`);
  let recorded = null;
  let run = null;
  let display = null;
  let via = null;
  let held = null;
  const heldOf = id => {
    held ??= heldSummaries(doc);
    return Object.hasOwn(held, id) && isPlainObject(held[id]) ? held[id] : null;
  };
  for (const [key, value] of Object.entries(summaries)) {
    if (!isPlainObject(value)) throw new Refusal('state-patch-invalid', `the summary ${key} must be an object`);
    let entry = { ...value };
    if (kind === 'node' && Object.hasOwn(entry, 'answer')) {
      recorded ??= recordedNodes(doc);
      if (Object.hasOwn(recorded, key) && recorded[key]?.kind === 'gate') entry = foldFlatAnswer(entry);
      else if (isPlainObject(entry.answer)) {
        entry = foldQuestionAnswer(entry, key, runDir, heldOf(key), attemptOf(Object.hasOwn(recorded, key) ? recorded[key] : null));
      }
    }
    if (kind === 'node' && graphOf !== null && Object.hasOwn(entry, 'decisions')) {
      const gate = resolvedNode(graphOf(), key);
      if (gate?.type === 'gate') assertOptions(key, entry.decisions, gate);
    }
    if (kind === 'node' && Object.hasOwn(entry, 'absent')) assertAbsent(key, entry.absent, graphOf === null ? null : graphOf());
    if (kind === 'node' && Object.hasOwn(entry, 'recommends')) assertRecommends(key, entry.recommends, graphOf === null ? null : graphOf());
    assertItems(kind === 'node' ? `node_summaries.${key}` : `${contextKey}.phase_summaries.${key}`, entry);
    if (kind === 'node' && Array.isArray(entry.decisions)) {
      recorded ??= recordedNodes(doc);
      if (Object.hasOwn(recorded, key) && recorded[key]?.kind === 'gate') {
        display ??= runDir === null ? displayOf() : displayOfRun(parseState(doc.text()), runDir);
        via ??= answerVia(parseState(doc.text()));
        entry.decisions = stampAnswers(foldAnswers(entry.decisions, key, display), runDir, via);
        entry.decisions = [...earlierRevisions(doc, key, entry.decisions), ...entry.decisions];
      } else {
        via ??= answerVia(parseState(doc.text()));
        const prior = heldOf(key)?.decisions;
        entry.decisions = stampAnswers(keepProvenance(prior, keepAttempts(prior, entry.decisions)), runDir, via);
        entry.decisions = [...earlierAnswers(heldOf(key)?.decisions, entry.decisions), ...entry.decisions];
      }
    }
    if (kind === 'node') {
      const prior = heldOf(key);
      if (prior) {
        const { status: _status, ...kept } = prior;
        entry = { ...kept, ...entry };
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
 * The typed fields of a summary entry, held to their vocabularies.
 *
 * Every one is optional and strings stay valid in both lists, so a run written
 * before the fields existed passes untouched. What is refused is a typed value
 * no reader knows: a `by` or a risk `tag` outside its set would be read as the
 * conservative default — the analysis, an open item — and so would silently
 * credit or file the item wrongly. `triage` is reserved and taken as written.
 */
function assertItems(at, entry) {
  const refuse = (where, value, allowed) => {
    throw new Refusal('state-summary-item-invalid',
      `${at}.${where} is ${JSON.stringify(value)}, which is not ${allowed}. Nothing was written. `
      + 'Correct that value and send the write again; every other field may stay as it was');
  };
  if (Object.hasOwn(entry, 'headline')) {
    const headline = entry.headline;
    if (typeof headline !== 'string' || headline.trim() === '' || /[\r\n]/.test(headline) || [...headline].length > HEADLINE_MAX) {
      refuse('headline', headline, `one non-empty sentence on one line, at most ${HEADLINE_MAX} characters`);
    }
  }
  if (Array.isArray(entry.decisions)) {
    entry.decisions.forEach((decision, index) => {
      if (!isPlainObject(decision)) return;
      if (Object.hasOwn(decision, 'by') && !DECISION_BY.includes(decision.by)) {
        refuse(`decisions[${index}].by`, decision.by, `one of ${DECISION_BY.join(', ')}`);
      }
      if (Object.hasOwn(decision, 'as_recommended') && decision.as_recommended !== null && typeof decision.as_recommended !== 'boolean') {
        refuse(`decisions[${index}].as_recommended`, decision.as_recommended, 'true, false or null');
      }
    });
  }
  if (Array.isArray(entry.risks)) {
    entry.risks.forEach((risk, index) => {
      if (!isPlainObject(risk)) return;
      if (typeof risk.risk !== 'string' || risk.risk.trim() === '') refuse(`risks[${index}].risk`, risk.risk, 'the risk in a sentence');
      if (!RISK_TAGS.includes(risk.tag)) refuse(`risks[${index}].tag`, risk.tag ?? null, `one of ${RISK_TAGS.join(', ')}`);
      if (Object.hasOwn(risk, 'change') && risk.change !== null && typeof risk.change !== 'string') {
        refuse(`risks[${index}].change`, risk.change, 'the change that would resolve it, as a string');
      }
    });
  }
  if (Object.hasOwn(entry, 'fixes_applied') && entry.fixes_applied !== null) {
    // What the node changed without asking, which the gate lists apart from
    // its decisions: a fix naming neither what was wrong nor what changed
    // would be dropped by every reader, so it is refused here instead.
    const fixes = entry.fixes_applied;
    if (!Array.isArray(fixes)) refuse('fixes_applied', fixes, 'a list of {finding, change}');
    fixes.forEach((fix, index) => {
      if (fixOf(fix) === null) refuse(`fixes_applied[${index}]`, fix, 'a {finding, change} map naming what was wrong and what changed');
    });
  }
  if (Object.hasOwn(entry, 'decision_areas') && entry.decision_areas !== null) {
    // The convergence's record of what the user chose, area by area: a resume
    // reads `chosen_approach` off it to skip what was answered, so a list of
    // names — a run once mirrored its step names here — re-asks every area.
    const areas = entry.decision_areas;
    if (!Array.isArray(areas)) refuse('decision_areas', areas, 'a list of {area, alternatives_count, chosen_approach}');
    areas.forEach((area, index) => {
      if (!isPlainObject(area) || typeof area.area !== 'string' || area.area.trim() === '') {
        refuse(`decision_areas[${index}]`, area, 'an {area, alternatives_count, chosen_approach} map naming its area');
      }
    });
  }
  if (Array.isArray(entry.artifacts)) {
    entry.artifacts.forEach((artifact, index) => {
      if (isPlainObject(artifact) && Object.hasOwn(artifact, 'role') && artifact.role !== null && !ARTIFACT_ROLES.includes(artifact.role)) {
        refuse(`artifacts[${index}].role`, artifact.role, `one of ${ARTIFACT_ROLES.join(', ')}`);
      }
    });
  }
  if (Object.hasOwn(entry, 'metrics')) {
    const metrics = entry.metrics;
    if (!Array.isArray(metrics)) refuse('metrics', metrics, 'a list of {label, value}');
    metrics.forEach((metric, index) => {
      const scalar = value => typeof value === 'number' || typeof value === 'string';
      if (!isPlainObject(metric) || typeof metric.label !== 'string' || metric.label.trim() === '' || !scalar(metric.value)
        || (Object.hasOwn(metric, 'of') && !scalar(metric.of)) || (Object.hasOwn(metric, 'unit') && typeof metric.unit !== 'string')) {
        refuse(`metrics[${index}]`, metric, 'a {label, value, unit?, of?} map with a label and a number or string value');
      }
    });
  }
}

/**
 * A task node's `recommends`: the continue option it recommends at the gate
 * that closes it, `{option, reason}`, or null to withdraw one. The gate brief
 * marks that option recommended and shows the reason on it, so an option the
 * gate does not offer as a continue would recommend nothing while reading as
 * though it did — refused, whenever the run's frozen graph still proves. The
 * reason is shown on the option, so it is one line.
 */
function assertRecommends(id, recommends, graph) {
  if (recommends === null) return;
  const at = `node_summaries.${id}.recommends`;
  const refuse = (value, allowed) => {
    throw new Refusal('state-summary-item-invalid',
      `${at} is ${JSON.stringify(value)}, which is not ${allowed}. Nothing was written. `
      + 'Correct that value and send the write again; every other field may stay as it was');
  };
  if (!isPlainObject(recommends)) refuse(recommends, 'an {option, reason} map naming the continue option recommended and why');
  const { option, reason } = recommends;
  if (typeof option !== 'string' || option.trim() === '') refuse(recommends, 'an {option, reason} map naming the continue option recommended and why');
  if (typeof reason !== 'string' || reason.trim() === '' || /[\r\n]/.test(reason)) {
    refuse(recommends, 'an {option, reason} map whose reason is one non-empty sentence on one line');
  }
  if (graph === null) return;
  const own = graph.nodes.find(node => node.id === id);
  const gates = graph.nodes.filter(node => node.type === 'gate' && Array.isArray(node.needs) && node.needs.includes(id));
  const continues = gates.flatMap(gate => Object.entries(isPlainObject(gate.options) ? gate.options : {})
    .filter(([, value]) => (isPlainObject(value) ? value.effect : value) === 'continue')
    .map(([name]) => name));
  if (own?.type === 'gate' || continues.length === 0) {
    refuse(recommends, `a recommendation ${id} can make: no gate waits on ${id} with a continue option to recommend`);
  }
  if (!continues.includes(option)) {
    refuse(option, `a continue option of the gate that waits on ${id}, which offers ${continues.join(', ')}`);
  }
}

/**
 * A gate's answers, each with the words it was chosen by and who chose it. An
 * answer is recorded by option id; a reader that shows decisions by their text
 * found none in it, so every reader that dropped or mangled the id-only form —
 * an older dashboard, a cockpit — showed nothing where a person had decided.
 * The option's label goes in `decision` and `by: operator` beside it, once, on
 * the way in; a field the caller already sent is kept.
 */
function foldAnswers(decisions, gate, display) {
  const labels = isPlainObject(display?.option_labels) ? display.option_labels : {};
  return decisions.map(decision => {
    if (!isPlainObject(decision) || typeof decision.option !== 'string') return decision;
    return {
      ...decision,
      ...(Object.hasOwn(decision, 'decision') ? {} : { decision: labelOf(labels, gate, decision.option) }),
      ...(Object.hasOwn(decision, 'by') ? {} : { by: 'operator' }),
    };
  });
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
  // The answers sent were folded on the way in; one held from before the fold
  // existed is the same answer without the two keys the fold adds.
  const unfolded = (sent, decision) => (isPlainObject(sent)
    ? Object.fromEntries(Object.entries(sent).filter(([key]) => !FOLDED.includes(key) || Object.hasOwn(decision, key)))
    : sent);
  return held.filter(decision => isPlainObject(decision) && Object.hasOwn(decision, 'attempt')
    && !decisions.some(sent => sameValue(unfolded(sent, decision), decision)));
}

/** The keys `foldAnswers` adds to a gate answer. */
const FOLDED = ['decision', 'by'];

/** The fields of a gate answer written flat on its summary rather than as a decision. */
const FLAT_ANSWER = ['answer', 'answered_by', 'at', 'via'];

/**
 * A gate summary with a flat answer — `answer: <option id>` and who answered
 * beside it — moved into its `decisions` as `{option, answered_by, at, via}`,
 * the one shape a gate answer has, with any provenance written beside it
 * (`PROVENANCE_KEYS`) moved along. The flat form carried no `decision` and no
 * `by`, so every reader that reads a gate's decisions found the gate
 * unanswered. An `answer` that is not an option id is left as it is.
 */
function foldFlatAnswer(entry) {
  if (typeof entry.answer !== 'string' || entry.answer.trim() === '') return entry;
  const moved = [...FLAT_ANSWER, ...PROVENANCE_KEYS];
  const answer = { option: entry.answer.trim() };
  for (const field of moved.slice(1)) if (Object.hasOwn(entry, field)) answer[field] = entry[field];
  const rest = Object.fromEntries(Object.entries(entry).filter(([field]) => !moved.includes(field)));
  const decisions = Array.isArray(entry.decisions) ? entry.decisions : [];
  const sent = decisions.some(item => isPlainObject(item) && item.option === answer.option && !Object.hasOwn(item, 'attempt'));
  return { ...rest, decisions: sent ? decisions : [...decisions, answer] };
}

/**
 * A task node's summary carrying the answer block of the question set it asked
 * — `answer: {option, answers, answered_by, at, via}`, copied whole from the
 * answer file — with that block turned into one `by: operator` decision per
 * question. The questions are read from the node's own request file, so what
 * is recorded is what was asked, in the words it was asked in; the caller
 * copies the block and composes nothing. The decisions are added after the
 * ones the summary already holds, and an earlier answer to the same question
 * is replaced — within one attempt.
 *
 * A node a revise re-ran asks again in its new attempt, read from the node's
 * own `attempt`, which the engine wrote when it reset it. There the operator's
 * answers from an earlier attempt stay where they were, each stamped with the
 * attempt it was given in, and the new ones carry theirs, so what was first
 * answered is still in the run's state. A first attempt stamps nothing, and
 * records exactly what it always did.
 */
function foldQuestionAnswer(entry, node, runDir, held, attempt = 1) {
  const file = runDir === null ? null : path.join(runDir, 'gates', `${node}${REQUEST_SUFFIX}`);
  const refuse = reason => new Refusal('state-question-answer-invalid',
    `the answer recorded for ${node} cannot be folded: ${reason}. Nothing was written`);
  if (file === null) throw refuse('the run directory is unknown, so the request it answers cannot be read');
  let request;
  try {
    request = parseState(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw refuse(`its request ${path.relative(runDir, file)} cannot be read (${err.code === 'ENOENT' ? 'it does not exist' : err.message})`);
  }
  const questions = requestQuestions(request);
  if (questions === null) throw refuse(`${path.relative(runDir, file)} is not a question request carrying its questions`);
  const folded = foldAnswer(questions, entry.answer);
  if (!folded.ok) throw refuse(folded.errors.join('; '));
  const { answer: _answer, ...rest } = entry;
  const answered = new Set(folded.decisions.map(item => item.question_id));
  const base = Array.isArray(entry.decisions) ? entry.decisions : Array.isArray(held?.decisions) ? held.decisions : [];
  if (attempt === 1) {
    return { ...rest, decisions: [...base.filter(item => !(isPlainObject(item) && answered.has(item.question_id))), ...folded.decisions] };
  }
  const kept = base.flatMap(item => {
    if (!isPlainObject(item) || !answered.has(item.question_id)) return [item];
    const given = attemptNumber(item) ?? 1;
    return decisionOf(item)?.by === 'operator' && given < attempt ? [{ ...item, attempt: given }] : [];
  });
  return { ...rest, decisions: [...kept, ...folded.decisions.map(item => ({ ...item, attempt }))] };
}

/** What a model has written in place of the person's name. */
const PLACEHOLDER_NAMES = new Set(['', 'user', 'operator', 'you']);

/**
 * The user's answers among `decisions`, each naming the person who gave it.
 * `answered_by` names a person — a cockpit with several operators shows it —
 * and a model left to write it wrote `user`, `operator` or its own guess, three
 * spellings in one run. So the writer stamps it: an answer with no name, or a
 * placeholder, gets the operator's name (`operatorName`) and, when it says no
 * `via`, the way the run is driven (`answerVia`), since only an answer given in
 * session arrives without one. A name the answer carries — from a driver's
 * answer line — is kept, and so is a `via` it carries. An answer whose `via`
 * reads `terminal` once stamped is then credited to that person as its
 * `actor` (`withPersonActor`); one with no `via`, or a driver's, gains none,
 * and a decision the run, an audit or a default settled is never touched.
 */
function stampAnswers(decisions, runDir, via) {
  return decisions.map(item => {
    if (!isPlainObject(item) || decisionOf(item)?.by !== 'operator') return item;
    const name = typeof item.answered_by === 'string' ? item.answered_by.trim().toLowerCase() : '';
    if (!PLACEHOLDER_NAMES.has(name)) return withPersonActor(item);
    return withPersonActor({ ...item, answered_by: operatorName(runDir), ...(Object.hasOwn(item, 'via') ? {} : { via }) });
  });
}

/** The driver kinds an answer given in session is stamped with; any other is `terminal`. */
const DRIVEN_VIA = new Set(['cockpit', 'dispatch']);

/**
 * How an answer given in this run's session reached it: the driver's kind when
 * a cockpit or a dispatch drives the run, `terminal` when no driver is set or
 * the driver is the terminal. The one default for every answer the engine
 * stamps, a revise's included.
 */
export function answerVia(state) {
  const orchestrator = isPlainObject(state?.orchestrator) ? state.orchestrator : null;
  const kind = isPlainObject(orchestrator?.driver) ? orchestrator.driver.kind : undefined;
  return DRIVEN_VIA.has(kind) ? kind : 'terminal';
}

let operatorNameCache = null;

/**
 * The name of the person at this terminal: `git config user.name` in the
 * project, falling back to the login name. Read once per process; never
 * fails — a machine with neither is `operator`.
 */
export function operatorName(runDir = null) {
  if (operatorNameCache !== null) return operatorNameCache;
  let name = '';
  try {
    name = execFileSync('git', ['config', 'user.name'], {
      cwd: runDir === null ? process.cwd() : projectRootOf(runDir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    name = '';
  }
  if (name === '') {
    try {
      name = process.env.USER || process.env.USERNAME || os.userInfo().username || '';
    } catch {
      name = '';
    }
  }
  operatorNameCache = name.trim() === '' ? 'operator' : name.trim();
  return operatorNameCache;
}

/**
 * The answers the user gave in a node that a write of its `decisions` leaves
 * out, in the order they were recorded. A node's decisions are rewritten whole
 * when it re-runs — a revise sends it back, and it records what it settled the
 * second time — and the questions it asked the first time are not asked again,
 * so their answers went with the list: the gate then counted fewer choices
 * than the user made, and nothing said what they had answered. An answer is
 * history, kept unless the write carries the same question again, which
 * replaces it: the same `question_id` and the same question text, or the text
 * alone when there is no id. The id alone is not enough — one id written on
 * every question of a page made a single re-asked question drop the others.
 * An answer with an id is matched with the attempt it was given in as well —
 * its own `attempt`, or the first when it carries none — so an answer a node
 * asked again in a later attempt never replaces the earlier one, which stays
 * as history, while the same answer carried along, or a current one sent
 * again, replaces itself.
 */
function earlierAnswers(prior, decisions) {
  if (!Array.isArray(prior)) return [];
  const keyOf = item => {
    if (!isPlainObject(item)) return null;
    const read = decisionOf(item);
    const question = typeof read?.question === 'string' ? oneLine(read.question) : '';
    if (typeof item.question_id === 'string' && item.question_id !== '') {
      return `id:${item.question_id}\u0000${question}\u0000${attemptNumber(item) ?? 1}`;
    }
    if (!read) return null;
    return question === '' ? `answer:${read.decision}` : `text:${question}`;
  };
  const sent = new Set(decisions.map(keyOf).filter(Boolean));
  return prior.filter(item => isPlainObject(item) && decisionOf(item)?.by === 'operator' && !sent.has(keyOf(item)));
}

/**
 * `decisions` with each answer that comes back without its `attempt` given the
 * one the held answer to the same question carries — a closing write re-sending
 * the current answers as they were asked. Without it the re-sent answer read as
 * a first attempt's, and the earlier attempt's answer it replaced the history
 * of read as current again.
 */
function keepAttempts(prior, decisions) {
  if (!Array.isArray(prior)) return decisions;
  return decisions.map(item => {
    if (!isPlainObject(item) || Object.hasOwn(item, 'attempt') || typeof item.question_id !== 'string') return item;
    const held = prior.find(other => isPlainObject(other) && other.question_id === item.question_id
      && attemptNumber(other) !== null && !isEarlierAnswer(other, prior));
    return held ? { ...item, attempt: attemptNumber(held) } : item;
  });
}

/**
 * `decisions` with each answer sent again given the provenance the held answer
 * to the same question carries and it lacks (`PROVENANCE_KEYS`). A closing
 * write re-sends the current answers as the node remembers them, which is
 * without what a driver attached when they were given; without this the
 * re-sent answer replaced the held one and its provenance went with it. The
 * held answer is matched as `keepAttempts` matches it — the same
 * `question_id`, still current — and in the attempt `keepAttempts` filled in.
 */
function keepProvenance(prior, decisions) {
  if (!Array.isArray(prior)) return decisions;
  return decisions.map(item => {
    if (!isPlainObject(item) || typeof item.question_id !== 'string' || decisionOf(item)?.by !== 'operator') return item;
    const held = prior.find(other => isPlainObject(other) && other.question_id === item.question_id
      && !isEarlierAnswer(other, prior) && (attemptNumber(other) ?? 1) === (attemptNumber(item) ?? 1));
    return held ? withProvenance(item, held) : item;
  });
}

/** The `node_summaries` block as it stands in the document, through the shared reader. */
function heldSummaries(doc) {
  let summaries;
  try {
    summaries = parseState(doc.text()).node_summaries;
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  return isPlainObject(summaries) ? summaries : {};
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

/**
 * A gate's values, recorded by the writer from the answer. A gate whose freeze
 * recorded `sets` holds, once it is `completed` with an answer, the values the
 * chosen option sets — the map itself — and once it is `skipped`, every key it
 * could set as false, as a skipped task node's bools read. Every gate this
 * write touched, through its node entry or its summary, is judged against the
 * document as the write leaves it, so the answer and the status may arrive in
 * one write or in two. A gate a revise sent back holds none: the reset drops
 * them, and the next answer records its own.
 *
 * Every completed gate is judged on every write as well, touched or not. A
 * driven answer is recorded with editor tools and re-published with the empty
 * patch, which names no gate; judged only when touched, that gate would stay
 * completed with no values, and the guard after it would read one never
 * recorded. Values that disagree with the answer are recorded again from it.
 */
function stampGateValues(doc, patch, changed) {
  const touched = new Set([
    ...(isPlainObject(patch.nodes) ? Object.keys(patch.nodes) : []),
    ...(isPlainObject(patch.node_summaries) ? Object.keys(patch.node_summaries) : []),
  ]);
  let typed;
  let raw;
  try {
    typed = parseState(doc.text());
    raw = scanState(doc.text()).nodes ?? {};
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  const nodes = isPlainObject(typed.workflow) && isPlainObject(typed.workflow.nodes) ? typed.workflow.nodes : {};
  for (const [id, entry] of Object.entries(nodes)) {
    if (!Object.hasOwn(raw, id) || !isPlainObject(entry)) continue;
    if (!touched.has(id) && entry.status !== 'completed') continue;
    if (entry.kind !== 'gate' || !isPlainObject(entry.sets)) continue;
    const values = gateValues(entry, latestOption(typed, id));
    if (values === undefined || sameValue(values, entry.values)) continue;
    doc.setNode(id, nodeLine(id, { ...raw[id], values }));
    if (!changed.includes(`workflow.nodes.${id}`)) changed.push(`workflow.nodes.${id}`);
  }
}

/**
 * A driven gate answer's provenance, copied by the writer. A driver's answer
 * reaches the run as the `answer` block of `gates/<gate>.request.yml`, and the
 * decision recorded beside it names the option and who answered — the rest of
 * the block (`PROVENANCE_KEYS`) stayed in the request file. So on every write,
 * for each completed gate whose request file holds an answer naming the same
 * option as the gate's answer (`gateAnswer`), each key that answer lacks is
 * copied from the block. Nothing else is: `grants` never reaches a decision.
 * A gate with nothing to copy is not rewritten, and a request file that cannot
 * be read copies nothing.
 */
function copyDrivenProvenance(doc, runDir, changed) {
  let typed;
  try {
    typed = parseState(doc.text());
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  const nodes = isPlainObject(typed.workflow) && isPlainObject(typed.workflow.nodes) ? typed.workflow.nodes : {};
  const summaries = isPlainObject(typed.node_summaries) ? typed.node_summaries : {};
  for (const [id, entry] of Object.entries(nodes)) {
    if (!isPlainObject(entry) || entry.kind !== 'gate' || entry.status !== 'completed') continue;
    if (!Object.hasOwn(summaries, id) || !isPlainObject(summaries[id]) || !Array.isArray(summaries[id].decisions)) continue;
    const decisions = summaries[id].decisions;
    const answer = gateAnswer(decisions);
    if (answer === null) continue;
    let given;
    try {
      given = parseState(fs.readFileSync(path.join(runDir, 'gates', `${id}${REQUEST_SUFFIX}`), 'utf8')).answer;
    } catch {
      continue;
    }
    if (!isPlainObject(given) || given.option !== answer.option) continue;
    const copied = withProvenance(answer, given);
    if (copied === answer) continue;
    const summary = { ...summaries[id], decisions: decisions.map(item => (item === answer ? copied : item)) };
    doc.set(['node_summaries', id], block(id, summary, 2));
    if (!changed.includes(`node_summaries.${id}`)) changed.push(`node_summaries.${id}`);
  }
}

/**
 * A gate's triage and settlement items, written by the writer on the writes
 * that judge the gate — and on no other, with no marker kept in state. Two
 * writes judge a gate, each recognised from what the write itself carries:
 *
 * - the write that records its answer: the patch's summary for the gate
 *   carries an operator decision naming an option (or the flat `answer` that
 *   folds into one) — an answer given in session, a revise, or a closing write
 *   re-sending the answer;
 * - the re-validation of a driven answer: the write whose gate-index sync
 *   closes the gate's row, `pending` in `gates/index.yml` before it and
 *   `answered` after (`closingRows`).
 *
 * On such a write, and only when the autonomy policy loaded now is the one
 * the run recorded at its freeze (`orchestrator.policy_hash`), the answer item
 * gains the gate's `triage` unless it carries one — a triage already there is
 * carried as written — and each value the chosen option `sets` that the
 * policy classes is recorded as one settlement item right after the answer:
 * `{decision: "<key>: <value>", by: operator, ref, node, triage}` with the
 * answer's `answered_by`, `via` and provenance. Settlement items an earlier
 * answer left are replaced, never repeated. Under a policy that classes
 * nothing, nothing is written.
 *
 * A run whose recorded hash differs from the loaded policy's, or that recorded
 * none, gets nothing either: the policy it would be judged by is not the one
 * it started under. That is a warning, `policy-hash-mismatch:<gate>`, raised
 * only where the loaded policy would have classed the answer or a value.
 */
function judgeGates(doc, patch, changed, runDir, policyWarnings) {
  let typed;
  try {
    typed = parseState(doc.text());
  } catch (err) {
    throw new Refusal('state-unreadable', `the existing state file cannot be read back: ${err.message}`);
  }
  const workflow = isPlainObject(typed.workflow) ? typed.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const isGateNode = id => Object.hasOwn(nodes, id) && isPlainObject(nodes[id]) && nodes[id].kind === 'gate';
  const judged = new Set();
  if (isPlainObject(patch.node_summaries)) {
    for (const [id, entry] of Object.entries(patch.node_summaries)) {
      if (isGateNode(id) && recordsAnswer(entry)) judged.add(id);
    }
  }
  if (runDir !== null && settled(doc.text())) {
    for (const id of closingRows(runDir)) if (isGateNode(id)) judged.add(id);
  }
  if (judged.size === 0) return;

  const summaries = isPlainObject(typed.node_summaries) ? typed.node_summaries : {};
  const recordedHash = isPlainObject(typed.orchestrator) ? typed.orchestrator.policy_hash : undefined;
  let loaded = null;
  for (const id of Object.keys(nodes).filter(each => judged.has(each))) {
    const summary = Object.hasOwn(summaries, id) && isPlainObject(summaries[id]) ? summaries[id] : null;
    const decisions = Array.isArray(summary?.decisions) ? summary.decisions : null;
    const answer = gateAnswer(decisions);
    if (answer === null) continue;
    loaded ??= loadPolicy();
    const ask = { policy: loaded.policy, workflow: workflow.name, id };
    const gateTriage = triageFor({ ...ask, kind: 'gate' });
    const sets = isPlainObject(nodes[id].sets) && Object.hasOwn(nodes[id].sets, answer.option) && isPlainObject(nodes[id].sets[answer.option])
      ? nodes[id].sets[answer.option] : {};
    const values = Object.entries(sets)
      .map(([key, value]) => ({ key, value, triage: triageFor({ ...ask, kind: 'value', key }) }))
      .filter(each => each.triage !== null);
    if (recordedHash !== loaded.hash) {
      const code = `policy-hash-mismatch:${id}`;
      if ((gateTriage !== null || values.length > 0) && !policyWarnings.includes(code)) policyWarnings.push(code);
      continue;
    }
    const carried = answer.triage !== undefined && answer.triage !== null;
    const triaged = carried || gateTriage === null ? answer : { ...answer, triage: gateTriage };
    const settlements = values.map(each => settlementOf(id, each, answer));
    const kept = decisions.filter(item => item === answer || !isSettlement(item, id));
    const at = kept.indexOf(answer);
    const next = [...kept.slice(0, at), triaged, ...settlements, ...kept.slice(at + 1)];
    if (sameValue(next, decisions)) continue;
    doc.set(['node_summaries', id], block(id, { ...summary, decisions: next }, 2));
    if (!changed.includes(`node_summaries.${id}`)) changed.push(`node_summaries.${id}`);
  }
}

/** Does a gate's summary in a patch record an answer: an operator decision naming an option, or a flat answer? */
function recordsAnswer(entry) {
  if (!isPlainObject(entry)) return false;
  if (typeof entry.answer === 'string' && entry.answer.trim() !== '') return true;
  return Array.isArray(entry.decisions) && entry.decisions.some(item => isPlainObject(item)
    && typeof item.option === 'string' && (item.by === undefined || item.by === 'operator'));
}

/**
 * The gates whose `gates/index.yml` row this write closes: `pending` in the
 * index as it stands, while the request file already holds an answer — so the
 * sync this settled write runs turns it `answered`. Read before the sync, which
 * runs after the document is built.
 */
function closingRows(runDir) {
  let index;
  try {
    index = parseState(fs.readFileSync(path.join(runDir, 'gates', INDEX_FILE), 'utf8'));
  } catch {
    return [];
  }
  const entries = isPlainObject(index) && Array.isArray(index.entries) ? index.entries : [];
  const pending = entries.filter(row => isPlainObject(row) && row.status === 'pending' && typeof row.node === 'string').map(row => row.node);
  if (pending.length === 0) return [];
  let open;
  try {
    open = new Set(unansweredRequests(runDir));
  } catch {
    return [];
  }
  return pending.filter(id => !open.has(id));
}

/** One settlement item: a classified value the answer's option sets, credited as the answer is. */
function settlementOf(gate, { key, value, triage }, answer) {
  const item = { decision: `${key}: ${scalarText(value)}`, by: 'operator', ref: key, node: gate, triage };
  if (answer.answered_by !== undefined) item.answered_by = answer.answered_by;
  if (answer.via !== undefined) item.via = answer.via;
  for (const field of PROVENANCE_KEYS) {
    if (answer[field] !== undefined && answer[field] !== null) item[field] = answer[field];
  }
  return item;
}

/** Is `item` a settlement item the writer recorded for `gate`? */
function isSettlement(item, gate) {
  return isPlainObject(item) && typeof item.option !== 'string' && item.by === 'operator' && item.node === gate
    && typeof item.ref === 'string' && item.triage !== undefined && item.triage !== null;
}

/** A set value as a settlement item's text names it. */
function scalarText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The values a gate holds as recorded, or undefined when its status and answer settle none. */
function gateValues(entry, option) {
  if (entry.status === 'skipped') {
    const keys = Object.values(entry.sets).flatMap(each => (isPlainObject(each) ? Object.keys(each) : []));
    return Object.fromEntries([...new Set(keys)].map(key => [key, false]));
  }
  if (entry.status !== 'completed' || option === null || !Object.hasOwn(entry.sets, option)) return undefined;
  const set = entry.sets[option];
  return isPlainObject(set) ? { ...set } : undefined;
}

/** The option a gate's answer — its last decision carrying one — names, or null. */
function latestOption(typed, id) {
  const summaries = isPlainObject(typed.node_summaries) ? typed.node_summaries : {};
  const decisions = Object.hasOwn(summaries, id) && isPlainObject(summaries[id]) ? summaries[id].decisions : null;
  return gateAnswer(decisions)?.option ?? null;
}

/** A node status in the summary vocabulary, or undefined when it has none. */
function mirrorOf(nodeStatus) {
  const statusKey = nodeStatus === undefined || nodeStatus === null ? '' : String(nodeStatus);
  return Object.hasOwn(STATUS_MIRROR, statusKey) ? STATUS_MIRROR[statusKey] : undefined;
}

/** The node entries as they stand in the document, through the shared reader. */
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
 * Run the candidate text through the shared reader before anything is
 * published, and assert the three flags and the non-empty node map on top.
 *
 * The last of those is the one that is easy to mistake for decoration. A
 * present `workflow:` key beside a node map the reader sees as empty satisfies
 * the pending predicate, so the run is classified as awaiting an operator. A
 * silently empty node map is not a bad read; it is a blocked session.
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
    throw new Refusal('state-incomplete', 'the candidate reads back with an empty node map, which reads as a run awaiting an operator');
  }
}

/**
 * The structural assertion the oracle cannot make.
 *
 * The shared reader answers one question — is this run awaiting an operator —
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
 * One whole-file write, temp-then-rename, under the one fixed name.
 *
 * The publish path itself is `canonical.commit`; what stays here is the pair of
 * facts only this writer knows — the frozen temp name and this module's own
 * refusal codes.
 */
function commit(state, text) {
  const tmp = path.join(path.dirname(path.resolve(state)), TMP_NAME);
  canonical.commit({ target: state, text, tmp, codes: COMMIT_CODES });
}
