import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SAMPLE, freeze, freezePatch, gitScratch, readState, scratch, verb } from '../helpers.mjs';

// The project profile: the `project:` key of `.maister/config.yml`, judged by
// `validate`, copied by the freeze into `orchestrator.options.project`,
// written by `init` through `project-profile` only when the key is absent, and
// handed to the reviewers by `review-brief` with where it came from. A bad
// value is a warning and the field is left out; nothing here stops a run.

const PROJECT_NOTE = "note: ignored the supplied orchestrator.options.project; the freeze records it from the project key of the project's config.yml, so no patch sets it\n";

const configFile = run => path.join(run.root, '.maister', 'config.yml');

function config(run, text) {
  fs.mkdirSync(path.dirname(configFile(run)), { recursive: true });
  fs.writeFileSync(configFile(run), text);
}

function validate(run) {
  const result = verb(['validate', `--definition=${SAMPLE}`], undefined, { CLAUDE_PROJECT_DIR: run.root });
  return { ...result, report: JSON.parse(result.stdout) };
}

function writeProfile(run, detected) {
  const result = verb(['project-profile'], detected, { CLAUDE_PROJECT_DIR: run.root });
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

const profileWarnings = text => text.split('\n').filter(line => line.includes('project-profile:'));

const CLI = ['html_output: true', 'project:', '  kind: cli', '  runtime: "node 20"', '  deploy: package-registry', '  exposure: local', '  data: []', '  scale: team', '  ui: none', ''].join('\n');

test('a project with no project key validates and freezes exactly as before', t => {
  const run = scratch(t);
  config(run, 'html_output: true\n');
  assert.deepEqual(validate(run).report.warnings.filter(each => each.startsWith('project-profile:')), []);
  const frozen = verb(['write-state', `--state=${run.state}`], freezePatch().patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(frozen.stderr, '');
  assert.equal(readState(run).orchestrator.options?.project, undefined);
});

test('the freeze copies a valid profile into orchestrator.options.project', t => {
  const run = scratch(t);
  config(run, CLI);
  assert.deepEqual(validate(run).report.warnings.filter(each => each.includes('project-profile')), []);
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, {
    kind: 'cli', runtime: 'node 20', deploy: 'package-registry', exposure: 'local', data: [], scale: 'team', ui: 'none',
  });
});

test('a bad value is a warning in validate and at the freeze, and only that field is left out', t => {
  const run = scratch(t);
  config(run, ['project:', '  kind: website', '  data: postgres', '  scale: 3', '  colour: blue', '  exposure: public', ''].join('\n'));
  const checked = validate(run);
  assert.equal(checked.report.ok, true, 'a bad profile never refuses the check');
  const warnings = checked.report.warnings.filter(each => each.startsWith('project-profile:'));
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /project\.kind is one of web-app, service, .*, not "website"; the field is left out$/);
  assert.match(warnings[1], /project\.scale is one of single-user, team, multi-tenant, not 3/);
  assert.match(warnings[2], /project\.colour is not a profile field/);

  const frozen = verb(['write-state', `--state=${run.state}`], freezePatch().patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(frozen.code, 0, 'a bad profile never refuses the freeze');
  assert.equal(profileWarnings(frozen.stderr).length, 3, frozen.stderr);
  assert.deepEqual(readState(run).orchestrator.options.project, { data: ['postgres'], exposure: 'public' });
});

test('a project key that is not a map is one warning and no profile', t => {
  const run = scratch(t);
  config(run, 'project: cli\n');
  assert.deepEqual(validate(run).report.warnings.filter(each => each.startsWith('project-profile:')).map(each => /is a map of fields/.test(each)), [true]);
  freeze(run);
  assert.equal(readState(run).orchestrator.options?.project, undefined);
});

test('a patch never sets orchestrator.options.project, at the freeze or after', t => {
  const run = scratch(t);
  config(run, CLI);
  const { patch } = freezePatch({ orchestrator: { options: { project: { kind: 'service' } } } });
  const frozen = verb(['write-state', `--state=${run.state}`], patch, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(frozen.code, 0, frozen.stderr);
  assert.ok(frozen.stderr.includes(PROJECT_NOTE), frozen.stderr);
  assert.equal(readState(run).orchestrator.options.project.kind, 'cli');

  config(run, 'project:\n  kind: service\n');
  const later = verb(['write-state', `--state=${run.state}`], { orchestrator: { options: { project: { kind: 'service' } } } });
  assert.equal(later.code, 0, later.stderr);
  assert.ok(later.stderr.includes(PROJECT_NOTE), later.stderr);
  assert.equal(readState(run).orchestrator.options.project.kind, 'cli', 'an edit of the file reaches the next run, never this one');
});

test('project-profile creates the file, writing undecided and bad fields commented out', t => {
  const run = scratch(t);
  const { code, stderr, report } = writeProfile(run, { kind: 'plugin', runtime: 'node 20', data: [], scale: 'huge', ui: null });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'created');
  assert.deepEqual(report.profile, { kind: 'plugin', runtime: 'node 20', data: [] });
  assert.match(stderr, /^warning: project-profile: scale is one of single-user, team, multi-tenant, not "huge"; it is written commented out$/m);
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.equal(text, report.block);
  assert.match(text, /^project:\n {2}kind: plugin {2}# web-app \| service/m);
  assert.match(text, /^ {2}runtime: "node 20"/m);
  assert.match(text, /^ {2}# deploy: {2}# none \| local \| container/m);
  assert.match(text, /^ {2}# scale: {2}# single-user \| team \| multi-tenant$/m);
  assert.match(text, /^ {2}# ui: {2}# none \| web \| tui \| native$/m);

  const checked = validate(run);
  assert.deepEqual(checked.report.warnings.filter(each => each.startsWith('project-profile:')), [], 'the block written reads back clean');
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, { kind: 'plugin', runtime: 'node 20', data: [] });
});

test('project-profile appends to a config with no project key, changing no other line', t => {
  const run = scratch(t);
  const before = 'html_output: true\nsubagents:\n  agents:\n    Explore: { tier: light }\n# project: a commented key does not count\n';
  config(run, before);
  const { code, stderr, report } = writeProfile(run, { kind: 'service', deploy: 'kubernetes', exposure: 'public', data: ['postgres'] });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'appended');
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.equal(text, `${before}\n${report.block}`);
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, { kind: 'service', deploy: 'kubernetes', exposure: 'public', data: ['postgres'] });
  assert.ok(readState(run).orchestrator.options.subagents, 'the subagents block still freezes');
});

test('project-profile keeps the line endings of a CRLF config it appends to', t => {
  const run = scratch(t);
  config(run, 'html_output: true\r\nmockup_format: html');
  const { code, stderr } = writeProfile(run, { kind: 'cli' });
  assert.equal(code, 0, stderr);
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.ok(text.startsWith('html_output: true\r\nmockup_format: html\r\n\r\n# project'), JSON.stringify(text.slice(0, 60)));
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'every line ends CRLF');
  freeze(run);
  assert.equal(readState(run).orchestrator.options.project.kind, 'cli');
});

test('project-profile leaves an existing project key alone', t => {
  const run = scratch(t);
  config(run, CLI);
  const { code, stderr, report } = writeProfile(run, { kind: 'service' });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'kept');
  assert.equal(report.block, null);
  assert.equal(fs.readFileSync(configFile(run), 'utf8'), CLI);
});

