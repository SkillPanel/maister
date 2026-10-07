/**
 * Claude Code hooks module (a mod): draws a Maister run where the session is —
 * a card at the run's start, a band above the prompt with where the run is, a
 * gate's checkpoint in a panel above its question, and the engine's own
 * bookkeeping calls as one quiet line each.
 *
 * Display only. No hook here denies, rewrites or answers anything: every one
 * passes its call through and returns what the call beneath returned, and its
 * `.catch` passes it through again when the hook itself fails, so a failure
 * draws nothing and blocks nothing. What the model reads of a tool call is
 * never touched: a quiet line is the row's drawing alone. Nothing is written.
 * Without this module — another surface, mods switched off — every call draws
 * as it always has; this only adds to it.
 *
 * It reads the files the workflow engine writes for it and works out next to
 * nothing: no phase is counted, no row is measured, no path is resolved. The
 * session's own id names the run it is driving
 * (`.maister/display/sessions/<id>.json`), and the run's `display/` directory
 * holds the rest: `status.json` with the phase, the next checkpoint, the
 * nodes a write changed and the run's start; `banner.json` from the freeze;
 * `next.json` with a gate's question and its panel already fitted to the rows
 * Claude Code allows above it. A file that is missing, unreadable or of an
 * unknown version draws nothing.
 *
 * A shell call draws as one quiet line only when the engine's own files prove
 * what it did: the status file moved on during a state write, or the panel
 * file changed during a gate brief. The command is matched against the
 * engine's verb as a guard against a compound command, never as the source of
 * what is drawn. Only a clean call collapses — no error, no refusal, nothing
 * on stderr, not interrupted — and the decision is made once, when the call
 * returns, so a row redrawn later or replayed from an earlier session draws
 * as it always did.
 *
 * The elapsed time in the band is a fact, how long the run has been going.
 * Nothing here predicts how long anything will take.
 *
 * Plain JavaScript with no build step; the drawing uses the `h` global and the
 * surface's own elements. The values a drawing reads are kept in `$.state`,
 * declared in the plugin's `types/index.d.ts`.
 */

import { atom, read, update } from 'claude-code';

/** The gate brief's panel a question is drawn with, set while that question is open. */
const panel = atom({ plugin: 'maister', key: 'panel' }, null);

/** The run's status as the band draws it: the status file, as last read. */
const run = atom({ plugin: 'maister', key: 'run' }, null);

/** The time the band's elapsed figure is measured to, in milliseconds, moved on every minute. */
const now = atom({ plugin: 'maister', key: 'now' }, null);

/** How each tool row this module redraws is drawn, by the call's id, decided when the call returned. */
const rows = atom({ plugin: 'maister', key: 'rows' }, {});

/** The run and freeze whose banner this session has logged, where it logs one, so it is logged once. */
const banner = atom({ plugin: 'maister', key: 'banner' }, null);

/** The format of the engine's display files this module reads. */
const VERSION = 1;

/** The surfaces that draw the band and the card; anywhere else the status line and the log stand in. */
const DRAWN = new Set(['terminal', 'desktop']);

