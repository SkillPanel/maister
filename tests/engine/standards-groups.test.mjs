import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, run, scratchTree, snapshot, variantRoot } from '../helpers.mjs';

// The standards groups resolver, run as a child process the way init's Phase 4
// and its update survey run it: from a scratch project root, the JSON report
// and the exit code asserted. The group table is the one bundled with the
// plugin, so these cases are the table's rules as the resolver applies them.

const DOCS_MANAGER = path.join(ROOT, 'plugins/maister/skills/docs-manager');
const RESOLVER = path.join(DOCS_MANAGER, 'scripts/standards.mjs');
const TABLE = path.join(DOCS_MANAGER, 'docs/standards-groups.json');
const BUNDLED = path.join(DOCS_MANAGER, 'docs/standards');
const ANALYZER = path.join(ROOT, 'plugins/maister/agents/project-analyzer.md');

/** Run `groups` with `args` from `root`; the report parsed when stdout holds one. */
function groups(root, args = [], verb = ['groups']) {
  const result = run(RESOLVER, [...verb, ...args], undefined, {}, root);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no report: an internal failure, asserted by the test
  }
  return { ...result, report };
}

/** A call expected to succeed: exit 0, the report returned. */
function resolve(root, args) {
  const result = groups(root, args);
  assert.equal(result.code, 0, `exit ${result.code}: ${result.stderr}`);
  assert.equal(result.report.ok, true);
  return result.report;
}

const ids = list => list.map(each => each.id);

test('the five kinds of app and a mobile app each get their own groups', t => {
  const root = scratchTree(t);

  const library = resolve(root, ['--kind=library']);
  assert.deepEqual(ids(library.recommended), ['global', 'testing']);
  assert.deepEqual(library.recommended[0].reasons, [{ always: true }]);
  assert.deepEqual(library.profile, { source: 'flags', fields: { kind: 'library' } });

  const libraryUi = resolve(root, ['--kind=library', '--ui=web']);
  assert.deepEqual(ids(libraryUi.recommended), ['global', 'testing', 'frontend']);
  assert.deepEqual(libraryUi.recommended[2].reasons, [{ field: 'ui', value: 'web' }]);

  const cli = resolve(root, ['--kind=cli', '--data=sqlite', '--signals=command-entry,database']);
  assert.deepEqual(ids(cli.recommended), ['global', 'testing', 'data', 'cli']);
  assert.ok(ids(cli.not_recommended).includes('backend'));
  assert.deepEqual(cli.recommended.find(each => each.id === 'data').reasons, [{ field: 'data', value: ['sqlite'] }, { signal: 'database' }]);
  assert.deepEqual(cli.recommended.find(each => each.id === 'cli').reasons, [{ field: 'kind', value: 'cli' }, { signal: 'command-entry' }]);

  const service = resolve(root, ['--kind=service', '--data=postgres', '--signals=server,database']);
  assert.deepEqual(ids(service.recommended), ['global', 'testing', 'backend', 'data']);

  const webApp = resolve(root, ['--kind=web-app', '--ui=web', '--data=postgres', '--signals=web-ui,server,database']);
  assert.deepEqual(ids(webApp.recommended), ['global', 'testing', 'frontend', 'backend', 'data']);

  const mobile = resolve(root, ['--kind=mobile', '--ui=native', '--data=sqlite', '--signals=native-mobile,database']);
  assert.deepEqual(ids(mobile.recommended), ['global', 'testing', 'data', 'mobile']);
  assert.deepEqual(mobile.signals, ['database', 'native-mobile']);
  assert.equal(mobile.monorepo, false);
  // Nothing is on disk in a root with no .maister: every recommended group is absent.
  assert.deepEqual(mobile.present, []);
  assert.deepEqual(mobile.absent, ['global', 'testing', 'data', 'mobile']);
  assert.equal(mobile.standards_dir, path.join(root, '.maister', 'docs', 'standards'));
  assert.deepEqual(Object.keys(mobile), ['ok', 'profile', 'signals', 'monorepo', 'standards_dir', 'recommended', 'present', 'absent', 'not_recommended', 'not_copied', 'groups', 'warnings']);
  assert.equal(mobile.groups.length, 9);
  assert.deepEqual(Object.keys(mobile.groups[0]), ['id', 'title', 'files', 'filter']);
});

