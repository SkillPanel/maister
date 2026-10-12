# Node brief sample

Scopes a note, drafts it, audits it when asked, and wraps up.

## `scope`

**Does.** Settle what the note covers and record `wants_audit` and `focus`.

## `draft-notes`

**Does.** Write the notes from the scope. As a child run, *Embedded mode* applies.

### Checks

Read the notes back before completing.

**Asks.**

<!-- rich-picker -->
Each tone's option carries a sample sentence as its preview.
<!-- /rich-picker -->
<!-- plain-picker
The question lists each tone with a sample sentence.
-->

**With question sets** (`tone`): in this step's one request. Default: a plain tone.

**Without question sets** (`tone`): a plain tone, as the step's assumption.

```
## `not-a-heading`
```

**Budget.** Re-draft from the scope on the second attempt.

## `approval`

A gate whose question is neutral.

## `audit-approval`

**Exception.** Ask it even when the audit found nothing, so the operator sees the audit ran.

## Embedded mode

As a child run, the draft is written into the parent's task directory.
