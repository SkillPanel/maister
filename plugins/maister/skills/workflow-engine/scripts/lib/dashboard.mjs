/**
 * The dashboard projection: `dashboard-data.js` as a function of state.
 *
 * **The defect this closes.** `dashboard-data.js` used to be written by hand, by
 * the prose orchestrator, at seven rewrite moments scattered through a run —
 * `performance.md:116-123` states the mechanism outright. A file that is only
 * ever as fresh as the last turn that remembered to rewrite it is a file an
 * operator reads as current and which is routinely hours stale: every phase that
 * ran without a rewrite moment, every turn that was interrupted, and every
 * recovery path left the dashboard describing a run that had already moved on.
 * The fix is not another rewrite moment. It is to stop treating the file as a
 * document somebody maintains and start treating it as a projection: derived
 * from the state file on **every** state write, by the writer, so no turn
 * *between* phases can forget it. Three moments remain prose obligations, and
 * deliberately: the implementation and verification phase interiors run for
 * hours under a skill rather than under the engine, and those two skills refresh
 * the file from inside them (§ 8 moments 8-10).
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

// ---------------------------------------------------------------------------
// the frozen vocabularies
// ---------------------------------------------------------------------------

/**
 * The seven icon hints a viewer can draw.
 *
 * A deliberate twin of `graph.mjs`'s `ICON_HINTS` and of `dashboard.html`'s
 * `ICONS` map: the validator refuses a definition carrying anything else, and
 * this module filters anything else out, so an eighth value cannot reach a
 * viewer from either direction. It is a copy rather than an import for the same
 * reason `state.mjs`'s `NODE_ID` is a copy of the graph's — the two sources sit
 * on opposite sides of an import that must not become a cycle — and like that
 * pair the three lists are kept character-for-character identical on purpose.
 */
export const ICON_HINTS = ['analysis', 'spec', 'plan', 'code', 'verify', 'docs', 'done'];

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
 * The task types the viewer's `HERO_MAP` is keyed by.
 *
 * The type comes from the `<type>` path segment rather than from
 * `workflow.name`, because that segment is what `HERO_MAP` looks up and a run
 * whose workflow is named otherwise would light up no hero cards at all.
 */
