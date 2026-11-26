import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { ENGINE_DIR, FIXTURES, delegating, freeze, reach, readDashboard, readState, scratch, sibling, verb, write } from '../helpers.mjs';
import { Refusal, scalar } from '../../plugins/maister/lib/canonical.mjs';
import { parse } from '../../plugins/maister/skills/workflow-engine/scripts/lib/state-read.mjs';

// A person's task text, and every input a person types, is stored exactly as
// written and read back exactly by every reader: no character in it is a
// reason to refuse the write, so nothing ever pushes a session to reword it.

const DEVELOPMENT = path.join(ENGINE_DIR, 'workflows/development.yml');
const RESEARCH = path.join(ENGINE_DIR, 'workflows/research.yml');
const MOCKUP = path.join(ENGINE_DIR, 'workflows/mockup-studio.yml');

const ONE_LINE = [
  'Print the tally as {"total": n} when asked',
  'Say "nothing running" when no task is open',
  "It's the reviewer's call",
  'Write the report under docs\\reports',
  'Keep C:\\work\\a,b: c and "quote" both',
  'A path ending in a backslash\\',
  'An escaped backslash before a quote \\\\" # still one value',
  '{"total": n}',
  '[UI] rename {a} and {b}',
  '[a, b]',
  '# not a comment',
  'key: value inside',
  '- a leading dash',
  '-x',
  'true',
  '42',
];

const MULTI_LINE = [
  'First line\nsecond line with "quotes"\n- a list item\n  indented: yes',
  'Windows line ends\r\nkept as typed\r\n',
  'A tab\there and a separator\u2028inside',
];

const TEXTS = [...ONE_LINE, ...MULTI_LINE];

/** A development run frozen with `text` as its title, description and task input. */
function frozenWith(t, text) {
  const run = scratch(t);
  freeze(run, {
    definition: DEVELOPMENT,
    task: { title: text, description: text },
    inputs: { task_description: text },
  });
  return run;
}

function stateLine(run, key) {
  return fs.readFileSync(run.state, 'utf8').split('\n').find(line => line.startsWith(`  ${key}:`));
}

/** The `with:` line for `key` in a brief, its value as printed. */
function withValue(stdout, key) {
  const line = stdout.split('\n').find(each => each.startsWith(`- ${key}: `));
  assert.ok(line !== undefined, `the brief prints ${key}`);
  return line.slice(`- ${key}: `.length);
}

test('person text: the emitter spells it on one line and the shared reader gives it back exactly', () => {
  for (const text of TEXTS) {
    const line = `  description: ${scalar(text, 'task.description', { text: true })}`;
    assert.equal(line.includes('\n') || line.includes('\r'), false, JSON.stringify(text));
    assert.equal(parse(`task:\n${line}\n`).task.description, text, JSON.stringify(text));
  }
});

test('person text: a value the strict emitter accepts keeps its bytes, and the strict emitter still refuses a quote', () => {
  for (const text of ['Add a page', 'plain', 'docs\\reports', "it's", '']) {
    assert.equal(scalar(text, 'x', { text: true }), scalar(text, 'x'), JSON.stringify(text));
  }
  assert.throws(() => scalar('the "Save" button', 'orchestrator.options.note'), error => error instanceof Refusal && error.code === 'value-not-flow-safe');
});

test('intake: a task text with quotes, backslashes, brackets and line breaks is written and read back exactly', t => {
  for (const text of TEXTS) {
    const run = frozenWith(t, text);
    const state = readState(run);
    assert.equal(state.task.title, text, JSON.stringify(text));
    assert.equal(state.task.description, text, JSON.stringify(text));
    assert.equal(state.orchestrator.options.inputs.task_description, text, JSON.stringify(text));

    // A later write leaves the person's text where it was, byte for byte.
    const description = stateLine(run, 'description');
    write(run, { orchestrator: { options: { html_output: false } } });
    assert.equal(stateLine(run, 'description'), description, JSON.stringify(text));
    const again = readState(run);
    assert.equal(again.orchestrator.options.inputs.task_description, text, JSON.stringify(text));
    assert.equal(again.orchestrator.options.html_output, false);
  }
});

