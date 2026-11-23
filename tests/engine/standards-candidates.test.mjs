import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, run, scratchTree, snapshot, variantRoot } from '../helpers.mjs';

// The resolver's `built-in candidates` verb, run as a child process the way
// standards-update's built-in mode and init's update survey run it: from a
// scratch project whose standards folder is built from sections of the 2.2.x
// fixture and the bundled tree. Every run is checked to leave the tree as it
// found it. Report paths are `/`-separated literals; `path.join` builds only
// filesystem paths.

const DOCS = path.join(ROOT, 'plugins/maister/skills/docs-manager/docs');
const RESOLVER = path.join(ROOT, 'plugins/maister/skills/docs-manager/scripts/standards.mjs');
const MAP = JSON.parse(fs.readFileSync(path.join(DOCS, 'standards-map.json'), 'utf8'));
const TABLE = JSON.parse(fs.readFileSync(path.join(DOCS, 'standards-groups.json'), 'utf8'));
const BUNDLED = path.join(DOCS, 'standards');
const STD = '.maister/docs/standards';
const VERB = ['built-in', 'candidates'];

/** The `###` sections of a file: heading and trimmed text; fences hide headings. */
function sections(text) {
  const out = [];
  let cur = null;
  let fence = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      if (line.startsWith(fence)) fence = null;
    } else if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3);
    } else if (/^(# |## |### )/.test(line)) {
      cur = null;
      if (line.startsWith('### ')) {
        cur = { heading: line.slice(4).replace(/\s+/g, ' ').trim(), lines: [line] };
        out.push(cur);
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  return out.map(s => ({ heading: s.heading, text: s.lines.join('\n').replace(/^\n+|\n+$/g, '') }));
}

/** The 2.2.x text of a rule, from the map. */
const shipped = id => {
  const rule = MAP.rules.find(each => each.id === id);
  assert.ok(rule, `no rule ${id} in the map`);
  return rule.shipped;
};

/** The bundled text of the rule `heading` in `rel`. */
const current = (rel, heading) => sections(fs.readFileSync(path.join(BUNDLED, ...rel.split('/')), 'utf8')).find(s => s.heading === heading).text;

/** A standards file: its title line, then its sections, one blank line apart. */
const file = (title, ...texts) => `${title}\n\n${texts.join('\n\n')}\n`;

/** The rules the plugin added since 2.2.x to global and backend, held current, so no add joins the candidates. */
const NEW_GLOBAL = {
  [`${STD}/global/minimal-implementation.md`]: file('## Minimal Implementation', current('global/minimal-implementation.md', 'Change Only What the Task Needs')),
};
const generatedFiles = current('global/conventions.md', 'Generated Files');
const NEW_BACKEND = {
  [`${STD}/backend/api.md`]: file('## API Design', current('backend/api.md', 'Response Fields on Purpose'), current('backend/api.md', 'Fetching URLs From Input')),
};

/** Run the resolver from `root`, asserting the tree is left byte for byte as it was. */
function resolver(root, argv) {
  const before = snapshot(root);
  const result = run(RESOLVER, argv, undefined, {}, root);
  assert.deepEqual(snapshot(root), before, `${argv.join(' ')} changed the tree`);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: an internal failure, asserted by the test
  }
  return { ...result, report };
}

/** A successful `built-in candidates` run, its counts checked against its lists. */
function candidates(root, args = ['--add-groups=']) {
  const result = resolver(root, [...VERB, ...args]);
  assert.equal(result.code, 0, `exit ${result.code}: ${result.stderr}`);
  const report = result.report;
  assert.deepEqual(Object.keys(report), ['ok', 'profile', 'signals', 'monorepo', 'standards_dir', 'groups', 'candidates', 'held', 'team', 'counts', 'warnings']);
  assert.equal(report.ok, true);
  const covered = report.candidates.reduce((sum, each) => sum + each.covers.length, 0);
  assert.equal(report.counts.found, report.held.length + covered, 'every rule found is classified exactly once');
  assert.equal(report.counts.held, report.held.length);
  assert.equal(report.counts.team, report.team.length);
  assert.equal(report.counts.candidates, report.candidates.length);
  assert.equal(report.counts.recommended, report.candidates.filter(each => each.recommended).length);
  assert.equal(report.counts.edited, report.candidates.filter(each => !each.recommended).length);
  const ids = report.candidates.map(each => each.id);
  assert.equal(new Set(ids).size, ids.length, 'a candidate id repeats');
  return report;
}

const byId = (report, id) => {
  const found = report.candidates.find(each => each.id === id);
  assert.ok(found, `no candidate ${id} in ${report.candidates.map(each => each.id).join(', ')}`);
  return found;
};

test('every refusal exits 1 with its code, each verb listing its own flags', t => {
  const root = scratchTree(t);
  const refused = (argv, code) => {
    const result = resolver(root, argv);
    assert.equal(result.code, 1, `${argv.join(' ')}: exit ${result.code}: ${result.stderr}`);
    assert.equal(result.report.ok, false);
    assert.match(result.stderr, /^standards: /);
    const errors = result.report.errors.filter(each => each.code === code);
    assert.ok(errors.length, `${argv.join(' ')}: ${JSON.stringify(result.report.errors)}`);
    return errors;
  };
  const groupIds = TABLE.groups.map(each => each.id).join(', ');

  const [unknown] = refused([...VERB, '--add-groups=gpu'], 'standards-unknown-group');
  assert.equal(unknown.message, `unknown group "gpu"; --add-groups takes a comma list of ${groupIds}, or "" for none`);
  assert.equal(refused([...VERB, '--add-groups=gpu, cli ,tpu'], 'standards-unknown-group').length, 2);

  const [groupsFlag] = refused(['groups', '--add-groups=cli'], 'standards-unknown-flag');
  assert.equal(groupsFlag.message, 'unknown argument "--add-groups=cli"; the flags are --kind, --deploy, --ui, --data, --signals, --monorepo, --root, --standards-dir, each written --name=value');
  const [ownFlag] = refused([...VERB, '--colour=red'], 'standards-unknown-flag');
  assert.match(ownFlag.message, /--standards-dir, --add-groups, each written --name=value$/);

  assert.equal(refused([], 'standards-unknown-verb')[0].message, 'no verb given; the verbs are groups and built-in candidates');
  assert.equal(refused(['built-in'], 'standards-unknown-verb')[0].message, 'unknown verb "built-in"; the verbs are groups and built-in candidates');
  assert.equal(refused(['built-in', 'list'], 'standards-unknown-verb')[0].message, 'unknown verb "built-in list"; the verbs are groups and built-in candidates');
  assert.equal(refused(['built-in-candidates'], 'standards-unknown-verb')[0].message, 'unknown verb "built-in-candidates"; the verbs are groups and built-in candidates');
  // The flags after an unknown verb are checked against the groups verb's.
  refused(['built-in', '--add-groups=cli'], 'standards-unknown-flag');

  refused([...VERB, '--add-groups'], 'standards-flag-needs-value');
  refused([...VERB, '--add-groups=cli', '--add-groups='], 'standards-flag-repeated');
  refused([...VERB, '--kind=spaceship'], 'standards-bad-value');
  refused([...VERB, '--signals=gpu'], 'standards-unknown-signal');
  refused([...VERB, `--standards-dir=${path.join(root, 'missing')}`], 'standards-bad-root');
});

test('unedited rules make one recommended candidate per home: a replace, a move to a new file and a removal', t => {
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    ...NEW_BACKEND,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', shipped('global/conventions#environment-variables'), generatedFiles),
    [`${STD}/global/coding-style.md`]: file('## Coding Style', shipped('global/coding-style#naming-consistency')),
    [`${STD}/backend/queries.md`]: file('## Database Queries', shipped('backend/queries#avoid-n1')),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 3, held: 0, team: 0, candidates: 3, recommended: 3, edited: 0 });
  assert.deepEqual(report.candidates.map(each => each.id), [
    'remove:global/coding-style#naming-consistency',
    'update:global/conventions#no-secrets-in-the-repository',
    'update:data/queries#avoid-n1',
  ]);
  assert.deepEqual(report.held, []);
  assert.deepEqual(report.team, []);
  assert.deepEqual(report.warnings, []);

  const replace = byId(report, 'update:global/conventions#no-secrets-in-the-repository');
  assert.deepEqual(Object.keys(replace), ['id', 'action', 'recommended', 'group', 'covers', 'sections', 'home', 'empties', 'reason']);
  assert.equal(replace.action, 'replace');
  assert.equal(replace.recommended, true);
  assert.equal(replace.group, 'global');
  assert.deepEqual(replace.covers, ['global/conventions#environment-variables']);
  assert.deepEqual(replace.sections, [{
    id: 'global/conventions#environment-variables',
    path: 'global/conventions.md',
    heading: 'Environment Variables',
    text: shipped('global/conventions#environment-variables'),
    shipped: shipped('global/conventions#environment-variables'),
    edited: false,
  }]);
  assert.deepEqual(replace.home, {
    id: 'global/conventions#no-secrets-in-the-repository',
    path: 'global/conventions.md',
    heading: 'No Secrets in the Repository',
    text: current('global/conventions.md', 'No Secrets in the Repository'),
    held: false,
    current: false,
    creates_file: false,
    file_title: '## Development Conventions',
    preceding: ['Docs Follow the Change'],
  });
  assert.deepEqual(replace.empties, []);
  assert.equal(replace.reason, 'Rewritten as No Secrets in the Repository.');

  const move = byId(report, 'update:data/queries#avoid-n1');
  assert.equal(move.action, 'move');
  assert.equal(move.recommended, true);
  assert.equal(move.group, 'backend', 'the group of the rule it covers, not of its home');
  assert.deepEqual(move.covers, ['backend/queries#avoid-n1']);
  assert.equal(move.home.path, 'data/queries.md');
  assert.equal(move.home.heading, 'Avoid N+1');
  assert.equal(move.home.creates_file, true);
  assert.equal(move.home.file_title, '## Database Queries');
  assert.deepEqual(move.home.preceding, []);
  assert.deepEqual(move.empties, ['backend/queries.md']);
  assert.equal(move.reason, 'Rewritten as Avoid N+1 in data/queries.md.');

  const remove = byId(report, 'remove:global/coding-style#naming-consistency');
  assert.equal(remove.action, 'remove');
  assert.equal(remove.recommended, true);
  assert.equal(remove.group, 'global');
  assert.equal(remove.home, null);
  assert.deepEqual(remove.empties, ['global/coding-style.md']);
  assert.equal(remove.reason, 'The plugin no longer ships this rule.');
});

