import fs from 'node:fs';

const hooksDir = new URL('../plugins/maister-codex/hooks/', import.meta.url);
const configPath = new URL('hooks.json', hooksDir);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const sources = [
  [config.hooks.SessionStart[0], 'post-compact-reminder.mjs'],
  [config.hooks.SessionStart[1], 'workflow-reminder.mjs'],
  [config.hooks.PreToolUse[0], 'block-destructive-commands.mjs'],
  [config.hooks.SubagentStart[0], 'subagent-safety-reminder.mjs'],
];
let changed = false;
for (const [group, file] of sources) {
  const source = fs.readFileSync(new URL(file, hooksDir), 'utf8');
  // A quoted shell argument preserves imports, whitespace, $, and backticks.
  const command = `node --input-type=module -e '${source.replaceAll("'", "'\\''")}'`;
  if (group.hooks[0].command !== command) {
    group.hooks[0].command = command;
    changed = true;
  }
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
} else if (changed) {
  console.error('Hook commands differ from their sources. Run node scripts/sync-codex-hooks.mjs --write');
  process.exitCode = 1;
}
