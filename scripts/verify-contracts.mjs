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
 *   2. tests      one `tNN(ctx)` per test, banner-titled, in id order T01-T45.
 *                 A constant used by a single test sits in that test's band.
 *   3. registry   the `TESTS` table (also id-ordered) and `main`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
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

/**
 * B1: an authored option is the bare effect or a map carrying that effect
 * beside the values the option emits. The count reads through here so the two
 * spellings stay one rule, exactly as the engine's own reader does.
 */
const optionEffect = option => (isObject(option) ? option.effect : option);

/** B1: a gate offers exactly one continue and at least one stop. */
function lintGateContinue(doc) {
  if (!isObject(doc) || !isObject(doc.nodes)) return [];
  const errors = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isObject(node) || node.type !== 'gate' || !isObject(node.options)) continue;
    const effects = Object.values(node.options).map(optionEffect);
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

/**
 * B1: a `direct:` node is executed out of the section named for it in the prose
 * companion beside the definition, so a companion that is absent, or present
 * with no such section, leaves the node with no implementation at all. This is
 * the one target scheme a static check can decide — `skill:`, `agent:` and
 * `workflow:` targets may be provided by an environment neither the runner nor
 * this suite can see, and are warnings there — so it stays an error here.
 *
 * The heading must *be* the node id, not mention it: a section titled "Notes on
 * intake failure modes" is prose about the node, and accepting it would report
 * an implementation that is not there.
 */