test('the comparison folds line endings and runs of spaces, and keeps line breaks', t => {
  const crlf = file('## Development Conventions', shipped('global/conventions#environment-variables'), generatedFiles).replace(/\n/g, '\r\n');
  const [head, body] = shipped('global/coding-style#naming-consistency').split('\n');
  const spaced = `${head}   \n${body.replace('naming patterns', 'naming  \t patterns')}  `;
  const [graceHead, graceBody] = shipped('global/error-handling#graceful-degradation').split('\n');
  const reflowed = `${graceHead}\n${graceBody.replace(' rather than', '\nrather than')}`;
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: crlf,
    [`${STD}/global/coding-style.md`]: file('## Coding Style', spaced),
    [`${STD}/global/error-handling.md`]: file('## Error Handling', reflowed),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 3, held: 0, team: 0, candidates: 3, recommended: 2, edited: 1 });
  assert.equal(byId(report, 'update:global/conventions#no-secrets-in-the-repository').recommended, true);
  // A section's text comes back with LF line endings, otherwise as written.
  assert.equal(byId(report, 'update:global/conventions#no-secrets-in-the-repository').sections[0].text, shipped('global/conventions#environment-variables'));
  assert.equal(byId(report, 'remove:global/coding-style#naming-consistency').recommended, true);

  const edited = byId(report, 'edited:global/error-handling#graceful-degradation');
  assert.equal(edited.recommended, false);
  assert.equal(edited.action, 'replace');
  assert.deepEqual(edited.covers, ['global/error-handling#graceful-degradation']);
  assert.equal(edited.sections[0].edited, true);
  assert.equal(edited.sections[0].text, reflowed);
  assert.equal(edited.home.heading, 'Catch Only to Act');
  // The edited candidates come after the recommended ones.
  assert.equal(report.candidates.at(-1).id, 'edited:global/error-handling#graceful-degradation');
});

