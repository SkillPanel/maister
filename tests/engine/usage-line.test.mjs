import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { verb } from '../helpers.mjs';

// A usage error prints its own line first and then the verb's whole usage
// line, so a caller fixes every flag in one retry instead of meeting them one
// refusal at a time. The exit code stays 2: nothing ran.

const INTERFACE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'plugins', 'maister', 'interface.json'), 'utf8'));

function lines(result) {
  return result.stderr.split(/\r?\n/).filter(line => line !== '');
}

const IMPORT_USAGE = /^usage: workflow\.mjs import --state=\S+ --to=<[^>]+> --from=<[^>]+>… \[--as=<[^>]+>, with one --from\]$/;

test('usage: import with no flags names the missing flag first, then every flag import takes', () => {
  const result = verb(['import']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  const [first, second, ...rest] = lines(result);
  assert.equal(first, 'usage: import needs --state');
  assert.match(second, IMPORT_USAGE);
  assert.deepEqual(rest, []);
});

test('usage: import with a flag it does not take names that flag first, then the same usage line', () => {
  const result = verb(['import', '--state=x', '--name=y']);
  assert.equal(result.code, 2);
  const [first, second, ...rest] = lines(result);
  assert.equal(first, 'usage: the verb import takes no --name flag');
  assert.match(second, IMPORT_USAGE);
  assert.deepEqual(rest, []);
});

test('usage: a flag missing its value after the verb still gets the verb\'s usage line', () => {
  const result = verb(['gate-brief', '--state']);
  assert.equal(result.code, 2);
  const [first, second] = lines(result);
  assert.equal(first, 'usage: the flag --state needs a value');
  assert.match(second, /^usage: workflow\.mjs gate-brief --state=\S+ --node=<[^>]+> \[--oneline \| --json /);
});

test('usage: a missing required flag of another verb prints that verb\'s usage line', () => {
  const result = verb(['node-brief', '--state=x']);
  assert.equal(result.code, 2);
  const [first, second, ...rest] = lines(result);
  assert.equal(first, 'usage: node-brief needs --node');
  assert.equal(second, 'usage: workflow.mjs node-brief --state=<orchestrator-state.yml> --node=<node about to run>');
  assert.deepEqual(rest, []);
});

test('usage: no verb, or an unknown one, lists the verbs and prints no usage line', () => {
  for (const args of [[], ['nowhere']]) {
    const result = verb(args);
    assert.equal(result.code, 2, args.join(' '));
    assert.equal(lines(result).length, 1, result.stderr);
    assert.doesNotMatch(result.stderr, /workflow\.mjs/);
  }
});

// The sweep: every verb the interface file lists prints a usage line naming
// every flag it takes, so a flag added to a verb cannot be left out of it.
test('usage: every verb\'s usage line names every flag the verb takes', () => {
  const verbs = Object.entries(INTERFACE.engine?.verbs ?? INTERFACE.verbs ?? {});
  assert.ok(verbs.length > 20, 'the interface file lists the engine verbs');
  for (const [name, { flags }] of verbs) {
    const result = verb([name, '--no-such-flag=1']);
    assert.equal(result.code, 2, name);
    const [first, second] = lines(result);
    assert.equal(first, `usage: the verb ${name} takes no --no-such-flag flag`);
    assert.ok(second?.startsWith(`usage: workflow.mjs ${name} `), `${name}: ${result.stderr}`);
    for (const flag of flags) {
      assert.match(second, new RegExp(`--${flag}(?![\\w-])`), `${name}'s usage line names --${flag}`);
    }
  }
});
