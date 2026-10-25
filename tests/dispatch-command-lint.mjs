#!/usr/bin/env node
/**
 * The dispatch-command lint: `dispatch-model` is a verb of the workflow
 * tooling, not a command on the PATH. A session that reads a bare
 * `dispatch-model --agent=…` runs it in a shell and gets "command not found",
 * or skips it. So every inline code span in a plugin markdown file that
 * invokes the verb with a flag (`dispatch-model --`) must name the script it
 * belongs to (`workflow.mjs dispatch-model`). A bare mention of the verb, with
 * no flag, is prose and passes.
 *
 * An inline code span may wrap across lines inside a paragraph; it is matched
 * over the paragraph's text, and reported at the line it opens on.
 *
 * Usage: `node tests/dispatch-command-lint.mjs [--root=<dir>]`. The root holds
 * `plugins/maister/` and `plugins/maister-copilot/`; it defaults to this
 * repository. A tree that is absent is skipped.
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
const TREES = ['plugins/maister', 'plugins/maister-copilot'];
const REASON = 'invokes `dispatch-model` without the script; write `node <plugin root>/skills/workflow-engine/scripts/workflow.mjs dispatch-model …`';

/**
 * Every finding in one markdown text, as `{line, span}` objects. Pure: the
 * text is split into paragraphs (blank lines and fenced blocks end one), and
 * each paragraph's inline code spans are read across its line breaks.
 */
export function lintText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  let para = [];
  let fence = null;
  const flush = () => {
    if (para.length) findings.push(...spansIn(para));
    para = [];
  };
  lines.forEach((line, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      flush();
      fence = marker[1];
      return;
    }
    if (line.trim() === '') flush();
    else para.push({ text: line, number: i + 1 });
  });
  flush();
  return findings;
}

/** The offending spans of one paragraph, given as `{text, number}` lines. */
function spansIn(para) {
  const findings = [];
  const joined = para.map(l => l.text).join('\n');
  const starts = [];
  let offset = 0;
  for (const l of para) {
    starts.push(offset);
    offset += l.text.length + 1;
  }
  const lineAt = index => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= index) k++;
    return para[k].number;
  };
  let i = 0;
  while (i < joined.length) {
    if (joined[i] !== '`') {
      i++;
      continue;
    }
    let run = 1;
    while (joined[i + run] === '`') run++;
    const ticks = '`'.repeat(run);
    let close = joined.indexOf(ticks, i + run);
    while (close !== -1 && (joined[close + run] === '`' || joined[close - 1] === '`')) {
      close = joined.indexOf(ticks, close + 1);
    }
    if (close === -1) {
      i += run;
      continue;
    }
    const span = joined.slice(i + run, close).replace(/\s*\n\s*/g, ' ');
    if (span.includes('dispatch-model --') && !span.includes('workflow.mjs dispatch-model')) {
      findings.push({ line: lineAt(i), span });
    }
    i = close + run;
  }
  return findings;
}

/** Every finding under `root`, as FAIL lines. */
export function lintRoot(root) {
  const failures = [];
  for (const tree of TREES) {
    const dir = path.join(root, tree);
    if (!fs.existsSync(dir)) continue;
    for (const file of markdownFiles(dir)) {
      const shown = path.relative(root, file).split(path.sep).join('/');
      for (const { line } of lintText(fs.readFileSync(file, 'utf8'))) {
        failures.push(`FAIL: ${shown}:${line}: ${REASON}`);
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

function listDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function main(argv) {
  let root = REPO;
  for (const arg of argv) {
    if (arg.startsWith('--root=') && arg.length > '--root='.length) root = path.resolve(arg.slice('--root='.length));
    else {
      process.stderr.write(`usage: node tests/dispatch-command-lint.mjs [--root=<dir>] (unknown argument ${arg})\n`);
      return 2;
    }
  }
  const failures = lintRoot(root);
  for (const line of failures) process.stdout.write(`${line}\n`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
