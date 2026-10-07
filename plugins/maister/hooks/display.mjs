/**
 * Claude Code hooks module (a mod): draws a Maister run where the session is —
 * a card at the run's start, a band above the prompt with where the run is, a
 * gate's checkpoint in a two-line panel above its question, and the engine's
 * own bookkeeping calls, and the artifacts a run declares as they are written,
 * as one quiet line each.
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
 * nothing: no phase is counted and no path is resolved. The one sum it does is
 * the panel's rows: the engine fits the text, but a link costs the rows of its
 * URL as well, so the panel checks its tree against Claude Code's rule and
 * links fewer review files when they would not fit (`panelBox`). The
 * session's own id names the run it is driving
 * (`.maister/display/sessions/<id>.json`), and the run's `display/` directory
 * holds the rest: `status.json` with the phase, the next checkpoint, the
 * nodes a write changed and the run's start; `banner.json` from the freeze;
 * `next.json` with a gate's question and its panel already fitted to the rows
 * Claude Code allows above it. A file that is missing, unreadable or of an
 * unknown version draws nothing. The status file also lists the artifact paths
 * the run declares, which is how a Write into the task folder is told to be one.
 *
 * A shell call draws as one quiet line only when the engine's own files prove
 * what it did: the status file moved on during a state write, or the panel
 * file changed during a gate brief. The command is matched against the
 * engine's verb as a guard against a compound command, never as the source of
 * what is drawn. Only a clean call collapses — no error, no refusal, nothing
 * on stderr, not interrupted — and the decision is made once, when the call
 * returns, so a row redrawn later or replayed from an earlier session draws
 * as it always did. A call whose line would say nothing — a write that moved
 * no step — or say again what the last line said draws nothing at all.
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

/** The last quiet line this module drew, so the same line is not drawn twice in a row. */
const last = atom({ plugin: 'maister', key: 'last' }, null);

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

/** The files of a run the engine writes or reads itself, never one of its artifacts. */
const ENGINE_FILES = /^(orchestrator-state\.yml|\.state-patch\.json|dashboard[^/]*|display\/.*)$/;

/** Colours: Maister's brand for what the module names, the states, links, and what recedes. */
const BRAND = '#907aca';
const DONE = '#79c08b';
const AMBER = '#e3bd59';
const LINK = '#7cc4e8';
const DIM = '#8c909a';
const PENDING = '#5a5f69';
const BORDER = '#4a4f5a';

/** Where a quiet line starts: under the row's bullet, as a tool result's line does. */
const INSET = 2;

/** The rows Claude Code allows around the question dialog, what a row holds, and what a border costs. */
const DIALOG_ROWS = 12;
const ROW_CHARS = 40;
const BORDER_ROWS = 2;

/** The rows the band's two lines take. */
const BAND_ROWS = 2;

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
    await afterWrite($, e, ran).catch(() => {});
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
    const elements = $.ui.resolve(e);
    const box = panelBox(elements, brief, linksOn(e));
    if (!box) return drawn;
    // The dialog itself, exactly once, under the panel.
    return h(elements.Box, { flexDirection: 'column' }, box, drawn);
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
    return quietLine(elements, row, linksOn(e));
  }).catch(($, e, next) => next(e));

  // Claude Code folds a run of calls into one count line, which no `ToolUse`
  // hook sees. A run of this module's rows alone draws as those rows — a row
  // that draws nothing counts as one of them, and draws nothing here too. A
  // run mixed with other calls keeps its count line and gains no quiet line;
  // only a start card is drawn under it, since nothing else shows that.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e);
    const kept = (await read($, rows)) ?? {};
    const calls = e.props.calls ?? [];
    const ours = calls.map(call => (typeof call.tool_use_id === 'string' && !call.isErrored && !call.isInterrupted && !call.isRunning
      ? kept[call.tool_use_id] ?? null : null));
    if (!ours.some(Boolean)) return next(e);
    const elements = $.ui.resolve(e);
    const links = linksOn(e);
    // Alone: every call is one of this module's rows, and no card stands beside a row it does not replace.
    const alone = ours.every(row => row && (row.gone || !row.card || row.quiet));
    if (alone) {
      const drawn = ours.filter(row => row && !row.gone).map((row, index) => (row.card
        ? h(elements.Box, { key: `row-${index}` }, card(elements, row.card, links))
        : h(elements.Box, { key: `row-${index}` }, quietLine(elements, row, links))));
      return h(elements.Box, { flexDirection: 'column' }, ...drawn);
    }
    const cards = ours.filter(row => row?.card).map((row, index) => h(elements.Box, { key: `card-${index}` }, card(elements, row.card, links)));
    if (!cards.length) return next(e);
    return h(elements.Box, { flexDirection: 'column' }, await next(e), ...cards);
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
    await say($, id, { line: savedLine(status) });
    return;
  }
  if (verb === 'gate-brief') {
    // A brief that wrote the panel already drawn says what was said: its line is the repeat `say` drops.
    const brief = await display($, dir, 'next.json');
    if (brief) await say($, id, { line: checkpointLine(brief) });
  }
}

