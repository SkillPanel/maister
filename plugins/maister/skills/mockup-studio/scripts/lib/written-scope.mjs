/**
 * The written scope: a version's `scope.md`, parsed, stripped and checked.
 *
 * `parseScope` reads the text line by line: CRLF as LF, a leading byte-order
 * mark dropped. A fence (three backticks or three tildes, at most three
 * spaces in) is settled first: every line from it to the next line opening
 * with the same marker, both included, is prose, and an unclosed fence runs to
 * the end. Outside a fence, the first `# ` line before any section is the
 * optional title; the other lines before the first `## ` line are the lead.
 * Each `## ` line with a heading left after collapsing opens a section. In a
 * section, a `- ` line at column 0 is an item, and the lines right below it
 * indented by two or more spaces are its continuation, up to a blank line, a
 * column-0 line or a heading: one whose trimmed text starts with `- was:` is
 * a was line, any other is joined to the item's text with one space. A tab is
 * never indentation. An item's text starting with `[added]`, `[removed]` or
 * `[changed]`, lowercase and followed by whitespace, carries that mark, and
 * the tag leaves the text. Everything else is prose, kept in file order
 * between the items.
 *
 * `stripScope` gives the earlier scope a next round starts from: `[removed]`
 * items dropped, tags and was lines dropped, every section, its order and its
 * prose kept. `duplicates` names each heading and each item text of a section
 * met a second time; the check refuses them in a new scope, and the reader of
 * a published one refuses them there. `checkScope` holds a parsed scope to the
 * earlier one, matching by collapsed heading and text, case-sensitively and
 * never by slug, and returns each section's slug and counts and the slugs of
 * the sections holding a mark.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

import { Refusal } from '../../../../lib/canonical.mjs';
import { foldTitle, unique } from './slugs.mjs';

export const MARKS = Object.freeze(['added', 'removed', 'changed']);

const FENCE = /^ {0,3}(```|~~~)/;
const TAG = /^\[(added|removed|changed)\](?=\s|$)/;
const WAS = '- was:';
/** How many problems one refusal names; the rest are counted. */
const SHOWN = 5;
const KEPT = 'Nothing was written, and scope.md and .turn.json are kept';

const collapse = text => text.replace(/\s+/g, ' ').trim();
const fenceOf = line => line.match(FENCE)?.[1] ?? null;
const quote = text => JSON.stringify(text);

/** The items of a parsed section, in file order. */
export const itemsOf = section => section.blocks.filter(block => block.kind === 'item');

/**
 * `{title, lead, sections}`: `title` the collapsed title or null, `lead` the
 * prose blocks before the first section, each section `{heading, line,
 * blocks}` with `blocks` its prose (`{kind: 'prose', text}`) and its items
 * (`{kind: 'item', text, mark, was, wasLines, line}`) in file order. `mark` is
 * null or one of `MARKS`, `was` the first was text or null, `wasLines` how many
 * was lines the item had, `line` its 1-based line number.
 */
