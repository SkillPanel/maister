/**
 * The mockup studio's folder verbs: the bookkeeping of one turn, which writes
 * exactly one new version under `<task_path>/<output_subdir>/`.
 *
 *   node <path to this file> begin  --task-path=<dir> [--subdir=<rel>] [--against=<vNNN>]
 *   node <path to this file> finish --task-path=<dir> [--subdir=<rel>] --version=<vNNN>
 *                                   [--preview] [--index=<rel to task path>] [--record=<abs path>]
 *
 * Exec form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 * `--subdir` defaults to `analysis/mockups`; it is relative to the task path
 * and may not leave it.
 *
 * `begin` allocates the version: one above the highest number among the
 * `versions/` folders and the index entries, so an abandoned `begin` leaves a
 * gap and is never reused. It creates `versions/` when missing, then the
 * version folder with an exclusive, non-recursive mkdir. `--against` defaults
 * to the index's `latest` (null on a first turn). It prints
 * `{ok, version, version_dir, against, first, screens: [{slug, title}]}`, the
 * screens being `against`'s.
 *
 *   node <path to this file> ground-seal   --pack=<dir> [--root=<project root>]
 *   node <path to this file> ground-status --pack=<dir> [--root=<project root>]
 *
 * Between `begin` and `finish`, the turn writes one input file, `versions/<vNNN>/.turn.json`
 * (the `TURN_FILE` shape in `lib/shapes.mjs`), with its own file tool — and,
 * for prototype fidelity, `frames.mjs export` writes `.frames.json` beside it.
 * Both are read by the input-file rule: one fixed name in one fixed place,
 * never a link. The model writes no other bookkeeping.
 *
 * `finish` resolves the version's screens — `against`'s, when it has the same
 * format, minus `drop`, with each sent screen replacing the one of the same
 * slug or adding a new one — and computes which changed. With `--preview` it
 * renders the pages, the gallery and the manifest into the version folder
 * only and keeps the input files. Otherwise, holding the lock
 * `versions/.lock`, it writes in this order: the pages, gallery, manifest and
 * `.mockups.json`; the index entry and `latest`; the flat latest view; the
 * INDEX rows (with `--index`); the run record (with `--record`); then it
 * deletes the input files. It prints the turn result plus `values`, the run
 * record ready to record: lists comma-joined, `notes_count` a decimal string.
 *
 * Once a publishing `finish` of an html version has printed its result, it
 * opens that version's gallery for a person at the terminal: `openGallery`
 * below says when. A preview and an ascii version open nothing. This is best
 * effort and records nothing; whatever happens to the opener, the turn's result
 * and exit code are the ones already decided.
 *
 * `ground-seal` reads `<pack>/.sources.json` (`SOURCES_FILE`, the input-file
 * rule), hashes each source and image under `--root` (default the working
 * directory), writes `<pack>/grounding.json` and deletes the input; it prints
 * `{ok, digest, sources, images}`. `ground-status` writes nothing: it prints
 * `{ok, status, pack, digest, schema_version, plugin_schema_version, reasons,
 * changed, gone}` with `status` fresh, stale or missing, `reasons` from
 * source-changed, source-gone, schema-older and schema-newer (the last never
 * stales a pack), `changed` and `gone` the source paths. Images and time never
 * make a pack stale. The hashing rules live in `lib/grounding.mjs`.
 *
 * Every file is written whole, through a temp and a rename
 * (`lib/canonical.mjs`). The scripts return codes only and never command
 * text; the notes a person reads are written by the skill.
 *
 * Exit codes: 0 success, the JSON result on stdout; 1 refusal,
 * `{ok: false, code, message}` on stdout; 2 usage or an unexpected error, a
 * message on stderr. A refusal before publishing changes nothing outside the
 * version folder; one during publishing says what landed.
 *
 * Refusals owned:
 *   begin   against-unknown, version-exists, index-malformed, folder-unwritable
 *   finish  version-unknown, version-published, turn-file-missing,
 *           turn-file-malformed, slug-invalid, screens-empty, index-locked,
 *           index-malformed, folder-unwritable
 *   ground-seal    sources-file-missing, sources-file-malformed, source-missing,
 *                  folder-unwritable
 *   ground-status  grounding-malformed
 * Every write fault, the write primitives' included, is `folder-unwritable`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Refusal, claimLock, commit, stamp } from '../../../lib/canonical.mjs';
import { anchoredFile, consume, readFileText } from '../../../lib/input-file.mjs';
import { openFile, optedOut } from '../../../lib/open-file.mjs';
import { isTerminalDriver } from '../../workflow-engine/scripts/lib/driver.mjs';
import { parse as parseState } from '../../workflow-engine/scripts/lib/state-read.mjs';
import {
  GROUNDING_FILE, compare, digestOf, hashSource, hashesPackage, inside, blobHash, readGrounding,
} from './lib/grounding.mjs';
import { rewriteIndex } from './lib/index-rows.mjs';
import { mockupsJson, renderGallery, renderPage } from './lib/render.mjs';
import { FRAMES_FILE, GROUNDING_SCHEMA_VERSION, SOURCES_FILE, TURN_FILE, departures } from './lib/shapes.mjs';
import { assertSlug, resolveSlugs } from './lib/slugs.mjs';
import { isVersion, layout, nextVersion, published, readIndex, readManifest, readScreens } from './lib/versions.mjs';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };
const DEFAULT_SUBDIR = 'analysis/mockups';
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'template.html');

const VERBS = {
  begin: { values: ['task-path', 'subdir', 'against'], switches: [] },
  finish: { values: ['task-path', 'subdir', 'version', 'index', 'record'], switches: ['preview'] },
  'ground-seal': { values: ['pack', 'root'], switches: [] },
  'ground-status': { values: ['pack', 'root'], switches: [] },
};
const GROUND_VERBS = ['ground-seal', 'ground-status'];

class UsageError extends Error {}

/** The input file is not what `finish` can read: a link, not a file, not the declared shape. */
class MalformedInput extends Refusal {
  constructor(message) {
    super('turn-file-malformed', `${message}. Nothing was written and the input file is kept; correct it and run finish again.`);
  }
}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const spec = VERBS[verb];
  if (!spec) throw new UsageError(verb === undefined ? 'no verb given' : `unknown verb "${verb}"`);
  const flags = {};
  for (let at = 0; at < rest.length; at += 1) {
    const arg = rest[at];
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
    if (spec.switches.includes(name)) {
      if (eq >= 0) throw new UsageError(`the flag --${name} takes no value`);
      flags[name] = true;
      continue;
    }
    if (!spec.values.includes(name)) throw new UsageError(`unknown flag --${name} for ${verb}`);
    const value = eq >= 0 ? arg.slice(eq + 1) : rest[at + 1];
    if (eq < 0) at += 1;
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) {
      throw new UsageError(`the flag --${name} needs a value`);
    }
    flags[name] = value;
  }
  const needed = GROUND_VERBS.includes(verb) ? 'pack' : 'task-path';
  if (flags[needed] === undefined) throw new UsageError(`${verb} needs --${needed}`);
  return { verb, flags };
}

