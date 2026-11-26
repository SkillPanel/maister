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
 * only while it applies — whole, or named once the session was shown it:
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
 * - A step that declares an explainer page gets the `explainer:` line
 *   `run-context` prints — the page, or `off` with the reason to record — and,
 *   for a page to write, the explainer writer's call and the check script, and
 *   the `writes an explainer` row.
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
 * - A `families (<id>):` line under the `asks` line for each declared id whose
 *   policy row lets a proposal choose — two or more families a proposal could
 *   take, each with its description — and only in a run whose policy classes
 *   questions and still has the hash the freeze recorded. The node proposes a
 *   family per question from it (the in-node questions reference); an id with
 *   nothing to choose prints nothing.
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
 *
 * The lines that carry a rule the session would otherwise hold from the
 * engine skill, each printed only where it applies:
 * - `start: yours` on a step ready to start whose start the brief does not
 *   record — a `workflow:` step — never beside `started:` and never for a
 *   dispatched (`dir:`) node; where the brief's start write was refused, a
 *   `start: refused` line with the refusal's code and message and its
 *   `rules:` line in its place, since the same write would be refused again.
 * - `waiting:` on a node recorded `waiting`, which is never run again.
 * - `say:` on an `agent:` step and a step with `delegates:`: the one line the
 *   session prints while the delegate runs.
 * - `say:` over the start banner's lines, first, on a top-level run's brief
 *   of its first node while no node has started: the freeze's banner, which sessions kept in
 *   their thinking, as a printed step.
 * - `missing:` for each `with:` reference that finds nothing recorded yet,
 *   which is re-driven or recorded, never guessed.
 * - `held:` at a gate a held choice asks, with the count still waiting.
 * - `close-out:` at the closing node of a dispatched or classing run: the
 *   `held-approval` brief and the outbox publish its outcome waits on.
 * - `engine skill:` first on every brief, then `commands:`: the skill's
 *   absolute path, to be read whole now unless read in this context — a
 *   compaction can leave none of it in view — and the one-command form every
 *   call takes.
 * - The gate's `ask it:` line, the whole call by the run's driver and the host
 *   this plugin ships for: `gate-request` where a driver suspends, else
 *   `gate-brief` in the form the host's question tool takes.
 * Paths stay repository-root-relative rather than task-relative: a delegate
 * is handed them as printed, and its working directory is the project root —
 * all but an `output_path` agent, which joins a path to `task_path` itself and
 * so is handed the declared one (the `agent:` row says so).
 * The `with:` values and a `dir:` are printed filled in, by the rules of
 * `references/grammar.md` § 9. A path the header names for a shell — the
 * `rules:` line, the `engine skill:` line, the `ask it:` call — goes in single
 * quotes when it holds whitespace, as the engine's invocation contract writes
 * one.
 *
 * What it reads. The state file; the definition the run froze, re-read and
 * re-resolved through `gate-brief`'s `reread`; its overlays and profile; the
 * guide beside the file a node comes from — the base definition's, or the
 * adding overlay's for a node an overlay added; and the `# Node conventions`
 * table of `references/node-conventions.md` in the skill beside this module,
 * found from its own location so a generated variant reads its own copy.
 *
 * Each convention row is printed whole once per session. The rows are fixed
 * text, the same on every node, and printed on every brief they made up much
 * of a run's briefs. So a session's briefs print a row whole the first
 * time it applies, and a later brief names it on one `conventions in force
 * (…)` line. What a session was shown is kept in its conventions marker
 * (`display-files.mjs`), keyed by the host's session id. `resume-check` and the
 * post-compaction hook remove the marker, so the first brief after a resume or
 * a compaction prints every row whole again, and a session never works from a
 * row it no longer has in view. Without a session id, every row prints whole
 * on every brief.
 *
 * What it writes. The start of a step it briefs (`recordStart`), the
 * session's conventions marker when it printed a row whole, and on every brief
 * it prints the run's `display/brief.json` stamp, the display's proof that a
 * brief was printed when no start was written. The brief is what
 * every step is run from, so a step cannot be begun without it, and the start
 * it records is what the status line and the dashboard read as the step under
 * way. A `skill:` step hands the session to a skill whose own instructions take
 * over, and the start the prose asked for was the write runs dropped. Nothing
 * else — a refusal, a step not ready to run — writes anything else; a gate
 * writes only the marker and the stamp. A marker that cannot be written is not
 * a warning: the next brief prints the rows whole again. A stamp that cannot be
 * written is one, so the display draws the call in full. It returns `{ok, text, errors, warnings}`.
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
 *   the brief prints the refusal and its recovery where its `started:` line
 *   would be.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, isPlainObject } from './state-read.mjs';