test('a native mobile app outranks the web UI signal its template carries, unless a web shell or a desktop app says otherwise', t => {
  const root = scratchTree(t);

  const reactNative = resolve(root, ['--kind=mobile', '--ui=native', '--signals=native-mobile,web-ui']);
  assert.ok(ids(reactNative.recommended).includes('mobile'));
  assert.ok(!ids(reactNative.recommended).includes('frontend'));
  assert.deepEqual(reactNative.not_recommended.find(each => each.id === 'frontend'), { id: 'frontend', title: 'Web UI', outranked: ['web-ui'] });
  // A group no precedence set aside carries no outranked list.
  assert.ok(!('outranked' in reactNative.not_recommended.find(each => each.id === 'backend')));

  // No profile flag and no .maister: the signals alone decide, the same way.
  const bare = resolve(root, ['--signals=native-mobile,web-ui']);
  assert.deepEqual(bare.profile, { source: 'none', fields: {} });
  assert.deepEqual(ids(bare.recommended), ['global', 'testing', 'mobile']);
  assert.deepEqual(bare.not_recommended.find(each => each.id === 'frontend').outranked, ['web-ui']);

  const shell = resolve(root, ['--kind=mobile', '--ui=native', '--signals=native-mobile,web-ui,web-shell']);
  assert.ok(ids(shell.recommended).includes('frontend'));
  assert.deepEqual(shell.recommended.find(each => each.id === 'frontend').reasons, [{ signal: 'web-shell' }]);

  const desktop = resolve(root, ['--kind=desktop', '--ui=native', '--signals=web-ui']);
  assert.ok(ids(desktop.recommended).includes('frontend'));
  assert.ok(!ids(desktop.recommended).includes('mobile'));
});

test('a monorepo gets the union of its apps, with no precedence', t => {
  const root = scratchTree(t);
  const report = resolve(root, ['--monorepo', '--signals=web-ui,native-mobile,server']);
  assert.equal(report.monorepo, true);
  assert.deepEqual(ids(report.recommended), ['global', 'testing', 'frontend', 'backend', 'mobile']);
  assert.ok(report.not_recommended.every(each => !('outranked' in each)));
});

test('a profile field left out removes no group another alternative selects', t => {
  const root = scratchTree(t);

  assert.ok(ids(resolve(root, ['--signals=server']).recommended).includes('backend'));
  assert.ok(ids(resolve(root, ['--kind=library', '--signals=database']).recommended).includes('data'));

  const store = resolve(root, ['--deploy=app-store', '--ui=native']);
  assert.ok(ids(store.recommended).includes('mobile'));
  // An all-of alternative gives a reason per `in` part and none for the `not_in` part.
  assert.deepEqual(store.recommended.find(each => each.id === 'mobile').reasons, [{ field: 'deploy', value: 'app-store' }, { field: 'ui', value: 'native' }]);

  const desktop = resolve(root, ['--deploy=app-store', '--ui=native', '--kind=desktop']);
  assert.ok(!ids(desktop.recommended).includes('mobile'));

  // A data list of files alone names no database.
  assert.ok(!ids(resolve(root, ['--data=files']).recommended).includes('data'));
  assert.deepEqual(resolve(root, ['--data=Files, postgres ,']).recommended.find(each => each.id === 'data').reasons, [{ field: 'data', value: ['postgres'] }]);
});

test('the groups on disk: the written profile, older setups, the project\'s own folders and another standards tree', t => {
  const root = scratchTree(t, {
    '.maister/config.yml': 'project:\n  kind: service\n  data: [postgres]\n  runtime: node 20\n',
    '.maister/docs/standards/global/coding-style.md': '# Coding style\n',
    '.maister/docs/standards/backend/models.md': '# Models\n',
    '.maister/docs/standards/payments/rules.md': '# Payments\n',
    '.maister/docs/standards/drafts/notes.txt': 'not Markdown\n',
  });
  // A group of the project's own that init has just created, and a table group's folder, both still empty.
  fs.mkdirSync(path.join(root, '.maister/docs/standards/refunds'));
  fs.mkdirSync(path.join(root, '.maister/docs/standards/testing'));
  const before = snapshot(root);

  const report = resolve(root, ['--signals=server,database']);
  assert.deepEqual(report.profile, { source: 'config', fields: { kind: 'service', data: ['postgres'] } });
  assert.deepEqual(ids(report.recommended), ['global', 'testing', 'backend', 'data']);
  assert.deepEqual(report.present, [
    { id: 'global', title: 'Global', via: 'folder', paths: ['global'] },
    { id: 'backend', title: 'HTTP service', via: 'folder', paths: ['backend'] },
    { id: 'data', title: 'Database', via: 'pre-change', paths: ['backend/models.md'] },
    { id: 'drafts', via: 'folder', paths: ['drafts'], custom: true, empty: true },
    { id: 'payments', via: 'folder', paths: ['payments'], custom: true },
    { id: 'refunds', via: 'folder', paths: ['refunds'], custom: true, empty: true },
  ]);
  // An empty folder of a table group holds nothing: the group stays absent.
  assert.deepEqual(report.absent, ['testing']);
  assert.deepEqual(report.warnings, []);

  // A folder of its own beside the pre-change files: held by the folder, both paths listed.
  const both = scratchTree(t, {
    'standards/data/schema.md': '# Schema\n',
    'standards/backend/migrations.md': '# Migrations\n',
    'standards/cli tools/deep/notes.md': '# Notes\n',
  });
  const other = resolve(root, [`--standards-dir=${path.join(both, 'standards')}`, '--signals=database']);
  assert.equal(other.standards_dir, path.join(both, 'standards'));
  assert.deepEqual(other.present.find(each => each.id === 'data'), { id: 'data', title: 'Database', via: 'folder', paths: ['data', 'backend/migrations.md'] });
  assert.deepEqual(other.present.find(each => each.id === 'cli tools'), { id: 'cli tools', via: 'folder', paths: ['cli tools'], custom: true });
  assert.ok(!ids(other.present).includes('payments'));

  // A block holding only fields the resolver does not read still came from the config.
  const runtimeOnly = scratchTree(t, { '.maister/config.yml': 'project:\n  runtime: python 3.12\n' });
  assert.deepEqual(resolve(runtimeOnly, []).profile, { source: 'config', fields: {} });

  assert.deepEqual(snapshot(root), before);
});