export function parseScope(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const lead = [];
  const sections = [];
  let title = null;
  let titleSeen = false;
  let blocks = lead;
  let prose = null;
  let item = null;
  let fence = null;

  const addProse = line => {
    if (prose) prose.text += `\n${line}`;
    else {
      prose = { kind: 'prose', text: line };
      blocks.push(prose);
    }
  };
  const endItem = () => {
    if (!item) return;
    const raw = item.raw.trimStart();
    const tag = raw.match(TAG);
    item.target[item.at] = {
      kind: 'item',
      text: collapse(tag ? raw.slice(tag[0].length) : raw),
      mark: tag ? tag[1] : null,
      was: item.was[0] ?? null,
      wasLines: item.was.length,
      line: item.line,
    };
    item = null;
  };

  lines.forEach((line, at) => {
    const number = at + 1;
    if (fence !== null) {
      addProse(line);
      if (fenceOf(line) === fence) fence = null;
      return;
    }
    const opened = fenceOf(line);
    if (opened !== null) {
      endItem();
      addProse(line);
      fence = opened;
      return;
    }
    if (line.trim() === '') {
      endItem();
      prose = null;
      return;
    }
    if (line.startsWith('## ') && collapse(line.slice(3)) !== '') {
      endItem();
      prose = null;
      const section = { heading: collapse(line.slice(3)), line: number, blocks: [] };
      sections.push(section);
      blocks = section.blocks;
      return;
    }
    if (sections.length === 0 && !titleSeen && line.startsWith('# ')) {
      titleSeen = true;
      title = collapse(line.slice(2)) || null;
      prose = null;
      return;
    }
    if (sections.length > 0 && line.startsWith('- ')) {
      endItem();
      prose = null;
      item = { raw: line.slice(2), was: [], line: number, target: blocks, at: blocks.length };
      blocks.push(null);
      return;
    }
    if (item && line.startsWith('  ')) {
      const trimmed = line.trim();
      if (trimmed.startsWith(WAS)) item.was.push(collapse(trimmed.slice(WAS.length)));
      else item.raw += ` ${trimmed}`;
      return;
    }
    endItem();
    addProse(line);
  });
  endItem();

  return { title, lead, sections };
}

/** The earlier scope a next round starts from and is checked against. */
export function stripScope(parsed) {
  return {
    title: parsed.title,
    lead: parsed.lead.map(block => ({ ...block })),
    sections: parsed.sections.map(section => ({
      heading: section.heading,
      line: section.line,
      blocks: section.blocks
        .filter(block => block.kind !== 'item' || block.mark !== 'removed')
        .map(block => (block.kind === 'item' ? { ...block, mark: null, was: null, wasLines: 0 } : { ...block })),
    })),
  };
}

/**
 * Each heading met a second time (`{heading, text: null, line}`) and each item
 * text met a second time within one section (`{heading, text, line}`), in file
 * order; `line` is the later one's. An empty item text is not counted here.
 */
export function duplicates(parsed) {
  const found = [];
  const headings = new Set();
  for (const section of parsed.sections) {
    if (headings.has(section.heading)) found.push({ heading: section.heading, text: null, line: section.line });
    headings.add(section.heading);
    const texts = new Set();
    for (const item of itemsOf(section)) {
      if (item.text === '') continue;
      if (texts.has(item.text)) found.push({ heading: section.heading, text: item.text, line: item.line });
      texts.add(item.text);
    }
  }
  return found;
}

/**
 * Hold `parsed` to `earlier`, a stripped scope or null when the round has none
 * to build on. Refuses `scope-empty` when no section holds an item that is not
 * `[removed]`, then `scope-marks-invalid` naming the first problems found.
 * Returns `{sections: [{slug, title, items, added, removed, changed}], changed}`,
 * `sections` in the order of `parsed.sections`.
 */
