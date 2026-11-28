// The engine-turn benchmark's script (`tools/engine-turns.mjs`), run as a child process on small
// transcripts this test writes for each host: a Claude Code session file with one subagent file
// beside it, and a Copilot CLI events file. Each holds one run of the benchmark story twice over —
// today's form, where every step opens on a `node-brief` call, and the form where a closing write
// prints `skipped:` lines and the next step's brief after its `next:` line. Nothing in them is real:
// the prompt, the results and the session id are made up, and none of them may reach the output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, run } from '../helpers.mjs';

const SCRIPT = path.join(ROOT, 'tools/engine-turns.mjs');
const PROMPT = 'please run the story about zebra-quokka';
const SESSION_ID = 'sess-7f3a-okapi';
const RESULT_WORD = 'narwhal-result';
const MODEL = 'model-large';
const SUB_MODEL = 'model-small';

/** A scratch folder, removed when the test ends. Its path must never reach the output. */
function scratchDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-turns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------- the run, host-neutral

/**
 * The story's run as a list of turns, each a list of calls. `form` is `brief-call` (today: every
 * step opens on `node-brief`) or `next-brief` (a closing write prints the next step's brief).
 * `gate` is `question` (a question-tool call) or `request` (a `gate-request` engine call).
 */
function story(dir, { form, gate }) {
  const engineFile = path.join(dir, 'plugin', 'skills', 'workflow-engine', 'scripts', 'workflow.mjs');
  const state = path.join(dir, '.maister', 'tasks', 'benchmark', '2026-01-05-turn-cost', 'orchestrator-state.yml');
  const engine = (args, result) => ({ kind: 'engine', command: `node "${engineFile}" ${args} --state="${state}"`, result });
  const write = (file, result = 'written') => ({ kind: 'write', file: path.join(dir, file), result });
  const asked = node => gate === 'question'
    ? { kind: 'question', result: `continue ${RESULT_WORD}` }
    : engine(`gate-request --node=${node}`, `request written ${RESULT_WORD}`);
  const explore = { kind: 'agent', agentType: 'Explore', result: `places ${RESULT_WORD}`, sub: [
    [{ kind: 'search', result: `src/parser.js ${RESULT_WORD}` }],
    [],
  ] };
  const closing = { kind: 'engine', command: `node "${engineFile}" write-state --state="${state}" <<'EOF'\n{"task": {"status": "completed"}}\nEOF`, result: 'workflow.nodes\n' };
  const brief = id => `brief for ${id} ${RESULT_WORD}`;
  const oldNext = (id, title) => `workflow.nodes.${id}\ndashboard-data.js\n\nnext: ${id} (${title}) — run node-brief for it\n`;
  const end = 'workflow.nodes.wrap\n\nnext: none — write the closing patch with task.status, then run run-complete\n';
  const start = [
    [engine('locate', `located ${RESULT_WORD}`)],
    [engine('write-state', `started ${RESULT_WORD}\n`)],
    [engine('node-brief --node=intake', brief('intake'))],
    [write('analysis/intake.md')],
  ];
  const finish = [
    [closing],
    [engine('run-complete', `complete ${RESULT_WORD}`)],
    [],
  ];
  if (form === 'brief-call') {
    return [
      ...start,
      [engine('write-state', oldNext('context', 'Context'))],
      [engine('node-brief --node=context', 'its guard reads false: record it skipped')],
      [engine('write-state', oldNext('locate', 'Locate'))],
      [engine('node-brief --node=locate', brief('locate'))],
      [explore],
      [write('analysis/places.md')],
      [engine('write-state', oldNext('locate-approval', 'Approve the places'))],
      [engine('gate-brief --node=locate-approval', brief('locate-approval'))],
      [asked('locate-approval')],
      [engine('write-state', oldNext('checks', 'Run the checks'))],
      [engine('node-brief --node=checks', brief('checks'))],
      [{ kind: 'shell', command: 'npm test', result: `3 passing ${RESULT_WORD}` }],
      [engine('write-state', oldNext('checks-approval', 'Approve the checks'))],
      [engine('gate-brief --node=checks-approval', 'gate-guard-false: not asked')],
      [engine('write-state', oldNext('probe', 'Probe'))],
      [engine('node-brief --node=probe', brief('probe'))],
      [engine('subrun-handoff --node=probe', `child started ${RESULT_WORD}`)],
      [engine('write-state', oldNext('wrap', 'Wrap'))],
      [engine('node-brief --node=wrap', brief('wrap'))],
      [write('outputs/summary.md')],
      [engine('write-state', end)],
      ...finish,
    ];
  }
  // The words after the id are the parallel change's to settle; only the prefixes are read. The
  // brief that follows holds a `skipped:` and a `next:` line of its own, which must not count.
  const newNext = (id, title, skipped = []) =>
    `workflow.nodes\n${skipped.map(s => `skipped: ${s} (${s}) — its guard reads false\n`).join('')}next: ${id} (${title}) — its brief follows\n\n${brief(id)}\nskipped: decoy (Decoy) — quoted in the brief\nnext: decoy (Decoy)\n`;
  return [
    ...start,
    [engine('write-state --next', newNext('locate', 'Locate', ['context']))],
    [explore],
    [write('analysis/places.md')],
    [engine('write-state --next', newNext('locate-approval', 'Approve the places'))],
    [asked('locate-approval')],
    [engine('write-state --next', newNext('checks', 'Run the checks'))],
    [{ kind: 'shell', command: 'npm test', result: `3 passing ${RESULT_WORD}` }],
    [engine('write-state --next', newNext('probe', 'Probe', ['checks-approval']))],
    // No --node: the hand-off is read as the step the `next:` line named.
    [{ kind: 'engine', command: `node "${engineFile}" subrun-handoff --state="${state}"`, result: `child started ${RESULT_WORD}` }],
    [engine('write-state --next', newNext('wrap', 'Wrap'))],
    [write('outputs/summary.md')],
    [engine('write-state --next', end)],
    ...finish,
  ];
}

