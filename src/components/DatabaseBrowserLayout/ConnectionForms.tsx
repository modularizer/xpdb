/**
 * Connection Forms Component
 * 
 * Handles PostgreSQL, PGLite, and SQLite connection forms
 */

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Platform,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { connect, saveRegistryEntry, createOrRetrieveRegistryEntry, getRegistryEntries } from '../../xp-schema';
import type { PostgresConnectionInfo } from '../../xp-schema/xp-sql/drivers/connection-info-types';

export interface ConnectionFormsProps {
    databases: string[];
    databaseTableCounts: Record<string, number>;
    onNavigate: (dbName: string | null, tableName: string | null, searchParams: Record<string, string>) => void;
    onLoadDatabases: () => Promise<void>;
    styles: ReturnType<typeof StyleSheet.create>;
}

export function ConnectionForms({
    databases,
    databaseTableCounts,
    onNavigate,
    onLoadDatabases,
    styles: componentStyles,
}: ConnectionFormsProps) {
    const [showPostgresForm, setShowPostgresForm] = useState(false);
    const [postgresConnectionName, setPostgresConnectionName] = useState('');
    const [postgresConfig, setPostgresConfig] = useState({
        host: '',
        port: 5432,
        database: '',
        user: '',
        password: '',
    });
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    
    const [showCreatePglite, setShowCreatePglite] = useState(false);
    const [newPgliteName, setNewPgliteName] = useState('');
    
    const [showDatabaseDropdown, setShowDatabaseDropdown] = useState(false);

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
            await onLoadDatabases();
            setShowPostgresForm(false);
            onNavigate(postgresConnectionName, null, {});
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setConnectionError(errorMessage);
        } finally {
            setConnecting(false);
        }
    }, [postgresConnectionName, postgresConfig, onNavigate, onLoadDatabases]);

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
            
            await onLoadDatabases();
            setShowCreatePglite(false);
            setNewPgliteName('');
            onNavigate(name, null, {});
        } catch (error) {
            console.error('Error creating PGLite database:', error);
        }
    }, [newPgliteName, onNavigate, onLoadDatabases]);

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

    const handleDatabaseSelect = useCallback((selectedDbName: string) => {
        setShowDatabaseDropdown(false);
        onNavigate(selectedDbName, null, {});
    }, [onNavigate]);

    return (
        <ScrollView style={componentStyles.connectionOptionsScroll} contentContainerStyle={componentStyles.connectionOptionsContainer}>
            <Text style={componentStyles.connectionTitle}>Connect to Driver</Text>

            {/* Existing Databases */}
            {databases.length > 0 && (
                <View style={componentStyles.section}>
                    <Text style={componentStyles.sectionTitle}>Existing Databases</Text>
                    <TouchableOpacity
                        style={componentStyles.connectionButton}
                        onPress={() => setShowDatabaseDropdown(true)}
                    >
                        <Text style={componentStyles.connectionButtonText}>Select Driver</Text>
                        <Text style={componentStyles.connectionButtonIcon}>▼</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Postgres Connection */}
            <View style={componentStyles.section}>
                <Text style={componentStyles.sectionTitle}>PostgreSQL (Remote)</Text>
                {!showPostgresForm ? (
                    <TouchableOpacity
                        style={componentStyles.connectionButton}
                        onPress={() => setShowPostgresForm(true)}
                    >
                        <Text style={componentStyles.connectionButtonText}>Connect to Postgres</Text>
                        <Text style={componentStyles.connectionButtonIcon}>→</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={componentStyles.connectionForm}>
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Connection Name"
                            value={postgresConnectionName}
                            onChangeText={setPostgresConnectionName}
                        />
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Host"
                            value={postgresConfig.host}
                            onChangeText={(text) => setPostgresConfig({ ...postgresConfig, host: text })}
                            autoCapitalize="none"
                        />
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Port (default: 5432)"
                            value={postgresConfig.port.toString()}
                            onChangeText={(text) => setPostgresConfig({ ...postgresConfig, port: parseInt(text) || 5432 })}
                            keyboardType="numeric"
                        />
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Database"
                            value={postgresConfig.database}
                            onChangeText={(text) => setPostgresConfig({ ...postgresConfig, database: text })}
                            autoCapitalize="none"
                        />
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Username"
                            value={postgresConfig.user}
                            onChangeText={(text) => setPostgresConfig({ ...postgresConfig, user: text })}
                            autoCapitalize="none"
                        />
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Password"
                            value={postgresConfig.password}
                            onChangeText={(text) => setPostgresConfig({ ...postgresConfig, password: text })}
                            secureTextEntry
                            autoCapitalize="none"
                        />
                        {connectionError && (
                            <Text style={componentStyles.errorText}>{connectionError}</Text>
                        )}
                        <View style={componentStyles.formButtons}>
                            <TouchableOpacity
                                style={[componentStyles.formButton, componentStyles.formButtonCancel]}
                                onPress={() => {
                                    setShowPostgresForm(false);
                                    setConnectionError(null);
                                }}
                            >
                                <Text style={componentStyles.formButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[componentStyles.formButton, componentStyles.formButtonSubmit]}
                                onPress={handleConnectPostgres}
                                disabled={connecting}
                            >
                                {connecting ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={[componentStyles.formButtonText, componentStyles.formButtonTextSubmit]}>Connect</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>

            {/* PGLite Driver */}
            <View style={componentStyles.section}>
                <Text style={componentStyles.sectionTitle}>PGLite (Browser)</Text>
                {!showCreatePglite ? (
                    <TouchableOpacity
                        style={componentStyles.connectionButton}
                        onPress={() => setShowCreatePglite(true)}
                    >
                        <Text style={componentStyles.connectionButtonText}>Create PGLite Driver</Text>
                        <Text style={componentStyles.connectionButtonIcon}>+</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={componentStyles.connectionForm}>
                        <TextInput
                            style={componentStyles.input}
                            placeholder="Driver Name"
                            value={newPgliteName}
                            onChangeText={setNewPgliteName}
                            autoCapitalize="none"
                        />
                        <View style={componentStyles.formButtons}>
                            <TouchableOpacity
                                style={[componentStyles.formButton, componentStyles.formButtonCancel]}
                                onPress={() => {
                                    setShowCreatePglite(false);
                                    setNewPgliteName('');
                                }}
                            >
                                <Text style={componentStyles.formButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[componentStyles.formButton, componentStyles.formButtonSubmit]}
                                onPress={handleCreatePglite}
                                disabled={!newPgliteName.trim()}
                            >
                                <Text style={[componentStyles.formButtonText, componentStyles.formButtonTextSubmit]}>Create</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </View>

            {/* SQLite File */}
            <View style={componentStyles.section}>
                <Text style={componentStyles.sectionTitle}>SQLite File</Text>
                <TouchableOpacity
                    style={componentStyles.connectionButton}
                    onPress={handleOpenSqliteFile}
                >
                    <Text style={componentStyles.connectionButtonText}>Open SQLite File</Text>
                    <Text style={componentStyles.connectionButtonIcon}>📁</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}


