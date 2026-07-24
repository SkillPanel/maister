import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runLauncher } from "../../lib/launcher/orchestrator.mjs";
import { directReleaseAssetUrl, REQUIRED_ASSETS } from "../../lib/launcher/release-contract.mjs";

const PACKAGE_METADATA = Object.freeze({
  name: "@mateuszrapacz/maister",
  version: "2.2.1",
  root: path.resolve("."),
});

function installOptions() {
  return { command: "install", target: "codex", json: false, requestedVersion: "2.2.1" };
}

function tempFactory() {
  return {
    create() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "maister-github-only-red-"));
      return {
        root,
        cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
      };
    },
  };
}

function releaseMetadata() {
  return {
    tag_name: "v2.2.1",
    draft: false,
    prerelease: false,
    published_at: "2026-07-19T00:00:00Z",
    assets: REQUIRED_ASSETS.map((name, index) => ({
      id: index + 1,
      name,
      state: "uploaded",
      size: 1,
      digest: null,
      url: `https://api.github.com/repos/mateuszrapacz/maister/releases/assets/${index + 1}`,
      browser_download_url: `https://github.com/mateuszrapacz/maister/releases/download/v2.2.1/${name}`,
    })),
  };
}

async function withGitHubEnvironment(values, callback) {
  const names = ["GH_TOKEN", "GITHUB_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try {
    await callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("package and release workflow make publishing Maister to a registry impossible", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

  assert.equal(packageJson.private, true);
  assert.equal(Object.hasOwn(packageJson, "publishConfig"), false);
  for (const forbidden of [
    /registry-url:/u,
    /NPM_TOKEN/u,
    /NODE_AUTH_TOKEN/u,
    /\bnpm\s+publish\b/u,
    /\bnpm\s+dist-tag\b/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("GH_TOKEN takes precedence over GITHUB_TOKEN for GitHub API requests", async () => {
  await withGitHubEnvironment({ GH_TOKEN: "gh-token", GITHUB_TOKEN: "github-token" }, async () => {
    const requests = [];
    const expected = Object.assign(new Error("stop after metadata request"), { kind: "E_TEST_STOP" });
    await assert.rejects(runLauncher(installOptions(), PACKAGE_METADATA, {
      tempFactory: tempFactory(),
      archivePort: {},
      transport: {
        async request(descriptor) {
          requests.push(descriptor);
          if (requests.length === 1) return { status: 404 };
          throw expected;
        },
      },
    }), expected);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://api.github.com/repos/mateuszrapacz/maister/releases/tags/v2.2.1");
    assert.equal(requests[0].headers.authorization, undefined);
    assert.equal(requests[1].headers.authorization, "Bearer gh-token");
  });
});

test("anonymous transient GitHub metadata errors fall back before downloading direct assets", async () => {
  for (const status of [429, 503]) {
    await withGitHubEnvironment({ GH_TOKEN: undefined, GITHUB_TOKEN: undefined }, async () => {
      const requests = [];
      const expected = Object.assign(new Error("stop after first direct asset request"), { kind: "E_TEST_STOP" });
      const transient = Object.assign(new Error("GitHub API transient failure"), {
        kind: "E_LAUNCHER_TRANSPORT_HTTP",
        details: { status },
      });

      await assert.rejects(runLauncher(installOptions(), PACKAGE_METADATA, {
        tempFactory: tempFactory(),
        archivePort: {},
        resolveCredential: async () => ({ kind: "anonymous", source: "none" }),
        transport: {
          async request(descriptor) {
            requests.push(descriptor);
            if (requests.length === 1) throw transient;
            throw expected;
          },
        },
      }), expected);

      assert.equal(requests.length, 2);
      assert.equal(requests[0].url, "https://api.github.com/repos/mateuszrapacz/maister/releases/tags/v2.2.1");
      assert.equal(requests[1].url, directReleaseAssetUrl("2.2.1", "SHA256SUMS"));
      assert.equal(requests[1].headers.authorization, undefined);
      assert.equal(requests[1].headers.accept, "application/octet-stream");
    });
  }
});

test("authenticated release assets use GitHub API URLs and octet-stream negotiation", async () => {
  await withGitHubEnvironment({ GH_TOKEN: "private-token", GITHUB_TOKEN: undefined }, async () => {
    const requests = [];
    const expected = Object.assign(new Error("stop after first asset request"), { kind: "E_TEST_STOP" });
    await assert.rejects(runLauncher(installOptions(), PACKAGE_METADATA, {
      tempFactory: tempFactory(),
      archivePort: {},
      transport: {
        async request(descriptor) {
          requests.push(descriptor);
          if (requests.length === 1) {
            return { status: 404 };
          }
          if (requests.length === 2) {
            return {
              bytes: Buffer.from(JSON.stringify(releaseMetadata())),
              headers: new Headers({ "content-type": "application/json" }),
              status: 200,
            };
          }
          if (requests.length === 3) {
            return {
              bytes: Buffer.from(JSON.stringify({
                ref: "refs/tags/v2.2.1",
                object: { type: "commit", sha: "a".repeat(40) },
              })),
              headers: new Headers({ "content-type": "application/json" }),
              status: 200,
            };
          }
          throw expected;
        },
      },
    }), expected);

    assert.equal(requests.length, 4);
    assert.equal(requests[2].url, "https://api.github.com/repos/mateuszrapacz/maister/git/ref/tags/v2.2.1");
    assert.equal(requests[2].headers.authorization, "Bearer private-token");
    assert.match(requests[3].url, /^https:\/\/api\.github\.com\/repos\/mateuszrapacz\/maister\/releases\/assets\/\d+$/u);
    assert.equal(requests[3].headers.authorization, "Bearer private-token");
    assert.equal(requests[3].headers.accept, "application/octet-stream");
  });
});
