import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --task-path from CLI args
const taskPathArg = process.argv.find(a => a.startsWith('--task-path='));
const taskPath = taskPathArg ? taskPathArg.split('=')[1] : null;

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

// Save a rendered standalone HTML file to disk. Returns true if saved, false if skipped.
function saveToDisk(mockup) {
  if (!taskPath) {
    console.warn(`[visual-companion] Skipping disk save for "${mockup.id}" — no task path configured.`);
    return false;
  }
  const dir = path.join(taskPath, 'analysis', 'mockups');
  fs.mkdirSync(dir, { recursive: true });

  const html = renderScreen(mockup);
  const filePath = path.join(dir, `${mockup.id}.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  return true;
}

// Render a single screen page with navigation
function renderScreen(mockup) {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const title = mockup.title || 'Untitled';
  const content = `<style>${mockup.css || ''}</style>\n<div id="mockup-content">${mockup.html || ''}</div>`;
  const annotations = JSON.stringify(mockup.annotations || []);

  // Build screen nav
  const navItems = mockups.map(m =>
    `<a href="/screen/${m.id}" class="nav-screen${m.id === mockup.id ? ' active' : ''}">${m.title}</a>`
  ).join('');

  const idx = mockups.indexOf(mockup);
  const prev = idx > 0 ? mockups[idx - 1] : null;
  const next = idx < mockups.length - 1 ? mockups[idx + 1] : null;
  const prevLink = prev ? `<a href="/screen/${prev.id}" class="nav-arrow">&larr; ${prev.title}</a>` : '<span></span>';
  const nextLink = next ? `<a href="/screen/${next.id}" class="nav-arrow">${next.title} &rarr;</a>` : '<span></span>';

  const nav = mockups.length > 1
    ? `<nav class="screen-nav"><div class="nav-screens">${navItems}</div><div class="nav-prevnext">${prevLink}${nextLink}</div></nav>`
    : '';

  html = html.replace('{{TITLE}}', title).replace('{{TITLE}}', title);
  html = html.replace('{{NAV}}', nav);
  html = html.replace('{{CONTENT}}', content);
  html = html.replace('{{ANNOTATIONS}}', annotations);

  return html;
}

// Render the gallery index page
function renderGallery() {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const title = `Design Gallery — ${mockups.length} screen${mockups.length !== 1 ? 's' : ''}`;

  let content;
  if (mockups.length === 0) {
    content = '<div class="placeholder">Waiting for design mockups...<br>The orchestrator will send screens here.</div>';
  } else {
    const cards = mockups.map(m => `
      <a href="/screen/${m.id}" class="gallery-card">
        <div class="gallery-card-title">${m.title}</div>
        <div class="gallery-card-preview"><style scoped>${m.css || ''}</style>${m.html || ''}</div>
      </a>
    `).join('');
    content = `<div class="gallery-grid">${cards}</div>`;
  }

  html = html.replace('{{TITLE}}', title).replace('{{TITLE}}', title);
  html = html.replace('{{NAV}}', '');
  html = html.replace('{{CONTENT}}', content);
  html = html.replace('{{ANNOTATIONS}}', '[]');

  return html;
}

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
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
      jsonResponse(res, 200, { status: 'ok', version: '1.0.0', port: activePort, screens: mockups.length, taskPath: taskPath || null, persistence: !!taskPath });
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
      const id = slugify(body.title || 'untitled');

      const mockup = {
        id,
        type: body.type || 'mockup',
        title: body.title || 'Untitled',
        html: body.html || '',
        css: body.css || '',
        annotations: body.annotations || [],
      };

      // Update existing or add new
      const existingIdx = mockups.findIndex(m => m.id === id);
      if (existingIdx !== -1) {
        mockups[existingIdx] = mockup;
      } else {
        mockups.push(mockup);
      }

      latestId = id;
      version++;
      const saved = saveToDisk(mockup);
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
  return path.join(taskPath, 'analysis', 'mockups', '.visual-companion.pid');
}

function writePidFile() {
  const p = pidFilePath();
  if (!p) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(process.pid), 'utf-8');
}

function cleanupPidFile() {
  const p = pidFilePath();
  if (p) try { fs.unlinkSync(p); } catch {}
}

process.on('SIGTERM', () => { cleanupPidFile(); process.exit(0); });
process.on('SIGINT', () => { cleanupPidFile(); process.exit(0); });

// Port fallback logic
let activePort = null;

function tryPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

async function start() {
  const ports = [3847, 3848, 3849, 3850];
  for (const port of ports) {
    try {
      await tryPort(port);
      activePort = port;
      console.log(`Visual companion server running at http://localhost:${port}`);
      if (taskPath) console.log(`Saving mockups to: ${path.join(taskPath, 'analysis', 'mockups')}`);
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
