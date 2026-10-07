/**
 * The workflow engine's single entry point.
 *
 * Invoked in the exec form — `node <path to this file> <verb> [flags]` — with
 * no shebang and no reliance on an executable bit, so it behaves the same on a
 * Windows checkout with no POSIX shell as it does anywhere else. Zero
 * dependencies, `node:` builtins only, Node >= 20.
 *
 * The verbs, one contract:
 *
 *   validate       --definition and/or repeatable --overlay   JSON on stdout
 *   resolve        --definition, --overlay…, --profile        JSON on stdout
 *   diagram        the same, plus optional --out              Mermaid text
 *   locate         optional --name, with it --overlay…, --profile   JSON on stdout
 *                  (one workflow found by the name it is run by, with the
 *                  --definition and --overlay values the three verbs above
 *                  take; without --name, the project's own workflows)
 *   write-state    --state, --patch-file (or the patch as JSON on stdin)
 *                                                             changed paths
 *   gate-request   --state, --patch-file (or the request as JSON on stdin)
 *                                                             the files written
 *                  (the request file, the gate index and the pending marker)
 *   gate-revise    --state, --node, --option, --patch-file (or the note as
 *                  JSON on stdin)                             changed paths
 *                  (the stretch from the option's rerun node to the gate reset
 *                  in one write, with the operator's note on the gate)
 *   prior-context  --state                                    the prior phases'
 *                  decisions and risks as markdown to paste into a delegate
 *                  prompt — read-only over a run
 *   gate-brief     --state, --node, optional one of --oneline,
 *                  --json [--picker=rich|plain], --checkpoint, --request
 *                                                             the gate brief:
 *                  with no form, the closing summary and the node that runs
 *                  next as text; --checkpoint the checkpoint, the one
 *                  structured object every surface projects from; --json the
 *                  in-session picker projected from it for the asking tool
 *                  (--picker), with the full brief as `more_details`;
 *                  --request the whole driven gate request; --oneline the
 *                  one-line fallback a request's summary carries — reads
 *                  the run, and writes only its display/next.json, the panel
 *                  an editor extension draws above the question
 *   resume-check   --state                                    JSON on stdout
 *                  (the frozen workflow's name, overlays and profile, or the
 *                  refusal for a directory the engine does not resume, a 2.x
 *                  one among them) — read-only over a run
 *   sync-plan      --plan                                     JSON on stdout
 *                  (the plan companion's progress markers set from the
 *                  markdown plan's checkboxes; a no-op without a companion)
 *
 * and one exit-code table: 0 success, 1 the input was rejected (the JSON report
 * is still printed, so a caller always has the reasons), 2 the tooling itself
 * failed. The separation is what lets a caller distinguish "your definition is
 * wrong" from "the engine is broken" without parsing prose.
 *
 * Why the patch arrives in a file or on stdin rather than as an argument: no
 * quoting has to survive a shell, which is the same Windows-without-a-shell
 * constraint that shapes the invocation form. A driver writes the file with its
 * own file tool and names it with `--patch-file`; stdin stays for scripts, tests
 * and hosts with no file tool. A JSON heredoc is the form the shell-safety checks
 * of an agent host refuse, and a file needs no quoting in any shell.
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
import { isNewerVersion, readDefinition } from './lib/definition.mjs';
// Shared with the session-start hook, which warns on the same detection, so it
// sits at the plugin root beside `canonical.mjs` rather than in this skill.
import { findEditionCollision } from '../../../lib/editions.mjs';
// Shared with the umbrella runtime's `--input-file`: one rule for a document
// read from a fixed file instead of stdin.
import { anchoredFile, consume as consumeFile, readFileText } from '../../../lib/input-file.mjs';

/** The exit-code table, named so no call site writes a bare integer. */
const EXIT = { OK: 0, REJECTED: 1, INTERNAL: 2 };