// project-profile --fill: init's update. An existing key gets the fields it
// lacks, holds empty or holds commented out; a field it sets is never changed.

function fillProfile(run, detected) {
  const result = verb(['project-profile', '--fill'], detected, { CLAUDE_PROJECT_DIR: run.root });
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}

test('project-profile --fill writes over the commented-out fields a first run left, every other line unchanged', t => {
  const run = scratch(t);
  const first = writeProfile(run, { kind: 'cli', runtime: 'node 20' });
  assert.equal(first.report.action, 'created');
  const before = fs.readFileSync(configFile(run), 'utf8');
  const { code, stderr, report } = fillProfile(run, { kind: 'library', deploy: 'package-registry', exposure: 'local', ui: 'none' });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'filled');
  assert.deepEqual(report.profile, { deploy: 'package-registry', exposure: 'local', ui: 'none' }, 'kind is set, so the analysis does not change it');
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.ok(text.endsWith(report.block) && report.block.startsWith('project:\n'), 'the reply carries the block as it now reads');
  assert.equal(text, before
    .replace(/^ {2}# deploy: {2}# (.*)$/m, '  deploy: package-registry  # $1')
    .replace(/^ {2}# exposure: {2}# (.*)$/m, '  exposure: local  # $1')
    .replace(/^ {2}# ui: {2}# (.*)$/m, '  ui: none  # $1'));
  assert.match(text, /^ {2}kind: cli /m);
  assert.deepEqual(validate(run).report.warnings.filter(each => each.startsWith('project-profile:')), [], 'the filled block reads back clean');
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, { kind: 'cli', runtime: 'node 20', deploy: 'package-registry', exposure: 'local', ui: 'none' });
});

test('project-profile --fill fills an empty field and adds an absent one at the end of the block, before what follows', t => {
  const run = scratch(t);
  const before = ['html_output: true', 'project:', '    kind: service', '    deploy:', '    # a note of the team\'s', '', '# subagents — the models', 'subagents:', '  agents:', '    Explore: { tier: light }', ''].join('\n');
  config(run, before);
  const { code, stderr, report } = fillProfile(run, { kind: 'cli', deploy: 'kubernetes', data: ['postgres', 'files'] });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'filled');
  assert.deepEqual(report.profile, { deploy: 'kubernetes', data: ['postgres', 'files'] });
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.equal(text, ['html_output: true', 'project:', '    kind: service',
    '    deploy: kubernetes  # none | local | container | kubernetes | serverless | package-registry | app-store',
    '    # a note of the team\'s',
    '    data: [postgres, files]  # the stores it writes, e.g. [postgres, files]; [] for none',
    '', '# subagents — the models', 'subagents:', '  agents:', '    Explore: { tier: light }', ''].join('\n'));
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, { kind: 'service', deploy: 'kubernetes', data: ['postgres', 'files'] });
  assert.ok(readState(run).orchestrator.options.subagents, 'the subagents block still freezes');
});

