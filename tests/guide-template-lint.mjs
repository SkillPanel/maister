#!/usr/bin/env node
/**
 * The workflow guide template lint: every guide — the `<name>.md` beside a
 * workflow definition — holds its H1, one paragraph, then one section per node
 * that needs prose, each written in the fixed step template.
 *
 * Why it exists: a step's brief is the engine's derived facts plus the step's
 * own section, so a section that restates a convention, hides a question-set
 * line outside its Asks part or names a node the graph does not carry is read
 * by every step that slices it. The template is checked here, against the
 * resolved graph and the merged `brief:` block, rather than left to review.
 *
 * Usage: `node tests/guide-template-lint.mjs [--definition=<yml> ...]`. With no
 * argument it checks the five built-in workflows. A definition other than a
 * built-in may carry `Embedded mode` as its only shared section.
 *
 * Output: one `FAIL: <file>:<line>: <node or header>: <what>` line per failure,
 * and one `warning: <file>:<line>: <node>: <part> is N words (target M)` line
 * per word count over its target. Word targets are guidance and never fail.
 * Exit 1 after printing every failure, 0 when there is none (warnings alone
 * exit 0), and 2 on the script's own error — an unreadable definition, a graph
 * that does not resolve, a guide that is missing, or a usage error.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies beyond the engine's own modules, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readDefinition } from '../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { resolve, sectionNameOf } from '../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { briefOf } from '../plugins/maister/skills/workflow-engine/scripts/lib/brief.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, 'plugins/maister/skills/workflow-engine/workflows');

/** The shared H2 sections each built-in may carry beside its node sections. */
const BUILT_INS = {
  development: [],
  migration: [],
  performance: [],
  'product-design': ['The context block', 'Depth', 'Embedded mode'],
  research: ['Embedded mode'],
};

/** The only shared H2 any other definition may carry. */
const OTHER_SHARED = ['Embedded mode'];

/** The six parts of a step section, in their order. */
const PARTS = ['Does', 'Asks', 'Writes', 'Summary', 'Re-run', 'Budget'];

/** The one part a gate section may hold. */
const EXCEPTION = 'Exception';

/** Word targets per part; the Asks run-in's target is per declared question id. */
const TARGETS = { Does: 120, Writes: 60, Summary: 80, 'Re-run': 60, Budget: 30, [EXCEPTION]: 80 };
const RUN_IN_PER_ID = 40;
const SECTION_TARGET = 450;

/** A paragraph's bold run-in label: `**Does.**`. */
const LABEL = /^\*\*([^*]+?)\.\*\*/;

/** A question-set marker anywhere in a line, and one opening its line. */
const MARKER = /\*\*(With|Without) question sets\*\*/;
const MARKER_START = /^\*\*(With|Without) question sets\*\*(?:\s*\(([^)]*)\))?/;
const QUESTION_ID = /`([a-z0-9-]+)`/;

/** An opening or closing code fence. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** A node section heading: an H2 whose whole text is one backticked name. */
const NODE_HEADING = /^##\s+`([^`]+)`\s*$/;

