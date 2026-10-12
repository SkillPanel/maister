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
 * What it reads. The state file; the definition the run froze, re-read and
 * re-resolved through `gate-brief`'s `reread`; its overlays and profile; the
 * guide beside the file a node comes from — the base definition's, or the
 * adding overlay's for a node an overlay added; and the `### Node conventions`
 * table of the `SKILL.md` beside this module, found from its own location so a
 * generated variant reads its own copy.
 *
 * What it does not do. It writes nothing — no state, no dashboard, no
 * `display/` file — and returns `{ok, text, errors, warnings}`.
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
 * - `node-brief-conventions-unread` — the conventions table cannot be read;
 *   one `convention: see rules` line stands for its rows.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, isPlainObject } from './state-read.mjs';
import { proseSection, sectionNameOf } from './graph.mjs';
import { closingCandidates, evaluate, reread } from './gate-brief.mjs';
import { titleOf } from './display.mjs';
import { attemptOf, companionsOfRun, htmlOutput, projectRootOf, sourcesOf } from './state.mjs';
import { owedCompanions } from './companions.mjs';
import { briefOfRun } from './brief.mjs';
import { canAsk, questionSets } from './driver.mjs';
import { HELD_APPROVAL, declaredQuestionIds } from './question-triage.mjs';

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
const NO_SECTION = 'section: none — the conventions above apply';
const UNKNOWN_SECTION = 'section: unknown — the definition this run froze cannot be re-read';

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
    runDir,
    root: projectRootOf(runDir),
    recorded,
    byId,
    inputs: inputsOf(doc),
    defaults: current.defaults,
    status: new Map(Object.keys(recorded).filter(id => id !== HELD_APPROVAL).map(id => [id, entryOf(recorded, id).status ?? 'pending'])),
  };
  const resolved = byId.get(node) ?? null;
  const entry = entryOf(recorded, node);
  const title = titleOf(current.display.titles, node);
  const gate = resolved ? resolved.type === 'gate' : entry.kind === 'gate';
  const origin = resolved ? originOf(workflow, runDir, node) : null;
  const convention = keys => conventionLines(table, keys);

  const lines = gate
    ? gateLines({ node, title, resolved, context, convention, rules })
    : stepLines({ node, title, resolved, entry, context, convention, rules, origin });
  lines.push('');
  if (resolved === null) {
    lines.push(gate ? `ask it: gate-brief --state=${path.resolve(state)} --node=${node}` : UNKNOWN_SECTION);
  } else {
    const section = origin === null ? null : proseSection(origin, sectionNameOf(resolved));
    if (gate) {
      const text = section === null ? '' : sliced(section.text);
      lines.push(/^\*\*Exception\.\*\*/m.test(text) ? text : `ask it: gate-brief --state=${path.resolve(state)} --node=${node}`);
    } else {
      lines.push(section === null ? NO_SECTION : sliced(section.text));
    }
  }
  return { ok: true, text: `${lines.join('\n')}\n`, errors: [], warnings };
}

function refuse(code, message) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
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

function stepLines({ node, title, resolved, entry, context, convention, rules, origin }) {
  const uses = typeof resolved?.uses === 'string' ? resolved.uses : null;
  const scheme = uses ? uses.slice(0, uses.indexOf(':')) : String(entry.kind ?? '');
  const known = SCHEMES[scheme] ?? null;
  const dispatched = typeof resolved?.dir === 'string' && resolved.dir !== '';
  const how = dispatched ? `dispatched to ${resolved.dir}` : known?.how ?? 'unknown';

  const lines = [`## Node: ${node} — ${title}`, `runs: ${uses ?? scheme} — ${how}`];
  if (resolved && typeof resolved.when === 'string') lines.push(whenLine(resolved.when, context));
  lines.push(`attempt: ${attemptOf(entry)} — ${entry.status ?? 'pending'}`);
  const keys = known ? [known.row, 'every step'] : ['every step'];
  if (resolved === null) {
    lines.push(...convention(keys), `rules: ${rules}`);
    return lines;
  }

  const brief = briefOfRun(context.doc, context.runDir)?.[node] ?? {};
  const withs = isPlainObject(resolved.with) ? resolved.with : {};
  const filled = Object.fromEntries(Object.entries(withs).map(([key, value]) => [key, interpolate(value, context)]));
  if (Object.keys(filled).length) lines.push('with:', ...Object.entries(filled).map(([key, value]) => `- ${key}: ${shown(value)}`));

  const writes = writeLines(node, resolved, entry, brief, context);
  if (writes.length) lines.push('writes:', ...writes);

  const values = isPlainObject(resolved.outputs?.values) ? resolved.outputs.values : {};
  if (Object.keys(values).length) {
    lines.push(`records: ${Object.entries(values).map(([key, type]) => `${key} (${typeText(type)})`).join(', ')}`);
  }

  const asks = askLines(origin, resolved, brief, context.doc);
  if (asks.length) {
    lines.push(...asks);
    keys.push('asks');
  }

  const feeds = feedLines(node, context);
  if (feeds.length) {
    lines.push(...feeds);
    keys.push('feeds a checkpoint');
  }

  for (const [key, mapping] of Object.entries(isPlainObject(brief.recommends) ? brief.recommends : {})) {
    const value = Object.hasOwn(filled, key) ? filled[key] : MISSING;
    if (value === MISSING || value === null || value === '') {
      lines.push(`recommends: ${key} unset — the section decides`);
      continue;
    }
    const text = String(value);
    lines.push(Object.hasOwn(mapping, text)
      ? `recommends: ${key} = ${text} → ${mapping[text]}`
      : `recommends: ${key} = ${text} — the section decides`);
  }
  if (Array.isArray(brief.summary_keys) && brief.summary_keys.length) lines.push(`summary keys: ${brief.summary_keys.join(', ')}`);
  if (Number.isInteger(brief.budget)) lines.push(`budget: ${brief.budget} attempt${brief.budget === 1 ? '' : 's'} — a prose rule; nothing enforces it`);

  if (context.byId.size && [...context.byId.values()].some(each => rerunsOf(each).includes(node))) keys.push('named by a revise');
  if (Number.isInteger(brief.budget)) keys.push('has a budget');
  lines.push(...convention(keys));

  const section = origin === null ? null : proseSection(origin, sectionNameOf(resolved));
  if (section !== null) lines.push(...seeLines(section));
  lines.push(`rules: ${rules}`);
  return lines;
}

