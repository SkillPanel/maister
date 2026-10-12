import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR } from '../helpers.mjs';

// A closed list of what a delegate is handed shadows the general rule that every
// delegate prompt carries the run context, so each closed "Context for …" list in
// the five built-in guides ends on the fetched output at the point of use.

const GUIDES = ['development', 'performance', 'migration', 'research', 'product-design'];
const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

const guide = name => fs.readFileSync(path.join(WORKFLOWS, `${name}.md`), 'utf8').replace(/\r\n/g, '\n');

/** The paragraphs of `text`, blank-line separated, trimmed, empty ones dropped. */
const paragraphs = text => text.split(/\n\s*\n/).map(each => each.trim()).filter(Boolean);

test('every closed "Context for …" list ends with the fetched run context', () => {
  let lists = 0;
  for (const name of GUIDES) {
    for (const paragraph of paragraphs(guide(name))) {
      const at = paragraph.search(/Context for [^:]+:/);
      if (at === -1) continue;
      lists += 1;
      const sentence = paragraph.slice(at).replace(/\s+/g, ' ');
      const end = sentence.search(/\.(\s|$)/);
      const list = end === -1 ? sentence : sentence.slice(0, end);
      assert.match(list, /plus the `(run-context|prior-context [^`]*--node[^`]*)` output$/,
        `${name}.md: "${list.slice(0, 90)}…" does not end with the run-context output`);
    }
  }
  assert.ok(lists >= 4, `only ${lists} closed context lists found; research alone has four`);
});
