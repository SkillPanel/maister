/**
 * Reading a mockups folder's version list: `versions/index.json`, the version
 * folders beside it and the files a published version keeps.
 *
 * The index is the list of published versions; a folder with no index entry
 * is a turn that began and never published, or one still drawing. Allocation
 * counts both, so a number is never handed out twice — an abandoned `begin`
 * leaves a gap rather than a folder the next turn would write into.
 *
 * Refusals owned: `index-malformed` (the index, a published version's
 * manifest, a published html version's `.mockups.json`, or a published written
 * version's `scope.md`, cannot be read as its shape).
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../../../../lib/canonical.mjs';
import { anchoredFile } from '../../../../lib/input-file.mjs';
import { VERSION_PATTERN } from './shapes.mjs';
import { duplicates, itemsOf, parseScope, stripScope } from './written-scope.mjs';

const VERSION = new RegExp(VERSION_PATTERN);

export const isVersion = value => typeof value === 'string' && VERSION.test(value);

export const versionNumber = id => Number(id.slice(1));

export const versionId = n => `v${String(n).padStart(3, '0')}`;

/** The paths of one mockups folder. */
export function layout(taskPath, subdir) {
  const root = path.resolve(taskPath, subdir);
  const versions = path.join(root, 'versions');
  return {
    root,
    versions,
    index: path.join(versions, 'index.json'),
    lock: path.join(versions, '.lock'),
    dir: version => path.join(versions, version),
  };
}

const malformed = (file, why) => new Refusal('index-malformed',
  `${file} ${why}. Nothing was written; repair or restore that file (it is the folder's list of published versions) and run the same command again.`);

/**
 * `versions/index.json`, or the empty list when there is none yet. Keys the
 * scripts do not write (a hand-set `bookmarked`) are kept as found.
 */
export function readIndex(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { latest: null, versions: [] };
    throw malformed(file, `could not be read (${err.message})`);
  }
  let index;
  try {
    index = JSON.parse(text);
  } catch (err) {
    throw malformed(file, `is not JSON (${err.message})`);
  }
  if (index === null || typeof index !== 'object' || Array.isArray(index)) throw malformed(file, 'is not a JSON object');
  if (!Array.isArray(index.versions)) throw malformed(file, 'has no versions list');
  for (const [at, entry] of index.versions.entries()) {
    if (entry === null || typeof entry !== 'object' || !isVersion(entry.version)) {
      throw malformed(file, `has an entry (versions[${at}]) with no usable version id`);
    }
  }
  if (index.latest !== null && index.latest !== undefined && !isVersion(index.latest)) {
    throw malformed(file, `names ${JSON.stringify(index.latest)} as latest, which is not a version id`);
  }
  return { ...index, latest: index.latest ?? null };
}

export const published = (index, version) => index.versions.some(entry => entry.version === version);

/** The next version id: one above the highest among the version folders and the index entries. */
export function nextVersion(versionsDir, index) {
  let highest = 0;
  for (const entry of index.versions) highest = Math.max(highest, versionNumber(entry.version));
  let dirents = [];
  try {
    dirents = fs.readdirSync(versionsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const dirent of dirents) {
    if (dirent.isDirectory() && isVersion(dirent.name)) highest = Math.max(highest, versionNumber(dirent.name));
  }
  return versionId(highest + 1);
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** A published version's manifest. */
export function readManifest(versionDir) {
  const file = path.join(versionDir, 'manifest.json');
  let manifest;
  try {
    manifest = readJsonFile(file);
  } catch (err) {
    throw malformed(file, `could not be read as the version's manifest (${err.message})`);
  }
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.screens)) {
    throw malformed(file, 'has no screens list');
  }
  return manifest;
}

/**
 * A published version's screens with their content, for carry-over: its
 * `.mockups.json` joined with the manifest's behaviour lines. `format` is the
 * turn's own: content is carried only between html versions, so only an html
 * turn on an html version needs that file. There a `.mockups.json` that is
 * missing, unreadable or lacks one of its screens is refused `index-malformed`,
 * so no screen is ever carried forward blank. Anywhere else (an ascii version,
 * which may lack the file on the hand-written ASCII path, a written version,
 * which never has it, or a turn switching format) an unusable file gives the
 * manifest's screens with empty content.
 */
