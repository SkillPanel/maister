# Widget Export Specification

**Task**: `.maister/tasks/development/2026-08-20-widget-list` | **Date**: 2026-08-20

## Scope

The export endpoint and its cursor encoding. The gateway is out of scope.

## TL;DR

The export endpoint streams widgets in cursor-ordered pages.
Each page carries at most 500 rows and an opaque continuation cursor.

## Key Decisions

- Cursor pagination rather than offset pagination.
