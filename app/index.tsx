/**
 * Database Test Page
 * 
 * Expo Router page that uses the TestPage component
 */

import React from 'react';
import { useRouter } from 'expo-router';
import TestPage, { type Test } from '../src/pages/TestPage';
import { runCRUDTest } from '../src/tests/crud-test';
import { runSportsDBTest } from '../src/tests/sports-db-test';
import { runDebugInsertTest } from '../src/tests/debug-insert-test';
import { runPresidentsDBTest } from '../src/tests/presidents-db-test';

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
  {
    name: 'Sports DB',
    description: 'Sets up and seeds a sports database with leagues, teams, players, games, and stats',
    connectionInfo: {
      name: 'sports-db',
      driverName: 'pglite',
      dialectName: 'pg',
    },
    run: (addLog) => runSportsDBTest(addLog, 'sports-db'),
  },
  {
    name: 'Presidents DB',
    description: 'Sets up and seeds a database about US presidents, states, elections, and presidency statistics',
    connectionInfo: {
      name: 'presidents-db',
      driverName: 'pglite',
      dialectName: 'pg',
    },
    run: (addLog) => runPresidentsDBTest(addLog, 'presidents-db'),
  },
  {
    name: 'Debug Insert Test',
    description: 'Simplified tests to isolate insert failures with uuidPK',
    connectionInfo: {
      name: 'debug-test',
      driverName: 'pglite',
      dialectName: 'pg',
    },
    run: (addLog) => runDebugInsertTest(addLog, 'debug-test'),
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
