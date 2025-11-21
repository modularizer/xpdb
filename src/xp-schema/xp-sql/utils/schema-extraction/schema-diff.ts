/**
 * Schema Diffing Utilities
 * 
 * Compares two schemas and detects differences:
 * - Added/removed tables
 * - Added/removed/modified columns
 * - Added/removed/modified constraints (primary keys, foreign keys, unique, indexes)
 */

import type { Table } from 'drizzle-orm';
import type { UTable } from '../../dialects/implementations/unbound';
import type { Schema } from '../../schema';
import { isUTable } from '../../dialects/implementations/unbound';
import { getTableName } from 'drizzle-orm';
import { extractTableMetadataFromUnbound } from './extract-from-unbound';
import { mergeUnboundWithBoundMetadata } from './dialect-metadata-merger';
import type { UnboundTable } from '../../dialects/implementations/unbound';
import { getDialectFromName } from '../../dialects';
import type { SQLDialect } from '../../dialects/types';

/**
 * Column metadata extracted from a table
 */
export interface ColumnMetadata {
  name: string;
  type: string; // SQL type string (e.g., "VARCHAR(255)", "TEXT", "INTEGER")
  columnType?: string; // Raw Drizzle column type (e.g., "PgVarchar", "PgText")
  length?: number;
  precision?: number;
  scale?: number;
  enumValues?: readonly string[];
  nullable: boolean;
  hasDefault: boolean; // Only true for database-level defaults (SQL expressions, literals)
  defaultValue?: any; // Structured object for SQL expressions, or primitive value for literals (null/undefined if application-level function)
}

/**
 * Table metadata extracted from a schema
 */
import type { ForeignKeyAction } from '../dialects/types';

export interface TableMetadata {
  name: string;
  columns: Record<string, ColumnMetadata>;
  primaryKeys: string[];
  foreignKeys: Array<{
    localColumns: string[];
    refTable: string;
    refColumns: string[];
    onDelete?: ForeignKeyAction;
    onUpdate?: ForeignKeyAction;
  }>;
  uniqueConstraints: Array<{
    name?: string;
    columns: string[];
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
  }>;
}

/**
 * Schema differences detected between two schemas
 */
export interface SchemaDiff {
  addedTables: string[];
  removedTables: string[];
  modifiedTables: Array<{
    tableName: string;
    addedColumns: string[];
    removedColumns: string[];
    modifiedColumns: Array<{
      columnName: string;
      changes: string[];
    }>;
    addedForeignKeys: Array<{
      localColumns: string[];
      refTable: string;
      refColumns: string[];
    }>;
    removedForeignKeys: Array<{
      localColumns: string[];
      refTable: string;
      refColumns: string[];
    }>;
    addedUniqueConstraints: Array<{
      name?: string;
      columns: string[];
    }>;
    removedUniqueConstraints: Array<{
      name?: string;
      columns: string[];
    }>;
    addedIndexes: Array<{
      name: string;
      columns: string[];
      unique: boolean;
    }>;
    removedIndexes: Array<{
      name: string;
      columns: string[];
      unique: boolean;
    }>;
  }>;
}

/**
 * Extract column metadata from a table config
 * This should match the logic used in dialect-sql-generator.ts to get the full type string
 */
function extractColumnMetadata(column: any, dialect?: 'sqlite' | 'pg'): ColumnMetadata {
  // Get the full type string including all options (like varchar length)
  // Use the same logic as the SQL generators
  const columnType = column.columnType || '';
  const dataType = column.dataType || '';
  const length = column.length;
  const precision = column.precision;
  const scale = column.scale;
  const enumValues = column.enumValues;
  
  let typeString = 'unknown';
  
  // Use dialect-specific logic if available, otherwise try to infer
  if (dialect === 'pg') {
    // PostgreSQL type mapping (matches PostgreSQLSQLGenerator)
    if (columnType === 'PgText') {
      typeString = length ? `VARCHAR(${length})` : 'TEXT';
    } else if (columnType === 'PgVarchar') {
      typeString = length ? `VARCHAR(${length})` : 'VARCHAR';
    } else if (columnType === 'PgTimestamp') {
      typeString = 'TIMESTAMP';
    } else if (columnType === 'PgInteger' || columnType === 'PgBigint' || columnType === 'PgSmallint') {
      typeString = columnType === 'PgBigint' ? 'BIGINT' : columnType === 'PgSmallint' ? 'SMALLINT' : 'INTEGER';
    } else if (columnType === 'PgBoolean') {
      typeString = 'BOOLEAN';
    } else if (columnType === 'PgNumeric' || columnType === 'PgDecimal') {
      if (precision !== undefined && scale !== undefined) {
        typeString = `NUMERIC(${precision},${scale})`;
      } else if (precision !== undefined) {
        typeString = `NUMERIC(${precision})`;
      } else {
        typeString = 'NUMERIC';
      }
    } else if (columnType === 'PgJson' || columnType === 'PgJsonb') {
      typeString = columnType === 'PgJsonb' ? 'JSONB' : 'JSON';
    } else if (columnType === 'PgBytea') {
      typeString = 'BYTEA';
    } else if (columnType === 'PgDate') {
      typeString = 'DATE';
    } else if (columnType === 'PgTime') {
      typeString = 'TIME';
    } else {
      // Fallback
      if (dataType === 'string') {
        typeString = length ? `VARCHAR(${length})` : 'TEXT';
      } else if (dataType === 'number') {
        typeString = 'INTEGER';
      } else {
        typeString = dataType ? dataType.toUpperCase() : 'TEXT';
      }
    }
  } else {
    // SQLite type mapping (matches SQLiteSQLGenerator)
    if (columnType === 'SQLiteText') {
      typeString = 'TEXT';
    } else if (columnType === 'SQLiteInteger') {
      typeString = 'INTEGER';
    } else if (columnType === 'SQLiteReal') {
      typeString = 'REAL';
    } else if (columnType === 'SQLiteBlob') {
      typeString = 'BLOB';
    } else {
      // Fallback
      if (dataType === 'string') {
        typeString = 'TEXT';
      } else if (dataType === 'number') {
        typeString = 'INTEGER';
      } else {
        typeString = dataType ? dataType.toUpperCase() : 'TEXT';
      }
    }
  }
  
  // Note: Enum values are NOT included in the type string
  // They are handled separately via CHECK constraints in the SQL generation phase
  // The type string should remain as the base type (e.g., VARCHAR(50), TEXT, etc.)
  
  // Extract default value for snapshot storage
  // Only store SQL expressions and literal values - skip application-level functions
  let defaultValue: any = undefined;
  let hasDatabaseDefault = false;
  
  if (column.default !== undefined && column.default !== null) {
    // Check if it's a SQL expression (has queryChunks) - these are database-level defaults
    const isSQLExpression = (val: any): boolean => {
      if (val && typeof val === 'object' && val.queryChunks) {
        return true;
      }
      if (typeof val === 'function' && (val as any).queryChunks) {
        return true;
      }
      return false;
    };
    
    if (isSQLExpression(column.default)) {
      // It's a SQL expression - store the structured object
      try {
        const queryChunks = (column.default as any).queryChunks || ((column.default as any).queryChunks);
        defaultValue = {
          type: 'sql',
          queryChunks: queryChunks,
        };
        hasDatabaseDefault = true;
      } catch (e2) {
        // If extraction fails, don't store it
        defaultValue = undefined;
        hasDatabaseDefault = false;
      }
    } else if (typeof column.default === 'function') {
      // Application-level function (e.g., generateUUID) - don't store in snapshot
      // These are handled in application code, not database
      defaultValue = undefined;
      hasDatabaseDefault = false;
    } else {
      // Primitive value (string, number, boolean, etc.) - store directly
      defaultValue = column.default;
      hasDatabaseDefault = true;
    }
  }
  
  return {
    name: column.name || '',
    type: typeString,
    columnType: column.columnType || column.dataType || undefined,
    length: length,
    precision: precision,
    scale: scale,
    enumValues: enumValues,
    nullable: column.notNull !== true,
    hasDefault: hasDatabaseDefault, // Only true for database-level defaults
    defaultValue: defaultValue, // Structured object for SQL expressions, or primitive value (undefined for application-level functions)
  };
}

