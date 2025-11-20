import { table, uuidPK, uuid, integer, timestamp, xpschema, createOrRetrieveRegistryEntry, deleteDatabase, varchar } from '../xp-schema';
import { sql } from 'drizzle-orm';

export interface LogCallback {
  (message: string, type?: 'log' | 'error' | 'success'): void;
}

// Helper function to delete database and wait for it to complete
async function deleteDatabaseAndWait(connInfo: any, addLog: LogCallback): Promise<void> {
  // Try multiple times to ensure deletion works
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Try to connect and drop all tables first
      try {
        const existingDb = await xpschema({}).connect(connInfo);
        const tables = await existingDb.getTableNames();
        for (const tableName of tables) {
          try {
            await existingDb.execute(sql.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`));
          } catch (e) {
            // Ignore individual table drop errors
          }
        }
        await existingDb.close();
        // Wait for connection to fully close
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        // Ignore - connection might not exist
      }
      
      await deleteDatabase(connInfo);
      
      // Wait longer for IndexedDB deletion to complete
      // IndexedDB deletion can be slow, especially if there are open connections
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify deletion by trying to connect and check for tables
      try {
        const testDb = await xpschema({}).connect(connInfo);
        const tables = await testDb.getTableNames();
        await testDb.close();
        
        if (tables.length === 0) {
          // Database exists but is empty - good enough
          return;
        }
        
        // If we get here, database still has tables - try again
        if (attempt < 2) {
          addLog(`   Deletion attempt ${attempt + 1} failed (${tables.length} tables remain), retrying...`, 'log');
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        } else {
          addLog(`   ⚠️  Database deletion incomplete: ${tables.length} tables still exist`, 'log');
          // Continue anyway - we'll drop tables explicitly before migration
        }
      } catch (e) {
        // Connection failed - database was deleted, good!
        return;
      }
    } catch (e: any) {
      if (attempt === 2) {
        // Last attempt failed
        addLog(`   ⚠️  Could not fully delete database: ${e.message}`, 'log');
        // Continue anyway - might still work
      } else {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }
}

export async function runDebugInsertTest(
  addLog: LogCallback,
  dbName: string = 'debug-test'
): Promise<void> {

  try {
    addLog('🔍 Starting debug insert test...', 'log');

    // Test 1: Simplest possible case - single column with uuidPK
    addLog('📋 Test 1: Single column with uuidPK', 'log');
    const test1DbName = `${dbName}-test1`;
    
    // Delete database if it exists
    addLog(`   Deleting database: ${test1DbName}`, 'log');
    try {
      const test1ConnInfo = await createOrRetrieveRegistryEntry({
        name: test1DbName,
        driverName: 'pglite',
        dialectName: 'pg',
      });
      await deleteDatabaseAndWait(test1ConnInfo, addLog);
      addLog(`   ✅ Database ${test1DbName} deleted`, 'success');
    } catch (e: any) {
      addLog(`   ⚠️  Could not delete database ${test1DbName}: ${e.message}`, 'log');
      // Continue anyway - might still work
    }
    
    const simpleTable = table('simple_test', {
      id: uuidPK('id'),
    });

    const simpleSchema = xpschema({
      simple: simpleTable,
    });

    const connInfo = await createOrRetrieveRegistryEntry({
      name: test1DbName,
      driverName: 'pglite',
      dialectName: 'pg',
    });
    const db = await simpleSchema.connect(connInfo);
    
    // Drop any existing tables explicitly before migration
    try {
      const existingTables = await db.getTableNames();
      for (const tableName of existingTables) {
        addLog(`   Dropping existing table: ${tableName}`, 'log');
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`));
      }
      if (existingTables.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (e: any) {
      addLog(`   ⚠️  Could not drop existing tables: ${e.message}`, 'log');
    }
    
    await db.createOrMigrate();

    try {
      const result = await db.simple.insert({}).returning();
      addLog(`✅ Test 1 passed: Inserted ${result.length} row(s)`, 'success');
      addLog(`   Inserted ID: ${result[0]?.id}`, 'log');
    } catch (error: any) {
      addLog(`❌ Test 1 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 2: uuidPK + one regular column
    addLog('📋 Test 2: uuidPK + one regular column', 'log');
    const test2DbName = `${dbName}-test2`;
    
    // Delete database if it exists
    try {
      await db.close();
      const test2ConnInfo = await createOrRetrieveRegistryEntry({
        name: test2DbName,
        driverName: 'pglite',
        dialectName: 'pg',
      });
      await deleteDatabaseAndWait(test2ConnInfo, addLog);
    } catch (e) {
      // Ignore
    }
    
    const twoColTable = table('two_col_test', {
      id: uuidPK('id'),
      name: varchar('name', { length: 100 }),
    });

    const twoColSchema = xpschema({
      twoCol: twoColTable,
    });

    const connInfo2 = await createOrRetrieveRegistryEntry({
      name: test2DbName,
      driverName: 'pglite',
      dialectName: 'pg',
    });
    const db2 = await twoColSchema.connect(connInfo2);
    await db2.createOrMigrate();

    try {
      const result = await db2.twoCol.insert({ name: 'Test' }).returning();
      addLog(`✅ Test 2 passed: Inserted ${result.length} row(s)`, 'success');
      addLog(`   Inserted ID: ${result[0]?.id}, Name: ${result[0]?.name}`, 'log');
    } catch (error: any) {
      addLog(`❌ Test 2 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 3: uuidPK + multiple columns with defaults
    addLog('📋 Test 3: uuidPK + multiple columns with defaults', 'log');
    const test3DbName = `${dbName}-test3`;
    
    // Delete database if it exists
    try {
      await db2.close();
      const test3ConnInfo = await createOrRetrieveRegistryEntry({
        name: test3DbName,
        driverName: 'pglite',
        dialectName: 'pg',
      });
      await deleteDatabaseAndWait(test3ConnInfo, addLog);
    } catch (e) {
      // Ignore
    }
    
    const multiColTable = table('multi_col_test', {
      id: uuidPK('id'),
      points: integer('points').default(0),
      rebounds: integer('rebounds').default(0),
      createdAt: timestamp('created_at').defaultNow().notNull(),
    });

    const multiColSchema = xpschema({
      multiCol: multiColTable,
    });

    const connInfo3 = await createOrRetrieveRegistryEntry({
      name: test3DbName,
      driverName: 'pglite',
      dialectName: 'pg',
    });
    const db3 = await multiColSchema.connect(connInfo3);
    await db3.createOrMigrate();

    try {
      const result = await db3.multiCol.insert({
        points: 10,
        rebounds: 5,
      }).returning();
      addLog(`✅ Test 3 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 3 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 4: Batch insert (single row)
    addLog('📋 Test 4: Batch insert (single row)', 'log');
    try {
      const result = await db3.multiCol.insert([
        { points: 20, rebounds: 10 },
      ]).returning();
      addLog(`✅ Test 4 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 4 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 5: Batch insert (multiple rows)
    addLog('📋 Test 5: Batch insert (multiple rows)', 'log');
    try {
      const result = await db3.multiCol.insert([
        { points: 30, rebounds: 15 },
        { points: 40, rebounds: 20 },
        { points: 50, rebounds: 25 },
      ]).returning();
      addLog(`✅ Test 5 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 5 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 6: Large batch insert (12 rows - same as game_stats)
    addLog('📋 Test 6: Large batch insert (12 rows)', 'log');
    try {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        points: i * 10,
        rebounds: i * 5,
      }));
      const result = await db3.multiCol.insert(rows).returning();
      addLog(`✅ Test 6 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 6 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 7: Table with foreign key (like game_stats)
    addLog('📋 Test 7: Table with foreign key', 'log');
    const test7DbName = `${dbName}-test7`;
    
    // Delete database if it exists
    try {
      await db3.close();
      const test7ConnInfo = await createOrRetrieveRegistryEntry({
        name: test7DbName,
        driverName: 'pglite',
        dialectName: 'pg',
      });
      await deleteDatabaseAndWait(test7ConnInfo, addLog);
    } catch (e) {
      // Ignore
    }
    
    const parentTable = table('parent_test', {
      id: uuidPK('id'),
      name: varchar('name', { length: 100 }),
    });

    const childTable = table('child_test', {
      id: uuidPK('id'),
      parentId: uuid('parent_id').notNull().references(() => parentTable.id),
      value: integer('value').default(0),
    });

    const fkSchema = xpschema({
      parent: parentTable,
      child: childTable,
    });

    const connInfo7 = await createOrRetrieveRegistryEntry({
      name: test7DbName,
      driverName: 'pglite',
      dialectName: 'pg',
    });
    const db4 = await fkSchema.connect(connInfo7);
    await db4.createOrMigrate();

    // Insert parent first
    const parent = await db4.parent.insert({ name: 'Parent' }).returning();
    const parentId = parent[0].id;
    addLog(`   Created parent with ID: ${parentId}`, 'log');

    try {
      const result = await db4.child.insert({
        parentId,
        value: 100,
      }).returning();
      addLog(`✅ Test 7 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 7 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 8: Batch insert with foreign key (like game_stats)
    addLog('📋 Test 8: Batch insert with foreign key (12 rows)', 'log');
    try {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        parentId,
        value: i * 10,
      }));
      const result = await db4.child.insert(rows).returning();
      addLog(`✅ Test 8 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 8 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      throw error;
    }

    // Test 9: Exact replica of game_stats structure
    addLog('📋 Test 9: Exact replica of game_stats structure', 'log');
    const test9DbName = `${dbName}-test9`;
    
    // Delete database if it exists
    try {
      await db4.close();
      const test9ConnInfo = await createOrRetrieveRegistryEntry({
        name: test9DbName,
        driverName: 'pglite',
        dialectName: 'pg',
      });
      await deleteDatabaseAndWait(test9ConnInfo, addLog);
    } catch (e) {
      // Ignore
    }
    
    const gameTable = table('game_test', {
      id: uuidPK('id'),
      name: varchar('name', { length: 100 }),
    });

    const playerTable = table('player_test', {
      id: uuidPK('id'),
      name: varchar('name', { length: 100 }),
    });

    const gameStatsTable = table('game_stats_test', {
      id: uuidPK('id'),
      gameId: uuid('game_id').notNull().references(() => gameTable.id),
      playerId: uuid('player_id').notNull().references(() => playerTable.id),
      points: integer('points').default(0),
      rebounds: integer('rebounds').default(0),
      assists: integer('assists').default(0),
      minutesPlayed: integer('minutes_played').default(0),
      fieldGoalsMade: integer('field_goals_made').default(0),
      fieldGoalsAttempted: integer('field_goals_attempted').default(0),
      createdAt: timestamp('created_at').defaultNow().notNull(),
      updatedAt: timestamp('updated_at').defaultNow().notNull(),
    });

    const gameStatsSchema = xpschema({
      game: gameTable,
      player: playerTable,
      gameStats: gameStatsTable,
    });

    const connInfo9 = await createOrRetrieveRegistryEntry({
      name: test9DbName,
      driverName: 'pglite',
      dialectName: 'pg',
    });
    const db5 = await gameStatsSchema.connect(connInfo9);
    await db5.createOrMigrate();

    // Insert game and player first
    const game = await db5.game.insert({ name: 'Game 1' }).returning();
    const player = await db5.player.insert({ name: 'Player 1' }).returning();
    const gameId = game[0].id;
    const playerId = player[0].id;
    addLog(`   Created game with ID: ${gameId}`, 'log');
    addLog(`   Created player with ID: ${playerId}`, 'log');

    try {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        gameId,
        playerId,
        points: i * 10,
        rebounds: i * 5,
        assists: i * 2,
        minutesPlayed: 30 + i,
        fieldGoalsMade: i,
        fieldGoalsAttempted: i * 2,
      }));
      const result = await db5.gameStats.insert(rows).returning();
      addLog(`✅ Test 9 passed: Inserted ${result.length} row(s)`, 'success');
    } catch (error: any) {
      addLog(`❌ Test 9 failed: ${error.message}`, 'error');
      addLog(`   Error code: ${error.code}`, 'error');
      addLog(`   Error detail: ${error.detail}`, 'error');
      addLog(`   Error hint: ${error.hint}`, 'error');
      if (error.stack) {
        addLog(`   Stack: ${error.stack.substring(0, 500)}`, 'error');
      }
      throw error;
    }

    addLog('✅ All tests passed!', 'success');
  } catch (error: any) {
    addLog(`❌ Test suite failed: ${error.message}`, 'error');
    throw error;
  }
}

