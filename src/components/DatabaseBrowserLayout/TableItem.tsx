/**
 * Table Item Component
 * 
 * Displays a single table/view item in the sidebar
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export interface TableItemProps {
    table: string;
    rowCount: number | null;
    isEmpty: boolean;
    isSelected: boolean;
    onPress: (tableName: string) => void;
    styles: ReturnType<typeof StyleSheet.create>;
}

export const TableItem = React.memo<TableItemProps>(({ 
    table, 
    rowCount, 
    isEmpty, 
    isSelected, 
    onPress,
    styles: componentStyles 
}) => {
    return (
        <TouchableOpacity
            style={[
                componentStyles.tableItem,
                isEmpty && componentStyles.tableItemEmpty,
                isSelected && componentStyles.tableItemSelected,
            ]}
            onPress={() => onPress(table)}
        >
            <View style={componentStyles.tableItemContent}>
                <Text
                    style={[
                        componentStyles.tableItemText,
                        isEmpty && componentStyles.tableItemTextEmpty,
                        isSelected && componentStyles.tableItemTextSelected,
                    ]}
                >
                    {table}
                </Text>
                {rowCount !== null && (
                    <Text
                        style={[
                            componentStyles.tableItemCount,
                            isEmpty && componentStyles.tableItemCountEmpty,
                            isSelected && componentStyles.tableItemCountSelected,
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

