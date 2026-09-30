/**
 * The dashboard projection: `dashboard-data.js` as a function of state.
 *
 * **The defect this closes.** `dashboard-data.js` used to be written by hand, by
 * the prose orchestrator, at seven rewrite moments scattered through a run. A
 * file that is only ever as fresh as the last turn that remembered to rewrite it
 * is a file an operator reads as current and which is routinely hours stale:
 * every phase that ran without a rewrite moment, every turn that was
 * interrupted, and every recovery path left the dashboard describing a run that
 * had already moved on. The fix is not another rewrite moment. It is to stop treating the file as a
 * document somebody maintains and start treating it as a projection: derived
 * from the state file on **every** state write, by the writer, so no turn
 * *between* phases can forget it. The projection is the file's only writer: the
 * implementation and verification phase interiors run for hours under a skill
 * rather than under the engine, and those two skills keep the file current by
 * writing state — the empty patch after each wave, the verification cycle's
 * record after each cycle — never by writing the file.
 *
 * **Write-strict** (ADR-0006 § A2). The output is exactly one statement —
 * `window.MAISTER_DATA = <strict JSON>;` — with double-quoted keys, no banner
 * comment, no trailing content and one trailing newline. A viewer that has to
 * tolerate a second shape is a viewer with a parser in it, and the two dashboard
 * readers (the shipped `dashboard.html` and the cockpit) both poll this file on a
 * timer. Absence is never an error: a field whose source is missing takes its A2
 * default — `null`, `[]` or `{}` — and the projection still publishes.
 *
 * **Pure, and the caller writes.** Nothing here imports `node:fs` and nothing
 * here reads a clock: `now` arrives as an argument, hoisted by `state.mjs` out of
 * the same `canonical.stamp()` the state write itself carries, so a write and its
 * projection agree to the second. Every export is a total function of its
 * arguments, following `diagram.mjs`'s `render(resolved)`. That is what makes the
 * output golden-file testable (ADR-0011) — same state, same bytes, on every
 * platform and at every hour — and it is why this module is separate from the
 * writer that publishes it rather than a section of it: `state.mjs` imports this
 * file, so this file can import nothing of `state.mjs`, exactly the reason
 * `gate-index.mjs` is its own module.
 *
 * Every map keyed from a file this module did not write — node ids, gate ids,
 * icon entries — is built with `Object.create(null)` and read with
 * `Object.hasOwn`. A state file takes arbitrary JSON through the writer, so
 * `__proto__` and `constructor` are reachable keys, and a bracket read against an
 * ordinary object literal answers from the prototype rather than from the file.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import { ICON_HINTS, titleOf } from './display.mjs';

// ---------------------------------------------------------------------------
// the frozen vocabularies
// ---------------------------------------------------------------------------

/**
 * The seven icon hints a viewer can draw, and the title fallback.
 *
 * Both come from `display.mjs`, the one module every reader that shows a node to
 * a person shares, so the validator, this projection and the gate brief refuse,
 * filter and name nodes from one list and one rule. `display.mjs` imports
 * nothing, so reading it here opens no cycle. `dashboard.html`'s `ICONS` map is
 * still a twin of the list, character for character: the viewer is a static page
 * and imports nothing at all.
 */
export { ICON_HINTS } from './display.mjs';

/**
 * The executor node ids to fall back on when the definition cannot be read.
 *
 * The ids of the three shipped executor nodes (`development.yml` and
 * `performance.yml` name it `implementation`, `migration.yml` names it
 * `execution`; `research.yml` has none). **This is the fallback and never the
 * primary route**, because a frozen list silently excludes every pro, ejected or
 * workspace definition whose executor node is named otherwise — and state alone
 * cannot supply the id, since `NODE_KEYS` does not keep `uses`. So the id is
 * derived from the definition in hand wherever the definition can be read, and
 * this list only covers the case where it cannot.
 */
export const EXECUTOR_FALLBACK = ['implementation', 'execution'];

