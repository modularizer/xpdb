/**
 * CRUD Test
 * 
 * Contains the CRUD test implementation
 */

import { xpschema, table, text, timestamp, varchar, uuid, generateUUID, createOrRetrieveRegistryEntry } from '../xp-schema';
import {eq} from "drizzle-orm";

// Define a simple test schema
const usersTable = table('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
});

const postsTable = table('posts', {
  id: uuid('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => usersTable.id),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content'),
  postedAt: timestamp('posted_at').defaultNow(),
});

export const testSchema = xpschema({
  users: usersTable,
  posts: postsTable,
});

export interface LogCallback {
  (message: string, type?: 'log' | 'error' | 'success'): void;
}

/**
 * Run CRUD test operations
 * 
 * @param addLog - Callback function to log messages
 * @param dbName - Database name (default: 'test-db')
 * @returns Promise that resolves when test completes
 */
export async function runCRUDTest(
  addLog: LogCallback,
  dbName: string = 'test-db'
): Promise<void> {
  addLog('🚀 Starting CRUD test...', 'log');

  // Step 1: Create or retrieve database connection
  addLog('📦 Creating database connection...', 'log');
  const connInfo = await createOrRetrieveRegistryEntry({
    name: dbName,
    driverName: 'pglite',
    dialectName: 'pg'
  });

  addLog(`✅ Connected to database: ${connInfo.name}`, 'success');

  // Step 2: Connect schema to database
  addLog('🔗 Connecting schema...', 'log');
  const db = await testSchema.connect(connInfo);
  addLog('✅ Schema connected', 'success');

  // Step 2.5: Check current database schema
  addLog('🔍 Checking current database schema...', 'log');
  try {
    const currentSchema = await db.detectRuntimeSchema();
    const tableNames = Object.keys(currentSchema);
    if (tableNames.length === 0) {
      addLog('📋 Current database schema: (empty - no tables)', 'log');
    } else {
      addLog(`📋 Current database schema: ${tableNames.length} table(s)`, 'log');
      for (const [tableName, table] of Object.entries(currentSchema)) {
        try {
          // Get table columns
          const columns = await db.getTableColumns(tableName);
          const columnNames = columns.map((col: any) => col.name || col.columnName).filter(Boolean);
          addLog(`   📊 Table "${tableName}": ${columnNames.length} column(s) - ${columnNames.join(', ')}`, 'log');
        } catch (error: any) {
          addLog(`   📊 Table "${tableName}": (could not get columns: ${error.message})`, 'log');
        }
      }
    }
  } catch (error: any) {
    addLog(`⚠️  Could not detect current schema: ${error.message}`, 'log');
    // Continue anyway - might be a new database
  }

  // Step 2.6: Create or migrate database schema
  addLog('📋 Creating or migrating database schema...', 'log');
  try {
    const migrationResult = await db.createOrMigrate();
    if (migrationResult.executed) {
      addLog('✅ Database schema migrated successfully', 'success');
      if (migrationResult.migrationSQL) {
        const statementCount = migrationResult.migrationSQL.split(';').filter(s => s.trim() && !s.trim().startsWith('--')).length;
        addLog(`📝 Migration SQL executed (${statementCount} statements)`, 'log');
        // Log the diff summary
        if (migrationResult.diff.addedTables.length > 0) {
          addLog(`   ➕ Added tables: ${migrationResult.diff.addedTables.join(', ')}`, 'log');
        }
        if (migrationResult.diff.removedTables.length > 0) {
          addLog(`   ➖ Removed tables: ${migrationResult.diff.removedTables.join(', ')}`, 'log');
        }
        if (migrationResult.diff.modifiedTables.length > 0) {
          addLog(`   🔄 Modified tables: ${migrationResult.diff.modifiedTables.map((t: any) => t.tableName).join(', ')}`, 'log');
        }
      }
    } else {
      addLog('✅ Database schema is up to date', 'success');
    }
  } catch (error: any) {
    addLog(`⚠️  Schema migration: ${error.message}`, 'error');
    throw error;
  }


  // Step 3: CREATE - Insert a user
  addLog('📝 Creating user...', 'log');
  const userId = generateUUID();
  await db.users.insert({
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
  });
  addLog(`✅ User created with ID: ${userId}`, 'success');

  // Step 4: READ - Query the user
  addLog('🔍 Reading user...', 'log');
  const users = await db.users.select().where(eq(db.users.id, userId));
  if (users.length > 0) {
    addLog(`✅ Found user: ${users[0].name} (${users[0].email})`, 'success');
  } else {
    throw new Error('User not found after insert');
  }

  // Step 5: CREATE - Insert a post
  addLog('📝 Creating post...', 'log');
  const postId = generateUUID();
  await db.posts.insert({
    id: postId,
    authorId: userId,
    title: 'Test Post',
    content: 'This is a test post content',
  });
  addLog(`✅ Post created with ID: ${postId}`, 'success');

  // Step 6: READ - Query posts
  addLog('🔍 Reading posts...', 'log');
  const posts = await db.posts.select().where(eq(db.posts.authorId, userId));
  addLog(`✅ Found ${posts.length} post(s)`, 'success');

  // Step 7: UPDATE - Update the user
  addLog('✏️  Updating user...', 'log');
  await db.users.update().set({
    name: 'Updated Test User',
    email: 'updated@example.com',
  }).where(eq(db.users.id, userId));
  addLog('✅ User updated', 'success');

  // Step 8: READ - Verify update
  addLog('🔍 Verifying update...', 'log');
  const updatedUsers = await db.users.select().where(eq(db.users.id, userId));
  if (updatedUsers.length > 0 && updatedUsers[0].name === 'Updated Test User') {
    addLog('✅ Update verified', 'success');
  } else {
    throw new Error('Update verification failed');
  }

  // Step 9: DELETE - Delete the post
  addLog('🗑️  Deleting post...', 'log');
  await db.posts.delete(eq(db.posts.id, postId));
  addLog('✅ Post deleted', 'success');

  // Step 10: READ - Verify deletion
  addLog('🔍 Verifying deletion...', 'log');
  const remainingPosts = await db.posts.select().where(eq(db.posts.id, postId));
  if (remainingPosts.length === 0) {
    addLog('✅ Deletion verified', 'success');
  } else {
    throw new Error('Deletion verification failed');
  }

  // Step 11: DELETE - Delete the user
  addLog('🗑️  Deleting user...', 'log');
  await db.users.delete(eq(db.users.id, userId));
  addLog('✅ User deleted', 'success');

  // Step 12: READ - Verify user deletion
  addLog('🔍 Verifying user deletion...', 'log');
  const remainingUsers = await db.users.select().where(eq(db.users.id, userId));
  if (remainingUsers.length === 0) {
    addLog('✅ User deletion verified', 'success');
  } else {
    throw new Error('User deletion verification failed');
  }

  addLog('🎉 All CRUD operations completed successfully!', 'success');
}
