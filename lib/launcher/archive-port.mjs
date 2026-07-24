import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";

import * as tar from "tar";

const BLOCK_BYTES = 512;
const MAX_ENTRIES = 50_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_PATH_BYTES = 1024;
const MAX_SEGMENTS = 128;
const MAX_GZIP_HEADER_BYTES = 64 * 1024;
const RATIO_GRACE_BYTES = 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const INSPECTION_PLANS = new WeakSet();

function archiveError(kind, message, details = {}, cause) {
  const error = new Error(message, cause === undefined ? {} : { cause });
  error.kind = kind;
  error.details = details;
  throw error;
}

function wrapArchiveError(kind, message, cause) {
  if (cause?.kind) throw cause;
  archiveError(kind, message, {}, cause);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const CRC32_TABLE = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 0 ? crc >>> 1 : 0xedb88320 ^ (crc >>> 1);
  return crc >>> 0;
}));

function updateCrc32(current, bytes) {
  let crc = current;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function finalCrc32(current) {
  return (current ^ 0xffffffff) >>> 0;
}

function zeroBlock(bytes) {
  return bytes.every((byte) => byte === 0);
}

function decodeField(bytes, start, length, label) {
  const field = bytes.subarray(start, start + length);
  const nul = field.indexOf(0);
  const content = field.subarray(0, nul === -1 ? field.length : nul);
  if (nul !== -1 && field.subarray(nul).some((byte) => byte !== 0)) {
    archiveError("E_LAUNCHER_ARCHIVE_HEADER", `${label} has non-zero bytes after its terminator`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (cause) {
    archiveError("E_LAUNCHER_ARCHIVE_HEADER", `${label} is not valid UTF-8`, {}, cause);
  }
}

function parseOctal(bytes, start, length, label) {
  const field = bytes.subarray(start, start + length);
  if ((field[0] & 0x80) !== 0) archiveError("E_LAUNCHER_ARCHIVE_HEADER", `${label} uses a forbidden base-256 encoding`);
  const raw = field.toString("ascii").replace(/[\0 ]+$/u, "");
  if (!/^[0-7]+$/u.test(raw)) archiveError("E_LAUNCHER_ARCHIVE_HEADER", `${label} is not canonical octal`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) archiveError("E_LAUNCHER_ARCHIVE_HEADER", `${label} exceeds the safe integer range`);
  return value;
}

function validatePath(entryPath) {
  // POSIX tar conventionally stores directory names with one trailing slash.
  // Normalize that representation before applying the no-empty-segment rule;
  // repeated slashes still fail closed below.
  const normalizedEntryPath = entryPath.endsWith("/") ? entryPath.slice(0, -1) : entryPath;
  if (Buffer.byteLength(normalizedEntryPath, "utf8") > MAX_PATH_BYTES || normalizedEntryPath.split("/").length > MAX_SEGMENTS) {
    archiveError("E_LAUNCHER_ARCHIVE_PATH", "archive path exceeds its limit");
  }
  if (!normalizedEntryPath.startsWith("plugins/maister")
    || (normalizedEntryPath !== "plugins/maister" && !normalizedEntryPath.startsWith("plugins/maister/"))
    || normalizedEntryPath.startsWith("/")
    || normalizedEntryPath.startsWith("//")
    || /^[A-Za-z]:/u.test(normalizedEntryPath)
    || normalizedEntryPath.includes("\\")) {
    archiveError("E_LAUNCHER_ARCHIVE_PATH", "archive path is outside plugins/maister");
  }
  const segments = normalizedEntryPath.split("/");
  if (segments.some((segment) => segment === ""
    || segment === "."
    || segment === ".."
    || segment === ".git"
    || /^[A-Za-z]:/u.test(segment)
    || /[\0-\x1f\x7f]/u.test(segment))) {
    archiveError("E_LAUNCHER_ARCHIVE_PATH", "archive path contains an unsafe segment");
  }
  if (path.posix.normalize(normalizedEntryPath) !== normalizedEntryPath) archiveError("E_LAUNCHER_ARCHIVE_PATH", "archive path is not normalized");
  return normalizedEntryPath;
}

function executableAllowed(entryPath) {
  return /^plugins\/maister\/bin\/(?:maister-agent-gate|maister-install|materialize)\.mjs$/u.test(entryPath)
  || /^plugins\/maister\/overlays\/(?:codex|cursor|kiro-cli|pi)\/assets\/hooks\/[^/]+\.sh$/u.test(entryPath)
  || entryPath === "plugins/maister/skills/init/bin/reconcile-gate-config.sh";
}

function appendLimited(left, right, maximum, kind, label) {
  if (left.length + right.length > maximum) archiveError(kind, `${label} exceeds its limit`);
  return left.length === 0 ? Buffer.from(right) : Buffer.concat([left, right], left.length + right.length);
}

function gzipHeaderLength(bytes) {
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) archiveError("E_LAUNCHER_ARCHIVE_GZIP", "archive must contain one gzip member");
  const flags = bytes[3];
  if ((flags & 0xe0) !== 0) archiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip reserved flags are set");
  let offset = 10;
  if ((flags & 0x04) !== 0) {
    if (bytes.length < offset + 2) return null;
    const extraLength = bytes.readUInt16LE(offset);
    if (bytes.length < offset + 2 + extraLength) return null;
    offset += 2 + extraLength;
  }
  for (const flag of [0x08, 0x10]) {
    if ((flags & flag) !== 0) {
      const end = bytes.indexOf(0, offset);
      if (end === -1) return null;
      if (end - offset > MAX_PATH_BYTES) archiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip text field exceeds its limit");
      offset = end + 1;
    }
  }
  if ((flags & 0x02) !== 0) {
    if (bytes.length < offset + 2) return null;
    const expected = finalCrc32(updateCrc32(0xffffffff, bytes.subarray(0, offset))) & 0xffff;
    if (bytes.readUInt16LE(offset) !== expected) archiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip header checksum is invalid");
    offset += 2;
  }
  return offset;
}

class TarInspector {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.phase = "header";
    this.current = null;
    this.remainingData = 0;
    this.remainingPadding = 0;
    this.terminalBlocks = 0;
    this.expandedTarBytes = 0;
    this.regularFileBytes = 0;
    this.regularFiles = 0;
    this.directories = 0;
    this.entries = [];
    this.exactPaths = new Set();
    this.portablePaths = new Set();
    this.portableComponents = new Map();
    this.types = new Map();
    this.crc = 0xffffffff;
  }

  consume(chunk) {
    this.expandedTarBytes += chunk.length;
    this.crc = updateCrc32(this.crc, chunk);
    let offset = 0;
    while (offset < chunk.length) {
      if (this.phase === "terminal") {
        if (chunk.subarray(offset).some((byte) => byte !== 0)) archiveError("E_LAUNCHER_ARCHIVE_HEADER", "tar contains data after its terminal blocks");
        return;
      }
      if (this.phase === "header") {
        const needed = BLOCK_BYTES - this.buffer.length;
        const taken = Math.min(needed, chunk.length - offset);
        this.buffer = appendLimited(this.buffer, chunk.subarray(offset, offset + taken), BLOCK_BYTES, "E_LAUNCHER_ARCHIVE_HEADER", "tar header");
        offset += taken;
        if (this.buffer.length === BLOCK_BYTES) {
          const header = this.buffer;
          this.buffer = Buffer.alloc(0);
          if (zeroBlock(header)) {
            this.terminalBlocks += 1;
            if (this.terminalBlocks === 2) this.phase = "terminal";
          } else {
            if (this.terminalBlocks !== 0) archiveError("E_LAUNCHER_ARCHIVE_HEADER", "tar contains data after one terminal block");
            this.startEntry(header);
          }
        }
        continue;
      }
      if (this.phase === "data") {
        const taken = Math.min(this.remainingData, chunk.length - offset);
        this.current.hash.update(chunk.subarray(offset, offset + taken));
        this.remainingData -= taken;
        offset += taken;
        if (this.remainingData === 0) {
          this.current.entry.sha256 = this.current.hash.digest("hex");
          this.phase = this.remainingPadding === 0 ? "header" : "padding";
        }
        continue;
      }
      const taken = Math.min(this.remainingPadding, chunk.length - offset);
      if (chunk.subarray(offset, offset + taken).some((byte) => byte !== 0)) archiveError("E_LAUNCHER_ARCHIVE_HEADER", "tar entry padding must be zero");
      this.remainingPadding -= taken;
      offset += taken;
      if (this.remainingPadding === 0) this.phase = "header";
    }
  }

  startEntry(header) {
    let checksum = 0;
    for (let index = 0; index < BLOCK_BYTES; index += 1) checksum += index >= 148 && index < 156 ? 0x20 : header[index];
    if (parseOctal(header, 148, 8, "header checksum") !== checksum) archiveError("E_LAUNCHER_ARCHIVE_HEADER", "tar header checksum is invalid");
    if (header.subarray(257, 263).toString("latin1") !== "ustar\0" || header.subarray(263, 265).toString("latin1") !== "00") {
      archiveError("E_LAUNCHER_ARCHIVE_HEADER", "only POSIX ustar headers are accepted");
    }
    const name = decodeField(header, 0, 100, "path name");
    const prefix = decodeField(header, 345, 155, "path prefix");
    const entryPath = validatePath(prefix ? `${prefix}/${name}` : name);
    const typeByte = header[156];
    const type = typeByte === 0 || typeByte === 0x30 ? "file" : typeByte === 0x35 ? "directory" : null;
    if (!type) archiveError("E_LAUNCHER_ARCHIVE_TYPE", "links, extensions, sparse, and special archive entries are forbidden", { path: entryPath, type: typeByte });
    if (decodeField(header, 157, 100, "link name") !== "") archiveError("E_LAUNCHER_ARCHIVE_TYPE", "archive link metadata is forbidden", { path: entryPath });
    const rawMode = parseOctal(header, 100, 8, "mode");
    const mode = rawMode & 0o7777;
    const uid = parseOctal(header, 108, 8, "uid");
    const gid = parseOctal(header, 116, 8, "gid");
    const size = parseOctal(header, 124, 12, "size");
    if (uid !== 0 || gid !== 0 || decodeField(header, 265, 32, "owner name") !== "" || decodeField(header, 297, 32, "group name") !== "") {
      archiveError("E_LAUNCHER_ARCHIVE_OWNER", "archive entries must use numeric zero ownership and empty names");
    }
    if (rawMode !== mode || (mode & 0o7022) !== 0 || ![0o644, 0o755].includes(mode)) archiveError("E_LAUNCHER_ARCHIVE_MODE", "archive entry mode is forbidden", { path: entryPath, mode: rawMode });
    if (type === "directory" && (mode !== 0o755 || size !== 0)) archiveError("E_LAUNCHER_ARCHIVE_MODE", "archive directories must be empty and mode 0755", { path: entryPath });
    if (type === "file" && mode === 0o755 && !executableAllowed(entryPath)) archiveError("E_LAUNCHER_ARCHIVE_MODE", "unexpected executable archive entry", { path: entryPath });
    if (size > MAX_FILE_BYTES) archiveError("E_LAUNCHER_ARCHIVE_LIMIT", "archive member exceeds the regular-file limit", { path: entryPath });

    const portable = entryPath.normalize("NFKC").toLocaleLowerCase("en-US");
    if (this.exactPaths.has(entryPath) || this.portablePaths.has(portable)) archiveError("E_LAUNCHER_ARCHIVE_COLLISION", "archive contains a duplicate or portable path collision", { path: entryPath });
    const components = entryPath.split("/");
    for (let index = 1; index <= components.length; index += 1) {
      const exactComponentPath = components.slice(0, index).join("/");
      const portableComponentPath = exactComponentPath.normalize("NFKC").toLocaleLowerCase("en-US");
      const prior = this.portableComponents.get(portableComponentPath);
      if (prior !== undefined && prior !== exactComponentPath) {
        archiveError("E_LAUNCHER_ARCHIVE_COLLISION", "archive contains a portable parent-path collision", { path: entryPath, collision: prior });
      }
      this.portableComponents.set(portableComponentPath, exactComponentPath);
    }
    for (let parent = path.posix.dirname(entryPath); parent !== "."; parent = path.posix.dirname(parent)) {
      if (this.types.get(parent) === "file") archiveError("E_LAUNCHER_ARCHIVE_COLLISION", "archive entry is nested below a file", { path: entryPath, parent });
    }
    if (type === "file" && [...this.types.keys()].some((candidate) => candidate.startsWith(`${entryPath}/`))) {
      archiveError("E_LAUNCHER_ARCHIVE_COLLISION", "archive file replaces an existing parent directory", { path: entryPath });
    }
    if (this.entries.length + 1 > MAX_ENTRIES) archiveError("E_LAUNCHER_ARCHIVE_LIMIT", "archive exceeds the entry-count limit");
    if (type === "file" && this.regularFileBytes + size > MAX_EXPANDED_BYTES) archiveError("E_LAUNCHER_ARCHIVE_LIMIT", "archive exceeds the expanded regular-file limit");

    const entry = { path: entryPath, type, mode, size };
    this.entries.push(entry);
    this.exactPaths.add(entryPath);
    this.portablePaths.add(portable);
    this.types.set(entryPath, type);
    if (type === "file") {
      this.regularFiles += 1;
      this.regularFileBytes += size;
      this.current = { entry, hash: crypto.createHash("sha256") };
      this.remainingData = size;
      this.remainingPadding = (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
      if (size === 0) {
        entry.sha256 = this.current.hash.digest("hex");
        this.phase = "header";
      } else {
        this.phase = "data";
      }
    } else {
      this.directories += 1;
      this.phase = "header";
    }
  }

  finish(compressedBytes, archiveSha256) {
    if (this.phase !== "terminal" || this.terminalBlocks !== 2 || this.buffer.length !== 0) {
      archiveError("E_LAUNCHER_ARCHIVE_HEADER", "tar is truncated or lacks two terminal zero blocks");
    }
    if (this.entries.length === 0) archiveError("E_LAUNCHER_ARCHIVE_TOPOLOGY", "archive is empty");
    if (this.regularFileBytes > RATIO_GRACE_BYTES && this.regularFileBytes / compressedBytes > 100) {
      archiveError("E_LAUNCHER_ARCHIVE_LIMIT", "archive compression ratio exceeds 100:1");
    }
    const plan = deepFreeze({
      schemaVersion: 1,
      archiveSha256,
      gzipCrc32: finalCrc32(this.crc).toString(16).padStart(8, "0"),
      counters: {
        compressedBytes,
        expandedTarBytes: this.expandedTarBytes,
        regularFileBytes: this.regularFileBytes,
        entries: this.entries.length,
        regularFiles: this.regularFiles,
        directories: this.directories,
      },
      entries: this.entries,
    });
    INSPECTION_PLANS.add(plan);
    return plan;
  }
}

function updateTail(tail, chunk) {
  if (chunk.length >= 8) return Buffer.from(chunk.subarray(chunk.length - 8));
  const combined = Buffer.concat([tail, chunk], tail.length + chunk.length);
  return combined.length <= 8 ? combined : Buffer.from(combined.subarray(combined.length - 8));
}

async function writeWithBackpressure(stream, chunk) {
  await new Promise((resolve, reject) => {
    stream.write(chunk, (error) => error ? reject(error) : resolve());
  });
}

export async function inspectArchiveStream(source) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") archiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source must be an async byte stream");
  const archiveHash = crypto.createHash("sha256");
  const inflater = createInflateRaw({ chunkSize: STREAM_CHUNK_BYTES });
  const inspector = new TarInspector();
  let primaryError = null;

  function supervise(operation) {
    return operation.then(
      () => ({ status: "fulfilled", error: null }),
      (error) => {
        primaryError ??= error;
        if (!inflater.destroyed) inflater.destroy(primaryError);
        return { status: "rejected", error };
      },
    );
  }

  const inspectOutput = supervise((async () => {
    try {
      for await (const chunk of inflater) inspector.consume(Buffer.from(chunk));
    } catch (cause) {
      wrapArchiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip deflate payload is invalid", cause);
    }
  })());
  let header = Buffer.alloc(0);
  let headerLength = null;
  let compressedBytes = 0;
  let deflateInputBytes = 0;
  let tail = Buffer.alloc(0);
  const provideInput = supervise((async () => {
    for await (const rawChunk of source) {
      const chunk = Buffer.from(rawChunk);
      compressedBytes += chunk.length;
      if (compressedBytes > MAX_COMPRESSED_BYTES) archiveError("E_LAUNCHER_ARCHIVE_LIMIT", "archive exceeds the compressed-byte limit");
      archiveHash.update(chunk);
      let body = chunk;
      if (headerLength === null) {
        header = appendLimited(header, chunk, MAX_GZIP_HEADER_BYTES, "E_LAUNCHER_ARCHIVE_GZIP", "gzip header");
        headerLength = gzipHeaderLength(header);
        if (headerLength === null) continue;
        body = header.subarray(headerLength);
        header = Buffer.alloc(0);
      }
      if (body.length > 0) {
        deflateInputBytes += body.length;
        tail = updateTail(tail, body);
        await writeWithBackpressure(inflater, body);
      }
    }
    if (headerLength === null) archiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip header is truncated");
    inflater.end();
  })());
  await Promise.all([provideInput, inspectOutput]);
  if (primaryError) wrapArchiveError("E_LAUNCHER_ARCHIVE_GZIP", "archive stream could not be inspected", primaryError);
  const deflateBytes = inflater.bytesWritten;
  if (deflateInputBytes - deflateBytes !== 8 || tail.length !== 8) {
    archiveError("E_LAUNCHER_ARCHIVE_GZIP", "concatenated gzip members or trailing data are forbidden");
  }
  const expectedCrc = tail.readUInt32LE(0);
  const expectedSize = tail.readUInt32LE(4);
  if (expectedCrc !== finalCrc32(inspector.crc) || expectedSize !== (inspector.expandedTarBytes >>> 0)) {
    archiveError("E_LAUNCHER_ARCHIVE_GZIP", "gzip checksum or expanded-size validation failed");
  }
  return inspector.finish(compressedBytes, archiveHash.digest("hex"));
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.realpath === right.realpath;
}

