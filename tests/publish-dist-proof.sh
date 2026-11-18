#!/bin/bash
# The local proof of tools/publish-dist.sh, run by hand (never by `make test`):
#
#   bash tests/publish-dist-proof.sh
#
# It copies this working tree (uncommitted work included) into a scratch source
# repository with a scratch bare repository as its origin, runs the publish
# from there, and checks what lands on the dist branches. Nothing outside the
# scratch folders is written, and nothing is pushed anywhere else. Every
# scenario prints PASS or FAIL; any FAIL exits 1. It needs bash, git, node and
# make, and runs `make validate` once per build, so it takes a few minutes.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HISTORY_FILE=plugins/maister-copilot/interface.json
NO_BASELINE='no interface baseline found on dist/beta, dist/beta or in the source history'

# The scratch repositories commit under a fixed identity, and the operator's
# own git configuration (signing, hooks, default branch) is never read.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=proof GIT_AUTHOR_EMAIL=proof@example.invalid
export GIT_COMMITTER_NAME=proof GIT_COMMITTER_EMAIL=proof@example.invalid
unset GITHUB_OUTPUT

SCRATCH_DIRS=()
cleanup() {
  local d
  for d in "${SCRATCH_DIRS[@]+"${SCRATCH_DIRS[@]}"}"; do
    # git writes its objects read-only; make them writable so rm needs no -f.
    [ -d "$d" ] && chmod -R u+w "$d" && rm -r "$d"
  done
  return 0
}
trap cleanup EXIT
scratch() {
  local d
  d="$(mktemp -d)" || exit 1
  SCRATCH_DIRS+=("$d")
  printf '%s\n' "$d"
}

FAILED=0
report() { # report <scenario> <description> <reason or empty>
  if [ -z "$3" ]; then
    echo "PASS ($1) $2"
  else
    echo "FAIL ($1) $2: $3"
    FAILED=1
    if [ -f "$LOG" ]; then
      echo "  --- publish output (last 25 lines) ---"
      tail -n 25 "$LOG" | sed 's/^/  | /'
    fi
  fi
}

LOGS="$(scratch)"
LOG="$LOGS/none"
STATUS=0
RUN=0
# publish <source repo> <args...>: runs the publish from that repository the way
# CI does, keeping its output in $LOG, its exit code in $STATUS and the
# result it wrote to GITHUB_OUTPUT in $RESULT.
publish() {
  local src="$1"; shift
  RUN=$((RUN + 1))
  LOG="$LOGS/run-$RUN.log"
  local out="$LOGS/run-$RUN.out"
  : > "$out"
  (cd "$src" && GITHUB_OUTPUT="$out" bash tools/publish-dist.sh "$@") > "$LOG" 2>&1
  STATUS=$?
  RESULT="$(sed -n 's/^result=//p' "$out" | tail -n 1)"
}
tip() { git -C "$1" rev-parse -q --verify "refs/heads/$2" 2>/dev/null || true; }
parents() { git -C "$1" rev-list --parents -n 1 "$2" | cut -d' ' -f2-; }
parent_count() { git -C "$1" rev-list --parents -n 1 "$2" | wc -w | tr -d ' '; }

# --- Setup ------------------------------------------------------------------
# The working tree's files, into a scratch source repository. Files deleted
# from the working tree but still in the index are skipped.
SRC="$(scratch)"
(
  cd "$REPO" || exit 1
  git ls-files -co --exclude-standard -z | while IFS= read -r -d '' f; do
    [ -e "$f" ] && printf '%s\0' "$f"
  done | tar --null -T - -cf -
) | tar -xf - -C "$SRC" || { echo "FAIL setup: could not copy the working tree"; exit 1; }

# The last committed Copilot interface file, found the way the publish's
# history lookup finds it.
c="$(git -C "$REPO" log -1 --first-parent --format=%H HEAD -- "$HISTORY_FILE")"
if [ -z "$c" ]; then
  echo "FAIL setup: $HISTORY_FILE is not in this repository's history"
  exit 1
