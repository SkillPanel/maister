/**
 * The standards groups resolver: which groups of standards suit this project,
 * and which of them its standards folder already holds?
 *
 *   node <path to this file> groups [--kind=<kind>] [--ui=<ui>] [--deploy=<deploy>]
 *       [--data="<store>,<store>"] [--signals="<signal>,<signal>"] [--monorepo]
 *       [--root=<dir>] [--standards-dir=<dir>]
 *
 * Run from the project root. Exec form, no shebang, zero dependencies, `node:`
 * builtins only, Node >= 20. The groups, their files, the conditions that
 * recommend each one, discovery's file filters and the files older setups held
 * a group's rules in all come from the group table, `../docs/standards-groups.json`
 * beside this script; nothing here names a group but the mobile group, whose
 * conditions decide precedence.
 *
 * Flags. Each is `--name=value`, the value only after `=`; a flag given twice is
 * refused.
 *   --kind, --ui, --deploy   a profile field, one of the values the project
 *                            profile takes
 *   --data                   the stores the project writes, a comma list; an
 *                            empty value (`--data=""`) is none
 *   --signals                the analyzer's signals found, a comma list of the
 *                            table's signal ids; absent or empty is none
 *   --monorepo               no value: the project is a monorepo or umbrella, so
 *                            every group any of its apps calls for is recommended
 *   --root                   the project root, default the current directory
 *   --standards-dir          the standards folder whose groups count as present,
 *                            default `<root>/.maister/docs/standards`; a default
 *                            folder that does not exist holds nothing
 *
 * The profile. When any of --kind, --ui, --deploy or --data is given, the profile
 * is those flags alone (`source: "flags"`). With none, it is the `project:` block
 * of `.maister/config.yml`, read by the workflow engine's reader and limited to
 * those four fields (`source: "config"`); with no usable block, there is none
 * (`source: "none"`). A bad block is a warning, never a refusal.
 *
 * Conditions. A group is recommended when any alternative of its `when` holds:
 * `{always}` holds; `{field, in}` when the field is set to a listed value;
 * `{field, any_except}` when the field lists an entry outside the list,
 * case-folded; `{field, not_in}` when the field is absent or set to a value
 * outside the list; `{all}` when every part holds; `{signal}` when the signal was
 * found. A field test on an absent field fails, apart from `not_in`, so a field
 * left out never removes a group another alternative selects. Precedence: in a
 * single app, an alternative marked `yields_to_mobile` does not hold when any
 * alternative of the mobile group's own `when` holds; `--monorepo` turns this off.
 *
 * Output: one JSON report on stdout, keys in this order —
 *   ok               true
 *   profile          {source, fields}
 *   signals          the signal ids found, in table order
 *   monorepo         boolean
 *   standards_dir    absolute path
 *   recommended      [{id, title, reasons}] in table order; a reason is
 *                    {always: true}, {field, value} (for data, its database
 *                    entries) or {signal}
 *   present          [{id, title?, via, paths, custom?, empty?}]: the table's
 *                    groups the folder holds, in table order, `via: "folder"`
 *                    when the group's folder holds Markdown at any depth or
 *                    `via: "pre-change"` when only the files an older setup held
 *                    its rules in exist; then the folder's other top-level
 *                    folders, by name, with `custom: true`, and `empty: true`
 *                    when one holds no Markdown yet, as a group of the project's
 *                    own does when init has just created it. `paths` are
 *                    relative to standards_dir and `/`-separated
 *   absent           the recommended ids not present
 *   not_recommended  [{id, title, outranked?}]: `outranked` lists the signals
 *                    precedence set aside
 *   groups           the table's groups as [{id, title, files, filter}]
 *   warnings         strings
 *
 * Exit codes. 0 with the report. 1 when the input is refused — on purpose, unlike
 * docs-check.mjs, whose usage error exits 2: a refusal here is an answer the
 * caller acts on, correcting the input it names and running again. stdout then
 * holds `{ok: false, errors: [{code, message}]}` and stderr each message, prefixed
 * `standards:`. The codes: standards-unknown-verb, standards-unknown-flag,
 * standards-flag-needs-value, standards-flag-repeated, standards-bad-value,
 * standards-unknown-signal, standards-bad-root. 2 when the resolver itself
 * cannot run — the table cannot be read or parsed, or an unexpected error — with
 * the message on stderr only.
 *
 * Read-only: it reads the table, the config and the folder listing, and never
 * writes or deletes a file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELDS, projectProfile } from '../../workflow-engine/scripts/lib/project-profile.mjs';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const TABLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'standards-groups.json');
const DEFAULT_STANDARDS = path.join('.maister', 'docs', 'standards');
const VERB = 'groups';
const MOBILE = 'mobile';

/** The profile fields the conditions read, in the profile's own order. */
const PROFILE_FIELDS = Object.keys(FIELDS).filter(name => ['kind', 'ui', 'deploy', 'data'].includes(name));
const ENUM_FIELDS = PROFILE_FIELDS.filter(name => Array.isArray(FIELDS[name]));
const LIST_FLAGS = ['data', 'signals'];
const PATH_FLAGS = ['root', 'standards-dir'];
const FLAGS = [...ENUM_FIELDS, ...LIST_FLAGS, 'monorepo', ...PATH_FLAGS];

