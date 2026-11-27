/**
 * The delivery scope check: the file a step declares under the output key
 * `delivery_scope` holds the shape product design's delivery-scope reference
 * defines, before anything approves it.
 *
 * Why this module exists. A design step wrote the scope with its `members` and
 * `out_of_scope` as maps keyed by member name — the shape of the workspace
 * manifest it took the names from — and nothing read the file until whatever
 * plans the delivery refused it, after the person had approved it. The shape
 * is fixed and small, so the engine checks it itself: when the step that
 * declares the file closes (`write-state`), and again when its gate is briefed
 * (`gate-brief`), for a file rewritten after the close or closed before the
 * check existed.
 *
 * What it checks, each problem one line naming the key and what to write
 * instead: the version, the list forms, the required keys, one-line strings,
 * no name twice, `depends_on` naming only other in-scope members and no cycle,
 * and — in a workspace, whose root holds `.maister/umbrella.yml` — every member
 * the manifest declares appearing exactly once, under its manifest name. A key
 * the shape does not name is not refused, so a file written to the shape by an
 * earlier version still passes; a manifest that does not read judges nothing.
 * Which nodes are held to it, and when a missing file is sanctioned, is
 * `heldScopePath`'s to say.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseDefinition } from './definition.mjs';

/** The declared output key the scope is read from, as the gate subject reads it. */
export const DELIVERY_SCOPE_KEY = 'delivery_scope';

/** The refusal code every problem line opens with. */
export const DELIVERY_SCOPE_CODE = 'delivery-scope-invalid';

/** The workspace manifest, under the project root. */
const MANIFEST = ['.maister', 'umbrella.yml'];

const MEMBER_FORM = '{name, statement, depends_on}';
const OUT_FORM = '{name, reason}';

/**
 * The problems with the scope at `file`, one line each and without the code,
 * or an empty list when it holds the shape. `projectRoot` is where the
 * workspace manifest is looked for; null looks nowhere.
 */
export function scopeProblems({ file, projectRoot = null }) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return [err.code === 'ENOENT'
      ? 'the file is missing; write it with version, members and out_of_scope, as the delivery-scope reference\'s shape shows'
      : `the file cannot be read (${err.message}); write it again`];
  }
  const parsed = parseDefinition(text, file);
  if (parsed.doc === null) {
    const why = parsed.errors.map(error => error.message).join('; ');
    return [`the file is not in the YAML subset the engine reads (${why}); write each collection on one line or as a block, with no block scalars or anchors`];
  }
  const doc = parsed.doc;
  if (!isMap(doc)) return ['the file is not a map; write version, members and out_of_scope as its top-level keys'];

  const problems = [];
  if (!Object.hasOwn(doc, 'version')) {
    problems.push('version is missing; write version: 1');
  } else if (doc.version !== 1) {
    // A shape this check does not know: its other keys are not this shape's to judge.
    return [`version is ${JSON.stringify(doc.version)}; write the bare number 1, the only version this shape has`];
  }

  const members = listOf(doc, 'members', MEMBER_FORM, problems);
  if (members !== null && members.length === 0) {
    problems.push(`members is empty; write at least one entry ${MEMBER_FORM}, the member the work lands in`);
  }
  const outOfScope = listOf(doc, 'out_of_scope', OUT_FORM, problems);

  const inScope = [];
  for (const [index, entry] of (members ?? []).entries()) {
    const at = `members[${index}]`;
    if (!isMap(entry)) {
      problems.push(`${at} is ${kindOf(entry)}; write a map ${MEMBER_FORM}`);
      continue;
    }
    const name = lineOf(entry, 'name', at, 'the member\'s name', problems);
    const label = name === null ? at : `${at} (${name})`;
    lineOf(entry, 'statement', label, 'the work in that member, in one line', problems);
    let needs = [];
    if (!Object.hasOwn(entry, 'depends_on')) {
      problems.push(`${label}.depends_on is missing; write depends_on: [] or the in-scope members whose work comes first`);
    } else if (!Array.isArray(entry.depends_on)) {
      problems.push(`${label}.depends_on is ${kindOf(entry.depends_on)}; write a list of in-scope member names, [] for none`);
    } else {
      needs = entry.depends_on.filter(each => {
        if (typeof each === 'string' && each.trim() !== '') return true;
        problems.push(`${label}.depends_on holds ${JSON.stringify(each)}; write member names only`);
        return false;
      });
    }
    if (name !== null) inScope.push({ name, needs, label });
  }
  const leftOut = [];
  for (const [index, entry] of (outOfScope ?? []).entries()) {
    const at = `out_of_scope[${index}]`;
    if (!isMap(entry)) {
      problems.push(`${at} is ${kindOf(entry)}; write a map ${OUT_FORM}`);
      continue;
    }
    const name = lineOf(entry, 'name', at, 'the member left out', problems);
    lineOf(entry, 'reason', name === null ? at : `${at} (${name})`, 'why it is left out, in one line', problems);
    if (name !== null) leftOut.push(name);
  }

  const seen = new Map();
  for (const name of [...inScope.map(each => each.name), ...leftOut]) seen.set(name, (seen.get(name) ?? 0) + 1);
  for (const [name, count] of seen) {
    if (count > 1) problems.push(`${name} appears ${count} times across members and out_of_scope; keep one entry, in scope or out of it`);
  }

  const inNames = new Set(inScope.map(each => each.name));
  const outNames = new Set(leftOut);
  for (const { name, needs, label } of inScope) {
    for (const need of needs) {
      if (need === name) problems.push(`${label}.depends_on names ${name} itself; a member never waits on its own work`);
      else if (outNames.has(need) && !inNames.has(need)) problems.push(`${label}.depends_on names ${need}, which is out of scope; depend only on members in scope, or move ${need} into members`);
      else if (!inNames.has(need)) problems.push(`${label}.depends_on names ${need}, which is not a member in scope; use a name from members, spelled exactly`);
    }
  }
  const cycle = cycleOf(inScope);
  if (cycle !== null) problems.push(`depends_on goes round in a cycle, ${cycle.join(' → ')}; drop one of those dependencies so the work has an order`);

  // Membership is judged only once both lists read as lists: a list the file
  // spelled as a map holds names this check cannot place, and its own line
  // already says what to write.
  const manifest = members === null || outOfScope === null ? null : manifestMembers(projectRoot);
  if (manifest !== null) {
    for (const name of manifest) {
      if (!seen.has(name)) problems.push(`${name} is a workspace member listed nowhere; add it to members, or to out_of_scope with a reason`);
    }
    const declared = new Set(manifest);
    for (const name of seen.keys()) {
      if (!declared.has(name)) problems.push(`${name} is not a member the workspace manifest declares; use the manifest's member names, spelled exactly`);
    }
  }
  return problems;
}

