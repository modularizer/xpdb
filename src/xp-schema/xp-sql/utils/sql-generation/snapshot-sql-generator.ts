/**
 * Snapshot-based SQL Generation
 * 
 * Unified module for generating SQL from schema snapshots:
 * - Generate CREATE TABLE scripts from snapshots
 * - Generate migration SQL from snapshot comparisons
 * - Share common SQL generation logic
 */

import type { TableMetadata, ColumnMetadata } from '../schema-extraction/schema-diff';
import type { SchemaDiff } from '../schema-extraction/schema-diff';
import { DialectSQLGenerator, SQLiteSQLGenerator, PostgreSQLSQLGenerator } from './dialect-sql-generator';
import { validateSQLOrThrow } from '../../../utils/validate-sql';

/**
 * Schema snapshot structure (matches migration-generator.ts)
 */
export interface SchemaSnapshot {
  version: number;
  timestamp: number;
  migrationName: string;
  tables: Record<string, TableMetadata>;
  schemaHash: string; // Hash of the sorted tables JSON to uniquely identify the schema
}

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
 * Serialize a default value to a string representation for storage in snapshot
 * Only stores SQL expressions and literal values - skips application-level functions
 * (Application-level functions like generateUUID are handled in code, not database)
 */
export function serializeDefaultValue(defaultValue: any): string | null {
  if (defaultValue === undefined || defaultValue === null) {
    return null;
  }
  
  // Check if it's a SQL expression (has queryChunks) - these are database-level defaults
  const isSQLExpression = (val: any): boolean => {
    if (val && typeof val === 'object' && val.queryChunks) {
      return true;
    }
    if (typeof val === 'function' && val.queryChunks) {
      return true;
    }
    return false;
  };
  
  // If it's a SQL expression, serialize it
  if (isSQLExpression(defaultValue)) {
    try {
      const queryChunks = defaultValue.queryChunks || (defaultValue as any).queryChunks;
      return JSON.stringify({
        type: 'sql',
        queryChunks: queryChunks,
      });
    } catch (e) {
      return null; // If serialization fails, don't store it
    }
  }
  
  // If it's a function (but not a SQL expression), don't store it
  // Application-level functions are handled in code, not database
  if (typeof defaultValue === 'function') {
    return null;
  }
  
  // If it's already a string, return it
  if (typeof defaultValue === 'string') {
    return defaultValue;
  }
  
  // If it's an object, try to serialize it
  if (defaultValue && typeof defaultValue === 'object') {
    try {
      return JSON.stringify(defaultValue);
    } catch (e) {
      return null; // If serialization fails, don't store it
    }
  }
  
  // Number, boolean, etc. - return as string representation
  return String(defaultValue);
}

/**
 * Deserialize a default value from snapshot
 */
export function deserializeDefaultValue(serialized: string | null | undefined): any {
  if (!serialized) {
    return undefined;
  }
  
  // Check if it's a SQL expression
  if (serialized.startsWith('{"type":"sql"')) {
    try {
      return JSON.parse(serialized);
    } catch (e) {
      return serialized;
    }
  }
  
  // Check if it's a function reference
  if (serialized.startsWith('function:')) {
    // Return a marker object that can be recognized later
    return { __type: 'function', name: serialized.substring(9) };
  }
  
  // Try to parse as JSON
  try {
    return JSON.parse(serialized);
  } catch (e) {
    // Return as string if not JSON
    return serialized;
  }
}

/**
 * Generate column SQL from column metadata
 */
