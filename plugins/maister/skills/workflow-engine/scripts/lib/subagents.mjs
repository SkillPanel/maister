/**
 * The models and effort a run's subagents are dispatched with: the shipped
 * defaults, the `subagents` block a project, an overlay and a profile may
 * carry, the judgement of that block, the copy the freeze records and the one
 * resolution every reader of it shares.
 *
 * Why this module exists. Both hosts take a model on each agent call, and that
 * value outranks the agent's frontmatter, so the choice is made at the call.
 * A model composing the call should copy one printed value rather than work out
 * a precedence order itself, so the order lives here, once: `dispatch-model`
 * prints it, `node-brief` prints it on an `agent:` node's `runs:` line, and the
 * freeze records the block both of them read for a run.
 *
 * Where a block comes from, and the copy the freeze records:
 *
 *   project   the `subagents:` key of `.maister/config.yml`, the one place
 *             that may remap the ladder (`tiers`)
 *   overlay   each overlay's top-level `subagents:`, folded in the order the
 *             overlays apply, a later entry replacing an earlier one
 *   profile   the selected profile's `subagents:`
 *
 * The freeze writes `orchestrator.options.subagents` as the project block with
 * the two others under `overlay:` and `profile:`, kept apart so the order below
 * still holds when the copy is read back. A run with none of the three records
 * no key. There is no hash: the state is its own record, and a later edit of
 * `config.yml` reaches the next run, never this one.
 *
 * Precedence, first hit wins:
 *
 *   1. the plan tier a caller passes, when the agent's entry is
 *      `choose: by-plan-tier`, clamped to that entry's `allowed` and
 *      `ceiling` — for any other agent the tier is not read;
 *   2. the profile, 3. the overlay, then the project, and last the shipped
 *      defaults — each layer read as `workflows.<w>.nodes.<n>.agents`, then
 *      `workflows.<w>.agents`, then `agents`, then `default`;
 *   and the host, when the hit says `inherit`: the call then carries no model
 *   and the host's own order applies.
 *
 * An effort applies on both hosts, and neither checks the value, so the
 * judgement below does. A pinned `model` is a Claude Code alias; on Copilot
 * such an entry is passed over and the next level answers.
 *
 * The built-in agent types (`BUILT_IN_AGENTS`) are matched without regard to
 * case, in the judgement and in the resolution, so a block naming `Explore`
 * also covers Copilot's `explore`.
 *
 * A block with any error is refused whole — every layer of it — and the
 * shipped defaults apply, each error returned as a `subagents-error:` warning
 * saying so. Nothing here ever stops a run: a refused block costs the choice,
 * never the run.
 *
 * Pure apart from the file reads: no stdio, and every finding is returned as
 * data.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDefinition } from './definition.mjs';
import { locateTarget, pluginRoot } from './graph.mjs';

/** The ladder, cheapest first. A project remaps a rung's cells; it adds none. */
export const LADDER = ['light', 'standard', 'deep'];

/** What `effort` may be, on a tier, a preset or an entry. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The hosts the verb answers for. */
export const HOSTS = ['claude', 'copilot'];

/**
 * Claude Code's model aliases. A Claude Code call takes one of these and
 * refuses a full id before it launches, so a `claude` cell and a pinned
 * `model` are one of them or `inherit`. Copilot takes an alias without a word
 * and runs another model in its place, so a `copilot` cell is a model id,
 * never one of these.
 */
const CLAUDE_ALIASES = ['haiku', 'sonnet', 'opus', 'fable'];

/** The agent types each host provides itself, matched without regard to case. */
const BUILT_IN_AGENTS = ['Explore', 'general-purpose', 'Plan'];

/**
 * Copilot's per-request cost of a model, where it is above one request. A
 * Copilot cell naming one of these warns unless it carries `premium: true`.
 */
const COPILOT_MULTIPLIERS = { 'claude-opus-5.5': 15 };

/** The value that hands the choice to the host. */
const INHERIT = 'inherit';

/** What a resolved `inherit` prints: the call carries no such field. */
export const OMIT = 'omit';

/** The one `choose` policy. */
const BY_PLAN_TIER = 'by-plan-tier';

