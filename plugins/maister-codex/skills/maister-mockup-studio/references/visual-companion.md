# Visual Companion

The HTML path uses the zero-dependency Node server at `../server/index.mjs`, resolved relative to this reference's skill directory. Do not rely on a client-specific plugin-root environment variable.

## Architecture

```text
Mockup Studio -> POST /update -> Node HTTP server -> SSE refresh -> browser
       ^                                                      |
       +---------------- user feedback in chat ---------------+
```

The browser is a read-only renderer. User feedback and workflow decisions remain in the Codex conversation. The server uses only Node built-ins (`http`, `fs`, `path`, `crypto`, and `url`); no package installation is required. It binds only to `127.0.0.1`, limits request bodies to 2 MiB, and requires the per-process mutation token for every POST.

## Protocol

| Endpoint | Method | Result |
| --- | --- | --- |
| `/status` | GET | Health, active port, task path, persistence, screen count, and mutation token |
| `/` | GET | Gallery of all screens |
| `/screen/<slug>` | GET | One screen with navigation |
| `/latest` | GET | Most recently updated screen |
| `/events` | GET | Server-sent refresh events |
| `/update` | POST | Add or replace a screen and persist it |
| `/shutdown` | POST | Stop the server cleanly |

POST screens as JSON with `X-Maister-Token: <mutationToken from /status>`:

```json
{
  "type": "mockup",
  "title": "Settings — Notifications",
  "html": "<main>...</main>",
  "css": ":root { --color-primary: #2457d6; }",
  "annotations": [
    {"selector": ".save-button", "text": "Reuses the existing primary button"}
  ]
}
```

Titles determine stable lowercase-hyphenated IDs. Posting a title again updates that screen. Each update writes `<task_path>/<output_subdir>/<slug>.html` (`index.screen.html` for the reserved `index` slug), an offline `index.html` gallery, and `.mockups.json`; a restarted server restores the gallery from this manifest. Invalid manifests and symlinked destinations are rejected; preserve the affected files and report the error instead of deleting them to force startup.

## Lifecycle

1. Resolve the absolute `server/index.mjs` path from the loaded skill directory.
2. Query `/status` on `127.0.0.1` ports 3847 through 3850. Reuse a server whose `taskPath` matches and retain its `mutationToken`. Shut down a stale server only after confirming it belongs to another Maister mockup task, passing its token in `X-Maister-Token`.
3. Launch Node with quoted absolute arguments:

   ```text
   node <absolute-skill-dir>/server/index.mjs --task-path=<absolute-task-path> --output-subdir=<relative-output-subdir>
   ```

   Keep the process/session handle, verify `/status`, and retain the returned mutation token before generating content.
4. Open the gallery with an available browser-automation connector when configured. A platform opener is a best-effort fallback and may require user approval. Otherwise print the URL.
5. POST every screen with `X-Maister-Token` and verify the response reports `saved: true`.
6. Keep the server running while an orchestrator-owned review gate is pending. In a standalone full refinement run, call `/shutdown` with `X-Maister-Token` after final approval.

The server writes `.visual-companion.pid` below the output directory and removes it on clean shutdown, SIGTERM, or SIGINT.

## Rendering guidance

- Produce mid-fidelity user-facing screens, not system diagrams.
- Reuse discovered design tokens, components, copy style, and icons by their real names.
- Use annotations for component reuse, integration points, and interaction hints; do not encode requirements in annotations.
- Add `data-screen="target-slug"` to clickable elements to create a navigable prototype.
- Include relevant empty, loading, error, validation, responsive, and permission states.
- Use multiple specifically titled screens when the flow cannot be evaluated from one view.

## Graceful degradation

| Failure | Response |
| --- | --- |
| Node unavailable | Generate and persist ASCII mockups |
| Ports 3847–3850 unavailable | Generate ASCII and record the port conflict |
| Browser cannot open | Print the URL; continue saving HTML |
| Server fails once | Restart once; then fall back to ASCII |
| Preview disconnects | Keep the saved HTML deliverables and report the limitation |

Preview failure never blocks the design workflow or invalidates files already written.
