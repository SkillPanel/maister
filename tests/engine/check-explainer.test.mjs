import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIXTURES, ROOT, run } from '../helpers.mjs';

// The explainer check, run as a child process the way the explainer writer and
// the steps that dispatch it run it: a scratch copy of the committed fixture
// per case, patched where a case needs one change, the JSON result and the exit
// code asserted. The clean fixture's figures are all stated by `report.md` or
// by the nested CSV under `findings/`; every number a case seeds is one those
// sources do not state, so a case that passes proves its rule rather than a
// coincidence (the ignore cases are checked for that by a control run).

const CHECK = path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/scripts/check-explainer.mjs');
const CLEAN = path.join(FIXTURES, 'explainer', 'clean');
const PAGE = 'research-explainer.html';
const SOURCES = ['report.md', 'findings'];
const ADDED = 'Added for the test';

/** A scratch copy of the clean fixture, removed when the test ends. */
function copy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maister-explainer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(CLEAN, dir, { recursive: true });
  return dir;
}

/** Replace the first `from` in the scratch file `rel` with `to`. */
function patch(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${rel} holds ${from}`);
  fs.writeFileSync(file, text.replace(from, to));
}

/** Add one section to the page, before its footer, with its own evidence link. */
function addSection(dir, html) {
  patch(dir, PAGE, '<footer', `<section><h2>${ADDED}</h2>\n${html}\n<a class="evidence" href="report.html#summary">Evidence: report, summary</a></section>\n<footer`);
}

/** Run the check from the scratch folder; the result parsed when there is one. */
function check(dir, sources = SOURCES) {
  const result = run(CHECK, [`--page=${PAGE}`, ...sources.map(each => `--source=${each}`)], undefined, {}, dir);
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // no result: asserted by the test
  }
  return { ...result, report };
}

const untraced = report => report.findings.filter(each => each.code === 'untraced-number').map(each => each.figure);

test('the clean fixture passes with every figure traced', t => {
  const dir = copy(t);
  const { code, report, stderr } = check(dir);
  assert.equal(code, 0, stderr);
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.equal(report.page, PAGE);
  assert.deepEqual(report.sources, SOURCES);
  assert.equal(typeof report.figures, 'number');
  assert.ok(report.figures > 20, `the page's figures are read (${report.figures})`);
  assert.equal(report.sections, 6, 'the answer header and five sections');
  assert.equal(report.evidence_links, 6);
});

test('a figure no source states is one untraced-number finding, with its section', t => {
  const cases = [
    { name: 'a chart value', from: '<b>14 min</b>', to: '<b>19 min</b>', figure: '19', section: 'Where the minutes go' },
    { name: 'a headline tile', from: '<b>23 min</b>', to: '<b>27 min</b>', figure: '27', section: 'Nightly builds wait on the cache, not on the compiler' },
    { name: 'a glued tile unit', from: '<b>23 min</b>', to: '<b>27min</b>', figure: '27min', section: 'Nightly builds wait on the cache, not on the compiler' },
  ];
  for (const each of cases) {
    const dir = copy(t);
    patch(dir, PAGE, each.from, each.to);
    const { code, report } = check(dir);
    assert.equal(code, 1, each.name);
    assert.equal(report.ok, false, each.name);
    assert.equal(report.findings.length, 1, `${each.name}: ${JSON.stringify(report.findings)}`);
    const [finding] = report.findings;
    assert.equal(finding.code, 'untraced-number', each.name);
    assert.equal(finding.figure, each.figure, each.name);
    assert.equal(finding.section, each.section, each.name);
    assert.equal(typeof finding.message, 'string', each.name);
  }
});

