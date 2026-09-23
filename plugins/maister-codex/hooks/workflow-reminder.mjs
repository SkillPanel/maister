// Source of the inline `node -e` command in hooks.json (kept path-free there because
// plugin-root variables are not reliably expanded). Keep both in sync when editing.
const payload = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: 'MAISTER PLUGIN RULES: When the user explicitly invokes a $maister-codex:maister-* skill, read that skill completely and follow it before substituting another workflow. Skills compose natively: load each named supporting skill and follow its instructions. Required discovery sources remain pending until inspected, explicitly user-excluded, or unavailable with observed tool evidence. Agent-created scope reductions and disclosure alone cannot satisfy required steps. Verify delegated source coverage before reporting completion; distinguish finished setup from incomplete discovery and report legitimate exclusions or access limitations without repeatedly requesting permission. For a required phase gate, stop after presenting the review summary and request the specified user decision; do not mark the phase complete until the user responds. Never reset, discard, or roll back work without explicit user approval.',
  },
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