test('node-brief: a one-line task text is printed as written; a multi-line one as a JSON string, with a note', t => {
  for (const text of ONE_LINE) {
    const result = verb(['node-brief', `--state=${frozenWith(t, text).state}`, '--node=gap-analysis']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(withValue(result.stdout, 'task_description'), text, JSON.stringify(text));
    assert.doesNotMatch(result.stdout, /^note: task_description spans lines/m);
  }
  for (const text of MULTI_LINE) {
    const result = verb(['node-brief', `--state=${frozenWith(t, text).state}`, '--node=gap-analysis']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(withValue(result.stdout, 'task_description')), text, JSON.stringify(text));
    assert.match(result.stdout, /^note: task_description spans lines, so it is written as a JSON string; pass it on decoded, word for word$/m);
  }
});

test('run-context, gate-brief and the dashboard read a run whose task text carries every awkward character', t => {
  for (const text of TEXTS) {
    const run = frozenWith(t, text);
    const context = verb(['run-context', `--state=${run.state}`, '--node=gap-analysis']);
    assert.equal(context.code, 0, context.stdout + context.stderr);
    reach(run, delegating({
      nodes: { 'gap-analysis': { status: 'completed', values: { has_reproducible_defect: false, mockups_needed: false, risk_level: 'low' } } },
      node_summaries: { 'gap-analysis': { headline: 'Scoped.', summary: text } },
    }, run));
    const gate = verb(['gate-brief', `--state=${run.state}`, '--node=gap-approval']);
    assert.equal(gate.code, 0, gate.stdout + gate.stderr);
    const oneline = verb(['gate-brief', `--state=${run.state}`, '--node=gap-approval', '--oneline']);
    assert.equal(oneline.code, 0, oneline.stdout + oneline.stderr);
    const dashboard = readDashboard(run);
    assert.ok(dashboard !== null, 'the freeze writes the dashboard projection');
    assert.equal(dashboard.task.title, text, JSON.stringify(text));
    assert.equal(dashboard.task.description, text, JSON.stringify(text));
  }
});

test('dashboard: the heading and the description are HTML-escaped, and the description keeps its line breaks', () => {
  const html = fs.readFileSync(path.join(ENGINE_DIR, '../orchestrator-framework/assets/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
  const from = html.indexOf('function esc(');
  assert.ok(from >= 0, 'the page defines esc');
  const context = vm.createContext({});
  vm.runInContext(`${html.slice(from, html.indexOf('\n}\n', from) + 3)}\nthis.esc = esc;`, context);
  assert.equal(context.esc('<b>&"x"</b> {"total": n}'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt; {&quot;total&quot;: n}');
  assert.match(html, /esc\(t\.title/);
  assert.match(html, /esc\(t\.description\)/);
  assert.match(html, /\.desc \{[^}]*white-space: pre-line/);
});

test('resume-check: a run written with such a task text resumes with its title exactly', t => {
  for (const text of TEXTS) {
    const run = frozenWith(t, text);
    const result = verb(['resume-check', `--state=${run.state}`]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.title, text, JSON.stringify(text));
  }
});

test('other typed inputs: a research question and a mockup note round-trip and reach their step exactly', t => {
  const question = 'Why does "status" print {"total": n} under docs\\reports?';
  const research = scratch(t, { type: 'research' });
  freeze(research, { definition: RESEARCH, task: { title: question, description: question }, inputs: { question } });
  assert.equal(readState(research).orchestrator.options.inputs.question, question);
  const foundation = verb(['node-brief', `--state=${research.state}`, '--node=research-foundation']);
  assert.equal(foundation.code, 0, foundation.stderr);
  assert.equal(withValue(foundation.stdout, 'question'), question);

  const note = 'Add a "Run" button\nand a [sidebar] {collapsed}';
  const mockup = scratch(t, { type: 'mockup-studio' });
  freeze(mockup, { definition: MOCKUP, inputs: { note, scope: 'home, "settings"' } });
  const inputs = readState(mockup).orchestrator.options.inputs;
  assert.equal(inputs.note, note);
  assert.equal(inputs.scope, 'home, "settings"');
  const turn = verb(['node-brief', `--state=${mockup.state}`, '--node=turn']);
  assert.equal(turn.code, 0, turn.stderr);
  assert.equal(JSON.parse(withValue(turn.stdout, 'note')), note);
});

test('sub-run: a child run frozen with the task text its parent passes on reads it back exactly', t => {
  const parent = scratch(t);
  freeze(parent);
  fs.mkdirSync(path.join(parent.dir, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(parent.dir, 'analysis/report.md'), '');
  write(parent, delegating({
    nodes: {
      analysis: { status: 'completed' },
      approval: { status: 'completed' },
      implementation: { status: 'completed' },
      research: { status: 'running' },
    },
  }));
  const text = 'What did "done" leave open in docs\\reports?\n- {"total": n}';
  const child = sibling(parent, { type: 'research', name: '2026-01-05-open-questions' });
  freeze(child, {
    definition: RESEARCH,
    task: { title: text, description: text },
    inputs: { question: text, embedded: true },
    orchestrator: { driver: { kind: 'terminal' }, parent: { run: parent.path, node: 'research' } },
  });
  const state = readState(child);
  assert.equal(state.task.description, text);
  assert.deepEqual(state.orchestrator.options.inputs, { question: text, embedded: true });
});

test('an earlier beta state file still reads, resumes and takes a write', t => {
  const run = scratch(t, { name: '2026-09-30-free-delivery-threshold-per-country' });
  fs.copyFileSync(path.join(FIXTURES, 'runs/free-delivery-threshold/recorded-state.yml'), run.state);
  const before = readState(run);
  const result = verb(['resume-check', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(JSON.parse(result.stdout).title, before.task.title);
  const brief = verb(['node-brief', `--state=${run.state}`, '--node=gap-analysis']);
  assert.equal(brief.code, 0, brief.stderr);
  assert.equal(withValue(brief.stdout, 'task_description'), before.orchestrator.options.inputs.task_description);

  const text = 'Ship "free delivery" over {"threshold": n} per country';
  write(run, { task: { description: text }, orchestrator: { options: { inputs: { ...before.orchestrator.options.inputs, task_description: text } } } });
  const after = readState(run);
  assert.equal(after.task.description, text);
  assert.equal(after.orchestrator.options.inputs.task_description, text);
  assert.equal(after.task.title, before.task.title);
  assert.deepEqual(after.workflow.nodes, before.workflow.nodes);
});

test('an earlier state file with a raw line separator inside its task text still reads and resumes', t => {
  const run = scratch(t, { name: '2026-09-30-free-delivery-threshold-per-country' });
  const recorded = fs.readFileSync(path.join(FIXTURES, 'runs/free-delivery-threshold/recorded-state.yml'), 'utf8');
  const text = 'Free delivery\u2028over a threshold';
  const edited = recorded.replace(/^ {2}description: .*$/m, `  description: "${text}"`);
  assert.notEqual(edited, recorded, 'the fixture carries a task description');
  fs.writeFileSync(run.state, edited);
  assert.equal(readState(run).task.description, text);
  const result = verb(['resume-check', `--state=${run.state}`]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
