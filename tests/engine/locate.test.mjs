import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE, ENGINE_DIR, run } from '../helpers.mjs';

// `locate` is the name lookup a run starts from. Each test lays out a scratch
// project's `.maister/workflows/` and runs the verb from that project's root,
// the way a session runs it, so the paths it prints are checked in the
// spelling a caller passes straight on to `validate` and `resolve`.

const CUSTOM = [
  'name: onboarding',
  'version: 1',
  'inputs:',
  '  team: {type: string, required: true}',
  '  dry_run: {type: bool, required: false, default: false}',
  'nodes:',
  '  survey:',
  '    uses: direct:survey',
  '    needs: []',
  '  approval:',
  '    type: gate',
  '    needs: [survey]',
  '    ask: "Survey complete. Continue?"',
  '    options:',
  '      continue: continue',
  '      stop-here: stop',
  '',
].join('\n');

const COMPANION = [
  '# Team onboarding',
  '',
  'Surveys a new team\'s repositories and',
  'proposes an onboarding plan.',
  '',
  'A second paragraph that is not the summary.',
  '',
  '## `survey`',
  '',
  'List the repositories.',
  '',
].join('\n');

const CHAIN = [
  'name: rollout',
  'version: 1',
  'nodes:',
  '  plan:',
  '    uses: direct:plan',
  '    needs: []',
  '  build:',
  '    uses: workflow:development',
  '    dir: api',
  '    needs: [plan]',
  '',
].join('\n');

const RESEARCH_OVERLAY = [
  'extends: builtin:research',
  'display:',
  '  titles:',
  '    research-foundation: "Foundation"',
  '',
].join('\n');

/** A scratch project root holding the given files, removed when the test ends. */
function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-locate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

/** Run one engine verb from the project root, as a session in that project does. */
function inProject(root, args) {
  const result = run(ENGINE, args, undefined, { CLAUDE_PROJECT_DIR: root }, root);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

const home = name => path.join('.maister', 'workflows', name);
const builtin = name => path.join(ENGINE_DIR, 'workflows', `${name}.yml`);

test('a project workflow is found in its own home, with its interface and companion', t => {
  const root = project(t, { [home('onboarding.yml')]: CUSTOM, [home('onboarding.md')]: COMPANION });
  const { code, report } = inProject(root, ['locate', '--name=onboarding']);
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.name, 'onboarding');
  assert.equal(report.from, 'eject');
  assert.equal(report.definition, home('onboarding.yml'));
  assert.deepEqual(report.overlays, []);
  assert.equal(report.ignored, null);
  assert.equal(report.companion, home('onboarding.md'));
  assert.equal(report.title, 'Team onboarding');
  assert.equal(report.summary, 'Surveys a new team\'s repositories and proposes an onboarding plan.');
  assert.deepEqual(report.inputs, {
    team: { type: 'string', required: true },
    dry_run: { type: 'bool', required: false, default: false },
  });
  assert.deepEqual(report.dispatches, []);
});

test('a definition with no companion has no title and no summary', t => {
  const root = project(t, { [home('onboarding.yml')]: CUSTOM });
  const { code, report } = inProject(root, ['locate', '--name=onboarding']);
  assert.equal(code, 0);
  assert.equal(report.companion, null);
  assert.equal(report.title, null);
  assert.equal(report.summary, null);
});

test('a built-in is found where the plugin ships it, named either way', t => {
  const root = project(t);
  for (const name of ['research', 'builtin:research']) {
    const { code, report } = inProject(root, ['locate', `--name=${name}`]);
    assert.equal(code, 0, name);
    assert.equal(report.name, 'research');
    assert.equal(report.from, 'builtin');
    assert.equal(report.definition, builtin('research'));
    assert.deepEqual(report.overlays, []);
    assert.deepEqual(report.inputs.question, { type: 'string', required: true });
  }
});

test('an overlay home names the built-in as the definition and the overlay beside it', t => {
  const root = project(t, { [home('research.overlay.yml')]: RESEARCH_OVERLAY });
  const { code, report } = inProject(root, ['locate', '--name=research']);
  assert.equal(code, 0);
  assert.equal(report.from, 'overlay');
  assert.equal(report.definition, builtin('research'));
  assert.deepEqual(report.overlays, [home('research.overlay.yml')]);
});