/** Every verb, with the module that implements it and the flags it accepts. */
const VERBS = {
  validate: { module: 'graph.mjs', flags: ['definition', 'overlay', 'profile'] },
  resolve: { module: 'graph.mjs', flags: ['definition', 'overlay', 'profile'] },
  diagram: { module: 'diagram.mjs', flags: ['definition', 'overlay', 'profile', 'out'] },
  // The name lookup the three verbs above do not do: they take paths, and a
  // run starts from a name. Read-only, and the name is optional — without it
  // the verb lists every workflow the project itself can run by name. The
  // overlays and the profile a run would add take part only in whether the
  // named workflow is a chain, so they need the name.
  locate: { module: 'locate.mjs', flags: ['name', 'overlay', 'profile'] },
  // `--patch-file` names the one file a patch may be read from, beside the
  // state; it is a flag rather than a derived path so the call says what it
  // reads, and it is checked against that one place (`patchFileOf`).
  'write-state': { module: 'state.mjs', flags: ['state', 'patch-file'] },
  // The flags of `write-state`, and for the same reason: everything the verb
  // needs — the run directory, the `gates/` directory and the frozen graph — is
  // derived from the state file, so there is no second path a caller could get
  // wrong or point at another run.
  'gate-request': { module: 'gate.mjs', flags: ['state', 'patch-file'] },
  // A gate's revise option, carried out. `--node` and `--option` because the
  // state records no "current" gate and no chosen option until this write
  // records it; the note travels in the patch file for `write-state`'s reason.
  'gate-revise': { module: 'revise.mjs', flags: ['state', 'node', 'option', 'patch-file'] },
  // Three flags, where the other two state verbs take one: the outbox root and
  // the dispatch id are not derivable from a run directory. They are the
  // dispatch's, not the run's, and the worker already holds both — its seed
  // hands them over under exactly these two spellings for the outbox verb it
  // publishes with.
  'run-complete': { module: 'complete.mjs', flags: ['state', 'outbox', 'dispatch-id'] },
  // One of the two verbs that read a run and write nothing. One flag, for
  // `write-state`'s reason: the context block and its `phase_summaries` are
  // found inside the state file, so there is nothing else a caller could name
  // and therefore nothing else a caller could name wrongly. `--background`
  // frames the same items for a delegate writing for end users, who is to stay
  // consistent with them rather than carry them into its document.
  'prior-context': { module: 'prior-context.mjs', flags: ['state', 'background'] },
  // The other verb that never writes state — only the panel beside it, a
  // display file. `--node` because a run has many gates and the
  // state records no "current" one while a question is being composed; the
  // gate is checked against the frozen graph, so a wrong id is refused rather
  // than rendered. One form flag at most: `--checkpoint` is the structured
  // checkpoint itself, which an editor panel or a cockpit reads; `--json` the
  // in-session picker projected from it, and `--picker` says which tool asks:
  // `rich` for one that shows option previews, `plain` for one that takes
  // labels only — the build rewrites the one into the other per tool;
  // `--request` the driven gate request, whole, so a driver composes nothing;
  // `--oneline` the one-line fallback that request's summary carries.
  'gate-brief': { module: 'gate-brief.mjs', flags: ['state', 'node', 'oneline', 'json', 'picker', 'checkpoint', 'request'] },
  // Read-only as well, and asked first by every resume: whether the directory
  // holds a run this engine froze, and what it froze. One flag for the reason
  // the other state verbs take one.
  'resume-check': { module: 'resume-check.mjs', flags: ['state'] },
  // The plan, not the state file: the executor also runs outside an engine
  // run, and the companion it keeps in step sits beside the plan either way.
  // The run's `html_output` switch is looked up from there when a run exists.
  'sync-plan': { module: 'plan-sync.mjs', flags: ['plan'] },
};

/** This plugin's root, three levels above this file: what the edition check locates. */
const PLUGIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The flags that may be given more than once; every other flag is single-valued. */
const REPEATABLE = new Set(['overlay']);

/**
 * The picker profiles `gate-brief --json` renders: `rich` for a tool that shows
 * option descriptions and previews, `plain` for one that takes labels only.
 */
const PICKERS = ['rich', 'plain'];

/** The flags that take no value: present means true. Every other flag needs one. */
const BOOLEAN = new Set(['oneline', 'json', 'checkpoint', 'request', 'background']);

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
    if (BOOLEAN.has(name)) {
      if (at >= 0) throw new UsageError(`the flag --${name} takes no value`);
      if (Object.hasOwn(flags, name)) throw new UsageError(`the flag --${name} was given more than once`);
      flags[name] = true;
      continue;
    }
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
  return { definition, overlays, errors: withEditionCause(errors) };
}

/**
 * A definition that does not exist is, with two editions enabled, most likely
 * one only the other edition ships: the loader drew this skill from one of
 * them and the workflow from the other. The missing-file message alone names
 * the symptom, so the collision is appended to it as the cause. Checked only
 * when a file is missing, so an ordinary read pays nothing for it.
 */
