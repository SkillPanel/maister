#!/bin/bash
# Publishes the GitHub Copilot CLI build of one source commit to the branch
# dist/<channel>, folder copilot/: one commit per changed build, naming the
# source commit it was built from. CI runs it after a push to beta or master;
# it is dev tooling and never ships in the plugin.
#
#   usage: publish-dist.sh --source-branch <beta|master> [--source-sha <sha>] [--remote <name>]
#   --source-branch  the pushed branch: beta publishes dist/beta, master dist/stable
#   --source-sha     the commit to build (default HEAD); HEAD must be it, the tree clean
#   --remote         where the dist branches are read and pushed (default origin)
#
# It never force-pushes and never retries: a push the remote rejects fails the
# run, and the next push to the source branch publishes again. It ends with one
# result, also written to $GITHUB_OUTPUT when that is set (with the plugin
# version, the Copilot marketplace name and the channel):
#   committed  a new build was pushed to dist/<channel>
#   unchanged  the build equals the one dist/<channel> holds; nothing pushed
#   stale      dist/<channel> was built from a newer commit; nothing pushed
set -euo pipefail

usage() {
  echo "usage: publish-dist.sh --source-branch <beta|master> [--source-sha <sha>] [--remote <name>]" >&2
  exit 2
}

BRANCH=""
SHA_ARG=HEAD
REMOTE=origin
while [ $# -gt 0 ]; do
  case "$1" in
    --source-branch=?*) BRANCH="${1#--source-branch=}" ;;
    --source-branch) [ -n "${2:-}" ] || usage; BRANCH="$2"; shift ;;
    --source-sha=?*) SHA_ARG="${1#--source-sha=}" ;;
    --source-sha) [ -n "${2:-}" ] || usage; SHA_ARG="$2"; shift ;;
    --remote=?*) REMOTE="${1#--remote=}" ;;
    --remote) [ -n "${2:-}" ] || usage; REMOTE="$2"; shift ;;
    *) usage ;;
  esac
  shift
done

# The channel is decided before anything else runs, git included.
case "$BRANCH" in
  beta) CHANNEL=beta ;;
  master) CHANNEL=stable ;;
  "") usage ;;
  *)
    echo "publish: the branch '$BRANCH' publishes nothing; only beta (dist/beta) and master (dist/stable) do" >&2
    exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COPILOT_MARKETPLACE="$ROOT/.github/plugin/marketplace.json"
SOURCE_MANIFEST="$ROOT/plugins/maister/.claude-plugin/plugin.json"
HISTORY_FILE=plugins/maister-copilot/interface.json

fail() {
  echo "publish: $*" >&2
  exit 1
}

# The build must be of exactly the source commit.
SHA="$(git -C "$ROOT" rev-parse -q --verify "$SHA_ARG^{commit}")" || fail "$SHA_ARG is not a commit in this repository"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
[ "$HEAD_SHA" = "$SHA" ] || fail "HEAD is $HEAD_SHA, not the source commit $SHA; check the source commit out first"
[ -z "$(git -C "$ROOT" status --porcelain)" ] || fail "the working tree is not clean, so the build would not be of $SHA"

# What the branch's Copilot marketplace file lists, the marketplace name and
# the plugin version, one per line. A master push still carrying the beta names
# would write dist/stable while sending users to dist/beta, so a ref other than
# this push's branch stops the run before anything is fetched or built.
FACTS="$(node -e '
  const fs = require("fs");
  const [marketplace, manifest] = process.argv.slice(1);
  let m, p;
  try { m = JSON.parse(fs.readFileSync(marketplace, "utf8")); } catch (e) { console.error(`publish: ${marketplace} cannot be read as JSON`); process.exit(1); }
  try { p = JSON.parse(fs.readFileSync(manifest, "utf8")); } catch (e) { console.error(`publish: ${manifest} cannot be read as JSON`); process.exit(1); }
  const entry = (Array.isArray(m.plugins) ? m.plugins : []).find((x) => x && x.name === "maister");
  const ref = entry && entry.source && typeof entry.source.ref === "string" ? entry.source.ref : "";
  console.log([ref, m.name || "", p.version || ""].join("\n"));
