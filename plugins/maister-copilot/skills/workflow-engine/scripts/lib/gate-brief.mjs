/**
 * The gate brief: what an operator reads at a gate, rendered from state.
 *
 * Why this module exists. A gate question used to depend on the model composing
 * three things before it asked: a summary of the node that just closed, the node
 * that will actually run next, and which answer it recommends. Attended runs
 * showed all three skipped or wrong — a summary printed after the question or not
 * at all, a "next" read off the gate's own wording while a guard skipped that
 * stretch, a recommendation never named. Each is a fact the engine already holds
 * or can compute, so the engine renders them and the model pastes the result.
 *
 * What it reads. The state file, and the definition the run froze — re-read and
 * re-resolved here without writing anything, because the frozen state carries no
 * `ask`, `options` or `when`. The re-read feeds only the `Next:` line and the
 * option ids; execution never re-resolves a definition, and nothing here changes
 * that. When the definition has drifted since the freeze the brief degrades
 * rather than refusing: the summary and the recommendation still render, `Next:`
 * says it is unknown, and a warning names the two digests. A run started before
 * an upgrade keeps working at every gate.
 *
 * When the definition cannot be read at all and the freeze recorded no needs,
 * the nodes this gate closes are unknown. The brief still renders: the summary
 * is the nearest node recorded before the gate that carries one, and a warning
 * says so. Only when no node carries a summary does it refuse.
 *
 * The refusals, split by who can fix them. Two are fixed by a state write, and
 * their message carries the patch: `gate-brief-no-summary` and
 * `gate-brief-value-missing`. Four name no write: `gate-brief-unknown-node` and
 * `gate-brief-not-a-gate` (the invocation is wrong), `state-unreadable`, and
 * `gate-brief-no-graph` (no definition, no frozen needs and no summary to fall
 * back on).
 *
 * Three forms, one reading. The plain form is what a user reads in session:
 * the summary, at most three decisions and three risks — each item on a line of
 * its own and by its lead sentence alone, the rest of it left to the dashboard —
 * a `Next:` line naming the node that runs and any work skipped on the way —
 * never a gate — and a `Review:` line naming the files the closing nodes wrote
 * that are on disk, their HTML companions and the dashboard. It carries no
 * recommendation: the picker marks the recommended option. `--json` returns that
 * text as `brief`, printed once as a message, beside what a picker takes — a
 * short question, a header of at most `HEADER_MAX` characters, and the options
 * in order, recommended first, each with its id, its label and a description —
 * so the model maps fields rather than composing a question, and an answer
 * echoes one line rather than the whole brief.
 * The picker takes one of two profiles, one per kind of asking tool, and the
 * build picks the profile per tool. `rich` keeps the compact question and the
 * descriptions and puts the whole brief in the recommended option's preview;
 * `plain` puts the whole brief in the question and lists labels only. Both mark
 * the recommended label, keep every option's id, and add "More details" — the
 * request for the full brief, never an answer — while the tool has a slot free.
 * `--oneline` is the driven form a gate request carries, and it is the shape a
 * cockpit and a driver read: every line of the brief, `Recommended: <id>` and
 * the `Run: … · Dashboard: …` line included, folded onto one line.
 *
 * The budget. A picker cuts a question off at about 2,000 characters, and what
 * it cut was the tail — the risks, `Next:` and the ask. So the brief keeps
 * inside `BUDGET`, trimming the summary, the decisions and the risks with a
 * pointer to the dashboard — or to the state file, when the run has no
 * dashboard or its viewer is missing — and never its closing lines: `Next:`,
 * and in the driven form `Recommended:` and the run line. A summary drawn from
 * several nodes is trimmed node by node, each keeping its share, so no node the
 * gate closes is trimmed out of the brief whole.
 *
 * The guard evaluation and the ready-set simulation live here and nowhere else:
 * `walk` for a gate's `Next:` line, `atClose` for what a completed run still owes.
 * `umbrella/scripts/lib/envelope.mjs` re-resolves a frozen definition the same
 * way and is the pattern for it, never an import: the umbrella's drift is a
 * refusal and this module's is a degradation, and one shared helper would have to
 * carry both meanings.
 *
 * Pure: no stdio, no writes. Returns `{ok, text, errors, warnings}` and leaves
 * printing to `workflow.mjs`. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, isPlainObject } from './state-read.mjs';
import { KNOWN_VERSION, readDefinition } from './definition.mjs';
import { MORE_DETAILS_ID, resolve, reviseStretch } from './graph.mjs';
import { displayOf, headerOf, labelOf, titleOf } from './display.mjs';
import { definitionPathOf, htmlOutput, projectRootOf } from './state.mjs';
import { REVISION_CEILING } from './revise.mjs';
import { moreDetails, plainPicker, requestOf, richPicker } from './checkpoint.mjs';
import { artifactOf, decisionOf, decisionText, headlineOf as entryHeadline, riskOf, riskText } from './items.mjs';

/** The context blocks a summary may also be recorded in, beside `node_summaries`. */
const CONTEXT_SUFFIX = '_context';

/** The warning `workflow.mjs` records for a format this build does not know. */
const NEWER_FORMAT = 'newer-format';

/** Statuses that satisfy a `needs` entry under the default `on`. */
const ENDED_OK = new Set(['completed', 'skipped']);

/** Statuses that end a need badly: what `on: failure` runs on and `on: always` runs through. */
const ENDED_BADLY = new Set(['failed', 'stopped']);

/** Statuses under which a node's declared values read as false. */
const NO_VALUES = new Set(['skipped', 'stopped', 'failed']);

/** One `when` reference: an optional `!`, then `${inputs.k}` or `${node.values.k}`. */
const WHEN = /^(!?)\$\{([a-z][a-z0-9-]*)\.(?:(values)\.)?([a-z_]+)\}$/;

/** The drift form of the Next line, and the recommendation when no option is known. */
const NEXT_UNKNOWN = 'Next: unknown — the definition changed since the freeze';
const RECOMMENDED_UNKNOWN = 'the continue option';

/**
 * The most a brief prints, in characters. It was set when the brief rode in the
 * picker's question — a picker showed every question of 1,896 characters in full
 * and cut every one of 2,325 — and it is kept now that the brief is printed above
 * the picker: the driven form still travels in a gate request, and a brief this
 * long still fits one screen.
 */
export const BUDGET = 1600;

/** How long one decision or risk may run before it is cut short. */
const ITEM_MAX = 200;

/**
 * How long an item's lead sentence may run in the plain form — under
 * `ITEM_MAX`, so a headline is never cut with a pointer of its own.
 */
const HEADLINE_MAX = 120;

/**
 * The end of a sentence: its stop, any closing quote or bracket after it, and
 * then a space or the end — so `… "Nothing yet." Then …` ends inside the quote.
 */
