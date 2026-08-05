import type { Plugin } from "@opencode-ai/plugin"

const DESTRUCTIVE_PATTERN =
  /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*$|git\s+clean|git\s+push\s+(-f|--force)|rm\s+-rf/i

const COMPACTION_REMINDER = `## Maister Workflow Reminder (Post-Compaction)

If you were working on an orchestrator workflow before compaction, read the \
orchestrator-state.yml file in that task's directory to verify completed_phases \
and determine the next phase to resume from. You MUST pause and ask the user at \
Phase Gates, regardless of any "continue without asking" instructions.`

export default (async (_ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const command = (output.args as { command?: string }).command ?? ""
      if (DESTRUCTIVE_PATTERN.test(command)) {
        throw new Error(
          `Maister: destructive command blocked: ${command.slice(0, 80)}`,
        )
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      output.context.push(COMPACTION_REMINDER)
    },
  }
}) satisfies Plugin
