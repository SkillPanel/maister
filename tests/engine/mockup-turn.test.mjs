import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';
import {
  MANIFEST_KEYS,
  MOCKUPS_JSON_KEYS,
  TURN_RESULT_KEYS,
  VERSIONS_INDEX_KEYS,
} from '../../plugins/maister/skills/mockup-studio/scripts/lib/shapes.mjs';

// The mockup studio's folder verbs, run as a child process the way the skill
// runs them: `turn.mjs begin` allocates a version folder, the turn writes its
// `.turn.json` input file there, and `turn.mjs finish` renders and publishes.
// Each test works in its own scratch project under the OS temp directory; the
// only import from inside the skill is the shapes module, which the written
// files are held to.

const TURN = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/turn.mjs');
const SUBDIR = 'analysis/mockups';

/** A scratch project with a task folder in it; `name` may hold a space. Removed when the test ends. */
function project(t, name = 'maister-mockup-turn-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = path.join(root, '.maister', 'tasks', 'development', '2026-01-01-task');
  fs.mkdirSync(task, { recursive: true });
  return { root, task, out: path.join(task, SUBDIR), versions: path.join(task, SUBDIR, 'versions') };
}

/** Run one verb from the project root; the JSON on stdout parsed when there is one. */
function turn(where, verbName, args = []) {
  const result = run(TURN, [verbName, `--task-path=${where.task}`, ...args], undefined, {}, where.root);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // no JSON: a usage or tooling error, asserted by the test
  }
  return { ...result, json };
}

const turnFile = (body = {}) => ({ note: 'a note', format: 'html', fidelity: 'sketch', grounding: { digest: null, stale: false }, ...body });

function writeTurn(versionDir, body) {
  fs.writeFileSync(path.join(versionDir, '.turn.json'), JSON.stringify(turnFile(body), null, 2));
}

/** One whole turn: begin, write the input file, finish. Returns the finish result. */
function wholeTurn(where, body, { begin = [], finish = [] } = {}) {
  const started = turn(where, 'begin', begin);
  assert.equal(started.code, 0, started.stdout + started.stderr);
  writeTurn(started.json.version_dir, body);
  const finished = turn(where, 'finish', [`--version=${started.json.version}`, ...finish]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  return finished.json;
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Every file under `dir`, as sorted relative paths. */
function tree(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'))
    .sort();
}

// The same checker the interface test holds the gate request to: a key the
// declaration does not name, a required key missing, a type or value outside it.
function departures(value, declaration, where = 'file') {
  const found = [];
  if (!typeAllowed(value, declaration.type)) return [`${where}: ${JSON.stringify(value)} is not ${declaration.type}`];
  if (declaration.values && !declaration.values.includes(value)) found.push(`${where}: ${JSON.stringify(value)} is not one of ${declaration.values.join(', ')}`);
  if (declaration.keys && isMap(value)) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(declaration.keys, key)) found.push(`${where}.${key}: not declared`);
      else found.push(...departures(value[key], declaration.keys[key], `${where}.${key}`));
    }
    for (const [key, spec] of Object.entries(declaration.keys)) {
      if (spec.required && !Object.hasOwn(value, key)) found.push(`${where}.${key}: required and missing`);
    }
  }
  if (declaration.items && Array.isArray(value)) {
    value.forEach((item, index) => found.push(...departures(item, declaration.items, `${where}[${index}]`)));
  }
  return found;
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function typeAllowed(value, type) {
  return type.split('|').some(each => ({
    string: typeof value === 'string',
    boolean: typeof value === 'boolean',
    integer: Number.isInteger(value),
    object: isMap(value),
    array: Array.isArray(value),
    null: value === null,
  })[each]);
}

