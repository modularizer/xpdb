/**
 * Test Page Component
 * 
 * Generic page component for running database tests
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import type { DbConnectionInfo } from '../xp-schema';
import TestConsole, { type LogEntry } from '../components/TestConsole';

export interface Test {
  name: string;
  description?: string;
  connectionInfo: DbConnectionInfo;
  run: (addLog: (message: string, type?: 'log' | 'error' | 'success') => void) => Promise<void>;
}

interface TestPageProps {
  router?: {
    push: (path: string) => void;
  };
  tests: Test[];
}

export default function TestPage({ 
  router, 
  tests
}: TestPageProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [selectedTestIndex, setSelectedTestIndex] = useState<number | null>(null);

  const addLog = (message: string, type: 'log' | 'error' | 'success' = 'log') => {
    setLogs(prev => [...prev, { type, message, timestamp: new Date() }]);
  };

  const handleRunTest = async (testIndex: number) => {
    if (testIndex < 0 || testIndex >= tests.length) return;
    
    const test = tests[testIndex];
    setIsRunning(true);
    setIsComplete(false);
    setLogs([]);
    setSelectedTestIndex(testIndex);

    try {
      addLog(`🚀 Starting test: ${test.name}`, 'log');
      if (test.description) {
        addLog(`📝 ${test.description}`, 'log');
      }
      await test.run(addLog);
      setIsComplete(true);
    } catch (error) {
      addLog('❌ Test failed:', 'error');
      if (error instanceof Error) {
        addLog(`   Error message: ${error.message}`, 'error');
        if (error.stack) {
          addLog(`   Stack: ${error.stack}`, 'error');
        }
      } else {
        addLog(`   Error: ${JSON.stringify(error)}`, 'error');
      }
    } finally {
      setIsRunning(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setIsComplete(false);
    setSelectedTestIndex(null);
  };

  const defaultRouter = router || {
    push: () => {
      console.warn('Router not provided to TestPage');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Database Tests</Text>
        <View style={styles.buttonRow}>
          {tests.map((test, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.button,
                styles.buttonSecondary,
                selectedTestIndex === index && styles.testButtonSelected,
                isRunning && styles.testButtonDisabled
              ]}
              onPress={() => !isRunning && handleRunTest(index)}
              disabled={isRunning}
            >
              <Text style={[
                styles.buttonText,
                styles.buttonTextSecondary,
                selectedTestIndex === index && styles.testButtonTextSelected
              ]}>
                {test.name}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={clearLogs}
            disabled={isRunning}
          >
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
              Clear
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={() => defaultRouter.push('/db-browser')}
            disabled={isRunning}
          >
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
              Browse DB
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <TestConsole logs={logs} isRunning={isRunning} isComplete={isComplete} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  testSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 15,
    justifyContent: 'center',
  },
  testButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#667eea',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  testButtonSelected: {
    backgroundColor: '#667eea',
  },
  testButtonDisabled: {
    opacity: 0.5,
  },
  testButtonText: {
    color: '#667eea',
    fontSize: 14,
    fontWeight: '500',
  },
  testButtonTextSelected: {
    color: '#fff',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    flexWrap: 'nowrap',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#667eea',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#667eea',
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  buttonTextSecondary: {
    color: '#667eea',
  },
});