test('each normalisation traces a figure to the same value in a source', t => {
  // page: the figure on the page; source: what an extra source states;
  // written: the figures read from `page` (all flagged when no source states them);
  // untraced: the figures still flagged with `source` given.
  const cases = [
    { name: 'comma separator', page: '1,250 runs', source: '1250 runs', written: ['1,250'] },
    { name: 'two comma groups', page: '4,321,000 bytes', source: '4321000 bytes', written: ['4,321,000'] },
    { name: 'no-break space separator', page: '1 250 runs', source: '1250', written: ['1 250'] },
    { name: 'no-break space as an entity', page: '1&nbsp;250 runs', source: '1250', written: ['1 250'] },
    { name: 'thin space separator', page: '1 250 runs', source: '1250', written: ['1 250'] },
    { name: 'percent', page: '77% of runs', source: '77 of every hundred', written: ['77%'] },
    { name: 'trailing times sign', page: '71× faster', source: '71', written: ['71×'] },
    { name: 'trailing x', page: '73x faster', source: '73', written: ['73x'] },
    { name: 'leading times sign', page: '×1.7 the speed', source: '1.7', written: ['×1.7'] },
    { name: 'glued minutes', page: 'a 47min build', source: '47 minutes', written: ['47min'] },
    { name: 'glued gigabytes', page: '5.3GB restored', source: '5.3 GB', written: ['5.3GB'] },
    { name: 'en dash range', page: '76–78 runs', source: 'between 76 and 78', written: ['76', '78'] },
    { name: 'em dash range', page: '76—78 runs', source: '76 to 78', written: ['76', '78'] },
    { name: 'hyphen range', page: '76-78 runs', source: '76 or 78', written: ['76', '78'] },
    { name: 'a range is two figures', page: '76–78 runs', source: 'only 76', written: ['76', '78'], untraced: ['78'] },
    { name: 'minus sign', page: '−54 seconds', source: '54 seconds', written: ['54'] },
    { name: 'hyphen sign', page: 'a change of -54', source: '54', written: ['54'] },
    { name: 'plus sign', page: '+54 seconds', source: '54', written: ['54'] },
    { name: 'vulgar fraction', page: '3½ hours', source: '3.5 hours', written: ['3½'] },
    { name: 'a bare digit does not trace a fraction', page: '3½ hours', source: '3 hours', written: ['3½'], untraced: ['3½'] },
    { name: 'trailing zero', page: '0.50 of runs', source: '.5 of runs', written: ['0.50'] },
    { name: 'leading point', page: '.5 of runs', source: '0.50 of runs', written: ['.5'] },
    { name: 'clock, hour and minutes', page: 'at 07:45', source: 'at 7:45', written: ['07:45'] },
    { name: 'clock, with seconds', page: 'at 07:45:30', source: 'at 7:45:30', written: ['07:45:30'] },
  ];
  for (const each of cases) {
    const dir = copy(t);
    addSection(dir, `<p>${each.page}</p>`);
    fs.writeFileSync(path.join(dir, 'extra.md'), `# Extra\n\nNothing numeric here.\n`);
    const control = check(dir, [...SOURCES, 'extra.md']);
    assert.equal(control.code, 1, `${each.name}: flagged with no source stating it`);
    assert.deepEqual(untraced(control.report), each.written, `${each.name}: read as written`);
    for (const finding of control.report.findings) assert.equal(finding.section, ADDED, each.name);

    fs.writeFileSync(path.join(dir, 'extra.md'), `# Extra\n\n${each.source}\n`);
    const traced = check(dir, [...SOURCES, 'extra.md']);
    const expected = each.untraced ?? [];
    assert.equal(traced.code, expected.length === 0 ? 0 : 1, `${each.name}: ${JSON.stringify(traced.report.findings)}`);
    assert.deepEqual(untraced(traced.report), expected, each.name);
  }
});