/**
 * After a clean Write: the engine's patch file draws as one quiet line until a
 * state write lands it, and an artifact the run declares — a file in its task
 * folder — as one linked line naming it.
 */
async function afterWrite($, e, ran) {
  if (e.agentId || typeof e.tool_use_id !== 'string') return;
  if (typeof e.file_path !== 'string' || !clean(ran, false)) return;
  if (PATCH.test(e.file_path)) {
    const status = await read($, run);
    await remember($, e.tool_use_id, { line: patchLine(e.content, status), patch: true });
    return;
  }
  const dir = await runOf($);
  const status = dir ? await display($, dir, 'status.json') : null;
  const path = status ? artifactOf(dir, status, e.file_path) : null;
  if (path === null) return;
  const href = typeof status.run_url === 'string' ? `${status.run_url}/${path.split('/').map(encodeURIComponent).join('/')}` : null;
  await say($, e.tool_use_id, { line: `· maister · wrote ${path}`, lead: '· maister · wrote ', path, href });
}

/**
 * The path, relative to the run's folder, of an artifact the run declares —
 * the file itself or one inside a declared directory — or null. A status file
 * from before the engine listed them takes any file in the folder that is not
 * one of the engine's own.
 */
function artifactOf(dir, status, file) {
  const slashed = value => value.replace(/\\/g, '/');
  const folder = `${slashed(dir).replace(/\/+$/, '')}/`;
  const written = slashed(file);
  if (!written.startsWith(folder)) return null;
  const path = written.slice(folder.length);
  if (path === '' || path.split('/').includes('..')) return null;
  if (!Array.isArray(status.artifacts)) return ENGINE_FILES.test(path) ? null : path;
  return status.artifacts.some(each => typeof each === 'string' && (path === each || path.startsWith(`${each}/`))) ? path : null;
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

/**
 * Keep a quiet line for a row: one that says nothing, or what the last quiet
 * line already said, is kept as a row that draws nothing — still this
 * module's, so a folded run of it draws no count line either.
 */
async function say($, id, row) {
  let repeat = row.line === null;
  if (!repeat) {
    await update($, last, said => {
      repeat = said === row.line;
      return row.line;
    });
  }
  await remember($, id, repeat ? { gone: true } : row);
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

/** `· maister · saved · intake → done, …`, or the checkpoint the write opened; null when it changed no step. */
function savedLine(status) {
  const checkpoint = status.checkpoint;
  if (status.gate_open && checkpoint) return `· maister · checkpoint ${checkpoint.index} of ${checkpoint.total} · ${checkpoint.title}`;
  const saved = Array.isArray(status.saved) ? status.saved : [];
  if (!saved.length) return null;
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
function card(elements, start, links) {
  const { Box, Text } = elements;
  const facts = [];
  if (start.checkpoints !== null) facts.push(start.checkpoints === 0 ? 'no checkpoints' : `up to ${start.checkpoints} ${start.checkpoints === 1 ? 'checkpoint' : 'checkpoints'}`);
  if (start.first) facts.push(`first: ${start.first}`);
  const opens = [];
  if (links && start.dashboard) opens.push(linkTo(elements, start.dashboard, 'Open dashboard ↗', 'dashboard'));
  if (links && start.folder) opens.push(linkTo(elements, start.folder, 'Open task folder ↗', 'folder'));
  return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: BORDER, paddingX: 2, paddingY: 1 },
    h(Text, { key: 'title' },
      h(Text, { color: BRAND, bold: true }, `${start.workflow} run started`),
      ...(start.frozen ? ['  ', h(Text, { color: DIM }, clockTime(start.frozen))] : [])),
    ...(start.task ? [h(Text, { key: 'task', bold: true }, start.task)] : []),
    ...(facts.length ? [h(Text, { key: 'facts', color: DIM }, facts.join(' · '))] : []),
    ...(opens.length ? [h(Box, { key: 'links', flexDirection: 'row', gap: 3 }, ...opens)] : []));
}

/**
 * The band above the prompt: the run and its links where they open, then
 * where it is. Framed when the rows allow, with no blank row of its own: the
 * engine's `[-]` sits beside the top border, and the row between the band and
 * the prompt is the engine's. With fewer rows it drops the frame, then keeps
 * to one row.
 */
function band(elements, status, time, maxRows, links) {
  const { Box, Text } = elements;
  const ended = ENDINGS.has(status.status);
  const where = [];
  const phase = status.phase ?? {};
  if (!ended && phase.title && Number.isInteger(phase.index)) where.push(h(Text, { key: 'phase' }, `phase ${phase.index} of ${phase.total} · `, h(Text, { bold: true }, phase.title)));
  const after = [];
  if (!ended && status.checkpoint) after.push(`next checkpoint ${status.checkpoint.index} of ${status.checkpoint.total}`);
  const elapsed = ended ? null : elapsedText(status.started, time);
  if (elapsed) after.push(elapsed);
  if (after.length) where.push(h(Text, { key: 'after', color: DIM }, after.join(' · ')));

  const dots = !ended && Number.isInteger(phase.index) && phase.total <= DOTS_MAX ? dotsOf({ Text }, phase) : null;
  const progress = h(Box, { key: 'progress', flexDirection: 'row', gap: 2 },
    ...(dots ? [dots] : []),
    ...(ended ? [h(Text, { key: 'ended' }, status.status)] : where));

  const name = h(Text, { key: 'workflow', color: BRAND, bold: true }, status.workflow ?? 'Workflow');
  if (maxRows < BAND_ROWS) return h(Box, { flexDirection: 'row', gap: 2 }, name, progress);

  const opens = [];
  if (links && status.dashboard) opens.push(linkTo(elements, status.dashboard, 'Dashboard ↗', 'dashboard'));
  if (links && typeof status.run_url === 'string') opens.push(linkTo(elements, status.run_url, 'Task folder ↗', 'folder'));
  const head = h(Box, { key: 'head', flexDirection: 'row', gap: 2 },
    name,
    h(Box, { key: 'task', flexGrow: 1, flexShrink: 1 }, h(Text, { wrap: 'truncate-end' }, status.task ?? '')),
    ...(opens.length ? [h(Box, { key: 'links', flexDirection: 'row', gap: 2, flexShrink: 0 }, ...opens)] : []));
  if (maxRows >= BAND_ROWS + BORDER_ROWS) return h(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: BORDER, paddingX: 1 }, head, progress);
  return h(Box, { flexDirection: 'column', marginLeft: INSET }, head, progress);
}

