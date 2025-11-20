/**
 * Hook for loading table data from a database
 * 
 * Handles all database-specific logic: connections, queries, caching.
 * Returns generic data structures that the TableViewer can consume.
 */

import { useState, useEffect, useCallback } from 'react';
import { sql } from 'drizzle-orm';
import { connect, getRegistryEntry } from "../xp-schema";

export interface TableColumn {
  name: string;
  label?: string;
  dataType?: string;
}

export interface TableRow {
  id: string;
  [key: string]: any;
}

export interface UseTableDataOptions {
  dbName: string;
  tableName: string;
  page: number;
  pageSize: number;
  sortBy: string | null;
  sortOrder: 'asc' | 'desc';
  filter: string;
}

export interface UseTableDataResult {
  columns: TableColumn[];
  rows: TableRow[];
  totalRowCount: number;
  loading: boolean;
  error: string | null;
}

export function useTableData(options: UseTableDataOptions): UseTableDataResult {
  const { dbName, tableName, page, pageSize, sortBy, sortOrder, filter } = options;
  
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [totalRowCount, setTotalRowCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Cache for table data
  const [tableDataCache, setTableDataCache] = useState<Record<string, {
    columns: TableColumn[];
    rows: TableRow[];
    totalRowCount: number;
    timestamp: number;
  }>>({});
  
  const loadTableData = useCallback(async (targetTable?: string, useCache = true) => {
    const currentTable = targetTable || tableName;
    if (!dbName || !currentTable) return;
    
    // Check cache first
    const cacheKey = `${currentTable}-${page}-${pageSize}-${sortBy}-${sortOrder}-${filter}`;
    if (useCache && tableDataCache[cacheKey]) {
      const cached = tableDataCache[cacheKey];
      if (Date.now() - cached.timestamp < 30000) {
        setColumns(cached.columns);
        setRows(cached.rows);
        setTotalRowCount(cached.totalRowCount);
        setLoading(false);
        return;
      }
    }
    
    try {
      setLoading(true);
      setError(null);

      // Connect to database
      const entry = await getRegistryEntry(dbName);
      if (!entry) {
        throw new Error(`Database ${dbName} not found in registry`);
      }
      const db = await connect(entry);
      
      // Get column information using database method (dialect-agnostic)
      let tableColumns: TableColumn[] = [];
      try {
        const columnInfo = await db.getTableColumns(currentTable);
        tableColumns = columnInfo.map((col) => ({
          name: col.name,
          dataType: col.dataType,
        }));
      } catch (err) {
        console.error(`[useTableData] Error getting column info:`, err);
        // Fallback: try to infer columns from first row if available
      }
      
      // If we couldn't get columns, we'll infer them from the data
      // This will be handled after we fetch the rows
      
      // Get total row count - no filtering here, that's done client-side
      const totalCount = await db.getRowCount(currentTable);
      console.log(`[useTableData] Total count for ${currentTable}:`, totalCount);
      
      // Build query - no client-side filtering or sorting here
      // Those are handled in the TableViewer component
      let query = `SELECT * FROM "${currentTable}"`;
      
      // Only apply pagination if we're actually paginating
      // When not paginated (totalRowCount <= pageSize and page === 1), load all rows
      // for client-side filtering/sorting. Otherwise, paginate.
      const isPaginated = totalCount > pageSize || page > 1;
      if (isPaginated) {
        const offset = (page - 1) * pageSize;
        query += ` LIMIT ${pageSize} OFFSET ${offset}`;
      }
      
      console.log(`[useTableData] Data query for ${currentTable}:`, query);
      const queryRows = await db.execute(sql.raw(query)) as any[];
      console.log(`[useTableData] Data query result for ${currentTable}:`, queryRows.length, 'rows');
      console.log(`[useTableData] First row sample:`, queryRows[0]);
      
      // If we don't have column info yet, infer from first row
      if (tableColumns.length === 0 && queryRows.length > 0) {
        const firstRow = queryRows[0];
        tableColumns = Object.keys(firstRow).map((key) => ({
          name: key,
          dataType: typeof firstRow[key],
        }));
      }
      
      // Convert to TableRow format
      const offset = isPaginated ? (page - 1) * pageSize : 0;
      const tableRows: TableRow[] = queryRows.map((row, index) => ({
        id: row.id || `row-${currentTable}-${offset + index}`,
        ...row,
      }));
      
      // Only update if this is the active table
      if (currentTable === tableName) {
        setColumns(tableColumns);
        setRows(tableRows);
        setTotalRowCount(totalCount);
      }
      
      // Cache the data
      setTableDataCache(prev => ({
        ...prev,
        [cacheKey]: {
          columns: tableColumns,
          rows: tableRows,
          totalRowCount: totalCount,
          timestamp: Date.now(),
        },
      }));
    } catch (err) {
      console.error(`[useTableData] Error loading table data:`, err);
      if (currentTable === tableName) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (currentTable === tableName) {
        setLoading(false);
      }
    }
  }, [dbName, tableName, page, pageSize, sortBy, sortOrder, filter, tableDataCache]);
  
  // Load data when options change
  useEffect(() => {
    if (dbName && tableName) {
      loadTableData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbName, tableName, page, pageSize, sortBy, sortOrder, filter]);
  
  return {
    columns,
    rows,
    totalRowCount,
    loading,
    error,
  };
}

