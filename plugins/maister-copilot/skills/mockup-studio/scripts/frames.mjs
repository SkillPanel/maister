/**
 * The mockup studio's prototype exporter: still screens from a working page.
 *
 *   node <path to this file> export --version-dir=<abs path to versions/vNNN>
 *
 * Exec form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 *
 * A prototype turn writes `versions/<vNNN>/prototype.html`: one page whose
 * classic `<script id="mockup-scenes">` declares `scenes` — a list of
 * `{id, title, state, annotations?, behaviour?}`, `id` being the screen slug —
 * and a pure `render(state)` that returns markup. `export` takes that script
 * and the page's `<style>` elements, in document order, as the CSS every
 * screen shares, renders each scene's state and writes
 * `versions/<vNNN>/.frames.json` (the `FRAMES_FILE` shape in
 * `lib/shapes.mjs`): `{screens: [{slug, title, html, css, annotations,
 * behaviour}]}`, one entry per scene, which `turn.mjs finish` reads as the
 * version's screens. The page's other scripts never run.
 *
 * Evaluation has no DOM. The script runs in a fresh `node:vm` context over a
 * null-prototype object, created with microtasks run after each evaluation, so
 * an async `render` that loops after an `await` is stopped by the timeout
 * rather than hanging this process. The context holds the language's own
 * builtins and a no-op `console` defined inside it, so a stray log never
 * reaches stdout; there is no `document`, `window`, `fetch`, timer, `require`
 * or `process`. The script runs with a 2 s timeout, and each
 * `render(scene.state)` is called by a second script in the same context with
 * the same timeout, so top-level `const`, `let` and `function` declarations
 * are all visible to it. A result that is not a string — a Promise included —
 * is refused.
 *
 * Output: `{ok: true, scenes: <n>, frames: ".frames.json"}` on stdout.
 *
 * Exit codes: 0 success, the JSON result on stdout; 1 refusal,
 * `{ok: false, code, message}` on stdout and nothing written; 2 usage or an
 * unexpected error, a message on stderr.
 *
 * Refusals owned, and what the skill maps each to:
 *   prototype-missing   no prototype.html file in the version folder
 *   script-missing      not exactly one classic `<script id="mockup-scenes">`
 *                       with inline code (none, two, a module, a `src`)
 *   scenes-invalid      `scenes` is not a non-empty list, a scene is not a map
 *                       with a valid slug id and a title, two ids are equal, or
 *                       annotations or behaviour are not lists
 *   render-touches-dom  a ReferenceError naming a DOM global (`document`,
 *                       `window`, `navigator`, `location`, `localStorage`,
 *                       `sessionStorage`, `fetch`, `XMLHttpRequest`,
 *                       `requestAnimationFrame`, `setTimeout`, `setInterval`,
 *                       `HTMLElement`, `Element`, `customElements`)
 *   render-timeout      the script or a render ran past the timeout
 *   render-not-string   a render returned something other than a string
 *   render-threw        any other throw
 *   folder-unwritable   `.frames.json` could not be written (the write
 *                       primitives' `mockup-unwritable` and
 *                       `mockup-temp-exists` are reported under it)
 * The skill maps `render-touches-dom` to the degraded reason of the same name
 * and every other refusal to `render-failed`; either way the turn falls back
 * to sketch screens drawn from the same scenes, keeps prototype.html and
 * records sketch fidelity. These scripts return codes only, never command
 * text.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { Refusal, commit } from '../../../lib/canonical.mjs';
import { FRAMES_FILE, SLUG_PATTERN, departures } from './lib/shapes.mjs';

const EXIT = { OK: 0, REFUSED: 1, INTERNAL: 2 };
const TIMEOUT_MS = 2000;
const FRAMES_NAME = '.frames.json';
const WRITE_CODES = { unwritable: 'mockup-unwritable', tempExists: 'mockup-temp-exists' };
const FOLDED = new Set(Object.values(WRITE_CODES));
const SLUG = new RegExp(SLUG_PATTERN);
const DOM_GLOBALS = [
  'document', 'window', 'navigator', 'location', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'requestAnimationFrame', 'setTimeout', 'setInterval', 'HTMLElement', 'Element', 'customElements',
];
const CLASSIC_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript']);
const AFTERWARDS = 'Nothing was written; the turn falls back to sketch screens drawn from the same scenes.';

class UsageError extends Error {}

function parseArgs(argv) {
  const [verb, ...rest] = argv;
  if (verb !== 'export') throw new UsageError(verb === undefined ? 'no verb given' : `unknown verb "${verb}"`);
  const flags = {};
  for (const arg of rest) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg);
    if (!match) throw new UsageError(`unexpected argument "${arg}"; flags are written --name=value`);
    const [, name, value] = match;
    if (name !== 'version-dir') throw new UsageError(`unknown flag --${name} for export`);
    if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
    if (value === '') throw new UsageError(`the flag --${name} needs a value`);
    flags[name] = value;
  }
  if (flags['version-dir'] === undefined) throw new UsageError('export needs --version-dir');
  if (!path.isAbsolute(flags['version-dir'])) {
    throw new UsageError(`--version-dir must be an absolute path, and was ${flags['version-dir']}`);
  }
  return flags;
}

// ---------------------------------------------------------------- the page

/** The attributes of one start tag, names lower-cased; a bare attribute is the empty string. */
function attributes(text) {
  const found = {};
  for (const [, name, double, single, bare] of text.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    found[name.toLowerCase()] ??= double ?? single ?? bare ?? '';
  }
  return found;
}

