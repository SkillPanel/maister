/**
 * The worker seed.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Nothing here writes:
 * a seed is built from a published envelope and rendered to a string, and the
 * caller decides what to do with it.
 *
 * ---------------------------------------------------------------------------
 * Why the seed is described before it is rendered
 * ---------------------------------------------------------------------------
 *
 * `buildSeed` produces a descriptor and `renderSeed` turns that descriptor into
 * the prompt. Two functions rather than one, and both pure functions of the
 * envelope, because the thing worth freezing is the *structure* — which
 * sections exist, in what order, and how long the whole may be — while the
 * wording has to stay free to improve. A descriptor can be checked and pinned;
 * a rendered paragraph cannot be without freezing its prose.
 *
 * What is frozen is therefore exactly three things: the five section ids, their
 * order, and the 60-line cap. Each section opens with a machine-readable marker
 * line — `# identity`, `# task`, `# outbox`, `# closeout`, `# siblings` — which
 * is what lets a test assert the structure survived rendering without asserting
 * a single word under it.
 *
 * ---------------------------------------------------------------------------
 * Why an over-long seed is refused and never truncated
 * ---------------------------------------------------------------------------
 *
 * The cap exists because a worker reads its seed before it reads anything else,
 * and a prompt that has grown past a page has stopped being a briefing. But
 * truncating to fit is the worst available answer: the sections at the end are
 * `closeout` and `siblings`, so a silent trim drops precisely the instructions
 * that say how the work is to be reported and that a sibling's repository is
 * never to be written. A seed that does not fit is a seed that is wrong, and it is
 * refused (`seed-over-cap`) so whoever wrote the over-long content fixes it.
 *
 * ---------------------------------------------------------------------------
 * What the worker is not told
 * ---------------------------------------------------------------------------
 *
 * No chain internals beyond the run id and the node reach the prompt. Not the
 * umbrella id, not the ledger, not the sibling node ids, not the graph hash and
 * not the state file. A worker coordinates through its outbox and nothing else,
 * and naming the machinery would invite it to reach for the machinery.
 *
 * ---------------------------------------------------------------------------
 * Why every path in the prompt is anchored
 * ---------------------------------------------------------------------------
 *
 * A worker's working directory is a checkout inside a member repository, and in
 * the workspace this runtime was built for that checkout is reached through a
 * symlink to a repository that lives outside the workspace altogether. So a
 * workspace-relative path resolved from the worker's own cwd does not land in
 * the workspace: it lands in the member repo, which is the one place the
 * write-scope invariant says the outbox must never be. The envelope's
 * `workspace_root` is what closes that, and when an envelope carries one every
 * path this module states is absolute. When it does not, the prompt says what
 * the paths are relative to rather than pretending they resolve from anywhere.
 *
 * The refusal set is closed: `seed-envelope-invalid` and `seed-over-cap`. Each
 * is documented with its recovery in `SKILL.md`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Refusal } from './canonical.mjs';
import { readDefinition } from './definition.mjs';
import { closeoutReachable, pathLike, siblingsProblem } from './envelope.mjs';
import { ASK_LEVELS, bareWorkflowName, TARGET_NAME } from '../../../workflow-engine/scripts/lib/umbrella-facade.mjs';

/** The format version a seed descriptor declares. */
const VERSION = 1;

/** The five section ids, in the frozen order. Exported so a test names them once. */
export const SEED_SECTIONS = Object.freeze(['identity', 'task', 'outbox', 'closeout', 'siblings']);

/** The rendered line cap. */
export const SEED_LINE_CAP = 60;

/**
 * How the worker runs its commands, said once on the tier line rather than on
 * a line of its own, so the cap does not move. A permission rule matches one
 * command, and a line joining several is offered only a dismissal.
 */
const ONE_COMMAND = 'Run one command per line, never several chained with `&&`, `;` or `|`: a permission rule matches a single command, and a chained line can only be dismissed. The one exception is the JSON a workflow-engine verb takes, sent as that skill documents.';

/**
 * How the read-only inputs are read, said on the inputs header line. A copy
 * into the checkout is a write outside the grant and is refused; a worker that
 * needs the content in its own tree writes its own file from what it read.
 */
const IN_PLACE = 'Read each where it is, never copying it into your checkout; if you need its content in your own tree, write your own file from what you read.';

/** The `with:` keys the envelope reads as control rather than as arguments. */
// `closeout_contract` joins them for the same reason the other three are here:
// it travels in `with:` but is a directive to the dispatch runtime, not an
// argument to the definition. It is already read into the envelope's own
// close-out contract, which is what `# closeout` renders from, so leaving it in
// this set produced a second, useless line - `closeout_contract = 1 keys` -
// telling a worker to bind a value no definition declares.
// `ceiling` is the autonomy ceiling, read into the envelope's own `ceiling`
// and stated in `# task` by a line of its own.
const CONTROL_ARGS = new Set(['autonomy', 'statement', 'task', 'closeout_contract', 'ceiling']);