/**
 * Extract table metadata from a bound table using Drizzle's getTableConfig
 * Optionally accepts an unbound table to extract dialect-agnostic metadata first
 */
export function extractTableMetadata(
  table: Table,
  dialect: 'sqlite' | 'pg' | SQLDialect,
  unboundTable?: UTable<any>,
  allUnboundTables?: Record<string, UTable<any>>
): TableMetadata | Promise<TableMetadata> {
  // Normalize dialect to always be a SQLDialect object
  // If it's a string, resolve it to a dialect object (async)
  const normalizeDialect = (): Promise<SQLDialect> => {
    if (typeof dialect === 'string') {
      return getDialectFromName(dialect);
    }
    return Promise.resolve(dialect);
  };

  // If we have an unbound table, extract metadata from it first (dialect-agnostic)
  // Then merge with bound table's dialect-specific type information
  if (unboundTable) {
    const unboundMeta = extractTableMetadataFromUnbound(unboundTable, allUnboundTables);
    return normalizeDialect().then(dialectObj => 
      mergeUnboundWithBoundMetadata(unboundMeta, table, dialectObj)
    );
  }
  
  // Extract from bound table only
  // Validate table before processing
  if (!table || typeof table !== 'object') {
    throw new Error(`Invalid table: expected object, got ${typeof table}`);
  }

  // Normalize dialect and extract metadata
  return normalizeDialect().then(dialectObj => {
    // Validate dialect has getTableConfig
    if (!dialectObj.getTableConfig || typeof dialectObj.getTableConfig !== 'function') {
      throw new Error(
        `Dialect "${dialectObj.dialectName}" does not have a valid getTableConfig method`
      );
    }

    let config: any;
    try {
      config = dialectObj.getTableConfig(table);
    } catch (error: any) {
      const tableName = getTableName(table);
      throw new Error(
        `Failed to get table config for table "${tableName}": ${error.message}. ` +
        `Table type: ${typeof table}, has columns: ${!!(table as any).columns}, ` +
        `table keys: ${Object.keys(table || {}).join(', ')}`
      );
    }

    // Validate config
    if (!config || typeof config !== 'object') {
      const tableName = getTableName(table);
      throw new Error(
        `getTableConfig returned invalid config for table "${tableName}": expected object, got ${typeof config}`
      );
    }

    const tableName = config.name || getTableName(table);
    
    // Continue with metadata extraction...
    return extractMetadataFromConfig(config, tableName, dialectObj, table);
  });
}

/**
 * Extract metadata from a table config (internal helper)
 */
