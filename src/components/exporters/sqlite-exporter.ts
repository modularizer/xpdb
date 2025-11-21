import { Platform } from 'react-native';
import { DataExporter, ExportData, ExportOptions, ExportResult } from './exporter.interface';

/**
 * SQLite database exporter
 * 
 * Note: Only available on web platform (uses sql.js which requires WebAssembly)
 */
export class SqliteExporter implements DataExporter {
  readonly type = 'sqlite';
  readonly displayName = 'SQLite';
  readonly description = 'SQLite database file (Web only)';
  readonly extension = 'sqlite';
  readonly mimeType = 'application/x-sqlite3';

  canExport(data: ExportData): boolean {
    // Only available on web
    if (Platform.OS !== 'web') {
      return false;
    }
    return data.columns.length > 0;
  }

  async exportTable(data: ExportData, tableName: string, options?: ExportOptions): Promise<ExportResult> {
    // SQLite export requires multiple tables, so this is a no-op
    // The actual export happens in exportTables
    throw new Error('SQLite export requires multiple tables. Use exportTables() instead.');
  }

  async exportTables(tables: Map<string, ExportData>, options?: ExportOptions): Promise<ExportResult[]> {
    // Only available on web
    if (Platform.OS !== 'web') {
      throw new Error('SQLite export is only available on web platform');
    }

    // Dynamic import for sql.js - only on web
    let initSqlJs: any;
    try {
      // @ts-ignore - sql.js types may not be available
      initSqlJs = (await import('sql.js')).default;
    } catch (err) {
      throw new Error('sql.js library is required for SQLite export. Please install it: npm install sql.js');
    }
    
    const SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`
    });
    
    const sqliteDb = new SQL.Database();
    
    try {
      // Export each table
      for (const [tableName, data] of tables.entries()) {
        const { columns, rows } = data;
        
        // Create table in SQLite
        const columnDefs = columns.map(col => {
          const colName = col.name;
          let sqliteType = 'TEXT';
          
          // Map database types to SQLite types
          const dbType = (col.dataType || '').toLowerCase();
          if (dbType.includes('int') || dbType === 'serial' || dbType === 'bigserial') {
            sqliteType = 'INTEGER';
          } else if (dbType.includes('real') || dbType.includes('double') || dbType.includes('float') || dbType === 'numeric' || dbType === 'decimal') {
            sqliteType = 'REAL';
          } else if (dbType === 'blob' || dbType === 'bytea') {
            sqliteType = 'BLOB';
          }
          
          let def = `"${colName}" ${sqliteType}`;
          if (col.notNull) {
            def += ' NOT NULL';
          }
          if (col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${col.defaultValue}`;
          }
          return def;
        });
        
        const createTableSQL = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs.join(', ')})`;
        sqliteDb.run(createTableSQL);
        
        // Insert data
        if (rows.length > 0) {
          const placeholders = columns.map(() => '?').join(', ');
          const insertSQL = `INSERT INTO "${tableName}" (${columns.map(c => `"${c.name}"`).join(', ')}) VALUES (${placeholders})`;
          
          const stmt = sqliteDb.prepare(insertSQL);
          for (const row of rows) {
            const values = columns.map(col => {
              let value = row[col.name];
              
              // For formatted export, we need to parse the formatted string back to original type
              if (options?.formatted && options?.formatValue) {
                // This is tricky - we can't reliably reverse formatted values
                // So for SQLite export, we should use raw values
                value = row[col.name];
              }
              
              if (value === null || value === undefined) {
                return null;
              }
              
              // Convert to appropriate type for SQLite
              const dbType = (col.dataType || '').toLowerCase();
              if (dbType.includes('int') || dbType === 'serial' || dbType === 'bigserial') {
                return parseInt(String(value), 10);
              } else if (dbType.includes('real') || dbType.includes('double') || dbType.includes('float') || dbType === 'numeric' || dbType === 'decimal') {
                return parseFloat(String(value));
              } else if (dbType === 'blob' || dbType === 'bytea') {
                return new Uint8Array(value);
              } else if (typeof value === 'object') {
                return JSON.stringify(value);
              }
              return String(value);
            });
            stmt.run(values);
          }
          stmt.free();
        }
      }
      
      // Export SQLite database as binary data
      const data = sqliteDb.export();
      
      // sql.js returns Uint8Array directly, no need for Buffer conversion
      // @ts-ignore - sql.js returns Uint8Array
      const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
      
      sqliteDb.close();
      
      return [{
        fileName: 'database',
        content: uint8Array,
        mimeType: this.mimeType,
        extension: this.extension,
      }];
    } catch (err) {
      sqliteDb.close();
      throw err;
    }
  }
}

