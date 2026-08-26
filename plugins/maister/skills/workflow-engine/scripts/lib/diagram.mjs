/**
 * The diagram generator.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. No Mermaid library is
 * involved and none is wanted: rendering a fixed grammar from an already
 * canonical object is string concatenation, and a dependency would buy layout
 * opinions in exchange for the one property this module exists to hold.
 *
 * That property is purity. `render` is a function of the resolved graph and of
 * nothing else — no clock, no randomness, no filesystem, no iteration over a
 * map whose order this file did not fix itself. Same graph, same bytes, on
 * every run and on every platform. Byte-stability is what makes the output
 * golden-file testable, and golden-file testability is why the shipped built-in
 * ships a diagram that was generated rather than drawn.
 *
 * The input is the canonical form the resolver already produces: nodes in
 * topological order with a lexicographic tie-break, keys in a fixed order,
 * `needs` deduplicated and sorted, absent optionals omitted. This module
 * consumes that form and re-derives none of it. Re-sorting here would be a
 * second ordering rule to keep in step with the first, and the two would drift.
 *
 * The diagram is deliberately **non-contractual**: no register row, no schema,
 * no fixture pair. Nothing parses it back, and nothing in a run depends on its
 * text. It is documentation whose only mechanical guarantee is that it was not
 * written by hand and cannot silently disagree with the definition beside it.
 * Promoting it later costs a register row and a schema; shipping it now costs
 * neither, and adding an id we would then have to freeze is the expensive half.
 *
 * What the reader must be able to see at a glance is where a run can **stop**
 * and where it can **branch**, because those are the two places an operator is
 * involved. Gates and `when`-bearing nodes therefore get their own shapes and
 * their own classes; everything else is a plain box.
 */

/**
 * The first line. `TD` rather than `LR` because these graphs are deep and
 * narrow — the shipped built-in is a nine-node chain — and a left-to-right
 * chain of nine boxes is unreadable at any page width.
 */
const HEADER = 'flowchart TD';

/** The banner every generated file carries, so a reader never edits the output. */
const GENERATED = 'generated from the workflow definition — regenerate, do not edit';

/**
 * The shapes, chosen so the two operator-visible node kinds differ from a plain
 * task and from each other even in a plain-text diff, where no stylesheet
 * applies. A hexagon reads as a checkpoint; a rhombus is Mermaid's decision
 * shape and a `when` guard is exactly a decision.
 */
const SHAPES = {
  task: ['["', '"]'],
  gate: ['{{"', '"}}'],
  conditional: ['{"', '"}'],
};

/**
 * The classes attached alongside the shapes. Shape is for the reader of the
 * text; a class is for anything that styles the rendered picture without
 * parsing glyphs back out of it. `optional` has no shape of its own — it is a
 * property of how failure propagates, not of where the operator stands.
 */
const CLASS_GATE = 'gate';
const CLASS_CONDITIONAL = 'conditional';
const CLASS_OPTIONAL = 'optional';

/** The order class statements are emitted in. Fixed here, never derived. */
const CLASS_ORDER = [CLASS_GATE, CLASS_CONDITIONAL, CLASS_OPTIONAL];

/** The node type that marks a stopping point. Every other type is a task. */
const TYPE_GATE = 'gate';

/** Two spaces, the indent every line below the header carries. */
const INDENT = '  ';

/**
 * Mermaid identifiers are not node ids. Node ids are lower-case words joined by
 * hyphens, and some of those words — `end` above all — are Mermaid keywords
 * that break the parse. Prefixing and substituting `_` for `-` avoids the
 * keyword space entirely, and cannot collide, because `_` is outside the closed
 * character set a node id is allowed to use. The real id stays in the label.
 */
const ID_PREFIX = 'n_';

/**
 * Characters that must not reach a Mermaid label raw. `#` goes first: it opens
 * Mermaid's own entity syntax, which is what the replacements produce, so
 * escaping it after them would escape them too.
 */
const ESCAPES = [
  ['#', '#35;'],
  ['"', '#quot;'],
  ['<', '#lt;'],
  ['>', '#gt;'],
];

/** Line breaks inside one label. Mermaid takes a tag, not a newline. */
const BREAK = '<br/>';

// ---------------------------------------------------------------------------
// the entry point
// ---------------------------------------------------------------------------

/**
 * Render the resolved graph as Mermaid text.
 *
 * Takes the object `resolve` returns and produces a string ending in one
 * newline. Nothing is read from the outside and nothing in the input is
 * mutated, so the caller may render the same object twice — and does, in the
 * assertions — and get one answer.
 */
