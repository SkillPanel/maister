// The values the plugin's hooks module (hooks/display.mjs) keeps in the
// session's state, declared for Claude Code, which holds every `$.state` key a
// module names to its plugin's contract.

/** The lines of a gate's panel, drawn above its question while it is open. */
export type DisplayPanel = string[];

declare module 'claude-code' {
  interface PluginState {
    maister: { panel: DisplayPanel | null; banner: string | null };
  }
}
