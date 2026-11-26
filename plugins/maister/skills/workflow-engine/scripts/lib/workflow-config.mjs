/**
 * The `workflows:` block of a project's `.maister/config.yml`: per workflow,
 * which HTML pages its steps write and which of its gates the run continues
 * without asking.
 *
 *   workflows:
 *     development:
 *       html_companions:
 *         planning: []                     # no HTML page for the plan
 *       explainers:
 *         spec-audit: false                # no explainer page for the spec
 *       auto_continue: [planning-approval] # take the gate's continue
 *
 * `html_companions` has the shape and meaning of a definition's block: a
 * step's list replaces the one the definition, its overlays and the profile
 * left, and an empty list means no page. It is the last layer.
 *
 * `explainers` maps a step that declares an explainer page (an artifact whose
 * path ends in `-explainer.html`, `companions.mjs`) to true or false; false
 * turns that page off, and the step records it absent with the config's
 * reason. Keyed by step rather than one switch per workflow, because a
 * workflow may write two explainers for two different moments.
 *
 * `auto_continue` lists gates whose one plain continue the run takes without
 * asking, recorded `by: config`. Only a gate with exactly one continue, which
 * sets no value and grants nothing, may be listed: the project's config never
 * grants a permission and never picks between continues.
 *
 * Nothing here is graph data. The block is judged against the folded graph —
 * the definition with every overlay and the profile applied — when a run is
 * frozen, and what survives is recorded in `orchestrator.options.workflow_config`
 * (`state.mjs`), so an edit of the file reaches the next run, never this one.
 * `validate` judges the same block for `--check`. A bad entry is one warning,
 * carrying the file and the dotted key, and is dropped; the rest stands.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDefinition } from './definition.mjs';
import { foldDefinition, locateWorkflow, plainContinueOf } from './graph.mjs';
import { EXPLAINER_SUFFIX, explainerOf, isCompanionList } from './companions.mjs';

/** Where a project's config lives, relative to its root. */
const CONFIG = path.join('.maister', 'config.yml');

/** The keys one workflow's entry takes. */
export const WORKFLOW_CONFIG_KEYS = ['html_companions', 'explainers', 'auto_continue'];

/**
 * The `workflows` block of a project's `config.yml`: `{file, block, errors}`,
 * `block` null when the file or the key is absent. Only the top-level
 * `workflows:` entry is cut out and read, so the rest of the file can never
 * refuse it — and the `workflows:` nested under `subagents:` is never taken
 * for it. A block the reader refuses is one error.
 */
export function readWorkflowsBlock(root) {
  const file = path.join(root, CONFIG);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, block: null, errors: [] };
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => /^workflows\s*:/.test(line));
  if (start < 0) return { file, block: null, errors: [] };
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]) || lines[end].startsWith('#'))) end++;
  const parsed = parseDefinition(lines.slice(start, end).join('\n'), file);
  if (parsed.doc === null) {
    const error = parsed.errors[0];
    return { file, block: null, errors: [{ file, path: error?.path || 'workflows', message: error?.message ?? 'cannot be read' }] };
  }
  const block = parsed.doc.workflows;
  return { file, block: block === null || block === undefined ? null : block, errors: [] };
}

/**
 * One workflow's entry judged against its folded document: `{config,
 * warnings}`, `config` the `{html_companions?, auto_continue?}` that survives —
 * null when nothing does — and one warning per entry dropped.
 */
