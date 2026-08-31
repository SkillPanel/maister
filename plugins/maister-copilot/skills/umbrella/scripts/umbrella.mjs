/**
 * The umbrella runtime's single entry point.
 *
 * Invoked in the exec form — `node <path to this file> <verb> [flags]` — with
 * no shebang and no reliance on an executable bit, so it behaves the same on a
 * Windows checkout with no POSIX shell as it does anywhere else. Zero
 * dependencies, `node:` builtins only, Node >= 20.
 *
 * Six verbs, one contract:
 *
 *   init      --root [--members-root --force --scaffold]        JSON on stdout
 *   validate  --root [--definition…]                            JSON on stdout
 *   envelope  --run --node --ledger --root   overrides on stdin JSON on stdout
 *   seed      --envelope [--siblings]                           JSON on stdout
 *   ledger    --ledger --op --actor [--dispatch-id]  args stdin JSON on stdout
 *   outbox    --outbox --dispatch-id --type   the body on stdin JSON on stdout
 *
 * and one exit-code table: 0 success, 1 the input was rejected (the JSON report
 * is still printed, so a caller always has the reasons), 2 the tooling itself
 * failed and nothing was attempted. The separation is what lets a caller
 * distinguish "your workspace is wrong" from "the runtime is broken" without
 * parsing prose. Exit 1 also means nothing was published: every writer this
 * entry point fronts commits through temp → rename, so a refusal leaves the
 * files on disk byte-for-byte as they were.
 *
 * Why structured input arrives on stdin rather than as an argument: no quoting
 * has to survive a shell, which is the same Windows-without-a-shell constraint
 * that shapes the invocation form.
 *
 * This file is a deliberate copy of the workflow engine's entry point
 * (`../../workflow-engine/scripts/workflow.mjs`) — the verb table, the argument
 * parser, `Object.hasOwn` membership, `UsageError`, the lazy module load guarded
 * by `fs.existsSync(fileURLToPath(...))`, the two-space JSON report and the exit
 * codes are all its shape, so an operator who has met one entry point has met
 * both.
 *
 * ONE DECLARED DEVIATION from that parser: a `BOOLEAN` set beside `REPEATABLE`.
 * The engine's parser has no boolean support, so a bare `--force` would consume
 * the next argv token as its value or throw `the flag --force needs a value`.
 * The members of `BOOLEAN` — `force` and `scaffold`, and no others — accept the
 * bare form (value `true`), the explicit `--force=false`, and nothing else.
 * Every flag outside the set keeps the engine's behaviour unchanged.
 *
 * This file owns argument parsing, the exit-code table and the report shape.
 * Everything else lives in `lib/`, one module per concern, loaded only when the
 * verb that needs it is asked for. A module that is not present is reported on
 * stderr at exit 2 — never treated as a quiet success, because a verb that
 * appears to work while writing nothing is the exact failure mode the runtime
 * exists to remove.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The exit-code table, named so no call site writes a bare integer. */
const EXIT = { OK: 0, REJECTED: 1, INTERNAL: 2 };

/**
 * Every verb, with the module that implements it, the export the runner calls,
 * and the flags it accepts. `required` is checked here, before the module is
 * loaded, so a malformed invocation is answered with usage rather than with a
 * complaint about a module the caller never asked to think about.
 */
const VERBS = {
  init: {
    module: 'manifest.mjs',
    entry: 'init',
    flags: ['root', 'members-root', 'force', 'scaffold'],
    required: ['root'],
  },
  validate: {
    module: 'manifest.mjs',
    entry: 'validate',
    flags: ['root', 'definition'],
    required: ['root'],
  },
  envelope: {
    module: 'envelope.mjs',
    entry: 'envelope',
    flags: ['run', 'node', 'ledger', 'root'],
    required: ['run', 'node', 'ledger', 'root'],
  },
  seed: {
    module: 'seed.mjs',
    entry: 'seed',
    flags: ['envelope', 'siblings'],
    required: ['envelope'],
  },
  ledger: {
    module: 'ledger.mjs',
    entry: 'ledger',
    flags: ['ledger', 'op', 'actor', 'dispatch-id'],
    required: ['ledger', 'op', 'actor'],
  },
  outbox: {
    module: 'outbox.mjs',
    entry: 'outbox',
    flags: ['outbox', 'dispatch-id', 'type'],
    required: ['outbox', 'dispatch-id', 'type'],
  },
};

/** The flags that may be given more than once; every other flag is single-valued. */
const REPEATABLE = new Set(['definition']);

/**
 * The declared deviation from the engine parser. A member accepts a bare
 * `--flag` (true) or an explicit `--flag=true` / `--flag=false`; it never
 * consumes the following argv token, so `--force --root /w` still sees `--root`.
 */
const BOOLEAN = new Set(['force', 'scaffold']);

/**
 * The op that allocates its own `dispatch_id`. Every other ledger op addresses
 * an entry that already exists and therefore needs `--dispatch-id`; the rule is
 * a flag dependency, not a ledger rule, so it is checked here.
 */