function lintDirectSection(doc, file) {
  if (!isObject(doc) || !isObject(doc.nodes)) return [];
  const companion = file.replace(/\.ya?ml$/i, '.md');
  const sections = new Set();
  if (companion !== file && isFile(companion)) {
    for (const row of fs.readFileSync(companion, 'utf8').split('\n')) {
      const line = row.replace(/\r$/, '');
      if (!line.startsWith('#')) continue;
      sections.add(line.replace(/^#+\s*/, '').replace(/`/g, '').trim());
    }
  }
  const errors = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isObject(node) || typeof node.uses !== 'string' || !node.uses.startsWith('direct:')) continue;
    const name = node.uses.slice('direct:'.length);
    if (name !== '' && sections.has(name)) continue;
    errors.push({
      instancePath: `/nodes/${id}/uses`,
      keyword: 'direct-missing-section',
      message: `the prose companion carries no section for "${name}"`,
    });
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
      errors.push(...lintDag(doc), ...lintGateContinue(doc), ...lintUnknownReference(doc),
        ...lintDirectSection(doc, file));
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
const CANONICAL_LIB = 'lib/canonical.mjs';

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
  'suspend the run with one gate-request call (it writes the request file, the gate index and '
  + 'gate_pending together — there is no second state write), rewrite dashboard-data.js, print GATE-PENDING: ';

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

/**
 * The pre-pass, as code. It was published as a shell one-liner for people to
 * run before staging, and it was never green: a `grep -E` spelling `[^\x00-\x7F]`
 * relies on GNU escape handling, so on the platform this repository is
 * developed on the class matched almost every line and the whole tree came back
 * as a hit. A scan that cries wolf on a clean checkout teaches everyone to skip
 * it, which is how nine files acquired typographic dashes with the rule in
 * force the whole time.
 *
 * Two halves, both of them properties of the corpus rather than of any one
 * fixture, which is why they ride the walk T02 already does over every file.
 *
 *   **ASCII-only.** Fixtures are compared byte-for-byte against what a writer
 *   produces, are read by two providers on three platforms, and travel through
 *   argv and environment variables on the way. A smart quote or an em dash in
 *   one is a portability hazard with no upside.
 *
 *   **No provenance tokens.** Nothing sampled from a real repository keeps its
 *   origin. The list is the corpus README's, extended per source repository.
 */
const FIXTURE_PROVENANCE_TOKENS =
  /devskiller|mapskiller|DEV-[0-9]|SKP-[0-9]|\/Users\/|boost|accommodation|dac_/;

/**
 * Every non-ASCII character in `text`, as `{line, column, code}`. Exported
 * shape rather than a boolean so a report can name where to look; a caller
 * asserting only that a clean file scans empty is the common case.
 */
function scanFixtureBytes(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    for (let column = 0; column < line.length; column += 1) {
      const code = line.codePointAt(column);
      if (code > 0x7f) found.push({ line: index + 1, column: column + 1, code });
    }
  });
  return found;
}

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

  // The pre-pass over every fixture file. The corpus README is out of scope for
  // the same reason it is not listed by a manifest: it is documentation about
  // the tree, and it necessarily spells the provenance tokens it tells you to
  // scan for.
  for (const file of present) {
    const where = path.relative(ctx.fixtures, file);
    const text = fs.readFileSync(file, 'utf8');
    checks++;
    const nonAscii = scanFixtureBytes(text);
    if (nonAscii.length) {
      const first = nonAscii[0];
      failures.push(`${where}: fixture bytes are ASCII-only — U+${first.code.toString(16).toUpperCase().padStart(4, '0')} at line ${first.line}, column ${first.column}${nonAscii.length > 1 ? ` (and ${nonAscii.length - 1} more)` : ''}`);
    }
    checks++;
    const token = text.match(FIXTURE_PROVENANCE_TOKENS);
    if (token) failures.push(`${where}: carries the provenance token "${token[0]}" — pseudonymize it`);
  }

  // The scanner's own negative: a fixture that is meant to be red has to come
  // back red, or a green tree proves only that nothing is being read.
  checks++;
  if (!scanFixtureBytes('an em dash — here').length) {
    failures.push('the fixture byte scan passed a deliberately dashed string');
  }
  checks++;
  if (scanFixtureBytes('plain ascii - here').length) {
    failures.push('the fixture byte scan reported an ASCII string');
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

/**
 * The hook version the shipped gate library stamps into its beacon. Named once
 * here so a contracts bump moves one literal rather than two assertions that
 * can drift apart.
 */
const EXPECTED_HOOK_VERSION = 'contracts-v2';

const RUNNER_KEYWORDS = new Set([
  'phase-status-cross-check', 'not_midnight', 'e2-one-line-form', 'b2-one-line-form',
  'a5-tldr-line-count', 'a5-block-position', 'dag-cycle', 'gate-option-id-unique',
  'gate-exactly-one-continue', 'reference-unknown-node', 'direct-missing-section',
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

/**
 * Reasons owned by other tests: reserved keys are T25, newer-format is T07, and
 * an unresolved reference is pinned live against the runner in T29. None of the
 * three is something the tolerant reader reports, so a manifest that declares
 * one must not enlist its fixture as a degradation case here.
 */
const isReaderReason = reason => reason !== 'newer-format'
  && !reason.startsWith('reserved-key:')
  && !reason.startsWith('unresolved-reference:');

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
      if (marker.provider !== 'claude' || marker.hook_version !== EXPECTED_HOOK_VERSION) {
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
      if (marker.provider !== 'copilot' || marker.hook_version !== EXPECTED_HOOK_VERSION) {
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
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'E1', 'E2', 'H1', 'R', 'T1',
];

/**
 * Contracts with no document of their own to reject, and why. C5 was on this
 * list while the outcome record was the whole of it — an unclassifiable record
 * is `unknown`, itself a valid outcome, so there was nothing to reject. The
 * prompt line is a document, and `contracts-v4` gave it a shape to fail: a
 * line with no `at=`.
 */
const NO_NEGATIVE_FIXTURE = new Map([
  ['A4', 'no schema — the negative direction is the enumerator inventory_only list (T10)'],
  ['B3', 'an alias of common#/$defs/phase_summary_value — negatives live under A1'],
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
  // The dispatch ledger and its whole import closure, staged under a non-plugin
  // root: the daemon vendors them from the archive, and nothing else ships them.
  'lib/ledger.mjs',
  'lib/canonical.mjs',
  'lib/definition.mjs',
];

/** The staged modules, in the order VERSION counts them. */
const TARBALL_LIB = ['lib/ledger.mjs', 'lib/canonical.mjs', 'lib/definition.mjs'];

// The tarball carries no plugin tree and no `.maister/tasks`, so the runner it
// ships must report every test that declares a need for either as `skip` —
// never as `FAIL`. Derived from the registry rather than listed, because a
// hand-kept list drifts silently in the one direction that matters: a
// tree-dependent test omitted from it is free to run over nothing in a
// tree-less archive and report success. `TESTS` is declared further down the
// file, so this reads it when `t27` runs rather than at module evaluation.
const TREE_DEPENDENT_NEEDS = ['plugin', 'in-repo'];
const treeDependentTests = () =>
  TESTS.filter(t => t.needs.some(n => TREE_DEPENDENT_NEEDS.includes(n))).map(t => t.id);

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
  //
  // Built here, into a throwaway directory, rather than read out of the
  // repository's `dist/`. That directory is git-ignored, so what it holds is
  // whatever a person last ran; the row used to take the newest `*.tar.gz` in
  // it by modification time, with nothing tying that file to the checkout being
  // tested. In practice it meant a hand-run `make tarball` before every suite
  // run - done by hand in at least four separate sessions - and a months-old
  // archive from an earlier release would have satisfied it just as well.
  //
  // Building it makes the row prove the tree in hand, needs no preparation on a
  // clean checkout, and leaves nothing behind for the next run to find.
  const distDir = tempDir('tarball');
  const built = runBounded(process.execPath,
    [path.join(ctx.repoRoot, 'scripts', 'build-tarball.mjs'), `--dist=${distDir}`],
    { encoding: 'utf8', cwd: ctx.repoRoot, maxBuffer: 16 * 1024 * 1024 });
  checks++;
  if (built.status !== 0) {
    failures.push(`the archive would not build: ${(built.stderr ?? '').trim().split('\n').pop() || `exit ${built.status}`}`);
    return { checks, failures, notes };
  }
  const archives = fs.readdirSync(distDir).filter(n => n.endsWith('.tar.gz'));
  checks++;
  if (archives.length !== 1) {
    failures.push(`the build produced ${archives.length} archives, expected exactly one`);
    return { checks, failures, notes };
  }
  const archive = { name: archives[0], full: path.join(distDir, archives[0]) };
  const tag = archive.name.replace(/\.tar\.gz$/, '');
  notes.push(`archive under test: ${archive.name}, built from this checkout`);

  // Checksum sidecar, in `shasum -a 256 -c` form. This is a gate, not a report:
  // the archive is listed, extracted and executed only once it verifies, so a
  // tarball dropped into the git-ignored `dist/` never gets run.
  const sidecar = `${archive.full}.sha256`;
  checks++;
  if (!isFile(sidecar)) {
    failures.push(`${archive.name}.sha256: missing — the archive is not opened`);
    return { checks, failures, notes };
  }
  const line = fs.readFileSync(sidecar, 'utf8').trim();
  const m = /^([0-9a-f]{64})\s{2}(\S+)$/.exec(line);
  checks++;
  if (!m) {
    failures.push(`${archive.name}.sha256: ${JSON.stringify(line)} is not \`<hex>  <filename>\` — the archive is not opened`);
    return { checks, failures, notes };
  }
  checks++;
  if (m[2] !== archive.name) {
    failures.push(`${archive.name}.sha256: names ${m[2]}, expected ${archive.name} — the archive is not opened`);
    return { checks, failures, notes };
  }
  checks++;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(archive.full)).digest('hex');
  if (actual !== m[1]) {
    failures.push(`${archive.name}.sha256: records ${m[1]}, the archive hashes to ${actual} — the archive is not opened`);
    return { checks, failures, notes };
  }

  const listed = runBounded('tar', ['-tzf', archive.full], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  checks++;
  if (listed.status !== 0) {
    failures.push(`tar -tzf ${archive.name} exited ${listed.status}: ${(listed.stderr ?? '').trim().split('\n')[0]}`);
    return { checks, failures, notes };
  }
  const entries = listed.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  const fileEntries = entries.filter(e => !e.endsWith('/'));
  for (const want of TARBALL_ENTRIES) {
    checks++;
    if (!entries.some(e => e.startsWith(`${tag}/${want}`))) {
      failures.push(`${archive.name}: no entry under ${tag}/${want}`);
    }
  }

  // The archive carries no plugin tree, and the staged library is why that has
  // to be asserted rather than assumed: `ctx.pluginRoot` is derived by walking
  // up from the schemas directory, so even a partial `plugins/` subtree could
  // flip capability detection inside the vendored runner and turn a required
  // `skip` into a `FAIL`.
  checks++;
  const pluginEntries = entries.filter(e => e.startsWith(`${tag}/plugins/`));
  if (pluginEntries.length) {
    failures.push(`${archive.name}: the tarball carries a plugin tree — ${pluginEntries.slice(0, 3).join(', ')}`);
  }

  // The staging dir is what was archived; a mismatch means files were dropped.
  const staging = path.join(distDir, tag);
  checks++;
  if (!isDir(staging)) {
    failures.push(`${tag}/: staging directory is missing — the entry count cannot be cross-checked`);
  } else {
    checks++;
    const staged = walkFiles(staging).length;
    if (fileEntries.length !== staged) {
      failures.push(`${archive.name}: ${fileEntries.length} file entries, ${tag}/ holds ${staged}`);
    }

    const versionFile = path.join(staging, 'VERSION');
    checks++;
    if (!isFile(versionFile)) {
      failures.push(`${tag}/VERSION: missing`);
    } else {
      let version = null;
      checks++;
      try {
        version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      } catch (err) {
        failures.push(`${tag}/VERSION: does not parse — ${err.message.split('\n')[0]}`);
      }
      if (version) {
        for (const key of ['tag', 'git_sha', 'plugin_version', 'built_at', 'fixture_count', 'schema_count']) {
          checks++;
          if (version[key] === undefined || version[key] === null || version[key] === '') {
            failures.push(`${tag}/VERSION: ${key} is missing`);
          }
        }
        checks++;
        if (version.tag !== tag) failures.push(`${tag}/VERSION: tag is ${JSON.stringify(version.tag)}, expected ${JSON.stringify(tag)}`);
        // The archive describes the checkout it was built from, and this row
        // only speaks for the checkout it is running in. An archive stamped
        // with any other commit is a different tree's evidence, so it is
        // refused rather than read - which is the whole of what kept a stale
        // build believable before the row started building its own.
        checks++;
        const head = runBounded('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ctx.repoRoot });
        if (head.status !== 0) {
          notes.push('git rev-parse HEAD is unavailable, so the archive is not held to a commit');
        } else if (String(version.git_sha) !== head.stdout.trim()) {
          failures.push(`${tag}/VERSION: git_sha is ${JSON.stringify(version.git_sha)}, and this checkout is at ${head.stdout.trim()}`);
        }
        checks++;
        if (!A6_TIMESTAMP.test(String(version.built_at ?? ''))) {
          failures.push(`${tag}/VERSION: built_at ${JSON.stringify(version.built_at ?? null)} is not an A6 timestamp`);
        }
        const manifest = path.join(ctx.repoRoot, 'plugins/maister/.claude-plugin/plugin.json');
        if (isFile(manifest)) {
          checks++;
          const declared = readJson(manifest).version;
          if (version.plugin_version !== declared) {
            failures.push(`${tag}/VERSION: plugin_version ${JSON.stringify(version.plugin_version)} ≠ plugin.json ${JSON.stringify(declared)}`);
          }
        }
        checks++;
        if (version.schema_count !== fs.readdirSync(ctx.schemas).filter(n => n.endsWith('.schema.json')).length) {
          failures.push(`${tag}/VERSION: schema_count ${JSON.stringify(version.schema_count)} ≠ the number of shipped schemas`);
        }
      }
    }
  }

  // -- the staged library and its closure ----------------------------------
  // Re-derived from the staged bytes rather than from the builder: the staging
  // list is what would go stale when a fourth dependency is added, and reading
  // the imports back out of what was actually staged is the only way to notice.
  if (isDir(staging)) {
    checks++;
    const versionDoc = isFile(path.join(staging, 'VERSION')) ? readJson(path.join(staging, 'VERSION')) : {};
    if (versionDoc.lib_count !== TARBALL_LIB.length) {
      failures.push(`${tag}/VERSION: lib_count ${JSON.stringify(versionDoc.lib_count)} ≠ the ${TARBALL_LIB.length} staged modules`);
    }
    for (const relative of TARBALL_LIB) {
      const staged = path.join(staging, ...relative.split('/'));
      checks++;
      if (!isFile(staged)) {
        failures.push(`${tag}/${relative}: not staged`);
        continue;
      }
      const text = fs.readFileSync(staged, 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^\n]*?from\s+'([^']+)'/gm)) {
        const spec = m[1];
        if (spec.startsWith('node:')) continue;
        checks++;
        if (!spec.startsWith('./') || !isFile(path.join(staging, 'lib', spec.slice(2)))) {
          failures.push(`${tag}/${relative}: imports ${spec}, which the flattened archive cannot resolve`);
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
      failures.push(`tar -xzf ${archive.name} exited ${untar.status}: ${(untar.stderr ?? '').trim().split('\n')[0]}`);
      return { checks, failures, notes };
    }
    const root = path.join(extractRoot, tag);
    const runner = path.join(root, 'scripts', 'verify-contracts.mjs');
    checks++;
    if (!isFile(runner)) {
      failures.push(`${archive.name}: the extracted archive has no scripts/verify-contracts.mjs`);
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
    for (const id of treeDependentTests()) {
      checks++;
      if (!lines.some(l => l.startsWith(`skip ${id} `))) {
        failures.push(`the vendored runner did not skip ${id} — the tarball carries no plugin tree`);
      }
    }
    // Nothing else in the suite executes the staged library: T27 runs only the
    // vendored runner, so a dependency that was never staged stays green in CI
    // and surfaces in the daemon. This is a resolution check, not a behavioural
    // one, and it is the guard against a fourth dependency being added later
    // without being staged beside the three that are.
    const stagedLedger = pathToFileURL(path.join(root, 'lib', 'ledger.mjs')).href;
    const resolved = runBounded(process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(stagedLedger)})`],
      { encoding: 'utf8', timeout: ARCHIVE_TIMEOUT_MS });
    checks++;
    if (resolved.status !== 0) {
      failures.push(`import(<archive>/lib/ledger.mjs) exited ${resolved.status}: ${(resolved.stderr ?? '').trim().split('\n')[0]}`);
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
const TUNED_GRAPH_HASH = 'sha256:47f78ff9e971ee66d0cc932870ff890727030b255f11cd5d3af8d01c432e2c5c';
const TUNED_LEAN_GRAPH_HASH = 'sha256:fe8336c0bb1a99fd9730d9fa9a31bb839392a82ee10fbae63a6d647eac6681d8';

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
 * Every overlay the repository ships, resolved against the base it declares.
 *
 * The list is written here rather than discovered because an overlay is named
 * by its content, not by its extension: `research-tuned.overlay.yml` and a bare
 * `overlay.yml` are both overlays, and a definition named `*.overlay.yml` is
 * not. Adding a fixture without a row here leaves it standalone-validated only,
 * which is exactly the gap that let one ship naming four node ids no base
 * declares.
 */
const OVERLAY_FIXTURES = [
  'synthetic/workflow-definition/overlay.yml',
  'synthetic/workflow-overlay/research-tuned/research-tuned.overlay.yml',
];

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
    hash: 'sha256:7332851263e5ea3428795fc45c22651395701c48b8b602d3d03e525bba95f869',
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
  plan: {
    hash: 'sha256:9fa47c2bcc7830faa9bb8064d228d7a3181a860d0da25a8ea268c1c877990598',
    twin: 'plan-builtin.yml',
    nodes: ['standards-discovery', 'plan', 'plan-approval', 'handoff'],
    edits: [
      ['an edited gate question',
        'ask: "Plan complete', 'ask: "Plan drafted'],
      ['a renamed continue option',
        'continue-to-handoff: continue', 'proceed-to-handoff: continue'],
      ['a retyped hand-off value',
        'plan_outcome: {enum: [approved, plan-only]}', 'plan_outcome: {enum: [approved, draft-only]}'],
    ],
  },
  research: {
    hash: 'sha256:8c806c4ddc046e9b35911e918f46e2b69acdbe5431efd9c3dcee8125918c8b61',
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

  // Read off the schema rather than restated here: the resolver's output and
  // the state block that receives it are held to one pattern, so widening the
  // contract cannot leave this walk asserting the old spelling.
  const graphHashPattern = new RegExp(
    readJson(path.join(ctx.schemas, 'workflow-state.schema.json')).properties.graph_hash.pattern,
  );

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

  // An unresolvable `skill:` target warns and the document is accepted. Pinned
  // here rather than left to the fixture's own `expect.warnings`: the only
  // corpus-wide consumer of that key is hard-wired to the reserved-key fixture,
  // so a manifest declaring the warning would assert nothing. Reverting the
  // relaxation turns this into a rejection and `validated` reports it.
  const external = path.join(ctx.fixtures, 'synthetic', 'external-skill-reference', 'external-skill-reference.yml');
  const externalManifest = readJson(path.join(path.dirname(external), 'manifest.json'));
  const outside = validated('external-skill-reference.yml', `--definition=${external}`);
  checks++;
  if (outside) pinned('external-skill-reference.yml', outside.warnings, externalManifest.expect.warnings);

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
      // The hash the resolver prints is the hash a freeze writes into state, so
      // it is held to the state block's own pattern rather than to a spelling
      // repeated here. A bare digest satisfies every other assertion in this
      // walk and is refused by B2 the moment a stricter reader than ours reads
      // the file it lands in.
      checks++;
      if (!graphHashPattern.test(graph.graph_hash)) {
        failures.push(`the shipped ${name} definition emits ${graph.graph_hash}, which the workflow block's graph_hash does not accept`);
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

  // -- every shipped overlay resolves onto the base it declares -------------
  //
  // Standalone validation checks an overlay's *shape*: it resolves no
  // reference and never applies the overlay to anything, so an overlay naming
  // node ids no base declares passes it. One shipped fixture did, on four ids
  // at once, while also adding a node whose target named a command rather than
  // a skill and tuning a provider onto a node with no dispatch directory —
  // three defects in one file, none reachable by any check, in the kind of file
  // a reader copies. Every overlay fixture is now resolved against the built-in
  // its own `extends` names, with the errors and the unresolved-reference
  // warnings both held empty.
  for (const overlay of OVERLAY_FIXTURES) {
    const file = path.join(ctx.fixtures, ...overlay.split('/'));
    checks++;
    if (!isFile(file)) {
      failures.push(`${overlay}: the overlay fixture is absent`);
      continue;
    }
    const declared = /^extends:\s*(\S+)\s*$/m.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null;
    checks++;
    const base = declared === null ? null
      : definitions.find(each => each.name === declared.replace(/^builtin:/, ''))?.file ?? null;
    if (!base) {
      failures.push(`${overlay}: extends ${JSON.stringify(declared)}, which is not a shipped built-in`);
      continue;
    }
    const applied = resolved(`${overlay} onto ${declared}`, `--definition=${base}`, `--overlay=${file}`);
    if (!applied) continue;
    checks++;
    if (applied.warnings.length) {
      failures.push(`${overlay}: resolves with warnings — ${JSON.stringify(applied.warnings)}`);
    }
    // Every profile it declares, too: a profile is another route through the
    // same operations, and the fast profile of the fixture that carried the
    // defects disabled two ids the base never had.
    const profiles = Object.keys(parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS)?.profiles ?? {});
    for (const profile of profiles) {
      const route = resolved(`${overlay} onto ${declared} --profile=${profile}`,
        `--definition=${base}`, `--overlay=${file}`, `--profile=${profile}`);
      if (!route) continue;
      checks++;
      if (route.warnings.length) {
        failures.push(`${overlay} --profile=${profile}: resolves with warnings — ${JSON.stringify(route.warnings)}`);
      }
    }
  }

  // -- provider implies dir, on the resolved node ---------------------------
  //
  // The schema conditional that backs B1's implication judges a definition as
  // authored, so it never sees a provider an overlay *tuned* onto a node that
  // carries none — which is how the fixture above shipped one. The runner
  // states the rule itself, and this is the tune that proves it.
  {
    const base = definitions.find(each => each.name === RESEARCH)?.file ?? null;
    const file = path.join(tempDir('overlay-provider'), 'provider-without-dir.overlay.yml');
    fs.writeFileSync(file, ['extends: builtin:research', 'version: 1', 'tune:',
      '  completion:', '    provider: copilot', ''].join('\n'), 'utf8');
    const out = run('resolve', `--definition=${base}`, `--overlay=${file}`);
    checks++;
    if (out.report?.ok !== false) {
      failures.push('a provider tuned onto a node with no dir was accepted');
    } else {
      checks++;
      if (!out.report.errors.some(error => error.path === 'nodes.completion.provider')) {
        failures.push(`the provider error is not located at the node: ${JSON.stringify(out.report.errors)}`);
      }
    }
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
    .map(each => `${each.name} ${(graphs.get(each.name)?.graph_hash ?? '-').slice(7, 15)}...`).join(', ')}`);
  notes.push(`${Object.values(WORKFLOW_PINS).filter(pin => pin.twin).length} synthetic twin(s) compared; the two overlay routes hash to ${TUNED_GRAPH_HASH.slice(7, 15)}... and ${TUNED_LEAN_GRAPH_HASH.slice(7, 15)}...`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T30 — workflow state writer
// ---------------------------------------------------------------------------

const CHAIN_TEMPLATE_STATE = path.join('synthetic', 'gate', 'chain-template', 'orchestrator-state.yml');
/**
 * A state the writer itself emitted, carrying all three frozen decision shapes
 * — the two object forms and a bare string. It is checked in rather than only
 * emitted here so the spelling outlives a build that stops producing it, and
 * because the reader that used to refuse it is the one the umbrella reads run
 * state through.
 */
const OBJECT_DECISION_STATE = path.join('synthetic', 'runs', 'decisions-as-objects', 'orchestrator-state.yml');
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

  // -- the writer's structural self-check is declared, not merely true -------
  //
  // `write-state` holds the document it wrote to duplicate-key and injection
  // rules and never to a schema: a consumer checkout carries neither a YAML
  // package nor a validator. That is a deliberate limit rather than an
  // oversight, so a caller has to be able to read it without opening the
  // source — which is what this pins. Both halves are asserted, because the
  // statement is only useful if it also says what the caller must do instead.
  const engineSkill = path.join(engine, 'SKILL.md');
  checks++;
  if (!isFile(engineSkill)) {
    failures.push(`${ENGINE}/SKILL.md is absent`);
  } else {
    const prose = fs.readFileSync(engineSkill, 'utf8');
    checks++;
    if (!/structurally, not against a schema, and that\s+is\s+deliberate/.test(prose)) {
      failures.push("SKILL.md does not declare the state writer's structural self-check as deliberate");
    }
    checks++;
    if (!/carried forward from the file when a patch omits\s+them/.test(prose)) {
      failures.push('SKILL.md does not state that the frozen workflow scalars survive a merge');
    }
  }

  // `gate-lib.mjs` is the acceptance oracle: the writer is the inverse of the
  // reader a consumer's hook actually runs, so the reader judges the writer.
  const { writeState } = await import(pathToFileURL(path.join(engine, 'scripts', 'lib', 'state.mjs')).href);
  const { parseDefinition } = await import(pathToFileURL(path.join(engine, 'scripts', 'lib', 'definition.mjs')).href);
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
      node_summaries: {
        'research-foundation': {
          summary: 'a prose line',
          artifacts: { report: 'a/b.md' },
          // B3 permits a decision entry to be an object, and this is the shape
          // the writer emits for one: a block mapping opened on the sequence
          // dash. It is written here so the two-reader block below judges the
          // writer's own output on it — the construct the runtime reader used
          // to refuse, which made a run's summaries unreadable to the guard
          // that reads run state.
          decisions: [
            { decision: 'freeze the graph before the first node', rationale: 'a re-resolve mid-run is a different graph' },
            'a bare string entry, the other frozen shape',
          ],
        },
      },
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

      // -- the frozen scalars survive a later workflow patch that omits them --
      //
      // A re-freeze that rewrites only `nodes` is the ordinary shape of a
      // second `workflow:` patch, and the block is re-emitted whole. The six
      // scalars beside `nodes:` are carried forward from the file rather than
      // dropped with the rest of it, because a run whose `graph_hash` vanished
      // has lost the one thing that proves the frozen graph against the
      // definition it came from — and the envelope refuses to dispatch it.
      const held = write(indented, {
        workflow: {
          nodes: {
            'research-foundation': { kind: 'task', status: 'completed', needs: [] },
            'foundation-approval': { kind: 'gate', status: 'pending', needs: ['research-foundation'] },
          },
        },
      });
      checks++;
      if (!held.ok) {
        failures.push(`a workflow patch carrying only nodes was refused: ${JSON.stringify(held.errors)}`);
      } else {
        const after = fs.readFileSync(indented, 'utf8').split('\n');
        checks++;
        const scalarLine = key => after.find(line => line.startsWith(`  ${key}:`))?.slice(`  ${key}:`.length).trim() ?? null;
        const carried = Object.entries({
          source: 'builtin:research',
          overlays: '[]',
          profile: 'default',
          graph_hash: `sha256:${'a'.repeat(64)}`,
          grammar_version: '1',
          name: 'research',
        }).filter(([key, want]) => (scalarLine(key) ?? '').replace(/^"|"$/g, '') !== want);
        if (carried.length) {
          failures.push(`a workflow merge dropped or changed ${carried.map(([key]) => key).join(', ')}`);
        }
        // The control: a patch that *does* name a scalar replaces it, so the
        // carry-forward cannot be an emitter that ignores the patch.
        const replaced = write(indented, {
          workflow: {
            graph_hash: `sha256:${'b'.repeat(64)}`,
            nodes: { 'research-foundation': { kind: 'task', status: 'completed', needs: [] } },
          },
        });
        checks++;
        const text = fs.readFileSync(indented, 'utf8');
        if (!replaced.ok || !text.includes(`sha256:${'b'.repeat(64)}`)
          || text.includes(`sha256:${'a'.repeat(64)}`)) {
          failures.push('a workflow patch naming graph_hash did not replace the held value');
        }
        // And `name` survives, so `contextBlock` still resolves after a merge.
        checks++;
        if (!/^ {2}name: "?research"?$/m.test(text)) {
          failures.push('the workflow name did not survive a patch that named another scalar');
        }
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

      // The fourth reader, and the one the rest of the runtime uses. The
      // umbrella reads run state through the definition reader — the collision
      // guard's whole judgement rests on it — so a document this writer accepts
      // has to be a document that reader accepts, agreeing with the suite's
      // parser about what it says rather than merely not throwing. It did not:
      // the writer emits a block mapping on a sequence dash for every object in
      // a list, and the reader refused exactly that, which left a chain's run
      // states unreadable to the runtime that wrote them.
      checks++;
      const runtime = parseDefinition(text, file);
      if (runtime.doc === null) {
        failures.push(`${rel(file)}: the runtime reader refuses the writer's own output — ${runtime.errors[0]?.message}`);
      } else {
        checks++;
        const seen = JSON.parse(JSON.stringify(runtime.doc));
        if (JSON.stringify(seen) !== JSON.stringify(parsed)) {
          failures.push(`${rel(file)}: the runtime reader and a real YAML parser disagree about the emitted file`);
        }
      }
    }

    // -- the frozen fixture of the writer's object-decision spelling ---------
    //
    // The checks above judge texts this run emitted; this judges the one that
    // is checked in, so the shape survives a build that stops emitting it. B3
    // permits a decision entry to be an object and the writer spells one as a
    // block mapping opened on a sequence dash. Three readers are held to the
    // same document: the hook's, which is what the gate enforcement runs; the
    // runtime's, which is what the collision guard reads run state through and
    // which used to refuse this file outright; and a real YAML parser.
    const frozen = path.join(ctx.fixtures, OBJECT_DECISION_STATE);
    checks++;
    if (!isFile(frozen)) {
      failures.push(`${OBJECT_DECISION_STATE} is absent`);
    } else {
      const text = fs.readFileSync(frozen, 'utf8');
      checks++;
      if (!/^ +- decision: /m.test(text)) {
        failures.push(`${OBJECT_DECISION_STATE} no longer carries an object decision on a sequence dash`);
      }
      const runtime = parseDefinition(text, frozen);
      checks++;
      if (runtime.doc === null) {
        failures.push(`${OBJECT_DECISION_STATE}: the runtime reader refuses it — ${runtime.errors[0]?.message}`);
      } else {
        checks++;
        if (JSON.stringify(JSON.parse(JSON.stringify(runtime.doc))) !== JSON.stringify(parseYaml(text, YAML_OPTS))) {
          failures.push(`${OBJECT_DECISION_STATE}: the runtime reader and a real YAML parser disagree`);
        }
        checks++;
        const decisions = runtime.doc.node_summaries?.['research-foundation']?.decisions;
        if (!Array.isArray(decisions) || decisions.length !== 3
          || decisions[0]?.decision !== 'Token bucket over a sliding window'
          || decisions[0]?.rationale !== 'a burst allowance is a product requirement, and a window has none'
          || typeof decisions[2] !== 'string') {
          failures.push(`${OBJECT_DECISION_STATE}: the runtime reader did not read the three frozen decision shapes back`);
        }
      }
      checks++;
      try { scanState(text); } catch (err) { failures.push(`${OBJECT_DECISION_STATE}: the hook reader threw ${err.message}`); }
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
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href))
        // The copy lives outside the plugin tree, so every plugin-root import the
        // writer carries — the hook's reader and the shared write primitives —
        // has to be re-pointed at an absolute URL or the copy will not load.
        .replace(/'\.\.\/\.\.\/\.\.\/\.\.\/lib\/canonical\.mjs'/,
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, CANONICAL_LIB)).href));
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

    expect('a prototype member is not a workflow name, a node id or a status', () => {
      // Bracket access on a plain-object map answers for `Object.prototype`'s
      // members, and every answer is truthy. `name: constructor` walked past
      // the refusal above and wrote `function Object() { [native code] }:` as a
      // top-level YAML key — a corrupt file that passed the self-check, the
      // structure check and the hook's own reader at exit 0.
      for (const name of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
        const file = state(BASE_STATE.replace('  name: research\n', `  name: ${name}\n`));
        const before = read(file);
        const res = writeState({ state: file, patch: { context: { k: 'v' } } });
        assert(res.ok === false, `the workflow name "${name}" was accepted`);
        assert(refusal(res) === 'state-context-block-unknown',
          `the workflow name "${name}" refused ${refusal(res)}, expected state-context-block-unknown`);
        assert(read(file) === before, `the file changed although "${name}" was refused`);
      }

      // The same read on the other two maps. Both are legal inputs, so they are
      // written rather than refused — what must not happen is a prototype
      // member reaching the file as a value.
      const file = state();
      const res = writeState({
        state: file,
        patch: {
          nodes: { constructor: { kind: 'task', status: 'running' } },
          node_summaries: { constructor: { summary: 'x' }, toString: { node: 'constructor', summary: 'y' } },
        },
      });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      const text = read(file);
      assert(!/native code/.test(text), 'a prototype member reached the state file');
      assert(!/function Object/.test(text), 'a prototype member reached the state file');
      assert(/^ {4}constructor: \{kind: task, status: running/m.test(text),
        `the node entry reads ${JSON.stringify(text.split('\n').find(l => l.includes('constructor:')))}`);
      // `status: running` mirrors to `in_progress`; `toString` names no status
      // the mirror carries, so nothing is mirrored rather than a function being.
      assert(/status: in_progress/.test(text), 'the summary status was not mirrored');
      assert(text.split('\n').every(line => !/status: (?:function|\[object)/.test(line)),
        'a prototype member was mirrored as a status');
    });

    expect('an existing context block is ignored when the name gives none', () => {
      const file = state(`${BASE_STATE.replace('  name: research\n', '')}\nmigration_context:\n  phase_summaries: {}\n`);
      const res = writeState({ state: file, patch: { phase_summaries: { 'phase-1': { summary: 'x' } } } });
      assert(res.ok === true, `refused: ${JSON.stringify(res.errors)}`);
      assert(/^migration_context:$/m.test(read(file)), 'the existing block was not adopted');
      assert(!/research_context/.test(read(file)), 'research_context was written beside an existing block');
    });

    expect('a temp stamped in the future is reclaimed rather than wedging the file forever', () => {
      // Age was `now - mtime`, so a future mtime gave a negative age, a negative
      // age is never past the stale threshold, and the refusal said to wait a
      // minute — forever. NTP stepping the clock back, a network filesystem
      // whose server clock runs ahead and a backup restore that preserves
      // mtimes all produce it, and under a pending gate there is no shell to
      // delete the file with.
      const file = state();
      const tmp = path.join(path.dirname(file), 'orchestrator-state.yml.tmp');
      fs.writeFileSync(tmp, "a dead writer's bytes\n", 'utf8');
      const ahead = new Date(Date.now() + 10 * 60_000);
      fs.utimesSync(tmp, ahead, ahead);
      const res = writeState({ state: file, patch: { task: { status: 'completed' } } });
      assert(res.ok === true,
        `a temp stamped in the future wedged the write: ${JSON.stringify(res.errors)}`);
      assert(/status: completed/.test(read(file)), 'the write did not land');
      assert(!fs.existsSync(tmp), 'the reclaimed temp was left behind');

      // A temp stamped just ahead of now is still a live writer's: only the
      // threshold's worth of skew is called a leftover, in either direction.
      const held = path.join(path.dirname(file), 'orchestrator-state.yml.tmp');
      fs.writeFileSync(held, 'live writer bytes\n', 'utf8');
      const soon = new Date(Date.now() + 5_000);
      fs.utimesSync(held, soon, soon);
      const second = writeState({ state: file, patch: { task: { status: 'in_progress' } } });
      assert(second.ok === false, "a live writer's temp was reclaimed");
      assert(refusal(second) === 'state-temp-exists', `expected state-temp-exists, got ${refusal(second)}`);
      assert(read(held) === 'live writer bytes\n', "the live writer's bytes were destroyed");
      fs.rmSync(held, { force: true });
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
      // The two halves live in two files since the write primitives were
      // shared: the frozen name is the writer's, because only the writer knows
      // which name the gate allow-list carries, and the publish path is the
      // plugin-root library's, because every writer in the plugin uses it.
      const src = fs.readFileSync(stateSrc, 'utf8');
      const lib = fs.readFileSync(path.join(ctx.pluginRoot, CANONICAL_LIB), 'utf8');
      assert(/const TMP_NAME = 'orchestrator-state\.yml\.tmp';/.test(src), 'the frozen temp name changed');
      assert(/openSync\(\s*tmp,\s*'wx'\s*\)/.test(lib), 'the temp file is not opened exclusively');
      assert(/fsyncSync\(/.test(lib), 'the temp file is not fsynced before the rename');
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
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href))
        // The copy lives outside the plugin tree, so every plugin-root import the
        // writer carries — the hook's reader and the shared write primitives —
        // has to be re-pointed at an absolute URL or the copy will not load.
        .replace(/'\.\.\/\.\.\/\.\.\/\.\.\/lib\/canonical\.mjs'/,
          JSON.stringify(pathToFileURL(path.join(ctx.pluginRoot, CANONICAL_LIB)).href));
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

/** Every checklist section, with the row count it pins; 221 rows in total. */
const DEV_SECTIONS = [
  ['Nodes', 27],
  ['Guards', 12],
  ['Run-scoped context set', 4],
  ['Mandatory gate texts', 11],
  ['Pre-gate executive summaries', 6],
  ['Stop-path termination', 11],
  ['In-node questions', 10],
  ['Artifacts', 25],
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
const DEV_TOTAL_ROWS = 221;

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
  {
    // The plugin-root variable, one name per provider vocabulary. Claude Code
    // exports `CLAUDE_PLUGIN_ROOT`; Copilot CLI exports no plugin-directory
    // variable at all, so the variant names its own and its install notes ask
    // the operator to export it. Skills only — `hooks.json` is a Claude surface
    // the variant does not inherit, and no `.mjs` is rewritten: the runtime
    // reads both spellings at call time.
    scope: 'skills',
    sed: "s/CLAUDE_PLUGIN_ROOT/MAISTER_PLUGIN_ROOT/g",
    apply: text => text.split('CLAUDE_PLUGIN_ROOT').join('MAISTER_PLUGIN_ROOT'),
  },
];

/**
 * What the walk cannot compare path-for-path, and why.
 *
 * `hooks/` is rearranged rather than copied — the generator drops the
 * Claude-shaped registration directory and emits a Copilot one under
 * `.github/hooks/` — and `plugin.json` is rewritten by two `sed` passes of its
 * own, asserted below by what those passes must have produced rather than by
 * byte equality. Everything else is either a byte copy or replayable markdown.
 *
 * `README.md` is the variant's install surface and has no counterpart in the
 * source tree: the source plugin is installed through a host that exports its
 * own plugin-root variable, and this one is not, so the variant has to say
 * where its files landed. It is authored beside the build and copied in, which
 * is why it appears in the variant and not in the source.
 */
const VARIANT_UNCOMPARED = ['hooks/', '.github/', '.claude-plugin/plugin.json', 'README.md'];

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
// T35-T38 — the umbrella runtime
// ===========================================================================

/**
 * The four tests below are behavioural: they execute the shipped writers rather
 * than reading them, because every one of the properties they pin is invisible
 * to a schema. A manifest that validates can still have been written outside
 * `.maister/`; a ledger entry that validates can still have been published
 * before its log line; an emitted script that lints can still fail to resolve
 * its own import.
 *
 * They share one small accumulator so a broken property is reported instead of
 * crashing the test and hiding the twenty that still hold.
 */

/** An assertion one of these tests made, as opposed to an unexpected throw. */
class CheckFailed extends Error {}

const must = (condition, why) => { if (!condition) throw new CheckFailed(why); };

const equalJson = (actual, expected, what) => must(
  JSON.stringify(actual) === JSON.stringify(expected),
  `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
);

function checker() {
  const state = { checks: 0, failures: [], notes: [] };
  const record = (label, err) => {
    state.failures.push(err instanceof CheckFailed
      ? `${label}: ${err.message}`
      : `${label}: threw ${err?.constructor?.name ?? 'Error'} — ${String(err?.message ?? err).split('\n')[0]}`);
  };
  state.check = (label, body) => {
    state.checks++;
    try {
      body();
    } catch (err) {
      record(label, err);
    }
  };
  state.checkAsync = async (label, body) => {
    state.checks++;
    try {
      await body();
    } catch (err) {
      record(label, err);
    }
  };
  return state;
}

/** The report a refused call returns, or the code a thrown Refusal carried. */
function refusalCodes(result) {
  return (result?.errors ?? []).map(e => e.code);
}

/**
 * Call `body` expecting a `Refusal`; return its code. Every umbrella library
 * throws `Refusal` from its build half and returns a report from its verb half,
 * so both spellings are collected the same way.
 */
function caught(body) {
  try {
    body();
  } catch (err) {
    if (err instanceof CheckFailed) throw err;
    if (typeof err?.code === 'string') return err.code;
    throw err;
  }
  throw new CheckFailed('nothing was thrown, expected a Refusal');
}

// ---------------------------------------------------------------------------
// T35 — the umbrella runtime, over the live writers
// ---------------------------------------------------------------------------

const UMBRELLA_SCRIPTS = 'skills/umbrella/scripts';
const SEED_FIXTURE_DIR = path.join('synthetic', 'worker-seed');

/**
 * The filename prefixes the golden seed triples in that directory carry. The
 * empty one is the original `skill:` target, whose three files keep the paths
 * they have always had; each further stem is another rendering of the task
 * section that would otherwise be pinned by nothing — another target scheme,
 * or, for the `workflow:` branch, a second definition, since that branch is
 * written once and renders for every definition a chain can name.
 *
 * The `attended.` stem is there for a different reason: it is the only one that
 * renders the relayed tier. Every other stem dispatches at a tier whose
 * permissions either reach a pull request outright or cannot reach one at all,
 * and those are the two close-out branches the goldens pinned. The third —
 * required, but through an operator approving a held command — is the branch a
 * defect shipped in once, and it was pinned by nothing. It is also the only
 * branch that changes the identity section, which tells a relayed worker not to
 * route around a held command.
 */
const SEED_FIXTURE_STEMS = ['', 'workflow-target.', 'workflow-target-development.', 'attended.'];

/**
 * Tiers the goldens do not render, each against the tier whose golden already
 * carries the same prompt. `auto-medium` widens `auto-low`'s permissions
 * without reaching a pull request, so it takes the same close-out branch and the
 * same identity line; the only difference in the rendered prompt is the tier's
 * own name. The check below proves that claim rather than trusting it, so an
 * edit that makes the two diverge fails here instead of shipping unpinned.
 */
const SEED_TIER_EXEMPT = new Map([['auto-medium', 'auto-low']]);

/**
 * Every refusal the umbrella runtime names. The set is closed by design — the
 * SKILL documents a recovery for each — so the test asserts coverage of the
 * whole list rather than of the handful a change happened to touch. A code that
 * cannot be provoked portably is listed in `PLATFORM_GATED_REFUSALS` with the
 * reason, and is reported as a note rather than silently dropped.
 *
 * **The list is checked against the runtime in both directions.** It used to be
 * checked only one way — list → provoked — so a code the runtime raised but the
 * list never named passed a green suite, and the coverage note printed more
 * refusals provoked than the list declared, which is arithmetically impossible
 * and was ignored for two rounds. `sweepRefusalCodes` now derives the set the
 * umbrella sources actually manufacture and holds it equal to this list, and
 * the coverage assertion holds the provoked set inside it, so a code cannot
 * escape the list by being added to the code.
 *
 * "The SKILL documents a recovery for each" used to be a claim in this comment
 * and nowhere else, while the assertion below only checked that each code was
 * *provoked*. A code whose documented recovery was wrong — "wait a minute and
 * re-issue" for a refusal raised after the mutation had already been published,
 * which silently applied it a second time — passed a green suite. The comment
 * is now load-bearing: `t.check('the SKILL documents…')` reads the shipped
 * tables, matches them against this list in both directions, and holds the
 * post-publish recoveries to saying so.
 */
const UMBRELLA_REFUSALS = [
  'umbrella-root-unusable', 'umbrella-member-unreadable', 'umbrella-members-root-outside',
  'umbrella-manifest-exists', 'umbrella-unwritable', 'umbrella-temp-exists',
  'umbrella-chain-open', 'umbrella-chain-missing', 'umbrella-run-unreadable',
  'dispatch-node-incomplete', 'dispatch-autonomy-unknown', 'dispatch-autonomy-unresolved',
  'dispatch-graph-drifted', 'dispatch-envelope-exists', 'dispatch-unwritable', 'dispatch-temp-exists',
  'dispatch-workflow-not-driver-capable', 'dispatch-run-unresolved', 'dispatch-closeout-impossible',
  'seed-envelope-invalid', 'seed-over-cap',
  'ledger-locked', 'ledger-entry-missing', 'ledger-entry-exists', 'ledger-entry-unreadable',
  'ledger-op-unknown', 'ledger-args-invalid', 'ledger-status-illegal', 'ledger-unwritable',
  'ledger-log-unappendable', 'ledger-temp-exists',
  'outbox-message-invalid', 'outbox-type-invalid', 'outbox-sequence-taken', 'outbox-unwritable',
  'outbox-unreadable',
  'value-not-flow-safe',
];

/**
 * Every documented recovery in the shipped SKILL's refusal tables, by code.
 *
 * A row is a table row whose first cell is a backticked token shaped like a
 * refusal code. The flag table beside them keys on underscored names and is
 * deliberately not matched. A code may hold several rows — one per subsystem
 * table that names it — and each is checked.
 */
function skillRows(skill) {
  const rows = new Map();
  for (const found of skill.matchAll(/^\|\s*`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`\s*\|(.*)\|\s*$/gm)) {
    if (!rows.has(found[1])) rows.set(found[1], []);
    rows.get(found[1]).push(found[2].trim());
  }
  return rows;
}

/** The two refusals that need a filesystem mode win32 has no equivalent for. */
const PLATFORM_GATED_REFUSALS = new Map([
  ['outbox-unreadable', 'a directory that can be entered but not listed is a POSIX mode'],
  ['dispatch-unwritable', 'a directory that exists but cannot be written into is a POSIX mode'],
]);

/**
 * The refusal codes the umbrella sources manufacture, read out of the sources.
 *
 * Three positions produce a `Refusal` in this runtime and there is no fourth:
 * a literal `new Refusal('code', …)`, and the two shapes the shared publish
 * helpers take their codes in — `{unwritable, tempExists}` handed to `commit`
 * and `openTemp`, and the `{code, unwritable}` `claimLock` takes. A code is
 * counted only when it is spelled in one of those positions *and* carries a
 * refusal prefix, so the validation-error codes that ride the same `code:` key
 * (`duplicate-member-name` and its neighbours) are not mistaken for refusals.
 *
 * Deriving beats hand-keeping because the failure this closes was a hand-kept
 * list: two codes reached the shipped runtime — one of them a containment fix
 * added in the round that added the guard — while the list, the SKILL tables
 * and the coverage assertion all stayed as they were.
 */
const REFUSAL_PREFIX = /^(?:umbrella|dispatch|seed|ledger|outbox)-[a-z0-9]+(?:-[a-z0-9]+)*$|^value-not-flow-safe$/;

function sweepRefusalCodes(scriptsDir) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(scriptsDir);
  const found = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const add = code => {
      if (!REFUSAL_PREFIX.test(code)) return;
      if (!found.has(code)) found.set(code, new Set());
      found.get(code).add(path.basename(file));
    };
    for (const m of text.matchAll(/new Refusal\(\s*'([^']+)'/g)) add(m[1]);
    for (const m of text.matchAll(/\b(?:code|unwritable|tempExists)\s*:\s*'([^']+)'/g)) add(m[1]);
  }
  return { files, found };
}

/** The fixture definition the envelope and seed halves are driven from. */
const T35_DEFINITION = `name: widget-rollout
version: 1
inputs:
  target: {type: string, required: true}
nodes:
  research:
    uses: skill:research
    needs: []
    outputs:
      artifacts:
        report: outputs/research-report.md
  dev-beta:
    uses: skill:development
    needs: [research]
    dir: repo-beta
    provider: copilot
    with:
      autonomy: attended
      research: runs/research/outputs/research-report.md
  dev-alpha:
    uses: skill:development
    needs: [research]
    dir: repo-alpha
  dev-shared:
    uses: skill:development
    needs: [research]
    dir: shared-types
  dev-docs:
    uses: skill:development
    needs: [research]
    dir: docs-site
  dev-ghost:
    uses: skill:development
    needs: [research]
    dir: no-such-member
  dev-bad:
    uses: skill:development
    needs: [research]
    dir: repo-alpha
    with:
      autonomy: yolo
  dev-plain:
    uses: skill:quick-dev
    needs: [research]
    dir: repo-alpha
  plan-beta:
    uses: workflow:plan
    needs: [research]
    dir: repo-beta
    provider: claude
    with:
      statement: Plan the rate limiter
`;

const T35_RUN_ID = '019260a2-1122-7c33-8d44-5e6677889900';

const T35_MANIFEST = {
  version: 1,
  umbrella_id: '019260a3-7788-7e99-8a11-b2c3d4e5f607',
  members: {
    'repo-alpha': { path: 'projects/repo-alpha', kind: 'repo', default_provider: 'claude', autonomy: 'auto-medium' },
    'repo-beta': { path: 'projects/repo-beta', kind: 'repo' },
    'shared-types': { path: 'projects/shared-types', kind: 'repo' },
    'docs-site': { path: 'projects/docs-site', kind: 'repo', default_provider: 'claude' },
  },
  branch_convention: 'feature/{run_id}-{node}',
  defaults: { autonomy: 'auto-low', worktree: true },
};

/** C1's four autonomy tiers, in the order the spec widens them. */
const AUTONOMY_TIERS = ['attended', 'auto-low', 'auto-medium', 'auto-high'];

/** The shipped fixtures the runtime itself reads back with `readDefinition`. */
const RUNTIME_READ_FIXTURES = [
  path.join('synthetic', 'dispatch-envelope', 'dev-beta.envelope.yml'),
  path.join('synthetic', 'umbrella-manifest', 'umbrella.yml'),
  path.join('synthetic', 'ledger-entry', 'd-0142.yml'),
  path.join('synthetic', 'worker-seed', 'seed.yml'),
];

/** A clone: a `.git` directory inside it. */
function gitDir(...parts) {
  const dir = path.join(...parts);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/** A worktree: a `.git` **file** inside it. */
function gitFileDir(...parts) {
  const dir = path.join(...parts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n', 'utf8');
  return dir;
}

async function t35(ctx) {
  const t = checker();
  const scripts = path.join(ctx.pluginRoot, UMBRELLA_SCRIPTS);
  const entry = path.join(scripts, 'umbrella.mjs');
  t.checks++;
  if (!isFile(entry)) return { checks: t.checks, failures: [`${UMBRELLA_SCRIPTS}/umbrella.mjs is absent`] };

  const lib = name => import(pathToFileURL(path.join(scripts, 'lib', name)).href);
  const { init, validate, discover, prune } = await lib('manifest.mjs');
  const { buildEnvelope, writeEnvelope, worktreeOf, driverCapable, envelope: envelopeVerb } = await lib('envelope.mjs');
  const { buildSeed, renderSeed, seed: seedVerb, SEED_SECTIONS, SEED_LINE_CAP } = await lib('seed.mjs');
  const led = await lib('ledger.mjs');
  const { readDefinition, parseDefinition } = await lib('definition.mjs');
  const { resolve: resolveGraph } = await import(
    pathToFileURL(path.join(ctx.pluginRoot, ENGINE, 'scripts', 'lib', 'graph.mjs')).href);

  const { ajv } = loadSchemas(ctx.schemas);
  const validates = (ref, doc) => {
    const validator = ajv.getSchema(schemaKey(ref));
    must(validator, `no schema registered at ${ref}`);
    must(validator(doc), `does not validate against ${ref}: ${ajv.errorsText(validator.errors)}`);
  };

  /** Every refusal code this test provoked, for the coverage assertion. */
  const provoked = new Set();
  const seen = code => { provoked.add(code); return code; };
  /**
   * The codes observed arriving *after* a mutation reached disk. Collected from
   * the runtime rather than listed, because a hand-kept list of these is the
   * thing that went wrong: the recovery guard below is only as honest as the
   * set it checks, and this one is measured.
   */
  const postPublish = new Set();
  const refusedWith = (label, code, result) => {
    const codes = refusalCodes(result);
    must(result?.ok === false, `${label}: the call was accepted`);
    must(codes[0] === code, `${label}: refused ${codes.join(', ') || '(no code)'}, expected ${code}`);
    if (result?.entry_written === true) postPublish.add(code);
    seen(code);
  };
  const throwsWith = (label, code, body) => {
    const actual = caught(body);
    must(actual === code, `${label}: threw ${actual}, expected ${code}`);
    seen(code);
  };

  const scratch = tempDir('umbrella');
  const workspace = name => {
    const root = path.join(scratch, name);
    fs.mkdirSync(root, { recursive: true });
    return root;
  };

  try {
    // -- member discovery ---------------------------------------------------

    t.check('discovery finds a symlinked member one level down and a member at the root', () => {
      const root = workspace('discover-symlink');
      const outside = gitDir(scratch, 'discover-symlink-target');
      fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
      try {
        fs.symlinkSync(outside, path.join(root, 'projects', 'auth'), 'junction');
      } catch {
        t.notes.push('discovery through a symlink: this platform refused to create one, so the member set is checked without it');
      }
      gitDir(root, 'plugins');
      const found = discover(root, { membersRoot: null });
      must(found.members.some(m => m.name === 'plugins'), 'a member at the workspace root was not found');
      must(found.membersRoot === 'projects', `the members root defaulted to ${JSON.stringify(found.membersRoot)}`);
      if (fs.existsSync(path.join(root, 'projects', 'auth'))) {
        const auth = found.members.find(m => m.name === 'auth');
        must(auth, 'the symlinked member was not found');
        must(auth.path === 'projects/auth', `a member path is ${auth.path}, not the workspace-relative one`);
      }
    });

    t.check('a dot-prefixed directory and a directory with no .git are ignored', () => {
      const root = workspace('discover-ignored');
      gitDir(root, '.worktrees');
      gitDir(root, 'projects', '.hidden');
      fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
      fs.mkdirSync(path.join(root, 'projects', 'design'), { recursive: true });
      gitDir(root, 'projects', 'map');
      equalJson(discover(root, { membersRoot: null }).members.map(m => m.name), ['map'], 'members');
    });

    t.check('a .git file qualifies, and a repository nested inside a member is not a second member', () => {
      const root = workspace('discover-worktree');
      gitFileDir(root, 'projects', 'beacon');
      gitDir(path.join(gitDir(root, 'projects', 'map'), 'vendored'));
      equalJson(discover(root, { membersRoot: null }).members.map(m => m.name), ['beacon', 'map'], 'members');
    });

    t.check('a members root carrying .git warns members-root-is-a-repo and still yields its children', () => {
      const root = workspace('discover-members-root');
      fs.mkdirSync(path.join(root, 'projects', '.git'), { recursive: true });
      gitDir(root, 'projects', 'auth');
      gitDir(root, 'projects', 'map');
      const found = discover(root, { membersRoot: null });
      equalJson(found.members.map(m => m.name), ['auth', 'map'], 'the members root is never a member itself');
      equalJson(found.warnings.map(w => w.code), ['members-root-is-a-repo'], 'warnings');
    });

    // -- init: the write scope ----------------------------------------------

    t.check('init without --scaffold writes only .maister/ and the two ignore rules, and names both skipped targets', () => {
      const root = workspace('init-scope');
      gitDir(root, 'projects', 'auth');
      const before = fs.readdirSync(root).sort();
      const report = init(root, { membersRoot: null, force: false, scaffold: false });
      must(report.ok, `init refused: ${JSON.stringify(report.errors)}`);
      // `.gitignore` at the root is the one deliberate exception to the write
      // scope, and it is a line added to a file rather than a file replaced.
      // Its sibling goes into each member's `.git/info/exclude`, which is where
      // a dispatch worktree actually lands and so where the status goes dirty.
      equalJson(fs.readdirSync(root).sort(), [...before, '.maister', '.gitignore'].sort(),
        'the root gained something other than .maister and the ignore rule');
      equalJson(report.skipped.map(s => [s.path, s.reason]),
        [['knowledge/README.md', 'scaffold-not-requested'], ['CLAUDE.md', 'scaffold-not-requested']],
        'the skipped targets');
      for (const relative of ['.maister/umbrella.yml', '.maister/workflows', '.maister/workflows/generated',
        '.maister/workflows/generated/.gitignore', '.maister/umbrella/ledger/entries',
        '.maister/umbrella/ledger/index.yml', '.maister/umbrella/ledger/ledger.log', '.maister/umbrella/outbox']) {
        must(fs.existsSync(path.join(root, relative)), `${relative} was not created`);
      }
      must(fs.readFileSync(path.join(root, '.maister/umbrella/ledger/index.yml'), 'utf8') === 'version: 1\nentries: []\n',
        'the ledger index was not initialized empty');
      must(fs.readFileSync(path.join(root, '.maister/umbrella/ledger/ledger.log'), 'utf8') === '',
        'the ledger log was not initialized empty');
    });

    t.check('a scaffolded workspace ignores a dispatch worktree, in the member and at the root', () => {
      const root = workspace('init-worktree-ignore');
      const member = path.join(root, 'projects', 'auth');
      // A real repository, because the claim is about what `git status` says.
      // No commit is needed: an untracked directory shows either way.
      fs.mkdirSync(member, { recursive: true });
      const git = (cwd, ...args) => runBounded('git', args, { cwd, encoding: 'utf8' });
      must(git(member, 'init', '-q', '.').status === 0, 'git init failed — the check cannot judge a status');
      fs.writeFileSync(path.join(member, 'README.md'), '# auth\n', 'utf8');
      must(git(member, 'add', '-A').status === 0, 'git add failed');
      must(git(member, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t',
        'commit', '-qm', 'first').status === 0, 'git commit failed');
      must(git(member, 'status', '--porcelain').stdout.trim() === '', 'the member started dirty');

      const report = init(root, { membersRoot: null, force: false, scaffold: false });
      must(report.ok, `init refused: ${JSON.stringify(report.errors)}`);
      const exclude = path.join('projects', 'auth', '.git', 'info', 'exclude');
      must(report.created.includes(exclude), `the member's exclude file is not in the created list: ${JSON.stringify(report.created)}`);
      must(report.created.includes('.gitignore'), 'the root ignore rule is not in the created list');

      // The dispatch, named exactly as the envelope names it.
      const runId = '019260a2-1122-7c33-8d44-5e6677889900';
      const worktree = worktreeOf({ manifest: {}, runId, node: 'dev-beta' });
      must(worktree === '.worktrees/019260a2-1122-7c33-8d44-5e6677889900-dev-beta',
        `the worktree is named ${worktree}, which the ignore rule does not cover`);
      fs.mkdirSync(path.join(member, worktree), { recursive: true });
      fs.writeFileSync(path.join(member, worktree, 'scratch.txt'), 'work\n', 'utf8');
      equalJson(git(member, 'status', '--porcelain').stdout.trim(), '',
        'a dispatch worktree left the member repository dirty');

      // A second init adds nothing, and an operator's own content survives.
      const bytes = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      const second = init(root, { membersRoot: null, force: true, scaffold: false });
      must(second.ok, `the second init refused: ${JSON.stringify(second.errors)}`);
      equalJson(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), bytes,
        'a second init rewrote the ignore file');
      must(second.preserved.includes('.gitignore'), 'the second init did not report the ignore file as preserved');
    });

    t.check('an ignore file an operator already wrote keeps every byte and gains the rule once', () => {
      const root = workspace('init-ignore-append');
      gitDir(root, 'projects', 'auth');
      const own = 'node_modules/\n*.log';
      fs.writeFileSync(path.join(root, '.gitignore'), own, 'utf8');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const after = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      must(after.startsWith(own), `the operator's own rules were rewritten: ${JSON.stringify(after)}`);
      // The file had no trailing newline, so the rule must not land on the end
      // of the last line an operator wrote.
      must(after.split('\n').filter(line => line.trim() === '.worktrees/').length === 1,
        `the rule is not present exactly once: ${JSON.stringify(after)}`);
    });

    t.check('init --scaffold creates the two targets once and rewrites neither on a second run', () => {
      const root = workspace('init-scaffold');
      gitDir(root, 'projects', 'auth');
      const first = init(root, { membersRoot: null, force: false, scaffold: true });
      must(first.ok, `the first init refused: ${JSON.stringify(first.errors)}`);
      equalJson(first.skipped, [], 'nothing may be skipped when both targets are absent');
      const stamped = ['knowledge/README.md', 'CLAUDE.md'].map(relative => {
        must(first.created.includes(relative), `${relative} was not created`);
        const text = fs.readFileSync(path.join(root, relative), 'utf8');
        must(text.length > 0, `${relative} is empty`);
        return [relative, text];
      });
      const second = init(root, { membersRoot: null, force: true, scaffold: true });
      must(second.ok, `the second init refused: ${JSON.stringify(second.errors)}`);
      equalJson(second.skipped.map(s => [s.path, s.reason]),
        [['knowledge/README.md', 'already-exists'], ['CLAUDE.md', 'already-exists']], 'the skipped targets');
      for (const [relative, text] of stamped) {
        must(fs.readFileSync(path.join(root, relative), 'utf8') === text, `${relative} was rewritten`);
      }
    });

    t.check('the emitted manifest validates against C1, re-reads through readDefinition and passes validate', () => {
      const root = workspace('init-round-trip');
      gitDir(root, 'projects', 'auth');
      gitFileDir(root, 'projects', 'beacon');
      gitDir(root, 'plugins');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');

      const file = path.join(root, '.maister', 'umbrella.yml');
      validates('umbrella-manifest.schema.json', parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS));
      const read = readDefinition(file);
      equalJson(read.errors, [], 'the emitted manifest does not re-read through the runtime reader');
      equalJson(Object.keys(read.doc.members).sort(), ['auth', 'beacon', 'plugins'], 'the members map');
      must(read.doc.members.auth.path === 'projects/auth', 'a member path did not survive the round trip');
      must(/^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(read.doc.umbrella_id), `umbrella_id is not a uuid7: ${read.doc.umbrella_id}`);

      const judged = validate(root, { definitions: [] });
      must(judged.ok, `validate rejected a fresh workspace: ${JSON.stringify(judged.errors)}`);
      // A freshly scaffolded, untouched workspace reads clean. The scaffolder
      // used to write `routing: {tiers: {}}`, whose one key is reserved, so
      // every proof run opened on a warning about a key the scaffolder itself
      // had put there and every one had to explain it away. An empty report is
      // what makes a later warning mean something.
      equalJson(judged.warnings, [], 'the warning stream');
    });

    t.check('a reserved manifest key an operator writes is still warned about, with no node to blame', () => {
      const root = workspace('init-reserved-by-hand');
      gitDir(root, 'projects', 'auth');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const file = path.join(root, '.maister', 'umbrella.yml');
      fs.appendFileSync(file, 'routing:\n  tiers: {}\n', 'utf8');

      const judged = validate(root, { definitions: [] });
      must(judged.ok, `a reserved key was treated as an error: ${JSON.stringify(judged.errors)}`);
      equalJson(judged.warnings.map(w => w.message), ['reserved-key:routing.tiers'], 'the warning stream');
      must(judged.warnings[0].node === null, 'a manifest warning named a node');
    });

    t.check('validate reports a dir: naming an undeclared member as an error carrying file, node, path and message', () => {
      const root = workspace('validate-errors');
      gitDir(root, 'projects', 'auth');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const definition = path.join(root, '.maister', 'workflows', 'chain.yml');
      fs.writeFileSync(definition, [
        'version: 1', 'name: chain', 'nodes:',
        '  build:', '    uses: skill:quick-dev', '    dir: auth',
        '  ship:', '    uses: skill:quick-dev', '    dir: nowhere', '    needs: [build]', '    foreach: [a]', '',
      ].join('\n'), 'utf8');

      const judged = validate(root, { definitions: [definition] });
      must(!judged.ok, 'an undeclared dir: was accepted');
      const dirErrors = judged.errors.filter(e => e.path === 'nodes.ship.dir');
      must(dirErrors.length === 1, `expected one dir error, got ${judged.errors.length} errors`);
      for (const key of ['file', 'node', 'path', 'message']) {
        must(dirErrors[0][key] !== undefined && dirErrors[0][key] !== null, `the error carries no ${key}`);
      }
      must(dirErrors[0].node === 'ship', `the error names node ${dirErrors[0].node}`);
      must(judged.warnings.some(w => w.message === 'reserved-key:foreach'), 'the graph warning stream was not merged');
      // The manifest half of the merged stream, provoked rather than scaffolded:
      // `init` no longer writes a reserved key, so one is written here to prove
      // the two streams still arrive together.
      fs.appendFileSync(path.join(root, '.maister', 'umbrella.yml'), 'routing:\n  tiers: {}\n', 'utf8');
      const merged = validate(root, { definitions: [definition] });
      must(merged.warnings.some(w => w.message === 'reserved-key:foreach'), 'the graph warning stream was lost');
      must(merged.warnings.some(w => w.message === 'reserved-key:routing.tiers'), 'the manifest warning stream was not merged');
    });

    // The validate-side capability check. Nothing in the fixture tree exercises
    // it — every `dir:`-bearing node in the whole repository uses the
    // `workflow:` scheme, which the rule answers true on without a lookup — so
    // the pin is authored here, against the live validator, rather than as a
    // fixture pair: the fixture harness judges definitions through the engine's
    // graph checker and never calls the umbrella's `validate`, which is the
    // function this check lives in and which needs a manifest and a workspace
    // to run at all.
    t.check('validate reports a dir: node whose target cannot honour a driver, and passes the two that can', () => {
      const root = workspace('validate-driver');
      gitDir(root, 'projects', 'auth');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const definition = path.join(root, '.maister', 'workflows', 'chain.yml');
      fs.writeFileSync(definition, [
        'version: 1', 'name: chain', 'nodes:',
        '  plan:', '    uses: workflow:research', '    dir: auth',
        '  build:', '    uses: skill:development', '    dir: auth', '    needs: [plan]',
        '  ship:', '    uses: skill:quick-dev', '    dir: auth', '    needs: [build]', '',
        '  hand:', '    uses: skill:partner-orchestrator', '    dir: auth', '    needs: [build]', '',
      ].join('\n'), 'utf8');

      const judged = validate(root, { definitions: [definition] });
      // Counted, not just filtered: a suffix filter would let an unrelated
      // error through unnoticed, and the two that must be here are the whole
      // point of the check.
      must(judged.errors.length === 2, `expected two errors, got ${JSON.stringify(judged.errors)}`);
      const located = judged.errors.filter(e => e.path.endsWith('.uses'));
      equalJson(located.map(e => [e.node, e.path]), [['ship', 'nodes.ship.uses'], ['hand', 'nodes.hand.uses']],
        'the located capability errors — a workflow: target and a capable skill: target must pass');
      must(located[0].file === definition, `the error names ${located[0].file}, not the definition`);
      must(located[0].message.includes('skill:quick-dev'), 'the message does not name the target');
      // The two cases are told apart in the report. A skill that was read and
      // does not state the rule is the author's defect; a skill this root holds
      // no file for was never read, and saying it lacks the rule would assert a
      // property of a file nothing opened — which is the relaxed graph
      // checker's own reason for warning on the same node rather than failing.
      must(!/holds no such skill/.test(located[0].message),
        `a target that was read is reported as unreadable: ${located[0].message}`);
      must(/holds no such skill/.test(located[1].message),
        `an unreadable target is reported as stating no driver rule: ${located[1].message}`);
      must(judged.warnings.some(w => w.message === 'unresolved-reference:hand:skill:partner-orchestrator'),
        'the graph checker no longer warns on the unresolvable reference the error is about');
      // The dispatch vocabulary stays on the dispatch side: a validate report
      // never quotes a refusal code, and nothing on this path caught one.
      for (const entry of [...judged.errors, ...judged.warnings]) {
        must(!/dispatch-[a-z-]+/.test(entry.message),
          `a validate report quotes a dispatch refusal code: ${entry.message}`);
      }

      // The predicate itself, driven directly: the two capable schemes, the two
      // that can never be dispatched, and the empty and malformed spellings.
      equalJson(
        ['workflow:research', 'skill:development', 'skill:quick-dev', 'agent:code-reviewer',
          'direct:write-it', 'skill:no-such-skill', 'skill:../escape', 'nonsense', '',
          // A workflow: name is a name, held to the same charset as every other
          // target. Waving these through means a typo'd definition dispatches
          // clean and fails inside a worker, where nothing is watching.
          'workflow:Plan', 'workflow:../escape', 'workflow:', 'workflow:not a thing'].map(driverCapable),
        [true, true, false, false, false, false, false, false, false,
          false, false, false, false],
        'the exported driverCapable predicate');
    });

    t.check('the closed init refusal set is provoked, each returning its own code', () => {
      refusedWith('a missing root', 'umbrella-root-unusable',
        init(path.join(scratch, 'init-absent'), { membersRoot: null, force: false, scaffold: false }));

      const members = workspace('init-members');
      fs.writeFileSync(path.join(members, 'projects'), 'not a directory\n', 'utf8');
      refusedWith('an unreadable members root', 'umbrella-member-unreadable',
        init(members, { membersRoot: 'projects', force: false, scaffold: false }));

      // Containment, before anything is listed: a members root that resolves
      // out of the workspace would record `../../…` as a member path, which is
      // the directory a worker is then told to work in. Both spellings that
      // reach outside are refused — the traversal and the absolute path — and
      // neither is answered with a member list.
      const outside = workspace('init-members-outside');
      gitDir(outside, 'projects', 'auth');
      refusedWith('a members root that traverses out of the workspace', 'umbrella-members-root-outside',
        init(outside, { membersRoot: '../..', force: false, scaffold: false }));
      refusedWith('an absolute members root outside the workspace', 'umbrella-members-root-outside',
        init(outside, { membersRoot: scratch, force: false, scaffold: false }));
      must(!isFile(path.join(outside, '.maister', 'umbrella.yml')),
        'a refused members root still published a manifest');

      const unwritable = workspace('init-unwritable');
      gitDir(unwritable, 'projects', 'auth');
      fs.writeFileSync(path.join(unwritable, '.maister'), 'not a directory\n', 'utf8');
      refusedWith('an unwritable framework directory', 'umbrella-unwritable',
        init(unwritable, { membersRoot: null, force: false, scaffold: false }));

      const contended = workspace('init-temp');
      gitDir(contended, 'projects', 'auth');
      fs.mkdirSync(path.join(contended, '.maister'), { recursive: true });
      fs.writeFileSync(path.join(contended, '.maister', 'umbrella.yml.tmp'), '', 'utf8');
      refusedWith('a held temp', 'umbrella-temp-exists',
        init(contended, { membersRoot: null, force: false, scaffold: false }));

      const unsafe = workspace('init-unsafe');
      gitDir(unsafe, 'projects', 'we"ird');
      refusedWith('a member name the one-line reader could not parse back', 'value-not-flow-safe',
        init(unsafe, { membersRoot: null, force: false, scaffold: false }));

      const twice = workspace('init-twice');
      gitDir(twice, 'projects', 'auth');
      must(init(twice, { membersRoot: null, force: false, scaffold: false }).ok, 'the first init refused');
      const before = fs.readFileSync(path.join(twice, '.maister', 'umbrella.yml'), 'utf8');
      refusedWith('a second init without --force', 'umbrella-manifest-exists',
        init(twice, { membersRoot: null, force: false, scaffold: false }));
      must(fs.readFileSync(path.join(twice, '.maister', 'umbrella.yml'), 'utf8') === before,
        'the refused init rewrote the manifest');
      must(init(twice, { membersRoot: null, force: true, scaffold: false }).ok, '--force refused');
    });

    // -- prune: generated chains whose runs have closed ----------------------

    t.check('prune deletes a generated chain only once every run naming it has closed, and refuses by name', () => {
      const root = workspace('prune');
      gitDir(root, 'projects', 'repo-alpha');
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const workflows = path.join(root, '.maister', 'workflows');
      const home = path.join(workflows, 'generated');
      const fixture = path.join(ctx.fixtures, GENERATED_CHAIN_FIXTURE);
      const stem = GENERATED_CHAIN_STEM;
      // One generated chain, all three files; one reusable chain of another
      // stem at the top level, which no prune may ever reach; and the ignore
      // file init wrote, which is not a chain file and stays.
      for (const ext of ['yml', 'md', 'plan.md']) {
        fs.copyFileSync(path.join(fixture, `${stem}.${ext}`), path.join(home, `${stem}.${ext}`));
      }
      fs.copyFileSync(path.join(fixture, `${stem}.yml`), path.join(workflows, 'reusable.yml'));
      const ignore = fs.readFileSync(path.join(home, '.gitignore'), 'utf8');
      const survives = () => {
        must(isFile(path.join(workflows, 'reusable.yml')), 'a reusable chain at the top level was deleted');
        must(fs.readFileSync(path.join(home, '.gitignore'), 'utf8') === ignore, 'the ignore file was touched');
      };
      const runState = (id, status, source, pending = 'null') => {
        const dir = path.join(root, '.maister', 'umbrella', 'runs', id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'orchestrator-state.yml'),
          `orchestrator:\n  gate_pending: ${pending}\ntask:\n  status: ${status}\nworkflow:\n  source: "${source}"\n`, 'utf8');
      };
      const generated = `.maister/workflows/generated/${stem}.yml`;

      // Never started: kept by a sweep, so a chain published a moment ago is
      // not deleted from under the operator about to start it.
      let report = prune(root, { name: null, dryRun: false });
      must(report.ok, `prune refused: ${JSON.stringify(report.errors)}`);
      equalJson(report.pruned, [], 'a chain no run ever named was pruned');
      equalJson(report.kept, [{ name: stem, reason: 'never-started', runs: [] }], 'the kept list');

      // An open run: kept by a sweep, refused by name. A pending gate on a
      // terminal status is open too - the marker, not the status, decides.
      runState('r-open', 'in_progress', generated);
      runState('r-gated', 'completed', generated, '{node: dispatch-approval, since: "2026-09-08T09:00:00Z"}');
      runState('r-other', 'completed', '.maister/workflows/reusable.yml');
      report = prune(root, { name: null, dryRun: false });
      must(report.ok, `prune refused: ${JSON.stringify(report.errors)}`);
      equalJson(report.kept, [{ name: stem, reason: 'run-open', runs: ['r-gated', 'r-open'] }], 'the kept list with open runs');
      refusedWith('pruning a chain an open run names, by name', 'umbrella-chain-open',
        prune(root, { name: stem, dryRun: false }));
      refusedWith('pruning a stem the generated home does not hold', 'umbrella-chain-missing',
        prune(root, { name: 'reusable', dryRun: false }));
      refusedWith('pruning a stem spelled as a path', 'umbrella-chain-missing',
        prune(root, { name: `../${stem}`, dryRun: false }));
      survives();
      must(isFile(path.join(home, `${stem}.yml`)), 'a refused or kept prune still deleted the chain');

      // Every run closed: a dry run reports the deletion and makes none; the
      // real run deletes all three files and nothing else.
      runState('r-open', 'stopped', generated);
      runState('r-gated', 'completed', generated);

      // But first, the guard fails closed on a run nobody can read. Its
      // `workflow.source` is unknown, so which chain it names is unknown, and a
      // guard that cannot tell holds back the chain it should hold back only by
      // luck. A sweep keeps every generated chain and says why; a prune by name
      // refuses. Neither deletes anything, and the state is named either way,
      // because repairing or removing it is the recovery.
      const broken = path.join(root, '.maister', 'umbrella', 'runs', 'r-broken');
      fs.mkdirSync(broken, { recursive: true });
      fs.writeFileSync(path.join(broken, 'orchestrator-state.yml'), 'not: [a\n  mapping', 'utf8');
      report = prune(root, { name: null, dryRun: false });
      must(report.ok, `a sweep over an unreadable run refused: ${JSON.stringify(report.errors)}`);
      equalJson(report.pruned, [], 'a sweep deleted a chain while a run was unreadable');
      equalJson(report.kept, [{ name: stem, reason: 'run-unreadable', runs: [] }], 'the kept list with an unreadable run');
      equalJson(report.warnings.map(w => w.code), ['run-state-unreadable'], 'the unreadable state is warned about');
      must(report.warnings[0].message.includes('held back'),
        'the warning does not say the chains were held back');
      refusedWith('pruning by name while a run is unreadable', 'umbrella-run-unreadable',
        prune(root, { name: stem, dryRun: false }));
      for (const ext of ['yml', 'md', 'plan.md']) {
        must(isFile(path.join(home, `${stem}.${ext}`)), `${stem}.${ext} was deleted while a run was unreadable`);
      }
      fs.rmSync(broken, { recursive: true, force: true });

      report = prune(root, { name: null, dryRun: true });
      must(report.ok && report.dry_run === true, `the dry run refused: ${JSON.stringify(report.errors)}`);
      equalJson(report.pruned.map(p => [p.name, p.runs]), [[stem, ['r-gated', 'r-open']]], 'the dry run\'s decision');
      must(isFile(path.join(home, `${stem}.yml`)), 'a dry run deleted the chain');
      equalJson(report.warnings, [], 'a readable workspace warned about a run');
      report = prune(root, { name: null, dryRun: false });
      must(report.ok, `prune refused: ${JSON.stringify(report.errors)}`);
      equalJson(report.pruned.map(p => p.files.sort()),
        [[`${generated}`, `.maister/workflows/generated/${stem}.md`, `.maister/workflows/generated/${stem}.plan.md`].sort()],
        'the files pruned');
      for (const ext of ['yml', 'md', 'plan.md']) {
        must(!fs.existsSync(path.join(home, `${stem}.${ext}`)), `${stem}.${ext} survived the prune`);
      }
      survives();
      equalJson(prune(root, { name: null, dryRun: false }).pruned, [], 'a second prune found something to delete');
    });

    // -- the envelope and the seed ------------------------------------------

    const dispatchRoot = workspace('dispatch');
    const definitionPath = path.join(dispatchRoot, '.maister', 'workflows', 'chain.yml');
    const run = path.join(dispatchRoot, '.maister', 'umbrella', 'runs', T35_RUN_ID);
    const ledgerRoot = path.join(dispatchRoot, '.maister', 'umbrella', 'ledger');
    fs.mkdirSync(path.dirname(definitionPath), { recursive: true });
    fs.writeFileSync(definitionPath, T35_DEFINITION, 'utf8');
    fs.writeFileSync(path.join(dispatchRoot, '.maister', 'umbrella.yml'), [
      'version: 1',
      `umbrella_id: ${T35_MANIFEST.umbrella_id}`,
      'members:',
      '  repo-alpha:   {path: projects/repo-alpha, kind: repo, default_provider: claude, autonomy: auto-medium}',
      '  repo-beta:    {path: projects/repo-beta, kind: repo}',
      '  shared-types: {path: projects/shared-types, kind: repo}',
      '  docs-site:    {path: projects/docs-site, kind: repo, default_provider: claude}',
      `branch_convention: "${T35_MANIFEST.branch_convention}"`,
      'defaults:',
      '  autonomy: auto-low',
      '  worktree: true',
      '',
    ].join('\n'), 'utf8');
    fs.mkdirSync(run, { recursive: true });
    fs.mkdirSync(path.join(ledgerRoot, 'entries'), { recursive: true });
    fs.writeFileSync(path.join(ledgerRoot, 'index.yml'), 'version: 1\nentries: []\n', 'utf8');
    fs.writeFileSync(path.join(ledgerRoot, 'ledger.log'), '', 'utf8');

    const baseline = resolveGraph({ definition: readDefinition(definitionPath), overlays: [], profile: null });
    fs.writeFileSync(path.join(run, 'orchestrator-state.yml'), `orchestrator:
  started_phase: null
  completed_phases: []
  failed_phases: []
  created: "2026-08-28T09:00:00Z"
  updated: "2026-08-28T11:15:40Z"
  task_path: ".maister/umbrella/runs/${T35_RUN_ID}"
  gate_pending: null

task:
  title: "Widget rollout chain"
  status: in_progress

workflow:
  name: widget-rollout
  source: ".maister/workflows/chain.yml"
  overlays: []
  profile: null
  graph_hash: "${baseline.graph_hash}"
  grammar_version: 1
  nodes:
    research:   {kind: task, status: completed, needs: []}
    dev-beta:   {kind: task, status: running, needs: [research], dir: repo-beta, provider: copilot}
    dev-alpha:  {kind: task, status: pending, needs: [research], dir: repo-alpha}
    dev-shared: {kind: task, status: pending, needs: [research], dir: shared-types}
    dev-docs:   {kind: task, status: pending, needs: [research], dir: docs-site}
    dev-ghost:  {kind: task, status: pending, needs: [research], dir: no-such-member}
    dev-bad:    {kind: task, status: pending, needs: [research], dir: repo-alpha}
`, 'utf8');

    const build = (node, options = {}) => buildEnvelope({
      run, node, manifest: options.manifest ?? T35_MANIFEST, dispatchId: options.dispatchId ?? 'd-0142',
      overrides: options.overrides ?? {},
    });

    t.check('a built envelope validates against C2 and takes uses, with and inputs from the re-resolved definition', () => {
      must(baseline.ok, `the fixture definition does not resolve: ${JSON.stringify(baseline.errors)}`);
      const doc = build('dev-beta');
      validates('dispatch-envelope.schema.json', doc);
      // The three fields the frozen state block cannot supply: their presence
      // here is the proof that the definition was re-resolved.
      must(doc.workflow.uses === 'skill:development', `workflow.uses is ${JSON.stringify(doc.workflow.uses)}`);
      equalJson(doc.workflow.with,
        { autonomy: 'attended', research: 'runs/research/outputs/research-report.md' }, 'workflow.with');
      equalJson(doc.inputs, [{ path: 'runs/research/outputs/research-report.md', role: 'research' }], 'inputs');
      must(doc.target.member === 'repo-beta' && doc.target.path === 'projects/repo-beta', 'the target member');
      must(doc.branch === `feature/${T35_RUN_ID}-dev-beta`, `the branch is ${doc.branch}`);

      const written = writeEnvelope({ run, envelope: doc });
      must(written.ok, `the envelope was not published: ${JSON.stringify(written.errors)}`);
      equalJson(parseYaml(fs.readFileSync(written.path, 'utf8'), YAML_OPTS), doc, 'the published envelope');
      const strict = readDefinition(written.path);
      must(strict.doc !== null, `the published envelope does not re-read: ${strict.errors[0]?.message}`);
      refusedWith('a second publish of the same node', 'dispatch-envelope-exists', writeEnvelope({ run, envelope: doc }));
    });

    t.check('two runs dispatching one node into one member never share a working tree', () => {
      // The manifest promises per-dispatch isolation; the branch already carries
      // the run id, and the worktree has to carry it too, or the second run of a
      // chain into the same member lands in the first run's tree.
      const otherRunId = '019260a2-3344-7c55-8d66-778899aabbcc';
      const otherRun = path.join(dispatchRoot, '.maister', 'umbrella', 'runs', otherRunId);
      fs.mkdirSync(otherRun, { recursive: true });
      fs.writeFileSync(path.join(otherRun, 'orchestrator-state.yml'),
        fs.readFileSync(path.join(run, 'orchestrator-state.yml'), 'utf8').replaceAll(T35_RUN_ID, otherRunId), 'utf8');
      const first = build('dev-beta');
      const second = buildEnvelope({ run: otherRun, node: 'dev-beta', manifest: T35_MANIFEST, dispatchId: 'd-0143', overrides: {} });
      must(first.target.worktree === `.worktrees/${T35_RUN_ID}-dev-beta`,
        `the worktree is ${JSON.stringify(first.target.worktree)}, not named after the run and the node`);
      must(second.target.worktree === `.worktrees/${otherRunId}-dev-beta`,
        `the second run's worktree is ${JSON.stringify(second.target.worktree)}`);
      must(first.target.worktree !== second.target.worktree, 'two runs share one worktree');

      // The opt-out keeps working, and stays legal with no run id at all.
      must(worktreeOf({ manifest: { defaults: { worktree: false } }, runId: null, node: 'dev-beta' }) === null,
        'defaults.worktree: false no longer opts the workspace out');
      // A worktree that would be minted with no run id is refused by name. The
      // envelope builder cannot reach this — its run id is a resolved directory
      // basename — so the exported helper is driven directly.
      throwsWith('a worktree that would be minted with no run id', 'dispatch-run-unresolved',
        () => worktreeOf({ manifest: T35_MANIFEST, runId: null, node: 'dev-beta' }));
    });

    t.check('provider and autonomy fall back through the member, and every unresolved case refuses its own code', () => {
      must(build('dev-beta').provider === 'copilot', 'the node provider was not honoured');
      must(build('dev-alpha').provider === 'claude', 'the member default_provider was not consulted');
      throwsWith('a node and member with no provider', 'dispatch-node-incomplete', () => build('dev-shared'));
      throwsWith('a dir: naming an undeclared member', 'dispatch-node-incomplete', () => build('dev-ghost'));

      must(build('dev-beta').autonomy === 'attended', 'with.autonomy was not honoured');
      must(build('dev-alpha').autonomy === 'auto-medium', 'the member autonomy was not consulted');
      must(build('dev-docs').autonomy === 'auto-low', 'defaults.autonomy was not consulted');
      throwsWith('an off-enum autonomy', 'dispatch-autonomy-unknown', () => build('dev-bad'));
      throwsWith('a dir: node whose workflow cannot honour a driver', 'dispatch-workflow-not-driver-capable',
        () => build('dev-plain'));
      // The refusal is fed by the same predicate the validator reads, so its
      // code and its message are pinned literally: the extraction was allowed
      // to change where the rule lives and nothing about what dispatch says.
      let refusal = null;
      try { build('dev-plain'); } catch (err) { refusal = err; }
      must(refusal !== null, 'the non-capable node was dispatched');
      must(refusal.code === 'dispatch-workflow-not-driver-capable', `the refusal code is ${refusal.code}`);
      // What the message has to *do* is pinned; its wording is not. An operator
      // who meets this refusal mid-run has to learn which node was refused,
      // which target failed the rule, what the rule is, and both ways out — so
      // those five are asserted and the sentence carrying them stays editable.
      for (const [obligation, present] of [
        ['names the node it refused', /"dev-plain"/],
        ['names the target that cannot honour a driver', /skill:quick-dev/],
        ['names the rule the target fails', /orchestrator\.driver\.kind/],
        ['offers the capable-target recovery', /\bworkflow:/],
        ['offers the drop-the-dispatch recovery', /drop the .{0,2}dir:/],
      ]) {
        must(present.test(refusal.message),
          `the dispatch refusal no longer ${obligation}: ${refusal.message}`);
      }
      // A message that keeps the five needles and loses everything around them
      // is not a recovery any more. The declared recoveries carry a length
      // floor of their own; this is the runtime message's.
      must(refusal.message.length >= 160,
        `the dispatch refusal is ${refusal.message.length} characters — too short to carry a recovery: ${refusal.message}`);
      throwsWith('no autonomy anywhere', 'dispatch-autonomy-unresolved',
        () => build('dev-docs', { manifest: { ...T35_MANIFEST, defaults: {} } }));
    });

    // C2's close-out contract against C1's four tiers. `attended` denies
    // `gh pr create` and still requires a pull request, because on that tier a
    // denial is relayed to the operator who approves it; the two low auto tiers
    // have no operator, so for them the denial is final and an override
    // asserting otherwise is refused.
    t.check('pr_required follows the tier: attended and auto-high reach a pull request, the low auto tiers cannot', () => {
      const at = (autonomy, overrides) => build('dev-docs', {
        manifest: { ...T35_MANIFEST, defaults: { ...T35_MANIFEST.defaults, autonomy } },
        overrides,
      });
      equalJson(
        Object.fromEntries(AUTONOMY_TIERS.map(tier => [tier, at(tier).closeout_contract.pr_required])),
        { attended: true, 'auto-low': false, 'auto-medium': false, 'auto-high': true },
        'the tier -> pr_required mapping');

      // The shipped C2 fixture pairs `attended` with `pr_required: true`; the
      // builder must agree with it rather than contradict it.
      must(build('dev-beta').autonomy === 'attended' && build('dev-beta').closeout_contract.pr_required === true,
        'the attended node did not require a pull request');

      // An override is honoured only where the tier can reach it.
      must(at('attended', { closeout_contract: { pr_required: true } }).closeout_contract.pr_required === true,
        'an override was not honoured on a tier that can relay the denial');
      must(at('auto-high', { closeout_contract: { pr_required: false } }).closeout_contract.pr_required === false,
        'an override lowering pr_required was not honoured');
      for (const tier of ['auto-low', 'auto-medium']) {
        throwsWith(`pr_required: true under ${tier}`, 'dispatch-closeout-impossible',
          () => at(tier, { closeout_contract: { pr_required: true } }));
      }

      // The seed's close-out prose has to match: an attended worker is told the
      // command pauses for approval, never that its tier forbids the request.
      const attended = renderSeed(buildSeed(at('attended'), { siblings: 1 }));
      must(/held for an operator to approve/.test(attended),
        'the attended seed does not say the pull request is held for approval');
      must(!/does not permit|can never open one/.test(attended),
        'the attended seed still tells the worker it cannot open a pull request');
      must(/can never open one/.test(renderSeed(buildSeed(at('auto-low'), { siblings: 1 }))),
        'the auto-low seed does not say a pull request is out of reach');

      // A held command ends the turn; it is not a pause a turn can sit
      // through. The seed used to say "wait for that approval", a worker at a
      // relaying tier obeyed it exactly, and its dispatch ended with no
      // close-out, no marker and nothing for the daemon to read. Both the
      // section that raises the relay and the section that resolves it have to
      // say the same thing, or the worker follows whichever it read last.
      must(/do not wait inside this turn/.test(attended),
        'the attended seed still tells the worker to wait inside the turn for an approval that cannot arrive in one');
      must(/DISPATCH-FOLLOWUP/.test(attended) && /followup message/.test(attended),
        'the attended seed does not name the followup message and the frozen marker a held command ends on');
      equalJson(attended.split('\n').filter(line => /wait for that (approval|decision)/.test(line)), [],
        'a seed line still tells the worker to wait for a decision inside its turn');

      // The three tiers that cannot relay must not carry the relay wording:
      // there is no operator behind them, so a held command is simply final.
      for (const tier of ['auto-low', 'auto-medium', 'auto-high']) {
        const text = renderSeed(buildSeed(at(tier), { siblings: 1 }));
        must(!/do not wait inside this turn/.test(text),
          `the ${tier} seed carries the relay instruction, but that tier has no operator to relay to`);
      }
    });

    t.check('a definition mutated under a frozen graph_hash refuses dispatch-graph-drifted', () => {
      const original = fs.readFileSync(definitionPath, 'utf8');
      try {
        fs.writeFileSync(definitionPath,
          `${original}  dev-extra:\n    uses: skill:development\n    needs: [research]\n`, 'utf8');
        throwsWith('a mutated definition', 'dispatch-graph-drifted', () => build('dev-alpha'));
        must(!fs.existsSync(path.join(run, 'dispatch', 'dev-alpha.envelope.yml')), 'the refusal published an envelope');
      } finally {
        fs.writeFileSync(definitionPath, original, 'utf8');
      }
      must(build('dev-alpha').workflow.uses === 'skill:development', 'the unmutated definition no longer builds');
    });

    t.check('the envelope writer refuses an unwritable dispatch directory, a held temp and an unquotable value', () => {
      const held = path.join(run, 'dispatch', 'dev-alpha.envelope.yml.tmp');
      fs.mkdirSync(path.dirname(held), { recursive: true });
      fs.writeFileSync(held, '', 'utf8');
      refusedWith('a held envelope temp', 'dispatch-temp-exists',
        writeEnvelope({ run, envelope: build('dev-alpha', { dispatchId: 'd-0002' }) }));
      fs.rmSync(held, { force: true });

      const unsafe = build('dev-alpha', { dispatchId: 'd-0003' });
      unsafe.ticket = 'ACME-1 "urgent"';
      refusedWith('an unquotable envelope value', 'value-not-flow-safe', writeEnvelope({ run, envelope: unsafe }));
      must(!fs.existsSync(path.join(run, 'dispatch', 'dev-alpha.envelope.yml')), 'the refusal published an envelope');

      // A dispatch directory that exists but cannot be written into. The
      // read-only mode is the portable way to make the exclusive open fail with
      // something other than EEXIST, which is the branch the shared publish path
      // maps onto the caller's `unwritable` name; a directory that refuses to be
      // *created* is not usable here, because the shared `commit` makes its
      // parent outside the region it maps.
      if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
        t.notes.push(`dispatch-unwritable not provoked: ${PLATFORM_GATED_REFUSALS.get('dispatch-unwritable')}`);
      } else {
        const dispatchDir = path.join(run, 'dispatch');
        fs.mkdirSync(dispatchDir, { recursive: true });
        const mode = fs.statSync(dispatchDir).mode;
        fs.chmodSync(dispatchDir, 0o555);
        try {
          refusedWith('an unwritable dispatch directory', 'dispatch-unwritable',
            writeEnvelope({ run, envelope: build('dev-docs', { dispatchId: 'd-0004' }) }));
        } finally {
          fs.chmodSync(dispatchDir, mode);
        }
      }
    });

    t.check('the seed carries the five frozen sections in order, within the cap, and leaks no chain internal', () => {
      const doc = build('dev-beta');
      const descriptor = buildSeed(doc, { siblings: 3 });
      validates('worker-seed.schema.json#/$defs/seed', descriptor);
      equalJson(descriptor.sections.map(s => s.id), [...SEED_SECTIONS], 'the section ids');
      equalJson(descriptor.sections.map(s => s.id),
        ['identity', 'task', 'outbox', 'closeout', 'siblings'], 'the frozen section order');
      must(SEED_LINE_CAP === 60 && descriptor.cap === 60, 'the line cap moved');

      const prompt = renderSeed(descriptor);
      const lines = prompt.split('\n');
      must(lines.length <= 60, `the prompt renders ${lines.length} lines`);
      equalJson(lines.filter(l => /^# (identity|task|outbox|closeout|siblings)$/.test(l)),
        ['# identity', '# task', '# outbox', '# closeout', '# siblings'], 'the marker lines that survived rendering');
      must(prompt.includes(T35_RUN_ID) && prompt.includes('dev-beta') && prompt.includes('repo-beta'),
        'the identity section does not name the run, the node and the member');
      for (const leak of [T35_MANIFEST.umbrella_id, 'graph_hash', ledgerRoot, 'dev-alpha']) {
        must(!prompt.includes(leak), `a chain internal leaked into the prompt: ${leak}`);
      }
      // Pure: the same envelope gives the same descriptor and the same prompt.
      equalJson(buildSeed(doc, { siblings: 3 }), descriptor, 'buildSeed is not pure');
      must(renderSeed(descriptor) === prompt, 'renderSeed is not pure');

      const { dispatch_id: _dropped, ...incomplete } = doc;
      throwsWith('an envelope missing a required C2 field', 'seed-envelope-invalid',
        () => buildSeed(incomplete, { siblings: 3 }));
      const fat = {
        ...descriptor,
        sections: descriptor.sections.map((section, index) => (index === 1
          ? { ...section, lines: Array.from({ length: 80 }, (_, i) => `line ${i}`) }
          : section)),
      };
      throwsWith('a descriptor rendering past the cap', 'seed-over-cap', () => renderSeed(fat));
    });

    t.check('the SKILL names every permission atom the tiers emit, and says who enforces them', () => {
      // The gap this closes was found live: a worker at a tier denying
      // `shell(gh pr create)` opened a pull request, because `permissions` is
      // data and the runtime — which never spawns — cannot enforce it. The
      // obligation therefore lives in prose, and prose drifts, so the atom
      // vocabulary is held equal in both directions the way the refusal list is.
      const skill = fs.readFileSync(path.join(ctx.pluginRoot, 'skills', 'umbrella', 'SKILL.md'), 'utf8');

      // Built, never published: an envelope on disk is never rewritten, so a
      // check that publishes one per tier would poison every later check for
      // the same node.
      // Swept out of the source rather than collected from envelopes: the tier
      // resolves from the node, the member or the manifest defaults and never
      // from an override, so no single built envelope reaches every atom, and a
      // hand-kept list here would be a fourth copy of the vocabulary.
      const source = fs.readFileSync(path.join(ctx.pluginRoot, 'skills', 'umbrella', 'scripts', 'lib', 'envelope.mjs'), 'utf8');
      const table = /const CAN = \{([\s\S]*?)\n\};/.exec(source);
      must(table !== null, 'envelope.mjs no longer declares a CAN table — the atom sweep has nothing to read');
      const emitted = new Set([...table[1].matchAll(/:\s*'([^']+)'/g)].map(m => m[1]));
      must(emitted.size === 8, `the CAN table carries ${emitted.size} atoms, expected 8`);

      // And the atoms the sweep found are the atoms an envelope really carries.
      const carried = new Set([...build('dev-beta').permissions.allow, ...build('dev-beta').permissions.deny]);
      const stray = [...carried].filter(atom => !emitted.has(atom));
      equalJson(stray, [], 'atoms an envelope carries that the CAN table does not declare');

      // Every atom the tiers can emit is spelled in the SKILL, in code position.
      const spelled = new Set([...skill.matchAll(/`([a-z]+(?:\([a-z]+(?: [a-z]+)*\))?)`/g)].map(m => m[1]));
      const undocumented = [...emitted].filter(atom => !spelled.has(atom));
      equalJson(undocumented, [], 'permission atoms the tiers emit and the SKILL never spells');

      // And the SKILL names an enforcement lever for each provider, plus the
      // one it must warn against. Named by substring rather than by sentence so
      // the wording stays free.
      for (const [what, needle] of [
        ['the Copilot deny flag', '--deny-tool='],
        ['the rule that the spawner enforces', 'spawns the worker'],
        ['the warning against argument patterns', 'Bash(git push:*)'],
        ['the hook lever for Claude', 'PreToolUse'],
      ]) {
        must(skill.includes(needle), `the SKILL no longer names ${what} (${needle})`);
      }

      // The register carries the same rule, so a reader of either lands on it.
      const register = fs.readFileSync(path.join(ctx.pluginRoot, 'skills', 'orchestrator-framework',
        'references', 'compatibility-contracts.md'), 'utf8');
      must(/C2 enforcement rule/.test(register) && register.includes('the layer that spawns the worker owes its enforcement'),
        'the register no longer carries the C2 enforcement rule');
    });

    t.check('every command line the seed hands a worker is runnable as written', () => {
      // Found by the first live worker ever dispatched. The seed used to name
      // its two scripts through `${CLAUDE_PLUGIN_ROOT}`, which the host exports
      // to hook, MCP and LSP subprocesses and interpolates into *skill
      // content* — but a seed is delivered as a headless prompt, so the
      // placeholder reached the worker verbatim and its shell expanded it to
      // the empty string. The worker's first tool call printed
      // `CLAUDE_PLUGIN_ROOT=` and it recovered only by hunting the install down
      // itself. Both of the seed's command lines — the only sanctioned way to
      // write the outbox, and the only sanctioned way to suspend a gate — were
      // unrunnable exactly as written.
      const root = '/opt/maister/plugins/maister';
      const prompt = renderSeed(buildSeed(build('dev-beta'), { siblings: 3, pluginRoot: root }));
      const unexpanded = prompt.split('\n').filter(line => /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/.test(line));
      equalJson(unexpanded, [],
        'a seed line carries a shell or host variable: nothing interpolates a prompt, so it reaches the worker verbatim');

      // And the lines that name a script name a real one, at an absolute path.
      const commands = prompt.split('\n').filter(line => /^\s+node\s/.test(line));
      must(commands.length === 2, `the seed names ${commands.length} command lines, expected 2`);
      for (const line of commands) {
        const script = /^\s+node\s+(\S+)/.exec(line)[1];
        must(path.isAbsolute(script), `the seed names a non-absolute script: ${script}`);
        must(script.startsWith(`${root}/`), `the seed did not resolve the script against the root it was given: ${script}`);
        const shipped = path.join(ctx.pluginRoot, script.slice(root.length + 1));
        must(isFile(shipped), `the seed names a script that does not ship: ${script}`);
      }
      // The root is an argument, so a seed is reproducible: the same envelope
      // and the same root give the same prompt, byte for byte.
      must(renderSeed(buildSeed(build('dev-beta'), { siblings: 3, pluginRoot: root })) === prompt,
        'buildSeed is not pure once the plugin root is an argument');
      must(!renderSeed(buildSeed(build('dev-beta'), { siblings: 3, pluginRoot: '/elsewhere' })).includes(root),
        'the plugin root is not actually being read from the argument');
    });

    // Which tiers the golden corpus actually renders. Without this the stems
    // are a list someone maintains by remembering to: the attended branch went
    // unpinned through a whole contract freeze because nothing ever said which
    // tiers were covered, and the tier that shipped a defect was the one absent.
    // A tier with no golden is either given one or written down here with the
    // reason, and the reason has to be that it renders nothing another tier's
    // golden does not already carry.
    t.check('every autonomy tier is rendered by a golden seed, or its absence is accounted for', () => {
      const dir = path.join(ctx.fixtures, SEED_FIXTURE_DIR);
      const rendered = new Set(SEED_FIXTURE_STEMS.map(stem => parseYaml(
        fs.readFileSync(path.join(dir, `${stem}envelope.yml`), 'utf8'), YAML_OPTS,
      ).autonomy));
      const missing = AUTONOMY_TIERS.filter(tier => !rendered.has(tier) && !SEED_TIER_EXEMPT.has(tier));
      equalJson(missing, [],
        'an autonomy tier no golden seed renders: add a stem for it, or account for it beside the others');
      // And the exemptions are held to their own claim: an exempt tier must
      // render a prompt some covered tier's golden already carries, or the
      // exemption is stale and the tier needs a stem after all.
      const root = '/opt/maister/plugins/maister';
      const promptsByTier = new Map(SEED_FIXTURE_STEMS.map((stem) => {
        const envelope = parseYaml(fs.readFileSync(path.join(dir, `${stem}envelope.yml`), 'utf8'), YAML_OPTS);
        return [envelope.autonomy, { envelope, prompt: renderSeed(buildSeed(envelope, { siblings: 3, pluginRoot: root })) }];
      }));
      for (const [tier, why] of SEED_TIER_EXEMPT) {
        const twin = promptsByTier.get(why);
        must(twin !== undefined, `${tier} is exempted against ${why}, which no golden renders`);
        const asExempt = renderSeed(buildSeed({ ...twin.envelope, autonomy: tier }, { siblings: 3, pluginRoot: root }));
        must(asExempt.replaceAll(tier, why) === twin.prompt,
          `${tier} no longer renders as ${why} does, so its exemption is stale — it needs a golden of its own`);
      }
    });

    t.check('the golden seed fixture is the descriptor renderSeed turns into the golden prompt', () => {
      const dir = path.join(ctx.fixtures, SEED_FIXTURE_DIR);
      // The unprefixed stem is a `skill:` target and the two `workflow-target`
      // stems are `workflow:` ones, for two different definitions. What the
      // second `workflow:` stem pins is that the definition name is
      // interpolated rather than written in, and that the branch renders
      // unchanged for a second dispatch shape — not that a wording false of
      // another definition would show as a diff. It would not: the only
      // definition-dependent text in the branch is the interpolated name, so
      // such a sentence is a static string that renders byte-identically into
      // both goldens. The control for that is a human reading the regenerated
      // goldens. The assertion is the same for all three stems — the
      // descriptor renders to the prompt beside it, byte for byte.
      // The root the stems were generated with. A seed resolves its two command
      // lines against the root it is handed, so the build half is only
      // reproducible when it is handed the same one.
      const goldenRoot = '/opt/maister/plugins/maister';
      for (const stem of SEED_FIXTURE_STEMS) {
        const descriptor = parseYaml(fs.readFileSync(path.join(dir, `${stem}seed.yml`), 'utf8'), YAML_OPTS);
        validates('worker-seed.schema.json#/$defs/seed', descriptor);
        const golden = fs.readFileSync(path.join(dir, `${stem}seed.prompt.txt`), 'utf8').replace(/\r\n/g, '\n');
        must(`${renderSeed(descriptor)}\n` === golden,
          `${stem}seed.prompt.txt: renderSeed no longer produces the golden prompt this fixture pins — update the fixture deliberately or fix the renderer`);
        // And the descriptor beside the envelope is what `buildSeed` still
        // makes of it. Without this the triple pins the renderer alone: the
        // stored descriptor already carries the sentences, so every wording the
        // builder chooses would pass. This is what makes a second `workflow:`
        // stem a guard rather than a document — a line true of one definition
        // and false of another shows up here as a diff.
        const envelope = parseYaml(fs.readFileSync(path.join(dir, `${stem}envelope.yml`), 'utf8'), YAML_OPTS);
        equalJson(buildSeed(envelope, { siblings: 3, pluginRoot: goldenRoot }), descriptor,
          `${stem}seed.yml: buildSeed no longer produces the descriptor this fixture pins — regenerate the triple deliberately or fix the builder`);
      }
    });

    t.check('a workflow: dispatch target renders a seed a worker can act on', () => {
      // The gap this closes: the task line named the target with its scheme
      // prefix and nothing else — `Run workflow:plan.` — which is chain
      // grammar, not anything a worker can type. A `skill:` target at least
      // hints at the tool by its scheme name; for a `workflow:` target there is
      // nothing to guess from, and the definition it names deliberately has no
      // command of its own. So the seed owes the worker three things it cannot
      // infer: which skill runs a definition, the bare name to run, and the
      // lookup order that lets a member-side ejection win.
      const root = '/opt/maister/plugins/maister';
      const prompt = renderSeed(buildSeed(build('plan-beta'), { siblings: 3, pluginRoot: root }));
      const task = prompt.split('\n# ').find(section => section.startsWith('task'));
      must(task !== undefined, 'the rendered prompt carries no task section');

      // Not merely present: the engine's name already appears in the
      // gate-request path every seed carries, so the assertion is over a line
      // that is about running the definition.
      const names = task.split('\n').filter(line => /workflow-engine/.test(line) && !/gate-request/.test(line));
      must(names.length > 0,
        `the task section names the skill that runs a definition only inside the gate-request path:\n${task}`);
      must(/\bplan\b/.test(task.replace(/workflow:plan/g, '')),
        `the task section never names the definition by its bare name:\n${task}`);
      must(/\.maister\/workflows\//.test(task),
        `the task section never states where a member-side ejection of the definition is looked for:\n${task}`);
      must(!/^Run workflow:plan\.$/m.test(task),
        'the task line still hands the worker the raw grammar token as its whole instruction');

      // The line is added under a hard cap with no truncation, so the seed a
      // real dispatch renders must still fit.
      const lines = prompt.split('\n').length;
      must(lines <= 60, `the seed for a workflow: target renders ${lines} lines, past the cap of 60`);
    });

    t.check('a malformed workflow: target is refused rather than seeded', () => {
      // The hole this closes: `seed` is a verb of its own and may be pointed at
      // any envelope on disk, so the capability check dispatch runs before
      // publishing does not stand between a hand-edited file and a worker. A
      // name the scheme cannot resolve used to fall through to the legacy
      // branch and render `Run workflow:Plan.` — the raw grammar as the whole
      // instruction, silently, in the one place nobody is watching.
      const doc = build('plan-beta');
      const malformed = { ...doc, workflow: { ...doc.workflow, uses: 'workflow:Plan' } };
      throwsWith('an envelope naming a malformed workflow definition', 'seed-envelope-invalid',
        () => buildSeed(malformed, { siblings: 3, pluginRoot: '/opt/maister/plugins/maister' }));

      // The verb half, which is the surface the hole was actually in.
      const onDisk = path.join(workspace('seed-malformed'), 'envelope.yml');
      fs.writeFileSync(onDisk, JSON.stringify(malformed), 'utf8');
      const rendered = seedVerb({ envelope: onDisk, siblings: '3' });
      must(rendered.ok === false, 'the seed verb rendered a prompt for a malformed workflow target');
      equalJson(refusalCodes(rendered), ['seed-envelope-invalid'], 'the refusal the seed verb reported');
      must(rendered.prompt === undefined, 'a refused seed still carried a prompt');

      // A `skill:` target with the same shape of name is not this refusal's
      // business: only the workflow scheme resolves through a definition name.
      const skillTarget = { ...doc, workflow: { ...doc.workflow, uses: 'skill:development' } };
      must(buildSeed(skillTarget, { siblings: 3 }).sections.length === SEED_SECTIONS.length,
        'the refusal caught a target that does not name the workflow scheme');
    });

    t.check('the envelope and seed verb halves report in the shell shape', () => {
      const built = envelopeVerb({
        run, node: 'dev-docs', ledger: ledgerRoot, root: dispatchRoot, overrides: { dispatch_id: 'd-0007' },
      });
      must(built.ok, `the envelope verb refused: ${JSON.stringify(built.errors)}`);
      must(built.dispatch_id === 'd-0007', `the override was not honoured: ${built.dispatch_id}`);
      validates('dispatch-envelope.schema.json', built.envelope);

      const rendered = seedVerb({ envelope: built.path, siblings: '2' });
      must(rendered.ok, `the seed verb refused: ${JSON.stringify(rendered.errors)}`);
      validates('worker-seed.schema.json#/$defs/seed', rendered.descriptor);
      must(rendered.prompt.includes('# identity'), 'the rendered prompt carries no identity marker');
      refusedWith('a node the manifest cannot satisfy', 'dispatch-node-incomplete',
        envelopeVerb({ run, node: 'dev-ghost', ledger: ledgerRoot, root: dispatchRoot, overrides: {} }));
    });

    // -- the ledger ---------------------------------------------------------

    const newLedger = name => {
      const root = workspace(name);
      fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
      fs.writeFileSync(path.join(root, 'index.yml'), 'version: 1\nentries: []\n', 'utf8');
      fs.writeFileSync(path.join(root, 'ledger.log'), '', 'utf8');
      return root;
    };
    const logLines = root => fs.readFileSync(path.join(root, 'ledger.log'), 'utf8')
      .split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
    const entryFile = (root, id) => path.join(root, 'entries', `${id}.yml`);
    const LOG_LINE = new RegExp(readJson(path.join(ctx.schemas, 'ledger-entry.schema.json')).$defs.log_line.pattern);

    t.check('each ledger op writes a C3 entry, regenerates the index and appends exactly one matching log line', () => {
      const root = newLedger('ledger-ops');
      const created = led.createEntry({
        ledger: root,
        actor: 'engine',
        args: {
          chain: { run_id: T35_RUN_ID, node: 'dev-beta' },
          target: { member: 'repo-beta', path: 'projects/repo-beta', worktree: '.worktrees/widget-0001' },
          provider: 'copilot',
        },
      });
      must(created.ok, `create-entry refused: ${JSON.stringify(created.errors)}`);
      const id = created.entry.dispatch_id;
      must(id === 'd-0001', `the first allocated id is ${id}`);
      validates('ledger-entry.schema.json#/$defs/entry', parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS));
      must(logLines(root).length === 1, 'create-entry appended more or less than one line');

      const transcript = [
        ['claim', () => led.claim({ ledger: root, dispatch_id: id, actor: 'engine', args: { session: 'widget/0001/dev' } })],
        ['update-status', () => led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'in_progress' } })],
        ['add-constraint', () => led.addConstraint({ ledger: root, dispatch_id: id, actor: 'daemon', args: { kind: 'merge_after', ref: 'd-0139' } })],
        ['add-followup', () => led.addFollowup({ ledger: root, dispatch_id: id, actor: 'daemon', args: { id: 'fu-0001-01', to: 'parent', summary: 'The shared client needs the owner field.' } })],
        ['close-out', () => led.closeOut({ ledger: root, dispatch_id: id, actor: 'daemon', args: { grade: 'success', prs: [{ repo: 'repo-beta', number: 481 }], summary: 'Shipped behind the flag.' } })],
      ];
      let expected = 1;
      for (const [op, issue] of transcript) {
        const result = issue();
        must(result.ok, `${op} refused: ${JSON.stringify(result.errors)}`);
        const doc = parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS);
        validates('ledger-entry.schema.json#/$defs/entry', doc);

        const index = parseYaml(fs.readFileSync(path.join(root, 'index.yml'), 'utf8'), YAML_OPTS);
        const row = (index.entries ?? []).find(e => e.dispatch_id === id);
        must(row, `${op}: the regenerated index carries no row for ${id}`);
        must(row.status === doc.status, `${op}: the index row status ${row.status} lags the entry's ${doc.status}`);

        expected++;
        const lines = logLines(root);
        must(lines.length === expected, `${op}: expected ${expected} log lines, found ${lines.length}`);
        const last = lines[lines.length - 1];
        must(LOG_LINE.test(last), `${op}: "${last}" does not match the frozen log_line pattern`);
        const [ts, name, dispatch] = last.split(' ');
        must(name === op && dispatch === id, `${op}: the log line reads "${last}"`);
        must(ts === doc.updated, `${op}: the log timestamp ${ts} is not the entry's updated ${doc.updated}`);
      }
      const closed = parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS);
      must(closed.status === 'closed' && closed.grade === 'success', 'close-out did not close the entry');
      must(closed.constraints.length === 1 && closed.followups.length === 1, 'the constraint or the follow-up was lost');
    });

    t.check('a dispatch_id is not reused after its entry is deleted', () => {
      const root = newLedger('ledger-ids');
      must(led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id === 'd-0001', 'the first id');
      must(led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id === 'd-0002', 'the second id');
      fs.rmSync(entryFile(root, 'd-0002'));
      const third = led.createEntry({ ledger: root, actor: 'engine', args: {} });
      must(third.ok && third.entry.dispatch_id === 'd-0003',
        `a deleted entry freed its ordinal: got ${third.entry?.dispatch_id} — the log's create-entry lines are the high-water mark`);
      for (const name of fs.readdirSync(path.join(root, 'entries'))) fs.rmSync(path.join(root, 'entries', name));
      must(led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id === 'd-0004',
        'an emptied entries/ recycled an ordinal');
    });

    t.check('the ledger refusal set is provoked, each returning its own code', () => {
      const root = newLedger('ledger-refusals');
      const id = led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id;

      refusedWith('an unknown status', 'ledger-status-illegal',
        led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'in-progress' } }));
      must(logLines(root).length === 1, 'a refused op appended a log line');
      refusedWith('an absent entry', 'ledger-entry-missing',
        led.updateStatus({ ledger: root, dispatch_id: 'd-0404', actor: 'engine', args: { status: 'blocked' } }));
      refusedWith('an op outside the frozen seven', 'ledger-op-unknown',
        led.ledger({ ledger: root, op: 'delete-entry', dispatch_id: id, actor: 'engine', args: {} }));
      refusedWith('an actor that is not a bare token', 'ledger-args-invalid',
        led.updateStatus({ ledger: root, dispatch_id: id, actor: 'two words', args: { status: 'blocked' } }));
      refusedWith('an id whose entry exists', 'ledger-entry-exists',
        led.createEntry({ ledger: root, dispatch_id: id, actor: 'engine', args: {} }));

      const lock = path.join(root, 'entries', `${id}.yml.tmp`);
      const before = fs.readFileSync(entryFile(root, id), 'utf8');
      fs.writeFileSync(lock, '', 'utf8');
      refusedWith('a fresh entry lock', 'ledger-locked',
        led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'blocked' } }));
      must(fs.readFileSync(entryFile(root, id), 'utf8') === before, 'a refused op did not leave the entry alone');
      fs.rmSync(lock, { force: true });

      // A held index temp: the entry is published and the index is behind.
      fs.writeFileSync(path.join(root, 'index.yml.tmp'), '', 'utf8');
      refusedWith('a held index temp', 'ledger-temp-exists',
        led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'blocked' } }));
      fs.rmSync(path.join(root, 'index.yml.tmp'), { force: true });

      const unreadable = newLedger('ledger-unreadable');
      const other = led.createEntry({ ledger: unreadable, actor: 'engine', args: {} }).entry.dispatch_id;
      // An anchor, not a block mapping on a dash: the reader takes the dash form
      // now, and an entry provoked with a shape it accepts proves nothing.
      fs.writeFileSync(entryFile(unreadable, other), 'version: 1\nchain: &held {}\n', 'utf8');
      refusedWith('an entry outside the reader subset', 'ledger-entry-unreadable',
        led.updateStatus({ ledger: unreadable, dispatch_id: other, actor: 'engine', args: { status: 'blocked' } }));

      // A closed entry is terminal.
      const terminal = newLedger('ledger-terminal');
      const closedId = led.createEntry({ ledger: terminal, actor: 'engine', args: {} }).entry.dispatch_id;
      must(led.closeOut({ ledger: terminal, dispatch_id: closedId, actor: 'daemon', args: { grade: 'failed' } }).ok, 'close-out refused');
      refusedWith('a transition out of closed', 'ledger-status-illegal',
        led.updateStatus({ ledger: terminal, dispatch_id: closedId, actor: 'engine', args: { status: 'in_progress' } }));
    });

    t.check('a failed log append refuses ledger-log-unappendable with the entry written and the log behind', () => {
      const root = newLedger('ledger-log');
      const id = led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id;
      // A directory cannot be appended to on any platform this runs on.
      fs.rmSync(path.join(root, 'ledger.log'));
      fs.mkdirSync(path.join(root, 'ledger.log'));

      const moved = led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'in_progress' } });
      refusedWith('an unappendable log', 'ledger-log-unappendable', moved);
      must(moved.entry_written === true && moved.log_behind === true, 'the refusal does not report what reached disk');
      const doc = parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS);
      must(doc.status === 'in_progress',
        'the mutation is not on disk, so the append is not the last step of the op');
      validates('ledger-entry.schema.json#/$defs/entry', doc);
      const index = parseYaml(fs.readFileSync(path.join(root, 'index.yml'), 'utf8'), YAML_OPTS);
      must((index.entries ?? []).some(e => e.dispatch_id === id && e.status === 'in_progress'),
        'the index was not regenerated before the append');

      refusedWith('an unreadable log at allocation time', 'ledger-unwritable',
        led.createEntry({ ledger: root, actor: 'engine', args: {} }));
      must(fs.readdirSync(path.join(root, 'entries')).length === 1, 'the refused create-entry wrote something');
    });

    t.check('the log line is appended before the index, so an index that cannot be written does not lose it', () => {
      // The index is derived and regenerates itself from `entries/` on the next
      // op; the log is derived by nothing, and its `create-entry` lines are the
      // high-water mark that keeps an ordinal from being reused. So the
      // irrecoverable write goes first. This ran the other way round, and an
      // index refusal — ordinary contention, not even a fault — dropped the
      // line for good.
      const root = newLedger('ledger-log-order');
      const id = led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id;
      must(logLines(root).length === 1, 'create-entry appended more or less than one line');

      // A directory cannot be renamed over on any platform this runs on.
      fs.rmSync(path.join(root, 'index.yml'));
      fs.mkdirSync(path.join(root, 'index.yml'));
      fs.writeFileSync(path.join(root, 'index.yml', 'keep'), '', 'utf8');

      const moved = led.updateStatus({ ledger: root, dispatch_id: id, actor: 'engine', args: { status: 'in_progress' } });
      refusedWith('an index that cannot be published', 'ledger-unwritable', moved);
      must(moved.entry_written === true && moved.index_behind === true,
        `the refusal does not report what reached disk: ${JSON.stringify(moved)}`);
      must(moved.log_behind !== true, 'the log was reported behind although only the index failed');
      const doc = parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS);
      must(doc.status === 'in_progress', 'the mutation is not on disk');
      const lines = logLines(root);
      must(lines.length === 2 && lines[1].includes('update-status'),
        `the log line was lost when the index refused: ${JSON.stringify(lines)}`);
    });

    t.check('add-constraint is idempotent, so the recovery from a post-publish refusal cannot multiply one', () => {
      const root = newLedger('ledger-constraint');
      const id = led.createEntry({ ledger: root, actor: 'engine', args: {} }).entry.dispatch_id;
      const add = () => led.addConstraint({ ledger: root, dispatch_id: id, actor: 'daemon', args: { kind: 'merge_after', ref: 'd-0139' } });
      must(add().ok && add().ok && add().ok, 'add-constraint refused');
      const doc = parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS);
      must(doc.constraints.length === 1,
        `three identical add-constraint calls left ${doc.constraints.length} constraints`);
      validates('ledger-entry.schema.json#/$defs/entry', doc);

      // Idempotent on the pair, not on the kind: a different ref is a different
      // constraint and still appends.
      must(led.addConstraint({ ledger: root, dispatch_id: id, actor: 'daemon', args: { kind: 'merge_after', ref: 'd-0140' } }).ok,
        'a second, different constraint was refused');
      must(parseYaml(fs.readFileSync(entryFile(root, id), 'utf8'), YAML_OPTS).constraints.length === 2,
        'a constraint with another ref was folded into the first');
    });

    // -- the outbox, through the entry point --------------------------------

    const outboxWrite = (outbox, type, body) => {
      const proc = runBounded(process.execPath,
        [entry, 'outbox', '--outbox', outbox, '--dispatch-id', 'd-0142', '--type', type],
        { input: JSON.stringify(body), encoding: 'utf8' });
      const lines = String(proc.stdout ?? '').split('\n').filter(l => l !== '');
      let report = null;
      for (let take = lines.length; take > 0; take--) {
        try {
          report = JSON.parse(lines.slice(0, take).join('\n'));
          break;
        } catch { /* not a whole document yet */ }
      }
      return { proc, lines, report, last: lines[lines.length - 1] ?? null };
    };
    const SATISFIED = {
      status: { phase: 'phase-5', note: 'Specification approved; starting the implementation groups.' },
      followup: { summary: 'The shared client package needs the widget owner field.' },
      artifact: { path: 'implementation/visual-coverage.md', role: 'coverage' },
      blocked: { reason: 'The shared cluster credential is not present in this worktree.', needs: ['permission'] },
      closeout: { grade: 'success', summary: 'Owner column shipped behind the existing flag.' },
    };

    t.check('every outbox type writes a C4 message and an existing sequenced file is never rewritten', () => {
      const root = workspace('outbox-append');
      let seq = 0;
      for (const [type, body] of Object.entries(SATISFIED)) {
        seq++;
        const { proc, report } = outboxWrite(root, type, body);
        must(proc.status === 0, `${type}: exited ${proc.status} — ${String(proc.stderr ?? '').trim().split('\n')[0]}`);
        must(report?.ok === true && report.degraded === false, `${type}: reported ${JSON.stringify(report)}`);
        const expected = path.join(root, 'd-0142', `${String(seq).padStart(4, '0')}-${type}.yml`);
        must(path.resolve(report.written) === path.resolve(expected), `${type}: wrote ${report.written}`);
        validates('outbox-message.schema.json', parseYaml(fs.readFileSync(expected, 'utf8'), YAML_OPTS));
      }
      const first = path.join(root, 'd-0142', '0001-status.yml');
      const sentinel = fs.readFileSync(first, 'utf8');
      const again = outboxWrite(root, 'status', { note: 'the sixth message' });
      must(path.basename(again.report.written) === '0006-status.yml', `the next message took ${again.report?.written}`);
      must(fs.readFileSync(first, 'utf8') === sentinel, 'an earlier message was rewritten');
    });

    t.check('closeout and followup degrade onto their frozen dispatch line while the other three refuse', () => {
      const unwritable = name => {
        const root = workspace(name);
        fs.writeFileSync(path.join(root, 'd-0142'), 'not a directory\n', 'utf8');
        return root;
      };
      const closeout = outboxWrite(unwritable('outbox-closeout'), 'closeout', SATISFIED.closeout);
      must(closeout.proc.status === 0 && closeout.report?.degraded === true, 'closeout did not degrade');
      must(closeout.report.written === null, 'a degraded write put something on disk');
      must(closeout.last === 'DISPATCH-RESULT: success Owner column shipped behind the existing flag.',
        `the last line is ${JSON.stringify(closeout.last)}`);

      const followup = outboxWrite(unwritable('outbox-followup'), 'followup', SATISFIED.followup);
      must(followup.proc.status === 0 && followup.report?.degraded === true, 'followup did not degrade');
      must(followup.last === 'DISPATCH-FOLLOWUP: The shared client package needs the widget owner field.',
        `the last line is ${JSON.stringify(followup.last)}`);

      for (const type of ['status', 'artifact', 'blocked']) {
        const refused = outboxWrite(unwritable(`outbox-refuse-${type}`), type, SATISFIED[type]);
        must(refused.proc.status === 1, `${type}: exited ${refused.proc.status}`);
        refusedWith(`${type} on an unwritable outbox`, 'outbox-unwritable', refused.report);
        must(!/^DISPATCH-/m.test(String(refused.proc.stdout ?? '')),
          `${type} printed a dispatch line — a sixth marker spelling is not invented`);
      }
    });

    t.check('an invalid body, an unknown type and a name that stays taken each refuse their own code', () => {
      const root = workspace('outbox-invalid');
      refusedWith('a closeout with no grade', 'outbox-message-invalid',
        outboxWrite(root, 'closeout', { summary: 'no grade' }).report);
      refusedWith('a type outside the five', 'outbox-type-invalid',
        outboxWrite(root, 'progress', { note: 'no such type' }).report);

      const taken = workspace('outbox-taken');
      const dir = path.join(taken, 'd-0142');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '0001-status.yml'), 'version: 1\n', 'utf8');
      // A *directory* is invisible to the message scan, so every attempt picks
      // 0002 and every exclusive open answers EEXIST.
      fs.mkdirSync(path.join(dir, '0002-status.yml'));
      refusedWith('a candidate name that stays taken', 'outbox-sequence-taken',
        outboxWrite(taken, 'status', { note: 'contended' }).report);

      if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
        t.notes.push(`outbox-unreadable not provoked: ${PLATFORM_GATED_REFUSALS.get('outbox-unreadable')}`);
      } else {
        const unlistable = workspace('outbox-unreadable');
        const target = path.join(unlistable, 'd-0142');
        fs.mkdirSync(target, { recursive: true });
        fs.chmodSync(target, 0o300);
        try {
          refusedWith('an unlistable dispatch directory', 'outbox-unreadable',
            outboxWrite(unlistable, 'status', { note: 'unlistable' }).report);
        } finally {
          fs.chmodSync(target, 0o700);
        }
      }
    });

    // -- the shell ----------------------------------------------------------

    t.check('the shell answers an unknown verb, a missing value and a repeated flag with usage on exit 2', () => {
      const shell = (...argv) => runBounded(process.execPath, [entry, ...argv], { encoding: 'utf8' });
      for (const [argv, wanted] of [
        [['not-a-verb'], 'unknown verb "not-a-verb"'],
        [['constructor'], 'unknown verb "constructor"'],
        [[], 'a verb is required'],
        [['init', '--root'], 'the flag --root needs a value'],
        [['init', '--root', '/a', '--root', '/b'], 'given more than once'],
        [['seed', '--envelope', 'e.yml', '--force'], 'takes no --force flag'],
      ]) {
        const proc = shell(...argv);
        must(proc.status === 2, `${argv.join(' ') || '(no argv)'}: exited ${proc.status}`);
        must(String(proc.stderr ?? '').includes(wanted),
          `${argv.join(' ') || '(no argv)'}: stderr is ${JSON.stringify(String(proc.stderr ?? '').trim())}`);
        must(String(proc.stdout ?? '') === '', `${argv.join(' ')}: a usage error printed on stdout`);
      }
    });

    t.check('a verb whose module is genuinely absent fails through the existsSync guard, never as an import error', () => {
      // The module set is complete in the shipped tree, so the guard is reached
      // only against a build that lost one. A copy of the shipped entry point
      // beside an empty `lib/` is that build.
      const partial = workspace('shell-partial');
      fs.mkdirSync(path.join(partial, 'lib'), { recursive: true });
      fs.copyFileSync(entry, path.join(partial, 'umbrella.mjs'));
      const proc = runBounded(process.execPath,
        [path.join(partial, 'umbrella.mjs'), 'seed', '--envelope', 'e.yml'], { encoding: 'utf8' });
      const stderr = String(proc.stderr ?? '');
      must(proc.status === 2, `expected exit 2, got ${proc.status}: ${stderr}`);
      must(stderr.includes('lib/seed.mjs is not present in this build'), `stderr is ${JSON.stringify(stderr)}`);
      must(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(stderr), 'the raw import error surfaced');
      must(stderr.trim().split('\n').length === 1, 'a stack trace reached stderr');

      // Required flags are checked before the module is loaded, so a caller
      // fixing a broken build is still told what the invocation was owed.
      const usage = runBounded(process.execPath, [path.join(partial, 'umbrella.mjs'), 'envelope'], { encoding: 'utf8' });
      must(usage.status === 2 && String(usage.stderr ?? '').startsWith('usage: '), 'the module was reached before the flags');
      must(!String(usage.stderr ?? '').includes('not present in this build'), 'the module was reached before the flags');

      // And against the shipped tree the same verb reaches its real module,
      // which is what makes the case above a synthetic build rather than a bug.
      const shipped = runBounded(process.execPath, [entry, 'seed', '--envelope', 'e.yml'], { encoding: 'utf8' });
      must(!String(shipped.stderr ?? '').includes('not present in this build'),
        'lib/seed.mjs is missing from the shipped tree');
    });

    // -- the two readers agree about every fixture the runtime reads ---------

    t.check('every shipped fixture the runtime reads back parses through the runtime reader too', () => {
      // The suite parses fixtures with the `yaml` package and Ajv; the runtime
      // parses them with `definition.mjs`. The two disagreed for a long time
      // and only the suite's opinion was tested — four fixture families, the
      // seed descriptor among them, were written in a shape the reader refused
      // outright. The reader now takes a block mapping opened on a sequence
      // dash, so every fixture the runtime reads is on this list and the two
      // readers are held to the same document rather than to the same verdict.
      for (const relative of RUNTIME_READ_FIXTURES) {
        const file = path.join(ctx.fixtures, relative);
        must(isFile(file), `${relative}: the fixture is missing`);
        const read = readDefinition(file);
        must(read.doc !== null, `${relative}: the runtime reader refuses it — ${read.errors[0]?.message}`);
        equalJson(JSON.parse(JSON.stringify(read.doc)), parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS),
          `${relative}: the runtime reader and the suite reader disagree`);
      }
      // A shape genuinely outside the subset still stops the read, so the
      // widening above cannot be mistaken for the reader having given up.
      const outside = parseDefinition('version: 1\nnote: &anchor value\n', 'anchored.yml');
      must(outside.doc === null, 'the reader accepted an anchor');
    });

    // -- the recovery guard --------------------------------------------------

    t.check('the SKILL documents a recovery for every refusal the runtime names, and no others', () => {
      const skill = fs.readFileSync(path.join(ctx.pluginRoot, 'skills', 'umbrella', 'SKILL.md'), 'utf8');
      // A refusal row is a table row whose first cell is a code-spelled token
      // shaped like a refusal code. The flag table beside them uses underscores
      // and is deliberately not matched.
      // A code shared by several subsystems — `value-not-flow-safe` is one —
      // gets a row in each of their tables, and every one of them has to hold.
      const rows = skillRows(skill);
      const undocumented = UMBRELLA_REFUSALS.filter(code => !rows.has(code));
      must(undocumented.length === 0, `named by the runtime, documented nowhere: ${undocumented.join(', ')}`);
      const orphaned = [...rows.keys()].filter(code => !UMBRELLA_REFUSALS.includes(code));
      must(orphaned.length === 0, `documented as a refusal the runtime does not name: ${orphaned.join(', ')}`);
      for (const code of UMBRELLA_REFUSALS) {
        for (const text of rows.get(code)) {
          must(text.length >= 40, `${code}: the documented recovery is too short to be one — ${JSON.stringify(text)}`);
        }
      }
      t.notes.push(`${rows.size} documented refusals matched against the runtime's own list`);
    });

    t.check('the ledger lends its callers the same recovery text the SKILL prints', () => {
      // `REFUSALS` and `OWNERSHIP` are exported for the daemon, which vendors
      // this module out of the archive and never sees the SKILL. Two surfaces
      // stating one contract is drift unless something compares them, and
      // nothing did.
      const skill = fs.readFileSync(path.join(ctx.pluginRoot, 'skills', 'umbrella', 'SKILL.md'), 'utf8');
      const ledgerCodes = UMBRELLA_REFUSALS.filter(code => code.startsWith('ledger-') || code === 'value-not-flow-safe');
      equalJson(Object.keys(led.REFUSALS).sort(), [...ledgerCodes].sort(),
        'the ledger REFUSALS export and the runtime refusal list name different codes');
      // `OWNERSHIP` is held to the runtime's own dispatch table rather than to
      // a fifth hand-copied list: an op it names has to be one `ledger()`
      // recognises, and the seven are the whole write surface.
      must(Object.keys(led.OWNERSHIP).length === 7, `OWNERSHIP names ${Object.keys(led.OWNERSHIP).length} ops, not seven`);
      const opRoot = newLedger('ledger-ownership');
      for (const op of Object.keys(led.OWNERSHIP)) {
        const answer = led.ledger({ ledger: opRoot, op, dispatch_id: 'd-0404', actor: 'engine', args: {} });
        must(!refusalCodes(answer).includes('ledger-op-unknown'),
          `OWNERSHIP names ${op}, which the runtime does not recognise as an op`);
      }
      refusedWith('an op OWNERSHIP does not name', 'ledger-op-unknown',
        led.ledger({ ledger: opRoot, op: 'reopen', dispatch_id: 'd-0404', actor: 'engine', args: {} }));

      // The class B5 belonged to: a refusal raised after the entry was renamed
      // into place, whose recovery tells the caller to re-issue. Both surfaces
      // have to say the entry is written; a caller that reads either and
      // re-issues applies the mutation twice.
      must(postPublish.size > 0, 'no post-publish refusal was provoked, so this guard checked nothing');
      for (const code of [...postPublish].sort()) {
        must(UMBRELLA_REFUSALS.includes(code), `${code} was raised after a publish but is not a named refusal`);
        const documented = [...(skillRows(skill).get(code) ?? []).map(text => ['a SKILL row', text]),
          ['the REFUSALS export', led.REFUSALS[code] ?? '']];
        must(documented.length >= 2, `${code} is raised after a publish but is documented on only one surface`);
        for (const [where, text] of documented) {
          must(/the entry is written/i.test(text),
            `${code} is raised after the entry is on disk, but ${where} does not say so: ${text.slice(0, 120)}`);
          must(/do not re-issue|re-issuing \*?this\*? op|applying it twice|applied? the mutation twice|apply the mutation twice/i.test(text),
            `${code} is raised after the entry is on disk, but ${where} does not warn against re-issuing: ${text.slice(0, 120)}`);
        }
      }
      t.notes.push(`post-publish refusals held to their recovery text: ${[...postPublish].sort().join(', ')}`);
    });

    // -- the coverage assertion ---------------------------------------------

    // Runtime -> list. The direction nothing ran: the guard matched the SKILL
    // tables against the list both ways and the list against the provoked set
    // one way, so a code the sources raised and the list never named was
    // invisible to all three. Two had escaped that way by the time this was
    // written, one of them added by the round that wrote the other guard.
    t.check('the refusal list names exactly the codes the umbrella sources manufacture', () => {
      const { files, found } = sweepRefusalCodes(path.join(ctx.pluginRoot, UMBRELLA_SCRIPTS));
      must(files.length > 0, 'the sweep read no umbrella sources, so it proved nothing');
      const derived = [...found.keys()].sort();
      const declared = [...UMBRELLA_REFUSALS].sort();
      const unlisted = derived.filter(code => !UMBRELLA_REFUSALS.includes(code));
      must(unlisted.length === 0,
        `raised by the runtime, named by no list: ${unlisted.map(c => `${c} (${[...found.get(c)].join(', ')})`).join('; ')}`);
      const phantom = declared.filter(code => !found.has(code));
      must(phantom.length === 0, `named by the list, raised nowhere in the sources: ${phantom.join(', ')}`);
      equalJson(derived, declared, 'the derived refusal set and the declared list disagree');
      t.notes.push(`${derived.length} refusal codes swept out of ${files.length} umbrella sources`);
    });

    t.check('every refusal the umbrella runtime names was provoked and returned its own code', () => {
      // The provoked set is held inside the list as well as the other way
      // round. `32 of 31` printed green for two rounds because only one of the
      // two containments was ever asserted.
      const stray = [...provoked].filter(code => !UMBRELLA_REFUSALS.includes(code)).sort();
      must(stray.length === 0, `provoked by a check but named by no list: ${stray.join(', ')}`);
      const missing = UMBRELLA_REFUSALS.filter(code => !provoked.has(code) && !PLATFORM_GATED_REFUSALS.has(code));
      const gated = UMBRELLA_REFUSALS.filter(code => !provoked.has(code) && PLATFORM_GATED_REFUSALS.has(code));
      must(missing.length === 0, `never provoked: ${missing.join(', ')}`);
      if (gated.length) t.notes.push(`platform-gated refusals not provoked here: ${gated.join(', ')}`);
      must(provoked.size <= UMBRELLA_REFUSALS.length,
        `${provoked.size} refusals provoked against a list of ${UMBRELLA_REFUSALS.length} — a code escaped the list`);
      t.notes.push(`${provoked.size} of ${UMBRELLA_REFUSALS.length} named refusals provoked over the live writers`);
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T36 — two writers racing one ledger entry
// ---------------------------------------------------------------------------

/**
 * The lock is the only thing standing between the cockpit daemon and a lost
 * write, and no in-process assertion can exercise it: a single process never
 * contends with itself. So two child processes are released on a shared
 * wall-clock instant and both issue an op against the same entry.
 *
 * Contention is probabilistic even so — the two may simply serialize — which is
 * why the round is repeated. A run in which contention was never observed is
 * reported as a failure rather than passed off as a success: an inconclusive
 * lock test is worse than none, because it reads as coverage.
 */
const RACE_ROUNDS = 6;
const RACE_RELEASE_MS = 400;
const LEDGER_ENTRY_FIXTURE = path.join('synthetic', 'ledger-entry', 'd-0142.yml');

/** The racer, written out per run: one op, released on a shared instant. */
const RACER_SOURCE = [
  "import { pathToFileURL } from 'node:url';",
  'const [module, root, id, op, actor, startAt] = process.argv.slice(2);',
  'const led = await import(pathToFileURL(module).href);',
  '// Spin rather than sleep: the two critical sections have to overlap, and a',
  '// timer would hand the loser a scheduling head start.',
  'while (Date.now() < Number(startAt)) { /* spin */ }',
  "const call = { ledger: root, dispatch_id: id, actor, args: op === 'close-out' ? { grade: 'success' } : { status: 'in_progress' } };",
  "const r = op === 'close-out' ? led.closeOut(call) : led.updateStatus(call);",
  'process.stdout.write(JSON.stringify({ ok: r.ok, codes: (r.errors ?? []).map(e => e.code) }));',
  'process.exit(r.ok ? 0 : 1);',
  '',
].join('\n');

async function t36(ctx) {
  const t = checker();
  const module = path.join(ctx.pluginRoot, UMBRELLA_SCRIPTS, 'lib', 'ledger.mjs');
  t.checks++;
  if (!isFile(module)) return { checks: t.checks, failures: [`${UMBRELLA_SCRIPTS}/lib/ledger.mjs is absent`] };

  const { ajv } = loadSchemas(ctx.schemas);
  const entryValidator = ajv.getSchema(schemaKey('ledger-entry.schema.json#/$defs/entry'));

  const scratch = tempDir('ledger-race');
  const racer = path.join(scratch, 'racer.mjs');
  fs.writeFileSync(racer, RACER_SOURCE, 'utf8');

  /**
   * A ledger holding one open entry, built from the frozen C3 fixture: the
   * document the two writers race over is the shipped shape, not a shape this
   * test invented. `status` and `grade` are wound back because the fixture is a
   * closed dispatch and `closed` is terminal.
   */
  const seedLedger = round => {
    const root = path.join(scratch, `ledger-${round}`);
    fs.mkdirSync(path.join(root, 'entries'), { recursive: true });
    const fixture = fs.readFileSync(path.join(ctx.fixtures, LEDGER_ENTRY_FIXTURE), 'utf8')
      .replace(/^status: closed$/m, 'status: in_progress')
      .replace(/^grade: success$/m, 'grade: null');
    fs.writeFileSync(path.join(root, 'entries', 'd-0142.yml'), fixture, 'utf8');
    fs.writeFileSync(path.join(root, 'index.yml'), 'version: 1\nentries: []\n', 'utf8');
    // The log carries the allocation high-water mark, so the entry's own
    // create-entry line has to be there or the next allocation would recycle it.
    fs.writeFileSync(path.join(root, 'ledger.log'), '2026-08-24T11:15:41Z create-entry d-0142 engine\n', 'utf8');
    return root;
  };

  const spawnRacer = (root, op, actor, startAt) => new Promise(resolve => {
    const child = spawn(process.execPath, [racer, module, root, 'd-0142', op, actor, String(startAt)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
  });

  let contended = null;
  const outcomes = [];
  const crashes = [];
  const unexpected = [];
  try {
    for (let round = 1; round <= RACE_ROUNDS && !contended; round++) {
      const root = seedLedger(round);
      const startAt = Date.now() + RACE_RELEASE_MS;
      const results = await Promise.all([
        spawnRacer(root, 'update-status', 'engine', startAt),
        spawnRacer(root, 'close-out', 'daemon', startAt),
      ]);
      const parsed = results.map(r => {
        if (r.code !== 0 && r.code !== 1) {
          crashes.push(`exit ${r.code}: ${r.err.trim().split('\n')[0] || 'no stderr'}`);
          return null;
        }
        try {
          return { ...JSON.parse(r.out), exit: r.code };
        } catch {
          crashes.push(`stdout was not a report: ${JSON.stringify(r.out.slice(0, 120))}`);
          return null;
        }
      });
      if (parsed.some(p => p === null)) break;
      for (const p of parsed) {
        if (p.ok) continue;
        // A loser that arrived after the winner committed sees a legal refusal
        // of its own; anything outside those two has leaked out of the section.
        if (!['ledger-locked', 'ledger-status-illegal'].includes(p.codes[0])) unexpected.push(p.codes.join(','));
      }
      const wins = parsed.filter(p => p.ok);
      const locked = parsed.filter(p => !p.ok && p.codes[0] === 'ledger-locked');
      outcomes.push(`${wins.length} won, ${locked.length} locked`);
      if (wins.length === 1 && locked.length === 1) contended = { root, wins, locked, parsed, round };
    }

    t.check('no racer crashed and no refusal leaked out of the critical section', () => {
      must(crashes.length === 0, `a racer crashed instead of refusing: ${crashes[0]}`);
      must(unexpected.length === 0, `a loser refused with something else: ${unexpected.join(' | ')}`);
    });

    t.check('exactly one writer wins and the other exits 1 with ledger-locked', () => {
      must(contended !== null,
        `no contention in ${RACE_ROUNDS} rounds (${outcomes.join('; ')}) — the lock was never exercised, which is inconclusive and therefore a failure`);
      must(contended.locked[0].exit === 1, `the loser exited ${contended.locked[0].exit}, expected 1`);
      must(contended.wins[0].exit === 0, `the winner exited ${contended.wins[0].exit}, expected 0`);
    });

    t.check('the raced entry still validates against C3 and the log gained exactly one line', () => {
      must(contended !== null, 'no contended round was observed, so there is nothing to inspect');
      const doc = parseYaml(fs.readFileSync(path.join(contended.root, 'entries', 'd-0142.yml'), 'utf8'), YAML_OPTS);
      must(entryValidator(doc), `the raced entry does not satisfy C3: ${ajv.errorsText(entryValidator.errors)}`);
      must(['in_progress', 'closed'].includes(doc.status), `the raced entry ended at ${doc.status}`);
      const lines = fs.readFileSync(path.join(contended.root, 'ledger.log'), 'utf8')
        .split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
      must(lines.length === 2, `the log holds ${lines.length} lines, expected the seeded create-entry plus exactly one`);
      must(!fs.existsSync(path.join(contended.root, 'entries', 'd-0142.yml.tmp')), 'the lock survived the round');
    });

    t.notes.push(`rounds: ${outcomes.join('; ') || 'none completed'}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T37 — the emitted umbrella scripts run
// ---------------------------------------------------------------------------

/**
 * The umbrella libraries reach outside their own directory twice: `canonical.mjs`
 * and `definition.mjs` are one-line shims onto modules that live elsewhere in
 * the plugin tree. The generated variant is a byte copy, so a shim whose target
 * was not copied resolves in the source tree and fails in the emitted one —
 * with every other test in this repository still green. Each verb is therefore
 * run once against the emitted entry point.
 */
const VARIANT_SHIMS = [
  ['skills/umbrella/scripts/lib/canonical.mjs', 'lib/canonical.mjs'],
  ['skills/umbrella/scripts/lib/definition.mjs', `${ENGINE}/scripts/lib/definition.mjs`],
];

function t37(ctx) {
  const t = checker();
  const variant = path.join(ctx.repoRoot, VARIANT_ROOT);
  const entry = path.join(variant, UMBRELLA_SCRIPTS, 'umbrella.mjs');
  t.checks++;
  if (!isFile(entry)) {
    return {
      checks: t.checks,
      failures: [`${VARIANT_ROOT}/${UMBRELLA_SCRIPTS}/umbrella.mjs is absent — build the variant first`],
    };
  }

  t.check('the emitted tree carries the shared library each shim resolves onto', () => {
    for (const [shim, target] of VARIANT_SHIMS) {
      const emittedShim = path.join(variant, shim);
      const emittedTarget = path.join(variant, target);
      must(isFile(emittedShim), `${VARIANT_ROOT}/${shim}: absent`);
      must(isFile(emittedTarget), `${VARIANT_ROOT}/${target}: absent — the shim beside it cannot resolve`);
      must(fs.readFileSync(emittedTarget, 'utf8') === fs.readFileSync(path.join(ctx.pluginRoot, target), 'utf8'),
        `${VARIANT_ROOT}/${target}: not a byte copy of the source library`);
    }
  });

  const scratch = tempDir('umbrella-variant');
  const report = (label, argv, input = '') => {
    const proc = runBounded(process.execPath, [entry, ...argv], { encoding: 'utf8', input });
    const stderr = String(proc.stderr ?? '').trim().split('\n')[0];
    // Exit 2 is the shell's own failure — a usage error or a module that would
    // not load — and is what a broken import looks like from outside.
    must(proc.status === 0 || proc.status === 1, `${label}: exited ${proc.status} — ${stderr || 'no stderr'}`);
    // The report is the JSON prefix of stdout; a marker line, when there is
    // one, follows it. Parse by growing the prefix rather than by counting.
    const lines = String(proc.stdout ?? '').split('\n').filter(line => line !== '');
    for (let take = lines.length; take > 0; take--) {
      try {
        return JSON.parse(lines.slice(0, take).join('\n'));
      } catch { /* not a whole document yet */ }
    }
    throw new CheckFailed(`${label}: stdout is not the JSON report — ${JSON.stringify(String(proc.stdout ?? '').slice(0, 120))}`);
  };

  try {
    const workspace = path.join(scratch, 'ws');
    fs.mkdirSync(path.join(workspace, 'projects', 'repo-beta', '.git'), { recursive: true });
    const ledgerRoot = path.join(workspace, '.maister', 'umbrella', 'ledger');

    t.check('init and validate run from the emitted tree', () => {
      const initReport = report('init', ['init', `--root=${workspace}`]);
      must(initReport.ok === true, `init reported ${JSON.stringify(initReport)}`);
      const judged = report('validate', ['validate', `--root=${workspace}`]);
      must(judged.ok === true, `validate reported ${JSON.stringify(judged)}`);
    });

    t.check('ledger and outbox run from the emitted tree', () => {
      const created = report('ledger', ['ledger', `--ledger=${ledgerRoot}`, '--op=create-entry', '--actor=engine']);
      must(created.ok === true, `create-entry reported ${JSON.stringify(created)}`);
      const wrote = report('outbox',
        ['outbox', `--outbox=${path.join(workspace, '.maister', 'umbrella', 'outbox')}`, '--dispatch-id=d-0001', '--type=status'],
        JSON.stringify({ note: 'the emitted writer ran' }));
      must(wrote.ok === true, `outbox reported ${JSON.stringify(wrote)}`);
    });

    t.check('envelope and seed load their modules from the emitted tree', () => {
      // Both are pointed at a run and an envelope that do not exist: the module
      // has to load and refuse in its own vocabulary. A refusal is the proof
      // that the import resolved; the behaviour itself is T35's subject.
      const refusedEnvelope = report('envelope',
        ['envelope', `--run=${path.join(workspace, 'no-such-run')}`, '--node=dev', `--ledger=${ledgerRoot}`, `--root=${workspace}`]);
      must(refusedEnvelope.ok === false && refusalCodes(refusedEnvelope).length === 1,
        `envelope reported ${JSON.stringify(refusedEnvelope)}`);
      const refusedSeed = report('seed', ['seed', `--envelope=${path.join(workspace, 'no-such.envelope.yml')}`]);
      must(refusedSeed.ok === false && refusalCodes(refusedSeed).length === 1,
        `seed reported ${JSON.stringify(refusedSeed)}`);
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  t.notes.push(`six verbs executed against ${VARIANT_ROOT}`);
  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T38 — the gate-suspend writer
// ---------------------------------------------------------------------------

const GATE_RUNNING_FIXTURE = path.join('synthetic', 'gate', 'running-no-request');
const GATE_TERMINAL_FIXTURE = path.join('synthetic', 'gate', 'terminal-mode-request');

/** The pending value the driver-aware suspend path writes. */
const PENDING = Object.freeze({
  node: 'approve',
  request: 'gates/approve.request.yml',
  since: '2026-08-28T09:41:07Z',
});

async function t38(ctx) {
  const t = checker();
  const engine = path.join(ctx.pluginRoot, ENGINE, 'scripts');
  t.checks++;
  if (!isFile(path.join(engine, 'lib', 'gate.mjs'))) {
    return { checks: t.checks, failures: [`${ENGINE}/scripts/lib/gate.mjs is absent`] };
  }

  const { writeState } = await import(pathToFileURL(path.join(engine, 'lib', 'state.mjs')).href);
  const { gateRequest } = await import(pathToFileURL(path.join(engine, 'lib', 'gate.mjs')).href);
  const { scanState } = await import(pathToFileURL(path.join(ctx.pluginRoot, GATE_LIB)).href);
  const { flow } = await import(pathToFileURL(path.join(ctx.pluginRoot, CANONICAL_LIB)).href);

  const { ajv } = loadSchemas(ctx.schemas);
  const validates = (ref, doc) => {
    const validator = ajv.getSchema(schemaKey(ref));
    must(validator, `no schema registered at ${ref}`);
    must(validator(doc), `does not validate against ${ref}: ${ajv.errorsText(validator.errors)}`);
  };

  const scratch = tempDir('gate-writer');
  let counter = 0;
  /** A run directory copied out of a frozen fixture; the original is never touched. */
  const runDir = fixture => {
    const dir = path.join(scratch, `run-${counter++}`);
    fs.cpSync(path.join(ctx.fixtures, fixture), dir, { recursive: true });
    fs.rmSync(path.join(dir, 'manifest.json'), { force: true });
    return dir;
  };
  const stateOf = dir => path.join(dir, 'orchestrator-state.yml');
  const read = file => fs.readFileSync(file, 'utf8');
  const pendingLine = text => {
    const line = text.split('\n').find(raw => raw.replace(/\r$/, '').trimStart().startsWith('gate_pending:'));
    must(line !== undefined, 'the state file carries no gate_pending line');
    return line.replace(/\r$/, '');
  };

  try {
    t.check('the flow form is accepted, emitted on one line and read back by the hook reader', () => {
      const file = stateOf(runDir(GATE_RUNNING_FIXTURE));
      const result = writeState({ state: file, patch: { orchestrator: { gate_pending: { ...PENDING } } } });
      must(result.ok, `the write was refused: ${JSON.stringify(result.errors)}`);
      must(result.changed.includes('orchestrator.gate_pending'), 'the writer did not report the marker as changed');

      const text = read(file);
      must(pendingLine(text) === `  gate_pending: ${flow({ ...PENDING }, 'orchestrator.gate_pending')}`,
        `the marker was emitted as ${JSON.stringify(pendingLine(text))}`);
      must(text.split('\n').filter(raw => raw.includes('gate_pending')).length === 1, 'a second gate_pending line appeared');

      // The hook's own reader is the acceptance oracle: it is what decides
      // whether an operator's session is blocked.
      const scanned = scanState(text);
      equalJson({ ...scanned.gatePending }, { ...PENDING }, 'the value the hook reader recovers');
      validates('gate.schema.json#/$defs/pending', JSON.parse(JSON.stringify(scanned.gatePending)));

      // A whole-value replacement, not a merge.
      const second = { node: 'pick-store', request: 'gates/pick-store.request.yml', since: '2026-08-28T09:42:11Z' };
      must(writeState({ state: file, patch: { orchestrator: { gate_pending: second } } }).ok, 'the second write was refused');
      equalJson({ ...scanState(read(file)).gatePending }, second, 'the marker merged instead of replacing');
    });

    t.check('the five refused spellings each come back as state-gate-pending-form with the file untouched', () => {
      const file = stateOf(runDir(GATE_RUNNING_FIXTURE));
      const before = read(file);
      const cases = {
        'block form': '\n  node: approve\n  request: gates/approve.request.yml\n  since: "2026-08-28T09:41:07Z"',
        'nested block form': { ...PENDING, context: { summary: 'why' } },
        'mismatched request path': { ...PENDING, request: 'gates/pick-store.request.yml' },
        'request path outside gates/': { ...PENDING, request: 'approve.request.yml' },
        'midnight since': { ...PENDING, since: '2026-08-28T00:00:00Z' },
        'trailing comment': `{node: approve, request: gates/approve.request.yml, since: "2026-08-28T09:41:07Z"} # asked`,
        'the value as a flow-map string': '{node: approve, request: gates/approve.request.yml, since: "2026-08-28T09:41:07Z"}',
        'a sequence': [{ ...PENDING }],
        'an unknown key': { ...PENDING, mode: 'cockpit' },
        'a missing key': { node: 'approve', request: 'gates/approve.request.yml' },
        'a node id the grammar would never produce': { ...PENDING, node: '__proto__', request: 'gates/__proto__.request.yml' },
        'a boolean': true,
      };
      for (const [name, value] of Object.entries(cases)) {
        const result = writeState({ state: file, patch: { orchestrator: { gate_pending: value } } });
        must(result.ok === false, `${name}: the write was accepted`);
        equalJson(result.changed, [], `${name}: a refusal reported changed paths`);
        must(result.errors[0]?.code === 'state-gate-pending-form',
          `${name}: refused ${result.errors[0]?.code}, expected state-gate-pending-form`);
        must(String(result.errors[0]?.message ?? '').includes('gate_pending'), `${name}: the message does not name the key`);
        must(read(file) === before, `${name}: the file changed despite the refusal`);
      }
    });

    t.check('the literal null is still accepted and still emitted as the bare literal', () => {
      const file = stateOf(runDir(GATE_RUNNING_FIXTURE));
      must(writeState({ state: file, patch: { orchestrator: { gate_pending: { ...PENDING } } } }).ok, 'the marker write was refused');
      must(writeState({ state: file, patch: { orchestrator: { gate_pending: null } } }).ok, 'the clearing write was refused');
      must(pendingLine(read(file)) === '  gate_pending: null', `the cleared marker reads ${JSON.stringify(pendingLine(read(file)))}`);
      must(scanState(read(file)).gatePending === null, 'the hook reader still sees a pending gate');
    });

    t.check('the empty patch republishes with orchestrator.updated as the only changed line', () => {
      const dir = runDir(GATE_RUNNING_FIXTURE);
      const file = stateOf(dir);
      const before = read(file);
      const result = writeState({ state: file, patch: {} });
      must(result.ok, `the empty patch was refused: ${JSON.stringify(result.errors)}`);
      equalJson(result.changed, ['orchestrator.updated'], 'the empty patch changed more than the clock');

      const after = read(file);
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');
      must(beforeLines.length === afterLines.length, 'the republish gained or lost a line');
      const differing = beforeLines.map((line, i) => [i, line, afterLines[i]]).filter(([, a, b]) => a !== b);
      must(differing.length === 1, `changed lines: ${JSON.stringify(differing)}`);
      must(/^\s+updated: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/.test(differing[0][2]),
        `the one changed line is ${JSON.stringify(differing[0][2])}`);

      // The republished file reads back through the hook's reader — which is
      // what the resume path depends on, since the re-validation is the only
      // thing standing behind an answer recorded with editor tools.
      const scanned = scanState(after);
      must(scanned.gatePending === null && scanned.hasWorkflow && scanned.hasNodes && scanned.hasTask,
        'the republished state does not read back through the hook reader');

      const proc = runBounded(process.execPath, [path.join(engine, 'workflow.mjs'), 'write-state', `--state=${file}`],
        { encoding: 'utf8', input: '{}' });
      must(proc.status === 0, `the verb exited ${proc.status} — ${String(proc.stderr ?? '').trim().split('\n')[0]}`);
      must(String(proc.stdout ?? '') === 'orchestrator.updated\n', `the verb printed ${JSON.stringify(proc.stdout)}`);
    });

    /** The suspend request T38 issues; `same()` is the byte-identical re-issue. */
    const APPROVE_REQUEST = Object.freeze({
      node: 'approve',
      kind: 'gate',
      question: 'Research is complete. Proceed to the per-repo implementation runs?',
      context: { summary: 'One rollout order is forced by the shared client package.', artifacts: ['outputs/research-report.md'] },
      options: [
        { id: 'proceed', label: 'Proceed to implementation', effect: 'continue', description: 'Run the per-repo development nodes.', recommended: true },
        { id: 'abort', label: 'Abort the chain', effect: 'stop' },
      ],
      multi_select: false,
    });
    const same = () => JSON.parse(JSON.stringify(APPROVE_REQUEST));

    t.check('gate-request writes the request file, the index and the pending marker in one call', () => {
      const dir = runDir(GATE_RUNNING_FIXTURE);
      const file = stateOf(dir);
      const result = gateRequest({ state: file, request: same() });
      must(result.ok, `gate-request refused: ${JSON.stringify(result.errors)}`);
      equalJson(result.changed, ['gates/approve.request.yml', 'gates/index.yml', 'orchestrator-state.yml'],
        'the paths the verb reports');

      const requestFile = path.join(dir, 'gates', 'approve.request.yml');
      validates('gate.schema.json#/$defs/request', parseYaml(read(requestFile), YAML_OPTS));
      validates('gate.schema.json#/$defs/index', parseYaml(read(path.join(dir, 'gates', 'index.yml')), YAML_OPTS));
      // The line the hook greps for, at column zero with nothing after it.
      must(/^answer: null$/m.test(read(requestFile)), 'the request file carries no bare `answer: null` line');
      must(!read(requestFile).includes('\r'), 'the request file carries a carriage return');

      // The marker the cockpit reads, through the hook's own reader, and the
      // node moved to `suspended` — the two halves of the write that used to be
      // a second, denied call.
      const marker = scanState(read(file)).gatePending;
      must(marker !== null, 'gate-request wrote no pending marker, so the run suspends at a gate nothing recorded');
      validates('gate.schema.json#/$defs/pending', JSON.parse(JSON.stringify(marker)));
      must(marker.node === 'approve' && marker.request === 'gates/approve.request.yml',
        `the marker reads ${JSON.stringify(marker)}`);
      const asked = /^asked_at: "?([^"\n]*?)"?$/m.exec(read(requestFile));
      must(asked !== null && marker.since === asked[1],
        `the marker's since ${marker.since} is not the request's asked_at ${asked?.[1]}`);
      must(scanState(read(file)).nodes.approve.status === 'suspended',
        `the gate node reads ${scanState(read(file)).nodes.approve.status}`);

      const index = parseYaml(read(path.join(dir, 'gates', 'index.yml')), YAML_OPTS);
      must(index.entries.length === 1 && index.entries[0].node === 'approve' && index.entries[0].status === 'pending',
        `the index reads ${JSON.stringify(index.entries)}`);

      must(gateRequest({ state: file, request: { node: 'approve', kind: 'gate', question: 'again?', options: [{ id: 'yes' }] } }).errors[0]?.code === 'gate-request-exists',
        'a second, different request for the same node did not refuse gate-request-exists');
      must(gateRequest({ state: file, request: { node: 'nope', kind: 'gate', question: 'q', options: [{ id: 'yes' }] } }).errors[0]?.code === 'gate-request-invalid',
        'a node the frozen graph does not carry was accepted');
    });

    t.check('a re-issue that finds its own unanswered request file finishes the suspend instead of refusing', () => {
      // The window a kill between the request file and the marker leaves. There
      // is no shell to clear the file with — the run is already pending on rule
      // (b) — so a refusal here makes the gate permanently unaskable.
      const dir = runDir(GATE_RUNNING_FIXTURE);
      const file = stateOf(dir);
      const first = gateRequest({ state: file, request: same() });
      must(first.ok, `the first call refused: ${JSON.stringify(first.errors)}`);
      const requestBytes = read(path.join(dir, 'gates', 'approve.request.yml'));

      // Put the run back in the half-suspended shape: the file, no marker.
      must(writeState({ state: file, patch: { orchestrator: { gate_pending: null } } }).ok, 'the marker could not be cleared');
      must(scanState(read(file)).gatePending === null, 'the marker was not cleared');

      const retry = gateRequest({ state: file, request: same() });
      must(retry.ok, `the re-issue refused: ${JSON.stringify(retry.errors)}`);
      equalJson(retry.changed, ['gates/index.yml', 'orchestrator-state.yml'],
        'the re-issue rewrote the request file instead of adopting it');
      must(read(path.join(dir, 'gates', 'approve.request.yml')) === requestBytes,
        're-issuing rewrote the question the operator was already asked');
      const marker = scanState(read(file)).gatePending;
      must(marker !== null && marker.since === /^asked_at: "?([^"\n]*?)"?$/m.exec(requestBytes)[1],
        'the adopted marker does not carry the time the operator was actually asked');

      // An answered file is still refused: the answer is not to be discarded.
      must(writeState({ state: file, patch: { orchestrator: { gate_pending: null } } }).ok, 'the marker could not be cleared');
      const answered = path.join(dir, 'gates', 'approve.request.yml');
      fs.writeFileSync(answered, requestBytes.replace(/^answer: null$/m, 'answer: {option: proceed}'), 'utf8');
      must(gateRequest({ state: file, request: same() }).errors[0]?.code === 'gate-request-exists',
        'an answered request file was adopted');
    });

    t.check('a refusal after the request file leaves the run unsuspended and the shell available', () => {
      // The index temp held by another writer: the request file is already
      // published, and if it stayed the run would be pending on rule (b) with
      // no marker and no way to retry.
      const dir = runDir(GATE_RUNNING_FIXTURE);
      const file = stateOf(dir);
      const before = read(file);
      fs.mkdirSync(path.join(dir, 'gates'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'gates', 'index.yml.tmp'), '', 'utf8');

      const result = gateRequest({ state: file, request: same() });
      must(result.ok === false, 'the call was accepted with the index temp held');
      equalJson(result.changed, [], 'a refusal reported changed paths');
      must(result.errors[0]?.code === 'gate-temp-exists', `refused ${result.errors[0]?.code}`);
      must(!fs.existsSync(path.join(dir, 'gates', 'approve.request.yml')),
        'the request file was left behind, so the hook reads the run as pending with no marker');
      must(read(file) === before, 'the state file changed although the call refused');

      // The same holds when it is the marker that refuses, and the refusal
      // arrives under the state writer's own code rather than a gate code
      // re-spelling it — with the code written exactly once.
      fs.rmSync(path.join(dir, 'gates', 'index.yml.tmp'));
      const stateTemp = `${file}.tmp`;
      fs.writeFileSync(stateTemp, "another writer's bytes\n", 'utf8');
      const marker = gateRequest({ state: file, request: same() });
      must(marker.ok === false, 'the call was accepted with the state temp held');
      must(marker.errors[0]?.code === 'state-temp-exists', `refused ${marker.errors[0]?.code}`);
      must((String(marker.errors[0]?.message ?? '').match(/state-temp-exists/g) ?? []).length === 1,
        `the code is spelled twice in the message: ${marker.errors[0]?.message}`);
      must(!fs.existsSync(path.join(dir, 'gates', 'approve.request.yml')),
        'the request file survived a refused marker, leaving the run pending with none');
      must(read(file) === before, 'the state file changed although the call refused');
      fs.rmSync(stateTemp);

      // With both temps released the same call goes through.
      must(gateRequest({ state: file, request: same() }).ok, 'the retry after the rollback refused');
      must(scanState(read(file)).gatePending !== null, 'the retry wrote no marker');
    });

    t.check('a terminal-mode write still emits gate_pending: null and writes no request file', () => {
      const dir = runDir(GATE_TERMINAL_FIXTURE);
      const file = stateOf(dir);
      const gatesBefore = fs.readdirSync(path.join(dir, 'gates')).sort();
      const before = read(file);

      const result = writeState({
        state: file,
        patch: {
          nodes: { approve: { status: 'completed' } },
          node_summaries: { approve: { decision: 'proceed', answered_by: 'operator' } },
        },
      });
      must(result.ok, `the terminal-mode write was refused: ${JSON.stringify(result.errors)}`);

      const after = read(file);
      must(pendingLine(after) === '  gate_pending: null', 'terminal mode wrote a marker');
      must(scanState(after).gatePending === null, 'the hook reader sees a pending gate after a terminal-mode write');
      equalJson(fs.readdirSync(path.join(dir, 'gates')).sort(), gatesBefore, 'terminal mode wrote a gate file');

      // Only the clock moves under `orchestrator:`; the marker line and the
      // driver block keep their own bytes.
      const block = text => text.split('\n\n')[0].split('\n');
      const touched = block(before).map((line, i) => [line, block(after)[i]])
        .filter(([a, b]) => a !== b).map(([a]) => a.trim().split(':')[0]);
      equalJson(touched, ['updated'], 'the keys a terminal-mode write touched under orchestrator:');
    });

    t.check('the suspend sequence survives the enforcement hook, which is where it used to deadlock', () => {
      // The seam every other check bypassed. T38 imports the writers in
      // process and the round-trip ran the verbs as raw shell, so neither ever
      // asked the hook what it thought — and the hook is what decides whether
      // the documented sequence can run at all. `Bash` is `opaque` to `mapTool`
      // and there is no allow-list entry that can rescue it, so a run that is
      // already pending cannot reach the shell. Rule (b) makes a run pending
      // the moment an unanswered request file lands beside its state, which is
      // *before* a second call could set the marker. Hence one call.
      const cwd = tempDir('gate-hook');
      const beacons = tempDir('gate-hook-beacons');
      try {
        const mount = path.join(cwd, '.maister', 'umbrella', 'runs', '019260a2-1122-7c33-8d44-5e6677889900');
        fs.cpSync(path.join(ctx.fixtures, GATE_RUNNING_FIXTURE), mount, { recursive: true });
        fs.rmSync(path.join(mount, 'manifest.json'), { force: true });
        const file = path.join(mount, 'orchestrator-state.yml');
        const workflowScript = path.join(engine, 'workflow.mjs');

        const hook = command => {
          const payload = {
            // The driver's own session id, out of the fixture's `driver` block:
            // a pending gate binds the session that asked it, and this sequence
            // is that session's.
            session_id: DRIVER_SESSION,
            transcript_path: path.join(cwd, 'transcript.jsonl'),
            cwd,
            permission_mode: 'default',
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            tool_input: { command },
            tool_use_id: 'toolu_01VNiy1yUkbhmcVbzB78NFrg',
          };
          const proc = runBounded(process.execPath, [path.join(ctx.pluginRoot, GATE_HOOK)],
            { input: JSON.stringify(payload), encoding: 'utf8', cwd, env: { ...process.env, MAISTER_BEACON_DIR: beacons } });
          return { status: proc.status, stdout: String(proc.stdout ?? ''), stderr: String(proc.stderr ?? '') };
        };
        const requestCall = `node ${workflowScript} gate-request --state=${file}`;
        const stateCall = `node ${workflowScript} write-state --state=${file}`;

        // Nothing is pending yet, so the suspending call itself gets through.
        const before = hook(requestCall);
        must(before.status === 0 && before.stdout.trim() === '',
          `the hook denied the suspending call itself: ${firstLine(before.stdout) || before.status}`);

        const issued = runBounded(process.execPath, [workflowScript, 'gate-request', `--state=${file}`],
          { encoding: 'utf8', input: JSON.stringify(same()) });
        must(issued.status === 0, `gate-request exited ${issued.status}: ${firstLine(String(issued.stderr ?? ''))}`);

        // And now the shell is shut, which is the fact the sequence has to be
        // built around rather than tested after.
        const after = hook(stateCall);
        must(after.status === 0, `the deny did not exit 0: ${after.status}`);
        const denial = parseJsonOut(after.stdout);
        must(denial.ok, `the hook printed no decision: ${firstLine(after.stdout)}`);
        const reason = reasonOf('claude', 'deny', denial.value);
        must(reason.startsWith(DENY_PREFIX),
          `a write-state shell call after the request file was not denied — the hook said ${JSON.stringify(firstLine(reason))}`);

        // So the marker cannot be a later call, and it is not: it is already on
        // disk, written by the call the hook did allow.
        const marker = scanState(read(file)).gatePending;
        must(marker !== null,
          'the request file is on disk, the shell is shut, and no pending marker was written — the run is wedged at a gate the cockpit cannot see');
        must(marker.node === 'approve' && marker.request === 'gates/approve.request.yml',
          `the marker reads ${JSON.stringify(marker)}`);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
        fs.rmSync(beacons, { recursive: true, force: true });
      }
    });

    t.check('below the floor there is no gate, and a legacy type dir never holds one', () => {
      // Found by the first live worker ever dispatched, not by this suite: two
      // pre-v3 task directories in a real repository denied every shell call in
      // it, permanently. The pre-v3 orchestrators wrote a top-level `workflow:`
      // header of their own — a scalar, or a `{name, version, mode}` block —
      // and neither carries `nodes:`, so both satisfied the pending
      // predicate's rule (c). A gate no request file describes cannot be
      // answered, so the deny had no way out. § 2, § E2 and § H1 all already
      // said such a document never gates; nothing checked it.
      const cwd = tempDir('gate-floor');
      const beacons = tempDir('gate-floor-beacons');
      try {
        const stamp = '2026-08-31T06:00:00Z';
        const atFloor = taskRoot => [
          'orchestrator:',
          '  started_phase: null',
          '  completed_phases: []',
          '  failed_phases: []',
          `  created: "${stamp}"`,
          `  updated: "${stamp}"`,
          `  task_path: "${taskRoot}"`,
          `  gate_pending: {node: approve, request: gates/approve.request.yml, since: "${stamp}"}`,
          '',
          'task:',
          '  title: "Floor control"',
          '  status: in_progress',
          '',
        ].join('\n');

        const place = (type, name, text, request) => {
          const dir = path.join(cwd, '.maister', 'tasks', type, name);
          fs.mkdirSync(path.join(dir, 'gates'), { recursive: true });
          fs.writeFileSync(path.join(dir, 'orchestrator-state.yml'), text);
          if (request) {
            fs.writeFileSync(path.join(dir, 'gates', 'approve.request.yml'),
              'version: 1\nnode: approve\nkind: gate\nanswer: null\n');
          }
          return `.maister/tasks/${type}/${name}`;
        };

        const decide = () => {
          const proc = runBounded(process.execPath, [path.join(ctx.pluginRoot, GATE_HOOK)], {
            input: JSON.stringify({
              session_id: 'e25cad30-ca2c-4cdb-8290-b3763b9b35ee',
              transcript_path: path.join(cwd, 'transcript.jsonl'),
              cwd,
              permission_mode: 'default',
              hook_event_name: 'PreToolUse',
              tool_name: 'Write',
              tool_input: { file_path: path.join(cwd, 'notes.md'), content: 'x' },
              tool_use_id: 'toolu_01VNiy1yUkbhmcVbzB78NFrg',
            }),
            encoding: 'utf8',
            cwd,
            env: { ...process.env, MAISTER_BEACON_DIR: beacons },
          });
          const stdout = String(proc.stdout ?? '');
          if (proc.status === 0 && stdout.trim() === '') return null;
          const decision = parseJsonOut(stdout);
          must(decision.ok, `the hook printed no decision: ${firstLine(stdout) || proc.status}`);
          return reasonOf('claude', 'deny', decision.value);
        };

        // A pre-v3 state carrying the header key rule (c) reads, with an
        // unanswered request file beside it so rule (b) is live too. Below the
        // floor neither rule is reached at all.
        place('research', '2026-01-06-pre-v3-research',
          'workflow: research-orchestrator\nversion: "1.0"\nmode: yolo\n', true);
        must(decide() === null,
          'a state file with no orchestrator: block gated the session — below the floor there is no gate (§ 2, § E2, § H1)');

        // The other shape the same era wrote: a `workflow:` block of metadata,
        // no `nodes:`, and no `orchestrator:`.
        place('research', '2026-01-14-pre-v3-block',
          'workflow:\n  name: development-orchestrator\n  version: "1.0"\n  mode: interactive\n\ntask:\n  title: "Old"\n', false);
        must(decide() === null, 'a pre-v3 `workflow:` metadata block gated the session');

        // A legacy type dir is inventory-only *regardless of what its state
        // contains* (§ 2), so even a flawless pending v3 run inside one is not
        // a gate.
        const legacy = place('enhancements', '2026-01-14-legacy-type-dir', atFloor('x'), true);
        must(decide() === null,
          `a legacy type dir held a gate: ${legacy} — § 2 makes those inventory-only regardless of their state file`);

        // The negative control, and the reason none of the above may be a blanket
        // shrug: the identical document under a current type dir still gates.
        const live = place('development', '2026-08-31-floor-control', atFloor('.maister/tasks/development/2026-08-31-floor-control'), true);
        const reason = decide();
        must(reason !== null && reason.startsWith(DENY_PREFIX),
          `the same state under a current type dir did not gate (${live}) — the floor check has swallowed rule (a)`);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
        fs.rmSync(beacons, { recursive: true, force: true });
      }
    });

    t.check('an absolute Windows path in the same write is single-quoted, and both readers agree on it', () => {
      // The one spelling a strict YAML parser and the plugin's own outer-pair
      // unquoters read identically: double quotes would give `\U` a meaning it
      // does not have, and escaping to satisfy the parser would hand `scanState`
      // a path with every separator doubled.
      const file = stateOf(runDir(GATE_RUNNING_FIXTURE));
      const result = writeState({
        state: file,
        patch: {
          orchestrator: { gate_pending: { ...PENDING }, task_path: 'C:\\Users\\dev\\work\\repo-alpha' },
          nodes: { dev: { dir: 'C:\\Users\\dev\\work\\repo-beta' } },
        },
      });
      must(result.ok, `the write was refused: ${JSON.stringify(result.errors)}`);
      const text = read(file);
      must(text.includes("  task_path: 'C:\\Users\\dev\\work\\repo-alpha'"), 'the Windows path was not single-quoted');
      must(text.includes("dir: 'C:\\Users\\dev\\work\\repo-beta'"), 'the node dir was not single-quoted');
      // Parsed, not merely inspected: a check that only asserts the outer pair
      // cannot tell quoting from escaping.
      const parsed = parseYaml(text, YAML_OPTS);
      must(parsed.orchestrator.task_path === 'C:\\Users\\dev\\work\\repo-alpha',
        `a YAML reader parses the task_path as ${JSON.stringify(parsed.orchestrator.task_path)}`);
      must(scanState(text).nodes.dev.dir === 'C:\\Users\\dev\\work\\repo-beta',
        'the engine scanner and the YAML reader disagree about the node dir');
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T39 — the gate-sequence carriers, in lockstep
// ---------------------------------------------------------------------------

/**
 * Every surface that tells a model how a driver-suspended gate is raised.
 *
 * The engine collapsed the request file, the gate index and the pending marker
 * into one `gate-request` call because the deadlock is symmetric: whichever
 * write lands first makes the run pending, and the second is a shell call
 * against a pending run, which the enforcement hook denies. That fix reached
 * the engine's own SKILL and nowhere else — every other carrier went on
 * spelling the superseded two-write sequence, so a *compliant* orchestrator
 * reading the shipped prose still reached the deadlock. The rule was already
 * written down ("change them in lockstep") and enforced by nothing.
 *
 * `repo` marks a carrier that lives outside the plugin tree, so a vendored
 * checkout that has the plugin but not this repository skips it rather than
 * failing on a file it was never shipped.
 */
const GATE_CARRIERS = [
  { path: 'hooks/skill-invocation-reminder.sh', driver: true },
  { path: 'hooks/post-compact-reminder.sh', driver: true },
  { path: 'hooks/gate-stop-nudge.mjs' },
  { path: 'skills/development/SKILL.md', driver: true },
  { path: 'skills/research/SKILL.md', driver: true },
  { path: 'skills/migration/SKILL.md', driver: true },
  { path: 'skills/performance/SKILL.md', driver: true },
  { path: 'skills/product-design/SKILL.md', driver: true },
  { path: 'skills/workflow-engine/SKILL.md', driver: true },
  { path: 'skills/orchestrator-framework/references/orchestrator-patterns.md', driver: true },
  { path: 'skills/orchestrator-framework/references/compatibility-contracts.md' },
  { path: 'skills/umbrella/scripts/lib/seed.mjs' },
  { path: 'CLAUDE.md', repo: true, driver: true },
];

/**
 * The superseded shapes. Each is an instruction to a *caller* to write the
 * marker as a step of its own after the request file — the sequence that
 * deadlocks. Prose describing what the one verb does internally says "writes"
 * and "sets", never "write … then set", so the verb's own documentation is not
 * caught by these.
 */
const SUPERSEDED_GATE_SEQUENCES = [
  { name: 'write the request file, then set the marker',
    re: /\bwrit(?:e|ing)\b[^.\n]{0,90}\brequest\b[^.\n]{0,90}\bset\b[^.\n]{0,30}gate_pending/i },
  { name: 'set the marker, then rewrite the dashboard as a separate step',
    re: /\bset\b\s+`?gate_pending`?\s*,\s*(?:then\s+)?re-?write/i },
  { name: 'the marker as a second write-state call',
    re: /gate_pending[^.\n]{0,60}\bwrite-state\b/i },
];

/**
 * The claim that makes the carrier's instruction the single-call one: the word
 * "one" or "single" within a clause of the verb's name, in either order. The
 * count is the load-bearing part — a carrier that names the verb but leaves the
 * number open reads as compatible with the two-write sequence it replaced.
 */
const ONE_CALL = /(?:\b(?:one|a single|single)\b[^.\n]{0,60}`?gate-request`?|`?gate-request`?[^.\n]{0,60}\b(?:one|a single|single)\b)/i;

/**
 * The driver qualification, required of the carriers that state the branch rule
 * itself. The stop nudge, the register's E2 rules and the worker seed carry the
 * sequence without restating the branch — the nudge only ever fires inside a
 * driver-suspended run, and the seed's worker is told its driver outright — so
 * they are held to the sequence and not to this.
 */
const DRIVER_CLAUSES = [
  { name: 'names driver.kind', re: /driver\.kind/ },
  { name: 'names the terminal branch', re: /absent or `?terminal`?/i },
  { name: 'names the suspending branch', re: /cockpit/ },
];

function t39(ctx) {
  const t = checker();
  for (const carrier of GATE_CARRIERS) {
    const file = carrier.repo
      ? path.join(ctx.repoRoot, carrier.path)
      : path.join(ctx.pluginRoot, carrier.path);
    if (carrier.repo && !isFile(file)) {
      t.notes.push(`${carrier.path} is not in this checkout — skipped`);
      continue;
    }
    t.check(`${carrier.path} carries the single-verb gate sequence`, () => {
      must(isFile(file), `${carrier.path}: the carrier is missing — remove it from the list or restore the file`);
      const text = fs.readFileSync(file, 'utf8');
      must(text.includes('gate-request'),
        `${carrier.path}: the gate mechanism is named without naming the \`gate-request\` verb, which is the only way to raise a gate without deadlocking`);
      must(ONE_CALL.test(text),
        `${carrier.path}: names the verb but does not say it is one call, so a reader may still split it in two`);
      for (const { name, re } of SUPERSEDED_GATE_SEQUENCES) {
        const hit = re.exec(text);
        must(hit === null, `${carrier.path}: the superseded two-write sequence survives (${name}) — ${JSON.stringify(hit?.[0] ?? '')}`);
      }
      if (carrier.driver) {
        for (const { name, re } of DRIVER_CLAUSES) {
          must(re.test(text), `${carrier.path}: no longer ${name}`);
        }
      }
    });
  }
  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T40 — the umbrella skill's user-facing verbs
// ---------------------------------------------------------------------------

/**
 * Two of the runtime's six verbs are a user's entry point — `init` scaffolds a
 * workspace, `validate` judges one — and a user reaches them as
 * `/maister:umbrella <verb>`. The other four are the machinery a running chain
 * uses, and the skill must not offer them to a user: a ledger op typed by hand
 * is the drift the runtime exists to remove. The exec-form line is what the
 * engine and the daemon call, so it is pinned byte for byte.
 *
 * The command reference is held to the same two verb rules where this checkout
 * has it, and additionally must not name the script at all: the exec form is
 * something the engine and the daemon run, never something a user types.
 */
const UMBRELLA_SKILL_REL = 'skills/umbrella/SKILL.md';
const UMBRELLA_DOCS_REL = 'docs/commands.md';
const UMBRELLA_EXEC_LINE = 'node ${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs <verb> [flags]';
const UMBRELLA_USER_VERBS = ['init', 'validate', 'prune'];
const UMBRELLA_MACHINE_VERBS = ['envelope', 'seed', 'ledger', 'outbox'];
/** The slash form with the word that follows it: `/maister:umbrella init`, `/maister:umbrella `ledger``. */
const UMBRELLA_SLASH_FORM = /\/maister:umbrella\s+`?([a-z-]+)/g;
/** The sentence that closes the four machine verbs to a user, all four named in it. */
const UMBRELLA_NOT_A_COMMAND =
  /`envelope`, `seed`, `ledger`, `outbox`[^.]{0,160}\bnot a user command\b/;

function t40(ctx) {
  const t = checker();
  const carriers = [
    { path: UMBRELLA_SKILL_REL, file: path.join(ctx.pluginRoot, UMBRELLA_SKILL_REL), skill: true },
    { path: UMBRELLA_DOCS_REL, file: path.join(ctx.repoRoot, UMBRELLA_DOCS_REL), repo: true },
  ];
  for (const carrier of carriers) {
    if (carrier.repo && !isFile(carrier.file)) {
      t.notes.push(`${carrier.path} is not in this checkout — skipped`);
      continue;
    }
    t.check(`${carrier.path} names the two user verbs and no other`, () => {
      must(isFile(carrier.file), `${carrier.path}: missing`);
      const text = fs.readFileSync(carrier.file, 'utf8');
      for (const verb of UMBRELLA_USER_VERBS) {
        must(text.includes(`/maister:umbrella ${verb}`),
          `${carrier.path}: never spells \`/maister:umbrella ${verb}\`, so the user path is undocumented`);
      }
      for (const hit of text.matchAll(UMBRELLA_SLASH_FORM)) {
        must(!UMBRELLA_MACHINE_VERBS.includes(hit[1]),
          `${carrier.path}: offers the machine verb \`${hit[1]}\` as a user command — ${JSON.stringify(hit[0])}`);
      }
      must(!/there is no `?\/maister:umbrella`? (?:slash )?command/i.test(text),
        `${carrier.path}: still says there is no \`/maister:umbrella\` command`);
    });
    if (carrier.skill) {
      t.check(`${carrier.path} keeps the exec form the engine and the daemon call`, () => {
        const text = fs.readFileSync(carrier.file, 'utf8');
        must(text.includes(UMBRELLA_EXEC_LINE),
          `${carrier.path}: the exec-form line is missing or changed — ${JSON.stringify(UMBRELLA_EXEC_LINE)}`);
      });
    } else {
      t.check(`${carrier.path} does not name the script as something a user runs`, () => {
        const text = fs.readFileSync(carrier.file, 'utf8');
        must(!text.includes('umbrella.mjs'),
          `${carrier.path}: names the runtime script — the user surface is the two commands`);
      });
    }
  }

  t.check(`${UMBRELLA_SKILL_REL} is a user-invocable skill with the two verbs as its argument hint`, () => {
    const text = fs.readFileSync(carriers[0].file, 'utf8');
    const frontmatter = text.split('\n---\n')[0];
    must(/^user-invocable: true$/m.test(frontmatter), 'user-invocable is not true, so the slash command does not exist');
    const hint = /^argument-hint: "(.*)"$/m.exec(frontmatter)?.[1] ?? '';
    for (const verb of UMBRELLA_USER_VERBS) {
      must(new RegExp(`\\b${verb}\\b`).test(hint), `argument-hint does not name \`${verb}\``);
    }
    for (const verb of UMBRELLA_MACHINE_VERBS) {
      must(!new RegExp(`\\b${verb}\\b`).test(hint), `argument-hint offers the machine verb \`${verb}\``);
    }
    must(UMBRELLA_NOT_A_COMMAND.test(text),
      'the body no longer closes the four machine verbs to a user in one sentence');
  });
  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T41 — the chain planner's user surface, and a planned chain that validates
