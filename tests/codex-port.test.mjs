import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.join(root, 'plugins/maister-codex');
const server = path.join(plugin, 'skills/maister-mockup-studio/server/index.mjs');
const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks/hooks.json'), 'utf8'));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-codex-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const task = path.join(dir, 'task');
  const output = path.join(task, 'analysis/mockups');
  fs.mkdirSync(output, { recursive: true });
  return { dir, task, output };
}

async function startServer(t, task) {
  const child = spawn(process.execPath, [server, `--task-path=${task}`]);
  let log = '';
  child.stderr.on('data', data => { log += data; });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
  t.after(stop);
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${log}`)), 10000);
    child.on('error', reject);
    child.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${log}`));
    });
    child.stdout.on('data', data => {
      log += data;
      const match = log.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const status = await (await fetch(`${url}/status`)).json();
  return {
    url,
    stop,
    async update(title, extra = {}) {
      return fetch(`${url}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Maister-Token': status.mutationToken },
        body: JSON.stringify({ title, html: '<main>Screen content</main>', ...extra }),
      });
    },
  };
}

test('destructive guard handles documented payloads without identity exemptions', () => {
  const command = hooks.hooks.PreToolUse[0].hooks[0].command;
  for (const identity of [{}, { agent_type: 'maister-task-group-implementer' }, { agent_type: 'maister-test-suite-runner' }]) {
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git reset --hard' }, ...identity });
    for (const [binary, args] of [[process.execPath, [path.join(plugin, 'hooks/block-destructive-commands.mjs')]], ['/bin/sh', ['-c', command]]]) {
      const result = spawnSync(binary, args, { input, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout || '{}').hookSpecificOutput?.permissionDecision, 'deny');
    }
  }
  const safe = spawnSync('/bin/sh', ['-c', command], {
    input: JSON.stringify({ tool_input: { command: 'git status --short' } }), encoding: 'utf8',
  });
  assert.equal(safe.status, 0);
  assert.equal(safe.stdout, '');
});

test('packaged lifecycle commands emit the same context as their sources', t => {
  const { task } = fixture(t);
  fs.mkdirSync(path.join(task, '.maister/tasks'), { recursive: true });
  for (const [group, file] of [
    [hooks.hooks.SessionStart[0], 'post-compact-reminder.mjs'],
    [hooks.hooks.SessionStart[1], 'workflow-reminder.mjs'],
    [hooks.hooks.SubagentStart[0], 'subagent-safety-reminder.mjs'],
  ]) {
    const options = { input: JSON.stringify({ cwd: task }), encoding: 'utf8' };
    const source = spawnSync(process.execPath, [path.join(plugin, 'hooks', file)], options);
    const packaged = spawnSync('/bin/sh', ['-c', group.hooks[0].command], options);
    assert.equal(source.status, 0, source.stderr);
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.deepEqual(JSON.parse(packaged.stdout), JSON.parse(source.stdout));
  }
});

test('mockup updates preserve output boundaries and offline screens', async t => {
  const { dir, task, output } = fixture(t);
  const client = await startServer(t, task);
  await t.test('Index has its own file and gallery link', async () => {
    const response = await client.update('Index');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.saved, true);
    assert.equal(result.id, 'index');
    assert.match(fs.readFileSync(path.join(output, 'index.screen.html'), 'utf8'), /Screen content/);
    assert.match(fs.readFileSync(path.join(output, 'index.html'), 'utf8'), /href="index\.screen\.html"/);
  });
  await t.test('rejects symlinked output files including dangling links', async () => {
    for (const name of ['settings.html', 'index.html', '.mockups.json']) {
      const outside = path.join(dir, `outside-${name}`);
      fs.writeFileSync(outside, 'sentinel');
      const destination = path.join(output, name);
      const previous = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
      if (previous) fs.unlinkSync(destination);
      fs.symlinkSync(outside, destination);
      assert.equal((await client.update('Settings')).status, 500, name);
      assert.equal(fs.readFileSync(outside, 'utf8'), 'sentinel', name);
      fs.unlinkSync(destination);
      if (previous) fs.writeFileSync(destination, previous);
    }
    const missing = path.join(dir, 'missing.html');
    fs.symlinkSync(missing, path.join(output, 'dangling.html'));
    assert.equal((await client.update('Dangling')).status, 500);
    assert.equal(fs.existsSync(missing), false);
    fs.unlinkSync(path.join(output, 'dangling.html'));
  });
  await t.test('rejects unauthenticated updates', async () => {
    assert.equal((await fetch(`${client.url}/update`, { method: 'POST', body: '{}' })).status, 403);
  });
  await t.test('rejects payloads that would make the persisted manifest unreadable', async () => {
    const before = fs.readFileSync(path.join(output, '.mockups.json'), 'utf8');
    assert.equal((await client.update('Invalid', { annotations: {} })).status, 400);
    assert.equal(fs.readFileSync(path.join(output, '.mockups.json'), 'utf8'), before);
  });
  await t.test('successful screens survive restart', async () => {
    assert.equal((await client.update('Settings')).status, 200);
    await client.stop();
    const restored = await startServer(t, task);
    assert.equal((await fetch(`${restored.url}/screen/settings`)).status, 200);
    assert.equal((await fetch(`${restored.url}/screen/index`)).status, 200);
  });
});

test('invalid restored IDs and symlinked metadata fail before startup', async t => {
  for (const mode of ['traversal', 'manifest-link', 'pid-link']) {
    await t.test(mode, t => {
      const { dir, task, output } = fixture(t);
      const outside = path.join(dir, 'outside');
      fs.writeFileSync(outside, 'sentinel');
      if (mode === 'traversal') {
        fs.writeFileSync(path.join(output, '.mockups.json'), JSON.stringify({ mockups: [{ id: '../../../escaped', title: 'Escape' }] }));
      } else {
        fs.symlinkSync(outside, path.join(output, mode === 'manifest-link' ? '.mockups.json' : '.visual-companion.pid'));
      }
      const result = spawnSync(process.execPath, [server, `--task-path=${task}`], { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.error, undefined, 'must fail promptly, not hang with a running server');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Invalid mockup|Output must be a regular file/);
      assert.equal(fs.readFileSync(outside, 'utf8'), 'sentinel');
      assert.equal(fs.existsSync(path.join(dir, 'escaped.html')), false);
    });
  }
});

test('name validation fails even when a later entry is valid', t => {
  const { dir } = fixture(t);
  fs.copyFileSync(path.join(root, 'Makefile'), path.join(dir, 'Makefile'));
  fs.cpSync(plugin, path.join(dir, 'plugins/maister-codex'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents/plugins'), { recursive: true });
  fs.copyFileSync(path.join(root, '.agents/plugins/marketplace.json'), path.join(dir, '.agents/plugins/marketplace.json'));
  const skill = path.join(dir, 'plugins/maister-codex/skills/maister-codebase-analysis/SKILL.md');
  const original = fs.readFileSync(skill, 'utf8');
  fs.writeFileSync(skill, original.replace('name: maister-codebase-analysis', 'name: invalid'));
  const result = spawnSync('make', ['validate-codex'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /frontmatter name !=/);
  fs.writeFileSync(skill, original);
  const agent = path.join(dir, 'plugins/maister-codex/skills/maister-init/assets/agents/maister-ascii-mockup-generator.toml');
  fs.writeFileSync(agent, fs.readFileSync(agent, 'utf8').replace('name = "maister-ascii-mockup-generator"', 'name = "invalid"'));
  const agentResult = spawnSync('make', ['validate-codex'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(agentResult.status, 0);
  assert.match(agentResult.stdout, /name !=/);
});