/** A refused input: the caller corrects it and runs again. */
class Refusal extends Error {
  constructor(errors) {
    super(errors.map(each => each.message).join('; '));
    this.errors = errors;
  }
}

function readTable() {
  let table;
  try {
    table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
  } catch (error) {
    throw new Error(`the group table ${TABLE} cannot be read: ${error.message}`);
  }
  if (!Array.isArray(table?.signals) || !Array.isArray(table?.groups) || !table.groups.some(group => group.id === MOBILE)) {
    throw new Error(`the group table ${TABLE} needs a signals list and a groups list holding the ${MOBILE} group`);
  }
  return table;
}

/** What a flag takes, for the message that refuses it. */
function takes(name, table) {
  if (ENUM_FIELDS.includes(name)) return `one of ${FIELDS[name].join(', ')}`;
  if (name === 'data') return 'a comma list of store names, or "" for none';
  if (name === 'signals') return `a comma list of ${table.signals.map(each => each.id).join(', ')}, or "" for none`;
  if (name === 'monorepo') return 'no value';
  return 'a directory';
}

function parseArgs(argv, table) {
  const errors = [];
  const refuse = (code, message) => errors.push({ code, message });
  const [verb, ...rest] = argv;
  if (verb === undefined || verb.startsWith('--')) {
    refuse('standards-unknown-verb', `no verb given; the one verb is ${VERB}`);
    if (verb !== undefined) rest.unshift(verb);
  } else if (verb !== VERB) {
    refuse('standards-unknown-verb', `unknown verb "${verb}"; the one verb is ${VERB}`);
  }

  const flags = {};
  for (const arg of rest) {
    const match = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    const name = match?.[1];
    if (!match || !FLAGS.includes(name)) {
      refuse('standards-unknown-flag', `unknown argument "${arg}"; the flags are ${FLAGS.map(flag => `--${flag}`).join(', ')}, each written --name=value`);
      continue;
    }
    if (Object.hasOwn(flags, name)) {
      refuse('standards-flag-repeated', `the flag --${name} was given more than once; it takes ${takes(name, table)}, once`);
      continue;
    }
    const value = match[2];
    flags[name] = value ?? true;
    if (name === 'monorepo') {
      if (value !== undefined) refuse('standards-bad-value', `the flag --monorepo takes no value, not "${value}"`);
    } else if (value === undefined || (value === '' && !LIST_FLAGS.includes(name))) {
      refuse('standards-flag-needs-value', `the flag --${name} needs a value after "=": ${takes(name, table)}`);
    } else if (ENUM_FIELDS.includes(name) && !FIELDS[name].includes(value)) {
      refuse('standards-bad-value', `--${name}=${value} is not a value it takes; it takes ${takes(name, table)}`);
    } else if (name === 'signals') {
      const known = table.signals.map(each => each.id);
      for (const signal of list(value).filter(each => !known.includes(each))) {
        refuse('standards-unknown-signal', `unknown signal "${signal}"; --signals takes ${takes(name, table)}`);
      }
    }
  }

  if (typeof flags.root === 'string' && flags.root !== '' && !isDirectory(path.resolve(flags.root))) {
    refuse('standards-bad-root', `--root=${flags.root} is not a directory; it takes the project root, a directory that exists`);
  }
  if (typeof flags['standards-dir'] === 'string' && flags['standards-dir'] !== '' && !isDirectory(path.resolve(flags['standards-dir']))) {
    refuse('standards-bad-root', `--standards-dir=${flags['standards-dir']} is not a directory; it takes a standards folder that exists`);
  }
  if (errors.length) throw new Refusal(errors);
  return flags;
}