test('an overlay beside an eject of its name is reported as ignored, not applied', t => {
  const eject = fs.readFileSync(builtin('research'), 'utf8');
  const root = project(t, { [home('research.yml')]: eject, [home('research.overlay.yml')]: RESEARCH_OVERLAY });
  const { code, report } = inProject(root, ['locate', '--name=research']);
  assert.equal(code, 0);
  assert.equal(report.from, 'eject');
  assert.equal(report.definition, home('research.yml'));
  assert.deepEqual(report.overlays, []);
  assert.equal(report.ignored, home('research.overlay.yml'));
});

test('a generated chain is found in its own home', t => {
  const root = project(t, { [path.join('.maister', 'workflows', 'generated', 'onboarding.yml')]: CUSTOM });
  const { code, report } = inProject(root, ['locate', '--name=onboarding']);
  assert.equal(code, 0);
  assert.equal(report.from, 'generated');
  assert.equal(report.definition, path.join('.maister', 'workflows', 'generated', 'onboarding.yml'));
});

test('the nodes that dispatch into a member are named', t => {
  const root = project(t, { [home('rollout.yml')]: CHAIN });
  const { code, report } = inProject(root, ['locate', '--name=rollout']);
  assert.equal(code, 0);
  assert.deepEqual(report.dispatches, ['build']);
});

// A node an overlay or a profile adds with `dir:` makes the run a chain as
// surely as one the base declares, and a node the base declares stops making
// it one once an overlay disables it: the chain is judged on the graph a run
// would freeze.
const SHIP = [
  '    ship:',
  '      uses: workflow:development',
  '      dir: api',
  '      needs: [research-foundation]',
];

test('a dir: node an overlay adds over a built-in makes it a chain', t => {
  const root = project(t, { [home('research.overlay.yml')]: ['extends: builtin:research', 'add:', ...SHIP.map(line => line.slice(2)), ''].join('\n') });
  const { code, report } = inProject(root, ['locate', '--name=research']);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.dispatches, ['ship']);
});

test('a dir: node a profile adds counts only when that profile is selected', t => {
  const root = project(t, {
    [home('research.overlay.yml')]: ['extends: builtin:research', 'profiles:', '  wide:', '    add:', ...SHIP.map(line => `  ${line}`), ''].join('\n'),
  });
  assert.deepEqual(inProject(root, ['locate', '--name=research']).report.dispatches, []);
  const { code, report } = inProject(root, ['locate', '--name=research', '--profile=wide']);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.deepEqual(report.dispatches, ['ship']);
});

test('the caller\'s own overlays are folded in after the lookup\'s, adding or removing a dir: node', t => {
  const root = project(t, {
    [home('rollout.yml')]: CHAIN,
    [home('onboarding.yml')]: CUSTOM,
    'lean.overlay.yml': 'extends: rollout\ndisable: [build]\n',
    'split.overlay.yml': 'extends: onboarding\nadd:\n  handoff:\n    uses: workflow:development\n    dir: api\n    needs: [survey]\n',
  });
  const lean = inProject(root, ['locate', '--name=rollout', '--overlay=lean.overlay.yml']);
  assert.equal(lean.code, 0, JSON.stringify(lean.report.errors));
  assert.deepEqual(lean.report.dispatches, []);
  assert.deepEqual(lean.report.overlays, [], 'overlays stays the lookup\'s own, the values validate takes before the caller\'s');
  const split = inProject(root, ['locate', '--name=onboarding', '--overlay=split.overlay.yml']);
  assert.deepEqual(split.report.dispatches, ['handoff']);
});

test('an overlay the caller names that cannot be read is refused with the reader\'s error', t => {
  const root = project(t, { [home('onboarding.yml')]: CUSTOM });
  const { code, report } = inProject(root, ['locate', '--name=onboarding', '--overlay=missing.overlay.yml']);
  assert.equal(code, 1);
  assert.match(report.errors[0].message, /cannot be read/);
});

test('--overlay and --profile need a name', t => {
  const root = project(t);
  for (const flag of ['--overlay=x.overlay.yml', '--profile=wide']) {
    const result = inProject(root, ['locate', flag]);
    assert.equal(result.code, 2, flag);
    assert.match(result.stderr, /locate takes --overlay and --profile only with --name/);
  }
});

test('a name found nowhere is refused with the four homes it was looked for in', t => {
  const root = project(t);
  const { code, report } = inProject(root, ['locate', '--name=nowhere']);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].path, 'name');
  assert.match(report.errors[0].message, /no workflow named "nowhere"/);
  assert.match(report.errors[0].message, /nowhere\.overlay\.yml/);
});

