/**
 * A task group's id: the one grammar every reader of a plan, a work log or a
 * `--groups` value shares.
 *
 * An id is one token of letters, digits, dots and hyphens that starts and ends
 * with a letter or digit — `3`, `2b.1`, `M.1`, `api-2`. The planner writes whole
 * numbers, but a plan a person or an earlier tool shaped does not have to, and
 * a reader that knew only digits saw no groups at all in such a plan.
 *
 * Ids are matched as written. A whole number is the one exception, kept from
 * the digits-only readers: it compares by value, so `03` is group `3`, and it
 * leaves as a JSON number. The plan's own order is the order; nothing here
 * sorts.
 *
 * Step labels (`<id>.<n>`), skipped steps and work-log headings are matched
 * only against the ids the plan carries, through `groupAlternation`: for a plan
 * of whole numbers that is the `\d+` the digits-only readers used, so such a
 * plan reads exactly as it always did.
 *
 * Zero dependencies, Node >= 20.
 */

/** One group id, unanchored, for building larger patterns. */
export const GROUP_ID_PATTERN = '[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?';

/** One group id, the whole string. */
export const GROUP_ID = new RegExp(`^${GROUP_ID_PATTERN}$`);

/** The grammar in words, for a usage error. */
export const GROUP_ID_RULE = 'each id letters, digits, dots and hyphens, starting and ending with a letter or digit (3, 2b.1, M.1)';

/**
 * A task group's heading, and the id that labels it.
 *
 * Matches `### Task Group 6: Progress derivation` and `### Task Group 2b.1: …`
 * — the shape the planner writes and the executor reads back. It does not
 * match `#### Task Group 6:` or a mention of the phrase mid-sentence, because
 * the count of these headings **is** `groups_total` and a prose reference to a
 * group is not a group.
 */
export const GROUP_HEADING = new RegExp(`^### Task Group (${GROUP_ID_PATTERN}):`, 'gm');

const WHOLE = /^\d+$/;

/** The id groups are compared by: a whole number by value, any other id as written. */
export function groupKey(id) {
  return WHOLE.test(id) ? id.replace(/^0+(?=\d)/, '') : id;
}

/** The id as a result reports it: a whole number as a number, any other id as a string. */
export function groupValue(id) {
  return WHOLE.test(id) ? Number(id) : id;
}

/**
 * The id inside an agent id, a question id or a report name, which are
 * lowercase slugs: lower case, each dot a hyphen — `m-1` for `M.1`. Two
 * headings with the same slug are duplicates, because they would share those.
 */
export function groupSlug(id) {
  return groupKey(id).toLowerCase().replace(/\./g, '-');
}

/**
 * A pattern for "a group id this plan carries": any whole number, as the
 * digits-only readers took, or one of `ids` that is not one, longest first.
 */
export function groupAlternation(ids) {
  const named = [...new Set(ids.filter(id => !WHOLE.test(id)))]
    .sort((a, b) => b.length - a.length)
    .map(id => id.replace(/\./g, '\\.'));
  return `(?:\\d+${named.map(id => `|${id}`).join('')})`;
}

/**
 * The group keys a list in prose names — `Groups 2b.1, M.1`, `Groups 4 and 5`:
 * each token that is one of the plan's own ids, and every run of digits
 * elsewhere, as the digits-only readers took them.
 */
export function groupIdsIn(text, ids) {
  const named = new Set(ids.filter(id => !WHOLE.test(id)));
  const found = [];
  for (const [token] of String(text).matchAll(new RegExp(GROUP_ID_PATTERN, 'g'))) {
    if (named.has(token)) found.push(token);
    else for (const digits of token.match(/\d+/g) ?? []) found.push(groupKey(digits));
  }
  return found;
}

/** The ids of a `--groups` value (`3` or `2b.1,M.1`), each once, or null when one breaks the grammar. */
export function parseGroupList(value) {
  const items = String(value ?? '').replace(/\s+/g, '').split(',');
  return items.every(item => GROUP_ID.test(item)) ? [...new Set(items)] : null;
}

/**
 * The headings that share a slug, each set as written: `[['3', '03'], ['M.1', 'm.1']]`.
 * Empty when every heading names a group of its own.
 */
export function duplicateGroups(ids) {
  const bySlug = new Map();
  for (const id of ids) bySlug.set(groupSlug(id), [...(bySlug.get(groupSlug(id)) ?? []), id]);
  return [...bySlug.values()].filter(set => set.length > 1);
}

/** The refusal's text for a plan whose headings name one group twice, the ids as written. */
export function duplicateMessage(plan, sets) {
  const phrase = sets.map(set => set.map(id => `"${id}"`).join(' and ')).join('; ');
  return `${plan} names one group with more than one "### Task Group <id>:" heading: ${phrase}. Nothing was written. `
    + 'Give each group an id of its own — ids that differ only in case, or in a dot for a hyphen, are the same group — then run the call again.';
}
