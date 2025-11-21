/**
 * Custom hook for handling database exports
 */

import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { connect, getRegistryEntries } from '../../xp-schema';
import { sql } from '../../xp-schema/xp-sql';
import { exporterRegistry } from '../exporters/exporter-registry';
import type { ExportData } from '../exporters/exporter.interface';

export interface UseExportHandlerReturn {
    exporting: boolean;
    showExportModal: boolean;
    setShowExportModal: (show: boolean) => void;
    handleExport: (format: string, selectedTables: string[], exportType: 'raw' | 'formatted') => Promise<void>;
}

export function useExportHandler(dbName: string | null): UseExportHandlerReturn {
    const [exporting, setExporting] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);

    const handleExport = useCallback(async (format: string, selectedTables: string[], exportType: 'raw' | 'formatted') => {
        if (Platform.OS !== 'web' || !dbName) return;
        
        setExporting(true);
        try {
            // Get database connection
            const entries = await getRegistryEntries();
            const entry = entries.find(e => e.name === dbName);
            if (!entry) {
                // @ts-ignore
                alert('Database not found');
                setExporting(false);
                return;
            }
            
            const db = await connect(entry);
            const exporter = exporterRegistry.get(format);
            if (!exporter) {
                // @ts-ignore
                alert(`Exporter for format "${format}" not found`);
                setExporting(false);
                return;
            }

            // Prepare export data for all selected tables
            const tablesData = new Map<string, ExportData>();
            
            for (const tableName of selectedTables) {
                try {
                    const rows = await db.execute(sql.raw(`SELECT * FROM "${tableName}"`)) as any[];
                    const columns = await db.getTableColumns(tableName);
                    
                    tablesData.set(tableName, {
                        columns: columns.map(col => ({
                            name: col.name,
                            label: col.name,
                            dataType: col.dataType,
                            notNull: col.notNull,
                            defaultValue: col.defaultValue,
                        })),
                        rows,
                    });
                } catch (err) {
                    console.error(`Error loading table ${tableName}:`, err);
                }
            }

            if (tablesData.size === 0) {
                // @ts-ignore
                alert('No tables to export');
                setExporting(false);
                return;
            }

            // Export using the exporter
            const results = await exporter.exportTables(tablesData, {
                formatted: exportType === 'formatted',
            });

            // Download files
            const today = new Date().toISOString().split('T')[0];
            const dbNamePart = dbName ? `${dbName}_` : '';

            if (format === 'sqlite') {
                // Single SQLite file
                const result = results[0];
                // @ts-ignore
                const blob = new Blob([result.content], { type: result.mimeType });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${dbNamePart}export_${today}.${result.extension}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                // @ts-ignore
                alert(`Exported ${selectedTables.length} table(s) to SQLite database`);
            } else {
                // Multiple files (one per table)
                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    setTimeout(() => {
                        // @ts-ignore
                        const blob = new Blob([result.content], { type: result.mimeType });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${dbNamePart}${result.fileName}_export_${today}.${result.extension}`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    }, i * 200); // Stagger downloads
                }
                // @ts-ignore
                alert(`Exporting ${results.length} table(s) as ${format.toUpperCase()} files...`);
            }
            
            setShowExportModal(false);
        } catch (err) {
            console.error('Error exporting database:', err);
            // @ts-ignore
            alert(`Error exporting database: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setExporting(false);
        }
    }, [dbName]);

    return {
        exporting,
        showExportModal,
        setShowExportModal,
        handleExport,
    };
}