/** The input role a triage's research report carries into a dispatch. */
const RESEARCH_ROLE = 'research';

/** The one file the outbox verb reads a message body from, in the dispatch's directory. */
const INPUT_FILE = '.umbrella-input.json';

/** The message types, named here because the outbox section teaches them. */
const MESSAGE_TYPES = ['status', 'followup', 'artifact', 'closeout', 'blocked'];

/**
 * The exec form of the runtime the outbox instruction names, resolved against a
 * plugin root the caller supplies.
 *
 * It used to be the literal string `${CLAUDE_PLUGIN_ROOT}/skills/…`, on the
 * reasoning that the host's own root variable makes one seed correct under
 * every install. The first live worker ever dispatched disproved it on its very
 * first tool call: `CLAUDE_PLUGIN_ROOT` is exported to hook, MCP and LSP
 * subprocesses, **not** into the shell the model runs commands in, and it is
 * interpolated into *skill content* — never into a headless prompt. A seed is
 * delivered as a prompt, so the placeholder arrives at the worker verbatim and
 * expands to the empty string, leaving `node /skills/umbrella/scripts/…`. Both
 * command lines the seed names — the only sanctioned way to write the outbox
 * and the only sanctioned way to suspend a gate — were unrunnable as written.
 *
 * So the path is rendered absolute, like every other path in the prompt. The
 * root is an argument rather than a constant so that a seed built with a pinned
 * root is reproducible, and the verb passes the root of the install it is
 * itself running out of.
 */
const script = root => `${root}/skills/umbrella/scripts/umbrella.mjs`;

/**
 * The engine script a dispatched worker suspends its own gates through. Named
 * here for the same reason the outbox verb is: the request file, the gate
 * index and the pending marker are a frozen shape, and a worker that
 * hand-writes them writes a question no reader matches. It is one call because
 * it cannot be two — the run is pending the moment the request file lands.
 */
const workflowScript = root => `${root}/skills/workflow-engine/scripts/workflow.mjs`;

/**
 * The engine's gate reference, which says how a resumed worker folds the
 * operator's answer into its own run: the answer block, the node's summary and
 * status, the marker cleared last, then the writer's re-validation. The seed
 * names it rather than restating it, and must not forbid it: a worker told
 * never to touch the gate files cannot record the answer it was woken with.
 */
const gatesReference = root => `${root}/skills/workflow-engine/references/gates.md`;

/**
 * The plugin install this runtime is executing out of, used when a caller names
 * no root: the module's own location, never a plugin-root variable. A seed
 * names the scripts a worker runs, and they must be the ones of this install —
 * a variable exported for one host reaches the other host's shell too, and a
 * stale one names an install that is not running. A caller that pins a root
 * passes `pluginRoot` to `buildSeed`.
 */
function defaultPluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

/** The autonomy and provider enums, checked before an envelope is trusted. */
const AUTONOMY = ['attended', 'auto-low', 'auto-medium', 'auto-high'];

/** The one tier whose denials an operator answers, so its close-out prose differs. */
const RELAYED = 'attended';
const PROVIDERS = ['claude', 'copilot'];

// ---------------------------------------------------------------------------
// the verb
// ---------------------------------------------------------------------------

/**
 * The `seed` verb: read a published envelope and render its prompt.
 *
 * `--siblings` arrives as text from the command line, so it is parsed here
 * rather than in the caller. An absent or unparsable count means the seed says
 * the worker is the only one dispatched, which is the safe reading: a worker
 * told it has peers coordinates, a worker told nothing does not.
 */
export function seed({ envelope, siblings = null }) {
  try {
    const read = readDefinition(envelope);
    if (read.doc === null) {
      throw new Refusal('seed-envelope-invalid',
        `the envelope at ${envelope} could not be read: ${read.errors.map((each) => each.message).join('; ')}`);
    }
    const descriptor = buildSeed(read.doc, { siblings: countOf(siblings) });
    const prompt = renderSeed(descriptor);
    return { ok: true, path: path.resolve(envelope), descriptor, prompt, lines: prompt.split('\n').length, errors: [] };
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    return { ok: false, errors: [{ code: err.code, message: err.message }] };
  }
}

function countOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

// ---------------------------------------------------------------------------
// the descriptor
// ---------------------------------------------------------------------------

/**
 * The seed descriptor for one envelope. Pure: the same envelope and the same
 * sibling count always give the same object, which is what makes it
 * reproducible.
 */
export function buildSeed(envelope, { siblings = null, pluginRoot = defaultPluginRoot() } = {}) {
  const document = assertEnvelope(envelope);
  const chain = mapOf(document.chain);
  const target = mapOf(document.target);
  const workflow = mapOf(document.workflow);
  const closeout = mapOf(document.closeout_contract);

  const lines = {
    identity: identityLines({ document, chain, target }),
    task: taskLines({ document, workflow, pluginRoot }),
    outbox: outboxLines(document, pluginRoot),
    closeout: closeoutLines({ closeout, autonomy: document.autonomy, permissions: document.permissions }),
    siblings: siblingLines(siblings, { listed: document.siblings, root: rootOf(document) }),
  };

  return {
    version: VERSION,
    dispatch_id: document.dispatch_id,
    cap: SEED_LINE_CAP,
    sections: SEED_SECTIONS.map((id) => ({ id, marker: `# ${id}`, lines: lines[id] })),
  };
}

