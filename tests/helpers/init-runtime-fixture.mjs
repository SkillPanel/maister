import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function makeInitFixture({ state = "fresh" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-init-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "tests@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Init Runtime Tests"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  if (state !== "fresh") writeState(root, state);
  return {
    root,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

export function writeState(root, state = "partial") {
  const base = path.join(root, ".maister");
  fs.mkdirSync(path.join(base, "docs", "project"), { recursive: true });
  if (state !== "partial-config") fs.writeFileSync(path.join(base, "docs", "INDEX.md"), "# Existing docs\n");
  if (state === "complete") {
    fs.writeFileSync(path.join(base, "config.yml"), defaultConfig());
    fs.writeFileSync(path.join(base, "docs", "project", "tech-stack.md"), "# Existing stack\n");
    fs.mkdirSync(path.join(base, "docs", "standards"), { recursive: true });
    fs.writeFileSync(path.join(base, "docs", "standards", "README.md"), "# Standards\n");
  } else if (state === "partial-config") {
    fs.writeFileSync(path.join(base, "config.yml"), defaultConfig());
  } else {
    fs.writeFileSync(path.join(base, "docs", "project", "custom.md"), "keep me\n");
  }
}

export function defaultConfig() {
  return `# Maister project configuration.\nhtml_output: true\nadvisor:\n  enabled: false\n  gate_policies:\n    phase-exit: manual\n    optional-phase: manual\n    clarify: manual\n    convergence: manual\n    verify-matrix: manual\n  advisor_agent: maister:advisor\n  arbiter_agent: maister:advisor\n  arbiter_enabled_on_disagreement: true\n  retry:\n    advisor_attempts: 3\n    arbiter_attempts: 3\n    backoff: exponential\n`;
}

export function snapshot(root) {
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  return {
    status: run(["status", "--short", "--untracked-files=all"]),
    index: run(["diff", "--cached", "--name-status"]),
  };
}

export function treeBytes(root) {
  const result = {};
  const walk = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(path.join(directory, entry.name), entryRelative);
      else result[entryRelative] = fs.readFileSync(path.join(directory, entry.name));
    }
  };
  walk(root);
  return result;
}