function directoryIdentity(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) archiveError("E_LAUNCHER_ARCHIVE_TARGET", "extraction target identity is not a private directory");
  return Object.freeze({ dev: stat.dev, ino: stat.ino, realpath: fs.realpathSync.native(directory) });
}

function assertDirectoryIdentity(directory, expected) {
  const actual = directoryIdentity(directory);
  if (!sameIdentity(actual, expected)) archiveError("E_LAUNCHER_ARCHIVE_TARGET", "extraction target identity changed during extraction");
}

export async function inspectArchiveFile(sourcePath) {
  let handle;
  try {
    handle = await fs.promises.open(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile()) archiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source must be a regular file");
    const plan = await inspectArchiveStream(handle.createReadStream({ autoClose: false, highWaterMark: STREAM_CHUNK_BYTES }));
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      archiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source identity changed during inspection");
    }
    return plan;
  } catch (cause) {
    wrapArchiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source could not be inspected", cause);
  } finally {
    await handle?.close();
  }
}

async function hashFileNoFollow(filePath, expectedStat) {
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== expectedStat.dev || before.ino !== expectedStat.ino) archiveError("E_LAUNCHER_ARCHIVE_POSTWALK", "extracted file identity changed", { path: filePath });
    const hash = crypto.createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: STREAM_CHUNK_BYTES })) hash.update(chunk);
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      archiveError("E_LAUNCHER_ARCHIVE_POSTWALK", "extracted file changed while hashing", { path: filePath });
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function walkNoFollow(root, relative = "") {
  const results = [];
  const names = await fs.promises.readdir(path.join(root, relative));
  names.sort();
  for (const name of names) {
    const childRelative = relative ? path.posix.join(relative, name) : name;
    const absolute = path.join(root, ...childRelative.split("/"));
    const stat = await fs.promises.lstat(absolute);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) archiveError("E_LAUNCHER_ARCHIVE_POSTWALK", "extracted tree contains an unsupported type", { path: childRelative });
    if (childRelative !== "plugins") {
      results.push({
        path: childRelative,
        type: stat.isDirectory() ? "directory" : "file",
        mode: stat.mode & 0o7777,
        size: stat.isFile() ? stat.size : 0,
        ...(stat.isFile() ? { sha256: await hashFileNoFollow(absolute, stat) } : {}),
      });
    }
    if (stat.isDirectory()) results.push(...await walkNoFollow(root, childRelative));
  }
  return results;
}

