/**
 * The workflow engine's single entry point.
 *
 * Invoked in the exec form — `node <path to this file> <verb> [flags]` — with
 * no shebang and no reliance on an executable bit, so it behaves the same on a
 * Windows checkout with no POSIX shell as it does anywhere else. Zero
 * dependencies, `node:` builtins only, Node >= 20.
 *
 * Four verbs, one contract:
 *
 *   validate     --definition and/or repeatable --overlay   JSON on stdout
 *   resolve      --definition, --overlay…, --profile        JSON on stdout
 *   diagram      the same, plus optional --out              Mermaid text
 *   write-state  --state, the patch as JSON on stdin        changed paths
 *
 * and one exit-code table: 0 success, 1 the input was rejected (the JSON report
 * is still printed, so a caller always has the reasons), 2 the tooling itself
 * failed. The separation is what lets a caller distinguish "your definition is
 * wrong" from "the engine is broken" without parsing prose.
 *
 * Why the patch arrives on stdin rather than as an argument: no quoting has to
 * survive a shell, which is the same Windows-without-a-shell constraint that
 * shapes the invocation form.
 *
 * This file owns argument parsing, the exit-code table and the unknown-version
 * degradation. Everything else lives in `lib/`, one module per concern, loaded
 * only when the verb that needs it is asked for. A module that is not present
 * is reported on stderr at exit 2 — never treated as a quiet success, because a
 * verb that appears to work while writing nothing is the exact failure mode the
 * engine exists to remove.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_VERSION, readDefinition } from './lib/definition.mjs';

/** The exit-code table, named so no call site writes a bare integer. */
const EXIT = { OK: 0, REJECTED: 1, INTERNAL: 2 };

/** Every verb, with the module that implements it and the flags it accepts. */
const VERBS = {
  validate: { module: 'graph.mjs', flags: ['definition', 'overlay', 'profile'] },
  resolve: { module: 'graph.mjs', flags: ['definition', 'overlay', 'profile'] },
  diagram: { module: 'diagram.mjs', flags: ['definition', 'overlay', 'profile', 'out'] },
  'write-state': { module: 'state.mjs', flags: ['state'] },
};

/** The flags that may be given more than once; every other flag is single-valued. */
const REPEATABLE = new Set(['overlay']);

/**
 * The warning recorded for a definition that declares a format this build does
 * not know. It is a warning and not an error on purpose: a newer document must
 * render what is recognised and exit 0, so an older engine in a mixed fleet
 * degrades instead of blocking the operator.
 */
const NEWER_FORMAT = 'newer-format';

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

/**
 * Both `--flag=value` and `--flag value` are accepted. The equals form is what
 * the documented invocation uses; the space form costs four lines and spares a
 * caller one more quoting rule to get wrong.
 *
 * Membership is asked with `Object.hasOwn` rather than `in`, here and at the
 * verb table: `in` walks the prototype chain, so `constructor` would answer as a
 * known verb and `--toString` as a known flag — and the invocation would fail
 * with a type error instead of the usage message it was owed.
 */
function parseArgs(argv) {
  let verb = null;
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (verb !== null) throw new UsageError(`unexpected argument "${arg}"`);
      verb = arg;
      continue;
    }
    const at = arg.indexOf('=');
    const name = at < 0 ? arg.slice(2) : arg.slice(2, at);
    let value = at < 0 ? undefined : arg.slice(at + 1);
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`the flag --${name} needs a value`);
      }
      i++;
    }
    if (REPEATABLE.has(name)) (flags[name] ||= []).push(value);
    else if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
    else flags[name] = value;
  }
  return { verb, flags };
}

/** An invocation this entry point cannot act on. Always exit 2: nothing ran. */
class UsageError extends Error {}

function checkFlags(verb, flags) {
  const allowed = new Set(VERBS[verb].flags);
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name)) throw new UsageError(`the verb ${verb} takes no --${name} flag`);
  }
}

