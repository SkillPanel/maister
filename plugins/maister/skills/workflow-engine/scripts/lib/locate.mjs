/**
 * A workflow found by the name it is run by, or every name a project can run.
 *
 * Why this is a verb and not a paragraph. A run starts from a name, and the
 * name is looked up in four homes — an eject, a generated chain, an overlay
 * over the built-in, the built-in — first hit winning. The other verbs take
 * file paths, so until now that lookup was done by a model reading the order
 * out of prose and testing paths by hand, while `validate` resolved `workflow:`
 * targets through `locateWorkflow`. Two lookups of one name is how a
 * definition validates against one file and runs another. This module is the
 * same function behind a verb, so whoever starts a run and the validator that
 * judges it agree on which file that is.
 *
 * What it prints is what the caller needs next and nothing it would have to
 * derive: the `--definition` and `--overlay` values `validate` and `resolve`
 * take, the inputs the definition declares (so a caller asks only for what is
 * missing), the nodes that dispatch into a member repository (which make the
 * definition a chain), and the companion's title and opening paragraph (so a
 * router can say what the workflow is for).
 *
 * Without a name it lists the project's own workflows: every top-level
 * definition in `.maister/workflows/` that is not an overlay and not named
 * after a built-in. An eject of a built-in is reached through that built-in's
 * own command, and a generated chain belongs to the ticket it was planned for,
 * so neither is listed.
 *
 * It reads and never writes. Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readDefinition } from './definition.mjs';
import { TARGET_NAME, bareWorkflowName, locateWorkflow, pluginRoot, projectRoot } from './graph.mjs';

/** Where definitions live, relative to a project root. */
const HOME = path.join('.maister', 'workflows');

/**
 * `{name}` looks one workflow up; no name lists the project's own. `project`
 * overrides the root the lookup is rooted at, which is otherwise the host's
 * declared project or the working directory, exactly as for `validate`.
 */
export function locate({ name = null, project = null } = {}) {
  const root = project ? path.resolve(project) : projectRoot();
  return name === null ? list(root) : one(String(name), root);
}

function one(name, root) {
  const bare = bareWorkflowName(name);
  if (bare === null) {
    return refused(null, `"${name}" is not a workflow name: expected ${TARGET_NAME.source}, optionally prefixed builtin:`);
  }
  const hit = locateWorkflow(bare, root);
  if (hit === null) {
    return refused(null, `no workflow named "${bare}": looked for ${HOME}/${bare}.yml, ${HOME}/generated/${bare}.yml, `
      + `${HOME}/${bare}.overlay.yml and a built-in ${bare}.yml, and found none`);
  }
  const read = readDefinition(hit.base);
  if (read.errors.length) return { ok: false, errors: read.errors };
  const mismatch = nameMismatch(read.doc, bare, hit.base, root);
  if (mismatch) return refused(shown(hit.base, root), mismatch);

  const described = describe(hit.base, root);
  return {
    ok: true,
    errors: [],
    name: bare,
    from: hit.from,
    definition: shown(hit.base, root),
    // The overlay home names operations, not a document: the built-in is the
    // definition and the overlay rides on it. Every other home is complete.
    overlays: hit.from === 'overlay' ? [shown(hit.at, root)] : [],
    ignored: hit.ignored ? shown(hit.ignored, root) : null,
    companion: described.companion,
    title: described.title,
    summary: described.summary,
    inputs: isMap(read.doc.inputs) ? read.doc.inputs : {},
    dispatches: dispatchesOf(read.doc),
  };
}

function list(root) {
  const home = path.join(root, HOME);
  const builtins = builtinNames();
  const workflows = [];
  for (const file of definitionsIn(home)) {
    const name = path.basename(file).replace(/\.yml$/, '');
    if (!TARGET_NAME.test(name) || builtins.has(name)) continue;
    const read = readDefinition(file);
    const described = describe(file, root);
    const error = read.errors.length ? read.errors[0].message : nameMismatch(read.doc, name, file, root);
    workflows.push({
      name,
      definition: shown(file, root),
      title: described.title,
      summary: described.summary,
      chain: read.doc ? dispatchesOf(read.doc).length > 0 : false,
      error: error || null,
    });
  }
  return { ok: true, errors: [], workflows };
}

/**
 * A definition found under one name that calls itself another. The run would
 * record the name the file declares — its task directory, its context block,
 * every reader's label — while the operator typed the file's name, so the two
 * are made to agree before anything starts rather than after.
 */
function nameMismatch(doc, name, file, root) {
  if (doc?.name === name) return null;
  const declared = typeof doc?.name === 'string' ? `declares name: ${doc.name}` : 'declares no name';
  return `${shown(file, root)} is found by the name "${name}" but ${declared}; a workflow is run by its file's name `
    + 'and recorded under the name it declares, so rename the file or the name: key until they agree';
}

/** The ids of the nodes that carry `dir:`, which hand work to a member repository. */
function dispatchesOf(doc) {
  const nodes = isMap(doc.nodes) ? doc.nodes : {};
  return Object.keys(nodes).filter(id => isMap(nodes[id]) && Object.hasOwn(nodes[id], 'dir')).sort();
}

/**
 * The companion's H1 and its first paragraph, each null when absent. The
 * paragraph is the first run of non-blank lines after the H1 — or from the top
 * when there is none — that is not itself a heading, folded onto one line.
 */
function describe(file, root) {
  const companion = file.replace(/\.ya?ml$/i, '.md');
  let text;
  try {
    text = fs.readFileSync(companion, 'utf8');
  } catch {
    return { companion: null, title: null, summary: null };
  }
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex(line => /^#\s+\S/.test(line));
  const title = heading >= 0 ? lines[heading].replace(/^#\s+/, '').trim() : null;
  const paragraph = [];
  for (const line of lines.slice(heading + 1)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return { companion: shown(companion, root), title, summary: paragraph.length ? paragraph.join(' ') : null };
}

/** The built-in workflow names this plugin ships, read from its definitions directory. */
function builtinNames() {
  return new Set(definitionsIn(path.join(pluginRoot(), 'skills', 'workflow-engine', 'workflows'))
    .map(file => path.basename(file).replace(/\.yml$/, '')));
}

/** Every `<name>.yml` directly in `dir` that is not an overlay, sorted; none when `dir` is absent. */
function definitionsIn(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.yml') && !entry.name.endsWith('.overlay.yml'))
    .map(entry => path.join(dir, entry.name))
    .sort();
}

/**
 * A path as a caller passes it on: relative to the project root when it lies
 * inside it — the spelling a freeze records and re-resolves from the run's own
 * root — and absolute otherwise, which is where the built-ins live.
 */
function shown(file, root) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : path.resolve(file);
}

function refused(file, message) {
  return { ok: false, errors: [{ file, node: null, path: 'name', message }] };
}

function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
