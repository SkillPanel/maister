/**
 * Two enabled editions of this plugin, detected from the settings scopes.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Shared by the
 * session-start hook, which warns, and the workflow engine, which refuses to
 * start or resume a run — so it sits at the plugin root rather than inside
 * either caller.
 *
 * Why it exists. The free and pro editions share one plugin name. When both
 * are enabled Claude Code resolves skills per skill directory, not per plugin,
 * so a single session can draw skill bodies from both editions and a workflow
 * then fails on a file only the other edition ships. Hook registration keeps
 * one edition's hooks, so this check lives in the source both editions share
 * and runs whichever of them wins.
 *
 * Where the answer comes from. `enabledPlugins` in the documented settings
 * sources, merged by precedence — user, then project, then local, then the
 * session's `--settings`, then managed, the later scope winning key by key, so
 * a `false` above overrides a `true` below. File reads only: no subprocess, no
 * `claude` on PATH, nothing a hook on Windows without a shell could miss.
 *
 * The session layer. Claude Code hands neither a hook nor a child process the
 * value a session was started with through `--settings`, so whoever starts the
 * session names it a second time in the environment: `MAISTER_SESSION_SETTINGS`
 * holds what `--settings` was given — an absolute path to a settings file, or
 * the inline JSON itself (a value whose first non-blank character is `{`).
 * Without the variable a session that disables an edition only through
 * `--settings` is still reported as a collision.
 *
 * When a collision is real. At least two distinct `<name>@<marketplace>` ids
 * are enabled, and the copy running this code is one of them. A copy loaded
 * with `--plugin-dir` registers as `<name>@inline`, skips every installed
 * plugin of the same name and never appears in `enabledPlugins`; its own
 * marketplace is then either unknown or not an enabled one, so it is not a
 * collision whatever the settings say.
 *
 * It fails open. A settings file that is absent counts as empty; one that
 * cannot be read or parsed, or anything else that goes wrong, answers "no
 * collision". A detection failure never warns and never refuses a run. The
 * session layer alone is softer still: a value that cannot be read, parsed or
 * understood counts as no information from that layer, and the files decide.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The plugin name both editions carry. The Copilot variant renames itself in
 * its manifest and has a plugin system of its own, so there the check is a
 * no-op by construction.
 */
const SHARED_NAME = 'maister';

/** How many directories above the plugin root a marketplace manifest may sit. */
const MANIFEST_DEPTH = 3;

/** The settings label a scope is reported under, and the `--scope` it is disabled with. */
const SCOPE_LABEL = { user: 'user settings', project: 'project settings', local: 'local settings', session: 'session settings', managed: 'managed settings' };

/** The variable naming what the session's `--settings` was given. */
const SESSION_VARIABLE = 'MAISTER_SESSION_SETTINGS';

/**
 * The collision this session is in, or null.
 *
 * Returns `{ name, editions: [{ id, scope }], message }`. `projectDir` is the
 * directory the session started in; without one only the user, session and
 * managed scopes are read. `env` supplies the config directory and the session
 * layer. `managedFiles` defaults to this platform's managed settings
 * and is a parameter so a test can supply its own. Never throws.
 */
export function findEditionCollision({ pluginRoot, projectDir = null, env = process.env, managedFiles } = {}) {
  try {
    return detect({ pluginRoot, projectDir, env, managedFiles: managedFiles ?? managedSettingsFiles() });
  } catch {
    return null;
  }
}

function detect({ pluginRoot, projectDir, env, managedFiles }) {
  const name = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'))?.name;
  if (name !== SHARED_NAME) return null;
  const own = ownMarketplace(pluginRoot, name);
  if (own === null) return null;

  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const layers = [['user', enabledPluginsOf(path.join(configDir, 'settings.json'))]];
  if (projectDir) {
    layers.push(['project', enabledPluginsOf(path.join(projectDir, '.claude', 'settings.json'))]);
    layers.push(['local', enabledPluginsOf(path.join(projectDir, '.claude', 'settings.local.json'))]);
  }
  layers.push(['session', sessionEnabledPlugins(env[SESSION_VARIABLE])]);
  for (const file of managedFiles) layers.push(['managed', enabledPluginsOf(file)]);

  const enabled = new Map();
  for (const [scope, plugins] of layers) {
    for (const [id, value] of Object.entries(plugins)) {
      if (typeof value === 'boolean') enabled.set(id, { value, scope });
    }
  }

  const editions = [];
  for (const [id, { value, scope }] of enabled) {
    const at = id.lastIndexOf('@');
    if (!value || at <= 0 || id.slice(0, at) !== name) continue;
    const marketplace = id.slice(at + 1);
    if (marketplace === '' || marketplace === 'inline') continue;
    editions.push({ id, scope, marketplace });
  }
  if (editions.length < 2 || !editions.some(edition => edition.marketplace === own)) return null;
  return {
    name,
    editions: editions.map(({ id, scope }) => ({ id, scope })),
    message: messageFor(name, editions, Boolean(env[SESSION_VARIABLE])),
  };
}

