/**
 * The markup a turn publishes: one page per screen, the version's gallery and
 * the `.mockups.json` manifest.
 *
 * A page is `assets/template.html` filled in one pass with a function
 * replacer, so content holding `$&`, `$1` or a placeholder's own spelling is
 * written as it is. Titles and navigation are HTML-escaped; annotations go in
 * as JSON with every `<` written `<`, so no annotation can close the
 * script that holds it. The content is `<style>{css}</style>` and
 * `<div id="mockup-content">{html}</div>` inside `<main id="mockup-container">`
 * — the markup the end-to-end verifier takes a screen's html and css from.
 *
 * Navigation links only sibling `<slug>.html` pages and never the gallery, so
 * a page resolves the same inside its version folder and in its flat copy one
 * level up. The gallery is one self-contained page: inline CSS, nothing loaded
 * from outside, each card linking a sibling page. A card's preview is the
 * screen alone, unframed: its own css and html in a private frame (`srcdoc`,
 * `sandbox` with scripts off), never the studio page with its title bar, tabs
 * and notes around it.
 *
 * A written version's page is its `scope.md` rendered: self-contained like the
 * gallery and on its base styles, with no script, every text escaped and no
 * markdown formatting read. Each section is anchored by its slug; marked items
 * are highlighted, removed ones struck through, and a changed item shows the
 * text it replaced.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

const PLACEHOLDER = /\{\{(TITLE|NAV|CONTENT|ANNOTATIONS)\}\}/g;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe inside a `<script>` element. */
export function scriptJson(value) {
  return JSON.stringify(value ?? []).replace(/</g, '\\u003c');
}

function nav(screens, current) {
  if (screens.length < 2) return '';
  const links = screens.map(screen => {
    const active = screen.slug === current ? ' active' : '';
    return `<a class="nav-screen${active}" href="${screen.slug}.html">${escapeHtml(screen.title)}</a>`;
  });
  return `<nav class="screen-nav"><div class="nav-screens">${links.join('')}</div></nav>`;
}

/** One screen's page. `screens` is the version's `[{slug, title}]`, for the navigation. */
export function renderPage(template, screen, screens) {
  const values = {
    TITLE: escapeHtml(screen.title),
    NAV: nav(screens, screen.slug),
    CONTENT: `<style>${screen.css ?? ''}</style>\n<div id="mockup-content">${screen.html ?? ''}</div>`,
    ANNOTATIONS: scriptJson(screen.annotations ?? []),
  };
  return template.replace(PLACEHOLDER, (_, key) => values[key]);
}

