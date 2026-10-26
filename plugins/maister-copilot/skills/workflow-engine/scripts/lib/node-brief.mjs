/**
 * The node brief: what a step reads before it runs, rendered from state.
 *
 * Why this module exists. A step's instructions were a whole guide section,
 * and most of each section restated what the engine already holds or what is
 * true of every step of its kind: how it is delegated, which files it writes
 * and which pages it owes, the question defaults under this run's driver, the
 * checkpoint it feeds, how many attempts it gets. Read whole, a guide is long;
 * read in part, the restated rule that was skipped is the one that mattered.
 * So the facts are printed, the way `run-context` prints a delegate's: a header
 * derived from the definition the run froze, its `brief:` block and the run's
 * state, the convention rows of the engine skill that apply to the node, and
 * then only the node's own section of its guide.
 *
 * What it leaves out. The header is read before every step, so a line that
 * would only say the default is not printed, and a convention row is printed
 * whole only while it applies:
 * - `when:` only for a guarded node; `attempt:` only past the first attempt or
 *   once the node has a status other than `pending`.
 * - `recommends:` only for an input that is set; unset, the section decides
 *   and a line saying so adds nothing.
 * - An owed HTML page beside its markdown is named by its file name, and a
 *   `companion writer:` line follows the pages: the html-companion-writer call
 *   with its model and effort, for a page the step's work leaves unwritten,
 *   and under it the lines that call's prompt carries — the style guide's
 *   absolute path once and each owed page's markdown by its absolute path. A
 *   writer dispatched without them went looking for its style guide on disk.
 * - The `direct:` row only when the step owes a page or has no section — run
 *   inline from the section is what `runs:` and the section already say.
 * - `every step` only when the step declares an artifact or a value.
 * - `named by a revise` whole only while a recorded revise names the step —
 *   the last answer at a gate is a revise option whose `reruns` is this node —
 *   and `has a budget` whole on the last budgeted attempt; before then both
 *   are named on one `convention (…): see rules` line, so the reader knows
 *   where they stand.
 * - `recommends:` only for an option among the continues of a gate on the
 *   step's `feeds:` lines; any other mapping prints nothing, as the validator
 *   warns of it (`brief-unknown-option`).
 * - Under a driver nobody can be asked through, the `asks` line names the
 *   question ids and points at the Without line of each: a question's default
 *   is stated there, once.
 * - An `ask with:` line under the `asks` line only for a run asked in session
 *   on Copilot, whose question tool takes a message and a form: it names the
 *   one command that builds the form, with the run's real paths, at the point
 *   of asking. A session that composed the form itself from memory dropped the
 *   descriptions and the recommendation the engine's form carries. Claude
 *   Code's picker is composed in the session, so its brief has no such line.
 * - A `direct:` step's `delegates:` line only when its `brief:` declares
 *   agents it dispatches, and then whole, each agent beside its model and
 *   effort: the step's own section is read as work to do inline, and the
 *   delegate's share of it is what a session skips without the line.
 * - The scheme row of `agent:`, `skill:` and `workflow:` steps, `asks`,
 *   `feeds a checkpoint` and `gate` print whole wherever they apply: each
 *   carries a hand-over or a recording rule a step skips silently without it.
 * An unread definition prints every row its scheme meets, whole.
 * Paths stay repository-root-relative rather than task-relative: a delegate
 * is handed them as printed, and its working directory is the project root —
 * all but an `output_path` agent, which joins a path to `task_path` itself and
 * so is handed the declared one (the `agent:` row says so).
 * The `with:` values and a `dir:` are printed filled in, by the rules of the
 * engine skill's *Interpolating*. A path the header names for a shell — the
 * `rules:` line, the `gate-brief` call — goes in single quotes when it holds
 * whitespace, as the engine's invocation contract writes one.
 *
 * What it reads. The state file; the definition the run froze, re-read and
 * re-resolved through `gate-brief`'s `reread`; its overlays and profile; the
 * guide beside the file a node comes from — the base definition's, or the
 * adding overlay's for a node an overlay added; and the `### Node conventions`
 * table of the `SKILL.md` beside this module, found from its own location so a
 * generated variant reads its own copy.
 *
 * What it writes. One thing: the start of a step it briefs (`recordStart`).
 * The brief is what every step is run from, so a step cannot be begun without
 * it, and the start it records is what the status line and the dashboard read
 * as the step under way. A `skill:` step hands the session to a skill whose own
 * instructions take over, and the start the prose asked for was the write runs
 * dropped. Nothing else — a refusal, a gate, a step not ready to run — writes
 * anything. It returns `{ok, text, errors, warnings}`.
 *
 * Refusals, each with a recovery row in the engine skill:
 * - `node-brief-state-unreadable` — `--state` cannot be read or parsed.
 * - `node-brief-not-a-run` — the file carries no `workflow:` block.
 * - `node-brief-unknown-node` — `--node` is not a node of the run's frozen
 *   graph; `held-approval`, which is never one, is refused too.
 *
 * Warnings, never refusals; the brief still prints:
 * - `node-brief-graph-drift` — the definition re-resolves to another graph
 *   than the one frozen; the header follows the re-resolved one, as
 *   `gate-brief` does.
 * - `node-brief-definition-unread` — the definition cannot be re-read; the
 *   header comes from the frozen node entry alone and the section is unknown.
 * - `node-brief-node-gone` — the definition re-reads, but no longer carries the
 *   node; the header comes from the frozen node entry alone and the section is
 *   unknown.
 * - `node-brief-conventions-unread` — the conventions table cannot be read;
 *   one `convention: see rules` line stands for its rows.
 * - `node-brief-start-unrecorded` — the state writer refused the step's start;
 *   the brief prints without its `started:` line and the start is the session's
 *   own write.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, isPlainObject } from './state-read.mjs';
import { BUILT_IN_AGENTS, guideRows, proseSection, readerRows, sectionNameOf } from './graph.mjs';
import { closingCandidates, evaluate, readinessOf, reread } from './gate-brief.mjs';
import { titleOf } from './display.mjs';
import { attemptOf, companionsOfRun, htmlOutput, projectRootOf, sourcesOf, writeState } from './state.mjs';
import { owedCompanions } from './companions.mjs';
import { STYLE_GUIDE } from './run-context.mjs';
import { briefOfRun, delegatesFor, runHost } from './brief.mjs';
import { openRevision } from './revise.mjs';
import { canAsk, questionSets } from './driver.mjs';
import { HELD_APPROVAL, declaredQuestionIds } from './question-triage.mjs';
import { resolveAgent, shippedHost, shippedPluginName } from './subagents.mjs';
import { DECISION_BY, HEADLINE_MAX, RISK_TAGS } from './items.mjs';

/** The engine's entry script, which the `ask with:` line names by its absolute path. */
const ENGINE = fileURLToPath(new URL('../workflow.mjs', import.meta.url));

