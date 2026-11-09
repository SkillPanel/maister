# Turn contract

What one turn writes, the one input file the model writes for it, and what to do when a script
refuses. The scripts take every shape below from `scripts/lib/shapes.mjs`, and the plugin's
interface file publishes the same declarations; this page is the reading of them a turn needs, and
the spelling the no-Node path writes by hand.

---

## Layout

Under `<task_path>/<output_subdir>/`:

| Path | Written by | Holds |
|---|---|---|
| `versions/index.json` | `finish` | the published versions, oldest first, and `latest` |
| `versions/.lock` | `finish` | held while publishing; a lock older than a minute is a crashed turn's and is reclaimed |
| `versions/vNNN/` | `begin` | one version; created exclusively, so two turns never share one |
| `versions/vNNN/manifest.json` | `finish` | the version's note, parent, screens and grounding |
| `versions/vNNN/<slug>.html` | `finish` | one page per screen (html) |
| `versions/vNNN/index.html` | `finish` | the version's self-contained gallery (html) |
| `versions/vNNN/ascii-mockups.md` | the ASCII agent | the version's screens (ascii) |
| `versions/vNNN/prototype.html` | the model | the working page (prototype fidelity, kept after a refusal too) |
| `versions/vNNN/.mockups.json` | `finish` | the version's screen sources, in the flat manifest's shape |
| `versions/vNNN/.turn.json` | the model | the turn's input; deleted when `finish` publishes |
| `versions/vNNN/.frames.json` | `frames.mjs` | the exported scenes; deleted when `finish` publishes |
| `<slug>.html`, `.mockups.json` | `finish` | the flat latest view (html) |
| `ascii-mockups.md` | `finish` | the flat latest view (ascii) |

A version id matches `v` and three or more digits (`v001` … `v999`, then `v1000`). A slug is
lowercase letters and digits joined by single hyphens, never `index` or `prototype`. A version, once
in `index.json`, is never changed. Dot-files are the scripts' own; readers that count files skip
them.

**The flat view** is rewritten only by a publishing `finish`, from the version it publishes: each
page and `.mockups.json` (or `ascii-mockups.md`) is copied beside `versions/`, and a flat page whose
slug was in the previous latest version but is not in this one is removed. No other file in the
folder is touched, so pages a workflow's intake imported there stay. Sources never point into
`versions/`.

**Opening the gallery.** A publishing `finish` of an `html` version, once it has printed its result,
opens `versions/vNNN/index.html` as a file in the default browser, unless the run's driver rules it
out. The run's state is `orchestrator-state.yml` beside `--record`, else in the task path. No state
file is no run, which opens; a driver absent or `terminal` opens; a cockpit, a dispatch, any other
kind or a state that cannot be read opens nothing. `--preview` and ASCII never open. No file records
it, and a failed open changes neither the result nor the exit code.

**INDEX rows** (`finish --index`) keep the columns `| ID | Type | Source | Description |`:
`screen:<slug>` and `component:<id>` rows whose Source is the flat page, or
`<subdir>/ascii-mockups.md#<slug>` for ASCII; behaviour lines are appended to the description as
`; behaviour: …`. A row is the studio's when its Source is the flat page or anchor of a slug in the
previous latest version or the new one; those rows are replaced in place, and every other row and
the text around the table are kept.

---

## The input file, `vNNN/.turn.json`

Written by the model with its file tool, read by `finish` from that one place — never a link, never
reached through `..`.

| Key | Required | Holds |
|---|---|---|
| `note` | yes | the turn's note; `""` allowed |
| `format` | yes | `html` or `ascii` |
| `fidelity` | yes | `sketch` or `prototype`; a prototype is html |
| `against` | no | the version `begin` printed, copied as is (null on a first turn). Absent, `finish` builds on the index's `latest`, which a concurrent turn may have moved |
| `scope` | no | the slugs the note set out to change or add |
| `grounding` | yes | `{digest, stale}`: the pack's digest (null without a pack) and whether it was stale |
| `screens` | sketch and ascii | the changed and new screens; absent for prototype, whose screens come from `.frames.json` |
| `drop` | no | slugs of `against`'s screens to leave out |
| `degraded` | no | reason codes from the skill's degradation table |
| `notes` | no | the lines the person reads |
| `prototype` | no | `prototype.html` when the turn wrote one |

A screen is `{slug?, title, html?, css?, annotations?, description?, behaviour?, components?}`:
`annotations` a list of `{selector, note}`, `behaviour` a list of lines, `components` a list of
`{id, description}` that become component rows. A screen with no `slug` takes `against`'s slug for
the same title, else a fresh one made from its title, with `-2`, `-3` … on a collision.

