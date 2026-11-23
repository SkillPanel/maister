/**
 * The standards groups resolver answers two questions. Which groups of
 * standards suit this project, and which of them does its standards folder
 * already hold (`groups`)? And which built-in rules changed since the
 * project's copy was made (`built-in candidates`)?
 *
 *   node <path to this file> groups [--kind=<kind>] [--ui=<ui>] [--deploy=<deploy>]
 *       [--data="<store>,<store>"] [--signals="<signal>,<signal>"] [--monorepo]
 *       [--root=<dir>] [--standards-dir=<dir>]
 *   node <path to this file> built-in candidates [the same flags]
 *       [--add-groups="<group>,<group>"]
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
 *   --add-groups             built-in candidates only: the groups being added, a
 *                            comma list of the table's group ids; an empty value
 *                            (`--add-groups=""`) is none, and leaving the flag
 *                            out adds the recommended groups the folder lacks
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
 * Built-in candidates. The verb reads the group table, the rename and removal
 * map (`../docs/standards-map.json`: each rule an earlier version shipped,
 * with its shipped text, its fate and its home now, and the rules added
 * since), the bundled tree (`../docs/standards/`), the profile, and every
 * `.md` file at any depth under the standards folder, names starting with `.`
 * skipped. One parser reads local and bundled files: a section runs from a
 * `### ` line to the line before the next `# `, `## ` or `### ` line, or to
 * the end; a line inside a ``` or ~~~ fence is never a heading. A section is
 * known by its `/`-separated path and its heading, whitespace collapsed. Texts
 * are compared normalised: LF line endings, each run of spaces and tabs one
 * space, no trailing space, no leading or trailing blank line; line breaks
 * stay. Each map rule found at its path and heading is classified once, in
 * order: held (it reads as the bundled text at its home), unedited (it reads
 * as shipped), edited. A bundled rule at its bundled path is current and left
 * out; any other section is the team's, and a heading repeated in one file is
 * the team's, each occurrence marked duplicate. Candidates: the unedited rules
 * of one home make one `update:<home id>`; each edited rule is its own
 * `edited:<rule id>`, never recommended; each unedited dropped rule is its own
 * `remove:<rule id>`. A candidate removes the sections it covers and writes
 * the home's bundled text unless the home file already holds a section with
 * the home heading other than its own (`home.held`); its action is remove,
 * replace, move or merge by what it does to the files. An `update:` whose
 * home a section of the team's own holds is not recommended and is asked
 * with the edited candidates. Adds: each map `new` rule of a held or added
 * group, and every bundled rule of an added group, make one `add:<home id>`
 * when none of that home's earlier rules was found and the home file lacks
 * its heading.
 *
 * Output of groups: one JSON report on stdout, keys in this order —
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
 * Output of built-in candidates, keys in this order —
 *   ok, profile, signals, monorepo, standards_dir   as for groups
 *   groups           {held, adding, adding_from, not_recommended_held}: the
 *                    table groups held, the groups being added, `"flag"` or
 *                    `"profile"`, and the held groups the profile and signals
 *                    do not call for (none when there is nothing to judge by)
 *   candidates       the recommended `update:` and `remove:` ones by the map
 *                    position of the first rule each covers, then the adds in
 *                    bundled order, then the edited ones in map order, each
 *                    unrecommended `update:` after the edited candidate holding
 *                    its home heading, else after the last edited one before it,
 *                    else first among the unrecommended
 *   held             [{id, path, heading}] in map order
 *   team             [{path, heading, duplicate?}] in path order, then file order
 *   counts           {found, held, team, candidates, recommended, edited}
 *   warnings         strings
 * A candidate's keys, in order: id, action (add, remove, replace, move or
 * merge), recommended, group, covers (the rule ids it removes, in map order),
 * sections ([{id, path, heading, text, shipped, edited}]), home (null for a
 * dropped rule, else {id, path, heading, text, held, current, creates_file,
 * file_title, preceding}), empties (the files its removals leave with nothing
 * but headings) and reason (one plain sentence).
 *
 * Exit codes. 0 with the report. 1 when the input is refused — on purpose, unlike
 * docs-check.mjs, whose usage error exits 2: a refusal here is an answer the
 * caller acts on, correcting the input it names and running again. stdout then
 * holds `{ok: false, errors: [{code, message}]}` and stderr each message, prefixed
 * `standards:`. The codes: standards-unknown-verb, standards-unknown-flag,
 * standards-flag-needs-value, standards-flag-repeated, standards-bad-value,
 * standards-unknown-signal, standards-unknown-group, standards-bad-root. 2 when
 * the resolver itself cannot run — the table, the map or the bundled tree
 * cannot be read or parsed, the map names a rule the bundled tree lacks, or an
 * unexpected error — with the message on stderr only.
 *
 * Read-only: it reads the table, the map, the bundled tree, the config and the
 * standards folder, and never writes, creates or deletes a file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELDS, projectProfile } from '../../workflow-engine/scripts/lib/project-profile.mjs';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const TABLE = path.join(DOCS, 'standards-groups.json');
const MAP = path.join(DOCS, 'standards-map.json');
const BUNDLED = path.join(DOCS, 'standards');
const DEFAULT_STANDARDS = path.join('.maister', 'docs', 'standards');
const GROUPS = 'groups';
const CANDIDATES = 'built-in candidates';
const THE_VERBS = `the verbs are ${GROUPS} and ${CANDIDATES}`;
const MOBILE = 'mobile';

/** The profile fields the conditions read, in the profile's own order. */
const PROFILE_FIELDS = Object.keys(FIELDS).filter(name => ['kind', 'ui', 'deploy', 'data'].includes(name));
const ENUM_FIELDS = PROFILE_FIELDS.filter(name => Array.isArray(FIELDS[name]));
const LIST_FLAGS = ['data', 'signals', 'add-groups'];
const PATH_FLAGS = ['root', 'standards-dir'];
const GROUPS_FLAGS = [...ENUM_FIELDS, 'data', 'signals', 'monorepo', ...PATH_FLAGS];
/** Each verb's flags, in the order its unknown-flag message lists them. */
const VERB_FLAGS = { [GROUPS]: GROUPS_FLAGS, [CANDIDATES]: [...GROUPS_FLAGS, 'add-groups'] };

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
  if (name === 'add-groups') return `a comma list of ${table.groups.map(each => each.id).join(', ')}, or "" for none`;
  if (name === 'monorepo') return 'no value';
  return 'a directory';
}

