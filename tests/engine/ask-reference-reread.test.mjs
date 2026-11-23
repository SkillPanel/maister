import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { resolve } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { freezePatch, readState, scratch, verb } from '../helpers.mjs';

// A `${…}` in a gate's `ask:` is an author's mistake, refused where an author
// meets it: validate, resolve and the freeze. A run an older engine froze from
// such a definition, before the refusal existed, is re-read as it was frozen:
// the refusal moves no hash, so the run has not drifted and its sections read.

const ASK_MESSAGE = 'ask is shown to the person as written';

/** The definition, with the gate's question as given, and its node prose beside it. */
function definitionWith(file, ask) {
  fs.writeFileSync(file, [
    'name: ask-reread', 'version: 1', 'description: "A gate whose question an older engine let carry a reference."',
    'inputs:', '  topic: {type: string, required: false}', 'nodes:',
    '  implementation:', '    uses: direct:implementation', '    needs: []',
    '  approval:', '    type: gate', '    needs: [implementation]', `    ask: ${JSON.stringify(ask)}`,
    '    options:', '      continue: continue', '      stop-here: stop', '',
  ].join('\n'));
  fs.writeFileSync(file.replace(/\.yml$/, '.md'), '# Ask reread — node prose\n\n## `implementation`\n\nBuild it.\n');
}

/**
 * A run frozen from a definition whose `ask:` carries a reference, as an engine
 * that did not yet refuse it would have left it: frozen from the same file with
 * a plain question, then the file given the reference and the state its hash.
 */
function frozenBeforeTheRefusal(t) {
  const run = scratch(t);
  const definition = path.join(run.root, 'ask-reread.yml');
  definitionWith(definition, 'Approve the plan?');
  const frozen = verb(['write-state', `--state=${run.state}`], freezePatch({ definition }).patch);
  assert.equal(frozen.code, 0, frozen.stderr);
  const before = readState(run).workflow.graph_hash;
  definitionWith(definition, 'Approve the plan for ${inputs.topic}?');
  const after = resolve({ definition: readDefinition(definition), reread: true });
  assert.equal(after.ok, true, JSON.stringify(after.errors));
  fs.writeFileSync(run.state, fs.readFileSync(run.state, 'utf8').split(before).join(after.graph_hash));
  return { run, definition };
}

test('a run frozen from an ask with a reference re-reads with no drift and gives its section', t => {
  const { run } = frozenBeforeTheRefusal(t);
  const brief = verb(['node-brief', `--state=${run.state}`, '--node=implementation']);
  assert.equal(brief.code, 0, brief.stderr);
  assert.doesNotMatch(brief.stdout, /section: unknown/);
  assert.match(brief.stdout, /Build it\./, 'the node prose is the section');

  const gate = verb(['gate-brief', `--state=${run.state}`, '--node=approval']);
  assert.doesNotMatch(`${gate.stdout}${gate.stderr}`, /gate-brief-graph-drift|unresolvable/);
});

test('validate, resolve and the freeze still refuse a reference in an ask, naming nodes.<id>.ask', t => {
  const { run, definition } = frozenBeforeTheRefusal(t);
  for (const name of ['validate', 'resolve']) {
    const result = verb([name, `--definition=${definition}`]);
    assert.equal(result.code, 1, `${name}: ${result.stdout}`);
    const error = JSON.parse(result.stdout).errors.find(item => item.node === 'approval');
    assert.ok(error, `${name} names the gate: ${result.stdout}`);
    assert.equal(error.path, 'nodes.approval.ask', name);
    assert.ok(error.message.startsWith(ASK_MESSAGE), `${name}: ${error.message}`);
  }

  // A fresh freeze sending the same workflow block is refused, nothing written.
  const fresh = scratch(t, { name: '2026-01-05-fresh' });
  const refused = verb(['write-state', `--state=${fresh.state}`], {
    task: { title: 'Sample run', status: 'in_progress' },
    workflow: readState(run).workflow,
  });
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stderr, /^state-freeze-unproven: /m);
  assert.ok(refused.stderr.includes(ASK_MESSAGE), refused.stderr);
  assert.equal(fs.existsSync(fresh.state), false);
});
