import { spawn } from "node:child_process";

const DEFAULT_CAPTURE_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;

function appendBounded(chunks, chunk, state, maximumBytes) {
  chunks.push(chunk);
  state.bytes += chunk.length;
  let excessBytes = state.bytes - maximumBytes;
  if (excessBytes <= 0) return;

  state.truncated = true;
  while (excessBytes > 0) {
    const oldest = chunks[0];
    if (oldest.length <= excessBytes) {
      chunks.shift();
      state.bytes -= oldest.length;
      excessBytes -= oldest.length;
    } else {
      chunks[0] = oldest.subarray(excessBytes);
      state.bytes -= excessBytes;
      excessBytes = 0;
    }
  }
}

function terminalClassification(code, signal, timeoutClassification) {
  if (timeoutClassification) return timeoutClassification;
  if (code === 0 && signal === null) return "passed";
  return "failed";
}

export function runWithExternalWatchdog({
  command,
  args = [],
  cwd,
  env = process.env,
  heartbeatKind,
  heartbeatDeadlineMs = null,
  supervisorHeartbeatMs = null,
  totalDeadlineMs,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  maximumCaptureBytes = DEFAULT_CAPTURE_BYTES,
  onRecord = () => {},
  onSupervisorHeartbeat = () => {},
  onStdout = () => {},
  onStderr = () => {},
}) {
  if (
    !command ||
    totalDeadlineMs <= 0 ||
    (heartbeatDeadlineMs !== null &&
      (!heartbeatKind || heartbeatDeadlineMs <= 0)) ||
    (supervisorHeartbeatMs !== null &&
      (!heartbeatKind || supervisorHeartbeatMs <= 0)) ||
    !Number.isInteger(maximumCaptureBytes) ||
    maximumCaptureBytes < 0
  ) {
    throw new TypeError(
      "external watchdog requires a command, a positive total deadline, valid heartbeat configuration, and a non-negative integer capture limit",
    );
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastHeartbeatAt = startedAt;
    let timeoutClassification = null;
    let stdoutLineBuffer = "";
    let stderrLineBuffer = "";
    let stdoutLineSequence = 0;
    let stderrLineSequence = 0;
    let arrivalSequence = 0;
    let lastRecord = null;
    let forceKillTimer;
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    const stdoutState = { bytes: 0, truncated: false };
    const stderrState = { bytes: 0, truncated: false };
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    function requestTermination(classification) {
      if (
        timeoutClassification ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        return;
      timeoutClassification = classification;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      forceKillTimer.unref();
    }

    function consumeRecords(text, lineBuffer, flush = false) {
      const lines = `${lineBuffer}${text}`.split("\n");
      const remainder = flush ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          lastRecord = record;
          if (record?.kind === heartbeatKind) lastHeartbeatAt = Date.now();
          onRecord(record);
        } catch {
          // Human-readable child diagnostics are forwarded but are not watchdog records.
        }
      }
      return remainder;
    }

    const heartbeatPoll =
      heartbeatDeadlineMs === null
        ? null
        : setInterval(
            () => {
              if (Date.now() - lastHeartbeatAt > heartbeatDeadlineMs)
                requestTermination("heartbeat-timeout");
            },
            Math.max(10, Math.min(1_000, Math.floor(heartbeatDeadlineMs / 4))),
          );
    heartbeatPoll?.unref();

    const supervisorHeartbeat =
      supervisorHeartbeatMs === null
        ? null
        : setInterval(() => {
            onSupervisorHeartbeat(
              Object.freeze({
                kind: heartbeatKind,
                source: "external-parent",
                elapsed_ms: Date.now() - startedAt,
                child_pid: child.pid,
                lastRecord,
              }),
            );
          }, supervisorHeartbeatMs);
    supervisorHeartbeat?.unref();

    const totalDeadline = setTimeout(
      () => requestTermination("harness-timeout"),
      totalDeadlineMs,
    );
    totalDeadline.unref();

    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      appendBounded(stdoutChunks, bytes, stdoutState, maximumCaptureBytes);
      onStdout(bytes);
      stdoutLineBuffer = consumeRecords(
        stdoutDecoder.decode(bytes, { stream: true }),
        stdoutLineBuffer,
      );
      stdoutLineSequence = stdoutLineBuffer ? ++arrivalSequence : 0;
    });
    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      appendBounded(stderrChunks, bytes, stderrState, maximumCaptureBytes);
      onStderr(bytes);
      stderrLineBuffer = consumeRecords(
        stderrDecoder.decode(bytes, { stream: true }),
        stderrLineBuffer,
      );
      stderrLineSequence = stderrLineBuffer ? ++arrivalSequence : 0;
    });

    child.once("error", (error) => {
      clearInterval(heartbeatPoll);
      clearInterval(supervisorHeartbeat);
      clearTimeout(totalDeadline);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearInterval(heartbeatPoll);
      clearInterval(supervisorHeartbeat);
      clearTimeout(totalDeadline);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      stdoutLineBuffer = consumeRecords(
        stdoutDecoder.decode(),
        stdoutLineBuffer,
      );
      stderrLineBuffer = consumeRecords(
        stderrDecoder.decode(),
        stderrLineBuffer,
      );
      for (const { lineBuffer, sequence } of [
        { lineBuffer: stdoutLineBuffer, sequence: stdoutLineSequence },
        { lineBuffer: stderrLineBuffer, sequence: stderrLineSequence },
      ].sort((left, right) => left.sequence - right.sequence)) {
        consumeRecords("", lineBuffer, true);
      }
      resolve(
        Object.freeze({
          classification: terminalClassification(
            code,
            signal,
            timeoutClassification,
          ),
          code,
          signal,
          timedOut: timeoutClassification !== null,
          elapsedMs: Date.now() - startedAt,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          stdoutTruncated: stdoutState.truncated,
          stderrTruncated: stderrState.truncated,
          lastRecord,
        }),
      );
    });
  });
}