/** The phases as dots: done, the current one, and those still to come. */
function dotsOf({ Text }, phase) {
  const done = Math.max(0, phase.index - 1);
  const pending = Math.max(0, phase.total - phase.index);
  return h(Text, { key: 'dots' },
    h(Text, { color: DONE }, '●'.repeat(done)),
    h(Text, { color: AMBER }, '●'),
    h(Text, { color: PENDING }, '●'.repeat(pending)));
}

/**
 * A quiet line, inset under the row's bullet and dim but for the brand's
 * name; an artifact's line has its path linked where the surface opens the
 * link.
 */
function quietLine(elements, row, links) {
  const { Box, Text } = elements;
  const text = row.path && row.href && links
    ? h(Text, { color: DIM, wrap: 'truncate-end' }, ...branded(Text, row.lead), linkTo(elements, row.href, row.path))
    : h(Text, { color: DIM, wrap: 'truncate-end' }, ...branded(Text, row.line));
  return h(Box, { marginLeft: INSET }, text);
}

/** A quiet line's text with its `maister` in the brand colour. */
function branded(Text, line) {
  const name = '· maister';
  if (!line.startsWith(name)) return [line];
  return ['· ', h(Text, { key: 'brand', color: BRAND }, 'maister'), line.slice(name.length)];
}

