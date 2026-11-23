import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR, freezePatch, readState, run, scratch, variantRoot, verb } from '../helpers.mjs';

// The freeze records the run's own facts itself, so no freeze patch has to
// carry them: the tracker key from the input `resolve` names, the run's
// folder, the two configuration options, the delegation record on the host the
// build ships for. It refuses a chain started from the terminal and a top-level
// run folder at the wrong depth, before anything is written.

const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const RELAY = 'Show the person the lines below now, as a visible message of your own — the next thing you write, before any other call, never only in your thinking — each line copied as printed';

/** A scratch run with `config` written as the project's `.maister/config.yml`. */
function configured(t, config, options = {}) {
  const target = scratch(t, options);
  if (config !== null) fs.writeFileSync(path.join(target.root, '.maister', 'config.yml'), config);
  return target;
}

const freezeOf = (target, patch, env = {}, args = []) => verb(['write-state', `--state=${target.state}`, ...args], patch, env);

test('E6: a graph with a dir: node frozen under no driver or a terminal one is refused state-freeze-chain-only', t => {
  const definition = path.join(scratch(t).root, 'dir-chain.yml');
  fs.writeFileSync(definition, [
    'name: dir-chain', 'version: 1', 'description: "Hands one step to a member repository."', 'nodes:',
    '  plan:', '    uses: direct:plan', '    needs: []',
    '  remote:', '    uses: skill:quick-plan', '    dir: members/api', '    needs: [plan]', '',
  ].join('\n'));
  fs.writeFileSync(definition.replace(/\.yml$/, '.md'), '# Dir chain — node prose\n\n## `plan`\n\nPlan it.\n');
  for (const [label, orchestrator] of [['no driver', {}], ['a terminal driver', { driver: { kind: 'terminal' } }]]) {
    const target = scratch(t, { name: `2026-01-05-${label.replace(/\W+/g, '-')}` });
    const result = freezeOf(target, freezePatch({ definition, orchestrator }).patch);
    assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^state-freeze-chain-only: .*remote.*a chain starts only under a driver that dispatches it/m, label);
    assert.equal(fs.existsSync(target.state), false, `${label}: nothing is written`);
  }
  const driven = scratch(t, { name: '2026-01-05-driven' });
  const accepted = freezeOf(driven, freezePatch({ definition, orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } }).patch);
  assert.equal(accepted.code, 0, accepted.stderr);
});