const TASK_TYPES = ['development', 'performance', 'migration', 'research', 'product-design', 'plan'];

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
const SEVERITIES = Object.freeze([
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
 * progress}` — where `state` is the parsed state document, `display` maps a node
 * id to an icon hint, `gates` maps a node id to its parsed request document, and
 * `progress` carries at most one entry keyed by the executor node.
 *
 * `generated` is the **first** top-level key: that is what the register's schema
 * spells and what 10 of 12 sampled corpus files already carry, and the cockpit
 * lints `/generated` for a midnight value, so the caller's `now` is a measured
 * stamp rather than a formatted date.
 */
export function render(view, { now }) {
  const source = isPlainObject(view) ? view : {};
  const state = isPlainObject(source.state) ? source.state : {};
  const display = isPlainObject(source.display) ? source.display : {};
  const gates = isPlainObject(source.gates) ? source.gates : {};
  const progress = isPlainObject(source.progress) ? source.progress : {};

  const data = {
    generated: now,
    task: taskOf(state),
    characteristics: characteristicsOf(state),
    phases: phasesOf(state, display, gates, progress),
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
 * name, then `development`.
 *
 * The path segment is authoritative because the viewer's `HERO_MAP` is keyed by
 * it; the workflow name is the fallback for a run whose `task_path` is absent or
 * spelled some other way, and `development` is the last resort because a run with
 * no type at all still has to render.
 */
function typeOf(taskPath, name) {
  if (typeof taskPath === 'string') {
    const segments = taskPath.split('/').filter(segment => segment !== '');
    const index = segments.lastIndexOf('tasks');
    const segment = index >= 0 ? segments[index + 1] : undefined;
    if (TASK_TYPES.includes(segment)) return segment;
  }
  if (typeof name === 'string' && TASK_TYPES.includes(name)) return name;
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
function phasesOf(state, display, gates, progress) {
  const workflow = isPlainObject(state.workflow) ? state.workflow : {};
  const nodes = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const summaries = summarySources(state);

  return Object.keys(nodes).map(id => {
    const node = isPlainObject(nodes[id]) ? nodes[id] : {};
    const summary = pick(summaries, id);
    const status = Object.hasOwn(STATUS_MIRROR, node.status) ? STATUS_MIRROR[node.status] : STATUS_FALLBACK;
    const text = typeof summary.summary === 'string' && summary.summary !== '' ? summary.summary : null;

    const phase = { id, name: id };
    // Omitted rather than defaulted, so the fallback glyph lives in exactly one
    // place — the viewer — and a definition that carries no hint for a node is
    // distinguishable from one that hints `plan`.
    if (Object.hasOwn(display, id) && ICON_HINTS.includes(display[id])) phase.icon_hint = display[id];
    phase.status = status;
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
 * The two places a phase's prose lives, node-first.
 *
 * `node_summaries.<id>` is consulted first because `phases[].id` **is** the node
 * id; `<something>_context.phase_summaries.<key>` is the fallback, and only where
 * `key === id`. The prose path's key-to-node mapping table is deliberately not
 * carried into code: it existed so a human could line the two up by eye, and a
 * projection that guessed at it would attribute one phase's decisions to another.
 * **The two are never merged** — whichever answers first answers whole.
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

/** The first source carrying an entry for `id`, as a map; `{}` when none does. */
function pick(sources, id) {
  for (const source of sources) {
    if (Object.hasOwn(source, id) && isPlainObject(source[id])) return source[id];
  }
  return {};
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
 * and the corpus records an artifact as a bare path string 15 times across 5
 * files. Copied verbatim, each of those publishes an invalid document and the
 * shipped viewer reads `a.path` and `a.label` unguarded, so the drawer renders
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
function artifactOf(entry) {
  if (isPlainObject(entry)) return entry;
  if (typeof entry !== 'string') return null;
  return { path: entry, label: null, html: null };
}

/**
 * One entry of a phase's `decisions` as an A2 decision item, or `null` to drop it.
 *
 * A2 freezes three shapes — a bare string, the writer form carrying `decision`
 * with an optional `rationale`, and the question/answer form the development
 * workflow writes into its clarifications key — and the corpus carries a
 * **fourth**: every driven run records a gate answer as
 * `{option, answered_by, at}`, 14 entries across 6 files. It matches no frozen
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
function decisionOf(entry) {
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
 * `issues_found` carries three shapes across the real corpus, and A2's
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
 * - **Anything else** — number, boolean, `null`, array — is dropped. A bare
 *   count such as `issues_found: 9` carries no issue content, so there is
 *   nothing to render and nothing A2 would accept.
 *
 * `$defs/issue` declares no `required`, so `{severity, description}` alone is a
 * complete issue.
 */
function issueOf(entry) {
  if (isPlainObject(entry)) return entry;
  if (typeof entry !== 'string') return null;
  const cut = entry.indexOf(SEVERITY_SEPARATOR);
  if (cut > 0) {
    const prefix = entry.slice(0, cut).toLowerCase();
    if (SEVERITIES.includes(prefix)) {
      return { severity: prefix, description: entry.slice(cut + SEVERITY_SEPARATOR.length) };
    }
  }
  return { severity: SEVERITY_DEFAULT, description: entry };
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
 * `display.icons` from a workflow definition, filtered to the seven.
 *
 * `{}` for a definition that is absent, malformed or carries no block, which the
 * viewer renders as its own fallback glyph for every phase. The filter is here as
 * well as in the validator on purpose: the validator guards what an author writes
 * and this guards what a viewer is handed, and an ejected or hand-edited
 * definition passes through only one of the two.
 */
export function iconsOf(definitionDoc) {
  const icons = Object.create(null);
  if (!isPlainObject(definitionDoc)) return icons;
  const block = definitionDoc.display;
  if (!isPlainObject(block) || !isPlainObject(block.icons)) return icons;
  for (const [id, hint] of Object.entries(block.icons)) {
    if (typeof hint === 'string' && ICON_HINTS.includes(hint)) icons[id] = hint;
  }
  return icons;
}

/**
 * The node that runs the implementation plan, or null.
 *
 * Read off the definition already in hand for `display`, which does carry
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

/**
 * A task group's heading, and the number that labels it.
 *
 * Matches `### Task Group 6: Progress derivation` — the shape
 * `implementation-planner.md` writes and the executor reads back. It does not
 * match `#### Task Group 6:` or a mention of the phrase mid-sentence, because
 * the count of these headings **is** `groups_total` and a prose reference to a
 * group is not a group.
 */
const GROUP_HEADING = /^### Task Group (\d+):/gm;

/**
 * Any `### ` heading, which is where a group's section ends.
 *
 * A group runs from its own heading to the next one of these or to EOF, so the
 * `### Checks` and `### Acceptance Criteria` headings real plans carry inside a
 * group close that group's section as surely as the next group's heading does.
 * That is deliberate: those sections hold numbered lists and bullets, not step
 * checkboxes, and counting them as steps would make every group unfinished.
 */
const SECTION_HEADING = /^### /gm;

/**
 * One step checkbox and its mark.
 *
 * Matches `- [ ] 6.1 Implement …`, `  - [x] 6.2 …` and `  - [~] 6.3 SKIPPED: …`
 * at any indent, which is what the plan's two nesting levels need. The mark is
 * captured because the done test is over marks: a section is done when it holds
 * at least one checkbox and none of them is the empty one — the executor's own
 * completion test, "no `- [ ]` checkboxes remain".
 */
const CHECKBOX = /^[ \t]*-\s\[([ x~])\]/gm;

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
 * schema half-applied` — the entry § 3.8 adds to the executor skill and wires to
 * its "Rollback changes" recovery option. Before that template existed nothing
 * on disk carried a revert, which is why the reason is required here: an entry
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
 * The work-log side is the opposite bargain. Its headings were free prose until
 * § 3.8 made two of them a contract, so real logs are full of forms no regex can
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