/** A link drawn as one: underlined, in the link colour. */
function linkTo({ Link, Text }, href, label, key) {
  return h(Link, { ...(key ? { key } : {}), href }, h(Text, { color: LINK, underline: true }, label));
}

/**
 * The panel above a gate's question, in the first form that fits the rows
 * Claude Code allows around the dialog: its two lines with every review file
 * linked, then with fewer of them linked, the rest named — a link costs the
 * rows of its URL as well — then the plain glance, the engine's fitted form,
 * for a brief without parts. Null when there is nothing to draw, or nothing
 * that fits.
 */
function panelBox(elements, brief, links) {
  const forms = [];
  if (Array.isArray(brief.parts) && brief.parts.length) {
    const review = brief.parts.find(part => part.key === 'review');
    const files = links && Array.isArray(review?.files) ? review.files.length : 0;
    for (let linked = files; linked >= 0; linked -= 1) forms.push(panelRows(elements, brief.parts, linked));
  } else forms.push(glanceRows(elements, brief.glance));
  for (const lines of forms) {
    if (!lines.length) continue;
    const box = h(elements.Box, { flexDirection: 'column', borderStyle: 'round', borderColor: BORDER, paddingX: 1 }, ...lines);
    if (rowsAround(box, links) <= DIALOG_ROWS) return box;
  }
  return null;
}

/** The engine's plain glance, one text a line, the first bold. */
function glanceRows({ Text }, glance) {
  const lines = Array.isArray(glance) ? glance.filter(line => typeof line === 'string' && line !== '') : [];
  return lines.map((line, index) => h(Text, { key: `line-${index}`, bold: index === 0 }, line));
}

/**
 * The rows a tree takes around the dialog, by the rule Claude Code holds it
 * to: an inline element outside another costs a row, a string a row of its
 * own outside one and one more for every forty characters it holds, a link on
 * a surface that draws it the rows of its URL too, a border two.
 */
function rowsAround(node, links, inline = false) {
  if (typeof node === 'string') return (inline ? 0 : 1) + Math.floor(node.length / ROW_CHARS);
  if (!node || typeof node !== 'object') return 0;
  const isInline = node.type === 'Text' || node.type === 'Link';
  let rows = isInline && !inline ? 1 : 0;
  if (node.type === 'Link' && links && typeof node.props?.href === 'string') rows += Math.floor((1 + node.props.href.length) / ROW_CHARS);
  if (node.props?.borderStyle !== undefined) rows += BORDER_ROWS;
  for (const child of node.children ?? []) rows += rowsAround(child, links, inline || isInline);
  return rows;
}

/**
 * The panel's two lines above a gate's question — the option preview under it
 * already says what was done, what comes next and what was decided:
 * `Checkpoint 2 of 10 · Specification · 1 decided · 1 open risk`, then the
 * review files, the first `linked` of them links and the rest named.
 */
function panelRows(elements, parts, linked) {
  const { Text } = elements;
  const title = parts.find(part => part.key === 'title');
  const counts = parts.find(part => part.key === 'counts');
  const review = parts.find(part => part.key === 'review');
  const sep = () => h(Text, { color: DIM }, ' · ');
  const head = [];
  if (title) head.push(h(Text, { color: BRAND, bold: true }, title.label), ...(title.text ? [sep(), h(Text, { bold: true }, title.text)] : []));
  if (counts) {
    if (head.length) head.push(sep());
    head.push(h(Text, { color: DIM }, `${counts.text} decided`), sep(),
      counts.open > 0 ? h(Text, { color: AMBER }, counts.risks) : h(Text, { color: DIM }, counts.risks));
  }
  const lines = head.length ? [h(Text, { key: 'head' }, ...head)] : [];
  const files = Array.isArray(review?.files) ? review.files : [];
  if (files.length) {
    const named = files.flatMap((file, index) => [
      '  ',
      index < linked && typeof file.href === 'string' ? linkTo(elements, file.href, file.label) : file.label,
    ]);
    lines.push(h(Text, { key: 'review' }, h(Text, { color: DIM }, review.label ?? 'Review'), ...named,
      ...(review.more ? [h(Text, { color: DIM }, `  +${review.more} more`)] : [])));
  }
  return lines;
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
