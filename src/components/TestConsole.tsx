/**
 * Test Console Component
 * 
 * Displays test logs in a console-like interface
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

export interface LogEntry {
  type: 'log' | 'error' | 'success';
  message: string;
  timestamp: Date;
}

interface TestConsoleProps {
  logs: LogEntry[];
  isRunning: boolean;
  isComplete: boolean;
}

export default function TestConsole({ logs, isRunning, isComplete }: TestConsoleProps) {
  return (
    <>
      {isRunning && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Running test...</Text>
        </View>
      )}

      {isComplete && (
        <View style={styles.statusContainer}>
          <Text style={styles.statusSuccess}>✅ Test completed successfully!</Text>
        </View>
      )}

      <ScrollView style={styles.logContainer} contentContainerStyle={styles.logContent}>
        {logs.length === 0 && !isRunning && (
          <Text style={styles.emptyText}>Click "Run CRUD Test" to start</Text>
        )}
        {logs.map((log, index) => (
          <Text
            key={index}
            style={[
              styles.logLine,
              log.type === 'error' && styles.errorLine,
              log.type === 'success' && styles.successLine,
            ]}
          >
            {log.message}
          </Text>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  statusContainer: {
    padding: 15,
    backgroundColor: '#e8f5e9',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  statusSuccess: {
    color: '#2e7d32',
    fontWeight: '500',
    textAlign: 'center',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  logContent: {
    padding: 15,
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 4,
    color: '#d4d4d4',
  },
  errorLine: {
    color: '#f48771',
    fontWeight: '500',
  },
  successLine: {
    color: '#4ec9b0',
    fontWeight: '500',
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    fontStyle: 'italic',
    marginTop: 20,
    fontSize: 14,
  },
});


