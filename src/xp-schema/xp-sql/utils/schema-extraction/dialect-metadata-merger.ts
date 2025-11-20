/**
 * Dialect-specific SQL generation from dialect-agnostic schema
 * 
 * This module provides Step 2: Generate dialect-specific SQL from dialect-agnostic schema.
 * Each dialect should implement the MetadataMerger interface.
 */

import type { ColumnMetadata, TableMetadata } from './schema-diff';
import type { SQLDialect } from '../../dialects/types';
import type { DialectAgnosticColumnMetadata, DialectAgnosticTableMetadata } from './dialect-agnostic-schema';

/**
 * Interface for dialect-specific metadata merging
 */
export interface MetadataMerger {
  /**
   * Generate SQL type string from column type information
   */
  generateTypeString(
    columnType: string,
    length?: number,
    precision?: number,
    scale?: number,
    enumValues?: readonly string[]
  ): string;

  /**
   * Determine if a default value is a database-level default
   * (SQL expression or literal) vs application-level (function)
   */
  isDatabaseDefault(defaultArg: any): boolean;

  /**
   * Extract and normalize default value for storage
   * Returns the raw value/object, not SQL-specific structures
   */
  extractDefaultValue(defaultArg: any): any;

  /**
   * Get the SQL expression for defaultNow() for this dialect
   * Returns the structured default value object
   */
  getDefaultNowValue(): any;
}

/**
 * Get metadata merger for a dialect
 */
export function getMetadataMerger(dialect: SQLDialect): MetadataMerger {
  // Import dialect-specific mergers
  if (dialect.dialectName === 'pg') {
    return new PostgreSQLMetadataMerger();
  } else if (dialect.dialectName === 'sqlite') {
    return new SQLiteMetadataMerger();
  } else {
    throw new Error(`No metadata merger available for dialect: ${dialect.dialectName}`);
  }
}

/**
 * PostgreSQL metadata merger
 */
class PostgreSQLMetadataMerger implements MetadataMerger {
  generateTypeString(
    abstractColumnType: string,
    length?: number,
    precision?: number,
    scale?: number,
    enumValues?: readonly string[]
  ): string {
    let typeString = 'unknown';
    
    // Map abstract column types to PostgreSQL SQL types
    if (abstractColumnType === 'text') {
      typeString = length ? `VARCHAR(${length})` : 'TEXT';
    } else if (abstractColumnType === 'varchar') {
      typeString = length ? `VARCHAR(${length})` : 'VARCHAR';
    } else if (abstractColumnType === 'integer') {
      typeString = 'INTEGER';
    } else if (abstractColumnType === 'bigint') {
      typeString = 'BIGINT';
    } else if (abstractColumnType === 'boolean') {
      typeString = 'BOOLEAN';
    } else if (abstractColumnType === 'timestamp') {
      typeString = 'TIMESTAMP';
    } else if (abstractColumnType === 'date') {
      typeString = 'DATE';
    } else if (abstractColumnType === 'time') {
      typeString = 'TIME';
    } else if (abstractColumnType === 'real') {
      typeString = precision && scale ? `NUMERIC(${precision},${scale})` : 'REAL';
    } else if (abstractColumnType === 'doublePrecision') {
      typeString = 'DOUBLE PRECISION';
    } else if (abstractColumnType === 'json' || abstractColumnType === 'jsonb') {
      typeString = abstractColumnType === 'jsonb' ? 'JSONB' : 'JSON';
    } else if (abstractColumnType === 'blob') {
      typeString = 'BYTEA';
    } else {
      typeString = abstractColumnType || 'TEXT';
    }
    
    // Handle enum values - PostgreSQL doesn't support VARCHAR with enum values
    // Use TEXT with CHECK constraint instead
    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
      // For PostgreSQL, we'll use TEXT with a CHECK constraint
      // The CHECK constraint will be added in the SQL generation phase
      // Just return the base type here
      if (abstractColumnType === 'varchar' && typeString.startsWith('VARCHAR')) {
        // Keep VARCHAR if it has a length, otherwise use TEXT
        if (length) {
          // Keep VARCHAR(length) - the CHECK constraint will be added separately
          typeString = `VARCHAR(${length})`;
        } else {
          typeString = 'TEXT';
        }
      }
      // For other types, keep the base type - CHECK constraint will be added separately
    }
    
    return typeString;
  }

  isDatabaseDefault(defaultArg: any): boolean {
    // Database defaults are SQL expressions (have queryChunks) or primitive values
    // Application defaults are functions
    if (typeof defaultArg === 'function') {
      return false;
    }
    // SQL expressions have queryChunks
    if (defaultArg && typeof defaultArg === 'object' && defaultArg.queryChunks) {
      return true;
    }
    // Primitive values are database defaults
    return true;
  }

  extractDefaultValue(defaultArg: any): any {
    // For SQL expressions, preserve the structure
    if (defaultArg && typeof defaultArg === 'object' && defaultArg.queryChunks) {
      return {
        type: 'sql',
        queryChunks: defaultArg.queryChunks,
      };
    }
    // For primitives, return as-is
    return defaultArg;
  }

  getDefaultNowValue(): any {
    // PostgreSQL uses CURRENT_TIMESTAMP
    return this.extractDefaultValue({ queryChunks: [{ value: ['CURRENT_TIMESTAMP'] }] });
  }
}

