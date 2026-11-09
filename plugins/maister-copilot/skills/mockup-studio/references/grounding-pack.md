# Grounding pack

A mockup looks like the product only when it is drawn from the product's own values: its colours,
fonts, radii and shadows, its app shell, its real copy. Rediscovering those every turn is slow and
drifts from turn to turn, so they are harvested once into a **grounding pack** that every turn reads,
and that records what it was built from so a turn can tell when it has gone stale.

Two entries build it: `--ground` always rebuilds it from scratch, whatever its status, in a fresh
`grounding-pack-builder` agent, and a turn builds it only when `ground-status` says `missing`. A
turn never rebuilds an existing pack, stale or not. A development run whose change touched a
recorded source runs `--ground` once at its end, at finalization, and commits the refreshed pack
with the change.

---

## What the pack holds

At the `grounding` directory, `.maister/docs/design-context/` by default, in the project the session
runs in — in a multi-repository workspace, in each member repository, never in the workspace root.

| Path | Holds | Binding |
|---|---|---|
| `tokens.md` | the resolved values: hex colours with their token names, font families and sizes, spacing and radii, shadows, and component recipes (what a primary button, a card, an input look like, by the class or component name the code uses) | yes — a turn uses these values and names, never invented ones |
| `shell.html` | the app shell as one still page: header, navigation, sidebar and content frame, with a marked slot for the screen | yes — every screen is drawn inside it |
| `strings/` | i18n strings, copied or excerpted per locale or feature | realistic copy, not lorem ipsum |
| `reference/` | a few still HTML pages of existing screens, to match density and layout | guidance |
| `grounding.json` | what the pack was built from, and its digest | written by `ground-seal` only |

**Images stay where they are.** Screenshots, logos and icons are recorded in `grounding.json` by
path and hash, never copied into the pack. The folder is committed with the project, and docs
checks skip it: it is the studio's, outside the documentation index.

---

## What to harvest

**Resolved values, not pointers.** The pack is read by a turn that will not chase imports, so write
the value a token resolves to beside its name: `--color-primary: #2563eb`, not "see theme.ts". A
value the code computes at run time is written as it resolves for the default theme, and the
dark theme beside it when the project has one.

**Theme sources** — the files the values come from:

- the Tailwind config (`tailwind.config.*`) and other utility configs (`panda.config.*`,
  `uno.config.*`);
- CSS custom-property files — the stylesheets that declare `--name: value` at the root;
- theme modules: `theme.{ts,js,json}`, token files (`tokens*.{json,js,ts,css}`, `design-tokens*`),
  a component library's theme object;
- the theme or component package in the lockfile (a `@chakra-ui`, `@mui`, `@mantine` or shadcn
  setup) — recorded as a lockfile source naming the package.

**Shell sources**, by stack:

| Stack | Shell sources |
|---|---|
| React / Next | `app/layout.*`, `pages/_app.*`, `components/{layout,shell,nav*,header,sidebar}*` |
| Vue / Nuxt | `layouts/*.vue`, `App.vue` |
| Svelte(Kit) | `+layout.svelte` |
| Angular | `app.component.*`, `*layout*` |
| Rails / Django / Laravel | `layouts/application.*`, `base.html`, `layouts/app.blade.php` |
| Plain HTML | `index.html` |

Read the shell sources and draw `shell.html` as the shell renders: real navigation labels, real
component structure, the tokens applied. When nothing matches, record no shell source, write a
minimal `shell.html` — a header and a content frame in the project's tokens — and say in
`tokens.md` that the shell is heuristic, so a later `--ground` in a project that grew a layout
replaces it.

**Strings** — the i18n catalogue (`locales/`, `i18n/`, `messages/`, `*.po`, `en.json`): the
navigation labels and the strings of the features most mockups touch.

**Reference pages** — two or three existing screens worth matching, drawn as still HTML with the
pack's tokens. They are pictures of the product, not code from it.

**Start from what a run already found.** When the task folder holds an
`analysis/codebase-analysis.md`, take its design-system findings first and search only for the
gaps.

---

## Building afresh

Every build, a first one included, starts from an empty pack and writes every file new.

1. **Clear.** `turn.mjs ground-clear --pack=<pack>` deletes everything in the folder but
   `grounding.json` — `tokens.md`, `shell.html`, `strings/`, `reference/`, a stale `.sources.json` —
   and records the build's start in the marker `<pack>/.build-started`. It creates a missing folder,
   so a first build runs it too.
2. **Harvest and write.** Harvest each value again from the sources, the recorded ones and whatever
   *What to harvest* finds now, and write each file from what was harvested. Never read the old
   pack, by any route — a backup copy, its git history, an earlier mockup — to diff or patch it: a
   patch carries only the differences someone noticed, and the seal would then certify the rest as
   fresh.
3. **Seal**, below. `ground-seal` refuses a pack sealed before that was not cleared for this build
   (`pack-not-cleared`) — a pack fresh from a clone or a checkout included, since checkout times
   prove nothing — and one that holds a file older than the clear (`pack-not-rebuilt`). On success
   it removes the marker, which is therefore never committed; the marker is a dot-file, so it is
   in no digest and `ground-status` never reads it.

