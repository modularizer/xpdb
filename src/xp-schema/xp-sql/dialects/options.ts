
import {SQLDialect} from "./types";

export enum XPDialect {
    POSTGRES = 'pg',
    SQLITE = 'sqlite',
}



/**
 * Get SQL dialect instance from dialect name
 */
export async function getDialectFromName(dialectName: string): Promise<SQLDialect> {
    switch (dialectName) {
        case 'pg': {
            const { default: pgDialect } = await import('./implementations/pg');
            return pgDialect;
        }
        case 'sqlite': {
            const { default: sqliteDialect } = await import('./implementations/sqlite');
            return sqliteDialect;
        }
        case 'unbound': {
            const { default: unboundDialect } = await import('./implementations/unbound');
            return unboundDialect;
        }
        default:
            throw new Error(`Unknown dialect name: ${dialectName}`);
    }
}