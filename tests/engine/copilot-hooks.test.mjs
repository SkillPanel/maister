import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The hooks each host runs, in the output shape each host reads. Claude Code
// reads a SessionStart's context and a PreToolUse's decision under
// hookSpecificOutput; GitHub Copilot CLI reads them only at the top level and
// drops the wrapper. The source scripts carry Claude Code's shape and the
// generated variant's copies Copilot's, so both trees are run here.

const SOURCE = path.join(ROOT, 'plugins/maister/hooks');
const VARIANT = path.join(ROOT, 'plugins/maister-copilot/hooks');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const hasJq = hasBash && spawnSync('bash', ['-c', 'command -v jq']).status === 0;

function hook(dir, script, input) {
  const result = spawnSync('bash', [path.join(dir, script)], { input: JSON.stringify(input), encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

const guard = (dir, agent, command) => hook(dir, 'block-destructive-commands.sh', {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent ? { agent_type: agent } : {}),
});

test('session-start reminder: Claude Code shape in the source, with the source names', { skip: !hasBash && 'no bash' }, () => {
  const { code, json } = hook(SOURCE, 'skill-invocation-reminder.sh', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(code, 0);
  assert.equal(json.hookSpecificOutput.hookEventName, 'SessionStart');
  const context = json.hookSpecificOutput.additionalContext;
  assert.match(context, /When any \/maister:\* command appears/);
  assert.match(context, /invoke AskUserQuestion at every/);
  assert.equal(json.additionalContext, undefined, 'no top-level key Claude Code does not document');
});

test('session-start reminder: Copilot shape in the variant, with the variant names', { skip: !hasBash && 'no bash' }, () => {
  const { code, json } = hook(VARIANT, 'skill-invocation-reminder.sh', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(code, 0);
  assert.equal(json.hookSpecificOutput, undefined, 'Copilot drops the wrapper');
  const context = json.additionalContext;
  assert.match(context, /When any \/maister-copilot:\* command appears/);
  assert.match(context, /via the skill tool/);
  assert.match(context, /invoke ask_user at every/);
  assert.match(context, /\(autopilot \/ allow-all\)/);
  assert.doesNotMatch(context, /\/maister:|AskUserQuestion|bypassPermissions/);
});

for (const [tree, dir, decisionOf] of [
  ['source', SOURCE, json => json?.hookSpecificOutput?.permissionDecision],
  ['variant', VARIANT, json => json?.permissionDecision],
]) {
  test(`guard (${tree}): the main agent is let through`, { skip: !hasBash && 'no bash' }, () => {
    const result = guard(dir, null, 'git stash');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
  });

  test(`guard (${tree}): a subagent's destructive command is denied in the host's shape`, { skip: !hasJq && 'no jq' }, () => {
    for (const agent of ['task-group-implementer', 'maister:task-group-implementer', 'maister-copilot:task-group-implementer']) {
      const result = guard(dir, agent, 'git stash list');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(decisionOf(result.json), 'deny', `${agent}: ${result.stdout}`);
    }
  });

  test(`guard (${tree}): a whitelisted agent is let through under its plugin-scoped name too`, { skip: !hasBash && 'no bash' }, () => {
    for (const agent of ['docs-operator', 'maister:docs-operator', 'maister-copilot:test-suite-runner']) {
      const result = guard(dir, agent, 'git stash');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '', agent);
    }
  });

  test(`guard (${tree}): a subagent's ordinary command is let through`, { skip: !hasJq && 'no jq' }, () => {
    const result = guard(dir, 'maister-copilot:code-reviewer', 'git status');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
  });
}

test('variant hooks.json registers only scripts it ships, no hooks module and no compact-only start', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(VARIANT, 'hooks.json'), 'utf8'));
  assert.equal(registry.modules, undefined);
  const groups = Object.values(registry.hooks).flat();
  assert.ok(groups.every(group => group.matcher !== 'compact'), 'Copilot applies no SessionStart matcher, so a compact-only hook would run at every start');
  const commands = groups.flatMap(group => group.hooks).map(entry => entry.command);
  assert.ok(commands.length > 0);
  for (const command of commands) {
    const script = command.match(/hooks\/([A-Za-z0-9_.-]+)/)?.[1];
    assert.ok(script && fs.existsSync(path.join(VARIANT, script)), `${command} names a shipped script`);
    assert.match(command, /^bash "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//, 'run by an explicit interpreter from the plugin root');
  }
  for (const dropped of ['display.mjs', 'post-compact-reminder.sh', 'edition-check.mjs']) {
    assert.ok(!fs.existsSync(path.join(VARIANT, dropped)), `${dropped} is not shipped`);
  }
});
