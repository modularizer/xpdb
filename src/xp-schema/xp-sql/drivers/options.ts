import {DbConnectionInfo, DrizzleDatabaseConnectionDriver, XPDriverImpl} from "./types";
import {SQLDialect} from "../dialects/types";
import {getDialectFromName} from "../dialects/options";
// Static import for pglite - it works on web/mobile and static import avoids Metro bundling issues
import { pgliteDriver } from "./implementations/pglite";

export enum XPDriverName {
    PGLITE = 'pglite',
    POSTGRES = 'postgres',
    SQLITE_MOBILE = 'sqlite-mobile',
}

export const driverDialects = {
    [XPDriverName.PGLITE]: 'pg',
    [XPDriverName.POSTGRES]: 'pg',
    [XPDriverName.SQLITE_MOBILE]: 'sqlite',
}

/**
 * Detect driver from connection info
 */
export function detectDriverFromConnectionInfo(connInfo: DbConnectionInfo): XPDriverName {
    switch (connInfo.driverName){
        case 'sqlite-mobile':
            return XPDriverName.SQLITE_MOBILE;
        case 'pg':
        case 'pglite':
            return XPDriverName.PGLITE;
        case 'postgres':
            return XPDriverName.POSTGRES;
        default:
            throw new Error(`Unsupported driver: ${connInfo.driverName}`);
    }
}
/**
 * Get the connect function for a connection info type
 */
export async function getDriverImpl<T extends DbConnectionInfo>(connInfo: T) {
    const driver = detectDriverFromConnectionInfo(connInfo);

    switch (driver) {
        case XPDriverName.PGLITE: {
            // Use static import - pglite driver works on web/mobile
            return pgliteDriver as XPDriverImpl;
        }
        case XPDriverName.POSTGRES: {
            // Postgres is Node.js-only - use require() directly (only called in Node.js contexts)
            if (typeof require === 'undefined') {
                throw new Error('Postgres driver requires Node.js environment');
            }
            // Use Function constructor to prevent Metro from statically analyzing the require() call
            // Construct path dynamically so Metro can't see the string literal
            // This file is only loaded in Node.js contexts where require() bypasses Metro's resolver
            const postgresPath = '.' + '/implementations' + '/postgres';
            const requirePostgres = new Function('path', 'return require(path)');
            const postgresModule = requirePostgres(postgresPath);
            return postgresModule.postgresDriver as XPDriverImpl;
        }
        case XPDriverName.SQLITE_MOBILE: {
            const { sqliteDriver } = await import('./implementations/sqlite-mobile');
            return sqliteDriver as XPDriverImpl;
        }
        default:
            throw new Error(`No connect function available for driver: ${driver}`);
    }
}

/**
 * Get the connect function for a connection info type
 */
export async function getConnectFunction<T extends DbConnectionInfo>(connInfo: T) {
    return (await getDriverImpl(connInfo)).connect;
}


export async function connectToDriver(connInfo: DbConnectionInfo): Promise<DrizzleDatabaseConnectionDriver> {
    const connect = await getConnectFunction(connInfo);
    return await connect(connInfo);
}

export async function getDialectFromDriverName(driverName: string): Promise<SQLDialect> {
    const dialectName = driverDialects[driverName as XPDriverName];
    return await getDialectFromName(dialectName);
}