test('an overlay for a name no built-in carries is refused, naming the overlay and the base it lacks', t => {
  const root = project(t, { [home('acme.overlay.yml')]: 'extends: acme\n' });
  const { code, report } = inProject(root, ['locate', '--name=acme']);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual([report.errors[0].file, report.errors[0].path], [home('acme.overlay.yml'), 'name']);
  assert.match(report.errors[0].message, /is an overlay for "acme", but there is no built-in acme to lay it over/);
  assert.match(report.errors[0].message, /write it as \.maister\/workflows\/acme\.yml/);
});

test('a name outside the workflow charset is refused before any path is built', t => {
  const root = project(t);
  for (const name of ['../escape', 'Upper', 'a/b']) {
    const { code, report } = inProject(root, ['locate', `--name=${name}`]);
    assert.equal(code, 1, name);
    assert.match(report.errors[0].message, /is not a workflow name/);
  }
});

test('a file found by one name that declares another is refused', t => {
  const root = project(t, { [home('acme.yml')]: CUSTOM });
  const { code, report } = inProject(root, ['locate', '--name=acme']);
  assert.equal(code, 1);
  assert.equal(report.errors[0].file, home('acme.yml'));
  assert.match(report.errors[0].message, /found by the name "acme" but declares name: onboarding/);
});

test('a definition that does not parse is refused with the reader\'s own error', t => {
  const root = project(t, { [home('onboarding.yml')]: 'name: onboarding\n  version: 1\n' });
  const { code, report } = inProject(root, ['locate', '--name=onboarding']);
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);
});

test('what locate prints is what validate and resolve take', t => {
  const root = project(t, {
    [home('onboarding.yml')]: CUSTOM,
    [home('onboarding.md')]: COMPANION + '\n## `approval`\n\nThe gate.\n',
    [home('research.overlay.yml')]: RESEARCH_OVERLAY,
  });
  for (const name of ['onboarding', 'research']) {
    const { report } = inProject(root, ['locate', `--name=${name}`]);
    const flags = [`--definition=${report.definition}`, ...report.overlays.map(overlay => `--overlay=${overlay}`)];
    const validated = inProject(root, ['validate', ...flags]);
    assert.equal(validated.code, 0, `${name}: ${validated.stdout}`);
    const resolved = inProject(root, ['resolve', ...flags]);
    assert.equal(resolved.code, 0, `${name}: ${resolved.stdout}`);
    assert.equal(resolved.report.name, name);
    assert.deepEqual(resolved.report.overlays, report.overlays);
  }
});

test('without a name, the project\'s own workflows are listed and nothing else', t => {
  const root = project(t, {
    [home('onboarding.yml')]: CUSTOM,
    [home('onboarding.md')]: COMPANION,
    [home('rollout.yml')]: CHAIN,
    [home('acme.yml')]: CUSTOM,
    [home('research.yml')]: fs.readFileSync(builtin('research'), 'utf8'),
    [home('research.overlay.yml')]: RESEARCH_OVERLAY,
    [path.join('.maister', 'workflows', 'generated', 'planned.yml')]: CUSTOM,
    [home('notes.txt')]: 'not a definition',
  });
  const { code, report } = inProject(root, ['locate']);
  assert.equal(code, 0);
  assert.deepEqual(report.workflows.map(entry => entry.name), ['acme', 'onboarding', 'rollout']);
  const [acme, onboarding, rollout] = report.workflows;
  assert.deepEqual(onboarding, {
    name: 'onboarding',
    definition: home('onboarding.yml'),
    title: 'Team onboarding',
    summary: 'Surveys a new team\'s repositories and proposes an onboarding plan.',
    chain: false,
    error: null,
  });
  assert.equal(rollout.chain, true);
  assert.equal(rollout.title, null);
  assert.match(acme.error, /declares name: onboarding/);
});

test('a project with no workflow directory lists none', t => {
  const root = project(t);
  const { code, report } = inProject(root, ['locate']);
  assert.equal(code, 0);
  assert.deepEqual(report.workflows, []);
});

test('locate takes --name, --overlay and --profile and no other flag', () => {
  const result = run(ENGINE, ['locate', '--definition=x.yml']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /the verb locate takes no --definition flag/);
});
