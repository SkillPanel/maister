import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ENGINE_DIR } from '../helpers.mjs';

// The five built-in guides hand every delegate the run context the engine
// prints, rather than a list of fields composed by hand. A closed list in a
// node's prose shadows a general rule stated far away, so each closed list ends
// on the run context itself, and the companions a node owes come from its
// definition, never from a list the model has to remember.

const GUIDES = ['development', 'performance', 'migration', 'research', 'product-design'];
const WORKFLOWS = path.join(ENGINE_DIR, 'workflows');

const guide = name => fs.readFileSync(path.join(WORKFLOWS, `${name}.md`), 'utf8').replace(/\r\n/g, '\n');

/** The text of the `## <heading>` section (exact heading line), up to the next `## `. */
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `no ${heading} section`);
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** The paragraphs of `text`, blank-line separated, trimmed, empty ones dropped. */
const paragraphs = text => text.split(/\n\s*\n/).map(each => each.trim()).filter(Boolean);

test('no guide counts the run-scoped fields by hand', () => {
  for (const name of GUIDES) {
    const text = guide(name);
    for (const stale of [/four fields/i, /run-scoped\s+four/i, /run-scoped\s+five/i, /html_style_guide_path/]) {
      assert.doesNotMatch(text, stale, `${name}.md still says ${stale}`);
    }
  }
});

test('each Run-scoped context section opens with a pointer of five lines or fewer naming run-context --node', () => {
  for (const name of GUIDES) {
    const body = section(guide(name), '## Run-scoped context');
    const [pointer] = paragraphs(body);
    assert.ok(pointer.split('\n').length <= 5, `${name}.md: the pointer runs ${pointer.split('\n').length} lines`);
    assert.match(pointer, /`run-context --node=<this node>`/, `${name}.md: the pointer does not name run-context --node`);
    assert.match(pointer, /`prior-context --node=<this node>`/, `${name}.md: the pointer does not name prior-context --node for artifact writers`);
    assert.match(pointer, /unedited/, `${name}.md: the pointer does not say the output is pasted unedited`);
    assert.doesNotMatch(body, /get an HTML companion/, `${name}.md: the section still enumerates the companions by hand`);
  }
});

test('every closed "Context for …" list ends with the run-context output', () => {
  let lists = 0;
  for (const name of GUIDES) {
    for (const paragraph of paragraphs(guide(name))) {
      const at = paragraph.search(/Context for [^:]+:/);
      if (at === -1) continue;
      lists += 1;
      const sentence = paragraph.slice(at).replace(/\s+/g, ' ');
      const end = sentence.search(/\.(\s|$)/);
      const list = end === -1 ? sentence : sentence.slice(0, end);
      assert.ok(list.endsWith('plus the `run-context` output'), `${name}.md: "${list.slice(0, 90)}…" does not end with the run-context output`);
    }
  }
  assert.ok(lists >= 4, `only ${lists} closed context lists found; research alone has four`);
});

test('product-design: each direct: node owing a companion hands its markdown to html-companion-writer before its completion write', () => {
  const yml = fs.readFileSync(path.join(WORKFLOWS, 'product-design.yml'), 'utf8').replace(/\r\n/g, '\n');
  const block = /^html_companions:\n((?: {2}.*\n)+)/m.exec(yml);
  assert.ok(block, 'product-design.yml declares html_companions');
  const owing = [...block[1].matchAll(/^ {2}([a-z][a-z0-9-]*):/gm)].map(match => match[1]);
  const direct = owing.filter(node => new RegExp(`^ {2}${node}:\\n {4}uses: direct:`, 'm').test(yml));
  assert.deepEqual(direct, ['idea-convergence', 'feature-specification', 'review-handoff']);
  const text = guide('product-design');
  for (const node of direct) {
    const body = section(text, `## \`${node}\``).replace(/\s+/g, ' ');
    assert.match(body, /html-companion-writer[^.]*before this node's completion write/, `${node}: no html-companion-writer hand-off before the completion write`);
  }
  const shared = section(text, '## Run-scoped context').replace(/\s+/g, ' ');
  assert.match(shared, /`maister:html-companion-writer`/, 'the hand-off itself is stated once in Run-scoped context');
  assert.match(shared, /plus the `run-context` output/, 'the companion writer gets the run context too');
});

test('callers read the new result fields: e2e-verification reads verdict and companion, research reads the synthesizer\'s companion', () => {
  const e2e = section(guide('development'), '## `e2e-verification`').replace(/\s+/g, ' ');
  assert.match(e2e, /`verdict`/, 'e2e-verification reads the verifier\'s verdict');
  assert.match(e2e, /`companion`/, 'e2e-verification reads the verifier\'s companion');
  assert.match(e2e, /`not-requested`[^.]*run context/, 'not-requested re-delegates with the run context');
  assert.match(e2e, /`failed`[^.]*html-companion-writer[^.]*once/, 'failed runs the companion writer once');
  assert.match(e2e, /plus the `run-context` output/, 'the verifier is handed the run context');

  const foundation = section(guide('research'), '## `research-foundation`').replace(/\s+/g, ' ');
  assert.match(foundation, /synthesizer's `companion`/, 'research-foundation reads the synthesizer\'s companion');
  assert.match(foundation, /`not-requested`[^.]*run context/, 'not-requested re-delegates with the run context');
  assert.match(foundation, /`failed`[^.]*html-companion-writer[^.]*once/, 'failed runs the companion writer once');

  for (const [name, node] of [['development', 'finalization'], ['performance', 'finalization'], ['migration', 'finalization'], ['research', 'completion'], ['product-design', 'completion']]) {
    const body = section(guide(name), `## \`${node}\``);
    assert.match(body, /`missing-artifact:`/, `${name}.md ${node} relays missing-artifact lines`);
    assert.match(body, /`missing-companion:`/, `${name}.md ${node} relays missing-companion lines`);
    assert.doesNotMatch(body, /compare every\s+artifact the run declared/, `${name}.md ${node} still reconciles by hand`);
  }
});
