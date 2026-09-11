# Gate hooks for Copilot CLI

`maister-gates.json` registers three hooks with Copilot CLI (≥ 1.0.80). They are the
same three Node scripts the Claude Code side runs — one implementation, two payload
vocabularies:

| Event | Script | What it does |
|---|---|---|
| `preToolUse` | `gate-enforce.mjs` | While a run has a gate pending, denies every mutating tool call except the engine's own state, request, index and dashboard files |
| `agentStop` | `gate-stop-nudge.mjs` | Blocks a stop when a gate node is running but its request file was never written |
| `sessionStart` | `gate-beacon.mjs` | Writes the session's liveness marker so a driver can tell that the hooks are live |

`gate-lib.mjs` is the shared module the three import. It is not registered, and it must
sit beside them: each script resolves it as a sibling.

Requirements: Node.js ≥ 20 on `PATH`. The scripts have no dependencies, read only
`node:` builtins, and never reach the network.

## Which command runs

Every entry carries both a `bash` and a `powershell` command. Copilot picks `bash` on
POSIX and `powershell` on Windows; the two differ only in how the environment variable
is spelled (`$COPILOT_PROJECT_DIR` vs `$env:COPILOT_PROJECT_DIR`). Both invoke the
script through `node` explicitly, so nothing depends on a shebang or an executable bit.

`$COPILOT_PROJECT_DIR` is the git root Copilot resolved for the session — the CLI sets
it in the hook's environment (alongside `COPILOT_CLI_BINARY_VERSION` and `COPILOT_CLI`).

## The plugin root — one variable to export

The skills in this variant spell the plugin's own directory as
`${MAISTER_PLUGIN_ROOT}` in every exec form — the `node <root>/skills/…` lines the
umbrella, the workflow engine, the chain planner and the mockup studio ask an agent to
run. Copilot CLI exports no plugin-directory variable of its own; the four it does
export name the session and the CLI build, not where a plugin was loaded from. So the
instruction resolves only if the variable is in the environment, and an agent that finds
it unset has to work the directory out and substitute an absolute path — which one proof
session did, correctly, on an instruction that was literally false.

Export it once, pointing at the directory holding `.claude-plugin/plugin.json` — the same
directory `--plugin-dir` names:

```bash
export MAISTER_PLUGIN_ROOT=/absolute/path/to/maister-copilot
```

The variant's own runtime reads it too, so the path a skill tells an agent to run and
the path the runtime resolves from are one answer rather than two. The Claude Code build
needs nothing here: its host exports `${CLAUDE_PLUGIN_ROOT}`, which is the same
directory under the name that build's skills use.

## Installing — repository hooks

The shipped file is a **template**: Copilot resolves hooks from the consumer's own
repository, never from `--plugin-dir`. Copy the whole directory into the target
repository:

```bash
mkdir -p <repo>/.github/hooks
cp .github/hooks/* <repo>/.github/hooks/
```

`<repo>` must be the git root of the working directory Copilot runs in — that is where
`$COPILOT_PROJECT_DIR` points, and the paths in the registration are written against it.
No edit is needed for this variant.

In headless `-p` mode, repository hooks additionally need to be enabled:

```bash
GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true copilot -p "…"
```

The variable has to be **in the environment** — there is no flag for it. A folder the
user has marked trusted is the alternative. Interactive sessions in a trusted folder
need neither.

## Installing — user hooks

Hooks under `~/.copilot/hooks/` always fire, in every session and every folder, with no
opt-in variable. Use this variant when the repository must stay untouched (an eval
harness, a machine-local driver setup):

```bash
mkdir -p ~/.copilot/hooks
cp .github/hooks/* ~/.copilot/hooks/
```

Then rewrite the script directory in the **copied** `maister-gates.json`:

- `bash`: `$COPILOT_PROJECT_DIR/.github/hooks` → `$HOME/.copilot/hooks`
- `powershell`: `$env:COPILOT_PROJECT_DIR/.github/hooks` → `$env:USERPROFILE\.copilot\hooks`

Do it through the parsed object, not through the file's text. The PowerShell path
carries backslashes, and every one of them is an escape character inside JSON:

```bash
node -e '
  const fs = require("node:fs");
  const file = `${process.env.HOME}/.copilot/hooks/maister-gates.json`;
  const registration = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const entries of Object.values(registration.hooks ?? {})) {
    for (const entry of entries) {
      if (typeof entry.bash === "string") {
        entry.bash = entry.bash
          .split("$COPILOT_PROJECT_DIR/.github/hooks").join("$HOME/.copilot/hooks");
      }
      if (typeof entry.powershell === "string") {
        entry.powershell = entry.powershell
          .split("$env:COPILOT_PROJECT_DIR/.github/hooks").join("$env:USERPROFILE\\.copilot\\hooks");
      }
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(registration, null, 2)}\n`);
'
```

> **A bad escape disables every hook, silently.** A textual substitution that drops
> `$env:USERPROFILE\.copilot\hooks` into the file writes invalid JSON — `\.` is not a
> JSON escape. Copilot answers an unparseable `maister-gates.json` by registering
> *nothing*: no error, no warning, no denials, and a session that walks straight
> past a pending gate. Nothing in the session's output says so. If you must edit by
> hand, the separator is doubled in the JSON source — `$env:USERPROFILE\\.copilot\\hooks`
> — and the file has to survive `node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))' ~/.copilot/hooks/maister-gates.json`
> before you trust it. The liveness beacon below is the runtime check: no marker,
> no hooks.

Nothing else changes: the scripts themselves take the working directory from the payload,
not from where they are installed.

## The liveness beacon

`gate-beacon.mjs` writes one marker file per session — `<session-id>.json`, carrying the
provider, the Node version and the working directory. It goes to `$MAISTER_BEACON_DIR`
when that is set in the spawn environment, otherwise to `~/.maister-cockpit/beacons/`,
and to a temporary directory if home is unwritable.

The marker is never written under the working directory: a per-session file inside a
tracked project tree would show up in `git status` in every session.

A driver treats "no marker for this session" as *the hooks are not live here* — Node
missing, the scripts not installed, repository hooks not enabled, or the environment
variable not passed through. That is the whole point of the beacon, so do not silence it.

## Behaviour worth knowing before debugging

- **Denies are JSON on stdout at exit 0.** On this provider an exit 2 shows only
  `hook exited with code 2` and discards both stdout and stderr, taking the explanation
  with it — so even an internal error answers with a deny at exit 0. A non-zero exit
  from these hooks is a bug.
- **Allows are silent**: empty stdout, exit 0, never an explicit allow decision — an
  explicit allow would bypass the terminal user's own permission prompts.
- **Nothing is read when no run has a gate pending**, so the cost on an ordinary session
  is a Node cold start (budget: ≤ 100 ms).
- `MAISTER_GATE_TRACE=<file>` appends one JSON line per decision. Off by default.