test('project-profile --fill leaves a set field alone, even one whose value it would refuse', t => {
  const run = scratch(t);
  const before = 'project:\n  kind: website\n  ui: web\n';
  config(run, before);
  const { code, stderr, report } = fillProfile(run, { kind: 'web-app', ui: 'none', scale: 'everyone' });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'kept');
  assert.equal(report.block, null);
  assert.match(stderr, /^warning: project-profile: scale is one of single-user, team, multi-tenant, not "everyone"; it is not written$/m);
  assert.equal(fs.readFileSync(configFile(run), 'utf8'), before);
});

test('project-profile --fill with no project key appends the block as a first run does', t => {
  const run = scratch(t);
  config(run, 'html_output: true\n');
  const { code, stderr, report } = fillProfile(run, { kind: 'plugin' });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'appended');
  assert.equal(fs.readFileSync(configFile(run), 'utf8'), `html_output: true\n\n${report.block}`);
});

test('project-profile --fill keeps CRLF line endings, and gives a block that ends the file its newline', t => {
  const run = scratch(t);
  config(run, 'html_output: true\r\nproject:\r\n  # deploy:  # none\r\n  kind: cli');
  const { code, stderr, report } = fillProfile(run, { deploy: 'container', ui: 'tui' });
  assert.equal(code, 0, stderr);
  assert.equal(report.action, 'filled');
  const text = fs.readFileSync(configFile(run), 'utf8');
  assert.ok(text.startsWith('html_output: true\r\nproject:\r\n  deploy: container  # none | local'), JSON.stringify(text));
  assert.ok(text.endsWith('  kind: cli\r\n  ui: tui  # none | web | tui | native\r\n'), JSON.stringify(text));
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /[\r\n]/, 'every line ends CRLF');
  freeze(run);
  assert.deepEqual(readState(run).orchestrator.options.project, { deploy: 'container', kind: 'cli', ui: 'tui' });
});

test('project-profile --fill keeps a key written on one line, or one that is not a map, and says to add the fields by hand', t => {
  for (const before of ['project: { kind: cli }\n', 'project: cli\n']) {
    const run = scratch(t);
    config(run, before);
    const { code, stderr, report } = fillProfile(run, { deploy: 'container' });
    assert.equal(code, 0, stderr);
    assert.equal(report.action, 'kept');
    assert.match(stderr, /^warning: project-profile: .*the project: key (is written on one line|is not a map of fields), so no field was filled in; add the missing ones by hand$/m);
    assert.equal(fs.readFileSync(configFile(run), 'utf8'), before);
  }
});

test('project-profile refuses input that is not an object, writing nothing', t => {
  const run = scratch(t);
  const { code, stderr } = writeProfile(run, ['cli']);
  assert.equal(code, 1);
  assert.match(stderr, /^project-profile-bad-input: /m);
  assert.equal(fs.existsSync(configFile(run)), false);
});

// review-brief

function brief(run, flags) {
  const result = verb(['review-brief', ...flags], undefined, { CLAUDE_PROJECT_DIR: run.root });
  assert.equal(result.code, 0, result.stderr);
  return { ...result, json: JSON.parse(fs.readFileSync(result.stdout.trim(), 'utf8')) };
}

test('review-brief: a run carries the profile its freeze recorded, source config', t => {
  const run = gitScratch(t, { 'src/app.mjs': 'export const a = 1;\n' });
  config(run, CLI);
  freeze(run);
  config(run, 'project:\n  kind: service\n');
  const { json } = brief(run, [`--state=${run.state}`]);
  assert.deepEqual(json.profile, {
    kind: 'cli', runtime: 'node 20', deploy: 'package-registry', exposure: 'local', data: [], scale: 'team', ui: 'none', source: 'config',
  });
});

test('review-brief: a run frozen with no profile says source none, whatever the file says now', t => {
  const run = gitScratch(t, { 'src/app.mjs': 'export const a = 1;\n' });
  freeze(run);
  config(run, CLI);
  const { json } = brief(run, [`--state=${run.state}`]);
  assert.deepEqual(json.profile, { source: 'none' });
});

test('review-brief: standalone reads the project key, a bad field a warning', t => {
  const run = gitScratch(t, { 'src/app.mjs': 'export const a = 1;\n' });
  config(run, 'project:\n  kind: library\n  deploy: moon\n');
  const { json, stderr } = brief(run, [`--task-path=${run.dir}`, '--base=HEAD']);
  assert.deepEqual(json.profile, { kind: 'library', source: 'config' });
  assert.match(stderr, /^warning: review-brief-profile: .*project\.deploy is one of none, local, .*, not "moon"; the field is left out$/m);
});

test('review-brief: standalone with no project key says source none', t => {
  const run = gitScratch(t, { 'src/app.mjs': 'export const a = 1;\n' });
  const { json, stderr } = brief(run, [`--task-path=${run.dir}`, '--base=HEAD']);
  assert.deepEqual(json.profile, { source: 'none' });
  assert.doesNotMatch(stderr, /review-brief-profile/);
});
