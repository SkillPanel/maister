/**
 * The `finding-brief` verb: a reviewer's findings, each rendered as one
 * question of the reviewing node's question set.
 *
 * Why this module exists. A node that runs a review used to turn each finding
 * into a question itself, so what the terminal asked and what a cockpit was
 * sent were two model-written texts, and a finding could reach the operator as
 * an open "what now?" with no choices. The reviewer now writes its findings as
 * data — each with the fix it proposes and up to two alternatives — and this
 * verb checks that file and builds the set from it, adding the one choice every
 * finding offers: accept the risk and list it.
 *
 * The contract. `--state` and `--node` name the run and the reviewing node that
 * is asking; `--findings-file` names the findings list, resolved against the
 * run directory when relative and required to resolve inside it. Without
 * `--patch-file` the set, `{questions: [...]}`, is the verb's output; with it,
 * the set is written to the patch file for `gate-brief --request --patch-file`
 * or the classing write to take.
 *
 * The findings list is JSON with closed keys: `{findings: [...]}`, a non-empty
 * list, each finding `{id, severity, title, evidence, options, recommended,
 * reason}`. `id` is a kebab id, unique in the list; `severity` one of
 * `SEVERITIES`; `title` and `evidence` text, the title one line; `options` one
 * to three `{label, description}`, the first the reviewer's proposed fix, the
 * labels one line, unique in the finding and never the accept label;
 * `recommended` an option index, `"accept"`, or null; `reason` the text the
 * recommendation rests on, required when one is made.
 *
 * Each finding is one question, ordered by severity and otherwise as listed:
 * id `<node>-findings-<finding id>` — the prose's declared id plus the
 * finding's — its id in words as its header (`empty-upload` reads "Empty
 * upload"), since a chip holds a name and not a sentence, the title in its
 * question, the evidence as its why, the
 * reviewer's options as `option-1..n`, then `accept-risk`. The recommended
 * option carries `recommended: true` and the reason at the end of its
 * description; with no recommendation nothing is recommended and the set names
 * no default. The verb never classes: no `triage` is written — the classing
 * write classes the set it is sent.
 *
 * Checks run in one order: the state, the node, whether it runs, the declared
 * id, then the file. A file that cannot be used is a fallback, never a refusal: one warning,
 * exit 0 and nothing to paste, so the node asks its findings itself.
 * `finding-list-missing:<path>` (no file, or `:outside-run` for a path that
 * leaves the run directory), `finding-list-invalid:<path>:<detail>` (not JSON,
 * or the first shape violation, its location as the detail) and
 * `finding-list-unwritable:<run-relative patch path>:<error code>` (the patch
 * write failed, its temp removed).
 *
 * The refusals, none of them fixed by a state write; each says nothing was
 * written. `finding-brief-state-unreadable` (the run is not where the caller
 * thinks), `finding-brief-unknown-node` (no node of the run, or a gate),
 * `finding-brief-not-running` (only a running node asks) and
 * `finding-brief-undeclared` (the node's prose declares no `<node>-findings`
 * question id, so the set would carry ids no policy row or prose names).
 *
 * Reads only: no state write and no `display/next.json` — the patch file is its
 * one write. Returns `{ok, …, errors, warnings}` and leaves printing to
 * `workflow.mjs`. `node:` builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal, openTemp } from '../../../../lib/canonical.mjs';
import { parse, isPlainObject } from './state-read.mjs';
import { definitionPathOf } from './state.mjs';
import { declaredQuestionIds } from './question-triage.mjs';
import { clipHeader } from './question-set.mjs';
import { oneLine } from './items.mjs';

/** The severities a finding may carry, most severe first: the order the questions are asked in. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'warning', 'info'];

/** The choice every finding offers after the reviewer's own. */
export const ACCEPT_OPTION = {
  id: 'accept-risk',
  label: 'Accept the risk and list it',
  description: 'Leave it as it is; it is listed as a tradeoff at the next checkpoint',
};

/** The `recommended` value that recommends accepting the risk. */
const ACCEPT = 'accept';

/** The suffix of the question id a reviewing node's prose declares. */
const DECLARED_SUFFIX = '-findings';

/** The most options a reviewer may propose for one finding. */
const OPTIONS_MAX = 3;

const FINDINGS_KEYS = ['findings'];
const FINDING_KEYS = ['id', 'severity', 'title', 'evidence', 'options', 'recommended', 'reason'];
const OPTION_KEYS = ['label', 'description'];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const WARNING = {
  missing: 'finding-list-missing',
  invalid: 'finding-list-invalid',
  unwritable: 'finding-list-unwritable',
};

