/**
 * The run-scoped context block, rendered from state for a delegate prompt.
 *
 * Why this module exists at all. Every delegate an engine run dispatches needs
 * the same handful of run facts: where the task directory is, whether it owes
 * HTML companions and which guide writes them, the project documentation to
 * read, how to make a scratch copy, what a markdown artifact opens with, and
 * which pages this node owes. Left to the orchestrating model, each of those is
 * a sentence it must remember to compose into every prompt, and the one that
 * is forgotten is never noticed — the delegate does its work without it. So the
 * facts are fetched, the way `prior-context` fetches the prior phases'
 * decisions: the node runs this verb and pastes what it prints.
 *
 * It is a module of its own, not a second mode of `prior-context`: that one
 * renders summaries and refuses on their shape; this one renders run facts and
 * refuses on the node. `prior-context --node` prints this block first and then
 * its own, so an artifact writer still makes one call.
 *
 * What it does not do. It does not write — no state, no dashboard, no display
 * panel. It reads the state file and the definition the run froze, renders,
 * and returns `{ok, text, errors, warnings}`.
 *
 * Refusals, each with a recovery row in the engine skill:
 * - `run-context-state-unreadable` — `--state` cannot be read or parsed.
 * - `run-context-not-a-run` — the file carries no `workflow:` block, so the
 *   engine never froze it.
 * - `run-context-unknown-node` — `--node` is not a node of the run's frozen
 *   graph; `held-approval`, which delegates nothing, is refused too.
 *
 * One warning, never a refusal: `run-context-definition-unread`, when HTML
 * output is on and the definition the run froze cannot be re-read, so which
 * companions the node owes cannot be said.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, isPlainObject } from './state-read.mjs';
// The writer decides what a context block is, whether HTML output is on, where
// the project root is and what the run owes; this module asks it rather than
// keeping a second answer that could drift from the checks that hold a node to
// the same companions.
import { companionsOfRun, htmlOutput, isContextBlock, projectRootOf } from './state.mjs';
import { owedCompanions } from './companions.mjs';
import { HELD_APPROVAL } from './question-triage.mjs';

/**
 * The two plugin files the block names, built from this module's own location
 * as the dashboard viewer's source is: the variant a build generates resolves
 * its own copy, and a delegate is pointed at the files of the plugin it runs.
 */
const REFERENCES = new URL('../../../orchestrator-framework/references/', import.meta.url);
const STYLE_GUIDE = fileURLToPath(new URL('html-report-style.md', REFERENCES));
const PATTERNS = fileURLToPath(new URL('orchestrator-patterns.md', REFERENCES));

/** Where a project's standards index lives, relative to its root; listed when it exists. */
const STANDARDS_INDEX = path.join('.maister', 'docs', 'INDEX.md');

/** The scheme of a node that starts a sub-run, whose files land in the child's task directory. */
const WORKFLOW_SCHEME = 'workflow:';

const SCRATCH = 'scratch: make any throwaway copy with mktemp -d under the system temp directory and leave it there — no cleanup step, no rm -rf';

const CONTRACT = 'summary contract: open every markdown artifact you write with ## TL;DR (at most 5 lines, conclusions in plain words), '
  + '## Key Decisions (- decision — rationale) and ## Open Questions / Risks (- risk → what would change), omitting an empty section; '
  + `the full contract is § 7 of ${PATTERNS}`;

const UNKNOWN = 'companions: unknown — the definition this run froze cannot be re-read';

/**
 * Render the run context of `node` in the run whose state file is `state`.
 *
 * Returns `{ok, text, errors, warnings}`; `text` is the block, every line ended
 * by a newline and no blank line after the last.
 */