// ---------------------------------------------------------------------------

/**
 * The planner is a generator with two things a check can hold it to.
 *
 * The first is its user surface. A user reaches it as
 * `/maister:chain-planner`, so the slash form has to be spelled in the skill
 * and in the command reference, the frontmatter has to actually make the
 * command exist (`user-invocable: true`) and its argument hint has to name the
 * two flags a user needs to steer a plan (`--name` and `--root`). The loop is
 * bounded, and the sentence that bounds it is pinned because an unbounded
 * validate loop is the failure mode the budget exists to prevent: three passes
 * and a stop, never "keep editing until it passes".
 *
 * The second is the absence of the driver rule. `driverCapable` in
 * `envelope.mjs` decides whether a skill can be dispatched by reading its
 * `SKILL.md` for the driver literal, so a skill that states the literal becomes
 * a legal `dir:` target. The planner must never be one: it authors chains, it
 * does not run inside them, and a chain that dispatches the planner into a
 * member is a chain that plans while it runs. The literal is therefore pinned
 * *absent* from the planner's skill file — adding it there would silently make
 * the planner dispatchable with nothing else to notice.
 *
 * The last checks are the output, not the prose. A checked-in definition and
 * companion pair, the shape the loop publishes, is run through the workspace
 * runtime's own `validate` against a workspace staged the way the
 * umbrella-runtime test stages one. It must be accepted with an empty report —
 * a freshly scaffolded workspace carries no advisory of its own any more, so
 * any warning here is the chain's — because "the pair validates clean" is the
 * planner's whole contract and nothing else in the suite asserts it.
 * The third published file, `<stem>.plan.md`, no validator judges at all, so
 * its four required headings are pinned here against the skill that requires
 * them — both directions, so renaming the requirement without renaming the
 * fixture fails rather than quietly leaving the plan file unproved again.
 *
 * The command reference is repository-level: absent in the tarball, and skipped
 * with a note there rather than failed. That is the only skip it gets — a
 * checkout that holds the file has to document the planner in it, or fail.
 */