const SENTENCE_END = /[.!?]["'’”)\]]*(?=\s|$)/g;

/** An abbreviation whose full stop ends no sentence, read off the text before it. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf)$/i;

/** What a node the gate needs reads as when it was skipped and recorded no summary of its own. */
const SKIPPED = 'Skipped.';

/** Between the sections of a summary drawn from several nodes. */
const SECTION_BREAK = '\n\n';

/** How many decisions, and how many risks, the plain form shows before pointing at the rest. */
const LIST_CAP = 3;

/**
 * A slug key leading a list item — `goods-currency-contract: …` — which names
 * the entry for a machine and says nothing to an operator. At least one dash or
 * underscore, so the prefixes that carry meaning (`open:`, `defaulted:`,
 * `recommend stop:`) are never taken for one.
 */
const SLUG_KEY = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+:\s+/;
const SLUG = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/;

/** The plain form's note on its `Next:` line once a gate reaches its revise ceiling. */
const CEILING_REACHED = ' (no revises are left at this checkpoint)';

/**
 * The most suggestions a revise option carries: a picker offers at most four
 * options, and the operator's own words are the fallback beside them. The
 * fewest is two, so the question always has a choice to make.
 */
const SUGGESTIONS_MAX = 4;
const SUGGESTIONS_MIN = 2;

/** How long a suggested note may run: a risk and the change it needs, whole. */
const NOTE_MAX = 400;

/** The least of a summary kept while list items can still be dropped instead. */
const SUMMARY_FLOOR = 400;

/**
 * Render the brief for the gate `node` of the run whose state file is `state`.
 * `oneline` folds it onto one flow-safe line for a driven gate request; `json`
 * returns the picker — `{picker, question, header, options, details}`, shaped
 * by the `picker` profile — beside the plain text.
 */
export function gateBrief({ state, node, form = 'plain', picker = 'rich' }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('state-unreadable', `${state} cannot be read as a state document: ${err.message}`);
  }

  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  if (!Object.hasOwn(recorded, node)) {
    return refuse('gate-brief-unknown-node',
      `--node=${node} names no node of this run (workflow.nodes has no "${node}"); correct the --node argument — no state write fixes this`);
  }
  if (entryOf(recorded, node).kind !== 'gate') {
    return refuse('gate-brief-not-a-gate',
      `--node=${node} names a node this run recorded as ${JSON.stringify(entryOf(recorded, node).kind ?? null)}, not a gate; correct the --node argument — no state write fixes this`);
  }

  const runDir = path.dirname(path.resolve(state));
  const current = reread(doc, workflow, runDir);
  const warnings = [];
  if (current.drift) {
    warnings.push({
      code: 'gate-brief-graph-drift',
      message: `gate-brief-graph-drift: ${digest(workflow.graph_hash) ?? 'none recorded'} vs ${current.digest ?? 'unresolvable'} — the Next line is unknown`,
    });
  }
  const graph = current.graph;
  const byId = new Map((graph?.nodes ?? []).map(entry => [entry.id, entry]));

  const { direct: candidates, stretch } = closingCandidates(recorded, byId, node);
  let closing;
  if (candidates.length) {
    closing = closingStretch(doc, recorded, candidates, stretch, current.display.titles);
    if (!closing) {
      return refuse('gate-brief-no-summary',
        `no node this gate closes has recorded a summary (looked at: ${candidates.join(', ')}); `
        + `send {"node_summaries":{"${candidates[0]}":{"summary":"…"}}} for the node that closed, through write-state, and run gate-brief again`,
        warnings);
    }
  } else {
    // Neither the definition nor the freeze says what this gate closes. The
    // nearest node recorded before it that carries a summary is the best guess
    // there is, and the warning says it is one.
    closing = closingNode(doc, Object.keys(recorded).slice(0, Object.keys(recorded).indexOf(node)).reverse());
    if (!closing) {
      return refuse('gate-brief-no-graph',
        'the definition cannot be read, the freeze recorded no needs for this gate, and no node before it carries a summary; '
        + 'no state write fixes this — ask the gate without a brief and report this message',
        warnings);
    }
    warnings.push({
      code: 'gate-brief-needs-unknown',
      message: `gate-brief-needs-unknown: what this gate closes is unknown, so the summary is ${closing.id}'s, the nearest node before it that carries one`,
    });
  }

  // The options only when the current definition still holds this node as a
  // gate — under drift that is the best knowledge there is, and without it the
  // line names the option by role rather than inventing an id.
  const gateNode = byId.get(node);
  const options = gateNode?.type === 'gate' && isPlainObject(gateNode.options) ? gateNode.options : null;

  let walked = null;
  if (!current.drift) {
    walked = walk({ graph, recorded, gate: node, inputs: inputsOf(doc), defaults: current.defaults });
    if (!walked.ok) return { ok: false, text: '', errors: walked.errors, warnings };
  }
  const { titles } = current.display;
  const recommended = recommend(options, closing.risks);
  // A revise names the nodes it will re-run, and only a trusted definition
  // says which of them a guard will skip again.
  const guards = current.drift ? null : {
    byId,
    recorded,
    status: new Map(Object.keys(recorded).map(id => [id, entryOf(recorded, id).status ?? 'pending'])),
    inputs: inputsOf(doc),
    defaults: current.defaults,
  };
  const revisions = revisionsOf(doc, recorded, byId, node, options, titles, guards);

  // The driven form: one flow-safe line, the shape every driver and cockpit
  // has always read, kept as the fallback beside the checkpoint.
  const onelineText = () => {
    const next = walked ? nextLine(walked, titles) : NEXT_UNKNOWN;
    const offered = revisions.spent ? [] : revisions.options.map(each => `revise: ${each.id} reruns=${each.reruns} revision=${revisions.revision}/${REVISION_CEILING}`);
    const tail = [next, ...offered, `Recommended: ${recommended}`, runLine(doc, runDir)];
    return fit(closing, DRIVEN, tail, pointerOf(doc, runDir));
  };
  if (form === 'oneline') return { ok: true, text: onelineText(), errors: [], warnings };

  const gateId = id => isGate(recorded, byId, id);
  const ids = candidates.length ? [...candidates, ...stretch] : [closing.id];
  if (form === 'plain') {
    const next = walked ? readableNext(walked, titles, gateId) : NEXT_UNKNOWN;
    const spent = revisions.spent && revisions.options.length ? CEILING_REACHED : '';
    const review = reviewLine(doc, runDir, ids, byId);
    const text = fit(closing, READABLE, [`${next}${spent}`, ...(review ? [review] : [])], placeOf(doc, runDir));
    return { ok: true, text, errors: [], warnings };
  }

  const checkpoint = buildCheckpoint({
    doc, runDir, node, recorded, byId, titles, display: current.display, closing, ids, gateNode, options, walked, recommended, revisions, gateId,
  });
  if (form === 'checkpoint') return { ok: true, checkpoint, errors: [], warnings };
  if (form === 'request') return { ok: true, request: requestOf(checkpoint, onelineText().trimEnd()), errors: [], warnings };
  const shaped = picker === 'plain' ? plainPicker(checkpoint) : richPicker(checkpoint);
  // The plain profile's header titles a form property, which has no length
  // limit and shows a cut word as written: it takes the closing node's own
  // title, where the rich profile's chip takes the short header.
  const header = picker === 'plain' ? titleOf(titles, closing.id) : checkpoint.header;
  return {
    ok: true,
    picker: { picker, ...shaped, header },
    more_details: moreDetails(checkpoint),
    errors: [],
    warnings,
  };
}

/** How many files the `Review:` line names before it stops. */
const REVIEW_MAX = 3;

/**
 * The `Review:` line: the files the gate's closing nodes wrote, each with its
 * HTML companion when that is on disk — or null when there are none. The
 * dashboard is not named: the line reaches the question, where a full path is
 * hard to read, and the dashboard is already open in the browser. A file is
 * named only when it exists, by its path from the
 * project root, so the user can open it as printed. The registered artifacts
 * of a node's summary come first; a node that registered none is read off the
 * declared outputs of the definition, files only — a directory is no document
 * to review.
 */
function reviewLine(doc, runDir, ids, byId) {
  const files = reviewFiles(doc, runDir, ids, byId);
  if (!files.length) return null;
  const root = projectRootOf(runDir);
  // Written with `/` on every platform, as every other path the brief names.
  const shown = file => path.relative(root, file).split(path.sep).join('/') || file;
  // A companion beside its document is named by its file name alone: the
  // whole path again would spend the brief's budget on what the reader
  // already has in front of them.
  const companion = (file, html) => (path.dirname(html) === path.dirname(file) ? path.basename(html) : shown(html));
  return `Review: ${files.map(({ file, html }) => (html ? `${shown(file)} (HTML: ${companion(file, html)})` : shown(file))).join(', ')}`;
}

/**
 * The files a gate's closing nodes wrote that are on disk, at most
 * `REVIEW_MAX` and the primary ones first, as `{file, html, label, role}` with absolute paths. The
 * registered artifacts of a node's summary come first; a node that registered
 * none is read off the declared outputs of the definition, files only — a
 * directory is no document to review. An artifact registered as evidence or a
 * log is no document to review either.
 */
function reviewFiles(doc, runDir, ids, byId) {
  const isFile = file => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  const sources = artifactSources(doc);
  const files = [];
  const add = (relative, html, label = null, role = null) => {
    if (typeof relative !== 'string' || relative === '' || relative.includes('${')) return;
    if (role === 'evidence' || role === 'log') return;
    const file = path.resolve(runDir, relative);
    if (!isFile(file) || files.some(each => each.file === file)) return;
    const sibling = typeof html === 'string' && html !== '' ? path.resolve(runDir, html) : file.replace(/\.md$/, '.html');
    files.push({
      file,
      html: sibling !== file && isFile(sibling) ? sibling : null,
      label: typeof label === 'string' && label !== '' ? label : null,
      role: typeof role === 'string' ? role : null,
    });
  };
  for (const id of ids) {
    const registered = sources.flatMap(source => source(id));
    if (registered.length) {
      for (const artifact of registered) add(artifact.path, artifact.html, artifact.label, artifact.role);
      continue;
    }
    const declared = byId.get(id)?.outputs?.artifacts;
    if (isPlainObject(declared)) for (const relative of Object.values(declared)) add(relative, null);
  }
  // When the cap bites, the deliverable wins: registration order put a brief
  // and a plan ahead of the report they led to.
  const rank = file => REVIEW_RANK[file.role] ?? REVIEW_RANK.other;
  return files.map((file, index) => ({ file, index }))
    .sort((a, b) => rank(a.file) - rank(b.file) || a.index - b.index)
    .slice(0, REVIEW_MAX)
    .map(({ file }) => file);
}

