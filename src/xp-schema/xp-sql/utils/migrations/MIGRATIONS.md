# Migration Generation System

This directory contains utilities for generating database migrations from unbound schemas.

## Overview

The migration system allows you to:
1. Generate initial migrations from an unbound schema
2. Generate incremental migrations by detecting schema differences
3. Support multiple SQL dialects (SQLite, PostgreSQL) with separate migration folders
4. Use database introspection to detect current schema state

## Files

- `migrations/migration-generator.ts` - Core migration generation logic
- `schema-extraction/schema-diff.ts` - Schema comparison and diffing utilities
- `migrations/generate-migrations.ts` - CLI script for generating migrations
- `migrations/migrations.ts` - Migration execution utilities (existing)

## Usage

### Basic Usage (CLI)

Generate migrations from a schema file:

```bash
npx tsx xp-deeby/xp-schema/xp-sql/utils/migrations/generate-migrations.ts <schema-file> <export-name> [migrations-dir] [migration-name]
```

**Example:**

```bash
# Generate initial migrations
npx tsx xp-deeby/xp-schema/xp-sql/utils/generate-migrations.ts ./schema.ts schema ./migrations

# Generate incremental migration with custom name
npx tsx xp-deeby/xp-schema/xp-sql/utils/generate-migrations.ts ./schema.ts schema ./migrations add_user_email
```

### Programmatic Usage

```typescript
import { generateMigrations } from 'xp-deeby/xp-schema/xp-sql/utils/migrations/migration-generator';
import { schema } from './schema';

const result = await generateMigrations({
  migrationsDir: './migrations',
  schema: schema,
  existingMigrationsPath: './migrations', // Optional: for incremental migrations
  migrationName: 'add_user_email', // Optional: custom name
  dialects: ['sqlite', 'pg'], // Optional: defaults to both
});

console.log('Generated migrations:', result.migrationFiles);
```

### With Database Introspection

For more accurate incremental migrations, you can provide a database connection:

```typescript
import { generateMigrations } from 'xp-deeby/xp-schema/xp-sql/utils/migrations/migration-generator';
import { schema } from './schema';
import { connect } from 'xp-deeby/xp-schema';

const db = await schema.connect(connectionInfo);

const result = await generateMigrations({
  migrationsDir: './migrations',
  schema: schema,
  database: db, // Provides schema introspection
  existingMigrationsPath: './migrations',
});
```

## Migration Folder Structure

Migrations are organized by dialect:

```
migrations/
├── sqlite/
│   ├── 0001_initial.sql
│   ├── 0002_add_user_email.sql
│   └── ...
└── pg/
    ├── 0001_initial.sql
    ├── 0002_add_user_email.sql
    └── ...
```

## Migration Types

### Initial Migrations

When no existing migrations are found, the system generates a full `CREATE TABLE` script for all tables in the schema.

### Incremental Migrations

When existing migrations are found, the system:

1. **With Database Connection**: Uses database introspection to detect the current schema, compares it with the new schema, and generates `ALTER TABLE` statements for differences.

2. **Without Database Connection**: Generates a full `CREATE TABLE IF NOT EXISTS` script with a warning comment. You should review and modify this migration manually.

## Schema Differences Detected

The system can detect:

- **Tables**: Added/removed tables
- **Columns**: Added/removed/modified columns
  - Type changes
  - Nullability changes
  - Default value changes
  - Primary key changes
  - Unique constraint changes
- **Constraints**: Added/removed foreign keys, unique constraints, indexes

## Limitations

1. **Column Modifications**: Some column modifications (especially type changes) may require table recreation, which the system cannot do automatically. These are marked with `TODO` comments.

2. **SQLite Constraints**: SQLite has limited `ALTER TABLE` support. Some constraint changes require table recreation, which is noted in the generated SQL.

3. **Foreign Key Names**: Dropping foreign keys requires the constraint name, which may not always be available. The system marks these with `TODO` comments.

4. **Schema Introspection**: Without a database connection, the system cannot determine the current schema state and will generate a full `CREATE TABLE IF NOT EXISTS` script.

## Best Practices

1. **Review Generated Migrations**: Always review generated migrations before applying them, especially incremental ones.

2. **Use Database Connection**: When possible, provide a database connection for more accurate incremental migrations.

3. **Version Control**: Commit migration files to version control.

4. **Test Migrations**: Test migrations on a development database before applying to production.

5. **Migration Naming**: Use descriptive migration names that indicate what changed (e.g., `add_user_email`, `remove_old_columns`).

## Running Migrations

Use the existing `runMigrations` utility from `migrations.ts`:

```typescript
import { runMigrations } from 'xp-deeby/xp-schema/xp-sql/utils/migrations/migrations';
import { db } from './database';
import * as migrations from './migrations/sqlite';

await runMigrations(db, {
  migrationsTableName: '__drizzle_migrations_my_module',
  migrations: Object.values(migrations),
  onMigrationApplied: (migration) => {
    console.log(`Applied: ${migration.name}`);
  }
});
```

