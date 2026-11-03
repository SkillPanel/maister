import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES, ROOT, run } from '../helpers.mjs';
import { FRAMES_FILE, departures } from '../../plugins/maister/skills/mockup-studio/scripts/lib/shapes.mjs';

// The prototype exporter, run as a child process the way the skill runs it:
// `frames.mjs export --version-dir=<abs>` reads the version's prototype.html,
// evaluates its scenes script without a DOM and writes `.frames.json`. Each
// test works in its own scratch version folder under the OS temp directory;
// the only import from inside the skill is the shapes module.

const FRAMES = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/frames.mjs');
const FIXTURE_DIR = path.join(FIXTURES, 'mockup-studio');

// Well inside the helper's own kill deadline: a refused hang must come back in
// about the 2 s evaluation timeout, not be killed from outside.
const PROMPT_MS = 15_000;

/** A scratch version folder, its name holding a space; removed when the test ends. */
function versionDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister mockup-frames-'));
  const dir = path.join(root, 'v001');
  t.after(() => {
    if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(dir);
  return dir;
}

/** Run export over `dir`, the JSON on stdout parsed when there is one, the time it took. */
function exportFrames(dir) {
  const started = Date.now();
  const result = run(FRAMES, ['export', `--version-dir=${dir}`]);
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // no JSON: a usage or tooling error, asserted by the test
  }
  return { ...result, json, ms: Date.now() - started };
}

/** A version folder holding the named fixture as its prototype.html. */
function withFixture(t, name) {
  const dir = versionDir(t);
  fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(dir, 'prototype.html'));
  return dir;
}

/** A version folder holding a page whose mockup-scenes script is `body`. */
function withScenes(t, body, attributes = 'id="mockup-scenes"') {
  const dir = versionDir(t);
  fs.writeFileSync(path.join(dir, 'prototype.html'),
    `<!doctype html>\n<html><head><style>p { color: red; }</style></head><body>\n<script ${attributes}>\n${body}\n</script>\n</body></html>\n`);
  return dir;
}

function assertRefused(result, code, dir) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.json?.ok, false, result.stdout);
  assert.equal(result.json.code, code, result.stdout);
  assert.ok(result.json.message.length > 40, result.json.message);
  if (dir) assert.deepEqual(fs.readdirSync(dir).sort(), fs.existsSync(path.join(dir, 'prototype.html')) ? ['prototype.html'] : []);
}

test('the prototype fixture exports two scenes with the page CSS, `$&` intact, in the frames shape', t => {
  const source = fs.readFileSync(path.join(FIXTURE_DIR, 'prototype.html'), 'utf8');
  assert.match(source, /<script id="mockup-scenes">\s*const scenes = /, 'the scenes script declares scenes with const');

  const dir = withFixture(t, 'prototype.html');
  const result = exportFrames(dir);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(result.json, { ok: true, scenes: 2, frames: '.frames.json' });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.frames.json', 'prototype.html'], 'no temp file is left');

  const frames = JSON.parse(fs.readFileSync(path.join(dir, '.frames.json'), 'utf8'));
  assert.deepEqual(departures(frames, { type: 'object', required: true, keys: FRAMES_FILE }, 'frames'), []);
  assert.deepEqual(frames.screens.map(screen => [screen.slug, screen.title]), [['order-summary', 'Order summary'], ['empty-cart', 'Empty cart']]);

  const [summary, empty] = frames.screens;
  assert.ok(summary.css.indexOf('.summary { padding') < summary.css.indexOf('.total { font-weight'), 'style elements in document order');
  assert.equal(empty.css, summary.css, 'one shared CSS for every scene');
  assert.ok(summary.html.includes('Code $& applied'), summary.html);
  assert.ok(summary.html.includes('<p class="total">Total</p>'));
  assert.equal(empty.html, '<section class="summary"><p class="empty">Your cart is empty.</p></section>');
  assert.deepEqual(summary.annotations, [{ selector: '.total', note: 'Reuses the existing price formatter' }]);
  assert.deepEqual(summary.behaviour, ['Removing the last item shows the empty state']);
  assert.deepEqual([empty.annotations, empty.behaviour], [[], []]);
});