import { BUILT_IN_AGENTS, guardReadsTask, guideRows, nodeKindIn, plainContinueOf, proseSection, readerRows, sectionNameOf } from './graph.mjs';
import { driftClause, atClose, closingCandidates, evaluate, gateBrief, readinessOf, reread } from './gate-brief.mjs';
import { titleOf } from './display.mjs';
import { attemptOf, companionsOfRun, explainerState, htmlOutput, projectRootOf, sourcesOf, startBanner, workflowConfigOf, writeState } from './state.mjs';
import { autoContinued, configContinueLine } from './workflow-config.mjs';
import { owedCompanions } from './companions.mjs';
import { STYLE_GUIDE, explainerLine } from './run-context.mjs';
import { briefOfRun, delegatesFor, runHost } from './brief.mjs';
import { openRevision } from './revise.mjs';
import { canAsk, isDispatchedRun, isTerminalDriver, questionSets } from './driver.mjs';
import { CHOICE_WORDS, HELD_APPROVAL, declaredClarificationIds, declaredQuestionIds, outstandingHeld } from './question-triage.mjs';
import { CLASSES, ceilingOf, loadPolicy, questionFamilies } from './policy.mjs';
import { modelShown, resolveAgent, shippedHost, shippedPluginName } from './subagents.mjs';
import { BY_CONFIG, DECISION_BY, HEADLINE_MAX, RISK_TAGS, oneLine } from './items.mjs';
import { conventionsShown, markConventionsShown, publishBrief } from './display-files.mjs';
import { runRoot } from './resume-check.mjs';

/** The engine's entry script, which the `ask with:` line names by its absolute path. */
const ENGINE = fileURLToPath(new URL('../workflow.mjs', import.meta.url));

/** The engine skill's conventions reference, whose table the brief prints rows of. */
const CONVENTIONS_FILE = fileURLToPath(new URL('../../references/node-conventions.md', import.meta.url));

/** The heading the conventions table sits under, exactly. */
const CONVENTIONS = '# Node conventions';

/**
 * The engine skill itself, which the `engine skill:` line names: found from
 * this module's location, as the conventions reference is, so a generated
 * variant names its own copy.
 */
const ENGINE_SKILL = fileURLToPath(new URL('../../SKILL.md', import.meta.url));

/** The gates reference, which the `close-out:` line points into. */
const GATES_FILE = fileURLToPath(new URL('../../references/gates.md', import.meta.url));

/** The engine's entry point, whose `reference` verb prints a plugin file. */
const ENGINE_SCRIPT = fileURLToPath(new URL('../workflow.mjs', import.meta.url));

/**
 * The three lines every brief opens with. A session left with none of the skill
 * after a compaction — Copilot keeps none and has no hook to say so — did not
 * act on a condition at the foot of the brief, so the reload is an instruction
 * at its head, and beside it the one command-form rule its drifting calls
 * broke. The skill is printed by the engine, never opened with the read tool:
 * the plugin sits outside the project, and a host may stop the run to ask
 * before that read. The third line carries the two rules a session without the
 * skill broke next: it read plugin files with the file tool or the shell, and
 * passed a patch as /dev/stdin, which a host asks about as a path outside the
 * project.
 */