test('dates, versions, section marks, glued identifiers, words and markup raise no figure', t => {
  const cases = [
    { name: 'ISO date', html: '<p>Measured on 2031-07-27.</p>' },
    { name: 'ISO datetime', html: '<p>Started 2031-07-27T08:47:51Z, ended 2031-07-27 08:47.</p>' },
    { name: 'month-name dates', html: '<p>On July 27, 2031, on 27 July 2031, on Jul 27 and in July 2031.</p>' },
    { name: 'v-prefixed versions', html: '<p>Since v7.31 and v7.</p>' },
    { name: 'three dotted parts', html: '<p>Fixed in 5.17.29.</p>' },
    { name: 'a pre-release version', html: '<p>Tried on 5.17.29-beta.731.</p>' },
    { name: 'section marks', html: '<p>See §83, § 83 and § 83.4.</p>' },
    { name: 'glued identifiers', html: '<p>The sha256 digest, line L340, the h2 heading, an x86 runner.</p>' },
    { name: 'spelled-out numbers', html: '<p>Three options and twelve builds, about twice a month.</p>' },
    { name: 'style block', html: '<style>.wide { width: 743px; }</style><p>Wide.</p>' },
    { name: 'script block', html: '<script>const limit = 751;</script><p>Limited.</p>' },
    { name: 'comment', html: '<!-- 761 builds were sampled --><p>Sampled.</p>' },
    { name: 'svg geometry', html: '<svg viewBox="0 0 937 150"><rect x="713" y="12" width="917" height="44"/><path d="M731 75 H768"/><polyline points="701 702 703 704"/><text x="713" y="30">Restore</text></svg>' },
    { name: 'style and data attributes', html: '<div style="width:719%" data-count="733" id="bar-739" class="w-737"></div>' },
  ];
  for (const each of cases) {
    const dir = copy(t);
    addSection(dir, each.html);
    const { code, report } = check(dir);
    assert.equal(code, 0, `${each.name}: ${JSON.stringify(report?.findings)}`);
    assert.deepEqual(report.findings, [], each.name);
  }

  // Control: the same digits written as plain figures are flagged, so no case
  // above passes because a source happens to state its number.
  const digits = ['2031', '7', '27', '8', '47', '51', '31', '5', '17', '29', '731', '83', '4', '256', '340', '2', '86', '743', '751', '761', '937', '713', '917', '768', '719', '733', '739', '737', '701', '702', '703', '704'];
  const dir = copy(t);
  addSection(dir, `<p>${digits.join(' ; ')}</p>`);
  const control = check(dir);
  assert.equal(control.code, 1);
  assert.deepEqual(untraced(control.report), digits);
});

test('title, aria-label and alt values are read, and no other attribute', t => {
  const cases = [
    { name: 'title', html: '<span title="Restore took 977 seconds">restore</span>' },
    { name: 'aria-label', html: '<svg role="img" aria-label="977 runs sampled" viewBox="0 0 10 10"></svg>' },
    { name: 'alt', html: '<img src="chart.png" alt="977 runs sampled">' },
  ];
  for (const each of cases) {
    const dir = copy(t);
    addSection(dir, each.html);
    const { code, report } = check(dir);
    assert.equal(code, 1, each.name);
    assert.deepEqual(report.findings.map(({ code: c, figure, section }) => ({ code: c, figure, section })), [{ code: 'untraced-number', figure: '977', section: ADDED }], each.name);
  }
  const dir = copy(t);
  addSection(dir, '<span data-note="977 runs" lang="en-977">restore</span>');
  assert.equal(check(dir).code, 0, 'an attribute other than the three is not read');
});

