/**
 * The engine and the hooks, run the way a host runs them, through one shell.
 *
 *   node tests/shell-smoke.mjs --shell=<bash|zsh|pwsh|powershell|cmd>
 *
 * The verb suite spawns `node` with an argv array, so no shell ever parses a
 * call; this script does the opposite. Every engine call is one command line in
 * the invocation contract's form — `node '<plugin root>/…/workflow.mjs' <verb>
 * --flag='<path>'` — handed to the chosen shell to parse, from a plugin copy and
 * a project whose paths both hold a space. On Windows those paths are written
 * with `\`, as `CLAUDE_PLUGIN_ROOT` is. cmd.exe takes no single quotes, so its
 * lines quote with `"`.
 *
 * The run: `locate`, `validate`, `resolve`, the freeze, two node writes with a
 * patch no shell may touch, `gate-brief --json` at the gate, the dashboard
 * projection and `resume-check`. Then the hooks, each started as `hooks.json`
 * starts it: the edition check under `node`, the two session-start reminders
 * and the destructive-command guard under `bash` (Git Bash on Windows).
 *
 * Prints one `ok`/`FAIL` line per check and exits 1 when any check failed.
 * Node >= 20, no dependencies; everything is written under the OS temp
 * directory and removed at the end.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse } from '../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PLUGIN = path.join(ROOT, 'plugins', 'maister');
const SAMPLE = path.join(ROOT, 'tests', 'fixtures', 'definitions', 'sample');
const WINDOWS = process.platform === 'win32';

const SHELLS = {
  bash: line => ['bash', ['-c', line], {}],
  zsh: line => ['zsh', ['-c', line], {}],
  pwsh: line => ['pwsh', ['-NoProfile', '-NonInteractive', '-Command', line], {}],
  powershell: line => ['powershell', ['-NoProfile', '-NonInteractive', '-Command', line], {}],
  // `/s` strips the one pair of quotes around the whole line and keeps the rest
  // verbatim, which is how a host hands cmd.exe a command it did not write.
  cmd: line => ['cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true }],
};

const shellName = (process.argv.slice(2).find(arg => arg.startsWith('--shell=')) ?? '').slice('--shell='.length);
if (!Object.hasOwn(SHELLS, shellName)) {
  process.stderr.write(`usage: node tests/shell-smoke.mjs --shell=<${Object.keys(SHELLS).join('|')}>\n`);
  process.exit(2);
}
const quote = value => (shellName === 'cmd' ? `"${value}"` : `'${value}'`);

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) process.stdout.write(`ok    ${name}\n`);
  else {
    failed += 1;
    process.stdout.write(`FAIL  ${name}${detail ? `\n      ${String(detail).trim().split('\n').join('\n      ')}` : ''}\n`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// the scratch: a plugin copy and a project, both under a path with a space
// ---------------------------------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-smoke-'));
const pluginRoot = path.join(scratch, 'plugin root', 'maister');
const project = path.join(scratch, 'project dir');
const runRelative = '.maister/tasks/development/2026-01-05-shell-smoke';
const runDir = path.join(project, ...runRelative.split('/'));
const statePath = path.join(runDir, 'orchestrator-state.yml');
const patchPath = path.join(runDir, '.state-patch.json');
const configDir = path.join(scratch, 'claude config');
const gitConfig = path.join(scratch, 'gitconfig');

fs.cpSync(SOURCE_PLUGIN, pluginRoot, { recursive: true });
const workflows = path.join(project, '.maister', 'workflows');
fs.mkdirSync(workflows, { recursive: true });
fs.copyFileSync(`${SAMPLE}.yml`, path.join(workflows, 'development.yml'));
fs.copyFileSync(`${SAMPLE}.md`, path.join(workflows, 'development.md'));
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(configDir);
fs.writeFileSync(gitConfig, '');

// The same isolation the verb suite gives its children: no operator config, no
// operator git identity, a fixed login name.
const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', USER: 'tester', USERNAME: 'tester' };
delete env.CLAUDE_PROJECT_DIR;

const engine = path.join(pluginRoot, 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');

/** One engine call, as one command line through the shell, from the project root. */
function call(verb, flags) {
  const line = [`node ${quote(engine)} ${verb}`, ...flags].join(' ');
  const [command, args, options] = SHELLS[shellName](line);
  const result = spawnSync(command, args, { ...options, cwd: project, env, encoding: 'utf8' });
  if (result.error) return { code: null, stdout: '', stderr: `${command} did not start: ${result.error.message}`, line };
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, line };
}

