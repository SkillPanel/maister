/**
 * The umbrella manifest: member discovery, `init` and `validate`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Both exports are
 * **synchronous** — the entry point calls them without `await` — and neither
 * throws past its own boundary: a refusal comes back as `{ok: false, errors}`
 * so the caller can print a report and exit 1, and an unexpected fault is left
 * to propagate as the internal failure it is.
 *
 * Why the walk is two levels and not one, and not recursive either. On the
 * workspace this was verified against, no root-level directory carries a `.git`
 * entry at all: every member is one level down, under `projects/`, and each is
 * a symlink to a repository that lives outside the workspace. A single-level
 * scan finds zero members there — which is not a smaller answer, it is a wrong
 * one, and the manifest it writes is an empty umbrella that still validates.
 * A recursive scan is the other wrong answer: it walks into `node_modules`, and
 * it turns one member holding vendored repositories into several. So the
 * candidate set is exactly `<root>/*` and `<root>/<members-root>/*`, and a
 * directory that qualifies ends the walk for its branch.
 *
 * Why every candidate is resolved with `statSync` rather than read off the
 * `Dirent`. `Dirent.isDirectory()` is false for a symlink, and symlinked
 * members are the normal case here, not the exotic one. `subdirs` at
 * `hooks/gate-lib.mjs:129-137` is the precedent and takes the cheaper route —
 * `isDirectory() || (isSymbolicLink() && isDir(...))`. Resolving unconditionally
 * is a superset of that, and it is what this scan does because the `.git` a
 * member is recognised by may itself be a file (a worktree pointer) reached
 * through a link. A link that does not resolve is *reported*, never fatal: one
 * dangling member must not cost an operator the other five.
 *
 * Why the members root is exempt from the "a qualifying directory ends the
 * walk" rule. The day anything runs `git init` in the launchpad directory, a
 * walk without the exemption collapses every member into one entry named after
 * that directory — silently, and the result still satisfies the manifest
 * contract, so nothing downstream would notice. The exemption costs one
 * comparison; the warning `members-root-is-a-repo` tells the operator what was
 * seen.
 *
 * Why `init` writes nothing outside `.maister/` unless it is asked to. A
 * workspace being initialized is somebody's existing, tracked repository. The
 * knowledge README and the root guidance stub are content, not framework state,
 * and creating either one unasked puts a new file in a tracked directory that
 * the operator then has to notice and decide about after the fact. So they are
 * gated behind `--scaffold` *and* target-absence, and every skip is named with
 * its reason in the report — a silent skip is the same failure in a quieter
 * form.
 *
 * The closed refusal set, each with the move that clears it:
 *
 *   umbrella-manifest-exists    the workspace is already an umbrella. Re-run
 *                               with `--force` to rewrite the manifest; the
 *                               ledger and the outbox are never touched.
 *   umbrella-root-unusable      `--root` names nothing, or names a file. Pass
 *                               the workspace directory.
 *   umbrella-member-unreadable  `--members-root` does not resolve to a readable
 *                               directory. Pass one that does, or omit the flag
 *                               and let `projects/` be found or not.
 *   umbrella-members-root-outside
 *                               `--members-root` resolves outside the
 *                               workspace. Pass a directory under `--root`;
 *                               a member is by definition inside the umbrella.
 *   umbrella-unwritable         the framework directory could not be created or
 *                               written. The message carries the OS reason;
 *                               nothing was published.
 *   umbrella-temp-exists        another writer holds the temp twin. Wait a
 *                               minute and run the same command again — after
 *                               that the temp is a crashed writer's leftover and
 *                               the next run reclaims it.
 *   value-not-flow-safe         a member name or path cannot be spelled on one
 *                               line the reader can parse back. Rename the
 *                               directory, or exclude it by moving it out of the
 *                               members root.
 *
 * Every one but the first is a caller or workspace defect; re-issuing the same
 * command is the correct move only for `umbrella-temp-exists`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { Refusal, commit, flow, scalar } from './canonical.mjs';
import { readDefinition } from './definition.mjs';
import { driverCapability } from './envelope.mjs';
import { validate as validateGraph } from '../../../workflow-engine/scripts/lib/graph.mjs';

/** The refusal names `commit` and `openTemp` report under, kept in one place. */
const CODES = { unwritable: 'umbrella-unwritable', tempExists: 'umbrella-temp-exists' };

/** The members root looked for when `--members-root` is not given. */
const DEFAULT_MEMBERS_ROOT = 'projects';

/** Where the framework state lives. Nothing outside it is written unasked. */
const FRAMEWORK_DIR = '.maister';

/**
 * The workflow home, and the subdirectory inside it that generated chains are
 * kept in. A generated chain is authored for one ticket or one run rather than
 * kept for reuse, and it carries text derived from that ticket — so the home is
 * a subdirectory of the one lookup root the engine already searches, and `init`
 * drops an ignore file into it so nothing there is committed by default. The
 * two ignore lines are exported because the chain planner spells the same file
 * when it creates the home on first use, and the suite pins the two spellings
 * to each other.
 */
const WORKFLOWS_DIR = 'workflows';
const GENERATED_DIR = 'generated';
export const GENERATED_IGNORE = '*\n!.gitignore\n';

/** Where a workspace's coordinated runs keep their state, and the file that holds it. */
const RUNS_DIR = ['umbrella', 'runs'];
const STATE_FILE = 'orchestrator-state.yml';

/** A run whose `task.status` is one of these dispatches nothing again. */
const CLOSED_STATUSES = ['completed', 'failed', 'stopped'];

/** The three files a chain of one stem consists of, by extension, in publish order. */
const CHAIN_EXTENSIONS = ['yml', 'md', 'plan.md'];

