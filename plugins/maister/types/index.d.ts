// The values the plugin's hooks module (hooks/display.mjs) keeps in the
// session's state, declared for Claude Code, which holds every `$.state` key a
// module names to its plugin's contract. The display files' own fields are the
// engine's (`skills/workflow-engine/scripts/lib/display-files.mjs`); these
// types name only what the module reads of them.

/** One labelled part of a gate's panel, as `display/next.json` holds it. */
export type DisplayPart = {
  key: string;
  label: string;
  text?: string;
  risks?: string;
  open?: number;
  count?: number;
  files?: Array<{ label: string; path: string; href?: string }>;
  more?: number;
};

/** A gate's or a question set's panel, drawn above its question while it is open: `display/next.json`. */
export type DisplayPanel = {
  version: number;
  kind?: string;
  question: string;
  glance?: string[];
  parts?: DisplayPart[];
  [field: string]: unknown;
};

/** The parts of the phase under way, one state each, and the line naming them. */
export type DisplayParts = {
  node: string;
  kind: 'groups' | 'reviews';
  wave: number | null;
  items: Array<{ state: 'done' | 'running' | 'reverted' | 'skipped' | 'to_run'; name?: string }>;
  line: string;
};

/** The run's status the band draws: `display/status.json`. */
export type DisplayStatus = {
  version: number;
  workflow?: string;
  task?: string | null;
  status?: string | null;
  line?: string;
  phase?: { index: number | null; total: number; title: string | null };
  checkpoint?: { index: number; total: number; title: string } | null;
  started?: string | null;
  dashboard?: string | null;
  run_url?: string;
  artifacts?: string[];
  parts?: DisplayParts | null;
  [field: string]: unknown;
};

/** What the start card shows, taken from `display/banner.json`. */
export type DisplayCard = {
  workflow: string;
  task: string | null;
  checkpoints: number | null;
  first: string | null;
  frozen: string | null;
  folder: string | null;
  dashboard: string | null;
};

/**
 * How one tool row is redrawn: a quiet line — for an artifact, its path linked
 * after `lead` — the start card, or nothing, when its write is spoken for or
 * its line would say nothing new.
 */
export type DisplayRow = {
  line?: string;
  lead?: string;
  path?: string;
  href?: string | null;
  card?: DisplayCard;
  quiet?: boolean;
  patch?: boolean;
  gone?: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    maister: {
      panel: DisplayPanel | null;
      run: DisplayStatus | null;
      now: number | null;
      rows: Record<string, DisplayRow>;
      banner: string | null;
      last: string | null;
    };
  }
}