/** The target whose `uses` marks the node that runs the implementation plan. */
const EXECUTOR_USES = 'skill:implementation-plan-executor';

/**
 * The node-status mirror: eight statuses a node can carry, five a phase can.
 *
 * The same mapping `state.mjs` writes summary statuses through, and the spelling
 * is kept identical on purpose — the 8→5 reduction *is* the projection's
 * translation, so the two have to agree or a node and its phase card disagree
 * about the same moment. It is a twin rather than an import because `state.mjs`
 * imports this module and the reverse edge would close a cycle.
 *
 * `suspended` is absent from the mirror, as it is there: it never occurs in
 * terminal mode. A status with no mirror falls back to `pending` rather than
 * being emitted raw, because the viewer styles exactly these five and an unknown
 * value renders as an unstyled badge nobody can read.
 */
const STATUS_MIRROR = {
  pending: 'pending',
  running: 'in_progress',
  waiting: 'in_progress',
  completed: 'completed',
  skipped: 'skipped',
  failed: 'failed',
  stopped: 'skipped',
};

/** The mirror's default: a status this module cannot spell is not yet run. */
const STATUS_FALLBACK = 'pending';

/**
 * What a task type may be: the workflow-name charset, because a run's type is
 * the folder its workflow's name made. It is `TARGET_NAME` in `graph.mjs`,
 * spelled again here rather than imported because that module reads the
 * filesystem and this one reads nothing.
 */
const TYPE_NAME = /^[a-z][a-z0-9-]*$/;

/** The context blocks a run's `phase_summaries` can live under (A1 layer 2). */
const CONTEXT_SUFFIX = '_context';

/**
 * A2's `$defs/severity`, verbatim and in its order.
 *
 * All seven are accepted when parsing a severity prefix off a string-form issue,
 * and the reason is asymmetric: a **writer** — this projection included — only
 * ever emits `critical`, `warning` or `info`, exactly as the schema's own
 * description says. The four legacy values are tolerated here only because the
 * input is a *state file*, which real runs wrote by hand over a long enough
 * stretch to carry them, and a reader that refused them would drop an issue that
 * verification genuinely recorded.
 */
export const SEVERITIES = Object.freeze([
  'critical',
  'warning',
  'info',
  'high',
  'medium',
  'low',
  'resolved',
]);

/** The separator a hand-written issue line puts between severity and text. */
const SEVERITY_SEPARATOR = ': ';

/** The severity a string-form issue gets when its prefix names none. */
const SEVERITY_DEFAULT = 'info';

/**
 * An issue id as verification reports number their findings — `W3`, `I10`,
 * `C-2` — followed by the rest of the line.
 */
const ISSUE_ID = /^([A-Z]{1,3}-?\d+)\s+(.+)$/s;

/** A severity word leading the rest, an optional parenthesised qualifier, then `: `. */
const ID_SEVERITY = /^([A-Za-z]+)\s*(?:\(([^)]*)\))?:\s+(.+)$/s;

/**
 * The severity an id's letter stands for when the line names none. Only the
 * three letters the reports use for the three severities a writer emits: any
 * other letter is a numbering this module cannot read, and guessing would turn
 * a numbering into a severity.
 */
const ID_LETTER_SEVERITY = { C: 'critical', W: 'warning', I: 'info' };

/** The two characteristic maps, in the order the projection prefers them. */
const CHARACTERISTIC_KEYS = [
  ['task_context', 'task_characteristics'],
  ['design_context', 'design_characteristics'],
];

// ---------------------------------------------------------------------------
// the renderer
// ---------------------------------------------------------------------------

/**
 * The whole file text for one run.
 *
 * `view` is the plain object `state.mjs` assembles — `{state, display, gates,
 * progress}` — where `state` is the parsed state document, `display` is the
 * resolved `{icons, titles}` pair `display.mjs` merges from the definition and
 * its overlays, `gates` maps a node id to its parsed request document, and
 * `progress` carries at most one entry keyed by the executor node.
 *
 * `generated` is the **first** top-level key: that is what the register's schema
 * spells and what hand-written files already carried, and the cockpit
 * lints `/generated` for a midnight value, so the caller's `now` is a measured
 * stamp rather than a formatted date.
 */