/** The rung a `by-plan-tier` group with no planner tier gets, unless the entry says otherwise. */
const UNASSESSED = 'standard';

/**
 * Maister's own table: the ladder with a cell per host, and the clerical
 * agents on `light`. Everything else inherits, and nothing ships an effort.
 */
export const SHIPPED = Object.freeze({
  tiers: {
    light: { claude: 'haiku', copilot: 'claude-haiku-5.5' },
    standard: { claude: 'sonnet', copilot: 'claude-sonnet-5.5' },
    deep: { claude: 'opus', copilot: 'claude-opus-5.5' },
  },
  default: { tier: INHERIT },
  agents: {
    'project-analyzer': { tier: 'light' },
    'docs-operator': { tier: 'light' },
    'task-classifier': { tier: 'light' },
    'test-suite-runner': { tier: 'light' },
    'html-companion-writer': { tier: 'light' },
  },
});

/** The keys of each level. A key outside its level's set warns and is dropped. */
const BLOCK_KEYS = ['tiers', 'presets', 'default', 'agents', 'workflows'];
const LAYER_KEYS = ['presets', 'default', 'agents', 'workflows'];
const CELL_KEYS = ['claude', 'copilot', 'effort', 'premium'];
const ENTRY_KEYS = ['tier', 'preset', 'model', 'effort', 'choose', 'allowed', 'unassessed', 'ceiling', 'budget'];
const WORKFLOW_KEYS = ['agents', 'nodes'];
const NODE_KEYS = ['agents'];

/** The keys an entry picks its model by; at most one of them. */
const PICKS = ['tier', 'preset', 'model', 'choose'];

/** A name the state's one-line writer can hold as a key. */
const NAME = /^[A-Za-z0-9._-]+$/;

/** A model name: one token, nothing the one-line writer would refuse. */
const MODEL = /^[A-Za-z0-9._:/@[\]-]+$/;

/** Where a project's config lives, relative to its root. */
const CONFIG = path.join('.maister', 'config.yml');

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * The `subagents` block of a project's `config.yml`: `{file, block, errors}`,
 * `block` null when the file or the key is absent. Only the top-level
 * `subagents:` entry is cut out and read, so the rest of the file — free for
 * any YAML the engine's reader does not take — can never refuse it. A block
 * the reader refuses is one error.
 */
export function readConfigBlock(root) {
  const file = path.join(root, CONFIG);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, block: null, errors: [] };
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => /^subagents\s*:/.test(line));
  if (start < 0) return { file, block: null, errors: [] };
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]) || lines[end].startsWith('#'))) end++;
  const parsed = parseDefinition(lines.slice(start, end).join('\n'), file);
  if (parsed.doc === null) {
    const error = parsed.errors[0];
    return { file, block: null, errors: [{ file, path: error?.path || 'subagents', message: error?.message ?? 'cannot be read' }] };
  }
  const block = parsed.doc.subagents;
  return { file, block: block === null || block === undefined ? null : block, errors: [] };
}

/** An overlay document's own block, and each of its profiles' blocks, as `{file, prefix, block}`. */
function overlayLayers(overlay) {
  const doc = isMap(overlay?.doc) ? overlay.doc : {};
  const own = doc.subagents === undefined ? [] : [{ file: overlay.file, prefix: 'subagents', block: doc.subagents, kind: 'overlay' }];
  const profiles = isMap(doc.profiles) ? Object.entries(doc.profiles) : [];
  return {
    own,
    profiles: profiles
      .filter(([, ops]) => isMap(ops) && ops.subagents !== undefined)
      .map(([name, ops]) => ({ name, file: overlay.file, prefix: `profiles.${name}.subagents`, block: ops.subagents, kind: 'profile' })),
  };
}

// ---------------------------------------------------------------------------
// judging
// ---------------------------------------------------------------------------

/**
 * Judge a set of layers together, as one run would read them: the presets of
 * every layer are known to every other. Returns `{errors, warnings, clean}`:
 * errors as `{file, path, message}`, warnings as code strings, and each layer's
 * block with the keys that warned dropped, ready to freeze.
 */
