import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR, FIXTURES, freezePatch, readDashboard, scratch, verb } from '../helpers.mjs';

// What the dashboard shows of the project's workflows block: a key document
// whose HTML page the config turned off loses its card at the top (the data
// names it under `companions_off`, which a page predating the key ignores),
// and a gate the config continued carries a "Project config" chip.

// A Windows checkout may give the page CRLF line ends; the slicing below looks for LF.
const html = fs.readFileSync(path.join(ENGINE_DIR, '../../skills/orchestrator-framework/assets/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const DEFINITION = path.join(FIXTURES, 'definitions', 'config-workflow.yml');

/** A top-level function of the page's script, by name. */
function lift(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `the page defines ${name}`);
  return html.slice(start, html.indexOf('\n}\n', start) + 3);
}

/** A top-level `const` of the page's script, by name, up to its closing line. */
function constant(name, end) {
  const start = html.indexOf(`const ${name}`);
  assert.ok(start >= 0, `the page defines ${name}`);
  return html.slice(start, html.indexOf(end, start) + end.length);
}

function heroes() {
  const context = vm.createContext({});
  const source = [constant('HERO_MAP', '\n};\n'), ...['esc', 'aLink', 'findArtifact', 'findAbsence', 'renderHeroes'].map(lift), 'this.renderHeroes = renderHeroes;'].join('\n');
  vm.runInContext(source, context);
  return context.renderHeroes;
}

const PHASES = [
  { id: 'specification', name: 'Specification', artifacts: [{ path: 'implementation/spec.md', html: 'implementation/spec.html' }] },
  { id: 'planning', name: 'Implementation planning', artifacts: [{ path: 'implementation/implementation-plan.md', html: null }] },
];

const labels = text => [...text.matchAll(/<div class="h-label">([^<]*)<\/div>/g)].map(match => match[1]);

test('hero row: a key document whose page the config turned off loses its card; the data without the key draws every card', () => {
  const render = heroes();
  const task = { type: 'development' };
  assert.deepEqual(labels(render({ task, verification: {} }, PHASES)), ['Explainer', 'Specification', 'Spec Explainer', 'Implementation Plan', 'Verification']);
  const off = render({ task, verification: {}, companions_off: ['implementation/implementation-plan.md'] }, PHASES);
  assert.deepEqual(labels(off), ['Explainer', 'Specification', 'Spec Explainer', 'Verification']);
  // Every card turned off draws no row at all.
  const none = render({ task, verification: {}, companions_off: ['verification/change-explainer.html', 'implementation/spec.md', 'implementation/spec-explainer.html', 'implementation/implementation-plan.md', 'verification/implementation-verification.md'] }, PHASES);
  assert.equal(none, '');
});

test('source chip: a decision by the project config reads "Project config", and the page styles it', () => {
  const context = vm.createContext({});
  vm.runInContext(`${lift('esc')}\n${constant('SOURCE_LABEL', ';\n')}\n${constant('HOST_LABEL', ';\n')}\n${lift('onBehalf')}\n${lift('sourceChip')}\nthis.sourceChip = sourceChip;`, context);
  assert.equal(context.sourceChip({ by: 'config', option: 'continue-to-implementation' }), '<span class="src config">Project config</span>');
  assert.match(html, /\.src\.config\s*\{[^}]*var\(--/);
});

function frozen(t, config) {
  const run = scratch(t, { type: 'config-workflow', name: '2026-01-05-config' });
  if (config !== null) {
    fs.mkdirSync(path.join(run.root, '.maister'), { recursive: true });
    fs.writeFileSync(path.join(run.root, '.maister', 'config.yml'), config);
  }
  const { patch } = freezePatch({ definition: DEFINITION, orchestrator: { options: { inputs: { publish: false }, html_output: true } } });
  const result = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
  return run;
}

test('projection: companions_off names each page the config turned off, and only then', t => {
  const off = readDashboard(frozen(t, 'workflows:\n  config-workflow:\n    html_companions:\n      plan: [notes]\n'));
  // The plan's own page is off; the notes page it now owes is no key document's.
  assert.deepEqual(off.companions_off, ['implementation/implementation-plan.md']);
  assert.equal(Object.keys(off)[0], 'generated');
  assert.equal(Object.hasOwn(readDashboard(frozen(t, 'html_output: true\n')), 'companions_off'), false);
  // An auto_continue alone turns no page off.
  assert.equal(Object.hasOwn(readDashboard(frozen(t, 'workflows:\n  config-workflow:\n    auto_continue: [plan-approval]\n')), 'companions_off'), false);
});