/** The problem lines joined into one refusal message, each line opening with the code. */
export function scopeRefusalText(problems) {
  return problems.join(`\n${DELIVERY_SCOPE_CODE}: `);
}

/**
 * The run-relative path a graph node declares for the scope, or null. Only a
 * literal path inside the run counts: an interpolated one has no file to read.
 */
export function declaredScopePath(graphNode) {
  const declared = graphNode?.outputs?.artifacts;
  const relative = isMap(declared) ? declared[DELIVERY_SCOPE_KEY] : undefined;
  if (typeof relative !== 'string' || relative === '' || relative.includes('${')) return null;
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) return null;
  return relative;
}

/**
 * The run-relative scope path a completed node is held to, or null when it is
 * held to none. Three cases hold nobody:
 *
 * - a `workflow:` node: its artifacts are its child run's, and the child's own
 *   close checked them;
 * - a node that declares no literal scope path;
 * - a scope that is not on disk when its absence is sanctioned — by the node's
 *   `brief:` block listing the key under `absent`, or by the closing summary
 *   recording it under `absent` with a reason (`absences`, the set the state
 *   writer's `sanctionedAbsences` gives for the node, the rule `run-complete`
 *   and the companion check read too).
 *
 * A scope that is on disk is always held to its shape, sanctioned or not.
 */
export function heldScopePath({ graphNode, briefEntry = null, absences = new Set(), runDir }) {
  if (typeof graphNode?.uses === 'string' && graphNode.uses.startsWith('workflow:')) return null;
  const relative = declaredScopePath(graphNode);
  if (relative === null) return null;
  if (fs.existsSync(path.join(runDir, relative))) return relative;
  const briefAbsent = isMap(briefEntry) && isMap(briefEntry.absent) && Object.hasOwn(briefEntry.absent, DELIVERY_SCOPE_KEY);
  return briefAbsent || absences.has(DELIVERY_SCOPE_KEY) ? null : relative;
}

/** `doc[key]` as a list, or null with the problem recorded; a map gets the line naming its fix. */
function listOf(doc, key, form, problems) {
  if (!Object.hasOwn(doc, key)) {
    problems.push(`${key} is missing; write ${key} as a list of ${form}${key === 'out_of_scope' ? ', [] when nothing is left out' : ''}`);
    return null;
  }
  const value = doc[key];
  if (Array.isArray(value)) return value;
  if (isMap(value)) problems.push(`${key} is a map keyed by member name; write a list of ${form}`);
  else problems.push(`${key} is ${kindOf(value)}; write a list of ${form}`);
  return null;
}

/** `entry[key]` when it is a non-empty one-line string, else null with the problem recorded. */
function lineOf(entry, key, at, what, problems) {
  if (!Object.hasOwn(entry, key)) {
    problems.push(`${at}.${key} is missing; write ${what}`);
    return null;
  }
  const value = entry[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${at}.${key} is ${typeof value === 'string' ? 'empty' : kindOf(value)}; write ${what}, as text`);
    return null;
  }
  if (/[\r\n]/.test(value)) {
    problems.push(`${at}.${key} spans more than one line; write ${what}, on one line`);
    return null;
  }
  return value;
}

/** The first dependency cycle among in-scope members, as names with the first repeated last, or null. */
function cycleOf(inScope) {
  const needsOf = new Map(inScope.map(({ name, needs }) => [name, needs.filter(need => need !== name)]));
  const state = new Map();
  const trail = [];
  const visit = name => {
    state.set(name, 'open');
    trail.push(name);
    for (const need of needsOf.get(name) ?? []) {
      if (!needsOf.has(need)) continue;
      if (state.get(need) === 'open') return [...trail.slice(trail.indexOf(need)), need];
      if (!state.has(need)) {
        const found = visit(need);
        if (found) return found;
      }
    }
    trail.pop();
    state.set(name, 'done');
    return null;
  };
  for (const name of needsOf.keys()) {
    if (state.has(name)) continue;
    const found = visit(name);
    if (found) return found;
  }
  return null;
}

/** The member names the workspace manifest under `projectRoot` declares, or null when there is none to read. */
function manifestMembers(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot === '') return null;
  const file = path.join(projectRoot, ...MANIFEST);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { doc } = parseDefinition(text, file);
  return isMap(doc) && isMap(doc.members) ? Object.keys(doc.members) : null;
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function kindOf(value) {
  if (value === null || value === undefined) return 'empty';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a map';
  return `${typeof value === 'string' ? 'the text' : 'the value'} ${JSON.stringify(value)}`;
}
