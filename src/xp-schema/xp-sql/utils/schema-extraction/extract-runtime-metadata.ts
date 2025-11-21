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
 * Parse a column default value from the database's column_default string
 * Converts it to the same format as extractColumnMetadata produces
 * 
 * PostgreSQL column_default examples:
 * - 'CURRENT_TIMESTAMP'::timestamp without time zone
 * - 'scheduled'::character varying
 * - '0'::integer
 * - 0
 * - gen_random_uuid()
 * 
 * SQLite dflt_value examples:
 * - CURRENT_TIMESTAMP
 * - (strftime('%s','now'))
 * - 'scheduled'
 * - 0
 */
function parseColumnDefault(
  columnDefault: string | null | undefined,
  dialect: SQLDialect
): any {
  if (!columnDefault || columnDefault === null || columnDefault === undefined) {
    return undefined;
  }

  let defaultStr = String(columnDefault).trim();

  // Empty string means no default
  if (defaultStr === '') {
    return undefined;
  }

  // Remove PostgreSQL type cast (e.g., '::timestamp without time zone', '::character varying')
  // This handles cases like: 'CURRENT_TIMESTAMP'::timestamp or 'scheduled'::varchar
  const typeCastMatch = defaultStr.match(/^(.+)::[\w\s]+$/);
  if (typeCastMatch) {
    defaultStr = typeCastMatch[1].trim();
  }

  // SQL expressions (functions, CURRENT_TIMESTAMP, etc.)
  const sqlExpressions = [
    'CURRENT_TIMESTAMP',
    'CURRENT_TIME',
    'CURRENT_DATE',
    'NOW()',
    'LOCALTIME',
    'LOCALTIMESTAMP',
    'gen_random_uuid()',
    'uuid_generate_v4()',
  ];

  // Check if it's a quoted value first
  let isQuoted = false;
  let unquotedValue = defaultStr;
  if ((defaultStr.startsWith("'") && defaultStr.endsWith("'")) ||
      (defaultStr.startsWith('"') && defaultStr.endsWith('"'))) {
    isQuoted = true;
    unquotedValue = defaultStr.slice(1, -1);
  }

  // Check if the unquoted value is a SQL expression keyword
  // PostgreSQL sometimes quotes SQL expressions like 'CURRENT_TIMESTAMP'
  const isSQLExpressionKeyword = sqlExpressions.some(expr => 
    unquotedValue.toUpperCase() === expr.toUpperCase()
  );

  // Check if it's a SQL expression (function call, keyword, or SQLite datetime functions)
  const isSQLExpression = isSQLExpressionKeyword
    || /^[A-Z_][A-Z0-9_]*\(\)$/i.test(defaultStr)
    || defaultStr.includes('strftime')
    || defaultStr.includes('datetime(')
    || (defaultStr.startsWith('(') && defaultStr.endsWith(')') && 
        (defaultStr.includes('strftime') || defaultStr.includes('datetime')));

  if (isSQLExpression) {
    // Extract the SQL expression (remove parentheses if it's wrapped, remove quotes if present)
    let sqlExpr = isQuoted ? unquotedValue : defaultStr;
    if (sqlExpr.startsWith('(') && sqlExpr.endsWith(')')) {
      sqlExpr = sqlExpr.slice(1, -1).trim();
    }
    // Return in the same format as extractColumnMetadata for SQL expressions
    return {
      type: 'sql',
      queryChunks: [{ value: [sqlExpr] }],
    };
  }

  // If it's quoted, it's a string literal
  if (isQuoted) {
    // Unescape single quotes (PostgreSQL uses '' for escaped quotes)
    const unescaped = unquotedValue.replace(/''/g, "'");
    return unescaped;
  }

  // Check if it's a number
  if (/^-?\d+$/.test(defaultStr)) {
    return parseInt(defaultStr, 10);
  }

  // Check if it's a decimal number
  if (/^-?\d+\.\d+$/.test(defaultStr)) {
    return parseFloat(defaultStr);
  }

  // Check if it's a boolean
  if (defaultStr.toLowerCase() === 'true') {
    return true;
  }
  if (defaultStr.toLowerCase() === 'false') {
    return false;
  }

  // Check if it's NULL
  if (defaultStr.toUpperCase() === 'NULL') {
    return null;
  }

  // Default: return as string
  return defaultStr;
}

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
  
  // Get column information with defaults from information_schema
  // This is needed because getRuntimeTable doesn't preserve default information
  const columns = await dialect.getTableColumns(db, tableName, schemaName);
  
  // Update hasDefault and defaultValue for columns that have defaults in the database
  for (const colInfo of columns) {
    if (colInfo.columnDefault !== null && colInfo.columnDefault !== undefined) {
      const colName = colInfo.name;
      if (metadata.columns[colName]) {
        // Column has a default in the database
        metadata.columns[colName].hasDefault = true;
        // Parse the default value from the database string representation
        const parsedDefault = parseColumnDefault(colInfo.columnDefault, dialect);
        if (parsedDefault !== undefined) {
          metadata.columns[colName].defaultValue = parsedDefault;
        }
      }
    }
  }
  
  // Get additional metadata using introspection methods
  // Check if getTableCheckConstraints is available (optional method)
  const checkConstraintsPromise = (dialect as any).getTableCheckConstraints
    ? (dialect as any).getTableCheckConstraints(db, tableName, schemaName)
    : Promise.resolve([]);
  
  const [primaryKeys, foreignKeys, uniqueConstraints, indexes, checkConstraints] = await Promise.all([
    dialect.getTablePrimaryKeys(db, tableName, schemaName),
    dialect.getTableForeignKeys(db, tableName, schemaName),
    dialect.getTableUniqueConstraints(db, tableName, schemaName),
    dialect.getTableIndexes(db, tableName, schemaName),
    checkConstraintsPromise,
  ]);
  
  // Extract enum values from CHECK constraints
  // Note: checkExpression from information_schema contains just the expression, not "CHECK (...)"
  // PostgreSQL can store enum constraints in two formats:
  // 1. Simple IN: "column_name" IN ('val1', 'val2', ...) or column_name IN ('val1', 'val2', ...)
  // 2. ANY with ARRAY: (("column_name")::text = ANY ((ARRAY['val1'::character varying, 'val2'::character varying, ...])::text[]))
  for (const checkConstraint of checkConstraints as Array<{ name: string; columnName: string; checkExpression: string }>) {
    const colName = checkConstraint.columnName;
    
    if (metadata.columns[colName]) {
      const trimmedExpression = checkConstraint.checkExpression.trim();
      let enumValues: string[] | null = null;
      
      // Try pattern 1: IN format
      const inPattern = /^\(*\s*"?\w+"?\s*\)*\s+IN\s*\(([^)]+)\)\s*$/i;
      let match = trimmedExpression.match(inPattern);
      
      if (match) {
        const valuesStr = match[1];
        // Extract enum values from IN format
        enumValues = valuesStr
          .split(',')
          .map(v => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
          .filter(v => v.length > 0);
      } else {
        // Try pattern 2: ANY with ARRAY format
        // Pattern: (("column_name")::text = ANY ((ARRAY['val1'::character varying, 'val2'::character varying, ...])::text[]))
        const anyPattern = /\(*\s*\(*"?\w+"?\)*\s*::\s*text\s*=\s*ANY\s*\(\(ARRAY\[([^\]]+)\]\)/i;
        match = trimmedExpression.match(anyPattern);
        
        if (match) {
          const arrayContent = match[1];
          
          // Extract enum values from ARRAY format
          // Values are like: 'val1'::character varying, 'val2'::character varying, ...
          enumValues = arrayContent
            .split(',')
            .map(v => {
              let cleaned = v.trim();
              // Remove type cast (::character varying, ::text, ::text[], etc.)
              // Match :: followed by type name (can contain spaces like "character varying") and optional []
              // Pattern: ::text, ::character varying, ::text[], etc.
              cleaned = cleaned.replace(/::\s*(?:character\s+varying|text|integer|bigint|smallint|numeric|decimal|real|double\s+precision|boolean|bool|date|time|timestamp|json|jsonb|uuid|bytea)(\[\])?/gi, '');
              // If the above didn't match, try a more general pattern
              if (cleaned.includes('::')) {
                // Match :: followed by any identifier (word chars, spaces) and optional []
                cleaned = cleaned.replace(/::\s*[a-zA-Z_][a-zA-Z0-9_\s]*(\[\])?/g, '');
              }
              // Remove quotes (handle both single and double quotes)
              cleaned = cleaned.replace(/^['"]|['"]$/g, '').replace(/''/g, "'");
              return cleaned.trim();
            })
            .filter(v => v.length > 0);
        }
      }
      
      if (enumValues && enumValues.length > 0) {
        // Sort for consistent comparison
        enumValues.sort();
        metadata.columns[colName].enumValues = enumValues as readonly string[];
      }
    }
  }
  
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
      // Even if extraction fails, add a minimal entry so we know the table exists
      // This prevents createOrMigrate from trying to recreate existing tables
      metadata[tableName] = {
        name: tableName,
        columns: {},
        primaryKeys: [],
        foreignKeys: [],
        uniqueConstraints: [],
        indexes: [],
      };
    }
  }
  
  return metadata;
}