/** The engine's verbs whose clean calls draw as one quiet line. */
const QUIET = /workflow\.mjs["']?\s+(write-state|gate-revise|gate-brief)(?=\s|$)/;

/** The name of the engine's patch file, beside the state file it patches. */
const PATCH = /(^|[\\/])\.state-patch\.json$/;

/** How many redrawn rows are remembered; the oldest go first. */
const ROWS_KEPT = 100;

/** The run statuses after which the band names how the run ended. */
const ENDINGS = new Set(['completed', 'failed', 'stopped']);

/** The words a quiet line uses for a node status. */
const STATUS_WORDS = { completed: 'done' };

/** Colours, by theme key, so they follow the person's theme. */
const ACCENT = 'claude';
const DONE = 'success';
const CURRENT = 'warning';
const PENDING = 'inactive';
const NEXT = 'suggestion';

/** The most phases the band draws as dots; a longer run draws the count alone. */
const DOTS_MAX = 30;

/** @type {import('claude-code').Register} */
export const register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    await refresh($).catch(() => {});
    await tick($).catch(() => {});
    $.clock.every(60_000, () => {
      tick($).catch(() => {});
    });
    return started;
  }).catch(($, e, next) => next(e));

  // The engine runs through the shell, so a shell call is when a display file may have changed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await snapshot($).catch(() => null);
    const ran = await next(e);
    await afterShell($, e, ran, before).catch(() => {});
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e);
    await afterPatch($, e, ran).catch(() => {});
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const brief = await briefFor($, e).catch(() => null);
    if (brief) await update($, panel, () => brief).catch(() => {});
    try {
      return await next(e);
    } finally {
      if (brief) await update($, panel, () => null).catch(() => {});
    }
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const brief = await read($, panel);
    const drawn = await next(e);
    if (!brief) return drawn;
    const lines = panelRows($.ui.resolve(e), brief, linksOn(e));
    if (!lines.length) return drawn;
    const { Box } = $.ui.resolve(e);
    // The dialog itself, exactly once, under the panel.
    return h(Box, { flexDirection: 'column' },
      h(Box, { flexDirection: 'column', borderStyle: 'round', paddingX: 1 }, ...lines),
      drawn);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const status = await read($, run);
    if (!status || e.props.maxRows < 1) return next(e);
    return band($.ui.resolve(e), status, await read($, now), e.props.maxRows, linksOn(e));
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await rowFor($, e);
    if (!row) return next(e);
    const elements = $.ui.resolve(e);
    if (row.card) {
      const drawn = card(elements, row.card, linksOn(e));
      return row.quiet ? drawn : h(elements.Box, { flexDirection: 'column' }, await next(e), drawn);
    }
    if (row.gone) return h(elements.Box, {});
    return h(elements.Text, { dimColor: true, wrap: 'truncate-end' }, row.line);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const row = await rowFor($, e);
    if (!row || (row.card && !row.quiet)) return next(e);
    return h($.ui.resolve(e).Box, {});
  }).catch(($, e, next) => next(e));
};

// ---------------------------------------------------------------------------
// what a call did
// ---------------------------------------------------------------------------

/** The run this session drives and the stamps of its files, read before a shell call. */
async function snapshot($) {
  const dir = await runOf($);
  if (!dir) return { dir: null, updated: null, brief: null };
  const [status, brief] = await Promise.all([display($, dir, 'status.json'), display($, dir, 'next.json')]);
  return { dir, updated: status?.updated ?? null, brief: brief ? JSON.stringify(brief) : null };
}

/**
 * After a shell call: the band's status, the card when the call was the
 * freeze, and the call's quiet line when the engine's files prove it was a
 * clean state write or gate brief.
 */
async function afterShell($, e, ran, before) {
  const dir = await runOf($);
  if (!dir) return;
  const status = await display($, dir, 'status.json');
  if (!status) return;
  const drawn = await drawnHere($);
  await update($, run, () => status);
  if (!drawn && typeof status.line === 'string') $.ui.status(status.line);
  if (e.agentId) return;

  const same = before?.dir === dir;
  const landed = !same || status.updated !== before.updated;
  const verb = typeof e.command === 'string' ? e.command.match(QUIET)?.[1] ?? null : null;
  const quiet = verb !== null && clean(ran);
  const id = e.tool_use_id;

  if (landed && verb !== 'gate-brief') await consumePatches($);

  if (landed && verb === 'write-state') {
    const start = await display($, dir, 'banner.json');
    if (start && start.frozen === status.updated) {
      if (drawn && typeof id === 'string') await remember($, id, { card: cardOf(start), quiet });
      else await logBanner($, dir, start);
      return;
    }
  }
  if (!quiet || typeof id !== 'string') return;
  if (landed && (verb === 'write-state' || verb === 'gate-revise')) {
    await remember($, id, { line: savedLine(status) });
    return;
  }
  if (verb === 'gate-brief') {
    const brief = await display($, dir, 'next.json');
    if (brief && (!same || JSON.stringify(brief) !== before.brief)) await remember($, id, { line: checkpointLine(brief) });
  }
}

/** After a Write: the engine's patch file, written cleanly, draws as one quiet line until a state write lands it. */
async function afterPatch($, e, ran) {
  if (e.agentId || typeof e.tool_use_id !== 'string') return;
  if (typeof e.file_path !== 'string' || !PATCH.test(e.file_path) || !clean(ran, false)) return;
  const status = await read($, run);
  await remember($, e.tool_use_id, { line: patchLine(e.content, status), patch: true });
}