/** The engine skill beside this module, whose conventions table the brief prints rows of. */
const SKILL = fileURLToPath(new URL('../../SKILL.md', import.meta.url));

/** The heading the conventions table sits under, exactly. */
const CONVENTIONS = '### Node conventions';

/** How each scheme runs, and the convention row that applies to it. */
const SCHEMES = {
  agent: { how: 'Task tool', row: '`agent:` step' },
  skill: { how: 'Skill tool', row: '`skill:` step' },
  direct: { how: 'inline', row: '`direct:` step' },
  workflow: { how: 'child run', row: '`workflow:` step' },
};

/** Statuses under which a node's declared values read as false or null. */
const NO_VALUES = new Set(['skipped', 'stopped', 'failed']);

/** One `${…}` reference. */
const REFERENCE = /\$\{([^}]*)\}/g;

/** A value whose whole text is one reference, which keeps its type. */
const WHOLE = /^\$\{([^}]*)\}$/;

const NOT_RECORDED = '(not recorded yet)';
const OWED = 'HTML page owed:';
const NO_SECTION = 'section: none — the conventions above apply';
const UNKNOWN_SECTION = 'section: unknown — the definition this run froze cannot be re-read';
const GONE_SECTION = 'section: unknown — the node is not in the definition as it reads now';

/** A reference that finds nothing in state, kept apart from a recorded null. */
const MISSING = Symbol('not recorded');

/**
 * Render the brief of `node` in the run whose state file is `state`. `rules`
 * is the pointer the `rules:` line prints; the caller passes its own, and the
 * conventions section of the skill beside this module stands in without one.
 *
 * Returns `{ok, text, errors, warnings}`; `text` ends with a newline.
 */
