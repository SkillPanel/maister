#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "reconcile-gate-config.sh");
const REQUIRED_ARTIFACTS = {
  "docs/INDEX.md": "# Maister Documentation\n\nProject documentation and standards live below this directory.\n",
  "docs/project/tech-stack.md": "# Tech Stack\n\nDocument the project technology choices and rationale here.\n",
  "docs/standards/README.md": "# Standards\n\nProject coding and testing standards live in this directory.\n",
};
const DEFAULT_CONFIG = `# Maister project configuration.\nhtml_output: true\nadvisor:\n  enabled: false\n  gate_policies:\n    phase-exit: manual\n    optional-phase: manual\n    clarify: manual\n    convergence: manual\n    verify-matrix: manual\n  advisor_agent: maister:advisor\n  arbiter_agent: maister:advisor\n  arbiter_enabled_on_disagreement: true\n  retry:\n    advisor_attempts: 3\n    arbiter_attempts: 3\n    backoff: exponential\n`;

class InitRuntimeError extends Error {
  constructor(message, code = "E_INIT_RUNTIME", cause) {
    super(message, { cause });
    this.name = "InitRuntimeError";
    this.code = code;
  }
}

function fail(message, code, cause) {
  throw new InitRuntimeError(message, code, cause);
}

function runGit(projectRoot, args) {
  try {
    return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  } catch (error) {
    fail(`Git preflight failed: ${error.message}`, "E_GIT", error);
  }
}

function captureGitSnapshots(projectRoot) {
  return Object.freeze({
    status: runGit(projectRoot, ["status", "--short", "--untracked-files=all"]),
    index: runGit(projectRoot, ["diff", "--cached", "--name-status"]),
  });
}

function artifactPaths(projectRoot) {
  const maister = path.join(projectRoot, ".maister");
  return {
    root: maister,
    config: path.join(maister, "config.yml"),
    docsIndex: path.join(maister, "docs", "INDEX.md"),
    techStack: path.join(maister, "docs", "project", "tech-stack.md"),
    standards: path.join(maister, "docs", "standards"),
  };
}

export function classifyState(projectRoot) {
  const paths = artifactPaths(path.resolve(projectRoot));
  if (!fs.existsSync(paths.root)) return "fresh";
  const complete = fs.existsSync(paths.config) && fs.existsSync(paths.docsIndex) &&
    fs.existsSync(paths.techStack) && fs.existsSync(path.join(paths.standards, "README.md"));
  return complete ? "complete" : "partial";
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maister-init-candidate-"));
}

export function validateCandidateConfig(configPath, { enabled = "off" } = {}) {
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) fail(`candidate config does not exist: ${configPath}`, "E_CONFIG");
  if (enabled !== "on" && enabled !== "off") fail("Advisor intent must be on or off", "E_ARGUMENT");
  const temporary = temporaryDirectory();
  try {
    const source = path.join(temporary, "config.yml");
    const candidate = path.join(temporary, "candidate.yml");
    fs.copyFileSync(configPath, source);
    execFileSync(SCRIPT_PATH, ["candidate", source, enabled, candidate], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`candidate config validation failed: ${detail}`, "E_CONFIG", error);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function validateText(text, enabled) {
  const temporary = temporaryDirectory();
  try {
    const source = path.join(temporary, "config.yml");
    fs.writeFileSync(source, text, { mode: 0o644 });
    return validateCandidateConfig(source, { enabled });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function resolveAdvisor(options) {
  const values = options.advisor ?? options.advisorIntent ?? "off";
  if (values !== "on" && values !== "off") fail("Advisor intent must be on or off", "E_ARGUMENT");
  return values;
}

function validateArtifactInputs(options, advisor) {
  if (options.configText !== undefined) validateText(options.configText, advisor);
  for (const relative of Object.keys(options.artifacts ?? {})) {
    if (!relative || relative.startsWith("/") || relative.includes("..")) fail(`unsafe artifact path: ${relative}`, "E_ARGUMENT");
    if (typeof options.artifacts[relative] !== "string") fail(`artifact content must be text: ${relative}` , "E_ARGUMENT");
  }
}

function resolveAction(classification, options) {
  const selected = classification === "fresh"
    ? (options.action ?? "create")
    : options.action ?? options.selectAction?.({ classification });
  if (!selected) fail("an action is required for an existing .maister state", "E_ACTION_REQUIRED");
  const aliases = { backup: "backup", reinitialize: "backup", repair: "repair", update: "update", resume: "resume", cancel: "cancel", create: "create" };
  if (!Object.hasOwn(aliases, selected)) fail(`unsupported init action: ${selected}`, "E_ARGUMENT");
  if (classification === "fresh" && selected !== "create" && selected !== "cancel") fail(`unsupported fresh-state action: ${selected}`, "E_ARGUMENT");
  if (selected === "resume" && !fs.existsSync(path.join(artifactPaths(path.resolve(options.projectRoot ?? process.cwd())).root, "init-runtime-manifest.json"))) {
    fail("cannot resume without an init runtime manifest", "E_RESUME");
  }
  return aliases[selected];
}

export function preflight(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) fail("project root must be a directory", "E_ARGUMENT");
  const advisor = resolveAdvisor(options);
  const classification = classifyState(projectRoot);
  const paths = artifactPaths(projectRoot);
  if (fs.existsSync(paths.config)) validateCandidateConfig(paths.config, { enabled: advisor });
  else validateText(DEFAULT_CONFIG, advisor);
  validateArtifactInputs(options, advisor);
  const git = captureGitSnapshots(projectRoot);
  const action = resolveAction(classification, options);
  return Object.freeze({ projectRoot, classification, action, advisor, git, paths });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fileChecksums(root) {
  const files = {};
  if (!fs.existsSync(root)) return files;
  const walk = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = path.join(relative, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entryRelative === "init-runtime-manifest.json") continue;
      if (entry.isDirectory()) walk(absolute, entryRelative);
      else if (entry.isFile()) files[entryRelative] = sha256(absolute);
    }
  };
  walk(root);
  return files;
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeIfChanged(filePath, bytes) {
  const next = Buffer.from(bytes);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(next)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, next);
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return true;
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "backups") continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(from), to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o7777);
    }
  }
}

