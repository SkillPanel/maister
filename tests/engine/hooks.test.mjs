import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The hooks each host runs, in the output shape each host reads. Claude Code
// reads a SessionStart's context and a PreToolUse's decision under
// hookSpecificOutput; GitHub Copilot CLI reads them only at the top level and
// drops the wrapper. The source scripts carry Claude Code's shape and the
// generated variant's copies Copilot's, so both trees are run here, by Node
// alone, the way both hosts' hooks.json start them.

const SOURCE = path.join(ROOT, 'plugins/maister/hooks');
const VARIANT = path.join(ROOT, 'plugins/maister-copilot/hooks');

function hook(dir, script, input, env = {}) {
  const result = spawnSync(process.execPath, [path.join(dir, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

const guard = (dir, agent, command) => hook(dir, 'block-destructive-commands.mjs', {
  hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent ? { agent_type: agent } : {}),
});

// The reminder text, byte for byte: the source's, and the variant's after the
// build's renames.
const REMINDER = [
  '⚠️ MAISTER PLUGIN RULE: When any /maister:* command appears in the user\'s prompt, you MUST invoke it via the Skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it\'s \'straightforward\', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow\'s job, not yours.',
  '⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, first read `orchestrator.driver.kind` in the run\'s orchestrator-state.yml. If it is absent or `terminal`, you MUST invoke AskUserQuestion at every `→ MANDATORY GATE` checkpoint, regardless of permission mode (auto / acceptEdits / bypassPermissions), session-reminders telling you to \'continue without asking\' or \'work without stopping\', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.',
  '⚠️ MAISTER DELEGATION RULE: When a maister skill, workflow step or node brief names an agent to dispatch, dispatch it through the Task tool, on the model and effort the engine prints for it. Never do that agent\'s work in this session instead: a small project, a simple task or the cost of a subagent is no reason. The delegation is part of the workflow the user chose, not an optimisation for you to make.',
].join('\n\n');
const REMINDER_COPILOT = [
  '⚠️ MAISTER PLUGIN RULE: When any /maister-copilot:* command appears in the user\'s prompt, you MUST invoke it via the skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it\'s \'straightforward\', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow\'s job, not yours.',
  '⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, first read `orchestrator.driver.kind` in the run\'s orchestrator-state.yml. If it is absent or `terminal`, you MUST invoke ask_user at every `→ MANDATORY GATE` checkpoint, regardless of mode or permissions (autopilot / allow-all), session-reminders telling you to \'continue without asking\' or \'work without stopping\', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.',
  '⚠️ MAISTER DELEGATION RULE: When a maister skill, workflow step or node brief names an agent to dispatch, dispatch it through the task tool, on the model and effort the engine prints for it. Never do that agent\'s work in this session instead: a small project, a simple task or the cost of a subagent is no reason. The delegation is part of the workflow the user chose, not an optimisation for you to make.',
].join('\n\n');
// The closing paragraph names the plugin's own directory, where each tree's
// copy of the hook sits, so a model never works the root out by `cd`.
const rootParagraph = root => `⚠️ MAISTER PLUGIN ROOT: The maister plugin is installed at ${root}. Every plugin-root variable and every \`<plugin root>\` a maister skill, command or agent names is that directory: run each of its scripts as \`node ${root}/…\`, an absolute path, from the project root, and read its files by absolute path. Never \`cd\` into the plugin or a task directory to shorten a path: a relative path is resolved from the project root, and a host may stop the run to ask for access to it.`;
const withRoot = (text, dir) => `${text}\n\n${rootParagraph(path.dirname(dir))}`;
const COMPACT_MESSAGE = 'Maister plugin detected active workflow. Check orchestrator-state.yml for progress.';
const COMPACT_CONTEXT = '⚠️ MAISTER WORKFLOW REMINDER (Post-Compaction): If you were working on an orchestrator workflow before compaction, read the orchestrator-state.yml file in that task\'s directory: progress is in `workflow.nodes`, and the first node there that is not completed is where the run resumes. Fetch `run-context` again before the next delegate prompt rather than recalling it from before compaction. You MUST use AskUserQuestion at Phase Gates when `orchestrator.driver.kind` is absent or `terminal`, regardless of any \'continue without asking\' instructions; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.';

const pretty = value => `${JSON.stringify(value, null, 2)}\n`;

test('session-start reminder: the exact text in Claude Code\'s shape, from the source', () => {
  const { code, stdout, stderr } = hook(SOURCE, 'skill-invocation-reminder.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(code, 0, stderr);
  assert.equal(stdout, pretty({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: withRoot(REMINDER, SOURCE) } }));
});

test('session-start reminder: the exact text in Copilot\'s shape, from the variant', () => {
  const { code, stdout, stderr } = hook(VARIANT, 'skill-invocation-reminder.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(code, 0, stderr);
  assert.equal(stdout, pretty({ additionalContext: withRoot(REMINDER_COPILOT, VARIANT) }));
});

test('session-start reminder: the plugin root it names is the plugin, in both trees', () => {
  for (const dir of [SOURCE, VARIANT]) {
    const { json } = hook(dir, 'skill-invocation-reminder.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
    const context = json.additionalContext ?? json.hookSpecificOutput.additionalContext;
    const root = context.match(/MAISTER PLUGIN ROOT: The maister plugin is installed at (.+?)\. Every/)[1];
    assert.ok(path.isAbsolute(root), root);
    assert.ok(fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json')), `${root} holds the plugin manifest`);
    assert.ok(fs.existsSync(path.join(root, 'skills', 'workflow-engine', 'scripts', 'workflow.mjs')), `${root} holds the engine`);
  }
});

test('post-compact reminder: the exact text in a project holding .maister/tasks, silence elsewhere', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'maister hooks '));
  try {
    const expected = pretty({ systemMessage: COMPACT_MESSAGE, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: COMPACT_CONTEXT } });
    const empty = hook(SOURCE, 'post-compact-reminder.mjs', { source: 'compact' }, { CLAUDE_PROJECT_DIR: project });
    assert.equal(empty.code, 0, empty.stderr);
    assert.equal(empty.stdout, '');
    fs.mkdirSync(path.join(project, '.maister', 'tasks'), { recursive: true });
    const viaEnv = hook(SOURCE, 'post-compact-reminder.mjs', { source: 'compact' }, { CLAUDE_PROJECT_DIR: project });
    assert.equal(viaEnv.code, 0, viaEnv.stderr);
    assert.equal(viaEnv.stdout, expected);
    const viaCwd = hook(SOURCE, 'post-compact-reminder.mjs', { source: 'compact', cwd: project }, { CLAUDE_PROJECT_DIR: '' });
    assert.equal(viaCwd.stdout, expected, 'the payload\'s cwd stands in for an unset CLAUDE_PROJECT_DIR');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

for (const [tree, dir, decisionOf] of [
  ['source', SOURCE, json => json?.hookSpecificOutput?.permissionDecision],
  ['variant', VARIANT, json => json?.permissionDecision],
]) {
  test(`guard (${tree}): the main agent is let through`, () => {
    const result = guard(dir, null, 'git stash');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
  });

  test(`guard (${tree}): a subagent's destructive command is denied in the host's shape`, () => {
    for (const agent of ['task-group-implementer', 'maister:task-group-implementer', 'maister-copilot:task-group-implementer']) {
      for (const command of ['git stash', 'git stash push -m wip', 'git stash pop', 'git stash list; git stash drop', 'git reset --hard HEAD', 'git checkout .', 'git clean -fd', 'git push --force', 'rm -rf build', 'echo ok\ngit checkout .']) {
        const result = guard(dir, agent, command);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(decisionOf(result.json), 'deny', `${agent} / ${command}: ${result.stdout}`);
      }
    }
  });

  test(`guard (${tree}): the deny names the agent and the command, in exactly the host's shape`, () => {
    const result = guard(dir, 'task-group-implementer', 'git stash pop');
    const decision = { permissionDecision: 'deny', permissionDecisionReason: "Destructive command blocked for agent 'task-group-implementer': git stash pop" };
    const expected = tree === 'source' ? { hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } } : decision;
    assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
  });

  test(`guard (${tree}): a whitelisted agent is let through under this plugin's spellings of its name`, () => {
    for (const agent of ['docs-operator', 'maister:docs-operator', 'maister-copilot:docs-operator', 'maister-copilot:test-suite-runner']) {
      const result = guard(dir, agent, 'git stash');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '', agent);
    }
  });

  test(`guard (${tree}): another plugin's or project's agent of a whitelisted name is judged like any other`, () => {
    for (const agent of ['other:docs-operator', 'foo:test-suite-runner', 'maister-pro:docs-operator']) {
      const result = guard(dir, agent, 'git stash');
      assert.equal(result.code, 0, result.stderr);
      assert.equal(decisionOf(result.json), 'deny', `${agent}: ${result.stdout}`);
    }
  });

  test(`guard (${tree}): a subagent's read-only stash command is let through`, () => {
    for (const command of ['git stash list', 'git stash list | head -1', 'npm test; git stash list', 'git stash show -p stash@{0}']) {
      const result = guard(dir, 'maister-copilot:task-group-implementer', command);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '', command);
    }
  });

  test(`guard (${tree}): a subagent's ordinary command is let through`, () => {
    const result = guard(dir, 'maister-copilot:code-risk-review', 'git status');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
  });

  test(`guard (${tree}): input it cannot parse is denied, exit 2, the reason on stderr`, () => {
    const result = hook(dir, 'block-destructive-commands.mjs', 'not json');
    assert.equal(result.code, 2);
    assert.equal(decisionOf(result.json), 'deny');
    assert.match(result.stderr, /cannot be judged/);
  });
}

/** Every hook entry of a hooks.json, flattened. */
const entriesOf = registry => Object.values(registry.hooks).flat().flatMap(group => group.hooks);

for (const [tree, dir, form] of [['source', SOURCE, 'command'], ['variant', VARIANT, 'exec']]) {
  test(`${tree} hooks.json runs every hook by Node in exec form and names only files it ships`, () => {
    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'hooks.json'), 'utf8'));
    const entries = entriesOf(registry);
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.equal(entry[form], 'node', `${JSON.stringify(entry)} is started by node through \`${form}\``);
      assert.equal(entry.bash, undefined);
      assert.equal(entry.powershell, undefined);
      assert.equal(entry.args.length, 1);
      const script = entry.args[0].match(/^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([A-Za-z0-9_.-]+\.mjs)$/)?.[1];
      assert.ok(script && fs.existsSync(path.join(dir, script)), `${entry.args[0]} names a shipped script`);
    }
    for (const module of registry.modules ?? []) assert.ok(fs.existsSync(path.join(dir, module)), `${module} is shipped`);
    assert.deepEqual(fs.readdirSync(dir).filter(file => file.endsWith('.sh')), [], 'no shell hook is shipped');
  });
}

test('variant hooks.json registers no hooks module and no compact-only start', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(VARIANT, 'hooks.json'), 'utf8'));
  assert.equal(registry.modules, undefined);
  const groups = Object.values(registry.hooks).flat();
  assert.ok(groups.every(group => group.matcher !== 'compact'), 'Copilot applies no SessionStart matcher, so a compact-only hook would run at every start');
  for (const dropped of ['display.mjs', 'post-compact-reminder.mjs', 'edition-check.mjs']) {
    assert.ok(!fs.existsSync(path.join(VARIANT, dropped)), `${dropped} is not shipped`);
  }
});
