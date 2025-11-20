/**
 * Driver Browser - Table View Page
 *
 * Displays table data with sorting, filtering, pagination, and column visibility.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { connect, getRegistryEntries } from '../xp-schema';
import { sql } from 'drizzle-orm';
import TableViewer, { TableViewerColumn, TableViewerRow } from '../components/TableViewer';
import QueryEditor from '../components/QueryEditor';
import DatabaseBrowserLayout, { SidebarContext, NavigateCallback } from '../components/DatabaseBrowserLayout';

/**
 * Parse SQL query to extract table name and detect if it's a complex query
 * Returns { tableName: string | null, isComplex: boolean }
 */
function parseQuery(query: string): { tableName: string | null; isComplex: boolean } {
    if (!query || !query.trim()) {
        return { tableName: null, isComplex: false };
    }

    // First, try to extract table name from the query
    // Pattern: SELECT ... FROM "table" or FROM table
    // Match quoted table names first (more specific), then unquoted
    let tableName: string | null = null;
    const quotedMatch = query.match(/\bFROM\s+["']([^"']+)["']/i);
    if (quotedMatch && quotedMatch[1]) {
        tableName = quotedMatch[1];
    } else {
        // Try unquoted table name (alphanumeric and underscore only)
        const unquotedMatch = query.match(/\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/i);
        if (unquotedMatch && unquotedMatch[1]) {
            tableName = unquotedMatch[1];
        }
    }

    // Check for complex query patterns that indicate it's not a simple table query
    // ORDER BY, LIMIT, and OFFSET are allowed in simple table queries
    const complexPatterns = [
        /\bJOIN\b/i,
        /\bWITH\b/i,
        /\bUNION\b/i,
        /\bINTERSECT\b/i,
        /\bEXCEPT\b/i,
        /\bGROUP\s+BY\b/i,
        /\bHAVING\b/i,
        /\bDISTINCT\b/i,
        /\bCASE\b/i,
        /\bSUBQUERY\b/i,
        /\(.*SELECT.*\)/i, // Subqueries
    ];

    const isComplex = complexPatterns.some(pattern => pattern.test(query));

    // If we found a table name and it's not complex, it's a simple table query
    if (tableName && !isComplex) {
        return { tableName, isComplex: false };
    }

    // If complex or no table name found, return accordingly
    return { tableName, isComplex: isComplex || !tableName };
}

/**
 * Finds the shortest safe separator that doesn't appear in any column name.
 * Starts with a single underscore and increases until finding a safe one.
 */
function findSafeSeparator(columnNames: string[]): string {
    if (columnNames.length === 0) return '_';
    
    let separator = '_';
    let attempts = 0;
    const maxAttempts = 100; // Safety limit
    
    while (attempts < maxAttempts) {
        // Check if any column name contains this separator
        const isSafe = !columnNames.some(name => name.includes(separator));
        
        if (isSafe) {
            return separator;
        }
        
        // Try with one more underscore
        separator += '_';
        attempts++;
    }
    
    // Fallback (should never reach here)
    return separator;
}

/**
 * Parses a column list from URL params. Tries common separators from longest to shortest
 * to avoid false matches (e.g., if separator is "__", we don't want to match "_" first).
 */
function parseColumnList(param: string): string[] {
    if (!param) return [];
    // Try separators from longest to shortest to avoid false matches
    const separators = ['_____', '____', '___', '__', '_'];
    for (const sep of separators) {
        // Check if separator appears as a delimiter (not just anywhere in the string)
        // We look for the pattern: something + separator + something
        if (param.includes(sep)) {
            const parts = param.split(sep);
            // If we get multiple parts, this is likely the separator
            if (parts.length > 1) {
                return parts;
            }
        }
    }
    // Fallback: if no separator found, treat as single column
    return [param];
}