/** A comma list, its items trimmed and the empty ones dropped. */
function list(value) {
  return value.split(',').map(item => item.trim()).filter(item => item !== '');
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The profile in use: `{source, fields}`, and the engine's warnings when it was read from the config. */
function profileOf(flags, root) {
  if (PROFILE_FIELDS.some(name => Object.hasOwn(flags, name))) {
    const fields = {};
    for (const name of PROFILE_FIELDS) {
      if (!Object.hasOwn(flags, name)) continue;
      fields[name] = FIELDS[name] === 'list' ? list(flags[name]) : flags[name];
    }
    return { profile: { source: 'flags', fields }, warnings: [] };
  }
  const read = projectProfile(root);
  if (read.profile === null) return { profile: { source: 'none', fields: {} }, warnings: read.warnings };
  const fields = {};
  for (const name of PROFILE_FIELDS) if (Object.hasOwn(read.profile, name)) fields[name] = read.profile[name];
  return { profile: { source: 'config', fields }, warnings: read.warnings };
}

/**
 * The reasons a condition holds for, or null when it does not. A `not_in` part
 * holds with no reason of its own.
 */
function reasonsFor(condition, fields, signals) {
  if (condition.always === true) return [{ always: true }];
  if (Array.isArray(condition.all)) {
    const reasons = [];
    for (const part of condition.all) {
      const held = reasonsFor(part, fields, signals);
      if (held === null) return null;
      reasons.push(...held);
    }
    return reasons;
  }
  if (typeof condition.signal === 'string') return signals.has(condition.signal) ? [{ signal: condition.signal }] : null;
  if (typeof condition.field === 'string') {
    const value = fields[condition.field];
    if (Array.isArray(condition.not_in)) return value === undefined || !condition.not_in.includes(value) ? [] : null;
    if (value === undefined) return null;
    if (Array.isArray(condition.in)) return condition.in.includes(value) ? [{ field: condition.field, value }] : null;
    if (Array.isArray(condition.any_except)) {
      const except = condition.any_except.map(each => each.toLowerCase());
      const entries = (Array.isArray(value) ? value : [value]).filter(entry => !except.includes(String(entry).toLowerCase()));
      return entries.length ? [{ field: condition.field, value: entries }] : null;
    }
  }
  throw new Error(`the group table holds a condition the resolver does not read: ${JSON.stringify(condition)}`);
}

/** The recommended groups, and the signals precedence set aside for each group it did. */
function recommend(table, fields, signals, monorepo) {
  const mobile = table.groups.find(group => group.id === MOBILE);
  const mobileSide = !monorepo && mobile.when.some(alternative => reasonsFor(alternative, fields, signals) !== null);
  const recommended = [];
  const notRecommended = [];
  for (const group of table.groups) {
    const reasons = [];
    const outranked = [];
    let held = false;
    for (const alternative of group.when) {
      const found = reasonsFor(alternative, fields, signals);
      if (found === null) continue;
      if (alternative.yields_to_mobile === true && mobileSide) {
        if (typeof alternative.signal === 'string') outranked.push(alternative.signal);
        continue;
      }
      held = true;
      reasons.push(...found);
    }
    if (held) recommended.push({ id: group.id, title: group.title, reasons });
    else notRecommended.push(outranked.length ? { id: group.id, title: group.title, outranked } : { id: group.id, title: group.title });
  }
  return { recommended, notRecommended };
}

/** Does `dir` hold a Markdown file at any depth? */
function holdsMarkdown(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue;
    const child = path.join(dir, dirent.name);
    if (dirent.isDirectory() ? holdsMarkdown(child) : /\.md$/i.test(dirent.name) && isFile(child)) return true;
  }
  return false;
}

/** The groups the standards folder holds: the table's, then the project's own. */
function presentIn(table, dir) {
  if (!isDirectory(dir)) return [];
  const present = [];
  for (const group of table.groups) {
    const folder = path.join(dir, group.id);
    const preChange = group.pre_change_files.filter(rel => isFile(path.join(dir, ...rel.split('/'))));
    if (isDirectory(folder) && holdsMarkdown(folder)) {
      present.push({ id: group.id, title: group.title, via: 'folder', paths: [group.id, ...preChange] });
    } else if (preChange.length) {
      present.push({ id: group.id, title: group.title, via: 'pre-change', paths: preChange });
    }
  }
  const known = new Set(table.groups.map(group => group.id));
  const own = fs.readdirSync(dir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.') && !known.has(dirent.name))
    .map(dirent => dirent.name)
    .sort();
  for (const name of own) {
    const entry = { id: name, via: 'folder', paths: [name], custom: true };
    if (!holdsMarkdown(path.join(dir, name))) entry.empty = true;
    present.push(entry);
  }
  return present;
}

function resolveGroups(table, flags) {
  const root = path.resolve(flags.root ?? '.');
  const standardsDir = path.resolve(flags['standards-dir'] ?? path.join(root, DEFAULT_STANDARDS));
  const { profile, warnings } = profileOf(flags, root);
  const found = new Set(typeof flags.signals === 'string' ? list(flags.signals) : []);
  const signals = table.signals.map(each => each.id).filter(id => found.has(id));
  const monorepo = flags.monorepo === true;

  const { recommended, notRecommended } = recommend(table, profile.fields, new Set(signals), monorepo);
  const present = presentIn(table, standardsDir);
  const held = new Set(present.map(each => each.id));
  return {
    ok: true,
    profile,
    signals,
    monorepo,
    standards_dir: standardsDir,
    recommended,
    present,
    absent: recommended.map(each => each.id).filter(id => !held.has(id)),
    not_recommended: notRecommended,
    groups: table.groups.map(({ id, title, files, filter }) => ({ id, title, files, filter })),
    warnings,
  };
}

function main() {
  let report;
  try {
    const table = readTable();
    report = resolveGroups(table, parseArgs(process.argv.slice(2), table));
  } catch (error) {
    if (error instanceof Refusal) {
      process.stdout.write(`${JSON.stringify({ ok: false, errors: error.errors }, null, 2)}\n`);
      for (const each of error.errors) process.stderr.write(`standards: ${each.message}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`standards: ${error.message}\n`);
    return EXIT.INTERNAL;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return EXIT.OK;
}

process.exitCode = main();
