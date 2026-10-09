import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freeze, umbrella } from '../helpers.mjs';

// `auto-low` is no longer offered. A workspace that still names it is warned,
// never refused: the value stays as the author typed it, the exit code is the
// one the workspace had before, and the warning points at the tiers on offer.
// No writer chooses it either — not the scaffold, not the envelope.

const CHAIN = [
  'name: chain', 'version: 1', 'nodes:',
  '  plan:', '    uses: workflow:plan', '    dir: alpha', '    provider: claude', '    needs: []',
].join('\n') + '\n';

/** A scaffolded workspace with member `alpha`; `entry` is appended to its member mapping. */
function workspace(t, entry = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'repos', 'alpha'), { recursive: true });
  const init = umbrella(['init', `--root=${root}`, '--members-root=repos']);
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const manifest = path.join(root, '.maister/umbrella.yml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('members: {}',
    `members:\n  alpha: {path: repos/alpha, kind: repo${entry}}`));
  return { root, manifest };
}

function chain(ws, text, name = 'chain') {
  const file = path.join(ws.root, '.maister/workflows', `${name}.yml`);
  fs.writeFileSync(file, text);
  return file;
}

function validate(ws, ...definitions) {
  const result = umbrella(['validate', `--root=${ws.root}`, ...definitions.map((file) => `--definition=${file}`)]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

function retired(report) {
  return report.warnings.filter((warning) => warning.code === 'auto-low-retired');
}

test('validate: a member naming auto-low is warned auto-low-retired at members.<name>.autonomy, exit 0', (t) => {
  const ws = workspace(t, ', autonomy: auto-low');
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);
  const found = retired(report);
  assert.equal(found.length, 1, JSON.stringify(report.warnings));
  assert.equal(found[0].file, ws.manifest);
  assert.equal(found[0].node, null);
  assert.equal(found[0].path, 'members.alpha.autonomy');
  assert.equal(typeof found[0].message, 'string');
});

test('validate: defaults.autonomy naming auto-low is warned at defaults.autonomy, exit 0', (t) => {
  const ws = workspace(t);
  const text = fs.readFileSync(ws.manifest, 'utf8');
  assert.match(text, /^  autonomy: attended$/m);
  fs.writeFileSync(ws.manifest, text.replace(/^  autonomy: attended$/m, '  autonomy: auto-low'));
  const { code, report } = validate(ws);
  assert.equal(code, 0, JSON.stringify(report.errors));
  const found = retired(report);
  assert.equal(found.length, 1, JSON.stringify(report.warnings));
  assert.equal(found[0].file, ws.manifest);
  assert.equal(found[0].node, null);
  assert.equal(found[0].path, 'defaults.autonomy');
});

test('validate: a chain node whose with.autonomy is auto-low is warned at nodes.<id>.with.autonomy, exit 0', (t) => {
  const ws = workspace(t);
  const definition = chain(ws, CHAIN + '    with:\n      autonomy: auto-low\n');
  const { code, report } = validate(ws, definition);
  assert.equal(code, 0, JSON.stringify(report.errors));
  const found = retired(report);
  assert.equal(found.length, 1, JSON.stringify(report.warnings));
  assert.equal(found[0].file, definition);
  assert.equal(found[0].node, 'plan');
  assert.equal(found[0].path, 'nodes.plan.with.autonomy');

  // Control: an offered tier is not warned.
  const offered = chain(ws, CHAIN + '    with:\n      autonomy: auto-medium\n', 'offered');
  const control = validate(ws, offered);
  assert.equal(control.code, 0);
  assert.deepEqual(retired(control.report), []);
});

test('validate: the value is kept as typed, and the message names the offered tiers and never read-only', (t) => {
  const ws = workspace(t, ', autonomy: auto-low');
  const before = fs.readFileSync(ws.manifest, 'utf8');
  const definition = chain(ws, CHAIN + '    with:\n      autonomy: auto-low\n');
  const chainBefore = fs.readFileSync(definition, 'utf8');
  const { code, report } = validate(ws, definition);
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(ws.manifest, 'utf8'), before, 'the manifest is not rewritten');
  assert.equal(fs.readFileSync(definition, 'utf8'), chainBefore, 'the chain is not rewritten');
  const found = retired(report);
  assert.equal(found.length, 2, JSON.stringify(report.warnings));
  for (const warning of found) {
    assert.match(warning.message, /auto-low/);
    assert.match(warning.message, /no longer offered/);
    assert.match(warning.message, /kept as written/);
    assert.match(warning.message, /attended/);
    assert.match(warning.message, /auto-medium/);
    assert.match(warning.message, /auto-high/);
    assert.doesNotMatch(warning.message, /read-only/i);
  }
});

test('no writer emits auto-low: the scaffold writes attended, the envelope carries only what it was given', (t) => {
  const ws = workspace(t);
  const text = fs.readFileSync(ws.manifest, 'utf8');
  assert.match(text, /^  autonomy: attended$/m);
  assert.doesNotMatch(text, /auto-low/);

  const cases = [
    [null, 'attended'],
    ['attended', 'attended'],
    ['auto-medium', 'auto-medium'],
    ['auto-high', 'auto-high'],
  ];
  for (const [tier, expected] of cases) {
    const name = `chain-${tier ?? 'default'}`;
    const definition = chain(ws, CHAIN + (tier === null ? '' : `    with:\n      autonomy: ${tier}\n`), name);
    const run = path.join(ws.root, `.maister/umbrella/runs/2026-01-05-${name}`);
    fs.mkdirSync(run, { recursive: true });
    freeze({ state: path.join(run, 'orchestrator-state.yml') }, { definition });
    const result = umbrella(['envelope', `--run=${run}`, '--node=plan',
      `--ledger=${path.join(ws.root, '.maister/umbrella/ledger')}`, `--root=${ws.root}`], {});
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout).envelope;
    assert.equal(envelope.autonomy, expected, String(tier));
    assert.doesNotMatch(JSON.stringify(envelope), /auto-low/);
  }
});