export function judgeWorkflowConfig({ entry, name, folded, file, project }) {
  const warnings = [];
  const at = `workflows.${name}`;
  const warn = (where, message) => warnings.push(`workflows-config:${shownFile(file, project)}:${where} — ${message}`);
  if (entry === null || entry === undefined) return { config: null, warnings };
  if (!isMap(entry)) {
    warn(at, `a mapping of ${WORKFLOW_CONFIG_KEYS.join(' and ')} is expected, not ${describe(entry)}; it is ignored`);
    return { config: null, warnings };
  }
  for (const key of Object.keys(entry)) {
    if (!WORKFLOW_CONFIG_KEYS.includes(key)) warn(`${at}.${key}`, `not a key here, so it is ignored; the accepted keys are ${WORKFLOW_CONFIG_KEYS.join(', ')}`);
  }
  const nodes = isMap(folded?.nodes) ? folded.nodes : {};
  const config = {};

  if (Object.hasOwn(entry, 'html_companions')) {
    const block = entry.html_companions;
    if (!isMap(block)) {
      warn(`${at}.html_companions`, `a mapping of step id to a list of its artifact keys is expected, not ${describe(block)}; it is ignored`);
    } else {
      const kept = {};
      for (const [id, keys] of Object.entries(block)) {
        const where = `${at}.html_companions.${id}`;
        if (!isCompanionList(keys)) {
          warn(where, `a list of the step's artifact keys, none twice, is expected, not ${describe(keys)}; the entry is ignored`);
          continue;
        }
        if (!isMap(nodes[id])) {
          warn(where, `${name} has no step ${id}; the entry is ignored`);
          continue;
        }
        if (nodes[id].type === 'gate') {
          warn(where, `${id} is a gate, which writes no page; the entry is ignored`);
          continue;
        }
        const declared = isMap(nodes[id].outputs) && isMap(nodes[id].outputs.artifacts) ? nodes[id].outputs.artifacts : {};
        const listed = [];
        keys.forEach((key, index) => {
          if (Object.hasOwn(declared, key)) listed.push(key);
          else warn(`${where}.${index}`, `${id} declares no artifact ${key}; it is ignored`);
        });
        // A list whose every key was unknown would turn the step's pages off
        // by accident: only a list written empty means no page.
        if (keys.length === 0 || listed.length) kept[id] = listed;
      }
      if (Object.keys(kept).length) config.html_companions = kept;
    }
  }

  if (Object.hasOwn(entry, 'explainers')) {
    const block = entry.explainers;
    if (!isMap(block)) {
      warn(`${at}.explainers`, `a mapping of step id to true or false is expected, not ${describe(block)}; it is ignored, and every explainer is written`);
    } else {
      const kept = {};
      for (const [id, value] of Object.entries(block)) {
        const where = `${at}.explainers.${id}`;
        if (typeof value !== 'boolean') {
          warn(where, `true or false is expected, not ${describe(value)}; the entry is ignored`);
          continue;
        }
        if (!isMap(nodes[id])) {
          warn(where, `${name} has no step ${id}; the entry is ignored`);
          continue;
        }
        if (nodes[id].type === 'gate') {
          warn(where, `${id} is a gate, which writes no page; the entry is ignored`);
          continue;
        }
        if (explainerOf(nodes[id]) === null) {
          warn(where, `${id} declares no explainer page (an artifact ending in ${EXPLAINER_SUFFIX}); the entry is ignored`);
          continue;
        }
        kept[id] = value;
      }
      if (Object.keys(kept).length) config.explainers = kept;
    }
  }

  if (Object.hasOwn(entry, 'auto_continue')) {
    const list = entry.auto_continue;
    if (!Array.isArray(list)) {
      warn(`${at}.auto_continue`, `a list of gate ids is expected, not ${describe(list)}; it is ignored, and every gate is asked`);
    } else {
      const kept = [];
      list.forEach((id, index) => {
        const where = `${at}.auto_continue.${index}`;
        if (typeof id !== 'string' || id.trim() === '') {
          warn(where, `a gate id is expected, not ${describe(id)}; the entry is ignored`);
          return;
        }
        const node = nodes[id];
        if (!isMap(node)) {
          warn(where, `${name} has no gate ${id}; the entry is ignored`);
          return;
        }
        if (node.type !== 'gate') {
          warn(where, `${id} is a step, not a gate; only a gate may be listed, so the entry is ignored`);
          return;
        }
        const granting = grantsOf(node);
        if (granting.length) {
          warn(where, `${id}'s continue grants ${granting.join(', ')}; the project's config never grants a permission, so the gate is asked as usual`);
          return;
        }
        if (plainContinueOf(node) === null) {
          warn(where, `${id} has more than one continue, or a continue that sets a value; only a gate with one plain continue may be listed, so the gate is asked as usual`);
          return;
        }
        if (kept.includes(id)) {
          warn(where, `${id} is listed twice; the repeat is ignored`);
          return;
        }
        kept.push(id);
      });
      if (kept.length) config.auto_continue = kept;
    }
  }
  return { config: Object.keys(config).length ? config : null, warnings };
}

