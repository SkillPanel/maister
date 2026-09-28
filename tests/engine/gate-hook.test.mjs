import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT } from '../helpers.mjs';
import { engineInvocation } from '../../plugins/maister/hooks/gate-lib.mjs';

// The gate hook answers for the engine's own shell calls by reading the
// command text, and an answer is an allow that skips the operator's prompt. So
// what it recognises has to be exactly one engine call as the shell will run
// it — never a command the shell reads differently. These cases pin the forms
// the shipped prose tells a session to use, and the shapes that must not pass
// for one of them.
const PLUGIN_ROOT = fs.realpathSync(path.join(ROOT, 'plugins/maister'));
process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
delete process.env.MAISTER_PLUGIN_ROOT;

const ENGINE = '${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs';
const ABSOLUTE = `${PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs`;
const UMBRELLA = '${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs';
const STATE = '.maister/tasks/development/2026-09-28-sample/orchestrator-state.yml';
const bash = command => engineInvocation({ tool: 'Bash', kind: 'opaque', target: command });

/**
 * The table. `MARK` stands for a file a smuggled command would create; each
 * case is run through the recogniser, and — where a POSIX shell is at hand —
 * through that shell with `node` stubbed, so every accepted case is shown to
 * be one engine call and nothing else.
 */
const CASES = [
  // The forms the shipped prose documents.
  { name: 'the documented heredoc write, relative state path', verb: 'write-state', command: [
    `node ${ENGINE} write-state --state=${STATE} <<'JSON'`,
    `{"node_summaries": {"intake": {"summary": "The operator's note; kept as $(typed) | verbatim & \`whole\` \\\\ \\"q\\""}}}`,
    'JSON',
  ].join('\n') },
  { name: 'the heredoc write through an absolute plugin root', verb: 'write-state', command: [
    `node ${ABSOLUTE} write-state --state=/tmp/run/orchestrator-state.yml <<'JSON'`,
    '{}',
    'JSON',
  ].join('\n') },
  { name: 'the unbraced root variable', verb: 'write-state', command: [
    'node $CLAUDE_PLUGIN_ROOT/skills/workflow-engine/scripts/workflow.mjs write-state --state=/tmp/x.yml <<\'JSON\'',
    '{}',
    'JSON',
  ].join('\n') },
  { name: 'a heredoc with a trailing blank line', verb: 'write-state', command: `node ${ENGINE} write-state --state=${STATE} <<'JSON'\n{}\nJSON\n` },
  { name: 'a CRLF heredoc, read by the shell with a CR in its tag', verb: 'write-state', command: `node ${ENGINE} write-state --state=${STATE} <<'JSON'\r\n{}\r\nJSON\r\n` },
  { name: 'gate-brief with --state and --node', verb: 'gate-brief', command: `node ${ENGINE} gate-brief --state=${STATE} --node=gap-approval` },
  { name: 'gate-brief --oneline', verb: 'gate-brief', command: `node ${ENGINE} gate-brief --state=${STATE} --node=gap-approval --oneline` },
  { name: 'sync-plan with the plan path', verb: 'sync-plan', command: `node ${ENGINE} sync-plan --plan=.maister/tasks/development/2026-09-28-sample/implementation/implementation-plan.md` },
  { name: 'prior-context with an absolute state path', verb: 'prior-context', command: `node ${ABSOLUTE} prior-context --state=/Users/x/.maister/tasks/research/2026-01-05-a/orchestrator-state.yml` },
  { name: 'resolve with a definition under the root variable', verb: 'resolve', command: `node ${ENGINE} resolve --definition=\${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/workflows/development.yml` },
  { name: 'a state path with a space, single-quoted', verb: 'write-state', command: [
    `node ${ENGINE} write-state --state='/tmp/my run/orchestrator-state.yml' <<'JSON'`,
    '{}',
    'JSON',
  ].join('\n') },
  { name: 'the umbrella runtime, space-separated flag', verb: 'validate', command: `node ${UMBRELLA} validate --root /tmp/workspace` },
  { name: 'the umbrella runtime, a boolean flag', verb: 'init', command: `node ${UMBRELLA} init --root=/tmp/workspace --force` },
  { name: 'a dispatched worker\'s gate-request, as its seed spells it', verb: 'gate-request', command: [
    `node ${ABSOLUTE} gate-request --state=/Users/x/member/.maister/tasks/development/2026-01-05-a/orchestrator-state.yml <<'JSON'`,
    '{"node": "spec-approval", "question": "Approve the spec?"}',
    'JSON',
  ].join('\n') },
  { name: 'a dispatched worker\'s outbox write, as its seed spells it', verb: 'outbox', command: [
    `node ${PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs outbox --outbox=/Users/x/workspace/.maister/outbox --dispatch-id=2026-01-05-a-review-1 --type=closeout <<'JSON'`,
    '{"grade": "done", "commits": [], "prs": []}',
    'JSON',
  ].join('\n') },
  { name: 'the single-quoted echo pipe', verb: 'write-state', command: `echo '{"a": "b; c | d"}' | node ${ENGINE} write-state --state=/tmp/run/orchestrator-state.yml` },

  // C1: a heredoc tag the shell never reads as one.
  { name: 'C1 an unclosed double quote swallows the tag', command: [
    `node ${ENGINE} write-state "x <<'JSON'`,
    '"; touch MARK',
    'JSON',
  ].join('\n') },
  { name: 'C1 an escaped apostrophe opens the quote instead', command: [
    `node ${ENGINE} write-state \\'x' <<'JSON'`,
    "'; touch MARK",
    'JSON',
  ].join('\n') },
  { name: 'C1 a comment hides the tag', command: [
    `node ${ENGINE} write-state --state=/x # <<'JSON'`,
    'touch MARK',
    'JSON',
  ].join('\n') },

  // C2: single-quote masking fooled by double quotes and backslashes.
  { name: 'C2 an apostrophe inside double quotes', command: `node ${ENGINE} write-state "'" ; touch MARK ; "'"` },
  { name: 'C2 backslash-escaped apostrophes', command: `node ${ENGINE} write-state \\'x;touch MARK;\\'` },
  { name: 'C2 the echo producer', command: `echo "'" ; touch MARK ; "'" | node ${ENGINE} write-state --state=/tmp/x.yml` },

  // Shapes that were already refused, pinned.
  { name: 'a command after the terminator', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<'JSON'\n{}\nJSON\ntouch MARK` },
  { name: 'the tag repeated inside the body', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<'JSON'\n{}\nJSON\ntouch MARK\nJSON` },
  { name: 'two heredocs', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<'A' <<'JSON'\n{}\nA\ntouch MARK\nJSON` },
  { name: 'an unquoted tag', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<JSON\n{"s": "$(touch MARK)"}\nJSON` },
  { name: 'a double-quoted tag', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<"JSON"\n{"s": "$(touch MARK)"}\nJSON` },
  { name: 'a dash heredoc', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<-'JSON'\n{}\nJSON` },
  { name: 'a pipe after the tag', command: `node ${ENGINE} write-state --state=/tmp/x.yml <<'JSON' | sh\ntouch MARK\nJSON` },
  { name: 'a heredoc and an echo pipe together', command: `echo '{}' | node ${ENGINE} write-state --state=/tmp/x.yml <<'JSON'\n{}\nJSON` },
  { name: 'a second command on a new line', command: `node ${ENGINE} prior-context --state=/tmp/x.yml\ntouch MARK` },
  { name: 'a command substitution in a flag', command: `node ${ENGINE} write-state --state=$(touch MARK)` },
  { name: 'a backtick substitution in a flag', command: `node ${ENGINE} write-state --state=\`touch MARK\`` },
  { name: 'a semicolon', command: `node ${ENGINE} write-state --state=/tmp/x.yml; touch MARK` },
  { name: 'an and-list', command: `node ${ENGINE} write-state --state=/tmp/x.yml && touch MARK` },
  { name: 'a background job', command: `node ${ENGINE} write-state --state=/tmp/x.yml & touch MARK` },
  { name: 'a redirection', command: `node ${ENGINE} write-state --state=/tmp/x.yml > MARK` },
  { name: 'a double-quoted value', command: `node ${ENGINE} write-state --state="/tmp/x.yml"` },
  { name: 'a backslash in a value', command: `node ${ENGINE} write-state --state=/tmp/a\\ b.yml` },
  { name: 'a line continuation', command: `node ${ENGINE} write-state --state=/tmp/x.yml \\\n; touch MARK` },
  { name: 'a glob', command: `node ${ENGINE} write-state --state=/tmp/*.yml` },
  { name: 'a variable other than the plugin root', command: `node ${ENGINE} write-state --state=$HOME/x.yml` },
  { name: 'a variable whose name only starts like the root', command: 'node $CLAUDE_PLUGIN_ROOTX/skills/workflow-engine/scripts/workflow.mjs write-state --state=/tmp/x.yml' },
  { name: 'an assignment before node', command: `NODE_OPTIONS=--require=/tmp/x.js node ${ENGINE} write-state --state=/tmp/x.yml` },
  { name: 'a node option before the script', command: `node --require=/tmp/x.js ${ENGINE} write-state --state=/tmp/x.yml` },
  { name: 'a printf producer', command: `printf '{}' | node ${ENGINE} write-state --state=/tmp/x.yml` },
  { name: 'an echo producer with two arguments', command: `echo '{}' '{}' | node ${ENGINE} write-state --state=/tmp/x.yml` },
  { name: 'an or-list after an echo', command: `echo '{}' || node ${ENGINE} write-state --state=/tmp/x.yml` },
  { name: 'a verb the engine does not own', command: `node ${ENGINE} rm --state=/tmp/x.yml` },
  { name: 'a newline inside a single-quoted flag', command: `node ${ENGINE} write-state --state='/tmp/x\ntouch MARK'` },
];

