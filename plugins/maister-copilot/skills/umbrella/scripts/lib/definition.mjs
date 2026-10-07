/**
 * A re-export shim, and nothing else.
 *
 * Every umbrella document read goes through the workflow engine's reader; a
 * second parser is drift. The engine owns the file, this directory borrows it
 * under the sibling name `./definition.mjs` so the same import line resolves
 * both here and in any flattened copy of this directory, where the reader sits
 * as that sibling. Nothing is rewritten at staging time.
 *
 * `export *` forwards the live bindings, so `KNOWN_VERSION` here is the engine's
 * constant and not a copy that could drift a version behind it.
 */

export * from '../../../workflow-engine/scripts/lib/definition.mjs';
