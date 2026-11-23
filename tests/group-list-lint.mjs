#!/usr/bin/env node
/**
 * The group-list lint: no prose lists the old four standards folders without
 * the groups added beside them. The built-in standards come in nine groups, so
 * a paragraph, list, folder tree or table that names global, frontend, backend
 * and testing and none of data, cli, mobile, jobs or infra is the stale
 * four-folder list.
 *
 * A block is a run of lines between blank lines, fenced or not. It fails when
 * it names all four of global, frontend, backend and testing (case-insensitive
 * whole words) and none of data, cli, mobile, jobs or infra. The block is
 * reported at its first line.
 *
 * It reads the `.md` files under `<root>/plugins/maister/` and `<root>/docs/`.
 * The group table is JSON and is never read.
 *
 * Usage: `node tests/group-list-lint.mjs [--root=<dir>]`; the root defaults to
 * this repository.
 *
 * Output: one `FAIL: <path>:<line>: <reason>` line per finding, the path
 * relative to the root. Exit 1 after printing every finding, 0 when there is
 * none, and 2 on a usage error.
 *
 * Repository tooling: it never ships under `plugins/`. Zero dependencies,
 * `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['plugins/maister', 'docs'];
const OLD_FOUR = ['global', 'frontend', 'backend', 'testing'];
const NEW_GROUPS = ['data', 'cli', 'mobile', 'jobs', 'infra'];

const has = (block, word) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`, 'i').test(block);

/** Every finding in one markdown text, as `{line}` objects: the first line of each offending block. */
export function lintText(text) {
  const findings = [];
  let block = [];
  let start = 0;
  const flush = () => {
    const joined = block.join('\n');
    if (block.length && OLD_FOUR.every(word => has(joined, word)) && !NEW_GROUPS.some(word => has(joined, word))) findings.push({ line: start });
    block = [];
  };
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return flush();
    if (!block.length) start = i + 1;
    block.push(line);
  });
  flush();
  return findings;
}

/** Every finding under `root`, as FAIL lines. */
export function lintRoot(root) {
  const failures = [];
  for (const dir of DIRS) {
    for (const file of markdownFiles(path.join(root, dir))) {
      const shown = path.relative(root, file).split(path.sep).join('/');
      for (const { line } of lintText(fs.readFileSync(file, 'utf8'))) {
        failures.push(`FAIL: ${shown}:${line}: lists global, frontend, backend and testing without data, cli, mobile, jobs or infra beside them; name the groups the project ships`);
      }
    }
  }
  return failures;
}

function markdownFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

const USAGE = 'usage: node tests/group-list-lint.mjs [--root=<dir>]';

function main(argv) {
  let root = REPO;
  for (const arg of argv) {
    if (arg.startsWith('--root=') && arg.length > '--root='.length) root = path.resolve(arg.slice('--root='.length));
    else {
      process.stderr.write(`${USAGE} (unknown argument ${arg})\n`);
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