/** The names `openTemp` refuses under; a live writer's temp is reported as `EEXIST`. */
const TEMP_CODES = { unwritable: WARNING.unwritable, tempExists: WARNING.unwritable };

const isText = value => typeof value === 'string' && value.trim() !== '';
const isLine = value => isText(value) && !/[\r\n]/.test(value);

/**
 * The reviewing node's findings as its question set: printed (`set`) when
 * `patchFile` is null, else written there (`file`).
 */
export function findingBrief({ state, node, findingsFile, patchFile = null }) {
  let doc;
  try {
    doc = parse(fs.readFileSync(state, 'utf8'));
  } catch (err) {
    return refuse('finding-brief-state-unreadable',
      `${state} cannot be read as a state document: ${err.message}. Nothing was written. Point --state at the run's orchestrator-state.yml`);
  }
  const workflow = isPlainObject(doc.workflow) ? doc.workflow : {};
  const recorded = isPlainObject(workflow.nodes) ? workflow.nodes : {};
  const entry = Object.hasOwn(recorded, node) && isPlainObject(recorded[node]) ? recorded[node] : null;
  if (entry === null || entry.kind === 'gate') {
    return refuse('finding-brief-unknown-node',
      entry === null
        ? `--node=${node} names no node of this run (workflow.nodes has no "${node}"). Nothing was written. Name the reviewing node that is asking`
        : `--node=${node} is a gate, and a gate is asked from its own brief. Nothing was written. Name the reviewing node that is asking`);
  }
  if ((entry.status ?? 'pending') !== 'running') {
    return refuse('finding-brief-not-running',
      `--node=${node} is ${JSON.stringify(entry.status ?? 'pending')}, and only a running node asks. Nothing was written. `
      + 'Name the node that is asking, or start it first');
  }

  const runDir = path.dirname(path.resolve(state));
  const declared = `${node}${DECLARED_SUFFIX}`;
  const definition = definitionPathOf(doc, runDir);
  if (!declaredQuestionIds(definition, node).includes(declared)) {
    const prose = definition === null ? 'the run\'s definition, which cannot be found' : definition.replace(/\.ya?ml$/i, '.md');
    return refuse('finding-brief-undeclared',
      `--node=${node} declares no "${declared}" question id in ${prose}. Nothing was written. `
      + `Ask the findings as the node's prose says, or declare "${declared}" on its With and Without question sets lines`);
  }

  const loaded = loadFindings(findingsFile, runDir);
  if (loaded.warning) return fallback(loaded.warning);
  const questions = order(loaded.findings).map(finding => questionOf(finding, declared));
  if (patchFile === null) return { ok: true, set: { questions }, errors: [], warnings: [] };
  return publish({ questions }, patchFile, runDir);
}

/**
 * The findings list at `given`, checked: `{findings}` or `{warning}`. The path
 * is resolved against the run directory and must stay inside it.
 */
function loadFindings(given, runDir) {
  const file = path.resolve(runDir, given);
  const relative = path.relative(runDir, file);
  if (relative === '' || relative.split(path.sep)[0] === '..' || path.isAbsolute(relative)) {
    return { warning: `${WARNING.missing}:${given.split(path.sep).join('/')}:outside-run` };
  }
  const where = relative.split(path.sep).join('/');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { warning: `${WARNING.missing}:${where}` };
    return { warning: `${WARNING.invalid}:${where}:unreadable` };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { warning: `${WARNING.invalid}:${where}:not-json` };
  }
  const fault = shapeFault(data);
  return fault === null ? { findings: data.findings } : { warning: `${WARNING.invalid}:${where}:${fault}` };
}