export default function XpDeebyTableView({onNavigate}: { onNavigate: NavigateCallback }) {
    const { db: dbName_, table } = useLocalSearchParams<{ db: string; table: string }>();
    const searchParams = useLocalSearchParams<{
        page?: string;
        pageSize?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        filter?: string;
        visibleColumns?: string;
        columnOrder?: string;
        columnWidths?: string;
        q?: string; // Query parameter for query mode
    }>();

    const dbName = dbName_ ? decodeURIComponent(dbName_) : null;
    // Treat empty string as query mode
    const initialTableName = table ? (table === '' ? '' : decodeURIComponent(table)) : '';
    const initialQuery = searchParams.q ? decodeURIComponent(searchParams.q) : '';

    // Use local state for current table - NEVER sync from URL after initial mount
    // This prevents re-renders when we update the URL silently
    // Empty string means query mode
    const [currentTableName, setCurrentTableName] = useState<string | null>(initialTableName);
    const hasInitializedRef = useRef(false);
    const currentTableNameRef = useRef<string | null>(initialTableName);

    // Only sync from URL on very first mount or when db changes
    useEffect(() => {
        // Allow empty string (query mode) as a valid initial table name
        if (!hasInitializedRef.current && initialTableName !== null && initialTableName !== undefined) {
            hasInitializedRef.current = true;
            currentTableNameRef.current = initialTableName;
            setCurrentTableName(initialTableName);
        } else if (dbName && (initialTableName === null || initialTableName === undefined)) {
            // If db changed and no table in URL, reset
            hasInitializedRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbName]); // Only react to db changes, NOT URL table changes

    // Keep ref in sync with state
    useEffect(() => {
        currentTableNameRef.current = currentTableName;
    }, [currentTableName]);

    const tableName = currentTableName;

    // Local state for all table controls (not driven by URL)
    const [page, setPage] = useState(() => parseInt(searchParams.page || '1', 10));
    const [pageSize, setPageSize] = useState(() => parseInt(searchParams.pageSize || '100', 10));
    const [sortBy, setSortBy] = useState<string | null>(() => searchParams.sortBy || null);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => (searchParams.sortOrder as 'asc' | 'desc') || 'asc');
    const [filterText, setFilterText] = useState(() => searchParams.filter || '');
    
    const [visibleColumns, setVisibleColumns] = useState<Set<string> | null>(() => {
        const param = searchParams.visibleColumns || '';
        if (param) {
            return new Set(parseColumnList(param));
        }
        return null; // null means all columns visible
    });
    const [columnOrder, setColumnOrder] = useState<string[] | undefined>(() => {
        const param = searchParams.columnOrder || '';
        if (param) {
            return parseColumnList(param);
        }
        return undefined;
    });
    
    // Parse column widths from URL (format: "col1:150,col2:200")
    const [columnWidths, setColumnWidths] = useState<Map<string, number>>(() => {
        const param = searchParams.columnWidths || '';
        if (param) {
            const widths = new Map<string, number>();
            const pairs = param.split(',');
            for (const pair of pairs) {
                const [col, width] = pair.split(':');
                if (col && width) {
                    const parsedWidth = parseInt(width, 10);
                    if (!isNaN(parsedWidth) && parsedWidth > 0) {
                        widths.set(decodeURIComponent(col), parsedWidth);
                    }
                }
            }
            return widths;
        }
        return new Map();
    });

    // Driver connection and query state
    const [db, setDb] = useState<any>(null);
    const [tables, setTables] = useState<string[]>([]); // List of valid table names
    // Initialize queryText from URL param if provided (query mode or non-default query), otherwise empty
    const [queryText, setQueryText] = useState<string>(initialQuery || '');
    
    // Wrapper to ensure queryText is always a string
    const setQueryTextSafe = useCallback((value: any) => {
        if (typeof value === 'string') {
            setQueryText(value);
        } else if (value && typeof value === 'object' && 'sql' in value) {
            // If it's a drizzle SQL object, extract the SQL string
            setQueryText((value as any).sql || '');
        } else {
            setQueryText(String(value || ''));
        }
    }, []);
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [queryResults, setQueryResults] = useState<{
        columns: TableViewerColumn[];
        rows: TableViewerRow[];
        totalRowCount: number;
    } | null>(null);

    // Generate default query based on table name and pagination
    const generateDefaultQuery = useCallback((table: string | null, currentPage: number, currentPageSize: number): string => {
        if (!table) return '';
        const offset = (currentPage - 1) * currentPageSize;
        // Ensure table name is properly escaped and doesn't contain brackets
        const safeTableName = String(table).replace(/[\[\]]/g, '');
        return `SELECT * FROM "${safeTableName}" LIMIT ${currentPageSize} OFFSET ${offset}`;
    }, []);

    // Track if query was manually edited (not auto-generated)
    const [isQueryManuallyEdited, setIsQueryManuallyEdited] = useState(false);
    const lastAutoGeneratedQuery = useRef<string>('');
    const lastExecutedQueryRef = useRef<string>(''); // Track last executed query to avoid duplicate executions
    const isUpdatingTableProgrammatically = useRef(false); // Track when we're updating table programmatically to prevent loops
    const queryForCurrentResultsRef = useRef<string>(''); // Cache the exact query that produced the current results

    // Auto-execute query when query is provided via URL (query mode or non-default query)
    useEffect(() => {
        if (db && initialQuery && initialQuery.trim() && !queryResults) {
            // Small delay to ensure state is ready
            const timeoutId = setTimeout(() => {
                if (queryText.trim() === initialQuery.trim()) {
                    // If in table mode with a custom query, mark it as manually edited
                    if (tableName !== '' && tableName !== null) {
                        setIsQueryManuallyEdited(true);
                    }
                    executeQuery();
                }
            }, 100);
            return () => clearTimeout(timeoutId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, tableName, initialQuery]);

    // Update query text when table, page, or pageSize changes
    const lastGeneratedQueryRef = useRef<string>('');
    const lastTableRef = useRef<string | null>(null);
    useEffect(() => {
        // Don't auto-generate queries when tableName is empty string (query mode)
        if (tableName && tableName !== '') {
            const newQuery = generateDefaultQuery(tableName, page, pageSize);
            const tableChanged = tableName !== lastTableRef.current;
            // Only update if query actually changed to avoid unnecessary re-renders
            if (newQuery !== lastGeneratedQueryRef.current) {
                lastGeneratedQueryRef.current = newQuery;
                lastTableRef.current = tableName;
                // Mark that we're updating programmatically
                isUpdatingTableProgrammatically.current = true;
                // Ensure we're setting a string, not an object
                setQueryTextSafe(newQuery);
                lastAutoGeneratedQuery.current = newQuery;
                setIsQueryManuallyEdited(false);
                // Reset execution tracking when query changes
                lastExecutedQueryRef.current = '';
                
                // If table changed and db is loaded, execute query immediately with the new query
                if (tableChanged && db && !isQueryManuallyEdited) {
                    // Execute with the new query directly to avoid state timing issues
                    if (newQuery !== lastExecutedQueryRef.current) {
                        lastExecutedQueryRef.current = newQuery;
                        // Execute with the new query directly, don't wait for state update
                        executeQuery(newQuery);
                    }
                }
                
                // Reset the flag after a short delay to allow state updates to complete
                setTimeout(() => {
                    isUpdatingTableProgrammatically.current = false;
                }, 0);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableName, page, pageSize, generateDefaultQuery, db]);

    // Detect manual query edits and parse query to determine mode
    // Use a ref to track if this is the initial mount to avoid false positives
    const isInitialMount = useRef(true);
    useEffect(() => {
        // Skip on initial mount
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        if (!dbName) return;
        
        // Skip if we're in the middle of a programmatic table update
        if (isUpdatingTableProgrammatically.current) {
            return;
        }
        
        // Skip if query matches the last auto-generated query (it's not a manual edit)
        if (queryText === lastAutoGeneratedQuery.current) {
            return;
        }
        
        const expectedQuery = generateDefaultQuery(tableName || '', page, pageSize);
        
        // If query doesn't match the auto-generated one, parse it
        // This includes empty queries (which don't match any expected query)
        if (queryText !== expectedQuery) {
            // If query is empty or whitespace, switch to query mode
            if (!queryText || !queryText.trim()) {
                setIsQueryManuallyEdited(true);
                isUpdatingTableProgrammatically.current = true;
                currentTableNameRef.current = '';
                setCurrentTableName('');
                // Clear results and errors - don't show anything until query is executed
                setQueryResults(null);
                setQueryError(null);
                queryForCurrentResultsRef.current = '';
                onNavigate(dbName, '', { q: queryText || '' });
                setTimeout(() => {
                    isUpdatingTableProgrammatically.current = false;
                }, 0);
                return;
            }
            
            const parsed = parseQuery(queryText);
            
            // If query is complex or doesn't match a simple table pattern, switch to query mode
            if (parsed.isComplex || !parsed.tableName) {
                setIsQueryManuallyEdited(true);
                isUpdatingTableProgrammatically.current = true;
                // Set table name to empty string to indicate we're in query mode
                currentTableNameRef.current = '';
                setCurrentTableName('');
                // Clear results and errors - don't show anything until query is executed
                setQueryResults(null);
                setQueryError(null);
                queryForCurrentResultsRef.current = '';
                // Update URL to query tool page via callback
                onNavigate(dbName, '', { q: queryText });
                setTimeout(() => {
                    isUpdatingTableProgrammatically.current = false;
                }, 0);
            } else if (parsed.tableName) {
                // Query is simple and targets a table - only update if table exists in database
                // If table doesn't exist, treat as query mode
                if (tables.length > 0 && !tables.includes(parsed.tableName)) {
                    // Table doesn't exist - switch to query mode
                    setIsQueryManuallyEdited(true);
                    isUpdatingTableProgrammatically.current = true;
                    currentTableNameRef.current = '';
                    setCurrentTableName('');
                    // Clear results and errors - don't show anything until query is executed
                    setQueryResults(null);
                    setQueryError(null);
                    queryForCurrentResultsRef.current = '';
                    onNavigate(dbName, '', { q: queryText });
                    setTimeout(() => {
                        isUpdatingTableProgrammatically.current = false;
                    }, 0);
                } else if (parsed.tableName !== tableName) {
                    // Different table and it exists - update table state and URL
                    isUpdatingTableProgrammatically.current = true;
                    // Update ref immediately
                    currentTableNameRef.current = parsed.tableName;
                    // Update state
                    setCurrentTableName(parsed.tableName);
                    // Update URL via callback
                    onNavigate(dbName, parsed.tableName, {});
                    // Reset pagination and other state for the new table
                    setPage(1);
                    setIsQueryManuallyEdited(false);
                    setTimeout(() => {
                        isUpdatingTableProgrammatically.current = false;
                    }, 0);
                }
                // Same table - stay in table mode (don't set isQueryManuallyEdited)
            }
        }
    }, [queryText, tableName, page, pageSize, generateDefaultQuery, dbName, setCurrentTableName, tables]);

    // Load database connection and table list
    useEffect(() => {
        if (!dbName) return;

        let cancelled = false;
        const loadDb = async () => {
            try {
                const entries = await getRegistryEntries();
                const entry = entries.find(e => e.name === dbName);
                if (!entry || cancelled) return;

                const db = await connect(entry);
                if (cancelled) return;

                if (!cancelled) {
                    setDb(db);
                }

                // Load table names
                if (!cancelled) {
                    try {
                        const tableNames = await db.getTableNames();
                        if (!cancelled) {
                            setTables(tableNames);
                        }
                    } catch (err) {
                        if (!cancelled) {
                            console.error('[table-view] Error loading table names:', err);
                        }
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('[table-view] Error loading database:', err);
                }
            }
        };

        loadDb();
        return () => { cancelled = true; };
    }, [dbName]);

    // Helper function to extract column names from query result
    const extractColumnNames = useCallback((result: any): string[] => {
        // Check if result has fields metadata (PostgreSQL/PGlite provides this)
        if (result?.fields && Array.isArray(result.fields)) {
            return result.fields.map((field: any) => field.name || field.fieldName || String(field));
        }

        // If result is an array of rows, check the first row
        const firstRow = Array.isArray(result) ? result[0] : (result?.rows?.[0] || result?.[0]);

        if (!firstRow) {
            return [];
        }

        // Extract column names from row object keys
        if (typeof firstRow === 'object' && firstRow !== null) {
            if (Array.isArray(firstRow)) {
                // Array-based result - use generic column names
                return Array.from({ length: firstRow.length }, (_, i) => `column_${i + 1}`);
            } else {
                // Object-based result - use object keys as column names
                // For PostgreSQL, this should work since rows are objects with column names as keys
                return Object.keys(firstRow);
            }
        } else {
            // Single value result
            return ['value'];
        }
    }, []);

    // Execute query
    const executeQuery = useCallback(async (queryOverride?: string) => {
        let queryToExecute: string;
        
        // If queryOverride is provided, validate it's actually a string
        // (not an event object or other non-string value)
        if (queryOverride !== undefined && queryOverride !== null) {
            if (typeof queryOverride === 'string') {
                queryToExecute = queryOverride;
            } else if (queryOverride && typeof queryOverride === 'object') {
                // Check if it's a drizzle SQL object
                if ('sql' in queryOverride) {
                    queryToExecute = (queryOverride as any).sql || '';
                } else {
                    // It's some other object (like an event) - ignore it and use queryText instead
                    console.warn('[executeQuery] queryOverride is not a string, ignoring:', queryOverride);
                    queryToExecute = typeof queryText === 'string' ? queryText : String(queryText || '');
                }
            } else {
                queryToExecute = String(queryOverride);
            }
        } else if (queryText) {
            // Ensure queryText is a string
            if (typeof queryText === 'string') {
                queryToExecute = queryText;
            } else if (queryText && typeof queryText === 'object' && 'sql' in queryText) {
                // If it's a drizzle SQL object, extract the SQL string
                queryToExecute = (queryText as any).sql || String(queryText);
            } else {
                queryToExecute = String(queryText);
            }
        } else {
            queryToExecute = '';
        }
        
        if (!db || !queryToExecute.trim()) return;

        // Ensure query is a clean string
        const cleanQuery = String(queryToExecute).trim();
        
        // Final safety check - if it's still "[object Object]", something is wrong
        if (cleanQuery === '[object Object]') {
            console.error('[executeQuery] Query is still an object!', { queryOverride, queryText, queryToExecute });
            setQueryError('Invalid query: query is not a string');
            setQueryLoading(false);
            return;
        }

        try {
            setQueryLoading(true);
            setQueryError(null);

            // Debug: log the query to help diagnose issues
            console.log('[executeQuery] Executing query:', cleanQuery);
            console.log('[executeQuery] Query type:', typeof cleanQuery);
            console.log('[executeQuery] Query JSON:', JSON.stringify(cleanQuery));
            console.log('[executeQuery] Query char codes:', Array.from(cleanQuery).map(c => c.charCodeAt(0)));
            
            // Create the raw SQL object and inspect it
            const rawSql = sql.raw(cleanQuery);
            console.log('[executeQuery] sql.raw result:', rawSql);
            console.log('[executeQuery] sql.raw type:', typeof rawSql);
            if (rawSql && typeof rawSql === 'object') {
                console.log('[executeQuery] sql.raw keys:', Object.keys(rawSql));
                if ('sql' in rawSql) {
                    console.log('[executeQuery] sql.raw.sql:', rawSql.sql);
                }
            }
            
            // Execute query - result may be array of rows or object with rows/fields
            const queryResult = await db.execute(rawSql) as any;

            // Handle different result formats
            let rows: any[] = [];
            let resultMetadata: any = null;

            if (Array.isArray(queryResult)) {
                // Direct array of rows
                rows = queryResult;
            } else if (queryResult?.rows) {
                // Object with rows property (PostgreSQL format)
                rows = queryResult.rows;
                resultMetadata = queryResult;
            } else if (queryResult) {
                // Single row or other format
                rows = [queryResult];
            }

            if (!rows || rows.length === 0) {
            setQueryResults({
                columns: [],
                rows: [],
                totalRowCount: 0,
            });
            // Cache the exact query that produced these (empty) results
            queryForCurrentResultsRef.current = cleanQuery;
            setQueryLoading(false);
            return;
            }

            // Extract column names using metadata if available, otherwise from first row
            const columnNames = resultMetadata
                ? extractColumnNames(resultMetadata)
                : extractColumnNames(rows);

            // Convert results to TableViewer format
            const columns: TableViewerColumn[] = columnNames.map(name => ({
                name,
                label: name,
            }));

            const tableRows: TableViewerRow[] = rows.map((row, index) => {
                const rowData: TableViewerRow = { id: `row_${index}` };

                if (typeof row === 'object' && row !== null) {
                    if (Array.isArray(row)) {
                        // Array-based row - map by index
                        columnNames.forEach((colName, colIndex) => {
                            rowData[colName] = row[colIndex];
                        });
                    } else {
                        // Object-based row - copy all properties
                        // For PostgreSQL, column names should match the keys
                        Object.keys(row).forEach(key => {
                            rowData[key] = row[key];
                        });
                    }
                } else {
                    // Single value result
                    rowData[columnNames[0] || 'value'] = row;
                }

                return rowData;
            });

            setQueryResults({
                columns,
                rows: tableRows,
                totalRowCount: tableRows.length, // For now, use result count; could fetch total separately
            });

            // Cache the exact query that produced these results
            queryForCurrentResultsRef.current = cleanQuery;

            // Set visible columns if not already set
            if (!visibleColumns) {
                setVisibleColumns(new Set(columnNames));
            }
            if (!columnOrder || columnOrder.length === 0) {
                setColumnOrder(columnNames);
            }
        } catch (err) {
            console.error('[table-view] Error executing query:', err);
            setQueryError(err instanceof Error ? err.message : String(err));
            setQueryResults(null);
            // Clear cached query on error
            queryForCurrentResultsRef.current = '';
        } finally {
            setQueryLoading(false);
        }
    }, [db, queryText, visibleColumns, columnOrder, extractColumnNames]);

    // Auto-execute query when table changes (query is auto-generated)
    // Only auto-execute when table/page changes, NOT when query text changes manually
    useEffect(() => {
        // Don't auto-execute when tableName is empty string (query mode)
        // Only auto-execute if:
        // 1. Driver is loaded
        // 2. Table name exists and is not empty string
        // 3. Query text exists and matches the expected query for this table/page
        // 4. Query hasn't been manually edited
        // 5. Query hasn't been executed yet
        if (!db || !tableName || tableName === '' || !queryText || isQueryManuallyEdited) return;
        
        const expectedQuery = generateDefaultQuery(tableName, page, pageSize);
        
        // Only auto-execute if query exactly matches the expected query for this table/page
        if (queryText === expectedQuery && queryText !== lastExecutedQueryRef.current) {
            lastExecutedQueryRef.current = queryText;
            executeQuery();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, tableName, page, pageSize, isQueryManuallyEdited]); // Only re-execute when table, page, or pageSize changes, NOT when queryText changes

    // Find the shortest safe separator for column names (memoized)
    const columnSeparator = useMemo(() => {
        const columnNames = queryResults?.columns.map(c => c.name) || [];
        return findSafeSeparator(columnNames);
    }, [queryResults?.columns]);

    // Check if we're in paginated mode
    const isPaginated = (queryResults?.totalRowCount || 0) > pageSize || page > 1;

    // Function to update URL via callback
    const updateURLSilently = useCallback((updates: {
        page?: number;
        pageSize?: number;
        sortBy?: string | null;
        sortOrder?: 'asc' | 'desc';
        filter?: string;
        visibleColumns?: Set<string> | null;
        columnOrder?: string[] | undefined;
        columnWidths?: Map<string, number>;
    }) => {
        const finalPage = updates.page !== undefined ? updates.page : page;
        const finalPageSize = updates.pageSize !== undefined ? updates.pageSize : pageSize;
        const finalSortBy = updates.sortBy !== undefined ? updates.sortBy : sortBy;
        const finalSortOrder = updates.sortOrder !== undefined ? updates.sortOrder : sortOrder;
        const finalFilter = updates.filter !== undefined ? updates.filter : filterText;
        const finalVisibleColumns = updates.visibleColumns !== undefined ? updates.visibleColumns : visibleColumns;
        const finalColumnOrder = updates.columnOrder !== undefined ? updates.columnOrder : columnOrder;
        const finalColumnWidths = updates.columnWidths !== undefined ? updates.columnWidths : columnWidths;
        
        const searchParams: Record<string, string> = {};
        
        // Only add page if it's not the default (1)
        if (finalPage !== 1) searchParams.page = String(finalPage);
        
        // Only add pageSize if it's not the default (100)
        if (finalPageSize !== 100) searchParams.pageSize = String(finalPageSize);
        
        if (finalSortBy) {
            searchParams.sortBy = finalSortBy;
            searchParams.sortOrder = finalSortOrder;
        }
        if (finalFilter) searchParams.filter = finalFilter;
        
        if (finalVisibleColumns && queryResults) {
            const allColumns = queryResults.columns.map(c => c.name);
            if (finalVisibleColumns.size !== allColumns.length) {
                searchParams.visibleColumns = Array.from(finalVisibleColumns).join(columnSeparator);
            }
        }
        
        // Only add columnOrder if it's different from the default (natural order of all columns)
        if (finalColumnOrder && queryResults) {
            const allColumns = queryResults.columns.map(c => c.name);
            // Check if column order is different from natural order
            const isDifferentOrder = finalColumnOrder.length !== allColumns.length ||
                finalColumnOrder.some((col, idx) => col !== allColumns[idx]);
            if (isDifferentOrder) {
                searchParams.columnOrder = finalColumnOrder.join(columnSeparator);
            }
        }
        
        // Encode column widths (format: "col1:150,col2:200")
        if (finalColumnWidths.size > 0) {
            const widthPairs: string[] = [];
            finalColumnWidths.forEach((width, col) => {
                widthPairs.push(`${encodeURIComponent(col)}:${width}`);
            });
            searchParams.columnWidths = widthPairs.join(',');
        }
        
        // Add query text to params if it's anything other than the default auto-generated query
        if (queryText) {
            if (tableName === '') {
                // Query mode - always include query
                searchParams.q = queryText;
            } else {
                // Table mode - only include if query doesn't match the default pattern
                const defaultQuery = generateDefaultQuery(tableName, page, pageSize);
                if (queryText.trim() !== defaultQuery.trim()) {
                    searchParams.q = queryText;
                }
            }
        }
        
        // Call onNavigate with the search params
        onNavigate(dbName, tableName || null, searchParams);
    }, [page, pageSize, sortBy, sortOrder, filterText, visibleColumns, columnOrder, columnWidths, dbName, tableName, queryResults, columnSeparator, queryText, generateDefaultQuery, onNavigate]);




    const handleSort = useCallback((column: string) => {
        const newSortOrder = sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc';
        setSortBy(column);
        setSortOrder(newSortOrder);
        setPage(1); // Reset to first page when sorting
        updateURLSilently({ sortBy: column, sortOrder: newSortOrder, page: 1 });
    }, [sortBy, sortOrder, updateURLSilently]);

    // External sort handler for when paginated (database-level sorting)
    const handleSortExternal = useCallback((column: string, order: 'asc' | 'desc') => {
        setSortBy(column);
        setSortOrder(order);
        setPage(1); // Reset to first page when sorting
        updateURLSilently({ sortBy: column, sortOrder: order, page: 1 });
        // The useTableData hook will automatically re-fetch with the new sort parameters
    }, [updateURLSilently]);

    const toggleColumnVisibility = useCallback((column: string) => {
        const columnNames = queryResults?.columns.map(c => c.name) || [];
        const newVisible = visibleColumns ? new Set(visibleColumns) : new Set(columnNames);

        if (newVisible.has(column)) {
            newVisible.delete(column);
        } else {
            newVisible.add(column);
        }

        setVisibleColumns(newVisible);
        updateURLSilently({ visibleColumns: newVisible });
    }, [visibleColumns, queryResults?.columns, updateURLSilently]);

    const handleColumnOrderChange = useCallback((newOrder: string[]) => {
        setColumnOrder(newOrder);
        updateURLSilently({ columnOrder: newOrder });
    }, [updateURLSilently]);

    const handleColumnWidthsChange = useCallback((newWidths: Map<string, number>) => {
        setColumnWidths(newWidths);
        // URL update will be debounced in useEffect below
    }, []);

    // Debounced URL update for column widths (update after user stops resizing)
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            updateURLSilently({ columnWidths });
        }, 300); // 300ms debounce

        return () => clearTimeout(timeoutId);
    }, [columnWidths, updateURLSilently]);

    const handleFilterChange = useCallback((text: string) => {
        setFilterText(text);
        setPage(1); // Reset to first page when filtering
    }, []);

    // External filter handler for when paginated (database-level filtering)
    const handleFilterExternal = useCallback((text: string) => {
        setFilterText(text);
        setPage(1); // Reset to first page when filtering
        // Update URL immediately for external filter
        updateURLSilently({ filter: text, page: 1 });
        // The useTableData hook will automatically re-fetch with the new filter
    }, [updateURLSilently]);

    // Debounced filter effect - update URL silently after user stops typing (only for non-paginated mode)
    useEffect(() => {
        if (isPaginated) return; // Skip debounced update when paginated (use external handler instead)
        
        const timeoutId = setTimeout(() => {
            updateURLSilently({ filter: filterText, page: 1 });
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [filterText, updateURLSilently, isPaginated]);

    const handlePageChange = useCallback((newPage: number) => {
        setPage(newPage);
        updateURLSilently({ page: newPage });
        // Query will be regenerated in useEffect when page changes
    }, [updateURLSilently]);

    const handleReset = useCallback(() => {
        // Reset all state to defaults
        setPage(1);
        setPageSize(100);
        setSortBy(null);
        setSortOrder('asc');
        setFilterText('');
        setVisibleColumns(null); // null means all columns visible
        setColumnOrder(undefined);
        setColumnWidths(new Map());
        
        // Navigate to clean URL without any search params via callback
        onNavigate(dbName, tableName || null, {});
    }, [dbName, tableName, onNavigate]);

    const handleTableSelect = useCallback((selectedTableName: string) => {
        // Skip if already on this table
        if (selectedTableName === currentTableNameRef.current) {
            return;
        }

        // Update URL via callback - clear all query parameters when switching tables
        onNavigate(dbName, selectedTableName, {});

        // Update ref immediately (synchronous, no re-render)
        currentTableNameRef.current = selectedTableName;

        // Batch all state updates in a single React update cycle
        // React 18+ automatically batches these, so this causes only ONE re-render
        setCurrentTableName(selectedTableName);
        setPage(1);
        setPageSize(100);
        setSortBy(null);
        setSortOrder('asc');
        setFilterText('');
        setVisibleColumns(null);
        setColumnOrder(undefined);
        setColumnWidths(new Map());
        setQueryError(null);
        setQueryResults(null);
        queryForCurrentResultsRef.current = '';
        setIsQueryManuallyEdited(false); // Reset manual edit flag when selecting a new table
        // Query text will be auto-generated by useEffect when tableName changes
    }, [dbName, onNavigate]);

    // Handle no database selected - show centered database dropdown
    if (!dbName) {
        return (
            <DatabaseBrowserLayout 
                dbName={''}
                onNavigate={onNavigate}
                headerTitle="Select Driver"
                showSidebar={true}
            >
                <View style={styles.noDatabaseContainer} />
            </DatabaseBrowserLayout>
        );
    }

    // Determine if we're in query mode (empty table name)
    const isQueryMode = tableName === '';
    const headerTitle = isQueryMode ? 'Query Tool' : dbName;
    const headerSubtitle = isQueryMode ? dbName : tableName;

    return (
        <DatabaseBrowserLayout
            dbName={dbName}
            onNavigate={onNavigate}
            headerTitle={headerTitle}
            headerSubtitle={headerSubtitle}
            currentTableName={isQueryMode ? null : tableName}
            onTableSelect={handleTableSelect}
            onBack={() => onNavigate(null, null, {})}
        >
            {/* Query Editor */}
            <SidebarContext.Consumer>
                {({ sidebarCollapsed, toggleSidebar }) => (
                    <QueryEditor
                        value={typeof queryText === 'string' ? queryText : String(queryText || '')}
                        onChangeText={setQueryTextSafe}
                        onExecute={() => executeQuery()}
                        placeholder="Enter SQL query..."
                        disabled={!db}
                        loading={queryLoading}
                        showExpandButton={sidebarCollapsed}
                        onExpand={toggleSidebar}
                    />
                )}
            </SidebarContext.Consumer>

            {/* Error - shown where results would be */}
            {queryError && (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Error: {queryError}</Text>
                    </View>
                )}

            {/* Results */}
            {queryResults && (() => {
                // Check if current query differs from the query that produced these results
                const currentQuery = typeof queryText === 'string' ? queryText.trim() : String(queryText || '').trim();
                const resultsQuery = queryForCurrentResultsRef.current.trim();
                const isStale = currentQuery !== resultsQuery;
                const opacity = isStale ? 0.5 : 1.0;
                
                return (
                    <View style={[styles.resultsContainer, { opacity }]}>
                    <TableViewer
                        columns={queryResults.columns}
                        rows={queryResults.rows}
                        totalRowCount={queryResults.totalRowCount}
                        loading={queryLoading}
                        error={null}
                        page={page}
                        pageSize={pageSize}
                        onPageChange={(newPage) => {
                            setPage(newPage);
                            // Regenerate query with new page
                            if (tableName) {
                                const newQuery = generateDefaultQuery(tableName, newPage, pageSize);
                                setQueryTextSafe(newQuery);
                            }
                        }}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        sortDisabled={isPaginated}
                        filterText={filterText}
                        onFilterChange={handleFilterChange}
                        filterDisabled={isPaginated}
                        visibleColumns={visibleColumns}
                        onToggleColumnVisibility={toggleColumnVisibility}
                        columnOrder={columnOrder}
                        onColumnOrderChange={handleColumnOrderChange}
                        columnWidths={columnWidths}
                        onColumnWidthsChange={handleColumnWidthsChange}
                    />
                </View>
                );
            })()}
        </DatabaseBrowserLayout>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: '#fafafa',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 0,
        minWidth: 200,
    },
    headerCenter: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        gap: 12,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 0,
        minWidth: 100,
        justifyContent: 'flex-end',
    },
    headerButton: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: '#667eea',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    headerInfo: {
        minWidth: 100,
        maxWidth: 200,
    },
    headerDbName: {
        fontSize: 13,
        fontWeight: '600',
        color: '#333',
    },
    headerTableName: {
        fontSize: 11,
        color: '#666',
        marginTop: 2,
    },
    headerFilterInput: {
        width: '100%',
        maxWidth: 400,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        fontSize: 14,
        backgroundColor: '#fff',
        minHeight: 32,
    },
    headerPagination: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerPaginationButton: {
        width: 24,
        height: 24,
        borderRadius: 4,
        backgroundColor: '#667eea',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerPaginationButtonDisabled: {
        backgroundColor: '#ccc',
        opacity: 0.5,
    },
    headerPaginationButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    headerPaginationText: {
        fontSize: 11,
        color: '#666',
        minWidth: 50,
        textAlign: 'center',
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
    backButton: {
        marginTop: 10,
        padding: 10,
        backgroundColor: '#667eea',
        borderRadius: 4,
        alignSelf: 'flex-start',
    },
    backButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    filterContainer: {
        padding: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: '#fafafa',
    },
    filterInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 4,
        padding: 8,
        fontSize: 14,
        backgroundColor: '#fff',
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
    },
    tableHeaderCell: {
        padding: 12,
        borderRightWidth: 1,
        borderRightColor: '#5568d3',
        justifyContent: 'center',
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
    tableBodyScroll: {
        flex: 1,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    tableCell: {
        padding: 12,
        borderRightWidth: 1,
        borderRightColor: '#f0f0f0',
        justifyContent: 'center',
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
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyStateText: {
        fontSize: 16,
        color: '#999',
        textAlign: 'center',
    },
    resultsContainer: {
        flex: 1,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    modalTitle: {
        fontSize: 18,
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
    modalBody: {
        maxHeight: 400,
    },
    columnMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    columnMenuCheckbox: {
        fontSize: 16,
        marginRight: 12,
        color: '#667eea',
        width: 24,
    },
    columnMenuText: {
        fontSize: 14,
        color: '#333',
        flex: 1,
    },
    modalFooter: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
    },
    modalButton: {
        padding: 12,
        backgroundColor: '#667eea',
        borderRadius: 4,
        alignItems: 'center',
    },
    modalButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    noDatabaseContainer: {
        flex: 1,
    },
});

