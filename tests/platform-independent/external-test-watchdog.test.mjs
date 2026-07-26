import assert from "node:assert/strict";
import test from "node:test";

import { runWithExternalWatchdog } from "../helpers/external-test-watchdog.mjs";

const HEARTBEAT_KIND = "maister.test.heartbeat";
const INSTALLER_AGGREGATE = new URL(
  "./installer-transaction.test.mjs",
  import.meta.url,
);

function nodeProgram(source) {
  return {
    command: process.execPath,
    args: ["--input-type=module", "--eval", source],
  };
}

test("external watchdog streams heartbeats and classifies a clean child terminal", async () => {
  const records = [];
  const child = nodeProgram(`
    process.stderr.write(JSON.stringify({ kind: "${HEARTBEAT_KIND}", progress: 1 }) + "\\n");
    process.stdout.write("child-output\\n");
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: 1_000,
    totalDeadlineMs: 2_000,
    onRecord: (record) => records.push(record),
  });

  assert.equal(result.classification, "passed");
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "child-output\n");
  assert.deepEqual(records, [{ kind: HEARTBEAT_KIND, progress: 1 }]);
});

test("external watchdog recognizes structured records emitted on child stdout", async () => {
  const records = [];
  const terminalKind = "maister.test.final-tree-evidence";
  const child = nodeProgram(`
    process.stdout.write(JSON.stringify({ kind: "${terminalKind}", final_tree_evidence: [{ sandbox: "complete" }] }) + "\\n");
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    onRecord: (record) => records.push(record),
  });

  assert.equal(result.classification, "passed");
  assert.deepEqual(records, [
    { kind: terminalKind, final_tree_evidence: [{ sandbox: "complete" }] },
  ]);
});

test("external watchdog terminates a silent live child with an explicit heartbeat timeout", async () => {
  const child = nodeProgram("setInterval(() => {}, 1_000)");
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: 50,
    totalDeadlineMs: 2_000,
  });

  assert.equal(result.classification, "heartbeat-timeout");
  assert.equal(result.timedOut, true);
  assert.ok(result.signal || result.code !== 0);
});

test("external watchdog distinguishes child failure from watchdog timeout", async () => {
  const child = nodeProgram("process.exitCode = 9");
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: 1_000,
    totalDeadlineMs: 2_000,
  });

  assert.equal(result.classification, "failed");
  assert.equal(result.code, 9);
  assert.equal(result.timedOut, false);
});

test("external watchdog enforces one total harness deadline despite live heartbeats", async () => {
  const child = nodeProgram(`
    setInterval(() => process.stderr.write(JSON.stringify({ kind: "${HEARTBEAT_KIND}" }) + "\\n"), 10);
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: 500,
    totalDeadlineMs: 75,
  });

  assert.equal(result.classification, "harness-timeout");
  assert.equal(result.timedOut, true);
});

test("external watchdog retains the latest progress record when diagnostics are truncated", async () => {
  const progress = {
    kind: HEARTBEAT_KIND,
    scenario: "clean lifecycle",
    target: "cursor",
  };
  const child = nodeProgram(`
    process.stderr.write("x".repeat(256) + "\\n");
    process.stderr.write(JSON.stringify(${JSON.stringify(progress)}) + "\\n");
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    maximumCaptureBytes: 128,
  });

  assert.equal(result.stderrTruncated, true);
  assert.match(result.stderr, /clean lifecycle/);
  assert.deepEqual(result.lastRecord, progress);
});

