# Visual companion

The companion is a small read-only viewer over one mockups folder. A turn starts it for its single
look-and-fix pass, when its browser tool cannot open `file://` pages, and stops it before it returns.
It renders nothing and takes no input: every page, gallery and manifest it serves was already
written by `finish` (or `finish --preview`). A person reviews a version by opening its gallery as a
file; nothing waits on the viewer.

---

## When a turn needs it

Only in step 5 of the turn, and only when all of these hold:

- the format is `html`;
- the session has a browser tool (`<plugin root>/skills/orchestrator-framework/references/browser-tools.md`);
- that tool cannot open the pages by `file://` path.

Otherwise the turn opens the pages by path, or, with no browser tool, skips the look pass with its
note. A viewer that cannot start never fails the turn: skip the look pass and say why in the notes.

---

## Starting and stopping

Both verbs take the folder that holds `versions/` — `<task_path>/<output_subdir>` — as `--root`:

- `node <plugin root>/skills/mockup-studio/server/index.mjs start --root=<folder>` prints
  `{ok, port, url, root}` once the viewer listens;
- `node <plugin root>/skills/mockup-studio/server/index.mjs stop --root=<folder>` ends it and prints
  whether it stopped one. With nothing running, it stops nothing, which is not an error.

The viewer binds `127.0.0.1` only, on the first free port of 3847–3850, records itself in
`<folder>/.companion.pid`, and exits by itself after fifteen minutes without a request — so a turn
that crashed leaves nothing running for long.

**Open the version by its path**: `<url>/versions/vNNN/index.html` and
`<url>/versions/vNNN/<slug>.html`. Never the viewer's `/`: it redirects to the gallery of `latest` in
`versions/index.json`, which during a preview is still the previous version.

What it serves: `GET` and `HEAD` only; `/status` reports `{status, root, port, pid}`; any other
path is a file under the folder. A path that leaves the folder, holds a dot segment or names a
dot-file gets 404, another method 405, and a request whose `Host` is not its own loopback address
403 — so `.turn.json` and the scripts' other dot-files are never served, and a page on another site
cannot read the folder through the browser.

---

## A viewer left behind

`start` reads the pid file first. When it names a live viewer that reports the **same root**, that
viewer is reused and its port printed; nothing new starts. Any other pid file — a dead process,
a viewer of another folder, an unreadable file — is replaced. Two turns on two folders never share a
viewer, and a different `output_subdir` is a different folder.

Refusals — `root-missing`, `ports-busy` and `folder-unwritable` — and what to do about each are in
`turn-contract.md`. All three mean the same for the turn: open the pages by path if the tool can,
else skip the look pass with a note.
