---
name: update-branch
description: Bring the current branch up to date with its default branch — merge it without committing, resolve conflicts from the branch's intent, run the project's checks, commit the merge and move an unfinished run's start commit past the merged-in work
argument-hint: "[--onto <ref>] [--run <task dir>] [--no-run]"
---

**Create a file's directory before the file.** On this host the file-create tool refuses a path whose directory does not exist, so before writing a file into a folder that may not exist yet — a new task or sub-run directory, one of its subfolders, or `.maister/docs/` or `.github/` on a fresh project — run `mkdir -p` on that folder first.

**Dispatch every agent this names, with every field the task tool requires.** On this host the task tool refuses a call without `name`: each agent call carries `agent_type` (the agent named), `name` (a short id you pick, such as `docs-init`), `description` and `prompt`, plus `model` and `reasoning_effort` copied from the `dispatch-model` line printed for that agent, each left out when printed as `omit`. An agent named here is always dispatched, whatever the size of the project or the task, never its work done in this session.

# Update Branch

Merge the default branch into the current branch in one command. When the branch carries an unfinished workflow run, the run's start commit moves to the merged tip afterwards, so its next review measures the run's own change and not everything the merge brought in. No task folder, no engine run, no command file: the skill works the same under any driver.

It never pushes, never stashes, never resets and never makes a work-in-progress commit.

## Usage

```bash
/maister-copilot:update-branch
/maister-copilot:update-branch --onto release/2.4
/maister-copilot:update-branch --run .maister/tasks/development/2026-11-18-search-filters
/maister-copilot:update-branch --no-run
```

- `--onto <ref>` merges that ref instead of the default branch. Pass it when the branch was cut from a branch other than the default one.
- `--run <task dir>` names the run to move; `--no-run` updates the branch alone. Without either, the skill looks for the run itself.

## When to Use

**Use `/maister-copilot:update-branch` when:**
- The branch has fallen behind its default branch and you want it merged, with the checks run before the merge is committed
- A run is under way on the branch and its review should keep counting only the run's own work

**Do not use it** to rebase, to merge a feature branch into the default branch, or to push.

---

## Workflow

Engine verbs are called by the plugin root's absolute path (`${MAISTER_PLUGIN_ROOT}`), one command per line, never chained with another command. The scratch directory for the checks comes from `mktemp -d`, never a literal `/tmp` path.

### Step 1: Check the preconditions

Stop, naming the reason and changing nothing, when:

- the checkout is not a git repository;
- HEAD is detached;
- the current branch is the default branch itself. Its name comes from Step 2's default-branch order read from the refs as they are, without fetching: the order needs no fetch, and the fetch only updates a tip, never the name, so this check runs first without waiting on it.

Look for `MERGE_HEAD` (`git rev-parse -q --verify MERGE_HEAD`). With **no** merge in progress, also stop when:

- the index holds staged changes (`git diff --cached --quiet`) — name them;
- git refuses the merge over local or untracked files — the skill learns this from Step 4's merge, which then changes nothing (Step 4 says how to tell it from a conflict).

With a merge in progress, skip those two checks and go to Step 2. Unstaged and untracked work is left where it is: it is the run's work in progress.

### Step 2: Choose what to merge

- `--onto <ref>` when given.
- Otherwise the default branch, the first that exists of: the target of `origin/HEAD`, then `origin/main`, then `origin/master`, then local `main`, then local `master`.
- A remote-tracking choice is fetched first, read-only (`git fetch origin <branch>`). When the fetch fails, use the remote-tracking ref as it was last fetched — or the local branch of the same name, when that branch contains it and is newer — and keep a note for the report that the merged tip may be behind the remote. Never fall back to an older local branch: a stale tip makes the branch look up to date.
- None exists: stop and ask for `--onto`.

Call the chosen ref the *merged ref* and its commit the *merged tip*.

**A merge already in progress** is adopted only when `MERGE_HEAD` is the merged tip. No fetch, no new merge; the merged tip is `MERGE_HEAD`. When `MERGE_HEAD` is any other commit, stop and name both commits; when `MERGE_HEAD` is the tip of a ref (`git for-each-ref --points-at MERGE_HEAD` lists it) the person may have meant to merge, say that running again with `--onto <that ref>` adopts the merge. Note the adoption for the report, find the run (Step 3), then go to Step 4's conflict handling for whatever is still unmerged.

