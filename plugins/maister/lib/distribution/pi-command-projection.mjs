import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  failAgentProjection,
} from "./agent-projection-validator.mjs";
import {
  normalizeRelativePath,
} from "./path-safety.mjs";
import { canonicalJson } from "./provenance.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

export const PI_COMMAND_PROJECTION_VERSION = "pi-command-projection-v1";

export const PI_COMMAND_ORIGINS = Object.freeze([
  ["modeling-aggregate-designer", "e26cc4e9edf01a3fcf72d2fc5bbb297549a7cdf7e352e945986b6b9fa35a5ecf"],
  ["modeling-context-distiller", "670532520a79a3ca141ee58acf24429c1f86aaac6403a4f90b4f2cbf5e073cf3"],
  ["quick-metaprogram-classifier", "2b6f9a9139bde51a093063bcd1a6ba03498a7e04eabe81ae39d0035fb9192551"],
  ["quick-problem-classifier", "e69cdf60ecc6e826e1b2a91bd325737e9e89abc9aeee1e9286ec6effb8989f7b"],
  ["quick-requirements-critic", "47a92e07e63e7e29267b5740f2048ea4104082cc01e8b8b9b0dba0cb84ec61a8"],
  ["quick-transcript-critic", "1fe14bf43f6b96aac392f1dbf60d3a41657b0889f08b056482eff5d55b296037"],
  ["reviews-code", "e0c61dedf8f20eb6eeeb18e5f545ed67b7e0ef09309c873dbdc1af132e0d3740"],
  ["reviews-linguistic-boundaries", "efd40a7e2b6ef618d84b934adc8f12809fbbc52d33a4ec035a1bf7dc3592a269"],
  ["reviews-pragmatic", "6649c4756db2c8c215ac0597153cf6567c889fc69e6a19ee69d86c76eb15a29e"],
  ["reviews-production-readiness", "03bd8cc813963348bf0b9d580206433569aa9fb96465a3b492e6c2a486e942fb"],
  ["reviews-reality-check", "1faaddf8d0b71c50f5eb4f21b4a6a977b94b944ba732731e0e59b3d89dba2254"],
  ["reviews-spec-audit", "e508aeb2b4c1ee36e3b30234fa3c7d06a5f495d9fa0e40a954a6bcf2d252c944"],
  ["reviews-test-strategy", "ad3d837b4b957b0c25de4e82ac27d41c2e9dc25e9b80dd372ed32d6896f1be56"],
  ["work", "d01ad99a2423daf498891f9534cbe6c6cdb348faf0ea70ddf51dd11b9675094e"],
].map(([id, sha256]) => Object.freeze({
  source: `commands/${id}.md`,
  destination: `prompts/${id}.md`,
  kind: "prompt",
  transform_id: "pi-prompt-v1",
  sha256,
})));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizedText(content) {
  return content.replaceAll("\r\n", "\n").replace(/\n*$/u, "\n");
}

function ensureOriginFields(origin, index) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    failAgentProjection("E_AGENT_PROJECTION_SCHEMA", `Pi command origin ${index} must be a mapping`);
  }
  const expectedFields = ["source", "destination", "kind", "transform_id", "sha256"];
  const actualFields = Object.keys(origin).sort();
  if (canonicalJson(actualFields) !== canonicalJson([...expectedFields].sort())) {
    failAgentProjection("E_AGENT_PROJECTION_SCHEMA", `Pi command origin ${index} has an invalid field set`, { index });
  }
  for (const field of ["source", "destination", "kind", "transform_id", "sha256"]) {
    if (typeof origin[field] !== "string" || origin[field].length === 0 || origin[field].includes("\0")) {
      failAgentProjection("E_AGENT_PROJECTION_SCHEMA", `Pi command origin ${index}.${field} is invalid`, { index, field });
    }
  }
  try {
    if (normalizeRelativePath(origin.source, `commands[${index}].source`) !== origin.source
      || normalizeRelativePath(origin.destination, `commands[${index}].destination`) !== origin.destination) {
      failAgentProjection("E_AGENT_PROJECTION_PATH", `Pi command origin ${index} is not normalized`, { index });
    }
  } catch (error) {
    failAgentProjection("E_AGENT_PROJECTION_PATH", `Pi command origin ${index} contains an unsafe path`, { index }, { cause: error });
  }
  if (!SHA256.test(origin.sha256)) {
    failAgentProjection("E_AGENT_PROJECTION_BINDING", `Pi command origin ${index} has an invalid digest`, { index });
  }
}

