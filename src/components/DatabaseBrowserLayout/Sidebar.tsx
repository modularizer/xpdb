/**
 * Sidebar Component
 * 
 * Displays database selector, tables, views, and export button
 */

import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Platform,
    StyleSheet,
} from 'react-native';
import { TableItem } from './TableItem';
import { DatabaseDropdown } from './DatabaseDropdown';

export interface SidebarProps {
    dbName: string | null;
    databases: string[];
    databaseTableCounts: Record<string, number>;
    tables: string[];
    views: string[];
    materializedViews: string[];
    tableRowCounts: Record<string, number>;
    isPostgres: boolean;
    currentTableName: string | null | undefined;
    onTableSelect: (tableName: string) => void;
    onDatabaseSelect: (dbName: string) => void;
    onExportPress: () => void;
    onToggleSidebar: () => void;
    styles: ReturnType<typeof StyleSheet.create>;
}

export function Sidebar({
    dbName,
    databases,
    databaseTableCounts,
    tables,
    views,
    materializedViews,
    tableRowCounts,
    isPostgres,
    currentTableName,
    onTableSelect,
    onDatabaseSelect,
    onExportPress,
    onToggleSidebar,
    styles: componentStyles,
}: SidebarProps) {
    const [showDatabaseDropdown, setShowDatabaseDropdown] = useState(false);
    const [sectionsCollapsed, setSectionsCollapsed] = useState<{
        tables: boolean;
        views: boolean;
        materializedViews: boolean;
    }>({
        tables: false,
        views: false,
        materializedViews: false,
    });

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

    return (
        <View style={componentStyles.sidebar}>
            {/* Collapse handle - two vertical bars on the edge */}
            <TouchableOpacity
                style={componentStyles.sidebarCollapseHandle}
                onPress={onToggleSidebar}
            >
                <View style={componentStyles.collapseHandleBars}>
                    <View style={componentStyles.collapseHandleBar} />
                    <View style={componentStyles.collapseHandleBar} />
                </View>
            </TouchableOpacity>
            
            {/* Driver Dropdown - First item */}
            <View style={componentStyles.databaseDropdownRow}>
                <TouchableOpacity
                    style={componentStyles.databaseDropdownButton}
                    onPress={() => setShowDatabaseDropdown(true)}
                >
                    <View style={componentStyles.databaseDropdownContent}>
                        <Text style={componentStyles.databaseDropdownText} numberOfLines={1}>
                            {dbName || 'Select Database'}
                        </Text>
                        {dbName && (
                            <Text style={componentStyles.databaseDropdownSubtext}>
                                ({databaseTableCounts[dbName] ?? tables.length} tables)
                            </Text>
                        )}
                    </View>
                    <Text style={componentStyles.databaseDropdownIcon}>▼</Text>
                </TouchableOpacity>
            </View>

            {/* Driver Dropdown Modal */}
            <DatabaseDropdown
                visible={showDatabaseDropdown}
                databases={databases}
                databaseTableCounts={databaseTableCounts}
                currentDbName={dbName}
                onSelect={onDatabaseSelect}
                onClose={() => setShowDatabaseDropdown(false)}
                styles={componentStyles}
            />

            <ScrollView style={componentStyles.tableList}>
                {/* Tables Section */}
                {sortedTables.length > 0 && (
                    <>
                        <TouchableOpacity
                            style={componentStyles.sectionHeader}
                            onPress={() => setSectionsCollapsed(prev => ({
                                ...prev,
                                tables: !prev.tables
                            }))}
                        >
                            <Text style={componentStyles.sectionHeaderText}>Tables</Text>
                            <Text style={componentStyles.sectionHeaderIcon}>
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
                                    onPress={onTableSelect}
                                    styles={componentStyles}
                                />
                            );
                        })}
                    </>
                )}

                {/* Views Section */}
                {views.length > 0 && (
                    <>
                        <TouchableOpacity
                            style={componentStyles.sectionHeader}
                            onPress={() => setSectionsCollapsed(prev => ({
                                ...prev,
                                views: !prev.views
                            }))}
                        >
                            <Text style={componentStyles.sectionHeaderText}>Views</Text>
                            <Text style={componentStyles.sectionHeaderIcon}>
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
                                    onPress={onTableSelect}
                                    styles={componentStyles}
                                />
                            );
                        })}
                    </>
                )}

                {/* Materialized Views Section (PostgreSQL only) */}
                {isPostgres && materializedViews.length > 0 && (
                    <>
                        <TouchableOpacity
                            style={componentStyles.sectionHeader}
                            onPress={() => setSectionsCollapsed(prev => ({
                                ...prev,
                                materializedViews: !prev.materializedViews
                            }))}
                        >
                            <Text style={componentStyles.sectionHeaderText}>Materialized Views</Text>
                            <Text style={componentStyles.sectionHeaderIcon}>
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
                                    onPress={onTableSelect}
                                    styles={componentStyles}
                                />
                            );
                        })}
                    </>
                )}
            </ScrollView>
            
            {/* Export Database Button */}
            {dbName && Platform.OS === 'web' && (
                <View style={componentStyles.exportSection}>
                    <TouchableOpacity
                        style={componentStyles.exportButton}
                        onPress={onExportPress}
                    >
                        <Text style={componentStyles.exportButtonText}>📤 Export Database</Text>
                        <Text style={componentStyles.exportButtonSubtext}>Select tables & format</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}


