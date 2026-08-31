---
name: maister:umbrella
description: Runs a multi-repository workspace — an umbrella directory whose members are checkouts of separate repositories — as one coordinated unit. Scaffolds and validates the workspace manifest, builds the dispatch envelope a workflow node hands to a worker in a member repository, renders that worker's seed prompt, and keeps the dispatch ledger and the per-dispatch outbox that carry results back. Six verbs behind one script, every write atomic and every rejection named. Machinery invoked by a workflow's own orchestrator and by the cockpit daemon; not a workflow a user starts directly.
user-invocable: true
---

# Umbrella Runtime

The coordination half of a multi-repository run. A workspace manifest says which
member repositories exist and how work in them is allowed to behave; this skill
turns a workflow node that names one of those members into a dispatch — an
envelope describing the work, a seed prompt for whoever does it, a ledger entry
that makes it visible, and an outbox that carries the answer back.

**This is machinery, not a feature.** There is no umbrella command and no user
entry point of its own: a user reaches a workspace through a workflow's command,
and that workflow's orchestrator reaches the runtime by name. Nothing in a
user's mental model needs the word "umbrella" in it.

**Nothing here spawns anything.** The runtime describes work and records it; it
never launches a worker, never polls, and never holds a session open. A node
that dispatches writes its envelope, its ledger entry and its marker, and then
the turn ends.

---

## Invocation