/** A turn's usage, different for every turn so a miscount shows. */
const usageOf = n => ({ input: 3 + n, cache_read: 1000 * n, cache_write: 200 + n, output: 40 + 7 * n, thinking: 5 + n });

function addTotals(totals, model, u) {
  const m = totals[model] || (totals[model] = { requests: 0, input: 0, cache_read: 0, cache_write: 0, output: 0, thinking: 0 });
  m.requests++;
  for (const k of ['input', 'cache_read', 'cache_write', 'output', 'thinking']) m[k] += u[k];
}

function clock() {
  let at = Date.parse('2026-01-05T09:00:00.000Z');
  return () => new Date((at += 1000)).toISOString();
}

// ---------------------------------------------------------------- Claude Code

const CLAUDE_TOOL = {
  engine: c => ['Bash', { command: c.command, description: 'Engine call' }],
  shell: c => ['Bash', { command: c.command }],
  write: c => ['Write', { file_path: c.file, content: `text ${RESULT_WORD}` }],
  question: () => ['AskUserQuestion', { questions: [{ question: `Continue ${RESULT_WORD}?`, options: [] }] }],
  agent: c => ['Agent', { subagent_type: c.agentType, prompt: `find the places ${PROMPT}` }],
  search: () => ['Grep', { pattern: RESULT_WORD }],
};

/** One Claude Code session file: one record per content block, usage repeated on each. */
function claudeRecords(turns, { model, tick, ids, totals, onAgent }) {
  const records = [];
  const base = { sessionId: SESSION_ID, version: '9.9.9', cwd: '/home/someone/project' };
  records.push({ ...base, type: 'user', uuid: `u-${ids.n}`, timestamp: tick(), message: { role: 'user', content: PROMPT } });
  for (const calls of turns) {
    const n = ++ids.n;
    const u = usageOf(n);
    addTotals(totals, model, u);
    const usage = { input_tokens: u.input, cache_read_input_tokens: u.cache_read, cache_creation_input_tokens: u.cache_write, output_tokens: u.output, output_tokens_details: { thinking_tokens: u.thinking } };
    records.push({ type: 'api-request', id: `req-${n}`, timestamp: tick() });
    const block = content => records.push({ ...base, type: 'assistant', uuid: `a-${n}-${records.length}`, requestRef: `req-${n}`, timestamp: tick(), message: { id: `msg-${n}`, model, role: 'assistant', usage, content: [content] } });
    block({ type: 'thinking', thinking: '' });
    if (!calls.length) block({ type: 'text', text: `done ${RESULT_WORD}` });
    calls.forEach((call, i) => {
      const [name, input] = CLAUDE_TOOL[call.kind](call);
      const id = `tool-${n}-${i}`;
      block({ type: 'tool_use', id, name, input });
      const result = { ...base, type: 'user', uuid: `r-${n}-${i}`, timestamp: tick(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: call.result }] } };
      if (call.kind === 'agent') result.toolUseResult = { agentId: onAgent(call, id), totalToolUseCount: call.sub.length };
      records.push(result);
    });
  }
  return records;
}

