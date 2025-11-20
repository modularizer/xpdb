import postgres, { PostgresType, Options } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import {
    connectFn,
    DbConnectionInfo,
    DrizzleDatabaseConnectionDriver, XPDriverImpl,
} from "../types";
import {sql} from "drizzle-orm";
import {PlatformName} from "../../../platform";

type PgCommonOptions = {
    ssl?: boolean | object;
    max?: number; // max connections
    idle_timeout?: number;
    connect_timeout?: number;
    onnotice?: (msg: string) => void;
};
type PgConnectionStringConfig = PgCommonOptions & {
    connectionString: string;

    host?: never;
    user?: never;
    password?: never;
    port?: never;
    database?: never;
};


type PgDiscreteConfig = PgCommonOptions & {
    connectionString?: never;

    host: string;
    user: string;
    database: string;
    password?: string;
    port?: number;
};

export type PostgresConnectionInfo =
    DbConnectionInfo & (PgConnectionStringConfig | PgDiscreteConfig);

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