/**
 * Migration Generator
 * 
 * Generates migration SQL from schema differences.
 * Can generate both initial migrations and incremental migrations.
 */

import type { Schema } from '../../schema';
import type { SQLDialect } from '../../dialects/types';
import { getDialectFromName } from '../../dialects';
import { bindTable, isUTable } from '../../dialects/implementations/unbound';
import { generateCreateScriptForTable, generateCreateScriptForSchema } from '../sql-generation/generate-create-script';
import { diffSchemas, extractTableMetadata, compareTables, type TableMetadata, type SchemaDiff } from '../schema-extraction/schema-diff';
import type { UTable } from '../../dialects/implementations/unbound';
import { extractSchemaMetadataWithDialect } from '../schema-extraction/extract-schema-metadata';
import { Table, getTableName } from 'drizzle-orm';
import { 
  generateCreateScriptFromSnapshot, 
  generateMigrationFromSnapshotDiff,
  type SchemaSnapshot
} from '../sql-generation/snapshot-sql-generator';

/**
 * Check if we're running in a Node.js environment
 */
function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && 
         process.versions != null && 
         process.versions.node != null;
}

/**
 * Throw a helpful error if not in Node.js environment
 */
function requireNodeEnvironment(functionName: string): void {
  if (!isNodeEnvironment()) {
    throw new Error(
      `${functionName} requires a Node.js environment. ` +
      `This function cannot be used in web browsers or other non-Node.js environments.`
    );
  }
}

// In CommonJS, we can use require() directly
// No need for getNodeRequire() workaround

/**
 * Migration file structure
 */
export interface MigrationFile {
  name: string;
  hash: string;
  sql: string;
  postgres?: string;
  timestamp: number;
}

/**
 * Options for generating migrations
 */
export interface GenerateMigrationOptions {
  /**
   * Path to the migrations directory (will create per-dialect subdirectories)
   * Can be a file path or directory path. If directory, will create per-dialect subdirectories.
   */
  migrationsDir?: string;
  
  /**
   * Unbound schema to generate migrations for
   */
  schema: Schema<any>;
  
  /**
   * Optional: Path to existing migration files to compare against
   * If not provided, will generate initial migration
   */
  existingMigrationsPath?: string;
  
  /**
   * Optional: Database connection for schema introspection
   * If provided, will use this to detect the current schema
   */
  database?: any; // XPDatabaseConnectionPlus
  
  /**
   * Optional: Custom migration name (defaults to timestamp-based name)
   */
  migrationName?: string;
  
  /**
   * Optional: Whether to generate for all dialects or just specific ones
   */
  dialects?: ('sqlite' | 'pg')[];
}

/**
 * Result of migration generation
 */
export interface GenerateMigrationResult {
  /**
   * Paths to generated migration files
   */
  migrationFiles: Array<{
    dialect: 'sqlite' | 'pg';
    path: string;
    hash: string;
  }>;
  
  /**
   * Whether this was an initial migration or an incremental one
   */
  isInitial: boolean;
  
  /**
   * Schema differences detected (if incremental)
   */
  diff?: SchemaDiff;
}

/**
 * Load existing migrations from a directory
 */
