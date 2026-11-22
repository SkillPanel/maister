// A declared artifact a subagent writes must not carry a base name Claude Code
// refuses from a subagent's Write (`SUBAGENT_REFUSED_NAME`). The validator
// warns `subagent-artifact-name` on an `agent:` step and on a `direct:` step
// whose brief names delegates for Claude Code, naming the node, the path and
// the rule and suggesting a subject name; it never refuses. No built-in
// definition trips it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ENGINE_DIR, verb } from '../helpers.mjs';
import { SUBAGENT_REFUSED_NAME } from '../../plugins/maister/skills/workflow-engine/scripts/lib/graph.mjs';

const CODE = 'subagent-artifact-name:';
const named = report => report.warnings.filter(warning => warning.startsWith(CODE));

function validate(definition) {
  const result = verb(['validate', `--definition=${definition}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

/** A two-node definition written to a scratch directory: `gather` runs as `uses`, `close` inline. */
function definition(t, { uses, artifact, brief = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-subagent-name-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'names.yml');
  fs.writeFileSync(file, [
    'name: names',
    'version: 1',
    'description: Gathers notes and closes.',
    'nodes:',
    '  gather:',
    `    uses: ${uses}`,
    '    outputs:',
    '      artifacts:',
    `        notes: ${artifact}`,
    '  close:',
    '    uses: direct:close',
    '    needs: [gather]',
    brief,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'names.md'), '# Names\n\nGathers notes and closes.\n');
  return file;
}

test('the pattern is the host rule: the base name alone, any case', () => {
  for (const name of ['report.md', 'REPORT.md', 'summary-notes.md', 'findings.md', 'Analysis.tpl.md', 'report-template.md']) {
    assert.ok(SUBAGENT_REFUSED_NAME.test(name), name);
  }
  for (const name of ['gap-analysis.md', 'research-report.md', 'report.json', 'reports', 'implementation-verification.md']) {
    assert.ok(!SUBAGENT_REFUSED_NAME.test(name), name);
  }
});

test('an agent step declaring a refused base name warns, naming the node, the path, the rule and a subject name', t => {
  const report = validate(definition(t, { uses: 'agent:information-gatherer', artifact: 'outputs/report.md' }));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  const [warning, ...rest] = named(report);
  assert.deepEqual(rest, []);
  assert.ok(warning.startsWith(`${CODE}nodes.gather.outputs.artifacts.notes:gather — outputs/report.md is written by a subagent`), warning);
  assert.match(warning, /starts with report, summary, findings or analysis and ends in \.md/);
  assert.match(warning, /such as outputs\/gather-report\.md$/);
});

test('only the base name counts: a matching folder is clean', t => {
  const report = validate(definition(t, { uses: 'agent:information-gatherer', artifact: 'analysis/gap-analysis.md' }));
  assert.deepEqual(named(report), []);
});

test('a direct step warns only when its brief names delegates for Claude Code', t => {
  const inline = validate(definition(t, { uses: 'direct:gather', artifact: 'analysis/findings.md' }));
  assert.deepEqual(named(inline), [], 'the main session writes an inline step\'s file');

  const listed = validate(definition(t, {
    uses: 'direct:gather', artifact: 'analysis/findings.md',
    brief: 'brief:\n  gather:\n    delegates: [information-gatherer]',
  }));
  assert.equal(named(listed).length, 1, JSON.stringify(listed.warnings));

  const copilotOnly = validate(definition(t, {
    uses: 'direct:gather', artifact: 'analysis/findings.md',
    brief: 'brief:\n  gather:\n    delegates:\n      copilot: [information-gatherer]',
  }));
  assert.deepEqual(named(copilotOnly), [], 'Copilot does not apply the rule');
});

test('no built-in definition declares a name a subagent cannot write', () => {
  for (const name of fs.readdirSync(path.join(ENGINE_DIR, 'workflows')).filter(each => each.endsWith('.yml'))) {
    assert.deepEqual(named(validate(path.join(ENGINE_DIR, 'workflows', name))), [], name);
  }
});
