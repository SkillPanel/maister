import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --task-path from CLI args
const taskPathArg = process.argv.find(a => a.startsWith('--task-path='));
const taskPathInput = taskPathArg ? path.resolve(taskPathArg.slice('--task-path='.length)) : null;
const taskPath = taskPathInput ? fs.realpathSync(taskPathInput) : null;

// Parse --output-subdir (relative to task path). Default: analysis/mockups (product-design convention).
// The development workflow passes analysis/design-context/mockups so HTML lands in design-context.
const outputSubdirArg = process.argv.find(a => a.startsWith('--output-subdir='));
const outputSubdirValue = outputSubdirArg
  ? outputSubdirArg.slice('--output-subdir='.length)
  : 'analysis/mockups';

if (path.isAbsolute(outputSubdirValue)) {
  throw new Error('--output-subdir must be relative to --task-path');
}

const outputDir = taskPath ? path.resolve(taskPath, outputSubdirValue) : null;
if (taskPath && outputDir !== taskPath && !outputDir.startsWith(`${taskPath}${path.sep}`)) {
  throw new Error('--output-subdir must stay inside --task-path');
}

function assertOutputPathSafe() {
  if (!taskPath || !outputDir) return;
  const relative = path.relative(taskPath, outputDir);
  let cursor = taskPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`--output-subdir cannot traverse a symbolic link: ${cursor}`);
    }
  }
  if (fs.existsSync(outputDir)) {
    const canonicalOutput = fs.realpathSync(outputDir);
    if (canonicalOutput !== taskPath && !canonicalOutput.startsWith(`${taskPath}${path.sep}`)) {
      throw new Error('--output-subdir resolves outside --task-path');
    }
  }
}

assertOutputPathSafe();

// Check leaf files too, including dangling links. O_NOFOLLOW closes the leaf
// check/open race; atomic replacement also avoids truncating hard-linked files.
function outputFile(name) {
  assertOutputPathSafe();
  if (path.basename(name) !== name || name === '.' || name === '..') {
    throw new Error('Invalid output filename');
  }
  const destination = path.join(outputDir, name);
  const stat = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw new Error(`Output must be a regular file: ${name}`);
  return destination;
}

