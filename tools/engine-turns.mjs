#!/usr/bin/env node
// engine-turns.mjs — measures model turns, tokens and time per node of a workflow-engine run
// from a host transcript: Claude Code's session .jsonl (with its subagents/ files) or
// Copilot CLI's events.jsonl. One file, Node >= 20, no packages. Contributor tooling: it is never
// shipped with the plugin. Its documentation is engine-turns.md beside it.
//
//   node tools/engine-turns.mjs measure [--json=<out.json>] [--table=<out.txt>] [--quiet]
//                                       [--host=claude|copilot] [--no-subagents]
//                                       [<label>=]<transcript> [[<label>=]<transcript> ...]
//   node tools/engine-turns.mjs compare <before.json> <after.json> [--table=<out.txt>] [--all]
//
// Nothing printed or saved holds a path, a prompt, a tool result or a session id: a session is
// keyed by the label given for it, a node by the id its brief call or a write's `next:` line named.

import fs from 'node:fs';
import path from 'node:path';

// 2: a step also opens on a write's `next: <id>` line, and engine-recorded skips are counted.
const SCHEMA = 2;

// ---------------------------------------------------------------- tool classification

const SHELL_TOOLS = new Set(['Bash', 'bash', 'powershell', 'PowerShell', 'shell']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'create', 'edit', 'apply_patch']);
const READ_TOOLS = new Set(['Read', 'view']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'grep', 'glob', 'LS']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'task']);
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ask_user']);
const SKILL_TOOLS = new Set(['Skill', 'skill']);

// The calls a session makes for the engine's sake, not for the node's work.
const PROTOCOL = new Set(['engine', 'patch', 'skill', 'wf-read']);

const slash = p => String(p || '').replace(/\\/g, '/');
const isPatchFile = p => /(^|\/)\.state-patch\.json$/.test(slash(p));
const isStateFile = p => /(^|\/)orchestrator-state\.yml$/.test(slash(p)) || /\/gates\/[^/]+\.request\.yml$/.test(slash(p));
const isWorkflowFile = p =>
  /\/\.maister\//.test(slash(p)) || /\/skills\/[^/]+\/(SKILL\.md$|references\/|workflows\/|scripts\/|assets\/)/.test(slash(p));

const SHELL_READ = /^\s*(grep|rg|cat|sed|head|tail|ls|wc|awk|less|more|type|Get-Content|Select-String|gc|sls)\b/;

