/**
 * The dispatch envelope (contract C2).
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. One document is built
 * here and published under `<run>/dispatch/<node-id>.envelope.yml` through the
 * shared temp → rename path, and nothing else in this module writes.
 *
 * ---------------------------------------------------------------------------
 * Why this module re-resolves the workflow definition
 * ---------------------------------------------------------------------------
 *
 * The frozen node entry in a state file carries exactly `NODE_KEYS` — `kind`,
 * `status`, `started`, `completed`, `needs`, `on`, `values`, `dir`, `provider`,
 * `session` — and no more. The envelope schema declares `workflow.{uses, with}`
 * and `inputs[]`, none of which the state has ever held: they live in the
 * workflow **definition**. So the envelope cannot be assembled from the state
 * alone, and the definition has to be read again at dispatch time.
 *
 * Reading it again is exactly the risk this module has to close. A definition
 * edited between the moment a run froze its graph and the moment a node is
 * dispatched would silently dispatch work the run never planned. Hence the
 * order every build follows: read the state, re-resolve the definition the
 * state names through `graph.mjs`'s `resolve`, recompute the graph hash and
 * compare it with the state's `workflow.graph_hash`, and refuse
 * `dispatch-graph-drifted` on any disagreement. Only then is a field taken from
 * the resolved node.
 *
 * The definition path comes from the state — `workflow.source`, plus
 * `workflow.overlays[]` and `workflow.profile` — and never from the command
 * line. A caller who could name the definition could name a different one, and
 * the hash comparison would then only prove that the caller was self-consistent.
 *
 * ---------------------------------------------------------------------------
 * Why provider and autonomy each need a resolution chain
 * ---------------------------------------------------------------------------
 *
 * `provider`. B1's implication runs `provider → dir`, not the converse:
 * a node that names a provider must name a directory, but a `dir:` node with no
 * `provider:` is a perfectly valid document — while C2 *requires* `provider`.
 * The chain is therefore node → `members.<member>.default_provider` → refuse
 * `dispatch-node-incomplete` naming the member, so an operator is told which
 * manifest entry to fix. C1's `defaults` block carries `autonomy` and
 * `worktree` only and is deliberately **not** consulted: a repo-wide default
 * provider is a decision nobody has taken, and inventing one here would take it
 * silently.
 *
 * `autonomy`. B1 declares no `autonomy` property at all — a node carries
 * `uses`, `type`, `needs`, `with`, `outputs`, `when`, `dir`, `provider`, `ask`,
 * `options`, `on`, `optional` and nothing else — while C2 *requires* `autonomy`.
 * The tier therefore travels in the node's `with` map, which the grammar
 * already declares free-form and which the resolver already treats as
 * overlay-tunable and interpolable. No grammar change and no sixth contract
 * shape. The chain is `with.autonomy` → `members.<member>.autonomy` →
 * `defaults.autonomy` → refuse `dispatch-autonomy-unresolved`. A value present
 * at any level but outside C1's four-member enum refuses
 * `dispatch-autonomy-unknown` rather than travelling: the envelope `$ref`s that
 * enum, so emitting an unknown tier would write a document that fails its own
 * schema.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately not here
 * ---------------------------------------------------------------------------
 *
 * The autonomy tiers map onto permission presets as **data**, in the shipped
 * fixture's spelling. Turning a preset into a provider's command-line flags is
 * a separate concern with a separate contract, and no flag of any provider is
 * spelled anywhere in this file.
 *
 * Nothing here is spawned, and no ledger entry is written: `create-entry` and
 * `claim` belong to the engine, and this module only *reads* the ledger, to
 * learn the dispatch id an entry already carries or the next free ordinal.
 *
 * The refusal set is closed: `dispatch-node-incomplete`,
 * `dispatch-graph-drifted`, `dispatch-autonomy-unresolved`,
 * `dispatch-autonomy-unknown`, `dispatch-workflow-not-driver-capable`,
 * `dispatch-run-unresolved`, `dispatch-closeout-impossible`,
 * `dispatch-envelope-exists`, `dispatch-unwritable`, `dispatch-temp-exists`,
 * and `value-not-flow-safe` from the shared emitter. Each is documented with
 * its recovery in `SKILL.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Refusal, commit, flow, scalar } from './canonical.mjs';
import { readDefinition } from './definition.mjs';
import { bareWorkflowName, locateTarget, resolve as resolveGraph, TARGET_REF } from '../../../workflow-engine/scripts/lib/graph.mjs';

/** The format version every C-series document this module writes declares. */
const VERSION = 1;

/** The state document a run keeps its frozen graph in. */
const STATE_FILE = 'orchestrator-state.yml';

