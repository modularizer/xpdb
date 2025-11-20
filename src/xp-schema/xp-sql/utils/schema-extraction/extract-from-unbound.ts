/**
 * Extract table metadata from unbound tables
 * 
 * This extracts the completely dialect-agnostic structure from UTable.
 * No SQL-specific interpretation, no dialect-specific logic.
 * This is Step 1: Build dialect-agnostic schema from unbound tables.
 */

import type { UTable } from '../dialects/implementations/unbound';
import type { DialectAgnosticColumnMetadata, DialectAgnosticTableMetadata } from './dialect-agnostic-schema';
import type { ForeignKeyAction } from '../../dialects/types';

/**
 * Extract column metadata from unbound column data
 * 
 * This is completely dialect-agnostic - it only extracts raw data from ColData.
 * Returns abstract column type information, not SQL-specific strings.
 */
function extractColumnMetadataFromUnbound(
  colData: any,
  columnName: string
): DialectAgnosticColumnMetadata {
  // Extract abstract column type from ColData.type (e.g., 'varchar', 'text', 'integer')
  const columnType = colData.type || 'text';
  
  // Extract options (length, precision, scale, enum)
  const options: DialectAgnosticColumnMetadata['options'] = {};
  if (colData.options) {
    if (colData.options.length !== undefined) options.length = colData.options.length;
    if (colData.options.precision !== undefined) options.precision = colData.options.precision;
    if (colData.options.scale !== undefined) options.scale = colData.options.scale;
    if (colData.options.enum) options.enum = colData.options.enum;
  }
  
  // Extract basic column info from ColData
  // Check if column is a primary key - primary keys are always NOT NULL
  const isPrimaryKey = colData.modifiers?.some((m: any) => m.method === 'primaryKey') || false;
  const nullable = isPrimaryKey ? false : !colData.modifiers?.some((m: any) => m.method === 'notNull');
  const hasDefaultModifier = colData.modifiers?.some((m: any) => m.method === 'default' || m.method === 'defaultNow') || false;
  
  // Extract default value if present - store raw data, no interpretation
  let defaultValue: any = undefined;
  let hasDefault = false;
  
  if (hasDefaultModifier) {
    const defaultModifier = colData.modifiers?.find((m: any) => m.method === 'default' || m.method === 'defaultNow');
    if (defaultModifier) {
      if (defaultModifier.method === 'defaultNow') {
        // Store as a marker that defaultNow was called - dialect will interpret this
        defaultValue = { method: 'defaultNow' };
        hasDefault = true;
      } else if (defaultModifier.args && defaultModifier.args.length > 0) {
        const defaultArg = defaultModifier.args[0];
        // Store the raw argument - dialect will determine if it's SQL, function, or literal
        defaultValue = defaultArg;
        // We can't determine here if it's database-level or application-level
        // The dialect merger will determine this
        hasDefault = true;
      }
    }
  }
  
  return {
    name: columnName,
    columnType,
    options: Object.keys(options).length > 0 ? options : undefined,
    nullable,
    hasDefault,
    defaultValue,
  };
}

/**
 * Extract foreign key from unbound column's reference modifier
 */
import type { ForeignKeyAction } from '../../dialects/types';