const GALLERY_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f5; color: #222; }
header { padding: 1rem 1.5rem; background: #fff; border-bottom: 1px solid #ddd; }
header h1 { margin: 0 0 0.25rem; font-size: 1.2rem; }
header p { margin: 0.25rem 0 0; color: #555; font-size: 0.9rem; white-space: pre-wrap; }
header a { color: #0066cc; font-size: 0.85rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; padding: 1.5rem; }
.card { display: block; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; text-decoration: none; color: inherit; }
.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.card-title { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid #eee; background: #fafafa; }
.changed { font-size: 0.75rem; font-weight: 600; color: #fff; background: #2563eb; border-radius: 3px; padding: 0.1rem 0.4rem; }
.preview { height: 230px; overflow: hidden; background: #fff; }
.preview iframe { width: 1280px; height: 820px; border: 0; transform: scale(0.27); transform-origin: top left; pointer-events: none; }
`;

/** The screen's own document, as a card's private frame shows it: no studio chrome, no annotations. */
function bareScreen(screen) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}${screen.css ?? ''}</style></head><body>${screen.html ?? ''}</body></html>`;
}

/** The version's gallery, `versions/<version>/index.html`. */
export function renderGallery({ version, note, parent, screens }) {
  const changedCount = screens.filter(screen => screen.changed).length;
  const parentLink = parent ? `<a href="../${parent}/index.html">Previous version: ${escapeHtml(parent)}</a>` : '';
  const cards = screens.map(screen => [
    `<a class="card" href="${screen.slug}.html">`,
    `<div class="card-title"><span>${escapeHtml(screen.title)}</span>${screen.changed ? '<span class="changed">Changed</span>' : ''}</div>`,
    `<div class="preview"><iframe srcdoc="${escapeHtml(bareScreen(screen))}" sandbox="" loading="lazy" tabindex="-1" title="${escapeHtml(screen.title)}"></iframe></div>`,
    '</a>',
  ].join(''));
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>Mockups ${escapeHtml(version)}</title>`,
    `<style>${GALLERY_CSS}</style>`,
    '</head>',
    '<body>',
    '<header>',
    `<h1>Mockups ${escapeHtml(version)} — ${changedCount} of ${screens.length} screens changed</h1>`,
    note ? `<p>${escapeHtml(note)}</p>` : '',
    parentLink ? `<p>${parentLink}</p>` : '',
    '</header>',
    `<main class="grid">${cards.join('\n')}</main>`,
    '</body>',
    '</html>',
    '',
  ].filter(line => line !== '').join('\n');
}

/**
 * The `.mockups.json` document: `latestId` is the first changed slug, else the
 * first screen. `screens` are the version's resolved screens, in order.
 */
export function mockupsJson(screens) {
  const firstChanged = screens.find(screen => screen.changed);
  return {
    latestId: (firstChanged ?? screens[0]).slug,
    mockups: screens.map(screen => ({
      id: screen.slug,
      title: screen.title,
      html: screen.html ?? '',
      css: screen.css ?? '',
      annotations: screen.annotations ?? [],
    })),
  };
}

const SCOPE_CSS = `
main.scope { max-width: 860px; margin: 0 auto; padding: 1.5rem; }
.scope section { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
.scope h2 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem; font-size: 1.05rem; }
.scope p { margin: 0.5rem 0; color: #444; white-space: pre-wrap; }
.scope ul { margin: 0.5rem 0; padding-left: 1.25rem; }
.scope li { margin: 0.25rem 0; padding: 0.15rem 0.35rem; border-radius: 3px; }
.scope .lead { margin-bottom: 1rem; }
.added, .removed { font-size: 0.75rem; font-weight: 600; color: #fff; border-radius: 3px; padding: 0.1rem 0.4rem; margin-right: 0.4rem; }
.added { background: #15803d; }
.removed { background: #6b7280; }
li .changed { margin-right: 0.4rem; }
li.mark-added { background: #f0fdf4; }
li.mark-changed { background: #eff6ff; }
li.mark-removed { color: #6b7280; }
li.mark-removed .text { text-decoration: line-through; }
.was { display: block; color: #6b7280; font-size: 0.85rem; text-decoration: line-through; }
`;

const BADGE = { added: 'Added', changed: 'Changed', removed: 'Removed' };

function scopeItem(item) {
  const badge = item.mark ? `<span class="${item.mark}">${BADGE[item.mark]}</span>` : '';
  const was = item.mark === 'changed' && item.was !== null ? `<span class="was">was: ${escapeHtml(item.was)}</span>` : '';
  return `<li${item.mark ? ` class="mark-${item.mark}"` : ''}>${badge}<span class="text">${escapeHtml(item.text)}</span>${was}</li>`;
}

/** Prose blocks as escaped paragraphs and each run of items as one list, in file order. */
function scopeBlocks(blocks) {
  const out = [];
  let list = [];
  const close = () => {
    if (list.length) out.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  for (const block of blocks) {
    if (block.kind === 'item') list.push(scopeItem(block));
    else {
      close();
      out.push(`<p>${escapeHtml(block.text)}</p>`);
    }
  }
  close();
  return out.join('\n');
}

/**
 * A written version's page, `versions/<version>/index.html`. `scope` is the
 * parsed `scope.md`, `sections` the check's `[{slug, …}]` in the same order,
 * `changed` the slugs of the sections holding a mark, `parent` and
 * `parentFormat` the version it was written on (null for none),
 * `parentPage` whether a written parent has its rendered `index.html` (one
 * written by hand has only its `scope.md`, which is linked then), and
 * `earlier` whether that version is a written one the marks were checked
 * against.
 */
export function renderScope({ version, note, parent, parentFormat, parentPage, earlier, scope, sections, changed }) {
  const marked = new Set(changed);
  let parentLink = '';
  if (parent) {
    parentLink = parentFormat === 'scope'
      ? `<a href="../${parent}/${parentPage ? 'index.html' : 'scope.md'}">Previous version: ${escapeHtml(parent)}</a>`
      : `<a href="../${parent}/${parentFormat === 'ascii' ? 'ascii-mockups.md' : 'index.html'}">Written from the screens of ${escapeHtml(parent)}</a>`;
  }
  const body = scope.sections.map((section, at) => {
    const slug = sections[at].slug;
    return [
      `<section id="${escapeHtml(slug)}">`,
      `<h2>${escapeHtml(section.heading)}${marked.has(slug) ? '<span class="changed">Changed</span>' : ''}</h2>`,
      scopeBlocks(section.blocks),
      '</section>',
    ].filter(line => line !== '').join('\n');
  });
  const lead = scope.lead.length ? `<div class="lead">${scopeBlocks(scope.lead)}</div>` : '';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>Written scope ${escapeHtml(version)}</title>`,
    `<style>${GALLERY_CSS}${SCOPE_CSS}</style>`,
    '</head>',
    '<body>',
    '<header>',
    `<h1>Written scope ${escapeHtml(version)}${earlier ? ` — ${changed.length} of ${sections.length} sections changed` : ''}</h1>`,
    scope.title !== null ? `<p><strong>${escapeHtml(scope.title)}</strong></p>` : '',
    note ? `<p>${escapeHtml(note)}</p>` : '',
    parentLink ? `<p>${parentLink}</p>` : '',
    '<p><a href="scope.md">scope.md</a></p>',
    '</header>',
    `<main class="scope">${lead}${body.join('\n')}</main>`,
    '</body>',
    '</html>',
    '',
  ].filter(line => line !== '').join('\n');
}
