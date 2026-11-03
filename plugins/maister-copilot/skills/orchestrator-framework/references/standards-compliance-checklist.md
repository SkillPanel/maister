# Standards Compliance Checklist

One checklist ties a piece of work to the project's coding standards: written before the
implementation (into a plan, when there is one), verified after it. Any workflow that enforces
the project's standards on its work reads this file and follows it; it needs nothing else to write
or verify the checklist.

## Where the standards come from

The project's standards live under `.maister/docs/`.

- Read `.maister/docs/INDEX.md` to find which standards exist.
- **Then read the specific standard files it points to that are relevant to the task.** Reading
  `INDEX.md` alone is not sufficient — this is mandatory. When the work reaches a new area
  mid-task (auth, database, forms), read that area's standards before working on it.

## Writing the checklist

Fold the matched standards into the work itself: reference the governing standard where it shapes
a step, and include a **`## Standards Compliance Checklist`** section — one checkbox per
applicable guideline the implementation must satisfy, each annotated with its source file:

```markdown
## Standards Compliance Checklist

- [ ] Every endpoint validates its input before use (from `standards/backend/api.md`)
- [ ] New components follow the naming convention (from `standards/frontend/components.md`)
```

A guideline that does not apply to this task gets no checkbox. Where the work has a plan, the
checklist is part of the plan, and the plan is not ready for approval until it holds the
checklist (or the no-standards note below).

## When there are no standards

If `.maister/docs/INDEX.md` does not exist, work normally and note, in the plan or the summary:
"No Maister standards found. Consider running `/maister-copilot:init`."

## Verifying the checklist

After implementing, go through the checklist and verify each item — mark it pass or fail and
report it. Address any failure before marking the task complete.

Where no plan carried the checklist ahead of the work, the same per-item form — pass or fail per
applicable guideline, each annotated with its source file — is reported in the summary, beside
what changed and the tests run.
