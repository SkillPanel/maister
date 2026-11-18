/**
 * The external sources check: does standards discovery's external scan have
 * anything to read in this project?
 *
 *   node <path to this file> [--project=<dir>]
 *
 * `--project` names the project; it defaults to the current directory, so a
 * caller runs it from the project root. Exec form, no shebang, zero
 * dependencies, `node:` builtins only, Node >= 20. Every probe is a direct
 * process start with an argument list, never a shell line, so the command is
 * the same in bash, zsh, PowerShell and cmd.exe.
 *
 * Three sources:
 * - pull requests, readable when `gh` is installed and signed in (`gh auth
 *   status` exits 0) and the repository has a git remote. A `gh` that is not
 *   installed, or not signed in (or cannot reach its host), is a state this
 *   check reports, never an error;
 * - CI configuration: GitHub Actions workflows, GitLab CI, Jenkins, CircleCI,
 *   Travis, Azure Pipelines, Bitbucket Pipelines;
 * - pre-commit hooks: Husky, the pre-commit framework, lint-staged.
 *
 * Output: one JSON report on stdout, `{scan, pull_requests: {readable,
 * reason}, github, remote, ci, hooks}`. `github` is `available`,
 * `not-installed` or `not-signed-in`; `ci` and `hooks` list project-relative
 * paths. `scan` is true when any source has something to read. Exit 0 for a
 * finished check, whatever it found; 2 for a usage error.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, USAGE: 2 };

/** How long a probe may take; `gh auth status` asks its host over the network. */
const PROBE_TIMEOUT_MS = 20000;

const CI_FILES = ['.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml', '.travis.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml'];
const HOOK_FILES = ['.pre-commit-config.yaml', '.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yml', '.lintstagedrc.yaml', '.lintstagedrc.js', '.lintstagedrc.cjs', '.lintstagedrc.mjs', 'lint-staged.config.js', 'lint-staged.config.cjs', 'lint-staged.config.mjs'];

/** Start `command` with `args`; null when it is not installed. */
function probe(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: PROBE_TIMEOUT_MS, windowsHide: true });
  if (result.error?.code === 'ENOENT') return null;
  return { status: result.error ? null : result.status, stdout: result.stdout ?? '' };
}

function githubState(project) {
  const result = probe('gh', ['auth', 'status'], project);
  if (result === null) return 'not-installed';
  return result.status === 0 ? 'available' : 'not-signed-in';
}

function hasRemote(project) {
  const result = probe('git', ['-C', project, 'remote'], project);
  return result !== null && result.status === 0 && result.stdout.trim() !== '';
}

const isFile = file => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

const isDir = dir => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

function ciFiles(project) {
  const found = [];
  const actions = path.join(project, '.github', 'workflows');
  if (isDir(actions)) {
    for (const name of fs.readdirSync(actions).sort()) {
      if (/\.ya?ml$/.test(name) && isFile(path.join(actions, name))) found.push(`.github/workflows/${name}`);
    }
  }
  for (const rel of CI_FILES) if (isFile(path.join(project, ...rel.split('/')))) found.push(rel);
  return found;
}

function hookFiles(project) {
  const found = [];
  if (isDir(path.join(project, '.husky'))) found.push('.husky/');
  for (const rel of HOOK_FILES) if (isFile(path.join(project, rel))) found.push(rel);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    if (manifest !== null && typeof manifest === 'object' && Object.hasOwn(manifest, 'lint-staged')) found.push('package.json (lint-staged)');
  } catch {
    // no package.json, or one that does not parse: no lint-staged there
  }
  return found;
}

function pullRequests(github, remote) {
  if (github === 'not-installed') return { readable: false, reason: 'gh is not installed' };
  if (github === 'not-signed-in') return { readable: false, reason: 'gh is not signed in, or cannot reach its host' };
  if (!remote) return { readable: false, reason: 'the repository has no git remote' };
  return { readable: true, reason: 'gh is signed in and the repository has a remote' };
}

let project = process.cwd();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--project=') && arg.length > '--project='.length) project = path.resolve(arg.slice('--project='.length));
  else {
    process.stderr.write('usage: node external-sources.mjs [--project=<dir>]\n');
    process.exit(EXIT.USAGE);
  }
}

const github = githubState(project);
const remote = hasRemote(project);
const ci = ciFiles(project);
const hooks = hookFiles(project);
const pull_requests = pullRequests(github, remote);
const scan = pull_requests.readable || ci.length > 0 || hooks.length > 0;
process.stdout.write(`${JSON.stringify({ scan, pull_requests, github, remote, ci, hooks }, null, 2)}\n`);
process.exit(EXIT.OK);
