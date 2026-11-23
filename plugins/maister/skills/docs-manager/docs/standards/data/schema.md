## Schema and Migrations

### Create Migrations with the Project's Tool
Create a migration with the project's generator command when it has one, so the timestamp or number that orders it is real, not invented; without one, take the next number in the existing file-name scheme.

### Never Edit an Applied Migration
Change the schema with a new migration. A migration that is on the default branch or has run on a shared database is not edited, renamed or deleted: databases that already ran it will not run it again. A migration only on your unmerged branch may still be edited.

### One Change per Migration
Each migration makes one logical schema change, and a data backfill or transform goes in a migration of its own: on MySQL every DDL statement commits implicitly, so a mixed migration can stop half applied, and on PostgreSQL a long data update in the DDL's transaction holds its locks until it ends.

### Rollback Follows the Project
Write a down step where the project's migrations have them, and make it undo the up step exactly. A step that cannot be undone (dropping a column or table, a lossy type change, deleting rows) is marked irreversible in the tool's own way, not given a fake undo. Where the project migrates forward only, a fix is a new migration.

### Expand, Then Contract
When old and new code share the database during a deploy, change what running code uses over separate releases: add the new column or table, write to both, backfill, switch reads, drop the old one last. A NOT NULL column on a filled table gets a default, or is added nullable, backfilled, then constrained. On PostgreSQL, set a short `lock_timeout` before altering a busy table, so a blocked ALTER fails fast.

### Build Indexes Without Blocking Writes
On a table that takes writes during the deploy, build a new index online. In PostgreSQL that is `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction (mark the migration non-transactional in the project's tool) and, if it fails, leaves an `INVALID` index to drop and rebuild. MySQL InnoDB builds secondary indexes online already.

### Constraints in the Database
A rule the data must always hold is also a database constraint: NOT NULL for required columns, a foreign key for each reference, CHECK for ranges, and UNIQUE for anything the code checks for uniqueness, since an exists-then-insert check races between two requests. Keep the check in code too, for clear errors. SQLite enforces foreign keys only with `PRAGMA foreign_keys = ON` on each connection.

### Types That Fit the Data
Money is a decimal type or integer minor units, never a float, which cannot hold most cent amounts exactly. A point in time is a zoned timestamp (PostgreSQL `timestamptz`) or a UTC value, never local time without its zone.

### Delete Behaviour on Purpose
Give each foreign key and ORM cascade a deliberate delete behaviour: CASCADE only for rows that mean nothing without the parent (an order's lines), RESTRICT or the default NO ACTION for references to records that stand alone (an order's customer), SET NULL for optional links.
