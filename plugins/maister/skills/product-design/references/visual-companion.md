# Visual Companion

Documents the browser-based visual companion architecture for the product-design orchestrator. Provides high-fidelity visual feedback by rendering HTML/CSS mockups in a browser during design sessions.

---

## Purpose

Terminal-based ASCII mockups are useful but limited. For UI-focused design tasks, seeing actual rendered HTML/CSS in a browser gives qualitatively better feedback. The visual companion provides this without requiring any external tools, npm packages, or design software.

**Core idea**: Orchestrator generates HTML/CSS, sends to a local server, browser renders it, user reviews and provides feedback in the terminal. Browser is read-only visual output -- all interaction stays in the terminal via AskUserQuestion.

---

## Architecture Overview

```
Orchestrator → POST /update → Node.js Server → SSE "refresh" → Browser (renders mockup)
                                                                   ↓ user views
                                                              Terminal (AskUserQuestion)
```

**Data flow is one-directional**: Orchestrator pushes content to server, server pushes to browser, user reviews in browser, feedback flows through terminal. The browser never sends data back to the orchestrator.

---

## Zero-Dependency Principle

The server uses ONLY Node.js built-in modules: `http`, `fs`, `path`, `url`. No npm install required. No package.json needed.

**SSE over WebSocket**: Server-Sent Events replace WebSocket for simplicity. SSE works with the native browser `EventSource` API, requires no client library, and handles reconnection automatically. One-directional push (server to browser) is all we need.

**Why zero-dependency matters**: The visual companion starts inside a product-design workflow. Requiring `npm install` would add failure modes, slow down startup, and create version compatibility issues. Node.js built-in modules are sufficient for a local development server.

---

## Communication Protocol

| Endpoint | Method | Purpose | Request/Response |
|---|---|---|---|
| `/status` | GET | Health check | Response: `{"status":"ok","version":"1.0.0"}` |
| `/` | GET | Current mockup | Response: HTML page with mockup wrapped in template |
| `/events` | GET | SSE stream | Response: `text/event-stream`, sends `data: refresh\n\n` on update |
| `/update` | POST | Push new mockup | Body: `{type, title, html, css, annotations}` |

### POST /update Body Schema

```json
{
  "type": "mockup",
  "title": "Settings Page - Desktop",
  "html": "<div class='settings'>...</div>",
  "css": ".settings { padding: 1rem; }",
  "annotations": [
    {"selector": ".settings", "text": "Reuses existing card component"}
  ]
}
```

**Annotations**: Optional positioned tooltips showing component names, interaction hints, or design rationale. Rendered as an overlay on the mockup.

---

## Lifecycle

### Startup

1. Spawn server process: `node ${SKILL_DIR}/server/index.mjs`
2. Port allocation: try 3847, fallback through 3848-3850
3. Verify ready: poll `GET /status` until ok (timeout after 3 seconds)

### Browser Opening

1. **Primary**: Playwright MCP `browser_navigate` (if configured)
2. **Fallback 1**: `open` command (macOS) / `xdg-open` (Linux)
3. **Fallback 2**: Log URL for manual opening, continue with terminal-only review

### Teardown

Kill server process on:
- Workflow completion (Phase 9 finalization)
- Workflow cancellation
- Server inactivity timeout (if implemented)

Store server PID in orchestrator state for reliable cleanup.

---

## Graceful Degradation Matrix

The visual companion is an enhancement, not a requirement. Every failure has a fallback.

| Scenario | Detection | Fallback |
|---|---|---|
| Node.js not available | `which node` fails | ASCII mockups via ui-mockup-generator agent |
| Port 3847 in use | Server startup error (EADDRINUSE) | Try ports 3848-3850, then ASCII fallback |
| Playwright MCP not configured | MCP tool call fails | Log URL for manual browser opening |
| Browser fails to open | Playwright error + open command error | Log URL, continue with terminal-only review |
| Server crashes mid-session | `GET /status` returns error or timeout | Restart server; if 2nd failure, ASCII fallback |
| No issues | `GET /status` returns ok | Full visual companion experience |

**Degradation principle**: Never block the design workflow because the visual companion failed. The core design conversation happens in the terminal. Visual rendering is additive value.

---

## HTML Template Pattern

The server wraps mockup content in a base template that provides:

- **Viewport meta**: Responsive rendering matching common device widths
- **CSS reset**: Minimal reset so mockup styles render predictably
- **SSE client script**: `EventSource` connection to `/events` with auto-reconnect on disconnect
- **Annotation overlay script**: Renders positioned tooltips from annotation data
- **Placeholder state**: "Waiting for design mockup..." shown before first `POST /update`

**Template is server-side, not orchestrator-side**: The orchestrator sends only the mockup `html` and `css`. The server wraps it in the template. This keeps the orchestrator focused on design content rather than boilerplate.

**Auto-refresh behavior**: When the SSE stream receives a `refresh` event, the page reloads to fetch the updated mockup from `GET /`. No manual refresh needed.

---

## Integration with Phase 7 (Visual Prototyping)

Phase 7 follows this sequence when visual companion is available:

1. **Check availability**: `GET /status` to see if server is already running
2. **Start server if needed**: Spawn Node.js process, verify ready
3. **Open browser**: Playwright MCP or open command or log URL
4. **Generate mockup**: Create HTML/CSS from spec context and design decisions
5. **Push to server**: `POST /update` with mockup content
6. **Present for review**: AskUserQuestion in terminal (user views mockup in browser)
7. **Iterative refinement**: Revise mockup, re-POST, re-review (follows refinement loop pattern)
8. **Save approved mockup**: Write final HTML/CSS to `analysis/mockups/` in task directory

**When visual companion is unavailable**: Phase 7 falls back to the `ui-mockup-generator` agent for ASCII mockups. The iterative refinement loop still applies -- only the rendering medium changes.

### Mockup Generation Guidance

The orchestrator generates mockup HTML/CSS based on:
- Specification sections from Phase 6
- Design decisions from Phase 5 convergence
- Existing codebase UI patterns (from Phase 1 codebase analysis, if enhancement)
- Persona workflows from Phase 3 (if greenfield)

**Fidelity target**: Mid-fidelity. Enough structure and styling to evaluate layout, hierarchy, and flow. Not pixel-perfect production CSS. Focus on communicating the design intent, not building the final UI.

**Multiple mockups**: Complex designs may need multiple mockups (e.g., desktop vs. mobile, admin vs. viewer, empty state vs. populated). Each is a separate `POST /update` and review cycle within Phase 7.

---

## Server State

The server maintains minimal in-memory state:

- **Current mockup**: The most recent `POST /update` payload
- **SSE clients**: Active EventSource connections for refresh notifications
- **Version counter**: Incremented on each update, used for cache busting

No persistence to disk. No session management. No authentication. This is a local development tool, not a production server.

---

This reference provides the visual companion architecture and integration patterns. The server implementation lives in `server/index.mjs` and the orchestrator's SKILL.md defines the specific phase logic that uses the visual companion.
