/**
 * The worker seed (contract C8).
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
 * wording has to stay free to improve. A descriptor is checkable against a
 * schema and pinnable by a golden fixture; a rendered paragraph is neither
 * without freezing its prose, which would make every wording fix a contract
 * change.
 *
 * What C8 freezes is therefore exactly three things: the five section ids, their
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
 * off limits. A seed that does not fit is a seed that is wrong, and it is
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
 * write-scope invariant says the outbox must never be. C2's `workspace_root`
 * is what closes that, and when an envelope carries one every path this module
 * states is absolute. When it does not, the prompt says what the paths are
 * relative to rather than pretending they resolve from anywhere.
 *
 * The refusal set is closed: `seed-envelope-invalid` and `seed-over-cap`. Each
 * is documented with its recovery in `SKILL.md`.
 */

import path from 'node:path';

import { Refusal } from './canonical.mjs';
import { readDefinition } from './definition.mjs';

/** The format version a seed descriptor declares. */
const VERSION = 1;

/** C8's five section ids, in the frozen order. Exported so a test names them once. */
export const SEED_SECTIONS = Object.freeze(['identity', 'task', 'outbox', 'closeout', 'siblings']);

/** C8's rendered line cap. */
export const SEED_LINE_CAP = 60;

/** The `with:` keys the envelope reads as control rather than as arguments. */
const CONTROL_ARGS = new Set(['autonomy', 'statement', 'task']);

/** C4's message types, named here because the outbox section teaches them. */
const MESSAGE_TYPES = ['status', 'followup', 'artifact', 'closeout', 'blocked'];

/**
 * The exec form of the runtime the outbox instruction names. Spelled with the
 * host's own root variable so one seed is correct under every install, and kept
 * in a plain string so nothing here is interpolated at render time.
 */
const SCRIPT = '${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs';

/**
 * The engine script a dispatched worker suspends its own gates through. Named
 * here for the same reason the outbox verb is: the gate files are a contract
 * shape, and a worker that hand-writes them writes a question no reader
 * matches. It is one call because it cannot be two — the run is pending the
 * moment the request file lands, and a second shell call against a pending run
 * is denied.
 */
const WORKFLOW_SCRIPT = '${CLAUDE_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs';

/** C2's autonomy and provider enums, checked before an envelope is trusted. */
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
 * sibling count always give the same object, which is what makes it golden.
 */
export function buildSeed(envelope, { siblings = null } = {}) {
  const document = assertEnvelope(envelope);
  const chain = mapOf(document.chain);
  const target = mapOf(document.target);
  const workflow = mapOf(document.workflow);
  const closeout = mapOf(document.closeout_contract);

  const lines = {
    identity: identityLines({ document, chain, target }),
    task: taskLines({ document, workflow }),
    outbox: outboxLines(document),
    closeout: closeoutLines({ closeout, autonomy: document.autonomy }),
    siblings: siblingLines(siblings),
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
 * member repo. `anchor()` prefixes C2's `workspace_root` when the envelope
 * carries one, and the last line says which of the two the worker got.
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
      ? `Work in ${where}. The paths below are relative to the workspace root — the directory holding the member checkouts — and never to your own working directory. The one exception is the read-only inputs under \`# task\`, which are as the dispatching run named them and are anchored to nothing here.`
      : `Work in ${where}. Every path below is absolute except the read-only inputs under \`# task\`, which are as the dispatching run named them; write nothing outside that directory except through the outbox verb named below.`,
    document.autonomy === RELAYED
      ? `Autonomy tier ${oneLine(document.autonomy)}; the permissions it grants are already in force, so a refused command is the tier and not a mistake. At this tier a denial is relayed to an operator for approval rather than final: when a command is held, wait for that decision instead of routing around it.`
      : `Autonomy tier ${oneLine(document.autonomy)}; the permissions it grants are already in force, so a refused command is the tier and not a mistake.`,
  ];
}