const ALLOCATING_OP = 'create-entry';

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

    if (BOOLEAN.has(name)) {
      // The deviation, and the whole of it: a boolean never looks at argv[i+1].
      if (value === undefined) value = true;
      else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else throw new UsageError(`the flag --${name} takes true or false, not "${value}"`);
    } else if (value === undefined) {
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
  for (const name of VERBS[verb].required) {
    if (!Object.hasOwn(flags, name)) throw new UsageError(`${verb} needs --${name}`);
  }
}

// ---------------------------------------------------------------------------
// reading the inputs
// ---------------------------------------------------------------------------

/**
 * Structured input, read whole from stdin as JSON. An unreadable or non-JSON
 * document never ran, so it is a usage error rather than a refusal: there is no
 * report to print reasons into.
 *
 * `required: false` treats an absent or empty stdin as an empty document. Two
 * verbs take optional input — `envelope` overrides and the `args` of the ledger
 * ops that need none — and demanding an explicit `{}` from a caller who has
 * nothing to say would be a quoting rule for no gain.
 */
function readStdin({ required }) {
  let text;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch (err) {
    if (!required) return {};
    throw new UsageError(`the input could not be read from stdin: ${err.message}`);
  }
  if (text.trim() === '') {
    if (!required) return {};
    throw new UsageError('the input on stdin is empty');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`the input on stdin is not JSON: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError('the input on stdin must be a JSON object');
  }
  return parsed;
}

/**
 * The report, and then the marker. Where a verb degrades onto one of the frozen
 * dispatch lines, that line is the **last** line on stdout — a reader that takes
 * the final line takes the marker, whatever the report above it said.
 */
function report(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (typeof payload?.marker === 'string' && payload.marker !== '') {
    process.stdout.write(`${payload.marker}\n`);
  }
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

/** The verb's implementation, resolved lazily and identically for every verb. */
async function implementationOf(verb) {
  const spec = VERBS[verb];
  const module = await loadModule(spec.module);
  return entryOf(module, spec.entry, spec.module);
}

/** Every runner ends here: the report is printed, the exit code follows `ok`. */
function finish(result) {
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

// ---------------------------------------------------------------------------
// the verbs
// ---------------------------------------------------------------------------

/**
 * Scaffold a workspace: the manifest, the workflow directory, the ledger and
 * the outbox. `--force` rewrites an existing manifest; without `--scaffold`
 * nothing outside the framework directory is written, and every skipped target
 * is named in the report rather than passing silently.
 */
async function runInit(flags) {
  const init = await implementationOf('init');
  return finish(
    init(flags.root, {
      membersRoot: flags['members-root'] ?? null,
      force: Boolean(flags.force),
      scaffold: Boolean(flags.scaffold),
    }),
  );
}

/**
 * Judge the workspace and, when definitions are named, the workflows with it.
 * Warnings alone still exit 0; the report carries both streams merged.
 */
async function runValidate(flags) {
  const validate = await implementationOf('validate');
  return finish(validate(flags.root, { definitions: flags.definition || [] }));
}

/**
 * Build and publish one node's dispatch envelope. `--root` is required rather
 * than derived: the manifest is consulted unconditionally, and walking up from
 * the run directory would guess at which workspace owns the run.
 */
async function runEnvelope(flags) {
  const overrides = readStdin({ required: false });
  const envelope = await implementationOf('envelope');
  return finish(
    envelope({
      run: flags.run,
      node: flags.node,
      ledger: flags.ledger,
      root: flags.root,
      overrides,
    }),
  );
}

/** Render the worker prompt for an envelope. A pure read; nothing is written. */
async function runSeed(flags) {
  const seed = await implementationOf('seed');
  return finish(seed({ envelope: flags.envelope, siblings: flags.siblings ?? null }));
}

/**
 * One ledger op. `--dispatch-id` addresses an existing entry and is therefore
 * required for every op but the allocating one, which chooses its own id.
 */
async function runLedger(flags) {
  const dispatchId = flags['dispatch-id'] ?? null;
  if (flags.op !== ALLOCATING_OP && dispatchId === null) {
    throw new UsageError(`the ledger op ${flags.op} needs --dispatch-id`);
  }
  const args = readStdin({ required: false });
  const ledger = await implementationOf('ledger');
  return finish(
    ledger({
      ledger: flags.ledger,
      op: flags.op,
      actor: flags.actor,
      dispatch_id: dispatchId,
      args,
    }),
  );
}

/**
 * Append one message to a dispatch's outbox. The body is required: the message
 * types each demand fields of their own, and an empty body could satisfy none
 * of them.
 */
async function runOutbox(flags) {
  const body = readStdin({ required: true });
  const outbox = await implementationOf('outbox');
  return finish(
    outbox({
      outbox: flags.outbox,
      dispatch_id: flags['dispatch-id'],
      type: flags.type,
      body,
    }),
  );
}

const RUNNERS = {
  init: runInit,
  validate: runValidate,
  envelope: runEnvelope,
  seed: runSeed,
  ledger: runLedger,
  outbox: runOutbox,
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
  process.stderr.write(`${err instanceof UsageError ? 'usage' : 'umbrella'}: ${err.message}\n`);
  process.exitCode = EXIT.INTERNAL;
}
