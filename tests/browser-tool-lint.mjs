#!/usr/bin/env node
/**
 * The browser-tool lint: the plugin ships no browser tool, and nothing in it
 * is written against one. Browser steps use whatever tool the session has, so
 * neither plugin tree may
 *
 * - ship an MCP server: a `.mcp.json`, or `mcpServers` in its manifest;
 * - name one tool's output folder (`.playwright-mcp/`) or the tool names a
 *   bundled server would get (`mcp__plugin_maister_playwright__`);
 * - grant a browser server in a Copilot agent's tool allowlist (`playwright/*`).
 *
 * Usage: `node tests/browser-tool-lint.mjs [--root=<dir>]`. The root holds
 * `plugins/maister/` and `plugins/maister-copilot/`; it defaults to this
 * repository. A tree that is absent is skipped.
 *
 * Output: one `FAIL: <path>[:<line>]: <reason>` line per finding, the path
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
const NAMES = [
  ['.playwright-mcp/', "one browser tool's output folder; take the path the tool reports"],
  ['mcp__plugin_maister_playwright__', 'the tool names of a bundled browser server; name the capability instead'],
];

/** Every finding under `root`, as FAIL lines. */
export function lintRoot(root) {
  const failures = [];
  const fail = (file, line, reason) => {
    const shown = path.relative(root, file).split(path.sep).join('/');
    failures.push(`FAIL: ${shown}${line ? `:${line}` : ''}: ${reason}`);
  };
  for (const tree of TREES) {
    const dir = path.join(root, tree);
    if (!fs.existsSync(dir)) continue;
    const servers = path.join(dir, '.mcp.json');
    if (fs.existsSync(servers)) fail(servers, 0, 'the plugin ships an MCP server; a browser tool is the user\'s choice');
    const manifest = path.join(dir, '.claude-plugin/plugin.json');
    if (fs.existsSync(manifest) && /"mcpServers"\s*:/.test(fs.readFileSync(manifest, 'utf8'))) {
      fail(manifest, 0, 'the manifest declares MCP servers; the plugin ships none');
    }
    for (const file of textFiles(dir)) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => {
        for (const [name, why] of NAMES) if (text.includes(name)) fail(file, i + 1, `names \`${name}\`, ${why}`);
      });
    }
  }
  const agents = path.join(root, 'plugins/maister-copilot/agents');
  for (const file of listDir(agents).filter(name => name.endsWith('.md')).map(name => path.join(agents, name))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    if (lines[0] !== '---') continue;
    const end = lines.indexOf('---', 1);
    for (let i = 1; i < end; i++) {
      if (/^tools:/.test(lines[i]) && /["']playwright\//.test(lines[i])) {
        fail(file, i + 1, 'the tool allowlist grants a browser server the plugin does not ship');
      }
    }
  }
  return failures;
}

/** Every file under `dir` that reads as text, in a stable order. */
function textFiles(dir) {
  const files = [];
  for (const name of listDir(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) files.push(...textFiles(full));
    else if (stat.isFile() && !fs.readFileSync(full).includes(0)) files.push(full);
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
      process.stderr.write(`usage: node tests/browser-tool-lint.mjs [--root=<dir>] (unknown argument ${arg})\n`);
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