' "$COPILOT_MARKETPLACE" "$SOURCE_MANIFEST")" || exit 1
LISTED_REF="$(printf '%s\n' "$FACTS" | sed -n 1p)"
MARKETPLACE="$(printf '%s\n' "$FACTS" | sed -n 2p)"
VERSION="$(printf '%s\n' "$FACTS" | sed -n 3p)"
if [ "$LISTED_REF" != "dist/$CHANNEL" ]; then
  fail "the $BRANCH branch's Copilot marketplace file lists the build from '${LISTED_REF}', while this push publishes dist/$CHANNEL; refusing to publish"
fi
[ -n "$VERSION" ] || fail "$SOURCE_MANIFEST has no version"
[ -n "$MARKETPLACE" ] || fail "$COPILOT_MARKETPLACE has no name"

# finish <result>: prints the result, hands it to the workflow and ends the run.
finish() {
  echo "result=$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "result=$1"
      echo "version=$VERSION"
      echo "marketplace=$MARKETPLACE"
      echo "channel=$CHANNEL"
    } >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

WORK="$(mktemp -d)"
cleanup() { chmod -R u+w "$WORK" 2>/dev/null || true; rm -r "$WORK"; }
trap cleanup EXIT

git -C "$ROOT" fetch --no-tags "$REMOTE" "+refs/heads/dist/*:refs/remotes/$REMOTE/dist/*"
TIP="$(git -C "$ROOT" rev-parse -q --verify "refs/remotes/$REMOTE/dist/$CHANNEL^{commit}" || true)"

# The ancestor guard: a build only ever replaces one made from an ancestor of
# its source commit, so an older run finishing late never overwrites a newer
# build, and a rewritten source history never publishes over the old one.
if [ -n "$TIP" ]; then
  BUILT_FROM="$(git -C "$ROOT" log -1 --format=%B "$TIP" | sed -n 's/^Source commit: \([0-9a-f]\{40\}\)$/\1/p' | tail -n 1)"
  [ -n "$BUILT_FROM" ] || fail "dist/$CHANNEL's tip $TIP names no source commit: it was not written by this publish"
  git -C "$ROOT" cat-file -e "$BUILT_FROM^{commit}" 2>/dev/null \
    || fail "dist/$CHANNEL was built from $BUILT_FROM, which is not in this repository"
  if git -C "$ROOT" merge-base --is-ancestor "$BUILT_FROM" "$SHA"; then
    :
  elif git -C "$ROOT" merge-base --is-ancestor "$SHA" "$BUILT_FROM"; then
    echo "publish: dist/$CHANNEL was built from $BUILT_FROM, which is newer than $SHA; nothing to publish"
    finish stale
  else
    fail "dist/$CHANNEL was built from $BUILT_FROM, which has diverged from $SHA; refusing to publish over it"
  fi
fi

# The interface baseline the build versions its interface file against: the
# build this one replaces, else the beta build (the first stable publish), else
# the last Copilot interface file committed on the source branch's first-parent
# line. A published build never falls back to 1.0.
BASELINE="$WORK/baseline.json"
if [ -n "$TIP" ]; then
  git -C "$ROOT" show "$TIP:copilot/interface.json" > "$BASELINE" 2>/dev/null \
    || fail "dist/$CHANNEL exists, but its copilot/interface.json cannot be read"
  echo "publish: interface baseline from dist/$CHANNEL ($TIP)"
elif BETA_TIP="$(git -C "$ROOT" rev-parse -q --verify "refs/remotes/$REMOTE/dist/beta^{commit}")"; then
  git -C "$ROOT" show "$BETA_TIP:copilot/interface.json" > "$BASELINE" 2>/dev/null \
    || fail "dist/beta exists, but its copilot/interface.json cannot be read"
  echo "publish: interface baseline from dist/beta ($BETA_TIP)"