**How the screens resolve.** `against`'s screens, when it has the same format, minus `drop`, with
each sent screen replacing the one of the same slug or adding a new one; across formats, exactly the
screens sent. A screen is changed when it is new, or its title, html or css differs; for ASCII,
every sent screen is changed. An empty result is refused, never an empty `screens` list on its own.

---

## The files a turn writes

The no-Node path writes the first two by hand, exactly in these keys; everything else here is
written by `finish` alone.

**`versions/vNNN/manifest.json`**

| Key | Type | Required | Notes |
|---|---|---|---|
| `version` | string | yes | `vNNN` |
| `created` | string | yes | ISO-8601 UTC, the clock captured at the turn's start |
| `note` | string | yes | `""` allowed |
| `parent` | string or null | yes | the version built on |
| `format` | string | yes | `html` or `ascii` |
| `fidelity` | string | yes | `sketch` or `prototype` |
| `prototype` | string | no | `prototype.html` when that file exists |
| `screens` | list | yes | `{slug, title, changed, live?, behaviour?}`; `live` is `prototype.html#<slug>` |
| `grounding_digest` | string or null | yes | null when there was no pack |
| `grounding_stale` | boolean | yes | |
| `degraded` | list | no | reason codes; absent when there are none |

**`versions/index.json`** — `{latest, versions, bookmarked?}`. `latest` is the version published
last (null before the first). Each entry of `versions`, oldest first, is
`{version, created, note, parent, changed}`, `changed` the changed slugs. `bookmarked` is edited by
hand only and kept as found. By hand: read the file (or start from `{latest: null, versions: []}`),
append the entry, set `latest`, and write it whole.

**`.mockups.json`**, per version and flat — `{latestId, mockups}`, each mockup
`{id, title, html, css, annotations}` with `id` the slug; `latestId` is the first changed slug, else
the first screen. It is the carry-over source for the next turn. The no-Node path writes none: an
ASCII version carries its screens in `ascii-mockups.md` and its manifest.

