# Visual Companion

Documents the browser-based visual companion architecture used by the `mockup-studio` skill (the HTML mockup path). Provides high-fidelity visual feedback by rendering HTML/CSS mockups in a browser during a mockup session. `mockup-studio` is invoked both standalone and by the development (Phase 4) and product-design (Phase 7) orchestrators, so this component is shared, not product-design-specific.

The server lives at `${MAISTER_PLUGIN_ROOT}/skills/mockup-studio/server/index.mjs`.

The plugin root is this plugin's own directory — the one holding
`.claude-plugin/plugin.json` — and the variable naming it is set in the session
environment. Use it as written; do not work the directory out and substitute a
path of your own.

---

## Purpose

Terminal-based ASCII mockups are useful but limited. For UI-focused tasks, seeing actual rendered HTML/CSS in a browser gives qualitatively better feedback. The visual companion provides this without requiring any external tools, npm packages, or design software.

**Core idea**: mockup-studio generates HTML/CSS, sends it to a local server, the browser renders it, the user reviews and provides feedback in the terminal. The browser is read-only visual output -- all interaction stays in the terminal via ask_user.

---

## Architecture Overview

```
Orchestrator → POST /update → Node.js Server → SSE "refresh" → Browser (renders mockup)
                                                                   ↓ user views
                                                              Terminal (ask_user)
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

**Annotations**: Positioned tooltips overlaid on mockup elements. Togglable via the "Annotations" button in the UI header (on by default, preference persists via localStorage). Use for component reuse hints, integration points, and interaction hints — NOT for feature descriptions or requirements.

Example annotations:
- `{"selector": ".patient-card", "note": "Reuses existing <PatientCard> component"}`
- `{"selector": ".save-btn", "note": "Triggers webhook notification"}`
- `{"selector": ".drag-handle", "note": "Drag to reorder"}`

---

## Lifecycle

### Startup

1. Spawn server process: `node ${MAISTER_PLUGIN_ROOT}/skills/mockup-studio/server/index.mjs --task-path=${task_path} --output-subdir=${output_subdir} &`
   - `--output-subdir` (relative to task path) controls where mockups are saved. Default `analysis/mockups` (product-design / standalone); development passes `analysis/design-context/mockups`.
2. Port allocation: try 3847, fallback through 3848-3850
3. Verify ready: poll `GET /status` until ok (timeout after 3 seconds)

### Browser Opening

1. **Primary**: Playwright MCP `browser_navigate` (if configured)
2. **Fallback 1**: `open` command (macOS) / `xdg-open` (Linux)
3. **Fallback 2**: Log URL for manual opening, continue with terminal-only review

### Teardown

Kill server via `POST /shutdown` endpoint on:
- Mockup-generation completion (when mockup-studio owns the server lifecycle for this run)
- Workflow cancellation

**PID file**: Server writes its PID to `{taskPath}/{output_subdir}/.visual-companion.pid` on startup. Cleaned up on shutdown, SIGTERM, and SIGINT. Enables reliable process identification.

**Stale server detection**: mockup-studio checks `/status` before starting a new server. The response includes `taskPath` — if it belongs to a different task, the server is stale and gets shut down via `POST /shutdown` before starting a new one.

---

## Graceful Degradation Matrix

The visual companion is an enhancement, not a requirement. Every failure has a fallback.

| Scenario | Detection | Fallback |
|---|---|---|
| Node.js not available | `which node` fails | ASCII mockups via ascii-mockup-generator agent |
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

## Integration with mockup-studio (HTML path)

The mockup-studio HTML path (SKILL.md Step 4a) follows this sequence when the visual companion is available:

1. **Check availability**: `GET /status` to see if server is already running (stale-server check by `taskPath`)
2. **Start server if needed**: Spawn Node.js process with `--task-path` + `--output-subdir`, verify ready
3. **Open browser**: Playwright MCP or open command or log URL
4. **Generate mockup**: Create HTML/CSS from the `context` grounding and the discovered design resources
5. **Push to server**: `POST /update` with mockup content
6. **Present for review**: ask_user in terminal (user views mockup in browser) — for `iteration: full`
7. **Iterative refinement**: Revise mockup, re-POST, re-review (follows refinement loop pattern)
8. **Saved automatically**: each POST saves the rendered HTML to `{output_subdir}/{slug}.html`

**When the visual companion is unavailable**: mockup-studio falls back to the `ascii-mockup-generator` agent for ASCII mockups (SKILL.md Step 4b). The refinement loop still applies -- only the rendering medium changes.

### Mockup Generation Guidance

mockup-studio generates mockup HTML/CSS based on:
- The `context` grounding passed by the caller (spec/gap-analysis/design-decisions excerpts, screen list)
- The discovered design resources (standards, tokens, components — see `design-resource-discovery.md`)
- Existing codebase UI patterns

**Fidelity target**: Mid-fidelity. Enough structure and styling to evaluate layout, hierarchy, and flow. Not pixel-perfect production CSS. Focus on communicating the design intent, not building the final UI.

**What to generate** (user-facing wireframes/screens):
- Dashboard views, settings pages, list/detail screens
- Forms, modals, navigation bars, sidebars
- Data tables, cards, search/filter interfaces
- Empty states, error states, loading states
- Responsive layouts (desktop and mobile variations)

**What NOT to generate** (technical diagrams — these belong in analysis artifacts):
- System architecture diagrams
- Data flow charts, sequence diagrams
- Entity relationship diagrams
- Component dependency graphs

**Multiple screens**: Complex designs need multiple screens. The visual companion maintains a gallery — each `POST /update` adds a screen. Give each a descriptive title (e.g., "Patient Dashboard", "Settings - Notifications", "Error State - Network Failure"). The user can browse all screens via the gallery at `GET /`.

**Screen-to-screen navigation**: Add `data-screen="slug"` to interactive elements (links, buttons, cards) in mockup HTML. Clicking navigates to the target screen in the visual companion. The slug is the lowercase-hyphenated version of the screen title (e.g., "Settings Page" → `data-screen="settings-page"`). This creates an interactive prototype experience where the user can click through the flow.

---

## Server State & Persistence

The server maintains a screen gallery in memory and persists to disk:

- **Mockups array**: All POSTed screens (ordered, accessible by slug ID)
- **SSE clients**: Active EventSource connections for refresh notifications
- **Version counter**: Incremented on each update
- **Disk persistence**: Each POST automatically saves the rendered HTML to `{task_path}/{output_subdir}/{slug}.html` — pass `--task-path` (and optionally `--output-subdir`) when starting the server

**Routes**:
- `GET /` → Gallery index (grid of all screen cards)
- `GET /screen/{id}` → Individual screen with prev/next navigation
- `GET /latest` → Most recently POSTed screen (SSE refresh target)

Screens are saved to disk immediately on POST — if the session drops, mockups survive in `{output_subdir}/`.

---

This reference provides the visual companion architecture and integration patterns. The server implementation lives in `server/index.mjs` and `mockup-studio/SKILL.md` defines the generation flow that uses the visual companion.
