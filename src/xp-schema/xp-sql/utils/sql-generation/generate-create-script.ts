/**
 * Generate CREATE TABLE SQL script using Drizzle's table config
 * 
 * This function uses Drizzle's getTableConfig() to extract table metadata
 * and constructs CREATE TABLE statements with all constraints using dialect-specific generators.
 * No database connection is required.
 */

import type { SQLDialect} from '../../dialects/types';
import type { UnboundTable } from '../../dialects/implementations/unbound';
import type { Schema } from '../../schema';
import { bindTable, isUTable } from '../../dialects/implementations/unbound';
import { getDialectFromName } from '../../dialects';
import { Table, getTableName } from 'drizzle-orm';
import { DialectSQLGenerator, SQLiteSQLGenerator, PostgreSQLSQLGenerator } from './dialect-sql-generator';
import { generateCreateScriptFromSnapshot, type SchemaSnapshot } from './snapshot-sql-generator';

/**
 * Get the appropriate SQL generator for a dialect
 */
function getSQLGenerator(dialect: 'sqlite' | 'pg'): DialectSQLGenerator {
  if (dialect === 'pg') {
    return new PostgreSQLSQLGenerator();
  } else {
    return new SQLiteSQLGenerator();
  }
}

/**
 * Get table config using Drizzle's getTableConfig utility
 * Works for both PostgreSQL and SQLite tables
 */
function getTableConfig(table: Table, dialect: 'sqlite' | 'pg'): any {
  if (dialect === 'pg') {
    const { getTableConfig } = require('drizzle-orm/pg-core');
    return getTableConfig(table);
  } else {
    const { getTableConfig } = require('drizzle-orm/sqlite-core');
    return getTableConfig(table);
  }
}

/**
 * Determine dialect from bound table
 */
function determineDialect(boundTable: Table): 'pg' | 'sqlite' {
  const tableAny = boundTable as any;
  
  if (tableAny[Symbol.for('drizzle:Name')] === 'PgTable' || 
      tableAny._?.name === 'PgTable' ||
      tableAny.constructor?.name === 'PgTable') {
    return 'pg';
  }
  
  return 'sqlite';
}

/**
 * Generate CREATE TABLE SQL for a single table
 * Uses Drizzle's getTableConfig() to extract metadata and builds SQL using dialect-specific generators
 * 
 * @param table - Table object (bound or unbound)
 * @param dialect - SQL dialect to use for SQL generation (required if table is unbound)
 * @param options - Options for SQL generation
 * @returns CREATE TABLE SQL statement
 */
