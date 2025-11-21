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

export interface FKLookupConfig {
  [columnName: string]: {
    fk: ForeignKeyInfo;
    lookupColumn: string;
    nestedFK?: {
      // If the lookup column is itself an FK, this contains the nested FK config
      fk: ForeignKeyInfo;
      lookupColumn: string;
    };
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
  const headerRefs = useRef<Map<string, any>>(new Map());
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
  
  // Cascading FK selection state - tracks the path of FK selections
  type FKSelectionLevel = {
    tableName: string;
    columns: string[];
    fks: ForeignKeyInfo[];
    selectedColumn?: string;
    selectedFK?: ForeignKeyInfo;
  };
  const [fkConfigSelectionPath, setFKConfigSelectionPath] = useState<FKSelectionLevel[]>([]);

  const defaultFormatValue = useCallback((value: any): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }, []);

  const formatCellValue = useCallback((value: any, column: string): string => {
    if (formatValue) {
      return formatValue(value, column);
    }
    return defaultFormatValue(value);
  }, [formatValue, defaultFormatValue]);

  const isValueNull = useCallback((value: any): boolean => {
    return value === null || value === undefined;
  }, []);

  // Get column width (default 150)
  const getColumnWidth = useCallback((columnName: string): number => {
    return columnWidths.get(columnName) ?? 150;
  }, [columnWidths]);

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

  // Handle cell click to show modal
  const handleCellClick = useCallback((value: any, columnName: string) => {
    setCellModalValue(value);
    setCellModalColumn(columnName);
    setShowCellModal(true);
  }, []);

  // Set up resize handlers for web
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
  
