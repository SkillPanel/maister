## Database Migrations

### Reversible
Always implement rollback methods for safe migration reversals.

### Small and Focused
Keep each migration to a single logical change.

### Zero-Downtime Awareness
Consider deployment order and backward compatibility for high-availability systems.

### Separate Schema and Data
Keep schema changes separate from data migrations for safer rollbacks.

### Careful Indexing
Create indexes on large tables carefully, using concurrent options when available.

### Descriptive Names
Use names that indicate what the migration does.

### Version Control
Commit migrations; never modify existing ones after deployment.