/** C1's autonomy enum, spelled once so no chain step can drift from it. */
const AUTONOMY = ['attended', 'auto-low', 'auto-medium', 'auto-high'];

/** C2's provider enum. */
const PROVIDERS = ['claude', 'copilot'];

/** The grades a close-out may report, frozen by C2's `grade` definition. */
const GRADES = ['success', 'partial', 'failed'];

/**
 * The permission atoms. Named once and combined into the four presets below,
 * so a tier is a list of these rather than a hand-typed string list that could
 * disagree with its neighbour by a character. The spelling is the shipped
 * fixture's: a bare capability where the capability is the whole of it, and
 * `shell(<command>)` where a specific command is meant.
 */
const CAN = {
  read: 'read',
  tests: 'tests',
  write: 'write',
  commit: 'shell(git commit)',
  push: 'shell(git push)',
  merge: 'shell(git merge)',
  prCreate: 'shell(gh pr create)',
  prMerge: 'shell(gh pr merge)',
};

/**
 * The four presets, as data. `attended` pauses on push, merge and
 * pull-request creation — which is what C1 says the tier means — and the auto
 * tiers widen the allow list one step at a time. Nothing here is rendered into
 * a provider flag; that mapping is a separate concern and is not built in this
 * module.
 */
const PERMISSIONS = {
  attended: {
    // `write` and `commit` are named explicitly rather than left off both
    // lists. An atom in neither list has no defined answer, and the flag
    // renderer that turns a preset into a provider's command line would have to
    // invent one — silently, and differently per provider. The tier is attended
    // by a person who can intervene, so the two atoms that only change the
    // worktree are allowed and the four that leave it stay denied.
    allow: [CAN.read, CAN.tests, CAN.write, CAN.commit],
    deny: [CAN.push, CAN.merge, CAN.prCreate, CAN.prMerge],
  },
  'auto-low': {
    allow: [CAN.read, CAN.tests],
    deny: [CAN.write, CAN.commit, CAN.push, CAN.merge, CAN.prCreate, CAN.prMerge],
  },
  'auto-medium': {
    allow: [CAN.read, CAN.tests, CAN.write, CAN.commit],
    deny: [CAN.push, CAN.merge, CAN.prCreate, CAN.prMerge],
  },
  'auto-high': {
    allow: [CAN.read, CAN.tests, CAN.write, CAN.commit, CAN.push, CAN.prCreate],
    deny: [CAN.merge, CAN.prMerge],
  },
};

/** The refusal names `commit` reports under, kept in this module's vocabulary. */
const WRITE_CODES = { unwritable: 'dispatch-unwritable', tempExists: 'dispatch-temp-exists' };

/**
 * A `with` value that names a file the worker should read. Deliberately narrow:
 * no whitespace, an unexpanded `${…}` reference excluded, and at least one path
 * separator — which is what tells `runs/research/outputs/report.md` apart from
 * `attended`. A value that is merely a word is an argument, not an input, and
 * seeding it as a read-only file reference would send the worker looking for a
 * path that does not exist.
 */
const PATH_LIKE = /^[A-Za-z0-9._][^\s]*\/[^\s]*$/;

/**
 * A member name that can also be a git branch segment. Member names are raw
 * directory names and reach `branchOf`, whose output a worker hands to git, so
 * the ones git would reject — a leading dot or dash, a `..`, a `.lock` suffix,
 * a space, a `~^:?*[` or a backslash — are refused here rather than surfacing
 * as an unreadable git error in a member repository three steps later.
 */
