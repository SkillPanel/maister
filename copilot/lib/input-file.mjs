/**
 * The input file: a structured document a caller writes with its own file
 * tool, at one fixed name in one fixed place, and names with a flag instead of
 * sending it on stdin. The one exception is `area-brief --patch-file`, which
 * writes the question set there itself; it is the engine's own write, so no
 * edit rule is involved.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20. Shared by the workflow
 * engine's `--patch-file` and the umbrella runtime's `--input-file`, so it sits
 * at the plugin root rather than inside either skill. Each entry point keeps
 * its own parse and its own usage error; this module owns only the file half,
 * which has to be the same rule in both.
 *
 * Why a file at all. A JSON document sent on stdin arrives through a heredoc
 * or a pipe, and the shell-safety checks of an agent host refuse exactly that
 * shape: braces beside quotes. A file written by the host's own file tool
 * needs no quoting in any shell, and the call that names it is bare words.
 *
 * Why one fixed name in one fixed place. A name is what a permission rule, a
 * hook and a reviewer can match, and a free path is not. The place is derived
 * from what the verb writes, so a document can never be read from — or, on
 * success, deleted from — anywhere else. A `..` segment is refused even where
 * it would resolve back into place, because a path that has to be resolved to
 * be judged is one a reader of the command cannot judge. A link is refused
 * because its target is somewhere else. All of these are usage errors: nothing
 * was read.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The input file, once it is known to be the one place the document is read
 * from: `expected`, a regular file, not a link. `noun` names the file in each
 * message ("the patch file"), `beside` says where it belongs ("beside the state
 * file it patches"), and `Usage` is the caller's usage error, so each entry
 * point reports in its own words and with its own exit code.
 *
 * `absentOk` is for a verb that writes the file itself: the place must still be
 * the one place, and anything already there must still be a regular file, but
 * nothing need be there yet.
 */
export function anchoredFile({ given, expected, noun, beside, Usage, absentOk = false }) {
  if (given.split(/[\\/]/).includes('..')) {
    throw new Usage(`${noun} may not name a parent directory (".."): write it to ${expected}`);
  }
  if (path.resolve(given) !== expected) {
    throw new Usage(`${noun} must be ${expected}, ${beside}, and was ${given}`);
  }
  let stat;
  try {
    stat = fs.lstatSync(expected);
  } catch (err) {
    if (absentOk && err.code === 'ENOENT') return expected;
    throw new Usage(`${noun} ${expected} could not be read: ${err.message}`);
  }
  if (stat.isSymbolicLink()) throw new Usage(`${noun} ${expected} is a symbolic link; write the file itself there`);
  if (!stat.isFile()) throw new Usage(`${noun} ${expected} is not a regular file`);
  return expected;
}

/** The file's text, whole. `what` names the document the caller expected in it. */
export function readFileText(file, what, Usage) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Usage(`${what} could not be read from ${file}: ${err.message}`);
  }
}

/**
 * Delete the input file once its document has landed, so a file left behind
 * means the verb did not accept it. A refusal keeps it, for the caller to
 * correct and send again. Failing to delete is a warning: the write already
 * landed, and the next write overwrites the file anyway.
 */
export function consume(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    process.stderr.write(`warning: ${file} was not deleted (${err.message}); the write landed\n`);
  }
}