/**
 * Who the worker is and where it stands. Run id and node, and nothing beyond.
 *
 * Every path is anchored: a worker's cwd is a checkout inside a member
 * repository, often reached through a symlink to a repository outside the
 * workspace, so a workspace-relative path resolved from that cwd lands in the
 * member repo. `anchor()` prefixes the envelope's `workspace_root` when the
 * envelope carries one, and the last line says which of the two the worker got.
 */
function identityLines({ document, chain, target }) {
  const root = rootOf(document);
  const checkout = anchor(root, target.path);
  const where = target.worktree
    ? anchor(root, joinPath(target.path, target.worktree))
    : checkout;
  return [
    `You are dispatch ${oneLine(document.dispatch_id)} of run ${oneLine(chain.run_id)}, node ${oneLine(chain.node)}.`,
    `Member ${oneLine(target.member)}, checked out at ${checkout}${target.worktree ? `, worktree ${where}` : ''}.`,
    root === null
      ? `Work in ${where}. The paths below are relative to the workspace root - the directory holding the member checkouts - and never to your own working directory.`
      : `Work in ${where}. Every path below is absolute; write nothing outside that directory except the outbox input file and through the outbox verb, both named below.`,
    document.autonomy === RELAYED
      // "Wait for that decision" was the wording here too, and it contradicts
      // what `# closeout` now says. A held command is not a pause a turn can
      // sit through; it is the end of the turn. Both sections have to say so,
      // or the worker picks whichever it read last.
      ? `Autonomy tier ${oneLine(document.autonomy)}; the permissions it grants are already in force, so a refused command is the tier and not a mistake. ${ONE_COMMAND} At this tier a denial is relayed to an operator rather than final: never route around a held command - report it and end the turn, as \`# closeout\` describes.`
      : `Autonomy tier ${oneLine(document.autonomy)}; the permissions it grants are already in force, so a refused command is the tier and not a mistake. ${ONE_COMMAND}`,
  ];
}

/**
 * What to run, and how a dispatched worker behaves while running it.
 *
 * There is no `--driver` flag on any workflow in this plugin: driver kind
 * travels in the worker's own run state at `orchestrator.driver.kind`, and the
 * gate rule keys on it. So the seed states the *behaviour* the worker owes —
 * record the kind, write the gate request, print the frozen marker, end the
 * turn — rather than a flag it could not pass to anything.
 *
 * The statement of the work is the envelope's `statement`, when the dispatching
 * node carried one. Absent it the seed still names the workflow and its
 * arguments, which is the whole of what the node said.
 *
 * The read-only inputs are anchored like every other path. A dispatching run
 * names them relative to the workspace root, and the worker's cwd is a member
 * checkout, where such a path either resolves to nothing or to a same-named
 * file in the member repository. So an input whose value is a relative path —
 * not absolute, and path-like by the envelope's own rule (`pathLike`: one
 * whitespace-free string holding a `/` and no `${…}`; a bare name such as
 * `context.md` is a value, and `./context.md` is its path) — is stated
 * under the envelope's `workspace_root`; an absolute one is stated as is, and
 * anything else — a plain word, a number, a boolean — is a value and is stated
 * as is. Without a `workspace_root` every input is stated as the run named it,
 * which is relative to the workspace root like the other paths then.
 */
/**
 * The definition a `workflow:` target names, bare, or `null` for every other
 * target. A `workflow:` target whose name is malformed also strips to `null`,
 * and `assertEnvelope` refuses that envelope before this is ever reached, so
 * the `null` here means "not a workflow target" and nothing else. The prefix
 * strip is the engine's own, so this prompt and the engine's lookup cannot
 * diverge on what the name is.
 */
function workflowTarget(uses) {
  if (typeof uses !== 'string' || !uses.startsWith('workflow:')) return null;
  return bareWorkflowName(uses.slice('workflow:'.length));
}

