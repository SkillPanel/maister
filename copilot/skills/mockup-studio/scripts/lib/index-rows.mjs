/**
 * The design-context INDEX rows a published version owns.
 *
 * The rows sit in the first table whose header is `| ID | Type | Source |
 * Description |`, beside rows the studio does not own — screens imported at
 * intake, references, anything a person added. A row is the studio's when its
 * Source is the flat page (`<subdir>/<slug>.html`) or the ASCII anchor
 * (`<subdir>/ascii-mockups.md#<slug>`) of a slug in the previous latest
 * version or the new one; ownership is by slug, never by folder, so an
 * imported page in the same folder keeps its row. Owned rows are replaced in
 * place, where the first of them stood; every other row and all text around
 * the table is kept. With no such table one is appended, and a missing file is
 * created. No Source ever points into `versions/`.
 *
 * A screen carried over unchanged keeps the rows it already has, since its
 * description and components were written by the turn that drew it; a carried
 * screen with no row yet gets one from its title.
 *
 * Pure: no I/O. Zero dependencies, Node >= 20.
 */

export const HEADER = '| ID | Type | Source | Description |';
const SEPARATOR = '|----|------|--------|-------------|';

/** A cell's text: `|` escaped, line breaks folded to spaces. */
function cell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function row(id, type, source, description) {
  return `| ${cell(id)} | ${cell(type)} | ${cell(source)} | ${cell(description)} |`;
}

/** The Source a slug's rows carry, by format. */
export function sourceOf(subdir, format, slug) {
  return format === 'ascii' ? `${subdir}/ascii-mockups.md#${slug}` : `${subdir}/${slug}.html`;
}

/** The generated rows of one screen: its screen row, then a row per component. */
export function screenRows(subdir, format, screen) {
  const source = sourceOf(subdir, format, screen.slug);
  const behaviour = screen.behaviour?.length ? `; behaviour: ${screen.behaviour.join('; ')}` : '';
  const lines = [row(`screen:${screen.slug}`, 'screen', source, `${screen.description || screen.title}${behaviour}`)];
  for (const component of screen.components ?? []) {
    lines.push(row(`component:${component.id}`, 'component', source, component.description));
  }
  return lines;
}

/** The cells of a table line, unescaped `|` as the only separator. */
function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map(each => each.trim().replace(/\\\|/g, '|'));
}

const isHeader = line => cells(line).join('|').toLowerCase() === 'id|type|source|description' && line.trim().startsWith('|');

/**
 * The INDEX text after a publish.
 *
 * `existing` is the file's text, or null when there is none. `owned` is every
 * slug of the previous latest version and the new one. `screens` are the new
 * version's screens in order, each with `carried` true when it came over
 * unchanged from `against`.
 */
export function rewriteIndex(existing, { subdir, format, owned, screens }) {
  const ownedSources = new Set();
  for (const slug of owned) {
    ownedSources.add(sourceOf(subdir, 'html', slug));
    ownedSources.add(sourceOf(subdir, 'ascii', slug));
  }

  if (existing === null) {
    const rows = screens.flatMap(screen => screenRows(subdir, format, screen));
    return ['# Design context index', '', HEADER, SEPARATOR, ...rows, ''].join('\n');
  }

  const lines = existing.split('\n');
  const header = lines.findIndex(isHeader);
  if (header === -1) {
    const rows = screens.flatMap(screen => screenRows(subdir, format, screen));
    const body = existing.endsWith('\n') ? existing : `${existing}\n`;
    return `${body}\n${[HEADER, SEPARATOR, ...rows].join('\n')}\n`;
  }

  let end = header + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;

  const existingBySource = new Map();
  let firstOwned = -1;
  const kept = [];
  for (let at = header + 2; at < end; at += 1) {
    const source = cells(lines[at])[2] ?? '';
    if (ownedSources.has(source)) {
      if (firstOwned === -1) firstOwned = kept.length;
      if (!existingBySource.has(source)) existingBySource.set(source, []);
      existingBySource.get(source).push(lines[at]);
    } else {
      kept.push(lines[at]);
    }
  }

  const rows = screens.flatMap(screen => {
    const previous = existingBySource.get(sourceOf(subdir, format, screen.slug));
    return screen.carried && previous ? previous : screenRows(subdir, format, screen);
  });
  const at = firstOwned === -1 ? kept.length : firstOwned;
  const body = [...kept.slice(0, at), ...rows, ...kept.slice(at)];
  return [...lines.slice(0, header + 2), ...body, ...lines.slice(end)].join('\n');
}