/** The order the `Review:` line names files in: the document a phase produced, then its companions. */
const REVIEW_RANK = { primary: 0, review: 1, other: 2 };

/**
 * Each source of registered artifacts as a function of a node id to its
 * `{path, html}` entries: the node's summary, then any context-block entry that
 * names it — the same places `summarySources` reads a summary from.
 */
function artifactSources(doc) {
  const entries = entry => (isPlainObject(entry) && Array.isArray(entry.artifacts) ? entry.artifacts.map(artifactOf).filter(Boolean) : []);
  return summarySources(doc).map(source => id => source(id).flatMap(entries));
}

/**
 * The gate's revise options as the brief offers them: `{revision, spent,
 * options[{id, reruns, description, suggestions}]}`. `revision` is the one the
 * next revise would be — the gate's attempt — and `spent` says the ceiling is
 * reached, which drops every revise option from the picker and the driven form.
 *
 * Where each option sends the run is read from the gate's node line, which the
 * freeze recorded, and only failing that from the re-read definition; the
 * stretch is walked over the frozen edges, the way `gate-revise` walks it. The
 * description names the nodes of it that will run again: the verb resets every
 * one, but a node a guard will skip again is not work the operator is sending
 * the run back for, so it is left out (`skippedAgain`).
 */
function revisionsOf(doc, recorded, byId, gate, options, titles, guards) {
  const entry = entryOf(recorded, gate);
  const frozen = isPlainObject(entry.reruns) ? entry.reruns : null;
  const targets = {};
  if (frozen) {
    for (const [id, target] of Object.entries(frozen)) if (typeof target === 'string') targets[id] = target;
  } else if (isPlainObject(options)) {
    for (const [id, option] of Object.entries(options)) {
      if (isPlainObject(option) && option.effect === 'revise' && typeof option.reruns === 'string') targets[id] = option.reruns;
    }
  }
  const attempt = Number(entry.attempt);
  const revision = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  const ids = Object.keys(recorded).length ? Object.keys(recorded) : [...byId.keys()];
  const sources = summarySources(doc);
  const revise = Object.entries(targets).map(([id, reruns]) => {
    const stretch = reviseStretch({ ids, needsOf: each => needsOf(recorded, byId, each), reruns, gate });
    const work = stretch.filter(each => !isGate(recorded, byId, each) && !skippedAgain(each, stretch, guards));
    const names = andList(work.map(each => titleOf(titles, each)));
    const earlier = earlierElsewhere(doc, recorded, gate, reruns, titles);
    return {
      id,
      reruns,
      work,
      history: `${revisedSoFar(revision)}${earlier}`,
      description: `Re-run ${names} with your note, then ask again.${revisedSoFar(revision)}${earlier}`,
      suggestions: suggestionsFor(sources, [...work].reverse(), lowerArticle(titleOf(titles, reruns))),
    };
  });
  return { revision, spent: revision > REVISION_CEILING, options: revise };
}

/**
 * How often this gate has sent the run back, said as a count of what happened
 * rather than as one of a fixed number: a revise the user chooses is not
 * rationed, and "revision 2 of 3" read as a budget running out.
 */
function revisedSoFar(revision) {
  const done = revision - 1;
  if (done < 1) return '';
  return ` Revised ${done === 1 ? 'once' : `${done} times`} so far at this checkpoint.`;
}

/**
 * A sentence naming the revises of the same node chosen at other gates, or ''.
 * Each gate counts its own revisions, so without it a document revised at its
 * own checkpoint reads as never revised at the next one.
 */
function earlierElsewhere(doc, recorded, gate, reruns, titles) {
  const summaries = isPlainObject(doc.node_summaries) ? doc.node_summaries : {};
  const where = [];
  let count = 0;
  for (const id of Object.keys(recorded)) {
    if (id === gate || entryOf(recorded, id).kind !== 'gate') continue;
    const decisions = isPlainObject(summaries[id]) && Array.isArray(summaries[id].decisions) ? summaries[id].decisions : [];
    const here = decisions.filter(decision => isPlainObject(decision) && decision.reruns === reruns && Object.hasOwn(decision, 'attempt')).length;
    if (!here) continue;
    count += here;
    where.push(titleOf(titles, id));
  }
  if (!count) return '';
  return ` ${titleOf(titles, reruns)} was already revised ${count === 1 ? 'once' : `${count} times`} at ${andList(where)}.`;
}

/**
 * Whether a node of a revise's stretch will be skipped again when the stretch
 * re-runs: its guard reads an input or a node outside the stretch — nothing the
 * re-run changes — and reads false now. A guard on a node inside the stretch is
 * judged again once that node records its values, so its node may run and is
 * named. Without `guards` — the definition drifted — no guard is read and every
 * node is named.
 */
function skippedAgain(id, stretch, guards) {
  const when = guards?.byId.get(id)?.when;
  if (typeof when !== 'string') return false;
  const match = WHEN.exec(when);
  if (!match || (match[2] !== 'inputs' && stretch.includes(match[2]))) return false;
  const guard = evaluate(when, guards);
  return guard.ok && !guard.value;
}

/**
 * What the operator might ask a revise to change, generated from what the
 * stretch it re-runs found: each open risk as a thing to resolve, then each
 * decision as a thing to revisit, nearest the gate first — the order the
 * brief lists them in, most important first. Duplicates go; at most
 * `SUGGESTIONS_MAX` stay. When the stretch recorded fewer than
 * `SUGGESTIONS_MIN`, two plain edits of the rerun node make up the rest, so the
 * question always offers a real choice and never an empty one.
 *
 * Each is `{label, description, note, recommended}`: the label the lead
 * sentence of what it answers, uncut but for a headline's own cap — a label cut
 * to a few words had to be spelled out again in its description — the
 * description what the label leaves out, never the same words twice, and the
 * note the whole of it — what the re-run is told, and what
 * the revise preview lists. A suggestion drawn from a risk leads with the risk,
 * then the change: risks are not in the glance, so a change alone did not say
 * what it was for. None is recommended — a suggestion is offered, and the
 * user's own words are as good an answer — and the key stays, false, for the
 * readers that take it.
 */
function suggestionsFor(sources, stretch, target) {
  const found = [];
  const add = (label, description, note) => {
    if (!note || found.some(each => each.note === note)) return;
    found.push({ label, description, note: sliced(note, NOTE_MAX).trimEnd(), recommended: false });
  };
  // A sentence's own stop goes before the dash; a cut's ellipsis stays, so the
  // reader still sees the risk was shortened.
  const bare = text => text.replace(/\.$/, '');
  const entries = stretch.map(id => summaryOf(sources, id)).filter(Boolean);
  for (const entry of entries) {
    for (const item of entry.risks) {
      // Only what is still open is a change to ask for: a trade-off was chosen,
      // a follow-up is for later, and neither is what a revise is for.
      const risk = riskOf(item);
      if (!risk || risk.tag !== 'open') continue;
      const short = headline(risk.risk);
      // A risk written with the change it needs carries its own fix; without
      // one, the note says what the rerun does with it rather than a bare
      // "Resolve:" the user cannot act on.
      if (risk.change) add(short, risk.change, `${bare(short)} — ${risk.change}`);
      else add(short, `Re-run ${target} to address it`, `Re-run ${target} to address: ${risk.risk}`);
    }
  }
  // A decision to revisit only fills up a list the open items left short.
  if (found.length < SUGGESTIONS_MIN) {
    for (const entry of entries) {
      for (const item of entry.decisions) {
        const decision = decisionOf(item);
        if (!decision || decision.by === 'operator') continue;
        const text = decisionText(decision);
        const short = headline(decision.decision);
        const rationale = typeof decision.rationale === 'string' && decision.rationale.trim() !== '' ? decision.rationale.trim() : '';
        add(`Revisit: ${short}`, rationale || 'Reconsider this decision in the re-run', `Revisit the decision: ${text}`);
      }
    }
  }
  if (found.length < SUGGESTIONS_MIN) {
    add(`Make ${target} more specific`, 'Where it is vague', `Make ${target} more specific where it is vague`);
    add(`Cut ${target} to what is needed`, 'Down to what the next step needs', `Cut ${target} down to what the next step needs`);
  }
  return found.slice(0, SUGGESTIONS_MAX);
}

