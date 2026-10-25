#!/usr/bin/env node
/**
 * The frontmatter lint: every skill, agent and command file's frontmatter is
 * valid YAML for the subset this repository writes. A host that cannot parse
 * a frontmatter does not degrade gracefully: one drops every field of it, the
 * other refuses to load the skill at all.
 *
 * The subset: top-level `key: value` pairs; a value is a plain scalar (which
 * may continue on more-indented lines), a single- or double-quoted scalar, a
 * flow sequence or mapping on one line, a block scalar (`|` or `>`), or nothing,
 * followed by a block sequence of `- item` lines. A finding is:
 *
 * - a plain scalar holding `": "` or `" #"`, or ending with `:` — the first
 *   is a mapping YAML refuses, the second silently starts a comment and cuts
 *   the value short;
 * - a plain scalar opening with a character YAML reserves (`` ` ``, `@`, `%`,
 *   `&`, `*`, `!`, `|`, `>`, `"`, `'`, or `- `, `? `, `: `);
 * - a tab in indentation;
 * - a quoted scalar or flow collection left unclosed, or followed by text;
 * - a key given twice;
 * - a line that is neither a key, a continuation, a list item nor a comment,
 *   and a frontmatter opened but never closed.
 *
 * Usage: `node tests/frontmatter-lint.mjs [--file=<md> ...]`. With no argument
 * it checks every `SKILL.md`, agent and command file under `plugins/maister/`
 * and the generated variant.
 *
 * Output: one `FAIL: <file>:<line>: <reason>` line per finding. Exit 1 after
 * printing every failure, 0 when there is none, and 2 on the script's own
 * error — an unreadable file or a usage error.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TREES = ['plugins/maister', 'plugins/maister-copilot'];

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*)|)$/;
const RESERVED_START = /^(?:[`@%&*!|>"']|[-?:](?:[ \t]|$))/;

/** The files the lint reads by default: every SKILL.md, agent and command under both trees. */
export function defaultFiles() {
  const files = [];
  for (const tree of TREES) {
    const base = path.join(ROOT, tree);
    const skills = path.join(base, 'skills');
    for (const name of listDir(skills)) {
      const file = path.join(skills, name, 'SKILL.md');
      if (fs.existsSync(file)) files.push(file);
    }
    for (const dir of ['agents', 'commands']) {
      for (const name of listDir(path.join(base, dir))) {
        if (name.endsWith('.md')) files.push(path.join(base, dir, name));
      }
    }
  }
  return files;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * Every finding in one file's text, as `{line, reason}`. A file with no
 * frontmatter has nothing to check.
 */
export function lintText(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return [];
  const end = lines.indexOf('---', 1);
  if (end === -1) return [{ line: 1, reason: 'the frontmatter is opened but never closed' }];

  const findings = [];
  const seen = new Map();
  // What an indented line may be: the continuation of a plain scalar, a block
  // scalar's body, or an item of a block sequence under an empty key.
  let context = 'none';
  for (let i = 1; i < end; i++) {
    const number = i + 1;
    const raw = lines[i];
    const report = reason => findings.push({ line: number, reason });
    if (raw.trim() === '') continue;
    const indent = raw.match(/^[ \t]*/)[0];
    if (indent.includes('\t')) {
      report('a tab in indentation');
      continue;
    }
    const body = raw.slice(indent.length);
    if (indent === '') {
      if (body.startsWith('#')) continue;
      const key = body.match(KEY_LINE);
      if (!key) {
        report('not a `key: value` line');
        context = 'none';
        continue;
      }
      const [, name, value = ''] = key;
      if (seen.has(name)) report(`the key \`${name}\` is given twice (first on line ${seen.get(name)})`);
      else seen.set(name, number);
      context = checkValue(value, report);
      continue;
    }
    if (context === 'block') continue;
    if (context === 'plain') {
      checkPlain(body, report, true);
      continue;
    }
    if (context === 'list') {
      const item = body.match(/^-(?:[ \t]+(.*)|)$/);
      if (item) {
        checkValue(item[1] ?? '', report);
        continue;
      }
    }
    report('an indented line that continues nothing');
  }
  return findings;
}

/**
 * Check one value after `key:` or `- `, and say what an indented line after it
 * may be.
 */
function checkValue(value, report) {
  const text = value.replace(/[ \t]+$/, '');
  if (text === '' ) return 'list';
  if (text.startsWith('#')) return 'list';
  if (/^[|>][-+0-9]*(?:[ \t]+#.*)?$/.test(text)) return 'block';
  if (text.startsWith('"') || text.startsWith("'")) {
    const close = quotedEnd(text, 0);
    if (close === -1) report(`an unclosed ${text[0] === '"' ? 'double' : 'single'} quote`);
    else checkTrailing(text.slice(close + 1), report);
    return 'none';
  }
  if (text.startsWith('[') || text.startsWith('{')) {
    const close = flowEnd(text, report);
    if (close !== -1) checkTrailing(text.slice(close + 1), report);
    return 'none';
  }
  checkPlain(text, report, false);
  return 'plain';
}

/** A plain scalar, on its first line or a continuation line. */
function checkPlain(text, report, continuation) {
  if (!continuation && RESERVED_START.test(text)) {
    report(`a plain scalar opening with \`${text[0]}\`, which YAML reserves; quote the value`);
  }
  if (/:[ \t]/.test(text) || /:$/.test(text)) report('a plain scalar holding `: `, which YAML reads as a mapping; quote the value');
  if (/[ \t]#/.test(text)) report('a plain scalar holding ` #`, which YAML reads as the start of a comment; quote the value');
}

/** Only a comment may follow a closed quote or flow collection. */
function checkTrailing(rest, report) {
  if (rest.trim() !== '' && !/^[ \t]+#/.test(rest)) report('text after a closed quote or flow collection');
}

/** The index of the quote closing the scalar opened at `start`, or -1. */
function quotedEnd(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] !== quote) continue;
    if (quote === "'" && text[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/** The index closing the one-line flow collection opening `text`, or -1 after reporting why. */
function flowEnd(text, report) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = quotedEnd(text, i);
      if (close === -1) {
        report(`an unclosed ${c === '"' ? 'double' : 'single'} quote`);
        return -1;
      }
      i = close;
    } else if (c === '[' || c === '{') {
      stack.push(c === '[' ? ']' : '}');
    } else if (c === ']' || c === '}') {
      if (stack.pop() !== c) {
        report(`a flow collection closed by a stray \`${c}\``);
        return -1;
      }
      if (stack.length === 0) return i;
    }
  }
  report('an unclosed flow collection');
  return -1;
}

function main(argv) {
  const files = [];
  for (const arg of argv) {
    if (!arg.startsWith('--file=')) {
      console.error(`usage: node tests/frontmatter-lint.mjs [--file=<md> ...] (unknown argument ${arg})`);
      return 2;
    }
    files.push(path.resolve(arg.slice('--file='.length)));
  }
  if (!files.length) files.push(...defaultFiles());
  const failures = [];
  try {
    for (const file of files) {
      const shown = path.relative(ROOT, file).split(path.sep).join('/');
      for (const { line, reason } of lintText(fs.readFileSync(file, 'utf8'))) {
        failures.push(`FAIL: ${shown}:${line}: ${reason}`);
      }
    }
  } catch (err) {
    console.error(`frontmatter-lint: ${err.message}`);
    return 2;
  }
  for (const line of failures) console.log(line);
  return failures.length ? 1 : 0;
}

// Node resolves symlinks in the main module's URL but not in argv[1], so the
// invoked path is resolved the same way before comparing; run through a
// symlinked directory (macOS /tmp is one) the script would otherwise do nothing.
function invokedPath(arg) {
  try {
    return fs.realpathSync(arg);
  } catch {
    return path.resolve(arg);
  }
}

if (process.argv[1] && invokedPath(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