function generateColumnSQLFromMetadata(
  col: ColumnMetadata,
  dialect: 'sqlite' | 'pg'
): string {
  const generator = getSQLGenerator(dialect);
  
  // Build column definition
  let colDef = `"${col.name}" ${col.type}`;
  
  // Add NOT NULL if not nullable
  if (!col.nullable) {
    colDef += ' NOT NULL';
  }
  
  // Add DEFAULT if has default (only database-level defaults)
  if (col.hasDefault && col.defaultValue !== undefined) {
    const defaultValue = col.defaultValue;
    
    // Handle different default value types
    if (defaultValue && typeof defaultValue === 'object' && defaultValue.type === 'sql') {
      // SQL expression - extract from queryChunks
      if (defaultValue.queryChunks && Array.isArray(defaultValue.queryChunks)) {
        const sqlParts = defaultValue.queryChunks.map((chunk: any) => {
          if (chunk.value) {
            return Array.isArray(chunk.value) ? chunk.value.join(' ') : chunk.value;
          }
          return '';
        }).filter((s: string) => s).join(' ');
        if (sqlParts) {
          colDef += ` DEFAULT ${sqlParts}`;
        }
      }
    } else if (typeof defaultValue === 'string') {
      // String literal
      colDef += ` DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
    } else if (typeof defaultValue === 'number' || typeof defaultValue === 'boolean') {
      // Number or boolean literal
      colDef += ` DEFAULT ${defaultValue}`;
    } else if (defaultValue === null) {
      // NULL default
      colDef += ` DEFAULT NULL`;
    }
    // Note: Application-level functions are not included (hasDefault is false for those)
  }
  
  // Note: Primary keys and unique constraints are handled at table level,
  // not in individual column definitions
  
  return colDef;
}

/**
 * Generate CREATE TABLE SQL from table metadata
 * 
 * @param tableName - Name of the table to create
 * @param tableMetadata - Metadata for the table
 * @param dialect - SQL dialect ('sqlite' | 'pg')
 * @param options - Options for SQL generation
 * @param snapshot - Schema snapshot (required). Use `null` to indicate no snapshot provided, 
 *                   or a snapshot with `tables: {}` to indicate an empty database.
 *                   An empty database snapshot (`tables: {}`) is distinguishable from `null`:
 *                   - `null` = no snapshot provided (will throw error for FK validation)
 *                   - `tables: {}` = empty database snapshot (will validate FKs and fail if referenced table doesn't exist)
 */
export function generateCreateTableFromSnapshot(
  tableName: string,
  tableMetadata: TableMetadata,
  dialect: 'sqlite' | 'pg',
  options: { ifNotExists?: boolean } = {},
  snapshot: SchemaSnapshot | null
): string {
  const generator = getSQLGenerator(dialect);
  const columnDefs: string[] = [];
  
  // Generate column definitions
  for (const col of Object.values(tableMetadata.columns)) {
    const colSQL = generateColumnSQLFromMetadata(col, dialect);
    columnDefs.push(colSQL);
    
    // Add CHECK constraint for enum values (both PostgreSQL and SQLite)
    if (col.enumValues && Array.isArray(col.enumValues) && col.enumValues.length > 0) {
      const enumStr = col.enumValues.map((v: any) => `'${String(v).replace(/'/g, "''")}'`).join(',');
      columnDefs.push(`CHECK ("${col.name}" IN (${enumStr}))`);
    }
  }
  
  // Add primary key constraint
  if (tableMetadata.primaryKeys.length > 0) {
    const pkColumns = tableMetadata.primaryKeys.map(name => `"${name}"`).join(', ');
    if (pkColumns) {
      columnDefs.push(`PRIMARY KEY (${pkColumns})`);
    }
  }
  
  // Add unique constraints
  for (const unique of tableMetadata.uniqueConstraints) {
    const uniqueColumns = unique.columns.map(name => `"${name}"`).join(', ');
    if (uniqueColumns) {
      if (unique.name) {
        // Validate constraint name before using it
        if (!/^[A-Za-z0-9_$]+$/.test(unique.name)) {
          const invalidChars = unique.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
          const uniqueInvalidChars = [...new Set(invalidChars)];
          throw new Error(
            `Invalid unique constraint name "${unique.name}" in table "${tableName}": ` +
            `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
            `Constraint names must only contain alphanumeric characters, underscores, and dollar signs. ` +
            `This constraint was extracted from the schema with an invalid name. ` +
            `The constraint name must be fixed in the schema definition or database.`
          );
        }
        columnDefs.push(`CONSTRAINT "${unique.name}" UNIQUE (${uniqueColumns})`);
      } else {
        columnDefs.push(`UNIQUE (${uniqueColumns})`);
      }
    }
  }
  
  // Add foreign key constraints
  for (const fk of tableMetadata.foreignKeys) {
    const localColumns = fk.localColumns.map(name => `"${name}"`).join(', ');
    const refColumns = fk.refColumns.map(name => `"${name}"`).join(', ');
    if (localColumns && refColumns) {
      // Validate: foreign key must reference a primary key or unique column
      // snapshot is required - null means no snapshot provided, empty object means empty database
      if (snapshot === null) {
        // No snapshot provided - cannot validate FK
        throw new Error(
          `Cannot validate foreign key from table "${tableName}": snapshot not provided (null). ` +
          `Foreign key: ${localColumns} -> ${fk.refTable}(${refColumns}). ` +
          `A snapshot must be provided to validate foreign keys. ` +
          `Use a snapshot with tables: {} to indicate an empty database.`
        );
      }
      
      // snapshot is provided - check if referenced table exists
      // If snapshot.tables is empty ({}), this will fail, which is correct for an empty database
      const refTableMetadata = snapshot.tables[fk.refTable];
      if (!refTableMetadata) {
        const isEmptyDatabase = Object.keys(snapshot.tables).length === 0;
        throw new Error(
          `Foreign key from table "${tableName}" references table "${fk.refTable}" which does not exist in the schema. ` +
          `Foreign key: ${localColumns} -> ${fk.refTable}(${refColumns}). ` +
          (isEmptyDatabase 
            ? `The snapshot represents an empty database (tables: {}), so the referenced table "${fk.refTable}" does not exist.`
            : `The referenced table "${fk.refTable}" is not in the snapshot tables: [${Object.keys(snapshot.tables).join(', ')}].`)
        );
      }
      
      const refTablePKs = refTableMetadata.primaryKeys;
      const refTableUniques = refTableMetadata.uniqueConstraints.flatMap(u => u.columns);
      
      // Check if all refColumns are either primary keys or unique
      const allRefColsAreValid = fk.refColumns.every(col => 
        refTablePKs.includes(col) || refTableUniques.includes(col)
      );
      
      if (!allRefColsAreValid) {
        const invalidColumns = fk.refColumns.filter(col => 
          !refTablePKs.includes(col) && !refTableUniques.includes(col)
        );
        throw new Error(
          `Invalid foreign key in table "${tableName}": ` +
          `Foreign key ${localColumns} references "${fk.refTable}"(${refColumns}), ` +
          `but column(s) ${invalidColumns.map(c => `"${c}"`).join(', ')} in "${fk.refTable}" are not primary keys or unique. ` +
          `Foreign keys must reference primary keys or unique columns. ` +
          `Referenced table "${fk.refTable}" has primary key: [${refTablePKs.map(c => `"${c}"`).join(', ')}] ` +
          `and unique columns: [${refTableUniques.map(c => `"${c}"`).join(', ')}]`
        );
      }
      
      let fkSQL = `FOREIGN KEY (${localColumns}) REFERENCES "${fk.refTable}" (${refColumns})`;
      
      // Add ON UPDATE and ON DELETE if specified
      if (fk.onUpdate) {
        fkSQL += ` ON UPDATE ${fk.onUpdate}`;
      }
      if (fk.onDelete) {
        fkSQL += ` ON DELETE ${fk.onDelete}`;
      }
      
      columnDefs.push(fkSQL);
    }
  }
  
  // Generate CREATE TABLE statement
  return generator.generateCreateTableSQL(tableName, columnDefs, {
    ifNotExists: options.ifNotExists !== false,
  });
}

/**
 * Topologically sort tables based on foreign key dependencies
 * Returns table names in order: referenced tables before tables that reference them
 */
function sortTablesByDependencies(
  tables: Record<string, TableMetadata>
): string[] {
  const tableNames = Object.keys(tables);
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection
  
  function visit(tableName: string) {
    if (visiting.has(tableName)) {
      // Cycle detected - this is an error
      throw new Error(
        `Circular foreign key dependency detected involving table "${tableName}". ` +
        `Foreign keys cannot form cycles.`
      );
    }
    
    if (visited.has(tableName)) {
      return; // Already processed
    }
    
    visiting.add(tableName);
    
    const tableMetadata = tables[tableName];
    if (tableMetadata) {
      // Visit all tables that this table references first
      for (const fk of tableMetadata.foreignKeys) {
        if (tables[fk.refTable]) {
          visit(fk.refTable);
        }
      }
    }
    
    visiting.delete(tableName);
    visited.add(tableName);
    sorted.push(tableName);
  }
  
  // Visit all tables
  for (const tableName of tableNames) {
    if (!visited.has(tableName)) {
      visit(tableName);
    }
  }
  
  return sorted;
}

/**
 * Generate CREATE TABLE scripts for all tables in a snapshot
 * Tables are ordered by foreign key dependencies (referenced tables first)
 */
export function generateCreateScriptFromSnapshot(
  snapshot: SchemaSnapshot,
  dialect: 'sqlite' | 'pg',
  options: { ifNotExists?: boolean } = {}
): string {
  const statements: string[] = [];
  
  // Sort tables by dependencies (topological sort)
  const sortedTableNames = sortTablesByDependencies(snapshot.tables);
  
  // Generate CREATE TABLE for each table in dependency order
  for (const tableName of sortedTableNames) {
    const tableMetadata = snapshot.tables[tableName];
    const createSQL = generateCreateTableFromSnapshot(tableName, tableMetadata, dialect, options, snapshot);
    statements.push(createSQL);
    
    // Generate CREATE INDEX statements for this table
    if (tableMetadata.indexes && Array.isArray(tableMetadata.indexes) && tableMetadata.indexes.length > 0) {
      for (const idx of tableMetadata.indexes) {
        if (idx.name && idx.columns && idx.columns.length > 0) {
          // Validate index name before using it
          if (!/^[A-Za-z0-9_$]+$/.test(idx.name)) {
            const invalidChars = idx.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
            const uniqueInvalidChars = [...new Set(invalidChars)];
            throw new Error(
              `Invalid index name "${idx.name}" in table "${tableName}": ` +
              `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
              `Index names must only contain alphanumeric characters, underscores, and dollar signs. ` +
              `This index was extracted from the schema with an invalid name. ` +
              `The index name must be fixed in the schema definition or database.`
            );
          }
          const indexColumns = idx.columns.map(name => `"${name}"`).join(', ');
          const uniqueClause = idx.unique ? 'UNIQUE ' : '';
          statements.push(`CREATE ${uniqueClause}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${indexColumns});`);
        }
      }
    }
  }
  
  const sql = statements.join('\n\n');
  
  // Validate the generated SQL
  if (sql.trim()) {
    validateSQLOrThrow(sql, dialect, 'CREATE script from snapshot');
  }
  
  return sql;
}

