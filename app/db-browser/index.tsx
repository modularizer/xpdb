/**
 * Database Browser Index Page
 * 
 * Lists all registered databases from the registry and allows navigation to them
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getRegistryEntries, connect } from '../../src/xp-schema';
import type { DbConnectionInfo } from '../../src/xp-schema';

interface DatabaseInfo extends DbConnectionInfo {
  tableCount?: number;
  loading?: boolean;
}

export default function DatabaseBrowserIndex() {
  const router = useRouter();
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDatabases = useCallback(async () => {
    try {
      console.log('[db-browser/index] Loading databases from registry...');
      const registry = await getRegistryEntries();
      console.log('[db-browser/index] Registry entries:', registry);
      console.log('[db-browser/index] Registry count:', registry.length);
      
      if (registry.length === 0) {
        // Try to check storage directly for debugging
        const { getStorage } = await import('../../src/xp-schema/kv');
        const storage = await getStorage();
        const rawValue = await storage.get('databases');
        console.log('[db-browser/index] Raw storage value for "databases":', rawValue);
      }
      
      // Load table counts for each database
      const databasesWithCounts: DatabaseInfo[] = await Promise.all(
        registry.map(async (entry) => {
          const dbInfo: DatabaseInfo = { ...entry, loading: true };
          try {
            const db = await connect(entry);
            const metadata = await db.getMetadata();
            dbInfo.tableCount = metadata.tableCount;
            dbInfo.loading = false;
          } catch (err) {
            console.error(`Error loading metadata for ${entry.name}:`, err);
            dbInfo.tableCount = 0;
            dbInfo.loading = false;
          }
          return dbInfo;
        })
      );
      
      console.log('[db-browser/index] Databases with counts:', databasesWithCounts);
      setDatabases(databasesWithCounts);
    } catch (err) {
      console.error('Error loading databases:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadDatabases();
  }, [loadDatabases]);

  const handleDatabasePress = useCallback((dbName: string) => {
    router.push(`/db-browser/${encodeURIComponent(dbName)}`);
  }, [router]);

  const handleCreateNew = useCallback(() => {
    // Navigate to a database browser page where they can create a new database
    // For now, just show a message or navigate to the first database if available
    if (databases.length > 0) {
      router.push(`/db-browser/${encodeURIComponent(databases[0].name)}`);
    }
  }, [router, databases]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Loading databases...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Database Browser</Text>
        <Text style={styles.subtitle}>
          {databases.length === 0 
            ? 'No databases registered' 
            : `${databases.length} database${databases.length === 1 ? '' : 's'} available`}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {databases.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No databases found</Text>
            <Text style={styles.emptySubtext}>
              Run a test from the home page to create a database, or create one from the database browser
            </Text>
          </View>
        ) : (
          databases.map((db) => (
            <TouchableOpacity
              key={db.name}
              style={styles.databaseCard}
              onPress={() => handleDatabasePress(db.name)}
            >
              <View style={styles.databaseCardHeader}>
                <Text style={styles.databaseName}>{db.name}</Text>
                {db.loading ? (
                  <ActivityIndicator size="small" color="#667eea" />
                ) : (
                  <View style={styles.databaseBadge}>
                    <Text style={styles.databaseBadgeText}>
                      {db.tableCount ?? 0} table{db.tableCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.databaseInfo}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Driver:</Text>
                  <Text style={styles.infoValue}>{db.driverName}</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Dialect:</Text>
                  <Text style={styles.infoValue}>{db.dialectName}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  databaseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  databaseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  databaseName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  databaseBadge: {
    backgroundColor: '#667eea',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  databaseBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  databaseInfo: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontFamily: 'monospace',
  },
});