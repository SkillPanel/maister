import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// The written-scope module of the mockup studio, called directly: it parses a
// version's `scope.md`, strips it into the earlier scope the next round builds
// on, and checks a round's marks against that earlier scope. Pure, so no
// scratch folder: every case is a string in, a value or a refusal out.

const LIB = path.join(ROOT, 'plugins/maister/skills/mockup-studio/scripts/lib');
const { parseScope, stripScope, duplicates, checkScope } = await import(path.join(LIB, 'written-scope.mjs'));
const { foldTitle } = await import(path.join(LIB, 'slugs.mjs'));

const lines = (...each) => each.join('\n');
const items = section => section.blocks.filter(block => block.kind === 'item');
const prose = blocks => blocks.filter(block => block.kind === 'prose').map(block => block.text);

/** The refusal `fn` throws, held to its code. */
function refusal(fn, code) {
  let caught = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, `expected a ${code} refusal`);
  assert.equal(caught.code, code, caught.message);
  return caught.message;
}

const check = (text, earlier = null) => checkScope(parseScope(text), earlier === null ? null : stripScope(parseScope(earlier)));

test('scope.md: CRLF reads as LF, a byte-order mark is dropped, and only the first # line before a section is the title', () => {
  const parsed = parseScope('﻿# Support  inbox\r\nA lead line\r\n# Not a title\r\n## In scope\r\n- Reply from the ticket view\r\n# Prose in a section\r\n');
  assert.equal(parsed.title, 'Support inbox');
  assert.deepEqual(prose(parsed.lead), ['A lead line\n# Not a title']);
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].heading, 'In scope');
  assert.deepEqual(items(parsed.sections[0]).map(item => item.text), ['Reply from the ticket view']);
  assert.deepEqual(prose(parsed.sections[0].blocks), ['# Prose in a section']);
  assert.equal(items(parsed.sections[0])[0].line, 5);

  const late = parseScope(lines('Lead first', '## Goals', '# Too late for a title', '- One'));
  assert.equal(late.title, null, 'a # line inside a section is prose, never the title');
  assert.equal(parseScope(lines('## Goals', '- One')).title, null, 'the title is optional');
});

test('scope.md: two-space continuations join their item, a tab or a blank line ends them, and - was: is the was line', () => {
  const parsed = parseScope(lines(
    '## In scope',
    '- [changed] Reply from',
    '    the ticket   view',
    '  - was: Reply from the  inbox',
    '- Assign a ticket',
    '\tto a teammate',
    '- Snooze a ticket',
    '',
    '  until a date',
    '- Export',
    'Column-0 text ends it',
    '- Tag',
    '## Out of scope',
    '  not a continuation of anything',
  ));
  const [first, second] = parsed.sections;
  assert.deepEqual(items(first).map(item => [item.text, item.mark, item.was]), [
    ['Reply from the ticket view', 'changed', 'Reply from the inbox'],
    ['Assign a ticket', null, null],
    ['Snooze a ticket', null, null],
    ['Export', null, null],
    ['Tag', null, null],
  ]);
  assert.deepEqual(prose(first.blocks), ['\tto a teammate', '  until a date', 'Column-0 text ends it']);
  assert.deepEqual(items(second), []);
  assert.deepEqual(prose(second.blocks), ['  not a continuation of anything']);
  assert.deepEqual(first.blocks.map(block => block.kind),
    ['item', 'item', 'prose', 'item', 'prose', 'item', 'prose', 'item'], 'prose and items keep the file order');
});

test('scope.md: a fence holds #, ## and - lines as prose, its own lines included, and an unclosed fence runs to the end', () => {
  const parsed = parseScope(lines(
    '# Title',
    '~~~',
    '## not a section',
    '~~~',
    '## Goals',
    '- One',
    '   ```js',
    '# not a title',
    '',
    '- not an item',
    '## not a section',
    '```',
    '- Two',
    '## Later',
    '    ```',
    '- an item after a fence opened four spaces in',
    '```',
    '- inside an unclosed fence',
    '## still inside',
  ));
  assert.equal(parsed.title, 'Title');
  assert.deepEqual(prose(parsed.lead), ['~~~\n## not a section\n~~~']);
  assert.deepEqual(parsed.sections.map(section => section.heading), ['Goals', 'Later']);
  const [goals, later] = parsed.sections;
  assert.deepEqual(items(goals).map(item => item.text), ['One', 'Two']);
  assert.deepEqual(prose(goals.blocks), ['   ```js\n# not a title\n\n- not an item\n## not a section\n```']);
  assert.deepEqual(items(later).map(item => item.text), ['an item after a fence opened four spaces in']);
  assert.deepEqual(prose(later.blocks), ['    ```', '```\n- inside an unclosed fence\n## still inside']);
});

