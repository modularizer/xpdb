# Unified Generators

This directory contains unified generators that share code across three tasks:

1. **Generate dialect-specific CREATE scripts** (with IF NOT EXISTS)
2. **Generate types**
3. **Generate dialect-specific migrations**

## Architecture

All three generators use the same two-step architecture:

### Step 1: Extract Dialect-Agnostic Schema
- Extract metadata from unbound tables
- No SQL-specific code, no dialect-specific logic
- Returns `DialectAgnosticTableMetadata` with abstract types (`'varchar'`, `'text'`, etc.)

### Step 2: Convert to Dialect-Specific
- Convert dialect-agnostic metadata to dialect-specific SQL type strings
- Each dialect implements `MetadataMerger` interface
- Returns `TableMetadata` with SQL type strings (`'VARCHAR(255)'`, `'TEXT'`, etc.)

## Files

### `unified-generator.ts`
Shared functions used by all generators:
- `extractDialectAgnosticSchema()` - Step 1
- `convertToDialectSpecific()` - Step 2
- `createSchemaSnapshot()` - Create snapshot from dialect-specific metadata
- `generateCreateScript()` - Main entry point for CREATE scripts

### `migration-generator.ts`
Migration-specific functions:
- `compareAgnosticSchemas()` - Compare two dialect-agnostic schemas
- `generateMigrationFromAgnosticSchemas()` - Generate migration SQL
- `generateMigrations()` - Main entry point for migrations

## Usage

### CREATE Scripts
```typescript
import { generateCreateScript } from './unified-generator';

const sql = await generateCreateScript(schema, 'pg', { ifNotExists: true });
```

### Migrations
```typescript
import { generateMigrations } from './migration-generator';

const migrations = await generateMigrations(
  newSchema,
  oldAgnosticSchema, // undefined for initial migration
  ['sqlite', 'pg'],
  'add_user_email'
);
```

### Types
Types generation uses ts-morph and doesn't need the unified generator (it works directly with TypeScript types from source files).