test('begin reports the shell browser tool the look pass can use, from PATH alone', t => {
  const windows = process.platform === 'win32';
  // PATH replaced whole, under every spelling the parent carries, so nothing else on it answers.
  const pathEnv = dir => Object.fromEntries([...Object.keys(process.env).filter(key => key.toUpperCase() === 'PATH'), 'PATH'].map(key => [key, dir]));
  const begin = (where, dir) => {
    const result = run(TURN, ['begin', `--task-path=${where.task}`], undefined, pathEnv(dir), where.root);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };

  const withTool = project(t);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-fake-browser-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  const fake = path.join(bin, windows ? 'playwright-cli.cmd' : 'playwright-cli');
  fs.writeFileSync(fake, windows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
  fs.chmodSync(fake, 0o755);
  assert.equal(begin(withTool, bin).shell_browser, 'playwright-cli');

  // An empty PATH: no playwright-cli, and no npx to run the second probe with.
  const without = project(t);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-no-browser-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(begin(without, empty).shell_browser, null);

  // A file of that name that is not executable is not a tool.
  if (!windows) {
    fs.chmodSync(fake, 0o644);
    assert.equal(begin(project(t), bin).shell_browser, null);
  }
});

test('begin allocates one version above the highest, defaults against to latest and refuses what it cannot allocate', async t => {
  const where = project(t);

  await t.test('a first turn is v001 with no against', () => {
    const started = turn(where, 'begin');
    assert.equal(started.code, 0, started.stderr);
    assert.deepEqual(
      { ok: started.json.ok, version: started.json.version, against: started.json.against, first: started.json.first, screens: started.json.screens },
      { ok: true, version: 'v001', against: null, first: true, screens: [] });
    assert.equal(started.json.version_dir, path.join(where.versions, 'v001'));
    assert.ok(fs.statSync(started.json.version_dir).isDirectory());
    writeTurn(started.json.version_dir, { screens: [{ slug: 'home', title: 'Home', html: '<p>home</p>' }] });
    const finished = turn(where, 'finish', ['--version=v001']);
    assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  });

  await t.test('the next turn is v002 against the latest, with its screens', () => {
    const started = turn(where, 'begin');
    assert.equal(started.code, 0, started.stderr);
    assert.equal(started.json.version, 'v002');
    assert.equal(started.json.against, 'v001');
    assert.equal(started.json.first, false);
    assert.deepEqual(started.json.screens, [{ slug: 'home', title: 'Home' }]);
  });

  await t.test('an abandoned begin leaves a gap that is never reused', () => {
    const started = turn(where, 'begin');
    assert.equal(started.json.version, 'v003');
  });

  await t.test('an against not in the index is refused against-unknown', () => {
    const before = tree(where.versions);
    const refused = turn(where, 'begin', ['--against=v009']);
    assert.equal(refused.code, 1);
    assert.deepEqual([refused.json.ok, refused.json.code], [false, 'against-unknown']);
    assert.deepEqual(tree(where.versions), before);
  });

  await t.test('a file already holding the allocated name is refused version-exists', () => {
    fs.writeFileSync(path.join(where.versions, 'v004'), 'in the way');
    const refused = turn(where, 'begin');
    assert.equal(refused.code, 1);
    assert.equal(refused.json.code, 'version-exists');
  });

  await t.test('an unreadable index is refused index-malformed', () => {
    const other = project(t);
    fs.mkdirSync(other.versions, { recursive: true });
    fs.writeFileSync(path.join(other.versions, 'index.json'), '{not json');
    const refused = turn(other, 'begin');
    assert.equal(refused.code, 1);
    assert.equal(refused.json.code, 'index-malformed');
  });
});

test('finish carries screens over, drops by slug, keeps slugs stable and computes changed', async t => {
  const where = project(t);
  const first = wholeTurn(where, {
    screens: [
      { slug: 'home', title: 'Home', html: '<p>home</p>' },
      { title: 'Settings & Profile', html: '<p>settings</p>' },
      { title: 'Café', html: '<p>café</p>' },
    ],
  });
  assert.deepEqual(first.screens, ['home', 'settings-profile', 'cafe']);
  assert.deepEqual(first.changed, ['home', 'settings-profile', 'cafe']);

  const second = wholeTurn(where, {
    screens: [
      { title: 'Settings & Profile', html: '<p>settings, redrawn</p>' },
      { title: 'Cafe', html: '<p>another</p>' },
    ],
    drop: ['home'],
  });

  await t.test('a title takes against\'s slug, a fresh clash takes -2, and a dropped slug is gone', () => {
    assert.equal(second.against, 'v001');
    assert.deepEqual(second.screens, ['settings-profile', 'cafe', 'cafe-2']);
    assert.deepEqual(second.changed, ['settings-profile', 'cafe-2']);
    assert.equal(second.values.screens, 'settings-profile,cafe,cafe-2');
    assert.equal(second.values.changed, 'settings-profile,cafe-2');
    const manifest = readJson(path.join(where.versions, 'v002', 'manifest.json'));
    assert.equal(manifest.parent, 'v001');
    assert.deepEqual(manifest.screens.map(each => [each.slug, each.changed]),
      [['settings-profile', true], ['cafe', false], ['cafe-2', true]]);
  });

  await t.test('a carried screen keeps its page content', () => {
    const page = fs.readFileSync(path.join(where.versions, 'v002', 'cafe.html'), 'utf8');
    assert.match(page, /<p>café<\/p>/);
  });

  await t.test('a screen sent again unchanged is not changed', () => {
    const third = wholeTurn(where, { screens: [{ slug: 'cafe', title: 'Café', html: '<p>café</p>' }] });
    assert.deepEqual(third.changed, []);
    assert.equal(third.values.changed, '');
    assert.equal(third.values.notes_count, '0');
  });

  await t.test('a turn forked from an older version builds on the against begin gave it', () => {
    const fork = wholeTurn(where, { against: 'v001', screens: [] }, { begin: ['--against=v001'] });
    assert.equal(fork.against, 'v001');
    assert.deepEqual(fork.screens, ['home', 'settings-profile', 'cafe']);
    assert.equal(readJson(path.join(where.versions, fork.version, 'manifest.json')).parent, 'v001');
  });
});

test('finish writes index.json, the manifest, .mockups.json and turn-result.json in their declared shapes', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'home', title: 'Home', html: '<p>home</p>', css: 'p{}', annotations: [{ selector: 'p', note: 'hi' }] }] });
  const index = path.join(where.versions, 'index.json');
  fs.writeFileSync(index, JSON.stringify({ ...readJson(index), bookmarked: 'v001' }));
  const record = path.join(where.root, '.maister', 'tasks', 'mockup-studio', 'run', 'turn-result.json');
  const result = wholeTurn(where, {
    note: 'add settings',
    screens: [{ title: 'Settings', html: '<p>settings</p>' }],
    notes: ['one', 'two'],
    degraded: ['incomplete'],
    grounding: { digest: 'abc', stale: true },
  }, { finish: [`--record=${record}`] });

  const indexJson = readJson(index);
  assert.deepEqual(departures(indexJson, { type: 'object', keys: VERSIONS_INDEX_KEYS }), []);
  assert.equal(indexJson.latest, 'v002');
  assert.equal(indexJson.bookmarked, 'v001', 'a hand-set bookmark is kept as found');
  assert.deepEqual(indexJson.versions.map(each => [each.version, each.parent, each.changed]),
    [['v001', null, ['home']], ['v002', 'v001', ['settings']]]);

  const manifest = readJson(path.join(where.versions, 'v002', 'manifest.json'));
  assert.deepEqual(departures(manifest, { type: 'object', keys: MANIFEST_KEYS }), []);
  assert.deepEqual([manifest.grounding_digest, manifest.grounding_stale, manifest.degraded, manifest.note], ['abc', true, ['incomplete'], 'add settings']);
  const firstManifest = readJson(path.join(where.versions, 'v001', 'manifest.json'));
  assert.deepEqual(departures(firstManifest, { type: 'object', keys: MANIFEST_KEYS }), []);
  assert.equal(Object.hasOwn(firstManifest, 'degraded'), false, 'no degraded key when there are none');

  const mockups = readJson(path.join(where.versions, 'v002', '.mockups.json'));
  assert.deepEqual(departures(mockups, { type: 'object', keys: MOCKUPS_JSON_KEYS }), []);
  assert.equal(mockups.latestId, 'settings', 'latestId is the first changed slug');
  assert.deepEqual(mockups.mockups.map(each => each.id), ['home', 'settings']);
  assert.deepEqual(readJson(path.join(where.out, '.mockups.json')), mockups, 'the flat manifest is the version\'s');

  const written = readJson(record);
  assert.deepEqual(departures(written, { type: 'object', keys: TURN_RESULT_KEYS }), []);
  const { ok, values, ...rest } = result;
  assert.equal(ok, true);
  assert.deepEqual(written, rest);
  assert.equal(written.gallery, `${SUBDIR}/versions/v002/index.html`);
  assert.equal(written.output_subdir, SUBDIR);
  assert.equal(written.task_path, path.relative(where.root, where.task).split(path.sep).join('/'));
  assert.deepEqual(values, {
    version: 'v002', against: 'v001', screens: 'home,settings', changed: 'settings',
    degraded: true, notes_count: '2', format: 'html', fidelity: 'sketch',
  });
});

test('pages and the gallery escape titles and keep replacement patterns in content', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'home', title: 'Home', html: '<p>home</p>' }] });
  wholeTurn(where, {
    note: 'a <b>note</b>',
    screens: [{
      slug: 'odd',
      title: '<script>alert(1)</script>',
      html: '<p>costs $& and $1 and $\'</p>',
      css: '.a::after{content:"$&"}',
      annotations: [{ selector: 'p', note: '</script><script>alert(2)</script>' }],
    }],
  });
  const gallery = fs.readFileSync(path.join(where.versions, 'v002', 'index.html'), 'utf8');
  assert.doesNotMatch(gallery, /<script>alert/);
  assert.match(gallery, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(gallery, /a &lt;b&gt;note&lt;\/b&gt;/);
  assert.match(gallery, /href="\.\.\/v001\/index\.html"/, 'the parent gallery is linked');
  assert.match(gallery, /href="odd\.html"/);
  assert.doesNotMatch(gallery, /<link\b|<script\b[^>]*\bsrc=/, 'the gallery loads nothing from outside');

  const page = fs.readFileSync(path.join(where.versions, 'v002', 'odd.html'), 'utf8');
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /<main id="mockup-container"><style>\.a::after\{content:"\$&"\}<\/style>\s*<div id="mockup-content"><p>costs \$& and \$1 and \$'<\/p><\/div>/);
  assert.match(page, /\\u003c\/script>\\u003cscript>alert\(2\)\\u003c\/script>/, 'annotations write < as \\u003c');
  assert.match(page, /href="home\.html"/, 'navigation links sibling pages only');
  assert.doesNotMatch(page, /href="(?:\/|\.\.\/|index\.html)/, 'a page carries no gallery link');
  assert.doesNotMatch(page, /\{\{[A-Z]+\}\}/, 'no placeholder is left');

  const mockups = readJson(path.join(where.versions, 'v002', '.mockups.json'));
  assert.equal(mockups.mockups.find(each => each.id === 'odd').html, '<p>costs $& and $1 and $\'</p>');
});

