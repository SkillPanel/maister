import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR, FIXTURES, ROOT, freezePatch, readDashboard, readState, run, scratch, verb } from '../helpers.mjs';
import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { explainerOf, explainerOff } from '../../plugins/maister/skills/workflow-engine/scripts/lib/companions.mjs';

// The explainer pages beside research's: development's specification and
// change explainers, performance's and product design's. Each is a declared
// artifact whose path ends in `-explainer.html`, which is what the engine reads
// as an explainer; its absence is sanctioned in `brief:`; `run-context` and
// `node-brief` say whether it is written, and why not; the project's config
// turns one off per step (`workflows.<w>.explainers`), which the dashboard
// honours by dropping its card.

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');
const definition = name => readDefinition(path.join(WORKFLOWS, `${name}.yml`)).doc;
const plain = value => JSON.parse(JSON.stringify(value));

const EXPLAINERS = {
  development: { specification: 'implementation/spec-explainer.html', finalization: 'verification/change-explainer.html' },
  performance: { finalization: 'verification/performance-explainer.html' },
  'product-design': { brief: 'outputs/product-explainer.html' },
  research: { 'research-foundation': 'outputs/research-explainer.html' },
  migration: {},
  'mockup-studio': {},
};

const REASON = "HTML output is off for this run, the project's config turns this explainer off, or the explainer writer failed twice; the step's summary says which.";

// ---------------------------------------------------------------------------
// Declarations

test('each built-in declares exactly its explainers, each sanctioned absent in its brief', () => {
  for (const [name, expected] of Object.entries(EXPLAINERS)) {
    const doc = definition(name);
    const found = {};
    for (const [id, node] of Object.entries(doc.nodes)) {
      const explainer = explainerOf(node);
      if (explainer !== null) found[id] = explainer.path;
    }
    assert.deepEqual(found, expected, name);
    for (const id of Object.keys(expected)) {
      assert.equal(explainerOf(doc.nodes[id]).key, 'explainer', `${name}.${id}: declared under the key explainer`);
      assert.equal(doc.brief[id]?.absent?.explainer, REASON, `${name}.${id}: the absence is sanctioned`);
    }
  }
});

test('explainerOf reads only a literal path ending in -explainer.html; explainerOff only a literal false', () => {
  assert.deepEqual(plain(explainerOf({ outputs: { artifacts: { report: 'r.md', page: 'out/x-explainer.html' } } })), { key: 'page', path: 'out/x-explainer.html' });
  assert.equal(explainerOf({ outputs: { artifacts: { page: 'out/explainer.html' } } }), null);
  assert.equal(explainerOf({ outputs: { artifacts: { page: '${a.artifacts.b}-explainer.html' } } }), null);
  assert.equal(explainerOf({ type: 'gate' }), null);
  assert.equal(explainerOff({ explainers: { brief: false } }, 'brief'), true);
  assert.equal(explainerOff({ explainers: { brief: true } }, 'brief'), false);
  assert.equal(explainerOff({ explainers: { brief: 'no' } }, 'brief'), false);
  assert.equal(explainerOff(null, 'brief'), false);
});

// ---------------------------------------------------------------------------
// A frozen development run

