/**
 * Shared Export Modal Component
 * 
 * Handles both single-table and multi-table exports
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { exporterRegistry } from './exporters/exporter-registry';
import type { ExportData, ExportOptions } from './exporters/exporter.interface';

export interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  /** Title shown in the modal header */
  title: string;
  /** Available tables for selection (empty array for single-table mode) */
  tables: string[];
  /** Table row counts for display (optional) */
  tableRowCounts?: Record<string, number>;
  /** Default selected tables (for multi-table mode, defaults to all; for single-table, defaults to the single table) */
  defaultSelectedTables?: string[];
  /** Whether to show table selection (true for database export, false for single table export) */
  showTableSelection?: boolean;
  /** Export format options (defaults to all except SQLite for single-table) */
  availableFormats?: string[];
  /** Callback when export is triggered */
  onExport: (format: string, selectedTables: string[], exportType: 'raw' | 'formatted') => Promise<void>;
  /** Whether export is in progress */
  exporting?: boolean;
}

export default function ExportModal({
  visible,
  onClose,
  title,
  tables,
  tableRowCounts = {},
  defaultSelectedTables,
  showTableSelection = false,
  availableFormats,
  onExport,
  exporting = false,
}: ExportModalProps) {
  const [exportFormat, setExportFormat] = useState<string>('csv');
  const [exportType, setExportType] = useState<'raw' | 'formatted'>('formatted');
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());

  // Initialize selected tables based on defaults
  useEffect(() => {
    if (visible) {
      if (defaultSelectedTables && defaultSelectedTables.length > 0) {
        setSelectedTables(new Set(defaultSelectedTables));
      } else if (showTableSelection && tables.length > 0) {
        // For database export, default to all tables
        setSelectedTables(new Set(tables));
      } else if (!showTableSelection && tables.length === 1) {
        // For single table export, default to that table
        setSelectedTables(new Set(tables));
      } else {
        setSelectedTables(new Set());
      }
    }
  }, [visible, defaultSelectedTables, showTableSelection, tables]);

  // Get available formats
  // Filter out SQLite on non-web platforms
  const allFormats = availableFormats || (showTableSelection 
    ? exporterRegistry.getTypes() 
    : exporterRegistry.getTypes().filter(t => t !== 'sqlite'));
  
  // Filter formats based on platform (SQLite only on web)
  const formats = Platform.OS === 'web' 
    ? allFormats 
    : allFormats.filter(t => t !== 'sqlite');

  // Get exporter info
  const exporters = formats.map(type => exporterRegistry.get(type)).filter(Boolean);

  const handleExport = async () => {
    if (exporting || selectedTables.size === 0) return;
    await onExport(exportFormat, Array.from(selectedTables), exportType);
  };

  const toggleSelectAll = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables));
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={() => !exporting && onClose()}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => !exporting && onClose()}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <TouchableOpacity
                onPress={() => !exporting && onClose()}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalDescription}>
                Export Format:
              </Text>
              
              <View style={styles.formatSelector}>
                {exporters.map((exporter) => (
                  <TouchableOpacity
                    key={exporter.type}
                    style={[
                      styles.formatButton,
                      exportFormat === exporter.type && styles.formatButtonSelected,
                    ]}
                    onPress={() => setExportFormat(exporter.type)}
                    disabled={exporting}
                  >
                    <Text style={[
                      styles.formatButtonText,
                      exportFormat === exporter.type && styles.formatButtonTextSelected,
                    ]}>
                      {exporter.displayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {showTableSelection && (
                <>
                  <Text style={[styles.modalDescription, { marginTop: 20, marginBottom: 12 }]}>
                    Select Tables ({selectedTables.size} of {tables.length} selected):
                  </Text>
                  
                  <View style={styles.tableSelector}>
                    <TouchableOpacity
                      style={styles.selectAllButton}
                      onPress={toggleSelectAll}
                      disabled={exporting}
                    >
                      <Text style={styles.selectAllButtonText}>
                        {selectedTables.size === tables.length ? 'Deselect All' : 'Select All'}
                      </Text>
                    </TouchableOpacity>
                    <ScrollView style={styles.tableList}>
                      {tables.map(table => (
                        <TouchableOpacity
                          key={table}
                          style={[
                            styles.tableItem,
                            selectedTables.has(table) && styles.tableItemSelected,
                          ]}
                          onPress={() => {
                            if (exporting) return;
                            const newSelected = new Set(selectedTables);
                            if (newSelected.has(table)) {
                              newSelected.delete(table);
                            } else {
                              newSelected.add(table);
                            }
                            setSelectedTables(newSelected);
                          }}
                          disabled={exporting}
                        >
                          <View style={styles.tableCheckbox}>
                            {selectedTables.has(table) && (
                              <View style={styles.tableCheckboxSelected} />
                            )}
                          </View>
                          <Text style={styles.tableItemText}>{table}</Text>
                          {tableRowCounts[table] !== undefined && (
                            <Text style={styles.tableItemCount}>
                              ({tableRowCounts[table].toLocaleString()} rows)
                            </Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}

              {!showTableSelection && (
                <>
                  <Text style={[styles.modalDescription, { marginTop: 20, marginBottom: 12 }]}>
                    Data Type:
                  </Text>
                  
                  <TouchableOpacity
                    style={[
                      styles.exportOption,
                      exportType === 'formatted' && styles.exportOptionSelected,
                    ]}
                    onPress={() => setExportType('formatted')}
                    disabled={exporting}
                  >
                    <View style={styles.exportOptionContent}>
                      <View style={styles.exportRadio}>
                        {exportType === 'formatted' && (
                          <View style={styles.exportRadioSelected} />
                        )}
                      </View>
                      <View style={styles.exportOptionText}>
                        <Text style={styles.exportOptionTitle}>Formatted Data</Text>
                        <Text style={styles.exportOptionDescription}>
                          Export data as displayed in the table (formatted numbers, dates, etc.)
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.exportOption,
                      exportType === 'raw' && styles.exportOptionSelected,
                    ]}
                    onPress={() => setExportType('raw')}
                    disabled={exporting}
                  >
                    <View style={styles.exportOptionContent}>
                      <View style={styles.exportRadio}>
                        {exportType === 'raw' && (
                          <View style={styles.exportRadioSelected} />
                        )}
                      </View>
                      <View style={styles.exportOptionText}>
                        <Text style={styles.exportOptionTitle}>Raw Data</Text>
                        <Text style={styles.exportOptionDescription}>
                          Export underlying query results without formatting
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </>
              )}
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => !exporting && onClose()}
                disabled={exporting}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalDownloadButton]}
                onPress={handleExport}
                disabled={exporting || selectedTables.size === 0}
              >
                {exporting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Export</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 8,
    width: '95%',
    maxWidth: 600,
    maxHeight: '90%',
    // @ts-ignore - position fixed is web-specific
    ...(Platform.OS === 'web' && { position: 'fixed' }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  modalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 20,
    color: '#666',
  },
  modalBody: {
    padding: 20,
    maxHeight: 500,
  },
  modalDescription: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 12,
  },
  formatSelector: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  formatButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  formatButtonSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  formatButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  formatButtonTextSelected: {
    color: '#fff',
  },
  tableSelector: {
    marginTop: 10,
  },
  selectAllButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    marginBottom: 10,
  },
  selectAllButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
  },
  tableList: {
    maxHeight: 200,
  },
  tableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableItemSelected: {
    backgroundColor: '#f0f7ff',
  },
  tableCheckbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableCheckboxSelected: {
    width: 12,
    height: 12,
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  tableItemText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  tableItemCount: {
    fontSize: 12,
    color: '#666',
  },
  exportOption: {
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 10,
  },
  exportOptionSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
  },
  exportOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exportRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exportRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  exportOptionText: {
    flex: 1,
  },
  exportOptionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  exportOptionDescription: {
    fontSize: 12,
    color: '#666',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButton: {
    backgroundColor: '#f5f5f5',
  },
  modalDownloadButton: {
    backgroundColor: '#007AFF',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
});