function extractForeignKeyFromUnbound(
  columnName: string,
  refModifier: { method: string; args: any[] },
  unboundTable: UTable<any>,
  allUnboundTables?: Record<string, UTable<any>>
): { 
  localColumns: string[]; 
  refTable: string; 
  refColumns: string[];
  onDelete?: ForeignKeyAction;
  onUpdate?: ForeignKeyAction;
} {
  if (refModifier.method !== 'references' || !refModifier.args || refModifier.args.length === 0) {
    throw new Error(
      `Invalid references modifier on column "${columnName}" in table "${unboundTable.__name}": ` +
      `expected a function argument but got ${refModifier.args?.length || 0} arguments`
    );
  }
  
  try {
    // Call the reference function to get the referenced column
    const refFn = refModifier.args[0];
    if (typeof refFn !== 'function') {
      throw new Error(
        `Invalid references modifier on column "${columnName}" in table "${unboundTable.__name}": ` +
        `expected a function but got ${typeof refFn}`
      );
    }
    
    const refCol = refFn();
    if (!refCol) {
      throw new Error(
        `Invalid references modifier on column "${columnName}" in table "${unboundTable.__name}": ` +
        `reference function returned null or undefined`
      );
    }
    
    // Get the referenced column's data
    let refColData: any;
    if ((refCol as any).__unbound || typeof (refCol as any).getData === 'function') {
      // It's a UColumn or ColData
      refColData = (refCol as any).data || ((refCol as any).getData ? (refCol as any).getData() : refCol);
    } else {
      // Might be a ColumnBuilder - try to extract name
      refColData = {
        name: (refCol as any).name || (refCol as any).data?.name || '',
      };
    }
    
    if (!refColData || !refColData.name) {
      throw new Error(
        `Invalid references modifier on column "${columnName}" in table "${unboundTable.__name}": ` +
        `could not extract column name from referenced column`
      );
    }
    
    // Get the referenced column name
    const refColumnName = refColData.name;
    
    // Get the referenced table name
    // When a column is referenced like `usersTable.id`, the column is a property of the usersTable object
    // We need to find which table contains this column by searching through all tables
    let refTable = '';
    
    if (allUnboundTables) {
      // Search through all tables to find which one has this column
      for (const [tableName, table] of Object.entries(allUnboundTables)) {
        // Check if the column is a property of this table
        // Columns are exposed as properties on the table object
        if ((table as any)[refColumnName] === refCol || 
            (table as any).columns?.[refColumnName] === refCol ||
            (table as any).columns?.[refColumnName]?.name === refColumnName) {
          refTable = tableName;
          break;
        }
        
        // Also check if the column data matches
        const tableColData = (table as any).columns?.[refColumnName];
        if (tableColData && tableColData.name === refColumnName) {
          // Check if it's the same column by comparing the data structure
          if (tableColData === refColData || 
              (tableColData.type === refColData.type && tableColData.name === refColData.name)) {
            refTable = tableName;
            break;
          }
        }
      }
    }
    
    // Try to get from column's metadata if available
    if (!refTable) {
      if ((refCol as any).__table) {
        refTable = (refCol as any).__table.__name || '';
      } else if ((refCol as any).table) {
        refTable = (refCol as any).table.__name || '';
      }
    }
    
    if (!refTable) {
      throw new Error(
        `Failed to resolve foreign key reference: Column "${columnName}" in table "${unboundTable.__name}" ` +
        `references a column "${refColumnName}" but could not determine which table it belongs to. ` +
        `Make sure the referenced column is from a table in the same schema.`
      );
    }
    
    // Extract FK options from the second argument if present
    const fkOptions = refModifier.args.length > 1 && refModifier.args[1] 
      ? refModifier.args[1] 
      : undefined;
    
    const result: {
      localColumns: string[];
      refTable: string;
      refColumns: string[];
      onDelete?: ForeignKeyAction;
      onUpdate?: ForeignKeyAction;
    } = {
      localColumns: [columnName],
      refTable,
      refColumns: [refColumnName],
    };
    
    if (fkOptions && typeof fkOptions === 'object') {
      if (fkOptions.onDelete) {
        // Normalize to uppercase to match SQL standard, but accept both cases
        const onDelete = typeof fkOptions.onDelete === 'string' 
          ? fkOptions.onDelete.toUpperCase() as ForeignKeyAction
          : fkOptions.onDelete;
        // Validate it's a valid action (accept both cases)
        const validActions: string[] = ['CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION', 
                                        'cascade', 'restrict', 'set null', 'set default', 'no action'];
        if (validActions.includes(onDelete as string)) {
          // Store as uppercase for SQL generation
          result.onDelete = (typeof onDelete === 'string' ? onDelete.toUpperCase() : onDelete) as ForeignKeyAction;
        }
      }
      if (fkOptions.onUpdate) {
        // Normalize to uppercase to match SQL standard, but accept both cases
        const onUpdate = typeof fkOptions.onUpdate === 'string' 
          ? fkOptions.onUpdate.toUpperCase() as ForeignKeyAction
          : fkOptions.onUpdate;
        // Validate it's a valid action (accept both cases)
        const validActions: string[] = ['CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION',
                                        'cascade', 'restrict', 'set null', 'set default', 'no action'];
        if (validActions.includes(onUpdate as string)) {
          // Store as uppercase for SQL generation
          result.onUpdate = (typeof onUpdate === 'string' ? onUpdate.toUpperCase() : onUpdate) as ForeignKeyAction;
        }
      }
    }
    
    return result;
  } catch (e) {
    // If we can't resolve the reference, throw an error
    throw new Error(
      `Failed to extract foreign key from column "${columnName}" in table "${unboundTable.__name}": ` +
      (e instanceof Error ? e.message : String(e))
    );
  }
}