function loadExistingMigrations(migrationsPath: string): MigrationFile[] {
  requireNodeEnvironment('loadExistingMigrations');
  
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  
  if (!fs.existsSync(migrationsPath)) {
    return [];
  }
  
  const files = fs.readdirSync(migrationsPath)
    .filter((f: string) => f.endsWith('.sql') || f.endsWith('.ts') || f.endsWith('.js'))
    .sort();
  
  const migrations: MigrationFile[] = [];
  
  for (const file of files) {
    const filePath = path.join(migrationsPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Extract migration name from filename (e.g., "0001_initial.sql" -> "0001_initial")
    const name = path.basename(file, path.extname(file));
    
    // Generate hash from content
    const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    
    // Get file stats for timestamp
    const stats = fs.statSync(filePath);
    
    migrations.push({
      name,
      hash,
      sql: content,
      timestamp: stats.mtimeMs,
    });
  }
  
  return migrations;
}

// SchemaSnapshot is imported from snapshot-sql-generator

/**
 * Get the path to the latest snapshot file for a dialect (used for migration generation)
 * Stored directly in the dialect directory as snapshot.json
 */
function getSnapshotPath(migrationsDir: string, dialect: string): string {
  const path = require('path');
  return path.join(migrationsDir, dialect, 'snapshot.json');
}

/**
 * Get the path to the create script (overwritten each migration)
 */
function getCreateScriptPath(migrationsDir: string, dialect: string): string {
  const path = require('path');
  return path.join(migrationsDir, dialect, 'create.sql');
}

/**
 * Get the path to a versioned schema diff JSON for a specific migration
 */
function getVersionedDiffPath(migrationsDir: string, dialect: string, migrationName: string): string {
  const path = require('path');
  return path.join(migrationsDir, dialect, `${migrationName}.diff.json`);
}

/**
 * Load the last schema snapshot for a dialect
 */
function loadLastSnapshot(migrationsDir: string, dialect: string): SchemaSnapshot | null {
  requireNodeEnvironment('loadLastSnapshot');
  
  const fs = require('fs');
  const snapshotPath = getSnapshotPath(migrationsDir, dialect);
  
  console.log(`🔍 Looking for snapshot at: ${snapshotPath}`);
  
  if (!fs.existsSync(snapshotPath)) {
    console.log(`   Snapshot not found at ${snapshotPath}`);
    return null;
  }
  
  try {
    const content = fs.readFileSync(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as SchemaSnapshot;
    console.log(`   ✅ Loaded snapshot from migration: ${snapshot.migrationName}`);
    
    // Check if snapshot is in old format (missing columnType, length, etc.)
    // If so, we need to regenerate it
    let needsRegeneration = false;
    for (const table of Object.values(snapshot.tables)) {
      for (const col of Object.values(table.columns)) {
        // Old format: only has type string like "PgVarchar", no length/precision/etc
        // New format: has columnType, length, precision, etc.
        if ((col as any).columnType === undefined && (col as any).length === undefined && (col as any).precision === undefined) {
          // Check if type looks like old format (starts with Pg or SQLite)
          if (col.type && (col.type.startsWith('Pg') || col.type.startsWith('SQLite'))) {
            needsRegeneration = true;
            break;
          }
        }
      }
      if (needsRegeneration) break;
    }
    
    if (needsRegeneration) {
      console.log(`⚠️  Snapshot is in old format, will regenerate after migration`);
      // Don't return null - we'll still use it but know it needs updating
    }
    
    return snapshot;
  } catch (error) {
    console.warn(`⚠️  Could not load snapshot from ${snapshotPath}:`, error);
    return null;
  }
}

/**
 * Save a schema snapshot for a dialect
 */
function saveSnapshot(
  migrationsDir: string,
  dialect: string,
  migrationName: string,
  tables: Record<string, Table>,
  tableMetadata?: Record<string, TableMetadata>
): void {
  requireNodeEnvironment('saveSnapshot');
  
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  
  const snapshotPath = getSnapshotPath(migrationsDir, dialect);
  const snapshotDir = path.dirname(snapshotPath);
  
  // Ensure meta directory exists
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }
  
  // Use provided metadata if available, otherwise extract it
  let finalTableMetadata: Record<string, TableMetadata>;
  if (tableMetadata) {
    finalTableMetadata = tableMetadata;
  } else {
    // Extract metadata for all tables
    finalTableMetadata = {};
    for (const [tableName, table] of Object.entries(tables)) {
      try {
        const metadata = extractTableMetadata(table, dialect as 'sqlite' | 'pg');
        finalTableMetadata[tableName] = metadata;
        
        // Debug: Log foreign keys found
        if (metadata.foreignKeys.length > 0) {
          console.log(`   Found ${metadata.foreignKeys.length} foreign key(s) in table ${tableName}:`, 
            metadata.foreignKeys.map(fk => `${fk.localColumns.join(',')} -> ${fk.refTable}.${fk.refColumns.join(',')}`));
        }
      } catch (error) {
        console.warn(`Could not extract metadata for table ${tableName}:`, error);
      }
    }
  }
  
  // Sort table keys for consistent ordering
  const sortedTableKeys = Object.keys(finalTableMetadata).sort();
  const sortedTables: Record<string, TableMetadata> = {};
  for (const key of sortedTableKeys) {
    sortedTables[key] = finalTableMetadata[key];
  }
  
  // Calculate hash of the sorted tables JSON to uniquely identify the schema
  const tablesJSON = JSON.stringify(sortedTables);
  const hash = crypto.createHash('sha256').update(tablesJSON).digest('hex');
  
  const snapshot: SchemaSnapshot = {
    version: 1,
    timestamp: Date.now(),
    migrationName,
    tables: sortedTables,
    schemaHash: hash,
  } as SchemaSnapshot;
  
  // Save the latest snapshot (overwrites each time - used for migration generation)
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`💾 Saved latest snapshot for ${dialect} to ${snapshotPath} (hash: ${hash.substring(0, 16)}...)`);
}

/**
 * Convert snapshot table metadata back to a schema-like structure for comparison
 * This creates a minimal representation that can be used with diffSchemas
 */
async function snapshotToSchema(
  snapshot: SchemaSnapshot,
  dialect: string,
  dialectObj: SQLDialect
): Promise<Record<string, Table> | null> {
  // For now, we'll use the metadata directly in diffSchemas
  // The diffSchemas function can work with TableMetadata directly
  // But we need to reconstruct Table objects or modify diffSchemas to accept metadata
  // For simplicity, we'll modify the approach to compare metadata directly
  return null; // Will be handled differently
}

/**
 * Get the latest migration's schema by using database introspection
 * If a database connection is available, we can introspect the current schema
 */
