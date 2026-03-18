import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory state
let currentMockup = null;
let version = 0;
const sseClients = [];

// Read and render the HTML template with current mockup state
function renderTemplate() {
  const templatePath = path.join(__dirname, 'template.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const title = currentMockup?.title || 'Waiting for mockup...';

  let content = '';
  if (currentMockup) {
    content = `<style>${currentMockup.css || ''}</style>\n<div id="mockup-content">${currentMockup.html || ''}</div>`;
  } else {
    content = '<div class="placeholder">Waiting for design mockup...<br>The orchestrator will send content here.</div>';
  }

  const annotations = JSON.stringify(currentMockup?.annotations || []);

  html = html.replace('{{TITLE}}', title).replace('{{TITLE}}', title);
  html = html.replace('{{CONTENT}}', content);
  html = html.replace('{{ANNOTATIONS}}', annotations);

  return html;
}

// Parse JSON body from an incoming request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Notify all connected SSE clients to refresh
function notifyClients() {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write('data: refresh\n\n');
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// Send a JSON response
function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Main request handler
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // GET /status
    if (req.method === 'GET' && url.pathname === '/status') {
      jsonResponse(res, 200, { status: 'ok', version: '1.0.0', port: activePort });
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
      currentMockup = {
        type: body.type || 'mockup',
        title: body.title || 'Untitled',
        html: body.html || '',
        css: body.css || '',
        annotations: body.annotations || [],
      };
      version++;
      notifyClients();
      jsonResponse(res, 200, { status: 'updated', version });
      return;
    }

    // GET / (serve rendered template)
    if (req.method === 'GET' && url.pathname === '/') {
      const html = renderTemplate();
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Length': Buffer.byteLength(html),
      });
      res.end(html);
      return;
    }

    // 404 for everything else
    jsonResponse(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Request error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

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