function judge(layers, { project }) {
  const errors = [];
  const warnings = [];
  const presets = new Set();
  for (const layer of layers) {
    if (isMap(layer.block) && isMap(layer.block.presets)) for (const name of Object.keys(layer.block.presets)) presets.add(name);
  }
  const clean = layers.map(layer => judgeLayer(layer, { presets, project, errors, warnings }));
  return { errors, warnings, clean };
}

function judgeLayer(layer, context) {
  const at = { file: layer.file, path: layer.prefix };
  const fault = (where, message) => context.errors.push({ file: layer.file, path: where, message });
  if (!isMap(layer.block)) {
    fault(at.path, 'the subagents block is a mapping');
    return null;
  }
  const keys = layer.kind === 'project' ? BLOCK_KEYS : LAYER_KEYS;
  if (layer.kind !== 'project' && Object.hasOwn(layer.block, 'tiers')) {
    fault(`${at.path}.tiers`, `an ${layer.kind} carries no tiers: only the project's config.yml remaps the ladder`);
  }
  const out = {};
  for (const [key, value] of Object.entries(layer.block)) {
    const where = `${at.path}.${key}`;
    if (key === 'tiers' && layer.kind !== 'project') continue;
    if (!keys.includes(key)) {
      unknownKey(context, layer.file, where, keys);
      continue;
    }
    if (key === 'tiers') out.tiers = judgeCells(value, where, layer.file, context, { tiers: true });
    if (key === 'presets') out.presets = judgeCells(value, where, layer.file, context, { tiers: false });
    if (key === 'default') out.default = judgeEntry(value, where, layer.file, context);
    if (key === 'agents') out.agents = judgeAgents(value, where, layer.file, context);
    if (key === 'workflows') out.workflows = judgeWorkflows(value, where, layer.file, context);
  }
  return out;
}

/** The ladder's cells or the presets: each a map of host cells, an effort and `premium`. */
function judgeCells(value, where, file, context, { tiers }) {
  const fault = (at, message) => context.errors.push({ file, path: at, message });
  if (!isMap(value)) {
    fault(where, `${tiers ? 'tiers' : 'presets'} is a mapping of ${tiers ? 'rung' : 'preset name'} to its cells`);
    return {};
  }
  const out = {};
  for (const [name, cell] of Object.entries(value)) {
    const at = `${where}.${name}`;
    if (tiers && !LADDER.includes(name)) {
      fault(at, `"${name}" is not a tier: the ladder is ${LADDER.join(', ')}, and a project remaps a rung, never adds one`);
      continue;
    }
    if (!NAME.test(name)) {
      fault(at, `"${name}" is not a usable preset name: letters, digits, dot, dash and underscore`);
      continue;
    }
    if (!isMap(cell)) {
      fault(at, `a ${tiers ? 'tier' : 'preset'} is a mapping of claude, copilot, effort and premium`);
      continue;
    }
    const kept = {};
    for (const [key, item] of Object.entries(cell)) {
      const field = `${at}.${key}`;
      if (!CELL_KEYS.includes(key)) {
        unknownKey(context, file, field, CELL_KEYS);
        continue;
      }
      if (key === 'claude' || key === 'copilot') {
        if (!isModel(item)) {
          fault(field, `${describe(item)} is not a model name`);
          continue;
        }
        if (key === 'claude' && !isClaudeModel(item)) {
          fault(field, claudeRefusal(item));
          continue;
        }
        if (key === 'copilot' && CLAUDE_ALIASES.includes(item)) {
          fault(field, `"${item}" is a Claude Code alias, which Copilot takes without a word and replaces with a model of its own: a copilot cell names a model id, such as claude-${item}-5.5`);
          continue;
        }
      }
      if (key === 'effort' && !EFFORTS.includes(item)) {
        fault(field, `${describe(item)} is not an effort: expected one of ${EFFORTS.join(', ')}`);
        continue;
      }
      if (key === 'premium' && typeof item !== 'boolean') {
        fault(field, `premium is true or false, not ${describe(item)}`);
        continue;
      }
      kept[key] = item;
    }
    const multiplier = COPILOT_MULTIPLIERS[kept.copilot];
    if (multiplier > 1 && kept.premium !== true) {
      context.warnings.push(`subagents-premium-model:${shownFile(file, context)}:${at}.copilot — ${kept.copilot} costs ${multiplier}× per request on Copilot; add premium: true to the cell to confirm the cost`);
    }
    out[name] = kept;
  }
  return out;
}