async function getLatestSchemaFromDatabase(
  db: any, // XPDatabaseConnectionPlus
  dialect: 'sqlite' | 'pg',
  dialectObj: SQLDialect
): Promise<Record<string, Table> | undefined> {
  if (!db || typeof db.detectRuntimeSchema !== 'function') {
    return undefined;
  }
  
  try {
    // Use the database's detectRuntimeSchema method
    const schema = await db.detectRuntimeSchema();
    return schema;
  } catch (error) {
    console.warn('Could not introspect database schema:', error);
    return undefined;
  }
}

/**
 * Generate migration SQL from schema differences
 */
function generateMigrationSQL(
  diff: SchemaDiff,
  newSchema: Record<string, Table>,
  dialect: 'sqlite' | 'pg'
): string {
  const statements: string[] = [];
  
  // Handle removed tables
  for (const tableName of diff.removedTables) {
    statements.push(`DROP TABLE IF EXISTS "${tableName}";`);
  }
  
  // Handle added tables - generate CREATE TABLE for new tables
  for (const tableName of diff.addedTables) {
    const table = newSchema[tableName];
    if (table) {
      // We'll generate the full CREATE TABLE SQL separately
      // For now, add a placeholder
      statements.push(`-- CREATE TABLE "${tableName}" (generated separately)`);
    }
  }
  
  // Handle modified tables
  for (const tableDiff of diff.modifiedTables) {
    const tableName = tableDiff.tableName;
    const table = newSchema[tableName];
    
    if (!table) continue;
    
    // Handle removed columns
    for (const colName of tableDiff.removedColumns) {
      statements.push(`ALTER TABLE "${tableName}" DROP COLUMN "${colName}";`);
    }
    
    // Handle added columns
    for (const colName of tableDiff.addedColumns) {
      const metadata = extractTableMetadata(table, dialect);
      const col = metadata.columns[colName];
      if (col) {
        // Generate column definition
        // Note: Primary keys and unique constraints are handled at table level
        let colDef = `"${colName}" ${col.type}`;
        if (!col.nullable) colDef += ' NOT NULL';
        if (col.hasDefault && col.defaultValue !== undefined) {
          if (typeof col.defaultValue === 'string') {
            colDef += ` DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`;
          } else {
            colDef += ` DEFAULT ${col.defaultValue}`;
          }
        }
        statements.push(`ALTER TABLE "${tableName}" ADD COLUMN ${colDef};`);
      }
    }
    
    // Handle modified columns (simplified - in practice, you might need to recreate the column)
    for (const colChange of tableDiff.modifiedColumns) {
      statements.push(`-- TODO: Modify column "${colChange.columnName}" in table "${tableName}"`);
      statements.push(`-- Changes: ${colChange.changes.join(', ')}`);
      statements.push(`-- Note: Some column modifications may require recreating the table`);
    }
    
    // Handle removed foreign keys
    for (const fk of tableDiff.removedForeignKeys) {
      // SQLite doesn't support DROP CONSTRAINT, so we'd need to recreate the table
      // PostgreSQL supports: ALTER TABLE ... DROP CONSTRAINT ...
      if (dialect === 'pg') {
        statements.push(`-- TODO: Drop foreign key constraint (requires constraint name)`);
      } else {
        statements.push(`-- TODO: Drop foreign key (SQLite requires table recreation)`);
      }
    }
    
    // Handle added foreign keys
    for (const fk of tableDiff.addedForeignKeys) {
      const localCols = fk.localColumns.map(c => `"${c}"`).join(', ');
      const refCols = fk.refColumns.map(c => `"${c}"`).join(', ');
      let fkSQL = `ALTER TABLE "${tableName}" ADD FOREIGN KEY (${localCols}) REFERENCES "${fk.refTable}" (${refCols})`;
      
      // Add ON UPDATE and ON DELETE if specified (normalize to uppercase for SQL)
      if (fk.onUpdate) {
        const onUpdate = typeof fk.onUpdate === 'string' ? fk.onUpdate.toUpperCase() : fk.onUpdate;
        fkSQL += ` ON UPDATE ${onUpdate}`;
      }
      if (fk.onDelete) {
        const onDelete = typeof fk.onDelete === 'string' ? fk.onDelete.toUpperCase() : fk.onDelete;
        fkSQL += ` ON DELETE ${onDelete}`;
      }
      
      statements.push(fkSQL + ';');
    }
    
    // Handle removed unique constraints
    for (const unique of tableDiff.removedUniqueConstraints) {
      if (dialect === 'pg') {
        statements.push(`-- TODO: Drop unique constraint (requires constraint name)`);
      } else {
        statements.push(`-- TODO: Drop unique constraint (SQLite requires table recreation)`);
      }
    }
    
    // Handle added unique constraints
    for (const unique of tableDiff.addedUniqueConstraints) {
      const cols = unique.columns.map(c => `"${c}"`).join(', ');
      const constraintName = unique.name || `unique_${tableName}_${unique.columns.join('_')}`;
      statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS "${constraintName}" ON "${tableName}" (${cols});`);
    }
    
    // Handle removed indexes
    for (const idx of tableDiff.removedIndexes) {
      statements.push(`DROP INDEX IF EXISTS "${idx.name}";`);
    }
    
    // Handle added indexes
    for (const idx of tableDiff.addedIndexes) {
      const cols = idx.columns.map(c => `"${c}"`).join(', ');
      const uniqueKeyword = idx.unique ? 'UNIQUE ' : '';
      statements.push(`CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${cols});`);
    }
  }
  
  return statements.join('\n');
}

/**
 * Generate migrations for a schema
 */
export async function generateMigrations(
  options: GenerateMigrationOptions
): Promise<GenerateMigrationResult> {
  requireNodeEnvironment('generateMigrations');
  
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  
  const {
    migrationsDir,
    schema,
    existingMigrationsPath,
    migrationName,
    dialects = ['sqlite', 'pg'],
  } = options;
  
  // Handle migrationsDir: if not provided, use default; if provided, check if it's a directory
  let resolvedMigrationsDir: string;
  if (!migrationsDir) {
    // Default to ./migrations in current working directory
    resolvedMigrationsDir = path.resolve('./migrations');
  } else {
    // Resolve the migrations directory path
    resolvedMigrationsDir = path.resolve(migrationsDir);
    
    // Check if migrationsDir is a directory (exists and is a directory, or doesn't exist)
    const isDirectory = fs.existsSync(resolvedMigrationsDir) 
      ? fs.statSync(resolvedMigrationsDir).isDirectory()
      : true; // If doesn't exist, treat as directory (will be created)
    
    if (!isDirectory) {
      // If it's a file, use its parent directory
      resolvedMigrationsDir = path.dirname(resolvedMigrationsDir);
    }
  }
  
  // Ensure migrations directory exists
  if (!fs.existsSync(resolvedMigrationsDir)) {
    fs.mkdirSync(resolvedMigrationsDir, { recursive: true });
  }
  
  const result: GenerateMigrationResult = {
    migrationFiles: [],
    isInitial: !existingMigrationsPath || !fs.existsSync(existingMigrationsPath),
  };
  
  // Bind schema to each dialect and generate migrations
  for (const dialectName of dialects) {
    const dialectObj = await getDialectFromName(dialectName);
    const dialectDir = path.join(resolvedMigrationsDir, dialectName);
    
    // Create dialect-specific directory
    if (!fs.existsSync(dialectDir)) {
      fs.mkdirSync(dialectDir, { recursive: true });
    }
    
    // Bind all tables to this dialect, keeping track of unbound tables
    const boundTables: Record<string, Table> = {};
    const unboundTables: Record<string, UTable<any>> = {};
    for (const [tableName, table] of Object.entries(schema.tables)) {
      if (isUTable(table)) {
        unboundTables[tableName] = table;
        boundTables[tableName] = bindTable(table, dialectObj);
      } else {
        boundTables[tableName] = table as Table;
      }
    }
    
    // Load existing migrations for this dialect
    // Always load from the directory where we're writing migrations (resolvedMigrationsDir)
    // This ensures we see all existing migrations, including ones created in previous runs
    const existingMigrations = loadExistingMigrations(dialectDir);
    
    let migrationSQL = '';
    let diff: SchemaDiff | undefined;
    
    // Load the last snapshot to get the previous schema state
    // This is the source of truth - if snapshot exists, we do incremental migration
    const lastSnapshot = loadLastSnapshot(resolvedMigrationsDir, dialectName);
    
    // Determine if this is an initial migration (no snapshot = initial)
    const isInitial = !lastSnapshot;
    
    if (lastSnapshot) {
      console.log(`📸 Found snapshot for ${dialectName} from migration: ${lastSnapshot.migrationName}`);
      
      // Check if snapshot is in old format (missing column properties)
      let isOldFormat = false;
      for (const table of Object.values(lastSnapshot.tables)) {
        for (const col of Object.values(table.columns)) {
          if ((col as any).columnType === undefined && (col as any).length === undefined && (col as any).precision === undefined) {
            if (col.type && (col.type.startsWith('Pg') || col.type.startsWith('SQLite'))) {
              isOldFormat = true;
              break;
            }
          }
        }
        if (isOldFormat) break;
      }
      
      if (isOldFormat) {
        console.warn(`⚠️  Snapshot is in old format (missing column properties like length).`);
        console.warn(`   To fix: Delete the snapshot file and regenerate it.`);
        console.warn(`   Snapshot path: ${getSnapshotPath(resolvedMigrationsDir, dialectName)}`);
        console.warn(`   This may cause false positives in change detection.`);
      }
    } else {
      console.log(`🆕 No snapshot found for ${dialectName}, generating initial migration`);
    }
    
    // Extract metadata for all tables (used for both initial and incremental migrations)
    // Use the shared extraction logic that prioritizes unbound tables
    let currentMetadata: Record<string, TableMetadata>;
    
    // If we have unbound tables, use the shared extraction logic
    if (Object.keys(unboundTables).length > 0) {
      currentMetadata = await extractSchemaMetadataWithDialect(schema, dialectObj);
    } else {
      // Fallback: extract from bound tables only
      currentMetadata = {};
      for (const [tableName, table] of Object.entries(boundTables)) {
        try {
          currentMetadata[tableName] = extractTableMetadata(
            table, 
            dialectName as 'sqlite' | 'pg'
          );
        } catch (error) {
          console.warn(`Could not extract metadata for table ${tableName}:`, error);
        }
      }
    }
    
    // Calculate current schema hash after metadata extraction
    // This allows us to skip migration generation if schema hasn't actually changed
    const crypto = require('crypto');
    const sortedTableNames = Object.keys(currentMetadata).sort();
    const sortedTables: Record<string, TableMetadata> = {};
    for (const tableName of sortedTableNames) {
      sortedTables[tableName] = currentMetadata[tableName];
    }
    const currentSchemaHash = crypto.createHash('sha256').update(JSON.stringify(sortedTables)).digest('hex');
    
    if (isInitial) {
      // No snapshot exists - this is the first migration
      // Generate initial migration - full CREATE TABLE statements
      console.log(`📝 Generating initial migration SQL for ${dialectName}...`);
      
      // Create a temporary snapshot for initial migration
      const initialSnapshot: SchemaSnapshot = {
        version: 1,
        timestamp: Date.now(),
        migrationName: 'initial',
        tables: currentMetadata,
      };
      
      // Generate CREATE script from snapshot
      migrationSQL = generateCreateScriptFromSnapshot(initialSnapshot, dialectName as 'sqlite' | 'pg', { ifNotExists: false });
      console.log(`   Generated ${migrationSQL.length} characters of SQL`);
      if (!migrationSQL.trim()) {
        console.error(`❌ ERROR: Initial migration SQL is empty for ${dialectName}!`);
      }
    } else {
      // Snapshot exists - generate incremental migration from snapshot
      // currentMetadata is already extracted above, no need to re-extract
      
      console.log(`📊 Current schema has ${Object.keys(currentMetadata).length} tables: ${Object.keys(currentMetadata).join(', ')}`);
      console.log(`📊 Snapshot has ${Object.keys(lastSnapshot.tables).length} tables: ${Object.keys(lastSnapshot.tables).join(', ')}`);
      
      // Compare snapshots using metadata
      const snapshotTables = Object.keys(lastSnapshot.tables);
      const currentTables = Object.keys(currentMetadata);
      
      const addedTables = currentTables.filter(t => !snapshotTables.includes(t));
      const removedTables = snapshotTables.filter(t => !currentTables.includes(t));
      const modifiedTables: SchemaDiff['modifiedTables'] = [];
      
      if (addedTables.length > 0) {
        console.log(`➕ Added tables: ${addedTables.join(', ')}`);
      }
      if (removedTables.length > 0) {
        console.log(`➖ Removed tables: ${removedTables.join(', ')}`);
      }
      
      // Compare each table
      for (const tableName of currentTables) {
        if (snapshotTables.includes(tableName)) {
          const oldMeta = lastSnapshot.tables[tableName];
          const newMeta = currentMetadata[tableName];
          
          console.log(`🔍 Comparing table "${tableName}":`);
          console.log(`   Snapshot columns: ${Object.keys(oldMeta.columns).join(', ')}`);
          console.log(`   Current columns: ${Object.keys(newMeta.columns).join(', ')}`);
          
          // Show column type details for debugging
          for (const colName of Object.keys(newMeta.columns)) {
            if (oldMeta.columns[colName]) {
              const oldType = oldMeta.columns[colName].type;
              const newType = newMeta.columns[colName].type;
              if (oldType !== newType) {
                console.log(`   🔄 Column "${colName}" type changed: "${oldType}" -> "${newType}"`);
              }
            }
          }
          
          // Use the existing compareTables function
          const tableDiff = compareTables(oldMeta, newMeta);
          if (tableDiff) {
            console.log(`   Changes detected:`);
            if (tableDiff.addedColumns.length > 0) console.log(`     + Columns: ${tableDiff.addedColumns.join(', ')}`);
            if (tableDiff.removedColumns.length > 0) console.log(`     - Columns: ${tableDiff.removedColumns.join(', ')}`);
            if (tableDiff.modifiedColumns.length > 0) console.log(`     ~ Columns: ${tableDiff.modifiedColumns.map((c: any) => c.columnName).join(', ')}`);
            if (tableDiff.addedForeignKeys.length > 0) console.log(`     + Foreign keys: ${tableDiff.addedForeignKeys.length}`);
            if (tableDiff.removedForeignKeys.length > 0) console.log(`     - Foreign keys: ${tableDiff.removedForeignKeys.length}`);
            if (tableDiff.addedIndexes.length > 0) console.log(`     + Indexes: ${tableDiff.addedIndexes.map((i: any) => i.name).join(', ')}`);
            if (tableDiff.removedIndexes.length > 0) console.log(`     - Indexes: ${tableDiff.removedIndexes.map((i: any) => i.name).join(', ')}`);
            
            if (
              tableDiff.addedColumns.length > 0 ||
              tableDiff.removedColumns.length > 0 ||
              tableDiff.modifiedColumns.length > 0 ||
              tableDiff.addedForeignKeys.length > 0 ||
              tableDiff.removedForeignKeys.length > 0 ||
              tableDiff.addedUniqueConstraints.length > 0 ||
              tableDiff.removedUniqueConstraints.length > 0 ||
              tableDiff.addedIndexes.length > 0 ||
              tableDiff.removedIndexes.length > 0
            ) {
              modifiedTables.push(tableDiff);
            } else {
              console.log(`   ⚠️  compareTables returned diff but no actual changes detected`);
            }
          } else {
            console.log(`   ✓ No changes detected`);
          }
        }
      }
      
      // Create a diff object
      diff = {
        addedTables,
        removedTables,
        modifiedTables,
      };
      result.diff = diff;
      
      // Check if schema hash has changed (more reliable than diff for detecting actual changes)
      if (lastSnapshot && lastSnapshot.schemaHash === currentSchemaHash) {
        // Schema hash hasn't changed - no actual changes
        console.log(`ℹ️  No changes detected for ${dialectName} (schema hash unchanged: ${currentSchemaHash.substring(0, 16)}...)`);
        migrationSQL = '';
        diff = undefined;
      } else if (addedTables.length > 0 || removedTables.length > 0 || modifiedTables.length > 0) {
        console.log(`📝 Generating incremental migration for ${dialectName}: +${addedTables.length} tables, -${removedTables.length} tables, ${modifiedTables.length} modified`);
        
        // Create current snapshot for migration generation
        const currentSnapshot: SchemaSnapshot = {
          version: 1,
          timestamp: Date.now(),
          migrationName: 'current',
          tables: currentMetadata,
          schemaHash: currentSchemaHash,
        };
        
        // Generate migration SQL from snapshot comparison
        migrationSQL = generateMigrationFromSnapshotDiff(diff, currentSnapshot, dialectName as 'sqlite' | 'pg', lastSnapshot);
        console.log(`   Generated ${migrationSQL.length} characters of SQL`);
      } else {
        // No changes detected
        console.log(`ℹ️  No changes detected for ${dialectName} (snapshot comparison)`);
        migrationSQL = '';
      }
    }
    
    // Generate migration name
    // Parse the highest migration number from existing migrations
    // If initial migration exists (0001_initial), first incremental migration should be 0002
    let nextMigrationNumber = 1;
    if (existingMigrations.length > 0) {
      const migrationNumbers = existingMigrations
        .map(m => {
          const match = m.name.match(/^(\d+)_/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => n > 0);
      if (migrationNumbers.length > 0) {
        const maxNumber = Math.max(...migrationNumbers);
        nextMigrationNumber = maxNumber + 1;
      } else {
        // No numbered migrations found, but migrations exist - start at 0002 if initial exists
        const hasInitial = existingMigrations.some(m => m.name.includes('initial'));
        nextMigrationNumber = hasInitial ? 2 : 1;
      }
    } else {
      // No existing migrations - this will be the first one
      // If it's initial, use 0001; if incremental, use 0002 (in case initial was deleted)
      nextMigrationNumber = isInitial ? 1 : 2;
    }
    const timestamp = Date.now();
    const name = migrationName || `${String(nextMigrationNumber).padStart(4, '0')}_${isInitial ? 'initial' : 'migration'}`;
    
    // Generate hash
    const hash = crypto.createHash('sha256').update(migrationSQL).digest('hex').substring(0, 16);
    
    // Write migration file
    const migrationFileName = `${name}.sql`;
    const migrationFilePath = path.join(dialectDir, migrationFileName);
    
    // Add header comment
    const header = `-- Migration: ${name}
-- Hash: ${hash}
-- Generated: ${new Date().toISOString()}
-- Dialect: ${dialectName}
--

`;
    
    // Only write migration if there are actual changes
    if (migrationSQL.trim() && !migrationSQL.includes('WARNING: Could not determine')) {
      fs.writeFileSync(migrationFilePath, header + migrationSQL);
      
      result.migrationFiles.push({
        dialect: dialectName,
        path: migrationFilePath,
        hash,
      });
      
      // Save/create the latest create script (overwrites each time)
      const currentSnapshot: SchemaSnapshot = {
        version: 1,
        timestamp: Date.now(),
        migrationName: name,
        tables: currentMetadata,
        schemaHash: currentSchemaHash,
      };
      const createScript = generateCreateScriptFromSnapshot(currentSnapshot, dialectName as 'sqlite' | 'pg', { ifNotExists: false });
      const createScriptPath = getCreateScriptPath(resolvedMigrationsDir, dialectName);
      const createScriptHeader = `-- Create Script (Latest Schema)
-- Schema Hash: ${currentSchemaHash.substring(0, 16)}...
-- Generated: ${new Date().toISOString()}
-- Dialect: ${dialectName}
-- Migration: ${name}
--

`;
      fs.writeFileSync(createScriptPath, createScriptHeader + createScript);
      console.log(`💾 Saved latest create script for ${dialectName} to ${createScriptPath}`);
      
      // Save schema diff JSON for this migration (only for incremental migrations)
      if (!isInitial && diff) {
        const diffPath = getVersionedDiffPath(resolvedMigrationsDir, dialectName, name);
        const diffJson = {
          migrationName: name,
          schemaHash: currentSchemaHash,
          previousSchemaHash: lastSnapshot?.schemaHash,
          timestamp: Date.now(),
          diff: diff,
        };
        fs.writeFileSync(diffPath, JSON.stringify(diffJson, null, 2));
        console.log(`💾 Saved schema diff for ${dialectName} to ${diffPath}`);
      }
      // For initial migration: no diff needed (no previous state)
      
      // Save snapshot after generating migration (always save, even for initial)
      // Pass the already-extracted metadata to avoid duplicate extraction
      saveSnapshot(resolvedMigrationsDir, dialectName, name, boundTables, currentMetadata);
      console.log(`✅ Generated migration file: ${migrationFilePath}`);
    } else if (migrationSQL.includes('WARNING: Could not determine')) {
      // Don't create empty migration file, just log warning
      console.warn(`⚠️  Skipping migration generation for ${dialectName}: Could not determine previous schema state.`);
    } else if (isInitial && !migrationSQL.trim()) {
      // Initial migration but SQL is empty - this shouldn't happen
      console.error(`❌ Error: Initial migration SQL is empty for ${dialectName}. This indicates a problem with schema generation.`);
    } else if (isInitial) {
      // Initial migration - always write and save snapshot
      fs.writeFileSync(migrationFilePath, header + migrationSQL);
      result.migrationFiles.push({
        dialect: dialectName,
        path: migrationFilePath,
        hash,
      });
      
      // Save/create the latest create script (overwrites each time)
      const initialSnapshot: SchemaSnapshot = {
        version: 1,
        timestamp: Date.now(),
        migrationName: name,
        tables: currentMetadata,
        schemaHash: currentSchemaHash,
      };
      const createScript = generateCreateScriptFromSnapshot(initialSnapshot, dialectName as 'sqlite' | 'pg', { ifNotExists: false });
      const createScriptPath = getCreateScriptPath(resolvedMigrationsDir, dialectName);
      const createScriptHeader = `-- Create Script (Latest Schema)
-- Schema Hash: ${currentSchemaHash.substring(0, 16)}...
-- Generated: ${new Date().toISOString()}
-- Dialect: ${dialectName}
-- Migration: ${name}
--

`;
      fs.writeFileSync(createScriptPath, createScriptHeader + createScript);
      console.log(`💾 Saved latest create script for ${dialectName} to ${createScriptPath}`);
      
      // Pass the already-extracted metadata to avoid duplicate extraction
      saveSnapshot(resolvedMigrationsDir, dialectName, name, boundTables, currentMetadata);
      console.log(`✅ Generated initial migration file: ${migrationFilePath}`);
    } else {
      // Empty migration (no changes) - don't create file, but log
      console.log(`ℹ️  No changes detected for ${dialectName}, skipping migration.`);
      if (diff) {
        console.log(`   Diff summary: +${diff.addedTables.length} tables, -${diff.removedTables.length} tables, ${diff.modifiedTables.length} modified`);
      }
    }
  }
  
  return result;
}

/**
 * Options for generating migrations from a schema file
 */
export interface GenerateMigrationsFromFileOptions {
  /**
   * Path to the source file that exports the schema
   */
  sourceFile: string;
  
  /**
   * Name of the export (e.g., 'schema', or 'default' for default export)
   */
  exportName?: string;
  
  /**
   * Path to the migrations directory (optional)
   * Can be a file path or directory path. If directory, will create per-dialect subdirectories.
   * If not provided, defaults to './migrations' relative to source file
   */
  migrationsDir?: string;
  
  /**
   * Optional: Path to existing migration files to compare against
   * If not provided, will generate initial migration
   */
  existingMigrationsPath?: string;
  
  /**
   * Optional: Database connection for schema introspection
   * If provided, will use this to detect the current schema
   */
  database?: any; // XPDatabaseConnectionPlus
  
  /**
   * Optional: Custom migration name (defaults to timestamp-based name)
   */
  migrationName?: string;
  
  /**
   * Optional: Whether to generate for all dialects or just specific ones
   */
  dialects?: ('sqlite' | 'pg')[];
}

/**
 * Load schema from a file
 */
async function loadSchemaFromFile(
  schemaFile: string,
  exportName: string
): Promise<Schema<any>> {
  requireNodeEnvironment('loadSchemaFromFile');
  
  const fs = require('fs');
  const path = require('path');
  
  const schemaFilePath = path.resolve(schemaFile);
  
  if (!fs.existsSync(schemaFilePath)) {
    throw new Error(`Schema file not found: ${schemaFilePath}`);
  }
  
  // Clear require cache to ensure fresh import
  const modulePath = schemaFilePath.replace(/\.ts$/, '').replace(/\.js$/, '');
  const requireCache = require.cache;
  if (requireCache && requireCache[modulePath]) {
    delete requireCache[modulePath];
  }
  
  let module: any;
  try {
    module = require(modulePath);
  } catch (error) {
    try {
      module = require(schemaFilePath);
    } catch (e) {
      throw new Error(
        `Failed to import module from ${schemaFilePath}. ` +
        `Make sure the file can be executed (e.g., using tsx or ts-node). ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  const schema = exportName === 'default' ? module.default : module[exportName];
  if (!schema) {
    throw new Error(`Export '${exportName}' not found in module. Available exports: ${Object.keys(module).join(', ')}`);
  }
  
  // Check if it's a Schema instance
  if (!schema || typeof schema !== 'object' || !('tables' in schema)) {
    throw new Error(`Export '${exportName}' is not a Schema instance. Expected an object with a 'tables' property.`);
  }
  
  return schema;
}

/**
 * Generate migrations from a schema file
 */
export async function generateMigrationsFromFile(
  options: GenerateMigrationsFromFileOptions
): Promise<GenerateMigrationResult> {
  const {
    sourceFile,
    exportName = 'schema',
    migrationsDir,
    existingMigrationsPath,
    database,
    migrationName,
    dialects,
  } = options;
  
  // Load schema from file
  const schema = await loadSchemaFromFile(sourceFile, exportName);
  
  // If migrationsDir is not provided, default to './migrations' relative to source file
  let resolvedMigrationsDir = migrationsDir;
  if (!resolvedMigrationsDir) {
    const path = require('path');
    const sourceDir = path.dirname(path.resolve(sourceFile));
    resolvedMigrationsDir = path.join(sourceDir, 'migrations');
  }
  
  // Generate migrations
  return await generateMigrations({
    migrationsDir: resolvedMigrationsDir,
    schema,
    existingMigrationsPath,
    database,
    migrationName,
    dialects,
  });
}

/**
 * Try to generate migrations, catching and logging errors gracefully
 * Provides helpful console output and error handling
 */
export async function tryGenerateMigrations(
  options: GenerateMigrationsFromFileOptions
): Promise<GenerateMigrationResult | null> {
  const { sourceFile, exportName, migrationsDir, migrationName, dialects } = options;
  
  console.log(`🔧 Generating migrations...`);
  console.log(`   - Source: ${sourceFile}`);
  console.log(`   - Export: ${exportName ?? 'schema'}`);
  if (migrationsDir) {
    console.log(`   - Migrations dir: ${migrationsDir}`);
  }
  if (migrationName) {
    console.log(`   - Migration name: ${migrationName}`);
  }
  if (dialects) {
    console.log(`   - Dialects: ${dialects.join(', ')}`);
  }
  console.log('');
  
  try {
    const result = await generateMigrationsFromFile(options);
    
    console.log('✅ Migrations generated successfully!');
    console.log(`   - Type: ${result.isInitial ? 'Initial' : 'Incremental'}`);
    console.log(`   - Files generated: ${result.migrationFiles.length}\n`);
    
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
        for (const table of result.diff.modifiedTables) {
          if (table.addedColumns.length > 0) {
            console.log(`      ➕ Added columns: ${table.addedColumns.join(', ')}`);
          }
          if (table.removedColumns.length > 0) {
            console.log(`      ➖ Removed columns: ${table.removedColumns.join(', ')}`);
          }
          if (table.modifiedColumns.length > 0) {
            console.log(`      🔄 Modified columns: ${table.modifiedColumns.map(c => c.columnName).join(', ')}`);
          }
        }
      }
    }
    
    console.log('\n🎉 Done!');
    return result;
  } catch (error) {
    console.error('❌ Error generating migrations:', error);
    if (error instanceof Error) {
      console.error(`   - Message: ${error.message}`);
      if (error.stack) {
        console.error(`   - Stack: ${error.stack}`);
      }
    }
    console.error('');
    return null;
  }
}

/**
 * Generate migrations script (for use in XPSchemaPlus)
 */
export function genMigrationsScript(
  filename: string,
  dst?: string,
  dialects?: string[]
): Promise<GenerateMigrationResult | null> {
  return tryGenerateMigrations({
    sourceFile: filename,
    migrationsDir: dst,
    dialects: dialects as ('sqlite' | 'pg')[] | undefined,
  }).then(r => {
    if (!r) process.exit(1);
    return r;
  }, e => {
    process.exit(1);
    return null;
  });
}