fi
if git -C "$REPO" cat-file -e "$c:$HISTORY_FILE" 2>/dev/null; then obj="$c:$HISTORY_FILE"; else obj="$c^1:$HISTORY_FILE"; fi

git -C "$SRC" init -q -b beta
mkdir -p "$SRC/$(dirname "$HISTORY_FILE")"
git -C "$REPO" show "$obj" > "$SRC/$HISTORY_FILE"
git -C "$SRC" add -A
git -C "$SRC" commit -q -m "Source with the Copilot interface file"
git -C "$SRC" rm -q -r "$(dirname "$HISTORY_FILE")"
git -C "$SRC" commit -q -m "Remove the committed Copilot build"
S1="$(git -C "$SRC" rev-parse HEAD)"

BARE="$(scratch)"
git -C "$BARE" init -q --bare
git -C "$SRC" remote add origin "$BARE"
git -C "$SRC" push -q origin beta || { echo "FAIL setup: could not push to the scratch origin"; exit 1; }

# --- (1) The first publish --------------------------------------------------
desc='the first publish creates dist/beta from the history baseline'
reason=''
publish "$SRC" --source-branch beta --source-sha "$S1"
T1="$(tip "$BARE" dist/beta)"
expected_message="$(printf 'Build copilot from %s\n\nSource branch: beta\nSource commit: %s' "$S1" "$S1")"
if [ "$STATUS" -ne 0 ]; then reason="exit $STATUS"
elif [ "$RESULT" != committed ]; then reason="result '$RESULT', not committed"
elif [ -z "$T1" ]; then reason='dist/beta was not created on the origin'
elif [ "$(parent_count "$BARE" "$T1")" != 1 ]; then reason='the commit has a parent'
elif [ "$(git -C "$BARE" ls-tree --name-only "$T1")" != copilot ]; then reason='the commit holds more than copilot/'
elif [ "$(git -C "$BARE" log -1 --format=%B "$T1")" != "$expected_message" ]; then reason='the message is not the three-line message naming the source commit'
elif [ "$(git -C "$BARE" log -1 --format='%an <%ae>|%cn <%ce>' "$T1")" != 'github-actions[bot] <github-actions[bot]@users.noreply.github.com>|github-actions[bot] <github-actions[bot]@users.noreply.github.com>' ]; then reason='the author or committer is not github-actions[bot]'
else
  v="$(git -C "$BARE" show "$T1:copilot/interface.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).interface_version))')"
  if [ -z "$v" ] || [ "$v" = 1.0 ]; then reason="interface_version is '$v'"
  elif ! grep -q 'baseline from the source history' "$LOG"; then reason='the baseline was not reported from the source history'
  fi
fi
report 1 "$desc" "$reason"

# A mirror of the origin as it is now, for the rejected push of (4).
MIRROR="$(scratch)"
git clone -q --mirror "$BARE" "$MIRROR/stale.git"

# --- (2) A committed skill edit ---------------------------------------------
desc='a committed skill edit adds a commit on top of the first'
reason=''
printf '\nA line added by the publish proof.\n' >> "$SRC/plugins/maister/skills/quick-dev/SKILL.md"
git -C "$SRC" commit -q -am "Edit a skill"
S2="$(git -C "$SRC" rev-parse HEAD)"
git -C "$SRC" push -q origin beta
publish "$SRC" --source-branch beta
T2="$(tip "$BARE" dist/beta)"
if [ "$STATUS" -ne 0 ]; then reason="exit $STATUS"
elif [ "$RESULT" != committed ]; then reason="result '$RESULT', not committed"
elif [ "$T2" = "$T1" ]; then reason='dist/beta did not move'
elif [ "$(parents "$BARE" "$T2")" != "$T1" ]; then reason='the new commit is not a child of the first'
elif ! git -C "$BARE" log -1 --format=%B "$T2" | grep -qx "Source commit: $S2"; then reason='the message does not name the new source commit'
fi
report 2 "$desc" "$reason"