/** Text a guide never carries, because a convention row of the engine skill states it. */
const RESTATED = [
  [/\*\*Gate brief content\.?\*\*/, '**Gate brief content**'],
  [/\*\*When re-run after a revise\.?\*\*/, '**When re-run after a revise**'],
  [/\*\*Recovery budget\.?\*\*/, '**Recovery budget**'],
  [/Ask it from `gate-brief --json`/, 'Ask it from `gate-brief --json`'],
  [/^##\s+Icon hints\s*$/, '## Icon hints'],
  [/writes the `icon_hint`/, 'writes the `icon_hint`'],
];

class LintError extends Error {}

function main(argv) {
  const definitions = [];
  for (const arg of argv) {
    if (arg.startsWith('--definition=') && arg.length > '--definition='.length) definitions.push(path.resolve(arg.slice('--definition='.length)));
    else throw new LintError(`usage: node tests/guide-template-lint.mjs [--definition=<yml> ...] — unknown argument ${arg}`);
  }
  if (definitions.length === 0) {
    for (const name of Object.keys(BUILT_INS)) definitions.push(path.join(WORKFLOWS, `${name}.yml`));
  }
  const report = { failures: [], warnings: [], lines: [] };
  for (const file of definitions) lintDefinition(file, report);
  for (const line of report.lines) process.stdout.write(`${line}\n`);
  return report.failures.length > 0 ? 1 : 0;
}

function lintDefinition(file, report) {
  const definition = readDefinition(file);
  if (definition.doc === null) throw new LintError(`${display(file)}: ${definition.errors.map(e => e.message).join('; ')}`);
  const resolved = resolve({ definition });
  if (!resolved.ok) {
    const problems = resolved.errors.map(e => `${e.node ? `${e.node}: ` : ''}${e.message}`).join('; ');
    throw new LintError(`${display(file)}: the definition does not resolve: ${problems}`);
  }
  const guide = file.replace(/\.ya?ml$/i, '.md');
  if (guide === file || !fs.existsSync(guide)) throw new LintError(`${display(file)}: no guide beside it at ${display(guide)}`);

  const builtIn = path.dirname(file) === WORKFLOWS ? BUILT_INS[path.basename(file).replace(/\.ya?ml$/i, '')] : undefined;
  const shared = builtIn ?? OTHER_SHARED;
  const brief = briefOf({ definition });
  const nodes = resolved.nodes;
  const bySection = new Map(nodes.map(node => [sectionNameOf(node), node]));

  const lines = fs.readFileSync(guide, 'utf8').split('\n').map(row => row.replace(/\r$/, ''));
  const out = new Output(report, display(guide));

  const { headings } = scan(lines);
  checkHeader(lines, headings, out);

  const seen = new Set();
  const sectioned = new Set();
  for (let at = 0; at < headings.length; at++) {
    const heading = headings[at];
    if (heading.level !== 2) continue;
    const end = headings.slice(at + 1).find(next => next.level <= 2)?.line ?? lines.length;
    const nodeHeading = NODE_HEADING.exec(lines[heading.line]);
    const text = lines[heading.line].replace(/^##\s*/, '').trim();
    if (!nodeHeading) {
      if (!shared.includes(text)) out.fail(heading.line, text, 'not a node section or an allowed shared section');
      checkSharedBody(lines, heading.line, end, text, out);
      continue;
    }
    const name = nodeHeading[1].trim();
    const node = bySection.get(name);
    if (!node) {
      out.fail(heading.line, name, 'no node of the graph has this section');
      continue;
    }
    if (seen.has(name)) {
      out.fail(heading.line, node.id, 'a second section for this node');
      continue;
    }
    seen.add(name);
    sectioned.add(node.id);
    checkSection({ lines, start: heading.line, end, node, entry: brief[node.id] ?? null, out });
  }

  for (const node of nodes) {
    const entry = brief[node.id];
    if (!entry || sectioned.has(node.id)) continue;
    const needs = ['questions', 'budget', 'recommends'].filter(key => Object.hasOwn(entry, key));
    if (needs.length === 0) continue;
    out.failAt(display(file), briefLine(file, node.id), node.id, `brief: carries ${needs.join(', ')} but the guide has no section`);
  }

  report.lines.push(...out.sorted());
}

/** Headings outside fences, with their level and 0-based line. */
function scan(lines) {
  const headings = [];
  let fence = null;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const marker = FENCE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const level = /^(#+)\s/.exec(line)?.[1].length;
    if (level) headings.push({ line: at, level });
  }
  return { headings };
}

/** Check 2, and the H1 half of check 1: the H1, one paragraph, then the first H2. */
function checkHeader(lines, headings, out) {
  const firstH2 = headings.find(h => h.level === 2)?.line ?? lines.length;
  for (const extra of headings.filter(h => h.level === 1).slice(1)) out.fail(extra.line, 'header', 'a second H1');
  checkRestated(lines, 0, firstH2, 'header', out);
  checkMarkersOutside(lines, 0, firstH2, 'header', out);

  let at = 0;
  while (at < firstH2 && isBlank(lines[at])) at++;
  if (at >= firstH2 || !/^#\s/.test(lines[at])) {
    out.fail(at < firstH2 ? at : 0, 'header', 'no H1 opens the guide');
    return;
  }
  const paragraphs = [];
  let open = false;
  for (let row = at + 1; row < firstH2; row++) {
    if (isBlank(lines[row])) {
      open = false;
      continue;
    }
    if (!open) paragraphs.push(row);
    open = true;
  }
  if (paragraphs.length === 0) out.fail(at, 'header', 'no paragraph under the H1');
  else if (paragraphs.length > 1) out.fail(paragraphs[1], 'header', 'only one paragraph may stand between the H1 and the first section');
}

/** A shared section is free prose, but it restates no convention and holds no question-set line. */
function checkSharedBody(lines, start, end, name, out) {
  checkRestated(lines, start, end, name, out);
  checkMarkersOutside(lines, start, end, name, out);
}

function checkMarkersOutside(lines, start, end, name, out) {
  for (const row of visible(lines, start, end)) {
    if (!row.fenced && MARKER.test(row.text)) out.fail(row.line, name, 'a question-set line outside the Asks part');
  }
}

/** Check 8 over a stretch of lines, fences included. */
function checkRestated(lines, start, end, name, out) {
  for (let row = start; row < end; row++) {
    for (const [pattern, literal] of RESTATED) {
      if (pattern.test(lines[row])) out.fail(row, name, `restates a convention (${literal})`);
    }
  }
}

/**
 * The lines of a stretch as a step reads them: the picker marker lines and the
 * plain-picker comment dropped, the rich-picker text kept, each with its line
 * and whether it sits in a fence.
 */
function visible(lines, start, end) {
  const rows = [];
  let fence = null;
  let plain = false;
  for (let row = start; row < end; row++) {
    const text = lines[row];
    if (plain) {
      if (text.includes('-->')) plain = false;
      continue;
    }
    if (!fence && /^\s*<!--\s*plain-picker\b/.test(text)) {
      plain = !text.includes('-->');
      continue;
    }
    if (!fence && /^\s*<!--\s*\/?rich-picker\s*-->\s*$/.test(text)) continue;
    const marker = FENCE.exec(text);
    if (fence) {
      rows.push({ line: row, text, fenced: true });
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      rows.push({ line: row, text, fenced: true, opens: true });
      continue;
    }
    rows.push({ line: row, text, fenced: false });
  }
  return rows;
}

/** Checks 3–6 and 8 over one node section. */
function checkSection({ lines, start, end, node, entry, out }) {
  const id = node.id;
  const gate = node.type === 'gate';
  checkRestated(lines, start + 1, end, id, out);

  const parts = [];
  let current = null;
  let paragraphStart = true;
  let stray = null;
  let sectionWords = 0;
  const add = words => {
    sectionWords += words;
    if (!current) return;
    current.words += words;
    current.paragraphs.at(-1).words += words;
  };

  for (const row of visible(lines, start + 1, end)) {
    const { text, line } = row;
    if (row.fenced) {
      if (row.opens && paragraphStart && current) current.paragraphs.push({ line, marker: null, words: 0 });
      if (!current) stray ??= line;
      add(count(text));
      paragraphStart = false;
      continue;
    }
    if (isBlank(text) || text.trim() === '---') {
      paragraphStart = true;
      continue;
    }
    if (/^#{3,}\s/.test(text)) {
      if (current?.label !== 'Does') out.fail(line, id, 'a subheading outside the Does part');
      if (current) current.paragraphs.push({ line, marker: null, words: 0 });
      add(count(text.replace(/^#+/, '')));
      paragraphStart = true;
      continue;
    }

    let body = text;
    if (paragraphStart) {
      const label = LABEL.exec(text);
      if (label) {
        current = { label: label[1], line, words: 0, paragraphs: [] };
        parts.push(current);
        body = text.slice(label[0].length);
      } else if (!current) {
        stray ??= line;
      }
      if (current) current.paragraphs.push({ line, marker: MARKER_START.exec(text), words: 0 });
    }

    if (MARKER.test(text)) {
      const inAsks = current?.label === 'Asks';
      if (!inAsks) out.fail(line, id, 'a question-set line outside the Asks part');
      else if (!(paragraphStart && MARKER_START.test(text))) out.fail(line, id, 'a question-set marker not at the start of its paragraph');
    }

    add(count(body));
    paragraphStart = false;
  }

  // A gate section of plain prose is reported once, as a gate without its
  // Exception part, and not again as text before a label.
  if (stray !== null && !(gate && parts.length === 0)) out.fail(stray, id, 'text before the first part label');
  if (gate) checkGateParts(parts, id, start, out);
  else checkStepParts(parts, id, out);

  const declared = checkQuestionSets({ parts: gate ? [] : parts, id, entry, headingLine: start, out });
  checkWords({ parts, gate, declared, sectionWords, id, headingLine: start, out });
}

/** Check 3 for a step section: the six labels, in order, each at most once. */
function checkStepParts(parts, id, out) {
  let last = -1;
  const seen = new Set();
  for (const part of parts) {
    const index = PARTS.indexOf(part.label);
    if (index === -1) {
      out.fail(part.line, id, `**${part.label}.** is not a part label`);
      continue;
    }
    if (seen.has(part.label)) {
      out.fail(part.line, id, `**${part.label}.** appears twice`);
      continue;
    }
    seen.add(part.label);
    if (index < last) out.fail(part.line, id, `**${part.label}.** is out of order (${PARTS.join(', ')})`);
    last = Math.max(last, index);
  }
}

/** Check 5: a gate section is one `**Exception.**` part and nothing else. */
function checkGateParts(parts, id, headingLine, out) {
  if (parts.length === 0) out.fail(headingLine, id, 'a gate section without an **Exception.** part');
  let exceptions = 0;
  for (const part of parts) {
    if (part.label === EXCEPTION && exceptions++ === 0) continue;
    out.fail(part.line, id, part.label === EXCEPTION ? '**Exception.** appears twice' : `a gate section holds **Exception.** only, not **${part.label}.**`);
  }
}

/**
 * Check 6 inside the Asks part: after the run-in only question-set paragraphs,
 * at most one With and one Without per id, and the ids agreeing with the merged
 * `brief:` questions. Returns the ids the section declares.
 */
function checkQuestionSets({ parts, id, entry, headingLine, out }) {
  const declared = [];
  const counts = new Map();
  const asks = parts.find(part => part.label === 'Asks');
  if (asks) {
    let sets = false;
    for (const paragraph of asks.paragraphs) {
      if (!paragraph.marker) {
        if (sets) out.fail(paragraph.line, id, 'a paragraph after the first question-set line is not a question-set line');
        continue;
      }
      sets = true;
      const question = paragraph.marker[2] === undefined ? null : QUESTION_ID.exec(paragraph.marker[2])?.[1] ?? null;
      if (question === null) continue;
      const key = `${paragraph.marker[1]}\0${question}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (counts.get(key) === 2) out.fail(paragraph.line, id, `\`${question}\` has a second **${paragraph.marker[1]} question sets** line`);
      if (!declared.includes(question)) {
        declared.push(question);
        if (!entry?.questions || !Object.hasOwn(entry.questions, question)) out.fail(paragraph.line, id, `\`${question}\` has no brief: questions entry`);
      }
    }
  }
  for (const question of Object.keys(entry?.questions ?? {})) {
    if (!declared.includes(question)) out.fail(headingLine, id, `brief: questions lists \`${question}\`, which no question-set line names`);
  }
  return declared;
}

/** Check 4: every word count over its target warns, and never fails. */
function checkWords({ parts, gate, declared, sectionWords, id, headingLine, out }) {
  for (const part of parts) {
    if (part.label === 'Asks') {
      const runIn = runInWords(part);
      const target = RUN_IN_PER_ID * Math.max(1, declared.length);
      if (runIn > target) out.warn(part.line, id, 'Asks run-in', runIn, target);
      continue;
    }
    if (gate && part.label !== EXCEPTION) continue;
    const target = TARGETS[part.label];
    if (target !== undefined && part.words > target) out.warn(part.line, id, part.label, part.words, target);
  }
  if (!gate && sectionWords > SECTION_TARGET) out.warn(headingLine, id, 'section', sectionWords, SECTION_TARGET);
}

/** The Asks part's words before its first question-set paragraph. */
function runInWords(part) {
  let words = 0;
  for (const paragraph of part.paragraphs) {
    if (paragraph.marker) break;
    words += paragraph.words;
  }
  return words;
}

function count(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function isBlank(text) {
  return text.trim() === '';
}

/** The line of a node's entry under the definition's top-level `brief:`, 1-based; 1 when not found. */
function briefLine(file, id) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex(line => /^brief:\s*$/.test(line.replace(/\r$/, '')));
  if (start === -1) return 1;
  for (let at = start + 1; at < lines.length; at++) {
    if (/^\S/.test(lines[at])) break;
    if (new RegExp(`^\\s+${id.replace(/[-]/g, '\\-')}:\\s*$`).test(lines[at].replace(/\r$/, ''))) return at + 1;
  }
  return start + 1;
}

function display(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/** Collects one guide's findings, printed in line order. */
class Output {
  constructor(report, file) {
    this.report = report;
    this.file = file;
    this.lines = [];
  }

  /** A failure at a 0-based guide line. */
  fail(line, name, what) {
    this.failAt(this.file, (line ?? 0) + 1, name, what);
  }

  failAt(file, line, name, what) {
    this.report.failures.push(what);
    this.lines.push({ file, line, text: `FAIL: ${file}:${line}: ${name}: ${what}` });
  }

  warn(line, name, part, words, target) {
    this.report.warnings.push(part);
    this.lines.push({ file: this.file, line: line + 1, text: `warning: ${this.file}:${line + 1}: ${name}: ${part} is ${words} words (target ${target})` });
  }

  /** The guide's lines in line order, then the definition's: a stable sort, so one line's findings keep their order. */
  sorted() {
    const rank = entry => (entry.file === this.file ? 0 : 1);
    return [...this.lines].sort((a, b) => rank(a) - rank(b) || a.line - b.line).map(entry => entry.text);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`guide-template-lint: ${err instanceof LintError ? err.message : err.stack}\n`);
  process.exitCode = 2;
}