test('scope.md: only the exact lowercase tags followed by whitespace are marks, and an empty heading is prose', () => {
  const parsed = parseScope(lines(
    '##   ',
    '## Marks',
    '- [added] New',
    '- [removed]\tOld',
    '- [changed] Renamed',
    '  - was: Named',
    '- [Added] Capital',
    '- [addedx] Glued',
    '- [draft] Unknown bracket',
    '- [added]',
    '-   ',
  ));
  assert.equal(parsed.sections.length, 1, 'a heading that collapses to nothing opens no section');
  assert.deepEqual(prose(parsed.lead), ['##   ']);
  assert.deepEqual(items(parsed.sections[0]).map(item => [item.text, item.mark]), [
    ['New', 'added'],
    ['Old', 'removed'],
    ['Renamed', 'changed'],
    ['[Added] Capital', null],
    ['[addedx] Glued', null],
    ['[draft] Unknown bracket', null],
    ['', 'added'],
    ['', null],
  ]);
});

test('section slugs: a heading folds by foldTitle, falls back to section, and clashes are made distinct', () => {
  assert.equal(foldTitle('???'), 'screen', 'the screen fallback stays the default');
  assert.equal(foldTitle('???', 'section'), 'section');
  assert.equal(foldTitle('Café menu', 'section'), 'cafe-menu');

  const result = check(lines('## In scope', '- One', '## In scope!', '- Two', '## ???', '- Three', '## Index', '- Four', '## !!!', '- Five'));
  assert.deepEqual(result.sections.map(section => section.slug), ['in-scope', 'in-scope-2', 'section', 'index-2', 'section-2']);
  assert.deepEqual(result.sections.map(section => section.title), ['In scope', 'In scope!', '???', 'Index', '!!!']);
});

test('stripping drops removed items, the tags and the was lines, and keeps every section, its order and its prose', () => {
  const stripped = stripScope(parseScope(lines(
    '# Support inbox',
    'Lead prose',
    '## In scope',
    'Section prose',
    '- [changed] Reply from the ticket view',
    '  - was: Reply from the inbox',
    '- Assign a ticket',
    '- [added] Snooze a ticket',
    '## Out of scope',
    '- [removed] Bulk export',
    'Still here',
  )));
  assert.equal(stripped.title, 'Support inbox');
  assert.deepEqual(prose(stripped.lead), ['Lead prose']);
  assert.deepEqual(stripped.sections.map(section => section.heading), ['In scope', 'Out of scope']);
  assert.deepEqual(items(stripped.sections[0]).map(item => [item.text, item.mark, item.was]), [
    ['Reply from the ticket view', null, null],
    ['Assign a ticket', null, null],
    ['Snooze a ticket', null, null],
  ]);
  assert.deepEqual(items(stripped.sections[1]), [], 'a section left with no items stays');
  assert.deepEqual(prose(stripped.sections[0].blocks), ['Section prose']);
  assert.deepEqual(prose(stripped.sections[1].blocks), ['Still here']);
});

