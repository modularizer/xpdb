import { DataExporter, ExportData, ExportOptions, ExportResult } from './exporter.interface';

/**
 * CSV exporter
 */
export class CsvExporter implements DataExporter {
  readonly type = 'csv';
  readonly displayName = 'CSV';
  readonly description = 'Comma-separated values format';
  readonly extension = 'csv';
  readonly mimeType = 'text/csv;charset=utf-8;';

  canExport(data: ExportData): boolean {
    return data.columns.length > 0;
  }

  exportTable(data: ExportData, tableName: string, options?: ExportOptions): ExportResult | Promise<ExportResult> {
    const { columns, rows } = data;
    
    // Create CSV header
    const headers = columns.map(col => {
      const header = col.label || col.name;
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (header.includes(',') || header.includes('"') || header.includes('\n')) {
        return `"${header.replace(/"/g, '""')}"`;
      }
      return header;
    });
    
    // Create CSV rows
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      const values = columns.map(col => {
        let str: string;
        
        if (options?.formatted && options?.formatValue) {
          str = options.formatValue(row[col.name], col.name);
        } else {
          const value = row[col.name];
          str = value === null || value === undefined ? '' : String(value);
        }
        
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(values.join(','));
    }
    
    const content = csvRows.join('\n');
    
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

