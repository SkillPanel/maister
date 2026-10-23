# Browser tools

The plugin ships no browser tool. Driving a browser is the user's choice: a step that needs one
uses whatever the session has, and a session with none is told so and carries on without it.
This file is the one place that says how; the browser checks, the user guide and the mockup
gallery point here.

## What a step needs

These capabilities, named by what they do rather than by any tool's command:

- **navigate** — load an address;
- **click** and **type** — act on an element, fill a field, press a key;
- **read the page** — an accessibility snapshot or the page text, to find elements and check state;
- **run a script** in the page — read the DOM, or replace the document;
- **take a screenshot** — saved as a file, the viewport or the full page.

Console messages and resizing the viewport help where the tool has them; a step never depends on them.

## Which tool

Look at what the session offers before the first browser action. A tool the session lists as
deferred is present: load it first. Count only a tool the step's agent can reach: where a host
gives agents a fixed tool list, a server outside it does not reach them, and `playwright-cli`
through the shell is the one that does.

| Tool | Present when | Notes |
|---|---|---|
| `playwright-cli` | `command -v playwright-cli` succeeds, or `npx --no-install playwright cli --help` runs | Shell calls with compact output. `open <url>`, `goto`, `click <ref>`, `fill <ref> <text>`, `press`, `snapshot`, `eval`, `resize`, `close`. `screenshot --filename=<path>` writes where it is told |
| A Playwright MCP server the user configured | tools named `…browser_navigate`, `…browser_snapshot`, `…browser_take_screenshot`, under whatever server name | The screenshot's `filename` lands in the server's own output folder; its result names the path |
| Claude in Chrome | tools named `mcp__claude-in-chrome__*` | Load the ones needed in one search. Work in a new tab. `computer` with `screenshot` and `save_to_disk: true` returns the saved path. Acts in the user's own Chrome, with their sign-ins |
| The built-in browser pane | tools named `…Claude_Browser__*` (Claude desktop app) | Its screenshot result names where the file was saved |

**Preference order** when more than one is present: `playwright-cli`, then a Playwright MCP
server the user configured, then Claude in Chrome, then the built-in browser pane. Use one tool
for a whole step, and say in the step's report which one it was.

Browser steps that run one after another in a run share the tool and its browser: never drive
it from two steps at once.

## Screenshots

Each step names its own screenshot folder in the run (the browser checks use
`verification/screenshots/`, the user guide `documentation/screenshots/`). A screenshot goes
there one of two ways:

- **The tool takes a path** (`playwright-cli`): save it straight into the folder, by absolute path.
- **The tool reports a path** (an MCP server, Claude in Chrome, the pane): bring that one file in
  with the caller's `import_command`, one `--from=<reported path>` per file (and `--as=<name>` to
  rename it); without an `import_command`, copy it. A file the import lists under `skipped` is a
  missing screenshot.

Never look for screenshots by searching a folder or by a broad glob: only the path the tool
reported, or the one the step chose, is the file.

## When there is none

A session with no browser tool is not a failure of the run. Where a browser step would be
offered — the browser checks, a user guide with screenshots, the HTML mockup gallery — say so
plainly before the choice, in this shape:

> No browser tool in this session, so <the step> cannot drive a browser. Any one of these adds
> it: `playwright-cli` (`@playwright/cli`), a Playwright MCP server (`@playwright/mcp`), Claude in
> Chrome, or the built-in browser of the Claude desktop app. Without one, <the browser-less path>.

The browser-less path, per step:

| Step | Without a browser tool |
|---|---|
| Browser checks | Recommend continuing without them. Chosen anyway, the step reports that it could not run, as a follow-up rather than a defect of the change |
| User guide | Recommend leaving it off. On, the guide is written without screenshots and says so |
| Mockup gallery | HTML mockups still render: the gallery opens in the user's default browser, or its address is logged for them to open. ASCII mockups in the terminal are the alternative |

A question that carries the warning offers real choices: each one changes what the run does next.
