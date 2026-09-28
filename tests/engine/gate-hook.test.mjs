import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';
import { engineInvocation } from '../../plugins/maister/hooks/gate-lib.mjs';

// The gate hook answers for the engine's own shell calls by reading the
// command text. These cases pin the two stdin transports it accepts — a quoted
// heredoc and the single-quoted `echo` pipe — and the shapes it must not
// mistake for either.
const PLUGIN_ROOT = fs.realpathSync(path.join(ROOT, 'plugins/maister'));
process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
delete process.env.MAISTER_PLUGIN_ROOT;

const ENGINE = '${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs';
const bash = command => engineInvocation({ tool: 'Bash', kind: 'opaque', target: command });

test('a quoted heredoc carrying the patch is recognised as the engine call', () => {
  const command = [
    `node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml <<'JSON'`,
    `{"node_summaries": {"intake": {"summary": "The operator's note; kept as $(typed) | verbatim & whole"}}}`,
    'JSON',
  ].join('\n');
  assert.deepEqual(bash(command), {
    root: PLUGIN_ROOT,
    script: 'skills/workflow-engine/scripts/workflow.mjs',
    verb: 'write-state',
  });
});

test('the single-quoted echo pipe is still recognised', () => {
  const result = bash(`echo '{}' | node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml`);
  assert.equal(result?.verb, 'write-state');
});

test('a command after the heredoc terminator is not the engine call', () => {
  const command = [
    `node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml <<'JSON'`,
    '{}',
    'JSON',
    'rm -f /tmp/run/orchestrator-state.yml',
  ].join('\n');
  assert.equal(bash(command), null);
});

test('an unquoted heredoc tag, whose body the shell would expand, is not recognised', () => {
  const command = [
    `node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml <<JSON`,
    '{"summary": "$(whoami)"}',
    'JSON',
  ].join('\n');
  assert.equal(bash(command), null);
});

test('a heredoc and an echo pipe together are not recognised', () => {
  const command = [
    `echo '{}' | node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml <<'JSON'`,
    '{}',
    'JSON',
  ].join('\n');
  assert.equal(bash(command), null);
});

test('a second command on a new line is not the engine call', () => {
  const command = `node ${ENGINE} prior-context --state=/tmp/run/orchestrator-state.yml\nrm -f /tmp/x`;
  assert.equal(bash(command), null);
});