/** An agents map: each name known, each entry judged. */
function judgeAgents(value, where, file, context) {
  if (!isMap(value)) {
    context.errors.push({ file, path: where, message: 'agents is a mapping of agent name to entry' });
    return {};
  }
  const out = {};
  for (const [name, entry] of Object.entries(value)) {
    const at = `${where}.${name}`;
    if (!NAME.test(name)) {
      context.errors.push({ file, path: at, message: `"${name}" is not a usable agent name: write the bare name, without a plugin prefix` });
      continue;
    }
    if (!builtInOf(name) && locateTarget('agent', name, { project: context.project }) === null) {
      context.warnings.push(`subagents-unknown-agent:${shownFile(file, context)}:${at} — no agent of that name is found in the project, the operator's directories or an installed plugin; it applies only once one is`);
    }
    out[name] = judgeEntry(entry, at, file, context);
  }
  return out;
}

/** `workflows.<w>`: its agents, and its nodes' agents. */
function judgeWorkflows(value, where, file, context) {
  const fault = (at, message) => context.errors.push({ file, path: at, message });
  if (!isMap(value)) {
    fault(where, 'workflows is a mapping of workflow name to its agents and nodes');
    return {};
  }
  const out = {};
  for (const [workflow, body] of Object.entries(value)) {
    const at = `${where}.${workflow}`;
    if (!NAME.test(workflow)) {
      fault(at, `"${workflow}" is not a workflow name`);
      continue;
    }
    if (!isMap(body)) {
      fault(at, 'a workflow entry is a mapping of agents and nodes');
      continue;
    }
    const kept = {};
    for (const [key, item] of Object.entries(body)) {
      if (!WORKFLOW_KEYS.includes(key)) {
        unknownKey(context, file, `${at}.${key}`, WORKFLOW_KEYS);
        continue;
      }
      if (key === 'agents') kept.agents = judgeAgents(item, `${at}.agents`, file, context);
      if (key === 'nodes') kept.nodes = judgeNodes(item, `${at}.nodes`, file, context);
    }
    out[workflow] = kept;
  }
  return out;
}

function judgeNodes(value, where, file, context) {
  const fault = (at, message) => context.errors.push({ file, path: at, message });
  if (!isMap(value)) {
    fault(where, 'nodes is a mapping of node id to its agents');
    return {};
  }
  const out = {};
  for (const [node, body] of Object.entries(value)) {
    const at = `${where}.${node}`;
    if (!NAME.test(node)) {
      fault(at, `"${node}" is not a node id`);
      continue;
    }
    if (!isMap(body)) {
      fault(at, 'a node entry is a mapping holding agents');
      continue;
    }
    const kept = {};
    for (const [key, item] of Object.entries(body)) {
      if (!NODE_KEYS.includes(key)) {
        unknownKey(context, file, `${at}.${key}`, NODE_KEYS);
        continue;
      }
      kept.agents = judgeAgents(item, `${at}.agents`, file, context);
    }
    out[node] = kept;
  }
  return out;
}