/** `when: <guard> — now <true | false | not yet decidable>`, by `gate-brief`'s rule. */
function whenLine(when, { byId, recorded, status, inputs, defaults }) {
  const read = evaluate(when, { byId, recorded, status, inputs, defaults });
  return `when: ${when} — now ${read.ok ? String(read.value) : 'not yet decidable'}`;
}

/**
 * One line per declared artifact: the path repository-root-relative, the page
 * it owes when HTML output is on, and the reason `brief:` gives when it may be
 * absent.
 */
function writeLines(node, resolved, entry, brief, context) {
  const artifacts = isPlainObject(resolved.outputs?.artifacts) ? resolved.outputs.artifacts : {};
  if (!Object.keys(artifacts).length) return [];
  const owing = htmlOutput(context.doc) ? companionsOfRun(context.doc, context.runDir) : null;
  const owed = new Map(owing ? owedCompanions(owing, node).map(each => [each.key, each.html]) : []);
  const absent = isPlainObject(brief.absent) ? brief.absent : {};
  const where = artifactBase(resolved, entry, context);
  return Object.entries(artifacts).map(([key, declared]) => {
    let line = `- ${key}: ${placed(declared, where)}`;
    if (owed.has(key)) line += ` — HTML page owed: ${placed(owed.get(key), where)}`;
    if (Object.hasOwn(absent, key)) line += ` — may be absent: ${absent[key]}`;
    return line;
  });
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
 * `asks (<driver>):` and one line per question id the node's section declares,
 * saying how this run's driver settles it.
 */
function askLines(origin, resolved, brief, doc) {
  const ids = origin === null ? [] : declaredQuestionIds(origin, sectionNameOf(resolved));
  if (!ids.length) return [];
  const defaults = isPlainObject(brief.questions) ? brief.questions : {};
  const sets = questionSets(doc);
  const asking = canAsk(doc);
  const phrase = sets ? 'question sets' : asking ? 'in session' : 'nobody can be asked';
  return [`asks (${phrase}):`, ...ids.map(id => {
    if (sets) return `- ${id}: asked in this step's question set`;
    if (asking) return `- ${id}: asked in session`;
    return `- ${id}: not asked — default: ${Object.hasOwn(defaults, id) ? defaults[id] : 'the Without line below'}`;
  })];
}

/** One `feeds:` line per gate whose closing nodes hold this one. */
function feedLines(node, { byId, recorded }) {
  const lines = [];
  for (const each of byId.values()) {
    if (each.type !== 'gate' || !closingCandidates(recorded, byId, each.id).direct.includes(node)) continue;
    const options = isPlainObject(each.options) ? Object.entries(each.options) : [];
    const continues = options.filter(([, option]) => effectOf(option) === 'continue').map(([id]) => id);
    const revises = options.filter(([, option]) => effectOf(option) === 'revise').map(([id, option]) => `${id} → ${option.reruns}`);
    lines.push(`feeds: ${each.id} — continues: ${continues.join(', ')}${revises.length ? `; revise: ${revises.join(', ')}` : ''}`);
  }
  return lines;
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
  const text = fs.readFileSync(section.companion, 'utf8');
  const shared = [];
  for (const line of text.split('\n').map(row => row.replace(/\r$/, ''))) {
    const match = /^##\s+([^`#].*?)\s*$/.exec(line);
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

/**
 * The file a node's section is found beside: the overlay that added it — the
 * last layer to add it, a profile's addition included — or the base
 * definition. Null when the sources cannot be read.
 */
function originOf(workflow, runDir, node) {
  let sources;
  try {
    sources = sourcesOf(workflow, runDir);
  } catch {
    return null;
  }
  if (sources === null || !sources.definition?.file) return null;
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
 * A section as the brief prints it: leading blank lines gone, every
 * `<!-- plain-picker` … `-->` passage dropped whole, the rich-picker marker
 * lines dropped with the text between them kept, and no run of blank lines
 * the drops left behind.
 */
function sliced(text) {
  const kept = [];
  let plain = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (plain) {
      if (trimmed.endsWith('-->')) plain = false;
      continue;
    }
    if (trimmed.startsWith('<!-- plain-picker')) {
      plain = !trimmed.endsWith('-->');
      continue;
    }
    if (trimmed === '<!-- rich-picker -->' || trimmed === '<!-- /rich-picker -->') continue;
    if (trimmed === '' && (kept.length === 0 || kept.at(-1).trim() === '')) continue;
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
