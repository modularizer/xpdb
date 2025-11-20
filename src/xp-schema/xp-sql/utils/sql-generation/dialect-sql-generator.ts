/**
 * Abstract base class for dialect-specific SQL generation
 * 
 * Each dialect (SQLite, PostgreSQL, etc.) should have its own implementation
 * that handles type mapping and SQL syntax differences.
 */

import { Table, getTableName } from 'drizzle-orm';

/**
 * Abstract class for generating SQL from Drizzle table configs
 */
export abstract class DialectSQLGenerator {
  /**
   * Get the SQL type name for a column based on its metadata
   */
  abstract getColumnType(column: any): string;
  
  /**
   * Generate a column definition SQL string
   */
  generateColumnSQL(column: any): string {
    const name = column.name || '';
    const columnType = column.columnType || '';
    const dataType = column.dataType || '';
    const notNull = column.notNull === true;
    const hasDefault = column.hasDefault === true;
    const primary = column.primary === true;
    const isUnique = column.isUnique === true;
    const defaultFn = column.default;
    
    // Get the SQL type for this column
    const sqlType = this.getColumnType(column);
    
    // Build column definition
    let def = `"${name}" ${sqlType}`;
    
    // Add PRIMARY KEY inline if this column is a primary key
    if (primary) {
      def += ' PRIMARY KEY';
    }
    
    // Add UNIQUE inline if this column is unique
    if (isUnique) {
      def += ' UNIQUE';
    }
    
    if (notNull) {
      def += ' NOT NULL';
    }
    
    if (hasDefault && defaultFn !== undefined) {
      // Skip function defaults - they're handled at application level
      // Only include literal defaults
      if (typeof defaultFn !== 'function') {
        if (typeof defaultFn === 'string') {
          def += ` DEFAULT '${defaultFn.replace(/'/g, "''")}'`;
        } else if (typeof defaultFn === 'number' || typeof defaultFn === 'boolean') {
          def += ` DEFAULT ${defaultFn}`;
        }
        // Skip objects and other types
      }
    }
    
    return def;
  }
  
  /**
   * Generate CREATE TABLE SQL statement
   */
  generateCreateTableSQL(
    tableName: string,
    columnDefs: string[],
    options: { ifNotExists?: boolean; schema?: string } = {}
  ): string {
    const ifNotExists = options.ifNotExists !== false ? 'IF NOT EXISTS ' : '';
    const schemaPrefix = options.schema ? `"${options.schema}".` : '';
    
    return `CREATE TABLE ${ifNotExists}${schemaPrefix}"${tableName}" (\n\t${columnDefs.join(',\n\t')}\n);`;
  }
}

/**
 * SQLite SQL Generator
 */
export class SQLiteSQLGenerator extends DialectSQLGenerator {
  getColumnType(column: any): string {
    const columnType = column.columnType || '';
    const dataType = column.dataType || '';
    
    if (columnType === 'SQLiteText') {
      // SQLite doesn't support length on TEXT, just use TEXT
      return 'TEXT';
    } else if (columnType === 'SQLiteTimestamp') {
      return 'INTEGER';
    } else if (columnType === 'SQLiteInteger') {
      return 'INTEGER';
    } else {
      // Fallback to dataType
      if (dataType === 'string') {
        return 'TEXT';
      } else if (dataType === 'number') {
        return 'INTEGER';
      } else {
        return dataType ? dataType.toUpperCase() : 'TEXT';
      }
    }
  }
}

/**
 * PostgreSQL SQL Generator
 */
export class PostgreSQLSQLGenerator extends DialectSQLGenerator {
  getColumnType(column: any): string {
    const columnType = column.columnType || '';
    const dataType = column.dataType || '';
    const length = column.length;
    
    if (columnType === 'PgText') {
      return length ? `VARCHAR(${length})` : 'TEXT';
    } else if (columnType === 'PgVarchar') {
      return length ? `VARCHAR(${length})` : 'VARCHAR';
    } else if (columnType === 'PgTimestamp') {
      return 'TIMESTAMP';
    } else if (columnType === 'PgInteger') {
      return 'INTEGER';
    } else {
      // Fallback to dataType
      if (dataType === 'string') {
        return 'TEXT';
      } else if (dataType === 'number') {
        return 'INTEGER';
      } else {
        return dataType ? dataType.toUpperCase() : 'TEXT';
      }
    }
  }
}