One script, six verbs, the exec form:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/umbrella/scripts/umbrella.mjs <verb> [flags]
```

No shebang and no executable bit — the script is handed to `node` explicitly, so
a Windows checkout with no POSIX shell behaves exactly like any other. Node 20
or newer, no dependencies to install.

| Verb | What it is for | Required | Optional | Stdin |
|---|---|---|---|---|
| `init` | Scaffold a workspace: manifest, workflow directory, ledger, outbox | `--root` | `--members-root`, `--force`, `--scaffold` | — |
| `validate` | Judge the workspace, and the named workflow definitions with it | `--root` | `--definition` (repeatable) | — |
| `envelope` | Build and publish one node's dispatch envelope | `--run`, `--node`, `--ledger`, `--root` | — | overrides (JSON) |
| `seed` | Render the worker prompt for an envelope | `--envelope` | `--siblings` | — |
| `ledger` | Run one ledger op | `--ledger`, `--op`, `--actor` | `--dispatch-id` | the op's `args` (JSON) |
| `outbox` | Append one message to a dispatch's outbox | `--outbox`, `--dispatch-id`, `--type` | — | the message body (JSON) |

Both `--flag=value` and `--flag value` are accepted. `--force` and `--scaffold`
are the only boolean flags: they take the bare form, or an explicit
`--force=false`, and never consume the following token. `--dispatch-id`
addresses an entry that already exists, so every ledger op needs it except
`create-entry`, which allocates its own.

Structured input arrives on stdin rather than in an argument so no quoting has
to survive a shell. It is required for `outbox` — each message type demands
fields an empty body could not carry — and optional for `envelope` and `ledger`,
where an absent document simply means "no overrides" and "no arguments".

### Exit codes

| Exit | Meaning | What the caller does |
|---|---|---|
| `0` | The verb ran and was accepted. The JSON report is on stdout. | Continue. Where a verb degrades onto a frozen dispatch line, that line is the **last** line of stdout — read it from the end. |
| `1` | Rejected. **Nothing was published**: every writer commits through a temp file and a rename, so the files on disk are byte-for-byte what they were. The report is still printed, with a named code per rejection. | Look the code up in the tables below and take its recovery. |
| `2` | The runtime itself did not run — a missing module, malformed flags, or input on stdin that was not JSON. Nothing was attempted and there is no code to look up. | Report the message verbatim and hand the run to the workflow's prose orchestrator. Do **not** record the change with an editor tool instead. |

Exit `2` is the row that is easy to mishandle, because the tempting next step is
to do by hand what the script would not do. Don't. A runtime that could not
start is not a runtime that half-ran, and a hand-written envelope or ledger
entry is exactly the drift the script exists to prevent.

---

## When to reach for each verb

**`init`** — once per workspace, before anything else. It writes the manifest,
an empty ledger with its index and log, and the outbox root. Its write scope is
a hard boundary: without `--scaffold` it writes nothing outside the framework
directory, and every target it declines to write is named in the report with a
reason rather than passing silently. With `--scaffold` it will additionally
create a knowledge-directory README and a root guidance stub, but only where
neither already exists — it never rewrites a file it did not author. A second
`init` over an existing manifest refuses unless `--force` is given, and even
`--force` publishes through a temp file and a rename.

Member discovery is a bounded two-level walk: the workspace root's own children
and the children of the members root. A directory carrying a git entry is a
member and ends the walk for its branch, so a repository nested inside a member
is not a second member. The members root itself is never a member, even when it
carries a git entry of its own — that case is warned about and the scan
continues into its children. Members are commonly symlinks to repositories
living outside the workspace; a symlink that cannot be resolved is reported as
unresolved rather than refused, because one broken link should not cost the
operator the other five members.

**`validate`** — before a run, and whenever the manifest or a definition
changes. It is deterministic and involves no model. It parses, checks structure,
checks ids, checks the graph is acyclic, resolves references, applies overlays,
checks gate shape and finally warns on reserved keys, collecting findings within
each stage rather than stopping at the first. Errors exit `1`; warnings alone
exit `0`, so a workspace can carry advisory findings without blocking. Reserved
keys are surface-scoped: the workspace checker warns only on the manifest's own
reserved key, and the workflow keys are the graph checker's to warn about. Both
streams merge into one report.

**`envelope`** — when a workflow node names a member directory and the run is
ready to hand that work out. The envelope is the contract between the run and
the worker, so it is built from the definition rather than from the state: the
runtime re-resolves the definition the run froze, recomputes the graph hash and
compares it with the one the state recorded. A mismatch is refused. The
workspace root is required rather than derived, because the manifest is
consulted unconditionally — for the provider, for the autonomy tier, and to
reject a member the manifest does not declare — and walking up from the run
directory would only guess at which workspace owns it.

Provider and autonomy each resolve down a short chain and refuse at the end of
it rather than acquiring a default nobody chose. A node's own value wins, then
the member's, then the workspace default; an autonomy value outside the frozen
tier vocabulary is refused rather than written, because the envelope would be
invalid the moment it landed.

**`seed`** — after the envelope, to render the prompt the worker starts from. It
is a pure function of the envelope, so its output is reproducible and testable.
The section set and their order are frozen and the prompt is capped; the wording
inside each section is free. A descriptor that would render past the cap is
**refused, never truncated** — a silently shortened prompt is a worker missing
its close-out contract. `--siblings` names the other dispatches in the same
wave, which is what lets the prompt say how many workers are in flight and that
they coordinate only through their outboxes.

**`ledger`** — for every state change to a dispatch. Seven ops: create an entry,
claim it, update its status, add a constraint, add a follow-up, close it out,
and query. Ownership is documented rather than enforced, because enforcing it in
code would lock the daemon out of the same library: the engine owns creation,
claiming and status; the daemon owns constraints, follow-ups and close-out;
query takes no lock at all. Conflicts resolve on read by update time and actor —
the engine wins on status, the daemon wins on follow-ups and close-out.

Every mutating op runs one sequence and no other: take the per-entry lock, read
the entry, mutate it in memory and stamp it, rename the candidate over the
entry, regenerate the index whole, and only then append exactly one line to the
log. The append is last on purpose — the log records the fact, never the intent
— and unlike a trace file it is not advisory: a failed append is a refusal, and
it says the entry is written and the log is behind.

Dispatch ids are allocated under a lock that deliberately sits beside the
entries directory rather than inside it, so no scan of the entries ever sees it.
The next id is one past the high-water mark of both the entries present and the
creations the log records. **Ids are never reused**: deleting an entry does not
free its ordinal.

**`outbox`** — for everything a worker sends back. Messages are append-only and
sequenced, and the sequenced filename *is* the exclusivity: the runtime opens
the next name exclusively, and an existing file is never rewritten. Five message
types, each with its own required field. Two of them degrade when the outbox
cannot be written — a close-out and a follow-up each have a frozen printed line
to fall back on, so the result still reaches the run and the verb exits `0` with
the report marked degraded. The other three refuse, because there is no frozen
line for them and inventing one would freeze a sixth spelling forever. Their
recovery is to retry once the path is writable, or to fold what they carried
into the eventual close-out summary: a lost status line is not a lost result.

---

## The write-order contract

A run under a cockpit or dispatch driver suspends at a gate in exactly this
order, and the order is normative:

1. **every envelope, ledger and outbox write for the current ready set completes
   first** — before the gate request file exists and before the pending marker
   is set;
2. the gate request file is written and the gate index is regenerated;
3. one state patch sets the pending gate marker **and** the node's status to
   suspended, published atomically;
4. the dashboard data is rewritten;
5. the gate-pending marker line is printed as the **last** line;
6. the turn ends. No polling, no idle session.

**Step 1 is the whole mechanism.** The gate hook builds its allow-list per
pending run and compares by exact resolved path. Because every dispatch write
has already completed when the marker goes up, no dispatch, ledger or outbox
write is ever attempted while a gate is pending in that run — so none of them
needs allowing, and the hook needs no knowledge of this runtime at all. Reversing
steps 1 and 3 would produce a run whose own writes are denied by its own gate.

On resume the mirror image holds: the pending marker is cleared **last**, so the
commit point is the resume, not the suspend. A run is suspended from the instant
step 3 publishes until the instant that marker becomes null.

Within a dispatching node the same "record before you announce" rule applies at
a smaller scale: the ledger entry is written before the waiting marker is
printed, because an envelope with no ledger entry is invisible to the cockpit
and a marker with nothing behind it is a run that looks dispatched and is not.

---

## The permissions block is not self-enforcing

The envelope carries the autonomy tier's `permissions` as two lists of atoms,
and **they are data. Nothing in this runtime enforces them, and nothing can.**
The runtime never spawns a worker, so it never sees the process that would have
to be constrained; by the time a worker is running, the envelope is a document it
has already been handed. Enforcement is owed by **whoever spawns the worker** —
the cockpit daemon, or any script standing in for it — and it is owed *before*
the seed reaches the provider.

This is not a theoretical gap. A worker dispatched at `attended`, whose deny list
names `shell(gh pr create)`, committed and opened a pull request, because the
spawner passed a blanket tool allow-list and no layer below it said no. The seed
makes this worse rather than better if it is ignored: the close-out section tells
a worker at a relaying tier that its denial "pauses for an operator to approve" —
so a worker whose tier is unenforced reads a promise that the wait will happen,
finds nothing stopping it, and proceeds.

**The atoms.** Eight, and they are Copilot's tool vocabulary on purpose:

| Atom | Capability |
|---|---|
| `read` | read files |
| `tests` | run the project's tests |
| `write` | modify the worktree |
| `shell(git commit)` · `shell(git push)` · `shell(git merge)` · `shell(gh pr create)` · `shell(gh pr merge)` | the five commands that decide whether work leaves the worktree |

An atom in neither list has no defined answer; the tier presets put every atom on
one list or the other so a spawner never has to invent one.

**Translating them.** On Copilot the atoms are already the vocabulary: pass each
denied atom verbatim, `--deny-tool='shell(git push)'`, `--deny-tool='write'`.
On Claude the reliable lever is **removing the capability**, not describing it:
deny the tool itself, and where a tier must keep a shell, gate it with a
`PreToolUse` hook that inspects the command the worker actually runs.

**A command gate matches the command, never the data it carries.** A worker's
commands routinely *contain* the words of a denied atom without doing it: a
state patch in a heredoc, a commit message, a research finding. During this
runtime's live acceptance a tier gate denied a legitimate state write because
the patch's own prose explained that a directory had arrived by `git subtree
merge`. Strip heredoc bodies and quoted strings before matching, or the gate
denies a worker for what it says rather than what it does — and the worker then
routes around a denial that should never have fired, which is the reflex the
whole design exists to avoid provoking.

**Do not enforce a shell atom with an argument pattern.** A rule of the shape
`Bash(git push:*)` reads like the atom and is not equivalent to it. It matches a
prefix of the command text, so it is defeated by a flag before the subcommand, a
doubled space, a compound `cd x && git push`, a variable, a pipe — and by any
`PreToolUse` hook that rewrites the command before it is judged, which is a
common local setup rather than an exotic one. An argument pattern was observed
failing to stop a push during this runtime's own live acceptance. Treat it as
advisory; put the enforcement in the tool list or the hook.

**The consequence of skipping this** is a run whose autonomy tier is decorative:
every envelope, ledger entry and seed still says `attended`, the worker still
reads that its denials relay to an operator, and nothing is true. A spawner that
cannot enforce a tier should refuse to dispatch at it rather than dispatch and
hope.

---

## When a write is refused

Exit `1` names a code per rejection in the report. The codes are closed
vocabularies, one per surface. Across all of them the same rule holds, and it is
worth stating once before the tables: **re-issuing the same op is the correct
move for exactly one code, `ledger-locked`, and is the failure mode for every
other.** A refusal is a correct answer, not an obstacle; reaching for an editor
tool because the script said no is the drift this whole design removes.

### Workspace — `init` and `validate`

| Refusal | Response |
|---|---|
| `umbrella-manifest-exists` | A manifest is already there and `--force` was not given. This is the guard working. Decide deliberately: keep what exists, or re-run with `--force`, which still publishes through a temp file and a rename. |
| `umbrella-root-unusable` | The workspace root is missing or is not a directory. Nothing about the invocation can be corrected by repeating it — fix the path or create the directory. |
| `umbrella-members-root-outside` | The members root named resolves outside the workspace — a traversal, or an absolute path elsewhere. Nothing was scanned and nothing was written, deliberately: a directory outside the workspace would be recorded as a member path, and a worker is later pointed at exactly that path. Name a directory under the workspace, or point `--root` at the workspace that really holds the repositories. |
| `umbrella-member-unreadable` | A candidate member could not be read at all. This is distinct from an unresolved symlink, which is reported and survived; an unreadable candidate stops the scan because a partial member list would silently drop work. Fix permissions and re-run. |
| `umbrella-unwritable` | The target could not be written. A caller defect only if the path was wrong; otherwise an environment problem. Fix it and re-run. |
| `umbrella-temp-exists` | The temp twin is on disk and less than a minute old, so another writer holds it — a write takes milliseconds. **Do not delete it**: wait a minute and re-run. A temp older than a minute is a crashed writer's leftover and the next write reclaims it itself. |
| `value-not-flow-safe` | A value cannot go on a one-line entry, and the runtime refuses rather than escaping it. Shorten or simplify the value the report names; repeating the write unchanged will loop. |

### Dispatch — `envelope`

| Refusal | Response |
|---|---|
| `dispatch-node-incomplete` | The node names no member directory, or names one the manifest does not declare, or no provider resolves for it. The report names which. Fix the definition or the manifest — this is a caller defect and re-sending will not change it. |
| `dispatch-graph-drifted` | The definition has changed since the run froze its graph. The frozen graph is the contract, and an envelope built from a changed definition would dispatch work the run never planned. Either restore the definition, or start a new run against the new one. Never force past this. |
| `dispatch-autonomy-unresolved` | No autonomy tier is set on the node, on the member, or as a workspace default. A scaffolded workspace always has the default, so this is a hand-written manifest failing loudly on purpose. Declare a tier. |
| `dispatch-autonomy-unknown` | A tier was found but is outside the frozen vocabulary. The envelope would be invalid the moment it landed. Correct the spelling at the level the report names. |
| `dispatch-workflow-not-driver-capable` | The node dispatches into a member but names a workflow that cannot run under a driver — it would ask a question no one is there to answer. Point `uses:` at an orchestrator skill or a `workflow:`, or drop the `dir:` and run the step in the coordinating repository. Nothing was written. |
| `dispatch-closeout-impossible` | The node's close-out override demands a pull request while its autonomy tier can never open one — the tier denies the command and has no operator to approve it, so the worker would be handed a contract its own permissions forbid. Dispatch the node at a tier that permits a pull request, or drop the override and let the tier decide what close-out means. Nothing was written. |
| `dispatch-envelope-exists` | An envelope for this node is already published. The runtime never overwrites one, because a worker may already hold it. If the dispatch really is being redone, it is a new dispatch. |
| `dispatch-unwritable` | The dispatch directory could not be written. Fix the path or its permissions, then re-run. |
| `dispatch-temp-exists` | Another writer holds the temp twin. Wait a minute and re-run; delete nothing. |
| `value-not-flow-safe` | As above — an envelope value cannot be emitted safely on one line. Simplify it rather than repeating the write. |

### Seed

| Refusal | Response |
|---|---|
| `seed-envelope-invalid` | The envelope named does not read as one. It is the `envelope` verb's output and nothing else should be handed here; if it was hand-edited, that is the fault. |
| `seed-over-cap` | The prompt would run past its frozen cap. It is refused rather than truncated, because a truncated prompt silently loses the close-out contract at the bottom. Shorten what feeds it — fewer siblings, a shorter task description — and render again. |

### Ledger

| Refusal | Response |
|---|---|
| `ledger-locked` | **The one code whose recovery is to repeat the op.** Another writer holds the entry lock or the allocation lock. Wait and re-issue the same op; never delete the lock file. A temp older than a minute is reclaimed automatically by the next writer. |
| `ledger-entry-missing` | The dispatch id names no entry. Either the id is wrong or the entry was never created — a caller defect either way. |
| `ledger-entry-exists` | Creation was asked for an id that already has an entry. Ids are never reused; this is a caller holding a stale id. |
| `ledger-entry-unreadable` | The entry is on disk but does not parse. The file needs repair; no op can proceed and repeating one will not help. Report the message verbatim. |
| `ledger-op-unknown` | The op name is outside the seven. A typo, or a caller built against a different version. |
| `ledger-args-invalid` | The arguments on stdin do not carry what the op needs. The report says which field. Fix the arguments and re-send — this is the one caller defect where a *corrected* re-send is the whole recovery. |
| `ledger-status-illegal` | A status outside the frozen enum, or a transition out of a closed entry. Closed is terminal by design; reopening a dispatch means creating a new one. |
| `ledger-unwritable` | The ledger path could not be written. **Read `entry_written` before deciding.** Absent or `false`: nothing was published, so fix the environment and re-issue. `true`: the entry is written and only the index regeneration failed — the index is behind, the next op of any kind regenerates it, and re-issuing *this* op would apply the mutation twice. |
| `ledger-temp-exists` | **The entry is written and the index is behind** — this code is not reachable as a lock conflict, because a held entry lock is reported as `ledger-locked`. It means the shared index temp stayed held across every retry, after the entry was already committed. Do not re-issue the op; any later op regenerates the index. |
| `ledger-log-unappendable` | **Read this one carefully: the entry is written, the index is current, and the log is behind.** The append is not advisory, so it is reported rather than swallowed, but the entry itself did land. Do not re-issue the op — that would apply the mutation twice. Fix the log's writability; the next op's append will follow. |

**The three flags a refusal may carry beside its code.** They are the whole of what tells a
recoverable report from a caller defect, and they are set only after a rename has published
something:

| Flag | What it says |
|---|---|
| `entry_written` | The entry file is on disk with the mutation applied. Every flag below implies it. **Re-issuing the op would apply the mutation twice.** |
| `index_behind` | `index.yml` does not yet reflect the entry. It is derived and self-healing: the next op of any kind regenerates it whole from `entries/`. |
| `log_behind` | The `ledger.log` line for this op was not appended, and nothing backfills it. Repair the log path; the entry is not in doubt. |

`add-constraint` is idempotent on `{kind, ref}` and `add-followup` on the follow-up id, so a
caller that re-issues one of them against an entry that already carries the same record does
not double it. Nothing else in the seven is idempotent, which is why the flags are the
instruction and "re-issue" is not.

### Outbox

| Refusal | Response |
|---|---|
| `outbox-type-invalid` | The message type is outside the five. A caller defect. |
| `outbox-message-invalid` | The body is missing the field its type requires. The report names the field. Fix the body and re-send. |
| `outbox-sequence-taken` | The next sequence kept being claimed by another writer across several attempts. Unlike the lock codes this one means genuine contention rather than a stale file: re-issue once the burst subsides. |
| `outbox-unwritable` | The directory could not be created, or the exclusive open failed for a reason other than the name being taken, or the file could not be flushed — in which case the partial file is removed before refusing. Retry once the path is writable, or fold what the message carried into the eventual close-out summary. |
| `outbox-unreadable` | The dispatch directory exists but cannot be listed, so no sequence can be chosen. Fix permissions and re-issue. |
| `value-not-flow-safe` | A body value cannot be emitted safely on one line. Simplify it rather than repeating the write. |

---

## What this runtime does not do

- **It does not spawn workers.** It writes what a worker needs and records that
  it did; launching anything is another layer's job.
- **It does not roll back.** A refusal leaves the workspace exactly as it was,
  which is why there is nothing to undo. On a failure the run stops, the
  situation is analyzed, and the operator decides — never an automatic revert.
- **It does not repair.** An unreadable entry, a non-canonical file or a drifted
  graph is reported and handed back. Every recovery in the tables above is
  something a person or an orchestrator chooses, not something the script does
  on their behalf.
- **It writes nothing outside the framework directory** unless `--scaffold` says
  so, and even then only where nothing exists to overwrite.