/** A call that ran to the end without an error, a refusal, an interruption or a word on stderr. */
function clean(ran, shell = true) {
  if (!ran || ran.deny !== undefined || ran.isError) return false;
  if (!shell) return true;
  const result = ran.result;
  return Boolean(result) && result.interrupted !== true && (result.stderr ?? '') === '';
}

/** Every patch row still drawn: a state write landed it, so it draws nothing now and its write speaks for it. */
async function consumePatches($) {
  await update($, rows, kept => {
    let changed = false;
    const out = {};
    for (const [id, row] of Object.entries(kept ?? {})) {
      if (row.patch && !row.gone) {
        out[id] = { ...row, gone: true };
        changed = true;
      } else out[id] = row;
    }
    return changed ? out : kept;
  });
}

/** Keep how a row draws, the oldest rows dropped past `ROWS_KEPT`. */
async function remember($, id, row) {
  await update($, rows, kept => {
    const entries = Object.entries(kept ?? {}).filter(([key]) => key !== id);
    entries.push([id, row]);
    return Object.fromEntries(entries.slice(-ROWS_KEPT));
  });
}

/**
 * Whether the surface drawing `e` opens the run's `file://` links. The terminal
 * does (an OSC 8 span); the desktop sends a link of no other scheme than
 * `https:`, so there a link would be its label as plain text, said to be one —
 * the label alone is drawn instead, and the folder and dashboard not at all.
 */
function linksOn(e) {
  return e.surface === 'terminal';
}

/** How a tool row draws, when this module decided it and the row has not errored since. */
async function rowFor($, e) {
  const row = (await read($, rows))?.[e.props.tool_use_id];
  if (!row || e.props.isErrored || e.props.isInterrupted || e.props.isRunning) return null;
  return row;
}

/** Whether the session draws on a surface that shows the band and the card. */
async function drawnHere($) {
  const surfaces = await $.session.surfaces();
  return surfaces.some(surface => DRAWN.has(surface));
}

/** The run's banner as log lines, once per freeze: where the session draws no card. */
async function logBanner($, dir, start) {
  if (!Array.isArray(start.lines)) return;
  const key = `${dir}|${start.frozen}`;
  let fresh = false;
  await update($, banner, shown => {
    fresh = shown !== key;
    return key;
  });
  if (fresh) for (const line of start.lines) if (typeof line === 'string') $.ui.log(line);
}

/** The band's status and its clock, at the session's start. */
async function refresh($) {
  const dir = await runOf($);
  const status = dir ? await display($, dir, 'status.json') : null;
  if (!status) return;
  await update($, run, () => status);
  if (!(await drawnHere($)) && typeof status.line === 'string') $.ui.status(status.line);
}

/** Move the band's clock to now. */
async function tick($) {
  const time = await $.clock.now();
  await update($, now, () => time);
}

// ---------------------------------------------------------------------------
// the quiet lines
// ---------------------------------------------------------------------------

/** `· maister · saved · intake → done, …`, or the checkpoint the write opened. */
function savedLine(status) {
  const checkpoint = status.checkpoint;
  if (status.gate_open && checkpoint) return `· maister · checkpoint ${checkpoint.index} of ${checkpoint.total} · ${checkpoint.title}`;
  const saved = Array.isArray(status.saved) ? status.saved : [];
  if (!saved.length) return '· maister · saved';
  return `· maister · saved · ${saved.map(each => `${lowered(each.title)} → ${STATUS_WORDS[each.status] ?? each.status}`).join(', ')}`;
}

/** `· maister · checkpoint 2 of 10 · Specification`, from the brief's panel. */
function checkpointLine(brief) {
  const title = Array.isArray(brief.parts) ? brief.parts.find(part => part.key === 'title') : null;
  if (title) return `· maister · ${lowered(title.label)} · ${title.text}`;
  const first = Array.isArray(brief.glance) ? brief.glance[0] : null;
  return typeof first === 'string' ? `· maister · ${lowered(first)}` : '· maister · checkpoint';
}