const BRANCH_SAFE_MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A source that names a built-in workflow rather than a file on disk. */
const BUILTIN_SOURCE = /^(?:builtin:)?[a-z][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// the verb
// ---------------------------------------------------------------------------

/**
 * The `envelope` verb: build one node's envelope and publish it.
 *
 * One options object, because that is the shape the entry point calls every
 * verb with. `overrides` arrives on stdin and is optional; an absent or empty
 * document is `{}`.
 */
export function envelope({ run, node, ledger, root, overrides = {} }) {
  try {
    const manifest = readManifest(root);
    const dispatchId = resolveDispatchId({ ledger, run, node, overrides });
    const document = buildEnvelope({ run, node, manifest, root, dispatchId, overrides });
    const written = writeEnvelope({ run, envelope: document });
    if (!written.ok) return { ok: false, dispatch_id: dispatchId, errors: written.errors };
    return { ok: true, dispatch_id: dispatchId, path: written.path, envelope: document, errors: [] };
  } catch (err) {
    return refused(err);
  }
}

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------

/**
 * The envelope document for one node, or a `Refusal`.
 *
 * `definition` may be passed by a caller that has already re-resolved the
 * graph — the round-trip script does, so it can assert the hash itself — and is
 * otherwise resolved here from the state. Either way the hash is compared
 * before a single field is read out of it.
 */
export function buildEnvelope({ run, node, manifest, root = null, definition = null, dispatchId, overrides = {} }) {
  const state = readState(run);
  const resolved = definition ?? resolveFromState({ state, run });
  assertGraphUnchanged({ state, resolved });

  const defined = resolved.nodes.find((entry) => entry.id === node);
  if (!defined) {
    throw new Refusal('dispatch-node-incomplete',
      `the resolved graph carries no node "${node}", so there is nothing to dispatch`);
  }

  const recorded = mapOf(mapOf(state.workflow).nodes)[node] ?? {};
  const member = defined.dir ?? recorded.dir ?? null;
  if (member === null) {
    throw new Refusal('dispatch-node-incomplete',
      `the node "${node}" declares no dir:, so it names no member to dispatch into`);
  }

  if (!BRANCH_SAFE_MEMBER.test(member)) {
    throw new Refusal('dispatch-node-incomplete',
      `the node "${node}" dispatches into the member "${member}", whose name cannot be a git branch segment — it reaches the branch a worker hands to git. Rename the directory to match ${BRANCH_SAFE_MEMBER.source}, or point the dir: at one that does.`);
  }

  const members = mapOf(manifest?.members);
  if (!Object.hasOwn(members, member)) {
    throw new Refusal('dispatch-node-incomplete',
      `the node "${node}" dispatches into the member "${member}", which the manifest does not declare — add it to members: or correct the dir:`);
  }
  const entry = mapOf(members[member]);

  assertDriverCapable({ node, uses: defined.uses ?? null });

  const provider = resolveProvider({ node, member, defined, recorded, entry });
  const autonomy = resolveAutonomy({ node, member, defined, entry, manifest });
  const runId = runIdOf({ state, run });

  const inputs = inputsOf(defined);
  const worktree = worktreeOf({ manifest, runId, node });
  const session = mapOf(overrides.session);
  const statement = statementOf({ defined, overrides });
  const prRequired = closeoutPrOf({ node, autonomy, overrides });

  return {
    version: VERSION,
    dispatch_id: dispatchId,
    chain: {
      run_id: runId,
      node,
      umbrella_id: manifest?.umbrella_id ?? null,
    },
    target: {
      member,
      path: entry.path ?? member,
      worktree,
    },
    provider,
    session: {
      name: session.name ?? nameOf(mapOf(recorded.session)) ?? `${runId}/${dispatchId}/${node}`,
      substrate: session.substrate ?? 'p',
    },
    workflow: {
      uses: defined.uses ?? null,
      with: mapOf(defined.with),
    },
    inputs,
    statement,
    workspace_root: rootOf(root),
    autonomy,
    permissions: {
      allow: [...PERMISSIONS[autonomy].allow],
      deny: [...PERMISSIONS[autonomy].deny],
    },
    outbox: `.maister/umbrella/outbox/${dispatchId}/`,
    branch: overrides.branch ?? branchOf({ manifest, runId, node, member, dispatchId }),
    ticket: overrides.ticket ?? null,
    closeout_contract: {
      pr_required: prRequired,
      grade: [...GRADES],
    },
  };
}

/**
 * Whether the workflow a `dir:` node names can honour a driver, and — when it
 * does not — whether that was read off the target or could not be read at all.
 *
 * A dispatched worker is unattended by construction: it has to record a driver
 * kind, suspend at a gate by writing a request file and print a frozen marker
 * instead of asking. A workflow with no orchestrator does none of that — its
 * first step is to ask a question, which is the exact failure the gate design
 * exists to remove — so dispatching into one produces a worker that hangs on a
 * prompt nobody will answer.
 *
 * Capability is read off the artifact rather than from a list kept here. A
 * skill declares it in one of two ways, and either satisfies the check: the
 * frontmatter field `driver_aware: true`, which is the documented way a skill
 * outside this plugin says so; or a `SKILL.md` body that states the driver-
 * qualified gate rule by naming `orchestrator.driver.kind`, which is the
 * sentence every built-in orchestrator carries and stays honoured for them. A
 * `workflow:` target is run by the engine, which is driver-aware itself, so it
 * qualifies without the lookup. `agent:` and `direct:` targets are steps inside
 * a run, not runs, and can never be dispatched.
 *
 * The file read is the one the graph checker's own resolution finds — the
 * project's skill of that name, else this plugin's, else an installed
 * plugin's, or exactly the plugin a namespaced target names — so a definition
 * cannot validate against one skill and dispatch another.
 *
 * Exported twice, and never as the assertion below: as the three-answer
 * verdict, and as the boolean derived from it. `manifest.mjs`'s `validate`
 * reports located `{file, node, path, message}` entries and never refuses; were
 * it to call a helper that throws, a dispatch-vocabulary refusal code would
 * have to be caught on the validate path and quoted in a validate report. The
 * third answer, `unreadable`, is there for the same reason: a `skill:` target
 * this root holds no file for was never read, so a validator calling it
 * incapable would assert a property of a file it never opened, and no exception
 * it could catch would tell it otherwise. So the rule — the driver-rule pattern
 * and the skill-text read — has one definition and one grep here, and each
 * caller composes its own answer: this module refuses on anything but
 * `capable`, the validator locates and says which of the two it found.
 *
 * The engine itself carries the driver literal and therefore qualifies. That is
 * deliberate and is today's behaviour: no exclusion lives in the rule. A
 * planner offering an operator a set of dispatch targets excludes the engine
 * when it *authors* the set, which is a presentational choice made where the
 * set is presented, not here.
 */
export function driverCapability(uses) {
  if (typeof uses !== 'string' || uses === '') return 'incapable';
  const at = uses.indexOf(':');
  const scheme = at < 0 ? '' : uses.slice(0, at);
  const name = at < 0 ? '' : uses.slice(at + 1);
  // A workflow name reaches a file path exactly as every other target name
  // does, so it is held to the same charset before anything else. Only the
  // spelling is judged here: whether a definition of that name exists is a
  // question for the run, not for a predicate that must answer without
  // touching the filesystem.
  if (scheme === 'workflow') return bareWorkflowName(name) === null ? 'incapable' : 'capable';
  if (scheme !== 'skill' || !TARGET_REF.test(name)) return 'incapable';
  const text = skillText(name);
  if (text === null) return 'unreadable';
  return declaresDriverAware(text) || DRIVER_RULE.test(text) ? 'capable' : 'incapable';
}

/**
 * Whether a skill file's frontmatter carries `driver_aware: true`. Only the
 * leading `---` block is read, and only a bare `true` counts: a value quoted,
 * commented or nested is not the declaration, and a skill that mentions the
 * field in its prose has not made it.
 */
export function declaresDriverAware(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return false;
  for (const line of lines.slice(1)) {
    if (line === '---') return false;
    if (DRIVER_AWARE.test(line)) return true;
  }
  return false;
}

/**
 * The verdict as the one boolean a dispatch acts on. Unreadable and incapable
 * collapse here on purpose: dispatch cannot build an envelope from a target it
 * cannot read either, so both answers refuse, and the difference between them
 * belongs to the report that is written before anything runs.
 */
export function driverCapable(uses) {
  return driverCapability(uses) === 'capable';
}

/**
 * The dispatch-side reading of the predicate. The refusal and its two messages
 * are this module's own and are unchanged by the extraction: an absent `uses:`
 * is reported as the missing declaration it is rather than as an incapable
 * target, because the recovery differs.
 */
function assertDriverCapable({ node, uses }) {
  if (typeof uses !== 'string' || uses === '') {
    throw new Refusal('dispatch-workflow-not-driver-capable',
      `the node "${node}" dispatches into a member but names no uses:, so there is no workflow to run under a driver`);
  }
  if (driverCapable(uses)) return;
  throw new Refusal('dispatch-workflow-not-driver-capable',
    `the node "${node}" dispatches into a member with uses: ${uses}, which cannot honour a driver: a dispatched worker has to record orchestrator.driver.kind, write its gate requests and print a marker instead of asking, and only an orchestrator workflow does that. Point the node at an orchestrator skill — one declaring driver_aware: true in its frontmatter — or a workflow:, or drop the dir: and run it in the coordinating repository.`);
}

/** The sentence a driver-aware orchestrator states its gate rule with. */
const DRIVER_RULE = /orchestrator\.driver\.kind/;

/** The frontmatter line by which a skill declares it honours a driver. */
const DRIVER_AWARE = /^driver_aware:\s*true\s*$/;

/**
 * One skill's SKILL.md, found the way the graph checker finds it, or null when
 * no searched place holds a file for the name.
 */
function skillText(name) {
  const found = locateTarget('skill', name);
  if (found === null) return null;
  try {
    return fs.readFileSync(found.at, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The statement of the work, when the dispatching node carried one.
 *
 * Like `autonomy`, it travels in the node's `with:` map, which grammar B1
 * already declares free-form — no grammar change and no new node property. The
 * engine may also pass one on stdin, which is how a run whose node text is
 * built at dispatch time supplies it.
 */
function statementOf({ defined, overrides }) {
  const candidates = [overrides.statement, mapOf(defined.with).statement, mapOf(defined.with).task];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

/**
 * Whether the tier can end its run in a pull request.
 *
 * A deny is not always a dead end. `attended` means an operator is present and
 * approves the denied action, so `shell(gh pr create)` on that tier's deny list
 * is a relay point rather than a refusal: the worker pauses, a person answers,
 * and the pull request is opened. The auto tiers have no operator to relay to —
 * `auto-low` is read-only plus tests and `auto-medium` adds edits and commits
 * but never leaves the worktree — so under either a pull request genuinely
 * cannot be opened at all. `auto-high` allows it outright.
 */
function canOpenPr(autonomy) {
  return autonomy === RELAYED || PERMISSIONS[autonomy].allow.includes(CAN.prCreate);
}

/** The one tier whose denials are answered by a person rather than final. */
const RELAYED = 'attended';

/**
 * Whether a pull request is required, derived from the tier rather than
 * asserted.
 *
 * A hard-coded `true` shipped two of the four tiers a close-out contract they
 * were forbidden to satisfy: the seed said "open a pull request" while the
 * permissions denied `gh pr create` and no operator could lift the denial. So
 * the answer is what the tier can reach — its allow list, widened by the
 * approval relay `attended` has — and an override that contradicts it is
 * refused rather than honoured: a caller who means it has to widen the tier.
 */
function closeoutPrOf({ node, autonomy, overrides }) {
  const permitted = canOpenPr(autonomy);
  const declared = mapOf(overrides.closeout_contract).pr_required;
  if (declared === undefined || declared === null) return permitted;
  if (declared === true && !permitted) {
    throw new Refusal('dispatch-closeout-impossible',
      `the override requires a pull request for the node "${node}" while the autonomy tier "${autonomy}" can never open one — it denies ${CAN.prCreate} and has no operator to approve it — so the worker would be told to do what its own permissions forbid. Dispatch at a tier that permits it, or drop the override and let the tier decide.`);
  }
  return declared === true;
}

/** C2's absolute workspace root, or null when the caller named none. */
function rootOf(root) {
  return typeof root === 'string' && root !== '' ? path.resolve(root) : null;
}

/**
 * Node → member default. The manifest's `defaults` block is not a step in this
 * chain, on purpose: see the module header.
 */
function resolveProvider({ node, member, defined, recorded, entry }) {
  const candidates = [defined.provider, recorded.provider, entry.default_provider];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (!PROVIDERS.includes(candidate)) {
      throw new Refusal('dispatch-node-incomplete',
        `the node "${node}" resolves the provider "${candidate}", which is not one of ${PROVIDERS.join(', ')}`);
    }
    return candidate;
  }
  throw new Refusal('dispatch-node-incomplete',
    `the node "${node}" declares no provider: and the member "${member}" declares no default_provider — set one on either`);
}

/**
 * `with.autonomy` → member → defaults. Every level is checked against the enum
 * as it is read, so an unknown tier is reported where it was written rather
 * than surviving into a document that would fail its own schema.
 */
function resolveAutonomy({ node, member, defined, entry, manifest }) {
  const chain = [
    ['the with: map of the node ' + node, mapOf(defined.with).autonomy],
    [`the manifest member ${member}`, entry.autonomy],
    ['the manifest defaults block', mapOf(manifest?.defaults).autonomy],
  ];
  for (const [where, candidate] of chain) {
    if (candidate === undefined || candidate === null) continue;
    if (!AUTONOMY.includes(candidate)) {
      throw new Refusal('dispatch-autonomy-unknown',
        `${where} sets autonomy to "${candidate}", which is not one of ${AUTONOMY.join(', ')}`);
    }
    return candidate;
  }
  throw new Refusal('dispatch-autonomy-unresolved',
    `the node "${node}" resolves no autonomy tier: set with.autonomy on the node, autonomy on the member "${member}", or defaults.autonomy in the manifest`);
}

/**
 * The read-only file references seeded into the worker, taken from the resolved
 * node's `with` map — the only place in the grammar where a node names a file
 * it wants to be handed. The `with` key becomes the input's role, which is what
 * lets a worker tell a research report from a decision log without reading both.
 */
function inputsOf(defined) {
  const inputs = [];
  for (const [role, value] of Object.entries(mapOf(defined.with))) {
    if (typeof value !== 'string' || value.includes('${')) continue;
    if (!PATH_LIKE.test(value)) continue;
    inputs.push({ path: value, role });
  }
  return inputs;
}

/**
 * The worktree the dispatch works in, named after the run and the node, so two
 * runs' dispatches of one node never share a checkout. Naming it after the node
 * alone was the older shape and it collided: a second run of the same chain
 * into the same member landed in the first run's tree.
 * `defaults.worktree: false` opts a workspace out and the dispatch then works
 * in the member checkout itself.
 *
 * Exported, unlike its neighbours, because the refusal it raises is not
 * reachable through the envelope builder — the run id there is a resolved
 * directory basename and is null only for a path that cannot be staged — so a
 * direct call is the only way to provoke the code.
 */
export function worktreeOf({ manifest, runId, node }) {
  if (mapOf(manifest?.defaults).worktree === false) return null;
  if (typeof runId !== 'string' || runId === '') {
    throw new Refusal('dispatch-run-unresolved',
      `the node "${node}" would be dispatched into a worktree, but no run id resolves, so the worktree cannot be named after its run: point --run at the run directory whose basename is the run id, or record the run's task path in its state, or set defaults.worktree: false in the manifest to work in the member checkout itself. Nothing was written.`);
  }
  return `.worktrees/${runId}-${node}`;
}

/**
 * The branch, from C1's `branch_convention`. An absent convention leaves branch
 * choice to the worker, which is what the contract says it means, so the field
 * is null rather than guessed.
 */
function branchOf({ manifest, runId, node, member, dispatchId }) {
  const convention = manifest?.branch_convention;
  if (typeof convention !== 'string' || convention === '') return null;
  const values = { run_id: runId, node, member, dispatch_id: dispatchId };
  return convention.replace(/\{([a-z_]+)\}/g, (whole, key) =>
    (Object.hasOwn(values, key) && values[key] !== null ? String(values[key]) : whole));
}

function nameOf(session) {
  return typeof session.name === 'string' && session.name !== '' ? session.name : null;
}

// ---------------------------------------------------------------------------
// the state, the definition and the hash
// ---------------------------------------------------------------------------

/**
 * The run's state document. An unreadable state is reported as
 * `dispatch-node-incomplete` rather than under a code of its own: the state is
 * what describes the node, and a node that cannot be described cannot be
 * dispatched. The message names the file so the cause is never in doubt.
 */
export function readState(run) {
  const file = path.join(run, STATE_FILE);
  const read = readDefinition(file);
  if (read.doc === null) {
    throw new Refusal('dispatch-node-incomplete',
      `the run state at ${file} could not be read: ${read.errors.map((each) => each.message).join('; ')}`);
  }
  return read.doc;
}

/**
 * The umbrella manifest. Read here rather than taken from `manifest.mjs`
 * because the envelope needs the document, not the scan that produced it.
 */
export function readManifest(root) {
  const file = path.join(root, '.maister', 'umbrella.yml');
  const read = readDefinition(file);
  if (read.doc === null) {
    throw new Refusal('dispatch-node-incomplete',
      `the umbrella manifest at ${file} could not be read, so no member can be resolved: ${read.errors.map((each) => each.message).join('; ')}`);
  }
  return read.doc;
}

/**
 * Re-resolve the definition the state names, through the engine's own resolver.
 * Every failure on this path is `dispatch-graph-drifted`: whether the file is
 * gone, unreadable or no longer valid, the graph the run froze is not the graph
 * on disk, and that is the one thing a dispatch may not proceed past.
 */
export function resolveFromState({ state, run }) {
  const workflow = mapOf(state.workflow);
  const source = definitionPath({ source: workflow.source, run });
  const definition = readDefinition(source);
  if (definition.doc === null) {
    throw new Refusal('dispatch-graph-drifted',
      `the definition the run froze (${workflow.source}) could not be re-read at ${source}: ${definition.errors.map((each) => each.message).join('; ')}`);
  }

  const overlays = [];
  for (const overlay of Array.isArray(workflow.overlays) ? workflow.overlays : []) {
    const file = definitionPath({ source: overlay, run });
    const read = readDefinition(file);
    if (read.doc === null) {
      throw new Refusal('dispatch-graph-drifted',
        `the overlay the run froze (${overlay}) could not be re-read at ${file}: ${read.errors.map((each) => each.message).join('; ')}`);
    }
    overlays.push(read);
  }

  // A definition declaring a format this build does not know is resolved on its
  // structure alone, exactly as the engine's own entry point does — the hash
  // comparison below is what still has to hold.
  const version = definition.doc.version;
  const degraded = version !== undefined && version !== null && version !== VERSION ? [definition.file] : [];

  const resolved = resolveGraph({ definition, overlays, profile: workflow.profile ?? null, degraded });
  if (!resolved.ok) {
    throw new Refusal('dispatch-graph-drifted',
      `the definition the run froze no longer resolves: ${resolved.errors.map((each) => each.message).join('; ')}`);
  }
  return resolved;
}

/**
 * The definition file a `workflow.source` names. Built-in names resolve inside
 * the plugin; everything else is a path, tried against the run directory and
 * the working directory in turn so a state written with a workspace-relative
 * source reads back from either.
 */
function definitionPath({ source, run }) {
  if (typeof source !== 'string' || source === '') {
    throw new Refusal('dispatch-graph-drifted',
      'the run state names no workflow source, so the frozen graph cannot be re-resolved');
  }
  if (BUILTIN_SOURCE.test(source)) {
    const bare = source.startsWith('builtin:') ? source.slice('builtin:'.length) : source;
    return path.join(pluginRoot(), 'skills', 'workflow-engine', 'workflows', `${bare}.yml`);
  }
  if (path.isAbsolute(source)) return source;
  // The run directory sits four levels under the workspace root
  // (`<root>/.maister/umbrella/runs/<run-id>`), so a workspace-relative source
  // is reachable from it without the caller having to say so.
  const candidates = [
    path.resolve(run, '..', '..', '..', '..', source),
    path.resolve(run, source),
    path.resolve(source),
  ];
  return candidates.find(isFile) ?? candidates[0];
}

/**
 * The comparison the whole module exists to make. Resolver and state now agree
 * on one spelling - the prefixed form, produced where the digest is - so the
 * two sides arrive comparable. Both are still normalized before comparing, for
 * the states written while the resolver emitted a bare digest: those files are
 * on disk, their runs are resumable, and refusing them over a prefix would be
 * reporting drift that never happened.
 */
function assertGraphUnchanged({ state, resolved }) {
  const frozen = digest(mapOf(state.workflow).graph_hash);
  if (frozen === null) {
    throw new Refusal('dispatch-graph-drifted',
      'the run state records no graph_hash, so there is nothing to prove the definition against');
  }
  const current = digest(resolved.graph_hash);
  if (current !== frozen) {
    throw new Refusal('dispatch-graph-drifted',
      `the workflow definition has changed since the run froze its graph (frozen ${frozen}, now ${current ?? 'unresolvable'}) — dispatching would run work this run never planned`);
  }
}

/** Either spelling reduced to the digest itself. See `assertGraphUnchanged`. */
function digest(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

/**
 * The run id: the name of the run directory. The state's `task_path` records
 * the same value, and the directory is preferred because it is what the caller
 * actually pointed at.
 */
function runIdOf({ state, run }) {
  const recorded = mapOf(state.orchestrator).task_path;
  const named = path.basename(path.resolve(run));
  if (named !== '' && named !== '.') return named;
  return typeof recorded === 'string' && recorded !== '' ? path.basename(recorded) : null;
}

// ---------------------------------------------------------------------------
// the dispatch id
// ---------------------------------------------------------------------------

/**
 * The dispatch id this envelope carries.
 *
 * The engine allocates ids through the ledger's `create-entry`, and when it has
 * already done so it passes the id in on stdin — that is the ordinary path, and
 * it is checked first. Otherwise the ledger is read: an entry already naming
 * this run and node hands its id back, so re-emitting an envelope for a node is
 * idempotent rather than allocating a second id for the same work. Failing
 * both, the next free ordinal is reported.
 *
 * Nothing on this path writes. The allocation that takes a lock and records the
 * id belongs to the ledger; this only reads, so an envelope built and then
 * discarded consumes no id.
 */
export function resolveDispatchId({ ledger, run, node, overrides = {} }) {
  const given = overrides.dispatch_id;
  if (typeof given === 'string' && given !== '') return given;

  const runId = path.basename(path.resolve(run));
  const entries = path.join(ledger, 'entries');
  let highest = 0;
  for (const name of listDir(entries)) {
    if (!name.endsWith('.yml')) continue;
    const read = readDefinition(path.join(entries, name));
    const doc = read.doc;
    if (doc !== null) {
      const chain = mapOf(doc.chain);
      if (chain.run_id === runId && chain.node === node && typeof doc.dispatch_id === 'string') {
        return doc.dispatch_id;
      }
    }
    highest = Math.max(highest, ordinalOf(name.slice(0, -'.yml'.length)));
  }
  // The log is consulted too, so an id recorded by a `create-entry` whose entry
  // file was later removed is still never handed out a second time.
  for (const line of logLines(path.join(ledger, 'ledger.log'))) {
    const parts = line.split(' ');
    if (parts[1] === 'create-entry' && parts[2]) highest = Math.max(highest, ordinalOf(parts[2]));
  }
  return `d-${String(highest + 1).padStart(4, '0')}`;
}

function ordinalOf(id) {
  const match = /^d-(\d+)$/.exec(String(id));
  return match ? Number(match[1]) : 0;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function logLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// publishing
// ---------------------------------------------------------------------------

/**
 * Publish one envelope under `<run>/dispatch/<node-id>.envelope.yml`.
 *
 * An existing envelope is refused rather than overwritten: the file is what the
 * seed, the ledger entry and the spawned worker all agree on, and rewriting one
 * under a running dispatch would leave three readers describing different work.
 * Removing it is the operator's decision, not this writer's.
 */
export function writeEnvelope({ run, envelope: document }) {
  const target = path.join(run, 'dispatch', `${document.chain.node}.envelope.yml`);
  try {
    if (fs.existsSync(target)) {
      throw new Refusal('dispatch-envelope-exists',
        `${target} already exists; a published envelope is never rewritten, because the seed, the ledger entry and the worker all read this one file. Remove it deliberately if the dispatch is being rebuilt.`);
    }
    commit({
      target,
      text: emit(document),
      tmp: `${target}.tmp`,
      codes: WRITE_CODES,
    });
    return { ok: true, path: target, errors: [] };
  } catch (err) {
    return refused(err, { path: target });
  }
}

/**
 * The document as YAML: one-line flow collections for every nested block, a
 * block map for `permissions`. Written key by key rather than through a generic
 * dumper — the emitter this file uses refuses a value it cannot spell on one
 * line instead of escaping it, and that refusal is the contract.
 *
 * `inputs` is emitted as a one-line flow sequence — `[{path: …, role: …}]` —
 * and not as the block sequence of flow maps the shipped C2 fixture is written
 * in. The reader every module in this runtime is required to read YAML through
 * once refused a mapping opened on a sequence dash outright, so the block form
 * would have produced an envelope the `seed` verb could not read back two
 * seconds after publishing it — and the same gap made the shipped
 * `dispatch-envelope`, `umbrella-manifest` and `worker-seed` fixtures
 * unreadable by that reader. The reader has since been widened and reads both.
 * The parsed shape is identical either way; this spelling is kept because an
 * envelope that occupies one line per key diffs as one changed line.
 */
function emit(document) {
  const lines = [
    `version: ${scalar(document.version, 'version')}`,
    `dispatch_id: ${scalar(document.dispatch_id, 'dispatch_id')}`,
    `chain: ${flow(document.chain, 'chain')}`,
    `target: ${flow(document.target, 'target')}`,
    `provider: ${scalar(document.provider, 'provider')}`,
    `session: ${flow(document.session, 'session')}`,
    `workflow: ${flow(document.workflow, 'workflow')}`,
    `inputs: ${flow(document.inputs, 'inputs')}`,
    `statement: ${scalar(document.statement, 'statement')}`,
    `workspace_root: ${scalar(document.workspace_root, 'workspace_root')}`,
    `autonomy: ${scalar(document.autonomy, 'autonomy')}`,
    'permissions:',
    `  allow: ${flow(document.permissions.allow, 'permissions.allow')}`,
    `  deny: ${flow(document.permissions.deny, 'permissions.deny')}`,
    `outbox: ${scalar(document.outbox, 'outbox')}`,
    `branch: ${scalar(document.branch, 'branch')}`,
    `ticket: ${scalar(document.ticket, 'ticket')}`,
    `closeout_contract: ${flow(document.closeout_contract, 'closeout_contract')}`,
  ];
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/**
 * A refusal turned into the report shape every verb answers with. Anything that
 * is not a `Refusal` is a fault in the tooling and is rethrown, so the entry
 * point can exit 2 rather than presenting a crash as a rejected input.
 */
function refused(err, extra = {}) {
  if (!(err instanceof Refusal)) throw err;
  return { ok: false, ...extra, errors: [{ code: err.code, message: err.message }] };
}

/**
 * A mapping, whatever the caller had. The reader builds null-prototype maps and
 * an absent block reads back as null, so every lookup would otherwise need its
 * own guard.
 */
function mapOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * The plugin root, declared by the host or derived from this file's location.
 * Resolved through `fileURLToPath` rather than `url.pathname`, which on Windows
 * yields a leading-slash path no `fs` call can stat.
 */
function pluginRoot() {
  // Two spellings, one value. `CLAUDE_PLUGIN_ROOT` is the host's; the Copilot
  // variant's skills name `MAISTER_PLUGIN_ROOT`, because that CLI exports no
  // plugin-directory variable of its own and its install notes ask the
  // operator for this one. Reading both here keeps the instruction a skill
  // gives and the path this runtime resolves from being two different answers.
  const declared = process.env.CLAUDE_PLUGIN_ROOT || process.env.MAISTER_PLUGIN_ROOT;
  if (declared) return declared;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}