test('a folder source is read recursively for the listed file types only, never the page itself', t => {
  // The chart's "6 min" is stated only by findings/timing/stages.csv.
  const dir = copy(t);
  const without = check(dir, ['report.md']);
  assert.equal(without.code, 1);
  assert.deepEqual(without.report.findings.map(({ figure, section }) => ({ figure, section })), [{ figure: '6', section: 'Where the minutes go' }]);
  assert.equal(check(dir, ['report.md', 'findings']).code, 0, 'the nested CSV traces it');

  for (const ext of ['md', 'html', 'txt', 'json', 'yml', 'yaml']) {
    const each = copy(t);
    addSection(each, '<p>Sampled 977 runs.</p>');
    fs.mkdirSync(path.join(each, 'findings', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(each, 'findings', 'deeper', `sample.${ext}`), ext === 'html' ? '<p>977 runs</p>' : 'runs: 977\n');
    assert.equal(check(each).code, 0, `a nested .${ext} is read`);
  }

  // A file type outside the list is not read, and the page is never its own
  // source, even when a folder source holds it.
  const other = copy(t);
  addSection(other, '<p>Sampled 977 runs.</p>');
  fs.writeFileSync(path.join(other, 'findings', 'timing', 'runs.log'), 'runs: 977\n');
  for (const sources of [SOURCES, ['.']]) {
    const { code, report } = check(other, sources);
    assert.equal(code, 1, sources.join(' '));
    assert.deepEqual(untraced(report), ['977'], sources.join(' '));
  }
});

test('a source\'s comma-separated three-digit values trace each value, and the grouped figure too', t => {
  // A CSV row or a JSON array states 120 and 340 as two values; read as one
  // grouped figure they also state 120,340. The page side reads a comma group
  // as one figure only, so 120,340 on the page is not traced by 120 and 340
  // stated apart.
  const sources = {
    'a CSV row': ['sizes.csv', 'stage,first,second\nbuild,120,340\n'],
    'a JSON array': ['sizes.json', '{"build": [120,340]}\n'],
  };
  for (const [name, [file, text]] of Object.entries(sources)) {
    const dir = copy(t);
    addSection(dir, '<p>Build took 120 s, then 340 s; 120,340 bytes in all.</p>');
    const control = check(dir);
    assert.equal(control.code, 1, `${name}: flagged with no source stating them`);
    assert.deepEqual(untraced(control.report), ['120', '340', '120,340'], `${name}: read as written`);

    fs.writeFileSync(path.join(dir, 'findings', 'timing', file), text);
    const traced = check(dir);
    assert.equal(traced.code, 0, `${name}: ${JSON.stringify(traced.report.findings)}`);
    assert.deepEqual(traced.report.findings, [], name);
  }

  const apart = copy(t);
  addSection(apart, '<p>120,340 bytes in all.</p>');
  fs.writeFileSync(path.join(apart, 'findings', 'timing', 'sizes.json'), '{"first": 120, "second": 340}\n');
  assert.deepEqual(untraced(check(apart).report), ['120,340'], 'the page never splits a comma group');
});

test('a prose source\'s thousands-grouped figure is one value, never its comma-separated parts', t => {
  // Only a CSV or JSON source reads a comma group as separate values: in
  // prose 1,200 is twelve hundred, so it traces neither 1 nor 200 on the page.
  const page = '<p>The pilot reached 200 users and 1 team.</p>';
  const prose = 'The pilot reached 1,200 users.\n';
  const control = copy(t);
  addSection(control, page);
  assert.deepEqual(untraced(check(control).report), ['200', '1'], 'flagged with no source stating them');

  for (const file of ['pilot.md', 'pilot.MD', 'pilot.txt']) {
    const dir = copy(t);
    addSection(dir, page);
    fs.writeFileSync(path.join(dir, 'findings', 'timing', file), prose);
    const { code, report } = check(dir);
    assert.equal(code, 1, file);
    assert.deepEqual(untraced(report), ['200', '1'], file);
  }

  // The same text in a CSV source, whatever the extension's case, is fields.
  const fields = copy(t);
  addSection(fields, page);
  fs.writeFileSync(path.join(fields, 'findings', 'timing', 'pilot.CSV'), prose);
  assert.deepEqual(untraced(check(fields).report), [], 'a CSV source splits the group');
});

// ---------------------------------------------------------------- links, containment and usage

const TARGETS = path.join(FIXTURES, 'explainer', 'targets');
const HEADLINE = 'Nightly builds wait on the cache, not on the compiler';
const HEADER_LINK = '<a class="evidence" href="report.html#summary">';

/** A scratch copy of the clean fixture with the target pages (`targets/`) beside it. */
function copyWithTargets(t) {
  const dir = copy(t);
  fs.cpSync(TARGETS, dir, { recursive: true });
  return dir;
}

/** The findings of one code, each reduced to the fields named. */
const found = (report, code, fields) => report.findings
  .filter(each => each.code === code)
  .map(each => Object.fromEntries(fields.map(field => [field, each[field]])));

test('a section or the answer header with no a.evidence link is a section-without-evidence finding', t => {
  const cases = [
    { name: 'a section', from: '<a class="evidence" href="report.html#timing-breakdown">', to: '<a href="report.html#timing-breakdown">', section: 'Where the minutes go' },
    { name: 'the answer header', from: HEADER_LINK, to: '<a href="report.html#summary">', section: HEADLINE },
    { name: 'the class ev alone', from: '<a class="evidence" href="report.html#how-the-pipeline-runs">', to: '<a class="ev" href="report.html#how-the-pipeline-runs">', section: 'How a build spends its time' },
  ];
  for (const each of cases) {
    const dir = copy(t);
    patch(dir, PAGE, each.from, each.to);
    const { code, report } = check(dir);
    assert.equal(code, 1, each.name);
    assert.deepEqual(report.findings.map(({ code: c, section }) => ({ code: c, section })), [{ code: 'section-without-evidence', section: each.section }], each.name);
    assert.equal(typeof report.findings[0].message, 'string', each.name);
  }

  // A link anywhere inside the block counts: in a decision card, with more classes, or in a nested section.
  const nested = copy(t);
  addSection(nested, '<div class="dec"><section><h3>A card</h3><a class="small evidence" href="report.html#recommendations">Evidence</a></section></div>');
  patch(nested, PAGE, `<section><h2>${ADDED}</h2>`, `<section><h2>${ADDED} too</h2><section><h2>Inner</h2><div class="dec"><a class="evidence link" href="report.html#summary">Evidence</a></div></section></section>\n<section><h2>${ADDED}</h2>`);
  const { code, report } = check(nested);
  assert.equal(code, 0, JSON.stringify(report.findings));
  assert.equal(report.sections, 10);
});

test('a link to a missing file, or one that is not a relative path, is an evidence-target-missing finding', t => {
  const hrefs = ['report-old.html#summary', 'findings/missing.md#summary', 'https://example.com/report.html#summary', '//example.com/report.html#summary', '/report.html#summary', '#summary', 'mailto:team@example.com', 'findings'];
  for (const href of hrefs) {
    const dir = copy(t);
    patch(dir, PAGE, HEADER_LINK, `<a class="evidence" href="${href}">`);
    const { code, report } = check(dir);
    assert.equal(code, 1, href);
    assert.deepEqual(report.findings.map(({ code: c, href: h, section }) => ({ code: c, href: h, section })), [{ code: 'evidence-target-missing', href, section: HEADLINE }], href);
  }
  // An a.evidence with no href at all is one too.
  const dir = copy(t);
  patch(dir, PAGE, HEADER_LINK, '<a class="evidence">');
  assert.deepEqual(found(check(dir).report, 'evidence-target-missing', ['href', 'section']), [{ href: null, section: HEADLINE }]);
});

test('a link with no fragment, or a fragment the target does not hold, is an evidence-anchor-missing finding', t => {
  const cases = [
    { href: 'report.html#nowhere', missing: true },
    { href: 'report.html', missing: true },
    { href: 'report.html#', missing: true },
    { href: 'report.html#Summary', missing: true },
    { href: 'report.md#nowhere', missing: true },
    { href: 'report.md', missing: true },
    { href: 'findings/timing/stages.csv#restore', missing: true },
    { href: 'report.html#nightly-build-report', missing: false },
    { href: './report.md#timing-breakdown', missing: false },
    { href: 'findings/cache-timing.md?plain=1#cache-timing', missing: false },
  ];
  for (const each of cases) {
    const dir = copy(t);
    patch(dir, PAGE, HEADER_LINK, `<a class="evidence" href="${each.href}">`);
    const { code, report } = check(dir);
    if (!each.missing) {
      assert.equal(code, 0, `${each.href}: ${JSON.stringify(report.findings)}`);
      continue;
    }
    assert.equal(code, 1, each.href);
    assert.deepEqual(report.findings.map(({ code: c, href, section }) => ({ code: c, href, section })), [{ code: 'evidence-anchor-missing', href: each.href, section: HEADLINE }], each.href);
  }
  // Ids inside a <script> or <style> are not anchors.
  const dir = copy(t);
  patch(dir, 'report.html', '</main>', '<script>const html = \'<p id="scripted"></p>\';</script></main>');
  patch(dir, PAGE, HEADER_LINK, '<a class="evidence" href="report.html#scripted">');
  assert.deepEqual(found(check(dir).report, 'evidence-anchor-missing', ['href']), [{ href: 'report.html#scripted' }]);
});

test('a markdown target\'s anchors are the GitHub-style slugs of its headings outside code fences', t => {
  const cases = [
    { name: 'punctuation removed, a space run kept', slug: 'cache-what-why--how', anchor: true },
    { name: 'A — B becomes a--b', slug: 'restore--upload', anchor: true },
    { name: 'the first of a repeated heading', slug: 'timing', anchor: true },
    { name: 'a repeat takes -1', slug: 'timing-1', anchor: true },
    { name: 'no third repeat', slug: 'timing-2', anchor: false },
    { name: 'code marks and * removed, _ kept', slug: 'the-cache_key-and-per-branch-scope', anchor: true },
    { name: 'a link replaced by its text, _ kept', slug: 'see-the-build_log-now', anchor: true },
    { name: 'closing hashes dropped', slug: 'closing-hashes', anchor: true },
    { name: 'letters and marks of any script kept', slug: 'zażółć-gęślą-jaźń', anchor: true },
    { name: 'the h1 is a heading too', slug: 'heading-slugs', anchor: true },
    { name: 'a heading inside a backtick fence', slug: 'inside-a-fence', anchor: false },
    { name: 'a heading inside a tilde fence', slug: 'inside-a-tilde-fence', anchor: false },
    { name: 'an indented code line', slug: 'indented-as-code', anchor: false },
  ];
  for (const each of cases) {
    const dir = copyWithTargets(t);
    patch(dir, PAGE, HEADER_LINK, `<a class="evidence" href="slugs.md#${each.slug}">`);
    const { code, report } = check(dir);
    assert.equal(code, each.anchor ? 0 : 1, `${each.name}: ${JSON.stringify(report.findings)}`);
    assert.deepEqual(found(report, 'evidence-anchor-missing', ['href']), each.anchor ? [] : [{ href: `slugs.md#${each.slug}` }], each.name);
  }
  // A fragment written percent-encoded reads as the same slug.
  const dir = copyWithTargets(t);
  patch(dir, PAGE, HEADER_LINK, `<a class="evidence" href="slugs.md#${encodeURIComponent('zażółć-gęślą-jaźń')}">`);
  assert.equal(check(dir).code, 0);
});

test('every external-resource form is a finding, and a relative image is none', t => {
  const forms = [
    { name: 'a stylesheet link', html: '<link rel="stylesheet" href="theme.css">' },
    { name: 'a preconnect link', html: '<link rel="preconnect" href="https://fonts.example.com">' },
    { name: 'a script src, even relative', html: '<script src="app.js"></script>' },
    { name: 'an iframe', html: '<iframe src="frame.html"></iframe>' },
    { name: 'an object', html: '<object data="chart.svg"></object>' },
    { name: 'an embed', html: '<embed src="chart.svg">' },
    { name: 'an https src', html: '<img src="https://example.com/chart.png">' },
    { name: 'an http src', html: '<img src="HTTP://example.com/chart.png">' },
    { name: 'a protocol-relative src', html: '<img src="//example.com/chart.png">' },
    { name: 'a srcset candidate', html: '<img src="chart.png" srcset="chart.png 1x, https://example.com/chart@2x.png 2x">' },
    { name: 'a poster', html: '<video poster="//example.com/still.jpg"></video>' },
    { name: '@import in a style block', html: '<style>@import "theme.css";</style>' },
    { name: 'url( to https in a style block', html: '<style>.hero { background: url("https://example.com/bg.png"); }</style>' },
    { name: 'url( to // in a style block', html: '<style>.hero { background: url( //example.com/bg.png ); }</style>' },
    { name: '@import in a style attribute', html: '<div style="@import url(theme.css)"></div>' },
    { name: 'url( to http in a style attribute', html: '<div style="background-image:url(\'http://example.com/bg.png\')"></div>' },
  ];
  for (const each of forms) {
    const dir = copy(t);
    addSection(dir, each.html);
    const { code, report } = check(dir);
    assert.equal(code, 1, each.name);
    assert.deepEqual(report.findings.map(({ code: c, section }) => ({ code: c, section })), [{ code: 'external-resource', section: ADDED }], `${each.name}: ${JSON.stringify(report.findings)}`);
  }
  const local = ['<img src="chart.png">', '<img src="chart.png" srcset="chart.png 1x, chart@2x.png 2x">', '<div style="background:url(bg.png)"></div>', '<style>.hero { background: url(data:image/png;base64,AAAA); }</style>', '<p>See https://example.com for the vendor notes.</p>', '<a href="https://example.com/notes">notes</a>'];
  for (const html of local) {
    const dir = copy(t);
    addSection(dir, html);
    const { code, report } = check(dir);
    assert.equal(code, 0, `${html}: ${JSON.stringify(report.findings)}`);
  }
});

test('a mermaid class, a language-mermaid class or a mermaid fence is a raw-mermaid finding', t => {
  const cases = [
    { name: 'mermaid class', html: '<pre class="diagram mermaid">graph TD; Checkout --> Restore</pre>' },
    { name: 'language-mermaid class', html: '<pre><code class="language-mermaid">graph TD; Checkout --> Restore</code></pre>' },
    { name: 'backtick fence in text', html: '<pre>```mermaid\ngraph TD; Checkout --> Restore\n```</pre>' },
    { name: 'tilde fence in text', html: '<p>~~~ mermaid graph TD</p>' },
  ];
  for (const each of cases) {
    const dir = copy(t);
    addSection(dir, each.html);
    const { code, report } = check(dir);
    assert.equal(code, 1, each.name);
    assert.deepEqual(report.findings.map(({ code: c, section }) => ({ code: c, section })), [{ code: 'raw-mermaid', section: ADDED }], `${each.name}: ${JSON.stringify(report.findings)}`);
  }
  const dir = copy(t);
  addSection(dir, '<p>The diagram is drawn by hand; no mermaid source is shipped.</p>');
  assert.equal(check(dir).code, 0, 'the word alone is none');
});

test('an .html evidence target whose crumbs bar lacks a link back is one backlink-missing finding', t => {
  // Two links to the same target without a backlink: one finding, href the target.
  const dir = copyWithTargets(t);
  patch(dir, PAGE, HEADER_LINK, '<a class="evidence" href="report-no-backlink.html#summary">');
  patch(dir, PAGE, '<a class="evidence" href="report.html#how-the-pipeline-runs">', '<a class="evidence" href="report-no-backlink.html#top">');
  const missing = check(dir);
  assert.equal(missing.code, 1);
  assert.deepEqual(missing.report.findings.map(({ code: c, href }) => ({ code: c, href })), [{ code: 'backlink-missing', href: 'report-no-backlink.html' }]);
  assert.equal(typeof missing.report.findings[0].message, 'string');

  // A crumb resolved against the target's own folder: right from analysis/, wrong from there.
  const cases = [
    { href: 'analysis/design.html#summary', findings: [] },
    { href: 'analysis/unresolved.html#summary', findings: [{ code: 'backlink-missing', href: 'analysis/unresolved.html' }] },
    { href: 'report-no-crumbs.html#summary', findings: [] },
    { href: 'report.md#summary', findings: [] },
  ];
  for (const each of cases) {
    const one = copyWithTargets(t);
    patch(one, PAGE, HEADER_LINK, `<a class="evidence" href="${each.href}">`);
    const { code, report } = check(one);
    assert.equal(code, each.findings.length === 0 ? 0 : 1, `${each.href}: ${JSON.stringify(report.findings)}`);
    assert.deepEqual(report.findings.map(({ code: c, href }) => ({ code: c, href })), each.findings, each.href);
  }
});

test('the check exits 2 with stdout empty when it cannot run', t => {
  const dir = copy(t);
  fs.mkdirSync(path.join(dir, 'a-folder'));
  const cases = [
    { name: 'no --page', args: ['--source=report.md'] },
    { name: 'no --source', args: [`--page=${PAGE}`] },
    { name: '--page twice', args: [`--page=${PAGE}`, `--page=${PAGE}`, '--source=report.md'] },
    { name: 'an unknown argument', args: [`--page=${PAGE}`, '--source=report.md', '--strict'] },
    { name: 'a flag with no value', args: [`--page=${PAGE}`, '--source'] },
    { name: 'a missing source', args: [`--page=${PAGE}`, '--source=report.md', '--source=no-such-folder'] },
    { name: 'a missing page', args: ['--page=no-such-page.html', '--source=report.md'] },
    { name: 'a folder as the page', args: ['--page=a-folder', '--source=report.md'] },
  ];
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!root && process.platform !== 'win32') {
    fs.writeFileSync(path.join(dir, 'locked.html'), '<p>locked</p>');
    fs.chmodSync(path.join(dir, 'locked.html'), 0o000);
    cases.push({ name: 'an unreadable page', args: ['--page=locked.html', '--source=report.md'] });
  }
  for (const each of cases) {
    const { code, stdout, stderr } = run(CHECK, each.args, undefined, {}, dir);
    assert.equal(code, 2, each.name);
    assert.equal(stdout, '', each.name);
    assert.match(stderr, /^check-explainer: .+\nusage: node check-explainer\.mjs --page=/, each.name);
  }
});

