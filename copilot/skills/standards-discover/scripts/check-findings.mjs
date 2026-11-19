/**
 * The findings check: is a standards scanner's YAML file one standards
 * discovery can read?
 *
 *   node <path to this file> <findings file>
 *
 * Exec form, no shebang, zero dependencies, `node:` builtins only, Node >= 20.
 * It needs nothing else on the machine — no Python, no YAML package, no shell
 * feature — and takes the file by path, so the command is the same in bash,
 * zsh, PowerShell and cmd.exe once the path is quoted.
 *
 * The YAML is read with the workflow engine's own reader, the subset the
 * scanner briefs write: block maps and sequences, flow lists, quoted and bare
 * scalars, comments. A block scalar, an anchor or a tag is refused with a hint
 * to write the value as a quoted string.
 *
 * The shape is the one every scanner brief shares: a top-level mapping with a
 * `findings:` list, each finding a mapping with a non-empty `category`,
 * `standard_name`, `description` and `source`, a numeric `confidence` from 0
 * to 100, `evidence` as a non-empty list of strings, and `examples`, when
 * present, as a list. Other top-level keys (`github_available`) are left alone.
 *
 * Output: one JSON report on stdout, `{ok, file, findings, problems}`, each
 * problem `{path, message}`. Exit 0 when the file passes, 1 when it does not —
 * missing, unparseable or the wrong shape, which discovery treats as a source
 * that did not run — and 2 for a usage error.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDefinition } from '../../workflow-engine/scripts/lib/definition.mjs';

const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

const TEXT_FIELDS = ['category', 'standard_name', 'description', 'source'];

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim() !== '';

/** The problems of one finding, each at its dotted path. */
function findingProblems(finding, at) {
  if (!isMap(finding)) return [{ path: at, message: 'a finding must be a mapping of its fields' }];
  const problems = [];
  for (const field of TEXT_FIELDS) {
    if (!isText(finding[field])) problems.push({ path: `${at}.${field}`, message: `${field} must be a non-empty string` });
  }
  const { confidence, evidence, examples } = finding;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    problems.push({ path: `${at}.confidence`, message: 'confidence must be a bare number from 0 to 100' });
  }
  if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every(isText)) {
    problems.push({ path: `${at}.evidence`, message: 'evidence must be a non-empty list of strings' });
  }
  if (examples !== undefined && examples !== null && !Array.isArray(examples)) {
    problems.push({ path: `${at}.examples`, message: 'examples must be a list (an empty one is `[]`)' });
  }
  return problems;
}

function check(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const why = err.code === 'ENOENT' ? 'no findings file at this path' : `the file cannot be read: ${err.message}`;
    return { findings: 0, problems: [{ path: '', message: why }] };
  }
  const parsed = parseDefinition(text.replace(/^﻿/, ''), file);
  if (parsed.doc === null) {
    const [error] = parsed.errors;
    return {
      findings: 0,
      problems: [{ path: error.path ?? '', message: `${error.message}; write each value as a quoted string ("…") or a flow list ([…])` }],
    };
  }
  if (!Array.isArray(parsed.doc.findings)) {
    return { findings: 0, problems: [{ path: 'findings', message: 'the file must hold a top-level findings: list (findings: [] when there are none)' }] };
  }
  const problems = parsed.doc.findings.flatMap((finding, index) => findingProblems(finding, `findings.${index}`));
  return { findings: parsed.doc.findings.length, problems };
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('--')) {
  process.stderr.write('usage: node check-findings.mjs <findings file>\n');
  process.exit(EXIT.USAGE);
}
const file = path.resolve(args[0]);
const { findings, problems } = check(file);
process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, file, findings, problems }, null, 2)}\n`);
process.exit(problems.length === 0 ? EXIT.OK : EXIT.FAILED);