// ---------------------------------------------------------------------------
// reading the inputs
// ---------------------------------------------------------------------------

/**
 * Read the definition and every overlay, keeping each rejection in the located
 * `{file, node, path, message}` shape. Reading is shared by three verbs so that
 * a malformed file is reported identically whichever one was asked for.
 */
function readSources(flags) {
  const errors = [];
  let definition = null;
  if (flags.definition) {
    definition = readDefinition(flags.definition);
    errors.push(...definition.errors);
  }
  const overlays = [];
  for (const file of flags.overlay || []) {
    const overlay = readDefinition(file);
    errors.push(...overlay.errors);
    overlays.push(overlay);
  }
  return { definition, overlays, errors };
}

/**
 * Whether the definition declares a format this build does not know. Only a
 * version that is present and different degrades: an absent version is a
 * missing required key, which is the validator's finding to report, not a
 * reason to stop reading the document.
 */
function isNewerFormat(definition) {
  const version = definition?.doc?.version;
  return version !== undefined && version !== null && version !== KNOWN_VERSION;
}

function report(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// module loading
// ---------------------------------------------------------------------------

/**
 * Load the module a verb delegates to. A missing module is an internal failure
 * with a named cause on stderr — the one thing it must never be is silent.
 */
async function loadModule(name) {
  const specifier = new URL(`./lib/${name}`, import.meta.url);
  // Resolved through `fileURLToPath` rather than `url.pathname`, which on
  // Windows yields a leading-slash path no `fs` call can stat.
  if (!fs.existsSync(fileURLToPath(specifier))) {
    throw new Error(`the module lib/${name} is not present in this build, so the verb cannot run`);
  }
  try {
    return await import(specifier.href);
  } catch (err) {
    throw new Error(`the module lib/${name} could not be loaded: ${err.message}`);
  }
}

/** The export a verb needs, or a named internal failure if the module lacks it. */
function entryOf(module, name, file) {
  if (typeof module[name] !== 'function') {
    throw new Error(`the module lib/${file} exports no ${name}(), so the verb cannot run`);
  }
  return module[name];
}

// ---------------------------------------------------------------------------
// the verbs
// ---------------------------------------------------------------------------

async function runValidate(flags) {
  if (!flags.definition && !(flags.overlay || []).length) {
    throw new UsageError('validate needs --definition and/or --overlay');
  }
  const sources = readSources(flags);
  if (sources.errors.length) {
    report({ ok: false, errors: sources.errors, warnings: [] });
    return EXIT.REJECTED;
  }

  // The degradation path. The v1 checks describe the v1 grammar, so applying
  // them to a document that declares a newer one would invent findings about
  // keys whose meaning this build does not know. A newer document is folded on
  // its structure alone and judged on that.
  //
  // "Judged on that" is the whole of it, and it is why this branch delegates
  // rather than answering on its own. The structural pass — required keys, the
  // shape of `nodes`, an overlay operation naming a node that does not exist —
  // still runs, still finds things, and used to find them only for `resolve`:
  // this verb returned ok without loading the graph module at all, so one file
  // got exit 0 here and exit 1 from the next verb the operator ran. The two
  // verbs now share one call, and there is exactly one place that decides.
  if (isNewerFormat(sources.definition)) {
    const module = await loadModule(VERBS.resolve.module);
    const resolve = entryOf(module, 'resolve', VERBS.resolve.module);
    const resolved = resolve({
      definition: sources.definition,
      overlays: sources.overlays,
      profile: flags.profile ?? null,
      degraded: [NEWER_FORMAT],
    });
    report({
      ok: resolved.ok,
      errors: resolved.errors,
      warnings: [NEWER_FORMAT],
      degraded: [NEWER_FORMAT],
    });
    return resolved.ok ? EXIT.OK : EXIT.REJECTED;
  }

  const module = await loadModule(VERBS.validate.module);
  const validate = entryOf(module, 'validate', VERBS.validate.module);
  // Two modes, decided here by what was supplied. With no --definition the
  // overlays are judged on their own shape and no base is ever looked for;
  // with one, the full resolution order applies on top.
  const result = validate({
    definition: sources.definition,
    overlays: sources.overlays,
    profile: flags.profile ?? null,
    mode: flags.definition ? 'resolved' : 'standalone',
  });
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

async function runResolve(flags) {
  if (!flags.definition) throw new UsageError('resolve needs --definition');
  const sources = readSources(flags);
  if (sources.errors.length) {
    report({ ok: false, errors: sources.errors, warnings: [] });
    return EXIT.REJECTED;
  }
  const module = await loadModule(VERBS.resolve.module);
  const resolve = entryOf(module, 'resolve', VERBS.resolve.module);
  const result = resolve({
    definition: sources.definition,
    overlays: sources.overlays,
    profile: flags.profile ?? null,
    degraded: isNewerFormat(sources.definition) ? [NEWER_FORMAT] : [],
  });
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

async function runDiagram(flags) {
  if (!flags.definition) throw new UsageError('diagram needs --definition');
  const sources = readSources(flags);
  if (sources.errors.length) {
    report({ ok: false, errors: sources.errors, warnings: [] });
    return EXIT.REJECTED;
  }
  const graph = await loadModule(VERBS.resolve.module);
  const resolve = entryOf(graph, 'resolve', VERBS.resolve.module);
  const resolved = resolve({
    definition: sources.definition,
    overlays: sources.overlays,
    profile: flags.profile ?? null,
    degraded: isNewerFormat(sources.definition) ? [NEWER_FORMAT] : [],
  });
  if (!resolved.ok) {
    report(resolved);
    return EXIT.REJECTED;
  }

  const module = await loadModule(VERBS.diagram.module);
  const render = entryOf(module, 'render', VERBS.diagram.module);
  const text = render(resolved);
  // stdout and --out carry the same bytes: the diagram is a pure function of
  // the resolved graph, and a golden test that compared two different renderings
  // would not be testing determinism at all.
  if (flags.out) {
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(flags.out, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
  return EXIT.OK;
}

async function runWriteState(flags) {
  if (!flags.state) throw new UsageError('write-state needs --state');
  const patch = readPatch();
  const module = await loadModule(VERBS['write-state'].module);
  const write = entryOf(module, 'writeState', VERBS['write-state'].module);
  const result = write({ state: flags.state, patch });
  for (const changed of result.changed || []) process.stdout.write(`${changed}\n`);
  if (result.ok) return EXIT.OK;
  // A refusal is exit 1 and no rename happened: the state file on disk is
  // exactly what it was before the invocation.
  for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  return EXIT.REJECTED;
}

/** The patch, read whole from stdin. An unreadable or non-JSON patch never ran. */
function readPatch() {
  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch (err) {
    throw new UsageError(`the patch could not be read from stdin: ${err.message}`);
  }
  if (text.trim() === '') throw new UsageError('the patch on stdin is empty');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`the patch on stdin is not JSON: ${err.message}`);
  }
}

const RUNNERS = {
  validate: runValidate,
  resolve: runResolve,
  diagram: runDiagram,
  'write-state': runWriteState,
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { verb, flags } = parseArgs(process.argv.slice(2));
  if (verb === null) {
    throw new UsageError(`a verb is required: ${Object.keys(VERBS).join(', ')}`);
  }
  if (!Object.hasOwn(VERBS, verb)) {
    throw new UsageError(`unknown verb "${verb}": expected one of ${Object.keys(VERBS).join(', ')}`);
  }
  checkFlags(verb, flags);
  return RUNNERS[verb](flags);
}

try {
  process.exitCode = await main();
} catch (err) {
  process.stderr.write(`${err instanceof UsageError ? 'usage' : 'workflow'}: ${err.message}\n`);
  process.exitCode = EXIT.INTERNAL;
}