for (const { name, command, verb = null } of CASES) {
  test(`gate hook: ${verb ? 'recognises' : 'refuses'} ${name}`, () => {
    const result = bash(command.replaceAll('MARK', '/tmp/maister-gate-hook-mark'));
    assert.equal(result?.verb ?? null, verb, JSON.stringify(result));
    if (verb) assert.equal(result.root, PLUGIN_ROOT);
  });
}

// PowerShell has no heredoc, and it reads four more characters as a single
// quote than a POSIX shell does.
const powershell = command => engineInvocation({ tool: 'powershell', kind: 'opaque', target: command });

test('gate hook: the PowerShell echo pipe with a doubled apostrophe is recognised', () => {
  const result = powershell(`echo '{"summary": "the operator''s note; kept"}' | node ${ABSOLUTE} write-state --state=/tmp/x.yml`);
  assert.equal(result?.verb, 'write-state');
});

test('gate hook: a typographic quote, which PowerShell reads as an apostrophe, is refused', () => {
  const command = `echo '{"summary": "it’s; touch MARK; ‘"}' | node ${ABSOLUTE} write-state --state=/tmp/x.yml`;
  assert.equal(powershell(command), null);
});

test('gate hook: a heredoc is never lifted off a PowerShell command', () => {
  const command = `node ${ABSOLUTE} write-state --state=/tmp/x.yml <<'JSON'\n{}\nJSON`;
  assert.equal(powershell(command), null);
  assert.equal(bash(command)?.verb, 'write-state');
});

