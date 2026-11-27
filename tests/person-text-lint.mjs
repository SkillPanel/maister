#!/usr/bin/env node
/**
 * The person-text lint: a prompt template, a command a run suggests, or a
 * hand-off never puts a person's typed text inside a quoted string. A model
 * that fills a quoted slot with a text holding quotes escapes them, so the
 * reader gets `"say \"hi\""` rather than what was typed. A person's text goes
 * as a block of its own, between marker lines or on lines of its own, word for
 * word.
 *
 * A finding is a placeholder (`[…]`, `{…}`, `<…>` or `${…}`) whose name holds
 * task, description, question, request or idea, wholly enclosed by a pair of
 * quotes: straight, escaped (`\"…\"`), single or typographic. Prose and fenced
 * templates are read alike. A placeholder whose name is a path, a folder, a
 * file, an id or a type is not person text. A line that is a YAML key whose
 * whole value is the quoted placeholder (an output template's field, a
 * frontmatter `argument-hint`) passes: that value is written by whoever fills
 * the field, not copied from a person. Only `.md` files are read: a workflow
 * definition's `"${inputs.…}"` is YAML syntax the engine interpolates, never a
 * model.
 *
 * Usage: `node tests/person-text-lint.mjs [--root=<dir>] [--variant=<dir>]`.
 * The root holds `plugins/maister/` and defaults to this repository. The
 * variant is the Copilot CLI build, resolved against the root; it defaults to
 * `dist/copilot`. A source tree or default variant that is absent is skipped; a
 * variant named with `--variant` that does not exist is a usage error.
 *
 * Output: one `FAIL: <path>:<line>: <reason>` line per finding, the path
 * relative to the root. Exit 1 after printing every finding, 0 when there is
 * none, and 2 on a usage error.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'plugins/maister';
const DEFAULT_VARIANT = 'dist/copilot';
const REASON = 'a person\'s text inside quotes; pass it as a block of its own, word for word, never in a quoted string';

const PLACEHOLDER = /\$\{[^{}\n]*\}|\[[^\]\n]*\]|\{[^{}\n]*\}|<[^<>\n]*>/g;
const PERSON = /(^|[^a-z])(task|description|question|request|idea)s?([^a-z]|$)/i;
const NOT_PERSON = /path|dir|folder|file|(^|[^a-z])id([^a-z]|$)|type/i;
const QUOTES = { '"': '"', "'": "'", '“': '”', '‘': '’' };
const YAML_KEY = /^\s*(?:-\s+)?[A-Za-z_][\w.-]*:\s*$/;
const LINE_END = /^\s*(?:#.*)?$/;

/**
 * Every finding in one markdown text, as `{line, placeholder}` objects. Pure:
 * each line is read on its own, since a placeholder and its quotes sit on one.
 */
export function lintText(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(PLACEHOLDER)) {
      const name = match[0];
      if (!PERSON.test(name) || NOT_PERSON.test(name)) continue;
      const quoted = enclosure(line, match.index, match.index + name.length);
      if (!quoted) continue;
      if (YAML_KEY.test(line.slice(0, quoted.from)) && LINE_END.test(line.slice(quoted.to))) continue;
      findings.push({ line: index + 1, placeholder: name });
    }
  });
  return findings;
}

/**
 * The quote pair wholly around `line[start, end)`, as `{from, to}` (the
 * pair's outer bounds), or null. An escaped pair (`\"…\"`) counts as one.
 */
function enclosure(line, start, end) {
  const open = line[start - 1];
  const close = QUOTES[open];
  if (!close) return null;
  if (line[end] === close) {
    const escaped = open === '"' && line[start - 2] === '\\';
    return escaped ? null : { from: start - 1, to: end + 1 };
  }
  if (open === '"' && line[start - 2] === '\\' && line[end] === '\\' && line[end + 1] === '"') {
    return { from: start - 2, to: end + 2 };
  }
  return null;
}

/** Every finding in the source tree under `root` and in the variant folder `variant`, as FAIL lines. */
export function lintRoot(root, variant = path.resolve(root, DEFAULT_VARIANT)) {
  const failures = [];
  for (const dir of [path.join(root, SOURCE), variant]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of markdownFiles(dir)) {
      const shown = path.relative(root, file).split(path.sep).join('/');
      for (const { line, placeholder } of lintText(fs.readFileSync(file, 'utf8'))) {
        failures.push(`FAIL: ${shown}:${line}: ${placeholder}: ${REASON}`);
      }
    }
  }
  return failures;
}

/** Every markdown file under `dir`, in a stable order. */
function markdownFiles(dir) {
  const files = [];
  for (const name of listDir(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) files.push(...markdownFiles(full));
    else if (stat.isFile() && name.endsWith('.md')) files.push(full);
  }
  return files;
}

function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

const USAGE = 'usage: node tests/person-text-lint.mjs [--root=<dir>] [--variant=<dir>]';

function main(argv) {
  let root = REPO;
  let named = null;
  for (const arg of argv) {
    if (arg.startsWith('--root=') && arg.length > '--root='.length) root = path.resolve(arg.slice('--root='.length));
    else if (arg.startsWith('--variant=') && arg.length > '--variant='.length) named = arg.slice('--variant='.length);
    else {
      process.stderr.write(`${USAGE} (unknown argument ${arg})\n`);
      return 2;
    }
  }
  const variant = path.resolve(root, named ?? DEFAULT_VARIANT);
  if (named !== null && !isDir(variant)) {
    process.stderr.write(`${USAGE} (the variant folder ${variant} does not exist; run make build)\n`);
    return 2;
  }
  const failures = lintRoot(root, variant);
  for (const line of failures) process.stdout.write(`${line}\n`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
