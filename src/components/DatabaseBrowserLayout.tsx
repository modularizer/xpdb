/**
 * Driver Browser Layout Component
 * 
 * Shared layout component for database browser pages with sidebar and main content.
 * Used by [db]/[table] page (which handles both table view and query mode).
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    Modal,
    TextInput,
    Platform,
    ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {connect, getRegistryEntries, getRegistryEntry, saveRegistryEntry, createOrRetrieveRegistryEntry} from '../xp-schema';
import type { PostgresConnectionInfo } from '../xp-schema/xp-sql/drivers/implementations/postgres';
import * as DocumentPicker from 'expo-document-picker';

export type NavigateCallback = (dbName: string | null, tableName: string | null, searchParams: Record<string, string>) => void;

export interface DatabaseBrowserLayoutProps {
    dbName: string;
    onNavigate: NavigateCallback;
    children: React.ReactNode;
    onBack?: () => void;
    showSidebar?: boolean;
    currentTableName?: string | null;
    onTableSelect?: (tableName: string) => void;
}

// Table item component (memoized for performance)
const TableItem = React.memo<{
    table: string;
    rowCount: number | null;
    isEmpty: boolean;
    isSelected: boolean;
    onPress: (tableName: string) => void;
}>(({ table, rowCount, isEmpty, isSelected, onPress }) => {
    return (
        <TouchableOpacity
            style={[
                styles.tableItem,
                isEmpty && styles.tableItemEmpty,
                isSelected && styles.tableItemSelected,
            ]}
            onPress={() => onPress(table)}
        >
            <View style={styles.tableItemContent}>
                <Text
                    style={[
                        styles.tableItemText,
                        isEmpty && styles.tableItemTextEmpty,
                        isSelected && styles.tableItemTextSelected,
                    ]}
                >
                    {table}
                </Text>
                {rowCount !== null && (
                    <Text
                        style={[
                            styles.tableItemCount,
                            isEmpty && styles.tableItemCountEmpty,
                            isSelected && styles.tableItemCountSelected,
                        ]}
                    >
                        {rowCount.toLocaleString()}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.table === nextProps.table &&
        prevProps.rowCount === nextProps.rowCount &&
        prevProps.isEmpty === nextProps.isEmpty &&
        prevProps.isSelected === nextProps.isSelected
    );
});

TableItem.displayName = 'TableItem';

// Context for sidebar state
export const SidebarContext = React.createContext<{
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
}>({
    sidebarCollapsed: false,
    toggleSidebar: () => {},
});

export default function DatabaseBrowserLayout({
    dbName,
    onNavigate,
    children,
    onBack,
    showSidebar = true,
    currentTableName = null,
    onTableSelect,
}: DatabaseBrowserLayoutProps) {
    const searchParams = useLocalSearchParams<{ sidebarCollapsed?: string }>();
    
    // Read collapsed state from URL, default to false
    const initialCollapsed = searchParams.sidebarCollapsed === 'true';
    const [sidebarCollapsed, setSidebarCollapsed] = useState(initialCollapsed);
    const [tables, setTables] = useState<string[]>([]);
    const [views, setViews] = useState<string[]>([]);
    const [materializedViews, setMaterializedViews] = useState<string[]>([]);
    const [tableRowCounts, setTableRowCounts] = useState<Record<string, number>>({});
    const [databases, setDatabases] = useState<string[]>([]);
    const [databaseTableCounts, setDatabaseTableCounts] = useState<Record<string, number>>({});
    const [showDatabaseDropdown, setShowDatabaseDropdown] = useState(false);
    const [isPostgres, setIsPostgres] = useState(false);
    const [showPostgresForm, setShowPostgresForm] = useState(false);
    const [showCreatePglite, setShowCreatePglite] = useState(false);
    const [newPgliteName, setNewPgliteName] = useState('');
    const [postgresConfig, setPostgresConfig] = useState<Omit<PostgresConnectionInfo, 'name' | 'driverName' | 'dialectName'>>({
        host: '',
        port: 5432,
        database: '',
        user: '',
        password: '',
        ssl: false,
    });
    const [postgresConnectionName, setPostgresConnectionName] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [sectionsCollapsed, setSectionsCollapsed] = useState<{
        tables: boolean;
        views: boolean;
        materializedViews: boolean;
    }>({
        tables: false,
        views: false,
        materializedViews: false,
    });
    const loadingTableListRef = useRef(false);

    // Sync with URL param changes only on initial mount or when db changes
    const hasInitializedRef = useRef(false);
    useEffect(() => {
        if (!hasInitializedRef.current) {
            hasInitializedRef.current = true;
            // Initial sync from URL
            const urlCollapsed = searchParams.sidebarCollapsed === 'true';
            if (urlCollapsed !== sidebarCollapsed) {
                setSidebarCollapsed(urlCollapsed);
            }
        } else if (dbName) {
            // Reset when db changes
            hasInitializedRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbName]); // Only react to db changes, not URL param changes

    // Toggle sidebar and update URL via callback
    const toggleSidebar = useCallback(() => {
        const newCollapsed = !sidebarCollapsed;
        setSidebarCollapsed(newCollapsed);
        
        // Update URL via callback to cache collapsed state
        const searchParams: Record<string, string> = {};
        if (newCollapsed) {
            searchParams.sidebarCollapsed = 'true';
        }
        onNavigate(dbName || null, currentTableName, searchParams);
    }, [sidebarCollapsed, dbName, currentTableName, onNavigate]);

    const loadTableList = useCallback(async () => {
        if (!dbName || loadingTableListRef.current) return;

        try {
            loadingTableListRef.current = true;

            // Get adapter type from registry
            const entries = await getRegistryEntries();
            const entry = entries.find(e => e.name === dbName);

            if (!entry) {
                loadingTableListRef.current = false;
                return;
            }

            // Connect to database
            const db = await connect(entry);

            // Check if this is a PostgreSQL database
            // Note: We can determine this from the driver name in the registry entry
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
    const loadingDatabasesRef = useRef(false);
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
    const hasLoadedDatabasesRef = useRef(false);
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

    const handleDatabaseSelect = useCallback((selectedDbName: string) => {
        if (selectedDbName !== dbName) {
            setShowDatabaseDropdown(false);
            // Navigate to the database (no table selected initially)
            onNavigate(selectedDbName, null, {});
        } else {
            setShowDatabaseDropdown(false);
        }
    }, [dbName, onNavigate]);

    const handleConnectPostgres = useCallback(async () => {
        if (!postgresConnectionName || !postgresConfig.host || !postgresConfig.database || !postgresConfig.user) {
            setConnectionError('Please fill in all required fields');
            return;
        }

        setConnecting(true);
        setConnectionError(null);

        try {
            // Create connection info
            const entry: PostgresConnectionInfo = {
                name: postgresConnectionName,
                driverName: 'postgres',
                dialectName: 'pg',
                ...postgresConfig,
            };
            
            // Test the connection
            const db = await connect(entry);
            
            // Register the entry
            await saveRegistryEntry(entry);
            
            // Reload databases and navigate
            await loadDatabases();
            setShowPostgresForm(false);
            onNavigate(postgresConnectionName, null, {});
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setConnectionError(errorMessage);
        } finally {
            setConnecting(false);
        }
    }, [postgresConnectionName, postgresConfig, onNavigate, loadDatabases]);

    const handleCreatePglite = useCallback(async () => {
        const name = newPgliteName.trim();
        if (!name) {
            return;
        }

        try {
            // Create PGLite connection info
            const entry = await createOrRetrieveRegistryEntry({
                name: name,
                driverName: 'pglite',
                dialectName: 'pg',
            });
            
            // Test the connection
            await connect(entry);
            
            await loadDatabases();
            setShowCreatePglite(false);
            setNewPgliteName('');
            onNavigate(name, null, {});
        } catch (error) {
            console.error('Error creating PGLite database:', error);
        }
    }, [newPgliteName, onNavigate, loadDatabases]);

    const handleOpenSqliteFile = useCallback(async () => {
        try {
            if (Platform.OS === 'web') {
                // For web, create a file input
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.db,.sqlite,.sqlite3';
                input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;

                    const arrayBuffer = await file.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);
                    
                    // For web, we'd need to use sql.js to open the file
                    // This is a placeholder - you may need to implement file-based SQLite opening
                    console.log('SQLite file selected:', file.name, uint8Array.length, 'bytes');
                    // TODO: Implement SQLite file opening for web
                };
                input.click();
            } else {
                // For mobile, use document picker
                const result = await DocumentPicker.getDocumentAsync({
                    type: ['application/x-sqlite3', 'application/vnd.sqlite3'],
                    copyToCacheDirectory: true,
                });

                if (result.canceled || !result.assets[0]) {
                    return;
                }

                const file = result.assets[0];
                console.log('SQLite file selected:', file.uri);
                // TODO: Implement SQLite file opening for mobile
            }
        } catch (error) {
            console.error('Error opening SQLite file:', error);
        }
    }, []);

    const handleTableSelect = useCallback((tableName: string) => {
        if (onTableSelect) {
            onTableSelect(tableName);
        } else {
            // Clear query parameters when switching tables
            onNavigate(dbName, tableName, {});
        }
    }, [dbName, onNavigate, onTableSelect]);

    const handleBack = useCallback(() => {
        if (onBack) {
            onBack();
        } else {
            // If no database selected, stay on current page (no-op)
            // Otherwise navigate to database list (which now shows the centered dropdown)
            if (dbName) {
                onNavigate(null, null, {});
            }
        }
    }, [onBack, dbName, onNavigate]);

    // Sort tables: non-empty first, then empty tables
    const sortedTables = useMemo(() => {
        return [...tables].sort((a, b) => {
            const countA = tableRowCounts[a] ?? 0;
            const countB = tableRowCounts[b] ?? 0;
            if ((countA === 0 && countB === 0) || (countA > 0 && countB > 0)) {
                return 0;
            }
            return countA === 0 ? 1 : -1;
        });
    }, [tables, tableRowCounts]);

    // If no database selected, show connection options
    if (!dbName) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.centeredContent}>
                    <ScrollView style={styles.connectionOptionsScroll} contentContainerStyle={styles.connectionOptionsContainer}>
                        <Text style={styles.connectionTitle}>Connect to Driver</Text>

                        {/* Existing Databases */}
                        {databases.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Existing Databases</Text>
                                <TouchableOpacity
                                    style={styles.connectionButton}
                                    onPress={() => setShowDatabaseDropdown(true)}
                                >
                                    <Text style={styles.connectionButtonText}>Select Driver</Text>
                                    <Text style={styles.connectionButtonIcon}>▼</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Postgres Connection */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>PostgreSQL (Remote)</Text>
                            {!showPostgresForm ? (
                                <TouchableOpacity
                                    style={styles.connectionButton}
                                    onPress={() => setShowPostgresForm(true)}
                                >
                                    <Text style={styles.connectionButtonText}>Connect to Postgres</Text>
                                    <Text style={styles.connectionButtonIcon}>→</Text>
                                </TouchableOpacity>
                            ) : (
                                <View style={styles.connectionForm}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Connection Name"
                                        value={postgresConnectionName}
                                        onChangeText={setPostgresConnectionName}
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Host"
                                        value={postgresConfig.host}
                                        onChangeText={(text) => setPostgresConfig({ ...postgresConfig, host: text })}
                                        autoCapitalize="none"
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Port (default: 5432)"
                                        value={postgresConfig.port.toString()}
                                        onChangeText={(text) => setPostgresConfig({ ...postgresConfig, port: parseInt(text) || 5432 })}
                                        keyboardType="numeric"
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Driver"
                                        value={postgresConfig.database}
                                        onChangeText={(text) => setPostgresConfig({ ...postgresConfig, database: text })}
                                        autoCapitalize="none"
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Username"
                                        value={postgresConfig.user}
                                        onChangeText={(text) => setPostgresConfig({ ...postgresConfig, user: text })}
                                        autoCapitalize="none"
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Password"
                                        value={postgresConfig.password}
                                        onChangeText={(text) => setPostgresConfig({ ...postgresConfig, password: text })}
                                        secureTextEntry
                                        autoCapitalize="none"
                                    />
                                    {connectionError && (
                                        <Text style={styles.errorText}>{connectionError}</Text>
                                    )}
                                    <View style={styles.formButtons}>
                                        <TouchableOpacity
                                            style={[styles.formButton, styles.formButtonCancel]}
                                            onPress={() => {
                                                setShowPostgresForm(false);
                                                setConnectionError(null);
                                            }}
                                        >
                                            <Text style={styles.formButtonText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.formButton, styles.formButtonSubmit]}
                                            onPress={handleConnectPostgres}
                                            disabled={connecting}
                                        >
                                            {connecting ? (
                                                <ActivityIndicator color="#fff" />
                                            ) : (
                                                <Text style={[styles.formButtonText, styles.formButtonTextSubmit]}>Connect</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* PGLite Driver */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>PGLite (Browser)</Text>
                            {!showCreatePglite ? (
                                <TouchableOpacity
                                    style={styles.connectionButton}
                                    onPress={() => setShowCreatePglite(true)}
                                >
                                    <Text style={styles.connectionButtonText}>Create PGLite Driver</Text>
                                    <Text style={styles.connectionButtonIcon}>+</Text>
                                </TouchableOpacity>
                            ) : (
                                <View style={styles.connectionForm}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Driver Name"
                                        value={newPgliteName}
                                        onChangeText={setNewPgliteName}
                                        autoCapitalize="none"
                                    />
                                    <View style={styles.formButtons}>
                                        <TouchableOpacity
                                            style={[styles.formButton, styles.formButtonCancel]}
                                            onPress={() => {
                                                setShowCreatePglite(false);
                                                setNewPgliteName('');
                                            }}
                                        >
                                            <Text style={styles.formButtonText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.formButton, styles.formButtonSubmit]}
                                            onPress={handleCreatePglite}
                                            disabled={!newPgliteName.trim()}
                                        >
                                            <Text style={[styles.formButtonText, styles.formButtonTextSubmit]}>Create</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* SQLite File */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>SQLite File</Text>
                            <TouchableOpacity
                                style={styles.connectionButton}
                                onPress={handleOpenSqliteFile}
                            >
                                <Text style={styles.connectionButtonText}>Open SQLite File</Text>
                                <Text style={styles.connectionButtonIcon}>📁</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>

                    {/* Driver Dropdown Modal */}
                    <Modal
                        visible={showDatabaseDropdown}
                        transparent={true}
                        animationType="fade"
                        onRequestClose={() => setShowDatabaseDropdown(false)}
                    >
                        <TouchableOpacity
                            style={styles.centeredModalOverlay}
                            activeOpacity={1}
                            onPress={() => setShowDatabaseDropdown(false)}
                        >
                            <View style={styles.centeredDropdownListContainer}>
                                <ScrollView style={styles.dropdownScroll}>
                                    {databases.map((db) => (
                                        <TouchableOpacity
                                            key={db}
                                            style={styles.dropdownItem}
                                            onPress={() => handleDatabaseSelect(db)}
                                        >
                                            <Text style={styles.dropdownItemText}>
                                                {db} ({databaseTableCounts[db] ?? 0} tables)
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        </TouchableOpacity>
                    </Modal>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                {/* Sidebar */}
                {showSidebar && !sidebarCollapsed && (
                    <View style={styles.sidebar}>
                        {/* Collapse handle - two vertical bars on the edge */}
                        <TouchableOpacity
                            style={styles.sidebarCollapseHandle}
                            onPress={toggleSidebar}
                        >
                            <View style={styles.collapseHandleBars}>
                                <View style={styles.collapseHandleBar} />
                                <View style={styles.collapseHandleBar} />
                            </View>
                        </TouchableOpacity>
                        {/* Driver Dropdown - First item */}
                        <View style={styles.databaseDropdownRow}>
                            <TouchableOpacity
                                style={styles.databaseDropdownButton}
                                onPress={() => setShowDatabaseDropdown(true)}
                            >
                                <View style={styles.databaseDropdownContent}>
                                    <Text style={styles.databaseDropdownText} numberOfLines={1}>
                                        {dbName || 'Select Database'}
                                    </Text>
                                    {dbName && (
                                        <Text style={styles.databaseDropdownSubtext}>
                                            ({databaseTableCounts[dbName] ?? tables.length} tables)
                                        </Text>
                                    )}
                                </View>
                                <Text style={styles.databaseDropdownIcon}>▼</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Driver Dropdown Modal */}
                        <Modal
                            visible={showDatabaseDropdown}
                            transparent={true}
                            animationType="fade"
                            onRequestClose={() => setShowDatabaseDropdown(false)}
                        >
                            <TouchableOpacity
                                style={styles.modalOverlay}
                                activeOpacity={1}
                                onPress={() => setShowDatabaseDropdown(false)}
                            >
                                <View style={styles.dropdownContainer}>
                                    <ScrollView style={styles.dropdownScroll}>
                                        {databases.map((db) => (
                                            <TouchableOpacity
                                                key={db}
                                                style={[
                                                    styles.dropdownItem,
                                                    db === dbName && styles.dropdownItemSelected,
                                                ]}
                                                onPress={() => handleDatabaseSelect(db)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.dropdownItemText,
                                                        db === dbName && styles.dropdownItemTextSelected,
                                                    ]}
                                                >
                                                    {db} ({databaseTableCounts[db] ?? 0} tables)
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            </TouchableOpacity>
                        </Modal>

                        <ScrollView style={styles.tableList}>
                            {/* Tables Section */}
                            {sortedTables.length > 0 && (
                                <>
                                    <TouchableOpacity
                                        style={styles.sectionHeader}
                                        onPress={() => setSectionsCollapsed(prev => ({
                                            ...prev,
                                            tables: !prev.tables
                                        }))}
                                    >
                                        <Text style={styles.sectionHeaderText}>Tables</Text>
                                        <Text style={styles.sectionHeaderIcon}>
                                            {sectionsCollapsed.tables ? '▶' : '▼'}
                                        </Text>
                                    </TouchableOpacity>
                                    {!sectionsCollapsed.tables && sortedTables.map((table) => {
                                        const rowCount = tableRowCounts[table] ?? null;
                                        const isEmpty = rowCount === 0;
                                        const isSelected = table === currentTableName;
                                        return (
                                            <TableItem
                                                key={table}
                                                table={table}
                                                rowCount={rowCount}
                                                isEmpty={isEmpty}
                                                isSelected={isSelected}
                                                onPress={handleTableSelect}
                                            />
                                        );
                                    })}
                                </>
                            )}

                            {/* Views Section */}
                            {views.length > 0 && (
                                <>
                                    <TouchableOpacity
                                        style={styles.sectionHeader}
                                        onPress={() => setSectionsCollapsed(prev => ({
                                            ...prev,
                                            views: !prev.views
                                        }))}
                                    >
                                        <Text style={styles.sectionHeaderText}>Views</Text>
                                        <Text style={styles.sectionHeaderIcon}>
                                            {sectionsCollapsed.views ? '▶' : '▼'}
                                        </Text>
                                    </TouchableOpacity>
                                    {!sectionsCollapsed.views && views.map((view) => {
                                        const isSelected = view === currentTableName;
                                        return (
                                            <TableItem
                                                key={view}
                                                table={view}
                                                rowCount={null}
                                                isEmpty={false}
                                                isSelected={isSelected}
                                                onPress={handleTableSelect}
                                            />
                                        );
                                    })}
                                </>
                            )}

                            {/* Materialized Views Section (PostgreSQL only) */}
                            {isPostgres && materializedViews.length > 0 && (
                                <>
                                    <TouchableOpacity
                                        style={styles.sectionHeader}
                                        onPress={() => setSectionsCollapsed(prev => ({
                                            ...prev,
                                            materializedViews: !prev.materializedViews
                                        }))}
                                    >
                                        <Text style={styles.sectionHeaderText}>Materialized Views</Text>
                                        <Text style={styles.sectionHeaderIcon}>
                                            {sectionsCollapsed.materializedViews ? '▶' : '▼'}
                                        </Text>
                                    </TouchableOpacity>
                                    {!sectionsCollapsed.materializedViews && materializedViews.map((matView) => {
                                        const isSelected = matView === currentTableName;
                                        return (
                                            <TableItem
                                                key={matView}
                                                table={matView}
                                                rowCount={null}
                                                isEmpty={false}
                                                isSelected={isSelected}
                                                onPress={handleTableSelect}
                                            />
                                        );
                                    })}
                                </>
                            )}
                        </ScrollView>
                    </View>
                )}

                {/* Main content */}
                <SidebarContext.Provider value={{ sidebarCollapsed, toggleSidebar }}>
                    <View style={styles.mainContent}>
                        {children}
                    </View>
                </SidebarContext.Provider>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    content: {
        flex: 1,
        flexDirection: 'row',
    },
    sidebar: {
        width: 200,
        borderRightWidth: 1,
        borderRightColor: '#e0e0e0',
        backgroundColor: '#fafafa',
        position: 'relative',
    },
    sidebarCollapseHandle: {
        position: 'absolute',
        right: -12,
        top: 0,
        bottom: 0,
        width: 12,
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
    },
    collapseHandleBars: {
        flexDirection: 'row',
        gap: 2,
        alignItems: 'center',
    },
    collapseHandleBar: {
        width: 2,
        height: 20,
        backgroundColor: '#667eea',
        borderRadius: 1,
    },
    databaseDropdownRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: '#dddfff',
        minHeight: 65,
    },
    databaseDropdownButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        justifyContent: 'space-between',
    },
    databaseDropdownContent: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
    },
    databaseDropdownText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    databaseDropdownSubtext: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    databaseDropdownIcon: {
        fontSize: 10,
        color: '#666',
        marginLeft: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        justifyContent: 'flex-start',
        paddingTop: 48,
        paddingLeft: 0,
    },
    dropdownContainer: {
        backgroundColor: '#fff',
        borderRightWidth: 1,
        borderRightColor: '#e0e0e0',
        width: 200,
        maxHeight: '80%',
        shadowColor: '#000',
        shadowOffset: { width: 2, height: 0 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 5,
    },
    dropdownScroll: {
        maxHeight: 400,
    },
    dropdownItem: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    dropdownItemSelected: {
        backgroundColor: '#e8f0ff',
    },
    dropdownItemText: {
        fontSize: 14,
        color: '#333',
    },
    dropdownItemTextSelected: {
        color: '#667eea',
        fontWeight: '600',
    },
    tableList: {
        flex: 1,
    },
    sectionHeader: {
        padding: 8,
        paddingLeft: 12,
        paddingTop: 12,
        paddingRight: 12,
        backgroundColor: '#f0f0f0',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionHeaderText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        flex: 1,
    },
    sectionHeaderIcon: {
        fontSize: 10,
        color: '#666',
        marginLeft: 8,
    },
    tableItem: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
        maxHeight: 36
    },
    tableItemEmpty: {
        opacity: 0.5,
        backgroundColor: '#f9f9f9',
    },
    tableItemSelected: {
        backgroundColor: '#667eea',
        opacity: 1,
    },
    tableItemContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
    },
    tableItemText: {
        fontSize: 14,
        color: '#333',
        flex: 1,
    },
    tableItemTextEmpty: {
        color: '#999',
        fontStyle: 'italic',
    },
    tableItemTextSelected: {
        color: '#fff',
        fontWeight: '500',
        fontStyle: 'normal',
    },
    tableItemCount: {
        fontSize: 12,
        color: '#666',
        marginLeft: 8,
    },
    tableItemCountEmpty: {
        color: '#bbb',
    },
    tableItemCountSelected: {
        color: '#fff',
        opacity: 0.8,
    },
    mainContent: {
        flex: 1,
        backgroundColor: '#fff',
        flexDirection: 'column',
    },
    centeredContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    centeredDropdownContainer: {
        width: 300,
        maxWidth: '80%',
    },
    centeredDropdownButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
        justifyContent: 'space-between',
    },
    centeredModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    centeredDropdownListContainer: {
        backgroundColor: '#fff',
        borderRadius: 8,
        width: 300,
        maxWidth: '80%',
        maxHeight: '60%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 8,
    },
    connectionOptionsScroll: {
        flex: 1,
        width: '100%',
    },
    connectionOptionsContainer: {
        padding: 20,
        alignItems: 'center',
        maxWidth: 500,
        width: '100%',
        alignSelf: 'center',
    },
    connectionTitle: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 30,
        color: '#333',
    },
    section: {
        width: '100%',
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    connectionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#f5f5f5',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    connectionButtonText: {
        fontSize: 16,
        color: '#333',
        fontWeight: '500',
    },
    connectionButtonIcon: {
        fontSize: 16,
        color: '#667eea',
        fontWeight: '600',
    },
    connectionForm: {
        width: '100%',
        padding: 16,
        backgroundColor: '#fafafa',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    input: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 6,
        padding: 12,
        fontSize: 16,
        marginBottom: 12,
        color: '#333',
    },
    formButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
        marginTop: 8,
    },
    formButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 6,
        minWidth: 80,
        alignItems: 'center',
    },
    formButtonCancel: {
        backgroundColor: '#f0f0f0',
    },
    formButtonSubmit: {
        backgroundColor: '#667eea',
    },
    formButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
    },
    formButtonTextSubmit: {
        color: '#fff',
    },
    errorText: {
        color: '#d32f2f',
        fontSize: 14,
        marginBottom: 12,
    },
});