/**
 * The page's scripts and styles in document order, comments skipped. A
 * script's content is consumed whole, so markup inside a script string is
 * never read as an element.
 */
function elements(html) {
  const found = [];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    if (match[1] === undefined) continue;
    found.push({ tag: match[1].toLowerCase(), attrs: attributes(match[2]), content: match[3] });
  }
  return found;
}

function readPage(versionDir) {
  const file = path.join(versionDir, 'prototype.html');
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    throw new Refusal('prototype-missing',
      `${file} ${stat ? 'is not a regular file' : 'does not exist'}. ${AFTERWARDS} To export a prototype, write the page there and run export again.`);
  }
  return { file, html: fs.readFileSync(file, 'utf8') };
}

function scenesScript(page) {
  const found = elements(page.html);
  const candidates = found.filter(each => each.tag === 'script' && each.attrs.id === 'mockup-scenes');
  const fix = 'The page needs exactly one classic <script id="mockup-scenes"> with its code inline.';
  if (candidates.length !== 1) {
    throw new Refusal('script-missing',
      `${page.file} has ${candidates.length === 0 ? 'no' : candidates.length} <script id="mockup-scenes"> element${candidates.length === 1 ? '' : 's'}. ${AFTERWARDS} ${fix}`);
  }
  const [script] = candidates;
  const type = (script.attrs.type ?? '').trim().toLowerCase();
  if (!CLASSIC_TYPES.has(type)) {
    throw new Refusal('script-missing',
      `${page.file}'s mockup-scenes script has type="${type}", ${type === 'module' ? 'a module' : 'not a classic script'}, which cannot be evaluated as one. ${AFTERWARDS} ${fix}`);
  }
  if (Object.hasOwn(script.attrs, 'src')) {
    throw new Refusal('script-missing', `${page.file}'s mockup-scenes script loads its code from src="${script.attrs.src}". ${AFTERWARDS} ${fix}`);
  }
  const css = found.filter(each => each.tag === 'style').map(each => each.content).join('\n');
  return { code: script.content, css };
}

// ---------------------------------------------------------------- evaluation

const NO_OP_CONSOLE = `globalThis.console = Object.freeze(Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'dirxml', 'table', 'group', 'groupCollapsed', 'groupEnd',
   'time', 'timeEnd', 'timeLog', 'assert', 'count', 'countReset', 'clear'].map(name => [name, () => {}])));`;

/** What a throw out of the context means. The error comes from the context's realm, so `name` is read, never `instanceof`. */
function thrown(err, where) {
  if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
    return new Refusal('render-timeout',
      `${where} ran past the ${TIMEOUT_MS / 1000} s limit, as a loop that never ends or an async render that keeps running after an await would. ${AFTERWARDS} Make render return its markup synchronously.`);
  }
  let name;
  let message;
  try {
    name = String(err?.name);
    message = String(err?.message ?? err);
  } catch {
    name = 'unknown';
    message = 'an error that could not be read';
  }
  const global = name === 'ReferenceError' ? /^(\S+) is not defined/.exec(message)?.[1] : undefined;
  if (global !== undefined && DOM_GLOBALS.includes(global)) {
    return new Refusal('render-touches-dom',
      `${where} reads ${global}, a browser global that does not exist outside the page. ${AFTERWARDS} Keep render pure: build markup from state alone, and leave DOM work to the page's own runtime script.`);
  }
  return new Refusal('render-threw', `${where} threw ${name}: ${message}. ${AFTERWARDS} Fix the scenes script so every scene renders.`);
}

function evaluate(context, code, where) {
  try {
    return vm.runInContext(code, context, { timeout: TIMEOUT_MS, filename: 'mockup-scenes' });
  } catch (err) {
    throw thrown(err, where);
  }
}

/**
 * The scenes' plain data, read inside the context and handed out as JSON, so
 * nothing the script defines runs in this process outside the timeout.
 */
const SCENES_JSON = `typeof scenes === 'undefined' ? 'undefined' : JSON.stringify(Array.isArray(scenes)
  ? scenes.map(scene => scene !== null && typeof scene === 'object'
    ? { id: scene.id, title: scene.title, annotations: scene.annotations, behaviour: scene.behaviour } : null)
  : null)`;