const PLANNER_SKILL_REL = 'skills/chain-planner/SKILL.md';
const PLANNER_REFERENCE_REL = 'skills/chain-planner/references/plan-time-rules.md';
const PLANNER_DOCS_REL = 'docs/commands.md';
const PLANNER_SLASH_FORM = '/maister:chain-planner';
/** The flags the argument hint must offer; `--force` is deliberately not required. */
const PLANNER_HINT_FLAGS = ['--name', '--root', '--generated'];
/** The sentence that bounds the draft-validate loop. */
const PLANNER_BOUNDED_LOOP = /at most three passes/;
/**
 * The driver literal, spelled here as `DRIVER_RULE` spells it in
 * `skills/umbrella/scripts/lib/envelope.mjs`. Keeping the two in step is the
 * point: this test is only meaningful while it names the same string the
 * capability predicate reads.
 */
const PLANNER_DRIVER_LITERAL = 'orchestrator.driver.kind';
/** The planned pair the loop publishes, held as a fixture. */
const PLANNED_CHAIN_FIXTURE = path.join('synthetic', 'planned-chain');
const PLANNED_CHAIN_STEM = 'docs-refresh';
/** The members the fixture chain dispatches into, staged as clones under the members root. */
const PLANNED_CHAIN_MEMBERS = ['docs-site', 'repo-alpha'];
/** A freshly scaffolded workspace reports nothing, and a planned chain adds nothing to it. */
const PLANNED_CHAIN_WARNINGS = [];
/**
 * The plan file's four required headings, in the order the skill requires them.
 * It is the third of the three files the planner publishes and the only one no
 * validator judges, so the headings are pinned here or nowhere: the skill makes
 * them a requirement, and a requirement nothing checks is a suggestion.
 */
