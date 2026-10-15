/**
 * Where a `workflow:` node's child run lives: the one answer every driver takes.
 *
 * A sub-run's task directory is derived, never chosen (sub-runs reference,
 * *The child directory name*): a parent re-driven after a crash must compute
 * the same name and adopt the child it already started, and a child written
 * anywhere else is a run nobody reads. A rule every driver re-derives from
 * prose is a rule that comes out two ways, so it is computed here, once, and
 * the prose names this verb instead of the arithmetic.
 *
 * Given the parent's state and the node, it prints the child's task directory,
 * relative to the project root, and its run id:
 *
 * - when the parent node already records `values.task_path` (W3 has landed),
 *   that path and its `run_id`, as recorded — nothing else is read;
 * - otherwise the directory the rule gives, after the three checks that refuse
 *   a sub-run before anything is created (`checkSubrunStart`), and what the
 *   directory holds now: `absent`, `empty`, or `adopt` — a child whose parent
 *   link names this run and this node. A child naming another run or node is
 *   refused `subrun-child-foreign`.
 *
 * It reads and never writes. Recording the path on the parent stays with W3,
 * the parent's own `write-state`: the child freezes first (W2), and the
 * adoption after a crash between the two depends on that order. A verb that
 * wrote the parent would be a second writer beside the one the engine keeps.
 *
 * Refusals, as `{ok: false, code, message}`: `subrun-path-state-unreadable`,
 * `subrun-path-not-a-run`, `subrun-path-unknown-node`,
 * `subrun-path-definition-unread`, `subrun-path-not-a-subrun`, and the
 * sub-run codes `subrun-on-dir-node`, `subrun-recursion`,
 * `subrun-target-unresolved` and `subrun-child-foreign`. A definition that has
 * drifted since the freeze is a warning, `subrun-path-graph-drift`.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { checkSubrunStart } from './graph.mjs';
import { reread } from './gate-brief.mjs';
import { projectRootOf } from './state.mjs';
import { HELD_APPROVAL } from './question-triage.mjs';

/** The longest child directory name; past it the slug is shortened, never the date or the node. */
const MAX_NAME = 100;

/** A task directory's date prefix and the rest of its name. */
const DATED = /^(\d{4}-\d{2}-\d{2})(?:-(.*))?$/;

/**
 * Judge the parent whose state file is `state` and its node `node`.
 *
 * Returns `{ok: true, node, workflow, task_path, run_id, recorded, existing}`
 * — `existing` is null when the path is the recorded one — plus `warnings`
 * for the caller to print outside the JSON, or `{ok: false, code, message}`.
 */
export function subrunPath({ state, node }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('subrun-path-state-unreadable',
      `${state} cannot be read as a state document (${err.message}). Point --state at the parent run's orchestrator-state.yml.`);
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
    return refuse('subrun-path-not-a-run',
      `${state} carries no workflow block, so the engine never froze it. Run the verb on the parent run's frozen state.`);
  }
  const workflow = doc.workflow;
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  if (node === HELD_APPROVAL || !Object.hasOwn(recorded, node)) {
    return refuse('subrun-path-unknown-node',
      `${node} is not a node of this run. Name the workflow: node, exactly as workflow.nodes spells it.`);
  }

  const values = isPlainObject(recorded[node]) && isPlainObject(recorded[node].values) ? recorded[node].values : {};
  if (typeof values.task_path === 'string' && values.task_path !== '') {
    const runId = typeof values.run_id === 'string' && values.run_id !== '' ? values.run_id : basename(values.task_path);
    return { ok: true, node, workflow: null, task_path: values.task_path, run_id: runId, recorded: true, existing: null, warnings: [] };
  }

  const runDir = path.dirname(path.resolve(state));
  const root = projectRootOf(runDir);
  const warnings = [];
  const current = reread(doc, workflow, runDir);
  if (current.graph === null) {
    return refuse('subrun-path-definition-unread',
      `the definition this run froze cannot be re-read, so the workflow ${node} starts is unknown. Restore the definition the state's workflow.source names, then run the verb again.`);
  }
  if (current.drift) warnings.push(`subrun-path-graph-drift: the definition now resolves to ${current.digest}, not the graph this run froze; the folder follows the definition as it reads now`);
  const declared = current.graph.nodes.find(entry => entry.id === node) ?? null;
  const uses = typeof declared?.uses === 'string' ? declared.uses : '';
  if (!uses.startsWith('workflow:')) {
    return refuse('subrun-path-not-a-subrun', `${node} runs ${uses || 'no target'}, not a workflow: node, so it starts no child run.`);
  }
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  const refused = checkSubrunStart({ node: declared, parent: orchestrator.parent ?? null, project: root });
  if (refused !== null) return refuse(refused.code, refused.message);

  const name = uses.slice('workflow:'.length).replace(/^builtin:/, '');
  const parentRun = relative(root, runDir);
  const taskPath = `.maister/tasks/${taskTypeOf(name)}/${childName(basename(parentRun), node)}`;
  const existing = existingAt(path.join(root, ...taskPath.split('/')), parentRun, node);
  if (existing.foreign) {
    return refuse('subrun-child-foreign',
      `${taskPath} holds a run whose parent link names ${existing.foreign}, not ${parentRun} node ${node}. Nothing is overwritten: move that run away, or settle with its owner, before this node starts its child.`);
  }
  return { ok: true, node, workflow: name, task_path: taskPath, run_id: basename(taskPath), recorded: false, existing: existing.state, warnings };
}

/** A workflow's task type folder: its name, but for migration's `migrations`. */
export function taskTypeOf(name) {
  return name === 'migration' ? 'migrations' : name;
}

/**
 * The child directory's name, from the parent directory's name and the node id:
 * `<parent-date>-<parent-slug>-<node>`. The date is the parent's prefix, else
 * today's UTC date; only the slug is normalised and, past the length limit,
 * shortened at its last hyphen that fits. The node id is appended as written.
 */
export function childName(parentName, node, today = new Date().toISOString().slice(0, 10)) {
  const dated = DATED.exec(parentName);
  const date = dated ? dated[1] : today;
  const rest = dated ? dated[2] ?? '' : parentName;
  let slug = rest.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const room = MAX_NAME - date.length - node.length - 2;
  if (slug.length > room) {
    const cut = slug.slice(0, Math.max(room, 0));
    const boundary = slug.charAt(room) === '-' ? cut.length : cut.lastIndexOf('-');
    slug = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '');
  }
  return slug === '' ? `${date}-${node}` : `${date}-${slug}-${node}`;
}

/** What the derived directory holds: the adoption table of the sub-runs reference. */
function existingAt(dir, parentRun, node) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, 'orchestrator-state.yml'), 'utf8');
  } catch {
    return { state: fs.existsSync(dir) ? 'empty' : 'absent' };
  }
  let link;
  try {
    link = parse(text).orchestrator?.parent;
  } catch {
    link = undefined;
  }
  const run = isPlainObject(link) && typeof link.run === 'string' ? spelled(link.run) : null;
  if (run === spelled(parentRun) && isPlainObject(link) && link.node === node) return { state: 'adopt' };
  return { foreign: run === null ? 'no parent' : `${run} node ${link.node}` };
}

function relative(root, dir) {
  return path.relative(root, dir).split(path.sep).join('/');
}

function spelled(value) {
  return value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

function basename(value) {
  return spelled(value).split('/').pop();
}

function refuse(code, message) {
  return { ok: false, code, message };
}
