/**
 * The grounding pack's hashes and staleness: what `turn.mjs ground-seal`
 * records and `ground-status` compares.
 *
 * A hash is a git blob sha1, `sha1("blob <byteLength>\0" + bytes)`, computed
 * here so no git is needed. A source or pack file with no NUL byte is text: its
 * CRLF line endings are hashed as LF, the way git stores text under
 * `core.autocrlf`, so a pack sealed on one platform stays fresh on a checkout
 * that converts line endings. A file with a NUL byte is hashed as it is. A
 * `package-lock.json` source that names a package
 * hashes the line `<package>@<version>` instead of the file, so a lockfile
 * change for other packages does not stale the pack; any other lockfile is
 * hashed whole. The digest is the sha1 over the sorted UTF-8 lines
 * `schema <n>`, `<hash> <path>` for each source and image, and
 * `<hash> pack:<path>` for each pack file except `grounding.json` and
 * dot-files.
 *
 * `touchedSince` answers a different question from staleness: which recorded
 * sources a run changed, comparing each source as the run's base commit holds
 * it (read with `git cat-file`) with the working tree now, by the same hashing
 * rules. A pack already stale at the base is not touched by a run that leaves
 * its sources alone.
 *
 * Refusals owned: `source-missing` (a source or image is not a file, or the
 * lockfile does not hold the package), `grounding-malformed` (`grounding.json`
 * cannot be read as its shape), `base-unknown` (the base names no commit git
 * can read in the project).
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../../../../lib/canonical.mjs';
import { GROUNDING_KEYS, departures } from './shapes.mjs';

export const GROUNDING_FILE = 'grounding.json';

const sha1 = bytes => crypto.createHash('sha1').update(bytes).digest('hex');

/** The git blob hash of `bytes`. */
export function blobHash(bytes) {
  return sha1(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8'), bytes]));
}

/**
 * The hash of a source or pack file: text (no NUL byte) with CRLF read as LF,
 * binary as it is, so a line-ending conversion on checkout changes nothing.
 */
export function contentHash(bytes) {
  if (bytes.includes(0)) return blobHash(bytes);
  return blobHash(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
}

const slash = value => value.split(path.sep).join('/');

/** A project-relative path that stays inside the root, `/`-separated; null when it does not. */
export function inside(value) {
  const rel = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (rel === '' || path.isAbsolute(value) || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) return null;
  return rel;
}

/** The bytes of one regular file, or null when it is absent or not a regular file. */
function readBytes(file) {
  try {
    if (!fs.statSync(file).isFile()) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** The version a package-lock.json holds for `name`, or null. */
function lockedVersion(bytes, name) {
  let lock;
  try {
    lock = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  const entry = lock?.packages?.[`node_modules/${name}`] ?? lock?.dependencies?.[name];
  return typeof entry?.version === 'string' ? entry.version : null;
}

/**
 * Hash one source. Returns `{hash, version?}`, or null when the file is gone
 * (or, for a package, when the lockfile no longer holds it).
 */
export function hashSource(root, source) {
  return hashSourceBytes(readBytes(path.join(root, source.path)), source);
}

/** `hashSource` over bytes already read; null bytes are a file that is not there. */
function hashSourceBytes(bytes, source) {
  if (bytes === null) return null;
  if (source.kind === 'lockfile' && source.package !== undefined && path.posix.basename(source.path) === 'package-lock.json') {
    const version = lockedVersion(bytes, source.package);
    if (version === null) return null;
    return { hash: blobHash(Buffer.from(`${source.package}@${version}`, 'utf8')), version };
  }
  return { hash: contentHash(bytes) };
}

/** Whether the lockfile entry hashes a package rather than the whole file. */
export const hashesPackage = source => source.kind === 'lockfile' && source.package !== undefined
  && path.posix.basename(source.path) === 'package-lock.json';

/** The pack's own files as `/`-separated paths below the pack, `grounding.json` and dot-files left out. */
function packFiles(pack) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && rel !== GROUNDING_FILE) found.push(rel);
    }
  };
  walk(pack, '');
  return found;
}

/** The digest over the schema version, the sources, the images and the pack's files. */
export function digestOf({ schema, sources, images, pack }) {
  const lines = [
    ...sources.map(each => [each.path, `${each.hash} ${each.path}`]),
    ...images.map(each => [each.path, `${each.hash} ${each.path}`]),
    ...packFiles(pack).map(rel => {
      const hash = contentHash(fs.readFileSync(path.join(pack, rel)));
      return [`pack:${rel}`, `${hash} pack:${rel}`];
    }),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, line]) => line);
  return sha1(Buffer.from([`schema ${schema}`, ...lines].join('\n'), 'utf8'));
}

/** `grounding.json` read and checked against its shape; null when there is none. */
export function readGrounding(pack) {
  const file = path.join(pack, GROUNDING_FILE);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw malformed(file, `it could not be read (${err.message})`);
  }
  if (!stat.isFile()) throw malformed(file, 'it is not a regular file');
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw malformed(file, `it is not JSON (${err.message})`);
  }
  const found = departures(document, { type: 'object', keys: GROUNDING_KEYS }, GROUNDING_FILE);
  if (found.length) throw malformed(file, `it does not have the declared shape: ${found.slice(0, 5).join('; ')}`);
  return document;
}

const malformed = (file, why) => new Refusal('grounding-malformed',
  `${file} cannot be used: ${why}. Nothing was changed; rebuild the pack with --ground, which replaces it.`);

/** What changed since `document` was sealed: sources whose hash differs and sources that are gone. */
export function compare(root, document) {
  const changed = [];
  const gone = [];
  for (const source of document.sources) {
    const now = inside(source.path) === null ? null : hashSource(root, source);
    if (now === null) gone.push(source.path);
    else if (now.hash !== source.hash) changed.push(source.path);
  }
  return { changed, gone };
}

/** The bytes of `rel` as commit `sha` holds it, or null when the commit has no such file. */
function bytesAt(root, sha, rel) {
  const out = spawnSync('git', ['cat-file', 'blob', `${sha}:./${rel}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return out.status === 0 ? out.stdout : null;
}

/**
 * The recorded sources whose content at commit `sha` differs from the working
 * tree now, or that exist on one side only, as their recorded paths.
 */
export function touchedSince(root, document, sha) {
  const commit = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (commit.error || commit.status !== 0) {
    throw new Refusal('base-unknown',
      `${sha}, the commit the run started from, is not a commit git can read in ${root}. Nothing was written; `
      + 'the run cannot tell which sources it changed, so leave the pack as it is and refresh it with --ground if the change touched it.');
  }
  const touched = [];
  for (const source of document.sources) {
    const rel = inside(source.path);
    if (rel === null) continue;
    const before = hashSourceBytes(bytesAt(root, sha, rel), source);
    const now = hashSource(root, { ...source, path: rel });
    if ((before === null) !== (now === null) || (before !== null && before.hash !== now.hash)) touched.push(source.path);
  }
  return touched;
}
