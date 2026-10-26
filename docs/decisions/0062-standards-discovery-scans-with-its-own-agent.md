# ADR-0062 — Standards discovery scans with its own agent

**Status**: Accepted · **Date**: 2026-10-26 · **Sources**: `plugins/maister/agents/standards-scanner.md`; `plugins/maister/skills/standards-discover/SKILL.md` (Phases 2-5) and its `references/*-prompt.md`; the built-in agent definitions of GitHub Copilot CLI 1.0.103; the Claude Code subagent documentation (`code.claude.com/docs/en/sub-agents.md`)

## TL;DR
Standards discovery dispatches `standards-scanner`, a plugin agent, for each of its four sources,
in place of the host's general-purpose agent. The agent file carries what every scan needs and a
prompt cannot be trusted to carry: the containment and scratch-file sentences, absolute paths
with no `cd`, read-only on the project, one file written. Its exploration practices are taken
from the two hosts' own built-in explorers.

## ADR-0062 {#adr-0062}

### Status
Accepted. Moves no graph hash: standards discovery is a skill, not a workflow definition.

### Context
Standards discovery was the only skill to dispatch the host's general-purpose agent. That agent
has no file in this plugin, so it was given only what the phase template said. A template
cannot hold everything a scan needs: the template is filled in by the session that dispatches
it, and a rule left out of the prompt never reaches the agent. A general-purpose scan that ran
`cd src && … ../test` drew a path-access prompt on a host that cannot place `..` or a bare glob.
The absolute-path and scratch-file rules every plugin agent carries had not reached it, because
there was no agent file to carry them.

#### What each host's built-in explorers do

**GitHub Copilot CLI** ships its agents as definitions on disk. Each sets its model, its effort,
its tools and the parts of the system prompt it includes.

| Agent | Model and effort | Tools | What its prompt asks |
|---|---|---|---|
| `explore` | A list of cheap models, the first available winning; `reasoningEffort: low` | Read-only: grep, glob, view, the shell and its read/stop calls, LSP, read-only repository-host tools | Absolute paths for every file reference; stop as soon as the question can be answered; short answers that cite paths and line numbers; every independent call in one parallel turn; targeted searches, reading only the files that bear on the answer |
| `research` | A named mid-tier model | All | Search to discover, fetch to investigate: a few searches find where things are, then the files are read directly and in parallel; work autonomously, ask nothing, make reasonable assumptions; every claim cited with a path and a line range, never a whole file; a closing section on gaps — what was searched for and not found, what is inferred rather than verified |
| `code-review` | The session's | All, used to investigate only | Never modify code; verify a concern before reporting it; report only high-confidence issues, in a fixed per-issue shape with the file and line; silence over noise |
| `task` | A list of cheap models | All | Brief on success, full output on failure; no retries and no fixes |

Each one includes the environment context, which tells it its working directory, and the
parallel-tool-calling instructions. None of them includes the custom agent instructions.

**Claude Code's** built-in Explore is a read-only search agent: Write and Edit are denied to it.
It runs on the session's model unless a configuration names another, and it skips the CLAUDE.md
hierarchy and the git-status snapshot to stay fast. The caller states the thoroughness it wants
in the prompt, and the agent returns its result as text. The documentation does not publish its
system prompt.

A plugin agent on Claude Code receives its file's body as its system prompt, the delegation
message, and the working directory. It inherits nothing from the conversation, so a rule it must
keep is in its file or in its prompt. It ignores `hooks`, `mcpServers` and `permissionMode` in
its frontmatter. A `cd` does not persist from one shell call to the next. The Copilot build gives
every plugin agent its own tool list, so a source agent declares none.

### Decision
- **One agent for every source.** `standards-scanner` scans the source its phase brief names:
  configuration, code, documentation, or pull requests and CI. Standards discovery dispatches
  one per applicable phase, all in one parallel turn, on both hosts, with the model and effort
  `workflow.mjs dispatch-model --agent=maister:standards-scanner` prints.
- **The brief stays per phase.** Each `references/*-prompt.md` keeps what differs by source:
  what to look at, what to detect, the sampling bounds, the confidence range and the YAML
  schema. What every scan shares — the output rules, the evidence rules, the path rule — lives
  in the agent, once.
- **What the agent takes from the built-ins:**

| Practice | Taken from | Why here |
|---|---|---|
| Every path absolute, no `cd`, every command from the project root | Copilot's `explore`, `research` and `code-review`; Claude Code's non-persistent `cd` | A relative path resolves from the root, not where the agent meant, and a host may stop the run to ask for a path it cannot place |
| Read-only on the project; one file written, the findings file | Copilot's `explore` tool list, `code-review`'s never-modify rule; Claude Code's Explore | A scan has no reason to change the project, and the merge step reads one file per source |
| Find with glob and search, then read the deciding files | Copilot's `research` (search to discover, fetch to investigate) | A count from a search is evidence of frequency; reading a file is evidence of what the convention is |
| Independent reads and searches in one parallel turn | Copilot's `explore` and `research` | Four scans already run at once; inside each one, a sample read file by file is the slow part |
| Sample within the brief's bounds, and stop once a pattern is settled | Copilot's `explore` (stop when the question can be answered) | The scan measures what the project does; it does not catalogue every file |
| Evidence as counts and `path:line`, at most three example paths | Copilot's `research` citation rule, `explore`'s path-and-line answers | The user decides from the evidence, and the merge step scores by it |
| Ask nothing; a missing source is skipped and named | Copilot's `research` (autonomous; report gaps) | The scan has nobody to ask; a missing source is a gap, not an error |
| Exact schema, the file written even when empty; a short final message | Copilot's `task` (brief on success) | A missing or unparsable file means the source did not run, and the skill re-dispatches it. The findings travel in the file, not in the message |

- **The session's model.** The scanner has no shipped `subagents` entry, so `dispatch-model`
  answers `omit` and the call runs on the session's model, as the general-purpose scans did.
  The built-in explorers answer "where is X" on a cheap model at low effort. A scan does more:
  it judges whether a pattern is a convention and how strongly the evidence holds. A project
  that wants the scans cheaper names `standards-scanner` in its `config.yml`.

### Consequences
- The scratch, containment and plugin-path lints cover the scanner as they cover every agent.
  The Copilot build gives it the shared tool list, without the agent tool.
- General-purpose stays a built-in agent type that a project's own workflow may name. No skill
  of this plugin dispatches it any more.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Add the path rule and the scratch rule to each phase template | Each template would carry the same rules four times over, and they would still depend on the dispatching session copying them into the prompt intact |
| Dispatch the host's explore agent | It is read-only on Copilot and cannot write the findings file; its brief is "answer fast and stop", not "measure and score" |
| One agent file per source | The four differ only in what they read and their schema, which the briefs already hold; four files would repeat the shared rules |
| Put the scanner on the light tier | Scoring a convention needs judgement; the general-purpose scans ran on the session's model, and a project can still lower it |