export function nodeBrief({ state, node, rules = `${SKILL} § Node conventions` }) {
  const pointer = quotedPointer(rules);
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('node-brief-state-unreadable',
      `${state} cannot be read as a state document (${err.message}). Point --state at the run's orchestrator-state.yml; nothing was read further.`);
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.workflow)) {
    return refuse('node-brief-not-a-run',
      `${state} carries no workflow block, so the engine never froze it. Run the verb on a frozen run's state.`);
  }
  const workflow = doc.workflow;
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  if (node === HELD_APPROVAL || !Object.hasOwn(recorded, node)) {
    return refuse('node-brief-unknown-node',
      `${node} is not a node of this run${node === HELD_APPROVAL ? '; held-approval is briefed by gate-brief' : ''}. Name a node of this run, exactly as workflow.nodes spells it; no state write fixes this.`);
  }

  const runDir = path.dirname(path.resolve(state));
  const warnings = [];
  const current = reread(doc, workflow, runDir);
  if (current.graph === null) warnings.push(`node-brief-definition-unread: ${state}`);
  else if (current.drift) warnings.push(`node-brief-graph-drift: the definition now resolves to ${current.digest}, not the graph this run froze; the brief follows the definition as it reads now`);

  const table = conventionsOf();
  if (table === null) warnings.push(`node-brief-conventions-unread: ${SKILL}`);

  const nodes = current.graph?.nodes ?? [];
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const context = {
    doc,
    state: path.resolve(state),
    runDir,
    root: projectRootOf(runDir),
    recorded,
    byId,
    inputs: inputsOf(doc),
    defaults: current.defaults,
    status: new Map(Object.keys(recorded).filter(id => id !== HELD_APPROVAL).map(id => [id, entryOf(recorded, id).status ?? 'pending'])),
  };
  const resolved = byId.get(node) ?? null;
  if (resolved === null && current.graph !== null) {
    warnings.push(`node-brief-node-gone: ${node} is not in the definition as it reads now; the header comes from the frozen node entry alone`);
  }
  const entry = entryOf(recorded, node);
  const title = titleOf(current.display.titles, node);
  const gate = resolved ? resolved.type === 'gate' : entry.kind === 'gate';
  // The sources are read once, and the section sliced once, for the whole brief.
  const sources = resolved ? sourcesRead(workflow, runDir) : null;
  const origin = sources ? originOf(sources, node) : null;
  const section = origin === null ? null : proseSection(origin, sectionNameOf(resolved));
  const printed = section === null ? null : sliced(section.text);
  const convention = keys => conventionLines(table, keys);
  const askIt = `ask it: gate-brief --state=${quoted(path.resolve(state))} --node=${node}`;

  const lines = gate
    ? gateLines({ node, title, resolved, context, convention, rules: pointer })
    : stepLines({ node, title, resolved, entry, context, convention, table, rules: pointer, origin, section, sources });
  // After the header is rendered, so it reads the statuses the brief found.
  if (!gate && startable(node, resolved, nodes, context)) {
    const started = writeState({ state, patch: { nodes: { [node]: { status: 'running' } } } });
    if (started.ok) lines.splice(2, 0, STARTED);
    else warnings.push(`node-brief-start-unrecorded: ${started.errors.map(error => error.code).join(', ')}`);
  }
  lines.push('');
  if (resolved === null) {
    lines.push(gate ? askIt : current.graph === null ? UNKNOWN_SECTION : GONE_SECTION);
  } else if (gate) {
    lines.push(/^\*\*Exception\.\*\*/m.test(printed ?? '') ? printed : askIt);
  } else {
    lines.push(printed ?? NO_SECTION);
  }
  return { ok: true, text: `${lines.join('\n')}\n`, errors: [], warnings };
}

const STARTED = 'started: recorded running by this brief — the start needs no write of its own';

/** The terminal task statuses, after which nothing starts. */
const RUN_ENDED = new Set(['completed', 'failed', 'stopped']);

/**
 * Whether the brief records this step's start: a step the engine runs here —
 * `agent:`, `skill:` or `direct:`, never a dispatch, whose `waiting` is the
 * close-out's, nor a `workflow:` step, whose start brackets its child's
 * freeze — still `pending`, in a run neither ended nor waiting on a gate, and
 * ready by the ready-set rule: its needs settled and its guard true. And the
 * step the walk reaches next: while an earlier node in frozen order is pending
 * and not waiting on its needs, that node is due first — run, asked, or
 * recorded skipped, which must land before a later start. Otherwise the brief
 * writes nothing and the start is the session's own write, as it always was.
 */
function startable(node, resolved, nodes, context) {
  if (resolved === null || context.status.get(node) !== 'pending') return false;
  const uses = typeof resolved.uses === 'string' ? resolved.uses : '';
  if (!['agent', 'skill', 'direct'].includes(uses.slice(0, uses.indexOf(':')))) return false;
  if (typeof resolved.dir === 'string' && resolved.dir !== '') return false;
  const orchestrator = isPlainObject(context.doc.orchestrator) ? context.doc.orchestrator : {};
  if (isPlainObject(orchestrator.gate_pending)) return false;
  if (RUN_ENDED.has(context.doc.task?.status)) return false;
  if (readinessOf(resolved, context.status) !== 'ready') return false;
  if (typeof resolved.when === 'string') {
    const guard = evaluate(resolved.when, context);
    if (!guard.ok || !guard.value) return false;
  }
  const earlier = nodes.slice(0, nodes.findIndex(entry => entry.id === node));
  return !earlier.some(entry => context.status.get(entry.id) === 'pending' && readinessOf(entry, context.status) !== 'waiting');
}