/** A path relative to the task path that stays inside it, `/`-separated. */
function relativeInside(value, flag) {
  const rel = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (rel === '' || path.isAbsolute(value) || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) {
    throw new UsageError(`--${flag} must be a path relative to the task path that stays inside it, and was ${value}`);
  }
  return rel;
}

/** One file, written whole through a temp beside it. */
function put(target, text) {
  const dir = path.dirname(target);
  commit({ target, text, tmp: path.join(dir, `.${path.basename(target)}.tmp`), codes: { unwritable: 'folder-unwritable', tempExists: 'folder-unwritable' } });
}

const json = value => `${JSON.stringify(value, null, 2)}\n`;

function unlinkIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Refusal('folder-unwritable', `${file} could not be removed: ${err.message}`);
  }
}

// ---------------------------------------------------------------- begin

function begin(flags) {
  const subdir = relativeInside(flags.subdir ?? DEFAULT_SUBDIR, 'subdir');
  const where = layout(flags['task-path'], subdir);
  const index = readIndex(where.index);

  if (flags.against !== undefined && !(isVersion(flags.against) && published(index, flags.against))) {
    throw new Refusal('against-unknown',
      `${flags.against} is not a published version of ${where.root} (versions/index.json lists ${index.versions.map(each => each.version).join(', ') || 'none'}). Nothing was written; begin again with one of those, or without --against to build on the latest.`);
  }
  const against = flags.against ?? index.latest;
  const screens = against === null ? [] : readManifest(where.dir(against)).screens.map(({ slug, title }) => ({ slug, title }));
  const version = nextVersion(where.versions, index);
  const versionDir = where.dir(version);

  try {
    fs.mkdirSync(where.versions, { recursive: true });
  } catch (err) {
    throw new Refusal('folder-unwritable', `${where.versions} could not be created: ${err.message}. Nothing was written; make the folder writable and begin again.`);
  }
  try {
    fs.mkdirSync(versionDir);
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Refusal('version-exists',
        `${versionDir} already exists, so another turn took ${version} first. Nothing was written; run begin again for the next free version.`);
    }
    throw new Refusal('folder-unwritable', `${versionDir} could not be created: ${err.message}. Nothing was written; make the folder writable and begin again.`);
  }
  return { ok: true, version, version_dir: versionDir, against, first: index.versions.length === 0, screens };
}