export function readScreens(versionDir, format) {
  const manifest = readManifest(versionDir);
  const carried = manifest.format === 'html' && format === 'html';
  const file = path.join(versionDir, '.mockups.json');
  const unusable = why => new Refusal('index-malformed',
    `${file} ${why}, and it holds the screen sources of a published html version this turn builds on. Nothing was written and the input file is kept; restore that file from version control, or build on another version (set against in .turn.json), and run finish again.`);
  let mockups = null;
  try {
    mockups = readJsonFile(file);
  } catch (err) {
    if (carried) throw unusable(`could not be read (${err.message})`);
    mockups = null;
  }
  if (carried && !Array.isArray(mockups?.mockups)) throw unusable('has no mockups list');
  const content = new Map((Array.isArray(mockups?.mockups) ? mockups.mockups : []).map(each => [each?.id, each]));
  if (carried) {
    const lacking = manifest.screens.find(screen => !content.has(screen.slug));
    if (lacking) throw unusable(`has no entry for the screen "${lacking.slug}" its manifest lists`);
  }
  const screens = manifest.screens.map(screen => {
    const found = content.get(screen.slug) ?? {};
    const out = {
      slug: screen.slug,
      title: screen.title,
      html: found.html ?? '',
      css: found.css ?? '',
      annotations: found.annotations ?? [],
    };
    if (screen.behaviour) out.behaviour = screen.behaviour;
    return out;
  });
  return { manifest, screens };
}

/** Text that must be UTF-8, decoded strictly; null when it is not. */
export function utf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A published written version's `scope.md` is not what a next round can build on. */
class UnusableScope extends Refusal {
  constructor(message) {
    super('index-malformed', `${message}, and it is the written scope of a published version this turn builds on. Nothing was written and the input files are kept; repair or restore that file, or build on another version (set against in .turn.json), and run finish again.`);
  }
}

/**
 * A `scope.md`'s text, read and decoded strictly as UTF-8. `refuse(reason)`
 * makes the refusal thrown for a file that cannot be read (`reason` the
 * error's message) or is not UTF-8 text (`reason` null).
 */
export function scopeText(file, refuse) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    throw refuse(err.message);
  }
  const text = utf8(bytes);
  if (text === null) throw refuse(null);
  return text;
}

/**
 * The earlier scope a written round is checked against: the published written
 * version's `scope.md`, read by the input-file rule (never a link), parsed and
 * stripped. A file that is missing, a link, not a file or not UTF-8 text is
 * refused `index-malformed`, and so is one in which two sections share a
 * heading, two items of one section share a text or an item is empty (a
 * version written or edited by hand never passed the check), since a mark
 * could not be matched against it; each one is named with its line.
 */
export function readScope(versionDir) {
  const expected = path.join(versionDir, 'scope.md');
  const file = anchoredFile({ given: expected, expected, noun: 'the written scope', beside: 'in the version folder', Usage: UnusableScope });
  const text = scopeText(file, reason => new UnusableScope(reason === null
    ? `the written scope ${file} is not UTF-8 text`
    : `the written scope ${file} could not be read: ${reason}`));
  const parsed = parseScope(text);
  const twice = duplicates(parsed);
  if (twice.length) {
    const named = twice.map(each => (each.text === null
      ? `the heading ${JSON.stringify(each.heading)} (line ${each.line})`
      : `the item ${JSON.stringify(each.text)} of section ${JSON.stringify(each.heading)} (line ${each.line})`));
    throw new UnusableScope(`the written scope ${file} repeats ${named.join('; ')}, so a mark cannot be matched against it`);
  }
  const empty = parsed.sections.flatMap(section => itemsOf(section)
    .filter(item => item.text === '')
    .map(item => `an empty item of section ${JSON.stringify(section.heading)} (line ${item.line})`));
  if (empty.length) {
    throw new UnusableScope(`the written scope ${file} holds ${empty.join('; ')}, so a mark cannot be matched against it`);
  }
  return stripScope(parsed);
}