/** A path as a shell reads it: bare, or in single quotes when it holds whitespace. */
function quoted(file) {
  return /\s/.test(file) ? `'${file.replace(/'/g, "'\\''")}'` : file;
}

/** A `<path> § <heading>` pointer with its path quoted as `quoted` does. */
function quotedPointer(rules) {
  const at = rules.lastIndexOf(' § ');
  return at < 0 ? rules : `${quoted(rules.slice(0, at))}${rules.slice(at)}`;
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

/**
 * The model and effort an `agent:` step's call carries, as `dispatch-model`
 * resolves them from the block the run froze, for the host this plugin ships
 * for — `omit` leaving the field off the call.
 */
function modelText(agent, node, doc) {
  const options = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.options) ? doc.orchestrator.options : {};
  const answer = resolveAgent(agent, {
    block: isPlainObject(options.subagents) ? options.subagents : null,
    workflow: typeof doc.workflow?.name === 'string' ? doc.workflow.name : null,
    node,
    host: shippedHost(),
  });
  return `model ${answer.model}, effort ${answer.effort} (source: ${answer.source})`;
}

function entryOf(recorded, id) {
  return isPlainObject(recorded[id]) ? recorded[id] : {};
}

function inputsOf(doc) {
  const options = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.options) ? doc.orchestrator.options : {};
  return isPlainObject(options.inputs) ? options.inputs : {};
}

// ---------------------------------------------------------------------------
// a task step (NB-5)
// ---------------------------------------------------------------------------

function stepLines({ node, title, resolved, entry, context, convention, table, rules, origin, section, sources }) {
  const uses = typeof resolved?.uses === 'string' ? resolved.uses : null;
  const scheme = uses ? uses.slice(0, uses.indexOf(':')) : String(entry.kind ?? '');
  const known = SCHEMES[scheme] ?? null;
  const dispatched = typeof resolved?.dir === 'string' && resolved.dir !== '';
  const how = dispatched ? `dispatched to ${shown(interpolate(resolved.dir, context))}` : known?.how ?? 'unknown';

  const model = scheme === 'agent' && uses && !dispatched ? `, ${modelText(uses.slice(uses.indexOf(':') + 1), node, context.doc)}` : '';
  const lines = [`## Node: ${node} — ${title}`, `runs: ${uses ?? scheme} — ${how}${model}`];
  if (resolved && typeof resolved.when === 'string') lines.push(whenLine(resolved.when, context));
  const attempt = attemptOf(entry);
  const status = entry.status ?? 'pending';
  if (attempt > 1 || status !== 'pending') lines.push(`attempt: ${attempt} — ${status}`);
  if (resolved === null) {
    lines.push(...convention(known ? [known.row, 'every step'] : ['every step']), `rules: ${rules}`);
    return lines;
  }
  const brief = (sources ? briefOfRun(context.doc, context.runDir, sources) : null)?.[node] ?? {};
  const delegates = scheme === 'direct' && !dispatched ? delegatesFor(brief, runHost(context.doc)) : [];
  if (delegates.length) {
    lines[1] = `runs: ${uses} — inline, its delegates dispatched through the Task tool`;
    lines.push(DELEGATES, ...delegates.map(agent => `- ${dispatchName(agent)}: ${modelText(agent.slice(agent.indexOf(':') + 1), node, context.doc)}`));
  }
  const withs = isPlainObject(resolved.with) ? resolved.with : {};
  const filled = Object.fromEntries(Object.entries(withs).map(([key, value]) => [key, interpolate(value, context)]));
  if (Object.keys(filled).length) lines.push('with:', ...Object.entries(filled).map(([key, value]) => `- ${key}: ${shown(value)}`));

  const { lines: writes, pages } = writeLines(node, resolved, entry, brief, context, sources);
  if (writes.length) lines.push('writes:', ...writes);
  if (pages.length) lines.push(...companionLines(node, context.doc, pages));

  const values = isPlainObject(resolved.outputs?.values) ? resolved.outputs.values : {};
  if (Object.keys(values).length) {
    lines.push(`records: ${Object.entries(values).map(([key, type]) => `${key} (${typeText(type)})`).join(', ')}`);
  }

  const keys = [];
  if (known && (scheme !== 'direct' || section === null || pages.length)) keys.push(known.row);
  if (writes.length || Object.keys(values).length) keys.push('every step');

  const asks = askLines(origin, resolved, context, node);
  if (asks.length) {
    lines.push(...asks);
    keys.push('asks');
  }

  const fed = gatesFed(node, context);
  if (fed.length) {
    lines.push(...fed.map(feedLine));
    keys.push('feeds a checkpoint');
  }

  // Only an option the step can recommend: a continue of a gate it feeds.
  const continues = new Set(fed.flatMap(each => each.continues));
  for (const [key, mapping] of Object.entries(isPlainObject(brief.recommends) ? brief.recommends : {})) {
    const value = Object.hasOwn(filled, key) ? filled[key] : MISSING;
    if (value === MISSING || value === null || value === '') continue;
    const text = String(value);
    if (!Object.hasOwn(mapping, text)) lines.push(`recommends: ${key} = ${text} — the section decides`);
    else if (continues.has(mapping[text])) lines.push(`recommends: ${key} = ${text} → ${mapping[text]}`);
  }
  if (Number.isInteger(brief.budget)) lines.push(`budget: ${brief.budget} attempt${brief.budget === 1 ? '' : 's'} — a prose rule; nothing enforces it`);

  const later = [];
  if ([...context.byId.values()].some(each => rerunsOf(each).includes(node))) (revisedNow(context.doc, node) ? keys : later).push('named by a revise');
  if (Number.isInteger(brief.budget)) (attempt >= brief.budget ? keys : later).push('has a budget');
  lines.push(...convention(keys));
  if (later.length && table !== null) lines.push(`convention (${later.join(', ')}): see rules`);

  if (section !== null) lines.push(...seeLines(section));
  if (known && scheme !== 'workflow' && !dispatched) lines.push(closingLine(node, values, brief, continues, delegates));
  lines.push(`rules: ${rules}`);
  return lines;
}