function extractMetadataFromConfig(
  config: any,
  tableName: string,
  dialect: SQLDialect,
  table: Table
): TableMetadata {

  
  // Extract columns
  const columns: Record<string, ColumnMetadata> = {};
  
  // Validate config.columns exists
  if (!config.columns || typeof config.columns !== 'object') {
    throw new Error(
      `Table "${tableName}" has invalid columns config: expected object, got ${typeof config.columns}. ` +
      `Config keys: ${Object.keys(config || {}).join(', ')}`
    );
  }

  const columnKeys = Array.isArray(config.columns)
    ? Object.keys(config.columns).map(k => parseInt(k)).sort((a, b) => a - b).map(k => k.toString())
    : Object.keys(config.columns);
  
  for (const key of columnKeys) {
    const column = config.columns[key];
    if (column) {
      try {
        const metadata = extractColumnMetadata(column, dialect.dialectName as 'sqlite' | 'pg');
        if (metadata.name) {
          columns[metadata.name] = metadata;
        } else {
          console.warn(`⚠️  Column at key ${key} has no name, skipping`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to extract metadata for column at key ${key}:`, error);
      }
    }
  }
  
  // Extract primary keys from config.primaryKeys
  const primaryKeysSet = new Set<string>();
  if (config.primaryKeys && Array.isArray(config.primaryKeys)) {
    for (const pk of config.primaryKeys) {
      const colName = pk?.name || pk?.column?.name || (typeof pk === 'string' ? pk : '');
      if (colName) {
        primaryKeysSet.add(colName);
      }
    }
  }
  // Also check for inline primary keys (column.primary === true)
  for (const key of columnKeys) {
    const column = config.columns[key];
    if (column && column.primary === true && column.name) {
      primaryKeysSet.add(column.name);
    }
  }
  const primaryKeys = Array.from(primaryKeysSet).sort();
  
  // Extract foreign keys - check columns first for inline FKs, then config.foreignKeys
  const foreignKeys: Array<{ localColumns: string[]; refTable: string; refColumns: string[] }> = [];
  
  // First, check columns directly for inline foreign keys (defined with .references())
  // These might not be in config.foreignKeys
  // NOTE: config.columns contains bound Drizzle columns, NOT UColumn instances
  // UColumn instances are always bound via bindColumn() before getTableConfig() is called
  for (const key of columnKeys) {
    const column = config.columns[key];
    if (!column || !column.name) continue;
    
    // Validate this is a bound Drizzle column, not a UColumn
    // UColumn has getData() method, bound columns don't
    if ((column as any).getData && typeof (column as any).getData === 'function') {
      throw new Error(
        `Column "${column.name}" in table "${tableName}" is a UColumn (unbound), but extractMetadataFromConfig expects bound Drizzle columns. ` +
        `This indicates getTableConfig() returned unbound columns, which should never happen. ` +
        `Tables must be bound via bindTable() before getTableConfig() is called. ` +
        `This is a bug in the table binding process.`
      );
    }
    
    // Check if column has a reference (inline foreign key)
    // Drizzle stores inline FKs as column.references (function) on bound columns
    if (column.references && typeof column.references === 'function') {
      const refFn = column.references;
      try {
        // Call the reference function to get the referenced column
        const refCol = refFn();
        if (refCol) {
          let refTable = '';
          let refColumn = '';
          
          // The referenced column should have a .table property (Drizzle standard)
          const refColTable = (refCol as any).table;
          
          if (!refColTable) {
            throw new Error(
              `Column "${column.name}" in table "${tableName}" has a reference function, but the referenced column does not have a .table property. ` +
              `This indicates the reference function returned an invalid column. ` +
              `Referenced column type: ${typeof refCol}, keys: ${Object.keys(refCol || {}).join(', ')}. ` +
              `This is a bug - Drizzle columns must have a .table property.`
            );
          }
          
          // Get table name using Drizzle's getTableName utility
          refTable = getTableName(refColTable);
          
          // Get the referenced column name - Drizzle columns have .name property
          refColumn = (refCol as any).name;
          
          if (!refColumn) {
            throw new Error(
              `Column "${column.name}" in table "${tableName}" has a reference function, but the referenced column does not have a .name property. ` +
              `This indicates the reference function returned an invalid column. ` +
              `Referenced column type: ${typeof refCol}, keys: ${Object.keys(refCol || {}).join(', ')}. ` +
              `This is a bug - Drizzle columns must have a .name property.`
            );
          }
          
          console.log(`     Column "${column.name}" references: ${refTable}.${refColumn}`);
          
          // If we have both table and column, add the foreign key
          if (refTable && refColumn) {
            foreignKeys.push({
              localColumns: [column.name],
              refTable,
              refColumns: [refColumn],
            });
            console.log(`   ✅ Added FK from column "${column.name}" -> ${refTable}.${refColumn}`);
          } else {
            console.log(`     ⚠️  Missing refTable or refColumn: refTable="${refTable}", refColumn="${refColumn}"`);
          }
        }
      } catch (e) {
        // Skip if we can't resolve - might happen with unbound tables or circular refs
        console.warn(`     ⚠️  Could not extract foreign key from column ${column.name}:`, e);
      }
    }
  }
  
  // Then, check config.foreignKeys for explicit foreign key constraints
  // Note: Inline FKs (defined with .references()) appear in both config.columns (as column.references)
  // and config.foreignKeys. We've already extracted them from columns above, so we should skip
  // duplicates here.
  if (config.foreignKeys && Array.isArray(config.foreignKeys)) {
    for (const fk of config.foreignKeys) {
      let localColumns: string[] = [];
      let refTable = '';
      let refColumns: string[] = [];
      
      // Get local columns - for inline FKs, fk.columns might be empty
      if (fk.columns && Array.isArray(fk.columns) && fk.columns.length > 0) {
        localColumns = fk.columns.map((col: any) => col?.name || (typeof col === 'string' ? col : '')).filter((n: string) => n);
      }
      
      // Check if this FK is already extracted from inline column references
      // If fk.columns is empty and we have a reference function, it's likely an inline FK
      const isInlineFK = localColumns.length === 0 && fk.reference && typeof fk.reference === 'function';
      if (isInlineFK) {
        // Try to match this FK to an already-extracted inline FK by comparing reference functions
        const alreadyExtracted = foreignKeys.some(existingFK => {
          // Check if any column in this table has the same reference function
          for (const key of columnKeys) {
            const column = config.columns[key];
            if (column && column.references === fk.reference) {
              return true;
            }
          }
          return false;
        });
        
        if (alreadyExtracted) {
          console.log(`     Skipping FK in config.foreignKeys (already extracted from inline column reference)`);
          continue;
        }
      }
      
      // Get reference table and columns
      // Drizzle stores foreign keys in config.foreignKeys with:
      // - fk.columns: array of local columns (empty for inline FKs)
      // - fk.reference: function that returns the referenced column/table
      // - fk.foreignColumns: array of referenced columns (for explicit FKs)
      if (!fk.reference || typeof fk.reference !== 'function') {
        throw new Error(
          `Foreign key in table "${tableName}" has invalid reference: expected function, got ${typeof fk.reference}. ` +
          `FK structure: columns=${fk.columns?.length || 0}, foreignColumns=${fk.foreignColumns?.length || 0}`
        );
      }
      
      // Call fk.reference() to get the referenced column or table
      // fk.reference should be a function that returns a column (for inline FKs)
      // or a table (for explicit FKs)
      if (typeof fk.reference !== 'function') {
        throw new Error(
          `Foreign key in table "${tableName}" has invalid reference: expected function, got ${typeof fk.reference}. ` +
          `fk.reference type: ${typeof fk.reference}, ` +
          `fk.reference value: ${JSON.stringify(fk.reference, (key, value) => {
            if (typeof value === 'function') return '[Function]';
            if (key === 'table' || key === '_' || key === '__table') return '[Table]';
            return value;
          }, 2).substring(0, 500)}. ` +
          `This indicates the FK was not properly created - fk.reference must be a function.`
        );
      }
      
      let refResult: any = fk.reference();
      
      if (!refResult || typeof refResult !== 'object') {
        throw new Error(
          `fk.reference() returned invalid result for foreign key in table "${tableName}": ` +
          `expected object (column or table), got ${typeof refResult}. ` +
          `This indicates the FK reference is not properly configured.`
        );
      }
      
      // Check if refResult is a foreign key object (this should NEVER happen for inline FKs)
      // If it is, it means Drizzle created an explicit FK instead of an inline FK
      // This happens when refFn() returns something Drizzle doesn't recognize as a column
      if ((refResult as any).foreignTable || (refResult as any).foreignColumns) {
        // This is an explicit FK object - extract info from it
        const fkObj = refResult as any;
        if (fkObj.foreignTable && fkObj.foreignColumns && Array.isArray(fkObj.foreignColumns) && fkObj.foreignColumns.length > 0) {
          // Get the referenced table name
          try {
            refTable = getTableName(fkObj.foreignTable);
          } catch (e: any) {
            throw new Error(
              `fk.reference() returned a foreign key object but could not get table name from foreignTable. ` +
              `This indicates the FK binding created an explicit FK instead of an inline FK. ` +
              `Error: ${e.message}. ` +
              `This is a bug - refFn should return a ColumnBuilder with .table property, not cause Drizzle to create an explicit FK.`
            );
          }
          // Get the referenced column names
          refColumns = fkObj.foreignColumns.map((col: any) => {
            if (typeof col === 'string') return col;
            if (col && typeof col === 'object' && col.name) return col.name;
            if (col && typeof col === 'object' && col.config?.name) return col.config.name;
            throw new Error(
              `Invalid column in fk.foreignColumns: expected string or object with .name, got ${typeof col}. ` +
              `Column value: ${JSON.stringify(col)}`
            );
          }).filter((n: string) => n.length > 0);
          
          // Get local columns from fk.columns
          if (fkObj.columns && Array.isArray(fkObj.columns) && fkObj.columns.length > 0) {
            localColumns = fkObj.columns.map((col: any) => {
              if (typeof col === 'string') return col;
              if (col && typeof col === 'object' && col.name) return col.name;
              if (col && typeof col === 'object' && col.config?.name) return col.config.name;
              return '';
            }).filter((n: string) => n.length > 0);
          }
          
          // If we still don't have local columns, try to find them by matching the FK
          if (localColumns.length === 0) {
            // This is an explicit FK - we need to find which columns in this table match
            // We can't reliably match explicit FKs to columns, so we'll skip it
            // But we should log a warning
            console.warn(
              `FK in table "${tableName}" is an explicit FK (not inline) and could not be matched to columns. ` +
              `This indicates refFn() returned something Drizzle didn't recognize as a column, ` +
              `causing Drizzle to create an explicit FK instead of an inline FK. ` +
              `This is a bug - refFn should return a ColumnBuilder with .table property.`
            );
            continue; // Skip this FK - we can't extract it properly
          }
          
          // Add the FK
          const isDuplicate = foreignKeys.some(existing =>
            existing.localColumns.length === localColumns.length &&
            existing.localColumns.every((col, i) => col === localColumns[i]) &&
            existing.refTable === refTable &&
            existing.refColumns.length === refColumns.length &&
            existing.refColumns.every((col, i) => col === refColumns[i])
          );
          if (!isDuplicate) {
            foreignKeys.push({ localColumns, refTable, refColumns });
          }
          continue; // Skip the rest of the processing for this FK
        } else {
          throw new Error(
            `fk.reference() returned a foreign key object but it's malformed. ` +
            `Expected foreignTable and foreignColumns, got: ` +
            `foreignTable: ${!!fkObj.foreignTable}, foreignColumns: ${Array.isArray(fkObj.foreignColumns) ? fkObj.foreignColumns.length : 'not array'}. ` +
            `This is a bug - the FK object is incomplete.`
          );
        }
      }
      
      // Drizzle columns have a .table property that points to their parent table
      // If refResult has .table, it's a column reference (inline FK)
      // If refResult doesn't have .table but has table-like properties, it's a table reference (explicit FK)
      const refColTable = (refResult as any).table;
      
      if (refColTable) {
            // It's a column - extract table and column name
              refTable = getTableName(refColTable);
              console.log(`     Extracted refTable from getTableName: ${refTable}`);

            
            // Get the referenced column name
            refColumns = [(refResult as any).name || (refResult as any).data?.name || (refResult as any).__name || ''];
            
            console.log(`     FK reference resolves to: ${refTable}.${refColumns[0]}`);
            
            // If we don't have local columns yet, this is an inline FK
            // Find which column in this table has this reference
            if (localColumns.length === 0) {
              console.log(`     Looking for column with this reference in ${columnKeys.length} columns...`);
              // First, try to match by comparing the reference function directly
              // This is the most reliable way for inline FKs
              for (const key of columnKeys) {
                const column = config.columns[key];
                if (!column || !column.name) continue;
                
                // Check if column.references is the same function as fk.reference
                if (column.references && typeof column.references === 'function' && column.references === fk.reference) {
                  localColumns = [column.name];
                  console.log(`   ✅ Matched FK to column "${column.name}" by function reference`);
                  break;
                }
              }
              
              // If that didn't work, try to match by calling the reference functions and comparing results
              if (localColumns.length === 0) {
                console.log(`   🔍 Trying to match FK by comparing reference results...`);
                for (const key of columnKeys) {
                  const column = config.columns[key];
                  if (!column || !column.name) continue;
                  
                  // Check if this column has a reference function that matches
                  // Drizzle stores inline FKs as column.references (function)
                  if (column.references && typeof column.references === 'function') {
                    const colRefFn = column.references;
                    const colRef = colRefFn();
                    if (!colRef) continue;
                    
                    // Compare the referenced column/table to see if it matches
                    // Drizzle columns have .table and .name properties
                    const colRefTable = (colRef as any).table;
                    const colRefName = (colRef as any).name;
                    
                    if (colRefTable && colRefName && refColTable) {
                      const colRefTableName = getTableName(colRefTable);
                      
                      console.log(`     Checking column "${column.name}": refTable="${colRefTableName}", refCol="${colRefName}" vs expected "${refTable}"."${refColumns[0]}"`);
                      
                      if (colRefTableName === refTable && colRefName === refColumns[0]) {
                        localColumns = [column.name];
                        console.log(`   ✅ Matched FK to column "${column.name}" by reference result`);
                        break;
                      }
                    }
                  }
                }
              }
              
              // If still no match, log a warning
              if (localColumns.length === 0) {
                console.warn(`   ⚠️  Could not find column for inline FK: refTable="${refTable}", refCol="${refColumns[0]}"`);
              }
            }
          } else {
            // refResult doesn't have a .table property
            // This means it's either:
            // 1. A table object (for explicit FKs defined with foreignKey())
            // 2. A malformed column that should have .table but doesn't (BUG)
            
            // For explicit FKs, Drizzle stores fk.foreignColumns with the referenced columns
            if (!fk.foreignColumns || !Array.isArray(fk.foreignColumns) || fk.foreignColumns.length === 0) {
              throw new Error(
                `Foreign key in table "${tableName}" is malformed: ` +
                `fk.reference() returned an object without .table property (not a column), ` +
                `but fk.foreignColumns is missing or empty. ` +
                `This indicates the FK is neither a valid inline FK (column with .table) nor a valid explicit FK (table with foreignColumns). ` +
                `RefResult type: ${typeof refResult}, keys: ${refResult ? Object.keys(refResult).join(', ') : 'null'}, ` +
                `RefResult constructor: ${refResult?.constructor?.name || 'unknown'}. ` +
                `This is a bug in FK binding - the referenced column should have a .table property, ` +
                `or if it's an explicit FK, fk.foreignColumns should be populated.`
              );
            }
            
            // This is an explicit FK - fk.reference() should return the table
            refTable = getTableName(refResult);
            
            if (!refTable) {
              throw new Error(
                `fk.reference() returned a table object but getTableName() returned undefined for foreign key in table "${tableName}". ` +
                `This is a bug in Drizzle's table structure.`
              );
            }
            
            // Use fk.foreignColumns as the authoritative source for explicit FKs
            refColumns = fk.foreignColumns.map((col: any) => {
              if (typeof col === 'string') {
                return col;
              }
              if (col && typeof col === 'object' && col.name) {
                return col.name;
              }
              throw new Error(
                `Invalid column in fk.foreignColumns for foreign key in table "${tableName}": ` +
                `expected string or object with .name, got ${typeof col}. ` +
                `Column value: ${JSON.stringify(col)}`
              );
            }).filter((n: string) => n.length > 0);
            
            if (refColumns.length === 0) {
              throw new Error(
                `fk.foreignColumns is empty or contains no valid column names for foreign key in table "${tableName}". ` +
                `This FK cannot be properly extracted.`
              );
            }
          }
      
      // Add the foreign key if we have all required information
      // Check if this FK is already added (from inline reference check above)
      if (localColumns.length > 0 && refTable && refColumns.length > 0) {
        const isDuplicate = foreignKeys.some(existing => 
          existing.localColumns.length === localColumns.length &&
          existing.localColumns.every((col, i) => col === localColumns[i]) &&
          existing.refTable === refTable &&
          existing.refColumns.length === refColumns.length &&
          existing.refColumns.every((col, i) => col === refColumns[i])
        );
        
        if (!isDuplicate) {
          foreignKeys.push({ localColumns, refTable, refColumns });
        }
      }
    }
  }
  
  // Extract unique constraints - check both config.uniqueConstraints and column.isUnique
  const uniqueConstraintsMap = new Map<string, { name?: string; columns: string[] }>();
  
  // First, check column.isUnique (inline unique constraints)
  for (const key of columnKeys) {
    const column = config.columns[key];
    if (column && column.isUnique === true && column.name) {
      const colName = column.name;
      uniqueConstraintsMap.set(colName, {
        name: undefined,
        columns: [colName],
      });
    }
  }
  
  // Then, check config.uniqueConstraints (composite unique constraints)
  if (config.uniqueConstraints && Array.isArray(config.uniqueConstraints)) {
    for (const unique of config.uniqueConstraints) {
      if (unique?.columns && Array.isArray(unique.columns)) {
        const uniqueColumns = unique.columns.map((col: any) => col?.name || (typeof col === 'string' ? col : '')).filter((n: string) => n);
        if (uniqueColumns.length > 0) {
          // Validate constraint name if provided
          if (unique.name) {
            if (!/^[A-Za-z0-9_$]+$/.test(unique.name)) {
              const invalidChars = unique.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
              const uniqueInvalidChars = [...new Set(invalidChars)];
              throw new Error(
                `Invalid unique constraint name "${unique.name}" in table "${tableName}": ` +
                `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
                `Constraint names must only contain alphanumeric characters, underscores, and dollar signs. ` +
                `This constraint was defined in the schema with an invalid name. ` +
                `The constraint name must be fixed in the schema definition.`
              );
            }
          }
          
          const key = uniqueColumns.sort().join(',');
          // For single-column unique, check if already added as inline
          if (uniqueColumns.length === 1) {
            // If not already in map, add it (might have name from config)
            if (!uniqueConstraintsMap.has(uniqueColumns[0])) {
              uniqueConstraintsMap.set(key, {
                name: unique.name,
                columns: uniqueColumns,
              });
            } else {
              // Update existing to include name if provided
              const existing = uniqueConstraintsMap.get(uniqueColumns[0]);
              if (existing && unique.name && !existing.name) {
                existing.name = unique.name;
              }
            }
          } else {
            // Multi-column unique - always add
            uniqueConstraintsMap.set(key, {
              name: unique.name,
              columns: uniqueColumns,
            });
          }
        }
      }
    }
  }
  const uniqueConstraints = Array.from(uniqueConstraintsMap.values());
  
  // Extract indexes
  const indexes: Array<{ name: string; columns: string[]; unique: boolean }> = [];
  const tableAny = table as any;
  let indexList: any[] = [];
  
  if (config.indexes && Array.isArray(config.indexes)) {
    indexList = config.indexes;
  } else {
    // Try to get from table object
    if (tableAny[Symbol.for('drizzle:Indexes')]) {
      indexList = tableAny[Symbol.for('drizzle:Indexes')];
    } else if (tableAny._?.indexes) {
      indexList = tableAny._?.indexes;
    }
  }
  
  for (const idx of indexList) {
    if (!idx) continue;
    const indexName = idx.config?.name || idx.name || idx._?.name || '';
    if (!indexName) continue;
    
    // Validate index name
    if (!/^[A-Za-z0-9_$]+$/.test(indexName)) {
      const invalidChars = indexName.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
      const uniqueInvalidChars = [...new Set(invalidChars)];
      throw new Error(
        `Invalid index name "${indexName}" in table "${tableName}": ` +
        `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
        `Index names must only contain alphanumeric characters, underscores, and dollar signs. ` +
        `This index was defined in the schema with an invalid name. ` +
        `The index name must be fixed in the schema definition.`
      );
    }
    
    const indexColumns: string[] = [];
    const idxColumns = idx.config?.columns || idx.columns;
    if (idxColumns && Array.isArray(idxColumns)) {
      indexColumns.push(...idxColumns.map((col: any) => col?.name || (typeof col === 'string' ? col : '')).filter((n: string) => n));
    }
    
    if (indexColumns.length > 0) {
      const isUnique = idx.config?.unique || idx.unique || idx._?.unique || false;
      indexes.push({
        name: indexName,
        columns: indexColumns,
        unique: isUnique,
      });
    }
  }
  
  return {
    name: tableName,
    columns,
    primaryKeys,
    foreignKeys,
    uniqueConstraints,
    indexes,
  };
}

/**
 * Compare two table metadata objects and return differences
 */
export function compareTables(
  oldTable: TableMetadata,
  newTable: TableMetadata
): SchemaDiff['modifiedTables'][0] | null {
  // Validate inputs
  if (!oldTable || typeof oldTable !== 'object') {
    throw new Error(
      `Cannot compare tables: oldTable is invalid. ` +
      `Expected TableMetadata object, got ${typeof oldTable}`
    );
  }
  
  if (!newTable || typeof newTable !== 'object') {
    throw new Error(
      `Cannot compare tables: newTable is invalid. ` +
      `Expected TableMetadata object, got ${typeof newTable}`
    );
  }
  
  // Ensure both tables have valid columns objects
  const oldColumns = oldTable.columns && typeof oldTable.columns === 'object' 
    ? oldTable.columns 
    : {};
  const newColumns = newTable.columns && typeof newTable.columns === 'object'
    ? newTable.columns
    : {};
  
  // If either table has no columns, treat as empty
  if (Object.keys(oldColumns).length === 0 && Object.keys(newColumns).length === 0) {
    // Both tables are empty - no changes
    return null;
  }
  
  if (Object.keys(oldColumns).length === 0 || Object.keys(newColumns).length === 0) {
    // One table is empty - this is a significant change, but we can't compare columns
    // Return a diff indicating all columns are added/removed
    const changes: SchemaDiff['modifiedTables'][0] = {
      tableName: newTable.name || oldTable.name || 'unknown',
      addedColumns: Object.keys(newColumns),
      removedColumns: Object.keys(oldColumns),
      modifiedColumns: [],
      addedForeignKeys: [],
      removedForeignKeys: [],
      addedUniqueConstraints: [],
      removedUniqueConstraints: [],
      addedIndexes: [],
      removedIndexes: [],
    };
    return changes;
  }
  
  const changes: SchemaDiff['modifiedTables'][0] = {
    tableName: newTable.name,
    addedColumns: [],
    removedColumns: [],
    modifiedColumns: [],
    addedForeignKeys: [],
    removedForeignKeys: [],
    addedUniqueConstraints: [],
    removedUniqueConstraints: [],
    addedIndexes: [],
    removedIndexes: [],
  };
  
  // Compare columns (using the validated columns objects)
  const oldColumnNames = new Set(Object.keys(oldColumns));
  const newColumnNames = new Set(Object.keys(newColumns));
  
  // Added columns
  for (const colName of newColumnNames) {
    if (!oldColumnNames.has(colName)) {
      changes.addedColumns.push(colName);
    }
  }
  
  // Removed columns
  for (const colName of oldColumnNames) {
    if (!newColumnNames.has(colName)) {
      changes.removedColumns.push(colName);
    }
  }
  
      // Modified columns - compare ALL properties
      for (const colName of oldColumnNames) {
        if (newColumnNames.has(colName)) {
          const oldCol = oldTable.columns[colName];
          const newCol = newTable.columns[colName];
          const columnChanges: string[] = [];
          
          // Normalize column properties for comparison
          // Handle backward compatibility: old snapshots might only have type string
          function normalizeColumnType(col: ColumnMetadata): { baseType: string; length?: number; precision?: number; scale?: number; enumValues?: readonly string[] } {
            // If we have the underlying properties, use them
            if (col.columnType !== undefined || col.length !== undefined || col.precision !== undefined) {
              return {
                baseType: col.columnType || col.type?.split('(')[0] || '',
                length: col.length,
                precision: col.precision,
                scale: col.scale,
                enumValues: col.enumValues,
              };
            }
            
            // Otherwise, try to parse from type string (backward compatibility)
            const typeStr = col.type || '';
            const baseType = typeStr.split('(')[0];
            const match = typeStr.match(/\(([^)]+)\)/);
            
            let length: number | undefined;
            let precision: number | undefined;
            let scale: number | undefined;
            let enumValues: readonly string[] | undefined;
            
            if (match) {
              const params = match[1];
              // Check if it's enum values (strings in quotes)
              if (params.includes("'")) {
                enumValues = params.split(',').map(s => s.trim().replace(/^'|'$/g, '')) as readonly string[];
              } else {
                // Check if it's precision,scale
                const parts = params.split(',');
                if (parts.length === 2) {
                  precision = parseInt(parts[0].trim());
                  scale = parseInt(parts[1].trim());
                } else {
                  // Single number - could be length or precision
                  const num = parseInt(params.trim());
                  if (!isNaN(num)) {
                    if (baseType.toUpperCase().includes('VARCHAR') || baseType.toUpperCase().includes('CHAR')) {
                      length = num;
                    } else {
                      precision = num;
                    }
                  }
                }
              }
            }
            
            return { baseType, length, precision, scale, enumValues };
          }
          
          const oldNorm = normalizeColumnType(oldCol);
          const newNorm = normalizeColumnType(newCol);
          
          // Normalize base types for comparison (remove Pg/SQLite prefixes)
          const normalizeBaseType = (type: string): string => {
            return type.replace(/^Pg/i, '').replace(/^SQLite/i, '').toUpperCase();
          };
          
          const oldBaseType = normalizeBaseType(oldNorm.baseType);
          const newBaseType = normalizeBaseType(newNorm.baseType);
          
          // Compare base column type - only report if it's a REAL type change
          // PgVarchar -> VARCHAR is just a format difference, not a real change
          if (oldBaseType !== newBaseType) {
            // Map common type aliases
            const typeMap: Record<string, string> = {
              'VARCHAR': 'TEXT',
              'TEXT': 'TEXT',
              'CHAR': 'TEXT',
              'INTEGER': 'INTEGER',
              'INT': 'INTEGER',
              'BIGINT': 'BIGINT',
              'SMALLINT': 'SMALLINT',
              'REAL': 'REAL',
              'DOUBLE': 'REAL',
              'NUMERIC': 'NUMERIC',
              'DECIMAL': 'NUMERIC',
              'BOOLEAN': 'BOOLEAN',
              'BOOL': 'BOOLEAN',
              'TIMESTAMP': 'TIMESTAMP',
              'DATE': 'DATE',
              'TIME': 'TIME',
              'JSON': 'JSON',
              'JSONB': 'JSON',
              'BLOB': 'BLOB',
              'BYTEA': 'BLOB',
            };
            
            const oldMapped = typeMap[oldBaseType] || oldBaseType;
            const newMapped = typeMap[newBaseType] || newBaseType;
            
            if (oldMapped !== newMapped) {
              columnChanges.push(`type: ${oldNorm.baseType} -> ${newNorm.baseType}`);
            }
            // Otherwise, it's just a format difference (e.g., PgVarchar vs VARCHAR), ignore it
          }
          
          // Compare length
          // Only compare if we have length info from both sides
          // Old snapshots might not have length, so we can't compare
          if (oldNorm.length !== undefined && newNorm.length !== undefined) {
            if (oldNorm.length !== newNorm.length) {
              columnChanges.push(`length: ${oldNorm.length} -> ${newNorm.length}`);
            }
          } else if (oldNorm.length === undefined && newNorm.length !== undefined) {
            // Old snapshot doesn't have length info - can't determine if it changed
            // This is a limitation of old snapshot format
            // For now, we'll assume no change unless we can detect it from the type string
            // If the new one has a specific length, and old type was just "PgVarchar" without length,
            // we can't tell if it changed, so we'll skip this comparison
          } else if (oldNorm.length !== undefined && newNorm.length === undefined) {
            // New column lost length constraint
            columnChanges.push(`length: ${oldNorm.length} -> undefined`);
          }
          
          // Compare precision
          if (oldNorm.precision !== newNorm.precision) {
            columnChanges.push(`precision: ${oldNorm.precision ?? 'undefined'} -> ${newNorm.precision ?? 'undefined'}`);
          }
          
          // Compare scale
          if (oldNorm.scale !== newNorm.scale) {
            columnChanges.push(`scale: ${oldNorm.scale ?? 'undefined'} -> ${newNorm.scale ?? 'undefined'}`);
          }
          
          // Compare enum values
          const oldEnum = oldNorm.enumValues;
          const newEnum = newNorm.enumValues;
          if (oldEnum && newEnum) {
            const oldEnumStr = JSON.stringify([...oldEnum].sort());
            const newEnumStr = JSON.stringify([...newEnum].sort());
            if (oldEnumStr !== newEnumStr) {
              columnChanges.push(`enumValues: ${oldEnumStr} -> ${newEnumStr}`);
            }
          } else if (oldEnum !== newEnum) {
            columnChanges.push(`enumValues: ${oldEnum ? JSON.stringify([...oldEnum]) : 'undefined'} -> ${newEnum ? JSON.stringify([...newEnum]) : 'undefined'}`);
          }
          
          // Compare nullable
          if (oldCol.nullable !== newCol.nullable) {
            columnChanges.push(`nullable: ${oldCol.nullable} -> ${newCol.nullable}`);
          }
          
          // Compare default value - handle functions specially
          if (oldCol.hasDefault !== newCol.hasDefault) {
            columnChanges.push(`hasDefault: ${oldCol.hasDefault} -> ${newCol.hasDefault}`);
            console.log(`[compareTables] Column "${colName}" in table "${oldTable.name}": hasDefault changed from ${oldCol.hasDefault} to ${newCol.hasDefault}`);
          }
          // Compare actual default values
          if (oldCol.hasDefault && newCol.hasDefault) {
            const oldDefault = oldCol.defaultValue;
            const newDefault = newCol.defaultValue;
            
            // Helper to normalize default values for comparison
            const normalizeDefault = (val: any): string => {
              if (val === undefined || val === null) return 'undefined';
              if (typeof val === 'function') return 'function';
              
              // Check if it's a SQL expression object
              if (val && typeof val === 'object' && val.type === 'sql' && val.queryChunks) {
                // Extract SQL string from queryChunks
                const sqlParts = val.queryChunks.map((chunk: any) => {
                  if (chunk.value) {
                    return Array.isArray(chunk.value) ? chunk.value.join(' ') : chunk.value;
                  }
                  return '';
                }).filter((s: string) => s).join(' ');
                return `sql:${sqlParts}`;
              }
              
              // For strings, check if it looks like a SQL expression (CURRENT_TIMESTAMP, etc.)
              if (typeof val === 'string') {
                const sqlKeywords = ['CURRENT_TIMESTAMP', 'CURRENT_TIME', 'CURRENT_DATE', 'NOW()', 'LOCALTIME', 'LOCALTIMESTAMP'];
                if (sqlKeywords.some(keyword => val.toUpperCase().includes(keyword))) {
                  return `sql:${val}`;
                }
              }
              
              // For other types, convert to string
              return String(val);
            };
            
            // Both are functions - consider them equivalent (can't reliably compare function code)
            // Functions are typically serialized differently, so we ignore function-to-function changes
            if (typeof oldDefault === 'function' && typeof newDefault === 'function') {
              // Functions are considered equivalent - don't report as change
              // The function code might be serialized differently but represent the same function
            } else {
              // Normalize both defaults and compare
              const oldDefaultNormalized = normalizeDefault(oldDefault);
              const newDefaultNormalized = normalizeDefault(newDefault);
              
              if (oldDefaultNormalized !== newDefaultNormalized) {
                // Only report as change if they're actually different after normalization
                // This handles cases where SQL expressions are stored differently (object vs string)
                console.log(`[compareTables] Column "${colName}" in table "${oldTable.name}": defaultValue mismatch`);
                console.log(`  Old (raw): ${JSON.stringify(oldDefault)}`);
                console.log(`  New (raw): ${JSON.stringify(newDefault)}`);
                console.log(`  Old (normalized): ${oldDefaultNormalized}`);
                console.log(`  New (normalized): ${newDefaultNormalized}`);
                columnChanges.push(`defaultValue: ${oldDefaultNormalized} -> ${newDefaultNormalized}`);
              }
            }
          }
          
          // Note: Primary key and unique constraint changes are detected at table level,
          // not column level, so we don't need to check them here
          
          // If any changes detected, add to modified columns
          if (columnChanges.length > 0) {
            changes.modifiedColumns.push({
              columnName: colName,
              changes: columnChanges,
            });
          }
        }
      }
  
  // Compare foreign keys (simple comparison by column names)
  const oldFKs = new Set(oldTable.foreignKeys.map(fk => JSON.stringify(fk)));
  const newFKs = new Set(newTable.foreignKeys.map(fk => JSON.stringify(fk)));
  
  for (const fk of newTable.foreignKeys) {
    if (!oldFKs.has(JSON.stringify(fk))) {
      changes.addedForeignKeys.push(fk);
    }
  }
  
  for (const fk of oldTable.foreignKeys) {
    if (!newFKs.has(JSON.stringify(fk))) {
      changes.removedForeignKeys.push(fk);
    }
  }
  
  // Compare unique constraints
  // Normalize by comparing only columns (sorted), ignoring names
  // This handles cases where one has a name (from database) and the other doesn't (from schema)
  const normalizeUniqueConstraint = (u: { name?: string; columns: string[] }): string => {
    // Sort columns for consistent comparison
    const sortedColumns = [...u.columns].sort().join(',');
    return sortedColumns;
  };
  
  const oldUniques = new Set(oldTable.uniqueConstraints.map(u => normalizeUniqueConstraint(u)));
  const newUniques = new Set(newTable.uniqueConstraints.map(u => normalizeUniqueConstraint(u)));
  
  for (const u of newTable.uniqueConstraints) {
    if (!oldUniques.has(normalizeUniqueConstraint(u))) {
      changes.addedUniqueConstraints.push(u);
    }
  }
  
  for (const u of oldTable.uniqueConstraints) {
    if (!newUniques.has(normalizeUniqueConstraint(u))) {
      changes.removedUniqueConstraints.push(u);
    }
  }
  
  // Compare indexes
  const oldIndexes = new Set(oldTable.indexes.map(i => JSON.stringify(i)));
  const newIndexes = new Set(newTable.indexes.map(i => JSON.stringify(i)));
  
  for (const idx of newTable.indexes) {
    if (!oldIndexes.has(JSON.stringify(idx))) {
      changes.addedIndexes.push(idx);
    }
  }
  
  for (const idx of oldTable.indexes) {
    if (!newIndexes.has(JSON.stringify(idx))) {
      changes.removedIndexes.push(idx);
    }
  }
  
  // Return null if no changes
  if (
    changes.addedColumns.length === 0 &&
    changes.removedColumns.length === 0 &&
    changes.modifiedColumns.length === 0 &&
    changes.addedForeignKeys.length === 0 &&
    changes.removedForeignKeys.length === 0 &&
    changes.addedUniqueConstraints.length === 0 &&
    changes.removedUniqueConstraints.length === 0 &&
    changes.addedIndexes.length === 0 &&
    changes.removedIndexes.length === 0
  ) {
    return null;
  }
  
  return changes;
}

/**
 * Compare two schemas and return differences
 * 
 * @param oldSchema - Old schema (can be undefined for initial migration)
 * @param newSchema - New schema (bound to the target dialect)
 * @param dialect - SQL dialect ('sqlite' or 'pg')
 */
export async function diffSchemas(
  oldSchema: Record<string, Table> | undefined,
  newSchema: Record<string, Table>,
  dialect: 'sqlite' | 'pg'
): Promise<SchemaDiff> {
  const diff: SchemaDiff = {
    addedTables: [],
    removedTables: [],
    modifiedTables: [],
  };
  
  const oldTableNames = oldSchema ? new Set(Object.keys(oldSchema)) : new Set<string>();
  const newTableNames = new Set(Object.keys(newSchema));
  
  // Find added tables
  for (const tableName of newTableNames) {
    if (!oldTableNames.has(tableName)) {
      diff.addedTables.push(tableName);
    }
  }
  
  // Find removed tables
  for (const tableName of oldTableNames) {
    if (!newTableNames.has(tableName)) {
      diff.removedTables.push(tableName);
    }
  }
  
  // Compare existing tables
  for (const tableName of oldTableNames) {
    if (newTableNames.has(tableName)) {
      const oldTable = oldSchema![tableName];
      const newTable = newSchema[tableName];
      
      const oldMetadata = extractTableMetadata(oldTable, dialect);
      const newMetadata = extractTableMetadata(newTable, dialect);
      
      const tableDiff = compareTables(oldMetadata, newMetadata);
      if (tableDiff) {
        diff.modifiedTables.push(tableDiff);
      }
    }
  }
  
  return diff;
}