/**
 * What to run, and how a dispatched worker behaves while running it.
 *
 * There is no `--driver` flag on any workflow in this plugin: driver kind
 * travels in the worker's own run state at `orchestrator.driver.kind`, and the
 * gate rule keys on it (E1/E2). So the seed states the *behaviour* the worker
 * owes — record the kind, write the gate request, print the frozen marker, end
 * the turn — rather than a flag it could not pass to anything.
 *
 * The statement of the work is C2's `statement`, when the dispatching node
 * carried one. Absent it the seed still names the workflow and its arguments,
 * which is the whole of what the node said.
 */
function taskLines({ document, workflow }) {
  const lines = [];
  if (typeof document.statement === 'string' && document.statement.trim() !== '') {
    lines.push(`The work: ${oneLine(document.statement)}`);
  }
  lines.push(workflow.uses
    ? `Run ${oneLine(workflow.uses)}.`
    : 'Run the workflow named by your dispatch.');
  lines.push('You run under the dispatch driver: record `orchestrator.driver.kind: dispatch` in your run state. At every gate suspend the run with one call to the engine\'s gate-request verb, never by writing the gate files yourself:');
  lines.push(`  node ${WORKFLOW_SCRIPT} gate-request --state=<your own orchestrator-state.yml>`);
  lines.push('with the request as JSON on stdin. It writes the request file, the gate index and the pending marker together; there is no second write and the run is already suspended once it returns. Then print `GATE-PENDING: ` followed by that gate\'s own node id as the last line of the turn, and stop. Never ask a question in session.');
  const args = mapOf(workflow.with);
  const inputs = Array.isArray(document.inputs) ? document.inputs : [];
  // Two filters, for two kinds of noise. The keys the envelope consumed as
  // control travel in `with:` because grammar B1 has nowhere else to put them,
  // and each already has a line of its own — the tier in identity, the
  // statement above. The keys C2 promoted to `inputs[]` are the same values
  // again under the same names, and a worker reading both is reading one fact
  // twice in a prompt that is capped.
  const promoted = new Set(inputs.map((input) => mapOf(input).role).filter((role) => typeof role === 'string'));
  const names = Object.keys(args).filter((name) => !CONTROL_ARGS.has(name) && !promoted.has(name));
  if (names.length) {
    lines.push('Arguments:');
    for (const name of names) lines.push(`  ${oneLine(name)} = ${oneLine(args[name])}`);
  }
  if (inputs.length) {
    // Stated as the dispatching run wrote them and deliberately not anchored:
    // these are run outputs, and this envelope carries no run directory to
    // resolve them against. Guessing one would send a worker to a path that
    // does not exist; saying so gives it the move that does — a blocked
    // message, which is what the outbox is for.
    lines.push('Inputs from the dispatching run, read-only and spelled as that run named them rather than anchored here. If one does not resolve, send a blocked message rather than guessing:');
    for (const input of inputs) {
      const role = mapOf(input).role;
      lines.push(`  ${oneLine(mapOf(input).path)}${role ? ` (${oneLine(role)})` : ''}`);
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
 *
 * The fallback names both frozen C5 dispatch lines by their prefixes. A worker
 * told only to "print the message on one line" prints something no reader
 * matches, and the message is lost by the exact mechanism the fallback exists
 * to defeat.
 */
function outboxLines(document) {
  const root = rootOf(document);
  return [
    `Report through the outbox verb, never by writing a file under the outbox path yourself:`,
    `  node ${SCRIPT} outbox --outbox=${anchor(root, outboxRootOf(document))} --dispatch-id=${oneLine(document.dispatch_id)} --type=<type>`,
    `with the message body as JSON on stdin. Types: ${MESSAGE_TYPES.join(', ')}; a blocked message adds reason, an artifact adds path, a followup adds summary, a closeout adds grade. Messages are append-only and the writer never rewrites one.`,
    'If the outbox cannot be written the verb hands you a line to print instead: `DISPATCH-RESULT: <grade> <summary>` for a closeout, `DISPATCH-FOLLOWUP: <summary>` for a followup. Print it as the last line of your turn — it is the only form in which the message survives.',
    'The other three types have no such line: run the same write again once the path is writable, or fold what it carried into the closeout summary.',
  ];
}

/**
 * What finishing means, from C2's close-out contract. `pr_required` is derived
 * from the autonomy tier at envelope time, so the two halves of this section
 * cannot contradict each other the way a hard-coded `true` did.
 *
 * The required case has two readings, because one tier reaches a pull request
 * through a person rather than through its own permissions: under `attended`
 * the deny on `gh pr create` suspends the command for an operator to approve,
 * so telling that worker to "open it" without saying it will pause reads as a
 * failure the moment the command is held.
 */
function closeoutLines({ closeout, autonomy }) {
  return [
    closeout.pr_required === true
      ? (autonomy === RELAYED
        ? 'A pull request is required before close-out. Your tier denies opening one directly, so the command pauses for an operator to approve it — wait for that approval, then put the pull request URL in the closeout message.'
        : 'A pull request is required before close-out; open it and put its URL in the closeout message.')
      : 'No pull request is required — your tier can never open one. Say in the closeout what a reviewer has to open and merge.',
    `Grade the run ${listOf(Array.isArray(closeout.grade) && closeout.grade.length ? closeout.grade.map(oneLine) : ['success', 'partial', 'failed'])}.`,
    'The closeout message carries the grade, a summary of what changed, and what a reviewer must check.',
  ];
}

/**
 * That there are others, and how to behave about it. The count is a number and
 * never a list: naming a sibling would name a repository the worker must not
 * touch, which is an invitation rather than a boundary.
 */
function siblingLines(siblings) {
  return [
    siblings !== null && siblings > 1
      ? `You are one of ${siblings} workers running now. Coordinate only through the outbox.`
      : 'You may be running alongside other workers. Coordinate only through the outbox.',
    "Never edit a sibling's repository, and never read or write another dispatch's outbox.",
  ];
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
      `the seed renders ${rendered} lines and the cap is ${cap}. It is not truncated: the sections that would be cut are closeout and siblings, which are exactly the instructions a worker must not be missing. Shorten the section content instead — the levers are the statement of the work, the with: arguments and the read-only inputs the dispatching node declares, since every other line is fixed prose.`);
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// what an envelope and a descriptor have to be
// ---------------------------------------------------------------------------

/**
 * The C2 fields a seed cannot be written without. Checked here rather than
 * trusted, because `seed` may be pointed at any file on disk and a prompt built
 * from a half-envelope would send a worker somewhere undefined.
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

  if (missing.length) {
    throw new Refusal('seed-envelope-invalid',
      `the envelope cannot be seeded from: ${missing.join(', ')}`);
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
 * C2's absolute workspace root, or null when the envelope carries none. Every
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
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(text)) return text;
  return joinPath(root, text);
}

/**
 * Two path segments joined with a forward slash. Deliberately not `path.join`:
 * the seed is a prompt, and a rendering that changed shape with the platform it
 * was rendered on could not be pinned by a golden fixture.
 */
function joinPath(left, right) {
  const head = oneLine(left).replace(/\/+$/, '');
  const tail = oneLine(right).replace(/^\/+/, '');
  if (head === '' || head === 'null') return tail;
  if (tail === '' || tail === 'null') return head;
  return `${head}/${tail}`;
}

/**
 * The outbox **root** the `outbox` verb takes. C2's `outbox` names the
 * per-dispatch directory, and the writer appends the dispatch id itself, so
 * handing the verb the C2 value verbatim would nest the id twice.
 */
function outboxRootOf(document) {
  const outbox = oneLine(document.outbox).replace(/\/+$/, '');
  const id = oneLine(document.dispatch_id);
  const at = outbox.lastIndexOf('/');
  if (at >= 0 && outbox.slice(at + 1) === id) return outbox.slice(0, at);
  return outbox;
}

/** "success, partial or failed" — an English list, from a frozen enum. */
function listOf(values) {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

function mapOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
