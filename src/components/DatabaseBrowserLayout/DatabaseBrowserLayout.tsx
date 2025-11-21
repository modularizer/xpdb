/**
 * Driver Browser Layout Component
 * 
 * Shared layout component for database browser pages with sidebar and main content.
 * Used by [db]/[table] page (which handles both table view and query mode).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    SafeAreaView,
    Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import ExportModal from '../ExportModal';
import { Sidebar } from './Sidebar';
import { ConnectionForms } from './ConnectionForms';
import { DatabaseDropdown } from './DatabaseDropdown';
import { useDatabaseData } from './useDatabaseData';
import { useExportHandler } from './useExportHandler';
import { styles } from './styles';

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
    const [showDatabaseDropdown, setShowDatabaseDropdown] = useState(false);

    // Use custom hooks for data loading and export
    const {
        databases,
        databaseTableCounts,
        tables,
        views,
        materializedViews,
        tableRowCounts,
        isPostgres,
        loadDatabases,
    } = useDatabaseData(dbName);

    const {
        exporting,
        showExportModal,
        setShowExportModal,
        handleExport,
    } = useExportHandler(dbName);

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

    const handleDatabaseSelect = useCallback((selectedDbName: string) => {
        if (selectedDbName !== dbName) {
            setShowDatabaseDropdown(false);
            // Navigate to the database (no table selected initially)
            onNavigate(selectedDbName, null, {});
        } else {
            setShowDatabaseDropdown(false);
        }
    }, [dbName, onNavigate]);

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

    // If no database selected, show connection options
    if (!dbName) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.centeredContent}>
                    <ConnectionForms
                        databases={databases}
                        databaseTableCounts={databaseTableCounts}
                        onNavigate={onNavigate}
                        onLoadDatabases={loadDatabases}
                        styles={styles}
                    />
                    <DatabaseDropdown
                        visible={showDatabaseDropdown}
                        databases={databases}
                        databaseTableCounts={databaseTableCounts}
                        currentDbName={null}
                        onSelect={handleDatabaseSelect}
                        onClose={() => setShowDatabaseDropdown(false)}
                        styles={styles}
                        centered={true}
                    />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                {/* Sidebar */}
                {showSidebar && !sidebarCollapsed && (
                    <Sidebar
                        dbName={dbName}
                        databases={databases}
                        databaseTableCounts={databaseTableCounts}
                        tables={tables}
                        views={views}
                        materializedViews={materializedViews}
                        tableRowCounts={tableRowCounts}
                        isPostgres={isPostgres}
                        currentTableName={currentTableName}
                        onTableSelect={handleTableSelect}
                        onDatabaseSelect={handleDatabaseSelect}
                        onExportPress={() => setShowExportModal(true)}
                        onToggleSidebar={toggleSidebar}
                        styles={styles}
                    />
                )}

                {/* Main content */}
                <SidebarContext.Provider value={{ sidebarCollapsed, toggleSidebar }}>
                    <View style={styles.mainContent}>
                        {children}
                    </View>
                </SidebarContext.Provider>
            </View>

            {/* Database Export Modal */}
            {Platform.OS === 'web' && (
                <ExportModal
                    visible={showExportModal}
                    onClose={() => setShowExportModal(false)}
                    title={`Export Database: ${dbName}`}
                    tables={tables}
                    tableRowCounts={tableRowCounts}
                    showTableSelection={true}
                    availableFormats={['csv', 'markdown', 'json', 'sqlite']}
                    onExport={handleExport}
                    exporting={exporting}
                />
            )}
        </SafeAreaView>
    );
}