test("external watchdog bounds each diagnostic tail without limiting streaming callbacks", async () => {
  const streamedStdout = [];
  const streamedStderr = [];
  const stdout = "stdout-prefix-0123456789";
  const stderr = "stderr-prefix-abcdefghij";
  const child = nodeProgram(`
    process.stdout.write(${JSON.stringify(stdout)});
    process.stderr.write(${JSON.stringify(stderr)});
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    maximumCaptureBytes: 10,
    onStdout: (chunk) => streamedStdout.push(chunk),
    onStderr: (chunk) => streamedStderr.push(chunk),
  });

  assert.equal(result.stdout, stdout.slice(-10));
  assert.equal(result.stderr, stderr.slice(-10));
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.equal(Buffer.concat(streamedStdout).toString("utf8"), stdout);
  assert.equal(Buffer.concat(streamedStderr).toString("utf8"), stderr);
  assert.equal(result.lastRecord, null);
});

test("external watchdog decodes split UTF-8 code points independently per stream", async () => {
  const stdoutRecord = { kind: "stdout-record", value: "snowman ☃" };
  const stderrRecord = { kind: "stderr-record", value: "rocket 🚀" };
  const records = [];
  const child = nodeProgram(`
    const writeSplit = (stream, value, leadingByte, offset) => {
      const bytes = Buffer.from(JSON.stringify(value) + "\\n");
      const split = bytes.indexOf(leadingByte) + offset;
      stream.write(bytes.subarray(0, split));
      setTimeout(() => stream.write(bytes.subarray(split)), 10);
    };
    writeSplit(process.stdout, ${JSON.stringify(stdoutRecord)}, 0xe2, 1);
    writeSplit(process.stderr, ${JSON.stringify(stderrRecord)}, 0xf0, 2);
    setTimeout(() => {}, 30);
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    onRecord: (record) => records.push(record),
  });

  assert.equal(result.classification, "passed");
  assert.deepEqual(records, [stdoutRecord, stderrRecord]);
});