function validatePlan(plan) {
  if (!INSPECTION_PLANS.has(plan) || !Object.isFrozen(plan) || !Object.isFrozen(plan.entries) || plan.schemaVersion !== 1 || !Array.isArray(plan.entries)) {
    archiveError("E_LAUNCHER_ARCHIVE_PLAN", "archive extraction requires an immutable inspection plan");
  }
  return new Map(plan.entries.map((entry) => [entry.path, entry]));
}

export async function extractArchiveFile(plan, sourcePath, targetPath) {
  const accepted = validatePlan(plan);
  if (fs.lstatSync(targetPath, { throwIfNoEntry: false })) archiveError("E_LAUNCHER_ARCHIVE_TARGET", "archive extraction target must not already exist");
  let sourceHandle;
  let targetIdentity;
  try {
    sourceHandle = await fs.promises.open(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const sourceBefore = await sourceHandle.stat();
    if (!sourceBefore.isFile() || sourceBefore.size !== plan.counters.compressedBytes) {
      archiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source does not match the inspected file identity");
    }
    fs.mkdirSync(targetPath, { mode: 0o700 });
    fs.chmodSync(targetPath, 0o700);
    targetIdentity = directoryIdentity(targetPath);
    assertDirectoryIdentity(targetPath, targetIdentity);
    const archiveHash = crypto.createHash("sha256");
    let observedBytes = 0;
    const hashStream = new Transform({
      transform(chunk, _encoding, callback) {
        observedBytes += chunk.length;
        archiveHash.update(chunk);
        callback(null, chunk);
      },
    });
    const unpack = tar.x({
      cwd: targetPath,
      strict: true,
      preservePaths: false,
      keep: true,
      preserveOwner: false,
      maxDepth: 128,
      maxDecompressionRatio: 100,
      maxMetaEntrySize: 1_048_576,
      unlink: false,
      filter(entryPath, entry) {
        const normalized = entryPath.replace(/\/$/u, "");
        const expected = accepted.get(normalized);
        const actualType = entry.type === "Directory" ? "directory" : entry.type === "File" || entry.type === "OldFile" ? "file" : null;
        return Boolean(expected
          && expected.type === actualType
          && expected.mode === (entry.mode & 0o7777)
          && expected.size === entry.size
          && entry.uid === 0
          && entry.gid === 0);
      },
    });
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false, highWaterMark: STREAM_CHUNK_BYTES }),
      hashStream,
      unpack,
    );
    const sourceAfter = await sourceHandle.stat();
    if (sourceBefore.dev !== sourceAfter.dev
      || sourceBefore.ino !== sourceAfter.ino
      || sourceBefore.size !== sourceAfter.size
      || sourceBefore.mtimeMs !== sourceAfter.mtimeMs
      || observedBytes !== plan.counters.compressedBytes
      || archiveHash.digest("hex") !== plan.archiveSha256) {
      archiveError("E_LAUNCHER_ARCHIVE_INPUT", "archive source changed after inspection");
    }
    assertDirectoryIdentity(targetPath, targetIdentity);
    const actual = await walkNoFollow(targetPath);
    if (actual.length !== plan.entries.length) archiveError("E_LAUNCHER_ARCHIVE_POSTWALK", "extracted topology does not match the inspection plan");
    const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
    for (const expected of plan.entries) {
      const observed = actualByPath.get(expected.path);
      if (!observed
        || observed.type !== expected.type
        || observed.size !== expected.size
        || observed.mode !== expected.mode
        || (expected.type === "file" && observed.sha256 !== expected.sha256)) {
        archiveError("E_LAUNCHER_ARCHIVE_POSTWALK", "extracted entry does not match the inspection plan", { path: expected.path });
      }
    }
    return deepFreeze({ root: targetPath, identity: targetIdentity, entries: actual });
  } catch (error) {
    try {
      if (targetIdentity) {
        assertDirectoryIdentity(targetPath, targetIdentity);
        fs.rmSync(targetPath, { recursive: true, force: false });
      }
    } catch (cleanupError) {
      error.details = { ...(error.details ?? {}), cleanupWarning: cleanupError.message, retainedRoot: targetPath };
    }
    throw error;
  } finally {
    await sourceHandle?.close();
  }
}

export function createArchivePort() {
  return Object.freeze({
    inspect: inspectArchiveFile,
    inspectStream: inspectArchiveStream,
    extract: extractArchiveFile,
  });
}