const PLANNED_CHAIN_PLAN_HEADINGS = [
  'The task, as given',
  'The nodes',
  'The guards',
  'Refusals considered and rejected',
];

async function t41(ctx) {
  const t = checker();
  const skillFile = path.join(ctx.pluginRoot, PLANNER_SKILL_REL);
  const carriers = [
    { path: PLANNER_SKILL_REL, file: skillFile, skill: true },
    { path: PLANNER_DOCS_REL, file: path.join(ctx.repoRoot, PLANNER_DOCS_REL), repo: true },
  ];
  for (const carrier of carriers) {
    if (carrier.repo && !isFile(carrier.file)) {
      t.notes.push(`${carrier.path} is not in this checkout — skipped`);
      continue;
    }
    t.check(`${carrier.path} spells the planner's slash form`, () => {
      must(isFile(carrier.file), `${carrier.path}: missing`);
      const text = fs.readFileSync(carrier.file, 'utf8');
      must(text.includes(PLANNER_SLASH_FORM),
        `${carrier.path}: never spells \`${PLANNER_SLASH_FORM}\`, so the user path is undocumented`);
    });
    if (carrier.repo) {
      t.check(`${carrier.path} does not name the script the planner's oracle runs`, () => {
        const text = fs.readFileSync(carrier.file, 'utf8');
        must(!text.includes('umbrella.mjs'),
          `${carrier.path}: names the runtime script — the user surface is the slash command`);
      });
    }
  }

  t.check(`${PLANNER_SKILL_REL} is a user-invocable skill whose argument hint names the steering flags`, () => {
    must(isFile(skillFile), `${PLANNER_SKILL_REL}: missing`);
    const text = fs.readFileSync(skillFile, 'utf8');
    const frontmatter = text.split('\n---\n')[0];
    must(/^user-invocable: true$/m.test(frontmatter),
      'user-invocable is not true, so the slash command does not exist');
    const hint = /^argument-hint: "(.*)"$/m.exec(frontmatter)?.[1] ?? '';
    for (const flag of PLANNER_HINT_FLAGS) {
      must(hint.includes(flag), `argument-hint does not name \`${flag}\`: ${JSON.stringify(hint)}`);
    }
  });

  t.check(`${PLANNER_SKILL_REL} bounds its draft-validate loop`, () => {
    const text = fs.readFileSync(skillFile, 'utf8');
    must(PLANNER_BOUNDED_LOOP.test(text),
      'the sentence bounding the validate loop is gone — an unbounded loop edits until it passes');
  });

  t.check(`${PLANNER_SKILL_REL} states no driver rule, so the planner is never a dispatch target`, () => {
    const text = fs.readFileSync(skillFile, 'utf8');
    must(!text.includes(PLANNER_DRIVER_LITERAL),
      `the skill states ${JSON.stringify(PLANNER_DRIVER_LITERAL)}, which makes driverCapable() answer true for it: the planner becomes a legal dir: target and a chain can dispatch the planner into a member`);
  });

  t.check(`${PLANNED_CHAIN_FIXTURE}/${PLANNED_CHAIN_STEM}.plan.md carries the four required headings, in order`, () => {
    const planFile = path.join(ctx.fixtures, PLANNED_CHAIN_FIXTURE, `${PLANNED_CHAIN_STEM}.plan.md`);
    must(isFile(planFile), `${PLANNED_CHAIN_FIXTURE}/${PLANNED_CHAIN_STEM}.plan.md: missing — the planner publishes three files, not two`);
    const headings = fs.readFileSync(planFile, 'utf8')
      .split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.slice(3).replace(/`/g, '').trim());
    equalJson(headings, PLANNED_CHAIN_PLAN_HEADINGS,
      'the plan file\'s second-level headings — the skill requires exactly these four, in this order');
    const skillText = fs.readFileSync(skillFile, 'utf8');
    for (const heading of PLANNED_CHAIN_PLAN_HEADINGS) {
      must(skillText.includes(heading),
        `${PLANNER_SKILL_REL} no longer requires the heading ${JSON.stringify(heading)} the fixture is pinned to`);
    }
  });

  t.check(`${PLANNER_REFERENCE_REL} is present`, () => {
    must(isFile(path.join(ctx.pluginRoot, PLANNER_REFERENCE_REL)),
      `${PLANNER_REFERENCE_REL}: missing — the skill defers the plan-time rules to it`);
  });

  // The published pair, judged by the oracle the planner itself uses. It is
  // copied into the workspace because that is where a published chain lives
  // and the companion is found by swapping the extension on the definition's
  // path — so the second check below names the definition the way the manifest
  // names it, relative to the workspace root, from a working directory that is
  // not the root. That used to resolve nowhere: the validator read the path as
  // given and re-anchored nothing, which was invisible to a driver running at
  // the root and a trap to anyone validating by hand.
  const fixtureDir = path.join(ctx.fixtures, PLANNED_CHAIN_FIXTURE);
  const scripts = path.join(ctx.pluginRoot, UMBRELLA_SCRIPTS);
  await t.checkAsync('the planned pair validates clean, with an empty report', async () => {
    must(isDir(fixtureDir), `${PLANNED_CHAIN_FIXTURE}: the planned-chain fixture is absent`);
    must(isFile(path.join(scripts, 'umbrella.mjs')), `${UMBRELLA_SCRIPTS}/umbrella.mjs is absent`);
    const { init, validate } = await import(pathToFileURL(path.join(scripts, 'lib', 'manifest.mjs')).href);
    const root = tempDir('planned-chain');
    try {
      for (const member of PLANNED_CHAIN_MEMBERS) gitDir(root, 'projects', member);
      const started = init(root, { membersRoot: null, force: false, scaffold: false });
      must(started.ok, `init refused: ${JSON.stringify(started.errors)}`);
      const workflows = path.join(root, '.maister', 'workflows');
      for (const ext of ['yml', 'md']) {
        const name = `${PLANNED_CHAIN_STEM}.${ext}`;
        const from = path.join(fixtureDir, name);
        must(isFile(from), `${PLANNED_CHAIN_FIXTURE}/${name}: missing — the pair is published side by side`);
        fs.copyFileSync(from, path.join(workflows, name));
      }
      const definition = path.join(workflows, `${PLANNED_CHAIN_STEM}.yml`);
      const judged = validate(root, { definitions: [definition] });
      // `ok` is `errors.length === 0`, so asserting both would be asserting once.
      equalJson(judged.errors, [], 'the planned pair was rejected');
      equalJson(judged.warnings.map(w => w.message), PLANNED_CHAIN_WARNINGS,
        'the warning stream — a planned chain adds nothing to a clean workspace');
      for (const warning of judged.warnings) {
        must(warning.file === path.join(root, '.maister', 'umbrella.yml'),
          `a warning names ${warning.file}, not the manifest: it would be reported as the chain's defect`);
      }
      // Every `direct:` node resolves through the prose companion beside the
      // definition, so a companion that was not found is what a lost anchor
      // looks like in the report.
      const direct = judged.resolved.filter(entry => entry.from === 'companion');
      must(direct.length > 0, 'the planned pair resolves no node through its companion — the check proves nothing');

      // The same pair, named as the manifest names it, from a subdirectory.
      const relativeName = path.join('.maister', 'workflows', `${PLANNED_CHAIN_STEM}.yml`);
      const elsewhere = path.join(root, 'projects', PLANNED_CHAIN_MEMBERS[0]);
      const cwd = process.cwd();
      let fromBelow;
      try {
        process.chdir(elsewhere);
        fromBelow = validate(root, { definitions: [relativeName] });
      } finally {
        process.chdir(cwd);
      }
      equalJson(fromBelow.errors, [], 'a workspace-relative definition validated from a subdirectory was rejected');
      equalJson(fromBelow.resolved.filter(entry => entry.from === 'companion').length, direct.length,
        'the companion resolved from a subdirectory');
      // The report names what the caller typed, so the path in it is the path
      // they can act on.
      must(fromBelow.definitions.every(entry => entry.file === relativeName),
        `the report re-spelled the definition path: ${JSON.stringify(fromBelow.definitions)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  return { checks: t.checks, failures: t.failures, notes: t.notes };
}


// ---------------------------------------------------------------------------
// T42 — the home for generated chains
// ---------------------------------------------------------------------------

/**
 * A generated chain is one the planner publishes for a single ticket or run,
 * and it lives in `.maister/workflows/generated/` rather than beside the
 * reusable chains. The claim the home makes is that it changes nothing but the
 * listing: the same definition validates to the same verdict and the same
 * graph hash from either directory, the run's frozen `workflow.source`
 * re-resolves from the generated path exactly as the envelope re-resolves an
 * eject, and the workspace validator merely *says* which it judged. That claim
 * is what this test holds, against the checked-in generated-chain fixture.
 *
 * The rest is the surfaces that have to agree on the home: `init` scaffolds
 * it with an ignore file whose two lines the planner spells too when it
 * creates the home on first use — pinned equal, or the two drift apart; the
 * engine's skill and the user docs state the resolution order with the
 * generated candidate between eject and overlay; the planner offers the flag
 * and names the home. The prune verb's behaviour is exercised in the
 * umbrella-runtime test, where every refusal the runtime raises is provoked.
 */
const GENERATED_CHAIN_FIXTURE = path.join('synthetic', 'generated-chain');
const GENERATED_CHAIN_STEM = 'ticket-alpha-42-rollout';
const GENERATED_CHAIN_MEMBERS = ['repo-alpha'];
const GENERATED_HOME = '.maister/workflows/generated/';
/** The candidates in the order the engine tries them; the generated one sits second. */
const RESOLUTION_ORDER = ['.maister/workflows/<name>.yml', '.maister/workflows/generated/<name>.yml', '.maister/workflows/<name>.overlay.yml'];
const ENGINE_SKILL_REL = 'skills/workflow-engine/SKILL.md';
const WORKFLOWS_DOCS_REL = 'docs/workflows.md';
const GENERATED_RUN_ID = '019260a2-4455-7c33-8d44-5e6677889900';

async function t42(ctx) {
  const t = checker();
  const scripts = path.join(ctx.pluginRoot, UMBRELLA_SCRIPTS);
  const { init, validate, GENERATED_IGNORE } = await import(pathToFileURL(path.join(scripts, 'lib', 'manifest.mjs')).href);
  const { resolveFromState, readState } = await import(pathToFileURL(path.join(scripts, 'lib', 'envelope.mjs')).href);
  const { readDefinition } = await import(pathToFileURL(path.join(scripts, 'lib', 'definition.mjs')).href);
  const { resolve: resolveGraph } = await import(
    pathToFileURL(path.join(ctx.pluginRoot, ENGINE, 'scripts', 'lib', 'graph.mjs')).href);
  const fixtureDir = path.join(ctx.fixtures, GENERATED_CHAIN_FIXTURE);

  t.check('the ignore file has the two lines that ignore everything but itself', () => {
    must(GENERATED_IGNORE === '*\n!.gitignore\n', `GENERATED_IGNORE is ${JSON.stringify(GENERATED_IGNORE)}`);
  });

  t.check('init scaffolds the generated home with its ignore file, and a forced re-init preserves an edited one', () => {
    const root = tempDir('generated-init');
    try {
      gitDir(root, 'projects', 'repo-alpha');
      const first = init(root, { membersRoot: null, force: false, scaffold: false });
      must(first.ok, `init refused: ${JSON.stringify(first.errors)}`);
      const ignore = path.join(root, GENERATED_HOME, '.gitignore');
      must(first.created.includes(`${GENERATED_HOME}.gitignore`), 'the ignore file is not in the created list');
      must(first.created.includes(GENERATED_HOME.slice(0, -1)), 'the generated home is not in the created list');
      must(fs.readFileSync(ignore, 'utf8') === GENERATED_IGNORE, 'the ignore file is not the pinned two lines');
      fs.writeFileSync(ignore, '*\n!.gitignore\n!keep-this.yml\n', 'utf8');
      const second = init(root, { membersRoot: null, force: true, scaffold: false });
      must(second.ok, `the forced init refused: ${JSON.stringify(second.errors)}`);
      must(second.preserved.includes(`${GENERATED_HOME}.gitignore`), 'the edited ignore file is not reported as preserved');
      must(fs.readFileSync(ignore, 'utf8').includes('keep-this.yml'), 'the forced init rewrote the edited ignore file');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.checkAsync('the same chain validates identically from the top level and from the generated home, and only the home is reported', async () => {
    must(isDir(fixtureDir), `${GENERATED_CHAIN_FIXTURE}: the generated-chain fixture is absent`);
    const root = tempDir('generated-home');
    try {
      for (const member of GENERATED_CHAIN_MEMBERS) gitDir(root, 'projects', member);
      must(init(root, { membersRoot: null, force: false, scaffold: false }).ok, 'init refused');
      const workflows = path.join(root, '.maister', 'workflows');
      const home = path.join(root, GENERATED_HOME);
      for (const dir of [workflows, home]) {
        for (const ext of ['yml', 'md']) {
          fs.copyFileSync(path.join(fixtureDir, `${GENERATED_CHAIN_STEM}.${ext}`), path.join(dir, `${GENERATED_CHAIN_STEM}.${ext}`));
        }
      }
      const top = path.join(workflows, `${GENERATED_CHAIN_STEM}.yml`);
      const generated = path.join(home, `${GENERATED_CHAIN_STEM}.yml`);
      const judged = validate(root, { definitions: [top, generated] });
      equalJson(judged.errors, [], 'the pair was rejected from one of the two homes');
      equalJson(judged.warnings.map(w => w.message), PLANNED_CHAIN_WARNINGS,
        'the warning stream — the home adds nothing to a clean workspace');
      equalJson(judged.definitions, [{ file: top, generated: false }, { file: generated, generated: true }],
        'the report\'s definitions list');

      // The hash is a function of the resolved graph, never of the path.
      const hashOf = file => resolveGraph({ definition: readDefinition(file), overlays: [], profile: null }).graph_hash;
      must(hashOf(top) === hashOf(generated), 'the graph hash differs between the two homes');

      // A run that froze the generated path re-resolves through the envelope's
      // own reader to the same hash, so dispatch is unaffected by the home.
      const run = path.join(root, '.maister', 'umbrella', 'runs', GENERATED_RUN_ID);
      fs.mkdirSync(run, { recursive: true });
      fs.writeFileSync(path.join(run, 'orchestrator-state.yml'), `orchestrator:
  started_phase: null
  completed_phases: []
  failed_phases: []
  created: "2026-09-08T09:00:00Z"
  updated: "2026-09-08T09:15:40Z"
  task_path: ".maister/umbrella/runs/${GENERATED_RUN_ID}"
  gate_pending: null

task:
  title: "Ticket rollout"
  status: in_progress

workflow:
  name: ${GENERATED_CHAIN_STEM}
  source: "${GENERATED_HOME}${GENERATED_CHAIN_STEM}.yml"
  overlays: []
  profile: null
  graph_hash: "${hashOf(generated)}"
  grammar_version: 1
  nodes:
    analyze:           {kind: task, status: completed, needs: []}
    dispatch-approval: {kind: gate, status: completed, needs: [analyze]}
    apply:             {kind: task, status: pending, needs: [dispatch-approval], dir: repo-alpha, provider: claude}
    close-out:         {kind: task, status: pending, needs: [apply]}
`, 'utf8');
      const resolved = resolveFromState({ state: readState(run), run });
      must(resolved.ok, `the frozen generated source did not re-resolve: ${JSON.stringify(resolved.errors)}`);
      must(resolved.graph_hash === hashOf(generated), 'the re-resolved hash differs from the frozen one');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  t.check(`${GENERATED_CHAIN_FIXTURE}/${GENERATED_CHAIN_STEM}.plan.md carries the four required headings, in order`, () => {
    const headings = fs.readFileSync(path.join(fixtureDir, `${GENERATED_CHAIN_STEM}.plan.md`), 'utf8')
      .split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.slice(3).replace(/`/g, '').trim());
    equalJson(headings, PLANNED_CHAIN_PLAN_HEADINGS, 'the plan file\'s second-level headings');
  });

  const carriers = [
    { path: ENGINE_SKILL_REL, file: path.join(ctx.pluginRoot, ENGINE_SKILL_REL) },
    { path: WORKFLOWS_DOCS_REL, file: path.join(ctx.repoRoot, WORKFLOWS_DOCS_REL), repo: true },
  ];
  for (const carrier of carriers) {
    if (carrier.repo && !isFile(carrier.file)) {
      t.notes.push(`${carrier.path} is not in this checkout — skipped`);
      continue;
    }
    t.check(`${carrier.path} states the resolution order with the generated candidate between eject and overlay`, () => {
      must(isFile(carrier.file), `${carrier.path}: missing`);
      const text = fs.readFileSync(carrier.file, 'utf8');
      const positions = RESOLUTION_ORDER.map(candidate => text.indexOf(candidate));
      RESOLUTION_ORDER.forEach((candidate, index) => {
        must(positions[index] >= 0, `${carrier.path}: never spells the candidate \`${candidate}\``);
      });
      must(positions[0] < positions[1] && positions[1] < positions[2],
        `${carrier.path}: the candidates are not in the order eject → generated → overlay`);
    });
  }

  t.check(`${PLANNER_SKILL_REL} offers --generated, names the home, and spells the ignore file as init writes it`, () => {
    const text = fs.readFileSync(path.join(ctx.pluginRoot, PLANNER_SKILL_REL), 'utf8');
    const hint = /^argument-hint: "(.*)"$/m.exec(text.split('\n---\n')[0])?.[1] ?? '';
    must(hint.includes('--generated'), `argument-hint does not name \`--generated\`: ${JSON.stringify(hint)}`);
    must(text.includes(GENERATED_HOME), `never names the generated home ${GENERATED_HOME}`);
    // The skill quotes the ignore file as a fenced block; its body has to be
    // the runtime's own two lines, or the home the planner creates on first
    // use is not the home init creates.
    const fenced = /```\n\*\n!\.gitignore\n```/.test(text);
    must(fenced, 'the ignore file the planner spells is not the two lines init writes');
    must(!text.includes(PLANNER_DRIVER_LITERAL), 'the planner now states the driver literal — it would become a dispatch target');
  });

  t.check(`${UMBRELLA_SKILL_REL} and the command reference say a generated chain is never overlaid or ejected`, () => {
    for (const carrier of [
      { path: PLANNER_SKILL_REL, file: path.join(ctx.pluginRoot, PLANNER_SKILL_REL) },
      { path: ENGINE_SKILL_REL, file: path.join(ctx.pluginRoot, ENGINE_SKILL_REL) },
    ]) {
      const text = fs.readFileSync(carrier.file, 'utf8');
      must(/never (?:overlaid|ejected)|neither overlaid nor ejected|no overlay .{0,40}applies/i.test(text),
        `${carrier.path}: does not state that a generated chain is never overlaid or ejected`);
    }
  });

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T43 — the plan workflow, and the user surface it deliberately has none of
// ---------------------------------------------------------------------------

