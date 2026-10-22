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
 *   write-state    --state, --patch-file (or the patch as JSON on stdin),
 *                  --host at the freeze (claude or copilot)
 *                                                             changed paths
 *                  (and, for a node's question set, a blank line and the
 *                  `ask:` line naming the ids still to ask, or `none`; then,
 *                  when a node it completed owes an HTML companion that is
 *                  not on disk, a blank line and one `companion-missing:
 *                  <node> <path>` line per file)
 *   gate-request   --state, --patch-file (or the request as JSON on stdin)
 *                                                             the files written
 *                  (the request file, the gate index and the pending marker);
 *                  a gate its guard skips is refused `gate-guard-false`, as
 *                  `gate-brief` refuses it, before anything is written
 *   gate-revise    --state, --node, --option, --patch-file (or the note as
 *                  JSON on stdin)                             changed paths
 *                  (the stretch from the option's rerun node to the gate reset
 *                  in one write, with the operator's note on the gate; at
 *                  `--node=held-approval`, the owning node and everything
 *                  downstream of it, closing node included)
 *   prior-context  --state, optional --background, --node     the prior phases'
 *                  decisions and risks as markdown to paste into a delegate
 *                  prompt; with --node, the node's run context first and a
 *                  blank line — read-only over a run
 *   run-context    --state, --node                            the run-scoped
 *                  context a delegate prompt carries — task directory, HTML
 *                  guide or off, documentation, scratch rule, summary contract
 *                  and the companions the node owes — as markdown to paste;
 *                  read-only over a run
 *   node-brief     --state, --node                            what a node
 *                  reads before it runs — how it runs, its guard, attempt,
 *                  inputs filled in, writes, questions, the checkpoint it
 *                  feeds, its brief: data and the convention rows that apply,
 *                  then its own section of the guide, as markdown; read-only
 *                  over a run
 *   gate-brief     --state, --node, optional one of --oneline,
 *                  --json [--picker=rich|plain], --checkpoint, --request
 *                  [--reask=<revise option>]; with --patch-file
 *                  (--checkpoint or --request only) the question set a
 *                  running node asks inside itself            the gate brief:
 *                  with no form, the closing summary and the node that runs
 *                  next as text; --checkpoint the checkpoint, the one
 *                  structured object every surface projects from; --json the
 *                  in-session picker projected from it for the asking tool
 *                  (--picker), with the full brief as `more_details`;
 *                  --request the whole driven gate request, its question
 *                  opened by a line asking for the note when --reask names
 *                  the revise answered without one; --oneline the
 *                  one-line fallback a request's summary carries — reads
 *                  the run, and writes only its display/next.json, the panel
 *                  an editor extension draws above the question. --node
 *                  names a frozen gate, or held-approval: the checkpoint a
 *                  run raises before it closes while choices are held
 *   area-brief     --state, --node (the convergence node asking), and one of
 *                  --area --json [--picker=rich|plain], --area alone, or
 *                  --patch-file with --area repeated or omitted
 *                                                             one decision
 *                  area of the brainstorm: the picker as JSON, the write-up as
 *                  markdown, or the driven question set written to the patch
 *                  file; a file it cannot use is a warning and nothing to
 *                  paste — reads the run, writes no state
 *   finding-brief  --state, --node (the reviewing node asking), --findings-file,
 *                  optional --patch-file                     the reviewer's
 *                  findings as the node's question set, one question per
 *                  finding with an accept-the-risk choice added: the set as
 *                  JSON on stdout, or written to the patch file; a findings
 *                  list it cannot use is a warning and nothing to paste —
 *                  reads the run, writes no state
 *   resume-check   --state                                    JSON on stdout
 *                  (the frozen workflow's name, overlays and profile, or the
 *                  refusal for a directory the engine does not resume, a 2.x
 *                  one among them) — read-only over a run
 *   subrun-path    --state (the parent's), --node             JSON on stdout
 *                  (a workflow: node's child run directory, relative to the
 *                  project root, and its run id: the one the parent recorded,
 *                  else the one the sub-run naming rule gives, with what that
 *                  directory holds now) — read-only over a run
 *   import         --state, --to (a folder of the run), repeatable --from,
 *                  optional --as                            JSON on stdout
 *                  (each source copied into the run byte for byte, a
 *                  directory recursively, and each one it could not copy
 *                  with its reason) — writes the copies and no state
 *   wave-start     --plan, --wave, --groups                   JSON on stdout
 *                  (the wave's start heading appended to the work log beside
 *                  the plan, then the run's displays re-projected)
 *   group-done     --plan, --groups, --entry-file             JSON on stdout
 *                  (accepted groups recorded in one call: their checkboxes
 *                  marked, the companion synced, one work-log entry each under
 *                  the wave that started it, the displays re-projected)
 *   sync-plan      --plan                                     JSON on stdout
 *                  (the plan companion's progress markers set from the
 *                  markdown plan's checkboxes; a no-op without a companion)
 *   dispatch-model --agent (comma-separated), --host, optional --state,
 *                  --node (with --state) and --tier         one line per agent
 *                  naming the model and effort its call carries, or `omit`,
 *                  and the level that answered; then any notes — the run's
 *                  frozen block with --state, else the project's config.yml
 *                  — read-only
 *   review-brief   --state, or --task-path with --base; optional --base,
 *                  --cycle, --recheck=tests-only|reviews with --fixed-issues,
 *                  or --refresh                            the path of the
 *                  verification cycle's review brief it wrote — what changed
 *                  since the run's base commit, the spec's ids, the plan, the
 *                  test result, the matching standards, and on a re-check the
 *                  issues and the fix diff; a part it cannot fill is a
 *                  `warning:` line — writes only under the run's verification/
 *   findings-merge --state, or --task-path; optional --cycle  JSON on stdout
 *                  (the cycle's reviewer findings merged into findings.json,
 *                  its counts and the issues_found projection) — writes only
 *                  under the run's verification/
 *   runner-result  --state, --node, optional --runner, --patch-file (or the
 *                  result as JSON on stdin)                   JSON on stdout
 *                  (a runner's result — `--runner=verification`, the
 *                  default, or `implementation` — checked, stamped with the
 *                  node, its attempt and the cycle or pass, and written to
 *                  <runner>/runner-result.json)
 *   runner-step    --state, --node, optional --runner and --answered
 *                                                             JSON on stdout
 *                  (what the node running the loop does next: keep it
 *                  inline, dispatch the runner and with what to resume, ask
 *                  the decision the runner returned, or close on its end)
 *                  — writes only <runner>/decisions-<cycle or pass>.json
 *
 * and one exit-code table: 0 success, 1 the input was rejected (the JSON report
 * is still printed, so a caller always has the reasons), 2 the tooling itself
 * failed. The separation is what lets a caller distinguish "your definition is
 * wrong" from "the engine is broken" without parsing prose.
 *
 * The verbs that brief a moment or refuse a state change — `gate-brief`,
 * `area-brief`, `finding-brief`, `gate-revise`, `write-state` and
 * `run-complete` — also name the reference section that governs it, in one
 * spelling, `rules: <file> § <heading>`: the last stdout paragraph of a text
 * form, a `rules` key of a `--json` form, one stderr line after a refusal's
 * message and before any `warning:`. Closed documents a driver reads and usage
 * errors carry none (`RULES`). `node-brief` names its rules too, as a line of
 * its header rather than the last paragraph (`RULES`).
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
// Shared with the umbrella runtime too: one bounded read of a document on stdin.
import { readStdin, STDIN_IDLE_MS } from '../../../lib/stdin.mjs';

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
  // The implementation phase's two bookkeeping moments, one call each. The
  // plan, as `sync-plan` takes it, because the executor also runs outside an
  // engine run; the work log and the state are found beside it. The entry file
  // is the one fixed place an entry is read from (`entryFileOf`).
  'wave-start': { module: 'plan-progress.mjs', flags: ['plan', 'wave', 'groups'] },
  'group-done': { module: 'plan-progress.mjs', flags: ['plan', 'groups', 'entry-file'] },
  // `--patch-file` names the one file a patch may be read from, beside the
  // state; it is a flag rather than a derived path so the call says what it
  // reads, and it is checked against that one place (`patchFileOf`).
  // `--host` is read at the freeze only, for the run's delegation record.
  'write-state': { module: 'state.mjs', flags: ['state', 'patch-file', 'host'] },
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
  // `write-state`'s reason: the summaries it renders are found inside the
  // state file, so there is nothing else a caller could name
  // and therefore nothing else a caller could name wrongly. `--background`
  // frames the same items for a delegate writing for end users, who is to stay
  // consistent with them rather than carry them into its document.
  // `--node` prints the node's run context first, so an artifact writer
  // fetches both passages in one call.
  'prior-context': { module: 'prior-context.mjs', flags: ['state', 'background', 'node'] },
  // Read-only too: the run facts every delegate prompt carries. `--node`
  // because what a node owes is the node's, and the state records no
  // "current" one while a prompt is being composed.
  'run-context': { module: 'run-context.mjs', flags: ['state', 'node'] },
  // Read-only as well: the brief a node reads before it runs. `--node` for
  // `run-context`'s reason; nothing else is taken, because the definition,
  // its overlays, the guide and the conventions are all found from the run.
  'node-brief': { module: 'node-brief.mjs', flags: ['state', 'node'] },
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
  // `--patch-file` carries the question set a running node asks inside
  // itself, from the one place a patch is read, so the request a driver
  // suspends on is built by the same verb a gate's is.
  'gate-brief': { module: 'gate-brief.mjs', flags: ['state', 'node', 'oneline', 'json', 'picker', 'checkpoint', 'request', 'reask', 'patch-file'] },
  // One decision area of a brainstorm, rendered from the file it wrote, so a
  // convergence node pastes its questions instead of composing them. `--node`
  // for `gate-brief`'s reason, and because the file is found through that
  // node's `with:`; `--area` repeatable for the driven set, which may carry
  // only some areas. `--json` and `--picker` as in `gate-brief`; `--patch-file`
  // is the one place the set is written, so a driver hands it on unchanged.
  'area-brief': { module: 'area-brief.mjs', flags: ['state', 'node', 'area', 'json', 'picker', 'patch-file'] },
  // A reviewer's findings, one question each, rendered from the list it wrote,
  // so a reviewing node pastes its questions instead of composing them.
  // `--findings-file` because the list is the reviewer's own artifact, named
  // by the node that dispatched it; `--patch-file` as in `area-brief`.
  'finding-brief': { module: 'finding-brief.mjs', flags: ['state', 'node', 'findings-file', 'patch-file'] },
  // Read-only as well, and asked first by every resume: whether the directory
  // holds a run this engine froze, and what it froze. One flag for the reason
  // the other state verbs take one.
  'resume-check': { module: 'resume-check.mjs', flags: ['state'] },
  // Read-only as well: where a `workflow:` node's child run lives. `--node`
  // because a run may hold several such nodes; the rest — the parent's
  // directory, its definition and the project root — is found from the state,
  // so no driver composes the child's path by hand.
  'subrun-path': { module: 'subrun-path.mjs', flags: ['state', 'node'] },
  // Context brought into the run from elsewhere, copied by the one script a
  // driven session can always run, never by a shell copy its permissions may
  // refuse. `--from` repeats, one source each; `--as` renames the one source,
  // so a document lands under the fixed name the steps after it read.
  import: { module: 'context-import.mjs', flags: ['state', 'to', 'from', 'as'] },
  // The plan, not the state file: the executor also runs outside an engine
  // run, and the companion it keeps in step sits beside the plan either way.
  // The run's `html_output` switch is looked up from there when a run exists.
  'sync-plan': { module: 'plan-sync.mjs', flags: ['plan'] },
  // The model and effort of an agent call, resolved once by the engine so a
  // fan-out copies the value. `--state` is optional: a skill run outside any
  // run reads the project's config.yml instead, with no workflow or node scope.
  'dispatch-model': { module: 'dispatch-model.mjs', flags: ['state', 'agent', 'node', 'tier', 'host'] },
  // What one verification cycle reviews, measured once. `--state` in a run,
  // `--task-path` with `--base` outside one; `--base` also stands in for the
  // base commit a run frozen before it was recorded lacks. The re-check pair
  // and `--refresh` are the cycle's other two moments.
  'review-brief': { module: 'review-brief.mjs', flags: ['state', 'task-path', 'base', 'cycle', 'recheck', 'fixed-issues', 'refresh'] },
  // The cycle's reviewer findings merged into the run's one numbered list.
  'findings-merge': { module: 'findings-merge.mjs', flags: ['state', 'task-path', 'cycle'] },
  // A runner's two ends: its result, written by the runner through the one
  // place a patch is read from, and the node's next step, read from the run.
  // `--node` because the node is the one state records as running, and both
  // check it is; `--runner` names the loop, verification's or
  // implementation's; `--answered` says the node has just recorded the
  // answers to the decision the runner returned.
  'runner-result': { module: 'runner.mjs', flags: ['state', 'node', 'runner', 'patch-file'] },
  'runner-step': { module: 'runner.mjs', flags: ['state', 'node', 'runner', 'answered'] },
};

/** This plugin's root, three levels above this file: what the edition check locates. */
const PLUGIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The section that governs each moment a verb briefs or refuses, as
 * `<file> § <heading>`. A caller that reads the brief, or recovers from the
 * refusal, is told where its rules live instead of carrying them all in mind;
 * for a refusal the section is the one holding its recovery. The heading is a
 * heading's exact text, so the pointer is followed by a search, not a guess.
 *
 * Each file is named relative to the engine skill's directory rather than to
 * its `references/`, so a pointer can name the skill's own `SKILL.md` as well
 * as a reference; every reference pointer still prints the path it always did.
 *
 * `nodeBrief` is the one pointer that is not the last stdout paragraph:
 * `node-brief` prints it as a line of its header, before the node's section,
 * so the section a model reads last stays the node's own.
 */
const RULES = {
  gateBrief: ['references/gates.md', 'Before every gate — the gate brief'],
  gateRevise: ['references/gates.md', 'Revising at a gate'],
  areaBrief: ['references/in-node-questions.md', 'Decision areas from the brainstorm'],
  findingBrief: ['references/in-node-questions.md', 'Findings that need a decision'],
  writeRefused: ['references/writing-state.md', 'When a write is refused'],
  completeRefused: ['references/writing-state.md', 'When `run-complete` refuses'],
  nodeBrief: ['SKILL.md', 'Node conventions'],
};

/** One pointer's value: the file's absolute path, then `§` and the heading. */
function rulesOf(moment) {
  const [file, heading] = RULES[moment];
  return `${path.join(PLUGIN_ROOT, 'skills/workflow-engine', file)} § ${heading}`;
}

/**
 * The pointer as a text form's last stdout paragraph: after the renderer's
 * own bytes, so a brief's budget covers the brief alone, never this line.
 */
function printRules(moment) {
  process.stdout.write(`\nrules: ${rulesOf(moment)}\n`);
}

/** The pointer as a refusal's stderr line: after its message, before any `warning:` line. */
function refuseRules(moment) {
  process.stderr.write(`rules: ${rulesOf(moment)}\n`);
}

/** The flags that may be given more than once; every other flag is single-valued. */
const REPEATABLE = new Set(['overlay', 'area', 'from']);

/**
 * The picker profiles `gate-brief --json` renders: `rich` for a tool that shows
 * option descriptions and previews, `plain` for one that takes labels only.
 */
const PICKERS = ['rich', 'plain'];

/** The flags that take no value: present means true. Every other flag needs one. */
const BOOLEAN = new Set(['oneline', 'json', 'checkpoint', 'request', 'background', 'refresh', 'answered']);

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
/** Whether `lib/<name>` ships in this edition of the plugin. */
function moduleAvailable(name) {
  return fs.existsSync(fileURLToPath(new URL(`./lib/${name}`, import.meta.url)));
}

/** The one message a driven run reads when it cannot suspend at a gate. */
const GATE_REQUEST_UNAVAILABLE = 'gate-request-unavailable: this edition of the plugin carries no gate module, so a driven run cannot suspend at a gate. Stop with RUN-FAILED: gate-request-unavailable; never ask in session and never take a default answer.';

async function loadModule(name) {
  const specifier = new URL(`./lib/${name}`, import.meta.url);
  // Resolved through `fileURLToPath` rather than `url.pathname`, which on
  // Windows yields a leading-slash path no `fs` call can stat.
  if (!fs.existsSync(fileURLToPath(specifier))) {
    throw new Error(`the module lib/${name} is not included in this edition of the plugin, so the verb cannot run`);
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
  // The subagents blocks a run of these files would read — the project's
  // config.yml, each overlay and every profile — judged here rather than in
  // the graph pass: none of it is graph data, and none of it stops a run, so
  // every finding is a warning, a refused block included.
  const subagents = await loadModule('subagents.mjs');
  const warnings = entryOf(subagents, 'subagentsWarnings', 'subagents.mjs')({
    project: entryOf(module, 'projectRoot', VERBS.validate.module)(),
    overlays: sources.overlays,
  });
  result.warnings.push(...warnings);
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
  if (flags.host !== undefined) {
    const subagents = await loadModule('subagents.mjs');
    if (!subagents.HOSTS.includes(flags.host)) throw new UsageError(`--host is claude or copilot, not "${flags.host}"`);
  }
  const module = await loadModule(VERBS['write-state'].module);
  const write = entryOf(module, 'writeState', VERBS['write-state'].module);
  // The verb that freezes a run and carries every write after it, so refusing
  // here refuses both a start and a resume — including a driven one, where the
  // session-start warning is never read. Before stdin, so nothing is written.
  if (refusedForEditions(module, flags)) return EXIT.REJECTED;
  const input = await readInput(flags, 'the patch');
  const result = write({ state: flags.state, patch: input.document, host: flags.host ?? null });
  return reportWrite(result, input, 'writeRefused');
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
  const input = await readInput(flags, 'the revise note');
  const module = await loadModule(VERBS['gate-revise'].module);
  const revise = entryOf(module, 'gateRevise', VERBS['gate-revise'].module);
  const result = revise({ state: flags.state, node: flags.node, option: flags.option, input: input.document });
  const code = reportWrite(result, input, 'gateRevise');
  if (result.ok && result.revision) {
    const { gate, reruns, revision, ceiling, reset } = result.revision;
    process.stdout.write(`\nrevised: ${gate} reruns=${reruns} revision=${revision}/${ceiling} reset=${reset.join(',')}\n`);
    printRules('gateRevise');
  }
  return code;
}

/**
 * The report every state write shares: changed paths, then its notes and
 * warnings, then the exit code. `rules` names the moment whose section a
 * refusal points at.
 */
function reportWrite(result, input, rules) {
  // The freeze's startup banner comes first, then a blank line, then the changed
  // paths: a banner after some forty paths sat in a collapsed tool result where
  // nobody read it. A caller after the paths skips to the first blank line.
  if (result.banner) process.stdout.write(`${result.banner}\n`);
  for (const changed of result.changed || []) process.stdout.write(`${changed}\n`);
  // The classing write's remainder, after a blank line as a revise's line is:
  // the question ids the node still asks, or `none` when the writer settled
  // every one. Only a write that sent a question set has one.
  if (result.ok && Array.isArray(result.asking)) {
    process.stdout.write(`\nask: ${result.asking.length ? result.asking.join(' ') : 'none'}\n`);
  }
  // The HTML companions the nodes this write completed owe and did not write,
  // after a blank line, one per line. On stdout and never stderr: the write
  // landed, and the line asks for a file, not for a different write.
  if (result.ok && Array.isArray(result.companionMissing) && result.companionMissing.length) {
    process.stdout.write('\n');
    for (const { node, path: file } of result.companionMissing) process.stdout.write(`companion-missing: ${node} ${file}\n`);
  }
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
  // `policy_hash` is the writer's as well, and no clock fills it either.
  const policyHash = (result.ignored || []).filter(field => field === 'orchestrator.policy_hash');
  const clocked = (result.ignored || []).filter(field => !owned.includes(field) && !policyHash.includes(field));
  if (clocked.length) {
    process.stderr.write(`note: ignored the supplied ${clocked.join(', ')}; the writer stamps these from its own clock\n`);
  }
  if (owned.length) {
    process.stderr.write(`note: ignored the supplied ${owned.join(', ')}; the freeze records reruns and a revise counts attempts,`
      + ' so no patch sets either\n');
  }
  if (policyHash.length) {
    process.stderr.write('note: ignored the supplied orchestrator.policy_hash; the freeze records it from the policy it applied,'
      + ' so no patch sets it\n');
  }
  // A writer-owned value dropped for a reason of its own: the writer returns
  // the sentence, and it is printed here as written.
  for (const note of result.notes || []) process.stderr.write(`note: ${note}\n`);
  // The autonomy policy's own warnings and the skip-guard rule's, each a code
  // string: a refused policy file leaves the run on the built-in default, and a
  // gate recorded skipped that the rule asks is written as sent, so each is a
  // warning and never a refusal, and the exit code does not move.
  for (const code of result.writeWarnings || []) process.stderr.write(`warning: ${code}\n`);
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
  refuseRules(rules);
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
  const input = await readInput(flags, 'the request document');
  // A gate its guard skips is refused before anything else, in every edition:
  // the skip is the write a run makes there, never a suspension. Nothing is
  // written and the request file is kept.
  const briefing = await loadModule(VERBS['gate-brief'].module);
  const skipped = entryOf(briefing, 'requestGuardRefusal', VERBS['gate-brief'].module)({
    state: flags.state,
    node: input.document !== null && typeof input.document === 'object' ? input.document.node : undefined,
  });
  if (skipped) {
    for (const reason of skipped.errors) process.stderr.write(`${reason.message}\n`);
    return EXIT.REJECTED;
  }
  // An edition without the gate module cannot suspend a run at all. That is
  // answered by name rather than as the internal failure a missing import
  // otherwise is, because a driven run reaching it has one right response and
  // workers left to infer it chose differently: stop, never ask in session and
  // never take a default. Nothing is written and the patch file is kept.
  if (!moduleAvailable(VERBS['gate-request'].module)) {
    process.stderr.write(`${GATE_REQUEST_UNAVAILABLE}\n`);
    return EXIT.REJECTED;
  }
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
 * read. Without one, stdin is read to its end but never waited on for ever: a
 * terminal is refused unread, and a pipe silent for `STDIN_IDLE_MS` without
 * ending is refused (`lib/stdin.mjs` at the plugin root).
 */
async function readInput(flags, what) {
  if (flags['patch-file'] === undefined) {
    let read;
    try {
      read = await readStdin();
    } catch (err) {
      throw new UsageError(`${what} could not be read from stdin: ${err.message}`);
    }
    const routes = `Send it by here-string (<<< '<json>') or name it with --patch-file=<run>/${PATCH_FILE}`;
    if (read.refused === 'tty') throw new UsageError(`${what} was not given: stdin is a terminal. ${routes}`);
    if (read.refused === 'idle') {
      throw new UsageError(`${what} on stdin never ended (${read.bytes} bytes received, no end of input within`
        + ` ${STDIN_IDLE_MS} ms), so nothing was written. ${routes}`);
    }
    return { document: parseDocument(read.text, `${what} on stdin`), file: null };
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
function patchFileOf(flags, { absentOk = false } = {}) {
  return anchoredFile({
    given: flags['patch-file'],
    expected: path.join(path.dirname(path.resolve(flags.state)), PATCH_FILE),
    noun: 'the patch file',
    beside: 'beside the state file it patches',
    Usage: UsageError,
    absentOk,
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
 * on disk, then one `missing-companion:` line per owed HTML companion not on
 * disk, then a stopped run's notice — go above the marker, never below it.
 * A warning goes to stderr, opening with `warning:`, and moves no exit code.
 */
async function runRunComplete(flags) {
  if (!flags.state) throw new UsageError('run-complete needs --state');
  const module = await loadModule(VERBS['run-complete'].module);
  const judge = entryOf(module, 'runComplete', VERBS['run-complete'].module);
  const result = judge({ state: flags.state, outbox: flags.outbox, dispatch_id: flags['dispatch-id'] });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    // A failed run's `run-failed` is its ending, echoed as it is, so there is
    // no recovery to point at; every other `ok: false` is a refusal.
    if (!(result.errors || []).some(reason => reason.code === 'run-failed')) refuseRules('completeRefused');
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
  if (flags.node === '') throw new UsageError('prior-context --node needs a node id');
  const node = typeof flags.node === 'string' ? flags.node : null;
  const result = render({ state: flags.state, background: flags.background === true, node });
  return reportContext(result);
}

/**
 * Print the run-scoped context a delegate prompt carries. Reported like
 * `prior-context`: stdout is the bytes a caller pastes, a refusal is exit 1
 * with an empty stdout and the code first on stderr, and a warning goes to
 * stderr beside a block that still printed.
 */
async function runRunContext(flags) {
  if (!flags.state) throw new UsageError('run-context needs --state');
  if (!flags.node) throw new UsageError('run-context needs --node');
  const module = await loadModule(VERBS['run-context'].module);
  const render = entryOf(module, 'runContext', VERBS['run-context'].module);
  return reportContext(render({ state: flags.state, node: flags.node }));
}

/**
 * Print the brief a node reads before it runs. Reported like `run-context`;
 * the `rules:` pointer is passed in and printed by the module inside the
 * brief, so `reportContext` adds none of its own.
 */
async function runNodeBrief(flags) {
  if (!flags.state) throw new UsageError('node-brief needs --state');
  if (!flags.node) throw new UsageError('node-brief needs --node');
  const module = await loadModule(VERBS['node-brief'].module);
  const render = entryOf(module, 'nodeBrief', VERBS['node-brief'].module);
  return reportContext(render({ state: flags.state, node: flags.node, rules: rulesOf('nodeBrief') }));
}

/** The shared report of the three context verbs. */
function reportContext(result) {
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    return EXIT.REJECTED;
  }
  process.stdout.write(result.text);
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
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
  // A re-ask is a driven request asked again, so it shapes that form alone.
  if (flags.reask !== undefined && form !== 'request') {
    throw new UsageError('gate-brief takes --reask only with --request: it opens a driven request asked again');
  }
  // A question set is carried to a driver, never to an in-session picker, so
  // it renders as the checkpoint or the request and nothing else. The file is
  // read and kept: the request printed here is what the caller writes over it.
  let questions;
  if (flags['patch-file'] !== undefined) {
    if (form !== 'checkpoint' && form !== 'request') {
      throw new UsageError('gate-brief takes --patch-file only with --request or --checkpoint: a question set is carried to a driver, never rendered as a picker');
    }
    // A set asked again in a node's new attempt is asked as in its first:
    // nothing was missing from the earlier answer, so there is no revise to name.
    if (flags.reask !== undefined) {
      throw new UsageError('gate-brief takes --reask or --patch-file, not both: --reask asks a gate again for the note its revise lacked, and a question set asked again in a new attempt takes --patch-file alone');
    }
    questions = parseDocument(readFileText(patchFileOf(flags), 'the question set', UsageError), 'the question set in the patch file');
  }
  const module = await loadModule(VERBS['gate-brief'].module);
  const render = entryOf(module, 'gateBrief', VERBS['gate-brief'].module);
  const result = render({ state: flags.state, node: flags.node, form, picker, reask: flags.reask, questions });
  // A refusal's code comes first on stderr, and a drift warning is kept after
  // it: a drifted run that also lacks a summary must still say it drifted.
  if (!result.ok) for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  // Only the plain text is read by the asking session; the driven forms are
  // closed documents a driver or a panel reads, so they point at nothing.
  if (!result.ok && form === 'plain') refuseRules('gateBrief');
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning.message ?? warning}\n`);
  if (result.ok && result.panel) await publishPanel(flags.state, result.panel);
  const warnings = (result.warnings || []).map(warning => warning.message ?? warning);
  if (form === 'json') {
    // The picker as data, so nothing is parsed out of prose: a refusal is the
    // same JSON with `ok: false`, beside the stderr lines above.
    report(result.ok
      ? { ok: true, ...result.picker, more_details: result.more_details, errors: [], warnings, rules: rulesOf('gateBrief') }
      : { ok: false, errors: result.errors, warnings, rules: rulesOf('gateBrief') });
    return result.ok ? EXIT.OK : EXIT.REJECTED;
  }
  if (!result.ok) return EXIT.REJECTED;
  // The checkpoint and the request are documents, printed whole and nothing
  // else, so a caller can write stdout to a file as it stands.
  if (form === 'checkpoint') process.stdout.write(`${JSON.stringify(result.checkpoint, null, 2)}\n`);
  else if (form === 'request') process.stdout.write(`${JSON.stringify(result.request, null, 2)}\n`);
  else if (form === 'oneline') process.stdout.write(result.text);
  else {
    process.stdout.write(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
    printRules('gateBrief');
  }
  return EXIT.OK;
}

/** The forms `gate-brief` renders besides its plain text, one at a time. */
const GATE_BRIEF_FORMS = ['oneline', 'json', 'checkpoint', 'request'];

/**
 * Print one decision area for the convergence node asking it.
 *
 * Reported like `gate-brief`: under `--json` the whole result on stdout, a
 * refusal included; otherwise stdout is what a caller pastes and a refusal is
 * exit 1 with an empty stdout and the code first on stderr. A file the verb
 * cannot use is a `warning:` line on stderr and exit 0 with nothing to paste —
 * `{ok: true, fallback: true}` under `--json` — so the node composes the area
 * itself. Writes no state and no panel.
 */
async function runAreaBrief(flags) {
  if (!flags.state) throw new UsageError('area-brief needs --state');
  if (!flags.node) throw new UsageError('area-brief needs --node');
  const areas = flags.area || [];
  const set = flags['patch-file'] !== undefined;
  if (set && flags.json === true) {
    throw new UsageError('area-brief takes --json or --patch-file, not both: --json is the in-session picker, --patch-file the driven question set');
  }
  const form = set ? 'set' : flags.json === true ? 'picker' : 'write-up';
  if (flags.picker !== undefined && form !== 'picker') {
    throw new UsageError('area-brief takes --picker only with --json: it shapes the in-session picker');
  }
  const picker = flags.picker ?? 'rich';
  if (!PICKERS.includes(picker)) {
    throw new UsageError(`area-brief --picker takes ${PICKERS.join(' or ')}, not "${picker}"`);
  }
  if (form !== 'set' && areas.length !== 1) {
    throw new UsageError(`area-brief ${form === 'picker' ? '--json' : 'without --json or --patch-file'} takes exactly one --area, not ${areas.length}: `
      + 'one area is asked, or shown in full, at a time');
  }
  // The set is the verb's own write, so nothing need be there yet; what is
  // there must still be the one patch file, never a link or a directory.
  const patchFile = set ? patchFileOf(flags, { absentOk: true }) : null;
  const module = await loadModule(VERBS['area-brief'].module);
  const render = entryOf(module, 'areaBrief', VERBS['area-brief'].module);
  const result = render({ state: flags.state, node: flags.node, areas, form, picker, patchFile });
  if (!result.ok) for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  if (!result.ok && form !== 'picker') refuseRules('areaBrief');
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
  if (form === 'picker') {
    // The key rides on a fallback too: the node then composes the area
    // itself, and the section says how.
    report(result.ok
      ? { ...result, rules: rulesOf('areaBrief') }
      : { ok: false, errors: result.errors, warnings: result.warnings || [], rules: rulesOf('areaBrief') });
    return result.ok ? EXIT.OK : EXIT.REJECTED;
  }
  if (!result.ok) return EXIT.REJECTED;
  // A text-form fallback has nothing to paste, so nothing to point from.
  if (result.fallback) return EXIT.OK;
  if (form === 'set') process.stdout.write(`${result.file}\n`);
  else process.stdout.write(`${result.text}\n`);
  printRules('areaBrief');
  return EXIT.OK;
}

/**
 * Print a reviewer's findings as the reviewing node's question set.
 *
 * Reported like `area-brief`'s set form: a refusal is exit 1 with an empty
 * stdout and the code first on stderr; a findings list the verb cannot use is
 * a `warning:` line on stderr and exit 0 with nothing to paste. Otherwise the
 * set is printed as JSON, or, with `--patch-file`, written there and the
 * file's path printed. Writes no state and no panel.
 */
async function runFindingBrief(flags) {
  if (!flags.state) throw new UsageError('finding-brief needs --state');
  if (!flags.node) throw new UsageError('finding-brief needs --node');
  if (typeof flags['findings-file'] !== 'string' || flags['findings-file'] === '') {
    throw new UsageError('finding-brief needs --findings-file: the reviewer\'s findings list, inside the run directory');
  }
  // The set is the verb's own write, so nothing need be there yet.
  const patchFile = flags['patch-file'] !== undefined ? patchFileOf(flags, { absentOk: true }) : null;
  const module = await loadModule(VERBS['finding-brief'].module);
  const render = entryOf(module, 'findingBrief', VERBS['finding-brief'].module);
  const result = render({ state: flags.state, node: flags.node, findingsFile: flags['findings-file'], patchFile });
  if (!result.ok) for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  if (!result.ok) refuseRules('findingBrief');
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
  if (!result.ok) return EXIT.REJECTED;
  if (result.fallback) return EXIT.OK;
  // The bare set is JSON on stdout and carries no pointer, so stdout parses
  // as it stands. The patch-file form prints the file's path and then the
  // pointer, never writing it into the file: the file holds the set alone.
  if (patchFile === null) {
    process.stdout.write(`${JSON.stringify(result.set, null, 2)}\n`);
    return EXIT.OK;
  }
  process.stdout.write(`${result.file}\n`);
  printRules('findingBrief');
  return EXIT.OK;
}

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

/** The entry file's one name, beside the plan: `group-done --entry-file` reads it from nowhere else. */
const ENTRY_FILE = '.work-log-entry.md';

/**
 * `wave-start` and `group-done` report like `sync-plan`: the result as JSON on
 * stdout, each warning as a `warning:` line on stderr, a refusal's message on
 * stderr with its code first and exit 1. `group-done` deletes its entry file
 * once the entry is in the log, and keeps it on a refusal.
 */
async function runWaveStart(flags) {
  if (!flags.plan) throw new UsageError('wave-start needs --plan');
  if (!/^[1-9]\d*$/.test(flags.wave ?? '')) throw new UsageError('wave-start needs --wave, the wave\'s number');
  const module = await loadModule(VERBS['wave-start'].module);
  const start = entryOf(module, 'waveStart', VERBS['wave-start'].module);
  return reportProgress(start({ plan: flags.plan, wave: Number(flags.wave), groups: groupsOf(flags, 'wave-start') }));
}

async function runGroupDone(flags) {
  if (!flags.plan) throw new UsageError('group-done needs --plan');
  const groups = groupsOf(flags, 'group-done');
  if (!flags['entry-file']) throw new UsageError(`group-done needs --entry-file, naming the entry written to ${ENTRY_FILE} beside the plan`);
  const file = anchoredFile({
    given: flags['entry-file'],
    expected: path.join(path.dirname(path.resolve(flags.plan)), ENTRY_FILE),
    noun: 'the entry file',
    beside: 'beside the plan it records',
    Usage: UsageError,
  });
  const entry = readFileText(file, 'the work-log entry', UsageError);
  const module = await loadModule(VERBS['group-done'].module);
  const done = entryOf(module, 'groupDone', VERBS['group-done'].module);
  const code = reportProgress(done({ plan: flags.plan, groups, entry }));
  if (code === EXIT.OK) consumeFile(file);
  return code;
}

/** `--groups=3` or `--groups=2,3`: group numbers as the plan writes them. */
function groupsOf(flags, verb) {
  const list = String(flags.groups ?? '').replace(/\s+/g, '');
  if (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(list)) throw new UsageError(`${verb} needs --groups, the group numbers separated by commas`);
  return [...new Set(list.split(','))];
}

function reportProgress(result) {
  const { warnings = [], ...rest } = result;
  report(rest);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
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
 * A warning goes to stderr, opening with `warning:`, and stays out of the JSON.
 */
async function runResumeCheck(flags) {
  if (!flags.state) throw new UsageError('resume-check needs --state');
  const module = await loadModule(VERBS['resume-check'].module);
  const check = entryOf(module, 'resumeCheck', VERBS['resume-check'].module);
  const { warnings = [], ...result } = check({ state: flags.state });
  report(result);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

/**
 * `subrun-path` reports like `resume-check`: the whole result as JSON on stdout,
 * exit 1 on a refusal, and a drifted definition as a `warning:` line on stderr.
 */
async function runSubrunPath(flags) {
  if (!flags.state) throw new UsageError('subrun-path needs --state');
  if (!flags.node) throw new UsageError('subrun-path needs --node');
  const module = await loadModule(VERBS['subrun-path'].module);
  const locate = entryOf(module, 'subrunPath', VERBS['subrun-path'].module);
  const { warnings = [], ...result } = locate({ state: flags.state, node: flags.node });
  report(result);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

/**
 * `import` reports like `subrun-path`: the whole result as JSON on stdout, exit
 * 1 on a refusal or when any source was not copied. One source is all `--as`
 * can rename, and a name, never a path: anything else is a usage error.
 */
async function runImport(flags) {
  if (!flags.state) throw new UsageError('import needs --state');
  if (!flags.to) throw new UsageError('import needs --to');
  if (!(flags.from || []).length) throw new UsageError('import needs at least one --from');
  if (flags.as !== undefined) {
    if (flags.from.length !== 1) throw new UsageError('import takes --as with exactly one --from');
    if (/[\\/]/.test(flags.as) || flags.as === '.' || flags.as === '..') {
      throw new UsageError('import takes --as as a file or folder name, not a path');
    }
  }
  const module = await loadModule(VERBS.import.module);
  const copy = entryOf(module, 'importContext', VERBS.import.module);
  const result = copy({ state: flags.state, to: flags.to, from: flags.from, as: flags.as ?? null });
  report(result);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

/**
 * `dispatch-model` reports like `node-brief`: the text on stdout, a refusal on
 * stderr with its code first at exit 1, and a finding about the project's
 * config.yml as one `warning:` line each, exit 0.
 */
async function runDispatchModel(flags) {
  if (!flags.host) throw new UsageError('dispatch-model needs --host=claude or --host=copilot');
  const module = await loadModule(VERBS['dispatch-model'].module);
  const subagents = await loadModule('subagents.mjs');
  if (!subagents.HOSTS.includes(flags.host)) throw new UsageError(`--host is claude or copilot, not "${flags.host}"`);
  const agents = String(flags.agent ?? '').split(',').map(each => each.trim()).filter(Boolean);
  if (!agents.length) throw new UsageError('dispatch-model needs --agent, one name or several joined by commas');
  if (flags.tier !== undefined && !subagents.LADDER.includes(flags.tier)) {
    throw new UsageError(`--tier is ${subagents.LADDER.slice(0, -1).join(', ')} or ${subagents.LADDER.at(-1)}, not "${flags.tier}"`);
  }
  if (flags.node && !flags.state) throw new UsageError('dispatch-model takes --node only with --state: outside a run there is no node to scope by');
  const resolve = entryOf(module, 'dispatchModel', VERBS['dispatch-model'].module);
  const result = resolve({ state: flags.state ?? null, agents, node: flags.node ?? null, tier: flags.tier ?? null, host: flags.host });
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`${error.message}\n`);
    return EXIT.REJECTED;
  }
  process.stdout.write(result.text);
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
  return EXIT.OK;
}

/**
 * `review-brief` reports like `finding-brief --patch-file`: the written
 * file's path on stdout, a refusal on stderr with its code first at exit 1,
 * and each part it could not fill as one `warning:` line, exit 0.
 */
async function runReviewBrief(flags) {
  const where = runFlags(flags, 'review-brief');
  if (flags['task-path'] !== undefined && flags.base === undefined) {
    throw new UsageError('review-brief --task-path needs --base, the commit the work started from: outside a run there is no recorded base');
  }
  const cycle = cycleOf(flags, 'review-brief');
  const recheck = flags.recheck ?? null;
  const fixedIssues = flags['fixed-issues'] === undefined ? [] : idsOf(flags['fixed-issues']);
  if (recheck !== null && !['tests-only', 'reviews'].includes(recheck)) {
    throw new UsageError(`--recheck is tests-only or reviews, not "${recheck}"`);
  }
  if ((recheck === null) !== (flags['fixed-issues'] === undefined)) {
    throw new UsageError('review-brief takes --recheck and --fixed-issues together: the kind of re-check and the issue numbers it re-checks');
  }
  if (flags.refresh && (recheck !== null || flags.base !== undefined)) {
    throw new UsageError('review-brief --refresh re-reads the test result of an existing brief, and takes no --recheck, --fixed-issues or --base');
  }
  const module = await loadModule(VERBS['review-brief'].module);
  const build = entryOf(module, 'reviewBrief', VERBS['review-brief'].module);
  const result = build({ ...where, base: flags.base ?? null, cycle, recheck, fixedIssues, refresh: flags.refresh === true, pluginRoot: PLUGIN_ROOT });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    return EXIT.REJECTED;
  }
  process.stdout.write(`${result.file}\n`);
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
  return EXIT.OK;
}

/**
 * `findings-merge` reports like `resume-check`: the result as JSON on stdout,
 * a refusal's code first on stderr at exit 1, and each file or finding it
 * skipped as one `warning:` line, exit 0.
 */
async function runFindingsMerge(flags) {
  const where = runFlags(flags, 'findings-merge');
  const module = await loadModule(VERBS['findings-merge'].module);
  const merge = entryOf(module, 'findingsMerge', VERBS['findings-merge'].module);
  const { warnings = [], ...result } = merge({ ...where, cycle: cycleOf(flags, 'findings-merge') });
  report(result);
  if (!result.ok) for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  return result.ok ? EXIT.OK : EXIT.REJECTED;
}

/**
 * `runner-result` reports like `findings-merge`: the written result as JSON on
 * stdout, a refusal's code first on stderr at exit 1 with the patch file kept
 * for correcting, and the patch file deleted once the result landed.
 */
async function runRunnerResult(flags) {
  if (!flags.state) throw new UsageError('runner-result needs --state');
  if (!flags.node) throw new UsageError('runner-result needs --node: the node the runner ran for');
  const module = await loadModule(VERBS['runner-result'].module);
  const runner = runnerOf(flags, 'runner-result', module);
  const input = await readInput(flags, 'the runner result');
  const write = entryOf(module, 'runnerResult', VERBS['runner-result'].module);
  const result = write({ state: flags.state, node: flags.node, document: input.document, runner });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    return EXIT.REJECTED;
  }
  if (input.file) consumeFile(input.file);
  process.stdout.write(`${JSON.stringify(result.result, null, 2)}\n`);
  return EXIT.OK;
}

/**
 * `runner-step` prints the node's next step as one JSON object; a refusal's
 * code first on stderr at exit 1, and each file it could not use as one
 * `warning:` line, exit 0.
 */
async function runRunnerStep(flags) {
  if (!flags.state) throw new UsageError('runner-step needs --state');
  if (!flags.node) throw new UsageError('runner-step needs --node: the node that is running the loop');
  const module = await loadModule(VERBS['runner-step'].module);
  const runner = runnerOf(flags, 'runner-step', module);
  const step = entryOf(module, 'runnerStep', VERBS['runner-step'].module);
  const result = step({ state: flags.state, node: flags.node, answered: flags.answered === true, runner });
  if (!result.ok) {
    for (const reason of result.errors || []) process.stderr.write(`${reason.message ?? reason}\n`);
    return EXIT.REJECTED;
  }
  process.stdout.write(`${JSON.stringify(result.step)}\n`);
  for (const warning of result.warnings || []) process.stderr.write(`warning: ${warning}\n`);
  return EXIT.OK;
}

/** The loop `--runner` names, verification's when it is absent. */
function runnerOf(flags, verb, module) {
  if (flags.runner === undefined) return 'verification';
  if (typeof flags.runner !== 'string' || !module.RUNNERS.includes(flags.runner)) {
    throw new UsageError(`${verb} --runner must be one of ${module.RUNNERS.join(', ')}`);
  }
  return flags.runner;
}

/** `--state` in a run or `--task-path` outside one: exactly one of them. */
function runFlags(flags, verb) {
  if ((flags.state === undefined) === (flags['task-path'] === undefined)) {
    throw new UsageError(`${verb} needs --state (the run's orchestrator-state.yml) or --task-path (a task directory outside a run), one of them`);
  }
  return flags.state !== undefined ? { state: flags.state, taskPath: null } : { state: null, taskPath: flags['task-path'] };
}

function cycleOf(flags, verb) {
  if (flags.cycle === undefined) return null;
  if (!/^[1-9]\d*$/.test(flags.cycle)) throw new UsageError(`${verb} takes --cycle as a cycle number, 1 or more`);
  return Number(flags.cycle);
}

/** `--fixed-issues=3,7`: issue numbers as the merged findings number them. */
function idsOf(value) {
  const list = String(value).replace(/\s+/g, '');
  if (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(list)) throw new UsageError('--fixed-issues takes issue numbers separated by commas');
  return [...new Set(list.split(',').map(Number))];
}

const RUNNERS = {
  validate: runValidate,
  resolve: runResolve,
  diagram: runDiagram,
  locate: runLocate,
  'wave-start': runWaveStart,
  'group-done': runGroupDone,
  'write-state': runWriteState,
  'gate-request': runGateRequest,
  'gate-revise': runGateRevise,
  'run-complete': runRunComplete,
  'prior-context': runPriorContext,
  'run-context': runRunContext,
  'node-brief': runNodeBrief,
  'gate-brief': runGateBrief,
  'area-brief': runAreaBrief,
  'finding-brief': runFindingBrief,
  'resume-check': runResumeCheck,
  'subrun-path': runSubrunPath,
  import: runImport,
  'sync-plan': runSyncPlan,
  'dispatch-model': runDispatchModel,
  'review-brief': runReviewBrief,
  'findings-merge': runFindingsMerge,
  'runner-result': runRunnerResult,
  'runner-step': runRunnerStep,
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