export function render(view, { now }) {
  const source = isPlainObject(view) ? view : {};
  const state = isPlainObject(source.state) ? source.state : {};
  const display = isPlainObject(source.display) ? source.display : {};
  const icons = isPlainObject(display.icons) ? display.icons : {};
  const titles = isPlainObject(display.titles) ? display.titles : {};
  const gates = isPlainObject(source.gates) ? source.gates : {};
  const progress = isPlainObject(source.progress) ? source.progress : {};

  const data = {
    generated: now,
    task: taskOf(state),
    characteristics: characteristicsOf(state),
    phases: phasesOf(state, icons, titles, gates, progress),
    verification: verificationOf(state),
  };
  return `window.MAISTER_DATA = ${JSON.stringify(data, null, 1)};\n`;
}

/**
 * The header block.
 *
 * `current_activity` is **always null**, and that is a rule rather than this
 * run's accident: the register documents the field as a present-continuous
 * activity line, which state cannot honestly supply, and the viewer already owns
 * the fallback — `t.current_activity || (running ? running.name : null)` — so the
 * header reads "Now: implementation", the running node's own name. Emitting a
 * guess there would be the one field in the file nothing on disk backs.
 */
function taskOf(state) {
  const task = isPlainObject(state.task) ? state.task : {};
  const orchestrator = isPlainObject(state.orchestrator) ? state.orchestrator : {};
  const workflow = isPlainObject(state.workflow) ? state.workflow : {};
  const taskPath = scalar(orchestrator.task_path);
  return {
    title: typeof task.title === 'string' ? task.title : '',
    type: typeOf(taskPath, workflow.name),
    status: scalar(task.status),
    description: scalar(task.description),
    path: taskPath,
    current_activity: null,
  };
}

/**
 * The `<type>` segment of `.maister/tasks/<type>/<date-name>`, then the workflow
 * name, then `development` — each emitted as it is.
 *
 * The path segment is authoritative because it is where the run lives and what
 * the viewer's `HERO_MAP` is keyed by; the workflow name is the fallback for a
 * run whose `task_path` is absent or spelled some other way. Neither is coerced:
 * a workflow the project defines is its own type, and the viewer draws no hero
 * cards for a type it has no map for. Projecting such a run as `development`
 * drew that workflow's three cards, forever "not produced yet", for a run that
 * produces none of them. `development` is only the last resort for a run with
 * no type at all, which still has to render.
 */
function typeOf(taskPath, name) {
  if (typeof taskPath === 'string') {
    const segments = taskPath.split('/').filter(segment => segment !== '');
    const index = segments.lastIndexOf('tasks');
    const segment = index >= 0 ? segments[index + 1] : undefined;
    if (typeof segment === 'string' && TYPE_NAME.test(segment)) return segment;
  }
  if (typeof name === 'string' && TYPE_NAME.test(name)) return name;
  return 'development';
}

/**
 * `task_context.task_characteristics`, else `design_context.design_characteristics`.
 *
 * **Never merged.** The two belong to different workflows and a run carries one
 * context block, so a merge could only ever combine one run's characteristics
 * with another's leftovers.
 */
function characteristicsOf(state) {
  for (const [block, key] of CHARACTERISTIC_KEYS) {
    const context = isPlainObject(state[block]) ? state[block] : null;
    if (context && isPlainObject(context[key])) return context[key];
  }
  return {};
}

/**
 * One card per node, in the key order `workflow.nodes` carries.
 *
 * That order is the frozen topological order `resolve` produced at freeze time.
 * It is never sorted and never re-derived: a second ordering rule beside the
 * resolver's is a second thing to keep in step, and the two would drift.
 */
