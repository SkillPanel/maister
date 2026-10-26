import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { umbrella } from '../helpers.mjs';

// `init` settles the two manifest values a workspace is registered by:
// `git_host.kind`, from --git-host or else from the members' remotes when they
// agree, and `defaults.provider`, from --provider only. Whatever it cannot
// settle stays unset as before and is named in the report's `unset`.

/** An empty workspace root. */
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-umbrella-init-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A member checkout under `projects/`, with each remote url as given. */
function member(dir, name, urls = []) {
  const checkout = path.join(dir, 'projects', name);
  fs.mkdirSync(checkout, { recursive: true });
  const commands = [['init', '-q'], ...urls.map((url, i) => ['remote', 'add', i === 0 ? 'origin' : `r${i}`, url])];
  for (const args of commands) {
    const run = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
}

function init(dir, ...flags) {
  const result = umbrella(['init', `--root=${dir}`, ...flags]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

function manifest(dir) {
  return fs.readFileSync(path.join(dir, '.maister/umbrella.yml'), 'utf8');
}

test('init: --provider and --git-host are both written, and the manifest validates clean', (t) => {
  const dir = root(t);
  member(dir, 'api');
  const { code, report } = init(dir, '--provider=claude', '--git-host=gitlab');
  assert.equal(code, 0, JSON.stringify(report));
  const text = manifest(dir);
  assert.match(text, /^git_host:\n {2}kind: gitlab$/m);
  assert.match(text, /^defaults:\n(?: {2}.*\n)* {2}provider: claude$/m);
  assert.deepEqual(report.unset, []);
  assert.equal(report.git_host.source, 'flag');
  assert.equal(report.provider.source, 'flag');
  const validated = umbrella(['validate', `--root=${dir}`]);
  assert.equal(validated.code, 0, validated.stdout);
  assert.deepEqual(JSON.parse(validated.stdout).warnings, []);
});

test('init: a github.com remote on every member settles git_host.kind as github', (t) => {
  const dir = root(t);
  member(dir, 'api', ['git@github.com:acme/api.git']);
  member(dir, 'web', ['https://github.com/acme/web.git']);
  const { code, report } = init(dir, '--provider=copilot');
  assert.equal(code, 0, JSON.stringify(report));
  assert.match(manifest(dir), /^git_host:\n {2}kind: github$/m);
  assert.equal(report.git_host.source, 'detected');
  assert.equal(report.git_host.detected.remotes.length, 2);
  assert.deepEqual(report.unset, []);
});

test('init: a self-managed gitlab host is read as gitlab, and a local-path remote is passed over', (t) => {
  const dir = root(t);
  member(dir, 'api', ['ssh://git@gitlab.example.com:2222/acme/api.git', path.join(dir, 'mirror.git')]);
  const { report } = init(dir);
  assert.equal(report.git_host.kind, 'gitlab');
  assert.equal(report.git_host.detected.remotes.length, 1);
});

test('init: disagreeing remotes leave git_host.kind unset without the flag', (t) => {
  const dir = root(t);
  member(dir, 'api', ['git@github.com:acme/api.git']);
  member(dir, 'web', ['git@gitlab.com:acme/web.git']);
  const { code, report } = init(dir, '--provider=claude');
  assert.equal(code, 0, JSON.stringify(report));
  assert.match(manifest(dir), /^git_host:\n {2}kind: null$/m);
  assert.equal(report.git_host.detected.reason, 'remotes-disagree');
  assert.deepEqual(report.unset.map((each) => [each.path, each.reason]), [['git_host.kind', 'remotes-disagree']]);
});

test('init: disagreeing remotes take git_host.kind from the flag', (t) => {
  const dir = root(t);
  member(dir, 'api', ['git@github.com:acme/api.git']);
  member(dir, 'web', ['git@gitlab.com:acme/web.git']);
  const { report } = init(dir, '--git-host=gitlab');
  assert.match(manifest(dir), /^git_host:\n {2}kind: gitlab$/m);
  assert.equal(report.git_host.source, 'flag');
  assert.equal(report.git_host.detected.reason, 'remotes-disagree');
});

test('init: a remote on a host whose kind cannot be named settles nothing', (t) => {
  const dir = root(t);
  member(dir, 'api', ['https://git.example.org/acme/api.git']);
  const { report } = init(dir);
  assert.equal(report.git_host.kind, null);
  assert.equal(report.git_host.detected.reason, 'host-unknown');
});

test('init: an unknown --provider is refused by name, and nothing is written', (t) => {
  const dir = root(t);
  const { code, report } = init(dir, '--provider=codex');
  assert.equal(code, 1);
  assert.equal(report.errors[0].code, 'umbrella-provider-unknown');
  assert.equal(fs.existsSync(path.join(dir, '.maister')), false);
});

test('init: an unknown --git-host is refused by name, and nothing is written', (t) => {
  const dir = root(t);
  const { code, report } = init(dir, '--git-host=bitbucket');
  assert.equal(code, 1);
  assert.equal(report.errors[0].code, 'umbrella-git-host-unknown');
  assert.equal(fs.existsSync(path.join(dir, '.maister')), false);
});

test('init: no flags and no remotes write today\'s manifest and name both unset values', (t) => {
  const dir = root(t);
  member(dir, 'api');
  const { code, report } = init(dir);
  assert.equal(code, 0, JSON.stringify(report));
  const text = manifest(dir);
  assert.match(text, /^git_host:\n {2}kind: null$/m);
  assert.doesNotMatch(text, /provider/);
  assert.deepEqual(report.unset.map((each) => [each.path, each.reason]),
    [['git_host.kind', 'no-hosted-remote'], ['defaults.provider', 'not-given']]);
  for (const each of report.unset) assert.match(each.message, /is not set/);
  assert.equal(umbrella(['validate', `--root=${dir}`]).code, 0);
});

test('init: --dry-run reports the detected host and the unset values, and writes nothing', (t) => {
  const dir = root(t);
  member(dir, 'api', ['git@github.com:acme/api.git']);
  const { code, report } = init(dir, '--dry-run');
  assert.equal(code, 0, JSON.stringify(report));
  assert.equal(report.dry_run, true);
  assert.equal(report.git_host.kind, 'github');
  assert.deepEqual(report.unset.map((each) => each.path), ['defaults.provider']);
  assert.equal(fs.existsSync(path.join(dir, '.maister')), false);
  assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);
});