/**
 * The marketplace the running copy was installed from, or null.
 *
 * A copy from a git or remote marketplace runs from the plugin cache,
 * `…/plugins/cache/<marketplace>/<name>/<version>`, so the path names it. A
 * copy from a directory marketplace runs in place, so the marketplace manifest
 * above it names it — provided that manifest lists this plugin with a source
 * resolving to this very directory. Anything else is an inline or unfamiliar
 * copy, and an unknown marketplace is never a collision.
 */
function ownMarketplace(pluginRoot, name) {
  const root = fs.realpathSync(pluginRoot);
  const parts = root.split(path.sep);
  const n = parts.length;
  if (n >= 5 && parts[n - 5] === 'plugins' && parts[n - 4] === 'cache' && parts[n - 2] === name) {
    return parts[n - 3];
  }
  let dir = path.dirname(root);
  for (let depth = 0; depth < MANIFEST_DEPTH; depth++) {
    const manifest = safeReadJson(path.join(dir, '.claude-plugin', 'marketplace.json'));
    if (manifest && typeof manifest.name === 'string' && Array.isArray(manifest.plugins)) {
      const base = typeof manifest.metadata?.pluginRoot === 'string' ? manifest.metadata.pluginRoot : '.';
      for (const plugin of manifest.plugins) {
        if (plugin?.name !== name || typeof plugin.source !== 'string') continue;
        for (const candidate of [path.resolve(dir, plugin.source), path.resolve(dir, base, plugin.source)]) {
          if (sameDir(candidate, root)) return manifest.name;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** This platform's managed settings: the base file, then its drop-ins in name order. */
function managedSettingsFiles() {
  const dir = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode'
    : process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode'
      : '/etc/claude-code';
  const files = [path.join(dir, 'managed-settings.json')];
  const dropins = path.join(dir, 'managed-settings.d');
  let names = [];
  try {
    names = fs.readdirSync(dropins);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
  }
  for (const entry of names.filter(entry => entry.endsWith('.json')).sort()) files.push(path.join(dropins, entry));
  return files;
}

/**
 * One settings file's `enabledPlugins`. Absent is empty; unreadable, not JSON,
 * or the wrong shape throws, which the caller turns into "no collision".
 */
function enabledPluginsOf(file) {
  const doc = readJson(file);
  return doc === null ? {} : pluginsOfSettings(doc, file);
}

/**
 * The session layer's `enabledPlugins`: from the inline JSON or the file the
 * variable names, the way `--settings` takes either. Unset, empty, unreadable,
 * not JSON or the wrong shape is empty — no information from this layer.
 */
function sessionEnabledPlugins(value) {
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    if (value.trimStart().startsWith('{')) return pluginsOfSettings(JSON.parse(value), SESSION_VARIABLE);
    return enabledPluginsOf(value);
  } catch {
    return {};
  }
}

/** A parsed settings document's `enabledPlugins`; the wrong shape throws. */
function pluginsOfSettings(doc, label) {
  if (!isPlainObject(doc)) throw new Error(`${label} is not a settings object`);
  if (doc.enabledPlugins === undefined) return {};
  if (!isPlainObject(doc.enabledPlugins)) throw new Error(`${label} has an enabledPlugins that is not an object`);
  return doc.enabledPlugins;
}

/** Parsed JSON, or null when the file does not exist. Every other failure throws. */
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(text);
}

/** Parsed JSON, or null on any failure — for manifests that merely might be ours. */
function safeReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function sameDir(a, b) {
  try {
    return fs.realpathSync(a) === b;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * What the operator reads: every enabled edition with the scope that enabled
 * it, why that breaks, and the fix. A managed-scope or session-scope edition has
 * no command an operator can run, so it is named without one. When the session
 * layer was not supplied, the message says how a session started with
 * `--settings` makes it visible, since that may be all that is wrong.
 */
function messageFor(name, editions, sessionSupplied) {
  const listed = editions.map(({ id, scope }) => `${id} (${SCOPE_LABEL[scope]})`);
  const commands = editions
    .filter(({ scope }) => scope !== 'managed' && scope !== 'session')
    .map(({ id, scope }) => `\`claude plugin disable ${id} --scope ${scope}\``);
  const fixes = [];
  if (commands.length) fixes.push(`Keep one enabled and disable the others, then restart Claude Code: ${commands.join(' or ')}.`);
  if (editions.some(({ scope }) => scope === 'session')) {
    fixes.push(`An edition enabled by session settings is changed in the settings the session was started with (\`--settings\`, named again in ${SESSION_VARIABLE}).`);
  }
  if (editions.every(({ scope }) => scope === 'managed')) {
    fixes.push('All of them are set by managed settings; ask the administrator who manages them to keep only one enabled.');
  } else if (editions.some(({ scope }) => scope === 'managed')) {
    fixes.push('An edition set by managed settings is changed only by the administrator who manages them.');
  }
  if (!sessionSupplied) {
    fixes.push(`If this session was started with \`--settings\` that disables an edition, set ${SESSION_VARIABLE} to the same file path or JSON when starting it, so this check reads that layer too.`);
  }
  const count = ['Two', 'Three', 'Four'][editions.length - 2] ?? String(editions.length);
  return `${count} editions of the ${name} plugin are enabled: ${listed.join(', ')}. `
    + 'Claude Code then loads each skill from either edition, so a workflow can fail on a file only the other edition ships. '
    + fixes.join(' ');
}