function phasesOf(state, icons, titles, gates, progress) {
  const workflow = isPlainObject(state.workflow) ? state.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const summaries = summarySources(state);

  return Object.keys(nodes).map(id => {
    const node = isPlainObject(nodes[id]) ? nodes[id] : {};
    const summary = pick(summaries, id);
    const status = Object.hasOwn(STATUS_MIRROR, node.status) ? STATUS_MIRROR[node.status] : STATUS_FALLBACK;
    const text = typeof summary.summary === 'string' && summary.summary !== '' ? summary.summary : null;

    // `id` is what every machine reads — gate files, state, the viewer's own
    // keys — and stays the node id. `name` is what a person reads: the
    // definition's title, else the id made readable.
    const phase = { id, name: titleOf(titles, id) };
    // Omitted rather than defaulted, so the fallback glyph lives in exactly one
    // place — the viewer — and a definition that carries no hint for a node is
    // distinguishable from one that hints `plan`.
    if (Object.hasOwn(icons, id) && ICON_HINTS.includes(icons[id])) phase.icon_hint = icons[id];
    phase.status = status;
    // Additive, and only on a node a revise has reset: the attempt this one is
    // on. An absent key is a node on its first attempt, which is every node of
    // a run nobody sent back.
    const attempt = Number(node.attempt);
    if (Number.isInteger(attempt) && attempt > 1) phase.attempt = attempt;
    phase.started = scalar(node.started);
    phase.completed = scalar(node.completed);
    // State has no dedicated key: a skipped node's reason is written into its
    // summary, which is the obligation the prose path already carried.
    phase.skip_reason = status === 'skipped' ? text : null;
    phase.summary = text;
    phase.decisions = list(summary.decisions).map(decisionOf).filter((d) => d !== null);
    phase.risks = list(summary.risks);
    phase.artifacts = list(summary.artifacts).map(artifactOf).filter((a) => a !== null);
    phase.gate = Object.hasOwn(gates, id) ? gateCard(gates[id]) : null;
    // Additive and optional everywhere: a run with no plan on disk carries no
    // `progress` key at all rather than an empty one.
    if (Object.hasOwn(progress, id) && isPlainObject(progress[id])) phase.progress = progress[id];
    return phase;
  });
}

/**
 * The two places a phase's prose lives, node-first, field by field.
 *
 * `node_summaries.<id>` is consulted first because `phases[].id` **is** the node
 * id; `<something>_context.phase_summaries.<key>` is the fallback, and only where
 * `key === id`. The prose path's key-to-node mapping table is deliberately not
 * carried into code: it existed so a human could line the two up by eye, and a
 * projection that guessed at it would attribute one phase's decisions to another.
 *
 * The choice is made **per field** — `summary`, `decisions`, `risks`,
 * `artifacts` each come from the first source that carries them filled — and
 * **the two are never merged**: a field filled on both is the node summary's
 * alone. Taking the first entry whole instead let a node summary written with
 * empty lists hide the decisions and artifacts its phase summary recorded, and
 * an empty list is what a closing write sends when the node prose names the
 * phase key as the place for them.
 *
 * The context block is found by suffix rather than against a frozen list of five
 * names, so a run using a block this module has never heard of still projects,
 * and the list of blocks does not have to be kept in step with the writer's.
 */
function summarySources(state) {
  const sources = [isPlainObject(state.node_summaries) ? state.node_summaries : null];
  for (const key of Object.keys(state)) {
    if (!key.endsWith(CONTEXT_SUFFIX)) continue;
    const block = state[key];
    if (!isPlainObject(block) || !isPlainObject(block.phase_summaries)) continue;
    sources.push(block.phase_summaries);
  }
  return sources.filter(source => source !== null);
}

/** The fields a phase card takes from a summary, each chosen on its own. */
const SUMMARY_FIELDS = ['summary', 'decisions', 'risks', 'artifacts'];

/**
 * A phase's summary as a map of the fields in `SUMMARY_FIELDS`, each from the
 * first source carrying it filled — a non-empty string or a non-empty list; `{}`
 * when no source does.
 */