// ---------------------------------------------------------------- finish

/** One input file of the version folder, read by the input-file rule and checked against its shape. */
function readInput(versionDir, name, shape) {
  const expected = path.join(versionDir, name);
  try {
    fs.lstatSync(expected);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Refusal('turn-file-missing',
        `${expected} does not exist. Nothing was written; write the turn's input file there and run finish again.`);
    }
    throw new MalformedInput(`${expected} could not be read (${err.message})`);
  }
  const file = anchoredFile({ given: expected, expected, noun: `the input file ${name}`, beside: 'in the version folder', Usage: MalformedInput });
  const text = readFileText(file, `the input file ${name}`, MalformedInput);
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    throw new MalformedInput(`${expected} is not JSON (${err.message})`);
  }
  const found = departures(document, { type: 'object', keys: shape }, name);
  if (found.length) throw new MalformedInput(`${expected} does not have the declared shape: ${found.slice(0, 5).join('; ')}`);
  return { document, file };
}

/** Everything a publish writes, worked out before anything is written. */
function plan(flags, where, subdir, index, version) {
  const versionDir = where.dir(version);
  const turnInput = readInput(versionDir, '.turn.json', TURN_FILE);
  const turnFile = turnInput.document;
  const inputs = [turnInput.file];
  const { format, fidelity } = turnFile;

  if (fidelity === 'prototype' && format !== 'html') {
    throw new MalformedInput(`${turnInput.file} asks for prototype fidelity in the ${format} format; a prototype is html`);
  }
  const against = turnFile.against === undefined ? index.latest : turnFile.against;
  if (against !== null && !published(index, against)) {
    throw new MalformedInput(`${turnInput.file} builds on ${against}, which is not a published version of this folder`);
  }

  let sent;
  if (fidelity === 'prototype') {
    const frames = readInput(versionDir, '.frames.json', FRAMES_FILE);
    inputs.push(frames.file);
    sent = frames.document.screens.map(scene => ({ ...scene, live: `prototype.html#${scene.slug}` }));
  } else {
    if (!Array.isArray(turnFile.screens)) throw new MalformedInput(`${turnInput.file} has no screens list, which ${fidelity} fidelity needs`);
    sent = turnFile.screens;
  }
  if (format === 'ascii' && !fs.existsSync(path.join(versionDir, 'ascii-mockups.md'))) {
    throw new Refusal('turn-file-missing',
      `${path.join(versionDir, 'ascii-mockups.md')} does not exist, and an ascii version is that document. Nothing was written; write it and run finish again.`);
  }

  const previous = against === null ? { manifest: null, screens: [] } : readScreens(where.dir(against), format);
  const drop = (turnFile.drop ?? []).map((slug, at) => assertSlug(slug, `drop[${at}]`));
  (turnFile.scope ?? []).forEach((slug, at) => assertSlug(slug, `scope[${at}]`));

  const sameFormat = previous.manifest?.format === format;
  const resolved = sameFormat
    ? previous.screens.filter(screen => !drop.includes(screen.slug)).map(screen => ({ ...screen, carried: true, changed: false }))
    : [];
  const slugs = resolveSlugs(sent, previous.screens, resolved.map(screen => screen.slug));
  const before = new Map(previous.screens.map(screen => [screen.slug, screen]));

  sent.forEach((screen, at) => {
    const slug = slugs[at];
    const prior = before.get(slug);
    const changed = format === 'ascii'
      || !prior
      || prior.title !== screen.title
      || prior.html !== (screen.html ?? '')
      || prior.css !== (screen.css ?? '');
    const next = { ...screen, slug, carried: false, changed };
    const existing = resolved.findIndex(each => each.slug === slug);
    if (existing === -1) resolved.push(next);
    else resolved[existing] = next;
  });

  if (resolved.length === 0) {
    throw new Refusal('screens-empty',
      `${version} would hold no screens once ${against ?? 'nothing'} is carried over, drop is applied and the sent screens are added. Nothing was written and the input file is kept; send at least one screen, or drop fewer, and run finish again.`);
  }

  const created = stamp();
  const degraded = turnFile.degraded ?? [];
  const manifest = {
    version,
    created,
    note: turnFile.note,
    parent: against,
    format,
    fidelity,
    ...(fs.existsSync(path.join(versionDir, 'prototype.html')) ? { prototype: 'prototype.html' } : {}),
    screens: resolved.map(screen => ({
      slug: screen.slug,
      title: screen.title,
      changed: screen.changed,
      ...(screen.live ? { live: screen.live } : {}),
      ...(screen.behaviour?.length ? { behaviour: screen.behaviour } : {}),
    })),
    grounding_digest: turnFile.grounding.digest,
    grounding_stale: turnFile.grounding.stale,
    ...(degraded.length ? { degraded } : {}),
  };

  const screens = resolved.map(screen => screen.slug);
  const changed = resolved.filter(screen => screen.changed).map(screen => screen.slug);
  const notes = turnFile.notes ?? [];
  const result = {
    version,
    against,
    screens,
    changed,
    notes,
    ...(degraded.length ? { degraded } : {}),
    format,
    fidelity,
    task_path: projectRelative(flags['task-path']),
    output_subdir: subdir,
    gallery: format === 'html' ? `${subdir}/versions/${version}/index.html` : null,
  };
  const values = {
    version,
    against,
    screens: screens.join(','),
    changed: changed.join(','),
    degraded: degraded.length > 0,
    notes_count: String(notes.length),
    format,
    fidelity,
  };
  return { versionDir, inputs, resolved, manifest, result, values, created };
}