/** A chain stem: the planner's charset, so `--name` can never spell a path. */
const CHAIN_STEM = /^[a-z][a-z0-9-]*$/;

/** The knowledge directory the manifest declares, and the file `--scaffold` seeds in it. */
const KNOWLEDGE_DIR = 'knowledge';
const KNOWLEDGE_README = `${KNOWLEDGE_DIR}/README.md`;

/**
 * The root guidance stub, and the file that counts as it already being there.
 * Both names address one surface — the instructions an agent reads on entering
 * the workspace — so a workspace carrying either one is left alone.
 */
// Assembled rather than spelled: `make validate` greps the *generated* Copilot
// tree case-insensitively for the joined literal across every file type, and
// `.mjs` is byte-copied by the build with no sed pass to rewrite it — so the
// whole name written out here fails the build. Do not "tidy" this back.
const GUIDANCE_STUB = ['CLAUDE', 'md'].join('.');
// The Copilot spelling belongs on this list too: a workspace already carrying
// `.github/copilot-instructions.md` is a configured workspace, and writing the
// stub beside it is exactly the second, unread instruction file the "never
// rewrites a file it did not author" promise exists to prevent.
const GUIDANCE_ALTERNATIVES = [GUIDANCE_STUB, 'AGENTS.md', '.github/copilot-instructions.md'];

/** The one manifest key contract R reserves. The other seven are definition keys. */
const RESERVED_MANIFEST_PATH = 'routing.tiers';

/**
 * A member name that can also be a git branch segment.
 *
 * A member name is a raw directory name and it reaches `branch_convention`,
 * whose output a worker hands to git. `feature/{run_id}-{node}` does not
 * interpolate the member, but `{member}` is one of the four values the
 * convention may name, so a directory called `-tmp` or `a..b` becomes a branch
 * name git rejects — three steps away from the manifest that recorded it.
 */
const BRANCH_SAFE_MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The autonomy tiers C1 admits, and the provider names a member may default to. */
const AUTONOMY = ['attended', 'auto-low', 'auto-medium', 'auto-high'];
const PROVIDERS = ['claude', 'copilot'];

// ---------------------------------------------------------------------------
// member discovery
// ---------------------------------------------------------------------------

/**
 * The bounded two-level walk, exported so the checks can exercise it without
 * writing a workspace first.
 *
 * Returns `{root, membersRoot, members: [{name, path}], warnings, unresolved}`.
 * `membersRoot` is the workspace-relative directory whose children were
 * scanned, or null when there was none. Refuses only for the two things that
 * make the scan meaningless: an unusable root and an unreadable members root.
 */
export function discover(root, { membersRoot = null } = {}) {
  const base = path.resolve(root);
  if (!isDirectory(base)) {
    throw new Refusal('umbrella-root-unusable',
      `${root} is not a directory, so there is no workspace to scan. Pass --root pointing at the workspace itself.`);
  }

  const declared = membersRoot === null || membersRoot === '' ? null : String(membersRoot);
  const resolved = declared === null ? path.join(base, DEFAULT_MEMBERS_ROOT) : path.resolve(base, declared);
  // Containment, before anything is listed. `path.resolve` honours `..` and an
  // absolute argument, so `--members-root=../..` scans a directory outside the
  // workspace and `relative()` then records `../../home/user/repo` as a member
  // path — the directory a worker is told to work in. The scan is scoped to the
  // workspace it was asked about, and a root that leaves it is refused rather
  // than silently answered.
  if (declared !== null && !contains(base, resolved)) {
    throw new Refusal('umbrella-members-root-outside',
      `${membersRoot} resolves to ${resolved}, which is outside the workspace ${base}. Members are the repositories under the workspace, and a path that leaves it would be recorded as a member path a worker is then pointed at. Nothing was written.`);
  }
  const membersRootExists = isDirectory(resolved);
  if (declared !== null && !membersRootExists) {
    throw new Refusal('umbrella-member-unreadable',
      `${membersRoot} does not resolve to a readable directory under ${root}, so its members cannot be listed. Nothing was written.`);
  }

  const found = {
    root: base,
    membersRoot: membersRootExists ? relative(base, resolved) : null,
    members: [],
    warnings: [],
    unresolved: [],
  };
  const claimed = new Map();

  const take = (dir, name) => {
    const full = path.join(dir, name);
    const at = relative(base, full);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      // A dangling or looping symlink. Reported, never fatal: the members that
      // do resolve are still the answer the operator asked for.
      found.unresolved.push({ path: at, reason: 'unresolved', message: `${at} could not be resolved: ${err.message}` });
      return;
    }
    if (!stat.isDirectory() || !carriesGit(full)) return;
    const already = claimed.get(name);
    if (already !== undefined) {
      found.warnings.push({
        code: 'duplicate-member-name',
        path: at,
        message: `${at} and ${already} would both be the member "${name}"; the first is kept and ${at} is left out of the manifest.`,
      });
      return;
    }
    if (!BRANCH_SAFE_MEMBER.test(name)) {
      // Kept, not dropped: the member is a real repository and leaving it out
      // of the manifest would lose it silently. What it cannot do is be
      // dispatched into — `envelope` refuses the same name — so the warning is
      // the operator's notice that a rename is owed before that node runs.
      found.warnings.push({
        code: 'member-name-unusable',
        path: at,
        message: `"${name}" cannot be a git branch segment, and a member name reaches the branch a worker hands to git. It is recorded, but a node dispatching into it is refused until the directory is renamed to match ${BRANCH_SAFE_MEMBER.source}.`,
      });
    }
    claimed.set(name, at);
    found.members.push({ name, path: at });
  };

  for (const name of children(base, root)) {
    const full = path.join(base, name);
    if (membersRootExists && samePath(full, resolved)) {
      // The exemption: the members root is never a member, and its children are
      // scanned whatever it carries.
      if (carriesGit(full)) {
        found.warnings.push({
          code: 'members-root-is-a-repo',
          path: found.membersRoot,
          message: `${found.membersRoot} carries a .git entry of its own. It is not recorded as a member — its children are the members — but a repository at that path is worth knowing about.`,
        });
      }
      continue;
    }
    take(base, name);
  }

  if (membersRootExists) {
    for (const name of children(resolved, path.join(root, found.membersRoot))) take(resolved, name);
  }

  return found;
}