function pick(sources, id) {
  const entries = sources
    .filter(source => Object.hasOwn(source, id) && isPlainObject(source[id]))
    .map(source => source[id]);
  const picked = {};
  for (const field of SUMMARY_FIELDS) {
    const entry = entries.find(candidate => filled(candidate[field]));
    if (entry) picked[field] = entry[field];
  }
  return picked;
}

function filled(value) {
  return (typeof value === 'string' && value !== '') || (Array.isArray(value) && value.length > 0);
}

/**
 * The gate card for one request document: `{question, answer}` and nothing else.
 *
 * No status key is invented. The register admits these two members only, and
 * `answer: null` is already what pending looks like — a third key saying the
 * same thing would be a second place for the two to disagree.
 *
 * The answer is the chosen option's **label**, because the card is read by a
 * person and an option id is not prose. A value matching no option is carried
 * through raw rather than dropped: an answer the projection cannot explain is
 * still an answer that was given. A multi-choice request carries a sequence
 * there, which is the same code path with more than one element.
 */
export function gateCard(requestDoc) {
  if (!isPlainObject(requestDoc)) return null;
  const question = typeof requestDoc.question === 'string' ? requestDoc.question : null;
  const options = Array.isArray(requestDoc.options) ? requestDoc.options : [];
  const answer = isPlainObject(requestDoc.answer) ? requestDoc.answer : null;
  const chosen = answer === null ? null : answer.option;
  if (chosen === null || chosen === undefined) return { question, answer: null };
  const labels = (Array.isArray(chosen) ? chosen : [chosen]).map(value => labelOf(options, value));
  return { question, answer: labels.join(', ') };
}

/** One option value as its label, or as itself when no option claims it. */
function labelOf(options, value) {
  for (const option of options) {
    if (!isPlainObject(option) || option.id !== value) continue;
    if (typeof option.label === 'string' && option.label !== '') return option.label;
    break;
  }
  return String(value);
}

/**
 * One entry of a phase's `artifacts` as an A2 artifact reference, or `null` to
 * drop it.
 *
 * The same defect `issueOf` closes for `issues_found`, in the field nobody
 * re-checked: A2's `$defs/artifact_ref` is an object with a **required** `path`,
 * and state files record an artifact as a bare path string. Copied verbatim,
 * each of those publishes an invalid document and the shipped viewer reads `a.path` and `a.label` unguarded, so the drawer renders
 * `<a href="undefined">undefined</a>`; worse, the hero lookup requires `a.path`,
 * so the hero card reports "not produced yet" for a file that exists on disk.
 *
 * - An **object** passes through unchanged. Whatever `label` and `html` it
 *   carries are what the phase recorded, and both are nullable in A2.
 * - A **string** becomes `{path, label: null, html: null}`. A bare string in
 *   this field *is* a path — that is the only thing it has ever meant — and the
 *   two optional fields take their A2 defaults rather than a guess derived from
 *   the path.
 * - **Anything else** — number, boolean, `null`, array — is dropped: it names no
 *   file, so there is nothing to link and nothing A2 would accept.
 */
export function artifactOf(entry) {
  if (isPlainObject(entry)) return entry;
  if (typeof entry !== 'string') return null;
  return { path: entry, label: null, html: null };
}

/**
 * One entry of a phase's `decisions` as an A2 decision item, or `null` to drop it.
 *
 * A2 freezes three shapes — a bare string, the writer form carrying `decision`
 * with an optional `rationale`, and the question/answer form the development
 * workflow writes into its clarifications key — and state files carry a
 * **fourth**: every driven run records a gate answer as
 * `{option, answered_by, at}`. It matches no frozen
 * shape, and the viewer reads `x.decision || x`, so a gate answer renders as the
 * literal text `[object Object]` in both the phase drawer and the decisions
 * panel.
 *
 * - A **string** and an object already in one of the three frozen shapes pass
 *   through unchanged.
 * - The **gate-answer form** gains a `decision` key holding its `option`, and
 *   keeps every field it arrived with: `$defs/decision_item` closes no object,
 *   and `answered_by` and `at` are the record of who answered and when.
 * - **Anything else** is dropped, for the reason `issueOf` drops a bare count —
 *   an entry with no decision text in it has nothing to render.
 */
