import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE, ROOT, run } from '../helpers.mjs';

// Where the engine finds what a node names. A `skill:` or `agent:` target is
// looked for in the project, then the operator's own directories, then this
// plugin, then every other installed plugin — the first hit wins, and a
// namespaced target searches only the plugin it names. A `workflow:` target is
// looked for in the project's eject, generated and overlay homes before the
// built-in. Each test builds its own world — a project, a config dir and a home
// directory — in the OS temp dir and runs `validate` inside it, so the
// operator's own `~/.claude` and `~/.copilot` are never read.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const BUILTIN_WORKFLOWS = path.join(PLUGIN, 'skills/workflow-engine/workflows');

/**
 * A scratch world: `project/`, `config/` (what `CLAUDE_CONFIG_DIR` names) and
 * `home/` (what `os.homedir()` answers, and so where `~/.copilot` lives).
 * `env` points a verb at all three and drops any plugin-root override, so the
 * plugin tier is this checkout's own plugin. The root is its real path: a
 * working directory is reported resolved through any symlink in the temp dir.
 */
function world(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maister-resolution-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = { root, project: path.join(root, 'project'), config: path.join(root, 'config'), home: path.join(root, 'home') };
  for (const dir of [dirs.project, dirs.config, dirs.home]) fs.mkdirSync(dir);
  return {
    ...dirs,
    env: {
      CLAUDE_PROJECT_DIR: dirs.project,
      CLAUDE_CONFIG_DIR: dirs.config,
      HOME: dirs.home,
      USERPROFILE: dirs.home,
      CLAUDE_PLUGIN_ROOT: undefined,
      MAISTER_PLUGIN_ROOT: undefined,
    },
  };
}

