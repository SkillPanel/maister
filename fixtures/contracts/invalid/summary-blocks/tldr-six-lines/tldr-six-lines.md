# Widget Export Specification

**Task**: `.maister/tasks/development/2026-08-20-widget-list` | **Date**: 2026-08-20

## TL;DR

The export endpoint streams widgets in cursor-ordered pages.
Each page carries at most 500 rows and an opaque continuation cursor.
The cursor encodes the last row id and the sort key, base64 without padding.
Consumers that disconnect mid-page must re-request from the last cursor they saw.
The endpoint is self-scoped: a caller can only export widgets they own.
Rate limiting is inherited from the surrounding gateway and is not re-implemented here.

## Key Decisions

- Cursor pagination rather than offset pagination.

## Scope
