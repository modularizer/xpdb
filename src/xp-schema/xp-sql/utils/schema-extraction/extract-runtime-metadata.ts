/**
 * Extract schema metadata from a live database connection
 * 
 * This module provides functions to extract full schema metadata (including
 * PKs, FKs, constraints, indexes) from a live database connection by
 * using the dialect's introspection methods.
 */

import type { SQLDialect } from '../../dialects/types';
import type { TableMetadata, ColumnMetadata } from './schema-diff';
import { extractTableMetadata } from './schema-diff';
import type { Table } from 'drizzle-orm';
import type { DrizzleDatabaseConnectionDriver } from '../../drivers/types';

/**
 * Extract full table metadata from a live database table
 * Uses the dialect's introspection methods to get complete metadata including
 * PKs, FKs, constraints, and indexes
 * 
 * @param db - Database connection driver
 * @param dialect - SQL dialect
 * @param tableName - Name of the table to extract metadata from
 * @param schemaName - Schema name (default: 'public')
 * @returns Complete table metadata
 */
export async function extractRuntimeTableMetadata(
  db: DrizzleDatabaseConnectionDriver,
  dialect: SQLDialect,
  tableName: string,
  schemaName: string = 'public'
): Promise<TableMetadata> {
  // Get the runtime table (for column information)
  const runtimeTable = await dialect.getRuntimeTable(db, tableName, schemaName);
  
  // Extract basic metadata from the runtime table
  const baseMetadata = extractTableMetadata(runtimeTable, dialect);
  
  // Ensure it's a promise result
  const metadata = await Promise.resolve(baseMetadata);
  
  // Get additional metadata using introspection methods
  const [primaryKeys, foreignKeys, uniqueConstraints, indexes] = await Promise.all([
    dialect.getTablePrimaryKeys(db, tableName, schemaName),
    dialect.getTableForeignKeys(db, tableName, schemaName),
    dialect.getTableUniqueConstraints(db, tableName, schemaName),
    dialect.getTableIndexes(db, tableName, schemaName),
  ]);
  
  // Merge the introspection results into the metadata
  // Override primary keys from introspection (more accurate)
  if (primaryKeys.length > 0) {
    // Flatten all primary key columns
    const pkColumns: string[] = [];
    for (const pk of primaryKeys) {
      pkColumns.push(...pk.columns);
    }
    metadata.primaryKeys = [...new Set(pkColumns)].sort();
  }
  
  // Override foreign keys from introspection (more accurate)
  if (foreignKeys.length > 0) {
    metadata.foreignKeys = foreignKeys.map(fk => ({
      localColumns: fk.columns,
      refTable: fk.referencedTable,
      refColumns: fk.referencedColumns,
    }));
  }
  
  // Override unique constraints from introspection (more accurate)
  if (uniqueConstraints.length > 0) {
    metadata.uniqueConstraints = uniqueConstraints.map(uc => ({
      name: uc.name,
      columns: uc.columns,
    }));
  }
  
  // Override indexes from introspection (more accurate)
  if (indexes.length > 0) {
    metadata.indexes = indexes.map(idx => ({
      name: idx.name,
      columns: idx.columns,
      unique: idx.unique,
    }));
  }
  
  return metadata;
}

/**
 * Extract full schema metadata from a live database connection
 * Gets all tables and extracts complete metadata for each
 * 
 * @param db - Database connection driver
 * @param dialect - SQL dialect
 * @param schemaName - Schema name (default: 'public')
 * @returns Record of table names to their complete metadata
 */
export async function extractRuntimeSchemaMetadata(
  db: DrizzleDatabaseConnectionDriver,
  dialect: SQLDialect,
  schemaName: string = 'public'
): Promise<Record<string, TableMetadata>> {
  // Get all table names
  const tableNames = await dialect.getTableNames(db, schemaName);
  
  // Extract metadata for each table
  const metadata: Record<string, TableMetadata> = {};
  
  for (const tableName of tableNames) {
    try {
      metadata[tableName] = await extractRuntimeTableMetadata(
        db,
        dialect,
        tableName,
        schemaName
      );
    } catch (error) {
      console.error(`Failed to extract metadata for table ${tableName}:`, error);
      // Continue with other tables even if one fails
    }
  }
  
  return metadata;
}