export async function generateCreateScriptForTable(
  table: Table | UnboundTable,
  dialect?: SQLDialect,
  options: { ifNotExists?: boolean; originalUnboundTable?: UnboundTable; boundSchema?: Record<string, Table> } = {}
): Promise<string> {
  // If table is unbound, bind it first
  let boundTable: Table;
  let tableDialect: 'pg' | 'sqlite';
  const originalUnboundTable = isUTable(table) ? table : options.originalUnboundTable;
  
  if (isUTable(table)) {
    if (!dialect) {
      throw new Error(
        'Dialect is required when generating CREATE script for an unbound table. ' +
        'Please provide a dialect parameter.'
      );
    }
    tableDialect = dialect === 'pg' ? 'pg' : 'sqlite';
    const dialectObj = await getDialectFromName(dialect);
    boundTable = bindTable(table, dialectObj);
  } else {
    boundTable = table as Table;
    tableDialect = determineDialect(boundTable);
  }
  
  // Get the SQL generator for this dialect
  const generator = getSQLGenerator(tableDialect);
  
  // Get table config using Drizzle's utility
  const config = getTableConfig(boundTable, tableDialect);
  
  // Build column definitions
  const columnDefs: string[] = [];
  const columns = config.columns || {};
  
  // Columns can be an array-like object with numeric keys or a regular object
  // Iterate over columns in order
  const columnKeys = Array.isArray(columns) 
    ? Object.keys(columns).map(k => parseInt(k)).sort((a, b) => a - b).map(k => k.toString())
    : Object.keys(columns);
  
  for (const key of columnKeys) {
    const column = columns[key];
    if (!column) continue;
    
    // Get column SQL using the dialect-specific generator
    const columnSQL = generator.generateColumnSQL(column);
    if (columnSQL && columnSQL.trim()) {
      columnDefs.push(columnSQL);
    }
  }
  
  // Add primary key constraints (if not already inline)
  if (config.primaryKeys && Array.isArray(config.primaryKeys) && config.primaryKeys.length > 0) {
    const pkColumns = config.primaryKeys.map((pk: any) => {
      const colName = pk?.name || pk?.column?.name || (typeof pk === 'string' ? pk : '');
      return `"${colName}"`;
    }).filter((name: string) => name !== '""').join(', ');
    if (pkColumns) {
      columnDefs.push(`PRIMARY KEY (${pkColumns})`);
    }
  }
  
  // Add unique constraints (if not already inline)
  if (config.uniqueConstraints && Array.isArray(config.uniqueConstraints) && config.uniqueConstraints.length > 0) {
    for (const unique of config.uniqueConstraints) {
      if (unique?.columns && Array.isArray(unique.columns)) {
        const uniqueColumns = unique.columns.map((col: any) => {
          const colName = col?.name || (typeof col === 'string' ? col : '');
          return `"${colName}"`;
        }).filter((name: string) => name !== '""').join(', ');
        if (uniqueColumns) {
          columnDefs.push(`UNIQUE (${uniqueColumns})`);
        }
      }
    }
  }
  
  // Add foreign key constraints
  if (config.foreignKeys && Array.isArray(config.foreignKeys) && config.foreignKeys.length > 0) {
    for (const fk of config.foreignKeys) {
      let localColumns: string[] = [];
      let refTableName = '';
      let refColumns: string[] = [];
      
      // Try to get columns from fk.columns if available (for table-level foreign keys)
      if (fk.columns && Array.isArray(fk.columns) && fk.columns.length > 0) {
        localColumns = fk.columns.map((col: any) => {
          return col?.name || (typeof col === 'string' ? col : '');
        }).filter((name: string) => name !== '');
      }
      
      // Try to get the reference table and foreign columns
      // For inline FKs, the reference() function may fail because it tries to access unbound columns
      // We need to handle this more carefully
      if (fk.reference && typeof fk.reference === 'function') {
        try {
          const refTable = fk.reference();
          refTableName = getTableName(refTable);
          const refTableConfig = getTableConfig(refTable, tableDialect);
          
          // Try to get foreign columns from fk.foreignColumns
          if (fk.foreignColumns && Array.isArray(fk.foreignColumns) && fk.foreignColumns.length > 0) {
            refColumns = fk.foreignColumns.map((col: any) => {
              return col?.name || (typeof col === 'string' ? col : '');
            }).filter((name: string) => name !== '');
          } else {
            // Fallback: use primary key of referenced table
            if (refTableConfig.primaryKeys && refTableConfig.primaryKeys.length > 0) {
              refColumns = refTableConfig.primaryKeys.map((pk: any) => {
                return pk?.name || pk?.column?.name || (typeof pk === 'string' ? pk : '');
              }).filter((name: string) => name !== '');
            } else {
              // If no primary key, check all columns and use the first one
              // This is a fallback - ideally the FK should specify the column
              const refCols = refTableConfig.columns || {};
              const refColKeys = Array.isArray(refCols) 
                ? Object.keys(refCols).map(k => parseInt(k)).sort((a, b) => a - b).map(k => k.toString())
                : Object.keys(refCols);
              if (refColKeys.length > 0) {
                const firstRefCol = refCols[refColKeys[0]];
                if (firstRefCol && firstRefCol.name) {
                  refColumns = [firstRefCol.name];
                }
              }
            }
          }
        } catch (e) {
          // If reference() fails, try to extract from the original unbound table
          if (originalUnboundTable) {
            // Find the column in the original unbound table that has a reference
            for (const [colKey, col] of Object.entries(originalUnboundTable.columns)) {
              const colData = col as any;
              if (colData.modifiers) {
                const refModifier = colData.modifiers.find((m: any) => m.method === 'references');
                if (refModifier && refModifier.args && refModifier.args.length > 0) {
                  try {
                    // Call the original reference function to get the referenced column
                    const refCol = refModifier.args[0]();
                    if (refCol) {
                      // Get the column name from the referenced column's data
                      const refColData = refCol.data || (refCol.getData ? refCol.getData() : refCol);
                      if (refColData && refColData.name) {
                        refColumns = [refColData.name];
                      } else if (refCol.name) {
                        refColumns = [refCol.name];
                      }
                      
                      // Find which table this column belongs to by checking the schema
                      // We need to search through all tables in the schema to find the one with this column
                      // For now, we'll use a heuristic: if we have access to the schema, search it
                      // Otherwise, we'll need to bind the referenced table to get its name
                      // Set local column name
                      if (localColumns.length === 0 && colData.name) {
                        localColumns = [colData.name];
                      }
                      
                      // Try to get the referenced table name
                      // First check if the referenced column has table info
                      if (refCol.table && refCol.table.__name) {
                        refTableName = refCol.table.__name;
                      } else if (options.boundSchema) {
                        // Search through bound schema to find which table has a column matching refColumns
                        for (const [tblName, tbl] of Object.entries(options.boundSchema)) {
                          try {
                            const tblConfig = getTableConfig(tbl, tableDialect);
                            const tblCols = tblConfig.columns || {};
                            const colKeys = Array.isArray(tblCols) 
                              ? Object.keys(tblCols).map(k => parseInt(k)).sort((a, b) => a - b).map(k => k.toString())
                              : Object.keys(tblCols);
                            
                            for (const colKey of colKeys) {
                              const col = tblCols[colKey];
                              if (col && col.name === refColumns[0]) {
                                // Use getTableName to get the actual table name from the bound table
                                refTableName = getTableName(tbl);
                                break;
                              }
                            }
                            if (refTableName) break;
                          } catch (e) {
                            // Continue searching
                          }
                        }
                      }
                      
                      if (refTableName && refColumns.length > 0 && localColumns.length > 0) {
                        break;
                      }
                    }
                  } catch (refError) {
                    // Continue to next column
                  }
                }
              }
            }
          }
          
          // If we still don't have the reference, try one more approach:
          // For inline FKs, we can try to get the table name from the schema context
          // by checking which other tables exist and matching column names
          // This is a fallback heuristic
          if (!refTableName && localColumns.length > 0 && refColumns.length > 0) {
            // We have local and foreign columns but no table name
            // This is a limitation - we'd need schema context
            // For now, skip this FK
            continue;
          }
          
          // If we still don't have the reference, skip this FK
          if (!refTableName || refColumns.length === 0) {
            continue;
          }
        }
      }
      
      // For inline foreign keys, find the column that has the reference
      if (localColumns.length === 0) {
        const tableAny = boundTable as any;
        const inlineFKsSymbol = tableDialect === 'pg' 
          ? Symbol.for('drizzle:PgInlineForeignKeys')
          : Symbol.for('drizzle:SQLiteInlineForeignKeys');
        const inlineFKs = tableAny[inlineFKsSymbol] || [];
        
        if (inlineFKs.includes(fk)) {
          // This is an inline FK - find the column that has it
          // Check each column in the table to see which one has a reference
          const tableCols = tableAny[Symbol.for('drizzle:Columns')] || {};
          
          // For inline FKs, we can match by checking if the FK's reference function
          // would return the same table we found
          for (const [colKey, col] of Object.entries(tableCols)) {
            const colAny = col as any;
            // Check if this column matches the FK by checking the column name
            // For now, use a simple heuristic: if there's only one FK and one column with a reference,
            // match them. Otherwise, we'd need to check the original unbound table.
            // Since we can't easily access that here, we'll use the column name from config
            const colConfig = Array.isArray(config.columns) 
              ? config.columns.find((c: any) => c.name === colAny.name)
              : config.columns[colAny.name];
            
            if (colConfig && refTableName) {
              // This column exists - for inline FKs, assume this is the FK column
              // if we haven't found one yet
              if (localColumns.length === 0) {
                localColumns = [colAny.name];
              }
            }
          }
          
          // If still no local columns, try to get from the column that has the FK
          // by checking the table structure more carefully
          if (localColumns.length === 0 && refTableName) {
            // For inline FKs, the column with the reference is typically the first one
            // that doesn't have a primary key and is not null
            // This is a heuristic - ideally we'd check the original unbound table
            for (const [colKey, col] of Object.entries(tableCols)) {
              const colAny = col as any;
              if (!colAny.primary && colAny.notNull) {
                localColumns = [colAny.name];
                break;
              }
            }
          }
        }
      }
      
      // If we still don't have foreign columns, use primary key of referenced table
      if (refColumns.length === 0 && refTableName) {
        try {
          // Try to call reference again to get the table
          if (fk.reference && typeof fk.reference === 'function') {
            const refTable = fk.reference();
            const refTableConfig = getTableConfig(refTable, tableDialect);
            if (refTableConfig.primaryKeys && refTableConfig.primaryKeys.length > 0) {
              refColumns = refTableConfig.primaryKeys.map((pk: any) => {
                return pk?.name || pk?.column?.name || (typeof pk === 'string' ? pk : '');
              }).filter((name: string) => name !== '');
            }
          }
        } catch (e) {
          // Skip if we can't get reference
        }
      }
      
      if (localColumns.length === 0 || !refTableName || refColumns.length === 0) {
        // If we still can't determine the columns, skip this FK
        continue;
      }
      
      const localColumnsStr = localColumns.map(name => `"${name}"`).join(', ');
      const refColumnsStr = refColumns.map(name => `"${name}"`).join(', ');
      
      let fkSQL = `FOREIGN KEY (${localColumnsStr}) REFERENCES "${refTableName}" (${refColumnsStr})`;
      
      // Add ON UPDATE and ON DELETE if specified (normalize to uppercase for SQL)
      if (fk.onUpdate) {
        const onUpdate = typeof fk.onUpdate === 'string' ? fk.onUpdate.toUpperCase() : fk.onUpdate;
        fkSQL += ` ON UPDATE ${onUpdate}`;
      }
      if (fk.onDelete) {
        const onDelete = typeof fk.onDelete === 'string' ? fk.onDelete.toUpperCase() : fk.onDelete;
        fkSQL += ` ON DELETE ${onDelete}`;
      }
      
      columnDefs.push(fkSQL);
    }
  }
  
  // Generate CREATE TABLE statement using the dialect-specific generator
  const tableName = config.name || getTableName(boundTable);
  const createSQL = generator.generateCreateTableSQL(tableName, columnDefs, {
    ifNotExists: options.ifNotExists !== false,
    schema: config.schema
  });
  
  // Generate CREATE INDEX statements for indexes
  const indexStatements: string[] = [];
  
  // Try to get indexes from config first
  let indexes: any[] = [];
  if (config.indexes && Array.isArray(config.indexes)) {
    indexes = config.indexes;
  } else {
    // Fallback: try to get indexes from the table object directly
    const tableAny = boundTable as any;
    // Check for indexes in various possible locations
    if (tableAny[Symbol.for('drizzle:Indexes')]) {
      indexes = tableAny[Symbol.for('drizzle:Indexes')];
    } else if (tableAny._?.indexes) {
      indexes = tableAny._?.indexes;
    } else if (tableAny.indexes) {
      indexes = Array.isArray(tableAny.indexes) ? tableAny.indexes : [];
    }
  }
  
  if (indexes.length > 0) {
    for (const idx of indexes) {
      if (!idx) continue;
      
      // Get index name - Drizzle stores it in idx.config.name
      const indexName = idx.config?.name || idx.name || idx._?.name || idx._?.config?.name;
      if (!indexName) continue;
      
      // Get columns for the index - Drizzle stores them in idx.config.columns
      const indexColumns: string[] = [];
      const idxColumns = idx.config?.columns || idx.columns;
      
      if (idxColumns && Array.isArray(idxColumns)) {
        indexColumns.push(...idxColumns.map((col: any) => {
          // Column can be a Column object with a .name property
          return col?.name || (typeof col === 'string' ? col : '');
        }).filter((name: string) => name !== ''));
      } else if (idx.column && idx.column.name) {
        indexColumns.push(idx.column.name);
      } else if (idx.column && typeof idx.column === 'string') {
        indexColumns.push(idx.column);
      }
      
      if (indexColumns.length === 0) continue;
      
      // Check if index is unique - Drizzle stores it in idx.config.unique
      const isUnique = idx.config?.unique || idx.unique || idx._?.unique || false;
      
      // Build CREATE INDEX statement
      const columnsStr = indexColumns.map(name => `"${name}"`).join(', ');
      const uniqueKeyword = isUnique ? 'UNIQUE ' : '';
      const ifNotExistsClause = options.ifNotExists !== false ? 'IF NOT EXISTS ' : '';
      const schemaPrefix = config.schema ? `"${config.schema}".` : '';
      
      const indexSQL = `CREATE ${uniqueKeyword}INDEX ${ifNotExistsClause}"${indexName}" ON ${schemaPrefix}"${tableName}" (${columnsStr});`;
      indexStatements.push(indexSQL);
    }
  }
  
  // Combine CREATE TABLE and CREATE INDEX statements
  if (indexStatements.length > 0) {
    return createSQL + '\n\n' + indexStatements.join('\n');
  }
  
  return createSQL;
}

