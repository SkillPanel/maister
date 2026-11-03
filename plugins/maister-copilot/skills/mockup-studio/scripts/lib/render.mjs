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
 * from outside, each card a sibling page.
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

/** The version's gallery, `versions/<version>/index.html`. */
export function renderGallery({ version, note, parent, screens }) {
  const changedCount = screens.filter(screen => screen.changed).length;
  const parentLink = parent ? `<a href="../${parent}/index.html">Previous version: ${escapeHtml(parent)}</a>` : '';
  const cards = screens.map(screen => [
    `<a class="card" href="${screen.slug}.html">`,
    `<div class="card-title"><span>${escapeHtml(screen.title)}</span>${screen.changed ? '<span class="changed">Changed</span>' : ''}</div>`,
    `<div class="preview"><iframe src="${screen.slug}.html" loading="lazy" tabindex="-1" title="${escapeHtml(screen.title)}"></iframe></div>`,
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
