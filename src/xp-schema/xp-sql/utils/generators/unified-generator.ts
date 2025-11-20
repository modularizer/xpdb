/**
 * Unified Generator
 * 
 * Shared code for generating:
 * 1. Dialect-specific CREATE scripts (with IF NOT EXISTS)
 * 2. Types
 * 3. Dialect-specific migrations
 * 
 * All three tasks use the same architecture:
 * Step 1: Extract dialect-agnostic schema from unbound tables
 * Step 2: Convert to dialect-specific SQL/metadata
 */

import type { Schema } from '../../schema';
import type { SQLDialect } from '../../dialects/types';
import { getDialectFromName } from '../../dialects';
import { extractSchemaMetadataFromUnbound } from '../schema-extraction/extract-schema-metadata';
import { convertAgnosticTableToDialectSpecific } from '../schema-extraction/dialect-metadata-merger';
import type { DialectAgnosticSchema, DialectAgnosticTableMetadata } from '../schema-extraction/dialect-agnostic-schema';
import type { TableMetadata } from '../schema-extraction/schema-diff';
import { generateCreateScriptFromSnapshot } from '../sql-generation/snapshot-sql-generator';
import type { SchemaSnapshot } from '../sql-generation/snapshot-sql-generator';
import { validateSQLOrThrow } from '../../../utils/validate-sql';
import * as crypto from 'crypto';

/**
 * Extract dialect-agnostic schema from a schema object (Step 1)
 * This is shared by all three generators
 */
export function extractDialectAgnosticSchema(
  schema: Schema<any>
): Record<string, DialectAgnosticTableMetadata> {
  return extractSchemaMetadataFromUnbound(schema);
}

/**
 * Convert dialect-agnostic schema to dialect-specific metadata (Step 2)
 * This is shared by CREATE scripts and migrations
 */
export async function convertToDialectSpecific(
  agnosticSchema: Record<string, DialectAgnosticTableMetadata>,
  dialect: SQLDialect
): Promise<Record<string, TableMetadata>> {
  const dialectSpecific: Record<string, TableMetadata> = {};
  
  for (const [tableName, agnosticTable] of Object.entries(agnosticSchema)) {
    dialectSpecific[tableName] = convertAgnosticTableToDialectSpecific(agnosticTable, dialect);
  }
  
  return dialectSpecific;
}

/**
 * Create a schema snapshot from dialect-specific metadata
 * Used by CREATE scripts and migrations
 */
export function createSchemaSnapshot(
  tables: Record<string, TableMetadata>,
  migrationName: string = 'initial'
): SchemaSnapshot {
  // Sort table keys for consistent hashing
  const sortedTableNames = Object.keys(tables).sort();
  const sortedTables: Record<string, TableMetadata> = {};
  for (const tableName of sortedTableNames) {
    sortedTables[tableName] = tables[tableName];
  }
  
  // Calculate hash of tables JSON
  const tablesJson = JSON.stringify(sortedTables);
  const schemaHash = crypto.createHash('sha256').update(tablesJson).digest('hex');
  
  return {
    version: 1,
    timestamp: Date.now(),
    migrationName,
    tables: sortedTables,
    schemaHash,
  };
}

/**
 * Generate CREATE script from dialect-agnostic schema
 * Uses shared Step 1 → Step 2 → SQL generation
 */
export async function generateCreateScriptFromAgnostic(
  agnosticSchema: Record<string, DialectAgnosticTableMetadata>,
  dialect: 'sqlite' | 'pg',
  options: { ifNotExists?: boolean } = {}
): Promise<string> {
  const dialectObj = await getDialectFromName(dialect);
  const dialectSpecific = await convertToDialectSpecific(agnosticSchema, dialectObj);
  const snapshot = createSchemaSnapshot(dialectSpecific, 'create-script');
  
  const sql = generateCreateScriptFromSnapshot(snapshot, dialect, {
    ifNotExists: options.ifNotExists !== false, // Default to true
  });
  
  // Validate the generated SQL
  validateSQLOrThrow(sql, dialect, 'CREATE script generation');
  
  return sql;
}

/**
 * Generate CREATE script from schema object
 * Main entry point for CREATE script generation
 */
export async function generateCreateScript(
  schema: Schema<any>,
  dialect: 'sqlite' | 'pg',
  options: { ifNotExists?: boolean } = {}
): Promise<string> {
  // Step 1: Extract dialect-agnostic schema
  const agnosticSchema = extractDialectAgnosticSchema(schema);
  
  // Step 2: Convert to dialect-specific and generate SQL
  return await generateCreateScriptFromAgnostic(agnosticSchema, dialect, options);
}