/**
 * `text` cut at a word to at most `max` characters, an ellipsis marking the
 * cut — a suggestion's label and a headline. Its casing is the writer's: a
 * label that opens `iPhone` keeps it.
 */
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = sliced(text, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

function refuse(code, message, warnings = []) {
  return { ok: false, text: '', errors: [{ code, message: `${code}: ${message}` }], warnings };
}

/**
 * Whether the run has a dashboard to point at: turned on, and its viewer in the
 * run directory. A page that is not there is not named — the freeze installs
 * it, so a run without one predates that or had it removed.
 */
function hasViewer(doc, runDir) {
  return htmlOutput(doc) && fs.existsSync(path.join(runDir, 'dashboard.html'));
}

/** Where a trimmed brief sends the reader for the rest: the dashboard, or the state file without one. */
function pointerOf(doc, runDir) {
  return `see ${placeOf(doc, runDir)}`;
}

/** The place itself, which the plain form names after "more in". */
function placeOf(doc, runDir) {
  return hasViewer(doc, runDir) ? 'the dashboard' : "the run's state file";
}

/**
 * Where the run lives and where its dashboard is — the brief's last line. With
 * `html_output` off it says there is none; with the viewer missing it names the
 * run alone.
 */
function runLine(doc, runDir) {
  if (!htmlOutput(doc)) return `Run: ${runDir} · Dashboard: none (html_output is false)`;
  return hasViewer(doc, runDir) ? `Run: ${runDir} · Dashboard: ${path.join(runDir, 'dashboard.html')}` : `Run: ${runDir}`;
}

function entryOf(recorded, id) {
  return isPlainObject(recorded[id]) ? recorded[id] : {};
}

/** Either spelling of a graph hash reduced to the digest itself. */
function digest(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

// ---------------------------------------------------------------------------
// the checkpoint
// ---------------------------------------------------------------------------

/** A gate's `ask:` whose last sentence asks to go on: `… Continue?` or `… Continue to <somewhere>?`. */
const ASKS_TO_CONTINUE = /^(.*?)\s*Continue\b[^?]*\?\s*$/s;

/** A parenthesis inside an ask, which lists internal steps rather than telling the user anything. */
const PARENTHESIS = /\s*\([^)]*\)/g;

/** The order a checkpoint lists options in, as the gate declares them: on, back, out. */
const EFFECT_ORDER = { continue: 0, revise: 1, stop: 2 };

/** How many files a stop names as kept: the ones under review, then the earlier stretch's main files. */
const KEEPS_MAX = 3;

/**
 * The checkpoint: everything a surface shows at this gate, as one object.
 * Every renderer — both pickers, the driven request, a cockpit card — projects
 * from it, so what the operator is shown is decided here once.
 *
 * Field order is the contract's: identity, the ask, what was done and what
 * comes next, what was decided and what is open, the options, then the
 * reserved and run-level fields. Decisions and risks cover the whole stretch the
 * gate closes, each tagged with the node that recorded it, an item two nodes
 * recorded kept once; the user's own choices are counted rather than listed.
 */
function buildCheckpoint({ doc, runDir, node, recorded, byId, titles, display, closing, ids, gateNode, options, walked, recommended, revisions, gateId }) {
  const title = id => titleOf(titles, id);
  const order = Object.keys(recorded);
  const sources = summarySources(doc);
  let truncated = false;

  // What finished: the closing node's own *Done* sentence, or its summary's first.
  const lead = closing.entries.find(entry => !entry.skipped) ?? closing.entries[0];
  const own = typeof lead.headline === 'string' && lead.headline.trim() !== '';
  const headline = entryHeadline({ headline: lead.headline, summary: lead.summary });
  if (!own && headline.endsWith('…')) truncated = true;

  // Where the run goes: the node the walk lands on, the work skipped on the way.
  let next = null;
  if (walked) {
    const skipReason = id => {
      const entry = summaryOf(sources, id);
      return entry ? headline_(entry.summary) : null;
    };
    next = {
      node: walked.next,
      title: walked.next === null ? null : title(walked.next),
      end: walked.next === null && !(walked.waiting ?? []).length,
      skipped: walked.skipped.filter(id => !gateId(id)).map(id => ({ node: id, title: title(id), reason: skipReason(id) })),
    };
    if (walked.next === null && (walked.waiting ?? []).length) next.waiting = walked.waiting.map(id => ({ node: id, title: title(id) }));
  }

  const reviewed = reviewFiles(doc, runDir, ids, byId);
  const relative = file => path.relative(runDir, file).split(path.sep).join('/');
  const review = reviewed.map(each => ({ path: relative(each.file), label: each.label, html: each.html ? relative(each.html) : null, role: each.role }));

  // Decided and open, grouped by who settled them and by what they are.
  const decisions = { run: [], audit: [], default: [], operator: { count: 0, not_recommended: [] } };
  const risks = { open: [], tradeoff: [], followup: [], stop: [], resolved: [] };
  const seen = new Set();
  const once = (kind, text) => {
    const key = `${kind}:${text.replace(/\s+/g, ' ').replace(/\.$/, '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  let asRecommended = true;
  for (const entry of closing.entries) {
    for (const item of entry.decisions) {
      const decision = decisionOf(item);
      if (!decision || !once('decision', decision.decision)) continue;
      if (decision.by === 'operator') {
        decisions.operator.count++;
        if (decision.as_recommended === false) {
          decisions.operator.not_recommended.push(compact({
            decision: decision.decision,
            question: decision.question,
            answer: decision.answer,
            recommended: decision.recommended,
            answered_by: decision.answered_by,
            node: entry.id,
          }));
        } else if (decision.as_recommended !== true) asRecommended = false;
        continue;
      }
      decisions[decision.by].push(compact({
        decision: decision.decision,
        rationale: typeof decision.rationale === 'string' && decision.rationale.trim() !== '' ? decision.rationale.trim() : undefined,
        question_id: decision.question_id,
        node: entry.id,
      }));
    }
    for (const item of entry.risks) {
      const risk = riskOf(item);
      if (!risk || !once('risk', risk.risk)) continue;
      risks[risk.tag].push(compact({ risk: risk.risk, change: risk.change ?? undefined, node: entry.id }));
    }
  }
  // Unknown is not "as recommended": a choice recorded without saying so is counted plainly.
  if (!asRecommended && !decisions.operator.not_recommended.length) decisions.operator.all_recommended = false;

  // The options, with what choosing each one does.
  const labels = display.option_labels;
  const later = order.slice(order.indexOf(node) + 1).filter(id => !gateId(id)
    && (entryOf(recorded, id).status ?? 'pending') === 'pending' && !(walked?.skipped ?? []).includes(id));
  const keeps = [...review.map(each => each.path), ...earlierFiles(doc, runDir, order.slice(0, order.indexOf(node)).filter(id => !ids.includes(id)))]
    .filter((file, index, all) => all.indexOf(file) === index)
    .slice(0, Math.max(review.length, KEEPS_MAX));
  const revise = new Map(revisions.options.map(each => [each.id, each]));
  const listed = !isPlainObject(options) ? [] : Object.entries(options).flatMap(([id, option]) => {
    const effect = isPlainObject(option) ? option.effect : option;
    const base = { id, label: labelOf(labels, node, id), effect, recommended: id === recommended };
    if (effect === 'continue') base.label = continueLabel(base.label, next);
    if (effect === 'continue') {
      let consequence = 'Continues the run.';
      if (next?.waiting) consequence = `Waits on ${andList(next.waiting.map(each => each.title))}.`;
      else if (next?.end) consequence = 'Finishes the run.';
      else if (next?.title) consequence = `Runs ${lowerArticle(next.title)} next.`;
      return [{ ...base, consequence }];
    }
    if (effect === 'revise') {
      if (revisions.spent || !revise.has(id)) return [];
      const { work, history, suggestions } = revise.get(id);
      const reruns = work.map(each => ({ node: each, title: title(each) }));
      return [{
        ...base,
        consequence: `Re-runs ${andList(reruns.map(each => each.title))} with your note, then asks this again.${history}`,
        reruns,
        revision: { n: revisions.revision, max: REVISION_CEILING },
        suggestions,
      }];
    }
    return [{
      ...base,
      effect: 'stop',
      consequence: 'Ends the run here.',
      keeps,
      not_run: { next: next?.title ?? (later.length ? title(later[0]) : null), remaining: later.length },
    }];
  });
  listed.sort((a, b) => (EFFECT_ORDER[a.effect] ?? 2) - (EFFECT_ORDER[b.effect] ?? 2));

  const stopping = risks.stop.length > 0 && listed.some(option => option.recommended && option.effect === 'stop');
  let reason = null;
  if (stopping) reason = risks.stop[0].risk;
  else if (risks.open.length) reason = `${risks.open.length} open ${risks.open.length === 1 ? 'item' : 'items'}; revise to settle ${risks.open.length === 1 ? 'it' : 'them'} first`;
  else if (next?.title) reason = `nothing open blocks ${lowerArticle(next.title)}`;
  else reason = 'nothing open is left';

  const gates = order.filter(gateId);
  return {
    version: 1,
    kind: 'gate',
    node,
    header: headerOf(display, node, closing.id),
    ask: askOf(gateNode?.ask, title(closing.id)),
    headline: headline || null,
    progress: { checkpoint: gates.indexOf(node) + 1, checkpoints_max: gates.length, node: order.indexOf(node) + 1, nodes_total: order.length },
    next,
    review,
    closed: closing.entries.map(entry => ({ node: entry.id, title: title(entry.id), headline: entry.skipped ? null : entryHeadline(entry) || null, summary: entry.summary })),
    decisions,
    risks,
    recommended: { option: recommended, reason },
    options: listed,
    grants: {},
    approves: [],
    run: { dir: runDir, dashboard: hasViewer(doc, runDir) ? path.join(runDir, 'dashboard.html') : null },
    truncated,
  };
}

/**
 * A continue option's label. One written as a bare "Continue" names where the
 * run goes from the walk: a label naming two destinations — the design or the
 * final summary — read wrong whenever a guard had already settled which one
 * runs. Any other label is the definition's own.
 */
function continueLabel(label, next) {
  if (label !== BARE_CONTINUE || !next || next.waiting) return label;
  if (next.end) return 'Finish the run';
  return next.title ? `Continue to ${lowerArticle(next.title)}` : label;
}

/** The continue label the engine completes with the destination. */
const BARE_CONTINUE = 'Continue';

/** `value` less its undefined and null fields. */
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null));
}

/** A summary's first sentence, for a skipped node's reason; null without one. */
function headline_(text) {
  return typeof text === 'string' && text.trim() !== '' ? headline(scalarText(text)) : null;
}

/** A title after "the", its first letter lower-cased unless it opens an acronym. */
function lowerArticle(title) {
  const lowered = title.length > 1 && /[A-Z]/.test(title[1]) ? title : title.charAt(0).toLowerCase() + title.slice(1);
  return `the ${lowered}`;
}

/**
 * The one-line ask, generated rather than read off the frozen `ask:`: the lead
 * of the gate's own ask — what finished, its parentheses dropped — then one
 * question, the same at every gate: is that work ready to go on. The ask names
 * the work the gate approves, never where the run goes: a destination read
 * like a second question whenever the step before had just opted into it, and
 * the continue option's label and the `Next:` line already say it. Without a
 * lead the closing node's title says what finished. An ask that does not end
 * asking to continue is a question of its own, kept as written.
 */
function askOf(ask, closingTitle) {
  const text = typeof ask === 'string' ? scalarText(ask) : '';
  const asks = ASKS_TO_CONTINUE.exec(text);
  if (text !== '' && !asks) return text;
  let lead = asks ? asks[1].replace(PARENTHESIS, '').trim() : '';
  if (lead === '') lead = `${closingTitle} complete.`;
  if (!/[.!?]$/.test(lead)) lead = `${lead}.`;
  return `${lead} ${READY}`;
}

/** The question every generated ask ends with. */
const READY = 'Ready to go on?';

/**
 * The main files the nodes before this stretch wrote that are on disk, newest
 * first, task-folder relative: what a stop keeps beside the files under review.
 */
function earlierFiles(doc, runDir, ids) {
  const sources = artifactSources(doc);
  const files = [];
  for (const id of [...ids].reverse()) {
    for (const artifact of sources.flatMap(source => source(id))) {
      if (artifact.role && artifact.role !== 'primary') continue;
      if (typeof artifact.path !== 'string' || artifact.path === '' || artifact.path.includes('${')) continue;
      const file = path.resolve(runDir, artifact.path);
      try {
        if (!fs.statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      files.push(path.relative(runDir, file).split(path.sep).join('/'));
    }
  }
  return files.slice(0, KEEPS_MAX);
}

// ---------------------------------------------------------------------------
// the read-only re-read
// ---------------------------------------------------------------------------

/**
 * The frozen definition, re-read and re-resolved: `{graph, defaults, display,
 * digest, drift}`. `graph` is kept even under a hash mismatch — its needs and
 * options are still the best knowledge of the gate — and is null only when
 * nothing resolves. `defaults` is the re-read document's `inputs.<k>.default`
 * map, since the resolved graph carries no inputs. `display` is the merged
 * display block: the titles the `Next:` line names nodes by — read off the same
 * sources, so the brief and the dashboard call a node the same thing — and the
 * option labels and headers the picker shows.
 */
function reread(doc, workflow, runDir) {
  const drifted = (graph = null, defaults = {}, display = displayOf()) => ({ graph, defaults, display, digest: digest(graph?.graph_hash), drift: true });
  const file = definitionPathOf(doc, runDir);
  if (file === null) return drifted();
  const definition = readDefinition(file);
  if (definition.doc === null || definition.errors.length) return drifted();

  const root = projectRootOf(runDir);
  const overlays = [];
  for (const overlay of Array.isArray(workflow.overlays) ? workflow.overlays : []) {
    const read = typeof overlay === 'string' ? readDefinition(path.resolve(root, overlay)) : null;
    if (!read || read.doc === null || read.errors.length) return drifted();
    overlays.push(read);
  }

  // A newer format is resolved on its structure alone, as the entry point does;
  // the hash comparison is what still has to hold.
  const version = definition.doc.version;
  const degraded = version !== undefined && version !== null && version !== KNOWN_VERSION ? [NEWER_FORMAT] : [];
  const graph = resolve({ definition, overlays, profile: workflow.profile ?? null, degraded });
  const defaults = defaultsOf(definition.doc);
  const display = displayOf({ definition, overlays, profile: workflow.profile ?? null });
  if (!graph.ok) return drifted(null, defaults, display);

  const frozen = digest(workflow.graph_hash);
  const now = digest(graph.graph_hash);
  return { graph, defaults, display, digest: now, drift: frozen === null || frozen !== now };
}

function defaultsOf(definition) {
  const inputs = isPlainObject(definition.inputs) ? definition.inputs : {};
  const defaults = {};
  for (const [key, declared] of Object.entries(inputs)) {
    if (isPlainObject(declared) && Object.hasOwn(declared, 'default')) defaults[key] = declared.default;
  }
  return defaults;
}

function inputsOf(doc) {
  const orchestrator = isPlainObject(doc.orchestrator) ? doc.orchestrator : {};
  const options = isPlainObject(orchestrator.options) ? orchestrator.options : {};
  return isPlainObject(options.inputs) ? options.inputs : {};
}

// ---------------------------------------------------------------------------
// the closing node
// ---------------------------------------------------------------------------

/** A node's needs: the frozen record when it carries one, else the resolved graph's. */
function needsOf(recorded, byId, id) {
  const frozen = entryOf(recorded, id).needs;
  if (Array.isArray(frozen)) return frozen.map(String);
  const resolved = byId.get(id)?.needs;
  return Array.isArray(resolved) ? resolved : [];
}

function isGate(recorded, byId, id) {
  return entryOf(recorded, id).kind === 'gate' || byId.get(id)?.type === 'gate';
}

/**
 * What this gate closes, as `{direct, stretch}`.
 *
 * `direct` is the nodes it needs, in order. A need that is itself a gate is
 * replaced by that gate's own needs, recursively, so the brief never renders
 * another gate's answer as this one's summary. One of these must have recorded
 * a summary, because they are the nodes that just closed.
 *
 * `stretch` is everything behind them: their needs, walked back until a gate,
 * which is where the previous brief already reported. A node an overlay placed
 * before a node this gate closes is in here, and so is any node since the
 * previous gate that no gate needed directly — neither was ever shown to the
 * operator, and this is the gate that moves past them.
 */
function closingCandidates(recorded, byId, gate) {
  const direct = [];
  const stretch = [];
  const seen = new Set([gate]);
  const visit = id => {
    for (const need of needsOf(recorded, byId, id)) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (isGate(recorded, byId, need)) visit(need);
      else direct.push(need);
    }
  };
  const behind = id => {
    for (const need of needsOf(recorded, byId, id)) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (isGate(recorded, byId, need)) continue;
      stretch.push(need);
      behind(need);
    }
  };
  visit(gate);
  for (const id of direct) behind(id);
  return { direct, stretch };
}

/**
 * Every node of the stretch that recorded a summary, folded into the one
 * `{id, sections, decisions, risks}` the renderer draws, or null when none of
 * the `direct` nodes carries one — a summary further back never stands in for
 * the summary of the node that closed.
 *
 * The direct nodes come first and the rest after them, each group in frozen
 * order. A direct node that was skipped and wrote nothing reads `Skipped.`, so a
 * gate that closes two nodes shows both whether the second ran or not; it never
 * counts as the closing summary. One node renders exactly as it always has, as
 * one untitled section. Several are each a section named by the node's title,
 * which the budget trims one by one rather than from the end, and their
 * decisions and risks are pooled in the same order, so a `recommend stop:`
 * from any of them decides the recommendation. An item two of them recorded is
 * pooled once, where it first appears, so a repeat never takes a line or a
 * count of its own.
 */
function closingStretch(doc, recorded, direct, stretch, titles) {
  const sources = summarySources(doc);
  const order = Object.keys(recorded);
  const sorted = ids => [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const skipped = id => (entryOf(recorded, id).status === 'skipped'
    ? { id, summary: SKIPPED, decisions: [], risks: [], skipped: true } : null);
  const closing = sorted(direct).map(id => summaryOf(sources, id) ?? skipped(id)).filter(Boolean);
  const lead = closing.find(entry => !entry.skipped);
  if (!lead) return null;
  const entries = [...closing, ...sorted(stretch).map(id => summaryOf(sources, id)).filter(Boolean)];
  if (entries.length === 1) return closingOf(lead);
  return {
    id: lead.id,
    entries,
    sections: entries.map(entry => ({ title: titleOf(titles, entry.id), text: entry.summary })),
    decisions: distinct(entries.flatMap(entry => entry.decisions)),
    risks: distinct(entries.flatMap(entry => entry.risks)),
  };
}

/**
 * `items` less every one whose text repeats an earlier one's, the first kept.
 * Items compare as they read — a leading slug key dropped, spacing, case and a
 * closing stop ignored — so the same finding recorded by two nodes is one item.
 */
function distinct(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = itemText(item, true).replace(/\s+/g, ' ').replace(/\.$/, '').toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The first of `candidates` with a filled summary — the fallback's nearest
 * recorded node, when what the gate closes is unknown.
 */
function closingNode(doc, candidates) {
  const sources = summarySources(doc);
  for (const id of candidates) {
    const found = summaryOf(sources, id);
    if (found) return closingOf(found);
  }
  return null;
}

/** One node's summary as the renderer draws it: a single section, untitled. */
function closingOf(entry) {
  const { id, summary, decisions, risks } = entry;
  return { id, entries: [entry], sections: [{ title: null, text: summary }], decisions, risks };
}

/**
 * One node's `{id, summary, decisions, risks}`, or null when it carries no summary.
 *
 * Each field is picked on its own from the first source carrying it filled — the
 * dashboard's `pick` rule, mirrored rather than imported so the projection stays
 * free to change what it draws. One addition: a context-block entry counts when
 * its key *or* its `node:` names the node, because the context blocks are keyed
 * by phase and name the node inside the entry.
 */
function summaryOf(sources, id) {
  const entries = sources.flatMap(source => source(id));
  const picked = {};
  for (const field of ['summary', 'headline', 'decisions', 'risks']) {
    const entry = entries.find(candidate => filled(candidate[field]));
    if (entry) picked[field] = entry[field];
  }
  if (typeof picked.summary !== 'string') return null;
  return {
    id,
    summary: picked.summary,
    headline: typeof picked.headline === 'string' ? picked.headline : null,
    decisions: list(picked.decisions),
    risks: list(picked.risks),
  };
}

/** Each source as a function of a node id to the entries it holds for it. */
function summarySources(doc) {
  const sources = [];
  if (isPlainObject(doc.node_summaries)) {
    const map = doc.node_summaries;
    sources.push(id => (Object.hasOwn(map, id) && isPlainObject(map[id]) ? [map[id]] : []));
  }
  for (const key of Object.keys(doc)) {
    if (!key.endsWith(CONTEXT_SUFFIX) || !isPlainObject(doc[key]) || !isPlainObject(doc[key].phase_summaries)) continue;
    const map = doc[key].phase_summaries;
    sources.push(id => Object.entries(map)
      .filter(([phase, entry]) => isPlainObject(entry) && (phase === id || entry.node === id))
      .map(([, entry]) => entry));
  }
  return sources;
}

function filled(value) {
  return (typeof value === 'string' && value.trim() !== '') || (Array.isArray(value) && value.length > 0);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// the walker
// ---------------------------------------------------------------------------

/**
 * The node that will actually run once `gate` is answered with its continue
 * option: `{ok, next, skipped}` with `next` null at the end of the run, or a
 * `gate-brief-value-missing` refusal.
 *
 * Only nodes downstream of the gate are considered — those whose transitive
 * `needs` closure contains it. Everything else is history or a parallel branch,
 * and neither is what this answer moves forward.
 *
 * The gate is simulated as completed. Then, in resolved order, the first pending in-scope node whose needs are all
 * settled is taken. An `on: failure` node none of whose needs ended badly is
 * simulated as skipped and the loop goes on; otherwise, without a `when` it is
 * next, and with one a true guard makes it next and a false one simulates a
 * skip and the loop goes on.
 */
export function walk({ graph, recorded, gate, inputs = {}, defaults = {} }) {
  const nodes = graph?.nodes ?? [];
  const byId = new Map(nodes.map(entry => [entry.id, entry]));
  const downstream = downstreamOf(nodes, gate);

  const status = new Map();
  for (const entry of nodes) status.set(entry.id, entryOf(recorded, entry.id).status ?? 'pending');
  status.set(gate, 'completed');

  const skipped = [];
  for (;;) {
    const ready = nodes.find(entry => downstream.has(entry.id)
      && status.get(entry.id) === 'pending'
      && readinessOf(entry, status) !== 'waiting');
    if (!ready) return { ok: true, next: null, skipped, waiting: blockers(nodes, downstream, status) };
    // An `on: failure` node whose needs all ended well has nothing to recover
    // from: it is skipped exactly as a false guard skips a node.
    if (readinessOf(ready, status) === 'skip') {
      status.set(ready.id, 'skipped');
      skipped.push(ready.id);
      continue;
    }
    if (typeof ready.when !== 'string') return { ok: true, next: ready.id, skipped };

    const guard = evaluate(ready.when, { byId, recorded, status, inputs, defaults });
    if (!guard.ok) return guard;
    if (guard.value) return { ok: true, next: ready.id, skipped };
    status.set(ready.id, 'skipped');
    skipped.push(ready.id);
  }
}

/**
 * What the downstream nodes still pending wait on, once nothing downstream is
 * ready: every unmet need that is not itself one of those pending nodes — a
 * parallel branch outside the gate's reach, most often. Empty when nothing
 * downstream is pending, which is the end of the run.
 */
function blockers(nodes, downstream, status) {
  const pending = new Set(nodes.filter(entry => downstream.has(entry.id) && status.get(entry.id) === 'pending').map(entry => entry.id));
  const waiting = new Set();
  for (const entry of nodes) {
    if (!pending.has(entry.id)) continue;
    for (const need of list(entry.needs)) {
      if (!pending.has(need) && !settles(status.get(need), entry.on)) waiting.add(need);
    }
  }
  return nodes.map(entry => entry.id).filter(id => waiting.has(id));
}

/** Every node whose transitive needs closure contains `gate`. */
function downstreamOf(nodes, gate) {
  const found = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of nodes) {
      if (found.has(entry.id)) continue;
      if (list(entry.needs).some(need => need === gate || found.has(need))) {
        found.add(entry.id);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * Whether a predecessor in `state` no longer holds back a node with this `on`.
 * Under the default (`success`) only a need that ended well does; under
 * `failure` and `always` any need that has ended does. Which of those a
 * `failure` node then does — run, or be skipped because nothing failed — is
 * the walker's decision, made once every need has settled.
 */
function settles(state, on) {
  if (ENDED_OK.has(state)) return true;
  return ENDED_BADLY.has(state) && (on === 'failure' || on === 'always');
}

/** `readiness` for a graph node, read off the statuses its needs hold now. */
function readinessOf(entry, status) {
  return readiness(list(entry.needs).map(need => status.get(need)), entry.on);
}

/** The first option id, in resolved order, whose effect is `effect`; else null. */
function optionWith(options, effect) {
  if (!isPlainObject(options)) return null;
  for (const [key, option] of Object.entries(options)) {
    if ((isPlainObject(option) ? option.effect : option) === effect) return key;
  }
  return null;
}

/**
 * One `when` reference, honouring a leading `!`. `{ok, value}`, or the
 * value-missing refusal when a completed node never recorded the value its
 * successor is guarded on.
 */
function evaluate(when, { byId, recorded, status, inputs, defaults }) {
  const match = WHEN.exec(when);
  if (!match) return { ok: true, value: false };
  const [, bang, owner, , key] = match;
  const negate = value => ({ ok: true, value: bang === '!' ? !value : value });

  if (owner === 'inputs') {
    if (Object.hasOwn(inputs, key)) return negate(inputs[key] === true);
    if (Object.hasOwn(defaults, key)) return negate(defaults[key] === true);
    return negate(false);
  }

  // A node that did not complete emits nothing, so every value it declares
  // reads as false (SKILL.md, recording an outcome).
  if (NO_VALUES.has(status.get(owner))) return negate(false);

  // A gate records the option chosen and no value — the validator refuses a
  // gate that declares one — so a guard on a gate reads false rather than
  // refusing over a write nobody could make.
  if (entryOf(recorded, owner).kind === 'gate' || byId.get(owner)?.type === 'gate') return negate(false);

  const held = entryOf(recorded, owner).values;
  if (status.get(owner) === 'completed' && isPlainObject(held) && typeof held[key] === 'boolean') {
    return negate(held[key]);
  }

  const kept = isPlainObject(held) ? JSON.stringify({ ...held }).slice(1, -1) : '';
  const patch = `{"nodes":{"${owner}":{"values":{${kept}${kept ? ',' : ''}"${key}":<true|false>}}}}`;
  return {
    ok: false,
    errors: [{
      code: 'gate-brief-value-missing',
      message: `gate-brief-value-missing: the guard ${when} reads ${owner}.values.${key}, which ${owner} never recorded; `
        + `a node's values map is replaced whole on patch, so send the recorded values with the missing key through write-state — ${patch} — and run gate-brief again`,
    }],
  };
}

