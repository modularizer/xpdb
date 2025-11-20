/**
 * xp-deeby Utilities
 * 
 * Re-exports utility functions from various modules
 */

// Export from upsert.ts
export { deleteMissingChildren, type UpsertResult } from './upsert';

// Export from migrations.ts
export { runMigrations, type Migration, type RunMigrationsOptions } from './migrations';

// Export from xp-schema
export { generateUUID } from '../xp-schema';

// Query builder utilities (to be implemented)
export type QueryBuilderState = Record<string, any>;

// Stub implementations for missing utilities
// TODO: Implement these properly
export function applyQueryModifiers(query: any, state: QueryBuilderState): any {
  // Stub implementation - needs to be implemented
  return query;
}

export async function upsertEntity(db: any, table: any, entity: any, condition: any): Promise<any> {
  // Stub implementation - use db.upsertWhere instead
  throw new Error('upsertEntity is not implemented. Use db.upsertWhere() instead.');
}

export async function upsertEntities(db: any, table: any, entities: any[], condition: any): Promise<any[]> {
  // Stub implementation - use db.upsertWhere with array instead
  throw new Error('upsertEntities is not implemented. Use db.upsertWhere() with an array instead.');
}

// SQL utility functions (to be implemented or found)
export function makeIdempotent(sql: string): string {
  // Stub - needs implementation
  return sql;
}

export function convertToPostgres(sql: string): string {
  // Stub - needs implementation
  return sql;
}

export function convertBackticksToQuotes(sql: string): string {
  // Stub - needs implementation
  return sql.replace(/`/g, '"');
}

export function hashSQL(sql: string): string {
  // Stub - needs implementation
  // Simple hash for now
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