export function decisionOf(entry) {
  if (typeof entry === 'string') return entry;
  if (!isPlainObject(entry)) return null;
  if (Object.hasOwn(entry, 'decision')) return entry;
  if (Object.hasOwn(entry, 'question') && Object.hasOwn(entry, 'answer')) return entry;
  if (typeof entry.option === 'string') return { decision: entry.option, ...entry };
  return null;
}

/**
 * One entry of `issues_found` as an A2 issue object, or `null` to drop it.
 *
 * `issues_found` carries three shapes in real state files, and A2's
 * `$defs/issue` is `type: object`, so copying the list verbatim publishes an
 * invalid document — silently, twice over: the schema refuses it, and the shipped
 * viewer reads `i.severity` and `i.description` unguarded, so a non-object
 * renders as a blank row with an `info` badge and the issue list quietly empties.
 *
 * - An **object** passes through unchanged, its original `severity` included:
 *   the panel's job is to show what verification recorded, not a re-typed
 *   summary of it.
 * - A **string** becomes `{severity, description}`. The prefix before the first
 *   `": "` is a severity only when it names one of `SEVERITIES`, matched without
 *   case; otherwise the severity is `info` and the description is the **entire**
 *   original string. Not stripping an unrecognised prefix is the whole point:
 *   `"e2e minor: the focus comment …"` has `e2e minor` as content, and a reader
 *   that guessed it was a severity would delete text an operator needs.
 * - A string that opens with an **issue id** — `"W3 no files allow-list"`,
 *   `"W5 warning (accepted by operator): …"`, `"I10 info: …"`, which is how runs
 *   wrote the issues left open after verification — becomes `{id, severity,
 *   description}`. A severity word after the id wins, and a parenthesised
 *   qualifier beside it moves to the end of the description rather than being
 *   dropped. With no severity word, the id's letter decides for `C`, `W` and `I`
 *   (`ID_LETTER_SEVERITY`), and any other id is `info`. The id is kept as a
 *   field, so no text is lost.
 * - **Anything else** — number, boolean, `null`, array — is dropped. A bare
 *   count such as `issues_found: 9` carries no issue content, so there is
 *   nothing to render and nothing A2 would accept.
 *
 * `$defs/issue` declares no `required`, so `{severity, description}` alone is a
 * complete issue.
 */
export function issueOf(entry) {
  if (isPlainObject(entry)) return entry;
  if (typeof entry !== 'string') return null;
  const numbered = ISSUE_ID.exec(entry);
  if (numbered) return numberedIssue(numbered[1], numbered[2]);
  const cut = entry.indexOf(SEVERITY_SEPARATOR);
  if (cut > 0) {
    const prefix = entry.slice(0, cut).toLowerCase();
    if (SEVERITIES.includes(prefix)) {
      return { severity: prefix, description: entry.slice(cut + SEVERITY_SEPARATOR.length) };
    }
  }
  return { severity: SEVERITY_DEFAULT, description: entry };
}

/** A string-form issue that opened with an id, as `{id, severity, description}`. */
function numberedIssue(id, rest) {
  const worded = ID_SEVERITY.exec(rest);
  if (worded && SEVERITIES.includes(worded[1].toLowerCase())) {
    const qualifier = worded[2] === undefined ? '' : worded[2].trim();
    const description = qualifier === '' ? worded[3] : `${worded[3]} (${qualifier})`;
    return { id, severity: worded[1].toLowerCase(), description };
  }
  const letter = id[0];
  const severity = Object.hasOwn(ID_LETTER_SEVERITY, letter) ? ID_LETTER_SEVERITY[letter] : SEVERITY_DEFAULT;
  return { id, severity, description: rest };
}