const flag = (name, value) => `--${name}=${quote(value)}`;
const show = result => `$ ${result.line}\nexit ${result.code}\n${result.stdout}${result.stderr}`;
const json = text => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const readState = () => JSON.parse(JSON.stringify(parse(fs.readFileSync(statePath, 'utf8'))));

/** Write the patch file with `fs`, as the host's file tool would, then send it. */
function writeState(patch) {
  fs.writeFileSync(patchPath, JSON.stringify(patch));
  return call('write-state', [flag('state', statePath), flag('patch-file', patchPath)]);
}

process.stdout.write(`shell: ${shellName}\nplugin root: ${pluginRoot}\nproject: ${project}\n\n`);

try {
  // --- the freeze -----------------------------------------------------------
  const located = call('locate', ['--name=development']);
  const where = json(located.stdout);
  check('locate finds the project workflow, its path written with /', located.code === 0 && where?.definition === '.maister/workflows/development.yml', show(located));

  const definition = where?.definition ?? '.maister/workflows/development.yml';
  const validated = call('validate', [flag('definition', definition)]);
  check('validate accepts the definition', validated.code === 0, show(validated));

  const resolved = call('resolve', [flag('definition', definition)]);
  const graph = json(resolved.stdout);
  check('resolve prints the graph', resolved.code === 0 && Array.isArray(graph?.nodes), show(resolved));
  if (!graph) throw new Error('no graph to freeze');

  const kind = node => (node.type === 'gate' ? 'gate' : node.uses.startsWith('workflow:') ? 'workflow' : 'task');
  const frozen = writeState({
    task: { title: 'Shell smoke', status: 'in_progress' },
    workflow: {
      source: graph.source ?? definition,
      overlays: graph.overlays,
      profile: graph.profile,
      graph_hash: graph.graph_hash,
      grammar_version: 1,
      name: graph.name,
      nodes: Object.fromEntries(graph.nodes.map(node => [node.id, { kind: kind(node), status: 'pending' }])),
    },
    orchestrator: { task_path: runRelative },
  });
  check('write-state freezes the run', frozen.code === 0 && fs.existsSync(statePath), show(frozen));
  check('the freeze deletes the patch file', !fs.existsSync(patchPath));

  // --- node writes ----------------------------------------------------------
  const running = writeState({ nodes: { analysis: { status: 'running' } } });
  check('a node write lands', running.code === 0 && readState().workflow?.nodes?.analysis?.status === 'running', show(running));

  const note = "Two gaps: $HOME, %PATH%, `ticks`, $(date), C:\\Program Files\\x, 'single' and \"double\" quotes";
  const completed = writeState({
    nodes: { analysis: { status: 'completed' } },
    node_summaries: { analysis: { status: 'completed', summary: note, decisions: [{ decision: 'Patch the tokenizer', rationale: 'smallest change' }] } },
  });
  check('a summary no shell may touch lands byte for byte', completed.code === 0 && readState().node_summaries?.analysis?.summary === note, show(completed));

  // --- the gate -------------------------------------------------------------
  const briefed = call('gate-brief', [flag('state', statePath), '--node=approval', '--json']);
  const picker = json(briefed.stdout);
  check('gate-brief --json prints the picker', briefed.code === 0 && picker?.ok === true && picker.options?.length >= 2 && picker.options[0].recommended === true, show(briefed));

  // --- the dashboard projection --------------------------------------------
  const dataFile = path.join(runDir, 'dashboard-data.js');
  const dataText = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : '';
  const prefix = 'window.MAISTER_DATA = ';
  const data = dataText.startsWith(prefix) && dataText.endsWith(';\n') ? json(dataText.slice(prefix.length, -2)) : null;
  check('the dashboard projection is published and parses', data !== null, dataText.slice(0, 200) || `${dataFile} is missing`);
  check('the projection reads the type from the task path', data?.task?.type === 'development' && data?.task?.path === runRelative, JSON.stringify(data?.task));

  // --- resume-check ---------------------------------------------------------
  const resumed = call('resume-check', [flag('state', statePath)]);
  const report = json(resumed.stdout);
  check('resume-check accepts the run', resumed.code === 0 && report?.ok === true && report.workflow?.name === 'development', show(resumed));
  let viewer = null;
  try {
    viewer = report?.dashboard ? fileURLToPath(report.dashboard) : null;
  } catch {
    viewer = null;
  }
  check('the dashboard link is a file:// URL to the viewer in the run', viewer !== null && path.resolve(viewer) === path.join(runDir, 'dashboard.html') && fs.existsSync(viewer), String(report?.dashboard));

  // --- the hooks ------------------------------------------------------------
  // Each hook is started from its `hooks.json` entry the way the host starts
  // it: `${CLAUDE_PLUGIN_ROOT}` replaced by the plugin root, an exec-form entry
  // (`command` plus `args`) spawned directly, a shell-form entry handed whole to
  // bash — Git Bash on Windows, which is where the host runs it. The host sets
  // CLAUDE_PROJECT_DIR for a hook, in the platform's own spelling.
  const registry = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const entries = Object.values(registry).flat().flatMap(group => group.hooks);
  const entryFor = script => entries.find(entry => [entry.command, ...(entry.args ?? [])].some(part => part.includes(`/hooks/${script}`)));
  const expand = text => text.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
  const bash = bashPath();

  function hook(script, input) {
    const entry = entryFor(script);
    if (!entry) return { code: null, stdout: '', stderr: `hooks.json registers no ${script}`, line: script };
    const [command, args] = entry.args ? [expand(entry.command), entry.args.map(expand)] : [bash, ['-c', expand(entry.command)]];
    const result = spawnSync(command, args, { input, cwd: project, env: { ...env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' });
    return {
      code: result.error ? null : result.status,
      stdout: result.stdout ?? '',
      stderr: result.error ? result.error.message : result.stderr,
      line: [command, ...args].join(' '),
    };
  }

  const edition = hook('edition-check.mjs', JSON.stringify({ hook_event_name: 'SessionStart', cwd: project }));
  check('edition-check: one edition, exit 0 and silent', edition.code === 0 && edition.stdout === '', show(edition));

  if (!bash) {
    process.stdout.write('skip  the bash hooks: no bash on this machine\n');
  } else {
    // post-compact-reminder speaks only when the project holds `.maister/tasks`,
    // which this one does, read through the platform's spelling of the path.
    for (const script of ['skill-invocation-reminder.sh', 'post-compact-reminder.sh']) {
      const reminder = hook(script, JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }));
      const out = json(reminder.stdout);
      check(`${script}: exit 0 with additional context`, reminder.code === 0 && typeof out?.hookSpecificOutput?.additionalContext === 'string', show(reminder));
    }

    const guard = (agent, command) => hook('block-destructive-commands.sh', JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(agent ? { agent_type: agent } : {}),
    }));
    const main = guard(null, 'git stash');
    check('guard: the main agent is let through', main.code === 0 && main.stdout === '', show(main));
    const allowed = guard('test-suite-runner', 'git stash');
    check('guard: a whitelisted subagent is let through', allowed.code === 0 && allowed.stdout === '', show(allowed));
    const denied = guard('code-reviewer', 'git reset --hard HEAD');
    const decision = json(denied.stdout)?.hookSpecificOutput?.permissionDecision;
    const jq = spawnSync(bash, ['-c', 'command -v jq'], { env, encoding: 'utf8' }).status === 0;
    check(`guard: a subagent's destructive command is denied${jq ? '' : ' (no jq: fail-closed)'}`, decision === 'deny' && denied.code === (jq ? 0 : 2), show(denied));
  }

  // --- line endings -----------------------------------------------------------
  const carried = [...walk(path.join(SOURCE_PLUGIN, 'hooks')), ...walk(path.join(SOURCE_PLUGIN, 'skills', 'workflow-engine', 'scripts')), ...walk(path.join(SOURCE_PLUGIN, 'lib'))]
    .filter(file => /\.(sh|mjs|json)$/.test(file) && fs.readFileSync(file, 'utf8').includes('\r'));
  check('the checked-out hooks and engine scripts carry no CR', carried.length === 0, carried.join('\n'));
} catch (err) {
  check('the smoke ran to the end', false, err.stack);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'} under ${shellName}\n`);
process.exitCode = failed ? 1 : 0;

/** Git Bash on Windows, where `bash` on PATH may be WSL's launcher; else bash on PATH. */
function bashPath() {
  if (WINDOWS) {
    const candidates = [process.env.MAISTER_BASH, path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')];
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) ?? null;
  }
  return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}