/**
 * `plan` is the first chain-only built-in: a definition reached as
 * `workflow:plan` from a chain node carrying a `dir:`, and reachable no other
 * way. Every other shipped workflow has a twin somewhere a reader can find —
 * an orchestrator skill, a slash command, a section in the command reference —
 * and T31/T33 are the parity checklists that hold those two halves together.
 * This one has no second half at all, which is why neither of those shapes
 * fits it and why this test exists instead.
 *
 * It asserts four things, and the fourth is the reason for the first three.
 *
 * The definition validates and resolves clean, with an empty warning list.
 * T29's walk already pins that property over every shipped definition; it is
 * re-asserted here so that a failure names this file rather than a directory
 * walk, and so that this test is meaningful on its own.
 *
 * The node ids and the gate shape are pinned. They are public API from first
 * release: a chain frozen against this graph names `plan-approval` and answers
 * it with `continue-to-handoff` or `stop-after-plan`, so a rename is a
 * deprecation and not an edit. The gate's option *map* is pinned rather than
 * its keys, because the verdict each option carries is the half that ends the
 * run.
 *
 * There is no user alias. Four negatives: no `skills/plan/`, no
 * `commands/plan.md`, no `SKILL.md` naming `builtin:plan` — the positive
 * precedent being `skills/research/SKILL.md` and `skills/development/SKILL.md`,
 * each naming its own — and no `commands/*.md` naming the workflow at all.
 * That last one is a sweep and deliberately not an inventory: pinning the
 * command directory as an exact file list would turn this test red the day an
 * unrelated command ships, for a reason with nothing to do with `plan`.
 *
 * The prose names the driver rule and branches on provider. The literal
 * `orchestrator.driver.kind` belongs in the workflow prose, where a run reads
 * it — and in no new `SKILL.md`, because `driverCapable` reads that literal out
 * of a skill file to decide whether the skill is a legal `dir:` target. The
 * third negative above is what keeps that true. Both provider names are
 * asserted inside the `plan` section specifically: a branch stated somewhere
 * else in the file is not a branch this node takes.
 */
