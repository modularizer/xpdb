/**
 * Migration Utilities
 * 
 * Generic utilities for running database migrations.
 * These functions are schema-agnostic and can be used with any migration set.
 */

import type { XPDatabaseConnectionPlus } from '../../index';
import { sql } from 'drizzle-orm';

/**
 * Migration definition
 */
export interface Migration {
  name: string;
  hash: string;
  sql: string;
  postgres?: string;
}

/**
 * Options for running migrations
 */
export interface RunMigrationsOptions {
  /**
   * Name of the migrations tracking table (e.g., '__drizzle_migrations_my_module')
   */
  migrationsTableName: string;
  
  /**
   * Array of migrations to run
   */
  migrations: Migration[];
  
  /**
   * Optional callback to log migration progress
   */
  onMigrationApplied?: (migration: Migration) => void;
}

/**
 * Get set of applied migration hashes
 */
async function getAppliedMigrations(
  db: XPDatabaseConnectionPlus,
  migrationsTableName: string
): Promise<Set<string>> {
  try {
    const result = await db.execute(
      sql.raw(`SELECT hash FROM ${migrationsTableName}`)
    ) as any[];

    return new Set(result.map((row: any) => row.hash));
  } catch (error) {
    return new Set();
  }
}

/**
 * Run all pending migrations
 * 
 * Migrations are tracked per-database to ensure they're only run once.
 * This function is idempotent and safe to call multiple times.
 * 
 * @param db - Database instance
 * @param options - Migration configuration
 * 
 * @example
 * ```ts
 * await runMigrations(db, {
 *   migrationsTableName: '__drizzle_migrations_my_module',
 *   migrations: myMigrations,
 *   onMigrationApplied: (migration) => {
 *     console.log(`Applied: ${migration.name}`);
 *   }
 * });
 * ```
 */
export async function runMigrations(
  db: XPDatabaseConnectionPlus,
  options: RunMigrationsOptions
): Promise<void> {
  const { migrationsTableName, migrations, onMigrationApplied } = options;
  
  // Get dialect from database connection
  const dialect = db.dialect.dialectName === 'pg' ? 'postgres' : 'sqlite';
  
  // Create migrations tracking table
  // Use dialect-appropriate syntax
  const idColumn = dialect === 'postgres' 
    ? 'id SERIAL PRIMARY KEY'
    : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ${migrationsTableName} (
      ${idColumn},
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER
    )
  `));

  // Get list of applied migrations
  const appliedMigrations = await getAppliedMigrations(db, migrationsTableName);

  // Run all migrations in order
  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.hash)) {
      try {
        // Use pre-generated dialect-specific SQL (generated at build time, not converted at runtime)
        const migrationSQL = dialect === 'postgres' && migration.postgres
          ? migration.postgres
          : migration.sql;
        
        // Split migration SQL into individual statements
        // Replace statement-breakpoint comments with semicolons to help with splitting
        let normalizedSQL = migrationSQL.replace(/--> statement-breakpoint/gi, ';');
        
        // Make migration idempotent by adding IF NOT EXISTS to CREATE TABLE and CREATE INDEX
        // This allows migrations to be safely re-run if partially applied
        // Handle both SQLite backticks and PostgreSQL double quotes (preserve existing quote style)
        normalizedSQL = normalizedSQL.replace(/CREATE TABLE\s+(?!IF NOT EXISTS\s+)([`"]?)([^`"\s]+)\1/gi, (match, quote, name) => {
          return `CREATE TABLE IF NOT EXISTS ${quote}${name}${quote}`;
        });
        normalizedSQL = normalizedSQL.replace(/CREATE (UNIQUE )?INDEX\s+(?!IF NOT EXISTS\s+)([`"]?)([^`"\s]+)\2/gi, (match, unique, quote, name) => {
          return `CREATE ${unique || ''}INDEX IF NOT EXISTS ${quote}${name}${quote}`;
        });
        
        // Split by semicolon and filter
        const statements = normalizedSQL
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));
        
        // Execute each statement individually (PGlite prepared statements can only handle one at a time)
        for (const statement of statements) {
          if (statement) {
            await db.execute(sql.raw(statement + ';'));
          }
        }

        // Record that this migration was applied
        // Use seconds (Unix timestamp) instead of milliseconds for INTEGER compatibility
        const timestamp = Math.floor(Date.now() / 1000);
        await db.execute(
          sql.raw(`INSERT INTO ${migrationsTableName} (hash, created_at) VALUES ('${migration.hash}', ${timestamp})`)
        );

        if (onMigrationApplied) {
          onMigrationApplied(migration);
        } else {
          console.log(`✅ Applied migration: ${migration.name}`);
        }
      } catch (error) {
        console.error(`❌ Error applying migration ${migration.name}:`, error);
        throw error;
      }
    }
  }
}

