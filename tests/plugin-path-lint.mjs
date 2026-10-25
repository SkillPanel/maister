#!/usr/bin/env node
/**
 * The plugin-path lint: a file the plugin ships is named where it is to be
 * read by its absolute spelling, `<plugin root>/skills/…`. A dispatched agent
 * runs with no skill base directory, and a workflow guide is read at the step,
 * from the project root; either one handed a bare `skills/x/references/y.md`
 * or `x/references/y.md` resolves it against the project, finds nothing, and
 * searches the disk for it — which raises a path prompt on a host that guards
 * reads outside the project, and may find a copy of another version.
 *
 * What it catches: in `agents/*.md` and `skills/workflow-engine/workflows/*.md`
 * of either plugin tree, an inline code span that starts with a path into a
 * skill directory that exists in that tree — `skills/<skill>/…`,
 * `<skill>/references/…`, `<skill>/scripts/…`, `<skill>/assets/…`,
 * `<skill>/server/…` or `<skill>/SKILL.md`. A span that opens with a root
 * placeholder (`<plugin root>/…`, `<plugin_root>/…`, `${CLAUDE_PLUGIN_ROOT}/…`)
 * passes, as does any span that is not such a path.
 *
 * What it leaves alone: skill files and their references. A skill is loaded
 * with its base directory, so its own `references/x.md` and its pointers to a
 * sibling skill's references resolve where it runs.
 *
 * An inline code span may wrap across lines inside a paragraph; it is matched
 * over the paragraph's text, and reported at the line it opens on.
 *
 * Usage: `node tests/plugin-path-lint.mjs [--root=<dir>]`. The root holds
 * `plugins/maister/` and `plugins/maister-copilot/`; it defaults to this
 * repository. A tree that is absent is skipped.
 *
 * Output: one `FAIL: <path>:<line>: <reason>` line per finding, the path
 * relative to the root. Exit 1 after printing every finding, 0 when there is
 * none, and 2 on a usage error.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. Zero
 * dependencies, `node:` builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TREES = ['plugins/maister', 'plugins/maister-copilot'];

/** A span that opens with a path into a skill directory: the skill's name is group 1. */
const SKILL_PATH = /^(?:skills\/([a-z0-9][a-z0-9-]*)\/|([a-z0-9][a-z0-9-]*)\/(?:references|scripts|assets|server)\/|([a-z0-9][a-z0-9-]*)\/SKILL\.md(?![\w.-]))/;

/**
 * Every finding in one markdown text, as `{line, span}` objects. Pure: the
 * text is split into paragraphs (blank lines and fenced blocks end one), each
 * paragraph's inline code spans are read across its line breaks, and a span
 * counts only when the skill it names is in `skills`.
 */
export function lintText(text, skills) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  let para = [];
  let fence = null;
  const flush = () => {
    if (para.length) findings.push(...spansIn(para, skills));
    para = [];
  };
  lines.forEach((line, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      flush();
      fence = marker[1];
      return;
    }
    if (line.trim() === '') flush();
    else para.push({ text: line, number: i + 1 });
  });
  flush();
  return findings;
}

/** The offending spans of one paragraph, given as `{text, number}` lines. */
function spansIn(para, skills) {
  const findings = [];
  const joined = para.map(l => l.text).join('\n');
  const starts = [];
  let offset = 0;
  for (const l of para) {
    starts.push(offset);
    offset += l.text.length + 1;
  }
  const lineAt = index => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= index) k++;
    return para[k].number;
  };
  let i = 0;
  while (i < joined.length) {
    if (joined[i] !== '`') {
      i++;
      continue;
    }
    let run = 1;
    while (joined[i + run] === '`') run++;
    const ticks = '`'.repeat(run);
    let close = joined.indexOf(ticks, i + run);
    while (close !== -1 && (joined[close + run] === '`' || joined[close - 1] === '`')) {
      close = joined.indexOf(ticks, close + 1);
    }
    if (close === -1) {
      i += run;
      continue;
    }
    const span = joined.slice(i + run, close).replace(/\s*\n\s*/g, ' ').trim();
    const match = SKILL_PATH.exec(span);
    if (match && skills.has(match[1] ?? match[2] ?? match[3])) findings.push({ line: lineAt(i), span });
    i = close + run;
  }
  return findings;
}

/** Every finding under `root`, as FAIL lines. */
export function lintRoot(root) {
  const failures = [];
  for (const tree of TREES) {
    const dir = path.join(root, tree);
    if (!fs.existsSync(dir)) continue;
    const skills = new Set(listDir(path.join(dir, 'skills')).filter(name => isDir(path.join(dir, 'skills', name))));
    const files = [
      ...listDir(path.join(dir, 'agents')).map(name => path.join(dir, 'agents', name)),
      ...listDir(path.join(dir, 'skills/workflow-engine/workflows')).map(name => path.join(dir, 'skills/workflow-engine/workflows', name)),
    ].filter(file => file.endsWith('.md') && isFile(file));
    for (const file of files) {
      const shown = path.relative(root, file).split(path.sep).join('/');
      for (const { line, span } of lintText(fs.readFileSync(file, 'utf8'), skills)) {
        failures.push(`FAIL: ${shown}:${line}: \`${span}\` names a plugin file relative to nothing a reader has; write \`<plugin root>/${span.startsWith('skills/') ? span : `skills/${span}`}\``);
      }
    }
  }
  return failures;
}

function isDir(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function main(argv) {
  let root = REPO;
  for (const arg of argv) {
    if (arg.startsWith('--root=') && arg.length > '--root='.length) root = path.resolve(arg.slice('--root='.length));
    else {
      process.stderr.write(`usage: node tests/plugin-path-lint.mjs [--root=<dir>] (unknown argument ${arg})\n`);
      return 2;
    }
  }
  const failures = lintRoot(root);
  for (const line of failures) process.stdout.write(`${line}\n`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
