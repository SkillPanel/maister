/**
 * The `area-brief` verb: one decision area of a brainstorm, rendered for the
 * convergence node that asks it.
 *
 * Why this module exists. A convergence node used to compose each decision
 * area's question from the brainstorm's markdown, so what the terminal asked
 * and what a cockpit was sent were two model-written texts. The brainstorm now
 * writes its areas as data, and this verb finds that file for the asking node,
 * checks it, and prints what `decision-areas.mjs` renders from it. It is a
 * module of its own so that the gate brief, whose output is pinned, gains no
 * more than the one export it shares (`reread`).
 *
 * The contract. `--state` and `--node` name the run and the convergence node
 * that is asking, and the flags pick one form:
 *
 *     picker     --area=<id> --json [--picker=rich|plain]   the in-session
 *                picker as JSON, the field shape of `gate-brief --json`, its
 *                answer recorded as `convergence-decisions-<area id>`
 *     write-up   --area=<id>        the area's full write-up as markdown, the
 *                text the picker's More details shows
 *     set        --patch-file=<run>/.state-patch.json, --area repeated or not:
 *                every area as a driven question set, written to the patch file
 *
 * Only the set form classes an area: each entry carries the `triage` the
 * policy on disk gives the declared question id `convergence-decisions`, when
 * the run's recorded policy hash is that policy's own. A policy that changed
 * since the freeze classes nothing and warns `policy-hash-mismatch:<node>`
 * once; a refused one relays `policy-refused`. The class never comes from the
 * file.
 *
 * The file is found through the asking node's `with: decision_areas` in the
 * frozen definition, re-read and re-resolved as the gate brief does — the
 * re-read graph is used even when the definition drifted. The value must be
 * exactly `${<producer>.artifacts.decision_areas}`, the producer one of the
 * node's needs and `completed` in state; the path is the producer's declared
 * artifact under the run directory. Nothing is interpolated, so a producer
 * that was skipped is never read.
 *
 * Checks run in one order: the state, the node, the file, then the area ids.
 * A file that cannot be used is a fallback, never a refusal: one warning,
 * `decision-areas-<missing|unreadable|invalid|stale>:<path>[:<detail>]`, exit
 * 0, and nothing to paste — `{ok: true, fallback: true}` under `--json`,
 * nothing on stdout otherwise — so the node composes the area itself. Every
 * miss before a path is known reads `decision-areas-missing:not-declared`; a
 * producer not completed reads `decision-areas-missing:<path>:producer-not-completed`.
 *
 * The refusals, none of them fixed by a state write; each says nothing was
 * written. The invocation is wrong: `area-brief-unknown-node` (no node of the
 * run, or a gate) and `area-brief-not-running` (only a running node asks). The
 * run is not where the caller thinks: `area-brief-state-unreadable`. The area
 * is not in the file: `area-brief-unknown-area`, judged only after the file
 * passed, whose message lists the file's ids in order.
 *
 * Reads only: no state write and no `display/next.json` — the set form's patch
 * file is its one write. Pure apart from those reads; returns `{ok, …, errors,
 * warnings}` and leaves printing to `workflow.mjs`. `node:` builtins and engine
 * libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse, isPlainObject } from './state-read.mjs';
import { reread } from './gate-brief.mjs';
import { QUESTION_PREFIX, WARNING, areaDetails, areaEntry, areaPicker, loadAreas } from './decision-areas.mjs';
import { loadPolicy, triageFor } from './policy.mjs';

/** The one reference a convergence node may name its areas by: the producer's declared artifact, whole. */
const REFERENCE = /^\$\{([a-z][a-z0-9-]*)\.artifacts\.decision_areas\}$/;

/** The question id both convergence nodes declare; each area's own id is it plus `-<area id>`. */
const DECLARED_ID = QUESTION_PREFIX.replace(/-$/, '');

/** Every miss before a path is known. */
const NOT_DECLARED = `${WARNING.missing}:not-declared`;

/**
 * One area of the run's decision areas in the form asked for: `form` is
 * `picker`, `write-up` or `set`; `areas` the `--area` ids (exactly one for the
 * first two forms, which the entry point checks); `picker` the profile.
 */
