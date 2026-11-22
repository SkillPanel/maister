# Mockups

For people who draw UI mockups with Maister, on their own or inside a workflow: what a turn draws,
where the versions go, how to look at them, and how the grounding pack keeps screens in your
product's style. The flags are in the [Command Reference](commands.md).

## One turn, one version

`/maister:mockup-studio` draws one new version of a set of mockups per call. That call is a
**turn**. A turn never asks a question: not which format, not whether the screens are right. It
draws, writes the version and stops. When you want changes, run another turn with a note saying
what to change; the earlier versions stay as they were.

```
/maister:mockup-studio "Settings page with a notifications section"
/maister:mockup-studio --turn "Move the save button into the header" --task=.maister/tasks/mockup-studio/2026-11-18-settings-page
```

A turn carries forward the screens of the version it builds on and redraws only what the note (or
`--scope`) changes or adds. A screen keeps its name (its slug) from one version to the next.

**The next turn.** Each turn closes with the exact command for the next one,
`/maister:mockup-studio --turn "<note>" --task=<folder>`, with `--subdir=<subdir>` added when the
versions are not in the default folder. Use that command: a second bare `--turn` from the project
root starts a new set at `v001`. By default the next turn builds on the latest version;
`--against=v002` builds on an earlier one instead.

**Prototype fidelity.** `--fidelity=prototype` also writes a working `prototype.html`, whose scenes
become the version's screens. Without it, a turn draws static pages (`sketch`).

## Where the versions go

A turn started on its own gets a folder of its own, `.maister/tasks/mockup-studio/<YYYY-MM-DD-slug>/`,
named from the note. Every turn is recorded as a small run with its own record folder there; the
next turn on the same set keeps writing into the first turn's folder, so one folder holds one list
of versions however many turns wrote it. With `--task=<dir>` naming another workflow's task folder,
the turn draws there with no record of its own: it belongs to that workflow's task.

Under the folder, in `analysis/mockups/` unless `--subdir` says otherwise:

```
versions/
  index.json            # the published versions, oldest first, and which is latest
  v001/
    manifest.json       # the note, the version it built on, its screens and which changed
    index.html          # the version's gallery: open this file
    <screen>.html       # one page per screen
    prototype.html      # prototype fidelity only
    scope.md            # a written scope only; index.html renders it
  v002/
    ...
<screen>.html           # the latest version's pages
.mockups.json           # the latest version's screens
```

An ASCII version holds `ascii-mockups.md` instead of the pages, and the latest view is
`ascii-mockups.md` beside `versions/`. A written scope holds `scope.md` and its rendered
`index.html`, with no pages, and the latest view is `scope.md` beside `versions/`. A version is never changed after it is written. The pages
beside `versions/` are always the latest version's.

## HTML, ASCII or a written scope

Mockups come in three kinds:

- **HTML** (the default): one page per screen and a gallery page per version. When you run a turn
  in your terminal, it opens that version's gallery, `versions/vNNN/index.html`, in your default
  browser. The closing message names the path too, so you can open it by hand.
- **ASCII**: the screens as text in `ascii-mockups.md`, readable in the terminal. ASCII shows layout
  and placement, nothing about style.
- **Written scope**: no screens, only text. The version is `versions/vNNN/scope.md`: a title, `##`
  sections and `- ` items saying what is in and out. Finish renders it into
  `versions/vNNN/index.html`, with the marks highlighted. Written against an earlier written
  version, each changed item is marked `[added]`, `[removed]` or `[changed]`, and a `[changed]`
  item carries a `was:` line quoting the earlier text; the studio refuses marks that do not match
  the earlier scope. Built on a screens version, or first, the scope has no marks. A written scope
  is chosen per turn with the format `scope`, never as the project's `mockup_format`.

Set the project's default with `mockup_format` in `.maister/config.yml` (`html` or `ascii`; see
[Configuration](configuration.md)). `--format` overrides it for one turn, and is the only way to
ask for a written scope. Every workflow step that
draws mockups reads the same setting.

When the studio's viewer is running, its start page opens the latest version: `ascii-mockups.md` for
an ASCII version, `scope.md` for a written scope that has no `index.html` (one written without
Node), and `index.html` otherwise.

**Looking at the gallery needs no browser tool.** The gallery is a file: open it in any browser.
A browser tool in the session is only used for the turn's own look pass, where it opens the new
pages, fixes what looks wrong and looks once more. Without one, the pages are still written, just
not looked at by the turn, and the closing message says so. Which browser tools Maister can use is
in [Configuration](configuration.md).

## The grounding pack

A mockup looks like your product only when it is drawn from your product's own values. The
grounding pack in `.maister/docs/design-context/` holds them, harvested once from the code so every
turn draws from the same values:

| File | Holds |
|---|---|
| `tokens.md` | The resolved values: colours with their token names, font families and sizes, spacing, radii, shadows, and what a primary button, a card or an input look like, by the class or component name your code uses |
| `shell.html` | Your app shell as one still page (header, navigation, sidebar, content frame); every screen is drawn inside it |
| `strings/` | Copy from your i18n strings, so screens show realistic text rather than placeholder |
| `reference/` | Two or three existing screens drawn as still pages, to match density and layout |
| `grounding.json` | What the pack was built from, so a turn can tell when it has gone stale |

Images such as logos and screenshots stay where they are; the pack records them by path. The pack
is meant to be committed with the project.

**When it is built.** The first turn in a project builds the pack when it is missing, whatever the
project looks like (a project with little UI gets a pack with what there is), and its notes ask you
to commit it. After that, a turn uses the pack as it is. When one of the files the pack was built
from has changed, the turn still uses it and says it is stale.

**Rebuilding it.** `/maister:mockup-studio --ground` rebuilds the pack from scratch, whatever its
state: it harvests every value again from your theme, shell and string files and writes each file
new. It touches no task folder.

**After a development run.** When a development run changes one of the files the pack was built
from (a theme, the app shell, the strings), its last step rebuilds the pack, so later mockups do
not show the old look. The refreshed pack belongs to the change: a run that publishes commits it
with the change, and otherwise the closing message tells you to commit
`.maister/docs/design-context/` with it. If the rebuild fails, the old pack is put back and the run
still finishes, noting that the pack stays stale until `--ground` is run.

## Mockups inside workflows

The workflows draw their mockups with the same turn, so a mockup made on its own and one made
inside a workflow are the same kind of folder.

- **Development.** When the analysis finds the change has screens to design, the UI mockups step
  draws one version under the task's `analysis/design-context/mockups/` and the checkpoint after it
  asks whether to continue. Sending it back with a note draws the next version.
- **Product design.** The sketches step draws one small screen per option of every visual decision,
  plus a "who this is for" screen from the personas, under `analysis/mockups/`. An approach you
  name midway is drawn into the same folder. The final screens step then draws the chosen design
  and drops the sketches, so the latest version holds the final screens alone.
- **Quick design.** When a decision turns on layout or presentation, `/maister:quick-design` draws
  one sketch per option in a single turn, under the task's `mockups/` folder beside `decision.md`.
  Its one question set also lets you ask for mockups or skip them.

**Making chosen screens binding.** Hand a finished design to development with
`/maister:development --design=<task folder or decision.md>`, or name the product-design task
folder as the argument. Development imports the latest screens of a product design, or the screens
of the options a quick design chose (never the rejected ones), as binding: the implementers follow
their layout, copy, field order, labels and visible states, and record any deviation. When the
browser checks run, they also compare the built screens with the mockups.
