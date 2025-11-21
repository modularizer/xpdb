/**
 * Export interface for data exporters
 */

export interface TableColumn {
  name: string;
  label?: string;
  dataType?: string;
  notNull?: boolean;
  defaultValue?: any;
}

export interface ExportData {
  columns: TableColumn[];
  rows: any[];
}

export interface ExportOptions {
  /** Whether to export formatted values (as displayed) or raw values */
  formatted?: boolean;
  /** Custom formatter function for cell values */
  formatValue?: (value: any, column: string) => string;
  /** Lookup data for foreign key columns */
  lookupData?: Map<string, Map<string | number, any>>;
}

export interface ExportResult {
  /** File name (without extension) */
  fileName: string;
  /** File content as string or Uint8Array */
  content: string | Uint8Array;
  /** MIME type */
  mimeType: string;
  /** File extension */
  extension: string;
}

/**
 * Interface that all exporters must implement
 */
export interface DataExporter {
  /** Unique identifier for this exporter type */
  readonly type: string;
  
  /** Display name shown in the UI */
  readonly displayName: string;
  
  /** Description shown in the UI */
  readonly description: string;
  
  /** File extension for this export format */
  readonly extension: string;
  
  /** MIME type for this export format */
  readonly mimeType: string;
  
  /**
   * Export a single table
   * @param data - Table data to export
   * @param tableName - Name of the table
   * @param options - Export options
   * @returns Export result with file content
   */
  exportTable(data: ExportData, tableName: string, options?: ExportOptions): ExportResult;
  
  /**
   * Export multiple tables
   * @param tables - Map of table names to their data
   * @param options - Export options
   * @returns Export results (one per table, or single combined file)
   */
  exportTables(tables: Map<string, ExportData>, options?: ExportOptions): ExportResult[] | Promise<ExportResult[]>;
  
  /**
   * Check if this exporter can handle the export
   * @param data - Data to check
   * @returns True if this exporter can handle the data
   */
  canExport(data: ExportData): boolean;
}