/**
 * The entry a freeze records for the workflow `name`: `{config, warnings}`,
 * judged against the definition folded with the run's overlays and profile.
 * A block the reader refuses is one warning and records nothing.
 */
export function frozenWorkflowConfig({ project, name, definition, overlays = [], profile = null }) {
  const read = readWorkflowsBlock(project);
  if (read.errors.length) return { config: null, warnings: read.errors.map(error => readFailure(error, project)) };
  if (read.block === null || typeof name !== 'string') return { config: null, warnings: [] };
  if (!isMap(read.block)) return { config: null, warnings: [notAMap(read, project)] };
  if (!Object.hasOwn(read.block, name)) return { config: null, warnings: [] };
  const folded = foldDefinition({ definition, overlays, profile });
  return judgeWorkflowConfig({ entry: read.block[name], name, folded, file: read.file, project });
}

/**
 * The warnings `validate` adds for the workflow `name`: its own entry judged
 * as a freeze would judge it, and every other entry that names no workflow
 * the project can run.
 */
export function workflowsWarnings({ project, name, definition, overlays = [], profile = null }) {
  const read = readWorkflowsBlock(project);
  if (read.errors.length) return read.errors.map(error => readFailure(error, project));
  if (read.block === null) return [];
  if (!isMap(read.block)) return [notAMap(read, project)];
  const warnings = [];
  for (const other of Object.keys(read.block)) {
    if (other === name || locateWorkflow(other, project) !== null) continue;
    warnings.push(`workflows-config:${shownFile(read.file, project)}:workflows.${other} — no workflow named ${other}; the entry is ignored`);
  }
  if (typeof name === 'string' && Object.hasOwn(read.block, name)) {
    const folded = foldDefinition({ definition, overlays, profile });
    warnings.push(...judgeWorkflowConfig({ entry: read.block[name], name, folded, file: read.file, project }).warnings);
  }
  return warnings;
}

/** The gate ids a recorded entry continues without asking: always a list. */
export function autoContinued(config) {
  return isMap(config) && Array.isArray(config.auto_continue) ? config.auto_continue.filter(id => typeof id === 'string') : [];
}

/**
 * The line a gate continued by the project's config prints in the session and
 * keeps as its headline: "Implementation plan approved by the project's
 * config" for a title reading "Approve implementation plan", else the title
 * quoted, continued.
 */
export function configContinueLine(title) {
  const text = typeof title === 'string' ? title.trim() : '';
  const match = /^approve\s+(.+)$/i.exec(text);
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1)} approved by the project's config`;
  return `"${text}" continued by the project's config`;
}

function grantsOf(node) {
  const options = isMap(node.options) ? Object.values(node.options) : [];
  const names = new Set();
  for (const option of options) {
    if (isMap(option) && option.effect === 'continue' && Array.isArray(option.grants)) option.grants.forEach(grant => names.add(String(grant)));
  }
  return [...names];
}

function readFailure(error, project) {
  return `workflows-config:${shownFile(error.file, project)}:${error.path} — ${error.message}; the whole workflows block is ignored`;
}

function notAMap(read, project) {
  return `workflows-config:${shownFile(read.file, project)}:workflows — a mapping of workflow name to its settings is expected, not ${describe(read.block)}; it is ignored`;
}

/** A file as a finding names it: relative to the project root when it lies inside it, `/`-separated. */
function shownFile(file, project) {
  const relative = path.relative(path.resolve(project), path.resolve(file));
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return (inside ? relative : String(file)).split(path.sep).join('/');
}

function describe(value) {
  if (value === null || value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return JSON.stringify(value);
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
