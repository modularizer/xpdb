/**
 * Database Dropdown Component
 * 
 * Modal for selecting a database from the list
 */

import React from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Modal,
    StyleSheet,
} from 'react-native';

export interface DatabaseDropdownProps {
    visible: boolean;
    databases: string[];
    databaseTableCounts: Record<string, number>;
    currentDbName: string | null;
    onSelect: (dbName: string) => void;
    onClose: () => void;
    styles: ReturnType<typeof StyleSheet.create>;
    centered?: boolean;
}

export function DatabaseDropdown({
    visible,
    databases,
    databaseTableCounts,
    currentDbName,
    onSelect,
    onClose,
    styles: componentStyles,
    centered = false,
}: DatabaseDropdownProps) {
    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableOpacity
                style={centered ? componentStyles.centeredModalOverlay : componentStyles.modalOverlay}
                activeOpacity={1}
                onPress={onClose}
            >
                <View style={centered ? componentStyles.centeredDropdownListContainer : componentStyles.dropdownContainer}>
                    <ScrollView style={componentStyles.dropdownScroll}>
                        {databases.map((db) => (
                            <TouchableOpacity
                                key={db}
                                style={[
                                    componentStyles.dropdownItem,
                                    db === currentDbName && componentStyles.dropdownItemSelected,
                                ]}
                                onPress={() => {
                                    onSelect(db);
                                    onClose();
                                }}
                            >
                                <Text
                                    style={[
                                        componentStyles.dropdownItemText,
                                        db === currentDbName && componentStyles.dropdownItemTextSelected,
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
    );
}


