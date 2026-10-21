/**
 * The documentation index check: does `.maister/docs/INDEX.md` still map the
 * documents beside it?
 *
 *   node <path to this file> [--docs=<dir>]
 *
 * `--docs` names the documentation directory; it defaults to `.maister/docs`
 * under the current directory, so a caller runs it from the project root. Exec
 * form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 *
 * It asks nothing of the documents themselves. Any Markdown file may live in
 * the directory as it is — copied from elsewhere, with or without a heading or
 * frontmatter — so the check reads only INDEX.md and the list of files. The one
 * exception is a file under `standards/`, whose size and `###` rule count are
 * measured against the size guidance.
 *
 * An entry is a heading (level 2 to 6, outside a code fence) whose text ends in
 * a backticked path in parentheses — `### Storage (\`standards/storage.md\`)` —
 * and its body is what follows up to the next heading or thematic break. The
 * path is taken against the documentation directory; a leading `./` or
 * `.maister/docs/` is dropped.
 *
 * Two kinds of finding. A failure is structure: a document with no entry
 * (`unindexed-file`), an entry whose document is gone (`dead-entry`), two
 * entries for one document (`duplicate-entry`), a merge's leftover conflict
 * markers (`conflict-marker`), or documents with no INDEX.md at all
 * (`index-missing`). A warning is size guidance and never fails: an entry over
 * its size guide (`entry-over-guide`), an entry holding a date
 * (`entry-date`), a `#NNN` reference (`entry-ticket-ref`) or a count of things
 * (`entry-count`), and a standards file past its size or rule guide
 * (`standards-file-over-guide`).
 *
 * Output: one JSON report on stdout, `{ok, docs, index, files, entries,
 * failures, warnings}`, each finding `{code, path, line?, message}`. Exit 0
 * when nothing failed (warnings or not), 1 when something did, 2 when the
 * check itself could not run — a usage error or an unreadable directory. A
 * directory that does not exist is not an error: the report says `skipped`,
 * since a project that keeps no documentation has nothing to drift.
 */

import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, FAILED: 1, INTERNAL: 2 };

const INDEX = 'INDEX.md';
const DEFAULT_DOCS = path.join('.maister', 'docs');
const STANDARDS = 'standards/';

/** Size guidance, in characters of an entry's body with whitespace collapsed. */
const ENTRY_GUIDE = 240;
const STANDARD_ENTRY_GUIDE = 300;

/** Size guidance for one standards file: bytes, and `###` rules. */
const STANDARDS_FILE_BYTES = 12 * 1024;
const STANDARDS_FILE_RULES = 15;

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const ENTRY_PATH = /\(\s*`([^`]+)`\s*\)$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CONFLICT_OPEN = /^<{7}(?:[ \t]|$)/;
const CONFLICT_OTHER = /^(?:>{7}|\|{7})(?:[ \t]|$)/;
const CONFLICT_SPLIT = /^={7}[ \t]*$/;
const RULE = /^ {0,3}###[ \t]/;

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH}\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\b|\\b\\d{1,2}\\s+${MONTH}\\.?\\s+\\d{4}\\b`);
const TICKET = /(?:^|[\s([,;:])(#\d+)\b/;
const NUMBER_WORDS = /(?<![\w.,#+/-])(\d+(?:[.,]\d+)?)\s+([A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z][A-Za-z'-]*))?/g;

/** Words that end in `s` without being a plural a count would name. */
const NOT_PLURAL = new Set([
  'has', 'was', 'does', 'goes', 'is', 'as', 'its', 'this', 'thus', 'plus', 'yes', 'less', 'unless',
  'always', 'perhaps', 'across', 'versus', 'whereas', 'besides', 'towards', 'afterwards', 'sometimes',
]);

/** Words a count never puts between its number and its noun. */
const NOT_BETWEEN = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in', 'into', 'is', 'nor',
  'of', 'on', 'or', 'per', 'than', 'the', 'to', 'via', 'was', 'were', 'with',
]);

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = {};
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (name !== 'docs') throw new UsageError(`unknown flag --${name}`);
    if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
    let value = eq >= 0 ? arg.slice(eq + 1) : argv[at + 1];
    if (eq < 0) at += 1;
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) {
      throw new UsageError(`the flag --${name} needs a value`);
    }
    flags[name] = value;
  }
  return flags;
}