/** The location of the first shape violation, or null when the list is sound. */
function shapeFault(data) {
  if (!isPlainObject(data)) return '(root)';
  const extra = Object.keys(data).find(key => !FINDINGS_KEYS.includes(key));
  if (extra !== undefined) return extra;
  if (!Array.isArray(data.findings) || data.findings.length === 0) return 'findings';
  const ids = new Set();
  for (const [index, finding] of data.findings.entries()) {
    const at = `findings[${index}]`;
    if (!isPlainObject(finding)) return at;
    const unknown = Object.keys(finding).find(key => !FINDING_KEYS.includes(key));
    if (unknown !== undefined) return `${at}.${unknown}`;
    if (typeof finding.id !== 'string' || !ID.test(finding.id) || ids.has(finding.id)) return `${at}.id`;
    ids.add(finding.id);
    if (!SEVERITIES.includes(finding.severity)) return `${at}.severity`;
    if (!isLine(finding.title)) return `${at}.title`;
    if (!isText(finding.evidence)) return `${at}.evidence`;
    if (!Array.isArray(finding.options) || finding.options.length === 0 || finding.options.length > OPTIONS_MAX) return `${at}.options`;
    const labels = new Set([ACCEPT_OPTION.label]);
    for (const [i, option] of finding.options.entries()) {
      const on = `${at}.options[${i}]`;
      if (!isPlainObject(option)) return on;
      const stray = Object.keys(option).find(key => !OPTION_KEYS.includes(key));
      if (stray !== undefined) return `${on}.${stray}`;
      if (!isLine(option.label) || labels.has(option.label.trim())) return `${on}.label`;
      labels.add(option.label.trim());
      if (!isText(option.description)) return `${on}.description`;
    }
    const recommended = finding.recommended;
    const pick = recommended === null || recommended === undefined || recommended === ACCEPT
      || (Number.isInteger(recommended) && recommended >= 0 && recommended < finding.options.length);
    if (!pick) return `${at}.recommended`;
    const recommends = recommended !== null && recommended !== undefined;
    if (recommends ? !isText(finding.reason) : finding.reason !== undefined && finding.reason !== null && typeof finding.reason !== 'string') {
      return `${at}.reason`;
    }
  }
  return null;
}

/** The findings by severity, most severe first, the list's own order kept within one. */
function order(findings) {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITIES.indexOf(a.finding.severity) - SEVERITIES.indexOf(b.finding.severity) || a.index - b.index)
    .map(each => each.finding);
}

/** One finding as one question of the set. */
function questionOf(finding, declared) {
  const title = finding.title.trim();
  const severity = sentence(finding.severity);
  const evidence = oneLine(finding.evidence);
  const recommends = finding.recommended !== null && finding.recommended !== undefined;
  const reason = recommends ? oneLine(finding.reason) : null;
  const choices = [
    ...finding.options.map((option, index) => ({
      id: `option-${index + 1}`, label: option.label.trim(), description: option.description.trim(), pick: index,
    })),
    { ...ACCEPT_OPTION, pick: ACCEPT },
  ];
  const options = choices.map(({ pick, ...option }) => (recommends && pick === finding.recommended
    ? { ...option, description: `${closed(option.description)} Recommended: ${reason}`, recommended: true }
    : option));
  return {
    id: `${declared}-${finding.id}`,
    header: headerOf(finding.id),
    question: `${title} — how should it be settled?`,
    why: `${severity}: ${evidence}`,
    multi_select: false,
    options,
    details: detailsOf({ title, severity, evidence: finding.evidence.trim(), choices, recommended: recommends ? finding.recommended : null, reason }),
  };
}

/** The finding's full write-up, the text More details shows. */
function detailsOf({ title, severity, evidence, choices, recommended, reason }) {
  const lines = [`**${title}**`, '', `**Severity**: ${severity}`, '', `**Evidence**: ${evidence}`, '', '**Choices**'];
  for (const choice of choices) {
    const mark = recommended !== null && choice.pick === recommended ? ' (recommended)' : '';
    lines.push(`- **${choice.label}**${mark} — ${choice.description}`);
  }
  if (reason !== null) lines.push('', `**Why recommended**: ${reason}`);
  return lines.join('\n');
}

/** Text ending in a full stop, so a sentence can follow it. */
function closed(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function sentence(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Write the set to the patch file through the engine's publish path: the temp
 * opened exclusively, fsynced and renamed over the patch file. A failed write
 * removes only the temp it created and is a fallback, never a throw.
 */
function publish(set, file, runDir) {
  const tmp = `${file}.tmp`;
  let fd = null;
  let opened = false;
  try {
    fd = openTemp({ tmp, codes: TEMP_CODES });
    opened = true;
    fs.writeFileSync(fd, `${JSON.stringify(set, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor is abandoned either way.
      }
    }
    if (opened) fs.rmSync(tmp, { force: true });
    const code = err instanceof Refusal ? 'EEXIST' : (err?.code ?? 'error');
    const where = path.relative(runDir, file).split(path.sep).join('/');
    return fallback(`${WARNING.unwritable}:${where}:${code}`);
  }
  return { ok: true, file, errors: [], warnings: [] };
}

function fallback(warning) {
  return { ok: true, fallback: true, errors: [], warnings: [warning] };
}

function refuse(code, message) {
  return { ok: false, errors: [{ code, message: `${code}: ${message}` }], warnings: [] };
}

/** A finding's chip: its kebab-case id as words, sentence case, clipped to a header's length. */
function headerOf(id) {
  const words = id.split('-').join(' ');
  return clipHeader(words.charAt(0).toUpperCase() + words.slice(1));
}