  // Get paginated rows
  const paginatedRows = useMemo(() => {
    if (filterDisabled) {
      // When disabled, use original rows (pagination is handled server-side)
      return rows;
    }
    // When enabled, paginate the filtered/sorted rows
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredAndSortedRows.slice(startIndex, endIndex);
  }, [rows, filteredAndSortedRows, page, pageSize, filterDisabled]);

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
              {paginatedRows.map((row, rowIndex) => (
                <View key={row.id} style={styles.tableRow}>
                  {getOrderedVisibleColumns.map((col, colIndex) => {
                    const value = row[col.name];
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
                        ]}
                        onPress={() => {
                          // Check if this is an FK column with lookup data
                          const fkConfig = fkLookupConfig[col.name];
                          if (fkConfig && !isNull && onFKCellClick) {
                            onFKCellClick(col.name, value, fkConfig.fk);
                          } else {
                            handleCellClick(value, col.name);
                          }
                        }}
                        activeOpacity={0.7}
                      >
                        {(() => {
                          // Check if this column is a foreign key with lookup data
                          const fkConfig = fkLookupConfig[col.name];
                          if (fkConfig && !isNull) {
                            const lookupData = fkLookupData.get(col.name);
                            const lookupValue = lookupData?.get(value);
                            
                            if (lookupValue !== undefined) {
                              // Show FK lookup value as clickable link
                              return (
                                <Text
                                  style={[
                                    styles.tableCellText,
                                    styles.fkLinkText,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {formatCellValue(lookupValue, col.name)} →
                                </Text>
                              );
                            } else {
                              // FK value exists but lookup not loaded yet - show loading or fallback
                              return (
                                <Text
                                  style={[
                                    styles.tableCellText,
                                    isNull && styles.nullValueText,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {formatCellValue(value, col.name)} (loading...)
                                </Text>
                              );
                            }
                          }
                          
                          // Regular cell display
                          return (
                            <Text
                              style={[
                                styles.tableCellText,
                                isNull && styles.nullValueText,
                              ]}
                              numberOfLines={1}
                            >
                              {isNull ? '?' : formatCellValue(value, col.name)}
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
              ))}
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
          <TouchableOpacity
            style={[styles.paginationButton, page >= totalPages && styles.paginationButtonDisabled]}
            onPress={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            <Text style={styles.paginationButtonText}>Next</Text>
          </TouchableOpacity>
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
                    Configure FK Lookup ({fkLookupConfig[contextMenuColumn].lookupColumn})
                  </Text>
                </TouchableOpacity>
              )}
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
                    Select lookup column (click FK columns to expand):
                  </Text>
                  <ScrollView 
                    horizontal 
                    style={styles.fkConfigCascadingContainer}
                    contentContainerStyle={styles.fkConfigCascadingContent}
                  >
                    {fkConfigSelectionPath.map((level, levelIndex) => (
                      <View key={levelIndex} style={styles.fkConfigLevelPanel}>
                        <Text style={styles.fkConfigLevelTitle}>
                          {level.tableName}
                        </Text>
                        <ScrollView style={styles.fkConfigLevelColumnsList}>
                          {level.columns.map((colName) => {
                            const isSelected = level.selectedColumn === colName;
                            const isFKColumn = level.fks.some(fk => fk.columns.includes(colName));
                            const columnFK = isFKColumn ? level.fks.find(fk => fk.columns.includes(colName)) : null;
                            
                            return (
                              <TouchableOpacity
                                key={colName}
                                style={[
                                  styles.fkConfigColumnItem,
                                  isSelected && styles.fkConfigColumnItemSelected,
                                ]}
                                onPress={async () => {
                                  if (isFKColumn && columnFK && onFKConfigColumnsRequest && onFKConfigReferencedTableFKsRequest) {
                                    // This column is an FK - expand to show its referenced table
                                    try {
                                      const nestedColumns = await onFKConfigColumnsRequest(colName, columnFK);
                                      const nestedFKs = await onFKConfigReferencedTableFKsRequest(columnFK.referencedTable);
                                      
                                      // Update current level selection
                                      const updatedPath = [...fkConfigSelectionPath];
                                      updatedPath[levelIndex] = {
                                        ...level,
                                        selectedColumn: colName,
                                        selectedFK: columnFK,
                                      };
                                      
                                      // Add new level
                                      updatedPath.push({
                                        tableName: columnFK.referencedTable,
                                        columns: nestedColumns,
                                        fks: nestedFKs,
                                      });
                                      
                                      setFKConfigSelectionPath(updatedPath);
                                    } catch (err) {
                                      console.error('[FK Config] Error loading nested FK columns:', err);
                                    }
                                  } else {
                                    // This is a regular column - apply the config
                                    const newConfig = { ...fkLookupConfig };
                                    
                                    // Build nested FK config from the selection path
                                    // The path represents: level0 -> level1 -> level2 -> ... -> final column
                                    // We need to build: baseLookupColumn with nestedFK chain
                                    
                                    // Get the base lookup column (from first level)
                                    const baseLevel = fkConfigSelectionPath[0];
                                    const baseLookupColumn = baseLevel?.selectedColumn || colName;
                                    
                                    // Build nested FK config recursively from the path
                                    // The path structure:
                                    // - Level 0: base table (presidents), selectedColumn: person_id (FK), selectedFK: FK to people
                                    // - Level 1: nested table (people), selectedColumn: last_name
                                    // We need to build: { fk: FK from person_id to people, lookupColumn: last_name }
                                    
                                    // Check if level 0's selected column is an FK (this creates the first nested level)
                                    const baseLevelFK = baseLevel?.fks?.find(fk => 
                                      fk.columns.includes(baseLookupColumn)
                                    );
                                    
                                    // If we have a nested FK chain (base column is FK and we have more levels)
                                    let nestedFKConfig: FKLookupConfig[string]['nestedFK'] | undefined = undefined;
                                    if (baseLevelFK && fkConfigSelectionPath.length > 1) {
                                      // Build nested FK config
                                      // The nested FK uses the FK from level 0, and the lookup column from level 1
                                      nestedFKConfig = {
                                        fk: {
                                          columns: baseLevelFK.columns,
                                          referencedTable: baseLevelFK.referencedTable,
                                          referencedColumns: baseLevelFK.referencedColumns,
                                        },
                                        lookupColumn: levelIndex === 1 ? colName : (fkConfigSelectionPath[1]?.selectedColumn || colName),
                                      };
                                    }
                                    
                                    console.log('[FK Config Modal] Building config:', {
                                      fkConfigColumn,
                                      baseLookupColumn,
                                      baseLevelFK: baseLevelFK ? {
                                        columns: baseLevelFK.columns,
                                        referencedTable: baseLevelFK.referencedTable,
                                      } : null,
                                      pathLength: fkConfigSelectionPath.length,
                                      hasNestedFK: !!nestedFKConfig,
                                      nestedFKConfig,
                                    });
                                    
                                    newConfig[fkConfigColumn] = {
                                      ...newConfig[fkConfigColumn],
                                      lookupColumn: baseLookupColumn,
                                      ...(nestedFKConfig && { nestedFK: nestedFKConfig }),
                                    };
                                    
                                    onFKLookupConfigChange(newConfig);
                                    setShowFKConfigModal(false);
                                    setFKConfigSelectionPath([]);
                                  }
                                }}
                              >
                                <View style={styles.fkConfigColumnItemContent}>
                                  <Text
                                    style={[
                                      styles.fkConfigColumnItemText,
                                      isSelected && styles.fkConfigColumnItemTextSelected,
                                    ]}
                                  >
                                    {colName}
                                    {isSelected && ' ✓'}
                                  </Text>
                                  {isFKColumn && (
                                    <Text style={styles.fkConfigColumnFKIndicator}>
                                      → FK
                                    </Text>
                                  )}
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    ))}
                  </ScrollView>
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
    padding: 12,
    borderRightWidth: 1,
    borderRightColor: '#f0f0f0',
    justifyContent: 'center',
    maxHeight: 36,
  },
  tableCellText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
  },
  nullValueText: {
    color: '#bbb',
    fontStyle: 'normal',
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
  fkConfigColumnItemSelected: {
    backgroundColor: '#e8f0ff',
  },
  fkConfigColumnItemText: {
    fontSize: 14,
    color: '#333',
  },
  fkConfigColumnItemTextSelected: {
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
  fkConfigColumnFKIndicator: {
    fontSize: 12,
    color: '#667eea',
    fontStyle: 'italic',
    marginLeft: 8,
  },
});