test('every refusal exits 1 with its code, and the edge values mean what the contract says', t => {
  const root = scratchTree(t);
  const refused = (args, code, verb) => {
    const result = groups(root, args, verb);
    assert.equal(result.code, 1, `${args.join(' ')}: exit ${result.code}: ${result.stderr}`);
    assert.equal(result.report.ok, false);
    assert.ok(result.report.errors.some(each => each.code === code), `${args.join(' ')}: ${JSON.stringify(result.report.errors)}`);
    assert.match(result.stderr, /^standards: /);
    return result.report.errors.find(each => each.code === code);
  };

  assert.match(refused(['--kind=spaceship'], 'standards-bad-value').message, /web-app/);
  assert.match(refused(['--signals=gpu'], 'standards-unknown-signal').message, /native-mobile/);
  assert.match(refused(['--colour=red'], 'standards-unknown-flag').message, /--signals/);
  refused(['--kind=cli', '--kind=library'], 'standards-flag-repeated');
  refused(['--monorepo=yes'], 'standards-bad-value');
  refused([], 'standards-unknown-verb', []);
  refused([], 'standards-unknown-verb', ['list']);
  refused([`--standards-dir=${path.join(root, 'missing')}`], 'standards-bad-root');
  refused(['--kind='], 'standards-flag-needs-value');
  refused(['--kind'], 'standards-flag-needs-value');
  refused(['--kind', 'cli'], 'standards-unknown-flag');
  refused([`--root=${path.join(root, 'missing')}`], 'standards-bad-root');

  const none = resolve(root, ['--data=', '--signals=']);
  assert.deepEqual(none.profile, { source: 'flags', fields: { data: [] } });
  assert.deepEqual(none.signals, []);
  assert.ok(!ids(none.recommended).includes('data'));

  // --root names the project from anywhere.
  const elsewhere = scratchTree(t);
  assert.equal(resolve(elsewhere, [`--root=${root}`]).standards_dir, path.join(root, '.maister', 'docs', 'standards'));

  // A project: key that is not a map is a warning, never a refusal.
  const notMap = scratchTree(t, { '.maister/config.yml': 'project: service\n' });
  const report = resolve(notMap, []);
  assert.deepEqual(report.profile, { source: 'none', fields: {} });
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /not a map|is a map of fields/);
});

test('the group table holds together with the bundled standards and the analyzer', () => {
  const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
  const signalIds = table.signals.map(each => each.id);
  assert.equal(signalIds.length, 8);

  const folders = fs.readdirSync(BUNDLED, { withFileTypes: true }).filter(each => each.isDirectory()).map(each => each.name).sort();
  assert.deepEqual(table.groups.map(each => each.id).sort(), folders);

  const listed = table.groups.flatMap(group => group.files.map(file => `${group.id}/${file}`));
  assert.equal(new Set(listed).size, listed.length, 'a file is listed twice');
  const bundled = folders.flatMap(folder => fs.readdirSync(path.join(BUNDLED, folder)).map(file => `${folder}/${file}`));
  assert.deepEqual([...listed].sort(), bundled.sort());

  const signalsIn = condition => condition.all ? condition.all.flatMap(signalsIn) : condition.signal ? [condition.signal] : [];
  for (const group of table.groups) {
    for (const signal of group.when.flatMap(signalsIn)) assert.ok(signalIds.includes(signal), `${group.id} names the unknown signal ${signal}`);
    assert.equal(group.pre_change_files.length > 0, group.id === 'data', `${group.id}'s pre-change files`);
  }

  const analyzer = fs.readFileSync(ANALYZER, 'utf8');
  for (const id of signalIds) assert.ok(analyzer.includes(`| \`${id}\` |`), `the analyzer's group signals table lacks ${id}`);
});