test('E7 and E8: the freeze writes task.key from the tracker-key input and task_path from its own folder, dropping a sent one', t => {
  const target = scratch(t);
  const { patch } = freezePatch({ inputs: { ticket: 'PROJ-42' }, orchestrator: { task_path: 'somewhere/else' } });
  const result = freezeOf(target, patch);
  assert.equal(result.code, 0, result.stderr);
  const state = readState(target);
  assert.equal(state.task.key, 'PROJ-42');
  assert.equal(state.orchestrator.task_path, '.maister/tasks/development/2026-01-05-sample');
  assert.match(result.stderr, /^note: ignored the supplied orchestrator\.task_path; the freeze records it from the run's own folder/m);

  // After the freeze a write of task_path is accepted as sent.
  const later = verb(['write-state', `--state=${target.state}`], { orchestrator: { task_path: 'moved/by/hand' } });
  assert.equal(later.code, 0, later.stderr);
  assert.doesNotMatch(later.stderr, /task_path/);
  assert.equal(readState(target).orchestrator.task_path, 'moved/by/hand');
});

test('E9: with no config file or key the freeze writes the defaults; a config value fills a patch that sends none; a sent value stands', t => {
  for (const config of [null, 'subagents: {}\n']) {
    const target = configured(t, config, { name: `2026-01-05-${config === null ? 'no-file' : 'no-key'}` });
    assert.equal(freezeOf(target, freezePatch().patch).code, 0);
    const options = readState(target).orchestrator.options;
    assert.equal(options.html_output, true, String(config));
    assert.equal(options.mockup_format, 'html', String(config));
  }

  const filled = configured(t, 'html_output: false   # markdown only\nmockup_format: ascii\n', { name: '2026-01-05-filled' });
  const result = freezeOf(filled, freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Dashboard: none \(html_output is false\)$/m);
  assert.equal(readState(filled).orchestrator.options.html_output, false);
  assert.equal(readState(filled).orchestrator.options.mockup_format, 'ascii');

  const sent = configured(t, 'html_output: false\nmockup_format: ascii\n', { name: '2026-01-05-sent' });
  assert.equal(freezeOf(sent, freezePatch({ orchestrator: { options: { html_output: true, mockup_format: 'html' } } }).patch).code, 0);
  assert.equal(readState(sent).orchestrator.options.html_output, true);
  assert.equal(readState(sent).orchestrator.options.mockup_format, 'html');
});

test('E9: a mockup_format the config gives other than html or ascii is recorded html, with one warning', t => {
  const target = configured(t, 'mockup_format: figma\n');
  const result = freezeOf(target, freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readState(target).orchestrator.options.mockup_format, 'html');
  assert.equal(result.stderr.match(/^warning: mockup-format-replaced:figma$/gm)?.length, 1, result.stderr);
});

test('E10: a freeze naming no host records the delegation of the host the build ships for, on both hosts', t => {
  const claude = scratch(t, { name: '2026-01-05-claude' });
  assert.equal(freezeOf(claude, freezePatch().patch).code, 0);
  assert.deepEqual(readState(claude).orchestrator.options.delegation, { mode: 'nested', depth: 3, source: 'claude default' });

  const copilot = scratch(t, { name: '2026-01-05-copilot' });
  const engine = path.join(variantRoot(), 'skills/workflow-engine/scripts/workflow.mjs');
  const result = run(engine, ['write-state', `--state=${copilot.state}`], freezePatch().patch);
  assert.equal(result.code, 0, result.stderr);
  const delegation = readState(copilot).orchestrator.options.delegation;
  assert.equal(delegation.mode, 'inline');
  assert.equal(delegation.depth, 4);
  assert.equal(delegation.source, 'copilot default');
});

test('E11: the relay line asks for the lines as printed, and tells whether the freeze\'s opener opened the dashboard', t => {
  const quiet = scratch(t, { name: '2026-01-05-quiet' });
  const kept = freezeOf(quiet, freezePatch().patch);
  assert.equal(kept.stdout.split('\n')[0], `${RELAY}.`);

  const opened = scratch(t, { name: '2026-01-05-opened' });
  const dir = fs.mkdtempSync(path.join(opened.root, 'opener-'));
  const script = path.join(dir, 'opener.mjs');
  fs.writeFileSync(script, '');
  const env = { MAISTER_NO_OPEN: '', MAISTER_OPENER: JSON.stringify([process.execPath, script]) };
  const result = freezeOf(opened, freezePatch().patch, env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n')[0], `${RELAY}; the dashboard is already open: run no opener.`);

  // An opener that does not start: the line says the dashboard did not open,
  // never that it is open, beside the warning naming the page.
  const missing = scratch(t, { name: '2026-01-05-missing' });
  const failed = freezeOf(missing, freezePatch().patch, { MAISTER_NO_OPEN: '', MAISTER_OPENER: JSON.stringify([path.join(missing.root, 'no-such-opener')]) });
  assert.equal(failed.code, 0, failed.stderr);
  assert.equal(failed.stdout.split('\n')[0], `${RELAY}; the dashboard did not open: tell the person to open its Dashboard link in a browser, and run no opener.`);
  assert.doesNotMatch(failed.stdout, /already open/);
  assert.match(failed.stderr, /^warning: the dashboard did not open \(.*\); open .*dashboard\.html in a browser$/m);

  // Under --no-open the verb opens nothing, so the line says nothing is open.
  const closed = scratch(t, { name: '2026-01-05-closed' });
  const unopened = freezeOf(closed, freezePatch().patch, env, ['--no-open']);
  assert.equal(unopened.code, 0, unopened.stderr);
  assert.equal(unopened.stdout.split('\n')[0], `${RELAY}.`);

  // An identical re-send prints no banner, and its note says where the facts are.
  const again = freezeOf(quiet, { workflow: readState(quiet).workflow });
  assert.match(again.stderr, /^note: ignored the supplied workflow block, which matches the frozen one; .*orchestrator-state\.yml/m);
});

test('E12: a top-level freeze outside a run folder is refused state-run-folder-misplaced, naming where it belongs', t => {
  const root = scratch(t).root;
  for (const relative of ['.maister/tasks/2026-01-05-shallow', '.maister/tasks/development/2026-01-05-sample/2026-01-05-deep', 'runs/2026-01-05-elsewhere']) {
    const dir = path.join(root, ...relative.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const state = path.join(dir, 'orchestrator-state.yml');
    const result = verb(['write-state', `--state=${state}`], freezePatch().patch);
    assert.equal(result.code, 1, `${relative}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /^state-run-folder-misplaced: /m, relative);
    assert.ok(result.stderr.includes(path.join('.maister', 'tasks', 'development') + path.sep), `${relative}: the message names the folder the run belongs in`);
    assert.equal(fs.existsSync(state), false, `${relative}: nothing is written`);
  }
  // An umbrella run's folder is a run folder too.
  const umbrella = path.join(root, '.maister/umbrella/runs/u-0001');
  fs.mkdirSync(umbrella, { recursive: true });
  const accepted = verb(['write-state', `--state=${path.join(umbrella, 'orchestrator-state.yml')}`], freezePatch().patch);
  assert.equal(accepted.code, 0, accepted.stderr);
});

test('E12: a chain\'s own run, under an umbrella run\'s runs/ folder, is a run folder too', t => {
  const root = scratch(t).root;
  const member = path.join(root, '.maister/umbrella/runs/r-0001/runs/m-0001');
  fs.mkdirSync(member, { recursive: true });
  const state = path.join(member, 'orchestrator-state.yml');
  const { patch } = freezePatch({ orchestrator: { driver: { kind: 'cockpit', cwd: '/work' } } });
  const result = verb(['write-state', `--state=${state}`], patch);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /state-run-folder-misplaced/);
  // Its folder is recorded from the project root, two levels above the umbrella's own runs.
  assert.equal(readState({ state }).orchestrator.task_path, '.maister/umbrella/runs/r-0001/runs/m-0001');
});

test('E12: a sub-run child is held to its own path rule, never refused as misplaced', t => {
  const parent = scratch(t);
  assert.equal(freezeOf(parent, freezePatch().patch).code, 0);
  const inside = path.join(parent.dir, '2026-01-05-sample-research');
  fs.mkdirSync(inside, { recursive: true });
  const { patch } = freezePatch({
    definition: RESEARCH,
    task: { title: 'Open questions' },
    inputs: { question: 'What is open?', embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  const result = verb(['write-state', `--state=${path.join(inside, 'orchestrator-state.yml')}`], patch);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /^state-subrun-path-mismatch\b/);
  assert.doesNotMatch(result.stderr, /state-run-folder-misplaced/);
});

test('E13: a top-level run with a node named parent gets the relay banner, and is held to the run-folder rule', t => {
  const definition = path.join(scratch(t).root, 'parent-node.yml');
  fs.writeFileSync(definition, [
    'name: parent-node', 'version: 1', 'description: "Has a node whose id is parent."', 'nodes:',
    '  parent:', '    uses: direct:parent', '    needs: []', '',
  ].join('\n'));
  fs.writeFileSync(definition.replace(/\.yml$/, '.md'), '# Parent node — node prose\n\n## `parent`\n\nDo it.\n');
  const target = scratch(t);
  const result = freezeOf(target, freezePatch({ definition }).patch);
  assert.equal(result.code, 0, result.stderr);
  // The frozen file carries an indented `parent:` line under workflow.nodes, and no parent link.
  assert.match(fs.readFileSync(target.state, 'utf8'), /^ +parent:/m);
  assert.equal(readState(target).orchestrator.parent, undefined);
  assert.equal(result.stdout.split('\n')[0], `${RELAY}.`);
  assert.doesNotMatch(result.stdout, /do not relay/);

  // Frozen in a misplaced folder, it is refused as a top-level run.
  const misplaced = path.join(target.root, '.maister', 'tasks', '2026-01-05-shallow');
  fs.mkdirSync(misplaced, { recursive: true });
  const state = path.join(misplaced, 'orchestrator-state.yml');
  const refused = verb(['write-state', `--state=${state}`], freezePatch({ definition }).patch);
  assert.equal(refused.code, 1, `${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /^state-run-folder-misplaced: /m);
  assert.equal(fs.existsSync(state), false);
});
