/**
 * Stable screen slugs.
 *
 * A slug names a screen's page (`<slug>.html`), its `data-screen` links and its
 * INDEX rows, and it never changes from one version to the next. So a screen
 * keeps an explicit slug, else takes the slug `against` gave the screen of the
 * same title, and only a screen new by both measures gets a fresh one: folded
 * to ASCII, runs of anything outside `[a-z0-9]` turned into `-`, trimmed to 48
 * characters, `screen` when nothing is left, and `-2`, `-3` … on a clash
 * within the version.
 *
 * `index` and `prototype` are never a slug: `index.html` is the version's
 * gallery and `prototype.html` its working page. An explicit one is refused, a
 * fresh one takes a suffix.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

import { Refusal } from '../../../../lib/canonical.mjs';
import { SLUG_PATTERN } from './shapes.mjs';

const SLUG = new RegExp(SLUG_PATTERN);
/** Names every version keeps as a file of its own: the gallery and the working page. */
export const RESERVED_SLUGS = Object.freeze(['index', 'prototype']);
const RESERVED = new Set(RESERVED_SLUGS);
const MAX = 48;

export function isSlug(value) {
  return typeof value === 'string' && SLUG.test(value) && !RESERVED.has(value);
}

/** Refuse `slug-invalid` unless `value` is a usable slug; `where` names it in the message. */
export function assertSlug(value, where) {
  if (isSlug(value)) return value;
  const reserved = RESERVED.has(value) ? ` "${value}" is the name of a file every version keeps.` : '';
  throw new Refusal('slug-invalid',
    `${where} is ${JSON.stringify(value)}, which is not a slug (lowercase letters and digits joined by single hyphens).${reserved} Nothing was written and the input file is kept; correct the slug in .turn.json, or leave it out to have one made from the title, and run finish again.`);
}

/** The fresh slug a title folds to, before any suffix. */
export function foldTitle(title) {
  const folded = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/, '');
  return folded === '' ? 'screen' : folded;
}

/** `base`, or `base-2`, `base-3` … — the first not in `taken` and not reserved. */
export function unique(base, taken) {
  if (!taken.has(base) && !RESERVED.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The slug of each sent screen, in order. `previous` is `against`'s screens
 * (`[{slug, title}]`, any format), `carried` the slugs the version already
 * holds from carry-over. Explicit slugs and title matches are settled first,
 * so a fresh slug never takes a name one of them holds.
 */
export function resolveSlugs(sent, previous, carried) {
  const byTitle = new Map();
  for (const screen of previous) if (!byTitle.has(screen.title)) byTitle.set(screen.title, screen.slug);

  const slugs = sent.map((screen, index) => {
    if (screen.slug !== undefined) return assertSlug(screen.slug, `screens[${index}].slug`);
    return byTitle.get(screen.title) ?? null;
  });

  const seen = new Set();
  slugs.forEach((slug, index) => {
    if (slug === null) return;
    if (seen.has(slug)) {
      throw new Refusal('slug-invalid',
        `screens[${index}] names the slug "${slug}", which an earlier screen in .turn.json already names. Nothing was written and the input file is kept; give each screen its own slug and run finish again.`);
    }
    seen.add(slug);
  });

  const taken = new Set([...carried, ...seen]);
  return slugs.map((slug, index) => {
    if (slug !== null) return slug;
    const fresh = unique(foldTitle(sent[index].title), taken);
    taken.add(fresh);
    return fresh;
  });
}