test('a render that touches the DOM is refused render-touches-dom and nothing is written', t => {
  const dir = withFixture(t, 'prototype-dom.html');
  const result = exportFrames(dir);
  assertRefused(result, 'render-touches-dom', dir);
  assert.match(result.json.message, /document/);
  assert.match(result.json.message, /card/);
});

test('a render that never returns is refused render-timeout, promptly', t => {
  const dir = withFixture(t, 'prototype-loop.html');
  const result = exportFrames(dir);
  assertRefused(result, 'render-timeout', dir);
  assert.ok(result.ms < PROMPT_MS, `took ${result.ms} ms`);
});

test('an async render that loops after an await is refused and the process exits promptly', { timeout: 30_000 }, t => {
  const dir = withFixture(t, 'prototype-async.html');
  const result = exportFrames(dir);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(['render-timeout', 'render-not-string'].includes(result.json?.code), result.stdout);
  assert.ok(result.ms < PROMPT_MS, `took ${result.ms} ms`);
  assert.deepEqual(fs.readdirSync(dir), ['prototype.html']);
});

test('a value the page made is never read outside the timeout: a looping Proxy or getter is refused, not hung', { timeout: 30_000 }, async t => {
  const scene = "const scenes = [{ id: 'home', title: 'Home', state: {} }];\n";
  const cases = {
    'a render returning a Proxy whose every read loops': "function render() { return new Proxy({}, { get() { for (;;) {} } }); }",
    'a render returning an object whose then getter loops': "function render() { return { get then() { for (;;) {} } }; }",
    'a render throwing an object whose name and message getters loop':
      "function render() { throw { get name() { for (;;) {} }, get message() { for (;;) {} } }; }",
    'a render throwing a Proxy whose every read loops': "function render() { throw new Proxy({}, { get() { for (;;) {} } }); }",
    'a top-level throw of a Proxy whose every read loops': "throw new Proxy({}, { get() { for (;;) {} } });",
  };
  for (const [what, body] of Object.entries(cases)) {
    await t.test(what, tt => {
      const dir = withScenes(tt, `${scene}${body}`);
      const result = exportFrames(dir);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.ok(['render-timeout', 'render-threw', 'render-not-string'].includes(result.json?.code), result.stdout);
      assert.ok(result.ms < PROMPT_MS, `took ${result.ms} ms`);
      assert.deepEqual(fs.readdirSync(dir), ['prototype.html']);
    });
  }
  await t.test('a thrown value whose getters throw a looping Proxy is still described', tt => {
    const dir = withScenes(tt, `${scene}function render() { throw { get name() { throw new Proxy({}, { get() { for (;;) {} } }); } }; }`);
    const result = exportFrames(dir);
    assertRefused(result, 'render-threw', dir);
    assert.match(result.json.message, /could not be read/);
    assert.ok(result.ms < PROMPT_MS, `took ${result.ms} ms`);
  });
});