const ENGINE_SKILL_LINE = `engine skill: print it whole now with node ${quoted(ENGINE_SCRIPT)} reference --at=SKILL.md, unless it is in this context`;
const COMMANDS_LINE = 'commands: one per call, from the project root — no cd, chain or pipe; a patch as a here-string';
const FILES_LINE = 'plugin files: print them only with reference, never the file tool, sed or cat; a patch file is .state-patch.json beside the state file, never /dev/stdin';

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
export function nodeBrief({ state, node, rules = `${CONVENTIONS_FILE} § Node conventions` }) {
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
  else if (current.drift) warnings.push(`node-brief-graph-drift: the definition now resolves to ${current.digest}, not the graph this run froze; the brief follows the definition as it reads now${driftClause(workflow)}`);

  const table = conventionsOf();
  if (table === null) warnings.push(`node-brief-conventions-unread: ${CONVENTIONS_FILE}`);
  // The rows this session was already shown whole; null prints every one whole.
  const root = runRoot(doc, runDir);
  const shown = table === null ? null : conventionsShown({ root });
  const printedWhole = new Set();

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
  const convention = keys => conventionLines(table, keys, shown, printedWhole);
  const askIt = askItLine(state, node, doc);

  const lines = gate
    ? gateLines({ node, title, resolved, context, convention, rules: pointer })
    : stepLines({ node, title, resolved, entry, context, convention, table, rules: pointer, origin, section, sources });
  // After the header is rendered, so it reads the statuses the brief found.
  // A ready step the engine runs here has its start recorded; any other ready
  // step, or one whose start was refused, is told the start is its own write.
  if (!gate && readyToStart(node, resolved, nodes, context)) {
    if (RECORDED_SCHEMES.includes(schemeOf(resolved))) {
      const started = writeState({ state, patch: { nodes: { [node]: { status: 'running' } } } });
      if (started.ok) lines.splice(2, 0, STARTED);
      else {
        warnings.push(`node-brief-start-unrecorded: ${started.errors.map(error => error.code).join(', ')}`);
        // The same write would be refused again: print the refusal and its recovery, never `start: yours`.
        lines.splice(2, 0, ...startRefused(started.errors));
      }
    } else {
      lines.splice(2, 0, startYours(node));
    }
  }
  // A run's first brief, before any node started, repeats the start banner as a
  // `say:` step: a banner kept in the session's thinking never reached the person.
  if (firstBrief(doc, node, context)) {
    const banner = startBanner(state);
    if (banner !== null) lines.unshift(BANNER_SAY, ...banner);
  }
  lines.unshift(ENGINE_SKILL_LINE, COMMANDS_LINE, FILES_LINE);
  // A marker that cannot be written only means the next brief prints the rows whole again.
  if (shown !== null && printedWhole.size) markConventionsShown({ root, rows: new Set([...shown, ...printedWhole]) });
  lines.push('');
  if (resolved === null) {
    lines.push(gate ? askIt : current.graph === null ? UNKNOWN_SECTION : GONE_SECTION);
  } else if (gate) {
    // A gate the project's config continues is recorded here and asks nothing;
    // one it would continue but its brief advises against is asked, the reason first.
    const auto = configContinue({ state, node, doc, resolved, nodes, context, title, warnings });
    if (auto.lines) lines.push(...auto.lines);
    else {
      if (auto.say) lines.push(auto.say);
      // An exception still asks the gate: the call comes first, the exception after it.
      lines.push(askIt);
      if (/^\*\*Exception\.\*\*/m.test(printed ?? '')) lines.push('', printed);
    }
  } else {
    lines.push(printed ?? NO_SECTION);
  }
  // The display's proof that this call printed a brief, whether or not it started the node.
  warnings.push(...publishBrief({ runDir, node, title, kind: gate ? 'gate' : 'step' }).map(each => `${each.code}: ${each.file}: ${each.message}`));
  return { ok: true, text: `${lines.join('\n')}\n`, errors: [], warnings };
}

const STARTED = 'started: recorded running by this brief — the start needs no write of its own';

/** The line over the start banner a run's first brief repeats. */
const BANNER_SAY = 'say: the run\'s start, a visible message of its own before this node\'s work, unless your last message showed these lines — each copied as printed:';

/**
 * Is this the first brief of a top-level run — its first node, with no node
 * started yet, as the statuses read before this brief's own start write? A
 * child run's banner is never relayed: the parent's walk goes on.
 */
function firstBrief(doc, node, context) {
  if (isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.parent)) return false;
  if ([...context.status.keys()][0] !== node) return false;
  return [...context.status.values()].every(status => status === 'pending');
}

/** The line a ready step whose start the brief did not record prints in its place. */
function startYours(node) {
  return `start: yours — send {"nodes": {${JSON.stringify(node)}: {"status": "running"}}}`;
}