export function checkScope(parsed, earlier) {
  if (!parsed.sections.some(section => itemsOf(section).some(item => item.mark !== 'removed'))) {
    throw new Refusal('scope-empty',
      `scope.md has no section holding an item that is not [removed], so the version would hold nothing. ${KEPT}; list at least one item under a "## " heading and run finish again.`);
  }

  const problems = [];
  const atItem = (section, item, what) => problems.push(`section ${quote(section.heading)}, item ${quote(item.text)} (line ${item.line}): ${what}`);
  const repeated = new Map(duplicates(parsed).map(each => [each.line, each]));

  const before = new Map();
  for (const section of earlier?.sections ?? []) {
    if (!before.has(section.heading)) before.set(section.heading, itemsOf(section).map(item => item.text));
  }
  const uses = new Map([...before].map(([heading, texts]) => [heading, new Map(texts.map(text => [text, 0]))]));
  const use = (heading, text) => uses.get(heading)?.set(text, uses.get(heading).get(text) + 1);

  for (const section of parsed.sections) {
    if (repeated.has(section.line)) {
      problems.push(`section ${quote(section.heading)} (line ${section.line}): an earlier section has the same heading; give each section its own heading`);
    }
    const prior = new Set(before.get(section.heading) ?? []);
    const where = `the earlier scope's ${quote(section.heading)} section`;
    for (const item of itemsOf(section)) {
      if (repeated.has(item.line)) atItem(section, item, 'an earlier item of this section has the same text; give each item its own text');
      if (item.text === '') {
        atItem(section, item, 'the item is empty once its mark is taken off; write its text or delete the line');
        continue;
      }
      if (item.wasLines > 0 && item.mark !== 'changed') atItem(section, item, 'it has a was line, which only a [changed] item may have; mark it [changed] or delete the was line');
      if (item.mark === 'changed' && item.wasLines === 0) atItem(section, item, 'it is marked [changed] with no was line; add one "- was: <earlier text>" line under it');
      if (item.mark === 'changed' && item.wasLines > 1) atItem(section, item, `it is marked [changed] with ${item.wasLines} was lines; keep exactly one`);

      if (earlier === null) {
        if (item.mark !== null) atItem(section, item, `it is marked [${item.mark}], but there is no earlier scope to mark against; take the mark off`);
        continue;
      }
      if (item.mark === null) {
        if (prior.has(item.text)) use(section.heading, item.text);
        else atItem(section, item, `it is not in ${where}; mark it [added], or [changed] with a was line`);
      } else if (item.mark === 'added') {
        if (prior.has(item.text)) atItem(section, item, `it is marked [added], but ${where} already lists it; take the mark off`);
      } else if (item.mark === 'removed') {
        if (prior.has(item.text)) use(section.heading, item.text);
        else atItem(section, item, `it is marked [removed], but ${where} does not list it; delete the line`);
      } else {
        if (item.was !== null) {
          if (prior.has(item.was)) use(section.heading, item.was);
          else atItem(section, item, `its was text ${quote(item.was)} is not an item of ${where}; quote the earlier text exactly`);
        }
        if (item.was === item.text) atItem(section, item, 'its text is the same as its was text; take the mark and the was line off');
        else if (prior.has(item.text)) atItem(section, item, `its new text is already an item of ${where}; keep that item as it is, or give this one a text of its own`);
      }
    }
  }

  const present = new Set(parsed.sections.map(section => section.heading));
  for (const [heading, counts] of uses) {
    for (const [text, count] of counts) {
      const named = `section ${quote(heading)}, earlier item ${quote(text)}`;
      if (!present.has(heading)) {
        problems.push(`${named}: this scope has no ${quote(heading)} section; keep the section and mark the item [removed]`);
      } else if (count === 0) {
        problems.push(`${named}: it is not accounted for; keep it unmarked, mark it [removed], or quote it in one was line`);
      } else if (count > 1) {
        problems.push(`${named}: it is accounted for ${count} times; keep it, remove it or quote it once`);
      }
    }
  }

  if (problems.length > 0) {
    const more = problems.length > SHOWN ? ` (and ${problems.length - SHOWN} more)` : '';
    throw new Refusal('scope-marks-invalid',
      `scope.md has ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}: ${problems.slice(0, SHOWN).join('; ')}${more}. ${KEPT}; correct scope.md and run finish again.`);
  }

  const taken = new Set();
  const sections = parsed.sections.map(section => {
    const slug = unique(foldTitle(section.heading, 'section'), taken);
    taken.add(slug);
    const list = itemsOf(section);
    const count = mark => list.filter(item => item.mark === mark).length;
    return {
      slug,
      title: section.heading,
      items: list.length - count('removed'),
      added: count('added'),
      removed: count('removed'),
      changed: count('changed'),
    };
  });
  const changed = sections
    .filter((entry, at) => itemsOf(parsed.sections[at]).some(item => item.mark !== null))
    .map(entry => entry.slug);
  return { sections, changed };
}
