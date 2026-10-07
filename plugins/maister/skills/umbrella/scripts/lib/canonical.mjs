/**
 * A re-export shim, and nothing else.
 *
 * The write primitives live once, at the plugin root, because no single skill
 * owns them. Every module in this directory imports them as the sibling
 * `./canonical.mjs` so the same source line resolves in two trees: here, where
 * this file forwards to the plugin-root module, and in any flattened copy of
 * this directory, where the real module sits as that sibling. Nothing is
 * rewritten at staging time.
 *
 * `export *` forwards the live bindings rather than copying them, so the
 * `Refusal` class reached through this shim is the very same class object the
 * workflow engine's `state.mjs` imports directly. That identity is the point:
 * a second `Refusal` would make every `instanceof` check across the two trees
 * answer false, silently, and a refusal would surface as an internal failure.
 */

export * from '../../../../lib/canonical.mjs';
