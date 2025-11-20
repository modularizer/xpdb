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
  
  // Check for enum values (for both dialects)
  if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
    // For enum, include the values in the type string
    const enumStr = enumValues.map((v: any) => `'${String(v).replace(/'/g, "''")}'`).join(',');
    const baseType = typeString.split('(')[0];
    typeString = `${baseType}(${enumStr})`;
  }
  
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
  // If we have an unbound table, extract metadata from it first (dialect-agnostic)
  // Then merge with bound table's dialect-specific type information
  if (unboundTable) {
    const unboundMeta = extractTableMetadataFromUnbound(unboundTable, allUnboundTables);
    // If dialect is a string, we need to get the dialect object (async)
    // If it's already a SQLDialect object, use it directly
    if (typeof dialect === 'string') {
      return getDialectFromName(dialect).then(dialectObj => 
        mergeUnboundWithBoundMetadata(unboundMeta, table, dialectObj)
      );
    } else {
      return mergeUnboundWithBoundMetadata(unboundMeta, table, dialect);
    }
  }
  
  // Fallback: extract from bound table only (original method)
  // Validate table before processing
  if (!table || typeof table !== 'object') {
    throw new Error(`Invalid table: expected object, got ${typeof table}`);
  }

  // Get table config using Drizzle's utility
  let getTableConfig: any;
  try {
    if (dialect === 'pg') {
      getTableConfig = require('drizzle-orm/pg-core').getTableConfig;
    } else {
      getTableConfig = require('drizzle-orm/sqlite-core').getTableConfig;
    }
  } catch (error: any) {
    throw new Error(`Failed to load getTableConfig for dialect "${dialect}": ${error.message}`);
  }
  
  // Validate getTableConfig function
  if (typeof getTableConfig !== 'function') {
    throw new Error(`getTableConfig is not a function for dialect "${dialect}"`);
  }

  let config: any;
  try {
    config = getTableConfig(table);
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
  
  // Debug: Log foreign keys in config
  if (config.foreignKeys && Array.isArray(config.foreignKeys)) {
    console.log(`   Table ${tableName} has ${config.foreignKeys.length} foreign key(s) in config.foreignKeys`);
    for (let i = 0; i < config.foreignKeys.length; i++) {
      const fk = config.foreignKeys[i];
      console.log(`     FK ${i}: columns=${fk.columns?.length || 0}, hasReference=${!!fk.reference}`);
    }
  }
  
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
        const metadata = extractColumnMetadata(column, dialect);
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
  console.log(`   Checking ${columnKeys.length} columns for inline foreign keys...`);
  for (const key of columnKeys) {
    const column = config.columns[key];
    if (!column || !column.name) continue;
    
    // Check if column has a reference (inline foreign key)
    // Try multiple ways to access the reference
    let refFn: (() => any) | undefined;
    
    // Check various properties where the reference might be stored
    if (column.references && typeof column.references === 'function') {
      refFn = column.references;
      console.log(`     Column "${column.name}" has column.references`);
    } else if ((column as any).$ref && typeof (column as any).$ref === 'function') {
      refFn = (column as any).$ref;
      console.log(`     Column "${column.name}" has $ref`);
    } else if ((column as any).ref && typeof (column as any).ref === 'function') {
      refFn = (column as any).ref;
      console.log(`     Column "${column.name}" has ref`);
    } else if ((column as any).foreignKey && typeof (column as any).foreignKey === 'function') {
      refFn = (column as any).foreignKey;
      console.log(`     Column "${column.name}" has foreignKey`);
    } else if ((column as any)._?.references && typeof (column as any)._?.references === 'function') {
      refFn = (column as any)._?.references;
      console.log(`     Column "${column.name}" has _.references`);
    } else if ((column as any).data?.references && typeof (column as any).data?.references === 'function') {
      refFn = (column as any).data?.references;
      console.log(`     Column "${column.name}" has data.references`);
    }
    
    if (refFn) {
      try {
        // Call the reference function to get the referenced column
        const refCol = refFn();
        if (refCol) {
          let refTable = '';
          let refColumn = '';
          
          // The referenced column should have a table property
          // Try multiple ways to access it
          const refColTable = (refCol as any).table || 
                             (refCol as any)._?.table || 
                             (refCol as any).__table ||
                             (refCol as any).tableName;
          
          if (refColTable) {
            // Get table name from the referenced column's table
            try {
              refTable = getTableName(refColTable);
            } catch (e) {
              // Try alternative ways to get table name
              refTable = (refColTable as any).name || 
                        (refColTable as any).__name || 
                        (refColTable as any).tableName ||
                        '';
            }
          }
          
          // Get the referenced column name - try multiple ways
          refColumn = (refCol as any).name || 
                     (refCol as any).data?.name || 
                     (refCol as any).__name ||
                     (refCol as any).columnName ||
                     '';
          
          // If we still don't have the column name, try to get it from the column's data
          if (!refColumn) {
            const refColData = (refCol as any).data || (refCol as any).getData?.();
            if (refColData) {
              refColumn = refColData.name || refColData.columnName || '';
            }
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
  if (config.foreignKeys && Array.isArray(config.foreignKeys)) {
    for (const fk of config.foreignKeys) {
      let localColumns: string[] = [];
      let refTable = '';
      let refColumns: string[] = [];
      
      // Get local columns - for inline FKs, fk.columns might be empty
      if (fk.columns && Array.isArray(fk.columns) && fk.columns.length > 0) {
        localColumns = fk.columns.map((col: any) => col?.name || (typeof col === 'string' ? col : '')).filter((n: string) => n);
      }
      
      // Get reference table and columns
      if (fk.reference && typeof fk.reference === 'function') {
        try {
          // For inline FKs, reference() returns the referenced column, not the table
          // For explicit FKs, reference() returns the referenced table
          const refResult = fk.reference();
          console.log(`     fk.reference() returned:`, {
            type: typeof refResult,
            isNull: refResult === null,
            isUndefined: refResult === undefined,
            keys: refResult ? Object.keys(refResult).slice(0, 10) : [],
          });
          
          if (!refResult) {
            console.log(`     ⚠️  fk.reference() returned null/undefined`);
            continue;
          }
          
          // Check if it's a column (has .table property) or a table
          const refColTable = (refResult as any).table || (refResult as any)._?.table || (refResult as any).__table;
          
          console.log(`     refColTable check:`, {
            hasTable: !!refColTable,
            hasTableProp: !!(refResult as any).table,
            has_Table: !!(refResult as any)._?.table,
            has__Table: !!(refResult as any).__table,
          });
          
          if (refColTable) {
            // It's a column - extract table and column name
            try {
              refTable = getTableName(refColTable);
              console.log(`     Extracted refTable from getTableName: ${refTable}`);
            } catch (e) {
              refTable = (refColTable as any).name || (refColTable as any).__name || '';
              console.log(`     Extracted refTable from fallback: ${refTable}`);
            }
            
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
                if (column.references === fk.reference || (column as any).$ref === fk.reference) {
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
                  let colRefFn: (() => any) | undefined;
                  if (column.references && typeof column.references === 'function') {
                    colRefFn = column.references;
                  } else if ((column as any).$ref && typeof (column as any).$ref === 'function') {
                    colRefFn = (column as any).$ref;
                  } else if ((column as any).ref && typeof (column as any).ref === 'function') {
                    colRefFn = (column as any).ref;
                  }
                  
                  if (colRefFn) {
                    try {
                      const colRef = colRefFn();
                      if (!colRef) continue;
                      
                      // Compare the referenced column/table to see if it matches
                      const colRefTable = (colRef as any).table || (colRef as any)._?.table || (colRef as any).__table;
                      if (colRefTable && refColTable) {
                        try {
                          const colRefTableName = getTableName(colRefTable);
                          const colRefName = (colRef as any).name || (colRef as any).data?.name || (colRef as any).__name || '';
                          
                          console.log(`     Checking column "${column.name}": refTable="${colRefTableName}", refCol="${colRefName}" vs expected "${refTable}"."${refColumns[0]}"`);
                          
                          if (colRefTableName === refTable && colRefName === refColumns[0]) {
                            localColumns = [column.name];
                            console.log(`   ✅ Matched FK to column "${column.name}" by reference result`);
                            break;
                          }
                        } catch (e) {
                          // Skip comparison if we can't get table name
                          console.log(`     Error comparing for column "${column.name}":`, e);
                        }
                      }
                    } catch (e) {
                      // Skip if reference() fails
                      console.log(`     Error calling reference for column "${column.name}":`, e);
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
            // It's a table - explicit foreign key, OR refColTable check failed
            console.log(`     refColTable is falsy, treating as table or trying alternative extraction`);
            try {
              refTable = getTableName(refResult);
              console.log(`     Extracted refTable (as table): ${refTable}`);
            } catch (e) {
              console.log(`     Could not get table name from refResult:`, e);
              // Try to extract from refResult directly
              refTable = (refResult as any).name || (refResult as any).__name || '';
              console.log(`     Extracted refTable from fallback: ${refTable}`);
            }
            
            // Get foreign columns
            if (fk.foreignColumns && Array.isArray(fk.foreignColumns) && fk.foreignColumns.length > 0) {
              refColumns = fk.foreignColumns.map((col: any) => col?.name || (typeof col === 'string' ? col : '')).filter((n: string) => n);
              console.log(`     Using fk.foreignColumns: ${refColumns.join(', ')}`);
            } else {
              // Fallback: use primary key of referenced table
              try {
                const refTableConfig = getTableConfig(refResult, dialect);
                if (refTableConfig.primaryKeys && refTableConfig.primaryKeys.length > 0) {
                  refColumns = refTableConfig.primaryKeys.map((pk: any) => {
                    return pk?.name || pk?.column?.name || (typeof pk === 'string' ? pk : '');
                  }).filter((n: string) => n);
                  console.log(`     Using primary keys from refTable: ${refColumns.join(', ')}`);
                } else {
                  // If it's actually a column, try to get the column name
                  const colName = (refResult as any).name || (refResult as any).data?.name || (refResult as any).__name || '';
                  if (colName) {
                    refColumns = [colName];
                    console.log(`     Using column name from refResult: ${colName}`);
                  }
                }
              } catch (e2) {
                console.log(`     Error getting refTableConfig:`, e2);
                // Last resort: try to get column name from refResult
                const colName = (refResult as any).name || (refResult as any).data?.name || (refResult as any).__name || '';
                if (colName) {
                  refColumns = [colName];
                  console.log(`     Using column name from refResult (fallback): ${colName}`);
                }
              }
            }
          }
        } catch (e) {
          // Skip if we can't resolve
          console.warn(`     ⚠️  Error processing FK reference:`, e);
        }
      } else {
        console.log(`     ⚠️  FK has no reference function`);
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
  
  // Compare columns
  const oldColumnNames = new Set(Object.keys(oldTable.columns));
  const newColumnNames = new Set(Object.keys(newTable.columns));
  
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
          }
          // Compare actual default values
          if (oldCol.hasDefault && newCol.hasDefault) {
            const oldDefault = oldCol.defaultValue;
            const newDefault = newCol.defaultValue;
            
            // Both are functions - consider them equivalent (can't reliably compare function code)
            // Functions are typically serialized differently, so we ignore function-to-function changes
            if (typeof oldDefault === 'function' && typeof newDefault === 'function') {
              // Functions are considered equivalent - don't report as change
              // The function code might be serialized differently but represent the same function
            } else if (typeof oldDefault !== 'function' && typeof newDefault !== 'function') {
              // Both are non-function values - compare them
              const oldDefaultStr = oldDefault !== undefined ? String(oldDefault) : 'undefined';
              const newDefaultStr = newDefault !== undefined ? String(newDefault) : 'undefined';
              if (oldDefaultStr !== newDefaultStr) {
                columnChanges.push(`defaultValue: ${oldDefaultStr} -> ${newDefaultStr}`);
              }
            } else {
              // One is function, one is not - this is a real change
              columnChanges.push(`defaultValue: ${typeof oldDefault === 'function' ? 'function' : String(oldDefault)} -> ${typeof newDefault === 'function' ? 'function' : String(newDefault)}`);
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
  const oldUniques = new Set(oldTable.uniqueConstraints.map(u => JSON.stringify(u)));
  const newUniques = new Set(newTable.uniqueConstraints.map(u => JSON.stringify(u)));
  
  for (const u of newTable.uniqueConstraints) {
    if (!oldUniques.has(JSON.stringify(u))) {
      changes.addedUniqueConstraints.push(u);
    }
  }
  
  for (const u of oldTable.uniqueConstraints) {
    if (!newUniques.has(JSON.stringify(u))) {
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