# --- (3) A commit outside the plugin ----------------------------------------
desc='a commit touching only README.md leaves dist/beta unchanged'
reason=''
printf '\nA line added by the publish proof.\n' >> "$SRC/README.md"
git -C "$SRC" commit -q -am "Edit the README"
git -C "$SRC" push -q origin beta
publish "$SRC" --source-branch beta
if [ "$STATUS" -ne 0 ]; then reason="exit $STATUS"
elif [ "$RESULT" != unchanged ]; then reason="result '$RESULT', not unchanged"
elif [ "$(tip "$BARE" dist/beta)" != "$T2" ]; then reason='dist/beta moved'
fi
report 3 "$desc" "$reason"

# --- (4) A rejected push ----------------------------------------------------
# racer fetches from the stale mirror, where dist/beta is still the first
# commit, and pushes to the origin, where it has moved on.
desc='a push the origin rejects fails the publish and leaves the tip alone'
reason=''
git -C "$SRC" remote add racer "$MIRROR/stale.git"
git -C "$SRC" remote set-url --push racer "$BARE"
publish "$SRC" --source-branch beta --remote racer
if [ "$STATUS" -eq 0 ]; then reason='the publish exited 0'
elif [ "$(tip "$BARE" dist/beta)" != "$T2" ]; then reason='the origin tip changed'
elif ! grep -q 'rejected' "$LOG"; then reason='the failure was not the rejected push'
fi
report 4 "$desc" "$reason"

# --- (5) The first stable publish -------------------------------------------
desc='the first dist/stable publish takes its baseline from dist/beta'
reason=''
git -C "$SRC" checkout -q -b master
node -e '
  const fs = require("fs");
  for (const f of process.argv.slice(1)) {
    fs.writeFileSync(f, fs.readFileSync(f, "utf8")
      .replace(/"maister-plugins-beta"/g, "\"maister-plugins\"")
      .replace(/"dist\/beta"/g, "\"dist/stable\""));
  }' "$SRC/.claude-plugin/marketplace.json" "$SRC/.github/plugin/marketplace.json"
git -C "$SRC" commit -q -am "Switch the marketplaces to the stable channel"
S5="$(git -C "$SRC" rev-parse HEAD)"
git -C "$SRC" push -q origin master
publish "$SRC" --source-branch master
T5="$(tip "$BARE" dist/stable)"
if [ "$STATUS" -ne 0 ]; then reason="exit $STATUS"
elif [ "$RESULT" != committed ]; then reason="result '$RESULT', not committed"
elif [ -z "$T5" ]; then reason='dist/stable was not created on the origin'
elif [ "$(parent_count "$BARE" "$T5")" != 1 ]; then reason='the commit has a parent'
elif ! grep -q 'baseline from dist/beta' "$LOG"; then reason='the baseline was not reported from dist/beta'
elif ! git -C "$BARE" log -1 --format=%B "$T5" | grep -qx "Source branch: master"; then reason='the message does not name the master branch'
elif ! git -C "$BARE" log -1 --format=%B "$T5" | grep -qx "Source commit: $S5"; then reason='the message does not name the source commit'
elif [ "$(tip "$BARE" dist/beta)" != "$T2" ]; then reason='dist/beta moved'
fi
report 5 "$desc" "$reason"

# --- (6) An older commit ----------------------------------------------------
desc='an older commit than the one dist/beta was built from ends stale'
reason=''
git -C "$SRC" checkout -q --detach "$S1"
publish "$SRC" --source-branch beta
if [ "$STATUS" -ne 0 ]; then reason="exit $STATUS"
elif [ "$RESULT" != stale ]; then reason="result '$RESULT', not stale"
elif [ "$(tip "$BARE" dist/beta)" != "$T2" ]; then reason='dist/beta moved'
fi
report 6 "$desc" "$reason"