function taskLines({ document, workflow, pluginRoot }) {
  const lines = [];
  const stated = typeof document.statement === 'string' && document.statement.trim() !== '';
  if (stated) {
    lines.push(`The work: ${oneLine(document.statement)}`);
  }
  const definition = workflowTarget(workflow.uses);
  if (definition !== null) {
    // A `skill:` target hints at its tool by its scheme name; a `workflow:`
    // target hints at nothing, and the scheme prefix is chain grammar rather
    // than anything a worker can type. So the three facts a worker cannot infer
    // are stated: which skill runs a definition, the bare name to run it by,
    // and the order the name is looked up in — the last so that a member-side
    // ejection visibly wins rather than being shadowed by the shipped file.
    lines.push(`Run the \`${definition}\` workflow definition with the workflow-engine skill, invoked by that name - that skill is how a dispatched worker runs a definition; do not go looking for a command.`);
    lines.push(`Resolve \`${definition}\` by that bare name, first hit winning, in this order: \`.maister/workflows/${definition}.yml\` (an eject, which shadows the built-in entirely), then \`.maister/workflows/generated/${definition}.yml\` (a generated chain, complete in itself), then \`.maister/workflows/${definition}.overlay.yml\` (an overlay merged over the built-in), then the built-in shipped with the plugin.`);
    // Neutral about the input's *name* on purpose. The envelope's `statement`
    // is a generic free-text carrier of what the work is; each definition names
    // its own required text input — `plan` calls it `statement`, `development`
    // calls it `task_description`, `research` calls it `question` — and this
    // branch renders for every `workflow:` target. Naming one of them here
    // would be a false claim in the other cases, and the worker can read the
    // definition it is about to run.
    lines.push(stated
      ? `The line above beginning \`The work:\` is the free-text statement your dispatch carried, and it is the whole of what the work is. Bind it to whichever input the definition declares for that: the definition names the input, the dispatch does not.`
      : `Your dispatch carried no statement, so nothing here states the work beyond what is named above. If the definition requires a free-text input of it, send a blocked message rather than inventing one.`);
  } else {
    lines.push(workflow.uses
      ? `Run ${oneLine(workflow.uses)}.`
      : 'Run the workflow named by your dispatch.');
  }
  // The request is the gate-brief verb's output and nothing else: a request the
  // worker composed itself would carry only what the worker chose to put in it,
  // and a cockpit would lose the checkpoint every surface renders from.
  // A dispatched run records the cockpit kind: a run the cockpit drives
  // directly and one a worker runs for a dispatch differ only by the dispatch
  // they belong to, and the dispatch id is what makes the run a dispatched one
  // to the engine — its close-out owed to the outbox, no question sets. It also
  // tells apart dispatches into one member, which share its worktree: two runs
  // in one checkout differ by the dispatch each records, and by nothing else in
  // their state. No `features` are seeded: a dispatch worker has no form to show.
  lines.push(`You run as a dispatched run under the cockpit driver: record \`orchestrator.driver: {kind: cockpit, cwd: <the directory named above, absolute>, dispatch_id: ${oneLine(document.dispatch_id)}}\` in your run state, and nothing else in it - the cwd is required beside the kind, and a block carrying only the kind is an invalid state; the dispatch id is what makes your run a dispatched one and tells it apart from another dispatch working in the same checkout. At every gate suspend the run through the gate-request verb alone, never by hand-writing the request file, the gate index or the pending marker; on resume, apply the operator's answer exactly as the driver-suspended resume in ${gatesReference(pluginRoot)} says. The only source of the request is the engine's gate-brief verb:`);
  lines.push(`  node ${workflowScript(pluginRoot)} gate-brief --state=<your own orchestrator-state.yml> --node=<the gate's node id> --request`);
  lines.push('Write what it prints, unchanged, with your file tool to `.state-patch.json` beside that state file - never composed or edited by you, never through a heredoc or a pipe. Then make one call to the gate-request verb:');
  lines.push(`  node ${workflowScript(pluginRoot)} gate-request --state=<your own orchestrator-state.yml> --patch-file=<the .state-patch.json beside it>`);
  lines.push('It writes the request file, the gate index and the pending marker together; there is no second write and the run is already suspended once it returns. Then print `GATE-PENDING: ` followed by that gate\'s own node id as the last line of the turn, and stop. Never ask a question in session.');
  // The autonomy ceiling is recorded at the worker's own freeze, so its run
  // starts no wider than the dispatch allows; the engine keeps it from widening.
  if (document.ceiling !== undefined && document.ceiling !== null) {
    // The engine's ask levels, narrowest first; a value outside them renders as the first.
    const level = ASK_LEVELS.includes(document.ceiling) ? document.ceiling : ASK_LEVELS[0];
    lines.push(`Record \`orchestrator.options.ceiling: ${level}\` in your freeze patch, beside the driver: it is the autonomy ceiling your dispatch carries; the run may lower it later, never raise it.`);
  }
  // Carrier sentence (kept byte-identical for the lockstep-by-eye property with
  // the other gate carriers, but never rendered): 'ask at every gate; **pro
  // edition, driven sessions**: when `orchestrator.driver.kind` is `cockpit` or
  // `dispatch`, suspend with one `gate-request` call — see the pro register §
  // E2.' The lines above already state the driven-session instruction in
  // context for the worker this seed is rendered for; pushing this sentence as
  // well duplicated and garbled it in the rendered prompt — so it stays here as
  // a comment, not a pushed line.
  const args = mapOf(workflow.with);
  const inputs = Array.isArray(document.inputs) ? document.inputs : [];
  // Two filters, for two kinds of noise. The keys the envelope consumed as
  // control travel in `with:` because the grammar has nowhere else to put
  // them, and each already has a line of its own — the tier in identity, the
  // statement above. The keys the envelope promoted to `inputs[]` are the same
  // values again under the same names, and a worker reading both is reading one
  // fact twice in a prompt that is capped.
  const promoted = new Set(inputs.map((input) => mapOf(input).role).filter((role) => typeof role === 'string'));
  const names = Object.keys(args).filter((name) => !CONTROL_ARGS.has(name) && !promoted.has(name));
  if (names.length) {
    lines.push('Arguments:');
    for (const name of names) lines.push(`  ${oneLine(name)} = ${oneLine(args[name])}`);
  }
  if (inputs.length) {
    // Anchored by the rule above. The envelope keeps the run's literal path, so
    // the anchoring happens here and only here. An input that still does not
    // resolve gets the move that works rather than a guess - a blocked
    // message, which is what the outbox is for.
    const root = rootOf(document);
    lines.push(root === null
      ? `Inputs from the dispatching run, read-only and spelled as that run named them rather than anchored here. ${IN_PLACE} If one does not resolve, send a blocked message rather than guessing:`
      : `Inputs from the dispatching run, read-only, each relative path anchored at the workspace root like every other path here. ${IN_PLACE} If one does not resolve, send a blocked message rather than guessing:`);
    // A research input is the report the work was planned from, so it is named
    // as required reading on its own line rather than by a sentence of its own:
    // the section's line count, and so the cap, does not move.
    for (const input of inputs) {
      const role = mapOf(input).role;
      const note = role === RESEARCH_ROLE
        ? ` (${RESEARCH_ROLE} - required reading: read it in full before any work starts)`
        : role ? ` (${oneLine(role)})` : '';
      const named = mapOf(input).path;
      lines.push(`  ${relativePath(named) ? anchor(root, named) : oneLine(named)}${note}`);
    }
  }
  return lines;
}