function clearForReinitialize(root) {
  for (const entry of fs.readdirSync(root)) {
    if (entry === "backups") continue;
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

function backupState(paths) {
  const backup = path.join(paths.root, "backups", `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${crypto.randomUUID().slice(0, 8)}`);
  copyDirectory(paths.root, backup);
  return path.relative(paths.root, backup);
}

function injectFailure(options, point) {
  if (options.failurePoint === point) fail(`injected init failure at ${point}`, "E_INJECTED_FAILURE");
}

function reconcile(config, advisor, options) {
  injectFailure(options, "reconcile");
  try {
    execFileSync(SCRIPT_PATH, ["reconcile", config, advisor], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    fail(`gate configuration reconciliation failed: ${detail}`, "E_RECONCILE", error);
  }
}

function writeArtifacts(preflightResult, options) {
  const { paths, action, advisor } = preflightResult;
  fs.mkdirSync(paths.root, { recursive: true });
  if (action === "backup") clearForReinitialize(paths.root);
  const existingConfig = fs.existsSync(paths.config);
  if (!existingConfig) writeIfChanged(paths.config, options.configText ?? DEFAULT_CONFIG);
  const requested = options.artifacts ?? {};
  for (const [relative, defaultContent] of Object.entries(REQUIRED_ARTIFACTS)) {
    const content = requested[relative] ?? defaultContent;
    const destination = path.join(paths.root, relative);
    if (action === "repair" && fs.existsSync(destination)) continue;
    writeIfChanged(destination, content);
  }
  for (const [relative, content] of Object.entries(requested)) {
    if (!relative || relative.startsWith("/") || relative.includes("..")) fail(`unsafe artifact path: ${relative}`, "E_ARGUMENT");
    const destination = path.join(paths.root, relative);
    if (action === "repair" && fs.existsSync(destination)) continue;
    writeIfChanged(destination, content);
  }
  reconcile(paths.config, advisor, options);
}

function persistManifest(paths, manifest) {
  atomicJson(path.join(paths.root, "init-runtime-manifest.json"), manifest);
}

export function recordAdvisorOutcome(projectRoot, outcome) {
  const paths = artifactPaths(path.resolve(projectRoot));
  const manifestPath = path.join(paths.root, "init-runtime-manifest.json");
  if (!fs.existsSync(manifestPath)) fail("cannot record Advisor outcome without an init runtime manifest", "E_ADVISOR_STATE");
  if (!outcome || typeof outcome !== "object") fail("Advisor outcome must be an object", "E_ARGUMENT");
  const invoked = outcome.invoked === true;
  const decisionRecorded = outcome.decision_recorded === true;
  if (decisionRecorded && !invoked) fail("a persisted Advisor decision requires an invocation", "E_ADVISOR_STATE");
  if (invoked && outcome.logical_role_id !== "maister:advisor") fail("Advisor invocation requires exact logical role maister:advisor", "E_ADVISOR_STATE");
  if (typeof outcome.gate !== "string" || outcome.gate.length === 0) fail("Advisor outcome requires a gate", "E_ARGUMENT");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read init runtime manifest: ${error.message}`, "E_ADVISOR_STATE", error);
  }
  manifest.advisor ??= { configured: false, invoked: false, decision_recorded: false, events: [] };
  manifest.advisor.invoked ||= invoked;
  manifest.advisor.decision_recorded ||= decisionRecorded;
  manifest.advisor.events ??= [];
  manifest.advisor.events.push({
    gate: outcome.gate,
    invoked,
    decision_recorded: decisionRecorded,
    logical_role_id: outcome.logical_role_id ?? null,
    actor: outcome.actor ?? null,
    model: outcome.model ?? null,
    dispatch_id: outcome.dispatch_id ?? null,
    input_digest: outcome.input_digest ?? null,
    selected_option: outcome.selected_option ?? null,
    confidence: outcome.confidence ?? null,
    result_status: outcome.result_status ?? null,
    retry_count: Number.isInteger(outcome.retry_count) ? outcome.retry_count : 0,
    failure_details: outcome.failure_details ?? null,
    fallback: outcome.fallback === true,
    recorded_at: outcome.recorded_at ?? new Date().toISOString(),
  });
  persistManifest(paths, manifest);
  return manifest.advisor;
}

export function runInit(options = {}) {
  const prepared = preflight(options);
  if (prepared.action === "cancel") return { classification: prepared.classification, action: "cancel", advisor: { configured: prepared.advisor === "on", invoked: false, decision_recorded: false }, git: prepared.git };
  const manifest = {
    schema_version: 1,
    classification: prepared.classification,
    selected_action: prepared.action,
    pre_run_git: prepared.git,
    advisor: { configured: prepared.advisor === "on", invoked: false, decision_recorded: false, events: [] },
    artifacts: {},
    transaction: { status: "started", step: "preflight" },
  };
  if (prepared.action === "resume") {
    let previous;
    try {
      previous = JSON.parse(fs.readFileSync(path.join(prepared.paths.root, "init-runtime-manifest.json"), "utf8"));
    } catch (error) {
      fail(`cannot load init runtime manifest for resume: ${error.message}`, "E_RESUME", error);
    }
    if (previous.transaction?.status !== "failed") fail("only a failed init transaction can be resumed", "E_RESUME");
    manifest.resumed_from = previous.transaction;
    manifest.resume_count = (previous.resume_count ?? 0) + 1;
    manifest.advisor = previous.advisor ?? manifest.advisor;
  }
  try {
    fs.mkdirSync(prepared.paths.root, { recursive: true });
    if (prepared.action === "backup") {
      manifest.transaction.step = "backup";
      injectFailure(options, "backup");
      manifest.backup_path = backupState(prepared.paths);
      persistManifest(prepared.paths, manifest);
    } else persistManifest(prepared.paths, manifest);
    manifest.transaction.step = "artifacts";
    injectFailure(options, "artifacts");
    writeArtifacts(prepared, options);
    manifest.transaction.step = "complete";
    manifest.transaction.status = "succeeded";
    manifest.artifacts = fileChecksums(prepared.paths.root);
    manifest.post_run_git = captureGitSnapshots(prepared.projectRoot);
    if (manifest.post_run_git.index !== prepared.git.index) fail("init changed the Git index", "E_GIT_MUTATION");
    persistManifest(prepared.paths, manifest);
    return {
      classification: prepared.classification,
      action: prepared.action,
      advisor: manifest.advisor,
      git: { before: prepared.git, after: manifest.post_run_git },
      manifest,
    };
  } catch (error) {
    manifest.transaction.status = "failed";
    manifest.transaction.error = error.message;
    try {
      manifest.post_run_git = captureGitSnapshots(prepared.projectRoot);
      persistManifest(prepared.paths, manifest);
    } catch { /* preserve the original boundary error */ }
    if (error instanceof InitRuntimeError) throw error;
    fail(`init transaction failed: ${error.message}`, "E_INIT_TRANSACTION", error);
  }
}

function cli(argv) {
  const options = { projectRoot: process.cwd(), advisor: "off" };
  const command = argv[0] === "record-advisor" ? argv.shift() : null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project-root") options.projectRoot = argv[++index];
    else if (value === "--advisor") options.advisor = argv[++index];
    else if (value === "--action") options.action = argv[++index];
    else if (value === "--preflight") options.preflight = true;
    else if (value === "--outcome") {
      try {
        options.outcome = JSON.parse(fs.readFileSync(argv[++index], "utf8"));
      } catch (error) {
        fail(`invalid Advisor outcome: ${error.message}`, "E_ARGUMENT", error);
      }
    } else fail(`unknown argument: ${value}`, "E_ARGUMENT");
  }
  let result;
  if (command === "record-advisor") result = recordAdvisorOutcome(options.projectRoot, options.outcome);
  else if (options.preflight) result = preflight(options);
  else result = runInit(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.code ?? "E_INIT_RUNTIME"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
