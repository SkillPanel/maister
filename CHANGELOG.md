# Changelog

Notable changes per release, newest first. Anything an operator has to *do* on upgrade day is
called out under **Upgrading** — read that section before you install a new version over a
workspace with work in flight.

## 2.3.0-beta.27

A `workflow:` node with no `dir:` now starts a **child run**: an ordinary task directory beside the
parent's, with its own frozen graph, its own gates and its own driver, linked back to the node that
started it. The parent waits while the child executes and adopts the child's outcome when it ends.
Alongside it, a workflow name is now resolved in all four homes — an eject, then a generated chain,
then an overlay, then the shipped built-in — at validate time as well as at run time, which closes a
case where a workspace validated one file and ran another.

### Upgrading

**Every built-in workflow definition's recorded identity moved in this release.** A workflow-level
`outputs:` block now enters the hash envelope, and it enters it unconditionally — a definition that
declares no interface at all is hashed as one that declares an empty one, which is not what the
previous version hashed. So the hash changed for every built-in, including definitions whose text is
byte-for-byte identical to the previous release: nothing in the file moved, the envelope the file is
hashed inside did. The resolution fix is not the cause — where a definition was found never entered
the hash, and still does not.

*What breaks:* a multi-repository workspace holding a **chain run that is still in flight** refuses
its first dispatch after the upgrade. The refusal is this, verbatim:

```
dispatch-graph-drifted: the workflow definition has changed since the run froze its graph (frozen <hash>, now <hash>) — dispatching would run work this run never planned
```

Both hashes are printed in full in the real message. It fires whether or not you touched the chain
definition yourself — nothing in your workspace changed; the engine moved underneath it.

*What to do:* either **finish the chain run on the previous version** and upgrade afterwards, or
**re-freeze the run against the current definition** — re-resolve the definition the run's
`workflow.source` names, read the resulting graph, satisfy yourself it still plans the work the run
has left, and write the fresh `graph_hash` onto the run's `workflow` block through the engine's
`write-state` verb. Re-freezing keeps every node the chain has already completed. Starting a new run
also clears the refusal and discards that progress, so it is the last resort, not the first. Do not
force past the refusal.

*What is unaffected:* an ordinary local run. Resuming one never re-resolves its definition and never
compares its frozen hash against a fresh one — it runs the graph it froze. Every in-flight local run
survives the upgrade untouched, and a workspace with no chain run open has nothing to do.

*Scripting the check:* `umbrella envelope` reads its overrides from stdin and will block if stdin is
a terminal, so run it with stdin closed (`< /dev/null`) when sweeping several runs.