const PLAN_WORKFLOW_REL = `${ENGINE}/workflows/plan.yml`;
const PLAN_PROSE_REL = `${ENGINE}/workflows/plan.md`;
/** The node ids, in canonical order. Public API; see `WORKFLOW_PINS.plan`. */
const PLAN_NODES = ['standards-discovery', 'plan', 'plan-approval', 'handoff'];
const PLAN_GATE = 'plan-approval';
/** The gate's option map: each id and the verdict it carries. */
const PLAN_GATE_OPTIONS = { 'continue-to-handoff': 'continue', 'stop-after-plan': 'stop' };
/**
 * Every second-level heading in the prose companion, in order: the front
 * sections `research.md` also carries, then one section per node. A node
 * heading is keyed off the `direct:` target name rather than the node id —
 * they are equal here, and `hasProseSection` breaks silently if a rename ever
 * separates them.
 */
const PLAN_PROSE_HEADINGS = [
  'Run-scoped context', 'Phase summary keys', 'Icon hints', 'Embedded mode',
  'standards-discovery', 'plan', 'plan-approval', 'handoff',
];
/** The driver literal, spelled as `DRIVER_RULE` spells it in `envelope.mjs`. */
const PLAN_DRIVER_LITERAL = 'orchestrator.driver.kind';
/** Both hosts, named in the one section that branches between them. */
const PLAN_PROVIDERS = ['Claude Code', 'Copilot CLI'];
/**
 * The three spellings a command file would reach this workflow by. A command
 * naming any of them is a user surface, which this workflow does not have.
 */
const PLAN_ALIAS_SPELLINGS = [/builtin:plan\b/, /workflow:plan\b/, /\/maister:plan(?![\w-])/];

