/**
 * The project profile: what the project is — a CLI, a plugin, a library, a
 * service, a web app — so the reviewers key their checks to it instead of a
 * fixed web-service checklist. It lives under the top-level `project:` key of
 * `.maister/config.yml`.
 *
 * Why this module exists. Two reviewers reading the same project must judge it
 * as the same kind of thing, or one asks for a safeguard the other calls
 * overkill. So the profile is one value, read here: `validate` judges it, the
 * freeze copies the judged profile into `orchestrator.options.project`, and
 * `review-brief` hands that copy to every reviewer of a cycle. `init` writes the
 * block once, from its project analysis, through `writeProfile`; init's update
 * fills in the fields a block lacks, and never changes one it sets.
 *
 * The shape, every field optional:
 *
 *   kind       web-app | service | daemon | cli | library | plugin | desktop
 *              | mobile | data-pipeline | infra
 *   runtime    free text: the language and its version
 *   deploy     none | local | container | kubernetes | serverless
 *              | package-registry | app-store
 *   exposure   local | internal | public — who can reach its entry points
 *   data       the stores it writes, a list of names; [] for none
 *   scale      single-user | team | multi-tenant
 *   ui         none | web | tui | native
 *
 * A bad value is a warning, never a refusal: the field is left out, and a
 * field left out rules no check out. A key that is not a map is one warning and
 * no profile. Nothing here ever stops a run.
 *
 * Pure apart from the file reads and the one write: no stdio, and every finding
 * is returned as data.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDefinition } from './definition.mjs';

/** Where the profile lives, relative to the project root. */
export const CONFIG = path.join('.maister', 'config.yml');

/** The top-level key. */
const KEY = 'project';

/** Each field, in the order a written block lists it: a closed list of values, `text` or `list`. */
export const FIELDS = Object.freeze({
  kind: ['web-app', 'service', 'daemon', 'cli', 'library', 'plugin', 'desktop', 'mobile', 'data-pipeline', 'infra'],
  runtime: 'text',
  deploy: ['none', 'local', 'container', 'kubernetes', 'serverless', 'package-registry', 'app-store'],
  exposure: ['local', 'internal', 'public'],
  data: 'list',
  scale: ['single-user', 'team', 'multi-tenant'],
  ui: ['none', 'web', 'tui', 'native'],
});

/** What each field's line says when it is written out, after its values. */
const HINTS = {
  runtime: 'the language and its version, e.g. "node 20"',
  exposure: 'who can reach its entry points',
  data: 'the stores it writes, e.g. [postgres, files]; [] for none',
};

/**
 * The top-level `project:` entry of the project's `config.yml`:
 * `{file, present, block, errors}`. `present` says the key is there at all —
 * a commented line does not count — and `block` is its value, null when the
 * file or the key is absent or the key is empty. Only the entry is cut out and
 * read, so the rest of the file can never refuse it; an entry the reader
 * refuses is one error.
 */
export function readProfileBlock(root) {
  const file = path.join(root, CONFIG);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { file, present: false, block: null, errors: [] };
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => KEY_LINE.test(line));
  if (start < 0) return { file, present: false, block: null, errors: [] };
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]) || lines[end].startsWith('#'))) end++;
  const parsed = parseDefinition(lines.slice(start, end).join('\n'), file);
  if (parsed.doc === null) {
    const error = parsed.errors[0];
    return { file, present: true, block: null, errors: [`${error?.message ?? 'cannot be read'}`] };
  }
  const block = parsed.doc[KEY];
  return { file, present: true, block: block === undefined ? null : block, errors: [] };
}

const KEY_LINE = /^project\s*:/;

/**
 * Judge a `project:` value: `{profile, warnings}`, `profile` the fields that
 * passed — null when none did — and one `project-profile:` warning per field
 * left out, naming the file and what the field takes.
 */
export function judgeProfile(block, file) {
  const warnings = [];
  if (block === null || block === undefined) return { profile: null, warnings };
  if (!isMap(block)) {
    return { profile: null, warnings: [`project-profile: ${file}: project: is a map of fields (${Object.keys(FIELDS).join(', ')}), not ${describe(block)}; no profile is used`] };
  }
  const profile = {};
  for (const [name, value] of Object.entries(block)) {
    const accepted = FIELDS[name];
    if (accepted === undefined) {
      warnings.push(`project-profile: ${file}: project.${name} is not a profile field (${Object.keys(FIELDS).join(', ')}); it is ignored`);
      continue;
    }
    if (value === null) continue;
    const judged = judgeField(name, value);
    if (judged.ok) profile[name] = judged.value;
    else warnings.push(`project-profile: ${file}: project.${name} ${judged.why}; the field is left out`);
  }
  return { profile: Object.keys(profile).length ? profile : null, warnings };
}

