import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, SAMPLE, verb } from '../helpers.mjs';
import { GUARD_OPERATORS, guardOperands, guardTerms } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { evaluate, reach, walk } from '../../plugins/maister/skills/workflow-engine/scripts/lib/gate-brief.mjs';
import { render } from '../../plugins/maister/skills/workflow-engine/scripts/lib/diagram.mjs';

// A guard joins references with `&&` and `||`, `&&` binding tighter, with no
// parentheses (grammar § 7). Each case below validates, reads or walks one.

const PROSE = '# Ship — node prose\n\n## `intake`\n\nRead the topic.\n\n## `wrapup`\n\nClose out.\n';

/**
 * An intake recording `deep`, a gate splitting the way on three ways from
 * `push` and `pr`, an approval per way, and a wrap-up after all three. `guard`
 * replaces the push-only approval's guard; `extra` lines are appended.
 */
function shipping({ guard = '"${ship-choice.values.push} && !${ship-choice.values.pr}"', extra = [] } = {}) {
  return [
    'name: ship',
    'version: 1',
    'inputs:',
    '  topic: {type: string, required: true}',
    '  fast: {type: bool, default: false}',
    '  label: {type: string}',
    'nodes:',
    '  intake:',
    '    uses: direct:intake',
    '    needs: []',
    '    with: {topic: "${inputs.topic}"}',
    '    outputs:',
    '      artifacts: {notes: analysis/notes.md}',
    '      values: {deep: bool, kind: id}',
    '  ship-choice:',
    '    type: gate',
    '    needs: [intake]',
    '    ask: "Intake done. How should the change leave?"',
    '    options:',
    '      open-pr: {effect: continue, sets: {push: true, pr: true}}',
    '      push-only: {effect: continue, sets: {push: true, pr: false}}',
    '      keep-local: {effect: continue, sets: {push: false, pr: false}}',
    '  pr-approval:',
    '    type: gate',
    '    needs: [ship-choice]',
    '    when: "${ship-choice.values.pr}"',
    '    ask: "Open the pull request?"',
    '    options: {go-on: continue, stop-here: stop}',
    '  push-approval:',
    '    type: gate',
    '    needs: [ship-choice]',
    `    when: ${guard}`,
    '    ask: "Push the branch?"',
    '    options: {go-on: continue, stop-here: stop}',
    '  local-approval:',
    '    type: gate',
    '    needs: [ship-choice]',
    '    when: "!${ship-choice.values.push} && !${ship-choice.values.pr}"',
    '    ask: "Keep the commit local?"',
    '    options: {go-on: continue, stop-here: stop}',
    '  wrapup:',
    '    uses: direct:wrapup',
    '    needs: [pr-approval, push-approval, local-approval]',
    ...extra,
  ];
}

function definition(t, lines = shipping()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-guard-and-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ship.yml');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'ship.md'), PROSE);
  return file;
}

function validate(file) {
  const result = verb(['validate', `--definition=${file}`]);
  return { ...result, report: JSON.parse(result.stdout) };
}

