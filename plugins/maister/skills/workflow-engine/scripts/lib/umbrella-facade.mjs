/**
 * The umbrella runtime's only door into the workflow engine.
 *
 * The umbrella (`skills/umbrella/scripts/`) resolves and validates workflow
 * definitions the way the engine does, and caps a dispatch at the autonomy the
 * engine would allow, so it needs a handful of the engine's functions and
 * constants. It takes every one of them from this module and from nowhere
 * else in the engine; the engine, for its part, imports nothing from the
 * umbrella. That keeps the boundary between the two one file wide, so moving
 * the umbrella elsewhere is a file move rather than a refactor.
 *
 * Every export is a re-export of the engine's own binding, never a wrapper or
 * a copy, so the umbrella and the engine agree by construction. The list is
 * the umbrella's contract with the engine: an engine change that renames,
 * removes or retypes one of these names breaks the umbrella, and the facade's
 * test pins them for that reason. Add a name only when the umbrella needs it.
 */

export { readDefinition } from './definition.mjs';
export { bareWorkflowName, locateTarget, resolve, TARGET_NAME, TARGET_REF, validate } from './graph.mjs';
export { ASK_LEVELS, effectiveCeiling, loadPolicy, narrowerLevel } from './policy.mjs';
