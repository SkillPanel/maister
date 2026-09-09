# ticket-rollout

The prose companion the two `direct:` nodes resolve against. A companion is
looked for beside the file that declares the node, and its headings must equal
the definition's `direct:` node ids.

## analyze

Read the ticket named by the `ticket` input, write the analysis under
`analysis/ticket.md`, and declare `ready` from whether the change is safe to
roll into the member repository.

## close-out

Summarize what was rolled out and close the run.