test('a rule already holding the new text is held, the team\'s own rules and repeated headings are left alone', t => {
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    ...NEW_BACKEND,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/global/error-handling.md`]: file('## Error Handling', current('global/error-handling.md', 'Retry with Backoff')),
    [`${STD}/global/coding-style.md`]: file('## Coding Style', shipped('global/coding-style#naming-consistency'), shipped('global/coding-style#naming-consistency')),
    [`${STD}/global/naming.md`]: file('## Naming', shipped('global/coding-style#naming-consistency')),
    [`${STD}/backend/payments.md`]: file('## Payments', '### Refund Window\nRefunds are accepted for 30 days.', '### Idempotent Charges\nEvery charge carries an idempotency key.'),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 1, held: 1, team: 5, candidates: 0, recommended: 0, edited: 0 });
  assert.deepEqual(report.held, [{ id: 'global/error-handling#retry-with-backoff', path: 'global/error-handling.md', heading: 'Retry with Backoff' }]);
  assert.deepEqual(report.candidates, []);
  // A 2.2.x heading found away from its 2.2.x file is the team's: rules are found by path and heading.
  assert.deepEqual(report.team, [
    { path: 'backend/payments.md', heading: 'Refund Window' },
    { path: 'backend/payments.md', heading: 'Idempotent Charges' },
    { path: 'global/coding-style.md', heading: 'Naming Consistency', duplicate: true },
    { path: 'global/coding-style.md', heading: 'Naming Consistency', duplicate: true },
    { path: 'global/naming.md', heading: 'Naming Consistency' },
  ]);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /global\/coding-style\.md/);
  assert.match(report.warnings[0], /Naming Consistency/);
});

test('the groups block: held, adding from the flag or the profile, and held groups the profile does not call for', t => {
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    '.maister/config.yml': 'project:\n  kind: library\n',
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
  });

  const flagged = candidates(root);
  assert.deepEqual(flagged.groups, { held: ['global'], adding: [], adding_from: 'flag', not_recommended_held: [] });
  assert.deepEqual(flagged.profile, { source: 'config', fields: { kind: 'library' } });
  assert.deepEqual(flagged.counts, { found: 0, held: 0, team: 0, candidates: 0, recommended: 0, edited: 0 });

  // With no flag, the groups to add are the groups verb's absent ones.
  const profiled = candidates(root, []);
  const absent = resolver(root, ['groups']).report.absent;
  assert.deepEqual(absent, ['testing']);
  assert.deepEqual(profiled.groups, { held: ['global'], adding: absent, adding_from: 'profile', not_recommended_held: [] });

  // A held group already in the list is not added again; the rest come in table order.
  const listed = resolver(root, [...VERB, '--add-groups= global ,testing,']).report;
  assert.deepEqual(listed.groups.adding, ['testing']);

  // A held web UI group in a mobile app: named, and its rules still classified.
  const mobile = scratchTree(t, {
    [`${STD}/frontend/components.md`]: file('## Components', shipped('frontend/components#reusability')),
  });
  const named = candidates(mobile, ['--kind=mobile', '--add-groups=']);
  assert.deepEqual(named.groups, { held: ['frontend'], adding: [], adding_from: 'flag', not_recommended_held: ['frontend'] });
  assert.deepEqual(named.counts, { found: 1, held: 0, team: 0, candidates: 1, recommended: 1, edited: 0 });
  const reuse = byId(named, 'update:global/coding-style#reuse-what-exists');
  assert.equal(reuse.action, 'move');
  assert.equal(reuse.group, 'frontend');
  assert.equal(reuse.home.creates_file, true);

  // With no profile and no signal there is nothing to judge a held group by.
  const unjudged = candidates(mobile, ['--add-groups=']);
  assert.deepEqual(unjudged.profile, { source: 'none', fields: {} });
  assert.deepEqual(unjudged.groups.not_recommended_held, []);
});

test('the verb reads Markdown at any depth, skips dot names, holds nothing without a folder and writes nothing', t => {
  const empty = scratchTree(t);
  const none = candidates(empty);
  assert.deepEqual(none.groups.held, []);
  assert.deepEqual(none.counts, { found: 0, held: 0, team: 0, candidates: 0, recommended: 0, edited: 0 });
  assert.equal(none.standards_dir, path.join(empty, '.maister', 'docs', 'standards'));

  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/.drafts/global/coding-style.md`]: file('## Coding Style', shipped('global/coding-style#naming-consistency')),
    [`${STD}/global/.old.md`]: file('## Old', '### Old Rule\nGone.'),
    [`${STD}/payments/deep/refunds.md`]: file('## Refunds', '### Partial Refunds\nA partial refund names its line items.', '```\n### not a heading\n```\n#### Detail\nStays inside the section.'),
    [`${STD}/payments/notes.txt`]: '### Not Markdown\n',
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 0, held: 0, team: 1, candidates: 0, recommended: 0, edited: 0 });
  assert.deepEqual(report.team, [{ path: 'payments/deep/refunds.md', heading: 'Partial Refunds' }]);

  // The same folder named by flag, from another directory.
  const elsewhere = scratchTree(t);
  const named = candidates(elsewhere, [`--standards-dir=${path.join(root, ...STD.split('/'))}`, '--add-groups=']);
  assert.deepEqual(named.team, report.team);
  assert.equal(named.standards_dir, path.join(root, ...STD.split('/')));
});