/** Every `workflow.mjs <verb>` in a shell command, read from the part before a here-string. */
function engineInvocations(command) {
  const head = command.split(/<<<?/)[0];
  const re = /workflow\.mjs["']?\s+([a-z][a-z-]*)/g;
  const hits = [...head.matchAll(re)];
  return hits.map((m, i) => {
    const slice = head.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : head.length);
    const node = slice.match(/--node(?:=|\s+)["']?([A-Za-z0-9_.:-]+)/);
    const flags = [...new Set([...slice.matchAll(/\s(--[a-z][a-z-]*)/g)].map(x => x[1]))];
    return { verb: m[1], node: node ? node[1] : null, flags };
  });
}

const CLOSING_PATCH = /"task"\s*:\s*\{[^{}]*"status"\s*:\s*"(completed|stopped|failed)"/;

function classifyCall(name, input, lastPatch) {
  const args = input && typeof input === 'object' ? input : {};
  if (SHELL_TOOLS.has(name)) {
    const command = String(args.command ?? '');
    const invocations = engineInvocations(command);
    // A reference or a state file read through the shell is still a read of the engine's files.
    if (!invocations.length) return { cat: SHELL_READ.test(command) && isWorkflowFile(command) ? 'wf-read' : 'shell' };
    const first = invocations[0];
    const usesPatchFile = invocations.some(v => v.flags.includes('--patch-file'));
    return {
      cat: 'engine', verb: first.verb, node: first.node, flags: first.flags,
      verbs: invocations.map(v => v.verb),
      closing: CLOSING_PATCH.test(command) || (usesPatchFile && CLOSING_PATCH.test(lastPatch.text)),
    };
  }
  const file = args.file_path ?? args.path ?? args.notebook_path ?? '';
  if (WRITE_TOOLS.has(name)) {
    if (isPatchFile(file)) {
      const whole = args.content ?? args.file_text;
      if (typeof whole === 'string') lastPatch.text = whole;
      return { cat: 'patch' };
    }
    if (isStateFile(file)) return { cat: 'state-edit' };
    return { cat: 'write' };
  }
  if (READ_TOOLS.has(name)) return { cat: isWorkflowFile(file) ? 'wf-read' : 'read' };
  if (SEARCH_TOOLS.has(name)) return { cat: 'search' };
  if (AGENT_TOOLS.has(name)) {
    return { cat: 'agent', agentType: args.subagent_type ?? args.agent_type ?? null, modelNamed: typeof args.model === 'string' && args.model !== '' };
  }
  if (QUESTION_TOOLS.has(name)) return { cat: 'question' };
  if (SKILL_TOOLS.has(name)) return { cat: 'skill' };
  return { cat: 'other' };
}

/**
 * What an engine call's printed result adds: the `next:` line of a write, the `skipped:` lines
 * before it, the driver of a resume. Only the line prefixes are read, never the words after the
 * id, so a write that prints the next step's brief after its `next:` line reads the same as one
 * that asks for `node-brief`. A `skipped:` line counts only before the first `next:` line: what
 * follows it is the next step's brief.
 */
function readEngineResult(call, text) {
  if (call.cat !== 'engine' || typeof text !== 'string') return;
  const next = text.match(/^next: ([A-Za-z0-9_.:-]+)/m);
  if (next) call.next = next[1];
  const head = next ? text.slice(0, next.index) : text;
  const skipped = [...head.matchAll(/^skipped: ([A-Za-z0-9_.:-]+)/gm)].map(m => m[1]);
  if (skipped.length) call.skipped = skipped;
  if (call.verb === 'resume-check') {
    const driver = text.match(/"driver_kind":\s*"([a-z-]+)"/);
    if (driver) call.driverKind = driver[1];
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

/** The first word of a prompt when it is a marker or a slash command; never the prompt. */
function opener(text) {
  const s = String(text || '').trimStart();
  const m = s.match(/^(\/[a-z][\w:-]*)/) || s.match(/^([A-Z][A-Z-]{2,})\b/);
  return m ? m[1] : 'prompt';
}

// ---------------------------------------------------------------- reading

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line is skipped */ }
  }
  return out;
}

function detectHost(records) {
  for (const r of records.slice(0, 50)) {
    if (r && typeof r.type === 'string' && r.data && 'parentId' in r) return 'copilot';
    if (r && (r.type === 'user' || r.type === 'assistant') && r.message) return 'claude';
    if (r && r.sessionId && typeof r.type === 'string' && !r.data) return 'claude';
  }
  return null;
}

const newThread = (key, host) => ({
  key, host, label: null, kind: 'main', hostVersion: null, agentType: null, modelNamed: null,
  parentCallId: null, turns: [], prompts: [], compactions: [], hostTotals: null, driverKind: null,
  syntheticMessages: 0, hostReported: null,
});

const newTurn = (id, model) => ({
  id, model: model || 'unknown', effort: null, start: null, startSource: null, genEnd: null, records: 0,
  blocks: { thinking: 0, text: 0, tool_use: 0 }, calls: [],
  usage: { input: 0, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
  thinkingMs: 0, toolInputMs: 0, ttftMs: null,
});

// ---- Claude Code: one `assistant` record per content block; a response is the records sharing
// ---- `message.id`, and its usage is repeated on each of them.

function parseClaudeFile(file) {
  const records = readJsonl(file);
  const thread = newThread(path.resolve(file), 'claude');
  const requestStart = new Map();
  const byMessage = new Map();
  const pending = new Map();
  const lastPatch = { text: '' };
  let previous = null;
  for (const r of records) {
    if (r.version && !thread.hostVersion) thread.hostVersion = r.version;
    if (r.type === 'api-request' && r.id && r.timestamp) { requestStart.set(r.id, Date.parse(r.timestamp)); continue; }
    if (r.type === 'cost-state') { thread.hostTotals = r; continue; }
    if (!r.timestamp) continue;
    const t = Date.parse(r.timestamp);
    if (r.type === 'system' && r.subtype === 'compact_boundary') thread.compactions.push({ at: t });
    if (r.type === 'assistant' && r.message) {
      const m = r.message;
      if (m.model === '<synthetic>') { thread.syntheticMessages++; previous = t; continue; }
      const key = m.id || r.requestId || r.uuid;
      let turn = byMessage.get(key);
      if (!turn) {
        turn = newTurn(key, m.model);
        const asked = requestStart.get(r.requestRef);
        turn.start = asked ?? previous ?? t;
        turn.startSource = asked !== undefined ? 'api-request' : 'previous-record';
        turn.effort = r.effort ?? null;
        byMessage.set(key, turn);
        thread.turns.push(turn);
      }
      turn.records++;
      turn.genEnd = Math.max(turn.genEnd ?? t, t);
      turn.thinkingMs += r.thinkingDurationMs || 0;
      turn.toolInputMs += r.toolInputStreamMs || 0;
      const u = m.usage || {};
      if ((u.output_tokens || 0) >= turn.usage.output) {
        turn.usage = {
          input: u.input_tokens || 0,
          cache_read: u.cache_read_input_tokens || 0,
          cache_write: u.cache_creation_input_tokens || 0,
          output: u.output_tokens || 0,
          thinking: (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0,
        };
      }
      for (const b of m.content || []) {
        if (b.type === 'thinking' || b.type === 'redacted_thinking') turn.blocks.thinking++;
        else if (b.type === 'text') turn.blocks.text++;
        else if (b.type === 'tool_use') {
          turn.blocks.tool_use++;
          const call = { id: b.id, name: b.name, start: t, end: null, ok: null, ...classifyCall(b.name, b.input, lastPatch) };
          turn.calls.push(call);
          pending.set(b.id, call);
        }
      }
    } else if (r.type === 'user' && r.message) {
      const c = r.message.content;
      const results = Array.isArray(c) ? c.filter(b => b && b.type === 'tool_result') : [];
      if (results.length) {
        for (const b of results) {
          const call = pending.get(b.tool_use_id);
          if (!call) continue;
          call.end = t;
          call.ok = !b.is_error;
          readEngineResult(call, resultText(b.content));
          if (call.driverKind) thread.driverKind = call.driverKind;
          if (call.cat === 'agent' && r.toolUseResult && typeof r.toolUseResult === 'object') {
            call.agentId = r.toolUseResult.agentId ?? null;
            if (typeof r.toolUseResult.totalToolUseCount === 'number') call.hostToolUses = r.toolUseResult.totalToolUseCount;
          }
        }
      } else if (r.isCompactSummary) {
        thread.compactions.push({ at: t });
      } else if (!r.isMeta) {
        thread.prompts.push({ at: t, opener: opener(typeof c === 'string' ? c : resultText(c)) });
      }
    }
    previous = t;
  }
  return thread;
}

function parseClaude(file, { subagents }) {
  const main = parseClaudeFile(file);
  const threads = [main];
  if (path.basename(path.dirname(path.resolve(file))) === 'subagents') {
    main.kind = 'subagent';
    applyClaudeMeta(main, file);
    return threads;
  }
  if (!subagents) return threads;
  const dir = path.join(path.dirname(path.resolve(file)), path.basename(file).replace(/\.jsonl$/, ''), 'subagents');
  if (!fs.existsSync(dir)) return threads;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const child = parseClaudeFile(path.join(dir, name));
    child.kind = 'subagent';
    child.agentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    applyClaudeMeta(child, path.join(dir, name));
    threads.push(child);
  }
  // A subagent with no usable meta file is found through the agent id its parent's result names.
  const calls = new Map();
  for (const th of threads) for (const turn of th.turns) for (const call of turn.calls) if (call.agentId) calls.set(call.agentId, call.id);
  for (const th of threads) if (th.kind === 'subagent' && !th.parentCallId && calls.has(th.agentId)) th.parentCallId = calls.get(th.agentId);
  return threads;
}

function applyClaudeMeta(thread, file) {
  const metaFile = file.replace(/\.jsonl$/, '.meta.json');
  if (!fs.existsSync(metaFile)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    thread.agentType = meta.agentType ?? null;
    thread.parentCallId = meta.toolUseId ?? null;
    if (typeof meta.modelNotNamed === 'boolean') thread.modelNamed = !meta.modelNotNamed;
  } catch { /* an unreadable meta file leaves the thread unlinked */ }
}

// ---- Copilot CLI: one `assistant.message` per response, its usage in the `session.usage_record`
// ---- sharing `apiCallId`; a subagent's events sit in the same file under a top-level `agentId`.

function parseCopilot(file, { subagents }) {
  const records = readJsonl(file);
  const threads = new Map();
  const thread = agentId => {
    const key = agentId || 'main';
    if (!threads.has(key)) {
      const th = newThread(`${path.resolve(file)}#${key}`, 'copilot');
      if (agentId) { th.kind = 'subagent'; th.agentId = agentId; }
      th.lastPatch = { text: '' };
      threads.set(key, th);
    }
    return threads.get(key);
  };
  const main = thread(null);
  const usage = new Map();
  const calls = new Map();
  const turnStart = new Map();
  for (const r of records) {
    if (!r || !r.type || !r.timestamp) continue;
    const d = r.data || {};
    const t = Date.parse(r.timestamp);
    const th = thread(r.agentId);
    switch (r.type) {
      case 'session.start':
        main.hostVersion = d.copilotVersion ?? null;
        break;
      case 'user.message':
        if (!r.agentId && d.source !== 'memory' && !String(d.source || '').startsWith('agent-')) {
          th.prompts.push({ at: t, opener: opener(d.content) });
        }
        break;
      case 'assistant.turn_start':
        turnStart.set(th.key, t);
        break;
      case 'session.usage_record':
        if (d.usage && d.usage.apiCallId) usage.set(d.usage.apiCallId, { u: d.usage, at: t });
        break;
      case 'assistant.message': {
        const turn = newTurn(d.apiCallId || d.messageId || r.id, d.model);
        turn.records = 1;
        turn.start = turnStart.get(th.key) ?? t;
        turn.startSource = 'turn-start';
        turn.genEnd = t;
        if (d.reasoningText || d.reasoningOpaque) turn.blocks.thinking = 1;
        if (d.content) turn.blocks.text = 1;
        for (const req of d.toolRequests || []) {
          turn.blocks.tool_use++;
          const call = { id: req.toolCallId, name: req.name, start: t, end: null, ok: null, ...classifyCall(req.name, req.arguments, th.lastPatch) };
          turn.calls.push(call);
          calls.set(req.toolCallId, { call, th });
        }
        th.turns.push(turn);
        break;
      }
      case 'tool.execution_start': {
        const hit = calls.get(d.toolCallId);
        if (hit) hit.call.start = t;
        break;
      }
      case 'tool.execution_complete': {
        const hit = calls.get(d.toolCallId);
        if (!hit) break;
        hit.call.end = t;
        hit.call.ok = d.success !== false;
        readEngineResult(hit.call, resultText(d.result && d.result.content));
        if (hit.call.driverKind) hit.th.driverKind = hit.call.driverKind;
        break;
      }
      case 'subagent.started':
        th.parentCallId = d.toolCallId ?? null;
        th.agentType = d.agentName ?? d.agentType ?? null;
        th.modelNamed = d.modelSelectionSource ? d.modelSelectionSource === 'explicit_override' : null;
        break;
      case 'subagent.completed':
        th.hostReported = { tool_calls: d.totalToolCalls ?? null, tokens: d.totalTokens ?? null, duration_ms: d.durationMs ?? null };
        break;
      case 'session.compaction_complete': {
        const used = d.compactionTokensUsed || {};
        const read = used.cacheReadTokens || 0, write = used.cacheWriteTokens || 0;
        main.compactions.push({
          at: t, model: used.model ?? null, gen_ms: used.duration ?? null,
          tokens: { input: Math.max(0, (used.inputTokens || 0) - read - write), cache_read: read, cache_write: write, output: used.outputTokens || 0 },
        });
        break;
      }
      case 'session.shutdown':
        main.hostTotals = d;
        break;
      default:
    }
  }
  for (const th of threads.values()) {
    delete th.lastPatch;
    for (const turn of th.turns) {
      const hit = usage.get(turn.id);
      if (!hit) continue;
      const u = hit.u;
      const read = u.cacheReadTokens || 0, write = u.cacheWriteTokens || 0;
      turn.usage = {
        input: Math.max(0, (u.inputTokens || 0) - read - write),
        cache_read: read, cache_write: write, output: u.outputTokens || 0, thinking: u.reasoningTokens || 0,
      };
      turn.effort = u.reasoningEffort ?? null;
      turn.ttftMs = typeof u.timeToFirstTokenMs === 'number' ? Math.round(u.timeToFirstTokenMs) : null;
      if (typeof u.duration === 'number') {
        turn.genEnd = hit.at;
        turn.start = hit.at - u.duration;
        turn.startSource = 'usage-duration';
      }
    }
  }
  const all = [...threads.values()];
  for (const th of all) th.hostVersion = main.hostVersion;
  return subagents ? all : all.filter(th => th.kind === 'main');
}

// ---------------------------------------------------------------- turns: kind and time

function turnKind(turn) {
  const cats = new Set(turn.calls.map(c => c.cat));
  if (!cats.size) return 'text';
  const only = (...allowed) => [...cats].every(c => allowed.includes(c));
  if (only('engine')) return 'engine';
  if (only('patch')) return 'patch';
  if (only('engine', 'patch')) return 'engine+patch';
  if (only('skill')) return 'skill';
  if (only('wf-read')) return 'wf-read';
  if (only('state-edit')) return 'state-edit';
  if (cats.has('engine')) return 'mixed';
  return 'work';
}

/** The length of the union of intervals, so calls that ran side by side are counted once. */
function unionMs(intervals) {
  const sorted = intervals.filter(([a, b]) => b !== null && b >= a).sort((x, y) => x[0] - y[0]);
  let total = 0, from = null, to = null;
  for (const [a, b] of sorted) {
    if (to === null || a > to) { if (to !== null) total += to - from; from = a; to = b; } else if (b > to) to = b;
  }
  return to === null ? total : total + (to - from);
}

function finishTurn(turn) {
  turn.kind = turnKind(turn);
  turn.genMs = Math.max(0, (turn.genEnd ?? turn.start) - turn.start);
  const span = cat => unionMs(turn.calls.filter(c => (cat === 'tool' ? c.cat !== 'question' && c.cat !== 'agent' : c.cat === cat)).map(c => [c.start, c.end]));
  turn.toolMs = span('tool');
  turn.questionMs = span('question');
  turn.delegateMs = span('agent');
  // Calls of one response that did not wait for each other: a later call began before an earlier one ended.
  turn.overlap = turn.calls.some((c, i) => i > 0 && turn.calls.slice(0, i).some(p => p.end === null || c.start < p.end));
  turn.wallEnd = Math.max(turn.genEnd ?? turn.start, ...turn.calls.map(c => c.end ?? 0));
}

// ---------------------------------------------------------------- moments and nodes

function boundaryOf(call, current) {
  if (call.cat === 'question') return { moment: 'gate', node: current.node };
  if (call.cat !== 'engine') return null;
  switch (call.verb) {
    case 'resume-check': return { moment: 'resume', node: null };
    case 'node-brief': return call.node ? { moment: 'node', node: call.node } : null;
    case 'gate-brief':
      if (call.node === 'held-approval') return { moment: 'end', node: null };
      return { moment: 'gate', node: call.node ?? current.node };
    case 'gate-request': case 'gate-revise': case 'area-brief': case 'finding-brief':
      return { moment: 'gate', node: call.node ?? current.node };
    case 'subrun-path': case 'subrun-handoff':
      return { moment: 'sub-run', node: call.node ?? current.node };
    case 'run-complete': return { moment: 'end', node: null };
    case 'write-state': return call.closing ? { moment: 'end', node: null } : null;
    default: return null;
  }
}

/**
 * Cuts a session's turns into segments, one per moment of the run. A turn belongs to the segment
 * its first tool call falls in; each call keeps the segment in force when it was issued, so call
 * counts stay exact where one response crosses two nodes.
 */
function segment(thread) {
  const make = (moment, node) => ({ moment, node, turns: [], calls: [] });
  const segments = [make('pending', null)];
  let current = segments[0];
  let endNext = false;
  // The step a write's `next: <id>` line named. It opens as a step at the next turn; what follows
  // decides its kind: a `node-brief` for it changes nothing, a question-tool call or a gate call
  // makes it a gate, a hand-off call a sub-run — the merge pass below folds the step into either.
  let stepNext = null;
  const open = (moment, node) => {
    if (current.moment === moment && current.node === node) return;
    const before = current;
    current = make(moment, node);
    // A resume that follows a question remembers whose question it was.
    if (moment === 'resume' && before.moment === 'gate') current.resumedNode = before.node;
    segments.push(current);
  };
  // A question asked inside a step is a gate only until it is answered: the first call after the
  // answer that works on the project (not the engine's, not a question) is the step again.
  const backToStep = call => {
    if (PROTOCOL.has(call.cat) || call.cat === 'question' || call.cat === 'state-edit') return null;
    if (current.moment === 'gate' && current.node && current.answered) return current.node;
    if (current.moment === 'resume' && current.resumedNode) return current.resumedNode;
    return null;
  };
  for (const turn of thread.turns) {
    if (endNext) { open('end', null); endNext = false; }
    else if (stepNext) { open('node', stepNext); stepNext = null; }
    let own = null;
    turn.calls.forEach((call, i) => {
      const step = backToStep(call);
      const b = step ? { moment: 'node', node: step } : boundaryOf(call, current);
      if (b) {
        const before = current;
        open(b.moment, b.node);
        if (current !== before && i > 0) turn.spans = true;
      }
      if (call.cat === 'question') current.answered = true;
      if (i === 0) own = current;
      call.segment = current;
      current.calls.push(call);
      if (call.cat === 'engine' && call.next) {
        if (call.next === 'none') { endNext = true; stepNext = null; } else { stepNext = call.next; endNext = false; }
      }
      if (call.skipped) current.skipped = [...(current.skipped || []), ...call.skipped];
    });
    turn.segment = own ?? current;
    turn.segment.turns.push(turn);
  }
  // A step that only briefed itself before a gate or a sub-run call is that gate or sub-run.
  for (let i = segments.length - 1; i > 0; i--) {
    const s = segments[i], p = segments[i - 1];
    if ((s.moment === 'gate' || s.moment === 'sub-run') && p.moment === 'node' && p.node === s.node && p.calls.every(c => PROTOCOL.has(c.cat))) {
      for (const turn of p.turns) turn.segment = s;
      for (const call of p.calls) call.segment = s;
      s.turns.unshift(...p.turns);
      s.calls.unshift(...p.calls);
      if (p.skipped) s.skipped = [...p.skipped, ...(s.skipped || [])];
      segments.splice(i - 1, 1);
    }
  }
  // What came before the first brief: a start when it called the engine, the lead-in of a resume otherwise.
  const first = segments[0];
  if (first.moment === 'pending') {
    const engine = first.calls.some(c => c.cat === 'engine');
    const next = segments[1];
    if (!engine && next && next.moment === 'resume') {
      for (const turn of first.turns) turn.segment = next;
      for (const call of first.calls) call.segment = next;
      next.turns.unshift(...first.turns);
      next.calls.unshift(...first.calls);
      segments.shift();
    } else if (!first.turns.length && !first.calls.length && segments.length > 1) {
      segments.shift();
    } else {
      first.moment = engine ? 'start' : 'other';
    }
  }
  segments.forEach((s, i) => {
    if (s.moment === 'resume') s.after = i === 0 ? 'fresh' : segments[i - 1].moment;
    if (s.moment === 'gate') {
      const verbs = new Set(s.calls.filter(c => c.cat === 'engine').map(c => c.verb));
      s.gateMode = verbs.has('gate-request') ? 'driven' : s.calls.some(c => c.cat === 'question') ? 'terminal' : 'unasked';
      s.questionSet = s.calls.some(c => c.cat === 'engine' && /^(gate-|area-|finding-)/.test(c.verb) && c.flags.includes('--patch-file'));
    }
  });
  return segments;
}

// ---------------------------------------------------------------- sums

const bump = (obj, key, by = 1) => { obj[key] = (obj[key] || 0) + by; };

function sum(turns) {
  const s = {
    turns: turns.length, records: 0, engine_only_turns: 0, engine_or_patch_turns: 0, patch_file_turns: 0,
    multi_call_turns: 0, overlapping_call_turns: 0, spanning_turns: 0, tool_calls: 0, engine_calls: 0, state_edits: 0,
    // Steps the engine recorded as skipped, one per `skipped:` line a write printed.
    engine_skips: 0,
    by_kind: {}, engine_calls_by_verb: {}, engine_only_turns_by_verb: {},
    tokens: { input: 0, cache_read: 0, cache_write: 0, output: 0, thinking: 0 },
    output_tokens_engine_only: 0,
    // What a sum over transcript records would read on a host that repeats a response's usage on
    // each of its records — kept so a figure taken that way can be recognised, never as a measure.
    output_tokens_if_summed_per_record: 0,
    gen_ms: 0, gen_ms_engine_only: 0, tool_ms: 0, question_ms: 0, delegate_ms: 0, thinking_ms: 0, tool_input_ms: 0,
    models: {}, efforts: {},
  };
  for (const t of turns) {
    s.records += t.records;
    bump(s.by_kind, t.kind);
    const engine = t.calls.filter(c => c.cat === 'engine');
    if (t.kind === 'engine') {
      s.engine_only_turns++;
      s.output_tokens_engine_only += t.usage.output;
      s.gen_ms_engine_only += t.genMs;
      const verbs = new Set(engine.flatMap(c => c.verbs));
      bump(s.engine_only_turns_by_verb, verbs.size === 1 ? [...verbs][0] : '(several verbs)');
    }
    if (t.kind === 'engine' || t.kind === 'patch' || t.kind === 'engine+patch') s.engine_or_patch_turns++;
    if (t.calls.some(c => c.cat === 'patch')) s.patch_file_turns++;
    if (t.calls.length > 1) s.multi_call_turns++;
    if (t.overlap) s.overlapping_call_turns++;
    if (t.spans) s.spanning_turns++;
    s.tool_calls += t.calls.length;
    for (const c of engine) for (const v of c.verbs) { s.engine_calls++; bump(s.engine_calls_by_verb, v); }
    s.state_edits += t.calls.filter(c => c.cat === 'state-edit').length;
    for (const c of engine) s.engine_skips += c.skipped ? c.skipped.length : 0;
    for (const k of Object.keys(s.tokens)) s.tokens[k] += t.usage[k];
    s.output_tokens_if_summed_per_record += t.usage.output * t.records;
    s.gen_ms += t.genMs; s.tool_ms += t.toolMs; s.question_ms += t.questionMs; s.delegate_ms += t.delegateMs;
    s.thinking_ms += t.thinkingMs; s.tool_input_ms += t.toolInputMs;
    bump(s.models, t.model);
    if (t.effort) bump(s.efforts, t.effort);
  }
  return s;
}

/** Engine calls counted where they were issued, which differs from `sum` when a response crosses nodes. */
function callsByVerb(calls) {
  const out = {};
  for (const c of calls) if (c.cat === 'engine') for (const v of c.verbs) bump(out, v);
  return out;
}

function interactions(thread) {
  const prompts = thread.prompts.length ? thread.prompts : [{ at: thread.turns[0]?.start ?? 0, opener: 'prompt' }];
  return prompts.map((p, i) => {
    const until = i + 1 < prompts.length ? prompts[i + 1].at : Infinity;
    const turns = thread.turns.filter(t => t.genEnd >= p.at && t.genEnd < until);
    const s = sum(turns);
    const end = turns.length ? Math.max(...turns.map(t => t.wallEnd)) : p.at;
    // The lead-in, to two stop points: the first call that touches the project at all (anything
    // that is neither the engine's nor a read of its files), and the first act (a dispatch, a write,
    // a shell command or a question — reads and searches of the project do not end it).
    const leadTo = stops => {
      const lead = { turns: 0, engine_calls: 0, skill_loads: 0, workflow_reads: 0, patch_writes: 0, project_reads: 0, ms: null, reached: false };
      outer: for (const t of turns) {
        for (const c of t.calls) {
          if (stops(c)) { lead.ms = c.start - p.at; lead.reached = true; break outer; }
          if (c.cat === 'engine') lead.engine_calls += c.verbs.length;
          else if (c.cat === 'skill') lead.skill_loads++;
          else if (c.cat === 'wf-read') lead.workflow_reads++;
          else if (c.cat === 'patch') lead.patch_writes++;
          else lead.project_reads++;
        }
        lead.turns++;
      }
      if (!lead.reached) lead.ms = end - p.at;
      return lead;
    };
    const lead = leadTo(c => !PROTOCOL.has(c.cat) && c.cat !== 'read' && c.cat !== 'search');
    const touch = leadTo(c => !PROTOCOL.has(c.cat));
    return {
      n: i + 1, opener: p.opener, started: iso(p.at), ended: iso(end), active_ms: end - p.at,
      turns: s.turns, records: s.records, engine_only_turns: s.engine_only_turns, tool_calls: s.tool_calls,
      engine_calls: s.engine_calls, output_tokens: s.tokens.output, output_tokens_if_summed_per_record: s.output_tokens_if_summed_per_record, gen_ms: s.gen_ms, tool_ms: s.tool_ms, before_first_act: lead, before_first_project_touch: touch,
    };
  });
}

const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

// ---------------------------------------------------------------- the report

function report(threads) {
  for (const th of threads) th.turns.forEach(finishTurn);
  const callHome = new Map();
  for (const th of threads) {
    if (th.kind === 'main') th.segments = segment(th);
    for (const turn of th.turns) for (const call of turn.calls) callHome.set(call.id, { thread: th, turn, call });
  }
  // A subagent's turns belong to the node whose call dispatched it, through any depth of nesting.
  const homeOf = th => {
    for (let hop = th, depth = 0; hop && depth < 8; depth++) {
      const hit = hop.parentCallId ? callHome.get(hop.parentCallId) : null;
      if (!hit) return null;
      if (hit.thread.kind === 'main') return { parent: hit.thread, segment: hit.call.segment, via: hit.thread === th ? null : hit.thread, depth: depth + 1 };
      hop = hit.thread;
    }
    return null;
  };
  const sessions = threads.map(th => {
    const total = sum(th.turns);
    const first = th.turns[0], last = th.turns[th.turns.length - 1];
    const started = th.prompts[0]?.at ?? first?.start ?? null;
    const ended = last ? Math.max(...th.turns.map(t => t.wallEnd)) : started;
    const out = {
      label: th.label, named: Boolean(th.named), host: th.host, host_version: th.hostVersion, kind: th.kind,
      started: iso(started), ended: iso(ended), elapsed_ms: started !== null && ended !== null ? ended - started : 0,
      start_source: first?.startSource ?? null, driver_kind: th.driverKind, compactions: th.compactions.length,
      synthetic_messages: th.syntheticMessages,
      totals: total,
    };
    if (th.kind === 'subagent') {
      const home = homeOf(th);
      out.agent_type = th.agentType;
      out.model_named_on_dispatch = th.modelNamed;
      out.dispatched_by = home ? { session: home.parent.label, moment: home.segment.moment, node: home.segment.node, depth: home.depth } : null;
      if (th.hostReported) out.host_reported = th.hostReported;
      th.home = home;
    } else {
      out.interactions = interactions(th);
    }
    return out;
  });
  threads.forEach((th, i) => {
    if (th.kind !== 'main') return;
    const kids = threads.filter(k => k.kind === 'subagent' && k.home && k.home.parent === th);
    const withKids = sum([...th.turns, ...kids.flatMap(k => k.turns)]);
    sessions[i].subagents = { threads: kids.length, turns: withKids.turns - th.turns.length, labels: kids.map(k => k.label) };
    sessions[i].totals_with_subagents = withKids;
    sessions[i].segments = th.segments.map((s, n) => {
      const own = sum(s.turns);
      const delegated = kids.filter(k => k.home.segment === s);
      const row = {
        n: n + 1, moment: s.moment, node: s.node,
        ...(s.gateMode ? { gate_mode: s.gateMode, question_set: s.questionSet } : {}),
        ...(s.after ? { after: s.after } : {}),
        ...(s.skipped ? { skipped: s.skipped } : {}),
        started: iso(s.turns[0]?.start ?? null),
        ended: iso(s.turns.length ? Math.max(...s.turns.map(t => t.wallEnd)) : null),
        ...own,
        engine_calls: s.calls.filter(c => c.cat === 'engine').reduce((a, c) => a + c.verbs.length, 0),
        engine_calls_by_verb: callsByVerb(s.calls),
      };
      if (delegated.length) {
        const d = sum(delegated.flatMap(k => k.turns));
        row.delegated = { threads: delegated.length, labels: delegated.map(k => k.label), agent_types: delegated.map(k => k.agentType), ...d };
      }
      return row;
    });
    sessions[i].moments = rollup(sessions[i].segments, s => s.moment);
    sessions[i].nodes = rollup(sessions[i].segments.filter(s => s.node), s => s.node);
    sessions[i].host_check = hostCheck(th, kids);
  });
  const all = sum(threads.flatMap(th => th.turns));
  return { schema: SCHEMA, tool: 'engine-turns', sessions, total: all };
}

const ROLL = ['turns', 'records', 'engine_only_turns', 'engine_or_patch_turns', 'patch_file_turns', 'tool_calls', 'engine_calls', 'engine_skips', 'gen_ms', 'tool_ms', 'question_ms', 'delegate_ms'];

function rollup(segments, keyOf) {
  const out = {};
  for (const s of segments) {
    const k = keyOf(s);
    const r = out[k] || (out[k] = { segments: 0, ...Object.fromEntries(ROLL.map(m => [m, 0])), output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, delegated_turns: 0, delegated_output_tokens: 0, delegated_gen_ms: 0 });
    r.segments++;
    for (const m of ROLL) r[m] += s[m];
    r.output_tokens += s.tokens.output; r.thinking_tokens += s.tokens.thinking;
    r.cache_read_tokens += s.tokens.cache_read; r.cache_write_tokens += s.tokens.cache_write;
    if (s.delegated) { r.delegated_turns += s.delegated.turns; r.delegated_output_tokens += s.delegated.tokens.output; r.delegated_gen_ms += s.delegated.gen_ms; }
  }
  return out;
}

/** The host's own totals beside this script's, per model, so a miscount shows on the first run. */
function hostCheck(main, kids) {
  const measured = {};
  for (const th of [main, ...kids]) for (const t of th.turns) {
    const m = measured[t.model] || (measured[t.model] = { requests: 0, input: 0, cache_read: 0, cache_write: 0, output: 0, thinking: 0 });
    m.requests++;
    for (const k of ['input', 'cache_read', 'cache_write', 'output', 'thinking']) m[k] += t.usage[k];
  }
  const totals = main.hostTotals;
  if (!totals) return { source: null, note: 'the transcript holds no totals record', measured };
  const host = {};
  if (main.host === 'claude') {
    for (const [model, u] of Object.entries(totals.modelUsage || {})) {
      host[model] = { input: u.inputTokens || 0, cache_read: u.cacheReadInputTokens || 0, cache_write: u.cacheCreationInputTokens || 0, output: u.outputTokens || 0, thinking: u.thinkingTokens || 0 };
    }
  } else {
    for (const [model, mm] of Object.entries(totals.modelMetrics || {})) {
      const u = mm.usage || {};
      const read = u.cacheReadTokens || 0, write = u.cacheWriteTokens || 0;
      host[model] = { requests: mm.requests?.count ?? null, input: Math.max(0, (u.inputTokens || 0) - read - write), cache_read: read, cache_write: write, output: u.outputTokens || 0, thinking: u.reasoningTokens || 0 };
    }
  }
  const same = Object.keys(host).length > 0 && Object.entries(host).every(([model, h]) => measured[model] && ['input', 'cache_read', 'cache_write', 'output'].every(k => h[k] === measured[model][k]));
  return { source: main.host === 'claude' ? 'cost-state' : 'session.shutdown', output_tokens_match: Object.entries(host).every(([m, h]) => measured[m] && measured[m].output === h.output), all_match: same, host, measured };
}

// ---------------------------------------------------------------- tables

const num = n => (n ?? 0).toLocaleString('en-US');
function dur(ms) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 59950) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s - m * 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
const pairs = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-';

function grid(head, rows) {
  const all = [head, ...rows].map(r => r.map(c => String(c ?? '')));
  const width = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  const numeric = head.map((_, i) => all.slice(1).every(r => /^[\d.,%smh+-]*$/.test(r[i])));
  const line = r => r.map((c, i) => (numeric[i] ? c.padStart(width[i]) : c.padEnd(width[i]))).join('  ').trimEnd();
  return [line(all[0]), width.map(w => '-'.repeat(w)).join('  '), ...all.slice(1).map(line)].join('\n');
}

function table(rep) {
  const out = [];
  for (const s of rep.sessions) {
    // A subagent nobody named is a row under its parent, not a section of its own.
    if (s.kind === 'subagent' && !s.named && s.dispatched_by) continue;
    const t = s.totals;
    out.push(`== ${s.label} — ${s.host === 'claude' ? 'Claude Code' : 'Copilot CLI'} ${s.host_version ?? ''}, ${s.kind}${s.agent_type ? ` (${s.agent_type})` : ''}`);
    if (s.dispatched_by) out.push(`dispatched by: ${s.dispatched_by.session} · ${s.dispatched_by.moment}${s.dispatched_by.node ? ` ${s.dispatched_by.node}` : ''} · model named on the call: ${s.model_named_on_dispatch === null ? 'unknown' : s.model_named_on_dispatch ? 'yes' : 'no'}`);
    out.push(`model: ${pairs(t.models)} · effort: ${pairs(t.efforts)}${s.driver_kind ? ` · driver: ${s.driver_kind}` : ''}${s.compactions ? ` · compactions: ${s.compactions}` : ''}`);
    out.push(`turns ${t.turns} (transcript records ${t.records}) · engine-only ${t.engine_only_turns} · engine or patch only ${t.engine_or_patch_turns} · holding a patch-file write ${t.patch_file_turns} · several calls in one turn ${t.multi_call_turns} (calls overlapped in ${t.overlapping_call_turns})`);
    out.push(`turn kinds: ${pairs(t.by_kind)}`);
    out.push(`tool calls ${t.tool_calls} · engine calls ${t.engine_calls} · steps the engine skipped ${t.engine_skips} · hand edits of state files ${t.state_edits}`);
    out.push(`tokens: input ${num(t.tokens.input)} · cache read ${num(t.tokens.cache_read)} · cache write ${num(t.tokens.cache_write)} · output ${num(t.tokens.output)} (thinking ${num(t.tokens.thinking)}) · output on engine-only turns ${num(t.output_tokens_engine_only)}`);
    if (t.output_tokens_if_summed_per_record !== t.tokens.output) out.push(`  (summed per transcript record instead of per response, output would read ${num(t.output_tokens_if_summed_per_record)} — a double count)`);
    out.push(`time: generation ${dur(t.gen_ms)} (engine-only turns ${dur(t.gen_ms_engine_only)}) · tools ${dur(t.tool_ms)} · questions ${dur(t.question_ms)} · waiting on agents ${dur(t.delegate_ms)} · first prompt to last act ${dur(s.elapsed_ms)}`);
    if (s.host_reported) out.push(`host's own count for this agent: tool calls ${s.host_reported.tool_calls ?? '-'}, tokens ${num(s.host_reported.tokens)}, ${dur(s.host_reported.duration_ms)}`);
    if (s.subagents && s.subagents.threads) {
      const w = s.totals_with_subagents;
      out.push(`with its ${s.subagents.threads} subagent(s): turns ${w.turns} · output ${num(w.tokens.output)} · generation ${dur(w.gen_ms)}`);
    }
    if (s.host_check) out.push(`host totals check (${s.host_check.source ?? 'none'}): ${s.host_check.source ? (s.host_check.all_match ? 'every token kind matches' : s.host_check.output_tokens_match ? 'output tokens match, another kind differs' : 'differs — see the JSON') : s.host_check.note}`);
    if (s.subagents && s.subagents.threads) {
      const kids = s.subagents.labels.map(l => rep.sessions.find(k => k.label === l)).filter(Boolean);
      out.push('', 'subagents (turns of their own, attributed to the node that dispatched them)');
      out.push(grid(['label', 'agent', 'node', 'model', 'model named', 'effort', 'turns', 'tool calls', 'engine calls', 'output', 'thinking', 'generation', 'tools'],
        kids.map(k => [k.label, k.agent_type ?? '-', k.dispatched_by.node ?? `(${k.dispatched_by.moment})`, Object.keys(k.totals.models).join('+'), k.model_named_on_dispatch === null ? '?' : k.model_named_on_dispatch ? 'yes' : 'no', Object.keys(k.totals.efforts).join('+') || '-', k.totals.turns, k.totals.tool_calls, k.totals.engine_calls, num(k.totals.tokens.output), num(k.totals.tokens.thinking), dur(k.totals.gen_ms), dur(k.totals.tool_ms)])));
    }
    out.push('', 'engine calls by verb (calls · turns that called nothing else)');
    const verbs = Object.keys({ ...t.engine_calls_by_verb, ...t.engine_only_turns_by_verb }).sort((a, b) => (t.engine_calls_by_verb[b] || 0) - (t.engine_calls_by_verb[a] || 0));
    out.push(verbs.length ? grid(['verb', 'calls', 'engine-only turns'], verbs.map(v => [v, t.engine_calls_by_verb[v] || 0, t.engine_only_turns_by_verb[v] || 0])) : '(none)');
    if (s.interactions) {
      out.push('', 'interactions (a prompt and every turn it led to)');
      out.push(grid(['#', 'opener', 'turns', 'records', 'engine-only', 'engine calls', 'output', 'generation', 'tools', 'active', 'before first act: turns', 'engine calls', 'skill loads', 'workflow reads', 'time'],
        s.interactions.map(i => [i.n, i.opener, i.turns, i.records, i.engine_only_turns, i.engine_calls, num(i.output_tokens), dur(i.gen_ms), dur(i.tool_ms), dur(i.active_ms), i.before_first_act.turns, i.before_first_act.engine_calls, i.before_first_act.skill_loads, i.before_first_act.workflow_reads, i.before_first_act.reached ? dur(i.before_first_act.ms) : 'no act'])));
    }
    if (s.segments) {
      out.push('', 'moments in order');
      out.push(grid(['#', 'moment', 'node', 'turns', 'engine-only', 'patch', 'engine calls', 'output', 'thinking', 'generation', 'tools', 'agent turns', 'agent output', 'verbs'],
        s.segments.map(g => [g.n, g.moment + (g.gate_mode ? ` (${g.gate_mode})` : '') + (g.after ? (g.after === 'fresh' ? ' (new session)' : ` (after ${g.after})`) : ''), g.node ?? '-', g.turns, g.engine_only_turns, g.patch_file_turns, g.engine_calls, num(g.tokens.output), num(g.tokens.thinking), dur(g.gen_ms), dur(g.tool_ms), g.delegated ? g.delegated.turns : '', g.delegated ? num(g.delegated.tokens.output) : '', pairs(g.engine_calls_by_verb)])));
      out.push('', 'by moment');
      out.push(grid(['moment', 'times', 'turns', 'engine-only', 'engine calls', 'output', 'generation', 'tools', 'agent turns'],
        Object.entries(s.moments).map(([k, m]) => [k, m.segments, m.turns, m.engine_only_turns, m.engine_calls, num(m.output_tokens), dur(m.gen_ms), dur(m.tool_ms), m.delegated_turns || ''])));
    }
    out.push('');
  }
  const t = rep.total;
  out.push(`== all sessions, each counted once`);
  out.push(`turns ${t.turns} (records ${t.records}) · engine-only ${t.engine_only_turns} · engine calls ${t.engine_calls} · output ${num(t.tokens.output)} (thinking ${num(t.tokens.thinking)}) · cache read ${num(t.tokens.cache_read)} · cache write ${num(t.tokens.cache_write)} · generation ${dur(t.gen_ms)} · tools ${dur(t.tool_ms)}`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- compare

function flatten(rep) {
  const flat = new Map();
  const put = (key, v) => { if (typeof v === 'number') flat.set(key, v); };
  const core = (prefix, s) => {
    for (const m of ['turns', 'engine_only_turns', 'engine_or_patch_turns', 'patch_file_turns', 'tool_calls', 'engine_calls', 'engine_skips', 'gen_ms', 'tool_ms']) put(`${prefix} · ${m}`, s[m]);
    if (s.tokens) for (const k of ['output', 'thinking', 'cache_read', 'cache_write', 'input']) put(`${prefix} · tokens.${k}`, s.tokens[k]);
    for (const k of ['output_tokens', 'thinking_tokens', 'cache_read_tokens', 'cache_write_tokens', 'delegated_turns', 'delegated_output_tokens']) put(`${prefix} · ${k}`, s[k]);
  };
  core('all sessions', rep.total);
  for (const s of rep.sessions) {
    core(`${s.label}`, s.totals);
    for (const [v, n] of Object.entries(s.totals.engine_calls_by_verb)) put(`${s.label} · verb ${v} · calls`, n);
    for (const [m, r] of Object.entries(s.moments || {})) core(`${s.label} · moment ${m}`, r);
    for (const [n, r] of Object.entries(s.nodes || {})) core(`${s.label} · node ${n}`, r);
  }
  return flat;
}

function compare(before, after, { all }) {
  const a = flatten(before), b = flatten(after);
  const rows = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? 0, y = b.get(key) ?? 0;
    if (!all && x === y) continue;
    const ms = key.endsWith('_ms');
    const show = v => (ms ? dur(v) : num(v));
    const delta = y - x;
    rows.push([key, show(x), show(y), (delta > 0 ? '+' : delta < 0 ? '-' : '') + show(Math.abs(delta)), x ? `${delta > 0 ? '+' : ''}${((delta / x) * 100).toFixed(0)}%` : '-']);
  }
  return rows.length ? grid(['metric', 'before', 'after', 'change', '%'], rows) + '\n' : 'no difference in any compared metric\n';
}

// ---------------------------------------------------------------- command line

function fail(message) { process.stderr.write(`engine-turns: ${message}\n`); process.exit(2); }

function main(argv) {
  const [command, ...rest] = argv;
  const options = {}, positional = [];
  for (const arg of rest) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) options[m[1]] = m[2] ?? true; else positional.push(arg);
  }
  if (command === 'compare') {
    if (positional.length !== 2) fail('compare takes two report files: <before.json> <after.json>');
    const [before, after] = positional.map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
    if (before.schema !== SCHEMA || after.schema !== SCHEMA) fail(`both reports must be schema ${SCHEMA}`);
    const text = compare(before, after, { all: Boolean(options.all) });
    if (typeof options.table === 'string') fs.writeFileSync(options.table, text);
    if (!options.quiet) process.stdout.write(text);
    return;
  }
  if (command !== 'measure' || !positional.length) {
    fail('usage: engine-turns.mjs measure [--json=<file>] [--table=<file>] [--host=claude|copilot] [--no-subagents] [--quiet] [<label>=]<transcript>...\n       engine-turns.mjs compare <before.json> <after.json> [--table=<file>] [--all]');
  }
  const threads = new Map();
  const labels = new Map();
  positional.forEach((arg, i) => {
    const eq = arg.indexOf('=');
    const labelled = eq > 0 && !/[\\/]/.test(arg.slice(0, eq)) && !fs.existsSync(arg);
    const file = labelled ? arg.slice(eq + 1) : arg;
    const label = labelled ? arg.slice(0, eq) : `session-${i + 1}`;
    if (!fs.existsSync(file)) fail(`no such transcript: argument ${i + 1}`);
    const host = typeof options.host === 'string' ? options.host : detectHost(readJsonl(file).slice(0, 50));
    if (host !== 'claude' && host !== 'copilot') fail(`argument ${i + 1} is neither a Claude Code session file nor a Copilot events file; name the host with --host`);
    const found = host === 'claude' ? parseClaude(file, { subagents: !options['no-subagents'] }) : parseCopilot(file, { subagents: !options['no-subagents'] });
    labels.set(found[0].key, label);
    let n = 0;
    for (const th of found) {
      if (threads.has(th.key)) {
        // Named on its own and found again under its parent: keep the copy that knows its parent.
        if (th.kind === 'subagent' && th.parentCallId) threads.set(th.key, th);
        continue;
      }
      threads.set(th.key, th);
      if (th !== found[0]) th.autoLabel = `${label}/agent-${++n}`;
    }
  });
  const list = [...threads.values()];
  for (const th of list) { th.named = labels.has(th.key); th.label = labels.get(th.key) ?? th.autoLabel ?? 'session'; }
  const rep = report(list);
  if (typeof options.json === 'string') fs.writeFileSync(options.json, JSON.stringify(rep, null, 1) + '\n');
  const text = table(rep);
  if (typeof options.table === 'string') fs.writeFileSync(options.table, text);
  if (!options.quiet) process.stdout.write(text);
}

main(process.argv.slice(2));
