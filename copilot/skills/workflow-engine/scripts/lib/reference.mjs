/**
 * The `reference` verb: a section of one of this plugin's own Markdown files,
 * printed, so a session reads the plugin's rules through a command instead of
 * opening the file.
 *
 * Why this module exists. The plugin is installed outside the project, and a
 * host may stop the run to ask before a session reads a file there: Claude
 * Code's auto mode asks at the first read outside the working directories,
 * and one answer can block every later one. A command that prints the text is
 * not such a read. Shell output is cut off past a size, and a cut-off output
 * lands in a file the session would have to read back, so a print is held
 * under `PRINT_MAX` characters and a section is asked for by its heading.
 *
 * The contract. Each `--at` is `<file>`, `<file> § <heading>` or
 * `<file> § <heading> § <row>`. The file is an
 * absolute path, or a path relative to the workflow engine's skill folder
 * (`SKILL.md`, `references/gates.md`, `../orchestrator-framework/…`) or to the
 * plugin root (`skills/…`, `agents/…`); a leading `<plugin root>/` is dropped.
 * It must be a `.md` file inside the plugin. The heading is matched with its
 * `#`s, emphasis markers and backticks removed, spacing folded and case
 * ignored: an exact match first, else every heading that starts with it. A
 * section runs to the next heading outside a fence at its level or higher; the
 * file's `#` title runs to its first `##`, so naming the title prints the
 * file's opening. Without a heading the whole file prints, its frontmatter
 * left out. A row names a table row of the section by its first cell (a
 * refusal code, say), matched as a heading is: the section's heading, the
 * table's header and that row print, so one row of a long table is asked for
 * without the table; a first cell grouping several codes is found by any
 * one of them. Picker passages print as the build's reader sees them
 * (`readerRows`). Each part opens with `== <file> § <heading>`.
 *
 * Refusals, nothing printed: `reference-outside-plugin`, `reference-missing`,
 * `reference-unknown-section` (the file's headings listed) and
 * `reference-too-long` (the print would pass `PRINT_MAX`; the headings of each
 * file named are listed with their sections' sizes, so the caller can ask for
 * one). Reads only. `node:` builtins and engine libs only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Refusal } from '../../../../lib/canonical.mjs';
import { guideRows, readerRows } from './graph.mjs';

/** The most characters one call prints: below the hosts' cut-off for a shell command's output. */
export const PRINT_MAX = 20_000;

/** The spellings of the plugin root a pointer may open with. */
const ROOT_PREFIX = /^(?:<plugin[ _]root>|\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)[\\/]/;

/** The deepest heading the too-long listing names. */
const LIST_LEVEL = 3;

/** Print each `at` of `ats`, the plugin at `pluginRoot`: `{ok, text}` or `{ok: false, errors}`. */
export function reference({ ats, pluginRoot }) {
  const root = fs.realpathSync(pluginRoot);
  const engineDir = path.join(root, 'skills', 'workflow-engine');
  const parts = [];
  const files = [];
  for (const at of ats) {
    const { file: given, heading, row } = split(at);
    const file = locate(given, { root, engineDir });
    if (file.error) return file.error;
    const shown = path.relative(root, file.path).split(path.sep).join('/');
    const rows = guideRows(fs.readFileSync(file.path, 'utf8'));
    files.push({ shown, rows });
    if (heading === null) {
      parts.push(`== ${shown}\n${render(rows.slice(bodyStart(rows)))}`);
      continue;
    }
    const sections = sectionsOf(rows);
    const wanted = fold(heading);
    let found = sections.filter(each => each.key === wanted);
    if (found.length === 0) found = sections.filter(each => each.key.startsWith(wanted));
    if (found.length === 0) {
      return refuse('reference-unknown-section',
        `${shown} has no heading "${heading}". Nothing was printed. Its headings:\n${sections.map(each => `${'#'.repeat(each.level)} ${each.title}`).join('\n')}`);
    }
    if (row !== null) {
      const picked = rowOf(rows, found[0], row);
      if (picked.error) return picked.error;
      parts.push(`== ${shown} § ${found[0].title} § ${row}\n${picked.text}`);
      continue;
    }
    for (const section of found) parts.push(`== ${shown} § ${section.title}\n${render(rows.slice(section.at, section.end))}`);
  }
  const text = `${parts.map(part => part.replace(/\s+$/, '')).join('\n\n')}\n`;
  if (text.length > PRINT_MAX) {
    const listing = files.map(({ shown, rows }) => `${shown}:\n${sectionsOf(rows)
      .filter(each => each.level <= LIST_LEVEL)
      .map(each => `  ${'#'.repeat(each.level)} ${each.title} (${each.size} characters)`).join('\n')}`).join('\n');
    return refuse('reference-too-long',
      `the print would be ${text.length} characters, past the ${PRINT_MAX} a shell output holds whole. Nothing was printed. `
      + `Name a section with --at="<file> § <heading>", one whose size fits, or one row of a section's table with --at="<file> § <heading> § <its first cell>":\n${listing}`);
  }
  return { ok: true, text };
}

