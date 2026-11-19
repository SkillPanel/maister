/**
 * A gate's subject: the one output the gate asks the operator to approve.
 *
 * Why this module exists. A gate puts several files up for review, and a
 * reader that wants to lead with the thing being approved — a delivery scope
 * shown as its members, a specification, a plan — had only the files' names to
 * guess from. The engine knows which output a closing node declared under
 * which key, so it names the subject itself: `subject: {path, kind}` on the
 * gate's checkpoint.
 *
 * The rule. Each kind is read off a declared output key of a node the gate
 * closes, never off a file name. The kinds are a closed list in precedence
 * order, and the first one a closing node declares with a literal path that is
 * on disk is the subject. `path` is run-relative, the form the checkpoint's
 * `review` paths take, a folder ending in `/`. Nothing found is no key: absent
 * reads as "no subject named", and a reader falls back to its own reading of
 * the review list.
 *
 * Zero dependencies, `node:` builtins only, Node >= 20.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The kinds a subject may have, in precedence order, each with the declared
 * output key it is read from. A reader meeting a kind it does not know leads
 * with a link to the path.
 */
export const SUBJECT_KINDS = [
  { kind: 'delivery-scope', key: 'delivery_scope' },
  { kind: 'brief', key: 'brief' },
  { kind: 'specification', key: 'spec' },
  { kind: 'plan', key: 'plan' },
  { kind: 'mockups', key: 'mockups' },
];

/**
 * The subject of the gate closing `ids`, as `{path, kind}`, or null. `byId`
 * maps a node id to its graph entry, whose `outputs.artifacts` holds the
 * declared paths, run-relative.
 */
export function subjectOf({ ids, byId, runDir }) {
  for (const { kind, key } of SUBJECT_KINDS) {
    for (const id of ids) {
      const declared = byId.get(id)?.outputs?.artifacts;
      const relative = declared !== null && typeof declared === 'object' ? declared[key] : undefined;
      if (typeof relative !== 'string' || relative === '' || relative.includes('${')) continue;
      const target = path.resolve(runDir, relative);
      const form = path.relative(path.resolve(runDir), target);
      // A subject is a file of the run: one outside the task directory is passed over.
      if (form === '' || form.split(path.sep)[0] === '..' || path.isAbsolute(form)) continue;
      const shown = written(target);
      if (shown === null) continue;
      const posix = form.split(path.sep).join('/');
      return { path: shown === 'folder' ? `${posix}/` : posix, kind };
    }
  }
  return null;
}

/** `{subject}` when one is named, else nothing: absent reads as "no subject named". */
export function subjectKey(subject) {
  return subject ? { subject } : {};
}

/** 'file', 'folder' when it holds a file at any depth, or null. */
function written(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (stat.isFile()) return 'file';
  return stat.isDirectory() && holdsFile(target) ? 'folder' : null;
}

/** Whether a folder holds a file that is not hidden, at any depth. */
function holdsFile(folder) {
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(entry => !entry.name.startsWith('.')
    && (entry.isFile() || (entry.isDirectory() && holdsFile(path.join(folder, entry.name)))));
}