test("external watchdog preserves cross-stream arrival order for unterminated EOF records", async () => {
  const first = { kind: "stderr-record", order: 1 };
  const latest = { kind: "stdout-record", order: 2 };
  const records = [];
  const child = nodeProgram(`
    process.stderr.write(JSON.stringify(${JSON.stringify(first)}));
    setTimeout(() => process.stdout.write(JSON.stringify(${JSON.stringify(latest)})), 30);
    setTimeout(() => {}, 60);
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    onRecord: (record) => records.push(record),
  });

  assert.deepEqual(records, [first, latest]);
  assert.deepEqual(result.lastRecord, latest);
});

test("external watchdog validates maximumCaptureBytes synchronously", () => {
  for (const maximumCaptureBytes of [-1, 1.5, Number.NaN, Infinity, "1"]) {
    assert.throws(
      () =>
        runWithExternalWatchdog({
          ...nodeProgram(""),
          heartbeatKind: HEARTBEAT_KIND,
          totalDeadlineMs: 2_000,
          maximumCaptureBytes,
        }),
      { name: "TypeError" },
      String(maximumCaptureBytes),
    );
  }
});

test("external watchdog supports zero-byte diagnostic capture", async () => {
  const streamed = [];
  const result = await runWithExternalWatchdog({
    ...nodeProgram('process.stdout.write("diagnostic")'),
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 2_000,
    maximumCaptureBytes: 0,
    onStdout: (chunk) => streamed.push(chunk),
  });

  assert.equal(result.stdout, "");
  assert.equal(result.stdoutTruncated, true);
  assert.equal(Buffer.concat(streamed).toString("utf8"), "diagnostic");
});

test("external watchdog parses split interleaved records in completion order", async () => {
  const first = { kind: "stderr-record", order: 1 };
  const latest = { kind: HEARTBEAT_KIND, order: 2 };
  const latestLine = JSON.stringify(latest);
  const records = [];
  const heartbeats = [];
  const child = nodeProgram(`
    process.stdout.write(${JSON.stringify(latestLine.slice(0, 12))});
    setTimeout(() => process.stderr.write(${JSON.stringify(`${JSON.stringify(first)}\n`)}), 10);
    setTimeout(() => process.stdout.write(${JSON.stringify(`${latestLine.slice(12)}\n`)}), 30);
    setTimeout(() => {}, 70);
  `);
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    supervisorHeartbeatMs: 10,
    totalDeadlineMs: 2_000,
    onRecord: (record) => records.push(record),
    onSupervisorHeartbeat: (record) => heartbeats.push(record),
  });

  assert.deepEqual(records, [first, latest]);
  assert.deepEqual(result.lastRecord, latest);
  assert.ok(heartbeats.some((record) => record.lastRecord === null));
  assert.ok(heartbeats.some((record) => record.lastRecord?.order === 2));
});

test("external parent streams supervisory heartbeats even when the child event loop is silent", async () => {
  const heartbeats = [];
  const child = nodeProgram("setTimeout(() => {}, 60)");
  const result = await runWithExternalWatchdog({
    ...child,
    heartbeatKind: HEARTBEAT_KIND,
    heartbeatDeadlineMs: null,
    supervisorHeartbeatMs: 10,
    totalDeadlineMs: 1_000,
    onSupervisorHeartbeat: (record) => heartbeats.push(record),
  });

  assert.equal(result.classification, "passed");
  assert.ok(heartbeats.length >= 2);
  assert.ok(
    heartbeats.every(
      (record) =>
        record.kind === HEARTBEAT_KIND && record.source === "external-parent",
    ),
  );
});

async function runAggregateProgressFixture(mode) {
  const records = [];
  const env = {
    ...process.env,
    MAISTER_INSTALLER_TRANSACTION_PROGRESS_FIXTURE: mode,
  };
  delete env.NODE_TEST_CONTEXT;
  const result = await runWithExternalWatchdog({
    command: process.execPath,
    args: ["--test", INSTALLER_AGGREGATE.pathname],
    env,
    heartbeatKind: "maister.installer-transaction.heartbeat",
    heartbeatDeadlineMs: null,
    totalDeadlineMs: 3_000,
    onRecord: (record) => records.push(record),
  });
  return { records, result };
}

test("progress fixture emits exact target transitions with monotonic counts", async () => {
  const { records, result } = await runAggregateProgressFixture("transitions");
  const progress = records.filter(
    (record) =>
      record.kind === "maister.installer-transaction.heartbeat" && record.event,
  );

  assert.equal(result.classification, "passed");
  assert.deepEqual(
    progress.map(({ event, target }) => [event, target]),
    [
      ["scenario-start", null],
      ["target-start", "codex"],
      ["heartbeat", "codex"],
      ["target-finish", "codex"],
      ["scenario-finish", null],
    ],
  );
  assert.deepEqual(progress.map(({ sandbox_count }) => sandbox_count), [0, 1, 1, 1, 1]);
  assert.deepEqual(progress.map(({ invocation_count }) => invocation_count), [0, 0, 1, 1, 1]);
  assert.ok(progress.every((record) => Number.isInteger(record.elapsed_ms)));
  assert.equal(progress.at(-1).scenario_elapsed_ms >= 0, true);
});

test("progress fixture exposes null pre-progress supervisory context", async () => {
  const { records, result } = await runAggregateProgressFixture("pre-progress");
  const supervisor = records.find(
    (record) => record.source === "external-parent",
  );
  const terminal = records.find(
    (record) => record.kind === "maister.installer-transaction.terminal",
  );

  assert.equal(result.classification, "passed");
  assert.deepEqual(supervisor?.lastRecord, null);
  assert.deepEqual(supervisor?.last_progress, null);
  assert.deepEqual(terminal?.lastRecord, null);
  assert.deepEqual(terminal?.last_progress, null);
});

test("target timeout retains active target progress in supervisory and terminal records", async () => {
  const { records, result } = await runAggregateProgressFixture("target-timeout");
  const supervisors = records.filter(
    (record) =>
      record.source === "external-parent" &&
      record.last_progress?.target === "cursor",
  );
  const terminal = records.find(
    (record) => record.kind === "maister.installer-transaction.terminal",
  );

  assert.equal(result.classification, "failed");
  assert.ok(supervisors.length > 0);
  assert.ok(
    supervisors.every(
      (record) => record.last_progress.target === "cursor",
    ),
  );
  assert.equal(terminal?.classification, "harness-timeout");
  assert.equal(terminal?.last_progress.target, "cursor");
});

test("final-tree record does not overwrite terminal last_progress", async () => {
  const { records, result } = await runAggregateProgressFixture("final-tree");
  const terminal = records.find(
    (record) => record.kind === "maister.installer-transaction.terminal",
  );

  assert.equal(result.classification, "passed");
  assert.equal(
    terminal?.lastRecord.kind,
    "maister.installer-transaction.final-tree-evidence",
  );
  assert.equal(terminal?.last_progress.event, "scenario-finish");
  assert.equal(terminal?.last_progress.target, null);
  assert.ok(terminal?.final_tree_evidence.length > 0);
});
