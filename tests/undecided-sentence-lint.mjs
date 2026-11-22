#!/usr/bin/env node
/**
 * The undecided-sentence lint: the sentence that says how the verification
 * loop's go-on question ends when nobody answers it is copied, byte for byte,
 * into the framework, the engine's in-node questions reference, the
 * verification runner and the workflow guides. A copy that drifts tells one
 * reader a different ending than the others, so every copy must read the same,
 * and the count is exact: a floor would let an extra copy hide a lost one.
 *
 * A copy is found by its opening words, `ANCHOR`, and runs to the end of the
 * sentence, `END`, on the same line (to the line's end when `END` is missing,
 * so a truncated copy differs too).
 *
 * Usage: `node tests/undecided-sentence-lint.mjs`. Output: on a mismatch, a
 * `FAIL:` line, then each distinct wording with the files and lines carrying
 * it. Exit 1 on a mismatch or a wrong count, 0 otherwise.
 *
 * Repository tooling: it never ships under `plugins/`, and it sits outside
 * `tests/engine/` so `make test`'s glob never runs it as a test. `node:`
 * builtins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugins/maister');
const ANCHOR = 'When nobody answers the stopping question';
const END = 'it takes "Continue as is".';
/** The copies kept on purpose; a copy added or removed on purpose updates it. */
const COPIES = 7;

/** Every markdown file under `dir`, sorted. */
function markdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

/** Each copy of the sentence: `{where, text}`. */
function copies(files) {
  const found = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      let from = line.indexOf(ANCHOR);
      while (from !== -1) {
        const stop = line.indexOf(END, from);
        const text = stop === -1 ? line.slice(from).trimEnd() : line.slice(from, stop + END.length);
        found.push({ where: `${path.relative(ROOT, file).split(path.sep).join('/')}:${index + 1}`, text });
        from = line.indexOf(ANCHOR, from + ANCHOR.length);
      }
    });
  }
  return found;
}

function main() {
  const found = copies(markdown(PLUGIN));
  const wordings = new Map();
  for (const { where, text } of found) wordings.set(text, [...(wordings.get(text) ?? []), where]);
  if (wordings.size <= 1 && found.length === COPIES) {
    console.log(`  the undecided sentence reads the same in all ${found.length} copies`);
    return 0;
  }
  if (wordings.size > 1) console.log(`FAIL: the undecided sentence reads ${wordings.size} ways across its ${found.length} copies; make every copy the same`);
  if (found.length !== COPIES) console.log(`FAIL: the undecided sentence has ${found.length} copies (${COPIES} expected); a copy was lost, reworded past its opening words or added`);
  for (const [text, where] of wordings) {
    console.log(`  ${where.join(', ')}:`);
    console.log(`    ${text}`);
  }
  return 1;
}

process.exitCode = main();