/**
 * How to report. The one cross-directory write the worker is granted, and the
 * only sanctioned way to perform it.
 *
 * The instruction names the `outbox` verb rather than the directory, because
 * hand-authoring the YAML skips everything the writer is: the `'wx'` claim that
 * makes the sequence exclusive, the per-type conditional check, and the
 * flow-safety refusal that keeps a message readable by the one-line reader.
 * `--outbox` takes the outbox **root**; the writer appends the dispatch id
 * itself, so the seed hands over the root and never the per-dispatch directory.
 * The body travels in the one input file the verb reads, in the dispatch's own
 * directory: a JSON heredoc is the shape an agent host's shell-safety checks
 * refuse, and a file written with the worker's file tool needs no quoting.
 *
 * The fallback names both frozen dispatch lines by their prefixes. A worker
 * told only to "print the message on one line" prints something no reader
 * matches, and the message is lost by the exact mechanism the fallback exists
 * to defeat.
 */
function outboxLines(document, pluginRoot) {
  const root = rootOf(document);
  const outboxRoot = anchor(root, outboxRootOf(document));
  const id = oneLine(document.dispatch_id);
  const input = joinPath(joinPath(outboxRoot, id), INPUT_FILE);
  return [
    `Report through the outbox verb, never by writing a message file under the outbox path yourself. Write the message body as JSON with your file tool to ${input} - the one file you may write there - and then run:`,
    `  node ${script(pluginRoot)} outbox --outbox=${outboxRoot} --dispatch-id=${id} --type=<type> --input-file=${input}`,
    `The verb deletes that file once the message lands and keeps it on a refusal, for you to correct and run again; never send the body through a heredoc or a pipe. Types: ${MESSAGE_TYPES.join(', ')}; a blocked message adds reason, an artifact adds path, a followup adds summary, a closeout adds grade, commits and prs - each pull request a {repo, number, url} map, prs empty when none was opened. Messages are append-only and the writer never rewrites one.`,
    'If the outbox cannot be written the verb hands you a line to print instead: `DISPATCH-RESULT: <grade> <summary>` for a closeout, `DISPATCH-FOLLOWUP: <summary>` for a followup. Print it as the last line of your turn - it is the only form in which the message survives.',
    'The other three types have no such line: run the same write again once the path is writable, or fold what it carried into the closeout summary.',
  ];
}

