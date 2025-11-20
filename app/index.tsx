/**
 * Database Test Page
 * 
 * Expo Router page that uses the TestPage component
 */

import React from 'react';
import { useRouter } from 'expo-router';
import TestPage, { type Test } from '../src/pages/TestPage';
import { runCRUDTest } from '../src/tests/crud-test';

// Define available tests
const tests: Test[] = [
  {
    name: 'CRUD Test',
    description: 'Tests Create, Read, Update, and Delete operations',
    connectionInfo: {
      name: 'crud-test',
      driverName: 'pglite',
      dialectName: 'pg',
    },
    run: (addLog) => runCRUDTest(addLog, 'crud-test'),
  },
];

export default function DbTestPage() {
  const router = useRouter();
  
  return (
    <TestPage 
      router={router}
      tests={tests}
    />
  );
}