/** One entry: a tier, a preset, a pinned model, an effort, or the by-plan-tier policy. */
function judgeEntry(value, where, file, context) {
  const fault = (at, message) => context.errors.push({ file, path: at, message });
  if (!isMap(value)) {
    fault(where, `an entry is a mapping — {tier: <rung>}, {preset: <name>}, {model: <model>} or {choose: ${BY_PLAN_TIER}, …}`);
    return {};
  }
  const picks = PICKS.filter(key => Object.hasOwn(value, key));
  if (picks.length > 1) fault(where, `an entry picks its model one way: it names ${picks.join(' and ')}`);
  const tier = rung => rung === INHERIT || LADDER.includes(rung);
  const kept = {};
  for (const [key, item] of Object.entries(value)) {
    const at = `${where}.${key}`;
    if (!ENTRY_KEYS.includes(key)) {
      unknownKey(context, file, at, ENTRY_KEYS);
      continue;
    }
    if (key === 'tier' && !tier(item)) {
      fault(at, `${describe(item)} is not a tier: expected one of ${[...LADDER, INHERIT].join(', ')}`);
    } else if (key === 'preset' && !context.presets.has(item)) {
      fault(at, `${describe(item)} is not a preset: ${context.presets.size ? `the presets are ${[...context.presets].join(', ')}` : 'no presets are defined'}`);
    } else if (key === 'model' && !isClaudeModel(item)) {
      fault(at, claudeRefusal(item));
    } else if (key === 'effort' && !EFFORTS.includes(item)) {
      fault(at, `${describe(item)} is not an effort: expected one of ${EFFORTS.join(', ')}`);
    } else if (key === 'choose' && item !== BY_PLAN_TIER) {
      fault(at, `${describe(item)} is not a choice policy: the one policy is ${BY_PLAN_TIER}`);
    } else if (key === 'allowed' && (!Array.isArray(item) || item.length === 0 || item.some(each => !LADDER.includes(each)))) {
      fault(at, `allowed lists rungs of the ladder (${LADDER.join(', ')}); ${describe(item)} is outside it`);
    } else if ((key === 'unassessed' || key === 'ceiling') && !LADDER.includes(item)) {
      fault(at, `${describe(item)} is not a tier: expected one of ${LADDER.join(', ')}`);
    } else if (key === 'budget' && !budgetOk(item)) {
      fault(at, `budget maps a rung of the ladder to a whole number of groups, such as {deep: 3}; ${describe(item)} is not one`);
    } else {
      kept[key] = item;
    }
  }
  return kept;
}

function budgetOk(value) {
  return isMap(value) && Object.entries(value).every(([rung, count]) => LADDER.includes(rung) && Number.isInteger(count) && count >= 0);
}

function unknownKey(context, file, where, accepted) {
  context.warnings.push(`subagents-unknown-key:${shownFile(file, context)}:${where} — not a key at this level, so it is ignored; the accepted keys are ${accepted.join(', ')}`);
}

/** One error as the warning both the freeze and `validate` return. */
function refusal(error, context) {
  return `subagents-error:${shownFile(error.file, context)}:${error.path} — ${error.message}; the whole subagents block is refused and the shipped defaults apply`;
}

