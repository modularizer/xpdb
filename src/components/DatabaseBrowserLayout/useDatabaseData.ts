/**
 * Custom hook for loading database and table data
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { connect, getRegistryEntries } from '../../xp-schema';

export interface UseDatabaseDataReturn {
    databases: string[];
    databaseTableCounts: Record<string, number>;
    tables: string[];
    views: string[];
    materializedViews: string[];
    tableRowCounts: Record<string, number>;
    isPostgres: boolean;
    loadDatabases: () => Promise<void>;
    loadTableList: () => Promise<void>;
}

export function useDatabaseData(dbName: string | null): UseDatabaseDataReturn {
    const [databases, setDatabases] = useState<string[]>([]);
    const [databaseTableCounts, setDatabaseTableCounts] = useState<Record<string, number>>({});
    const [tables, setTables] = useState<string[]>([]);
    const [views, setViews] = useState<string[]>([]);
    const [materializedViews, setMaterializedViews] = useState<string[]>([]);
    const [tableRowCounts, setTableRowCounts] = useState<Record<string, number>>({});
    const [isPostgres, setIsPostgres] = useState(false);
    
    const loadingTableListRef = useRef(false);
    const loadingDatabasesRef = useRef(false);
    const hasLoadedDatabasesRef = useRef(false);

    // Load table list for current database
    const loadTableList = useCallback(async () => {
        if (!dbName || loadingTableListRef.current) return;
        loadingTableListRef.current = true;
        
        try {
            const entries = await getRegistryEntries();
            const entry = entries.find(e => e.name === dbName);
            if (!entry) {
                setTables([]);
                setViews([]);
                setMaterializedViews([]);
                setTableRowCounts({});
                return;
            }

            const db = await connect(entry);

            // Check if this is a PostgreSQL database
            const isPostgresDb = entry.driverName === 'postgres';
            setIsPostgres(isPostgresDb);

            // Get table names
            const tableNames = await db.getTableNames();

            // Get view names if supported (PostgreSQL dialect)
            // Note: View support is not yet implemented in xp-schema dialect interface
            let viewNames: string[] = [];
            // TODO: Implement view name retrieval when dialect interface supports it

            // Get materialized view names if supported (PostgreSQL only)
            // Note: Materialized view support is not yet implemented in xp-schema dialect interface
            let matViewNames: string[] = [];
            // TODO: Implement materialized view name retrieval when dialect interface supports it

            // Get row counts for all tables
            const counts: Record<string, number> = {};

            await Promise.all(
                tableNames.map(async (tableName) => {
                    try {
                        const count = await db.getRowCount(tableName);
                        counts[tableName] = count;
                    } catch (err) {
                        console.error(`[DatabaseBrowserLayout] Error counting rows for ${tableName}:`, err);
                        counts[tableName] = 0;
                    }
                })
            );

            setTables(tableNames);
            setViews(viewNames);
            setMaterializedViews(matViewNames);
            setTableRowCounts(prevCounts => ({ ...prevCounts, ...counts }));
        } catch (err) {
            console.error(`[DatabaseBrowserLayout] Error loading table list:`, err);
        } finally {
            loadingTableListRef.current = false;
        }
    }, [dbName]);

    // Load databases list with table counts
    const loadDatabases = useCallback(async () => {
        if (loadingDatabasesRef.current) return;
        loadingDatabasesRef.current = true;
        try {
            const registry = await getRegistryEntries();
            const dbNames = registry.map(entry => entry.name);
            setDatabases(dbNames);
            
            // Load table counts for each database
            const counts: Record<string, number> = {};
            await Promise.all(
                dbNames.map(async (dbName) => {
                    try {
                        const entries = await getRegistryEntries();
                        const entry = entries.find(e => e.name === dbName);
                        if (entry) {
                            const db = await connect(entry);
                            const metadata = await db.getMetadata();
                            counts[dbName] = metadata.tableCount;
                        }
                    } catch (err) {
                        console.error(`[DatabaseBrowserLayout] Error loading table count for ${dbName}:`, err);
                        counts[dbName] = 0;
                    }
                })
            );
            setDatabaseTableCounts(counts);
        } catch (err) {
            console.error(`[DatabaseBrowserLayout] Error loading databases:`, err);
        } finally {
            loadingDatabasesRef.current = false;
        }
    }, []);

    // Load databases on mount only once
    useEffect(() => {
        if (!hasLoadedDatabasesRef.current) {
            hasLoadedDatabasesRef.current = true;
            loadDatabases();
        }
    }, [loadDatabases]);

    // Load table list when dbName changes
    useEffect(() => {
        if (dbName) {
            loadTableList();
        }
    }, [dbName, loadTableList]);

    return {
        databases,
        databaseTableCounts,
        tables,
        views,
        materializedViews,
        tableRowCounts,
        isPostgres,
        loadDatabases,
        loadTableList,
    };
}

