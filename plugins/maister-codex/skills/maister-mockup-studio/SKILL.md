---
name: maister-mockup-studio
description: Generate and iteratively refine design-system-aware UI mockups as rendered HTML/CSS or terminal ASCII. Use standalone for screen and feature mockups, or from development and product-design workflows that need visual design artifacts.
---

# Maister Mockup Studio

Create user-facing UI mockups that reuse the project's real standards, tokens, components, iconography, and interaction patterns. HTML is the default; ASCII is the zero-browser fallback. Persist files even when live preview is unavailable.

## Inputs and result

Accept these values from the caller when provided:

| Input | Default | Meaning |
| --- | --- | --- |
| `task_path` | standalone task path | Workflow task directory |
| `output_subdir` | `analysis/mockups` | Destination relative to `task_path` |
| `format` | config or `html` | `html` or `ascii` |
| `iteration` | `full` | `single` for caller-owned review; `full` for this skill's refinement loop |
| `emit_index_rows` | `false` | Add stable visual-reference rows for downstream implementation |
| `context` | user request | Relevant specification, flow, constraints, screens, and design references |

Return `mockup_files`, `index_rows`, `format_used`, `notes`, and the live gallery URL when available.

## Workflow

1. If no `task_path` is supplied, create `.maister/tasks/mockups/YYYY-MM-DD-<slug>/analysis/`. Read `.maister/config.yml` for `mockup_format`, defaulting to `html`.
2. Create the output directory. Read `references/design-resource-discovery.md` completely and run its three-tier discovery. Read every applicable discovered standard. Write `analysis/design-context/design-resources.md`, including the required `TL;DR`.
3. If HTML was requested, check `node --version`. If Node is absent, record the reason and use ASCII.
4. For HTML, read `references/visual-companion.md` completely. Start or reuse `server/index.mjs`, verify `/status`, retain the returned mutation token for `POST` requests, and surface the loopback-only gallery URL. Opening a browser is optional and may require approval; failure must not block generation.
5. Generate one specifically titled screen for every relevant view and state. Reuse discovered CSS variables, component names, and icons. Use `data-screen="slug"` for click-through navigation and annotations only for reuse, integration, or interaction hints. Do not generate architecture, data-flow, or entity diagrams.
6. POST each HTML screen to `/update` with the returned token in `X-Maister-Token`; the server persists each rendered file and an offline `index.html` gallery. For ASCII, generate a clear annotated wireframe at `<output_subdir>/ascii-mockups.md`; delegate to the installed `maister-ascii-mockup-generator` agent when available, but the main agent remains responsible for persistence and validation.
7. With `iteration: full`, present the complete current mockup set and prefer `request_user_input` when available for `Approve (Recommended)`, `Revise`, or `Rethink`; otherwise ask the same concise choice in the final response. Regenerate only affected screens while keeping the set coherent. After roughly five rounds, recommend convergence without removing the option to revise again. With `iteration: single`, return after one generation so the caller owns the gate.
8. When `emit_index_rows` is true, add stable `screen:<slug>` and `component:<slug>` rows to `analysis/design-context/INDEX.md` with source paths and binding descriptions.
9. Keep the server alive for `iteration: single`. For standalone `iteration: full`, shut it down only after approval. Report saved paths and any degradation.

## Fallback rules

- Try ports 3847 through 3850; if none work, use ASCII.
- If browser automation or a platform opener is unavailable, print the URL and continue.
- If no project design resources exist, generate from established codebase patterns and record that limitation.
- A failed preview must never erase or invalidate saved mockup files.
