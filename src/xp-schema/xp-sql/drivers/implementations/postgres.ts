// Dynamic imports - these are peer dependencies that may not be installed
// Import them inside functions to prevent Metro from analyzing them
type PostgresType = any;
type Options = any;

import {
    connectFn,
    DrizzleDatabaseConnectionDriver, XPDriverImpl,
} from "../types";
import type { PostgresConnectionInfo } from "../connection-info-types";
import {sql} from "drizzle-orm";
import {PlatformName} from "../../../platform";

// Re-export the type for backward compatibility
export type { PostgresConnectionInfo } from "../connection-info-types";

function buildPostgresOptions(
    info: PostgresConnectionInfo
): Options<Record<string, PostgresType>> {
    const base: Options<Record<string, any>> = {
        ssl: info.ssl,
        max: info.max,
        idle_timeout: info.idle_timeout,
        connect_timeout: info.connect_timeout,
        //@ts-ignore
        onnotice: info.onnotice,
    };

    if ("connectionString" in info) {
        return {
            ...base,
            // @ts-ignore
            connectionString: info.connectionString,
        };
    }

    return {
        ...base,
        host: info.host,
        user: info.user,
        database: info.database,
        password: info.password,
        port: info.port,
    };
}

const driverDetails = {
    dialectName: 'pg',
    driverName: 'postgres',
    clientPlatforms: {
        [PlatformName.WEB]: true,
        [PlatformName.MOBILE]: true,
        [PlatformName.NODE]: true,
    },
    hostPlatforms: {
        [PlatformName.WEB]: false,
        [PlatformName.MOBILE]: false,
        [PlatformName.NODE]: true,
    },
}
export const connectToPostgres: connectFn<PostgresConnectionInfo> = async (
    info: PostgresConnectionInfo
) => {
    // Platform check - postgres driver is Node.js-only
    if (typeof window !== 'undefined' || typeof require === 'undefined') {
        throw new Error('Postgres driver requires Node.js environment');
    }
    
    // Use require() for Node.js-only packages - use Function constructor to prevent Metro static analysis
    // This file should never be bundled by Metro (only loaded via require() in Node.js)
    // Using Function constructor prevents Metro from statically analyzing the require() calls
    const postgres = new Function('return require("postgres")')();
    const drizzleModule = new Function('return require("drizzle-orm/postgres-js")')();
    const { drizzle } = drizzleModule;
    
    const options = buildPostgresOptions(info);

    // Create postgres-js client
    const client = postgres(options);

    // Wrap in Drizzle
    const db = drizzle(client) as any;
    db.raw = client;
    db.connInfo = { ...info, dialectName: 'pg', driverName: 'postgres' };
    Object.assign(db, driverDetails);
    
    // Normalize execute() to return consistent QueryResult format
    const originalExecute = db.execute.bind(db);
    db.execute = async (query: any) => {
        const result = await originalExecute(query);
        // postgres-js returns array directly, normalize to QueryResult format
        if (Array.isArray(result)) {
            return { rows: result };
        } else if (result && typeof result === 'object' && 'rows' in result) {
            // Already in {rows: [...]} format
            return {
                rows: result.rows || [],
                columns: result.columns,
                rowCount: result.rowCount || result.rows?.length,
                affectedRows: result.affectedRows,
            };
        } else {
            // Fallback: wrap in QueryResult format
            return { rows: result ? [result] : [] };
        }
    };
    
    db.close = () => db.end();
    db.deleteDatabase = async (conn: PostgresConnectionInfo) => {

        // Kick everyone out of the target DB
        // @ts-ignore
        await this.execute(sql`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = ${conn?.database}AND pid <> pg_backend_pid();
        `);

        // Drop the target database
        // @ts-ignore
        await this.execute(`DROP DATABASE IF EXISTS "${conn.database}";`);
    }

    return db as DrizzleDatabaseConnectionDriver<PostgresConnectionInfo>;
};
export const postgresDriver: XPDriverImpl = {
    ...driverDetails,
    // @ts-ignore
    connect: connectToPostgres,
}
export default connectToPostgres;