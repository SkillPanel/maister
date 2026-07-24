import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertSafeSymlink,
  throwDistributionError,
} from "./path-safety.mjs";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function compareEntries(left, right) {
  const a = left.path.toLocaleLowerCase("en-US");
  const b = right.path.toLocaleLowerCase("en-US");
  return a < b ? -1 : a > b ? 1 : left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export function hashFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch (error) {
    throwDistributionError("E_MATERIALIZE_IO", `could not hash ${filePath}`, { filePath }, { cause: error });
  }
}

export function hashTree(
  root,
  { ignore = () => false, allowMissingSymlinks = false, modeFor = null } = {},
) {
  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch (error) {
    throwDistributionError("E_MATERIALIZE_IO", `could not stat tree ${root}`, { root }, { cause: error });
  }
  if (!rootStat.isDirectory()) {
    throwDistributionError("E_MATERIALIZE_IO", `tree root is not a directory: ${root}`, { root });
  }
  const realRoot = fs.realpathSync(root);
  const entries = [];

  const shouldIgnore = (relative, directoryEntry) => {
    if (relative === ".git" || relative.startsWith(".git/")) return true;
    return ignore(relative, directoryEntry);
  };

  const visit = (current, relative) => {
    for (const directoryEntry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, directoryEntry.name);
      const childRelative = relative ? `${relative}/${directoryEntry.name}` : directoryEntry.name;
      if (shouldIgnore(childRelative, directoryEntry)) continue;
      const stat = fs.lstatSync(child);
      const mode = (modeFor?.(childRelative, stat) ?? (stat.mode & 0o7777)).toString(8).padStart(4, "0");
      if (stat.isDirectory()) {
        entries.push({ path: childRelative, type: "directory", mode });
        visit(child, childRelative);
      } else if (stat.isSymbolicLink()) {
        const target = assertSafeSymlink(child, realRoot, {
          allowMissing: allowMissingSymlinks,
        });
        entries.push({ path: childRelative, type: "symlink", mode, target });
      } else if (stat.isFile()) {
        entries.push({
          path: childRelative,
          type: "file",
          mode,
          size: stat.size,
          sha256: hashFile(child),
        });
      } else {
        throwDistributionError("E_MATERIALIZE_TYPE", `unsupported filesystem entry: ${child}`, { child });
      }
    }
  };

  visit(realRoot, "");
  entries.sort(compareEntries);
  const canonical = entries.map((entry) => JSON.stringify(entry)).join("\n");
  return {
    root: realRoot,
    entries,
    contentHash: sha256(canonical),
  };
}
