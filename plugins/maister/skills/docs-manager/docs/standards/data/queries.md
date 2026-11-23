## Database Queries

### Avoid N+1
Load related rows in a fixed number of queries (eager loading, a join, or one `IN (...)` batch), not one query per row. Watch lazy-loaded relations read inside loops, serializers and templates: they issue the per-row queries out of sight.

### Index What New Queries Filter On
When a change adds a query, check that an index covers its filter, join and sort columns (a composite index covers its leading columns) and add one in a migration when none does. Index a foreign key's referencing columns: PostgreSQL and SQLite do not do it for you, MySQL InnoDB does. Add no index that no query uses.

### Transactions
Writes that must succeed or fail together run in one transaction, and calls to other services and slow work stay outside it. A transaction alone does not stop a lost update: a read-modify-write of one row (a balance, a stock count) is an atomic update (`SET qty = qty - 1 WHERE qty > 0`), a row lock (`SELECT ... FOR UPDATE`) or a version check.

### Query Timeouts
A new database connection or pool in a long-running process sets a statement timeout, unless the project sets one on the database or role: the default is none (PostgreSQL `statement_timeout` is 0), so a runaway query holds its connection until it ends.
