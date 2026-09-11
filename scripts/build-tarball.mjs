#!/usr/bin/env node
/**
 * Builds the contract release archive.
 *
 * Usage:
 *   node scripts/build-tarball.mjs [--tag=<tag>]     (default: contracts-dev)
 *
 * Stages `dist/<tag>/` with the schemas, every contract fixture, the register,
 * an aggregate `manifest.json`, a `VERSION` stamp, the contract runner plus its
 * `package.json`/`package-lock.json`, and the ledger library under a flat
 * `lib/` root, then writes `dist/<tag>.tar.gz` and a `dist/<tag>.tar.gz.sha256`
 * sidecar in `shasum -a 256 -c` form.
 *
 * A consumer that vendors the archive runs the same suite with:
 *   npm ci && node scripts/verify-contracts.mjs \
 *     --fixtures=fixtures/contracts --schemas=schemas
 * The tests that need the plugin tree print `skip` there; nothing FAILs.
 *
 * The archive is deliberately NOT byte-reproducible across builds: `built_at`
 * and the staging mtimes move. The sidecar verifies a downloaded asset against
 * the one CI attached — never one CI rerun against another. `VERSION.git_sha`
 * is the cross-build identity.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const SCHEMA_DIR = 'plugins/maister/skills/orchestrator-framework/schemas';
const REGISTER = 'plugins/maister/skills/orchestrator-framework/references/compatibility-contracts.md';
const PLUGIN_MANIFEST = 'plugins/maister/.claude-plugin/plugin.json';
const FIXTURE_DIR = 'fixtures/contracts';
const RUNNER = 'scripts/verify-contracts.mjs';
const ROOT_FILES = ['package.json', 'package-lock.json'];

/**
 * The ledger library and its whole dependency closure, staged flat under a
 * `lib/` root so a consumer — the cockpit daemon — can vendor and call the seven
 * ops in process instead of reimplementing them against the schemas.
 *
 * Two things about this list are load-bearing.
 *
 * The root is `lib/`, **not** `plugins/`. T27 asserts the archive carries no
 * plugin tree, and the vendored runner derives `ctx.pluginRoot` by walking up
 * from the schemas directory: a partial `plugins/` subtree inside the archive
 * could flip its `plugin` capability detection and turn T27's required `skip`
 * into a FAIL. A flat `lib/` creates no such tree and is inert to it.
 *
 * The archive names are the sibling names the source already imports, so **no
 * line is rewritten here**. `ledger.mjs` imports `./canonical.mjs` and
 * `./definition.mjs`, which in the plugin tree resolve to one-line re-export
 * shims and here resolve to the real modules staged beside it. The vendored
 * copy is therefore byte-identical to the shipped one.
 *
 * The closure is `{ledger, canonical, definition}` and it is closed: both
 * `canonical.mjs` and `definition.mjs` import `node:` builtins and nothing else.
 * A fourth dependency added later without a row here would resolve in the plugin
 * tree and fail in the daemon, which is what T27's post-extraction
 * `import('<archive>/lib/ledger.mjs')` check exists to catch.
 */
const LIB_FILES = [
  ['plugins/maister/skills/umbrella/scripts/lib/ledger.mjs', 'ledger.mjs'],
  ['plugins/maister/lib/canonical.mjs', 'canonical.mjs'],
  ['plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs', 'definition.mjs'],
];
const LIB_DIR = 'lib';

const DEFAULT_TAG = 'contracts-dev';
const TAG_FORM = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function die(message) {
  console.error(`build-tarball: ${message}`);
  process.exit(1);
}

/** Every file under `dir`, sorted, as paths relative to `dir`. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Copy a tree file-by-file; no fs.cpSync, which is still flagged on Node 20. */
function copyTree(from, to) {
  let n = 0;
  for (const rel of listFiles(from)) {
    const target = path.join(to, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, rel), target);
    n++;
  }
  return n;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function requirePath(rel, kind) {
  const full = path.join(REPO_ROOT, rel);
  const ok = kind === 'dir' ? isDir(full) : isFile(full);
  if (!ok) die(`${rel} is missing — nothing to package`);
  return full;
}

function gitSha() {
  const proc = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (proc.status !== 0) die(`git rev-parse HEAD failed: ${(proc.stderr ?? '').trim()}`);
  return proc.stdout.trim();
}

function gitDirty() {
  const proc = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return proc.status === 0 && proc.stdout.trim().length > 0;
}

// A6 form: whole seconds, UTC, never a bare date.
const utcStamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { tag: DEFAULT_TAG, dist: null };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--tag':
        opts.tag = value;
        break;
      // Where the staging directory and the archive are written. Defaults to
      // the repository's own `dist/`; the contract suite points it at a
      // throwaway directory so the row proves a build of the checkout in hand
      // rather than whatever happens to be sitting in `dist/` from last time.
      case '--dist':
        opts.dist = value;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        die(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log('usage: node scripts/build-tarball.mjs [--tag=<tag>] [--dist=<dir>]');
  process.exit(0);
}
if (!TAG_FORM.test(opts.tag)) die(`--tag=${JSON.stringify(opts.tag)} is not a plain tag name`);