function withEditionCause(errors) {
  const missing = errors.filter(error => error.file && !fs.existsSync(error.file));
  if (!missing.length) return errors;
  const collision = editionCollision(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!collision) return errors;
  return errors.map(error => (missing.includes(error)
    ? { ...error, message: `${error.message}. ${collision.message}` }
    : error));
}

/** The edition collision this session is in, or null; see `lib/editions.mjs`. */
function editionCollision(projectDir) {
  return findEditionCollision({ pluginRoot: PLUGIN_ROOT, projectDir });
}

/**
 * Whether the definition declares a format newer than this build knows. Only a
 * whole number above the known version degrades. An absent version is a
 * missing required key, and a malformed one — quoted, fractional, a word — is a
 * misspelling of the known grammar: both are the validator's findings to
 * report, never a reason to stop checking the document.
 */
function isNewerFormat(definition) {
  return isNewerVersion(definition?.doc?.version);
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
    throw new Error(`the module lib/${name} is not available in this edition of the plugin (pro edition required), so the verb cannot run`);
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
  const displayOf = entryOf(await loadModule('display.mjs'), 'displayOf', 'display.mjs');
  const { titles } = displayOf({ definition: sources.definition, overlays: sources.overlays, profile: flags.profile ?? null });
  const text = render(resolved, { titles });
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

/**
 * Find a workflow by the name it is run by, or list the project's own.
 *
 * Reported like `validate` — the whole JSON result on stdout, exit 1 when the
 * name finds nothing or finds a file that calls itself something else — so a
 * caller reads the reasons from the same place whatever the outcome.
 */
async function runLocate(flags) {
  if (!flags.name && ((flags.overlay || []).length || flags.profile)) {
    throw new UsageError('locate takes --overlay and --profile only with --name');
  }
  const module = await loadModule(VERBS.locate.module);
  const find = entryOf(module, 'locate', VERBS.locate.module);
  const result = find({ name: flags.name ?? null, overlays: flags.overlay || [], profile: flags.profile ?? null });
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

async function runWriteState(flags) {
  if (!flags.state) throw new UsageError('write-state needs --state');
  const module = await loadModule(VERBS['write-state'].module);
  const write = entryOf(module, 'writeState', VERBS['write-state'].module);
  // The verb that freezes a run and carries every write after it, so refusing
  // here refuses both a start and a resume — including a driven one, where the
  // session-start warning is never read. Before stdin, so nothing is written.
  if (refusedForEditions(module, flags)) return EXIT.REJECTED;
  const input = readInput(flags, 'the patch');
  const result = write({ state: flags.state, patch: input.document });
  return reportWrite(result, input);
}

/** `edition-collision` for a verb that writes state, reported before anything is read. */
function refusedForEditions(module, flags) {
  const collision = editionCollision(process.env.CLAUDE_PROJECT_DIR
    || (typeof module.projectRootOf === 'function' ? module.projectRootOf(path.dirname(path.resolve(flags.state))) : null));
  if (!collision) return false;
  process.stderr.write(`edition-collision: ${collision.message}\n`);
  return true;
}

/**
 * Send a run back from a gate by one of its revise options.
 *
 * Reported exactly like `write-state`, because it is one: the changed paths on
 * stdout, the refusal on stderr with its code first, the patch file kept on a
 * refusal and consumed once the write lands. One line follows the paths, after
 * a blank line, naming what was reset — the next node to run is the rerun one.
 */
async function runGateRevise(flags) {
  if (!flags.state) throw new UsageError('gate-revise needs --state');
  if (!flags.node) throw new UsageError('gate-revise needs --node');
  if (!flags.option) throw new UsageError('gate-revise needs --option');
  const state = await loadModule(VERBS['write-state'].module);
  if (refusedForEditions(state, flags)) return EXIT.REJECTED;
  const input = readInput(flags, 'the revise note');
  const module = await loadModule(VERBS['gate-revise'].module);
  const revise = entryOf(module, 'gateRevise', VERBS['gate-revise'].module);
  const result = revise({ state: flags.state, node: flags.node, option: flags.option, input: input.document });
  const code = reportWrite(result, input);
  if (result.ok && result.revision) {
    const { gate, reruns, revision, ceiling, reset } = result.revision;
    process.stdout.write(`\nrevised: ${gate} reruns=${reruns} revision=${revision}/${ceiling} reset=${reset.join(',')}\n`);
  }
  return code;
}

/** The report every state write shares: changed paths, then its notes and warnings, then the exit code. */
function reportWrite(result, input) {
  // The freeze's startup banner comes first, then a blank line, then the changed
  // paths: a banner after some forty paths sat in a collapsed tool result where
  // nobody read it. A caller after the paths skips to the first blank line.
  if (result.banner) process.stdout.write(`${result.banner}\n`);
  for (const changed of result.changed || []) process.stdout.write(`${changed}\n`);
  // A warning is not a refusal and must not read like one: the refusal contract
  // puts the code as the first stderr token, so these lines open with `warning:`
  // and name what did not happen. The dashboard is a projection of a write that
  // already landed, so the exit code does not move.
  for (const warning of result.warnings || []) {
    process.stderr.write(`warning: ${warning.file ?? 'dashboard-data.js'} was not written (${warning.code}: ${warning.message});`
      + ' the state write is unaffected\n');
  }
  // Clock fields a patch carried are dropped, never refused: a refusal would
  // stop a driver mid-run over a value the writer supplies anyway.
  // `attempt` and `reruns` are the writer's too, but no clock fills them: a
  // revise sets the one and the freeze the other, and the note says so.
  const owned = (result.ignored || []).filter(field => /\.(?:attempt|reruns)$/.test(field));
  const clocked = (result.ignored || []).filter(field => !owned.includes(field));
  if (clocked.length) {
    process.stderr.write(`note: ignored the supplied ${clocked.join(', ')}; the writer stamps these from its own clock\n`);
  }
  if (owned.length) {
    process.stderr.write(`note: ignored the supplied ${owned.join(', ')}; the freeze records reruns and a revise counts attempts,`
      + ' so no patch sets either\n');
  }
  // A value the node's definition does not declare is written, never refused,
  // because nothing reads one: no guard and no `${…}` reference may name it.
  // Which is also why it is worth a line — a name meant to be declared, or
  // misspelled, is otherwise a value nobody ever notices is ignored.
  if (result.undeclared?.length) {
    process.stderr.write(`warning: wrote ${result.undeclared.join(', ')}, which the definition does not declare among`
      + ' the node\'s outputs; the write landed, and no guard or ${…} reference reads an undeclared value\n');
  }
  if (result.ok) {
    consume(input);
    return EXIT.OK;
  }
  // A refusal is exit 1 and no rename happened: the state file on disk is
  // exactly what it was before the invocation.
  for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  return EXIT.REJECTED;
}

/**
 * Write the gate request file and regenerate the gate index.
 *
 * Reported like `write-state` — the files written, one per line, and the
 * refusal message on stderr with the code as its first token — because a caller
 * that has learned one of these two verbs has learned both. It reports the
 * state file among them: the pending marker is written inside this verb, not by
 * a second call, because the run is pending from the moment the request file
 * lands and a second shell call against a pending run is denied.
 */
async function runGateRequest(flags) {
  if (!flags.state) throw new UsageError('gate-request needs --state');
  const input = readInput(flags, 'the request document');
  const module = await loadModule(VERBS['gate-request'].module);
  const write = entryOf(module, 'gateRequest', VERBS['gate-request'].module);
  const result = write({ state: flags.state, request: input.document });
  for (const written of result.changed || []) process.stdout.write(`${written}\n`);
  if (result.ok) {
    consume(input);
    return EXIT.OK;
  }
  for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  return EXIT.REJECTED;
}

/** The one name a patch file may carry: beside the state file it patches. */
const PATCH_FILE = '.state-patch.json';

/**
 * A structured input: `{document, file}`, from the patch file when
 * `--patch-file` names one, else read whole from stdin. Unreadable or non-JSON
 * never ran.
 *
 * `what` names the document in the message because two verbs read one, and
 * "the patch is not JSON" reported for a gate request would send a caller to
 * the wrong document. An empty input is rejected; an empty *object* is not,
 * and for `write-state` that is a sanctioned call — the validate-and-republish
 * step of a resume. Both sources go through the same parse, so one document
 * lands the same bytes whichever way it arrived. Given a file, stdin is never
 * read, so a caller with a terminal on stdin does not block.
 */
function readInput(flags, what) {
  if (flags['patch-file'] === undefined) {
    let text;
    try {
      text = fs.readFileSync(0, 'utf8');
    } catch (err) {
      throw new UsageError(`${what} could not be read from stdin: ${err.message}`);
    }
    return { document: parseDocument(text, `${what} on stdin`), file: null };
  }
  const file = patchFileOf(flags);
  const text = readFileText(file, what, UsageError);
  return { document: parseDocument(text, `${what} in ${file}`), file };
}

function parseDocument(text, where) {
  if (text.trim() === '') throw new UsageError(`${where} is empty`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${where} is not JSON: ${err.message}`);
  }
}

/**
 * The patch file, once it is known to be the one place a patch is read from:
 * `.state-patch.json` in the directory of `--state`, a regular file, not a link.
 * The run directory is the only place, so a patch can never be read from — or,
 * on success, deleted from — anywhere else. Why the name is fixed and what is
 * refused: `lib/input-file.mjs`.
 */
function patchFileOf(flags) {
  return anchoredFile({
    given: flags['patch-file'],
    expected: path.join(path.dirname(path.resolve(flags.state)), PATCH_FILE),
    noun: 'the patch file',
    beside: 'beside the state file it patches',
    Usage: UsageError,
  });
}

/**
 * Delete the patch file once its document has landed, so a file left behind
 * always means "not applied". A refusal keeps it, for the caller to correct and
 * send again.
 */
function consume(input) {
  if (input.file) consumeFile(input.file);
}

/**
 * End the run, and under a dispatch driver only once its close-out is on disk.
 *
 * Reported unlike the other two state verbs, because what a caller needs from
 * it is not a list of files but one line to print: the marker is the **last**
 * line of stdout either way, and the refusal that explains it goes to stderr, so
 * a turn that ends on this verb ends on a line the C5 vocabulary matches. The
 * other stdout lines — one `missing-artifact:` line per declared artifact not
 * on disk, then a stopped run's notice — go above the marker, never below it.
 * A warning goes to stderr, opening with `warning:`, and moves no exit code.
 */
async function runRunComplete(flags) {
  if (!flags.state) throw new UsageError('run-complete needs --state');
  const module = await loadModule(VERBS['run-complete'].module);
  const judge = entryOf(module, 'runComplete', VERBS['run-complete'].module);
  const result = judge({ state: flags.state, outbox: flags.outbox, dispatch_id: flags['dispatch-id'] });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  }
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
  for (const line of result.missing || []) process.stdout.write(`${line}\n`);
  if (result.notice) process.stdout.write(`${result.notice}\n`);
  process.stdout.write(`${result.marker}\n`);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

/**
 * Print the prior phases' decisions and risks for pasting into a delegate
 * prompt.
 *
 * Unlike every other verb here it publishes nothing, so there is no list of
 * changed files to report: stdout *is* the result, and it is the bytes a caller
 * pastes. Exit 1 carries the refusal on stderr in the shape the two state verbs
 * use, so a caller that has learned one of them reads this one too.
 */
async function runPriorContext(flags) {
  if (!flags.state) throw new UsageError('prior-context needs --state');
  const module = await loadModule(VERBS['prior-context'].module);
  const render = entryOf(module, 'priorContext', VERBS['prior-context'].module);
  const result = render({ state: flags.state, background: flags.background === true });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    return EXIT.REJECTED;
  }
  process.stdout.write(result.text);
  return EXIT.OK;
}

/**
 * Print the brief an operator reads at a gate.
 *
 * Reported like `prior-context` — stdout is the bytes a caller pastes into the
 * question, a refusal is exit 1 with an empty stdout and the code first on
 * stderr — except under `--json`, which reports like `resume-check`, the whole
 * result on stdout; and with one addition: a drifted definition is a warning, not a
 * refusal, so it goes to stderr beside a brief that still printed, or after
 * the refusal's code when one follows it.
 */
async function runGateBrief(flags) {
  if (!flags.state) throw new UsageError('gate-brief needs --state');
  if (!flags.node) throw new UsageError('gate-brief needs --node');
  const forms = GATE_BRIEF_FORMS.filter(form => flags[form] === true);
  if (forms.length > 1) {
    throw new UsageError(`gate-brief takes one form at most, not ${forms.map(form => `--${form}`).join(' and ')}: `
      + '--json is the in-session picker, --oneline the driven summary, --checkpoint the structured checkpoint, --request the driven gate request');
  }
  const form = forms[0] ?? 'plain';
  // The profile shapes the in-session picker and nothing else: every other
  // form is read by a driver or a cockpit, which has no picker of this kind.
  if (flags.picker !== undefined && form !== 'json') {
    throw new UsageError('gate-brief takes --picker only with --json: it shapes the in-session picker');
  }
  const picker = flags.picker ?? 'rich';
  if (!PICKERS.includes(picker)) {
    throw new UsageError(`gate-brief --picker takes ${PICKERS.join(' or ')}, not "${picker}"`);
  }
  const module = await loadModule(VERBS['gate-brief'].module);
  const render = entryOf(module, 'gateBrief', VERBS['gate-brief'].module);
  const result = render({ state: flags.state, node: flags.node, form, picker });
  // A refusal's code comes first on stderr, and a drift warning is kept after
  // it: a drifted run that also lacks a summary must still say it drifted.
  if (!result.ok) for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning.message ?? warning}\n`);
  if (result.ok && result.panel) await publishPanel(flags.state, result.panel);
  const warnings = (result.warnings || []).map(warning => warning.message ?? warning);
  if (form === 'json') {
    // The picker as data, so nothing is parsed out of prose: a refusal is the
    // same JSON with `ok: false`, beside the stderr lines above.
    report(result.ok
      ? { ok: true, ...result.picker, more_details: result.more_details, errors: [], warnings }
      : { ok: false, errors: result.errors, warnings });
    return result.ok ? EXIT.OK : EXIT.REJECTED;
  }
  if (!result.ok) return EXIT.REJECTED;
  // The checkpoint and the request are documents, printed whole and nothing
  // else, so a caller can write stdout to a file as it stands.
  if (form === 'checkpoint') process.stdout.write(`${JSON.stringify(result.checkpoint, null, 2)}\n`);
  else if (form === 'request') process.stdout.write(`${JSON.stringify(result.request, null, 2)}\n`);
  else process.stdout.write(result.text);
  return EXIT.OK;
}

/** The forms `gate-brief` renders besides its plain text, one at a time. */
const GATE_BRIEF_FORMS = ['oneline', 'json', 'checkpoint', 'request'];

/**
 * Write the brief's panel to the run's `display/next.json`, for an editor
 * extension to draw above the question. Display only: whatever goes wrong is
 * one stderr line and the brief stands as printed. It stays out of the
 * `--json` warnings, which carry what the asking model must relay — a panel
 * is nothing it relays.
 */
async function publishPanel(state, panel) {
  const warn = (file, detail) => process.stderr.write(`warning: ${file} was not written (${detail}); the brief is unaffected\n`);
  try {
    const module = await loadModule('display-files.mjs');
    const publish = entryOf(module, 'publishNext', 'display-files.mjs');
    for (const warning of publish({ runDir: path.dirname(path.resolve(state)), panel })) {
      warn(warning.file, `${warning.code}: ${warning.message}`);
    }
  } catch (err) {
    warn('display/next.json', err.message);
  }
}

/**
 * Set the plan companion's progress markers from the markdown plan.
 *
 * Reported like `validate` — the whole JSON result on stdout — because what a
 * caller needs back is data, not a list of files: whether anything was
 * written, and which of the plan's groups the companion carries no marker for,
 * so a miss is logged rather than silent. A no-op (no companion, or HTML
 * companions switched off for the run) is a success that names its reason.
 */
async function runSyncPlan(flags) {
  if (!flags.plan) throw new UsageError('sync-plan needs --plan');
  const module = await loadModule(VERBS['sync-plan'].module);
  const sync = entryOf(module, 'syncPlan', VERBS['sync-plan'].module);
  const result = sync({ plan: flags.plan });
  report(result);
  if (result.ok) return EXIT.OK;
  for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  return EXIT.REJECTED;
}

/**
 * Say whether a task directory is a run this engine resumes.
 *
 * Reported like `locate` — the whole JSON result on stdout, exit 1 for a
 * directory it does not resume — so the refusal's `message`, which is written
 * for the operator, is read from the same place as the frozen workflow's name.
 */
async function runResumeCheck(flags) {
  if (!flags.state) throw new UsageError('resume-check needs --state');
  const module = await loadModule(VERBS['resume-check'].module);
  const check = entryOf(module, 'resumeCheck', VERBS['resume-check'].module);
  const result = check({ state: flags.state });
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

const RUNNERS = {
  validate: runValidate,
  resolve: runResolve,
  diagram: runDiagram,
  locate: runLocate,
  'write-state': runWriteState,
  'gate-request': runGateRequest,
  'gate-revise': runGateRevise,
  'run-complete': runRunComplete,
  'prior-context': runPriorContext,
  'gate-brief': runGateBrief,
  'resume-check': runResumeCheck,
  'sync-plan': runSyncPlan,
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