test('an unexpected error exits 2 with stdout empty and one message, never as findings', { skip: process.platform === 'win32' }, t => {
  // The working folder is removed before the check starts, so resolving the
  // relative page path throws an error that is neither a usage nor a read error.
  const dir = copy(t);
  const gone = path.join(dir, 'gone');
  fs.mkdirSync(gone);
  const shell = spawnSync('sh', ['-c', `cd "$1" && rmdir "$1" && node "$2" --page=report.html --source=report.md`, 'sh', gone, CHECK], { encoding: 'utf8' });
  assert.equal(shell.status, 2);
  assert.equal(shell.stdout, '');
  assert.match(shell.stderr, /^check-explainer: unexpected error: .+\n$/);
});

test('every id the clean report page carries is the slug the check derives from the matching markdown heading', t => {
  // The style guide's slug rule and the check's slug function must agree: each
  // heading of report.md, linked by the id the page gives it, resolves.
  const dir = copy(t);
  const ids = [...fs.readFileSync(path.join(dir, 'report.html'), 'utf8').matchAll(/<h[23] id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['summary', 'how-the-pipeline-runs', 'timing-breakdown', 'incident-on-the-release-night', 'options-compared', 'recommendations']);
  for (const id of ids) {
    const one = copy(t);
    patch(one, PAGE, HEADER_LINK, `<a class="evidence" href="report.md#${id}">`);
    const { code, report } = check(one);
    assert.equal(code, 0, `${id}: ${JSON.stringify(report.findings)}`);
  }
});

test('the style guide\'s "A — B" example slugs to a--b in the check', t => {
  const guide = fs.readFileSync(path.join(ROOT, 'plugins/maister/skills/orchestrator-framework/references/html-report-style.md'), 'utf8');
  assert.ok(guide.includes('"A — B" becomes `a--b`'));
  const dir = copyWithTargets(t);
  fs.writeFileSync(path.join(dir, 'dash.md'), '# T\n\n## A — B\n');
  patch(dir, PAGE, HEADER_LINK, '<a class="evidence" href="dash.md#a--b">');
  assert.equal(check(dir).code, 0, 'a--b resolves');
  patch(dir, PAGE, 'dash.md#a--b', 'dash.md#a-b');
  assert.deepEqual(found(check(dir).report, 'evidence-anchor-missing', ['href']).length, 1, 'a-b does not');
});

test('a report page without the crumb gives backlink-missing; the crumb inserted after the Dashboard link passes with every other byte unchanged', t => {
  const dir = copyWithTargets(t);
  patch(dir, PAGE, HEADER_LINK, '<a class="evidence" href="report-no-backlink.html#summary">');
  const before = check(dir);
  assert.equal(before.code, 1);
  assert.deepEqual(before.report.findings.map(each => each.code), ['backlink-missing']);

  const file = path.join(dir, 'report-no-backlink.html');
  const text = fs.readFileSync(file, 'utf8');
  const dashboard = '<a href="../dashboard.html">&larr; Dashboard</a>';
  const crumb = '<a href="research-explainer.html">Explainer</a>';
  const next = text.replace(dashboard, dashboard + crumb);
  assert.equal(next.length, text.length + crumb.length);
  assert.equal(next.replace(crumb, ''), text, 'only the crumb was inserted');
  fs.writeFileSync(file, next);
  const after = check(dir);
  assert.equal(after.code, 0, JSON.stringify(after.report.findings));
});
