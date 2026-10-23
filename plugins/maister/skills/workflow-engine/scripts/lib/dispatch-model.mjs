/**
 * `dispatch-model`: the model and effort to pass on an agent call, printed so
 * the orchestrator copies a value instead of working one out.
 *
 * Why this module exists. The precedence order of the `subagents` block —
 * plan tier, profile, overlay, the project's workflow, node and agent scopes,
 * then the shipped defaults and the host — is the engine's (`subagents.mjs`).
 * A fan-out runs this verb just before it dispatches and copies each line's
 * values into its calls, next to the agent type, so the value is in context at
 * the moment of the call and survives a compaction.
 *
 * Two modes. With `--state`, the run's frozen block is read, with its workflow
 * and the node named by `--node` as the scope, and the groups its work log
 * records per rung as the budget's count; a `config.yml` that has changed
 * since the freeze adds one note, and the run keeps what it froze. Without
 * `--state` — a skill run outside any run — the project's `config.yml` is read
 * and judged as a freeze would, its findings returned as warnings, and the
 * workflow and node scopes do not apply.
 *
 * The text, one line per agent, in the order asked:
 *
 *     <agent>: model <model|omit>, effort <effort|omit> — source: <level>
 *
 * `omit` means the call carries no such field and the host's own order
 * applies. Notes follow after one blank line, each opening `note:`.
 *
 * Refusals, each with a recovery row in the engine skill:
 * - `dispatch-model-state-unreadable` — `--state` cannot be read or parsed.
 * - `dispatch-model-not-a-run` — the file carries no `workflow:` block.
 * - `dispatch-model-unknown-node` — `--node` is not a node of the run's frozen graph.
 *
 * Reads only. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse, isPlainObject } from './state-read.mjs';
import { projectRoot } from './graph.mjs';
import { projectRootOf } from './state.mjs';
import { currentProjectBlock, frozenSubagents, projectPart, resolveAgent, rungsUsed, sameBlock } from './subagents.mjs';

const CHANGED = "note: .maister/config.yml's subagents block changed since this run started; this run keeps the settings it froze, and the edits apply to the next run";

/**
 * Resolve each of `agents` for `host`. Returns `{ok, text, errors, warnings}`;
 * `text` ends with a newline.
 */
export function dispatchModel({ state = null, agents, node = null, tier = null, host }) {
  let block = null;
  let workflow = null;
  let used = null;
  const notes = [];
  const warnings = [];

  if (state !== null) {
    let doc;
    try {
      doc = parse(fs.readFileSync(state, 'utf8'));
    } catch (err) {
      return refuse('dispatch-model-state-unreadable',
        `${state} cannot be read as a state document (${err.message}). Point --state at the run's orchestrator-state.yml; nothing was read further.`);
    }
    if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
      return refuse('dispatch-model-not-a-run',
        `${state} carries no workflow block, so the engine never froze it. Run the verb on a frozen run's state, or without --state outside a run.`);
    }
    const nodes = isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
    if (node !== null && !Object.hasOwn(nodes, node)) {
      return refuse('dispatch-model-unknown-node',
        `${node} is not a node of this run. Name the node that dispatches, exactly as workflow.nodes spells it; no state write fixes this.`);
    }
    const options = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.options) ? doc.orchestrator.options : {};
    block = isPlainObject(options.subagents) ? options.subagents : null;
    workflow = typeof doc.workflow.name === 'string' ? doc.workflow.name : null;
    const runDir = path.dirname(path.resolve(state));
    used = rungsUsed(runDir);
    if (!sameBlock(currentProjectBlock(projectRootOf(runDir)), projectPart(block))) notes.push(CHANGED);
  } else {
    const frozen = frozenSubagents({ project: projectRoot() });
    block = frozen.block;
    warnings.push(...frozen.warnings);
  }

  const lines = [];
  const ignored = [];
  for (const agent of agents) {
    const answer = resolveAgent(agent, { block, workflow, node, tier, host, used });
    lines.push(`${agent}: model ${answer.model}, effort ${answer.effort} — source: ${answer.source}`);
    if (answer.budget) notes.push(budgetNote(agent, answer.budget));
    if (answer.tierIgnored) ignored.push(agent);
  }
  if (ignored.length) {
    notes.push(`note: --tier=${tier} was ignored for ${ignored.join(', ')}: a plan tier applies only to an agent whose entry is choose: by-plan-tier, so ${ignored.length === 1 ? 'it resolves' : 'they resolve'} as without one`);
  }
  const text = [...lines, ...(notes.length ? ['', ...new Set(notes)] : [])].map(line => `${line}\n`).join('');
  return { ok: true, text, errors: [], warnings };
}

function budgetNote(agent, { tier, limit, used }) {
  const counted = `note: ${agent} budget: ${used} of ${limit} groups on ${tier} used in this run`;
  return used >= limit ? `${counted} — ask before dispatching another group on ${tier}` : counted;
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