/* ---- the test-side applier --------------------------------------------- */

// Applies candidates the way docs-manager's built-in standard edits do: each
// edit's sections removed only while each still reads as the text given (else
// nothing of the edit), the home section written unless the file already
// holds its heading after the removals, placed in place of the first section
// removed from that file, else by `preceding`, else at the end; a missing home
// file created with its title line, a file left with only `#`/`##` lines and
// blanks deleted; one blank line between sections and a trailing newline.

/** The comparison form: LF, each space or tab run one space, no trailing space, no outer blank line. */
const normalised = text => text.replace(/\r\n?/g, '\n').split('\n')
  .map(line => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''))
  .join('\n').replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '');

/** A file's lines and its `###` sections with their line ranges: `[start, end)`, the end at the next `#`, `##` or `###` line outside a fence. */
function ranges(lines) {
  const found = [];
  let fence = null;
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
      if (found.length && found.at(-1).end === undefined) found.at(-1).end = index;
      if (line.startsWith('### ')) found.push({ heading: line.slice(4).replace(/\s+/g, ' ').trim(), start: index });
    }
  });
  if (found.length && found.at(-1).end === undefined) found.at(-1).end = lines.length;
  return found.map(each => ({ ...each, text: lines.slice(each.start, each.end).join('\n') }));
}

const nativeOf = (dir, rel) => path.join(dir, ...rel.split('/'));
const readLines = (dir, rel) => (fs.existsSync(nativeOf(dir, rel)) ? fs.readFileSync(nativeOf(dir, rel), 'utf8').replace(/\r\n?/g, '\n').split('\n') : null);
const isBlankLine = line => /^[ \t]*$/.test(line);

/** `lines` written back: no trailing blank line, one newline at the end. */
function writeLines(dir, rel, lines) {
  const kept = [...lines];
  while (kept.length && isBlankLine(kept.at(-1))) kept.pop();
  fs.mkdirSync(path.dirname(nativeOf(dir, rel)), { recursive: true });
  fs.writeFileSync(nativeOf(dir, rel), `${kept.join('\n')}\n`);
}

/** Insert `text` as a section at line `at`, one blank line on each side. */
function insertAt(lines, at, text) {
  const block = text.split('\n');
  if (at > 0 && !isBlankLine(lines[at - 1])) block.unshift('');
  if (at < lines.length && !isBlankLine(lines[at])) block.push('');
  lines.splice(at, 0, ...block);
}