/**
 * Generate CREATE TABLE SQL from a schema snapshot
 * 
 * @param snapshot - Schema snapshot (can be loaded from JSON file)
 * @param dialect - SQL dialect ('sqlite' | 'pg')
 * @param options - Options for SQL generation
 * @returns CREATE TABLE SQL statements for all tables
 */
export function generateCreateScriptFromSnapshotFile(
  snapshot: SchemaSnapshot,
  dialect: 'sqlite' | 'pg',
  options: { ifNotExists?: boolean } = {}
): string {
  return generateCreateScriptFromSnapshot(snapshot, dialect, options);
}

/**
 * Generate CREATE TABLE SQL for all tables in a schema
 * 
 * @param schema - Schema object containing tables
 * @param dialect - SQL dialect to use for SQL generation (required if schema contains unbound tables)
 * @param options - Options for SQL generation
 * @returns Combined CREATE TABLE SQL statements
 */
export async function generateCreateScriptForSchema(
  schema: Schema,
  dialect?: SQLDialect,
  options: { ifNotExists?: boolean } = {}
): Promise<string> {
  const statements: string[] = [];
  
  // First, bind all tables so referenced tables are available for FK resolution
  const boundTables: Record<string, Table> = {};
  
  if (dialect) {
    const dialectObj = await getDialectFromName(dialect);
    for (const [tableName, table] of Object.entries(schema.tables)) {
      let boundTable: Table;
      if (isUTable(table)) {
        boundTable = bindTable(table, dialectObj);
      } else {
        boundTable = table as Table;
      }
      // Use the actual table name from getTableName as the key
      const actualTableName = getTableName(boundTable);
      boundTables[actualTableName] = boundTable;
    }
  }
  
  // Now generate SQL for each table, passing the original unbound table and bound schema for FK resolution
  for (const [tableName, table] of Object.entries(schema.tables)) {
    const originalTable = isUTable(table) ? table : undefined;
    const createSQL = await generateCreateScriptForTable(table, dialect, {
      ...options,
      originalUnboundTable: originalTable,
      boundSchema: boundTables
    });
    statements.push(createSQL);
  }
  
  return statements.join('\n\n');
}

/**
 * Generate CREATE TABLE SQL script
 * Accepts either a single table or a schema
 * Uses Drizzle's getTableConfig() to extract metadata and builds SQL using dialect-specific generators
 * 
 * @param input - Table object or Schema object
 * @param dialect - SQL dialect to use for SQL generation (required if input contains unbound tables)
 * @param options - Options for SQL generation
 * @returns CREATE TABLE SQL statement(s)
 */
export async function generateCreateScript(
  input: Table | UnboundTable | Schema<any>,
  dialect?: SQLDialect,
  options: { ifNotExists?: boolean } = {}
): Promise<string> {
  // Check if input is a Schema
  if (input && typeof input === 'object' && 'tables' in input) {
    return await generateCreateScriptForSchema(input as Schema<any>, dialect, options);
  }
  
  // Otherwise, treat as a table
  return await generateCreateScriptForTable(input as Table | UnboundTable, dialect, options);
}
