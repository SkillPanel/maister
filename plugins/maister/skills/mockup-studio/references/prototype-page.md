# Prototype page

A prototype turn (`fidelity: prototype`) writes one working page, `versions/vNNN/prototype.html`,
that a person can click through, and the version's still screens are exported from it. The page is
the design; the stills are what every reader of a mockups folder already understands — a gallery,
flat pages, INDEX rows — so a prototype version reads like any other.

---

## What the page is

- **One self-contained file.** Inline CSS and scripts, no external stylesheet, font, script or
  image URL, and no network access of any kind: it opens the same from disk, from the viewer, and in
  a year.
- **Plain JS state over realistic data.** One state object holds what the screen shows — a list of
  real-looking records, the current view, what is selected, what a form holds — and the copy comes
  from the grounding pack's strings. No framework, no build step.
- **Every visible control works.** A button, tab, link or form either changes the state and
  re-renders, or is visibly disabled. A control that does nothing reads as a bug in the design.
- **Grounded like any screen.** The pack's tokens by name, its shell around the content.

---

## The two scripts

The page carries two separate scripts with separate jobs.

**The scenes script** — exactly one classic `<script id="mockup-scenes">` (no `type="module"`, no
`src`). It declares, at top level:

- `scenes`, a non-empty list of `{id, title, state, annotations?, behaviour?}`. `id` is the screen's
  slug, distinct within the page; `title` its screen title; `state` the state that scene shows;
  `annotations` as on any screen; `behaviour` short lines saying what a control does ("Save
  disables while the request runs").
- `render(state)`, a **pure** function that returns the markup for a state as a string — built from
  its argument alone. It touches no `document`, `window`, timer, storage or network, and it is
  synchronous: no `async`, no Promise.

Top-level `const`, `let` and `function` are all fine.

**The runtime script** — a second, ordinary script that makes the page live: it mounts `render`'s
output into the page, wires events that update the state and render again, and reads the location
hash, so `prototype.html#<slug>` opens on that scene's state. All DOM work lives here, never in
`render`.

A conceptual outline:

```
<style> … the shared CSS, tokens by name … </style>
<div id="app"></div>
<script id="mockup-scenes">
  const scenes = [{ id: 'inbox', title: 'Inbox', state: {...} }, …];
  function render(state) { return `<main>…</main>`; }
</script>
<script> /* mount render(scene from #hash), wire events */ </script>
```

---

## How the stills are made

`frames.mjs export --version-dir=<version folder>` reads the page, takes the scenes script and the
page's `<style>` elements in document order as the CSS every screen shares, runs the script with no
DOM and a two-second limit, calls `render(scene.state)` for each scene, and writes `.frames.json`:
one screen per scene. The page's runtime script never runs there. `finish` then reads those screens
as the version's own, carried over and changed by slug like any other.

The manifest records `fidelity: prototype`, `prototype: prototype.html`, and on each screen
`live: prototype.html#<slug>`; behaviour lines go to the manifest and, with INDEX rows, to the
row's description.

**When the export refuses**, the version still finishes: the turn writes sketch screens drawn from
the same scenes, records `fidelity: sketch` with the degraded code (`render-touches-dom` for a DOM
access, `render-failed` for anything else), and keeps `prototype.html`. Each code and its recovery
is in `turn-contract.md`. The usual causes are a `render` that reaches for the DOM, an async
`render`, or a scenes script that is a module.

**A prototype is HTML and needs Node.** With the `ascii` format, or without Node, the turn draws a
sketch and its notes say so.
