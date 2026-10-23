/**
 * A question's evidence: the files the run's recommendation for it rests on.
 *
 * Why this module exists. A driver deciding on an operator's behalf has to
 * tell a well-founded recommendation from a bare one, and the only thing a
 * question carried to say so was its prose. A question may now name its
 * evidence — `evidence: [<path>, ...]` — and every surface that carries
 * questions reads the list the same way, so the rule lives here once.
 *
 * The rule. A path is written relative to the task directory or to the
 * repository: it is looked up in the task directory first, and only when
 * nothing is there in the repository. It is emitted repository-relative, with
 * forward slashes, so a reader needs no rule at all. The repository is the
 * directory that holds the run's `.maister/` folder.
 *
 * Never a refusal. Evidence explains a recommendation; it never stops a
 * question from being asked. A path that is not text, is absolute, leaves the
 * repository or names nothing on disk is dropped with one warning,
 * `question-evidence-dropped:<where>:<path>:<reason>`, and the question goes
 * on with what is left. A list left empty is no list: the key is left out,
 * which reads as "no evidence given", as it always has.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Why a path was dropped, as the warning's last field names it. */
const REASON = { text: 'not-a-path', absolute: 'absolute', outside: 'outside-repository', missing: 'missing' };

/**
 * The repository a run belongs to: the directory holding the first `.maister`
 * folder on the run directory's path. A run directory outside any `.maister`
 * folder is its own repository, so nothing above it is ever named.
 */
export function repositoryOf(runDir) {
  const parts = path.resolve(runDir).split(path.sep);
  const at = parts.indexOf('.maister');
  return at > 0 ? parts.slice(0, at).join(path.sep) || path.sep : path.resolve(runDir);
}

/**
 * Check `raw` — a question's `evidence` as it was written — against the run
 * directory and its repository. Returns `{paths, warnings}`: `paths` the kept
 * ones, normalised and repository-relative, each once and in the order given;
 * `warnings` one line per dropped path. `where` names the question in a
 * warning.
 */
export function checkEvidence(raw, { runDir, where }) {
  const warnings = [];
  if (raw === undefined || raw === null) return { paths: [], warnings };
  const drop = (given, reason) => warnings.push(`question-evidence-dropped:${where}:${given}:${reason}`);
  if (!Array.isArray(raw)) {
    drop(JSON.stringify(raw), REASON.text);
    return { paths: [], warnings };
  }
  const run = path.resolve(runDir);
  const root = repositoryOf(run);
  const paths = [];
  for (const given of raw) {
    if (typeof given !== 'string' || given.trim() === '' || /[\r\n]/.test(given)) {
      drop(JSON.stringify(given), REASON.text);
      continue;
    }
    const written = given.trim();
    if (path.isAbsolute(written) || path.win32.isAbsolute(written)) {
      drop(written, REASON.absolute);
      continue;
    }
    const segments = written.split(/[\\/]+/);
    const candidates = [path.resolve(run, ...segments), path.resolve(root, ...segments)];
    if (candidates.every(file => !inside(root, file))) {
      drop(written, REASON.outside);
      continue;
    }
    const found = candidates.find(file => inside(root, file) && fs.existsSync(file));
    if (!found) {
      drop(written, REASON.missing);
      continue;
    }
    const relative = path.relative(root, found).split(path.sep).join('/');
    if (!paths.includes(relative)) paths.push(relative);
  }
  return { paths, warnings };
}

/** Whether `file` lies under `root`; the root itself names no file. */
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
}

/** `{evidence}` when the list holds a path, else nothing: absent reads as "no evidence given". */
export function evidenceKey(paths) {
  return Array.isArray(paths) && paths.length ? { evidence: paths } : {};
}