/** Write each `{relative path: content}` into the world, creating folders. */
function put(w, files) {
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(w.root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/** Remove one file or folder a test put into the world. */
function drop(w, relative) {
  fs.rmSync(path.join(w.root, relative), { recursive: true, force: true });
}

/** An agent or skill file: only its existence is read, the frontmatter is for a reader. */
const executor = name => `---\nname: ${name}\ndescription: A ${name} for the resolution tests.\n---\n`;

/**
 * Validate a definition naming each target from a node of its own, inside the
 * world, and return where each node's target was found — `{node: {from, at}}`
 * — and the warnings. Every path found must lie inside the world or this
 * plugin: a hit anywhere else is a read of the operator's own machine.
 */
function where(w, targets, { with: passed = null, env = w.env, cwd = undefined } = {}) {
  const lines = ['name: lookup', 'version: 1', '', 'nodes:'];
  // Chained, one node needing the one before, so the definition ends on its
  // last node and carries no dangling leaf to warn about.
  let previous = null;
  for (const [node, target] of Object.entries(targets)) {
    lines.push(`  ${node}:`, `    uses: ${target}`, `    needs: [${previous ?? ''}]`);
    previous = node;
    if (passed) lines.push('    with:', ...Object.entries(passed).map(([key, value]) => `      ${key}: "${value}"`));
  }
  const file = path.join(w.root, 'definitions/lookup.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  const result = run(ENGINE, ['validate', `--definition=${file}`], undefined, env, cwd);
  const report = JSON.parse(result.stdout);
  assert.equal(result.code, 0, JSON.stringify(report.errors));
  assert.equal(report.ok, true);
  for (const entry of report.resolved) {
    assert.ok(entry.at.startsWith(`${w.root}${path.sep}`) || entry.at.startsWith(`${PLUGIN}${path.sep}`),
      `${entry.node} resolved outside the scratch world and this plugin: ${entry.at}`);
  }
  const found = Object.fromEntries(report.resolved.map(entry => [entry.node, { from: entry.from, at: entry.at }]));
  return { found, warnings: report.warnings };
}

/** An installed plugin's copy in the Claude Code cache, under `config/`. */
const CACHED = 'config/plugins/cache/acme-market/acme-tools/1.0.0';

// ---------------------------------------------------------------------------
// the four places
// ---------------------------------------------------------------------------

test('tiers: the project, the operator, this plugin and an installed plugin each answer for a name only they hold', t => {
  const w = world(t);
  put(w, {
    'project/.claude/agents/license-checker.md': executor('license-checker'),
    'project/.claude/skills/changelog-writer/SKILL.md': executor('changelog-writer'),
    'config/agents/team-linter.md': executor('team-linter'),
    'config/skills/team-notes/SKILL.md': executor('team-notes'),
    [`${CACHED}/agents/auditor.md`]: executor('auditor'),
    [`${CACHED}/skills/audit-trail/SKILL.md`]: executor('audit-trail'),
  });
  const { found, warnings } = where(w, {
    'project-agent': 'agent:license-checker',
    'project-skill': 'skill:changelog-writer',
    'user-agent': 'agent:team-linter',
    'user-skill': 'skill:team-notes',
    'plugin-agent': 'agent:code-reviewer',
    'plugin-skill': 'skill:codebase-analyzer',
    'installed-agent': 'agent:auditor',
    'installed-skill': 'skill:audit-trail',
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(found, {
    'project-agent': { from: 'project', at: path.join(w.project, '.claude/agents/license-checker.md') },
    'project-skill': { from: 'project', at: path.join(w.project, '.claude/skills/changelog-writer/SKILL.md') },
    'user-agent': { from: 'user', at: path.join(w.config, 'agents/team-linter.md') },
    'user-skill': { from: 'user', at: path.join(w.config, 'skills/team-notes/SKILL.md') },
    'plugin-agent': { from: 'plugin', at: path.join(PLUGIN, 'agents/code-reviewer.md') },
    'plugin-skill': { from: 'plugin', at: path.join(PLUGIN, 'skills/codebase-analyzer/SKILL.md') },
    'installed-agent': { from: 'installed', at: path.join(w.root, CACHED, 'agents/auditor.md') },
    'installed-skill': { from: 'installed', at: path.join(w.root, CACHED, 'skills/audit-trail/SKILL.md') },
  });
});

test('project: both hosts\' layouts count, .claude/ ahead of .github/, and <name>.md ahead of <name>.agent.md', t => {
  const w = world(t);
  put(w, {
    'project/.github/agents/sbom-builder.agent.md': executor('sbom-builder'),
    'project/.github/skills/notes-helper/SKILL.md': executor('notes-helper'),
    'project/.claude/agents/pair-reviewer.agent.md': executor('pair-reviewer'),
    'project/.claude/agents/doc-linter.md': executor('doc-linter'),
    'project/.github/agents/doc-linter.md': executor('doc-linter'),
    'project/.claude/agents/spell-checker.md': executor('spell-checker'),
    'project/.claude/agents/spell-checker.agent.md': executor('spell-checker'),
  });
  const { found, warnings } = where(w, {
    'copilot-agent': 'agent:sbom-builder',
    'copilot-skill': 'skill:notes-helper',
    'agent-md': 'agent:pair-reviewer',
    'both-homes': 'agent:doc-linter',
    'both-spellings': 'agent:spell-checker',
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(found, {
    'copilot-agent': { from: 'project', at: path.join(w.project, '.github/agents/sbom-builder.agent.md') },
    'copilot-skill': { from: 'project', at: path.join(w.project, '.github/skills/notes-helper/SKILL.md') },
    'agent-md': { from: 'project', at: path.join(w.project, '.claude/agents/pair-reviewer.agent.md') },
    'both-homes': { from: 'project', at: path.join(w.project, '.claude/agents/doc-linter.md') },
    'both-spellings': { from: 'project', at: path.join(w.project, '.claude/agents/spell-checker.md') },
  });
});

test('project: with no CLAUDE_PROJECT_DIR declared, the working directory is the project', t => {
  const w = world(t);
  put(w, { 'project/.claude/agents/license-checker.md': executor('license-checker') });
  const undeclared = { ...w.env, CLAUDE_PROJECT_DIR: undefined };
  const inside = where(w, { check: 'agent:license-checker' }, { env: undeclared, cwd: w.project });
  assert.deepEqual(inside.found.check, { from: 'project', at: path.join(w.project, '.claude/agents/license-checker.md') });
  const outside = where(w, { check: 'agent:license-checker' }, { env: undeclared, cwd: w.home });
  assert.deepEqual(outside.found, {});
  assert.deepEqual(outside.warnings, ['unresolved-reference:check:agent:license-checker']);
});

test('user: the Copilot home is the operator\'s too, searched after the Claude Code config dir', t => {
  const w = world(t);
  put(w, {
    'home/.copilot/agents/pair-reviewer.md': executor('pair-reviewer'),
    'home/.copilot/skills/standup-notes/SKILL.md': executor('standup-notes'),
    'config/agents/team-linter.md': executor('team-linter'),
    'home/.copilot/agents/team-linter.md': executor('team-linter'),
  });
  const { found, warnings } = where(w, {
    'copilot-agent': 'agent:pair-reviewer',
    'copilot-skill': 'skill:standup-notes',
    'both-homes': 'agent:team-linter',
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(found, {
    'copilot-agent': { from: 'user', at: path.join(w.home, '.copilot/agents/pair-reviewer.md') },
    'copilot-skill': { from: 'user', at: path.join(w.home, '.copilot/skills/standup-notes/SKILL.md') },
    'both-homes': { from: 'user', at: path.join(w.config, 'agents/team-linter.md') },
  });
});

test('installed: the install index, the cache and Copilot\'s install directory are all swept', t => {
  const w = world(t);
  const kit = path.join(w.root, 'installs/lint-kit');
  put(w, {
    'config/plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: { 'lint-kit@acme-market': [{ installPath: kit }] } }),
    'installs/lint-kit/agents/style-checker.md': executor('style-checker'),
    'home/.copilot/installed-plugins/acme-market/copilot-kit/agents/release-notes.md': executor('release-notes'),
    'home/.copilot/installed-plugins/_direct/some-source/plugin.json': JSON.stringify({ name: 'direct-kit' }),
    'home/.copilot/installed-plugins/_direct/some-source/agents/deployer.md': executor('deployer'),
  });
  const copilot = path.join(w.home, '.copilot/installed-plugins');
  const { found, warnings } = where(w, {
    'indexed': 'agent:style-checker',
    'indexed-by-name': 'agent:lint-kit:style-checker',
    'copilot-install': 'agent:release-notes',
    'copilot-by-name': 'agent:copilot-kit:release-notes',
    'direct-by-manifest': 'agent:direct-kit:deployer',
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(found, {
    'indexed': { from: 'installed', at: path.join(kit, 'agents/style-checker.md') },
    'indexed-by-name': { from: 'installed', at: path.join(kit, 'agents/style-checker.md') },
    'copilot-install': { from: 'installed', at: path.join(copilot, 'acme-market/copilot-kit/agents/release-notes.md') },
    'copilot-by-name': { from: 'installed', at: path.join(copilot, 'acme-market/copilot-kit/agents/release-notes.md') },
    'direct-by-manifest': { from: 'installed', at: path.join(copilot, '_direct/some-source/agents/deployer.md') },
  });
});

// ---------------------------------------------------------------------------
// shadowing
// ---------------------------------------------------------------------------

test('shadowing: one name in every place resolves to the first in order, and removing it hands the name down', t => {
  const w = world(t);
  put(w, {
    'project/.claude/agents/code-reviewer.md': executor('code-reviewer'),
    'config/agents/code-reviewer.md': executor('code-reviewer'),
    [`${CACHED}/agents/code-reviewer.md`]: executor('code-reviewer'),
  });
  const reviewer = () => where(w, { review: 'agent:code-reviewer' }).found.review;
  assert.deepEqual(reviewer(), { from: 'project', at: path.join(w.project, '.claude/agents/code-reviewer.md') });
  drop(w, 'project/.claude/agents/code-reviewer.md');
  assert.deepEqual(reviewer(), { from: 'user', at: path.join(w.config, 'agents/code-reviewer.md') });
  drop(w, 'config/agents/code-reviewer.md');
  assert.deepEqual(reviewer(), { from: 'plugin', at: path.join(PLUGIN, 'agents/code-reviewer.md') },
    'this plugin still comes before the installed copy');
});

test('shadowing: an installed plugin answers for a name only once nothing earlier holds it', t => {
  const w = world(t);
  put(w, {
    'config/skills/audit-trail/SKILL.md': executor('audit-trail'),
    [`${CACHED}/skills/audit-trail/SKILL.md`]: executor('audit-trail'),
  });
  assert.equal(where(w, { trail: 'skill:audit-trail' }).found.trail.from, 'user');
  drop(w, 'config/skills/audit-trail');
  assert.deepEqual(where(w, { trail: 'skill:audit-trail' }).found.trail,
    { from: 'installed', at: path.join(w.root, CACHED, 'skills/audit-trail/SKILL.md') });
});

test('shadowing: a project skill takes a name this plugin\'s own skill holds', t => {
  const w = world(t);
  put(w, { 'project/.claude/skills/codebase-analyzer/SKILL.md': executor('codebase-analyzer') });
  assert.deepEqual(where(w, { analyze: 'skill:codebase-analyzer' }).found.analyze,
    { from: 'project', at: path.join(w.project, '.claude/skills/codebase-analyzer/SKILL.md') });
});

// ---------------------------------------------------------------------------
// namespaced targets
// ---------------------------------------------------------------------------

test('namespacing: this plugin\'s own name reaches past every shadow; an installed plugin\'s name reaches its copy', t => {
  const w = world(t);
  put(w, {
    'project/.claude/agents/code-reviewer.md': executor('code-reviewer'),
    'config/agents/code-reviewer.md': executor('code-reviewer'),
    'project/.claude/skills/codebase-analyzer/SKILL.md': executor('codebase-analyzer'),
    'project/.claude/agents/auditor.md': executor('auditor'),
    [`${CACHED}/agents/auditor.md`]: executor('auditor'),
  });
  const { found, warnings } = where(w, {
    'own-agent': 'agent:maister:code-reviewer',
    'own-skill': 'skill:maister:codebase-analyzer',
    'bare-auditor': 'agent:auditor',
    'named-auditor': 'agent:acme-tools:auditor',
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(found, {
    'own-agent': { from: 'plugin', at: path.join(PLUGIN, 'agents/code-reviewer.md') },
    'own-skill': { from: 'plugin', at: path.join(PLUGIN, 'skills/codebase-analyzer/SKILL.md') },
    'bare-auditor': { from: 'project', at: path.join(w.project, '.claude/agents/auditor.md') },
    'named-auditor': { from: 'installed', at: path.join(w.root, CACHED, 'agents/auditor.md') },
  });
});

test('namespacing: a namespace is never looked up in the project, and one no plugin carries resolves nowhere', t => {
  const w = world(t);
  put(w, {
    'project/.claude/agents/license-checker.md': executor('license-checker'),
    [`${CACHED}/agents/auditor.md`]: executor('auditor'),
  });
  const { found, warnings } = where(w, {
    'installed-name': 'agent:acme-tools:license-checker',
    'unknown-plugin': 'agent:nope:auditor',
    'project-word': 'agent:project:license-checker',
  });
  assert.deepEqual(found, {});
  assert.deepEqual(warnings, [
    'unresolved-reference:installed-name:agent:acme-tools:license-checker',
    'unresolved-reference:unknown-plugin:agent:nope:auditor',
    'unresolved-reference:project-word:agent:project:license-checker',
  ]);
});

// ---------------------------------------------------------------------------
// schemes and misses
// ---------------------------------------------------------------------------

test('schemes: an agent is not found as a skill, nor a skill as an agent, and a miss is a warning, never an error', t => {
  const w = world(t);
  put(w, {
    'project/.claude/agents/license-checker.md': executor('license-checker'),
    'project/.claude/skills/changelog-writer/SKILL.md': executor('changelog-writer'),
  });
  const { found, warnings } = where(w, {
    'agent-as-skill': 'skill:license-checker',
    'skill-as-agent': 'agent:changelog-writer',
    'typo': 'agent:licence-checker',
  });
  assert.deepEqual(found, {});
  assert.deepEqual(warnings, [
    'unresolved-reference:agent-as-skill:skill:license-checker',
    'unresolved-reference:skill-as-agent:agent:changelog-writer',
    'unresolved-reference:typo:agent:licence-checker',
  ]);
});

// ---------------------------------------------------------------------------
// workflow targets
// ---------------------------------------------------------------------------

test('workflows: an eject beats a generated chain, which beats an overlay, which beats the built-in', t => {
  const w = world(t);
  const home = 'project/.maister/workflows';
  const builtin = fs.readFileSync(path.join(BUILTIN_WORKFLOWS, 'research.yml'), 'utf8');
  put(w, {
    [`${home}/research.yml`]: builtin,
    [`${home}/generated/research.yml`]: builtin,
    [`${home}/research.overlay.yml`]: 'extends: builtin:research\n',
  });
  const child = () => where(w, { probe: 'workflow:research' }, { with: { question: 'What is left open?' } });

  let lookup = child();
  assert.deepEqual(lookup.found.probe, { from: 'eject', at: path.join(w.root, home, 'research.yml') });
  assert.ok(lookup.warnings.includes('overlay-ignored:research:eject'), lookup.warnings.join('\n'));
  drop(w, `${home}/research.yml`);
  lookup = child();
  assert.deepEqual(lookup.found.probe, { from: 'generated', at: path.join(w.root, home, 'generated/research.yml') });
  assert.ok(lookup.warnings.includes('overlay-ignored:research:generated'), lookup.warnings.join('\n'));
  drop(w, `${home}/generated`);
  assert.deepEqual(child().found.probe, { from: 'overlay', at: path.join(w.root, home, 'research.overlay.yml') });
  drop(w, `${home}/research.overlay.yml`);
  assert.deepEqual(child().found.probe, { from: 'builtin', at: path.join(BUILTIN_WORKFLOWS, 'research.yml') });
});

test('workflows: builtin: and the bare name are one name, and a custom one lives in the project\'s homes', t => {
  const w = world(t);
  const home = 'project/.maister/workflows';
  const custom = ['name: audit-child', 'version: 1', 'nodes:', '  inspect:', '    uses: agent:code-reviewer', '    needs: []', ''].join('\n');
  put(w, { [`${home}/generated/audit-child.yml`]: custom });
  const passed = { with: { question: 'What is left open?' } };

  const builtin = { from: 'builtin', at: path.join(BUILTIN_WORKFLOWS, 'research.yml') };
  assert.deepEqual(where(w, { bare: 'workflow:research', prefixed: 'workflow:builtin:research' }, passed).found,
    { bare: builtin, prefixed: builtin });
  assert.deepEqual(where(w, { child: 'workflow:audit-child' }).found.child,
    { from: 'generated', at: path.join(w.root, home, 'generated/audit-child.yml') });

  // An eject of the built-in's name answers for both spellings: the prefix
  // says where a name is expected to resolve, not which file it must be.
  put(w, { [`${home}/research.yml`]: fs.readFileSync(path.join(BUILTIN_WORKFLOWS, 'research.yml'), 'utf8') });
  const eject = { from: 'eject', at: path.join(w.root, home, 'research.yml') };
  assert.deepEqual(where(w, { bare: 'workflow:research', prefixed: 'workflow:builtin:research' }, passed).found,
    { bare: eject, prefixed: eject });
});

// The overlay home counts only when the built-in it overlays exists: an overlay
// for a name no built-in carries has no definition behind it, so a run of it
// would have nothing to start from.
test('workflows: an overlay for a name no built-in carries is not a workflow', t => {
  const w = world(t);
  put(w, { 'project/.maister/workflows/acme.overlay.yml': 'extends: acme\n' });
  const { found, warnings } = where(w, { child: 'workflow:acme' });
  assert.deepEqual(found, {});
  assert.deepEqual(warnings, ['unresolved-reference:child:workflow:acme']);
});

// ---------------------------------------------------------------------------
// isolation
// ---------------------------------------------------------------------------

test('isolation: every child the test helpers spawn sees an empty scratch config dir, never the real ~/.claude', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'env.mjs');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify({ config: process.env.CLAUDE_CONFIG_DIR ?? null, project: process.env.CLAUDE_PROJECT_DIR ?? null }));\n');
  const seen = JSON.parse(run(script, []).stdout);
  assert.ok(seen.config, 'a config dir is always declared');
  assert.notEqual(path.resolve(seen.config), path.join(os.homedir(), '.claude'));
  assert.ok(path.resolve(seen.config).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), seen.config);
  assert.deepEqual(fs.readdirSync(seen.config), [], 'and it holds nothing a lookup could find');
  assert.equal(seen.project, null, 'no project is inherited from the session running the suite');
});

test('isolation: with every scratch place empty, only this plugin answers', t => {
  const w = world(t);
  const { found, warnings } = where(w, { review: 'agent:code-reviewer', lint: 'agent:team-linter' });
  assert.deepEqual(found, { review: { from: 'plugin', at: path.join(PLUGIN, 'agents/code-reviewer.md') } });
  assert.deepEqual(warnings, ['unresolved-reference:lint:agent:team-linter']);
});