export function render(resolved) {
  const nodes = Array.isArray(resolved?.nodes) ? resolved.nodes : [];
  const lines = [];

  // Provenance a reader needs and nothing more. The `source` path is left out
  // on purpose: it varies with how the verb was invoked — relative here,
  // absolute in a suite runner — and a byte that moves with the invocation is
  // the one thing a golden file cannot hold.
  lines.push(`%% ${GENERATED}`);
  if (typeof resolved?.name === 'string' && resolved.name !== '') {
    lines.push(`%% workflow: ${oneLine(resolved.name)}`);
  }
  if (typeof resolved?.graph_hash === 'string' && resolved.graph_hash !== '') {
    lines.push(`%% graph_hash: ${oneLine(resolved.graph_hash)}`);
  }
  lines.push('');
  lines.push(HEADER);

  for (const node of nodes) lines.push(INDENT + declare(node));

  // Edges after every declaration rather than interleaved: a node that is
  // declared only where it is first referenced would take its shape from
  // whichever edge happened to come first.
  for (const node of nodes) {
    for (const need of needsOf(node)) {
      lines.push(`${INDENT}${mermaidId(need)} --> ${mermaidId(node.id)}`);
    }
  }

  for (const name of CLASS_ORDER) {
    const members = nodes.filter((node) => classesOf(node).includes(name)).map((node) => mermaidId(node.id));
    if (members.length) lines.push(`${INDENT}class ${members.join(',')} ${name}`);
  }

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

/** One node declaration: its Mermaid id, its shape, and its label. */
function declare(node) {
  const [open, close] = SHAPES[shapeOf(node)];
  return `${mermaidId(node.id)}${open}${label(node)}${close}`;
}

/**
 * A gate is a gate whatever else it carries — where the run stops outranks how
 * it got there — so the guard on a gate shows up in the label rather than in
 * the shape.
 */
function shapeOf(node) {
  if (node.type === TYPE_GATE) return 'gate';
  if (node.when !== undefined && node.when !== null) return 'conditional';
  return 'task';
}

/** Every class a node carries, in the fixed emission order. */
function classesOf(node) {
  const names = [];
  if (node.type === TYPE_GATE) names.push(CLASS_GATE);
  if (node.when !== undefined && node.when !== null) names.push(CLASS_CONDITIONAL);
  if (node.optional === true) names.push(CLASS_OPTIONAL);
  return names;
}

/**
 * The label: the id, then only the fields that change how the run behaves.
 * `with` and `outputs` are deliberately absent — they are the bulk of a node
 * and none of its control flow, and a diagram that reprints the definition is
 * a worse definition rather than a better picture.
 *
 * A gate's question and its options are the exception, and belong here for the
 * same reason the shapes do: a gate is where the operator stands, and a picture
 * that showed a stopping point without showing what is asked or which answer
 * continues would be a picture of the run nobody has to make a decision in.
 */
function label(node) {
  const parts = [text(node.id)];
  if (typeof node.uses === 'string' && node.uses !== '') parts.push(text(node.uses));
  if (node.type === TYPE_GATE) parts.push(text('gate'));
  if (node.type === TYPE_GATE && typeof node.ask === 'string' && node.ask !== '') parts.push(text(node.ask));
  if (node.type === TYPE_GATE && options(node) !== '') parts.push(text(options(node)));
  if (node.when !== undefined && node.when !== null) parts.push(text(`when: ${scalar(node.when)}`));
  if (node.on !== undefined && node.on !== null) parts.push(text(`on: ${scalar(node.on)}`));
  if (node.optional === true) parts.push(text('optional'));
  return parts.join(BREAK);
}

/**
 * A gate's options, in the order the canonical node carries them — which the
 * resolver already fixed, so nothing is re-sorted here. Each option is printed
 * with its effect, because the id alone would not say which answer ends the run.
 */
function options(node) {
  const map = node.options;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return '';
  return Object.entries(map).map(([id, effect]) => `${id}: ${scalar(effect)}`).join(', ');
}

/**
 * `needs` arrives deduplicated and sorted from the resolver. It is read here
 * without being re-sorted, which is the whole point: one ordering rule exists,
 * and it lives upstream.
 */
function needsOf(node) {
  return Array.isArray(node.needs) ? node.needs : [];
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/** A node id turned into an identifier Mermaid will accept. */
/**
 * A Mermaid-safe node id. Dashes become underscores, and every other character
 * outside the identifier set does too: ids are validated in the normal path but
 * a degraded document's are not, and one crafted id would otherwise emit a
 * diagram no renderer accepts. The diagram is non-contractual — this is about
 * the file staying renderable, not about the mapping being reversible.
 */
function mermaidId(id) {
  return ID_PREFIX + String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

/** Escape one label fragment and flatten it onto a single visual line. */
function text(value) {
  let out = oneLine(value);
  for (const [from, to] of ESCAPES) out = out.split(from).join(to);
  return out;
}

/** Collapse every line ending so no value can end a line the grammar owns. */
function oneLine(value) {
  return String(value).split('\r\n').join(' ').split('\n').join(' ').split('\r').join(' ');
}

/**
 * A guard or a policy printed as it was authored. Anything that is not a plain
 * scalar is JSON-encoded rather than left to `String`, which renders an object
 * as `[object Object]` — a byte-stable rendering of nothing at all.
 */
function scalar(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