test('--chosen lists the recommended groups that were not copied, and never a group nobody recommended', t => {
  // As init's summary runs it: after Phase 5 copied global, testing and mobile of a recommended mobile and data.
  const root = scratchTree(t, {
    '.maister/docs/standards/global/coding-style.md': '# Coding style\n',
    '.maister/docs/standards/testing/test-writing.md': '# Tests\n',
    '.maister/docs/standards/mobile/screens.md': '# Screens\n',
  });
  const flags = ['--kind=mobile', '--ui=native', '--data=sqlite', '--signals=native-mobile,database'];
  const without = resolve(root, flags);
  assert.equal(without.not_copied, null, 'no selection given, no list');
  assert.deepEqual(ids(without.recommended), ['global', 'testing', 'data', 'mobile']);

  const declined = resolve(root, [...flags, '--chosen=global,testing,mobile']);
  assert.deepEqual(declined.not_copied, [{ id: 'data', title: 'Database' }]);
  for (const never of ids(declined.not_recommended)) assert.ok(!ids(declined.not_copied).includes(never), `${never} was never recommended`);

  const all = resolve(root, [...flags, '--chosen=global,testing,mobile,data']);
  assert.deepEqual(ids(all.not_copied), ['data'], 'chosen but not held by the folder: not copied');
  fs.mkdirSync(path.join(root, '.maister/docs/standards/data'));
  fs.writeFileSync(path.join(root, '.maister/docs/standards/data/schema.md'), '# Schema\n');
  assert.deepEqual(resolve(root, [...flags, '--chosen=global,testing,mobile,data']).not_copied, [], 'every recommended group copied');

  // None chosen beyond global and testing; a group of the project's own is ignored.
  assert.deepEqual(ids(resolve(root, [...flags, '--chosen=global,testing,payments']).not_copied), ['data', 'mobile']);
  assert.deepEqual(ids(resolve(root, [...flags, '--chosen=']).not_copied), ['global', 'testing', 'data', 'mobile']);

  // A source that lacks a recommended group: not held there, so not copied.
  const source = scratchTree(t, { 'standards/global/style.md': '# Style\n', 'standards/mobile/screens.md': '# Screens\n' });
  const fromSource = resolve(root, [...flags, `--standards-dir=${path.join(source, 'standards')}`, '--chosen=global,testing,mobile,data']);
  assert.deepEqual(ids(fromSource.not_copied), ['testing', 'data']);

  // The flag belongs to groups alone.
  const refused = groups(root, [...flags, '--chosen=global'], ['built-in', 'candidates']);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /unknown argument "--chosen=global"/);
});

test('the Copilot build\'s resolver lists the same groups not copied', t => {
  const root = scratchTree(t, { '.maister/docs/standards/global/coding-style.md': '# Coding style\n' });
  const args = ['groups', '--kind=mobile', '--ui=native', '--data=sqlite', '--signals=native-mobile,database', '--chosen=global,testing'];
  const source = JSON.parse(run(RESOLVER, args, undefined, {}, root).stdout);
  const built = JSON.parse(run(path.join(variantRoot(), 'skills/docs-manager/scripts/standards.mjs'), args, undefined, {}, root).stdout);
  assert.deepEqual(ids(source.not_copied), ['testing', 'data', 'mobile']);
  assert.deepEqual(built.not_copied, source.not_copied);
});

test('the Copilot build ships a resolver that prints the source\'s report', t => {
  const root = scratchTree(t);
  const args = ['groups', '--kind=mobile', '--ui=native', '--data=sqlite', '--signals=native-mobile,database'];
  const source = run(RESOLVER, args, undefined, {}, root);
  const built = run(path.join(variantRoot(), 'skills/docs-manager/scripts/standards.mjs'), args, undefined, {}, root);
  assert.equal(source.code, 0, source.stderr);
  assert.equal(built.code, 0, built.stderr);
  const a = JSON.parse(source.stdout);
  const b = JSON.parse(built.stdout);
  assert.ok(ids(b.recommended).includes('mobile'));
  delete a.standards_dir;
  delete b.standards_dir;
  assert.deepEqual(b, a);
});

test('the data list is trimmed, drops empty items and folds case: only files-only data selects no data group', t => {
  const root = scratchTree(t);
  const padded = resolve(root, ['--kind=library', '--data= SQLite , ,']);
  assert.deepEqual(padded.profile.fields.data, ['SQLite']);
  assert.deepEqual(padded.recommended.find(each => each.id === 'data')?.reasons, [{ field: 'data', value: ['SQLite'] }]);
  assert.ok(!ids(resolve(root, ['--kind=library', '--data=Files']).recommended).includes('data'));
  assert.ok(!ids(resolve(root, ['--kind=library', '--data= , ']).recommended).includes('data'));
});
