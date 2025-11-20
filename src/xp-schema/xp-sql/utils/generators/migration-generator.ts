/**
 * Migration Generator
 * 
 * Generates dialect-specific migrations by comparing dialect-agnostic schemas.
 * Uses shared Step 1 → Step 2 architecture.
 */

import type { Schema } from '../../schema';
import type { SQLDialect } from '../../dialects/types';
import { getDialectFromName } from '../../dialects';
import { extractDialectAgnosticSchema, convertToDialectSpecific, createSchemaSnapshot } from './unified-generator';
import type { DialectAgnosticTableMetadata } from '../schema-extraction/dialect-agnostic-schema';
import type { TableMetadata } from '../schema-extraction/schema-diff';
import { compareTables } from '../schema-extraction/schema-diff';
import { generateMigrationFromSnapshotDiff, generateCreateScriptFromSnapshot } from '../sql-generation/snapshot-sql-generator';
import type { SchemaSnapshot } from '../sql-generation/snapshot-sql-generator';

/**
 * Compare two dialect-agnostic schemas
 * Returns differences that can be used to generate migrations
 */
export function compareAgnosticSchemas(
  oldSchema: Record<string, DialectAgnosticTableMetadata>,
  newSchema: Record<string, DialectAgnosticTableMetadata>
): {
  addedTables: string[];
  removedTables: string[];
  modifiedTables: Array<{
    tableName: string;
    oldTable: DialectAgnosticTableMetadata;
    newTable: DialectAgnosticTableMetadata;
  }>;
} {
  const oldTableNames = new Set(Object.keys(oldSchema));
  const newTableNames = new Set(Object.keys(newSchema));
  
  const addedTables: string[] = [];
  const removedTables: string[] = [];
  const modifiedTables: Array<{
    tableName: string;
    oldTable: DialectAgnosticTableMetadata;
    newTable: DialectAgnosticTableMetadata;
  }> = [];
  
  // Find added tables
  for (const tableName of newTableNames) {
    if (!oldTableNames.has(tableName)) {
      addedTables.push(tableName);
    }
  }
  
  // Find removed tables
  for (const tableName of oldTableNames) {
    if (!newTableNames.has(tableName)) {
      removedTables.push(tableName);
    }
  }
  
  // Find modified tables (compare dialect-agnostic schemas)
  for (const tableName of oldTableNames) {
    if (newTableNames.has(tableName)) {
      const oldTable = oldSchema[tableName];
      const newTable = newSchema[tableName];
      
      // Simple comparison - if JSON strings differ, table is modified
      // More sophisticated comparison can be added later
      if (JSON.stringify(oldTable) !== JSON.stringify(newTable)) {
        modifiedTables.push({ tableName, oldTable, newTable });
      }
    }
  }
  
  return { addedTables, removedTables, modifiedTables };
}

/**
 * Generate migration SQL from two dialect-agnostic schemas
 */
export async function generateMigrationFromAgnosticSchemas(
  oldAgnosticSchema: Record<string, DialectAgnosticTableMetadata> | undefined,
  newAgnosticSchema: Record<string, DialectAgnosticTableMetadata>,
  dialect: 'sqlite' | 'pg',
  migrationName: string = 'migration'
): Promise<string> {
  const dialectObj = await getDialectFromName(dialect);
  
  // If no old schema, generate initial migration
  if (!oldAgnosticSchema) {
    const dialectSpecific = await convertToDialectSpecific(newAgnosticSchema, dialectObj);
    const snapshot = createSchemaSnapshot(dialectSpecific, migrationName);
    return generateCreateScriptFromSnapshot(snapshot, dialect, { ifNotExists: false });
  }
  
  // Convert both schemas to dialect-specific for comparison
  const oldDialectSpecific = await convertToDialectSpecific(oldAgnosticSchema, dialectObj);
  const newDialectSpecific = await convertToDialectSpecific(newAgnosticSchema, dialectObj);
  
  // Create snapshots
  const oldSnapshot = createSchemaSnapshot(oldDialectSpecific, 'old');
  const newSnapshot = createSchemaSnapshot(newDialectSpecific, migrationName);
  
  // Compare tables using dialect-specific metadata
  const diff = {
    addedTables: [] as string[],
    removedTables: [] as string[],
    modifiedTables: [] as Array<{
      tableName: string;
      addedColumns: string[];
      removedColumns: string[];
      modifiedColumns: Array<{ columnName: string; changes: string[] }>;
      addedForeignKeys: Array<{ localColumns: string[]; refTable: string; refColumns: string[] }>;
      removedForeignKeys: Array<{ localColumns: string[]; refTable: string; refColumns: string[] }>;
      addedUniqueConstraints: Array<{ name?: string; columns: string[] }>;
      removedUniqueConstraints: Array<{ name?: string; columns: string[] }>;
      addedIndexes: Array<{ name: string; columns: string[]; unique: boolean }>;
      removedIndexes: Array<{ name: string; columns: string[]; unique: boolean }>;
    }>,
  };
  
  // Find added/removed tables
  const oldTableNames = new Set(Object.keys(oldDialectSpecific));
  const newTableNames = new Set(Object.keys(newDialectSpecific));
  
  for (const tableName of newTableNames) {
    if (!oldTableNames.has(tableName)) {
      diff.addedTables.push(tableName);
    }
  }
  
  for (const tableName of oldTableNames) {
    if (!newTableNames.has(tableName)) {
      diff.removedTables.push(tableName);
    }
  }
  
  // Find modified tables
  for (const tableName of oldTableNames) {
    if (newTableNames.has(tableName)) {
      const oldTable = oldDialectSpecific[tableName];
      const newTable = newDialectSpecific[tableName];
      const tableDiff = compareTables(oldTable, newTable);
      if (tableDiff) {
        diff.modifiedTables.push(tableDiff);
      }
    }
  }
  
  // Generate migration SQL
  return generateMigrationFromSnapshotDiff(diff, newSnapshot, dialect);
}

/**
 * Generate migrations from schema
 * Main entry point for migration generation
 */
export async function generateMigrations(
  schema: Schema<any>,
  oldAgnosticSchema: Record<string, DialectAgnosticTableMetadata> | undefined,
  dialects: ('sqlite' | 'pg')[] = ['sqlite', 'pg'],
  migrationName: string = 'migration'
): Promise<Record<'sqlite' | 'pg', string>> {
  // Step 1: Extract dialect-agnostic schema
  const newAgnosticSchema = extractDialectAgnosticSchema(schema);
  
  // Generate migrations for each dialect
  const migrations: Record<'sqlite' | 'pg', string> = {} as any;
  
  for (const dialect of dialects) {
    migrations[dialect] = await generateMigrationFromAgnosticSchemas(
      oldAgnosticSchema,
      newAgnosticSchema,
      dialect,
      migrationName
    );
  }
  
  return migrations;
}