/**
 * Extract table metadata from an unbound table
 * Returns completely dialect-agnostic metadata (Step 1 of the architecture)
 * 
 * @param unboundTable - The unbound table to extract metadata from
 * @param allUnboundTables - All unbound tables in the schema (for resolving foreign key references)
 */
export function extractTableMetadataFromUnbound(
  unboundTable: UTable<any>,
  allUnboundTables?: Record<string, UTable<any>>
): DialectAgnosticTableMetadata {
  const tableName = unboundTable.__name;
  const columns: Record<string, DialectAgnosticColumnMetadata> = {};
  const primaryKeys: string[] = [];
  const foreignKeys: Array<{ localColumns: string[]; refTable: string; refColumns: string[] }> = [];
  const uniqueConstraints: Array<{ name?: string; columns: string[] }> = [];
  
  // Extract column metadata
  for (const [colKey, colData] of Object.entries(unboundTable.columns)) {
    if (!colData || typeof colData !== 'object') continue;
    
    const columnName = colData.name || colKey;
    if (!columnName) continue;
    
    // Extract basic column metadata
    const colMeta = extractColumnMetadataFromUnbound(colData, columnName);
    columns[columnName] = colMeta;
    
    // Check for primary key
    if (colData.modifiers?.some((m: any) => m.method === 'primaryKey')) {
      primaryKeys.push(columnName);
    }
    
    // Check for unique constraint
    if (colData.modifiers?.some((m: any) => m.method === 'unique')) {
      uniqueConstraints.push({
        columns: [columnName],
      });
    }
    
    // Check for foreign key reference
    const refModifier = colData.modifiers?.find((m: any) => m.method === 'references');
    if (refModifier) {
      // extractForeignKeyFromUnbound will throw an error if it fails
      const fk = extractForeignKeyFromUnbound(columnName, refModifier, unboundTable, allUnboundTables);
      foreignKeys.push(fk);
    }
  }
  
  // Extract indexes from constraints callback
  const indexes: Array<{ name: string; columns: string[]; unique: boolean }> = [];
  if (unboundTable.constraints) {
    try {
      const constraints = unboundTable.constraints(unboundTable);
      for (const constraint of constraints) {
        if (constraint && typeof constraint === 'object') {
          // Check if it's a UIndex (unbound index)
          // UIndex has getData() method that returns UIndexData with __type: 'index'
          let indexData: any = null;
          if (typeof (constraint as any).getData === 'function') {
            const data = (constraint as any).getData();
            if (data && data.__unbound === true && data.__type === 'index') {
              indexData = data;
            }
          } else if ((constraint as any).__unbound === true && (constraint as any).__type === 'index') {
            // Direct UIndexData object
            indexData = constraint;
          }
          
          if (indexData) {
            const indexName = indexData.name || '';
            const indexColumns = indexData.columns || [];
            
            // Extract column names from column references
            const columnNames: string[] = [];
            for (const colRef of indexColumns) {
              if (typeof colRef === 'string') {
                columnNames.push(colRef);
              } else if (typeof colRef === 'function') {
                // Column reference function - call it to get the column
                try {
                  const col = colRef();
                  if (col && typeof col === 'object') {
                    const colName = col.name || col.data?.name || (col.getData ? col.getData().name : '');
                    if (colName) columnNames.push(colName);
                  }
                } catch (e) {
                  // Skip if function call fails
                }
              } else if (colRef && typeof colRef === 'object') {
                // Column object - extract name
                const colName = colRef.name || colRef.data?.name || (colRef.getData ? colRef.getData().name : '');
                if (colName) columnNames.push(colName);
              }
            }
            
            if (indexName && columnNames.length > 0) {
              indexes.push({
                name: indexName,
                columns: columnNames,
                unique: false, // UIndex doesn't have unique property, only UUnique does
              });
            }
          }
        }
      }
    } catch (e) {
      // Constraints callback might fail, skip
    }
  }
  
  return {
    name: tableName,
    columns,
    primaryKeys: primaryKeys.sort(),
    foreignKeys,
    uniqueConstraints,
    indexes,
  };
}