else
  c="$(git -C "$ROOT" log -1 --first-parent --format=%H "$SHA" -- "$HISTORY_FILE")"
  [ -n "$c" ] || fail "no interface baseline found on dist/$CHANNEL, dist/beta or in the source history"
  if git -C "$ROOT" cat-file -e "$c:$HISTORY_FILE" 2>/dev/null; then
    obj="$c:$HISTORY_FILE"
  else
    obj="$c^1:$HISTORY_FILE"
  fi
  git -C "$ROOT" show "$obj" > "$BASELINE" 2>/dev/null || fail "$obj cannot be read"
  echo "publish: interface baseline from the source history ($obj)"
fi

bash "$ROOT/platforms/copilot-cli/build.sh" --out "$WORK/tree/copilot" --baseline "$BASELINE" --require-baseline
make -C "$ROOT" validate VARIANT="$WORK/tree/copilot"

# The version invariant: the interface version never goes back (it versions
# independently of plugins/maister/interface.json, so the two are not
# compared), and the build is maister at the source plugin's version.
node -e '
  const fs = require("fs");
  const [tree, baseline, source] = process.argv.slice(1);
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const v = read(`${tree}/interface.json`).interface_version, b = read(baseline).interface_version;
  const [vMajor, vMinor] = String(v).split(".").map(Number), [bMajor, bMinor] = String(b).split(".").map(Number);
  if (!(vMajor > bMajor || (vMajor === bMajor && vMinor >= bMinor))) { console.error(`publish: the build'"'"'s interface_version ${v} is behind the baseline'"'"'s ${b}`); process.exit(1); }
  const built = read(`${tree}/.claude-plugin/plugin.json`), wanted = read(source).version;
  if (built.name !== "maister") { console.error(`publish: the build is named "${built.name}", not maister`); process.exit(1); }
  if (built.version !== wanted) { console.error(`publish: the build carries version ${built.version}, not the source plugin version ${wanted}`); process.exit(1); }
' "$WORK/tree/copilot" "$BASELINE" "$SOURCE_MANIFEST"

# The commit, built with plumbing in an index of its own, so neither the
# checkout nor its index is touched: a tree holding only copilot/.
GIT_DIR_ABS="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
GIT_INDEX_FILE="$WORK/index" git -C "$ROOT" read-tree --empty
GIT_INDEX_FILE="$WORK/index" git --git-dir="$GIT_DIR_ABS" --work-tree="$WORK/tree" -C "$WORK/tree" add -A .
TREE="$(GIT_INDEX_FILE="$WORK/index" git -C "$ROOT" write-tree)"

if [ -n "$TIP" ] && [ "$TREE" = "$(git -C "$ROOT" rev-parse "$TIP^{tree}")" ]; then
  echo "publish: the build of $SHA is the one dist/$CHANNEL holds; nothing to commit"
  finish unchanged
fi

PARENT=()
[ -z "$TIP" ] || PARENT=(-p "$TIP")
BOT='github-actions[bot]'
BOT_EMAIL='github-actions[bot]@users.noreply.github.com'
COMMIT="$(printf 'Build copilot from %s\n\nSource branch: %s\nSource commit: %s\n' "$SHA" "$BRANCH" "$SHA" \
  | GIT_AUTHOR_NAME="$BOT" GIT_AUTHOR_EMAIL="$BOT_EMAIL" GIT_COMMITTER_NAME="$BOT" GIT_COMMITTER_EMAIL="$BOT_EMAIL" \
    git -C "$ROOT" commit-tree "$TREE" ${PARENT[@]+"${PARENT[@]}"})"

# A plain push: a remote branch that moved on since the fetch rejects it.
git -C "$ROOT" push "$REMOTE" "$COMMIT:refs/heads/dist/$CHANNEL" \
  || fail "the push to dist/$CHANNEL was rejected; nothing was published (no retry, no force)"
echo "publish: dist/$CHANNEL is now $COMMIT, built from $SHA"
finish committed