function readScenes(context, file) {
  const invalid = what => new Refusal('scenes-invalid', `${file}'s mockup-scenes script ${what}. ${AFTERWARDS} Declare scenes as a non-empty list of {id, title, state, annotations?, behaviour?} with a distinct slug id each.`);
  let text;
  try {
    text = vm.runInContext(SCENES_JSON, context, { timeout: TIMEOUT_MS });
  } catch (err) {
    if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw thrown(err, 'reading scenes');
    throw invalid('declares scenes that cannot be read as plain data');
  }
  if (text === 'undefined') throw invalid('declares no scenes');
  const scenes = typeof text === 'string' ? JSON.parse(text) : null;
  if (!Array.isArray(scenes) || scenes.length === 0) throw invalid('declares scenes that are not a non-empty list');
  const seen = new Set();
  scenes.forEach((scene, at) => {
    if (scene === null) throw invalid(`has scene ${at + 1}, which is not a map`);
    if (typeof scene.id !== 'string' || !SLUG.test(scene.id)) {
      throw invalid(`has scene ${at + 1} with id ${JSON.stringify(scene.id ?? null)}, which is not a slug (lower-case letters and digits joined by single hyphens)`);
    }
    if (seen.has(scene.id)) throw invalid(`has two scenes with id "${scene.id}"`);
    seen.add(scene.id);
    if (typeof scene.title !== 'string' || scene.title.trim() === '') throw invalid(`has scene "${scene.id}" with no title`);
    if (scene.annotations !== undefined && !Array.isArray(scene.annotations)) throw invalid(`has scene "${scene.id}" whose annotations are not a list`);
    if (scene.behaviour !== undefined && !(Array.isArray(scene.behaviour) && scene.behaviour.every(line => typeof line === 'string'))) {
      throw invalid(`has scene "${scene.id}" whose behaviour is not a list of lines`);
    }
  });
  return scenes;
}

function frames(page, script) {
  const context = vm.createContext(Object.create(null), { microtaskMode: 'afterEvaluate' });
  vm.runInContext(NO_OP_CONSOLE, context);
  evaluate(context, script.code, 'The mockup-scenes script');
  const scenes = readScenes(context, page.file);
  const hasRender = vm.runInContext("typeof render === 'function'", context, { timeout: TIMEOUT_MS });
  if (hasRender !== true) {
    throw new Refusal('render-threw', `${page.file}'s mockup-scenes script defines no render function. ${AFTERWARDS} Declare a pure render(state) that returns markup.`);
  }
  return scenes.map((scene, at) => {
    const where = `render for scene "${scene.id}"`;
    const html = evaluate(context, `render(scenes[${at}].state)`, where);
    if (typeof html !== 'string') {
      const what = html !== null && typeof html === 'object' && typeof html.then === 'function' ? 'a Promise' : html === null ? 'null' : `a ${typeof html}`;
      throw new Refusal('render-not-string', `${where} returned ${what}, not a string of markup. ${AFTERWARDS} Make render return its markup synchronously, as a string.`);
    }
    return { slug: scene.id, title: scene.title, html, css: script.css, annotations: scene.annotations ?? [], behaviour: scene.behaviour ?? [] };
  });
}

function exportFrames(flags) {
  const versionDir = flags['version-dir'];
  const page = readPage(versionDir);
  const script = scenesScript(page);
  const document = { screens: frames(page, script) };
  const found = departures(document, { type: 'object', keys: FRAMES_FILE }, FRAMES_NAME);
  if (found.length) throw new Error(`the frames this export built do not have the declared shape: ${found.join('; ')}`);
  const target = path.join(versionDir, FRAMES_NAME);
  commit({ target, text: `${JSON.stringify(document, null, 2)}\n`, tmp: path.join(versionDir, `.${FRAMES_NAME}.tmp`), codes: WRITE_CODES });
  return { ok: true, scenes: document.screens.length, frames: FRAMES_NAME };
}

// ---------------------------------------------------------------- main

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`frames: ${error.message}\nusage: node frames.mjs export --version-dir=<abs path to versions/vNNN>\n`);
    return EXIT.INTERNAL;
  }
  try {
    process.stdout.write(`${JSON.stringify(exportFrames(flags), null, 2)}\n`);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof Refusal) {
      const folded = FOLDED.has(error.code);
      const message = error.message.replace(/^[a-z-]+: /, '');
      process.stdout.write(`${JSON.stringify({
        ok: false,
        code: folded ? 'folder-unwritable' : error.code,
        message: folded ? `${message}. ${AFTERWARDS} Make the version folder writable and run export again.` : message,
      }, null, 2)}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`frames: ${error.stack ?? error.message}\n`);
    return EXIT.INTERNAL;
  }
}

process.exitCode = main();