/** One field's value: `{ok, value}` or `{ok: false, why}`. */
function judgeField(name, value) {
  const accepted = FIELDS[name];
  if (accepted === 'text') {
    if ((typeof value === 'string' && value.trim() !== '') || typeof value === 'number') return { ok: true, value: String(value).trim() };
    return { ok: false, why: `is free text such as "node 20", not ${describe(value)}` };
  }
  if (accepted === 'list') {
    const items = typeof value === 'string' ? [value] : value;
    if (Array.isArray(items) && items.every(item => typeof item === 'string' && item.trim() !== '')) {
      return { ok: true, value: items.map(item => item.trim()) };
    }
    return { ok: false, why: `is a list of store names such as [postgres, files], or [] for none, not ${describe(value)}` };
  }
  if (typeof value === 'string' && accepted.includes(value)) return { ok: true, value };
  return { ok: false, why: `is one of ${accepted.join(', ')}, not ${describe(value)}` };
}

/**
 * The profile of a project: `{profile, warnings}`, read and judged. The
 * `config.yml` reader's own error is one warning, and no profile.
 */
export function projectProfile(root) {
  const read = readProfileBlock(root);
  if (read.errors.length) {
    return { profile: null, warnings: read.errors.map(error => `project-profile: ${read.file}: the project: key cannot be read (${error}); no profile is used`) };
  }
  return judgeProfile(read.block, read.file);
}

/**
 * Write the profile `init` detected into the project's `config.yml`, only when
 * the file has no top-level `project:` key: appended after one blank line when
 * the file exists, the file created when it does not, and an existing key left
 * as it is. `detected` maps fields to values; a field it leaves out, sets to
 * null or gives a bad value is written commented out with what it takes, and a
 * bad value is a warning as well.
 *
 * With `fill`, an existing key is not simply kept: each field `detected`
 * settles that the block lacks, leaves empty or holds only commented out is
 * written into it, and every field the block sets is left as it is — see
 * `fillProfile`.
 *
 * Returns `{ok, file, action, profile, block, warnings}`: `action` is
 * `created`, `appended`, `filled` or `kept`, `block` the text written — for
 * `filled`, the block as it now reads — (null when kept) and `profile` the
 * fields written.
 */
export function writeProfile({ root, detected, fill = false }) {
  const file = path.join(root, CONFIG);
  if (!isMap(detected)) {
    return { ok: false, errors: [{ code: 'project-profile-bad-input', message: `project-profile-bad-input: the detected profile is a JSON object of fields (${Object.keys(FIELDS).join(', ')}), not ${describe(detected)}. Nothing was written` }], warnings: [] };
  }
  const warnings = [];
  for (const name of Object.keys(detected)) {
    if (FIELDS[name] === undefined) warnings.push(`project-profile: ${name} is not a profile field (${Object.keys(FIELDS).join(', ')}); it is not written`);
  }
  const existing = readProfileBlock(root);
  if (existing.present && fill) return fillProfile({ file, detected, existing, warnings });
  if (existing.present) return { ok: true, file, action: 'kept', profile: null, block: null, warnings };

  const profile = {};
  const lines = [...HEADER, `${KEY}:`];
  for (const [name, accepted] of Object.entries(FIELDS)) {
    const value = detected[name];
    let judged = null;
    if (value !== undefined && value !== null) {
      judged = judgeField(name, value);
      if (!judged.ok) warnings.push(`project-profile: ${name} ${judged.why}; it is written commented out`);
    }
    const hint = Array.isArray(accepted) ? accepted.join(' | ') : HINTS[name];
    if (judged?.ok) {
      profile[name] = judged.value;
      lines.push(`  ${name}: ${scalar(judged.value)}  # ${hint}`);
    } else {
      lines.push(`  # ${name}:  # ${hint}`);
    }
  }
  const block = `${lines.join('\n')}\n`;

  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = null;
  }
  if (text === null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeText(file, block);
    return { ok: true, file, action: 'created', profile, block, warnings };
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text === '' || text.endsWith('\n') ? text : `${text}${eol}`;
  const gap = body === '' || body.endsWith(`${eol}${eol}`) ? '' : eol;
  writeText(file, `${body}${gap}${block.replace(/\n/g, eol)}`);
  return { ok: true, file, action: 'appended', profile, block, warnings };
}

