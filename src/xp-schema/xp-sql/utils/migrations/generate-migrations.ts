/**
 * CLI Script for Generating Migrations
 * 
 * Usage:
 *   npx tsx xp-deeby/xp-schema/xp-sql/utils/generate-migrations.ts <schema-file> <export-name> [migrations-dir] [migration-name]
 * 
 * Example:
 *   npx tsx xp-deeby/xp-schema/xp-sql/utils/generate-migrations.ts ./schema.ts schema ./migrations
 */

import { tryGenerateMigrations } from './migration-generator';


/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: generate-migrations.ts <schema-file> <export-name> [migrations-dir] [migration-name]');
    console.error('');
    console.error('Arguments:');
    console.error('  schema-file    Path to the schema file (e.g., ./schema.ts)');
    console.error('  export-name   Name of the schema export (e.g., "schema" or "default")');
    console.error('  migrations-dir Optional: Directory for migrations (default: ./migrations)');
    console.error('  migration-name Optional: Custom migration name (default: auto-generated)');
    console.error('');
    console.error('Example:');
    console.error('  npx tsx generate-migrations.ts ./schema.ts schema ./migrations');
    process.exit(1);
  }
  
  const [schemaFile, exportName, migrationsDir = './migrations', migrationName] = args;
  
  console.log('🔧 Generating migrations...\n');
  console.log(`   Schema file: ${schemaFile}`);
  console.log(`   Export name: ${exportName}`);
  console.log(`   Migrations dir: ${migrationsDir}`);
  if (migrationName) {
    console.log(`   Migration name: ${migrationName}`);
  }
  console.log('');
  
  try {
    // Generate migrations using the wrapper function
    const result = await tryGenerateMigrations({
      sourceFile: schemaFile,
      exportName,
      migrationsDir,
      migrationName,
    });
    
    if (!result) {
      process.exit(1);
    }
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

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

