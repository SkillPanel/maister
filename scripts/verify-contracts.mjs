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
      errors.push(...lintDag(doc), ...lintGateContinue(doc));
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
  'gate-exactly-one-continue',
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

const ORCHESTRATORS = ['development', 'research', 'product-design', 'performance', 'migration'];
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
  // Extracted under `dist/` on purpose: Node then resolves `ajv` and `yaml`
  // from the repository's own `node_modules`, so the check needs no network.
  const extractRoot = path.join(distDir, '.verify-extract');
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
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
  fs.rmSync(extractRoot, { recursive: true, force: true });

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
