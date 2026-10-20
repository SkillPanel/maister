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

const UMBRELLA_SCRIPTS = path.join(ROOT, 'plugins/maister/skills/umbrella/scripts');
const FACADE = 'workflow-engine/scripts/lib/umbrella-facade.mjs';

function moduleFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return moduleFiles(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('the umbrella reaches the engine through the facade and nowhere else', () => {
  const stray = [];
  let throughFacade = 0;
  for (const file of moduleFiles(UMBRELLA_SCRIPTS)) {
    const text = fs.readFileSync(file, 'utf8');
    // Static `import … from` and `export … from` specifiers; a multi-line
    // import list is matched as a whole.
    for (const [, specifier] of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)) {
      if (!specifier.includes('workflow-engine/')) continue;
      if (specifier.endsWith(FACADE)) throughFacade++;
      else stray.push(`${path.relative(ROOT, file).split(path.sep).join('/')}: ${specifier}`);
    }
  }
  assert.deepEqual(stray, [], 'umbrella modules importing the engine other than through its facade');
  assert.ok(throughFacade > 0, 'no umbrella module imports the facade, so the scan found nothing to check');
});