/**
 * The verification panel, straight off `verification_context`.
 *
 * `fixes` passes through verbatim — A2 types a fix as `["string", "object"]`, and
 * the viewer guards it for both — while `issues` is normalized by `issueOf`,
 * because A2 types an issue as an object and the viewer does not guard it.
 */
function verificationOf(state) {
  const context = isPlainObject(state.verification_context) ? state.verification_context : {};
  const count = context.reverify_count;
  return {
    status: scalar(context.last_status),
    issues: list(context.issues_found).map(issueOf).filter((issue) => issue !== null),
    fixes: list(context.fixes_applied),
    reverify_count: typeof count === 'number' && Number.isFinite(count) ? count : 0,
  };
}

// ---------------------------------------------------------------------------
// reading the definition
// ---------------------------------------------------------------------------

/**
 * The node that runs the implementation plan, or null.
 *
 * Read off the definition already in hand, which does carry
 * `nodes.<id>.uses` — so a pro, ejected or workspace definition whose executor
 * node is named anything at all is found, and `EXECUTOR_FALLBACK` is needed only
 * when no definition could be read.
 */
export function executorNodeOf(definitionDoc) {
  if (!isPlainObject(definitionDoc) || !isPlainObject(definitionDoc.nodes)) return null;
  for (const [id, node] of Object.entries(definitionDoc.nodes)) {
    if (isPlainObject(node) && node.uses === EXECUTOR_USES) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// the plan and work-log contracts
// ---------------------------------------------------------------------------

// The three plan patterns are exported because the plan companion's sync
// (`plan-sync.mjs`) must call a group done by exactly the rule the dashboard
// counts it by — two readers of one plan that disagreed would show the operator
// two different progress figures for the same run.

/**
 * A task group's heading, and the number that labels it.
 *
 * Matches `### Task Group 6: Progress derivation` — the shape
 * `implementation-planner.md` writes and the executor reads back. It does not
 * match `#### Task Group 6:` or a mention of the phrase mid-sentence, because
 * the count of these headings **is** `groups_total` and a prose reference to a
 * group is not a group.
 */
export const GROUP_HEADING = /^### Task Group (\d+):/gm;

/**
 * Any `### ` heading, which is where a group's section ends.
 *
 * A group runs from its own heading to the next one of these or to EOF, so the
 * `### Checks` and `### Acceptance Criteria` headings real plans carry inside a
 * group close that group's section as surely as the next group's heading does.
 * That is deliberate: those sections hold numbered lists and bullets, not step
 * checkboxes, and counting them as steps would make every group unfinished.
 */
export const SECTION_HEADING = /^### /gm;

/**
 * One step checkbox and its mark.
 *
 * Matches `- [ ] 6.1 Implement …`, `  - [x] 6.2 …` and `  - [~] 6.3 SKIPPED: …`
 * at any indent, which is what the plan's two nesting levels need. The mark is
 * captured because the done test is over marks: a section is done when it holds
 * at least one checkbox and none of them is the empty one — the executor's own
 * completion test, "no `- [ ]` checkboxes remain".
 */
export const CHECKBOX = /^[ \t]*-\s\[([ x~])\]/gm;

/**
 * A skipped step, with its group number and its reason.
 *
 * Matches `- [~] 6.1 SKIPPED: no test harness on this platform`, the form the
 * executor writes for a skipped step. The group number comes from the step's own
 * `N.M` label rather than from the enclosing section, because the label is what
 * the roll-up keys by and a step is never labelled out of its group.
 */
const SKIPPED_STEP = /^[ \t]*-\s\[~\]\s*(\d+)\.\d+\s+SKIPPED:\s*(.+)$/gm;

/**
 * A work-log entry announcing a group's wave.
 *
 * Case-insensitive, and the closing paren is deliberately **not** required right
 * after the digits: real logs carry `## 2026-09-20 14:02 - Group 3 Complete
 * (wave 2, parallel with Group 2)` and `## … - Group 1 Complete (Wave 1)`, and
 * both are the same announcement. The last match in the file wins, because the
 * log is append-only and the current wave is the most recent one named.
 * Headings this cannot account for — `## … Group 1 attempt 1 aborted
 * (infrastructure)` — are simply not matches, never errors.
 */
const WAVE_HEADING = /^##\s.*\bGroup \d+ (?:Complete|Reverted) \(wave\s*(\d+)/gim;

/**
 * A work-log entry announcing a reverted group, with its reason.
 *
 * Matches `## 2026-09-20 15:10 - Group 4 Reverted (wave 3): migration left the
 * schema half-applied` — the entry the executor skill writes from its
 * "Rollback changes" recovery option. The reason is required here: an entry
 * with no reason is prose about a revert rather than the record of one.
 */
const REVERT_HEADING = /^##\s.*\bGroup (\d+) Reverted \(wave\s*\d+\):\s*(.+)$/gim;

/** How a group-level note is labelled for the viewer, which renders it verbatim. */
const GROUP_LABEL = (group, reason) => `Group ${group} — ${reason}`;

/**
 * The executor phase's interior progress, from the plan and the work log.
 *
 * `null` on **plan-side doubt only** — no `### Task Group N:` heading anywhere,
 * or a group section carrying no checkbox — and `project` then omits the
 * `progress` key entirely rather than publishing a count nobody can stand
 * behind. A guess there is worse than an absence: this file's whole purpose is
 * to stop looking plausible the moment it is not current.
 *
 * The work-log side is the opposite bargain. Only two of its headings are a
 * contract and the rest are free prose, so real logs are full of forms no regex can
 * account for, and treating an unaccountable heading as fatal would blank the
 * group counts — which are perfectly sound — over a line that only ever carried
 * a wave number. An unmatched log therefore yields `current_wave: null` and
 * `reverted: []` beside valid counts.
 *
 * Both arguments are text, never paths: nothing here reads a file, so the whole
 * derivation is a total function of two strings and golden-file testable.
 * `progress` survives the phase completing, with `groups_done ==
 * groups_total` — a finished phase that goes blank reads as one that never ran.
 */
export function deriveProgress(planText, logText) {
  const plan = typeof planText === 'string' ? planText : '';
  const log = typeof logText === 'string' ? logText : '';

  const headings = [...plan.matchAll(GROUP_HEADING)];
  if (headings.length === 0) return null;

  // Every `### ` in the file, so a section's end is a lookup rather than a
  // second scan per group.
  const boundaries = [...plan.matchAll(SECTION_HEADING)].map(match => match.index);

  let done = 0;
  for (const heading of headings) {
    const start = heading.index;
    const end = boundaries.find(index => index > start) ?? plan.length;
    const marks = [...plan.slice(start, end).matchAll(CHECKBOX)].map(match => match[1]);
    if (marks.length === 0) return null;
    if (marks.every(mark => mark !== ' ')) done += 1;
  }

  // Insertion order is document order, and the first skipped step in a group is
  // the one whose reason labels that group.
  const reasons = new Map();
  for (const step of plan.matchAll(SKIPPED_STEP)) {
    if (!reasons.has(step[1])) reasons.set(step[1], step[2].trim());
  }

  const waves = [...log.matchAll(WAVE_HEADING)];
  const last = waves.length === 0 ? null : waves[waves.length - 1][1];

  return {
    groups_done: done,
    groups_total: headings.length,
    current_wave: last === null ? null : Number(last),
    skipped: [...reasons].map(([group, reason]) => GROUP_LABEL(group, reason)),
    reverted: [...log.matchAll(REVERT_HEADING)].map(entry => GROUP_LABEL(entry[1], entry[2].trim())),
  };
}

// ---------------------------------------------------------------------------
// shared predicates
// ---------------------------------------------------------------------------

/** A scalar the file may simply not carry: `null` is the A2 default, not an error. */
function scalar(value) {
  if (value === undefined || value === null) return null;
  return value;
}

/** A sequence the file may simply not carry, copied by reference and verbatim. */
function list(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
