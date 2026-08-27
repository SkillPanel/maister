#!/usr/bin/env node
/**
 * Layer-0 contract compatibility suite.
 *
 * Usage:
 *   node scripts/verify-contracts.mjs [--only=T01[,T03]] [--fixtures=<dir>] [--schemas=<dir>]
 *
 * Prints one line per test (`ok` / `FAIL` / `skip` + check count) and exits
 * non-zero when any test fails. Tests that need a tree which a vendored copy
 * does not carry declare it in `needs` and print `skip` instead of failing, so
 * the same script runs unchanged from the contracts tarball.
 *
 * Layout — three banded sections, in this order:
 *   1. shared     argv, small helpers, schema loading, the fixture corpus, the
 *                 tolerant readers, the runner lints, the register-derived
 *                 constants, and the hook replay harness (T13-T21 share it).
 *                 Anything used by more than one test lives here.
 *   2. tests      one `tNN(ctx)` per test, banner-titled, in id order T01-T28.
 *                 A constant used by a single test sits in that test's band.
 *   3. registry   the `TESTS` table (also id-ordered) and `main`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import crypto from 'node:crypto';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCHEMAS = path.join(REPO_ROOT, 'plugins/maister/skills/orchestrator-framework/schemas');
const DEFAULT_FIXTURES = path.join(REPO_ROOT, 'fixtures/contracts');
const VARIANT_SCHEMAS = path.join(REPO_ROOT, 'plugins/maister-copilot/skills/orchestrator-framework/schemas');
const SCHEMA_ID_BASE = 'https://maister.dev/schemas/contracts/';
const DIALECT_2020 = 'https://json-schema.org/draft/2020-12/schema';

// YAML 1.2 core schema: an unquoted `created: 2026-08-11T20:27:00Z` stays a
// string, which is what the A6 regex and the timestamp lints expect.
const YAML_OPTS = { version: '1.2', schema: 'core' };

// ===========================================================================
// shared: argv, readers, lints and the replay harness
// ===========================================================================

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { only: null, fixtures: DEFAULT_FIXTURES, schemas: DEFAULT_SCHEMAS };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--only':
        // `--only` and `--only=` name no test. Selecting nothing and exiting 0
        // would report a green run that asserted nothing, so it is a usage
        // error, on the same path as an unknown id.
        opts.only = value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (opts.only.length === 0) throw new Error('--only names no test id');
        break;
      case '--fixtures':
        opts.fixtures = path.resolve(value);
        break;
      case '--schemas':
        opts.schemas = path.resolve(value);
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * Every child this suite spawns is bounded: a hook that blocks on stdin or
 * loops must fail the run, never hang it (the registrations under test declare
 * 5-10 s). Unpacking and re-running the release archive gets the longer budget.
 */
const SPAWN_TIMEOUT_MS = 60_000;
const ARCHIVE_TIMEOUT_MS = 180_000;

/** `spawnSync` with a deadline; a kill or a spawn error is surfaced on stderr. */
function runBounded(file, args, opts = {}) {
  const { timeout = SPAWN_TIMEOUT_MS, ...rest } = opts;
  const proc = spawnSync(file, args, { timeout, killSignal: 'SIGKILL', ...rest });
  if (proc.error || proc.signal) {
    const why = proc.error ? proc.error.message : `killed by ${proc.signal} after ${timeout} ms`;
    const prior = proc.stderr ?? '';
    proc.stderr = `${prior}${prior ? '\n' : ''}${file}: ${why}`;
  }
  return proc;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Walk a parsed JSON value, yielding [pointer, value] for every node. */
function* walk(node, pointer = '') {
  yield [pointer, node];
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walk(node[i], `${pointer}/${i}`);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      yield* walk(value, `${pointer}/${escapeToken(key)}`);
    }
  }
}

const escapeToken = k => k.replace(/~/g, '~0').replace(/\//g, '~1');
const unescapeToken = t => t.replace(/~1/g, '/').replace(/~0/g, '~');

/** Resolve a JSON pointer (`#/$defs/x`) inside a parsed document. */
function resolvePointer(doc, pointer) {
  if (pointer === '' || pointer === '#') return doc;
  const parts = pointer.replace(/^#/, '').split('/').filter(Boolean).map(unescapeToken);
  let cur = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// schema loading (shared by every schema-aware test)
// ---------------------------------------------------------------------------

/**
 * Load every `*.schema.json` under `dir` into one Ajv 2020-12 instance.
 *
 * Two strict-mode sub-options are relaxed, both of them Ajv's own defaults
 * outside `strict: true`:
 *   allowUnionTypes  — the contracts model nullable scalars as ["string","null"]
 *   strictRequired   — presence-only branches (oneOf over `required`, `not`/
 *                      `required` in an if/then) declare no `properties` by
 *                      construction; they test key presence, not key shape.
 *
 * `validateFormats: false` because no contract relies on `format`: every
 * constrained scalar in the register is pinned with an explicit `pattern`
 * (§ A6 timestamps, uuid7 run ids, artifact paths), so annotation-only `format`
 * keywords would add a dependency on Ajv's format table without adding a rule.
 * T01 asserts the schemas keep that property, so the setting stays safe.
 */
function loadSchemas(dir) {
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.schema.json')).sort();
  const docs = names.map(name => ({
    name,
    id: name.replace(/\.schema\.json$/, ''),
    file: path.join(dir, name),
    json: readJson(path.join(dir, name)),
  }));

  const ajv = new Ajv2020({
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    allErrors: true,
    validateFormats: false,
  });
  for (const doc of docs) ajv.addSchema(doc.json, doc.json.$id ?? doc.name);

  const byId = new Map(docs.filter(d => d.json.$id).map(d => [d.json.$id, d]));
  return { ajv, docs, byId };
}

// ---------------------------------------------------------------------------
// fixture corpus
// ---------------------------------------------------------------------------

/** Every `manifest.json` under `root`, with its parsed manifest. */
function fixtureList(root) {
  const files = [];
  (function rec(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) rec(p);
      else if (entry.name === 'manifest.json') files.push(p);
    }
  })(root);
  return files.map(file => ({
    file,
    dir: path.dirname(file),
    id: path.relative(root, path.dirname(file)) || '.',
    manifest: readJson(file),
  }));
}

const fixtureCache = new Map();
function corpus(ctx) {
  if (!fixtureCache.has(ctx.fixtures)) fixtureCache.set(ctx.fixtures, fixtureList(ctx.fixtures));
  return fixtureCache.get(ctx.fixtures);
}

const byVerdict = (ctx, verdict) => corpus(ctx).filter(fx => fx.manifest.verdict === verdict);

/** `gate.schema.json#/$defs/request` → the `$id` Ajv knows it by. */
function schemaKey(ref) {
  const [name, fragment = ''] = ref.split('#');
  const id = SCHEMA_ID_BASE + name.replace(/\.schema\.json$/, '');
  return fragment ? `${id}#${fragment}` : id;
}

/**
 * The documents one fixture file contributes. Line-oriented formats yield one
 * document per non-empty line, which is how their schemas are written.
 */
function loadDocs(file) {
  const text = fs.readFileSync(file, 'utf8');
  switch (path.extname(file)) {
    case '.yml':
    case '.yaml':
      return [parseYaml(text, YAML_OPTS)];
    case '.json':
      return [JSON.parse(text)];
    case '.jsonl':
      return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    case '.js':
      return [readDashboardData(text).data];
    case '.log':
    case '.txt':
      return text.split('\n').filter(l => l.trim());
    default:
      return [text];
  }
}

/** Validate every document a file yields; returns the accumulated Ajv errors. */
function validateFile(ajv, file, ref) {
  const validate = ajv.getSchema(schemaKey(ref));
  if (!validate) return [{ instancePath: '', keyword: 'schema-ref', message: `unknown schema ref ${ref}` }];
  const errors = [];
  const docs = loadDocs(file);
  for (let i = 0; i < docs.length; i++) {
    if (validate(docs[i])) continue;
    for (const err of validate.errors) {
      errors.push(docs.length > 1 ? { ...err, instancePath: `/${i}${err.instancePath}` } : err);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// tolerant readers (A1, A2, A5, B1, B2, E2, C7)
// ---------------------------------------------------------------------------

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A newer format degrades on read; it never throws and never drops keys. */
const isNewerVersion = v => typeof v === 'number' && v > 1;

/**
 * A1 read-tolerant. Returns the parsed state plus the degradation reasons the
 * cockpit records for it. The drift shapes frozen in the reconciliation table
 * (#6 `task_context` under `orchestrator`, #9 `project_context` under
 * `task_context`, #24 no `orchestrator` block at all) are read, not rejected.
 */
function readState(text) {
  let data;
  try {
    data = parseYaml(text, YAML_OPTS);
  } catch {
    return { data: null, degraded: ['unparseable'], title: null, orchestrator: null, workflow: null };
  }
  if (!isObject(data)) {
    return { data: null, degraded: ['unparseable'], title: null, orchestrator: null, workflow: null };
  }

  const degraded = [];
  const orchestrator = isObject(data.orchestrator) ? data.orchestrator : null;
  const task = isObject(data.task) ? data.task : null;
  const title = (task && (task.title ?? task.name)) || null;

  if (!orchestrator) {
    degraded.push('no-orchestrator-block');
    if (title) degraded.push('inventory-with-title');
  } else if (isObject(orchestrator.task_context)) {
    degraded.push('task-context-nested-under-orchestrator');
  }

  const taskContext = (isObject(data.task_context) && data.task_context)
    || (orchestrator && isObject(orchestrator.task_context) && orchestrator.task_context)
    || null;
  if (taskContext && isObject(taskContext.project_context)) {
    degraded.push('project-context-nested-under-task-context');
  }

  const workflow = isObject(data.workflow) ? data.workflow : null;
  if (isNewerVersion(data.version) || (workflow && isNewerVersion(workflow.grammar_version))) {
    degraded.push('newer-format');
  }
  return { data, degraded, title, orchestrator, workflow };
}

/**
 * A2 read-tolerant. The written form is one strict-JSON assignment; readers also
 * accept a bare-key object literal, which is what every sampled run outside the
 * synthetic set carries — hence `vm` rather than `JSON.parse`. Both the global
 * lookup and the serialisation run *inside* the realm under the same 100 ms
 * budget, so a fixture-side getter or `toJSON` loop cannot hang the suite; only
 * the JSON string crosses back out.
 */
const DASHBOARD_PROBE = `(() => {
  const g = (typeof window === 'object' && window !== null) ? window : {};
  const key = ('MAISTER_DATA' in g) ? 'MAISTER_DATA'
            : ('DASHBOARD_DATA' in g) ? 'DASHBOARD_DATA'
            : null;
  if (key === null) return JSON.stringify({ key: null });
  const value = g[key];
  return JSON.stringify({ key, json: value === undefined ? null : JSON.stringify(value) });
})()`;

function readDashboardData(text) {
  const context = vm.createContext({ window: {} });
  try {
    vm.runInContext(text, context, { timeout: 100, displayErrors: false });
  } catch {
    return { data: null, degraded: ['unparseable'] };
  }
  let probe;
  try {
    probe = JSON.parse(vm.runInContext(DASHBOARD_PROBE, context, { timeout: 100, displayErrors: false }));
  } catch {
    // a looping getter (timed out), a circular value or a non-serialisable one
    return { data: null, degraded: ['unparseable'] };
  }
  if (probe.key === null) return { data: null, degraded: ['no-data-global'] };
  const degraded = [];
  if (probe.key === 'DASHBOARD_DATA') degraded.push('window.DASHBOARD_DATA');
  if (probe.json !== null && typeof probe.json !== 'string') {
    return { data: null, degraded: [...degraded, 'unparseable'] };
  }
  const data = probe.json === null ? null : JSON.parse(probe.json);
  if (isObject(data) && isNewerVersion(data.version)) degraded.push('newer-format');
  return { data, degraded };
}

/** B1 / B2 / E2 / C7: one shared degrade path over a versioned YAML document. */
function readVersionedYaml(text, versionKey = 'version') {
  let data;
  try {
    data = parseYaml(text, YAML_OPTS);
  } catch {
    return { data: null, degraded: ['unparseable'] };
  }
  const degraded = [];
  if (isObject(data) && isNewerVersion(data[versionKey])) degraded.push('newer-format');
  return { data, degraded };
}

/** A5 read-tolerant: the `&` heading is read, and reported as a writer drift. */
function readSummaryBlock(text) {
  const degraded = [];
  if (/^##\s+Open Questions\s+&\s+Risks\s*$/m.test(text)) degraded.push('open-questions-amp-heading');
  return { text, degraded };
}

/** A run directory: its state plus the degradations only the layout reveals. */
function readRun(dir) {
  const statePath = path.join(dir, 'orchestrator-state.yml');
  const state = isFile(statePath)
    ? readState(fs.readFileSync(statePath, 'utf8'))
    : { data: null, degraded: [], orchestrator: null };
  const degraded = [...state.degraded];
  const gatesDir = path.join(dir, 'gates');
  const pending = state.orchestrator ? state.orchestrator.gate_pending ?? null : null;
  if (isDir(gatesDir) && !pending) {
    const unanswered = fs.readdirSync(gatesDir)
      .filter(name => name.endsWith('.request.yml'))
      .filter(name => /^answer:\s*null\s*$/m.test(fs.readFileSync(path.join(gatesDir, name), 'utf8')));
    if (unanswered.length) degraded.push('terminal-mode-request-optional');
  }
  return { state, degraded };
}

// ---------------------------------------------------------------------------
// runner lints — the assertions no JSON Schema keyword can express
// ---------------------------------------------------------------------------

const MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;

/** A6: midnight is the signature of a date that was formatted, not measured. */
function lintNotMidnight(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object') return errors;
  for (const [pointer, node] of walk(doc)) {
    if (typeof node === 'string' && MIDNIGHT.test(node)) {
      errors.push({ instancePath: pointer, keyword: 'not_midnight', message: 'timestamp is midnight' });
    }
  }
  return errors;
}

/** E2: `gate_pending` occupies exactly one line — `null` or a flow map. */
function lintE2OneLine(text) {
  const errors = [];
  for (const line of text.split('\n')) {
    const m = /^(\s*)gate_pending:(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[2].replace(/\s+#.*$/, '').trim();
    const ok = rest === 'null' || (rest.startsWith('{') && rest.endsWith('}'));
    if (!ok) {
      errors.push({
        instancePath: '/orchestrator/gate_pending',
        keyword: 'e2-one-line-form',
        message: 'gate_pending must be one line: null or a single-line flow map',
      });
    }
  }
  return errors;
}

/**
 * B2: every `workflow.nodes` entry occupies exactly one line. `scope` is `root`
 * for a bare workflow block and `workflow` for a whole state file. A workflow
 * *definition* writes block form legitimately and is never linted here.
 */
function lintB2OneLine(text, scope) {
  const lines = text.split('\n');
  let from = 0;
  if (scope === 'workflow') {
    from = lines.findIndex(l => /^workflow:\s*$/.test(l));
    if (from === -1) return [];
  }
  let nodesAt = -1;
  for (let i = from; i < lines.length; i++) {
    if (scope === 'workflow' && i > from && /^\S/.test(lines[i])) break;
    const m = /^(\s*)nodes:\s*$/.exec(lines[i]);
    if (!m) continue;
    if (scope === 'root' && m[1].length !== 0) continue;
    nodesAt = i;
    break;
  }
  if (nodesAt === -1) return [];

  const errors = [];
  let childIndent = null;
  for (let i = nodesAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (childIndent === null) childIndent = indent;
    if (indent < childIndent) break;
    if (indent > childIndent) continue;
    const entry = /^\s*([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!entry) break;
    const rest = entry[2].trim();
    if (!(rest.startsWith('{') && rest.endsWith('}'))) {
      errors.push({
        instancePath: `/nodes/${entry[1]}`,
        keyword: 'b2-one-line-form',
        message: 'each workflow node entry must be one line',
      });
    }
  }
  return errors;
}

/** B1: `needs` describes a DAG. Reference resolution is runner logic. */
function lintDag(doc) {
  if (!isObject(doc) || !isObject(doc.nodes)) return [];
  const nodes = doc.nodes;
  const ids = new Set(Object.keys(nodes));
  const mark = new Map();
  let cyclic = false;
  const visit = id => {
    const state = mark.get(id);
    if (state === 'done') return;
    if (state === 'open') { cyclic = true; return; }
    mark.set(id, 'open');
    const needs = isObject(nodes[id]) && Array.isArray(nodes[id].needs) ? nodes[id].needs : [];
    for (const need of needs) if (ids.has(need)) visit(need);
    mark.set(id, 'done');
  };
  for (const id of ids) visit(id);
  return cyclic
    ? [{ instancePath: '/nodes', keyword: 'dag-cycle', message: 'needs edges form a cycle' }]
    : [];
}

/** B1: a gate offers exactly one continue and at least one stop. */
function lintGateContinue(doc) {
  if (!isObject(doc) || !isObject(doc.nodes)) return [];
  const errors = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isObject(node) || node.type !== 'gate' || !isObject(node.options)) continue;
    const effects = Object.values(node.options);
    const continues = effects.filter(e => e === 'continue').length;
    const stops = effects.filter(e => e === 'stop').length;
    if (continues !== 1 || stops < 1) {
      errors.push({
        instancePath: `/nodes/${id}/options`,
        keyword: 'gate-exactly-one-continue',
        message: `gate offers ${continues} continue and ${stops} stop options`,
      });
    }
  }
  return errors;
}

/**
 * B1: every `${…}` reference inside a `with` value names a declared node or
 * `inputs`. Reference resolution is runner logic, so the schema — which treats
 * `with` as an open object — has nothing to say about it.
 */
function lintUnknownReference(doc) {
  if (!isObject(doc) || !isObject(doc.nodes)) return [];
  const declared = new Set([...Object.keys(doc.nodes), 'inputs']);
  const errors = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isObject(node) || !isObject(node.with)) continue;
    for (const [key, value] of Object.entries(node.with)) {
      if (typeof value !== 'string') continue;
      for (const [, dotted] of value.matchAll(/\$\{([^}]*)\}/g)) {
        const head = dotted.split('.')[0];
        if (declared.has(head)) continue;
        errors.push({
          instancePath: `/nodes/${id}/with/${key}`,
          keyword: 'reference-unknown-node',
          message: `"${dotted}" names "${head}", which no node declares`,
        });
      }
    }
  }
  return errors;
}

/** E2: the answer records only an option id, so ids must be unique. */
function lintGateOptionIds(doc) {
  if (!isObject(doc) || !Array.isArray(doc.options)) return [];
  const seen = new Set();
  for (const option of doc.options) {
    const id = isObject(option) ? option.id : option;
    if (seen.has(id)) {
      return [{
        instancePath: '/options',
        keyword: 'gate-option-id-unique',
        message: `option id ${id} appears more than once`,
      }];
    }
    seen.add(id);
  }
  return [];
}

/** A5: the summary block opens the document and its TL;DR runs 1-5 lines. */
function lintA5(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) if (/^##\s+/.test(lines[i])) headings.push(i);
  const at = headings.findIndex(i => /^##\s+TL;DR\s*$/.test(lines[i]));
  if (at === -1) return [];

  const errors = [];
  if (at !== 0) {
    errors.push({
      instancePath: '/TL;DR',
      keyword: 'a5-block-position',
      message: 'the summary block must precede every other section',
    });
  }
  const end = headings[at + 1] ?? lines.length;
  const body = lines.slice(headings[at] + 1, end).filter(l => l.trim());
  if (body.length < 1 || body.length > 5) {
    errors.push({
      instancePath: '/TL;DR',
      keyword: 'a5-tldr-line-count',
      message: `TL;DR carries ${body.length} lines, expected 1-5`,
    });
  }
  return errors;
}

/** A1: the run reached an end state, so its last started phase is done. */
const TERMINAL_TASK_STATUS = new Set(['completed', 'failed', 'stopped']);

/**
 * A1: the state and the dashboard describe one run. Three rules, and the third
 * is deliberately weaker than the other two:
 *
 *   1. `started_phase` is not already in `completed_phases` — unless the run
 *      reached a terminal `task.status`, where the last started phase is
 *      legitimately complete. This rule reads the state alone.
 *   2. `task.status` agrees with the dashboard's.
 *   3. `completed_phases` ⊆ the dashboard phases marked `completed` or
 *      `skipped` — asserted for terminal runs only. A run still in progress
 *      rewrites the dashboard after the state, so a lagging row is an expected
 *      intermediate shape: a warning, never a failure.
 *
 * A skipped phase counts as done on both sides — the writer records it in
 * `completed_phases` and renders it as `skipped` (dev-complete-c `phase-13`).
 */
function crossCheckPhases(state, dashboard) {
  const empty = { errors: [], warnings: [] };
  if (!isObject(state)) return empty;
  const orchestrator = isObject(state.orchestrator) ? state.orchestrator : null;
  if (!orchestrator || !Array.isArray(orchestrator.completed_phases)) return empty;

  const errors = [];
  const warnings = [];
  const completedPhases = orchestrator.completed_phases.map(String);
  const status = isObject(state.task) ? state.task.status ?? null : null;
  const terminal = TERMINAL_TASK_STATUS.has(String(status));

  const startedAt = completedPhases.indexOf(String(orchestrator.started_phase ?? ''));
  if (orchestrator.started_phase && startedAt !== -1 && !terminal) {
    errors.push({
      instancePath: `/orchestrator/completed_phases/${startedAt}`,
      keyword: 'phase-status-cross-check',
      message: `${orchestrator.started_phase} is the started phase and is already completed`,
    });
  }
  if (!isObject(dashboard)) return { errors, warnings };

  const dashboardStatus = isObject(dashboard.task) ? dashboard.task.status ?? null : null;
  if (status && dashboardStatus && status !== dashboardStatus) {
    errors.push({
      instancePath: '/task/status',
      keyword: 'phase-status-cross-check',
      message: `state says ${status}, the dashboard says ${dashboardStatus}`,
    });
  }

  const phases = Array.isArray(dashboard.phases) ? dashboard.phases.filter(isObject) : [];
  const known = new Set(phases.map(p => String(p.id)));
  const done = new Set(
    phases.filter(p => p.status === 'completed' || p.status === 'skipped').map(p => String(p.id)),
  );
  completedPhases.forEach((id, i) => {
    if (!known.has(id) || done.has(id)) return;
    const finding = {
      instancePath: `/orchestrator/completed_phases/${i}`,
      keyword: 'phase-status-cross-check',
      message: `${id} is completed in state and not in the dashboard`,
    };
    (terminal ? errors : warnings).push(finding);
  });
  return { errors, warnings };
}

/** The failing half of the cross-check, for the lint dispatcher. */
function lintPhaseCrossCheck(state, dashboard) {
  return crossCheckPhases(state, dashboard).errors;
}

/**
 * Every runner lint that applies to one fixture, dispatched by its schema ref.
 *
 * `a5` and `crossCheck` are opt-in because the positive direction of both is
 * owned by a later test (T08 and T12): here they exist so the invalid fixtures
 * that encode them fail for the reason their manifest names.
 */
function runnerLints(fx, { a5 = false, crossCheck = false } = {}) {
  const errors = [];
  let state = null;
  let dashboard = null;

  for (const entry of fx.manifest.files) {
    const file = path.join(fx.dir, entry.path);
    if (!isFile(file)) continue;
    const ext = path.extname(entry.path);
    const ref = entry.schema ?? '';
    const base = ref.split('#')[0];

    if (ext === '.md') {
      if (a5) errors.push(...lintA5(fs.readFileSync(file, 'utf8')));
      continue;
    }
    if (base === 'orchestrator-state.schema.json') {
      const text = fs.readFileSync(file, 'utf8');
      state = readState(text).data;
      errors.push(...lintE2OneLine(text), ...lintB2OneLine(text, 'workflow'), ...lintNotMidnight(state));
    } else if (base === 'workflow-state.schema.json') {
      errors.push(...lintB2OneLine(fs.readFileSync(file, 'utf8'), 'root'));
    } else if (base === 'workflow-definition.schema.json') {
      const doc = parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS);
      errors.push(...lintDag(doc), ...lintGateContinue(doc), ...lintUnknownReference(doc));
    } else if (base === 'gate.schema.json' && ref.includes('request')) {
      errors.push(...lintGateOptionIds(parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS)));
    } else if (ext === '.js') {
      dashboard = readDashboardData(fs.readFileSync(file, 'utf8')).data;
      errors.push(...lintNotMidnight(dashboard));
    }
  }
  if (crossCheck) errors.push(...lintPhaseCrossCheck(state, dashboard));
  return errors;
}

// ---------------------------------------------------------------------------
// register-derived constants and lints (A4, A5, A6, R)
// ---------------------------------------------------------------------------

/**
 * The register is the source: the runner reads the frozen `dashboard.html` MD5
 * out of it rather than carrying a second copy of the constant.
 */
const REGISTER = 'skills/orchestrator-framework/references/compatibility-contracts.md';
const REGISTER_MD5 = /\*\*`dashboard\.html` MD5\*\*:\s*`([0-9a-f]{32})`/;

function registerMd5(pluginRoot) {
  const file = path.join(pluginRoot, REGISTER);
  if (!isFile(file)) return null;
  const hit = REGISTER_MD5.exec(fs.readFileSync(file, 'utf8'));
  return hit ? hit[1] : null;
}

const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

// --- A5 -------------------------------------------------------------------

/**
 * The A5 lint walks registered A4 artifact paths only. Unregistered files at
 * the task root (boost's ad-hoc `SUMMARY.md`) carry no summary block and are
 * never linted; the exempt basenames are registered paths that legitimately
 * have none.
 */
const A5_EXEMPT_BASENAMES = new Set([
  'work-log.md', 'README.md', 'INDEX.md', 'coordinator-handoff.md', 'design-resources.md',
]);
// `artifacts/` is the run fixtures' flattening of the per-workflow artifact
// directories; the other five are the A4 register's own subdirectory names.
const A5_REGISTERED_DIRS = [
  'analysis/', 'planning/', 'implementation/', 'verification/', 'documentation/',
  'outputs/', 'artifacts/',
];

function isA5Registered(rel) {
  const normalized = rel.split(path.sep).join('/');
  if (!normalized.endsWith('.md')) return false;
  if (A5_EXEMPT_BASENAMES.has(path.posix.basename(normalized))) return false;
  return A5_REGISTERED_DIRS.some(dir => normalized.startsWith(dir));
}

const A5_H1 = /^#\s+\S/;
const A5_H2 = /^##\s+/;
const A5_TLDR = /^##\s+TL;DR\s*$/;
const A5_KEY_DECISIONS = /^##\s+Key Decisions\s*$/;
const A5_RISKS_READER = /^##\s+Open Questions\s+[/&]\s+Risks\s*$/;
const A5_RISKS_WRITER = /^##\s+Open Questions\s+\/\s+Risks\s*$/;

/**
 * A5 positional form: optional H1, optional preamble carrying no `## `, then
 * `## TL;DR` + 1-5 lines, then the two optional sections. The first other
 * `## ` heading ends the block. `amp` records the tolerated `&` heading.
 */
function matchA5(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && A5_H1.test(lines[i])) i++;
  while (i < lines.length && !A5_H2.test(lines[i])) i++;

  if (i >= lines.length) return { ok: false, reason: 'no summary block', amp: false };
  if (!A5_TLDR.test(lines[i])) {
    return { ok: false, reason: `the block opens with ${lines[i].trim()}`, amp: false };
  }
  i++;
  let body = 0;
  while (i < lines.length && !A5_H2.test(lines[i])) {
    if (lines[i].trim()) body++;
    i++;
  }
  if (body < 1 || body > 5) {
    return { ok: false, reason: `TL;DR carries ${body} lines, expected 1-5`, amp: false };
  }
  if (i < lines.length && A5_KEY_DECISIONS.test(lines[i])) {
    i++;
    while (i < lines.length && !A5_H2.test(lines[i])) i++;
  }
  let amp = false;
  if (i < lines.length && A5_RISKS_READER.test(lines[i])) {
    amp = !A5_RISKS_WRITER.test(lines[i]);
  }
  return { ok: true, reason: null, amp };
}

/** A5 write side: the reader form plus the slash heading. */
function lintA5Writer(text) {
  const read = matchA5(text);
  const errors = [];
  if (!read.ok) {
    errors.push({ instancePath: '/TL;DR', keyword: 'a5-block-shape', message: read.reason });
  }
  if (read.amp) {
    errors.push({
      instancePath: '/Open Questions',
      keyword: 'a5-writer-heading',
      message: 'the writer form is "Open Questions / Risks"',
    });
  }
  return errors;
}

// --- A6 -------------------------------------------------------------------

const A6_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * The A6 field-path list, by leaf name. A task-directory name prefix is a bare
 * date and lives under `task_path`/`path`/`dir`, none of which are on the list:
 * the exemption is the list, not a special case.
 */
const A6_FIELDS = new Set([
  'created', 'updated', 'started', 'completed', 'generated', 'since', 'asked_at', 'at', 'ts',
]);

function lintA6(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object') return errors;
  for (const [pointer, node] of walk(doc)) {
    const leaf = unescapeToken(pointer.split('/').pop() ?? '');
    if (!A6_FIELDS.has(leaf) || node === null || node === undefined) continue;
    if (typeof node !== 'string' || !A6_TIMESTAMP.test(node)) {
      errors.push({ instancePath: pointer, keyword: 'pattern', message: 'not an A6 timestamp' });
    } else if (MIDNIGHT.test(node)) {
      errors.push({ instancePath: pointer, keyword: 'not_midnight', message: 'timestamp is midnight' });
    }
  }
  return errors;
}

// --- A4 -------------------------------------------------------------------

const LEGACY_TYPE_DIRS = new Set(['bug-fixes', 'enhancements', 'new-features', 'refactoring', 'mockups']);
const TASK_DIR_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

/**
 * A4 enumeration over a `<type>/<task-dir>` listing. A dir is at the floor when
 * its state parses, `orchestrator.created` is a full non-midnight timestamp and
 * `task.title` exists; everything else under a type dir is an inventory row.
 * Non-task children and dot-prefixed paths are ignored entirely.
 */
function enumerateTaskTree(tree) {
  const taskDirs = [];
  const inventoryOnly = [];
  const ignored = [];
  for (const entry of tree.entries ?? []) {
    const segments = entry.path.split('/');
    if (entry.dot_prefixed || segments.some(s => s.startsWith('.'))) { ignored.push(entry.path); continue; }
    if (entry.kind !== 'task-dir' || segments.length !== 2 || !TASK_DIR_NAME.test(segments[1])) {
      ignored.push(entry.path);
      continue;
    }
    const state = entry.state ?? {};
    const legacy = entry.legacy_type === true || LEGACY_TYPE_DIRS.has(segments[0]);
    const atFloor = !legacy
      && state.present === true && state.parses === true
      && typeof state.created === 'string' && A6_TIMESTAMP.test(state.created) && !MIDNIGHT.test(state.created)
      && typeof state.task_title === 'string' && state.task_title.length > 0;
    (atFloor ? taskDirs : inventoryOnly).push(entry.path);
  }
  return { taskDirs, inventoryOnly, ignored };
}

/** The same listing, read off a real `.maister/tasks` tree. */
function scanTaskTree(root) {
  const entries = [];
  for (const type of fs.readdirSync(root).sort()) {
    const typeDir = path.join(root, type);
    if (type.startsWith('.')) { entries.push({ path: type, kind: 'dir', dot_prefixed: true }); continue; }
    if (!isDir(typeDir)) { entries.push({ path: type, kind: 'file' }); continue; }
    for (const name of fs.readdirSync(typeDir).sort()) {
      const dir = path.join(typeDir, name);
      const rel = `${type}/${name}`;
      if (!isDir(dir)) { entries.push({ path: rel, kind: 'file' }); continue; }
      const statePath = path.join(dir, 'orchestrator-state.yml');
      const entry = { path: rel, kind: 'task-dir', state: { present: isFile(statePath), parses: false, created: null, task_title: null } };
      if (LEGACY_TYPE_DIRS.has(type)) entry.legacy_type = true;
      if (entry.state.present) {
        const read = readState(fs.readFileSync(statePath, 'utf8'));
        entry.state.parses = read.data !== null;
        entry.state.created = read.orchestrator ? read.orchestrator.created ?? null : null;
        entry.state.task_title = read.title;
      }
      entries.push(entry);
    }
  }
  return { root, entries };
}

// --- R --------------------------------------------------------------------

/**
 * Contract R: a reserved key parses, warns and carries no behaviour. Specs are
 * `a.dotted.path` or `a.dotted.path=value`; the warning names the path only.
 */
function lintReservedKeys(doc, reserved) {
  const warnings = [];
  for (const spec of reserved) {
    const [dotted, want] = spec.split('=');
    const tail = `/${dotted.split('.').map(escapeToken).join('/')}`;
    for (const [pointer, node] of walk(doc)) {
      if (!pointer.endsWith(tail)) continue;
      if (want !== undefined && node !== want) continue;
      warnings.push(`reserved-key:${dotted}`);
      break;
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// hook replay harness (T13-T21)
// ---------------------------------------------------------------------------

/** Shared by the replay harness, T24 (registration) and T26 (orphan check). */
const GATE_HOOK = 'hooks/gate-enforce.mjs';

/** The script that owns each hook event, relative to the plugin root. */
const HOOK_SCRIPTS = {
  PreToolUse: GATE_HOOK,
  preToolUse: GATE_HOOK,
  Stop: 'hooks/gate-stop-nudge.mjs',
  agentStop: 'hooks/gate-stop-nudge.mjs',
  SessionStart: 'hooks/gate-beacon.mjs',
  sessionStart: 'hooks/gate-beacon.mjs',
};
const GATE_LIB = 'hooks/gate-lib.mjs';

/** The `task_path` shape each of the three A4 depths admits. */
const CWD_LAYOUTS = {
  'task-dir': /^\.maister\/tasks\/[^/]+\/[^/]+$/,
  'umbrella-run': /^\.maister\/umbrella\/runs\/[^/]+$/,
  'umbrella-sub-run': /^\.maister\/umbrella\/runs\/[^/]+\/runs\/[^/]+$/,
};

/** The response `$def` a decision must validate against, per provider. */
const RESPONSE_DEFS = {
  'claude/deny': 'hook-payloads.schema.json#/$defs/response_claude_pretooluse_deny',
  'copilot/deny': 'hook-payloads.schema.json#/$defs/response_copilot_pretooluse_deny',
  'claude/block': 'hook-payloads.schema.json#/$defs/response_claude_stop_block',
  'copilot/block': 'hook-payloads.schema.json#/$defs/response_copilot_agentstop_block',
};

/** The provider's fail-closed exit code (§ T5 outcome table). */
const FAIL_CLOSED_EXIT = { claude: 2, copilot: 0 };

// Frozen reason texts (§ T5). The hook writes instructions to the model, so the
// wording is part of the contract and not an implementation detail.
const DENY_PREFIX = 'GATE PENDING (';
const DENY_BLOCKED = '(blocked: ';
const FAIL_CLOSED_PREFIX = 'GATE HOOK FAIL-CLOSED: ';
const FAIL_CLOSED_TAIL =
  'Fix the file with the editor tools or stop and report RUN-FAILED: state-unparseable. Do not retry with another tool.';
const NUDGE_TAIL =
  'write the request file (temp + rename), set gate_pending, rewrite dashboard-data.js, print GATE-PENDING: ';

// ---------------------------------------------------------------------------
// E2 one-line reader — the reference implementation T13 measures against
// ---------------------------------------------------------------------------

/**
 * Read the frozen one-line E2 form out of a state file (register § 13).
 *
 * Deliberately a *second* implementation: `hooks/gate-lib.mjs` carries the one
 * the hooks run on, and T13 cross-checks the two whenever the plugin tree is
 * present. This copy is what keeps T13 meaningful from a vendored tarball,
 * which ships the fixtures and this script but no hooks.
 */
function scanStateText(text) {
  const out = { gatePending: null, hasWorkflow: false, hasNodes: false, hasTask: false, nodes: {} };
  let section = null;
  let inNodes = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^[A-Za-z_]/.test(line)) {
      section = line.split(':')[0];
      inNodes = false;
      if (section === 'workflow') out.hasWorkflow = true;
      if (section === 'task') out.hasTask = true;
      continue;
    }
    if (section === 'orchestrator' && line.startsWith('  gate_pending:')) {
      out.gatePending = parsePendingValue(line.slice('  gate_pending:'.length));
      continue;
    }
    if (section === 'workflow' && /^ {2}[A-Za-z_]/.test(line)) {
      inNodes = line.startsWith('  nodes:');
      if (inNodes) out.hasNodes = true;
      continue;
    }
    if (inNodes && /^ {4}\S/.test(line)) {
      const entry = /^ {4}([A-Za-z0-9_-]+):(.*)$/.exec(line);
      if (!entry) throw new Error('workflow.nodes entries must each be on one line: <id>: {…}');
      out.nodes[entry[1]] = parseFlowMap(entry[2], `workflow.nodes.${entry[1]}`);
    }
  }
  return out;
}

function parsePendingValue(rest) {
  const value = stripComment(rest).trim();
  if (value === '') {
    throw new Error('gate_pending must be on one line: either null or a flow map {node: …, request: …, since: …}');
  }
  if (value === 'null' || value === '~') return null;
  return parseFlowMap(value, 'gate_pending');
}

/** Strip a trailing `# …` comment from a value that is not a flow map. */
function stripComment(text) {
  if (text.trimStart().startsWith('{')) return text;
  const at = text.indexOf(' #');
  return at < 0 ? text : text.slice(0, at);
}

function parseFlowMap(text, where) {
  const value = text.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) {
    throw new Error(`${where} must be on one line: a flow map {…}, not a block map`);
  }
  const map = {};
  for (const part of splitFlow(value.slice(1, -1), ',')) {
    if (part.trim() === '') continue;
    const colon = splitFlow(part, ':');
    if (colon.length < 2) throw new Error(`${where} must be on one line: "${part.trim()}" is not key: value`);
    map[unquote(colon[0])] = unquote(colon.slice(1).join(':'));
  }
  return map;
}

/** Split a flow-map body on `sep`, honouring nesting and double quotes. */
function splitFlow(text, sep) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '{' || ch === '[')) depth++;
    else if (!quoted && (ch === '}' || ch === ']')) depth--;
    else if (!quoted && depth === 0 && ch === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Key order is free in a flow map, so compare maps by their sorted entries. */
function stableJson(value) {
  if (!isObject(value)) return JSON.stringify(value);
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function unquote(text) {
  const value = text.trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

// ---------------------------------------------------------------------------
// replay: mount a state fixture in a temp cwd and pipe a payload through a hook
// ---------------------------------------------------------------------------

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue; // fixture metadata, not run content
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Where a state fixture mounts, from its own `task_path`, checked against `layout`. */
function mountPointOf(fixtureDir, layout) {
  const state = path.join(fixtureDir, 'orchestrator-state.yml');
  // Indent is the emitter's business, not the contract's: mount by the key.
  const line = fs.readFileSync(state, 'utf8').split('\n').find(l => /^\s+task_path:/.test(l));
  if (!line) throw new Error(`${rel(state)}: no task_path to mount by`);
  const taskPath = unquote(line.slice(line.indexOf('task_path:') + 'task_path:'.length));
  const pattern = CWD_LAYOUTS[layout];
  if (!pattern) throw new Error(`unknown cwd_layout: ${layout}`);
  if (!pattern.test(taskPath)) throw new Error(`task_path ${taskPath} is not a ${layout}`);
  return taskPath;
}

function tempDir(tag) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `maister-${tag}-`)));
}