/** `· maister · patch · intake → done, …`: the node statuses the patch carries, by the titles the status file holds. */
function patchLine(content, status) {
  let patch = null;
  try {
    patch = JSON.parse(content);
  } catch {
    return '· maister · patch';
  }
  const nodes = patch && typeof patch.nodes === 'object' && patch.nodes !== null ? patch.nodes : {};
  const titles = status && typeof status.nodes === 'object' && status.nodes !== null ? status.nodes : {};
  const moves = Object.entries(nodes)
    .filter(([, node]) => node && typeof node.status === 'string')
    .map(([id, node]) => `${lowered(titles[id]?.title ?? id)} → ${STATUS_WORDS[node.status] ?? node.status}`);
  return moves.length ? `· maister · patch · ${moves.join(', ')}` : '· maister · patch';
}

/** A title as it reads mid-sentence: its first letter lower-cased unless it opens an acronym. */
function lowered(title) {
  const text = String(title);
  if (text.length > 1 && /[A-Z]/.test(text[1])) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// the drawings
// ---------------------------------------------------------------------------

/** What the card shows, from the banner file. */
function cardOf(start) {
  return {
    workflow: start.workflow ?? 'Workflow',
    task: start.task ?? null,
    checkpoints: Number.isInteger(start.checkpoints) ? start.checkpoints : null,
    first: start.first_phase ?? null,
    frozen: start.frozen ?? null,
    folder: start.run_url ?? null,
    dashboard: start.dashboard ?? null,
  };
}

/** The start card: what started, the task, the checkpoints and the first phase, and links to open where they open. */
function card({ Box, Text, Link }, start, links) {
  const facts = [];
  if (start.checkpoints !== null) facts.push(start.checkpoints === 0 ? 'no checkpoints' : `up to ${start.checkpoints} ${start.checkpoints === 1 ? 'checkpoint' : 'checkpoints'}`);
  if (start.first) facts.push(`first: ${start.first}`);
  const opens = [];
  if (links && start.dashboard) opens.push(h(Link, { key: 'dashboard', href: start.dashboard }, 'Open dashboard'));
  if (links && start.folder) opens.push(h(Link, { key: 'folder', href: start.folder }, 'Open task folder'));
  return h(Box, { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
    h(Text, { key: 'title' },
      h(Text, { color: ACCENT, bold: true }, `${start.workflow} run started`),
      ...(start.frozen ? ['  ', h(Text, { dimColor: true }, clockTime(start.frozen))] : [])),
    ...(start.task ? [h(Text, { key: 'task', bold: true }, start.task)] : []),
    ...(facts.length ? [h(Text, { key: 'facts', dimColor: true }, facts.join(' · '))] : []),
    ...(opens.length ? [h(Box, { key: 'links', flexDirection: 'row', gap: 3 }, ...opens)] : []));
}

/** The band above the prompt: the run, its links where they open, and where it is. */
function band({ Box, Text, Link }, status, time, maxRows, links) {
  const ended = ENDINGS.has(status.status);
  const where = [];
  const phase = status.phase ?? {};
  if (!ended && phase.title && Number.isInteger(phase.index)) where.push(h(Text, { key: 'phase' }, `phase ${phase.index} of ${phase.total} · `, h(Text, { bold: true }, phase.title)));
  const after = [];
  if (!ended && status.checkpoint) after.push(`next checkpoint ${status.checkpoint.index} of ${status.checkpoint.total}`);
  const elapsed = ended ? null : elapsedText(status.started, time);
  if (elapsed) after.push(elapsed);
  if (after.length) where.push(h(Text, { key: 'after', dimColor: true }, after.join(' · ')));

  const dots = !ended && Number.isInteger(phase.index) && phase.total <= DOTS_MAX ? dotsOf({ Text }, phase) : null;
  const progress = h(Box, { key: 'progress', flexDirection: 'row', gap: 2 },
    ...(dots ? [dots] : []),
    ...(ended ? [h(Text, { key: 'ended' }, status.status)] : where));

  const name = h(Text, { key: 'workflow', color: ACCENT, bold: true }, status.workflow ?? 'Workflow');
  if (maxRows < 2) return h(Box, { flexDirection: 'row', gap: 2 }, name, progress);

  const opens = [];
  if (links && status.dashboard) opens.push(h(Link, { key: 'dashboard', href: status.dashboard }, 'Dashboard'));
  if (links && typeof status.run_url === 'string') opens.push(h(Link, { key: 'folder', href: status.run_url }, 'Task folder'));
  const head = h(Box, { key: 'head', flexDirection: 'row', gap: 2 },
    name,
    h(Box, { key: 'task', flexGrow: 1, flexShrink: 1 }, h(Text, { wrap: 'truncate-end' }, status.task ?? '')),
    ...opens);
  return h(Box, { flexDirection: 'column' }, head, progress);
}

/** The phases as dots: done, the current one, and those still to come. */
function dotsOf({ Text }, phase) {
  const done = Math.max(0, phase.index - 1);
  const pending = Math.max(0, phase.total - phase.index);
  return h(Text, { key: 'dots' },
    h(Text, { color: DONE }, '●'.repeat(done)),
    h(Text, { color: CURRENT }, '●'),
    h(Text, { color: PENDING }, '●'.repeat(pending)));
}

/** The panel's rows above a gate's question: styled parts, or the plain glance where there are none. */
function panelRows({ Text, Link }, brief, links) {
  if (!Array.isArray(brief.parts) || !brief.parts.length) {
    const glance = Array.isArray(brief.glance) ? brief.glance.filter(line => typeof line === 'string' && line !== '') : [];
    return glance.map((line, index) => h(Text, { key: `line-${index}`, bold: index === 0 }, line));
  }
  return brief.parts.map(part => {
    if (part.key === 'title') {
      return h(Text, { key: 'title' }, h(Text, { color: ACCENT, bold: true }, part.label), ' ', h(Text, { bold: true }, part.text));
    }
    if (part.key === 'headline') {
      return h(Text, { key: 'headline' }, h(Text, { color: DONE, bold: true }, part.label), ' ', part.text);
    }
    if (part.key === 'counts') {
      return h(Text, { key: 'counts' }, h(Text, { dimColor: true }, part.label), ` ${part.text} · `,
        part.open > 0 ? h(Text, { color: CURRENT }, part.risks) : h(Text, { dimColor: true }, part.risks));
    }
    if (part.key === 'next') {
      return h(Text, { key: 'next' }, h(Text, { color: NEXT, bold: true }, part.label), ' ', part.text);
    }
    if (part.key === 'review') {
      const files = (part.files ?? []).flatMap((file, index) => [
        ...(index ? ['  '] : []),
        links && typeof file.href === 'string' ? h(Link, { href: file.href }, file.label) : file.label,
      ]);
      return h(Text, { key: 'review' }, h(Text, { dimColor: true }, part.label), ' ', ...files,
        ...(part.more ? [h(Text, { dimColor: true }, `  +${part.more} more`)] : []));
    }
    return h(Text, { key: String(part.key) }, `${part.label ?? ''} ${part.text ?? ''}`.trim());
  });
}

/** `running for 9 min`: how long the run has been going, never how long it will. */
function elapsedText(started, time) {
  const from = typeof started === 'string' ? Date.parse(started) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((time - from) / 60_000));
  if (minutes < 1) return 'running for under a minute';
  if (minutes < 60) return `running for ${minutes} min`;
  return `running for ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The freeze's time of day, as the person's clock reads it. */
function clockTime(stamp) {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// the files
// ---------------------------------------------------------------------------

/** The gate brief's panel for the question `e` asks, when it is the question of the brief now open. */
async function briefFor($, e) {
  const asked = e.questions?.[0]?.question;
  if (typeof asked !== 'string') return null;
  const dir = await runOf($);
  if (!dir) return null;
  const brief = await display($, dir, 'next.json');
  if (!brief || brief.question !== asked) return null;
  return brief;
}

/** The run directory this session is driving, from the pointer the engine keeps for it; null when none. */
async function runOf($) {
  const [root, id] = await Promise.all([$.session.root(), $.session.id()]);
  const pointer = await readJson($, `${root}/.maister/display/sessions/${id}.json`);
  return typeof pointer?.run_dir === 'string' ? pointer.run_dir : null;
}

/** One of the run's display files; null when it is not there or not one this module knows. */
function display($, dir, name) {
  return readJson($, `${dir}/display/${name}`);
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