### Step 3: Find the run

The search runs once the merged tip is known and before anything is merged.

- `--no-run` means none; skip the search.
- `--run <task dir>` names it and skips the search, but only when its `task.base_commit.sha` is an ancestor of the merged tip (`git merge-base --is-ancestor <base> <merged tip>`) or already contains it (`git merge-base --is-ancestor <merged tip> <base>`). When neither holds, stop before merging, changing nothing: the run started after the branch had commits of its own, so its start commit cannot move past the merge. Say that `--no-run` updates the branch alone.
- Otherwise the candidates are the run folders under `.maister/tasks/<type>/`, leaving out the set-aside copies `<run>.moved-<digits>` and `<run>.failed-<digits>` (the rule of `<plugin root>/lib/run-dirs.mjs`, the plugin root being two levels above this skill's base directory), whose `orchestrator-state.yml` has:
  - `task.status` that is not `completed`, `failed` or `stopped`;
  - a `task.base_commit.sha` that this branch can have started a run from: any sha `git rev-list --first-parent --parents HEAD --not <merged tip>` prints, or HEAD itself when it prints nothing. That list holds the branch's own commits on its first-parent line, the fork point where it first left the merged ref (the first parent of the last line), and the second parent of each merge on that line, where an earlier update's move put the base. The run state records no branch, so this is the test that keeps other branches' runs out: a run frozen before this branch left the default branch, or on a default-branch commit an earlier merge only brought in, is not on the list, and its base is never moved by mistake. It replaces any `git merge-base HEAD <merged ref>` test, which after an earlier merge of the default branch (by hand, by `git pull`, by an earlier update) names the last merged commit and would drop a run frozen at the original fork.
- A run that passes those checks is kept only when its `task.base_commit.sha` is also an ancestor of the merged tip (`git merge-base --is-ancestor <base> <merged tip>`; on an adopted merge the merged tip is `MERGE_HEAD`), or already contains it (`git merge-base --is-ancestor <merged tip> <base>`): that run is past this tip already, the branch is up to date, and Step 4 reports its base as already past the merged tip. A run that fails both checks is skipped: it started after the branch had commits of its own, so its start commit cannot move past the merge, and its next review will still measure from its own start. Keep each skipped run for the report.
- No candidate kept: the plain branch, no run — merge, check and commit, moving nothing; say that `--run <task dir>` names a run the search did not find. One: that run. Several: ask once, before the merge, with ask_user — "Several unfinished runs match this branch. Which one moves with the merge?" — one option per run, labelled by its folder name with its title or status, ordered by `orchestrator.updated`, newest first, the first marked (Recommended). A person who wants none uses `--no-run` on a second call.

Before merging, say which run was found, or that none was, and name each skipped run with the reason.

### Step 4: Merge

If the branch already contains the merged tip (`git merge-base --is-ancestor <merged tip> HEAD`) and no merge is in progress: say it is up to date and merge nothing. With a run whose base already contains the merged tip, there is nothing to move: report the base as already past the merged tip, the same outcome as `move-base`'s `unchanged:`, and call no verb. With any other run, HEAD a merge commit (`git rev-parse -q --verify HEAD^2`) and that merge's second parent an ancestor of the merged tip (`git merge-base --is-ancestor HEAD^2 <merged tip>`), go to Step 8 and call `move-base` with `--to=<HEAD^2's full sha>`. The verb prints `unchanged:` when the base already moved, so a move refused or interrupted after an earlier update's commit is finished by running the skill again. Otherwise — HEAD not a merge, or a merge of something else, such as the branch's own remote or a sub-branch — report that the run's base was left alone: moving it to that merge's second parent could put the run's own commits behind the base. Then the closing report (Step 9).

Otherwise (unless adopting) run, as one command:

```bash
git merge --no-ff --no-commit <merged ref>
```

Tell a refusal from a conflict by `MERGE_HEAD` (`git rev-parse -q --verify MERGE_HEAD`), not by the exit status alone:

- **Non-zero exit and no `MERGE_HEAD`: a refusal.** Git changed nothing. Name the files it lists and tell the person to commit them or move them aside, then run the skill again. Do not pass on git's own advice to stash: the skill never stashes, and never tells anyone to.
- **`MERGE_HEAD` set: the merge is staged.** With unmerged paths it conflicted, which is expected, not a failure.

**Conflicts.** Resolve each one from the run's intent when there is a run: its `implementation/spec.md`, `implementation/implementation-plan.md` and `implementation/work-log.md`, those present. Without a run, or when the run holds none of the three, resolve from the branch's own change: its commits and its diff against the merge base (`git log` and `git diff $(git merge-base HEAD <merged ref>)..HEAD`). Stage each resolved file. Keep a list: file, what was kept, why.

### Step 5: The one question

Skipped when the merge was clean. Otherwise show the resolution list and ask with ask_user — "The merge is staged with every conflict resolved. What now?":

1. "Accept the resolutions (Recommended): \<the file count and the riskiest file\>" — go on to the checks
2. "Revise a file" — the person names the file and the change in the answer; apply it, update the list and ask again
3. "Abort to where it was: `git merge --abort`" — run it and stop. On an adopted merge the label reads "Abort the merge (`git merge --abort`) and discard the resolutions already made".

This question and Step 3's several-runs question are the only ones the skill asks.

### Step 6: Run the checks

Before the commit, with the merge staged:

1. Choose the runner's model and effort:

   `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs dispatch-model --agent=maister-copilot:test-suite-runner --host=copilot`

2. Make a scratch task directory with `mktemp -d` and build a standalone brief from the project root, with the merged tip as the base. The scratch path is outside `.maister/tasks/`, so the verb takes the project root from the working directory:

   `node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs review-brief --task-path=<the mktemp -d directory> --base=<merged tip>`

   It prints the brief's path.

3. Dispatch `maister-copilot:test-suite-runner` alone with the Task tool — the scratch directory as its `task_path`, the printed brief as its `review_brief`, a one-line `task_description` naming the merged ref and the branch (for example "Checks after merging origin/main into search-filters"), and the model and effort step 1 printed. No reviewers.

A failure the runner marks as failing on the base (`failed_on_base`, `fails_on_base`) is reported as not caused by the branch. Failures that are not on the base are reported; they do not stop the commit. Delete the scratch directory when done.

### Step 7: Commit, never push

Commit the merge's index only:

```bash
git commit --no-edit
```

Never `-a`, so unstaged run work stays uncommitted. Never push. When the commit fails (a hook, for example), stop with the merge still in progress and the run's base not moved, and report why; running the skill again adopts the merge.

### Step 8: Move the run's base

With a run, after the commit:

`node ${MAISTER_PLUGIN_ROOT}/skills/workflow-engine/scripts/workflow.mjs move-base --state=<run>/orchestrator-state.yml --reason=<the merged ref and the branch, in words, not opening with a bracket>`

After this skill's own commit, no `--to`: the verb moves the base to the merged tip when HEAD is a merge, to HEAD otherwise. From Step 4's up-to-date path, add the `--to=<HEAD^2's full sha>` that step checked. Its output:

- Moved: the changed paths, a blank line, then `moved: <old full sha> → <new full sha> (<rule>)`, the rule being `merged tip: HEAD is a merge` or `--to`. Report the run and the old → new base.
- Already there: exactly `unchanged: <base full sha> (<rule>)`, nothing written. Report it as already moved.
- Refused: exit 1, the code first on stderr, ending "Nothing was written." and the next step. The codes are `move-base-state-unreadable`, `move-base-no-repository`, `move-base-merge-in-progress`, `move-base-no-base`, `move-base-bad-ref`, `move-base-not-ancestor` and `move-base-not-in-head`.

On a refusal the merge commit stays. Quote the refusal and warn that the run's next review will count the merged-in work. Do not invent a `--to` to get past it: a forced move could hide the run's own commits. Say plainly that the review keeps measuring from the old base, so merged-in files may count as the branch's own.

### Step 9: Summary

Close with one report naming:

- the merged ref and the merge commit (short sha and subject), or that the branch was already up to date;
- each resolution, file by file, with what was kept and why;
- the check results, base failures marked as not caused by the branch;
- the run updated and its old → new base, or that its base was already past the merged tip, or "no run found, no start commit moved" with the pointer to `--run`, or that the run's base was left alone;
- each run skipped by Step 3, and why: it started after the branch had commits of its own, so its start commit could not move past the merge, and its next review still measures from its own start;
- any refusal or note: the fetch fallback, an adopted merge, a refused move;
- that nothing was pushed.
