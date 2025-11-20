# Schema Utilities Architecture

This directory contains the core utilities for the three-step architecture:

## Step 1: Dialect-Agnostic Schema Extraction

**Files:**
- `schema-extraction/dialect-agnostic-schema.ts` - Defines `DialectAgnosticColumnMetadata`, `DialectAgnosticTableMetadata`, `DialectAgnosticSchema`
- `schema-extraction/extract-from-unbound.ts` - Extracts dialect-agnostic metadata from unbound tables (NO SQL code, NO dialect-specific logic)

## Step 2: Dialect-Specific SQL Generation

**Files:**
- `schema-extraction/dialect-metadata-merger.ts` - Converts dialect-agnostic metadata to dialect-specific SQL type strings
- `sql-generation/dialect-sql-generator.ts` - Generates SQL from dialect-specific metadata
- `sql-generation/snapshot-sql-generator.ts` - Generates SQL from schema snapshots (CREATE TABLE, ALTER TABLE, etc.)
- `sql-generation/generate-create-script.ts` - Generates CREATE scripts for entire schemas

## Step 3: Migration Generation

**Files:**
- `migrations/migration-generator.ts` - Generates migrations by comparing dialect-agnostic schemas
- `migrations/generate-migrations.ts` - CLI script for generating migrations
- `migrations/migrations.ts` - Migration execution utilities

## Entry Points

**Files:**
- `schema-extraction/extract-schema-metadata.ts` - Main entry point for schema extraction (uses Step 1 and Step 2)

## Legacy Code (Needs Refactoring)

**Files:**
- `schema-extraction/schema-diff.ts` - Contains `ColumnMetadata`, `TableMetadata`, `SchemaDiff` interfaces and `compareTables`/`diffSchemas` functions
  - **TODO**: `extractTableMetadata()` in this file still extracts from bound tables (old way)
  - **TODO**: `compareTables()` and `diffSchemas()` should work with dialect-agnostic schemas, not `TableMetadata` with SQL type strings
  - The interfaces are still used throughout the codebase, but the extraction logic should be refactored to use Step 1 → Step 2

## Utilities

**Files:**
- `misc/uuid.ts` - UUID generation utility

## Removed Files

- `query/query-builder.ts` - Not related to schema extraction/SQL generation
- `query/sql-transform.ts` - Not related to schema extraction/SQL generation