/** Apply each candidate in order to the standards folder `dir`; returns the ids not applied. */
function apply(dir, list) {
  const notApplied = [];
  for (const edit of list) {
    const files = new Map();
    const take = rel => {
      if (!files.has(rel)) files.set(rel, readLines(dir, rel));
      return files.get(rel);
    };
    // The guard: every section still reads as the text given.
    const targets = edit.sections.map(section => {
      const lines = take(section.path);
      return lines && ranges(lines).find(each => each.heading === section.heading && normalised(each.text) === normalised(section.text));
    });
    if (targets.some(each => !each)) {
      notApplied.push(edit.id);
      continue;
    }
    // The removals, last first within each file; where the first one in the home file was.
    let place = null;
    const touched = new Set();
    for (const rel of new Set(edit.sections.map(section => section.path))) {
      const lines = files.get(rel);
      const mine = edit.sections.map((section, index) => (section.path === rel ? targets[index] : null)).filter(Boolean).sort((a, b) => b.start - a.start);
      for (const section of mine) lines.splice(section.start, section.end - section.start);
      if (edit.home && rel === edit.home.path) place = mine.at(-1).start;
      touched.add(rel);
    }
    // The write.
    const home = edit.home;
    if (home && !home.held) {
      let lines = take(home.path);
      if (lines === null) {
        files.set(home.path, `${home.file_title}\n\n${home.text}`.split('\n'));
      } else if (!ranges(lines).some(each => each.heading === home.heading)) {
        let at = place;
        if (at === null && home.preceding.length === 0) {
          at = 0;
          while (at < lines.length && (isBlankLine(lines[at]) || /^#{1,2} /.test(lines[at]))) at += 1;
        } else if (at === null) {
          const held = ranges(lines);
          const after = home.preceding.map(heading => held.find(each => each.heading === heading)).find(Boolean);
          at = after ? after.end : lines.length;
        }
        insertAt(lines, at, home.text);
      }
      touched.add(home.path);
    }
    for (const rel of touched) {
      const lines = files.get(rel);
      if (lines.every(line => isBlankLine(line) || /^#{1,2} /.test(line))) fs.rmSync(nativeOf(dir, rel));
      else writeLines(dir, rel, lines);
    }
  }
  return notApplied;
}

/** The standards folder of a scratch root. */
const stdOf = root => path.join(root, ...STD.split('/'));

/** The section `heading` of the local file `rel`, as written, or undefined. */
const localSection = (root, rel, heading) => {
  const lines = readLines(stdOf(root), rel);
  return lines && ranges(lines).find(each => each.heading === heading);
};

/* ---- merges, held homes and folded candidates ---------------------------- */

const VALIDATION = '## Validation';
const ERRORS = '## Error Handling';

test('a merge across files: all unedited, the target absent, or the target alone', t => {
  const all = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/global/validation.md`]: file(VALIDATION, shipped('global/validation#validate-early'), shipped('global/validation#allowlists-over-blocklists'), shipped('global/validation#type-and-format-checks')),
    [`${STD}/global/error-handling.md`]: file(ERRORS, shipped('global/error-handling#fail-fast')),
  });
  const merged = candidates(all);
  assert.deepEqual(merged.counts, { found: 4, held: 0, team: 0, candidates: 1, recommended: 1, edited: 0 });
  const merge = byId(merged, 'update:global/validation#validate-at-the-boundary');
  assert.equal(merge.action, 'merge');
  assert.equal(merge.recommended, true);
  assert.equal(merge.group, 'global');
  assert.deepEqual(merge.covers, ['global/error-handling#fail-fast', 'global/validation#validate-early', 'global/validation#allowlists-over-blocklists', 'global/validation#type-and-format-checks']);
  assert.deepEqual(merge.sections.map(each => [each.path, each.heading]), [
    ['global/error-handling.md', 'Fail Fast'],
    ['global/validation.md', 'Validate Early'],
    ['global/validation.md', 'Allowlists Over Blocklists'],
    ['global/validation.md', 'Type and Format Checks'],
  ]);
  assert.equal(merge.home.held, false);
  assert.equal(merge.home.current, false);
  assert.deepEqual(merge.empties, ['global/error-handling.md']);
  assert.equal(merge.reason, 'Folded into Validate at the Boundary (global/validation.md) with the other rules it replaces.');

  // The target absent: the absorbed rules carry the add.
  const absent = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/global/validation.md`]: file(VALIDATION, shipped('global/validation#allowlists-over-blocklists'), shipped('global/validation#type-and-format-checks')),
    [`${STD}/global/error-handling.md`]: file(ERRORS, shipped('global/error-handling#fail-fast')),
  });
  const carried = candidates(absent);
  assert.deepEqual(carried.counts, { found: 3, held: 0, team: 0, candidates: 1, recommended: 1, edited: 0 });
  const three = byId(carried, 'update:global/validation#validate-at-the-boundary');
  assert.equal(three.action, 'merge');
  assert.equal(three.home.held, false);
  assert.equal(three.covers.length, 3);

  // Fail Fast alone: one section, its home in another file.
  const alone = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/global/error-handling.md`]: file(ERRORS, shipped('global/error-handling#fail-fast')),
  });
  const moved = candidates(alone);
  assert.deepEqual(moved.counts, { found: 1, held: 0, team: 0, candidates: 1, recommended: 1, edited: 0 });
  const move = byId(moved, 'update:global/validation#validate-at-the-boundary');
  assert.equal(move.action, 'move');
  assert.equal(move.home.creates_file, true);
  assert.equal(move.home.held, false);
});

test('a merge with an absorbed rule or the target edited elsewhere: the edited one carries the add until the home is held', t => {
  for (const [edited, rest] of [
    ['global/error-handling#fail-fast', ['global/validation#validate-early', 'global/validation#allowlists-over-blocklists', 'global/validation#type-and-format-checks']],
    ['global/validation#validate-early', ['global/error-handling#fail-fast', 'global/validation#allowlists-over-blocklists', 'global/validation#type-and-format-checks']],
  ]) {
    const text = id => (id === edited ? `${shipped(id)} Our team adds a note.` : shipped(id));
    const root = scratchTree(t, {
      ...NEW_GLOBAL,
      [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
      [`${STD}/global/validation.md`]: file(VALIDATION, text('global/validation#validate-early'), text('global/validation#allowlists-over-blocklists'), text('global/validation#type-and-format-checks')),
      [`${STD}/global/error-handling.md`]: file(ERRORS, text('global/error-handling#fail-fast')),
    });
    const first = candidates(root);
    assert.deepEqual(first.counts, { found: 4, held: 0, team: 0, candidates: 2, recommended: 1, edited: 1 });
    assert.deepEqual(first.candidates.map(each => each.id), ['update:global/validation#validate-at-the-boundary', `edited:${edited}`]);
    const merge = byId(first, 'update:global/validation#validate-at-the-boundary');
    assert.equal(merge.action, 'merge');
    assert.equal(merge.recommended, true);
    assert.deepEqual(merge.covers, rest);
    const alone = byId(first, `edited:${edited}`);
    assert.equal(alone.action, edited.startsWith('global/validation') ? 'replace' : 'move');
    assert.equal(alone.recommended, false);
    assert.equal(alone.home.held, false, 'the edited one carries the add while the home is not held');

    // The bulk answer applied: the home is held, and the edited one only removes.
    assert.deepEqual(apply(stdOf(root), [merge]), []);
    const second = candidates(root);
    assert.deepEqual(second.counts, { found: 1, held: 0, team: 0, candidates: 1, recommended: 0, edited: 1 });
    const removal = byId(second, `edited:${edited}`);
    assert.equal(removal.action, 'remove');
    assert.equal(removal.home.held, true);
    assert.equal(removal.home.current, true);
    assert.equal(removal.reason, 'A rule headed Validate at the Boundary is already in global/validation.md, with the new text.');
  }
});

test('a target edited under the home\'s own heading: the rules folded into it are asked right after it, recommended once it is current', t => {
  const ours = `${shipped('global/error-handling#clear-user-messages')} Our support team writes them.`;
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', shipped('global/conventions#environment-variables'), generatedFiles),
    [`${STD}/global/error-handling.md`]: file(ERRORS, ours),
    [`${STD}/global/validation.md`]: file(VALIDATION, shipped('global/validation#specific-errors')),
  });
  const first = candidates(root);
  assert.deepEqual(first.counts, { found: 3, held: 0, team: 0, candidates: 3, recommended: 1, edited: 2 });
  assert.deepEqual(first.candidates.map(each => each.id), [
    'update:global/conventions#no-secrets-in-the-repository',
    'edited:global/error-handling#clear-user-messages',
    'update:global/error-handling#clear-user-messages',
  ]);
  const target = byId(first, 'edited:global/error-handling#clear-user-messages');
  assert.equal(target.action, 'replace');
  assert.equal(target.home.held, false, 'its own section is no holder of the home');
  const folded = byId(first, 'update:global/error-handling#clear-user-messages');
  assert.equal(folded.action, 'remove');
  assert.equal(folded.recommended, false);
  assert.equal(folded.home.held, true);
  assert.equal(folded.home.current, false);
  assert.deepEqual(folded.covers, ['global/validation#specific-errors']);
  assert.deepEqual(folded.empties, ['global/validation.md']);
  assert.equal(folded.reason, 'Folded into Clear User Messages. A rule headed Clear User Messages is already in global/error-handling.md: your own section, which stays unless you take the new rule there.');

  // The new rule taken at the target: the folded rules' removal is recommended.
  assert.deepEqual(apply(stdOf(root), [target]), []);
  const second = candidates(root);
  assert.deepEqual(second.counts, { found: 3, held: 1, team: 0, candidates: 2, recommended: 2, edited: 0 });
  assert.deepEqual(second.held, [{ id: 'global/error-handling#clear-user-messages', path: 'global/error-handling.md', heading: 'Clear User Messages' }]);
  const now = byId(second, 'update:global/error-handling#clear-user-messages');
  assert.equal(now.action, 'remove');
  assert.equal(now.recommended, true);
  assert.equal(now.home.held, true);
  assert.equal(now.home.current, true);
  assert.equal(now.reason, 'A rule headed Clear User Messages is already in global/error-handling.md, with the new text.');
});

test('rules folded into a section of the team\'s own are asked after the last edited rule before them', t => {
  const teamBoundary = '### Validate at the Boundary\nOur gateway validates every request against its schema.';
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    ...NEW_BACKEND,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', `${shipped('global/conventions#environment-variables')} We use a vault.`, generatedFiles),
    [`${STD}/global/validation.md`]: file(VALIDATION, teamBoundary, shipped('global/validation#validate-early'), shipped('global/validation#allowlists-over-blocklists'), shipped('global/validation#type-and-format-checks')),
    [`${STD}/global/error-handling.md`]: file(ERRORS, shipped('global/error-handling#fail-fast')),
    [`${STD}/backend/queries.md`]: file('## Database Queries', `${shipped('backend/queries#avoid-n1')} We batch with DataLoader.`),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 6, held: 0, team: 0, candidates: 3, recommended: 0, edited: 3 });
  assert.deepEqual(report.candidates.map(each => each.id), [
    'edited:global/conventions#environment-variables',
    'update:global/validation#validate-at-the-boundary',
    'edited:backend/queries#avoid-n1',
  ]);
  const folded = byId(report, 'update:global/validation#validate-at-the-boundary');
  assert.equal(folded.action, 'remove');
  assert.equal(folded.recommended, false);
  assert.equal(folded.covers.length, 4);
  assert.equal(folded.home.held, true);
  assert.equal(folded.home.current, false);
  assert.ok(folded.reason.endsWith('is already in global/validation.md: a section of your own, which stays.'), folded.reason);
  assert.equal(folded.reason, 'Folded into Validate at the Boundary. A rule headed Validate at the Boundary is already in global/validation.md: a section of your own, which stays.');
  // The team's section keeping the heading is in no candidate and not the team's list: it is a bundled heading at its bundled path.
  assert.ok(report.candidates.every(each => each.sections.every(section => section.heading !== 'Validate at the Boundary')));
  assert.deepEqual(report.team, []);
});

test('two edited rules of one home both carry the write, and one applier pass leaves one section', t => {
  const root = scratchTree(t, {
    ...NEW_GLOBAL,
    [`${STD}/global/conventions.md`]: file('## Development Conventions', generatedFiles),
    [`${STD}/global/coding-style.md`]: file('## Coding Style', `${shipped('global/coding-style#dry-dont-repeat-yourself')} Shared helpers live in lib/.`),
    [`${STD}/frontend/components.md`]: file('## Components', `${shipped('frontend/components#reusability')} See the design system.`),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 2, held: 0, team: 0, candidates: 2, recommended: 0, edited: 2 });
  const dry = byId(report, 'edited:global/coding-style#dry-dont-repeat-yourself');
  const reuse = byId(report, 'edited:frontend/components#reusability');
  for (const each of [dry, reuse]) {
    assert.equal(each.home.id, 'global/coding-style#reuse-what-exists');
    assert.equal(each.home.held, false);
  }
  assert.equal(dry.action, 'replace');
  assert.equal(reuse.action, 'move');
  assert.deepEqual(reuse.empties, ['frontend/components.md']);

  assert.deepEqual(apply(stdOf(root), report.candidates), []);
  const style = fs.readFileSync(nativeOf(stdOf(root), 'global/coding-style.md'), 'utf8');
  assert.equal(ranges(style.split('\n')).filter(each => each.heading === 'Reuse What Exists').length, 1);
  assert.equal(normalised(localSection(root, 'global/coding-style.md', 'Reuse What Exists').text), normalised(current('global/coding-style.md', 'Reuse What Exists')));
  assert.equal(fs.existsSync(nativeOf(stdOf(root), 'frontend/components.md')), false);
  assert.deepEqual(candidates(root).candidates, []);
});

test('adds: the new rules of held groups, every rule of an added group, never a home whose rules the team removed', t => {
  const root = scratchTree(t, {
    [`${STD}/global/coding-style.md`]: file('## Coding Style', current('global/coding-style.md', 'Reuse What Exists')),
    [`${STD}/testing/test-writing.md`]: file('## Test Writing', current('testing/test-writing.md', 'Deterministic Tests')),
  });
  const report = candidates(root);
  assert.deepEqual(report.counts, { found: 0, held: 0, team: 0, candidates: 3, recommended: 3, edited: 0 });
  assert.deepEqual(report.candidates.map(each => each.id), [
    'add:global/conventions#generated-files',
    'add:global/minimal-implementation#change-only-what-the-task-needs',
    'add:testing/test-writing#fix-the-code-not-the-test',
  ]);
  const generated = byId(report, 'add:global/conventions#generated-files');
  assert.deepEqual(generated, {
    id: 'add:global/conventions#generated-files',
    action: 'add',
    recommended: true,
    group: 'global',
    covers: [],
    sections: [],
    home: {
      id: 'global/conventions#generated-files',
      path: 'global/conventions.md',
      heading: 'Generated Files',
      text: generatedFiles,
      held: false,
      current: false,
      creates_file: true,
      file_title: '## Development Conventions',
      preceding: generated.home.preceding,
    },
    empties: [],
    reason: 'A rule added to the built-in Global standards.',
  });
  assert.equal(byId(report, 'add:testing/test-writing#fix-the-code-not-the-test').home.creates_file, false);
  assert.equal(byId(report, 'add:testing/test-writing#fix-the-code-not-the-test').reason, 'A rule added to the built-in Testing standards.');
  // Validate at the Boundary's 2.2.x rules are all absent: the team removed them, and nothing adds it back.
  assert.ok(!report.candidates.some(each => each.id === 'add:global/validation#validate-at-the-boundary'));

  const cli = candidates(root, ['--add-groups=cli']);
  assert.deepEqual(cli.groups.adding, ['cli']);
  const output = byId(cli, 'add:cli/output#output-streams');
  assert.equal(output.group, 'cli');
  assert.equal(output.home.creates_file, true);
  assert.equal(output.reason, 'A built-in rule of the Command-line interface group, which this project calls for.');
  // Adds come after the recommended rule candidates, in bundled order.
  assert.deepEqual(cli.candidates.map(each => each.id), [...report.candidates.map(each => each.id), 'add:cli/output#output-streams']);

  // An added group's home whose 2.2.x rule was found: the rule's own candidate carries it.
  const web = scratchTree(t, {
    [`${STD}/frontend/components.md`]: file('## Components', shipped('frontend/components#reusability')),
  });
  const global = candidates(web, ['--add-groups=global']);
  const bundledGlobal = TABLE.groups.find(each => each.id === 'global').files
    .flatMap(name => sections(fs.readFileSync(path.join(BUNDLED, 'global', name), 'utf8')).map(each => `add:${idOf(`global/${name}`, each.heading)}`));
  assert.deepEqual(global.candidates.map(each => each.id), [
    'update:global/coding-style#reuse-what-exists',
    ...bundledGlobal.filter(id => id !== 'add:global/coding-style#reuse-what-exists'),
  ]);
  assert.equal(global.counts.candidates, bundledGlobal.length);
});

/* ---- the full 2.2.x fixture ------------------------------------------------ */

const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'standards-2.2');
const FIXTURE_ARGS = ['--kind=web-app', '--ui=web', '--data=postgres', '--signals=web-ui,server,database', '--add-groups='];

/** The id a rule at `rel` under `heading` takes. */
function idOf(rel, heading) {
  const slug = heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-').replace(/-+/g, '-');
  return `${rel.replace(/\.md$/, '')}#${slug}`;
}

/** A scratch project holding the 2.2.x fixture as its standards, plus `extra`. */
function fixtureTree(t, extra = {}) {
  const files = {};
  for (const group of fs.readdirSync(FIXTURE)) {
    for (const name of fs.readdirSync(path.join(FIXTURE, group))) {
      files[`${STD}/${group}/${name}`] = fs.readFileSync(path.join(FIXTURE, group, name), 'utf8');
    }
  }
  return scratchTree(t, { ...files, ...extra });
}

/** The rules whose home keeps their 2.2.x path and heading, in map order. */
const KEPT = MAP.rules.filter(rule => rule.home && rule.home.path === rule.path && rule.home.heading === rule.heading)
  .map(rule => ({ id: rule.id, path: rule.path, heading: rule.heading }));

test('the full 2.2.x fixture: every rule classified once, every candidate recommended, none left after applying them', t => {
  const root = fixtureTree(t);
  const first = candidates(root, FIXTURE_ARGS);
  assert.deepEqual(first.groups, { held: ['global', 'testing', 'frontend', 'backend', 'data'], adding: [], adding_from: 'flag', not_recommended_held: [] });
  assert.equal(first.counts.found, 113);
  assert.deepEqual(first.held, []);
  const covered = first.candidates.flatMap(each => each.covers);
  assert.deepEqual([...covered].sort(), MAP.rules.map(rule => rule.id).sort(), 'each of the 113 rules is covered exactly once');
  assert.deepEqual(first.counts, { found: 113, held: 0, team: 0, candidates: 83, recommended: 83, edited: 0 });
  const kinds = prefix => first.candidates.filter(each => each.id.startsWith(prefix)).length;
  assert.deepEqual([kinds('update:'), kinds('remove:'), kinds('add:')], [47, 31, 5]);

  // The backend group's line of the bulk question.
  const backend = first.candidates.filter(each => each.group === 'backend');
  const tally = action => backend.filter(each => each.action === action);
  assert.deepEqual([tally('replace').length, tally('merge').length, tally('move').length, tally('remove').length, tally('add').length], [1, 4, 10, 9, 2]);
  assert.ok(tally('move').every(each => each.home.path.startsWith('data/')), 'every backend move goes to data/');

  // Applied in report order, then the verb again: nothing left, the kept rules held.
  assert.deepEqual(apply(stdOf(root), first.candidates), []);
  const second = candidates(root, FIXTURE_ARGS);
  assert.deepEqual(second.candidates, []);
  assert.deepEqual(second.held, KEPT);
  assert.equal(second.held.length, 9);
  assert.equal(second.counts.found, second.held.length);
  assert.deepEqual(second.team, []);

  // Each file of the five held groups holds the bundled rules, and nothing else is left.
  const expected = [];
  for (const group of TABLE.groups.filter(each => first.groups.held.includes(each.id))) {
    for (const name of group.files) {
      const rel = `${group.id}/${name}`;
      expected.push(rel);
      const bundled = sections(fs.readFileSync(path.join(BUNDLED, group.id, name), 'utf8'));
      const local = ranges(readLines(stdOf(root), rel));
      assert.deepEqual(new Set(local.map(each => each.heading)), new Set(bundled.map(each => each.heading)), rel);
      assert.equal(local.length, bundled.length, `${rel} repeats a heading`);
      for (const section of bundled) {
        assert.equal(normalised(local.find(each => each.heading === section.heading).text), normalised(section.text), `${rel} "${section.heading}"`);
      }
    }
  }
  assert.deepEqual(Object.keys(snapshot(stdOf(root))).sort(), expected.sort());
  for (const rel of ['global/commenting.md', 'frontend/css.md', 'frontend/responsive.md', 'backend/migrations.md', 'backend/models.md', 'backend/queries.md']) {
    assert.equal(fs.existsSync(nativeOf(stdOf(root), rel)), false, `${rel} is no home and is deleted`);
  }
});

test('the full 2.2.x fixture with an edited rule and a team file: both untouched by the bulk answer, the edited rule still offered', t => {
  const payments = file('## Payments', '### Refund Window\nRefunds are accepted for 30 days.');
  const handling = fs.readFileSync(path.join(FIXTURE, 'global', 'error-handling.md'), 'utf8')
    .replace(shipped('global/error-handling#graceful-degradation'), `${shipped('global/error-handling#graceful-degradation')} Our status page says which.`);
  const root = fixtureTree(t, {
    [`${STD}/global/error-handling.md`]: handling,
    [`${STD}/backend/payments.md`]: payments,
  });
  const first = candidates(root, FIXTURE_ARGS);
  assert.deepEqual(first.team, [{ path: 'backend/payments.md', heading: 'Refund Window' }]);
  assert.equal(first.counts.found, 113);
  assert.equal(first.counts.edited, 1);
  assert.equal(first.candidates.at(-1).id, 'edited:global/error-handling#graceful-degradation');
  const before = localSection(root, 'global/error-handling.md', 'Graceful Degradation').text;

  assert.deepEqual(apply(stdOf(root), first.candidates.filter(each => each.recommended)), []);
  const second = candidates(root, FIXTURE_ARGS);
  assert.deepEqual(second.candidates.map(each => each.id), ['edited:global/error-handling#graceful-degradation']);
  assert.equal(second.candidates[0].action, 'remove');
  assert.equal(second.candidates[0].home.current, true);
  assert.deepEqual(second.held, KEPT);
  assert.equal(fs.readFileSync(nativeOf(stdOf(root), 'backend/payments.md'), 'utf8'), payments);
  assert.equal(localSection(root, 'global/error-handling.md', 'Graceful Degradation').text, before);
});

test('the Copilot build ships the standards map byte for byte, and its built-in candidates prints the source report', t => {
  const built = variantRoot();
  assert.deepEqual(fs.readFileSync(path.join(built, 'skills/docs-manager/docs/standards-map.json')), fs.readFileSync(path.join(DOCS, 'standards-map.json')));
  const root = fixtureTree(t);
  const before = snapshot(root);
  const args = [...VERB, ...FIXTURE_ARGS];
  const source = run(RESOLVER, args, undefined, {}, root);
  const shipped = run(path.join(built, 'skills/docs-manager/scripts/standards.mjs'), args, undefined, {}, root);
  assert.equal(source.code, 0, source.stderr);
  assert.equal(shipped.code, 0, shipped.stderr);
  assert.deepEqual(snapshot(root), before, 'a built-in candidates run changed the tree');
  const a = JSON.parse(source.stdout);
  const b = JSON.parse(shipped.stdout);
  delete a.standards_dir;
  delete b.standards_dir;
  assert.deepEqual(b, a);
});