/** The writing-state section holding a refused write's recovery. */
const WRITE_REFUSED = `${quoted(fileURLToPath(new URL('../../references/writing-state.md', import.meta.url)))} § When a write is refused`;

/**
 * The lines a ready step whose start write the writer refused prints instead
 * of `start: yours`: the refusal, code and message, then its `rules:` line.
 */
function startRefused(errors) {
  const [error] = errors;
  return [`start: refused — ${error.code}: ${error.message}`, `rules: ${WRITE_REFUSED}`];
}

/** The terminal task statuses, after which nothing starts. */
const RUN_ENDED = new Set(['completed', 'failed', 'stopped']);

/**
 * The schemes whose start the brief records: the steps the engine runs here.
 * A `workflow:` step's start brackets its child's freeze, so it is the
 * session's own write.
 */
const RECORDED_SCHEMES = ['agent', 'skill', 'direct'];

/** The scheme a resolved node's `uses` names, or '' without one. */
function schemeOf(resolved) {
  const uses = typeof resolved?.uses === 'string' ? resolved.uses : '';
  return uses.slice(0, Math.max(uses.indexOf(':'), 0));
}

/**
 * Whether this step may start now: never a dispatch, whose `waiting` is the
 * close-out's; still `pending`, in a run neither ended nor waiting on a gate,
 * and ready by the ready-set rule: its needs settled and its guard true. And
 * the step the walk reaches next: while an earlier node in frozen order is
 * pending and not waiting on its needs, that node is due first — run, asked,
 * or recorded skipped, which must land before a later start. The brief records
 * the start of such a step of a scheme it runs here (`RECORDED_SCHEMES`), and
 * tells the session the start is its own write for any other; otherwise it
 * writes and says nothing.
 */