// A screen carries the app's own frame. The viewer around it styles only its own title bar
// and container, so the app's header and page width are never restyled into a second card.
test('a page styles only the viewer\'s own header and container, never the screen\'s header or main', t => {
  const where = project(t);
  const html = '<header class="app-header"><h1>Todos</h1></header><main class="page"><section class="view">list</section></main>';
  wholeTurn(where, { screens: [{ slug: 'list', title: 'List', html, css: '.app-header{background:#2e7d32}.page{max-width:640px}' }] });
  const page = fs.readFileSync(path.join(where.versions, 'v001', 'list.html'), 'utf8');
  const viewer = page.slice(0, page.indexOf('</style>'));
  const selectors = [...viewer.matchAll(/^\s*([^{}@/*\n][^{}\n]*?)\s*\{/gm)].map(match => match[1].trim());
  assert.ok(selectors.includes('body > header') && selectors.includes('#mockup-container'), selectors.join(' | '));
  // An element selector for header or main is the viewer's own only when it is anchored on body.
  const elementSelector = /(^|[\s>+~,])(header|main)\b(?![-\w])/;
  // A `:has()` only asks whether the screen holds one; it styles neither.
  for (const selector of selectors.filter(each => elementSelector.test(each.replace(/:has\([^)]*\)/g, '')))) {
    assert.ok(selector.startsWith('body > header'), `"${selector}" reaches the screen's own elements`);
  }
  assert.ok(page.includes(`<div id="mockup-content">${html}</div>`), 'the screen\'s frame is kept whole');

  // The container draws nothing around the screen, so its full-width header and its page background are the app's.
  // Each is stated, not left out: the container is a <main>, so a screen's own main rule would reach it, and an id outranks that.
  const container = viewer.match(/^\s*#mockup-container\s*\{([^}]*)\}/m)[1];
  const declared = Object.fromEntries(container.split(';').map(each => each.split(':').map(part => part.trim())).filter(([key]) => key));
  assert.deepEqual(
    { 'max-width': declared['max-width'], width: declared.width, margin: declared.margin, padding: declared.padding, background: declared.background, border: declared.border },
    { 'max-width': 'none', width: 'auto', margin: '0', padding: '0', background: 'none', border: '0' },
  );
  assert.match(page, /<main id="mockup-container">/, 'the verifier\'s anchor stays');
  // Only a fragment with no frame of its own keeps off the page's edge.
  assert.match(viewer, /#mockup-content:not\(:has\(header, main\)\)\s*\{\s*padding:/);
  assert.match(page, /<body>\s*<header>\s*<h1>List<\/h1>/, 'the title bar stays');
});

test('the screen tabs stay beside a screen that fills the page', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a bare fragment</p>' }, { slug: 'b', title: 'B', html: '<main>b</main>' }] });
  const page = fs.readFileSync(path.join(where.versions, 'v001', 'a.html'), 'utf8');
  assert.match(page, /<nav class="screen-nav">[\s\S]*href="b\.html"[\s\S]*<main id="mockup-container">/);
  assert.ok(page.includes('<div id="mockup-content"><p>a bare fragment</p></div>'));
});

// An annotation's note sits beside or above what it describes, never on it, and inside the page's width.
test('a page places each annotation clear of its target, inside the page width, and places them again when the layout moves', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p class="x">a</p>', annotations: [{ selector: '.x', note: 'a note' }] }] });
  const page = fs.readFileSync(path.join(where.versions, 'v001', 'a.html'), 'utf8');
  const source = page.match(/function placeTooltip\([\s\S]*?\n    \}\n/);
  assert.ok(source, 'the page carries its placement function');
  const placeTooltip = new Function(`${source[0]}; return placeTooltip;`)();
  const view = { top: 0, width: 1000 };
  const tip = { width: 200, height: 40 };
  const cases = [
    ['room above', { top: 200, left: 100, right: 300, bottom: 240 }, 'above'],
    ['at the top, room to the right', { top: 10, left: 100, right: 300, bottom: 50 }, 'right'],
    ['at the top, at the right edge', { top: 10, left: 900, right: 990, bottom: 40 }, 'left'],
    ['at the top, the full width', { top: 10, left: 0, right: 1000, bottom: 60 }, 'below'],
    ['above, at the right edge', { top: 300, left: 950, right: 990, bottom: 320 }, 'above'],
    ['under the viewer\'s own bars', { top: 120, left: 0, right: 1000, bottom: 170 }, 'below', { top: 100, width: 1000 }],
  ];
  for (const [label, target, side, within = view] of cases) {
    const placed = placeTooltip(target, tip, within);
    assert.equal(placed.side, side, label);
    const box = { top: placed.top, left: placed.left, right: placed.left + tip.width, bottom: placed.top + tip.height };
    const overlaps = box.left < target.right && box.right > target.left && box.top < target.bottom && box.bottom > target.top;
    assert.equal(overlaps, false, `${label}: the note covers its target`);
    assert.ok(box.left >= 0 && box.right <= within.width, `${label}: the note leaves the page width`);
    assert.ok(box.top >= within.top, `${label}: the note covers the viewer's own bars`);
  }
  assert.match(page, /addEventListener\('resize'/, 'placed again when the window is resized');
  assert.match(page, /addEventListener\('load'/, 'placed again once the page has loaded');
});

// A gallery card shows the screen alone: its own markup in a private frame, never the studio page with its bars.
test('a gallery card frames nothing around the screen: its own html and css, scripts off', t => {
  const where = project(t);
  wholeTurn(where, { screens: [
    { slug: 'list', title: 'List', html: '<header class="app">Todos & "more"</header><main>list</main>', css: '.app{color:red}', annotations: [{ selector: '.app', note: 'the app bar' }] },
    { slug: 'empty', title: 'Empty', html: '<p>nothing</p>' },
  ] });
  const gallery = fs.readFileSync(path.join(where.versions, 'v001', 'index.html'), 'utf8');
  const frames = [...gallery.matchAll(/<iframe\b[^>]*>/g)].map(match => match[0]);
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.doesNotMatch(frame, /\ssrc=/, 'a card never loads the studio page');
    assert.match(frame, /\ssandbox=""/, 'no script runs in a card');
    const srcdoc = frame.match(/\ssrcdoc="([^"]*)"/);
    assert.ok(srcdoc, frame);
    const doc = srcdoc[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.doesNotMatch(doc, /mockup-container|annotation-toggle|screen-nav|annotation-tooltip/, 'no studio chrome in a card');
  }
  const first = frames[0].match(/\ssrcdoc="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.ok(first.includes('<style>html,body{margin:0}.app{color:red}</style>'), first);
  assert.ok(first.includes('<header class="app">Todos & "more"</header><main>list</main>'), first);
  assert.match(gallery, /<a class="card" href="list\.html">/, 'the card still opens the screen\'s page');
});

test('the flat view is refreshed from the published version, dropping its removed pages and keeping imported ones', t => {
  const where = project(t);
  fs.mkdirSync(where.out, { recursive: true });
  fs.writeFileSync(path.join(where.out, 'imported.html'), '<p>from intake</p>');
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }, { slug: 'b', title: 'B', html: '<p>b</p>' }] });
  assert.ok(fs.existsSync(path.join(where.out, 'a.html')));
  assert.ok(fs.existsSync(path.join(where.out, 'b.html')));

  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a, again</p>' }], drop: ['b'] });
  assert.equal(fs.existsSync(path.join(where.out, 'b.html')), false, 'a dropped slug\'s flat page is removed');
  assert.match(fs.readFileSync(path.join(where.out, 'a.html'), 'utf8'), /a, again/);
  assert.equal(fs.readFileSync(path.join(where.out, 'imported.html'), 'utf8'), '<p>from intake</p>');
  assert.equal(fs.readFileSync(path.join(where.out, 'a.html'), 'utf8'), fs.readFileSync(path.join(where.versions, 'v002', 'a.html'), 'utf8'));
  assert.ok(fs.existsSync(path.join(where.versions, 'v001', 'b.html')), 'the old version is untouched');
});

test('INDEX rows are rewritten in place for owned slugs, and the ASCII format points at anchors', async t => {
  const subdir = 'analysis/design-context/mockups';
  const indexRel = 'analysis/design-context/INDEX.md';

  await t.test('owned rows are replaced in place; intake rows and surrounding text are kept', () => {
    const where = project(t);
    const indexFile = path.join(where.task, indexRel);
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    fs.writeFileSync(indexFile, [
      '# Design context', '', 'Text before.', '',
      '| ID | Type | Source | Description |',
      '|----|------|--------|-------------|',
      `| screen:legacy | screen | ${subdir}/legacy.html | imported at intake |`,
      '', 'Text after.', '',
    ].join('\n'));
    const args = { begin: [`--subdir=${subdir}`], finish: [`--subdir=${subdir}`, `--index=${indexRel}`] };
    wholeTurn(where, {
      screens: [
        { slug: 'a', title: 'A', html: '<p>a</p>', description: 'first | screen', behaviour: ['click saves', 'esc closes'], components: [{ id: 'save-button', description: 'the save button' }] },
        { slug: 'b', title: 'B', html: '<p>b</p>' },
      ],
    }, args);
    let text = fs.readFileSync(indexFile, 'utf8');
    assert.match(text, /^Text before\.$/m);
    assert.match(text, /^Text after\.$/m);
    assert.match(text, new RegExp(`^\\| screen:legacy \\| screen \\| ${subdir}/legacy\\.html \\| imported at intake \\|$`, 'm'));
    assert.match(text, new RegExp(`^\\| screen:a \\| screen \\| ${subdir}/a\\.html \\| first \\\\\\| screen; behaviour: click saves; esc closes \\|$`, 'm'));
    assert.match(text, new RegExp(`^\\| component:save-button \\| component \\| ${subdir}/a\\.html \\| the save button \\|$`, 'm'));
    assert.match(text, new RegExp(`^\\| screen:b \\| screen \\| ${subdir}/b\\.html \\| B \\|$`, 'm'));
    assert.doesNotMatch(text, /versions\//, 'no Source points into versions/');

    wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a2</p>', description: 'redrawn' }], drop: ['b'] }, args);
    text = fs.readFileSync(indexFile, 'utf8');
    const lines = text.split('\n');
    const header = lines.indexOf('| ID | Type | Source | Description |');
    assert.deepEqual(lines.slice(header + 2, header + 4), [
      `| screen:legacy | screen | ${subdir}/legacy.html | imported at intake |`,
      `| screen:a | screen | ${subdir}/a.html | redrawn |`,
    ]);
    assert.doesNotMatch(text, /screen:b /);
    assert.doesNotMatch(text, /component:save-button/);
    assert.equal(lines.filter(line => line.startsWith('| ID |')).length, 1);
    assert.match(text, /^Text after\.$/m);
  });

  await t.test('a file with no table gains one, and a missing file is created', () => {
    const where = project(t);
    const indexFile = path.join(where.task, indexRel);
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    fs.writeFileSync(indexFile, '# Design context\n\nNo table yet.\n');
    const args = { begin: [`--subdir=${subdir}`], finish: [`--subdir=${subdir}`, `--index=${indexRel}`] };
    wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] }, args);
    const text = fs.readFileSync(indexFile, 'utf8');
    assert.match(text, /^No table yet\.$/m);
    assert.match(text, /\| ID \| Type \| Source \| Description \|\n\|[-| ]+\|\n\| screen:a \| screen \| analysis\/design-context\/mockups\/a\.html \| A \|/);

    const fresh = project(t);
    wholeTurn(fresh, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] }, args);
    assert.match(fs.readFileSync(path.join(fresh.task, indexRel), 'utf8'), /\| screen:a \| screen \|/);
  });

  await t.test('the ASCII format writes no pages and points rows at the document\'s anchors', () => {
    const where = project(t);
    const args = { begin: [`--subdir=${subdir}`], finish: [`--subdir=${subdir}`, `--index=${indexRel}`] };
    const started = turn(where, 'begin', args.begin);
    fs.writeFileSync(path.join(started.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## Home {#home}\n\n```\n[ ]\n```\n');
    writeTurn(started.json.version_dir, { format: 'ascii', screens: [{ slug: 'home', title: 'Home', description: 'the home screen' }] });
    const finished = turn(where, 'finish', [`--version=${started.json.version}`, ...args.finish]);
    assert.equal(finished.code, 0, finished.stdout + finished.stderr);
    assert.equal(finished.json.gallery, null);
    assert.equal(finished.json.format, 'ascii');
    assert.deepEqual(finished.json.changed, ['home']);
    const out = path.join(where.task, subdir);
    assert.deepEqual(tree(path.join(out, 'versions', 'v001')), ['.mockups.json', 'ascii-mockups.md', 'manifest.json']);
    assert.equal(fs.readFileSync(path.join(out, 'ascii-mockups.md'), 'utf8'), fs.readFileSync(path.join(out, 'versions', 'v001', 'ascii-mockups.md'), 'utf8'));
    assert.match(fs.readFileSync(path.join(where.task, indexRel), 'utf8'),
      new RegExp(`^\\| screen:home \\| screen \\| ${subdir}/ascii-mockups\\.md#home \\| the home screen \\|$`, 'm'));
  });
});

test('--preview writes only inside the version, --record writes the result, and no temp file is left, under a path with a space', t => {
  const where = project(t, 'maister mockup turn ');
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });

  const outside = () => tree(where.root).filter(rel => !rel.includes('/versions/v002/'));
  const before = outside();
  const beforeIndex = fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8');
  const preview = turn(where, 'finish', ['--version=v002', '--preview']);
  assert.equal(preview.code, 0, preview.stdout + preview.stderr);
  assert.deepEqual(outside(), before, 'nothing outside the version folder was written');
  assert.equal(fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8'), beforeIndex);
  assert.ok(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), 'the input file is kept');
  assert.ok(fs.existsSync(path.join(started.json.version_dir, 'b.html')));
  assert.ok(fs.existsSync(path.join(started.json.version_dir, 'index.html')));
  assert.ok(fs.existsSync(path.join(started.json.version_dir, 'manifest.json')));

  const record = path.join(where.root, 'run folder', 'turn-result.json');
  const finished = turn(where, 'finish', ['--version=v002', `--record=${record}`]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  const { ok, values, ...rest } = finished.json;
  assert.deepEqual(readJson(record), rest);
  assert.equal(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), false, 'the input file is consumed');
  const leftovers = tree(where.root).filter(rel => /\.tmp$|(^|\/)\.lock$/.test(rel));
  assert.deepEqual(leftovers, []);
});

test('finish refuses a bad slug, a missing input file, a published version and an empty screen set', async t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });

  await t.test('slug-invalid keeps the input file and writes nothing', () => {
    const started = turn(where, 'begin');
    writeTurn(started.json.version_dir, { screens: [{ slug: 'Not A Slug', title: 'X', html: '' }] });
    const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
    assert.equal(refused.code, 1);
    assert.deepEqual([refused.json.ok, refused.json.code], [false, 'slug-invalid']);
    assert.deepEqual(tree(started.json.version_dir), ['.turn.json']);
  });

  await t.test('turn-file-missing', () => {
    const started = turn(where, 'begin');
    const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
    assert.equal(refused.code, 1);
    assert.equal(refused.json.code, 'turn-file-missing');
  });

  await t.test('version-published', () => {
    const refused = turn(where, 'finish', ['--version=v001']);
    assert.equal(refused.code, 1);
    assert.equal(refused.json.code, 'version-published');
  });

  await t.test('screens-empty is the resolved set, not an empty list in the input file', () => {
    const emptied = turn(where, 'begin', ['--against=v001']);
    writeTurn(emptied.json.version_dir, { screens: [], drop: ['a'] });
    const refused = turn(where, 'finish', [`--version=${emptied.json.version}`]);
    assert.equal(refused.code, 1);
    assert.equal(refused.json.code, 'screens-empty');

    const carried = turn(where, 'begin', ['--against=v001']);
    writeTurn(carried.json.version_dir, { screens: [] });
    const finished = turn(where, 'finish', [`--version=${carried.json.version}`]);
    assert.equal(finished.code, 0, finished.stdout + finished.stderr);
    assert.deepEqual(finished.json.screens, ['a']);
    assert.deepEqual(finished.json.changed, []);
  });

  await t.test('a refusal prints a message saying what to do', () => {
    const refused = turn(where, 'finish', ['--version=v001']);
    assert.ok(refused.json.message.length > 40, refused.json.message);
  });
});

test('an html version built on must keep its .mockups.json; only an ascii version may lack one', async t => {
  const damages = {
    'missing': file => fs.rmSync(file),
    'not JSON': file => fs.writeFileSync(file, '{not json'),
    'lacking a screen': file => {
      const mockups = readJson(file);
      fs.writeFileSync(file, JSON.stringify({ ...mockups, mockups: mockups.mockups.filter(each => each.id !== 'b') }));
    },
  };
  for (const [what, damage] of Object.entries(damages)) {
    await t.test(`a .mockups.json ${what} is refused index-malformed, the input kept and nothing published`, () => {
      const where = project(t);
      wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }, { slug: 'b', title: 'B', html: '<p>b</p>' }] });
      damage(path.join(where.versions, 'v001', '.mockups.json'));
      const indexBefore = fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8');
      const started = turn(where, 'begin');
      writeTurn(started.json.version_dir, { screens: [{ slug: 'c', title: 'C', html: '<p>c</p>' }] });
      const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
      assert.equal(refused.code, 1, refused.stdout + refused.stderr);
      assert.deepEqual([refused.json.ok, refused.json.code], [false, 'index-malformed']);
      assert.match(refused.json.message, /\.mockups\.json/);
      assert.deepEqual(tree(started.json.version_dir), ['.turn.json']);
      assert.equal(fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8'), indexBefore);
    });

    await t.test(`a .mockups.json ${what} does not refuse an ascii turn, which carries nothing from it`, () => {
      const where = project(t);
      wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }, { slug: 'b', title: 'B', html: '<p>b</p>' }] });
      damage(path.join(where.versions, 'v001', '.mockups.json'));
      const started = turn(where, 'begin');
      fs.writeFileSync(path.join(started.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## C {#c}\n');
      writeTurn(started.json.version_dir, { format: 'ascii', screens: [{ slug: 'c', title: 'C' }] });
      const finished = turn(where, 'finish', [`--version=${started.json.version}`]);
      assert.equal(finished.code, 0, finished.stdout + finished.stderr);
      assert.deepEqual(finished.json.screens, ['c']);
      assert.deepEqual(readJson(path.join(where.versions, 'index.json')).versions.map(each => each.version), ['v001', started.json.version]);
    });
  }

  await t.test('an ascii version with no .mockups.json still carries its screens over', () => {
    const where = project(t);
    const started = turn(where, 'begin');
    fs.writeFileSync(path.join(started.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## Home {#home}\n');
    writeTurn(started.json.version_dir, { format: 'ascii', screens: [{ slug: 'home', title: 'Home' }] });
    assert.equal(turn(where, 'finish', [`--version=${started.json.version}`]).code, 0);
    fs.rmSync(path.join(where.versions, 'v001', '.mockups.json'));

    const next = turn(where, 'begin');
    fs.writeFileSync(path.join(next.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## Home {#home}\n\n## List {#list}\n');
    writeTurn(next.json.version_dir, { format: 'ascii', screens: [{ slug: 'list', title: 'List' }] });
    const finished = turn(where, 'finish', [`--version=${next.json.version}`]);
    assert.equal(finished.code, 0, finished.stdout + finished.stderr);
    assert.deepEqual(finished.json.screens, ['home', 'list']);
  });
});

// Gap tests added in the test review: cases the feature's other tests leave
// to hand checks.

test('finish refuses index-locked under a held lock and keeps everything, and reclaims a lock older than a minute', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });
  const lock = path.join(where.versions, '.lock');
  fs.writeFileSync(lock, '');
  const beforeIndex = fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8');

  const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(refused.code, 1);
  assert.deepEqual([refused.json.ok, refused.json.code], [false, 'index-locked']);
  assert.equal(fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8'), beforeIndex);
  assert.deepEqual(tree(started.json.version_dir), ['.turn.json']);
  assert.ok(fs.existsSync(lock), 'a lock the turn did not take is left alone');

  const old = new Date(Date.now() - 5 * 60_000);
  fs.utimesSync(lock, old, old);
  const finished = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  assert.equal(fs.existsSync(lock), false, 'the reclaimed lock is released');
});

test('a second finish of a published version is refused version-published and changes nothing', t => {
  const where = project(t);
  const done = wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const before = tree(where.root);
  const index = fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8');
  const again = turn(where, 'finish', [`--version=${done.version}`]);
  assert.equal(again.code, 1);
  assert.equal(again.json.code, 'version-published');
  assert.deepEqual(tree(where.root), before);
  assert.equal(fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8'), index);
});

test('a version in another format holds only the screens sent, and a hand-set bookmarked key survives finish', t => {
  const where = project(t);
  wholeTurn(where, {
    screens: [
      { slug: 'a', title: 'A', html: '<p>a</p>' },
      { slug: 'b', title: 'B', html: '<p>b</p>' },
    ],
  });
  const indexFile = path.join(where.versions, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify({ ...readJson(indexFile), bookmarked: 'v001' }, null, 2));

  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { format: 'ascii', screens: [{ slug: 'c', title: 'C', html: '' }] });
  fs.writeFileSync(path.join(started.json.version_dir, 'ascii-mockups.md'), '# C\n\n```\n+--+\n```\n');
  const finished = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  assert.deepEqual(finished.json.screens, ['c'], 'nothing is carried across formats');
  assert.deepEqual(readJson(path.join(where.versions, 'v002', 'manifest.json')).screens.map(each => each.slug), ['c']);
  const index = readJson(indexFile);
  assert.equal(index.bookmarked, 'v001', 'kept as found');
  assert.equal(index.latest, 'v002');
});

test('a prototype-fidelity finish reads .frames.json, links each screen to its scene and keeps the prototype page', t => {
  const where = project(t);
  const started = turn(where, 'begin');
  const dir = started.json.version_dir;
  fs.copyFileSync(path.join(ROOT, 'tests/fixtures/mockup-studio/prototype.html'), path.join(dir, 'prototype.html'));
  const frames = run(path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/frames.mjs'), ['export', `--version-dir=${dir}`]);
  assert.equal(frames.code, 0, frames.stdout + frames.stderr);
  writeTurn(dir, { fidelity: 'prototype' });

  const finished = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  assert.deepEqual(finished.json.screens, ['order-summary', 'empty-cart']);
  assert.equal(finished.json.fidelity, 'prototype');
  const manifest = readJson(path.join(dir, 'manifest.json'));
  assert.equal(manifest.prototype, 'prototype.html');
  assert.deepEqual(manifest.screens.map(each => each.live), ['prototype.html#order-summary', 'prototype.html#empty-cart']);
  assert.ok(fs.existsSync(path.join(dir, 'prototype.html')));
  assert.equal(fs.existsSync(path.join(dir, '.frames.json')), false, 'the frames file is consumed');
  assert.equal(fs.existsSync(path.join(dir, '.turn.json')), false);
});

test('a prototype in the ascii format and a prototype with no frames file are refused before anything is written', t => {
  const where = project(t);
  const asciiProto = turn(where, 'begin');
  writeTurn(asciiProto.json.version_dir, { fidelity: 'prototype', format: 'ascii' });
  const refused = turn(where, 'finish', [`--version=${asciiProto.json.version}`]);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.ok, false);
  assert.deepEqual(tree(asciiProto.json.version_dir), ['.turn.json']);

  const noFrames = turn(where, 'begin');
  writeTurn(noFrames.json.version_dir, { fidelity: 'prototype' });
  const missing = turn(where, 'finish', [`--version=${noFrames.json.version}`]);
  assert.equal(missing.code, 1);
  assert.equal(missing.json.code, 'turn-file-missing');
  assert.deepEqual(tree(noFrames.json.version_dir), ['.turn.json']);
  assert.equal(fs.existsSync(path.join(where.versions, 'index.json')), false);
});

test('an unwritable versions folder is folded into folder-unwritable by finish, with the input kept', t => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('folder permissions are not enforced here');
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });
  fs.chmodSync(where.versions, 0o555);
  // A safety net for a failed assertion below; the scratch teardown may already have removed the folder.
  t.after(() => fs.existsSync(where.versions) && fs.chmodSync(where.versions, 0o755));
  const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
  fs.chmodSync(where.versions, 0o755);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.equal(refused.json.code, 'folder-unwritable');
  assert.ok(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), 'the input file is kept');
  assert.deepEqual(readJson(path.join(where.versions, 'index.json')).versions.map(each => each.version), ['v001']);
});

// A fresh temp beside a target is a live writer's, so the write is refused:
// a portable way to make one write fail partway through a publish.
const holdTemp = target => fs.writeFileSync(path.join(path.dirname(target), `.${path.basename(target)}.tmp`), '');

test('a publish that fails at the index write says nothing was published, and finish recovers', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });
  const index = path.join(where.versions, 'index.json');
  holdTemp(index);
  const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.equal(refused.json.code, 'folder-unwritable');
  assert.match(refused.json.message, /Already landed: the version's files/);
  assert.match(refused.json.message, /nothing was published and the input file is kept/);
  assert.match(refused.json.message, /run finish again/);
  assert.doesNotMatch(refused.json.message, /is published|do not run finish/);
  assert.ok(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), 'the input file is kept');
  assert.deepEqual(readJson(index).versions.map(each => each.version), ['v001']);

  fs.rmSync(path.join(where.versions, '.index.json.tmp'));
  const again = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.deepEqual(readJson(index).versions.map(each => each.version), ['v001', started.json.version]);
});

test('a --preview whose write fails is folder-unwritable, with nothing published and the input kept', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });
  holdTemp(path.join(started.json.version_dir, 'manifest.json'));
  const refused = turn(where, 'finish', [`--version=${started.json.version}`, '--preview']);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.equal(refused.json.code, 'folder-unwritable');
  assert.doesNotMatch(refused.json.message, /^[a-z-]+: /, 'the code is not repeated in the message');
  assert.match(refused.json.message, /\. Nothing was published and the input file is kept; make the folder writable and run finish again\.$/);
  assert.ok(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), 'the input file is kept');
});

test('a publish that fails after the index write says the version is published', t => {
  const where = project(t);
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });
  const started = turn(where, 'begin');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] });
  holdTemp(path.join(where.out, 'b.html'));
  const refused = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.equal(refused.json.code, 'folder-unwritable');
  assert.match(refused.json.message, /the index entry, with v002 as latest/);
  assert.match(refused.json.message, /v002 is published, so do not run finish for it again/);
  assert.deepEqual(readJson(path.join(where.versions, 'index.json')).versions.map(each => each.version), ['v001', 'v002']);
});

// ---------------------------------------------------------------------------
// the written scope: format scope, a version that is its scope.md
// ---------------------------------------------------------------------------

/** One written turn: begin, `scope.md` and `.turn.json`, finish. Returns what begin and finish printed. */
function scopeTurn(where, text, body = {}, { begin = [], finish = [], expect = 0 } = {}) {
  const started = turn(where, 'begin', begin);
  assert.equal(started.code, 0, started.stdout + started.stderr);
  if (text !== null) fs.writeFileSync(path.join(started.json.version_dir, 'scope.md'), text);
  writeTurn(started.json.version_dir, { format: 'scope', ...body });
  const finished = turn(where, 'finish', [`--version=${started.json.version}`, ...finish]);
  assert.equal(finished.code, expect, finished.stdout + finished.stderr);
  return { started: started.json, finished: finished.json, dir: started.json.version_dir };
}

const FIRST_SCOPE = [
  '# Support inbox',
  '',
  'What the first release holds.',
  '',
  '## In scope',
  '- Reply from the inbox',
  '- Assign a ticket to a teammate',
  '## Out of scope',
  '- Bulk export',
  '',
].join('\n');

const MARKED_SCOPE = [
  '# Support inbox',
  '## In scope',
  '- [changed] Reply from the ticket view',
  '  - was: Reply from the inbox',
  '- Assign a ticket to a teammate',
  '- [added] Snooze a ticket until a date',
  '## Out of scope',
  '- [removed] Bulk export',
  '',
].join('\n');

test('a first written round publishes scope.md as the version, its rendered page and the manifest, and no screens', t => {
  const where = project(t);
  fs.mkdirSync(where.out, { recursive: true });
  fs.writeFileSync(path.join(where.out, '.mockups.json'), '{}');
  const record = path.join(where.root, 'run', 'turn-result.json');
  const { finished, dir } = scopeTurn(where, FIRST_SCOPE, { fidelity: 'prototype', grounding: { digest: 'abc', stale: true }, screens: [{ slug: 'x', title: 'X' }], drop: ['y'], scope: ['Not A Slug'] }, { finish: [`--record=${record}`] });

  const manifest = readJson(path.join(dir, 'manifest.json'));
  assert.deepEqual(departures(manifest, { type: 'object', keys: MANIFEST_KEYS }), []);
  assert.deepEqual(
    [manifest.format, manifest.fidelity, manifest.screens, manifest.grounding_digest, manifest.grounding_stale, manifest.parent],
    ['scope', 'sketch', [], null, false, null]);
  assert.deepEqual(manifest.sections, [
    { slug: 'in-scope', title: 'In scope', items: 2, added: 0, removed: 0, changed: 0 },
    { slug: 'out-of-scope', title: 'Out of scope', items: 1, added: 0, removed: 0, changed: 0 },
  ]);

  const index = readJson(path.join(where.versions, 'index.json'));
  assert.deepEqual(departures(index, { type: 'object', keys: VERSIONS_INDEX_KEYS }), []);
  assert.deepEqual([index.versions[0].format, index.versions[0].changed], ['scope', []]);

  assert.deepEqual(tree(dir), ['index.html', 'manifest.json', 'scope.md'], 'no .mockups.json, no pages, the input file consumed');
  assert.deepEqual(tree(where.out).filter(rel => !rel.startsWith('versions/')), ['scope.md'], 'the flat view holds scope.md only');
  assert.equal(fs.readFileSync(path.join(where.out, 'scope.md'), 'utf8'), FIRST_SCOPE);

  assert.deepEqual([finished.format, finished.fidelity, finished.screens, finished.changed], ['scope', 'sketch', [], []]);
  assert.equal(finished.gallery, `${SUBDIR}/versions/v001/index.html`);
  assert.deepEqual([finished.values.screens, finished.values.changed, finished.values.format, finished.values.fidelity], ['', '', 'scope', 'sketch']);
  const { ok, values, ...rest } = finished;
  assert.deepEqual(readJson(record), rest);
  assert.deepEqual(departures(rest, { type: 'object', keys: TURN_RESULT_KEYS }), []);

  const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(page, /Written scope v001/);
  assert.match(page, /Support inbox/);
  assert.match(page, /What the first release holds\./);
  assert.match(page, /<section id="in-scope">/);
  assert.match(page, /href="scope\.md"/);
  assert.doesNotMatch(page, /sections changed/, 'no earlier scope, no change count');
  assert.doesNotMatch(page, /<script\b|<link\b|src=/, 'self-contained, no script');
});

test('a written round against a written one gets the earlier scope from begin and accepts honest marks', t => {
  const where = project(t);
  const first = scopeTurn(where, FIRST_SCOPE);
  assert.equal(first.started.against_scope, null);
  const second = scopeTurn(where, MARKED_SCOPE);
  assert.equal(second.started.against, 'v001');
  assert.equal(second.started.against_scope, path.join(where.versions, 'v001', 'scope.md'));
  assert.deepEqual(second.started.screens, []);

  assert.deepEqual(second.finished.changed, ['in-scope', 'out-of-scope']);
  assert.equal(second.finished.values.changed, 'in-scope,out-of-scope');
  const manifest = readJson(path.join(second.dir, 'manifest.json'));
  assert.equal(manifest.parent, 'v001');
  assert.deepEqual(manifest.sections, [
    { slug: 'in-scope', title: 'In scope', items: 3, added: 1, removed: 0, changed: 1 },
    { slug: 'out-of-scope', title: 'Out of scope', items: 0, added: 0, removed: 1, changed: 0 },
  ]);
  assert.deepEqual(readJson(path.join(where.versions, 'index.json')).versions[1].changed, ['in-scope', 'out-of-scope']);

  const page = fs.readFileSync(path.join(second.dir, 'index.html'), 'utf8');
  assert.match(page, /2 of 2 sections changed/);
  assert.match(page, /href="\.\.\/v001\/index\.html">Previous version: v001</);
  assert.match(page, /Added<\/span>/);
  assert.match(page, /Removed<\/span>/);
  assert.match(page, /was: Reply from the inbox/);
});

test('a written round from an html or an ascii version publishes unmarked and links the screens it was written from', async t => {
  for (const [format, link] of [['html', 'index.html'], ['ascii', 'ascii-mockups.md']]) {
    await t.test(format, () => {
      const where = project(t);
      const started = turn(where, 'begin');
      if (format === 'ascii') fs.writeFileSync(path.join(started.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## Home {#home}\n');
      writeTurn(started.json.version_dir, { format, screens: [{ slug: 'home', title: 'Home', html: '<p>home</p>' }] });
      assert.equal(turn(where, 'finish', ['--version=v001']).code, 0);

      const written = scopeTurn(where, FIRST_SCOPE);
      assert.equal(written.started.against_scope, null);
      assert.deepEqual(written.started.screens, [{ slug: 'home', title: 'Home' }]);
      const manifest = readJson(path.join(written.dir, 'manifest.json'));
      assert.deepEqual([manifest.parent, manifest.screens], ['v001', []]);
      assert.deepEqual(written.finished.changed, []);
      const page = fs.readFileSync(path.join(written.dir, 'index.html'), 'utf8');
      assert.ok(page.includes(`href="../v001/${link}">Written from the screens of v001</a>`), page);
      assert.equal(fs.existsSync(path.join(where.out, 'home.html')), false, 'the screens version\'s flat page is gone');
      assert.equal(fs.existsSync(path.join(where.out, '.mockups.json')), false);
      assert.equal(fs.existsSync(path.join(where.out, 'ascii-mockups.md')), false);
    });
  }
});

test('a three-round written chain starts each round from the stripped earlier scope', t => {
  const where = project(t);
  scopeTurn(where, FIRST_SCOPE);
  scopeTurn(where, MARKED_SCOPE);
  // The earlier round's tags and was line are not part of its text, and the removed item is gone from it.
  const third = scopeTurn(where, [
    '## In scope',
    '- Reply from the ticket view',
    '- Assign a ticket to a teammate',
    '- [removed] Snooze a ticket until a date',
    '## Out of scope',
    '- [added] Bulk export',
    '',
  ].join('\n'));
  assert.deepEqual(third.finished.changed, ['in-scope', 'out-of-scope']);
  assert.deepEqual(readJson(path.join(third.dir, 'manifest.json')).sections.map(each => [each.items, each.added, each.removed]), [[2, 0, 1], [1, 1, 0]]);

  // "Bulk export" was removed in v002, so it is not an earlier item to keep unmarked.
  const refused = scopeTurn(where, '## In scope\n- Reply from the ticket view\n- Assign a ticket to a teammate\n- Snooze a ticket until a date\n## Out of scope\n- Bulk export\n', { against: 'v002' }, { begin: ['--against=v002'], expect: 1 });
  assert.equal(refused.finished.code, 'scope-marks-invalid');
  assert.match(refused.finished.message, /"Bulk export"/);
  assert.doesNotMatch(refused.finished.message, /Snooze|Reply/, 'only the removed item is a problem');
});

test('finish refuses a dishonest or empty written scope and a missing scope.md, writing nothing and keeping both inputs', async t => {
  const where = project(t);
  scopeTurn(where, '## Do\n- One\n- Two\n## Later\n- Three\n');
  const html = project(t);
  wholeTurn(html, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] });

  const cases = [
    ['an unmarked new item', '## Do\n- One\n- Two\n- New\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['an [added] item that existed', '## Do\n- One\n- [added] Two\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['a [removed] item that never existed', '## Do\n- One\n- Two\n- [removed] Ghost\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['a false was line', '## Do\n- One\n- [changed] Deux\n  - was: Zwei\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['a [changed] item with no was line', '## Do\n- One\n- [changed] Deux\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['a was line on an unmarked item', '## Do\n- One\n- Two\n  - was: One\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['an earlier item gone unmarked', '## Do\n- One\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['an absent earlier section that held items', '## Do\n- One\n- Two\n', 'scope-marks-invalid'],
    ['a duplicate heading', '## Do\n- One\n- Two\n## Later\n- Three\n## Do\n- [added] Four\n', 'scope-marks-invalid'],
    ['a duplicate item text', '## Do\n- One\n- Two\n- [added] One\n## Later\n- Three\n', 'scope-marks-invalid'],
    ['an empty scope', '## Do\n- [removed] One\n- [removed] Two\n## Later\n- [removed] Three\n', 'scope-empty'],
    ['a missing scope.md', null, 'turn-file-missing'],
  ];
  for (const [what, text, code] of cases) {
    await t.test(what, () => {
      const indexBefore = fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8');
      const flatBefore = tree(where.out).filter(rel => !rel.startsWith('versions/'));
      const refused = scopeTurn(where, text, {}, { begin: ['--against=v001'], expect: 1 });
      assert.deepEqual([refused.finished.ok, refused.finished.code], [false, code]);
      assert.deepEqual(tree(refused.dir), text === null ? ['.turn.json'] : ['.turn.json', 'scope.md'], 'both inputs kept, nothing written');
      assert.equal(fs.readFileSync(path.join(where.versions, 'index.json'), 'utf8'), indexBefore);
      assert.deepEqual(tree(where.out).filter(rel => !rel.startsWith('versions/')), flatBefore);
    });
  }

  await t.test('a mark against an html version', () => {
    const refused = scopeTurn(html, '## Do\n- [added] One\n', {}, { expect: 1 });
    assert.equal(refused.finished.code, 'scope-marks-invalid');
    assert.deepEqual(tree(refused.dir), ['.turn.json', 'scope.md']);
  });
});

test('an html round after a written version carries nothing over and clears the flat scope.md; every entry carries its format', t => {
  const where = project(t);
  scopeTurn(where, FIRST_SCOPE);
  const started = turn(where, 'begin');
  assert.equal(started.json.against_scope, path.join(where.versions, 'v001', 'scope.md'), 'a screens round gets the scope as context too');
  writeTurn(started.json.version_dir, { screens: [{ slug: 'inbox', title: 'Inbox', html: '<p>inbox</p>' }] });
  const finished = turn(where, 'finish', [`--version=${started.json.version}`]);
  assert.equal(finished.code, 0, finished.stdout + finished.stderr);
  assert.deepEqual(finished.json.screens, ['inbox']);
  assert.equal(fs.existsSync(path.join(where.out, 'scope.md')), false, 'the flat scope.md is removed');
  assert.ok(fs.existsSync(path.join(where.out, 'inbox.html')));
  assert.ok(fs.existsSync(path.join(where.out, '.mockups.json')));

  const ascii = turn(where, 'begin');
  fs.writeFileSync(path.join(ascii.json.version_dir, 'ascii-mockups.md'), '# Mockups\n\n## Inbox {#inbox}\n');
  writeTurn(ascii.json.version_dir, { format: 'ascii', screens: [{ slug: 'inbox', title: 'Inbox' }] });
  assert.equal(turn(where, 'finish', [`--version=${ascii.json.version}`]).code, 0);
  assert.deepEqual(readJson(path.join(where.versions, 'index.json')).versions.map(each => each.format), ['scope', 'html', 'ascii']);
});

test('--index writes one scope row for a written latest, and a screens round after it removes that row', t => {
  const where = project(t);
  const indexRel = 'analysis/design-context/INDEX.md';
  const indexFile = path.join(where.task, indexRel);
  const args = { finish: [`--index=${indexRel}`] };
  wholeTurn(where, { screens: [{ slug: 'a', title: 'A', html: '<p>a</p>' }] }, args);
  scopeTurn(where, FIRST_SCOPE, {}, args);
  let text = fs.readFileSync(indexFile, 'utf8');
  assert.match(text, new RegExp(`^\\| scope:v002 \\| scope \\| ${SUBDIR}/scope\\.md \\| Support inbox \\|$`, 'm'));
  assert.doesNotMatch(text, /screen:a /, 'the owned screen rows are replaced');

  scopeTurn(where, '## In scope\n- [removed] Reply from the inbox\n- [removed] Assign a ticket to a teammate\n## Out of scope\n- Bulk export\n', {}, args);
  text = fs.readFileSync(indexFile, 'utf8');
  assert.match(text, new RegExp(`^\\| scope:v003 \\| scope \\| ${SUBDIR}/scope\\.md \\| Written scope \\|$`, 'm'), 'no title, the fallback description');
  assert.doesNotMatch(text, /scope:v002/);

  wholeTurn(where, { screens: [{ slug: 'b', title: 'B', html: '<p>b</p>' }] }, args);
  text = fs.readFileSync(indexFile, 'utf8');
  assert.doesNotMatch(text, /\| scope:/);
  assert.match(text, new RegExp(`^\\| screen:b \\| screen \\| ${SUBDIR}/b\\.html \\| B \\|$`, 'm'));
});

test('a written --preview writes index.html and the manifest only, publishes nothing and keeps both inputs', t => {
  const where = project(t);
  const started = turn(where, 'begin');
  fs.writeFileSync(path.join(started.json.version_dir, 'scope.md'), FIRST_SCOPE);
  writeTurn(started.json.version_dir, { format: 'scope' });
  const before = tree(where.root).filter(rel => !rel.includes('/versions/v001/'));
  const preview = turn(where, 'finish', ['--version=v001', '--preview']);
  assert.equal(preview.code, 0, preview.stdout + preview.stderr);
  assert.equal(preview.json.preview, true);
  assert.deepEqual(tree(started.json.version_dir), ['.turn.json', 'index.html', 'manifest.json', 'scope.md']);
  assert.deepEqual(tree(where.root).filter(rel => !rel.includes('/versions/v001/')), before, 'nothing outside the version folder');
  assert.equal(fs.existsSync(path.join(where.versions, 'index.json')), false, 'nothing published');
});

test('a linked or non-UTF-8 scope.md is refused turn-file-malformed, with nothing written', async t => {
  const cases = [
    ['non-UTF-8 bytes', where => fs.writeFileSync(path.join(where.dir, 'scope.md'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]))],
    ['a symbolic link', where => {
      const target = path.join(where.root, 'elsewhere.md');
      fs.writeFileSync(target, FIRST_SCOPE);
      fs.symlinkSync(target, path.join(where.dir, 'scope.md'));
    }],
  ];
  for (const [what, place] of cases) {
    await t.test(what, t2 => {
      const where = project(t2);
      const started = turn(where, 'begin');
      place({ root: where.root, dir: started.json.version_dir });
      writeTurn(started.json.version_dir, { format: 'scope' });
      const refused = turn(where, 'finish', ['--version=v001']);
      assert.equal(refused.code, 1, refused.stdout + refused.stderr);
      assert.deepEqual([refused.json.ok, refused.json.code], [false, 'turn-file-malformed']);
      assert.equal(fs.existsSync(path.join(where.versions, 'index.json')), false);
      assert.equal(fs.existsSync(path.join(started.json.version_dir, 'index.html')), false);
      assert.ok(fs.existsSync(path.join(started.json.version_dir, '.turn.json')), 'the input file is kept');
    });
  }
});

test('an earlier written version holding a duplicate is refused index-malformed, naming the duplicate', t => {
  const where = project(t);
  scopeTurn(where, FIRST_SCOPE);
  // Damage the published version after the fact: the same item twice.
  fs.writeFileSync(path.join(where.versions, 'v001', 'scope.md'), '## In scope\n- Reply from the inbox\n- Reply from the inbox\n');
  const refused = scopeTurn(where, '## In scope\n- Reply from the inbox\n', {}, { begin: ['--against=v001'], expect: 1 });
  assert.equal(refused.finished.code, 'index-malformed');
  assert.match(refused.finished.message, /"Reply from the inbox"/);
  assert.deepEqual(tree(refused.dir), ['.turn.json', 'scope.md'], 'both inputs kept, nothing written');
});

test('an earlier written version holding an empty item is refused index-malformed, naming its line', t => {
  const where = project(t);
  scopeTurn(where, FIRST_SCOPE);
  // A hand-edited published version: an item with no text left once its mark is taken off.
  fs.writeFileSync(path.join(where.versions, 'v001', 'scope.md'), '## In scope\n- Reply from the inbox\n- [added]\n');
  const refused = scopeTurn(where, '## In scope\n- Reply from the inbox\n', {}, { begin: ['--against=v001'], expect: 1 });
  assert.equal(refused.finished.code, 'index-malformed');
  assert.match(refused.finished.message, /an empty item of section "In scope" \(line 3\)/);
  assert.deepEqual(tree(refused.dir), ['.turn.json', 'scope.md'], 'both inputs kept, nothing written');
});

test('a written round on a written version with no rendered page links that version\'s scope.md', t => {
  const where = project(t);
  scopeTurn(where, FIRST_SCOPE);
  // A written version drawn by hand has its scope.md and manifest, and no index.html.
  fs.unlinkSync(path.join(where.versions, 'v001', 'index.html'));
  const second = scopeTurn(where, MARKED_SCOPE);
  const page = fs.readFileSync(path.join(second.dir, 'index.html'), 'utf8');
  assert.match(page, /href="\.\.\/v001\/scope\.md">Previous version: v001</);
  assert.doesNotMatch(page, /href="\.\.\/v001\/index\.html"/);
});

test('a written page escapes HTML in headings, items, was lines and prose', t => {
  const where = project(t);
  const { dir } = scopeTurn(where, [
    '# Plan <img src=x onerror=alert(1)>',
    '',
    'Prose with <script>alert("p")</script> & more.',
    '',
    '## Heading <b>bold</b>',
    '- Item <i>one</i> & "two"',
    '',
  ].join('\n'));
  const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(page, /<script\b|<img\b|<b>bold|<i>one/);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /Heading &lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(page, /Item &lt;i&gt;one&lt;\/i&gt; &amp; (&quot;|&#34;)two(&quot;|&#34;)/);

  const second = scopeTurn(where, [
    '## Heading <b>bold</b>',
    '- [changed] Item <u>new</u>',
    '  - was: Item <i>one</i> & "two"',
    '',
  ].join('\n'));
  const marked = fs.readFileSync(path.join(second.dir, 'index.html'), 'utf8');
  assert.doesNotMatch(marked, /<u>new|<i>one/);
  assert.match(marked, /was: Item &lt;i&gt;one&lt;\/i&gt;/);
});
