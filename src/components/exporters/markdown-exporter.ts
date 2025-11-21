import { DataExporter, ExportData, ExportOptions, ExportResult } from './exporter.interface';

/**
 * Markdown table exporter
 */
export class MarkdownExporter implements DataExporter {
  readonly type = 'markdown';
  readonly displayName = 'Markdown';
  readonly description = 'Markdown table format';
  readonly extension = 'md';
  readonly mimeType = 'text/markdown;charset=utf-8;';

  canExport(data: ExportData): boolean {
    return data.columns.length > 0;
  }

  exportTable(data: ExportData, tableName: string, options?: ExportOptions): ExportResult | Promise<ExportResult> {
    const { columns, rows } = data;
    
    // Calculate column widths
    const headers = columns.map(col => col.label || col.name);
    const columnWidths: number[] = headers.map((header, idx) => {
      let maxWidth = header.length;
      for (const row of rows) {
        let valueStr: string;
        if (options?.formatted && options?.formatValue) {
          valueStr = options.formatValue(row[columns[idx].name], columns[idx].name);
        } else {
          const value = row[columns[idx].name];
          valueStr = value === null || value === undefined ? '' : String(value);
        }
        maxWidth = Math.max(maxWidth, valueStr.length);
      }
      return maxWidth;
    });
    
    // Build markdown table
    const markdownRows: string[] = [];
    
    // Header row
    const headerRow = '| ' + headers.map((header, idx) => {
      return header.padEnd(columnWidths[idx]);
    }).join(' | ') + ' |';
    markdownRows.push(headerRow);
    
    // Separator row
    const separatorRow = '|' + columnWidths.map(width => '-'.repeat(width + 2)).join('|') + '|';
    markdownRows.push(separatorRow);
    
    // Data rows
    for (const row of rows) {
      const dataRow = '| ' + columns.map((col, idx) => {
        let valueStr: string;
        if (options?.formatted && options?.formatValue) {
          valueStr = options.formatValue(row[col.name], col.name);
        } else {
          const value = row[col.name];
          valueStr = value === null || value === undefined ? '' : String(value);
        }
        return valueStr.padEnd(columnWidths[idx]);
      }).join(' | ') + ' |';
      markdownRows.push(dataRow);
    }
    
    const content = markdownRows.join('\n');
    
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

