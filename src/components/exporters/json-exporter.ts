import { DataExporter, ExportData, ExportOptions, ExportResult } from './exporter.interface';

/**
 * JSON exporter
 */
export class JsonExporter implements DataExporter {
  readonly type = 'json';
  readonly displayName = 'JSON';
  readonly description = 'JSON array format';
  readonly extension = 'json';
  readonly mimeType = 'application/json;charset=utf-8;';

  canExport(data: ExportData): boolean {
    return true;
  }

  exportTable(data: ExportData, tableName: string, options?: ExportOptions): ExportResult | Promise<ExportResult> {
    const { columns, rows } = data;
    
    const jsonData = rows.map(row => {
      const obj: Record<string, any> = {};
      for (const col of columns) {
        let value = row[col.name];
        
        // For formatted export, try to preserve types from formatted strings
        if (options?.formatted && options?.formatValue) {
          const formattedStr = options.formatValue(value, col.name);
          // Try to parse numbers if they look like numbers
          const numValue = parseFloat(formattedStr);
          if (!isNaN(numValue) && formattedStr.trim() === String(numValue)) {
            obj[col.name] = numValue;
          } else if (formattedStr === 'true' || formattedStr === 'false') {
            obj[col.name] = formattedStr === 'true';
          } else if (formattedStr === '') {
            obj[col.name] = null;
          } else {
            obj[col.name] = formattedStr;
          }
        } else {
          // For raw export, use original value
          obj[col.name] = value;
        }
      }
      return obj;
    });
    
    const content = JSON.stringify(jsonData, null, 2);
    
    return {
      fileName: tableName,
      content,
      mimeType: this.mimeType,
      extension: this.extension,
    };
  }

  exportTables(tables: Map<string, ExportData>, options?: ExportOptions): ExportResult[] {
    const results: ExportResult[] = [];
    
    for (const [tableName, data] of tables.entries()) {
      results.push(this.exportTable(data, tableName, options));
    }
    
    return results;
  }
}

