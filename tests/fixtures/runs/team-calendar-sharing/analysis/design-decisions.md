# Design decisions

**Chosen approach: link-based sharing.** One link per guest answers both constraints: no guest accounts, and revocable at any time.

## Access model: signed link
Sent with the existing invitation email. Links expire after 30 days unless renewed.

## Detail shown: free and busy only
Sketch: `analysis/mockups/versions/v001/detail-shown-free-and-busy.html`. Propose-a-time is an opt-in on top of it.

## Trade-offs accepted
- A forwarded link reaches whoever it is forwarded to.

## Considered
Guest accounts, an organisation allow-list and event titles: see `analysis/alternatives.md`.