async function t43(ctx) {
  const t = checker();
  const engine = path.join(ctx.pluginRoot, ENGINE);
  const definitionFile = path.join(ctx.pluginRoot, PLAN_WORKFLOW_REL);
  const proseFile = path.join(ctx.pluginRoot, PLAN_PROSE_REL);
  const lib = name => pathToFileURL(path.join(engine, 'scripts', 'lib', `${name}.mjs`)).href;
  const { readDefinition } = await import(lib('definition'));
  const { resolve: resolveGraph } = await import(lib('graph'));

  if (!isFile(definitionFile)) {
    return { checks: 1, failures: [`${PLAN_WORKFLOW_REL}: the definition is absent`], notes: [] };
  }
  const graph = resolveGraph({ definition: readDefinition(definitionFile), overlays: [], profile: null, degraded: [] });

  t.check('the plan definition resolves with no error and no warning', () => {
    equalJson(graph.errors, [], `${PLAN_WORKFLOW_REL} was rejected`);
    equalJson(graph.warnings, [],
      `${PLAN_WORKFLOW_REL} resolves with a warning — a shipped definition carries none`);
  });

  t.check('the plan definition resolves to its four pinned nodes, in canonical order', () => {
    equalJson(graph.nodes.map(n => n.id), PLAN_NODES,
      'the node ids — public API from first release, so a rename is a deprecation and not an edit');
  });

  t.check(`the ${PLAN_GATE} gate offers exactly its two pinned options`, () => {
    const gate = graph.nodes.find(n => n.id === PLAN_GATE);
    must(gate, `${PLAN_GATE}: the gate node is gone`);
    must(gate.type === 'gate', `${PLAN_GATE} is typed ${JSON.stringify(gate.type)}, not gate`);
    equalJson(gate.options, PLAN_GATE_OPTIONS,
      'the gate option map — the id a chain answers with, and the verdict that answer carries');
  });

  t.check('the prose companion carries the front sections and one section per node, in order', () => {
    must(isFile(proseFile),
      `${PLAN_PROSE_REL}: the prose companion is absent — every direct: node resolves against it`);
    const headings = fs.readFileSync(proseFile, 'utf8')
      .split('\n').filter(line => line.startsWith('## '))
      .map(line => line.slice(3).replace(/`/g, '').trim());
    equalJson(headings, PLAN_PROSE_HEADINGS,
      'the prose companion\'s second-level headings; a node section is keyed off the direct: target name');
  });

  // -- the four negatives: this workflow has no user surface ----------------
  t.check('skills/plan/ is not a directory', () => {
    must(!isDir(path.join(ctx.pluginRoot, 'skills', 'plan')),
      'skills/plan/ exists — a chain-only workflow has no orchestrator skill, and one there is a second half nothing keeps in step');
  });

  t.check('commands/plan.md is not a file', () => {
    must(!isFile(path.join(ctx.pluginRoot, 'commands', 'plan.md')),
      'commands/plan.md exists — the plan workflow is reached from a chain node, never from a slash command');
  });

  t.check('no SKILL.md names builtin:plan', () => {
    const skillsDir = path.join(ctx.pluginRoot, 'skills');
    must(isDir(skillsDir), 'skills/ is absent');
    const named = fs.readdirSync(skillsDir)
      .map(name => ({ name, file: path.join(skillsDir, name, 'SKILL.md') }))
      .filter(each => isFile(each.file) && fs.readFileSync(each.file, 'utf8').includes('builtin:plan'))
      .map(each => `skills/${each.name}/SKILL.md`);
    equalJson(named, [],
      'a skill names builtin:plan the way skills/research/SKILL.md and skills/development/SKILL.md name their own: that skill is the user surface this workflow has none of');
  });

  t.check('no command file names the plan workflow', () => {
    const commandsDir = path.join(ctx.pluginRoot, 'commands');
    must(isDir(commandsDir), 'commands/ is absent');
    // A sweep, not an inventory: pinning the directory as an exact file list
    // would turn red the day an unrelated command ships, for a reason with
    // nothing to do with `plan`.
    const named = [];
    for (const name of fs.readdirSync(commandsDir).filter(each => each.endsWith('.md')).sort()) {
      const text = fs.readFileSync(path.join(commandsDir, name), 'utf8');
      for (const spelling of PLAN_ALIAS_SPELLINGS) {
        if (spelling.test(text)) named.push(`commands/${name} names ${String(spelling)}`);
      }
    }
    equalJson(named, [], 'a command file reaches the plan workflow, so it has a user surface after all');
  });

  // -- the prose names the driver rule and branches on provider -------------
  t.check('the prose names the driver rule literal', () => {
    const text = fs.readFileSync(proseFile, 'utf8');
    must(text.includes(PLAN_DRIVER_LITERAL),
      `${PLAN_PROSE_REL}: never spells ${JSON.stringify(PLAN_DRIVER_LITERAL)}, so a dispatched run has nothing telling it how to answer its gate`);
  });

  t.check('the plan section branches on provider, naming both hosts inside itself', () => {
    const lines = fs.readFileSync(proseFile, 'utf8').split('\n');
    const start = lines.findIndex(line => line.trim() === '## `plan`');
    must(start >= 0, `${PLAN_PROSE_REL}: there is no \`plan\` section`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => line.startsWith('## '));
    const section = rest.slice(0, end < 0 ? rest.length : end).join('\n');
    for (const provider of PLAN_PROVIDERS) {
      must(section.includes(provider),
        `the \`plan\` section never names ${JSON.stringify(provider)} — a branch stated elsewhere in the file is not one this node takes`);
    }
  });

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T44 — every workflow type has a run fixture
// ---------------------------------------------------------------------------

/**
 * The workflow-type enum (`common.schema.json#/$defs/workflow_type`) is closed,
 * and appending to it is a contract change: register row, schema and fixture
 * move together (CLAUDE.md, hard rules). The schema and the register are read
 * by every test; a *missing* fixture is read by none of them, which is how
 * `plan` shipped with its enum member and its register row and no run
 * fixture at all. This test closes that gap: for every enum member there is at
 * least one `valid` run fixture whose state file resolves to that type, so the
 * next enum addition fails the suite until its run directory is sampled.
 *
 * A run fixture's type is read from where the writer records it: the A4
 * `task_path` type segment first, then `orchestrator.type`, then the
 * dashboard's `task.type`. The register spells the migration type dir in the
 * plural, the enum in the singular; the segment is normalized so a fixture
 * written against either spelling counts.
 */
const WORKFLOW_TYPE_POINTER = '/$defs/workflow_type/enum';
const TYPE_DIR_ALIASES = new Map([['migrations', 'migration']]);

/** The workflow type a run fixture records, or null when it is not a run. */
function runFixtureType(fx) {
  const { state, dashboard } = runPair(fx);
  if (!state) return null;
  const taskPath = String(state.orchestrator?.task_path ?? '');
  const segments = taskPath.split('/');
  const at = segments.indexOf('tasks');
  const fromPath = at >= 0 && segments.length > at + 2 ? segments[at + 1] : null;
  const raw = fromPath ?? state.orchestrator?.type ?? dashboard?.task?.type ?? null;
  return raw === null ? null : (TYPE_DIR_ALIASES.get(String(raw)) ?? String(raw));
}

function t44(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const common = readJson(path.join(ctx.schemas, 'common.schema.json'));
  const members = resolvePointer(common, WORKFLOW_TYPE_POINTER);
  checks++;
  if (!Array.isArray(members) || members.length === 0) {
    return { checks, failures: [`common.schema.json#${WORKFLOW_TYPE_POINTER} is not a non-empty enum`] };
  }

  const covered = new Map(members.map(m => [m, []]));
  const synthetic = new Set();
  for (const fx of byVerdict(ctx, 'valid')) {
    const type = runFixtureType(fx);
    if (type === null) continue;
    if (fx.manifest.synthetic === true) synthetic.add(fx.id);
    checks++;
    if (!covered.has(type)) {
      failures.push(`${fx.id}: records workflow type ${JSON.stringify(type)}, which is not an enum member`);
      continue;
    }
    covered.get(type).push(fx.id);
  }

  for (const [type, ids] of covered) {
    checks++;
    if (ids.length === 0) {
      failures.push(`${type}: an enum member with no valid run fixture — sample one under fixtures/contracts/valid/runs/${type}-<slug>/`);
    } else {
      // Covered, and by what. A hand-built fixture proves the schema accepts a
      // shape someone typed; only a sampled one proves the shape a writer
      // produces. The row cannot insist on sampled — a new enum member has no
      // real run to sample the day it lands — but a member covered only by
      // synthetic fixtures is a standing debt, and it used to be recorded
      // nowhere but in a note string inside the fixture itself. Saying it on
      // every run puts it where the next person to sample a run will see it.
      const sampled = ids.filter(id => !synthetic.has(id));
      notes.push(sampled.length
        ? `${type}: ${ids.join(', ')}`
        : `${type}: ${ids.join(', ')} — synthetic only, still to be re-sampled from a real run`);
    }
  }
  return { checks, failures, notes };
}


// ---------------------------------------------------------------------------
// T45 — every prompt-line kind carries a measured `at=`
// ---------------------------------------------------------------------------

/**
 * The C5 prompt vocabulary is what the daemon sends as the first line when it
 * resumes a driver, and the resumed turn has no other measured time for itself.
 * `GATE-ANSWER` carried `at=` from the start and the other three did not, so a
 * driver re-driven, steered or plainly resumed either carried the previous
 * turn's stamp forward or formatted one — the defect that writes a midnight
 * `started` into a run's permanent record. The `contracts-v4` widening put the
 * field on all four.
 *
 * Nothing else would notice a fifth kind arriving without it: the union pattern
 * validates each kind against its own branch, so an unstamped branch is simply
 * a branch that accepts unstamped lines. This test reads the kinds structurally
 * — every `#/$defs/prompt_*` the union names — and requires each to end with
 * the A6 timestamp, so the next kind added to the vocabulary fails the suite
 * until it carries the stamp too.
 */
const PROMPT_AT_TAIL = String.raw` at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`;

function t45(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;

  const markers = readJson(path.join(ctx.schemas, 'markers.schema.json'));
  const defs = markers.$defs ?? {};
  const union = defs.prompt_line?.anyOf;

  checks++;
  if (!Array.isArray(union) || union.length === 0) {
    return { checks, failures: ['markers.schema.json#/$defs/prompt_line does not name its kinds as an anyOf union'] };
  }

  const kinds = [];
  for (const branch of union) {
    checks++;
    const ref = branch?.$ref;
    const name = typeof ref === 'string' ? ref.replace('#/$defs/', '') : null;
    if (!name || !defs[name]) {
      failures.push(`prompt_line names a branch the schema does not define: ${JSON.stringify(branch)}`);
      continue;
    }
    kinds.push(name);
  }

  // every `$defs/prompt_*` is reachable from the union, so none can be orphaned
  // into place and then quietly used by a reader the union never validated
  for (const name of Object.keys(defs)) {
    if (name === 'prompt_line' || !name.startsWith('prompt_')) continue;
    checks++;
    if (!kinds.includes(name)) failures.push(`${name}: a prompt-line kind the prompt_line union does not name`);
  }

  for (const name of kinds) {
    const pattern = defs[name].pattern;
    checks++;
    if (typeof pattern !== 'string') {
      failures.push(`${name}: no pattern`);
      continue;
    }
    checks++;
    if (!pattern.endsWith(PROMPT_AT_TAIL)) {
      failures.push(`${name}: does not end with a measured at= on the A6 form (§ 9): ${pattern}`);
    } else {
      notes.push(`${name}: ${pattern.slice(1, -PROMPT_AT_TAIL.length)} … at=<ts>`);
    }
  }

  // the fixture corpus spells one line per kind, and every one of them is stamped
  if (ctx.have.has('fixtures')) {
    const seen = new Set();
    for (const fx of byVerdict(ctx, 'valid')) {
      for (const entry of fx.manifest.files) {
        if (entry.schema !== 'markers.schema.json#/$defs/prompt_line') continue;
        const file = path.join(fx.dir, entry.path);
        if (!isFile(file)) continue;
        for (const line of loadDocs(file)) {
          seen.add(String(line).split(' ')[0]);
          checks++;
          if (!new RegExp(PROMPT_AT_TAIL).test(String(line))) failures.push(`${fx.id}: an unstamped prompt line: ${line}`);
        }
      }
    }
    checks++;
    if (seen.size !== kinds.length) {
      failures.push(`the corpus spells ${seen.size} prompt-line kinds, the schema defines ${kinds.length}`);
    }
  }

  return { checks, failures, notes };
}


// ---------------------------------------------------------------------------
// T46 — the extension contract: where a target resolves, how a skill declares
// it honours a driver, and the guide that documents both
// ---------------------------------------------------------------------------

/**
 * Three things a user who cannot modify the plugin relies on, each pinned
 * against a staged environment rather than against this machine.
 *
 * **Resolution.** A `skill:` or `agent:` target is looked for in the project,
 * then in the operator's own directories under each host's home, then in this
 * plugin, then in every installed plugin, first hit winning — the
 * `RESOLUTION_ORDER` the graph module exports — and a namespaced target is
 * looked for only in the plugin it names. The fixture is a whole environment:
 * a project carrying skills and agents under both hosts' layouts, and a home
 * directory carrying installed plugins in both hosts' layouts. It is copied to
 * a temporary directory, the engine is pointed at it through the variables the
 * hosts set, and every node's answer is pinned: which place answered and which
 * file. The two names found nowhere are the warning set, and the two
 * spellings the charset refuses are errors, not warnings, because the charset
 * is the traversal guard.
 *
 * **Driver capability.** `driver_aware: true` in a skill's frontmatter is the
 * documented declaration; the built-ins' rule sentence stays honoured. A
 * project-local skill carrying the field is capable, one carrying neither is
 * not, and one that merely mentions the field in prose is not — and the
 * workspace validator, which reads the same file through the same lookup,
 * agrees on a dispatching node. The planner's own skill must declare neither.
 *
 * **The guide.** `docs/extending.md` names the three extension points as
 * headings, states the resolution order exactly once and in the order the code
 * applies, tells a driver-aware skill the four things it must do, says plainly
 * what a contract change is needed for, names no script a user would run and
 * carries no development-process identifier. The README and the workflow
 * reference link to it.
 */
const RESOLUTION_FIXTURE = 'synthetic/target-resolution';
const UMBRELLA_SKILL = 'skills/umbrella';
/** Where the Copilot variant's install notes are authored, before the build stages them. */
const COPILOT_HOOK_NOTES_REL = 'platforms/copilot-cli/hooks/README.md';
/** The variant's own install surface, authored here and staged into the variant by the build. */
const COPILOT_VARIANT_README_REL = 'platforms/copilot-cli/README.md';
/** Where that CLI puts an installed plugin — the answer its own install path never gives. */
const COPILOT_INSTALL_TREE = '.copilot/installed-plugins';
/** The user-facing command reference, and the only place a slash command is documented. */
const COMMAND_REFERENCE_REL = 'docs/commands.md';
const EXTENDING_GUIDE_REL = 'docs/extending.md';
/** The per-workflow reference, and the only place internal skills are listed. */
const WORKFLOW_REFERENCE_REL = 'docs/workflows.md';
const INTERNAL_SKILLS_HEADING = '## Internal Skills';
const EXTENDING_LINKED_FROM = ['README.md', 'docs/workflows.md'];
/** The three extension points, each exactly one second-level heading. */
const EXTENSION_POINTS = [
  'Your own chains',
  'Your own skills and agents as nodes',
  'Overlays and eject over the built-ins',
];
/** The words the guide's one resolution-order sentence must carry, per place. */
const RESOLUTION_WORDS = {
  project: 'project', user: 'your own', plugin: 'this plugin', installed: 'installed plugins',
};
/** What a driver-aware skill must do, as the guide has to spell it. */
const DRIVER_AWARE_DUTIES = [/driver\.kind/, /cockpit/, /dispatch/, /`gate-request`/, /`write-state`/];
/** The closed shapes the guide must say need a contract change. */
const NOT_EXTENSIBLE = [/schemes?/i, /gate effects?/i, /node types?/i, /contract/];
/** A user reads slash commands, never these. */
const GUIDE_SCRIPT_PATHS = ['workflow.mjs', 'umbrella.mjs', 'CLAUDE_PLUGIN_ROOT'];
/** Development-process identifiers a shipped document must not carry. */
const GUIDE_PROCESS_IDS = [/\b1[0-9][a-z]\b/, /\bT[0-9]{2}\b/, /\bADR-/, /\bcontracts-v[0-9]/];
/** Where each fixture node resolves: `from`, and the suffix of the file found. */
const RESOLVED_PINS = {
  review: ['project', 'project/.claude/skills/local-review/SKILL.md'],
  shadowed: ['project', 'project/.claude/skills/quick-plan/SKILL.md'],
  shipped: ['plugin', 'skills/quick-dev/SKILL.md'],
  'github-skill': ['project', 'project/.github/skills/copilot-local/SKILL.md'],
  packaged: ['installed', 'acme-tools/1.0.0/skills/review/SKILL.md'],
  relayed: ['installed', 'copilot-only/skills/relay/SKILL.md'],
  probed: ['installed', 'src-0001/skills/probe/SKILL.md'],
  'own-namespace': ['plugin', 'skills/quick-dev/SKILL.md'],
  'agent-local': ['project', 'project/.claude/agents/local-agent.md'],
  'agent-copilot': ['project', 'project/.github/agents/copilot-agent.agent.md'],
  'agent-packaged': ['installed', 'acme-tools/1.0.0/agents/inspector.md'],
  // The operator's own place, and the two things worth pinning about it: that a
  // name only they provide resolves there at all, and that a name this plugin
  // also ships resolves to theirs rather than to the plugin's. The second is
  // the whole of the precedence decision — without it the place could sit
  // anywhere in the order and the fixture would look identical.
  personal: ['user', 'home/.claude/skills/personal-review/SKILL.md'],
  'outranks-plugin': ['user', 'home/.claude/skills/quick-bugfix/SKILL.md'],
  'agent-personal': ['user', 'home/.copilot/agents/personal-agent.md'],
};

async function t46(ctx) {
  const t = checker();
  const engine = path.join(ctx.pluginRoot, ENGINE);
  const entry = path.join(engine, 'scripts', 'workflow.mjs');
  const lib = (dir, name) => pathToFileURL(path.join(ctx.pluginRoot, dir, 'scripts', 'lib', `${name}.mjs`)).href;
  const { locateTarget, RESOLUTION_ORDER, TARGET_REF } = await import(lib(ENGINE, 'graph'));
  const { driverCapability, declaresDriverAware } = await import(lib(UMBRELLA_SKILL, 'envelope'));
  const { init, validate: validateWorkspace } = await import(lib(UMBRELLA_SKILL, 'manifest'));

  const fixture = path.join(ctx.fixtures, ...RESOLUTION_FIXTURE.split('/'));
  const manifest = readJson(path.join(fixture, 'manifest.json'));
  const staged = tempDir('extension');
  copyTree(fixture, staged);
  const project = path.join(staged, 'project');
  const home = path.join(staged, 'home');
  const definition = path.join(project, 'extension.yml');

  // An install the index names and the cache does not hold: the index path.
  const indexed = path.join(home, 'elsewhere', 'beta-tools');
  fs.mkdirSync(path.join(indexed, 'skills', 'beam'), { recursive: true });
  fs.writeFileSync(path.join(indexed, 'skills', 'beam', 'SKILL.md'),
    '---\nname: beam\ndescription: An indexed install declaring driver awareness.\ndriver_aware: true\n---\n\n# Beam\n', 'utf8');
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'beta-tools@acme-marketplace': [{ scope: 'user', installPath: indexed, version: '0.1.0' }] },
  }, null, 2), 'utf8');

  /** The variables both hosts set, pointed at the staged environment. */
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ctx.pluginRoot,
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    HOME: home,
    USERPROFILE: home,
  };
  const run = (...args) => {
    const proc = runBounded(process.execPath, [entry, ...args], { encoding: 'utf8', input: '', env, cwd: project });
    let report = null;
    try { report = JSON.parse(proc.stdout); } catch { /* asserted below */ }
    return { status: proc.status, stderr: proc.stderr ?? '', report };
  };
  /** The same variables, applied to this process for the in-process checks. */
  const withEnv = (body) => {
    const saved = {};
    for (const key of ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE']) {
      saved[key] = process.env[key];
      process.env[key] = env[key];
    }
    try {
      return body();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
  const suffix = (file) => file.split(path.sep).join('/');

  t.check('the exported resolution order is the documented places, in order', () => {
    equalJson(RESOLUTION_ORDER, Object.keys(RESOLUTION_WORDS), 'RESOLUTION_ORDER');
    equalJson(['review', 'acme-tools:review', 'a:b:c', 'Bad', 'a/b', '../x', ':x', 'x:'].map((name) => TARGET_REF.test(name)),
      [true, true, false, false, false, false, false, false], 'TARGET_REF admits one namespace and nothing else');
  });

  t.check('validate resolves every target through the order and says where', () => {
    const out = run('validate', `--definition=${definition}`);
    must(out.report !== null, `no JSON report (${out.stderr.trim().split('\n')[0] ?? ''})`);
    must(out.status === 0 && out.report.ok === true, `rejected: ${JSON.stringify(out.report.errors ?? [])}`);
    equalJson([...out.report.warnings].sort(), [...manifest.expect.warnings].sort(), 'the warning set');
    must(Array.isArray(out.report.resolved), 'the report carries no resolved list');
    const byNode = new Map(out.report.resolved.map((entry) => [entry.node, entry]));
    for (const [node, [from, tail]] of Object.entries(RESOLVED_PINS)) {
      const entry = byNode.get(node);
      must(entry, `${node}: not reported as resolved`);
      must(entry.from === from, `${node}: resolved from ${entry.from}, expected ${from}`);
      must(suffix(entry.at).endsWith(tail), `${node}: resolved at ${entry.at}, expected …${tail}`);
      must(RESOLUTION_ORDER.includes(entry.from), `${node}: "${entry.from}" is not a place in the order`);
    }
    must(byNode.size === Object.keys(RESOLVED_PINS).length,
      `resolved ${byNode.size} targets, expected ${Object.keys(RESOLVED_PINS).length}: ${[...byNode.keys()].join(', ')}`);
  });

  t.check('an install the index names resolves, and a name found nowhere warns by name', () => {
    const file = path.join(staged, 'indexed.yml');
    fs.writeFileSync(file, [
      'name: indexed', 'version: 1', 'inputs:', '  brief: {type: path, required: true}', 'nodes:',
      '  beam:', '    uses: skill:beta-tools:beam', '    needs: []',
      '  nothing:', '    uses: agent:nowhere-at-all', '    needs: []', '',
    ].join('\n'), 'utf8');
    const out = run('validate', `--definition=${file}`);
    must(out.report?.ok === true, `rejected: ${JSON.stringify(out.report?.errors ?? [])}`);
    equalJson(out.report.warnings, ['unresolved-reference:nothing:agent:nowhere-at-all'], 'the warning set');
    equalJson(out.report.resolved.map((entry) => [entry.node, entry.from, suffix(entry.at).endsWith('beta-tools/skills/beam/SKILL.md')]),
      [['beam', 'installed', true]], 'the indexed install');
  });

  t.check('a name off the charset is an error under both schemes, never a warning', () => {
    for (const [label, uses] of [['two namespaces', 'skill:a:b:c'], ['an upper-case name', 'agent:Bad-Name'], ['a path', 'skill:acme/review']]) {
      const file = path.join(staged, 'charset.yml');
      fs.writeFileSync(file, ['name: charset', 'version: 1', 'inputs:', '  brief: {type: path, required: true}', 'nodes:',
        '  step:', `    uses: ${uses}`, '    needs: []', ''].join('\n'), 'utf8');
      const out = run('validate', `--definition=${file}`);
      must(out.status === 1 && out.report?.ok === false, `${label}: accepted (exit ${out.status})`);
      must(out.report.errors.some((error) => error.path === 'nodes.step.uses'), `${label}: no error at nodes.step.uses`);
      must(out.report.warnings.length === 0, `${label}: warned instead — ${JSON.stringify(out.report.warnings)}`);
    }
  });

  t.check('the library lookup answers the same as the verb, and a namespace never reaches the project', () => withEnv(() => {
    const local = locateTarget('skill', 'local-review');
    must(local?.from === 'project', `local-review resolved ${JSON.stringify(local)}`);
    must(locateTarget('skill', 'quick-plan')?.from === 'project', 'the project does not shadow the plugin');
    must(locateTarget('skill', 'quick-plan', { project: staged })?.from === 'plugin',
      'an explicit project root is not the one searched');
    must(locateTarget('skill', 'acme-tools:review')?.from === 'installed', 'the namespaced install is not found');
    must(locateTarget('skill', 'absent-plugin:local-review') === null,
      'a namespace naming no plugin fell through to the project');
    must(locateTarget('skill', 'nowhere-at-all') === null, 'a name found nowhere resolved');
    must(locateTarget('direct', 'anything') === null, 'a scheme the lookup does not own answered');
  }));

  t.check('driver_aware: true in the frontmatter declares capability; prose does not', () => withEnv(() => {
    equalJson(
      ['skill:driver-aware-runner', 'skill:local-review', 'skill:prose-mention', 'skill:beta-tools:beam',
        'skill:acme-tools:review', 'skill:nowhere-at-all', 'skill:development'].map(driverCapability),
      ['capable', 'incapable', 'incapable', 'capable', 'incapable', 'unreadable', 'capable'],
      'driverCapability over the staged skills');
    equalJson(
      ['---\ndriver_aware: true\n---\n', '---\nname: x\ndriver_aware: true\n---\nbody', '---\ndriver_aware: "true"\n---\n',
        '---\nname: x\n---\ndriver_aware: true\n', 'driver_aware: true\n', '---\n# driver_aware: true\n---\n'].map(declaresDriverAware),
      [true, true, false, false, false, false],
      'declaresDriverAware reads the frontmatter and only the frontmatter');
  }));

  t.check('the workspace validator reads the same file: a project skill with the field dispatches, one without does not', () => {
    const root = path.join(staged, 'workspace');
    gitDir(root, 'projects', 'api');
    copyTree(path.join(project, '.claude'), path.join(root, '.claude'));
    const scaffolded = init(root, { membersRoot: null, force: false, scaffold: true });
    must(scaffolded?.ok === true, `init refused: ${JSON.stringify(scaffolded)}`);
    const file = path.join(root, '.maister', 'workflows', 'dispatch-check.yml');
    fs.writeFileSync(file, ['name: dispatch-check', 'version: 1', 'inputs:', '  brief: {type: path, required: true}', 'nodes:',
      '  capable:', '    uses: skill:driver-aware-runner', '    dir: api', '    needs: []',
      '  incapable:', '    uses: skill:local-review', '    dir: api', '    needs: []', ''].join('\n'), 'utf8');
    const report = withEnv(() => validateWorkspace(root, { definitions: [file] }));
    must(report.ok === false, 'the incapable node was not reported');
    equalJson(report.errors.map((error) => error.path), ['nodes.incapable.uses'], 'the located errors');
    must(/driver_aware: true/.test(report.errors[0].message), 'the recovery does not name the frontmatter field');
    must(report.warnings.every((warning) => !/unresolved-reference/.test(warning.message)),
      `a project skill was reported unresolved: ${JSON.stringify(report.warnings)}`);
    equalJson(report.resolved.map((entry) => [entry.node, entry.from]).sort(),
      [['capable', 'project'], ['incapable', 'project']], 'where the workspace validator found the two skills');
  });

  // The internal-skills table, held to the tree it describes. It listed two
  // skills that do not exist - one of them an agent, one of them nothing at all
  // - and omitted five that do, because it was a list maintained by hand
  // against a directory that kept changing. The skills themselves already say
  // whether they are machinery, in the same frontmatter key the command
  // reference is checked against, so the table has a source of truth and the
  // only question is whether it agrees with it.
  t.check('the internal-skills table names exactly the skills that declare themselves machinery', () => {
    const skillsDir = path.join(ctx.pluginRoot, 'skills');
    const internal = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isFile(path.join(skillsDir, entry.name, 'SKILL.md')))
      .filter(entry => /^user-invocable:\s*false\s*$/m.test(
        fs.readFileSync(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf8').split('\n---\n')[0]))
      .map(entry => entry.name).sort();
    must(internal.length > 0, 'no skill declares itself machinery — the sweep is looking in the wrong place');

    const text = fs.readFileSync(path.join(ctx.repoRoot, WORKFLOW_REFERENCE_REL), 'utf8');
    const heading = text.indexOf(INTERNAL_SKILLS_HEADING);
    must(heading >= 0, `${WORKFLOW_REFERENCE_REL}: there is no ${INTERNAL_SKILLS_HEADING} section`);
    const rest = text.slice(heading + INTERNAL_SKILLS_HEADING.length);
    const next = rest.search(/\n## /);
    const section = next < 0 ? rest : rest.slice(0, next);
    const named = [...section.matchAll(/^\|\s*\*\*([a-z][a-z0-9-]*)\*\*\s*\|/gm)].map(m => m[1]).sort();
    equalJson(named, internal,
      `${WORKFLOW_REFERENCE_REL}: the internal-skills table and the skills declaring themselves machinery disagree`);
  });

  t.check('the planner declares driver awareness in neither form', () => {
    const text = fs.readFileSync(path.join(ctx.pluginRoot, PLANNER_SKILL_REL), 'utf8');
    must(!declaresDriverAware(text), `${PLANNER_SKILL_REL} carries driver_aware: true, so a chain can dispatch the planner`);
  });

  // -- what a skill declares, what its own prose says, and what is documented -
  //
  // Three statements about the same fact, and each pair of them disagreed
  // somewhere. `user-invocable: true` is what makes a slash command exist, so
  // a skill carrying it while its own prose calls itself machinery has two
  // answers and the frontmatter wins silently; a skill carrying it with no row
  // in the command reference has a command nobody is told about. Both happened,
  // in two skills each, which is why this is a rule rather than two edits.
  //
  // The default is reachable: five skills omit the key and are documented, so
  // an absent declaration is read as `true` rather than as undecided. What the
  // lint forbids is a contradiction in either direction.
  const DENIES_INVOCATION = /not\s+(?:directly\s+)?user-invocable/i;
  t.check('every skill agrees with its own prose and with the command reference about being invocable', () => {
    const skillsDir = path.join(ctx.pluginRoot, 'skills');
    const reference = fs.readFileSync(path.join(ctx.repoRoot, COMMAND_REFERENCE_REL), 'utf8');
    const names = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isFile(path.join(skillsDir, entry.name, 'SKILL.md')))
      .map(entry => entry.name).sort();
    must(names.length >= 15, `only ${names.length} skills found — the sweep is looking in the wrong place`);

    for (const name of names) {
      const text = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
      const frontmatter = text.split('\n---\n')[0];
      const declared = /^user-invocable:\s*(\S+)\s*$/m.exec(frontmatter)?.[1] ?? null;
      must(declared === null || declared === 'true' || declared === 'false',
        `${name}: user-invocable is ${JSON.stringify(declared)}, which is neither true nor false`);
      const reachable = declared !== 'false';
      // The command reference's own heading form, so a mention in prose is not
      // mistaken for a documented command.
      const documented = new RegExp(`^### \`/maister:${name}\\b`, 'm').test(reference);

      if (reachable) {
        must(documented,
          `${name}: user-invocable ${declared === null ? 'defaults to true' : 'is true'}, so the slash command exists, but ${COMMAND_REFERENCE_REL} documents no such command`);
        must(!DENIES_INVOCATION.test(text),
          `${name}: the frontmatter makes a slash command exist while the skill's own prose denies it`);
      } else {
        must(!documented,
          `${name}: user-invocable is false, so there is no slash command, but ${COMMAND_REFERENCE_REL} documents one`);
        must(!text.includes(`/maister:${name}`),
          `${name}: user-invocable is false while the prose spells /maister:${name} as something to run`);
      }
    }
  });

  // -- the exec forms resolve in both provider vocabularies -----------------
  //
  // Four skills tell an agent to run `node <plugin root>/skills/…`. The root is
  // named by a variable, and there is exactly one variable per provider: Claude
  // Code exports `CLAUDE_PLUGIN_ROOT`, Copilot CLI exports no plugin-directory
  // variable at all, so the emitted variant names its own and the install notes
  // ask for it. The build renames it; what is checked here is that both trees
  // are internally consistent, because the failure this closes was not a
  // crash — a skill said something literally false on one provider and the
  // agent worked the directory out and substituted a path, which is the
  // guessing the whole exec form exists to avoid.
  const EXEC_SKILLS = [UMBRELLA_SKILL, ENGINE, 'skills/chain-planner', 'skills/mockup-studio'];
  const ROOT_ANCHOR = /The plugin root is this plugin's own directory/;
  for (const [label, root, want, forbid] of [
    ['the plugin source', ctx.pluginRoot, 'CLAUDE_PLUGIN_ROOT', 'MAISTER_PLUGIN_ROOT'],
    ['the emitted variant', path.join(ctx.repoRoot, VARIANT_REL), 'MAISTER_PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'],
  ]) {
    t.check(`every exec form in ${label} names one plugin-root variable, and says what it is`, () => {
      let seen = 0;
      for (const skill of EXEC_SKILLS) {
        const dir = path.join(root, skill);
        must(isDir(dir), `${skill}: absent from ${label}`);
        const files = fs.readdirSync(dir, { recursive: true })
          .filter(name => String(name).endsWith('.md'))
          .map(name => path.join(dir, String(name)));
        for (const file of files) {
          const text = fs.readFileSync(file, 'utf8');
          if (!text.includes('_PLUGIN_ROOT')) continue;
          seen++;
          must(text.includes(`\${${want}}`), `${skill}: no \${${want}} exec form`);
          must(!text.includes(forbid), `${skill}: names ${forbid}, which is not this build's variable`);
          must(ROOT_ANCHOR.test(text),
            `${skill}: spells the variable without saying what it names, so an unset one leaves the agent guessing`);
        }
      }
      must(seen >= 5, `only ${seen} exec-form file(s) found in ${label} — the sweep is looking in the wrong place`);
    });
  }

  t.check('the runtime resolves both spellings, so no skill can name a variable its own code ignores', () => {
    for (const rel of [`${ENGINE}/scripts/lib/graph.mjs`, `${UMBRELLA_SKILL}/scripts/lib/envelope.mjs`,
      `${UMBRELLA_SKILL}/scripts/lib/seed.mjs`]) {
      const text = fs.readFileSync(path.join(ctx.pluginRoot, rel), 'utf8');
      must(/process\.env\.CLAUDE_PLUGIN_ROOT \|\| process\.env\.MAISTER_PLUGIN_ROOT/.test(text),
        `${rel}: reads only one plugin-root spelling`);
    }
  });

  // Every surface that asks for the export must also say where to point it, on
  // every path an operator can arrive by. Asking for the variable while
  // describing only the directory `--plugin-dir` names left the primary install
  // path - a marketplace install, where the CLI chooses the directory - being
  // asked for a value nothing had told the operator. So the marketplace tree is
  // required beside the export wherever the export appears.
  const INSTALL_SURFACES = [
    [COPILOT_HOOK_NOTES_REL, 'the hook install notes'],
    ['README.md', 'the repository README'],
    [COPILOT_VARIANT_README_REL, "the variant's own README"],
  ];
  t.check('every install surface asks for the variable and says where each install path puts it', () => {
    for (const [rel, label] of INSTALL_SURFACES) {
      const file = path.join(ctx.repoRoot, rel);
      must(isFile(file), `${rel}: absent — ${label} is where an operator is told about the export`);
      const text = fs.readFileSync(file, 'utf8');
      must(/export MAISTER_PLUGIN_ROOT=/.test(text), `${rel}: never shows the export`);
      must(text.includes(COPILOT_INSTALL_TREE),
        `${rel}: asks for the variable without saying where a marketplace install puts the plugin`);
    }
    // And the notes keep the sentence that names the directory by what it
    // holds, which is the only spelling that is true on every path.
    const notes = fs.readFileSync(path.join(ctx.repoRoot, COPILOT_HOOK_NOTES_REL), 'utf8');
    must(notes.includes('.claude-plugin/plugin.json'), 'the notes never say which directory to point it at');
  });

  t.check("the build emits the variant's own README", () => {
    const emitted = path.join(ctx.repoRoot, VARIANT_REL, 'README.md');
    const authored = path.join(ctx.repoRoot, COPILOT_VARIANT_README_REL);
    must(isFile(emitted), `${VARIANT_REL}/README.md: absent — the build no longer stages the variant's install surface`);
    must(fs.readFileSync(emitted, 'utf8') === fs.readFileSync(authored, 'utf8'),
      `${VARIANT_REL}/README.md has drifted from ${COPILOT_VARIANT_README_REL} — it is generated, so edit the source`);
  });

  const guide = path.join(ctx.repoRoot, EXTENDING_GUIDE_REL);
  if (!isFile(guide)) {
    t.notes.push(`${EXTENDING_GUIDE_REL} is not in this checkout — the guide checks were skipped`);
    return { checks: t.checks, failures: t.failures, notes: t.notes };
  }
  const text = fs.readFileSync(guide, 'utf8');

  t.check('the guide names the three extension points, each as one heading', () => {
    for (const point of EXTENSION_POINTS) {
      const hits = text.split('\n').filter((line) => line.trim() === `## ${point}`).length;
      must(hits === 1, `"## ${point}" appears ${hits} times, expected once`);
    }
  });

  t.check('the guide states the resolution order once, in the order the code applies', () => {
    const lines = text.split('\n').filter((line) => /\bResolution order\b/.test(line));
    must(lines.length === 1, `"Resolution order" appears on ${lines.length} lines, expected one`);
    const words = RESOLUTION_ORDER.map((place) => RESOLUTION_WORDS[place]);
    const ordered = new RegExp(words.map((word) => `\\b${word}\\b`).join('[^\\n]*'));
    must(ordered.test(lines[0]), `the order sentence does not name ${words.join(', then ')} in that order: ${JSON.stringify(lines[0])}`);
  });

  t.check('the guide tells a driver-aware skill what it must do, and how it declares it', () => {
    must(/^driver_aware: true$/m.test(text), 'the frontmatter line `driver_aware: true` is never shown');
    for (const duty of DRIVER_AWARE_DUTIES) must(duty.test(text), `the guide never mentions ${duty.source}`);
    must(/\b(?:one|a single|single)\b[^.\n]{0,60}`gate-request`|`gate-request`[^.\n]{0,60}\b(?:one|a single|single)\b/i.test(text),
      'the guide does not say a gate is one gate-request call');
  });

  t.check('the guide says plainly what needs a contract change, and what it never shows a user', () => {
    for (const shape of NOT_EXTENSIBLE) must(shape.test(text), `the guide never names ${shape.source}`);
    for (const literal of GUIDE_SCRIPT_PATHS) must(!text.includes(literal), `the guide names ${literal}`);
    for (const id of GUIDE_PROCESS_IDS) must(!id.test(text), `the guide carries a process identifier matching ${id.source}`);
  });

  t.check('the guide is linked from the README and the workflow reference', () => {
    for (const rel of EXTENDING_LINKED_FROM) {
      const file = path.join(ctx.repoRoot, rel);
      if (!isFile(file)) { t.notes.push(`${rel} is not in this checkout — its link was not checked`); continue; }
      must(fs.readFileSync(file, 'utf8').includes('docs/extending.md') || fs.readFileSync(file, 'utf8').includes('extending.md'),
        `${rel} does not link to ${EXTENDING_GUIDE_REL}`);
    }
  });

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}


// ===========================================================================
// T47 — a chain's ticket input becomes the run's task.key
// ===========================================================================

/**
 * The tracker-key convention, end to end.
 *
 * A chain started from a ticket declares the ticket as an input; the tracker
 * mirror adopts an existing ticket as a run's parent only when the run's state
 * carries `task.key`, and creates a fresh epic otherwise. `tracker_key: true`
 * on an input is what joins the two: the engine reads the marked input's name
 * off the `resolve` report and writes that input's value into `task.key` in the
 * freeze patch.
 *
 * The convention rests on the attribute being additive, so that is what this
 * test holds rather than assuming it: the marked definition validates against
 * the pinned B1 schema (T03, through the fixture manifest), the mark moves no
 * graph hash, an unmarked input reports nothing, and the state writer's closed
 * patch vocabulary already carries `task.key`. The two ways the mark goes
 * wrong — a second one, and a non-string one — are refused with located errors.
 */
const TICKET_KEY_FIXTURE = path.join('synthetic', 'ticket-key-intake');
const TICKET_KEY_DEFINITION = 'ticket-rollout.yml';
const TICKET_KEY_INPUT = 'ticket';
const TICKET_KEY_UNMARKED = 'notes';
const TICKET_KEY_VALUE = 'ALPHA-42';

async function t47(ctx) {
  const t = checker();
  const engine = path.join(ctx.pluginRoot, ENGINE);
  const lib = name => pathToFileURL(path.join(engine, 'scripts', 'lib', `${name}.mjs`)).href;
  const { readDefinition, parseDefinition } = await import(lib('definition'));
  const { resolve: resolveGraph } = await import(lib('graph'));
  const { writeState } = await import(lib('state'));

  const fixtureDir = path.join(ctx.fixtures, TICKET_KEY_FIXTURE);
  const definitionFile = path.join(fixtureDir, TICKET_KEY_DEFINITION);
  const stateFile = path.join(fixtureDir, 'orchestrator-state.yml');
  if (!isFile(definitionFile) || !isFile(stateFile)) {
    return { checks: 1, failures: [`${TICKET_KEY_FIXTURE}: the fixture pair is absent`], notes: [] };
  }

  const text = fs.readFileSync(definitionFile, 'utf8');
  /** Resolve a variant of the fixture definition, read from its own text. */
  const resolved = body => resolveGraph({
    definition: { file: definitionFile, doc: parseDefinition(body, definitionFile).doc },
    overlays: [], profile: null, degraded: [],
  });

  const marked = resolveGraph({ definition: readDefinition(definitionFile), overlays: [], profile: null, degraded: [] });

  t.check('the marked definition resolves clean and names its tracker-key input', () => {
    equalJson(marked.errors, [], `${TICKET_KEY_DEFINITION} was rejected`);
    equalJson(marked.warnings, [], `${TICKET_KEY_DEFINITION} resolves with a warning`);
    must(marked.tracker_key === TICKET_KEY_INPUT,
      `resolve reports tracker_key ${JSON.stringify(marked.tracker_key)}, not ${JSON.stringify(TICKET_KEY_INPUT)}`);
  });

  t.check('an unmarked input names nothing, and the mark moves no graph hash', () => {
    const plain = resolved(text.replace(', tracker_key: true}', '}'));
    equalJson(plain.errors, [], 'the same definition without the mark was rejected');
    must(plain.tracker_key === null,
      `an unmarked definition reports tracker_key ${JSON.stringify(plain.tracker_key)}, not null`);
    must(plain.graph_hash === marked.graph_hash,
      'the mark moved the graph hash — it must reach no node, so a published chain can gain it');
  });

  t.check('a second marked input is refused, at its own path', () => {
    const two = resolved(text.replace(`  ${TICKET_KEY_UNMARKED}: {type: string}`,
      `  ${TICKET_KEY_UNMARKED}: {type: string, tracker_key: true}`));
    must(two.ok === false, 'two marked inputs resolved clean');
    equalJson(two.errors.map(e => e.path), [`inputs.${TICKET_KEY_UNMARKED}.tracker_key`],
      'the located error names the second mark, not the first');
  });

  t.check('a marked input that is not a string is refused', () => {
    const bool = resolved(text.replace('{type: string, required: true, tracker_key: true}',
      '{type: bool, required: true, tracker_key: true}'));
    must(bool.ok === false, 'a bool input marked as the tracker key resolved clean');
    equalJson(bool.errors.map(e => e.path), [`inputs.${TICKET_KEY_INPUT}.tracker_key`], 'the located error');
  });

  t.check('the fixture run carries the ticket as its intake key', () => {
    const line = fs.readFileSync(stateFile, 'utf8').split('\n').find(l => l.startsWith('  key:'));
    must(line !== undefined, `${TICKET_KEY_FIXTURE}/orchestrator-state.yml carries no task.key`);
    must(line.includes(TICKET_KEY_VALUE), `task.key is ${JSON.stringify(line)}, not ${TICKET_KEY_VALUE}`);
  });

  t.check('the state writer already carries task.key: the freeze patch writes it, editor tools never do', () => {
    const scratch = tempDir('ticket-key');
    const subject = path.join(scratch, 'orchestrator-state.yml');
    fs.writeFileSync(subject, fs.readFileSync(stateFile, 'utf8').replace(`\n  key: ${TICKET_KEY_VALUE}`, ''), 'utf8');
    must(!fs.readFileSync(subject, 'utf8').includes('key:'), 'the staged copy still carries a key');
    const result = writeState({ state: subject, patch: { task: { key: TICKET_KEY_VALUE } } });
    must(result.ok === true, `write-state refused task.key: ${JSON.stringify(result.errors)}`);
    must(result.changed.includes('task.key'), `the write reported ${JSON.stringify(result.changed)}`);
    must(fs.readFileSync(subject, 'utf8').includes(`  key: ${TICKET_KEY_VALUE}`),
      'task.key is not in the written state');
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  return { checks: t.checks, failures: t.failures, notes: t.notes };
}

// ---------------------------------------------------------------------------
// T48 — a pending gate binds the session that asked and the run's own directory
// ---------------------------------------------------------------------------

/** A run whose driver is `kind: terminal`, so it records no session to match. */
const NO_DRIVER_SESSION_STATE = 'synthetic/gate/terminal-mode-request';

/** The session the pending fixtures record as their driver, and one that is not. */
const DRIVER_SESSION = '019260a2-2233-7d44-9e55-6f7788990011';
const OTHER_SESSION = '019260a7-4455-7e66-8f77-0a1b2c3d4e5f';

/**
 * Every case the scope rule has to get right, in one table. `target` is
 * relative to the pending run directory; `outside` names a file under `cwd`
 * that belongs to no run, and `tool` makes the call opaque instead.
 */
const SCOPE_CASES = [
  { name: 'driver, a foreign file outside the run', session: DRIVER_SESSION, outside: 'notes.md', decision: 'deny', because: 'this session is the driver of' },
  { name: 'driver, its own state file', session: DRIVER_SESSION, target: 'orchestrator-state.yml', decision: 'allow' },
  { name: 'driver, its own request file', session: DRIVER_SESSION, target: 'gates/approve.request.yml', decision: 'allow' },
  { name: 'driver, a shell', session: DRIVER_SESSION, tool: 'Bash', decision: 'deny', because: 'this session is the driver of' },
  { name: 'another session, ordinary source outside the run', session: OTHER_SESSION, outside: 'src/catalog/CatalogListQuery.java', decision: 'allow' },
  { name: 'another session, a draft under .maister but in no run', session: OTHER_SESSION, outside: '.maister/workflows/generated/chain.yml', decision: 'allow' },
  { name: 'another session, inside the gated run', session: OTHER_SESSION, target: 'implementation/spec.md', decision: 'deny', because: "the gated run's own task directory" },
  { name: 'another session, the run directory itself', session: OTHER_SESSION, target: '.', decision: 'deny', because: "the gated run's own task directory" },
  { name: 'another session, an engine-owned file inside the run', session: OTHER_SESSION, target: 'gates/index.yml', decision: 'allow' },
  { name: 'another session, a shell', session: OTHER_SESSION, tool: 'Bash', decision: 'allow' },
  { name: 'no session id in the payload, a shell', session: null, tool: 'Bash', decision: 'deny', because: 'the payload carries no session id' },
  { name: 'no session id in the payload, a foreign file', session: null, outside: 'notes.md', decision: 'deny', because: 'the payload carries no session id' },
];

/** The same table, in the shapes the Copilot vocabulary sends them in. */
const SCOPE_CASES_COPILOT = [
  { name: 'driver, a shell', session: DRIVER_SESSION, tool: 'bash', decision: 'deny', because: 'this session is the driver of' },
  { name: 'driver, its own state file', session: DRIVER_SESSION, target: 'orchestrator-state.yml', decision: 'allow' },
  { name: 'another session, a shell', session: OTHER_SESSION, tool: 'bash', decision: 'allow' },
  { name: 'another session, ordinary source outside the run', session: OTHER_SESSION, outside: 'src/catalog/CatalogListQuery.java', decision: 'allow' },
  { name: 'another session, inside the gated run', session: OTHER_SESSION, target: 'implementation/spec.md', decision: 'deny', because: "the gated run's own task directory" },
  { name: 'no session id in the payload, a shell', session: null, tool: 'bash', decision: 'deny', because: 'the payload carries no session id' },
];

function scopeTarget(testCase, cwd) {
  if (testCase.outside) return `${cwd}/${testCase.outside}`;
  const run = `${cwd}/${PENDING_RUN}`;
  return testCase.target === '.' ? run : `${run}/${testCase.target}`;
}

/** A Claude payload for one scope case, with the session id set or removed. */
function scopePayloadClaude(base, testCase, cwd) {
  const payload = testCase.tool
    ? { ...base, tool_name: testCase.tool, tool_input: { command: 'echo hi' } }
    : claudeWrite(base, scopeTarget(testCase, cwd));
  if (testCase.session === null) delete payload.session_id;
  else payload.session_id = testCase.session;
  return payload;
}

function scopePayloadCopilot(testCase, cwd) {
  const payload = { timestamp: 1787680000000, cwd, toolName: testCase.tool ?? 'create' };
  payload.toolArgs = testCase.tool
    ? JSON.stringify({ command: 'echo hi' })
    : JSON.stringify({ path: scopeTarget(testCase, cwd), file_text: 'draft\n' });
  if (testCase.session !== null) payload.sessionId = testCase.session;
  return payload;
}

function t48(ctx) {
  const failures = [];
  const notes = [];
  let checks = 0;
  const { ajv } = loadSchemas(ctx.schemas);
  const base = payloadOf(fixtureById(ctx, 'synthetic/hook-payloads/claude/engine-owned-write'));
  const cwd = base.cwd;

  const run = (label, provider, payload, testCase, stateFixture) => {
    const want = {
      provider,
      event: provider === 'claude' ? 'PreToolUse' : 'preToolUse',
      decision: testCase.decision,
      exit: 0,
      stdout: testCase.decision === 'allow' ? 'empty' : 'json',
    };
    const out = replay(ctx, payload, {
      event: want.event,
      stateFixture,
      cwdLayout: 'umbrella-run',
    });
    checks += checkReplay(ajv, label, want, out, failures);
    if (!testCase.because) return;
    // The deny has to say *why this session* is bound: a reason that only
    // names the node leaves an unrelated session unable to tell whether it
    // walked into its own gate or someone else's.
    checks++;
    const parsed = parseJsonOut(out.stdout);
    const reason = parsed.ok ? reasonOf(provider, 'deny', parsed.value) : '';
    if (!reason.includes(testCase.because)) {
      failures.push(`${label}: the deny does not say why this session is bound — ${firstLine(reason)}`);
    }
  };

  for (const testCase of SCOPE_CASES) {
    run(`claude: ${testCase.name} (${testCase.decision})`, 'claude',
      scopePayloadClaude(base, testCase, cwd), testCase, PENDING_STATE);
  }
  for (const testCase of SCOPE_CASES_COPILOT) {
    run(`copilot: ${testCase.name} (${testCase.decision})`, 'copilot',
      scopePayloadCopilot(testCase, cwd), testCase, PENDING_STATE);
  }

  // A run that records no driver session cannot say whose gate it is, so it
  // keeps the pre-scope reach: every session under the working directory.
  const wideCase = {
    name: 'a run with no driver session, another session, a shell',
    session: OTHER_SESSION, tool: 'Bash', decision: 'deny',
    because: 'records no orchestrator.driver.session.id',
  };
  run(`claude: ${wideCase.name} (deny)`, 'claude',
    scopePayloadClaude(base, wideCase, cwd), wideCase, NO_DRIVER_SESSION_STATE);

  // …and it still lets that session write its own source, because the fallback
  // widens who is bound, never what the seven-file allow-list covers.
  const wideAllow = { name: 'a run with no driver session, its own state file', session: OTHER_SESSION, target: 'orchestrator-state.yml', decision: 'allow' };
  run(`claude: ${wideAllow.name} (allow)`, 'claude',
    scopePayloadClaude(base, wideAllow, cwd), wideAllow, NO_DRIVER_SESSION_STATE);

  notes.push(`${SCOPE_CASES.length} Claude and ${SCOPE_CASES_COPILOT.length} Copilot scope cases replayed`);
  return { checks, failures, notes };
}

// ---------------------------------------------------------------------------
// T49 — an overlay run, and the node-id freeze the overlay contract rests on
// ---------------------------------------------------------------------------

/**
 * The overlay route, proved twice: once by executing it, once across releases.
 *
 * Everything about overlays was true as a *document*. An overlay validated, it
 * resolved, its shape was pinned and its two routes hashed. Nothing had ever
 * run one — so the claim that a run shows an added node in the position its
 * `needs` puts it rested on the resolver's output and on no state file at all.
 * The last check here executes the route: resolve a built-in under an overlay,
 * freeze it, and advance node by node through the real state writer until the
 * added node reads `completed`, then hold the result to the run fixture
 * checked in beside it.
 *
 * The first two are the freeze. The node-id set of a built-in is a public API —
 * a rename is a deprecation carrying an alias for at least two releases —
 * because every user overlay attaches to those ids and a rename silently
 * unresolves all of them. Nothing enforced it. The published set is written out
 * here, deliberately apart from `WORKFLOW_PINS`: a rename forces its author to
 * edit those pins to get the grammar runner green again, and if the same list
 * were also the freeze, that one edit would bless the rename. Two lists means
 * the second edit is a decision somebody has to make on purpose.
 *
 * There is a cross-release arm too, and today it skips. The suite is asked to
 * resolve the overlay fixtures against the previous released tag's definitions,
 * but no released tag carries the engine — the built-ins landed after the
 * newest one — so the arm reads the tag, finds no definitions, and says so in a
 * note rather than passing silently. It starts working by itself on the first
 * tag that ships them.
 */

/**
 * The published node-id set of each built-in, in declaration order.
 *
 * Changing a line here is a deprecation, not an edit: a renamed id keeps an
 * alias for at least two releases, and until then both spellings belong in this
 * list. Adding a node is additive and is an ordinary change.
 */
const FROZEN_NODE_IDS = {
  research: ['research-foundation', 'foundation-approval', 'optional-phases-decision', 'solution-generation',
    'solution-convergence', 'convergence-approval', 'high-level-design', 'design-approval', 'completion'],
  development: ['intake', 'codebase-analysis', 'gap-analysis', 'gap-approval', 'tdd-red', 'tdd-red-approval',
    'ui-mockups', 'mockup-approval', 'specification', 'specification-approval', 'spec-audit', 'spec-audit-approval',
    'planning', 'planning-approval', 'implementation', 'implementation-approval', 'tdd-green', 'tdd-green-approval',
    'verification-options', 'verification', 'verification-approval', 'e2e-verification', 'e2e-approval',
    'user-docs', 'docs-approval', 'finalization'],
  plan: ['standards-discovery', 'plan', 'plan-approval', 'handoff'],
};

/** The run this test drives, and the fixture it must reproduce. */
const OVERLAY_RUN_FIXTURE = path.join('synthetic', 'runs', 'research-overlaid', 'orchestrator-state.yml');
const OVERLAY_RUN_BASE = 'research';
const OVERLAY_RUN_OVERLAY = path.join('synthetic', 'workflow-overlay', 'research-tuned', 'research-tuned.overlay.yml');
const OVERLAY_RUN_ADDED = 'deep-review';

async function t49(ctx) {
  const t = checker();
  const engine = path.join(ctx.pluginRoot, ENGINE);
  const workflows = path.join(engine, 'workflows');
  const lib = name => pathToFileURL(path.join(engine, 'scripts', 'lib', `${name}.mjs`)).href;
  const { readDefinition } = await import(lib('definition'));
  const { resolve: resolveOverlaid } = await import(lib('graph'));
  const { writeState } = await import(lib('state'));

  t.check('every built-in declares the node ids the freeze publishes, and declares no fewer', () => {
    for (const [name, frozen] of Object.entries(FROZEN_NODE_IDS)) {
      const file = path.join(workflows, `${name}.yml`);
      must(isFile(file), `workflows/${name}.yml is absent, so its published node ids resolve to nothing`);
      const graph = resolveOverlaid({ definition: readDefinition(file), overlays: [], profile: null });
      must(graph.ok, `workflows/${name}.yml does not resolve: ${JSON.stringify(graph.errors)}`);
      const declared = new Set(graph.nodes.map(node => node.id));
      const gone = frozen.filter(id => !declared.has(id));
      must(gone.length === 0,
        `builtin:${name} no longer declares ${gone.join(', ')}. The node-id set is a public API: a rename is a `
        + 'deprecation that keeps an alias for at least two releases, so add the new id beside the old one here '
        + 'and keep both in the definition, rather than replacing the line.');
    }
  });

  t.check('every node id an overlay fixture names is one the freeze publishes', () => {
    for (const overlay of OVERLAY_FIXTURES) {
      const file = path.join(ctx.fixtures, ...overlay.split('/'));
      must(isFile(file), `${overlay}: absent`);
      const doc = parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS) ?? {};
      const base = String(doc.extends ?? '').replace(/^builtin:/, '');
      const frozen = FROZEN_NODE_IDS[base];
      must(Array.isArray(frozen), `${overlay}: extends ${JSON.stringify(doc.extends)}, which the freeze does not cover`);
      // Ids the overlay itself adds are its own, at every level it adds them.
      const added = new Set();
      const bodies = [doc, ...Object.values(doc.profiles ?? {})];
      for (const body of bodies) for (const id of Object.keys(body?.add ?? {})) added.add(id);
      const known = id => frozen.includes(id) || added.has(id);
      for (const body of bodies) {
        for (const id of (Array.isArray(body?.disable) ? body.disable : [])) {
          must(known(id), `${overlay}: disables "${id}", which neither the freeze publishes nor the overlay adds`);
        }
        for (const id of Object.keys(body?.tune ?? {})) {
          must(known(id), `${overlay}: tunes "${id}", which neither the freeze publishes nor the overlay adds`);
        }
        for (const node of Object.values(body?.add ?? {})) {
          for (const need of (Array.isArray(node?.needs) ? node.needs : [])) {
            must(known(need),
              `${overlay}: an added node needs "${need}", which neither the freeze publishes nor the overlay adds`);
          }
        }
      }
    }
  });

  t.check('the overlay fixtures resolve against the previous released tag, where that tag ships the built-ins', () => {
    const tags = runBounded('git', ['tag', '--list', '--sort=-v:refname'], { cwd: ctx.repoRoot, encoding: 'utf8' });
    const previous = tags.status === 0
      ? (String(tags.stdout ?? '').split('\n').map(line => line.trim()).filter(Boolean)[0] ?? null)
      : null;
    if (previous === null) {
      t.notes.push('no released tag is readable here, so the cross-release arm did not run');
      return;
    }
    const staged = tempDir('overlay-freeze');
    let shipped = 0;
    for (const name of Object.keys(FROZEN_NODE_IDS)) {
      const at = `${previous}:plugins/maister/${ENGINE}/workflows/${name}.yml`;
      const show = runBounded('git', ['show', at], { cwd: ctx.repoRoot, encoding: 'utf8' });
      if (show.status !== 0) continue;
      fs.writeFileSync(path.join(staged, `${name}.yml`), show.stdout, 'utf8');
      shipped++;
    }
    if (shipped === 0) {
      t.notes.push(`${previous} ships no workflow definition, so the cross-release arm did not run — `
        + 'it starts by itself on the first tag that ships one');
      return;
    }
    for (const overlay of OVERLAY_FIXTURES) {
      const file = path.join(ctx.fixtures, ...overlay.split('/'));
      const doc = parseYaml(fs.readFileSync(file, 'utf8'), YAML_OPTS) ?? {};
      const base = String(doc.extends ?? '').replace(/^builtin:/, '');
      const was = path.join(staged, `${base}.yml`);
      if (!isFile(was)) continue;
      const graph = resolveOverlaid({
        definition: readDefinition(was),
        overlays: [readDefinition(file)],
        profile: null,
      });
      must(graph.ok,
        `${overlay} no longer resolves against builtin:${base} as ${previous} shipped it: ${JSON.stringify(graph.errors)}`);
    }
    t.notes.push(`${shipped} definition(s) from ${previous} resolved against the shipped overlays`);
  });

  t.check('an overlay-added node completes in the position its needs puts it', () => {
    const definition = path.join(workflows, `${OVERLAY_RUN_BASE}.yml`);
    const overlay = path.join(ctx.fixtures, OVERLAY_RUN_OVERLAY);
    must(isFile(definition) && isFile(overlay), 'the definition or the overlay is absent');
    const graph = resolveOverlaid({
      definition: readDefinition(definition),
      overlays: [readDefinition(overlay)],
      profile: null,
    });
    must(graph.ok, `the overlay route does not resolve: ${JSON.stringify(graph.errors)}`);

    const order = graph.nodes.map(node => node.id);
    must(order.includes(OVERLAY_RUN_ADDED),
      `the overlay no longer adds ${OVERLAY_RUN_ADDED} — the run would prove nothing about an added node`);
    must(!FROZEN_NODE_IDS[OVERLAY_RUN_BASE].includes(OVERLAY_RUN_ADDED),
      `${OVERLAY_RUN_ADDED} is a published id of the base, so a run reaching it proves nothing about an overlay`);

    const state = path.join(tempDir('overlay-run'), 'orchestrator-state.yml');
    fs.copyFileSync(path.join(ctx.fixtures, CHAIN_TEMPLATE_STATE), state);
    const wrote = patch => {
      const result = writeState({ state, patch });
      must(result.ok, `the writer refused: ${JSON.stringify(result.errors)}`);
    };

    const nodes = {};
    for (const node of graph.nodes) {
      nodes[node.id] = { kind: node.type === 'gate' ? 'gate' : 'task', status: 'pending', needs: node.needs ?? [] };
    }
    wrote({
      task: { title: 'Rate limiting for the public API', status: 'in_progress' },
      workflow: {
        source: `builtin:${OVERLAY_RUN_BASE}`,
        overlays: ['.maister/workflows/research.overlay.yml'],
        profile: 'default',
        graph_hash: graph.graph_hash,
        grammar_version: 1,
        name: OVERLAY_RUN_BASE,
        nodes,
      },
    });

    // Advance in declaration order, which is dependency order — asserted rather
    // than assumed, so a graph that stopped being topologically ordered fails
    // here instead of quietly executing a node before what it needs.
    const done = new Set();
    for (const node of graph.nodes) {
      for (const need of node.needs ?? []) {
        must(done.has(need), `${node.id} was advanced before ${need} completed`);
      }
      wrote({ nodes: { [node.id]: { status: 'running' } } });
      wrote({ nodes: { [node.id]: { status: 'completed' } } });
      done.add(node.id);
    }
    wrote({
      node_summaries: {
        completion: { summary: 'Research complete; the report and the decision log are handed off.' },
        [OVERLAY_RUN_ADDED]: {
          summary: 'Reviewed the completed research against the questions it set out to answer.',
          decisions: [
            {
              decision: 'The token-bucket recommendation stands',
              rationale: 'the burst allowance is the requirement the alternatives drop',
            },
            'One open question is carried into design rather than closed here',
          ],
        },
      },
      task: { status: 'completed' },
    });

    // The claim, read back off the file rather than off the graph.
    const lines = fs.readFileSync(state, 'utf8').split('\n');
    const at = id => lines.findIndex(line => line.trim().startsWith(`${id}:`));
    const self = at(OVERLAY_RUN_ADDED);
    must(self >= 0, `the run state carries no ${OVERLAY_RUN_ADDED} entry`);
    must(/status: completed/.test(lines[self]), `${OVERLAY_RUN_ADDED} did not complete: ${lines[self]}`);
    const needs = /needs: \[([^\]]*)\]/.exec(lines[self])?.[1] ?? '';
    must(needs.trim() !== '', `${OVERLAY_RUN_ADDED} lost its needs, so it is in no position at all`);
    for (const need of needs.split(',').map(each => each.trim()).filter(Boolean)) {
      must(at(need) >= 0 && at(need) < self, `${OVERLAY_RUN_ADDED} is written before ${need}, which its needs names`);
    }
    must(order.indexOf(OVERLAY_RUN_ADDED) === order.length - 1,
      `${OVERLAY_RUN_ADDED} is not last in the frozen order: ${order.join(' -> ')}`);

    // And the checked-in run is this run, so the fixture cannot drift from what
    // driving the route produces today.
    const clock = text => text.replace(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/g, '"<at>"');
    const region = text => clock(text.slice(text.indexOf('\nworkflow:')));
    equalJson(region(lines.join('\n')), region(fs.readFileSync(path.join(ctx.fixtures, OVERLAY_RUN_FIXTURE), 'utf8')),
      `${OVERLAY_RUN_FIXTURE} is not what driving the overlay route produces today`);
  });

  return { checks: t.checks, failures: t.failures, notes: t.notes };
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
  { id: 'T35', name: 'umbrella-runtime', needs: ['plugin', 'fixtures'], run: t35 },
  { id: 'T36', name: 'ledger-concurrency', needs: ['plugin', 'fixtures'], run: t36 },
  { id: 'T37', name: 'emitted-umbrella-smoke', needs: ['plugin', 'fixtures'], run: t37 },
  { id: 'T38', name: 'gate-suspend-writer', needs: ['plugin', 'fixtures'], run: t38 },
  { id: 'T39', name: 'gate-sequence-lockstep', needs: ['plugin'], run: t39 },
  { id: 'T40', name: 'umbrella-user-verbs', needs: ['plugin'], run: t40 },
  { id: 'T41', name: 'chain-planner-surface', needs: ['plugin', 'fixtures'], run: t41 },
  { id: 'T42', name: 'generated-chain-home', needs: ['plugin', 'fixtures'], run: t42 },
  { id: 'T43', name: 'plan-workflow-surface', needs: ['plugin', 'fixtures'], run: t43 },
  { id: 'T44', name: 'workflow-type-fixture-coverage', needs: ['fixtures'], run: t44 },
  { id: 'T45', name: 'prompt-line-timestamps', needs: [], run: t45 },
  { id: 'T46', name: 'extension-contract', needs: ['plugin', 'fixtures'], run: t46 },
  { id: 'T47', name: 'ticket-key-intake', needs: ['plugin', 'fixtures'], run: t47 },
  { id: 'T48', name: 'gate-scope', needs: ['plugin', 'fixtures'], run: t48 },
  { id: 'T49', name: 'overlay-run-and-node-freeze', needs: ['plugin', 'fixtures'], run: t49 },
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