export function validatePiCommandOrigins(origins) {
  if (!Array.isArray(origins) || origins.length !== PI_COMMAND_ORIGINS.length) {
    failAgentProjection("E_AGENT_PROJECTION_INVENTORY", "Pi command origins must contain the closed command inventory", {
      expected: PI_COMMAND_ORIGINS.length,
      actual: origins?.length ?? null,
    });
  }
  const sources = new Set();
  const destinations = new Set();
  origins.forEach((origin, index) => {
    ensureOriginFields(origin, index);
    if (sources.has(origin.source.toLocaleLowerCase("en-US"))
      || destinations.has(origin.destination.toLocaleLowerCase("en-US"))) {
      failAgentProjection("E_AGENT_PROJECTION_COLLISION", `Pi command origins collide at index ${index}`, { index });
    }
    sources.add(origin.source.toLocaleLowerCase("en-US"));
    destinations.add(origin.destination.toLocaleLowerCase("en-US"));
    const expected = PI_COMMAND_ORIGINS[index];
    if (canonicalJson(origin) !== canonicalJson(expected)) {
      failAgentProjection("E_AGENT_PROJECTION_BINDING", `Pi command origin ${index} differs from the closed map`, {
        expected,
        actual: origin,
      });
    }
  });
  return origins;
}

export function projectPiCommands({ sourceRoot, origins = PI_COMMAND_ORIGINS } = {}) {
  if (typeof sourceRoot !== "string" || sourceRoot.length === 0) {
    failAgentProjection("E_AGENT_PROJECTION_IO", "sourceRoot is required for Pi command projection");
  }
  validatePiCommandOrigins(origins);
  const outputs = origins.map((origin) => {
    const sourcePath = path.join(sourceRoot, origin.source);
    let raw;
    try {
      raw = fs.readFileSync(sourcePath);
    } catch (error) {
      failAgentProjection("E_AGENT_PROJECTION_IO", `Pi command source is unreadable: ${origin.source}`, { source: origin.source }, { cause: error });
    }
    const sourceDigest = sha256(raw);
    if (sourceDigest !== origin.sha256) {
      failAgentProjection("E_AGENT_PROJECTION_BINDING", `Pi command source digest is stale: ${origin.source}`, {
        source: origin.source,
        expected: origin.sha256,
        actual: sourceDigest,
      });
    }
    const content = normalizedText(raw.toString("utf8"));
    const digest = sha256(Buffer.from(content, "utf8"));
    return Object.freeze({
      path: origin.destination,
      source: origin.source,
      kind: origin.kind,
      mode: "0644",
      ownership: "canonical",
      role_id: null,
      support_id: null,
      transform_id: origin.transform_id,
      source_sha256: sourceDigest,
      content,
      size: Buffer.byteLength(content, "utf8"),
      sha256: digest,
    });
  });
  return Object.freeze(outputs);
}

export function createPiCommandProjection({ sourceRoot, origins = PI_COMMAND_ORIGINS } = {}) {
  const outputs = projectPiCommands({ sourceRoot, origins });
  const rows = outputs.map(({ source, path: destination, kind, transform_id: transformId, source_sha256: sourceDigest }) => ({
    source,
    destination,
    kind,
    transform_id: transformId,
    sha256: sourceDigest,
  }));
  const projection = {
    schema_version: 1,
    contract: PI_COMMAND_PROJECTION_VERSION,
    entries: rows,
    digest: sha256(canonicalJson(rows)),
  };
  return Object.freeze(projection);
}
