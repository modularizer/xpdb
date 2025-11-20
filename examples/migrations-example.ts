/**
 * Example: Using the Migration Generator
 * 
 * This script demonstrates how to use the migration generator to create
 * database migrations from an unbound schema.
 * 
 * Run with: npx tsx xp-deeby/xp-schema/examples/migrations-example.ts
 */

import { generateMigrations } from '../src/xp-schema/xp-sql/utils/migrations/migration-generator';
import { schema } from './basic/schema';
import { fileURLToPath } from 'url';

async function main() {
  // Dynamic import for Node.js-only modules
  const path = await import('path');
  const pathSync = path.default || path;
  const { fileURLToPath } = await import('url');
  const { dirname } = pathSync;
  
  const examplesDir = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : __dirname;
  const migrationsDir = pathSync.join(examplesDir, 'basic', 'migrations');
  
  console.log('🔧 Generating migrations from schema...\n');
  console.log(`   Schema: ${pathSync.join(examplesDir, 'basic/schema.ts')}`);
  console.log(`   Migrations dir: ${migrationsDir}\n`);
  
  try {
    const result = await generateMigrations({
      migrationsDir,
      schema: schema,
      // Uncomment to use existing migrations:
      // existingMigrationsPath: migrationsDir,
      migrationName: 'initial',
    });
    
    console.log('✅ Migrations generated successfully!\n');
    console.log(`   Type: ${result.isInitial ? 'Initial' : 'Incremental'}`);
    console.log(`   Files generated: ${result.migrationFiles.length}\n`);
    
    for (const file of result.migrationFiles) {
      console.log(`   📄 ${file.dialect}: ${file.path}`);
      console.log(`      Hash: ${file.hash}`);
    }
    
    if (result.diff) {
      console.log('\n📋 Schema changes detected:');
      if (result.diff.addedTables.length > 0) {
        console.log(`   ➕ Added tables: ${result.diff.addedTables.join(', ')}`);
      }
      if (result.diff.removedTables.length > 0) {
        console.log(`   ➖ Removed tables: ${result.diff.removedTables.join(', ')}`);
      }
      if (result.diff.modifiedTables.length > 0) {
        console.log(`   🔄 Modified tables: ${result.diff.modifiedTables.map(t => t.tableName).join(', ')}`);
      }
    }
    
    console.log('\n🎉 Done!');
    console.log('\nNext steps:');
    console.log('   1. Review the generated migration files');
    console.log('   2. Apply migrations using runMigrations()');
    console.log('   3. Commit migration files to version control');
  } catch (error) {
    console.error('\n❌ Error generating migrations:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error(`\n${error.stack}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Check if this file is being run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(console.error);
}

