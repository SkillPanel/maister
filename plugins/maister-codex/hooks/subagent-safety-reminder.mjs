// Source of the inline `node -e` command in hooks.json (kept path-free there because
// plugin-root variables are not reliably expanded). Keep both in sync when editing.
const payload = {
  hookSpecificOutput: {
    hookEventName: 'SubagentStart',
    additionalContext: 'MAISTER SUBAGENT SAFETY: Stay within the assigned role, files, and output contract. Preserve unrelated work. Do not run git stash, git reset --hard, git clean, force-push, broad recursive deletion, or any rollback/discard operation. Return concrete evidence and unresolved blockers to the parent agent.',
  },
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