/**
 * Run one payload through the hook that owns its event.
 *
 * The payload is written against `<cwd>/.maister/…`, so every occurrence of its
 * own `cwd` — in `cwd` itself and in every absolute path inside the tool input —
 * is rewritten to the temporary mount before the hook sees it.
 */
function replay(ctx, payload, opts) {
  const cwd = tempDir('replay');
  // `beaconUnderCwd` names a directory inside the mount, which only exists once
  // the mount does — the shape a misconfigured daemon produces.
  const beacons = opts.beaconUnderCwd
    ? path.join(cwd, opts.beaconUnderCwd)
    : opts.beaconDir ?? tempDir('beacons');
  try {
    if (opts.stateFixture) {
      const fixtureDir = path.join(ctx.fixtures, opts.stateFixture);
      const mount = mountPointOf(fixtureDir, opts.cwdLayout);
      if (opts.symlinkRun) {
        // The run lives somewhere else and the A4 path is a link to it — the
        // layout an umbrella built out of worktrees produces.
        const real = path.join(cwd, 'elsewhere', path.basename(mount));
        copyTree(fixtureDir, real);
        fs.mkdirSync(path.join(cwd, path.dirname(mount)), { recursive: true });
        fs.symlinkSync(real, path.join(cwd, mount), 'dir');
      } else {
        copyTree(fixtureDir, path.join(cwd, mount));
      }
    }
    const sent = rewriteCwd(payload, cwd);
    const script = path.join(ctx.pluginRoot, opts.script ?? HOOK_SCRIPTS[opts.event]);
    const started = performance.now();
    const proc = runBounded(process.execPath, [script], {
      input: JSON.stringify(sent),
      encoding: 'utf8',
      cwd,
      env: { ...process.env, MAISTER_BEACON_DIR: beacons, ...(opts.env ?? {}) },
    });
    return {
      status: proc.status,
      stdout: proc.stdout ?? '',
      stderr: proc.stderr ?? '',
      ms: performance.now() - started,
      leftovers: opts.stateFixture ? [] : fs.readdirSync(cwd),
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    if (!opts.beaconDir && !opts.beaconUnderCwd) fs.rmSync(beacons, { recursive: true, force: true });
  }
}

function rewriteCwd(payload, cwd) {
  const from = payload.cwd;
  const text = JSON.stringify(payload);
  const sent = JSON.parse(from ? text.split(from).join(cwd) : text);
  if (from) sent.cwd = cwd;
  return sent;
}

const firstLine = text => text.trim().split('\n')[0].slice(0, 120);

function parseJsonOut(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.message.split('\n')[0] };
  }
}

function reasonOf(provider, decision, response) {
  if (decision === 'block') return response?.reason ?? '';
  return provider === 'claude'
    ? response?.hookSpecificOutput?.permissionDecisionReason ?? ''
    : response?.permissionDecisionReason ?? '';
}

/**
 * Assert one replay against its `expect.replay` block plus the invariants
 * § T5 states for every decision: the response shape, the per-provider
 * fail-closed exit, and where the reason has to be readable.
 */
function checkReplay(ajv, label, want, out, failures) {
  let checks = 0;

  checks++;
  if (out.status !== want.exit) {
    failures.push(`${label}: exit ${out.status}, expected ${want.exit} (stderr: ${firstLine(out.stderr) || 'empty'})`);
  }
  checks++;
  if (want.provider === 'copilot' && out.status === 2) {
    failures.push(`${label}: exit 2 on Copilot discards stdout and stderr — this provider fails closed at exit 0`);
  }

  checks++;
  if (want.stdout === 'empty') {
    if (out.stdout.trim() !== '') failures.push(`${label}: expected empty stdout, got ${firstLine(out.stdout)}`);
    return checks;
  }

  const parsed = parseJsonOut(out.stdout);
  checks++;
  if (!parsed.ok) {
    failures.push(`${label}: stdout is not JSON — ${parsed.error}`);
    return checks;
  }
  const ref = RESPONSE_DEFS[`${want.provider}/${want.decision}`];
  const validate = ajv.getSchema(schemaKey(ref));
  checks++;
  if (!validate(parsed.value)) {
    failures.push(`${label}: response does not validate against ${ref} — ${ajv.errorsText(validate.errors)}`);
  }

  const reason = reasonOf(want.provider, want.decision, parsed.value);
  checks++;
  if (want.decision === 'block') {
    if (!reason.includes('is running but') || !reason.includes(NUDGE_TAIL)) {
      failures.push(`${label}: block reason does not carry the frozen nudge text — ${firstLine(reason)}`);
    }
  } else if (out.status === want.exit && want.exit !== 0) {
    if (!reason.startsWith(FAIL_CLOSED_PREFIX) || !reason.includes(FAIL_CLOSED_TAIL)) {
      failures.push(`${label}: fail-closed reason is not the frozen text — ${firstLine(reason)}`);
    }
  } else if (!reason.startsWith(FAIL_CLOSED_PREFIX)) {
    if (!reason.startsWith(DENY_PREFIX) || !reason.includes(DENY_BLOCKED)) {
      failures.push(`${label}: policy deny reason is not the frozen text — ${firstLine(reason)}`);
    }
  }

  // Claude shows stderr to the model only at exit 2, so that is where a
  // fail-closed reason has to be; Copilot discards it either way.
  if (want.provider === 'claude' && out.status === 2) {
    checks++;
    const lines = out.stderr.trim().split('\n').filter(Boolean);
    if (lines.length !== 1 || !lines[0].startsWith(FAIL_CLOSED_PREFIX)) {
      failures.push(`${label}: exit 2 must put the whole fail-closed reason on one stderr line, got ${lines.length} line(s)`);
    }
  }
  if (want.provider === 'copilot' && want.event === 'preToolUse') {
    checks++;
    if (out.stderr.trim() !== '') failures.push(`${label}: Copilot stderr must stay empty, got ${firstLine(out.stderr)}`);
  }
  return checks;
}

/** Every fixture that declares a replay for `provider`, minus the guard's own. */
function replayFixtures(ctx, provider) {
  return corpus(ctx).filter(fx => {
    const replayExpectation = fx.manifest.expect?.replay;
    return isObject(replayExpectation) && replayExpectation.provider === provider && fx.id !== QUOTED_GUARD_FIXTURE;
  });
}

function payloadOf(fx) {
  return readJson(path.join(fx.dir, 'payload.json'));
}

function runFixture(ctx, fx) {
  const want = fx.manifest.expect.replay;
  return replay(ctx, payloadOf(fx), {
    event: want.event,
    stateFixture: want.state_fixture,
    cwdLayout: want.cwd_layout,
  });
}

/** A fixture the hook tests build a variant payload from. */
function fixtureById(ctx, id) {
  const fx = corpus(ctx).find(f => f.id === id.split('/').join(path.sep));
  if (!fx) throw new Error(`fixture ${id} is absent`);
  return fx;
}

// ===========================================================================
// the tests, in id order (T01-T28)
// ===========================================================================

// ---------------------------------------------------------------------------
// T01 — schema self-check + schema-string lint
// ---------------------------------------------------------------------------

// The schema files are copied verbatim into the Copilot variant, where
// `make validate` greps every file under `skills/`. Annotation strings must
// therefore stay clear of the three tokens those greps look for.
const STRING_LINT = [
  { name: 'root-instructions filename', re: /CLAUDE\.md/ },
  { name: 'multi-select wording', re: /multi-select|multiselect|multiSelect/ },
  { name: 'plugin-qualified prefix', re: /maister:/ },
];
const ANNOTATION_KEYS = new Set(['description', '$comment', 'examples']);
/** Keywords whose direct children are named by the document, not by the dialect. */
const SCHEMA_KEY_HOLDERS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependentRequired']);