/**
 * Generate migration SQL from schema diff and new snapshot
 */
export function generateMigrationFromSnapshotDiff(
  diff: SchemaDiff,
  newSnapshot: SchemaSnapshot,
  dialect: 'sqlite' | 'pg',
  oldSnapshot?: SchemaSnapshot
): string {
  const statements: string[] = [];
  
  // Handle removed tables
  for (const tableName of diff.removedTables) {
    statements.push(`DROP TABLE IF EXISTS "${tableName}";`);
  }
  
    // Handle added tables - generate CREATE TABLE from snapshot
  for (const tableName of diff.addedTables) {
    const tableMetadata = newSnapshot.tables[tableName];
    if (tableMetadata) {
      // Pass newSnapshot for FK validation
      const createSQL = generateCreateTableFromSnapshot(tableName, tableMetadata, dialect, { ifNotExists: false }, newSnapshot);
      statements.push(createSQL);
    }
  }
  
  // Handle modified tables
  for (const tableDiff of diff.modifiedTables) {
    const tableName = tableDiff.tableName;
    const tableMetadata = newSnapshot.tables[tableName];
    
    if (!tableMetadata) continue;
    
    // Handle removed columns
    for (const colName of tableDiff.removedColumns) {
      statements.push(`ALTER TABLE "${tableName}" DROP COLUMN "${colName}";`);
    }
    
    // Handle added columns
    for (const colName of tableDiff.addedColumns) {
      const col = tableMetadata.columns[colName];
      if (col) {
        const colSQL = generateColumnSQLFromMetadata(col, dialect);
        statements.push(`ALTER TABLE "${tableName}" ADD COLUMN ${colSQL};`);
      }
    }
    
    // Handle modified columns
    if (dialect === 'sqlite') {
      // SQLite has very limited ALTER TABLE support - column modifications require table recreation
      if (tableDiff.modifiedColumns.length > 0) {
        // SQLite table recreation pattern:
        // 1. Create new table with updated schema
        // 2. Copy data from old table (only matching columns)
        // 3. Drop old table
        // 4. Rename new table to original name
        // 5. Recreate indexes
        // 6. Recreate foreign keys (SQLite doesn't support FK constraints, but we document them)
        
        const tempTableName = `${tableName}_new`;
        
        // Step 1: Create new table with updated schema
        // Pass newSnapshot for FK validation
        const newTableSQL = generateCreateTableFromSnapshot(tempTableName, tableMetadata, dialect, { ifNotExists: false }, newSnapshot);
        statements.push(newTableSQL);
        
        // Step 2: Copy data from old table to new table
        // Get all column names that exist in both old and new schemas
        const oldTableMeta = oldSnapshot?.tables?.[tableName];
        const columnsToCopy: string[] = [];
        
        if (oldTableMeta) {
          // Find columns that exist in both old and new schemas
          for (const colName of Object.keys(tableMetadata.columns)) {
            if (oldTableMeta.columns[colName]) {
              columnsToCopy.push(colName);
            }
          }
        } else {
          // If we don't have old snapshot, copy all columns that aren't being modified
          // This is a fallback - ideally we'd have the old snapshot
          for (const colName of Object.keys(tableMetadata.columns)) {
            if (!tableDiff.modifiedColumns.some(mc => mc.columnName === colName)) {
              columnsToCopy.push(colName);
            }
          }
        }
        
        if (columnsToCopy.length > 0) {
          const columnList = columnsToCopy.map(c => `"${c}"`).join(', ');
          statements.push(`INSERT INTO "${tempTableName}" (${columnList}) SELECT ${columnList} FROM "${tableName}";`);
        } else {
          // No columns to copy - table might be empty or all columns are new
          statements.push(`-- No data to copy: all columns are new or modified`);
        }
        
        // Step 3: Drop old table
        statements.push(`DROP TABLE "${tableName}";`);
        
        // Step 4: Rename new table to original name
        statements.push(`ALTER TABLE "${tempTableName}" RENAME TO "${tableName}";`);
        
        // Step 5: Recreate indexes (they were dropped with the old table)
        if (tableMetadata.indexes && Array.isArray(tableMetadata.indexes) && tableMetadata.indexes.length > 0) {
          for (const idx of tableMetadata.indexes) {
            if (idx.name && idx.columns && idx.columns.length > 0) {
              // Validate index name before using it
              if (!/^[A-Za-z0-9_$]+$/.test(idx.name)) {
                const invalidChars = idx.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
                const uniqueInvalidChars = [...new Set(invalidChars)];
                throw new Error(
                  `Invalid index name "${idx.name}" in table "${tableName}": ` +
                  `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
                  `Index names must only contain alphanumeric characters, underscores, and dollar signs. ` +
                  `This index was extracted from the schema with an invalid name. ` +
                  `The index name must be fixed in the schema definition or database.`
                );
              }
              const indexColumns = idx.columns.map(name => `"${name}"`).join(', ');
              const uniqueClause = idx.unique ? 'UNIQUE ' : '';
              statements.push(`CREATE ${uniqueClause}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${indexColumns});`);
            }
          }
        }
        
        // Note: SQLite doesn't enforce foreign key constraints at the schema level
        // They're defined but not enforced unless PRAGMA foreign_keys is enabled
        // We document them in the CREATE TABLE but don't need to recreate them separately
      }
    } else {
      // PostgreSQL supports ALTER COLUMN
      for (const modifiedCol of tableDiff.modifiedColumns) {
        const col = tableMetadata.columns[modifiedCol.columnName];
        if (!col) {
          throw new Error(
            `Cannot generate migration for modified column "${modifiedCol.columnName}" in table "${tableName}": ` +
            `Column not found in table metadata.`
          );
        }
        
        // Track which changes we've handled (by the actual change string)
        const handledChangeStrings = new Set<string>();
        // Also track change types for validation
        const handledChangeTypes = new Set<string>();
        
        // Generate ALTER COLUMN statements for each change
        for (const change of modifiedCol.changes) {
          if (change.includes('type:') || change.includes('length:')) {
            // Type changes (including length changes) require ALTER COLUMN TYPE
            // Only generate one ALTER COLUMN TYPE statement per column, even if multiple type-related changes
            if (!handledChangeTypes.has('type')) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${col.type};`);
              handledChangeTypes.add('type');
            }
            handledChangeStrings.add(change);
            handledChangeTypes.add('length');
          } else if (change.includes('precision:') || change.includes('scale:')) {
            // Precision/scale changes also require ALTER COLUMN TYPE
            // Only generate one ALTER COLUMN TYPE statement per column
            if (!handledChangeTypes.has('type')) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${col.type};`);
              handledChangeTypes.add('type');
            }
            handledChangeStrings.add(change);
            handledChangeTypes.add('precision');
            handledChangeTypes.add('scale');
          } else if (change.includes('enumValues:')) {
            // Enum value changes require ALTER COLUMN TYPE (with CHECK constraint update)
            if (!handledChangeTypes.has('type')) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" TYPE ${col.type};`);
              handledChangeTypes.add('type');
            }
            // Also need to update CHECK constraint if enum values changed
            if (col.enumValues && Array.isArray(col.enumValues) && col.enumValues.length > 0) {
              const enumStr = col.enumValues.map((v: any) => `'${String(v).replace(/'/g, "''")}'`).join(',');
              // Generate constraint name and validate it
              const constraintName = `${tableName}_${col.name}_check`;
              // Validate constraint name - throw error if invalid
              if (!/^[A-Za-z0-9_$]+$/.test(constraintName)) {
                const invalidChars = constraintName.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
                const uniqueInvalidChars = [...new Set(invalidChars)];
                throw new Error(
                  `Invalid CHECK constraint name "${constraintName}" for table "${tableName}" column "${col.name}": ` +
                  `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
                  `Constraint names must only contain alphanumeric characters, underscores, and dollar signs. ` +
                  `This constraint name was generated from table name "${tableName}" and column name "${col.name}". ` +
                  `One of these names contains invalid characters.`
                );
              }
              statements.push(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}";`);
              statements.push(`ALTER TABLE "${tableName}" ADD CONSTRAINT "${constraintName}" CHECK ("${col.name}" IN (${enumStr}));`);
            }
            handledChangeStrings.add(change);
            handledChangeTypes.add('enumValues');
          } else if (change.includes('nullable:')) {
            if (col.nullable) {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" DROP NOT NULL;`);
            } else {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET NOT NULL;`);
            }
            handledChangeStrings.add(change);
            handledChangeTypes.add('nullable');
          } else if (change.includes('defaultValue:') || change.includes('hasDefault:')) {
            if (col.hasDefault && col.defaultValue !== undefined) {
              // Add DEFAULT
              const defaultValue = col.defaultValue;
              if (defaultValue && typeof defaultValue === 'object' && defaultValue.type === 'sql') {
                // SQL expression
                if (defaultValue.queryChunks && Array.isArray(defaultValue.queryChunks)) {
                  const sqlParts = defaultValue.queryChunks.map((chunk: any) => {
                    if (chunk.value) {
                      return Array.isArray(chunk.value) ? chunk.value.join(' ') : chunk.value;
                    }
                    return '';
                  }).filter((s: string) => s).join(' ');
                  if (sqlParts) {
                    statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET DEFAULT ${sqlParts};`);
                  } else {
                    throw new Error(
                      `Cannot generate migration for default value change in column "${col.name}" of table "${tableName}": ` +
                      `SQL expression has no valid query chunks.`
                    );
                  }
                } else {
                  throw new Error(
                    `Cannot generate migration for default value change in column "${col.name}" of table "${tableName}": ` +
                    `SQL expression default value is missing queryChunks.`
                  );
                }
              } else if (typeof defaultValue === 'string') {
                statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET DEFAULT '${defaultValue.replace(/'/g, "''")}';`);
              } else if (typeof defaultValue === 'number' || typeof defaultValue === 'boolean') {
                statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET DEFAULT ${defaultValue};`);
              } else if (defaultValue === null) {
                statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" SET DEFAULT NULL;`);
              } else {
                throw new Error(
                  `Cannot generate migration for default value change in column "${col.name}" of table "${tableName}": ` +
                  `Unsupported default value type: ${typeof defaultValue}. Value: ${JSON.stringify(defaultValue)}`
                );
              }
            } else {
              statements.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${col.name}" DROP DEFAULT;`);
            }
            handledChangeStrings.add(change);
            handledChangeTypes.add('defaultValue');
            handledChangeTypes.add('hasDefault');
          } else {
            // Unknown change type - throw error
            throw new Error(
              `Cannot generate migration for change in column "${modifiedCol.columnName}" of table "${tableName}": ` +
              `Unsupported change type: "${change}". ` +
              `All changes must be handled. If this is a new change type, it must be implemented in the migration generator.`
            );
          }
        }
        
        // Verify all changes were handled
        // Simply check if each change string was added to handledChangeStrings
        const unhandledChanges = modifiedCol.changes.filter(change => !handledChangeStrings.has(change));
        
        if (unhandledChanges.length > 0) {
          throw new Error(
            `Failed to handle all changes for column "${modifiedCol.columnName}" in table "${tableName}". ` +
            `Unhandled changes: ${unhandledChanges.join(', ')}. ` +
            `All changes: ${modifiedCol.changes.join(', ')}. ` +
            `Handled changes: ${Array.from(handledChangeStrings).join(', ')}.`
          );
        }
      }
    }
    
    // Handle removed foreign keys
    for (const fk of tableDiff.removedForeignKeys) {
      // PostgreSQL: Need constraint name to drop FK
      // For now, we'll use a generated name
      const constraintName = `fk_${tableName}_${fk.localColumns.join('_')}`;
      statements.push(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}";`);
    }
    
    // Handle added foreign keys
    for (const fk of tableDiff.addedForeignKeys) {
      const localColumns = fk.localColumns.map(name => `"${name}"`).join(', ');
      const refColumns = fk.refColumns.map(name => `"${name}"`).join(', ');
      if (localColumns && refColumns) {
        // Get onUpdate and onDelete from the snapshot's table metadata
        const tableMeta = newSnapshot.tables[tableName];
        const fullFk = tableMeta?.foreignKeys.find(f => 
          f.localColumns.length === fk.localColumns.length &&
          f.localColumns.every((col, i) => col === fk.localColumns[i]) &&
          f.refTable === fk.refTable &&
          f.refColumns.length === fk.refColumns.length &&
          f.refColumns.every((col, i) => col === fk.refColumns[i])
        );
        
        let fkSQL = `ALTER TABLE "${tableName}" ADD FOREIGN KEY (${localColumns}) REFERENCES "${fk.refTable}" (${refColumns})`;
        
        // Add ON UPDATE and ON DELETE if specified (normalize to uppercase for SQL)
        if (fullFk?.onUpdate) {
          const onUpdate = typeof fullFk.onUpdate === 'string' ? fullFk.onUpdate.toUpperCase() : fullFk.onUpdate;
          fkSQL += ` ON UPDATE ${onUpdate}`;
        }
        if (fullFk?.onDelete) {
          const onDelete = typeof fullFk.onDelete === 'string' ? fullFk.onDelete.toUpperCase() : fullFk.onDelete;
          fkSQL += ` ON DELETE ${onDelete}`;
        }
        
        statements.push(fkSQL + ';');
      }
    }
    
    // Handle removed unique constraints
    for (const unique of tableDiff.removedUniqueConstraints) {
      if (unique.name) {
        // Validate constraint name before using it
        if (!/^[A-Za-z0-9_$]+$/.test(unique.name)) {
          const invalidChars = unique.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
          const uniqueInvalidChars = [...new Set(invalidChars)];
          throw new Error(
            `Invalid unique constraint name "${unique.name}" in table "${tableName}": ` +
            `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
            `Constraint names must only contain alphanumeric characters, underscores, and dollar signs. ` +
            `This constraint was extracted from the schema with an invalid name. ` +
            `The constraint name must be fixed in the schema definition or database.`
          );
        }
        statements.push(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${unique.name}";`);
      } else {
        // Generate constraint name
        const constraintName = `uq_${tableName}_${unique.columns.join('_')}`;
        statements.push(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}";`);
      }
    }
    
    // Handle added unique constraints
    for (const unique of tableDiff.addedUniqueConstraints) {
      const uniqueColumns = unique.columns.map(name => `"${name}"`).join(', ');
      if (uniqueColumns) {
        if (unique.name) {
          // Validate constraint name before using it
          if (!/^[A-Za-z0-9_$]+$/.test(unique.name)) {
            const invalidChars = unique.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
            const uniqueInvalidChars = [...new Set(invalidChars)];
            throw new Error(
              `Invalid unique constraint name "${unique.name}" in table "${tableName}": ` +
              `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
              `Constraint names must only contain alphanumeric characters, underscores, and dollar signs. ` +
              `This constraint was extracted from the schema with an invalid name. ` +
              `The constraint name must be fixed in the schema definition or database.`
            );
          }
          statements.push(`ALTER TABLE "${tableName}" ADD CONSTRAINT "${unique.name}" UNIQUE (${uniqueColumns});`);
        } else {
          statements.push(`ALTER TABLE "${tableName}" ADD UNIQUE (${uniqueColumns});`);
        }
      }
    }
    
    // Handle removed indexes
    for (const idx of tableDiff.removedIndexes) {
      // Validate index name before using it
      if (!/^[A-Za-z0-9_$]+$/.test(idx.name)) {
        const invalidChars = idx.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
        const uniqueInvalidChars = [...new Set(invalidChars)];
        throw new Error(
          `Invalid index name "${idx.name}" in table "${tableName}": ` +
          `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
          `Index names must only contain alphanumeric characters, underscores, and dollar signs. ` +
          `This index was extracted from the schema with an invalid name. ` +
          `The index name must be fixed in the schema definition or database.`
        );
      }
      statements.push(`DROP INDEX IF EXISTS "${idx.name}";`);
    }
    
    // Handle added indexes
    for (const idx of tableDiff.addedIndexes) {
      // Validate index name before using it
      if (!/^[A-Za-z0-9_$]+$/.test(idx.name)) {
        const invalidChars = idx.name.split('').filter(c => !/^[A-Za-z0-9_$]$/.test(c));
        const uniqueInvalidChars = [...new Set(invalidChars)];
        throw new Error(
          `Invalid index name "${idx.name}" in table "${tableName}": ` +
          `contains invalid characters: ${uniqueInvalidChars.map(c => `"${c}"`).join(', ')}. ` +
          `Index names must only contain alphanumeric characters, underscores, and dollar signs. ` +
          `This index was extracted from the schema with an invalid name. ` +
          `The index name must be fixed in the schema definition or database.`
        );
      }
      const indexColumns = idx.columns.map(name => `"${name}"`).join(', ');
      if (indexColumns) {
        const uniqueClause = idx.unique ? 'UNIQUE ' : '';
        statements.push(`CREATE ${uniqueClause}INDEX "${idx.name}" ON "${tableName}" (${indexColumns});`);
      }
    }
  }
  
  // Verify that all detected changes resulted in SQL statements
  // Count expected statements based on diff
  let expectedStatements = 0;
  expectedStatements += diff.addedTables.length;
  expectedStatements += diff.removedTables.length;
  
  for (const tableDiff of diff.modifiedTables) {
    expectedStatements += tableDiff.addedColumns.length;
    expectedStatements += tableDiff.removedColumns.length;
    expectedStatements += tableDiff.modifiedColumns.length;
    expectedStatements += tableDiff.addedForeignKeys.length;
    expectedStatements += tableDiff.removedForeignKeys.length;
    expectedStatements += tableDiff.addedUniqueConstraints.length;
    expectedStatements += tableDiff.removedUniqueConstraints.length;
    expectedStatements += tableDiff.addedIndexes.length;
    expectedStatements += tableDiff.removedIndexes.length;
  }
  
  // If we have changes but no statements, that's an error
  if (expectedStatements > 0 && statements.length === 0) {
    throw new Error(
      `Migration generation failed: Detected ${expectedStatements} change(s) but generated 0 SQL statements. ` +
      `This indicates a bug in the migration generator. ` +
      `Diff summary: +${diff.addedTables.length} tables, -${diff.removedTables.length} tables, ` +
      `${diff.modifiedTables.length} modified tables. ` +
      `All changes MUST result in migration SQL or throw an error.`
    );
  }
  
  const sql = statements.join('\n');
  
  // Validate the generated migration SQL
  if (sql.trim()) {
    validateSQLOrThrow(sql, dialect, 'migration SQL generation');
  }
  
  return sql;
}

