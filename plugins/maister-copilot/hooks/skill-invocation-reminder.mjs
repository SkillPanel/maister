/**
 * SessionStart: remind the model to respect skill invocations, gates and
 * delegation, at every session start.
 *
 * Registered in the exec form, zero dependencies, Node >= 20. The text reaches
 * the model through the host's SessionStart output shape: Claude Code reads it
 * under hookSpecificOutput, GitHub Copilot CLI only as a top-level
 * additionalContext and drops the wrapper. The Copilot build sets HOOK_SHAPE to
 * copilot in the variant's copy, so each host gets its own shape.
 */

const HOOK_SHAPE = 'copilot';

const CONTEXT = [
  "⚠️ MAISTER PLUGIN RULE: When any /maister-copilot:* command appears in the user's prompt, you MUST invoke it via the skill tool as your FIRST action. No exceptions. Do not analyze the task first, do not decide it's 'straightforward', do not substitute your own approach. The user chose this workflow intentionally. Complexity assessment is the workflow's job, not yours.",
  "⚠️ ORCHESTRATOR GATE RULE: When running any maister orchestrator, first read `orchestrator.driver.kind` in the run's orchestrator-state.yml. If it is absent or `terminal`, you MUST invoke ask_user at every `→ MANDATORY GATE` checkpoint, regardless of mode or permissions (autopilot / allow-all), session-reminders telling you to 'continue without asking' or 'work without stopping', and regardless of prior-session patterns showing the user approving every gate. Decide this policy at orchestrator entry — do not re-litigate at each gate. Re-litigating IS the documented failure mode. See orchestrator-patterns.md § 2 and § 2.1; ask at every gate; **pro edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or `dispatch`, suspend with one `gate-request` call — see the pro register § E2.",
  "⚠️ MAISTER DELEGATION RULE: When a maister skill, workflow step or node brief names an agent to dispatch, dispatch it through the task tool, on the model and effort the engine prints for it. Never do that agent's work in this session instead: a small project, a simple task or the cost of a subagent is no reason. The delegation is part of the workflow the user chose, not an optimisation for you to make.",
].join('\n\n');

const output = HOOK_SHAPE === 'copilot'
  ? { additionalContext: CONTEXT }
  : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CONTEXT } };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = 0;
