import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE as ENGINE_SCRIPT, freeze, freezePatch, run as runScript, scratch, sibling, verb } from '../helpers.mjs';

const PATCH_FILE = '.state-patch.json';

// A driver writes the patch to one fixed file beside the state with its file
// tool, then names it with `--patch-file`: a JSON heredoc is the command shape
// an agent host's shell-safety checks refuse. The file route has to land what
// stdin lands, byte for byte, read from nowhere else, and leave the file behind
// exactly when the patch did not land.

const patchFile = run => path.join(run.dir, PATCH_FILE);
const put = (run, document) => fs.writeFileSync(patchFile(run), typeof document === 'string' ? document : JSON.stringify(document));
const viaFile = (run, args = [], stdin = undefined) => verb(['write-state', `--state=${run.state}`, `--patch-file=${patchFile(run)}`, ...args], stdin);

/** Every file under a run, with the writer's clock stamps taken out. */
function snapshot(run) {
  const files = {};
  for (const entry of fs.readdirSync(run.dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(run.dir, file)] = fs.readFileSync(file, 'utf8').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<t>');
  }
  return files;
}

test('patch file: the freeze and a later write land exactly what stdin lands', t => {
  const { patch } = freezePatch({ inputs: { ticket: 'ALPHA-42' } });
  const later = { nodes: { analysis: { status: 'running' } }, node_summaries: { analysis: { summary: "The operator's note: $HOME, `ticks`, \\ and \"quotes\"" } } };

  const piped = scratch(t);
  const pipedOut = [verb(['write-state', `--state=${piped.state}`], patch), verb(['write-state', `--state=${piped.state}`], later)];

  const filed = scratch(t);
  put(filed, patch);
  const first = viaFile(filed);
  put(filed, later);
  const second = viaFile(filed);

  for (const [a, b] of [[pipedOut[0], first], [pipedOut[1], second]]) {
    assert.equal(b.code, 0, b.stderr);
    assert.equal(b.code, a.code);
    assert.equal(b.stdout.replaceAll(filed.root, '<root>'), a.stdout.replaceAll(piped.root, '<root>'));
    assert.equal(b.stderr, a.stderr);
  }
  const rooted = (files, root) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.replaceAll(root, '<root>')]));
  assert.deepEqual(rooted(snapshot(filed), filed.root), rooted(snapshot(piped), piped.root));
});

test('patch file: deleted once the patch lands', t => {
  const run = scratch(t);
  freeze(run);
  put(run, { node_summaries: { analysis: { summary: 'done' } } });
  assert.equal(viaFile(run).code, 0);
  assert.equal(fs.existsSync(patchFile(run)), false);
});

test('patch file: kept when the writer refuses the patch, and the state is untouched', t => {
  const run = scratch(t);
  freeze(run);
  const before = fs.readFileSync(run.state, 'utf8');
  put(run, { nodes: { 'no-such-node': { status: 'running' } } });
  const result = viaFile(run);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^state-node-unknown\b/);
  assert.equal(fs.readFileSync(run.state, 'utf8'), before);
  assert.equal(fs.existsSync(patchFile(run)), true, 'a refused patch stays for the caller to correct and re-send');

  put(run, { nodes: { analysis: { status: 'running' } } });
  assert.equal(viaFile(run).code, 0, 'the corrected file, sent again, lands');
  assert.equal(fs.existsSync(patchFile(run)), false);
});

test('patch file: kept when it is not JSON, or empty — usage, nothing ran', t => {
  const run = scratch(t);
  freeze(run);
  for (const [text, message] of [['{"nodes": ', /is not JSON/], ['  \n', /is empty/]]) {
    put(run, text);
    const result = viaFile(run);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^usage: the patch in .*\.state-patch\.json /);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(patchFile(run)), true);
  }
});

test('patch file: stdin is not read when the flag is given', t => {
  const run = scratch(t);
  freeze(run);
  put(run, { node_summaries: { analysis: { summary: 'from the file' } } });
  const result = viaFile(run, [], 'not json at all');
  assert.equal(result.code, 0, result.stderr);
});

test('patch file: an empty object is the sanctioned republish, as on stdin', t => {
  const run = scratch(t);
  freeze(run);
  put(run, {});
  assert.equal(viaFile(run).code, 0);
});

test('patch file: refused anywhere but beside the state, under any other name, through .. or a link', t => {
  const run = scratch(t);
  freeze(run);
  const other = sibling(run, { type: 'development', name: '2026-01-06-other' });
  const before = fs.readFileSync(run.state, 'utf8');
  const document = JSON.stringify({ node_summaries: { analysis: { summary: 'smuggled' } } });
  fs.writeFileSync(path.join(other.dir, PATCH_FILE), document);
  fs.writeFileSync(path.join(run.dir, 'patch.json'), document);
  fs.writeFileSync(path.join(run.root, PATCH_FILE), document);

  const cases = [
    [path.join(other.dir, PATCH_FILE), /must be .*2026-01-05-sample.*\.state-patch\.json/],
    [path.join(run.dir, 'patch.json'), /must be /],
    [path.join(run.root, PATCH_FILE), /must be /],
    [`${run.dir}/../${path.basename(run.dir)}/${PATCH_FILE}`, /parent directory/],
    [path.join(run.dir, PATCH_FILE), /could not be read/],
  ];
  for (const [given, message] of cases) {
    const result = verb(['write-state', `--state=${run.state}`, `--patch-file=${given}`]);
    assert.equal(result.code, 2, `${given}: ${result.stderr}`);
    assert.match(result.stderr, message, given);
  }

  fs.symlinkSync(path.join(other.dir, PATCH_FILE), patchFile(run));
  const linked = viaFile(run);
  assert.equal(linked.code, 2);
  assert.match(linked.stderr, /symbolic link/);
  assert.equal(fs.existsSync(path.join(other.dir, PATCH_FILE)), true, 'a link target is never deleted');

  assert.equal(fs.readFileSync(run.state, 'utf8'), before, 'no refused patch file reached the state');
});

test('patch file: a relative path is judged where it resolves', t => {
  const run = scratch(t);
  freeze(run);
  put(run, { node_summaries: { analysis: { summary: 'relative' } } });
  const args = ['write-state', `--state=${path.join(run.path, 'orchestrator-state.yml')}`, `--patch-file=${path.join(run.path, PATCH_FILE)}`];
  const result = runScript(ENGINE_SCRIPT, args, undefined, {}, run.root);
  assert.equal(result.code, 0, result.stderr);
});

test('patch file: gate-request reads the same file under the same rule', t => {
  const run = scratch(t);
  freeze(run);
  const outside = path.join(run.root, PATCH_FILE);
  fs.writeFileSync(outside, '{}');
  const refused = verb(['gate-request', `--state=${run.state}`, `--patch-file=${outside}`]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /^usage: the patch file must be /);

  // Past the rule, the edition decides: the free build carries no gate module
  // and says so at exit 2, keeping the file; a build that carries it judges the
  // request. Either way the file is gone only when the request landed.
  put(run, { node: 'approval', kind: 'approve', question: 'Proceed?', options: [] });
  const result = verb(['gate-request', `--state=${run.state}`, `--patch-file=${patchFile(run)}`], 'not json');
  assert.equal(fs.existsSync(patchFile(run)), result.code !== 0, result.stderr);
});
