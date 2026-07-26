import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const releaseWorkflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const validationWorkflow = fs.readFileSync(".github/workflows/validate-generated-variants.yml", "utf8");
const smoke = fs.readFileSync("tests/release/public-git-package-smoke.mjs", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("release automation can publish only immutable GitHub Release assets", () => {
  assert.equal(packageJson.private, true);
  assert.match(releaseWorkflow, /softprops\/action-gh-release@/u);
  assert.match(releaseWorkflow, /GITHUB_VERIFIED/u);
  assert.match(releaseWorkflow, /HERMETIC_PRIVATE_TRANSPORT_VERIFIED/u);
  for (const forbidden of [
    /registry-url:/iu,
    /NPM_TOKEN/u,
    /NODE_AUTH_TOKEN/u,
    /\bnpm\s+(?:publish|view|dist-tag|deprecate)\b/iu,
    /id-token:\s*write/iu,
  ]) assert.doesNotMatch(releaseWorkflow, forbidden);
});

test("protected workflow proves tag, commit, package manifest, and artifact identity", () => {
  for (const required of [
    "refs/tags/${GITHUB_REF_NAME}^{commit}",
    ".maister-resolved-commit.json",
    "selector-identity.json",
    "PROVENANCE.json",
    "SBOM.cdx.json",
    "SHA256SUMS",
  ]) assert.match(releaseWorkflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("current all-target admission runs before the prepare-owned manifest can dirty the checkout", () => {
  const dependencyInstall = releaseWorkflow.indexOf("npm ci --ignore-scripts");
  const cleanAssertion = releaseWorkflow.indexOf("git status --porcelain");
  const admission = releaseWorkflow.indexOf("make test-current-target-admission");
  const prepare = releaseWorkflow.indexOf("npm run prepare");

  assert.ok(dependencyInstall >= 0, "release dependencies must be installed without prepare side effects");
  assert.ok(cleanAssertion > dependencyInstall && admission > cleanAssertion, "current target admission must receive a proven-clean checkout");
  assert.ok(prepare > admission, "the resolved-commit manifest must be generated only at the package boundary");
  assert.doesNotMatch(releaseWorkflow, /MAISTER_ALLOW_DIRTY_LOCAL/u);
  assert.doesNotMatch(releaseWorkflow.slice(0, admission), /\.maister-resolved-commit\.json/u);
});

test("protected release jobs pin one npm version and post-Release smoke Linux and macOS", () => {
  assert.match(releaseWorkflow, /RELEASE_NPM_VERSION:\s*["']11\.4\.2["']/u);
  assert.match(releaseWorkflow, /npm install --global "npm@\$\{\{ env\.RELEASE_NPM_VERSION \}\}"/u);
  assert.match(releaseWorkflow, /npm --version/u);
  assert.match(releaseWorkflow, /public-smoke:[\s\S]*needs:\s*github-release/u);
  assert.match(releaseWorkflow, /public-smoke:[\s\S]*os:\s*\[ubuntu-latest, macos-latest\]/u);
  assert.doesNotMatch(releaseWorkflow, /windows-latest|win32|runner\.os.*Windows/iu);
  assert.match(releaseWorkflow, /public-smoke:[\s\S]*public-git-package-smoke\.mjs/u);
  const publicSmokeJob = releaseWorkflow.slice(releaseWorkflow.indexOf("  public-smoke:"));
  assert.match(publicSmokeJob, /run: node tests\/release\/public-git-package-smoke\.mjs --evidence \.maister-public-smoke-evidence\.ndjson/u);
  assert.doesNotMatch(publicSmokeJob, /--(?:tag|commit)\s+["']?\$GITHUB_/u);

  const byteVerification = releaseWorkflow.indexOf("Verify exact public GitHub bytes");
  const publicSmoke = releaseWorkflow.indexOf("public-smoke:");
  assert.ok(byteVerification >= 0 && publicSmoke > byteVerification, "public smoke must be downstream of verified Release bytes");
});

test("public smoke disables checkout credentials and rejects Git auth residue before acquisition", () => {
  const publicSmokeStart = releaseWorkflow.indexOf("  public-smoke:");
  const finalizeStart = releaseWorkflow.indexOf("  finalize-release-evidence:");
  assert.ok(publicSmokeStart >= 0 && finalizeStart > publicSmokeStart, "public-smoke job must be isolated for policy checks");

  const publicSmokeJob = releaseWorkflow.slice(publicSmokeStart, finalizeStart);
  assert.match(
    publicSmokeJob,
    /actions\/checkout@[\s\S]*?with:\s*[\s\S]*?persist-credentials:\s*false/u,
    "public smoke checkout must not persist the Actions token",
  );

  const authGuard = publicSmokeJob.indexOf("node tests/release/assert-no-git-auth-residue.mjs");
  const setupNode = publicSmokeJob.indexOf("actions/setup-node@");
  const npmPin = publicSmokeJob.indexOf('npm install --global "npm@');
  const acquisition = publicSmokeJob.indexOf("node tests/release/public-git-package-smoke.mjs");
  assert.ok(authGuard >= 0, "public smoke must fail closed on checkout-local Git authentication residue");
  assert.ok(setupNode < authGuard && authGuard < npmPin, "the Git authentication guard must run after setup-node and before any npm network operation");
  assert.ok(authGuard < acquisition, "the Git authentication guard must run before public Git package acquisition");
});

test("release-critical harness changes cannot bypass CI validation", () => {
  const validateJobStart = releaseWorkflow.indexOf("  validate:");
  const releaseJobStart = releaseWorkflow.indexOf("  github-release:");
  const validateJob = releaseWorkflow.slice(validateJobStart, releaseJobStart);
  assert.match(validateJob, /node --test tests\/platform-independent\/release-github-only-policy\.test\.mjs/u);
  assert.match(validateJob, /node --test tests\/platform-independent\/git-auth-residue-guard\.test\.mjs/u);
  assert.match(validationWorkflow, /push:[\s\S]*tests\/release\/\*\*[\s\S]*pull_request:[\s\S]*tests\/release\/\*\*/u);
});

test("protected release evidence follows the complete lifecycle after all public smoke targets", () => {
  const githubReleaseStart = releaseWorkflow.indexOf("  github-release:");
  const publicSmokeStart = releaseWorkflow.indexOf("  public-smoke:");
  const finalizeStart = releaseWorkflow.indexOf("  finalize-release-evidence:");

  assert.ok(githubReleaseStart >= 0 && publicSmokeStart > githubReleaseStart, "GitHub publication must precede public smoke");
  assert.ok(finalizeStart > publicSmokeStart, "a final evidence job must follow the public smoke matrix");

  const githubReleaseJob = releaseWorkflow.slice(githubReleaseStart, publicSmokeStart);
  const finalizeJob = releaseWorkflow.slice(finalizeStart);
  assert.match(githubReleaseJob, /GITHUB_VERIFIED/u);
  assert.doesNotMatch(githubReleaseJob, /PUBLIC_NO_AUTH_SMOKE_VERIFIED|HERMETIC_PRIVATE_TRANSPORT_VERIFIED/u);
  assert.match(finalizeJob, /needs:\s*\[github-release, public-smoke\]/u);
  assert.match(finalizeJob, /pattern:\s*maister-public-smoke-\*-/u);
  assert.match(
    releaseWorkflow.slice(publicSmokeStart, finalizeStart),
    /name:\s*maister-public-smoke-[\s\S]*include-hidden-files:\s*true/u,
    "public smoke artifacts must retain their dotfile evidence",
  );
  assert.match(
    finalizeJob,
    /name:\s*maister-github-release-evidence-[\s\S]*include-hidden-files:\s*true/u,
    "canonical evidence must retain nested network-observation dotfiles",
  );

  const publicVerified = finalizeJob.indexOf('state.state="PUBLIC_NO_AUTH_SMOKE_VERIFIED"');
  const hermeticTests = finalizeJob.indexOf("Verify hermetic private transport");
  const hermeticVerified = finalizeJob.indexOf('state.state="HERMETIC_PRIVATE_TRANSPORT_VERIFIED"');
  const finalUpload = finalizeJob.indexOf("Upload complete GitHub-only release evidence");
  assert.ok(publicVerified >= 0, "the lifecycle must record successful public no-auth smoke");
  assert.ok(
    publicVerified < hermeticTests && hermeticTests < hermeticVerified && hermeticVerified < finalUpload,
    "canonical evidence must record public smoke, then hermetic transport, before final upload",
  );
});

test("public smoke uses only exact canonical Git selectors and clears authorization sources", () => {
  assert.match(smoke, /const REPOSITORY = "mateuszrapacz\/maister"/u);
  assert.match(smoke, /github:\$\{REPOSITORY\}#/u);
  assert.match(smoke, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(smoke, /npm.+install/su);
  assert.match(smoke, /npm.+exec/su);
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "NODE_AUTH_TOKEN", "NPM_TOKEN"]) assert.match(smoke, new RegExp(name, "u"));
  for (const name of ["GIT_SSH_COMMAND", "GIT_SSH", "GIT_PROXY_COMMAND", "SSH_AUTH_SOCK", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
    assert.match(smoke, new RegExp(name, "u"));
  }
  assert.doesNotMatch(smoke, /https:\/\/[^\s'"`]*@github\.com/iu);
});

test("public smoke revalidates every redirect and never logs raw child diagnostics", () => {
  assert.match(smoke, /redirect:\s*["']manual["']/u);
  assert.match(smoke, /response\.headers\.get\(["']location["']\)/u);
  assert.doesNotMatch(smoke, /stdout:\s*\$\{result\.stdout\}/u);
  assert.doesNotMatch(smoke, /stderr:\s*\$\{result\.stderr\}/u);
});

test("public smoke records redacted release identity and terminal lifecycle evidence for every selector, path, and target", () => {
  for (const field of [
    "package_spec",
    "selector_commit",
    "package_manifest_commit",
    "package_version",
    "release_tag",
    "release_target_commit",
    "asset_identity",
    "asset_digest",
    "sidecar_source",
    "archive_identity",
    "e3_digest",
    "target",
    "terminal_lifecycle",
  ]) assert.match(smoke, new RegExp(field, "u"));
  assert.match(smoke, /\["npm-install",\s*"npm-exec"\]/u);
  assert.match(smoke, /\["codex",\s*"cursor",\s*"kiro-cli"\]/u);
  assert.match(smoke, /authorization:\s*false/u);
  assert.doesNotMatch(smoke, /token\s*:/iu);
});

test("ordinary validation enforces policy and requirement drift", () => {
  assert.match(validationWorkflow, /release-github-only-policy\.test\.mjs/u);
  assert.match(validationWorkflow, /git-auth-residue-guard\.test\.mjs/u);
  assert.match(validationWorkflow, /requirement-artifact-drift\.test\.mjs/u);
});