function t01(ctx) {
  const failures = [];
  let checks = 0;

  if (!isDir(ctx.schemas)) {
    return { checks: 1, failures: [`schema directory not found: ${rel(ctx.schemas)}`] };
  }
  const { ajv, docs, byId } = loadSchemas(ctx.schemas);
  checks++;
  if (docs.length === 0) {
    return { checks, failures: [`no *.schema.json files under ${rel(ctx.schemas)}`] };
  }

  // 1. dialect + $id shape + uniqueness
  const seen = new Map();
  for (const doc of docs) {
    checks++;
    if (doc.json.$schema !== DIALECT_2020) {
      failures.push(`${doc.name}: $schema is not the 2020-12 dialect`);
    }
    checks++;
    const expected = SCHEMA_ID_BASE + doc.id;
    if (doc.json.$id !== expected) {
      failures.push(`${doc.name}: $id is ${doc.json.$id ?? '(absent)'}, expected ${expected}`);
    }
    checks++;
    if (seen.has(doc.json.$id)) {
      failures.push(`${doc.name}: $id collides with ${seen.get(doc.json.$id)}`);
    } else {
      seen.set(doc.json.$id, doc.name);
    }
  }

  // 2. every schema compiles under Ajv 2020-12
  for (const doc of docs) {
    checks++;
    try {
      ajv.getSchema(doc.json.$id) ?? ajv.compile(doc.json);
    } catch (err) {
      failures.push(`${doc.name}: does not compile — ${err.message.split('\n')[0]}`);
    }
  }

  // 3. every $ref resolves, and common is referenced by at least one schema
  let commonRefs = 0;
  for (const doc of docs) {
    for (const [pointer, node] of walk(doc.json)) {
      if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') continue;
      const ref = node.$ref;
      checks++;
      const [base, fragment = ''] = ref.split('#');
      let target;
      if (base === '') {
        target = resolvePointer(doc.json, fragment);
      } else {
        const other = byId.get(base);
        if (!other) {
          failures.push(`${doc.name}${pointer}: $ref target ${base} is not a known schema $id`);
          continue;
        }
        target = resolvePointer(other.json, fragment);
        if (other.id === 'common') commonRefs++;
      }
      if (target === undefined) {
        failures.push(`${doc.name}${pointer}: $ref ${ref} does not resolve`);
      }
    }
  }
  checks++;
  if (commonRefs === 0) {
    failures.push('common.schema.json is referenced by no other schema');
  }

  // 4. no schema leans on `format`. Ajv is built with `validateFormats: false`
  //    (see loadSchemas) because every constrained scalar in the register is
  //    pinned with an explicit `pattern`. A `format` keyword appearing here
  //    would be silently ignored by that instance — a constraint that reads as
  //    enforced and is not — so its absence is asserted rather than assumed.
  for (const doc of docs) {
    checks++;
    const leaning = [];
    for (const [pointer, node] of walk(doc.json)) {
      if (typeof node !== 'string' || !pointer.endsWith('/format')) continue;
      const parts = pointer.split('/');
      // `format` as the name of a data property is a key, not a keyword.
      const parent = unescapeToken(parts[parts.length - 2] ?? '');
      if (SCHEMA_KEY_HOLDERS.has(parent)) continue;
      // Annotation values are prose, not constraints.
      if (parts.some(part => ANNOTATION_KEYS.has(unescapeToken(part)))) continue;
      leaning.push(pointer);
    }
    if (leaning.length) {
      failures.push(`${doc.name}: uses the format keyword at ${leaning.join(', ')} — Ajv runs with validateFormats: false, so pin the value with a pattern instead`);
    }
  }

  // 5. schema-string lint (Copilot-build survival)
  for (const doc of docs) {
    for (const [pointer, node] of walk(doc.json)) {
      const key = unescapeToken(pointer.split('/').pop() ?? '');
      const inAnnotation = ANNOTATION_KEYS.has(key)
        || ANNOTATION_KEYS.has(unescapeToken(pointer.split('/').slice(-2, -1)[0] ?? ''));
      if (!inAnnotation || typeof node !== 'string') continue;
      for (const rule of STRING_LINT) {
        checks++;
        if (rule.re.test(node)) {
          failures.push(`${doc.name}${pointer}: annotation string contains a ${rule.name}`);
        }
      }
    }
  }

  // 6. the generated variant carries the same schemas, byte for byte. `make
  //    validate` used to parse them with an inline `node -e`; this is that
  //    check, with parity instead of mere parseability. Skipped where the
  //    variant is absent (the release tarball ships no plugin tree).
  if (ctx.schemas === DEFAULT_SCHEMAS && isDir(VARIANT_SCHEMAS)) {
    const emitted = new Set(fs.readdirSync(VARIANT_SCHEMAS).filter(f => f.endsWith('.schema.json')));
    checks++;
    if (emitted.size === 0) failures.push(`${rel(VARIANT_SCHEMAS)}: the generated variant carries no schemas`);
    for (const doc of docs) {
      checks++;
      const copy = path.join(VARIANT_SCHEMAS, doc.name);
      if (!isFile(copy)) {
        failures.push(`${rel(copy)}: not emitted by the build`);
        continue;
      }
      emitted.delete(doc.name);
      checks++;
      if (fs.readFileSync(copy, 'utf8') !== fs.readFileSync(doc.file, 'utf8')) {
        failures.push(`${rel(copy)}: differs from the source schema — the build rewrote it`);
      }
    }
    for (const extra of emitted) {
      checks++;
      failures.push(`${rel(path.join(VARIANT_SCHEMAS, extra))}: emitted but has no source schema`);
    }
  }

  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T02 — manifest integrity
// ---------------------------------------------------------------------------

function t02(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);
  const validate = ajv.getSchema(`${SCHEMA_ID_BASE}fixture-manifest`);
  if (!validate) return { checks: 1, failures: ['fixture-manifest schema is not loaded'] };

  const listed = new Set();
  for (const fx of corpus(ctx)) {
    checks++;
    if (!validate(fx.manifest)) {
      const err = validate.errors[0];
      failures.push(`${fx.id}: manifest ${err.instancePath || '/'} ${err.keyword} — ${err.message}`);
    }
    for (const entry of fx.manifest.files ?? []) {
      checks++;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) failures.push(`${fx.id}: listed file is missing — ${entry.path}`);
      listed.add(file);
    }
  }

  // the corpus README documents the tree; it is documentation, not a fixture
  const corpusReadme = path.join(ctx.fixtures, 'README.md');
  const present = [];
  (function rec(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) rec(p);
      else if (entry.name !== 'manifest.json' && p !== corpusReadme) present.push(p);
    }
  })(ctx.fixtures);

  for (const file of present) {
    checks++;
    if (!listed.has(file)) failures.push(`no manifest lists ${path.relative(ctx.fixtures, file)}`);
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T03 — valid fixtures pass
// ---------------------------------------------------------------------------

// The multi-choice flag key is spelled `multi_select`, in the gate schema and
// the fixtures and nowhere else (see T12). Only key positions are drift: the
// same words appear in sampled prose ("multi-select capped at 100").
const MULTI_CHOICE_DRIFT = /(^|[{,\s])"?(multi-select|multiselect|multiSelect)"?\s*:/m;

function t03(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  for (const fx of byVerdict(ctx, 'valid')) {
    for (const entry of fx.manifest.files) {
      if (!entry.schema) continue;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      checks++;
      let errors;
      try {
        errors = validateFile(ajv, file, entry.schema);
      } catch (err) {
        failures.push(`${fx.id}/${entry.path}: did not load — ${err.message.split('\n')[0]}`);
        continue;
      }
      if (errors.length) {
        const err = errors[0];
        failures.push(`${fx.id}/${entry.path}: ${err.instancePath || '/'} ${err.keyword} — ${err.message}`);
      }
    }
    checks++;
    const lints = runnerLints(fx);
    if (lints.length) {
      failures.push(`${fx.id}: runner lint ${lints[0].keyword} at ${lints[0].instancePath} — ${lints[0].message}`);
    }
  }

  for (const fx of corpus(ctx)) {
    for (const entry of fx.manifest.files) {
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file) || path.extname(entry.path) === '.md') continue;
      checks++;
      if (MULTI_CHOICE_DRIFT.test(fs.readFileSync(file, 'utf8'))) {
        failures.push(`${fx.id}/${entry.path}: the multi-choice flag is not spelled multi_select`);
      }
    }
  }
  const flagged = corpus(ctx)
    .flatMap(fx => fx.manifest.files
      .filter(e => (e.schema ?? '').startsWith('gate.schema.json') && (e.schema ?? '').includes('request'))
      .map(e => path.join(fx.dir, e.path)))
    .filter(isFile)
    .map(f => parseYaml(fs.readFileSync(f, 'utf8'), YAML_OPTS))
    .filter(d => isObject(d) && 'multi_select' in d);
  checks++;
  if (flagged.length === 0) failures.push('no gate request fixture carries the multi_select flag');

  // C1: the array-valued phase-summary entry the development workflow writes.
  for (const id of [path.join('valid', 'runs', 'dev-complete-a'), path.join('valid', 'runs', 'dev-inprogress-b')]) {
    checks++;
    const fx = corpus(ctx).find(f => f.id === id);
    if (!fx) { failures.push(`${id}: fixture is absent`); continue; }
    const state = readState(fs.readFileSync(path.join(fx.dir, 'orchestrator-state.yml'), 'utf8')).data;
    const summaries = isObject(state?.task_context) ? state.task_context.phase_summaries : null;
    if (!isObject(summaries) || !Array.isArray(summaries.clarifications)) {
      failures.push(`${id}: task_context.phase_summaries.clarifications is not the array form`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T04 — invalid fixtures fail where the manifest says they do
// ---------------------------------------------------------------------------

const RUNNER_KEYWORDS = new Set([
  'phase-status-cross-check', 'not_midnight', 'e2-one-line-form', 'b2-one-line-form',
  'a5-tldr-line-count', 'a5-block-position', 'dag-cycle', 'gate-option-id-unique',
  'gate-exactly-one-continue', 'reference-unknown-node',
]);

function t04(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  for (const fx of byVerdict(ctx, 'invalid')) {
    const expect = fx.manifest.expect ?? {};
    const keyword = expect.error_keyword ?? null;
    const at = expect.error_path ?? '';
    const runnerOwned = keyword !== null && RUNNER_KEYWORDS.has(keyword);

    let errors = [];
    if (runnerOwned) {
      errors = runnerLints(fx, { a5: true, crossCheck: true });
    } else {
      for (const entry of fx.manifest.files) {
        if (!entry.schema) continue;
        const file = path.join(fx.dir, entry.path);
        if (!isFile(file)) continue;
        errors.push(...validateFile(ajv, file, entry.schema));
      }
    }

    checks++;
    if (errors.length === 0) {
      failures.push(`${fx.id}: expected ${runnerOwned ? 'a runner lint' : 'a schema'} failure, got none`);
      continue;
    }
    checks++;
    if (!errors[0].instancePath.startsWith(at)) {
      failures.push(`${fx.id}: first error is at ${errors[0].instancePath || '/'}, expected a path under ${at || '/'}`);
    }
    if (keyword) {
      checks++;
      const hit = errors.some(e => e.keyword === keyword && e.instancePath.startsWith(at));
      if (!hit) {
        failures.push(`${fx.id}: no ${keyword} error under ${at || '/'} (first: ${errors[0].keyword} at ${errors[0].instancePath || '/'})`);
      }
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T05 — tolerated fixtures degrade
// ---------------------------------------------------------------------------

// Reader degradations that also break the schema. The nesting drifts (#6, #9)
// do not: those contexts are open objects wherever they are attached, so the
// document still validates and only the reader records the drift.
const SCHEMA_BREAKING = new Set(['no-orchestrator-block', 'window.DASHBOARD_DATA']);

/** Reasons owned by other tests: reserved keys are T25, newer-format is T07. */
const isReaderReason = reason => reason !== 'newer-format' && !reason.startsWith('reserved-key:');

function expectedDegradations(manifest) {
  const expect = manifest.expect ?? {};
  const declared = expect.degraded ?? expect.warnings ?? [];
  return declared.filter(isReaderReason);
}

/** The tolerant reader for one fixture file, chosen the way a consumer would. */
function readTolerantly(fx, entry) {
  const file = path.join(fx.dir, entry.path);
  const text = fs.readFileSync(file, 'utf8');
  const base = (entry.schema ?? '').split('#')[0];
  if (path.extname(entry.path) === '.js') return readDashboardData(text);
  if (path.extname(entry.path) === '.md') return readSummaryBlock(text);
  if (base === 'orchestrator-state.schema.json') return readState(text);
  return null;
}

function t05(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  const targets = corpus(ctx).filter(fx => expectedDegradations(fx.manifest).length > 0);
  checks++;
  if (targets.length === 0) failures.push('no fixture declares reader degradations');

  for (const fx of targets) {
    const expected = expectedDegradations(fx.manifest);
    const reasons = new Set(readRun(fx.dir).degraded.filter(isReaderReason));
    for (const entry of fx.manifest.files) {
      if (!isFile(path.join(fx.dir, entry.path))) continue;
      const reader = readTolerantly(fx, entry);
      if (reader) for (const reason of reader.degraded) if (isReaderReason(reason)) reasons.add(reason);
    }

    checks++;
    const got = [...reasons].sort();
    const want = [...expected].sort();
    if (got.join('|') !== want.join('|')) {
      failures.push(`${fx.id}: degraded [${got.join(', ')}], manifest declares [${want.join(', ')}]`);
    }

    if (fx.manifest.verdict !== 'tolerated') continue;
    const breaking = expected.some(r => SCHEMA_BREAKING.has(r));
    for (const entry of fx.manifest.files) {
      if (!entry.schema) continue;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      checks++;
      const errors = validateFile(ajv, file, entry.schema);
      if (breaking && errors.length === 0) {
        failures.push(`${fx.id}/${entry.path}: the schema accepts a shape the reader had to degrade`);
      }
      if (!breaking && errors.length > 0) {
        failures.push(`${fx.id}/${entry.path}: the schema rejects a tolerated shape — ${errors[0].instancePath || '/'} ${errors[0].keyword}`);
      }
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T06 — A2 read-tolerant, write-strict
// ---------------------------------------------------------------------------

const A2_STATEMENT = /^window\.MAISTER_DATA = [\s\S]*;\s*$/;
const A2_ANY_GLOBAL = /^window\.(MAISTER_DATA|DASHBOARD_DATA) = ([\s\S]*);\s*$/;

function t06(ctx) {
  const failures = [];
  let checks = 0;
  let seen = 0;

  for (const fx of corpus(ctx)) {
    for (const entry of fx.manifest.files) {
      if (path.extname(entry.path) !== '.js') continue;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      seen++;
      const text = fs.readFileSync(file, 'utf8');
      const legacy = (fx.manifest.expect?.degraded ?? []).includes('window.DASHBOARD_DATA');

      checks++;
      const shape = A2_ANY_GLOBAL.exec(text);
      if (!shape) {
        failures.push(`${fx.id}/${entry.path}: not a single data-global assignment statement`);
        continue;
      }
      checks++;
      if (!legacy && !A2_STATEMENT.test(text)) {
        failures.push(`${fx.id}/${entry.path}: the statement does not match the frozen A2 form`);
      }

      checks++;
      const read = readDashboardData(text);
      if (!isObject(read.data)) {
        failures.push(`${fx.id}/${entry.path}: the tolerant reader produced no object`);
        continue;
      }

      let strict = null;
      try {
        strict = JSON.parse(shape[2]);
      } catch {
        strict = null;
      }
      checks++;
      if (fx.manifest.strict_a2 === true) {
        if (strict === null) {
          failures.push(`${fx.id}/${entry.path}: strict_a2 is true but the right-hand side is not strict JSON`);
        } else if (JSON.stringify(strict) !== JSON.stringify(read.data)) {
          failures.push(`${fx.id}/${entry.path}: the vm parse and the strict parse disagree`);
        }
      } else if (fx.manifest.strict_a2 === false && strict !== null) {
        failures.push(`${fx.id}/${entry.path}: strict_a2 is false but the right-hand side is strict JSON`);
      }
    }
  }
  checks++;
  if (seen === 0) failures.push('no dashboard data file in the corpus');
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T07 — a newer format degrades, it never throws
// ---------------------------------------------------------------------------

const NEWER_VERSION_LINE = /^\s*(grammar_)?version:\s*(?!1\s*$)\d+\s*$/m;

/** The reader a consumer would reach for, by contract, for a versioned file. */
function readerForNewerFormat(text) {
  const probe = parseYaml(text, YAML_OPTS);
  return isObject(probe) && 'grammar_version' in probe
    ? readVersionedYaml(text, 'grammar_version')
    : readVersionedYaml(text, 'version');
}

function t07(ctx) {
  const failures = [];
  let checks = 0;
  const contracts = new Set();

  for (const fx of corpus(ctx)) {
    if (!(fx.manifest.expect?.degraded ?? []).includes('newer-format')) continue;
    for (const entry of fx.manifest.files) {
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!NEWER_VERSION_LINE.test(text)) continue;

      checks++;
      let read;
      try {
        read = readerForNewerFormat(text);
      } catch (err) {
        failures.push(`${fx.id}/${entry.path}: the reader threw — ${err.message.split('\n')[0]}`);
        continue;
      }
      if (!read.degraded.includes('newer-format')) {
        failures.push(`${fx.id}/${entry.path}: degraded [${read.degraded.join(', ')}], expected newer-format`);
      }
      checks++;
      if (!isObject(read.data)) {
        failures.push(`${fx.id}/${entry.path}: the reader dropped the document instead of degrading`);
      }
      for (const contract of fx.manifest.contracts) contracts.add(contract);
    }
  }

  for (const contract of ['B1', 'B2', 'E2', 'C7']) {
    checks++;
    if (!contracts.has(contract)) failures.push(`no newer-format fixture covers contract ${contract}`);
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T08 — A5 positional form, over registered A4 paths only
// ---------------------------------------------------------------------------

const AMP_HEADING_FIXTURE = path.join('tolerated', 'summary-blocks');

function t08(ctx) {
  const failures = [];
  let checks = 0;

  // The lint's reach: registered artifact paths, never an ad-hoc task-root file.
  const reach = [
    ['analysis/gap-analysis.md', true],
    ['artifacts/spec.md', true],
    ['outputs/product-brief.md', true],
    ['SUMMARY.md', false],
    ['implementation/work-log.md', false],
    ['analysis/design-context/design-resources.md', false],
    ['dashboard-data.js', false],
  ];
  for (const [rel, want] of reach) {
    checks++;
    if (isA5Registered(rel) !== want) {
      failures.push(`${rel}: the A5 lint ${want ? 'skips' : 'walks'} a path it must ${want ? 'walk' : 'skip'}`);
    }
  }

  let linted = 0;
  for (const fx of byVerdict(ctx, 'valid')) {
    for (const entry of fx.manifest.files) {
      if (!isA5Registered(entry.path)) continue;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      checks++;
      linted++;
      const read = matchA5(fs.readFileSync(file, 'utf8'));
      if (!read.ok) failures.push(`${fx.id}/${entry.path}: ${read.reason}`);
    }
  }
  checks++;
  if (linted === 0) failures.push('no registered artifact path carries a summary block');

  // The `&` heading: read, and reported by the writer lint.
  const amp = corpus(ctx).find(f => f.id === AMP_HEADING_FIXTURE);
  checks++;
  if (!amp) {
    failures.push(`${AMP_HEADING_FIXTURE} fixture is absent`);
  } else {
    const text = fs.readFileSync(path.join(amp.dir, amp.manifest.files[0].path), 'utf8');
    checks++;
    if (!matchA5(text).ok) failures.push(`${amp.id}: the reader rejects the tolerated heading form`);
    checks++;
    const writer = lintA5Writer(text);
    if (!writer.some(e => e.keyword === 'a5-writer-heading')) {
      failures.push(`${amp.id}: the writer lint accepts the tolerated heading form`);
    }
  }

  // A slash-form artifact passes the writer lint it is the reference for.
  const slash = corpus(ctx).find(f => f.id === path.join('valid', 'runs', 'dev-complete-a'));
  if (slash) {
    checks++;
    const file = path.join(slash.dir, 'artifacts', 'spec.md');
    if (isFile(file) && lintA5Writer(fs.readFileSync(file, 'utf8')).length) {
      failures.push(`${slash.id}/artifacts/spec.md: the writer lint rejects the writer form`);
    }
  }

  for (const fx of byVerdict(ctx, 'invalid')) {
    if (!fx.id.includes('summary-blocks')) continue;
    const file = path.join(fx.dir, fx.manifest.files[0].path);
    if (!isFile(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    checks++;
    if (matchA5(text).ok) failures.push(`${fx.id}: the reader accepts a shape A5 rejects`);
    checks++;
    const keyword = fx.manifest.expect?.error_keyword;
    if (keyword && !lintA5(text).some(e => e.keyword === keyword)) {
      failures.push(`${fx.id}: no ${keyword} error`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T09 — A6 timestamps on the field-path list
// ---------------------------------------------------------------------------

// The A4 tree listing records the `created` values it *observed*, one of them a
// pre-floor midnight; they are enumerator input, not this document's own dates.
const A6_EXEMPT_FILES = new Set([path.join('synthetic', 'task-layout', 'tasks-tree.json')]);

function t09(ctx) {
  const failures = [];
  let checks = 0;

  // A task-directory name prefix is a bare date: `task_path` is not on the list.
  checks++;
  const taskPathOnly = { orchestrator: { task_path: '.maister/tasks/development/2026-08-11-widget-progress' } };
  if (lintA6(taskPathOnly).length) failures.push('the field-path list reaches a task-directory name prefix');

  let seen = 0;
  for (const fx of corpus(ctx)) {
    if (fx.manifest.verdict === 'invalid') continue;
    for (const entry of fx.manifest.files) {
      if (A6_EXEMPT_FILES.has(path.join(fx.id, entry.path))) continue;
      const file = path.join(fx.dir, entry.path);
      if (!isFile(file)) continue;
      let docs;
      try {
        docs = loadDocs(file);
      } catch {
        continue;
      }
      for (const doc of docs) {
        if (doc === null || typeof doc !== 'object') continue;
        checks++;
        const errors = lintA6(doc);
        seen++;
        if (errors.length) {
          failures.push(`${fx.id}/${entry.path}: ${errors[0].instancePath} ${errors[0].keyword}`);
        }
      }
    }
  }
  checks++;
  if (seen === 0) failures.push('no document reached the A6 field-path list');

  for (const [id, keyword] of [
    [path.join('invalid', 'timestamps', 'date-only'), 'pattern'],
    [path.join('invalid', 'dashboard-data', 'midnight-generated'), 'not_midnight'],
  ]) {
    checks++;
    const fx = corpus(ctx).find(f => f.id === id);
    if (!fx) { failures.push(`${id}: fixture is absent`); continue; }
    const at = fx.manifest.expect?.error_path ?? '';
    const errors = fx.manifest.files.flatMap(entry => {
      const file = path.join(fx.dir, entry.path);
      return isFile(file) ? loadDocs(file).flatMap(lintA6) : [];
    });
    if (!errors.some(e => e.keyword === keyword && e.instancePath.startsWith(at))) {
      failures.push(`${id}: no ${keyword} error under ${at || '/'}`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T10 — A4 enumeration
// ---------------------------------------------------------------------------

const TASK_LAYOUT_FIXTURE = path.join('synthetic', 'task-layout');

function t10(ctx) {
  const failures = [];
  let checks = 0;

  const fx = corpus(ctx).find(f => f.id === TASK_LAYOUT_FIXTURE);
  checks++;
  if (!fx) return { checks, failures: [`${TASK_LAYOUT_FIXTURE} fixture is absent`] };

  const tree = readJson(path.join(fx.dir, fx.manifest.files[0].path));
  const listed = enumerateTaskTree(tree);
  const expect = fx.manifest.expect ?? {};

  for (const [name, got, want] of [
    ['task_dirs', listed.taskDirs, expect.task_dirs ?? []],
    ['inventory_only', listed.inventoryOnly, expect.inventory_only ?? []],
  ]) {
    checks++;
    const a = [...got].sort().join('|');
    const b = [...want].sort().join('|');
    if (a !== b) failures.push(`${name}: enumerated [${got.join(', ')}], manifest declares [${want.join(', ')}]`);
  }

  // Non-task children and dot-prefixed paths appear in neither list.
  for (const entry of tree.entries ?? []) {
    const nonTask = entry.kind !== 'task-dir' || entry.dot_prefixed === true;
    if (!nonTask) continue;
    checks++;
    if (listed.taskDirs.includes(entry.path) || listed.inventoryOnly.includes(entry.path)) {
      failures.push(`${entry.path}: a non-task child was enumerated`);
    }
  }

  // A legacy type dir is inventory-only however good its state file is.
  for (const entry of tree.entries ?? []) {
    if (entry.legacy_type !== true) continue;
    checks++;
    if (!listed.inventoryOnly.includes(entry.path)) {
      failures.push(`${entry.path}: a legacy type dir was not listed inventory-only`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T11 — the frozen `dashboard.html` MD5
// ---------------------------------------------------------------------------

const DASHBOARD_ASSET = 'skills/orchestrator-framework/assets/dashboard.html';

function t11(ctx) {
  const failures = [];
  let checks = 0;

  checks++;
  const pinned = registerMd5(ctx.pluginRoot);
  if (!pinned) return { checks, failures: [`${REGISTER} does not pin the dashboard.html MD5`] };

  const asset = path.join(ctx.pluginRoot, DASHBOARD_ASSET);
  checks++;
  if (!isFile(asset)) return { checks, failures: [`asset not found: ${rel(asset)}`] };

  const actual = md5(fs.readFileSync(asset));
  checks++;
  if (actual !== pinned) failures.push(`the asset hashes to ${actual}, the register pins ${pinned}`);

  let recorded = 0;
  for (const fx of corpus(ctx)) {
    const declared = fx.manifest.dashboard_html_md5;
    if (declared === undefined) continue;
    checks++;
    recorded++;
    if (declared !== pinned) failures.push(`${fx.id}: manifest records ${declared}, the register pins ${pinned}`);
  }
  checks++;
  if (recorded === 0) failures.push('no run manifest records dashboard_html_md5');
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T12 — A1 cross-checks between state and dashboard
// ---------------------------------------------------------------------------

const ORDER_VIOLATION = path.join('invalid', 'orchestrator-state', 'order-violation');

/** The state / dashboard pair a run fixture contributes, or nulls. */
function runPair(fx) {
  let state = null;
  let dashboard = null;
  for (const entry of fx.manifest.files) {
    const file = path.join(fx.dir, entry.path);
    if (!isFile(file)) continue;
    if ((entry.schema ?? '').startsWith('orchestrator-state.schema.json')) {
      state = readState(fs.readFileSync(file, 'utf8')).data;
    } else if (path.extname(entry.path) === '.js') {
      dashboard = readDashboardData(fs.readFileSync(file, 'utf8')).data;
    }
  }
  return { state, dashboard };
}

function t12(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  let pairs = 0;
  let arrayEntries = 0;

  for (const fx of corpus(ctx)) {
    if (fx.manifest.verdict === 'invalid') continue;
    const { state, dashboard } = runPair(fx);
    if (!state || !dashboard) continue;
    pairs++;
    checks++;
    const { errors, warnings } = crossCheckPhases(state, dashboard);
    if (errors.length) {
      failures.push(`${fx.id}: ${errors[0].instancePath} ${errors[0].keyword} — ${errors[0].message}`);
    }
    if (warnings.length) notes.push(`${fx.id}: dashboard lags the state (${warnings.length}) — expected while in progress`);

    // The array form `development` writes for `clarifications` is skipped by
    // the entry-level checks and counted valid.
    for (const key of Object.keys(state)) {
      const context = state[key];
      if (!isObject(context) || !isObject(context.phase_summaries)) continue;
      for (const [phase, value] of Object.entries(context.phase_summaries)) {
        if (!Array.isArray(value)) continue;
        arrayEntries++;
        checks++;
        if (!value.every(item => typeof item === 'string' || isObject(item))) {
          failures.push(`${fx.id}: ${key}.phase_summaries.${phase} carries a non-decision item`);
        }
      }
    }
  }
  checks++;
  if (pairs === 0) failures.push('no fixture pairs a state with a dashboard');
  checks++;
  if (arrayEntries === 0) failures.push('no fixture carries an array-valued phase-summary entry');

  const fx = corpus(ctx).find(f => f.id === ORDER_VIOLATION);
  checks++;
  if (!fx) {
    failures.push(`${ORDER_VIOLATION}: fixture is absent`);
  } else {
    const { state, dashboard } = runPair(fx);
    const errors = crossCheckPhases(state, dashboard).errors;
    const at = fx.manifest.expect?.error_path ?? '';
    checks++;
    if (!errors.some(e => e.keyword === 'phase-status-cross-check' && e.instancePath.startsWith(at))) {
      failures.push(`${ORDER_VIOLATION}: no cross-check failure under ${at || '/'}`);
    }
  }
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T13 — the E2 one-line form
// ---------------------------------------------------------------------------

const PENDING_STATE = 'synthetic/gate/pending';
const RUNNING_STATE = 'synthetic/gate/running-no-request';
const CORRUPT_STATE = 'invalid/hook-payloads/corrupt-state-file';

/** Accepted shapes: the frozen form, in every spelling the register allows. */
const ONE_LINE_ACCEPTED = [
  { name: 'null pending', text: 'orchestrator:\n  gate_pending: null\n', pending: null },
  { name: 'tilde null', text: 'orchestrator:\n  gate_pending: ~\n', pending: null },
  {
    name: 'canonical flow map',
    text: 'orchestrator:\n  gate_pending: {node: approve, request: gates/approve.request.yml, since: "2026-08-24T10:41:05Z"}\n',
    pending: { node: 'approve', request: 'gates/approve.request.yml', since: '2026-08-24T10:41:05Z' },
  },
  {
    name: 'keys in another order, bare scalars',
    text: 'orchestrator:\n  gate_pending: {since: 2026-08-24T10:41:05Z, node: approve, request: gates/approve.request.yml}\n',
    pending: { node: 'approve', request: 'gates/approve.request.yml', since: '2026-08-24T10:41:05Z' },
  },
  {
    name: 'quoted keys',
    text: 'orchestrator:\n  gate_pending: {"node": "approve", "request": "gates/approve.request.yml", "since": "2026-08-24T10:41:05Z"}\n',
    pending: { node: 'approve', request: 'gates/approve.request.yml', since: '2026-08-24T10:41:05Z' },
  },
];

/** Rejected shapes: everything the line scanner cannot decide from one line. */
const ONE_LINE_REJECTED = [
  {
    name: 'block map under gate_pending',
    text: 'orchestrator:\n  gate_pending:\n    node: approve\n    request: gates/approve.request.yml\n',
  },
  { name: 'gate_pending with nothing after the colon', text: 'orchestrator:\n  gate_pending:\n' },
  {
    name: 'block map under a workflow node',
    text: 'workflow:\n  nodes:\n    approve:\n      kind: gate\n      status: running\n',
  },
];

async function t13(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  for (const testCase of ONE_LINE_ACCEPTED) {
    checks++;
    try {
      const scanned = scanStateText(testCase.text);
      if (stableJson(scanned.gatePending) !== stableJson(testCase.pending)) {
        failures.push(`${testCase.name}: read ${JSON.stringify(scanned.gatePending)}`);
      }
    } catch (err) {
      failures.push(`${testCase.name}: rejected — ${err.message}`);
    }
  }

  for (const testCase of ONE_LINE_REJECTED) {
    checks++;
    let message = null;
    try {
      scanStateText(testCase.text);
    } catch (err) {
      message = err.message;
    }
    if (message === null) failures.push(`${testCase.name}: accepted, expected a rejection`);
    else if (!message.includes('one line')) failures.push(`${testCase.name}: reason does not say "one line" — ${message}`);
  }

  // B2 node entries parse out of a real state file, kind and status included.
  const pendingState = path.join(ctx.fixtures, PENDING_STATE, 'orchestrator-state.yml');
  checks++;
  const scanned = scanStateText(fs.readFileSync(pendingState, 'utf8'));
  if (scanned.nodes.approve?.kind !== 'gate' || scanned.nodes.approve?.status !== 'running') {
    failures.push(`${PENDING_STATE}: node entry read as ${JSON.stringify(scanned.nodes.approve)}`);
  }
  checks++;
  if (!scanned.hasWorkflow || !scanned.hasNodes || !scanned.hasTask) {
    failures.push(`${PENDING_STATE}: workflow/nodes/task presence read as ${JSON.stringify(scanned)}`);
  }
  checks++;
  if (Object.keys(scanned.nodes).length !== 4) {
    failures.push(`${PENDING_STATE}: read ${Object.keys(scanned.nodes).length} node entries, expected 4`);
  }
  checks++;
  if (scanned.gatePending?.node !== 'approve') failures.push(`${PENDING_STATE}: gate_pending node is not approve`);

  checks++;
  let corruptMessage = null;
  try {
    scanStateText(fs.readFileSync(path.join(ctx.fixtures, CORRUPT_STATE, 'orchestrator-state.yml'), 'utf8'));
  } catch (err) {
    corruptMessage = err.message;
  }
  if (!corruptMessage?.includes('one line')) failures.push(`${CORRUPT_STATE}: not rejected with a "one line" reason`);

  // The hook runs on its own copy of this reader; pin the two together.
  const lib = path.join(ctx.pluginRoot, GATE_LIB);
  if (!isFile(lib)) {
    notes.push(`cross-check: skip (${GATE_LIB} is not present)`);
    return { checks, failures, notes };
  }
  const { scanState } = await import(pathToFileURL(lib).href);
  for (const testCase of ONE_LINE_ACCEPTED) {
    checks++;
    const mine = stableJson(scanStateText(testCase.text).gatePending);
    let theirs;
    try {
      theirs = stableJson(scanState(testCase.text).gatePending);
    } catch (err) {
      theirs = `threw ${err.message}`;
    }
    if (mine !== theirs) failures.push(`${testCase.name}: gate-lib read ${theirs}, the register reads ${mine}`);
  }
  for (const testCase of ONE_LINE_REJECTED) {
    checks++;
    let message = null;
    try {
      scanState(testCase.text);
    } catch (err) {
      message = err.message;
    }
    if (message === null) failures.push(`${testCase.name}: gate-lib accepted it`);
    else if (!message.includes('one line')) failures.push(`${testCase.name}: gate-lib reason does not say "one line" — ${message}`);
  }
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T14 — H1 replay, Claude vocabulary
// ---------------------------------------------------------------------------

const SESSION_START_CLAUDE = 'synthetic/hook-payloads/claude/session-start';

function t14(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  const fixtures = replayFixtures(ctx, 'claude');
  checks++;
  if (fixtures.length === 0) return { checks, failures: ['no Claude replay fixture in the corpus'] };

  for (const fx of fixtures) {
    const want = fx.manifest.expect.replay;
    const script = HOOK_SCRIPTS[want.event];
    checks++;
    if (!script) {
      failures.push(`${fx.id}: no hook owns event ${want.event}`);
      continue;
    }
    if (!isFile(path.join(ctx.pluginRoot, script))) {
      failures.push(`${fx.id}: ${script} does not exist`);
      continue;
    }
    checks += checkReplay(ajv, fx.id, want, runFixture(ctx, fx), failures);
  }
  notes.push(`${fixtures.length} Claude payloads replayed`);

  // The beacon writes outside the consumer tree, and only where it is told to.
  const beacons = tempDir('beacon-check');
  try {
    const fx = fixtureById(ctx, SESSION_START_CLAUDE);
    const out = replay(ctx, payloadOf(fx), { event: 'SessionStart', beaconDir: beacons });
    checks++;
    if (out.status !== 0 || out.stdout.trim() !== '') {
      failures.push(`${fx.id}: beacon must exit 0 with empty stdout, got exit ${out.status} ${firstLine(out.stdout)}`);
    }
    checks++;
    if (out.leftovers.length !== 0) failures.push(`${fx.id}: wrote ${out.leftovers.join(', ')} under cwd`);
    const written = fs.readdirSync(beacons);
    checks++;
    if (written.length !== 1) {
      failures.push(`${fx.id}: expected one beacon file, got [${written.join(', ')}]`);
    } else {
      const marker = readJson(path.join(beacons, written[0]));
      checks++;
      if (written[0] !== `${marker.session_id}.json`) failures.push(`${fx.id}: beacon is named ${written[0]}`);
      checks++;
      for (const key of ['provider', 'session_id', 'source', 'at', 'node', 'hook_version', 'cwd']) {
        if (marker[key] === undefined) failures.push(`${fx.id}: beacon has no ${key}`);
      }
      checks++;
      if (marker.provider !== 'claude' || marker.hook_version !== 'contracts-v1') {
        failures.push(`${fx.id}: beacon reads provider ${marker.provider}, hook_version ${marker.hook_version}`);
      }
    }
  } finally {
    fs.rmSync(beacons, { recursive: true, force: true });
  }

  // The session id is provider-owned text that the hook turns into a file name,
  // so it is sanitised before it becomes one: a marker never lands outside the
  // directory the daemon told the hook to write into.
  const escapeRoot = tempDir('beacon-escape');
  try {
    const fx = fixtureById(ctx, SESSION_START_CLAUDE);
    const inner = path.join(escapeRoot, 'inner');
    const out = replay(ctx, { ...payloadOf(fx), session_id: '../escaped' }, { event: 'SessionStart', beaconDir: inner });
    checks++;
    if (out.status !== 0) failures.push(`beacon traversal: exit ${out.status}, a session start is never blocked`);
    checks++;
    const outside = fs.readdirSync(escapeRoot).filter(name => name !== 'inner');
    if (outside.length !== 0) failures.push(`beacon traversal: wrote ${outside.join(', ')} outside the beacon dir`);
    const written = fs.existsSync(inner) ? fs.readdirSync(inner) : [];
    checks++;
    if (written.length !== 1) {
      failures.push(`beacon traversal: expected one beacon file, got [${written.join(', ')}]`);
    } else {
      checks++;
      if (!/^[A-Za-z0-9._-]+\.json$/.test(written[0]) || written[0].startsWith('..')) {
        failures.push(`beacon traversal: the marker is named ${written[0]}`);
      }
    }
  } finally {
    fs.rmSync(escapeRoot, { recursive: true, force: true });
  }

  // A beacon directory that resolves inside the working directory is refused,
  // whoever passed it: `.maister/` is tracked in real consumer repositories and
  // a per-session file there would show up as an untracked file in every chain
  // session. The hook says so on stderr and falls back to the cockpit's own home.
  const fakeHome = tempDir('beacon-home');
  try {
    const fx = fixtureById(ctx, SESSION_START_CLAUDE);
    const out = replay(ctx, payloadOf(fx), {
      event: 'SessionStart',
      beaconUnderCwd: 'beacons',
      env: { HOME: fakeHome },
    });
    checks++;
    if (out.status !== 0) failures.push(`beacon under cwd: exit ${out.status}, a session start is never blocked`);
    checks++;
    if (!/MAISTER_BEACON_DIR/.test(out.stderr)) {
      failures.push(`beacon under cwd: stderr does not name the refused variable, got ${firstLine(out.stderr) || 'empty'}`);
    }
    checks++;
    if (out.leftovers.length !== 0) failures.push(`beacon under cwd: wrote ${out.leftovers.join(', ')} under cwd after all`);
    const fallback = path.join(fakeHome, '.maister-cockpit', 'beacons');
    checks++;
    const written = isDir(fallback) ? fs.readdirSync(fallback) : [];
    if (written.length !== 1) {
      failures.push(`beacon under cwd: expected one marker in the default dir, got [${written.join(', ')}]`);
    }
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T15 — H1 replay, Copilot vocabulary
// ---------------------------------------------------------------------------

const SESSION_START_COPILOT = 'valid/hook-payloads/copilot/session-start';

/**
 * The same three scripts, driven by the other provider's payload keys.
 *
 * Copilot never sends `hook_event_name`, so the hook has to recognise the
 * vocabulary from the payload alone, and it has to answer in Copilot's own
 * response shape — a bare `{permissionDecision, permissionDecisionReason}`,
 * always at exit 0 (`checkReplay` fails an exit 2 here outright: this provider
 * discards stdout and stderr at that exit, taking the reason with them).
 */
function t15(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  const fixtures = replayFixtures(ctx, 'copilot');
  checks++;
  if (fixtures.length === 0) return { checks, failures: ['no Copilot replay fixture in the corpus'] };

  for (const fx of fixtures) {
    const want = fx.manifest.expect.replay;
    const script = HOOK_SCRIPTS[want.event];
    checks++;
    if (!script) {
      failures.push(`${fx.id}: no hook owns event ${want.event}`);
      continue;
    }
    if (!isFile(path.join(ctx.pluginRoot, script))) {
      failures.push(`${fx.id}: ${script} does not exist`);
      continue;
    }
    checks += checkReplay(ajv, fx.id, want, runFixture(ctx, fx), failures);
  }
  notes.push(`${fixtures.length} Copilot payloads replayed`);

  // The beacon reads the Copilot session key (`sessionId`) and stamps the
  // provider it detected — that field is what the daemon keys a live session on.
  const beacons = tempDir('beacon-check');
  try {
    const fx = fixtureById(ctx, SESSION_START_COPILOT);
    const out = replay(ctx, payloadOf(fx), { event: 'sessionStart', beaconDir: beacons });
    checks++;
    if (out.status !== 0 || out.stdout.trim() !== '') {
      failures.push(`${fx.id}: beacon must exit 0 with empty stdout, got exit ${out.status} ${firstLine(out.stdout)}`);
    }
    checks++;
    if (out.leftovers.length !== 0) failures.push(`${fx.id}: wrote ${out.leftovers.join(', ')} under cwd`);
    const written = fs.readdirSync(beacons);
    checks++;
    if (written.length !== 1) {
      failures.push(`${fx.id}: expected one beacon file, got [${written.join(', ')}]`);
    } else {
      const marker = readJson(path.join(beacons, written[0]));
      checks++;
      if (written[0] !== `${marker.session_id}.json`) failures.push(`${fx.id}: beacon is named ${written[0]}`);
      checks++;
      for (const key of ['provider', 'session_id', 'source', 'at', 'node', 'hook_version', 'cwd']) {
        if (marker[key] === undefined) failures.push(`${fx.id}: beacon has no ${key}`);
      }
      checks++;
      if (marker.provider !== 'copilot' || marker.hook_version !== 'contracts-v1') {
        failures.push(`${fx.id}: beacon reads provider ${marker.provider}, hook_version ${marker.hook_version}`);
      }
      checks++;
      if (marker.session_id !== payloadOf(fx).sessionId) {
        failures.push(`${fx.id}: beacon session_id is ${marker.session_id}, the payload sessionId is ${payloadOf(fx).sessionId}`);
      }
    }
  } finally {
    fs.rmSync(beacons, { recursive: true, force: true });
  }
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T16 — a corrupt state file denies, with the provider's fail-closed exit
// ---------------------------------------------------------------------------

const CORRUPT_FIXTURES = [
  'synthetic/hook-payloads/claude/corrupt-state-pending',
  'synthetic/hook-payloads/copilot/corrupt-state',
];

function t16(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  for (const id of CORRUPT_FIXTURES) {
    const fx = fixtureById(ctx, id);
    const want = fx.manifest.expect.replay;
    checks++;
    if (want.state_fixture !== CORRUPT_STATE) {
      failures.push(`${id}: replays against ${want.state_fixture}, expected ${CORRUPT_STATE}`);
      continue;
    }
    checks++;
    if (want.decision !== 'deny' || want.stdout !== 'json') {
      failures.push(`${id}: expectation is ${want.decision}/${want.stdout}, expected deny/json`);
    }
    checks++;
    if (want.exit !== FAIL_CLOSED_EXIT[want.provider]) {
      failures.push(`${id}: declares exit ${want.exit}, the ${want.provider} fail-closed exit is ${FAIL_CLOSED_EXIT[want.provider]}`);
    }
    const out = runFixture(ctx, fx);
    checks += checkReplay(ajv, id, want, out, failures);
    checks++;
    if (want.provider === 'copilot' && out.stderr.trim() !== '') {
      failures.push(`${id}: Copilot stderr must stay empty (it is discarded), got ${firstLine(out.stderr)}`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T17 — the engine owns its own files while a gate is pending
// ---------------------------------------------------------------------------

const OTHER_RUN = '.maister/umbrella/runs/019260a2-dead-7c33-8d44-5e6677889900';
const PENDING_RUN = '.maister/umbrella/runs/019260a2-1122-7c33-8d44-5e6677889900';

const ENGINE_OWNED = [
  { name: 'state', target: 'orchestrator-state.yml', decision: 'allow' },
  { name: 'state temp', target: 'orchestrator-state.yml.tmp', decision: 'allow' },
  { name: 'request', target: 'gates/approve.request.yml', decision: 'allow' },
  { name: 'request temp', target: 'gates/approve.request.yml.tmp', decision: 'allow' },
  { name: 'index', target: 'gates/index.yml', decision: 'allow' },
  { name: 'dashboard data', target: 'dashboard-data.js', decision: 'allow' },
  { name: 'dashboard page', target: 'dashboard.html', decision: 'allow' },
  { name: 'an unrelated temp file', target: 'notes.tmp', decision: 'deny' },
  { name: 'another run request', target: null, decision: 'deny' },
];

function claudeWrite(base, filePath) {
  return { ...base, tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' } };
}

/**
 * The same pending run, written by an emitter that indents four spaces. Shared
 * with T21, which replays the Stop nudge over it — keep it above both.
 */
const WIDE_INDENT_STATE = 'synthetic/hook-payloads/claude/wide-indent-state';

/**
 * A gate is a gate whatever column the state starts in, and whatever the run
 * directory is reached through. Each case says what the decision must be and
 * how the run is mounted; a `null` target is a file the engine does not own.
 */
const HARDENED_MOUNTS = [
  { name: 'symlinked run dir, a foreign file', state: PENDING_STATE, link: true, target: null, decision: 'deny' },
  { name: 'symlinked run dir, own state file', state: PENDING_STATE, link: true, target: 'orchestrator-state.yml', decision: 'allow' },
  { name: 'state at four spaces, a foreign file', state: WIDE_INDENT_STATE, link: false, target: null, decision: 'deny' },
  { name: 'state at four spaces, own state file', state: WIDE_INDENT_STATE, link: false, target: 'orchestrator-state.yml', decision: 'allow' },
  { name: 'state at four spaces, own request file', state: WIDE_INDENT_STATE, link: false, target: 'gates/approve.request.yml', decision: 'allow' },
];

function t17(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);
  const base = payloadOf(fixtureById(ctx, 'synthetic/hook-payloads/claude/engine-owned-write'));
  const cwd = base.cwd;

  for (const testCase of ENGINE_OWNED) {
    const target = testCase.target
      ? `${cwd}/${PENDING_RUN}/${testCase.target}`
      : `${cwd}/${OTHER_RUN}/gates/approve.request.yml`;
    const want = {
      provider: 'claude',
      event: 'PreToolUse',
      decision: testCase.decision,
      exit: 0,
      stdout: testCase.decision === 'allow' ? 'empty' : 'json',
    };
    const out = replay(ctx, claudeWrite(base, target), {
      event: 'PreToolUse',
      stateFixture: PENDING_STATE,
      cwdLayout: 'umbrella-run',
    });
    checks += checkReplay(ajv, `${testCase.name} (${testCase.decision})`, want, out, failures);
  }

  // A run the discovery walk cannot see is a run whose gate does not hold, and
  // a gate_pending line the scanner cannot see is a node the allow-list does
  // not carry: both fail open, so both are replayed here.
  for (const testCase of HARDENED_MOUNTS) {
    const target = testCase.target
      ? `${cwd}/${PENDING_RUN}/${testCase.target}`
      : `${cwd}/notes.md`;
    const want = {
      provider: 'claude',
      event: 'PreToolUse',
      decision: testCase.decision,
      exit: 0,
      stdout: testCase.decision === 'allow' ? 'empty' : 'json',
    };
    const out = replay(ctx, claudeWrite(base, target), {
      event: 'PreToolUse',
      stateFixture: testCase.state,
      cwdLayout: 'umbrella-run',
      symlinkRun: testCase.link,
    });
    checks += checkReplay(ajv, `${testCase.name} (${testCase.decision})`, want, out, failures);
    if (testCase.decision !== 'deny') continue;
    // The heading is the node the operator is being asked about; without it the
    // deny is the "workflow: without nodes:" fallback rather than the gate.
    checks++;
    const parsed = parseJsonOut(out.stdout);
    const reason = parsed.ok ? reasonOf('claude', 'deny', parsed.value) : '';
    if (!reason.startsWith('GATE PENDING (approve)')) {
      failures.push(`${testCase.name}: the deny does not name the pending node — ${firstLine(reason)}`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T18 — default-deny unknown, allow the read-only set
// ---------------------------------------------------------------------------

const TOOL_CASES = [
  { name: 'Frobnicate', tool: 'Frobnicate', input: { path: 'notes.md' }, decision: 'deny' },
  { name: 'Read', tool: 'Read', input: { file_path: '/etc/hosts' }, decision: 'allow' },
  { name: 'Grep', tool: 'Grep', input: { pattern: 'gate_pending' }, decision: 'allow' },
  { name: 'AskUserQuestion', tool: 'AskUserQuestion', input: {}, decision: 'allow' },
  { name: 'mcp tool', tool: 'mcp__x__y', input: {}, decision: 'deny' },
  { name: 'NotebookEdit', tool: 'NotebookEdit', input: { notebook_path: '/tmp/a.ipynb' }, decision: 'deny' },
  { name: 'Bash', tool: 'Bash', input: { command: 'echo hi' }, decision: 'deny' },
];

function t18(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);
  const base = payloadOf(fixtureById(ctx, 'synthetic/hook-payloads/claude/unknown-tool-pending'));

  for (const testCase of TOOL_CASES) {
    const want = {
      provider: 'claude',
      event: 'PreToolUse',
      decision: testCase.decision,
      exit: 0,
      stdout: testCase.decision === 'allow' ? 'empty' : 'json',
    };
    const payload = { ...base, tool_name: testCase.tool, tool_input: testCase.input };
    const out = replay(ctx, payload, {
      event: 'PreToolUse',
      stateFixture: PENDING_STATE,
      cwdLayout: 'umbrella-run',
    });
    checks += checkReplay(ajv, `${testCase.name} while pending`, want, out, failures);
  }

  // A subagent is judged identically and is named in the reason it gets back.
  const agent = { ...base, tool_name: 'Bash', tool_input: { command: 'rm notes.md' }, agent_type: 'task-group-implementer' };
  const out = replay(ctx, agent, { event: 'PreToolUse', stateFixture: PENDING_STATE, cwdLayout: 'umbrella-run' });
  checks++;
  const parsed = parseJsonOut(out.stdout);
  if (!parsed.ok || out.status !== 0) {
    failures.push(`subagent Bash: exit ${out.status}, stdout ${firstLine(out.stdout)}`);
  } else {
    checks++;
    const reason = reasonOf('claude', 'deny', parsed.value);
    if (!reason.includes('[agent: task-group-implementer]')) {
      failures.push(`subagent Bash: the deny reason does not name the agent — ${firstLine(reason)}`);
    }
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T19 — `apply_patch` is judged over every path it touches
// ---------------------------------------------------------------------------

const PATCH_FIXTURE = 'synthetic/hook-payloads/copilot/apply-patch-multi-allow';

/** The three captured expectations, cross-checked before the variants run. */
const PATCH_FIXTURES = [
  { id: 'synthetic/hook-payloads/copilot/apply-patch-multi-allow', decision: 'allow' },
  { id: 'synthetic/hook-payloads/copilot/apply-patch-multi-deny', decision: 'deny' },
  { id: 'synthetic/hook-payloads/copilot/apply-patch-delete', decision: 'deny' },
];

const patchText = lines => ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n');

/**
 * One patch can carry any number of files, so a first-path check is not a
 * check at all: the decision is over the *set* of paths, and a delete is never
 * allowed whatever it names — removing the request file would erase the very
 * signal the gate is waiting on.
 */
function t19(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);
  const base = payloadOf(fixtureById(ctx, PATCH_FIXTURE));
  const cwd = base.cwd;
  const owned = name => `${cwd}/${PENDING_RUN}/${name}`;
  const foreign = name => `${cwd}/${OTHER_RUN}/${name}`;

  for (const entry of PATCH_FIXTURES) {
    const fx = fixtureById(ctx, entry.id);
    const want = fx.manifest.expect.replay;
    checks++;
    if (want.decision !== entry.decision || want.exit !== 0) {
      failures.push(`${entry.id}: declares ${want.decision}/exit ${want.exit}, expected ${entry.decision}/exit 0`);
      continue;
    }
    checks += checkReplay(ajv, entry.id, want, runFixture(ctx, fx), failures);
  }

  const cases = [
    {
      name: 'three engine-owned files in one patch',
      lines: [
        `*** Update File: ${owned('orchestrator-state.yml')}`,
        '@@',
        '-  gate_pending: {node: approve, request: gates/approve.request.yml, since: "2026-08-24T10:41:05Z"}',
        '+  gate_pending: null',
        `*** Update File: ${owned('dashboard-data.js')}`,
        '@@',
        '-x',
        '+y',
        `*** Update File: ${owned('gates/index.yml')}`,
        '@@',
        '-x',
        '+y',
      ],
      decision: 'allow',
    },
    {
      name: 'one path outside the pending run',
      lines: [
        `*** Update File: ${owned('orchestrator-state.yml')}`,
        '@@',
        '-x',
        '+y',
        `*** Add File: ${foreign('gates/approve.request.yml')}`,
        '+answer: null',
      ],
      decision: 'deny',
    },
    {
      name: 'a rename that leaves the run',
      lines: [
        `*** Update File: ${owned('orchestrator-state.yml')}`,
        `*** Move to: ${foreign('orchestrator-state.yml')}`,
        '@@',
        '-x',
        '+y',
      ],
      decision: 'deny',
    },
    {
      name: 'the temp+rename write of the state file',
      lines: [
        `*** Update File: ${owned('orchestrator-state.yml.tmp')}`,
        `*** Move to: ${owned('orchestrator-state.yml')}`,
        '@@',
        '-x',
        '+y',
      ],
      decision: 'allow',
    },
    {
      name: 'a delete of an allow-listed file',
      lines: [`*** Delete File: ${owned('gates/approve.request.yml')}`],
      decision: 'deny',
    },
    {
      name: 'a delete carried alongside allowed updates',
      lines: [
        `*** Update File: ${owned('orchestrator-state.yml')}`,
        '@@',
        '-x',
        '+y',
        `*** Delete File: ${owned('dashboard-data.js')}`,
      ],
      decision: 'deny',
    },
    { name: 'a patch with no file directives', lines: ['@@', '-x', '+y'], decision: 'deny' },
  ];

  for (const testCase of cases) {
    const want = {
      provider: 'copilot',
      event: 'preToolUse',
      decision: testCase.decision,
      exit: 0,
      stdout: testCase.decision === 'allow' ? 'empty' : 'json',
    };
    const payload = { ...base, toolName: 'apply_patch', toolArgs: patchText(testCase.lines) };
    const out = replay(ctx, payload, {
      event: 'preToolUse',
      stateFixture: PENDING_STATE,
      cwdLayout: 'umbrella-run',
    });
    checks += checkReplay(ajv, `${testCase.name} (${testCase.decision})`, want, out, failures);
  }

  // `apply_patch` carries raw patch text, never a JSON string: an argument that
  // parses as JSON yields no path at all, and no path is not a licence to write.
  const notAPatch = { ...base, toolName: 'apply_patch', toolArgs: JSON.stringify({ path: owned('orchestrator-state.yml') }) };
  const out = replay(ctx, notAPatch, {
    event: 'preToolUse',
    stateFixture: PENDING_STATE,
    cwdLayout: 'umbrella-run',
  });
  checks += checkReplay(
    ajv,
    'toolArgs that is not patch text (deny)',
    { provider: 'copilot', event: 'preToolUse', decision: 'deny', exit: 0, stdout: 'json' },
    out,
    failures,
  );
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T20 — the terminal-user invariant, and the latency budget behind it
// ---------------------------------------------------------------------------

const TERMINAL_FIXTURE = 'synthetic/hook-payloads/claude/terminal-invariant';
const LATENCY_RUNS = 9;
const LATENCY_WARN_MS = 100;
const LATENCY_FAIL_MS = 500;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

function t20(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  const fx = fixtureById(ctx, TERMINAL_FIXTURE);
  const want = fx.manifest.expect.replay;
  checks++;
  if (want.decision !== 'allow' || want.stdout !== 'empty' || want.exit !== 0) {
    failures.push(`${TERMINAL_FIXTURE}: expectation is ${want.decision}/${want.stdout}/${want.exit}, expected allow/empty/0`);
  }
  checks++;
  if (want.cwd_layout !== 'task-dir') failures.push(`${TERMINAL_FIXTURE}: mounts as ${want.cwd_layout}, expected task-dir`);

  const timings = [];
  for (let i = 0; i < LATENCY_RUNS; i++) {
    const out = runFixture(ctx, fx);
    timings.push(out.ms);
    if (i === 0) checks += checkReplay(ajv, TERMINAL_FIXTURE, want, out, failures);
  }
  timings.sort((a, b) => a - b);
  const p50 = Math.round(percentile(timings, 50));
  const p95 = Math.round(percentile(timings, 95));
  notes.push(`wall time over ${LATENCY_RUNS} runs: p50 ${p50} ms, p95 ${p95} ms (warn > ${LATENCY_WARN_MS}, fail > ${LATENCY_FAIL_MS})`);
  checks++;
  if (p50 > LATENCY_FAIL_MS) failures.push(`p50 ${p50} ms is over the ${LATENCY_FAIL_MS} ms budget`);
  else if (p50 > LATENCY_WARN_MS) notes.push(`p50 ${p50} ms is above the ${LATENCY_WARN_MS} ms advisory`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T21 — the Stop nudge, on both vocabularies
// ---------------------------------------------------------------------------

const STOP_EVENTS = { claude: 'Stop', copilot: 'agentStop' };
const STOP_CASES = ['stop-running-no-request', 'stop-running-with-request', 'stop-active-flag', 'stop-corrupt-state'];

function t21(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  for (const [provider, event] of Object.entries(STOP_EVENTS)) {
    for (const name of STOP_CASES) {
      const id = `synthetic/hook-payloads/${provider}/${name}`;
      const fx = fixtureById(ctx, id);
      const want = fx.manifest.expect.replay;
      checks++;
      if (want.event !== event) {
        failures.push(`${id}: declares event ${want.event}, expected ${event}`);
        continue;
      }
      checks++;
      const shouldBlock = name === 'stop-running-no-request';
      if ((want.decision === 'block') !== shouldBlock) {
        failures.push(`${id}: declares ${want.decision}, expected ${shouldBlock ? 'block' : 'allow'}`);
      }
      const out = runFixture(ctx, fx);
      checks += checkReplay(ajv, id, want, out, failures);
      // A stop is never failed closed: neither exit nor the block decision may
      // depend on the state being readable.
      checks++;
      if (out.status !== 0) failures.push(`${id}: a stop hook always exits 0, got ${out.status}`);
      if (name === 'stop-running-no-request') {
        checks++;
        const reason = reasonOf(provider, 'block', parseJsonOut(out.stdout).value);
        if (!reason.includes("gate node 'approve' is running")) {
          failures.push(`${id}: the block reason does not name the running node — ${firstLine(reason)}`);
        }
      }
    }
  }

  // The nudge reads the node entries with the same scanner the gate does, so a
  // state at four spaces per level must still catch the un-asked question.
  const wide = fixtureById(ctx, `synthetic/hook-payloads/claude/${STOP_CASES[0]}`);
  const out = replay(ctx, payloadOf(wide), {
    event: 'Stop',
    stateFixture: WIDE_INDENT_STATE,
    cwdLayout: 'umbrella-run',
  });
  checks++;
  if (out.status !== 0) failures.push(`wide-indent stop: exit ${out.status}, a stop hook always exits 0`);
  checks++;
  const parsed = parseJsonOut(out.stdout);
  const reason = parsed.ok ? reasonOf('claude', 'block', parsed.value) : '';
  if (!reason.includes("gate node 'approve' is running")) {
    failures.push(`wide-indent stop: the nudge did not block on the running gate — ${firstLine(out.stdout) || 'empty stdout'}`);
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T22 — the destructive-command guard quotes its deny reason (D2)
// ---------------------------------------------------------------------------

const GUARD = 'hooks/block-destructive-commands.sh';
const QUOTED_GUARD_FIXTURE = path.join('synthetic', 'hook-payloads', 'claude', 'quoted-guard');
const RESET_WITH_QUOTED_ARG = ['git', 'reset', '--hard', '"HEAD~1"'].join(' ');

function runGuard(script, payload, env) {
  const proc = runBounded('bash', [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  });
  return { status: proc.status, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
}

/**
 * A PATH carrying everything the guard uses except `jq` — the shape of a
 * developer machine that never installed it. `jq` is an optional dependency of
 * this guard; bash and the coreutils it shells out to are not.
 */
function pathWithoutJq() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-nojq-'));
  for (const tool of ['bash', 'cat', 'grep', 'sed', 'printf']) {
    const found = runBounded('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    const target = (found.stdout ?? '').trim();
    if (target && !fs.existsSync(path.join(dir, tool))) fs.symlinkSync(target, path.join(dir, tool));
  }
  return dir;
}

function t22(ctx) {
  const failures = [];
  let checks = 0;
  const script = path.join(ctx.pluginRoot, GUARD);
  checks++;
  if (!isFile(script)) return { checks, failures: [`guard script not found: ${rel(script)}`] };

  const fx = corpus(ctx).find(f => f.id === QUOTED_GUARD_FIXTURE);
  checks++;
  if (!fx) return { checks, failures: [`${QUOTED_GUARD_FIXTURE} fixture is absent`] };
  const base = readJson(path.join(fx.dir, 'payload.json'));

  const cases = [
    { name: 'captured quoted command', payload: base, decision: 'deny' },
    {
      name: 'hard reset with a quoted argument',
      payload: { ...base, tool_input: { ...base.tool_input, command: RESET_WITH_QUOTED_ARG } },
      decision: 'deny',
    },
    { name: 'whitelisted agent', payload: { ...base, agent_type: 'test-suite-runner' }, decision: 'allow' },
    { name: 'no agent type', payload: { ...base, agent_type: '' }, decision: 'allow' },
  ];

  for (const testCase of cases) {
    const out = runGuard(script, testCase.payload);
    checks++;
    if (out.status !== 0) failures.push(`${testCase.name}: exit ${out.status}, expected 0`);

    if (testCase.decision === 'allow') {
      checks++;
      if (out.stdout.trim() !== '') {
        failures.push(`${testCase.name}: expected no output, got ${out.stdout.trim().slice(0, 60)}`);
      }
      continue;
    }

    checks++;
    let parsed;
    try {
      parsed = JSON.parse(out.stdout);
    } catch (err) {
      failures.push(`${testCase.name}: stdout is not JSON — ${err.message.split('\n')[0]}`);
      continue;
    }
    checks++;
    if (parsed?.hookSpecificOutput?.permissionDecision !== 'deny') {
      failures.push(`${testCase.name}: permissionDecision is ${parsed?.hookSpecificOutput?.permissionDecision}, expected deny`);
    }
    checks++;
    if (parsed?.hookSpecificOutput?.hookEventName !== 'PreToolUse') {
      failures.push(`${testCase.name}: hookEventName is ${parsed?.hookSpecificOutput?.hookEventName}, expected PreToolUse`);
    }
  }

  // `jq` is what the guard parses subagent payloads with, and missing it must
  // fail the guard closed — for subagents. The main agent is never the guard's
  // business, so a terminal user without `jq` keeps every Bash call.
  const bin = pathWithoutJq();
  try {
    const noJq = { PATH: bin };
    checks++;
    const present = runBounded('bash', ['-c', 'command -v jq'], { encoding: 'utf8', env: { ...process.env, ...noJq } });
    if (present.status === 0) failures.push('the no-jq PATH still resolves jq — the two cases below prove nothing');

    const main = runGuard(script, { ...base, agent_type: '' }, noJq);
    checks++;
    if (main.status !== 0) failures.push(`main agent without jq: exit ${main.status}, expected 0 (every Bash call is the user's own)`);
    checks++;
    if (main.stdout.trim() !== '') failures.push(`main agent without jq: expected no output, got ${main.stdout.trim().slice(0, 80)}`);

    const sub = runGuard(script, base, noJq);
    checks++;
    if (sub.status !== 2) failures.push(`subagent without jq: exit ${sub.status}, expected 2 (fail closed)`);
    checks++;
    const denied = parseJsonOut(sub.stdout);
    if (!denied.ok || denied.value?.hookSpecificOutput?.permissionDecision !== 'deny') {
      failures.push(`subagent without jq: expected a static deny on stdout, got ${firstLine(sub.stdout) || 'empty'}`);
    }
    // The stdout deny is for the model; the operator watching the terminal only
    // ever sees stderr, and "the call vanished" is not a diagnosable message.
    checks++;
    if (!/jq/.test(sub.stderr)) {
      failures.push(`subagent without jq: stderr names no reason, got ${firstLine(sub.stderr) || 'empty'}`);
    }
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T23 — gate-marker lint (D1)
// ---------------------------------------------------------------------------

const ORCHESTRATORS = [
  'development', 'research', 'product-design', 'performance', 'migration', 'workflow-engine',
];
const CHECKLIST = 'skills/orchestrator-framework/references/orchestrator-creation-checklist.md';
// A gate marker nested inside a code span: the corruption this lint guards.
const NESTED_MARKER = '`→ **MANDATORY GATE** — fires ';
const STEP0_SENTENCE =
  '**`→ MANDATORY GATE` markers fire regardless of session-reminders, permission mode, or prior approval patterns.**';
const SERIALIZATION_SENTENCE = 'honor the `→ MANDATORY GATE` / `AskUserQuestion` gate below';
const SUPERSEDED_MARKER = '→ Pause';

function lineOf(text, needle) {
  return text.split('\n').findIndex(l => l.includes(needle)) + 1;
}

function t23(ctx) {
  const failures = [];
  let checks = 0;

  const targets = ORCHESTRATORS.map(name => ({
    name,
    file: path.join(ctx.pluginRoot, 'skills', name, 'SKILL.md'),
  }));
  targets.push({ name: 'orchestrator-creation-checklist', file: path.join(ctx.pluginRoot, CHECKLIST) });

  for (const target of targets) {
    checks++;
    if (!isFile(target.file)) {
      failures.push(`${target.name}: file not found — ${rel(target.file)}`);
      continue;
    }
    const text = fs.readFileSync(target.file, 'utf8');

    checks++;
    if (text.includes(NESTED_MARKER)) {
      failures.push(`${target.name}:${lineOf(text, NESTED_MARKER)}: a gate marker is nested inside a code span`);
    }
    checks++;
    if (target.name === 'orchestrator-creation-checklist') {
      if (text.includes(SUPERSEDED_MARKER)) {
        failures.push(`${target.name}:${lineOf(text, SUPERSEDED_MARKER)}: still names the superseded transition marker`);
      }
    } else if (!text.includes(STEP0_SENTENCE)) {
      failures.push(`${target.name}: the Step 0 gate sentence is missing or corrupted`);
    }
  }

  checks++;
  const development = path.join(ctx.pluginRoot, 'skills/development/SKILL.md');
  if (isFile(development) && !fs.readFileSync(development, 'utf8').includes(SERIALIZATION_SENTENCE)) {
    failures.push('development: the phase 12/13 serialization rule does not name the gate cleanly');
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T24 — the hook registrations, source templates and emitted variant
// ---------------------------------------------------------------------------

const CLAUDE_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const SETTINGS_ROOT_TOKEN = '__PLUGIN_ROOT__';
const COPILOT_HOOK_DIR = '$COPILOT_PROJECT_DIR/.github/hooks';
const COPILOT_HOOK_DIR_PS = '$env:COPILOT_PROJECT_DIR/.github/hooks';
const COPILOT_TIMEOUT_CAP = 30; // the provider's own default timeout (H1)

/** Every alternative the plugin's gate matcher spells, MCP's wildcard included. */
const GATE_MATCHER_ALTERNATIVES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'mcp__.*'];
/** Tool names the matcher, read as a regular expression, has to match. */
const GATE_MATCHER_TOOLS = ['Write', 'Edit', 'Bash', 'mcp__playwright__browser_navigate'];

/**
 * A registration is only as good as the file it names. Each config is read for
 * the paths it points at, and every one of them is resolved back to a file in
 * this tree — the Copilot template through the directory the build emits into.
 */
const HOOK_CONFIGS = [
  { file: 'plugins/maister/hooks/hooks.json', vocabulary: 'claude', token: CLAUDE_ROOT_TOKEN, events: null },
  {
    file: 'platforms/claude-code/gate-hooks.settings.json',
    vocabulary: 'claude',
    token: SETTINGS_ROOT_TOKEN,
    events: ['PreToolUse', 'Stop', 'SessionStart'],
  },
  {
    file: 'platforms/copilot-cli/hooks/maister-gates.json',
    vocabulary: 'copilot',
    token: null,
    events: ['preToolUse', 'agentStop', 'sessionStart'],
  },
  // The generated variant. Its registration is a copy, but the scripts it names
  // must sit beside it in the emitted tree — `make validate` used to assert this
  // with `jq`; it now runs this test with `--only=T01,T24` instead.
  {
    file: 'plugins/maister-copilot/.github/hooks/maister-gates.json',
    vocabulary: 'copilot',
    token: null,
    events: ['preToolUse', 'agentStop', 'sessionStart'],
    emittedDir: 'plugins/maister-copilot/.github/hooks',
  },
];

const HOOK_EVENT_NAMES = {
  claude: new Set(['PreToolUse', 'Stop', 'SessionStart', 'PostToolUse', 'UserPromptSubmit', 'SessionEnd', 'PreCompact', 'Notification', 'SubagentStop']),
  copilot: new Set(['preToolUse', 'agentStop', 'sessionStart']),
};

/** The script a Claude entry runs: the exec form's `args[0]`, else the command. */
function claudeScriptOf(entry) {
  if (Array.isArray(entry.args) && entry.args.length > 0) return String(entry.args[0]);
  const command = String(entry.command ?? '');
  const quoted = /"([^"]+)"/.exec(command);
  if (quoted) return quoted[1];
  const bare = command.split(/\s+/).filter(Boolean);
  return bare.length ? bare[bare.length - 1] : null;
}

/** The script a Copilot entry runs, from either shell's `node "<path>"` form. */
function copilotScriptOf(command) {
  const match = /^node "([^"]+)"$/.exec(String(command ?? '').trim());
  return match ? match[1] : null;
}

function claudeEntries(json) {
  const out = [];
  for (const [event, groups] of Object.entries(json.hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const entry of Array.isArray(group?.hooks) ? group.hooks : []) out.push({ event, entry });
    }
  }
  return out;
}

function copilotEntries(json) {
  const out = [];
  for (const [event, entries] of Object.entries(json.hooks ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) out.push({ event, entry });
  }
  return out;
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function t24(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  for (const config of HOOK_CONFIGS) {
    const file = path.join(ctx.repoRoot, config.file);
    checks++;
    if (!isFile(file)) {
      failures.push(`${config.file}: does not exist`);
      continue;
    }
    let json;
    checks++;
    try {
      json = readJson(file);
    } catch (err) {
      failures.push(`${config.file}: does not parse — ${err.message.split('\n')[0]}`);
      continue;
    }

    const entries = config.vocabulary === 'claude' ? claudeEntries(json) : copilotEntries(json);
    checks++;
    if (entries.length === 0) {
      failures.push(`${config.file}: registers no hook`);
      continue;
    }
    if (config.events) {
      checks++;
      const registered = Object.keys(json.hooks ?? {});
      const missing = config.events.filter(event => !registered.includes(event));
      if (missing.length) failures.push(`${config.file}: does not register ${missing.join(', ')}`);
    }
    for (const event of Object.keys(json.hooks ?? {})) {
      checks++;
      if (!HOOK_EVENT_NAMES[config.vocabulary].has(event)) {
        failures.push(`${config.file}: ${event} is not a ${config.vocabulary} hook event`);
      }
    }

    for (const { event, entry } of entries) {
      const label = `${config.file} ${event}`;
      checks++;
      if (entry?.type !== 'command') {
        failures.push(`${label}: type is ${entry?.type}, expected command`);
        continue;
      }

      if (config.vocabulary === 'claude') {
        checks++;
        if (typeof entry.timeout !== 'number' || entry.timeout <= 0) {
          failures.push(`${label}: timeout is ${entry.timeout}, expected a positive number of seconds`);
        }
        const script = claudeScriptOf(entry);
        checks++;
        if (!script || !script.includes(config.token)) {
          failures.push(`${label}: the script path is not anchored to ${config.token} — ${script}`);
          continue;
        }
        checks++;
        const abs = script.split(config.token).join(ctx.pluginRoot);
        if (!isFile(abs)) failures.push(`${label}: ${script} resolves to a file that does not exist`);
        checks++;
        if (script.endsWith('.mjs') && entry.command !== 'node') {
          failures.push(`${label}: a Node hook runs through the exec form (command "node", script in args), got ${entry.command}`);
        }
        continue;
      }

      checks++;
      if (typeof entry.timeoutSec !== 'number' || entry.timeoutSec <= 0 || entry.timeoutSec > COPILOT_TIMEOUT_CAP) {
        failures.push(`${label}: timeoutSec is ${entry.timeoutSec}, expected 1-${COPILOT_TIMEOUT_CAP} seconds`);
      }
      checks++;
      if (typeof entry.bash !== 'string' || typeof entry.powershell !== 'string') {
        failures.push(`${label}: a Copilot entry needs both a bash and a powershell command`);
        continue;
      }
      const posix = copilotScriptOf(entry.bash);
      const windows = copilotScriptOf(entry.powershell);
      checks++;
      if (!posix || !windows) {
        failures.push(`${label}: both commands run the script as node "<path>" — got ${entry.bash} / ${entry.powershell}`);
        continue;
      }
      checks++;
      if (!posix.startsWith(`${COPILOT_HOOK_DIR}/`)) failures.push(`${label}: bash resolves from ${posix}, expected ${COPILOT_HOOK_DIR}/`);
      checks++;
      if (!windows.startsWith(`${COPILOT_HOOK_DIR_PS}/`)) {
        failures.push(`${label}: powershell resolves from ${windows}, expected ${COPILOT_HOOK_DIR_PS}/`);
      }
      checks++;
      if (path.basename(posix) !== path.basename(windows)) {
        failures.push(`${label}: the two shells run different scripts — ${path.basename(posix)} / ${path.basename(windows)}`);
        continue;
      }
      // The template points at the consumer's `.github/hooks/`; the file that
      // lands there is this tree's, copied by the build. In the emitted variant
      // the script must already sit beside the registration.
      const homeDir = config.emittedDir
        ? path.join(ctx.repoRoot, config.emittedDir)
        : path.join(ctx.pluginRoot, 'hooks');
      checks++;
      if (!isFile(path.join(homeDir, path.basename(posix)))) {
        failures.push(`${label}: ${path.basename(posix)} is registered but absent from ${rel(homeDir)}`);
      }
    }

    if (config.emittedDir) {
      // The hooks import it as a sibling, so the build must emit it too.
      checks++;
      if (!isFile(path.join(ctx.repoRoot, config.emittedDir, 'gate-lib.mjs'))) {
        failures.push(`${config.emittedDir}/gate-lib.mjs: not emitted beside the hooks it serves`);
      }
    }
  }

  // The plugin registration is the terminal-mode one, and its matcher is a
  // regular expression: a bare `mcp__` prefix is not a pattern that matches an
  // MCP tool name, so the gate would never see an MCP write.
  const plugin = path.join(ctx.repoRoot, 'plugins/maister/hooks/hooks.json');
  if (isFile(plugin)) {
    const groups = (readJson(plugin).hooks?.PreToolUse ?? []).filter(group => (group?.hooks ?? [])
      .some(entry => String(entry?.args?.[0] ?? entry?.command ?? '').includes(path.basename(GATE_HOOK))));
    checks++;
    if (groups.length !== 1) {
      failures.push(`hooks.json: ${groups.length} PreToolUse groups run ${path.basename(GATE_HOOK)}, expected 1`);
    } else {
      const matcher = String(groups[0].matcher ?? '');
      const alternatives = matcher.split('|');
      for (const want of GATE_MATCHER_ALTERNATIVES) {
        checks++;
        if (!alternatives.includes(want)) failures.push(`hooks.json: the gate matcher does not list ${want} — ${matcher}`);
      }
      for (const tool of GATE_MATCHER_TOOLS) {
        checks++;
        if (!new RegExp(`^(?:${matcher})$`).test(tool)) failures.push(`hooks.json: the gate matcher does not match ${tool} — ${matcher}`);
      }
    }
  }

  // Copilot's registration format is versioned; v1 is what 1.0.80 reads.
  const gates = path.join(ctx.repoRoot, 'platforms/copilot-cli/hooks/maister-gates.json');
  if (isFile(gates)) {
    checks++;
    const version = readJson(gates).version;
    if (version !== 1) failures.push(`maister-gates.json: version is ${JSON.stringify(version)}, expected 1`);
  }

  // The hooks are Node, on purpose: a Python interpreter is not a dependency
  // this plugin takes, on either provider.
  const hookDir = path.join(ctx.pluginRoot, 'hooks');
  for (const file of isDir(hookDir) ? walkFiles(hookDir) : []) {
    checks++;
    if (fs.readFileSync(file, 'utf8').includes('python3')) failures.push(`${rel(file)}: names python3`);
  }

  notes.push(`${HOOK_CONFIGS.length} registrations checked, the emitted Copilot variant included`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T25 — reserved keys warn, they never fail
// ---------------------------------------------------------------------------

const RESERVED_FIXTURE = path.join('synthetic', 'workflow-definition');
const RESERVED_FILE = 'reserved-keys.yml';
const CLEAN_DEFINITION = 'research-builtin.yml';

function t25(ctx) {
  const failures = [];
  let checks = 0;
  const { ajv, byId } = loadSchemas(ctx.schemas);

  checks++;
  const definition = byId.get(`${SCHEMA_ID_BASE}workflow-definition`);
  if (!definition) return { checks, failures: ['workflow-definition schema is not loaded'] };
  const reserved = definition.json.$defs?.reserved?.const;
  checks++;
  if (!Array.isArray(reserved) || reserved.length === 0) {
    return { checks, failures: ['workflow-definition#/$defs/reserved is not a const list'] };
  }

  const fx = corpus(ctx).find(f => f.id === RESERVED_FIXTURE);
  checks++;
  if (!fx) return { checks, failures: [`${RESERVED_FIXTURE} fixture is absent`] };

  const file = path.join(fx.dir, RESERVED_FILE);
  checks++;
  if (!isFile(file)) return { checks, failures: [`${RESERVED_FIXTURE}/${RESERVED_FILE} is absent`] };

  // Accepted: the document still validates with every reserved key present.
  checks++;
  const errors = validateFile(ajv, file, 'workflow-definition.schema.json#');
  if (errors.length) {
    failures.push(`${RESERVED_FILE}: ${errors[0].instancePath || '/'} ${errors[0].keyword} — ${errors[0].message}`);
  }

  checks++;
  const got = lintReservedKeys(parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS), reserved);
  const want = fx.manifest.expect?.warnings ?? [];
  if (got.join('|') !== want.join('|')) {
    failures.push(`warnings [${got.join(', ')}], manifest declares [${want.join(', ')}]`);
  }

  // Every reserved key in the register's list is exercised by the fixture.
  checks++;
  if (got.length !== reserved.length) {
    failures.push(`${got.length} of ${reserved.length} reserved keys are covered by the fixture`);
  }

  // A definition that claims nothing reserved warns about nothing.
  const clean = path.join(fx.dir, CLEAN_DEFINITION);
  if (isFile(clean)) {
    checks++;
    const noise = lintReservedKeys(parseYaml(fs.readFileSync(clean, 'utf8'), YAML_OPTS), reserved);
    if (noise.length) failures.push(`${CLEAN_DEFINITION}: warned about [${noise.join(', ')}]`);
  }
  return { checks, failures };
}

// ---------------------------------------------------------------------------
// T26 — orphan check
// ---------------------------------------------------------------------------

const CONTRACT_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'E1', 'E2', 'H1', 'R', 'T1',
];

/** Contracts with no document of their own to reject, and why. */
const NO_NEGATIVE_FIXTURE = new Map([
  ['A4', 'no schema — the negative direction is the enumerator inventory_only list (T10)'],
  ['B3', 'an alias of common#/$defs/phase_summary_value — negatives live under A1'],
  ['C5', 'a read rule; an unclassifiable record is `unknown`, itself a valid outcome'],
  ['C6', 'a path register at v1 — no document exists to reject'],
  ['R', 'accepted-and-ignored by construction — there is no invalid reserved key'],
  ['T1', 'carried inside a C7 mirror event — negatives are the event fixtures'],
]);
/** C6 has no document at all, so it has no positive fixture either. */
const NO_POSITIVE_FIXTURE = new Set(['C6']);
/** Validates the corpus rather than a contract; T02 is its exercise. */
const NON_CONTRACT_SCHEMAS = new Set(['fixture-manifest.schema.json']);

const H1_PAYLOAD_CLASSES = [
  ['claude', 'PreToolUse'], ['claude', 'Stop'], ['claude', 'SessionStart'],
  ['copilot', 'preToolUse'], ['copilot', 'agentStop'], ['copilot', 'sessionStart'],
];

function t26(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const byContract = new Map();
  const referenced = new Set();
  for (const fx of corpus(ctx)) {
    for (const id of fx.manifest.contracts ?? []) {
      if (!byContract.has(id)) byContract.set(id, new Set());
      byContract.get(id).add(fx.manifest.verdict);
    }
    for (const entry of fx.manifest.files) {
      if (entry.schema) referenced.add(entry.schema.split('#')[0]);
    }
  }

  for (const id of CONTRACT_IDS) {
    const verdicts = byContract.get(id) ?? new Set();
    if (!NO_POSITIVE_FIXTURE.has(id)) {
      checks++;
      if (!verdicts.has('valid')) failures.push(`${id}: no valid fixture`);
    }
    if (!NO_NEGATIVE_FIXTURE.has(id)) {
      checks++;
      if (!verdicts.has('invalid')) failures.push(`${id}: no invalid fixture`);
    }
  }
  // A declared exemption that stopped being one is itself an orphan.
  for (const [id, why] of NO_NEGATIVE_FIXTURE) {
    checks++;
    if ((byContract.get(id) ?? new Set()).has('invalid')) {
      failures.push(`${id}: exempted from negative coverage (${why}) but an invalid fixture exists`);
    }
  }

  // Schema reachability: referenced by a fixture, or $ref'd from one that is.
  const { docs } = loadSchemas(ctx.schemas);
  const refsOf = new Map();
  for (const doc of docs) {
    const out = new Set();
    for (const [, node] of walk(doc.json)) {
      if (isObject(node) && typeof node.$ref === 'string' && node.$ref.startsWith(SCHEMA_ID_BASE)) {
        out.add(`${node.$ref.slice(SCHEMA_ID_BASE.length).split('#')[0]}.schema.json`);
      }
    }
    refsOf.set(doc.name, out);
  }
  const reachable = new Set(referenced);
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...reachable]) {
      for (const target of refsOf.get(name) ?? []) {
        if (!reachable.has(target)) { reachable.add(target); grew = true; }
      }
    }
  }
  for (const doc of docs) {
    if (NON_CONTRACT_SCHEMAS.has(doc.name)) continue;
    checks++;
    if (!reachable.has(doc.name)) failures.push(`${doc.name}: no fixture reaches this schema`);
  }

  // H1 replay coverage — the hook the replays run against is task 3/8's file.
  if (!isFile(path.join(ctx.pluginRoot, GATE_HOOK))) {
    notes.push(`replay coverage: skip (${GATE_HOOK} is not built yet)`);
    return { checks, failures, notes };
  }
  const replays = corpus(ctx)
    .map(fx => fx.manifest.expect?.replay)
    .filter(isObject);
  for (const [provider, event] of H1_PAYLOAD_CLASSES) {
    checks++;
    if (!replays.some(r => r.provider === provider && r.event === event)) {
      failures.push(`${provider} ${event}: no replay fixture`);
    }
  }
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T27 — release tarball and the tag workflow
// ---------------------------------------------------------------------------

const CONTRACTS_WORKFLOW = '.github/workflows/contracts.yml';
const CONTRACT_TAG_GLOB = 'contracts-v*';

// What the archive must carry, relative to its single top-level directory.
const TARBALL_ENTRIES = [
  'schemas/',
  'fixtures/contracts/valid/',
  'fixtures/contracts/invalid/',
  'fixtures/contracts/tolerated/',
  'fixtures/contracts/synthetic/',
  'manifest.json',
  'VERSION',
  'compatibility-contracts.md',
  'scripts/verify-contracts.mjs',
  'package.json',
  'package-lock.json',
];

// The tarball carries no plugin tree and no `.maister/tasks`, so the runner it
// ships must report exactly these as `skip` — never as `FAIL`.
const TREE_DEPENDENT_TESTS = [
  'T11', 'T14', 'T15', 'T16', 'T17', 'T18', 'T19', 'T20', 'T21', 'T22', 'T23', 'T24', 'T27', 'T28',
  'T29', 'T30', 'T31', 'T32', 'T33', 'T34',
];

/** Every step of every job in a workflow document, flattened. */
function workflowSteps(doc) {
  const out = [];
  for (const job of Object.values(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) if (isObject(step)) out.push(step);
  }
  return out;
}

// Under the YAML 1.2 core schema `on` stays the string key GitHub writes; a 1.1
// reader would fold it to the boolean `true`. Accept both so the assertion is
// about the workflow, not about the parser.
const workflowOn = doc => doc?.on ?? doc?.true;

function t27(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  // -- the tag workflow -----------------------------------------------------
  const wfPath = path.join(ctx.repoRoot, CONTRACTS_WORKFLOW);
  checks++;
  if (!isFile(wfPath)) {
    failures.push(`${CONTRACTS_WORKFLOW}: missing`);
  } else {
    let doc = null;
    checks++;
    try {
      doc = parseYaml(fs.readFileSync(wfPath, 'utf8'), YAML_OPTS);
    } catch (err) {
      failures.push(`${CONTRACTS_WORKFLOW}: does not parse — ${err.message.split('\n')[0]}`);
    }
    if (doc) {
      const tags = workflowOn(doc)?.push?.tags;
      checks++;
      if (!Array.isArray(tags) || !tags.includes(CONTRACT_TAG_GLOB)) {
        failures.push(`${CONTRACTS_WORKFLOW}: on.push.tags is ${JSON.stringify(tags)}, expected ["${CONTRACT_TAG_GLOB}"]`);
      }
      checks++;
      if (doc.permissions?.contents !== 'write') {
        failures.push(`${CONTRACTS_WORKFLOW}: permissions.contents is ${JSON.stringify(doc.permissions?.contents ?? null)}, expected "write" — the release upload needs it`);
      }
      // Which steps the job runs, and in what order, is the workflow's own
      // business; what this suite owns is that the tag publishes both artefacts.
      const release = workflowSteps(doc).find(s => typeof s.uses === 'string' && s.uses.startsWith('softprops/action-gh-release'));
      checks++;
      if (!release) {
        failures.push(`${CONTRACTS_WORKFLOW}: no softprops/action-gh-release step`);
      } else {
        const files = String(release.with?.files ?? '');
        const named = files.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
        for (const want of ['.tar.gz', '.tar.gz.sha256']) {
          checks++;
          if (!named.some(f => f.endsWith(want))) {
            failures.push(`${CONTRACTS_WORKFLOW}: files: names no *${want} asset — got ${JSON.stringify(files)}`);
          }
        }
      }
    }
  }

  // -- the archive ----------------------------------------------------------
  const distDir = path.join(ctx.repoRoot, 'dist');
  if (!isDir(distDir)) {
    notes.push('no dist/ — archive assertions skipped; run `make tarball` (CI builds it after `make test`, so this is the CI path)');
    return { checks, failures, notes };
  }
  const archives = fs.readdirSync(distDir)
    .filter(n => n.endsWith('.tar.gz'))
    .map(n => ({ name: n, full: path.join(distDir, n), mtime: fs.statSync(path.join(distDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  checks++;
  if (!archives.length) {
    failures.push('dist/ exists but holds no *.tar.gz — `make tarball` produced no archive');
    return { checks, failures, notes };
  }
  const archive = archives[0];
  const tag = archive.name.replace(/\.tar\.gz$/, '');
  notes.push(`archive under test: dist/${archive.name}`);

  // Checksum sidecar, in `shasum -a 256 -c` form. This is a gate, not a report:
  // the archive is listed, extracted and executed only once it verifies, so a
  // tarball dropped into the git-ignored `dist/` never gets run.
  const sidecar = `${archive.full}.sha256`;
  checks++;
  if (!isFile(sidecar)) {
    failures.push(`dist/${archive.name}.sha256: missing — the archive is not opened`);
    return { checks, failures, notes };
  }
  const line = fs.readFileSync(sidecar, 'utf8').trim();
  const m = /^([0-9a-f]{64})\s{2}(\S+)$/.exec(line);
  checks++;
  if (!m) {
    failures.push(`dist/${archive.name}.sha256: ${JSON.stringify(line)} is not \`<hex>  <filename>\` — the archive is not opened`);
    return { checks, failures, notes };
  }
  checks++;
  if (m[2] !== archive.name) {
    failures.push(`dist/${archive.name}.sha256: names ${m[2]}, expected ${archive.name} — the archive is not opened`);
    return { checks, failures, notes };
  }
  checks++;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archive.full)).digest('hex');
  if (actual !== m[1]) {
    failures.push(`dist/${archive.name}.sha256: records ${m[1]}, the archive hashes to ${actual} — the archive is not opened`);
    return { checks, failures, notes };
  }

  const listed = runBounded('tar', ['-tzf', archive.full], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  checks++;
  if (listed.status !== 0) {
    failures.push(`tar -tzf dist/${archive.name} exited ${listed.status}: ${(listed.stderr ?? '').trim().split('\n')[0]}`);
    return { checks, failures, notes };
  }
  const entries = listed.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  const fileEntries = entries.filter(e => !e.endsWith('/'));
  for (const want of TARBALL_ENTRIES) {
    checks++;
    if (!entries.some(e => e.startsWith(`${tag}/${want}`))) {
      failures.push(`dist/${archive.name}: no entry under ${tag}/${want}`);
    }
  }

  // The staging dir is what was archived; a mismatch means files were dropped.
  const staging = path.join(distDir, tag);
  checks++;
  if (!isDir(staging)) {
    failures.push(`dist/${tag}/: staging directory is missing — the entry count cannot be cross-checked`);
  } else {
    checks++;
    const staged = walkFiles(staging).length;
    if (fileEntries.length !== staged) {
      failures.push(`dist/${archive.name}: ${fileEntries.length} file entries, dist/${tag}/ holds ${staged}`);
    }

    const versionFile = path.join(staging, 'VERSION');
    checks++;
    if (!isFile(versionFile)) {
      failures.push(`dist/${tag}/VERSION: missing`);
    } else {
      let version = null;
      checks++;
      try {
        version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      } catch (err) {
        failures.push(`dist/${tag}/VERSION: does not parse — ${err.message.split('\n')[0]}`);
      }
      if (version) {
        for (const key of ['tag', 'git_sha', 'plugin_version', 'built_at', 'fixture_count', 'schema_count']) {
          checks++;
          if (version[key] === undefined || version[key] === null || version[key] === '') {
            failures.push(`dist/${tag}/VERSION: ${key} is missing`);
          }
        }
        checks++;
        if (version.tag !== tag) failures.push(`dist/${tag}/VERSION: tag is ${JSON.stringify(version.tag)}, expected ${JSON.stringify(tag)}`);
        checks++;
        if (!A6_TIMESTAMP.test(String(version.built_at ?? ''))) {
          failures.push(`dist/${tag}/VERSION: built_at ${JSON.stringify(version.built_at ?? null)} is not an A6 timestamp`);
        }
        const manifest = path.join(ctx.repoRoot, 'plugins/maister/.claude-plugin/plugin.json');
        if (isFile(manifest)) {
          checks++;
          const declared = readJson(manifest).version;
          if (version.plugin_version !== declared) {
            failures.push(`dist/${tag}/VERSION: plugin_version ${JSON.stringify(version.plugin_version)} ≠ plugin.json ${JSON.stringify(declared)}`);
          }
        }
        checks++;
        if (version.schema_count !== fs.readdirSync(ctx.schemas).filter(n => n.endsWith('.schema.json')).length) {
          failures.push(`dist/${tag}/VERSION: schema_count ${JSON.stringify(version.schema_count)} ≠ the number of shipped schemas`);
        }
      }
    }
  }

  // -- the vendored runner, from the extracted archive -----------------------
  // Extracted into a fresh directory under the platform temp location, unique
  // per run: two suites running at once must not share an extraction tree.
  // The repository's own `node_modules` is linked in beside the extracted root
  // so the vendored runner still resolves `ajv` and `yaml` with no network.
  const extractRoot = tempDir('tarball');
  try {
    const deps = path.join(ctx.repoRoot, 'node_modules');
    if (isDir(deps)) {
      const linked = path.join(extractRoot, 'node_modules');
      // `junction` is the only link type Windows grants unelevated; POSIX
      // ignores the type argument. Copy if even that is refused.
      try {
        fs.symlinkSync(deps, linked, 'junction');
      } catch {
        fs.cpSync(deps, linked, { recursive: true });
      }
    }
    const untar = runBounded('tar', ['-xzf', archive.full, '-C', extractRoot], { encoding: 'utf8', timeout: ARCHIVE_TIMEOUT_MS });
    checks++;
    if (untar.status !== 0) {
      failures.push(`tar -xzf dist/${archive.name} exited ${untar.status}: ${(untar.stderr ?? '').trim().split('\n')[0]}`);
      return { checks, failures, notes };
    }
    const root = path.join(extractRoot, tag);
    const runner = path.join(root, 'scripts', 'verify-contracts.mjs');
    checks++;
    if (!isFile(runner)) {
      failures.push(`dist/${archive.name}: the extracted archive has no scripts/verify-contracts.mjs`);
      return { checks, failures, notes };
    }
    const run = runBounded(process.execPath, [
      runner,
      `--fixtures=${path.join(root, 'fixtures', 'contracts')}`,
      `--schemas=${path.join(root, 'schemas')}`,
    ], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: ARCHIVE_TIMEOUT_MS });
    const lines = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split('\n').map(s => s.trim()).filter(Boolean);
    const failLines = lines.filter(l => l.startsWith('FAIL '));
    checks++;
    if (failLines.length) failures.push(`the vendored runner reported ${failLines.length} FAIL: ${failLines.slice(0, 3).join(' | ')}`);
    checks++;
    if (run.status !== 0) failures.push(`the vendored runner exited ${run.status} from the extracted archive`);
    for (const id of TREE_DEPENDENT_TESTS) {
      checks++;
      if (!lines.some(l => l.startsWith(`skip ${id} `))) {
        failures.push(`the vendored runner did not skip ${id} — the tarball carries no plugin tree`);
      }
    }
    const okCount = lines.filter(l => l.startsWith('ok ')).length;
    checks++;
    if (okCount < 10) failures.push(`the vendored runner reported ${okCount} ok lines — the tree-independent tests did not run`);
    notes.push(`vendored runner from the extracted archive: ${okCount} ok, ${lines.filter(l => l.startsWith('skip ')).length} skip, ${failLines.length} FAIL`);
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }

  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T28 — the in-repo task dirs (local only; `.maister/` is git-ignored)
// ---------------------------------------------------------------------------

const IN_REPO_TASKS = '.maister/tasks';

function t28(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);

  const pinned = registerMd5(ctx.pluginRoot);
  checks++;
  if (!pinned) failures.push(`${REGISTER} does not pin the dashboard.html MD5`);

  const root = path.join(ctx.repoRoot, IN_REPO_TASKS);
  const listed = enumerateTaskTree(scanTaskTree(root));
  checks++;
  if (listed.taskDirs.length === 0) failures.push('no in-repo dir reaches the compatibility floor');
  if (listed.inventoryOnly.length) notes.push(`inventory rows: ${listed.inventoryOnly.join(', ')}`);

  const validateState = ajv.getSchema(`${SCHEMA_ID_BASE}orchestrator-state`);
  const validateDashboard = ajv.getSchema(`${SCHEMA_ID_BASE}dashboard-data`);
  let arrayForm = 0;

  for (const relDir of listed.taskDirs) {
    const dir = path.join(root, relDir);

    checks++;
    const stateText = fs.readFileSync(path.join(dir, 'orchestrator-state.yml'), 'utf8');
    const state = readState(stateText).data;
    if (!validateState(state)) {
      const err = validateState.errors[0];
      failures.push(`${relDir}: state ${err.instancePath || '/'} ${err.keyword} — ${err.message}`);
    }
    checks++;
    const stateA6 = lintA6(state);
    if (stateA6.length) failures.push(`${relDir}: state ${stateA6[0].instancePath} ${stateA6[0].keyword}`);

    const dashboardPath = path.join(dir, 'dashboard-data.js');
    checks++;
    if (!isFile(dashboardPath)) {
      failures.push(`${relDir}: no dashboard-data.js beside a state at the floor`);
    } else {
      const dashboard = readDashboardData(fs.readFileSync(dashboardPath, 'utf8')).data;
      checks++;
      if (!validateDashboard(dashboard)) {
        const err = validateDashboard.errors[0];
        failures.push(`${relDir}: dashboard ${err.instancePath || '/'} ${err.keyword} — ${err.message}`);
      }
      checks++;
      const dashboardA6 = lintA6(dashboard);
      if (dashboardA6.length) failures.push(`${relDir}: dashboard ${dashboardA6[0].instancePath} ${dashboardA6[0].keyword}`);
    }

    const html = path.join(dir, 'dashboard.html');
    checks++;
    if (!isFile(html)) {
      failures.push(`${relDir}: the frozen dashboard asset is missing`);
    } else if (pinned && md5(fs.readFileSync(html)) !== pinned) {
      failures.push(`${relDir}: dashboard.html does not match the pinned MD5`);
    }

    for (const key of Object.keys(state ?? {})) {
      const context = state[key];
      if (!isObject(context) || !isObject(context.phase_summaries)) continue;
      for (const value of Object.values(context.phase_summaries)) {
        if (Array.isArray(value)) arrayForm++;
      }
    }
  }

  // The Q&A array form the development workflow writes into `clarifications`.
  checks++;
  if (arrayForm === 0) failures.push('no in-repo dir exercises the array-valued phase-summary entry');
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T29 — workflow grammar runner
// ---------------------------------------------------------------------------

const ENGINE = 'skills/workflow-engine';

/**
 * The two overlay-route hashes this suite pins. Every shipped definition's own
 * hash lives in its `WORKFLOW_PINS` row below; these two belong to routes over
 * a definition rather than to definitions, so they stay named constants.
 */
const TUNED_GRAPH_HASH = '47f78ff9e971ee66d0cc932870ff890727030b255f11cd5d3af8d01c432e2c5c';
const TUNED_LEAN_GRAPH_HASH = 'fe8336c0bb1a99fd9730d9fa9a31bb839392a82ee10fbae63a6d647eac6681d8';

/**
 * `richtext.yml`'s pinned warning set. Neither `workflow:research` nor
 * `workflow:development` is in it, on purpose: both resolve through a shipped
 * built-in, so their silence here is a positive check that each is discoverable
 * through the resolution order rather than merely present on disk. One
 * undecidable value type is all that survives.
 */
const RICHTEXT_WARNINGS = [
  'undecidable-value-type:nodes.research.outputs.values.order',
];

/** `reserved-keys.yml` warns once per occurrence, and never errors. */
const RESERVED_KEY_WARNINGS = [
  'reserved-key:assertions', 'reserved-key:backing', 'reserved-key:foreach', 'reserved-key:loop',
  'reserved-key:mirror.scope', 'reserved-key:routing.tiers', 'reserved-key:session.substrate',
  'reserved-key:validation',
];

/** The definition the overlay and lean-profile cases below are written against. */
const RESEARCH = 'research';

/**
 * One row per definition shipped under `workflows/`, keyed by its file stem.
 *
 * The walk below reads that directory and looks every file up here. A file with
 * no row is a failure, not a skip: that is what makes shipping a definition
 * whose graph, diagram and prohibitions nothing asserts impossible to do
 * silently.
 *
 * `hash` is the canonical graph hash — the drift detector between a definition
 * and any twin of it, since an edit to either that the other does not receive
 * moves it. `nodes` are its node ids in canonical order. `edits` are the
 * single-token rewrites the gate-coverage check applies to a scratch copy: each
 * one has to match the definition, and each one has to move the hash, which is
 * how the gate question text and the option ids are shown to be inside it.
 *
 * `twin` names the shipped synthetic fixture that copies the definition, if
 * there is one. The comparison lives here, inside a walk that needs only the
 * plugin and the fixtures, so that it runs in CI: a twin guarded from the
 * in-repo band would never execute there, and would quietly stop being a twin.
 * It covers two things — the twin resolves to the definition's canonical graph
 * hash, and it validates with no warning of its own — so that a twin is held to
 * the same clean surface as the definition rather than to hash equality alone.
 * The field is optional, so the walk below also sweeps the fixture directory in
 * the other direction: a `*-builtin.yml` no row claims is compared against
 * nothing. Adding a row is not the whole of adding a twin — the fixture needs
 * its `.md` prose companion beside it, because `direct:` nodes resolve against
 * one, and an entry in that directory's `manifest.json`, or the walk fails at
 * the fixture rather than at what is missing from it.
 */
const WORKFLOW_PINS = {
  development: {
    hash: '7332851263e5ea3428795fc45c22651395701c48b8b602d3d03e525bba95f869',
    twin: 'development-builtin.yml',
    nodes: [
      'intake', 'codebase-analysis', 'gap-analysis', 'gap-approval', 'tdd-red', 'tdd-red-approval',
      'ui-mockups', 'mockup-approval', 'specification', 'specification-approval', 'spec-audit',
      'spec-audit-approval', 'planning', 'planning-approval', 'implementation', 'implementation-approval',
      'tdd-green', 'tdd-green-approval', 'verification-options', 'verification', 'verification-approval',
      'e2e-verification', 'e2e-approval', 'user-docs', 'docs-approval', 'finalization',
    ],
    edits: [
      ['an edited gate question',
        'ask: "Gap analysis complete', 'ask: "Gap analysis done'],
      ['a renamed continue option',
        'continue-past-analysis: continue', 'proceed-past-analysis: continue'],
    ],
  },
  research: {
    hash: '8c806c4ddc046e9b35911e918f46e2b69acdbe5431efd9c3dcee8125918c8b61',
    twin: 'research-builtin.yml',
    nodes: [
      'research-foundation', 'foundation-approval', 'optional-phases-decision', 'solution-generation',
      'solution-convergence', 'convergence-approval', 'high-level-design', 'design-approval', 'completion',
    ],
    edits: [
      ['an edited gate question',
        'ask: "Research foundation complete', 'ask: "Research foundation done'],
      ['a renamed continue option',
        'continue-to-evaluation: continue', 'proceed-to-evaluation: continue'],
    ],
  },
};

/**
 * Contract R's reserved paths, mirrored from `graph.mjs`'s own `RESERVED_PATHS`.
 * A shipped definition may name none of them, matched by dotted-path suffix: a
 * hit is a key a later format version claims, written today by a file that
 * would then mean something else under that version.
 */
const RESERVED_PATHS = [
  'foreach', 'loop', 'assertions', 'validation',
  'session.substrate', 'mirror.scope', 'backing', 'routing.tiers',
];

/** The root and node key sets each synthetic definition must read back as. */
const DEFINITION_KEYS = {
  'richtext.yml': {
    root: ['name', 'version', 'inputs', 'nodes'],
    nodes: ['research', 'approve', 'dev-alpha', 'dev-beta', 'close-out'],
  },
  'overlay.yml': { root: ['extends', 'version', 'add', 'tune', 'disable', 'profiles'], nodes: null },
  'reserved-keys.yml': {
    root: ['name', 'version', 'inputs', 'nodes', 'mirror', 'backing', 'routing'],
    nodes: ['fan-out', 'retry-loop', 'remote'],
  },
  'version-99.yml': { root: ['name', 'version', 'inputs', 'capabilities', 'nodes'], nodes: ['plan', 'build'] },
};

/** Out-of-subset YAML: each one is a located error, never a silent misread. */
const OUT_OF_SUBSET = {
  anchor: ['    with: &shared {a: 1}'],
  alias: ['    with: *shared'],
  'multi-document stream': ['---', 'name: second'],
  'block scalar': ['    ask: |', '      a folded question'],
  tag: ['    with: !!map {a: 1}'],
};

/** No shipped engine file may carry a literal the generated-variant greps hunt. */
const FORBIDDEN_LITERALS = [/maister:/, /multi-select/i, /multiselect/i, /claude\.md/i];

async function t29(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const engine = path.join(ctx.pluginRoot, ENGINE);
  const entry = path.join(engine, 'scripts', 'workflow.mjs');
  checks++;
  if (!isFile(entry)) return { checks, failures: [`${ENGINE}/scripts/workflow.mjs is absent`] };

  const lib = name => pathToFileURL(path.join(engine, 'scripts', 'lib', `${name}.mjs`)).href;
  const { readDefinition, parseDefinition } = await import(lib('definition'));
  const { resolve: resolveGraph } = await import(lib('graph'));
  const { render } = await import(lib('diagram'));

  const synthetic = path.join(ctx.fixtures, 'synthetic', 'workflow-definition');
  const tuned = path.join(ctx.fixtures, 'synthetic', 'workflow-overlay', 'research-tuned');
  const rejected = path.join(ctx.fixtures, 'invalid', 'workflow-definition');

  /** One verb invocation, with its JSON report parsed where there is one. */
  const run = (...args) => {
    const proc = runBounded(process.execPath, [entry, ...args], { encoding: 'utf8', input: '' });
    let report = null;
    try { report = JSON.parse(proc.stdout); } catch { /* the caller reports the absence */ }
    return { status: proc.status, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '', report };
  };

  /** `validate`, reduced to the pair every positive assertion here reads. */
  const validated = (label, ...args) => {
    const out = run('validate', ...args);
    if (out.report === null) {
      failures.push(`${label}: validate printed no JSON report (${out.stderr.trim().split('\n')[0] ?? ''})`);
      return null;
    }
    if (out.status !== 0 || out.report.ok !== true) {
      failures.push(`${label}: validate rejected it — ${JSON.stringify(out.report.errors ?? [])}`);
      return null;
    }
    return out.report;
  };

  const pinned = (label, got, want) => {
    checks++;
    const sorted = [...(got ?? [])].sort();
    if (JSON.stringify(sorted) !== JSON.stringify([...want].sort())) {
      failures.push(`${label}: the warning set drifted — ${JSON.stringify(sorted)}`);
    }
  };

  // -- the reader: the accepted subset round-trips, and nothing else does ----
  for (const [name, want] of Object.entries(DEFINITION_KEYS)) {
    checks++;
    const read = readDefinition(path.join(synthetic, name));
    if (read.errors.length) { failures.push(`${name}: ${JSON.stringify(read.errors[0])}`); continue; }
    if (JSON.stringify(Object.keys(read.doc)) !== JSON.stringify(want.root)) {
      failures.push(`${name}: root keys are ${Object.keys(read.doc).join(', ')}`);
    }
    if (!want.nodes) continue;
    checks++;
    if (JSON.stringify(Object.keys(read.doc.nodes)) !== JSON.stringify(want.nodes)) {
      failures.push(`${name}: node ids are ${Object.keys(read.doc.nodes).join(', ')}`);
    }
  }

  const richtextDoc = readDefinition(path.join(synthetic, 'richtext.yml')).doc;
  const roundTrips = [
    ['a flow map', richtextDoc?.inputs?.brief, { type: 'path', required: true }],
    ['a bare bool', richtextDoc?.inputs?.skip_beta, { type: 'bool', required: false, default: false }],
    ['an empty flow sequence', richtextDoc?.nodes?.research?.needs, []],
    ['a populated flow sequence', richtextDoc?.nodes?.approve?.needs, ['research']],
    ['a nested block map', richtextDoc?.nodes?.approve?.options, { proceed: 'continue', revise: 'stop', abort: 'stop' }],
    ['a quoted scalar', richtextDoc?.nodes?.approve?.ask, 'Research is complete. Proceed to the per-repo implementation runs?'],
    ['a negated reference', richtextDoc?.nodes?.['dev-beta']?.when, '!${inputs.skip_beta}'],
    ['a bare scalar carrying a colon', richtextDoc?.nodes?.['close-out']?.uses, 'skill:implementation-verifier'],
  ];
  for (const [label, got, want] of roundTrips) {
    checks++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`richtext.yml: ${label} read back as ${JSON.stringify(got)}`);
    }
  }

  // Both comment forms, and a `#` inside quotes that is not one.
  checks++;
  const commented = parseDefinition([
    '# a full-line comment',
    'name: comments   # an inline comment',
    'version: 1',
    'nodes:',
    '  plan:   # another inline comment',
    '    uses: skill:quick-plan',
    '    needs: []',
    "    with: {note: 'a # inside quotes is not a comment'}",
    '',
  ].join('\n'), 'inline.yml');
  if (commented.errors.length || commented.doc?.nodes?.plan?.with?.note !== 'a # inside quotes is not a comment') {
    failures.push(`inline.yml: comment handling drifted — ${JSON.stringify(commented.errors)}`);
  }

  const head = ['name: probe', 'version: 1', 'nodes:', '  plan:', '    uses: skill:quick-plan'];
  for (const [label, tail] of Object.entries(OUT_OF_SUBSET)) {
    checks++;
    const read = parseDefinition([...head, ...tail].join('\n'), `${label}.yml`);
    const [error] = read.errors;
    if (read.doc !== null || read.errors.length !== 1) {
      failures.push(`${label}: expected exactly one located error, got ${read.errors.length}`);
      continue;
    }
    if (!['file', 'node', 'path', 'message'].every(key => key in error) || error.file !== `${label}.yml`
      || !/line \d+/.test(error.message)) {
      failures.push(`${label}: the error is not located — ${JSON.stringify(error)}`);
    }
  }

  // A CRLF document parses identically to its LF twin, and smuggles nothing.
  checks++;
  const lf = fs.readFileSync(path.join(synthetic, 'richtext.yml'), 'utf8');
  const fromCrlf = parseDefinition(lf.split('\n').join('\r\n'), 'richtext.yml');
  if (fromCrlf.errors.length || JSON.stringify(fromCrlf.doc) !== JSON.stringify(richtextDoc)
    || JSON.stringify(fromCrlf.doc).includes('\\r')) {
    failures.push('richtext.yml: the CRLF twin does not parse identically to its LF original');
  }

  // -- the verbs: every one reachable, an unknown one a loud failure ---------
  for (const args of [['validate', `--definition=${path.join(synthetic, 'richtext.yml')}`],
    ['resolve', `--definition=${path.join(synthetic, 'richtext.yml')}`],
    ['diagram', `--definition=${path.join(synthetic, 'richtext.yml')}`],
    ['write-state', '--state=nowhere/orchestrator-state.yml']]) {
    checks++;
    const out = run(...args);
    if (out.status === null || out.status === 127) failures.push(`${args[0]}: the verb is unreachable`);
    else if (out.status === 2 && out.stderr.trim() === '') failures.push(`${args[0]}: exit 2 with a silent stderr`);
  }
  for (const [label, args] of [['an unknown verb', ['sculpt']], ['no verb at all', []]]) {
    checks++;
    const out = run(...args);
    if (out.status !== 2 || out.stderr.trim() === '') failures.push(`${label}: expected a loud exit 2`);
  }

  // -- the pinned positive cases --------------------------------------------
  const richtext = validated('richtext.yml', `--definition=${path.join(synthetic, 'richtext.yml')}`);
  checks++;
  if (richtext) pinned('richtext.yml', richtext.warnings, RICHTEXT_WARNINGS);

  const reserved = validated('reserved-keys.yml', `--definition=${path.join(synthetic, 'reserved-keys.yml')}`);
  checks++;
  if (reserved) pinned('reserved-keys.yml', reserved.warnings, RESERVED_KEY_WARNINGS);

  const standalone = validated('overlay.yml standalone', `--overlay=${path.join(synthetic, 'overlay.yml')}`);
  checks++;
  if (standalone) pinned('overlay.yml standalone', standalone.warnings, []);

  // The twins' zero-warning surface is pinned inside the definition walk below,
  // once per `twin:` row, rather than by a hardcoded call to one of them here.

  // An unknown version degrades at exit 0 rather than failing the document.
  checks++;
  const future = validated('version-99.yml', `--definition=${path.join(synthetic, 'version-99.yml')}`);
  if (future && !(future.warnings.includes('newer-format') && future.degraded.includes('newer-format'))) {
    failures.push(`version-99.yml: expected a newer-format warning, got ${JSON.stringify(future.warnings)}`);
  }

  // -- the negative cases: located, with the keyword the manifest names ------
  for (const id of fs.readdirSync(rejected).filter(d => isDir(path.join(rejected, d)))) {
    const dir = path.join(rejected, id);
    const manifest = readJson(path.join(dir, 'manifest.json'));
    const file = path.join(dir, manifest.files[0].path);
    checks++;
    const out = run('validate', `--definition=${file}`);
    if (out.status !== 1 || out.report === null || out.report.ok !== false || !out.report.errors.length) {
      failures.push(`invalid/${id}: the runner did not reject it (exit ${out.status})`);
      continue;
    }
    checks++;
    const bad = out.report.errors.find(e => !['file', 'node', 'path', 'message'].every(key => key in e));
    if (bad) failures.push(`invalid/${id}: an error is not located — ${JSON.stringify(bad)}`);
    checks++;
    const pointer = `/${String(out.report.errors[0].path).split('.').join('/')}`;
    if (!pointer.startsWith(manifest.expect.error_path)) {
      failures.push(`invalid/${id}: first error at ${pointer}, expected under ${manifest.expect.error_path}`);
    }
  }

  // -- resolve: the golden canonical graph, and one hash by two routes -------
  const resolved = (label, ...args) => {
    const out = run('resolve', ...args);
    checks++;
    if (out.status !== 0 || out.report === null || out.report.ok !== true) {
      failures.push(`${label}: resolve failed — ${JSON.stringify(out.report?.errors ?? out.stderr.trim())}`);
      return null;
    }
    return out.report;
  };

  // -- every shipped definition: pinned, drawn and swept --------------------
  //
  // Driven by what `workflows/` holds rather than by a list written here. A
  // definition added to that directory without a `WORKFLOW_PINS` row fails the
  // walk instead of slipping through it with its graph unpinned, its diagram
  // uncompared and its two prohibitions — no outcome clause, no reserved name —
  // unasserted.
  const workflowsDir = path.join(engine, 'workflows');
  const definitions = fs.readdirSync(workflowsDir).filter(name => name.endsWith('.yml')).sort()
    .map(name => ({ name: name.slice(0, -'.yml'.length), file: path.join(workflowsDir, name) }));
  checks++;
  if (!definitions.length) failures.push(`${ENGINE}/workflows carries no definition`);
  checks++;
  const unpinned = definitions.filter(each => !WORKFLOW_PINS[each.name]).map(each => each.name);
  if (unpinned.length) failures.push(`workflows/ carries definitions no pin row names: ${unpinned.join(', ')}`);
  // The walk in the other direction. Without it a commit that stages this
  // runner and forgets the definition files ships a pin row for a definition
  // that does not exist, and the loop below — which skips what it cannot find —
  // reports green over nothing.
  checks++;
  const unshipped = Object.keys(WORKFLOW_PINS).filter(name => !definitions.some(each => each.name === name));
  if (unshipped.length) failures.push(`pin rows name definitions workflows/ does not carry: ${unshipped.join(', ')}`);
  // And the same walk for the twins. `twin:` is optional, so dropping the field
  // — or never adding it for a new twin — leaves a `*-builtin.yml` fixture that
  // nothing resolves and nothing compares against the definition it copies: it
  // may drift arbitrarily, or stop being a copy of anything, in silence. The
  // suffix is the naming convention the fixture directory already follows, so
  // the sweep needs no second list to stay current.
  checks++;
  const claimedTwins = new Set(Object.values(WORKFLOW_PINS).map(pin => pin.twin).filter(Boolean));
  const strayTwins = fs.readdirSync(synthetic)
    .filter(name => name.endsWith('-builtin.yml') && !claimedTwins.has(name)).sort();
  if (strayTwins.length) {
    failures.push(`synthetic/workflow-definition carries builtin twins no pin row claims: ${strayTwins.join(', ')}`);
  }

  const graphs = new Map();
  for (const { name, file } of definitions) {
    const pin = WORKFLOW_PINS[name];
    if (!pin) continue;

    const report = validated(`the shipped ${name} definition`, `--definition=${file}`);
    checks++;
    if (report) pinned(`the shipped ${name} definition`, report.warnings, []);

    const graph = resolved(`the shipped ${name} definition`, `--definition=${file}`);
    if (graph) {
      graphs.set(name, graph);
      checks++;
      if (JSON.stringify(graph.nodes.map(n => n.id)) !== JSON.stringify(pin.nodes)) {
        failures.push(`the shipped ${name} definition resolves to ${graph.nodes.map(n => n.id).join(', ')}`);
      }
      checks++;
      if (graph.graph_hash !== pin.hash) {
        failures.push(`the shipped ${name} definition hashes to ${graph.graph_hash}, not the pinned graph`);
      }
    }

    // The shipped synthetic twin, guarded by hash equality with the definition
    // it copies: an edit to either that the other does not receive moves the
    // hash, and nothing else in the suite compares the two. Its warning surface
    // is pinned in the same place: a twin that resolves to the right graph but
    // validates with a warning the definition does not carry is still drift.
    if (graph && pin.twin) {
      const twinFile = path.join(synthetic, pin.twin);
      checks++;
      if (!isFile(twinFile)) {
        failures.push(`${pin.twin}: the ${name} fixture twin is absent — a twin is the .yml, its .md prose companion and a manifest entry`);
      } else {
        const copy = resolved(pin.twin, `--definition=${twinFile}`);
        checks++;
        if (copy && copy.graph_hash !== graph.graph_hash) {
          failures.push(`${pin.twin} has drifted from the shipped ${name} definition (${copy.graph_hash} against ${graph.graph_hash})`);
        }
        const twinReport = validated(pin.twin, `--definition=${twinFile}`);
        checks++;
        if (twinReport) pinned(pin.twin, twinReport.warnings, []);
      }
    }

    // A gate's question and its option ids are part of what the hash covers: a
    // run frozen against one graph must not silently accept a definition that
    // asks a different question or answers it with different option ids.
    if (graph) {
      const original = fs.readFileSync(file, 'utf8');
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-contracts-graph-'));
      try {
        // `direct:` nodes resolve against the prose companion beside the file, so
        // the copy carries it too: the only difference under test is the edit.
        fs.copyFileSync(path.join(workflowsDir, `${name}.md`), path.join(scratch, `${name}.md`));
        for (const [label, from, to] of pin.edits) {
          checks++;
          const edited = original.replace(from, to);
          if (edited === original) {
            failures.push(`${name}: ${label}: the edit matched nothing in the definition`);
            continue;
          }
          const copy = path.join(scratch, `${name}.yml`);
          fs.writeFileSync(copy, edited, 'utf8');
          const out = resolved(`${name}: ${label}`, `--definition=${copy}`);
          checks++;
          if (out && out.graph_hash === graph.graph_hash) {
            failures.push(`${name}: ${label} does not move graph_hash — the canonical form does not cover it`);
          }
        }
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }

    // The shipped diagram is a pure function of the canonical graph: it is what
    // the verb renders today, byte for byte, or the committed file is stale.
    const golden = path.join(workflowsDir, `${name}.mmd`);
    checks++;
    const drawn = run('diagram', `--definition=${file}`);
    if (drawn.status !== 0) {
      failures.push(`diagram ${name}: exit ${drawn.status} — ${drawn.stderr.trim().split('\n')[0] ?? ''}`);
    } else if (!isFile(golden)) failures.push(`workflows/${name}.mmd: the golden diagram is absent`);
    else if (drawn.stdout !== fs.readFileSync(golden, 'utf8')) {
      failures.push(`workflows/${name}.mmd: the shipped diagram is not what the verb renders`);
    }

    // The two prohibitions every stop option depends on: no outcome clause, so
    // a stop terminates the run rather than routing on, and no reserved name.
    const doc = readDefinition(file).doc ?? {};
    checks++;
    const carriesOn = Object.entries(doc.nodes ?? {}).filter(([, node]) => node?.on !== undefined).map(([id]) => id);
    const writesOn = fs.readFileSync(file, 'utf8').split('\n').filter(l => /^\s+on:\s/.test(l));
    if (carriesOn.length || writesOn.length) {
      failures.push(`${name} carries an on: clause (${[...carriesOn, ...writesOn].join(' | ')})`);
    }

    checks++;
    const reservedNames = [];
    (function walkNames(value, prefix) {
      if (Array.isArray(value)) return value.forEach((v, i) => walkNames(v, prefix ? `${prefix}.${i}` : String(i)));
      if (!isObject(value)) return;
      for (const [key, child] of Object.entries(value)) {
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (RESERVED_PATHS.some(each => dotted === each || dotted.endsWith(`.${each}`))) reservedNames.push(dotted);
        walkNames(child, dotted);
      }
    })(doc, '');
    if (reservedNames.length) failures.push(`${name} names reserved paths: ${reservedNames.join(', ')}`);
  }

  // The overlay and lean-profile cases below are research's own.
  const builtin = definitions.find(each => each.name === RESEARCH)?.file ?? null;
  checks++;
  if (!builtin) {
    failures.push(`workflows/${RESEARCH}.yml is absent`);
    return { checks, failures, notes };
  }
  // A definition carries no profile map — profiles live on overlays — so the
  // lean route is compared against an eject of its own rather than against the
  // ten-node twin under a flag that twin cannot honour.
  for (const [label, flags, eject, count, hash] of [
    ['no profile', [], 'research-tuned.eject.yml', 10, TUNED_GRAPH_HASH],
    ['--profile=lean', ['--profile=lean'], 'research-tuned.lean.yml', 9, TUNED_LEAN_GRAPH_HASH],
  ]) {
    const overlaid = resolved(`${label}: the overlay route`,
      `--definition=${builtin}`, `--overlay=${path.join(tuned, 'research-tuned.overlay.yml')}`, ...flags);
    const ejected = resolved(`${label}: the eject route`, `--definition=${path.join(tuned, eject)}`);
    if (!overlaid || !ejected) continue;
    checks++;
    if (overlaid.nodes.length !== count || ejected.nodes.length !== count) {
      failures.push(`${label}: ${overlaid.nodes.length} and ${ejected.nodes.length} nodes, expected ${count}`);
    }
    checks++;
    if (overlaid.graph_hash !== ejected.graph_hash) {
      failures.push(`${label}: the hand-written eject has drifted from the overlay`);
    }
    checks++;
    if (overlaid.graph_hash !== hash) failures.push(`${label}: hashes to ${overlaid.graph_hash}, not the pinned graph`);
  }

  // The newer-format document degrades rather than being trimmed: the two keys
  // this reader knows nothing about survive into the canonical graph.
  const futureGraph = resolved('version-99.yml', `--definition=${path.join(synthetic, 'version-99.yml')}`);
  if (futureGraph) {
    checks++;
    if (!futureGraph.degraded.includes('newer-format')) {
      failures.push('version-99.yml: resolve did not mark the graph newer-format');
    }
    for (const [id, key] of [['plan', 'budget'], ['build', 'retry_policy']]) {
      checks++;
      const node = futureGraph.nodes.find(n => n.id === id);
      if (!isObject(node?.[key])) {
        failures.push(`version-99.yml: resolve dropped the unknown \`${key}\` key from ${id}`);
      }
    }
  }

  // -- diagram: a pure function of the canonical graph, byte-for-byte --------
  const rich = resolveGraph({ definition: readDefinition(path.join(synthetic, 'richtext.yml')), overlays: [], profile: null, degraded: [] });
  const expected = render(rich);
  checks++;
  const again = run('diagram', `--definition=${path.join(synthetic, 'richtext.yml')}`);
  if (again.stdout !== expected) failures.push('diagram: the verb and the module render different bytes');

  // The renderer fixes its own key order: scrambling the canonical form's key
  // insertion order must move no byte, or it is iterating something upstream.
  const reverseKeys = value => {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = value[key];
    return out;
  };
  const scrambled = reverseKeys(rich);
  scrambled.nodes = rich.nodes.map(reverseKeys);
  checks++;
  if (render(scrambled) !== expected) failures.push('diagram: the rendering depends on upstream key order');
  checks++;
  if (render(rich) !== expected) failures.push('diagram: rendering the same object twice disagreed');

  // A gate, a conditional node and a plain task must be tellable apart.
  const lineFor = id => expected.split('\n').find(l => l.includes(`"${id}`)) ?? '';
  const shape = line => line.trim().replace(/"[^"]*"/g, '"…"');
  checks++;
  const [task, gate, conditional] = ['research', 'approve', 'dev-beta'].map(lineFor);
  if (new Set([shape(task), shape(gate), shape(conditional)]).size !== 3) {
    failures.push('diagram: a gate, a conditional node and a plain task do not render distinguishably');
  }
  checks++;
  if (!conditional.includes('!${inputs.skip_beta}')) failures.push('diagram: the when expression is not rendered');
  checks++;
  if (!/^\s*class .*\bgate\b/m.test(expected) || !/^\s*class .*\bconditional\b/m.test(expected)) {
    failures.push('diagram: gate and conditional nodes carry no class statement');
  }

  // -- the literals no shipped engine file may carry ------------------------
  for (const file of ['scripts/workflow.mjs', 'scripts/lib/definition.mjs', 'scripts/lib/graph.mjs',
    'scripts/lib/diagram.mjs', 'scripts/lib/state.mjs']) {
    checks++;
    const text = fs.readFileSync(path.join(engine, file), 'utf8');
    const hit = FORBIDDEN_LITERALS.find(pattern => pattern.test(text));
    if (hit) failures.push(`${ENGINE}/${file}: carries ${hit}`);
  }

  // -- one quoting rule, both halves of it ----------------------------------
  //
  // A key is unquoted by the same function that unquotes a value. They used to
  // differ: the key half stripped the outer pair and stopped while the value
  // half decoded the closed escape list and undid `''` doubling, so one file
  // could spell one string two ways and get two different keys out.
  for (const [label, text, want] of [
    ['a doubled single quote in a key', "name: q\nversion: 1\n'it''s': yes\n", "it's"],
    ['an escape in a key', 'name: q\nversion: 1\n"a\\tb": yes\n', 'a\tb'],
  ]) {
    checks++;
    const parsed = parseDefinition(text, 'quoting.yml');
    if (parsed.errors.length) {
      failures.push(`${label}: the reader rejected it — ${JSON.stringify(parsed.errors[0])}`);
      continue;
    }
    checks++;
    if (!Object.prototype.hasOwnProperty.call(parsed.doc, want)) {
      failures.push(`${label}: the key came back as ${JSON.stringify(Object.keys(parsed.doc))}`);
    }
  }

  // -- the degraded branch: one code path, and no error collected then dropped -
  //
  // A document declaring a format this build does not know skips the v1 checks
  // and nothing else. The structural pass still runs, still finds a nodes: that
  // is not a mapping and an overlay operation naming a node the base does not
  // declare, and every verb has to give the same answer about it — the branch
  // used to return ok from validate without loading the graph module at all.
  const degradedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-contracts-degraded-'));
  try {
    const write = (name, text) => {
      const file = path.join(degradedDir, name);
      fs.writeFileSync(file, text, 'utf8');
      return file;
    };

    const broken = write('broken.yml', 'name: newer\nversion: 99\nnodes: "this is not a mapping"\n');
    const verbs = ['validate', 'resolve', 'diagram'].map(verb => [verb, run(verb, `--definition=${broken}`)]);
    checks++;
    const statuses = verbs.map(([, out]) => out.status);
    if (new Set(statuses).size !== 1 || statuses[0] === 0) {
      failures.push(`degraded: the verbs disagree on a malformed newer-format definition — ${verbs.map(([v, o]) => `${v}=${o.status}`).join(' ')}`);
    }
    checks++;
    const brokenReport = verbs[0][1].report;
    if (!brokenReport || brokenReport.ok !== false || !(brokenReport.errors ?? []).length) {
      failures.push('degraded: validate reported no errors for a definition resolve rejects');
    }
    checks++;
    if (!(brokenReport?.degraded ?? []).length) failures.push('degraded: validate dropped the degraded marker');

    const base = write('base.yml', 'name: base\nversion: 99\nnodes:\n  alpha:\n    uses: direct:alpha\n    needs: []\n');
    const overlay = write('over.overlay.yml', `extends: ${base}\nversion: 99\ndisable: [nosuchnode]\n`);
    const disabled = ['validate', 'resolve'].map(verb => [verb, run(verb, `--definition=${base}`, `--overlay=${overlay}`)]);
    checks++;
    if (disabled.some(([, out]) => out.status === 0)) {
      failures.push('degraded: a disable naming a node the base does not declare was silently ignored');
    }
    checks++;
    if (!JSON.stringify(disabled[1][1].report?.errors ?? []).includes('nosuchnode')) {
      failures.push('degraded: resolve collected the disable error and then dropped it');
    }
    checks++;
    if (disabled[0][1].status !== disabled[1][1].status) {
      failures.push(`degraded: validate=${disabled[0][1].status} resolve=${disabled[1][1].status} on one overlay`);
    }

    // The accept half of the same branch: a newer document this build can fold
    // is still accepted, degraded, by all three verbs. The fix must not have
    // turned degradation into rejection.
    const sound = write('sound.yml', 'name: sound\nversion: 99\nnodes:\n  alpha:\n    uses: direct:alpha\n    needs: []\n');
    checks++;
    const soundOut = run('validate', `--definition=${sound}`);
    if (soundOut.status !== 0 || soundOut.report?.ok !== true || !(soundOut.report?.degraded ?? []).length) {
      failures.push(`degraded: a foldable newer-format definition is no longer accepted — ${JSON.stringify(soundOut.report)}`);
    }

    // -- a decoded escape may not manufacture a value the writer refuses ------
    //
    // The reader decodes \\n, \\t and \\r, which is right for the reader and hands
    // the run a value the one-line state writer is required to refuse. Caught
    // at validate time, the run fails before it starts; caught at run time, it
    // fails mid-graph with nodes already recorded as completed.
    for (const [label, escaped] of [['a tab', 'a\\tb'], ['a return', 'docs\\reports']]) {
      const file = write(`escape-${label.split(' ')[1]}.yml`,
        `name: esc\nversion: 1\ninputs: {}\nnodes:\n  alpha:\n    uses: agent:research-synthesizer\n    needs: []\n    with:\n      dir: "${escaped}"\n`);
      const out = run('validate', `--definition=${file}`);
      checks++;
      if (out.status === 0) {
        failures.push(`${label}: validate accepted a value the state writer must refuse`);
        continue;
      }
      checks++;
      if (!(out.report?.errors ?? []).some(e => /newline|return|tab/i.test(e.message ?? ''))) {
        failures.push(`${label}: the rejection does not name the character — ${JSON.stringify(out.report?.errors)}`);
      }
    }
  } finally {
    fs.rmSync(degradedDir, { recursive: true, force: true });
  }

  notes.push(`${definitions.length} shipped definition(s) walked: ${definitions
    .map(each => `${each.name} ${(graphs.get(each.name)?.graph_hash ?? '—').slice(0, 8)}…`).join(', ')}`);
  notes.push(`${Object.values(WORKFLOW_PINS).filter(pin => pin.twin).length} synthetic twin(s) compared; the two overlay routes hash to ${TUNED_GRAPH_HASH.slice(0, 8)}… and ${TUNED_LEAN_GRAPH_HASH.slice(0, 8)}…`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T30 — workflow state writer
// ---------------------------------------------------------------------------

const CHAIN_TEMPLATE_STATE = path.join('synthetic', 'gate', 'chain-template', 'orchestrator-state.yml');
const WIDE_INDENT_STATE_FILE = path.join(WIDE_INDENT_STATE, 'orchestrator-state.yml');

/** A flow-map position tolerates none of these, and the writer must say so. */
const NOT_FLOW_SAFE = ['a "quoted" word', 'two\nlines', 'a\rreturn'];

/**
 * The smallest state file the writer accepts, hand-written rather than copied
 * from a fixture: the refusal cases below mutate one line of it each, and a
 * fixture that grew a field would silently change what they are testing.
 */
const BASE_STATE = `orchestrator:
  created: 2026-08-26T00:00:00Z
  updated: 2026-08-26T00:00:00Z
  task_path: .maister/tasks/research/x
  gate_pending: null

task:
  title: T
  status: in_progress

workflow:
  source: research.yml
  name: research
  nodes:
    alpha: {kind: phase, status: pending}
`;

async function t30(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const engine = path.join(ctx.pluginRoot, ENGINE);
  const entry = path.join(engine, 'scripts', 'workflow.mjs');
  checks++;
  if (!isFile(entry)) return { checks, failures: [`${ENGINE}/scripts/workflow.mjs is absent`] };

  // `gate-lib.mjs` is the acceptance oracle: the writer is the inverse of the
  // reader a consumer's hook actually runs, so the reader judges the writer.
  const { writeState } = await import(pathToFileURL(path.join(engine, 'scripts', 'lib', 'state.mjs')).href);
  const { scanState } = await import(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-contracts-state-'));
  let counter = 0;
  /** A copy of a frozen fixture, under a scratch root. Never the original. */
  const subject = fixture => {
    const dir = path.join(scratch, `state-${counter++}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'orchestrator-state.yml');
    fs.copyFileSync(path.join(ctx.fixtures, fixture), file);
    return file;
  };
  const canonical = () => subject(CHAIN_TEMPLATE_STATE);

  /** Every text this test emitted, so the two-reader check can judge them all. */
  const emitted = [];
  const write = (file, patch) => {
    const result = writeState({ state: file, patch });
    if (result.ok) emitted.push({ file, text: fs.readFileSync(file, 'utf8') });
    return result;
  };

  const now = Date.now();
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  try {
    // -- preservation: keys, values, ordering, comments and untouched bytes --
    const kept = canonical();
    fs.writeFileSync(kept, fs.readFileSync(kept, 'utf8').replace(
      'task:\n', '# a hand-written note above task:\ntask:\n  reviewer: someone   # kept verbatim\n'), 'utf8');
    const before = fs.readFileSync(kept, 'utf8').split('\n');
    checks++;
    const surgical = write(kept, { nodes: { research: { status: 'running' } } });
    if (!surgical.ok) {
      failures.push(`the surgical write was refused: ${JSON.stringify(surgical.errors)}`);
    } else {
      const after = fs.readFileSync(kept, 'utf8').split('\n');
      const touched = before.map((line, i) => (line === after[i] ? -1 : i)).filter(i => i >= 0);
      checks++;
      if (after.length !== before.length || touched.length !== 2) {
        failures.push(`a surgical write moved ${touched.length} lines, expected exactly two`);
      } else if (!after[touched[0]].trimStart().startsWith('updated:')
        || !after[touched[1]].trimStart().startsWith('research:')) {
        failures.push('the two changed lines are not orchestrator.updated and the node entry');
      }
      checks++;
      if (!after.includes('# a hand-written note above task:') || !after.includes('  reviewer: someone   # kept verbatim')) {
        failures.push('a whole-line comment or an unknown key did not survive the write');
      }
      checks++;
      const order = after.filter(l => /^[A-Za-z_]/.test(l)).map(l => l.split(':')[0]);
      if (JSON.stringify(order) !== JSON.stringify(['orchestrator', 'task', 'workflow', 'node_summaries'])) {
        failures.push(`the section order came back as ${order.join(', ')}`);
      }
    }

    // -- atomicity: the two refusals that leave the file alone ---------------
    const nodeless = canonical();
    const nodelessBefore = fs.readFileSync(nodeless, 'utf8');
    checks++;
    const noNodes = writeState({ state: nodeless, patch: { workflow: { source: 'builtin:research', grammar_version: 1 } } });
    if (noNodes.ok || !/nodes/.test(noNodes.errors[0]?.message ?? '')
      || fs.readFileSync(nodeless, 'utf8') !== nodelessBefore) {
      failures.push('a workflow block with no nodes was not refused cleanly');
    }

    const taskless = canonical();
    fs.writeFileSync(taskless, 'orchestrator:\n  gate_pending: null\n', 'utf8');
    checks++;
    const noTask = writeState({
      state: taskless,
      patch: { workflow: { source: 'builtin:research', nodes: { alpha: { kind: 'task', status: 'pending' } } } },
    });
    if (noTask.ok || !/task/.test(noTask.errors[0]?.message ?? '')
      || fs.readFileSync(taskless, 'utf8') !== 'orchestrator:\n  gate_pending: null\n') {
      failures.push('installing a workflow block into a state with no task block was not refused cleanly');
    }

    // -- flow-safety: a quote, a newline or a carriage return is a refusal ---
    for (const bad of NOT_FLOW_SAFE) {
      const file = canonical();
      const text = fs.readFileSync(file, 'utf8');
      checks++;
      const result = writeState({ state: file, patch: { nodes: { research: { values: { note: bad } } } } });
      if (result.ok || !/value-not-flow-safe/.test(result.errors[0]?.message ?? '')) {
        failures.push(`${JSON.stringify(bad)}: expected a value-not-flow-safe refusal`);
      }
      checks++;
      if (fs.readFileSync(file, 'utf8') !== text
        || isFile(path.join(path.dirname(file), 'orchestrator-state.yml.tmp'))) {
        failures.push(`${JSON.stringify(bad)}: a refused write did not leave the directory alone`);
      }
    }
    checks++;
    const spawned = runBounded(process.execPath, [entry, 'write-state', `--state=${canonical()}`], {
      encoding: 'utf8',
      input: JSON.stringify({ nodes: { research: { values: { note: 'a "quoted" word' } } } }),
    });
    if (spawned.status !== 1) failures.push(`write-state exited ${spawned.status} on a refusal, expected 1`);

    // -- canonical indents: 0 / 2 / 4, and +2 per level ----------------------
    const indented = canonical();
    checks++;
    const installed = write(indented, {
      workflow: {
        source: 'builtin:research',
        overlays: [],
        profile: 'default',
        graph_hash: `sha256:${'a'.repeat(64)}`,
        grammar_version: 1,
        name: 'research',
        nodes: {
          'research-foundation': { kind: 'task', status: 'pending', needs: [] },
          'foundation-approval': { kind: 'gate', status: 'pending', needs: ['research-foundation'] },
        },
      },
      node_summaries: { 'research-foundation': { summary: 'a prose line', artifacts: { report: 'a/b.md' } } },
      phase_summaries: { 'phase-1': { summary: 'a prose line', decision_areas: [{ area: 'x', chosen: 'y' }] } },
      context: { question: 'what shape should the engine take' },
      task: { status: 'in_progress' },
    });
    if (!installed.ok) {
      failures.push(`installing a workflow block was refused: ${JSON.stringify(installed.errors)}`);
    } else {
      const lines = fs.readFileSync(indented, 'utf8').split('\n').filter(l => l.trim() !== '');
      checks++;
      const odd = lines.find(l => (l.length - l.trimStart().length) % 2 !== 0);
      if (odd) failures.push(`an odd indent was emitted: "${odd}"`);
      checks++;
      const wrongDepth = lines.filter(l => /^\s+(research-foundation|foundation-approval): \{/.test(l))
        .find(l => l.length - l.trimStart().length !== 4);
      if (!lines.includes('workflow:') || !lines.includes('  nodes:') || wrongDepth) {
        failures.push('the canonical 0 / 2 / 4 indents were not emitted exactly');
      }
      checks++;
      if (!lines.includes('  phase_summaries:') || !lines.some(l => /^ {4}phase-1:$/.test(l))
        || !lines.some(l => /^ {6}summary: /.test(l))) {
        failures.push('a nested block did not gain two spaces per level');
      }
    }

    // -- timestamps: full UTC date and time, from the clock, never midnight --
    const stamped = canonical();
    checks++;
    const timed = write(stamped, { nodes: { research: { status: 'running' }, approve: { status: 'completed' } } });
    if (!timed.ok) {
      failures.push(`the timestamped write was refused: ${JSON.stringify(timed.errors)}`);
    } else {
      const text = fs.readFileSync(stamped, 'utf8');
      const nodes = scanState(text).nodes;
      const midnightNow = new Date(now).toISOString().slice(11, 19) < '00:02:00';
      for (const stamp of [nodes.research?.started, nodes.approve?.completed, /^ {2}updated: "([^"]+)"/m.exec(text)?.[1]]) {
        checks++;
        if (!stamp || !TIMESTAMP.test(stamp)) failures.push(`${stamp}: not a full UTC date and time`);
        else if (Math.abs(Date.parse(stamp) - now) >= 120_000) failures.push(`${stamp}: not from the system clock`);
        else if (!midnightNow && stamp.endsWith('T00:00:00Z')) failures.push(`${stamp}: midnight`);
      }
      checks++;
      if (nodes.approve?.started !== undefined) failures.push('a completed node with no start was invented one');
    }

    // -- no consulted line carries a trailing comment ------------------------
    checks++;
    if (emitted.length < 3) failures.push(`only ${emitted.length} files were emitted; the writes above did not run`);
    for (const { file, text } of emitted) {
      let section = null;
      let inNodes = false;
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        if (/^[A-Za-z_]/.test(line)) { section = line.split(':')[0]; inNodes = false; continue; }
        if (section === 'workflow' && /^ {2}[A-Za-z_]/.test(line)) { inNodes = line.startsWith('  nodes:'); continue; }
        const consulted = (section === 'orchestrator' && line.startsWith('  gate_pending:')) || (inNodes && /^ {4}\S/.test(line));
        if (!consulted) continue;
        checks++;
        if (/#/.test(line)) failures.push(`${rel(file)}: a consulted line carries a comment: "${line}"`);
        else if (inNodes && !line.trimEnd().endsWith('}')) failures.push(`${rel(file)}: a node entry runs past its flow map: "${line}"`);
        else if (!inNodes && line.trimEnd() !== '  gate_pending: null') {
          failures.push(`${rel(file)}: gate_pending is not the literal null: "${line}"`);
        }
      }
    }

    // -- the wide-indent copy: normalized whole, or refused, never mixed -----
    const widened = subject(WIDE_INDENT_STATE_FILE);
    const wideBefore = fs.readFileSync(widened, 'utf8');
    checks++;
    const normalized = write(widened, { nodes: { dev: { status: 'running' } } });
    if (!normalized.ok) {
      checks++;
      if (!/state-non-canonical/.test(normalized.errors[0]?.message ?? '')
        || fs.readFileSync(widened, 'utf8') !== wideBefore) {
        failures.push('the wide-indent refusal is not a clean state-non-canonical that writes nothing');
      }
      notes.push('the writer refuses the wide-indent state with state-non-canonical rather than normalizing it');
    } else {
      const text = fs.readFileSync(widened, 'utf8');
      checks++;
      const stray = text.split('\n').filter(l => l.trim() !== '')
        .find(l => (l.length - l.trimStart().length) % 2 !== 0);
      if (stray) failures.push(`a stray indent survived normalization: "${stray}"`);
      checks++;
      const shape = t => t.split('\n').filter(l => l.trim() !== '' && !l.trimStart().startsWith('#'))
        .map(l => l.trimStart().split(':')[0]);
      if (JSON.stringify(shape(text)) !== JSON.stringify(shape(wideBefore))) {
        failures.push('normalization changed more than leading whitespace');
      }
      checks++;
      let inNodes = false;
      for (const line of text.split('\n')) {
        if (/^[A-Za-z_]/.test(line)) { inNodes = false; continue; }
        if (/^ {2}[A-Za-z_]/.test(line)) { inNodes = line.startsWith('  nodes:'); continue; }
        if (inNodes && line.trimStart().startsWith('#')) failures.push(`a comment survived inside nodes: "${line}"`);
      }
      notes.push('the writer normalizes the wide-indent state whole rather than refusing it');
    }

    // -- both readers agree on every emitted file, with a non-empty node map --
    checks++;
    if (emitted.length < 3) failures.push('too few emitted files to judge the two readers against each other');
    for (const { file, text } of emitted) {
      checks++;
      let hook = null;
      let suite = null;
      try { hook = scanState(text); } catch (err) { failures.push(`${rel(file)}: the hook reader threw ${err.message}`); }
      try { suite = scanStateText(text); } catch (err) { failures.push(`${rel(file)}: the suite reader threw ${err.message}`); }
      if (!hook || !suite) continue;
      checks++;
      if (hook.hasWorkflow !== suite.hasWorkflow || hook.hasNodes !== suite.hasNodes || hook.hasTask !== suite.hasTask
        || JSON.stringify(hook.gatePending) !== JSON.stringify(suite.gatePending)
        || JSON.stringify(hook.nodes) !== JSON.stringify(suite.nodes)) {
        failures.push(`${rel(file)}: the two readers disagree`);
      }
      checks++;
      if (Object.keys(hook.nodes).length === 0) failures.push(`${rel(file)}: the node map is empty — a blocked session`);
      checks++;
      if (!(hook.hasWorkflow && hook.hasNodes && hook.hasTask)) failures.push(`${rel(file)}: an incomplete state file`);
      // Both readers above are line-oriented, and both ignore whole blocks —
      // `node_summaries` among them — so a duplicated top-level key or an
      // injected second `workflow:` passes them both while a real parser
      // rejects the file. The suite may use the `yaml` devDependency where the
      // shipped code may not, so it is the third reader here.
      checks++;
      let parsed = null;
      try { parsed = parseYaml(text, YAML_OPTS); } catch (err) {
        failures.push(`${rel(file)}: a real YAML parser rejects the emitted file — ${err.message.split('\n')[0]}`);
      }
      if (parsed === null) continue;
      checks++;
      if (!isObject(parsed)) failures.push(`${rel(file)}: the emitted file is not a mapping`);
      else if (!isObject(parsed.workflow?.nodes) || !isObject(parsed.orchestrator) || !isObject(parsed.task)) {
        failures.push(`${rel(file)}: the parsed document is missing workflow.nodes, orchestrator or task`);
      }
    }

    // -- the refusal paths: one reproduced critical and four warnings --------
    // Every case below is a path where the writer once reported success (or
    // exited 2) while leaving a file no real reader accepts. What is asserted
    // is not "the write failed" but "the write refused, in the documented
    // vocabulary, with the file on disk byte-for-byte unchanged".
    const expect = (label, fn) => {
      checks++;
      try { fn(); } catch (err) { failures.push(`${label}: ${err.message}`); }
    };
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const stateSrc = path.join(engine, 'scripts', 'lib', 'state.mjs');
    const read = f => fs.readFileSync(f, 'utf8');
    const refusal = result => (result.errors[0] ?? {}).code;
    let handWritten = 0;
    /** A run directory holding `text`, under the scratch root. */
    const state = (text = BASE_STATE) => {
      const dir = path.join(scratch, `hand-${handWritten++}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'orchestrator-state.yml');
      fs.writeFileSync(file, text, 'utf8');
      return file;
    };

    // A block-path map key carrying a newline once injected whole lines into
    // the file while the write reported success — a second top-level
    // `workflow:` block that both line readers accept and no parser does.
    const INJECT = 'a: evil\nworkflow:\n  nodes: {}\nbogus';

    expect('a top-level block key carrying a newline is emitted rather than refused', () => {
      const file = state();
      const before = read(file);
      const res = writeState({ state: file, patch: { node_summaries: { [INJECT]: { note: 'x' } } } });
      assert(res.ok === false, 'the write reported success on an injecting key');
      assert(refusal(res) === 'state-patch-invalid', `expected state-patch-invalid, got ${refusal(res)}`);
      assert(res.errors[0].message.includes('evil'), 'the refusal does not name the offending key');
      assert(res.changed.length === 0, 'a refusal reported changed paths');
      assert(read(file) === before, 'the file on disk changed despite the refusal');
    });

    expect('a nested block key carrying a newline is not refused', () => {
      const file = state();
      const before = read(file);
      const nested = 'outcome: x\nworkflow: {}';
      const res = writeState({ state: file, patch: { node_summaries: { a: { [nested]: 'y' } } } });
      assert(res.ok === false, 'the write reported success on a nested injecting key');
      assert(refusal(res) === 'state-patch-invalid', `expected state-patch-invalid, got ${refusal(res)}`);
      assert(read(file) === before, 'the file on disk changed despite the refusal');
    });

    expect('the key guard does not cover the context and phase_summaries paths', () => {
      for (const key of ['context', 'phase_summaries']) {
        const file = state();
        const patch = key === 'context'
          ? { context: { [INJECT]: 'x' } }
          : { phase_summaries: { [INJECT]: { summary: 'x' } } };
        const res = writeState({ state: file, patch });
        assert(res.ok === false && refusal(res) === 'state-patch-invalid',
          `${key}: expected state-patch-invalid, got ${res.ok ? 'ok' : refusal(res)}`);
      }
    });

    expect('a prose-looking key carrying a colon corrupts the file silently', () => {
      const file = state();
      const res = writeState({ state: file, patch: { node_summaries: { 'design: draft': { note: 'x' } } } });
      assert(res.ok === false, 'a key containing ": " was accepted');
      assert(refusal(res) === 'state-patch-invalid', `expected state-patch-invalid, got ${refusal(res)}`);
    });

    expect('the guard also blocks ordinary block keys', () => {
      const file = state();
      const res = writeState({
        state: file,
        patch: { node_summaries: { a: { summary: 'done', decisions: ['x'] } }, context: { 'doc-paths': ['a/b.md'] } },
      });
      assert(res.ok === true, `an ordinary patch was refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      assert(/^node_summaries:$/m.test(text), 'node_summaries was not written');
      assert(/^ {4}summary: done$/m.test(text), 'the summary entry was not written at the canonical indent');
      assert(/doc-paths:/.test(text), 'the context key was not written');
    });

    // White-box: the key guard is the fix and the pre-publish self-check is the
    // net under it. Neutering the guard in a copy of the module proves the two
    // defences independently rather than as one.
    const noGuard = await (async () => {
      const copy = path.join(scratch, 'state-noguard.mjs');
      const src = fs.readFileSync(stateSrc, 'utf8')
        .replace(/'\.\.\/\.\.\/\.\.\/\.\.\/hooks\/gate-lib\.mjs'/,
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href));
      const patched = src.replace(/^const BLOCK_KEY = .*$/m, 'const BLOCK_KEY = /[\\s\\S]*/;');
      if (patched === src) return null;
      fs.writeFileSync(copy, patched, 'utf8');
      return import(pathToFileURL(copy));
    })();

    expect('with the key guard neutered the injection publishes', () => {
      assert(noGuard, 'no BLOCK_KEY guard constant found to neuter — the guard must be a named regex');
      const file = state();
      const before = read(file);
      const res = noGuard.writeState({ state: file, patch: { node_summaries: { [INJECT]: { note: 'x' } } } });
      assert(res.ok === false, 'with the guard neutered the injection published — the self-check does not catch it');
      assert(refusal(res) === 'state-candidate-unsound', `expected state-candidate-unsound, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the self-check refusal');
    });

    expect('a malformed existing node line throws instead of refusing', () => {
      const file = state(BASE_STATE.replace('    alpha: {kind: phase, status: pending}', '    alpha: not-a-flow-map'));
      const before = read(file);
      let res;
      try {
        res = writeState({ state: file, patch: { nodes: { alpha: { status: 'running' } } } });
      } catch (err) {
        throw new Error(`the writer threw instead of refusing: ${err.message}`);
      }
      assert(res.ok === false, 'a malformed existing node line was accepted');
      assert(refusal(res) === 'state-unreadable', `expected state-unreadable, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the refusal');
    });

    expect('an unserializable existing entry reports the patch code', () => {
      const bad = '    alpha: {kind: phase, status: pending, note: "he said ""hi"""}';
      const file = state(BASE_STATE.replace('    alpha: {kind: phase, status: pending}', bad));
      const res = writeState({ state: file, patch: { nodes: { alpha: { status: 'running' } } } });
      assert(res.ok === false, 'an unserialisable existing entry was accepted');
      assert(refusal(res) !== 'value-not-flow-safe',
        'the existing-entry fault still reports value-not-flow-safe, whose documented recovery loops');
      assert(refusal(res) === 'state-entry-unserializable', `expected state-entry-unserializable, got ${refusal(res)}`);
    });

    expect('a genuinely unsafe patch value no longer reports value-not-flow-safe', () => {
      const file = state();
      const res = writeState({ state: file, patch: { nodes: { alpha: { status: 'running', note: 'has "quote"' } } } });
      assert(res.ok === false && refusal(res) === 'value-not-flow-safe',
        `expected value-not-flow-safe, got ${res.ok ? 'ok' : refusal(res)}`);
    });

    expect('the context block is hardcoded to research_context', () => {
      const file = state(BASE_STATE.replace('  name: research', '  name: product-design'));
      const res = writeState({
        state: file,
        patch: { context: { scope_decision: 'narrow' }, phase_summaries: { 'phase-1': { summary: 'x' } } },
      });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      assert(/^design_context:$/m.test(text), 'the summaries did not land under design_context');
      assert(!/research_context/.test(text), 'research_context was written for a design workflow');
      assert(res.changed.some(p => p.startsWith('design_context.')),
        `changed paths still name the wrong block: ${res.changed.join(', ')}`);
    });

    expect('the research workflow no longer writes research_context', () => {
      const file = state();
      const res = writeState({ state: file, patch: { phase_summaries: { 'phase-1': { summary: 'x' } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      assert(/^research_context:$/m.test(text), 'research_context regressed');
      assert(/^ {2}phase_summaries:$/m.test(text), 'phase_summaries is not a direct child of the context block');
      assert(/^ {6}summary: x$/m.test(text), 'the phase summary is not at the canonical indent');
    });

    expect('an undeterminable context block defaults instead of refusing', () => {
      const file = state(BASE_STATE.replace('  name: research\n', ''));
      const before = read(file);
      const res = writeState({ state: file, patch: { context: { k: 'v' } } });
      assert(res.ok === false, 'the writer defaulted to a block instead of refusing');
      assert(refusal(res) === 'state-context-block-unknown', `expected state-context-block-unknown, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the refusal');
    });

    expect('an existing context block is ignored when the name gives none', () => {
      const file = state(`${BASE_STATE.replace('  name: research\n', '')}\nmigration_context:\n  phase_summaries: {}\n`);
      const res = writeState({ state: file, patch: { phase_summaries: { 'phase-1': { summary: 'x' } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(/^migration_context:$/m.test(read(file)), 'the existing block was not adopted');
      assert(!/research_context/.test(read(file)), 'research_context was written beside an existing block');
    });

    expect('a pre-existing temp file is clobbered', () => {
      const file = state();
      const tmp = path.join(path.dirname(file), 'orchestrator-state.yml.tmp');
      fs.writeFileSync(tmp, 'other writer bytes\n', 'utf8');
      const before = read(file);
      const res = writeState({ state: file, patch: { task: { status: 'completed' } } });
      assert(res.ok === false, "the write clobbered a concurrent writer's temp file");
      assert(refusal(res) === 'state-temp-exists', `expected state-temp-exists, got ${refusal(res)}`);
      assert(read(tmp) === 'other writer bytes\n', "the other writer's temp bytes were destroyed");
      assert(read(file) === before, 'the state file changed despite the refusal');
    });

    expect('the temp name drifted or the write does not fsync before renaming', () => {
      const src = fs.readFileSync(stateSrc, 'utf8');
      assert(/const TMP_NAME = 'orchestrator-state\.yml\.tmp';/.test(src), 'the frozen temp name changed');
      assert(/openSync\(\s*tmp,\s*'wx'\s*\)/.test(src), 'the temp file is not opened exclusively');
      assert(/fsyncSync\(/.test(src), 'the temp file is not fsynced before the rename');
    });

    expect('a normal write leaves its temp file behind', () => {
      const file = state();
      const res = writeState({ state: file, patch: { task: { status: 'completed' } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(!fs.existsSync(path.join(path.dirname(file), 'orchestrator-state.yml.tmp')), 'the temp file survived');
      assert(/^ {2}status: completed$/m.test(read(file)), 'the write did not land');
    });

    // -- the same injection class, one column in ------------------------------
    //
    // The guard was added to the two block emitters and not to the workflow
    // block's own key loops, which emit at column 2. A key carrying a newline
    // there does not produce a bad-looking file: it produces a second nodes:
    // child that no YAML parser accepts, and under it a node no graph ever
    // declared, recorded completed — read back by the ready set and by
    // continue-from-stop, through the success path.
    const FORGED = 'junk: 1\n  nodes:\n    ghost';
    const forgedPatch = () => ({
      workflow: { nodes: { alpha: { status: 'pending' } }, [FORGED]: '{status: completed}' },
    });

    expect('a workflow-block key carrying a newline forges a node', () => {
      const file = state();
      const before = read(file);
      const res = writeState({ state: file, patch: forgedPatch() });
      assert(res.ok === false, 'the write reported success on an injecting workflow key');
      assert(refusal(res) === 'state-patch-invalid', `expected state-patch-invalid, got ${refusal(res)}`);
      assert(res.changed.length === 0, 'a refusal reported changed paths');
      assert(read(file) === before, 'the file on disk changed despite the refusal');
      const scanned = scanState(read(file));
      assert(!Object.prototype.hasOwnProperty.call(scanned.nodes, 'ghost'),
        'a node no graph declares is readable in the state file');
    });

    expect('the structural check does not look past column 0', () => {
      assert(noGuard, 'no BLOCK_KEY guard constant found to neuter');
      const file = state();
      const before = read(file);
      const res = noGuard.writeState({ state: file, patch: forgedPatch() });
      assert(res.ok === false, 'with the guard neutered the forged node published');
      assert(refusal(res) === 'state-candidate-unsound', `expected state-candidate-unsound, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the self-check refusal');
    });

    expect('a duplicate key below column 0 is accepted', () => {
      assert(noGuard, 'no BLOCK_KEY guard constant found to neuter');
      const file = state();
      const before = read(file);
      // Emitted at column 4, inside one summary entry: summary: one, then the
      // injected lines, then summary: two. Two siblings of one name, four
      // columns in, which the column-0 walk never looked at.
      const res = noGuard.writeState({
        state: file,
        patch: { node_summaries: { alpha: { summary: 'one', ['x: 1\n    summary']: 'two' } } },
      });
      assert(res.ok === false, 'a duplicate key four columns in published');
      assert(refusal(res) === 'state-candidate-unsound', `expected state-candidate-unsound, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the self-check refusal');
    });

    expect('a node entry field name is emitted raw and unguarded', () => {
      const file = state();
      const before = read(file);
      const patch = JSON.parse('{"nodes":{"alpha":{"status":"running","x}, forged: {y":"z"}}}');
      const res = writeState({ state: file, patch });
      assert(res.ok === false, 'a field name that closes the flow map was accepted');
      assert(refusal(res) === 'value-not-flow-safe', `expected value-not-flow-safe, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the refusal');
    });

    // -- the two node-id patterns, and the map the hook builds from them ------

    expect('the writer and the graph disagree about what a node id is', () => {
      const writer = /^const NODE_ID = (.*);$/m.exec(fs.readFileSync(stateSrc, 'utf8'));
      const graphSrc = /^const NODE_ID = (.*);$/m.exec(
        fs.readFileSync(path.join(engine, 'scripts', 'lib', 'graph.mjs'), 'utf8'));
      assert(writer && graphSrc, 'one of the two NODE_ID constants is gone');
      assert(writer[1] === graphSrc[1],
        `the writer accepts ${writer[1]} while the graph accepts ${graphSrc[1]}; the looser one takes stdin`);
    });

    expect('a __proto__ node id reaches the file', () => {
      const file = state();
      const before = read(file);
      // Parsed rather than written as a literal: in an object literal
      // `__proto__` sets the prototype, while the CLI's own JSON.parse of stdin
      // makes it the own key the writer actually receives.
      const patch = JSON.parse('{"nodes":{"__proto__":{"status":"running"}}}');
      const res = writeState({ state: file, patch });
      assert(res.ok === false, 'the writer accepted a __proto__ node id');
      assert(refusal(res) === 'state-patch-invalid', `expected state-patch-invalid, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the refusal');
    });

    expect("the hook reader's node map is prototype-polluted by a __proto__ entry", () => {
      const text = BASE_STATE.replace('    alpha: {kind: phase, status: pending}',
        '    alpha: {kind: phase, status: pending}\n    __proto__: {status: running}');
      const scanned = scanState(text);
      assert(Object.getPrototypeOf(scanned.nodes) === null, 'the node map is a plain object');
      assert(Object.keys(scanned.nodes).length === 2,
        `a node is invisible to Object.keys — the map every caller counts (got ${Object.keys(scanned.nodes).length})`);
    });

    // -- the temp file: exclusive, and recoverable in band --------------------

    expect('a temp left by a crash blocks every later write forever', () => {
      const file = state();
      const tmp = path.join(path.dirname(file), 'orchestrator-state.yml.tmp');
      fs.writeFileSync(tmp, 'bytes a crashed writer left behind\n', 'utf8');
      const old = Date.now() / 1000 - 3600;
      fs.utimesSync(tmp, old, old);
      const res = writeState({ state: file, patch: { task: { status: 'completed' } } });
      assert(res.ok === true, `a stale temp still blocks the write: ${JSON.stringify(res.errors)}`);
      assert(/^ {2}status: completed$/m.test(read(file)), 'the write did not land');
      assert(!fs.existsSync(tmp), 'the reclaimed temp survived the write');
    });

    expect('the state-temp-exists guidance names no route available during a gate', () => {
      const file = state();
      const tmp = path.join(path.dirname(file), 'orchestrator-state.yml.tmp');
      fs.writeFileSync(tmp, 'held\n', 'utf8');
      const res = writeState({ state: file, patch: { task: { status: 'completed' } } });
      assert(refusal(res) === 'state-temp-exists', `expected state-temp-exists, got ${refusal(res)}`);
      const message = res.errors[0].message;
      // While a gate is pending the operator has no tool that can delete a
      // file, so "remove it" is not a recovery. Waiting and writing again is.
      assert(/again/i.test(message) && /\b(minute|second)/i.test(message),
        `the guidance still names no in-band route: ${message}`);
    });

    expect('the module docstring still overclaims byte preservation', () => {
      const src = fs.readFileSync(stateSrc, 'utf8');
      const header = src.slice(0, src.indexOf('import fs'));
      assert(!/the bytes of every line the write did not touch\s*\n?\s*\*?\s*are the bytes that were there before/
        .test(header.replace(/\n \* /g, ' ')), 'the unqualified byte-preservation claim is still there');
      assert(/adopt/i.test(header), 'the header does not mention adoption');
      assert(/re-indent|reindent|normaliz/i.test(header), 'the header does not say the adoption walk rewrites the file');
    });

    // -- the patch vocabulary against the state contract ---------------------
    //
    // The writer's vocabulary and A1's top-level block list drifted apart once
    // already, and the drift was invisible from either side: the contract went
    // on defining `project_context`, `related_tasks`, `verification_context`
    // and `external_research`, the writer went on refusing all four with
    // `state-patch-unknown-key`, and the engine skill forbids the only other
    // way to write them. A run died at its first node. What follows makes that
    // a failure of this suite rather than a fourth manual audit.
    //
    // Both sides are read rather than restated. The register is parsed for the
    // three sentences that carry the block names, and the writer is asked for
    // its own vocabulary through the refusal it emits on an unknown key — which
    // is the runtime list, so neutering the constant cannot hide from it.
    expect('the writer vocabulary and the state contract have drifted apart', () => {
      const register = path.join(ctx.pluginRoot, REGISTER);
      assert(isFile(register), `${REGISTER} is absent`);
      const text = fs.readFileSync(register, 'utf8');
      const backticked = (re, label) => {
        const hit = re.exec(text);
        assert(hit, `${REGISTER} no longer carries the ${label} sentence A1's block list is read from`);
        const names = [...hit[1].matchAll(/`([a-z_]+)`/g)].map(m => m[1]);
        assert(names.length, `${REGISTER}: the ${label} sentence names no blocks`);
        return names;
      };
      // "`orchestrator` requires …", "`task` requires …" — the two core blocks.
      const required = [...text.matchAll(/`([a-z_]+)` requires /g)].map(m => m[1]);
      assert(required.length === 2, `expected two required core blocks, the register names ${required.join(', ') || 'none'}`);
      const optional = backticked(/Core-optional at the top level:\s*([^.]*)\./, 'core-optional');
      const perWorkflow = backticked(/\*\*Per-workflow `\$defs`\.\*\*\s*([^—]*)—/, 'per-workflow $defs');

      // The relationship, stated once: every A1 top-level block is a patch key,
      // except the five per-workflow ones, which are reached through the single
      // `context` key because the root accepts exactly one of them and the
      // writer derives which. Beside those come the three keys that name no
      // top-level block at all — `nodes` edits entries inside `workflow.nodes`,
      // `context` and `phase_summaries` are written into the resolved block.
      const WRITER_ONLY = ['nodes', 'context', 'phase_summaries'];
      const expected = [...new Set([...required, ...optional, ...WRITER_ONLY])].sort();

      const probe = writeState({ state: state(), patch: { __not_a_block__: {} } });
      assert(refusal(probe) === 'state-patch-unknown-key',
        `an unknown patch key no longer reports state-patch-unknown-key (got ${refusal(probe)})`);
      const listed = /is not one of (.+)$/.exec(probe.errors[0].message);
      assert(listed, `the refusal no longer lists the vocabulary: ${probe.errors[0].message}`);
      const vocabulary = listed[1].split(', ').map(k => k.trim()).filter(Boolean).sort();

      const unreachable = expected.filter(k => !vocabulary.includes(k));
      const extra = vocabulary.filter(k => !expected.includes(k));
      assert(unreachable.length === 0,
        `the contract defines ${unreachable.join(', ')} at the top level and the writer cannot reach ${unreachable.length === 1 ? 'it' : 'them'} — every state change goes through write-state, so a block outside the vocabulary is a block no run can write`);
      assert(extra.length === 0,
        `the writer accepts ${extra.join(', ')}, which A1 defines neither as a top-level block nor as one of the writer-only keys ${WRITER_ONLY.join(', ')}`);

      // The five per-workflow blocks are reached through `context`, never named
      // directly: a patch key spelling one of them would bypass the derivation
      // that keeps a run writing into the one block its readers consult.
      const named = perWorkflow.filter(k => vocabulary.includes(k));
      assert(named.length === 0,
        `${named.join(', ')} is a per-workflow context block and is reached through the context key, not by name`);
      const writerBlocks = /^const CONTEXT_BLOCKS = \[([^\]]*)\];$/m.exec(fs.readFileSync(stateSrc, 'utf8'));
      assert(writerBlocks, 'the writer no longer carries a named CONTEXT_BLOCKS constant');
      const writerNames = [...writerBlocks[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
      assert(JSON.stringify(writerNames) === JSON.stringify([...perWorkflow].sort()),
        `the writer derives ${writerNames.join(', ')} while the register defines ${perWorkflow.join(', ')}`);
    });

    expect('a core-optional top-level block is written somewhere other than the top level', () => {
      const file = state();
      const res = writeState({
        state: file,
        patch: {
          project_context: { project_doc_paths: ['docs/a.md'], project_context_summary: 'one doc' },
          related_tasks: [{ path: '.maister/tasks/research/x', relation: 'informs' }],
          verification_context: { fixes_applied: ['one'], reverify_count: 1 },
          external_research: { sources: [] },
        },
      });
      assert(res.ok === true, `the four core-optional blocks were refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      for (const key of ['project_context', 'related_tasks', 'verification_context', 'external_research']) {
        assert(new RegExp(`^${key}:`, 'm').test(text), `${key} was not written at column 0`);
        // `[ \t]` rather than `\s`: `\s` matches the newline that precedes the
        // block and would read every column-0 block as a nested one.
        assert(!new RegExp(`^[ \\t]+${key}:`, 'm').test(text),
          `${key} was written nested; A1 makes it a top-level sibling and names the nested form as reported drift`);
        assert(res.changed.some(c => c === key || c.startsWith(`${key}.`)),
          `${key} is not among the reported changed paths: ${res.changed.join(', ')}`);
      }
      assert(/^ {2}project_doc_paths:$/m.test(text) && /^ {4}- docs\/a\.md$/m.test(text),
        'a mapping child did not land at the canonical two-space step');
      assert(/^ {2}- path: /m.test(text) && /^ {4}relation: informs$/m.test(text),
        'the related_tasks sequence did not land at the canonical indent');
      // The hook's reader is the acceptance oracle here as everywhere: these
      // lines are not consulted by it, but it still has to parse past them.
      const hook = scanState(text);
      assert(hook.hasTask && hook.hasWorkflow && hook.hasNodes && Object.keys(hook.nodes).length > 0,
        'the hook reader no longer sees a complete state file');
      const suite = scanStateText(text);
      assert(JSON.stringify(hook.nodes) === JSON.stringify(suite.nodes), 'the two readers disagree on the emitted file');
      parseYaml(text, YAML_OPTS);

      // Merged key by key: the second write must not drop the first one's key.
      const second = writeState({ state: file, patch: { verification_context: { reverify_count: 2 } } });
      assert(second.ok === true, `the merging write was refused: ${JSON.stringify(second.errors)}`);
      const merged = read(file);
      assert(/^ {4}- one$/m.test(merged), 'a merging write dropped fixes_applied');
      assert(/^ {2}reverify_count: 2$/m.test(merged), 'the merging write did not land');
    });

    // -- the open maps under orchestrator: merge, the rest replace -----------
    //
    // Reproduced from a live run. `orchestrator.options` is an open map whose
    // keys are written by different nodes at different times — intake writes
    // html_output and mockup_format, specification writes spec_audit_enabled,
    // verification-options writes six more — and the writer replaced the whole
    // value on every one of them. An operator who set `html_output: false`
    // silently got the dashboard and every companion report back at the next
    // option write, through the success path. What is pinned here is the
    // discipline, not the one key: a second write of one key leaves the others
    // standing, for every block the module declares merged.
    const MERGED = ['options', 'task_ids', 'auto_fix_attempts', 'skipped_phases'];

    expect('the writer module no longer declares which orchestrator maps merge', () => {
      const declared = /^const MERGED_MAPS = new Set\(\[([^\]]*)\]\);$/m.exec(fs.readFileSync(stateSrc, 'utf8'));
      assert(declared, 'no named MERGED_MAPS constant — the merge/replace split must be stated, not incidental');
      const names = [...declared[1].matchAll(/'orchestrator\.([a-z_]+)'/g)].map(m => m[1]).sort();
      assert(JSON.stringify(names) === JSON.stringify([...MERGED].sort()),
        `the module merges ${names.join(', ')} while this test pins ${MERGED.join(', ')}`);
    });

    expect('a second write of one key drops the keys another write put there', () => {
      const file = state();
      const first = writeState({
        state: file,
        patch: {
          orchestrator: {
            options: { html_output: false, mockup_format: 'html', sequential: false },
            task_ids: { alpha: '1', beta: '2' },
            auto_fix_attempts: { alpha: 0 },
            skipped_phases: { 'phase-3': 'no reproducible defect' },
          },
        },
      });
      assert(first.ok === true, `the first write was refused: ${JSON.stringify(first.errors)}`);
      const second = writeState({
        state: file,
        patch: {
          orchestrator: {
            options: { spec_audit_enabled: true },
            task_ids: { gamma: '3' },
            auto_fix_attempts: { beta: 1 },
            skipped_phases: { 'phase-4': 'no browser surface' },
          },
        },
      });
      assert(second.ok === true, `the merging write was refused: ${JSON.stringify(second.errors)}`);

      const text = read(file);
      const parsed = parseYaml(text, YAML_OPTS).orchestrator;
      assert(parsed.options.html_output === false,
        `an operator's html_output: false did not survive the next option write: ${JSON.stringify(parsed.options)}`);
      for (const [block, kept, added] of [
        ['options', ['mockup_format', 'sequential'], 'spec_audit_enabled'],
        ['task_ids', ['alpha', 'beta'], 'gamma'],
        ['auto_fix_attempts', ['alpha'], 'beta'],
        ['skipped_phases', ['phase-3'], 'phase-4'],
      ]) {
        for (const key of kept) {
          assert(Object.prototype.hasOwnProperty.call(parsed[block], key),
            `orchestrator.${block}.${key} was dropped by a write that named only ${added}`);
        }
        assert(Object.prototype.hasOwnProperty.call(parsed[block], added),
          `orchestrator.${block}.${added} did not land`);
        assert(second.changed.includes(`orchestrator.${block}.${added}`),
          `the merging write does not report orchestrator.${block}.${added}: ${second.changed.join(', ')}`);
      }
      // Still one line each, still at column 2, still readable by both line
      // readers and by a real parser.
      for (const block of MERGED) {
        const line = new RegExp(`^ {2}${block}: \\{.*\\}$`, 'm');
        assert(line.test(text), `orchestrator.${block} is no longer a one-line flow map at column 2`);
      }
      const hook = scanState(text);
      assert(hook.hasTask && hook.hasWorkflow && Object.keys(hook.nodes).length > 0,
        'the hook reader no longer sees a complete state file');
    });

    expect('a block-form open map is flattened or loses its neighbours', () => {
      // Every state file a prose orchestrator wrote by hand carries the block
      // form, often with a trailing comment saying why an option was set. The
      // merge has to edit those in place rather than re-emit them.
      const file = state(BASE_STATE.replace('  task_path: .maister/tasks/research/x\n',
        '  task_path: .maister/tasks/research/x\n  options:\n    html_output: false   # operator said no\n    mockup_format: ascii\n'));
      const res = writeState({ state: file, patch: { orchestrator: { options: { spec_audit_enabled: true } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      assert(/^ {4}html_output: false {3}# operator said no$/m.test(text),
        'the block-form entry and its comment did not survive the merge');
      assert(/^ {4}mockup_format: ascii$/m.test(text), 'a block-form sibling was dropped');
      assert(/^ {4}spec_audit_enabled: true$/m.test(text), 'the merged key did not land in the block form');
      parseYaml(text, YAML_OPTS);
    });

    expect('a trailing comment on a flow map is destroyed by the merge', () => {
      const file = state(BASE_STATE.replace('  gate_pending: null\n',
        '  task_ids: {}   # tracker unavailable\n  gate_pending: null\n'));
      const res = writeState({ state: file, patch: { orchestrator: { task_ids: { alpha: '1' } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(/^ {2}task_ids: \{alpha: "1"\} {3}# tracker unavailable$/m.test(read(file)),
        `the trailing comment or the merged entry is wrong: ${/^ {2}task_ids:.*$/m.exec(read(file))?.[0]}`);
    });

    expect('a contract-shaped orchestrator member merges instead of replacing', () => {
      // E1: the driver block is written whole by the engine and rewritten whole
      // by the daemon. Merged, a write demoting a run to a terminal driver
      // would leave the cockpit's cwd and session standing beside it.
      const file = state(BASE_STATE.replace('  gate_pending: null\n',
        '  driver: {kind: cockpit, cwd: /abs/x, session: {id: a, status: running}}\n  gate_pending: null\n'));
      const res = writeState({ state: file, patch: { orchestrator: { driver: { kind: 'terminal' } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(/^ {2}driver: \{kind: terminal\}$/m.test(read(file)),
        `the driver block was merged rather than replaced: ${/^ {2}driver:.*$/m.exec(read(file))?.[0]}`);
      const driver = parseYaml(read(file), YAML_OPTS).orchestrator.driver;
      assert(!('cwd' in driver) && !('session' in driver),
        'a terminal driver kept the cockpit cwd or session — a combination E1 does not describe');
    });

    expect('an unreadable open-map line is silently replaced rather than refused', () => {
      const file = state(BASE_STATE.replace('  gate_pending: null\n',
        '  options: {html_output: true, "quoted key": 1}\n  gate_pending: null\n'));
      const before = read(file);
      const res = writeState({ state: file, patch: { orchestrator: { options: { sequential: true } } } });
      assert(res.ok === false, 'a flow map this writer cannot re-emit was replaced, dropping its keys');
      assert(refusal(res) === 'state-unreadable', `expected state-unreadable, got ${refusal(res)}`);
      assert(read(file) === before, 'the file changed despite the refusal');
    });

    expect('a non-map value blocks the key from ever being written again', () => {
      // `options: null` occurs, and there are no keys in it to keep.
      const file = state(BASE_STATE.replace('  gate_pending: null\n', '  options: null\n  gate_pending: null\n'));
      const res = writeState({ state: file, patch: { orchestrator: { options: { sequential: true } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(/^ {2}options: \{sequential: true\}$/m.test(read(file)), 'a non-map value was not replaced');
    });

    // White-box mutation proof: with the merge reverted in a copy of the
    // module, the assertion above must redden. Same technique as the neutered
    // key guard, and for the same reason — the test has to be shown to be
    // testing something.
    const noMerge = await (async () => {
      const copy = path.join(scratch, 'state-nomerge.mjs');
      const src = fs.readFileSync(stateSrc, 'utf8')
        .replace(/'\.\.\/\.\.\/\.\.\/\.\.\/hooks\/gate-lib\.mjs'/,
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href));
      const patched = src.replace(/^const MERGED_MAPS = new Set\(\[[^\]]*\]\);$/m, 'const MERGED_MAPS = new Set();');
      if (patched === src) return null;
      fs.writeFileSync(copy, patched, 'utf8');
      return import(pathToFileURL(copy));
    })();

    expect('reverting the merge in a copy of the module leaves the test green', () => {
      assert(noMerge, 'no MERGED_MAPS constant to revert — the merge/replace split must be a named set');
      const file = state();
      noMerge.writeState({ state: file, patch: { orchestrator: { options: { html_output: false, mockup_format: 'html' } } } });
      noMerge.writeState({ state: file, patch: { orchestrator: { options: { spec_audit_enabled: true } } } });
      const options = parseYaml(read(file), YAML_OPTS).orchestrator.options;
      assert(!Object.prototype.hasOwnProperty.call(options, 'html_output'),
        'the unmerged writer kept html_output — the merge assertion above proves nothing');
    });

    expect('the writer module is not dependency-free, cross-platform and unattributed', () => {
      const src = fs.readFileSync(stateSrc, 'utf8');
      assert(!src.startsWith('#!'), 'the module carries a shebang');
      assert(!(fs.statSync(stateSrc).mode & 0o111), 'the module carries an exec bit');
      for (const m of src.matchAll(/^import .* from '([^']+)';$/gm)) {
        assert(m[1].startsWith('node:') || m[1].startsWith('.'), `non-builtin import: ${m[1]}`);
      }
      assert(!/\bmaister:/.test(src), 'a literal plugin-name prefix appears in the module');
      assert(!/\r/.test(src), 'the file carries CRLF');
      assert(!/claude|anthropic|copilot ai/i.test(src), 'vendor attribution in the module');
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T31 — research parity checklist
// ---------------------------------------------------------------------------

/**
 * The checklist is verification evidence, not shipped documentation: it carries
 * development-task context, nothing in the plugin reads it, and the generated
 * variant's rewrite pass mangled the very strings its verbatim rows pin. It
 * therefore lives beside the run it was written for — under the in-repo task
 * tree, anchored at the repository root rather than at the plugin root.
 */
const CHECKLIST_REL = '.maister/tasks/development/2026-08-26-workflow-engine-and-research-builtin/'
  + 'verification/research-parity-checklist.md';
const PROSE_TWIN_REL = 'skills/research/SKILL.md';
const NODE_PROSE_REL = `${ENGINE}/workflows/research.md`;

/** Every checklist section, with the row count it pins. */
const CHECKLIST_SECTIONS = [
  ['Nodes', 10],
  ['Run-scoped context set', 4],
  ['Delegate contexts inside `direct:` nodes', 3],
  ['Mandatory gate texts', 3],
  ['Stop-path termination', 3],
  ['In-node questions', 8],
  ['Artifacts', 12],
  ['Companion pairs', 4],
  ['`research_context` fields', 9],
  ['`phase_summaries` keys', 7],
  ['`orchestrator.options`', 3],
  ['`node_summaries` keys', 9],
  ['Resume', 8],
  ['Gathering strategy', 2],
  ['`project_doc_paths` discovery', 1],
  ['Auto-recovery', 9],
  ['Verbatim sentences', 7],
  ['Operator visibility', 5],
  ['Reference reads', 3],
  ['Initialization', 8],
  ['Embedded mode', 3],
  ['Transitions', 2],
];

/**
 * The four nodes that mirror a summary into a phase key, and the key each one
 * owns. The engine reads the key from the node's own prose section, so what is
 * asserted below is that the section states it — a mapping that exists only in
 * this checklist is a mapping the interpreter never sees.
 */
const PHASE_KEY_OWNERS = [
  ['research-foundation', 'phase-1'],
  ['solution-generation', 'phase-3'],
  ['solution-convergence', 'phase-4'],
  ['high-level-design', 'phase-5'],
];

/**
 * The nine recovery budgets, as the Auto-recovery section pins them: the row
 * label, the node prose section that owns the budget, and the attempt count the
 * prose must state in words. The four foundation steps share one block inside
 * `research-foundation`, so each names its own step; the other five are a
 * `**Recovery budget**` line in the node's own section.
 */
const RECOVERY_BUDGETS = [
  ['foundation step 1', 'research-foundation', 1, 'step 1 one attempt'],
  ['foundation step 2', 'research-foundation', 2, 'step 2 two attempts'],
  ['foundation step 3', 'research-foundation', 3, 'step 3 three attempts'],
  ['foundation step 4', 'research-foundation', 2, 'step 4 two attempts'],
  ['`optional-phases-decision`', 'optional-phases-decision', 1, '**Recovery budget**: one attempt'],
  ['`solution-generation`', 'solution-generation', 2, '**Recovery budget**: two attempts'],
  ['`solution-convergence`', 'solution-convergence', 1, '**Recovery budget**: one attempt'],
  ['`high-level-design`', 'high-level-design', 2, '**Recovery budget**: two attempts'],
  ['`completion`', 'completion', 0, '**Recovery budget**: none'],
];

/**
 * The dashboard cannot derive an icon from a node id, so the node prose names
 * one per node. The six here are the phases in order; the three gates are
 * absent on purpose — a gate inherits the icon of the phase it gates, which the
 * section states in prose and the check below reads separately.
 */
const ICON_HINTS = [
  ['research-foundation', 'analysis'],
  ['optional-phases-decision', 'plan'],
  ['solution-generation', 'spec'],
  ['solution-convergence', 'plan'],
  ['high-level-design', 'spec'],
  ['completion', 'done'],
];

/** The gate icons, inherited from the phase each gate closes. */
const GATE_ICONS = [
  ['foundation-approval', 'analysis'],
  ['convergence-approval', 'plan'],
  ['design-approval', 'spec'],
];

/** `research_context.gathering_strategy`: three fields, a cap and four fallbacks. */
const STRATEGY_FIELDS = ['categories', 'count', 'source'];
const STRATEGY_FALLBACK = ['codebase', 'documentation', 'configuration', 'external'];

/** The parent's contract in embedded mode: five keys, and the node that is skipped. */
const HANDOFF_KEYS = [
  'research_report', 'findings_directory', 'solution_exploration', 'high_level_design', 'decision_log',
];

/** Every element of the `phase-4` decision list carries exactly these three keys. */
const DECISION_AREA_KEYS = ['area', 'alternatives_count', 'chosen_approach'];

/** A row that reads as a judgement cannot be checked statically. */
const JUDGEMENT = /\b(appropriate|appropriately|reasonable|reasonably|sensible|adequate|adequately|properly|nicely|roughly|seems?|looks right|good enough|well.written)\b/i;

/** The grammar cannot express these, so only their literal presence keeps them. */
const SELF_CHECK_STOPS = ['**STOP. Do NOT proceed.**', '**STOP. Do NOT proceed to Part C.**'];
const MISSED_GATE = 'never paper over a missed gate by updating state';
const MISSED_GATE_INITIAL = 'Never paper over a missed gate by updating state.';

/** The checklist's own budget, and the literals the generated-variant greps hunt. */
const REFERENCE_LINE_BUDGET = 3000;

function t31(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  // The source tree, never the generated variant: the build rewrites
  // `AskUserQuestion` and the provider prefix, which are the very strings the
  // verbatim rows assert.
  const plugin = ctx.pluginRoot;
  const file = path.join(ctx.repoRoot, CHECKLIST_REL);
  checks++;
  if (!isFile(file)) return { checks, failures: [`${CHECKLIST_REL} is absent`] };

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const twin = fs.readFileSync(path.join(plugin, PROSE_TWIN_REL), 'utf8');
  const prose = fs.readFileSync(path.join(plugin, NODE_PROSE_REL), 'utf8');
  const definition = fs.readFileSync(path.join(plugin, ENGINE, 'workflows', 'research.yml'), 'utf8');
  const count = (hay, needle) => hay.split(needle).length - 1;

  // A section is a `### ` heading; its rows are the table body rows between it
  // and the next heading of the same or a higher level.
  const isSeparator = l => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const sections = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('### ')) continue;
    let end = i + 1;
    while (end < lines.length && !/^#{2,3} /.test(lines[end])) end++;
    sections.set(lines[i].replace(/^#+ /, '').trim(), lines.slice(i + 1, end));
  }
  const tableRows = body => body.filter((l, at) => l.trim().startsWith('|') && !isSeparator(l)
    && !isSeparator(body[at + 1] ?? ''));

  // -- every section is present, with its pinned row count ------------------
  let rows = 0;
  for (const [name, want] of CHECKLIST_SECTIONS) {
    checks++;
    if (!sections.has(name)) { failures.push(`${name}: the section is absent`); continue; }
    const got = tableRows(sections.get(name)).length;
    rows += got;
    if (got !== want) failures.push(`${name}: ${got} rows, expected ${want}`);
  }

  // The nine node rows are the definition's nine node ids, in order.
  const ids = [...definition.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(m => m[1]);
  checks++;
  if (ids.length !== 9) failures.push(`the shipped definition no longer has nine nodes (${ids.length})`);
  const nodeRows = sections.has('Nodes') ? tableRows(sections.get('Nodes')) : [];
  checks++;
  const listed = nodeRows.map(r => (r.split('|')[1] ?? '').replace(/`/g, '').trim());
  if (JSON.stringify(listed.slice(0, ids.length)) !== JSON.stringify(ids)) {
    failures.push(`the Nodes rows name ${listed.slice(0, 9).join(', ')}`);
  }
  checks++;
  const tail = nodeRows[9] ?? '';
  if (!/`on:`/.test(tail) || !/flow-safe/.test(tail)) {
    failures.push('the Nodes section is missing the no-`on:` or the flow-safe sub-assertion');
  }

  // -- every section names a source file, and every row is machine-findable --
  for (const [name] of CHECKLIST_SECTIONS) {
    if (!sections.has(name)) continue;
    const body = sections.get(name);
    checks++;
    const where = body.find(l => l.startsWith('**Where**:'));
    if (!where) { failures.push(`${name}: no **Where** line`); continue; }
    const named = [...where.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(p => p.includes('/'));
    if (!named.some(p => isFile(path.join(plugin, p)) || isDir(path.join(plugin, p)))) {
      failures.push(`${name}: **Where** names no existing path under the plugin source (${named.join(', ')})`);
    }
    for (const row of tableRows(body)) {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      checks++;
      if (!/`[^`]+`/.test(row) && !/\b\d+\b/.test(cells.slice(1).join(' '))) {
        failures.push(`${name}: row ${JSON.stringify(cells[0])} names no literal, key, path or count`);
      }
      const judgement = row.match(JUDGEMENT);
      if (judgement) failures.push(`${name}: row ${JSON.stringify(cells[0])} is a judgement ("${judgement[0]}")`);
    }
  }

  // -- the phase keys, named where the engine reads them ---------------------
  const phaseRows = sections.has('`phase_summaries` keys')
    ? tableRows(sections.get('`phase_summaries` keys')) : [];
  checks++;
  const mappingRow = phaseRows.find(row => row.includes(NODE_PROSE_REL));
  if (!mappingRow) {
    failures.push('no `phase_summaries` keys row requires the node prose to name each phase key');
  } else {
    for (const [node, key] of PHASE_KEY_OWNERS) {
      checks++;
      if (!mappingRow.includes(`\`${node}\` → \`${key}\``)) {
        failures.push(`the phase-key row does not map ${node} to ${key}`);
      }
    }
  }

  // A node section is `## \`<id>\``; the run-scoped sections carry no backticks.
  const proseLines = prose.split('\n').map(l => l.replace(/\r$/, ''));
  const proseSections = new Map();
  const proseNamed = new Map();
  for (let i = 0; i < proseLines.length; i++) {
    const head = /^## (.+?)\s*$/.exec(proseLines[i]);
    if (!head) continue;
    let end = i + 1;
    while (end < proseLines.length && !/^## /.test(proseLines[end])) end++;
    const body = proseLines.slice(i + 1, end).join('\n');
    proseNamed.set(head[1], body);
    const node = /^`([a-z][a-z0-9-]*)`$/.exec(head[1]);
    if (node) proseSections.set(node[1], body);
  }
  for (const [node, key] of PHASE_KEY_OWNERS) {
    checks++;
    const body = proseSections.get(node);
    if (body === undefined) {
      failures.push(`${NODE_PROSE_REL}: no \`${node}\` section`);
      continue;
    }
    checks++;
    // The same whole-token predicate T33 uses. Research's keys are `phase-1`…
    // `phase-5`, so no two of them collide today — but a sixth research phase
    // named `phase-10` would make `includes('phase-1')` true wherever
    // `phase-10` is written, resurrecting the prefix defect here after it was
    // fixed there. The predicate is cheap; waiting for the collision is not.
    if (!namesPhaseKey(body, key)) {
      failures.push(`${NODE_PROSE_REL}: the ${node} section names no phase key, so nothing tells the engine to write ${key}`);
    }
  }
  const owners = new Set(PHASE_KEY_OWNERS.map(([node]) => node));
  for (const [node, body] of proseSections) {
    if (owners.has(node)) continue;
    checks++;
    if (/phase_summaries\.phase-\d/.test(body)) {
      failures.push(`${NODE_PROSE_REL}: the ${node} section claims a phase key, but this node mirrors none`);
    }
  }

  // -- the nine recovery budgets, in the prose the interpreter reads --------
  // A budget the checklist pins and the node prose does not state is a budget
  // no run ever applies: deleting the prose block must redden this test.
  const recoveryRows = sections.has('Auto-recovery') ? tableRows(sections.get('Auto-recovery')) : [];
  checks++;
  if (recoveryRows.length !== RECOVERY_BUDGETS.length) {
    failures.push(`Auto-recovery: ${recoveryRows.length} budget rows, expected ${RECOVERY_BUDGETS.length}`);
  }
  for (const [label, node, attempts, stated] of RECOVERY_BUDGETS) {
    checks++;
    const row = recoveryRows.find(r => (r.split('|')[1] ?? '').trim() === label);
    if (!row) { failures.push(`Auto-recovery: no row for ${label}`); continue; }
    checks++;
    const pinnedCount = (row.split('|')[2] ?? '').replace(/`/g, '').trim();
    if (pinnedCount !== String(attempts)) {
      failures.push(`Auto-recovery: ${label} pins ${JSON.stringify(pinnedCount)} attempts, expected ${attempts}`);
    }
    checks++;
    const body = proseSections.get(node);
    if (body === undefined) {
      failures.push(`${NODE_PROSE_REL}: no \`${node}\` section to carry the ${label} budget`);
    } else if (!body.includes(stated)) {
      failures.push(`${NODE_PROSE_REL}: the ${node} section does not state the ${label} budget (${JSON.stringify(stated)})`);
    }
  }
  // The budgets are prose in both twins, and never a `with:` key the engine
  // would have to interpret.
  checks++;
  const budgetKeys = definition.split('\n').filter(l => /^\s+(max_)?attempts:|^\s+recovery(_budget)?:/.test(l));
  if (budgetKeys.length) failures.push(`the definition carries a recovery budget as data: ${budgetKeys.join(' | ')}`);

  // -- the gathering strategy: three fields, a cap and four fallbacks --------
  const strategyRows = sections.has('Gathering strategy') ? tableRows(sections.get('Gathering strategy')) : [];
  const strategyText = strategyRows.join('\n');
  const foundation = proseSections.get('research-foundation') ?? '';
  checks++;
  if (!/`8`/.test(strategyText) || !/`4`/.test(strategyText)) {
    failures.push('Gathering strategy: the rows no longer pin the cap of 8 and the 4 fallback categories');
  }
  checks++;
  if (!foundation.includes('research_context.gathering_strategy')) {
    failures.push(`${NODE_PROSE_REL}: the research-foundation section names no \`research_context.gathering_strategy\``);
  }
  // The three field names are pinned by the context row that owns the shape.
  const contextRows = sections.has('`research_context` fields')
    ? tableRows(sections.get('`research_context` fields')) : [];
  const strategyRow = contextRows.find(row => (row.split('|')[1] ?? '').includes('gathering_strategy')) ?? '';
  checks++;
  if (!strategyRow) failures.push('`research_context` fields: no `gathering_strategy` row');
  for (const field of STRATEGY_FIELDS) {
    checks++;
    if (!foundation.includes(`\`${field}\``)) {
      failures.push(`${NODE_PROSE_REL}: the gathering strategy names no \`${field}\` field`);
    }
    checks++;
    if (!strategyRow.includes(`\`${field}\``)) {
      failures.push(`\`research_context\` fields: the gathering_strategy row drops \`${field}\``);
    }
  }
  checks++;
  if (!/capped at eight/.test(foundation)) {
    failures.push(`${NODE_PROSE_REL}: the gathering strategy states no cap of eight categories`);
  }
  for (const category of STRATEGY_FALLBACK) {
    checks++;
    if (!foundation.includes(category)) {
      failures.push(`${NODE_PROSE_REL}: the fallback category ${category} is not named in the node prose`);
    }
    checks++;
    if (!strategyText.includes(category)) failures.push(`Gathering strategy: the rows drop the ${category} fallback`);
  }
  for (const origin of ['planner', 'default']) {
    checks++;
    if (!foundation.includes(`\`${origin}\``)) {
      failures.push(`${NODE_PROSE_REL}: the gathering strategy records no \`${origin}\` origin`);
    }
  }

  // -- the icon hints, and the three gates that inherit one -----------------
  const icons = proseNamed.get('Icon hints');
  const visibility = sections.has('Operator visibility') ? tableRows(sections.get('Operator visibility')) : [];
  const iconRow = visibility.find(row => /icon hints/i.test(row.split('|')[1] ?? '')) ?? '';
  checks++;
  if (icons === undefined) failures.push(`${NODE_PROSE_REL}: no \`## Icon hints\` section`);
  checks++;
  if (!iconRow) failures.push('Operator visibility: no icon-hints row');
  for (const [index, [node, icon]] of ICON_HINTS.entries()) {
    checks++;
    if (icons !== undefined && !new RegExp(`^\\|\\s*\`${node}\`\\s*\\|\\s*\`${icon}\`\\s*\\|`, 'm').test(icons)) {
      failures.push(`${NODE_PROSE_REL}: the icon-hint table does not give \`${node}\` the \`${icon}\` icon`);
    }
    checks++;
    if (!iconRow.includes(`\`${index + 1} ${icon}\``)) {
      failures.push(`Operator visibility: the icon-hints row does not pin \`${index + 1} ${icon}\``);
    }
  }
  for (const [gate, icon] of GATE_ICONS) {
    checks++;
    if (icons !== undefined && !new RegExp(`\`${gate}\`\\s*\n?\\s*\`${icon}\``).test(icons)) {
      failures.push(`${NODE_PROSE_REL}: the icon-hint section does not have \`${gate}\` inherit \`${icon}\``);
    }
    checks++;
    if (!new RegExp(`\`${gate}\`\\s*\`${icon}\``).test(iconRow)) {
      failures.push(`Operator visibility: the icon-hints row does not have \`${gate}\` inherit \`${icon}\``);
    }
  }
  checks++;
  if (icons !== undefined && !/inherits rather\s*\n?\s*than owns its icon/.test(icons)) {
    failures.push(`${NODE_PROSE_REL}: the icon-hint section states no gate-inheritance rule`);
  }

  // -- embedded mode: the skipped node and the parent's five handoff keys ----
  const embedded = proseNamed.get('Embedded mode');
  const embeddedRows = sections.has('Embedded mode') ? tableRows(sections.get('Embedded mode')) : [];
  const embeddedText = embeddedRows.join('\n');
  checks++;
  if (embedded === undefined) failures.push(`${NODE_PROSE_REL}: no \`## Embedded mode\` section`);
  checks++;
  if (!/^ {2}completion:$[\s\S]*?^ {4}when: "!\$\{inputs\.embedded\}"$/m.test(definition)) {
    failures.push('the completion node no longer carries when: "!${inputs.embedded}", so an embedded run runs it');
  }
  checks++;
  if (!/^ {2}embedded: /m.test(definition)) failures.push('the definition declares no `embedded` input');
  checks++;
  if (embedded !== undefined && !embedded.includes('analysis/research/')) {
    failures.push(`${NODE_PROSE_REL}: the embedded-mode section does not hand the report to the parent's analysis/research/`);
  }
  checks++;
  if (!embeddedText.includes('analysis/research/')) {
    failures.push('Embedded mode: no row pins the parent directory the report is copied into');
  }
  for (const key of ['research_outputs', ...HANDOFF_KEYS]) {
    checks++;
    if (embedded !== undefined && !embedded.includes(key)) {
      failures.push(`${NODE_PROSE_REL}: the embedded-mode handoff block names no ${key}`);
    }
    checks++;
    if (!embeddedText.includes(key)) failures.push(`Embedded mode: the handoff row drops ${key}`);
  }

  // -- the decision areas a resumed convergence node reads -------------------
  const convergence = proseSections.get('solution-convergence') ?? '';
  const phaseFour = phaseRows.find(row => (row.split('|')[1] ?? '').includes('phase-4')) ?? '';
  checks++;
  if (!phaseFour) failures.push('`phase_summaries` keys: no `phase-4` row');
  for (const key of [...DECISION_AREA_KEYS, 'deferred_ideas']) {
    checks++;
    if (!convergence.includes(`\`${key}\``)) {
      failures.push(`${NODE_PROSE_REL}: the solution-convergence summary names no \`${key}\``);
    }
    checks++;
    if (!phaseFour.includes(`\`${key}\``) && !phaseFour.includes(key)) {
      failures.push(`\`phase_summaries\` keys: the phase-4 row drops ${key}`);
    }
  }
  checks++;
  if (!convergence.includes('`decision_areas`')) {
    failures.push(`${NODE_PROSE_REL}: the solution-convergence section names no \`decision_areas\` list`);
  }

  // -- the seven verbatim sentences, at counts that are true ----------------
  const verbatim = sections.has('Verbatim sentences') ? tableRows(sections.get('Verbatim sentences')) : [];
  let pinnedAtThree = 0;
  for (const row of verbatim) {
    const cells = row.split('|').slice(1, -1).map(c => c.trim());
    checks++;
    const quoted = cells[0]?.match(/^`(.+)`$/);
    if (!quoted || cells.length < 3) { failures.push(`a verbatim row is not a code span with two counts: ${row}`); continue; }
    const sentence = quoted[1].replace(/\\\|/g, '|');
    const [wantTwin, wantProse] = [Number(cells[1]), Number(cells[2])];
    checks++;
    if (!Number.isInteger(wantTwin) || !Number.isInteger(wantProse)) {
      failures.push(`non-integer occurrence counts in: ${row}`);
      continue;
    }
    const gotTwin = count(twin, sentence);
    const gotProse = count(prose, sentence);
    checks++;
    if (gotTwin !== wantTwin || gotProse !== wantProse) {
      failures.push(`${JSON.stringify(sentence.slice(0, 48))}: ${gotTwin}/${gotProse} occurrences, the row pins ${wantTwin}/${wantProse}`);
    }
    if (sentence === MISSED_GATE) {
      checks++;
      if (wantTwin !== 3) failures.push(`the missed-gate sentence is pinned at ${wantTwin} in the twin, expected three`);
      pinnedAtThree++;
    }
  }
  checks++;
  if (pinnedAtThree !== 1) failures.push('the missed-gate sentence is not one of the seven verbatim rows');

  for (const sentence of [...SELF_CHECK_STOPS, MISSED_GATE_INITIAL]) {
    checks++;
    if (!text.includes(sentence)) failures.push(`${JSON.stringify(sentence)} is not pinned by the checklist`);
    checks++;
    if (count(prose, sentence) < 1) failures.push(`${JSON.stringify(sentence)} is not in ${NODE_PROSE_REL}`);
  }
  checks++;
  if (count(prose, MISSED_GATE_INITIAL) !== 1) {
    failures.push(`the sentence-initial missed-gate form occurs ${count(prose, MISSED_GATE_INITIAL)}x in the node prose, expected 1`);
  }

  // -- the three gate texts equal the twin's, after the stated normalization --
  const twinQuestions = twin.split('\n').map(l => l.replace(/\r$/, ''))
    .filter(l => l.startsWith('AskUserQuestion - '))
    .map(l => l.slice('AskUserQuestion - '.length).replace(/^"(.*)"$/, '$1'));
  checks++;
  if (twinQuestions.length !== 3) {
    failures.push(`the prose twin carries ${twinQuestions.length} mandatory gate lines, expected three`);
  } else {
    for (const [index, id] of ['foundation-approval', 'convergence-approval', 'design-approval'].entries()) {
      checks++;
      const ask = new RegExp(`^ {2}${id}:$[\\s\\S]*?^ {4}ask: "([^"]*)"`, 'm').exec(definition)?.[1];
      if (ask !== twinQuestions[index]) failures.push(`${id}: the gate question has drifted from the prose twin`);
    }
  }

  // -- the source-tree rule and the comparison procedure --------------------
  checks++;
  if (!/plugins\/maister\//.test(text) || !/never the generated variant/i.test(text)
    || !/AskUserQuestion/.test(text) || !/ask_user/.test(text)) {
    failures.push('the checklist does not state the source-tree rule with the rewrite that motivates it');
  }
  checks++;
  const procedure = (sections.get('Comparison procedure') ?? []).join('\n');
  if (!procedure) {
    failures.push('no `### Comparison procedure` section');
  } else if (!/node -p "process\.env\.MAISTER_WORKFLOW_PROSE \?\? ''"/.test(procedure) || !/MAISTER_WORKFLOW_PROSE=1/.test(procedure)
    || !/non-empty value/.test(procedure) || !/fixtures\/contracts\/valid\/runs\/research-a/.test(procedure)
    || !/diff/i.test(procedure)) {
    failures.push('the comparison procedure omits the variable, the non-empty rule, the reference run or the diff');
  }

  // -- the reference budget, and the literals no shipped file may carry -----
  // The engine ships no references today — the checklist was the only one, and
  // it moved out of the plugin tree. An absent directory is that state, not a
  // failure, and reading it must not throw the whole test.
  const refs = path.join(plugin, ENGINE, 'references');
  checks++;
  const total = isDir(refs)
    ? fs.readdirSync(refs).filter(f => isFile(path.join(refs, f)))
      .reduce((sum, f) => sum + fs.readFileSync(path.join(refs, f), 'utf8').split('\n').length, 0)
    : 0;
  if (total >= REFERENCE_LINE_BUDGET) failures.push(`the engine references total ${total} lines, the budget is ${REFERENCE_LINE_BUDGET}`);
  if (!isDir(refs)) notes.push(`${ENGINE}/references is absent — the engine ships no reference files`);

  checks++;
  if (/multi-?select/i.test(text) || /claude\.md/i.test(text) || text.includes(NESTED_MARKER)
    || text.includes('\r') || /\b(Claude|Anthropic|Copilot)\b/.test(text)) {
    failures.push(`${CHECKLIST_REL}: a forbidden literal, a nested gate marker, a carriage return or a vendor name`);
  }

  notes.push(`${CHECKLIST_SECTIONS.length} sections, ${rows} rows, checked against the plugin source tree`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T32 — the emitted engine scripts run
// ---------------------------------------------------------------------------

const VARIANT_ROOT = 'plugins/maister-copilot';

/**
 * Every other test reads the source tree. This one executes the *emitted* one.
 *
 * The generated variant is a copy with a rewrite pass over its `.md` files and
 * a relocation of its hook registrations, and neither the prose lint nor the
 * schema checks can see whether the scripts it carries still resolve their
 * imports. A verb that cannot load its module exits 2 while every other check
 * in the repository stays green — so each verb is run once here, against the
 * emitted entry point, with the state writer last because it is the verb that
 * imports the shared reader from outside its own directory.
 */
function t32(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const variant = path.join(ctx.repoRoot, VARIANT_ROOT);
  const entry = path.join(variant, ENGINE, 'scripts', 'workflow.mjs');
  const definition = path.join(variant, ENGINE, 'workflows', 'research.yml');
  checks++;
  if (!isFile(entry) || !isFile(definition)) {
    return { checks, failures: [`${VARIANT_ROOT}: the engine is not in the emitted tree — build the variant first`], notes };
  }

  // The shared reader, at the path the emitted state writer imports it from.
  const emittedLib = path.join(variant, GATE_LIB);
  checks++;
  if (!isFile(emittedLib)) {
    failures.push(`${VARIANT_ROOT}/${GATE_LIB}: absent — the emitted state writer imports it and cannot load without it`);
  } else {
    checks++;
    if (fs.readFileSync(emittedLib, 'utf8') !== fs.readFileSync(path.join(ctx.pluginRoot, GATE_LIB), 'utf8')) {
      failures.push(`${VARIANT_ROOT}/${GATE_LIB}: not a byte copy of the source library`);
    }
  }

  const why = proc => String(proc.stderr ?? '').trim().split('\n')[0] || `no stderr, exit ${proc.status}`;
  const run = (args, input = '') => runBounded(process.execPath, [entry, ...args], { encoding: 'utf8', input });

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-contracts-variant-'));
  try {
    for (const verb of ['validate', 'resolve']) {
      const proc = run([verb, `--definition=${definition}`]);
      checks++;
      if (proc.status !== 0) {
        failures.push(`${verb}: exited ${proc.status} — ${why(proc)}`);
        continue;
      }
      let report = null;
      checks++;
      try {
        report = JSON.parse(proc.stdout);
      } catch (err) {
        failures.push(`${verb}: stdout is not the JSON report — ${err.message.split('\n')[0]}`);
      }
      if (!report) continue;
      checks++;
      if (report.ok !== true) failures.push(`${verb}: reported ok ${JSON.stringify(report.ok)} on the shipped definition`);
    }

    const diagram = run(['diagram', `--definition=${definition}`]);
    checks++;
    if (diagram.status !== 0) {
      failures.push(`diagram: exited ${diagram.status} — ${why(diagram)}`);
    } else {
      checks++;
      if (!/^flowchart /m.test(diagram.stdout)) failures.push('diagram: emitted no flowchart');
    }

    const state = path.join(scratch, 'orchestrator-state.yml');
    fs.copyFileSync(path.join(ctx.fixtures, CHAIN_TEMPLATE_STATE), state);
    const before = fs.readFileSync(state, 'utf8');
    const wrote = run(['write-state', `--state=${state}`],
      JSON.stringify({ nodes: { research: { status: 'running' } } }));
    checks++;
    if (wrote.status !== 0) {
      failures.push(`write-state: exited ${wrote.status} — ${why(wrote)}`);
    } else {
      const printed = wrote.stdout.split('\n').map(l => l.trim()).filter(Boolean);
      checks++;
      if (!printed.includes('orchestrator.updated') || !printed.includes('workflow.nodes.research')) {
        failures.push(`write-state: printed ${JSON.stringify(printed)}, expected the two changed paths`);
      }
      checks++;
      const after = fs.readFileSync(state, 'utf8');
      if (after === before || !/^ {4}research: \{[^}]*status: running/m.test(after)) {
        failures.push('write-state: exited 0 without publishing the node entry');
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  notes.push(`four verbs executed against ${VARIANT_ROOT}`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T33 — development parity checklist
// ---------------------------------------------------------------------------

/**
 * The development checklist is verification evidence with the same lifetime as
 * the prose twin it guards: it carries task context, nothing in the plugin
 * reads it, and it retires when the twin does. It therefore lives beside its
 * run, under the git-ignored in-repo task tree — which is what keeps this test
 * out of CI and makes enforcement local to a maintainer's checkout.
 */
const DEV_CHECKLIST_REL = '.maister/tasks/development/2026-08-27-development-workflow-definition/'
  + 'verification/development-parity-checklist.md';
const DEV_TWIN_REL = 'skills/development/SKILL.md';
const DEV_PROSE_REL = `${ENGINE}/workflows/development.md`;
const DEV_DEFINITION_REL = `${ENGINE}/workflows/development.yml`;

/** Every checklist section, with the row count it pins; 220 rows in total. */
const DEV_SECTIONS = [
  ['Nodes', 27],
  ['Guards', 12],
  ['Run-scoped context set', 4],
  ['Mandatory gate texts', 11],
  ['Pre-gate executive summaries', 6],
  ['Stop-path termination', 11],
  ['In-node questions', 10],
  ['Artifacts', 24],
  ['Companion pairs', 5],
  ['`task_context` fields', 8],
  ['`phase_summaries` keys', 14],
  ['`orchestrator.options`', 11],
  ['`node_summaries` keys', 26],
  ['Auto-recovery', 8],
  ['Verbatim sentences', 6],
  ['Operator visibility', 5],
  ['Initialization', 11],
  ['Transitions', 3],
  ['Command flags', 7],
  ['Embedded mode', 2],
  ['Accepted divergences', 9],
];
const DEV_TOTAL_ROWS = 220;

/** The definition's node count; the Nodes section carries one tail row beyond it. */
const DEV_NODE_COUNT = 26;

/**
 * The owner table, widened from research's node → key to node → [keys]: eight
 * owning nodes over twelve keys, thirteen pairs, because `design` has two
 * owners. The engine reads the key from the owning node's own prose section, so
 * a pair that lives only in the checklist is a pair the interpreter never sees.
 */
const DEV_PHASE_KEY_OWNERS = [
  ['intake', ['research', 'design']],
  ['codebase-analysis', ['codebase_analysis', 'clarifications']],
  ['gap-analysis', ['gap_analysis', 'scope_clarifications']],
  ['ui-mockups', ['ui_mockups', 'design']],
  ['specification', ['specification', 'architecture_decision']],
  ['spec-audit', ['spec_audit']],
  ['planning', ['implementation_plan']],
  ['implementation', ['implementation']],
];
const DEV_PHASE_KEY_PAIRS = 13;

/** The twelve distinct keys, for the sweep that no non-owning node claims one. */
const DEV_PHASE_KEYS = [...new Set(DEV_PHASE_KEY_OWNERS.flatMap(([, keys]) => keys))];

/**
 * Every `<prefix>.<key>` token a body names, as a set of keys.
 *
 * Extraction rather than a per-key substring or lookahead test, for two
 * reasons. A substring test cannot tell `implementation` from
 * `implementation_plan`: `includes` reports the shorter key as present wherever
 * the longer one is written, which is exactly the mirroring defect these checks
 * exist to catch. A lookahead only closes the boundary characters it happens to
 * enumerate: the `(?![a-z0-9_])` that replaced the substring test still admitted
 * `phase_summaries.implementationX` and `phase_summaries.implementation-x`,
 * because a key may be written with any of `[A-Za-z0-9_-]` and the boundary
 * listed neither uppercase nor the hyphen. Reading the whole token off the
 * document has no charset left to get wrong.
 *
 * It also makes the sweep symmetric. What a section claims is exactly the token
 * set it names, so an owning node can be swept against the keys it owns rather
 * than skipped — a `planning` section that names `phase_summaries.gap_analysis`
 * is as much a false claim as a non-owner naming one, and until the sets were
 * compared only the non-owner direction was checked.
 */
const keyTokensIn = (body, prefix) =>
  new Set([...body.matchAll(new RegExp(`${prefix}\\.([A-Za-z0-9_-]+)`, 'g'))].map(m => m[1]));

/** Whether a body names `phase_summaries.<key>` as a whole token. */
const namesPhaseKey = (body, key) => keyTokensIn(body, 'phase_summaries').has(key);

/**
 * Every identifier a body names inside an inline code span, as whole segments.
 *
 * State keys are written in the prose both bare and dotted — `` `html_output` ``
 * in one sentence and `` `orchestrator.options.sequential` `` in another — so
 * neither a fixed prefix nor a bare-word search finds them all. Splitting the
 * code spans on their punctuation covers both forms, and the split is what
 * bounds the token: `e2e_enabled` is not claimed by an `e2e_enabled_at`.
 *
 * Only code spans count. `sequential` is also an ordinary English word, and a
 * search over the running text would read the adjective as evidence that the
 * option key is written down — which is the failure mode the sweep exists to
 * catch, since the key was in fact named nowhere for three rounds.
 */
const codeSpanTokens = text => new Set([...text.matchAll(/`([^`\n]+)`/g)]
  .flatMap(m => m[1].match(/[A-Za-z0-9_-]+/g) ?? []));

/**
 * The eleven gates, in canonical order — the order the prose twin's markers
 * appear in once the audit opt-in is filtered out. The opt-in carries the same
 * marker prefix but closes no gate node: it is question 5 of the ten in-node
 * ones, asked inside `specification`.
 */
const DEV_GATES = [
  'gap-approval', 'tdd-red-approval', 'mockup-approval', 'specification-approval', 'spec-audit-approval',
  'planning-approval', 'implementation-approval', 'tdd-green-approval', 'verification-approval',
  'e2e-approval', 'docs-approval',
];
const DEV_AUDIT_OPT_IN = 'Run specification audit?';

/**
 * A gate row exempts itself from the equality check by naming its divergence
 * row, never by being hardcoded here: the exemption is only legitimate while
 * the divergence it points at is still on the record.
 */
const DEV_REWRITTEN = /\*\*rewritten\*\*, divergence `(\d+)`/;

/**
 * The eight recovery budgets: the prose phase number the row is keyed by, the
 * node whose section owns the budget, and the attempt count. Both twins state
 * these in prose and neither may carry one as data — an attempts key in `with:`
 * would read like a grammar feature while being inert.
 */
const DEV_RECOVERY_BUDGETS = [
  ['1', 'codebase-analysis', 2],
  ['2', 'gap-analysis', 2],
  ['3', 'tdd-red', 2],
  ['5', 'specification', 2],
  ['7', 'planning', 2],
  ['8', 'implementation', 5],
  ['9', 'tdd-green', 3],
  ['11', 'verification', 3],
];

/** Fifteen executable nodes name an icon; the dashboard cannot derive one from an id. */
const DEV_ICON_HINTS = [
  ['intake', 'analysis'], ['codebase-analysis', 'analysis'], ['gap-analysis', 'analysis'],
  ['tdd-red', 'verify'], ['ui-mockups', 'spec'], ['specification', 'spec'], ['spec-audit', 'verify'],
  ['planning', 'plan'], ['implementation', 'code'], ['tdd-green', 'verify'],
  ['verification-options', 'plan'], ['verification', 'verify'], ['e2e-verification', 'verify'],
  ['user-docs', 'docs'], ['finalization', 'done'],
];

/** The eleven gate icons, inherited from the node each gate closes. */
const DEV_GATE_ICONS = [
  ['gap-approval', 'analysis'], ['tdd-red-approval', 'verify'], ['mockup-approval', 'spec'],
  ['specification-approval', 'spec'], ['spec-audit-approval', 'verify'], ['planning-approval', 'plan'],
  ['implementation-approval', 'code'], ['tdd-green-approval', 'verify'], ['verification-approval', 'verify'],
  ['e2e-approval', 'verify'], ['docs-approval', 'docs'],
];

/** Nine divergences, deliberately excluded from the failure verdict. */
const DEV_DIVERGENCES = 9;

function t33(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  // The plugin SOURCE tree, never the generated variant: the build rewrites the
  // in-session question tool's name and strips the plugin prefix, which are the
  // very strings the verbatim and gate rows compare.
  const plugin = ctx.pluginRoot;
  const file = path.join(ctx.repoRoot, DEV_CHECKLIST_REL);
  checks++;
  if (!isFile(file)) return { checks, failures: [`${DEV_CHECKLIST_REL} is absent`] };

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const twin = fs.readFileSync(path.join(plugin, DEV_TWIN_REL), 'utf8');
  const prose = fs.readFileSync(path.join(plugin, DEV_PROSE_REL), 'utf8');
  const definition = fs.readFileSync(path.join(plugin, DEV_DEFINITION_REL), 'utf8');
  const count = (hay, needle) => hay.split(needle).length - 1;

  // A section is a `### ` heading; its rows are the table body rows between it
  // and the next heading of the same or a higher level.
  const isSeparator = l => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const sections = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('### ')) continue;
    let end = i + 1;
    while (end < lines.length && !/^#{2,3} /.test(lines[end])) end++;
    sections.set(lines[i].replace(/^#+ /, '').trim(), lines.slice(i + 1, end));
  }
  const tableRows = body => body.filter((l, at) => l.trim().startsWith('|') && !isSeparator(l)
    && !isSeparator(body[at + 1] ?? ''));
  const cellsOf = row => row.split('|').slice(1, -1).map(c => c.trim());
  const rowsOf = name => (sections.has(name) ? tableRows(sections.get(name)) : []);

  // -- every section is present, with its pinned row count, and 220 in total -
  let rows = 0;
  for (const [name, want] of DEV_SECTIONS) {
    checks++;
    if (!sections.has(name)) { failures.push(`${name}: the section is absent`); continue; }
    const got = tableRows(sections.get(name)).length;
    rows += got;
    if (got !== want) failures.push(`${name}: ${got} rows, expected ${want}`);
  }
  checks++;
  if (rows !== DEV_TOTAL_ROWS) failures.push(`the checklist carries ${rows} rows, expected ${DEV_TOTAL_ROWS}`);

  // -- the Nodes rows are the definition's ids, in canonical order -----------
  const ids = [...definition.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map(m => m[1]);
  checks++;
  if (ids.length !== DEV_NODE_COUNT) {
    failures.push(`the shipped definition has ${ids.length} nodes, expected ${DEV_NODE_COUNT}`);
  }
  const nodeRows = rowsOf('Nodes');
  const listed = nodeRows.map(r => (r.split('|')[1] ?? '').replace(/`/g, '').trim());
  checks++;
  if (JSON.stringify(listed.slice(0, ids.length)) !== JSON.stringify(ids)) {
    failures.push(`the Nodes rows name ${listed.slice(0, DEV_NODE_COUNT).join(', ')}`);
  }
  const tail = nodeRows[DEV_NODE_COUNT] ?? '';
  checks++;
  if (!/`on:`/.test(tail)) failures.push('the Nodes tail row is missing the no-`on:` sub-assertion');
  checks++;
  if (!/flow-safe/.test(tail)) failures.push('the Nodes tail row is missing the flow-safe sub-assertion');

  // -- every section names a source file, and every row is machine-findable --
  for (const [name] of DEV_SECTIONS) {
    if (!sections.has(name)) continue;
    const body = sections.get(name);
    checks++;
    const where = body.find(l => l.startsWith('**Where**:'));
    if (!where) { failures.push(`${name}: no **Where** line`); continue; }
    const named = [...where.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(p => p.includes('/'));
    if (!named.some(p => isFile(path.join(plugin, p)) || isDir(path.join(plugin, p)))) {
      failures.push(`${name}: **Where** names no existing path under the plugin source (${named.join(', ')})`);
    }
    for (const row of tableRows(body)) {
      const cells = cellsOf(row);
      checks++;
      if (!/`[^`]+`/.test(row) && !/\b\d+\b/.test(cells.slice(1).join(' '))) {
        failures.push(`${name}: row ${JSON.stringify(cells[0])} names no literal, key, path or count`);
      }
      const judgement = row.match(JUDGEMENT);
      if (judgement) failures.push(`${name}: row ${JSON.stringify(cells[0])} is a judgement ("${judgement[0]}")`);
    }
  }

  // -- the node prose, split into the sections the interpreter reads ---------
  // A node section is `## \`<id>\``; the shared sections carry no backticks.
  const proseLines = prose.split('\n').map(l => l.replace(/\r$/, ''));
  const proseSections = new Map();
  const proseNamed = new Map();
  for (let i = 0; i < proseLines.length; i++) {
    const head = /^## (.+?)\s*$/.exec(proseLines[i]);
    if (!head) continue;
    let end = i + 1;
    while (end < proseLines.length && !/^## /.test(proseLines[end])) end++;
    const body = proseLines.slice(i + 1, end).join('\n');
    proseNamed.set(head[1], body);
    const node = /^`([a-z][a-z0-9-]*)`$/.exec(head[1]);
    if (node) proseSections.set(node[1], body);
  }

  // -- the thirteen node-key pairs, named where the engine reads them --------
  const phaseRows = rowsOf('`phase_summaries` keys');
  const mappingRow = phaseRows.find(row => cellsOf(row)[0] === 'each key named in the node prose');
  checks++;
  if (!mappingRow) {
    failures.push('no `phase_summaries` keys row requires the node prose to name each key');
  } else {
    checks++;
    if (!mappingRow.includes(path.basename(DEV_PROSE_REL))) {
      failures.push(`the phase-key mapping row does not name ${path.basename(DEV_PROSE_REL)}`);
    }
    // `<node>` → `<key>` and `<key>`; …, one clause per owning node.
    const mapped = new Map();
    for (const clause of (cellsOf(mappingRow)[2] ?? '').split(';')) {
      const [, node, keys] = /`([a-z][a-z0-9-]*)`\s*→\s*(.+)$/.exec(clause.trim()) ?? [];
      if (node) mapped.set(node, [...keys.matchAll(/`([a-z0-9_]+)`/g)].map(m => m[1]));
    }
    checks++;
    const pairs = [...mapped.values()].reduce((sum, keys) => sum + keys.length, 0);
    if (pairs !== DEV_PHASE_KEY_PAIRS) {
      failures.push(`the phase-key mapping row carries ${pairs} node-key pairs, expected ${DEV_PHASE_KEY_PAIRS}`);
    }
    for (const [node, keys] of DEV_PHASE_KEY_OWNERS) {
      for (const key of keys) {
        checks++;
        if (!(mapped.get(node) ?? []).includes(key)) {
          failures.push(`the phase-key mapping row does not map ${node} to ${key}`);
        }
      }
    }
  }
  for (const [node, keys] of DEV_PHASE_KEY_OWNERS) {
    checks++;
    const body = proseSections.get(node);
    if (body === undefined) {
      failures.push(`${DEV_PROSE_REL}: no \`${node}\` section`);
      continue;
    }
    for (const key of keys) {
      checks++;
      if (!namesPhaseKey(body, key)) {
        failures.push(`${DEV_PROSE_REL}: the ${node} section names no \`phase_summaries.${key}\`, so nothing tells the engine to write it`);
      }
    }
  }

  // -- the negative sweep, over every section -------------------------------
  // Every node section is swept, owners included: a node owning no key must
  // claim none, and a node that owns two must claim those two and nothing else.
  // Skipping owners left `planning` free to name `phase_summaries.gap_analysis`
  // — a key `gap-analysis` owns — and the engine would then mirror the same key
  // from two nodes, the second overwriting the first. The claim is the token
  // set, so an unknown key such as `phase_summaries.gap-analysis` beside the
  // real `gap_analysis` is caught by the same comparison rather than by a list
  // of misspellings written here.
  const owners = new Map(DEV_PHASE_KEY_OWNERS);
  for (const [node, body] of proseSections) {
    checks++;
    const owned = owners.get(node) ?? [];
    const claimed = [...keyTokensIn(body, 'phase_summaries')].filter(key => !owned.includes(key));
    if (claimed.length) {
      const suffix = owned.length ? `, but this node owns only ${owned.join(', ')}` : ', but this node mirrors no phase key';
      failures.push(`${DEV_PROSE_REL}: the ${node} section claims ${claimed.join(', ')}${suffix}`);
    }
  }
  // `specification` and `implementation` are node ids that happen to spell a
  // key of their own node; every other id is forbidden as a key outright.
  for (const id of ids.filter(each => !DEV_PHASE_KEYS.includes(each))) {
    checks++;
    if (namesPhaseKey(prose, id)) {
      failures.push(`${DEV_PROSE_REL}: a phase summary entry is keyed by the node id ${id}`);
    }
  }
  checks++;
  if (!phaseRows.some(row => cellsOf(row)[0] === 'no entry keyed by a node id')) {
    failures.push('`phase_summaries` keys: no row forbids an entry keyed by a node id');
  }

  // -- the option and task-context keys, named where a run writes them -------
  //
  // The analogue of the phase-key owner sweep, for the two sections that pin
  // what a run writes under `orchestrator.options` and `task_context`. Three
  // rounds of review each turned up a different key the interpreter must write
  // that no file the interpreter reads ever named — six option keys, then five
  // state fields, then `sequential`, then `tech_clarified` and
  // `design_resources` — and each was found by hand, because the suite swept
  // this direction for phase keys and for nothing else. A row pinned here that
  // the node prose never names is a key only the checklist believes in.
  //
  // Where a row's own cells name node ids, the key must be named inside one of
  // those nodes' sections: moving a key out of its setter's section and into
  // some other paragraph leaves the interpreter's own node instructions silent
  // about it. A row naming no node id is held to the weaker claim that the
  // document names the key at all.
  const proseTokens = codeSpanTokens(prose);
  const sectionTokens = new Map([...proseSections].map(([node, body]) => [node, codeSpanTokens(body)]));
  for (const [section, prefix] of [['`task_context` fields', 'task_context'], ['`orchestrator.options`', 'orchestrator.options']]) {
    for (const row of rowsOf(section)) {
      const cells = cellsOf(row);
      const key = /^`([A-Za-z0-9_]+)`$/.exec(cells[0] ?? '')?.[1] ?? null;
      checks++;
      if (!key) {
        failures.push(`${section}: the row ${JSON.stringify(cells[0] ?? '')} names no key in backticks`);
        continue;
      }
      const setters = [...cells.slice(1).join(' ').matchAll(/`([a-z][a-z0-9-]*)`/g)].map(m => m[1])
        .filter(id => ids.includes(id) && proseSections.has(id));
      checks++;
      if (setters.length) {
        if (!setters.some(node => sectionTokens.get(node).has(key))) {
          failures.push(`${DEV_PROSE_REL}: no ${setters.join(' or ')} section names \`${prefix}.${key}\`, though the checklist pins it as written there`);
        }
      } else if (!proseTokens.has(key)) {
        failures.push(`${DEV_PROSE_REL}: nothing names \`${prefix}.${key}\`, though the checklist pins the field`);
      }
    }
  }

  // -- the eleven gate texts, against the twin's normalized marker tails -----
  // Normalization is the checklist's own: strip the marker prefix, take the
  // last double-quoted span. The audit opt-in carries the same prefix and
  // closes no gate, so it is filtered out before the orders are lined up.
  const divergenceNumbers = new Set(rowsOf('Accepted divergences').map(row => cellsOf(row)[0]));
  const twinQuestions = twin.split('\n').map(l => l.replace(/\r$/, ''))
    .filter(l => l.startsWith('AskUserQuestion - '))
    .filter(l => !l.includes(DEV_AUDIT_OPT_IN))
    .map(l => {
      const quoted = [...l.matchAll(/"([^"]*)"/g)].map(m => m[1]);
      return quoted.length ? quoted[quoted.length - 1] : null;
    });
  checks++;
  if (twinQuestions.length !== DEV_GATES.length) {
    failures.push(`the prose twin carries ${twinQuestions.length} gate markers, expected ${DEV_GATES.length}`);
  }
  const gateRows = rowsOf('Mandatory gate texts');
  let exempted = 0;
  DEV_GATES.forEach((id, index) => {
    const row = gateRows.find(r => cellsOf(r)[0] === `\`${id}\``);
    checks++;
    if (!row) { failures.push(`Mandatory gate texts: no row for ${id}`); return; }
    const cells = cellsOf(row);
    const pinned = (cells[1] ?? '').replace(/^`|`$/g, '');
    const ask = new RegExp(`^ {2}${id}:$[\\s\\S]*?^ {4}ask: "([^"]*)"`, 'm').exec(definition)?.[1] ?? null;
    checks++;
    if (ask !== pinned) {
      failures.push(`${id}: the definition asks ${JSON.stringify(ask)}, the checklist pins ${JSON.stringify(pinned)}`);
    }
    const rewritten = DEV_REWRITTEN.exec(cells[2] ?? '');
    if (rewritten) {
      exempted++;
      checks++;
      if (!divergenceNumbers.has(rewritten[1])) {
        failures.push(`${id}: exempted by divergence ${rewritten[1]}, which the Accepted divergences section does not carry`);
      }
      return;
    }
    checks++;
    if (ask !== twinQuestions[index]) {
      failures.push(`${id}: asks ${JSON.stringify(ask)}, the prose marker tail is ${JSON.stringify(twinQuestions[index])}`);
    }
  });
  checks++;
  if (exempted !== 2) failures.push(`${exempted} gate rows claim a divergence exemption, expected 2`);

  // -- the eight recovery budgets, in the prose the interpreter reads --------
  // A budget the checklist pins and the owning node's prose does not state is a
  // budget no run ever applies: deleting the prose line must redden this test.
  const recoveryRows = rowsOf('Auto-recovery');
  checks++;
  if (recoveryRows.length !== DEV_RECOVERY_BUDGETS.length) {
    failures.push(`Auto-recovery: ${recoveryRows.length} budget rows, expected ${DEV_RECOVERY_BUDGETS.length}`);
  }
  for (const [phase, node, attempts] of DEV_RECOVERY_BUDGETS) {
    checks++;
    const row = recoveryRows.find(r => cellsOf(r)[0] === phase);
    if (!row) { failures.push(`Auto-recovery: no row for prose phase ${phase}`); continue; }
    const cells = cellsOf(row);
    checks++;
    if (cells[1] !== `\`${node}\``) {
      failures.push(`Auto-recovery: phase ${phase} names ${cells[1]}, expected \`${node}\``);
    }
    checks++;
    const pinnedCount = (cells[2] ?? '').replace(/`/g, '');
    if (pinnedCount !== String(attempts)) {
      failures.push(`Auto-recovery: ${node} pins ${JSON.stringify(pinnedCount)} attempts, expected ${attempts}`);
    }
    checks++;
    const body = proseSections.get(node);
    const stated = `**Recovery budget**: ${attempts} attempts`;
    if (body === undefined) {
      failures.push(`${DEV_PROSE_REL}: no \`${node}\` section to carry the phase ${phase} budget`);
    } else if (!body.includes(stated)) {
      failures.push(`${DEV_PROSE_REL}: the ${node} section does not state ${JSON.stringify(stated)}`);
    }
  }
  checks++;
  const budgetKeys = definition.split('\n').filter(l => /^\s+(max_)?attempts:|^\s+recovery(_budget)?:/.test(l));
  if (budgetKeys.length) failures.push(`the definition carries a recovery budget as data: ${budgetKeys.join(' | ')}`);

  // -- the six verbatim sentences, at counts that are true in both twins -----
  // Four of the six pin `0` on the node-prose side on purpose: the node prose
  // is hard-wrapped, so a sentence that wraps there cannot be a one-line
  // literal, and it states those four rules in its own unwrapped words.
  const verbatim = rowsOf('Verbatim sentences');
  for (const row of verbatim) {
    const cells = cellsOf(row);
    checks++;
    const quoted = cells[0]?.match(/^`(.+)`$/);
    if (!quoted || cells.length < 3) {
      failures.push(`a verbatim row is not a code span with two counts: ${row}`);
      continue;
    }
    const sentence = quoted[1].replace(/\\\|/g, '|');
    const [wantTwin, wantProse] = [Number(cells[1]), Number(cells[2])];
    checks++;
    if (!Number.isInteger(wantTwin) || !Number.isInteger(wantProse)) {
      failures.push(`non-integer occurrence counts in: ${row}`);
      continue;
    }
    const gotTwin = count(twin, sentence);
    const gotProse = count(prose, sentence);
    checks++;
    if (gotTwin !== wantTwin || gotProse !== wantProse) {
      failures.push(`${JSON.stringify(sentence.slice(0, 48))}: ${gotTwin}/${gotProse} occurrences, the row pins ${wantTwin}/${wantProse}`);
    }
  }

  // -- the icon hints, and the eleven gates that inherit one ----------------
  const icons = proseNamed.get('Icon hints');
  const iconRow = rowsOf('Operator visibility').find(row => /icon hints/i.test(cellsOf(row)[0] ?? '')) ?? '';
  checks++;
  if (icons === undefined) failures.push(`${DEV_PROSE_REL}: no \`## Icon hints\` section`);
  checks++;
  if (!iconRow) failures.push('Operator visibility: no icon-hints row');
  for (const [node, icon] of DEV_ICON_HINTS) {
    checks++;
    if (icons !== undefined && !new RegExp(`^\\|\\s*\`${node}\`\\s*\\|\\s*\`${icon}\`\\s*\\|`, 'm').test(icons)) {
      failures.push(`${DEV_PROSE_REL}: the icon-hint table does not give \`${node}\` the \`${icon}\` icon`);
    }
    checks++;
    if (!new RegExp(`\`${node}\`\\s*\`${icon}\``).test(iconRow)) {
      failures.push(`Operator visibility: the icon-hints row does not give \`${node}\` the \`${icon}\` icon`);
    }
  }
  for (const [gate, icon] of DEV_GATE_ICONS) {
    checks++;
    if (icons !== undefined && !new RegExp(`\`${gate}\`\\s*\n?\\s*\`${icon}\``).test(icons)) {
      failures.push(`${DEV_PROSE_REL}: the icon-hint section does not have \`${gate}\` inherit \`${icon}\``);
    }
    checks++;
    if (!new RegExp(`\`${gate}\`\\s*\`${icon}\``).test(iconRow)) {
      failures.push(`Operator visibility: the icon-hints row does not have \`${gate}\` inherit \`${icon}\``);
    }
  }
  checks++;
  if (icons !== undefined && !/A gate inherits rather\s+than owns its icon/.test(icons)) {
    failures.push(`${DEV_PROSE_REL}: the icon-hint section states no gate-inheritance rule`);
  }

  // -- the accepted divergences, excluded from the failure verdict ----------
  checks++;
  if (divergenceNumbers.size !== DEV_DIVERGENCES) {
    failures.push(`Accepted divergences: ${divergenceNumbers.size} rows, expected ${DEV_DIVERGENCES}`);
  }
  checks++;
  if (!/do not block a green verdict/i.test((sections.get('Accepted divergences') ?? []).join('\n'))) {
    failures.push('Accepted divergences: the section does not state that its rows do not block a green verdict');
  }

  // -- the source-tree rule, and the literals no evidence file may carry ----
  checks++;
  if (!/plugins\/maister\//.test(text) || !/never the generated variant/i.test(text)) {
    failures.push('the checklist does not state the source-tree rule');
  }
  checks++;
  if (/multi-?select/i.test(text) || /claude\.md/i.test(text) || text.includes(NESTED_MARKER)
    || text.includes('\r') || /\b(Claude|Anthropic|Copilot)\b/.test(text)) {
    failures.push(`${DEV_CHECKLIST_REL}: a forbidden literal, a nested gate marker, a carriage return or a vendor name`);
  }

  notes.push(`${DEV_SECTIONS.length} sections, ${rows} rows, checked against the plugin source tree`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T34 — generated variant parity
// ---------------------------------------------------------------------------

/**
 * The generated Copilot variant, and the generator that writes it.
 *
 * The variant is committed, and the job that rebuilds and commits it runs on
 * the default branch only: on a feature branch the rebuild is a manual step,
 * and forgetting it ships a variant that is a revision behind its source with
 * both `make test` and `make validate` green — which is how a one-line drift
 * reached review this round and was caught by hand.
 */
const VARIANT_REL = 'plugins/maister-copilot';
const BUILD_SCRIPT_REL = 'platforms/copilot-cli/build.sh';

/**
 * The build's own substitution list, replayed here in the generator's order.
 *
 * `build.sh` copies the source tree wholesale and then runs these `sed` passes
 * over markdown only, so replaying them reproduces the variant's markdown
 * exactly — no `make build` from inside the suite, which would rewrite the
 * working tree the suite is asserting over.
 *
 * `sed` pins the expression as `build.sh` writes it. A pass added, dropped or
 * reworded there without the matching row here would otherwise make this test
 * fail against a variant that is in fact correct; the pin turns that into one
 * legible failure naming the generator instead.
 *
 * `scope` is the generator's own `find` root: `commands+skills` for the
 * frontmatter pass, `skills` for the ones under `$OUT/skills`, `all` for the
 * two run over the whole tree.
 */
const VARIANT_SUBSTITUTIONS = [
  {
    scope: 'commands+skills',
    sed: "s/^name: maister:/name: /",
    apply: text => text.replace(/^name: maister:/gm, 'name: '),
  },
  { scope: 'all', sed: "s/maister:/maister-/g", apply: text => text.split('maister:').join('maister-') },
  {
    scope: 'skills',
    sed: "s/multi-select question/sequential single-select questions (one per option)/g",
    apply: text => text.split('multi-select question').join('sequential single-select questions (one per option)'),
  },
  {
    scope: 'skills',
    sed: "s/multi-select/sequential single-select/g",
    apply: text => text.split('multi-select').join('sequential single-select'),
  },
  {
    scope: 'skills',
    sed: "s/multiselect/sequential single-select/g",
    apply: text => text.split('multiselect').join('sequential single-select'),
  },
  {
    scope: 'skills',
    sed: "s/multiSelect/sequential single-select/g",
    apply: text => text.split('multiSelect').join('sequential single-select'),
  },
  {
    scope: 'skills',
    sed: "s/CLAUDE\\.md/.github\\/copilot-instructions.md/g",
    apply: text => text.split('CLAUDE.md').join('.github/copilot-instructions.md'),
  },
  { scope: 'all', sed: "s/AskUserQuestion/ask_user/g", apply: text => text.split('AskUserQuestion').join('ask_user') },
];

/**
 * What the walk cannot compare path-for-path, and why.
 *
 * `hooks/` is rearranged rather than copied — the generator drops the
 * Claude-shaped registration directory and emits a Copilot one under
 * `.github/hooks/` — and `plugin.json` is rewritten by two `sed` passes of its
 * own, asserted below by what those passes must have produced rather than by
 * byte equality. Everything else is either a byte copy or replayable markdown.
 */
const VARIANT_UNCOMPARED = ['hooks/', '.github/', '.claude-plugin/plugin.json'];

/** Files a fresh build would copy byte for byte: the generator's `sed` never leaves `.md`. */
const variantRewrites = rel => rel.endsWith('.md');

function t34(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const source = ctx.pluginRoot;
  const variant = path.join(ctx.repoRoot, VARIANT_REL);
  checks++;
  if (!isDir(variant)) return { checks, failures: [`${VARIANT_REL} is absent — the committed variant is not in the tree`] };

  const build = path.join(ctx.repoRoot, BUILD_SCRIPT_REL);
  checks++;
  if (!isFile(build)) return { checks, failures: [`${BUILD_SCRIPT_REL} is absent — nothing states what the variant is generated from`] };
  const buildText = fs.readFileSync(build, 'utf8');
  for (const { sed } of VARIANT_SUBSTITUTIONS) {
    checks++;
    if (!buildText.includes(sed)) {
      failures.push(`${BUILD_SCRIPT_REL} no longer carries the substitution '${sed}' this test replays`);
    }
  }

  const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path.join(dir, entry.name), relPath) : [relPath];
  });
  const compared = relPath => !VARIANT_UNCOMPARED.some(each =>
    each.endsWith('/') ? relPath.startsWith(each) : relPath === each);
  const sourceFiles = walk(source).filter(compared).sort();
  const variantFiles = walk(variant).filter(compared).sort();

  checks++;
  const extra = variantFiles.filter(relPath => !sourceFiles.includes(relPath));
  if (extra.length) {
    failures.push(`${VARIANT_REL} carries files a fresh build would not write: ${extra.slice(0, 5).join(', ')}`);
  }

  let copies = 0;
  let rewritten = 0;
  for (const relPath of sourceFiles) {
    const target = path.join(variant, relPath);
    checks++;
    if (!isFile(target)) {
      failures.push(`${VARIANT_REL}/${relPath} is absent — the variant predates this source file`);
      continue;
    }
    checks++;
    if (variantRewrites(relPath)) {
      rewritten++;
      const scope = relPath.startsWith('skills/') ? 'skills' : relPath.startsWith('commands/') ? 'commands' : 'other';
      let want = fs.readFileSync(path.join(source, relPath), 'utf8');
      for (const pass of VARIANT_SUBSTITUTIONS) {
        const applies = pass.scope === 'all'
          || (pass.scope === 'skills' && scope === 'skills')
          || (pass.scope === 'commands+skills' && scope !== 'other');
        if (applies) want = pass.apply(want);
      }
      if (want !== fs.readFileSync(target, 'utf8')) {
        failures.push(`${VARIANT_REL}/${relPath} is not what the generator's substitutions produce from the source file`);
      }
    } else {
      copies++;
      if (!fs.readFileSync(path.join(source, relPath)).equals(fs.readFileSync(target))) {
        failures.push(`${VARIANT_REL}/${relPath} differs from the source file the build copies byte for byte`);
      }
    }
  }

  // The one rewritten non-markdown file, asserted by what its two passes must
  // have produced: the variant is a distinct plugin id, or a consumer installing
  // both gets one shadowing the other.
  const manifest = path.join(variant, '.claude-plugin', 'plugin.json');
  checks++;
  if (!isFile(manifest)) failures.push(`${VARIANT_REL}/.claude-plugin/plugin.json is absent`);
  else {
    const doc = readJson(manifest);
    checks++;
    if (doc?.name !== 'maister-copilot') failures.push(`the variant manifest names the plugin ${JSON.stringify(doc?.name)}, not maister-copilot`);
    checks++;
    if (/for Claude Code/.test(doc?.description ?? '')) {
      failures.push(`the variant manifest still describes itself as ${JSON.stringify(doc.description)}`);
    }
    const sourceDoc = readJson(path.join(source, '.claude-plugin', 'plugin.json'));
    checks++;
    if (doc?.version !== sourceDoc?.version) {
      failures.push(`the variant manifest is version ${JSON.stringify(doc?.version)}, the source ${JSON.stringify(sourceDoc?.version)}`);
    }
  }

  notes.push(`${copies} byte-copied and ${rewritten} rewritten file(s) compared against a replay of ${BUILD_SCRIPT_REL}`);
  return { checks, failures, notes };
}

// ===========================================================================
// registry and entry point
// ===========================================================================

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * `needs` gates a test on a tree the runner may not have:
 *   'fixtures' — a non-empty fixture tree (`--fixtures`)
 *   'plugin'   — the full plugin source tree (skills + hooks), absent in the tarball
 *   'in-repo'  — this repository's own `.maister/tasks` tree, which is
 *                git-ignored and therefore absent in CI and in any clone
 * Tests with unmet needs print `skip`, never `FAIL`. Schema-only tests declare
 * nothing: the schema dir ships everywhere the runner does, so its absence is a
 * real failure.
 */
const TESTS = [
  { id: 'T01', name: 'schema-self-check', needs: [], run: t01 },
  { id: 'T02', name: 'manifest-integrity', needs: ['fixtures'], run: t02 },
  { id: 'T03', name: 'valid-fixtures-pass', needs: ['fixtures'], run: t03 },
  { id: 'T04', name: 'invalid-fixtures-fail', needs: ['fixtures'], run: t04 },
  { id: 'T05', name: 'tolerated-fixtures-degrade', needs: ['fixtures'], run: t05 },
  { id: 'T06', name: 'dashboard-data-read-tolerant', needs: ['fixtures'], run: t06 },
  { id: 'T07', name: 'newer-format-degrade', needs: ['fixtures'], run: t07 },
  { id: 'T08', name: 'summary-block-positional-form', needs: ['fixtures'], run: t08 },
  { id: 'T09', name: 'timestamp-field-paths', needs: ['fixtures'], run: t09 },
  { id: 'T10', name: 'task-layout-enumeration', needs: ['fixtures'], run: t10 },
  { id: 'T11', name: 'dashboard-asset-md5', needs: ['fixtures', 'plugin'], run: t11 },
  { id: 'T12', name: 'state-dashboard-cross-check', needs: ['fixtures'], run: t12 },
  { id: 'T13', name: 'gate-pending-one-line-form', needs: ['fixtures'], run: t13 },
  { id: 'T14', name: 'hook-replay-claude', needs: ['fixtures', 'plugin'], run: t14 },
  { id: 'T15', name: 'hook-replay-copilot', needs: ['fixtures', 'plugin'], run: t15 },
  { id: 'T16', name: 'corrupt-state-fail-closed', needs: ['fixtures', 'plugin'], run: t16 },
  { id: 'T17', name: 'engine-owned-allow', needs: ['fixtures', 'plugin'], run: t17 },
  { id: 'T18', name: 'default-deny-unknown-tool', needs: ['fixtures', 'plugin'], run: t18 },
  { id: 'T19', name: 'apply-patch-multi-file', needs: ['fixtures', 'plugin'], run: t19 },
  { id: 'T20', name: 'terminal-user-invariant', needs: ['fixtures', 'plugin'], run: t20 },
  { id: 'T21', name: 'stop-nudge', needs: ['fixtures', 'plugin'], run: t21 },
  { id: 'T22', name: 'guard-quoting', needs: ['fixtures', 'plugin'], run: t22 },
  { id: 'T23', name: 'gate-marker-lint', needs: ['plugin'], run: t23 },
  { id: 'T24', name: 'hook-registrations', needs: ['plugin'], run: t24 },
  { id: 'T25', name: 'reserved-keys-warn', needs: ['fixtures'], run: t25 },
  { id: 'T26', name: 'orphan-check', needs: ['fixtures'], run: t26 },
  { id: 'T27', name: 'release-tarball', needs: ['plugin'], run: t27 },
  { id: 'T28', name: 'in-repo-task-dirs', needs: ['plugin', 'in-repo'], run: t28 },
  { id: 'T29', name: 'workflow-grammar-runner', needs: ['plugin', 'fixtures'], run: t29 },
  { id: 'T30', name: 'workflow-state-writer', needs: ['plugin', 'fixtures'], run: t30 },
  { id: 'T31', name: 'research-parity-checklist', needs: ['plugin', 'in-repo'], run: t31 },
  { id: 'T32', name: 'emitted-engine-smoke', needs: ['plugin', 'fixtures'], run: t32 },
  { id: 'T33', name: 'development-parity-checklist', needs: ['plugin', 'in-repo'], run: t33 },
  { id: 'T34', name: 'generated-variant-parity', needs: ['plugin'], run: t34 },
];

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function rel(p) {
  const r = path.relative(REPO_ROOT, p);
  return r.startsWith('..') ? p : r;
}

function buildContext(opts) {
  const pluginRoot = path.resolve(opts.schemas, '..', '..', '..');
  const have = new Set();
  if (isDir(opts.fixtures) && fs.readdirSync(opts.fixtures).length > 0) have.add('fixtures');
  if (isDir(path.join(pluginRoot, 'skills')) && isDir(path.join(pluginRoot, 'hooks'))) have.add('plugin');
  if (isDir(path.join(REPO_ROOT, IN_REPO_TASKS))) have.add('in-repo');
  return { ...opts, repoRoot: REPO_ROOT, pluginRoot, have };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log('usage: node scripts/verify-contracts.mjs [--only=T01,T02] [--fixtures=<dir>] [--schemas=<dir>]');
    process.exit(0);
  }

  const ctx = buildContext(opts);
  const selected = TESTS.filter(t => !ctx.only || ctx.only.includes(t.id));
  if (ctx.only) {
    const unknown = ctx.only.filter(id => !TESTS.some(t => t.id === id));
    if (unknown.length) {
      console.error(`unknown test id(s): ${unknown.join(', ')}`);
      process.exit(2);
    }
  }

  let failed = 0;
  for (const test of selected) {
    const missing = test.needs.filter(n => !ctx.have.has(n));
    if (missing.length) {
      console.log(`skip ${test.id} ${test.name} (needs ${missing.join(', ')})`);
      continue;
    }
    let result;
    try {
      result = await test.run(ctx);
    } catch (err) {
      result = { checks: 0, failures: [`threw ${err.message.split('\n')[0]}`] };
    }
    const { checks = 0, failures = [], notes = [] } = result ?? {};
    if (failures.length) {
      failed++;
      console.log(`FAIL ${test.id} ${test.name} (${checks} checks, ${failures.length} failed)`);
      for (const line of failures) console.log(`       ${line}`);
    } else {
      console.log(`ok ${test.id} ${test.name} (${checks} checks)`);
    }
    for (const line of notes) console.log(`       note: ${line}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
