# ADR-0053 — A project profile keys the reviews

**Status**: Accepted · **Date**: 2026-10-22 · **Builds on**: ADR-0050 (a config block frozen into the run), ADR-0051 (the verification loop whose reviewers read the brief) and ADR-0006 (additive state) · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/project-profile.mjs`, `review-brief.mjs`, `state.mjs`; `skills/implementation-verifier/references/review-findings.md` § The project profile; `agents/code-reviewer.md`, `agents/production-readiness-checker.md`, `agents/code-quality-pragmatist.md`; `skills/init/SKILL.md`; `tests/engine/project-profile.test.mjs`

## TL;DR
- **One profile, in config.** A `project:` key in `.maister/config.yml` says what the project
  is: `kind`, `runtime`, `deploy`, `exposure`, `data`, `scale` and `ui`, every field optional.
- **Frozen and briefed.** The freeze copies it into `orchestrator.options.project`, and
  `review-brief` hands it to every reviewer as `profile`, with `source: config` or `none`.
- **Never a refusal.** A bad value is a warning, at the freeze and in `/maister:run --check`,
  and the field is left out; a field left out rules no check out.
- **`init` writes it once**, from its project analysis, only when the key is absent.
- **The reviewers key their checks to it**, and one shared rule splits a safeguard's absence
  from its presence, so no two reviewers grade the same item in opposite directions.

## ADR-0053 {#adr-0053}

### Status
Accepted. No workflow definition changes and no graph hash moves: the profile is recorded under
`orchestrator.options` and read by the brief, and the reviewers' checklists are agent prose.
State changes are additive.

### Context
The code reviewer and the production-readiness checker carried one checklist written for a web
service: a health endpoint, error tracking, rate limiting, CORS and connection pooling were
blockers on a CLI, a plugin or a library, and a production-readiness blocker failed the run. The
pragmatic reviewer, meanwhile, called pooling and caching premature, so the two sides could grade
the same item in opposite directions, and the blocker always won.

### Considered Options
1. **A `project:` key in `config.yml`** (chosen). One value every reviewer and host reads; a
   person corrects it in one line; the engine judges and freezes it like the `subagents` block.
2. **Inferred by each reviewer, every run, from `.maister/docs/project/`.** No new key, but each
   start pays for reading the docs, two reviewers can infer differently — which brings the
   contradiction back — and the answer can change between cycles. Kept only as the fallback.

### Decision
1. **The shape** is the contract's § The project profile: seven optional fields, each a closed
   list except `runtime` (free text) and `data` (a list of store names).
2. **Judged softly.** `validate` and the freeze judge the key; a field with a bad value, an
   unknown field or a key that is not a map is a `project-profile:` warning and is left out.
   Nothing about the profile stops a run.
3. **Frozen.** The freeze records the judged profile as `orchestrator.options.project` when any
   field passes; a patch never sets it. An edit of the file reaches the next run.
4. **Briefed.** `review-brief` copies the frozen profile into the brief as `profile` with
   `source: config`; standalone, it reads the key. With none it writes `{source: none}`, and each
   reviewer infers the profile from the project's docs and reports it as `source: inferred`.
5. **Written by `init`** through the engine's `project-profile` verb, from the project analysis:
   appended only when the file has no `project:` key, the fields it could not settle commented
   out, an existing key left alone.
6. **What a profile rules out** is one table in the contract. A ruled-out check is not run and
   not reported, so production readiness never raises a blocker for one and the run never fails
   on it. Absence of a safeguard the profile needs is the code reviewer's or production
   readiness's finding; presence of one it does not need is the pragmatic reviewer's.

### Consequences
- A project initialised before the key has none until `init` runs again, and its reviewers infer
  the profile meanwhile.
- A wrong field rules real checks out, so `init` leaves out what its analysis does not settle.
- Merging the reviewers into fewer agents stays separate; each would read the same profile.