/**
 * ` § <code>` when the section `heading` of the file at the absolute path
 * `file` has a table row whose first cell holds `code`, and the empty string
 * otherwise: the tail a pointer to that section gains to name its own row.
 * The file is read only when a code is given; one that cannot be read gives
 * the empty string.
 */
export function rowSuffix(file, heading, code) {
  if (typeof code !== 'string' || code === '') return '';
  try {
    const rows = guideRows(fs.readFileSync(file, 'utf8'));
    const section = sectionsOf(rows).find(each => each.key === fold(heading));
    if (section && !rowOf(rows, section, code).error) return ` § ${code}`;
  } catch {
    // an unreadable file keeps the bare pointer
  }
  return '';
}

/** `<file> § <heading> § <row>` split at its `§`s; a part left out is null. */
function split(at) {
  const [given, heading = '', ...rest] = at.split('§').map(part => part.trim());
  const row = rest.join('§').trim();
  // A `rules:` line quotes a path holding a space as a shell would; copied whole, the quotes go.
  const file = /^'.*'$/s.test(given) ? given.slice(1, -1).replace(/'\\''/g, "'") : given;
  return { file, heading: heading === '' ? null : heading, row: row === '' ? null : row };
}

/**
 * The table rows of `section` whose first cell reads as `row`, with the
 * section's heading and each table's header: `{text}`, or the refusal naming
 * the rows the section has.
 */
function rowOf(rows, section, row) {
  const lines = readerRows(rows.slice(section.at, section.end)).map(each => each.text);
  const cell = line => fold(line.split('|')[1] ?? '');
  // A first cell may group several codes (`a`, `b`); naming any one of them finds the row.
  const names = line => [cell(line), ...cell(line).split(',').map(each => each.trim())];
  const isRow = line => /^\s*\|/.test(line);
  const isRule = line => /^\s*\|[\s:|-]+\|\s*$/.test(line);
  const kept = [lines[0], ''];
  const keys = [];
  for (const [at, line] of lines.entries()) {
    if (!isRow(line) || isRule(line) || isRule(lines[at + 1] ?? '')) continue;
    keys.push(cell(line));
    if (!names(line).includes(fold(row))) continue;
    // The table's header: the row above its rule line, found upwards.
    let top = at;
    while (top > 0 && isRow(lines[top - 1])) top -= 1;
    if (!kept.includes(lines[top])) kept.push(lines[top], lines[top + 1]);
    kept.push(line);
  }
  if (kept.length === 2) {
    return { error: refuse('reference-unknown-section',
      `the section "${section.title}" has no table row "${row}". Nothing was printed. Its rows: ${keys.join(', ')}`) };
  }
  return { text: kept.join('\n') };
}

/** The plugin file `given` names, or the refusal for it. */
function locate(given, { root, engineDir }) {
  const bare = given.replace(ROOT_PREFIX, '');
  const candidates = path.isAbsolute(bare) ? [bare] : [path.join(engineDir, bare), path.join(root, bare)];
  const existing = candidates.find(each => isFile(each));
  if (!existing) {
    const inside = candidates.some(each => within(root, path.resolve(each)));
    if (!inside) return { error: outside(given) };
    return { error: refuse('reference-missing', `${given} names no file of the plugin. Nothing was printed. Name it from the plugin root (skills/…, agents/…) or from the workflow engine's folder (references/…)`) };
  }
  const real = fs.realpathSync(existing);
  if (!within(root, real) || path.extname(real).toLowerCase() !== '.md') return { error: outside(given) };
  return { path: real };
}

function outside(given) {
  return refuse('reference-outside-plugin', `${given} is not a Markdown file of the plugin. Nothing was printed. The verb prints the plugin's own .md files only`);
}

const isFile = file => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
};

/** A heading's text as the match reads it: no `#`s, emphasis or backticks, spacing folded, lower case. */
const fold = text => text.replace(/^#+\s*/, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Every heading outside a fence as a section: `{title, key, level, at, end,
 * size}`, `end` the next heading at its level or higher (a `#` title's at the
 * next `##` or `#`), `size` the characters it prints.
 */
function sectionsOf(rows) {
  const headings = rows.filter(row => row.level !== null);
  return headings.map((row, index) => {
    const stop = row.level === 1 ? 2 : row.level;
    const next = headings.slice(index + 1).find(other => other.level <= stop);
    const end = next ? next.line : rows.length;
    const title = row.text.replace(/^#+\s*/, '').trim();
    return { title, key: fold(row.text), level: row.level, at: row.line, end, size: render(rows.slice(row.line, end)).length };
  });
}

/** The first row after a leading frontmatter block, or 0 without one. */
function bodyStart(rows) {
  if (rows.length === 0 || rows[0].text.trim() !== '---') return 0;
  const close = rows.findIndex((row, index) => index > 0 && row.text.trim() === '---');
  return close === -1 ? 0 : close + 1;
}

/** Rows as text, picker passages as the reader sees them, leading and trailing blank lines dropped. */
function render(rows) {
  return readerRows(rows).map(row => row.text).join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

function refuse(code, message) {
  return { ok: false, errors: [new Refusal(code, message)] };
}
