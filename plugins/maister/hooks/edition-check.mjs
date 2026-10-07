/**
 * SessionStart: warn when two editions of this plugin are enabled.
 *
 * Registered in the exec form (`command: node`, this file in `args`), zero
 * dependencies, Node >= 20. A SessionStart hook cannot block a session, so the
 * warning goes out twice: as `systemMessage`, which the operator sees, and as
 * `additionalContext`, so the model relays it rather than starting a workflow.
 * The engine refuses to start or resume a run on the same detection, which
 * covers sessions where nobody reads this warning.
 *
 * It fails open: any error — no payload, a missing module, unreadable
 * settings — ends the hook silently at exit 0.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const { findEditionCollision } = await import('../lib/editions.mjs');
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  const collision = findEditionCollision({ pluginRoot, projectDir: projectDir() });
  if (collision) {
    process.stdout.write(`${JSON.stringify({
      systemMessage: `⚠️ ${collision.message}`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `⚠️ PLUGIN EDITION COLLISION: ${collision.message} `
          + 'Tell the user this before anything else, and do not start or resume any workflow of this plugin '
          + 'until only one edition is enabled and Claude Code has been restarted.',
      },
    })}\n`);
  }
} catch {
  // Fail open: a detection failure says nothing.
}
process.exitCode = 0;

/** The directory the session started in: the variable, else the payload's `cwd`, else ours. */
function projectDir() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof payload?.cwd === 'string' && payload.cwd !== '') return payload.cwd;
  } catch {
    // No payload, or not JSON: fall through.
  }
  return process.cwd();
}