function resolved(file) {
  const result = verb(['resolve', `--definition=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const SHAPE = /a when clause is one reference, or several joined by && and \|\|, each optionally negated; && binds tighter than \|\| and there are no parentheses/;

/** The push-only approval's guard errors, as messages. */
function guardErrors(t, guard) {
  const { report } = validate(definition(t, shipping({ guard })));
  return report.errors.filter(error => error.path === 'nodes.push-approval.when').map(error => error.message);
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

test('a guard splits at || into terms and each term at && into its references, trimmed', () => {
  assert.deepEqual(guardTerms('${a.values.x} || ${b.values.y} && !${c.values.z}'),
    [['${a.values.x}'], ['${b.values.y}', '!${c.values.z}']]);
  assert.deepEqual(guardTerms('${a.values.x}&&${b.values.y}'), [['${a.values.x}', '${b.values.y}']]);
  assert.deepEqual(guardOperands('${a.values.x} && ${b.values.y} || ${c.values.z}'),
    ['${a.values.x}', '${b.values.y}', '${c.values.z}']);
  assert.deepEqual(GUARD_OPERATORS, ['||', '&&']);
});

test('a guard joined with && validates, with or without spaces around the operators', t => {
  for (const guard of [
    '"${ship-choice.values.push} && !${ship-choice.values.pr}"',
    '"${ship-choice.values.push}&&!${ship-choice.values.pr}"',
    '"${ship-choice.values.push}   &&  !${ship-choice.values.pr}"',
    '"!${intake.values.deep} && ${ship-choice.values.push} || ${inputs.fast}"',
    '"${inputs.fast} || ${intake.values.deep} && ${ship-choice.values.push} && !${ship-choice.values.pr}"',
  ]) {
    const { code, report } = validate(definition(t, shipping({ guard })));
    assert.equal(code, 0, `${guard}: ${JSON.stringify(report.errors)}`);
  }
});

test('a malformed guard is refused at its when with one message naming the grammar', t => {
  for (const guard of [
    '"${ship-choice.values.push} &&"',
    '"&& ${ship-choice.values.push}"',
    '"${ship-choice.values.push} && || ${ship-choice.values.pr}"',
    '"${ship-choice.values.push} & ${ship-choice.values.pr}"',
    '"${ship-choice.values.push} | ${ship-choice.values.pr}"',
    '"${ship-choice.values.push} &&& ${ship-choice.values.pr}"',
    '"${ship-choice.values.push} and ${ship-choice.values.pr}"',
    '"(${ship-choice.values.push} && ${ship-choice.values.pr})"',
    '"! ${ship-choice.values.push} && ${ship-choice.values.pr}"',
  ]) {
    const errors = guardErrors(t, guard);
    assert.equal(errors.length, 1, `${guard}: ${JSON.stringify(errors)}`);
    assert.match(errors[0], SHAPE, guard);
  }
});

test('every reference inside an && term keeps the checks a single reference gets', t => {
  const cases = [
    ['${inputs.nope}', /when names the input "nope", which is not declared/],
    ['${inputs.label}', /when needs a bool input; "label" is declared string/],
    ['${intake.notes}', /when names a declared value output, never an artifact/],
    ['${ghost.values.on}', /when names "ghost", which no node declares/],
    ['${wrapup.values.done}', /when names "wrapup", which is outside this node's needs closure/],
    ['${intake.values.kind}', /"intake.values.kind" is not one/],
    ['${ship-choice.values.merge}', /"ship-choice.values.merge" is not one/],
  ];
  for (const [bad, pattern] of cases) {
    for (const guard of [`"${bad} && \${ship-choice.values.push}"`, `"\${ship-choice.values.push} && !${bad}"`]) {
      const errors = guardErrors(t, guard);
      assert.equal(errors.length, 1, `${guard}: ${JSON.stringify(errors)}`);
      assert.match(errors[0], pattern, guard);
    }
  }
  const both = guardErrors(t, '"${inputs.nope} && ${ghost.values.on}"');
  assert.equal(both.length, 2, 'one error per bad reference');
});

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** A context where `a`, `b`, `c` are bool inputs and `done`/`gone` are nodes. */
function context({ inputs = {}, done = null, gone = false } = {}) {
  const byId = new Map([['done', { id: 'done', uses: 'direct:intake' }], ['gone', { id: 'gone', uses: 'direct:intake' }]]);
  const recorded = { done: { status: 'completed', ...(done ? { values: done } : {}) }, gone: { status: gone ? 'skipped' : 'completed', values: { v: true } } };
  const status = new Map([['done', 'completed'], ['gone', gone ? 'skipped' : 'completed']]);
  return { byId, recorded, status, inputs, defaults: {} };
}

const read = (when, ctx) => {
  const result = evaluate(when, ctx);
  return result.ok ? result.value : result.errors[0].code;
};

test('&& binds tighter than ||', () => {
  const values = [false, true];
  for (const a of values) for (const b of values) for (const c of values) {
    const ctx = context({ inputs: { a, b, c } });
    assert.equal(read('${inputs.a} || ${inputs.b} && ${inputs.c}', ctx), a || (b && c), `a=${a} b=${b} c=${c}`);
    assert.equal(read('${inputs.a} && ${inputs.b} || ${inputs.c}', ctx), (a && b) || c, `a=${a} b=${b} c=${c}`);
  }
});

test('a negation inside an && term negates only its own reference', () => {
  const guard = '${inputs.push} && !${inputs.pr}';
  assert.equal(read(guard, context({ inputs: { push: true, pr: true } })), false);
  assert.equal(read(guard, context({ inputs: { push: true, pr: false } })), true);
  assert.equal(read(guard, context({ inputs: { push: false, pr: false } })), false);
  assert.equal(read(guard, context({ inputs: { push: false, pr: true } })), false);
  assert.equal(read('!${inputs.push} && !${inputs.pr}', context({ inputs: { push: false, pr: false } })), true);
});

test('a skipped node reads false inside an && term, and its negation true', () => {
  const ctx = context({ inputs: { a: true }, gone: true });
  assert.equal(read('${inputs.a} && ${gone.values.v}', ctx), false);
  assert.equal(read('${inputs.a} && !${gone.values.v}', ctx), true);
  assert.equal(read('${inputs.a} && ${gone.values.v}', context({ inputs: { a: true } })), true, 'completed, it reads its value');
});

test('a value never recorded is refused only when no term reads true and nothing in its term reads false', () => {
  const missing = context({ inputs: { a: true, f: false } });
  assert.equal(read('${done.values.v}', missing), 'gate-brief-value-missing');
  assert.equal(read('${inputs.a} && ${done.values.v}', missing), 'gate-brief-value-missing');
  assert.equal(read('${inputs.f} && ${done.values.v}', missing), false, 'a false reference settles its term');
  assert.equal(read('${done.values.v} && ${inputs.f}', missing), false, 'whichever side it is written on');
  assert.equal(read('${done.values.v} && ${inputs.a} || ${inputs.a}', missing), true, 'a true term settles the guard');
  assert.equal(read('${done.values.v} || ${inputs.f} && ${inputs.a}', missing), 'gate-brief-value-missing');
});

// ---------------------------------------------------------------------------
// the ready set
// ---------------------------------------------------------------------------

test('each way on from a three-way split runs exactly one approval and skips the other two', t => {
  const graph = resolved(definition(t));
  const ways = {
    'open-pr': [{ push: true, pr: true }, 'pr-approval'],
    'push-only': [{ push: true, pr: false }, 'push-approval'],
    'keep-local': [{ push: false, pr: false }, 'local-approval'],
  };
  const recorded = { intake: { status: 'completed', values: { deep: false, kind: 'x' } } };
  for (const [option, [sets, runs]] of Object.entries(ways)) {
    const reached = reach({ graph, recorded, gate: 'ship-choice', sets });
    assert.deepEqual(reached.runs, [runs], option);
    assert.deepEqual(reached.skips.sort(), ['local-approval', 'pr-approval', 'push-approval'].filter(id => id !== runs), option);
    assert.deepEqual(reached.later, [], option);
    const walked = walk({ graph, recorded, gate: 'ship-choice', sets });
    assert.equal(walked.next, runs, option);
  }
});

test('a guard whose && reads a skipped node is skipped on the walk, and its negation runs', t => {
  const extra = [
    '  deep-dive:',
    '    uses: direct:intake',
    '    needs: [intake]',
    '    when: "${intake.values.deep}"',
    '    outputs: {values: {found: bool}}',
    '  follow-up:',
    '    uses: direct:wrapup',
    '    needs: [deep-dive, ship-choice]',
    '    when: "${ship-choice.values.push} && ${deep-dive.values.found}"',
    '  plain:',
    '    uses: direct:wrapup',
    '    needs: [deep-dive, ship-choice]',
    '    when: "${ship-choice.values.push} && !${deep-dive.values.found}"',
  ];
  const file = definition(t, shipping({ extra }));
  assert.equal(validate(file).code, 0, JSON.stringify(validate(file).report.errors));
  const graph = resolved(file);
  const recorded = {
    intake: { status: 'completed', values: { deep: false, kind: 'x' } },
    'deep-dive': { status: 'skipped' },
  };
  const reached = reach({ graph, recorded, gate: 'ship-choice', sets: { push: true, pr: false } });
  assert.ok(reached.skips.includes('follow-up'), JSON.stringify(reached));
  assert.ok(reached.runs.includes('plain'), JSON.stringify(reached));
});

// ---------------------------------------------------------------------------
// hash, diagram, interface
// ---------------------------------------------------------------------------

test('an && guard moves the hash as written; a definition without one keeps its hash', t => {
  const hashOf = guard => resolved(definition(t, shipping({ guard }))).graph_hash;
  const single = hashOf('"${ship-choice.values.push}"');
  const both = hashOf('"${ship-choice.values.push} && !${ship-choice.values.pr}"');
  assert.ok(single && both);
  assert.notEqual(single, both);
  assert.equal(resolved(SAMPLE).graph_hash, 'sha256:a2385ab71519bf5ff93fcdc21e020e1185e025166af86c64d2939f92858931b0');
});

test('the diagram draws an && guard with its ampersands escaped', t => {
  const text = render(resolved(definition(t)));
  assert.match(text, /when: \$\{ship-choice\.values\.push\} #38;#38; !\$\{ship-choice\.values\.pr\}/);
  assert.doesNotMatch(text, /&/);
});

test('the interface file names both guard operators', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/maister/interface.json'), 'utf8'));
  assert.deepEqual([...file.grammar.guard_operators].sort(), ['&&', '||']);
});
