/**
 * Claude Code hooks module (a mod): draws a Maister run where the session is —
 * the start banner in the transcript, the run's phase in the status line, and
 * a gate's checkpoint in a panel above the question.
 *
 * Display only. No hook here denies, rewrites or answers anything: every one
 * passes its call through, and its `.catch` passes it through again when the
 * hook itself fails, so a failure draws nothing and blocks nothing. Nothing is
 * written. Without this module — another surface, mods switched off — the
 * question carries its context as it always has; this only adds to it.
 *
 * It reads the files the workflow engine writes for it and works nothing out:
 * no command is parsed, no phase is counted, no row is measured. The session's
 * own id names the run it is driving (`.maister/display/sessions/<id>.json`),
 * and the run's `display/` directory holds the rest: `status.json` with its
 * status line composed, `banner.json` from the freeze, `next.json` with a
 * gate's question and a glance already fitted to the rows Claude Code allows
 * above it. A file that is missing, unreadable or of an unknown version draws
 * nothing.
 *
 * Plain JavaScript with no build step; the drawing uses the `h` global and the
 * surface's own elements. The values a drawing reads are kept in `$.state`,
 * declared in the plugin's `types/index.d.ts`.
 */

import { atom, read, update } from 'claude-code';

/** The glance a gate's question is drawn with, set while that question is open. */
const panel = atom({ plugin: 'maister', key: 'panel' }, null);

/** The run and freeze whose banner this session has shown, so it is shown once. */
const banner = atom({ plugin: 'maister', key: 'banner' }, null);

/** The format of the engine's display files this module reads. */
const VERSION = 1;

/** @type {import('claude-code').Register} */
export const register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    await show($, { withBanner: false }).catch(() => {});
    return started;
  }).catch(($, e, next) => next(e));

  // The engine runs through the shell, so a shell call is when a display file may have changed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e);
    await show($, { withBanner: true }).catch(() => {});
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const glance = await glanceFor($, e).catch(() => null);
    if (glance) await update($, panel, () => glance).catch(() => {});
    try {
      return await next(e);
    } finally {
      if (glance) await update($, panel, () => null).catch(() => {});
    }
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const lines = await read($, panel);
    const drawn = await next(e);
    if (!Array.isArray(lines) || !lines.length) return drawn;
    const { Box, Text } = $.ui.resolve(e);
    // The dialog itself, exactly once, under the panel.
    return h(Box, { flexDirection: 'column' },
      h(Box, { flexDirection: 'column', borderStyle: 'round' },
        ...lines.map((line, index) => h(Text, { key: `line-${index}`, bold: index === 0 }, line))),
      drawn);
  }).catch(($, e, next) => next(e));
};

/**
 * The status line from the run's status file, and — right after the freeze,
 * once per run — the banner, one transcript line per line of it: a line break
 * inside one log line does not draw.
 */
async function show($, { withBanner }) {
  const run = await runOf($);
  if (!run) return;
  const status = await display($, run, 'status.json');
  if (typeof status?.line === 'string') $.ui.status(status.line);
  if (!withBanner || !status) return;
  const start = await display($, run, 'banner.json');
  // The banner is the freeze's: shown when the write the status describes is the freeze itself.
  if (!Array.isArray(start?.lines) || start.frozen !== status.updated) return;
  const key = `${run}|${start.frozen}`;
  let fresh = false;
  await update($, banner, shown => {
    fresh = shown !== key;
    return key;
  });
  if (fresh) for (const line of start.lines) if (typeof line === 'string') $.ui.log(line);
}

/** The glance for the question `e` asks, when it is the question of the gate brief now open. */
async function glanceFor($, e) {
  const asked = e.questions?.[0]?.question;
  if (typeof asked !== 'string') return null;
  const run = await runOf($);
  if (!run) return null;
  const next = await display($, run, 'next.json');
  if (!next || next.question !== asked || !Array.isArray(next.glance)) return null;
  const lines = next.glance.filter(line => typeof line === 'string' && line !== '');
  return lines.length ? lines : null;
}

/** The run directory this session is driving, from the pointer the engine keeps for it; null when none. */
async function runOf($) {
  const [root, id] = await Promise.all([$.session.root(), $.session.id()]);
  const pointer = await readJson($, `${root}/.maister/display/sessions/${id}.json`);
  return typeof pointer?.run_dir === 'string' ? pointer.run_dir : null;
}

/** One of the run's display files; null when it is not there or not one this module knows. */
function display($, run, name) {
  return readJson($, `${run}/display/${name}`);
}

async function readJson($, file) {
  try {
    if (!(await $.fs.exists(file))) return null;
    const value = JSON.parse(await $.fs.read(file));
    return value && typeof value === 'object' && value.version === VERSION ? value : null;
  } catch {
    return null;
  }
}
