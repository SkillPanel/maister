/**
 * Shared scaffolding for the engine verb tests.
 *
 * Every verb runs the way a driver runs it — `node workflow.mjs <verb>` in a
 * child process, the patch or request on stdin — so what is asserted is the
 * verb's contract (exit code, stdout, stderr, the files it leaves), never a
 * module's internals. Each test works in its own scratch copy under the OS
 * temp directory; the committed fixtures are never written to.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse } from '../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_DIR = path.join(ROOT, 'plugins/maister/skills/workflow-engine');
export const ENGINE = path.join(ENGINE_DIR, 'scripts/workflow.mjs');
export const UMBRELLA = path.join(ROOT, 'plugins/maister/skills/umbrella/scripts/umbrella.mjs');
export const FIXTURES = path.join(ROOT, 'tests/fixtures');
export const SAMPLE = path.join(FIXTURES, 'definitions/sample.yml');

/**
 * An empty Claude Code config directory every child process sees, so the
 * engine's edition check reads fixture settings or none — never the operator's
 * own `~/.claude`. Removed when the test process exits.
 */
const EMPTY_CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-config-'));
process.on('exit', () => fs.rmSync(EMPTY_CONFIG, { recursive: true, force: true }));

/**
 * Run one engine verb. `stdin` is sent as JSON unless it is already a string;
 * `env` is laid over the isolated environment, for a test that supplies its own
 * settings.
 */
export function verb(args, stdin, env = {}) {
  return run(ENGINE, args, stdin, env);
}

/** Run one umbrella runtime verb, for the outbox a dispatched run publishes to. */
export function umbrella(args, stdin) {
  return run(UMBRELLA, args, stdin);
}

/** Run a Node script as a child with the isolated environment: the hooks' tests use it too. */
export function run(script, args, stdin, env = {}, cwd = undefined) {
  const input = stdin === undefined ? '' : typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const childEnv = { ...process.env, CLAUDE_CONFIG_DIR: EMPTY_CONFIG };
  delete childEnv.CLAUDE_PROJECT_DIR;
  Object.assign(childEnv, env);
  const result = spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', env: childEnv, cwd });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A scratch project holding one run directory, laid out where a real run lives
 * (`<root>/.maister/tasks/<type>/<dated-name>/`) because the projection derives
 * the project root from that depth. `fixture` names a directory under
 * `fixtures/runs/` copied into the run directory; removed when the test ends.
 */
export function scratch(t, { fixture = null, type = 'development', name = '2026-01-05-sample' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = sibling({ root }, { type, name });
  if (fixture) fs.cpSync(path.join(FIXTURES, 'runs', fixture), run.dir, { recursive: true });
  return run;
}

/**
 * A second run directory in the same scratch project — a sub-run's child sits
 * beside its parent. `path` is the repository-root-relative task path a parent
 * records for it.
 */
export function sibling(run, { type, name }) {
  const relative = `.maister/tasks/${type}/${name}`;
  const dir = path.join(run.root, relative);
  fs.mkdirSync(dir, { recursive: true });
  return { root: run.root, dir, path: relative, name, state: path.join(dir, 'orchestrator-state.yml') };
}

/** Write a patch through `write-state` and fail loudly if it was refused. */
export function write(run, patch) {
  const result = verb(['write-state', `--state=${run.state}`], patch);
  if (result.code !== 0) throw new Error(`write-state exited ${result.code}: ${result.stderr}`);
  return result;
}

/**
 * Freeze a definition into a run: `resolve`, then the one `write-state` that
 * installs the task, the `workflow:` block with every node pending, and the
 * run's inputs — the engine's Step 4. `overlays` and `profile` are passed to
 * `resolve` and recorded as the freeze records them. Returns the resolved graph.
 */
export function freeze(run, { definition = SAMPLE, overlays = [], profile = null, task = {}, orchestrator = {}, inputs = null } = {}) {
  const args = ['resolve', `--definition=${definition}`, ...overlays.map(overlay => `--overlay=${overlay}`)];
  if (profile !== null) args.push(`--profile=${profile}`);
  const resolved = verb(args);
  if (resolved.code !== 0) throw new Error(`resolve exited ${resolved.code}: ${resolved.stdout}${resolved.stderr}`);
  const graph = JSON.parse(resolved.stdout);
  const nodes = {};
  for (const node of graph.nodes) nodes[node.id] = { kind: kindOf(node) };
  const patch = {
    task: { title: 'Sample run', status: 'in_progress', ...task },
    workflow: {
      source: definition,
      overlays: graph.overlays,
      profile: graph.profile,
      graph_hash: graph.graph_hash,
      grammar_version: 1,
      name: graph.name,
      nodes,
    },
    orchestrator: { ...orchestrator, ...(inputs ? { options: { inputs } } : {}) },
  };
  write(run, patch);
  return graph;
}

/** A node's recorded kind: `gate` for a gate, else the scheme its `uses` names. */
function kindOf(node) {
  return node.type === 'gate' ? 'gate' : node.uses.slice(0, node.uses.indexOf(':'));
}

/**
 * The run's state as the engine's shared reader sees it, as plain objects: the
 * reader builds null-prototype maps, which `deepEqual` tells apart from a literal.
 */
export function readState(run) {
  return JSON.parse(JSON.stringify(parse(fs.readFileSync(run.state, 'utf8'))));
}

/** The dashboard projection beside the state, parsed; null when there is none. */
export function readDashboard(run) {
  const file = path.join(run.dir, 'dashboard-data.js');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const prefix = 'window.MAISTER_DATA = ';
  if (!text.startsWith(prefix) || !text.endsWith(';\n')) throw new Error(`unexpected dashboard-data.js framing: ${text.slice(0, 40)}`);
  return JSON.parse(text.slice(prefix.length, -2));
}

/** The last non-empty line of a verb's stdout — where a closing marker must sit. */
export function lastLine(text) {
  const lines = text.split('\n').filter(line => line !== '');
  return lines[lines.length - 1];
}
