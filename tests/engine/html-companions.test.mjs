import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readDefinition } from '../../plugins/maister/skills/workflow-engine/scripts/lib/definition.mjs';
import { companionsOf, isMarkdown, owedCompanions } from '../../plugins/maister/skills/workflow-engine/scripts/lib/companions.mjs';
import { foldDefinition, resolve } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';
import { ENGINE_DIR, FIXTURES, verb } from '../helpers.mjs';

// The `html_companions:` block: which markdown artifacts of which nodes owe an
// HTML companion. Checked on its own shape (errors) and against the resolved
// graph (warnings), merged base → overlays → the selected profile, and kept
// out of the graph hash.

const BASE = path.join(FIXTURES, 'definitions/companions.yml');
const OVERLAY = path.join(FIXTURES, 'definitions/companions.overlay.yml');
const BLOCK = 'html_companions:\n  analysis: [report]\n  specification: [spec]\n  review: [report]\n';

/**
 * A scratch copy of the companions fixture and its prose companion, with the
 * base's block replaced by `block` (raw YAML, or '' for none) and any extra
 * files written beside it. Returns the directory; removed when the test ends.
 */
function scratchDir(t, block = BLOCK, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-companions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const text = fs.readFileSync(BASE, 'utf8');
  assert.ok(text.includes(BLOCK), 'the fixture carries the block this helper replaces');
  fs.writeFileSync(path.join(dir, 'companions.yml'), text.replace(BLOCK, block));
  fs.copyFileSync(path.join(FIXTURES, 'definitions/companions.md'), path.join(dir, 'companions.md'));
  for (const [name, content] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

function validate(args) {
  const result = verb(['validate', ...args]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

const companionWarnings = report => report.warnings.filter(warning => warning.startsWith('html-companion-'));

test('the block is accepted in a definition, an overlay and an overlay\'s profile', () => {
  for (const args of [
    [`--definition=${BASE}`],
    [`--definition=${BASE}`, `--overlay=${OVERLAY}`],
    [`--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean'],
    [`--overlay=${OVERLAY}`],
  ]) {
    const { code, report } = validate(args);
    assert.equal(code, 0, `${args.join(' ')}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(companionWarnings(report), [], args.join(' '));
  }
});

test('each malformed shape is an error, located at its path', t => {
  const cases = [
    ['html_companions: [report]\n', 'html_companions',
      /^html_companions is a mapping of node id to a list of artifact keys; .* is not$/],
    ['html_companions:\n  Analysis_1: [report]\n', 'html_companions.Analysis_1', /^"Analysis_1" is not a node id$/],
    ['html_companions:\n  analysis: report\n', 'html_companions.analysis',
      /^html_companions\.analysis is a list of the node's artifact keys; "report" is not$/],
    ['html_companions:\n  analysis:\n', 'html_companions.analysis',
      /^html_companions\.analysis is a list of the node's artifact keys; .* is not$/],
    ['html_companions:\n  analysis: [1]\n', 'html_companions.analysis.0',
      /^an artifact key is the name the node declares under outputs\.artifacts; .* is not$/],
    ['html_companions:\n  analysis: [""]\n', 'html_companions.analysis.0', /^an artifact key is the name/],
    ['html_companions:\n  analysis: ["re\\nport"]\n', 'html_companions.analysis.0', /^an artifact key is the name/],
    ['html_companions:\n  analysis: [report, report]\n', 'html_companions.analysis',
      /^html_companions\.analysis names report twice$/],
    ['html_companion:\n  analysis: [report]\n', 'html_companion', /did you mean "html_companions"\?/],
  ];
  for (const [block, at, message] of cases) {
    const dir = scratchDir(t, block);
    const { code, report } = validate([`--definition=${path.join(dir, 'companions.yml')}`]);
    assert.equal(code, 1, block);
    const found = report.errors.filter(error => error.path === at);
    assert.equal(found.length, 1, `${block}: ${JSON.stringify(report.errors)}`);
    assert.match(found[0].message, message, block);
  }

  // An overlay's and a profile's own block are judged with their prefix, in
  // standalone mode too.
  const dir = scratchDir(t, BLOCK, {
    'bad.overlay.yml': 'extends: companions.yml\nhtml_companions:\n  analysis: report\n'
      + 'profiles:\n  lean:\n    html_companions:\n      review: [report, report]\n',
  });
  const overlay = path.join(dir, 'bad.overlay.yml');
  for (const args of [[`--definition=${path.join(dir, 'companions.yml')}`, `--overlay=${overlay}`], [`--overlay=${overlay}`]]) {
    const { code, report } = validate(args);
    assert.equal(code, 1);
    assert.deepEqual(report.errors.map(error => [error.file, error.path]).sort(),
      [[overlay, 'html_companions.analysis'], [overlay, 'profiles.lean.html_companions.review']], args.join(' '));
  }
});

test('an unknown node, an undeclared artifact and a non-markdown path each warn, and validate', t => {
  const dir = scratchDir(t, 'html_companions:\n  ghost: [report]\n  analysis: [missing, data, report]\n', {
    'warn.overlay.yml': 'extends: companions.yml\nprofiles:\n  wide:\n    html_companions:\n      phantom: [log]\n',
  });
  const definition = path.join(dir, 'companions.yml');
  const { code, report } = validate([`--definition=${definition}`]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(companionWarnings(report), [
    'html-companion-unknown-node:html_companions.ghost:ghost',
    'html-companion-unknown-artifact:html_companions.analysis.0:analysis',
    'html-companion-not-markdown:html_companions.analysis.1:analysis',
  ]);
  const profiled = validate([`--definition=${definition}`, `--overlay=${path.join(dir, 'warn.overlay.yml')}`, '--profile=wide']);
  assert.equal(profiled.code, 0, JSON.stringify(profiled.report.errors));
  assert.ok(companionWarnings(profiled.report).includes('html-companion-unknown-node:profiles.wide.html_companions.phantom:phantom'));
});

test('a node an overlay\'s or the profile\'s disable removed is not warned about', t => {
  // The base owes a companion for `review`; the profile disables it.
  const profiled = validate([`--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean']);
  assert.equal(profiled.code, 0, JSON.stringify(profiled.report.errors));
  assert.deepEqual(companionWarnings(profiled.report), []);

  // An overlay that disables a node and still names it in its own block.
  const dir = scratchDir(t, BLOCK, {
    'trim.overlay.yml': 'extends: companions.yml\ndisable: [review]\nhtml_companions:\n  review: [report]\n',
  });
  const trimmed = validate([`--definition=${path.join(dir, 'companions.yml')}`, `--overlay=${path.join(dir, 'trim.overlay.yml')}`]);
  assert.equal(trimmed.code, 0, JSON.stringify(trimmed.report.errors));
  assert.deepEqual(companionWarnings(trimmed.report), []);
});

test('merge: an overlay replaces a node\'s list, [] clears it, and the profile has the last word', () => {
  const definition = readDefinition(BASE);
  const overlay = readDefinition(OVERLAY);
  const plain = merged => JSON.parse(JSON.stringify(merged));

  const base = companionsOf({ definition });
  assert.equal(Object.getPrototypeOf(base), null);
  assert.deepEqual(plain(base), { analysis: ['report'], specification: ['spec'], review: ['report'] });
  assert.deepEqual(plain(companionsOf({ definition, overlays: [overlay] })),
    { specification: ['spec', 'notes'], review: ['report'], audit: ['log'] });
  assert.deepEqual(plain(companionsOf({ definition, overlays: [overlay], profile: 'lean' })),
    { specification: ['notes'], review: ['report'], audit: ['log'] });
  assert.deepEqual(plain(companionsOf({ definition, overlays: [overlay], profile: 'absent' })),
    plain(companionsOf({ definition, overlays: [overlay] })), 'a profile no overlay declares contributes nothing');

  // A malformed value contributes nothing: the earlier list stands.
  const malformed = { file: 'x.overlay.yml', doc: { extends: 'companions.yml', html_companions: { specification: 'notes', review: [1], analysis: ['report', 'report'] } } };
  assert.deepEqual(plain(companionsOf({ definition, overlays: [malformed] })), plain(base));
  assert.deepEqual(plain(companionsOf({ definition: { file: 'y.yml', doc: { html_companions: ['report'] } } })), {});
  assert.deepEqual(plain(companionsOf()), {});

  // What a node owes: the declared markdown paths, as their .html siblings.
  const folded = foldDefinition({ definition, overlays: [overlay] });
  const owed = { merged: companionsOf({ definition, overlays: [overlay] }), definition: folded };
  assert.deepEqual(owedCompanions(owed, 'specification'), [
    { key: 'spec', md: 'implementation/spec.md', html: 'implementation/spec.html' },
    { key: 'notes', md: 'implementation/notes.md', html: 'implementation/notes.html' },
  ]);
  assert.deepEqual(owedCompanions(owed, 'audit'), [{ key: 'log', md: 'verification/audit.md', html: 'verification/audit.html' }]);
  assert.deepEqual(owedCompanions(owed, 'analysis'), [], 'a cleared list owes nothing');
  assert.deepEqual(owedCompanions(owed, 'wrap-up'), []);
  assert.deepEqual(owedCompanions({ merged: { analysis: ['data', 'missing', 'report'] }, definition: folded }, 'analysis'),
    [{ key: 'report', md: 'analysis/report.md', html: 'analysis/report.html' }], 'unknown keys and non-markdown paths are skipped');
});

test('an interpolated markdown path owes no companion, as the artifact reconcile skips it', () => {
  // The reconcile cannot name a `${…}` path's file, so no page is held to it either.
  const definition = { nodes: { draft: { outputs: { artifacts: {
    report: 'analysis/report.md',
    named: 'analysis/${inputs.name}.md',
    dated: '${inputs.dir}/notes.md',
  } } } } };
  assert.deepEqual(owedCompanions({ merged: { draft: ['named', 'report', 'dated'] }, definition }, 'draft'),
    [{ key: 'report', md: 'analysis/report.md', html: 'analysis/report.html' }]);
  assert.equal(isMarkdown('analysis/${inputs.name}.md'), false);
  assert.equal(isMarkdown('analysis/report.md'), true);
});

test('resolve omits the block, and the block leaves the graph hash where it was', t => {
  const withBlock = verb(['resolve', `--definition=${BASE}`]);
  assert.equal(withBlock.code, 0, withBlock.stdout);
  assert.ok(!withBlock.stdout.includes('html_companions'));
  const without = resolve({ definition: readDefinition(path.join(scratchDir(t, ''), 'companions.yml')) });
  assert.equal(JSON.parse(withBlock.stdout).graph_hash, without.graph_hash);

  const overlaid = verb(['resolve', `--definition=${BASE}`, `--overlay=${OVERLAY}`, '--profile=lean']);
  assert.equal(overlaid.code, 0, overlaid.stdout);
  assert.ok(!overlaid.stdout.includes('html_companions'));
  const overlay = readDefinition(OVERLAY);
  const { html_companions: _own, profiles, ...rest } = overlay.doc;
  const { html_companions: _profiled, ...lean } = profiles.lean;
  const bare = { ...overlay, doc: { ...rest, profiles: { lean } } };
  assert.equal(JSON.parse(overlaid.stdout).graph_hash,
    resolve({ definition: readDefinition(path.join(scratchDir(t, ''), 'companions.yml')), overlays: [bare], profile: 'lean' }).graph_hash);
});

// ---------------------------------------------------------------------------
// the built-ins
// ---------------------------------------------------------------------------

const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

// The graph hash of each built-in before it declared the block; a change that
// moves one of these is a change to the graph, not to the block.
const BASELINE_HASHES = {
  development: 'sha256:07283f38099328aa45b9031c81e9320e199f2cc2bd14d6dc97d8e76bdb56d47c',
  research: 'sha256:e2bdfcbcb2cddbaf0d0c972c07ed51cddddf8abe33fc171092c038e925e688a5',
  performance: 'sha256:183605fc3986554aedd5cf5b92ce001ef65302858909b2984d96d0b8fbbcce62',
  migration: 'sha256:04f475d1cb380017e6a30a1038448b5af8fb5ecb874ce98b5e67ed5d4ebc1546',
  'product-design': 'sha256:08bd2d76e6c1472b130e22ca7a2a8f5d10fb46fd2d380522edb9f5af669c9e00',
};

const BUILT_IN_COMPANIONS = {
  development: {
    specification: ['spec'],
    planning: ['plan'],
    verification: ['report'],
    'e2e-verification': ['e2e', 'fidelity'],
  },
  performance: { specification: ['spec'], planning: ['plan'], verification: ['report'] },
  migration: { specification: ['spec'], planning: ['plan'], verification: ['report'] },
  research: {
    'research-foundation': ['report'],
    'solution-generation': ['exploration'],
    'high-level-design': ['design', 'decision_log'],
  },
  'product-design': {
    'idea-generation': ['alternatives'],
    'idea-convergence': ['decisions'],
    'feature-specification': ['spec'],
    'review-handoff': ['brief'],
  },
};

test('each built-in\'s block leaves its graph hash at the baseline', () => {
  for (const [name, hash] of Object.entries(BASELINE_HASHES)) {
    const definition = readDefinition(path.join(WORKFLOWS, `${name}.yml`));
    assert.ok(definition.doc.html_companions, `${name} declares the block`);
    const { html_companions: _block, ...doc } = definition.doc;
    const withBlock = resolve({ definition });
    const bare = resolve({ definition: { ...definition, doc } });
    assert.equal(withBlock.ok, true, name);
    assert.equal(withBlock.graph_hash, bare.graph_hash, name);
    assert.equal(withBlock.graph_hash, hash, name);
  }
});

test('the built-ins owe exactly these companions, each of a declared markdown artifact', () => {
  let nodes = 0;
  let keys = 0;
  for (const [name, expected] of Object.entries(BUILT_IN_COMPANIONS)) {
    const file = path.join(WORKFLOWS, `${name}.yml`);
    const definition = readDefinition(file);
    const merged = companionsOf({ definition });
    assert.deepEqual(JSON.parse(JSON.stringify(merged)), expected, name);
    const folded = foldDefinition({ definition });
    for (const [node, declared] of Object.entries(expected)) {
      const owed = owedCompanions({ merged, definition: folded }, node);
      assert.deepEqual(owed.map(row => row.key), declared, `${name}: ${node}`);
      for (const row of owed) assert.match(row.md, /\.md$/, `${name}: ${node}.${row.key}`);
      nodes += 1;
      keys += owed.length;
    }
    const { code, report } = validate([`--definition=${file}`]);
    assert.equal(code, 0, `${name}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(companionWarnings(report), [], name);
  }
  assert.deepEqual([nodes, keys], [17, 19]);
});