/**
 * The step's closing write with its exact keys, each value a placeholder to
 * fill: `nodes` and `node_summaries` at the top level, the declared values
 * typed, `absent` only for an artifact `brief:` lets go unwritten and
 * `recommends` only where `brief:` maps one onto a gate the step feeds. Printed
 * because a closing write guessed from memory is what the writer refused most:
 * a summary key misspelt, a context block or a re-sent `workflow` beside it.
 */
function closingLine(node, values, brief, continues, delegates) {
  const typed = Object.entries(values).map(([key, type]) => `${JSON.stringify(key)}: ${placeholderOf(type)}`);
  const status = `"status": "completed"${typed.length ? `, "values": {${typed.join(', ')}}` : ''}`;
  const summary = [
    `"headline": "<one sentence, at most ${HEADLINE_MAX} characters>"`,
    '"summary": "<what was found and what it means>"',
    `"decisions": [{"decision": "<…>", "by": "${DECISION_BY.join('|')}"}]`,
    `"risks": [{"risk": "<…>", "tag": "${RISK_TAGS.join('|')}"}]`,
  ];
  const absent = Object.keys(isPlainObject(brief.absent) ? brief.absent : {});
  if (absent.length) summary.push(`"absent": {${absent.map(key => `${JSON.stringify(key)}: "<reason, only when not written>"`).join(', ')}}`);
  if (isPlainObject(brief.recommends) && continues.size) {
    summary.push(`"recommends": {"option": "${[...continues].join('|')}", "reason": "<one line>"}`);
  }
  if (delegates.length) summary.push(`"delegated": [${delegates.map(agent => JSON.stringify(agent)).join(', ')}]`);
  const id = JSON.stringify(node);
  return `closing patch (fill each <…>; never re-send workflow): {"nodes": {${id}: {${status}}}, "node_summaries": {${id}: {${summary.join(', ')}}}}`;
}

/**
 * The `companion writer:` line: the html-companion-writer call for a page the
 * step owes, with the model and effort it carries, and under it the lines its
 * prompt carries — the style guide once, then each owed page's markdown.
 * Printed beside the owed pages, because a session that dispatched the writer
 * from memory left the model off and ran it on its own, and one that sent no
 * run context left the writer searching the disk for its style guide.
 */
function companionLines(node, doc, pages) {
  return [
    `companion writer: ${dispatchName(COMPANION_WRITER)}, ${modelText(COMPANION_WRITER, node, doc)} — the call for each page owed above that is not on disk when the step's work is done, never on the session's model; its prompt carries the html line and that page's md_path line below, as printed`,
    `- html: ${STYLE_GUIDE}`,
    ...pages.map(page => `- md_path: ${page}`),
  ];
}

/** The agent that writes an owed page a step did not write itself. */
const COMPANION_WRITER = 'html-companion-writer';

/**
 * The `delegates:` line: the agents a `direct:` step's brief declares, each
 * dispatched rather than done in the session. Printed whole, because a step
 * run inline from its section reads the delegate's work as its own to do.
 */
const DELEGATES = 'delegates: dispatch each agent below through the Task tool, on the model and effort beside it, whatever the size of the project or the task — never do its work in this session. The closing write lists each in "delegated" and is refused without it';