const jsonl = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';

function claudeTranscript(dir, turns) {
  const tick = clock();
  const ids = { n: 0 };
  const totals = {};
  const file = path.join(dir, `${SESSION_ID}.jsonl`);
  const agents = path.join(dir, SESSION_ID, 'subagents');
  let agentCount = 0;
  const onAgent = (call, toolUseId) => {
    const agentId = `a${++agentCount}`;
    fs.mkdirSync(agents, { recursive: true });
    const sub = claudeRecords(call.sub, { model: SUB_MODEL, tick, ids, totals, onAgent });
    fs.writeFileSync(path.join(agents, `agent-${agentId}.jsonl`), jsonl(sub));
    fs.writeFileSync(path.join(agents, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: call.agentType, toolUseId, modelNotNamed: true }));
    return agentId;
  };
  const records = claudeRecords(turns, { model: MODEL, tick, ids, totals, onAgent });
  const modelUsage = Object.fromEntries(Object.entries(totals).map(([m, u]) => [m, {
    inputTokens: u.input, cacheReadInputTokens: u.cache_read, cacheCreationInputTokens: u.cache_write, outputTokens: u.output, thinkingTokens: u.thinking,
  }]));
  records.push({ type: 'cost-state', sessionId: SESSION_ID, modelUsage, totalCostUSD: 0 });
  fs.writeFileSync(file, jsonl(records));
  return file;
}

// ---------------------------------------------------------------- Copilot CLI

const COPILOT_TOOL = {
  engine: c => ['bash', { command: c.command, description: 'Engine call' }],
  shell: c => ['bash', { command: c.command }],
  write: c => ['create', { path: c.file, file_text: `text ${RESULT_WORD}` }],
  question: () => ['ask_user', { question: `Continue ${RESULT_WORD}?`, choices: [] }],
  agent: c => ['task', { agent_type: c.agentType, prompt: `find the places ${PROMPT}` }],
  search: () => ['grep', { pattern: RESULT_WORD }],
};

/**
 * One Copilot events file: a subagent's events sit in it under a top-level `agentId`. `shape` is
 * the usage record's: `1.0.114` keys it by `usage.apiCallId`; `1.0.116` writes no such field, flags
 * `apiCallIdFromUsageId` and carries the message's `apiCallId` as `usage.accounting.usageId`.
 */
function copilotTranscript(dir, turns, shape = '1.0.114') {
  const tick = clock();
  const events = [];
  const totals = {};
  let n = 0, agents = 0;
  const event = (type, data, agentId) => events.push({ type, data, id: `ev-${events.length}`, timestamp: tick(), parentId: null, ...(agentId ? { agentId } : {}) });
  event('session.start', { sessionId: SESSION_ID, copilotVersion: '9.9.9', context: { cwd: '/home/someone/project' } });
  event('user.message', { content: PROMPT, source: 'user' });
  const thread = (list, model, agentId) => {
    for (const calls of list) {
      const id = ++n;
      const u = usageOf(id);
      addTotals(totals, model, u);
      event('assistant.turn_start', { turnId: String(id) }, agentId);
      const requests = calls.map((call, i) => {
        const [name, args] = COPILOT_TOOL[call.kind](call);
        return { toolCallId: `call-${id}-${i}`, name, arguments: args };
      });
      event('assistant.message', { apiCallId: `api-${id}`, messageId: `m-${id}`, model, content: calls.length ? '' : `done ${RESULT_WORD}`, reasoningText: 'x', toolRequests: requests }, agentId);
      const key = shape === '1.0.116' ? { accounting: { usageId: `api-${id}`, totalNanoAiu: 1 } } : { apiCallId: `api-${id}` };
      event('session.usage_record', { ...(shape === '1.0.116' ? { apiCallIdFromUsageId: true } : {}), usage: { ...key, model, inputTokens: u.input + u.cache_read + u.cache_write, cacheReadTokens: u.cache_read, cacheWriteTokens: u.cache_write, outputTokens: u.output, reasoningTokens: u.thinking, duration: 400, reasoningEffort: 'medium' } }, agentId);
      calls.forEach((call, i) => {
        const toolCallId = requests[i].toolCallId;
        event('tool.execution_start', { toolCallId }, agentId);
        if (call.kind === 'agent') {
          const sub = `sub-${++agents}`;
          event('subagent.started', { toolCallId, agentName: call.agentType, modelSelectionSource: 'default' }, sub);
          thread(call.sub, SUB_MODEL, sub);
          event('subagent.completed', { totalToolCalls: call.sub.flat().length }, sub);
        }
        event('tool.execution_complete', { toolCallId, success: true, result: { content: call.result } }, agentId);
      });
    }
  };
  thread(turns, MODEL, null);
  const modelMetrics = Object.fromEntries(Object.entries(totals).map(([m, u]) => [m, {
    requests: { count: u.requests },
    usage: { inputTokens: u.input + u.cache_read + u.cache_write, cacheReadTokens: u.cache_read, cacheWriteTokens: u.cache_write, outputTokens: u.output, reasoningTokens: u.thinking },
  }]));
  event('session.shutdown', { modelMetrics });
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, jsonl(events));
  return file;
}