test('a result that is not a string, a throw and invalid scenes are refused by name', async t => {
  await t.test('a number is render-not-string', tt => {
    const dir = withScenes(tt, "const scenes = [{ id: 'home', title: 'Home', state: {} }];\nfunction render() { return 42; }");
    assertRefused(exportFrames(dir), 'render-not-string', dir);
  });
  await t.test('a Promise, even of a string, is render-not-string', tt => {
    const dir = withScenes(tt, "const scenes = [{ id: 'home', title: 'Home', state: {} }];\nasync function render() { return '<p>home</p>'; }");
    assertRefused(exportFrames(dir), 'render-not-string', dir);
  });
  await t.test('any other throw is render-threw', tt => {
    const dir = withScenes(tt, "const scenes = [{ id: 'home', title: 'Home', state: {} }];\nconst render = state => state.missing.field;");
    assertRefused(exportFrames(dir), 'render-threw', dir);
  });
  const invalid = {
    'an empty list': 'const scenes = [];',
    'a bad slug': "const scenes = [{ id: 'Home Page', title: 'Home', state: {} }];",
    'a duplicate id': "const scenes = [{ id: 'home', title: 'Home', state: {} }, { id: 'home', title: 'Again', state: {} }];",
    'no scenes at all': 'const other = 1;',
    'the reserved id index': "const scenes = [{ id: 'index', title: 'Gallery', state: {} }];",
    'the reserved id prototype': "const scenes = [{ id: 'home', title: 'Home', state: {} }, { id: 'prototype', title: 'Working page', state: {} }];",
  };
  for (const [what, declaration] of Object.entries(invalid)) {
    await t.test(`${what} is scenes-invalid`, tt => {
      const dir = withScenes(tt, `${declaration}\nfunction render() { return '<p></p>'; }`);
      const result = exportFrames(dir);
      assertRefused(result, 'scenes-invalid', dir);
      if (what.startsWith('the reserved id')) {
        assert.match(result.json.message, /is reserved/);
        assert.match(result.json.message, /mockup-scenes script/, 'the message names the scenes script as the place to fix it');
      }
    });
  }
});

test('a page with no single classic scenes script, or no page, is refused; a usage error exits 2', async t => {
  await t.test('no scenes script is script-missing', tt => {
    const dir = withScenes(tt, 'const scenes = [];', 'id="other"');
    assertRefused(exportFrames(dir), 'script-missing', dir);
  });
  await t.test('a module scenes script is script-missing', tt => {
    const dir = withFixture(tt, 'prototype-module.html');
    const result = exportFrames(dir);
    assertRefused(result, 'script-missing', dir);
    assert.match(result.json.message, /module/);
  });
  await t.test('two scenes scripts are script-missing', tt => {
    const dir = versionDir(tt);
    const one = "<script id=\"mockup-scenes\">const scenes = [{ id: 'a', title: 'A', state: {} }]; function render() { return ''; }</script>";
    fs.writeFileSync(path.join(dir, 'prototype.html'), `<html><body>${one}${one}</body></html>`);
    assertRefused(exportFrames(dir), 'script-missing', dir);
  });
  await t.test('a commented-out scenes script is not counted', tt => {
    const dir = versionDir(tt);
    fs.writeFileSync(path.join(dir, 'prototype.html'), '<html><body><!-- <script id="mockup-scenes">const scenes = [];</script> --></body></html>');
    assertRefused(exportFrames(dir), 'script-missing', dir);
  });
  await t.test('no prototype.html is prototype-missing', tt => {
    const dir = versionDir(tt);
    assertRefused(exportFrames(dir), 'prototype-missing', dir);
  });
  await t.test('a folder it cannot write is folder-unwritable', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, tt => {
    const dir = withFixture(tt, 'prototype.html');
    fs.chmodSync(dir, 0o555);
    const refused = exportFrames(dir);
    assertRefused(refused, 'folder-unwritable', dir);
    assert.match(refused.json.message, /Make the version folder writable and run export again\.$/);
    assert.doesNotMatch(refused.json.message, /^[a-z-]+: /, 'the code is not repeated in the message');
  });
  await t.test('a relative or missing --version-dir is a usage error', () => {
    for (const args of [['export'], ['export', '--version-dir=relative/v001'], ['other']]) {
      const result = run(FRAMES, args);
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /frames: /);
    }
  });
});

test("a scene's console output never reaches stdout", t => {
  const dir = withScenes(t, [
    "console.log('LEAK at load');",
    "const scenes = [{ id: 'home', title: 'Home', state: {} }];",
    "function render() { console.log('LEAK in render'); console.error('LEAK on stderr'); console.table([1]); return '<p>home</p>'; }",
  ].join('\n'));
  const result = exportFrames(dir);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /LEAK/);
  assert.doesNotMatch(result.stderr, /LEAK/);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, scenes: 1, frames: '.frames.json' });
});