/** The task path relative to the project root (the working directory), `/`-separated. */
function projectRelative(taskPath) {
  const real = file => {
    try {
      return fs.realpathSync(file);
    } catch {
      return path.resolve(file);
    }
  };
  const rel = path.relative(real(process.cwd()), real(taskPath));
  const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return (inside ? rel : rel === '' ? '.' : path.resolve(taskPath)).split(path.sep).join('/');
}

/**
 * The version folder's own files. Pages of slugs no longer in the version (a
 * preview before a fix renamed one) are removed, so the folder holds exactly
 * the version. Returns the page texts by slug, for the flat view.
 */
function writeVersion(work, { preview }) {
  const { versionDir, resolved, manifest } = work;
  const pages = new Map();
  if (manifest.format === 'html') {
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const nav = resolved.map(({ slug, title }) => ({ slug, title }));
    for (const screen of resolved) pages.set(screen.slug, renderPage(template, screen, nav));
    for (const name of fs.readdirSync(versionDir)) {
      const match = /^([a-z0-9-]+)\.html$/.exec(name);
      if (match && !['index', 'prototype'].includes(match[1]) && !pages.has(match[1])) unlinkIfPresent(path.join(versionDir, name));
    }
    for (const [slug, text] of pages) put(path.join(versionDir, `${slug}.html`), text);
    put(path.join(versionDir, 'index.html'), renderGallery({ version: manifest.version, note: manifest.note, parent: manifest.parent, screens: resolved }));
  }
  put(path.join(versionDir, 'manifest.json'), json(manifest));
  if (!preview) put(path.join(versionDir, '.mockups.json'), json(mockupsJson(resolved)));
  return pages;
}