// ---------------------------------------------------------------- running the script

const HOSTS = {
  claude: { host: 'claude', gate: 'question', transcript: claudeTranscript },
  copilot: { host: 'copilot', gate: 'request', transcript: copilotTranscript },
  'copilot 1.0.116': { host: 'copilot', gate: 'request', transcript: (dir, turns) => copilotTranscript(dir, turns, '1.0.116') },
};

/** Measure one form of the run on one host; returns the report, the table and the scratch folder. */
function measured(t, host, form, label = 'driver') {
  const dir = scratchDir(t);
  const file = HOSTS[host].transcript(dir, story(dir, { form, gate: HOSTS[host].gate }));
  const json = path.join(dir, 'report.json');
  const result = run(SCRIPT, ['measure', `--json=${json}`, `${label}=${file}`]);
  assert.equal(result.code, 0, result.stderr);
  return { dir, json, table: result.stdout, report: JSON.parse(fs.readFileSync(json, 'utf8')) };
}

const momentsOf = session => session.segments.map(s => (s.node ? `${s.moment} ${s.node}` : s.moment));

const SHARED = ['start', 'node intake', 'node locate', 'gate locate-approval', 'node checks', 'sub-run probe', 'node wrap', 'end'];

for (const host of Object.keys(HOSTS)) {
  test(`${host}: today's form opens each step on its brief call, and the session's own skips are steps of their own`, t => {
    const { report } = measured(t, host, 'brief-call');
    const main = report.sessions[0];
    assert.equal(report.schema, 2);
    assert.equal(main.host, HOSTS[host].host);
    assert.deepEqual(momentsOf(main), ['start', 'node intake', 'node context', 'node locate', 'gate locate-approval', 'node checks', 'gate checks-approval', 'sub-run probe', 'node wrap', 'end']);
    assert.equal(main.totals.engine_skips, 0);
    assert.equal(main.totals.engine_calls_by_verb['node-brief'], 6);
  });

  test(`${host}: the next-brief form opens each step on the write's next: line and counts the engine's skips`, t => {
    const { report } = measured(t, host, 'next-brief');
    const main = report.sessions[0];
    assert.deepEqual(momentsOf(main), SHARED);
    assert.equal(main.totals.engine_skips, 2, 'the skipped: lines before next:, never the ones in the brief');
    assert.equal(main.totals.engine_calls_by_verb['node-brief'], 1, 'only the first step after the first write');
    const byNode = Object.fromEntries(main.segments.map(s => [s.node ?? s.moment, s]));
    assert.deepEqual(byNode.intake.skipped, ['context']);
    assert.deepEqual(byNode.checks.skipped, ['checks-approval']);
    assert.equal(byNode.intake.engine_skips, 1);
    assert.equal(main.moments.node.engine_skips, 2);
  });

  test(`${host}: a gate opens on the ${HOSTS[host].gate === 'question' ? 'question-tool call' : 'gate request'} and a sub-run on the hand-off, in both forms`, t => {
    for (const form of ['brief-call', 'next-brief']) {
      const main = measured(t, host, form).report.sessions[0];
      const gate = main.segments.find(s => s.node === 'locate-approval');
      assert.equal(gate.moment, 'gate', form);
      assert.equal(gate.gate_mode, HOSTS[host].gate === 'question' ? 'terminal' : 'driven', form);
      const subRun = main.segments.find(s => s.node === 'probe');
      assert.equal(subRun.moment, 'sub-run', form);
      assert.equal(subRun.engine_calls_by_verb['subrun-handoff'], 1, form);
    }
  });

  test(`${host}: engine-only turns are the turns whose every call is an engine call`, t => {
    // Hand count over `story`: every turn but the work turns (a write, the agent, the shell, the
    // closing text) and, on the question-tool host, the question.
    const question = HOSTS[host].gate === 'question' ? 1 : 0;
    assert.equal(measured(t, host, 'brief-call').report.sessions[0].totals.engine_only_turns, 22 - question);
    assert.equal(measured(t, host, 'next-brief').report.sessions[0].totals.engine_only_turns, 13 - question);
  });

  test(`${host}: token totals equal the host's own totals record, and the subagent's turns count for the step that dispatched it`, t => {
    const { report, table } = measured(t, host, 'next-brief');
    const main = report.sessions[0];
    assert.equal(main.host_check.all_match, true, JSON.stringify(main.host_check));
    assert.equal(main.host_check.output_tokens_match, true);
    assert.match(table, /host totals check \([a-z.-]+\): every token kind matches/);
    const sub = report.sessions.find(s => s.kind === 'subagent');
    assert.equal(sub.agent_type, 'Explore');
    assert.deepEqual([sub.dispatched_by.moment, sub.dispatched_by.node], ['node', 'locate']);
    assert.equal(main.segments.find(s => s.node === 'locate').delegated.turns, 2);
    assert.equal(report.total.turns, main.totals.turns + sub.totals.turns);
    assert.ok(main.totals.tokens.output > 0 && main.totals.tokens.cache_read > 0, 'every usage record paired with its response');
    if (HOSTS[host].host === 'copilot') {
      // Generation time is each usage record's duration, which only a paired record gives.
      assert.equal(main.start_source, 'usage-duration');
      assert.equal(main.totals.gen_ms, 400 * main.totals.turns);
    }
    if (host === 'claude') {
      assert.notEqual(main.totals.output_tokens_if_summed_per_record, main.totals.tokens.output, 'usage repeats on every record of a response');
      assert.ok(main.totals.records > main.totals.turns);
    }
  });

  test(`${host}: nothing printed or saved holds a path, the prompt, a tool result or the session id`, t => {
    const { dir, json, table } = measured(t, host, 'next-brief');
    const saved = fs.readFileSync(json, 'utf8');
    for (const text of [table, saved]) {
      for (const secret of [dir, dir.split(path.sep).join('/'), 'zebra-quokka', RESULT_WORD, SESSION_ID, 'someone', 'orchestrator-state', 'parser']) {
        assert.ok(!text.includes(secret), `output holds ${secret}`);
      }
    }
  });
}