/**
 * The shells a Bash tool may hand the command to. The recogniser's accept set
 * has to sit inside what each of them runs as one engine call, so each accepted
 * case is run for real with `node` stubbed and a smuggled command left a mark
 * to find.
 */
const SHELLS = ['bash', 'zsh'].filter(shell => spawnSync(shell, ['-c', 'exit 0']).status === 0);

test('gate hook: every recognised command runs as exactly one engine call in each POSIX shell at hand', t => {
  if (SHELLS.length === 0) return t.skip('no POSIX shell on this machine');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-gate-hook-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const bin = path.join(scratch, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$NODE_LOG"\ncat > /dev/null\n', { mode: 0o755 });

  const verdicts = [];
  for (const { name, command } of CASES) {
    const mark = path.join(scratch, 'mark');
    const concrete = command.replaceAll('MARK', mark);
    const recognised = bash(concrete) !== null;
    for (const shell of SHELLS) {
      const log = path.join(scratch, 'node.log');
      fs.rmSync(log, { force: true });
      fs.rmSync(mark, { force: true });
      spawnSync(shell, ['-c', concrete], {
        cwd: scratch,
        input: '',
        env: { PATH: `${bin}:/usr/bin:/bin`, NODE_LOG: log, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, HOME: scratch },
      });
      const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      const single = calls.length === 1 && !fs.existsSync(mark) && calls[0].startsWith(`${PLUGIN_ROOT}/skills/`);
      if (recognised && !single) verdicts.push(`${shell}: ${name} is recognised but runs ${JSON.stringify(calls)}${fs.existsSync(mark) ? ' and left the mark' : ''}`);
    }
  }
  assert.deepEqual(verdicts, []);
});
