#!/usr/bin/env node
/**
 * The marketplace lint: each host reads its own marketplace file, and the two
 * must describe one release of one plugin. It reads
 *
 * - `.claude-plugin/marketplace.json` (Claude Code),
 * - `.github/plugin/marketplace.json` (Copilot CLI),
 * - `plugins/maister/.claude-plugin/plugin.json` (the plugin manifest),
 *
 * and fails when a file is missing or not JSON, the manifest names no version,
 * the two files name different marketplaces (or one that is neither channel),
 * a version differs from the manifest's, an entry is not `maister`, the Claude
 * Code entry is not the source tree, or the Copilot entry is not the build on
 * the channel's dist branch, in `copilot/`.
 *
 * A file that is missing or not JSON gets its one line, and every check that
 * reads it is skipped; a manifest with no version gets its one line, and the
 * version checks are skipped. A condition planted alone prints one line.
 *
 * Usage: `node tests/marketplace-lint.mjs [--root=<dir>]`. The root defaults
 * to this repository.
 *
 * Output: one `FAIL: <path>: <reason>` line per finding, the path relative to
 * the root. Exit 1 after printing every finding, 0 when there is none, and 2
 * on a usage error.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE = '.claude-plugin/marketplace.json';
const COPILOT = '.github/plugin/marketplace.json';
const MANIFEST = 'plugins/maister/.claude-plugin/plugin.json';
const CHANNELS = { 'maister-plugins-beta': 'dist/beta', 'maister-plugins': 'dist/stable' };

/** Every finding under `root`, as FAIL lines. */
export function lintRoot(root) {
  const failures = [];
  const fail = (file, reason) => failures.push(`FAIL: ${file}: ${reason}`);
  const read = file => {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      fail(file, "missing; every host's marketplace file and the plugin manifest are required");
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      fail(file, 'not valid JSON');
      return null;
    }
  };
  const claude = read(CLAUDE);
  const copilot = read(COPILOT);
  const manifest = read(MANIFEST);

  const version = manifest && typeof manifest.version === 'string' && manifest.version ? manifest.version : null;
  if (manifest && !version) fail(MANIFEST, 'the plugin manifest names no version');

  if (claude && copilot && claude.name !== copilot.name) {
    fail(COPILOT, `names the marketplace "${copilot.name}", the Claude Code file "${claude.name}"; both name the same marketplace`);
  }
  let expectedRef = null;
  if (claude) {
    if (Object.hasOwn(CHANNELS, claude.name)) expectedRef = CHANNELS[claude.name];
    else fail(CLAUDE, `the marketplace "${claude.name}" is neither maister-plugins nor maister-plugins-beta`);
  }

  const checkVersion = (file, field, value) => {
    if (version && value !== version) fail(file, `${field} is "${value ?? ''}", the plugin's version is "${version}"`);
  };
  /** The maister entry of a file, after one line for each other entry (or for none). */
  const entryOf = (file, doc) => {
    const list = Array.isArray(doc.plugins) ? doc.plugins : [];
    for (const entry of list) {
      if (entry?.name !== 'maister') fail(file, `lists "${entry?.name}"; a marketplace file lists only maister`);
    }
    if (!list.length) fail(file, 'lists no maister entry');
    return list.find(entry => entry?.name === 'maister') ?? null;
  };

  if (claude) {
    checkVersion(CLAUDE, 'version', claude.version);
    const entry = entryOf(CLAUDE, claude);
    if (entry) {
      if (Object.hasOwn(entry, 'version')) checkVersion(CLAUDE, 'plugins[maister].version', entry.version);
      if (entry.source !== './plugins/maister') {
        fail(CLAUDE, `maister's source is ${JSON.stringify(entry.source)}; the Claude Code file lists ./plugins/maister, the source tree`);
      }
    }
  }

  if (copilot) {
    checkVersion(COPILOT, 'metadata.version', copilot.metadata?.version);
    const entry = entryOf(COPILOT, copilot);
    if (entry) {
      checkVersion(COPILOT, 'plugins[maister].version', entry.version);
      const source = entry.source;
      if (typeof source === 'string') {
        fail(COPILOT, `maister's source is "${source}", a path in this repository; the Copilot build is listed from its dist branch`);
      } else {
        const s = source && typeof source === 'object' ? source : {};
        if (s.source !== 'github' || s.repo !== 'SkillPanel/maister') fail(COPILOT, "maister's source is not github SkillPanel/maister");
        const refOk = s.ref === 'dist/beta' || s.ref === 'dist/stable';
        if (!refOk) fail(COPILOT, `maister's ref is "${s.ref ?? ''}"; it is dist/beta or dist/stable`);
        if (s.path !== 'copilot') fail(COPILOT, `maister's path is "${s.path ?? ''}"; the Copilot build sits in copilot/`);
        if (refOk && expectedRef && s.ref !== expectedRef) {
          fail(COPILOT, `the marketplace ${claude.name} lists the build from ${s.ref}; that channel reads ${expectedRef}`);
        }
      }
    }
  }
  return failures;
}

function main(argv) {
  let root = REPO;
  for (const arg of argv) {
    if (arg.startsWith('--root=') && arg.length > '--root='.length) root = path.resolve(arg.slice('--root='.length));
    else {
      process.stderr.write(`usage: node tests/marketplace-lint.mjs [--root=<dir>] (unknown argument ${arg})\n`);
      return 2;
    }
  }
  const failures = lintRoot(root);
  for (const line of failures) process.stdout.write(`${line}\n`);
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

if (process.argv[1] && invokedPath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
