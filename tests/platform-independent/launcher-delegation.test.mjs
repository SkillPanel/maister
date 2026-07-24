import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CHILD_STDOUT_TAIL_BYTES, childStatus, delegateInstaller } from "../../lib/launcher/process-port.mjs";
import { createAuthorityStore } from "../../lib/launcher/authority.mjs";
import { hashTree } from "../../plugins/maister/lib/distribution/hash-tree.mjs";
import { runLauncher } from "../../lib/launcher/orchestrator.mjs";
import { createTempRoot } from "../../lib/launcher/temp-root.mjs";

test("state-only commands delegate only through validated authority and make zero transport calls", async () => {
  let calls = 0;
  const transport = { request: async () => { calls += 1; throw new Error("must not be called"); } };
  const delegated = [];
  for (const command of ["status", "verify", "uninstall", "rollback", "recover"]) {
    const status = await runLauncher({ command, target: "codex", json: command === "status" }, { version: "2.2.1" }, {
      transport,
      authorityStore: { readActiveReceipt: () => ({ installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs" }) },
      delegate: async (invocation) => { delegated.push(invocation); return { code: 6, signal: null }; },
    });
    assert.equal(status, 6, command);
  }
  assert.equal(calls, 0);
  assert.deepEqual(delegated.map(({ installerPath, argv }) => ({ installerPath, argv })), [
    { installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs", argv: ["status", "--target", "codex", "--json"] },
    { installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs", argv: ["verify", "--target", "codex"] },
    { installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs", argv: ["uninstall", "--target", "codex"] },
    { installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs", argv: ["rollback", "--target", "codex"] },
    { installerPath: "/state/verified/plugins/maister/bin/maister-install.mjs", argv: ["recover", "--target", "codex"] },
  ]);
});

test("offline recover delegates the exact operator-selected journal UUID", async () => {
  const journalId = "00000000-0000-4000-8000-000000000001";
  let invocation;
  const status = await runLauncher({ command: "recover", target: "codex", json: true, journalId }, { version: "2.2.1" }, {
    authorityStore: { readActiveReceipt: () => ({ installerPath: "/state/control-plane/maister-install.mjs" }) },
    delegate: async (value) => { invocation = value; return { code: 0, signal: null }; },
  });
  assert.equal(status, 0);
  assert.deepEqual(invocation.argv, ["recover", "--target", "codex", "--journal-id", journalId, "--json"]);
});

test("offline authority discovery fails closed without creating state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-authority-test-"));
  const env = { XDG_STATE_HOME: path.join(root, "state") };
  assert.throws(() => createAuthorityStore({ home: path.join(root, "home"), env }).readActiveReceipt("codex"), { kind: "E_OFFLINE_AUTHORITY" });
  assert.equal(fs.existsSync(path.join(root, "state")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("offline authority discovery accepts only the active receipt-bound closure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-authority-valid-"));
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  const stateRoot = path.join(state, "maister", "codex");
  const receiptId = "00000000-0000-4000-8000-000000000001";
  const controlRoot = path.join(stateRoot, "control-planes", receiptId);
  const installerPath = path.join(controlRoot, "plugins", "maister", "bin", "maister-install.mjs");
  fs.mkdirSync(path.dirname(installerPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(installerPath, "#!/usr/bin/env node\n", { mode: 0o755 });
  const sourceContentHash = "a".repeat(64);
  const sourceCommit = "b".repeat(40);
  const treeHash = hashTree(controlRoot).contentHash;
  const installerSha256 = crypto.createHash("sha256").update(fs.readFileSync(installerPath)).digest("hex");
  const receipt = {
    schema_version: 2,
    receipt_id: receiptId,
    target: { id: "codex" },
    source: { source_version: "2.2.1", resolved_commit: sourceCommit, content_hash: sourceContentHash },
    control_plane: {
      schema_version: 1,
      root_ref: `control-planes/${receiptId}`,
      installer_ref: `control-planes/${receiptId}/plugins/maister/bin/maister-install.mjs`,
      tree_hash: treeHash,
      installer_sha256: installerSha256,
      cli_contract_version: 1,
      source_version: "2.2.1",
      source_commit: sourceCommit,
      source_content_hash: sourceContentHash,
    },
  };
  const receiptsRoot = path.join(stateRoot, "receipts");
  fs.mkdirSync(receiptsRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(stateRoot, "control-planes"), { recursive: true, mode: 0o700 });
  const receiptPath = path.join(receiptsRoot, `${receiptId}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const activeReceiptPath = path.join(stateRoot, "active-receipt.json");
  fs.writeFileSync(activeReceiptPath, `${JSON.stringify({ schema_version: 2, receipt_id: receiptId, receipt_path: receiptPath })}\n`, { mode: 0o600 });
  const authority = createAuthorityStore({ home, env: { XDG_STATE_HOME: state } }).readActiveReceipt("codex");
  assert.equal(authority.installerPath, installerPath);
  assert.equal(authority.treeHash, treeHash);
  if (process.platform === "win32") {
    // Windows does not preserve the POSIX modes used by the private receipt
    // contract. The authority checks must still validate the complete bound
    // closure without rejecting the platform's observed mode bits.
    for (const filePath of [activeReceiptPath, receiptPath, installerPath]) fs.chmodSync(filePath, 0o666);
    const windowsAuthority = createAuthorityStore({ home, env: { XDG_STATE_HOME: state } }).readActiveReceipt("codex");
    assert.equal(windowsAuthority.installerPath, installerPath);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("retained operation roots survive cleanup for unresolved child recovery", () => {
  const operation = createTempRoot();
  operation.retain();
  operation.cleanup();
  assert.equal(fs.existsSync(operation.root), true);
  fs.rmSync(operation.root, { recursive: true, force: true });
});

test("delegation is non-shell, preserves independent streams, and forwards exact exit code", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const observed = {};
  const spawnImpl = (executable, argv, options) => {
    Object.assign(observed, { executable, argv, options });
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from([0, 1, 2]));
      child.stderr.emit("data", Buffer.from("warning\n"));
      child.emit("close", 6, null);
    });
    return child;
  };
  const stdout = [];
  const stderr = [];
  const processObject = new EventEmitter();
  const outcome = await delegateInstaller({
    installerPath: "/verified/maister-install.mjs",
    argv: ["verify", "--target", "codex", "--json"],
    spawnImpl,
    stdout: { write: (bytes) => stdout.push(Buffer.from(bytes)) },
    stderr: { write: (bytes) => stderr.push(Buffer.from(bytes)) },
    processObject,
  });
  assert.equal(observed.options.shell, false);
  assert.deepEqual(observed.argv, ["/verified/maister-install.mjs", "verify", "--target", "codex", "--json"]);
  assert.deepEqual(Buffer.concat(stdout), Buffer.from([0, 1, 2]));
  assert.equal(Buffer.concat(stderr).toString(), "warning\n");
  assert.equal(outcome.stdout, "\u0000\u0001\u0002");
  assert.equal(childStatus(outcome), 6);
});

test("delegation forwards exact stdout with backpressure while retaining only a bounded rolling tail", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  let pauses = 0;
  let resumes = 0;
  child.stdout.pause = () => { pauses += 1; };
  child.stdout.resume = () => { resumes += 1; };
  const forwarded = [];
  const stdout = new EventEmitter();
  let blocked = true;
  stdout.write = (chunk) => {
    forwarded.push(Buffer.from(chunk));
    if (!blocked) return true;
    blocked = false;
    queueMicrotask(() => stdout.emit("drain"));
    return false;
  };
  const bytes = Buffer.alloc(CHILD_STDOUT_TAIL_BYTES + 257, 0x61);
  const finalRecord = Buffer.from('{"journal_path":"/state/00000000-0000-4000-8000-000000000001.json"}\n');
  const spawnImpl = () => {
    queueMicrotask(() => {
      child.stdout.emit("data", bytes);
      child.stdout.emit("data", finalRecord);
      child.emit("close", 0, null);
    });
    return child;
  };

  const outcome = await delegateInstaller({
    installerPath: "/verified/maister-install.mjs",
    argv: ["install", "--target", "codex"],
    spawnImpl,
    stdout,
    stderr: { write() { return true; } },
    processObject: new EventEmitter(),
  });

  assert.deepEqual(Buffer.concat(forwarded), Buffer.concat([bytes, finalRecord]));
  assert.equal(Buffer.byteLength(outcome.stdout), CHILD_STDOUT_TAIL_BYTES);
  assert.ok(outcome.stdout.endsWith(finalRecord.toString("utf8")));
  assert.equal(pauses, 1);
  assert.equal(resumes, 1);
});

test("acquisition signals abort transport and clean the private operation root", async () => {
  const signalSource = new EventEmitter();
  let cleaned = 0;
  const lifecycle = [];
  const status = await runLauncher(
    { command: "install", target: "codex", json: false },
    { version: "2.2.1" },
    {
      signalSource,
      onChildSignal(signal) { lifecycle.push(`signal:${signal}`); },
      tempFactory: { create: () => ({ root: "/tmp/maister-signal", retain() {}, cleanup() { cleaned += 1; lifecycle.push("cleanup"); } }) },
      transport: {
        request: async (_descriptor, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
          signalSource.emit("SIGINT");
        }),
      },
    },
  );
  assert.equal(status, 130);
  assert.equal(cleaned, 1);
  assert.deepEqual(lifecycle, ["cleanup", "signal:SIGINT"]);
});

test("signal outcomes map to conventional non-success statuses", () => {
  assert.equal(childStatus({ code: null, signal: "SIGINT" }), 130);
  assert.equal(childStatus({ code: null, signal: "SIGTERM" }), 143);
  assert.equal(childStatus({ code: null, signal: "SIGKILL" }), 7);
  for (const code of [0, 2, 3, 4, 5, 6, 7, 8]) assert.equal(childStatus({ code, signal: null }), code);
});

test("state-only signal outcomes retain the child signal for POSIX re-raise", async () => {
  let observedSignal = null;
  const status = await runLauncher(
    { command: "status", target: "codex", json: false },
    { version: "2.2.1" },
    {
      authorityStore: { readActiveReceipt: () => ({ installerPath: "/verified/maister-install.mjs" }) },
      delegate: async () => ({ code: null, signal: "SIGTERM" }),
      onChildSignal: (signal) => { observedSignal = signal; },
    },
  );
  assert.equal(status, 143);
  assert.equal(observedSignal, "SIGTERM");
});