/** Every Markdown file under `dir`, as a sorted list of `/`-separated paths relative to it. */
function markdownFiles(dir) {
  const found = [];
  const walk = rel => {
    for (const dirent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (dirent.name.startsWith('.')) continue;
      const child = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
      if (dirent.isDirectory()) walk(child);
      else if (/\.md$/i.test(dirent.name) && isFile(path.join(dir, child))) found.push(child);
    }
  };
  walk('');
  return found.filter(rel => rel.toLowerCase() !== INDEX.toLowerCase()).sort();
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** A path as an entry writes it, as the file list spells it. */
function normalize(raw) {
  let rel = raw.trim().replace(/\\/g, '/');
  while (rel.startsWith('./')) rel = rel.slice(2);
  if (rel.startsWith('.maister/docs/')) rel = rel.slice('.maister/docs/'.length);
  return path.posix.normalize(rel);
}

/**
 * The entries and the conflict markers of INDEX.md's lines. A heading inside a
 * fence is not an entry; a conflict marker is one wherever it sits, since a
 * merge writes it at the start of a line regardless.
 */
function parseIndex(lines) {
  const entries = [];
  const conflicts = [];
  let fence = null;
  let open = false;
  let current = null;
  const close = () => {
    if (current) entries.push(current);
    current = null;
  };
  lines.forEach((line, at) => {
    const number = at + 1;
    if (CONFLICT_OPEN.test(line)) {
      conflicts.push(number);
      open = true;
    } else if (CONFLICT_OTHER.test(line)) {
      conflicts.push(number);
      if (line.startsWith('>')) open = false;
    } else if (open && CONFLICT_SPLIT.test(line)) {
      conflicts.push(number);
    }

    const marker = FENCE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      if (current) current.body.push(line);
      return;
    }
    if (marker) {
      fence = marker[1];
      if (current) current.body.push(line);
      return;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const text = (heading[2] ?? '').replace(/[ \t]+#+$/, '');
      const target = heading[1].length >= 2 ? ENTRY_PATH.exec(text) : null;
      if (target) current = { line: number, title: text.slice(0, target.index).trim(), path: normalize(target[1]), body: [] };
      return;
    }
    if (THEMATIC_BREAK.test(line)) {
      close();
      return;
    }
    if (current) current.body.push(line);
  });
  close();
  return { entries, conflicts };
}

function isPlural(word) {
  const lower = word.toLowerCase();
  return lower.length > 2 && lower.endsWith('s') && !/(?:ss|us|is)$/.test(lower) && !NOT_PLURAL.has(lower);
}

/** The first "a number of things" in `text`, code spans left out, or null. */
function countIn(text) {
  const plain = text.replace(/`[^`]*`/g, ' ');
  for (const match of plain.matchAll(NUMBER_WORDS)) {
    const [, number, first, second] = match;
    if (isPlural(first)) return `${number} ${first}`;
    if (second && !NOT_BETWEEN.has(first.toLowerCase()) && isPlural(second)) return `${number} ${first} ${second}`;
  }
  return null;
}

function entryWarnings(entry) {
  const body = entry.body.join(' ').replace(/\s+/g, ' ').trim();
  const found = [];
  const at = { path: entry.path, line: entry.line };
  const guide = entry.path.startsWith(STANDARDS) ? STANDARD_ENTRY_GUIDE : ENTRY_GUIDE;
  const length = [...body].length;
  if (length > guide) {
    found.push({ code: 'entry-over-guide', ...at, message: `the entry runs to ${length} characters; the guide is about ${guide}` });
  }
  const date = DATE.exec(body);
  if (date) found.push({ code: 'entry-date', ...at, message: `the entry holds a date ("${date[0]}")` });
  const ticket = TICKET.exec(body);
  if (ticket) found.push({ code: 'entry-ticket-ref', ...at, message: `the entry holds a ticket reference ("${ticket[1]}")` });
  const count = countIn(body);
  if (count) found.push({ code: 'entry-count', ...at, message: `the entry counts things ("${count}")` });
  return found;
}

/** The rule headings of a standards file, those inside a fence left out. */
function ruleCount(text) {
  let fence = null;
  let rules = 0;
  for (const line of text.split(/\r?\n/)) {
    const marker = FENCE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker[1];
    } else if (RULE.test(line)) {
      rules += 1;
    }
  }
  return rules;
}

function standardsWarnings(dir, files) {
  const found = [];
  for (const rel of files) {
    if (!rel.startsWith(STANDARDS)) continue;
    const file = path.join(dir, rel);
    const bytes = fs.statSync(file).size;
    const rules = ruleCount(fs.readFileSync(file, 'utf8'));
    if (bytes <= STANDARDS_FILE_BYTES && rules <= STANDARDS_FILE_RULES) continue;
    const size = `${Math.round(bytes / 1024)} KB and ${rules} rules`;
    found.push({
      code: 'standards-file-over-guide',
      path: rel,
      message: `${rel} holds ${size}; the guide is about ${STANDARDS_FILE_BYTES / 1024} KB or ${STANDARDS_FILE_RULES} rules — split it into topic files or a sub-folder`,
    });
  }
  return found;
}

function check(dir) {
  const report = { ok: true, docs: dir, index: null, files: 0, entries: 0, failures: [], warnings: [] };
  if (!fs.existsSync(dir)) return { ...report, skipped: 'no documentation directory' };
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);

  const files = markdownFiles(dir);
  report.files = files.length;
  report.warnings.push(...standardsWarnings(dir, files));

  const indexFile = path.join(dir, INDEX);
  if (!isFile(indexFile)) {
    if (files.length) {
      report.failures.push({ code: 'index-missing', path: INDEX, message: `${files.length === 1 ? 'a document' : 'documents'} but no ${INDEX}` });
    }
    report.ok = report.failures.length === 0;
    return report;
  }
  report.index = indexFile;

  const text = fs.readFileSync(indexFile, 'utf8').replace(/^﻿/, '');
  const { entries, conflicts } = parseIndex(text.split(/\r?\n/));
  report.entries = entries.length;

  for (const line of conflicts) {
    report.failures.push({ code: 'conflict-marker', path: INDEX, line, message: `a merge conflict marker is left on line ${line}; refresh the index to settle it` });
  }

  const known = new Set(files);
  const seen = new Map();
  for (const entry of entries) {
    const first = seen.get(entry.path);
    if (first !== undefined) {
      report.failures.push({ code: 'duplicate-entry', path: entry.path, line: entry.line, message: `${entry.path} has a second entry (the first is on line ${first})` });
    } else {
      seen.set(entry.path, entry.line);
    }
    const live = known.has(entry.path) || (!/\.md$/i.test(entry.path) && !entry.path.startsWith('..') && isFile(path.join(dir, entry.path)));
    if (!live) {
      report.failures.push({ code: 'dead-entry', path: entry.path, line: entry.line, message: `${entry.path} is listed but no such document exists` });
    }
    report.warnings.push(...entryWarnings(entry));
  }
  for (const rel of files) {
    if (!seen.has(rel)) report.failures.push({ code: 'unindexed-file', path: rel, message: `${rel} has no entry in ${INDEX}` });
  }

  report.ok = report.failures.length === 0;
  return report;
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`docs-check: ${error.message}\nusage: node docs-check.mjs [--docs=<dir>]\n`);
    return EXIT.INTERNAL;
  }
  let report;
  try {
    report = check(path.resolve(flags.docs ?? DEFAULT_DOCS));
  } catch (error) {
    process.stderr.write(`docs-check: ${error.message}\n`);
    return EXIT.INTERNAL;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? EXIT.OK : EXIT.FAILED;
}

process.exitCode = main();