const tag = opts.tag;
const distDir = opts.dist ? path.resolve(opts.dist) : path.join(REPO_ROOT, 'dist');
const staging = path.join(distDir, tag);

const schemaSrc = requirePath(SCHEMA_DIR, 'dir');
const fixtureSrc = requirePath(FIXTURE_DIR, 'dir');
const registerSrc = requirePath(REGISTER, 'file');
const runnerSrc = requirePath(RUNNER, 'file');
for (const f of ROOT_FILES) requirePath(f, 'file');
const libSrc = LIB_FILES.map(([from, to]) => [requirePath(from, 'file'), to]);

// Rebuild the staging dir from scratch so a removed fixture cannot survive.
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// schemas/
const schemaNames = fs.readdirSync(schemaSrc).filter(n => n.endsWith('.schema.json')).sort();
if (!schemaNames.length) die(`${SCHEMA_DIR} holds no *.schema.json`);
for (const name of schemaNames) copyFile(path.join(schemaSrc, name), path.join(staging, 'schemas', name));

// fixtures/contracts/**
const fixtureFiles = copyTree(fixtureSrc, path.join(staging, FIXTURE_DIR));
if (!fixtureFiles) die(`${FIXTURE_DIR} is empty`);

// the register, the runner and what the runner needs to install
copyFile(registerSrc, path.join(staging, path.basename(REGISTER)));
copyFile(runnerSrc, path.join(staging, RUNNER));
for (const f of ROOT_FILES) copyFile(path.join(REPO_ROOT, f), path.join(staging, f));

// lib/ — the ledger library and its closure, flat, under no plugin tree
for (const [from, to] of libSrc) copyFile(from, path.join(staging, LIB_DIR, to));

// manifest.json — every fixture manifest with its path inside the archive
const manifests = listFiles(path.join(staging, FIXTURE_DIR))
  .filter(rel => path.basename(rel) === 'manifest.json')
  .sort()
  .map(rel => ({
    path: `${FIXTURE_DIR}/${rel}`,
    manifest: JSON.parse(fs.readFileSync(path.join(staging, FIXTURE_DIR, rel), 'utf8')),
  }));
if (!manifests.length) die(`${FIXTURE_DIR} holds no manifest.json`);
fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifests, null, 2)}\n`);

// VERSION
const pluginVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PLUGIN_MANIFEST), 'utf8')).version;
const version = {
  tag,
  git_sha: gitSha(),
  git_dirty: gitDirty(),
  plugin_version: pluginVersion,
  built_at: utcStamp(),
  fixture_count: manifests.length,
  schema_count: schemaNames.length,
  // The archive carries no per-file checksum list — `manifest.json` aggregates
  // the fixture manifests and the sidecar covers the tarball as a whole — so a
  // count is what makes a truncated extraction detectable at all.
  lib_count: LIB_FILES.length,
  runner: RUNNER,
  verify: `npm ci && node ${RUNNER} --fixtures=${FIXTURE_DIR} --schemas=schemas`,
  note: 'Not byte-reproducible across builds (built_at, staging mtimes). The .sha256 sidecar verifies a downloaded asset against the one the release attached; git_sha is the cross-build identity.',
};
fs.writeFileSync(path.join(staging, 'VERSION'), `${JSON.stringify(version, null, 2)}\n`);

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

// macOS tar has no --transform, so the top-level directory comes from running
// tar inside dist/ over a sorted, explicit file list (no directory entries).
const staged = listFiles(staging).sort();
const listFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-tarball-')), 'files.txt');
fs.writeFileSync(listFile, `${staged.map(rel => `${tag}/${rel}`).join('\n')}\n`);

const archiveName = `${tag}.tar.gz`;
const archivePath = path.join(distDir, archiveName);
fs.rmSync(archivePath, { force: true });
const tarProc = spawnSync('tar', ['-czf', archiveName, '-T', listFile], { cwd: distDir, encoding: 'utf8' });
fs.rmSync(path.dirname(listFile), { recursive: true, force: true });
if (tarProc.status !== 0) die(`tar exited ${tarProc.status}: ${(tarProc.stderr ?? '').trim().split('\n')[0]}`);

const bytes = fs.readFileSync(archivePath);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`);

const mb = (bytes.length / (1024 * 1024)).toFixed(2);
console.log(`staged   dist/${tag}/ — ${staged.length} files (${manifests.length} fixtures, ${schemaNames.length} schemas, ${LIB_FILES.length} lib modules)`);
console.log(`archive  dist/${archiveName} — ${mb} MB`);
console.log(`sha256   ${digest}`);
console.log(`verify   shasum -a 256 -c dist/${archiveName}.sha256`);