/**
 * An agent as the Task tool takes it: a built-in agent type bare, another
 * plugin's name kept, and a bare name or one under either variant's prefix
 * under this plugin's — a definition is not rewritten by the Copilot build,
 * so a name under this plugin's own prefix reaches the variant as written.
 */
function dispatchName(agent) {
  if (BUILT_IN_AGENTS.includes(agent)) return agent;
  const at = agent.indexOf(':');
  if (at < 0 || OWN_PLUGINS.includes(agent.slice(0, at))) return `${shippedPluginName()}:${agent.slice(at + 1)}`;
  return agent;
}

/** The names this plugin is registered under, one per host's variant. */
const OWN_PLUGINS = ['maister', 'maister-copilot'];

/** A declared value's placeholder: its literal alternatives, or the kind of string it takes. */
function placeholderOf(type) {
  if (type === 'bool') return 'true|false';
  if (isPlainObject(type) && Array.isArray(type.enum)) return `"${type.enum.join('|')}"`;
  return `"<${typeof type === 'string' ? type : 'value'}>"`;
}

/** `when: <guard> — now <true | false | not yet decidable>`, by `gate-brief`'s rule. */
function whenLine(when, { byId, recorded, status, inputs, defaults }) {
  const read = evaluate(when, { byId, recorded, status, inputs, defaults });
  return `when: ${when} — now ${read.ok ? String(read.value) : 'not yet decidable'}`;
}

/**
 * One line per declared artifact: the path repository-root-relative, the page
 * it owes when HTML output is on, and the reason `brief:` gives when it may be
 * absent. Returns `{lines, pages}`, `pages` the markdown of each owed page as
 * the companion writer is handed it: absolute, since the writer never `cd`s,
 * and placed as any path is where it cannot be (a sub-run's not yet recorded).
 */
function writeLines(node, resolved, entry, brief, context, sources) {
  const artifacts = isPlainObject(resolved.outputs?.artifacts) ? resolved.outputs.artifacts : {};
  if (!Object.keys(artifacts).length) return { lines: [], pages: [] };
  const owing = htmlOutput(context.doc) && sources ? companionsOfRun(context.doc, context.runDir, sources) : null;
  const owed = new Map(owing ? owedCompanions(owing, node).map(each => [each.key, each.html]) : []);
  const absent = isPlainObject(brief.absent) ? brief.absent : {};
  const where = artifactBase(resolved, entry, context);
  const pages = [];
  const lines = Object.entries(artifacts).map(([key, declared]) => {
    let line = `- ${key}: ${placed(declared, where)}`;
    if (owed.has(key)) {
      line += ` — ${OWED} ${pageOf(declared, owed.get(key), where)}`;
      pages.push(where.base === undefined ? placed(declared, where) : path.resolve(context.root, placed(declared, where)));
    }
    if (Object.hasOwn(absent, key)) line += ` — may be absent: ${absent[key]}`;
    return line;
  });
  return { lines, pages };
}

/**
 * Where a node's declared paths are joined: the run's task directory,
 * repository-root-relative; a child's recorded `task_path` for a `workflow:`
 * node, or null before it is recorded; nothing for a `dir:` node, whose paths
 * are the member repository's.
 */
function artifactBase(resolved, entry, context) {
  if (typeof resolved.dir === 'string' && resolved.dir !== '') return { literal: true };
  if (typeof resolved.uses === 'string' && resolved.uses.startsWith('workflow:')) {
    const taskPath = isPlainObject(entry.values) ? entry.values.task_path : undefined;
    return typeof taskPath === 'string' && taskPath !== '' ? { base: taskPath } : { child: true };
  }
  return { base: taskPathOf(context) };
}

/** The owed page by its file name when it sits beside its markdown, else placed as any path is. */
function pageOf(declared, html, where) {
  const beside = typeof declared === 'string' && typeof html === 'string'
    && path.posix.dirname(declared) === path.posix.dirname(html) && !html.includes('${');
  return beside ? `${path.posix.basename(html)} beside it` : placed(html, where);
}

function placed(declared, where) {
  if (typeof declared !== 'string' || declared.includes('${') || where.literal) return String(declared);
  if (where.child) return `${declared} (in the sub-run's task directory)`;
  return path.posix.join(where.base, declared);
}

/** The run's task directory, repository-root-relative, spelled with `/`. */
function taskPathOf({ doc, runDir, root }) {
  const recorded = isPlainObject(doc.orchestrator) ? doc.orchestrator.task_path : undefined;
  const dir = typeof recorded === 'string' && recorded.trim() !== '' && !/[\r\n]/.test(recorded)
    ? path.resolve(root, recorded)
    : runDir;
  return path.relative(root, dir).split(path.sep).join('/');
}