function readyToStart(node, resolved, nodes, context) {
  if (resolved === null || context.status.get(node) !== 'pending') return false;
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

/**
 * A gate the run froze in its `workflow_config.auto_continue` (the project's
 * `config.yml`), continued here instead of asked: `{lines}` when its plain
 * continue was recorded `by: config` — the decision, the line to show and the
 * node due next — `{say}` when the config would continue but the gate's own
 * brief advises against it, so it is asked with the reason first, and `{}`
 * otherwise. Under every driver: the config is the project's standing answer,
 * it grants nothing, and the record reads the same wherever the run is driven.
 *
 * Only a gate that is due now — pending, its needs settled, its guard true,
 * nothing earlier left to run — is continued; a gate its guard skips takes the
 * usual skip. Its brief must recommend the continue or nothing: a recommended
 * revise or stop, a stop risk a closing node recorded, or a choice held for a
 * person's approval asks it, since config never stands for a person.
 */
function configContinue({ state, node, doc, resolved, nodes, context, title, warnings }) {
  if (!autoContinued(workflowConfigOf(doc)).includes(node)) return {};
  const option = plainContinueOf(resolved);
  if (option === null || !readyToStart(node, resolved, nodes, context)) return {};
  const brief = gateBrief({ state, node, form: 'verdict', doc });
  if (!brief.ok || brief.verdict.drift) return {};
  const { verdict } = brief;
  const closing = lowered(titleOf(verdict.titles, verdict.closing));
  const against = verdict.stop ? `${closing} recorded a risk that recommends stopping`
    : verdict.effect === 'revise' ? `${closing} recommends revising`
      : verdict.effect === 'stop' ? `${closing} recommends stopping`
        : verdict.held > 0 ? `${verdict.held === 1 ? 'a choice is' : `${verdict.held} choices are`} held for your approval`
          : null;
  if (against !== null) return { say: `say: The project's config would continue, but ${against}; the gate is asked as usual.` };
  const line = configContinueLine(title);
  const written = writeState({
    state,
    patch: {
      nodes: { [node]: { status: 'completed' } },
      node_summaries: { [node]: { headline: line, decisions: [{ option, by: BY_CONFIG }] } },
    },
  });
  if (!written.ok) {
    warnings.push(`node-brief-config-continue-refused: ${written.errors.map(error => error.code).join(', ')}; the gate is asked as usual`);
    return {};
  }
  const name = typeof doc.workflow?.name === 'string' ? doc.workflow.name : '<workflow>';
  const next = written.next === undefined ? []
    : written.next.id === null ? ['next: none — write the closing patch with task.status, then run run-complete']
      : [`next: ${written.next.id} (${written.next.title}) — run node-brief for it`];
  return {
    lines: [
      `decided: ${node} — ${option}, by the project's config (workflows.${name}.auto_continue); nothing to ask, nothing to write`,
      `say: ${line}`,
      ...next,
    ],
  };
}

/** A title as it reads mid-sentence: its first letter lowered. */
function lowered(text) {
  return typeof text === 'string' && text !== '' ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

/**
 * The gate's `ask it:` line: the whole call. A driver that suspends on its
 * gates takes `gate-request`; a run asked in session takes `gate-brief` in the
 * form the shipped host's question tool takes — the `rich` profile's JSON on
 * Claude Code, the question tool's arguments on Copilot.
 */
function askItLine(state, node, doc) {
  const target = `--state=${quoted(path.resolve(state))} --node=${node}`;
  if (!isTerminalDriver(doc)) return `ask it: gate-request ${target}`;
  return `ask it: gate-brief ${target} ${shippedHost() === 'copilot' ? '--ask' : '--json --picker=rich'}`;
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
 * for — `omit` leaving the field off the call, and `session` putting the
 * session's own model id on it.
 */
function modelText(agent, node, doc) {
  const options = isPlainObject(doc.orchestrator) && isPlainObject(doc.orchestrator.options) ? doc.orchestrator.options : {};
  const answer = resolveAgent(agent, {
    block: isPlainObject(options.subagents) ? options.subagents : null,
    workflow: typeof doc.workflow?.name === 'string' ? doc.workflow.name : null,
    node,
    host: shippedHost(),
  });
  return `model ${modelShown(answer.model)}, effort ${answer.effort} (source: ${answer.source})`;
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

  const agent = scheme === 'agent' && uses && !dispatched ? uses.slice(uses.indexOf(':') + 1) : null;
  const model = agent ? ` as ${dispatchName(agent)}, ${modelText(agent, node, context.doc)}` : '';
  const lines = [`## Node: ${node} — ${title}`, `runs: ${uses ?? scheme} — ${how}${model}`];
  if (resolved && typeof resolved.when === 'string') lines.push(whenLine(resolved.when, context));
  const attempt = attemptOf(entry);
  const status = entry.status ?? 'pending';
  if (attempt > 1 || status !== 'pending') lines.push(`attempt: ${attempt} — ${status}`);
  if (status === 'waiting') lines.push(WAITING);
  if (resolved === null) {
    lines.push(...convention(known ? [known.row, 'every step'] : ['every step']), `rules: ${rules}`);
    return lines;
  }
  const brief = (sources ? briefOfRun(context.doc, context.runDir, sources) : null)?.[node] ?? {};
  const delegates = scheme === 'direct' && !dispatched ? delegatesFor(brief, runHost(context.doc)) : [];
  if (delegates.length) {
    lines[1] = `runs: ${uses} — inline, its delegates dispatched through the Task tool`;
    lines.push(delegatesLine(node), ...delegates.map(each => `- ${dispatchName(each)}: ${modelText(each.slice(each.indexOf(':') + 1), node, context.doc)}`));
  }
  if (agent || delegates.length) lines.push(sayLine(title));
  const withs = isPlainObject(resolved.with) ? resolved.with : {};
  const missing = [];
  const filled = Object.fromEntries(Object.entries(withs).map(([key, value]) => [key, interpolate(value, { ...context, missing })]));
  if (Object.keys(filled).length) lines.push('with:', ...Object.entries(filled).map(([key, value]) => `- ${key}: ${shown(value)}`));
  lines.push(...missingLines(missing));

  const { lines: writes, pages } = writeLines(node, resolved, entry, brief, context, sources);
  if (writes.length) lines.push('writes:', ...writes);
  if (pages.length) lines.push(...companionLines(node, context.doc, pages));
  const explainer = dispatched ? null : explainerState(context.doc, context.runDir, node, { nodes: { [node]: resolved } });
  if (explainer !== null) lines.push(...explainerLines(node, context.doc, explainer));

  const values = isPlainObject(resolved.outputs?.values) ? resolved.outputs.values : {};
  if (Object.keys(values).length) {
    lines.push(`records: ${Object.entries(values).map(([key, type]) => `${key} (${typeText(type)})`).join(', ')}`);
  }

  const keys = [];
  if (known && (scheme !== 'direct' || section === null || pages.length)) keys.push(known.row);
  if (writes.length || Object.keys(values).length) keys.push('every step');
  if (explainer !== null) keys.push(EXPLAINER_ROW);

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
  const closeOut = closeOutLine(node, context);
  if (closeOut) lines.push(closeOut);
  lines.push(`rules: ${rules}`);
  return lines;
}

/** The line on a node recorded `waiting`: its child or its dispatch is still out. */
const WAITING = 'waiting: its child run or dispatch has not ended — do not run it again';

/** The line a session prints, in the user's words, once it has launched the step's delegate. */
function sayLine(title) {
  return `say: "${title} is running. Nothing needed from you; I'll continue when it finishes."`;
}

/**
 * One `missing:` line per reference of the step's `with:` that found nothing
 * recorded, each owner and key once: such a value is the owner's to record,
 * never a plausible one the session fills in.
 */
function missingLines(missing) {
  const seen = new Set();
  const lines = [];
  for (const { owner, key } of missing) {
    const id = JSON.stringify([owner, key]);
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push(`missing: ${key} from ${owner} — re-drive ${owner} or record the value; never substitute one`);
  }
  return lines;
}

/**
 * The `close-out:` line at the closing node of a dispatched or a classing run,
 * or null: the step nothing else the run still owes follows (`atClose`). A
 * classing run asks `held-approval` from it first; a dispatched one publishes
 * its close-out before the step's outcome is recorded; a run that is both
 * does the two in that order.
 */
function closeOutLine(node, { doc, runDir }) {
  const dispatched = isDispatchedRun(doc);
  const classing = isPlainObject(doc.orchestrator) && doc.orchestrator.classes_questions === true;
  if (!dispatched && !classing) return null;
  if (atClose({ doc, runDir }).owed.at(-1)?.id !== node) return null;
  const held = 'gate-brief --node=held-approval first';
  const rules = heading => `rules: ${quoted(GATES_FILE)} § ${heading}`;
  if (!dispatched) return `close-out: ${held}, before recording this step's outcome — ${rules('The closing checkpoint `held-approval`')}`;
  const publish = "publish through the outbox verb before recording this step's outcome";
  return `close-out: ${classing ? `${held}, then ${publish}` : publish} — ${rules('Ending a dispatched run')}`;
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
 * The lines for the explainer page a step declares: the `explainer:` line
 * `run-context` prints too — the page, or `off` with the reason to record —
 * and, for a page to write, the explainer writer's call with its model and
 * effort and the check script the step runs on the page. Printed beside the
 * step's other pages, because which explainer is off, and why, is the run's
 * answer and not the prose's.
 */
function explainerLines(node, doc, explainer) {
  if (explainer.off) return [explainerLine(explainer)];
  return [
    explainerLine(explainer),
    `explainer writer: ${dispatchName(EXPLAINER_WRITER)}, ${modelText(EXPLAINER_WRITER, node, doc)} — the call that writes the page, as the \`${EXPLAINER_ROW}\` row says; its prompt carries the step's run-context and this check script as check_script`,
    `- check_script: ${CHECK_EXPLAINER}`,
  ];
}

/** The agent that writes an explainer page, and the row that says how a step runs it. */
const EXPLAINER_WRITER = 'explainer-writer';
const EXPLAINER_ROW = 'writes an explainer';

/** The explainer check, beside the style guide in the orchestrator framework. */
const CHECK_EXPLAINER = fileURLToPath(new URL('../../../orchestrator-framework/scripts/check-explainer.mjs', import.meta.url));

/**
 * The `delegates:` line: the agents a `direct:` step's brief declares, each
 * dispatched rather than done in the session. Printed whole, because a step
 * run inline from its section reads the delegate's work as its own to do.
 */
function delegatesLine(node) {
  return 'delegates: dispatch each agent below through the Task tool, on the model and effort beside it, whatever the size of the project or the task — never do its work in this session. '
    + `The closing write lists each in "delegated" and is refused without it — each prompt carries run-context --node=${node} pasted unedited`;
}

/**
 * An agent as the Task tool takes it: a built-in agent type bare, another
 * plugin's name kept, and a bare name or one under this plugin's prefix
 * under this plugin's — a definition is not rewritten by the Copilot build,
 * so a name under this plugin's own prefix reaches the build as written.
 */
function dispatchName(agent) {
  if (BUILT_IN_AGENTS.includes(agent)) return agent;
  const at = agent.indexOf(':');
  if (at < 0 || agent.slice(0, at) === OWN_PLUGIN) return `${shippedPluginName()}:${agent.slice(at + 1)}`;
  return agent;
}

/** The name this plugin is registered under, the same on every host. */
const OWN_PLUGIN = 'maister';

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
  const clarifications = declaredClarificationIds(origin, sectionNameOf(resolved));
  const families = [...familyLines(doc, ids, node), ...readerLines(doc, ids, clarifications, node)];
  if (questionSets(doc)) return [`asks (question sets): ${ids.join(', ')}${asksTail('When a question suspends')}`, ...families];
  if (!canAsk(doc)) return [`asks (nobody can be asked): ${ids.join(', ')} — the Without line of each applies${asksTail('When nobody can be asked')}`, ...families];
  const lines = [`asks (in session): ${ids.join(', ')}${asksTail('In-node questions')}`, ...families];
  if (runHost(doc) === 'copilot') lines.push(askWithLine(state, runDir, node));
  return lines;
}

/**
 * The asks line's tail: the section of the in-node questions reference a node
 * prints before it asks, or defaults, its first question — the file's opening
 * in session, else the section for the driver — never the whole file, which is
 * longer than a shell output holds.
 */
const asksTail = section => ` — before the first, print reference --at="references/in-node-questions.md § ${section}"`;

/**
 * One `families (<id>): <name> — <description>; …` line per declared id whose
 * row offers a proposal a choice, when the run's policy classes questions and
 * is the one the freeze recorded: under any other policy the classing write
 * classes nothing, so there is nothing to propose. A family below the first is
 * marked as needing the reader's agreement, and a line that offers one ends
 * with the reader's call — its dispatch name, model and effort, as the
 * `companion writer:` line prints the writer's, and the words that keep a
 * question from being lowered (`CHOICE_WORDS`); a line with none ends as it
 * always did.
 */
function familyLines(doc, ids, node) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  if (orchestrator.classes_questions !== true) return [];
  const { policy, hash } = loadPolicy();
  if (orchestrator.policy_hash !== hash) return [];
  const workflow = typeof doc.workflow?.name === 'string' ? doc.workflow.name : null;
  return ids.flatMap(id => {
    const offered = questionFamilies({ policy, workflow, id, declaredIds: ids });
    if (offered.length < 2) return [];
    const list = offered.map(({ name, description, lower }) => `${name} — ${oneLine(description)}${lower ? ' (needs the reader\'s agreement)' : ''}`).join('; ');
    const reader = offered.some(({ lower }) => lower)
      ? ` — a family marked as needing the reader's agreement is taken only with the verdict of ${dispatchName(QUESTION_READER)}, ${modelText(QUESTION_READER, node, doc)}; never for a question worded as a choice (${CHOICE_WORDS.map(word => `"${word}"`).join(', ')})`
      : '';
    return [`families (${id}): ${list}${reader}`];
  });
}

/**
 * One `reader (<id>):` line per declared id its prose marks as a clarification
 * that the run could settle as a fact: one whose row lists — or, with no row,
 * whose unknown family is — a family of a class within what the autonomy
 * ceiling settles, under the policy the freeze recorded. Such a question is
 * settled only with the reader's agreement, so the line names the reader's
 * call and says to dispatch it for each question the node sends that the run
 * may settle; without one, the question is asked.
 */
function readerLines(doc, ids, clarifications, node) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  if (orchestrator.classes_questions !== true || !clarifications.length) return [];
  const { policy, hash } = loadPolicy();
  if (orchestrator.policy_hash !== hash) return [];
  const settles = ceilingOf({ options: orchestrator.options, policy })?.settles ?? null;
  if (settles === null) return [];
  const workflow = typeof doc.workflow?.name === 'string' ? doc.workflow.name : null;
  const families = isPlainObject(policy.families) ? policy.families : {};
  const settled = name => Object.hasOwn(families, name) && CLASSES.indexOf(families[name].class) <= CLASSES.indexOf(settles)
    && !(Array.isArray(families[name].floor) && families[name].floor.length > 0);
  return clarifications.filter(id => ids.includes(id)).flatMap(id => {
    const offered = questionFamilies({ policy, workflow, id, declaredIds: ids }).map(each => each.name);
    const names = offered.length ? offered : typeof policy.unknown_family === 'string' ? [policy.unknown_family] : [];
    if (!names.some(settled)) return [];
    return [`reader (${id}): a clarification is settled as a fact only with the verdict of ${dispatchName(QUESTION_READER)}, ${modelText(QUESTION_READER, node, doc)} — `
      + 'dispatch it for each question of the set the run may settle, copy its verdict on as reader, and send none you could not get: the question is then asked'];
  });
}

/** The agent whose verdict a proposal below a row's first family needs. */
const QUESTION_READER = 'question-reader';

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
  const held = heldLine(resolved, context);
  if (held) lines.push(held);
  lines.push(...convention(['gate']), `rules: ${rules}`);
  return lines;
}