/**
 * Fill an existing `project:` block: each field `detected` settles with a value
 * the field takes, and the block does not set, is written as a new block writes
 * it — over its commented-out line (`  # deploy: …`) or its empty line when the
 * block has one, else after the block's last indented line, at the block's
 * indentation. A field the block sets is left alone, whatever `detected` says:
 * changing a value is the person's choice, never this verb's. Every other byte
 * of the file is unchanged, line endings included.
 *
 * A key that cannot be read, is not a map, or is written on one line is kept,
 * with a warning saying the fields go in by hand.
 */
function fillProfile({ file, detected, existing, warnings }) {
  const kept = why => {
    warnings.push(`project-profile: ${file}: the project: key ${why}, so no field was filled in; add the missing ones by hand`);
    return { ok: true, file, action: 'kept', profile: null, block: null, warnings };
  };
  if (existing.errors.length) return kept(`cannot be read (${existing.errors[0]})`);
  if (existing.block !== null && !isMap(existing.block)) return kept('is not a map of fields');
  const set = existing.block ?? {};

  // Split on LF alone, so a CRLF line keeps its CR and every untouched line its bytes.
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex(line => KEY_LINE.test(line));
  if (!/^project\s*:\s*(?:#.*)?\r?$/.test(lines[start])) return kept('is written on one line');
  const cr = text.includes('\r\n') ? '\r' : '';
  let last = start;
  for (let at = start + 1; at < lines.length; at++) {
    const line = lines[at].replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) break;
    last = at;
  }
  const inBlock = lines.slice(start + 1, last + 1).map(line => line.replace(/\r$/, ''));
  const indent = (inBlock.find(line => /^\s+[^\s#]/.test(line)) ?? inBlock.find(line => /^\s+#/.test(line)) ?? '  ').match(/^\s*/)[0] || '  ';

  const profile = {};
  const appended = [];
  for (const [name, accepted] of Object.entries(FIELDS)) {
    const value = detected[name];
    if (value === undefined || value === null || (set[name] !== undefined && set[name] !== null)) continue;
    const judged = judgeField(name, value);
    if (!judged.ok) {
      warnings.push(`project-profile: ${name} ${judged.why}; it is not written`);
      continue;
    }
    profile[name] = judged.value;
    const line = `${indent}${name}: ${scalar(judged.value)}  # ${Array.isArray(accepted) ? accepted.join(' | ') : HINTS[name]}`;
    const empty = new RegExp(`^\\s+${name}\\s*:\\s*(?:#.*)?$`);
    const commented = new RegExp(`^\\s+#\\s*${name}\\s*:`);
    const at = [empty, commented].map(pattern => inBlock.findIndex(each => pattern.test(each))).find(found => found >= 0);
    if (at === undefined) appended.push(`${line}${cr}`);
    else {
      lines[start + 1 + at] = `${line}${lines[start + 1 + at].endsWith('\r') ? '\r' : ''}`;
      inBlock[at] = line;
    }
  }
  if (Object.keys(profile).length === 0) return { ok: true, file, action: 'kept', profile: null, block: null, warnings };

  if (appended.length) {
    // A block that ends the file with no newline after it gets one, and so does the file.
    if (last === lines.length - 1) {
      lines[last] += cr;
      lines.push('');
    }
    lines.splice(last + 1, 0, ...appended);
  }
  writeText(file, lines.join('\n'));
  const block = `${lines.slice(start, last + 1 + appended.length).map(line => line.replace(/\r$/, '')).join('\n')}\n`;
  return { ok: true, file, action: 'filled', profile, block, warnings };
}

/** The comment a written block opens with. */
const HEADER = [
  '# project — what this project is, so the reviewers check what applies to it: no health',
  '# endpoint or rate limits for a CLI, no down-migrations without a data store. Every field',
  '# is optional, and one left out rules no check out. Filled in by init from its project',
  '# analysis; correct any line. A run freezes it when it starts.',
];

/** A value as the block writes it: a bare word when it can be one, else quoted. */
function scalar(value) {
  if (Array.isArray(value)) return `[${value.map(scalar).join(', ')}]`;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(value) ? value : JSON.stringify(value);
}

/** Write through a temp twin and a rename, so a reader never sees half a file. */
function writeText(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value) {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return `a list (${JSON.stringify(value)})`;
  if (typeof value === 'object') return 'a map';
  return JSON.stringify(value);
}