/**
 * The driven form's `Next:` line, naming each node by its title: the line is
 * read by the operator, and nothing parses it back. The ids stay everywhere a
 * write or an answer is keyed — the refusals' patches and the `Recommended:`
 * option.
 */
function nextLine({ next, skipped, waiting = [] }, titles) {
  const name = id => titleOf(titles, id);
  const suffix = skipped.length ? ` — skipped: ${skipped.map(name).join(', ')}` : '';
  if (next === null && waiting.length) return `Next: waiting on ${waiting.map(name).join(', ')}${suffix}`;
  return `Next: ${next == null ? 'end of run' : name(next)}${suffix}`;
}

/**
 * The plain form's `Next:` line: the node that runs, and the work skipped on the
 * way in parentheses — `Next: Specification (skipping TDD red and UI mockups)`.
 * A skipped gate is left out: it is an approval of work that did not happen,
 * not work, and naming it only doubles the list.
 */
function readableNext({ next, skipped, waiting = [] }, titles, gateId) {
  const name = id => titleOf(titles, id);
  const work = skipped.filter(id => !gateId(id)).map(name);
  const suffix = work.length ? ` (skipping ${andList(work)})` : '';
  if (next === null && waiting.length) return `Next: waiting on ${andList(waiting.map(name))}${suffix}`;
  return `Next: ${next == null ? 'end of run' : name(next)}${suffix}`;
}