**`--ground` builds in a fresh agent.** A session that has already read the pack — a mockup turn
reads it on every call — cannot un-read it, and a rebuild in that session writes partly from
memory: values carried over unchecked, content dropped that memory did not hold. So `--ground`
hands the build to the `grounding-pack-builder` agent, which never saw the old pack and is given
only the pack path, the project root and the plugin root. A turn's build of a `missing` pack stays
in the turn: there is no old pack to remember.

**Putting the old pack back.** A caller that needs the old pack on failure copies the whole folder
before the build, and restores by replacing the folder with that copy — the folder removed, the
copy put in its place — so no file the build wrote, the marker included, stays behind.

---

## Sealing

The digest and the source hashes are computed by code, never by the model.

1. Clear the pack with `ground-clear`, then write its files afresh (*Building afresh*).
2. Write `<pack>/.sources.json` with the file tool: `{sources, images}`. Each source is
   `{path, kind, package?}`, `kind` one of `theme`, `tokens`, `lockfile`, `shell` or `i18n`, the path
   relative to the project root; a `package-lock.json` source names its `package`. Each image is
   `{path}`.
3. Run `turn.mjs ground-seal --pack=<pack> --root=<project root>`. It hashes every source and image,
   computes the digest over them and the pack's own files, writes `grounding.json` and deletes
   `.sources.json` and the build marker. It prints the digest and the counts. A refusal keeps the input file; its
   recovery is in `turn-contract.md`.

A hash is the file's git blob hash, so it matches what git records. A text file (one with no NUL
byte) is hashed with its CRLF line endings read as LF, as git stores text, so a checkout that
converts line endings — Git for Windows does by default — leaves a pack sealed elsewhere fresh; a
binary file is hashed as it is. A `package-lock.json` source
hashes `<package>@<version>` instead of the whole file, so a lockfile change for other packages does
not stale the pack. The pack's own files are in the digest too: a hand edit to `tokens.md` changes
it.

---

## Staleness

`turn.mjs ground-status --pack=<pack> --root=<project root>` reads `grounding.json` and writes
nothing. It prints a `status` — `fresh`, `stale` or `missing` — with its reasons and the paths that
changed or went.

A pack is **stale** when a source's blob hash differs or the source is gone, when the version
recorded for a `package-lock.json` package differs, or when its schema version is below the
plugin's. A schema version above the plugin's reports `schema-newer` and stays fresh: the pack is
used and never rebuilt by a turn. There is no time-based expiry, and images never make a pack stale;
only `--ground` replaces them.

**What a run changed** is a separate question. With `--state=<run's orchestrator-state.yml>`,
`ground-status` also prints `base`, the commit the run started from (`task.base_commit`, null when
the run recorded none), and `touched`: the recorded sources whose content at that commit differs
from the working tree now, or that exist on one side only, by the same hashing rules. A pack stale
before the run and left alone by it is not touched; with no pack or no base, `touched` is empty. A
base git cannot read is refused as `base-unknown`.

---

## The per-turn read

After `ground-status`, a turn reads:

- **the pack** — `tokens.md` is binding: every colour, font, radius and shadow on a screen comes
  from it, by name. `shell.html` frames every screen, drawn into each screen's own html. `strings/` gives the copy;
- **the standards** `.maister/docs/INDEX.md` lists for frontend, UI and UX — paths under
  `standards/frontend/` or `standards/design/`, or headings about components, accessibility,
  responsive layout, CSS or themes. Their rules bind the screens as the pack does;
- **installed design skills, best effort** — skills or tools in the session whose names or
  descriptions speak of design, UI, themes, tokens or a component library. Consult one for style
  guidance or throwaway mockup markup only, never to write production components. A consult that
  fails, or finds nothing, is skipped without a note.

What was bound goes in the turn's notes as one line: "Bound to the grounding pack (digest
`<first 8>`), 2 frontend standards and the shadcn theme." A deliberate departure from a token or a
standard is an annotation on the screen, with its reason.

---

## The notes a turn writes

The scripts return codes only; the turn writes the sentences into `.turn.json`'s `notes`:

- after building a missing pack: "Built the grounding pack at `<path>`; commit it so later turns and
  machines reuse it."
- with a stale pack: "The grounding pack is stale (<reasons>); run /maister-copilot:mockup-studio --ground to
  refresh it." — the reasons in words: which sources changed or went, or that the pack's schema is
  older than the plugin's.

The manifest records the digest and the staleness either way.

**The pack is never committed by a turn.** It is written in place and the note asks the person to
commit it. In a dispatched run's worktree, a pack nobody commits is lost when the worktree goes; the
note is the only mitigation, and the next turn elsewhere builds it again. A pack a development run
refreshed at its end goes into the run's own commit with the change, or, when the run makes none,
its close says the pack is to be committed with it.