/**
 * SQLite metadata merger
 */
class SQLiteMetadataMerger implements MetadataMerger {
  generateTypeString(
    abstractColumnType: string,
    length?: number,
    precision?: number,
    scale?: number,
    enumValues?: readonly string[]
  ): string {
    let typeString = 'unknown';
    
    // Map abstract column types to SQLite SQL types
    if (abstractColumnType === 'text' || abstractColumnType === 'varchar') {
      typeString = 'TEXT';
    } else if (abstractColumnType === 'integer' || abstractColumnType === 'bigint') {
      typeString = 'INTEGER';
    } else if (abstractColumnType === 'real' || abstractColumnType === 'doublePrecision') {
      typeString = precision && scale ? `NUMERIC(${precision},${scale})` : 'REAL';
    } else if (abstractColumnType === 'blob') {
      typeString = 'BLOB';
    } else if (abstractColumnType === 'boolean') {
      typeString = 'INTEGER'; // SQLite uses INTEGER for booleans
    } else if (abstractColumnType === 'timestamp') {
      typeString = 'INTEGER'; // SQLite timestamps use INTEGER (Unix epoch) when using sqliteTimestamp
    } else if (abstractColumnType === 'date' || abstractColumnType === 'time') {
      typeString = 'TEXT'; // SQLite uses TEXT for dates/times
    } else if (abstractColumnType === 'json' || abstractColumnType === 'jsonb') {
      typeString = 'TEXT'; // SQLite uses TEXT for JSON
    } else {
      typeString = abstractColumnType || 'TEXT';
    }
    
    // SQLite doesn't support enum syntax in type definition
    // Enum values will be handled with CHECK constraints in SQL generation
    // Don't modify typeString for enums in SQLite
    
    return typeString;
  }

  isDatabaseDefault(defaultArg: any): boolean {
    // Same logic as PostgreSQL
    if (typeof defaultArg === 'function') {
      return false;
    }
    if (defaultArg && typeof defaultArg === 'object' && defaultArg.queryChunks) {
      return true;
    }
    return true;
  }

  extractDefaultValue(defaultArg: any): any {
    // For SQL expressions, preserve the structure
    if (defaultArg && typeof defaultArg === 'object' && defaultArg.queryChunks) {
      return {
        type: 'sql',
        queryChunks: defaultArg.queryChunks,
      };
    }
    // For primitives, return as-is
    return defaultArg;
  }

  getDefaultNowValue(): any {
    // SQLite uses strftime('%s','now') for INTEGER timestamps (Unix epoch)
    return this.extractDefaultValue({ queryChunks: [{ value: ['(strftime(\'%s\',\'now\'))'] }] });
  }
}

/**
 * Convert dialect-agnostic column metadata to dialect-specific SQL type string
 * This is Step 2: Generate dialect-specific SQL from dialect-agnostic schema
 */
export function convertAgnosticColumnToDialectSpecific(
  agnosticCol: DialectAgnosticColumnMetadata,
  dialect: SQLDialect
): ColumnMetadata {
  const merger = getMetadataMerger(dialect);
  
  // Generate SQL type string from abstract column type
  const typeString = merger.generateTypeString(
    agnosticCol.columnType,
    agnosticCol.options?.length,
    agnosticCol.options?.precision,
    agnosticCol.options?.scale,
    agnosticCol.options?.enum
  );
  
  // Process default value
  let processedDefaultValue = agnosticCol.defaultValue;
  let processedHasDefault = agnosticCol.hasDefault;
  
  if (processedHasDefault && processedDefaultValue !== undefined) {
    // If it's a defaultNow marker, get dialect-specific SQL expression from merger
    if (processedDefaultValue && typeof processedDefaultValue === 'object' && processedDefaultValue.method === 'defaultNow') {
      processedDefaultValue = merger.getDefaultNowValue();
      processedHasDefault = true;
    } else {
      // Let the merger determine if it's a database default and extract it properly
      const isDbDefault = merger.isDatabaseDefault(processedDefaultValue);
      if (isDbDefault) {
        processedDefaultValue = merger.extractDefaultValue(processedDefaultValue);
        processedHasDefault = true;
      } else {
        // Application-level function - don't store
        processedDefaultValue = undefined;
        processedHasDefault = false;
      }
    }
  }
  
  return {
    name: agnosticCol.name,
    type: typeString,
    columnType: undefined, // Not needed in dialect-agnostic approach
    length: agnosticCol.options?.length,
    precision: agnosticCol.options?.precision,
    scale: agnosticCol.options?.scale,
    enumValues: agnosticCol.options?.enum,
    nullable: agnosticCol.nullable,
    hasDefault: processedHasDefault,
    defaultValue: processedDefaultValue,
  };
}

