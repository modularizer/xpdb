/**
 * Generic Table Viewer Component
 * 
 * A reusable component for displaying tabular data with sorting, filtering,
 * pagination, and column visibility. Has no knowledge of databases or SQL.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { determineLookupColumn } from '../utils/fk-utils';
import { formatterRegistry } from './TableViewer/formatters/formatter-registry';
import { autoDetectFormatter } from './TableViewer/formatters/auto-formatter';
import type { ColumnFormatConfig, FormatterOptions } from './TableViewer/formatters/formatter.interface';
import ExportModal from './ExportModal';
import { exporterRegistry } from './exporters/exporter-registry';
import type { ExportData } from './exporters/exporter.interface';

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
}

export default function TableViewer({
  columns,
  rows,
  totalRowCount,
  loading = false,
  error = null,
  page,
  pageSize,
  onPageChange,
  sortBy,
  sortOrder,
  onSort,
  sortDisabled = false,
  onSortExternal,
  filterText,
  onFilterChange,
  filterDisabled = false,
  onFilterExternal,
  visibleColumns,
  onToggleColumnVisibility,
  columnOrder,
  onColumnOrderChange,
  columnWidths: externalColumnWidths,
  onColumnWidthsChange,
  formatValue,
  foreignKeys = [],
  fkLookupConfig = {},
  fkLookupData = new Map(),
  onFKCellClick,
  onFKLookupConfigChange,
  onFKConfigColumnsRequest,
  onFKConfigReferencedTableFKsRequest,
  onFKRecordRequest,
  onNavigateToTable,
  focusedRowId = null,
  focusedColumnName = null,
  dbName = null,
  tableName = null,
}: TableViewerProps) {
  const [showHiddenColumnsModal, setShowHiddenColumnsModal] = useState(false);
  const [contextMenuColumn, setContextMenuColumn] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  // Filter value structure: { min?: number, max?: number, equals?: string | number | boolean, allowNull: boolean, allowNonNull: boolean }
  type FilterValue = {
    min?: number;
    max?: number;
    equals?: string | number | boolean;
    allowNull: boolean;
    allowNonNull: boolean;
  };
  const [columnFilters, setColumnFilters] = useState<Map<string, FilterValue>>(new Map());
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterModalColumn, setFilterModalColumn] = useState<string | null>(null);
  const [filterModalMin, setFilterModalMin] = useState<string>('');
  const [filterModalMax, setFilterModalMax] = useState<string>('');
  const [filterModalEquals, setFilterModalEquals] = useState<string>('');
  const [filterModalAllowNull, setFilterModalAllowNull] = useState<boolean>(true);
  const [filterModalAllowNonNull, setFilterModalAllowNonNull] = useState<boolean>(true);
  const [showFKRecordModal, setShowFKRecordModal] = useState(false);
  const [fkRecordModalData, setFKRecordModalData] = useState<{
    fkColumn: string;
    fkValue: any;
    fk: ForeignKeyInfo;
    record: Record<string, any> | null;
    loading: boolean;
  } | null>(null);
  const [fkRecordModalTableFKs, setFKRecordModalTableFKs] = useState<ForeignKeyInfo[]>([]);
  const [fkRecordModalNestedSelection, setFKRecordModalNestedSelection] = useState<{
    columnName: string;
    fk: ForeignKeyInfo;
    columns: string[];
    fks: ForeignKeyInfo[];
    selectedColumns: Set<string>;
    nestedLevels: Map<string, {
      fk: ForeignKeyInfo;
      columns: string[];
      fks: ForeignKeyInfo[];
      selectedColumns: Set<string>;
    }>;
  } | null>(null);
  const [showFKHoverModal, setShowFKHoverModal] = useState(false);
  const [fkHoverModalData, setFKHoverModalData] = useState<{
    fkColumn: string;
    fkValue: any;
    fk: ForeignKeyInfo;
    record: Record<string, any> | null;
    loading: boolean;
    position: { x: number; y: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const modalHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hoverModalExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cellRefsForHover = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const headerRefs = useRef<Map<string, any>>(new Map());
  // Store text element refs for overflow detection: Map<columnName, Map<rowIndex, HTMLElement>>
  const textElementRefs = useRef<Map<string, Map<number, HTMLElement>>>(new Map());
  
  // Helper function to show FK record modal
  const showFKRecordModalForCell = useCallback(async (fkColumn: string, fkValue: any, fk: ForeignKeyInfo) => {
    if (!onFKRecordRequest) return;
    
    setFKRecordModalData({
      fkColumn,
      fkValue,
      fk,
      record: null,
      loading: true,
    });
    setShowFKRecordModal(true);
    setFKRecordModalNestedSelection(null);
    
    // Fetch FKs for the referenced table to detect nested FKs
    if (onFKConfigReferencedTableFKsRequest) {
      try {
        const tableFKs = await onFKConfigReferencedTableFKsRequest(fk.referencedTable);
        setFKRecordModalTableFKs(tableFKs);
      } catch (err) {
        console.error('[FK Record] Error fetching table FKs:', err);
        setFKRecordModalTableFKs([]);
      }
    }
    
    // Fetch the foreign record
    try {
      const record = await onFKRecordRequest(fkColumn, fkValue, fk);
      setFKRecordModalData(prev => prev ? { ...prev, record, loading: false } : null);
    } catch (err) {
      console.error('[FK Record] Error fetching foreign record:', err);
      setFKRecordModalData(prev => prev ? { ...prev, record: null, loading: false } : null);
    }
  }, [onFKRecordRequest, onFKConfigReferencedTableFKsRequest]);
  const columnRefs = useRef<Map<string, { header: any; cells: any[] }>>(new Map());
  
  // Column resizing state
  // Use external columnWidths if provided, otherwise use internal state
  const [internalColumnWidths, setInternalColumnWidths] = useState<Map<string, number>>(new Map());
  const columnWidths = externalColumnWidths ?? internalColumnWidths;
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);
  
  // Cell value modal state
  const [showCellModal, setShowCellModal] = useState(false);
  const [cellModalValue, setCellModalValue] = useState<any>(null);
  const [cellModalColumn, setCellModalColumn] = useState<string>('');
  
  // FK lookup configuration modal state
  const [showFKConfigModal, setShowFKConfigModal] = useState(false);
  const [fkConfigColumn, setFKConfigColumn] = useState<string | null>(null);
  const [fkConfigAvailableColumns, setFKConfigAvailableColumns] = useState<string[]>([]);
  const [fkConfigReferencedTableFKs, setFKConfigReferencedTableFKs] = useState<ForeignKeyInfo[]>([]);
  
  // Column formatting configuration
  const [columnFormatConfigs, setColumnFormatConfigs] = useState<Map<string, ColumnFormatConfig>>(new Map());
  const [showFormatConfigModal, setShowFormatConfigModal] = useState(false);
  const [formatConfigColumn, setFormatConfigColumn] = useState<string | null>(null);
  const [formatConfigType, setFormatConfigType] = useState<string>('auto');
  const [formatConfigOptions, setFormatConfigOptions] = useState<FormatterOptions>({});
  
  // CSV export modal
  const [showCsvExportModal, setShowCsvExportModal] = useState(false);
  
  // Cascading FK selection state - tracks the path of FK selections
  type FKSelectionLevel = {
    tableName: string;
    columns: string[];
    fks: ForeignKeyInfo[];
    selectedColumn?: string;
    selectedFK?: ForeignKeyInfo;
  };
  const [fkConfigSelectionPath, setFKConfigSelectionPath] = useState<FKSelectionLevel[]>([]);
  
  // Cache for auto-detected formatters per column (to avoid re-detecting on every render)
  const autoDetectedFormatters = useRef<Map<string, { type: string; options?: FormatterOptions }>>(new Map());
  
  // Clear auto-detection cache when rows, columns, or column widths change
  useEffect(() => {
    autoDetectedFormatters.current.clear();
  }, [rows, columns, columnWidths]);

  // Get column width (default 180)
  const getColumnWidth = useCallback((columnName: string): number => {
    return columnWidths.get(columnName) ?? 180;
  }, [columnWidths]);

  // Format number using the formatter system
  const formatNumber = useCallback((value: number, columnName: string): string | { number: string; suffix: string } => {
    // Check for custom format configuration
    const formatConfig = columnFormatConfigs.get(columnName);
    let formatterType = formatConfig?.type || 'auto';
    let formatterOptions = formatConfig?.options;
    
    // If auto, detect the best formatter (with caching)
    if (formatterType === 'auto') {
      // Check cache first
      if (!autoDetectedFormatters.current.has(columnName)) {
        const column = columns.find(c => c.name === columnName);
        const columnValues = rows.map(row => row[columnName]).filter(v => v !== null && v !== undefined);
        const columnWidth = getColumnWidth(columnName);
        const detected = autoDetectFormatter(columnValues, columnName, column?.dataType, columnWidth);
        autoDetectedFormatters.current.set(columnName, detected);
      }
      const detected = autoDetectedFormatters.current.get(columnName)!;
      formatterType = detected.type;
      formatterOptions = detected.options;
    }
    
    // Get the formatter from registry
    const formatter = formatterRegistry.get(formatterType);
    if (formatter) {
      const options = formatterOptions || formatter.getDefaultOptions();
      return formatter.format(value, options);
    }
    
    // Ultimate fallback
    return String(value);
  }, [columnFormatConfigs, rows, columns, getColumnWidth]);

  // Format date as M/D/Y 12h
  const formatDate = useCallback((value: any): string => {
    let date: Date;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      date = new Date(value);
    } else {
      return String(value);
    }
    
    if (isNaN(date.getTime())) {
      return String(value); // Invalid date, return original
    }
    
    // Format as M/D/Y 12h (e.g., "1/15/2024 3:45 PM")
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutesStr = minutes < 10 ? `0${minutes}` : String(minutes);
    
    return `${month}/${day}/${year} ${hours}:${minutesStr} ${ampm}`;
  }, []);

  // Check if value looks like a date
  const isDateValue = useCallback((value: any): boolean => {
    if (value instanceof Date) return true;
    if (typeof value === 'string') {
      // Check if it's a date string (ISO format, or common date formats)
      const dateRegex = /^\d{4}-\d{2}-\d{2}/; // ISO date
      const dateTimeRegex = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/; // ISO datetime
      if (dateRegex.test(value) || dateTimeRegex.test(value)) {
        const date = new Date(value);
        return !isNaN(date.getTime());
      }
    }
    if (typeof value === 'number') {
      // Could be a timestamp
      const date = new Date(value);
      return !isNaN(date.getTime()) && value > 0 && value < 1e15; // Reasonable timestamp range
    }
    return false;
  }, []);

  // Detect if a value is a color (hex, rgb, rgba, etc.)
  const isColorValue = useCallback((value: any): boolean => {
    if (typeof value !== 'string') return false;
    const str = value.trim().toLowerCase();
    
    // Hex colors: #rgb, #rrggbb, #rrggbbaa
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(str)) return true;
    
    // rgb/rgba colors: rgb(255, 255, 255) or rgba(255, 255, 255, 0.5)
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(str)) return true;
    
    // Named colors (basic set)
    const namedColors = ['red', 'green', 'blue', 'black', 'white', 'yellow', 'cyan', 'magenta', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey'];
    if (namedColors.includes(str)) return true;
    
    return false;
  }, []);

  // Parse color value to hex for rendering
  const parseColorToHex = useCallback((value: string): string => {
    const str = value.trim().toLowerCase();
    
    // Already hex
    if (str.startsWith('#')) {
      // Expand short hex (#rgb -> #rrggbb)
      if (str.length === 4) {
        return '#' + str[1] + str[1] + str[2] + str[2] + str[3] + str[3];
      }
      return str.substring(0, 7); // Take only RGB, ignore alpha
    }
    
    // rgb/rgba
    const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    
    // Named colors
    const colorMap: Record<string, string> = {
      red: '#ff0000', green: '#00ff00', blue: '#0000ff', black: '#000000',
      white: '#ffffff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
      orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
      gray: '#808080', grey: '#808080'
    };
    return colorMap[str] || '#000000';
  }, []);

  // Detect if a value is a URL
  const isURLValue = useCallback((value: any): boolean => {
    if (typeof value !== 'string') return false;
    const str = value.trim();
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:';
    } catch {
      // Also check for common URL patterns without protocol
      return /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/.*)?$/i.test(str) ||
             /^www\.[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(\/.*)?$/i.test(str);
    }
  }, []);

  // Normalize URL (add protocol if missing)
  const normalizeURL = useCallback((value: string): string => {
    const str = value.trim();
    if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('ftp://')) {
      return str;
    }
    if (str.startsWith('www.')) {
      return 'https://' + str;
    }
    return 'https://' + str;
  }, []);

  // Check if column is an enum type
  const isEnumColumn = useCallback((column: TableViewerColumn | undefined): boolean => {
    if (!column) return false;
    const lowerDataType = column.dataType?.toLowerCase() || '';
    return lowerDataType.includes('enum');
  }, []);

  // Generate a color for enum value (consistent hash-based color)
  const getEnumColor = useCallback((value: string): string => {
    // Simple hash function to generate consistent colors
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = value.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    // Use HSL with fixed saturation and lightness for good visibility
    return `hsl(${hue}, 70%, 50%)`;
  }, []);

  // Format date using the formatter system
  const formatDateValue = useCallback((value: any, columnName: string): string => {
    const formatConfig = columnFormatConfigs.get(columnName);
    let formatterType = formatConfig?.type || 'auto';
    let formatterOptions = formatConfig?.options;

    // If auto, check if column is date/timestamp type
    if (formatterType === 'auto') {
      const column = columns.find(c => c.name === columnName);
      const lowerDataType = column?.dataType?.toLowerCase() || '';
      if (lowerDataType.includes('timestamp') || lowerDataType.includes('date') || lowerDataType.includes('time')) {
        formatterType = 'date';
        formatterOptions = { dateFormat: 'M/D/Y', timeFormat: '12h', showTime: true, showSeconds: false, timezone: 'local' };
      } else if (isDateValue(value)) {
        // Fallback to old formatDate for non-configured date values
        return formatDate(value);
      } else {
        return String(value);
      }
    }

    // If explicitly set to date formatter
    if (formatterType === 'date') {
      const formatter = formatterRegistry.get('date');
      if (formatter) {
        const options = formatterOptions || formatter.getDefaultOptions();
        return formatter.format(value, options) as string;
      }
    }

    // Fallback to old formatDate
    if (isDateValue(value)) {
      return formatDate(value);
    }
    
    return String(value);
  }, [columnFormatConfigs, columns, isDateValue, formatDate]);

  const defaultFormatValue = useCallback((value: any, columnName: string): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false'; // Will be overridden by checkbox rendering
    if (typeof value === 'number') {
      const formatted = formatNumber(value, columnName);
      // Handle suffix notation return type
      if (typeof formatted === 'object' && formatted !== null && 'number' in formatted && 'suffix' in formatted) {
        return formatted.number + formatted.suffix;
      }
      return formatted as string;
    }
    // Check if it's a date value or date column
    const column = columns.find(c => c.name === columnName);
    const lowerDataType = column?.dataType?.toLowerCase() || '';
    if (isDateValue(value) || lowerDataType.includes('timestamp') || lowerDataType.includes('date') || lowerDataType.includes('time')) {
      return formatDateValue(value, columnName);
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }, [formatNumber, formatDateValue, isDateValue, columns]);

  const formatCellValue = useCallback((value: any, column: string): string | { number: string; suffix: string } => {
    if (formatValue) {
      const result = formatValue(value, column);
      // If formatValue returns a string, wrap it to maintain compatibility
      return typeof result === 'string' ? result : result;
    }
    return defaultFormatValue(value, column);
  }, [formatValue, defaultFormatValue]);

  const isValueNull = useCallback((value: any): boolean => {
    return value === null || value === undefined;
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback((columnName: string, startX: number) => {
    setResizingColumn(columnName);
    setResizeStartX(startX);
    setResizeStartWidth(getColumnWidth(columnName));
  }, [getColumnWidth]);

  // Handle resize move
  const handleResizeMove = useCallback((currentX: number) => {
    if (!resizingColumn) return;
    const diff = currentX - resizeStartX;
    const newWidth = Math.max(50, resizeStartWidth + diff); // Minimum width 50
    const newWidths = new Map(columnWidths);
    newWidths.set(resizingColumn, newWidth);
    
    if (onColumnWidthsChange) {
      onColumnWidthsChange(newWidths);
    } else {
      setInternalColumnWidths(newWidths);
    }
  }, [resizingColumn, resizeStartX, resizeStartWidth, columnWidths, onColumnWidthsChange]);

  // Handle resize end
  const handleResizeEnd = useCallback(() => {
    setResizingColumn(null);
    setResizeStartX(0);
    setResizeStartWidth(0);
  }, []);

  // Format value for display in modal (with JSON detection)
  const formatModalValue = useCallback((value: any, columnName?: string): string => {
    if (value === null || value === undefined) {
      return '(null)';
    }
    
    // Check if column is JSON type
    const column = columnName ? columns.find(c => c.name === columnName) : null;
    const isJsonColumn = column?.dataType?.toLowerCase().includes('json') || 
                         column?.dataType?.toLowerCase() === 'jsonb';
    
    // If it's already an object, format it as JSON
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return String(value);
      }
    }
    
    // If it's a string, try to parse it as JSON
    if (typeof value === 'string') {
      // If column is JSON type, always try to parse
      if (isJsonColumn) {
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          // If parsing fails, return as-is
          return value;
        }
      }
      
      // Check if it looks like JSON (starts with { or [)
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed, null, 2);
        } catch (e) {
          // Not valid JSON, return as-is
          return value;
        }
      }
      return value;
    }
    
    return String(value);
  }, [columns]);

  // Initialize format config modal when column is selected
  useEffect(() => {
    if (showFormatConfigModal && formatConfigColumn) {
      const existingConfig = columnFormatConfigs.get(formatConfigColumn);
      if (existingConfig && existingConfig.type !== 'auto') {
        // Use existing configured format
        setFormatConfigType(existingConfig.type);
        setFormatConfigOptions(existingConfig.options || {});
      } else {
        // Auto-detect best format for this column
        const column = columns.find(c => c.name === formatConfigColumn);
        const columnValues = rows.map(row => row[formatConfigColumn]).filter(v => v !== null && v !== undefined);
        const columnWidth = getColumnWidth(formatConfigColumn);
        const detected = autoDetectFormatter(columnValues, formatConfigColumn, column?.dataType, columnWidth);
        // Set the detected type (which should never be 'auto' since autoDetectFormatter returns a specific type)
        // Fallback to 'commas' if somehow 'auto' is returned
        const formatType = detected.type === 'auto' ? 'commas' : detected.type;
        setFormatConfigType(formatType);
        setFormatConfigOptions(detected.options || {});
      }
    }
  }, [showFormatConfigModal, formatConfigColumn, columnFormatConfigs, rows, columns, getColumnWidth]);

  // Handle cell click to show modal (only if text is overflowing)
  const handleCellClick = useCallback((value: any, columnName: string, textElement?: HTMLElement | null) => {
    // Check if text is overflowing (only on web)
    if (Platform.OS === 'web' && textElement) {
      const isOverflowing = textElement.scrollWidth > textElement.clientWidth || 
                           textElement.scrollHeight > textElement.clientHeight;
      if (!isOverflowing) {
        // Text fits, don't show modal
        return;
      }
    }
    
    // Show modal if overflowing or on non-web platforms (fallback)
    setCellModalValue(value);
    setCellModalColumn(columnName);
    setShowCellModal(true);
  }, []);

  // Set up resize handlers for web
  // Cleanup timeout refs on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (modalHoverTimeoutRef.current) {
        clearTimeout(modalHoverTimeoutRef.current);
      }
      if (hoverModalExpandTimeoutRef.current) {
        clearTimeout(hoverModalExpandTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingColumn) {
        handleResizeMove(e.clientX);
      }
    };

    const handleMouseUp = () => {
      if (resizingColumn) {
        handleResizeEnd();
      }
    };

    if (resizingColumn) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, handleResizeMove, handleResizeEnd]);

  // Get ordered and visible columns
  const getOrderedVisibleColumns = useMemo(() => {
    let orderedColumns = columns;
    
    // Apply column order if provided
    if (columnOrder && columnOrder.length > 0) {
      const orderMap = new Map(columnOrder.map((name, index) => [name, index]));
      orderedColumns = [...columns].sort((a, b) => {
        const aIndex = orderMap.get(a.name) ?? Infinity;
        const bIndex = orderMap.get(b.name) ?? Infinity;
        return aIndex - bIndex;
      });
    }
    
    // Filter to visible columns
    if (visibleColumns) {
      orderedColumns = orderedColumns.filter(col => visibleColumns.has(col.name));
    }
    
    return orderedColumns;
  }, [columns, visibleColumns, columnOrder]);

  // Client-side filtering and sorting of rows
  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...rows];

    // Apply column filters (only if not disabled)
    if (!filterDisabled && columnFilters.size > 0) {
      filtered = filtered.filter((row) => {
        for (const [columnName, filter] of columnFilters.entries()) {
          const value = row[columnName];
          const isNull = value === null || value === undefined;

          // Check null/non-null filters
          if (!filter.allowNull && isNull) return false;
          if (!filter.allowNonNull && !isNull) return false;

          // Skip value checks if null
          if (isNull) continue;

          // Check min filter
          if (filter.min !== undefined) {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            if (isNaN(numValue) || numValue < filter.min) return false;
          }

          // Check max filter
          if (filter.max !== undefined) {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            if (isNaN(numValue) || numValue > filter.max) return false;
          }

          // Check equals filter
          if (filter.equals !== undefined) {
            if (typeof filter.equals === 'boolean') {
              if (value !== filter.equals) return false;
            } else if (typeof filter.equals === 'number') {
              const numValue = typeof value === 'number' ? value : parseFloat(String(value));
              if (isNaN(numValue) || numValue !== filter.equals) return false;
            } else {
              // String comparison
              if (String(value) !== String(filter.equals)) return false;
            }
          }
        }
        return true;
      });
    }

    // Apply sorting (only if not disabled)
    if (!sortDisabled && sortBy) {
      filtered.sort((a, b) => {
        const aValue = a[sortBy];
        const bValue = b[sortBy];

        // Handle nulls
        if (aValue === null || aValue === undefined) {
          return bValue === null || bValue === undefined ? 0 : 1;
        }
        if (bValue === null || bValue === undefined) {
          return -1;
        }

        // Compare values
        let comparison = 0;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          comparison = aValue - bValue;
        } else {
          comparison = String(aValue).localeCompare(String(bValue));
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [rows, columnFilters, filterDisabled, sortBy, sortOrder, sortDisabled]);

  // Calculate filtered total count
  const filteredTotalRowCount = useMemo(() => {
    if (filterDisabled) {
      // When disabled, use original count (pagination mode)
      return totalRowCount;
    }
    // When enabled, use filtered count
    return filteredAndSortedRows.length;
  }, [filterDisabled, totalRowCount, filteredAndSortedRows.length]);

  // Get hidden columns
  const hiddenColumns = useMemo(() => {
    if (!visibleColumns) return [];
    return columns.filter(col => !visibleColumns.has(col.name));
  }, [columns, visibleColumns]);

  // Handle column reordering
  const handleColumnReorder = useCallback((fromIndex: number, toIndex: number) => {
    if (!onColumnOrderChange) return;
    
    const currentOrder = columnOrder || columns.map(c => c.name);
    const reordered = [...currentOrder];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    onColumnOrderChange(reordered);
  }, [columnOrder, columns, onColumnOrderChange]);


  // Handle right-click/long-press for context menu
  const handleColumnContextMenu = useCallback((columnName: string, event?: any) => {
    if (Platform.OS === 'web' && event) {
      event.preventDefault();
      setContextMenuPosition({ x: event.clientX || 0, y: event.clientY || 0 });
    } else {
      // For native, use a default position
      setContextMenuPosition({ x: 200, y: 200 });
    }
    setContextMenuColumn(columnName);
  }, []);

  // Check if filters are allowed (not disabled, or external handler provided)
  const filtersAllowed = !filterDisabled || !!onFilterExternal;

  // Categorize data type for filter UI
  const getDataTypeCategory = useCallback((dataType: string | undefined): 'text' | 'number' | 'date' | 'boolean' | 'unknown' => {
    if (!dataType) return 'unknown';
    const lower = dataType.toLowerCase();
    
    // Text types
    if (lower.includes('text') || lower.includes('varchar') || lower.includes('char') || 
        lower.includes('string') || lower === 'text') {
      return 'text';
    }
    
    // Number types
    if (lower.includes('int') || lower.includes('numeric') || lower.includes('decimal') || 
        lower.includes('float') || lower.includes('double') || lower.includes('real') ||
        lower.includes('serial') || lower.includes('bigint') || lower.includes('smallint')) {
      return 'number';
    }
    
    // Date/Time types
    if (lower.includes('date') || lower.includes('time') || lower.includes('timestamp')) {
      return 'date';
    }
    
    // Boolean types
    if (lower.includes('bool') || lower === 'boolean') {
      return 'boolean';
    }
    
    return 'unknown';
  }, []);

  // Handle opening filter modal
  const handleOpenFilter = useCallback((columnName: string) => {
    const column = columns.find(c => c.name === columnName);
    const existingFilter = columnFilters.get(columnName);
    
    setFilterModalColumn(columnName);
    if (existingFilter) {
      setFilterModalMin(existingFilter.min?.toString() || '');
      setFilterModalMax(existingFilter.max?.toString() || '');
      if (typeof existingFilter.equals === 'boolean') {
        setFilterModalEquals(existingFilter.equals ? 'true' : 'false');
      } else {
        setFilterModalEquals(existingFilter.equals?.toString() || '');
      }
      setFilterModalAllowNull(existingFilter.allowNull);
      setFilterModalAllowNonNull(existingFilter.allowNonNull);
    } else {
      setFilterModalMin('');
      setFilterModalMax('');
      setFilterModalEquals('');
      setFilterModalAllowNull(true);
      setFilterModalAllowNonNull(true);
    }
    setShowFilterModal(true);
    setContextMenuColumn(null);
  }, [columnFilters, columns]);

  // Handle applying column filter
  const handleApplyColumnFilter = useCallback((columnName: string, filterValue: FilterValue | null) => {
    const newFilters = new Map(columnFilters);
    if (filterValue && (
      filterValue.min !== undefined || 
      filterValue.max !== undefined || 
      filterValue.equals !== undefined ||
      !filterValue.allowNull ||
      !filterValue.allowNonNull
    )) {
      newFilters.set(columnName, filterValue);
    } else {
      newFilters.delete(columnName);
    }
    setColumnFilters(newFilters);

    // Build combined filter text from all column filters
    const filterParts: string[] = [];
    newFilters.forEach((filter, col) => {
      let filterStr = `${col}:`;
      const parts: string[] = [];
      if (filter.min !== undefined) parts.push(`min(${filter.min})`);
      if (filter.max !== undefined) parts.push(`max(${filter.max})`);
      if (filter.equals !== undefined) parts.push(`equals(${filter.equals})`);
      if (!filter.allowNull) parts.push('noNull');
      if (!filter.allowNonNull) parts.push('noNonNull');
      if (parts.length > 0) {
        filterStr += parts.join(',');
        filterParts.push(filterStr);
      }
    });
    const combinedFilter = filterParts.join(' ');

    // Apply filter based on disabled state
    if (filterDisabled) {
      if (onFilterExternal) {
        onFilterExternal(combinedFilter);
      }
    } else {
      onFilterChange(combinedFilter);
    }

    setShowFilterModal(false);
    setFilterModalColumn(null);
    setFilterModalMin('');
    setFilterModalMax('');
    setFilterModalEquals('');
    setFilterModalAllowNull(true);
    setFilterModalAllowNonNull(true);
  }, [columnFilters, filterDisabled, onFilterExternal, onFilterChange]);

  // Handle clearing column filter
  const handleClearColumnFilter = useCallback((columnName: string) => {
    handleApplyColumnFilter(columnName, null);
  }, [handleApplyColumnFilter]);

  // Set up drag handlers for web with full column preview
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const cleanupFunctions: (() => void)[] = [];
    let dragPreviewElement: HTMLElement | null = null;

    const setupDragHandlers = () => {
      headerRefs.current.forEach((ref, columnName) => {
        if (!ref) return;
        
        // Get the actual DOM element
        const element = ref as any;
        let domElement: HTMLElement | null = null;
        
        // Try different ways to get the DOM node
        if (element._nativeNode) {
          domElement = element._nativeNode;
        } else if (element._internalFiberInstanceHandleDEV) {
          const fiberNode = element._internalFiberInstanceHandleDEV;
          if (fiberNode.stateNode) {
            domElement = fiberNode.stateNode;
          }
        } else if (element.nodeType) {
          domElement = element;
        }
        
        if (!domElement) {
          // Try finding by data attribute
          const found = document.querySelector(`[data-column="${columnName}"]`);
          if (found) domElement = found as HTMLElement;
        }
        
        if (!domElement) return;
        
        // Set draggable attribute
        domElement.setAttribute('draggable', 'true');
        domElement.style.cursor = 'grab';
        if (!domElement.hasAttribute('data-column')) {
          domElement.setAttribute('data-column', columnName);
        }
        
        const handleDragStart = (e: DragEvent) => {
          e.stopPropagation();
          setDraggedColumn(columnName);
          setDragPosition({ x: e.clientX || 0, y: e.clientY || 0 });
          
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', columnName);
            // Prevent default drag image
            e.dataTransfer.setDragImage(new Image(), 0, 0);
            
            // Create a full column preview
            const columnData = columnRefs.current.get(columnName);
            if (columnData && columnData.header && columnData.cells.length > 0) {
              const headerRect = columnData.header.getBoundingClientRect();
              const firstCellRect = columnData.cells[0]?.getBoundingClientRect();
              const lastCellRect = columnData.cells[columnData.cells.length - 1]?.getBoundingClientRect();
              
              if (headerRect && firstCellRect && lastCellRect) {
                const columnWidth = headerRect.width;
                const columnHeight = lastCellRect.bottom - headerRect.top;
                
                // Create preview container
                dragPreviewElement = document.createElement('div');
                dragPreviewElement.style.cssText = `
                  position: fixed;
                  width: ${columnWidth}px;
                  height: ${columnHeight}px;
                  pointer-events: none;
                  z-index: 10000;
                  opacity: 0.9;
                  box-shadow: 0 8px 16px rgba(0,0,0,0.3);
                  border: 2px solid #667eea;
                  border-radius: 4px;
                  overflow: hidden;
                `;
                
                // Clone the header
                const headerClone = columnData.header.cloneNode(true) as HTMLElement;
                headerClone.style.margin = '0';
                headerClone.style.borderRadius = '0';
                dragPreviewElement.appendChild(headerClone);
                
                // Clone all cells
                columnData.cells.forEach((cell, idx) => {
                  if (cell) {
                    const cellClone = cell.cloneNode(true) as HTMLElement;
                    cellClone.style.margin = '0';
                    cellClone.style.borderRadius = '0';
                    cellClone.style.borderBottom = idx < columnData.cells.length - 1 ? '1px solid #e0e0e0' : 'none';
                    // @ts-ignore
                      dragPreviewElement.appendChild(cellClone);
                  }
                });
                
                document.body.appendChild(dragPreviewElement);
                
                // Position it initially
                dragPreviewElement.style.left = `${e.clientX - columnWidth / 2}px`;
                dragPreviewElement.style.top = `${e.clientY - 20}px`;
                
                // Use a transparent image for the drag image
                const dragImage = document.createElement('div');
                dragImage.style.cssText = `
                  position: absolute;
                  top: -1000px;
                  width: 1px;
                  height: 1px;
                  opacity: 0;
                `;
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);
                setTimeout(() => {
                  if (document.body.contains(dragImage)) {
                    document.body.removeChild(dragImage);
                  }
                }, 0);
              }
            }
          }
        };
        
        const handleDrag = (e: DragEvent) => {
          if (dragPreviewElement && e.clientX && e.clientY) {
            const columnData = columnRefs.current.get(columnName);
            if (columnData) {
              const headerRect = columnData.header.getBoundingClientRect();
              const columnWidth = headerRect?.width || 150;
              dragPreviewElement.style.left = `${e.clientX - columnWidth / 2}px`;
              dragPreviewElement.style.top = `${e.clientY - 20}px`;
            }
            setDragPosition({ x: e.clientX, y: e.clientY });
          }
        };
        
        const handleDragEnd = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Finalize the move - use the last known dragOverColumn
          const finalDragOver = dragOverColumn;
          if (finalDragOver && finalDragOver !== columnName && onColumnOrderChange) {
            const fromIndex = getOrderedVisibleColumns.findIndex(c => c.name === columnName);
            const toIndex = getOrderedVisibleColumns.findIndex(c => c.name === finalDragOver);
            if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
              // Use setTimeout to defer the state update and avoid navigation during drag
              setTimeout(() => {
                handleColumnReorder(fromIndex, toIndex);
              }, 0);
            }
          }
          
          // Clean up preview
          if (dragPreviewElement && document.body.contains(dragPreviewElement)) {
            document.body.removeChild(dragPreviewElement);
            dragPreviewElement = null;
          }
          
          setDraggedColumn(null);
          setDragOverColumn(null);
          setDragPosition({ x: 0, y: 0 });
          
          return false;
        };
        
        const handleDragOver = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedColumn && draggedColumn !== columnName) {
            if (e.dataTransfer) {
              e.dataTransfer.dropEffect = 'move';
            }
            setDragOverColumn(columnName);
          }
          handleDrag(e);
          return false;
        };
        
        const handleDragEnter = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedColumn && draggedColumn !== columnName) {
            setDragOverColumn(columnName);
          }
          return false;
        };
        
        const handleDragLeave = (e: DragEvent) => {
          const relatedTarget = e.relatedTarget as Node;
          if (!domElement?.contains(relatedTarget)) {
            setDragOverColumn(null);
          }
        };
        
        const handleDrop = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const draggedName = draggedColumn || e.dataTransfer?.getData('text/plain');
          if (draggedName && draggedName !== columnName && onColumnOrderChange) {
            const fromIndex = getOrderedVisibleColumns.findIndex(c => c.name === draggedName);
            const toIndex = getOrderedVisibleColumns.findIndex(c => c.name === columnName);
            if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
              // Use setTimeout to defer the state update and avoid navigation during drag
              setTimeout(() => {
                handleColumnReorder(fromIndex, toIndex);
              }, 0);
            }
          }
          
          // Clean up preview
          if (dragPreviewElement && document.body.contains(dragPreviewElement)) {
            document.body.removeChild(dragPreviewElement);
            dragPreviewElement = null;
          }
          
          setDraggedColumn(null);
          setDragOverColumn(null);
          setDragPosition({ x: 0, y: 0 });
          
          return false;
        };
        
        domElement.addEventListener('dragstart', handleDragStart);
        domElement.addEventListener('drag', handleDrag);
        domElement.addEventListener('dragend', handleDragEnd);
        domElement.addEventListener('dragover', handleDragOver);
        domElement.addEventListener('dragenter', handleDragEnter);
        domElement.addEventListener('dragleave', handleDragLeave);
        domElement.addEventListener('drop', handleDrop);
        
        cleanupFunctions.push(() => {
          domElement?.removeEventListener('dragstart', handleDragStart);
          domElement?.removeEventListener('drag', handleDrag);
          domElement?.removeEventListener('dragend', handleDragEnd);
          domElement?.removeEventListener('dragover', handleDragOver);
          domElement?.removeEventListener('dragenter', handleDragEnter);
          domElement?.removeEventListener('dragleave', handleDragLeave);
          domElement?.removeEventListener('drop', handleDrop);
        });
      });
    };

    // Set up handlers after a short delay to ensure DOM is ready
    const timeoutId = setTimeout(setupDragHandlers, 100);
    
    return () => {
      clearTimeout(timeoutId);
      cleanupFunctions.forEach(cleanup => cleanup());
      if (dragPreviewElement && document.body.contains(dragPreviewElement)) {
        document.body.removeChild(dragPreviewElement);
      }
    };
  }, [getOrderedVisibleColumns, draggedColumn, dragOverColumn, columns, onColumnOrderChange, handleColumnReorder]);

  const totalPages = Math.ceil(filteredTotalRowCount / pageSize);
  
  // Get paginated rows with formatted display strings
  const paginatedRows = useMemo(() => {
    let sourceRows: TableViewerRow[];
    if (filterDisabled) {
      // When disabled, use original rows (pagination is handled server-side)
      sourceRows = rows;
    } else {
      // When enabled, paginate the filtered/sorted rows
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      sourceRows = filteredAndSortedRows.slice(startIndex, endIndex);
    }
    
    // Add formatted display strings to each row using formatters
    return sourceRows.map(row => {
      const rowWithFormatted = { ...row };
      // Add formatted strings for each column using formatter's renderCell
      getOrderedVisibleColumns.forEach(col => {
        const value = row[col.name];
        const isNull = isValueNull(value);
        
        // Get the formatter for this column
        const config = columnFormatConfigs.get(col.name);
        const formatterType = config?.type || 'auto';
        const formatter = formatterRegistry.get(formatterType);
        
        if (formatter && formatter.renderCell) {
          // Use formatter's renderCell method
          const result = formatter.renderCell({
            value,
            options: config?.options,
            styles,
            isNull,
          });
          // Store the string value for CSV export
          (rowWithFormatted as any)[`__formatted_${col.name}`] = result.stringValue;
        } else {
          // Fallback to default formatting
          const formatted = defaultFormatValue(value, col.name);
          let stringValue: string;
          if (typeof formatted === 'object' && formatted !== null && 'number' in formatted && 'suffix' in formatted) {
            stringValue = formatted.number + formatted.suffix;
          } else {
            stringValue = String(formatted);
          }
          (rowWithFormatted as any)[`__formatted_${col.name}`] = stringValue;
        }
      });
      return rowWithFormatted;
    });
  }, [rows, filteredAndSortedRows, page, pageSize, filterDisabled, getOrderedVisibleColumns, columnFormatConfigs, formatterRegistry, defaultFormatValue, isValueNull]);

  // Export handler
  const handleExport = useCallback(async (format: string, selectedTables: string[], exportType: 'raw' | 'formatted') => {
    if (Platform.OS !== 'web') return;
    
    const exporter = exporterRegistry.get(format);
    if (!exporter) {
      // @ts-ignore
      alert(`Exporter for format "${format}" not found`);
      return;
    }

    const orderedVisibleCols = getOrderedVisibleColumns;
    const rowsToExport = exportType === 'formatted' ? paginatedRows : filteredAndSortedRows;

    // Helper function to get cell value as string
    const getCellValue = (row: TableViewerRow, col: TableViewerColumn): string => {
      let str: string;
      
      if (exportType === 'formatted') {
        // Use formatted values
        const formattedString = (row as any)[`__formatted_${col.name}`];
        if (formattedString !== undefined) {
          str = formattedString;
        } else {
          // Fallback: get the value and format it
          let value = row[col.name];
          
          // For lookup columns, try to get from fkLookupData
          if (value === undefined || value === null) {
            const lookupMatch = col.name.match(/^(.+)->(.+)$/);
            if (lookupMatch) {
              const [, fkColumn] = lookupMatch;
              const fkValue = row[fkColumn];
              if (fkValue !== null && fkValue !== undefined) {
                const lookupData = fkLookupData.get(col.name);
                if (lookupData) {
                  value = lookupData.get(fkValue);
                }
              }
            }
          }
          
          str = String(defaultFormatValue(value, col.name));
        }
      } else {
        // Use raw values
        let value = row[col.name];
        
        // For lookup columns, get the raw value
        if (value === undefined || value === null) {
          const lookupMatch = col.name.match(/^(.+)->(.+)$/);
          if (lookupMatch) {
            const [, fkColumn] = lookupMatch;
            const fkValue = row[fkColumn];
            if (fkValue !== null && fkValue !== undefined) {
              const lookupData = fkLookupData.get(col.name);
              if (lookupData) {
                value = lookupData.get(fkValue);
              }
            }
          }
        }
        
        if (value === null || value === undefined) {
          str = '';
        } else if (typeof value === 'object') {
          str = JSON.stringify(value);
        } else {
          str = String(value);
        }
      }
      
      return str;
    };

    // Prepare export data
    const exportData: ExportData = {
      columns: orderedVisibleCols.map(col => ({
        name: col.name,
        label: col.label || col.name,
        dataType: col.dataType,
      })),
      rows: rowsToExport.map(row => {
        const exportRow: Record<string, any> = {};
        orderedVisibleCols.forEach(col => {
          exportRow[col.name] = exportType === 'formatted' 
            ? getCellValue(row, col)
            : row[col.name];
        });
        return exportRow;
      }),
    };

    // Export options
    const exportOptions: ExportOptions = {
      formatted: exportType === 'formatted',
      formatValue: (value: any, column: string) => {
        const col = orderedVisibleCols.find(c => c.name === column);
        if (!col) return String(value);
        return getCellValue({ [column]: value } as TableViewerRow, col);
      },
      lookupData: fkLookupData,
    };

    try {
      const result = exporter.exportTable(exportData, tableName || 'table', exportOptions);
      
      // Generate filename
      const today = new Date().toISOString().split('T')[0];
      const dbNamePart = dbName ? `${dbName}_` : '';
      const tableNamePart = tableName ? `${tableName}_` : '';
      const exportTypeLabel = exportType === 'formatted' ? 'formatted' : 'raw';
      const filename = `${dbNamePart}${tableNamePart}${exportTypeLabel}_${today}.${result.extension}`;
      
      // Download file
      // @ts-ignore
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setShowCsvExportModal(false);
    } catch (err) {
      // @ts-ignore
      alert(`Error exporting: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [getOrderedVisibleColumns, paginatedRows, filteredAndSortedRows, tableName, dbName, fkLookupData, defaultFormatValue]);

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  if (loading && paginatedRows.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Table */}
      <View style={styles.tableContainer}>
        <ScrollView horizontal style={styles.tableScroll}>
          <View>
            {/* Header */}
            <View style={styles.tableHeader}>
              {getOrderedVisibleColumns.map((col, index) => {
                const isDragging = draggedColumn === col.name;
                const isDragOver = dragOverColumn === col.name;
                const columnIndex = index;
                const hasFilter = columnFilters.has(col.name);
                const columnWidth = getColumnWidth(col.name);
                
                // @ts-ignore
                  // @ts-ignore
                  return (
                  <View
                    key={col.name}
                    style={styles.tableHeaderCellContainer}
                  >
                    <View
                      ref={(ref) => {
                        if (ref) {
                          headerRefs.current.set(col.name, ref);
                        } else {
                          headerRefs.current.delete(col.name);
                        }
                      }}
                      data-column={col.name}
                      style={[
                        styles.tableHeaderCell,
                        { width: columnWidth },
                        isDragging && styles.draggingHeader,
                        isDragOver && styles.dragOverHeader,
                        Platform.OS === 'web' && styles.draggableHeader,
                      ]}
                      onContextMenu={(e: any) => {
                        if (Platform.OS === 'web') {
                          handleColumnContextMenu(col.name, e);
                        }
                      }}
                    >
                      <TouchableOpacity
                        style={[styles.headerCellTouchable, sortDisabled && !onSortExternal && styles.disabledHeader]}
                        onPress={() => {
                          if (sortDisabled) {
                            // If disabled but external handler provided, use it
                            if (onSortExternal) {
                              const newOrder = sortBy === col.name && sortOrder === 'asc' ? 'desc' : 'asc';
                              onSortExternal(col.name, newOrder);
                            }
                          } else {
                            onSort(col.name);
                          }
                        }}
                        onLongPress={() => handleColumnContextMenu(col.name)}
                        activeOpacity={sortDisabled && !onSortExternal ? 1 : 0.7}
                        disabled={(Platform.OS === 'web' && draggedColumn === col.name) || (sortDisabled && !onSortExternal)}
                      >
                        <View style={styles.headerCellContent}>
                          {Platform.OS === 'web' && (
                            <Text style={styles.dragHandleIcon}>⋮⋮</Text>
                          )}
                          <Text style={styles.tableHeaderText} numberOfLines={1}>
                            {col.label || col.name}
                          </Text>
                          {hasFilter && (
                            <Text style={styles.filterIndicator}>🔍</Text>
                          )}
                          {sortBy === col.name && (
                            <Text style={styles.sortIndicator}>
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      {/* Resize handle */}
                      {Platform.OS === 'web' && (
                        <View
                          style={[
                            styles.resizeHandle,
                            resizingColumn === col.name && styles.resizeHandleActive,
                          ]}
                          onMouseDown={(e: any) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleResizeStart(col.name, e.clientX || e.nativeEvent?.clientX || 0);
                          }}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
              {/* Hidden columns indicator */}
              {hiddenColumns.length > 0 && (
                <View
                  style={styles.hiddenColumnsIndicator}
                  {...(Platform.OS === 'web' ? {
                    onDragOver: (e: any) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    },
                    onDrop: (e: any) => {
                      e.preventDefault();
                      const columnName = e.dataTransfer.getData('text/plain');
                      if (columnName && hiddenColumns.some(col => col.name === columnName)) {
                        onToggleColumnVisibility(columnName);
                      }
                    },
                    onContextMenu: (e: any) => {
                      e.preventDefault();
                      setShowHiddenColumnsModal(true);
                    },
                  } : {})}
                >
                  <TouchableOpacity
                    style={styles.hiddenColumnsHeader}
                    onPress={() => setShowHiddenColumnsModal(true)}
                    onLongPress={() => setShowHiddenColumnsModal(true)}
                  >
                    <Text style={styles.hiddenColumnsText} numberOfLines={1}>
                      ⋯{hiddenColumns.length}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            {/* Rows */}
            <ScrollView style={styles.tableBodyScroll}>
              {paginatedRows.map((row, rowIndex) => {
                const isRowFocused = focusedRowId === row.id;
                return (
                <View key={row.id} style={[
                  styles.tableRow,
                  isRowFocused && styles.focusedRow,
                ]}>
                  {getOrderedVisibleColumns.map((col, colIndex) => {
                    const value = row[col.name];
                    const isColumnFocused = focusedColumnName === col.name;
                    const isNull = isValueNull(value);
                    const isDragging = draggedColumn === col.name;
                    const isDragOver = dragOverColumn === col.name;
                    const columnWidth = getColumnWidth(col.name);
                    
                    return (
                      <TouchableOpacity
                        key={col.name}
                        ref={(ref) => {
                          if (!ref) return;
                          if (!columnRefs.current.has(col.name)) {
                            columnRefs.current.set(col.name, { header: null, cells: [] });
                          }
                          const columnData = columnRefs.current.get(col.name)!;
                          if (rowIndex === 0) {
                            // Store header ref on first row
                            const headerRef = headerRefs.current.get(col.name);
                            if (headerRef) {
                              const element = headerRef as any;
                              let domElement: HTMLElement | null = null;
                              if (element._nativeNode) {
                                domElement = element._nativeNode;
                              } else if (element.nodeType) {
                                domElement = element;
                              } else {
                                const found = document.querySelector(`[data-column="${col.name}"]`);
                                if (found) domElement = found as HTMLElement;
                              }
                              columnData.header = domElement;
                            }
                          }
                          // Store cell ref
                          const element = ref as any;
                          let domElement: HTMLElement | null = null;
                          if (element._nativeNode) {
                            domElement = element._nativeNode;
                          } else if (element.nodeType) {
                            domElement = element;
                          }
                          if (domElement) {
                            columnData.cells[rowIndex] = domElement;
                          }
                        }}
                        style={[
                          styles.tableCell,
                          { width: columnWidth },
                          isDragging && styles.draggingCell,
                          isDragOver && styles.dragOverCell,
                          isColumnFocused && styles.focusedCell,
                        ]}
                        onPress={async () => {
                          // Check if this is an FK column
                          const fk = foreignKeys.find(fk => fk.columns.includes(col.name));
                          if (fk && !isNull) {
                            // Show modal with foreign record (on click)
                            await showFKRecordModalForCell(col.name, value, fk);
                          } else {
                            // Get the text element to check for overflow
                            let textElement: HTMLElement | null = null;
                            if (Platform.OS === 'web') {
                              const columnTextRefs = textElementRefs.current.get(col.name);
                              if (columnTextRefs) {
                                textElement = columnTextRefs.get(rowIndex) || null;
                              }
                            }
                            handleCellClick(value, col.name, textElement);
                          }
                        }}
                        onLongPress={async () => {
                          // Long press handler - same as regular click for FK cells
                          const fk = foreignKeys.find(fk => fk.columns.includes(col.name));
                          if (fk && !isNull) {
                            // Show modal with foreign record (on long press)
                            await showFKRecordModalForCell(col.name, value, fk);
                          }
                        }}
                        {...(Platform.OS === 'web' ? {
                          // Note: onContextMenu is handled via direct DOM event listener in ref callback for FK cells
                          // This ensures it works properly and prevents default browser context menu
                          onMouseEnter: async (e: any) => {
                            // Check if this is an FK column
                            const fk = foreignKeys.find(fk => fk.columns.includes(col.name));
                            if (fk && !isNull && onFKRecordRequest) {
                              // Clear any existing timeout
                              if (hoverTimeoutRef.current) {
                                clearTimeout(hoverTimeoutRef.current);
                              }
                              
                              // Get cell position for hover modal
                              let cellPosition = { x: 0, y: 0 };
                              const target = e?.target || e?.currentTarget;
                              if (target) {
                                const rect = (target as HTMLElement).getBoundingClientRect();
                                if (rect) {
                                  // Modal dimensions (approximate)
                                  const modalWidth = 280;
                                  const modalMaxHeight = 300;
                                  const padding = 10;
                                  const maxAdjustment = 100; // Maximum adjustment in pixels
                                  
                                  // Get viewport dimensions
                                  const viewportWidth = window.innerWidth;
                                  const viewportHeight = window.innerHeight;
                                  
                                  // Start with normal position (to the right of cell, top-aligned)
                                  let preferredX = rect.right + padding;
                                  let preferredY = rect.top;
                                  
                                  // Calculate how much it would overflow to the right
                                  const rightOverflow = (preferredX + modalWidth) - viewportWidth;
                                  if (rightOverflow > 0) {
                                    // Try positioning to the left of the cell
                                    const leftX = rect.left - modalWidth - padding;
                                    if (leftX >= padding) {
                                      // Left position fits, use it
                                      preferredX = leftX;
                                    } else {
                                      // Left position also doesn't fit, adjust by overflow amount (capped)
                                      const adjustment = Math.min(rightOverflow + padding, maxAdjustment);
                                      preferredX = preferredX - adjustment;
                                    }
                                  }
                                  
                                  // Calculate how much it would overflow at the bottom
                                  const bottomOverflow = (preferredY + modalMaxHeight) - viewportHeight;
                                  if (bottomOverflow > 0) {
                                    // Adjust up by the overflow amount (capped)
                                    const adjustment = Math.min(bottomOverflow + padding, maxAdjustment);
                                    preferredY = preferredY - adjustment;
                                  }
                                  
                                  // Calculate how much it would overflow at the top
                                  const topOverflow = padding - preferredY;
                                  if (topOverflow > 0) {
                                    // Adjust down by the overflow amount (capped)
                                    const adjustment = Math.min(topOverflow, maxAdjustment);
                                    preferredY = preferredY + adjustment;
                                  }
                                  
                                  cellPosition = { x: preferredX, y: preferredY };
                                }
                              }
                              
                              // Show hover modal after a short delay
                              hoverTimeoutRef.current = setTimeout(async () => {
                                // Fetch record (will use cache if available)
                                let record = null;
                                let loading = true;
                                
                                if (onFKRecordRequest) {
                                  record = await onFKRecordRequest(col.name, value, fk);
                                  loading = false;
                                }
                                
                                setFKHoverModalData({
                                  fkColumn: col.name,
                                  fkValue: value,
                                  fk: fk,
                                  record,
                                  loading,
                                  position: cellPosition,
                                });
                                setShowFKHoverModal(true);
                              }, 300);
                            }
                          },
                          onMouseLeave: () => {
                            // Clear hover timeout if mouse leaves before delay
                            if (hoverTimeoutRef.current) {
                              clearTimeout(hoverTimeoutRef.current);
                              hoverTimeoutRef.current = null;
                            }
                            // Hide hover modal after a short delay
                            if (modalHoverTimeoutRef.current) {
                              clearTimeout(modalHoverTimeoutRef.current);
                            }
                            modalHoverTimeoutRef.current = setTimeout(() => {
                              setShowFKHoverModal(false);
                            }, 200);
                          },
                        } : {})}
                        activeOpacity={0.7}
                      >
                        {(() => {
                          // Check if this column is a foreign key
                          const fk = foreignKeys.find(fk => fk.columns.includes(col.name));
                          if (fk && !isNull) {
                            // Show FK value as clickable link
                            // Check if this is a date/timestamp column
                            const isDateColumn = col.dataType && (
                              col.dataType.toLowerCase().includes('date') ||
                              col.dataType.toLowerCase().includes('time') ||
                              col.dataType.toLowerCase().includes('timestamp')
                            );
                            return (
                              <Text
                                ref={(ref) => {
                                  if (Platform.OS === 'web' && ref) {
                                    const element = ref as any;
                                    let domElement: HTMLElement | null = null;
                                    if (element._nativeNode) {
                                      domElement = element._nativeNode;
                                    } else if (element.nodeType) {
                                      domElement = element;
                                    }
                                    if (domElement) {
                                      if (!textElementRefs.current.has(col.name)) {
                                        textElementRefs.current.set(col.name, new Map());
                                      }
                                      textElementRefs.current.get(col.name)!.set(rowIndex, domElement);
                                    }
                                  }
                                }}
                                selectable={true}
                                style={[
                                  isDateColumn ? styles.tableCellTextDate : styles.tableCellText,
                                  styles.fkLinkText,
                                ]}
                                numberOfLines={1}
                              >
                                {formatCellValue(value, col.name)} →
                              </Text>
                            );
                          }
                          
                          // Boolean values: render as checkbox
                          if (typeof value === 'boolean') {
                            return (
                              <View style={styles.checkboxContainer}>
                                <View style={[
                                  styles.checkbox,
                                  value && styles.checkboxChecked,
                                ]}>
                                  {value && (
                                    <Text style={styles.checkboxCheckmark}>✓</Text>
                                  )}
                                </View>
                              </View>
                            );
                          }
                          
                          // Regular cell display - use formatter's renderCell if available
                          const config = columnFormatConfigs.get(col.name);
                          const formatterType = config?.type || 'auto';
                          const formatter = formatterRegistry.get(formatterType);
                          
                          if (formatter && formatter.renderCell) {
                            // Use formatter's renderCell method
                            const result = formatter.renderCell({
                              value,
                              options: config?.options,
                              styles,
                              isNull,
                            });
                            
                            // Wrap the element with ref tracking for overflow detection
                            return (
                              <View
                                ref={(ref) => {
                                  if (Platform.OS === 'web' && ref) {
                                    const element = ref as any;
                                    let domElement: HTMLElement | null = null;
                                    if (element._nativeNode) {
                                      domElement = element._nativeNode;
                                    } else if (element.nodeType) {
                                      domElement = element;
                                    }
                                    if (domElement) {
                                      if (!textElementRefs.current.has(col.name)) {
                                        textElementRefs.current.set(col.name, new Map());
                                      }
                                      textElementRefs.current.get(col.name)!.set(rowIndex, domElement);
                                    }
                                  }
                                }}
                              >
                                {result.element}
                              </View>
                            );
                          }
                          
                          // Fallback to legacy formatting
                          const formatted = isNull ? '?' : formatCellValue(value, col.name);
                          
                          // Check if this is a date/timestamp column
                          const isDateColumn = col.dataType && (
                            col.dataType.toLowerCase().includes('date') ||
                            col.dataType.toLowerCase().includes('time') ||
                            col.dataType.toLowerCase().includes('timestamp')
                          );
                          // Check if it's a suffix-formatted number (object with number and suffix)
                          if (typeof formatted === 'object' && formatted !== null && 'number' in formatted && 'suffix' in formatted) {
                            return (
                              <Text
                                ref={(ref) => {
                                  if (Platform.OS === 'web' && ref) {
                                    const element = ref as any;
                                    let domElement: HTMLElement | null = null;
                                    if (element._nativeNode) {
                                      domElement = element._nativeNode;
                                    } else if (element.nodeType) {
                                      domElement = element;
                                    }
                                    if (domElement) {
                                      if (!textElementRefs.current.has(col.name)) {
                                        textElementRefs.current.set(col.name, new Map());
                                      }
                                      textElementRefs.current.get(col.name)!.set(rowIndex, domElement);
                                    }
                                  }
                                }}
                                selectable={true}
                                style={[
                                  styles.tableCellText,
                                  isNull && styles.nullValueText,
                                ]}
                                numberOfLines={1}
                              >
                                <Text selectable={true}>{formatted.number}</Text>
                                <Text selectable={true} style={styles.numberSuffix}>{formatted.suffix}</Text>
                              </Text>
                            );
                          }
                          return (
                            <Text
                              ref={(ref) => {
                                if (Platform.OS === 'web' && ref) {
                                  const element = ref as any;
                                  let domElement: HTMLElement | null = null;
                                  if (element._nativeNode) {
                                    domElement = element._nativeNode;
                                  } else if (element.nodeType) {
                                    domElement = element;
                                  }
                                  if (domElement) {
                                    if (!textElementRefs.current.has(col.name)) {
                                      textElementRefs.current.set(col.name, new Map());
                                    }
                                    textElementRefs.current.get(col.name)!.set(rowIndex, domElement);
                                  }
                                }
                              }}
                              selectable={true}
                              style={[
                                isDateColumn ? styles.tableCellTextDate : styles.tableCellText,
                                isNull && styles.nullValueText,
                              ]}
                              numberOfLines={1}
                            >
                              {formatted}
                            </Text>
                          );
                        })()}
                      </TouchableOpacity>
                    );
                  })}
                  {/* Hidden columns indicator cell */}
                  {hiddenColumns.length > 0 && (
                    <View style={[styles.tableCell, styles.hiddenColumnsCell]} />
                  )}
                </View>
                );
              })}
              {paginatedRows.length === 0 && (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>No rows found</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </ScrollView>
        
        {/* Pagination */}
        <View style={styles.pagination}>
          <TouchableOpacity
            style={[styles.paginationButton, page === 1 && styles.paginationButtonDisabled]}
            onPress={() => onPageChange(page - 1)}
            disabled={page === 1}
          >
            <Text style={styles.paginationButtonText}>Previous</Text>
          </TouchableOpacity>
          <Text style={styles.paginationText}>
            Page {page} of {totalPages} ({filteredTotalRowCount.toLocaleString()} total rows)
            {filterDisabled && (
              <Text style={styles.paginationWarning}> • Sorting and filtering disabled in paginated mode</Text>
            )}
          </Text>
          <View style={styles.paginationRight}>
            {Platform.OS === 'web' && (
              <TouchableOpacity
                style={styles.csvDownloadIconButton}
                onPress={() => setShowCsvExportModal(true)}
              >
                <Text style={styles.csvDownloadIconText}>⬇</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.paginationButton, page >= totalPages && styles.paginationButtonDisabled]}
              onPress={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <Text style={styles.paginationButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Context menu for column */}
      {contextMenuColumn && (
        <Modal
          visible={!!contextMenuColumn}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setContextMenuColumn(null)}
        >
          <TouchableOpacity
            style={styles.contextMenuOverlay}
            activeOpacity={1}
            onPress={() => setContextMenuColumn(null)}
          >
            <View
              style={[
                styles.contextMenu,
                Platform.OS === 'web' && {
                  position: 'absolute',
                  left: contextMenuPosition.x,
                  top: contextMenuPosition.y,
                },
              ]}
            >
              {filtersAllowed && (
                <TouchableOpacity
                  style={styles.contextMenuItem}
                  onPress={() => {
                    if (contextMenuColumn) {
                      handleOpenFilter(contextMenuColumn);
                    }
                  }}
                >
                  <Text style={styles.contextMenuText}>Filter...</Text>
                </TouchableOpacity>
              )}
              {contextMenuColumn && fkLookupConfig[contextMenuColumn] && onFKLookupConfigChange && (
                <TouchableOpacity
                  style={styles.contextMenuItem}
                  onPress={async () => {
                    const fkConfig = fkLookupConfig[contextMenuColumn];
                    if (fkConfig && onFKConfigColumnsRequest) {
                      setFKConfigColumn(contextMenuColumn);
                      setContextMenuColumn(null);
                      setShowFKConfigModal(true);
                      
                      // Fetch available columns from the referenced table
                      try {
                        const columns = await onFKConfigColumnsRequest(contextMenuColumn, fkConfig.fk);
                        setFKConfigAvailableColumns(columns);
                        
                        // Also fetch FKs for the referenced table to detect nested FKs
                        let refTableFKs: ForeignKeyInfo[] = [];
                        if (onFKConfigReferencedTableFKsRequest) {
                          try {
                            refTableFKs = await onFKConfigReferencedTableFKsRequest(fkConfig.fk.referencedTable);
                            setFKConfigReferencedTableFKs(refTableFKs);
                          } catch (err) {
                            console.error('[FK Config] Error loading referenced table FKs:', err);
                            setFKConfigReferencedTableFKs([]);
                          }
                        }
                        
                        // Initialize the selection path with the first level
                        setFKConfigSelectionPath([{
                          tableName: fkConfig.fk.referencedTable,
                          columns,
                          fks: refTableFKs,
                        }]);
                      } catch (err) {
                        console.error('[FK Config] Error loading columns:', err);
                        setFKConfigAvailableColumns([]);
                        setFKConfigReferencedTableFKs([]);
                        setFKConfigSelectionPath([]);
                      }
                    }
                  }}
                >
                  <Text style={styles.contextMenuText}>
                    Add FK Lookup Column
                    {fkLookupConfig[contextMenuColumn].lookupColumns && fkLookupConfig[contextMenuColumn].lookupColumns.length > 0 && (
                      <Text style={styles.contextMenuSubtext}>
                        {' '}({fkLookupConfig[contextMenuColumn].lookupColumns.length} configured)
                      </Text>
                    )}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  setFormatConfigColumn(contextMenuColumn);
                  setContextMenuColumn(null);
                  setShowFormatConfigModal(true);
                }}
              >
                <Text style={styles.contextMenuText}>Configure Formatting...</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  onToggleColumnVisibility(contextMenuColumn!);
                  setContextMenuColumn(null);
                }}
              >
                <Text style={styles.contextMenuText}>
                  {(!visibleColumns || visibleColumns.has(contextMenuColumn!)) ? 'Hide Column' : 'Show Column'}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Hidden columns modal - concise list */}
      <Modal
        visible={showHiddenColumnsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowHiddenColumnsModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowHiddenColumnsModal(false)}
        >
          <View style={styles.hiddenColumnsModalContent}>
            <View style={styles.hiddenColumnsModalHeader}>
              <Text style={styles.hiddenColumnsModalTitle}>
                Hidden Columns ({hiddenColumns.length})
              </Text>
              <TouchableOpacity
                onPress={() => setShowHiddenColumnsModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.hiddenColumnsModalBody}>
              {hiddenColumns.map((col) => (
                <TouchableOpacity
                  key={col.name}
                  style={styles.hiddenColumnItem}
                  onPress={() => {
                    onToggleColumnVisibility(col.name);
                    setShowHiddenColumnsModal(false);
                  }}
                >
                  <Text style={styles.hiddenColumnItemText}>{col.label || col.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Filter modal */}
      <Modal
        visible={showFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFilterModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <View 
              style={styles.filterModalContent}
            >
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>
                Filter: {filterModalColumn ? (columns.find(c => c.name === filterModalColumn)?.label || filterModalColumn) : ''}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowFilterModal(false);
                  setFilterModalColumn(null);
                  setFilterModalMin('');
                  setFilterModalMax('');
                  setFilterModalEquals('');
                  setFilterModalAllowNull(true);
                  setFilterModalAllowNonNull(true);
                }}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.filterModalBody}>
              {filterModalColumn && (() => {
                const column = columns.find(c => c.name === filterModalColumn);
                const dataTypeCategory = getDataTypeCategory(column?.dataType);
                const isNumber = dataTypeCategory === 'number';
                const isBoolean = dataTypeCategory === 'boolean';
                const isDate = dataTypeCategory === 'date';

                return (
                  <>
                    {/* Number-specific filters: Min, Max, Equals */}
                    {isNumber && (
                      <>
                        <View style={styles.filterSection}>
                          <Text style={styles.filterSectionTitle}>Value Filters</Text>
                          
                          <View style={styles.filterRow}>
                            <Text style={styles.filterRowLabel}>Minimum:</Text>
                            <TextInput
                              style={styles.filterInputSmall}
                              value={filterModalMin}
                              onChangeText={setFilterModalMin}
                              keyboardType="numeric"
                              autoFocus={Platform.OS === 'web' && !filterModalMin}
                            />
                          </View>
                          
                          <View style={styles.filterRow}>
                            <Text style={styles.filterRowLabel}>Maximum:</Text>
                            <TextInput
                              style={styles.filterInputSmall}
                              value={filterModalMax}
                              onChangeText={setFilterModalMax}
                              keyboardType="numeric"
                            />
                          </View>
                          
                          <View style={styles.filterRow}>
                            <Text style={styles.filterRowLabel}>Equals:</Text>
                            <TextInput
                              style={styles.filterInputSmall}
                              value={filterModalEquals}
                              onChangeText={setFilterModalEquals}
                              keyboardType="numeric"
                            />
                          </View>
                        </View>
                      </>
                    )}

                    {/* Text/Date/Boolean: Equals only */}
                    {!isNumber && (
                      <>
                        <View style={styles.filterSection}>
                          <Text style={styles.filterSectionTitle}>Value Filter</Text>
                          
                          {isBoolean ? (
                            <>
                              <Text style={styles.filterLabel}>Value:</Text>
                              <View style={styles.filterBooleanButtons}>
                                <TouchableOpacity
                                  style={[
                                    styles.filterBooleanButton,
                                    filterModalEquals === 'true' && styles.filterBooleanButtonActive,
                                  ]}
                                  onPress={() => setFilterModalEquals('true')}
                                >
                                  <Text
                                    style={[
                                      styles.filterBooleanButtonText,
                                      filterModalEquals === 'true' && styles.filterBooleanButtonTextActive,
                                    ]}
                                  >
                                    True
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[
                                    styles.filterBooleanButton,
                                    filterModalEquals === 'false' && styles.filterBooleanButtonActive,
                                  ]}
                                  onPress={() => setFilterModalEquals('false')}
                                >
                                  <Text
                                    style={[
                                      styles.filterBooleanButtonText,
                                      filterModalEquals === 'false' && styles.filterBooleanButtonTextActive,
                                    ]}
                                  >
                                    False
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </>
                          ) : (
                            <>
                              <Text style={styles.filterLabel}>Equals:</Text>
                              <TextInput
                                style={styles.filterInput}
                                value={filterModalEquals}
                                onChangeText={setFilterModalEquals}
                                placeholder={
                                  isDate 
                                    ? 'YYYY-MM-DD' 
                                    : 'Enter exact value...'
                                }
                                keyboardType={isDate ? 'default' : 'default'}
                                autoFocus={Platform.OS === 'web'}
                              />
                            </>
                          )}
                        </View>
                      </>
                    )}

                    {/* Null/Non-null checkboxes - always shown */}
                    <View style={styles.filterSection}>
                      <Text style={styles.filterSectionTitle}>Include Values</Text>
                      
                      <TouchableOpacity
                        style={styles.filterCheckboxRow}
                        onPress={() => setFilterModalAllowNull(!filterModalAllowNull)}
                      >
                        <View style={[
                          styles.filterCheckbox,
                          filterModalAllowNull && styles.filterCheckboxChecked,
                        ]}>
                          {filterModalAllowNull && (
                            <Text style={styles.filterCheckboxCheckmark}>✓</Text>
                          )}
                        </View>
                        <Text style={styles.filterCheckboxLabel}>Allow null values</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={styles.filterCheckboxRow}
                        onPress={() => setFilterModalAllowNonNull(!filterModalAllowNonNull)}
                      >
                        <View style={[
                          styles.filterCheckbox,
                          filterModalAllowNonNull && styles.filterCheckboxChecked,
                        ]}>
                          {filterModalAllowNonNull && (
                            <Text style={styles.filterCheckboxCheckmark}>✓</Text>
                          )}
                        </View>
                        <Text style={styles.filterCheckboxLabel}>Allow non-null values</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Action Buttons */}
                    <View style={styles.filterModalButtons}>
                      {filterModalColumn && columnFilters.has(filterModalColumn) && (
                        <TouchableOpacity
                          style={[styles.filterButton, styles.filterClearButton]}
                          onPress={() => {
                            if (filterModalColumn) {
                              handleClearColumnFilter(filterModalColumn);
                            }
                          }}
                        >
                          <Text style={styles.filterButtonText}>Clear</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.filterButton, styles.filterApplyButton]}
                        onPress={() => {
                          if (filterModalColumn) {
                            const column = columns.find(c => c.name === filterModalColumn);
                            const dataTypeCategory = getDataTypeCategory(column?.dataType);
                            const isNumber = dataTypeCategory === 'number';
                            const isBoolean = dataTypeCategory === 'boolean';
                            
                            const filterValue: FilterValue = {
                              allowNull: filterModalAllowNull,
                              allowNonNull: filterModalAllowNonNull,
                            };
                            
                            // Add value filters
                            if (isNumber) {
                              if (filterModalMin.trim()) {
                                const minNum = parseFloat(filterModalMin);
                                if (!isNaN(minNum)) filterValue.min = minNum;
                              }
                              if (filterModalMax.trim()) {
                                const maxNum = parseFloat(filterModalMax);
                                if (!isNaN(maxNum)) filterValue.max = maxNum;
                              }
                              if (filterModalEquals.trim()) {
                                const equalsNum = parseFloat(filterModalEquals);
                                if (!isNaN(equalsNum)) filterValue.equals = equalsNum;
                              }
                            } else {
                              if (filterModalEquals.trim()) {
                                if (isBoolean) {
                                  filterValue.equals = filterModalEquals === 'true';
                                } else {
                                  filterValue.equals = filterModalEquals;
                                }
                              }
                            }
                            
                            handleApplyColumnFilter(filterModalColumn, filterValue);
                          }
                        }}
                      >
                        <Text style={styles.filterButtonText}>Apply</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              })()}
            </View>
          </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Cell value modal */}
      <Modal
        visible={showCellModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCellModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCellModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={styles.cellModalContent}>
              <View style={styles.cellModalHeader}>
                <Text style={styles.cellModalTitle}>
                  {cellModalColumn ? (columns.find(c => c.name === cellModalColumn)?.label || cellModalColumn) : 'Cell Value'}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowCellModal(false)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.cellModalBody}>
                <Text style={styles.cellModalValue}>
                  {formatModalValue(cellModalValue, cellModalColumn)}
                </Text>
              </ScrollView>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Export Modal */}
      {Platform.OS === 'web' && (
        <ExportModal
          visible={showCsvExportModal}
          onClose={() => setShowCsvExportModal(false)}
          title="Export Table"
          tables={tableName ? [tableName] : []}
          showTableSelection={false}
          availableFormats={['csv', 'markdown', 'json']}
          onExport={handleExport}
        />
      )}

      {/* FK Lookup Configuration Modal */}
      {showFKConfigModal && fkConfigColumn && fkLookupConfig[fkConfigColumn] && onFKLookupConfigChange && (
        <Modal
          visible={showFKConfigModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowFKConfigModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowFKConfigModal(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={styles.fkConfigModalContent}>
                <View style={styles.fkConfigModalHeader}>
                  <Text style={styles.fkConfigModalTitle}>
                    Configure FK Lookup: {fkConfigColumn}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowFKConfigModal(false)}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.fkConfigModalBody}>
                  <Text style={styles.fkConfigModalLabel}>
                    Add or remove lookup columns:
                  </Text>
                  <ScrollView style={styles.fkConfigColumnsList}>
                    {fkConfigSelectionPath.length > 0 && fkConfigSelectionPath[0].columns.map((colName) => {
                      // Check if this is the FK column itself (the one that matches the FK's referenced columns)
                      const fkForColumn = foreignKeys.find(fk => fk.columns.includes(fkConfigColumn));
                      const isFKColumnItself = fkForColumn && fkForColumn.referencedColumns.includes(colName);
                      
                      // Check if this column is already a lookup column
                      const existingConfig = fkLookupConfig[fkConfigColumn] || { lookupColumns: [] };
                      const existingLookupColumns = existingConfig.lookupColumns || [];
                      const isLookupColumn = existingLookupColumns.some(lc => 
                        lc.lookupColumn === colName && !lc.nestedFK
                      );
                      
                      // Check if this column is an FK (for nested lookups)
                      const isFKColumn = fkConfigSelectionPath[0].fks.some(fk => fk.columns.includes(colName));
                      const columnFK = isFKColumn ? fkConfigSelectionPath[0].fks.find(fk => fk.columns.includes(colName)) : null;
                      
                      const handleToggleLookup = () => {
                        const newConfig = { ...fkLookupConfig };
                        const existingConfig = newConfig[fkConfigColumn] || { lookupColumns: [] };
                        const existingLookupColumns = existingConfig.lookupColumns || [];
                        
                        if (isLookupColumn) {
                          // Remove this lookup column
                          newConfig[fkConfigColumn] = {
                            lookupColumns: existingLookupColumns.filter(lc => 
                              !(lc.lookupColumn === colName && !lc.nestedFK)
                            ),
                          };
                        } else {
                          // Add this lookup column
                          if (!fkForColumn) {
                            console.error('[FK Config Modal] No FK found for column:', fkConfigColumn);
                            return;
                          }
                          
                          const newLookupColumn: FKLookupColumn = {
                            fk: fkForColumn,
                            lookupColumn: colName,
                          };
                          
                          newConfig[fkConfigColumn] = {
                            lookupColumns: [...existingLookupColumns, newLookupColumn],
                          };
                        }
                        
                        onFKLookupConfigChange(newConfig);
                      };
                      
                      return (
                        <View
                          key={colName}
                          style={[
                            styles.fkConfigColumnItem,
                            isFKColumnItself && styles.fkConfigColumnItemFK,
                            isLookupColumn && styles.fkConfigColumnItemActive,
                          ]}
                        >
                          <View style={styles.fkConfigColumnItemContent}>
                            <View style={styles.fkConfigColumnItemLeft}>
                              <Text
                                style={[
                                  styles.fkConfigColumnItemText,
                                  isFKColumnItself && styles.fkConfigColumnItemTextFK,
                                  isLookupColumn && styles.fkConfigColumnItemTextActive,
                                ]}
                              >
                                {colName}
                                {isFKColumnItself && ' (FK Column)'}
                              </Text>
                              {isFKColumn && !isFKColumnItself && (
                                <Text style={styles.fkConfigColumnFKIndicator}>
                                  → FK
                                </Text>
                              )}
                            </View>
                            {!isFKColumnItself && (
                              <TouchableOpacity
                                style={[
                                  styles.fkConfigToggleButton,
                                  isLookupColumn && styles.fkConfigToggleButtonActive,
                                ]}
                                onPress={handleToggleLookup}
                              >
                                <Text style={[
                                  styles.fkConfigToggleButtonText,
                                  isLookupColumn && styles.fkConfigToggleButtonTextActive,
                                ]}>
                                  {isLookupColumn ? 'Remove' : 'Add'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* FK Hover Modal - concise preview on hover */}
      {Platform.OS === 'web' && showFKHoverModal && fkHoverModalData && (
        <TouchableOpacity
          activeOpacity={1}
          style={[
            styles.fkHoverModal,
            {
              position: 'fixed',
              left: fkHoverModalData.position.x,
              top: fkHoverModalData.position.y,
              zIndex: 10000,
            },
          ]}
          onPress={() => {
            // Clear expand timer
            if (hoverModalExpandTimeoutRef.current) {
              clearTimeout(hoverModalExpandTimeoutRef.current);
              hoverModalExpandTimeoutRef.current = null;
            }
            // On click, open the full modal
            setShowFKHoverModal(false);
            setFKRecordModalData({
              fkColumn: fkHoverModalData.fkColumn,
              fkValue: fkHoverModalData.fkValue,
              fk: fkHoverModalData.fk,
              record: fkHoverModalData.record,
              loading: fkHoverModalData.loading,
            });
            setShowFKRecordModal(true);
          }}
          {...(Platform.OS === 'web' ? {
            onMouseEnter: () => {
              // Keep modal open when mouse enters
              if (modalHoverTimeoutRef.current) {
                clearTimeout(modalHoverTimeoutRef.current);
                modalHoverTimeoutRef.current = null;
              }
              
              // Start timer to expand to full modal after 1 second
              if (hoverModalExpandTimeoutRef.current) {
                clearTimeout(hoverModalExpandTimeoutRef.current);
              }
              hoverModalExpandTimeoutRef.current = setTimeout(() => {
                // Expand to full modal
                setShowFKHoverModal(false);
                setFKRecordModalData({
                  fkColumn: fkHoverModalData.fkColumn,
                  fkValue: fkHoverModalData.fkValue,
                  fk: fkHoverModalData.fk,
                  record: fkHoverModalData.record,
                  loading: fkHoverModalData.loading,
                });
                setShowFKRecordModal(true);
              }, 1000);
            },
            onMouseLeave: () => {
              // Clear expand timer
              if (hoverModalExpandTimeoutRef.current) {
                clearTimeout(hoverModalExpandTimeoutRef.current);
                hoverModalExpandTimeoutRef.current = null;
              }
              
              // Hide modal when mouse leaves
              if (modalHoverTimeoutRef.current) {
                clearTimeout(modalHoverTimeoutRef.current);
              }
              modalHoverTimeoutRef.current = setTimeout(() => {
                setShowFKHoverModal(false);
              }, 200);
            },
          } : {})}
        >
              {fkHoverModalData.loading ? (
            <Text style={styles.fkHoverModalText}>Loading...</Text>
          ) : fkHoverModalData.record ? (
            <ScrollView style={styles.fkHoverModalContent} nestedScrollEnabled>
              {Object.entries(fkHoverModalData.record).slice(0, 10).map(([key, value]) => (
                <View key={key} style={styles.fkHoverModalRow}>
                  <Text style={styles.fkHoverModalLabel}>{key}:</Text>
                  <Text style={styles.fkHoverModalValue} numberOfLines={1}>
                    {value === null || value === undefined ? '?' : String(value)}
                  </Text>
                </View>
              ))}
              {Object.keys(fkHoverModalData.record).length > 10 && (
                <Text style={styles.fkHoverModalMore}>
                  +{Object.keys(fkHoverModalData.record).length - 10} more
                </Text>
              )}
              {onNavigateToTable && (
                <TouchableOpacity
                  style={styles.fkHoverModalLink}
                  onPress={(e) => {
                    e.stopPropagation();
                    const pkColumn = fkHoverModalData.fk.referencedColumns[0];
                    const pkValue = fkHoverModalData.record![pkColumn];
                    onNavigateToTable(fkHoverModalData.fk.referencedTable, pkValue, fkHoverModalData.fk);
                    setShowFKHoverModal(false);
                  }}
                >
                  <Text style={styles.fkHoverModalLinkText}>View Record →</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          ) : (
            <Text style={styles.fkHoverModalText}>Record not found</Text>
          )}
        </TouchableOpacity>
      )}

      {/* FK Record Modal - shows the foreign record (full modal on click) */}
      {showFKRecordModal && fkRecordModalData && (
        <Modal
          visible={showFKRecordModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowFKRecordModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowFKRecordModal(false)}
            {...(Platform.OS === 'web' ? {
              onMouseEnter: () => {
                // Clear hide timeout when mouse enters modal
                if (modalHoverTimeoutRef.current) {
                  clearTimeout(modalHoverTimeoutRef.current);
                  modalHoverTimeoutRef.current = null;
                }
              },
              onMouseLeave: () => {
                // Hide modal after a short delay when mouse leaves
                modalHoverTimeoutRef.current = setTimeout(() => {
                  setShowFKRecordModal(false);
                }, 200);
              },
            } : {})}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
              style={styles.fkRecordModalContent}
              {...(Platform.OS === 'web' ? {
                onMouseEnter: () => {
                  // Clear hide timeout when mouse enters modal content
                  if (modalHoverTimeoutRef.current) {
                    clearTimeout(modalHoverTimeoutRef.current);
                    modalHoverTimeoutRef.current = null;
                  }
                },
                onMouseLeave: () => {
                  // Hide modal after a short delay when mouse leaves modal content
                  modalHoverTimeoutRef.current = setTimeout(() => {
                    setShowFKRecordModal(false);
                  }, 200);
                },
              } : {})}
            >
              <View style={styles.fkRecordModalHeader}>
                <Text style={styles.fkRecordModalTitle}>
                  Foreign Record: {fkRecordModalData.fk.referencedTable}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowFKRecordModal(false)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </TouchableOpacity>
              </View>
              
              {fkRecordModalData.loading ? (
                <View style={styles.fkRecordModalBody}>
                  <Text style={styles.loadingText}>Loading record...</Text>
                </View>
              ) : fkRecordModalData.record ? (
                <ScrollView style={styles.fkRecordModalBody}>
                  {Object.entries(fkRecordModalData.record).map(([key, value]) => {
                    // Check if this is the FK column itself (the one that matches the FK's referenced columns)
                    const isFKColumnItself = fkRecordModalData.fk.referencedColumns.includes(key);
                    
                    // Check if this column is itself an FK to another table
                    const columnFK = fkRecordModalTableFKs.find(fk => fk.columns.includes(key));
                    const isNestedFKColumn = !!columnFK;
                    
                    // Check if this column is already a lookup column (direct or nested)
                    const existingConfig = fkLookupConfig[fkRecordModalData.fkColumn] || { lookupColumns: [] };
                    const existingLookupColumns = existingConfig.lookupColumns || [];
                    const isLookupColumn = existingLookupColumns.some(lc => 
                      lc.lookupColumn === key && !lc.nestedFK
                    );
                    // Check for nested lookup columns that use this column as the intermediate FK
                    const isNestedLookupColumn = existingLookupColumns.some(lc => 
                      lc.lookupColumn === key && lc.nestedFK
                    );
                    
                    const handleToggleLookup = async () => {
                      if (!onFKLookupConfigChange) return;
                      
                      // If this is an FK column, show nested selection
                      if (isNestedFKColumn && columnFK && onFKConfigColumnsRequest) {
                        // If already has nested lookup, remove it
                        if (isNestedLookupColumn) {
                          const newConfig = { ...fkLookupConfig };
                          const existingConfig = newConfig[fkRecordModalData.fkColumn] || { lookupColumns: [] };
                          const existingLookupColumns = existingConfig.lookupColumns || [];
                          newConfig[fkRecordModalData.fkColumn] = {
                            lookupColumns: existingLookupColumns.filter(lc => 
                              !(lc.lookupColumn === key && lc.nestedFK)
                            ),
                          };
                          onFKLookupConfigChange(newConfig);
                          return;
                        }
                        
                        // Otherwise, show nested selection modal
                        console.log('[FK Record] Opening nested selection for FK column:', key, columnFK);
                        try {
                          const nestedColumns = await onFKConfigColumnsRequest(key, columnFK);
                          // Get FKs for the nested table to support recursive chaining
                          let nestedFKs: ForeignKeyInfo[] = [];
                          if (onFKConfigReferencedTableFKsRequest) {
                            try {
                              nestedFKs = await onFKConfigReferencedTableFKsRequest(columnFK.referencedTable);
                            } catch (err) {
                              console.error('[FK Record] Error loading nested table FKs:', err);
                            }
                          }
                          console.log('[FK Record] Loaded nested columns:', nestedColumns, 'FKs:', nestedFKs);
                          setFKRecordModalNestedSelection({
                            columnName: key,
                            fk: columnFK,
                            columns: nestedColumns,
                            fks: nestedFKs,
                            selectedColumns: new Set(),
                            nestedLevels: new Map(),
                          });
                        } catch (err) {
                          console.error('[FK Record] Error loading nested columns:', err);
                        }
                        return;
                      }
                      
                      // Regular column - add/remove directly
                      const newConfig = { ...fkLookupConfig };
                      const existingConfig = newConfig[fkRecordModalData.fkColumn] || { lookupColumns: [] };
                      const existingLookupColumns = existingConfig.lookupColumns || [];
                      
                      if (isLookupColumn) {
                        // Remove this lookup column
                        newConfig[fkRecordModalData.fkColumn] = {
                          lookupColumns: existingLookupColumns.filter(lc => 
                            !(lc.lookupColumn === key && !lc.nestedFK)
                          ),
                        };
                      } else {
                        // Add this lookup column
                        const newLookupColumn: FKLookupColumn = {
                          fk: fkRecordModalData.fk,
                          lookupColumn: key,
                        };
                        
                        newConfig[fkRecordModalData.fkColumn] = {
                          lookupColumns: [...existingLookupColumns, newLookupColumn],
                        };
                      }
                      
                      onFKLookupConfigChange(newConfig);
                    };
                    
                    return (
                      <View 
                        key={key} 
                        style={[
                          styles.fkRecordField,
                          isFKColumnItself && styles.fkRecordFieldFK,
                          (isLookupColumn || isNestedLookupColumn) && styles.fkRecordFieldActive,
                        ]}
                      >
                        {!isFKColumnItself && onFKLookupConfigChange && (
                          <TouchableOpacity
                            style={[
                              styles.fkRecordToggleIconButton,
                              (isLookupColumn || isNestedLookupColumn) ? styles.fkRecordToggleIconButtonRemove : styles.fkRecordToggleIconButtonAdd,
                            ]}
                            onPress={handleToggleLookup}
                          >
                            <Text style={styles.fkRecordToggleIconButtonText}>
                              {(isLookupColumn || isNestedLookupColumn) ? '−' : '+'}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {isFKColumnItself && <View style={styles.fkRecordToggleIconButtonPlaceholder} />}
                        <Text style={[
                          styles.fkRecordFieldLabel,
                          isFKColumnItself && styles.fkRecordFieldLabelFK,
                          (isLookupColumn || isNestedLookupColumn) && styles.fkRecordFieldLabelActive,
                        ]}>
                          {key}:
                          {isNestedFKColumn && ' → FK'}
                          {isNestedLookupColumn && ' (chained)'}
                        </Text>
                        <Text style={[
                          styles.fkRecordFieldValue,
                          isFKColumnItself && styles.fkRecordFieldValueFK,
                        ]}>
                          {value === null || value === undefined ? '?' : String(value)}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.fkRecordModalBody}>
                  <Text style={styles.errorText}>Record not found</Text>
                </View>
              )}
              
              {fkRecordModalData.record && onNavigateToTable && (
                <View style={styles.fkRecordModalFooter}>
                  <TouchableOpacity
                    style={styles.fkRecordViewLink}
                    onPress={() => {
                      // Find the primary key column from the FK referenced columns
                      const pkColumn = fkRecordModalData.fk.referencedColumns[0];
                      const pkValue = fkRecordModalData.record![pkColumn];
                      onNavigateToTable(fkRecordModalData.fk.referencedTable, pkValue, fkRecordModalData.fk);
                      setShowFKRecordModal(false);
                    }}
                  >
                    <Text style={styles.fkRecordViewLinkText}>
                      View Record →
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Nested FK Column Selection Modal */}
      {fkRecordModalNestedSelection && fkRecordModalData && (
        <Modal
          visible={!!fkRecordModalNestedSelection}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setFKRecordModalNestedSelection(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setFKRecordModalNestedSelection(null)}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
              style={styles.fkRecordModalContent}
            >
              <View style={styles.fkRecordModalHeader}>
                <Text style={styles.fkRecordModalTitle}>
                  Select column from {fkRecordModalNestedSelection.fk.referencedTable}
                </Text>
                <TouchableOpacity
                  onPress={() => setFKRecordModalNestedSelection(null)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseButtonText}>×</Text>
                </TouchableOpacity>
              </View>
              <ScrollView 
                horizontal 
                style={styles.fkConfigCascadingContainer}
                contentContainerStyle={styles.fkConfigCascadingContent}
              >
                {/* Render current level */}
                <View style={styles.fkConfigLevelPanel}>
                  <Text style={styles.fkConfigLevelTitle}>
                    {fkRecordModalNestedSelection.fk.referencedTable}
                  </Text>
                  <ScrollView style={styles.fkConfigLevelColumnsList}>
                    {fkRecordModalNestedSelection.columns.map((colName) => {
                      const isSelected = fkRecordModalNestedSelection.selectedColumns.has(colName);
                      const isFKColumn = fkRecordModalNestedSelection.fks.some(fk => fk.columns.includes(colName));
                      const columnFK = isFKColumn ? fkRecordModalNestedSelection.fks.find(fk => fk.columns.includes(colName)) : null;
                      const hasNestedLevel = fkRecordModalNestedSelection.nestedLevels.has(colName);
                      const nestedLevel = hasNestedLevel ? fkRecordModalNestedSelection.nestedLevels.get(colName)! : null;
                      
                      const handleToggleColumn = async () => {
                        const newSelected = new Set(fkRecordModalNestedSelection.selectedColumns);
                        if (isSelected) {
                          newSelected.delete(colName);
                          // Remove nested level if it exists
                          const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                          newNestedLevels.delete(colName);
                          setFKRecordModalNestedSelection({
                            ...fkRecordModalNestedSelection,
                            selectedColumns: newSelected,
                            nestedLevels: newNestedLevels,
                          });
                        } else {
                          newSelected.add(colName);
                          setFKRecordModalNestedSelection({
                            ...fkRecordModalNestedSelection,
                            selectedColumns: newSelected,
                          });
                        }
                      };
                      
                      const handleExpandFK = async () => {
                        if (!columnFK || !onFKConfigColumnsRequest || !onFKConfigReferencedTableFKsRequest) return;
                        
                        try {
                          const nestedColumns = await onFKConfigColumnsRequest(colName, columnFK);
                          const nestedFKs = await onFKConfigReferencedTableFKsRequest(columnFK.referencedTable);
                          
                          const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                          newNestedLevels.set(colName, {
                            fk: columnFK,
                            columns: nestedColumns,
                            fks: nestedFKs,
                            selectedColumns: new Set(),
                          });
                          
                          setFKRecordModalNestedSelection({
                            ...fkRecordModalNestedSelection,
                            nestedLevels: newNestedLevels,
                          });
                        } catch (err) {
                          console.error('[FK Record] Error loading nested level:', err);
                        }
                      };
                      
                      return (
                        <View key={colName} style={styles.fkConfigColumnItem}>
                          <View style={styles.fkConfigColumnItemContent}>
                            <TouchableOpacity
                              style={styles.fkConfigCheckbox}
                              onPress={handleToggleColumn}
                            >
                              <Text style={styles.fkConfigCheckboxText}>
                                {isSelected ? '✓' : '○'}
                              </Text>
                            </TouchableOpacity>
                            <Text style={[
                              styles.fkConfigColumnItemText,
                              isSelected && styles.fkConfigColumnItemTextSelected,
                            ]}>
                              {colName}
                            </Text>
                            {isFKColumn && (
                              <TouchableOpacity
                                style={styles.fkConfigExpandButton}
                                onPress={handleExpandFK}
                              >
                                <Text style={styles.fkConfigExpandButtonText}>
                                  {hasNestedLevel ? '▼' : '▶'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
                
                {/* Render nested levels recursively */}
                {Array.from(fkRecordModalNestedSelection.nestedLevels.entries()).map(([parentCol, level]) => {
                  // Check if this level has nested levels (for recursive expansion)
                  const levelNestedLevels = new Map<string, {
                    fk: ForeignKeyInfo;
                    columns: string[];
                    fks: ForeignKeyInfo[];
                    selectedColumns: Set<string>;
                  }>();
                  
                  // Find nested levels that belong to this level
                  for (const [key, nestedLevel] of fkRecordModalNestedSelection.nestedLevels.entries()) {
                    // Check if this nested level's FK columns match any column in the current level
                    if (level.columns.some(col => nestedLevel.fk.columns.includes(col))) {
                      levelNestedLevels.set(key, nestedLevel);
                    }
                  }
                  
                  return (
                    <View key={parentCol} style={styles.fkConfigLevelPanel}>
                      <Text style={styles.fkConfigLevelTitle}>
                        {level.fk.referencedTable}
                      </Text>
                      <ScrollView style={styles.fkConfigLevelColumnsList}>
                        {level.columns.map((colName) => {
                          const isSelected = level.selectedColumns.has(colName);
                          const isFKColumn = level.fks.some(fk => fk.columns.includes(colName));
                          const columnFK = isFKColumn ? level.fks.find(fk => fk.columns.includes(colName)) : null;
                          const hasNestedLevel = levelNestedLevels.has(colName);
                          const nestedLevel = hasNestedLevel ? levelNestedLevels.get(colName)! : null;
                          
                          const handleToggleColumn = () => {
                            const newSelected = new Set(level.selectedColumns);
                            if (isSelected) {
                              newSelected.delete(colName);
                              // Remove nested level if it exists
                              const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                              newNestedLevels.delete(colName);
                              setFKRecordModalNestedSelection({
                                ...fkRecordModalNestedSelection,
                                nestedLevels: newNestedLevels,
                              });
                            } else {
                              newSelected.add(colName);
                              setFKRecordModalNestedSelection({
                                ...fkRecordModalNestedSelection,
                                nestedLevels: new Map(fkRecordModalNestedSelection.nestedLevels),
                              });
                            }
                            
                            const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                            newNestedLevels.set(parentCol, {
                              ...level,
                              selectedColumns: newSelected,
                            });
                            
                            setFKRecordModalNestedSelection({
                              ...fkRecordModalNestedSelection,
                              nestedLevels: newNestedLevels,
                            });
                          };
                          
                          const handleExpandFK = async () => {
                            if (!columnFK || !onFKConfigColumnsRequest || !onFKConfigReferencedTableFKsRequest) return;
                            
                            try {
                              const nestedColumns = await onFKConfigColumnsRequest(colName, columnFK);
                              const nestedFKs = await onFKConfigReferencedTableFKsRequest(columnFK.referencedTable);
                              
                              const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                              newNestedLevels.set(colName, {
                                fk: columnFK,
                                columns: nestedColumns,
                                fks: nestedFKs,
                                selectedColumns: new Set(),
                              });
                              
                              setFKRecordModalNestedSelection({
                                ...fkRecordModalNestedSelection,
                                nestedLevels: newNestedLevels,
                              });
                            } catch (err) {
                              console.error('[FK Record] Error loading nested level:', err);
                            }
                          };
                          
                          return (
                            <View key={colName} style={styles.fkConfigColumnItem}>
                              <View style={styles.fkConfigColumnItemContent}>
                                <TouchableOpacity
                                  style={styles.fkConfigCheckbox}
                                  onPress={handleToggleColumn}
                                >
                                  <Text style={styles.fkConfigCheckboxText}>
                                    {isSelected ? '✓' : '○'}
                                  </Text>
                                </TouchableOpacity>
                                <Text style={[
                                  styles.fkConfigColumnItemText,
                                  isSelected && styles.fkConfigColumnItemTextSelected,
                                ]}>
                                  {colName}
                                </Text>
                                {isFKColumn && (
                                  <TouchableOpacity
                                    style={styles.fkConfigExpandButton}
                                    onPress={handleExpandFK}
                                  >
                                    <Text style={styles.fkConfigExpandButtonText}>
                                      {hasNestedLevel ? '▼' : '▶'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </ScrollView>
                      
                      {/* Recursively render deeper nested levels */}
                      {Array.from(levelNestedLevels.entries()).map(([nestedCol, nestedLevel]) => (
                        <View key={`${parentCol}-${nestedCol}`} style={styles.fkConfigLevelPanel}>
                          <Text style={styles.fkConfigLevelTitle}>
                            {nestedLevel.fk.referencedTable}
                          </Text>
                          <ScrollView style={styles.fkConfigLevelColumnsList}>
                            {nestedLevel.columns.map((colName) => {
                              const isSelected = nestedLevel.selectedColumns.has(colName);
                              
                              const handleToggleColumn = () => {
                                const newSelected = new Set(nestedLevel.selectedColumns);
                                if (isSelected) {
                                  newSelected.delete(colName);
                                } else {
                                  newSelected.add(colName);
                                }
                                
                                const newNestedLevels = new Map(fkRecordModalNestedSelection.nestedLevels);
                                newNestedLevels.set(nestedCol, {
                                  ...nestedLevel,
                                  selectedColumns: newSelected,
                                });
                                
                                setFKRecordModalNestedSelection({
                                  ...fkRecordModalNestedSelection,
                                  nestedLevels: newNestedLevels,
                                });
                              };
                              
                              return (
                                <View key={colName} style={styles.fkConfigColumnItem}>
                                  <View style={styles.fkConfigColumnItemContent}>
                                    <TouchableOpacity
                                      style={styles.fkConfigCheckbox}
                                      onPress={handleToggleColumn}
                                    >
                                      <Text style={styles.fkConfigCheckboxText}>
                                        {isSelected ? '✓' : '○'}
                                      </Text>
                                    </TouchableOpacity>
                                    <Text style={[
                                      styles.fkConfigColumnItemText,
                                      isSelected && styles.fkConfigColumnItemTextSelected,
                                    ]}>
                                      {colName}
                                    </Text>
                                  </View>
                                </View>
                              );
                            })}
                          </ScrollView>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
              
              {/* Apply button */}
              <View style={styles.fkRecordModalFooter}>
                <TouchableOpacity
                  style={styles.fkRecordApplyButton}
                  onPress={() => {
                    if (!onFKLookupConfigChange) return;
                    
                    // Build all selected lookup columns recursively
                    const newConfig = { ...fkLookupConfig };
                    const existingConfig = newConfig[fkRecordModalData.fkColumn] || { lookupColumns: [] };
                    const existingLookupColumns = existingConfig.lookupColumns || [];
                    const newLookupColumns: FKLookupColumn[] = [];
                    
                    // Helper to build nested FK config recursively
                    const buildNestedFK = (parentCol: string, level: {
                      fk: ForeignKeyInfo;
                      columns: string[];
                      fks: ForeignKeyInfo[];
                      selectedColumns: Set<string>;
                    }, allNestedLevels: Map<string, {
                      fk: ForeignKeyInfo;
                      columns: string[];
                      fks: ForeignKeyInfo[];
                      selectedColumns: Set<string>;
                    }>): FKLookupColumn['nestedFK'] | undefined => {
                      if (!level.selectedColumns.size) return undefined;
                      
                      // For each selected column, create a nested FK entry
                      // For now, we'll create one entry per selected column
                      const selectedCol = Array.from(level.selectedColumns)[0];
                      const deeperLevel = allNestedLevels.get(selectedCol);
                      
                      return {
                        fk: level.fk,
                        lookupColumn: selectedCol,
                        // Recursively build deeper nested FK if exists
                        ...(deeperLevel && deeperLevel.selectedColumns.size ? {
                          nestedFK: buildNestedFK(selectedCol, deeperLevel, allNestedLevels)
                        } : {}),
                      } as FKLookupColumn['nestedFK'];
                    };
                    
                    // Add all selected columns from the first level
                    for (const colName of fkRecordModalNestedSelection.selectedColumns) {
                      const nestedLevel = fkRecordModalNestedSelection.nestedLevels.get(colName);
                      
                      if (nestedLevel && nestedLevel.selectedColumns.size > 0) {
                        // Has nested selection - build recursive nested FK
                        const nestedFK = buildNestedFK(colName, nestedLevel, fkRecordModalNestedSelection.nestedLevels);
                        if (nestedFK) {
                          newLookupColumns.push({
                            fk: fkRecordModalData.fk,
                            lookupColumn: fkRecordModalNestedSelection.columnName,
                            nestedFK: {
                              fk: fkRecordModalNestedSelection.fk,
                              lookupColumn: colName,
                              nestedFK: nestedFK,
                            },
                          });
                        }
                      } else {
                        // Direct lookup - no nesting
                        newLookupColumns.push({
                          fk: fkRecordModalData.fk,
                          lookupColumn: fkRecordModalNestedSelection.columnName,
                          nestedFK: {
                            fk: fkRecordModalNestedSelection.fk,
                            lookupColumn: colName,
                          },
                        });
                      }
                    }
                    
                    // Merge with existing, avoiding duplicates
                    const allLookupColumns = [...existingLookupColumns];
                    for (const newLC of newLookupColumns) {
                      const exists = allLookupColumns.some(lc => 
                        lc.lookupColumn === newLC.lookupColumn &&
                        (!lc.nestedFK && !newLC.nestedFK || 
                         (lc.nestedFK && newLC.nestedFK &&
                          lc.nestedFK.lookupColumn === newLC.nestedFK.lookupColumn &&
                          lc.nestedFK.fk.referencedTable === newLC.nestedFK.fk.referencedTable))
                      );
                      if (!exists) {
                        allLookupColumns.push(newLC);
                      }
                    }
                    
                    newConfig[fkRecordModalData.fkColumn] = {
                      lookupColumns: allLookupColumns,
                    };
                    
                    onFKLookupConfigChange(newConfig);
                    setFKRecordModalNestedSelection(null);
                  }}
                >
                  <Text style={styles.fkRecordApplyButtonText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Format Configuration Modal */}
      {showFormatConfigModal && formatConfigColumn && (
        <Modal
          visible={showFormatConfigModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowFormatConfigModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowFormatConfigModal(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={styles.formatConfigModalContent}>
                <View style={styles.formatConfigModalHeader}>
                  <Text style={styles.formatConfigModalTitle}>
                    Format: {formatConfigColumn}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowFormatConfigModal(false)}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.formatConfigModalPanels}>
                  {/* Left Panel: Format Type Selection */}
                  <View style={styles.formatConfigLeftPanel}>
                    <Text style={styles.formatConfigPanelTitle}>Format Type</Text>
                    <ScrollView style={styles.formatConfigPanelScroll}>
                      {formatterRegistry.getAll()
                        .filter((formatter) => formatter.type !== 'auto')
                        .map((formatter) => (
                          <TouchableOpacity
                            key={formatter.type}
                            style={[
                              styles.formatConfigOption,
                              formatConfigType === formatter.type && styles.formatConfigOptionSelected,
                            ]}
                            onPress={() => {
                              setFormatConfigType(formatter.type);
                              setFormatConfigOptions(formatter.getDefaultOptions());
                            }}
                          >
                            <Text style={[
                              styles.formatConfigOptionText,
                              formatConfigType === formatter.type && styles.formatConfigOptionTextSelected,
                            ]}>
                              {formatter.displayName}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>

                  {/* Right Panel: Format Options */}
                  <View style={styles.formatConfigRightPanel}>
                    <Text style={styles.formatConfigPanelTitle}>Options</Text>
                    <ScrollView style={styles.formatConfigPanelScroll}>
                      {(() => {
                        const formatter = formatterRegistry.get(formatConfigType);
                        if (!formatter || formatConfigType === 'year' || formatConfigType === 'suffixes') {
                          return (
                            <View style={styles.formatConfigNoOptions}>
                              <Text style={styles.formatConfigNoOptionsText}>
                                No options available for this format type.
                              </Text>
                            </View>
                          );
                        }

                        return (
                          <>
                            {/* Currency Symbol */}
                            {formatConfigType === 'currency' && (
                              <View style={styles.formatConfigSection}>
                                <Text style={styles.formatConfigSectionTitle}>Currency Symbol</Text>
                                <TextInput
                                  style={styles.formatConfigInput}
                                  value={formatConfigOptions.currencySymbol || '$'}
                                  onChangeText={(text) => setFormatConfigOptions({ ...formatConfigOptions, currencySymbol: text })}
                                  placeholder="$"
                                />
                              </View>
                            )}

                            {/* Date Format Options */}
                            {formatConfigType === 'date' && (
                              <>
                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Date Format</Text>
                                  {['M/D/Y', 'D/M/Y', 'Y-M-D', 'M-D-Y', 'D M Y', 'M D, Y'].map((format) => (
                                    <TouchableOpacity
                                      key={format}
                                      style={[
                                        styles.formatConfigOption,
                                        formatConfigOptions.dateFormat === format && styles.formatConfigOptionSelected,
                                      ]}
                                      onPress={() => setFormatConfigOptions({ ...formatConfigOptions, dateFormat: format })}
                                    >
                                      <Text style={[
                                        styles.formatConfigOptionText,
                                        formatConfigOptions.dateFormat === format && styles.formatConfigOptionTextSelected,
                                      ]}>
                                        {format}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>

                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Time Format</Text>
                                  <TouchableOpacity
                                    style={[
                                      styles.formatConfigOption,
                                      formatConfigOptions.timeFormat === '12h' && styles.formatConfigOptionSelected,
                                    ]}
                                    onPress={() => setFormatConfigOptions({ ...formatConfigOptions, timeFormat: '12h' })}
                                  >
                                    <Text style={[
                                      styles.formatConfigOptionText,
                                      formatConfigOptions.timeFormat === '12h' && styles.formatConfigOptionTextSelected,
                                    ]}>
                                      12-hour (AM/PM)
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[
                                      styles.formatConfigOption,
                                      formatConfigOptions.timeFormat === '24h' && styles.formatConfigOptionSelected,
                                    ]}
                                    onPress={() => setFormatConfigOptions({ ...formatConfigOptions, timeFormat: '24h' })}
                                  >
                                    <Text style={[
                                      styles.formatConfigOptionText,
                                      formatConfigOptions.timeFormat === '24h' && styles.formatConfigOptionTextSelected,
                                    ]}>
                                      24-hour
                                    </Text>
                                  </TouchableOpacity>
                                </View>

                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Show Time</Text>
                                  <TouchableOpacity
                                    style={styles.formatConfigToggle}
                                    onPress={() => setFormatConfigOptions({ 
                                      ...formatConfigOptions, 
                                      showTime: !(formatConfigOptions.showTime !== false) 
                                    })}
                                  >
                                    <Text style={styles.formatConfigToggleText}>
                                      {(formatConfigOptions.showTime !== false) ? '✓ Enabled' : '○ Disabled'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>

                                {(formatConfigOptions.showTime !== false) && (
                                  <View style={styles.formatConfigSection}>
                                    <Text style={styles.formatConfigSectionTitle}>Show Seconds</Text>
                                    <TouchableOpacity
                                      style={styles.formatConfigToggle}
                                      onPress={() => setFormatConfigOptions({ 
                                        ...formatConfigOptions, 
                                        showSeconds: !(formatConfigOptions.showSeconds || false) 
                                      })}
                                    >
                                      <Text style={styles.formatConfigToggleText}>
                                        {(formatConfigOptions.showSeconds || false) ? '✓ Enabled' : '○ Disabled'}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                )}

                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Timezone</Text>
                                  <TouchableOpacity
                                    style={[
                                      styles.formatConfigOption,
                                      (formatConfigOptions.timezone || 'local') === 'local' && styles.formatConfigOptionSelected,
                                    ]}
                                    onPress={() => setFormatConfigOptions({ ...formatConfigOptions, timezone: 'local' })}
                                  >
                                    <Text style={[
                                      styles.formatConfigOptionText,
                                      (formatConfigOptions.timezone || 'local') === 'local' && styles.formatConfigOptionTextSelected,
                                    ]}>
                                      Local
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[
                                      styles.formatConfigOption,
                                      formatConfigOptions.timezone === 'utc' && styles.formatConfigOptionSelected,
                                    ]}
                                    onPress={() => setFormatConfigOptions({ ...formatConfigOptions, timezone: 'utc' })}
                                  >
                                    <Text style={[
                                      styles.formatConfigOptionText,
                                      formatConfigOptions.timezone === 'utc' && styles.formatConfigOptionTextSelected,
                                    ]}>
                                      UTC
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </>
                            )}

                            {/* Decimal Places */}
                            {(formatConfigType === 'currency' || formatConfigType === 'commas' || 
                              formatConfigType === 'scientific' || formatConfigType === 'plain' ||
                              formatConfigType === 'percent') && (
                              <View style={styles.formatConfigSection}>
                                <Text style={styles.formatConfigSectionTitle}>Decimal Places</Text>
                                <TextInput
                                  style={styles.formatConfigInput}
                                  value={String(formatConfigOptions.decimalPlaces ?? formatter.getDefaultOptions().decimalPlaces ?? 2)}
                                  onChangeText={(text) => {
                                    const num = parseInt(text, 10);
                                    if (!isNaN(num) && num >= 0 && num <= 20) {
                                      setFormatConfigOptions({ ...formatConfigOptions, decimalPlaces: num });
                                    }
                                  }}
                                  keyboardType="numeric"
                                  placeholder="2"
                                />
                              </View>
                            )}

                            {/* Units Format Options */}
                            {formatConfigType === 'units' && (
                              <>
                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Unit</Text>
                                  <Text style={styles.formatConfigSectionSubtitle}>Common Units</Text>
                                  <View style={styles.formatConfigUnitsGrid}>
                                    {['ft', 'm', 'yd', 'in', 'mi', 'km', 'cm', 'mm', 'lbs', 'kg', 'oz', 'g', 'cups', 'ml', 'l', 'gal', 'pt', 'qt'].map((unit) => (
                                      <TouchableOpacity
                                        key={unit}
                                        style={[
                                          styles.formatConfigUnitButton,
                                          formatConfigOptions.unit === unit && styles.formatConfigUnitButtonSelected,
                                        ]}
                                        onPress={() => setFormatConfigOptions({ ...formatConfigOptions, unit })}
                                      >
                                        <Text style={[
                                          styles.formatConfigUnitButtonText,
                                          formatConfigOptions.unit === unit && styles.formatConfigUnitButtonTextSelected,
                                        ]}>
                                          {unit}
                                        </Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                  <Text style={[styles.formatConfigSectionSubtitle, { marginTop: 16 }]}>Custom Unit</Text>
                                  <TextInput
                                    style={styles.formatConfigInput}
                                    value={formatConfigOptions.unit || ''}
                                    onChangeText={(text) => {
                                      setFormatConfigOptions({ ...formatConfigOptions, unit: text });
                                    }}
                                    placeholder="Enter custom unit"
                                  />
                                </View>

                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Decimal Places</Text>
                                  <TextInput
                                    style={styles.formatConfigInput}
                                    value={String(formatConfigOptions.decimalPlaces ?? 0)}
                                    onChangeText={(text) => {
                                      const num = parseInt(text, 10);
                                      if (!isNaN(num) && num >= 0 && num <= 20) {
                                        setFormatConfigOptions({ ...formatConfigOptions, decimalPlaces: num });
                                      }
                                    }}
                                    keyboardType="numeric"
                                    placeholder="0"
                                  />
                                </View>

                                <View style={styles.formatConfigSection}>
                                  <Text style={styles.formatConfigSectionTitle}>Use Thousands Separator</Text>
                                  <TouchableOpacity
                                    style={styles.formatConfigToggle}
                                    onPress={() => setFormatConfigOptions({ 
                                      ...formatConfigOptions, 
                                      useGrouping: !(formatConfigOptions.useGrouping ?? false) 
                                    })}
                                  >
                                    <Text style={styles.formatConfigToggleText}>
                                      {(formatConfigOptions.useGrouping ?? false) ? '✓ Enabled' : '○ Disabled'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </>
                            )}

                            {/* Use Grouping (commas) */}
                            {(formatConfigType === 'currency' || formatConfigType === 'commas') && (
                              <View style={styles.formatConfigSection}>
                                <Text style={styles.formatConfigSectionTitle}>Use Thousands Separator</Text>
                                <TouchableOpacity
                                  style={styles.formatConfigToggle}
                                  onPress={() => setFormatConfigOptions({ 
                                    ...formatConfigOptions, 
                                    useGrouping: !(formatConfigOptions.useGrouping ?? true) 
                                  })}
                                >
                                  <Text style={styles.formatConfigToggleText}>
                                    {(formatConfigOptions.useGrouping ?? true) ? '✓ Enabled' : '○ Disabled'}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </>
                        );
                      })()}
                    </ScrollView>
                  </View>
                </View>
                <View style={styles.formatConfigModalFooter}>
                  <TouchableOpacity
                    style={[styles.formatConfigButton, styles.formatConfigClearButton]}
                    onPress={() => {
                      const newConfigs = new Map(columnFormatConfigs);
                      newConfigs.delete(formatConfigColumn);
                      setColumnFormatConfigs(newConfigs);
                      setShowFormatConfigModal(false);
                    }}
                  >
                    <Text style={styles.formatConfigButtonText}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formatConfigButton, styles.formatConfigApplyButton]}
                    onPress={() => {
                      const newConfigs = new Map(columnFormatConfigs);
                      const formatter = formatterRegistry.get(formatConfigType);
                      const validatedOptions = formatter 
                        ? formatter.validateOptions(formatConfigOptions)
                        : formatConfigOptions;
                      
                      newConfigs.set(formatConfigColumn!, {
                        type: formatConfigType,
                        options: validatedOptions,
                      });
                      setColumnFormatConfigs(newConfigs);
                      setShowFormatConfigModal(false);
                    }}
                  >
                    <Text style={styles.formatConfigButtonText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

// @ts-ignore
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
  tableContainer: {
    flex: 1,
  },
  tableScroll: {
    flex: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#667eea',
    borderBottomWidth: 2,
    borderBottomColor: '#5568d3',
    maxHeight: 36,
  },
  tableHeaderCell: {
    padding: 12,
    borderRightWidth: 1,
    borderRightColor: '#5568d3',
    justifyContent: 'center',
    position: 'relative',
    maxHeight: 36,
  },
  headerCellContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tableHeaderText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  sortIndicator: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  filterIndicator: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  tableBodyScroll: {
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    maxHeight: 36,
  },
  tableCell: {
    padding: 10,
    borderRightWidth: 1,
    borderRightColor: '#f0f0f0',
    justifyContent: 'center',
    maxHeight: 36,
    overflow: 'visible',
  },
  tableCellText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    includeFontPadding: false,
  },
  tableCellTextDate: {
    fontSize: 11,
    color: '#333',
    fontFamily: 'monospace',
    includeFontPadding: false,
  },
  nullValueText: {
    color: '#bbb',
    fontStyle: 'normal',
  },
  checkboxContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderColor: '#ccc',
    borderRadius: 3,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: '#667eea',
    backgroundColor: '#667eea',
  },
  checkboxCheckmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  colorCellContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  urlLink: {
    color: '#0066cc',
    textDecorationLine: 'underline',
  },
  enumChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  enumChipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  numberSuffix: {
    paddingLeft: 3, // Half-space effect using padding
    color: '#888',
  },
  emptyRow: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
    fontStyle: 'italic',
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  paginationRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  csvDownloadIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  csvDownloadIconText: {
    color: '#666',
    fontSize: 16,
  },
  paginationButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#667eea',
    borderRadius: 4,
  },
  paginationButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.5,
  },
  paginationButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  paginationText: {
    fontSize: 14,
    color: '#666',
  },
  paginationWarning: {
    fontSize: 12,
    color: '#ff9800',
    fontStyle: 'italic',
  },
  disabledInput: {
    backgroundColor: '#f5f5f5',
    opacity: 0.6,
  },
  disabledHeader: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenColumnsModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '80%',
    maxWidth: 400,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  hiddenColumnsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  hiddenColumnsModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 24,
    color: '#666',
  },
  hiddenColumnsModalBody: {
    maxHeight: 400,
  },
  hiddenColumnItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  hiddenColumnItemText: {
    fontSize: 14,
    color: '#333',
  },
  filterModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '95%',
    maxWidth: 800,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  filterModalBody: {
    padding: 20,
  },
  filterSection: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  filterModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    minWidth: 80,
    alignItems: 'center',
  },
  filterApplyButton: {
    backgroundColor: '#667eea',
  },
  filterClearButton: {
    backgroundColor: '#ccc',
  },
  filterButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  filterRowLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginRight: 12,
    minWidth: 70,
  },
  filterInputSmall: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    width: 100,
  },
  filterCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  filterCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#667eea',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  filterCheckboxChecked: {
    backgroundColor: '#667eea',
  },
  filterCheckboxCheckmark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  filterCheckboxLabel: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  filterTypeSelector: {
    marginBottom: 16,
  },
  filterTypeButtons: {
    flexDirection: 'row',
    marginTop: 8,
  },
  filterTypeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterTypeButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  filterTypeButtonText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  filterTypeButtonTextActive: {
    color: '#fff',
  },
  filterBooleanSelector: {
    marginBottom: 16,
  },
  filterBooleanButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  filterBooleanButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  filterBooleanButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  filterBooleanButtonText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  filterBooleanButtonTextActive: {
    color: '#fff',
  },
  draggingHeader: {
    opacity: 0.3,
    backgroundColor: '#5568d3',
  },
  dragOverHeader: {
    backgroundColor: '#7c8ff0',
    borderLeftWidth: 3,
    borderLeftColor: '#fff',
  },
  draggingCell: {
    opacity: 0.3,
    backgroundColor: '#f0f0f0',
  },
  dragOverCell: {
    backgroundColor: '#e8f0ff',
    borderLeftWidth: 3,
    borderLeftColor: '#667eea',
  },
  headerCellTouchable: {
    flex: 1,
    width: '100%',
  },
  dragHandle: {
    color: '#fff',
    fontSize: 10,
    marginLeft: 4,
    opacity: 0.7,
  },
  dragHandleContainer: {
    padding: 4,
    marginRight: 4,
    cursor: 'grab',
    userSelect: 'none',
  },
  dragHandleIcon: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.8,
    lineHeight: 12,
    marginRight: 4,
  },
  draggableHeader: {
    cursor: 'grab',
  },
  hiddenColumnsIndicator: {
    width: 40,
    backgroundColor: '#667eea',
    borderRightWidth: 1,
    borderRightColor: '#5568d3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenColumnsHeader: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  hiddenColumnsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
  },
  hiddenColumnsCell: {
    width: 40,
    backgroundColor: '#fafafa',
  },
  contextMenuOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contextMenu: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 150,
  },
  contextMenuItem: {
    padding: 12,
    borderRadius: 4,
  },
  contextMenuText: {
    fontSize: 14,
    color: '#333',
  },
  contextMenuSubtext: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  tableHeaderCellContainer: {
    flexDirection: 'row',
    position: 'relative',
  },
  resizeHandle: {
    width: 6,
    backgroundColor: 'rgba(102, 126, 234, 0.1)',
    cursor: 'col-resize',
    position: 'absolute',
    right: -3,
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  resizeHandleActive: {
    backgroundColor: '#667eea',
    opacity: 0.6,
  },
  cellModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '90%',
    maxWidth: 600,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  cellModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  cellModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  cellModalBody: {
    padding: 20,
    maxHeight: 400,
  },
  cellModalValue: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  fkLinkText: {
    color: '#667eea',
    textDecorationLine: 'underline',
  },
  focusedRow: {
    backgroundColor: '#f0f4ff',
    borderLeftWidth: 3,
    borderLeftColor: '#667eea',
  },
  focusedCell: {
    backgroundColor: '#e8f0ff',
    borderLeftWidth: 2,
    borderLeftColor: '#667eea',
  },
  fkRecordModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '90%',
    maxWidth: 600,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fkRecordModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  fkRecordModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  fkRecordModalBody: {
    padding: 20,
    maxHeight: 400,
  },
  fkRecordField: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  fkRecordFieldFK: {
    backgroundColor: '#f5f5f5',
    opacity: 0.7,
  },
  fkRecordFieldActive: {
    backgroundColor: '#e8f0ff',
  },
  fkRecordFieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    width: 150,
    marginRight: 16,
  },
  fkRecordFieldLabelFK: {
    color: '#999',
    fontStyle: 'italic',
  },
  fkRecordFieldLabelActive: {
    color: '#667eea',
  },
  fkRecordFieldValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
    fontFamily: 'monospace',
  },
  fkRecordFieldValueFK: {
    color: '#999',
  },
  fkRecordToggleIconButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  fkRecordToggleIconButtonAdd: {
    backgroundColor: '#9eb5d4',
  },
  fkRecordToggleIconButtonRemove: {
    backgroundColor: '#d4a5a5',
  },
  fkRecordToggleIconButtonPlaceholder: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  fkRecordToggleIconButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
    lineHeight: 20,
  },
  fkRecordModalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  fkRecordViewLink: {
    alignItems: 'flex-end',
  },
  fkRecordViewLinkText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  fkHoverModal: {
    backgroundColor: '#fff',
    borderRadius: 8,
    width: 280,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  fkHoverModalContent: {
    padding: 12,
    maxHeight: 280,
  },
  fkHoverModalRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  fkHoverModalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    width: 80,
    marginRight: 8,
  },
  fkHoverModalValue: {
    fontSize: 12,
    color: '#333',
    flex: 1,
    fontFamily: 'monospace',
  },
  fkHoverModalText: {
    fontSize: 12,
    color: '#666',
    padding: 12,
  },
  fkHoverModalMore: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
    paddingTop: 4,
    textAlign: 'center',
  },
  fkHoverModalLink: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  fkHoverModalLinkText: {
    color: '#667eea',
    fontSize: 12,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  fkConfigModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '95%',
    maxWidth: 900,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  fkConfigModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  fkConfigModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  fkConfigModalBody: {
    padding: 20,
    flex: 1,
  },
  fkConfigModalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  fkConfigModalSubLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  fkConfigCascadingContainer: {
    flex: 1,
  },
  fkConfigCascadingContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  fkConfigLevelPanel: {
    width: 250,
    marginRight: 12,
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    paddingRight: 12,
  },
  fkConfigLevelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#667eea',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  fkConfigLevelColumnsList: {
    maxHeight: 400,
  },
  fkConfigColumnsList: {
    maxHeight: 300,
  },
  fkConfigColumnItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  fkConfigColumnItemFK: {
    backgroundColor: '#f5f5f5',
    opacity: 0.7,
  },
  fkConfigColumnItemActive: {
    backgroundColor: '#e8f0ff',
  },
  fkConfigColumnItemText: {
    fontSize: 14,
    color: '#333',
  },
  fkConfigColumnItemTextFK: {
    color: '#999',
    fontStyle: 'italic',
  },
  fkConfigColumnItemTextActive: {
    color: '#667eea',
    fontWeight: '600',
  },
  fkConfigLoadingText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    padding: 20,
  },
  fkConfigColumnItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fkConfigColumnItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  fkConfigColumnFKIndicator: {
    fontSize: 12,
    color: '#667eea',
    fontStyle: 'italic',
    marginLeft: 8,
  },
  fkConfigToggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#667eea',
    borderRadius: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  fkConfigToggleButtonActive: {
    backgroundColor: '#dc3545',
  },
  fkConfigToggleButtonText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  fkConfigToggleButtonTextActive: {
    color: '#fff',
  },
  fkConfigCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  fkConfigCheckboxText: {
    fontSize: 14,
    color: '#667eea',
    fontWeight: 'bold',
  },
  fkConfigExpandButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  fkConfigExpandButtonText: {
    fontSize: 12,
    color: '#667eea',
  },
  fkRecordApplyButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
  },
  fkRecordApplyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  formatConfigModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '95%',
    maxWidth: 1500,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  formatConfigModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  formatConfigModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  formatConfigModalPanels: {
    flexDirection: 'row',
    flex: 1,
    minHeight: 400,
  },
  formatConfigLeftPanel: {
    flex: 0.35,
    minWidth: 250,
    borderRightWidth: 1,
    borderRightColor: '#e0e0e0',
    flexDirection: 'column',
  },
  formatConfigRightPanel: {
    flex: 0.7,
    minWidth: 300,
    flexDirection: 'column',
  },
  formatConfigPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#f8f9fa',
  },
  formatConfigPanelScroll: {
    flex: 1,
    padding: 16,
  },
  formatConfigModalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 12,
    justifyContent: 'flex-end',
  },
  formatConfigNoOptions: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatConfigNoOptionsText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  formatConfigSection: {
    marginBottom: 24,
  },
  formatConfigSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  formatConfigSectionSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 8,
    marginTop: 4,
  },
  formatConfigUnitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  formatConfigUnitButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minWidth: 50,
    alignItems: 'center',
  },
  formatConfigUnitButtonSelected: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  formatConfigUnitButtonText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  formatConfigUnitButtonTextSelected: {
    color: '#fff',
  },
  formatConfigOption: {
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  formatConfigOptionSelected: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  formatConfigOptionText: {
    fontSize: 14,
    color: '#333',
  },
  formatConfigOptionTextSelected: {
    color: '#fff',
    fontWeight: '500',
  },
  formatConfigInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  formatConfigToggle: {
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  formatConfigToggleText: {
    fontSize: 14,
    color: '#333',
  },
  formatConfigButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 6,
    alignItems: 'center',
  },
  formatConfigClearButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  formatConfigApplyButton: {
    backgroundColor: '#667eea',
  },
  formatConfigButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  csvExportModalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '90%',
    maxWidth: 500,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  csvExportModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  csvExportModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  csvExportModalBody: {
    padding: 16,
  },
  csvExportModalDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  csvExportFormatSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  csvExportFormatButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  csvExportFormatButtonSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f0f4ff',
  },
  csvExportFormatButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  csvExportFormatButtonTextSelected: {
    color: '#667eea',
  },
  csvExportOption: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  csvExportOptionSelected: {
    borderColor: '#667eea',
    backgroundColor: '#f0f4ff',
  },
  csvExportOptionContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  csvExportRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ccc',
    marginRight: 12,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  csvExportRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#667eea',
  },
  csvExportOptionText: {
    flex: 1,
  },
  csvExportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  csvExportOptionDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  csvExportModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  csvExportButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  csvExportCancelButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  csvExportDownloadButton: {
    backgroundColor: '#667eea',
  },
  csvExportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});