# --- (7) No baseline anywhere -----------------------------------------------
desc='a source with no history file and no dist branch has no baseline'
reason=''
FRESH="$(scratch)"
git -C "$SRC" archive "$S1" | tar -xf - -C "$FRESH"
git -C "$FRESH" init -q -b beta
git -C "$FRESH" add -A
git -C "$FRESH" commit -q -m "Source with no Copilot build in its history"
FRESH_ORIGIN="$(scratch)"
git -C "$FRESH_ORIGIN" init -q --bare
git -C "$FRESH" remote add origin "$FRESH_ORIGIN"
git -C "$FRESH" push -q origin beta
publish "$FRESH" --source-branch beta
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -qF "$NO_BASELINE" "$LOG"; then reason='the no-baseline message was not printed'
elif [ -n "$(git -C "$FRESH_ORIGIN" for-each-ref 'refs/heads/dist/')" ]; then reason='a dist branch was pushed'
fi
report 7 "$desc" "$reason"

# --- (8)-(12) Refusals that run before anything is built ---------------------
# Each stops the publish with exit 1 and leaves the dist branches where they
# were. SRC is still at the first source commit, detached.
T6="$(tip "$BARE" dist/beta)"
T6_STABLE="$(tip "$BARE" dist/stable)"

desc='a source commit that is not the checked-out HEAD is refused'
reason=''
publish "$SRC" --source-branch beta --source-sha "$S2"
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -q 'HEAD is .*, not the source commit' "$LOG"; then reason='the HEAD message was not printed'
elif [ "$(tip "$BARE" dist/beta)" != "$T6" ]; then reason='dist/beta moved'
fi
report 8 "$desc" "$reason"

desc='a working tree with an uncommitted file is refused'
reason=''
printf 'stray\n' > "$SRC/stray.txt"
publish "$SRC" --source-branch beta
rm "$SRC/stray.txt"
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -q 'the working tree is not clean' "$LOG"; then reason='the dirty-tree message was not printed'
elif [ "$(tip "$BARE" dist/beta)" != "$T6" ]; then reason='dist/beta moved'
fi
report 9 "$desc" "$reason"

desc='a master push whose marketplace file still lists dist/beta is refused'
reason=''
publish "$SRC" --source-branch master
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -q "lists the build from 'dist/beta', while this push publishes dist/stable" "$LOG"; then reason='the marketplace-ref message was not printed'
elif [ "$(tip "$BARE" dist/stable)" != "$T6_STABLE" ]; then reason='dist/stable moved'
fi
report 10 "$desc" "$reason"

desc='a source that has diverged from the commit dist/beta was built from is refused'
reason=''
git -C "$SRC" commit -q --allow-empty -m "A sibling of the second source commit"
publish "$SRC" --source-branch beta
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -q 'has diverged from' "$LOG"; then reason='the divergence message was not printed'
elif [ "$(tip "$BARE" dist/beta)" != "$T6" ]; then reason='dist/beta moved'
fi
report 11 "$desc" "$reason"

desc='a dist tip whose message names no source commit is refused'
reason=''
empty_tree="$(git -C "$FRESH" hash-object -t tree -w /dev/null)"
foreign="$(printf 'Not written by the publish\n' | git -C "$FRESH" commit-tree "$empty_tree")"
git -C "$FRESH" push -q origin "$foreign:refs/heads/dist/beta"
publish "$FRESH" --source-branch beta
if [ "$STATUS" -ne 1 ]; then reason="exit $STATUS, not 1"
elif ! grep -q 'names no source commit' "$LOG"; then reason='the no-source-commit message was not printed'
elif [ "$(tip "$FRESH_ORIGIN" dist/beta)" != "$foreign" ]; then reason='dist/beta moved'
fi
report 12 "$desc" "$reason"

exit "$FAILED"
