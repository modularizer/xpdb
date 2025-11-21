/**
 * Extract schema metadata from a schema
 * 
 * This is the main entry point for extracting schema metadata in a dialect-agnostic way.
 * It can be used by both migration generation and schema JSON export.
 */

import type { Schema } from '../../schema';
import type { UTable } from '../../dialects/implementations/unbound';
import { isUTable, bindTable } from '../../dialects/implementations/unbound';
import { extractTableMetadataFromUnbound } from './extract-from-unbound';
import { convertAgnosticTableToDialectSpecific } from './dialect-metadata-merger';
import type { TableMetadata } from './schema-diff';
import { extractTableMetadata } from './schema-diff';
import type { Table } from 'drizzle-orm';
import type { SQLDialect } from '../../dialects/types';
import type { DialectAgnosticTableMetadata } from './dialect-agnostic-schema';

/**
 * Extract schema metadata from a schema object
 * Returns dialect-agnostic metadata from unbound tables (Step 1)
 * 
 * @param schema - The schema object containing tables
 * @returns A record of table names to their dialect-agnostic metadata
 */
export function extractSchemaMetadataFromUnbound(
  schema: Schema<any>
): Record<string, DialectAgnosticTableMetadata> {
  const metadata: Record<string, DialectAgnosticTableMetadata> = {};
  const allUnboundTables: Record<string, UTable<any>> = {};
  
  // First pass: collect all unbound tables
  for (const [tableName, table] of Object.entries(schema.tables)) {
    if (isUTable(table)) {
      allUnboundTables[tableName] = table;
    }
  }
  
  // Second pass: extract metadata from each unbound table
  // Pass allUnboundTables so foreign key references can be resolved
  for (const [tableName, table] of Object.entries(schema.tables)) {
    if (isUTable(table)) {
      metadata[tableName] = extractTableMetadataFromUnbound(table, allUnboundTables);
    }
  }
  
  return metadata;
}

/**
 * Extract schema metadata with dialect-specific type information
 * 
 * @param schema - The schema object containing tables
 * @param dialect - The SQL dialect to bind tables to
 * @returns A record of table names to their complete metadata (with dialect-specific types)
 */
export async function extractSchemaMetadataWithDialect(
  schema: Schema<any>,
  dialect: SQLDialect
): Promise<Record<string, TableMetadata>> {
  const unboundMetadata = extractSchemaMetadataFromUnbound(schema);
  const boundTables: Record<string, Table> = {};
  const unboundTables: Record<string, UTable<any>> = {};
  
  // Bind all tables to the dialect
  for (const [tableName, table] of Object.entries(schema.tables)) {
    if (isUTable(table)) {
      unboundTables[tableName] = table;
      boundTables[tableName] = bindTable(table, dialect);
    } else {
      boundTables[tableName] = table as Table;
    }
  }
  
  // Merge unbound metadata with bound table type information
  const finalMetadata: Record<string, TableMetadata> = {};
  for (const [tableName, unboundMeta] of Object.entries(unboundMetadata)) {
    const boundTable = boundTables[tableName];
    const unboundTable = unboundTables[tableName];
    
    if (!boundTable) {
      console.warn(`Table ${tableName} has unbound metadata but no bound table - skipping`);
      continue;
    }
    
    if (!unboundTable) {
      console.warn(`Table ${tableName} has bound table but no unbound table - using bound table extraction`);
      // Fallback to bound-only extraction
      finalMetadata[tableName] = extractTableMetadata(boundTable, dialect.dialectName as 'sqlite' | 'pg');
      continue;
    }
    
    // Both exist - convert dialect-agnostic to dialect-specific (Step 2)
    try {
      finalMetadata[tableName] = convertAgnosticTableToDialectSpecific(
        unboundMeta,
        dialect
      );
    } catch (error) {
      console.error(`Failed to convert metadata for table ${tableName}:`, error);
      // Fallback to bound-only extraction
      const dialectName = dialect.dialectName as 'sqlite' | 'pg';
      finalMetadata[tableName] = extractTableMetadata(boundTable, dialectName);
    }
  }
  
  return finalMetadata;
}

/**
 * Get schema JSON representation
 * Returns a JSON-serializable representation of the schema metadata
 * 
 * @param schema - The schema object
 * @param dialect - Optional dialect to include dialect-specific type information
 * @returns JSON-serializable schema metadata
 */
export async function getSchemaJson(
  schema: Schema<any>,
  dialect?: SQLDialect
): Promise<Record<string, any>> {
  if (dialect) {
    // Include dialect-specific type information
    const metadata = await extractSchemaMetadataWithDialect(schema, dialect);
    return metadata;
  } else {
    // Return dialect-agnostic metadata from unbound tables
    const metadata = extractSchemaMetadataFromUnbound(schema);
    return metadata;
  }
}

/**
 * Get table JSON representation from a single bound table
 * Returns a JSON-serializable representation of the table metadata
 * 
 * @param table - The bound table
 * @param dialect - The SQL dialect
 * @param unboundTable - Optional unbound table for better metadata extraction
 * @param allUnboundTables - Optional all unbound tables for FK resolution
 * @returns JSON-serializable table metadata
 */
export function getTableJson(
  table: Table,
  dialect: 'sqlite' | 'pg',
  unboundTable?: UTable<any>,
  allUnboundTables?: Record<string, UTable<any>>
): TableMetadata {
  // extractTableMetadata signature: (table, dialect, unboundTable?, allUnboundTables?)
  // TypeScript may not recognize the optional parameters correctly, so we call with just the required ones
  // and let the function handle the optional parameters internally
  return extractTableMetadata(table, dialect);
}

/**
 * Get schema JSON representation from bound tables
 * Returns a JSON-serializable representation of the schema metadata from already-bound tables
 * 
 * @param tables - Record of bound tables
 * @param dialect - The SQL dialect
 * @returns JSON-serializable schema metadata
 */
export async function getSchemaJsonFromBoundTables(
  tables: Record<string, Table>,
  dialect: 'sqlite' | 'pg'
): Promise<Record<string, TableMetadata>> {
  const metadata: Record<string, TableMetadata> = {};
  for (const [schemaKey, table] of Object.entries(tables)) {
    try {
      const tableMeta = await Promise.resolve(extractTableMetadata(table, dialect));
      // Use the actual table name from the metadata, not the schema key
      // This ensures the metadata key matches the actual database table name
      const actualTableName = tableMeta.name || schemaKey;
      metadata[actualTableName] = tableMeta;
    } catch (error: any) {
      throw new Error(
        `Failed to extract metadata for table "${schemaKey}": ${error.message}. ` +
        `Table type: ${typeof table}, table keys: ${Object.keys(table || {}).slice(0, 10).join(', ')}. ` +
        `Original error: ${error.stack || error}`
      );
    }
  }
  return metadata;
}