/**
 * The verb and its flags. `groups` takes its flags from `argv[1]`, `built-in
 * candidates` from `argv[2]`; the flags after an unknown verb are checked
 * against the groups verb's.
 */
function parseArgs(argv, table) {
  const errors = [];
  const refuse = (code, message) => errors.push({ code, message });
  const [first, second] = argv;
  let verb = null;
  let rest;
  if (first === undefined || first.startsWith('--')) {
    refuse('standards-unknown-verb', `no verb given; ${THE_VERBS}`);
    rest = argv;
  } else if (first === GROUPS) {
    verb = GROUPS;
    rest = argv.slice(1);
  } else if (first === 'built-in' && second === 'candidates') {
    verb = CANDIDATES;
    rest = argv.slice(2);
  } else {
    const words = first === 'built-in' && second !== undefined && !second.startsWith('--') ? [first, second] : [first];
    refuse('standards-unknown-verb', `unknown verb "${words.join(' ')}"; ${THE_VERBS}`);
    rest = argv.slice(words.length);
  }
  const allowed = VERB_FLAGS[verb ?? GROUPS];

  const flags = {};
  for (const arg of rest) {
    const match = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    const name = match?.[1];
    if (!match || !allowed.includes(name)) {
      refuse('standards-unknown-flag', `unknown argument "${arg}"; the flags are ${allowed.map(flag => `--${flag}`).join(', ')}, each written --name=value`);
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
    } else if (name === 'add-groups') {
      const known = table.groups.map(each => each.id);
      for (const group of list(value).filter(each => !known.includes(each))) {
        refuse('standards-unknown-group', `unknown group "${group}"; --add-groups takes ${takes(name, table)}`);
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
  return { verb, flags };
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

/** What both verbs read from the flags, the config and the folder listing. */
function context(table, flags) {
  const root = path.resolve(flags.root ?? '.');
  const standardsDir = path.resolve(flags['standards-dir'] ?? path.join(root, DEFAULT_STANDARDS));
  const { profile, warnings } = profileOf(flags, root);
  const found = new Set(typeof flags.signals === 'string' ? list(flags.signals) : []);
  const signals = table.signals.map(each => each.id).filter(id => found.has(id));
  const monorepo = flags.monorepo === true;
  const { recommended, notRecommended } = recommend(table, profile.fields, new Set(signals), monorepo);
  const present = presentIn(table, standardsDir);
  return { standardsDir, profile, warnings, signals, monorepo, recommended, notRecommended, present };
}

function resolveGroups(table, flags) {
  const { standardsDir, profile, warnings, signals, monorepo, recommended, notRecommended, present } = context(table, flags);
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

/* ---- built-in candidates ---------------------------------------------- */

/** A section's identity: its `/`-separated path under a standards folder, and its heading. */
const keyOf = (rel, heading) => `${rel}#${heading}`;

/** The slug of a heading, as the map's ids and the home ids spell it. */
function slug(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-').replace(/-+/g, '-');
}

/** `<group>/<stem>#<slug>` of a rule at `rel` under `heading`. */
const idOf = (rel, heading) => `${rel.replace(/\.md$/i, '')}#${slug(heading)}`;

const isBlank = line => /^[ \t]*$/.test(line);

/** `lines` without their leading and trailing blank lines. */
function trimBlank(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start += 1;
  while (end > start && isBlank(lines[end - 1])) end -= 1;
  return lines.slice(start, end);
}

/**
 * The form two texts are compared in: LF line endings, each run of spaces and
 * tabs one space, no trailing space, no leading or trailing blank line. Line
 * breaks stay, so a reflowed rule reads as edited.
 */
function normalise(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  return trimBlank(lines).join('\n');
}

/**
 * A Markdown file's lines (LF) and its `###` sections. A section runs from its
 * `### ` line to the line before the next `# `, `## ` or `### ` line, or to the
 * end; a line inside a ``` or ~~~ fence is never a heading, and a `####` line
 * stays inside its section. Each section carries its heading (whitespace
 * collapsed, trimmed), its line range, its text (trimmed of blank lines,
 * otherwise as written) and that text normalised.
 */
function parseSections(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let open = null;
  let fence = null;
  const close = end => {
    if (open) sections.push({ ...open, end });
    open = null;
  };
  lines.forEach((line, index) => {
    if (fence !== null) {
      if (line.startsWith(fence)) fence = null;
      return;
    }
    if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3);
      return;
    }
    if (/^#{1,3} /.test(line)) {
      close(index);
      if (line.startsWith('### ')) open = { heading: line.slice(4).replace(/\s+/g, ' ').trim(), start: index };
    }
  });
  close(lines.length);
  for (const section of sections) {
    section.text = trimBlank(lines.slice(section.start, section.end)).join('\n');
    section.normal = normalise(section.text);
  }
  return { lines, sections };
}

/** The rename and removal map, checked for the shape the verb reads. */
function readMap() {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  } catch (error) {
    throw new Error(`the standards map ${MAP} cannot be read: ${error.message}`);
  }
  if (map?.format !== 1 || !Array.isArray(map.rules) || !Array.isArray(map.new)) {
    throw new Error(`the standards map ${MAP} needs format 1 and a rules list and a new list`);
  }
  return map;
}

/**
 * The bundled tree, in bundled order: the group table's groups, each group's
 * files, each file's sections. Each rule by its key, with its text, its file's
 * `## ` title line and the headings before it in its file, nearest first.
 */
function readBundled(table, map) {
  const rules = new Map();
  for (const group of table.groups) {
    for (const file of group.files) {
      const rel = `${group.id}/${file}`;
      let source;
      try {
        source = fs.readFileSync(path.join(BUNDLED, group.id, file), 'utf8');
      } catch (error) {
        throw new Error(`the bundled standards file ${rel} cannot be read: ${error.message}`);
      }
      const { lines, sections } = parseSections(source);
      const title = lines.find(line => line.startsWith('## ')) ?? null;
      sections.forEach((section, index) => {
        rules.set(keyOf(rel, section.heading), {
          path: rel,
          heading: section.heading,
          group: group.id,
          order: rules.size,
          text: section.text,
          normal: section.normal,
          file_title: title,
          preceding: sections.slice(0, index).map(each => each.heading).reverse(),
        });
      });
    }
  }
  const missing = [
    ...map.rules.filter(rule => rule.home !== null).map(rule => rule.home),
    ...map.new,
  ].filter(home => !rules.has(keyOf(home.path, home.heading)));
  if (missing.length) {
    throw new Error(`the standards map names rules the bundled tree lacks: ${missing.map(home => `${home.path} "${home.heading}"`).join(', ')}`);
  }
  return rules;
}

/**
 * Every `.md` file at any depth under the standards folder, by its
 * `/`-separated path, in path order, entries whose names start with `.`
 * skipped. A folder that does not exist holds nothing; a file or folder that
 * cannot be read is a warning, and its sections are left out.
 */
function readLocal(dir, warnings) {
  const files = new Map();
  if (!isDirectory(dir)) return files;
  const walk = rel => {
    let entries;
    try {
      entries = fs.readdirSync(rel === '' ? dir : path.join(dir, ...rel.split('/')), { withFileTypes: true });
    } catch (error) {
      warnings.push(`the folder ${rel} cannot be read: ${error.message}; its files are left out`);
      return;
    }
    for (const dirent of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (dirent.name.startsWith('.')) continue;
      const child = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
      const full = path.join(dir, ...child.split('/'));
      if (dirent.isDirectory()) {
        walk(child);
      } else if (/\.md$/i.test(dirent.name) && isFile(full)) {
        try {
          files.set(child, parseSections(fs.readFileSync(full, 'utf8')));
        } catch (error) {
          files.set(child, null);
          warnings.push(`the file ${child} cannot be read: ${error.message}; its sections are left out`);
        }
      }
    }
  };
  walk('');
  return files;
}

/**
 * Each local section, once. A 2.2.x rule at its path and heading is held (its
 * text is the bundled text at its home), unedited (its text is the shipped
 * text) or edited. A bundled rule at its bundled path is current and left out.
 * Anything else is the team's; a heading repeated in one file is not
 * classified, each occurrence the team's with `duplicate: true`.
 */
function classify(map, bundled, local, warnings) {
  const rules = new Map(map.rules.map((rule, index) => [keyOf(rule.path, rule.heading), { rule, index }]));
  const found = [];
  const team = [];
  for (const [rel, parsed] of [...local].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (parsed === null) continue;
    const seen = new Map();
    for (const section of parsed.sections) seen.set(section.heading, (seen.get(section.heading) ?? 0) + 1);
    for (const section of parsed.sections) {
      if (seen.get(section.heading) > 1) {
        team.push({ path: rel, heading: section.heading, duplicate: true });
        continue;
      }
      const key = keyOf(rel, section.heading);
      const at = rules.get(key);
      if (at) {
        const home = at.rule.home && bundled.get(keyOf(at.rule.home.path, at.rule.home.heading));
        const state = home && section.normal === home.normal ? 'held'
          : section.normal === normalise(at.rule.shipped) ? 'unedited'
            : 'edited';
        found.push({ ...at, path: rel, section, state });
      } else if (!bundled.has(key)) {
        team.push({ path: rel, heading: section.heading });
      }
    }
    for (const [heading, times] of seen) {
      if (times > 1) warnings.push(`${rel} holds the heading "${heading}" ${times} times; each is left as your own and none is compared`);
    }
  }
  found.sort((a, b) => a.index - b.index);
  return { found, team };
}

/** The `groups` block: the table groups held, the groups being added, and held groups the profile does not call for. */
function groupsBlock(table, flags, ctx) {
  const held = ctx.present.filter(each => !each.custom).map(each => each.id);
  const recommended = ctx.recommended.map(each => each.id);
  let adding;
  let addingFrom;
  if (typeof flags['add-groups'] === 'string') {
    const listed = new Set(list(flags['add-groups']));
    adding = table.groups.map(each => each.id).filter(id => listed.has(id) && !held.includes(id));
    addingFrom = 'flag';
  } else {
    adding = recommended.filter(id => !held.includes(id));
    addingFrom = 'profile';
  }
  const unjudged = ctx.profile.source === 'none' && ctx.signals.length === 0;
  return {
    held,
    adding,
    adding_from: addingFrom,
    not_recommended_held: unjudged ? [] : held.filter(id => !recommended.includes(id)),
  };
}

/**
 * A candidate's `home`: the bundled rule it writes, and how the local tree
 * stands to it. The home is held when its file holds a `###` section with the
 * home heading other than the sections `entries` covers, and current when
 * that section reads as the bundled text.
 */
function homeOf(home, entries, data) {
  const rule = data.bundled.get(keyOf(home.path, home.heading));
  const holder = data.local.get(home.path)?.sections
    .find(section => section.heading === home.heading && !entries.some(entry => entry.section === section));
  const held = holder !== undefined;
  return {
    id: idOf(home.path, home.heading),
    path: home.path,
    heading: home.heading,
    text: rule.text,
    held,
    current: held && holder.normal === rule.normal,
    creates_file: !data.local.has(home.path),
    file_title: rule.file_title,
    preceding: rule.preceding,
  };
}

/**
 * The files the candidate's removals would leave with no `###` section and
 * nothing but `#`/`##` heading lines and blank lines. The home file a
 * candidate writes is never left empty.
 */
function emptiesOf(entries, home, writes, data) {
  const empties = [];
  for (const rel of new Set(entries.map(entry => entry.path))) {
    if (writes && rel === home.path) continue;
    const removed = new Set();
    for (const entry of entries.filter(each => each.path === rel)) {
      for (let line = entry.section.start; line < entry.section.end; line += 1) removed.add(line);
    }
    const left = data.local.get(rel).lines.filter((line, index) => !removed.has(index));
    if (left.every(line => isBlank(line) || /^#{1,2} /.test(line))) empties.push(rel);
  }
  return empties;
}

/**
 * One plain sentence: what became of the rules the candidate covers. A held
 * home names the section holding its heading; rules folded into a section of
 * the team's own (`folded`: `edited` when it is a rule the team edited,
 * `own` otherwise) say that section stays.
 */
function reasonOf(entries, home, folded) {
  if (home === null) return 'The plugin no longer ships this rule.';
  const already = `A rule headed ${home.heading} is already in ${home.path}`;
  if (folded === 'edited') return `Folded into ${home.heading}. ${already}: your own section, which stays unless you take the new rule there.`;
  if (folded === 'own') return `Folded into ${home.heading}. ${already}: a section of your own, which stays.`;
  if (home.held) return home.current ? `${already}, with the new text.` : `${already}.`;
  const rule = entries[0].rule;
  if (rule.fate === 'rewrite') {
    return rule.path === home.path ? `Rewritten as ${home.heading}.` : `Rewritten as ${home.heading} in ${home.path}.`;
  }
  return `Folded into ${home.heading} (${home.path}) with the other rules it replaces.`;
}

/**
 * A candidate covering `entries` (2.2.x rules found, in map order), its action
 * named by structure: remove when it writes nothing, replace for one section
 * in the home file, move for one section elsewhere, merge for two or more.
 * The unedited rules of a home the team's own section holds are not
 * recommended: that section stays unless the person chooses otherwise.
 */
function candidateOf(id, entries, data) {
  const home = entries[0].rule.home === null ? null : homeOf(entries[0].rule.home, entries, data);
  const writes = home !== null && !home.held;
  const action = !writes ? 'remove'
    : entries.length > 1 ? 'merge'
      : entries[0].path === home.path ? 'replace'
        : 'move';
  const edited = entries[0].state === 'edited';
  let folded = null;
  if (!edited && home !== null && home.held && !home.current) {
    folded = data.edited.has(keyOf(home.path, home.heading)) ? 'edited' : 'own';
  }
  return {
    id,
    action,
    recommended: !edited && folded === null,
    group: entries[0].path.split('/')[0],
    covers: entries.map(entry => entry.rule.id),
    sections: entries.map(entry => ({
      id: entry.rule.id,
      path: entry.path,
      heading: entry.section.heading,
      text: entry.section.text,
      shipped: entry.rule.shipped,
      edited: entry.state === 'edited',
    })),
    home,
    empties: emptiesOf(entries, home, writes, data),
    reason: reasonOf(entries, home, folded),
  };
}

/**
 * The candidates the 2.2.x rules found make, each with the map position of the
 * first rule it covers: the unedited rules of one home together, each edited
 * rule alone, each unedited dropped rule alone.
 */
function ruleCandidates(found, data) {
  const made = [];
  const byHome = new Map();
  for (const entry of found) {
    if (entry.state === 'held') continue;
    if (entry.state === 'edited') {
      made.push({ position: entry.index, candidate: candidateOf(`edited:${entry.rule.id}`, [entry], data) });
    } else if (entry.rule.home === null) {
      made.push({ position: entry.index, candidate: candidateOf(`remove:${entry.rule.id}`, [entry], data) });
    } else {
      const key = keyOf(entry.rule.home.path, entry.rule.home.heading);
      byHome.set(key, [...(byHome.get(key) ?? []), entry]);
    }
  }
  for (const entries of byHome.values()) {
    const home = entries[0].rule.home;
    made.push({ position: entries[0].index, candidate: candidateOf(`update:${idOf(home.path, home.heading)}`, entries, data) });
  }
  return made;
}

/**
 * The adds, in bundled order: each `new` rule of a held or added group, and
 * every bundled rule of an added group, when none of its home's 2.2.x rules
 * was found and the home file does not hold its heading.
 */
function addCandidates(table, map, found, groups, data) {
  const held = new Set(groups.held);
  const adding = new Set(groups.adding);
  const homesFound = new Set(found.filter(entry => entry.rule.home !== null).map(entry => keyOf(entry.rule.home.path, entry.rule.home.heading)));
  const wanted = new Set(map.new.filter(rule => held.has(rule.path.split('/')[0]) || adding.has(rule.path.split('/')[0])).map(rule => keyOf(rule.path, rule.heading)));
  const made = [];
  for (const [key, rule] of data.bundled) {
    if (!wanted.has(key) && !adding.has(rule.group)) continue;
    if (homesFound.has(key)) continue;
    if (data.local.get(rule.path)?.sections.some(section => section.heading === rule.heading)) continue;
    const title = table.groups.find(group => group.id === rule.group).title;
    made.push({
      position: rule.order,
      candidate: {
        id: `add:${idOf(rule.path, rule.heading)}`,
        action: 'add',
        recommended: true,
        group: rule.group,
        covers: [],
        sections: [],
        home: { ...homeOf(rule, [], data), held: false, current: false },
        empties: [],
        reason: adding.has(rule.group)
          ? `A built-in rule of the ${title} group, which this project calls for.`
          : `A rule added to the built-in ${title} standards.`,
      },
    });
  }
  return made;
}

/**
 * The report's order: the recommended rule candidates by the map position of
 * the first rule each covers, then the adds in bundled order, then the edited
 * candidates in map order. Rules folded into a section of the team's own
 * follow the edited candidate holding their home heading, else the last
 * edited candidate before them, else lead the unrecommended ones.
 */
function ordered(rules, adds) {
  const byPosition = (a, b) => a.position - b.position;
  const recommended = rules.filter(each => each.candidate.recommended).sort(byPosition);
  const edited = rules.filter(each => each.candidate.id.startsWith('edited:')).sort(byPosition);
  const after = new Map();
  for (const each of rules.filter(made => !made.candidate.recommended && !made.candidate.id.startsWith('edited:')).sort(byPosition)) {
    const home = each.candidate.home;
    const anchor = edited.find(made => made.candidate.sections[0].path === home.path && made.candidate.sections[0].heading === home.heading)
      ?? edited.filter(made => made.position < each.position).at(-1);
    const key = anchor ? anchor.candidate.id : '';
    after.set(key, [...(after.get(key) ?? []), each]);
  }
  return [
    ...recommended,
    ...[...adds].sort(byPosition),
    ...(after.get('') ?? []),
    ...edited.flatMap(made => [made, ...(after.get(made.candidate.id) ?? [])]),
  ].map(each => each.candidate);
}

function builtInCandidates(table, flags) {
  const ctx = context(table, flags);
  const map = readMap();
  const bundled = readBundled(table, map);
  const warnings = [...ctx.warnings];
  const local = readLocal(ctx.standardsDir, warnings);
  const { found, team } = classify(map, bundled, local, warnings);
  const edited = new Set(found.filter(entry => entry.state === 'edited').map(entry => keyOf(entry.path, entry.section.heading)));
  const data = { bundled, local, edited };
  const groups = groupsBlock(table, flags, ctx);
  const candidates = ordered(ruleCandidates(found, data), addCandidates(table, map, found, groups, data));
  const held = found.filter(entry => entry.state === 'held').map(entry => ({ id: entry.rule.id, path: entry.path, heading: entry.section.heading }));
  return {
    ok: true,
    profile: ctx.profile,
    signals: ctx.signals,
    monorepo: ctx.monorepo,
    standards_dir: ctx.standardsDir,
    groups,
    candidates,
    held,
    team,
    counts: {
      found: found.length,
      held: held.length,
      team: team.length,
      candidates: candidates.length,
      recommended: candidates.filter(each => each.recommended).length,
      edited: candidates.filter(each => !each.recommended).length,
    },
    warnings,
  };
}

function main() {
  let report;
  try {
    const table = readTable();
    const { verb, flags } = parseArgs(process.argv.slice(2), table);
    report = verb === CANDIDATES ? builtInCandidates(table, flags) : resolveGroups(table, flags);
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
