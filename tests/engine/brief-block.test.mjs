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
// the absences it may leave, its recovery budget and the inputs that recommend
// a gate option; `summary_keys` is retired, still held to its old shape and
// warned. A question's default is
// not one of them: the Without line of the node's section states it, once.
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

test('a question\'s default is no brief key: questions is refused in a definition and dropped by the merge', t => {
  const dir = scratchDir(t, 'brief:\n  analysis:\n    budget: 2\n    questions: {scope-check: "Take the scope as written."}\n');
  const { code, report } = validate([`--definition=${path.join(dir, 'brief.yml')}`]);
  assert.equal(code, 1);
  const found = report.errors.filter(error => error.path === 'brief.analysis.questions');
  assert.equal(found.length, 1, JSON.stringify(report.errors));
  assert.match(found[0].message, /summary_keys, absent, budget, recommends|brief key/);

  const merged = plain(mergeBriefOf({ definition: readDefinition(path.join(dir, 'brief.yml')) }));
  assert.deepEqual(merged.analysis, { budget: 2 }, 'the merge keeps the brief keys and drops questions');
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

test('a node feeds a gate through a gate it needs: the validator judges a recommended option by the closing nodes, as node-brief does', t => {
  const definition = [
    'name: feeds', 'version: 1', 'inputs:', '  audit: {type: string, required: false}', '',
    'brief:', '  draft:', '    recommends:', '      audit_flag: {"yes": continue-on, "no": continue-to-review}', '',
    'nodes:',
    '  draft:', '    uses: direct:draft', '    needs: []', '    with:', '      audit_flag: "${inputs.audit}"',
    '  review-gate:', '    type: gate', '    needs: [draft]', '    ask: "Draft complete. Continue?"',
    '    options:', '      continue-to-review: continue', '      stop-here: stop',
    '  second-gate:', '    type: gate', '    needs: [review-gate]', '    ask: "Sure?"',
    '    options:', '      continue-on: continue', '      stop-here: stop',
    '  wrap-up:', '    uses: direct:wrap-up', '    needs: [second-gate]', '',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-brief-feeds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'feeds.yml'), definition);
  fs.writeFileSync(path.join(dir, 'feeds.md'), '# Feeds\n\nA sample.\n\n## `draft`\n\n**Does.** Draft it.\n\n## `wrap-up`\n\n**Does.** Wrap up.\n');
  const { code, report } = validate([`--definition=${path.join(dir, 'feeds.yml')}`]);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(briefWarnings(report), [], 'continue-on is a continue of a gate the draft closes through review-gate');
});

test('merge: a later key replaces, null removes a key or an entry, and a disabled node yields nothing', () => {
  const definition = readDefinition(BASE);
  const overlay = readDefinition(OVERLAY);

  const base = mergeBriefOf({ definition });
  assert.equal(Object.getPrototypeOf(base), null);
  assert.equal(Object.getPrototypeOf(base.analysis), null);
  assert.deepEqual(plain(base), {
    analysis: {
      absent: { notes: 'Written only when the analysis raises open questions.' },
      budget: 2,
    },
    specification: {
      recommends: { audit_flag: { yes: 'continue-to-audit', no: 'continue-to-review' } },
    },
    audit: { budget: 1 },
    review: { budget: 1 },
  });

  const overlaid = plain(mergeBriefOf({ definition, overlays: [overlay] }));
  assert.deepEqual(overlaid.analysis, { budget: 3 });
  assert.equal(overlaid.review, undefined, 'a null entry removes the entry');
  assert.deepEqual(overlaid.extra, { budget: 1 }, 'an added node carries its own entry');

  const lean = plain(mergeBriefOf({ definition, overlays: [overlay], profile: 'lean' }));
  assert.deepEqual(lean.specification, { recommends: overlaid.specification.recommends, budget: 4 },
    'the profile has the last word, and merging is key by key');
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

// Development's and research's moved with the optional context input their
// first nodes take; the brief block itself moves none of them.
const BASELINE_HASHES = {
  development: 'sha256:7e3c72d72b5d95b7cbf9dde960a82f8ae09327e1e24978db9c42de83ed605295',
  research: 'sha256:95b869ae2079a9009c0e4e349b6f0af1c005fec1debf64c1a727de09872cc166',
  performance: 'sha256:183605fc3986554aedd5cf5b92ce001ef65302858909b2984d96d0b8fbbcce62',
  migration: 'sha256:04f475d1cb380017e6a30a1038448b5af8fb5ecb874ce98b5e67ed5d4ebc1546',
  'product-design': 'sha256:08bd2d76e6c1472b130e22ca7a2a8f5d10fb46fd2d380522edb9f5af669c9e00',
};

test('each built-in\'s hash stays at the baseline, with and without a brief: block', () => {
  for (const [name, hash] of Object.entries(BASELINE_HASHES)) {
    const definition = readDefinition(path.join(WORKFLOWS, `${name}.yml`));
    const { brief: _block, ...doc } = definition.doc;
    const first = Object.keys(doc.nodes)[0];
    const added = { ...doc, brief: { [first]: { budget: 1 } } };
    for (const [label, variant] of [['as shipped', definition.doc], ['without', doc], ['with an added block', added]]) {
      const result = resolve({ definition: { ...definition, doc: variant } });
      assert.equal(result.ok, true, `${name} ${label}: ${JSON.stringify(result.errors)}`);
      assert.equal(result.graph_hash, hash, `${name} ${label}`);
    }
  }
});

test('no built-in\'s brief: block carries summary_keys', () => {
  for (const name of Object.keys(BASELINE_HASHES)) {
    const file = path.join(WORKFLOWS, `${name}.yml`);
    const definition = readDefinition(file);
    assert.ok(Object.hasOwn(definition.doc, 'brief'), `${name}.yml carries no brief: block`);
    for (const [node, entry] of Object.entries(mergeBriefOf({ definition }))) {
      assert.ok(!Object.hasOwn(entry, 'summary_keys'), `${name}: ${node}`);
    }
    const { code, report } = validate([`--definition=${file}`]);
    assert.equal(code, 0, `${name}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(report.warnings.filter(warning => warning.startsWith('brief-retired-key')), [], name);
  }
});

test('summary_keys still validates, with a retired-key warning', t => {
  const dir = scratchDir(t, 'brief:\n  analysis: {summary_keys: [analysis], budget: 2}\n', {
    'retired.overlay.yml': 'extends: brief.yml\nprofiles:\n  lean:\n    brief:\n      specification: {summary_keys: [specification]}\n',
    'removal.overlay.yml': 'extends: brief.yml\nbrief:\n  analysis: {summary_keys: null}\n',
  });
  const definition = path.join(dir, 'brief.yml');
  const own = validate([`--definition=${definition}`]);
  assert.equal(own.code, 0, JSON.stringify(own.report.errors));
  assert.deepEqual(briefWarnings(own.report), ['brief-retired-key:brief.analysis.summary_keys:analysis']);

  const profiled = validate([`--definition=${definition}`, `--overlay=${path.join(dir, 'retired.overlay.yml')}`, '--profile=lean']);
  assert.equal(profiled.code, 0, JSON.stringify(profiled.report.errors));
  assert.ok(briefWarnings(profiled.report)
    .includes('brief-retired-key:profiles.lean.brief.specification.summary_keys:specification'),
  JSON.stringify(profiled.report.warnings));

  // An overlay's null removes the key: the base's use warns, the removal does not.
  const removal = validate([`--definition=${definition}`, `--overlay=${path.join(dir, 'removal.overlay.yml')}`]);
  assert.equal(removal.code, 0, JSON.stringify(removal.report.errors));
  assert.deepEqual(briefWarnings(removal.report), ['brief-retired-key:brief.analysis.summary_keys:analysis']);
});