/**
 * What finishing means, from the envelope's close-out contract. `pr_required`
 * is derived from the autonomy tier at envelope time unless the dispatching
 * chain declared it, so the two halves of this section cannot contradict each
 * other the way a hard-coded `true` did.
 *
 * The required case has two readings, because one tier reaches a pull request
 * through a person rather than through its own permissions: under `attended`
 * the deny on `gh pr create` suspends the command for an operator to approve,
 * so telling that worker to "open it" without saying it will pause reads as a
 * failure the moment the command is held.
 *
 * So does the *not*-required case, and that is the newer half. A `false` has two
 * origins: the tier could never reach a pull request and the value was derived
 * from it, or the tier could and the chain declared `false` anyway. The single
 * sentence this section used to carry — "your tier can never open one" — is true
 * of the first and false of the second, and the second is the demo's own
 * configuration: `attended`, which relays `gh pr create` to an operator, on a
 * node declaring no pull request is required. A worker reading it there is told
 * something untrue about its own permissions, which is the last thing a close-out
 * instruction may be.
 *
 * Which origin it was needs no new envelope field: the tier's own reach is a
 * function of the two fields the envelope already carries, so the same
 * predicate the envelope builder used to *decide* the value answers here what it
 * means. The envelope does not move, and the seed stays a pure function of the
 * document.
 *
 * A tier that denies the pull request and has no operator to relay it to — the
 * auto tiers below the top one — gets one more line. Such a worker can finish
 * with commits on its branch and nothing published, because it never tried a
 * push its tier forbids. Saying so only in the close-out summary leaves a
 * reader acting on structured needs with nothing to offer. So it names the held
 * commands in a followup carrying `needs: [permission]`, and then closes out in
 * the same turn: nothing answers a held command inside the dispatch at these
 * tiers, and a dispatch that ends with no close-out leaves its chain waiting.
 */
function closeoutLines({ closeout, autonomy, permissions }) {
  const lines = [];
  if (closeout.pr_required === true && autonomy === RELAYED) {
    lines.push('A pull request is required before close-out. Your tier denies opening one directly, so the command is held for an operator to approve rather than refused outright.');
  } else if (closeout.pr_required === true) {
    lines.push('A pull request is required before close-out; open it and put its URL in the closeout message.');
  } else if (closeoutReachable({ autonomy, permissions })) {
    lines.push('No pull request is required - the chain dispatching you declared it, though your tier could open one. Do not open one anyway: say in the closeout what a reviewer has to open and merge.');
  } else {
    lines.push('No pull request is required - your tier denies opening one. Say in the closeout what a reviewer has to open and merge.');
  }
  if (autonomy !== RELAYED && !closeoutReachable({ autonomy, permissions })) {
    lines.push('Your tier denies `git push` and `gh pr create` unless a gate\'s answer granted them. If you end with commits on your branch that are not pushed - because the tier forbids the push, or a push or a pull request was refused - write a followup message naming each held command (`git push` of your branch, and `gh pr create` when a pull request is owed) and what is left to do, with `needs: [permission]` in its body beside that summary. Then publish the closeout in the same turn, `prs` empty and its summary saying the branch is unpublished.');
  }
  if (autonomy === RELAYED) {
    // A held command ends the turn the way every other unfinished dispatch
    // ends, on a followup and a frozen marker: a headless worker cannot wait
    // inside a turn, and one told to produced no close-out and nothing to read.
    // It renders for every relayed seed, because a push is held whether or not
    // a pull request is required. The `needs` field is what a reader acts on;
    // prose alone offers nothing to whoever puts the approval before a person.
    //
    // The approval is one push of the branch and its pull request, granted for
    // one turn: it resumes this same session, and the worker runs the held
    // commands itself — nothing else ever pushes for it. So the worker finishes
    // everything else before asking, asks once, and waits by ending the turn.
    // A push refused after a resume is the grant having lapsed, not a new kind
    // of failure, so it is asked for again the same way rather than worked
    // around. The person may instead dismiss the followup or send a note; only
    // a dismissal or a note saying stop closes the dispatch `partial`, because
    // a worker closing out on its own would strand an approval still pending.
    lines.push('If a push or a pull request the work expects is held for approval, finish everything else this node owes first. Then write exactly one followup message naming each held command (`git push` of your branch, and `gh pr create` when a pull request is owed) and what is left to do, with `needs: [permission]` in its body beside that summary, print `DISPATCH-FOLLOWUP: ` followed by that summary as the last line, and end the turn - an approval cannot arrive inside one.');
    lines.push('An operator may approve one push of your branch and its pull request; that resumes this session for one turn, in which you run the held push and pull request yourself and then close out `success` as usual. If a later push or pull request is refused again - the approval covered one turn - treat it exactly like the first hold: one followup with `needs: [permission]`, then end the turn. Never improvise around a refusal and never wait inside a turn.');
    lines.push('Close out `partial`, naming what is still held, only when the followup is dismissed or a note tells you to stop. Never close out `partial` on your own while the followup is unanswered.');
  }
  lines.push(`Grade the run ${listOf(Array.isArray(closeout.grade) && closeout.grade.length ? closeout.grade.map(oneLine) : ['success', 'partial', 'failed'])}.`);
  lines.push('The closeout message carries the grade, a summary of what changed, and what a reviewer must check.');
  return lines;
}

/**
 * That there are others, and how to behave about it. The count is a number and
 * never a list.
 *
 * The envelope may also list the other dispatches of the same outcome, and
 * then they are named — member, worktree and branch — as references to read
 * and never to write. A worker downstream of another member's delivery has to
 * read what that member delivered, and without the paths it writes against the
 * design instead. Only the caller that dispatched them knows which dispatches
 * belong together, so the list is the envelope's and never guessed here; with
 * none listed the section is exactly what it was.
 */