/** A file as a finding names it: relative to the project root when it lies inside it. */
function shownFile(file, context) {
  const relative = path.relative(context.project, path.resolve(file));
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return (inside ? relative : String(file)).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// the two entry points that read files: validate and the freeze
// ---------------------------------------------------------------------------

/**
 * Every finding about the blocks a run of these overlays could read, for
 * `validate`: the project's `config.yml`, each overlay, and every profile the
 * overlays declare, each profile judged with the layers beneath it. All of them
 * are warnings — a refused block falls back to the shipped defaults, so none
 * stops a run.
 */
export function subagentsWarnings({ project, overlays = [] }) {
  const context = { project };
  const config = readConfigBlock(project);
  const base = [];
  if (config.block !== null) base.push({ file: config.file, prefix: 'subagents', block: config.block, kind: 'project' });
  const profiles = [];
  for (const overlay of overlays) {
    const { own, profiles: declared } = overlayLayers(overlay);
    base.push(...own);
    profiles.push(...declared);
  }
  const found = new Set(config.errors.map(error => refusal(error, context)));
  for (const layers of [base, ...profiles.map(profile => [...base, profile])]) {
    if (!layers.length) continue;
    const judged = judge(layers, { project });
    for (const error of judged.errors) found.add(refusal(error, context));
    for (const warning of judged.warnings) found.add(warning);
  }
  return [...found];
}

/**
 * The block a freeze records, and the warnings it owes: `{block, warnings}`,
 * `block` null when no layer carries one or when the whole was refused.
 * `overlays` are the overlays the run froze, as the reader returns them, and
 * `profile` the selected profile's name.
 */
export function frozenSubagents({ project, overlays = [], profile = null }) {
  const context = { project };
  const config = readConfigBlock(project);
  const layers = [];
  if (config.block !== null) layers.push({ file: config.file, prefix: 'subagents', block: config.block, kind: 'project' });
  for (const overlay of overlays) layers.push(...overlayLayers(overlay).own);
  if (profile !== null) {
    for (const overlay of overlays) layers.push(...overlayLayers(overlay).profiles.filter(each => each.name === profile));
  }
  if (config.errors.length) return { block: null, warnings: config.errors.map(error => refusal(error, context)) };
  if (!layers.length) return { block: null, warnings: [] };
  const judged = judge(layers, { project });
  if (judged.errors.length) {
    return { block: null, warnings: [...judged.errors.map(error => refusal(error, context)), ...judged.warnings] };
  }
  const of = kind => judged.clean.filter((_, index) => layers[index].kind === kind);
  const block = { ...(of('project')[0] ?? {}) };
  const overlay = of('overlay').reduce(foldLayer, null);
  const selected = of('profile').reduce(foldLayer, null);
  if (overlay !== null) block.overlay = overlay;
  if (selected !== null) block.profile = selected;
  return { block, warnings: judged.warnings };
}

/** One layer laid over another: a later entry, preset or default replaces an earlier one whole. */
function foldLayer(under, over) {
  if (under === null) return over;
  const out = { ...under };
  if (over.presets) out.presets = { ...under.presets, ...over.presets };
  if (over.default) out.default = over.default;
  if (over.agents) out.agents = { ...under.agents, ...over.agents };
  if (over.workflows) {
    out.workflows = { ...under.workflows };
    for (const [name, body] of Object.entries(over.workflows)) {
      const was = out.workflows[name] ?? {};
      const nodes = { ...was.nodes };
      for (const [id, node] of Object.entries(body.nodes ?? {})) nodes[id] = { agents: { ...nodes[id]?.agents, ...node.agents } };
      out.workflows[name] = {
        ...(was.agents || body.agents ? { agents: { ...was.agents, ...body.agents } } : {}),
        ...(Object.keys(nodes).length ? { nodes } : {}),
      };
    }
  }
  return out;
}

/** The project part of a frozen block: the copy `config.yml` is compared with. */
export function projectPart(block) {
  if (!isMap(block)) return null;
  const { overlay: _overlay, profile: _profile, ...own } = block;
  return Object.keys(own).length ? own : null;
}

/**
 * The project's `config.yml` block as a freeze would record it now, or null:
 * a refused block reads as none, as it would freeze.
 */
export function currentProjectBlock(project) {
  const config = readConfigBlock(project);
  if (config.block === null || config.errors.length) return null;
  const judged = judge([{ file: config.file, prefix: 'subagents', block: config.block, kind: 'project' }], { project });
  if (judged.errors.length) return null;
  return Object.keys(judged.clean[0]).length ? judged.clean[0] : null;
}

/** Whether two blocks say the same, whatever the key order and the reader that built them. */
export function sameBlock(a, b) {
  return stable(a) === stable(b);
}

function stable(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isMap(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(String(value));
}

// ---------------------------------------------------------------------------
// resolving
// ---------------------------------------------------------------------------

/**
 * The model and effort for one agent: `{model, effort, source, budget,
 * tierIgnored}`, where `model` and `effort` are a value or `OMIT`, `source`
 * names the level that answered, `budget` is `{tier, limit, used}` when the
 * answer is a rung the agent's policy budgets, else null, and `tierIgnored`
 * says a plan tier was passed for an agent whose entry is no
 * `choose: by-plan-tier`, so it was not read.
 *
 * `block` is the recorded block (null for the shipped defaults alone),
 * `workflow` and `node` the scope (null outside a run), `tier` the plan tier a
 * caller passed (null for none), `host` one of `HOSTS`, and `used` the count of
 * groups already run per rung, or null when there is no run to count in.
 */
export function resolveAgent(agent, { block = null, workflow = null, node = null, tier = null, host, used = null }) {
  const name = bareAgent(agent);
  const frozen = isMap(block) ? block : {};
  const layers = [
    ['profile', frozen.profile],
    ['overlay', frozen.overlay],
    ['project', projectPart(frozen)],
    ['shipped', SHIPPED],
  ].filter(([, layer]) => isMap(layer));

  const hits = [];
  for (const [label, layer] of layers) {
    const scoped = isMap(layer.workflows) && workflow !== null ? layer.workflows[workflow] : null;
    const scopes = [];
    if (isMap(scoped) && node !== null && isMap(scoped.nodes) && isMap(scoped.nodes[node])) {
      scopes.push([scoped.nodes[node].agents, `workflows.${workflow}.nodes.${node}.agents`]);
    }
    if (isMap(scoped)) scopes.push([scoped.agents, `workflows.${workflow}.agents`]);
    scopes.push([layer.agents, 'agents']);
    for (const [agents, prefix] of scopes) {
      const found = findAgent(agents, name);
      if (found) hits.push({ entry: found.entry, source: `${label} ${prefix}.${found.key}` });
    }
    if (isMap(layer.default)) hits.push({ entry: layer.default, source: `${label} default` });
  }

  // A pinned model is Claude Code's; on Copilot the next level answers.
  const usable = hits.filter(hit => !(host === 'copilot' && isPin(hit.entry)));
  const hit = usable[0] ?? null;
  const ladder = ladderOf(frozen);
  const planned = hit !== null && hit.entry.choose === BY_PLAN_TIER;

  // A plan tier is read only by an agent the plan chooses for: any other
  // resolves as if none were passed, so a planner's tier never escalates an
  // agent that has no allowed set, ceiling or budget.
  if (tier !== null && planned) {
    const rung = clamp(tier, hit.entry);
    const source = `plan tier ${tier}${rung === tier ? '' : `, clamped to ${rung}`} within ${hit.source}`;
    return { ...fromRung(ladder, rung, host, hit.entry.effort), source, budget: budgetOf(hit, rung, used), tierIgnored: false };
  }
  return { ...unplanned(hit, { frozen, ladder, host, used }), tierIgnored: tier !== null };
}

/** The answer for an agent no plan tier applies to: its first usable hit, or the host. */
function unplanned(hit, { frozen, ladder, host, used }) {
  if (hit === null) return { model: OMIT, effort: OMIT, source: 'host', budget: null };
  const { entry } = hit;
  if (entry.choose === BY_PLAN_TIER) {
    const rung = clamp(entry.unassessed ?? UNASSESSED, entry);
    return { ...fromRung(ladder, rung, host, entry.effort), source: `${hit.source}, unassessed: ${rung}`, budget: budgetOf(hit, rung, used) };
  }
  if (typeof entry.preset === 'string') {
    const preset = presetOf(frozen, entry.preset) ?? {};
    return {
      model: modelOf(preset[host]),
      effort: valueOf(entry.effort ?? preset.effort),
      source: `${hit.source}, preset ${entry.preset}`,
      budget: null,
    };
  }
  if (typeof entry.tier === 'string') {
    if (entry.tier === INHERIT) return { model: OMIT, effort: valueOf(entry.effort), source: hit.source, budget: null };
    return { ...fromRung(ladder, entry.tier, host, entry.effort), source: `${hit.source}, tier ${entry.tier}`, budget: null };
  }
  return { model: modelOf(entry.model), effort: valueOf(entry.effort), source: hit.source, budget: null };
}

/** An agent name as a lookup reads it: without a plugin prefix. */
export function bareAgent(agent) {
  const text = String(agent).trim();
  const at = text.lastIndexOf(':');
  return at < 0 ? text : text.slice(at + 1);
}

/** The built-in agent type a name spells, whatever its case, or null. */
function builtInOf(name) {
  const lower = String(name).toLowerCase();
  return BUILT_IN_AGENTS.find(each => each.toLowerCase() === lower) ?? null;
}

/** An agent's entry in a map: by its exact name, or for a built-in by any spelling of it. */
function findAgent(agents, name) {
  if (!isMap(agents)) return null;
  if (Object.hasOwn(agents, name) && isMap(agents[name])) return { key: name, entry: agents[name] };
  const builtIn = builtInOf(name);
  if (builtIn === null) return null;
  const key = Object.keys(agents).find(each => builtInOf(each) === builtIn && isMap(agents[each]));
  return key === undefined ? null : { key, entry: agents[key] };
}

function isPin(entry) {
  return typeof entry.model === 'string' && entry.model !== INHERIT;
}

/** The ladder in effect: the shipped cells with the project's laid over them, cell by cell. */
function ladderOf(frozen) {
  const own = isMap(frozen.tiers) ? frozen.tiers : {};
  return Object.fromEntries(LADDER.map(rung => [rung, { ...SHIPPED.tiers[rung], ...(isMap(own[rung]) ? own[rung] : {}) }]));
}

function fromRung(ladder, rung, host, effort) {
  const cell = ladder[rung] ?? {};
  return { model: modelOf(cell[host]), effort: valueOf(effort ?? cell.effort) };
}

/** A preset by name, from the highest layer that defines it. */
function presetOf(frozen, name) {
  for (const layer of [frozen.profile, frozen.overlay, frozen]) {
    if (isMap(layer) && isMap(layer.presets) && isMap(layer.presets[name])) return layer.presets[name];
  }
  return null;
}

/**
 * The rung a plan tier comes to under a policy: the cheapest allowed rung at
 * or above it, never above the ceiling; when none is, the highest allowed rung
 * under the ceiling.
 */
function clamp(tier, policy) {
  const rank = rung => LADDER.indexOf(rung);
  const ceiling = LADDER.includes(policy.ceiling) ? policy.ceiling : LADDER.at(-1);
  const allowed = (Array.isArray(policy.allowed) ? policy.allowed : LADDER)
    .filter(rung => LADDER.includes(rung) && rank(rung) <= rank(ceiling))
    .sort((a, b) => rank(a) - rank(b));
  if (!allowed.length) return rank(tier) <= rank(ceiling) ? tier : ceiling;
  return allowed.find(rung => rank(rung) >= rank(tier)) ?? allowed.at(-1);
}

function budgetOf(policy, rung, used) {
  const limit = policy && isMap(policy.entry.budget) ? policy.entry.budget[rung] : undefined;
  if (!Number.isInteger(limit) || used === null) return null;
  return { tier: rung, limit, used: used[rung] ?? 0 };
}

function modelOf(value) {
  return typeof value === 'string' && value !== '' && value !== INHERIT ? value : OMIT;
}

function valueOf(value) {
  return typeof value === 'string' && value !== '' ? value : OMIT;
}

/**
 * How many task groups already ran on each rung in a run, read from its work
 * log: one `**Model**: <model> (tier <rung>, …)` line per group, the record the
 * executor writes in each group's entry. `{light, standard, deep}`, each zero
 * when the log is absent.
 */
export function rungsUsed(runDir) {
  const used = Object.fromEntries(LADDER.map(rung => [rung, 0]));
  let text = '';
  try {
    text = fs.readFileSync(path.join(runDir, 'implementation', 'work-log.md'), 'utf8');
  } catch {
    return used;
  }
  for (const match of text.matchAll(/^[ \t]*(?:[-*][ \t]+)?\*\*Model\*\*:[^\n(]*\(tier (light|standard|deep)\b/gm)) used[match[1]] += 1;
  return used;
}

/** The host the engine ships for: its plugin's own name says which. */
export function shippedHost() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot(), '.claude-plugin', 'plugin.json'), 'utf8'));
    return manifest?.name === 'maister-copilot' ? 'copilot' : 'claude';
  } catch {
    return 'claude';
  }
}

// ---------------------------------------------------------------------------
// small predicates
// ---------------------------------------------------------------------------

/** A model a Claude Code call takes: one of its aliases, or `inherit`. */
function isClaudeModel(value) {
  return value === INHERIT || CLAUDE_ALIASES.includes(value);
}

function claudeRefusal(value) {
  return `${describe(value)} is not a model a Claude Code call takes: write one of ${CLAUDE_ALIASES.join(', ')} or ${INHERIT}, since a full model id is refused before the agent launches`;
}

function isModel(value) {
  return typeof value === 'string' && MODEL.test(value);
}

function isMap(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value) {
  if (value === null || value === undefined) return 'nothing';
  return Array.isArray(value) ? `[${value.join(', ')}]` : JSON.stringify(value);
}
