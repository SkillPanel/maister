import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { briefOf as mergeBriefOf, briefOfRun } from '../../plugins/maister/skills/workflow-engine/scripts/lib/brief.mjs';
import { resolve } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { ENGINE_DIR, FIXTURES, verb } from '../helpers.mjs';

// The `brief:` block: per node, what the node's brief prints beside its prose —
// the phase summary keys it mirrors, the absences it may leave, its recovery
// budget, the inputs that recommend a gate option and its questions' defaults.
// Checked on its own shape (errors) and against the resolved graph (warnings),
// merged base → overlays → the selected profile, and kept out of the graph hash.

const BASE = path.join(FIXTURES, 'definitions/brief.yml');
const OVERLAY = path.join(FIXTURES, 'definitions/brief.overlay.yml');
const BASE_TEXT = fs.readFileSync(BASE, 'utf8');
const BLOCK = BASE_TEXT.slice(BASE_TEXT.indexOf('brief:\n'), BASE_TEXT.indexOf('nodes:\n'));

/**
 * A scratch copy of the brief fixture and its prose companion, with the base's
 * block replaced by `block` (raw YAML, or '' for none) and any extra files
 * written beside it. Returns the directory; removed when the test ends.
 */
function scratchDir(t, block = BLOCK, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-brief-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'brief.yml'), BASE_TEXT.replace(BLOCK, block));
  fs.copyFileSync(path.join(FIXTURES, 'definitions/brief.md'), path.join(dir, 'brief.md'));
  for (const [name, content] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

function validate(args) {
  const result = verb(['validate', ...args]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

const briefWarnings = report => report.warnings.filter(warning => warning.startsWith('brief-'));
const plain = merged => JSON.parse(JSON.stringify(merged));

test('the block is accepted in a definition, an overlay and an overlay\'s profile', () => {
  for (const args of [
    [`--definition=${BASE}`],
    [`--definition=${BASE}`, `--overlay=${OVERLAY}`],
    [`--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean'],
    [`--overlay=${OVERLAY}`],
  ]) {
    const { code, report } = validate(args);
    assert.equal(code, 0, `${args.join(' ')}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(briefWarnings(report), [], args.join(' '));
  }
});

test('each malformed shape is an error, located at its path', t => {
  const long = 'x'.repeat(121);
  const cases = [
    ['brief: [analysis]\n', 'brief', /^brief is a mapping of node id to the node's brief entry; .* is not$/],
    ['brief:\n  Analysis_1: {budget: 1}\n', 'brief.Analysis_1', /^"Analysis_1" is not a node id$/],
    ['brief:\n  analysis: 3\n', 'brief.analysis', /^brief\.analysis is a mapping of brief keys \(summary_keys, .*\); .* is not$/],
    ['brief:\n  analysis:\n', 'brief.analysis', /^brief\.analysis is a mapping of brief keys \(summary_keys, .*\); .* is not$/],
    ['brief:\n  analysis: {budgets: 2}\n', 'brief.analysis.budgets', /did you mean "budget"\?/],
    ['brief:\n  analysis: {summary_keys: analysis}\n', 'brief.analysis.summary_keys', /^summary_keys is a list of phase keys/],
    ['brief:\n  analysis: {summary_keys: [Analysis]}\n', 'brief.analysis.summary_keys.0', /^a phase key is /],
    ['brief:\n  analysis: {summary_keys: [scope, scope]}\n', 'brief.analysis.summary_keys', /names scope twice$/],
    ['brief:\n  analysis: {absent: [notes]}\n', 'brief.analysis.absent', /^absent is a mapping of artifact key to /],
    ['brief:\n  analysis: {absent: {notes: 3}}\n', 'brief.analysis.absent.notes', /^an absence's reason is /],
    ['brief:\n  analysis: {budget: 11}\n', 'brief.analysis.budget', /^budget is a whole number from 1 to 10/],
    ['brief:\n  analysis: {budget: 1.5}\n', 'brief.analysis.budget', /^budget is a whole number from 1 to 10/],
    ['brief:\n  analysis: {budget: "2"}\n', 'brief.analysis.budget', /^budget is a whole number from 1 to 10/],
    ['brief:\n  specification: {recommends: {audit_flag: continue-to-audit}}\n', 'brief.specification.recommends.audit_flag',
      /^recommends\.audit_flag is a mapping of input value to /],
    ['brief:\n  specification: {recommends: {audit_flag: {"yes": 3}}}\n', 'brief.specification.recommends.audit_flag.yes',
      /^a recommended option is a gate option id; .* is not$/],
    ['brief:\n  analysis: {questions: [scope-check]}\n', 'brief.analysis.questions', /^questions is a mapping of question id to /],
    [`brief:\n  analysis: {questions: {scope-check: "${long}"}}\n`, 'brief.analysis.questions.scope-check',
      /^a question's default is one line of at most 120 characters/],
    ['brief:\n  analysis: {questions: {scope-check: "take\\nit"}}\n', 'brief.analysis.questions.scope-check',
      /^a question's default is one line/],
    ['brief:\n  analysis: {absent: {notes: "not\\nwritten"}}\n', 'brief.analysis.absent.notes', /^an absence's reason is /],
    ['brief:\n  analysis: {budget: null}\n', 'brief.analysis.budget', /^null removes a key an earlier layer set/],
  ];
  for (const [block, at, message] of cases) {
    const dir = scratchDir(t, block);
    const { code, report } = validate([`--definition=${path.join(dir, 'brief.yml')}`]);
    assert.equal(code, 1, block);
    const found = report.errors.filter(error => error.path === at);
    assert.equal(found.length, 1, `${block}: ${JSON.stringify(report.errors)}`);
    assert.match(found[0].message, message, block);
  }

  // An overlay's and a profile's own block are judged with their prefix, in
  // standalone mode too; a null entry and a null key are an overlay's removals.
  const dir = scratchDir(t, BLOCK, {
    'bad.overlay.yml': 'extends: brief.yml\nbrief:\n  analysis: {budget: 0}\n  review: null\n  audit: {budget: null}\n'
      + 'profiles:\n  lean:\n    brief:\n      specification: {summary_keys: [spec, spec]}\n',
  });
  const overlay = path.join(dir, 'bad.overlay.yml');
  for (const args of [[`--definition=${path.join(dir, 'brief.yml')}`, `--overlay=${overlay}`], [`--overlay=${overlay}`]]) {
    const { code, report } = validate(args);
    assert.equal(code, 1);
    assert.deepEqual(report.errors.map(error => [error.file, error.path]).sort(),
      [[overlay, 'brief.analysis.budget'], [overlay, 'profiles.lean.brief.specification.summary_keys']], args.join(' '));
  }
});

test('an unknown node, artifact, input and option each warn, and validate', t => {
  const dir = scratchDir(t, 'brief:\n  ghost: {budget: 1}\n  analysis:\n    absent: {missing: "never"}\n'
    + '  specification:\n    recommends:\n      nope: {"yes": continue-to-audit}\n'
    + '      audit_flag: {"yes": revise-specification, "no": continue-to-review}\n', {
    'warn.overlay.yml': 'extends: brief.yml\nprofiles:\n  wide:\n    brief:\n      phantom: {budget: 2}\n',
  });
  const definition = path.join(dir, 'brief.yml');
  const { code, report } = validate([`--definition=${definition}`]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(briefWarnings(report), [
    'brief-unknown-node:brief.ghost:ghost',
    'brief-unknown-artifact:brief.analysis.absent.missing:analysis',
    'brief-unknown-input:brief.specification.recommends.nope:specification',
    'brief-unknown-option:brief.specification.recommends.audit_flag.yes:specification',
  ]);
  const profiled = validate([`--definition=${definition}`, `--overlay=${path.join(dir, 'warn.overlay.yml')}`, '--profile=wide']);
  assert.equal(profiled.code, 0, JSON.stringify(profiled.report.errors));
  assert.ok(briefWarnings(profiled.report).includes('brief-unknown-node:profiles.wide.brief.phantom:phantom'));

  // A node an overlay's or the profile's disable removed counts as removed, not unknown.
  const trimmed = validate([`--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean']);
  assert.deepEqual(briefWarnings(trimmed.report), []);
});

test('merge: a later key replaces, null removes a key or an entry, and a disabled node yields nothing', () => {
  const definition = readDefinition(BASE);
  const overlay = readDefinition(OVERLAY);

  const base = mergeBriefOf({ definition });
  assert.equal(Object.getPrototypeOf(base), null);
  assert.equal(Object.getPrototypeOf(base.analysis), null);
  assert.deepEqual(plain(base), {
    analysis: {
      summary_keys: ['analysis', 'scope'],
      absent: { notes: 'Written only when the analysis raises open questions.' },
      budget: 2,
      questions: { 'scope-check': 'Take the scope as the task describes it.' },
    },
    specification: {
      summary_keys: ['specification'],
      recommends: { audit_flag: { yes: 'continue-to-audit', no: 'continue-to-review' } },
    },
    audit: { budget: 1 },
    review: { budget: 1 },
  });

  const overlaid = plain(mergeBriefOf({ definition, overlays: [overlay] }));
  assert.deepEqual(overlaid.analysis, {
    summary_keys: ['analysis', 'scope'],
    budget: 3,
    questions: { 'scope-check': 'Take the scope as the task describes it.' },
  });
  assert.equal(overlaid.review, undefined, 'a null entry removes the entry');
  assert.deepEqual(overlaid.extra, { summary_keys: ['extra'] }, 'an added node carries its own entry');

  const lean = plain(mergeBriefOf({ definition, overlays: [overlay], profile: 'lean' }));
  assert.deepEqual(lean.specification.summary_keys, ['spec'], 'the profile has the last word');
  assert.deepEqual(lean.specification.recommends, overlaid.specification.recommends, 'merging is key by key');
  assert.equal(lean.audit, undefined, 'a disabled node yields nothing');
  assert.deepEqual(plain(mergeBriefOf({ definition, overlays: [overlay], profile: 'absent' })), overlaid);

  // Malformed input contributes nothing and never throws: the earlier value stands.
  const malformed = { file: 'x.overlay.yml', doc: { extends: 'brief.yml', brief: {
    analysis: { budget: 11, summary_keys: 'analysis', unknown: 1 }, specification: 4,
  } } };
  assert.deepEqual(plain(mergeBriefOf({ definition, overlays: [malformed] })), plain(base));
  assert.deepEqual(plain(mergeBriefOf({ definition: { file: 'y.yml', doc: { brief: ['analysis'] } } })), {});
  assert.deepEqual(plain(mergeBriefOf()), {});
});

test('a run\'s brief is read from the sources it froze, and null when they cannot be read', t => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-brief-run-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  const doc = { workflow: { source: BASE, overlays: [OVERLAY], profile: 'lean' } };
  const expected = mergeBriefOf({ definition: readDefinition(BASE), overlays: [readDefinition(OVERLAY)], profile: 'lean' });
  assert.deepEqual(plain(briefOfRun(doc, runDir)), plain(expected));
  assert.equal(briefOfRun({ workflow: { source: path.join(runDir, 'missing.yml') } }, runDir), null);
  assert.equal(briefOfRun({}, runDir), null);
});

test('resolve prints no brief, and the block leaves the graph hash where it was', t => {
  const withBlock = verb(['resolve', `--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean']);
  assert.equal(withBlock.code, 0, withBlock.stdout);
  assert.ok(!Object.hasOwn(JSON.parse(withBlock.stdout), 'brief'));
  assert.ok(!withBlock.stdout.includes('summary_keys'));
  assert.ok(!withBlock.stdout.includes('scope-check'));

  const bareBase = readDefinition(path.join(scratchDir(t, ''), 'brief.yml'));
  const overlay = readDefinition(OVERLAY);
  const { brief: _own, profiles, ...rest } = overlay.doc;
  const { brief: _profiled, ...lean } = profiles.lean;
  const bare = { ...overlay, doc: { ...rest, profiles: { lean } } };
  assert.equal(JSON.parse(withBlock.stdout).graph_hash,
    resolve({ definition: bareBase, overlays: [bare], profile: 'lean' }).graph_hash);
});

// ---------------------------------------------------------------------------
// the built-ins
// ---------------------------------------------------------------------------

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

const BASELINE_HASHES = {
  development: 'sha256:07283f38099328aa45b9031c81e9320e199f2cc2bd14d6dc97d8e76bdb56d47c',
  research: 'sha256:e2bdfcbcb2cddbaf0d0c972c07ed51cddddf8abe33fc171092c038e925e688a5',
  performance: 'sha256:183605fc3986554aedd5cf5b92ce001ef65302858909b2984d96d0b8fbbcce62',
  migration: 'sha256:04f475d1cb380017e6a30a1038448b5af8fb5ecb874ce98b5e67ed5d4ebc1546',
  'product-design': 'sha256:08bd2d76e6c1472b130e22ca7a2a8f5d10fb46fd2d380522edb9f5af669c9e00',
};

// Each built-in's phase summary keys, node by node, as its guide's Phase
// summary keys table names them.
const SUMMARY_KEYS = {
  development: {
    intake: ['research', 'design'],
    'codebase-analysis': ['codebase_analysis', 'clarifications'],
    'gap-analysis': ['gap_analysis', 'scope_clarifications'],
    'ui-mockups': ['ui_mockups', 'design'],
    specification: ['specification', 'architecture_decision'],
    'spec-audit': ['spec_audit'],
    planning: ['implementation_plan'],
    implementation: ['implementation'],
  },
  research: {
    'research-foundation': ['phase-1'],
    'solution-generation': ['phase-3'],
    'solution-convergence': ['phase-4'],
    'high-level-design': ['phase-5'],
  },
  'product-design': {
    'context-synthesis': ['context_synthesis'],
    'problem-exploration': ['problem_exploration'],
    'persona-exploration': ['persona_exploration'],
    'idea-generation': ['idea_generation'],
    'idea-convergence': ['idea_convergence'],
    'feature-specification': ['feature_specification'],
    'visual-prototyping': ['visual_prototyping'],
    'review-handoff': ['review_handoff'],
  },
  performance: {
    'codebase-analysis': ['codebase_analysis'],
    'bottleneck-analysis': ['bottleneck_analysis'],
    specification: ['specification'],
    implementation: ['implementation'],
  },
  migration: {
    'current-state-analysis': ['current_state_analysis'],
    'gap-analysis': ['gap_analysis'],
    specification: ['specification'],
    execution: ['implementation'],
  },
};

test('development\'s summary keys are twelve over eight nodes', () => {
  const nodes = Object.values(SUMMARY_KEYS.development);
  assert.equal(nodes.length, 8);
  assert.equal(new Set(nodes.flat()).size, 12);
});

test('each built-in\'s hash stays at the baseline, with and without a brief: block', () => {
  for (const [name, hash] of Object.entries(BASELINE_HASHES)) {
    const definition = readDefinition(path.join(WORKFLOWS, `${name}.yml`));
    const { brief: _block, ...doc } = definition.doc;
    const first = Object.keys(doc.nodes)[0];
    const added = { ...doc, brief: { [first]: { budget: 1, questions: { 'some-question': 'Carry on.' } } } };
    for (const [label, variant] of [['as shipped', definition.doc], ['without', doc], ['with an added block', added]]) {
      const result = resolve({ definition: { ...definition, doc: variant } });
      assert.equal(result.ok, true, `${name} ${label}: ${JSON.stringify(result.errors)}`);
      assert.equal(result.graph_hash, hash, `${name} ${label}`);
    }
  }
});

for (const [name, expected] of Object.entries(SUMMARY_KEYS)) {
  const definition = readDefinition(path.join(WORKFLOWS, `${name}.yml`));
  const carried = definition.doc && Object.hasOwn(definition.doc, 'brief');
  test(`${name}'s brief: block names the guide's summary keys`, { todo: carried ? false : 'its yml carries no brief: yet' }, () => {
    const merged = mergeBriefOf({ definition });
    const found = {};
    for (const [node, entry] of Object.entries(merged)) {
      if (entry.summary_keys) found[node] = entry.summary_keys;
    }
    assert.deepEqual(found, expected);
  });
}
