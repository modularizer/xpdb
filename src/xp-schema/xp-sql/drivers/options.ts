import {DbConnectionInfo, DrizzleDatabaseConnectionDriver, XPDriverImpl} from "./types";
import {SQLDialect} from "../dialects/types";
import {getDialectFromName} from "../dialects/options";

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
            const { pgliteDriver } = await import('./implementations/pglite');
            return pgliteDriver as XPDriverImpl;
        }
        case XPDriverName.POSTGRES: {
            const { postgresDriver } = await import('./implementations/postgres');
            return postgresDriver as XPDriverImpl;
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