**`turn-result.json`** (`finish --record`, the workflow's node only) — `{version, against, screens,
changed, notes, degraded?, format, fidelity, task_path, output_subdir, gallery}`: `screens` and
`changed` slug lists, `task_path` the target relative to the project root, `gallery` the version's
`index.html` relative to `task_path`, null for ASCII. It is the turn's return value, and what a
driver reads beside the node's values.

**The node's values**, printed by `finish` as `values` — `version`, `against`, `screens` and
`changed` comma-joined, `degraded` a boolean, `notes_count` a decimal string, `format`, `fidelity` —
recorded unchanged by the workflow's node.

---

## Refusals

Exit 1 prints `{ok: false, code, message}`; the message says what happened, what landed and what to
do. Exit 2 is a usage error or an unexpected failure, a message on stderr: correct the command, or
report the failure. The write primitives' own codes are always reported as `folder-unwritable`.

| Code | Raised by | Recovery |
|---|---|---|
| `against-unknown` | `begin` | The `against` given is not in `versions/index.json`, and nothing was written. Begin again with a version the message lists, or with no `against` to build on the latest |
| `version-exists` | `begin` | Another turn took that number first; nothing was written. Run `begin` again, which allocates the next free number |
| `index-malformed` | `begin`, `finish` | `versions/index.json` cannot be read as the version list — or, at `finish`, the manifest of the version built on, or that html version's `.mockups.json` (missing, unreadable, or lacking a screen), cannot be read; nothing was written. Repair the file the message names, or restore it from version control, then run the same command again; at `finish` you may instead build on another version. Never delete the index: it is the only list of what was published. Only an ascii version may lack `.mockups.json` |
| `folder-unwritable` | `begin` | The `versions/` or version folder could not be created; nothing was written. Make the target folder writable and begin again |
| `version-unknown` | `finish` | No such version folder: `begin` was not run, or a different id was passed. Run `begin` and finish the id it prints |
| `version-published` | `finish` | That version is already in the index, so it was published before. Nothing was written; begin a new version for further changes |
| `turn-file-missing` | `finish` | `.turn.json` is not in the version folder — or, for prototype fidelity, `.frames.json`, or for ascii, `ascii-mockups.md`. Nothing was written; write the missing file (run the export, or dispatch the ASCII agent) and finish again |
| `turn-file-malformed` | `finish` | An input file is a link, not JSON or not the declared shape; or it asks for a prototype in ascii, has no screens for sketch or ascii, or builds on a version that is not published. Nothing was written and the file is kept; correct it as the message says and finish again |
| `slug-invalid` | `finish` | A slug in `screens`, `drop` or `scope` is not a slug, is reserved, or two screens name the same one. Nothing was written; correct the slug in `.turn.json`, or leave it out to have one made from the title, and finish again |
| `screens-empty` | `finish` | Carry-over, `drop` and the sent screens leave nothing. Nothing was written; send at least one screen, or drop fewer, and finish again |
| `index-locked` | `finish` | Another turn is publishing into this folder. Nothing was written; run `finish` again in a moment |
| `folder-unwritable` | `finish` | Before publishing: nothing was published and the input is kept; make the folder writable and finish again. **During publishing, the message lists what already landed; once the index entry has landed the version is published — never run `finish` for it again.** Fix the permissions and run the next turn, which rewrites the flat view and the rows |
| `sources-file-missing` | `ground-seal` | No `.sources.json` in the pack folder; nothing was written. Write the list of sources and images there and seal again |
| `sources-file-malformed` | `ground-seal` | `.sources.json` is a link, not JSON, not the declared shape, or names an absolute or `..` path. Nothing was written and the file is kept; correct it and seal again |
| `source-missing` | `ground-seal` | A listed path is not a file under the project root, or a `package-lock.json` entry names a package the lockfile lacks. Nothing was written; correct the path or drop the entry and seal again |
| `pack-not-cleared` | `ground-seal` | A pack sealed before was not cleared for this build: no `ground-clear` ran, so nothing proves its files were written afresh — a pack patched in place, or one fresh from a clone or checkout, whose file times prove nothing. Nothing was written and the input file is kept. Run `ground-clear`, build every file again from the sources, as `grounding-pack.md` says, write `.sources.json` and seal again |
| `pack-not-rebuilt` | `ground-seal` | A pack file is older than the build's `ground-clear`, so it was carried over (copied back with its times kept) rather than written for this build; the message names them. Nothing was written and the input file is kept. Build those files afresh from the sources (delete one the build no longer makes), and seal again — never touch a file to pass the check |
| `folder-unwritable` | `ground-seal` | `grounding.json` could not be written; the input is kept. Make the pack folder writable and seal again; a turn meanwhile draws as `grounding-unavailable`. When the message says the pack is sealed, only the build marker was left: delete `.build-started` by hand and never commit it |
| `not-a-pack` | `ground-clear` | The folder holds files but neither `grounding.json` nor a build marker, so it is not a grounding pack, and nothing in it was deleted. Check `--pack` names the pack folder; empty the folder yourself only if it really is the pack |
| `folder-unwritable` | `ground-clear` | The pack folder could not be read, cleared or marked; the message says how far it got. Make it writable and run `ground-clear` again, then build every file |
| `base-unknown` | `ground-status` | `--state` could not be read as a run's state, or the base commit it records is not a commit git can read in the project (history rewritten, no repository). Nothing was written. The run cannot tell which sources it changed: leave the pack as it is and refresh it with `--ground` if the change touched it |
| `grounding-malformed` | `ground-status` | `grounding.json` exists but cannot be used. Nothing was changed. A turn draws without the pack (`grounding-unavailable`) and its note says to run `--ground`, which rebuilds the pack whatever its state |
| `prototype-missing` | `frames.mjs` | No `prototype.html` in the version folder. Write it, or fall back to sketch screens (`render-failed`) |
| `script-missing` | `frames.mjs` | Not exactly one classic inline `<script id="mockup-scenes">` — none, two, a module or a `src`. Fix the page and export again, or fall back to sketch (`render-failed`) |
| `scenes-invalid` | `frames.mjs` | `scenes` is not a non-empty list of maps with a distinct valid slug id and a title, an id is reserved (`index`, `prototype`), or a scene's annotations or behaviour are not lists. Fix the scenes script in `prototype.html` and export again, or fall back (`render-failed`) |
| `render-touches-dom` | `frames.mjs` | `render` reads a browser global. Fall back to sketch screens with the degraded code `render-touches-dom`; the page's own runtime script is where DOM work belongs |
| `render-timeout` | `frames.mjs` | The script or a `render` ran past two seconds — a loop, or an async render. Fall back (`render-failed`); `render` must return synchronously |
| `render-not-string` | `frames.mjs` | A `render` returned something other than a string, a Promise included. Fall back (`render-failed`) |
| `render-threw` | `frames.mjs` | A `render` threw, or there is no `render`. Fall back (`render-failed`) |
| `folder-unwritable` | `frames.mjs` | `.frames.json` could not be written. Fall back (`render-failed`) |
| `root-missing` | viewer `start` | The folder to serve does not exist; nothing started. Run `begin` first, or pass the folder that holds `versions/` |
| `ports-busy` | viewer `start` | 3847–3850 are all taken; nothing started. Open the pages by `file://` path, or skip the look pass with a note |
| `folder-unwritable` | viewer `start` | The viewer could not record its pid file and has already ended. Make the folder writable, or skip the look pass with a note |

**Falling back from a prototype.** A `frames.mjs` refusal writes nothing, but an older
`.frames.json` from an earlier attempt stays: delete it before `finish`, write the sketch screens
into `.turn.json`, set `fidelity: sketch` and add the degraded code. `prototype.html` is kept, and
the manifest still names it.
