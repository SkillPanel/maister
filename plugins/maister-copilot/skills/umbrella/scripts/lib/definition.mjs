/**
 * A re-export shim, and nothing else.
 *
 * Every umbrella document read goes through the workflow engine's reader; a
 * second parser is drift. The engine owns the reader and hands it to the
 * umbrella through its facade, the umbrella's one door into the engine; this
 * directory borrows it under the sibling name `./definition.mjs` so the same
 * import line resolves both here and in any flattened copy of this directory,
 * where the reader sits as that sibling. Nothing is rewritten at staging time.
 *
 * A re-export forwards the live binding, so `readDefinition` here is the
 * engine's function and not a copy that could drift a version behind it.
 */

export { readDefinition } from '../../../workflow-engine/scripts/lib/umbrella-facade.mjs';
