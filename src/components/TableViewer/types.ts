/**
 * Type definitions for TableViewer component
 */

export interface TableViewerColumn {
  name: string;
  label?: string;
  dataType?: string;
}

export interface TableViewerRow {
  id: string;
  [key: string]: any;
}

export interface ForeignKeyInfo {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export interface FKLookupColumn {
  fk: ForeignKeyInfo;
  lookupColumn: string;
  nestedFK?: {
    // If the lookup column is itself an FK, this contains the nested FK config
    // Supports recursive nesting for chained lookups
    fk: ForeignKeyInfo;
    lookupColumn: string;
    nestedFK?: FKLookupColumn['nestedFK']; // Recursive type for deeper nesting
  };
}

export interface FKLookupConfig {
  [columnName: string]: {
    // Lookup columns that have been added to the table for this FK
    lookupColumns: FKLookupColumn[];
  };
}

export interface TableViewerProps {
  columns: TableViewerColumn[];
  rows: TableViewerRow[];
  totalRowCount: number;
  loading?: boolean;
  error?: string | null;
  
  // Pagination
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  
  // Sorting
  sortBy: string | null;
  sortOrder: 'asc' | 'desc';
  onSort: (column: string) => void;
  sortDisabled?: boolean;
  onSortExternal?: (column: string, order: 'asc' | 'desc') => void; // Optional callback when sort is disabled
  
  // Filtering
  filterText: string;
  onFilterChange: (text: string) => void;
  filterDisabled?: boolean;
  onFilterExternal?: (filterText: string) => void; // Optional callback when filter is disabled
  
  // Column visibility
  visibleColumns: Set<string> | null;
  onToggleColumnVisibility: (column: string) => void;
  
  // Column order
  columnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
  
  // Column widths
  columnWidths?: Map<string, number>;
  onColumnWidthsChange?: (widths: Map<string, number>) => void;
  
  // Formatting
  formatValue?: (value: any, column: string) => string;
  
  // Foreign keys
  foreignKeys?: ForeignKeyInfo[];
  fkLookupConfig?: FKLookupConfig;
  fkLookupData?: Map<string, Map<string | number, any>>; // Map<columnName, Map<fkValue, lookupValue>>
  onFKCellClick?: (columnName: string, fkValue: any, fk: ForeignKeyInfo) => void;
  onFKLookupConfigChange?: (config: FKLookupConfig) => void;
  onFKConfigColumnsRequest?: (columnName: string, fk: ForeignKeyInfo) => Promise<string[]>; // Request available columns for FK config
  onFKConfigReferencedTableFKsRequest?: (tableName: string) => Promise<ForeignKeyInfo[]>; // Request FKs for referenced table to detect nested FKs
  onFKRecordRequest?: (fkColumn: string, fkValue: any, fk: ForeignKeyInfo) => Promise<Record<string, any> | null>; // Request full foreign record
  onNavigateToTable?: (tableName: string, rowId: any, fk: ForeignKeyInfo) => void; // Navigate to foreign table and row
  focusedRowId?: string | null; // ID of the row currently in focus
  focusedColumnName?: string | null; // Name of the column currently in focus
  dbName?: string | null;
  tableName?: string | null;
}

export type FilterValue = {
  min?: number;
  max?: number;
  equals?: string | number | boolean;
  allowNull: boolean;
  allowNonNull: boolean;
};

export type FKSelectionLevel = {
  tableName: string;
  columns: string[];
  fks: ForeignKeyInfo[];
  selectedColumn?: string;
  selectedFK?: ForeignKeyInfo;
};