/**
 * The `held:` line at a gate the held rule asks while choices wait for
 * approval: an unguarded gate, or one whose guard reads a step's value. A gate
 * guarded only by inputs or other gates' values is still skipped by its guard,
 * so it prints none.
 */
function heldLine(resolved, { doc, byId }) {
  const count = outstandingHeld(doc).length;
  if (!count || resolved === null) return null;
  if (typeof resolved.when === 'string' && !guardReadsTask(resolved, nodeKindIn(byId))) return null;
  const choices = count === 1 ? '1 choice waits' : `${count} choices wait`;
  return `held: ${choices} for approval — asked whatever its guard reads; its continue approves ${count === 1 ? 'it' : 'them'}`;
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
 * The rows under `# Node conventions` in `references/node-conventions.md` of the skill beside this module, by
 * their first cell; null when the file, the heading or every row is missing.
 */
function conventionsOf() {
  let text;
  try {
    text = fs.readFileSync(CONVENTIONS_FILE, 'utf8');
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

/**
 * The convention lines for `keys`: one `convention (<key>): <row>` line per key
 * the table holds that this session has not been shown whole yet — each one it
 * prints is added to `printed` — and one `conventions in force (…)` line naming
 * the ones it has. `shown` null (no session to remember them for) prints every
 * row whole. Without a table, the one pointer line.
 */
function conventionLines(table, keys, shown = null, printed = new Set()) {
  if (table === null) return ['convention: see rules'];
  const present = keys.filter(key => table.has(key));
  const named = shown === null ? [] : present.filter(key => shown.has(key));
  const whole = present.filter(key => !named.includes(key));
  for (const key of whole) printed.add(key);
  return [
    ...(named.length ? [`${IN_FORCE} (${named.join(', ')}): ${IN_FORCE_TAIL}`] : []),
    ...whole.map(key => `convention (${key}): ${table.get(key)}`),
  ];
}

/** The line that names the rows a session was already shown whole. */
const IN_FORCE = 'conventions in force';
const IN_FORCE_TAIL = 'printed whole by an earlier brief of this session; follow them as printed there, or print them from rules with reference';

// ---------------------------------------------------------------------------
// interpolation (references/grammar.md § 9)
// ---------------------------------------------------------------------------

/**
 * A `with:` value with every `${…}` filled in from state. A reference that is
 * the whole string keeps its type; one inside longer text becomes text, a null
 * empty. A reference that finds nothing yields `MISSING`, printed as
 * `(not recorded yet)` wherever it stands; with a `missing` list in the
 * context, each such reference's owner and key is added to it.
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
  const found = recordedValue(reference, context);
  const parts = reference.split('.');
  if (found === MISSING && context.missing && parts.length === 3 && ['values', 'artifacts'].includes(parts[1])) {
    context.missing.push({ owner: parts[0], key: parts[2] });
  }
  return found;
}

function recordedValue(reference, context) {
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