/** The slugs of the version `latest` names before this publish; none when it cannot be read. */
function previousSlugs(where, latest) {
  if (latest === null) return [];
  try {
    return readManifest(where.dir(latest)).screens.map(screen => screen.slug);
  } catch {
    return [];
  }
}

function publish(flags, where, subdir, work) {
  const { versionDir } = work;
  const { version } = work.manifest;
  let release;
  try {
    release = claimLock(where.lock, { code: 'index-locked', unwritable: 'folder-unwritable' });
  } catch (err) {
    if (err instanceof Refusal && err.code === 'index-locked') {
      throw new Refusal('index-locked',
        `${where.lock} is held, so another turn is publishing into this folder. Nothing was written and the input file is kept; run finish again in a moment (a lock older than a minute is a crashed turn's leftover and is reclaimed).`);
    }
    // The lock primitive maps its directory creation but lets the lock file's
    // own open fail raw (a read-only versions folder gives EACCES), so every
    // other fault taking the lock is a write fault here, never exit 2.
    const reason = err instanceof Refusal ? err.message.replace(/^[a-z-]+: /, '') : err.message;
    if ((err instanceof Refusal && err.code === 'folder-unwritable') || (!(err instanceof Refusal) && typeof err.code === 'string')) {
      throw new Refusal('folder-unwritable',
        `${where.lock} could not be taken: ${reason}. Nothing was published and the input file is kept; make the folder writable and run finish again.`);
    }
    throw err;
  }

  const landed = [];
  let indexLanded = false;
  try {
    const index = readIndex(where.index);
    if (published(index, version)) throw versionPublished(version);

    const pages = writeVersion(work, { preview: false });
    landed.push(`the version's files in ${versionDir}`);

    const entry = { version, created: work.created, note: work.manifest.note, parent: work.manifest.parent, changed: work.result.changed };
    put(where.index, json({ ...index, latest: version, versions: [...index.versions, entry] }));
    indexLanded = true;
    landed.push(`the index entry, with ${version} as latest`);

    const before = previousSlugs(where, index.latest);
    const now = new Set(work.result.screens);
    for (const slug of before) if (!now.has(slug)) unlinkIfPresent(path.join(where.root, `${slug}.html`));
    for (const [slug, text] of pages) put(path.join(where.root, `${slug}.html`), text);
    put(path.join(where.root, '.mockups.json'), fs.readFileSync(path.join(versionDir, '.mockups.json'), 'utf8'));
    if (work.manifest.format === 'ascii') {
      put(path.join(where.root, 'ascii-mockups.md'), fs.readFileSync(path.join(versionDir, 'ascii-mockups.md'), 'utf8'));
    }
    landed.push('the flat latest view');

    if (flags.index !== undefined) {
      const file = path.resolve(flags['task-path'], relativeInside(flags.index, 'index'));
      let existing = null;
      try {
        existing = fs.readFileSync(file, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') throw new Refusal('folder-unwritable', `${file} could not be read: ${err.message}`);
      }
      put(file, rewriteIndex(existing, {
        subdir,
        format: work.manifest.format,
        owned: new Set([...before, ...now]),
        screens: work.resolved,
      }));
      landed.push('the INDEX rows');
    }

    if (flags.record !== undefined) {
      put(flags.record, json(work.result));
      landed.push('the run record');
    }

    for (const input of work.inputs) consume(input);
  } catch (err) {
    if (err instanceof Refusal && err.code === 'folder-unwritable') {
      // The index entry is the publish: before it lands, files in the version
      // folder are a draft finish rewrites, and the input is still there.
      const what = indexLanded
        ? `Already landed: ${landed.join('; ')}. ${version} is published, so do not run finish for it again; fix the folder's permissions and start the next turn, which rewrites the flat view and the rows.`
        : landed.length
          ? `Already landed: ${landed.join('; ')}. The index entry did not land, so nothing was published and the input file is kept; make the folder writable and run finish again.`
          : 'Nothing was published and the input file is kept; make the folder writable and run finish again.';
      throw new Refusal('folder-unwritable', `${err.message.replace(/^[a-z-]+: /, '')}. ${what}`);
    }
    throw err;
  } finally {
    release();
  }
}

const versionPublished = version => new Refusal('version-published',
  `${version} is already in versions/index.json, so it was published by an earlier finish. Nothing was written; begin a new version for further changes.`);

function finish(flags) {
  const subdir = relativeInside(flags.subdir ?? DEFAULT_SUBDIR, 'subdir');
  if (flags.version === undefined) throw new UsageError('finish needs --version');
  if (flags.record !== undefined && !path.isAbsolute(flags.record)) {
    throw new UsageError(`--record must be an absolute path, and was ${flags.record}`);
  }
  if (flags.index !== undefined) relativeInside(flags.index, 'index');
  const where = layout(flags['task-path'], subdir);
  const version = flags.version;
  const versionDir = isVersion(version) ? where.dir(version) : null;
  if (versionDir === null || !fs.statSync(versionDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Refusal('version-unknown',
      `${version} has no version folder under ${where.versions}. Nothing was written; run begin to allocate a version, and finish the id it prints.`);
  }
  const index = readIndex(where.index);
  if (published(index, version)) throw versionPublished(version);

  const work = plan(flags, where, subdir, index, version);
  if (flags.preview) {
    try {
      writeVersion(work, { preview: true });
    } catch (err) {
      if (err instanceof Refusal && err.code === 'folder-unwritable') {
        throw new Refusal('folder-unwritable', `${err.message.replace(/^[a-z-]+: /, '')}. Nothing was published and the input file is kept; make the folder writable and run finish again.`);
      }
      throw err;
    }
    return { ok: true, preview: true, ...work.result, values: work.values };
  }
  publish(flags, where, subdir, work);
  return { ok: true, ...work.result, values: work.values };
}

/**
 * Whether a person is at the terminal for this turn, read off the run that holds
 * it. The run's state sits beside `--record` when there is one, since a later
 * turn's task path may hold an earlier run's state, and otherwise in the task
 * path. No state means no run: an inline call or a terminal turn. A state that
 * cannot be read throws, and a turn that cannot tell opens nothing.
 */
function personAtTerminal(flags) {
  const runDir = flags.record === undefined ? flags['task-path'] : path.dirname(flags.record);
  return isTerminalDriver(parseState(fs.readFileSync(path.join(runDir, 'orchestrator-state.yml'), 'utf8')));
}

/**
 * Open a published html version's gallery, once, as a file in the default
 * browser; a version is published once, so this runs once for it. Never under a
 * cockpit or a dispatch driver. Silent: a failed open leaves the turn as it was,
 * and the close still names the path.
 */
function openGallery(flags, result) {
  try {
    if (result.preview || result.gallery === null || optedOut()) return;
    let terminal;
    try {
      terminal = personAtTerminal(flags);
    } catch (err) {
      if (err.code !== 'ENOENT') return;
      terminal = true;
    }
    if (terminal) openFile(path.resolve(flags['task-path'], result.gallery));
  } catch {
    // Best effort: nothing about opening a page may touch the turn.
  }
}

// ---------------------------------------------------------------- grounding

/** The input file is not what `ground-seal` can read: a link, not a file, not the declared shape. */
class MalformedSources extends Refusal {
  constructor(message) {
    super('sources-file-malformed', `${message}. Nothing was written and the input file is kept; correct it and run ground-seal again.`);
  }
}

function groundDirs(flags) {
  return { pack: path.resolve(flags.pack), root: path.resolve(flags.root ?? process.cwd()) };
}

function groundSeal(flags) {
  const { pack, root } = groundDirs(flags);
  const expected = path.join(pack, '.sources.json');
  try {
    fs.lstatSync(expected);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Refusal('sources-file-missing',
        `${expected} does not exist. Nothing was written; write the list of sources and images there and run ground-seal again.`);
    }
    throw new MalformedSources(`${expected} could not be read (${err.message})`);
  }
  const file = anchoredFile({ given: expected, expected, noun: 'the input file .sources.json', beside: 'in the pack folder', Usage: MalformedSources });
  let document;
  try {
    document = JSON.parse(readFileText(file, 'the input file .sources.json', MalformedSources));
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw new MalformedSources(`${expected} is not JSON (${err.message})`);
  }
  const found = departures(document, { type: 'object', keys: SOURCES_FILE }, '.sources.json');
  if (found.length) throw new MalformedSources(`${expected} does not have the declared shape: ${found.slice(0, 5).join('; ')}`);

  const missing = what => new Refusal('source-missing',
    `${what}. Nothing was written and the input file is kept; correct the path (relative to ${root}) or drop the entry, and run ground-seal again.`);
  const relative = each => {
    const rel = inside(each.path);
    if (rel === null) throw new MalformedSources(`${expected} names ${each.path}, which is not a path inside the project root`);
    return rel;
  };
  const sources = document.sources.map(each => {
    const rel = relative(each);
    const hashed = hashSource(root, { ...each, path: rel });
    if (hashed === null) {
      throw missing(hashesPackage({ ...each, path: rel }) && fs.existsSync(path.join(root, rel))
        ? `${rel} does not list the package ${each.package}`
        : `${rel} is not a file under ${root}`);
    }
    return {
      path: rel,
      hash: hashed.hash,
      kind: each.kind,
      ...(hashed.version === undefined ? {} : { package: each.package, version: hashed.version }),
    };
  });
  const images = document.images.map(each => {
    const rel = relative(each);
    let bytes;
    try {
      bytes = fs.statSync(path.join(root, rel)).isFile() ? fs.readFileSync(path.join(root, rel)) : null;
    } catch {
      bytes = null;
    }
    if (bytes === null) throw missing(`${rel} is not a file under ${root}`);
    return { path: rel, hash: blobHash(bytes) };
  });

  // The pack folder's files are hashed into the digest as they are now; the
  // input file is a dot-file and is not among them.
  const digest = digestOf({ schema: GROUNDING_SCHEMA_VERSION, sources, images, pack });
  const grounding = { schema_version: GROUNDING_SCHEMA_VERSION, built: stamp(), sources, images, digest };
  try {
    put(path.join(pack, GROUNDING_FILE), json(grounding));
  } catch (err) {
    if (err instanceof Refusal && err.code === 'folder-unwritable') {
      throw new Refusal('folder-unwritable', `${err.message.replace(/^[a-z-]+: /, '')}. Nothing was written and the input file is kept; make the pack folder writable and run ground-seal again.`);
    }
    throw err;
  }
  consume(file);
  return { ok: true, digest, sources: sources.length, images: images.length };
}

function groundStatus(flags) {
  const { pack, root } = groundDirs(flags);
  const document = readGrounding(pack);
  if (document === null) {
    return {
      ok: true, status: 'missing', pack, digest: null, schema_version: null,
      plugin_schema_version: GROUNDING_SCHEMA_VERSION, reasons: [], changed: [], gone: [],
    };
  }
  const { changed, gone } = compare(root, document);
  const reasons = [];
  if (changed.length) reasons.push('source-changed');
  if (gone.length) reasons.push('source-gone');
  if (document.schema_version < GROUNDING_SCHEMA_VERSION) reasons.push('schema-older');
  if (document.schema_version > GROUNDING_SCHEMA_VERSION) reasons.push('schema-newer');
  const stale = reasons.some(reason => reason !== 'schema-newer');
  return {
    ok: true,
    status: stale ? 'stale' : 'fresh',
    pack,
    digest: document.digest,
    schema_version: document.schema_version,
    plugin_schema_version: GROUNDING_SCHEMA_VERSION,
    reasons,
    changed,
    gone,
  };
}

// ---------------------------------------------------------------- main

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`turn: ${error.message}\nusage: node turn.mjs begin|finish --task-path=<dir> | ground-seal|ground-status --pack=<dir> [flags]\n`);
    return EXIT.INTERNAL;
  }
  try {
    const handlers = { begin, finish, 'ground-seal': groundSeal, 'ground-status': groundStatus };
    const result = handlers[parsed.verb](parsed.flags);
    process.stdout.write(json(result));
    if (parsed.verb === 'finish') openGallery(parsed.flags, result);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof Refusal) {
      const message = error.message.replace(/^[a-z-]+: /, '');
      process.stdout.write(json({ ok: false, code: error.code, message }));
      return EXIT.REFUSED;
    }
    if (error instanceof UsageError) {
      process.stderr.write(`turn: ${error.message}\n`);
      return EXIT.INTERNAL;
    }
    process.stderr.write(`turn: ${error.stack ?? error.message}\n`);
    return EXIT.INTERNAL;
  }
}

process.exitCode = main();