function siblingLines(siblings, { listed = null, root = null } = {}) {
  const lines = [
    siblings !== null && siblings > 1
      ? `You are one of ${siblings} workers running now. Coordinate only through the outbox.`
      : 'You may be running alongside other workers. Coordinate only through the outbox.',
  ];
  if (!Array.isArray(listed) || listed.length === 0) {
    lines.push("Never edit a sibling's repository, and never read or write another dispatch's outbox.");
    return lines;
  }
  lines.push('The other dispatches of this outcome, for reading only - never edit, commit or run anything that writes there:');
  for (const entry of listed) {
    lines.push(`- ${oneLine(entry.member)}: worktree ${siblingWorktree(root, entry)}, branch ${oneLine(entry.branch)}`);
  }
  lines.push("Read them for what they deliver - a contract, an API - when your work depends on it. Never edit a sibling's repository, and never read or write another dispatch's outbox.");
  return lines;
}

/**
 * A sibling's worktree, by the target's rule: an absolute one as is, a relative
 * one joined to its member's checkout and anchored. The envelope resolves that
 * checkout from the manifest; an entry without one names a member the manifest
 * does not declare, and its worktree is stated as given rather than guessed.
 */
function siblingWorktree(root, entry) {
  const worktree = oneLine(entry.worktree);
  if (isAbsolute(worktree)) return worktree;
  if (typeof entry.path !== 'string' || entry.path === '') return worktree;
  return anchor(root, joinPath(entry.path, worktree));
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * The descriptor as the prompt string: each section's marker, then its lines,
 * with one blank line between sections. The cap is measured on the result, so
 * it counts exactly what the worker will read.
 */
export function renderSeed(descriptor) {
  const sections = assertDescriptor(descriptor);
  const lines = [];
  sections.forEach((section, index) => {
    if (index > 0) lines.push('');
    lines.push(section.marker);
    for (const line of Array.isArray(section.lines) ? section.lines : []) {
      const text = String(line);
      // A line is a line. A pushed string carrying a newline counts as one
      // toward the cap and renders as several — which is how an embedded
      // `\n# task` would inject a counterfeit section marker into a frozen
      // structure, and how a prompt could render past a cap that passed.
      if (/[\n\r]/.test(text)) {
        throw new Refusal('seed-envelope-invalid',
          `the section "${section.id}" carries a line with a newline in it, which would render as several lines and could spell a second section marker. Collapse it before it reaches the descriptor.`);
      }
      lines.push(text);
    }
  });

  const prompt = lines.join('\n');
  const cap = descriptor.cap ?? SEED_LINE_CAP;
  // Measured on the rendered text rather than on the array of pushed strings,
  // so the number checked and the number reported are the same number.
  const rendered = prompt.split('\n').length;
  if (rendered > cap) {
    throw new Refusal('seed-over-cap',
      `the seed renders ${rendered} lines and the cap is ${cap}. It is not truncated: the sections that would be cut are closeout and siblings, which are exactly the instructions a worker must not be missing. Shorten the section content instead - the levers are the statement of the work, the with: arguments and the read-only inputs the dispatching node declares, since every other line is fixed prose.`);
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// what an envelope and a descriptor have to be
// ---------------------------------------------------------------------------

/**
 * The envelope fields a seed cannot be written without. Checked here rather
 * than trusted, because `seed` may be pointed at any file on disk and a prompt
 * built from a half-envelope would send a worker somewhere undefined.
 */
function assertEnvelope(envelope) {
  const document = mapOf(envelope);
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Refusal('seed-envelope-invalid', 'the envelope is not a mapping');
  }
  const missing = [];
  if (document.version !== VERSION) missing.push(`version must be ${VERSION}`);
  if (typeof document.dispatch_id !== 'string' || document.dispatch_id === '') missing.push('dispatch_id');
  if (!PROVIDERS.includes(document.provider)) missing.push(`provider must be one of ${PROVIDERS.join(', ')}`);
  if (!AUTONOMY.includes(document.autonomy)) missing.push(`autonomy must be one of ${AUTONOMY.join(', ')}`);
  const target = mapOf(document.target);
  if (typeof target.member !== 'string' || target.member === '') missing.push('target.member');
  if (typeof target.path !== 'string' || target.path === '') missing.push('target.path');
  const chain = mapOf(document.chain);
  if (typeof chain.node !== 'string' || chain.node === '') missing.push('chain.node');
  if (typeof document.outbox !== 'string' || document.outbox === '') missing.push('outbox');
  // Optional, but not free-form: a relative "root" would anchor every path in
  // the prompt to nothing, which is worse than the honest relative rendering
  // the absent case falls back to.
  const root = document.workspace_root;
  if (root !== undefined && root !== null && !(typeof root === 'string' && /^([A-Za-z]:[\\/]|[\\/])/.test(root))) {
    missing.push('workspace_root must be an absolute path when it is present');
  }
  if (document.statement !== undefined && document.statement !== null && typeof document.statement !== 'string') {
    missing.push('statement must be a string when it is present');
  }
  // `ceiling` is optional and never refused: a value outside the three levels
  // renders as the narrowest, which is what the engine reads it as anyway.
  if (document.siblings !== undefined && document.siblings !== null) {
    const problem = siblingsProblem(document.siblings);
    if (problem !== null) missing.push(`siblings ${problem}`);
  }

  if (missing.length) {
    throw new Refusal('seed-envelope-invalid',
      `the envelope cannot be seeded from: ${missing.join(', ')}`);
  }
  // A `workflow:` target whose name is malformed has no definition to name, and
  // the fall-through rendering would hand the worker `Run workflow:Plan.` —
  // chain grammar as its whole instruction, which is the failure the task
  // section exists to remove. Dispatch refuses this before publishing, but
  // `seed` may be pointed at any envelope on disk, so it is refused here too
  // rather than rendered.
  const uses = mapOf(document.workflow).uses;
  if (typeof uses === 'string' && uses.startsWith('workflow:') && workflowTarget(uses) === null) {
    throw new Refusal('seed-envelope-invalid',
      `the envelope names ${uses}, and "${uses.slice('workflow:'.length)}" is not a workflow name: expected ${TARGET_NAME.source}. Correct the target in the chain and republish the envelope; a seed built from this one would name a definition that cannot be resolved.`);
  }
  return document;
}

/** A descriptor is the five frozen sections in order, each with its marker. */
function assertDescriptor(descriptor) {
  const sections = mapOf(descriptor).sections;
  if (!Array.isArray(sections) || sections.length !== SEED_SECTIONS.length) {
    throw new Refusal('seed-envelope-invalid',
      `a seed carries exactly ${SEED_SECTIONS.length} sections, in the order ${SEED_SECTIONS.join(', ')}`);
  }
  sections.forEach((section, index) => {
    const id = mapOf(section).id;
    if (id !== SEED_SECTIONS[index]) {
      throw new Refusal('seed-envelope-invalid',
        `section ${index} is "${id}" where the frozen order expects "${SEED_SECTIONS[index]}"`);
    }
    if (mapOf(section).marker !== `# ${id}`) {
      throw new Refusal('seed-envelope-invalid',
        `the section "${id}" opens with "${mapOf(section).marker}" rather than "# ${id}"`);
    }
  });
  return sections;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** One argument value on one line. A nested value is stated, never expanded. */
function oneLine(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `${value.length} entries`;
  if (typeof value === 'object') return `${Object.keys(value).length} keys`;
  return String(value).replace(/[\r\n]+/g, ' ');
}

/**
 * The envelope's absolute workspace root, or null when it carries none. Every
 * path the seed states is anchored to it, because the worker's own cwd is
 * inside a member repository and resolving a workspace-relative path from
 * there writes into that repository.
 */
function rootOf(document) {
  const root = mapOf(document).workspace_root;
  return typeof root === 'string' && root !== '' ? root.replace(/[\\/]+$/, '') : null;
}

/** One path, absolute when there is a root to anchor it to. */
function anchor(root, relative) {
  const text = oneLine(relative);
  if (root === null || text === '' || text === 'null') return text;
  if (isAbsolute(text)) return text;
  return joinPath(root, text);
}

/** Whether a path is absolute, POSIX or Windows. */
function isAbsolute(text) {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(text);
}

/** Whether an input names a relative path rather than a value: see `taskLines`. */
function relativePath(value) {
  return pathLike(value) && !isAbsolute(value);
}

/**
 * Two path segments joined with a forward slash. Deliberately not `path.join`:
 * the seed is a prompt, and a rendering that changed shape with the platform it
 * was rendered on would not be reproducible.
 *
 * A `.` segment the tail carries is dropped, so `./context.md` under a root
 * reads `<root>/context.md` rather than `<root>/./context.md`. A `..` is kept
 * as written: resolving it would need the directory it climbs out of.
 */
function joinPath(left, right) {
  const head = oneLine(left).replace(/\/+$/, '');
  const tail = oneLine(right).replace(/^\/+/, '');
  if (head === '' || head === 'null') return tail;
  if (tail === '' || tail === 'null') return head;
  const kept = tail.split('/').filter(segment => segment !== '.').join('/');
  return kept === '' ? head : `${head}/${kept}`;
}

/**
 * The outbox **root** the `outbox` verb takes. The envelope's `outbox` names
 * the per-dispatch directory, and the writer appends the dispatch id itself, so
 * handing the verb the envelope value verbatim would nest the id twice.
 */
function outboxRootOf(document) {
  const outbox = oneLine(document.outbox).replace(/\/+$/, '');
  const id = oneLine(document.dispatch_id);
  const at = outbox.lastIndexOf('/');
  if (at >= 0 && outbox.slice(at + 1) === id) return outbox.slice(0, at);
  return outbox;
}

/** "success, partial or failed" - an English list, from a frozen enum. */
function listOf(values) {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

function mapOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