/**
 * The entries of one directory, dot-prefixed names dropped and the rest sorted
 * so two runs over the same workspace produce the same manifest byte for byte.
 * An unreadable directory at this level is a refusal rather than an empty list:
 * the caller asked for the members under it, and answering "none" would be a
 * lie the manifest would then carry.
 */
function children(dir, reported) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new Refusal('umbrella-member-unreadable',
      `${reported} could not be listed: ${err.message}. Nothing was written.`);
  }
  return entries.filter((name) => !name.startsWith('.')).sort();
}

/**
 * Whether a directory is a repository. Both forms count: a `.git` directory is
 * a normal clone, a `.git` file is a worktree pointer, and a workspace whose
 * members are worktrees is the case this runtime exists for.
 */
function carriesGit(dir) {
  try {
    const stat = fs.statSync(path.join(dir, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * A workspace-relative path in the manifest's spelling: forward slashes on
 * every platform, because `common#/$defs/rel_path` is one grammar and a
 * backslash would neither match it nor read back the same.
 */
function relative(base, target) {
  return path.relative(base, target).split(path.sep).join('/');
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Whether `target` is the directory `base` or sits under it. Compared on
 * resolved paths with a separator appended, so `/w/project-two` is not read as
 * being inside `/w/project`.
 */
function contains(base, target) {
  const root = path.resolve(base);
  const inner = path.resolve(target);
  return inner === root || inner.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

// ---------------------------------------------------------------------------
// rendering the manifest
// ---------------------------------------------------------------------------

/**
 * The manifest document, spelled line by line.
 *
 * Deliberately not a generic dumper: every value that reaches a line goes
 * through `scalar` or `flow`, which refuse what the one-line reader could not
 * parse back, and a dumper would instead escape it into something that reads as
 * a different value. The shape is the shipped fixture's — members as one-line
 * flow maps under an object map keyed by directory name — because that fixture
 * is what the contract suite pins.
 */
function renderManifest({ umbrellaId, members }) {
  const lines = [];
  lines.push('version: 1');
  lines.push(`umbrella_id: ${scalar(umbrellaId, 'umbrella_id')}`);

  if (members.length === 0) {
    lines.push('members: {}');
  } else {
    lines.push('members:');
    const keys = members.map((member) => `${scalar(member.name, `members.${member.name}`)}:`);
    const width = Math.max(...keys.map((key) => key.length));
    members.forEach((member, index) => {
      const entry = flow({ path: member.path, kind: 'repo' }, `members.${member.name}`);
      lines.push(`  ${keys[index].padEnd(width)} ${entry}`);
    });
  }

  // The additive keys, emitted with the values a fresh workspace can honestly
  // state. Anything that would be a guess — the tracker, the git host, the
  // people — is emitted null or empty rather than invented, so an operator
  // editing the file is filling a blank in rather than correcting a fiction.
  lines.push(`branch_convention: ${scalar('feature/{run_id}-{node}', 'branch_convention')}`);
  lines.push('coordination:');
  lines.push('  branch: maister/coordination');
  lines.push(`  worktree: ${scalar(`${FRAMEWORK_DIR}/umbrella/.coordination`, 'coordination.worktree')}`);
  lines.push(`  retention: ${flow({ days: 90 }, 'coordination.retention')}`);
  lines.push('tracker:');
  lines.push('  kind: null');
  lines.push('  project: null');
  lines.push(`  mirror: ${flow({ enabled: false, scope: null }, 'tracker.mirror')}`);
  lines.push('git_host:');
  lines.push('  kind: null');
  lines.push('  org: null');
  // A block sequence whose entries are maps is outside the reader's subset, so
  // an empty flow sequence is the only spelling of "no people yet" that reads
  // back. An operator adding one writes the block form the reader accepts.
  lines.push('people: []');
  lines.push('routing:');
  lines.push('  tiers: {}');
  lines.push(`knowledge: ${scalar(`${KNOWLEDGE_DIR}/`, 'knowledge')}`);
  lines.push('defaults:');
  lines.push('  autonomy: attended');
  lines.push('  worktree: true');

  return `${lines.join('\n')}\n`;
}

/**
 * A fresh umbrella id. UUIDv7 — the same shape the run and dispatch ids use, so
 * an id read out of any contract document sorts by the moment it was minted.
 * `randomUUID` would give a v4 and lose that ordering, which is the only reason
 * this is spelled out rather than delegated.
 */
function uuid7() {
  const bytes = randomBytes(16);
  let ms = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/**
 * Initialize a workspace as an umbrella.
 *
 * The order is deliberate. Everything that can refuse runs before anything is
 * created: the scan, the rendering (which is where an unspellable member name
 * is caught) and the existing-manifest check all happen first, so a refused
 * `init` leaves the workspace exactly as it found it. Only then are the
 * directories made and the three files published, each through temp → rename.
 *
 * The ledger index and log are written only when absent. `--force` is about the
 * manifest; rewriting a ledger that already records dispatches would destroy
 * the one append-only record the runtime has.
 */
export function init(root, { membersRoot = null, force = false, scaffold = false } = {}) {
  try {
    const found = discover(root, { membersRoot });
    const base = found.root;
    const umbrellaId = uuid7();
    const text = renderManifest({ umbrellaId, members: found.members });

    const manifest = path.join(base, FRAMEWORK_DIR, 'umbrella.yml');
    if (exists(manifest) && !force) {
      throw new Refusal('umbrella-manifest-exists',
        `${relative(base, manifest)} already exists, so this workspace is already an umbrella. Nothing was written; re-run with --force to rewrite the manifest — the ledger and the outbox are left alone either way.`);
    }

    const created = [];
    const preserved = [];

    for (const dir of [
      path.join(base, FRAMEWORK_DIR, WORKFLOWS_DIR),
      generatedHome(base),
      path.join(base, FRAMEWORK_DIR, 'umbrella', 'ledger', 'entries'),
      path.join(base, FRAMEWORK_DIR, 'umbrella', 'outbox'),
    ]) {
      makeDirectory(dir, base);
      created.push(relative(base, dir));
    }

    write(manifest, text, base);
    created.push(relative(base, manifest));

    // The ignore file rides the same "written only when absent" rule as the
    // ledger: an operator who loosened it — to commit one generated chain on
    // purpose — is not overridden by a later `--force`.
    const ignore = path.join(generatedHome(base), '.gitignore');
    const index = path.join(base, FRAMEWORK_DIR, 'umbrella', 'ledger', 'index.yml');
    const log = path.join(base, FRAMEWORK_DIR, 'umbrella', 'ledger', 'ledger.log');
    for (const [file, body] of [[ignore, GENERATED_IGNORE], [index, 'version: 1\nentries: []\n'], [log, '']]) {
      if (exists(file)) {
        preserved.push(relative(base, file));
        continue;
      }
      write(file, body, base);
      created.push(relative(base, file));
    }

    const skipped = [];
    for (const target of scaffoldTargets()) {
      const decision = scaffoldDecision(base, target, scaffold);
      if (decision !== null) {
        skipped.push(decision);
        continue;
      }
      write(path.join(base, target.path), target.body, base);
      created.push(target.path);
    }

    return {
      ok: true,
      root: base,
      manifest: relative(base, manifest),
      umbrella_id: umbrellaId,
      members_root: found.membersRoot,
      members: found.members,
      created,
      preserved,
      skipped,
      unresolved: found.unresolved,
      warnings: found.warnings,
    };
  } catch (err) {
    return refused(err);
  }
}

/**
 * The two targets `--scaffold` governs, with the content they carry. Both are
 * short on purpose: they exist to tell a person what the directory is for, not
 * to be documentation the runtime then has to keep in step with itself.
 */
function scaffoldTargets() {
  return [
    {
      path: KNOWLEDGE_README,
      body: [
        '# Knowledge',
        '',
        'Notes that outlive a single run: decisions, conventions, and the reasons behind them.',
        '',
        'Every note here is expected to say where it came from — the run, the dispatch or the',
        'conversation that produced it — so a reader can judge how current it is. A note with no',
        'provenance is a claim nobody can check.',
        '',
        'This directory is declared as `knowledge` in `.maister/umbrella.yml`.',
        '',
      ].join('\n'),
    },
    {
      path: GUIDANCE_STUB,
      body: [
        '# Workspace guidance',
        '',
        'This workspace is an umbrella: the repositories under it are members, listed in',
        '`.maister/umbrella.yml`. Each member keeps its own history, its own task tree and its',
        'own conventions — nothing here overrides what a member says about itself.',
        '',
        '## Where things live',
        '',
        '- `.maister/umbrella.yml` — the members, the branch convention and the defaults',
        '- `.maister/umbrella/ledger/` — one entry per dispatch, plus the append-only log',
        '- `.maister/umbrella/outbox/` — what each dispatch reported back',
        '- `.maister/workflows/` — workflow definitions and overlays this workspace owns',
        '- `.maister/workflows/generated/` — chains generated for one ticket or one run: ignored by git, pruned once their runs close',
        '',
        '## Conventions',
        '',
        'Add what a newcomer to this workspace would otherwise have to infer: how the members',
        'relate, which one owns which surface, and what a change is expected to touch.',
        '',
      ].join('\n'),
    },
  ];
}

/**
 * Whether a scaffold target is skipped, and why — or null when it is written.
 * Both reasons are reported rather than assumed: "nothing happened" is the one
 * outcome an operator cannot tell apart from success by looking at the tree.
 */
function scaffoldDecision(base, target, scaffold) {
  if (!scaffold) {
    return {
      path: target.path,
      reason: 'scaffold-not-requested',
      message: `${target.path} sits outside ${FRAMEWORK_DIR}/ and is written only when --scaffold is passed.`,
    };
  }
  const candidates = target.path === GUIDANCE_STUB ? GUIDANCE_ALTERNATIVES : [target.path];
  const present = candidates.find((candidate) => exists(path.join(base, candidate)));
  if (present !== undefined) {
    return {
      path: target.path,
      reason: 'already-exists',
      message: `${present} is already there and is never rewritten.`,
    };
  }
  return null;
}

function exists(target) {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function makeDirectory(dir, base) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Refusal(CODES.unwritable,
      `${relative(base, dir)} could not be created: ${err.message}. Nothing was written.`);
  }
}

/** One published file, temp → rename, under this module's refusal vocabulary. */
function write(target, text, base) {
  makeDirectory(path.dirname(target), base);
  commit({ target, text, tmp: `${target}.tmp`, codes: CODES });
}

/**
 * A refusal, turned into the report the entry point prints before exiting 1.
 * Anything that is not a refusal is rethrown: it is a fault in the tooling, and
 * the entry point's exit 2 is the honest answer to it.
 */
function refused(err) {
  if (!(err instanceof Refusal)) throw err;
  return { ok: false, errors: [{ code: err.code, message: err.message }] };
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/**
 * Judge the workspace, and the definitions named with it.
 *
 * The pipeline is fixed and every stage collects rather than stopping at its
 * first finding: an operator fixing a manifest wants the whole list, not one
 * item per run. Stages that cannot run on what the stage before produced are
 * skipped, not guessed at — a manifest that did not parse has no members to
 * check a `dir:` against, and inventing an empty member map would turn one
 * error into a page of consequences.
 *
 * Reserved keys are surface-scoped. Of contract R's eight, exactly one —
 * `routing.tiers` — is a manifest key, and it is warned about here. The other
 * seven are workflow-definition keys and are already warned about by the
 * engine's graph checker in the same `reserved-key:<suffix>` vocabulary; this
 * merges the two streams into one report instead of restating either.
 */
export function validate(root, { definitions = [] } = {}) {
  const errors = [];
  const warnings = [];
  const resolved = [];

  let base;
  try {
    base = path.resolve(root);
    if (!isDirectory(base)) {
      throw new Refusal('umbrella-root-unusable',
        `${root} is not a directory, so there is nothing to validate. Pass --root pointing at the workspace itself.`);
    }
  } catch (err) {
    return refused(err);
  }

  const manifestPath = path.join(base, FRAMEWORK_DIR, 'umbrella.yml');
  const manifest = readDefinition(manifestPath);
  errors.push(...manifest.errors);
  warnings.push(...manifest.warnings);

  let members = null;
  if (manifest.doc !== null) {
    members = checkManifest(manifest.doc, manifestPath, errors, warnings);
  }

  for (const file of definitions) {
    const definition = readDefinition(file);
    if (definition.doc === null) {
      errors.push(...definition.errors);
      continue;
    }
    // The workspace is the project a `skill:` or `agent:` target is first
    // looked for in: a chain authored here may name a skill kept beside it.
    const report = validateGraph({ definition, overlays: [], profile: null, mode: 'resolved', project: base });
    errors.push(...report.errors.map((entry) => locate(entry, file)));
    warnings.push(...report.warnings.map((entry) => locate(entry, file)));
    resolved.push(...report.resolved.map((entry) => ({ file, ...entry })));
    if (members !== null) checkMemberDirs(definition.doc, file, members, errors);
    checkDriverCapable(definition.doc, file, errors);
  }

  // Each definition is reported as generated or not, by where it sits: the
  // rules it was judged by are identical either way, and the flag is what lets
  // a caller say so rather than infer it from the path.
  const home = generatedHome(base);
  const judged = definitions.map((file) => ({ file, generated: contains(home, path.resolve(file)) }));

  return { ok: errors.length === 0, root: base, manifest: relative(base, manifestPath), definitions: judged, errors, warnings, resolved };
}

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

/**
 * Delete generated chains whose runs have all closed.
 *
 * Why deletion is safe once a run closes, stated once: the engine freezes the
 * resolved graph into the run's state before the first node executes, and the
 * envelope re-reads the definition only while a node is being dispatched —
 * proving it against the frozen hash each time. A run whose `task.status` is
 * terminal dispatches nothing again, so nothing will open the file on its
 * behalf, and everything the cockpit renders about the run is in the run's own
 * directory. A run that is not terminal, or that holds a pending gate, may
 * still dispatch, and a chain such a run names is kept.
 *
 * Why an unreadable run state does not block. Dispatch reads the state before
 * it reads the definition, and refuses on a state it cannot read — so a run
 * whose state is unreadable cannot reach the chain file either. It is reported
 * as a warning rather than silently skipped, because an operator should know
 * one run could not be judged.
 *
 * Why a chain no run ever named is kept by default. The window between a
 * planner publishing a generated chain and an operator starting it is exactly
 * when a sweep would otherwise delete it. Naming the stem with `--name` is the
 * deliberate form, and it removes an unstarted chain too.
 *
 * Only the generated home is ever a candidate. A reusable chain at the top of
 * the workflow directory is never touched, even when `--name` spells its stem.
 */
export function prune(root, { name = null, dryRun = false } = {}) {
  try {
    const base = path.resolve(root);
    if (!isDirectory(base)) {
      throw new Refusal('umbrella-root-unusable',
        `${root} is not a directory, so there is nothing to prune. Pass --root pointing at the workspace itself.`);
    }
    const home = generatedHome(base);
    const stems = generatedStems(home);
    const runs = readRuns(base);

    let targets = stems;
    if (name !== null) {
      const stem = String(name);
      if (!CHAIN_STEM.test(stem) || !stems.includes(stem)) {
        throw new Refusal('umbrella-chain-missing',
          `${relative(base, home)}/${stem}.yml is not a generated chain this workspace holds${stems.length ? `; the generated chains are ${stems.join(', ')}` : '; it holds none'}. A stem is lowercase letters, digits and hyphens, and only the generated home is ever pruned — a reusable chain of that name is left alone. Nothing was deleted.`);
      }
      targets = [stem];
    }

    const pruned = [];
    const kept = [];
    for (const stem of targets) {
      const file = path.join(home, `${stem}.yml`);
      const naming = runs.entries.filter((run) => run.file !== null && samePath(run.file, file));
      const open = naming.filter((run) => !run.closed).map((run) => run.id);
      const ids = naming.map((run) => run.id);
      if (open.length > 0) {
        if (name !== null) {
          throw new Refusal('umbrella-chain-open',
            `${relative(base, file)} is named by ${open.length === 1 ? 'a run that has' : 'runs that have'} not closed (${open.join(', ')}), and a run that may still dispatch reads the definition when it does. Let the run finish, or stop it, then prune again. Nothing was deleted.`);
        }
        kept.push({ name: stem, reason: 'run-open', runs: ids });
        continue;
      }
      if (naming.length === 0 && name === null) {
        kept.push({ name: stem, reason: 'never-started', runs: [] });
        continue;
      }
      const files = CHAIN_EXTENSIONS.map((ext) => path.join(home, `${stem}.${ext}`)).filter(exists);
      if (!dryRun) for (const target of files) remove(target, base);
      pruned.push({ name: stem, files: files.map((target) => relative(base, target)), runs: ids });
    }

    return { ok: true, root: base, dry_run: dryRun, pruned, kept, warnings: runs.warnings };
  } catch (err) {
    return refused(err);
  }
}

/** `<root>/.maister/workflows/generated`, the one directory `prune` ever deletes from. */
function generatedHome(base) {
  return path.join(base, FRAMEWORK_DIR, WORKFLOWS_DIR, GENERATED_DIR);
}

/** The stems of every `<stem>.yml` in the generated home, sorted; none when the home is absent. */
function generatedStems(home) {
  if (!isDirectory(home)) return [];
  return fs.readdirSync(home)
    .filter((entry) => entry.endsWith('.yml') && isFile(path.join(home, entry)))
    .map((entry) => entry.slice(0, -'.yml'.length))
    .filter((stem) => CHAIN_STEM.test(stem))
    .sort();
}

/**
 * Every run under the workspace, with the definition file its state names and
 * whether it has closed. The source is resolved the way the envelope resolves
 * it — workspace-relative first, then run-relative, then as given — so a state
 * the engine wrote reads back the same here as it does at dispatch.
 */
function readRuns(base) {
  const runsDir = path.join(base, FRAMEWORK_DIR, ...RUNS_DIR);
  const entries = [];
  const warnings = [];
  if (!isDirectory(runsDir)) return { entries, warnings };
  for (const id of fs.readdirSync(runsDir).sort()) {
    const run = path.join(runsDir, id);
    const stateFile = path.join(run, STATE_FILE);
    if (!isFile(stateFile)) continue;
    const read = readDefinition(stateFile);
    if (read.doc === null || !isMap(read.doc)) {
      warnings.push({
        code: 'run-state-unreadable',
        path: relative(base, stateFile),
        message: `${relative(base, stateFile)} could not be read (${read.errors.map((each) => each.message).join('; ') || 'not a mapping'}), so which chain it names is unknown; it cannot dispatch from an unreadable state either, so nothing was held back for it.`,
      });
      continue;
    }
    const source = isMap(read.doc.workflow) ? read.doc.workflow.source : null;
    const status = isMap(read.doc.task) ? read.doc.task.status : null;
    const pending = isMap(read.doc.orchestrator) ? read.doc.orchestrator.gate_pending : null;
    entries.push({
      id,
      file: sourceFile(base, run, source),
      closed: CLOSED_STATUSES.includes(status) && (pending === null || pending === undefined),
    });
  }
  return { entries, warnings };
}

/** The file a state's `workflow.source` names, or null when it names none or a built-in. */
function sourceFile(base, run, source) {
  if (typeof source !== 'string' || source === '') return null;
  if (path.isAbsolute(source)) return source;
  const candidates = [path.resolve(base, source), path.resolve(run, source), path.resolve(source)];
  return candidates.find(isFile) ?? candidates[0];
}

/** One deleted file, under this module's refusal vocabulary. */
function remove(target, base) {
  try {
    fs.unlinkSync(target);
  } catch (err) {
    throw new Refusal(CODES.unwritable,
      `${relative(base, target)} could not be deleted: ${err.message}. Files deleted before it stay deleted; run prune again once the path is writable.`);
  }
}

/**
 * One entry in the `{file, node, path, message}` shape the whole report is
 * written in. The graph checker's warnings are bare strings — the vocabulary is
 * the message — so they are located here rather than at forty call sites there.
 */
function locate(entry, file) {
  if (typeof entry === 'string') return { file, node: null, path: '', message: entry };
  return { file, node: entry.node ?? null, path: entry.path ?? '', message: entry.message };
}

/**
 * The structural check, hand-written against `umbrella-manifest.schema.json`.
 *
 * Not Ajv: the schemas are validated by Ajv in this repository's own test suite,
 * where it is a development dependency, and in a consumer checkout there are no
 * dependencies at all. A validator that only worked where the tests run would
 * be checking the one place that needs it least.
 *
 * Returns the set of member names and paths, or null when `members` itself did
 * not hold up — the later `dir:` check needs to know the difference between "no
 * members declared" and "the members map could not be read".
 */
function checkManifest(doc, file, errors, warnings) {
  const fail = (dotted, message) => errors.push({ file, node: null, path: dotted, message });
  const warn = (dotted, message) => warnings.push({ file, node: null, path: dotted, message });

  if (!isMap(doc)) {
    fail('', 'the manifest must be a mapping');
    return null;
  }

  if (!Object.hasOwn(doc, 'version')) fail('version', 'the manifest declares no version');
  else if (doc.version !== 1) warn('version', `version ${doc.version} is not the version this build knows (1); it is read as far as its shape allows`);

  if (Object.hasOwn(doc, 'umbrella_id')) checkShortId(doc.umbrella_id, 'umbrella_id', fail);

  let members = null;
  if (!Object.hasOwn(doc, 'members')) {
    fail('members', 'the manifest declares no members map');
  } else if (!isMap(doc.members)) {
    fail('members', 'members must be a mapping from member name to its entry');
  } else {
    members = { names: new Set(), paths: new Set() };
    for (const [name, entry] of Object.entries(doc.members)) {
      const at = `members.${name}`;
      if (!isMap(entry)) {
        fail(at, 'a member entry must be a mapping');
        continue;
      }
      if (typeof entry.path !== 'string' || entry.path === '') fail(`${at}.path`, 'a member declares a path, as a non-empty string');
      else if (entry.path.startsWith('/')) fail(`${at}.path`, 'a member path is relative to the workspace, so it cannot begin with "/"');
      else members.paths.add(entry.path);
      if (Object.hasOwn(entry, 'kind') && typeof entry.kind !== 'string') fail(`${at}.kind`, 'kind is a string');
      if (Object.hasOwn(entry, 'default_provider') && !PROVIDERS.includes(entry.default_provider)) {
        fail(`${at}.default_provider`, `default_provider is one of ${PROVIDERS.join(', ')}`);
      }
      if (Object.hasOwn(entry, 'autonomy') && !AUTONOMY.includes(entry.autonomy)) {
        fail(`${at}.autonomy`, `autonomy is one of ${AUTONOMY.join(', ')}`);
      }
      members.names.add(name);
    }
  }

  checkNullableString(doc, 'branch_convention', fail);
  checkNullableString(doc, 'knowledge', fail);

  if (Object.hasOwn(doc, 'coordination')) {
    if (!isMap(doc.coordination)) fail('coordination', 'coordination is a mapping');
    else {
      checkNullableString(doc.coordination, 'branch', fail, 'coordination');
      checkNullableString(doc.coordination, 'worktree', fail, 'coordination');
      if (Object.hasOwn(doc.coordination, 'retention')) {
        if (!isMap(doc.coordination.retention)) fail('coordination.retention', 'retention is a mapping');
        else checkNullableInteger(doc.coordination.retention, 'days', fail, 'coordination.retention');
      }
    }
  }

  if (Object.hasOwn(doc, 'tracker')) {
    if (!isMap(doc.tracker)) fail('tracker', 'tracker is a mapping');
    else {
      checkNullableString(doc.tracker, 'kind', fail, 'tracker');
      checkNullableString(doc.tracker, 'project', fail, 'tracker');
      if (Object.hasOwn(doc.tracker, 'mirror')) {
        if (!isMap(doc.tracker.mirror)) fail('tracker.mirror', 'mirror is a mapping');
        else {
          if (Object.hasOwn(doc.tracker.mirror, 'enabled') && typeof doc.tracker.mirror.enabled !== 'boolean') {
            fail('tracker.mirror.enabled', 'enabled is true or false');
          }
          checkNullableString(doc.tracker.mirror, 'scope', fail, 'tracker.mirror');
        }
      }
    }
  }

  if (Object.hasOwn(doc, 'git_host')) {
    if (!isMap(doc.git_host)) fail('git_host', 'git_host is a mapping');
    else {
      checkNullableString(doc.git_host, 'kind', fail, 'git_host');
      checkNullableString(doc.git_host, 'org', fail, 'git_host');
    }
  }

  if (Object.hasOwn(doc, 'retention')) {
    if (!isMap(doc.retention)) fail('retention', 'retention is a mapping');
    else {
      checkNullableInteger(doc.retention, 'days', fail, 'retention');
      if (Object.hasOwn(doc.retention, 'lfs')) {
        if (!Array.isArray(doc.retention.lfs)) fail('retention.lfs', 'lfs is a sequence of strings');
        else doc.retention.lfs.forEach((item, index) => {
          if (typeof item !== 'string') fail(`retention.lfs.${index}`, 'an lfs pattern is a string');
        });
      }
    }
  }

  if (Object.hasOwn(doc, 'people')) {
    if (!Array.isArray(doc.people)) fail('people', 'people is a sequence of person entries');
    else doc.people.forEach((person, index) => checkPerson(person, `people.${index}`, members, fail));
  }

  if (Object.hasOwn(doc, 'defaults')) {
    if (!isMap(doc.defaults)) fail('defaults', 'defaults is a mapping');
    else {
      if (Object.hasOwn(doc.defaults, 'autonomy') && !AUTONOMY.includes(doc.defaults.autonomy)) {
        fail('defaults.autonomy', `autonomy is one of ${AUTONOMY.join(', ')}`);
      }
      if (Object.hasOwn(doc.defaults, 'worktree') && typeof doc.defaults.worktree !== 'boolean') {
        fail('defaults.worktree', 'worktree is true or false');
      }
    }
  }

  if (Object.hasOwn(doc, 'routing')) {
    if (!isMap(doc.routing)) fail('routing', 'routing is a mapping');
    else if (Object.hasOwn(doc.routing, 'tiers')) {
      if (!isMap(doc.routing.tiers)) fail('routing.tiers', 'tiers is a mapping');
      // Contract R: parsed, warned about, inert. The suffix spelling is the
      // engine's, so one vocabulary covers both surfaces.
      else warn(RESERVED_MANIFEST_PATH, `reserved-key:${RESERVED_MANIFEST_PATH}`);
    }
  }

  return members;
}

function checkPerson(person, at, members, fail) {
  if (!isMap(person)) {
    fail(at, 'a person entry is a mapping');
    return;
  }
  if (Object.hasOwn(person, 'id')) checkShortId(person.id, `${at}.id`, fail);
  for (const key of ['email', 'name', 'github', 'gitlab', 'jira']) checkNullableString(person, key, fail, at);
  if (!Object.hasOwn(person, 'members')) return;
  if (!Array.isArray(person.members)) {
    fail(`${at}.members`, 'a person\'s members is a sequence of member names');
    return;
  }
  person.members.forEach((name, index) => {
    if (typeof name !== 'string' || name === '') {
      fail(`${at}.members.${index}`, 'a member name is a non-empty string');
      return;
    }
    // Names, not paths: the whole point of the list is that it looks up in the
    // members map, and a name that does not is a mapping to nothing.
    if (members !== null && !members.names.has(name)) {
      fail(`${at}.members.${index}`, `"${name}" is not a declared member`);
    }
  });
}

function checkShortId(value, at, fail) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    fail(at, 'an id is 1-64 characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit');
  }
}

function checkNullableString(holder, key, fail, prefix = '') {
  if (!Object.hasOwn(holder, key)) return;
  const value = holder[key];
  if (value !== null && typeof value !== 'string') {
    fail(prefix === '' ? key : `${prefix}.${key}`, `${key} is a string or null`);
  }
}

function checkNullableInteger(holder, key, fail, prefix = '') {
  if (!Object.hasOwn(holder, key)) return;
  const value = holder[key];
  if (value !== null && !Number.isInteger(value)) {
    fail(prefix === '' ? key : `${prefix}.${key}`, `${key} is a whole number or null`);
  }
}

/**
 * Every `dir:` in a definition names a member the manifest declares.
 *
 * This is the one reference the graph checker cannot resolve: it knows the
 * definition and the plugin tree, and a member exists only in the manifest. An
 * interpolated `dir:` is left alone — what it resolves to is decided at
 * dispatch time, from a value this stage does not have.
 *
 * A member's path is accepted beside its name. The manifest keys members by
 * name, so the name is the spelling to prefer, but a path is unambiguous and
 * rejecting one would be reporting a defect where there is none.
 */
function checkMemberDirs(doc, file, members, errors) {
  if (!isMap(doc) || !isMap(doc.nodes)) return;
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isMap(node) || typeof node.dir !== 'string' || node.dir === '') continue;
    if (node.dir.includes('${')) continue;
    if (members.names.has(node.dir) || members.paths.has(node.dir)) continue;
    errors.push({
      file,
      node: id,
      path: `nodes.${id}.dir`,
      message: `"${node.dir}" is not a member this workspace declares; the members are ${[...members.names].join(', ') || 'none'}`,
    });
  }
}

/**
 * Every `dir:` node names a target that can honour a driver.
 *
 * The sibling of the member check above, and the second reference the graph
 * checker cannot judge: it decides whether a target *resolves*, while whether a
 * resolved target can be *dispatched* is a property of the shipped skill behind
 * it. A dispatched worker is unattended, so its workflow has to record a driver
 * kind, write its gate requests to a file and print a marker instead of asking
 * a question nobody is there to answer.
 *
 * The rule itself is `envelope.mjs`'s `driverCapability`, so there is one
 * definition of "driver-capable" and one grep behind it. Only the verdict is
 * imported: the dispatch refusal that the same rule feeds stays in the dispatch
 * vocabulary, is never raised or caught here, and is never quoted in this
 * report. The two messages below are composed for an operator reading a
 * validation report, and name what a capable target is rather than a code.
 *
 * The verdict is three-valued because the report has two different things to
 * say. A target that was read and does not state the driver rule is the
 * author's defect. A `skill:` target this installation holds no file for was
 * never read at all, and claiming it lacks the rule would assert something this
 * check cannot know — so it says that instead, and its recovery includes
 * installing whatever ships the skill. The graph checker warns on the same
 * node, and the two findings agree: it reports the reference as unresolved,
 * this one reports that an unresolved target cannot be dispatched, because the
 * runtime that builds the worker's envelope reads exactly this file too.
 *
 * Where it diverges from the member check above, it does so deliberately: that
 * one skips an interpolated `dir:` because what it resolves to is decided at
 * dispatch time, while `uses:` is not an interpolated key in the grammar, so
 * there is never a spelling here whose target is unknown until the run.
 *
 * A node with no `uses:` at all is left alone — the graph checker already fails
 * it at this very path, and saying it twice in two vocabularies helps nobody.
 */
function checkDriverCapable(doc, file, errors) {
  if (!isMap(doc) || !isMap(doc.nodes)) return;
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isMap(node) || typeof node.dir !== 'string' || node.dir === '') continue;
    if (typeof node.uses !== 'string' || node.uses === '') continue;
    const verdict = driverCapability(node.uses);
    if (verdict === 'capable') continue;
    errors.push({
      file,
      node: id,
      path: `nodes.${id}.uses`,
      message: verdict === 'unreadable'
        ? `"${node.uses}" cannot be dispatched into a member: this installation holds no such skill — not the workspace, not the plugin, not any installed plugin — so nothing was read and whether it honours a driver is unknown here. A dispatched target has to be readable where the dispatch is built, because the same lookup decides it there. Install whatever ships that skill, point this node at a workflow: target or at an orchestrator skill this installation carries, or drop its dir: and run it in the coordinating repository.`
        : `"${node.uses}" cannot be dispatched into a member: a dispatched worker runs unattended, so it has to record the driver it was started under, write each gate out as a request file and print a marker instead of asking. Only a workflow: target, which the engine runs, or an orchestrator skill that declares driver_aware: true in its frontmatter, or whose SKILL.md states that driver-qualified gate rule, does that. Point this node at one of those, or drop its dir: and run it in the coordinating repository.`,
    });
  }
}

function isMap(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