export function runContext({ state, node }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('run-context-state-unreadable',
      `${state} cannot be read as a state document (${err.message}). Point --state at the run's orchestrator-state.yml; nothing was read further.`);
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
    return refuse('run-context-not-a-run',
      `${state} carries no workflow block, so the engine never froze it. Run the verb on a frozen run's state.`);
  }
  const nodes = isPlainObject(doc.workflow.nodes) ? doc.workflow.nodes : {};
  if (node === HELD_APPROVAL || !Object.hasOwn(nodes, node)) {
    return refuse('run-context-unknown-node',
      `${node} is not a node of this run${node === HELD_APPROVAL ? ' that delegates anything' : ''}. Name a node of this run; no state write fixes this.`);
  }

  const runDir = path.dirname(path.resolve(state));
  const root = projectRootOf(runDir);
  const entry = isPlainObject(nodes[node]) ? nodes[node] : {};
  const warnings = [];

  let html = 'off';
  let companions = ['companions: none'];
  // A gate asks; it never delegates a file, so it owes nothing whatever a block says.
  if (htmlOutput(doc) && entry.kind !== 'gate') {
    const owing = companionsOfRun(doc, runDir);
    if (owing === null) {
      html = STYLE_GUIDE;
      companions = [UNKNOWN];
      warnings.push(`run-context-definition-unread: ${state}`);
    } else {
      const lines = owedLines(owing, node, entry);
      if (lines.length) {
        html = STYLE_GUIDE;
        companions = ['companions:', ...lines];
      }
    }
  }

  const docs = docsOf(doc, root);
  const text = [
    '## Run context',
    '',
    `task_path: ${taskPathOf(doc, runDir, root)}`,
    `html: ${html}`,
    ...(docs.length ? ['docs:', ...docs.map(file => `- ${file}`)] : ['docs: none']),
    SCRATCH,
    CONTRACT,
    ...companions,
  ];
  return { ok: true, text: `${text.join('\n')}\n`, errors: [], warnings };
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

/**
 * The task directory as an absolute path: `orchestrator.task_path` when the run
 * recorded one, taken against the project root as every other recorded path is,
 * and otherwise the directory the state file is in.
 */
function taskPathOf(doc, runDir, root) {
  const recorded = isPlainObject(doc.orchestrator) ? doc.orchestrator.task_path : undefined;
  return typeof recorded === 'string' && recorded !== '' ? path.resolve(root, recorded) : runDir;
}

/**
 * The project documentation a delegate reads, absolute and listed once: the
 * shared `project_context` paths, then each context block's in key order, then
 * the standards index when the project has one. A value that is not a list, or
 * an item that is not a string, was not written by the writer and is skipped.
 */
function docsOf(doc, root) {
  const lists = [isPlainObject(doc.project_context) ? doc.project_context.project_doc_paths : undefined];
  for (const key of Object.keys(doc)) {
    if (isContextBlock(key) && isPlainObject(doc[key])) lists.push(doc[key].project_doc_paths);
  }
  // A Set keeps the first place a path was listed, which is the order printed.
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (typeof item === 'string' && item.trim() !== '') seen.add(path.resolve(root, item));
  }
  const index = path.join(root, STANDARDS_INDEX);
  if (fs.existsSync(index)) seen.add(index);
  return [...seen];
}

/**
 * The owed companions as list lines, in declaration order. A sub-run's pages
 * are written in its child's task directory, so once the node recorded where
 * that is the line names it the way `missing-artifact:` does — project-root
 * relative — and before that it says where the path is taken from.
 */
function owedLines(owing, node, entry) {
  const owed = owedCompanions(owing, node);
  if (!owed.length) return [];
  const declared = isPlainObject(owing.definition?.nodes) && isPlainObject(owing.definition.nodes[node])
    ? owing.definition.nodes[node]
    : {};
  if (typeof declared.uses !== 'string' || !declared.uses.startsWith(WORKFLOW_SCHEME)) {
    return owed.map(({ html }) => `- ${html}`);
  }
  const taskPath = isPlainObject(entry.values) ? entry.values.task_path : undefined;
  if (typeof taskPath === 'string' && taskPath !== '') {
    return owed.map(({ html }) => `- ${path.posix.join(taskPath, html)}`);
  }
  return owed.map(({ html }) => `- ${html} (in the sub-run's task directory)`);
}