function writeOutput(name, content) {
  assertOutputPathSafe();
  fs.mkdirSync(outputDir, { recursive: true });
  const destination = outputFile(name);
  const temporary = outputFile(`.write-${crypto.randomUUID()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.closeSync(descriptor);
    descriptor = undefined;
    outputFile(name);
    fs.renameSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function screenFilename(id) {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Invalid mockup screen ID');
  }
  return id === 'index' ? 'index.screen.html' : `${id}.html`;
}

const mutationToken = crypto.randomBytes(24).toString('hex');
const maxBodyBytes = 2 * 1024 * 1024;

if (!taskPath) {
  console.warn('[visual-companion] No --task-path provided. Mockups will NOT be saved to disk.');
}

// In-memory state: array of all mockups (screens)
const mockups = [];
let latestId = null;
let version = 0;
const sseClients = [];

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// --- Manifest: raw screen payloads persisted alongside the rendered .html files.
// Lets the gallery survive a server restart (in-memory state is otherwise empty on
// startup even though the .html files exist on disk).
function manifestPath() {
  if (!taskPath) return null;
  return outputFile('.mockups.json');
}

function saveManifest() {
  if (!taskPath) return;
  writeOutput('.mockups.json', JSON.stringify({ latestId, mockups }, null, 2));
}

function loadManifest() {
  const p = manifestPath();
  if (!p || !fs.existsSync(p)) return;
  const descriptor = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let data;
  try { data = JSON.parse(fs.readFileSync(descriptor, 'utf8')); }
  finally { fs.closeSync(descriptor); }
  if (!data || !Array.isArray(data.mockups)) throw new Error('Invalid mockup manifest');
  const ids = new Set();
  for (const mockup of data.mockups) {
    screenFilename(mockup?.id);
    if (ids.has(mockup.id) || typeof mockup.title !== 'string' ||
        (mockup.html !== undefined && typeof mockup.html !== 'string') ||
        (mockup.css !== undefined && typeof mockup.css !== 'string') ||
        (mockup.annotations !== undefined && !Array.isArray(mockup.annotations))) {
      throw new Error('Invalid or duplicate mockup in manifest');
    }
    ids.add(mockup.id);
  }
  if (data.latestId != null && !ids.has(data.latestId)) throw new Error('Invalid latest screen ID');
  mockups.push(...data.mockups);
  latestId = data.latestId || mockups.at(-1)?.id || null;
  version = mockups.length;
  console.log(`Restored ${mockups.length} screen(s) from disk.`);
}

// Save a rendered standalone HTML file to disk. Returns true if saved, false if skipped.
function saveToDisk(mockup) {
  if (!taskPath) {
    console.warn(`[visual-companion] Skipping disk save for "${mockup.id}" — no task path configured.`);
    return false;
  }
  const html = renderScreen(mockup, true);
  writeOutput(screenFilename(mockup.id), html);
  return true;
}

// Render a single screen page with navigation
function renderScreen(mockup, staticMode = false) {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const title = mockup.title || 'Untitled';
  const content = `<style>${mockup.css || ''}</style>\n<div id="mockup-content">${mockup.html || ''}</div>`;
  const annotations = JSON.stringify(mockup.annotations || []);

  // Build screen nav
  const screenHref = id => staticMode ? screenFilename(id) : `/screen/${id}`;
  const navItems = mockups.map(m =>
    `<a href="${screenHref(m.id)}" class="nav-screen${m.id === mockup.id ? ' active' : ''}">${m.title}</a>`
  ).join('');

  const idx = mockups.indexOf(mockup);
  const prev = idx > 0 ? mockups[idx - 1] : null;
  const next = idx < mockups.length - 1 ? mockups[idx + 1] : null;
  const prevLink = prev ? `<a href="${screenHref(prev.id)}" class="nav-arrow">&larr; ${prev.title}</a>` : '<span></span>';
  const nextLink = next ? `<a href="${screenHref(next.id)}" class="nav-arrow">${next.title} &rarr;</a>` : '<span></span>';

  const nav = mockups.length > 1
    ? `<nav class="screen-nav"><div class="nav-screens">${navItems}</div><div class="nav-prevnext">${prevLink}${nextLink}</div></nav>`
    : '';

  html = html.replace('{{TITLE}}', title).replace('{{TITLE}}', title);
  html = html.replace('{{NAV}}', nav);
  html = html.replace('{{CONTENT}}', content);
  html = html.replace('{{ANNOTATIONS}}', annotations);
  html = html.replace('{{GALLERY_HREF}}', staticMode ? 'index.html' : '/');
  html = html.replace('{{LIVE_MODE}}', staticMode ? 'false' : 'true');

  return html;
}

// Render the gallery index page
function renderGallery(staticMode = false) {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const title = `Design Gallery — ${mockups.length} screen${mockups.length !== 1 ? 's' : ''}`;

  let content;
  if (mockups.length === 0) {
    content = '<div class="placeholder">Waiting for design mockups...<br>The orchestrator will send screens here.</div>';
  } else {
    // Each preview renders inside its own <iframe srcdoc> so per-screen CSS is fully
    // isolated — screens reuse identical class names, so injecting their <style> into
    // the shared gallery document (the old `<style scoped>`, which browsers no longer
    // support) made every card collide. The iframe gives each card a private document.
    const cards = mockups.map(m => {
      const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0e0f11}${m.css || ''}</style></head><body>${m.html || ''}</body></html>`;
      return `
      <a href="${staticMode ? screenFilename(m.id) : `/screen/${m.id}`}" class="gallery-card">
        <div class="gallery-card-title">${m.title}</div>
        <div class="gallery-card-preview"><iframe class="gallery-frame" scrolling="no" sandbox="allow-same-origin" srcdoc="${escapeAttr(doc)}"></iframe></div>
      </a>`;
    }).join('');
    content = `<div class="gallery-grid">${cards}</div>`;
  }

  html = html.replace('{{TITLE}}', title).replace('{{TITLE}}', title);
  html = html.replace('{{NAV}}', '');
  html = html.replace('{{CONTENT}}', content);
  html = html.replace('{{ANNOTATIONS}}', '[]');
  html = html.replace('{{GALLERY_HREF}}', staticMode ? 'index.html' : '/');
  html = html.replace('{{LIVE_MODE}}', staticMode ? 'false' : 'true');

  return html;
}

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        reject(new Error('Request body exceeds 2 MiB'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (err) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Notify all SSE clients
function notifyClients() {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write('data: refresh\n\n'); }
    catch { sseClients.splice(i, 1); }
  }
}

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function htmlResponse(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

// Main request handler
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // GET /status
    if (req.method === 'GET' && url.pathname === '/status') {
      jsonResponse(res, 200, { status: 'ok', version: '1.0.0', port: activePort, screens: mockups.length, taskPath: taskPath || null, persistence: !!taskPath, mutationToken });
      return;
    }

    if (req.method === 'POST' && req.headers['x-maister-token'] !== mutationToken) {
      jsonResponse(res, 403, { error: 'Invalid mutation token' });
      return;
    }

    // POST /shutdown
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      jsonResponse(res, 200, { status: 'shutting_down' });
      cleanupPidFile();
      setTimeout(() => process.exit(0), 100);
      return;
    }

    // GET /events (SSE)
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      sseClients.push(res);
      req.on('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    // POST /update
    if (req.method === 'POST' && url.pathname === '/update') {
      const body = await parseBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          ['title', 'html', 'css'].some(key => body[key] !== undefined && typeof body[key] !== 'string') ||
          (body.annotations !== undefined && !Array.isArray(body.annotations))) {
        jsonResponse(res, 400, { error: 'Invalid mockup payload' });
        return;
      }
      const id = slugify(body.title || 'untitled');

      const mockup = {
        id,
        type: body.type || 'mockup',
        title: body.title || 'Untitled',
        html: body.html || '',
        css: body.css || '',
        annotations: body.annotations || [],
      };

      // Reject unsafe destinations before mutating state or writing any screen.
      if (taskPath) {
        for (const screen of [...mockups, mockup]) outputFile(screenFilename(screen.id));
        outputFile('index.html');
        outputFile('.mockups.json');
      }

      // Update existing or add new
      const existingIdx = mockups.findIndex(m => m.id === id);
      if (existingIdx !== -1) {
        mockups[existingIdx] = mockup;
      } else {
        mockups.push(mockup);
      }

      latestId = id;
      version++;
      let saved = false;
      if (taskPath) {
        for (const screen of mockups) saveToDisk(screen);
        writeOutput('index.html', renderGallery(true));
        saved = true;
      } else {
        saveToDisk(mockup);
      }
      saveManifest();
      notifyClients();
      jsonResponse(res, 200, { status: 'updated', version, id, screens: mockups.length, saved });
      return;
    }

    // GET /screen/:id
    const screenMatch = url.pathname.match(/^\/screen\/([a-z0-9-]+)$/);
    if (req.method === 'GET' && screenMatch) {
      const mockup = mockups.find(m => m.id === screenMatch[1]);
      if (!mockup) {
        jsonResponse(res, 404, { error: 'Screen not found' });
        return;
      }
      htmlResponse(res, renderScreen(mockup));
      return;
    }

    // GET /latest
    if (req.method === 'GET' && url.pathname === '/latest') {
      const mockup = mockups.find(m => m.id === latestId);
      if (!mockup) {
        htmlResponse(res, renderGallery());
        return;
      }
      htmlResponse(res, renderScreen(mockup));
      return;
    }

    // GET / (gallery)
    if (req.method === 'GET' && url.pathname === '/') {
      htmlResponse(res, renderGallery());
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Request error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

// PID file management
function pidFilePath() {
  if (!taskPath) return null;
  return outputFile('.visual-companion.pid');
}

function writePidFile() {
  const p = pidFilePath();
  if (!p) return;
  writeOutput('.visual-companion.pid', String(process.pid));
}

function cleanupPidFile() {
  try {
    const p = pidFilePath();
    if (p) fs.unlinkSync(p);
  } catch {}
}

process.on('SIGTERM', () => { cleanupPidFile(); process.exit(0); });
process.on('SIGINT', () => { cleanupPidFile(); process.exit(0); });

// Port fallback logic
let activePort = null;

function tryPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function start() {
  loadManifest();
  pidFilePath();
  const ports = [3847, 3848, 3849, 3850];
  for (const port of ports) {
    try {
      await tryPort(port);
      activePort = port;
      console.log(`Visual companion server running at http://127.0.0.1:${port}`);
      console.log(`Mutation token: ${mutationToken}`);
      if (taskPath) console.log(`Saving mockups to: ${outputDir}`);
      writePidFile();
      return;
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} in use, trying next...`);
        continue;
      }
      throw err;
    }
  }
  console.error('All ports (3847-3850) in use. Cannot start server.');
  process.exit(1);
}

start();
