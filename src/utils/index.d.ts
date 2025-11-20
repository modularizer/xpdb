/**
 * xp-deeby Utilities
 *
 * Re-exports utility functions from various modules
 */
export { deleteMissingChildren, type UpsertResult } from './upsert';
export { runMigrations, type Migration, type RunMigrationsOptions } from './migrations';
export { generateUUID } from '../xp-schema';
export type QueryBuilderState = Record<string, any>;
export declare function applyQueryModifiers(query: any, state: QueryBuilderState): any;
export declare function upsertEntity(db: any, table: any, entity: any, condition: any): Promise<any>;
export declare function upsertEntities(db: any, table: any, entities: any[], condition: any): Promise<any[]>;
export declare function makeIdempotent(sql: string): string;
export declare function convertToPostgres(sql: string): string;
export declare function convertBackticksToQuotes(sql: string): string;
export declare function hashSQL(sql: string): string;
//# sourceMappingURL=index.d.ts.map