test('compare: a report against itself differs nowhere; the two forms differ by their brief calls', t => {
  const before = measured(t, 'claude', 'brief-call');
  const after = measured(t, 'claude', 'next-brief');
  const same = run(SCRIPT, ['compare', before.json, before.json]);
  assert.equal(same.code, 0, same.stderr);
  assert.equal(same.stdout, 'no difference in any compared metric\n');
  const diff = run(SCRIPT, ['compare', before.json, after.json]);
  assert.equal(diff.code, 0, diff.stderr);
  assert.match(diff.stdout, /^driver · verb node-brief · calls\s+6\s+1\s+-5\s+-83%$/m);
  assert.match(diff.stdout, /^driver · engine_skips\s+0\s+2\s+\+2\s+-$/m);
  assert.match(diff.stdout, /^driver · moment gate · turns /m);
});

test('compare: a report of another schema is refused', t => {
  const { dir, json } = measured(t, 'copilot', 'next-brief');
  const old = path.join(dir, 'schema-1.json');
  fs.writeFileSync(old, JSON.stringify({ ...JSON.parse(fs.readFileSync(json, 'utf8')), schema: 1 }));
  const result = run(SCRIPT, ['compare', old, json]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /both reports must be schema 2/);
});

test('measure: a file of neither host is refused without naming its path', t => {
  const dir = scratchDir(t);
  const file = path.join(dir, 'other.jsonl');
  fs.writeFileSync(file, '{"hello": 1}\n');
  const result = run(SCRIPT, ['measure', file]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /argument 1 is neither a Claude Code session file nor a Copilot events file/);
  assert.ok(!result.stderr.includes(dir));
});