/**
 * Convert dialect-agnostic table metadata to dialect-specific TableMetadata
 * This is Step 2: Generate dialect-specific SQL from dialect-agnostic schema
 */
export function convertAgnosticTableToDialectSpecific(
  agnosticTable: DialectAgnosticTableMetadata,
  dialect: SQLDialect
): TableMetadata {
  const columns: Record<string, ColumnMetadata> = {};
  
  for (const [colName, agnosticCol] of Object.entries(agnosticTable.columns)) {
    columns[colName] = convertAgnosticColumnToDialectSpecific(agnosticCol, dialect);
  }
  
  return {
    name: agnosticTable.name,
    columns,
    primaryKeys: agnosticTable.primaryKeys,
    foreignKeys: agnosticTable.foreignKeys,
    uniqueConstraints: agnosticTable.uniqueConstraints,
    indexes: agnosticTable.indexes,
  };
}

/**
 * Merge unbound metadata with bound table's dialect-specific type information
 * @deprecated Use convertAgnosticTableToDialectSpecific instead for the new architecture
 */
export function mergeUnboundWithBoundMetadata(
  unboundMeta: DialectAgnosticTableMetadata,
  boundTable: any,
  dialect: SQLDialect
): TableMetadata {
  // Validate bound table exists
  if (!boundTable) {
    throw new Error(`Cannot merge metadata: bound table is null or undefined for table "${unboundMeta.name}"`);
  }
  
  // Get bound table config for type information
  let getTableConfig: any;
  if (dialect.dialectName === 'pg') {
    getTableConfig = require('drizzle-orm/pg-core').getTableConfig;
  } else {
    getTableConfig = require('drizzle-orm/sqlite-core').getTableConfig;
  }
  
  let config: any;
  try {
    config = getTableConfig(boundTable);
  } catch (error) {
    throw new Error(`Failed to get table config for table "${unboundMeta.name}": ${error}`);
  }
  
  if (!config || !config.columns) {
    throw new Error(`Invalid table config for table "${unboundMeta.name}": config or columns is null/undefined`);
  }
  
  // Get dialect-specific merger
  const merger = getMetadataMerger(dialect);
  
  // Merge column metadata - add type information from bound table
  const mergedColumns: Record<string, ColumnMetadata> = {};
  
  for (const [colName, unboundCol] of Object.entries(unboundMeta.columns)) {
    // Find the corresponding bound column
    const boundCol = Object.values(config.columns || {}).find((c: any) => c?.name === colName) as any;
    
    if (boundCol) {
      // Extract type information from bound column
      const columnType = boundCol.columnType || boundCol.dataType || '';
      const length = boundCol.length;
      const precision = boundCol.precision;
      const scale = boundCol.scale;
      
      // Generate type string using dialect-specific merger
      const typeString = merger.generateTypeString(
        columnType,
        length,
        precision,
        scale,
        (unboundCol as any).enumValues
      );
      
      // Process default value using dialect-specific merger
      let processedDefaultValue = (unboundCol as any).defaultValue;
      let processedHasDefault = (unboundCol as any).hasDefault;
      
      if (processedHasDefault && processedDefaultValue !== undefined) {
        // If it's a defaultNow marker, get dialect-specific SQL expression from merger
        if (processedDefaultValue && typeof processedDefaultValue === 'object' && processedDefaultValue.method === 'defaultNow') {
          processedDefaultValue = merger.getDefaultNowValue();
          processedHasDefault = true;
        } else {
          // Let the merger determine if it's a database default and extract it properly
          const isDbDefault = merger.isDatabaseDefault(processedDefaultValue);
          if (isDbDefault) {
            processedDefaultValue = merger.extractDefaultValue(processedDefaultValue);
            processedHasDefault = true;
          } else {
            // Application-level function - don't store
            processedDefaultValue = undefined;
            processedHasDefault = false;
          }
        }
      }
      
      mergedColumns[colName] = {
        ...unboundCol,
        type: typeString,
        columnType: columnType || undefined,
        length: length,
        precision: precision,
        scale: scale,
        hasDefault: processedHasDefault,
        defaultValue: processedDefaultValue,
      } as ColumnMetadata;
    } else {
      // If bound column not found, use unbound metadata with defaults
      mergedColumns[colName] = {
        ...unboundCol,
        type: 'TEXT', // Default fallback
        columnType: undefined,
        length: undefined,
        precision: undefined,
        scale: undefined,
      } as any as ColumnMetadata;
    }
  }
  
  // Return merged metadata
  return {
    name: unboundMeta.name,
    columns: mergedColumns,
    primaryKeys: unboundMeta.primaryKeys,
    foreignKeys: unboundMeta.foreignKeys,
    uniqueConstraints: unboundMeta.uniqueConstraints,
    indexes: unboundMeta.indexes,
  };
}

