/**
 * Generate migrations from a live database connection
 * 
 * Compares the current state of a live database with either:
 * 1. A schema snapshot (from previous migrations)
 * 2. A schema definition (from unbound tables)
 * 
 * Generates the SQL migration needed to bring the live database up to date.
 */

import type { XPDatabaseConnectionPlus } from '../../../xp-plus/database';
import type { SQLDialect } from '../../dialects/types';
import type { SchemaSnapshot } from '../sql-generation/snapshot-sql-generator';
import { generateMigrationFromSnapshotDiff } from '../sql-generation/snapshot-sql-generator';
import { extractRuntimeSchemaMetadata } from '../schema-extraction/extract-runtime-metadata';
import { compareTables, diffSchemas, type SchemaDiff, type TableMetadata } from '../schema-extraction/schema-diff';
import { extractSchemaMetadataWithDialect } from '../schema-extraction/extract-schema-metadata';
import type { Schema } from '../../schema';
import { getDialectFromName } from '../../dialects';

/**
 * Options for generating migrations from a live database
 */
export interface GenerateMigrationsFromLiveOptions {
  /**
   * Optional schema snapshot to compare against
   * If provided, generates migration from snapshot to live DB state
   */
  snapshot?: SchemaSnapshot;
  
  /**
   * Optional schema definition to compare against
   * If provided, generates migration from live DB to schema definition
   */
  schema?: Schema<any>;
  
  /**
   * Schema name (default: 'public')
   */
  schemaName?: string;
}

/**
 * Result of generating migrations from a live database
 */
export interface GenerateMigrationsFromLiveResult {
  /**
   * The generated migration SQL
   */
  migrationSQL: string;
  
  /**
   * The schema diff between live DB and target
   */
  diff: SchemaDiff;
  
  /**
   * Metadata extracted from the live database
   */
  liveMetadata: Record<string, TableMetadata>;
  
  /**
   * Target metadata (from snapshot or schema)
   */
  targetMetadata: Record<string, TableMetadata>;
  
  /**
   * Dialect name
   */
  dialect: 'sqlite' | 'pg';
}

/**
 * Generate migration SQL to bring a live database up to a schema snapshot
 * 
 * @param db - Database connection
 * @param snapshot - Schema snapshot to compare against
 * @param schemaName - Schema name (default: 'public')
 * @returns Migration SQL and diff information
 */
export async function generateMigrationsFromSnapshot(
  db: XPDatabaseConnectionPlus,
  snapshot: SchemaSnapshot,
  schemaName: string = 'public'
): Promise<GenerateMigrationsFromLiveResult> {
  const dialect = await getDialectFromName(db.dialect.dialectName);
  
  // Extract metadata from live database
  const liveMetadata = await extractRuntimeSchemaMetadata(
    db.db,
    dialect,
    schemaName
  );
  
  // Use snapshot metadata as target
  const targetMetadata = snapshot.tables;
  
  // Compare and generate diff
  // We need to manually compare TableMetadata since diffSchemas expects Table objects
  // Build the diff by comparing metadata directly
  const diff: SchemaDiff = {
    addedTables: [],
    removedTables: [],
    modifiedTables: [],
  };
  
  const liveTableNames = new Set(Object.keys(liveMetadata));
  const targetTableNames = new Set(Object.keys(targetMetadata));
  
  // Find added tables (in target but not in live)
  for (const tableName of targetTableNames) {
    if (!liveTableNames.has(tableName)) {
      diff.addedTables.push(tableName);
    }
  }
  
  // Find removed tables (in live but not in target)
  for (const tableName of liveTableNames) {
    if (!targetTableNames.has(tableName)) {
      diff.removedTables.push(tableName);
    }
  }
  
  // Compare existing tables
  for (const tableName of liveTableNames) {
    if (targetTableNames.has(tableName)) {
      const tableDiff = compareTables(liveMetadata[tableName], targetMetadata[tableName]);
      if (tableDiff) {
        diff.modifiedTables.push(tableDiff);
      }
    }
  }
  
  // Generate migration SQL
  const migrationSQL = generateMigrationFromSnapshotDiff(
    diff,
    snapshot,
    dialect.dialectName as 'sqlite' | 'pg'
  );
  
  return {
    migrationSQL,
    diff,
    liveMetadata,
    targetMetadata,
    dialect: dialect.dialectName as 'sqlite' | 'pg',
  };
}

/**
 * Generate migration SQL to bring a live database up to a schema definition
 * 
 * @param db - Database connection
 * @param schema - Schema definition to compare against
 * @param schemaName - Schema name (default: 'public')
 * @returns Migration SQL and diff information
 */
export async function generateMigrationsFromSchema(
  db: XPDatabaseConnectionPlus,
  schema: Schema<any>,
  schemaName: string = 'public'
): Promise<GenerateMigrationsFromLiveResult> {
  const dialect = await getDialectFromName(db.dialect.dialectName);
  
  // Extract metadata from live database
  const liveMetadata = await extractRuntimeSchemaMetadata(
    db.db,
    dialect,
    schemaName
  );
  
  // Extract metadata from schema definition
  const targetMetadata = await extractSchemaMetadataWithDialect(schema, dialect);
  
  // Compare and generate diff
  // diffSchemas(oldSchema, newSchema) - we want to go from live (old) to target (new)
  const diff = diffSchemas(liveMetadata, targetMetadata);
  
  // Create a temporary snapshot for migration generation
  // The snapshot represents the target state (what we want to achieve)
  const tempSnapshot: SchemaSnapshot = {
    version: 1,
    timestamp: Date.now(),
    migrationName: 'temp',
    tables: targetMetadata,
    schemaHash: '', // Not needed for migration generation
  };
  
  // Create a snapshot representing the current live state (for comparison)
  const liveSnapshot: SchemaSnapshot = {
    version: 1,
    timestamp: Date.now(),
    migrationName: 'live',
    tables: liveMetadata,
    schemaHash: '',
  };
  
  // Generate migration SQL
  // generateMigrationFromSnapshotDiff expects: diff, newSnapshot, oldSnapshot?
  // The diff shows changes from old to new, so we pass target as new and live as old
  const migrationSQL = generateMigrationFromSnapshotDiff(
    diff,
    tempSnapshot,
    dialect.dialectName as 'sqlite' | 'pg',
    liveSnapshot
  );
  
  return {
    migrationSQL,
    diff,
    liveMetadata,
    targetMetadata,
    dialect: dialect.dialectName as 'sqlite' | 'pg',
  };
}

/**
 * Generate migrations from a live database
 * 
 * Compares the live database state with either a snapshot or schema definition
 * and generates the SQL migration needed.
 * 
 * @param db - Database connection
 * @param options - Options for migration generation
 * @returns Migration SQL and diff information
 */
export async function generateMigrationsFromLiveDatabase(
  db: XPDatabaseConnectionPlus,
  options: GenerateMigrationsFromLiveOptions
): Promise<GenerateMigrationsFromLiveResult> {
  const schemaName = options.schemaName || 'public';
  
  if (options.snapshot) {
    // Compare against snapshot
    return generateMigrationsFromSnapshot(db, options.snapshot, schemaName);
  } else if (options.schema) {
    // Compare against schema definition
    return generateMigrationsFromSchema(db, options.schema, schemaName);
  } else {
    throw new Error(
      'Either snapshot or schema must be provided to generate migrations from live database'
    );
  }
}

