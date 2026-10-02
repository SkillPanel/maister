/**
 * Whether a task directory is a run this engine resumes, and what it froze.
 *
 * A resume arrives by three routes — the work command, the run command and a
 * workflow's own command, each given a directory — and every one of them has to
 * answer the same question before anything runs: was this directory written by
 * the engine? A directory whose state carries a `workflow:` block holds a
 * frozen graph and resumes from it. One without the block was written by a 2.x
 * prose orchestrator: there is no graph to resume and no second interpreter to
 * hand it to, so it is refused, with the one message that says where it can be
 * finished. The message lives here, once, so every route prints the same words.
 *
 * The refusal cannot name the version that wrote the directory: 2.x state never
 * recorded one, so the directory is told apart by its shape alone. Every
 * workflow runs on this engine, so the rule has no exception by workflow: a
 * directory under any type folder that carries no `workflow:` block is a 2.x
 * one. No message here spells a command's namespaced name: this file ships to
 * every host unchanged, and each host names the plugin's commands its own way.
 *
 * It reads the state file and never writes: not the state, not the dashboard,
 * not anything else in the directory. Zero dependencies, `node:` builtins only,
 * Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { dashboardUrl } from './state.mjs';
import { openRevision } from './revise.mjs';

/** What an operator reads when a 2.x directory is offered for resume. */
export const WRITTEN_BY_2X = [
  'This task was started on the maister 2.x plugin — its `orchestrator-state.yml` has no `workflow:` block — ',
  'and maister 3.0 does not resume it. Nothing in the directory was changed, and its artifacts are still ',
  'readable in place. To finish it, install the 2.x line and resume it there: ',
  '`/plugin marketplace add SkillPanel/maister#release/2.x`, then `/plugin install maister@maister-plugins-2x` ',
  '(uninstall any other maister channel first, for example `/plugin uninstall maister@maister-plugins`). ',
  'To start the work over on 3.0, run the command again without a task path.',
].join('');

/**
 * Judge the run whose state file is `state`.
 *
 * Returns `{ok: true, workflow: {name, overlays, profile}, title, status, task_path,
 * dashboard, revision?}` for a run the engine froze — `revision` only while a
 * gate's revise is open (`openRevision`) — `dashboard` the `file://` link a
 * resume shows the operator once, or null when the run has none — or
 * `{ok: false, code, message}` for one it does not resume.
 */
export function resumeCheck({ state }) {
  let raw;
  try {
    raw = fs.readFileSync(state, 'utf8');
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read: ${err.message}`);
  }

  let doc;
  try {
    doc = parse(raw);
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }

  const dir = path.dirname(path.resolve(state));
  const workflow = doc.workflow;
  if (!isPlainObject(workflow)) return refuse('written-by-2x', WRITTEN_BY_2X);

  if (typeof workflow.name !== 'string' || workflow.name === '') {
    return refuse('state-unreadable', `${state} carries a workflow block with no name, so there is no workflow to resume`);
  }
  const task = isPlainObject(doc.task) ? doc.task : {};
  const revision = openRevision(doc);
  return {
    ok: true,
    workflow: {
      name: workflow.name,
      overlays: Array.isArray(workflow.overlays) ? workflow.overlays.map(String) : [],
      profile: workflow.profile ?? null,
    },
    title: typeof task.title === 'string' ? task.title : null,
    status: typeof task.status === 'string' ? task.status : null,
    task_path: dir,
    dashboard: dashboardUrl(doc, dir),
    // Additive, and only while a gate's revise is open: a resume that finds it
    // not yet applied runs `gate-revise` before it walks the ready set.
    ...(revision ? { revision: { gate: revision.gate, option: revision.option, reruns: revision.reruns, revision: revision.revision, applied: revision.applied } } : {}),
  };
}

function refuse(code, message) {
  return { ok: false, code, message };
}