/** `A`, `A and B`, `A, B and C`. */
function andList(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// ---------------------------------------------------------------------------
// the run's close
// ---------------------------------------------------------------------------

/** The statuses a node has ended in. Any other, `pending` aside, started and never ended. */
const ENDED = new Set([...ENDED_OK, ...ENDED_BADLY]);

/**
 * What a run that recorded `completed` still owes, for `run-complete`:
 * `{owed, graph, drift}`.
 *
 * `owed` lists, in frozen order, every node that has not finished and that the
 * ready set cannot rule out, as `{id, status, guard}`; `guard` names the guard
 * when that guard reads a value its owner never recorded, which is the only
 * reason such a node is owed. A node that started and never ended — `running`,
 * `suspended`, `waiting`, or a status no reader knows — is owed outright. A
 * pending one is judged the way `walk` judges one, over the whole graph instead
 * of one gate's reach: the first pending node its rule lets through is taken, a
 * false guard or a skip the rule itself decides simulates `skipped` — which
 * satisfies what follows — and anything else is owed. An owed node is then
 * simulated `completed`, so the nodes behind it are judged too rather than
 * passed as blocked. What the loop never reaches waits on a need that ended
 * `failed` or `stopped` and that its `on` does not accept: it can never run, so
 * it is not owed.
 *
 * The edges are the freeze's. `on` and `when` are the re-resolved definition's,
 * and only when it hashes to the freeze: under drift nothing the re-read says is
 * trusted, so every node keeps the default `on`, no guard is evaluated, and
 * `drift` says so. `graph` is that trusted graph, for the reader that checks
 * declared artifacts, and null under drift.
 */
export function atClose({ doc, runDir }) {
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const ids = Object.keys(recorded);
  if (!ids.length) return { owed: [], graph: null, drift: false };

  const current = reread(doc, workflow, runDir);
  const graph = current.drift ? null : current.graph;
  const byId = new Map((graph?.nodes ?? []).map(entry => [entry.id, entry]));
  const recordedStatus = id => entryOf(recorded, id).status ?? 'pending';
  const status = new Map(ids.map(id => [id, recordedStatus(id)]));
  const owed = new Map();
  const owe = (id, guard = null) => {
    owed.set(id, { id, status: recordedStatus(id), guard });
    status.set(id, 'completed');
  };

  for (const id of ids) {
    if (status.get(id) !== 'pending' && !ENDED.has(status.get(id))) owe(id);
  }
  for (;;) {
    let next = null;
    let decision = 'waiting';
    for (const id of ids) {
      if (status.get(id) !== 'pending') continue;
      decision = readiness(needsOf(recorded, byId, id).map(need => status.get(need)), byId.get(id)?.on);
      if (decision !== 'waiting') {
        next = id;
        break;
      }
    }
    if (next === null) break;
    if (decision === 'skip') {
      status.set(next, 'skipped');
      continue;
    }
    const when = byId.get(next)?.when;
    if (typeof when !== 'string') {
      owe(next);
      continue;
    }
    const guard = evaluate(when, { byId, recorded, status, inputs: inputsOf(doc), defaults: current.defaults });
    if (guard.ok && !guard.value) status.set(next, 'skipped');
    else owe(next, guard.ok ? null : when);
  }
  return { owed: ids.filter(id => owed.has(id)).map(id => owed.get(id)), graph, drift: current.drift };
}

/**
 * One pending node's readiness, from its needs' statuses and its `on`: `ready`,
 * `waiting`, or `skip` — taken off the path by the rule itself, which is allowed
 * and satisfies what follows, exactly like a false guard. `skip` is an
 * `on: failure` node whose needs all ended well: nothing failed, so there is
 * nothing to recover. The one ready-set rule both readers ask — `walk` for a
 * gate's `Next:` line and `atClose` for what a run still owes.
 */
function readiness(needStatuses, on) {
  if (!needStatuses.every(state => settles(state, on))) return 'waiting';
  if (on === 'failure' && !needStatuses.some(state => ENDED_BADLY.has(state))) return 'skip';
  return 'ready';
}

// ---------------------------------------------------------------------------
// the recommendation and the rendering
// ---------------------------------------------------------------------------

/**
 * The continue option, unless a closing risk opens `recommend stop:` — then the
 * first stop option. Without the options the line names the role, not an id.
 */
function recommend(options, risks) {
  const stop = risks.some(isStopRisk);
  return (stop ? optionWith(options, 'stop') : null) ?? optionWith(options, 'continue') ?? RECOMMENDED_UNKNOWN;
}

/**
 * One list item on one line. A map is its non-empty scalar values in written
 * order, joined by an em dash, so `{decision, rationale}` reads as a sentence.
 * `readable` also drops what only a machine reads: a leading slug key, and a
 * map value that is nothing but a slug.
 */
function itemText(item, readable = false) {
  if (isPlainObject(item)) {
    if (Object.hasOwn(item, 'risk')) {
      const risk = riskOf(item);
      return risk ? riskText(risk) : '';
    }
    const decision = decisionOf(item);
    return decision ? decisionText(decision) : '';
  }
  const text = scalarText(item);
  return readable ? text.replace(SLUG_KEY, '') : text;
}

function scalarText(value) {
  if (typeof value === 'string') return value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * A list item as the plain form shows it: its lead — a map's first readable
 * value, a string less any slug key — cut to its first sentence.
 */
function headlineOf(item) {
  let lead = itemText(item, true);
  if (isPlainObject(item)) lead = Object.hasOwn(item, 'risk') ? riskOf(item)?.risk ?? '' : decisionOf(item)?.decision ?? '';
  return headline(lead);
}

/** Whether a risk item, in any shape a run wrote it, recommends stopping. */
function isStopRisk(item) {
  return riskOf(item)?.tag === 'stop';
}

/**
 * `text` up to the end of its first sentence, cut at a word to `HEADLINE_MAX`.
 * A dash ends no sentence, so `recommend stop: critical — <reason>` keeps the
 * reason the recommendation rests on; nor does the stop of an abbreviation.
 */
function headline(text) {
  let end = text.length;
  for (const match of text.matchAll(SENTENCE_END)) {
    if (ABBREVIATION.test(text.slice(0, match.index))) continue;
    end = match.index + match[0].length;
    break;
  }
  return clip(text.slice(0, end).trimEnd(), HEADLINE_MAX);
}

/** The pointer the driven form leaves where something was trimmed. */
function more(count, where, unit = '') {
  return `(+${count} more${unit ? ` ${unit}` : ''} — ${where})`;
}

/** `text` cut short, never inside a surrogate pair. */
function sliced(text, room) {
  const cut = text.slice(0, room);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * `text` cut to at most `max` characters at a word, the cut named with the
 * exact count it removed — the driven form's cut. When `max` leaves no room
 * for the note beside some of the text, nothing is kept at all: the note alone
 * would overrun the budget it is there to keep.
 */
function shorten(text, max, where) {
  if (text.length <= max) return text;
  // Sized for the largest count it could report, so the real one never makes it longer.
  const room = max - ` … ${more(text.length, where, 'characters')}`.length;
  if (room <= 0) return '';
  const cut = sliced(text, room);
  const word = cut.lastIndexOf(' ');
  const kept = (word > room / 2 ? cut.slice(0, word) : cut).trimEnd();
  return `${kept} … ${more(text.length - kept.length, where, 'characters')}`;
}

/**
 * `text` cut to at most `max` characters at the end of a sentence — at a word
 * when no sentence ends far enough in — followed by `… (more in <place>)`: the
 * plain form's cut, which says where the rest is rather than how long it was.
 */
function toSentence(text, max, where) {
  if (text.length <= max) return text;
  const note = ` … (more in ${where})`;
  const room = max - note.length;
  if (room <= 0) return '';
  const cut = sliced(text, room);
  let end = -1;
  for (const match of text.matchAll(SENTENCE_END)) {
    if (match.index + match[0].length > cut.length) break;
    end = match.index + match[0].length;
  }
  const word = cut.lastIndexOf(' ');
  const kept = end > room / 3 ? cut.slice(0, end) : (word > room / 2 ? cut.slice(0, word) : cut).trimEnd();
  return `${kept}${note}`;
}

/**
 * How each form draws and trims. The driven form is the shape a cockpit and a
 * driver have always read and is kept as it was: every list item whole, the stop
 * risk moved first only when trimming starts, and each cut counted. The plain
 * form shows at most `LIST_CAP` of each list, each item by its headline, with
 * the stop risk always first, and says where the rest is.
 */
const DRIVEN = {
  // Each item says what it is, so a reader of the one line can tell a choice
  // the analysis made from one a person made, and an open item from a
  // trade-off already accepted, without the item's own wording saying so.
  decision: item => {
    const decision = decisionOf(item);
    return decision ? `${decision.by}: ${decisionText(decision)}` : '';
  },
  risk: item => {
    const risk = riskOf(item);
    return risk ? `${risk.tag}: ${riskText(risk)}` : '';
  },
  cap: Infinity,
  stopFirst: false,
  cut: shorten,
  pointer: (count, where) => more(count, where),
  render: renderOneline,
};
const READABLE = {
  decision: headlineOf,
  risk: headlineOf,
  cap: LIST_CAP,
  stopFirst: true,
  cut: toSentence,
  pointer: (count, where) => `(+${count} more in ${where})`,
  render: renderPlain,
};

/**
 * The brief rendered inside `BUDGET`. Nothing is trimmed from one that fits
 * beyond the form's own list cap. Otherwise a risk that recommends stopping
 * moves to the front of the risks, so the reason for the recommendation is the
 * last risk to go, and then, in order, until it fits: each list item is cut to
 * `ITEM_MAX`; the summary gives up what it can down to `SUMMARY_FLOOR`;
 * decisions are dropped from the end down to one, then risks down to one, then
 * the last decision, then the last risk; the summary gives up the rest; and last
 * the pointers the drops left go too. `tail` is never touched, so a tail longer
 * than the budget on its own is the one brief that exceeds it. Whatever the
 * summary gives up, `drawSummary` spreads over its sections.
 */
function fit(closing, form, tail, where) {
  const sections = closing.sections.map(({ title, text }) => ({ title, text: text.trim() }));
  const summary = drawSummary(sections, Infinity);
  const decisions = closing.decisions.map(form.decision).filter(text => text !== '');
  const rendered = raw => raw.map(form.risk).filter(text => text !== '');
  let risks = rendered(closing.risks);
  // A risk that decides the recommendation has to stay in view: it moves first,
  // read off the item itself rather than its rendered text.
  const stopFirst = () => {
    risks = rendered([...closing.risks.filter(isStopRisk), ...closing.risks.filter(risk => !isStopRisk(risk))]);
  };
  if (form.stopFirst) stopFirst();
  const view = {
    summary: summary.length,
    item: Infinity,
    decisions: Math.min(decisions.length, form.cap),
    risks: Math.min(risks.length, form.cap),
    pointers: true,
  };
  const list = (values, count) => {
    const kept = values.slice(0, count).map(text => form.cut(text, view.item, where));
    const rest = values.length - count;
    return { kept, rest: rest > 0 && view.pointers ? form.pointer(rest, where) : null };
  };
  const draw = () => form.render({
    summary: drawSummary(sections, view.summary, form.cut, where),
    decisions: list(decisions, view.decisions),
    risks: list(risks, view.risks),
    tail,
  });

  let text = draw();
  if (text.length <= BUDGET) return text;
  stopFirst();
  view.item = ITEM_MAX;
  text = draw();
  if (text.length > BUDGET && summary.length > SUMMARY_FLOOR) {
    view.summary = Math.max(SUMMARY_FLOOR, summary.length - (text.length - BUDGET));
    text = draw();
  }
  const drops = [
    () => view.decisions > 1 && view.decisions--,
    () => view.risks > 1 && view.risks--,
    () => view.decisions > 0 && view.decisions--,
    () => view.risks > 0 && view.risks--,
  ];
  for (const drop of drops) {
    while (text.length > BUDGET && drop()) text = draw();
  }
  if (text.length > BUDGET) {
    view.summary = Math.max(0, view.summary - (text.length - BUDGET));
    text = draw();
  }
  if (text.length > BUDGET) {
    view.pointers = false;
    text = draw();
  }
  return text;
}

/**
 * The summary within `room` characters: every section whole when they fit, and
 * otherwise each body cut by `cut` to its share of the room — the short ones
 * kept whole, the rest given equal shares — so a long section never pushes
 * another out of the brief. A section is named by its title, which is never
 * cut; one whose share leaves nothing of its body is left out.
 */
function drawSummary(sections, room, cut = null, where = '') {
  const label = section => (section.title === null ? '' : `${section.title}: `);
  const whole = sections.map(section => `${label(section)}${section.text}`).join(SECTION_BREAK);
  if (whole.length <= room) return whole;
  const fixed = sections.reduce((sum, section) => sum + label(section).length, 0)
    + SECTION_BREAK.length * (sections.length - 1);
  const caps = shares(sections.map(section => section.text.length), Math.max(0, room - fixed));
  return sections
    .map((section, index) => ({ section, body: cut(section.text, caps[index], where) }))
    .filter(({ body }) => body !== '')
    .map(({ section, body }) => `${label(section)}${body}`)
    .join(SECTION_BREAK);
}

/**
 * `room` split across sections of `lengths`: shortest first, each taking its
 * whole length or an equal share of what is left, whichever is less.
 */
function shares(lengths, room) {
  const caps = new Array(lengths.length);
  const order = lengths.map((_, index) => index).sort((a, b) => lengths[a] - lengths[b]);
  let left = room;
  order.forEach((index, rank) => {
    caps[index] = Math.min(lengths[index], Math.floor(left / (order.length - rank)));
    left -= caps[index];
  });
  return caps;
}

/**
 * The plain form: the summary, then the decisions and the risks — a heading
 * carrying any pointer to the rest, and one item to a line under it — then
 * `Next:`.
 */
function renderPlain({ summary, decisions, risks, tail }) {
  const out = [summary];
  const list = (label, { kept, rest }) => {
    if (!kept.length && !rest) return;
    out.push(`${label}${rest ? ` ${rest}` : ''}${kept.length ? ':' : ''}`, ...kept.map(text => `- ${text}`));
  };
  list('Decisions', decisions);
  list('Risks', risks);
  out.push(...tail);
  return `${out.filter(text => text !== '').join('\n')}\n`;
}

/**
 * The driven form: one line a gate request's `context.summary` can carry. The
 * request writer refuses a newline or a double quote in a flow scalar, so every
 * line break folds to a space and every `"` becomes `'`.
 */
function renderOneline({ summary, decisions, risks, tail }) {
  const all = ({ kept, rest }) => (rest ? [...kept, rest] : kept);
  const sections = [summary];
  if (all(decisions).length) sections.push(`Decisions: ${all(decisions).join('; ')}`);
  if (all(risks).length) sections.push(`Risks: ${all(risks).join('; ')}`);
  sections.push(...tail);
  const line = sections.join(' · ').replace(/\s*[\r\n]+\s*/g, ' ').replace(/"/g, "'").trim();
  return `${line}\n`;
}