function typeText(type) {
  if (isPlainObject(type) && Array.isArray(type.enum)) return `enum: ${type.enum.join(', ')}`;
  return typeof type === 'string' ? type : JSON.stringify(type);
}

/**
 * `asks (<driver>): <ids>` for the question ids the node's section declares;
 * when nobody can be asked, the same ids and a pointer at the Without line of
 * each, which states the default that stands in. Asked in session on Copilot,
 * an `ask with:` line follows, naming the command that turns the node's set
 * into the question tool's call.
 */
function askLines(origin, resolved, { doc, state, runDir }, node) {
  const ids = origin === null ? [] : declaredQuestionIds(origin, sectionNameOf(resolved));
  if (!ids.length) return [];
  if (questionSets(doc)) return [`asks (question sets): ${ids.join(', ')}`];
  if (!canAsk(doc)) return [`asks (nobody can be asked): ${ids.join(', ')} — the Without line of each applies`];
  const lines = [`asks (in session): ${ids.join(', ')}`];
  if (runHost(doc) === 'copilot') lines.push(askWithLine(state, runDir, node));
  return lines;
}

/**
 * The `ask with:` line: the patch file the set is written to and the
 * `gate-brief` call whose whole output is the question tool's arguments.
 */
function askWithLine(state, runDir, node) {
  const patch = quoted(path.join(runDir, '.state-patch.json'));
  return `ask with: write each question set to ${patch} as the in-node questions reference shapes it, then run node ${quoted(ENGINE)} gate-brief --state=${quoted(state)} --node=${node} --ask --patch-file=${patch} and pass its output to the question tool unchanged — never compose the form yourself`;
}

/**
 * Each gate the step feeds — whose closing nodes, by `closingCandidates`
 * (the validator's `closedBy`), hold it — with its continue and revise
 * options, in graph order.
 */
function gatesFed(node, { byId, recorded }) {
  const fed = [];
  for (const each of byId.values()) {
    if (each.type !== 'gate' || !closingCandidates(recorded, byId, each.id).direct.includes(node)) continue;
    const options = isPlainObject(each.options) ? Object.entries(each.options) : [];
    fed.push({
      id: each.id,
      continues: options.filter(([, option]) => effectOf(option) === 'continue').map(([id]) => id),
      revises: options.filter(([, option]) => effectOf(option) === 'revise').map(([id, option]) => `${id} → ${option.reruns}`),
    });
  }
  return fed;
}

function feedLine({ id, continues, revises }) {
  return `feeds: ${id} — continues: ${continues.join(', ')}${revises.length ? `; revise: ${revises.join(', ')}` : ''}`;
}

/** Whether a recorded revise names the step now: the open revise, applied, re-runs this node. */
function revisedNow(doc, node) {
  const open = openRevision(doc);
  return open !== null && open.applied && open.reruns === node;
}

function effectOf(option) {
  return isPlainObject(option) ? option.effect : option;
}

function rerunsOf(node) {
  if (node.type !== 'gate' || !isPlainObject(node.options)) return [];
  return Object.values(node.options).filter(option => isPlainObject(option) && typeof option.reruns === 'string').map(option => option.reruns);
}

/**
 * `see: <guide> § <heading>` for each shared section of the guide — an H2
 * that is not a node's — the slice names in italics.
 */
function seeLines(section) {
  const shared = [];
  for (const row of guideRows(fs.readFileSync(section.companion, 'utf8'))) {
    if (row.level !== 2) continue;
    const match = /^##\s+([^`].*?)\s*$/.exec(row.text);
    if (match) shared.push(match[1]);
  }
  return shared.filter(heading => section.text.includes(`*${heading}*`)).map(heading => `see: ${section.companion} § ${heading}`);
}

// ---------------------------------------------------------------------------
// a gate (NB-8)
// ---------------------------------------------------------------------------

function gateLines({ node, title, resolved, context, convention, rules }) {
  const lines = [`## Gate: ${node} — ${title}`];
  if (resolved && typeof resolved.when === 'string') lines.push(whenLine(resolved.when, context));
  const closes = closingCandidates(context.recorded, context.byId, node).direct;
  if (closes.length) lines.push(`closes: ${closes.join(', ')}`);
  if (resolved && isPlainObject(resolved.options)) {
    lines.push(`options: ${Object.entries(resolved.options).map(([id, option]) => {
      const effect = effectOf(option);
      return `${id} (${effect === 'revise' ? `revise → ${option.reruns}` : effect})`;
    }).join(', ')}`);
  }
  lines.push(...convention(['gate']), `rules: ${rules}`);
  return lines;
}

// ---------------------------------------------------------------------------
// the guide
// ---------------------------------------------------------------------------

/** The definition, overlays and profile the run froze (`sourcesOf`), or null when they cannot be read. */
function sourcesRead(workflow, runDir) {
  try {
    return sourcesOf(workflow, runDir);
  } catch {
    return null;
  }
}