test('the check refuses scope-marks-invalid for each structural problem and each lie about the earlier scope', () => {
  const earlier = lines(
    '## In scope',
    '- Reply from the inbox',
    '- Assign a ticket',
    '## Out of scope',
    '- Bulk export',
  );
  const kept = '## Out of scope\n- Bulk export';
  const cases = [
    ['a duplicate heading', lines('## A', '- One', '## A', '- Two'), null, ['"A"', 'same heading']],
    ['a duplicate item text', lines('## A', '- One', '-  One'), null, ['"A"', '"One"', 'same text']],
    ['an empty item text', lines('## A', '- One', '- [added] '), lines('## A', '- One'), ['"A"', 'empty']],
    ['a was line on an unmarked item', lines('## A', '- One', '  - was: Zero'), null, ['"A"', '"One"', 'was']],
    ['a changed item with no was line', lines('## A', '- [changed] Two'), lines('## A', '- One'), ['"Two"', 'was']],
    ['a mark with no earlier scope', lines('## A', '- [added] One'), null, ['"A"', '"One"', 'no earlier scope']],
    ['an unmarked new item', lines('## In scope', '- Reply from the inbox', '- Assign a ticket', '- Snooze', kept), earlier, ['"In scope"', '"Snooze"', 'not in']],
    ['an added item that existed', lines('## In scope', '- Reply from the inbox', '- [added] Assign a ticket', kept), earlier, ['"Assign a ticket"', 'already lists it']],
    ['a removed item that never existed', lines('## In scope', '- Reply from the inbox', '- Assign a ticket', '- [removed] Ghost', kept), earlier, ['"Ghost"', 'does not list it']],
    ['a false was line', lines('## In scope', '- [changed] Reply from the ticket', '  - was: Reply from the outbox', '- Assign a ticket', '- Reply from the inbox', kept), earlier, ['"Reply from the ticket"', '"Reply from the outbox"']],
    ['a changed item whose text equals its was text', lines('## In scope', '- [changed] Reply from the inbox', '  - was: Reply from the inbox', '- Assign a ticket', kept), earlier, ['"Reply from the inbox"', 'same as its was text']],
    ['a changed item whose text is already earlier', lines('## In scope', '- [changed] Assign a ticket', '  - was: Reply from the inbox', '- Assign a ticket', kept), earlier, ['"Assign a ticket"', 'already an item']],
    ['an earlier item not accounted for', lines('## In scope', '- Reply from the inbox', kept), earlier, ['"In scope"', '"Assign a ticket"', 'not accounted for']],
    ['an absent earlier section that held items', lines('## In scope', '- Reply from the inbox', '- Assign a ticket'), earlier, ['"Out of scope"', '"Bulk export"', 'no "Out of scope" section']],
  ];
  for (const [what, text, before, named] of cases) {
    const message = refusal(() => check(text, before), 'scope-marks-invalid');
    for (const part of named) assert.ok(message.includes(part), `${what}: the message names ${part}: ${message}`);
    assert.match(message, /Nothing was written/, what);
    assert.match(message, /kept/, what);
  }

  const many = lines('## A', ...['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map(text => `- [added] ${text}`));
  const message = refusal(() => check(many), 'scope-marks-invalid');
  assert.ok(message.includes('"Five"') && !message.includes('"Six"'), `at most five problems are named: ${message}`);
  assert.match(message, /2 more/);

  assert.deepEqual(duplicates(parseScope(lines('## A', '- One', '- One', '## A', '- Two'))).map(each => [each.heading, each.text ?? null]),
    [['A', 'One'], ['A', null]], 'duplicates names each later duplicate, heading or item');
});

test('the check refuses scope-empty first, and otherwise returns the per-section counts and the marked sections', () => {
  refusal(() => check(lines('# Only a title', 'Lead', '## Empty')), 'scope-empty');
  refusal(() => check(lines('## A', '- [removed] One', 'Prose only', '## B', '- [removed] Two')), 'scope-empty');

  const first = check(lines('# Inbox', '## In scope', '- Reply', '- Assign', '## Out of scope', '- Export'));
  assert.deepEqual(first, {
    sections: [
      { slug: 'in-scope', title: 'In scope', items: 2, added: 0, removed: 0, changed: 0 },
      { slug: 'out-of-scope', title: 'Out of scope', items: 1, added: 0, removed: 0, changed: 0 },
    ],
    changed: [],
  });

  const earlier = lines('## In scope', '- [added] Reply from the inbox', '- Assign a ticket', '- [removed] Gone', '## Out of scope', '- Bulk export', '## Later', '- Dark mode');
  const marked = check(lines(
    '## In scope',
    '- [changed] Reply from the ticket view',
    '  - was: Reply from the inbox',
    '- Assign a ticket',
    '- [added] Snooze a ticket',
    '## Out of scope',
    '- [removed] Bulk export',
    '## Later',
    '- Dark mode',
    '## New section',
    '- [added] Keyboard shortcuts',
  ), earlier);
  assert.deepEqual(marked.sections, [
    { slug: 'in-scope', title: 'In scope', items: 3, added: 1, removed: 0, changed: 1 },
    { slug: 'out-of-scope', title: 'Out of scope', items: 0, added: 0, removed: 1, changed: 0 },
    { slug: 'later', title: 'Later', items: 1, added: 0, removed: 0, changed: 0 },
    { slug: 'new-section', title: 'New section', items: 1, added: 1, removed: 0, changed: 0 },
  ]);
  assert.deepEqual(marked.changed, ['in-scope', 'out-of-scope', 'new-section']);
});