export function areaBrief({ state, node, areas: ids = [], form, picker = 'rich', patchFile = null }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('area-brief-state-unreadable',
      `${state} cannot be read as a state document: ${err.message}. Nothing was written. Point --state at the run's orchestrator-state.yml`);
  }
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const entry = Object.hasOwn(recorded, node) && isPlainObject(recorded[node]) ? recorded[node] : null;
  if (entry === null || entry.kind === 'gate') {
    return refuse('area-brief-unknown-node',
      entry === null
        ? `--node=${node} names no node of this run (workflow.nodes has no "${node}"). Nothing was written. Name the convergence node that is asking`
        : `--node=${node} is a gate, and a gate is asked from its own brief. Nothing was written. Name the convergence node that is asking`);
  }
  if ((entry.status ?? 'pending') !== 'running') {
    return refuse('area-brief-not-running',
      `--node=${node} is ${JSON.stringify(entry.status ?? 'pending')}, and only a running node asks. Nothing was written. `
      + 'Name the node that is asking, or start it first');
  }

  const runDir = path.dirname(path.resolve(state));
  const located = locate(doc, workflow, recorded, node, runDir);
  if (located.warning) return fallback(located.warning);
  const loaded = loadAreas({ file: located.file, taskDir: runDir });
  if (loaded.warning) return fallback(loaded.warning);

  const all = loaded.areas;
  const known = new Set(all.map(area => area.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) {
    return refuse('area-brief-unknown-area',
      `--area=${unknown.join(', ')} names no area of ${located.relative}, whose areas are, in order: ${all.map(area => area.id).join(', ')}. `
      + 'Nothing was written. Take the area ids from that file');
  }

  if (form === 'set') return driven({ doc, workflow, node, all, ids, runDir, patchFile });
  const area = all.find(candidate => candidate.id === ids[0]);
  if (form === 'picker') return areaPicker(area, all, picker);
  return { ok: true, text: areaDetails(area, all), errors: [], warnings: [] };
}

/**
 * Where the asking node's decision areas are: `{file, relative}`, or
 * `{warning}` for the fallback. Read off the re-resolved definition, since the
 * frozen state carries no `with:` and no declared artifacts.
 */
function locate(doc, workflow, recorded, node, runDir) {
  const { graph } = reread(doc, workflow, runDir);
  const byId = new Map((graph?.nodes ?? []).map(entry => [entry.id, entry]));
  const asking = byId.get(node);
  const reference = asking?.with?.decision_areas;
  const match = typeof reference === 'string' ? REFERENCE.exec(reference) : null;
  if (!match) return { warning: NOT_DECLARED };
  const producer = match[1];
  if (!Array.isArray(asking.needs) || !asking.needs.includes(producer)) return { warning: NOT_DECLARED };
  const declared = byId.get(producer)?.outputs?.artifacts?.decision_areas;
  if (typeof declared !== 'string' || declared === '' || path.isAbsolute(declared) || declared.split(/[\\/]/).includes('..')) {
    return { warning: NOT_DECLARED };
  }
  const relative = declared.split(/[\\/]/).join('/');
  const status = isPlainObject(recorded[producer]) ? recorded[producer].status : undefined;
  if (status !== 'completed') return { warning: `${WARNING.missing}:${relative}:producer-not-completed` };
  return { file: path.join(runDir, ...relative.split('/')), relative };
}

/**
 * The driven set: every area — or only the `--area` ones, in file order — as
 * the asking node's question set, `{questions: [...]}`, written whole to the
 * patch file (temp file, then rename) so `gate-brief --request --patch-file`
 * builds the one request. No `ask`, `headline` or `default`: the request
 * generates them, the default from each recommendation. Whatever the file held
 * is replaced. Returns the file for the entry point to print.
 */
function driven({ doc, workflow, node, all, ids, runDir, patchFile }) {
  const chosen = ids.length ? all.filter(area => ids.includes(area.id)) : all;
  const questions = chosen.map(area => areaEntry(area, all));
  const warnings = classify(doc, workflow, node, questions);
  const file = patchFile ?? path.join(runDir, '.state-patch.json');
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ questions }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { ok: true, file, errors: [], warnings };
}

/**
 * Each entry's `triage`, from the policy on disk and never from the file: the
 * class the policy gives the declared question id, set only when the run's
 * recorded policy hash is that policy's own and left out when the policy
 * classes nothing. When the hashes differ and the policy would class an entry,
 * no entry is classed and one `policy-hash-mismatch:<node>` warning is raised.
 * A refused policy relays its `policy-refused` warning. Returns the warnings.
 */
function classify(doc, workflow, node, questions) {
  const { policy, hash, warnings } = loadPolicy();
  const recorded = isPlainObject(doc.orchestrator) ? doc.orchestrator.policy_hash : undefined;
  const matches = typeof recorded === 'string' && recorded === hash;
  const classes = questions.map(question => triageFor({
    policy, workflow: workflow.name, kind: 'question', id: question.id, declaredIds: [DECLARED_ID],
  }));
  const raised = [...warnings];
  if (!classes.some(triage => triage !== null)) return raised;
  if (!matches) return [...raised, `policy-hash-mismatch:${node}`];
  for (const [i, triage] of classes.entries()) if (triage !== null) questions[i].triage = triage;
  return raised;
}

function fallback(warning) {
  return { ok: true, fallback: true, errors: [], warnings: [warning] };
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}
