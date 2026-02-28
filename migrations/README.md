# Database Migrations

Imgable uses [golang-migrate](https://github.com/golang-migrate/migrate) for database schema management. Migrations run automatically when the API server starts.

## How it works

1. On startup, the API connects to PostgreSQL and checks the `schema_migrations` table
2. It compares the current database version with available migration files
3. Any new (unapplied) migrations are executed in order
4. If the database is already up-to-date, nothing happens
5. PostgreSQL advisory locks prevent race conditions if multiple API instances start simultaneously

## File naming convention

Each migration consists of two files:

```
{version}_{description}.up.sql    -- applies the migration
{version}_{description}.down.sql  -- rolls back the migration
```

- **Version** must be a unique sequential number (001, 002, 003, ...)
- **Description** is a short snake_case name describing the change
- Both `.up.sql` and `.down.sql` files are required

Examples:
```
001_init.up.sql
001_init.down.sql
002_add_photo_tags_index.up.sql
002_add_photo_tags_index.down.sql
003_create_sessions_table.up.sql
003_create_sessions_table.down.sql
```

## Adding a new migration

1. Create two files in this directory with the next version number:

```sql
-- 002_add_something.up.sql
ALTER TABLE photos ADD COLUMN new_field TEXT;
```

```sql
-- 002_add_something.down.sql
ALTER TABLE photos DROP COLUMN new_field;
```

2. Rebuild and restart the API. The migration will be applied automatically.

## Rules

- **Never edit** an already applied migration. Create a new one instead.
- **Always provide a down migration** that fully reverses the up migration.
- Each migration should be **atomic** -- one logical change per migration.
- Use `IF NOT EXISTS` / `IF EXISTS` where appropriate for safety.
- Test both up and down migrations before committing.

## Configuration

The migrations directory path is configured via the `MIGRATIONS_PATH` environment variable. Default: `/migrations` (inside the Docker container).

For local development, set it to the project's migrations directory:
```
MIGRATIONS_PATH=./migrations
```