/**
 * The file a node's section is found beside: the overlay that added it — the
 * last layer to add it, a profile's addition included — or the base
 * definition. Null when the sources cannot be read.
 */
function originOf(sources, node) {
  if (!sources.definition?.file) return null;
  let origin = sources.definition.file;
  for (const overlay of sources.overlays) {
    const doc = isPlainObject(overlay.doc) ? overlay.doc : {};
    const profile = sources.profile !== null && isPlainObject(doc.profiles) ? doc.profiles[sources.profile] : null;
    for (const body of [doc, profile]) {
      if (isPlainObject(body) && isPlainObject(body.add) && Object.hasOwn(body.add, node)) origin = overlay.file;
    }
  }
  return origin;
}

/**
 * A section as the brief prints it: the picker passages dropped by `readerRows`
 * — the one strip the template lint reads a section through — leading blank
 * lines gone, and no run of blank lines the drops left behind.
 */
function sliced(text) {
  const kept = [];
  for (const { text: line } of readerRows(guideRows(text))) {
    if (line.trim() === '' && (kept.length === 0 || kept.at(-1).trim() === '')) continue;
    kept.push(line);
  }
  while (kept.length && kept.at(-1).trim() === '') kept.pop();
  return kept.join('\n');
}

// ---------------------------------------------------------------------------
// the conventions table
// ---------------------------------------------------------------------------

/**
 * The rows under `### Node conventions` in the skill beside this module, by
 * their first cell; null when the file, the heading or every row is missing.
 */
function conventionsOf() {
  let text;
  try {
    text = fs.readFileSync(SKILL, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  const start = lines.indexOf(CONVENTIONS);
  if (start < 0) return null;
  const rows = new Map();
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|') || /^\|\s*:?-/.test(line)) continue;
    const cells = line.slice(1).replace(/\|\s*$/, '');
    const at = cells.indexOf('|');
    if (at < 0) continue;
    rows.set(cells.slice(0, at).trim(), cells.slice(at + 1).trim());
  }
  rows.delete('Applies to');
  return rows.size ? rows : null;
}

/** One `convention (<key>): <row>` line per key the table holds, or the one pointer line without a table. */
function conventionLines(table, keys) {
  if (table === null) return ['convention: see rules'];
  return keys.filter(key => table.has(key)).map(key => `convention (${key}): ${table.get(key)}`);
}

// ---------------------------------------------------------------------------
// interpolation (SKILL.md § Interpolating)
// ---------------------------------------------------------------------------

/**
 * A `with:` value with every `${…}` filled in from state. A reference that is
 * the whole string keeps its type; one inside longer text becomes text, a null
 * empty. A reference that finds nothing yields `MISSING`, printed as
 * `(not recorded yet)` wherever it stands.
 */
function interpolate(value, context) {
  if (Array.isArray(value)) return value.map(each => interpolate(each, context));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, interpolate(each, context)]));
  if (typeof value !== 'string') return value;
  const whole = WHOLE.exec(value);
  if (whole) return lookup(whole[1], context);
  return value.replace(REFERENCE, (_, reference) => {
    const found = lookup(reference, context);
    return found === MISSING ? NOT_RECORDED : found === null ? '' : typeof found === 'object' ? JSON.stringify(found) : String(found);
  });
}

function lookup(reference, context) {
  const parts = reference.split('.');
  if (parts[0] === 'inputs' && parts.length === 2) {
    if (Object.hasOwn(context.inputs, parts[1])) return context.inputs[parts[1]];
    if (Object.hasOwn(context.defaults, parts[1])) return context.defaults[parts[1]];
    return null;
  }
  if (parts.length !== 3) return MISSING;
  const [owner, kind, key] = parts;
  const entry = entryOf(context.recorded, owner);
  const declared = context.byId.get(owner);
  if (kind === 'values') {
    if (isPlainObject(entry.values) && Object.hasOwn(entry.values, key)) return entry.values[key];
    if (NO_VALUES.has(entry.status)) {
      const type = declared?.outputs?.values?.[key];
      return type === 'bool' || declared?.type === 'gate' ? false : null;
    }
    return MISSING;
  }
  if (kind === 'artifacts') {
    const path_ = isPlainObject(declared?.outputs?.artifacts) ? declared.outputs.artifacts[key] : undefined;
    if (typeof path_ !== 'string') return MISSING;
    const where = artifactBase(declared, entry, context);
    return where.child ? MISSING : placed(path_, where);
  }
  return MISSING;
}

function shown(value) {
  if (value === MISSING) return NOT_RECORDED;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, (_, each) => (each === MISSING ? NOT_RECORDED : each));
  return String(value);
}
