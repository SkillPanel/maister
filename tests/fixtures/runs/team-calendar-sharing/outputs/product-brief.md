# Product brief: team calendar sharing

## Core
Team members cannot share availability with external guests without exposing event details. Constraints: no guest accounts; revocable at any time. A guest sees free and busy times within one click of the link.

- `user-story-share-with-guest`: as a member, I share my calendar with one outside guest, and I can take it back at any time.
- `user-story-see-availability`: as a guest, I open the link and see when the member is free, and I can propose a time when the member allows it.

## Persona cards
Olga the organiser and Gus the guest: `analysis/personas.md`.

## Design decisions
- Access model: signed link. See `analysis/design-decisions.md` and `analysis/alternatives.md`.
- Detail shown: free and busy only. Sketch: `analysis/mockups/versions/v001/detail-shown-free-and-busy.html`.

## What changes, per screen
- **Share dialog:** new; a member names a guest and sends the link, and can revoke it.
- **Guest calendar:** new; a week of free and busy blocks, with no account.
- **Propose a time:** new, an opt-in; a guest picks a free block and sends it.

## Mockup references
`analysis/mockups/share-dialog.html`, `analysis/mockups/guest-calendar.html` and `analysis/mockups/propose-a-time.html`.

## Delivery scope
`team-calendar` is in scope: everything above, waiting for nothing. Left out: guest accounts, and event details for guests.

## References
`analysis/scope.md`, `analysis/problem-statement.md`, `analysis/personas.md`, `analysis/alternatives.md`, `analysis/design-decisions.md`.