function config(dir, text) {
  const file = path.join(dir, '.maister', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function frozen(t, { name = 'development', text = null, html = true, inputs = { task_description: 'Add a tag filter' } } = {}) {
  const runDir = scratch(t, { type: name, name: '2026-01-05-sample' });
  if (text !== null) config(runDir.root, text);
  const { patch } = freezePatch({ definition: path.join(WORKFLOWS, `${name}.yml`), inputs, orchestrator: { options: { html_output: html } } });
  const result = verb(['write-state', `--state=${runDir.state}`], patch, { CLAUDE_PROJECT_DIR: runDir.root });
  assert.equal(result.code, 0, result.stderr);
  return { run: runDir, result };
}

const context = (runDir, node) => {
  const result = verb(['run-context', `--state=${runDir.state}`, `--node=${node}`], undefined, { CLAUDE_PROJECT_DIR: runDir.root });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
};
const brief = (runDir, node) => {
  const result = verb(['node-brief', `--state=${runDir.state}`, `--node=${node}`], undefined, { CLAUDE_PROJECT_DIR: runDir.root });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
};
const line = (text, key) => text.split('\n').find(each => each.startsWith(`${key}: `)) ?? null;
const STYLE = /html-report-style\.md$/;

test('run-context: an explainer to write prints its page, and the style guide even where no companion is owed', t => {
  const { run: runDir } = frozen(t);
  const finalization = context(runDir, 'finalization');
  assert.equal(line(finalization, 'explainer'), 'explainer: verification/change-explainer.html');
  assert.match(line(finalization, 'html'), STYLE);
  assert.match(finalization, /^companions: none$/m);
  const spec = context(runDir, 'specification');
  assert.equal(line(spec, 'explainer'), 'explainer: implementation/spec-explainer.html');
  assert.match(spec, /implementation\/spec\.html/);
  // A node declaring none prints no explainer line, and a gate never does.
  assert.equal(line(context(runDir, 'planning'), 'explainer'), null);
  assert.equal(line(context(runDir, 'verification-approval'), 'explainer'), null);
});

test('run-context: with HTML output off every explainer is off, with that reason', t => {
  const { run: runDir } = frozen(t, { html: false });
  const finalization = context(runDir, 'finalization');
  assert.equal(line(finalization, 'explainer'), 'explainer: off — HTML output is off for this run.');
  assert.equal(line(finalization, 'html'), 'html: off');
  assert.equal(line(context(runDir, 'specification'), 'explainer'), 'explainer: off — HTML output is off for this run.');
});

test('the config turns one explainer off and leaves the others; the step that owes a companion keeps its style guide', t => {
  const { run: runDir, result } = frozen(t, { text: 'workflows:\n  development:\n    explainers:\n      specification: false\n      finalization: true\n' });
  assert.equal(result.stderr, '');
  assert.deepEqual(readState(runDir).orchestrator.options.workflow_config, { explainers: { specification: false, finalization: true } });
  const spec = context(runDir, 'specification');
  assert.equal(line(spec, 'explainer'), "explainer: off — The project's config turns this explainer off.");
  assert.match(line(spec, 'html'), STYLE, 'the spec companion is still owed');
  assert.equal(line(context(runDir, 'finalization'), 'explainer'), 'explainer: verification/change-explainer.html');
});

test('a closing step whose only page is turned off reads html off', t => {
  const { run: runDir } = frozen(t, { text: 'workflows:\n  development:\n    explainers:\n      finalization: false\n' });
  const finalization = context(runDir, 'finalization');
  assert.equal(line(finalization, 'html'), 'html: off');
  assert.equal(line(finalization, 'explainer'), "explainer: off — The project's config turns this explainer off.");
});

test('node-brief: a page to write prints the writer call, the check script and the row; an off page only its line', t => {
  const { run: runDir } = frozen(t, { text: 'workflows:\n  development:\n    explainers:\n      specification: false\n' });
  const finalization = brief(runDir, 'finalization');
  assert.ok(finalization.includes('\nexplainer: verification/change-explainer.html\n'));
  assert.match(finalization, /^explainer writer: maister:explainer-writer, model \S+, effort \S+ /m);
  const script = line(finalization, '- check_script');
  assert.ok(script !== null, 'the check script line');
  assert.ok(fs.existsSync(script.slice('- check_script: '.length)), 'the check script exists where the line says');
  assert.match(finalization, /^convention \(writes an explainer\): /m);
  const spec = brief(runDir, 'specification');
  assert.ok(spec.includes("\nexplainer: off — The project's config turns this explainer off.\n"));
  assert.doesNotMatch(spec, /^explainer writer:/m);
  // A step declaring no explainer gets neither the line nor the row.
  const planning = brief(runDir, 'planning');
  assert.doesNotMatch(planning, /^explainer/m);
  assert.doesNotMatch(planning, /writes an explainer/);
});

test('performance and product design print their pages', t => {
  assert.equal(line(context(frozen(t, { name: 'performance' }).run, 'finalization'), 'explainer'), 'explainer: verification/performance-explainer.html');
  const design = frozen(t, { name: 'product-design', inputs: { task_description: 'A sharing panel' } }).run;
  assert.equal(line(context(design, 'brief'), 'explainer'), 'explainer: outputs/product-explainer.html');
});

// ---------------------------------------------------------------------------
// The config switch: invalid entries

const configWarnings = stderr => stderr.split('\n').filter(each => each.startsWith('warning: workflows-config:')).map(each => each.slice('warning: '.length));

test('the freeze drops each bad explainers entry with a warning naming file and dotted key', t => {
  const { run: runDir, result } = frozen(t, { text: [
    'workflows:',
    '  development:',
    '    explainers:',
    '      specification: maybe',
    '      planning: false',
    '      specification-approval: false',
    '      ghost: false',
    '      finalization: false',
    '',
  ].join('\n') });
  assert.deepEqual(readState(runDir).orchestrator.options.workflow_config, { explainers: { finalization: false } });
  const at = 'workflows-config:.maister/config.yml:workflows.development.explainers';
  assert.deepEqual(configWarnings(result.stderr), [
    `${at}.specification — true or false is expected, not "maybe"; the entry is ignored`,
    `${at}.planning — planning declares no explainer page (an artifact ending in -explainer.html); the entry is ignored`,
    `${at}.specification-approval — specification-approval is a gate, which writes no page; the entry is ignored`,
    `${at}.ghost — development has no step ghost; the entry is ignored`,
  ]);
});

test('an explainers value that is not a mapping is ignored whole, and every explainer stays on', t => {
  const { run: runDir, result } = frozen(t, { text: 'workflows:\n  development:\n    explainers: false\n' });
  assert.equal(readState(runDir).orchestrator.options.workflow_config, undefined);
  assert.deepEqual(configWarnings(result.stderr), [
    'workflows-config:.maister/config.yml:workflows.development.explainers — a mapping of step id to true or false is expected, not false; it is ignored, and every explainer is written',
  ]);
  assert.equal(line(context(runDir, 'finalization'), 'explainer'), 'explainer: verification/change-explainer.html');
});

test('validate (--check) reports the same warnings and starts nothing', t => {
  const runDir = scratch(t, { type: 'development', name: '2026-01-05-sample' });
  config(runDir.root, 'workflows:\n  development:\n    explainers:\n      planning: false\n      finalization: off\n');
  const result = verb(['validate', `--definition=${path.join(WORKFLOWS, 'development.yml')}`], undefined, { CLAUDE_PROJECT_DIR: runDir.root });
  assert.equal(result.code, 0, result.stderr);
  const at = 'workflows-config:.maister/config.yml:workflows.development.explainers';
  assert.deepEqual(JSON.parse(result.stdout).warnings.filter(each => each.startsWith('workflows-config:')), [
    `${at}.planning — planning declares no explainer page (an artifact ending in -explainer.html); the entry is ignored`,
    `${at}.finalization — true or false is expected, not "off"; the entry is ignored`,
  ]);
  assert.equal(fs.existsSync(runDir.state), false);
});

// ---------------------------------------------------------------------------
// The dashboard

const html = fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/assets/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');

function lift(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `the page defines ${name}`);
  return html.slice(start, html.indexOf('\n}\n', start) + 3);
}

function heroes() {
  const start = html.indexOf('const HERO_MAP');
  const map = html.slice(start, html.indexOf('\n};\n', start) + 4);
  const sandbox = vm.createContext({});
  vm.runInContext([map, ...['esc', 'aLink', 'findArtifact', 'findAbsence', 'renderHeroes'].map(lift), 'this.renderHeroes = renderHeroes;'].join('\n'), sandbox);
  return sandbox.renderHeroes;
}

const labels = text => [...text.matchAll(/<div class="h-label">([^<]*)<\/div>/g)].map(match => match[1]);

test('hero rows: each workflow with an explainer leads with it, and a turned-off one loses its card', () => {
  const render = heroes();
  assert.deepEqual(labels(render({ task: { type: 'development' }, verification: {} }, [])),
    ['Explainer', 'Specification', 'Spec Explainer', 'Implementation Plan', 'Verification']);
  assert.deepEqual(labels(render({ task: { type: 'performance' }, verification: {} }, [])),
    ['Explainer', 'Specification', 'Implementation Plan', 'Verification']);
  assert.deepEqual(labels(render({ task: { type: 'product-design' }, verification: {} }, [])),
    ['Explainer', 'Product Brief', 'Feature Spec', 'Design Decisions']);
  assert.deepEqual(labels(render({ task: { type: 'migration' }, verification: {} }, [])),
    ['Specification', 'Implementation Plan', 'Verification']);
  const off = render({ task: { type: 'development' }, verification: {}, companions_off: ['implementation/spec-explainer.html'] }, []);
  assert.deepEqual(labels(off), ['Explainer', 'Specification', 'Implementation Plan', 'Verification']);
});

test('projection: companions_off carries each explainer the config turned off, and only then', t => {
  const off = readDashboard(frozen(t, { text: 'workflows:\n  development:\n    explainers:\n      finalization: false\n      specification: true\n' }).run);
  assert.deepEqual(off.companions_off, ['verification/change-explainer.html']);
  assert.equal(Object.hasOwn(readDashboard(frozen(t, { text: 'html_output: true\n' }).run), 'companions_off'), false);
  const both = readDashboard(frozen(t, { text: 'workflows:\n  development:\n    html_companions:\n      planning: []\n    explainers:\n      specification: false\n' }).run);
  assert.deepEqual(both.companions_off, ['implementation/spec-explainer.html', 'implementation/implementation-plan.md']);
});

// ---------------------------------------------------------------------------
// A run frozen on an earlier definition

test('a run frozen on the definition before the explainers still resumes; the brief names the drift as designed', t => {
  const { run: runDir } = frozen(t);
  const text = fs.readFileSync(runDir.state, 'utf8');
  const before = 'sha256:70d3e772419b0fc36af0a4971ec8eefef6319a37e3355abab4e3d5d69f5b660b';
  fs.writeFileSync(runDir.state, text.replace(/graph_hash: [^\n,}]+/, `graph_hash: ${before}`));
  const env = { CLAUDE_PROJECT_DIR: runDir.root };
  const resumed = verb(['resume-check', `--state=${runDir.state}`, '--no-open'], undefined, env);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).ok, true);
  const nodeBrief = verb(['node-brief', `--state=${runDir.state}`, '--node=intake'], undefined, env);
  assert.equal(nodeBrief.code, 0, nodeBrief.stderr);
  assert.match(nodeBrief.stderr, /node-brief-graph-drift/);
  assert.equal(verb(['run-context', `--state=${runDir.state}`, '--node=finalization'], undefined, env).code, 0);
});

// ---------------------------------------------------------------------------
// The check on a development wrap-up page

const CHECK = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/scripts/check-explainer.mjs');
const CHANGE = path.join(FIXTURES, 'explainer', 'change');
const SOURCES = ['../implementation/spec.md', 'implementation-verification.md', 'code-risk-review.md'];

function copy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-change-explainer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(CHANGE, dir, { recursive: true });
  return dir;
}

function check(dir) {
  const result = run(CHECK, ['--page=change-explainer.html', ...SOURCES.map(each => `--source=${each}`)], undefined, {}, path.join(dir, 'verification'));
  return { ...result, report: JSON.parse(result.stdout) };
}

test('the check passes the change explainer fixture, every figure traced and every section linked', t => {
  const result = check(copy(t));
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(result.report.findings, []);
  assert.equal(result.report.sections, 3);
});

test('the check flags a figure on the change explainer no source states', t => {
  const dir = copy(t);
  const page = path.join(dir, 'verification', 'change-explainer.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<span>5 fixed</span>', '<span>6 fixed</span>'));
  const result = check(dir);
  assert.equal(result.code, 1, result.stdout);
  assert.deepEqual(result.report.findings.filter(each => each.code === 'untraced-number').map(each => each.figure), ['6']);
});
