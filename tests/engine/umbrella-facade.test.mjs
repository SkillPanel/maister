import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';
import * as facade from '../../plugins/maister/skills/workflow-engine/scripts/lib/umbrella-facade.mjs';
import * as definition from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import * as locateModule from '../../plugins/maister/skills/workflow-engine/scripts/lib/locate.mjs';
import * as graph from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import * as policy from '../../plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs';
import * as resumeCheck from '../../plugins/maister/skills/workflow-engine/scripts/lib/resume-check.mjs';

// The umbrella runtime's contract with the engine: every name it takes, the kind
// of value behind it, and the engine module that owns the binding. An engine
// refactor that renames, removes or retypes one of these breaks the umbrella.
const CONTRACT = {
  ASK_LEVELS: ['array', policy],
  bareWorkflowName: ['function', graph],
  effectiveCeiling: ['function', policy],
  loadPolicy: ['function', policy],
  locate: ['function', locateModule],
  locateTarget: ['function', graph],
  narrowerLevel: ['function', policy],
  readDefinition: ['function', definition],
  resolve: ['function', graph],
  runRoot: ['function', resumeCheck],
  TARGET_NAME: ['regexp', graph],
  TARGET_REF: ['regexp', graph],
  validate: ['function', graph],
};

const kindOf = value => Array.isArray(value) ? 'array' : value instanceof RegExp ? 'regexp' : typeof value;

test('the umbrella facade exports exactly the names the umbrella takes from the engine', () => {
  assert.deepEqual(Object.keys(facade).sort(), Object.keys(CONTRACT).sort());
});

test('each facade export has its pinned kind and is the engine module\'s own binding', () => {
  for (const [name, [kind, owner]] of Object.entries(CONTRACT)) {
    assert.equal(kindOf(facade[name]), kind, `${name} is a ${kindOf(facade[name])}, pinned as a ${kind}`);
    assert.equal(facade[name], owner[name], `${name} is not the engine's own binding`);
  }
});

// The umbrella runtime ships with the Pro edition and imports the engine only
// through the facade; the open plugin, for its part, imports nothing from it.
function moduleFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return moduleFiles(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('no module of the open plugin imports the umbrella runtime', () => {
  const stray = [];
  for (const file of moduleFiles(path.join(ROOT, 'plugins/maister'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)) {
      if (specifier.includes('skills/umbrella/') || /(^|\/)umbrella\//.test(specifier)) {
        stray.push(`${path.relative(ROOT, file).split(path.sep).join('/')}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(stray, []);
});
